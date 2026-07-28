// Shared types for the synthetic sensor API.

import type { Climate, SunState } from "@/lib/solar";

/**
 * How a sensor's value is produced:
 * - `continuous`: a physical value from the sensor's rule, normalized into the
 *   effective [min, max] range before noise and events are layered on.
 * - `binary`: a 0/1 occupancy-style event (min/max are ignored).
 * - `enum`: a discrete label drawn from `values` (min/max are ignored).
 *
 * These map to OGC SensorThings observation types (see `observationType` in
 * `lib/config.ts`): continuous -> OM_Measurement, binary -> OM_TruthObservation,
 * enum -> OM_CategoryObservation.
 */
export type SensorKind = "continuous" | "binary" | "enum";

/**
 * Where the sensor sits. `outdoor` is exposed to the real sky and the real
 * seasonal air temperature; `indoor` sits behind glazing and a control system,
 * so it is damped, lagged and held near a setpoint.
 */
export type Placement = "indoor" | "outdoor";

/** An inclusive value range in the sensor's own unit. */
export interface Range {
  min: number;
  max: number;
}

/**
 * Everything about the site and the instant that no individual sensor changes.
 * Shared by every rule so that sensors at the same seed and site agree with each
 * other: the same clouds dim the light sensor and flatten the temperature curve.
 */
export interface SiteContext {
  /** Local hour of day in [0, 24) as a float. */
  hour: number;
  /** Local day of year, 1..366 — the season. */
  dayOfYear: number;
  /** True on Saturday or Sunday, local. */
  isWeekend: boolean;
  /** Degrees north (negative south). */
  latitude: number;
  /** Degrees east of Greenwich (negative in the Americas). */
  longitude: number;
  /** Fixed offset of the requested zone from UTC, in minutes. */
  offsetMinutes: number;
  placement: Placement;
  /** The absolute instant, for models that need continuity across midnight. */
  at: Date;
  /** Seed of this series, for weather and other site-level seeded terms. */
  seed: number;
  sun: SunState;
  /** Fractional cloud cover in [0, 1]. */
  cloud: number;
  climate: Climate;
}

/** A site context plus the outdoor air temperature several rules are driven by. */
export interface ShapeContext extends SiteContext {
  /** Outdoor dry-bulb air temperature in °C at this instant. */
  outdoorC: number;
}

/**
 * How one sensor turns a context into a value. Exactly one branch applies per
 * `SensorKind`; see `lib/realism.ts` for the rules and the physics behind them.
 */
export interface SensorRule {
  /**
   * Continuous only. The default effective range for this context, used when
   * the caller supplies no `min`/`max`. Context-dependent because an honest
   * outdoor thermometer cannot report 15–30 °C in January.
   */
  range?: (ctx: ShapeContext) => Range;
  /** Continuous only. The physical value in the sensor's unit at this instant. */
  value?: (ctx: ShapeContext) => number;
  /**
   * Continuous only. Suppress the per-seed peak-timing jitter. Set it for
   * sensors whose timing is fixed by astronomy — moving a solar peak off solar
   * noon is not a personality, it is an error.
   */
  solarLocked?: boolean;
  /** Binary only. Probability in [0, 1] that the event reads true. */
  prob?: (ctx: ShapeContext) => number;
  /** Enum only. Relative weights in the same order as `values`; any positive scale. */
  weights?: (ctx: ShapeContext) => number[];
}

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
  /** Enum kind only. The discrete labels this sensor can emit. */
  values?: string[];
  /** How this sensor responds to time, season, site and placement. */
  rule: SensorRule;
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
  /** Site latitude in degrees north; sets day length and the seasonal climate. */
  latitude: number;
  /** Site longitude in degrees east; sets where solar noon falls on the clock. */
  longitude: number;
  /** Whether the sensor is exposed to the sky or sits inside a conditioned space. */
  placement: Placement;
  /** Number of points to return (points-based window). */
  points?: number;
  /** Total span in milliseconds (duration-based window); overrides `points`. */
  windowMs?: number;
}

/** Discriminated result of parsing/validating query parameters. */
export type ParseResult =
  | { ok: true; value: SensorParams }
  | { ok: false; error: string };
