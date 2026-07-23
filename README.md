# Synthetic Sensor API

A Next.js (App Router, TypeScript) service that generates synthetic, sensor-like
"real-time" data and serves it as JSON. Each reading is computed from the current
wall-clock time (or a supplied timestamp) plus a seeded PRNG, so the same URL is
always reproducible and different seeds simulate different physical sensors.

Values follow a realistic diurnal profile (a function of time-of-day) plus
bounded, smooth seeded noise, and are always clamped to the effective range.
There is no unbounded random walk.

## Quick start

```bash
yarn install
yarn dev        # http://localhost:3000
```

Then open the dashboard at `http://localhost:3000` or hit an endpoint:

```
http://localhost:3000/api/sensor/temperature?seed=2
```

Other scripts: `yarn build`, `yarn start`, `yarn lint`, `yarn test`.

## API

### `GET /api/sensor/{type}`

Returns a single reading (or a 24h series with `?series=1`).

```json
{
  "type": "temperature",
  "unit": "°C",
  "seed": 2,
  "timestamp": "2026-07-23T14:05:00.000Z",
  "value": 23.7,
  "min": 15,
  "max": 30
}
```

`min`/`max` echo the **effective** range and are present for continuous sensors
only. Discrete sensors (`movement`, `state`) omit them.

#### Parameters

| Param    | Type            | Default | Notes |
|----------|-----------------|---------|-------|
| `{type}` | path segment    | —       | Required. One of the sensor types below. Case-insensitive. |
| `seed`   | integer         | `0`     | Seeds a deterministic PRNG. Different seeds → different reproducible series. |
| `min`    | number          | type default | Override the lower bound. May be supplied alone. |
| `max`    | number          | type default | Override the upper bound. May be supplied alone. |
| `at`     | ISO 8601 string | now     | Compute the value at a specific instant instead of "now". |
| `series` | flag            | off     | Return an array of `{ timestamp, value }` over the last 24h at 5-minute cadence. `series=0`/`false` disables it. |

**Range precedence & scaling.** User `min`/`max` override the type defaults, and
the diurnal curve scales into whatever range is effective. So
`?min=-20&max=50` stretches the daily shape across that whole band rather than
clipping the default 15–30 curve. The final value is always clamped to the
effective range.

**Discrete sensors.** `movement` (0/1) and `state` (enum) ignore `min`/`max`;
supplying them is accepted but has no effect.

#### Errors

- Unknown/invalid `{type}` → **404** with `{ error, validTypes: [...] }`.
- Malformed params (non-numeric `seed`/`min`/`max`, `min > max`, unparseable
  `at`) → **400** with `{ error }` describing the problem.

#### Series response

```json
{
  "type": "flow",
  "unit": "L/min",
  "seed": 7,
  "min": 0,
  "max": 12,
  "series": [
    { "timestamp": "2026-07-22T19:25:00.000Z", "value": 0 },
    { "timestamp": "2026-07-22T19:30:00.000Z", "value": 0 }
  ]
}
```

### `GET /api/sensors`

Manifest listing every sensor type with its default `unit`, `kind`, `min`,
`max` (and `values` for enum sensors).

## Sensor types

| Type                   | Unit    | Default range | Behavior |
|------------------------|---------|---------------|----------|
| `temperature`          | °C      | 15 – 30       | Diurnal, coolest before dawn, warmest mid-afternoon |
| `light`                | lux     | 0 – 100000    | Dark at night, midday peak |
| `humidity`             | %RH     | 0 – 100       | Inverse of temperature |
| `energy_consumption`   | W       | 100 – 3000    | Load curve with morning + evening peaks |
| `movement`             | bool    | 0 / 1         | Sparse occupancy events, day-biased |
| `air_quality`          | ppm     | 400 – 2000    | CO₂ builds through occupied daytime hours |
| `atmospheric_pressure` | hPa     | 980 – 1040    | Slow drift around mid-range |
| `irradiance`           | W/m²    | 0 – 1000      | Correlated with light |
| `flow`                 | L/min   | 0 – 12        | Flat (mostly zero) at night, smooth daytime burst |
| `state`                | enum    | on/off/idle/error | Mostly on/idle by day, off/idle by night, error rare |
| `noise_level`          | dB      | 30 – 80       | Quiet at night, loud through the day |

## How seeding works

Each value is produced by a small `mulberry32` PRNG seeded from a mix of
`(seed, sensor type, timestamp bucket)`:

- **Continuous** sensors add smooth noise to a normalized diurnal curve. The
  noise comes from seeded control points every 2 hours, cosine-interpolated, so
  it drifts gently instead of jittering. The result is scaled into the effective
  range and clamped.
- **Discrete** sensors draw from a 5-minute time bucket: `movement` compares the
  PRNG against a time-of-day probability; `state` picks a label by time-of-day
  weights.

Because the seed derives from the timestamp, **the same
type + seed + timestamp + params always yields the same value**, while a
different seed produces a different but equally reproducible series. Time is
evaluated in **UTC** so results are identical regardless of server timezone.

## Example URLs

```
/api/sensors
/api/sensor/temperature?seed=2
/api/sensor/temperature?seed=2&min=-20&max=50     # stretched across -20..50
/api/sensor/temperature?at=2026-07-23T14:05:00Z    # value at a fixed instant
/api/sensor/flow?seed=7&series=1                   # 24h series, 288 points
/api/sensor/state                                  # discrete enum
/api/sensor/movement?seed=3                         # 0 or 1
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
read from `SENSORS`. To tweak an existing sensor, edit its entry (range,
`noise` amplitude, or curve).

## Architecture

```
app/
  api/
    sensor/[type]/route.ts   # single reading or ?series=1 (dynamic, no-store)
    sensors/route.ts         # manifest
  page.tsx                   # live-polling demo dashboard
lib/
  types.ts                   # shared types
  config.ts                  # per-sensor config (the extension point)
  prng.ts                    # mulberry32 + seed helpers
  generator.ts               # curve + noise + clamp + scaling
  params.ts                  # query-param parsing/validation
public/sensor-examples/      # reference CSVs (curve shape only, not read at runtime)
```

Readings are served with `Cache-Control: no-store` so they feel live; the
manifest uses a short `max-age`.

## Testing

```bash
yarn test        # Vitest: determinism, clamping, range precedence, validation
```

## Deploy to Vercel

This is a stock Next.js App Router app with no environment variables or
database, so it deploys as-is.

1. Push the repo to GitHub/GitLab/Bitbucket.
2. Import it at [vercel.com/new](https://vercel.com/new) — Vercel auto-detects
   Next.js; no configuration needed.
3. Deploy. Endpoints are live at `https://<your-project>.vercel.app/api/sensor/...`.

The reading route is dynamic (`force-dynamic`), so each request is computed
fresh at request time.
