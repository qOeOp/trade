import { dashboardReadApiTargetV1 } from "./owner-api-target.ts";
import type { HistoricalCustodyProjectionV1 } from "./rd-historical-custody-client.ts";

const MAX_RESPONSE_BYTES = 512 * 1024;
const IDENTITY = /^[A-Za-z0-9._:/-]{16,128}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
type Json = Record<string, unknown>;
type Fetcher = typeof fetch;

export type ResearchQuestionItemV1 = Readonly<{
  requestIdentity: string;
  semanticDigest: string;
  committedAtEpochMs: number;
  availability: "available" | "unavailable";
  unavailableReason: "VERIFIED_QUESTION_UNAVAILABLE" | null;
  question: Readonly<{
    hypothesis: string;
    falsificationQuestion: string;
    expectedObservation: string;
  }> | null;
}>;

export type ResearchQuestionDirectoryV1 = Readonly<{
  observedAtEpochMs: number;
  total: number;
  items: readonly ResearchQuestionItemV1[];
}>;

function object(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Json, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}
function epoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function boundedText(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 2_000;
}

export function parseResearchQuestionOwnerReadbackV1(value: unknown): ResearchQuestionDirectoryV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "observed_at_epoch_ms", "total", "items",
  ]) || value.schema_version !== 1 || value.operation !== "rd.research_question_directory.read.v1"
    || !epoch(value.observed_at_epoch_ms) || !epoch(value.total) || Number(value.total) > 200
    || !Array.isArray(value.items) || value.items.length !== value.total) return null;
  const items: ResearchQuestionItemV1[] = [];
  const identities = new Set<string>();
  for (const candidate of value.items) {
    if (!object(candidate) || !exactKeys(candidate, [
      "request_identity", "semantic_digest", "committed_at_epoch_ms", "availability",
      "unavailable_reason", "question",
    ]) || typeof candidate.request_identity !== "string" || !IDENTITY.test(candidate.request_identity)
      || typeof candidate.semantic_digest !== "string" || !DIGEST.test(candidate.semantic_digest)
      || !epoch(candidate.committed_at_epoch_ms) || candidate.committed_at_epoch_ms > value.observed_at_epoch_ms
      || identities.has(candidate.request_identity)) return null;
    identities.add(candidate.request_identity);
    if (candidate.availability === "AVAILABLE") {
      if (candidate.unavailable_reason !== null || !object(candidate.question)
        || !exactKeys(candidate.question, ["hypothesis", "falsification_question", "expected_observation"])
        || !boundedText(candidate.question.hypothesis)
        || !boundedText(candidate.question.falsification_question)
        || !boundedText(candidate.question.expected_observation)) return null;
      items.push({
        requestIdentity: candidate.request_identity,
        semanticDigest: candidate.semantic_digest,
        committedAtEpochMs: candidate.committed_at_epoch_ms,
        availability: "available",
        unavailableReason: null,
        question: {
          hypothesis: candidate.question.hypothesis,
          falsificationQuestion: candidate.question.falsification_question,
          expectedObservation: candidate.question.expected_observation,
        },
      });
    } else if (candidate.availability === "UNAVAILABLE"
      && candidate.unavailable_reason === "VERIFIED_QUESTION_UNAVAILABLE" && candidate.question === null) {
      items.push({ requestIdentity: candidate.request_identity, semanticDigest: candidate.semantic_digest,
        committedAtEpochMs: candidate.committed_at_epoch_ms, availability: "unavailable",
        unavailableReason: "VERIFIED_QUESTION_UNAVAILABLE", question: null });
    } else return null;
  }
  return { observedAtEpochMs: value.observed_at_epoch_ms, total: value.total, items };
}

export function researchQuestionsMatchCustodyV1(
  questions: ResearchQuestionDirectoryV1 | null,
  custody: HistoricalCustodyProjectionV1 | null,
): boolean {
  if (!questions || !custody || custody.completeness !== "COMPLETE"
    || questions.total !== custody.researchTotal || questions.items.length !== custody.research.length) return false;
  const questionTimes = new Map(questions.items.map((item) => [item.requestIdentity, item.committedAtEpochMs]));
  return custody.research.every((item) => questionTimes.get(item.requestIdentity) === item.committedAtEpochMs);
}

export async function readResearchQuestionDirectoryV1({ fetcher = fetch }: { fetcher?: Fetcher } = {}) {
  const target = dashboardReadApiTargetV1();
  if (!target.baseUrl || !target.token) return { status: 503 as const, projection: null };
  try {
    const endpoint = new URL("/v1/research-goals/question-directory", target.baseUrl);
    const response = await fetcher(endpoint, { method: "GET", headers: { authorization: `Bearer ${target.token}` },
      cache: "no-store", signal: AbortSignal.timeout(8_000) });
    const body = await response.text();
    if (!response.ok || new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
      return { status: 502 as const, projection: null };
    }
    const projection = parseResearchQuestionOwnerReadbackV1(JSON.parse(body));
    return projection ? { status: 200 as const, projection } : { status: 502 as const, projection: null };
  } catch {
    return { status: 503 as const, projection: null };
  }
}

export function parseResearchQuestionBrowserProjectionV1(value: unknown): ResearchQuestionDirectoryV1 | null {
  if (!object(value) || !exactKeys(value, ["observedAtEpochMs", "total", "items"]) || !Array.isArray(value.items)) return null;
  const owner = { schema_version: 1, operation: "rd.research_question_directory.read.v1",
    observed_at_epoch_ms: value.observedAtEpochMs, total: value.total,
    items: value.items.map((item) => object(item) ? {
      request_identity: item.requestIdentity, semantic_digest: item.semanticDigest,
      committed_at_epoch_ms: item.committedAtEpochMs,
      availability: item.availability === "available" ? "AVAILABLE" : item.availability === "unavailable" ? "UNAVAILABLE" : item.availability,
      unavailable_reason: item.unavailableReason,
      question: object(item.question) ? { hypothesis: item.question.hypothesis,
        falsification_question: item.question.falsificationQuestion,
        expected_observation: item.question.expectedObservation } : item.question,
    } : item),
  };
  return parseResearchQuestionOwnerReadbackV1(owner);
}
