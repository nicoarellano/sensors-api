// Parse and validate query-string parameters into a SensorParams value.
// Returns a discriminated union so callers can map failures to HTTP 400.

import type { ParseResult } from "@/lib/types";

/** Values that turn a `series` flag off; anything else present means on. */
const FALSY = new Set(["0", "false", "no", "off"]);

function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
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

  // at (ISO 8601, defaults to now)
  let at = now;
  if (searchParams.has("at")) {
    const raw = searchParams.get("at") ?? "";
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return {
        ok: false,
        error: `Invalid at "${raw}": must be an ISO 8601 timestamp, e.g. 2026-07-23T14:05:00Z.`,
      };
    }
    at = parsed;
  }

  // series (presence flag; series=0/false/no/off disable it)
  let series = false;
  if (searchParams.has("series")) {
    const raw = (searchParams.get("series") ?? "").trim().toLowerCase();
    series = !FALSY.has(raw);
  }

  return { ok: true, value: { seed, min, max, at, series } };
}
