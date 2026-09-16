import { NextResponse } from "next/server";

import { readArtifactReviewInventoryV1 } from "@/lib/artifact-review-inventory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.size !== 0) {
    return NextResponse.json(
      { reason: "ARTIFACT_REVIEW_INVENTORY_QUERY_INVALID" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  const result = await readArtifactReviewInventoryV1();
  return NextResponse.json(result.projection, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
