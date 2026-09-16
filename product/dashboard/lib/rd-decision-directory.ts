import type {
  RdFormationCatalogFamilyV1,
  RdFormationCatalogProjectionV1,
} from "./rd-formation-catalog-client.ts";
import type {
  RdIterationDecisionV1,
  RdIterationTimelineProjectionV1,
  RdIterationTimelineStateV1,
} from "./rd-iteration-timeline-client.ts";

export type RdDecisionDirectoryItemV1 = Readonly<{
  key: string;
  family: RdFormationCatalogFamilyV1;
  timelineState: RdIterationTimelineStateV1;
  decision: RdIterationDecisionV1;
}>;

export type RdDecisionDirectoryV1 = Readonly<{
  completeness: RdFormationCatalogProjectionV1["completeness"];
  sourceObservedAtEpochMs: number;
  observedAtEpochMs: number;
  familyCount: number;
  items: readonly RdDecisionDirectoryItemV1[];
}>;

export function projectRdDecisionDirectoryV1(
  catalog: RdFormationCatalogProjectionV1,
  timelines: readonly RdIterationTimelineProjectionV1[],
): RdDecisionDirectoryV1 | null {
  if (catalog.resolution !== "RETRIEVED" || catalog.observedAtEpochMs === null
    || timelines.length !== catalog.families.length) return null;

  const timelinesByFamily = new Map(
    timelines.map((timeline) => [timeline.trialFamilyIdentity, timeline]),
  );
  if (timelinesByFamily.size !== timelines.length) return null;

  const unique = new Set<string>();
  const items: RdDecisionDirectoryItemV1[] = [];
  let observedAtEpochMs = catalog.observedAtEpochMs;
  for (const family of catalog.families) {
    const timeline = timelinesByFamily.get(family.trialFamilyIdentity);
    if (!timeline || timeline.trialBudget !== family.research.trialBudget
      || timeline.consumedTrialBudget !== family.research.consumedTrialBudget) return null;
    observedAtEpochMs = Math.max(observedAtEpochMs, timeline.observedAtEpochMs);
    for (const decision of timeline.decisions) {
      const identities = [
        decision.decisionIdentity,
        decision.decisionDigest,
        decision.resultIdentity,
        decision.attemptIdentity,
        decision.receiptIdentity,
      ];
      if (identities.some((identity) => unique.has(identity))) return null;
      identities.forEach((identity) => unique.add(identity));
      items.push({ key: decision.decisionIdentity, family, timelineState: timeline.state, decision });
    }
  }

  items.sort((left, right) => right.decision.committedAtEpochMs
    - left.decision.committedAtEpochMs
    || (left.decision.decisionIdentity < right.decision.decisionIdentity ? -1
      : left.decision.decisionIdentity > right.decision.decisionIdentity ? 1 : 0));
  return {
    completeness: catalog.completeness,
    sourceObservedAtEpochMs: catalog.observedAtEpochMs,
    observedAtEpochMs,
    familyCount: catalog.families.length,
    items,
  };
}
