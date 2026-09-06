import { NextResponse } from "next/server";

import { readSourceIntakeReadbackGatewayV1 } from "@/lib/source-intake-readback-gateway";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ requestIdentity: string }> },
) {
  const { requestIdentity } = await params;
  const result = await readSourceIntakeReadbackGatewayV1({ requestIdentity });
  return NextResponse.json(result.projection, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
