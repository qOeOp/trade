import { createHash } from "node:crypto";

import {
  unavailableStrategyCodeViewer,
  type StrategyCodeViewerProjection,
} from "./strategy-code-viewer-contract.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const MAX_SOURCE_BYTES = 256 * 1024;
const OWNER_KEYS = [
  "artifact_identity",
  "attempt_identity",
  "build_request_identity",
  "file_name",
  "language",
  "observed_at_epoch_ms",
  "schema_version",
  "source",
  "source_digest",
  "wasm_preview_reason",
  "wasm_preview_status",
];

type Fetcher = typeof fetch;

export type ArtifactSourceGatewayResultV1 = Readonly<{
  status: 200 | 400 | 404 | 502 | 503;
  projection: StrategyCodeViewerProjection;
}>;

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function identity(value: unknown): value is string {
  return typeof value === "string" && IDENTITY.test(value);
}

function unavailable(status: ArtifactSourceGatewayResultV1["status"], reason: string) {
  return { status, projection: unavailableStrategyCodeViewer(reason) } as const;
}

function ownerEndpoint(
  baseUrl: string,
  buildRequestIdentity: string,
  attemptIdentity: string,
): URL | null {
  try {
    const base = new URL(baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password
      || base.pathname !== "/" || base.search || base.hash) return null;
    return new URL(
      `/v1/artifact-builds/${encodeURIComponent(buildRequestIdentity)}/attempts/${encodeURIComponent(attemptIdentity)}/source`,
      base,
    );
  } catch {
    return null;
  }
}

export function projectArtifactSourceOwnerReadbackV1(
  value: unknown,
  buildRequestIdentity: string,
  attemptIdentity: string,
): StrategyCodeViewerProjection | null {
  if (!object(value) || !exactKeys(value, OWNER_KEYS)
    || value.schema_version !== 1
    || value.build_request_identity !== buildRequestIdentity
    || value.attempt_identity !== attemptIdentity
    || !identity(value.artifact_identity)
    || !Number.isSafeInteger(value.observed_at_epoch_ms)
    || Number(value.observed_at_epoch_ms) < 0
    || typeof value.file_name !== "string"
    || value.file_name !== "strategy.rs"
    || value.language !== "rust"
    || typeof value.source !== "string"
    || value.source.includes("\0")
    || new TextEncoder().encode(value.source).byteLength > MAX_SOURCE_BYTES
    || typeof value.source_digest !== "string"
    || !DIGEST.test(value.source_digest)
    || value.source_digest !== `sha256:${createHash("sha256").update(value.source).digest("hex")}`
    || value.wasm_preview_status !== "NOT_RUN"
    || value.wasm_preview_reason !== "WASM_PREVIEW_NOT_RUN") return null;

  const observedDate = new Date(Number(value.observed_at_epoch_ms));
  if (Number.isNaN(observedDate.getTime())) return null;
  const observedAt = observedDate.toISOString();
  return {
    availability: "available",
    artifactIdentity: value.artifact_identity,
    observedAt,
    source: {
      fileName: value.file_name,
      language: "rust",
      content: value.source,
      digest: value.source_digest,
    },
    wasmPreview: {
      status: "not_run",
      moduleIdentity: null,
      target: null,
      durationMs: null,
      observedAt: null,
      output: null,
      diagnostics: [],
      reason: value.wasm_preview_reason,
    },
    reason: null,
  };
}

export async function readArtifactSourceGatewayV1({
  buildRequestIdentity,
  attemptIdentity,
  baseUrl = process.env.RD_OWNER_API_URL,
  token = process.env.RD_OWNER_API_TOKEN,
  fetcher = fetch,
}: {
  buildRequestIdentity: string;
  attemptIdentity: string;
  baseUrl?: string;
  token?: string;
  fetcher?: Fetcher;
}): Promise<ArtifactSourceGatewayResultV1> {
  if (!identity(buildRequestIdentity) || !identity(attemptIdentity)) {
    return unavailable(400, "ARTIFACT_SOURCE_IDENTITY_INVALID");
  }
  const endpoint = baseUrl ? ownerEndpoint(baseUrl, buildRequestIdentity, attemptIdentity) : null;
  if (!endpoint || !token) return unavailable(503, "OWNER_CONFIGURATION_UNAVAILABLE");
  try {
    const response = await fetcher(endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404) return unavailable(404, "ARTIFACT_SOURCE_UNAVAILABLE");
    if (!response.ok) return unavailable(response.status >= 500 ? 503 : 502, "OWNER_RESPONSE_UNAVAILABLE");
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && (!/^\d+$/u.test(contentLength)
      || Number(contentLength) > 512 * 1024)) {
      return unavailable(502, "OWNER_RESPONSE_UNAVAILABLE");
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > 512 * 1024) {
      return unavailable(502, "OWNER_RESPONSE_UNAVAILABLE");
    }
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return unavailable(502, "OWNER_RESPONSE_UNAVAILABLE"); }
    const projection = projectArtifactSourceOwnerReadbackV1(
      raw,
      buildRequestIdentity,
      attemptIdentity,
    );
    return projection
      ? { status: 200, projection }
      : unavailable(502, "OWNER_RESPONSE_UNAVAILABLE");
  } catch {
    return unavailable(503, "OWNER_TRANSPORT_UNAVAILABLE");
  }
}
