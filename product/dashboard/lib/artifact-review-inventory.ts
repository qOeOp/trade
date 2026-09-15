import {
  readArtifactHistoricalGatewayV1,
  type ArtifactHistoricalDispositionV1,
  type ArtifactHistoricalReadbackGatewayResultV1,
} from "./artifact-readback-gateway.ts";
import { ownerApiTargetForOperationV1 } from "./owner-api-target.ts";
import { RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION } from "./operation-registry.ts";
import {
  resolveHistoricalCustodyShadowV1,
  type HistoricalCustodyProjectionV1,
} from "./rd-historical-custody-client.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,256}$/u;
const MAX_CONCURRENCY = 6;
const PROJECTION_KEYS = [
  "availability",
  "candidateTotal",
  "completeness",
  "items",
  "observedAt",
  "reason",
  "reviewableTotal",
  "scannedCandidateCount",
  "sourceObservedAt",
  "unavailableTotal",
] as const;
const ITEM_KEYS = [
  "attemptIdentity",
  "availability",
  "buildRequestIdentity",
  "disposition",
  "reason",
] as const;

type HistoricalReadResultV1 = Awaited<ReturnType<typeof resolveHistoricalCustodyShadowV1>>;
type HistoricalReaderV1 = () => Promise<HistoricalReadResultV1>;
type ArtifactReaderV1 = (candidate: {
  buildRequestIdentity: string;
  attemptIdentity: string;
}) => Promise<ArtifactHistoricalReadbackGatewayResultV1>;

export type ArtifactReviewInventoryItemV1 = Readonly<{
  buildRequestIdentity: string;
  attemptIdentity: string;
  availability: "reviewable" | "unavailable";
  disposition: ArtifactHistoricalDispositionV1 | null;
  reason: string | null;
}>;

export type ArtifactReviewInventoryProjectionV1 = Readonly<{
  availability: "available" | "unavailable";
  observedAt: string | null;
  sourceObservedAt: string | null;
  completeness: "complete" | "partial" | null;
  candidateTotal: number;
  scannedCandidateCount: number;
  reviewableTotal: number;
  unavailableTotal: number;
  items: readonly ArtifactReviewInventoryItemV1[];
  reason: string | null;
}>;

export type ArtifactReviewInventoryResultV1 = Readonly<{
  status: 200 | 502 | 503;
  projection: ArtifactReviewInventoryProjectionV1;
}>;

export function artifactReviewInventoryMatchesCustodyV1(
  review: ArtifactReviewInventoryProjectionV1 | null,
  custody: HistoricalCustodyProjectionV1 | null,
): boolean {
  if (!review || review.availability !== "available" || !custody
    || custody.resolution !== "RETRIEVED"
    || review.candidateTotal !== custody.artifactAttemptTotal
    || review.scannedCandidateCount !== custody.artifactAttempts.length
    || review.items.length !== custody.artifactAttempts.length) return false;
  const reviewIdentities = new Set(review.items.map((item) => (
    `${item.buildRequestIdentity}\u0000${item.attemptIdentity}`
  )));
  return reviewIdentities.size === review.items.length
    && custody.artifactAttempts.every((item) => reviewIdentities.has(
      `${item.buildRequestIdentity}\u0000${item.attemptIdentity}`,
    ));
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function identity(value: unknown): value is string {
  return typeof value === "string" && IDENTITY.test(value) && value !== "." && value !== "..";
}

function canonicalTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function unavailable(reason: string, status: 502 | 503): ArtifactReviewInventoryResultV1 {
  return {
    status,
    projection: {
      availability: "unavailable",
      observedAt: null,
      sourceObservedAt: null,
      completeness: null,
      candidateTotal: 0,
      scannedCandidateCount: 0,
      reviewableTotal: 0,
      unavailableTotal: 0,
      items: [],
      reason,
    },
  };
}

async function mapBounded<T, R>(
  values: readonly T[],
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const consume = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index]);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(MAX_CONCURRENCY, values.length) },
    () => consume(),
  ));
  return results;
}

function projectItem(
  candidate: HistoricalCustodyProjectionV1["artifactAttempts"][number],
  result: ArtifactHistoricalReadbackGatewayResultV1,
): ArtifactReviewInventoryItemV1 {
  const projection = result.projection;
  const reviewable = result.status === 200 && projection.availability === "available"
    && projection.outcome !== null;
  return {
    buildRequestIdentity: candidate.buildRequestIdentity,
    attemptIdentity: candidate.attemptIdentity,
    availability: reviewable ? "reviewable" : "unavailable",
    disposition: reviewable ? projection.outcome!.historicalDisposition : null,
    reason: reviewable ? null : projection.reason ?? "OWNER_RESPONSE_UNAVAILABLE",
  };
}

export async function readArtifactReviewInventoryV1({
  readHistorical,
  readArtifact,
  now = Date.now,
}: {
  readHistorical?: HistoricalReaderV1;
  readArtifact?: ArtifactReaderV1;
  now?: () => number;
} = {}): Promise<ArtifactReviewInventoryResultV1> {
  const historical = readHistorical ?? (() => {
    const target = ownerApiTargetForOperationV1(RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION);
    return resolveHistoricalCustodyShadowV1({ baseUrl: target.baseUrl, token: target.token });
  });
  const artifact = readArtifact ?? ((candidate) => readArtifactHistoricalGatewayV1(candidate));
  const source = await historical();
  if (source.status !== 200 || source.envelope.availability !== "available"
    || source.envelope.projection.resolution !== "RETRIEVED") {
    return unavailable("HISTORICAL_CUSTODY_UNAVAILABLE", source.status === 502 ? 502 : 503);
  }
  const custody = source.envelope.projection;
  let outcomes: ArtifactHistoricalReadbackGatewayResultV1[];
  try {
    outcomes = await mapBounded(custody.artifactAttempts, artifact);
  } catch {
    return unavailable("ARTIFACT_REVIEW_READ_UNAVAILABLE", 503);
  }
  const items = outcomes.map((outcome, index) => projectItem(custody.artifactAttempts[index], outcome));
  const reviewableTotal = items.filter((item) => item.availability === "reviewable").length;
  const observedAtEpochMs = now();
  if (!Number.isSafeInteger(observedAtEpochMs) || observedAtEpochMs < 0
    || Number.isNaN(new Date(observedAtEpochMs).getTime())) {
    return unavailable("REVIEW_INVENTORY_CLOCK_INVALID", 503);
  }
  return {
    status: 200,
    projection: {
      availability: "available",
      observedAt: new Date(observedAtEpochMs).toISOString(),
      sourceObservedAt: new Date(custody.observedAtEpochMs!).toISOString(),
      completeness: custody.completeness === "COMPLETE" ? "complete" : "partial",
      candidateTotal: custody.artifactAttemptTotal,
      scannedCandidateCount: items.length,
      reviewableTotal,
      unavailableTotal: items.length - reviewableTotal,
      items,
      reason: null,
    },
  };
}

export function parseArtifactReviewInventoryBrowserProjectionV1(
  value: unknown,
): ArtifactReviewInventoryProjectionV1 | null {
  if (!object(value) || !exactKeys(value, PROJECTION_KEYS)
    || (value.availability !== "available" && value.availability !== "unavailable")
    || !count(value.candidateTotal) || !count(value.scannedCandidateCount)
    || !count(value.reviewableTotal) || !count(value.unavailableTotal)
    || !Array.isArray(value.items)) return null;
  if (value.availability === "unavailable") {
    return value.observedAt === null && value.sourceObservedAt === null
      && value.completeness === null && value.candidateTotal === 0
      && value.scannedCandidateCount === 0 && value.reviewableTotal === 0
      && value.unavailableTotal === 0 && value.items.length === 0
      && typeof value.reason === "string"
      ? value as ArtifactReviewInventoryProjectionV1
      : null;
  }
  if (!canonicalTime(value.observedAt) || !canonicalTime(value.sourceObservedAt)
    || (value.completeness !== "complete" && value.completeness !== "partial")
    || value.reason !== null || value.items.length !== value.scannedCandidateCount
    || value.reviewableTotal + value.unavailableTotal !== value.scannedCandidateCount
    || value.candidateTotal < value.scannedCandidateCount
    || (value.completeness === "complete") !== (value.candidateTotal === value.scannedCandidateCount)) {
    return null;
  }
  const identities = new Set<string>();
  for (const item of value.items) {
    if (!object(item) || !exactKeys(item, ITEM_KEYS)
      || !identity(item.buildRequestIdentity) || !identity(item.attemptIdentity)
      || identities.has(`${item.buildRequestIdentity}\u0000${item.attemptIdentity}`)
      || (item.availability !== "reviewable" && item.availability !== "unavailable")) return null;
    identities.add(`${item.buildRequestIdentity}\u0000${item.attemptIdentity}`);
    if (item.availability === "reviewable") {
      if (!(["failed", "rejected", "unknown"] as const).includes(item.disposition as ArtifactHistoricalDispositionV1)
        || item.reason !== null) return null;
    } else if (item.disposition !== null || typeof item.reason !== "string") return null;
  }
  return value as ArtifactReviewInventoryProjectionV1;
}
