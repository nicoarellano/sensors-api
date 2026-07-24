import { describe, it, expect } from "vitest";
import { parseParams } from "@/lib/params";

const NOW = new Date("2026-07-23T12:00:00Z");

function parse(qs: string) {
  return parseParams(new URLSearchParams(qs), NOW);
}

describe("parseParams — defaults", () => {
  it("defaults to seed 0, now, csv format, no window overrides", () => {
    const r = parse("");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.seed).toBe(0);
    expect(r.value.at.toISOString()).toBe(NOW.toISOString());
    expect(r.value.format).toBe("csv");
    expect(r.value.points).toBeUndefined();
    expect(r.value.windowMs).toBeUndefined();
    expect(r.value.min).toBeUndefined();
    expect(r.value.max).toBeUndefined();
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
