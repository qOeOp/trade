import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// A server started with DASHBOARD_INSTANCE_NONCE echoes it, so whoever started it can tell its
// own server from another one answering on the same address. It carries no data either way.
export function GET() {
  const instance = process.env.DASHBOARD_INSTANCE_NONCE;
  return NextResponse.json(
    { schema_version: 1, status: "ok" },
    {
      status: 200,
      headers: {
        "cache-control": "no-store",
        ...(instance ? { "x-dashboard-instance-nonce": instance } : {}),
      },
    },
  );
}
