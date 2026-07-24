import { describe, it, expect } from "vitest";
import {
  generateReading,
  generateWindow,
  MAX_POINTS,
} from "@/lib/generator";
import { SENSORS } from "@/lib/config";
import type { SensorParams } from "@/lib/types";

const AT = new Date("2026-07-23T14:05:00Z");

function params(overrides: Partial<SensorParams> = {}): SensorParams {
  return { seed: 0, at: AT, format: "csv", ...overrides };
}

describe("generateReading — determinism", () => {
  it("is identical for the same type + seed + timestamp + params", () => {
    const a = generateReading("temperature", params({ seed: 2 }));
    const b = generateReading("temperature", params({ seed: 2 }));
    expect(a).toEqual(b);
  });

  it("differs for different seeds", () => {
    const a = generateReading("temperature", params({ seed: 1 })).value;
    const b = generateReading("temperature", params({ seed: 2 })).value;
    expect(a).not.toEqual(b);
  });
});

describe("generateReading — gentle per-reading fluctuation", () => {
  it("consecutive-second readings change, but only slightly", () => {
    const range = SENSORS.temperature.max - SENSORS.temperature.min;
    const values: number[] = [];
    for (let s = 0; s < 12; s++) {
      const at = new Date(AT.getTime() + s * 1000);
      values.push(
        generateReading("temperature", params({ seed: 5, at })).value as number,
      );
    }
    // They must not all be identical (visible fluctuation).
    const unique = new Set(values);
    expect(unique.size).toBeGreaterThan(1);
    // But each step is gentle: no jump larger than 5% of the range.
    for (let i = 1; i < values.length; i++) {
      expect(Math.abs(values[i] - values[i - 1])).toBeLessThan(range * 0.05);
    }
  });

  it("still resolves identically at the exact same instant (determinism holds)", () => {
    const at = new Date(AT.getTime() + 7000);
    const a = generateReading("temperature", params({ seed: 5, at })).value;
    const b = generateReading("temperature", params({ seed: 5, at })).value;
    expect(a).toBe(b);
  });
});

describe("generateReading — clamping and range", () => {
  it("keeps continuous values within the effective range across a full day and seeds", () => {
    for (const seed of [0, 1, 7, 42]) {
      for (let m = 0; m < 24 * 60; m += 5) {
        const at = new Date(Date.UTC(2026, 6, 23, 0, m, 0));
        const r = generateReading("temperature", params({ seed, at }));
        expect(typeof r.value).toBe("number");
        expect(r.value as number).toBeGreaterThanOrEqual(SENSORS.temperature.min);
        expect(r.value as number).toBeLessThanOrEqual(SENSORS.temperature.max);
      }
    }
  });

  it("respects user min/max and stretches the curve into the new band (not clipping)", () => {
    let seenBelowZero = false;
    for (let m = 0; m < 24 * 60; m += 5) {
      const at = new Date(Date.UTC(2026, 6, 23, 0, m, 0));
      const r = generateReading(
        "temperature",
        params({ seed: 2, min: -20, max: 50, at }),
      );
      expect(r.value as number).toBeGreaterThanOrEqual(-20);
      expect(r.value as number).toBeLessThanOrEqual(50);
      if ((r.value as number) < 0) seenBelowZero = true;
    }
    expect(seenBelowZero).toBe(true);
    const one = generateReading(
      "temperature",
      params({ seed: 2, min: -20, max: 50 }),
    );
    expect(one.min).toBe(-20);
    expect(one.max).toBe(50);
  });

  it("supports one-sided overrides", () => {
    const hi = generateReading("temperature", params({ max: 20 }));
    expect(hi.min).toBe(SENSORS.temperature.min);
    expect(hi.max).toBe(20);
    const lo = generateReading("temperature", params({ min: 25 }));
    expect(lo.min).toBe(25);
    expect(lo.max).toBe(SENSORS.temperature.max);
  });
});

describe("generateReading — discrete sensors", () => {
  it("movement returns 0 or 1 and omits min/max", () => {
    const r = generateReading("movement", params({ seed: 3 }));
    expect([0, 1]).toContain(r.value);
    expect(r.min).toBeUndefined();
    expect(r.max).toBeUndefined();
  });

  it("state returns one of the configured labels", () => {
    for (const seed of [0, 1, 2, 3, 4, 5]) {
      const r = generateReading("state", params({ seed }));
      expect(SENSORS.state.values).toContain(r.value);
    }
  });
});

describe("generateWindow — points mode", () => {
  it("defaults to 288 points at the sensor frequency, ending at params.at", () => {
    const w = generateWindow("temperature", params({ seed: 2 }));
    expect(w).toHaveLength(288);
    expect(w[0].at).toBeInstanceOf(Date);
    const step = w[1].at.getTime() - w[0].at.getTime();
    expect(step).toBe(SENSORS.temperature.frequency);
    // Last point is anchored to a frequency bucket at/just before params.at.
    expect(w[w.length - 1].at.getTime()).toBeLessThanOrEqual(AT.getTime());
  });

  it("honors an explicit point count", () => {
    const w = generateWindow("temperature", params({ points: 50 }));
    expect(w).toHaveLength(50);
  });

  it("matches point-wise generateReading at the same instant", () => {
    const w = generateWindow("temperature", params({ seed: 2, points: 10 }));
    const last = w[w.length - 1];
    const single = generateReading(
      "temperature",
      params({ seed: 2, at: last.at }),
    );
    expect(last.value).toBe(single.value);
  });
});

describe("generateWindow — duration mode", () => {
  it("spans the requested window at the sensor frequency when under the cap", () => {
    // temperature freq = 5 min -> 24h = 289 points (<= cap).
    const w = generateWindow(
      "temperature",
      params({ windowMs: 24 * 3600 * 1000 }),
    );
    expect(w.length).toBeLessThanOrEqual(MAX_POINTS);
    expect(w.length).toBeGreaterThan(280);
    const spanMs = w[w.length - 1].at.getTime() - w[0].at.getTime();
    expect(spanMs).toBeGreaterThan(23 * 3600 * 1000);
  });

  it("downsamples fast sensors so the window never exceeds the cap", () => {
    // noise_level freq = 1s -> 24h would be ~86400 points; must downsample.
    const w = generateWindow(
      "noise_level",
      params({ windowMs: 24 * 3600 * 1000 }),
    );
    expect(w.length).toBeLessThanOrEqual(MAX_POINTS);
    expect(w.length).toBeGreaterThan(500);
    const spanMs = w[w.length - 1].at.getTime() - w[0].at.getTime();
    // Still covers roughly the whole day.
    expect(spanMs).toBeGreaterThan(23 * 3600 * 1000);
  });
});

describe("generateWindow — flow behavior preserved", () => {
  it("flow is mostly zero overnight with a daytime burst over 24h", () => {
    const w = generateWindow(
      "flow",
      params({ seed: 7, windowMs: 24 * 3600 * 1000 }),
    );
    const v = w.map((p) => p.value as number);
    expect(Math.max(...v)).toBeGreaterThan(2);
    expect(v.filter((x) => x < 0.6).length).toBeGreaterThan(v.length / 3);
  });
});
