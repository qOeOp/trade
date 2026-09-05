import { NextResponse } from "next/server";

import { readRunAuxiliaryEvidenceGatewayV1 } from "@/lib/run-auxiliary-evidence-gateway";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runIdentity: string }> },
) {
  const { runIdentity } = await params;
  const result = await readRunAuxiliaryEvidenceGatewayV1(runIdentity, "assets");
  return NextResponse.json(result.envelope, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
