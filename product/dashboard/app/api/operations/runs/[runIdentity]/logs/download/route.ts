import { NextResponse } from "next/server";

import { readRunLogGatewayV1 } from "@/lib/run-log-gateway";
import { serializeRunLogDownloadV1 } from "@/lib/run-log-contract";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runIdentity: string }> },
) {
  const { runIdentity } = await params;
  const result = await readRunLogGatewayV1({
    runIdentity,
    search: new URL(request.url).searchParams,
    download: true,
  });
  if (result.envelope.availability !== "available") {
    return NextResponse.json(result.envelope, {
      status: result.status,
      headers: { "cache-control": "no-store" },
    });
  }
  const body = serializeRunLogDownloadV1(result.envelope);
  if (body === null) {
    return NextResponse.json({ ...result.envelope, availability: "unavailable",
      unavailable_reason: "RUN_LOG_DOWNLOAD_UNAVAILABLE", retained_until: null, logs: [], next_cursor: null }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  return new Response(body, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${runIdentity}.bounded.log.txt"`,
      "x-content-type-options": "nosniff",
    },
  });
}
