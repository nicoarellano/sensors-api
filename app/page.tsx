"use client";

import { useEffect, useState } from "react";

interface ManifestEntry {
  type: string;
  unit: string;
  kind: "continuous" | "binary" | "enum";
  min: number;
  max: number;
  values?: string[];
}

interface Manifest {
  count: number;
  sensors: ManifestEntry[];
}

interface Reading {
  type: string;
  unit: string;
  seed: number;
  timestamp: string;
  value: number | string;
  min?: number;
  max?: number;
}

// Sensors shown as live tiles at the top. The rest are listed below.
const LIVE = ["temperature", "flow", "humidity", "energy_consumption"];
const POLL_MS = 3000;

function LiveTile({ type }: { type: string }) {
  const [reading, setReading] = useState<Reading | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/sensor/${type}?seed=1`, {
          cache: "no-store",
        });
        const json = (await res.json()) as Reading;
        if (active) {
          setReading(json);
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
  }, [type]);

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/15 p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="font-mono text-sm text-foreground/70">{type}</h3>
        <span className="text-xs text-foreground/40">
          {error ? "—" : reading ? "live" : "…"}
        </span>
      </div>
      <div className="font-mono text-3xl tabular-nums">
        {reading ? (
          <>
            {reading.value}
            <span className="text-base text-foreground/50 ml-1">
              {reading.unit}
            </span>
          </>
        ) : (
          <span className="text-foreground/30">…</span>
        )}
      </div>
      <pre className="text-[11px] leading-tight bg-black/[.04] dark:bg-white/[.06] rounded p-2 overflow-x-auto">
        {reading ? JSON.stringify(reading, null, 2) : (error ?? "loading…")}
      </pre>
    </div>
  );
}

export default function Home() {
  const [manifest, setManifest] = useState<Manifest | null>(null);

  useEffect(() => {
    fetch("/api/sensors")
      .then((r) => r.json())
      .then(setManifest)
      .catch(() => setManifest(null));
  }, []);

  return (
    <main className="max-w-5xl mx-auto px-6 py-12 flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Synthetic Sensor API</h1>
        <p className="text-foreground/60 max-w-2xl">
          Deterministic, seeded synthetic sensor data as JSON. Values follow a
          diurnal curve plus bounded seeded noise, so the same URL is always
          reproducible and different seeds simulate different physical sensors.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm uppercase tracking-wide text-foreground/50">
          Live (polling every {POLL_MS / 1000}s)
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LIVE.map((type) => (
            <LiveTile key={type} type={type} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm uppercase tracking-wide text-foreground/50">
          All sensors {manifest ? `(${manifest.count})` : ""}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-foreground/50 border-b border-black/10 dark:border-white/15">
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Unit</th>
                <th className="py-2 pr-4 font-medium">Kind</th>
                <th className="py-2 pr-4 font-medium">Default range</th>
                <th className="py-2 pr-4 font-medium">Example</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {manifest?.sensors.map((s) => (
                <tr
                  key={s.type}
                  className="border-b border-black/5 dark:border-white/10"
                >
                  <td className="py-2 pr-4">{s.type}</td>
                  <td className="py-2 pr-4 text-foreground/70">{s.unit}</td>
                  <td className="py-2 pr-4 text-foreground/50">{s.kind}</td>
                  <td className="py-2 pr-4 text-foreground/50">
                    {s.kind === "continuous"
                      ? `${s.min} – ${s.max}`
                      : (s.values?.join(" / ") ?? "0 / 1")}
                  </td>
                  <td className="py-2 pr-4">
                    <a
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                      href={`/api/sensor/${s.type}?seed=1`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      /api/sensor/{s.type}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm uppercase tracking-wide text-foreground/50">
          Example endpoints
        </h2>
        <ul className="flex flex-col gap-1.5 font-mono text-sm">
          {[
            "/api/sensors",
            "/api/sensor/temperature?seed=2",
            "/api/sensor/temperature?seed=2&min=-20&max=50",
            "/api/sensor/temperature?at=2026-07-23T14:05:00Z",
            "/api/sensor/flow?seed=7&series=1",
            "/api/sensor/state",
            "/api/sensor/movement?seed=3",
          ].map((href) => (
            <li key={href}>
              <a
                className="text-blue-600 dark:text-blue-400 hover:underline break-all"
                href={href}
                target="_blank"
                rel="noreferrer"
              >
                {href}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
