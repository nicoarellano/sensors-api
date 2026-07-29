// Central sensor registry. Adding or changing a sensor = editing one entry.
//
// Each entry is metadata plus a `rule`: how the sensor responds to time, season,
// site and placement. The rules themselves live in `lib/realism.ts`, where the
// physics they encode can be stated next to the constants it needs — a rule
// reads the sun, the weather and the occupancy schedule out of a `ShapeContext`
// and returns a value in the sensor's own unit.
//
// `min`/`max` here are the *nominal* band the manifest advertises. The effective
// range of a request comes from the rule (an outdoor thermometer's range moves
// with the season) or from a caller's `min`/`max`.
//
// Each entry also carries OGC SensorThings metadata (unitOfMeasurement,
// observedProperty) and a default sampling `frequency` (ms) so the output can
// be shaped as OGC Datastream/Observations as well as CSV.

import {
  airQualityRule,
  energyRule,
  flowRule,
  humidityRule,
  irradianceRule,
  lightRule,
  movementRule,
  noiseRule,
  pressureRule,
  stateRule,
  temperatureRule,
} from "@/lib/realism";
import type { SensorConfig, SensorKind } from "@/lib/types";

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
    rule: temperatureRule,
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
    rule: lightRule,
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
    rule: humidityRule,
  },
  energy_consumption: {
    unit: "W",
    min: 0,
    max: 2320,
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
    noise: 0.05,
    // Appliances and plant switching on and off through the day.
    eventRate: 5,
    eventAmplitude: 0.06,
    rule: energyRule,
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
    rule: movementRule,
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
    rule: airQualityRule,
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
    rule: pressureRule,
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
    rule: irradianceRule,
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
    eventAmplitude: 0.14,
    rule: flowRule,
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
    rule: stateRule,
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
    rule: noiseRule,
  },
} satisfies Record<string, SensorConfig>;

export type SensorType = keyof typeof SENSORS;

export const SENSOR_TYPES = Object.keys(SENSORS) as SensorType[];

export function isSensorType(type: string): type is SensorType {
  return Object.prototype.hasOwnProperty.call(SENSORS, type);
}
