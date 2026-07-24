// Renderers turning a generated window into the wire formats we serve:
//   - CSV: header-less `time,value` (clock-style time) for the CollabDT
//     SensorChart (which fetches a Data URL and parses CSV).
//   - STA: an OGC SensorThings Datastream with embedded Observations.
//   - dataArray: the compact OGC `{components, dataArray}` time-series form.

import {
  SENSORS,
  SENSOR_TYPES,
  observationTypeFor,
  type SensorType,
} from "@/lib/config";
import type {
  SensorParams,
  UnitOfMeasurement,
  WindowPoint,
} from "@/lib/types";

/** OGC-typed observation result: number (measurement), boolean (truth), string (category). */
export type StaResult = number | boolean | string;

/** Where a consumer can learn more about the generating procedure (STA Sensor.metadata). */
const GENERATOR_METADATA_URL = "https://github.com/nicoarellano/sensors-api";
/** STA Sensor.encodingType: the media type of `metadata`. */
const SENSOR_ENCODING_TYPE = "text/html";

/**
 * Stable synthetic @iot.id for a type: its 1-based index in the registry. There is
 * no instance store here, so the same id is reused across the type's Datastream,
 * Sensor, and ObservedProperty (they are 1:1 for a synthetic per-type source).
 */
function sensorIotId(type: SensorType): number {
  return SENSOR_TYPES.indexOf(type) + 1;
}

/** STA Sensor.description, phrased per kind. */
function sensorDescription(type: SensorType): string {
  const kind = SENSORS[type].kind;
  if (kind === "binary") return "Deterministic occupancy-style event generator.";
  if (kind === "enum") return "Deterministic categorical state generator.";
  return "Deterministic diurnal curve + seeded noise.";
}

export interface StaObservation {
  "@iot.id": number;
  phenomenonTime: string;
  resultTime: string;
  result: StaResult;
}

/** STA Sensor entity: the procedure/instrument that produced the observations. */
export interface StaSensor {
  "@iot.id": number;
  name: string;
  description: string;
  encodingType: string;
  metadata: string;
}

/** STA ObservedProperty entity (adds `description` over the bare config type). */
export interface StaObservedProperty {
  "@iot.id": number;
  name: string;
  definition: string;
  description: string;
}

export interface StaDatastream {
  "@iot.id": number;
  "@iot.selfLink": string;
  name: string;
  description: string;
  observationType: string;
  unitOfMeasurement: UnitOfMeasurement;
  phenomenonTime: string;
  resultTime: string;
  properties: { seed: number; frequency: number; generator: string };
  "Sensor@iot.navigationLink": string;
  Sensor: StaSensor;
  "ObservedProperty@iot.navigationLink": string;
  ObservedProperty: StaObservedProperty;
  "Observations@iot.navigationLink": string;
  "Observations@iot.count": number;
  Observations: StaObservation[];
}

export interface DataArray {
  components: ["phenomenonTime", "result"];
  "dataArray@iot.count": number;
  dataArray: [string, StaResult][];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Clock-style UTC time `H:MM:SS` (single-digit hour), matching the reference CSVs. */
export function clockTime(at: Date): string {
  return `${at.getUTCHours()}:${pad2(at.getUTCMinutes())}:${pad2(at.getUTCSeconds())}`;
}

/** CSV-safe numeric encoding: enum -> ordinal index, binary -> 0/1, continuous -> value. */
function csvValue(type: SensorType, value: number | string): number {
  const cfg = SENSORS[type];
  if (cfg.kind === "enum") {
    return Math.max(0, (cfg.values ?? []).indexOf(value as string));
  }
  return value as number;
}

/** OGC-typed result matching the Datastream's observationType. */
function staResult(type: SensorType, value: number | string): StaResult {
  const cfg = SENSORS[type];
  if (cfg.kind === "binary") return value === 1;
  if (cfg.kind === "enum") return value as string;
  return value as number;
}

/** Header-less `time,value` CSV; one point per line. */
export function formatCsv(type: SensorType, points: WindowPoint[]): string {
  return points
    .map((p) => `${clockTime(p.at)},${csvValue(type, p.value)}`)
    .join("\n");
}

/**
 * OGC SensorThings Datastream entity graph with embedded Observations.
 * `origin` is the request origin (e.g. `https://host`) used to build absolute
 * `@iot.selfLink` / `@iot.navigationLink` values that resolve to real endpoints.
 */
export function formatSta(
  type: SensorType,
  params: SensorParams,
  points: WindowPoint[],
  origin: string,
): StaDatastream {
  const cfg = SENSORS[type];
  const id = sensorIotId(type);
  const base = `${origin}/api/sensor/${type}`;
  const selfLink = `${base}?format=sta`;

  const observations: StaObservation[] = points.map((p, i) => {
    const iso = p.at.toISOString();
    return {
      "@iot.id": i + 1,
      phenomenonTime: iso,
      resultTime: iso,
      result: staResult(type, p.value),
    };
  });
  const first = points[0]?.at.toISOString();
  const last = points[points.length - 1]?.at.toISOString();
  const interval = first && last ? `${first}/${last}` : "";

  return {
    "@iot.id": id,
    "@iot.selfLink": selfLink,
    name: cfg.observedProperty.name,
    description: `Synthetic ${cfg.observedProperty.name} datastream for ${type}.`,
    observationType: observationTypeFor(cfg.kind),
    unitOfMeasurement: cfg.unitOfMeasurement,
    phenomenonTime: interval,
    resultTime: interval,
    properties: { seed: params.seed, frequency: cfg.frequency, generator: "sensors-api" },
    "Sensor@iot.navigationLink": selfLink,
    Sensor: {
      "@iot.id": id,
      name: `Synthetic ${type} sensor`,
      description: sensorDescription(type),
      encodingType: SENSOR_ENCODING_TYPE,
      metadata: GENERATOR_METADATA_URL,
    },
    "ObservedProperty@iot.navigationLink": selfLink,
    ObservedProperty: {
      "@iot.id": id,
      name: cfg.observedProperty.name,
      definition: cfg.observedProperty.definition,
      description: cfg.observedProperty.name,
    },
    "Observations@iot.navigationLink": `${base}?format=dataArray`,
    "Observations@iot.count": observations.length,
    Observations: observations,
  };
}

/** Compact OGC dataArray form: components + rows of [phenomenonTime, result]. */
export function formatDataArray(
  type: SensorType,
  points: WindowPoint[],
): DataArray {
  const dataArray: [string, StaResult][] = points.map((p) => [
    p.at.toISOString(),
    staResult(type, p.value),
  ]);
  return {
    components: ["phenomenonTime", "result"],
    "dataArray@iot.count": dataArray.length,
    dataArray,
  };
}
