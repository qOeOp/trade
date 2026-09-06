import { NextResponse } from "next/server";

import { readExploratoryReplayReadbackGatewayV1 } from "@/lib/exploratory-replay-readback-gateway";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ requestIdentity: string }> },
) {
  const { requestIdentity } = await params;
  const search = new URL(request.url).searchParams;
  const meaningDigests = search.getAll("meaningDigest");
  const hasUnknownQuery = [...search.keys()].some((key) => key !== "meaningDigest");
  const meaningDigest = meaningDigests.length === 1 && !hasUnknownQuery
    ? meaningDigests[0]
    : "";
  const result = await readExploratoryReplayReadbackGatewayV1({
    requestIdentity,
    meaningDigest,
  });
  return NextResponse.json(result.projection, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
