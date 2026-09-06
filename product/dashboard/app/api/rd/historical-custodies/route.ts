import { NextResponse } from "next/server";

import { ownerApiTargetForOperationV1 } from "@/lib/owner-api-target";
import { RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION } from "@/lib/operation-registry";
import { resolveHistoricalCustodyShadowV1 } from "@/lib/rd-historical-custody-client";
import { journalShadowReadV1 } from "@/lib/shadow-run-journal";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.size !== 0) {
    return NextResponse.json(
      { reason: "HISTORICAL_CUSTODY_QUERY_INVALID" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  const owner = ownerApiTargetForOperationV1(RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION);
  const result = await journalShadowReadV1({
    operationId: RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION,
    recoveryIdentity: {},
    read: () => resolveHistoricalCustodyShadowV1({ baseUrl: owner.baseUrl, token: owner.token }),
  });
  return NextResponse.json(result.envelope, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
