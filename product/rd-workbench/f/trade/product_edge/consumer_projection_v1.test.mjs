import assert from "node:assert/strict"
import test from "node:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

import { actionControls, artifactActionControls } from "../rd_workbench.raw_app/control-policy.mjs"

const projectionModule = await import(pathToFileURL(new URL("./consumer_projection_v1.ts", import.meta.url).pathname))
const {
  deriveResearchConsumerProjectionV1,
  verifyResearchConsumerProjectionV1,
  deriveVerifiedArtifactS1ContextV1,
  deriveVerifiedS1ConsumerContextV1,
} = projectionModule
const { main: artifactMain } = await import(
  pathToFileURL(new URL("./artifact_build_v1.ts", import.meta.url).pathname)
)

const researchStamp = {
  schema_version: 1,
  operation: "research_goal.consumer_projection.v1",
  owner_operation: "research_goal.submit_or_resolve.v2",
  owner_schema: "sourced-research-goal-v2",
}
const artifactStamp = {
  schema_version: 1,
  operation: "artifact_build.consumer_projection.v1",
  owner_operation: "artifact_build.submit_or_resolve.v1",
  owner_schema: "rd-artifact-build-request-v1",
}
const intentDigest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const intentIdentity = "rd-research-intent-v2-d06b72fe795a6f42e0bb7c65b807679be2d8d3cacf4a19938560bfb6624625b8"
const researchReceiptIdentity = "rd-research-request-receipt-v2-d06b72fe795a6f42e0bb7c65b807679be2d8d3cacf4a19938560bfb6624625b8"
const rejectedResearchReceiptIdentity = "rd-research-request-receipt-v2-b5001d4d875961cd43a2cfcc34ebf7eee7348b4985b4f8304dedd0ffa5b9cd55"
const basisDigest = "sha256:5fbd1b3619c4fff5bdbbab0b5fb82c94f27d5edf4883e14a3e2c9e9aa58db6b1"
const basisIdentity = "rd-independence-basis-v1-5fbd1b3619c4fff5bdbbab0b5fb82c94f27d5edf4883e14a3e2c9e9aa58db6b1"
const feedbackDigest = "sha256:cb2538ef46693c5923d6ec443cc439398d39f59deedc1ad8b75fabf5594d6bc5"
const feedbackIdentity = "qualification-protected-feedback-frontier-v1-cb2538ef46693c5923d6ec443cc439398d39f59deedc1ad8b75fabf5594d6bc5"
const familyIdentity = "rd-trial-family-v1-cc6af1a3a29d5d6b5a57cf192cfbff7b8f772fcfc1c036650c180b0c5c850bc2"
const policyDigest = "sha256:67747818438bf4dd765190db1e4f4cc7af82b19793bb0d43cf31ee161a54a5ee"
const rootDigest = "sha256:246564eb3fcd0aaa64e455f2b76bd138c7501471de154c39fdb07f9df6cfc331"
const memberDigest = "sha256:e243e54e142194e109fae89a0cac8e8af58e8724f6f86886544d9265539fdafd"
const frontierDigest = "sha256:73ec89ca5d972ffc1e5eee2612365254950ca4d7677ee2f0b7a776d420498dbd"
const frontierIdentity = "rd-trial-family-frontier-v1-73ec89ca5d972ffc1e5eee2612365254950ca4d7677ee2f0b7a776d420498dbd"
const bindingDigest = "sha256:7a6e507b29b8ca7ec56bff809cd524132451d81b72c376b7cc094fa86a8d969e"
const bindingIdentity = "rd-artifact-trial-family-binding-v1-7a6e507b29b8ca7ec56bff809cd524132451d81b72c376b7cc094fa86a8d969e"

async function canonicalTestDigest(domain, value) {
  const bytes = new TextEncoder().encode(JSON.stringify({ domain, value }))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

const clone = (value) => structuredClone(value)
const source = () => ({
  locator: "https://example.test/source", content_digest: "sha256:source", observed_at: "2026-08-22T00:00:00Z",
  source_cut: "source-cut-1", license_basis: "test", interpretation: "test interpretation",
})

function view(phase = "INTENT_FROZEN") {
  const initial = phase === "INTENT_FROZEN"
  const value = {
    schema_version: 1, projection_identity: initial
      ? "rd-research-view-v2-57bdd6211fb9921cc4731a51c628aa8b103d1a4aa5b5f55c002f98f9ad97ce09"
      : "rd-research-view-terminal-v2-a29a96c19039145bd24f3b5878be3405862f61b0938c561a4c2cc2f55fd19a36",
    request_identity: "request-1",
    trusted_principal: "principal-1", authorized_scope: ["research:submit"],
    authorization_policy_cut: "authorization-frontier-1", source_owner: "R_AND_D", source_cut: initial
      ? "rd-source-cut-v2-d06b72fe795a6f42e0bb7c65b807679be2d8d3cacf4a19938560bfb6624625b8"
      : "rd-artifact-cut-v1-blake3:artifact",
    observed_at_epoch_ms: phase === "ARTIFACT_AVAILABLE" ? 300 : 100,
    projection_at_epoch_ms: phase === "ARTIFACT_AVAILABLE" ? 300 : 100,
    valid_through_epoch_ms: phase === "ARTIFACT_AVAILABLE" ? 900 : 600095,
    availability: "AVAILABLE", phase, intent_identity: intentIdentity,
    source_frontier: [source()], next_legal_action: phase === "ARTIFACT_AVAILABLE" ? "REVIEW_ARTIFACT" : "WAIT_FOR_R_AND_D_EXECUTION",
  }
  if (phase === "ARTIFACT_AVAILABLE") Object.assign(value, {
    attempt_identity: "attempt-1", artifact_identity: "blake3:artifact",
    build_receipt_identity: "rd-build-receipt-v1-artifact",
    artifact_review_identity: "rd-artifact-review-v1-artifact",
  })
  return value
}

function basis() {
  return {
    schema_version: 1, basis_identity: basisIdentity, request_identity: "request-1", principal: "principal-1",
    request_scope: ["research:submit"], rationale_digest: "sha256:b6d9ce3ef56cd70624a2d3a89e1bb57a644751224a42560fd1bd781db979dd1b",
    independence_disposition: "INDEPENDENT", lineage_resolution: "GENESIS_EMPTY",
    semantic_predecessor_frontier: [], lineage_digest: "sha256:5511c7f9277fe1cccc26d418c56a88f45d24aedaad67d9f4ffade1b851927892", basis_digest: basisDigest,
    receipt: { schema_version: 1, receipt_identity: "rd-independence-basis-receipt-v1-d2c7580a5d232709b9857710d8eec94e5aada76ff3262da5fbfc5b91c1c39783", basis_identity: basisIdentity,
      basis_digest: basisDigest, committed_at_epoch_ms: 90 },
  }
}

function feedback() {
  return {
    schema_version: 1, projection_identity: feedbackIdentity, projection_digest: feedbackDigest,
    resolution: "GENESIS_EMPTY", principal: "principal-1", request_scope: ["research:submit"],
    basis_identity: basisIdentity, basis_digest: basisDigest, source_sequence: 0,
    source_cut: "qualification-protected-feedback-cut-v1-0", source_frontier_identity: null, source_frontier_digest: null,
    clock_epoch: "unix-epoch-ms-v1", projection_at_epoch_ms: 95, valid_through_epoch_ms: 600095,
    receipt: { schema_version: 1, receipt_identity: "qualification-protected-feedback-frontier-receipt-v1-6600f9fb628ced7b2e6148956881c2798ed2cab26f2300c8853c3be06ecf3972", projection_identity: feedbackIdentity,
      projection_digest: feedbackDigest, committed_at_epoch_ms: 95 },
  }
}

function family() {
  return {
    root: {
      schema_version: 1, trial_family_identity: familyIdentity,
      policy: {
        trial_budget: 8, stop_rule: "stop", pit_rule_identity: "pit-1", cost_model_identity: "cost-1",
        slippage_model_identity: "slippage-1", capacity_model_identity: "capacity-1",
        semantic_predecessor_frontier: [], protected_feedback_frontier: feedbackIdentity,
        independence_disposition: "INDEPENDENT", independence_basis_identity: basisIdentity,
        frozen_falsifier_binding: "falsifier-1",
      },
      policy_digest: policyDigest, root_digest: rootDigest, created_at_epoch_ms: 100,
    },
    root_receipt: { schema_version: 1, receipt_identity: `rd-trial-family-root-receipt-v1-${rootDigest.slice(7)}`,
      trial_family_identity: familyIdentity, intent_identity: intentIdentity, root_digest: rootDigest,
      committed_at_epoch_ms: 100 },
    initial_intent_member: { schema_version: 1,
      member_identity: `rd-trial-family-member-v1-${memberDigest.slice(7)}`, trial_family_identity: familyIdentity,
      member_kind: "INTENT", fact_identity: intentIdentity, fact_digest: intentDigest, ordinal: 0,
      member_digest: memberDigest },
    membership_receipt: { schema_version: 1,
      receipt_identity: `rd-trial-family-membership-receipt-v1-${memberDigest.slice(7)}`,
      trial_family_identity: familyIdentity, member_identity: `rd-trial-family-member-v1-${memberDigest.slice(7)}`,
      member_digest: memberDigest,
      committed_at_epoch_ms: 100 },
    census_frontier: { schema_version: 1, frontier_identity: frontierIdentity,
      trial_family_identity: familyIdentity,
      root_digest: rootDigest, member_digests: [memberDigest], consumed_trial_budget: 1,
      frontier_digest: frontierDigest },
  }
}

async function resealTrialFamily(value) {
  const current = value.trial_family
  const policy = current.root.policy
  const nextPolicyDigest = await canonicalTestDigest("rd.trial-family.policy.v1", policy)
  const familyDigest = await canonicalTestDigest("rd.trial-family.identity.v1", {
    intent_identity: value.owner_receipt.resulting_research_intent_identity,
    intent_digest: value.owner_receipt.semantic_digest,
    policy_digest: nextPolicyDigest,
  })
  const nextFamilyIdentity = `rd-trial-family-v1-${familyDigest.slice(7)}`
  const nextRootDigest = await canonicalTestDigest("rd.trial-family.root.v1", {
    schema_version: 1, trial_family_identity: nextFamilyIdentity, policy,
    policy_digest: nextPolicyDigest, created_at_epoch_ms: current.root.created_at_epoch_ms,
  })
  const nextMemberDigest = await canonicalTestDigest("rd.trial-family.census-member.v1", {
    schema_version: 1, trial_family_identity: nextFamilyIdentity, member_kind: "INTENT",
    fact_identity: value.owner_receipt.resulting_research_intent_identity,
    fact_digest: value.owner_receipt.semantic_digest, ordinal: 0,
  })
  const nextFrontierDigest = await canonicalTestDigest("rd.trial-family.census-frontier.v1", {
    schema_version: 1, trial_family_identity: nextFamilyIdentity, root_digest: nextRootDigest,
    member_digests: [nextMemberDigest], consumed_trial_budget: 1,
    ...(policy.replay_execution_policy_v2 === undefined ? {} : {
      replay_execution_policy_v2: policy.replay_execution_policy_v2,
    }),
  })
  current.root.policy_digest = nextPolicyDigest
  current.root.trial_family_identity = nextFamilyIdentity
  current.root.root_digest = nextRootDigest
  current.root_receipt.receipt_identity = `rd-trial-family-root-receipt-v1-${nextRootDigest.slice(7)}`
  current.root_receipt.trial_family_identity = nextFamilyIdentity
  current.root_receipt.root_digest = nextRootDigest
  current.initial_intent_member.member_identity = `rd-trial-family-member-v1-${nextMemberDigest.slice(7)}`
  current.initial_intent_member.trial_family_identity = nextFamilyIdentity
  current.initial_intent_member.member_digest = nextMemberDigest
  current.membership_receipt.receipt_identity = `rd-trial-family-membership-receipt-v1-${nextMemberDigest.slice(7)}`
  current.membership_receipt.trial_family_identity = nextFamilyIdentity
  current.membership_receipt.member_identity = current.initial_intent_member.member_identity
  current.membership_receipt.member_digest = nextMemberDigest
  current.census_frontier.frontier_identity = `rd-trial-family-frontier-v1-${nextFrontierDigest.slice(7)}`
  current.census_frontier.trial_family_identity = nextFamilyIdentity
  current.census_frontier.root_digest = nextRootDigest
  current.census_frontier.member_digests = [nextMemberDigest]
  current.census_frontier.frontier_digest = nextFrontierDigest
}

async function resealAcceptedOwnerChain(value) {
  const currentBasis = value.independence_basis
  const nextBasisDigest = await canonicalTestDigest("rd.independence-basis.v1", {
    schema_version: 1, request_identity: currentBasis.request_identity, principal: currentBasis.principal,
    request_scope: currentBasis.request_scope, rationale_digest: currentBasis.rationale_digest,
    independence_disposition: currentBasis.independence_disposition,
    lineage_resolution: currentBasis.lineage_resolution,
    semantic_predecessor_frontier: currentBasis.semantic_predecessor_frontier,
    lineage_digest: currentBasis.lineage_digest,
  })
  const nextBasisIdentity = `rd-independence-basis-v1-${nextBasisDigest.slice(7)}`
  const nextBasisReceiptDigest = await canonicalTestDigest("rd.independence-basis-receipt.v1", {
    schema_version: 1, basis_identity: nextBasisIdentity, basis_digest: nextBasisDigest,
    committed_at_epoch_ms: currentBasis.receipt.committed_at_epoch_ms,
  })
  currentBasis.basis_digest = nextBasisDigest
  currentBasis.basis_identity = nextBasisIdentity
  currentBasis.receipt.basis_digest = nextBasisDigest
  currentBasis.receipt.basis_identity = nextBasisIdentity
  currentBasis.receipt.receipt_identity =
    `rd-independence-basis-receipt-v1-${nextBasisReceiptDigest.slice(7)}`

  const currentFeedback = value.protected_feedback
  currentFeedback.basis_identity = nextBasisIdentity
  currentFeedback.basis_digest = nextBasisDigest
  const nextFeedbackDigest = await canonicalTestDigest("qualification.protected-feedback-frontier.v1", {
    schema_version: 1, resolution: currentFeedback.resolution, principal: currentFeedback.principal,
    request_scope: currentFeedback.request_scope, basis_identity: nextBasisIdentity, basis_digest: nextBasisDigest,
    source_sequence: currentFeedback.source_sequence, source_cut: currentFeedback.source_cut,
    source_frontier_identity: currentFeedback.source_frontier_identity,
    source_frontier_digest: currentFeedback.source_frontier_digest, clock_epoch: currentFeedback.clock_epoch,
    projection_at_epoch_ms: currentFeedback.projection_at_epoch_ms,
    valid_through_epoch_ms: currentFeedback.valid_through_epoch_ms,
  })
  const nextFeedbackIdentity = `qualification-protected-feedback-frontier-v1-${nextFeedbackDigest.slice(7)}`
  const nextFeedbackReceiptDigest = await canonicalTestDigest(
    "qualification.protected-feedback-frontier-receipt.v1",
    { schema_version: 1, projection_identity: nextFeedbackIdentity, projection_digest: nextFeedbackDigest,
      committed_at_epoch_ms: currentFeedback.receipt.committed_at_epoch_ms },
  )
  currentFeedback.projection_digest = nextFeedbackDigest
  currentFeedback.projection_identity = nextFeedbackIdentity
  currentFeedback.receipt.projection_digest = nextFeedbackDigest
  currentFeedback.receipt.projection_identity = nextFeedbackIdentity
  currentFeedback.receipt.receipt_identity =
    `qualification-protected-feedback-frontier-receipt-v1-${nextFeedbackReceiptDigest.slice(7)}`
  value.trial_family.root.policy.independence_disposition = currentBasis.independence_disposition
  value.trial_family.root.policy.independence_basis_identity = nextBasisIdentity
  value.trial_family.root.policy.protected_feedback_frontier = nextFeedbackIdentity
  await resealTrialFamily(value)
}

function acceptedResearch() {
  return {
    schema_version: 2, resolution: "ACCEPTED", request_identity: "request-1",
    owner_receipt: { schema_version: 1, receipt_identity: researchReceiptIdentity, request_identity: "request-1",
      semantic_digest: intentDigest, disposition: "ACCEPTED",
      resulting_research_intent_identity: intentIdentity, committed_at_epoch_ms: 100, rejection_code: null },
    research_view: view(), independence_basis: basis(), protected_feedback: feedback(),
    trial_family_resolution: "AVAILABLE", trial_family: family(), next_legal_action: "WAIT_FOR_R_AND_D_EXECUTION",
  }
}

function transportRoundTrippedAcceptedResearch() {
  const value = acceptedResearch()
  const sourceValue = value.research_view.source_frontier[0]
  value.research_view.source_frontier[0] = {
    locator: sourceValue.locator,
    source_cut: sourceValue.source_cut,
    observed_at: sourceValue.observed_at,
    license_basis: sourceValue.license_basis,
    content_digest: sourceValue.content_digest,
    interpretation: sourceValue.interpretation,
  }
  const policy = value.trial_family.root.policy
  value.trial_family.root.policy = {
    stop_rule: policy.stop_rule,
    trial_budget: policy.trial_budget,
    pit_rule_identity: policy.pit_rule_identity,
    cost_model_identity: policy.cost_model_identity,
    capacity_model_identity: policy.capacity_model_identity,
    slippage_model_identity: policy.slippage_model_identity,
    frozen_falsifier_binding: policy.frozen_falsifier_binding,
    independence_disposition: policy.independence_disposition,
    independence_basis_identity: policy.independence_basis_identity,
    protected_feedback_frontier: policy.protected_feedback_frontier,
    semantic_predecessor_frontier: policy.semantic_predecessor_frontier,
  }
  return value
}

const sealedS1Context = await deriveVerifiedS1ConsumerContextV1(acceptedResearch(), "request-1")
assert.ok(sealedS1Context)
function s1Context() { return sealedS1Context }

async function deriveArtifactConsumerProjectionV1(value, build, attempt, request, intent) {
  assert.equal(request, "request-1")
  assert.equal(intent, intentIdentity)
  return await projectionModule.deriveArtifactConsumerProjectionV1(value, build, attempt, s1Context())
}

async function verifyArtifactConsumerProjectionV1(value, build, attempt, request, intent) {
  assert.equal(request, "request-1")
  assert.equal(intent, intentIdentity)
  return await projectionModule.verifyArtifactConsumerProjectionV1(value, build, attempt, s1Context())
}

function rejectedResearch() {
  return {
    schema_version: 2, resolution: "REJECTED_NO_WRITE", request_identity: "request-1",
    owner_receipt: { schema_version: 1, receipt_identity: rejectedResearchReceiptIdentity, request_identity: "request-1",
      semantic_digest: "sha256:rejected", disposition: "REJECTED_NO_WRITE",
      resulting_research_intent_identity: null, committed_at_epoch_ms: 100, rejection_code: "GOAL_INVALID" },
    research_view: null, independence_basis: null, protected_feedback: null,
    trial_family_resolution: "UNAVAILABLE", trial_family: null,
    next_legal_action: "CORRECT_INPUT_AND_CREATE_SUCCESSOR_REQUEST",
  }
}

function artifactBase() {
  return {
    schema_version: 1, resolution: "SUBMITTED_OR_UNKNOWN", build_request_identity: "build-1",
    attempt_identity: "attempt-1", owner_receipt: null, research_view: null, artifact_review: null,
    artifact_review_actions: null, trial_family_resolution: null, artifact_trial_family: null,
    provider_invocation: null, next_legal_action: "RESOLVE_SAME_ATTEMPT_IDENTITY",
  }
}

function invocation(state) {
  return {
    schema_version: 1, request_identity: "build-1", claim_identity: "claim-1",
    admission_identity: "admission-1", attempt_identity: "attempt-1", claim_digest: "sha256:claim",
    invocation_admission_receipt_identity: "invocation-admission-receipt-1",
    invocation_admission_receipt_digest: "sha256:invocation-admission-receipt",
    state_digest: state === "CLAIMED" ? "sha256:claimed" : "sha256:started", committed_at_epoch_ms: 200,
    disposition: state === "CLAIMED" ? "CLAIMED_NEW" : "ALREADY_CLAIMED", state,
    next_legal_action: state === "CLAIMED" ? "RUN_BOUNDED_EXECUTION_AGENT" : "MANUALLY_RECONCILE_PROVIDER_INVOCATION",
  }
}

function legacyArtifact(disposition = "FAILED_NO_ARTIFACT") {
  const success = disposition === "SUCCESS"
  const failureCode = disposition === "OUTCOME_UNKNOWN" ? "ATTEMPT_CUSTODY_EXPIRED"
    : disposition === "REJECTED_NO_WRITE" ? "AUTHORIZATION_LINEAGE_REJECTED" : "PROVIDER_ERROR"
  return {
    schema_version: 1, resolution: "LEGACY_TERMINAL_QUARANTINED",
    build_request_identity: "build-1", attempt_identity: "attempt-1",
    owner_receipt: {
      schema_version: 1, receipt_identity: "legacy-receipt-1", build_request_identity: "build-1",
      attempt_identity: "attempt-1", request_semantic_digest: "sha256:legacy-request",
      intent_identity: intentIdentity, intent_semantic_digest: "sha256:legacy-intent", disposition,
      artifact_identity: success ? "blake3:legacy-artifact" : null,
      build_receipt_identity: success ? "legacy-build-receipt-1" : null,
      failure_code: success ? null : failureCode, committed_at_epoch_ms: 150,
    },
    research_view: null, artifact_review: null, artifact_review_actions: null,
    trial_family_resolution: "TRIAL_FAMILY_UNAVAILABLE_LEGACY",
    next_legal_action: "RESOLVE_SAME_ATTEMPT_IDENTITY",
  }
}

function failedArtifact(disposition = "FAILED_NO_ARTIFACT") {
  return {
    ...artifactBase(), resolution: disposition,
    owner_receipt: {
      schema_version: 1, receipt_identity: disposition === "OUTCOME_UNKNOWN"
        ? "rd-artifact-build-receipt-v1-e3c7b8aba2825bf4377944de789c3ee6cc9419608af5f1faab23bb15aac06a24"
        : "rd-artifact-build-receipt-v1-8ea644cae1d343e1f03c6b2532c20eab687c602be7eb8c25bd6d24a5052ec639",
      build_request_identity: "build-1",
      attempt_identity: "attempt-1", request_semantic_digest: "sha256:build-request",
      intent_identity: intentIdentity, intent_semantic_digest: intentDigest, disposition,
      artifact_identity: null, build_receipt_identity: null,
      failure_code: disposition === "OUTCOME_UNKNOWN" ? "ATTEMPT_CUSTODY_EXPIRED" : "PROVIDER_ERROR",
      committed_at_epoch_ms: 200,
    },
    research_view: view(), next_legal_action: "CREATE_SUCCESSOR_BUILD_REQUEST",
  }
}

function successArtifact() {
  const result = {
    ...artifactBase(), resolution: "SUCCESS",
    owner_receipt: {
      schema_version: 1, receipt_identity: "rd-artifact-build-receipt-v1-artifact",
      build_request_identity: "build-1",
      attempt_identity: "attempt-1", request_semantic_digest: "sha256:build-request",
      intent_identity: intentIdentity, intent_semantic_digest: intentDigest, disposition: "SUCCESS",
      artifact_identity: "blake3:artifact", build_receipt_identity: "rd-build-receipt-v1-artifact",
      failure_code: null, committed_at_epoch_ms: 300,
    },
    research_view: view("ARTIFACT_AVAILABLE"),
    artifact_review: {
      schema_version: 1, review_identity: "rd-artifact-review-v1-artifact",
      artifact_identity: {
        schema_version: 1, intent_digest: "blake3:intent-bytes", trial_id: "attempt-1",
        parameters_digest: "blake3:parameters", strategy_spec_digest: "blake3:parameters",
        wasm_digest: "blake3:wasm",
        guest_source_locator: "capsule://source", guest_source_digest: "sha256:source-capsule",
        build_recipe_locator: "recipe://build", build_recipe_digest: "sha256:recipe",
        rustc_release: "1.97.1", rustc_commit: "rustc-commit", target: "wasm32-wasip1",
        program_profile: { schema_version: 1, profile_digest: "sha256:profile" }, artifact_digest: "blake3:artifact",
      },
      intent_identity: intentIdentity, intent_semantic_digest: intentDigest, request_identity: "request-1",
      source_lineage: ["https://example.test/source#sha256:source"],
      structured_logic: { signal: "MOMENTUM", direction: "LONG_ONLY", lookback_bars: 24,
        entry_threshold_bps: 100, exit_threshold_bps: 50 },
      structured_logic_summary: "A bounded test strategy", parameters_identity: "blake3:parameters",
      dependency_identity: "rust-core-only-locked-v1",
      build_receipt: {
        schema_version: 1, build_receipt_identity: "rd-build-receipt-v1-artifact",
        attempt_identity: "attempt-1",
        intent_identity: intentIdentity, candidate_digest: "sha256:candidate",
        source_capsule_digest: "sha256:source-capsule", wasm_digest: "blake3:wasm",
        build_recipe_digest: "sha256:recipe", dependency_identity: "rust-core-only-locked-v1",
        rustc_release: "1.97.1", rustc_commit: "rustc-commit", target: "wasm32-wasip1",
        sandbox_policy: "rd-build-sandbox-v1", deterministic_double_build: true,
        artifact_security_admission: "ADMITTED",
      },
      build_security_state: "ADMITTED", agent_change_explanation: "Non-authoritative test explanation",
      agent_change_explanation_authority: "NON_AUTHORITATIVE_AGENT_EXPLANATION",
      allowed_next_actions: ["REVIEW_ARTIFACT", "CREATE_SUCCESSOR_BUILD_REQUEST"],
    },
    artifact_review_actions: { schema_version: 1, actions: [
      { action: "REVIEW_ARTIFACT", admission: "ADMITTED" },
      { action: "CREATE_SUCCESSOR_BUILD_REQUEST", admission: "ADMITTED" },
    ] },
    trial_family_resolution: "AVAILABLE",
    artifact_trial_family: {
      trial_family: family(),
      binding: { schema_version: 1, binding_identity: bindingIdentity, artifact_identity: "blake3:artifact",
        build_receipt_identity: "rd-build-receipt-v1-artifact", intent_identity: intentIdentity,
        trial_family_identity: familyIdentity,
        census_frontier_identity: frontierIdentity, census_frontier_digest: frontierDigest,
        binding_digest: bindingDigest },
      binding_receipt: { schema_version: 1,
        receipt_identity: "rd-artifact-family-binding-receipt-v1-e266cf56752cdd7b9f81a3d1400c5bd9b7f518152749f42cbb58f62aac3f41af",
        binding_identity: bindingIdentity, binding_digest: bindingDigest, committed_at_epoch_ms: 300 },
    },
    next_legal_action: "REVIEW_ARTIFACT",
  }
  return result
}

// Rust ReplayExecutionPolicyV2 fixed-record-le.v2 and catalog record encoding.
function replayPolicyFixtureBytes(firstIdentity = "runtime", cost = "cost-1", digest = `sha256:${"11".repeat(32)}`) {
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
  const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
  const text = (s) => { const b = Buffer.from(s); return Buffer.concat([u32(b.length), b]) }
  const names = [firstIdentity, "simulator", cost, "slippage-1", "capacity-1", "runner", "diagnostic",
    null, null, "calendar", "session", "timezone", "correction", "semantics", "configuration",
    "corporate-actions", "membership"]
  const parts = [Buffer.from([82, 80, 69, 50, 2, 0, 17, 0])]
  for (let tag = 1; tag <= 17; tag++) {
    const kind = tag === 8 ? 2 : tag === 9 ? 3 : tag >= 15 ? 4 : 1
    parts.push(Buffer.from([tag, kind]))
    if (tag === 8) parts.push(u64(18446744073709551615n))
    else if (tag === 9) parts.push(u64(9007199254740993n), u64(9007199254740994n))
    else parts.push(text(names[tag - 1]), text(kind === 4 ? digest : "v1"))
  }
  return [...Buffer.concat(parts)]
}

function replayBinding(bytes = replayPolicyFixtureBytes()) {
  const hash = (...parts) => [...createHash("sha256").update(Buffer.concat(parts)).digest()]
  const frame = (data) => {
    const b = Buffer.from(data), length = Buffer.alloc(4)
    length.writeUInt32LE(b.length)
    return Buffer.concat([length, b])
  }
  const parser = "rd.replay-execution-policy.fixed-record-le.v2"
  const parserDigest = [115, 95, 189, 134, 43, 39, 33, 97, 136, 227, 16, 45, 162, 186, 0, 134,
    81, 189, 82, 202, 128, 188, 148, 64, 57, 245, 220, 142, 112, 185, 12, 185]
  const digest = hash(Buffer.from("rd.replay-execution-policy.v2\0"), Buffer.from(bytes))
  return {
    catalog_record_id: "catalog-policy-v2-a", catalog_version: 1,
    policy_grammar_parser_id: parser, policy_grammar_parser_digest: parserDigest,
    policy_canonical_bytes: bytes, policy_digest: digest,
    catalog_record_digest: hash(Buffer.from("rd.replay-policy-catalog-record.v2\0"),
      frame("catalog-policy-v2-a"), Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]), frame(parser),
      Buffer.from(parserDigest), frame(bytes), Buffer.from(digest)),
  }
}

async function researchWithReplay(binding = replayBinding()) {
  const value = acceptedResearch()
  for (const carrier of [value.trial_family.root.policy, value.trial_family.root_receipt,
    value.trial_family.census_frontier]) carrier.replay_execution_policy_v2 = clone(binding)
  await resealTrialFamily(value)
  return value
}

async function artifactWithReplay(research) {
  const artifact = successArtifact()
  const family = artifact.artifact_trial_family
  family.trial_family = clone(research.trial_family)
  const root = research.trial_family.root, frontier = research.trial_family.census_frontier
  const meaning = {
    schema_version: 1, artifact_identity: "blake3:artifact", build_receipt_identity: "rd-build-receipt-v1-artifact",
    intent_identity: intentIdentity, trial_family_identity: root.trial_family_identity,
    census_frontier_identity: frontier.frontier_identity, census_frontier_digest: frontier.frontier_digest,
  }
  const digest = await canonicalTestDigest("rd.artifact-trial-family-binding.v1", meaning)
  const identity = `rd-artifact-trial-family-binding-v1-${digest.slice(7)}`
  family.binding = { ...meaning, binding_identity: identity, binding_digest: digest }
  const receipt = { schema_version: 1, binding_identity: identity, binding_digest: digest, committed_at_epoch_ms: 300 }
  const receiptDigest = await canonicalTestDigest("rd.artifact-trial-family-binding-receipt.v1", receipt)
  family.binding_receipt = { ...receipt, receipt_identity: `rd-artifact-family-binding-receipt-v1-${receiptDigest.slice(7)}` }
  return artifact
}

test("current Owner Replay binding reaches Research ACCEPTED and remains bound through Artifact S1", async () => {
  const research = await researchWithReplay()
  const projected = await deriveResearchConsumerProjectionV1(research, "request-1")
  assert.equal(projected.resolution, "ACCEPTED")
  assert.equal((await verifyResearchConsumerProjectionV1(projected, "request-1")).resolution, "ACCEPTED")
  const reordered = clone(research)
  for (const c of [reordered.trial_family.root.policy, reordered.trial_family.root_receipt,
    reordered.trial_family.census_frontier]) {
    c.replay_execution_policy_v2 = Object.fromEntries(Object.entries(c.replay_execution_policy_v2).reverse())
  }
  assert.equal((await deriveResearchConsumerProjectionV1(reordered, "request-1")).resolution, "ACCEPTED")
  const context = await deriveVerifiedS1ConsumerContextV1(research, "request-1")
  assert.ok(context)
  const artifact = await artifactWithReplay(research)
  const artifactProjection = await projectionModule.deriveArtifactConsumerProjectionV1(artifact, "build-1", "attempt-1", context)
  const verified = await projectionModule.verifyArtifactConsumerProjectionV1(artifactProjection, "build-1", "attempt-1", context)
  assert.equal(verified.resolution, "SUCCESS")
  assert.deepEqual(verified.artifact_trial_family.trial_family.root.policy.replay_execution_policy_v2, replayBinding())
  const artifactS1 = await deriveVerifiedArtifactS1ContextV1(artifact, "build-1", "attempt-1", "request-1")
  assert.equal(artifactS1?.trial_family_identity, context.trial_family_identity)
  assert.equal(artifactS1?.census_frontier_digest, context.census_frontier_digest)
  assert.equal((await projectionModule.verifyArtifactConsumerProjectionV1(
    artifactProjection, "build-1", "attempt-1", s1Context(),
  )).resolution, "SUBMITTED_OR_UNKNOWN")

  for (const carrier of ["policy", "receipt", "census"]) {
    for (const mutate of [
      (c) => { delete c.replay_execution_policy_v2 },
      (c) => { c.replay_execution_policy_v2 = null },
      (c) => { c.replay_execution_policy_v2 = {} },
      (c) => { c.replay_execution_policy_v2.unrecognized = true },
      ...["policy_canonical_bytes", "policy_digest", "catalog_record_digest", "policy_grammar_parser_digest"]
        .map((key) => (c) => { c.replay_execution_policy_v2[key][0] ^= 1 }),
      (c) => { c.replay_execution_policy_v2.catalog_version++ },
      (c) => { c.replay_execution_policy_v2.catalog_record_id += "-other" },
      (c) => { c.replay_execution_policy_v2.policy_grammar_parser_id += "-other" },
    ]) {
      const broken = clone(research)
      const f = broken.trial_family
      mutate(carrier === "policy" ? f.root.policy : carrier === "receipt" ? f.root_receipt : f.census_frontier)
      await assertResearchUnknown(broken)
      const terminal = clone(artifact)
      terminal.artifact_trial_family.trial_family = clone(f)
      assert.equal(await deriveVerifiedArtifactS1ContextV1(terminal, "build-1", "attempt-1", "request-1"), null)
    }
  }
})

test("Replay policy parser rejects malformed bytes even with recomputed policy, catalog and family digests", async () => {
  const valid = replayPolicyFixtureBytes()
  const variants = [[], valid.slice(0, -1), [...valid, 0], Array(16385).fill(0),
    replayPolicyFixtureBytes(" runtime"), replayPolicyFixtureBytes("\u0085runtime"),
    replayPolicyFixtureBytes("x".repeat(257)), replayPolicyFixtureBytes("runtime", "cost-other"),
    replayPolicyFixtureBytes("runtime", "cost-1", `sha256:${"11".repeat(32)}\n`)]
  for (const [offset, replacement] of [[0, 0], [4, 1], [6, 16], [8, 2], [9, 4], [10, 255], [14, 255]]) {
    const changed = [...valid]; changed[offset] = replacement; variants.push(changed)
  }
  for (const bytes of variants) await assertResearchUnknown(await researchWithReplay(replayBinding(bytes)))
  // Rust permits an initial BOM and Unicode identities; JS trim/TextDecoder defaults must not narrow that grammar.
  for (const identity of ["\ufeffruntime", "运行", "a\u0085b"]) {
    assert.equal((await deriveResearchConsumerProjectionV1(
      await researchWithReplay(replayBinding(replayPolicyFixtureBytes(identity))), "request-1",
    )).resolution, "ACCEPTED")
  }
})

test("Artifact terminal view cannot replace the independently sealed Research projection", async () => {
  const research = acceptedResearch()
  const artifact = successArtifact()
  const originalContext = await deriveVerifiedS1ConsumerContextV1(research, "request-1")
  assert.ok(originalContext)
  assert.equal(artifact.resolution, "SUCCESS")
  assert.equal(artifact.research_view.phase, "ARTIFACT_AVAILABLE")

  const crossProjectionRewrite = {
    ...research,
    research_view: artifact.research_view,
    next_legal_action: artifact.research_view.next_legal_action,
  }
  assert.equal(await deriveVerifiedS1ConsumerContextV1(crossProjectionRewrite, "request-1"), null)
  assert.equal((await deriveResearchConsumerProjectionV1(
    crossProjectionRewrite, "request-1",
  )).resolution, "SUBMITTED_OR_UNKNOWN")
})

test("exact terminal Artifact resolve derives only its complete sealed S1 binding", async () => {
  const research = acceptedResearch()
  const terminal = successArtifact()
  research.research_view = clone(terminal.research_view)
  research.next_legal_action = terminal.research_view.next_legal_action
  const context = await deriveVerifiedArtifactS1ContextV1(
    terminal,
    "build-1",
    "attempt-1",
    "request-1",
  )
  assert.ok(context)
  assert.equal(context.intent_identity, intentIdentity)
  assert.equal(context.trial_family_identity, familyIdentity)
  assert.equal(await deriveVerifiedArtifactS1ContextV1(
    { ...terminal, artifact_trial_family: null }, "build-1", "attempt-1", "request-1",
  ), null)
  assert.equal(await deriveVerifiedArtifactS1ContextV1(
    terminal, "build-1", "attempt-1", "request-foreign",
  ), null)
  const crossSpliced = clone(terminal)
  crossSpliced.artifact_trial_family.trial_family.census_frontier.frontier_identity = "frontier-spliced"
  crossSpliced.artifact_trial_family.binding.census_frontier_identity = "frontier-spliced"
  assert.equal(await deriveVerifiedArtifactS1ContextV1(
    crossSpliced, "build-1", "attempt-1", "request-1",
  ), null)
  const invalidOwnerIdentity = clone(terminal)
  invalidOwnerIdentity.owner_receipt.artifact_identity = "bad/artifact"
  invalidOwnerIdentity.research_view.artifact_identity = "bad/artifact"
  invalidOwnerIdentity.artifact_review.artifact_identity.artifact_digest = "bad/artifact"
  invalidOwnerIdentity.artifact_trial_family.binding.artifact_identity = "bad/artifact"
  const invalidBindingDigest = await canonicalTestDigest("rd.artifact-trial-family-binding.v1", {
    schema_version: 1,
    artifact_identity: "bad/artifact",
    build_receipt_identity: "rd-build-receipt-v1-artifact",
    intent_identity: intentIdentity,
    trial_family_identity: familyIdentity,
    census_frontier_identity: frontierIdentity,
    census_frontier_digest: frontierDigest,
  })
  const invalidBindingIdentity = `rd-artifact-trial-family-binding-v1-${invalidBindingDigest.slice(7)}`
  invalidOwnerIdentity.artifact_trial_family.binding.binding_digest = invalidBindingDigest
  invalidOwnerIdentity.artifact_trial_family.binding.binding_identity = invalidBindingIdentity
  invalidOwnerIdentity.artifact_trial_family.binding_receipt.binding_digest = invalidBindingDigest
  invalidOwnerIdentity.artifact_trial_family.binding_receipt.binding_identity = invalidBindingIdentity
  const invalidBindingReceiptDigest = await canonicalTestDigest(
    "rd.artifact-trial-family-binding-receipt.v1",
    { schema_version: 1, binding_identity: invalidBindingIdentity, binding_digest: invalidBindingDigest,
      committed_at_epoch_ms: 300 },
  )
  invalidOwnerIdentity.artifact_trial_family.binding_receipt.receipt_identity =
    `rd-artifact-family-binding-receipt-v1-${invalidBindingReceiptDigest.slice(7)}`
  assert.equal(await deriveVerifiedArtifactS1ContextV1(
    invalidOwnerIdentity, "build-1", "attempt-1", "request-1",
  ), null)

  const originalFetch = globalThis.fetch
  const originalToken = process.env.RD_OWNER_API_TOKEN
  let providerCalls = 0
  let artifactResponse = terminal
  globalThis.fetch = async (url) => {
    const value = String(url)
    if (value.includes("/v2/research-goals/request-1/resolve")) {
      return new Response(JSON.stringify(research))
    }
    if (value.includes("/v1/artifact-builds/build-1/attempts/attempt-1/resolve")) {
      return new Response(JSON.stringify(artifactResponse))
    }
    if (value.includes("api.deepseek.com")) providerCalls += 1
    throw new Error(`unexpected request ${value}`)
  }
  process.env.RD_OWNER_API_TOKEN = "test-token"
  try {
    const result = await artifactMain("RESOLVE", "build-1", "attempt-1", "request-1", "EXACT")
    assert.equal(result.resolution, "SUCCESS")
    assert.equal(result.owner_receipt?.receipt_identity, "rd-artifact-build-receipt-v1-artifact")
    artifactResponse = crossSpliced
    const rejectedSplice = await artifactMain("RESOLVE", "build-1", "attempt-1", "request-1", "EXACT")
    assert.equal(rejectedSplice.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(rejectedSplice.owner_receipt, null)
    artifactResponse = invalidOwnerIdentity
    const rejectedIdentity = await artifactMain("RESOLVE", "build-1", "attempt-1", "request-1", "EXACT")
    assert.equal(rejectedIdentity.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(rejectedIdentity.owner_receipt, null)
    assert.equal(providerCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.RD_OWNER_API_TOKEN
    else process.env.RD_OWNER_API_TOKEN = originalToken
  }
})

async function assertResearchUnknown(raw) {
  const mcp = await deriveResearchConsumerProjectionV1(raw, "request-1")
  const app = await verifyResearchConsumerProjectionV1(
    { ...raw, consumer_projection: researchStamp }, "request-1",
  )
  for (const result of [mcp, app]) {
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(result.next_legal_action, "RESOLVE_SAME_REQUEST_IDENTITY")
    const controls = actionControls(result, "request-1")
    assert.equal(controls.canSubmit, false)
    assert.equal(controls.canCreateSuccessor, false)
  }
}

async function assertArtifactUnknown(raw) {
  const args = ["build-1", "attempt-1", "request-1", intentIdentity]
  const mcp = await deriveArtifactConsumerProjectionV1(raw, ...args)
  const app = await verifyArtifactConsumerProjectionV1({ ...raw, consumer_projection: artifactStamp }, ...args)
  for (const result of [mcp, app]) {
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(result.next_legal_action, "RESOLVE_SAME_ATTEMPT_IDENTITY")
    const controls = artifactActionControls(result, "build-1", "attempt-1")
    assert.equal(controls.canRun, false)
    assert.equal(controls.canCreateSuccessor, false)
  }
}

test("missing, null, partial, extra, or wrong stamps fail closed at App ingress", async () => {
  const projected = await deriveResearchConsumerProjectionV1(acceptedResearch(), "request-1")
  for (const stampValue of [undefined, null, {}, { ...researchStamp, extra: true },
    { ...researchStamp, owner_schema: "wrong" }]) {
    const candidate = clone(projected)
    if (stampValue === undefined) delete candidate.consumer_projection
    else candidate.consumer_projection = stampValue
    const result = await verifyResearchConsumerProjectionV1(candidate, "request-1")
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
  }
})

test("complete native research rejection and acceptance project; single-field mutations fail closed", async () => {
  assert.equal((await deriveResearchConsumerProjectionV1(
    rejectedResearch(), "request-1",
  )).resolution, "REJECTED_NO_WRITE")
  assert.equal((await deriveResearchConsumerProjectionV1(
    acceptedResearch(), "request-1",
  )).resolution, "ACCEPTED")
  const rejectedMutations = [
    (v) => { v.owner_receipt.receipt_identity = "caller-chosen-noncanonical-receipt" },
    (v) => { v.owner_receipt.semantic_digest = "" },
    (v) => { v.owner_receipt.committed_at_epoch_ms = -1 },
    (v) => { v.owner_receipt.resulting_research_intent_identity = intentIdentity },
    (v) => { v.owner_receipt.rejection_code = null },
    (v) => { v.research_view = view() },
    (v) => { v.next_legal_action = "WAIT_FOR_R_AND_D_EXECUTION" },
  ]
  for (const mutate of rejectedMutations) {
    const value = rejectedResearch(); mutate(value); await assertResearchUnknown(value)
  }
  const acceptedMutations = [
    (v) => { v.owner_receipt.receipt_identity = "caller-chosen-noncanonical-receipt" },
    (v) => { v.owner_receipt.resulting_research_intent_identity = "rd-research-intent-v2-forged" },
    (v) => { v.owner_receipt.rejection_code = "FORGED" },
    (v) => { v.research_view.projection_identity = "caller-chosen-research-view" },
    (v) => { v.research_view.source_cut = "caller-chosen-source-cut" },
    (v) => { v.research_view.authorization_policy_cut = "caller-chosen-authorization-cut" },
    (v) => { v.research_view.source_frontier[0].locator = "https://caller.invalid/forged" },
    (v) => { v.research_view.intent_identity = "intent-2" },
    (v) => { v.research_view.trusted_principal = "principal-2" },
    (v) => { v.research_view.authorized_scope = ["research:other"] },
    (v) => { v.independence_basis.principal = v.protected_feedback.principal = "principal-2" },
    (v) => { v.independence_basis.request_scope = v.protected_feedback.request_scope = ["research:other"] },
    (v) => { v.research_view.observed_at_epoch_ms += 1 },
    (v) => { v.research_view.valid_through_epoch_ms = v.research_view.projection_at_epoch_ms },
    (v) => { v.research_view.source_frontier[0].extra = true },
    (v) => { v.independence_basis.receipt.basis_digest = "sha256:wrong" },
    (v) => { v.independence_basis.receipt.receipt_identity = "caller-chosen-basis-receipt" },
    (v) => { v.independence_basis.rationale_digest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    (v) => { v.independence_basis.independence_disposition = "UNKNOWN" },
    (v) => { v.protected_feedback.basis_digest = "sha256:wrong" },
    (v) => { v.protected_feedback.source_frontier_identity = "unexpected" },
    (v) => { v.protected_feedback.receipt.projection_digest = "sha256:wrong" },
    (v) => { v.protected_feedback.receipt.receipt_identity = "caller-chosen-feedback-receipt" },
    (v) => { v.trial_family.root.policy.independence_basis_identity = "basis-2" },
    (v) => { v.trial_family.root_receipt.root_digest = "sha256:wrong" },
    (v) => { v.trial_family.initial_intent_member.fact_digest = "sha256:wrong" },
    (v) => { v.trial_family.membership_receipt.member_identity = "member-2" },
    (v) => { v.trial_family.census_frontier.member_digests = [] },
    (v) => { v.trial_family.census_frontier.frontier_identity = "frontier-spliced" },
    (v) => {
      v.trial_family.root.trial_family_identity = "family-spliced"
      v.trial_family.root_receipt.trial_family_identity = "family-spliced"
      v.trial_family.initial_intent_member.trial_family_identity = "family-spliced"
      v.trial_family.membership_receipt.trial_family_identity = "family-spliced"
      v.trial_family.census_frontier.trial_family_identity = "family-spliced"
    },
    (v) => {
      const spliced = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      v.owner_receipt.semantic_digest = spliced
      v.trial_family.initial_intent_member.fact_digest = spliced
    },
  ]
  for (const mutate of acceptedMutations) {
    const value = acceptedResearch(); mutate(value); await assertResearchUnknown(value)
  }
})

test("Research first rejection diagnostics preserve results and emit only a fixed predicate", async () => {
  const logs = []
  const originalLog = console.log
  console.log = (...args) => logs.push(args)
  try {
    for (const accepted of [acceptedResearch(), await researchWithReplay()]) {
      assert.deepEqual(await deriveResearchConsumerProjectionV1(accepted, "request-1"),
        { ...accepted, consumer_projection: researchStamp })
    }
    assert.deepEqual(logs, [])
    const cases = [
      [acceptedResearch(), (v) => { v.extra = "private-body" }, "ENVELOPE_SCHEMA_REQUEST"],
      [acceptedResearch(), (v) => { v.resolution = "private-resolution" }, "RESOLUTION"],
      [acceptedResearch(), (v) => { v.owner_receipt.receipt_identity = "private-receipt" }, "RECEIPT"],
      [rejectedResearch(), (v) => { v.research_view = view() }, "REJECTED_NO_WRITE_CONSISTENCY"],
      [acceptedResearch(), (v) => { v.research_view.phase = "private-phase" }, "VIEW_SHAPE_PHASE"],
      [acceptedResearch(), (v) => { v.research_view.projection_identity = "private-view" }, "VIEW_IDENTITY"],
      [acceptedResearch(), (v) => { v.independence_basis.receipt.receipt_identity = "private-basis" }, "BASIS"],
      [acceptedResearch(), (v) => { v.protected_feedback.receipt.receipt_identity = "private-feedback" }, "FEEDBACK"],
      [acceptedResearch(), (v) => { v.trial_family_resolution = "UNAVAILABLE" }, "FAMILY_RESOLUTION"],
      [acceptedResearch(), (v) => { v.trial_family.root.policy.independence_basis_identity = "private-basis" }, "FAMILY_STRUCTURE_BINDING"],
      [acceptedResearch(), (v) => { v.trial_family.root_receipt.receipt_identity = "private-root-receipt" }, "FAMILY_ROOT_RECEIPT"],
      [await researchWithReplay(replayBinding(replayPolicyFixtureBytes("runtime", "cost-other"))),
        () => {}, "PARSER_MODELS"],
      [await researchWithReplay(), (v) => {
        for (const c of [v.trial_family.root.policy, v.trial_family.root_receipt, v.trial_family.census_frontier]) {
          c.replay_execution_policy_v2.policy_digest[0] ^= 1
        }
      }, "POLICY_DIGEST"],
      [await researchWithReplay(), (v) => {
        for (const c of [v.trial_family.root.policy, v.trial_family.root_receipt, v.trial_family.census_frontier]) {
          c.replay_execution_policy_v2.catalog_record_digest[0] ^= 1
        }
      }, "CATALOG_DIGEST"],
      // Basis is computed first, but the earlier view rejection still owns the diagnostic.
      [acceptedResearch(), (v) => {
        v.independence_basis.receipt.receipt_identity = "private-basis"
        v.research_view.phase = "private-phase"
      }, "VIEW_SHAPE_PHASE"],
    ]
    for (const [value, mutate, predicate] of cases) {
      mutate(value)
      logs.length = 0
      assert.deepEqual(await deriveResearchConsumerProjectionV1(value, "request-1"),
        projectionModule.unknownResearchProjectionV1("request-1"))
      assert.deepEqual(logs, [[JSON.stringify({
        event: "source_intake_research_projection_diagnostic_v1", first_failed_predicate: predicate,
      })]])
    }
    console.log = () => { throw new Error("private-logger-error") }
    assert.deepEqual(await deriveResearchConsumerProjectionV1(null, "request-1"),
      projectionModule.unknownResearchProjectionV1("request-1"))
  } finally {
    console.log = originalLog
  }
})

test("original-job diagnostic filter admits only closed transport and predicate events", () => {
  const runner = readFileSync(new URL("../../../../../scripts/ci/test-source-research-composer-sealed-acceptance.bash", import.meta.url), "utf8")
  const filter = runner.match(/jq -Rc '(fromjson\?[^]*?)' "\$output\.logs"/)
  assert.ok(filter)
  const predicate = { event: "source_intake_research_projection_diagnostic_v1", first_failed_predicate: "BASIS" }
  const transport = { event: "source_intake_research_diagnostic_v1", stage: "OWNER_JSON", http_status: 200, elapsed_ms: 180 }
  const invalid = [
    { ...predicate, body: "private-body" }, { ...predicate, first_failed_predicate: "BASIS\nprivate-body" },
    { ...predicate, first_failed_predicate: "UNKNOWN_PREDICATE" }, { ...predicate, first_failed_predicate: null },
    { ...predicate, first_failed_predicate: ["BASIS"] }, { ...predicate, first_failed_predicate: 1 },
    { ...predicate, event: "unknown-event" }, { ...transport, raw_body: "private-body" },
    { ...transport, stage: "OWNER_JSON\nprivate-body" }, { ...transport, elapsed_ms: "180" },
  ]
  const result = spawnSync("jq", ["-Rc", filter[1]], {
    input: [predicate, transport, ...invalid].map(JSON.stringify).join("\n") + "\nraw-private-body\n",
    encoding: "utf8",
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.stdout.trim().split("\n").map(JSON.parse), [predicate, transport])
})

test("transport key order preserves the exact canonical accepted projection", async () => {
  const nativeProjection = await deriveResearchConsumerProjectionV1(acceptedResearch(), "request-1")
  const reordered = transportRoundTrippedAcceptedResearch()
  const projection = await deriveResearchConsumerProjectionV1(reordered, "request-1")
  assert.deepEqual(projection, nativeProjection)
  assert.deepEqual(await verifyResearchConsumerProjectionV1(projection, "request-1"), projection)

  const tamperedView = clone(projection)
  tamperedView.research_view.projection_identity = "caller-chosen-research-view"
  await assertResearchUnknown(tamperedView)

  const noncanonicalFamily = clone(reordered)
  noncanonicalFamily.trial_family.root.policy_digest = "sha256:wrong"
  await assertResearchUnknown(noncanonicalFamily)
})

test("a re-sealed TrialFamily cannot launder a forged upstream Owner receipt", async () => {
  const value = acceptedResearch()
  value.independence_basis.receipt.receipt_identity = "caller-chosen-basis-receipt"
  await resealTrialFamily(value)
  await assertResearchUnknown(value)
})

test("a fully re-sealed Owner chain preserves RELATED with a complete nonempty predecessor frontier", async () => {
  const value = acceptedResearch()
  // The Owner orders accepted custody rows and emits their intent identities as strings.
  const predecessorSuffix = createHash("sha256").update(`v2:request-0:${intentDigest}`).digest("hex")
  const predecessorFrontier = [`rd-research-intent-v2-${predecessorSuffix}`]
  const currentBasis = value.independence_basis
  currentBasis.independence_disposition = "RELATED"
  currentBasis.lineage_resolution = "COMPLETE_FRONTIER"
  currentBasis.semantic_predecessor_frontier = predecessorFrontier
  currentBasis.lineage_digest = await canonicalTestDigest("rd.semantic-predecessor-frontier.v1", [
    currentBasis.principal, currentBasis.request_scope, currentBasis.lineage_resolution, predecessorFrontier,
  ])
  value.trial_family.root.policy.semantic_predecessor_frontier = clone(predecessorFrontier)
  await resealAcceptedOwnerChain(value)

  const projected = await deriveResearchConsumerProjectionV1(value, "request-1")
  assert.equal(projected.resolution, "ACCEPTED")
  assert.deepEqual(projected, { ...value, consumer_projection: researchStamp })
  const verified = await verifyResearchConsumerProjectionV1(projected, "request-1")
  assert.equal(verified.resolution, "ACCEPTED")
  assert.deepEqual(verified, projected)
})

test("Owner feedback FRONTIER preserves a zero source sequence with a sealed predecessor", async () => {
  const value = acceptedResearch()
  const predecessor = clone(value.protected_feedback)
  Object.assign(value.protected_feedback, {
    resolution: "FRONTIER",
    source_frontier_identity: predecessor.projection_identity,
    source_frontier_digest: predecessor.projection_digest,
  })
  await resealAcceptedOwnerChain(value)
  const projected = await deriveResearchConsumerProjectionV1(value, "request-1")
  assert.deepEqual(projected, { ...value, consumer_projection: researchStamp })
  assert.deepEqual(await verifyResearchConsumerProjectionV1(projected, "request-1"), projected)
  for (const mutate of [
    (v) => { v.source_sequence = -1 },
    (v) => { v.source_frontier_identity = null },
    (v) => { v.source_frontier_digest = null },
    (v) => { v.resolution = "GENESIS_EMPTY" },
  ]) {
    const invalid = clone(value)
    mutate(invalid.protected_feedback)
    await resealAcceptedOwnerChain(invalid)
    await assertResearchUnknown(invalid)
  }
})

test("a fully re-sealed Owner chain rejects RELATED with an empty predecessor frontier", async () => {
  const value = acceptedResearch()
  value.independence_basis.independence_disposition = "RELATED"
  await resealAcceptedOwnerChain(value)
  await assertResearchUnknown(value)
})

test("stale terminal research custody preserves exact facts with resolve-only controls", async () => {
  for (const readCut of [101, 600095]) {
    const stale = acceptedResearch()
    stale.research_view.availability = "STALE"
    stale.research_view.projection_at_epoch_ms = readCut
    stale.research_view.next_legal_action = "RESOLVE_SAME_REQUEST_IDENTITY"
    stale.next_legal_action = "RESOLVE_SAME_REQUEST_IDENTITY"
    const result = await deriveResearchConsumerProjectionV1(stale, "request-1")
    assert.equal(result.resolution, "ACCEPTED")
    assert.equal(result.owner_receipt.receipt_identity, stale.owner_receipt.receipt_identity)
    assert.equal(result.independence_basis.basis_identity, stale.independence_basis.basis_identity)
    assert.equal(result.protected_feedback.projection_identity, stale.protected_feedback.projection_identity)
    assert.equal(result.trial_family.root.trial_family_identity, stale.trial_family.root.trial_family_identity)
    assert.deepEqual(actionControls(result, "request-1"), {
      canSubmit: false, canResolve: true, canCreateSuccessor: false,
    })
  }

  const stale = acceptedResearch()
  stale.research_view.availability = "STALE"
  stale.research_view.projection_at_epoch_ms = 101
  stale.research_view.next_legal_action = "RESOLVE_SAME_REQUEST_IDENTITY"
  stale.next_legal_action = "RESOLVE_SAME_REQUEST_IDENTITY"

  for (const mutate of [
    (value) => { value.next_legal_action = "WAIT_FOR_R_AND_D_EXECUTION" },
    (value) => { value.research_view.next_legal_action = "WAIT_FOR_R_AND_D_EXECUTION" },
    (value) => { value.research_view.projection_at_epoch_ms = 99 },
    (value) => { value.trial_family.root.policy.protected_feedback_frontier = "projection-2" },
  ]) {
    const malformed = clone(stale)
    mutate(malformed)
    await assertResearchUnknown(malformed)
  }
})

test("failure receipts bind every semantic field and stale views cannot enable a successor", async () => {
  for (const disposition of ["FAILED_NO_ARTIFACT", "OUTCOME_UNKNOWN"]) {
    const current = failedArtifact(disposition)
    const result = await deriveArtifactConsumerProjectionV1(
      current, "build-1", "attempt-1", "request-1", intentIdentity,
    )
    assert.equal(result.resolution, disposition)
    assert.equal(artifactActionControls(
      result, "build-1", "attempt-1", s1Context(), 300,
    ).canCreateSuccessor, true)
    const stale = clone(current)
    stale.research_view.availability = "STALE"
    stale.next_legal_action = "RESOLVE_SAME_ATTEMPT_IDENTITY"
    await assertArtifactUnknown(stale)
  }
  const mutations = [
    (v) => { v.owner_receipt.receipt_identity = "rd-artifact-build-receipt-v1-forged" },
    (v) => { v.owner_receipt.request_semantic_digest = "" },
    (v) => { v.owner_receipt.intent_identity = null },
    (v) => { v.owner_receipt.intent_semantic_digest = "" },
    (v) => { v.owner_receipt.intent_semantic_digest = "sha256:foreign" },
    (v) => { v.owner_receipt.artifact_identity = "blake3:forged" },
    (v) => { v.owner_receipt.build_receipt_identity = "forged" },
    (v) => { v.owner_receipt.failure_code = "UNKNOWN_CODE" },
    (v) => { v.owner_receipt.committed_at_epoch_ms = -1 },
    (v) => { v.owner_receipt.extra = true },
  ]
  for (const mutate of mutations) {
    const value = failedArtifact(); mutate(value); await assertArtifactUnknown(value)
  }
})

test("artifact success exhaustively binds artifact, build, review, family, and actions", async () => {
  const success = successArtifact()
  assert.equal((await deriveArtifactConsumerProjectionV1(
    success, "build-1", "attempt-1", "request-1", intentIdentity,
  )).resolution, "SUCCESS")
  const mutations = [
    (v) => { v.owner_receipt.receipt_identity = "rd-artifact-build-receipt-v1-forged" },
    (v) => { v.artifact_review.review_identity = "rd-artifact-review-v1-forged" },
    (v) => {
      v.owner_receipt.intent_semantic_digest = "sha256:foreign"
      v.artifact_review.intent_semantic_digest = "sha256:foreign"
    },
    (v) => { v.owner_receipt.artifact_identity = "blake3:wrong" },
    (v) => { v.research_view.attempt_identity = "attempt-2" },
    (v) => { v.research_view.availability = "STALE" },
    (v) => { v.artifact_review.artifact_identity.trial_id = "attempt-2" },
    (v) => { v.artifact_review.artifact_identity.parameters_digest = "blake3:wrong" },
    (v) => { v.artifact_review.artifact_identity.wasm_digest = "blake3:wrong" },
    (v) => { v.artifact_review.build_receipt.source_capsule_digest = "sha256:wrong" },
    (v) => { v.artifact_review.build_receipt.deterministic_double_build = false },
    (v) => { v.artifact_review.build_receipt.artifact_security_admission = "NOT_ADMITTED" },
    (v) => { v.artifact_review.source_lineage = [] },
    (v) => { v.artifact_review.structured_logic.extra = true },
    (v) => { v.artifact_review.allowed_next_actions.reverse() },
    (v) => { v.artifact_review_actions.actions[0].admission = "NOT_ADMITTED" },
    (v) => { v.artifact_review_actions.actions.push({ action: "LEGACY", admission: "ADMITTED" }) },
    (v) => { v.artifact_trial_family.binding.artifact_identity = "blake3:wrong" },
    (v) => { v.artifact_trial_family.binding_receipt.binding_digest = "sha256:wrong" },
    (v) => { v.artifact_trial_family.binding_receipt.committed_at_epoch_ms = 301 },
  ]
  for (const mutate of mutations) {
    const value = successArtifact(); mutate(value); await assertArtifactUnknown(value)
  }
})

test("artifact projection rejects consistently cross-spliced S1 request and family", async () => {
  const context = s1Context()
  const foreignRequest = successArtifact()
  foreignRequest.research_view.request_identity = "request-2"
  foreignRequest.artifact_review.request_identity = "request-2"
  assert.equal((await projectionModule.deriveArtifactConsumerProjectionV1(
    foreignRequest, "build-1", "attempt-1", context,
  )).resolution, "SUBMITTED_OR_UNKNOWN")

  const foreignFamily = successArtifact()
  foreignFamily.artifact_trial_family.trial_family.root.trial_family_identity = "family-2"
  foreignFamily.artifact_trial_family.trial_family.root_receipt.trial_family_identity = "family-2"
  foreignFamily.artifact_trial_family.trial_family.initial_intent_member.trial_family_identity = "family-2"
  foreignFamily.artifact_trial_family.trial_family.membership_receipt.trial_family_identity = "family-2"
  foreignFamily.artifact_trial_family.trial_family.census_frontier.trial_family_identity = "family-2"
  foreignFamily.artifact_trial_family.binding.trial_family_identity = "family-2"
  assert.equal((await projectionModule.deriveArtifactConsumerProjectionV1(
    foreignFamily, "build-1", "attempt-1", context,
  )).resolution, "SUBMITTED_OR_UNKNOWN")

  const foreignFrontier = successArtifact()
  foreignFrontier.artifact_trial_family.trial_family.census_frontier.frontier_identity = "frontier-2"
  foreignFrontier.artifact_trial_family.binding.census_frontier_identity = "frontier-2"
  assert.equal((await projectionModule.deriveArtifactConsumerProjectionV1(
    foreignFrontier, "build-1", "attempt-1", context,
  )).resolution, "SUBMITTED_OR_UNKNOWN")
})

test("claimed and invocation-started response loss preserve exact custody and terminal receipts win", async () => {
  const claimed = artifactBase()
  claimed.provider_invocation = invocation("CLAIMED")
  delete claimed.trial_family_resolution
  delete claimed.artifact_trial_family
  const claimedResult = await deriveArtifactConsumerProjectionV1(
    claimed, "build-1", "attempt-1", "request-1", intentIdentity,
  )
  assert.equal(claimedResult.next_legal_action, "RUN_BOUNDED_EXECUTION_AGENT")
  assert.equal(claimedResult.provider_invocation.claim_identity, "claim-1")
  assert.equal(claimedResult.provider_invocation.invocation_admission_receipt_identity, "invocation-admission-receipt-1")
  assert.equal(claimedResult.provider_invocation.invocation_admission_receipt_digest, "sha256:invocation-admission-receipt")
  assert.equal(artifactActionControls(claimedResult, "build-1", "attempt-1").canRun, true)

  const alreadyClaimed = clone(claimed)
  alreadyClaimed.provider_invocation.disposition = "ALREADY_CLAIMED"
  assert.equal((await deriveArtifactConsumerProjectionV1(
    alreadyClaimed, "build-1", "attempt-1", "request-1", intentIdentity,
  )).provider_invocation.disposition, "ALREADY_CLAIMED")

  const started = artifactBase()
  started.provider_invocation = invocation("INVOCATION_STARTED")
  delete started.trial_family_resolution
  delete started.artifact_trial_family
  const startedResult = await deriveArtifactConsumerProjectionV1(
    started, "build-1", "attempt-1", "request-1", intentIdentity,
  )
  assert.equal(startedResult.next_legal_action, "MANUALLY_RECONCILE_PROVIDER_INVOCATION")
  assert.equal(startedResult.provider_invocation.admission_identity, "admission-1")
  assert.equal(startedResult.provider_invocation.invocation_admission_receipt_identity, "invocation-admission-receipt-1")
  assert.equal(startedResult.provider_invocation.invocation_admission_receipt_digest, "sha256:invocation-admission-receipt")
  assert.deepEqual(artifactActionControls(startedResult, "build-1", "attempt-1"), {
    canRun: false, canResolve: false, canCreateSuccessor: false,
  })

  for (const mutate of [
    (v) => { v.provider_invocation.request_identity = "build-2" },
    (v) => { v.provider_invocation.admission_identity = "" },
    (v) => { v.provider_invocation.attempt_identity = "attempt-2" },
    (v) => { v.provider_invocation.invocation_admission_receipt_identity = "" },
    (v) => { v.provider_invocation.invocation_admission_receipt_digest = "" },
    (v) => { delete v.provider_invocation.invocation_admission_receipt_identity },
    (v) => { delete v.provider_invocation.invocation_admission_receipt_digest },
    (v) => { v.provider_invocation.claim_digest = "" },
    (v) => { v.provider_invocation.state_digest = "" },
    (v) => { v.provider_invocation.committed_at_epoch_ms = -1 },
    (v) => { v.provider_invocation.extra = true },
  ]) { const value = clone(started); mutate(value); await assertArtifactUnknown(value) }

  for (const terminal of [failedArtifact(), successArtifact()]) {
    if (terminal.resolution !== "SUCCESS") {
      delete terminal.trial_family_resolution
      delete terminal.artifact_trial_family
    }
    terminal.provider_invocation = invocation("INVOCATION_STARTED")
    const result = await deriveArtifactConsumerProjectionV1(
      terminal, "build-1", "attempt-1", "request-1", intentIdentity,
    )
    assert.equal(result.resolution, terminal.resolution)
    assert.equal(result.provider_invocation, null)
  }
})

test("stale terminal Rust wire retains exact evidence without actionable controls", async () => {
  for (const terminal of [failedArtifact(), successArtifact()]) {
    terminal.research_view.availability = "STALE"
    terminal.research_view.projection_at_epoch_ms = terminal.research_view.valid_through_epoch_ms
    terminal.research_view.next_legal_action = "RESOLVE_SAME_REQUEST_IDENTITY"
    terminal.next_legal_action = "RESOLVE_SAME_ATTEMPT_IDENTITY"
    terminal.artifact_review_actions = null
    if (terminal.resolution !== "SUCCESS") {
      delete terminal.trial_family_resolution
      delete terminal.artifact_trial_family
    }
    const result = await deriveArtifactConsumerProjectionV1(
      terminal, "build-1", "attempt-1", "request-1", intentIdentity,
    )
    assert.equal(result.resolution, terminal.resolution)
    assert.equal(result.owner_receipt.receipt_identity, terminal.owner_receipt.receipt_identity)
    assert.equal(result.next_legal_action, "RESOLVE_SAME_ATTEMPT_IDENTITY")
    assert.deepEqual(artifactActionControls(result, "build-1", "attempt-1"), {
      canRun: false, canResolve: true, canCreateSuccessor: false,
    })
  }
})

test("verified legacy terminal custody is reachable but remains read-only and exact", async () => {
  for (const disposition of ["SUCCESS", "FAILED_NO_ARTIFACT", "REJECTED_NO_WRITE", "OUTCOME_UNKNOWN"]) {
    const raw = legacyArtifact(disposition)
    if (disposition !== "SUCCESS") {
      raw.owner_receipt.intent_identity = null
      raw.owner_receipt.intent_semantic_digest = null
    }
    const result = await deriveArtifactConsumerProjectionV1(
      raw, "build-1", "attempt-1", "request-1", intentIdentity,
    )
    assert.equal(result.resolution, "LEGACY_TERMINAL_QUARANTINED")
    assert.equal(result.owner_receipt.disposition, disposition)
    assert.equal(result.trial_family_resolution, "TRIAL_FAMILY_UNAVAILABLE_LEGACY")
    assert.equal(result.artifact_trial_family, null)
    assert.equal(result.provider_invocation, null)
    assert.equal(result.next_legal_action, "RESOLVE_SAME_ATTEMPT_IDENTITY")
    assert.deepEqual(artifactActionControls(result, "build-1", "attempt-1"), {
      canRun: false, canResolve: true, canCreateSuccessor: false,
    })

    const app = await verifyArtifactConsumerProjectionV1(
      { ...result }, "build-1", "attempt-1", "request-1", intentIdentity,
    )
    assert.equal(app.resolution, "LEGACY_TERMINAL_QUARANTINED")
    assert.equal(app.owner_receipt.receipt_identity, "legacy-receipt-1")
  }
})

test("malformed, partial, positive-upgrade, or claim-present legacy custody fails closed", async () => {
  for (const mutate of [
    (v) => { v.build_request_identity = "build-2" },
    (v) => { v.attempt_identity = "attempt-2" },
    (v) => { v.owner_receipt = null },
    (v) => { v.owner_receipt.receipt_identity = "" },
    (v) => { v.owner_receipt.extra = true },
    (v) => { v.owner_receipt.intent_semantic_digest = null },
    (v) => { v.owner_receipt.artifact_identity = "blake3:forged" },
    (v) => { v.owner_receipt.failure_code = null },
    (v) => { v.research_view = view() },
    (v) => { v.artifact_review = {} },
    (v) => { v.artifact_review_actions = {} },
    (v) => { v.trial_family_resolution = "AVAILABLE" },
    (v) => { v.artifact_trial_family = null },
    (v) => { v.provider_invocation = invocation("CLAIMED") },
    (v) => { v.next_legal_action = "CREATE_SUCCESSOR_BUILD_REQUEST" },
    (v) => { v.extra = true },
  ]) {
    const value = legacyArtifact()
    mutate(value)
    await assertArtifactUnknown(value)
  }

  for (const mutate of [
    (v) => { v.owner_receipt.disposition = "SUCCESS" },
    (v) => { v.owner_receipt.disposition = "UNKNOWN" },
    (v) => { v.owner_receipt.disposition = "REJECTED_NO_WRITE"; v.owner_receipt.failure_code = null },
    (v) => { v.owner_receipt.intent_identity = null },
  ]) {
    const value = legacyArtifact()
    mutate(value)
    await assertArtifactUnknown(value)
  }

  for (const mutate of [
    (v) => { v.owner_receipt.artifact_identity = null },
    (v) => { v.owner_receipt.build_receipt_identity = null },
    (v) => { v.owner_receipt.failure_code = "FORGED" },
    (v) => { v.owner_receipt.intent_identity = null },
  ]) {
    const value = legacyArtifact("SUCCESS")
    mutate(value)
    await assertArtifactUnknown(value)
  }
})
