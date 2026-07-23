import { describe, it, expect } from "vitest";
import { mulberry32, hashString, mixSeed } from "@/lib/prng";

describe("mulberry32", () => {
  it("produces values in [0, 1)", () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toEqual(b());
  });
});

describe("hashString", () => {
  it("is deterministic", () => {
    expect(hashString("temperature")).toEqual(hashString("temperature"));
  });

  it("differs for different strings", () => {
    expect(hashString("temperature")).not.toEqual(hashString("humidity"));
  });

  it("returns a non-negative 32-bit integer", () => {
    const h = hashString("flow");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("mixSeed", () => {
  it("is deterministic and order-sensitive", () => {
    expect(mixSeed(1, 2, 3)).toEqual(mixSeed(1, 2, 3));
    expect(mixSeed(1, 2, 3)).not.toEqual(mixSeed(3, 2, 1));
  });

  it("returns a 32-bit unsigned integer", () => {
    const s = mixSeed(7, 999999, 42);
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
  });
});
