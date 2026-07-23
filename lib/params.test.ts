import { describe, it, expect } from "vitest";
import { parseParams } from "@/lib/params";

const NOW = new Date("2026-07-23T12:00:00Z");

function parse(qs: string) {
  return parseParams(new URLSearchParams(qs), NOW);
}

describe("parseParams — defaults", () => {
  it("uses seed 0, now, no series, no min/max override when empty", () => {
    const r = parse("");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.seed).toBe(0);
    expect(r.value.at.toISOString()).toBe(NOW.toISOString());
    expect(r.value.series).toBe(false);
    expect(r.value.min).toBeUndefined();
    expect(r.value.max).toBeUndefined();
  });
});

describe("parseParams — seed", () => {
  it("parses an integer seed", () => {
    const r = parse("seed=7");
    expect(r.ok && r.value.seed).toBe(7);
  });

  it("rejects a non-numeric seed", () => {
    const r = parse("seed=abc");
    expect(r.ok).toBe(false);
  });
});

describe("parseParams — min/max", () => {
  it("parses both", () => {
    const r = parse("min=-20&max=50");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.min).toBe(-20);
    expect(r.value.max).toBe(50);
  });

  it("parses only max (one-sided)", () => {
    const r = parse("max=20");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.min).toBeUndefined();
    expect(r.value.max).toBe(20);
  });

  it("rejects a non-numeric min", () => {
    expect(parse("min=foo").ok).toBe(false);
  });

  it("rejects min greater than max", () => {
    const r = parse("min=50&max=10");
    expect(r.ok).toBe(false);
  });

  it("accepts min equal to max", () => {
    expect(parse("min=10&max=10").ok).toBe(true);
  });
});

describe("parseParams — at", () => {
  it("parses a valid ISO timestamp", () => {
    const r = parse("at=2026-07-23T14:05:00Z");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.at.toISOString()).toBe("2026-07-23T14:05:00.000Z");
  });

  it("rejects an invalid timestamp", () => {
    expect(parse("at=not-a-date").ok).toBe(false);
  });
});

describe("parseParams — series", () => {
  it("treats series=1 as true", () => {
    const r = parse("series=1");
    expect(r.ok && r.value.series).toBe(true);
  });

  it("treats a bare series flag as true", () => {
    const r = parse("series");
    expect(r.ok && r.value.series).toBe(true);
  });

  it("treats series=0 and series=false as false", () => {
    expect(parse("series=0").ok && (parse("series=0") as { value: { series: boolean } }).value.series).toBe(false);
    const r = parse("series=false");
    expect(r.ok && r.value.series).toBe(false);
  });
});
