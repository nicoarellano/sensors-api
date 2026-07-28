// Timezone handling for the `?tz=` query parameter.
//
// Zones are named by abbreviation and resolved to a *fixed* offset from UTC.
// An abbreviation already names one side of the DST fence (EST vs EDT), so
// there are no transition rules to apply and a generated series stays
// deterministic: the same URL always yields the same values. Pick the
// abbreviation for the season you are demoing.
//
// Some abbreviations are ambiguous in the wild. This table takes the North
// American reading of `CST`/`CDT` (US Central, not China Standard) and omits
// `IST` entirely (Indian vs Irish vs Israel). For anything ambiguous or
// missing, pass an explicit offset instead: `tz=UTC+05:30`, `tz=+0530`,
// `tz=-04:00`.

/** Timezone used when the request does not pick one. */
export const DEFAULT_TIMEZONE = "EDT";

const H = 60;

/** Abbreviation -> fixed offset from UTC, in minutes. */
const OFFSETS: Record<string, number> = {
  // Zero-offset spellings
  UTC: 0,
  UT: 0,
  GMT: 0,
  Z: 0,
  WET: 0,
  // North America
  NST: -3.5 * H,
  NDT: -2.5 * H,
  AST: -4 * H,
  ADT: -3 * H,
  EST: -5 * H,
  EDT: -4 * H,
  CST: -6 * H,
  CDT: -5 * H,
  MST: -7 * H,
  MDT: -6 * H,
  PST: -8 * H,
  PDT: -7 * H,
  AKST: -9 * H,
  AKDT: -8 * H,
  HST: -10 * H,
  HDT: -9 * H,
  // South America
  BRT: -3 * H,
  ART: -3 * H,
  CLT: -4 * H,
  CLST: -3 * H,
  // Europe / Africa
  WEST: 1 * H,
  BST: 1 * H,
  CET: 1 * H,
  CEST: 2 * H,
  EET: 2 * H,
  EEST: 3 * H,
  SAST: 2 * H,
  EAT: 3 * H,
  MSK: 3 * H,
  // Asia
  GST: 4 * H,
  PKT: 5 * H,
  ICT: 7 * H,
  WIB: 7 * H,
  HKT: 8 * H,
  SGT: 8 * H,
  JST: 9 * H,
  KST: 9 * H,
  // Oceania
  AWST: 8 * H,
  ACST: 9.5 * H,
  ACDT: 10.5 * H,
  AEST: 10 * H,
  AEDT: 11 * H,
  NZST: 12 * H,
  NZDT: 13 * H,
};

/** Every accepted abbreviation, sorted — used in the manifest and 400 messages. */
export const TIMEZONE_ABBREVIATIONS = Object.keys(OFFSETS).sort();

/** A resolved zone: a display label plus its fixed offset from UTC in minutes. */
export interface Timezone {
  /** Canonical label, e.g. `EDT` or `UTC+05:30` for an explicit offset. */
  label: string;
  /** Minutes to add to UTC to get local time (EDT = -240). */
  offsetMinutes: number;
}

/** The default zone, pre-resolved. */
export const DEFAULT_ZONE: Timezone = {
  label: DEFAULT_TIMEZONE,
  offsetMinutes: OFFSETS[DEFAULT_TIMEZONE],
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** ISO 8601 offset designator: `Z` at zero, otherwise `-04:00` / `+05:30`. */
export function offsetDesignator(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "Z";
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** Explicit-offset forms: `+0530`, `-04:00`, `UTC+5`, `GMT-8`. */
const EXPLICIT_OFFSET = /^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/;

/**
 * Resolve an abbreviation (case-insensitive) or an explicit offset into a
 * `Timezone`. Returns null when the value is not recognized, so callers can
 * map it to a 400.
 */
export function resolveTimezone(raw: string): Timezone | null {
  // A literal `+` arrives from a query string decoded as a space; put it back.
  const text = raw.trim().replace(/\s+/g, "+");
  if (text === "") return null;

  const upper = text.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(OFFSETS, upper)) {
    const offsetMinutes = OFFSETS[upper];
    return { label: upper === "Z" || upper === "UT" ? "UTC" : upper, offsetMinutes };
  }

  const m = EXPLICIT_OFFSET.exec(upper);
  if (!m) return null;
  const hours = Number(m[2]);
  const minutes = m[3] ? Number(m[3]) : 0;
  // ISO 8601 caps offsets at ±14:00.
  if (hours > 14 || minutes > 59 || hours * 60 + minutes > 14 * 60) return null;
  const total = hours * 60 + minutes;
  const offsetMinutes = m[1] === "-" ? -total : total;
  return {
    label: offsetMinutes === 0 ? "UTC" : `UTC${offsetDesignator(offsetMinutes)}`,
    offsetMinutes,
  };
}

/**
 * The same instant expressed as an ISO 8601 string in the zone's offset, e.g.
 * `2026-07-23T10:05:00.000-04:00`. Zero offset keeps the `Z` spelling.
 */
export function isoWithOffset(at: Date, offsetMinutes: number): string {
  if (offsetMinutes === 0) return at.toISOString();
  const shifted = new Date(at.getTime() + offsetMinutes * 60000);
  return shifted.toISOString().replace(/Z$/, offsetDesignator(offsetMinutes));
}
