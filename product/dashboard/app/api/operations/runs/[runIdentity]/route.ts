import { NextResponse } from "next/server";

import { readRunDetailGatewayV1 } from "@/lib/run-detail-gateway";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runIdentity: string }> },
) {
  const { runIdentity } = await params;
  const result = await readRunDetailGatewayV1(runIdentity);
  return NextResponse.json(result.envelope, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
