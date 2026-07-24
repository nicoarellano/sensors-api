# Synthetic Sensor API — OGC SensorThings Integration Guide

**Audience:** the CollabDT consumer (`core-local` sensor components + `cdt-na`).
**Purpose:** describe the enriched OGC SensorThings (STA, OGC 18-088) responses this
API serves, and how to consume them in a standards-aligned way.

> **Status.** This documents the **target** contract for the enriched `format=sta`
> response (STA entity graph + `@iot.*` annotations). The other formats (`csv`,
> `dataArray`, `reading`) and all query params are already live. Consume defensively:
> read the fields you need, ignore the rest — every field below is additive and safe
> to skip.

Reference deployment: `https://sensors-api-tau.vercel.app` (substitute your own).
CORS: `Access-Control-Allow-Origin: *` on `/api/*`, so a browser client can fetch
these cross-origin.

---

## 1. Endpoint and formats

```
GET /api/sensor/{type}?format={sta|csv|dataArray|reading}&…
```

`{type}` is one of the 11 sensor types (case-insensitive) in §6. **Default format is
`sta`.** Unknown type → `404 { error, validTypes }`. Bad param → `400 { error }`.

| `format`    | Content-Type | Shape | Use it for |
|-------------|--------------|-------|------------|
| `sta` *(default)* | `application/json` | STA **Datastream** entity graph (§3) | Rich, self-describing series; carries the unit and semantic labels |
| `dataArray` | `application/json` | Compact OGC `dataArray` (§4) | Same points, ~⅓ the bytes; bandwidth-constrained polling |
| `csv`       | `text/csv`   | Header-less `time,value` (§5) | Drop-in for the legacy CSV chart path |
| `reading`   | `application/json` | Single latest reading (§5) | One current value, no history |

## 2. Query parameters

| Param    | Type            | Default | Notes |
|----------|-----------------|---------|-------|
| `format` | enum            | `sta`   | `sta` \| `csv` \| `dataArray` \| `reading`. Invalid → 400. |
| `points` | integer ≥ 1     | `288`   | Number of samples, spaced at the type's frequency. Capped at **1000**. |
| `window` | duration string | —       | Total span (`24h`, `90m`, `30s`, `1500ms`, or bare seconds). Samples at the type's frequency, **downsampled to ≤ 1000 points**. Overrides `points`. |
| `seed`   | integer         | `0`     | Deterministic PRNG seed. Same seed+time+params ⇒ same values. |
| `min`    | number          | type default | Override the lower bound (continuous only). |
| `max`    | number          | type default | Override the upper bound (continuous only). |
| `at`     | ISO 8601        | now     | End the window at a fixed instant (for reproducible tests). |

**History + live from one URL.** Every window ends at "now" and rolls forward,
anchored to frequency-sized buckets. Store the URL once; re-fetch on the poll
interval and replace the series — one call returns the 288-point history and the
updated tip.

## 3. `format=sta` — the STA Datastream graph

A single **Datastream** entity that links a **Sensor** and an **ObservedProperty**
and embeds its **Observations**, with standard `@iot.*` annotations.

```jsonc
{
  "@iot.id": 1,
  "@iot.selfLink": "https://<host>/api/sensor/temperature?format=sta",
  "name": "Air Temperature",
  "description": "Synthetic Air Temperature datastream for temperature.",
  "observationType": "http://www.opengis.net/def/observationType/OGC-OM/2.0/OM_Measurement",
  "unitOfMeasurement": {
    "name": "degree Celsius",
    "symbol": "°C",
    "definition": "https://qudt.org/vocab/unit/DEG_C"
  },
  "phenomenonTime": "2026-07-23T14:30:00.000Z/2026-07-24T14:30:00.000Z",
  "resultTime":     "2026-07-23T14:30:00.000Z/2026-07-24T14:30:00.000Z",
  "properties": { "seed": 0, "frequency": 300000, "generator": "sensors-api" },

  "Sensor@iot.navigationLink": "https://<host>/api/sensor/temperature?format=sta",
  "Sensor": {
    "@iot.id": 1,
    "name": "Synthetic temperature sensor",
    "description": "Deterministic diurnal curve + seeded noise.",
    "encodingType": "text/html",
    "metadata": "https://github.com/nicoarellano/sensors-api"
  },

  "ObservedProperty@iot.navigationLink": "https://<host>/api/sensor/temperature?format=sta",
  "ObservedProperty": {
    "@iot.id": 1,
    "name": "Air Temperature",
    "definition": "https://dbpedia.org/page/Temperature",
    "description": "Air Temperature"
  },

  "Observations@iot.navigationLink": "https://<host>/api/sensor/temperature?format=dataArray",
  "Observations@iot.count": 288,
  "Observations": [
    {
      "@iot.id": 1,
      "phenomenonTime": "2026-07-23T14:30:00.000Z",
      "resultTime": "2026-07-23T14:30:00.000Z",
      "result": 23.71
    }
  ]
}
```

### Field reference

| Field | Type | Meaning |
|-------|------|---------|
| `@iot.id` | number | Stable synthetic id (the type's index; same across this type's Datastream/Sensor/ObservedProperty). Not globally unique — there is no instance store here. |
| `@iot.selfLink` | string | Absolute URL of this Datastream (the `?format=sta` URL). |
| `name`, `description` | string | Human labels. `name` is the observed property name; safe as a chart title. |
| `observationType` | string (URI) | OGC OM type; see §7. Tells you the `result` type. |
| `unitOfMeasurement` | `{ name, symbol, definition }` | UCUM/QUDT unit. **All three are `null`** for unitless kinds (`movement`, `state`). `symbol` is what you show on the chart. |
| `phenomenonTime` / `resultTime` | string | ISO 8601 **interval** `start/end` covering the window. Use for the chart's time-axis domain. |
| `properties` | object | Non-standard extras under the standard `properties` bag: `seed`, `frequency` (ms), `generator`. (Phase 2: CDT display hints will land here / on a Thing — see §8.) |
| `Sensor` | entity | The generating procedure. `encodingType`/`metadata` follow STA; `metadata` is the repo URL. |
| `ObservedProperty` | entity | `name` + `definition` (phenomenon IRI). Good source for a series label. |
| `Observations@iot.count` | number | Number of embedded observations. |
| `Observations[]` | array | Each: `@iot.id`, `phenomenonTime` (ISO), `resultTime` (ISO), `result`. |
| `result` | number \| boolean \| string | Typed per `observationType` (§7). |
| `*@iot.navigationLink` | string | Where the related entity/collection lives. `Observations@iot.navigationLink` resolves to the real `?format=dataArray` endpoint. |

> **Not included:** `Thing`, `Location`, `FeatureOfInterest`, `HistoricalLocation`.
> Those describe *deployment and geography*, which this synthetic per-type API does
> not own. CDT supplies them from its own `Sensor` record (`latitude`/`longitude`/
> `elevation`) and attaches this Datastream to its own Thing.

## 4. `format=dataArray` — compact observations

The OGC `dataArray` extension: the same observations as rows, no per-row keys.

```jsonc
{
  "components": ["phenomenonTime", "result"],
  "dataArray@iot.count": 288,
  "dataArray": [
    ["2026-07-24T13:41:00.000Z", 23.71],
    ["2026-07-24T13:46:00.000Z", 23.68]
  ]
}
```

`components` names the column order. `result` is typed as in §7. Prefer this over
`sta` when you already know the unit and only need points to plot.

## 5. `format=csv` and `format=reading`

**CSV** — header-less, one point per line; `time` is clock-style UTC `H:MM:SS`;
`value` is `parseFloat`-able for every kind (`state` → ordinal index).

```
14:30:00,23.71
14:35:00,23.68
```

**reading** — one current value:

```jsonc
{ "type": "temperature", "unit": "°C", "seed": 0,
  "timestamp": "2026-07-24T10:55:17.465Z", "value": 26.61, "min": 15, "max": 30 }
```

## 6. Sensor types

| Type | Unit | Default range | Frequency | Kind |
|------|------|---------------|-----------|------|
| `temperature` | °C | 15 – 30 | 5 min | continuous |
| `light` | lux | 0 – 100000 | 5 min | continuous |
| `humidity` | %RH | 0 – 100 | 5 min | continuous |
| `energy_consumption` | W | 100 – 3000 | 1 min | continuous |
| `movement` | bool | 0 / 1 | 1 s | binary |
| `air_quality` | ppm | 400 – 2000 | 1 min | continuous |
| `atmospheric_pressure` | hPa | 980 – 1040 | 10 min | continuous |
| `irradiance` | W/m² | 0 – 1000 | 5 min | continuous |
| `flow` | L/min | 0 – 12 | 5 s | continuous |
| `state` | enum (`on`/`off`/`idle`/`error`) | — | 10 s | enum |
| `noise_level` | dB | 30 – 80 | 1 s | continuous |

`frequency` maps to a CollabDT sensor's `updateFrequency` and is the window's
default sample cadence.

## 7. OGC observation-type mapping

| Kind | `observationType` (URI suffix) | `result` type | Types |
|------|-------------------------------|---------------|-------|
| continuous | `OM_Measurement` | number | temperature, light, humidity, energy_consumption, air_quality, atmospheric_pressure, irradiance, flow, noise_level |
| binary | `OM_TruthObservation` | boolean | movement |
| enum | `OM_CategoryObservation` | string | state |

Full URIs are `http://www.opengis.net/def/observationType/OGC-OM/2.0/<suffix>`.

## 8. How to consume this (recommended)

**Principle:** the STA server is rich; the client selects what it needs. Read the
subset you use and ignore unknown keys — that is what keeps you forward-compatible.

1. **Auto-detect the JSON shape** (one parser handles all three):
   - has `Observations[]` → STA Datastream: unit = `unitOfMeasurement?.symbol`;
     points from `Observations[].phenomenonTime` + `result`.
   - has `dataArray[]` → map rows via `components` index; no unit present.
   - has `result`/`value` (no arrays) → single reading; unit = `unit ?? unitOfMeasurement?.symbol`.
2. **Coerce `result`** for the chart: number → as-is; boolean → `0/1`; category
   string → stable first-seen ordinal (keep a label map for the tooltip).
3. **Time** → convert each ISO `phenomenonTime` to your chart's `H:MM:SS` UTC clock
   string. Use the Datastream `phenomenonTime` interval for the axis domain.
4. **Labels** → use `ObservedProperty.name` (or `Datastream.name`) as the series
   title; `unitOfMeasurement.symbol` for the value axis/tooltip.
5. **Polling** → re-fetch the stored URL every `updateFrequency` ms (floor 1000 ms)
   and replace the series. The window rolls forward on its own.
6. **Bandwidth** → if you already have the unit, follow `Observations@iot.navigationLink`
   (`?format=dataArray`) for the lighter payload.
7. **Backward-compatible** → a parser that only sniffs `Observations[]` +
   `unitOfMeasurement.symbol` keeps working against the enriched response; the new
   `@iot.*`, `Sensor`, `ObservedProperty`, and `properties` fields are optional reads.

Minimal parse target:

```ts
interface SensorSeries {
  points: { time: string; value: number }[]
  unit?: string                        // unitOfMeasurement.symbol
  label?: string                       // ObservedProperty.name / Datastream.name
  valueLabels?: Record<number, string> // ordinal -> category label (enum sensors)
}
```

## 9. Phase 2 — schema alignment (CollabDT side, gated)

When you evolve `cdt-na/prisma/schema.prisma` to mirror STA (owned by Gurleen —
get sign-off before editing):

- `model SensorType` (per-type, mirrors this API's config): `observationType String?`,
  `unitOfMeasurement Json?` (`{ name, symbol, definition }`), `observedProperty Json?`
  (`{ name, definition }`), `defaultFrequency Int?` (seeds `Sensor.updateFrequency`).
- `model Sensor` (per-instance, the STA **Thing** analog): add `properties Json?` to
  hold `cdt:` display hints (`minThreshold`, `maxThreshold`, colours, icon) — these
  will surface under the STA `properties` bag rather than as bespoke columns.
- `SensorDataFormat` stays `Csv | Json` (auto-detect STA / dataArray / reading within
  `Json`). No new enum members are required for STA alignment.

At that point the chart can prefer live values from the STA payload and fall back to
the stored `SensorType.unitOfMeasurement.symbol` when a payload carries no unit
(e.g. `dataArray` or CSV).

## 10. Determinism

Values come from a `mulberry32` PRNG seeded from `(seed, type, time bucket)` plus a
diurnal shape and two noise layers (slow drift + fine jitter). The same
`type + seed + timestamp + params` always yields the same value; time is evaluated in
**UTC**. So `?at=` fixed URLs are reproducible in tests, while "now" URLs fluctuate
gently between polls.
