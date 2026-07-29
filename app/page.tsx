"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CopyUrl } from "./components/CopyUrl";
import { Playground } from "./components/Playground";
import type { Manifest } from "./components/seriesQuery";

/** Inline code, for parameter names and literal values inside prose. */
function M({ children }: { children: ReactNode }) {
  return <span className="font-mono">{children}</span>;
}

interface ParamDoc {
  name: string;
  type: string;
  fallback: string;
  desc: ReactNode;
}

/**
 * Reference for every URL search parameter `/api/sensor/{type}` accepts. Kept in
 * sync with the validation in lib/params.ts — anything not listed here is ignored.
 */
const PARAMS: ParamDoc[] = [
  {
    name: "{type}",
    type: "path segment",
    fallback: "required",
    desc: (
      <>
        Which sensor to simulate — one of the types in the table above.
        Case-insensitive. An unknown type returns 404 with the valid list.
      </>
    ),
  },
  {
    name: "format",
    type: "sta | csv | dataArray | reading",
    fallback: "sta",
    desc: (
      <>
        Response shape. <M>sta</M> is an OGC SensorThings Datastream with embedded
        Observations, <M>csv</M> is header-less <M>time,value</M> rows,{" "}
        <M>dataArray</M> is the compact OGC <M>{"{components, dataArray}"}</M> form,
        and <M>reading</M> is a single latest value.
      </>
    ),
  },
  {
    name: "points",
    type: "integer ≥ 1",
    fallback: "288",
    desc: (
      <>
        How many samples to return, spaced at the sensor&apos;s own frequency. Capped
        at 1000. Because the spacing is the sensor&apos;s frequency, a point count is
        a different span per type — 120 points is two hours of energy and ten minutes
        of flow — so prefer <M>window</M> when you want a comparable shape.
      </>
    ),
  },
  {
    name: "window",
    type: "duration",
    fallback: "—",
    desc: (
      <>
        Return a span of time instead of a sample count: <M>24h</M>, <M>90m</M>,{" "}
        <M>30s</M>, <M>1500ms</M>, or bare seconds. Sampled at the sensor&apos;s
        frequency, then downsampled evenly to at most 1000 points. Overrides{" "}
        <M>points</M>.
      </>
    ),
  },
  {
    name: "seed",
    type: "integer",
    fallback: "0",
    desc: (
      <>
        Picks which simulated sensor you get. The same seed always returns the same
        series; a different seed gives a different one — its own swing, baseline,
        peak timing and noisiness. Timing that is astronomy rather than personality
        (daylight, and the photocell on exterior lighting) stays put across seeds.
      </>
    ),
  },
  {
    name: "min",
    type: "number",
    fallback: "per type",
    desc: (
      <>
        Override the bottom of the value range. The daily curve is rescaled into the
        new band rather than clipped, and may be given without <M>max</M>. Ignored by{" "}
        <M>movement</M> and <M>state</M>.
      </>
    ),
  },
  {
    name: "max",
    type: "number",
    fallback: "per type",
    desc: (
      <>
        Override the top of the value range. <M>min</M> greater than <M>max</M> is a
        400.
      </>
    ),
  },
  {
    name: "at",
    type: "ISO 8601 instant",
    fallback: "now",
    desc: (
      <>
        End the window (or evaluate <M>reading</M>) at a fixed instant instead of
        &quot;now&quot;, which freezes a URL in time. A value with no zone designator
        is read in <M>tz</M>.
      </>
    ),
  },
  {
    name: "lat",
    type: "-90 … 90",
    fallback: "45",
    desc: (
      <>
        Site latitude in degrees north. Sets day length, the height of the sun and
        the seasonal climate, so a January series at <M>lat=45</M> is genuinely
        below freezing and one at <M>lat=5</M> is not. <M>latitude</M> is accepted
        as an alias.
      </>
    ),
  },
  {
    name: "lon",
    type: "-180 … 180",
    fallback: "-75",
    desc: (
      <>
        Site longitude in degrees east (negative in the Americas). Sets where solar
        noon falls on the local clock. Pass a <M>tz</M> without a <M>lon</M> and the
        zone&apos;s central meridian is used, so noon stays noon. <M>lng</M> and{" "}
        <M>longitude</M> are accepted as aliases.
      </>
    ),
  },
  {
    name: "placement",
    type: "indoor | outdoor",
    fallback: "outdoor",
    desc: (
      <>
        Where the sensor sits. <M>outdoor</M> is exposed to the real sky and the real
        seasonal air temperature; <M>indoor</M> sits behind glazing and a control
        system, so it is damped, lagged and held near a setpoint. The same URL reads
        -13 °C outdoors and 19 °C indoors in January.
      </>
    ),
  },
  {
    name: "tz",
    type: "abbreviation or offset",
    fallback: "EDT",
    desc: (
      <>
        Zone the series is timed in: it sets where the daily curve peaks and how
        timestamps are rendered. Any abbreviation from{" "}
        <M>/api/sensors</M> (<M>PDT</M>, <M>JST</M>, <M>UTC</M>, case-insensitive) or
        an explicit offset (<M>UTC-05:00</M>, <M>-0500</M>). Fixed offsets, so no DST
        transitions apply. <M>timezone</M> is accepted as an alias.
      </>
    ),
  },
];

/**
 * Notable changes, newest first — see the README for the full reference. The
 * section that renders these is commented out at the bottom of this file; keep
 * the list in step with reality so uncommenting it is a one-line change.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CHANGES: { title: string; body: ReactNode }[] = [
  {
    title: "Exterior meters and water that behave",
    body: (
      <>
        <M>energy_consumption</M> at <M>placement=outdoor</M> was a two-state square
        wave: full dusk-to-dawn lighting all night, then a flat standing load for the
        whole of a summer day. It is now a site meter with a real day — a standing
        load, lighting that dims through the small hours, plant that follows site
        activity, and whichever of heat rejection or freeze protection the weather is
        calling for. So July peaks in the afternoon and January peaks overnight, and
        neither is flat. Its band now follows the day&apos;s weather too, instead of
        being sized on the January peak, which had left a July series bunched into the
        bottom of its own range where the noise term dwarfed the signal.{" "}
        <M>flow</M> at <M>placement=outdoor</M> had only a pre-dawn irrigation burst,
        so any window outside roughly 03:00–08:00 read a solid 0.00; it now has
        morning and evening irrigation cycles, evaporative make-up while the plant is
        rejecting heat, and hose draw through an active day — while still reading a
        true zero once the line would freeze. And exterior lighting no longer switches
        up to three hours late on some seeds: a photocell is astronomy, not
        personality.
      </>
    ),
  },
  {
    title: "Playground on this page",
    body: (
      <>
        Every sensor is charted above, at controls that map one-to-one onto the query
        parameters, so a shape you see here is a shape you get. Overlay up to five
        seeds to compare them, move the site, freeze the clock with <M>at</M>, and
        copy the URL the chart was actually drawn from.
      </>
    ),
  },
  {
    title: "Location and placement",
    body: (
      <>
        Values come from a physical model of the site rather than a fixed daily
        curve. <M>?lat=</M>/<M>?lon=</M> set where the sensor is: latitude drives day
        length and the seasonal climate, longitude drives where solar noon lands on
        the clock. <M>?placement=outdoor</M> (the default) is exposed to the real sky
        and the real seasonal air temperature, so January reads below freezing;{" "}
        <M>?placement=indoor</M> is damped, lagged and held near a setpoint, with
        occupancy driving CO₂, lighting, water and noise. Light, temperature and
        irradiance agree about the weather, so one overcast afternoon dims all
        three. The STA response carries the site as a <M>Thing</M> +{" "}
        <M>Location</M> + <M>FeatureOfInterest</M> in GeoJSON.
      </>
    ),
  },
  {
    title: "Timezones",
    body: (
      <>
        A series can be timed in any zone with <M>?tz=</M> (or <M>?timezone=</M>), so
        the daily curve peaks at local noon instead of UTC noon and timestamps carry
        the zone offset. Abbreviations resolve to fixed offsets — pick the one for the
        season you are demoing (<M>EST</M> in winter, <M>EDT</M> in summer) — and
        explicit offsets like <M>UTC+05:30</M> cover the ambiguous ones. Defaults to{" "}
        <M>EDT</M>.
      </>
    ),
  },
  {
    title: "Seeds that look like different sensors",
    body: (
      <>
        Each <M>(seed, type)</M> gets a personality — swing, baseline, peak timing
        up to ±1.5 h, noisiness — layered with seeded noise at four time scales (day,
        3 h, 20 min, 15 s) and sparse events where a spike is physical: a machine
        starting, a tap opening, a door slamming. Strong seeds round off near the
        ceiling instead of flat-lining against it, and overnight behavior stays
        physical for every seed.
      </>
    ),
  },
  {
    title: "OGC SensorThings by default",
    body: (
      <>
        The bare URL returns a Datastream carrying <M>unitOfMeasurement</M>,{" "}
        <M>observationType</M>, inline <M>Sensor</M> and <M>ObservedProperty</M>, and
        embedded <M>Observations</M>, so a CollabDT sensor picks up the unit
        automatically. CSV moved behind <M>?format=csv</M>.
      </>
    ),
  },
];

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

  return (
    <main className="max-w-5xl mx-auto px-6 py-12 flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Synthetic Sensor API</h1>
        <p className="text-foreground/60 max-w-2xl">
          Deterministic, OGC-SensorThings-shaped synthetic sensor data. Each reading comes from a
          physical model of a site (the sun where you put it, the season, the weather, and the
          people in the building) plus gentle seeded noise, so the same URL is reproducible while
          readings still fluctuate. Returns an OGC SensorThings Datastream by default: paste the
          URL straight into a CollabDT sensor (Data format = Json). CSV, dataArray, and reading
          formats are available via <M>?format=</M>. The default site is{" "}
          <M>?lat=45&amp;lon=-75</M> in <M>EDT</M>, exposed to the sky
          (<M>?placement=outdoor</M>); move it with <M>?lat=</M>/<M>?lon=</M>/
          <M>?tz=</M>, or bring it inside with <M>?placement=indoor</M>.
        </p>
      </header>

      <Playground manifest={manifest} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm uppercase tracking-wide text-foreground/50">Use in CollabDT</h2>
        <p className="text-sm text-foreground/60 max-w-2xl">
          In a sensor&apos;s form, set <M>Data format = Json</M> and paste one of
          these as the <M>Data URL</M>. The unit comes through from the STA
          Datastream. Set the update frequency to the sensor&apos;s default (shown in the table).
        </p>
        <div className="flex flex-col gap-2 max-w-2xl">
          <CopyUrl path="/api/sensor/temperature" />
          <CopyUrl path="/api/sensor/energy_consumption?placement=indoor" />
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
                <th className="py-2 pr-4 font-medium">Nominal range</th>
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
        <p className="text-sm text-foreground/60 max-w-2xl">
          The nominal range is what the manifest advertises. The effective range of a
          request comes from the rule — an outdoor thermometer&apos;s band moves with
          the season, and an exterior meter&apos;s with the day&apos;s weather — or
          from your own <M>min</M>/<M>max</M> above everything.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm uppercase tracking-wide text-foreground/50">Parameters</h2>
        <p className="text-sm text-foreground/60 max-w-2xl">
          Every parameter is a URL search parameter on <M>/api/sensor/{"{type}"}</M>{" "}
          and every one is optional except the type itself. A malformed value is a 400
          with a message saying what was expected, never a silently wrong series.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-foreground/50 border-b border-black/10 dark:border-white/15">
                <th className="py-2 pr-4 font-medium">Param</th>
                <th className="py-2 pr-4 font-medium">Accepts</th>
                <th className="py-2 pr-4 font-medium">Default</th>
                <th className="py-2 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {PARAMS.map((p) => (
                <tr key={p.name} className="border-b border-black/5 dark:border-white/10 align-top">
                  <td className="py-2 pr-4 font-mono whitespace-nowrap">{p.name}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-foreground/50">{p.type}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-foreground/50 whitespace-nowrap">
                    {p.fallback}
                  </td>
                  <td className="py-2 text-foreground/70 min-w-[20rem]">{p.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-foreground/60 max-w-2xl">
          The same type, seed, timestamp and parameters always produce the same value,
          so any URL with an explicit <M>at</M> is reproducible. Discrete sensors are
          the one exception to the range parameters: <M>movement</M> is 0/1 and{" "}
          <M>state</M> draws from its labels, which CSV encodes as the ordinal index
          so it charts as a step line.
        </p>
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
            "/api/sensor/temperature?at=2026-07-23T14:05:00Z",
            "/api/sensor/energy_consumption?window=24h&format=csv",
            "/api/sensor/energy_consumption?placement=indoor&window=24h&format=csv",
            "/api/sensor/energy_consumption?at=2026-01-15T12:00:00&tz=EST&window=24h&format=csv",
            "/api/sensor/flow?seed=7&window=24h&format=csv",
            "/api/sensor/state?format=csv",
            "/api/sensor/temperature?tz=PDT&window=24h&format=csv",
            "/api/sensor/temperature?timezone=utc&format=dataArray&points=50",
            "/api/sensor/light?lat=78&lon=15&tz=CET&at=2026-12-21T12:00:00&window=24h&format=csv",
            "/api/sensor/air_quality?placement=indoor&window=24h&format=csv",
          ].map((href) => (
            <li key={href}>
              <a className="text-blue-600 dark:text-blue-400 hover:underline break-all" href={href} target="_blank" rel="noreferrer">
                {href}
              </a>
            </li>
          ))}
        </ul>
      </section>

      {/*<section className="flex flex-col gap-4">
        <h2 className="text-sm uppercase tracking-wide text-foreground/50">Latest changes</h2>
        <div className="flex flex-col gap-4 max-w-2xl">
          {CHANGES.map((c) => (
            <div key={c.title} className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">{c.title}</h3>
              <p className="text-sm text-foreground/60">{c.body}</p>
            </div>
          ))}
        </div>
      </section>} */}
    </main>
  );
}
