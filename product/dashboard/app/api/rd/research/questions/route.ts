import { NextResponse } from "next/server";

import { readResearchQuestionDirectoryV1 } from "@/lib/research-question-directory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.size !== 0) {
    return NextResponse.json({ reason: "RESEARCH_QUESTION_QUERY_INVALID" }, { status: 400 });
  }
  const result = await readResearchQuestionDirectoryV1();
  return NextResponse.json(result.projection ?? { reason: "RESEARCH_QUESTION_DIRECTORY_UNAVAILABLE" }, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
