import { createHash } from "node:crypto";
import {
  isLosslessNumber,
  isSafeNumber,
  LosslessNumber,
  parse as parseLosslessJson,
  stringify as stringifyLosslessJson,
} from "lossless-json";

import { validExploratoryReplayOpaqueIdentityV2 } from "./exploratory-replay-identity.ts";

const DIGEST = /^(?:sha256|blake3):[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const MAX_U64 = 18_446_744_073_709_551_615n;

type Json = Record<string, unknown>;

export type ExploratoryReplayRequestInputV2 = Json & {
  schema_version: 2;
  request_identity: string;
  deterministic_seed: string;
  window: { start_event_ns: string; end_event_ns_exclusive: string };
};

export type ExploratoryReplayRunRequestV2 = {
  action: "RUN";
  build_request_identity: string;
  attempt_identity: string;
  build_receipt_identity: string;
  artifact_family_binding_identity: string;
  request: ExploratoryReplayRequestInputV2;
};

export type ExploratoryReplayDispatchRequestV2 = ExploratoryReplayRunRequestV2 & {
  selector: {
    request_identity: string;
    meaning_digest: string;
    canonical_request_digest: string;
  };
};

const REQUEST_KEYS = [
  "schema_version", "request_identity", "frozen_research_intent", "trial_family",
  "trial_family_census_frontier", "replay_authority", "strategy_design", "strategy_plan",
  "artifact", "resolved_owner_inputs", "pit_scope", "pit_snapshot", "universe_selection",
  "correction_rule", "market_semantics", "replay_configuration", "models",
  "runner_operational_profile", "diagnostic_policy", "deterministic_seed", "window",
  "calendar", "session", "time_zone", "corporate_action_cut", "historical_membership_cut",
] as const;
const CONTENT_KEYS = [
  "frozen_research_intent", "trial_family", "trial_family_census_frontier", "strategy_design",
  "strategy_plan", "artifact", "resolved_owner_inputs", "pit_scope", "pit_snapshot",
  "universe_selection", "replay_configuration", "corporate_action_cut", "historical_membership_cut",
] as const;
const VERSION_KEYS = [
  "correction_rule", "market_semantics", "runner_operational_profile", "diagnostic_policy",
  "calendar", "session", "time_zone",
] as const;
const MODEL_KEYS = ["runtime_kernel", "simulator", "cost", "slippage", "capacity"] as const;

function record(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Json, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join("\u001f") === [...expected].sort().join("\u001f");
}

function validIdentity(value: unknown): value is string {
  return validExploratoryReplayOpaqueIdentityV2(value);
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST.test(value);
}

function validU64(value: unknown): value is string {
  if (typeof value !== "string" || !DECIMAL.test(value)) return false;
  try {
    return BigInt(value) <= MAX_U64;
  } catch {
    return false;
  }
}

function ownerU64(value: unknown): string | null {
  if (isLosslessNumber(value)) return validU64(value.value) ? value.value : null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    && isSafeNumber(String(value), { approx: false }) ? String(value) : null;
}

function content(value: unknown): boolean {
  return record(value) && exactKeys(value, ["identity", "digest"])
    && validIdentity(value.identity) && validDigest(value.digest);
}

function versioned(value: unknown): boolean {
  return record(value) && exactKeys(value, ["identity", "version"])
    && validIdentity(value.identity) && validIdentity(value.version);
}

export function validExploratoryReplayRequestInputV2(
  value: unknown,
): value is ExploratoryReplayRequestInputV2 {
  if (!record(value) || !exactKeys(value, REQUEST_KEYS) || value.schema_version !== 2
    || !validIdentity(value.request_identity)
    || !record(value.replay_authority) || !exactKeys(value.replay_authority, ["namespace"])
    || value.replay_authority.namespace !== "EXPLORATORY"
    || !CONTENT_KEYS.every((key) => content(value[key]))
    || !VERSION_KEYS.every((key) => versioned(value[key]))
    || !record(value.models) || !exactKeys(value.models, MODEL_KEYS)
    || !MODEL_KEYS.every((key) => versioned((value.models as Json)[key]))
    || !validU64(value.deterministic_seed)
    || !record(value.window) || !exactKeys(value.window, ["start_event_ns", "end_event_ns_exclusive"])
    || !validU64(value.window.start_event_ns) || !validU64(value.window.end_event_ns_exclusive)) return false;
  return BigInt(value.window.start_event_ns) < BigInt(value.window.end_event_ns_exclusive);
}

export function canonicalExploratoryReplayRequestInputV2(
  value: unknown,
): ExploratoryReplayRequestInputV2 | null {
  if (!validExploratoryReplayRequestInputV2(value)) return null;
  const canonical = Object.fromEntries(REQUEST_KEYS.map((key) => {
    const entry = value[key];
    if (CONTENT_KEYS.includes(key as typeof CONTENT_KEYS[number])) {
      const pair = entry as Json;
      return [key, { identity: pair.identity, digest: pair.digest }];
    }
    if (VERSION_KEYS.includes(key as typeof VERSION_KEYS[number])) {
      const version = entry as Json;
      return [key, { identity: version.identity, version: version.version }];
    }
    if (key === "models") {
      const models = entry as Json;
      return [key, Object.fromEntries(MODEL_KEYS.map((modelKey) => {
        const version = models[modelKey] as Json;
        return [modelKey, { identity: version.identity, version: version.version }];
      }))];
    }
    if (key === "replay_authority") return [key, { namespace: "EXPLORATORY" }];
    if (key === "window") return [key, {
      start_event_ns: value.window.start_event_ns,
      end_event_ns_exclusive: value.window.end_event_ns_exclusive,
    }];
    return [key, entry];
  }));
  return canonical as ExploratoryReplayRequestInputV2;
}

export function normalizeExploratoryReplayOwnerRequestV2(
  value: unknown,
): ExploratoryReplayRequestInputV2 | null {
  if (!record(value) || !record(value.window)) return null;
  const deterministicSeed = ownerU64(value.deterministic_seed);
  const start = ownerU64(value.window.start_event_ns);
  const end = ownerU64(value.window.end_event_ns_exclusive);
  if (deterministicSeed === null || start === null || end === null) return null;
  return canonicalExploratoryReplayRequestInputV2({
    ...value,
    deterministic_seed: deterministicSeed,
    window: { start_event_ns: start, end_event_ns_exclusive: end },
  });
}

export function validExploratoryReplayRunRequestV2(
  value: unknown,
): value is ExploratoryReplayRunRequestV2 {
  if (!record(value) || !exactKeys(value, [
    "action", "build_request_identity", "attempt_identity", "build_receipt_identity",
    "artifact_family_binding_identity", "request",
  ]) || value.action !== "RUN" || !validExploratoryReplayRequestInputV2(value.request)) return false;
  return [value.build_request_identity, value.attempt_identity, value.build_receipt_identity,
    value.artifact_family_binding_identity].every(validIdentity);
}

export function canonicalExploratoryReplayRunRequestV2(
  value: unknown,
): ExploratoryReplayRunRequestV2 | null {
  if (!validExploratoryReplayRunRequestV2(value)) return null;
  const request = canonicalExploratoryReplayRequestInputV2(value.request);
  if (!request) return null;
  return {
    action: "RUN",
    build_request_identity: value.build_request_identity,
    attempt_identity: value.attempt_identity,
    build_receipt_identity: value.build_receipt_identity,
    artifact_family_binding_identity: value.artifact_family_binding_identity,
    request,
  };
}

export function canonicalExploratoryReplayDispatchRequestV2(
  value: unknown,
): ExploratoryReplayDispatchRequestV2 | null {
  if (!record(value) || !exactKeys(value, [
    "action", "build_request_identity", "attempt_identity", "build_receipt_identity",
    "artifact_family_binding_identity", "request", "selector",
  ]) || value.action !== "RUN" || !validExploratoryReplayRequestInputV2(value.request)
    || !record(value.selector) || !exactKeys(value.selector, [
      "request_identity", "meaning_digest", "canonical_request_digest",
    ]) || value.selector.request_identity !== value.request.request_identity
    || !validIdentity(value.selector.request_identity) || !validDigest(value.selector.meaning_digest)
    || !/^sha256:[0-9a-f]{64}$/.test(String(value.selector.canonical_request_digest))
    || ![value.build_request_identity, value.attempt_identity, value.build_receipt_identity,
      value.artifact_family_binding_identity].every(validIdentity)) return null;
  const run = canonicalExploratoryReplayRunRequestV2({
    action: "RUN",
    build_request_identity: value.build_request_identity,
    attempt_identity: value.attempt_identity,
    build_receipt_identity: value.build_receipt_identity,
    artifact_family_binding_identity: value.artifact_family_binding_identity,
    request: value.request,
  });
  if (!run) return null;
  return {
    ...run,
    selector: {
      request_identity: value.selector.request_identity as string,
      meaning_digest: value.selector.meaning_digest as string,
      canonical_request_digest: value.selector.canonical_request_digest as string,
    },
  };
}

export function exploratoryReplayOwnerRequestBodyV2(
  request: ExploratoryReplayRequestInputV2,
): string {
  const canonical = canonicalExploratoryReplayRequestInputV2(request);
  if (!canonical) throw new Error("EXPLORATORY_REPLAY_REQUEST_INVALID");
  const ownerRequest = {
    ...canonical,
    deterministic_seed: new LosslessNumber(canonical.deterministic_seed),
    window: {
      start_event_ns: new LosslessNumber(canonical.window.start_event_ns),
      end_event_ns_exclusive: new LosslessNumber(canonical.window.end_event_ns_exclusive),
    },
  };
  const serialized = stringifyLosslessJson(ownerRequest);
  if (serialized === undefined) throw new Error("EXPLORATORY_REPLAY_REQUEST_INVALID");
  return serialized;
}

export function exploratoryReplayOwnerProposalBodyV2(
  request: ExploratoryReplayRunRequestV2 | ExploratoryReplayDispatchRequestV2,
): string {
  const serialized = stringifyLosslessJson({
    build_request_identity: request.build_request_identity,
    attempt_identity: request.attempt_identity,
    build_receipt_identity: request.build_receipt_identity,
    artifact_family_binding_identity: request.artifact_family_binding_identity,
    request: parseLosslessJson(exploratoryReplayOwnerRequestBodyV2(request.request)),
  });
  if (serialized === undefined) throw new Error("EXPLORATORY_REPLAY_REQUEST_INVALID");
  return serialized;
}

export function canonicalReplayRequestDigestV2(bytes: readonly number[]): string {
  return `sha256:${createHash("sha256").update(Uint8Array.from(bytes)).digest("hex")}`;
}
