// Shared types for the synthetic sensor API.

/**
 * How a sensor's value is produced:
 * - `continuous`: a smooth diurnal curve scaled into the effective [min, max] range.
 * - `binary`: a 0/1 occupancy-style event (min/max are ignored).
 * - `enum`: a discrete label drawn from `values` (min/max are ignored).
 *
 * These map to OGC SensorThings observation types (see `observationType` in
 * `lib/config.ts`): continuous -> OM_Measurement, binary -> OM_TruthObservation,
 * enum -> OM_CategoryObservation.
 */
export type SensorKind = "continuous" | "binary" | "enum";

/** OGC SensorThings Datastream.unitOfMeasurement (null trio for unitless sensors). */
export interface UnitOfMeasurement {
  name: string | null;
  symbol: string | null;
  /** IRI defining the unit (UCUM / QUDT). */
  definition: string | null;
}

/** OGC SensorThings ObservedProperty (subset). */
export interface ObservedProperty {
  name: string;
  /** IRI identifying the observed phenomenon. */
  definition: string;
}

export interface SensorConfig {
  /** Short unit label, e.g. "°C", "lux", "ppm". */
  unit: string;
  /** Default lower bound of the natural range. */
  min: number;
  /** Default upper bound of the natural range. */
  max: number;
  kind: SensorKind;
  /**
   * Default sampling interval in milliseconds. Metadata that maps to a CollabDT
   * sensor's `updateFrequency`; also the default cadence of a generated window.
   */
  frequency: number;
  /** OGC SensorThings unit descriptor for this sensor. */
  unitOfMeasurement: UnitOfMeasurement;
  /** OGC SensorThings observed property for this sensor. */
  observedProperty: ObservedProperty;
  /**
   * Normalized noise amplitude in [0, 1] (fraction of the effective range).
   * 0 disables noise. Ignored for discrete kinds.
   */
  noise: number;
  /**
   * Continuous kinds only. Average number of short bursts per day (a machine
   * starting, a tap opening, a door slamming). Omit for sensors whose
   * phenomenon is physically smooth (temperature, pressure, daylight).
   */
  eventRate?: number;
  /**
   * Continuous kinds only. Baseline shape as a function of hour-of-day
   * (0..24), returning a normalized value in [0, 1]. Because it is
   * normalized, the shape stretches into whatever effective range is in
   * force (default or user-supplied min/max) instead of clipping.
   */
  shape?: (hour: number) => number;
  /**
   * Binary kind only. Probability in [0, 1] that the event is "on" at a
   * given hour-of-day.
   */
  prob?: (hour: number) => number;
  /** Enum kind only. The discrete labels this sensor can emit. */
  values?: string[];
  /**
   * Enum kind only. Relative weights (same length/order as `values`) as a
   * function of hour-of-day. Need not sum to 1.
   */
  weights?: (hour: number) => number[];
}

/**
 * The fixed personality of one (seed, type) pair. Derived from the seed, so two
 * seeds read as two different physical sensors instead of the same curve twice.
 */
export interface SensorProfile {
  /** Multiplier on the diurnal swing above the daily floor. */
  gain: number;
  /** Baseline shift in normalized units, faded out near the floor. */
  level: number;
  /** Hours the diurnal peak is shifted by (negative = earlier). */
  phaseHours: number;
  /** Multiplier on the sensor's configured noise amplitude. */
  noiseScale: number;
}

/** A single sensor reading (used by `?format=reading`). */
export interface Reading {
  type: string;
  unit: string;
  seed: number;
  /** ISO 8601 instant carrying the requested zone's offset. */
  timestamp: string;
  /** Timezone the timestamp and the diurnal curve are expressed in. */
  timezone: string;
  value: number | string;
  /** Present for continuous sensors only (effective range). */
  min?: number;
  /** Present for continuous sensors only (effective range). */
  max?: number;
}

/** One generated sample: an absolute instant plus its value. */
export interface WindowPoint {
  /** Absolute instant of the sample. */
  at: Date;
  value: number | string;
}

/** Output representations of a generated window. */
export type OutputFormat = "csv" | "sta" | "dataArray" | "reading";

/** Validated query parameters shared by the generator functions. */
export interface SensorParams {
  seed: number;
  /** User-supplied override, or undefined to use the type default. */
  min?: number;
  /** User-supplied override, or undefined to use the type default. */
  max?: number;
  /** The instant the window ends at (or the single reading is evaluated at). */
  at: Date;
  /** Requested output representation. */
  format: OutputFormat;
  /**
   * Timezone label the series is expressed in (e.g. `EDT`). Time-of-day is read
   * in this zone, so the diurnal curve peaks at local — not UTC — noon, and
   * emitted timestamps carry its offset.
   */
  timezone: string;
  /** Fixed offset of `timezone` from UTC in minutes (EDT = -240). */
  offsetMinutes: number;
  /** Number of points to return (points-based window). */
  points?: number;
  /** Total span in milliseconds (duration-based window); overrides `points`. */
  windowMs?: number;
}

/** Discriminated result of parsing/validating query parameters. */
export type ParseResult =
  | { ok: true; value: SensorParams }
  | { ok: false; error: string };
