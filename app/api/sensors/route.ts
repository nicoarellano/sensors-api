// GET /api/sensors — manifest of every sensor type with its defaults and
// OGC SensorThings metadata.

import { NextResponse } from "next/server";
import { SENSORS, SENSOR_TYPES, observationTypeFor } from "@/lib/config";
import { DEFAULT_TIMEZONE, TIMEZONE_ABBREVIATIONS } from "@/lib/timezones";
import type { SensorConfig } from "@/lib/types";

export const dynamic = "force-static";

export async function GET() {
  const sensors = SENSOR_TYPES.map((type) => {
    const cfg: SensorConfig = SENSORS[type];
    return {
      type,
      unit: cfg.unit,
      kind: cfg.kind,
      min: cfg.min,
      max: cfg.max,
      frequency: cfg.frequency,
      unitOfMeasurement: cfg.unitOfMeasurement,
      observationType: observationTypeFor(cfg.kind),
      observedProperty: cfg.observedProperty,
      // Discrete sensors ignore min/max; surface their labels instead.
      ...(cfg.values ? { values: cfg.values } : {}),
      // Ready-to-paste examples (relative; prefix with your deployment origin).
      // The bare URL returns STA (the default); CSV is what a CollabDT sensor consumes.
      staUrl: `/api/sensor/${type}`,
      csvUrl: `/api/sensor/${type}?format=csv`,
    };
  });

  return NextResponse.json(
    {
      count: sensors.length,
      // Zone the series are timed in unless `?tz=` (or `?timezone=`) says
      // otherwise. Explicit offsets like `UTC-05:00` are accepted too.
      defaultTimezone: DEFAULT_TIMEZONE,
      timezones: TIMEZONE_ABBREVIATIONS,
      sensors,
    },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
