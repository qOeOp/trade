import { NextResponse } from "next/server";

import { readResearchReadbackGatewayV1 } from "@/lib/research-readback-gateway";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ requestIdentity: string }> },
) {
  const { requestIdentity } = await params;
  const result = await readResearchReadbackGatewayV1({ requestIdentity });
  return NextResponse.json(result.projection, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
