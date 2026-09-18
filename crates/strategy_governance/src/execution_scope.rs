//! Immutable Execution Scope vocabulary.
//!
//! A Governance Execution Scope may only be created after Portfolio supplies one current `BOUND`
//! Capacity Scope and Execution supplies one current `ADMITTED` PAPER Adapter Binding, and the
//! account, mode, effect namespace, endpoint, capabilities, valid-through, and shared-constraint
//! partition of those two facts agree exactly. This module owns the untrusted request vocabulary,
//! the typed prebinding failures, and the sealed positive readback. It reads nothing and writes
//! nothing; only [`crate::registry_postgres`] can mint a sealed scope, after rereading both source
//! Owners inside one transaction.
//!
//! The scope binds no Candidate, generation, or ArtifactRef. Those belong to the Governed Strategy
//! Entry, which the documentation defines as binding an exact Eligibility Fact and a qualified
//! capacity ceiling. Qualification has no production writer for either, so an entry minted here
//! would be a weaker fact than the one the architecture defines, and this module does not mint
//! one.
//!
//! The sealed scope has private fields, no public constructor, no `Default`, and no `Deserialize`,
//! so a caller cannot mint one from a data transfer object or a self-report:
//!
//! ```compile_fail
//! use vibe_strategy_governance::execution_scope::GovernedExecutionScope;
//!
//! let forged: GovernedExecutionScope = serde_json::from_str("{}").unwrap();
//! ```

use serde::Serialize;

use crate::Digest;

/// Contract schema version of every sealed scope this module mints.
pub const GOVERNED_EXECUTION_SCOPE_SCHEMA_V1: u32 = 1;

/// Execution mode a Governed Execution Scope may bind.
///
/// `LIVE` is not admitted anywhere in this repository, so this Owner's scope vocabulary carries
/// only `PAPER`. A `LIVE` scope needs a documentation change first, not a new enum member.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GovernedExecutionScopeMode {
    /// Simulated execution inside a `PAPER` effect namespace.
    Paper,
}

/// Explicit maturity carried by every readback this Owner mints.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GovernedExecutionScopeMaturity {
    /// The scope exists in this Owner's own PostgreSQL custody.
    ///
    /// It is not a deployment admission, it does not prove that Runtime can start an instance,
    /// and it authorizes no effect.
    OwnerLocalPostgresCustodyNotDeploymentAdmission,
}

/// Every way a prebinding can fail to create an Execution Scope.
///
/// Each member names the exact disagreeing thing. Two source Owners that do not agree, an
/// expectation the caller got wrong, and an unreachable source Owner are three different
/// failures and never collapse into one.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExecutionScopePrebindingFailure {
    /// Portfolio returned no readback for the named Capacity Scope request.
    CapacityScopeUnavailable,
    /// Portfolio's readback exists but is not `BOUND`.
    CapacityScopeNotBound,
    /// Portfolio's Capacity Scope is not in `PAPER` mode.
    CapacityScopeModeNotPaper,
    /// Execution returned no current binding for the named Execution Scope.
    AdapterBindingUnavailable,
    /// Execution's current binding exists but is not `ADMITTED`.
    AdapterBindingNotAdmitted,
    /// Execution's binding is not in `PAPER` mode.
    AdapterBindingModeNotPaper,
    /// The two Owners name different account namespaces.
    AccountNamespaceDisagreement,
    /// Portfolio's registry names a different adapter binding than Execution admitted.
    AdapterBindingPrebindingConflict,
    /// Execution returned a binding that belongs to a different Execution Scope.
    AdapterBindingScopeDisagreement,
    /// The caller's expected Capacity Scope identity is not the one Portfolio resolved.
    CapacityScopeIdentityMismatch,
    /// The caller's expected account namespace is not the one both Owners carry.
    ExpectedAccountNamespaceMismatch,
    /// The caller's expected economic pool is not the one Portfolio resolved.
    ExpectedEconomicPoolMismatch,
    /// The caller's expected endpoint is not the one Execution admitted.
    ExpectedEndpointMismatch,
    /// The caller's expected capability set is not the one Execution admitted.
    ExpectedCapabilitiesMismatch,
    /// The caller's expected shared-constraint partition is not the one Portfolio declared.
    ExpectedSharedConstraintPartitionMismatch,
    /// One source fact's validity bound has already passed at the Owner's decision time.
    SourceFactExpired,
    /// Execution's binding became effective after the Owner's decision time.
    SourceFactNotYetEffective,
    /// The request carries an empty or malformed identity.
    RequestMalformed,
    /// An immutable scope with this identity already binds a different meaning.
    ScopeAlreadyBoundToAnotherMeaning,
}

/// Untrusted Execution Scope creation request.
///
/// Every field is a caller coordinate or a caller expectation. Nothing here is believed: the
/// coordinates locate each source Owner's own fact, and each expectation is compared against what
/// that Owner returns. A request that gets an expectation wrong creates no scope.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedExecutionScopeRequest {
    /// Caller-chosen identity of this creation attempt, used for exact replay.
    pub request_identity: String,
    /// Identity of the Portfolio `BOUND` Capacity Scope resolution to reread.
    pub capacity_scope_request_identity: String,
    /// Identity of the Execution Scope whose current adapter binding to reread.
    pub execution_scope_identity: String,
    /// Capacity Scope identity the caller believes Portfolio resolved.
    pub expected_capacity_scope_identity: String,
    /// Account namespace the caller believes both Owners carry.
    pub expected_account_namespace: String,
    /// Economic pool the caller believes Portfolio resolved.
    pub expected_economic_pool_identity: String,
    /// Simulator or venue endpoint the caller believes Execution admitted.
    pub expected_endpoint_identity: String,
    /// Adapter capability set the caller believes Execution admitted, in the Owner's own order.
    pub expected_capabilities: Vec<String>,
    /// Shared-constraint partition the caller believes Portfolio declared, in the registry's order.
    ///
    /// An empty partition is a meaningful value: it says this scope shares no constraint with any
    /// other, and a scope that turns out to share one is refused rather than silently widened.
    pub expected_shared_constraint_identities: Vec<String>,
}

impl UntrustedExecutionScopeRequest {
    pub(crate) fn well_formed(&self) -> bool {
        let identities = [
            &self.request_identity,
            &self.capacity_scope_request_identity,
            &self.execution_scope_identity,
            &self.expected_capacity_scope_identity,
            &self.expected_account_namespace,
            &self.expected_economic_pool_identity,
            &self.expected_endpoint_identity,
        ];
        identities
            .into_iter()
            .all(|value| !value.is_empty() && value.len() <= 200)
            && !self.expected_capabilities.is_empty()
            && self
                .expected_capabilities
                .iter()
                .all(|capability| !capability.is_empty())
    }
}

/// Exact request coordinates echoed back with every readback.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ExecutionScopeRequestFingerprint {
    request_identity: String,
    semantic_digest: String,
}

impl ExecutionScopeRequestFingerprint {
    /// The caller's own request identity.
    #[must_use]
    pub fn request_identity(&self) -> &str {
        &self.request_identity
    }

    /// Digest over the complete untrusted request, so a replay that changed meaning is visible.
    #[must_use]
    pub fn semantic_digest(&self) -> &str {
        &self.semantic_digest
    }
}

/// Structured fail-closed readback that binds nothing and writes nothing.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct UnavailableExecutionScopeReadback {
    schema_version: u32,
    fingerprint: ExecutionScopeRequestFingerprint,
    maturity: GovernedExecutionScopeMaturity,
    failures: Vec<ExecutionScopePrebindingFailure>,
}

impl UnavailableExecutionScopeReadback {
    /// Contract schema version.
    #[must_use]
    pub const fn schema_version(&self) -> u32 {
        self.schema_version
    }

    /// Exact untrusted request identity and digest.
    #[must_use]
    pub const fn fingerprint(&self) -> &ExecutionScopeRequestFingerprint {
        &self.fingerprint
    }

    /// Explicit non-created maturity.
    #[must_use]
    pub const fn maturity(&self) -> GovernedExecutionScopeMaturity {
        self.maturity
    }

    /// Every reason this prebinding created no lifecycle authorization.
    #[must_use]
    pub fn failures(&self) -> &[ExecutionScopePrebindingFailure] {
        &self.failures
    }
}

/// Governance-sealed immutable Execution Scope and its Governed Strategy Entry binding.
///
/// Only the PostgreSQL custody can mint this, and only after rereading both source Owners in the
/// same transaction that inserts it. Its identity is derived from the bound meaning alone, so the
/// same two source facts always name the same scope.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct GovernedExecutionScope {
    schema_version: u32,
    fingerprint: ExecutionScopeRequestFingerprint,
    maturity: GovernedExecutionScopeMaturity,
    scope_identity: String,
    scope_digest: String,
    mode: GovernedExecutionScopeMode,
    account_namespace: String,
    effect_namespace: String,
    capacity_scope_identity: String,
    economic_pool_identity: String,
    economic_pool_currency: String,
    shared_constraint_identities: Vec<String>,
    adapter_binding_fact_identity: String,
    adapter_binding_generation: u64,
    adapter_implementation_digest: String,
    adapter_configuration_digest: String,
    trust_policy_identity: String,
    reduce_only_policy: String,
    endpoint_identity: String,
    capabilities: Vec<String>,
    portfolio_proof_frontier_identity: String,
    created_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
}

impl GovernedExecutionScope {
    /// Contract schema version.
    #[must_use]
    pub const fn schema_version(&self) -> u32 {
        self.schema_version
    }

    /// Exact request identity and digest that produced this scope.
    #[must_use]
    pub const fn fingerprint(&self) -> &ExecutionScopeRequestFingerprint {
        &self.fingerprint
    }

    /// Explicit Owner-custody maturity. It is not a deployment admission.
    #[must_use]
    pub const fn maturity(&self) -> GovernedExecutionScopeMaturity {
        self.maturity
    }

    /// Identity of the Execution Scope, the same one Execution keys its binding head on.
    #[must_use]
    pub fn scope_identity(&self) -> &str {
        &self.scope_identity
    }

    /// Digest over the complete bound meaning of this scope.
    #[must_use]
    pub fn scope_digest(&self) -> &str {
        &self.scope_digest
    }

    /// Typed execution mode.
    #[must_use]
    pub const fn mode(&self) -> GovernedExecutionScopeMode {
        self.mode
    }

    /// Portfolio-owned Capacity Scope this generation draws capital from.
    #[must_use]
    pub fn capacity_scope_identity(&self) -> &str {
        &self.capacity_scope_identity
    }

    /// Execution-owned effect namespace every effect of this scope lands in.
    #[must_use]
    pub fn effect_namespace(&self) -> &str {
        &self.effect_namespace
    }

    /// Execution's own adapter binding fact this scope is pinned to.
    #[must_use]
    pub fn adapter_binding_fact_identity(&self) -> &str {
        &self.adapter_binding_fact_identity
    }

    /// Exclusive time bound beyond which both source facts must be reread.
    ///
    /// It is the earlier of Portfolio's proof validity bound and Execution's exclusive binding
    /// validity bound, so the scope never outlives either source fact. It is a projection of the
    /// two current source facts rather than stored state, so a replay reports the freshness those
    /// facts have now and never the one they had at creation.
    #[must_use]
    pub const fn valid_through_epoch_ms(&self) -> u64 {
        self.valid_through_epoch_ms
    }

    /// Owner-observed creation time.
    #[must_use]
    pub const fn created_at_epoch_ms(&self) -> u64 {
        self.created_at_epoch_ms
    }
}

/// What each source Owner's own fact says, after this Owner parsed its read API result.
///
/// The custody builds one of these per source Owner from that Owner's read function and never
/// from the caller's request, so every comparison below is Owner against Owner.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct BoundCapacityScopeFact {
    pub(crate) state: String,
    pub(crate) mode: String,
    pub(crate) capacity_scope_identity: String,
    pub(crate) account_namespace: String,
    pub(crate) economic_pool_identity: String,
    pub(crate) economic_pool_currency: String,
    pub(crate) shared_constraint_identities: Vec<String>,
    pub(crate) adapter_binding_identity: String,
    pub(crate) proof_frontier_identity: String,
    pub(crate) proof_valid_through_epoch_ms: u64,
}

/// Execution's own current PAPER adapter binding, as its read API returns it.
///
/// The read function strips the credential handle, so Governance never learns it. The scope binds
/// the adapter binding fact identity instead, and Execution resolves the handle at effect time.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AdmittedAdapterBindingFact {
    pub(crate) fact_identity: String,
    pub(crate) state: String,
    pub(crate) mode: String,
    pub(crate) generation: u64,
    pub(crate) execution_scope_identity: String,
    pub(crate) account_namespace: String,
    pub(crate) effect_namespace: String,
    pub(crate) endpoint_identity: String,
    pub(crate) implementation_digest: String,
    pub(crate) configuration_digest: String,
    pub(crate) trust_policy_identity: String,
    pub(crate) reduce_only_policy: String,
    pub(crate) capabilities: Vec<String>,
    pub(crate) effective_at_epoch_ms: u64,
    pub(crate) exclusive_valid_through_epoch_ms: u64,
}

/// Owner-trusted decision time for one prebinding attempt.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ExecutionScopeDecisionTime {
    /// When this Owner sampled its own clock for this attempt.
    pub(crate) observed_at_epoch_ms: u64,
    /// When the scope was first created, which a replay carries forward unchanged.
    pub(crate) created_at_epoch_ms: u64,
}

/// Applies the complete prebinding rule and seals a scope, or names every disagreement.
///
/// The rule is the documented one: the two source Owners must agree on account, mode, effect
/// namespace, endpoint, capabilities, valid-through, and shared-constraint partition, and the
/// caller's expectations must match what the Owners actually said. Every failure is collected, so
/// one call names all of them rather than only the first.
pub(crate) fn seal_execution_scope(
    request: &UntrustedExecutionScopeRequest,
    capacity: &BoundCapacityScopeFact,
    binding: &AdmittedAdapterBindingFact,
    decision_time: ExecutionScopeDecisionTime,
) -> Result<GovernedExecutionScope, Vec<ExecutionScopePrebindingFailure>> {
    let mut failures = Vec::new();

    if capacity.state != "BOUND" {
        failures.push(ExecutionScopePrebindingFailure::CapacityScopeNotBound);
    }

    if capacity.mode != "PAPER" {
        failures.push(ExecutionScopePrebindingFailure::CapacityScopeModeNotPaper);
    }

    if binding.state != "ADMITTED" {
        failures.push(ExecutionScopePrebindingFailure::AdapterBindingNotAdmitted);
    }

    if binding.mode != "PAPER" {
        failures.push(ExecutionScopePrebindingFailure::AdapterBindingModeNotPaper);
    }

    // Owner against Owner: the two source facts must describe the same account and the same
    // prebinding, or the Capacity Scope was bound to an adapter Execution did not admit here.
    if capacity.account_namespace != binding.account_namespace {
        failures.push(ExecutionScopePrebindingFailure::AccountNamespaceDisagreement);
    }

    if capacity.adapter_binding_identity != binding.fact_identity {
        failures.push(ExecutionScopePrebindingFailure::AdapterBindingPrebindingConflict);
    }

    // Execution already enforces that a binding's effect namespace is the one derived from its
    // own Execution Scope identity, so Governance verifies the scope rather than re-deriving the
    // namespace. A second copy of that derivation here would be a rule that can drift.
    if binding.execution_scope_identity != request.execution_scope_identity {
        failures.push(ExecutionScopePrebindingFailure::AdapterBindingScopeDisagreement);
    }

    // Caller against Owner: an expectation the caller got wrong creates no scope, so a stale
    // Product Edge form can never silently bind a different account or a different adapter.
    if capacity.capacity_scope_identity != request.expected_capacity_scope_identity {
        failures.push(ExecutionScopePrebindingFailure::CapacityScopeIdentityMismatch);
    }

    if capacity.account_namespace != request.expected_account_namespace {
        failures.push(ExecutionScopePrebindingFailure::ExpectedAccountNamespaceMismatch);
    }

    if capacity.economic_pool_identity != request.expected_economic_pool_identity {
        failures.push(ExecutionScopePrebindingFailure::ExpectedEconomicPoolMismatch);
    }

    if binding.endpoint_identity != request.expected_endpoint_identity {
        failures.push(ExecutionScopePrebindingFailure::ExpectedEndpointMismatch);
    }

    if binding.capabilities != request.expected_capabilities {
        failures.push(ExecutionScopePrebindingFailure::ExpectedCapabilitiesMismatch);
    }

    if capacity.shared_constraint_identities != request.expected_shared_constraint_identities {
        failures.push(ExecutionScopePrebindingFailure::ExpectedSharedConstraintPartitionMismatch);
    }

    // Validity: the scope may not outlive either source fact, and neither may be in the future.
    let valid_through = capacity
        .proof_valid_through_epoch_ms
        .min(binding.exclusive_valid_through_epoch_ms);

    if valid_through <= decision_time.observed_at_epoch_ms {
        failures.push(ExecutionScopePrebindingFailure::SourceFactExpired);
    }

    if binding.effective_at_epoch_ms > decision_time.observed_at_epoch_ms {
        failures.push(ExecutionScopePrebindingFailure::SourceFactNotYetEffective);
    }

    if !failures.is_empty() {
        return Err(failures);
    }
    let scope_digest = derive_scope_digest(capacity, binding);
    Ok(GovernedExecutionScope {
        schema_version: GOVERNED_EXECUTION_SCOPE_SCHEMA_V1,
        fingerprint: fingerprint_of(request),
        maturity: GovernedExecutionScopeMaturity::OwnerLocalPostgresCustodyNotDeploymentAdmission,
        scope_identity: binding.execution_scope_identity.clone(),
        scope_digest,
        mode: GovernedExecutionScopeMode::Paper,
        account_namespace: capacity.account_namespace.clone(),
        effect_namespace: binding.effect_namespace.clone(),
        capacity_scope_identity: capacity.capacity_scope_identity.clone(),
        economic_pool_identity: capacity.economic_pool_identity.clone(),
        economic_pool_currency: capacity.economic_pool_currency.clone(),
        shared_constraint_identities: capacity.shared_constraint_identities.clone(),
        adapter_binding_fact_identity: binding.fact_identity.clone(),
        adapter_binding_generation: binding.generation,
        adapter_implementation_digest: binding.implementation_digest.clone(),
        adapter_configuration_digest: binding.configuration_digest.clone(),
        trust_policy_identity: binding.trust_policy_identity.clone(),
        reduce_only_policy: binding.reduce_only_policy.clone(),
        endpoint_identity: binding.endpoint_identity.clone(),
        capabilities: binding.capabilities.clone(),
        portfolio_proof_frontier_identity: capacity.proof_frontier_identity.clone(),
        created_at_epoch_ms: decision_time.created_at_epoch_ms,
        valid_through_epoch_ms: valid_through,
    })
}

/// Builds the structured refusal for a prebinding that binds nothing.
pub(crate) fn unavailable_readback(
    request: &UntrustedExecutionScopeRequest,
    failures: Vec<ExecutionScopePrebindingFailure>,
) -> UnavailableExecutionScopeReadback {
    UnavailableExecutionScopeReadback {
        schema_version: GOVERNED_EXECUTION_SCOPE_SCHEMA_V1,
        fingerprint: fingerprint_of(request),
        maturity: GovernedExecutionScopeMaturity::OwnerLocalPostgresCustodyNotDeploymentAdmission,
        failures,
    }
}

fn fingerprint_of(request: &UntrustedExecutionScopeRequest) -> ExecutionScopeRequestFingerprint {
    let capabilities = request.expected_capabilities.join(",");
    let semantic_digest = Digest::of_domain_fields(
        "governance-execution-scope-request-v1",
        &[
            &request.request_identity,
            &request.capacity_scope_request_identity,
            &request.execution_scope_identity,
            &request.expected_capacity_scope_identity,
            &request.expected_account_namespace,
            &request.expected_economic_pool_identity,
            &request.expected_endpoint_identity,
            &capabilities,
            &request.expected_shared_constraint_identities.join(","),
        ],
    );
    ExecutionScopeRequestFingerprint {
        request_identity: request.request_identity.clone(),
        semantic_digest: semantic_digest.to_hex(),
    }
}

/// Derives the scope digest from the bound meaning alone.
///
/// The caller's request identity is deliberately excluded: two requests that bind exactly the same
/// two source facts describe the same scope and must agree on its digest.
fn derive_scope_digest(
    capacity: &BoundCapacityScopeFact,
    binding: &AdmittedAdapterBindingFact,
) -> String {
    let generation = binding.generation.to_string();
    let constraints = capacity.shared_constraint_identities.join(",");
    let capabilities = binding.capabilities.join(",");
    Digest::of_domain_fields(
        "governance-execution-scope-meaning-v1",
        &[
            &binding.execution_scope_identity,
            "PAPER",
            &capacity.capacity_scope_identity,
            &capacity.account_namespace,
            &capacity.economic_pool_identity,
            &capacity.economic_pool_currency,
            &constraints,
            &binding.fact_identity,
            &generation,
            &binding.effect_namespace,
            &binding.endpoint_identity,
            &binding.implementation_digest,
            &binding.configuration_digest,
            &binding.trust_policy_identity,
            &binding.reduce_only_policy,
            &capabilities,
        ],
    )
    .to_hex()
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn request() -> UntrustedExecutionScopeRequest {
        UntrustedExecutionScopeRequest {
            request_identity: "scope-request-alpha".to_string(),
            capacity_scope_request_identity: "capacity-request-alpha".to_string(),
            execution_scope_identity: "execution-scope-alpha".to_string(),
            expected_capacity_scope_identity: "capacity-scope-alpha".to_string(),
            expected_account_namespace: "paper-account-alpha".to_string(),
            expected_economic_pool_identity: "pool-alpha".to_string(),
            expected_endpoint_identity: "simulator-alpha".to_string(),
            expected_capabilities: vec!["SUBMIT_ORDER".to_string(), "CANCEL_ORDER".to_string()],
            expected_shared_constraint_identities: vec!["constraint-alpha".to_string()],
        }
    }

    fn capacity() -> BoundCapacityScopeFact {
        BoundCapacityScopeFact {
            state: "BOUND".to_string(),
            mode: "PAPER".to_string(),
            capacity_scope_identity: "capacity-scope-alpha".to_string(),
            account_namespace: "paper-account-alpha".to_string(),
            economic_pool_identity: "pool-alpha".to_string(),
            economic_pool_currency: "USD".to_string(),
            shared_constraint_identities: vec!["constraint-alpha".to_string()],
            adapter_binding_identity: "binding-fact-alpha".to_string(),
            proof_frontier_identity: "frontier-alpha".to_string(),
            proof_valid_through_epoch_ms: 4_000,
        }
    }

    fn binding() -> AdmittedAdapterBindingFact {
        AdmittedAdapterBindingFact {
            fact_identity: "binding-fact-alpha".to_string(),
            state: "ADMITTED".to_string(),
            mode: "PAPER".to_string(),
            generation: 1,
            execution_scope_identity: "execution-scope-alpha".to_string(),
            account_namespace: "paper-account-alpha".to_string(),
            effect_namespace: "paper.effects.v1.0f".to_string(),
            endpoint_identity: "simulator-alpha".to_string(),
            implementation_digest: "sha256:impl".to_string(),
            configuration_digest: "sha256:config".to_string(),
            trust_policy_identity: "trust-alpha".to_string(),
            reduce_only_policy: "REDUCE_ONLY_DISABLED".to_string(),
            capabilities: vec!["SUBMIT_ORDER".to_string(), "CANCEL_ORDER".to_string()],
            effective_at_epoch_ms: 1_000,
            exclusive_valid_through_epoch_ms: 5_000,
        }
    }

    const NOW: ExecutionScopeDecisionTime = ExecutionScopeDecisionTime {
        observed_at_epoch_ms: 2_000,
        created_at_epoch_ms: 2_000,
    };

    #[rstest]
    fn agreeing_owners_seal_a_scope_bounded_by_the_earlier_source_fact() {
        let sealed = seal_execution_scope(&request(), &capacity(), &binding(), NOW).unwrap();
        assert_eq!(sealed.scope_identity(), "execution-scope-alpha");
        assert_eq!(sealed.adapter_binding_fact_identity(), "binding-fact-alpha");
        assert_eq!(sealed.valid_through_epoch_ms(), 4_000);
        assert_eq!(
            sealed.effect_namespace(),
            "paper.effects.v1.0f",
            "the scope records Execution's own effect namespace verbatim"
        );
    }

    #[rstest]
    fn a_capacity_scope_bound_to_another_adapter_creates_no_scope() {
        let mut capacity = capacity();
        capacity.adapter_binding_identity = "binding-fact-other".to_string();
        let failures = seal_execution_scope(&request(), &capacity, &binding(), NOW).unwrap_err();
        assert_eq!(
            failures,
            vec![ExecutionScopePrebindingFailure::AdapterBindingPrebindingConflict]
        );
    }

    #[rstest]
    fn every_disagreement_is_named_rather_than_only_the_first() {
        let mut capacity = capacity();
        capacity.account_namespace = "paper-account-other".to_string();
        capacity.adapter_binding_identity = "binding-fact-other".to_string();
        let failures = seal_execution_scope(&request(), &capacity, &binding(), NOW).unwrap_err();
        assert_eq!(
            failures,
            vec![
                ExecutionScopePrebindingFailure::AccountNamespaceDisagreement,
                ExecutionScopePrebindingFailure::AdapterBindingPrebindingConflict,
                ExecutionScopePrebindingFailure::ExpectedAccountNamespaceMismatch,
            ]
        );
    }

    #[rstest]
    fn an_expired_source_fact_creates_no_scope() {
        let mut binding = binding();
        binding.exclusive_valid_through_epoch_ms = 2_000;
        let failures = seal_execution_scope(&request(), &capacity(), &binding, NOW).unwrap_err();
        assert_eq!(
            failures,
            vec![ExecutionScopePrebindingFailure::SourceFactExpired]
        );
    }

    #[rstest]
    fn a_replay_keeps_the_original_creation_time_and_refreshes_the_validity_bound() {
        let mut later = binding();
        later.exclusive_valid_through_epoch_ms = 9_000;
        let replayed = seal_execution_scope(
            &request(),
            &capacity(),
            &later,
            ExecutionScopeDecisionTime {
                observed_at_epoch_ms: 3_000,
                created_at_epoch_ms: 2_000,
            },
        )
        .unwrap();
        assert_eq!(replayed.created_at_epoch_ms(), 2_000);
        assert_eq!(replayed.valid_through_epoch_ms(), 4_000);
        assert_eq!(
            replayed.scope_digest(),
            seal_execution_scope(&request(), &capacity(), &binding(), NOW)
                .unwrap()
                .scope_digest(),
            "freshness is not part of the bound meaning"
        );
    }

    #[rstest]
    fn scope_identity_ignores_the_request_identity_but_the_fingerprint_does_not() {
        let first = seal_execution_scope(&request(), &capacity(), &binding(), NOW).unwrap();
        let mut replayed = request();
        replayed.request_identity = "scope-request-beta".to_string();
        let second = seal_execution_scope(&replayed, &capacity(), &binding(), NOW).unwrap();
        assert_eq!(first.scope_digest(), second.scope_digest());
        assert_ne!(
            first.fingerprint().semantic_digest(),
            second.fingerprint().semantic_digest()
        );
    }

    #[rstest]
    fn a_new_adapter_binding_generation_changes_the_scope_digest() {
        let first = seal_execution_scope(&request(), &capacity(), &binding(), NOW).unwrap();
        let mut regenerated = binding();
        regenerated.generation = 2;
        regenerated.fact_identity = "binding-fact-beta".to_string();
        let mut capacity = capacity();
        capacity.adapter_binding_identity = "binding-fact-beta".to_string();
        let second = seal_execution_scope(&request(), &capacity, &regenerated, NOW).unwrap();
        assert_ne!(first.scope_digest(), second.scope_digest());
    }

    #[rstest]
    fn an_empty_identity_is_not_well_formed() {
        let mut request = request();
        request.expected_economic_pool_identity = String::new();
        assert!(!request.well_formed());
    }
}
