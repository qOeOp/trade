import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { schema_version: 1, status: "ok" },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
