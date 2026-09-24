import { NextResponse } from "next/server";

import { decodeExploratoryReplayOpaqueIdentityV2 } from "@/lib/exploratory-replay-identity";
import { readExploratoryReplayReadbackGatewayV1 } from "@/lib/exploratory-replay-readback-gateway";
import { losslessQueryEncoding } from "@/lib/lossless-query-encoding";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const validEncoding = losslessQueryEncoding(url.search);
  const search = url.searchParams;
  const requestIdentities = search.getAll("requestIdentityB64");
  const meaningDigests = search.getAll("meaningDigest");
  const hasUnknownQuery = [...search.keys()].some(
    (key) => key !== "requestIdentityB64" && key !== "meaningDigest",
  );
  const requestIdentity = validEncoding && requestIdentities.length === 1 && !hasUnknownQuery
    ? decodeExploratoryReplayOpaqueIdentityV2(requestIdentities[0]) ?? ""
    : "";
  const meaningDigest = validEncoding && meaningDigests.length === 1 && !hasUnknownQuery
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
