import { describe, it, expect } from "vitest";
import { formatCsv, formatSta, formatDataArray, clockTime } from "@/lib/format";
import { generateWindow, readingRange } from "@/lib/generator";
import { SENSORS, OBSERVATION_TYPE } from "@/lib/config";
import type { SensorParams } from "@/lib/types";

const AT = new Date("2026-07-23T14:05:00Z");
const ORIGIN = "https://sensors.example";

/** Base params; UTC at the reference site unless a test says otherwise. */
function params(overrides: Partial<SensorParams> = {}): SensorParams {
  return {
    seed: 2,
    at: AT,
    format: "csv",
    points: 20,
    timezone: "UTC",
    offsetMinutes: 0,
    latitude: 45,
    longitude: -75,
    placement: "outdoor",
    ...overrides,
  };
}

const EDT = params({ timezone: "EDT", offsetMinutes: -240 });

/** The site/zone query links carry so that following one reproduces the series. */
const SITE_QUERY = "&tz=UTC&lat=45&lon=-75&placement=outdoor";
const EDT_SITE_QUERY = "&tz=EDT&lat=45&lon=-75&placement=outdoor";

/** Replicates the exact parser in core-local Sensor.tsx / CollapsibleSensorItem.tsx. */
function parseLikeCdt(csv: string): { time: string; value: number }[] {
  return csv
    .trim()
    .split("\n")
    .map((line) => {
      const [time, value] = line.split(",");
      return { time: time.trim(), value: parseFloat(value) };
    });
}

describe("clockTime", () => {
  it("formats UTC as H:MM:SS (single-digit hour, zero-padded min/sec)", () => {
    expect(clockTime(new Date("2026-07-23T00:00:00Z"), 0)).toBe("0:00:00");
    expect(clockTime(new Date("2026-07-23T14:30:05Z"), 0)).toBe("14:30:05");
    expect(clockTime(new Date("2026-07-23T09:05:00Z"), 0)).toBe("9:05:00");
  });

  it("shifts by the zone offset, wrapping across midnight", () => {
    expect(clockTime(new Date("2026-07-23T14:30:05Z"), -240)).toBe("10:30:05");
    expect(clockTime(new Date("2026-07-23T14:30:05Z"), 330)).toBe("20:00:05");
    // 02:00Z is the previous evening in EST.
    expect(clockTime(new Date("2026-07-23T02:00:00Z"), -300)).toBe("21:00:00");
  });
});

describe("formatCsv — matches the CDT SensorChart contract", () => {
  it("is header-less time,value and parses cleanly for a continuous sensor", () => {
    const csv = formatCsv("temperature", generateWindow("temperature", params()), 0);
    const rows = parseLikeCdt(csv);
    const range = readingRange("temperature", params());
    expect(rows).toHaveLength(20);
    for (const row of rows) {
      expect(row.time).toMatch(/^\d{1,2}:\d{2}:\d{2}$/);
      expect(Number.isNaN(row.value)).toBe(false);
      expect(row.value).toBeGreaterThanOrEqual(range.min);
      expect(row.value).toBeLessThanOrEqual(range.max);
    }
    // No header row.
    expect(csv.split("\n")[0]).not.toMatch(/time/i);
  });

  it("encodes movement as 0/1 numerics", () => {
    const csv = formatCsv("movement", generateWindow("movement", params()), 0);
    for (const row of parseLikeCdt(csv)) {
      expect([0, 1]).toContain(row.value);
    }
  });

  it("encodes state as its ordinal index (parseFloat-safe, no NaN)", () => {
    const csv = formatCsv("state", generateWindow("state", params()), 0);
    const n = SENSORS.state.values!.length;
    for (const row of parseLikeCdt(csv)) {
      expect(Number.isNaN(row.value)).toBe(false);
      expect(Number.isInteger(row.value)).toBe(true);
      expect(row.value).toBeGreaterThanOrEqual(0);
      expect(row.value).toBeLessThan(n);
    }
  });
});

describe("formatSta — OGC SensorThings Datastream + Observations", () => {
  it("carries unitOfMeasurement, OM_Measurement type, and numeric ISO observations", () => {
    const points = generateWindow("temperature", params());
    const ds = formatSta("temperature", params(), points, ORIGIN);
    expect(ds.unitOfMeasurement).toEqual(SENSORS.temperature.unitOfMeasurement);
    expect(ds.observationType).toBe(OBSERVATION_TYPE.measurement);
    expect(ds.Observations).toHaveLength(points.length);
    for (const o of ds.Observations) {
      expect(typeof o.result).toBe("number");
      // phenomenonTime is an ISO 8601 instant.
      expect(o.phenomenonTime).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
      expect(Number.isNaN(new Date(o.phenomenonTime).getTime())).toBe(false);
    }
    // phenomenonTime envelope is an interval "start/end".
    expect(ds.phenomenonTime).toContain("/");
  });

  it("uses OM_TruthObservation with boolean result for binary sensors", () => {
    const points = generateWindow("movement", params());
    const ds = formatSta("movement", params(), points, ORIGIN);
    expect(ds.observationType).toBe(OBSERVATION_TYPE.truth);
    expect(ds.unitOfMeasurement.name).toBeNull();
    for (const o of ds.Observations) {
      expect(typeof o.result).toBe("boolean");
    }
  });

  it("uses OM_CategoryObservation with string label result for enum sensors", () => {
    const points = generateWindow("state", params());
    const ds = formatSta("state", params(), points, ORIGIN);
    expect(ds.observationType).toBe(OBSERVATION_TYPE.category);
    for (const o of ds.Observations) {
      expect(SENSORS.state.values).toContain(o.result as string);
    }
  });

  it("builds a standard entity graph: @iot ids, self/nav links, Sensor + ObservedProperty", () => {
    const points = generateWindow("temperature", params());
    const ds = formatSta("temperature", params(), points, ORIGIN);

    // Datastream annotations.
    expect(typeof ds["@iot.id"]).toBe("number");
    expect(ds["@iot.selfLink"]).toBe(
      `${ORIGIN}/api/sensor/temperature?format=sta${SITE_QUERY}`,
    );
    expect(ds.name).toBe(SENSORS.temperature.observedProperty.name);
    expect(ds.resultTime).toBe(ds.phenomenonTime);
    expect(ds.properties).toEqual({
      seed: 2,
      frequency: SENSORS.temperature.frequency,
      generator: "sensors-api",
      timezone: "UTC",
      placement: "outdoor",
    });

    // Related entities are expanded inline with matching ids.
    expect(ds.Sensor["@iot.id"]).toBe(ds["@iot.id"]);
    expect(ds.Sensor.encodingType).toBe("text/html");
    expect(ds.Sensor.metadata).toMatch(/^https?:\/\//);
    expect(ds.ObservedProperty.definition).toBe(SENSORS.temperature.observedProperty.definition);

    // Observations navigation resolves to the real dataArray endpoint.
    expect(ds["Observations@iot.navigationLink"]).toBe(
      `${ORIGIN}/api/sensor/temperature?format=dataArray${SITE_QUERY}`,
    );
    expect(ds["Observations@iot.count"]).toBe(points.length);
    expect(ds.Observations[0]["@iot.id"]).toBe(1);
    expect(ds.Observations[points.length - 1]["@iot.id"]).toBe(points.length);
  });

  it("nulls the unitOfMeasurement trio for unitless (category) sensors", () => {
    const ds = formatSta("state", params(), generateWindow("state", params()), ORIGIN);
    expect(ds.unitOfMeasurement).toEqual({ name: null, symbol: null, definition: null });
  });
});

describe("formatSta — site geography", () => {
  it("places the site as GeoJSON on observedArea, Location and FeatureOfInterest", () => {
    const site = params({ latitude: 48.86, longitude: 2.35 });
    const ds = formatSta("temperature", site, generateWindow("temperature", site), ORIGIN);
    // GeoJSON is [longitude, latitude], not [lat, lon].
    const point = { type: "Point", coordinates: [2.35, 48.86] };
    expect(ds.observedArea).toEqual(point);
    expect(ds.Thing.Locations[0].location).toEqual(point);
    expect(ds.FeatureOfInterest.feature).toEqual(point);
    expect(ds.Thing.Locations[0].encodingType).toBe("application/geo+json");
    expect(ds.FeatureOfInterest.encodingType).toBe("application/geo+json");
  });

  it("reports the site and placement on the Thing", () => {
    const ds = formatSta("temperature", EDT, generateWindow("temperature", EDT), ORIGIN);
    expect(ds.Thing.properties).toEqual({
      placement: "outdoor",
      latitude: 45,
      longitude: -75,
      timezone: "EDT",
    });
    expect(ds.Thing.name).toBe("Synthetic outdoor site");
    expect(ds.Thing.Locations[0].name).toBe("45.00 N, 75.00 W");
  });

  it("names the hemisphere a human would read off a map", () => {
    const south = params({ latitude: -33.87, longitude: 151.21 });
    const ds = formatSta("temperature", south, generateWindow("temperature", south), ORIGIN);
    expect(ds.Thing.Locations[0].name).toBe("33.87 S, 151.21 E");
  });

  it("echoes placement in properties and carries the whole site on the links", () => {
    const indoor = params({ placement: "indoor" });
    const ds = formatSta("temperature", indoor, generateWindow("temperature", indoor), ORIGIN);
    expect(ds.properties.placement).toBe("indoor");
    expect(ds["@iot.selfLink"]).toBe(
      `${ORIGIN}/api/sensor/temperature?format=sta&tz=UTC&lat=45&lon=-75&placement=indoor`,
    );
  });
});

describe("formatDataArray — compact OGC form", () => {
  it("has components and a matching-length dataArray of [iso, result] rows", () => {
    const points = generateWindow("temperature", params());
    const da = formatDataArray("temperature", points, 0);
    expect(da.components).toEqual(["phenomenonTime", "result"]);
    expect(da["dataArray@iot.count"]).toBe(points.length);
    expect(da.dataArray).toHaveLength(points.length);
    for (const [iso, result] of da.dataArray) {
      expect(Number.isNaN(new Date(iso as string).getTime())).toBe(false);
      expect(typeof result).toBe("number");
    }
  });
});

describe("timezone rendering", () => {
  it("times CSV rows on the zone's local clock", () => {
    const points = generateWindow("temperature", EDT);
    const rows = parseLikeCdt(formatCsv("temperature", points, EDT.offsetMinutes));
    // Last bucket at/just before 14:05Z is 14:05Z -> 10:05 EDT.
    expect(rows[rows.length - 1].time).toBe("10:05:00");
  });

  it("stamps STA observations with the zone offset, same instants", () => {
    const points = generateWindow("temperature", EDT);
    const ds = formatSta("temperature", EDT, points, ORIGIN);
    for (const o of ds.Observations) {
      expect(o.phenomenonTime).toMatch(/-04:00$/);
      expect(o.resultTime).toBe(o.phenomenonTime);
    }
    expect(new Date(ds.Observations[ds.Observations.length - 1].phenomenonTime).getTime()).toBe(
      points[points.length - 1].at.getTime(),
    );
    expect(ds.phenomenonTime).toBe(
      `${ds.Observations[0].phenomenonTime}/${ds.Observations[ds.Observations.length - 1].phenomenonTime}`,
    );
  });

  it("reports the zone in properties and carries it on the links", () => {
    const ds = formatSta("temperature", EDT, generateWindow("temperature", EDT), ORIGIN);
    expect(ds.properties.timezone).toBe("EDT");
    expect(ds["@iot.selfLink"]).toBe(
      `${ORIGIN}/api/sensor/temperature?format=sta${EDT_SITE_QUERY}`,
    );
    expect(ds["Observations@iot.navigationLink"]).toBe(
      `${ORIGIN}/api/sensor/temperature?format=dataArray${EDT_SITE_QUERY}`,
    );
  });

  it("percent-encodes an explicit-offset zone in the links", () => {
    const zone = params({ timezone: "UTC+05:30", offsetMinutes: 330 });
    const ds = formatSta("temperature", zone, generateWindow("temperature", zone), ORIGIN);
    expect(ds["@iot.selfLink"]).toBe(
      `${ORIGIN}/api/sensor/temperature?format=sta&tz=UTC%2B05%3A30&lat=45&lon=-75&placement=outdoor`,
    );
  });

  it("stamps dataArray rows with the zone offset", () => {
    const da = formatDataArray("temperature", generateWindow("temperature", EDT), EDT.offsetMinutes);
    for (const [iso] of da.dataArray) {
      expect(iso as string).toMatch(/-04:00$/);
      expect(Number.isNaN(new Date(iso as string).getTime())).toBe(false);
    }
  });
});
