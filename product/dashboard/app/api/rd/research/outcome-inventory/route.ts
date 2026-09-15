import { NextResponse } from "next/server";

import { readResearchOutcomeInventoryV1 } from "@/lib/research-outcome-inventory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.size !== 0) {
    return NextResponse.json(
      { reason: "RESEARCH_OUTCOME_INVENTORY_QUERY_INVALID" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  const result = await readResearchOutcomeInventoryV1();
  return NextResponse.json(result.projection, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
