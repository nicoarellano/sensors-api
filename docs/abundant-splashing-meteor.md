# Synthetic Sensor API — OGC-aligned generation + CDT-consumable output

## Context

The base synthetic sensor API is already built and on the user's GitHub (11 sensor
types, seeded deterministic values, `/api/sensor/[type]` + `/api/sensors`, Vitest
suite, dashboard). Two problems prompted this phase:

1. **Consecutive readings look identical** — the noise varies too slowly (2h
   control points), so polling shows a static number.
2. **The output shape doesn't match how the data is actually consumed or how real
   IoT sensors model data.** We researched both ends:
   - **Real IoT (OGC SensorThings API, 18-088):** a *Datastream* fixes
     `unitOfMeasurement {name,symbol,definition}`, `observationType` (URI), and an
     `observedProperty`, and emits *Observations* — each an ISO-8601
     `phenomenonTime` + a `result` (type per observationType: `OM_Measurement`→double,
     `OM_TruthObservation`→boolean, `OM_CategoryObservation`→IRI/string). Bulk series
     use the compact `dataArray` form (`{components, dataArray}`).
   - **Actual CDT consumer** (`core-local/src/core/components/ui/Sensors/`):
     `Sensor.tsx`/`CollapsibleSensorItem.tsx` `fetch()` a user-supplied **Data URL**
     and parse **plain CSV** (`time,value`, clock-style time e.g. `14:30:00`, **no
     header**) into `{time, value}[]`, which `SensorChart.tsx` (recharts area chart,
     `dataKey="time"`/`"value"`) renders. `dataFormat` offers `Csv`/`Json` but **only
     CSV is parsed today**. There is **no polling** — `updateFrequency` (stored in ms)
     is display-only metadata. `SensorTypes` enum == our 11 types; chart colors and
     `minValue`/`maxValue` come from the host's `SensorType`.

**Goal:** generate one realistic series per sensor and serve it both as the **CSV
that drops straight into a CDT sensor's Data URL and renders in `SensorChart`
today**, and as **OGC-SensorThings-shaped JSON** (Datastream + Observations, plus
`dataArray`) so it's structured like real IoT data. Make readings visibly (but
gently) fluctuate.

### Decisions (confirmed with user)
- **Pragmatic bridge**, not a full STA server: CSV default + `?format=sta` /
  `?format=dataArray`; enrich config with OGC metadata + frequency. No STA entity
  routing / `$filter`.
- **URL-driven windowing:** default `?points=N` (default 288, max 1000) sampled at
  the sensor's frequency; also `?window=24h` or a custom duration (`6h`, `90m`,
  `30s`, `1000ms`) → sample at frequency, **downsample to cap at 1000 points**.
- **Gentle per-reading noise:** each reading = smooth diurnal phenomenon + slow
  drift + a *small* fast jitter hashed from the exact timestamp+seed. Visibly moves
  up/down, stays smooth-ish, fully deterministic.

## Design

### `lib/config.ts` — per-sensor additions
Add to each entry (and to `SensorConfig` in `types.ts`):
- `frequency`: default sampling interval ms (e.g. temperature/light/humidity/irradiance
  300000; energy/air_quality 60000; pressure 600000; flow 5000; state 10000;
  movement/noise_level 1000). This maps to the CDT sensor's `updateFrequency`.
- `unitOfMeasurement: { name, symbol, definition }` (UCUM/QUDT URI; `null` trio for
  discrete truth/category sensors).
- `observedProperty: { name, definition }` (phenomenon URI).
- `observationType` derived from `kind` via a helper (`continuous`→`OM_Measurement`,
  `binary`→`OM_TruthObservation`, `enum`→`OM_CategoryObservation`), constants for the
  OGC URIs.

### `lib/generator.ts` — noise + windowing
- **Gentle fluctuation:** `value = clamp01(shape(hour) + drift + jitter)` scaled to
  range, where `drift` = existing smooth control-point noise (majority of amplitude)
  and `jitter` = a *small* component from `mulberry32(mixSeed(seed, type, msBucket))`
  keyed to the exact sample time. Split ~70/30 so consecutive samples differ but the
  curve reads smooth. Keep clamp + rounding. Determinism preserved.
- **Window generator** `generateWindow(type, params, { points?, windowMs? })` →
  ordered array of `{ at: Date, value: number|string }`:
  - cadence = `min(frequency, windowMs/1000)`; if `windowMs` given, step = frequency
    but **downsample** so length ≤ 1000; if `points` given, span = points×frequency.
  - ends at `params.at` (or now), anchored to frequency buckets.
  - Reuse existing `computeValue`. `generateReading` (single) stays for `?format=reading`.
- Provide a clock-style time string per point (`H:MM:SS`, UTC) for CSV, and the
  absolute `Date` (ISO) for STA/dataArray.

### `lib/params.ts` — new params
- `format`: `csv` (default) | `sta` | `dataArray` | `reading`. Invalid → 400.
- `points`: int ≥1, default 288, cap 1000. Non-int → 400.
- `window`: duration string (`24h`|`90m`|`30s`|`1500ms`|bare seconds). Parse → ms;
  invalid → 400. `window` present ⇒ windowMs path; else points path.
- Keep `seed`, `min`, `max`, `at`. Drop/alias the old `series` flag to `format=csv`.

### `lib/format.ts` — new, renderers over the window
- `toCsv(points)` → header-less `time,value\n…`. Continuous/binary values numeric;
  **`state` encoded as its ordinal index** (0..n) so `parseFloat` charts a step line
  (documented); STA keeps the string label.
- `toSta(type, params, points)` → OGC Datastream object: `name`, `description`,
  `unitOfMeasurement`, `observationType`, `ObservedProperty`, `phenomenonTime`
  interval envelope, and `Observations: [{ phenomenonTime(ISO), resultTime, result }]`.
- `toDataArray(points)` → `{ components: ["phenomenonTime","result"], "dataArray@iot.count", dataArray: [[iso, result], …] }`.

### Routes
- **`app/api/sensor/[type]/route.ts`**: after validation, build the window and
  dispatch on `format`: `csv` → `text/csv; charset=utf-8` body; `sta`/`dataArray` →
  `NextResponse.json`; `reading` → current single-reading JSON. Keep
  `Cache-Control: no-store`. 404/400 unchanged.
- **`app/api/sensors/route.ts`**: extend each manifest entry with `frequency`,
  `unitOfMeasurement`, `observationType`, `observedProperty`, and a ready-to-paste
  `csvUrl` example. (Widen to `SensorConfig` — already done.)

### `app/page.tsx` — dashboard
- Per live tile, fetch the CSV window and draw a **dependency-free inline-SVG area
  sparkline** (matches SensorChart's look; no recharts in this app), show the current
  value, and a **copyable Data URL** plus `?format=sta`/`dataArray` links. This
  demonstrates exactly what a CDT user pastes into `SensorInput` (dataFormat = Csv).

### Tests (extend Vitest)
- `params.test.ts`: `format`, `points` (default/cap/invalid), `window` durations +
  invalid, precedence.
- `generator.test.ts`: gentle noise — consecutive samples differ yet bounded and
  within range; determinism per (seed, exact time); window length/cadence for points
  vs window (incl. 24h downsample ≤1000); clock-string format.
- new `format.test.ts`: CSV is header-less & `parseFloat`-able for every kind (replicate
  the `Sensor.tsx` split(',')/parseFloat parser and assert no NaN except intended);
  `state` CSV ordinal; STA shape (unitOfMeasurement present, observationType matches
  kind, `result` numeric for OM_Measurement, ISO `phenomenonTime`); dataArray shape.

### README
Add: formats table, windowing/frequency params, OGC mapping table (kind→observationType,
units), example STA + dataArray responses, and a **"Use in CollabDT"** section: create a
sensor in `SensorInput`, set dataFormat=Csv, paste `https://<deploy>/api/sensor/<type>`
as the Data URL; set update frequency to the sensor's default.

## Critical files
- Modify: `lib/config.ts`, `lib/types.ts`, `lib/generator.ts`, `lib/params.ts`,
  `app/api/sensor/[type]/route.ts`, `app/api/sensors/route.ts`, `app/page.tsx`,
  `README.md`. Add: `lib/format.ts`, `lib/format.test.ts`.
- Contract references (read-only, do not modify): `core-local/.../Sensors/SensorChart.tsx`
  (`{time,value}[]`, tick formatter), `Sensor.tsx` (CSV `split('\n')`/`split(',')`/`parseFloat`),
  `SensorInput.tsx` (Data URL + dataFormat + updateFrequency×unit ms),
  `core-local/src/core/types/dbTypes.ts` (`SensorTypes`, `Sensor`, `SensorType`),
  `core-local/src/core/utils/timeUtils.ts` (`frequencyUnits`, `formatDuration`).

## Verification
1. `yarn test` green (params, generator, format); `npx tsc --noEmit` clean; `yarn lint`; `yarn build`.
2. `yarn start` on a free port, then:
   - `/api/sensor/temperature` → header-less CSV `time,value`, 288 rows, clock-style
     time, every value `parseFloat`-able and within 15–30.
   - `/api/sensor/temperature?window=24h` → spans ~24h, ≤1000 rows.
   - `/api/sensor/temperature?points=50&format=dataArray` → `{components:["phenomenonTime","result"], dataArray:[[ISO,num]…]}` length 50.
   - `/api/sensor/temperature?format=sta` → Datastream w/ `unitOfMeasurement`,
     `observationType …OM_Measurement`, `Observations[].phenomenonTime` ISO + numeric `result`.
   - Two `/api/sensor/temperature?points=1` a second apart → values differ slightly (fluctuation), while fixed `?at=` is identical (determinism).
   - `/api/sensor/state?format=sta` → `result` is a label; `?format=csv` → ordinal index.
   - Errors: bad `format`/`window`/`points` → 400; unknown type → 404.
3. CSV-contract test asserts the exact `Sensor.tsx` parser yields clean `{time,value}`
   points (stands in for rendering in `SensorChart`, which needs the core-local app to run).
