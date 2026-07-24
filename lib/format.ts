// Renderers turning a generated window into the wire formats we serve:
//   - CSV: header-less `time,value` (clock-style time) for the CollabDT
//     SensorChart (which fetches a Data URL and parses CSV).
//   - STA: an OGC SensorThings Datastream with embedded Observations.
//   - dataArray: the compact OGC `{components, dataArray}` time-series form.

import {
  SENSORS,
  observationTypeFor,
  type SensorType,
} from "@/lib/config";
import type {
  SensorParams,
  UnitOfMeasurement,
  ObservedProperty,
  WindowPoint,
} from "@/lib/types";

/** OGC-typed observation result: number (measurement), boolean (truth), string (category). */
export type StaResult = number | boolean | string;

export interface StaObservation {
  phenomenonTime: string;
  resultTime: string;
  result: StaResult;
}

export interface StaDatastream {
  name: string;
  description: string;
  unitOfMeasurement: UnitOfMeasurement;
  observationType: string;
  ObservedProperty: ObservedProperty;
  phenomenonTime: string;
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

/** OGC SensorThings Datastream with embedded Observations. */
export function formatSta(
  type: SensorType,
  params: SensorParams,
  points: WindowPoint[],
): StaDatastream {
  const cfg = SENSORS[type];
  const observations: StaObservation[] = points.map((p) => {
    const iso = p.at.toISOString();
    return { phenomenonTime: iso, resultTime: iso, result: staResult(type, p.value) };
  });
  const first = points[0]?.at.toISOString();
  const last = points[points.length - 1]?.at.toISOString();
  return {
    name: `${type} (seed ${params.seed})`,
    description: `Synthetic ${cfg.observedProperty.name} datastream for ${type}.`,
    unitOfMeasurement: cfg.unitOfMeasurement,
    observationType: observationTypeFor(cfg.kind),
    ObservedProperty: cfg.observedProperty,
    phenomenonTime: first && last ? `${first}/${last}` : "",
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
