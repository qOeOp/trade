import type { RunListOperationIdV1 } from "./run-list-contract.ts";

const runOperationLabels = {
  "research_goal.legacy_quarantine_read.v1": "Legacy research history",
  "research_goal.shadow_resolve.v1": "Research outcome",
  "artifact_build.shadow_resolve.v1": "Artifact outcome",
  "source_intake.shadow_read.v1": "Source intake",
  "rd_formation_catalog.shadow_read.v1": "Formation catalog",
  "rd_historical_custody.shadow_read.v1": "Historical research requests",
  "rd_iteration_timeline.shadow_read.v1": "Research iterations",
  "exploratory_replay.shadow_read.v2": "Replay request",
  "exploratory_replay_result.shadow_read.v2": "Replay result",
  "develop_composer.shadow_read.v2": "Strategy composition",
  "artifact_build.formation_execute.v1": "Build strategy artifact",
  "develop_composer.submit_or_resolve.v2": "Compose strategy",
  "exploratory_replay.submit_or_resolve.v2": "Run exploratory replay",
  "source_intake.research.submit_or_resolve.v1": "Research source",
} satisfies Record<RunListOperationIdV1, string>;

export function runOperationLabel(operationId: RunListOperationIdV1) {
  return runOperationLabels[operationId];
}
