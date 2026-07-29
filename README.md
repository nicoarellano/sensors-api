# Synthetic Sensor API

A Next.js (App Router, TypeScript) service that generates synthetic, sensor-like
time series. By default it serves **OGC SensorThings-shaped JSON** (Datastream +
Observations) — the shape CollabDT's sensor consumer reads directly, with the
unit included. A compact `dataArray`, a single `reading`, and plain `csv` are
available via `?format=`. Each value is computed from a timestamp plus a seeded
PRNG, so the same URL is always reproducible and different seeds simulate
different physical sensors.

Values come from a small physical model of a **site**: where the sun is at that
latitude and longitude, what the season looks like there, what the weather is
doing, and — indoors — what the control system and the occupants are doing. That
value is then reshaped by a per-seed personality (swing, level, peak timing,
noisiness) and layered with bounded, smooth seeded noise at four time scales,
always inside the effective range. Consecutive readings fluctuate gently instead
of jittering or sitting still. There is no unbounded random walk.

So an outdoor thermometer at `lat=45` reads about -13 °C in January and 26 °C in
July, sunrise moves with the date and the site, and one overcast afternoon dims
the light sensor, flattens the temperature curve and cuts the irradiance
together. See [Location and placement](#location-and-placement).

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
| `min`    | number          | rule's range | Override the bottom of the value range. The curve is **rescaled** into the new band rather than clipped. May be supplied without `max`. Ignored by `movement` and `state`. |
| `max`    | number          | rule's range | Override the top of the value range. May be supplied without `min`. `min > max` → 400. |
| `lat`    | -90 … 90        | `45`    | Site latitude in degrees north. Sets day length, how high the sun gets, and the seasonal climate — a January series at `lat=45` is below freezing, one at `lat=5` is not. `latitude=` is an alias. Out of range or non-numeric → 400. |
| `lon`    | -180 … 180      | `-75`   | Site longitude in degrees east (negative in the Americas). Sets where solar noon falls on the local clock. With a `tz` but no `lon`, that zone's central meridian is used instead (see below). `lng=`/`longitude=` are aliases. Out of range → 400. |
| `placement` | `outdoor` \| `indoor` | `outdoor` | Whether the sensor is exposed to the sky or sits inside a conditioned space. See [Location and placement](#location-and-placement). Case-insensitive. Anything else → 400. |
| `at`     | ISO 8601 instant | now    | End the window — or, with `format=reading`, evaluate the value — at a fixed instant instead of "now", which freezes a URL in time. A value with no zone designator (`2026-07-23T14:05:00`) is read in `tz`. Unparseable → 400. |
| `tz`     | abbreviation or offset | `EDT` | Zone the series is timed in: it sets where the daily curve peaks *and* how timestamps are rendered. Any abbreviation listed by `GET /api/sensors` (`PDT`, `JST`, `UTC`, …, case-insensitive) or an explicit offset (`UTC-05:00`, `-0500`, `UTC+05:30`). `timezone=` is accepted as an alias. Unrecognized → 400. |

**Timezone.** `tz` sets the zone the series is timed in: the working day, the
occupancy schedule and every rendered timestamp follow it. CSV `H:MM:SS` becomes
a local clock, and STA/`dataArray`/`reading` timestamps carry the zone offset
(`2026-07-23T10:05:00.000-04:00`) instead of `Z`. The instants themselves are
unchanged, so `new Date(...)` round-trips exactly.

`tz` also moves the **default site**: with no `lon` of your own, longitude
becomes that zone's central meridian, so `?tz=PDT` gives a series whose solar
noon lands at Pacific local noon — a sensor on the west coast. Pin `lat`/`lon`
yourself and the sun stops following the clock, which is the physically honest
behavior: relabelling your clock does not move an outdoor thermometer, though it
still shifts anything on a schedule (occupancy, CO₂, lighting, water).

Abbreviations are **fixed offsets**, not IANA zones: an abbreviation already
names one side of the DST fence, so pick the one for the season you are demoing
(`EST` in winter, `EDT` in summer). No transition rules are applied, which keeps
a URL reproducible. `CST`/`CDT` are read as US Central; ambiguous ones like `IST`
are not accepted — use an explicit offset (`?tz=UTC%2B05:30`) instead. The full
accepted list is in `GET /api/sensors` (`timezones`, `defaultTimezone`).

**Windowing precedence.** `window` and `points` are mutually exclusive; if both
are present, `window` wins. Every window ends at `at` (default now), anchored to
frequency-sized buckets so results are stable and downsampling is even.

**Range precedence & scaling.** Each sensor's rule reports the range that is
physically right for the request — an outdoor thermometer's band follows the
season, so it is roughly -15…3 °C in January and 13…35 °C in July. `min`/`max`
override either end of that, and the curve is **rescaled** into whatever band is
effective rather than clipped: `?min=-20&max=50` stretches the day across that
whole range. The final value is always clamped to the effective range, and
`format=reading` reports the range it used. The `min`/`max` in `GET /api/sensors`
are **nominal** — the typical band for a type, not a promise about a given
request.

**Discrete sensors.** `movement` (0/1) and `state` (enum) ignore `min`/`max`. In
CSV, `state` is encoded as its **ordinal index** (0-based position in `values`)
so `parseFloat` charts a step line; STA/dataArray keep the string label.

### Location and placement

Three parameters describe the **site**: `lat`, `lon` and `placement`. Together
with `at` and `tz` they decide everything physical about a series.

**Location.** Latitude sets day length, how high the sun climbs and the seasonal
climate (annual mean falls with latitude, the seasonal swing grows with it).
Longitude sets where solar noon lands on the local clock. Both feed a NOAA solar
position model, so sunrise, sunset, solar noon and clear-sky irradiance are real
for the site and date:

```
/api/sensor/irradiance?lat=45&lon=-75&at=2026-07-28T12:00:00      # peaks ~13:09 EDT at ~64° elevation
/api/sensor/light?lat=78&lon=15&tz=CET&at=2026-12-21T12:00:00     # polar night: dark all day
/api/sensor/light?lat=-33.87&lon=151.21&tz=AEDT                   # Sydney: January is summer
```

The default site is **45 N, 75 W** (Ottawa), the site the solar model is
spot-checked against. Southern-hemisphere latitudes flip the seasons.

**Placement.** `outdoor` (the default) is exposed to the real sky and the real
seasonal air temperature. `indoor` sits behind glazing and a control system: it
is damped, lagged, held near a setpoint, and driven by the occupancy schedule
(weekday ramps, a lunch dip, a quiet weekend) instead of by the weather alone.

| Sensor | `placement=outdoor` | `placement=indoor` |
|--------|---------------------|--------------------|
| `temperature` | Seasonal air temperature: below freezing in a mid-latitude January, peaking ~2.5 h after solar noon | Held near a setpoint (20.5 °C heating, 24 °C cooling), nudged by envelope losses, solar gain and occupants |
| `humidity` | Follows the dew point: climbs toward saturation overnight, falls as the day warms | The same air warmed to room temperature, so ~20% in January; capped by the cooling coil in summer (~50%) |
| `light` | Moonlight to ~90,000 lux, dimmed by cloud, with civil twilight at each end | A ~2% daylight factor plus maintained electric lighting when the room is occupied and daylight runs short |
| `irradiance` | Clear-sky GHI reduced by cloud cover (0 at night) | The same, through glazing onto an interior surface (~16%) |
| `air_quality` | CO₂ background (~421 ppm) plus a little traffic, trapped by the nocturnal inversion | A crowding signal: climbs as the room fills, clears to near-outdoor overnight |
| `energy_consumption` | Exterior loads: dusk-to-dawn lighting and freeze protection, so it **peaks at night and in the cold** | Base load + plug load + lighting + HVAC, so it peaks through the occupied day |
| `movement` | Pedestrians and vehicles, peaking at the commute | Occupancy detection, following the working day |
| `noise_level` | ~36 dB at night to ~60 dB at rush hour | ~31 dB empty to ~55 dB busy, plus transients |
| `flow` | Irrigation: a pre-dawn burst in the growing season, nothing once the line would freeze | Domestic water: draw-offs through the working day, nothing overnight |
| `state` | Duty cycle of the lighting circuit and freeze protection | Duty cycle of the HVAC and the people |
| `atmospheric_pressure` | The air mass: synoptic highs and lows, dropping with cloud | The same, plus a fraction of a hPa of building pressurization |

Every sensor at a given seed and site shares one weather series, so they agree
with each other: an overcast afternoon dims `light`, flattens `temperature` and
cuts `irradiance` at the same time, and a cold snap raises indoor
`energy_consumption` while it lowers outdoor `temperature`.

The physics lives in [`lib/solar.ts`](lib/solar.ts) (solar position, cloud,
climate) and [`lib/realism.ts`](lib/realism.ts) (one rule per sensor). The
numbers are deliberately simple engineering approximations: enough that January
looks like January and an occupied Tuesday looks occupied, not a substitute for a
building energy model or real climate normals.

#### Errors

- Unknown/invalid `{type}` → **404** with `{ error, validTypes: [...] }`.
- Malformed params (non-numeric `seed`/`min`/`max`, `min > max`, unparseable
  `at`, bad `format`/`points`/`window`/`tz`/`lat`/`lon`/`placement`) → **400**
  with `{ error }`.

#### STA response (default)

A standard SensorThings **Datastream** entity graph: it links an inline `Thing`
(with its `Location`), `Sensor` and `ObservedProperty`, embeds `Observations`, and
carries `@iot.*` annotations. Full field reference in
[`docs/ogc-sensorthings-integration.md`](docs/ogc-sensorthings-integration.md).

```json
{
  "@iot.id": 1,
  "@iot.selfLink": "https://<host>/api/sensor/temperature?format=sta&tz=EDT&lat=45&lon=-75&placement=outdoor",
  "name": "Air Temperature",
  "description": "Synthetic Air Temperature datastream for temperature.",
  "observationType": "http://www.opengis.net/def/observationType/OGC-OM/2.0/OM_Measurement",
  "unitOfMeasurement": {
    "name": "degree Celsius",
    "symbol": "°C",
    "definition": "https://qudt.org/vocab/unit/DEG_C"
  },
  "observedArea": { "type": "Point", "coordinates": [-75, 45] },
  "phenomenonTime": "2026-07-22T10:30:00.000-04:00/2026-07-23T10:30:00.000-04:00",
  "resultTime": "2026-07-22T10:30:00.000-04:00/2026-07-23T10:30:00.000-04:00",
  "properties": {
    "seed": 0,
    "frequency": 300000,
    "generator": "sensors-api",
    "timezone": "EDT",
    "placement": "outdoor"
  },
  "Thing": {
    "@iot.id": 1,
    "name": "Synthetic outdoor site",
    "description": "Simulated outdoor sensor host at 45.00 N, 75.00 W, timed in EDT.",
    "properties": { "placement": "outdoor", "latitude": 45, "longitude": -75, "timezone": "EDT" },
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
  "Sensor": {
    "@iot.id": 1,
    "name": "Synthetic temperature sensor",
    "description": "Deterministic solar and climate model + seeded noise.",
    "encodingType": "text/html",
    "metadata": "https://github.com/nicoarellano/sensors-api"
  },
  "ObservedProperty": {
    "@iot.id": 1,
    "name": "Air Temperature",
    "definition": "https://dbpedia.org/page/Temperature",
    "description": "Air Temperature"
  },
  "FeatureOfInterest": {
    "@iot.id": 1,
    "name": "45.00 N, 75.00 W",
    "description": "The outdoor air observed at 45.00 N, 75.00 W.",
    "encodingType": "application/geo+json",
    "feature": { "type": "Point", "coordinates": [-75, 45] }
  },
  "Observations@iot.navigationLink": "https://<host>/api/sensor/temperature?format=dataArray&tz=EDT&lat=45&lon=-75&placement=outdoor",
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
`OM_CategoryObservation` (`state`).

**Geography.** Because a request now names a real site, the response carries it:
`observedArea`, a `Thing` with its `Location`, and a `FeatureOfInterest`, all as
GeoJSON `Point`s in `[longitude, latitude]` order. Links carry `tz`, `lat`, `lon`
and `placement`, so following one reproduces the same series. This describes the
*generation* site — a consuming app that has its own deployment geography should
keep using it and treat these as the synthetic source's own coordinates.
`HistoricalLocation` is not emitted: a synthetic site does not move.

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

Manifest listing every sensor type with its `unit`, `kind`, nominal `min`/`max`,
`frequency`, OGC `unitOfMeasurement`/`observationType`/`observedProperty`,
`values` (enum sensors), and ready-to-paste `staUrl` (default) + `csvUrl`. Also
carries `defaultTimezone` and the `timezones` abbreviations `?tz=` accepts, plus
`defaultLocation` (`{ latitude, longitude }`), `defaultPlacement`, and the
`placements` `?placement=` accepts.

## Sensor types

| Type                   | Unit    | Nominal range | Frequency | Driven by |
|------------------------|---------|---------------|-----------|-----------|
| `temperature`          | °C      | 15 – 30       | 5 min     | Season and site outdoors; the setpoint indoors |
| `light`                | lux     | 0 – 100000    | 5 min     | Sun and cloud; glazing + electric lighting indoors |
| `humidity`             | %RH     | 0 – 100       | 5 min     | Dew point vs air temperature (dry indoors in winter) |
| `energy_consumption`   | W       | 100 – 3000    | 1 min     | Occupancy + HVAC indoors; exterior lighting and freeze protection outdoors |
| `movement`             | bool    | 0 / 1         | 1 s       | Occupancy indoors; traffic and pedestrians outdoors |
| `air_quality`          | ppm     | 400 – 2000    | 1 min     | Crowding indoors; background + traffic outdoors |
| `atmospheric_pressure` | hPa     | 980 – 1040    | 10 min    | Synoptic highs and lows passing over |
| `irradiance`           | W/m²    | 0 – 1000      | 5 min     | Clear-sky GHI reduced by cloud |
| `flow`                 | L/min   | 0 – 12        | 5 s       | Domestic draw-offs indoors; irrigation outdoors |
| `state`                | enum    | on/off/idle/error | 10 s  | Plant duty cycle; error rare and stress-linked |
| `noise_level`          | dB      | 30 – 80       | 1 s       | Occupancy indoors; traffic outdoors, plus transients |

The range column is **nominal**: the effective range of a request follows the
site, the season and `placement` (see
[Location and placement](#location-and-placement)), or your own `min`/`max`.
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

## How a value is produced

1. **The site and the instant.** `at`, `tz`, `lat` and `lon` fix where the sun is,
   how long the day is, what the season's climate looks like and — from the seed —
   what the weather is doing. This context is shared by every sensor, so they
   agree with each other.
2. **The sensor's rule.** Each type turns that context into a value in its own
   unit, differently depending on `placement`
   ([`lib/realism.ts`](lib/realism.ts)).
3. **The personality and the noise.** The value is normalized through the range
   the rule reports, reshaped per seed, and layered with seeded noise and events
   (below), then scaled into the effective range and clamped.

Steps 1 and 2 are pure functions of the URL; step 3 is a seeded PRNG. Nothing
reads a clock except the default value of `at`.

## How seeding works

Each value is produced by a small `mulberry32` PRNG seeded from a mix of
`(seed, sensor type, time bucket)`:

- **Continuous** sensors combine three things on top of the rule's physical
  value:
  - a **profile** — a fixed personality per `(seed, type)`: swing amplitude
    (`gain`), baseline shift (`level`), peak timing (`phaseHours` up to ±1.5 h)
    and noisiness (`noiseScale`). This is what makes two seeds look like two
    different physical sensors rather than one curve drawn twice. Peak timing is
    suppressed for the solar-locked sensors (`light`, `irradiance`): moving a
    solar peak off solar noon is an error, not a personality.
  - four **noise octaves** (day, 3 h, 20 min, 15 s), each cosine-interpolated
    between seeded control points and weighted 0.30 / 0.28 / 0.24 / 0.18. The
    day octave gives day-to-day character; the 15 s octave gives per-reading
    measurement jitter.
  - sparse **events** for sensors that declare an `eventRate` (bursts per day) —
    short Gaussian spikes where they are physical: a machine starting
    (`energy_consumption`), a tap opening (`flow`), a door slamming
    (`noise_level`), a room filling up (`air_quality`).

  Both noise and events scale with how active the sensor is, so overnight
  behavior stays physical for every seed (a dark room stays dark, and a sensor
  that rests at zero reads zero rather than a few hundred lux of noise) while
  daytime values spread out visibly. The result is scaled into the effective
  range and soft-clamped — strong seeds round off near the ceiling instead of
  flat-lining against it.
- **Discrete** sensors draw from a 1-second time bucket: `movement` compares the
  PRNG against the rule's occupancy or traffic probability; `state` picks a label
  by the plant's duty-cycle weights.
- The **weather** is seeded per site rather than per sensor, which is what makes
  `light`, `irradiance` and `temperature` agree about the same overcast afternoon.

Because the seed derives from the timestamp, **the same
type + seed + timestamp + params always yields the same value**, while a
different seed produces a different but equally reproducible series. Local time
is read at the **fixed offset of `tz`** (EDT by default) rather than in the
server's zone, so results depend only on the URL. Latitude, longitude and
placement are part of the input the same way: change any of them and you get a
different, equally reproducible series.

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

# Placement (default outdoor)
/api/sensor/temperature?placement=indoor&window=24h            # held near a setpoint
/api/sensor/temperature?at=2026-01-15T12:00:00&window=24h      # outdoor January: below freezing
/api/sensor/air_quality?placement=indoor&window=24h            # CO2 climbs as the room fills
/api/sensor/energy_consumption?placement=outdoor&window=24h    # exterior load: peaks at night

# Location (default 45 N, 75 W)
/api/sensor/irradiance?lat=45&lon=-75&at=2026-07-28T12:00:00   # solar noon ~13:09 EDT
/api/sensor/light?lat=78&lon=15&tz=CET&at=2026-12-21T12:00:00  # polar night: dark all day
/api/sensor/temperature?lat=-33.87&lon=151.21&tz=AEDT          # Sydney: January is summer
/api/sensor/temperature?lat=5&at=2026-01-15T12:00:00           # tropics: no winter
```

## Adding or modifying a sensor

A sensor is **one entry** in `SENSORS` ([`lib/config.ts`](lib/config.ts)) plus
**one rule** in [`lib/realism.ts`](lib/realism.ts). The entry is metadata; the
rule is the physics.

```ts
// lib/realism.ts — the rule reads the site out of a ShapeContext.
export const gaugePressureRule: SensorRule = {
  value: (ctx) =>
    ctx.placement === "indoor"
      ? 120 + 60 * occupancy(ctx)      // riser pressure follows demand
      : 95 + 25 * hvacDemand(ctx),
  range: () => ({ min: 0, max: 500 }),
};

// lib/config.ts — the entry names the rule.
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
  rule: gaugePressureRule,
},
```

- `kind: "continuous"` → give the rule a `value(ctx)` in the sensor's unit, and
  usually a `range(ctx)` (omit it to fall back to the entry's nominal
  `min`/`max`). Reuse the exported helpers — `occupancy`, `traffic`,
  `hvacDemand`, `airTemp`, `outdoorIlluminance`, `groundIrradiance`,
  `relativeHumidity`, `electricLighting`. Add `solarLocked: true` if astronomy
  fixes its timing, and `eventRate: n` on the entry when short spikes are
  physical (a machine starting, a tap opening).
- `kind: "binary"` → give the rule `prob(ctx) => [0,1]`.
- `kind: "enum"` → give the entry `values: string[]` and the rule
  `weights(ctx) => number[]` in the same order.
- Honour `ctx.placement` wherever indoors and outdoors genuinely differ, and set
  a range that is honest for the context — that is what keeps a January series
  from claiming a summer band.

Nothing else needs to change: the route handler, manifest, and dashboard all read
from `SENSORS`, and `observationType` is derived from `kind`.

## Architecture

```
app/
  api/
    sensor/[type]/route.ts   # windowed data, format dispatch (dynamic, no-store)
    sensors/route.ts         # manifest
  page.tsx                   # live demo dashboard with inline-SVG sparklines
lib/
  types.ts                   # shared types
  config.ts                  # per-sensor entry: metadata + which rule it uses
  solar.ts                   # solar position, cloud cover, seasonal climate
  realism.ts                 # one physical rule per sensor (the extension point)
  prng.ts                    # mulberry32 + seed helpers
  generator.ts               # rule + personality + layered noise + windowing
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

### Location and placement (`?lat=`, `?lon=`, `?placement=`)

Values now come from a physical model of a site instead of a fixed daily curve.
`?lat=`/`?lon=` place the sensor: latitude sets day length, sun height and the
seasonal climate, longitude sets where solar noon lands on the clock. Sunrise,
sunset and clear-sky irradiance come from the NOAA solar equations, so an
`?at=2026-12-21` series at `?lat=78` is dark all day and a July series at
`?lat=45` peaks around 64° of elevation.

`?placement=outdoor` (the default) is exposed to the real sky and the real
seasonal air temperature — a mid-latitude January reads below freezing rather
than pretending to be 15–30 °C all year. `?placement=indoor` is damped, lagged
and held near a setpoint, with the occupancy schedule driving CO₂, lighting,
water and noise. Some sensors invert entirely: an exterior electricity meter
peaks at night on dusk-to-dawn lighting and freeze protection, while an indoor
one peaks through the occupied day.

Because the weather is seeded per site rather than per sensor, the sensors now
agree with each other: one overcast afternoon dims `light`, flattens
`temperature` and cuts `irradiance` at the same time. Effective ranges follow the
context, so `format=reading` reports the band it actually used and the manifest's
`min`/`max` are nominal. The STA response carries the site as `observedArea`, a
`Thing` with its `Location`, and a `FeatureOfInterest`, in GeoJSON. See
[Location and placement](#location-and-placement).

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
