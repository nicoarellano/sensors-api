// GET /api/sensor/[type] — a generated window of sensor data in one of several
// formats. In Next.js 16 the dynamic `params` is a Promise and must be awaited.
//
//   ?format=csv        (default) header-less `time,value` for CollabDT SensorChart
//   ?format=sta        OGC SensorThings Datastream + Observations
//   ?format=dataArray  compact OGC {components, dataArray}
//   ?format=reading    a single latest reading
//   ?points=N | ?window=24h   window sizing (see lib/params.ts)

import { NextResponse, type NextRequest } from "next/server";
import { SENSOR_TYPES, isSensorType } from "@/lib/config";
import { parseParams } from "@/lib/params";
import { generateReading, generateWindow } from "@/lib/generator";
import { formatCsv, formatSta, formatDataArray } from "@/lib/format";

// Readings must feel live; opt out of caching explicitly.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  const { type: rawType } = await params;
  const type = rawType.toLowerCase();

  if (!isSensorType(type)) {
    return NextResponse.json(
      { error: `Unknown sensor type "${rawType}".`, validTypes: SENSOR_TYPES },
      { status: 404, headers: NO_STORE },
    );
  }

  const parsed = parseParams(request.nextUrl.searchParams, new Date());
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE });
  }
  const p = parsed.value;

  if (p.format === "reading") {
    return NextResponse.json(generateReading(type, p), { headers: NO_STORE });
  }

  const points = generateWindow(type, p);

  if (p.format === "csv") {
    return new NextResponse(formatCsv(type, points), {
      headers: { ...NO_STORE, "Content-Type": "text/csv; charset=utf-8" },
    });
  }

  if (p.format === "sta") {
    return NextResponse.json(formatSta(type, p, points), { headers: NO_STORE });
  }

  // dataArray
  return NextResponse.json(formatDataArray(type, points), { headers: NO_STORE });
}
