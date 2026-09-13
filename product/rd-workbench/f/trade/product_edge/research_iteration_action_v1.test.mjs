import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { pathToFileURL } from "node:url"

const { main } = await import(pathToFileURL(new URL("./research_iteration_action_v1.ts", import.meta.url).pathname))

const sha = (value) => `sha256:${value.repeat(64)}`
const blake = (value) => `blake3:${value.repeat(64)}`
const bytes = (value) => [...new TextEncoder().encode(JSON.stringify(value))]
const replayLocator = (requestIdentity = "replay-request-1") => ({
  request_identity: requestIdentity,
  meaning_digest: sha("a"),
  receipt_identity: `rd-exploratory-replay-receipt-v2-${"7".repeat(64)}`,
  seal_digest: sha("b"),
})

function replayRequest(requestIdentity = "replay-successor-1") {
  const content = (identity, value) => ({ identity, digest: blake(value) })
  const versioned = (identity) => ({ identity, version: "v1" })
  return {
    schema_version: 2,
    request_identity: requestIdentity,
    frozen_research_intent: content("intent-1", "1"),
    trial_family: content("family-1", "2"),
    trial_family_census_frontier: content("frontier-1", "3"),
    replay_authority: { namespace: "EXPLORATORY" },
    strategy_design: content("design-1", "4"),
    strategy_plan: content("plan-1", "5"),
    artifact: content("artifact-1", "6"),
    resolved_owner_inputs: content("owner-inputs-1", "7"),
    pit_scope: content("pit-scope-1", "8"),
    pit_snapshot: content("pit-snapshot-2", "9"),
    universe_selection: content("universe-1", "a"),
    correction_rule: versioned("correction-rule-1"),
    market_semantics: versioned("market-semantics-1"),
    replay_configuration: content("replay-configuration-1", "b"),
    models: {
      runtime_kernel: versioned("runtime-kernel-1"), simulator: versioned("simulator-1"),
      cost: versioned("cost-1"), slippage: versioned("slippage-1"), capacity: versioned("capacity-1"),
    },
    runner_operational_profile: versioned("runner-1"),
    diagnostic_policy: versioned("diagnostic-policy-1"),
    deterministic_seed: 17,
    window: { start_event_ns: 10, end_event_ns_exclusive: 20 },
    calendar: versioned("calendar-1"),
    session: versioned("session-1"),
    time_zone: versioned("UTC"),
    corporate_action_cut: content("corporate-action-cut-1", "c"),
    historical_membership_cut: content("membership-cut-1", "d"),
  }
}

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
}

async function withFetch(sequence, run) {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.RD_OWNER_API_TOKEN
  const calls = []
  process.env.RD_OWNER_API_TOKEN = "test-token"
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) })
    const next = sequence.shift()
    if (next instanceof Error) throw next
    return response(next.value, next.status ?? 200)
  }
  try {
    return await run(calls)
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.RD_OWNER_API_TOKEN
    else process.env.RD_OWNER_API_TOKEN = originalToken
  }
}

function evidenceCut(payload) {
  return {
    decision_policy_identity: "decision-policy-1",
    decision_policy_version: 1,
    decision_policy_digest: Array(32).fill(1),
    decision_policy_binding_digest: Array(32).fill(2),
    trial_family_identity: payload.trial_family_identity,
    census_frontier_identity: "census-frontier-1",
    census_frontier_digest: sha("c"),
    attempt_frontier_identity: "attempt-frontier-1",
    attempt_frontier_digest: sha("d"),
    candidate_set_frontier_identity: "candidate-frontier-1",
    candidate_set_frontier_digest: sha("e"),
    request_identity: payload.request_identity,
    request_digest: payload.request_digest ?? sha("f"),
    result_identity: payload.result_identity,
    result_digest: sha("0"),
    attempt_identity: payload.attempt_identity,
  }
}

test("repair-input Decision RUN is one fixed authenticated Owner call", { concurrency: false }, async () => {
  const payload = {
    trial_family_identity: "family-1", result_identity: "result-1",
    request_identity: "replay-request-1", attempt_identity: "attempt-1",
  }
  const owner = {
    schema_version: 1,
    decision_identity: "decision-1",
    decision_digest: sha("1"),
    evidence_cut: evidenceCut(payload),
    outcome: { outcome: "REPAIR_INPUTS", category: "MARKET_DATA", target: "MARKET_DATA" },
    supported_defects: ["MARKET_DATA"],
    receipt_identity: "decision-receipt-1",
    result_identity: "result-1",
    committed_at_epoch_ms: 23,
  }
  await withFetch([{ value: owner }], async (calls) => {
    const result = await main("RUN", "REPAIR_INPUT_DECISION", payload)
    assert.equal(result.resolution, "OWNER_CONFIRMED")
    assert.equal(result.next_legal_action, "SUBMIT_REPAIR_ACTION")
    assert.deepEqual(result.owner_result, owner)
    assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
      "/v1/iteration-decisions/repair-inputs",
    ])
    assert.deepEqual(calls[0].body, payload)
  })
  await withFetch([{ value: { ...owner, supported_defects: ["MARKET_DATA", "MARKET_DATA"] } }], async () => {
    assert.equal((await main("RUN", "REPAIR_INPUT_DECISION", payload)).resolution, "SUBMITTED_OR_UNKNOWN")
  })
  await withFetch([{ value: {
    ...owner,
    outcome: { outcome: "REPAIR_INPUTS", category: "MARKET_DATA", target: "RUNTIME" },
  } }], async () => {
    assert.equal((await main("RUN", "REPAIR_INPUT_DECISION", payload)).resolution, "SUBMITTED_OR_UNKNOWN")
  })
  await withFetch([{ value: { ...owner, supported_defects: ["ARTIFACT"] } }], async () => {
    assert.equal((await main("RUN", "REPAIR_INPUT_DECISION", payload)).resolution, "SUBMITTED_OR_UNKNOWN")
  })
})

test("repair-action RESOLVE cross-binds the exact recovery locator", { concurrency: false }, async () => {
  const payload = { action_request_identity: "repair-action-1", decision_identity: "decision-1" }
  const owner = {
    schema_version: 1,
    action_request_identity: "repair-action-1",
    action_request_digest: sha("2"),
    decision_identity: "decision-1",
    decision_digest: sha("1"),
    result_identity: "result-1",
    category: "MARKET_DATA",
    target: "MARKET_DATA",
    receipt_identity: "repair-action-receipt-1",
    receipt_digest: sha("3"),
    committed_at_epoch_ms: 24,
  }
  await withFetch([{ value: owner }], async (calls) => {
    const result = await main("RESOLVE", "REPAIR_ACTION", payload)
    assert.equal(result.resolution, "OWNER_CONFIRMED")
    assert.equal(result.next_legal_action, "SUBMIT_NATIVE_REPAIR_REQUEST")
    assert.equal(new URL(calls[0].url).pathname, "/v1/repair-action-requests/resolve")
    assert.deepEqual(calls[0].body, payload)
  })
  await withFetch([{ value: { ...owner, target: "RUNTIME" } }], async () => {
    assert.equal((await main("RESOLVE", "REPAIR_ACTION", payload)).resolution, "SUBMITTED_OR_UNKNOWN")
  })
})

function marketDataPayload() {
  return {
    action_request_identity: "repair-action-1",
    decision_identity: "decision-1",
    result_identity: "result-1",
    attempt_identity: "attempt-1",
    replay: replayLocator(),
    shared_time_head: { head_identity: Array(32).fill(1), head_digest: Array(32).fill(2) },
  }
}

test("Market Data repair RUN validates canonical Owner custody", { concurrency: false }, async () => {
  const payload = marketDataPayload()
  const decisionEvidence = evidenceCut({
    trial_family_identity: "family-1",
    request_identity: payload.replay.request_identity,
    request_digest: payload.replay.meaning_digest,
    result_identity: payload.result_identity,
    attempt_identity: payload.attempt_identity,
  })
  const canonical = {
    schema_version: 1,
    request_identity: "market-data-repair-1",
    request_digest: sha("4"),
    correlation_identity: Array(32).fill(3),
    action_request_identity: payload.action_request_identity,
    action_request_digest: sha("2"),
    decision_identity: payload.decision_identity,
    decision_digest: sha("1"),
    decision_evidence_cut: decisionEvidence,
    replay_request_identity: payload.replay.request_identity,
    replay_request_digest: payload.replay.meaning_digest,
    result_identity: payload.result_identity,
    result_digest: decisionEvidence.result_digest,
    attempt_identity: payload.attempt_identity,
    category: "MARKET_DATA",
    target: "MARKET_DATA",
    bounded_reason: "BACKTEST_DIAGNOSTIC_MARKET_DATA",
    decisive_evidence_component: "PIT_SNAPSHOT",
    decisive_evidence_reference: "evidence-1",
    decisive_evidence_digest: sha("6"),
    original_pit_request_identity: Array(32).fill(4),
    original_pit_request_digest: Array(32).fill(5),
    original_pit_snapshot_identity: Array(32).fill(6),
    original_pit_proof_digest: Array(32).fill(7),
    instrument_scope_identity: "instrument-scope-1",
    instrument_scope_digest: Array(32).fill(8),
    universe_selection_identity: "universe-1",
    universe_selection_digest: Array(32).fill(9),
    instrument_master_digest: Array(32).fill(10),
    provenance_binding_identity: Array(32).fill(11),
    provenance_binding_fact_digest: Array(32).fill(12),
    provenance_lineage_root: Array(32).fill(13),
    provenance_lineage_version: 1,
    source_frontier_digest: Array(32).fill(14),
    correction_frontier_digest: Array(32).fill(15),
    market_semantics_identity: Array(32).fill(16),
    original_time_evidence: {
      event_effective: { value: 10, clock_identity: "clock-1", clock_epoch: "epoch-1" },
      provider_available: { value: 12, clock_identity: "clock-1", clock_epoch: "epoch-1" },
      retrieval: { value: 15, clock_identity: "clock-1", clock_epoch: "epoch-1" },
      correction_publication: { value: 14, clock_identity: "clock-1", clock_epoch: "epoch-1" },
      decision_cut: { value: 18, clock_identity: "clock-1", clock_epoch: "epoch-1" },
      monotonic_sequence: 1,
      restart_continuity_digest: Array(32).fill(18),
      skew_bound: 2,
      uncertainty_bound: 1,
      observed_at: 18,
      valid_through: 30,
    },
    shared_time_evidence: {
      ...payload.shared_time_head,
      clock_identity: "clock-1",
      clock_epoch: "epoch-1",
      monotonic_sequence: 2,
      wall_observed: 20,
      decision_cut: 19,
      valid_through: 30,
      restart_continuity_digest: Array(32).fill(17),
      uncertainty_bound: 1,
      skew_bound: 2,
      comparison_rule: "ExclusiveValidThrough",
    },
  }
  const owner = {
    schema_version: 1,
    request_identity: canonical.request_identity,
    request_digest: sha("4"),
    correlation_identity: Array(32).fill(3),
    action_request_identity: payload.action_request_identity,
    action_request_digest: sha("2"),
    decision_identity: payload.decision_identity,
    decision_digest: sha("1"),
    result_identity: payload.result_identity,
    category: "MARKET_DATA",
    target: "MARKET_DATA",
    receipt_identity: "market-data-repair-receipt-1",
    receipt_digest: sha("5"),
    committed_at_epoch_ms: 25,
    canonical_request_bytes: bytes(canonical),
  }
  await withFetch([{ value: owner }], async (calls) => {
    const result = await main("RUN", "MARKET_DATA_REPAIR", payload)
    assert.equal(result.resolution, "OWNER_CONFIRMED")
    assert.equal(result.next_legal_action, "WAIT_FOR_MARKET_DATA_TERMINAL")
    assert.equal(new URL(calls[0].url).pathname, "/v1/market-data-repair-requests")
  })
  const crossSpliced = {
    ...owner,
    canonical_request_bytes: bytes({ ...canonical, attempt_identity: "other-attempt" }),
  }
  await withFetch([{ value: crossSpliced }], async () => {
    assert.equal((await main("RUN", "MARKET_DATA_REPAIR", payload)).resolution, "SUBMITTED_OR_UNKNOWN")
  })
  const injected = { ...owner, canonical_request_bytes: bytes({ ...canonical, injected: true }) }
  await withFetch([{ value: injected }], async () => {
    assert.equal((await main("RUN", "MARKET_DATA_REPAIR", payload)).resolution, "SUBMITTED_OR_UNKNOWN")
  })
  const malformedTime = {
    ...owner,
    canonical_request_bytes: bytes({
      ...canonical,
      original_time_evidence: { ...canonical.original_time_evidence, observed_at: 17 },
    }),
  }
  await withFetch([{ value: malformedTime }], async () => {
    assert.equal((await main("RUN", "MARKET_DATA_REPAIR", payload)).resolution, "SUBMITTED_OR_UNKNOWN")
  })
  const misorderedCorrection = {
    ...owner,
    canonical_request_bytes: bytes({
      ...canonical,
      original_time_evidence: {
        ...canonical.original_time_evidence,
        correction_publication: {
          ...canonical.original_time_evidence.correction_publication,
          value: 11,
        },
      },
    }),
  }
  await withFetch([{ value: misorderedCorrection }], async () => {
    assert.equal((await main("RUN", "MARKET_DATA_REPAIR", payload)).resolution, "SUBMITTED_OR_UNKNOWN")
  })
  const staleSharedTime = {
    ...owner,
    canonical_request_bytes: bytes({
      ...canonical,
      shared_time_evidence: { ...canonical.shared_time_evidence, valid_through: 20 },
    }),
  }
  await withFetch([{ value: staleSharedTime }], async () => {
    assert.equal((await main("RUN", "MARKET_DATA_REPAIR", payload)).resolution, "SUBMITTED_OR_UNKNOWN")
  })
  const foreignSharedClock = {
    ...owner,
    canonical_request_bytes: bytes({
      ...canonical,
      shared_time_evidence: {
        ...canonical.shared_time_evidence,
        clock_identity: "foreign-clock",
        clock_epoch: "foreign-epoch",
      },
    }),
  }
  await withFetch([{ value: foreignSharedClock }], async () => {
    assert.equal((await main("RUN", "MARKET_DATA_REPAIR", payload)).resolution, "SUBMITTED_OR_UNKNOWN")
  })
  await withFetch([{ value: { ...owner, committed_at_epoch_ms: 30 } }], async () => {
    assert.equal((await main("RUN", "MARKET_DATA_REPAIR", payload)).resolution, "SUBMITTED_OR_UNKNOWN")
  })
  const foreignDecisionReplay = {
    ...owner,
    canonical_request_bytes: bytes({
      ...canonical,
      decision_evidence_cut: {
        ...canonical.decision_evidence_cut,
        request_identity: "unrelated-request",
        request_digest: sha("9"),
      },
    }),
  }
  await withFetch([{ value: foreignDecisionReplay }], async () => {
    assert.equal((await main("RUN", "MARKET_DATA_REPAIR", payload)).resolution, "SUBMITTED_OR_UNKNOWN")
  })
})

test("repaired Replay RUN accepts only the exact Owner successor projection", { concurrency: false }, async () => {
  const payload = {
    predecessor_request_locator: replayLocator(),
    repair_resolution_locator: {
      resolution_identity: "repair-resolution-1", repair_request_identity: "market-data-repair-1",
    },
  }
  const request = replayRequest()
  const locator = {
    request_identity: request.request_identity,
    meaning_digest: sha("6"),
    receipt_identity: `rd-exploratory-replay-receipt-v2-${"8".repeat(64)}`,
    seal_digest: sha("7"),
  }
  const owner = {
    schema_version: 1,
    predecessor_request_locator: payload.predecessor_request_locator,
    repair_resolution_locator: payload.repair_resolution_locator,
    projection: {
      schema_version: 1,
      request_identity: request.request_identity,
      availability: "AVAILABLE",
      next_legal_action: "LOCK_BY_LOCATOR",
    },
    locator,
    canonical_request_bytes: bytes(request),
  }
  await withFetch([{ value: owner }], async (calls) => {
    const result = await main("RUN", "REPAIRED_REPLAY", payload)
    assert.equal(result.resolution, "OWNER_CONFIRMED")
    assert.equal(result.next_legal_action, "EXECUTE_EXPLORATORY_REPLAY")
    assert.equal(
      new URL(calls[0].url).pathname,
      "/v2/exploratory-replay-requests/market-data-repair-successors",
    )
  })
  const predecessorReplay = replayRequest(payload.predecessor_request_locator.request_identity)
  const crossSpliced = {
    ...owner,
    projection: { ...owner.projection, request_identity: predecessorReplay.request_identity },
    locator: {
      ...owner.locator,
      request_identity: predecessorReplay.request_identity,
      meaning_digest: payload.predecessor_request_locator.meaning_digest,
    },
    canonical_request_bytes: bytes(predecessorReplay),
  }
  await withFetch([{ value: crossSpliced }], async () => {
    assert.equal((await main("RUN", "REPAIRED_REPLAY", payload)).resolution, "SUBMITTED_OR_UNKNOWN")
  })
  await withFetch([{ value: {
    ...owner,
    locator: { ...owner.locator, receipt_identity: "malformed" },
  } }], async () => {
    assert.equal((await main("RUN", "REPAIRED_REPLAY", payload)).resolution, "SUBMITTED_OR_UNKNOWN")
  })
  await withFetch([{ value: {
    ...owner,
    repair_resolution_locator: {
      resolution_identity: "unrelated-resolution", repair_request_identity: "unrelated-repair",
    },
  } }], async () => {
    assert.equal((await main("RUN", "REPAIRED_REPLAY", payload)).resolution, "SUBMITTED_OR_UNKNOWN")
  })
})

test("repaired Replay RESOLVE uses only its pre-existing request selector", { concurrency: false }, async () => {
  const request = replayRequest()
  const payload = { request_identity: request.request_identity, meaning_digest: sha("6") }
  const owner = {
    projection: {
      schema_version: 1,
      request_identity: request.request_identity,
      availability: "AVAILABLE",
      next_legal_action: "LOCK_BY_LOCATOR",
    },
    readback: {
      request,
      canonical_request_bytes: bytes(request),
      meaning_digest: payload.meaning_digest,
      receipt: {
        schema_version: 2,
        receipt_identity: `rd-exploratory-replay-receipt-v2-${"8".repeat(64)}`,
        request_identity: request.request_identity,
        meaning_digest: payload.meaning_digest,
        seal_digest: sha("7"),
        committed_at_epoch_ms: 26,
      },
      owner_cut_epoch_ms: 26,
    },
  }
  await withFetch([{ value: owner }], async (calls) => {
    const result = await main("RESOLVE", "REPAIRED_REPLAY", payload)
    assert.equal(result.resolution, "OWNER_CONFIRMED")
    assert.equal(result.owner_result.resolution, "EXPLORATION_ACTIVE")
    assert.equal(
      new URL(calls[0].url).pathname,
      "/v2/exploratory-replay-requests/replay-successor-1/resolve",
    )
    assert.deepEqual(calls[0].body, { meaning_digest: payload.meaning_digest })
  })
})

test("malformed inputs and ambiguous responses never create business success", { concurrency: false }, async () => {
  await withFetch([], async (calls) => {
    const malformed = await main("RUN", "REPAIR_ACTION", {
      decision_identity: "decision-1", result_identity: "result-1", injected: true,
    })
    assert.equal(malformed.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(calls.length, 0)
  })
  await withFetch([new Error("response lost")], async (calls) => {
    const result = await main("RUN", "MARKET_DATA_REPAIR", marketDataPayload())
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(result.owner_result, null)
    assert.equal(result.next_legal_action, "REPLAY_SAME_TYPED_REQUEST")
    assert.equal(calls.length, 1, "transport must never issue a blind retry")
  })
})

test("metadata and implementation expose the same bounded action surface", async () => {
  const [metadata, source, windmillLock] = await Promise.all([
    readFile(new URL("./research_iteration_action_v1.script.yaml", import.meta.url), "utf8"),
    readFile(new URL("./research_iteration_action_v1.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../wmill-lock.yaml", import.meta.url), "utf8"),
  ])
  for (const value of [
    "REPAIR_INPUT_DECISION", "REPAIR_ACTION", "MARKET_DATA_REPAIR", "REPAIRED_REPLAY",
  ]) {
    assert.match(metadata, new RegExp(value))
    assert.match(source, new RegExp(value))
  }
  assert.match(metadata, /additionalProperties: false/)
  assert.match(metadata, /^tag: rd-product-edge$/m)
  const contentHash = createHash("sha256").update("{}").update(source).update(metadata).digest("hex")
  assert.match(windmillLock, new RegExp(`^  f/trade/product_edge/research_iteration_action_v1: ${contentHash}$`, "m"))
  assert.match(source, /const OWNER_URL = "http:\/\/rd-owner-api:8080"/)
  assert.doesNotMatch(source, /qualification|deployment|trade/i)
})
