# Synthetic Sensor API

A Next.js (App Router, TypeScript) service that generates synthetic, sensor-like
time series. By default it serves **OGC SensorThings-shaped JSON** (Datastream +
Observations) — the shape CollabDT's sensor consumer reads directly, with the
unit included. A compact `dataArray`, a single `reading`, and plain `csv` are
available via `?format=`. Each value is computed from a timestamp plus a seeded
PRNG, so the same URL is always reproducible and different seeds simulate
different physical sensors.

Values follow a realistic diurnal profile (a function of time-of-day), reshaped
by a per-seed personality (swing, level, peak timing, noisiness) and layered
with bounded, smooth seeded noise at four time scales, always inside the
effective range. Consecutive readings fluctuate gently instead of jittering or
sitting still. There is no unbounded random walk.

## Quick start

```bash
yarn install
yarn dev        # http://localhost:3000
```

Then open the dashboard at `http://localhost:3000` or hit an endpoint:

```
http://localhost:3000/api/sensor/temperature
```

Other scripts: `yarn build`, `yarn start`, `yarn lint`, `yarn test`.

## API

### `GET /api/sensor/{type}`

Returns a generated window of data. The response shape depends on `?format=`
(default `sta`). By default it returns **288 points** sampled at the sensor's
natural frequency, ending at "now".

#### Formats

| `format`    | Content-Type | Body |
|-------------|--------------|------|
| `sta` *(default)* | `application/json` | An OGC SensorThings **Datastream** object with `unitOfMeasurement`, `observationType`, `ObservedProperty`, a `phenomenonTime` interval, and embedded `Observations[]`. |
| `csv`       | `text/csv; charset=utf-8` | Header-less `time,value` rows, one point per line. Clock-style local `H:MM:SS` time (see `tz`). This is what CollabDT's `SensorChart` fetches and parses. |
| `dataArray` | `application/json` | The compact OGC `{ components, dataArray }` time-series form: rows of `[phenomenonTime, result]`. |
| `reading`   | `application/json` | A single latest reading (the legacy single-value shape) evaluated at `at`. |

#### Parameters

All parameters are URL search parameters and all are optional except the type
itself. Anything malformed is a **400** carrying a message that names what was
expected; unrecognized parameters are ignored.

| Param    | Accepts         | Default | Description |
|----------|-----------------|---------|-------------|
| `{type}` | path segment    | required | Which sensor to simulate — one of the [sensor types](#sensor-types). Case-insensitive. An unknown type → 404 with the valid list. |
| `format` | `sta` \| `csv` \| `dataArray` \| `reading` | `sta` | Response shape (see the [formats table](#formats)). Case-insensitive. Anything else → 400. |
| `points` | integer ≥ 1     | `288`   | How many samples to return, spaced at the sensor's own `frequency`, ending at `at`. Capped at **1000**. Non-integer or < 1 → 400. |
| `window` | duration string | —       | Return a span of wall-clock time instead of a sample count: `24h`, `90m`, `30s`, `1500ms`, or a bare number of seconds. Sampled at the sensor's frequency, then downsampled evenly to **≤ 1000 points**. Takes precedence over `points`. Unparseable or ≤ 0 → 400. |
| `seed`   | integer         | `0`     | Picks *which* simulated sensor you get. The same seed always yields the same series; a different seed yields a different but equally reproducible one, with its own swing, baseline, peak timing and noisiness. Truncated to an integer; non-numeric → 400. |
| `min`    | number          | type default | Override the bottom of the value range. The daily curve is **rescaled** into the new band rather than clipped. May be supplied without `max`. Ignored by `movement` and `state`. |
| `max`    | number          | type default | Override the top of the value range. May be supplied without `min`. `min > max` → 400. |
| `at`     | ISO 8601 instant | now    | End the window — or, with `format=reading`, evaluate the value — at a fixed instant instead of "now", which freezes a URL in time. A value with no zone designator (`2026-07-23T14:05:00`) is read in `tz`. Unparseable → 400. |
| `tz`     | abbreviation or offset | `EDT` | Zone the series is timed in: it sets where the daily curve peaks *and* how timestamps are rendered. Any abbreviation listed by `GET /api/sensors` (`PDT`, `JST`, `UTC`, …, case-insensitive) or an explicit offset (`UTC-05:00`, `-0500`, `UTC+05:30`). `timezone=` is accepted as an alias. Unrecognized → 400. |

**Timezone.** `tz` sets the zone that time-of-day is read in, so the diurnal
curve peaks at **local** noon and not UTC noon: `?tz=PDT` gives a series that
looks like a sensor on the west coast. It also sets how times are rendered — CSV
`H:MM:SS` becomes a local clock, and STA/`dataArray`/`reading` timestamps carry
the zone offset (`2026-07-23T10:05:00.000-04:00`) instead of `Z`. The instants
themselves are unchanged, so `new Date(...)` round-trips exactly.

Abbreviations are **fixed offsets**, not IANA zones: an abbreviation already
names one side of the DST fence, so pick the one for the season you are demoing
(`EST` in winter, `EDT` in summer). No transition rules are applied, which keeps
a URL reproducible. `CST`/`CDT` are read as US Central; ambiguous ones like `IST`
are not accepted — use an explicit offset (`?tz=UTC%2B05:30`) instead. The full
accepted list is in `GET /api/sensors` (`timezones`, `defaultTimezone`).

**Windowing precedence.** `window` and `points` are mutually exclusive; if both
are present, `window` wins. Every window ends at `at` (default now), anchored to
frequency-sized buckets so results are stable and downsampling is even.

**Range precedence & scaling.** User `min`/`max` override the type defaults, and
the diurnal curve scales into whatever range is effective. So
`?min=-20&max=50` stretches the daily shape across that whole band rather than
clipping the default 15–30 curve. The final value is always clamped to the
effective range.

**Discrete sensors.** `movement` (0/1) and `state` (enum) ignore `min`/`max`. In
CSV, `state` is encoded as its **ordinal index** (0-based position in `values`)
so `parseFloat` charts a step line; STA/dataArray keep the string label.

#### Errors

- Unknown/invalid `{type}` → **404** with `{ error, validTypes: [...] }`.
- Malformed params (non-numeric `seed`/`min`/`max`, `min > max`, unparseable
  `at`, bad `format`/`points`/`window`/`tz`) → **400** with `{ error }`.

#### STA response (default)

A standard SensorThings **Datastream** entity graph: it links an inline `Sensor`
and `ObservedProperty`, embeds `Observations`, and carries `@iot.*` annotations.
Full field reference in [`docs/ogc-sensorthings-integration.md`](docs/ogc-sensorthings-integration.md).

```json
{
  "@iot.id": 1,
  "@iot.selfLink": "https://<host>/api/sensor/temperature?format=sta&tz=EDT",
  "name": "Air Temperature",
  "description": "Synthetic Air Temperature datastream for temperature.",
  "observationType": "http://www.opengis.net/def/observationType/OGC-OM/2.0/OM_Measurement",
  "unitOfMeasurement": {
    "name": "degree Celsius",
    "symbol": "°C",
    "definition": "https://qudt.org/vocab/unit/DEG_C"
  },
  "phenomenonTime": "2026-07-22T10:30:00.000-04:00/2026-07-23T10:30:00.000-04:00",
  "resultTime": "2026-07-22T10:30:00.000-04:00/2026-07-23T10:30:00.000-04:00",
  "properties": { "seed": 0, "frequency": 300000, "generator": "sensors-api", "timezone": "EDT" },
  "Sensor": {
    "@iot.id": 1,
    "name": "Synthetic temperature sensor",
    "description": "Deterministic diurnal curve + seeded noise.",
    "encodingType": "text/html",
    "metadata": "https://github.com/nicoarellano/sensors-api"
  },
  "ObservedProperty": {
    "@iot.id": 1,
    "name": "Air Temperature",
    "definition": "https://dbpedia.org/page/Temperature",
    "description": "Air Temperature"
  },
  "Observations@iot.navigationLink": "https://<host>/api/sensor/temperature?format=dataArray&tz=EDT",
  "Observations@iot.count": 288,
  "Observations": [
    {
      "@iot.id": 1,
      "phenomenonTime": "2026-07-22T10:30:00.000-04:00",
      "resultTime": "2026-07-22T10:30:00.000-04:00",
      "result": 23.71
    }
  ]
}
```

`result` is typed to match `observationType`: a number for `OM_Measurement`, a
boolean for `OM_TruthObservation` (`movement`), a string label for
`OM_CategoryObservation` (`state`). `Thing`/`Location`/`FeatureOfInterest` are
intentionally omitted — deployment geography is owned by the consuming app.

#### dataArray response (`?format=dataArray`)

```json
{
  "components": ["phenomenonTime", "result"],
  "dataArray@iot.count": 50,
  "dataArray": [
    ["2026-07-23T09:41:00.000-04:00", 23.71],
    ["2026-07-23T09:46:00.000-04:00", 23.68]
  ]
}
```

#### CSV response (`?format=csv`)

```
14:30:00,23.71
14:35:00,23.68
14:40:00,23.74
```

No header row. `time` is a clock-style `H:MM:SS` local to `tz` (EDT by default);
`value` is `parseFloat`-able for every sensor kind. This is the format CollabDT's
`SensorChart` consumes.

### `GET /api/sensors`

Manifest listing every sensor type with its default `unit`, `kind`, `min`,
`max`, `frequency`, OGC `unitOfMeasurement`/`observationType`/`observedProperty`,
`values` (enum sensors), and ready-to-paste `staUrl` (default) + `csvUrl`. Also
carries `defaultTimezone` and the `timezones` abbreviations `?tz=` accepts.

## Sensor types

| Type                   | Unit    | Default range | Frequency | Behavior |
|------------------------|---------|---------------|-----------|----------|
| `temperature`          | °C      | 15 – 30       | 5 min     | Diurnal, coolest before dawn, warmest mid-afternoon |
| `light`                | lux     | 0 – 100000    | 5 min     | Dark at night, midday peak |
| `humidity`             | %RH     | 0 – 100       | 5 min     | Inverse of temperature |
| `energy_consumption`   | W       | 100 – 3000    | 1 min     | Load curve with morning + evening peaks |
| `movement`             | bool    | 0 / 1         | 1 s       | Sparse occupancy events, day-biased |
| `air_quality`          | ppm     | 400 – 2000    | 1 min     | CO₂ builds through occupied daytime hours |
| `atmospheric_pressure` | hPa     | 980 – 1040    | 10 min    | Slow drift around mid-range |
| `irradiance`           | W/m²    | 0 – 1000      | 5 min     | Correlated with light |
| `flow`                 | L/min   | 0 – 12        | 5 s       | Flat (mostly zero) at night, smooth daytime burst |
| `state`                | enum    | on/off/idle/error | 10 s  | Mostly on/idle by day, off/idle by night, error rare |
| `noise_level`          | dB      | 30 – 80       | 1 s       | Quiet at night, loud through the day |

`frequency` is the default sample cadence of a window and maps directly to a
CollabDT sensor's `updateFrequency`.

## OGC SensorThings mapping

Each sensor kind maps to an OGC SensorThings (OGC 18-088) observation type:

| Kind         | `observationType`        | `result` type | Sensors |
|--------------|--------------------------|---------------|---------|
| `continuous` | `OM_Measurement`         | number        | temperature, light, humidity, energy_consumption, air_quality, atmospheric_pressure, irradiance, flow, noise_level |
| `binary`     | `OM_TruthObservation`    | boolean       | movement |
| `enum`       | `OM_CategoryObservation` | string        | state |

Units carry a UCUM/QUDT `definition` IRI; unitless sensors (`movement`, `state`)
use a `null` `unitOfMeasurement` trio.

## Use in CollabDT

CollabDT's sensor consumer reads the default STA JSON directly — the unit comes
through automatically from the Datastream's `unitOfMeasurement`, and the chart
polls the URL and rolls the window forward:

1. In `SensorInput`, create a sensor and set **dataFormat = Json**.
2. Set the **Data URL** to `https://<your-deploy>/api/sensor/<type>` (optionally
   add `?seed=`, `?points=`, or `?window=`).
3. Set the sensor's **update frequency** to the type's default `frequency` above.

The consumer auto-detects STA, `dataArray`, and single-`reading` JSON. CSV is
still supported for other consumers: set **dataFormat = Csv** and append
`?format=csv`. The `state` sensor charts as a step line (its STA category labels
show in the tooltip; CSV encodes the ordinal index).

## How seeding works

Each value is produced by a small `mulberry32` PRNG seeded from a mix of
`(seed, sensor type, time bucket)`:

- **Continuous** sensors combine three things on top of the normalized diurnal
  curve:
  - a **profile** — a fixed personality per `(seed, type)`: swing amplitude
    (`gain`), baseline shift (`level`), peak timing (`phaseHours` up to ±1.5 h)
    and noisiness (`noiseScale`). This is what makes two seeds look like two
    different physical sensors rather than one curve drawn twice.
  - four **noise octaves** (day, 3 h, 20 min, 15 s), each cosine-interpolated
    between seeded control points and weighted 0.30 / 0.28 / 0.24 / 0.18. The
    day octave gives day-to-day character; the 15 s octave gives per-reading
    measurement jitter.
  - sparse **events** for sensors that declare an `eventRate` (bursts per day) —
    short Gaussian spikes where they are physical: a machine starting
    (`energy_consumption`), a tap opening (`flow`), a door slamming
    (`noise_level`), a room filling up (`air_quality`).

  The profile scales the swing *above the shape's daily floor*, and both noise
  and events scale with how active the sensor is, so overnight behavior stays
  physical for every seed (a dark room stays dark) while daytime values spread
  out visibly. The result is scaled into the effective range and soft-clamped —
  strong seeds round off near the ceiling instead of flat-lining against it.
- **Discrete** sensors draw from a 1-second time bucket: `movement` compares the
  PRNG against a time-of-day probability; `state` picks a label by time-of-day
  weights.

Because the seed derives from the timestamp, **the same
type + seed + timestamp + params always yields the same value**, while a
different seed produces a different but equally reproducible series. Time-of-day
is evaluated at the **fixed offset of `tz`** (EDT by default) rather than in the
server's zone, so results depend only on the URL. Changing `tz` shifts the curve
(that is the point) but each zone stays reproducible.

## Example URLs

```
# Manifest
/api/sensors

# Formats (default is sta)
/api/sensor/temperature                              # STA Datastream + Observations (default)
/api/sensor/temperature?format=csv                   # header-less time,value CSV (for CollabDT)
/api/sensor/temperature?format=dataArray             # compact OGC {components, dataArray}
/api/sensor/temperature?format=reading               # single latest reading

# Windowing
/api/sensor/temperature?points=50&format=dataArray   # 50-row dataArray
/api/sensor/temperature?window=24h                   # last 24h, downsampled ≤1000
/api/sensor/flow?seed=7&window=24h&format=csv         # 24h CSV window

# Seeding, range, fixed instant
/api/sensor/temperature?seed=2&min=-20&max=50        # stretched across -20..50
/api/sensor/temperature?at=2026-07-23T14:05:00Z      # window ending at a fixed instant

# Timezone (default EDT, case-insensitive, `timezone=` also works)
/api/sensor/temperature?tz=PDT&format=csv            # local clock + curve on Pacific time
/api/sensor/temperature?timezone=utc                 # UTC: ISO timestamps keep the Z spelling
/api/sensor/temperature?tz=UTC%2B05:30               # explicit offset for ambiguous zones
/api/sensor/temperature?tz=JST&at=2026-07-23T09:00:00 # `at` read as 09:00 local (JST)

# Discrete sensors
/api/sensor/state                                    # STA: result is a string label
/api/sensor/state?format=csv                         # CSV: result is the ordinal index
/api/sensor/movement?format=sta                      # STA: result is a boolean
```

## Adding or modifying a sensor

Everything is config-driven. To add a sensor, add **one entry** to `SENSORS` in
[`lib/config.ts`](lib/config.ts):

```ts
my_sensor: {
  unit: "kPa",
  min: 0,
  max: 500,
  kind: "continuous",
  frequency: 60000,
  unitOfMeasurement: {
    name: "kilopascal",
    symbol: "kPa",
    definition: "https://qudt.org/vocab/unit/KiloPA",
  },
  observedProperty: {
    name: "Gauge Pressure",
    definition: "https://dbpedia.org/page/Pressure",
  },
  noise: 0.05,
  // Normalized [0,1] baseline as a function of hour-of-day (0..24).
  shape: (h) => diurnal(h, 15),
},
```

- `kind: "continuous"` → provide `shape(hour) => [0,1]`. Reuse the `diurnal`,
  `daylight`, and `bump` helpers in the same file. Optionally add
  `eventRate: n` (bursts per day) when short spikes are physical for that
  phenomenon; leave it off for smooth ones (temperature, pressure, daylight).
- `kind: "binary"` → provide `prob(hour) => [0,1]` and omit `shape`.
- `kind: "enum"` → provide `values: string[]` and `weights(hour) => number[]`.

No other file needs to change — the route handler, manifest, and dashboard all
read from `SENSORS`, and `observationType` is derived from `kind`. To tweak an
existing sensor, edit its entry (range, `noise` amplitude, `frequency`, or curve).

## Architecture

```
app/
  api/
    sensor/[type]/route.ts   # windowed data, format dispatch (dynamic, no-store)
    sensors/route.ts         # manifest
  page.tsx                   # live demo dashboard with inline-SVG sparklines
lib/
  types.ts                   # shared types
  config.ts                  # per-sensor config + OGC metadata (the extension point)
  prng.ts                    # mulberry32 + seed helpers
  generator.ts               # curve + layered noise + windowing
  params.ts                  # query-param parsing/validation
  timezones.ts               # `?tz=` abbreviations -> fixed UTC offsets
  format.ts                  # CSV / STA / dataArray renderers
public/sensor-examples/      # reference CSVs (curve shape only, not read at runtime)
```

The sensor route is dynamic (`force-dynamic`) and served with
`Cache-Control: no-store` so readings feel live; the manifest uses a short
`max-age`.

## Testing

```bash
yarn test        # Vitest: determinism, layered noise, windowing, formats, validation
```

## Deploy to Vercel

This is a stock Next.js App Router app with no environment variables or
database, so it deploys as-is.

1. Push the repo to GitHub/GitLab/Bitbucket.
2. Import it at [vercel.com/new](https://vercel.com/new) — Vercel auto-detects
   Next.js; no configuration needed.
3. Deploy. Endpoints are live at `https://<your-project>.vercel.app/api/sensor/...`.

## Latest changes

Newest first. Each item links to the section with the full reference.

### Timezones (`?tz=`)

A series can now be timed in any zone rather than always in UTC. `?tz=PDT` moves
the diurnal peak to Pacific local noon, renders CSV times as a local clock, and
stamps STA/`dataArray` timestamps with the zone offset (`…T10:05:00.000-04:00`)
instead of `Z`. The default is `EDT`, `?timezone=` works as an alias, and a
zoneless `at` is read in the requested zone so `?tz=JST&at=2026-07-23T09:00:00`
means 09:00 in Tokyo.

Abbreviations resolve to **fixed** offsets, never IANA zones with DST rules —
that is what keeps a URL reproducible, and it means you pick the abbreviation for
the season you are demoing (`EST` in winter, `EDT` in summer). `CST`/`CDT` are
read as US Central; genuinely ambiguous ones like `IST` are rejected in favour of
an explicit offset (`?tz=UTC%2B05:30`). `GET /api/sensors` lists every accepted
abbreviation. See [Parameters](#parameters).

### Seeds that look like different sensors

Two seeds used to produce the same curve drawn twice. Each `(seed, type)` now
gets a **profile** — swing amplitude, baseline shift, peak timing up to ±1.5 h,
and noisiness — layered with seeded noise at **four time scales** (day, 3 h,
20 min, 15 s) and, for sensors where a spike is physical, **sparse events**: a
machine starting on `energy_consumption`, a tap opening on `flow`, a door
slamming on `noise_level`, a room filling up on `air_quality`.

Swing scales above the shape's daily floor and both noise and events scale with
how active the sensor is, so overnight behavior stays physical for every seed (a
dark room stays dark) while daytime values spread out visibly. Peaks are
soft-clamped, so a strong seed rounds off near the ceiling instead of
flat-lining against it. See [How seeding works](#how-seeding-works).

### OGC SensorThings as the default response

The bare URL returns a SensorThings **Datastream** — `unitOfMeasurement`,
`observationType`, an inline `Sensor` and `ObservedProperty`, `@iot.*`
annotations, and embedded `Observations` — so a CollabDT sensor set to
`dataFormat = Json` picks up the unit automatically with no extra configuration.
CSV is unchanged but now lives behind `?format=csv`. See
[STA response](#sta-response-default) and
[`docs/ogc-sensorthings-integration.md`](docs/ogc-sensorthings-integration.md).
