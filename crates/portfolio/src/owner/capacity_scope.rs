//! Sealed Portfolio Owner Capacity Scope contract.
//!
//! Capacity Scope precedes an Execution Scope. Public callers may request an exact readback, but
//! their identities, grants, DTOs, and overlap claims never mint `BOUND` authority. This Discovery
//! slice keeps the production Owner resolver unavailable while defining the private complete-registry
//! path that alone can seal [`BoundCapacityScopeReadback`].

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use super::portfolio_view::sha256_hex;

const REQUEST_DIGEST_DOMAIN: &[u8] = b"vibe.portfolio.capacity-scope.request.v1\0";
const SCOPE_IDENTITY_DOMAIN: &[u8] = b"vibe.portfolio.capacity-scope.identity.v1\0";
const REGISTRY_CUT_DOMAIN: &[u8] = b"vibe.portfolio.capacity-scope.registry-cut.v1\0";
const MEMBERSHIP_PROOF_DOMAIN: &[u8] = b"vibe.portfolio.capacity-scope.membership-proof.v1\0";

/// Schema version for the Portfolio Capacity Scope contract.
pub const CAPACITY_SCOPE_SCHEMA_VERSION: u32 = 1;

/// Execution mode isolated by every Capacity Scope identity.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CapacityScopeMode {
    /// Simulated execution namespace.
    Paper,
    /// Production execution namespace. This contract grants no LIVE authority.
    Live,
}

/// State sealed by Portfolio after exact complete-registry resolution.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CapacityScopeState {
    /// The immutable account, mode, economic pool, and disjoint membership are bound.
    Bound,
}

/// Explicit maturity of this owner-only contract slice.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CapacityScopeMaturity {
    /// Static owner contract without production composition or consumer acceptance.
    Discovery,
}

/// Exact identity coordinate checked against Portfolio's private registry cut.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CapacityScopeIdentityField {
    /// Owner-derived Capacity Scope identity.
    CapacityScope,
    /// Complete Portfolio registry cut identity.
    RegistryCut,
    /// Deployment source binding identity.
    SourceBinding,
    /// Deployment adapter binding identity.
    AdapterBinding,
    /// Complete-set disjoint membership proof identity.
    MembershipProof,
    /// Owner proof frontier identity.
    ProofFrontier,
    /// Owner proof frontier sequence.
    ProofFrontierSequence,
    /// Owner-derived decision time.
    DecisionTime,
}

/// Typed but entirely untrusted Capacity Scope request.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UntrustedCapacityScopeRequest {
    /// Exact request schema version.
    pub schema_version: u32,
    /// Stable caller request identity.
    pub request_identity: String,
    /// Requested account namespace.
    pub account_namespace: String,
    /// Requested PAPER/LIVE mode.
    pub mode: CapacityScopeMode,
    /// Requested candidate-neutral economic pool.
    pub economic_pool_identity: String,
    /// Expected Owner-derived Capacity Scope identity.
    pub expected_capacity_scope_identity: String,
    /// Expected complete Portfolio registry cut.
    pub expected_registry_cut_identity: String,
    /// Expected deployment source binding.
    pub expected_source_binding_identity: String,
    /// Expected deployment adapter binding.
    pub expected_adapter_binding_identity: String,
    /// Expected complete-set disjoint membership proof.
    pub expected_membership_proof_identity: String,
    /// Expected Owner proof frontier.
    pub expected_proof_frontier_identity: String,
    /// Expected positive Owner proof sequence.
    pub expected_proof_frontier_sequence: u64,
    /// Decision time at which the proof must be current.
    pub projection_at_epoch_ms: u64,
}

impl UntrustedCapacityScopeRequest {
    /// Returns the stable request identity and deterministic semantic digest.
    #[must_use]
    pub fn fingerprint(&self) -> CapacityScopeRequestFingerprint {
        CapacityScopeRequestFingerprint {
            request_identity: self.request_identity.clone(),
            semantic_digest: format!("sha256:{}", sha256_hex(&canonical_request_bytes(self))),
        }
    }
}

/// Stable request identity and digest echoed by every resolution.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct CapacityScopeRequestFingerprint {
    request_identity: String,
    semantic_digest: String,
}

impl CapacityScopeRequestFingerprint {
    /// Stable caller request identity.
    #[must_use]
    pub fn request_identity(&self) -> &str {
        &self.request_identity
    }

    /// Digest over every request identity, scope, binding, frontier, and time field.
    #[must_use]
    pub fn semantic_digest(&self) -> &str {
        &self.semantic_digest
    }
}

/// Structured reason Portfolio withheld a `BOUND` Capacity Scope.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "reason", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CapacityScopeFailure {
    /// Request schema version is unsupported.
    UnsupportedSchemaVersion { actual: u32 },
    /// A request or Owner registry identity is malformed.
    InvalidField { field: String },
    /// A proof frontier sequence is zero.
    InvalidProofFrontierSequence,
    /// The private Owner registry does not assert a complete membership cut.
    MembershipUnknown,
    /// The requested account/mode/pool has no unique Owner membership.
    ScopeMembershipUnknown,
    /// One shared constraint occurs in more than one Capacity Scope.
    SharedConstraintOverlap { constraint_identity: String },
    /// The Owner proof is future-dated or no longer current.
    ProofStale,
    /// A caller expectation differs from the Owner-derived identity.
    IdentityMismatch { field: CapacityScopeIdentityField },
    /// The production private Owner resolver is not composed at Discovery maturity.
    OwnerResolveUnavailable,
}

/// Explicit response from the public, always-unavailable Discovery resolver.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct UnavailableCapacityScopeReadback {
    schema_version: u32,
    fingerprint: CapacityScopeRequestFingerprint,
    maturity: CapacityScopeMaturity,
    failures: Vec<CapacityScopeFailure>,
}

impl UnavailableCapacityScopeReadback {
    /// Contract schema version.
    #[must_use]
    pub const fn schema_version(&self) -> u32 {
        self.schema_version
    }

    /// Exact untrusted request identity and digest.
    #[must_use]
    pub const fn fingerprint(&self) -> &CapacityScopeRequestFingerprint {
        &self.fingerprint
    }

    /// Explicit non-AVAILABLE maturity.
    #[must_use]
    pub const fn maturity(&self) -> CapacityScopeMaturity {
        self.maturity
    }

    /// Structured fail-closed reasons.
    #[must_use]
    pub fn failures(&self) -> &[CapacityScopeFailure] {
        &self.failures
    }
}

/// Portfolio-sealed immutable `BOUND` Capacity Scope readback.
///
/// The type has private fields, no public constructor, no `Default`, and no `Deserialize`.
/// A caller cannot mint it from a grant, DTO, fixture, or self-report.
///
/// ```compile_fail
/// use vibe_portfolio::owner::capacity_scope::BoundCapacityScopeReadback;
///
/// let forged = BoundCapacityScopeReadback {};
/// ```
///
/// ```compile_fail
/// use serde::Deserialize;
/// use vibe_portfolio::owner::capacity_scope::BoundCapacityScopeReadback;
///
/// fn require_deserialize<T: for<'de> Deserialize<'de>>() {}
/// require_deserialize::<BoundCapacityScopeReadback>();
/// ```
///
/// ```compile_fail
/// use vibe_portfolio::owner::capacity_scope::BoundCapacityScopeReadback;
///
/// let forged = BoundCapacityScopeReadback::default();
/// ```
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct BoundCapacityScopeReadback {
    schema_version: u32,
    fingerprint: CapacityScopeRequestFingerprint,
    state: CapacityScopeState,
    maturity: CapacityScopeMaturity,
    capacity_scope_identity: String,
    account_namespace: String,
    mode: CapacityScopeMode,
    economic_pool_identity: String,
    registry_cut_identity: String,
    source_binding_identity: String,
    adapter_binding_identity: String,
    membership_proof_identity: String,
    proof_frontier_identity: String,
    proof_frontier_sequence: u64,
    proof_observed_at_epoch_ms: u64,
    proof_valid_through_epoch_ms: u64,
}

impl BoundCapacityScopeReadback {
    /// Contract schema version.
    #[must_use]
    pub const fn schema_version(&self) -> u32 {
        self.schema_version
    }

    /// Exact request identity and digest resolved by Portfolio.
    #[must_use]
    pub const fn fingerprint(&self) -> &CapacityScopeRequestFingerprint {
        &self.fingerprint
    }

    /// Immutable binding state.
    #[must_use]
    pub const fn state(&self) -> CapacityScopeState {
        self.state
    }

    /// Explicit non-AVAILABLE maturity.
    #[must_use]
    pub const fn maturity(&self) -> CapacityScopeMaturity {
        self.maturity
    }

    /// Owner-derived Capacity Scope identity.
    #[must_use]
    pub fn capacity_scope_identity(&self) -> &str {
        &self.capacity_scope_identity
    }

    /// Bound account namespace.
    #[must_use]
    pub fn account_namespace(&self) -> &str {
        &self.account_namespace
    }

    /// Bound PAPER/LIVE mode.
    #[must_use]
    pub const fn mode(&self) -> CapacityScopeMode {
        self.mode
    }

    /// Bound candidate-neutral economic pool.
    #[must_use]
    pub fn economic_pool_identity(&self) -> &str {
        &self.economic_pool_identity
    }

    /// Exact complete Portfolio registry cut.
    #[must_use]
    pub fn registry_cut_identity(&self) -> &str {
        &self.registry_cut_identity
    }

    /// Exact deployment source binding.
    #[must_use]
    pub fn source_binding_identity(&self) -> &str {
        &self.source_binding_identity
    }

    /// Exact deployment adapter binding.
    #[must_use]
    pub fn adapter_binding_identity(&self) -> &str {
        &self.adapter_binding_identity
    }

    /// Complete-set disjoint shared-constraint proof identity.
    #[must_use]
    pub fn membership_proof_identity(&self) -> &str {
        &self.membership_proof_identity
    }

    /// Exact proof frontier identity.
    #[must_use]
    pub fn proof_frontier_identity(&self) -> &str {
        &self.proof_frontier_identity
    }

    /// Positive proof frontier sequence.
    #[must_use]
    pub const fn proof_frontier_sequence(&self) -> u64 {
        self.proof_frontier_sequence
    }

    /// Owner proof observation time.
    #[must_use]
    pub const fn proof_observed_at_epoch_ms(&self) -> u64 {
        self.proof_observed_at_epoch_ms
    }

    /// Exclusive Owner proof validity bound.
    #[must_use]
    pub const fn proof_valid_through_epoch_ms(&self) -> u64 {
        self.proof_valid_through_epoch_ms
    }
}

/// Result of resolving an untrusted Capacity Scope request.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "resolution", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CapacityScopeResolution {
    /// Owner-sealed readback, unreachable from the public Discovery resolver.
    Bound(Box<BoundCapacityScopeReadback>),
    /// Explicit fail-closed response.
    Unavailable(UnavailableCapacityScopeReadback),
}

/// Resolves an untrusted request through the public Discovery boundary.
///
/// The production private Owner registry resolver is intentionally not composed, so caller-selected
/// identities can never produce [`CapacityScopeResolution::Bound`].
#[must_use]
pub fn resolve_capacity_scope(request: &UntrustedCapacityScopeRequest) -> CapacityScopeResolution {
    let mut failures = validate_request(request);
    failures.push(CapacityScopeFailure::OwnerResolveUnavailable);
    CapacityScopeResolution::Unavailable(UnavailableCapacityScopeReadback {
        schema_version: CAPACITY_SCOPE_SCHEMA_VERSION,
        fingerprint: request.fingerprint(),
        maturity: CapacityScopeMaturity::Discovery,
        failures,
    })
}

#[allow(
    dead_code,
    reason = "Unknown is a required fail-closed Owner state before production composition exists"
)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OwnerMembershipCompleteness {
    Complete,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct OwnerCapacityScopeDefinition {
    account_namespace: String,
    mode: CapacityScopeMode,
    economic_pool_identity: String,
    source_binding_identity: String,
    adapter_binding_identity: String,
    shared_constraint_identities: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct OwnerCapacityScopeRegistryCut {
    completeness: OwnerMembershipCompleteness,
    proof_frontier_identity: String,
    proof_frontier_sequence: u64,
    observed_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
    definitions: Vec<OwnerCapacityScopeDefinition>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct OwnerCapacityScopeDecisionTime {
    projection_at_epoch_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CanonicalOwnerBinding<'a> {
    definition: &'a OwnerCapacityScopeDefinition,
    capacity_scope_identity: String,
    registry_cut_identity: String,
    membership_proof_identity: String,
}

#[allow(
    dead_code,
    reason = "Discovery defines the crate-private owner path before production composition exists"
)]
fn issue_bound_capacity_scope(
    request: &UntrustedCapacityScopeRequest,
    registry: &OwnerCapacityScopeRegistryCut,
    decision_time: OwnerCapacityScopeDecisionTime,
) -> Result<BoundCapacityScopeReadback, CapacityScopeFailure> {
    if let Some(failure) = validate_request(request).into_iter().next() {
        return Err(failure);
    }

    let binding = canonical_owner_binding(request, registry, decision_time)?;

    for (field, matches_owner) in [
        (
            CapacityScopeIdentityField::CapacityScope,
            request.expected_capacity_scope_identity == binding.capacity_scope_identity,
        ),
        (
            CapacityScopeIdentityField::RegistryCut,
            request.expected_registry_cut_identity == binding.registry_cut_identity,
        ),
        (
            CapacityScopeIdentityField::SourceBinding,
            request.expected_source_binding_identity == binding.definition.source_binding_identity,
        ),
        (
            CapacityScopeIdentityField::AdapterBinding,
            request.expected_adapter_binding_identity
                == binding.definition.adapter_binding_identity,
        ),
        (
            CapacityScopeIdentityField::MembershipProof,
            request.expected_membership_proof_identity == binding.membership_proof_identity,
        ),
        (
            CapacityScopeIdentityField::ProofFrontier,
            request.expected_proof_frontier_identity == registry.proof_frontier_identity,
        ),
        (
            CapacityScopeIdentityField::ProofFrontierSequence,
            request.expected_proof_frontier_sequence == registry.proof_frontier_sequence,
        ),
        (
            CapacityScopeIdentityField::DecisionTime,
            request.projection_at_epoch_ms == decision_time.projection_at_epoch_ms,
        ),
    ] {
        if !matches_owner {
            return Err(CapacityScopeFailure::IdentityMismatch { field });
        }
    }

    Ok(BoundCapacityScopeReadback {
        schema_version: CAPACITY_SCOPE_SCHEMA_VERSION,
        fingerprint: request.fingerprint(),
        state: CapacityScopeState::Bound,
        maturity: CapacityScopeMaturity::Discovery,
        capacity_scope_identity: binding.capacity_scope_identity,
        account_namespace: binding.definition.account_namespace.clone(),
        mode: binding.definition.mode,
        economic_pool_identity: binding.definition.economic_pool_identity.clone(),
        registry_cut_identity: binding.registry_cut_identity,
        source_binding_identity: binding.definition.source_binding_identity.clone(),
        adapter_binding_identity: binding.definition.adapter_binding_identity.clone(),
        membership_proof_identity: binding.membership_proof_identity,
        proof_frontier_identity: registry.proof_frontier_identity.clone(),
        proof_frontier_sequence: registry.proof_frontier_sequence,
        proof_observed_at_epoch_ms: registry.observed_at_epoch_ms,
        proof_valid_through_epoch_ms: registry.valid_through_epoch_ms,
    })
}

fn canonical_owner_binding<'a>(
    request: &UntrustedCapacityScopeRequest,
    registry: &'a OwnerCapacityScopeRegistryCut,
    decision_time: OwnerCapacityScopeDecisionTime,
) -> Result<CanonicalOwnerBinding<'a>, CapacityScopeFailure> {
    validate_registry(registry, decision_time.projection_at_epoch_ms)?;

    let mut matches = registry.definitions.iter().filter(|definition| {
        definition.account_namespace == request.account_namespace
            && definition.mode == request.mode
            && definition.economic_pool_identity == request.economic_pool_identity
    });
    let Some(definition) = matches.next() else {
        return Err(CapacityScopeFailure::ScopeMembershipUnknown);
    };

    if matches.next().is_some() {
        return Err(CapacityScopeFailure::ScopeMembershipUnknown);
    }

    Ok(CanonicalOwnerBinding {
        definition,
        capacity_scope_identity: derive_scope_identity(definition),
        registry_cut_identity: derive_registry_cut_identity(registry),
        membership_proof_identity: derive_membership_proof_identity(registry),
    })
}

fn validate_registry(
    registry: &OwnerCapacityScopeRegistryCut,
    projection_at_epoch_ms: u64,
) -> Result<(), CapacityScopeFailure> {
    if registry.completeness != OwnerMembershipCompleteness::Complete {
        return Err(CapacityScopeFailure::MembershipUnknown);
    }

    if registry.proof_frontier_sequence == 0 {
        return Err(CapacityScopeFailure::InvalidProofFrontierSequence);
    }

    if !valid_identifier(&registry.proof_frontier_identity) {
        return Err(CapacityScopeFailure::InvalidField {
            field: "owner.proof_frontier_identity".to_string(),
        });
    }

    if registry.observed_at_epoch_ms > projection_at_epoch_ms
        || projection_at_epoch_ms >= registry.valid_through_epoch_ms
        || registry.observed_at_epoch_ms >= registry.valid_through_epoch_ms
    {
        return Err(CapacityScopeFailure::ProofStale);
    }

    if registry.definitions.is_empty() {
        return Err(CapacityScopeFailure::MembershipUnknown);
    }

    let mut scope_identities = BTreeSet::new();
    let mut constraint_membership = BTreeMap::new();

    for definition in &registry.definitions {
        validate_definition(definition)?;
        let scope_identity = derive_scope_identity(definition);
        if !scope_identities.insert(scope_identity.clone()) {
            return Err(CapacityScopeFailure::ScopeMembershipUnknown);
        }

        for constraint_identity in &definition.shared_constraint_identities {
            if constraint_membership
                .insert(constraint_identity.clone(), scope_identity.clone())
                .is_some()
            {
                return Err(CapacityScopeFailure::SharedConstraintOverlap {
                    constraint_identity: constraint_identity.clone(),
                });
            }
        }
    }
    Ok(())
}

fn validate_definition(
    definition: &OwnerCapacityScopeDefinition,
) -> Result<(), CapacityScopeFailure> {
    for (field, value) in [
        ("owner.account_namespace", &definition.account_namespace),
        (
            "owner.economic_pool_identity",
            &definition.economic_pool_identity,
        ),
        (
            "owner.source_binding_identity",
            &definition.source_binding_identity,
        ),
        (
            "owner.adapter_binding_identity",
            &definition.adapter_binding_identity,
        ),
    ] {
        if !valid_identifier(value) {
            return Err(CapacityScopeFailure::InvalidField {
                field: field.to_string(),
            });
        }
    }

    for constraint_identity in &definition.shared_constraint_identities {
        if !valid_identifier(constraint_identity) {
            return Err(CapacityScopeFailure::InvalidField {
                field: "owner.shared_constraint_identity".to_string(),
            });
        }
    }
    Ok(())
}

fn validate_request(request: &UntrustedCapacityScopeRequest) -> Vec<CapacityScopeFailure> {
    let mut failures = Vec::new();
    if request.schema_version != CAPACITY_SCOPE_SCHEMA_VERSION {
        failures.push(CapacityScopeFailure::UnsupportedSchemaVersion {
            actual: request.schema_version,
        });
    }

    for (field, value) in [
        ("request_identity", &request.request_identity),
        ("account_namespace", &request.account_namespace),
        ("economic_pool_identity", &request.economic_pool_identity),
        (
            "expected_capacity_scope_identity",
            &request.expected_capacity_scope_identity,
        ),
        (
            "expected_registry_cut_identity",
            &request.expected_registry_cut_identity,
        ),
        (
            "expected_source_binding_identity",
            &request.expected_source_binding_identity,
        ),
        (
            "expected_adapter_binding_identity",
            &request.expected_adapter_binding_identity,
        ),
        (
            "expected_membership_proof_identity",
            &request.expected_membership_proof_identity,
        ),
        (
            "expected_proof_frontier_identity",
            &request.expected_proof_frontier_identity,
        ),
    ] {
        if !valid_identifier(value) {
            failures.push(CapacityScopeFailure::InvalidField {
                field: field.to_string(),
            });
        }
    }

    if request.expected_proof_frontier_sequence == 0 {
        failures.push(CapacityScopeFailure::InvalidProofFrontierSequence);
    }
    failures
}

fn derive_scope_identity(definition: &OwnerCapacityScopeDefinition) -> String {
    let mut encoder = CanonicalEncoder::default();
    encoder.bytes(SCOPE_IDENTITY_DOMAIN);
    encoder.string(&definition.account_namespace);
    encoder.u8(mode_tag(definition.mode));
    encoder.string(&definition.economic_pool_identity);
    format!("sha256:{}", sha256_hex(&encoder.finish()))
}

fn derive_registry_cut_identity(registry: &OwnerCapacityScopeRegistryCut) -> String {
    let mut encoder = CanonicalEncoder::default();
    encoder.bytes(REGISTRY_CUT_DOMAIN);
    encode_registry_header(&mut encoder, registry);
    for definition in canonical_definitions(registry) {
        encode_definition(&mut encoder, definition);
    }
    format!("sha256:{}", sha256_hex(&encoder.finish()))
}

fn derive_membership_proof_identity(registry: &OwnerCapacityScopeRegistryCut) -> String {
    let mut encoder = CanonicalEncoder::default();
    encoder.bytes(MEMBERSHIP_PROOF_DOMAIN);
    encode_registry_header(&mut encoder, registry);
    for definition in canonical_definitions(registry) {
        encoder.string(&derive_scope_identity(definition));
        let mut constraints = definition.shared_constraint_identities.clone();
        constraints.sort();
        encoder.u64(constraints.len() as u64);
        for constraint in constraints {
            encoder.string(&constraint);
        }
    }
    format!("sha256:{}", sha256_hex(&encoder.finish()))
}

fn canonical_definitions(
    registry: &OwnerCapacityScopeRegistryCut,
) -> Vec<&OwnerCapacityScopeDefinition> {
    let mut definitions = registry.definitions.iter().collect::<Vec<_>>();
    definitions.sort_by(|left, right| {
        (
            &left.account_namespace,
            left.mode,
            &left.economic_pool_identity,
        )
            .cmp(&(
                &right.account_namespace,
                right.mode,
                &right.economic_pool_identity,
            ))
    });
    definitions
}

fn encode_registry_header(
    encoder: &mut CanonicalEncoder,
    registry: &OwnerCapacityScopeRegistryCut,
) {
    encoder.u8(match registry.completeness {
        OwnerMembershipCompleteness::Complete => 1,
        OwnerMembershipCompleteness::Unknown => 2,
    });
    encoder.string(&registry.proof_frontier_identity);
    encoder.u64(registry.proof_frontier_sequence);
    encoder.u64(registry.observed_at_epoch_ms);
    encoder.u64(registry.valid_through_epoch_ms);
    encoder.u64(registry.definitions.len() as u64);
}

fn encode_definition(encoder: &mut CanonicalEncoder, definition: &OwnerCapacityScopeDefinition) {
    encoder.string(&definition.account_namespace);
    encoder.u8(mode_tag(definition.mode));
    encoder.string(&definition.economic_pool_identity);
    encoder.string(&definition.source_binding_identity);
    encoder.string(&definition.adapter_binding_identity);
    let mut constraints = definition.shared_constraint_identities.clone();
    constraints.sort();
    encoder.u64(constraints.len() as u64);
    for constraint in constraints {
        encoder.string(&constraint);
    }
}

fn canonical_request_bytes(request: &UntrustedCapacityScopeRequest) -> Vec<u8> {
    let mut encoder = CanonicalEncoder::default();
    encoder.bytes(REQUEST_DIGEST_DOMAIN);
    encoder.u32(request.schema_version);
    encoder.string(&request.request_identity);
    encoder.string(&request.account_namespace);
    encoder.u8(mode_tag(request.mode));
    encoder.string(&request.economic_pool_identity);
    encoder.string(&request.expected_capacity_scope_identity);
    encoder.string(&request.expected_registry_cut_identity);
    encoder.string(&request.expected_source_binding_identity);
    encoder.string(&request.expected_adapter_binding_identity);
    encoder.string(&request.expected_membership_proof_identity);
    encoder.string(&request.expected_proof_frontier_identity);
    encoder.u64(request.expected_proof_frontier_sequence);
    encoder.u64(request.projection_at_epoch_ms);
    encoder.finish()
}

const fn mode_tag(mode: CapacityScopeMode) -> u8 {
    match mode {
        CapacityScopeMode::Paper => 1,
        CapacityScopeMode::Live => 2,
    }
}

fn valid_identifier(value: &str) -> bool {
    (3..=200).contains(&value.len())
        && value.is_ascii()
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':' | b'/')
        })
}

#[derive(Default)]
struct CanonicalEncoder {
    bytes: Vec<u8>,
}

impl CanonicalEncoder {
    fn bytes(&mut self, value: &[u8]) {
        self.u64(value.len() as u64);
        self.bytes.extend_from_slice(value);
    }

    fn string(&mut self, value: &str) {
        self.bytes(value.as_bytes());
    }

    fn u8(&mut self, value: u8) {
        self.bytes.push(value);
    }

    fn u32(&mut self, value: u32) {
        self.bytes.extend_from_slice(&value.to_be_bytes());
    }

    fn u64(&mut self, value: u64) {
        self.bytes.extend_from_slice(&value.to_be_bytes());
    }

    fn finish(self) -> Vec<u8> {
        self.bytes
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    const PROJECTION_AT: u64 = 10_000;

    fn definition(
        account_namespace: &str,
        mode: CapacityScopeMode,
        economic_pool_identity: &str,
        constraint_identity: &str,
    ) -> OwnerCapacityScopeDefinition {
        OwnerCapacityScopeDefinition {
            account_namespace: account_namespace.to_string(),
            mode,
            economic_pool_identity: economic_pool_identity.to_string(),
            source_binding_identity: format!("source-binding-{account_namespace}"),
            adapter_binding_identity: format!("adapter-binding-{account_namespace}"),
            shared_constraint_identities: vec![constraint_identity.to_string()],
        }
    }

    fn registry() -> OwnerCapacityScopeRegistryCut {
        OwnerCapacityScopeRegistryCut {
            completeness: OwnerMembershipCompleteness::Complete,
            proof_frontier_identity: "capacity-membership-frontier-alpha".to_string(),
            proof_frontier_sequence: 7,
            observed_at_epoch_ms: 9_000,
            valid_through_epoch_ms: 20_000,
            definitions: vec![
                definition(
                    "account-alpha",
                    CapacityScopeMode::Paper,
                    "economic-pool-alpha",
                    "constraint-alpha",
                ),
                definition(
                    "account-beta",
                    CapacityScopeMode::Live,
                    "economic-pool-beta",
                    "constraint-beta",
                ),
            ],
        }
    }

    fn request(registry: &OwnerCapacityScopeRegistryCut) -> UntrustedCapacityScopeRequest {
        let definition = &registry.definitions[0];
        UntrustedCapacityScopeRequest {
            schema_version: CAPACITY_SCOPE_SCHEMA_VERSION,
            request_identity: "capacity-scope-request-alpha".to_string(),
            account_namespace: definition.account_namespace.clone(),
            mode: definition.mode,
            economic_pool_identity: definition.economic_pool_identity.clone(),
            expected_capacity_scope_identity: derive_scope_identity(definition),
            expected_registry_cut_identity: derive_registry_cut_identity(registry),
            expected_source_binding_identity: definition.source_binding_identity.clone(),
            expected_adapter_binding_identity: definition.adapter_binding_identity.clone(),
            expected_membership_proof_identity: derive_membership_proof_identity(registry),
            expected_proof_frontier_identity: registry.proof_frontier_identity.clone(),
            expected_proof_frontier_sequence: registry.proof_frontier_sequence,
            projection_at_epoch_ms: PROJECTION_AT,
        }
    }

    const fn decision_time() -> OwnerCapacityScopeDecisionTime {
        OwnerCapacityScopeDecisionTime {
            projection_at_epoch_ms: PROJECTION_AT,
        }
    }

    #[rstest]
    fn private_owner_complete_registry_issues_sealed_bound_discovery_readback() {
        let registry = registry();
        let request = request(&registry);
        let Ok(readback) = issue_bound_capacity_scope(&request, &registry, decision_time()) else {
            panic!("complete current Owner registry should bind the exact scope");
        };
        assert_eq!(readback.state(), CapacityScopeState::Bound);
        assert_eq!(readback.maturity(), CapacityScopeMaturity::Discovery);
        assert_eq!(readback.account_namespace(), "account-alpha");
        assert_eq!(readback.mode(), CapacityScopeMode::Paper);
        assert_eq!(readback.economic_pool_identity(), "economic-pool-alpha");
        assert_eq!(
            readback.capacity_scope_identity(),
            request.expected_capacity_scope_identity
        );
        assert_eq!(
            readback.membership_proof_identity(),
            request.expected_membership_proof_identity
        );
    }

    #[rstest]
    fn public_caller_path_cannot_promote_exact_owner_shaped_dto() {
        let registry = registry();
        let request = request(&registry);
        let CapacityScopeResolution::Unavailable(unavailable) = resolve_capacity_scope(&request)
        else {
            panic!("public resolver must not mint BOUND authority");
        };
        assert_eq!(unavailable.maturity(), CapacityScopeMaturity::Discovery);
        assert_eq!(
            unavailable.failures(),
            &[CapacityScopeFailure::OwnerResolveUnavailable]
        );
    }

    #[rstest]
    #[case(CapacityScopeIdentityField::CapacityScope)]
    #[case(CapacityScopeIdentityField::RegistryCut)]
    #[case(CapacityScopeIdentityField::SourceBinding)]
    #[case(CapacityScopeIdentityField::AdapterBinding)]
    #[case(CapacityScopeIdentityField::MembershipProof)]
    #[case(CapacityScopeIdentityField::ProofFrontier)]
    #[case(CapacityScopeIdentityField::ProofFrontierSequence)]
    #[case(CapacityScopeIdentityField::DecisionTime)]
    fn tampered_expected_identity_fails_closed(#[case] field: CapacityScopeIdentityField) {
        let registry = registry();
        let mut request = request(&registry);

        match field {
            CapacityScopeIdentityField::CapacityScope => {
                request
                    .expected_capacity_scope_identity
                    .push_str("-tampered");
            }
            CapacityScopeIdentityField::RegistryCut => {
                request.expected_registry_cut_identity.push_str("-tampered");
            }
            CapacityScopeIdentityField::SourceBinding => {
                request
                    .expected_source_binding_identity
                    .push_str("-tampered");
            }
            CapacityScopeIdentityField::AdapterBinding => {
                request
                    .expected_adapter_binding_identity
                    .push_str("-tampered");
            }
            CapacityScopeIdentityField::MembershipProof => {
                request
                    .expected_membership_proof_identity
                    .push_str("-tampered");
            }
            CapacityScopeIdentityField::ProofFrontier => {
                request
                    .expected_proof_frontier_identity
                    .push_str("-tampered");
            }
            CapacityScopeIdentityField::ProofFrontierSequence => {
                request.expected_proof_frontier_sequence += 1;
            }
            CapacityScopeIdentityField::DecisionTime => {
                request.projection_at_epoch_ms += 1;
            }
        }
        assert_eq!(
            issue_bound_capacity_scope(&request, &registry, decision_time()),
            Err(CapacityScopeFailure::IdentityMismatch { field })
        );
    }

    #[rstest]
    fn unknown_membership_and_shared_constraint_overlap_fail_closed() {
        let mut unknown = registry();
        let unknown_request = request(&unknown);
        unknown.completeness = OwnerMembershipCompleteness::Unknown;
        assert_eq!(
            issue_bound_capacity_scope(&unknown_request, &unknown, decision_time()),
            Err(CapacityScopeFailure::MembershipUnknown)
        );

        let mut overlapping = registry();
        let overlapping_request = request(&overlapping);
        overlapping.definitions[1].shared_constraint_identities =
            vec!["constraint-alpha".to_string()];
        assert_eq!(
            issue_bound_capacity_scope(&overlapping_request, &overlapping, decision_time()),
            Err(CapacityScopeFailure::SharedConstraintOverlap {
                constraint_identity: "constraint-alpha".to_string(),
            })
        );
    }

    #[rstest]
    fn stale_proof_unknown_scope_and_paper_live_alias_fail_closed() {
        let mut stale = registry();
        let stale_request = request(&stale);
        stale.valid_through_epoch_ms = PROJECTION_AT;
        assert_eq!(
            issue_bound_capacity_scope(&stale_request, &stale, decision_time()),
            Err(CapacityScopeFailure::ProofStale)
        );

        let registry = registry();
        let mut unknown = request(&registry);
        unknown.account_namespace = "account-unknown".to_string();
        assert_eq!(
            issue_bound_capacity_scope(&unknown, &registry, decision_time()),
            Err(CapacityScopeFailure::ScopeMembershipUnknown)
        );

        let mut cross_mode = request(&registry);
        cross_mode.mode = CapacityScopeMode::Live;
        assert_eq!(
            issue_bound_capacity_scope(&cross_mode, &registry, decision_time()),
            Err(CapacityScopeFailure::ScopeMembershipUnknown)
        );
    }

    #[rstest]
    fn registry_order_does_not_change_owner_cut_or_membership_proof() {
        let original = registry();
        let mut reordered = original.clone();
        reordered.definitions.reverse();
        assert_eq!(
            derive_registry_cut_identity(&original),
            derive_registry_cut_identity(&reordered)
        );
        assert_eq!(
            derive_membership_proof_identity(&original),
            derive_membership_proof_identity(&reordered)
        );
    }

    #[rstest]
    fn owner_time_rejects_old_caller_projection_after_proof_expiry() {
        let registry = registry();
        let request = request(&registry);
        let expired_owner_time = OwnerCapacityScopeDecisionTime {
            projection_at_epoch_ms: registry.valid_through_epoch_ms,
        };
        assert_eq!(
            issue_bound_capacity_scope(&request, &registry, expired_owner_time),
            Err(CapacityScopeFailure::ProofStale)
        );
    }
}
