// Client-side pieces the landing-page playground is built from: the control set,
// the URL it maps onto, and the CSV parsing a CollabDT sensor does.
//
// Every control is one query parameter on `/api/sensor/{type}`, and the URL shown
// under the chart is the URL that produced it — so what the page previews and
// what a CollabDT sensor fetches cannot drift apart.

export type Placement = "indoor" | "outdoor";

export interface ManifestEntry {
  type: string;
  unit: string;
  kind: "continuous" | "binary" | "enum";
  min: number;
  max: number;
  frequency: number;
  /** Enum kinds only: the labels the ordinal CSV values index into. */
  values?: string[];
}

export interface Manifest {
  count: number;
  sensors: ManifestEntry[];
  timezones?: string[];
  defaultTimezone?: string;
  defaultLocation?: { latitude: number; longitude: number };
  defaultPlacement?: Placement;
}

/** One parsed sample: the clock time as served, and the numeric value. */
export interface Point {
  time: string;
  value: number;
}

/** Everything the playground can change. Each field is one query parameter. */
export interface Controls {
  placement: Placement;
  /** First seed; `seeds` more are overlaid from here. */
  seed: number;
  seeds: number;
  /** Duration string the API accepts: 10m, 6h, 24h, 168h. */
  window: string;
  latitude: string;
  longitude: string;
  timezone: string;
  /** Empty means "now"; anything else freezes the series at that instant. */
  at: string;
  min: string;
  max: string;
}

/**
 * Window presets. `window` takes ms/s/m/h only, so a week is 168h. Anything
 * longer than the sensor's own frequency allows is downsampled server-side.
 */
export const WINDOWS = ["10m", "1h", "6h", "24h", "72h", "168h"] as const;

/** Most seeds we will overlay: the count the categorical palette validates for. */
export const MAX_OVERLAY_SEEDS = 5;

export const DEFAULT_CONTROLS: Controls = {
  placement: "outdoor",
  seed: 1,
  seeds: 5,
  window: "24h",
  latitude: "45",
  longitude: "-75",
  timezone: "EDT",
  at: "",
  min: "",
  max: "",
};

/** The consecutive seeds a chart overlays, starting at `controls.seed`. */
export function seedsOf(controls: Controls): number[] {
  return Array.from({ length: controls.seeds }, (_, i) => controls.seed + i);
}

/**
 * Whether an `at` value is complete enough to send. A datetime-local input hands
 * back its partial state while it is being typed, and half a date is a 400 on
 * every sensor at once — so it is not a parameter until it is a whole instant.
 */
export function isCompleteInstant(at: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(at);
}

/** The exact URL a chart or tile is drawn from. */
export function seriesUrl(
  type: string,
  controls: Controls,
  seed: number,
  format = "csv",
): string {
  const q = new URLSearchParams({
    format,
    window: controls.window,
    seed: String(seed),
    lat: controls.latitude,
    lon: controls.longitude,
    tz: controls.timezone,
    placement: controls.placement,
  });
  // Omitted rather than blank: an empty `at` would be a 400, and empty min/max
  // must fall through to the rule's own seasonal range.
  if (isCompleteInstant(controls.at)) q.set("at", controls.at);
  if (controls.min) q.set("min", controls.min);
  if (controls.max) q.set("max", controls.max);
  return `/api/sensor/${type}?${q.toString()}`;
}

/** Parse header-less `time,value` CSV exactly as the CollabDT components do. */
export function parseCsv(text: string): Point[] {
  return text
    .trim()
    .split("\n")
    .map((line) => {
      const [time, value] = line.split(",");
      return { time: (time ?? "").trim(), value: parseFloat(value) };
    })
    .filter((p) => !Number.isNaN(p.value));
}

/** `H:MM:SS` as served, trimmed to `H:MM` for an axis or a tooltip. */
export function shortTime(time: string): string {
  const parts = time.split(":");
  return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : time;
}

/**
 * A value as a reader wants it: an enum's label rather than its ordinal, a
 * boolean rather than 0/1, and otherwise a number kept short enough to sit on an
 * axis (90,000 lux is `90k`).
 */
export function formatValue(value: number, entry: ManifestEntry): string {
  if (entry.kind === "enum") return entry.values?.[value] ?? String(value);
  if (entry.kind === "binary") return value >= 0.5 ? "true" : "false";
  return compactNumber(value);
}

export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10000) return `${Math.round(value / 100) / 10}k`;
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
}
