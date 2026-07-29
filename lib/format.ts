// Renderers turning a generated window into the wire formats we serve:
//   - CSV: header-less `time,value` (clock-style time) for the CollabDT
//     SensorChart (which fetches a Data URL and parses CSV).
// Times are rendered in the requested timezone (see lib/timezones.ts): CSV as a
// local `H:MM:SS` clock, STA/dataArray as ISO 8601 carrying the zone's offset.
//   - STA: an OGC SensorThings Datastream with embedded Observations, plus the
//     site the series was generated for as a Thing + Location + FeatureOfInterest
//     (GeoJSON Point from `?lat=`/`?lon=`) and its `?placement=`.
//   - dataArray: the compact OGC `{components, dataArray}` time-series form.

import {
  SENSORS,
  SENSOR_TYPES,
  observationTypeFor,
  type SensorType,
} from "@/lib/config";
import type {
  Placement,
  SensorParams,
  UnitOfMeasurement,
  WindowPoint,
} from "@/lib/types";
import { isoWithOffset } from "@/lib/timezones";

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
  return "Deterministic solar and climate model + seeded noise.";
}

export interface StaObservation {
  "@iot.id": number;
  phenomenonTime: string;
  resultTime: string;
  result: StaResult;
}

/** GeoJSON Point — the encoding STA uses for locations and observed areas. */
export interface GeoJsonPoint {
  type: "Point";
  /** `[longitude, latitude]`, GeoJSON axis order (x, y). */
  coordinates: [number, number];
}

/** STA encodingType for a GeoJSON-encoded location or feature. */
const GEO_JSON_ENCODING_TYPE = "application/geo+json";

/** STA Location entity: where the Thing is. */
export interface StaLocation {
  "@iot.id": number;
  name: string;
  description: string;
  encodingType: string;
  location: GeoJsonPoint;
}

/** STA Thing entity: the sensor's host — the site the request asked for. */
export interface StaThing {
  "@iot.id": number;
  name: string;
  description: string;
  properties: {
    placement: Placement;
    latitude: number;
    longitude: number;
    timezone: string;
  };
  "Locations@iot.navigationLink": string;
  Locations: StaLocation[];
}

/** STA FeatureOfInterest: the thing actually being observed. */
export interface StaFeatureOfInterest {
  "@iot.id": number;
  name: string;
  description: string;
  encodingType: string;
  feature: GeoJsonPoint;
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
  /** Standard STA field: the area these observations describe — here, the site. */
  observedArea: GeoJsonPoint;
  phenomenonTime: string;
  resultTime: string;
  properties: {
    seed: number;
    frequency: number;
    generator: string;
    /** Zone the observation timestamps and the diurnal curve are expressed in. */
    timezone: string;
    /** Whether the series was generated exposed to the sky or indoors. */
    placement: Placement;
  };
  "Thing@iot.navigationLink": string;
  Thing: StaThing;
  "Sensor@iot.navigationLink": string;
  Sensor: StaSensor;
  "ObservedProperty@iot.navigationLink": string;
  ObservedProperty: StaObservedProperty;
  /**
   * STA hangs a FeatureOfInterest off each Observation. Every observation in a
   * synthetic series shares one site, so it is carried once here instead of
   * being repeated hundreds of times.
   */
  "FeatureOfInterest@iot.navigationLink": string;
  FeatureOfInterest: StaFeatureOfInterest;
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

/**
 * Clock-style local time `H:MM:SS` (single-digit hour), matching the reference
 * CSVs. `offsetMinutes` is the requested zone's fixed offset from UTC; 0 gives
 * UTC clock time.
 */
export function clockTime(at: Date, offsetMinutes: number): string {
  const local = new Date(at.getTime() + offsetMinutes * 60000);
  return `${local.getUTCHours()}:${pad2(local.getUTCMinutes())}:${pad2(local.getUTCSeconds())}`;
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

/** Header-less `time,value` CSV; one point per line, timed in the given zone. */
export function formatCsv(
  type: SensorType,
  points: WindowPoint[],
  offsetMinutes: number,
): string {
  return points
    .map((p) => `${clockTime(p.at, offsetMinutes)},${csvValue(type, p.value)}`)
    .join("\n");
}

/** `45.00 N, 75.00 W` — a site named the way a human would read it off a map. */
function siteLabel(latitude: number, longitude: number): string {
  const ns = latitude >= 0 ? "N" : "S";
  const ew = longitude >= 0 ? "E" : "W";
  return `${Math.abs(latitude).toFixed(2)} ${ns}, ${Math.abs(longitude).toFixed(2)} ${ew}`;
}

/** The request's site as a GeoJSON Point (longitude first, per GeoJSON). */
function sitePoint(params: SensorParams): GeoJsonPoint {
  return { type: "Point", coordinates: [params.longitude, params.latitude] };
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
  // Links carry the zone, the site and the placement, so following one
  // reproduces this exact series.
  const site = `&tz=${encodeURIComponent(params.timezone)}&lat=${params.latitude}&lon=${params.longitude}&placement=${params.placement}`;
  const selfLink = `${base}?format=sta${site}`;
  const point = sitePoint(params);
  const label = siteLabel(params.latitude, params.longitude);

  const observations: StaObservation[] = points.map((p, i) => {
    const iso = isoWithOffset(p.at, params.offsetMinutes);
    return {
      "@iot.id": i + 1,
      phenomenonTime: iso,
      resultTime: iso,
      result: staResult(type, p.value),
    };
  });
  const first = points[0] && isoWithOffset(points[0].at, params.offsetMinutes);
  const last =
    points[points.length - 1] &&
    isoWithOffset(points[points.length - 1].at, params.offsetMinutes);
  const interval = first && last ? `${first}/${last}` : "";

  return {
    "@iot.id": id,
    "@iot.selfLink": selfLink,
    name: cfg.observedProperty.name,
    description: `Synthetic ${cfg.observedProperty.name} datastream for ${type}.`,
    observationType: observationTypeFor(cfg.kind),
    unitOfMeasurement: cfg.unitOfMeasurement,
    observedArea: point,
    phenomenonTime: interval,
    resultTime: interval,
    properties: {
      seed: params.seed,
      frequency: cfg.frequency,
      generator: "sensors-api",
      timezone: params.timezone,
      placement: params.placement,
    },
    "Thing@iot.navigationLink": selfLink,
    Thing: {
      "@iot.id": 1,
      name: `Synthetic ${params.placement} site`,
      description: `Simulated ${params.placement} sensor host at ${label}, timed in ${params.timezone}.`,
      properties: {
        placement: params.placement,
        latitude: params.latitude,
        longitude: params.longitude,
        timezone: params.timezone,
      },
      "Locations@iot.navigationLink": selfLink,
      Locations: [
        {
          "@iot.id": 1,
          name: label,
          description: `Generation site for this series (${params.placement}).`,
          encodingType: GEO_JSON_ENCODING_TYPE,
          location: point,
        },
      ],
    },
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
    "FeatureOfInterest@iot.navigationLink": selfLink,
    FeatureOfInterest: {
      "@iot.id": 1,
      name: label,
      description: `The ${params.placement} air observed at ${label}.`,
      encodingType: GEO_JSON_ENCODING_TYPE,
      feature: point,
    },
    "Observations@iot.navigationLink": `${base}?format=dataArray${site}`,
    "Observations@iot.count": observations.length,
    Observations: observations,
  };
}

/** Compact OGC dataArray form: components + rows of [phenomenonTime, result]. */
export function formatDataArray(
  type: SensorType,
  points: WindowPoint[],
  offsetMinutes: number,
): DataArray {
  const dataArray: [string, StaResult][] = points.map((p) => [
    isoWithOffset(p.at, offsetMinutes),
    staResult(type, p.value),
  ]);
  return {
    components: ["phenomenonTime", "result"],
    "dataArray@iot.count": dataArray.length,
    dataArray,
  };
}
