// GET /api/sensor/[type] — a single reading, or a 24h series when ?series=1.
// In Next.js 16 the dynamic `params` is a Promise and must be awaited.

import { NextResponse, type NextRequest } from "next/server";
import { SENSOR_TYPES, isSensorType } from "@/lib/config";
import { parseParams } from "@/lib/params";
import { generateReading, generateSeries } from "@/lib/generator";

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
      {
        error: `Unknown sensor type "${rawType}".`,
        validTypes: SENSOR_TYPES,
      },
      { status: 404, headers: NO_STORE },
    );
  }

  const parsed = parseParams(request.nextUrl.searchParams, new Date());
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE });
  }

  const payload = parsed.value.series
    ? generateSeries(type, parsed.value)
    : generateReading(type, parsed.value);

  return NextResponse.json(payload, { headers: NO_STORE });
}
