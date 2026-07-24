# Synthetic Sensor API

A Next.js (App Router, TypeScript) service that generates synthetic, sensor-like
time series and serves them both as **plain CSV that drops straight into a
CollabDT sensor's Data URL** and as **OGC SensorThings-shaped JSON** (Datastream +
Observations). Each value is computed from a timestamp plus a seeded PRNG, so the
same URL is always reproducible and different seeds simulate different physical
sensors.

Values follow a realistic diurnal profile (a function of time-of-day) plus two
layers of bounded, smooth seeded noise, and are always clamped to the effective
range. Consecutive readings fluctuate gently instead of jittering or sitting
still. There is no unbounded random walk.

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
(default `csv`). By default it returns **288 points** sampled at the sensor's
natural frequency, ending at "now".

#### Formats

| `format`    | Content-Type | Body |
|-------------|--------------|------|
| `csv` *(default)* | `text/csv; charset=utf-8` | Header-less `time,value` rows, one point per line. Clock-style UTC `H:MM:SS` time. This is what CollabDT's `SensorChart` fetches and parses. |
| `sta`       | `application/json` | An OGC SensorThings **Datastream** object with `unitOfMeasurement`, `observationType`, `ObservedProperty`, a `phenomenonTime` interval, and embedded `Observations[]`. |
| `dataArray` | `application/json` | The compact OGC `{ components, dataArray }` time-series form: rows of `[phenomenonTime, result]`. |
| `reading`   | `application/json` | A single latest reading (the legacy single-value shape) evaluated at `at`. |

#### Parameters

| Param    | Type            | Default | Notes |
|----------|-----------------|---------|-------|
| `{type}` | path segment    | —       | Required. One of the sensor types below. Case-insensitive. |
| `format` | enum            | `csv`   | `csv` \| `sta` \| `dataArray` \| `reading`. Invalid → 400. |
| `points` | integer ≥ 1     | `288`   | Number of samples, spaced at the sensor's frequency. Capped at **1000**. Non-integer → 400. |
| `window` | duration string | —       | Total span, e.g. `24h`, `90m`, `30s`, `1500ms`, or bare seconds. Samples at the sensor's frequency and **downsamples to ≤ 1000 points**. Overrides `points`. Invalid → 400. |
| `seed`   | integer         | `0`     | Seeds a deterministic PRNG. Different seeds → different reproducible series. |
| `min`    | number          | type default | Override the lower bound. May be supplied alone. |
| `max`    | number          | type default | Override the upper bound. May be supplied alone. |
| `at`     | ISO 8601 string | now     | End the window (or evaluate `reading`) at a specific instant instead of "now". |

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
  `at`, bad `format`/`points`/`window`) → **400** with `{ error }`.

#### CSV response (default)

```
14:30:00,23.71
14:35:00,23.68
14:40:00,23.74
```

No header row. `time` is clock-style UTC `H:MM:SS`; `value` is `parseFloat`-able
for every sensor kind.

#### STA response (`?format=sta`)

```json
{
  "name": "temperature (seed 0)",
  "description": "Synthetic Air Temperature datastream for temperature.",
  "unitOfMeasurement": {
    "name": "degree Celsius",
    "symbol": "°C",
    "definition": "https://qudt.org/vocab/unit/DEG_C"
  },
  "observationType": "http://www.opengis.net/def/observationType/OGC-OM/2.0/OM_Measurement",
  "ObservedProperty": {
    "name": "Air Temperature",
    "definition": "https://dbpedia.org/page/Temperature"
  },
  "phenomenonTime": "2026-07-22T14:30:00.000Z/2026-07-23T14:30:00.000Z",
  "Observations@iot.count": 288,
  "Observations": [
    {
      "phenomenonTime": "2026-07-22T14:30:00.000Z",
      "resultTime": "2026-07-22T14:30:00.000Z",
      "result": 23.71
    }
  ]
}
```

`result` is typed to match `observationType`: a number for `OM_Measurement`, a
boolean for `OM_TruthObservation` (`movement`), a string label for
`OM_CategoryObservation` (`state`).

#### dataArray response (`?format=dataArray`)

```json
{
  "components": ["phenomenonTime", "result"],
  "dataArray@iot.count": 50,
  "dataArray": [
    ["2026-07-23T13:41:00.000Z", 23.71],
    ["2026-07-23T13:46:00.000Z", 23.68]
  ]
}
```

### `GET /api/sensors`

Manifest listing every sensor type with its default `unit`, `kind`, `min`,
`max`, `frequency`, OGC `unitOfMeasurement`/`observationType`/`observedProperty`,
`values` (enum sensors), and a ready-to-paste `csvUrl`.

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

The default CSV output is designed to be pasted straight into a CollabDT sensor:

1. In `SensorInput`, create a sensor and set **dataFormat = Csv**.
2. Set the **Data URL** to `https://<your-deploy>/api/sensor/<type>` (optionally
   with `?seed=`, `?points=`, or `?window=`).
3. Set the sensor's **update frequency** to the type's default `frequency` above.

`SensorChart` fetches that URL and parses the header-less `time,value` CSV
directly. The `state` sensor charts as a step line via its ordinal encoding.

## How seeding works

Each value is produced by a small `mulberry32` PRNG seeded from a mix of
`(seed, sensor type, time bucket)`:

- **Continuous** sensors add two layers of smooth noise to a normalized diurnal
  curve: a slow **drift** (2h control points, the daily character) plus a small
  fast **jitter** (30s control points, per-reading measurement noise), split
  ~70/30 and cosine-interpolated. Consecutive samples differ slightly while the
  curve stays smooth. The result is scaled into the effective range and clamped.
- **Discrete** sensors draw from a 1-second time bucket: `movement` compares the
  PRNG against a time-of-day probability; `state` picks a label by time-of-day
  weights.

Because the seed derives from the timestamp, **the same
type + seed + timestamp + params always yields the same value**, while a
different seed produces a different but equally reproducible series. Time is
evaluated in **UTC** so results are identical regardless of server timezone.

## Example URLs

```
/api/sensors
/api/sensor/temperature                              # 288-point CSV window, now
/api/sensor/temperature?window=24h                   # last 24h, downsampled ≤1000
/api/sensor/temperature?points=50&format=dataArray   # 50-row OGC dataArray
/api/sensor/temperature?format=sta                   # OGC Datastream + Observations
/api/sensor/temperature?seed=2&min=-20&max=50        # stretched across -20..50
/api/sensor/temperature?at=2026-07-23T14:05:00Z      # window ending at a fixed instant
/api/sensor/state?format=sta                         # result is a label
/api/sensor/state                                    # CSV: ordinal index
/api/sensor/movement?format=sta                      # result is a boolean
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
  `daylight`, and `bump` helpers in the same file.
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
