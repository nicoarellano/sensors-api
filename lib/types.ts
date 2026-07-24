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

/** A single sensor reading (used by `?format=reading`). */
export interface Reading {
  type: string;
  unit: string;
  seed: number;
  timestamp: string;
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
  /** Number of points to return (points-based window). */
  points?: number;
  /** Total span in milliseconds (duration-based window); overrides `points`. */
  windowMs?: number;
}

/** Discriminated result of parsing/validating query parameters. */
export type ParseResult =
  | { ok: true; value: SensorParams }
  | { ok: false; error: string };
