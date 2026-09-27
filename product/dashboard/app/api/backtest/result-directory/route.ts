import { NextResponse } from "next/server";

import { decodeExploratoryReplayOpaqueIdentityV2 } from "@/lib/exploratory-replay-identity";
import { readExploratoryReplayResultDirectoryGatewayV1 } from "@/lib/exploratory-replay-result-directory-gateway";
import { losslessQueryEncoding } from "@/lib/lossless-query-encoding";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const search = url.searchParams;
  const allowed = new Set(["requestIdentityB64", "meaningDigest"]);
  const exact = losslessQueryEncoding(url.search)
    && [...search.keys()].every((key) => allowed.has(key))
    && [...allowed].every((key) => search.getAll(key).length === 1);
  const result = await readExploratoryReplayResultDirectoryGatewayV1({
    requestIdentity: exact
      ? decodeExploratoryReplayOpaqueIdentityV2(search.get("requestIdentityB64") ?? "") ?? ""
      : "",
    meaningDigest: exact ? search.get("meaningDigest") ?? "" : "",
  });
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
