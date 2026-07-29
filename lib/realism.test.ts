import { describe, it, expect } from "vitest";
import {
  DEFAULT_PLACEMENT,
  REFERENCE_SITE,
  airTemp,
  electricLighting,
  hvacDemand,
  indoorAirTemp,
  indoorIlluminance,
  occupancy,
  outdoorAirTemp,
  outdoorIlluminance,
  relativeHumidity,
  setpointC,
  shapeContext,
  traffic,
} from "@/lib/realism";
import type { Placement, SensorParams, ShapeContext } from "@/lib/types";

/** Params at the reference site, timed in EDT — the API's own defaults. */
function params(overrides: Partial<SensorParams> = {}): SensorParams {
  return {
    seed: 0,
    at: new Date("2026-07-23T16:00:00Z"),
    format: "sta",
    timezone: "EDT",
    offsetMinutes: -240,
    latitude: REFERENCE_SITE.latitude,
    longitude: REFERENCE_SITE.longitude,
    placement: DEFAULT_PLACEMENT,
    ...overrides,
  };
}

/** Context at a local (EDT) hour on a given date, at the reference site. */
function ctxAt(
  iso: string,
  localHour: number,
  overrides: Partial<SensorParams> = {},
): ShapeContext {
  // EDT is UTC-4, so a local hour is that many hours past local midnight, which
  // is 04:00Z. Fractional hours are allowed (12.5 is half past noon).
  const at = new Date(
    Date.parse(`${iso}T00:00:00Z`) + (localHour + 4) * 3600000,
  );
  return shapeContext(params({ at, ...overrides }), at);
}

/** Every local hour of a day, as contexts. */
function dayOfContexts(iso: string, overrides: Partial<SensorParams> = {}) {
  return Array.from({ length: 24 }, (_, h) => ctxAt(iso, h, overrides));
}

const SUMMER = "2026-07-23";
const WINTER = "2026-01-15";

describe("defaults", () => {
  it("is the Ottawa reference site, exposed to the sky", () => {
    expect(REFERENCE_SITE).toEqual({ latitude: 45, longitude: -75 });
    expect(DEFAULT_PLACEMENT).toBe<Placement>("outdoor");
  });
});

describe("outdoorAirTemp", () => {
  it("reads the season: below freezing in January, warm in July", () => {
    const july = dayOfContexts(SUMMER).map(outdoorAirTemp);
    const january = dayOfContexts(WINTER).map(outdoorAirTemp);
    expect(Math.max(...july)).toBeGreaterThan(20);
    expect(Math.min(...july)).toBeGreaterThan(8);
    expect(Math.max(...january)).toBeLessThan(5);
    expect(Math.min(...january)).toBeLessThan(-5);
  });

  it("peaks mid-afternoon and bottoms out before dawn", () => {
    const day = dayOfContexts(SUMMER).map(outdoorAirTemp);
    const warmest = day.indexOf(Math.max(...day));
    const coldest = day.indexOf(Math.min(...day));
    expect(warmest).toBeGreaterThanOrEqual(14);
    expect(warmest).toBeLessThanOrEqual(18);
    expect(coldest).toBeLessThanOrEqual(6);
  });

  it("is continuous across midnight", () => {
    const midnight = new Date("2026-07-24T04:00:00Z").getTime(); // 00:00 EDT
    let previous = outdoorAirTemp(shapeContext(params(), new Date(midnight - 600000)));
    for (let m = -5; m <= 5; m++) {
      const next = outdoorAirTemp(
        shapeContext(params(), new Date(midnight + m * 300000)),
      );
      expect(Math.abs(next - previous)).toBeLessThan(0.5);
      previous = next;
    }
  });

  it("gets colder with latitude in the same month", () => {
    const ottawa = outdoorAirTemp(ctxAt(WINTER, 14));
    const arctic = outdoorAirTemp(ctxAt(WINTER, 14, { latitude: 70 }));
    expect(arctic).toBeLessThan(ottawa);
  });
});

describe("indoorAirTemp", () => {
  it("holds near the setpoint in both seasons while outdoors swings 30 degrees", () => {
    const summer = dayOfContexts(SUMMER).map(indoorAirTemp);
    const winter = dayOfContexts(WINTER).map(indoorAirTemp);
    for (const t of [...summer, ...winter]) {
      expect(t).toBeGreaterThan(16);
      expect(t).toBeLessThan(29);
    }
    // The outdoor series over the same two days spans far more than that.
    const outdoor = [...dayOfContexts(SUMMER), ...dayOfContexts(WINTER)].map(
      outdoorAirTemp,
    );
    expect(Math.max(...outdoor) - Math.min(...outdoor)).toBeGreaterThan(30);
  });

  it("is damped: a much smaller swing indoors than outdoors on the same day", () => {
    const day = dayOfContexts(SUMMER);
    const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
    expect(spread(day.map(indoorAirTemp))).toBeLessThan(spread(day.map(outdoorAirTemp)));
  });

  it("cools to a cooling setpoint in summer and heats to a heating one in winter", () => {
    expect(setpointC(ctxAt(SUMMER, 12))).toBeGreaterThan(setpointC(ctxAt(WINTER, 12)));
  });

  it("is what airTemp reports for an indoor sensor", () => {
    const indoor = ctxAt(SUMMER, 14, { placement: "indoor" });
    const outdoor = ctxAt(SUMMER, 14);
    expect(airTemp(indoor)).toBe(indoorAirTemp(indoor));
    expect(airTemp(outdoor)).toBe(outdoor.outdoorC);
  });
});

describe("relativeHumidity", () => {
  it("is 100% at the dew point and falls as the air warms", () => {
    expect(relativeHumidity(10, 10)).toBeCloseTo(100, 5);
    expect(relativeHumidity(20, 10)).toBeLessThan(60);
    expect(relativeHumidity(30, 10)).toBeLessThan(relativeHumidity(20, 10));
  });

  it("stays a percentage even when the air is warmed far past its dew point", () => {
    // A heated room in January: dry, but not negative or absurd.
    const rh = relativeHumidity(21, -20);
    expect(rh).toBeGreaterThan(0);
    expect(rh).toBeLessThan(15);
  });
});

describe("illuminance", () => {
  it("runs from moonlight at night to tens of thousands of lux at noon", () => {
    expect(outdoorIlluminance(ctxAt(SUMMER, 2))).toBeLessThan(1);
    expect(outdoorIlluminance(ctxAt(SUMMER, 13))).toBeGreaterThan(20000);
  });

  it("keeps an indoor space in the hundreds-to-low-thousands of lux", () => {
    const day = dayOfContexts(SUMMER, { placement: "indoor" }).map(indoorIlluminance);
    const occupiedDay = dayOfContexts(SUMMER, { placement: "indoor" })
      .filter((c) => occupancy(c) > 0.5)
      .map(indoorIlluminance);
    expect(Math.max(...day)).toBeLessThan(3000);
    // Never dark while people are in the room.
    expect(Math.min(...occupiedDay)).toBeGreaterThan(150);
  });

  it("turns the lights on when daylight runs out and the room is occupied", () => {
    // A January evening: occupied, and long past sunset at 45 N.
    const winterEvening = ctxAt(WINTER, 17, { placement: "indoor" });
    const summerNoon = ctxAt(SUMMER, 13, { placement: "indoor" });
    const emptyNight = ctxAt(WINTER, 3, { placement: "indoor" });
    expect(electricLighting(winterEvening)).toBeGreaterThan(0.3);
    expect(electricLighting(summerNoon)).toBeLessThan(0.1);
    expect(electricLighting(emptyNight)).toBe(0);
  });
});

describe("schedules", () => {
  it("fills the building on a weekday and leaves it nearly empty at night", () => {
    // 2026-07-23 is a Thursday.
    expect(occupancy(ctxAt(SUMMER, 11))).toBeGreaterThan(0.8);
    expect(occupancy(ctxAt(SUMMER, 3))).toBe(0);
    expect(occupancy(ctxAt(SUMMER, 21))).toBe(0);
  });

  it("is much quieter on a weekend", () => {
    // 2026-07-25 is a Saturday.
    const saturday = ctxAt("2026-07-25", 11);
    expect(saturday.isWeekend).toBe(true);
    expect(occupancy(saturday)).toBeLessThan(0.25);
    expect(occupancy(saturday)).toBeGreaterThan(0);
  });

  it("dips at lunch without emptying the building", () => {
    const lunch = occupancy(ctxAt(SUMMER, 12.5));
    const midMorning = occupancy(ctxAt(SUMMER, 10));
    expect(lunch).toBeLessThan(midMorning);
    expect(lunch).toBeGreaterThan(0.5);
  });

  it("peaks street activity at the commute, not at 3am", () => {
    expect(traffic(ctxAt(SUMMER, 8))).toBeGreaterThan(traffic(ctxAt(SUMMER, 3)));
    expect(traffic(ctxAt(SUMMER, 17))).toBeGreaterThan(traffic(ctxAt(SUMMER, 12)));
    expect(traffic(ctxAt(SUMMER, 3))).toBeLessThan(0.2);
  });

  it("works the HVAC hardest in the cold, and eases off in an empty building", () => {
    const winterOccupied = hvacDemand(ctxAt(WINTER, 11, { placement: "indoor" }));
    const winterEmpty = hvacDemand(ctxAt(WINTER, 3, { placement: "indoor" }));
    const mildOccupied = hvacDemand(ctxAt("2026-05-10", 11, { placement: "indoor" }));
    expect(winterOccupied).toBeGreaterThan(winterEmpty);
    expect(winterOccupied).toBeGreaterThan(mildOccupied);
    for (const d of [winterOccupied, winterEmpty, mildOccupied]) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });
});

describe("shapeContext", () => {
  it("reads the calendar in the requested zone, not the server's", () => {
    // 04:00Z on the 24th is 00:00 EDT on the 24th, still hour 0 of that day.
    const ctx = shapeContext(params(), new Date("2026-07-24T04:00:00Z"));
    expect(ctx.hour).toBe(0);
    expect(ctx.dayOfYear).toBe(205);
  });

  it("carries the site, placement and weather every rule shares", () => {
    const ctx = shapeContext(
      params({ latitude: 51.5, longitude: -0.13, placement: "indoor" }),
      new Date("2026-07-23T12:00:00Z"),
    );
    expect(ctx.latitude).toBe(51.5);
    expect(ctx.longitude).toBe(-0.13);
    expect(ctx.placement).toBe("indoor");
    expect(ctx.cloud).toBeGreaterThanOrEqual(0);
    expect(ctx.cloud).toBeLessThanOrEqual(1);
    expect(ctx.outdoorC).toBe(outdoorAirTemp(ctx));
  });

  it("is deterministic for a site and instant", () => {
    const at = new Date("2026-07-23T12:00:00Z");
    expect(shapeContext(params({ seed: 4 }), at)).toEqual(
      shapeContext(params({ seed: 4 }), at),
    );
  });
});
