import { NextResponse } from "next/server";

import { decodeExploratoryReplayOpaqueIdentityV2 } from "@/lib/exploratory-replay-identity";
import { readExploratoryReplayResultGatewayV1 } from "@/lib/exploratory-replay-result-gateway";
import { losslessQueryEncoding } from "@/lib/lossless-query-encoding";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const search = url.searchParams;
  const allowed = new Set([
    "requestIdentityB64", "meaningDigest", "attemptIdentityB64", "resultIdentityB64",
  ]);
  const validEncoding = losslessQueryEncoding(url.search);
  const exact = [...allowed].every((key) => search.getAll(key).length === 1)
    && ![...search.keys()].some((key) => !allowed.has(key));
  const decode = (key: string) => validEncoding && exact
    ? decodeExploratoryReplayOpaqueIdentityV2(search.get(key) ?? "") ?? "" : "";
  const result = await readExploratoryReplayResultGatewayV1({
    requestIdentity: decode("requestIdentityB64"),
    meaningDigest: validEncoding && exact ? search.get("meaningDigest") ?? "" : "",
    attemptIdentity: decode("attemptIdentityB64"),
    resultIdentity: decode("resultIdentityB64"),
  });
  return NextResponse.json(result.projection, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
