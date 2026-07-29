import { describe, it, expect } from "vitest";
import { climate, cloudCover, cloudTransmittance, sunState } from "@/lib/solar";

/** Day of year for a UTC calendar date, matching lib/timezones.localParts. */
function dayOfYear(year: number, month: number, day: number): number {
  const yearStart = Date.UTC(year, 0, 1);
  return Math.floor((Date.UTC(year, month - 1, day) - yearStart) / 86400000) + 1;
}

const OTTAWA = { latitude: 45.42, longitude: -75.7, offsetMinutes: -240 };
const JULY_28 = dayOfYear(2026, 7, 28);
const DEC_21 = dayOfYear(2026, 12, 21);
const MAR_20 = dayOfYear(2026, 3, 20);

describe("sunState — spot-checked against Ottawa on 2026-07-28", () => {
  const sun = sunState(
    JULY_28,
    13,
    OTTAWA.latitude,
    OTTAWA.longitude,
    OTTAWA.offsetMinutes,
  );

  it("puts solar noon a few minutes after 13:00 EDT", () => {
    // Actual 13:11; the low-precision NOAA series lands within a couple minutes.
    expect(sun.solarNoonHour).toBeGreaterThan(13.0);
    expect(sun.solarNoonHour).toBeLessThan(13.3);
  });

  it("sets sunset just after 20:30 EDT", () => {
    expect(sun.sunsetHour).not.toBeNull();
    expect(sun.sunsetHour as number).toBeGreaterThan(20.5);
    expect(sun.sunsetHour as number).toBeLessThan(20.8);
  });

  it("peaks near 64 degrees of elevation", () => {
    const noon = sunState(
      JULY_28,
      sun.solarNoonHour,
      OTTAWA.latitude,
      OTTAWA.longitude,
      OTTAWA.offsetMinutes,
    );
    expect(noon.elevationDeg).toBeGreaterThan(63);
    expect(noon.elevationDeg).toBeLessThan(65);
    expect(noon.isDaylight).toBe(true);
  });

  it("gives a clear-sky GHI around 920 W/m² at noon", () => {
    const noon = sunState(
      JULY_28,
      sun.solarNoonHour,
      OTTAWA.latitude,
      OTTAWA.longitude,
      OTTAWA.offsetMinutes,
    );
    expect(noon.clearSkyGhi).toBeGreaterThan(890);
    expect(noon.clearSkyGhi).toBeLessThan(960);
  });

  it("runs a long summer day and a short winter one", () => {
    const winter = sunState(
      DEC_21,
      12,
      OTTAWA.latitude,
      OTTAWA.longitude,
      OTTAWA.offsetMinutes,
    );
    expect(sun.dayLengthHours).toBeGreaterThan(14);
    expect(winter.dayLengthHours).toBeLessThan(9);
  });
});

describe("sunState — geometry that must hold anywhere", () => {
  it("is dark at night and lit at midday", () => {
    const night = sunState(JULY_28, 2, 45, -75, -240);
    expect(night.isDaylight).toBe(false);
    expect(night.clearSkyGhi).toBe(0);
    expect(night.sinElevation).toBe(0);
    expect(night.twilight).toBe(0);
  });

  it("splits the equinox into roughly twelve hours of daylight at any latitude", () => {
    for (const latitude of [0, 25, 45, 60]) {
      const sun = sunState(MAR_20, 12, latitude, 0, 0);
      expect(sun.dayLengthHours).toBeGreaterThan(11.7);
      expect(sun.dayLengthHours).toBeLessThan(12.4);
    }
  });

  it("reports polar night and polar day inside the Arctic Circle", () => {
    const polarNight = sunState(DEC_21, 12, 78, 15, 60);
    expect(polarNight.dayLengthHours).toBe(0);
    expect(polarNight.sunriseHour).toBeNull();
    expect(polarNight.clearSkyGhi).toBe(0);

    const polarDay = sunState(JULY_28, 0, 78, 15, 60);
    expect(polarDay.dayLengthHours).toBe(24);
    expect(polarDay.sunsetHour).toBeNull();
    expect(polarDay.isDaylight).toBe(true);
  });

  it("flips the seasons in the southern hemisphere", () => {
    const north = sunState(DEC_21, 12, 45, 0, 0);
    const south = sunState(DEC_21, 12, -45, 0, 0);
    expect(south.dayLengthHours).toBeGreaterThan(north.dayLengthHours);
  });

  it("keeps twilight between full daylight and true night", () => {
    // Dusk in Ottawa in July: past sunset, before the sky is black.
    const dusk = sunState(JULY_28, 21, OTTAWA.latitude, OTTAWA.longitude, -240);
    expect(dusk.isDaylight).toBe(false);
    expect(dusk.twilight).toBeGreaterThan(0);
    expect(dusk.twilight).toBeLessThan(1);
  });
});

describe("cloudCover and transmittance", () => {
  it("stays a fraction and is deterministic per seed and instant", () => {
    const at = new Date("2026-07-23T14:05:00Z");
    for (const seed of [0, 1, 42, 7]) {
      const c = cloudCover(seed, at);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
      expect(cloudCover(seed, at)).toBe(c);
    }
    expect(cloudCover(1, at)).not.toBe(cloudCover(2, at));
  });

  it("drifts smoothly rather than jumping between readings", () => {
    const t0 = new Date("2026-07-23T14:05:00Z").getTime();
    let previous = cloudCover(3, new Date(t0));
    for (let m = 5; m <= 120; m += 5) {
      const next = cloudCover(3, new Date(t0 + m * 60000));
      expect(Math.abs(next - previous)).toBeLessThan(0.1);
      previous = next;
    }
  });

  it("passes everything under a clear sky and ~25% under full overcast", () => {
    expect(cloudTransmittance(0)).toBe(1);
    expect(cloudTransmittance(1)).toBeCloseTo(0.25, 5);
    expect(cloudTransmittance(0.5)).toBeGreaterThan(cloudTransmittance(0.9));
  });
});

describe("climate — latitude and season", () => {
  it("makes July warm and January cold at mid-latitude", () => {
    const july = climate(JULY_28, 45, 0.45);
    const january = climate(dayOfYear(2026, 1, 15), 45, 0.45);
    expect(july.meanC).toBeGreaterThan(18);
    expect(january.meanC).toBeLessThan(0);
    expect(july.summerness).toBeGreaterThan(0.9);
    expect(january.summerness).toBeLessThan(0.1);
  });

  it("cools with latitude and swings harder away from the equator", () => {
    const tropics = climate(JULY_28, 5, 0.45);
    const temperate = climate(JULY_28, 45, 0.45);
    expect(tropics.meanC).toBeGreaterThan(temperate.meanC);
    const tropicalWinter = climate(dayOfYear(2026, 1, 15), 5, 0.45);
    expect(Math.abs(tropics.meanC - tropicalWinter.meanC)).toBeLessThan(
      Math.abs(temperate.meanC - climate(dayOfYear(2026, 1, 15), 45, 0.45).meanC),
    );
  });

  it("flattens the diurnal range under overcast", () => {
    expect(climate(JULY_28, 45, 1).diurnalRangeC).toBeLessThan(
      climate(JULY_28, 45, 0).diurnalRangeC,
    );
  });

  it("keeps the dew point below the day's minimum", () => {
    const c = climate(JULY_28, 45, 0.5);
    expect(c.dewPointC).toBeLessThan(c.meanC - c.diurnalRangeC / 2);
  });

  it("puts the southern hemisphere's summer in January", () => {
    expect(climate(dayOfYear(2026, 1, 15), -35, 0.45).summerness).toBeGreaterThan(0.9);
  });
});
