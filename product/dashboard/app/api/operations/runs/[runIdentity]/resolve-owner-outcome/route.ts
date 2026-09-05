import { NextResponse } from "next/server";

import { resolveRunOwnerOutcomeV1 } from "@/lib/owner-outcome-resolution-gateway";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runIdentity: string }> },
) {
  const { runIdentity } = await params;
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > 256) {
    const result = await resolveRunOwnerOutcomeV1({
      runIdentity: "",
      expectedTransitionVersion: 0,
    });
    return NextResponse.json(result.envelope, {
      status: 400,
      headers: { "cache-control": "no-store" },
    });
  }
  let expectedTransitionVersion = 0;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 256) throw new Error("REQUEST_TOO_LARGE");
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)
      || Object.keys(raw).join(",") !== "expected_transition_version") {
      throw new Error("REQUEST_INVALID");
    }
    expectedTransitionVersion = Number((raw as Record<string, unknown>).expected_transition_version);
  } catch {
    expectedTransitionVersion = 0;
  }
  const result = await resolveRunOwnerOutcomeV1({ runIdentity, expectedTransitionVersion });
  return NextResponse.json(result.envelope, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
