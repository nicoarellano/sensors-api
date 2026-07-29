import { describe, it, expect } from "vitest";
import {
  generateReading,
  generateWindow,
  readingRange,
  sensorProfile,
  MAX_POINTS,
} from "@/lib/generator";
import { SENSORS } from "@/lib/config";
import { meridianLongitude } from "@/lib/timezones";
import type { SensorParams } from "@/lib/types";

const AT = new Date("2026-07-23T14:05:00Z");

/**
 * Base params for the curve assertions below. They read time-of-day in UTC
 * (offset 0) so "overnight" and "daytime" filters can use `getUTCHours()`;
 * timezone behavior is covered separately at the bottom of this file. The site
 * and placement match the API defaults: the reference site, exposed to the sky.
 */
function params(overrides: Partial<SensorParams> = {}): SensorParams {
  return {
    seed: 0,
    at: AT,
    format: "csv",
    timezone: "UTC",
    offsetMinutes: 0,
    latitude: 45,
    longitude: -75,
    placement: "outdoor",
    ...overrides,
  };
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
    const band = readingRange("temperature", params({ seed: 5 }));
    const range = band.max - band.min;
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
        expect(r.value as number).toBeGreaterThanOrEqual(r.min as number);
        expect(r.value as number).toBeLessThanOrEqual(r.max as number);
      }
    }
  });

  it("reports a range that follows the season rather than a fixed band", () => {
    const july = generateReading("temperature", params({ at: new Date("2026-07-23T12:00:00Z") }));
    const january = generateReading("temperature", params({ at: new Date("2026-01-15T12:00:00Z") }));
    expect(january.min as number).toBeLessThan(0);
    expect(july.min as number).toBeGreaterThan(january.max as number);
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

  it("supports one-sided overrides, keeping the rule's end on the other side", () => {
    const natural = readingRange("temperature", params());
    const hi = generateReading("temperature", params({ max: 20 }));
    expect(hi.min).toBe(natural.min);
    expect(hi.max).toBe(20);
    const lo = generateReading("temperature", params({ min: 25 }));
    expect(lo.min).toBe(25);
    expect(lo.max).toBe(natural.max);
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

describe("sensorProfile — per-seed personality", () => {
  it("is stable for a seed and different across seeds", () => {
    expect(sensorProfile("energy_consumption", 3)).toEqual(
      sensorProfile("energy_consumption", 3),
    );
    const a = sensorProfile("energy_consumption", 3);
    const b = sensorProfile("energy_consumption", 4);
    expect(a).not.toEqual(b);
  });

  it("keeps every seed within sane bounds", () => {
    for (let seed = 0; seed < 40; seed++) {
      const p = sensorProfile("energy_consumption", seed);
      expect(p.gain).toBeGreaterThanOrEqual(0.5);
      expect(p.gain).toBeLessThanOrEqual(1.15);
      expect(Math.abs(p.level)).toBeLessThanOrEqual(0.06);
      expect(Math.abs(p.phaseHours)).toBeLessThanOrEqual(1.5);
      expect(p.noiseScale).toBeGreaterThanOrEqual(0.6);
      expect(p.noiseScale).toBeLessThanOrEqual(1.8);
    }
  });
});

/** Day-long window of values for a seed, ending at midnight UTC. */
function daySeries(
  type: Parameters<typeof generateWindow>[0],
  seed: number,
  overrides: Partial<SensorParams> = {},
) {
  return generateWindow(
    type,
    params({
      seed,
      at: new Date("2026-07-27T23:59:00Z"),
      windowMs: 24 * 3600 * 1000,
      ...overrides,
    }),
  );
}

/** Mean of the points whose local hour falls in [from, to). */
function meanBetween(
  points: { at: Date; value: number | string }[],
  from: number,
  to: number,
) {
  const inRange = points.filter((p) => {
    const h = p.at.getUTCHours();
    return from <= to ? h >= from && h < to : h >= from || h < to;
  });
  return mean(inRange.map((p) => p.value as number));
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** A point tagged with the local clock hour it falls on, as a float. */
interface HourlyPoint {
  hour: number;
  value: number;
}

/**
 * A day of continuous samples tagged with their *local* hour. The zone matters
 * for anything read against the sun: at longitude -75 a UTC-labelled series puts
 * sunset just past midnight, so hour windows written in UTC read backwards.
 */
function localDay(
  type: Parameters<typeof generateWindow>[0],
  seed: number,
  overrides: Partial<SensorParams>,
): HourlyPoint[] {
  const offsetMinutes = overrides.offsetMinutes ?? 0;
  return daySeries(type, seed, overrides).map((p) => {
    const local = new Date(p.at.getTime() + offsetMinutes * 60000);
    return {
      hour: local.getUTCHours() + local.getUTCMinutes() / 60,
      value: p.value as number,
    };
  });
}

const EDT: Partial<SensorParams> = { timezone: "EDT", offsetMinutes: -240 };
const EST: Partial<SensorParams> = { timezone: "EST", offsetMinutes: -300 };

/** An exterior July day in Ottawa, by local hour. */
function summerDay(seed: number): HourlyPoint[] {
  return localDay("energy_consumption", seed, { ...EDT, placement: "outdoor" });
}

/** The same meter in January, by local hour. */
function winterDay(seed: number): HourlyPoint[] {
  return localDay("energy_consumption", seed, {
    ...EST,
    placement: "outdoor",
    at: new Date("2026-01-15T23:59:00Z"),
  });
}

/** Mean of the points whose local hour falls in [from, to), wrapping midnight. */
function meanAt(points: HourlyPoint[], from: number, to: number): number {
  return mean(
    points
      .filter((p) => (from <= to ? p.hour >= from && p.hour < to : p.hour >= from || p.hour < to))
      .map((p) => p.value),
  );
}

describe("seed separation — different seeds read as different sensors", () => {
  const SEEDS = [1, 2, 3, 4, 5];
  const INDOOR: Partial<SensorParams> = { placement: "indoor" };

  it("spreads daytime energy levels well apart", () => {
    const daytimeMeans = SEEDS.map((seed) =>
      meanBetween(daySeries("energy_consumption", seed, INDOOR), 8, 20),
    );
    // The loudest seed draws at least 40% more than the quietest.
    expect(Math.max(...daytimeMeans) / Math.min(...daytimeMeans)).toBeGreaterThan(1.4);
  });

  it("does not pin peaks flat against the ceiling", () => {
    for (const seed of SEEDS) {
      const p = params({ seed, ...INDOOR });
      const ceiling = readingRange("energy_consumption", p).max;
      const values = daySeries("energy_consumption", seed, INDOOR).map(
        (point) => point.value as number,
      );
      expect(values.filter((v) => v >= ceiling)).toHaveLength(0);
    }
  });

  it("keeps overnight behavior physical for every seed", () => {
    for (const seed of SEEDS) {
      const series = daySeries("energy_consumption", seed, INDOOR);
      expect(meanBetween(series, 1, 4)).toBeLessThan(meanBetween(series, 8, 20));
    }
  });

  it("still leaves quiet-floored sensors dark at night", () => {
    for (const seed of SEEDS) {
      // A site on the prime meridian, timed in UTC: local clock hours and solar
      // hours agree, so a UTC-hour filter really does select the night.
      const night = daySeries("light", seed, { longitude: 0 }).filter(
        (p) => p.at.getUTCHours() >= 22 || p.at.getUTCHours() < 4,
      );
      // A stray photon of noise is fine; a lit room at 3am is not.
      for (const p of night) {
        expect(p.value as number).toBeLessThan(SENSORS.light.max * 0.02);
      }
    }
  });
});

describe("timezone — the diurnal curve follows local time-of-day", () => {
  /** Hour-of-day in the given zone for a point's instant. */
  function localHour(at: Date, offsetMinutes: number): number {
    return new Date(at.getTime() + offsetMinutes * 60000).getUTCHours();
  }

  it("keeps a quiet-floored sensor dark overnight in the requested zone", () => {
    // Local 22:00–04:00 in EDT is 02:00–08:00 UTC, i.e. broad daylight in UTC
    // terms — the curve must follow the zone, not the wall clock of the server.
    const w = generateWindow(
      "light",
      params({
        seed: 3,
        timezone: "EDT",
        offsetMinutes: -240,
        at: new Date("2026-07-27T23:59:00Z"),
        windowMs: 24 * 3600 * 1000,
      }),
    );
    const night = w.filter((p) => {
      const h = localHour(p.at, -240);
      return h >= 22 || h < 4;
    });
    expect(night.length).toBeGreaterThan(0);
    for (const p of night) {
      expect(p.value as number).toBeLessThan(SENSORS.light.max * 0.02);
    }
  });

  it("puts the daylight peak at local, not UTC, midday", () => {
    const at = new Date("2026-07-27T23:59:00Z");
    const window = { at, windowMs: 24 * 3600 * 1000, seed: 4 };
    // A site whose longitude matches its zone, which is what parseParams hands
    // any request that names a `tz` but no `lon`.
    const brightestLocalHour = (timezone: string, offsetMinutes: number) => {
      const w = generateWindow(
        "irradiance",
        params({
          ...window,
          timezone,
          offsetMinutes,
          longitude: meridianLongitude(offsetMinutes),
        }),
      );
      const peak = w.reduce((a, b) => ((b.value as number) > (a.value as number) ? b : a));
      return localHour(peak.at, offsetMinutes);
    };
    // The shape peaks at 12h local, so the peak sits near local noon in
    // whichever zone was asked for.
    expect(brightestLocalHour("UTC", 0)).toBeGreaterThanOrEqual(10);
    expect(brightestLocalHour("UTC", 0)).toBeLessThanOrEqual(14);
    expect(brightestLocalHour("EDT", -240)).toBeGreaterThanOrEqual(10);
    expect(brightestLocalHour("EDT", -240)).toBeLessThanOrEqual(14);
    expect(brightestLocalHour("JST", 540)).toBeGreaterThanOrEqual(10);
    expect(brightestLocalHour("JST", 540)).toBeLessThanOrEqual(14);
  });

  it("shifts a schedule-driven series when the zone changes, and stays deterministic per zone", () => {
    // Occupancy runs on the local clock, so the same instant at the same site
    // lands at a different point in the working day in another zone.
    const indoor = { seed: 2, placement: "indoor" } as const;
    const utc = generateReading("air_quality", params(indoor)).value;
    const edt = generateReading(
      "air_quality",
      params({ ...indoor, timezone: "EDT", offsetMinutes: -240 }),
    ).value;
    expect(edt).not.toBe(utc);
    expect(
      generateReading(
        "air_quality",
        params({ ...indoor, timezone: "EDT", offsetMinutes: -240 }),
      ).value,
    ).toBe(edt);
  });

  it("leaves an outdoor thermometer alone when only the clock's label changes", () => {
    // The sun does not read clocks: at a fixed site and instant, relabelling the
    // zone must not move the temperature. `?tz=` still moves the *default* site
    // (see parseParams) and still renders timestamps in the zone.
    const utc = generateReading("temperature", params({ seed: 2 })).value;
    const edt = generateReading(
      "temperature",
      params({ seed: 2, timezone: "EDT", offsetMinutes: -240 }),
    ).value;
    expect(edt).toBe(utc);
  });

  it("reports the zone and an offset-carrying timestamp on a reading", () => {
    const r = generateReading(
      "temperature",
      params({ timezone: "EDT", offsetMinutes: -240 }),
    );
    expect(r.timezone).toBe("EDT");
    expect(r.timestamp).toBe("2026-07-23T10:05:00.000-04:00");
    expect(new Date(r.timestamp).getTime()).toBe(AT.getTime());
  });
});

describe("placement — indoor is damped, outdoor is exposed", () => {
  const JANUARY = new Date("2026-01-15T17:00:00Z");

  it("reads winter as winter outdoors and as a setpoint indoors", () => {
    const outdoor = generateReading("temperature", params({ at: JANUARY, seed: 3 }));
    const indoor = generateReading(
      "temperature",
      params({ at: JANUARY, seed: 3, placement: "indoor" }),
    );
    expect(outdoor.value as number).toBeLessThan(0);
    expect(indoor.value as number).toBeGreaterThan(15);
    expect(indoor.value as number).toBeLessThan(28);
  });

  it("keeps indoor light inside a lit-room range while outdoor light is daylight", () => {
    const noon = new Date("2026-07-23T17:00:00Z");
    const outdoor = generateReading("light", params({ at: noon, seed: 3 })).value as number;
    const indoor = generateReading(
      "light",
      params({ at: noon, seed: 3, placement: "indoor" }),
    ).value as number;
    expect(outdoor).toBeGreaterThan(20000);
    expect(indoor).toBeLessThan(3000);
    expect(indoor).toBeGreaterThan(100);
  });

  it("gives an indoor meter an occupied day and an exterior meter a weather-led one", () => {
    const indoor = daySeries("energy_consumption", 5, { placement: "indoor" });
    expect(meanBetween(indoor, 8, 20)).toBeGreaterThan(meanBetween(indoor, 22, 4));

    // Outdoors the day follows the weather, not the office: in July the
    // afternoon is rejecting heat, in January the night is lighting plus trace
    // heating and the mild part of the afternoon is the cheapest hour of the day.
    const july = summerDay(5);
    expect(meanAt(july, 13, 19)).toBeGreaterThan(meanAt(july, 1, 5));
    const january = winterDay(5);
    expect(meanAt(january, 22, 4)).toBeGreaterThan(meanAt(january, 13, 16));
  });

  it("never flatlines an exterior meter across a summer day", () => {
    // Regression: the exterior rule used to be a two-state square wave, so the
    // whole of a July day was one standing load plus noise — the user-visible
    // symptom was five sensors all reading a flat ~170 W from dawn to dusk.
    const daytime = summerDay(5)
      .filter((p) => p.hour >= 7 && p.hour <= 20)
      .map((p) => p.value);
    expect(Math.max(...daytime) / Math.min(...daytime)).toBeGreaterThan(2);
  });

  it("switches exterior lighting at the same time for every seed", () => {
    // Regression: energy was not solar-locked, so the per-seed phase shift moved
    // the dusk-to-dawn cliff by up to three hours between seeds.
    const duskRise = (seed: number): number => {
      const evening = summerDay(seed).filter((p) => p.hour >= 18 && p.hour <= 23.5);
      const values = evening.map((p) => p.value);
      const half = (Math.min(...values) + Math.max(...values)) / 2;
      // Local hour the evening rise passes halfway up.
      return evening.find((p) => p.value > half)?.hour ?? -1;
    };
    const hours = [1, 2, 3, 4, 5].map(duskRise);
    expect(Math.min(...hours)).toBeGreaterThan(19);
    expect(Math.max(...hours) - Math.min(...hours)).toBeLessThan(0.75);
  });

  it("dries the air out indoors in winter, the way a heated room does", () => {
    const outdoor = generateReading("humidity", params({ at: JANUARY, seed: 1 })).value as number;
    const indoor = generateReading(
      "humidity",
      params({ at: JANUARY, seed: 1, placement: "indoor" }),
    ).value as number;
    expect(indoor).toBeLessThan(outdoor);
    expect(indoor).toBeGreaterThan(0);
  });

  it("is part of the series identity: the same URL differs by placement alone", () => {
    const a = generateReading("air_quality", params({ seed: 9, placement: "indoor" })).value;
    const b = generateReading("air_quality", params({ seed: 9, placement: "outdoor" })).value;
    expect(a).not.toBe(b);
  });

  it("echoes the site and placement on a reading", () => {
    const r = generateReading(
      "temperature",
      params({ latitude: -33.87, longitude: 151.21, placement: "indoor" }),
    );
    expect(r.location).toEqual({ latitude: -33.87, longitude: 151.21 });
    expect(r.placement).toBe("indoor");
  });
});

describe("location — latitude and longitude drive the sun", () => {
  const DECEMBER_WINDOW = {
    at: new Date("2026-12-21T23:59:00Z"),
    windowMs: 24 * 3600 * 1000,
    seed: 2,
  };

  it("gives the far north a polar night and the tropics a working day", () => {
    const arctic = generateWindow(
      "irradiance",
      params({ ...DECEMBER_WINDOW, latitude: 78 }),
    ).map((p) => p.value as number);
    const tropics = generateWindow(
      "irradiance",
      params({ ...DECEMBER_WINDOW, latitude: 5 }),
    ).map((p) => p.value as number);
    expect(Math.max(...arctic)).toBeLessThan(5);
    expect(Math.max(...tropics)).toBeGreaterThan(400);
  });

  it("flips the seasons across the equator", () => {
    const july = new Date("2026-07-23T17:00:00Z");
    const north = generateReading("temperature", params({ at: july, seed: 4, latitude: 45 }));
    const south = generateReading("temperature", params({ at: july, seed: 4, latitude: -45 }));
    expect(north.value as number).toBeGreaterThan(south.value as number);
    expect(south.max as number).toBeLessThan(north.min as number);
  });

  it("moves solar noon with longitude inside a single zone", () => {
    // The centroid of the day's irradiance rather than its argmax: broken cloud
    // can dim the true peak and move the single brightest sample by an hour.
    const daylightCentroid = (longitude: number) => {
      const w = generateWindow(
        "irradiance",
        params({
          at: new Date("2026-07-27T23:59:00Z"),
          windowMs: 24 * 3600 * 1000,
          seed: 4,
          longitude,
        }),
      );
      let weighted = 0;
      let total = 0;
      for (const p of w) {
        const hour = p.at.getUTCHours() + p.at.getUTCMinutes() / 60;
        weighted += (p.value as number) * hour;
        total += p.value as number;
      }
      return weighted / total;
    };
    // 30 degrees of longitude is two hours of solar time; the east peaks earlier.
    const shift = daylightCentroid(-75) - daylightCentroid(-45);
    expect(shift).toBeGreaterThan(1.5);
    expect(shift).toBeLessThan(2.5);
  });

  it("stays deterministic per site", () => {
    const site = params({ seed: 6, latitude: 51.5, longitude: -0.13 });
    expect(generateReading("temperature", site)).toEqual(
      generateReading("temperature", site),
    );
    expect(generateReading("temperature", site).value).not.toBe(
      generateReading("temperature", params({ seed: 6, latitude: 1, longitude: -0.13 })).value,
    );
  });
});

describe("generateWindow — flow behavior preserved", () => {
  it("indoor flow is mostly zero with draw-offs through a working day", () => {
    const w = generateWindow(
      "flow",
      params({ seed: 7, windowMs: 24 * 3600 * 1000, placement: "indoor" }),
    );
    const v = w.map((p) => p.value as number);
    expect(Math.max(...v)).toBeGreaterThan(2);
    expect(v.filter((x) => x < 0.6).length).toBeGreaterThan(v.length / 3);
  });

  it("outdoor flow runs irrigation cycles and never stalls at a flat zero", () => {
    // Regression: the rule had only a pre-dawn irrigation burst, so any window
    // outside roughly 03:00–08:00 read a solid 0.00 — including every daytime
    // preview and every live tile.
    const summer = localDay("flow", 7, { ...EDT, placement: "outdoor" });
    expect(Math.max(...summer.map((p) => p.value))).toBeGreaterThan(4);
    // Two controller cycles, before dawn and after dusk.
    expect(meanAt(summer, 4, 6)).toBeGreaterThan(meanAt(summer, 8, 10));
    expect(meanAt(summer, 20, 22)).toBeGreaterThan(meanAt(summer, 16, 18));
    // Make-up water and hose draw keep the working day off the floor.
    expect(meanAt(summer, 10, 18)).toBeGreaterThan(0.3);
  });

  it("outdoor flow reads a hard zero once the line would freeze", () => {
    const winter = localDay("flow", 7, {
      ...EST,
      placement: "outdoor",
      at: new Date("2026-01-15T23:59:00Z"),
    });
    // A drained irrigation main in January is not "nearly zero", it is zero:
    // no jitter, and no phantom draw-offs either.
    expect(Math.max(...winter.map((p) => p.value))).toBe(0);
  });
});
