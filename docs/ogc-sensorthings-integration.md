# Synthetic Sensor API — OGC SensorThings Integration Guide

**Audience:** the CollabDT consumer (`core-local` sensor components + `cdt-na`).
**Purpose:** describe the enriched OGC SensorThings (STA, OGC 18-088) responses this
API serves, and how to consume them in a standards-aligned way.

> **Status.** Everything below is live: all four formats, the full `format=sta`
> entity graph (`@iot.*` annotations, `Thing`/`Location`/`FeatureOfInterest`), and
> every query parameter. Consume defensively: read the fields you need, ignore the
> rest — every field is additive and safe to skip.

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
| `min`    | number          | rule's range | Override the lower bound (continuous only). |
| `max`    | number          | rule's range | Override the upper bound (continuous only). |
| `at`     | ISO 8601        | now     | End the window at a fixed instant (for reproducible tests). Without a zone designator it is read in `tz`. |
| `tz`     | timezone abbr   | `EDT`   | Zone the series is timed in. Case-insensitive; `timezone=` is an accepted alias; explicit offsets (`UTC-05:00`, `-0500`) work too. Invalid → 400. |
| `lat`    | -90 … 90        | `45`    | Site latitude, degrees north. Sets day length, sun height and the seasonal climate. `latitude=` is an alias. Invalid → 400. |
| `lon`    | -180 … 180      | `-75`   | Site longitude, degrees east. Sets where solar noon falls on the local clock; with a `tz` and no `lon`, that zone's central meridian is used. `lng=`/`longitude=` are aliases. Invalid → 400. |
| `placement` | enum         | `outdoor` | `outdoor` \| `indoor`. Exposed to the sky, or behind glazing and a control system. Invalid → 400. |

**Location and placement.** These are generation inputs, not decoration: an
`outdoor` thermometer at `lat=45` reports the season (below freezing in January),
while `indoor` is damped and held near a setpoint. The site appears in the
response as `observedArea`, `Thing.Locations[].location` and
`FeatureOfInterest.feature` (§3), and both are echoed in `properties` and carried
on every link, so following a link reproduces the same series. Full behavior table
in the [README](../README.md#location-and-placement).

**Timezone.** `tz` is a **fixed offset** named by abbreviation (`EST` vs `EDT`,
no DST transition rules), which keeps a URL reproducible. It does two things:
time-of-day for the diurnal curve is read in that zone, and timestamps are
rendered in it — `phenomenonTime`/`resultTime` carry the offset
(`2026-07-23T10:05:00.000-04:00`) instead of `Z`, and CSV `H:MM:SS` becomes a
local clock. The instants are unchanged, so `new Date(iso)` still gives the
correct absolute time. The zone is echoed at `properties.timezone` and appended
to the `@iot.selfLink`/`@iot.navigationLink` URLs so following a link reproduces
the same series. `GET /api/sensors` lists the accepted abbreviations
(`timezones`) and the default (`defaultTimezone`).

**History + live from one URL.** Every window ends at "now" and rolls forward,
anchored to frequency-sized buckets. Store the URL once; re-fetch on the poll
interval and replace the series — one call returns the 288-point history and the
updated tip.

## 3. `format=sta` — the STA Datastream graph

A single **Datastream** entity that links a **Thing** (with its **Location**), a
**Sensor** and an **ObservedProperty**, carries a **FeatureOfInterest**, and
embeds its **Observations**, with standard `@iot.*` annotations.

`$SITE` below stands for `&tz=EDT&lat=45&lon=-75&placement=outdoor` — the zone and
site of the request, appended to every link so following one reproduces the series.

```jsonc
{
  "@iot.id": 1,
  "@iot.selfLink": "https://<host>/api/sensor/temperature?format=sta$SITE",
  "name": "Air Temperature",
  "description": "Synthetic Air Temperature datastream for temperature.",
  "observationType": "http://www.opengis.net/def/observationType/OGC-OM/2.0/OM_Measurement",
  "unitOfMeasurement": {
    "name": "degree Celsius",
    "symbol": "°C",
    "definition": "https://qudt.org/vocab/unit/DEG_C"
  },
  "observedArea": { "type": "Point", "coordinates": [-75, 45] },
  "phenomenonTime": "2026-07-23T10:30:00.000-04:00/2026-07-24T10:30:00.000-04:00",
  "resultTime":     "2026-07-23T10:30:00.000-04:00/2026-07-24T10:30:00.000-04:00",
  "properties": {
    "seed": 0, "frequency": 300000, "generator": "sensors-api",
    "timezone": "EDT", "placement": "outdoor"
  },

  "Thing@iot.navigationLink": "https://<host>/api/sensor/temperature?format=sta$SITE",
  "Thing": {
    "@iot.id": 1,
    "name": "Synthetic outdoor site",
    "description": "Simulated outdoor sensor host at 45.00 N, 75.00 W, timed in EDT.",
    "properties": { "placement": "outdoor", "latitude": 45, "longitude": -75, "timezone": "EDT" },
    "Locations@iot.navigationLink": "https://<host>/api/sensor/temperature?format=sta$SITE",
    "Locations": [
      {
        "@iot.id": 1,
        "name": "45.00 N, 75.00 W",
        "description": "Generation site for this series (outdoor).",
        "encodingType": "application/geo+json",
        "location": { "type": "Point", "coordinates": [-75, 45] }
      }
    ]
  },

  "Sensor@iot.navigationLink": "https://<host>/api/sensor/temperature?format=sta$SITE",
  "Sensor": {
    "@iot.id": 1,
    "name": "Synthetic temperature sensor",
    "description": "Deterministic solar and climate model + seeded noise.",
    "encodingType": "text/html",
    "metadata": "https://github.com/nicoarellano/sensors-api"
  },

  "ObservedProperty@iot.navigationLink": "https://<host>/api/sensor/temperature?format=sta$SITE",
  "ObservedProperty": {
    "@iot.id": 1,
    "name": "Air Temperature",
    "definition": "https://dbpedia.org/page/Temperature",
    "description": "Air Temperature"
  },

  "FeatureOfInterest@iot.navigationLink": "https://<host>/api/sensor/temperature?format=sta$SITE",
  "FeatureOfInterest": {
    "@iot.id": 1,
    "name": "45.00 N, 75.00 W",
    "description": "The outdoor air observed at 45.00 N, 75.00 W.",
    "encodingType": "application/geo+json",
    "feature": { "type": "Point", "coordinates": [-75, 45] }
  },

  "Observations@iot.navigationLink": "https://<host>/api/sensor/temperature?format=dataArray$SITE",
  "Observations@iot.count": 288,
  "Observations": [
    {
      "@iot.id": 1,
      "phenomenonTime": "2026-07-23T10:30:00.000-04:00",
      "resultTime": "2026-07-23T10:30:00.000-04:00",
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
| `observedArea` | GeoJSON `Point` | The site the series was generated for, `[longitude, latitude]`. Standard STA field. |
| `phenomenonTime` / `resultTime` | string | ISO 8601 **interval** `start/end` covering the window, in the `tz` offset. Use for the chart's time-axis domain. |
| `properties` | object | Non-standard extras under the standard `properties` bag: `seed`, `frequency` (ms), `generator`, `timezone` (the `tz` in force), `placement` (`indoor`/`outdoor`). (Phase 2: CDT display hints will land here — see §9.) |
| `Thing` | entity | The site hosting the sensor: `properties` carries `placement`, `latitude`, `longitude`, `timezone`, and `Locations[]` holds one GeoJSON `Point`. |
| `Sensor` | entity | The generating procedure. `encodingType`/`metadata` follow STA; `metadata` is the repo URL. |
| `ObservedProperty` | entity | `name` + `definition` (phenomenon IRI). Good source for a series label. |
| `FeatureOfInterest` | entity | What is being observed — the air at the site, as GeoJSON. STA hangs this off each Observation; it is carried once here because every observation in a series shares one site. |
| `Observations@iot.count` | number | Number of embedded observations. |
| `Observations[]` | array | Each: `@iot.id`, `phenomenonTime` (ISO), `resultTime` (ISO), `result`. |
| `result` | number \| boolean \| string | Typed per `observationType` (§7). |
| `*@iot.navigationLink` | string | Where the related entity/collection lives. `Observations@iot.navigationLink` resolves to the real `?format=dataArray` endpoint. |

> **Whose geography is this?** The `Thing`, `Location`, `FeatureOfInterest` and
> `observedArea` describe the **generation site** — the `?lat=`/`?lon=` the series
> was computed for, which is what makes the values physically meaningful. They are
> not a claim about *your* deployment. CDT should keep supplying deployment
> geography from its own `Sensor` record (`latitude`/`longitude`/`elevation`) and
> attaching this Datastream to its own Thing; the sensible pattern is to pass those
> same coordinates in as `?lat=`/`?lon=` so the two agree.
>
> `HistoricalLocation` is not emitted: a synthetic site does not move.

## 4. `format=dataArray` — compact observations

The OGC `dataArray` extension: the same observations as rows, no per-row keys.

```jsonc
{
  "components": ["phenomenonTime", "result"],
  "dataArray@iot.count": 288,
  "dataArray": [
    ["2026-07-24T09:41:00.000-04:00", 23.71],
    ["2026-07-24T09:46:00.000-04:00", 23.68]
  ]
}
```

`components` names the column order. `result` is typed as in §7. Prefer this over
`sta` when you already know the unit and only need points to plot.

## 5. `format=csv` and `format=reading`

**CSV** — header-less, one point per line; `time` is clock-style `H:MM:SS` local
to `tz`; `value` is `parseFloat`-able for every kind (`state` → ordinal index).

```
10:30:00,23.71
10:35:00,23.68
```

**reading** — one current value, with the site it was generated for and the
effective range it used:

```jsonc
{ "type": "temperature", "unit": "°C", "seed": 0, "timezone": "EDT",
  "timestamp": "2026-07-24T06:55:17.465-04:00",
  "location": { "latitude": 45, "longitude": -75 }, "placement": "outdoor",
  "value": 26.61, "min": 12.9, "max": 34.7 }
```

`min`/`max` are the band **this request** used, not a fixed per-type range: they
follow the season, the site and `placement` unless you override them.

## 6. Sensor types

Ranges below are **nominal** — the typical band for a type, and what
`GET /api/sensors` advertises. A request's effective range follows the site, the
season and `placement` (an outdoor thermometer in January is below zero), or your
own `min`/`max`; `format=reading` reports the band it used.

| Type | Unit | Nominal range | Frequency | Kind |
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
3. **Time** → parse each ISO `phenomenonTime` (it carries the `tz` offset, so
   `new Date(...)` is exact) and format your chart's `H:MM:SS` from it. To keep the
   chart on the sensor's local clock without doing the conversion yourself, request
   the zone with `?tz=` and read the wall time straight out of the string. Use the
   Datastream `phenomenonTime` interval for the axis domain.
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

Each value is a physical rule evaluated for the site and the instant — solar
position and clear-sky irradiance from the NOAA equations, a seasonal climatology
from latitude, a seeded weather series, and (indoors) a setpoint and an occupancy
schedule — then reshaped by a per-seed profile (swing, level, peak timing,
noisiness), four noise octaves (day / 3 h / 20 min / 15 s) and sparse events, all
from a `mulberry32` PRNG seeded from `(seed, type, time bucket)`.

The same `type + seed + timestamp + params` always yields the same value. Local
time is read at the fixed offset of `tz` (**EDT** by default), never in the
server's zone, and nothing else reads a clock, so `?at=` URLs are reproducible in
tests while "now" URLs fluctuate gently between polls. `tz`, `lat`, `lon` and
`placement` are all part of the input: change any of them and you get a different
but equally reproducible series.

One consequence worth knowing: with `lat`/`lon` pinned, changing only `tz` does
**not** move an outdoor solar or thermal curve — relabelling a clock does not move
the sun. It does shift everything on a schedule (occupancy, CO₂, lighting, water,
noise) and every rendered timestamp. Changing `tz` *without* a `lon` also moves
the default site to that zone's central meridian, which is why `?tz=PDT` alone
still reads like a west-coast sensor.
