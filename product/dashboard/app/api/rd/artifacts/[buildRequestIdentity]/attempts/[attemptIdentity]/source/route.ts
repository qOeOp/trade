import { NextResponse } from "next/server";

import { readArtifactSourceGatewayV1 } from "@/lib/artifact-source-gateway";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ buildRequestIdentity: string; attemptIdentity: string }> },
) {
  const { buildRequestIdentity, attemptIdentity } = await params;
  const result = await readArtifactSourceGatewayV1({ buildRequestIdentity, attemptIdentity });
  return NextResponse.json(result.projection, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
