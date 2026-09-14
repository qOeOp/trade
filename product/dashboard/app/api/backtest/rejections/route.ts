import { NextResponse } from "next/server";

import { decodeExploratoryReplayOpaqueIdentityV2 } from "@/lib/exploratory-replay-identity";
import { readExploratoryReplayHistoricalRejectionGatewayV1 } from "@/lib/exploratory-replay-historical-rejection-gateway";

export const dynamic = "force-dynamic";

function losslessQueryEncoding(search: string): boolean {
  try {
    for (const field of search.slice(1).split("&")) {
      const separator = field.indexOf("=");
      const key = separator < 0 ? field : field.slice(0, separator);
      const value = separator < 0 ? "" : field.slice(separator + 1);
      decodeURIComponent(key.replaceAll("+", " "));
      decodeURIComponent(value.replaceAll("+", " "));
    }
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const search = url.searchParams;
  const validEncoding = losslessQueryEncoding(url.search);
  const allowed = new Set(["requestIdentityB64", "attemptIdentityB64", "semanticDigest"]);
  const exact = validEncoding
    && [...search.keys()].every((key) => allowed.has(key))
    && [...allowed].every((key) => search.getAll(key).length === 1);
  const requestIdentity = exact
    ? decodeExploratoryReplayOpaqueIdentityV2(search.get("requestIdentityB64") ?? "") ?? ""
    : "";
  const attemptIdentity = exact
    ? decodeExploratoryReplayOpaqueIdentityV2(search.get("attemptIdentityB64") ?? "") ?? ""
    : "";
  const semanticDigest = exact ? search.get("semanticDigest") ?? "" : "";
  const result = await readExploratoryReplayHistoricalRejectionGatewayV1({
    requestIdentity,
    attemptIdentity,
    semanticDigest,
  });
  return NextResponse.json(result.projection, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
