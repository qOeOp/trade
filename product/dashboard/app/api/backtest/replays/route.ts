import { NextResponse } from "next/server";

import { readExploratoryReplayReadbackGatewayV1 } from "@/lib/exploratory-replay-readback-gateway";

export const dynamic = "force-dynamic";

function losslessQueryEncoding(search: string): boolean {
  try {
    for (const field of search.slice(1).split("&")) {
      const separator = field.indexOf("=");
      const key = separator < 0 ? field : field.slice(0, separator);
      const value = separator < 0 ? "" : field.slice(separator + 1);
      const decodedKey = decodeURIComponent(key.replaceAll("+", " "));
      const decodedValue = decodeURIComponent(value.replaceAll("+", " "));
      // Next normalizes malformed UTF-8 query octets to U+FFFD before route dispatch.
      // The original bytes are no longer distinguishable from an encoded replacement
      // character, so reject the ambiguous transport value instead of querying Owner.
      if (decodedKey.includes("\uFFFD") || decodedValue.includes("\uFFFD")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const validEncoding = losslessQueryEncoding(url.search);
  const search = url.searchParams;
  const requestIdentities = search.getAll("requestIdentity");
  const meaningDigests = search.getAll("meaningDigest");
  const hasUnknownQuery = [...search.keys()].some(
    (key) => key !== "requestIdentity" && key !== "meaningDigest",
  );
  const requestIdentity = validEncoding && requestIdentities.length === 1 && !hasUnknownQuery
    ? requestIdentities[0]
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
