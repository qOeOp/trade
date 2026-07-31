import { canonicalHash } from "./replay-contracts"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
  type ReplayCrossSourceKind,
} from "./replay-cross-source-ordering"
import {
  assertReplaySourceEventAvailabilityCursor,
  assertReplaySourceEventVisibilityTransition,
  replaySourceEventVisibilityCounts,
  type ReplaySourceEventAvailabilityCursor,
  type ReplaySourceEventVisibilityTransition,
} from "./replay-source-event-availability-cursor"

export const REPLAY_SOURCE_EVENT_VISIBILITY_CUT_SCHEMA_VERSION = "trade.rd-replay-source-event-visibility-cut.v1" as const
export const REPLAY_SOURCE_EVENT_VISIBILITY_CUT_POLICY_VERSION = "rd-replay-source-event-visibility-cut-v1" as const

export interface ReplaySourceEventVisibilityCut {
  schema_version: typeof REPLAY_SOURCE_EVENT_VISIBILITY_CUT_SCHEMA_VERSION
  cut_id: string
  cut_policy_version: typeof REPLAY_SOURCE_EVENT_VISIBILITY_CUT_POLICY_VERSION
  scope: "pre_integration_non_economic_visibility_cut"
  view_purpose: "decision_time_visibility_evidence_only"
  payload_view: "identity_lineage_only_no_payload"
  decision_authority: "none"
  economic_authority: "none"
  execution_effects: "forbidden"
  runner_compatibility: "not_bound"
  cursor_id: string
  cursor_hash: string
  trace_id: string
  trace_hash: string
  as_of_time: string
  inclusion_rule: "availability_at_lte_as_of_time"
  cursor_transition_count: number
  visible_prefix_length: number
  visible_transitions: ReplaySourceEventVisibilityTransition[]
  visible_transitions_hash: string
  future_transition_count: number
  future_transition_ids_hash: string
  source_visible_counts: Record<ReplayCrossSourceKind, number>
  last_visible_wire_event_id_by_source: Record<ReplayCrossSourceKind, string>
  delayed_historical_visible_count: number
  latest_visible_at: string | null
  max_effective_time_visible: string | null
  cut_hash: string
}

export type ReplaySourceEventVisibilityCutBody = Omit<ReplaySourceEventVisibilityCut, "cut_hash">

export function createReplaySourceEventVisibilityCut(
  body: ReplaySourceEventVisibilityCutBody,
): ReplaySourceEventVisibilityCut {
  const value: ReplaySourceEventVisibilityCut = {
    ...structuredClone(body),
    cut_hash: canonicalHash(body),
  }
  assertReplaySourceEventVisibilityCut(value)
  return value
}

export function assertReplaySourceEventVisibilityCut(value: ReplaySourceEventVisibilityCut): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_VISIBILITY_CUT_SCHEMA_VERSION
      || value.cut_policy_version !== REPLAY_SOURCE_EVENT_VISIBILITY_CUT_POLICY_VERSION
      || value.scope !== "pre_integration_non_economic_visibility_cut"
      || value.view_purpose !== "decision_time_visibility_evidence_only"
      || value.payload_view !== "identity_lineage_only_no_payload"
      || value.decision_authority !== "none"
      || value.economic_authority !== "none"
      || value.execution_effects !== "forbidden"
      || value.runner_compatibility !== "not_bound"
      || value.inclusion_rule !== "availability_at_lte_as_of_time") {
    throw new Error("unsupported SourceEvent visibility cut authority")
  }
  for (const item of [value.cut_id, value.cursor_id, value.trace_id]) {
    requireText(item, "SourceEvent visibility cut identity")
  }
  for (const [field, item] of Object.entries({
    cursor_hash: value.cursor_hash,
    trace_hash: value.trace_hash,
    visible_transitions_hash: value.visible_transitions_hash,
    future_transition_ids_hash: value.future_transition_ids_hash,
    cut_hash: value.cut_hash,
  })) requireHash(item, `SourceEvent visibility cut ${field}`)
  requireUtc(value.as_of_time, "SourceEvent visibility cut as_of_time")
  for (const [field, count] of Object.entries({
    cursor_transition_count: value.cursor_transition_count,
    visible_prefix_length: value.visible_prefix_length,
    future_transition_count: value.future_transition_count,
    delayed_historical_visible_count: value.delayed_historical_visible_count,
  })) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`SourceEvent visibility cut ${field} is invalid`)
    }
  }
  if (value.visible_prefix_length !== value.visible_transitions.length
      || value.visible_prefix_length + value.future_transition_count !== value.cursor_transition_count) {
    throw new Error("SourceEvent visibility cut cardinality drift")
  }
  const counts = emptySourceCounts()
  const lastIds = emptyLastSourceIds()
  let delayedCount = 0
  let latestVisibleAt: string | null = null
  let maxEffectiveTime: string | null = null
  for (const [index, transition] of value.visible_transitions.entries()) {
    assertReplaySourceEventVisibilityTransition(transition)
    if (transition.visibility_ordinal !== index
        || Date.parse(transition.availability_at) > Date.parse(value.as_of_time)) {
      throw new Error("SourceEvent visibility cut is not a causal cursor prefix")
    }
    counts[transition.source_kind] += 1
    lastIds[transition.source_kind] = transition.wire_event_id
    if (transition.visibility_class === "delayed_historical_fact") delayedCount += 1
    latestVisibleAt = transition.availability_at
    if (maxEffectiveTime === null || Date.parse(transition.effective_time) > Date.parse(maxEffectiveTime)) {
      maxEffectiveTime = transition.effective_time
    }
  }
  if (canonicalHash(counts) !== canonicalHash(value.source_visible_counts)
      || canonicalHash(lastIds) !== canonicalHash(value.last_visible_wire_event_id_by_source)
      || delayedCount !== value.delayed_historical_visible_count
      || latestVisibleAt !== value.latest_visible_at
      || maxEffectiveTime !== value.max_effective_time_visible) {
    throw new Error("SourceEvent visibility cut fold summary drift")
  }
  if (value.visible_transitions_hash !== canonicalHash(value.visible_transitions)) {
    throw new Error("SourceEvent visibility cut visible prefix hash mismatch")
  }
  const { cut_hash: cutHash, ...body } = value
  if (cutHash !== canonicalHash(body)) throw new Error("SourceEvent visibility cut hash mismatch")
}

export function assertReplaySourceEventVisibilityCutCursorBinding(
  cut: ReplaySourceEventVisibilityCut,
  cursor: ReplaySourceEventAvailabilityCursor,
): void {
  assertReplaySourceEventVisibilityCut(cut)
  assertReplaySourceEventAvailabilityCursor(cursor)
  const expectedVisible = cursor.visibility_transitions.filter((transition) =>
    Date.parse(transition.availability_at) <= Date.parse(cut.as_of_time))
  const expectedFuture = cursor.visibility_transitions.slice(expectedVisible.length)
  if (cut.cursor_id !== cursor.cursor_id
      || cut.cursor_hash !== cursor.cursor_hash
      || cut.trace_id !== cursor.trace_id
      || cut.trace_hash !== cursor.trace_hash
      || cut.cursor_transition_count !== cursor.visibility_transitions.length
      || cut.visible_prefix_length !== expectedVisible.length
      || cut.future_transition_count !== expectedFuture.length
      || cut.visible_transitions_hash !== canonicalHash(expectedVisible)
      || cut.future_transition_ids_hash !== canonicalHash(expectedFuture.map((item) => item.transition_id))) {
    throw new Error("SourceEvent visibility cut closed-world cursor lineage drift")
  }
}

export function replaySourceEventVisibilityCutSummary(
  transitions: ReplaySourceEventVisibilityTransition[],
): Pick<ReplaySourceEventVisibilityCut,
  | "source_visible_counts"
  | "last_visible_wire_event_id_by_source"
  | "delayed_historical_visible_count"
  | "latest_visible_at"
  | "max_effective_time_visible"> {
  const lastIds = emptyLastSourceIds()
  let maxEffectiveTime: string | null = null
  for (const transition of transitions) {
    lastIds[transition.source_kind] = transition.wire_event_id
    if (maxEffectiveTime === null || Date.parse(transition.effective_time) > Date.parse(maxEffectiveTime)) {
      maxEffectiveTime = transition.effective_time
    }
  }
  return {
    source_visible_counts: replaySourceEventVisibilityCounts(transitions),
    last_visible_wire_event_id_by_source: lastIds,
    delayed_historical_visible_count: transitions.filter((item) =>
      item.visibility_class === "delayed_historical_fact").length,
    latest_visible_at: transitions.at(-1)?.availability_at ?? null,
    max_effective_time_visible: maxEffectiveTime,
  }
}

function emptySourceCounts(): Record<ReplayCrossSourceKind, number> {
  return { instrument_status: 0, funding: 0, aggregate_trade: 0, ohlcv: 0 }
}

function emptyLastSourceIds(): Record<ReplayCrossSourceKind, string> {
  return { instrument_status: "", funding: "", aggregate_trade: "", ohlcv: "" }
}
