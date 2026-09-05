import { NextResponse } from "next/server";

import { readRunLogGatewayV1 } from "@/lib/run-log-gateway";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runIdentity: string }> },
) {
  const { runIdentity } = await params;
  const result = await readRunLogGatewayV1({
    runIdentity,
    search: new URL(request.url).searchParams,
  });
  return NextResponse.json(result.envelope, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
