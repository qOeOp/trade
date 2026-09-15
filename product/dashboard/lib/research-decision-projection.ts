import type { HistoricalCustodyProjectionV1 } from "./rd-historical-custody-client.ts";
import {
  researchOutcomeInventoryMatchesCustodyV1,
  type ResearchOutcomeInventoryItemV1,
  type ResearchOutcomeInventoryProjectionV1,
} from "./research-outcome-inventory.ts";

export type ResearchDecisionRowV1 = Readonly<{
  requestIdentity: string;
  decision: "accepted" | "rejected";
  record: "current" | "historical";
  requestRecordedAtEpochMs: number;
  outcome: ResearchOutcomeInventoryItemV1;
}>;

export type ResearchDecisionProjectionV1 = Readonly<{
  availability: "available" | "unavailable";
  reason: string | null;
  acceptedTotal: number;
  rejectedTotal: number;
  decidedTotal: number;
  waitingTotal: number;
  rows: readonly ResearchDecisionRowV1[];
}>;

function unavailable(reason: string): ResearchDecisionProjectionV1 {
  return {
    availability: "unavailable",
    reason,
    acceptedTotal: 0,
    rejectedTotal: 0,
    decidedTotal: 0,
    waitingTotal: 0,
    rows: [],
  };
}

function decision(item: ResearchOutcomeInventoryItemV1): ResearchDecisionRowV1["decision"] | null {
  if (item.status !== "outcome_ready") return null;
  if (item.resolution === "accepted" || item.resolution === "rejected") return item.resolution;
  if (item.historicalDisposition === "accepted" || item.historicalDisposition === "rejected") {
    return item.historicalDisposition;
  }
  return null;
}

export function projectResearchDecisionDirectoryV1(
  inventory: ResearchOutcomeInventoryProjectionV1 | null,
  custody: HistoricalCustodyProjectionV1 | null,
): ResearchDecisionProjectionV1 {
  if (!inventory || inventory.availability !== "available" || !custody
    || custody.resolution !== "RETRIEVED") return unavailable("RESEARCH_DECISION_SOURCE_UNAVAILABLE");
  if (inventory.completeness !== "complete" || custody.completeness !== "COMPLETE"
    || inventory.unavailableTotal !== 0 || inventory.scannedCandidateCount !== inventory.candidateTotal
    || inventory.outcomeReadyTotal + inventory.awaitingOutcomeTotal !== inventory.candidateTotal) {
    return unavailable("RESEARCH_DECISION_CUT_INCOMPLETE");
  }
  if (!researchOutcomeInventoryMatchesCustodyV1(inventory, custody)) {
    return unavailable("RESEARCH_DECISION_IDENTITY_MISMATCH");
  }
  const recordedByRequest = new Map(custody.research.map((candidate) => [
    candidate.requestIdentity,
    candidate.committedAtEpochMs,
  ]));
  const rows: ResearchDecisionRowV1[] = [];
  for (const outcome of inventory.items) {
    if (outcome.status !== "outcome_ready") continue;
    const projectedDecision = decision(outcome);
    const requestRecordedAtEpochMs = recordedByRequest.get(outcome.requestIdentity);
    if (!projectedDecision || requestRecordedAtEpochMs === undefined) {
      return unavailable("RESEARCH_DECISION_ITEM_INVALID");
    }
    rows.push({
      requestIdentity: outcome.requestIdentity,
      decision: projectedDecision,
      record: outcome.resolution === "quarantined" ? "historical" : "current",
      requestRecordedAtEpochMs,
      outcome,
    });
  }
  if (rows.length !== inventory.outcomeReadyTotal) {
    return unavailable("RESEARCH_DECISION_TOTAL_MISMATCH");
  }
  return {
    availability: "available",
    reason: null,
    acceptedTotal: rows.filter((row) => row.decision === "accepted").length,
    rejectedTotal: rows.filter((row) => row.decision === "rejected").length,
    decidedTotal: rows.length,
    waitingTotal: inventory.awaitingOutcomeTotal,
    rows,
  };
}
