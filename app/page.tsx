"use client";

import { useEffect, useMemo, useState } from "react";

interface ManifestEntry {
  type: string;
  unit: string;
  kind: "continuous" | "binary" | "enum";
  min: number;
  max: number;
  frequency: number;
  values?: string[];
}

interface Manifest {
  count: number;
  sensors: ManifestEntry[];
}

interface Point {
  time: string;
  value: number;
}

// Sensors shown as live tiles. The rest are listed in the table below.
const LIVE = ["temperature", "flow", "humidity", "energy_consumption"];
const POLL_MS = 4000;
const TILE_POINTS = 120;

/** Parse header-less `time,value` CSV exactly as the CollabDT components do. */
function parseCsv(text: string): Point[] {
  return text
    .trim()
    .split("\n")
    .map((line) => {
      const [time, value] = line.split(",");
      return { time: time.trim(), value: parseFloat(value) };
    })
    .filter((p) => !Number.isNaN(p.value));
}

/** Dependency-free area sparkline over parsed points. */
function Sparkline({ points, color }: { points: Point[]; color: string }) {
  const w = 260;
  const h = 64;
  const { line, area } = useMemo(() => {
    if (points.length < 2) return { line: "", area: "" };
    const vals = points.map((p) => p.value);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = hi - lo || 1;
    const x = (i: number) => (i / (points.length - 1)) * w;
    const y = (v: number) => h - 4 - ((v - lo) / span) * (h - 8);
    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
    const area = `${line} L${w},${h} L0,${h} Z`;
    return { line, area };
  }, [points]);

  if (!line) return <div className="h-16" />;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none">
      <path d={area} fill={color} fillOpacity={0.15} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

function LiveTile({ entry }: { entry: ManifestEntry }) {
  const [points, setPoints] = useState<Point[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/sensor/${entry.type}?seed=1&points=${TILE_POINTS}&format=csv`, {
          cache: "no-store",
        });
        const text = await res.text();
        if (active) {
          setPoints(parseCsv(text));
          setError(null);
        }
      } catch {
        if (active) setError("fetch failed");
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [entry.type]);

  const current = points.length ? points[points.length - 1].value : null;

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/15 p-4 flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h3 className="font-mono text-sm text-foreground/70">{entry.type}</h3>
        <span className="text-xs text-foreground/40">{error ? "—" : points.length ? "live" : "…"}</span>
      </div>
      <div className="font-mono text-2xl tabular-nums">
        {current !== null ? (
          <>
            {current}
            <span className="text-sm text-foreground/50 ml-1">{entry.unit}</span>
          </>
        ) : (
          <span className="text-foreground/30">…</span>
        )}
      </div>
      <Sparkline points={points} color="var(--spark)" />
      <div className="text-[11px] text-foreground/40 font-mono">{points.length} pts · {entry.type} CSV</div>
    </div>
  );
}

function CopyUrl({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  // Client-only origin; SSR renders the bare path, so suppress the value mismatch.
  const url = (typeof window === "undefined" ? "" : window.location.origin) + path;
  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        suppressHydrationWarning
        value={url}
        className="flex-1 min-w-0 font-mono text-xs bg-black/[.04] dark:bg-white/[.06] rounded px-2 py-1"
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        className="text-xs rounded border border-black/15 dark:border-white/20 px-2 py-1 hover:bg-black/[.04] dark:hover:bg-white/[.06]"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export default function Home() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  // Client-only origin so the table shows full, copy-pasteable URLs (SSR renders the
  // bare path; the anchor carries suppressHydrationWarning). Same pattern as CopyUrl.
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  useEffect(() => {
    fetch("/api/sensors")
      .then((r) => r.json())
      .then(setManifest)
      .catch(() => setManifest(null));
  }, []);

  const liveEntries = (manifest?.sensors ?? []).filter((s) => LIVE.includes(s.type));

  return (
    <main className="max-w-5xl mx-auto px-6 py-12 flex flex-col gap-10" style={{ ["--spark" as string]: "#2563eb" }}>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Synthetic Sensor API</h1>
        <p className="text-foreground/60 max-w-2xl">
          Deterministic, OGC-SensorThings-shaped synthetic sensor data. Each reading follows a
          diurnal curve plus gentle seeded noise, so the same URL is reproducible while readings
          still fluctuate. Returns an OGC SensorThings Datastream by default — paste the URL
          straight into a CollabDT sensor (Data format = Json). CSV, dataArray, and reading
          formats are available via <span className="font-mono">?format=</span>.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm uppercase tracking-wide text-foreground/50">Live (polling every {POLL_MS / 1000}s)</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {liveEntries.map((entry) => (
            <LiveTile key={entry.type} entry={entry} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm uppercase tracking-wide text-foreground/50">Use in CollabDT</h2>
        <p className="text-sm text-foreground/60 max-w-2xl">
          In a sensor&apos;s form, set <span className="font-mono">Data format = Json</span> and paste one of
          these as the <span className="font-mono">Data URL</span>. The unit comes through from the STA
          Datastream. Set the update frequency to the sensor&apos;s default (shown in the table).
        </p>
        <div className="flex flex-col gap-2 max-w-2xl">
          <CopyUrl path="/api/sensor/temperature" />
          <CopyUrl path="/api/sensor/flow?seed=7" />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm uppercase tracking-wide text-foreground/50">All sensors {manifest ? `(${manifest.count})` : ""}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-foreground/50 border-b border-black/10 dark:border-white/15">
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Unit</th>
                <th className="py-2 pr-4 font-medium">Kind</th>
                <th className="py-2 pr-4 font-medium">Default range</th>
                <th className="py-2 pr-4 font-medium">Frequency</th>
                <th className="py-2 pr-4 font-medium">Data URL</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {manifest?.sensors.map((s) => (
                <tr key={s.type} className="border-b border-black/5 dark:border-white/10">
                  <td className="py-2 pr-4">{s.type}</td>
                  <td className="py-2 pr-4 text-foreground/70">{s.unit}</td>
                  <td className="py-2 pr-4 text-foreground/50">{s.kind}</td>
                  <td className="py-2 pr-4 text-foreground/50">
                    {s.kind === "continuous" ? `${s.min} – ${s.max}` : (s.values?.join(" / ") ?? "0 / 1")}
                  </td>
                  <td className="py-2 pr-4 text-foreground/50">{Math.round(s.frequency / 1000)}s</td>
                  <td className="py-2 pr-4">
                    <a
                      className="text-blue-600 dark:text-blue-400 hover:underline break-all"
                      href={`/api/sensor/${s.type}`}
                      target="_blank"
                      rel="noreferrer"
                      suppressHydrationWarning
                    >
                      {origin}/api/sensor/{s.type}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm uppercase tracking-wide text-foreground/50">Example endpoints</h2>
        <ul className="flex flex-col gap-1.5 font-mono text-sm">
          {[
            "/api/sensors",
            "/api/sensor/temperature",
            "/api/sensor/temperature?format=csv",
            "/api/sensor/temperature?format=dataArray&points=50",
            "/api/sensor/temperature?format=reading",
            "/api/sensor/temperature?seed=2&min=-20&max=50",
            "/api/sensor/temperature?window=24h",
            "/api/sensor/flow?seed=7&window=24h&format=csv",
            "/api/sensor/state?format=csv",
          ].map((href) => (
            <li key={href}>
              <a className="text-blue-600 dark:text-blue-400 hover:underline break-all" href={href} target="_blank" rel="noreferrer">
                {href}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
