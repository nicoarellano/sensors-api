// Value generation: a per-seed sensor personality applied to the diurnal curve,
// plus multi-scale seeded noise and sparse events, clamped and scaled into the
// effective range. Pure and deterministic — the same
// (type, seed, timestamp, params) always yields the same value.
//
// Three things make two seeds look like two genuinely different sensors rather
// than the same line drawn twice:
//   - profile: a fixed per-(seed, type) personality — swing amplitude, baseline
//     level, peak timing and noisiness. This is what separates the curves by day.
//   - noise:   four cosine-interpolated octaves (day, 3h, 20min, 30s) so the
//     series drifts day to day, wanders within the day, and still jitters
//     per reading.
//   - events:  sparse Gaussian bursts for sensors where spikes are physical
//     (a machine starting, a tap opening), configured via `eventRate`.
//
// Common-sense behavior is preserved: the personality scales the *swing above
// the daily floor*, so a sensor that is dark/closed/idle overnight stays that
// way for every seed, while daytime values spread out visibly.

import { SENSORS, type SensorType } from "@/lib/config";
import { mulberry32, hashString, mixSeed } from "@/lib/prng";
import { isoWithOffset } from "@/lib/timezones";
import type {
  Reading,
  SensorConfig,
  SensorParams,
  SensorProfile,
  WindowPoint,
} from "@/lib/types";

/**
 * `SENSORS` is a `satisfies` literal, so a lookup by a non-literal type is a
 * union of entry shapes. Widen to `SensorConfig` when reading optional fields
 * outside a `kind` narrowing.
 */
function configOf(type: SensorType): SensorConfig {
  return SENSORS[type];
}

/** Hard cap on how many points a single window may contain. */
export const MAX_POINTS = 1000;
/** Default window length when neither points nor window is supplied. */
export const DEFAULT_POINTS = 288;

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Noise octaves, coarse to fine. Weights sum to 1 so the total stays in [-1, 1].
 * The day-scale octave is what makes Tuesday differ from Wednesday.
 */
const NOISE_OCTAVES = [
  { periodMs: DAY_MS, weight: 0.3, salt: 0xda1 }, // day-to-day character
  { periodMs: 3 * HOUR_MS, weight: 0.28, salt: 0xd21f }, // slow within-day drift
  { periodMs: 20 * 60000, weight: 0.24, salt: 0xb0bb1e }, // wobble
  { periodMs: 15000, weight: 0.18, salt: 0x5eed }, // per-reading jitter
] as const;

// Personality spread. Wide enough to be obvious on a chart, bounded so the
// curve still reads as the same kind of sensor.
const GAIN_MIN = 0.5; // swing multiplier: 0.50 .. 1.15
const GAIN_SPAN = 0.65;
const LEVEL_SPAN = 0.12; // baseline shift: -0.06 .. +0.06 of range
const PHASE_HOURS = 1.5; // peak timing shift: -1.5 .. +1.5 h
const NOISE_MIN = 0.6; // noise multiplier: 0.6 .. 1.8
const NOISE_SPAN = 1.2;

/** A shape is "quiet-floored" if it sits at zero for this much of the day. */
const QUIET_DAY_FRACTION = 0.15;
const QUIET_EPSILON = 0.02;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Width of the soft-saturation knee at each end of the normalized range. */
const KNEE = 0.12;

/**
 * Fold a normalized value into [0, 1] with a soft knee instead of a hard cut, so
 * a strong seed produces a rounded peak rather than a flat plateau against the
 * ceiling. The bottom knee is opt-in: sensors that genuinely rest at zero
 * (dark, closed, off) must be allowed to sit exactly at zero.
 */
function saturate(x: number, softLow: boolean): number {
  let y = x;
  if (y > 1 - KNEE) {
    y = 1 - KNEE * Math.exp(-(y - (1 - KNEE)) / KNEE);
  } else if (y < KNEE) {
    y = softLow ? KNEE * Math.exp((y - KNEE) / KNEE) : Math.max(y, 0);
  }
  return clamp(y, 0, 1);
}

/**
 * Hour-of-day in [0, 24) as a float, read in the requested zone's fixed offset
 * (see lib/timezones.ts) rather than the server's zone, so the result depends
 * only on the URL. `offsetMinutes` 0 gives UTC hour-of-day.
 */
function hourOfDay(at: Date, offsetMinutes: number): number {
  const local = at.getTime() + offsetMinutes * 60000;
  const intoDay = ((local % DAY_MS) + DAY_MS) % DAY_MS;
  return Math.floor(intoDay / 1000) / 3600;
}

/** Wrap an hour offset back into [0, 24). */
function wrapHour(h: number): number {
  return ((h % 24) + 24) % 24;
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
 * Multi-scale noise in [-1, 1]: the weighted sum of `NOISE_OCTAVES`, each a
 * smooth cosine-interpolated control-point series. Continuous across midnight.
 */
function layeredNoise(seed: number, type: SensorType, at: Date): number {
  const typeHash = hashString(type);
  const t = at.getTime();
  let sum = 0;
  for (const oct of NOISE_OCTAVES) {
    sum += oct.weight * interp(seed, typeHash, oct.salt, t / oct.periodMs);
  }
  return clamp(sum, -1, 1);
}

/** Per-shape daily statistics, computed once per sensor type. */
interface ShapeStats {
  /** Lowest normalized value the shape reaches over a day. */
  floor: number;
  /** True when the shape rests at ~zero for a meaningful part of the day. */
  quiet: boolean;
}

const shapeStatsCache = new Map<SensorType, ShapeStats>();

/** Sample the shape across a day to learn its floor and whether it goes quiet. */
function shapeStats(type: SensorType): ShapeStats {
  const cached = shapeStatsCache.get(type);
  if (cached) return cached;

  const shape = configOf(type).shape;
  let floor = 0;
  let quiet = false;
  if (shape) {
    const steps = 288; // every 5 minutes
    let min = Infinity;
    let quietSteps = 0;
    for (let i = 0; i < steps; i++) {
      const v = shape((i * 24) / steps);
      if (v < min) min = v;
      if (v <= QUIET_EPSILON) quietSteps++;
    }
    floor = min;
    quiet = quietSteps / steps >= QUIET_DAY_FRACTION;
  }
  const stats: ShapeStats = { floor, quiet };
  shapeStatsCache.set(type, stats);
  return stats;
}

const profileCache = new Map<string, SensorProfile>();

/**
 * The fixed personality of one (seed, type) pair: how hard it swings, where it
 * sits, when it peaks and how noisy it is. Stable for the life of the process
 * and identical across processes — it is derived from the seed alone.
 */
export function sensorProfile(type: SensorType, seed: number): SensorProfile {
  const key = `${type}:${seed}`;
  const cached = profileCache.get(key);
  if (cached) return cached;

  const rng = mulberry32(mixSeed(seed, hashString(type), 0x9e0f11e));
  const profile: SensorProfile = {
    gain: GAIN_MIN + GAIN_SPAN * rng(),
    level: (rng() - 0.5) * LEVEL_SPAN,
    phaseHours: (rng() - 0.5) * 2 * PHASE_HOURS,
    noiseScale: NOISE_MIN + NOISE_SPAN * rng(),
  };
  profileCache.set(key, profile);
  return profile;
}

/**
 * Sparse Gaussian bursts in normalized units, for sensors that configure an
 * `eventRate` (events per day). Days and burst centers are local to the
 * requested zone, so a "busy day" lines up with the local calendar day and a
 * burst placed at 08:00 lands at 08:00 local. Neighboring days are included so
 * a burst that straddles midnight is not cut in half.
 */
function eventBoost(
  seed: number,
  type: SensorType,
  at: Date,
  amplitudeUnit: number,
  offsetMinutes: number,
): number {
  const rate = configOf(type).eventRate;
  if (!rate) return 0;

  const typeHash = hashString(type);
  const t = at.getTime() + offsetMinutes * 60000;
  const dayIndex = Math.floor(t / DAY_MS);
  let boost = 0;

  for (let d = dayIndex - 1; d <= dayIndex + 1; d++) {
    const rng = mulberry32(mixSeed(seed, typeHash, 0xe7e17, d));
    // Count varies day to day: a quiet day, then a busy one.
    const count = Math.round(rate * (0.4 + 1.2 * rng()));
    for (let i = 0; i < count; i++) {
      const centerHour = 24 * rng();
      const widthHours = 0.08 + 0.5 * rng();
      const amplitude = (0.8 + 2.2 * rng()) * amplitudeUnit;
      const dh = (t - (d * DAY_MS + centerHour * HOUR_MS)) / HOUR_MS;
      // Skip far-away events cheaply; the Gaussian is negligible past 4 sigma.
      if (Math.abs(dh) > 4 * widthHours) continue;
      boost += amplitude * Math.exp(-(dh * dh) / (2 * widthHours * widthHours));
    }
  }
  return boost;
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
  const hour = hourOfDay(at, params.offsetMinutes);

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
  const profile = sensorProfile(type, params.seed);
  const { floor, quiet } = shapeStats(type);

  // Shifted diurnal baseline: each seed peaks a little earlier or later.
  const base = cfg.shape ? cfg.shape(wrapHour(hour - profile.phaseHours)) : 0.5;

  // Scale the swing above the daily floor, not the floor itself, so overnight
  // behavior stays physical while daytime amplitudes spread out.
  const swing = profile.gain * (base - floor);
  // Baseline shift fades out near the floor (and is skipped entirely for
  // sensors that go genuinely dark/closed at night).
  const levelTerm = quiet ? 0 : profile.level * (0.25 + 0.75 * base);

  // Noise tracks activity: loudest at the peak, near-silent when the sensor is
  // physically off.
  const activity = quiet ? 0.1 + 0.9 * base : 0.55 + 0.45 * base;
  const noiseUnit = cfg.noise * profile.noiseScale * activity;
  const noise = noiseUnit * layeredNoise(params.seed, type, at);
  const events = eventBoost(
    params.seed,
    type,
    at,
    cfg.noise * activity,
    params.offsetMinutes,
  );

  const normalized = saturate(floor + swing + levelTerm + noise + events, !quiet);
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
    timestamp: isoWithOffset(params.at, params.offsetMinutes),
    timezone: params.timezone,
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
