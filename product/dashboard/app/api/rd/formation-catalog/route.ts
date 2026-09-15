import { NextResponse } from "next/server";

import { ownerApiTargetForOperationV1 } from "@/lib/owner-api-target";
import { RD_FORMATION_CATALOG_SHADOW_READ_OPERATION } from "@/lib/operation-registry";
import { resolveRdFormationCatalogShadowV1 } from "@/lib/rd-formation-catalog-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const target = ownerApiTargetForOperationV1(RD_FORMATION_CATALOG_SHADOW_READ_OPERATION);
  const result = await resolveRdFormationCatalogShadowV1(target);
  return NextResponse.json(result.envelope, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
