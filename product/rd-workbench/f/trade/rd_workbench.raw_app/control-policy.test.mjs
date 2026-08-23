import assert from "node:assert/strict"
import test from "node:test"

import {
  actionControls,
  artifactActionControls,
  artifactAvailableAt,
  artifactBoundToS1Context,
  artifactInvocationAdmission,
  freezeS1ContextForOwnedAttempt,
  researchAvailableAt,
  resolveCurrentResearchThenRunArtifact,
} from "./control-policy.mjs"

const researchProjection = {
  schema_version: 1,
  operation: "research_goal.consumer_projection.v1",
  owner_operation: "research_goal.submit_or_resolve.v2",
  owner_schema: "sourced-research-goal-v2",
}
const artifactProjection = {
  schema_version: 1,
  operation: "artifact_build.consumer_projection.v1",
  owner_operation: "artifact_build.submit_or_resolve.v1",
  owner_schema: "rd-artifact-build-request-v1",
}

test("only an unsubmitted request can be submitted", () => {
  assert.deepEqual(actionControls(null, "request-1"), {
    canSubmit: true, canResolve: false, canCreateSuccessor: false,
  })
})

test("consumer clock can only downgrade expired Owner availability", () => {
  const context = {
    request_identity: "request-1",
    intent_identity: "intent-1",
    intent_semantic_digest: "sha256:semantic",
    trial_family_identity: "family-1",
    trial_family_root_digest: "sha256:root-1",
    census_frontier_identity: "frontier-1",
    census_frontier_digest: "sha256:frontier-1",
    valid_through_epoch_ms: 200,
  }
  const research = {
    request_identity: "request-1",
    research_view: { availability: "AVAILABLE", intent_identity: "intent-1" },
  }
  const artifact = {
    owner_receipt: {
      intent_identity: "intent-1",
      intent_semantic_digest: "sha256:semantic",
    },
    artifact_review: {
      intent_identity: "intent-1",
      intent_semantic_digest: "sha256:semantic",
    },
    research_view: {
      availability: "AVAILABLE",
      request_identity: "request-1",
      intent_identity: "intent-1",
      valid_through_epoch_ms: 180,
    },
    artifact_trial_family: {
      trial_family: {
        root: { trial_family_identity: "family-1", root_digest: "sha256:root-1" },
        census_frontier: { frontier_identity: "frontier-1", frontier_digest: "sha256:frontier-1" },
      },
      binding: {
        trial_family_identity: "family-1",
        census_frontier_identity: "frontier-1",
        census_frontier_digest: "sha256:frontier-1",
      },
    },
  }
  assert.equal(researchAvailableAt(research, context, 199), true)
  assert.equal(researchAvailableAt(research, context, 200), false)
  assert.equal(artifactAvailableAt(artifact, context, 179), true)
  assert.equal(artifactAvailableAt(artifact, context, 180), false)
  assert.equal(researchAvailableAt(research, { ...context, request_identity: "request-2" }, 100), false)
  assert.equal(researchAvailableAt(research, { ...context, intent_identity: "intent-2" }, 100), false)
  assert.equal(artifactAvailableAt(artifact, { ...context, request_identity: "request-2" }, 100), false)
  assert.equal(artifactAvailableAt(artifact, { ...context, intent_identity: "intent-2" }, 100), false)
  assert.equal(artifactAvailableAt(artifact, { ...context, intent_semantic_digest: "sha256:foreign" }, 100), false)
  assert.equal(artifactAvailableAt({
    ...artifact,
    owner_receipt: { intent_identity: "intent-1", intent_semantic_digest: "sha256:foreign" },
    artifact_review: { intent_identity: "intent-1", intent_semantic_digest: "sha256:foreign" },
  }, context, 100), false)
  assert.equal(artifactAvailableAt(artifact, { ...context, trial_family_identity: "family-2" }, 100), false)
  assert.equal(artifactAvailableAt(artifact, { ...context, trial_family_root_digest: "sha256:root-2" }, 100), false)
  assert.equal(artifactAvailableAt(artifact, { ...context, census_frontier_identity: "frontier-2" }, 100), false)
  assert.equal(artifactAvailableAt(artifact, { ...context, census_frontier_digest: "sha256:frontier-2" }, 100), false)
  assert.equal(artifactBoundToS1Context(artifact, { ...context, trial_family_identity: "family-2" }), false)
})

test("projected unknown permits only same-identity resolution", () => {
  assert.deepEqual(actionControls({
    consumer_projection: researchProjection,
    request_identity: "request-1",
    resolution: "SUBMITTED_OR_UNKNOWN",
    next_legal_action: "RESOLVE_SAME_REQUEST_IDENTITY",
  }, "request-1"), {
    canSubmit: false, canResolve: true, canCreateSuccessor: false,
  })
})

test("only a complete receipt-backed rejection permits a successor", () => {
  const rejection = {
    consumer_projection: researchProjection,
    request_identity: "request-1",
    resolution: "REJECTED_NO_WRITE",
    next_legal_action: "CORRECT_INPUT_AND_CREATE_SUCCESSOR_REQUEST",
    owner_receipt: { request_identity: "request-1", disposition: "REJECTED_NO_WRITE" },
  }
  assert.equal(actionControls(rejection, "request-1").canCreateSuccessor, true)
  for (const forged of [
    { ...rejection, owner_receipt: null },
    { ...rejection, request_identity: "request-2" },
    { ...rejection, consumer_projection: { ...researchProjection, operation: "wrong" } },
    { ...rejection, consumer_projection: { ...researchProjection, extra: true } },
  ]) assert.equal(actionControls(forged, "request-1").canCreateSuccessor, false)
})

test("invocation-started projection exposes no automatic App mutation", () => {
  const started = {
    consumer_projection: artifactProjection,
    build_request_identity: "build-1",
    attempt_identity: "attempt-1",
    resolution: "SUBMITTED_OR_UNKNOWN",
    next_legal_action: "MANUALLY_RECONCILE_PROVIDER_INVOCATION",
    provider_invocation: {
      schema_version: 1,
      request_identity: "build-1",
      admission_identity: "admission-1",
      attempt_identity: "attempt-1",
      claim_identity: "claim-1",
      claim_digest: "sha256:claim",
      state_digest: "sha256:started",
      committed_at_epoch_ms: 10,
      disposition: "ALREADY_CLAIMED",
      state: "INVOCATION_STARTED",
      next_legal_action: "MANUALLY_RECONCILE_PROVIDER_INVOCATION",
    },
  }
  assert.deepEqual(artifactActionControls(started, "build-1", "attempt-1"), {
    canRun: false, canResolve: false, canCreateSuccessor: false,
  })
})

test("minimal raw Owner JSON exposes no action", () => {
  assert.deepEqual(actionControls({
    request_identity: "request-1",
    resolution: "REJECTED_NO_WRITE",
    next_legal_action: "CORRECT_INPUT_AND_CREATE_SUCCESSOR_REQUEST",
  }, "request-1"), {
    canSubmit: false, canResolve: false, canCreateSuccessor: false,
  })
})

test("artifact controls require the exact projected attempt and claim", () => {
  assert.deepEqual(artifactActionControls(null, "build-1", "attempt-1"), {
    canRun: true, canResolve: false, canCreateSuccessor: false,
  })
  const resumable = {
    consumer_projection: artifactProjection,
    build_request_identity: "build-1",
    attempt_identity: "attempt-1",
    resolution: "SUBMITTED_OR_UNKNOWN",
    next_legal_action: "RUN_BOUNDED_EXECUTION_AGENT",
    provider_invocation: {
      schema_version: 1,
      request_identity: "build-1",
      admission_identity: "admission-1",
      state: "CLAIMED",
      disposition: "ALREADY_CLAIMED",
      next_legal_action: "RUN_BOUNDED_EXECUTION_AGENT",
      claim_identity: "claim-1",
      claim_digest: "sha256:claim",
      state_digest: "sha256:state",
      attempt_identity: "attempt-1",
    },
  }
  assert.equal(artifactActionControls(resumable, "build-1", "attempt-1").canRun, true)
  for (const forged of [
    { ...resumable, consumer_projection: null },
    { ...resumable, attempt_identity: "attempt-2" },
    { ...resumable, provider_invocation: { ...resumable.provider_invocation, claim_digest: "" } },
    { ...resumable, provider_invocation: { ...resumable.provider_invocation, request_identity: "build-2" } },
  ]) assert.equal(artifactActionControls(forged, "build-1", "attempt-1").canRun, false)
})

test("artifact successor requires a terminal Owner receipt", () => {
  const context = {
    request_identity: "request-1",
    intent_identity: "intent-1",
    intent_semantic_digest: "sha256:semantic",
    trial_family_identity: "family-1",
    trial_family_root_digest: "sha256:root-1",
    census_frontier_identity: "frontier-1",
    census_frontier_digest: "sha256:frontier-1",
    valid_through_epoch_ms: 200,
  }
  const terminal = {
    consumer_projection: artifactProjection,
    build_request_identity: "build-1",
    attempt_identity: "attempt-1",
    resolution: "FAILED_NO_ARTIFACT",
    next_legal_action: "CREATE_SUCCESSOR_BUILD_REQUEST",
    research_view: {
      availability: "AVAILABLE",
      request_identity: "request-1",
      intent_identity: "intent-1",
      valid_through_epoch_ms: 180,
    },
    owner_receipt: {
      build_request_identity: "build-1",
      attempt_identity: "attempt-1",
      intent_identity: "intent-1",
      intent_semantic_digest: "sha256:semantic",
      disposition: "FAILED_NO_ARTIFACT",
    },
  }
  assert.equal(artifactActionControls(terminal, "build-1", "attempt-1", context, 100).canCreateSuccessor, true)
  assert.equal(artifactActionControls(
    terminal, "build-1", "attempt-1", { ...context, valid_through_epoch_ms: 50 }, 100,
  ).canCreateSuccessor, false)
  assert.equal(artifactActionControls({ ...terminal, owner_receipt: {
    ...terminal.owner_receipt, intent_semantic_digest: "sha256:foreign",
  } }, "build-1", "attempt-1", context, 100).canCreateSuccessor, false)
  assert.equal(artifactActionControls(
    { ...terminal, owner_receipt: null }, "build-1", "attempt-1", context, 100,
  ).canCreateSuccessor, false)
})

test("RUN resolves current Owner view before calling artifact backend", async () => {
  const events = []
  const accepted = {
    request_identity: "request-1",
    resolution: "ACCEPTED",
    owner_receipt: {
      request_identity: "request-1",
      resulting_research_intent_identity: "intent-1",
    },
    research_view: {
      request_identity: "request-1",
      intent_identity: "intent-1",
      availability: "AVAILABLE",
      phase: "INTENT_FROZEN",
    },
  }
  const result = await resolveCurrentResearchThenRunArtifact({
    requestIdentity: "request-1",
    intentIdentity: "intent-1",
    resolveResearch: async () => { events.push("RESOLVE"); return accepted },
    projectResearch: (value) => value,
    runArtifact: async () => { events.push("RUN"); return { ok: true } },
  })
  assert.deepEqual(events, ["RESOLVE", "RUN"])
  assert.deepEqual(result.artifact, { ok: true })
  assert.equal(result.artifactBackendStarted, true)
  assert.equal(result.error, null)
})

test("stale or unknown Owner view blocks artifact backend without a browser clock", async () => {
  for (const research of [
    {
      request_identity: "request-1",
      resolution: "ACCEPTED",
      owner_receipt: { request_identity: "request-1", resulting_research_intent_identity: "intent-1" },
      research_view: { request_identity: "request-1", intent_identity: "intent-1", availability: "STALE", phase: "INTENT_FROZEN" },
    },
    { request_identity: "request-1", resolution: "SUBMITTED_OR_UNKNOWN" },
  ]) {
    let artifactCalls = 0
    const result = await resolveCurrentResearchThenRunArtifact({
      requestIdentity: "request-1",
      intentIdentity: "intent-1",
      resolveResearch: async () => research,
      projectResearch: (value) => value,
      runArtifact: async () => { artifactCalls += 1 },
    })
    assert.equal(result.artifact, null)
    assert.equal(result.artifactBackendStarted, false)
    assert.equal(result.error, null)
    assert.equal(artifactCalls, 0)
  }
})

test("stale S1 does not strand an exact durable provider claim", async () => {
  const stale = {
    request_identity: "request-1",
    resolution: "ACCEPTED",
    owner_receipt: { request_identity: "request-1", resulting_research_intent_identity: "intent-1" },
    research_view: {
      request_identity: "request-1",
      intent_identity: "intent-1",
      availability: "STALE",
      phase: "INTENT_FROZEN",
    },
  }
  const claimed = {
    consumer_projection: artifactProjection,
    build_request_identity: "build-1",
    attempt_identity: "attempt-1",
    resolution: "SUBMITTED_OR_UNKNOWN",
    next_legal_action: "RUN_BOUNDED_EXECUTION_AGENT",
    provider_invocation: {
      state: "CLAIMED",
      next_legal_action: "RUN_BOUNDED_EXECUTION_AGENT",
      request_identity: "build-1",
      attempt_identity: "attempt-1",
      claim_identity: "claim-1",
      claim_digest: "sha256:claim",
      state_digest: "sha256:state",
    },
  }
  let artifactCalls = 0
  let researchCalls = 0
  const result = await resolveCurrentResearchThenRunArtifact({
    requestIdentity: "request-1",
    intentIdentity: "intent-1",
    artifactResult: claimed,
    buildRequestIdentity: "build-1",
    attemptIdentity: "attempt-1",
    resolveResearch: async () => { researchCalls += 1; return stale },
    projectResearch: (value) => value,
    runArtifact: async () => { artifactCalls += 1; return { recovered: true } },
  })
  assert.deepEqual(result.artifact, { recovered: true })
  assert.equal(result.artifactBackendStarted, true)
  assert.equal(artifactCalls, 1)
  assert.equal(researchCalls, 0)
})

test("unavailable Research is not consulted while resuming an exact durable provider claim", async () => {
  const claimed = {
    consumer_projection: artifactProjection,
    build_request_identity: "build-1",
    attempt_identity: "attempt-1",
    resolution: "SUBMITTED_OR_UNKNOWN",
    next_legal_action: "RUN_BOUNDED_EXECUTION_AGENT",
    provider_invocation: {
      state: "CLAIMED",
      next_legal_action: "RUN_BOUNDED_EXECUTION_AGENT",
      request_identity: "build-1",
      attempt_identity: "attempt-1",
      claim_identity: "claim-1",
      claim_digest: "sha256:claim",
      state_digest: "sha256:state",
    },
  }
  let researchCalls = 0
  let artifactCalls = 0
  const result = await resolveCurrentResearchThenRunArtifact({
    requestIdentity: "request-1",
    intentIdentity: "intent-1",
    artifactResult: claimed,
    buildRequestIdentity: "build-1",
    attemptIdentity: "attempt-1",
    resolveResearch: async () => { researchCalls += 1; throw new Error("unavailable") },
    projectResearch: (value) => value,
    runArtifact: async () => { artifactCalls += 1; return { recovered: true } },
  })
  assert.deepEqual(result.artifact, { recovered: true })
  assert.equal(result.artifactBackendStarted, true)
  assert.equal(result.error, null)
  assert.equal(researchCalls, 0)
  assert.equal(artifactCalls, 1)
})

test("App composition admits only the exact claimed attempt with its frozen S1 context", () => {
  const frozen = {
    schema_version: 1,
    request_identity: "request-1",
    intent_identity: "intent-1",
    intent_semantic_digest: "sha256:semantic",
    trial_family_identity: "family-1",
    trial_family_root_digest: "sha256:root",
    census_frontier_identity: "frontier-1",
    census_frontier_digest: "sha256:frontier",
    valid_through_epoch_ms: 200,
  }
  const claimed = {
    consumer_projection: artifactProjection,
    build_request_identity: "build-1",
    attempt_identity: "attempt-1",
    resolution: "SUBMITTED_OR_UNKNOWN",
    next_legal_action: "RUN_BOUNDED_EXECUTION_AGENT",
    provider_invocation: {
      state: "CLAIMED",
      next_legal_action: "RUN_BOUNDED_EXECUTION_AGENT",
      request_identity: "build-1",
      attempt_identity: "attempt-1",
      claim_identity: "claim-1",
      claim_digest: "sha256:claim",
      state_digest: "sha256:state",
    },
  }
  for (const [freshIdentityGenerated, expected] of [[true, true], [false, false]]) {
    assert.equal(artifactInvocationAdmission({
      action: "RUN",
      artifactResult: null,
      buildRequestIdentity: "build-1",
      attemptIdentity: "attempt-1",
      liveS1Context: frozen,
      frozenS1Context: null,
      researchViewAvailable: true,
      freshIdentityGenerated,
      canResolveImportedArtifact: !freshIdentityGenerated,
      nowEpochMs: 100,
    }).canInvoke, expected)
  }
  const admitted = artifactInvocationAdmission({
    action: "RUN",
    artifactResult: claimed,
    buildRequestIdentity: "build-1",
    attemptIdentity: "attempt-1",
    liveS1Context: null,
    frozenS1Context: frozen,
    researchViewAvailable: false,
    freshIdentityGenerated: false,
    canResolveImportedArtifact: false,
    nowEpochMs: 300,
  })
  assert.equal(admitted.canInvoke, true)
  assert.equal(admitted.recovery, true)
  assert.equal(admitted.context, frozen)

  const importedResolve = artifactInvocationAdmission({
    action: "RESOLVE",
    artifactResult: null,
    buildRequestIdentity: "build-1",
    attemptIdentity: "attempt-1",
    liveS1Context: null,
    frozenS1Context: null,
    researchViewAvailable: false,
    freshIdentityGenerated: false,
    canResolveImportedArtifact: true,
    nowEpochMs: 300,
  })
  assert.equal(importedResolve.canInvoke, true)
  assert.equal(importedResolve.context, null)

  for (const rejected of [
    { artifactResult: null, frozenS1Context: frozen },
    { artifactResult: { ...claimed, attempt_identity: "attempt-2" }, frozenS1Context: frozen },
  ]) {
    assert.equal(artifactInvocationAdmission({
      action: "RUN",
      artifactResult: rejected.artifactResult,
      buildRequestIdentity: "build-1",
      attemptIdentity: "attempt-1",
      liveS1Context: frozen,
      frozenS1Context: rejected.frozenS1Context,
      researchViewAvailable: false,
      freshIdentityGenerated: false,
      canResolveImportedArtifact: false,
      nowEpochMs: 300,
    }).canInvoke, false)
  }
})

test("imported resolve freezes S1 only after the same sealed attempt is CLAIMED", () => {
  const context = {
    schema_version: 1,
    request_identity: "request-1",
    intent_identity: "intent-1",
    intent_semantic_digest: "sha256:intent",
    trial_family_identity: "family-1",
    trial_family_root_digest: "sha256:root",
    census_frontier_identity: "frontier-1",
    census_frontier_digest: "sha256:frontier",
    valid_through_epoch_ms: 200,
  }
  const claimed = {
    provider_invocation: {
      state: "CLAIMED",
      next_legal_action: "RUN_BOUNDED_EXECUTION_AGENT",
    },
  }
  assert.equal(freezeS1ContextForOwnedAttempt(claimed, context, null), context)
  assert.equal(freezeS1ContextForOwnedAttempt({ provider_invocation: null, owner_receipt: null }, context, null), null)
  const existing = { ...context, intent_identity: "intent-existing" }
  assert.equal(freezeS1ContextForOwnedAttempt(claimed, context, existing), existing)
  assert.equal(freezeS1ContextForOwnedAttempt({ owner_receipt: { receipt_identity: "receipt-1" } }, context, null), context)
  assert.deepEqual(artifactInvocationAdmission({
    action: "RUN",
    artifactResult: {
      consumer_projection: artifactProjection,
      build_request_identity: "build-1",
      attempt_identity: "attempt-1",
      resolution: "SUBMITTED_OR_UNKNOWN",
      next_legal_action: "RUN_BOUNDED_EXECUTION_AGENT",
      provider_invocation: {
        schema_version: 1,
        request_identity: "build-1",
        admission_identity: "admission-1",
        state: "CLAIMED",
        disposition: "ALREADY_CLAIMED",
        next_legal_action: "RUN_BOUNDED_EXECUTION_AGENT",
        claim_identity: "claim-1",
        claim_digest: "sha256:claim",
        state_digest: "sha256:state",
        attempt_identity: "attempt-1",
      },
    },
    buildRequestIdentity: "build-1",
    attemptIdentity: "attempt-1",
    liveS1Context: null,
    frozenS1Context: null,
    researchViewAvailable: false,
    freshIdentityGenerated: false,
    canResolveImportedArtifact: false,
    nowEpochMs: 300,
  }), { canInvoke: true, context: null, recovery: true })
})

test("rejected or timed-out S1 RESOLVE leaves Artifact not submitted and S1 recoverable", async () => {
  for (const failure of [new Error("rejected"), new Error("bounded timeout")]) {
    let artifactCalls = 0
    const result = await resolveCurrentResearchThenRunArtifact({
      requestIdentity: "request-1",
      intentIdentity: "intent-1",
      resolveResearch: async () => { throw failure },
      projectResearch: (value) => value,
      runArtifact: async () => { artifactCalls += 1 },
    })
    const unknownResearch = {
      consumer_projection: researchProjection,
      request_identity: "request-1",
      resolution: "SUBMITTED_OR_UNKNOWN",
      next_legal_action: "RESOLVE_SAME_REQUEST_IDENTITY",
    }
    assert.equal(result.research, null)
    assert.equal(result.artifact, null)
    assert.equal(result.artifactBackendStarted, false)
    assert.equal(result.error, failure)
    assert.equal(artifactCalls, 0)
    assert.deepEqual(actionControls(unknownResearch, "request-1"), {
      canSubmit: false, canResolve: true, canCreateSuccessor: false,
    })
    assert.deepEqual(artifactActionControls(null, "build-1", "attempt-1"), {
      canRun: true, canResolve: false, canCreateSuccessor: false,
    })
  }
})

test("artifact failure after backend start preserves same-attempt unknown custody", async () => {
  const accepted = {
    request_identity: "request-1",
    resolution: "ACCEPTED",
    owner_receipt: { request_identity: "request-1", resulting_research_intent_identity: "intent-1" },
    research_view: { request_identity: "request-1", intent_identity: "intent-1", availability: "AVAILABLE", phase: "INTENT_FROZEN" },
  }
  const failure = new Error("artifact response lost")
  const result = await resolveCurrentResearchThenRunArtifact({
    requestIdentity: "request-1",
    intentIdentity: "intent-1",
    resolveResearch: async () => accepted,
    projectResearch: (value) => value,
    runArtifact: async () => { throw failure },
  })
  assert.equal(result.research, accepted)
  assert.equal(result.artifact, null)
  assert.equal(result.artifactBackendStarted, true)
  assert.equal(result.error, failure)
})

test("malformed S1 projection blocks artifact backend before submission", async () => {
  let artifactCalls = 0
  const malformed = new Error("malformed Owner projection")
  const result = await resolveCurrentResearchThenRunArtifact({
    requestIdentity: "request-1",
    intentIdentity: "intent-1",
    resolveResearch: async () => ({ forged: true }),
    projectResearch: () => { throw malformed },
    runArtifact: async () => { artifactCalls += 1 },
  })
  assert.equal(result.research, null)
  assert.equal(result.artifact, null)
  assert.equal(result.artifactBackendStarted, false)
  assert.equal(result.error, malformed)
  assert.equal(artifactCalls, 0)
})
