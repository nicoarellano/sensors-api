// Value generation: diurnal curve + bounded seeded noise, clamped and scaled
// into the effective range. Pure and deterministic — the same
// (type, seed, timestamp, params) always yields the same value.

import { SENSORS, type SensorType } from "@/lib/config";
import { mulberry32, hashString, mixSeed } from "@/lib/prng";
import type { Reading, Series, SeriesPoint, SensorParams } from "@/lib/types";

const FIVE_MIN_MS = 5 * 60 * 1000;
const SERIES_POINTS = 288; // 24h at 5-minute cadence

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Hour-of-day in [0, 24) as a float, in UTC for cross-timezone determinism. */
function hourOfDay(at: Date): number {
  return (
    at.getUTCHours() +
    at.getUTCMinutes() / 60 +
    at.getUTCSeconds() / 3600
  );
}

/**
 * Smooth, deterministic noise in [-1, 1]. Seeded control points every 2 hours
 * are cosine-interpolated, so the noise varies gently (no jitter, no unbounded
 * walk). The control points depend on the seed, sensor type and the UTC day,
 * so a given instant always resolves to the same value.
 */
function smoothNoise(seed: number, type: SensorType, at: Date): number {
  const typeHash = hashString(type);
  const dayIndex = Math.floor(at.getTime() / (24 * 3600 * 1000));
  const hour = hourOfDay(at);
  const step = 2; // hours between control points
  const i0 = Math.floor(hour / step);
  const i1 = i0 + 1;
  const frac = (hour - i0 * step) / step;

  const cp = (index: number): number => {
    // Wrap the last control point back to the first for a seamless midnight.
    const wrapped = index % (24 / step);
    const s = mixSeed(seed, typeHash, dayIndex, wrapped);
    return mulberry32(s)() * 2 - 1; // [-1, 1]
  };

  const a = cp(i0);
  const b = cp(i1);
  const smooth = (1 - Math.cos(frac * Math.PI)) / 2; // cosine ease
  return a + (b - a) * smooth;
}

/** Resolve the effective [min, max] range from params, falling back to defaults. */
function effectiveRange(
  type: SensorType,
  params: SensorParams,
): { min: number; max: number } {
  const cfg = SENSORS[type];
  return {
    min: params.min ?? cfg.min,
    max: params.max ?? cfg.max,
  };
}

/** Deterministic PRNG for a discrete draw at a 5-minute time bucket. */
function bucketRng(seed: number, type: SensorType, at: Date): () => number {
  const bucket = Math.floor(at.getTime() / FIVE_MIN_MS);
  return mulberry32(mixSeed(seed, hashString(type), bucket));
}

/** Compute the raw value (number or discrete label) for a sensor at an instant. */
function computeValue(
  type: SensorType,
  params: SensorParams,
  at: Date,
): number | string {
  const cfg = SENSORS[type];
  const hour = hourOfDay(at);

  if (cfg.kind === "binary") {
    const p = cfg.prob ? cfg.prob(hour) : 0;
    return bucketRng(params.seed, type, at)() < p ? 1 : 0;
  }

  if (cfg.kind === "enum") {
    const values = cfg.values ?? [];
    const weights = cfg.weights ? cfg.weights(hour) : values.map(() => 1);
    const total = weights.reduce((sum, w) => sum + w, 0);
    let r = bucketRng(params.seed, type, at)() * total;
    for (let i = 0; i < values.length; i++) {
      r -= weights[i];
      if (r < 0) return values[i];
    }
    return values[values.length - 1];
  }

  // continuous
  const { min, max } = effectiveRange(type, params);
  const baseline = cfg.shape ? cfg.shape(hour) : 0.5;
  const noise = cfg.noise * smoothNoise(params.seed, type, at);
  const normalized = clamp(baseline + noise, 0, 1);
  const value = min + normalized * (max - min);
  const rounded = Math.round(value * 100) / 100;
  return clamp(rounded, min, max);
}

/** Generate a single reading. */
export function generateReading(type: SensorType, params: SensorParams): Reading {
  const cfg = SENSORS[type];
  const value = computeValue(type, params, params.at);
  const reading: Reading = {
    type,
    unit: cfg.unit,
    seed: params.seed,
    timestamp: params.at.toISOString(),
    value,
  };
  if (cfg.kind === "continuous") {
    const { min, max } = effectiveRange(type, params);
    reading.min = min;
    reading.max = max;
  }
  return reading;
}

/** Generate a 24h series ending at `params.at`, at 5-minute cadence. */
export function generateSeries(type: SensorType, params: SensorParams): Series {
  const cfg = SENSORS[type];
  // Anchor the series to 5-minute buckets ending at (or before) params.at.
  const endBucket = Math.floor(params.at.getTime() / FIVE_MIN_MS);
  const series: SeriesPoint[] = [];
  for (let i = SERIES_POINTS - 1; i >= 0; i--) {
    const at = new Date((endBucket - i) * FIVE_MIN_MS);
    series.push({
      timestamp: at.toISOString(),
      value: computeValue(type, params, at),
    });
  }
  const result: Series = {
    type,
    unit: cfg.unit,
    seed: params.seed,
    series,
  };
  if (cfg.kind === "continuous") {
    const { min, max } = effectiveRange(type, params);
    result.min = min;
    result.max = max;
  }
  return result;
}
