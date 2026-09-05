import { NextResponse } from "next/server";

import { readRunDetailGatewayV1 } from "@/lib/run-detail-gateway";
import { serializeBoundedRunResultV1 } from "@/lib/run-detail-projection";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runIdentity: string }> },
) {
  const { runIdentity } = await params;
  const result = await readRunDetailGatewayV1(runIdentity);
  const body = result.envelope.availability === "available"
    ? serializeBoundedRunResultV1(result.envelope.bounded_result)
    : null;
  if (!body) {
    return NextResponse.json(result.envelope, {
      status: result.envelope.operational_cache
        && result.envelope.operational_cache.state !== "retained" ? 410
        : result.status === 200 ? 503 : result.status,
      headers: { "cache-control": "no-store" },
    });
  }
  return new NextResponse(body, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${runIdentity}.bounded-result.json"`,
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
