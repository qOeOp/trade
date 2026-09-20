//! What this Owner observed about capacity, and the evidence cut it observed it at.

use serde::{Deserialize, Serialize};

/// Canonical schema version for a sealed capacity observation.
pub const RISK_CAPACITY_OBSERVATION_SCHEMA_V1: u32 = 1;

/// Why no capacity observation could be sealed.
///
/// Each variant names one cause. A single `Unavailable` would have told a caller that it cannot
/// proceed without telling it whether Portfolio's custody is absent, present but holding no such
/// fact, or holding one that has expired. Those have different next actions, and the first two in
/// particular are the difference between "deploy the upstream Owner" and "wait for it to commit
/// something".
///
/// Two refusals a reader might expect are deliberately absent, because neither is constructible
/// through any admitted path today and a branch no test can reach is worse than a documented
/// absence:
///
/// - **not `BOUND`.** `portfolio_api.read_bound_capacity_scope_v1` selects from
///   `portfolio_private.portfolio_capacity_scope_bound_readbacks_v1`, and
///   `issue_bound_capacity_scope` writes `state: CapacityScopeState::Bound` unconditionally, so a
///   non-`BOUND` scope is never returned. It surfaces as [`Self::FactUnavailable`] instead.
/// - **not candidate-neutral.** `CapacityViewReadback` is built with `candidate_neutral: true` at
///   its only construction site.
///
/// Those two hardcodes are what would have to change first. The day either does is the day this
/// enum needs the corresponding refusal, and until then naming them here costs nothing while
/// carrying them as variants would cost a branch that can never fire.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CapacityObservationRefusal {
    /// The `portfolio_api` read functions are not deployed in this database.
    ///
    /// Distinct from [`Self::FactUnavailable`]: the custody itself is missing, so no amount of
    /// waiting produces the fact.
    ///
    /// Reachable in production and not assertable on the ordered chain's shared database, where
    /// Portfolio's custody is already deployed by the time this Owner's entry runs. The chain
    /// proof says so rather than leaving the gap unexplained.
    UpstreamCustodyNotDeployed,
    /// The read functions are deployed and returned no row for this coordinate.
    FactUnavailable,
    /// A Capacity View was returned whose validity window does not contain the observation time.
    FactExpired,
    /// The upstream readback was well-formed JSON but carried a field this Owner cannot interpret.
    ///
    /// Distinct from the three above: the fact is present and current, and this Owner still will
    /// not seal it, so the disagreement is about shape rather than availability.
    ReadbackMalformed,
}

impl core::fmt::Display for CapacityObservationRefusal {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::UpstreamCustodyNotDeployed => {
                formatter.write_str("portfolio_api read functions are not deployed")
            }
            Self::FactUnavailable => formatter.write_str("no capacity fact for this coordinate"),
            Self::FactExpired => formatter.write_str("capacity view is outside its validity"),
            Self::ReadbackMalformed => formatter.write_str("upstream readback is malformed"),
        }
    }
}

/// One sealed observation: what Portfolio said, and the cut at which it said it.
///
/// Carries no decision. A later Risk decision must be able to point back at exactly this, which
/// is why the observation records Portfolio's own proof frontier and Execution's account fact
/// coordinate rather than only the numbers it read.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SealedCapacityObservationV1 {
    /// Canonical schema version.
    pub schema_version: u32,
    /// Identity derived from the observed content, never from the observation time.
    pub observation_identity: String,
    /// Portfolio-owned Capacity Scope this observation is about.
    pub capacity_scope_identity: String,
    /// Account namespace the scope is bound to.
    pub account_namespace: String,
    /// Economic pool the scope is bound to.
    pub economic_pool_identity: String,
    /// Risk dimension the observed ceiling bounds.
    pub ceiling_dimension: String,
    /// Unit the observed ceiling is expressed in.
    pub ceiling_unit: String,
    /// Observed gross ceiling, at Portfolio's own scale.
    pub gross_ceiling_scaled: u64,
    /// Portfolio's proof frontier at the moment of observation.
    pub portfolio_proof_frontier_identity: String,
    /// Execution's account fact identity, as Portfolio published it.
    pub account_fact_identity: String,
    /// Execution's native stream sequence for that account fact.
    pub account_fact_sequence: u64,
    /// Inclusive start of the observed view's validity.
    pub measured_at_epoch_ms: u64,
    /// Exclusive end of the observed view's validity.
    pub valid_through_epoch_ms: u64,
}
