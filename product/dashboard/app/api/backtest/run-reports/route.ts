import { NextResponse } from "next/server";

import { readBacktestRunReportGatewayV1 } from "@/lib/backtest-run-report-gateway";
import { decodeExploratoryReplayOpaqueIdentityV2 } from "@/lib/exploratory-replay-identity";
import { losslessQueryEncoding } from "@/lib/lossless-query-encoding";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const search = url.searchParams;
  const allowed = new Set(["resultIdentityB64", "requestIdentityB64", "attemptIdentityB64"]);
  const exact = losslessQueryEncoding(url.search)
    && [...search.keys()].every((key) => allowed.has(key))
    && [...allowed].every((key) => search.getAll(key).length === 1);
  const decode = (key: string) => exact
    ? decodeExploratoryReplayOpaqueIdentityV2(search.get(key) ?? "") ?? "" : "";
  const result = await readBacktestRunReportGatewayV1({
    locator: {
      result_identity: decode("resultIdentityB64"),
      request_identity: decode("requestIdentityB64"),
      attempt_identity: decode("attemptIdentityB64"),
    },
  });
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
