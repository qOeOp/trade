import { NextResponse } from "next/server";

import {
  readArtifactDirectoryGatewayV1,
  type ArtifactDirectoryCursorV1,
} from "@/lib/artifact-directory-gateway";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const allowed = new Set(["afterPreparedAtEpochMs", "afterBuildRequestIdentity"]);
  if ([...search.keys()].some((key) => !allowed.has(key))) {
    return NextResponse.json({ reason: "ARTIFACT_DIRECTORY_CURSOR_INVALID" }, { status: 400 });
  }
  const afterPreparedAtEpochMs = search.get("afterPreparedAtEpochMs");
  const afterBuildRequestIdentity = search.get("afterBuildRequestIdentity");
  let cursor: ArtifactDirectoryCursorV1 | undefined;
  if (afterPreparedAtEpochMs !== null || afterBuildRequestIdentity !== null) {
    if (afterPreparedAtEpochMs === null || afterBuildRequestIdentity === null
      || !/^\d+$/u.test(afterPreparedAtEpochMs)) {
      return NextResponse.json({ reason: "ARTIFACT_DIRECTORY_CURSOR_INVALID" }, { status: 400 });
    }
    cursor = {
      preparedAtEpochMs: Number(afterPreparedAtEpochMs),
      buildRequestIdentity: afterBuildRequestIdentity,
    };
  }
  const result = await readArtifactDirectoryGatewayV1({ cursor });
  return NextResponse.json(result.projection, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
