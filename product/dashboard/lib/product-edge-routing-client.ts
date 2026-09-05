import { createHash } from "node:crypto";

const ROUTING_PATH_V1 = "/v1/operation-routing";
const MAX_ROUTING_RESPONSE_BYTES_V1 = 65_536;
const ROUTING_BINDING_IDENTITY = /^product-edge-operation-routing-binding-v1-[0-9a-f]{64}$/;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;

type Fetcher = typeof fetch;

export type ProductEdgeRoutingLookupKeyV1 = {
  operation: string;
  version: number;
  channel: string;
};

export const PRODUCT_EDGE_RESEARCH_GOAL_ROUTING_KEY_V2 = {
  operation: "research_goal.submit_or_resolve.v2",
  version: 2,
  channel: "WINDMILL_PRODUCT_EDGE",
} as const satisfies ProductEdgeRoutingLookupKeyV1;

export const PRODUCT_EDGE_ARTIFACT_BUILD_ROUTING_KEY_V1 = {
  operation: "artifact_build.submit_or_resolve.v1",
  version: 1,
  channel: "WINDMILL_PRODUCT_EDGE",
} as const satisfies ProductEdgeRoutingLookupKeyV1;

export const PRODUCT_EDGE_SOURCE_INTAKE_ROUTING_KEY_V1 = {
  operation: "source_intake.openalex_work_by_doi.submit_or_resolve.v1",
  version: 1,
  channel: "WINDMILL_PRODUCT_EDGE",
} as const satisfies ProductEdgeRoutingLookupKeyV1;

export type ProductEdgeRoutingObservationV1 =
  | {
      state: "ACTIVE";
      dispatcher: "WINDMILL" | "TRADE_DASHBOARD";
      binding_identity: string;
      binding_digest: string;
      generation: number;
      history_head_identity: string;
    }
  | {
      state: "ZERO_ACTIVE";
      dispatcher: "NONE";
      binding_identity: null;
      binding_digest: null;
      generation: number;
      history_head_identity: string;
    }
  | {
      state: "UNAVAILABLE";
      dispatcher: "NONE";
      binding_identity: null;
      binding_digest: null;
      generation: null;
      history_head_identity: null;
    };

export type ProductEdgeExecutionRoutingV1 =
  | Pick<Extract<ProductEdgeRoutingObservationV1, { state: "ACTIVE" }>,
      "state" | "dispatcher" | "binding_identity" | "binding_digest" | "generation">
  | Pick<Extract<ProductEdgeRoutingObservationV1, { state: "ZERO_ACTIVE" }>,
      "state" | "dispatcher" | "binding_identity" | "binding_digest" | "generation">
  | Pick<Extract<ProductEdgeRoutingObservationV1, { state: "UNAVAILABLE" }>,
      "state" | "dispatcher" | "binding_identity" | "binding_digest" | "generation">;

type RoutingEnvironmentV1 = {
  PRODUCT_EDGE_ROUTING_READ_API_URL?: string;
  PRODUCT_EDGE_ROUTING_READ_API_TOKEN?: string;
  PRODUCT_EDGE_DEPLOYMENT_IDENTITY?: string;
};

export async function resolveProductEdgeRoutingV1(
  key: ProductEdgeRoutingLookupKeyV1,
  options: {
    environment?: RoutingEnvironmentV1;
    fetcher?: Fetcher;
    timeoutMs?: number;
  } = {},
): Promise<ProductEdgeRoutingObservationV1> {
  const environment = options.environment ?? process.env;
  const baseUrl = environment.PRODUCT_EDGE_ROUTING_READ_API_URL;
  const token = environment.PRODUCT_EDGE_ROUTING_READ_API_TOKEN;
  const deploymentIdentity = environment.PRODUCT_EDGE_DEPLOYMENT_IDENTITY;
  if (!baseUrl
    || !token
    || !deploymentIdentity
    || deploymentIdentity.trim().length === 0
    || !validLookupKey(key)) return unavailable();

  let url: URL;
  try {
    url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return unavailable();
    url.pathname = `${url.pathname.replace(/\/$/, "")}${ROUTING_PATH_V1}`;
    url.search = "";
    url.searchParams.set("operation", key.operation);
    url.searchParams.set("version", String(key.version));
    url.searchParams.set("channel", key.channel);
  } catch {
    return unavailable();
  }

  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 3_000),
    });
    if (!response.ok) return unavailable();
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_ROUTING_RESPONSE_BYTES_V1) {
      return unavailable();
    }
    return parseRoutingResolutionV1(JSON.parse(body), deploymentIdentity, key) ?? unavailable();
  } catch {
    return unavailable();
  }
}

export function parseRoutingResolutionV1(
  raw: unknown,
  deploymentIdentity: string,
  expectedKey: ProductEdgeRoutingLookupKeyV1,
): ProductEdgeRoutingObservationV1 | null {
  if (deploymentIdentity.trim().length === 0
    || !validLookupKey(expectedKey)
    || !record(raw)
    || typeof raw.state !== "string") return null;
  if (raw.state === "ACTIVE") {
    if (!exactKeys(raw, ["binding", "history_head_identity", "observed_at_epoch_ms", "state"])
      || !safeEpoch(raw.observed_at_epoch_ms)
      || !record(raw.binding)
      || !exactKeys(raw.binding, [
        "binding_digest", "binding_identity", "committed_at_epoch_ms",
        "deployment_binding_digest", "deployment_binding_identity", "dispatcher", "generation",
        "key", "manifest_digest", "manifest_identity", "predecessor_binding_identity",
        "schema_version",
      ])) return null;
    const binding = raw.binding;
    if (binding.schema_version !== 1
      || typeof raw.history_head_identity !== "string"
      || typeof binding.binding_identity !== "string"
      || typeof binding.binding_digest !== "string"
      || typeof binding.dispatcher !== "string"
      || !exactRoutingKey(binding.key, deploymentIdentity, expectedKey)
      || (binding.dispatcher !== "WINDMILL" && binding.dispatcher !== "TRADE_DASHBOARD")
      || !safePositive(binding.generation)
      || !safeEpoch(binding.committed_at_epoch_ms)
      || binding.committed_at_epoch_ms > raw.observed_at_epoch_ms
      || (binding.predecessor_binding_identity !== null
        && (typeof binding.predecessor_binding_identity !== "string"
          || !ROUTING_BINDING_IDENTITY.test(binding.predecessor_binding_identity)))
      || ((binding.generation === 1) !== (binding.predecessor_binding_identity === null))
      || typeof binding.deployment_binding_identity !== "string"
      || binding.deployment_binding_identity.trim().length === 0
      || !SHA256_DIGEST.test(String(binding.deployment_binding_digest))
      || typeof binding.manifest_identity !== "string"
      || binding.manifest_identity.trim().length === 0
      || !SHA256_DIGEST.test(String(binding.manifest_digest))
      || !SHA256_DIGEST.test(String(binding.binding_digest))
      || !ROUTING_BINDING_IDENTITY.test(String(binding.binding_identity))
      || raw.history_head_identity !== binding.binding_identity) return null;

    const content = {
      schema_version: 1,
      key: {
        deployment_identity: deploymentIdentity,
        operation: expectedKey.operation,
        version: expectedKey.version,
        channel: expectedKey.channel,
      },
      generation: binding.generation,
      predecessor_binding_identity: binding.predecessor_binding_identity,
      deployment_binding_identity: binding.deployment_binding_identity,
      deployment_binding_digest: binding.deployment_binding_digest,
      manifest_identity: binding.manifest_identity,
      manifest_digest: binding.manifest_digest,
      dispatcher: binding.dispatcher,
      committed_at_epoch_ms: binding.committed_at_epoch_ms,
    };
    const expectedDigest = canonicalDigestV1(
      "product-edge.operation-routing-binding.v1",
      content,
    );
    const expectedIdentity = identityV1(
      "product-edge-operation-routing-binding-v1",
      [expectedDigest],
    );
    if (binding.binding_digest !== expectedDigest || binding.binding_identity !== expectedIdentity) {
      return null;
    }
    return {
      state: "ACTIVE",
      dispatcher: binding.dispatcher,
      binding_identity: binding.binding_identity,
      binding_digest: binding.binding_digest,
      generation: binding.generation,
      history_head_identity: raw.history_head_identity,
    };
  }
  if (raw.state === "ZERO_ACTIVE") {
    if (!exactKeys(raw, ["generation", "history_head_identity", "key", "observed_at_epoch_ms", "state"])
      || !safePositive(raw.generation)
      || !safeEpoch(raw.observed_at_epoch_ms)
      || !ROUTING_BINDING_IDENTITY.test(String(raw.history_head_identity))
      || !exactRoutingKey(raw.key, deploymentIdentity, expectedKey)) return null;
    return {
      state: "ZERO_ACTIVE",
      dispatcher: "NONE",
      binding_identity: null,
      binding_digest: null,
      generation: raw.generation,
      history_head_identity: String(raw.history_head_identity),
    };
  }
  return null;
}

function exactRoutingKey(
  raw: unknown,
  deploymentIdentity: string,
  expectedKey: ProductEdgeRoutingLookupKeyV1,
): boolean {
  return record(raw)
    && exactKeys(raw, ["channel", "deployment_identity", "operation", "version"])
    && raw.deployment_identity === deploymentIdentity
    && raw.operation === expectedKey.operation
    && raw.version === expectedKey.version
    && raw.channel === expectedKey.channel;
}

function canonicalDigestV1(domain: string, value: unknown): string {
  const bytes = Buffer.from(JSON.stringify(value));
  return `sha256:${createHash("sha256")
    .update(u64(domain.length))
    .update(domain)
    .update(u64(bytes.length))
    .update(bytes)
    .digest("hex")}`;
}

function identityV1(domain: string, parts: readonly string[]): string {
  const hash = createHash("sha256").update(u64(domain.length)).update(domain);
  for (const part of parts) hash.update(u64(Buffer.byteLength(part))).update(part);
  return `${domain.replaceAll(".", "-")}-${hash.digest("hex")}`;
}

function u64(value: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
}

function validLookupKey(key: ProductEdgeRoutingLookupKeyV1): boolean {
  return typeof key.operation === "string"
    && key.operation.trim().length > 0
    && Number.isSafeInteger(key.version)
    && key.version > 0
    && key.version <= 0xffff_ffff
    && typeof key.channel === "string"
    && routingToken(key.channel);
}

function routingToken(value: string): boolean {
  const match = value.match(/[A-Z0-9_.-]+/u);
  return match?.[0] === value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\u001f") === [...keys].sort().join("\u001f");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safePositive(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function safeEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function unavailable(): ProductEdgeRoutingObservationV1 {
  return {
    state: "UNAVAILABLE",
    dispatcher: "NONE",
    binding_identity: null,
    binding_digest: null,
    generation: null,
    history_head_identity: null,
  };
}
