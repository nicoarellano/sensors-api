import { describe, it, expect } from "vitest";
import { formatCsv, formatSta, formatDataArray, clockTime } from "@/lib/format";
import { generateWindow } from "@/lib/generator";
import { SENSORS, OBSERVATION_TYPE } from "@/lib/config";
import type { SensorParams } from "@/lib/types";

const AT = new Date("2026-07-23T14:05:00Z");
const ORIGIN = "https://sensors.example";

function params(overrides: Partial<SensorParams> = {}): SensorParams {
  return { seed: 2, at: AT, format: "csv", points: 20, ...overrides };
}

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
    expect(clockTime(new Date("2026-07-23T00:00:00Z"))).toBe("0:00:00");
    expect(clockTime(new Date("2026-07-23T14:30:05Z"))).toBe("14:30:05");
    expect(clockTime(new Date("2026-07-23T09:05:00Z"))).toBe("9:05:00");
  });
});

describe("formatCsv — matches the CDT SensorChart contract", () => {
  it("is header-less time,value and parses cleanly for a continuous sensor", () => {
    const csv = formatCsv("temperature", generateWindow("temperature", params()));
    const rows = parseLikeCdt(csv);
    expect(rows).toHaveLength(20);
    for (const row of rows) {
      expect(row.time).toMatch(/^\d{1,2}:\d{2}:\d{2}$/);
      expect(Number.isNaN(row.value)).toBe(false);
      expect(row.value).toBeGreaterThanOrEqual(SENSORS.temperature.min);
      expect(row.value).toBeLessThanOrEqual(SENSORS.temperature.max);
    }
    // No header row.
    expect(csv.split("\n")[0]).not.toMatch(/time/i);
  });

  it("encodes movement as 0/1 numerics", () => {
    const csv = formatCsv("movement", generateWindow("movement", params()));
    for (const row of parseLikeCdt(csv)) {
      expect([0, 1]).toContain(row.value);
    }
  });

  it("encodes state as its ordinal index (parseFloat-safe, no NaN)", () => {
    const csv = formatCsv("state", generateWindow("state", params()));
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
    expect(ds["@iot.selfLink"]).toBe(`${ORIGIN}/api/sensor/temperature?format=sta`);
    expect(ds.name).toBe(SENSORS.temperature.observedProperty.name);
    expect(ds.resultTime).toBe(ds.phenomenonTime);
    expect(ds.properties).toEqual({ seed: 2, frequency: SENSORS.temperature.frequency, generator: "sensors-api" });

    // Related entities are expanded inline with matching ids.
    expect(ds.Sensor["@iot.id"]).toBe(ds["@iot.id"]);
    expect(ds.Sensor.encodingType).toBe("text/html");
    expect(ds.Sensor.metadata).toMatch(/^https?:\/\//);
    expect(ds.ObservedProperty.definition).toBe(SENSORS.temperature.observedProperty.definition);

    // Observations navigation resolves to the real dataArray endpoint.
    expect(ds["Observations@iot.navigationLink"]).toBe(`${ORIGIN}/api/sensor/temperature?format=dataArray`);
    expect(ds["Observations@iot.count"]).toBe(points.length);
    expect(ds.Observations[0]["@iot.id"]).toBe(1);
    expect(ds.Observations[points.length - 1]["@iot.id"]).toBe(points.length);
  });

  it("nulls the unitOfMeasurement trio for unitless (category) sensors", () => {
    const ds = formatSta("state", params(), generateWindow("state", params()), ORIGIN);
    expect(ds.unitOfMeasurement).toEqual({ name: null, symbol: null, definition: null });
  });
});

describe("formatDataArray — compact OGC form", () => {
  it("has components and a matching-length dataArray of [iso, result] rows", () => {
    const points = generateWindow("temperature", params());
    const da = formatDataArray("temperature", points);
    expect(da.components).toEqual(["phenomenonTime", "result"]);
    expect(da["dataArray@iot.count"]).toBe(points.length);
    expect(da.dataArray).toHaveLength(points.length);
    for (const [iso, result] of da.dataArray) {
      expect(Number.isNaN(new Date(iso as string).getTime())).toBe(false);
      expect(typeof result).toBe("number");
    }
  });
});
