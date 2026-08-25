//! Fail-closed Portfolio Owner view contract.
//!
//! This R0 surface deliberately has no positive source resolver. Callers can describe an
//! untrusted request and receive a structured unavailable result; only a future private Portfolio
//! Owner authority may gain a path that constructs [`PortfolioViewReadback`].

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

const REQUEST_DIGEST_DOMAIN: &[u8] = b"vibe.portfolio.owner-view.request.v1\0";
/// Schema version for the Portfolio Owner View contract.
pub const PORTFOLIO_VIEW_SCHEMA_VERSION: u32 = 1;

/// Execution mode bound into every Portfolio View request and source dependency.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PortfolioViewMode {
    /// Simulated execution namespace.
    Paper,
    /// Production execution namespace. This contract confers no LIVE authority.
    Live,
}

/// Owner responsible for a direct Portfolio View dependency.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PortfolioViewSourceOwner {
    /// Execution owns committed account and effect facts.
    Execution,
    /// Market Data owns valuation inputs.
    MarketData,
    /// Portfolio owns its prior snapshot frontier.
    Portfolio,
}

/// Complete direct-source dependency classes required by a positive Portfolio View.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PortfolioViewDependencyKind {
    /// Reconciled account fact.
    ExecutionAccount,
    /// Committed open-order fact.
    ExecutionOpenOrders,
    /// Committed fill fact.
    ExecutionFills,
    /// Committed fee fact.
    ExecutionFees,
    /// Reconciled settlement lineage.
    ExecutionSettlement,
    /// Price fact.
    MarketPrice,
    /// FX fact.
    MarketFx,
    /// Contract specification fact.
    MarketContract,
    /// Valuation fact.
    MarketValuation,
    /// Liquidity input cut used by gross capacity.
    MarketLiquidity,
    /// Prior Portfolio snapshot frontier.
    PortfolioSnapshot,
}

const REQUIRED_DEPENDENCIES: [PortfolioViewDependencyKind; 11] = [
    PortfolioViewDependencyKind::ExecutionAccount,
    PortfolioViewDependencyKind::ExecutionOpenOrders,
    PortfolioViewDependencyKind::ExecutionFills,
    PortfolioViewDependencyKind::ExecutionFees,
    PortfolioViewDependencyKind::ExecutionSettlement,
    PortfolioViewDependencyKind::MarketPrice,
    PortfolioViewDependencyKind::MarketFx,
    PortfolioViewDependencyKind::MarketContract,
    PortfolioViewDependencyKind::MarketValuation,
    PortfolioViewDependencyKind::MarketLiquidity,
    PortfolioViewDependencyKind::PortfolioSnapshot,
];

/// Caller-supplied reference to a principal claim.
///
/// The name is intentionally explicit: deserializing this value does not make it trusted. A future
/// positive resolver must resolve `claim_identity` through private authorization authority.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UntrustedPrincipalClaim {
    /// Stable claim identity to resolve through authorization authority.
    pub claim_identity: String,
    /// Expected issuer identity.
    pub issuer_identity: String,
    /// Effective principal.
    pub principal_identity: String,
    /// Authorized account.
    pub account_identity: String,
    /// Authorized Execution Scope.
    pub execution_scope_identity: String,
    /// Authorized execution mode.
    pub mode: PortfolioViewMode,
    /// Exact authorization policy cut.
    pub authorization_policy_cut: String,
    /// Inclusive claim start.
    pub not_before_epoch_ms: u64,
    /// Exclusive claim expiry.
    pub valid_through_epoch_ms: u64,
}

/// Caller-supplied locator for one direct Owner dependency.
///
/// This is proposal vocabulary only. A locator never proves that the referenced Owner fact exists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UntrustedSourceDependencyLocator {
    /// Dependency class.
    pub kind: PortfolioViewDependencyKind,
    /// Claimed source Owner.
    pub owner: PortfolioViewSourceOwner,
    /// Claimed immutable Owner locator.
    pub locator_identity: String,
    /// Claimed Owner frontier identity.
    pub frontier_identity: String,
    /// Claimed monotonic frontier sequence.
    pub frontier_sequence: u64,
    /// Shared Portfolio common-cut identity.
    pub common_cut_identity: String,
    /// Principal bound into the claimed fact.
    pub principal_identity: String,
    /// Account bound into the claimed fact.
    pub account_identity: String,
    /// Execution Scope bound into the claimed fact.
    pub execution_scope_identity: String,
    /// Mode bound into the claimed fact.
    pub mode: PortfolioViewMode,
    /// Authorization policy cut bound into the claimed fact.
    pub authorization_policy_cut: String,
    /// Source observation time.
    pub observed_at_epoch_ms: u64,
    /// Exclusive source expiry.
    pub valid_through_epoch_ms: u64,
}

/// Typed, entirely untrusted request accepted by the public Portfolio Owner boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortfolioViewRequest {
    /// Exact request schema version.
    pub schema_version: u32,
    /// Stable client read-request identity.
    pub request_identity: String,
    /// Caller-supplied principal claim reference and expected binding.
    pub principal_claim: UntrustedPrincipalClaim,
    /// Requested principal.
    pub principal_identity: String,
    /// Requested account.
    pub account_identity: String,
    /// Requested Execution Scope.
    pub execution_scope_identity: String,
    /// Requested mode.
    pub mode: PortfolioViewMode,
    /// Exact authorization policy cut.
    pub authorization_policy_cut: String,
    /// Common source-cut identity all dependencies must bind.
    pub common_cut_identity: String,
    /// Projection time.
    pub projection_at_epoch_ms: u64,
    /// Exclusive view validity bound.
    pub valid_through_epoch_ms: u64,
    /// Complete direct-source dependency proposals.
    pub source_dependencies: Vec<UntrustedSourceDependencyLocator>,
}

impl PortfolioViewRequest {
    /// Returns the stable request identity and deterministic semantic digest.
    #[must_use]
    pub fn fingerprint(&self) -> PortfolioViewRequestFingerprint {
        PortfolioViewRequestFingerprint {
            request_identity: self.request_identity.clone(),
            semantic_digest: format!("sha256:{}", sha256_hex(&canonical_request_bytes(self))),
        }
    }
}

/// Stable identity/digest pair used for exact replay and same-identity conflict detection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PortfolioViewRequestFingerprint {
    request_identity: String,
    semantic_digest: String,
}

impl PortfolioViewRequestFingerprint {
    /// Stable caller request identity.
    #[must_use]
    pub fn request_identity(&self) -> &str {
        &self.request_identity
    }

    /// Deterministic digest over every request, claim, source, scope, and time field.
    #[must_use]
    pub fn semantic_digest(&self) -> &str {
        &self.semantic_digest
    }
}

/// Replay classification for two untrusted requests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PortfolioViewReplayDisposition {
    /// Same request identity and exact same canonical meaning.
    ExactReplay,
    /// Same request identity with changed meaning.
    Conflict,
    /// Different request identity.
    DistinctRequest,
}

/// Classifies exact replay without resolving or creating any Owner fact.
#[must_use]
pub fn classify_portfolio_view_replay(
    previous: &PortfolioViewRequest,
    proposed: &PortfolioViewRequest,
) -> PortfolioViewReplayDisposition {
    let previous = previous.fingerprint();
    let proposed = proposed.fingerprint();
    if previous.request_identity != proposed.request_identity {
        PortfolioViewReplayDisposition::DistinctRequest
    } else if previous.semantic_digest == proposed.semantic_digest {
        PortfolioViewReplayDisposition::ExactReplay
    } else {
        PortfolioViewReplayDisposition::Conflict
    }
}

/// Availability exposed by the Portfolio View envelope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PortfolioViewAvailability {
    /// Complete sealed projection. The R0 public resolver cannot produce this state.
    Available,
    /// One or more mandatory bindings are malformed, missing, mixed, or cross-scope.
    IncompleteFailClosed,
    /// One or more otherwise identified inputs are stale.
    Stale,
    /// Owner authority cannot resolve the requested source cut.
    Unavailable,
}

/// Current terminal disposition of the R0 public resolver.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PortfolioViewDisposition {
    /// No private direct-source resolver exists in this R0 contract.
    SourceOwnerResolveUnavailable,
}

/// Scope coordinate used by a structured cross-binding failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PortfolioViewScopeField {
    /// Principal identity.
    Principal,
    /// Account identity.
    Account,
    /// Execution Scope identity.
    ExecutionScope,
    /// PAPER/LIVE mode.
    Mode,
    /// Authorization policy cut.
    AuthorizationPolicyCut,
}

/// Structured reason a positive Portfolio View was withheld.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "reason", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PortfolioViewDependencyFailure {
    /// Request schema version is not supported by this boundary.
    UnsupportedSchemaVersion { actual: u32 },
    /// A request or claim field is malformed.
    InvalidField { field: String },
    /// A mandatory direct dependency is absent.
    MissingDependency { kind: PortfolioViewDependencyKind },
    /// More than one locator claims the same dependency class.
    DuplicateDependency { kind: PortfolioViewDependencyKind },
    /// The dependency class names the wrong source Owner.
    CrossOwnerDependency { kind: PortfolioViewDependencyKind },
    /// A claimed source frontier has no positive sequence.
    InvalidFrontierSequence { kind: PortfolioViewDependencyKind },
    /// Principal claim and request disagree.
    PrincipalClaimMismatch { field: PortfolioViewScopeField },
    /// A dependency crosses the request's authorization or execution scope.
    CrossScopeDependency {
        kind: PortfolioViewDependencyKind,
        field: PortfolioViewScopeField,
    },
    /// A dependency belongs to a different common cut.
    MixedCutDependency { kind: PortfolioViewDependencyKind },
    /// The source was observed after the requested projection time.
    FutureDatedDependency { kind: PortfolioViewDependencyKind },
    /// The source expired at or before the projection time.
    StaleDependency { kind: PortfolioViewDependencyKind },
    /// Request validity does not contain its projection time.
    ExpiredRequest,
    /// Principal claim validity does not contain the projection time.
    ExpiredPrincipalClaim,
    /// Requested view validity extends beyond the principal claim.
    ValidityOutlivesPrincipalClaim,
    /// Requested view validity extends beyond a source dependency.
    ValidityOutlivesDependency { kind: PortfolioViewDependencyKind },
    /// The claim is caller-supplied and was not resolved by private authorization authority.
    CallerSuppliedPrincipalClaim,
    /// A locator is caller-supplied and was not resolved by its source Owner.
    CallerSuppliedSourceLocator { kind: PortfolioViewDependencyKind },
    /// A required direct Owner resolver is absent.
    SourceOwnerResolveUnavailable { owner: PortfolioViewSourceOwner },
}

/// Explicit fail-closed response returned by the public R0 resolver.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UnavailablePortfolioView {
    schema_version: u32,
    fingerprint: PortfolioViewRequestFingerprint,
    availability: PortfolioViewAvailability,
    disposition: PortfolioViewDisposition,
    failures: Vec<PortfolioViewDependencyFailure>,
}

impl UnavailablePortfolioView {
    /// Schema version.
    #[must_use]
    pub const fn schema_version(&self) -> u32 {
        self.schema_version
    }

    /// Request identity/digest echoed by the fail-closed response.
    #[must_use]
    pub const fn fingerprint(&self) -> &PortfolioViewRequestFingerprint {
        &self.fingerprint
    }

    /// Explicit availability.
    #[must_use]
    pub const fn availability(&self) -> PortfolioViewAvailability {
        self.availability
    }

    /// Explicit resolver disposition.
    #[must_use]
    pub const fn disposition(&self) -> PortfolioViewDisposition {
        self.disposition
    }

    /// Structured fail-closed reasons.
    #[must_use]
    pub fn failures(&self) -> &[PortfolioViewDependencyFailure] {
        &self.failures
    }
}

/// Sealed positive Portfolio Owner readback.
///
/// It has no public constructor, no `Default`, and no `Deserialize` implementation. Its named,
/// mandatory fields prevent an empty-map positive representation. The current public resolver has
/// no code path that constructs this type.
///
/// ```compile_fail
/// use vibe_portfolio::owner::portfolio_view::PortfolioViewReadback;
///
/// let forged = PortfolioViewReadback {};
/// ```
///
/// ```compile_fail
/// use serde::Deserialize;
/// use vibe_portfolio::owner::portfolio_view::PortfolioViewReadback;
///
/// fn require_deserialize<T: for<'de> Deserialize<'de>>() {}
/// require_deserialize::<PortfolioViewReadback>();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PortfolioViewReadback {
    schema_version: u32,
    fingerprint: PortfolioViewRequestFingerprint,
    principal_claim_identity: String,
    principal_identity: String,
    account_identity: String,
    execution_scope_identity: String,
    mode: PortfolioViewMode,
    authorization_policy_cut: String,
    common_cut_identity: String,
    projection_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
    source_receipts: Vec<ResolvedSourceDependency>,
    account_projection_identity: String,
    exposure_projection_identity: String,
    performance_projection_identity: String,
    gross_capacity_projection_identity: String,
}

impl PortfolioViewReadback {
    /// Stable request identity/digest bound into this sealed readback.
    #[must_use]
    pub const fn fingerprint(&self) -> &PortfolioViewRequestFingerprint {
        &self.fingerprint
    }

    /// Principal authorized by the sealed claim.
    #[must_use]
    pub fn principal_identity(&self) -> &str {
        &self.principal_identity
    }

    /// Authorized account.
    #[must_use]
    pub fn account_identity(&self) -> &str {
        &self.account_identity
    }

    /// Authorized Execution Scope.
    #[must_use]
    pub fn execution_scope_identity(&self) -> &str {
        &self.execution_scope_identity
    }

    /// Bound PAPER/LIVE mode.
    #[must_use]
    pub const fn mode(&self) -> PortfolioViewMode {
        self.mode
    }

    /// Projection time.
    #[must_use]
    pub const fn projection_at_epoch_ms(&self) -> u64 {
        self.projection_at_epoch_ms
    }

    /// Exclusive readback expiry.
    #[must_use]
    pub const fn valid_through_epoch_ms(&self) -> u64 {
        self.valid_through_epoch_ms
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct ResolvedSourceDependency {
    kind: PortfolioViewDependencyKind,
    owner: PortfolioViewSourceOwner,
    locator_identity: String,
    frontier_identity: String,
    frontier_sequence: u64,
    common_cut_identity: String,
    observed_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
}

/// Result of resolving an untrusted Portfolio View request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "resolution", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PortfolioViewResolution {
    /// Sealed positive readback; unreachable from the R0 public resolver.
    Available(Box<PortfolioViewReadback>),
    /// Explicit fail-closed response.
    Unavailable(UnavailablePortfolioView),
}

/// Resolves an untrusted request through the currently available public R0 boundary.
///
/// No direct positive source resolver exists in this slice, so this function always returns
/// [`PortfolioViewResolution::Unavailable`]. Caller-provided locators and principal claims are
/// never promoted to Owner facts.
#[must_use]
pub fn resolve_portfolio_view(request: &PortfolioViewRequest) -> PortfolioViewResolution {
    let mut failures = validate_request(request);
    failures.push(PortfolioViewDependencyFailure::CallerSuppliedPrincipalClaim);
    for dependency in &request.source_dependencies {
        failures.push(
            PortfolioViewDependencyFailure::CallerSuppliedSourceLocator {
                kind: dependency.kind,
            },
        );
    }

    for owner in [
        PortfolioViewSourceOwner::Execution,
        PortfolioViewSourceOwner::MarketData,
        PortfolioViewSourceOwner::Portfolio,
    ] {
        failures.push(PortfolioViewDependencyFailure::SourceOwnerResolveUnavailable { owner });
    }

    let availability = if failures.iter().any(|failure| {
        matches!(
            failure,
            PortfolioViewDependencyFailure::StaleDependency { .. }
                | PortfolioViewDependencyFailure::ExpiredRequest
                | PortfolioViewDependencyFailure::ExpiredPrincipalClaim
        )
    }) {
        PortfolioViewAvailability::Stale
    } else if failures.iter().any(is_incomplete_failure) {
        PortfolioViewAvailability::IncompleteFailClosed
    } else {
        PortfolioViewAvailability::Unavailable
    };

    PortfolioViewResolution::Unavailable(UnavailablePortfolioView {
        schema_version: PORTFOLIO_VIEW_SCHEMA_VERSION,
        fingerprint: request.fingerprint(),
        availability,
        disposition: PortfolioViewDisposition::SourceOwnerResolveUnavailable,
        failures,
    })
}

const fn is_incomplete_failure(failure: &PortfolioViewDependencyFailure) -> bool {
    matches!(
        failure,
        PortfolioViewDependencyFailure::UnsupportedSchemaVersion { .. }
            | PortfolioViewDependencyFailure::InvalidField { .. }
            | PortfolioViewDependencyFailure::MissingDependency { .. }
            | PortfolioViewDependencyFailure::DuplicateDependency { .. }
            | PortfolioViewDependencyFailure::CrossOwnerDependency { .. }
            | PortfolioViewDependencyFailure::InvalidFrontierSequence { .. }
            | PortfolioViewDependencyFailure::PrincipalClaimMismatch { .. }
            | PortfolioViewDependencyFailure::CrossScopeDependency { .. }
            | PortfolioViewDependencyFailure::MixedCutDependency { .. }
            | PortfolioViewDependencyFailure::FutureDatedDependency { .. }
            | PortfolioViewDependencyFailure::ValidityOutlivesPrincipalClaim
            | PortfolioViewDependencyFailure::ValidityOutlivesDependency { .. }
    )
}

fn validate_request(request: &PortfolioViewRequest) -> Vec<PortfolioViewDependencyFailure> {
    let mut failures = Vec::new();

    if request.schema_version != PORTFOLIO_VIEW_SCHEMA_VERSION {
        failures.push(PortfolioViewDependencyFailure::UnsupportedSchemaVersion {
            actual: request.schema_version,
        });
    }

    for (field, value) in [
        ("request_identity", request.request_identity.as_str()),
        ("principal_identity", request.principal_identity.as_str()),
        ("account_identity", request.account_identity.as_str()),
        (
            "execution_scope_identity",
            request.execution_scope_identity.as_str(),
        ),
        (
            "authorization_policy_cut",
            request.authorization_policy_cut.as_str(),
        ),
        ("common_cut_identity", request.common_cut_identity.as_str()),
        (
            "principal_claim.claim_identity",
            request.principal_claim.claim_identity.as_str(),
        ),
        (
            "principal_claim.issuer_identity",
            request.principal_claim.issuer_identity.as_str(),
        ),
    ] {
        if !valid_identifier(value) {
            failures.push(PortfolioViewDependencyFailure::InvalidField {
                field: field.to_string(),
            });
        }
    }

    if request.projection_at_epoch_ms >= request.valid_through_epoch_ms {
        failures.push(PortfolioViewDependencyFailure::ExpiredRequest);
    }

    if request.projection_at_epoch_ms < request.principal_claim.not_before_epoch_ms
        || request.projection_at_epoch_ms >= request.principal_claim.valid_through_epoch_ms
    {
        failures.push(PortfolioViewDependencyFailure::ExpiredPrincipalClaim);
    }

    if request.valid_through_epoch_ms > request.principal_claim.valid_through_epoch_ms {
        failures.push(PortfolioViewDependencyFailure::ValidityOutlivesPrincipalClaim);
    }

    compare_claim(request, &mut failures);

    let mut counts = BTreeMap::new();
    for dependency in &request.source_dependencies {
        *counts.entry(dependency.kind).or_insert(0_usize) += 1;
        validate_dependency(request, dependency, &mut failures);
    }

    for kind in REQUIRED_DEPENDENCIES {
        match counts.get(&kind).copied().unwrap_or_default() {
            0 => failures.push(PortfolioViewDependencyFailure::MissingDependency { kind }),
            1 => {}
            _ => failures.push(PortfolioViewDependencyFailure::DuplicateDependency { kind }),
        }
    }
    failures
}

fn compare_claim(
    request: &PortfolioViewRequest,
    failures: &mut Vec<PortfolioViewDependencyFailure>,
) {
    let claim = &request.principal_claim;
    if claim.principal_identity != request.principal_identity {
        failures.push(PortfolioViewDependencyFailure::PrincipalClaimMismatch {
            field: PortfolioViewScopeField::Principal,
        });
    }

    if claim.account_identity != request.account_identity {
        failures.push(PortfolioViewDependencyFailure::PrincipalClaimMismatch {
            field: PortfolioViewScopeField::Account,
        });
    }

    if claim.execution_scope_identity != request.execution_scope_identity {
        failures.push(PortfolioViewDependencyFailure::PrincipalClaimMismatch {
            field: PortfolioViewScopeField::ExecutionScope,
        });
    }

    if claim.mode != request.mode {
        failures.push(PortfolioViewDependencyFailure::PrincipalClaimMismatch {
            field: PortfolioViewScopeField::Mode,
        });
    }

    if claim.authorization_policy_cut != request.authorization_policy_cut {
        failures.push(PortfolioViewDependencyFailure::PrincipalClaimMismatch {
            field: PortfolioViewScopeField::AuthorizationPolicyCut,
        });
    }
}

fn validate_dependency(
    request: &PortfolioViewRequest,
    dependency: &UntrustedSourceDependencyLocator,
    failures: &mut Vec<PortfolioViewDependencyFailure>,
) {
    for (field, value) in [
        (
            "source.locator_identity",
            dependency.locator_identity.as_str(),
        ),
        (
            "source.frontier_identity",
            dependency.frontier_identity.as_str(),
        ),
        (
            "source.common_cut_identity",
            dependency.common_cut_identity.as_str(),
        ),
    ] {
        if !valid_identifier(value) {
            failures.push(PortfolioViewDependencyFailure::InvalidField {
                field: field.to_string(),
            });
        }
    }

    if dependency.owner != expected_owner(dependency.kind) {
        failures.push(PortfolioViewDependencyFailure::CrossOwnerDependency {
            kind: dependency.kind,
        });
    }

    if dependency.frontier_sequence == 0 {
        failures.push(PortfolioViewDependencyFailure::InvalidFrontierSequence {
            kind: dependency.kind,
        });
    }

    for (field, matches_request) in [
        (
            PortfolioViewScopeField::Principal,
            dependency.principal_identity == request.principal_identity,
        ),
        (
            PortfolioViewScopeField::Account,
            dependency.account_identity == request.account_identity,
        ),
        (
            PortfolioViewScopeField::ExecutionScope,
            dependency.execution_scope_identity == request.execution_scope_identity,
        ),
        (
            PortfolioViewScopeField::Mode,
            dependency.mode == request.mode,
        ),
        (
            PortfolioViewScopeField::AuthorizationPolicyCut,
            dependency.authorization_policy_cut == request.authorization_policy_cut,
        ),
    ] {
        if !matches_request {
            failures.push(PortfolioViewDependencyFailure::CrossScopeDependency {
                kind: dependency.kind,
                field,
            });
        }
    }

    if dependency.common_cut_identity != request.common_cut_identity {
        failures.push(PortfolioViewDependencyFailure::MixedCutDependency {
            kind: dependency.kind,
        });
    }

    if dependency.observed_at_epoch_ms > request.projection_at_epoch_ms {
        failures.push(PortfolioViewDependencyFailure::FutureDatedDependency {
            kind: dependency.kind,
        });
    }

    if dependency.valid_through_epoch_ms <= request.projection_at_epoch_ms
        || dependency.observed_at_epoch_ms >= dependency.valid_through_epoch_ms
    {
        failures.push(PortfolioViewDependencyFailure::StaleDependency {
            kind: dependency.kind,
        });
    }

    if request.valid_through_epoch_ms > dependency.valid_through_epoch_ms {
        failures.push(PortfolioViewDependencyFailure::ValidityOutlivesDependency {
            kind: dependency.kind,
        });
    }
}

const fn expected_owner(kind: PortfolioViewDependencyKind) -> PortfolioViewSourceOwner {
    match kind {
        PortfolioViewDependencyKind::ExecutionAccount
        | PortfolioViewDependencyKind::ExecutionOpenOrders
        | PortfolioViewDependencyKind::ExecutionFills
        | PortfolioViewDependencyKind::ExecutionFees
        | PortfolioViewDependencyKind::ExecutionSettlement => PortfolioViewSourceOwner::Execution,
        PortfolioViewDependencyKind::MarketPrice
        | PortfolioViewDependencyKind::MarketFx
        | PortfolioViewDependencyKind::MarketContract
        | PortfolioViewDependencyKind::MarketValuation
        | PortfolioViewDependencyKind::MarketLiquidity => PortfolioViewSourceOwner::MarketData,
        PortfolioViewDependencyKind::PortfolioSnapshot => PortfolioViewSourceOwner::Portfolio,
    }
}

fn valid_identifier(value: &str) -> bool {
    (3..=200).contains(&value.len())
        && value.is_ascii()
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':' | b'/')
        })
}

fn canonical_request_bytes(request: &PortfolioViewRequest) -> Vec<u8> {
    let mut encoder = CanonicalEncoder::default();
    encoder.bytes(REQUEST_DIGEST_DOMAIN);
    encoder.u32(request.schema_version);
    encoder.string(&request.request_identity);
    encoder.string(&request.principal_claim.claim_identity);
    encoder.string(&request.principal_claim.issuer_identity);
    encoder.string(&request.principal_claim.principal_identity);
    encoder.string(&request.principal_claim.account_identity);
    encoder.string(&request.principal_claim.execution_scope_identity);
    encoder.u8(mode_tag(request.principal_claim.mode));
    encoder.string(&request.principal_claim.authorization_policy_cut);
    encoder.u64(request.principal_claim.not_before_epoch_ms);
    encoder.u64(request.principal_claim.valid_through_epoch_ms);
    encoder.string(&request.principal_identity);
    encoder.string(&request.account_identity);
    encoder.string(&request.execution_scope_identity);
    encoder.u8(mode_tag(request.mode));
    encoder.string(&request.authorization_policy_cut);
    encoder.string(&request.common_cut_identity);
    encoder.u64(request.projection_at_epoch_ms);
    encoder.u64(request.valid_through_epoch_ms);

    let mut dependencies = request
        .source_dependencies
        .iter()
        .map(canonical_dependency_bytes)
        .collect::<Vec<_>>();
    dependencies.sort();
    encoder.u64(dependencies.len() as u64);
    for dependency in dependencies {
        encoder.bytes(&dependency);
    }
    encoder.finish()
}

fn canonical_dependency_bytes(dependency: &UntrustedSourceDependencyLocator) -> Vec<u8> {
    let mut encoder = CanonicalEncoder::default();
    encoder.u8(dependency_kind_tag(dependency.kind));
    encoder.u8(owner_tag(dependency.owner));
    encoder.string(&dependency.locator_identity);
    encoder.string(&dependency.frontier_identity);
    encoder.u64(dependency.frontier_sequence);
    encoder.string(&dependency.common_cut_identity);
    encoder.string(&dependency.principal_identity);
    encoder.string(&dependency.account_identity);
    encoder.string(&dependency.execution_scope_identity);
    encoder.u8(mode_tag(dependency.mode));
    encoder.string(&dependency.authorization_policy_cut);
    encoder.u64(dependency.observed_at_epoch_ms);
    encoder.u64(dependency.valid_through_epoch_ms);
    encoder.finish()
}

const fn mode_tag(mode: PortfolioViewMode) -> u8 {
    match mode {
        PortfolioViewMode::Paper => 1,
        PortfolioViewMode::Live => 2,
    }
}

const fn owner_tag(owner: PortfolioViewSourceOwner) -> u8 {
    match owner {
        PortfolioViewSourceOwner::Execution => 1,
        PortfolioViewSourceOwner::MarketData => 2,
        PortfolioViewSourceOwner::Portfolio => 3,
    }
}

const fn dependency_kind_tag(kind: PortfolioViewDependencyKind) -> u8 {
    match kind {
        PortfolioViewDependencyKind::ExecutionAccount => 1,
        PortfolioViewDependencyKind::ExecutionOpenOrders => 2,
        PortfolioViewDependencyKind::ExecutionFills => 3,
        PortfolioViewDependencyKind::ExecutionFees => 4,
        PortfolioViewDependencyKind::ExecutionSettlement => 5,
        PortfolioViewDependencyKind::MarketPrice => 6,
        PortfolioViewDependencyKind::MarketFx => 7,
        PortfolioViewDependencyKind::MarketContract => 8,
        PortfolioViewDependencyKind::MarketValuation => 9,
        PortfolioViewDependencyKind::MarketLiquidity => 10,
        PortfolioViewDependencyKind::PortfolioSnapshot => 11,
    }
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

#[allow(
    clippy::many_single_char_names,
    reason = "SHA-256 round variables use the names defined by the algorithm"
)]
pub(super) fn sha256_hex(input: &[u8]) -> String {
    const INITIAL: [u32; 8] = [
        0x6a09_e667,
        0xbb67_ae85,
        0x3c6e_f372,
        0xa54f_f53a,
        0x510e_527f,
        0x9b05_688c,
        0x1f83_d9ab,
        0x5be0_cd19,
    ];
    const ROUND: [u32; 64] = [
        0x428a_2f98,
        0x7137_4491,
        0xb5c0_fbcf,
        0xe9b5_dba5,
        0x3956_c25b,
        0x59f1_11f1,
        0x923f_82a4,
        0xab1c_5ed5,
        0xd807_aa98,
        0x1283_5b01,
        0x2431_85be,
        0x550c_7dc3,
        0x72be_5d74,
        0x80de_b1fe,
        0x9bdc_06a7,
        0xc19b_f174,
        0xe49b_69c1,
        0xefbe_4786,
        0x0fc1_9dc6,
        0x240c_a1cc,
        0x2de9_2c6f,
        0x4a74_84aa,
        0x5cb0_a9dc,
        0x76f9_88da,
        0x983e_5152,
        0xa831_c66d,
        0xb003_27c8,
        0xbf59_7fc7,
        0xc6e0_0bf3,
        0xd5a7_9147,
        0x06ca_6351,
        0x1429_2967,
        0x27b7_0a85,
        0x2e1b_2138,
        0x4d2c_6dfc,
        0x5338_0d13,
        0x650a_7354,
        0x766a_0abb,
        0x81c2_c92e,
        0x9272_2c85,
        0xa2bf_e8a1,
        0xa81a_664b,
        0xc24b_8b70,
        0xc76c_51a3,
        0xd192_e819,
        0xd699_0624,
        0xf40e_3585,
        0x106a_a070,
        0x19a4_c116,
        0x1e37_6c08,
        0x2748_774c,
        0x34b0_bcb5,
        0x391c_0cb3,
        0x4ed8_aa4a,
        0x5b9c_ca4f,
        0x682e_6ff3,
        0x748f_82ee,
        0x78a5_636f,
        0x84c8_7814,
        0x8cc7_0208,
        0x90be_fffa,
        0xa450_6ceb,
        0xbef9_a3f7,
        0xc671_78f2,
    ];

    let bit_len = (input.len() as u64).wrapping_mul(8);
    let mut padded = input.to_vec();
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    let mut state = INITIAL;

    for chunk in padded.chunks_exact(64) {
        let mut schedule = [0_u32; 64];
        for (index, word) in chunk.chunks_exact(4).enumerate() {
            schedule[index] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }

        for index in 16..64 {
            let s0 = schedule[index - 15].rotate_right(7)
                ^ schedule[index - 15].rotate_right(18)
                ^ (schedule[index - 15] >> 3);
            let s1 = schedule[index - 2].rotate_right(17)
                ^ schedule[index - 2].rotate_right(19)
                ^ (schedule[index - 2] >> 10);
            schedule[index] = schedule[index - 16]
                .wrapping_add(s0)
                .wrapping_add(schedule[index - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;

        for index in 0..64 {
            let big_s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let choose = (e & f) ^ ((!e) & g);
            let temp1 = h
                .wrapping_add(big_s1)
                .wrapping_add(choose)
                .wrapping_add(ROUND[index])
                .wrapping_add(schedule[index]);
            let big_s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let majority = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = big_s0.wrapping_add(majority);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        for (slot, value) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *slot = slot.wrapping_add(value);
        }
    }

    let mut output = String::with_capacity(64);

    for word in state {
        use std::fmt::Write as _;
        write!(&mut output, "{word:08x}").expect("writing to String cannot fail");
    }
    output
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::sha256_hex;

    #[rstest]
    fn sha256_matches_standard_vector() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
