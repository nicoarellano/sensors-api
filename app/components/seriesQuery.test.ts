import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONTROLS,
  isCompleteInstant,
  parseCsv,
  seedsOf,
  seriesUrl,
  shortTime,
  type Controls,
} from "./seriesQuery";

function controls(overrides: Partial<Controls> = {}): Controls {
  return { ...DEFAULT_CONTROLS, ...overrides };
}

/**
 * The query of a built URL. Parsed rather than substring-matched: `format=csv`
 * contains "at=", so asserting on the raw string quietly passes or quietly fails.
 */
function queryOf(url: string): URLSearchParams {
  return new URL(url, "http://x").searchParams;
}

describe("seriesUrl", () => {
  it("carries every control the API needs to reproduce the chart", () => {
    const url = new URL(seriesUrl("flow", controls({ seed: 3 }), 3), "http://x");
    expect(url.pathname).toBe("/api/sensor/flow");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: "csv",
      window: "24h",
      seed: "3",
      lat: "45",
      lon: "-75",
      tz: "EDT",
      placement: "outdoor",
    });
  });

  it("omits the optional parameters rather than sending them blank", () => {
    // An empty `at` or `min` is a 400, not a default.
    const query = queryOf(seriesUrl("temperature", controls({ at: "", min: "", max: "" }), 0));
    expect(query.has("at")).toBe(false);
    expect(query.has("min")).toBe(false);
    expect(query.has("max")).toBe(false);
  });

  it("sends min, max and at once they are given", () => {
    const query = queryOf(
      seriesUrl("temperature", controls({ at: "2026-01-15T12:00", min: "-20", max: "50" }), 0),
    );
    expect(query.get("at")).toBe("2026-01-15T12:00");
    expect(query.get("min")).toBe("-20");
    expect(query.get("max")).toBe("50");
  });

  it("holds back a half-typed instant", () => {
    // A datetime-local input reports its partial state while it is being typed,
    // and half a date would be a 400 on every sensor on the page at once.
    for (const partial of ["2026", "2026-01", "2026-01-1", "11520-02-06T12:00", "x"]) {
      expect(isCompleteInstant(partial)).toBe(false);
      expect(queryOf(seriesUrl("flow", controls({ at: partial }), 0)).has("at")).toBe(false);
    }
    expect(isCompleteInstant("2026-01-15T12:00")).toBe(true);
  });

  it("names the seed it was asked for, not the one in the controls", () => {
    // Overlaid series share one control set and differ only by seed.
    expect(queryOf(seriesUrl("flow", controls({ seed: 1 }), 4)).get("seed")).toBe("4");
  });
});

describe("seedsOf", () => {
  it("counts up from the chosen seed", () => {
    expect(seedsOf(controls({ seed: 7, seeds: 3 }))).toEqual([7, 8, 9]);
    expect(seedsOf(controls({ seed: 0, seeds: 1 }))).toEqual([0]);
  });
});

describe("parseCsv", () => {
  it("reads header-less time,value rows and drops anything unparseable", () => {
    expect(parseCsv("10:00:00,1.5\n10:00:05,2\n\nbroken,\n")).toEqual([
      { time: "10:00:00", value: 1.5 },
      { time: "10:00:05", value: 2 },
    ]);
  });

  it("keeps a genuine zero", () => {
    // A drained irrigation main reads 0, and 0 must not be filtered as falsy.
    expect(parseCsv("5:00:00,0")).toEqual([{ time: "5:00:00", value: 0 }]);
  });
});

describe("shortTime", () => {
  it("trims seconds off an axis label", () => {
    expect(shortTime("9:05:30")).toBe("9:05");
    expect(shortTime("21:05")).toBe("21:05");
  });
});
