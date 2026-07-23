import { describe, it, expect } from "vitest";
import { generateReading, generateSeries } from "@/lib/generator";
import { SENSORS } from "@/lib/config";
import type { SensorParams } from "@/lib/types";

const AT = new Date("2026-07-23T14:05:00Z");

function params(overrides: Partial<SensorParams> = {}): SensorParams {
  return { seed: 0, at: AT, series: false, ...overrides };
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

  it("differs at different timestamps", () => {
    const a = generateReading(
      "temperature",
      params({ at: new Date("2026-07-23T03:00:00Z") }),
    ).value;
    const b = generateReading(
      "temperature",
      params({ at: new Date("2026-07-23T15:00:00Z") }),
    ).value;
    expect(a).not.toEqual(b);
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
    // Sweep a full day with a stretched band; the diurnal trough must dip
    // well below the default min of 15, proving the shape is scaled not clipped.
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
    // Effective range is echoed back.
    const one = generateReading(
      "temperature",
      params({ seed: 2, min: -20, max: 50 }),
    );
    expect(one.min).toBe(-20);
    expect(one.max).toBe(50);
  });

  it("supports a one-sided max override (min falls back to the type default)", () => {
    const r = generateReading("temperature", params({ max: 20 }));
    expect(r.min).toBe(SENSORS.temperature.min); // default 15
    expect(r.max).toBe(20);
    expect(r.value as number).toBeGreaterThanOrEqual(15);
    expect(r.value as number).toBeLessThanOrEqual(20);
  });

  it("supports a one-sided min override (max falls back to the type default)", () => {
    const r = generateReading("temperature", params({ min: 25 }));
    expect(r.min).toBe(25);
    expect(r.max).toBe(SENSORS.temperature.max); // default 30
    expect(r.value as number).toBeGreaterThanOrEqual(25);
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

  it("discrete sensors ignore supplied min/max without error", () => {
    const r = generateReading("movement", params({ min: 5, max: 9 }));
    expect([0, 1]).toContain(r.value);
  });
});

describe("generateSeries", () => {
  it("returns 288 points at 5-minute cadence", () => {
    const s = generateSeries("temperature", params({ seed: 2 }));
    expect(s.series).toHaveLength(288);
    const t0 = new Date(s.series[0].timestamp).getTime();
    const t1 = new Date(s.series[1].timestamp).getTime();
    expect(t1 - t0).toBe(5 * 60 * 1000);
  });

  it("is deterministic and matches point-wise generateReading", () => {
    const s = generateSeries("temperature", params({ seed: 2 }));
    const last = s.series[s.series.length - 1];
    const single = generateReading(
      "temperature",
      params({ seed: 2, at: new Date(last.timestamp) }),
    );
    expect(last.value).toBe(single.value);
  });

  it("flow stays flat (mostly zero) overnight and bursts during the day", () => {
    const s = generateSeries("flow", params({ seed: 7 }));
    // The series ends at AT and spans the prior 24h, so it covers a full day.
    const values = s.series.map((p) => p.value as number);
    const maxVal = Math.max(...values);
    const zeroish = values.filter((v) => v < 0.6).length;
    expect(maxVal).toBeGreaterThan(2); // a real burst occurs
    expect(zeroish).toBeGreaterThan(values.length / 3); // long quiet stretches
  });
});
