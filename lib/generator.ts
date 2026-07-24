// Value generation: diurnal curve + bounded seeded noise, clamped and scaled
// into the effective range. Pure and deterministic — the same
// (type, seed, timestamp, params) always yields the same value.
//
// Noise has two layers so readings visibly (but gently) fluctuate:
//   - drift: slow, smooth 2h control points (the daily character)
//   - jitter: small, fine 30s control points (per-reading measurement noise)
// Both are cosine-interpolated, so nearby samples differ slightly while the
// overall curve stays smooth.

import { SENSORS, type SensorType } from "@/lib/config";
import { mulberry32, hashString, mixSeed } from "@/lib/prng";
import type { Reading, SensorParams, WindowPoint } from "@/lib/types";

/** Hard cap on how many points a single window may contain. */
export const MAX_POINTS = 1000;
/** Default window length when neither points nor window is supplied. */
export const DEFAULT_POINTS = 288;

const DRIFT_WEIGHT = 0.7;
const JITTER_WEIGHT = 0.3;
const JITTER_STEP_MS = 30000; // fine control points every 30s

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Hour-of-day in [0, 24) as a float, in UTC for cross-timezone determinism. */
function hourOfDay(at: Date): number {
  return at.getUTCHours() + at.getUTCMinutes() / 60 + at.getUTCSeconds() / 3600;
}

/** Cosine-interpolated seeded control points along an index axis, in [-1, 1]. */
function interp(
  seed: number,
  typeHash: number,
  salt: number,
  indexFloat: number,
): number {
  const i0 = Math.floor(indexFloat);
  const frac = indexFloat - i0;
  const cp = (i: number): number =>
    mulberry32(mixSeed(seed, typeHash, salt, i))() * 2 - 1;
  const a = cp(i0);
  const b = cp(i0 + 1);
  const ease = (1 - Math.cos(frac * Math.PI)) / 2;
  return a + (b - a) * ease;
}

/**
 * Two-layer noise in [-1, 1]: a slow smooth drift (2h control points, reset per
 * UTC day) plus a small fine jitter (30s control points). Deterministic for a
 * given (seed, type, instant).
 */
function layeredNoise(seed: number, type: SensorType, at: Date): number {
  const typeHash = hashString(type);

  // Drift: 2h control points, wrapped within the day for a seamless midnight.
  const dayIndex = Math.floor(at.getTime() / (24 * 3600 * 1000));
  const hour = hourOfDay(at);
  const stepHours = 2;
  const driftIndex = hour / stepHours;
  const i0 = Math.floor(driftIndex);
  const frac = driftIndex - i0;
  const period = 24 / stepHours;
  const dcp = (i: number): number =>
    mulberry32(mixSeed(seed, typeHash, dayIndex, i % period))() * 2 - 1;
  const a = dcp(i0);
  const b = dcp(i0 + 1);
  const ease = (1 - Math.cos(frac * Math.PI)) / 2;
  const drift = a + (b - a) * ease;

  // Jitter: fine 30s control points (independent salt).
  const jitter = interp(seed, typeHash, 0x5eed, at.getTime() / JITTER_STEP_MS);

  return clamp(DRIFT_WEIGHT * drift + JITTER_WEIGHT * jitter, -1, 1);
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

/** Deterministic PRNG for a discrete draw at a sample instant. */
function bucketRng(seed: number, type: SensorType, at: Date): () => number {
  // Bucket at 1s so consecutive discrete samples can change independently.
  const bucket = Math.floor(at.getTime() / 1000);
  return mulberry32(mixSeed(seed, hashString(type), bucket));
}

/** Compute the raw value (number or discrete label) for a sensor at an instant. */
export function computeValue(
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
  const noise = cfg.noise * layeredNoise(params.seed, type, at);
  const normalized = clamp(baseline + noise, 0, 1);
  const value = min + normalized * (max - min);
  const rounded = Math.round(value * 100) / 100;
  return clamp(rounded, min, max);
}

/** Generate a single reading at `params.at`. */
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

/**
 * Decide the sample step (ms) and point count for a window.
 * - duration mode (`windowMs`): step is the sensor frequency, widened
 *   (downsampled) so the count never exceeds MAX_POINTS.
 * - points mode: exactly `points` samples spaced by the sensor frequency.
 */
function resolveWindow(
  type: SensorType,
  params: SensorParams,
): { stepMs: number; count: number } {
  const freq = SENSORS[type].frequency;
  if (params.windowMs !== undefined) {
    const raw = Math.floor(params.windowMs / freq) + 1;
    const stride = raw > MAX_POINTS ? Math.ceil(raw / MAX_POINTS) : 1;
    const stepMs = freq * stride;
    const count = Math.min(Math.floor(params.windowMs / stepMs) + 1, MAX_POINTS);
    return { stepMs, count };
  }
  const count = Math.min(params.points ?? DEFAULT_POINTS, MAX_POINTS);
  return { stepMs: freq, count };
}

/**
 * Generate an ordered window of samples ending at (or just before) `params.at`,
 * anchored to step-sized buckets. Each point carries an absolute instant so
 * renderers can emit ISO time (STA/dataArray) or clock-style time (CSV).
 */
export function generateWindow(
  type: SensorType,
  params: SensorParams,
): WindowPoint[] {
  const { stepMs, count } = resolveWindow(type, params);
  const endBucket = Math.floor(params.at.getTime() / stepMs);
  const points: WindowPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const at = new Date((endBucket - i) * stepMs);
    points.push({ at, value: computeValue(type, params, at) });
  }
  return points;
}
