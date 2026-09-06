import { NextResponse } from "next/server";

import {
  readResearchDirectoryGatewayV1,
  type ResearchDirectoryCursorV1,
} from "@/lib/research-directory-gateway";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const allowed = new Set(["afterCommittedAtEpochMs", "afterRequestIdentity"]);
  if ([...search.keys()].some((key) => !allowed.has(key) || search.getAll(key).length !== 1)) {
    return NextResponse.json({ reason: "RESEARCH_DIRECTORY_CURSOR_INVALID" }, { status: 400 });
  }
  const afterCommittedAtEpochMs = search.get("afterCommittedAtEpochMs");
  const afterRequestIdentity = search.get("afterRequestIdentity");
  let cursor: ResearchDirectoryCursorV1 | undefined;
  if (afterCommittedAtEpochMs !== null || afterRequestIdentity !== null) {
    if (afterCommittedAtEpochMs === null || afterRequestIdentity === null
      || !/^\d+$/u.test(afterCommittedAtEpochMs)) {
      return NextResponse.json({ reason: "RESEARCH_DIRECTORY_CURSOR_INVALID" }, { status: 400 });
    }
    cursor = {
      committedAtEpochMs: Number(afterCommittedAtEpochMs),
      requestIdentity: afterRequestIdentity,
    };
  }
  const result = await readResearchDirectoryGatewayV1({ cursor });
  return NextResponse.json(result.projection, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
