/**
 * Project the Owner's single next legal action into the App's controls.
 * Unknown values fail closed: they expose no mutating action.
 */
function projected(result, operation, ownerOperation, ownerSchema, identityField, identity) {
  const projection = result?.consumer_projection
  return result !== null
    && typeof result === "object"
    && projection !== null
    && typeof projection === "object"
    && Object.keys(projection).length === 4
    && projection?.schema_version === 1
    && projection?.operation === operation
    && projection?.owner_operation === ownerOperation
    && projection?.owner_schema === ownerSchema
    && result?.[identityField] === identity
}

export function actionControls(result, requestIdentity) {
  if (result === null) {
    return { canSubmit: true, canResolve: false, canCreateSuccessor: false }
  }
  if (!projected(
    result,
    "research_goal.consumer_projection.v1",
    "research_goal.submit_or_resolve.v2",
    "sourced-research-goal-v2",
    "request_identity",
    requestIdentity,
  )) return { canSubmit: false, canResolve: false, canCreateSuccessor: false }
  const nextLegalAction = result.next_legal_action
  const receiptBackedRejection = result.resolution === "REJECTED_NO_WRITE"
    && result.owner_receipt?.request_identity === requestIdentity
    && result.owner_receipt?.disposition === "REJECTED_NO_WRITE"
  return {
    canSubmit: false,
    canResolve: nextLegalAction === "RESOLVE_SAME_REQUEST_IDENTITY",
    canCreateSuccessor: receiptBackedRejection
      && nextLegalAction === "CORRECT_INPUT_AND_CREATE_SUCCESSOR_REQUEST",
  }
}

export function artifactBoundToS1Context(result, s1Context) {
  const receipt = result?.owner_receipt
  const review = result?.artifact_review
  const family = result?.artifact_trial_family?.trial_family
  const binding = result?.artifact_trial_family?.binding
  const receiptBound = receipt !== null
    && typeof receipt === "object"
    && receipt.intent_identity === s1Context?.intent_identity
    && receipt.intent_semantic_digest === s1Context?.intent_semantic_digest
    && (review == null || (review.intent_identity === s1Context?.intent_identity
      && review.intent_semantic_digest === s1Context?.intent_semantic_digest))
  if (!receiptBound) return false
  if (result?.resolution !== "SUCCESS" && family == null && binding == null) return true
  return result?.research_view?.request_identity === s1Context?.request_identity
    && result?.research_view?.intent_identity === s1Context?.intent_identity
    && family?.root?.trial_family_identity === s1Context?.trial_family_identity
    && family?.root?.root_digest === s1Context?.trial_family_root_digest
    && family?.census_frontier?.frontier_identity === s1Context?.census_frontier_identity
    && family?.census_frontier?.frontier_digest === s1Context?.census_frontier_digest
    && binding?.trial_family_identity === s1Context?.trial_family_identity
    && binding?.census_frontier_identity === s1Context?.census_frontier_identity
    && binding?.census_frontier_digest === s1Context?.census_frontier_digest
}

export function artifactContextCurrentAt(result, s1Context, nowEpochMs) {
  return artifactBoundToS1Context(result, s1Context)
    && result?.research_view?.availability === "AVAILABLE"
    && result?.research_view?.request_identity === s1Context?.request_identity
    && result?.research_view?.intent_identity === s1Context?.intent_identity
    && Number.isSafeInteger(s1Context?.valid_through_epoch_ms)
    && Number.isSafeInteger(result?.research_view?.valid_through_epoch_ms)
    && Number.isSafeInteger(nowEpochMs)
    && nowEpochMs < s1Context.valid_through_epoch_ms
    && nowEpochMs < result.research_view.valid_through_epoch_ms
}

export function artifactActionControls(
  result, buildRequestIdentity, attemptIdentity, s1Context, nowEpochMs,
) {
  if (result === null) {
    return { canRun: true, canResolve: false, canCreateSuccessor: false }
  }
  if (!projected(
    result,
    "artifact_build.consumer_projection.v1",
    "artifact_build.submit_or_resolve.v1",
    "rd-artifact-build-request-v1",
    "build_request_identity",
    buildRequestIdentity,
  ) || result.attempt_identity !== attemptIdentity) {
    return { canRun: false, canResolve: false, canCreateSuccessor: false }
  }
  const nextLegalAction = result.next_legal_action
  const providerInvocation = result.provider_invocation
  const canResumeClaim = nextLegalAction === "RUN_BOUNDED_EXECUTION_AGENT"
    && providerInvocation?.state === "CLAIMED"
    && providerInvocation?.next_legal_action === "RUN_BOUNDED_EXECUTION_AGENT"
    && typeof providerInvocation?.claim_identity === "string"
    && providerInvocation.claim_identity.length > 0
    && typeof providerInvocation?.claim_digest === "string"
    && providerInvocation.claim_digest.length > 0
    && typeof providerInvocation?.state_digest === "string"
    && providerInvocation.state_digest.length > 0
    && typeof providerInvocation?.attempt_identity === "string"
    && providerInvocation.attempt_identity.length > 0
    && providerInvocation.attempt_identity === attemptIdentity
    && providerInvocation.request_identity === buildRequestIdentity
  const receiptBackedSuccessor = ["FAILED_NO_ARTIFACT", "REJECTED_NO_WRITE", "OUTCOME_UNKNOWN"]
    .includes(result.resolution)
    && artifactContextCurrentAt(result, s1Context, nowEpochMs)
    && result.owner_receipt?.build_request_identity === buildRequestIdentity
    && result.owner_receipt?.attempt_identity === attemptIdentity
    && result.owner_receipt?.disposition === result.resolution
  return {
    canRun: canResumeClaim,
    canResolve: nextLegalAction === "RESOLVE_SAME_ATTEMPT_IDENTITY",
    canCreateSuccessor: receiptBackedSuccessor && [
      "CREATE_SUCCESSOR_BUILD_REQUEST",
      "CORRECT_INPUT_AND_CREATE_SUCCESSOR_REQUEST",
    ].includes(nextLegalAction),
  }
}

/**
 * Separate admission for a new artifact attempt from recovery of the same
 * already-projected attempt. Recovery may use the S1 context frozen when that
 * attempt first crossed the App boundary; it must never manufacture a new
 * request, attempt, or provider claim from an unavailable live Research view.
 */
export function artifactInvocationAdmission({
  action,
  artifactResult,
  buildRequestIdentity,
  attemptIdentity,
  liveS1Context,
  frozenS1Context,
  researchViewAvailable,
  freshIdentityGenerated,
  canResolveImportedArtifact,
  nowEpochMs,
}) {
  const controls = artifactActionControls(
    artifactResult, buildRequestIdentity, attemptIdentity, liveS1Context, nowEpochMs,
  )
  const recovery = artifactResult !== null
  const context = recovery
    ? action === "RUN" ? frozenS1Context : frozenS1Context ?? liveS1Context
    : liveS1Context
  const allowed = action === "RUN"
    ? recovery
      ? controls.canRun
      : controls.canRun && researchViewAvailable && freshIdentityGenerated
    : controls.canResolve || (!recovery && canResolveImportedArtifact)
  const sealedClaimRecovery = action === "RUN" && recovery && controls.canRun
  return {
    canInvoke: allowed && (action === "RESOLVE" || context !== null || sealedClaimRecovery),
    context,
    recovery,
  }
}

export function freezeS1ContextForOwnedAttempt(result, expectedContext, frozenContext) {
  const recoverableClaim = result?.provider_invocation?.state === "CLAIMED"
    && result?.provider_invocation?.next_legal_action === "RUN_BOUNDED_EXECUTION_AGENT"
  const terminalReceipt = result?.owner_receipt !== null && typeof result?.owner_receipt === "object"
  return expectedContext !== null && (recoverableClaim || terminalReceipt)
    ? frozenContext ?? expectedContext
    : frozenContext
}

export function artifactFailureDisposition(artifactBackendStarted) {
  return artifactBackendStarted ? "SUBMITTED_OR_UNKNOWN" : "NOT_SUBMITTED"
}

export function researchAvailableAt(result, s1Context, nowEpochMs) {
  return result?.research_view?.availability === "AVAILABLE"
    && s1Context?.request_identity === result?.request_identity
    && s1Context?.intent_identity === result?.research_view?.intent_identity
    && Number.isSafeInteger(s1Context?.valid_through_epoch_ms)
    && Number.isSafeInteger(nowEpochMs)
    && nowEpochMs < s1Context.valid_through_epoch_ms
}

export function artifactAvailableAt(result, s1Context, nowEpochMs) {
  return researchAvailableAt({
    request_identity: s1Context?.request_identity,
    research_view: {
      availability: s1Context ? "AVAILABLE" : "STALE",
      intent_identity: s1Context?.intent_identity,
    },
  }, s1Context, nowEpochMs)
    && artifactContextCurrentAt(result, s1Context, nowEpochMs)
}

export async function resolveCurrentResearchThenRunArtifact({
  requestIdentity,
  intentIdentity,
  artifactResult,
  buildRequestIdentity,
  attemptIdentity,
  resolveResearch,
  projectResearch,
  runArtifact,
}) {
  let research = null
  let artifactBackendStarted = false
  const canResumeClaim = artifactResult != null
    && artifactActionControls(
      artifactResult, buildRequestIdentity, attemptIdentity, null, 0,
    ).canRun
  if (canResumeClaim) {
    artifactBackendStarted = true
    try {
      return { research, artifact: await runArtifact(), artifactBackendStarted, error: null }
    } catch (error) {
      return { research, artifact: null, artifactBackendStarted, error }
    }
  }
  try {
    research = await projectResearch(await resolveResearch(), requestIdentity)
  } catch (error) {
    return { research: null, artifact: null, artifactBackendStarted, error }
  }
  const view = research?.research_view
  const current = research?.resolution === "ACCEPTED"
    && research?.request_identity === requestIdentity
    && research?.owner_receipt?.request_identity === requestIdentity
    && research?.owner_receipt?.resulting_research_intent_identity === intentIdentity
    && view?.request_identity === requestIdentity
    && view?.intent_identity === intentIdentity
    && view?.availability === "AVAILABLE"
    && view?.phase === "INTENT_FROZEN"
  if (!current) {
    return { research, artifact: null, artifactBackendStarted, error: null }
  }
  artifactBackendStarted = true
  try {
    return { research, artifact: await runArtifact(), artifactBackendStarted, error: null }
  } catch (error) {
    return { research, artifact: null, artifactBackendStarted, error }
  }
}
