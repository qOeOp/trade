import {
  REPLAY_OHLCV_RESOLUTION_EVIDENCE_SCHEMA_VERSION,
  assertReplayOhlcvResolutionEvidence,
  canonicalHash,
  replayOhlcvResolutionEvidenceHash,
  type ReplayMarketBar,
  type ReplayOhlcvPathId,
  type ReplayOhlcvResolutionEvidence,
  type ReplayOhlcvResolutionPath,
  type ReplaySourceEvent,
} from "../../../contracts/src/lib/replay-contracts"

export function createReplaySimpleBracketOhlcvResolution(input: {
  run_id: string
  source_event: ReplaySourceEvent
  bar: ReplayMarketBar
  position_side: "long" | "short"
  active_stop_price: number
  active_target_price: number
  observation_kind: "bar_open_gap" | "bar_range_touch"
  stop_touched: boolean
  target_touched: boolean
  canonical_terminal_role: "stop" | "target"
}): ReplayOhlcvResolutionEvidence {
  if (!input.stop_touched && !input.target_touched) {
    throw new Error("Replay OHLCV resolution requires at least one terminal touch")
  }
  const collision = input.stop_touched && input.target_touched
  if (collision && input.observation_kind !== "bar_range_touch") {
    throw new Error("Replay OHLCV open gap cannot ambiguously cross both sides of a valid bracket")
  }
  const equivalentRole = input.stop_touched ? "stop" as const : "target" as const
  const roleFor = (pathId: ReplayOhlcvPathId): "stop" | "target" => {
    if (!collision) return equivalentRole
    if (pathId === "open_high_low_close") return input.position_side === "long" ? "target" : "stop"
    return input.position_side === "long" ? "stop" : "target"
  }
  const triggerFor = (role: "stop" | "target"): number => input.observation_kind === "bar_open_gap"
    ? input.bar.open
    : role === "stop" ? input.active_stop_price : input.active_target_price
  const pathFor = (pathId: ReplayOhlcvPathId): ReplayOhlcvResolutionPath => {
    const firstTerminalRole = roleFor(pathId)
    const body = {
      path_id: pathId,
      first_terminal_role: firstTerminalRole,
      trigger_price: triggerFor(firstTerminalRole),
    }
    return { ...body, path_digest: canonicalHash(body) }
  }
  const paths = [pathFor("open_high_low_close"), pathFor("open_low_high_close")] as const
  const status = collision ? "resolution_limited" as const : "exact_under_ohlc" as const
  const canonicalPath = collision
    ? paths.find((path) => path.first_terminal_role === input.canonical_terminal_role)!
    : paths[0]
  const body = {
    schema_version: REPLAY_OHLCV_RESOLUTION_EVIDENCE_SCHEMA_VERSION,
    resolution_id: `${input.run_id}:ohlcv-resolution:${input.source_event.source_event_id}`,
    source_event_id: input.source_event.source_event_id,
    source_event_key: structuredClone(input.source_event.event_key),
    bar_index: input.source_event.source_index,
    bar: {
      open_time: input.bar.open_time, close_time: input.bar.close_time,
      open: input.bar.open, high: input.bar.high, low: input.bar.low, close: input.bar.close,
    },
    position_side: input.position_side,
    active_stop_price: input.active_stop_price,
    active_target_price: input.active_target_price,
    observation_kind: input.observation_kind,
    status,
    resolution_reason: input.observation_kind === "bar_open_gap"
      ? "open_gap_observed" as const
      : collision ? "stop_target_order_ambiguous" as const : "single_terminal_touch" as const,
    paths: [...paths] as [ReplayOhlcvResolutionPath, ReplayOhlcvResolutionPath],
    canonical: {
      path_id: canonicalPath.path_id,
      terminal_role: input.canonical_terminal_role,
      selection_policy: collision
        ? "lower_terminal_equity_then_realized_pnl_then_path_id" as const
        : "equivalent_paths_stable_id" as const,
    },
  }
  const evidence = { ...body, evidence_hash: replayOhlcvResolutionEvidenceHash(body) }
  assertReplayOhlcvResolutionEvidence(evidence)
  return evidence
}
