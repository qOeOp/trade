import { NextResponse } from "next/server";

import { readDevelopComposerGatewayV1 } from "@/lib/develop-composer-readback-gateway";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ requestIdentity: string }> },
) {
  const { requestIdentity } = await params;
  const result = await readDevelopComposerGatewayV1({ requestIdentity });
  return NextResponse.json(result.projection, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
