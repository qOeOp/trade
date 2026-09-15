import { ownerApiTargetForOperationV1 } from "./owner-api-target.ts";
import { RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION } from "./operation-registry.ts";
import {
  resolveHistoricalCustodyShadowV1,
  type HistoricalCustodyProjectionV1,
} from "./rd-historical-custody-client.ts";
import {
  readResearchReadbackGatewayV1,
  type ResearchReadbackGatewayResultV1,
  type ResearchReadbackOutcomeV1,
} from "./research-readback-gateway.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,256}$/u;
const MAX_CONCURRENCY = 6;
const PROJECTION_KEYS = [
  "availability",
  "awaitingOutcomeTotal",
  "candidateTotal",
  "completeness",
  "items",
  "observedAt",
  "outcomeReadyTotal",
  "reason",
  "scannedCandidateCount",
  "sourceObservedAt",
  "unavailableTotal",
] as const;
const ITEM_KEYS = [
  "historicalDisposition",
  "reason",
  "requestIdentity",
  "resolution",
  "status",
] as const;

type HistoricalReadResultV1 = Awaited<ReturnType<typeof resolveHistoricalCustodyShadowV1>>;
type HistoricalReaderV1 = () => Promise<HistoricalReadResultV1>;
type ResearchReaderV1 = (requestIdentity: string) => Promise<ResearchReadbackGatewayResultV1>;

export type ResearchOutcomeInventoryItemV1 = Readonly<{
  requestIdentity: string;
  status: "outcome_ready" | "awaiting_outcome" | "unavailable";
  resolution: ResearchReadbackOutcomeV1["resolution"] | null;
  historicalDisposition: ResearchReadbackOutcomeV1["historicalDisposition"];
  reason: string | null;
}>;

export type ResearchOutcomeInventoryProjectionV1 = Readonly<{
  availability: "available" | "unavailable";
  observedAt: string | null;
  sourceObservedAt: string | null;
  completeness: "complete" | "partial" | null;
  candidateTotal: number;
  scannedCandidateCount: number;
  outcomeReadyTotal: number;
  awaitingOutcomeTotal: number;
  unavailableTotal: number;
  items: readonly ResearchOutcomeInventoryItemV1[];
  reason: string | null;
}>;

export type ResearchOutcomeInventoryResultV1 = Readonly<{
  status: 200 | 502 | 503;
  projection: ResearchOutcomeInventoryProjectionV1;
}>;

export function researchOutcomeInventoryMatchesCustodyV1(
  inventory: ResearchOutcomeInventoryProjectionV1 | null,
  custody: HistoricalCustodyProjectionV1 | null,
): boolean {
  if (!inventory || inventory.availability !== "available" || !custody
    || custody.resolution !== "RETRIEVED"
    || inventory.candidateTotal !== custody.researchTotal
    || inventory.scannedCandidateCount !== custody.research.length
    || inventory.items.length !== custody.research.length) return false;
  const identities = new Set(inventory.items.map((item) => item.requestIdentity));
  return identities.size === inventory.items.length
    && custody.research.every((item) => identities.has(item.requestIdentity));
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

function unavailable(reason: string, status: 502 | 503): ResearchOutcomeInventoryResultV1 {
  return {
    status,
    projection: {
      availability: "unavailable",
      observedAt: null,
      sourceObservedAt: null,
      completeness: null,
      candidateTotal: 0,
      scannedCandidateCount: 0,
      outcomeReadyTotal: 0,
      awaitingOutcomeTotal: 0,
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
  requestIdentity: string,
  result: ResearchReadbackGatewayResultV1,
): ResearchOutcomeInventoryItemV1 {
  const projection = result.projection;
  if (result.status !== 200 || projection.availability !== "available"
    || projection.requestIdentity !== requestIdentity) {
    return {
      requestIdentity,
      status: "unavailable",
      resolution: null,
      historicalDisposition: null,
      reason: projection.reason ?? "OWNER_RESPONSE_UNAVAILABLE",
    };
  }
  if (projection.outcome === null) {
    return {
      requestIdentity,
      status: "awaiting_outcome",
      resolution: null,
      historicalDisposition: null,
      reason: null,
    };
  }
  return {
    requestIdentity,
    status: "outcome_ready",
    resolution: projection.outcome.resolution,
    historicalDisposition: projection.outcome.historicalDisposition,
    reason: null,
  };
}

export async function readResearchOutcomeInventoryV1({
  readHistorical,
  readResearch,
  now = Date.now,
}: {
  readHistorical?: HistoricalReaderV1;
  readResearch?: ResearchReaderV1;
  now?: () => number;
} = {}): Promise<ResearchOutcomeInventoryResultV1> {
  const historical = readHistorical ?? (() => {
    const target = ownerApiTargetForOperationV1(RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION);
    return resolveHistoricalCustodyShadowV1({ baseUrl: target.baseUrl, token: target.token });
  });
  const research = readResearch ?? ((requestIdentity) => readResearchReadbackGatewayV1({ requestIdentity }));
  const source = await historical();
  if (source.status !== 200 || source.envelope.availability !== "available"
    || source.envelope.projection.resolution !== "RETRIEVED") {
    return unavailable("HISTORICAL_CUSTODY_UNAVAILABLE", source.status === 502 ? 502 : 503);
  }
  const custody = source.envelope.projection;
  let outcomes: ResearchReadbackGatewayResultV1[];
  try {
    outcomes = await mapBounded(
      custody.research,
      (candidate) => research(candidate.requestIdentity),
    );
  } catch {
    return unavailable("RESEARCH_OUTCOME_READ_UNAVAILABLE", 503);
  }
  const items = outcomes.map((outcome, index) => (
    projectItem(custody.research[index].requestIdentity, outcome)
  ));
  const outcomeReadyTotal = items.filter((item) => item.status === "outcome_ready").length;
  const awaitingOutcomeTotal = items.filter((item) => item.status === "awaiting_outcome").length;
  const unavailableTotal = items.length - outcomeReadyTotal - awaitingOutcomeTotal;
  const observedAtEpochMs = now();
  if (!Number.isSafeInteger(observedAtEpochMs) || observedAtEpochMs < 0
    || Number.isNaN(new Date(observedAtEpochMs).getTime())) {
    return unavailable("OUTCOME_INVENTORY_CLOCK_INVALID", 503);
  }
  return {
    status: 200,
    projection: {
      availability: "available",
      observedAt: new Date(observedAtEpochMs).toISOString(),
      sourceObservedAt: new Date(custody.observedAtEpochMs!).toISOString(),
      completeness: custody.completeness === "COMPLETE" ? "complete" : "partial",
      candidateTotal: custody.researchTotal,
      scannedCandidateCount: items.length,
      outcomeReadyTotal,
      awaitingOutcomeTotal,
      unavailableTotal,
      items,
      reason: null,
    },
  };
}

export function parseResearchOutcomeInventoryBrowserProjectionV1(
  value: unknown,
): ResearchOutcomeInventoryProjectionV1 | null {
  if (!object(value) || !exactKeys(value, PROJECTION_KEYS)
    || (value.availability !== "available" && value.availability !== "unavailable")
    || !count(value.candidateTotal) || !count(value.scannedCandidateCount)
    || !count(value.outcomeReadyTotal) || !count(value.awaitingOutcomeTotal)
    || !count(value.unavailableTotal) || !Array.isArray(value.items)) return null;
  if (value.availability === "unavailable") {
    return value.observedAt === null && value.sourceObservedAt === null
      && value.completeness === null && value.candidateTotal === 0
      && value.scannedCandidateCount === 0 && value.outcomeReadyTotal === 0
      && value.awaitingOutcomeTotal === 0 && value.unavailableTotal === 0
      && value.items.length === 0 && typeof value.reason === "string"
      ? value as ResearchOutcomeInventoryProjectionV1
      : null;
  }
  if (!canonicalTime(value.observedAt) || !canonicalTime(value.sourceObservedAt)
    || (value.completeness !== "complete" && value.completeness !== "partial")
    || value.reason !== null || value.items.length !== value.scannedCandidateCount
    || value.outcomeReadyTotal + value.awaitingOutcomeTotal + value.unavailableTotal
      !== value.scannedCandidateCount
    || value.candidateTotal < value.scannedCandidateCount
    || (value.completeness === "complete") !== (value.candidateTotal === value.scannedCandidateCount)) {
    return null;
  }
  const identities = new Set<string>();
  for (const item of value.items) {
    if (!object(item) || !exactKeys(item, ITEM_KEYS)
      || !identity(item.requestIdentity) || identities.has(item.requestIdentity)
      || !["outcome_ready", "awaiting_outcome", "unavailable"].includes(String(item.status))) return null;
    identities.add(item.requestIdentity);
    if (item.status === "outcome_ready") {
      if (!["accepted", "rejected", "quarantined"].includes(String(item.resolution))
        || !(item.historicalDisposition === null
          || ["accepted", "rejected"].includes(String(item.historicalDisposition)))
        || item.reason !== null
        || (item.resolution === "quarantined") !== (item.historicalDisposition !== null)) return null;
    } else if (item.resolution !== null || item.historicalDisposition !== null
      || (item.status === "awaiting_outcome" ? item.reason !== null : typeof item.reason !== "string")) return null;
  }
  return value as ResearchOutcomeInventoryProjectionV1;
}
