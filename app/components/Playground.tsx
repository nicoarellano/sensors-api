"use client";

// The playground: one control bar that every chart on the page obeys.
//
// It exists because a preview drawn from different parameters than the sensor is
// worse than no preview — it disagrees with the chart in CollabDT and there is no
// way to tell which one is wrong. Every control here is a query parameter, the
// URL under the focused chart is the URL the chart was drawn from, and the tiles
// below use the same window, so the shape on this page is the shape you get.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CopyUrl } from "./CopyUrl";
import { SeriesChart, type Series } from "./SeriesChart";
import { SensorTile } from "./SensorTile";
import {
  DEFAULT_CONTROLS,
  MAX_OVERLAY_SEEDS,
  WINDOWS,
  isCompleteInstant,
  parseCsv,
  seedsOf,
  seriesUrl,
  type Controls,
  type Manifest,
  type ManifestEntry,
  type Placement,
  type Point,
} from "./seriesQuery";

/** How often a live page refetches. Long enough for a 1000-point window. */
const POLL_MS = 10000;
/** How long a control has to stop changing before it is fetched. */
const SETTLE_MS = 300;
/** Sensor the page opens on: the one whose shape is worth checking first. */
const DEFAULT_FOCUS = "energy_consumption";

const SERIES_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
];

/** Pull the API's own message out of a failed response, whatever shape it is. */
function errorMessage(body: string, status: number): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      return String((parsed as { error: unknown }).error);
    }
  } catch {
    // Not JSON; fall through to the status line.
  }
  return `HTTP ${status}`;
}

interface Fetched {
  points: Point[][];
  error: string | null;
}

const EMPTY: Fetched = { points: [], error: null };

/**
 * Fetch one CSV window per URL, together. `urls` is joined into the dependency so
 * changing any control refetches exactly once.
 */
function useCsvSeries(urls: string[], refreshKey: number): Fetched {
  const [state, setState] = useState<Fetched>(EMPTY);
  const key = urls.join("|");

  useEffect(() => {
    if (!key) return;
    let active = true;
    const load = async (url: string): Promise<Point[]> => {
      const res = await fetch(url, { cache: "no-store" });
      const body = await res.text();
      if (!res.ok) throw new Error(errorMessage(body, res.status));
      return parseCsv(body);
    };
    Promise.all(key.split("|").map(load))
      .then((points) => {
        if (active) setState({ points, error: null });
      })
      .catch((cause: unknown) => {
        if (active) {
          setState({
            points: [],
            error: cause instanceof Error ? cause.message : "fetch failed",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [key, refreshKey]);

  return state;
}

/**
 * The controls, settled. Typing a latitude or a date walks through several
 * incomplete values, and each one would otherwise fetch a window for every
 * sensor on the page.
 */
function useSettled<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return settled;
}

/** A labelled control. The label is the accessible name of the input inside it. */
function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? "" : "shrink-0"}`}>
      <span className="text-[10px] uppercase tracking-wide text-foreground/50">
        {label}
      </span>
      {children}
    </label>
  );
}

const INPUT =
  "font-mono text-sm bg-black/[.04] dark:bg-white/[.06] rounded px-2 py-1 border border-transparent focus:border-blue-600 outline-none";

/** Two-way switch for a query parameter whose effect you can watch live. */
function Toggle<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded border border-black/15 dark:border-white/20 overflow-hidden text-xs"
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={option === value}
          className={`px-2.5 py-1.5 font-mono ${
            option === value
              ? "bg-blue-600 text-white"
              : "hover:bg-black/[.04] dark:hover:bg-white/[.06]"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/** One tile, fetching its own window at the shared controls. */
function Tile({
  entry,
  controls,
  refreshKey,
  focused,
  onFocus,
}: {
  entry: ManifestEntry;
  controls: Controls;
  refreshKey: number;
  focused: boolean;
  onFocus: () => void;
}) {
  const urls = useMemo(
    () => [seriesUrl(entry.type, controls, controls.seed)],
    [entry.type, controls],
  );
  const { points, error } = useCsvSeries(urls, refreshKey);
  return (
    <SensorTile
      entry={entry}
      points={points[0] ?? []}
      error={error}
      focused={focused}
      onFocus={onFocus}
    />
  );
}

export function Playground({ manifest }: { manifest: Manifest | null }) {
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS);
  const [focus, setFocus] = useState<string>(DEFAULT_FOCUS);
  const [live, setLive] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const set = useCallback(
    <K extends keyof Controls>(key: K, value: Controls[K]) =>
      setControls((prev) => ({ ...prev, [key]: value })),
    [],
  );

  // Inputs track `controls`; everything that fetches or describes a series uses
  // `applied`, so a half-typed value never becomes a request.
  const applied = useSettled(controls, SETTLE_MS);

  // A series pinned to an instant cannot change, so polling it is pure waste.
  const polling = live && !isCompleteInstant(applied.at);
  useEffect(() => {
    if (!polling) return;
    const id = setInterval(() => setRefreshKey((n) => n + 1), POLL_MS);
    return () => clearInterval(id);
  }, [polling]);

  const entries = manifest?.sensors ?? [];
  const focusEntry = entries.find((s) => s.type === focus) ?? entries[0];
  const seeds = seedsOf(applied);

  const focusUrls = useMemo(
    () => (focusEntry ? seeds.map((seed) => seriesUrl(focusEntry.type, applied, seed)) : []),
    [focusEntry, applied, seeds],
  );
  const focused = useCsvSeries(focusUrls, refreshKey);

  const series: Series[] = seeds.map((seed, i) => ({
    label: `seed ${seed}`,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
    points: focused.points[i] ?? [],
  }));

  const zones = manifest?.timezones ?? ["EDT"];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm uppercase tracking-wide text-foreground/50">
          Playground
        </h2>
        <div className="flex items-center gap-3 text-xs text-foreground/50">
          <span>
            {isCompleteInstant(applied.at)
              ? "frozen at a fixed instant"
              : polling
                ? `refreshing every ${POLL_MS / 1000}s`
                : "paused"}
          </span>
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            aria-pressed={live}
            className="rounded border border-black/15 dark:border-white/20 px-2 py-1 hover:bg-black/[.04] dark:hover:bg-white/[.06]"
          >
            {live ? "Pause" : "Resume"}
          </button>
          <button
            type="button"
            onClick={() => setControls(DEFAULT_CONTROLS)}
            className="rounded border border-black/15 dark:border-white/20 px-2 py-1 hover:bg-black/[.04] dark:hover:bg-white/[.06]"
          >
            Reset
          </button>
        </div>
      </div>

      <p className="text-sm text-foreground/60 max-w-2xl">
        Every control below is a query parameter, and the URL under the chart is
        the URL the chart was drawn from — so this is exactly what a CollabDT
        sensor pointed at the same URL will show. Changes apply immediately.
      </p>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-lg border border-black/10 dark:border-white/15 p-3">
        <Field label="placement">
          <Toggle
            label="placement"
            options={["outdoor", "indoor"] as const}
            value={controls.placement}
            onChange={(next: Placement) => set("placement", next)}
          />
        </Field>
        <Field label="window">
          <select
            className={INPUT}
            value={controls.window}
            onChange={(e) => set("window", e.target.value)}
          >
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </Field>
        <Field label="seed">
          <input
            type="number"
            className={`${INPUT} w-16`}
            value={controls.seed}
            onChange={(e) => set("seed", Math.trunc(Number(e.target.value) || 0))}
          />
        </Field>
        <Field label="overlay">
          <select
            className={INPUT}
            value={controls.seeds}
            onChange={(e) => set("seeds", Number(e.target.value))}
          >
            {Array.from({ length: MAX_OVERLAY_SEEDS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "1 seed" : `${n} seeds`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="lat">
          <input
            type="number"
            step="0.5"
            className={`${INPUT} w-20`}
            value={controls.latitude}
            onChange={(e) => set("latitude", e.target.value)}
          />
        </Field>
        <Field label="lon">
          <input
            type="number"
            step="0.5"
            className={`${INPUT} w-20`}
            value={controls.longitude}
            onChange={(e) => set("longitude", e.target.value)}
          />
        </Field>
        <Field label="tz">
          <select
            className={INPUT}
            value={controls.timezone}
            onChange={(e) => set("timezone", e.target.value)}
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </Field>
        <Field label="at (blank = now)">
          <div className="flex items-center gap-1">
            <input
              type="datetime-local"
              className={INPUT}
              value={controls.at}
              onChange={(e) => set("at", e.target.value)}
            />
            {controls.at && (
              <button
                type="button"
                onClick={() => set("at", "")}
                className="text-xs rounded border border-black/15 dark:border-white/20 px-2 py-1.5 hover:bg-black/[.04] dark:hover:bg-white/[.06]"
              >
                Now
              </button>
            )}
          </div>
        </Field>
        <Field label="min">
          <input
            type="number"
            placeholder="auto"
            className={`${INPUT} w-20`}
            value={controls.min}
            onChange={(e) => set("min", e.target.value)}
          />
        </Field>
        <Field label="max">
          <input
            type="number"
            placeholder="auto"
            className={`${INPUT} w-20`}
            value={controls.max}
            onChange={(e) => set("max", e.target.value)}
          />
        </Field>
      </div>

      {focusEntry && (
        <div className="flex flex-col gap-3 rounded-lg border border-black/10 dark:border-white/15 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-mono text-sm">
              {focusEntry.type}
              <span className="text-foreground/50 ml-2">
                {focusEntry.kind === "continuous"
                  ? focusEntry.unit
                  : (focusEntry.values?.join(" / ") ?? "0 / 1")}
              </span>
            </h3>
            <span className="text-xs text-foreground/40 font-mono">
              {applied.window} · {applied.placement} · {applied.latitude},{" "}
              {applied.longitude} · {applied.timezone}
            </span>
          </div>
          {focused.error ? (
            <p className="text-sm text-red-600 dark:text-red-400 font-mono">
              {focused.error}
            </p>
          ) : (
            <SeriesChart series={series} entry={focusEntry} />
          )}
          <CopyUrl
            path={seriesUrl(focusEntry.type, applied, applied.seed)}
            label={`Data URL for ${focusEntry.type}`}
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-xs uppercase tracking-wide text-foreground/50">
          All {entries.length || ""} sensors at seed {applied.seed} — click to chart
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {entries.map((entry) => (
            <Tile
              key={entry.type}
              entry={entry}
              controls={applied}
              refreshKey={refreshKey}
              focused={entry.type === focus}
              onFocus={() => setFocus(entry.type)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
