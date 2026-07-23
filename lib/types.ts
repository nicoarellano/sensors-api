// Shared types for the synthetic sensor API.

/**
 * How a sensor's value is produced:
 * - `continuous`: a smooth diurnal curve scaled into the effective [min, max] range.
 * - `binary`: a 0/1 occupancy-style event (min/max are ignored).
 * - `enum`: a discrete label drawn from `values` (min/max are ignored).
 */
export type SensorKind = "continuous" | "binary" | "enum";

export interface SensorConfig {
  /** Unit label, e.g. "°C", "lux", "ppm". */
  unit: string;
  /** Default lower bound of the natural range. */
  min: number;
  /** Default upper bound of the natural range. */
  max: number;
  kind: SensorKind;
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

/** A single sensor reading returned by the API. */
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

/** One point in a time series. */
export interface SeriesPoint {
  timestamp: string;
  value: number | string;
}

/** A 24h series response. */
export interface Series {
  type: string;
  unit: string;
  seed: number;
  min?: number;
  max?: number;
  series: SeriesPoint[];
}

/** Validated query parameters shared by the generator functions. */
export interface SensorParams {
  seed: number;
  /** User-supplied override, or undefined to use the type default. */
  min?: number;
  /** User-supplied override, or undefined to use the type default. */
  max?: number;
  /** The instant to evaluate at. */
  at: Date;
  /** Whether the caller requested a 24h series instead of a single reading. */
  series: boolean;
}

/** Discriminated result of parsing/validating query parameters. */
export type ParseResult =
  | { ok: true; value: SensorParams }
  | { ok: false; error: string };
