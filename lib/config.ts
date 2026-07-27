// Central sensor registry. Adding or changing a sensor = editing one entry.
//
// Continuous `shape(hour)` functions return a normalized value in [0, 1]
// (position within the effective range), so the same diurnal shape stretches
// into whatever min/max is in force instead of clipping. Curves are informed
// by the reference CSVs in public/sensor-examples (smooth low-amplitude
// thermal diurnals peaking mid-afternoon; flow flat at night with a smooth
// daytime burst).
//
// Each entry also carries OGC SensorThings metadata (unitOfMeasurement,
// observedProperty) and a default sampling `frequency` (ms) so the output can
// be shaped as OGC Datastream/Observations as well as CSV.

import type { SensorConfig, SensorKind } from "@/lib/types";

const TAU = Math.PI * 2;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Smooth diurnal curve in [0, 1] peaking at `peakHour`. */
function diurnal(hour: number, peakHour: number): number {
  return 0.5 + 0.5 * Math.cos((TAU * (hour - peakHour)) / 24);
}

/** Half-sine daylight envelope: 0 outside [sunrise, sunset], peak at midpoint. */
function daylight(hour: number, sunrise: number, sunset: number): number {
  if (hour <= sunrise || hour >= sunset) return 0;
  return Math.sin((Math.PI * (hour - sunrise)) / (sunset - sunrise));
}

/** Gaussian bump centered at `center` hours with the given `width` (hours). */
function bump(hour: number, center: number, width: number): number {
  const d = hour - center;
  return Math.exp(-(d * d) / (2 * width * width));
}

/** OGC SensorThings observationType URIs (OGC 18-088, Table 8-10). */
export const OBSERVATION_TYPE = {
  measurement:
    "http://www.opengis.net/def/observationType/OGC-OM/2.0/OM_Measurement",
  truth:
    "http://www.opengis.net/def/observationType/OGC-OM/2.0/OM_TruthObservation",
  category:
    "http://www.opengis.net/def/observationType/OGC-OM/2.0/OM_CategoryObservation",
} as const;

/** Map a sensor kind to its OGC observationType URI. */
export function observationTypeFor(kind: SensorKind): string {
  if (kind === "binary") return OBSERVATION_TYPE.truth;
  if (kind === "enum") return OBSERVATION_TYPE.category;
  return OBSERVATION_TYPE.measurement;
}

/** Unit descriptor for sensors that carry no unit (truth/category). */
const NO_UNIT = { name: null, symbol: null, definition: null } as const;

export const SENSORS = {
  temperature: {
    unit: "°C",
    min: 15,
    max: 30,
    kind: "continuous",
    frequency: 300000, // 5 min
    unitOfMeasurement: {
      name: "degree Celsius",
      symbol: "°C",
      definition: "https://qudt.org/vocab/unit/DEG_C",
    },
    observedProperty: {
      name: "Air Temperature",
      definition: "https://dbpedia.org/page/Temperature",
    },
    noise: 0.06,
    // Smooth diurnal: coolest before dawn, warmest mid-afternoon (~15h).
    shape: (h) => diurnal(h, 15),
  },
  light: {
    unit: "lux",
    min: 0,
    max: 100000,
    kind: "continuous",
    frequency: 300000,
    unitOfMeasurement: {
      name: "lux",
      symbol: "lx",
      definition: "https://qudt.org/vocab/unit/LUX",
    },
    observedProperty: {
      name: "Illuminance",
      definition: "https://dbpedia.org/page/Illuminance",
    },
    noise: 0.05,
    // Dark at night, peak at solar noon.
    shape: (h) => daylight(h, 6, 18),
  },
  humidity: {
    unit: "%RH",
    min: 0,
    max: 100,
    kind: "continuous",
    frequency: 300000,
    unitOfMeasurement: {
      name: "percent relative humidity",
      symbol: "%RH",
      definition: "https://qudt.org/vocab/unit/PERCENT_RH",
    },
    observedProperty: {
      name: "Relative Humidity",
      definition: "https://dbpedia.org/page/Humidity",
    },
    noise: 0.05,
    // Inverse of temperature: highest in the cool early morning.
    shape: (h) => 1 - diurnal(h, 15),
  },
  energy_consumption: {
    unit: "W",
    min: 100,
    max: 3000,
    kind: "continuous",
    frequency: 60000, // 1 min
    unitOfMeasurement: {
      name: "watt",
      symbol: "W",
      definition: "https://qudt.org/vocab/unit/W",
    },
    observedProperty: {
      name: "Power",
      definition: "https://dbpedia.org/page/Electric_power",
    },
    noise: 0.08,
    // Appliances and plant switching on and off through the day.
    eventRate: 5,
    // Load curve: morning (~8h) and evening (~19h) peaks over a base load.
    shape: (h) => clamp01(0.12 + 0.88 * Math.max(bump(h, 8, 1.4), bump(h, 19, 2.2))),
  },
  movement: {
    unit: "bool",
    min: 0,
    max: 1,
    kind: "binary",
    frequency: 1000, // 1 s
    unitOfMeasurement: NO_UNIT,
    observedProperty: {
      name: "Occupancy",
      definition: "https://dbpedia.org/page/Motion_detection",
    },
    noise: 0,
    // Sparse occupancy events, biased toward occupied hours (7h–22h).
    prob: (h) => (h >= 7 && h <= 22 ? 0.35 : 0.03),
  },
  air_quality: {
    unit: "ppm",
    min: 400,
    max: 2000,
    kind: "continuous",
    frequency: 60000,
    unitOfMeasurement: {
      name: "parts per million",
      symbol: "ppm",
      definition: "https://qudt.org/vocab/unit/PPM",
    },
    observedProperty: {
      name: "CO2 Concentration",
      definition: "https://dbpedia.org/page/Carbon_dioxide",
    },
    noise: 0.05,
    // Crowding: a meeting fills a room, CO2 climbs then clears.
    eventRate: 3,
    // CO2 builds through occupied daytime hours, clears to ~fresh at night.
    shape: (h) => clamp01(0.04 + 0.92 * bump(h, 14, 4)),
  },
  atmospheric_pressure: {
    unit: "hPa",
    min: 980,
    max: 1040,
    kind: "continuous",
    frequency: 600000, // 10 min
    unitOfMeasurement: {
      name: "hectopascal",
      symbol: "hPa",
      definition: "https://qudt.org/vocab/unit/HectoPA",
    },
    observedProperty: {
      name: "Atmospheric Pressure",
      definition: "https://dbpedia.org/page/Atmospheric_pressure",
    },
    noise: 0.04,
    // Slow diurnal drift around mid-range; seeded noise adds gentle weather drift.
    shape: (h) => 0.5 + 0.3 * Math.sin((TAU * h) / 24),
  },
  irradiance: {
    unit: "W/m²",
    min: 0,
    max: 1000,
    kind: "continuous",
    frequency: 300000,
    unitOfMeasurement: {
      name: "watt per square metre",
      symbol: "W/m²",
      definition: "https://qudt.org/vocab/unit/W-PER-M2",
    },
    observedProperty: {
      name: "Solar Irradiance",
      definition: "https://dbpedia.org/page/Solar_irradiance",
    },
    noise: 0.05,
    // Correlated with light: same daylight envelope.
    shape: (h) => daylight(h, 6, 18),
  },
  flow: {
    unit: "L/min",
    min: 0,
    max: 12,
    kind: "continuous",
    frequency: 5000, // 5 s
    unitOfMeasurement: {
      name: "litre per minute",
      symbol: "L/min",
      definition: "https://qudt.org/vocab/unit/L-PER-MIN",
    },
    observedProperty: {
      name: "Volumetric Flow Rate",
      definition: "https://dbpedia.org/page/Volumetric_flow_rate",
    },
    noise: 0.04,
    // Draw-offs: a tap or valve opening for a few minutes.
    eventRate: 8,
    // Flat at night (long zero stretches), smooth daytime burst (~5.5h–20h).
    shape: (h) => Math.pow(daylight(h, 5.5, 20), 1.2),
  },
  state: {
    unit: "state",
    min: 0,
    max: 0,
    kind: "enum",
    frequency: 10000, // 10 s
    unitOfMeasurement: NO_UNIT,
    observedProperty: {
      name: "Operational State",
      definition: "https://dbpedia.org/page/State_(computer_science)",
    },
    noise: 0,
    values: ["on", "off", "idle", "error"],
    // Weights in [on, off, idle, error] order; mostly on/idle by day,
    // off/idle by night, error always rare.
    weights: (h) =>
      h >= 7 && h <= 22 ? [0.6, 0.05, 0.32, 0.03] : [0.1, 0.5, 0.37, 0.03],
  },
  noise_level: {
    unit: "dB",
    min: 30,
    max: 80,
    kind: "continuous",
    frequency: 1000, // 1 s
    unitOfMeasurement: {
      name: "decibel",
      symbol: "dB",
      definition: "https://qudt.org/vocab/unit/DeciB",
    },
    observedProperty: {
      name: "Sound Pressure Level",
      definition: "https://dbpedia.org/page/Sound_pressure",
    },
    noise: 0.06,
    // Transients: a door, a vehicle, a dropped object.
    eventRate: 12,
    // Quiet at night (~30 dB), loud through the day (~80 dB), peak mid-afternoon.
    shape: (h) => clamp01(0.1 + 0.9 * bump(h, 14, 5)),
  },
} satisfies Record<string, SensorConfig>;

export type SensorType = keyof typeof SENSORS;

export const SENSOR_TYPES = Object.keys(SENSORS) as SensorType[];

export function isSensorType(type: string): type is SensorType {
  return Object.prototype.hasOwnProperty.call(SENSORS, type);
}
