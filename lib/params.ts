// Parse and validate query-string parameters into a SensorParams value.
// Returns a discriminated union so callers can map failures to HTTP 400.

import type { OutputFormat, ParseResult } from "@/lib/types";
import { MAX_POINTS } from "@/lib/generator";
import {
  DEFAULT_ZONE,
  TIMEZONE_ABBREVIATIONS,
  offsetDesignator,
  resolveTimezone,
} from "@/lib/timezones";

const FORMATS: Record<string, OutputFormat> = {
  csv: "csv",
  sta: "sta",
  dataarray: "dataArray",
  reading: "reading",
};

const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 3600 * 1000,
};

function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Parse a duration like "24h", "90m", "30s", "1500ms", or bare seconds. */
function parseDuration(raw: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(raw.trim().toLowerCase());
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = m[2] ? DURATION_UNITS[m[2]] : DURATION_UNITS.s; // bare => seconds
  return value * unit;
}

/**
 * A date or date-time with no zone designator, e.g. `2026-07-23T14:05:00` or
 * `2026-07-23`. Such a value is read in the requested timezone rather than
 * UTC (or, worse, the server's zone) so `at` means what the caller wrote.
 */
const ZONELESS_AT = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?$/;

/** Attach `offsetMinutes` to an `at` value that carries no zone of its own. */
function withZone(raw: string, offsetMinutes: number): string {
  const m = ZONELESS_AT.exec(raw.trim());
  if (!m) return raw;
  const time = m[2] ?? "00:00:00";
  return `${m[1]}T${time}${offsetDesignator(offsetMinutes)}`;
}

/**
 * Parse query params. `now` is injectable for deterministic tests; in
 * production the route handler passes the current time.
 */
export function parseParams(
  searchParams: URLSearchParams,
  now: Date,
): ParseResult {
  // seed
  let seed = 0;
  if (searchParams.has("seed")) {
    const raw = searchParams.get("seed") ?? "";
    const n = parseNumber(raw);
    if (n === null) {
      return { ok: false, error: `Invalid seed "${raw}": must be a number.` };
    }
    seed = Math.trunc(n);
  }

  // min / max (both optional, either side allowed)
  let min: number | undefined;
  let max: number | undefined;
  if (searchParams.has("min")) {
    const raw = searchParams.get("min") ?? "";
    const n = parseNumber(raw);
    if (n === null) {
      return { ok: false, error: `Invalid min "${raw}": must be a number.` };
    }
    min = n;
  }
  if (searchParams.has("max")) {
    const raw = searchParams.get("max") ?? "";
    const n = parseNumber(raw);
    if (n === null) {
      return { ok: false, error: `Invalid max "${raw}": must be a number.` };
    }
    max = n;
  }
  if (min !== undefined && max !== undefined && min > max) {
    return {
      ok: false,
      error: `Invalid range: min (${min}) must be <= max (${max}).`,
    };
  }

  // tz (abbreviation or explicit offset; EDT by default)
  let zone = DEFAULT_ZONE;
  const rawTz = searchParams.get("tz") ?? searchParams.get("timezone");
  if (rawTz !== null) {
    const resolved = resolveTimezone(rawTz);
    if (!resolved) {
      return {
        ok: false,
        error: `Invalid tz "${rawTz}": use an abbreviation (${TIMEZONE_ABBREVIATIONS.join(", ")}) or an offset like UTC-05:00, -0500.`,
      };
    }
    zone = resolved;
  }

  // at (ISO 8601, defaults to now). A value without a zone designator is read
  // in the requested timezone.
  let at = now;
  if (searchParams.has("at")) {
    const raw = searchParams.get("at") ?? "";
    const parsed = new Date(withZone(raw, zone.offsetMinutes));
    if (Number.isNaN(parsed.getTime())) {
      return {
        ok: false,
        error: `Invalid at "${raw}": must be an ISO 8601 timestamp, e.g. 2026-07-23T14:05:00Z.`,
      };
    }
    at = parsed;
  }

  // format (sta default — the OGC SensorThings shape)
  let format: OutputFormat = "sta";
  if (searchParams.has("format")) {
    const raw = (searchParams.get("format") ?? "").trim().toLowerCase();
    const resolved = FORMATS[raw];
    if (!resolved) {
      return {
        ok: false,
        error: `Invalid format "${searchParams.get("format")}": must be one of csv, sta, dataArray, reading.`,
      };
    }
    format = resolved;
  }

  // points (integer >= 1, capped at MAX_POINTS)
  let points: number | undefined;
  if (searchParams.has("points")) {
    const raw = searchParams.get("points") ?? "";
    const n = parseNumber(raw);
    if (n === null || !Number.isInteger(n) || n < 1) {
      return {
        ok: false,
        error: `Invalid points "${raw}": must be an integer >= 1.`,
      };
    }
    points = Math.min(n, MAX_POINTS);
  }

  // window (duration string; overrides points)
  let windowMs: number | undefined;
  if (searchParams.has("window")) {
    const raw = searchParams.get("window") ?? "";
    const ms = parseDuration(raw);
    if (ms === null) {
      return {
        ok: false,
        error: `Invalid window "${raw}": use a duration like 24h, 90m, 30s, 1500ms, or bare seconds.`,
      };
    }
    windowMs = ms;
  }

  return {
    ok: true,
    value: {
      seed,
      min,
      max,
      at,
      format,
      points,
      windowMs,
      timezone: zone.label,
      offsetMinutes: zone.offsetMinutes,
    },
  };
}
