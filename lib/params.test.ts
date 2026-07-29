import { describe, it, expect } from "vitest";
import { parseParams } from "@/lib/params";

const NOW = new Date("2026-07-23T12:00:00Z");

function parse(qs: string) {
  return parseParams(new URLSearchParams(qs), NOW);
}

describe("parseParams — defaults", () => {
  it("defaults to seed 0, now, sta format, EDT, no window overrides", () => {
    const r = parse("");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.seed).toBe(0);
    expect(r.value.at.toISOString()).toBe(NOW.toISOString());
    expect(r.value.format).toBe("sta");
    expect(r.value.timezone).toBe("EDT");
    expect(r.value.offsetMinutes).toBe(-240);
    expect(r.value.points).toBeUndefined();
    expect(r.value.windowMs).toBeUndefined();
    expect(r.value.min).toBeUndefined();
    expect(r.value.max).toBeUndefined();
  });

  it("defaults to the reference site, exposed to the sky", () => {
    const r = parse("");
    expect(r.ok && r.value.latitude).toBe(45);
    expect(r.ok && r.value.longitude).toBe(-75);
    expect(r.ok && r.value.placement).toBe("outdoor");
  });
});

describe("parseParams — lat / lon", () => {
  it("parses a site, with aliases", () => {
    const r = parse("lat=48.86&lon=2.35");
    expect(r.ok && r.value.latitude).toBe(48.86);
    expect(r.ok && r.value.longitude).toBe(2.35);
    expect(parse("latitude=-33.87").ok && (parse("latitude=-33.87") as { value: { latitude: number } }).value.latitude).toBe(-33.87);
    expect(parse("lng=151.21").ok && (parse("lng=151.21") as { value: { longitude: number } }).value.longitude).toBe(151.21);
  });

  it("rejects out-of-range or non-numeric coordinates", () => {
    expect(parse("lat=91").ok).toBe(false);
    expect(parse("lat=-91").ok).toBe(false);
    expect(parse("lat=north").ok).toBe(false);
    expect(parse("lon=181").ok).toBe(false);
    expect(parse("lon=-181").ok).toBe(false);
    expect(parse("lon=west").ok).toBe(false);
  });

  it("accepts the poles and the antimeridian", () => {
    expect(parse("lat=90&lon=180").ok).toBe(true);
    expect(parse("lat=-90&lon=-180").ok).toBe(true);
  });

  it("falls back to a zone's central meridian when only tz is given", () => {
    // Without a longitude, a JST series would otherwise be lit at midnight.
    const jst = parse("tz=JST");
    expect(jst.ok && jst.value.longitude).toBe(135);
    const pst = parse("tz=PST");
    expect(pst.ok && pst.value.longitude).toBe(-120);
    // The reference site stands in for its own zone.
    expect(parse("tz=EDT").ok && (parse("tz=EDT") as { value: { longitude: number } }).value.longitude).toBe(-75);
  });

  it("prefers an explicit longitude over the meridian fallback", () => {
    const r = parse("tz=JST&lon=139.69&lat=35.69");
    expect(r.ok && r.value.longitude).toBe(139.69);
    expect(r.ok && r.value.latitude).toBe(35.69);
  });
});

describe("parseParams — placement", () => {
  it("accepts indoor and outdoor in any case", () => {
    expect(parse("placement=indoor").ok && (parse("placement=indoor") as { value: { placement: string } }).value.placement).toBe("indoor");
    expect(parse("placement=OUTDOOR").ok && (parse("placement=OUTDOOR") as { value: { placement: string } }).value.placement).toBe("outdoor");
    expect(parse("placement=Indoor").ok && (parse("placement=Indoor") as { value: { placement: string } }).value.placement).toBe("indoor");
  });

  it("rejects anything else with a message naming the two options", () => {
    const r = parse("placement=roof");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("indoor");
    expect(!r.ok && r.error).toContain("outdoor");
  });
});

describe("parseParams — seed / min / max / at", () => {
  it("parses seed", () => {
    expect(parse("seed=7").ok && (parse("seed=7") as { value: { seed: number } }).value.seed).toBe(7);
  });
  it("rejects non-numeric seed", () => {
    expect(parse("seed=abc").ok).toBe(false);
  });
  it("parses both min and max", () => {
    const r = parse("min=-20&max=50");
    expect(r.ok && r.value.min).toBe(-20);
    expect(r.ok && r.value.max).toBe(50);
  });
  it("rejects min>max and non-numeric min", () => {
    expect(parse("min=50&max=10").ok).toBe(false);
    expect(parse("min=foo").ok).toBe(false);
  });
  it("parses valid at and rejects invalid at", () => {
    const r = parse("at=2026-07-23T14:05:00Z");
    expect(r.ok && r.value.at.toISOString()).toBe("2026-07-23T14:05:00.000Z");
    expect(parse("at=not-a-date").ok).toBe(false);
  });

  it("reads an at without a zone designator in the requested timezone", () => {
    // 14:05 EDT is 18:05Z.
    const edt = parse("at=2026-07-23T14:05:00");
    expect(edt.ok && edt.value.at.toISOString()).toBe("2026-07-23T18:05:00.000Z");
    const jst = parse("at=2026-07-23T14:05:00&tz=JST");
    expect(jst.ok && jst.value.at.toISOString()).toBe("2026-07-23T05:05:00.000Z");
    // Date-only means local midnight in that zone.
    const day = parse("at=2026-07-23&tz=UTC");
    expect(day.ok && day.value.at.toISOString()).toBe("2026-07-23T00:00:00.000Z");
  });

  it("respects an explicit zone designator on at over tz", () => {
    const r = parse("at=2026-07-23T14:05:00Z&tz=PDT");
    expect(r.ok && r.value.at.toISOString()).toBe("2026-07-23T14:05:00.000Z");
    expect(r.ok && r.value.timezone).toBe("PDT");
  });
});

describe("parseParams — tz", () => {
  it("accepts an abbreviation in any case", () => {
    for (const qs of ["tz=edt", "tz=EDT", "tz=Edt"]) {
      const r = parse(qs);
      expect(r.ok && r.value.timezone).toBe("EDT");
      expect(r.ok && r.value.offsetMinutes).toBe(-240);
    }
  });

  it("accepts the timezone alias, lower or upper case", () => {
    expect(parse("timezone=edt").ok && (parse("timezone=edt") as { value: { timezone: string } }).value.timezone).toBe("EDT");
    const pst = parse("timezone=PST");
    expect(pst.ok && pst.value.offsetMinutes).toBe(-480);
  });

  it("prefers tz when both spellings are present", () => {
    const r = parse("tz=UTC&timezone=PST");
    expect(r.ok && r.value.timezone).toBe("UTC");
  });

  it("accepts an explicit offset", () => {
    const r = parse("tz=UTC-05:00");
    expect(r.ok && r.value.timezone).toBe("UTC-05:00");
    expect(r.ok && r.value.offsetMinutes).toBe(-300);
  });

  it("rejects an unknown zone with a 400-able error listing the abbreviations", () => {
    const r = parse("tz=Mars");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("EDT");
  });
});

describe("parseParams — format", () => {
  it("accepts csv, sta, dataArray, reading (case-insensitive)", () => {
    expect(parse("format=csv").ok && (parse("format=csv") as { value: { format: string } }).value.format).toBe("csv");
    expect(parse("format=sta").ok && (parse("format=sta") as { value: { format: string } }).value.format).toBe("sta");
    expect(parse("format=dataArray").ok && (parse("format=dataArray") as { value: { format: string } }).value.format).toBe("dataArray");
    expect(parse("format=DATAARRAY").ok && (parse("format=DATAARRAY") as { value: { format: string } }).value.format).toBe("dataArray");
    expect(parse("format=reading").ok && (parse("format=reading") as { value: { format: string } }).value.format).toBe("reading");
  });
  it("rejects an unknown format", () => {
    expect(parse("format=xml").ok).toBe(false);
  });
});

describe("parseParams — points", () => {
  it("parses a positive integer", () => {
    expect(parse("points=50").ok && (parse("points=50") as { value: { points: number } }).value.points).toBe(50);
  });
  it("caps at 1000", () => {
    expect(parse("points=99999").ok && (parse("points=99999") as { value: { points: number } }).value.points).toBe(1000);
  });
  it("rejects non-integer or < 1", () => {
    expect(parse("points=abc").ok).toBe(false);
    expect(parse("points=0").ok).toBe(false);
    expect(parse("points=-5").ok).toBe(false);
    expect(parse("points=1.5").ok).toBe(false);
  });
});

describe("parseParams — window", () => {
  it("parses unit suffixes into milliseconds", () => {
    expect(parse("window=24h").ok && (parse("window=24h") as { value: { windowMs: number } }).value.windowMs).toBe(24 * 3600 * 1000);
    expect(parse("window=90m").ok && (parse("window=90m") as { value: { windowMs: number } }).value.windowMs).toBe(90 * 60 * 1000);
    expect(parse("window=30s").ok && (parse("window=30s") as { value: { windowMs: number } }).value.windowMs).toBe(30 * 1000);
    expect(parse("window=1500ms").ok && (parse("window=1500ms") as { value: { windowMs: number } }).value.windowMs).toBe(1500);
  });
  it("treats a bare number as seconds", () => {
    expect(parse("window=120").ok && (parse("window=120") as { value: { windowMs: number } }).value.windowMs).toBe(120 * 1000);
  });
  it("rejects malformed or non-positive windows", () => {
    expect(parse("window=abc").ok).toBe(false);
    expect(parse("window=0").ok).toBe(false);
    expect(parse("window=10y").ok).toBe(false);
  });
});
