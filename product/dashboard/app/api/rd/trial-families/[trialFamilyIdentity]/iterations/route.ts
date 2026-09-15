import { NextResponse } from "next/server";

import { ownerApiTargetForOperationV1 } from "@/lib/owner-api-target";
import { RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION } from "@/lib/operation-registry";
import { resolveRdIterationTimelineShadowV1 } from "@/lib/rd-iteration-timeline-client";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ trialFamilyIdentity: string }> },
) {
  const { trialFamilyIdentity } = await params;
  const target = ownerApiTargetForOperationV1(RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION);
  const result = await resolveRdIterationTimelineShadowV1({
    trialFamilyIdentity,
    ...target,
  });
  return NextResponse.json(result.envelope, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
