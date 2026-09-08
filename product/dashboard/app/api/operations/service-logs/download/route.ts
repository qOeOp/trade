import { configuredServiceLogGatewayV1 } from "@/lib/service-log-gateway";

export const dynamic = "force-dynamic";

const QUERY_KEYS = new Set(["observedAt", "range", "kind", "service", "instance", "severity", "search"]);

function unavailable(reason: string, status: number) {
  return Response.json({
    schema_version: 1,
    operation: "dashboard.service_log_download.v1",
    availability: "unavailable",
    unavailable_reason: reason,
    observed_at: new Date().toISOString(),
  }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  if ([...search.keys()].some((key) => !QUERY_KEYS.has(key) || search.getAll(key).length !== 1)
    || !search.has("observedAt")) return unavailable("SERVICE_LOG_DOWNLOAD_QUERY_INVALID", 400);
  const input = {
    observedAt: search.get("observedAt")!,
    ...(search.has("range") ? { range: search.get("range")! } : {}),
    ...(search.has("kind") ? { kind: search.get("kind")! } : {}),
    ...(search.has("service") ? { service: search.get("service")! } : {}),
    ...(search.has("instance") ? { instanceIdentity: search.get("instance")! } : {}),
    ...(search.has("severity") ? { severity: search.get("severity")! } : {}),
    ...(search.has("search") ? { search: search.get("search")! } : {}),
  };
  try {
    const gateway = configuredServiceLogGatewayV1();
    if (!gateway) return unavailable("RUN_STORE_CONFIGURATION_UNAVAILABLE", 503);
    const result = await gateway.download(input);
    return new Response(result.bytes as BodyInit, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-disposition": "attachment; filename=service-logs.csv",
        "content-type": "text/csv; charset=utf-8",
        "x-content-type-options": "nosniff",
        "x-service-log-completeness": result.completeness,
        "x-service-log-cut-digest": result.filter_cut_digest,
        "x-service-log-row-count": String(result.row_count),
        "x-service-log-truncated": String(result.truncated),
      },
    });
  } catch (error) {
    const permissionDenied = Boolean(error && typeof error === "object" && "code" in error && error.code === "42501");
    const reason = permissionDenied ? "SERVICE_LOG_PERMISSION_DENIED"
      : error instanceof Error && ["SERVICE_LOG_QUERY_INVALID", "SERVICE_LOG_CUT_INVALID"].includes(error.message)
      ? "SERVICE_LOG_DOWNLOAD_QUERY_INVALID" : "SERVICE_LOG_STORE_UNAVAILABLE";
    return unavailable(reason, ["SERVICE_LOG_STORE_UNAVAILABLE", "SERVICE_LOG_PERMISSION_DENIED"].includes(reason) ? 503 : 400);
  }
}
