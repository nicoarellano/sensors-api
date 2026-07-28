import { describe, it, expect } from "vitest";
import {
  DEFAULT_TIMEZONE,
  DEFAULT_ZONE,
  TIMEZONE_ABBREVIATIONS,
  isoWithOffset,
  offsetDesignator,
  resolveTimezone,
} from "@/lib/timezones";

describe("resolveTimezone — abbreviations", () => {
  it("defaults to EDT at -4h", () => {
    expect(DEFAULT_TIMEZONE).toBe("EDT");
    expect(DEFAULT_ZONE.offsetMinutes).toBe(-240);
  });

  it("is case-insensitive and normalizes the label to upper case", () => {
    for (const raw of ["edt", "EDT", "Edt", " eDt "]) {
      expect(resolveTimezone(raw)).toEqual({ label: "EDT", offsetMinutes: -240 });
    }
  });

  it("resolves the standard/daylight pair to different offsets", () => {
    expect(resolveTimezone("EST")?.offsetMinutes).toBe(-300);
    expect(resolveTimezone("PST")?.offsetMinutes).toBe(-480);
    expect(resolveTimezone("PDT")?.offsetMinutes).toBe(-420);
    expect(resolveTimezone("CET")?.offsetMinutes).toBe(60);
    expect(resolveTimezone("JST")?.offsetMinutes).toBe(540);
  });

  it("handles half-hour zones", () => {
    expect(resolveTimezone("NST")?.offsetMinutes).toBe(-210);
    expect(resolveTimezone("ACST")?.offsetMinutes).toBe(570);
  });

  it("labels every zero-offset spelling as UTC", () => {
    expect(resolveTimezone("utc")).toEqual({ label: "UTC", offsetMinutes: 0 });
    expect(resolveTimezone("z")).toEqual({ label: "UTC", offsetMinutes: 0 });
    expect(resolveTimezone("gmt")?.offsetMinutes).toBe(0);
  });

  it("exposes a sorted abbreviation list including the default", () => {
    expect(TIMEZONE_ABBREVIATIONS).toContain("EDT");
    expect([...TIMEZONE_ABBREVIATIONS].sort()).toEqual(TIMEZONE_ABBREVIATIONS);
  });

  it("rejects unknown or empty values", () => {
    expect(resolveTimezone("XYZ")).toBeNull();
    expect(resolveTimezone("")).toBeNull();
    expect(resolveTimezone("America/Toronto")).toBeNull();
  });
});

describe("resolveTimezone — explicit offsets", () => {
  it("accepts signed offsets in several spellings", () => {
    expect(resolveTimezone("-05:00")).toEqual({ label: "UTC-05:00", offsetMinutes: -300 });
    expect(resolveTimezone("-0500")?.offsetMinutes).toBe(-300);
    expect(resolveTimezone("UTC-5")?.offsetMinutes).toBe(-300);
    expect(resolveTimezone("gmt+9")?.offsetMinutes).toBe(540);
  });

  it("accepts a + that arrived from the query string as a space", () => {
    expect(resolveTimezone("UTC 05:30")).toEqual({
      label: "UTC+05:30",
      offsetMinutes: 330,
    });
  });

  it("labels a zero explicit offset as UTC", () => {
    expect(resolveTimezone("+00:00")).toEqual({ label: "UTC", offsetMinutes: 0 });
  });

  it("rejects offsets past the ISO 8601 ±14:00 limit and bad minutes", () => {
    expect(resolveTimezone("+15:00")).toBeNull();
    expect(resolveTimezone("+14:30")).toBeNull();
    expect(resolveTimezone("-04:75")).toBeNull();
  });
});

describe("offsetDesignator", () => {
  it("uses Z at zero and a padded ±HH:MM otherwise", () => {
    expect(offsetDesignator(0)).toBe("Z");
    expect(offsetDesignator(-240)).toBe("-04:00");
    expect(offsetDesignator(330)).toBe("+05:30");
    expect(offsetDesignator(-570)).toBe("-09:30");
  });
});

describe("isoWithOffset", () => {
  it("keeps the instant but shows local wall time with the offset", () => {
    const at = new Date("2026-07-23T14:05:00Z");
    expect(isoWithOffset(at, -240)).toBe("2026-07-23T10:05:00.000-04:00");
    expect(isoWithOffset(at, 330)).toBe("2026-07-23T19:35:00.000+05:30");
    // Round-trips back to the same instant.
    expect(new Date(isoWithOffset(at, -240)).getTime()).toBe(at.getTime());
  });

  it("keeps the Z spelling at zero offset", () => {
    const at = new Date("2026-07-23T14:05:00Z");
    expect(isoWithOffset(at, 0)).toBe("2026-07-23T14:05:00.000Z");
  });

  it("rolls the date across midnight", () => {
    expect(isoWithOffset(new Date("2026-07-23T02:00:00Z"), -300)).toBe(
      "2026-07-22T21:00:00.000-05:00",
    );
  });
});
