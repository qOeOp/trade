//! R&D-owned frozen exploratory replay request boundary.
//!
//! Callers may propose meaning and retain an opaque locator. Positive Owner custody is
//! serialize-only and can only be assembled by the PostgreSQL R&D Owner implementation.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub mod postgres;

pub const EXPLORATORY_REPLAY_REQUEST_FROZEN_EVENT_V1: &str = "EXPLORATORY_REPLAY_REQUEST_FROZEN_V1";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IdentityDigestV1 {
    pub identity: String,
    pub digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct VersionedIdentityV1 {
    pub identity: String,
    pub version: String,
}

/// Caller-safe proposal. Every supplied lineage locator is re-read under R&D custody.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExploratoryReplayRequestProposalV1 {
    pub request_identity: String,
    pub build_request_identity: String,
    pub attempt_identity: String,
    pub intent_identity: String,
    pub trial_family_identity: String,
    pub artifact_identity: String,
    pub build_receipt_identity: String,
    pub artifact_family_binding_identity: String,
    pub census_frontier_identity: String,
    pub requested_pit_scope: IdentityDigestV1,
    pub dataset: IdentityDigestV1,
    pub feature_set: IdentityDigestV1,
    pub strategy_spec: IdentityDigestV1,
    pub exact_code_bytes_digest: String,
    pub replay_config: IdentityDigestV1,
    pub runtime_kernel: VersionedIdentityV1,
    pub simulator: VersionedIdentityV1,
    pub backtest_engine: VersionedIdentityV1,
    pub cost_model_identity: String,
    pub slippage_model_identity: String,
    pub capacity_model_identity: String,
    pub deterministic_seed: u64,
    pub range_start_epoch_ms: u64,
    pub range_end_epoch_ms: u64,
    pub calendar_identity: String,
    pub time_zone_identity: String,
}

pub fn exploratory_replay_proposal_digest_v1(
    proposal: &ExploratoryReplayRequestProposalV1,
) -> Result<String, serde_json::Error> {
    let bytes = serde_json::to_vec(&serde_json::json!({
        "domain": "rd.exploratory-replay-proposal.v1",
        "proposal": proposal,
    }))?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

/// Opaque positive locator. Fabricating its bytes cannot bypass the sealed database API.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExploratoryReplayRequestLocatorV1 {
    pub request_identity: String,
    pub request_digest: String,
    pub receipt_identity: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExploratoryReplayAvailabilityV1 {
    Available,
    Stale,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExploratoryReplayNextLegalActionV1 {
    LockByLocator,
    CreateSuccessorRequest,
    ResolveOwnerCustody,
}

/// Non-authoritative Product Edge projection.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExploratoryReplayRequestProjectionV1 {
    pub schema_version: u32,
    pub request_identity: String,
    pub availability: ExploratoryReplayAvailabilityV1,
    pub next_legal_action: ExploratoryReplayNextLegalActionV1,
}

/// ```compile_fail
/// use vibe_strategy_factory::exploratory_replay::FrozenExploratoryReplayRequestV1;
/// let _: FrozenExploratoryReplayRequestV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FrozenExploratoryReplayRequestV1 {
    pub(crate) schema_version: u32,
    pub(crate) proposal: ExploratoryReplayRequestProposalV1,
    pub(crate) research_receipt_identity: String,
    pub(crate) intent_semantic_digest: String,
    pub(crate) trial_family_root_digest: String,
    pub(crate) census_frontier_digest: String,
    pub(crate) artifact_family_binding_digest: String,
    pub(crate) artifact_family_binding_receipt_identity: String,
    pub(crate) artifact_review_identity: String,
    pub(crate) source_capsule_digest: String,
    pub(crate) build_recipe_digest: String,
    pub(crate) dependency_identity: String,
    pub(crate) trial_family_outbox_digest: String,
    pub(crate) artifact_family_outbox_digest: String,
    pub(crate) committed_at_epoch_ms: u64,
    pub(crate) request_digest: String,
}

impl FrozenExploratoryReplayRequestV1 {
    pub fn request_identity(&self) -> &str {
        &self.proposal.request_identity
    }

    pub fn request_digest(&self) -> &str {
        &self.request_digest
    }
}

/// ```compile_fail
/// use vibe_strategy_factory::exploratory_replay::ExploratoryReplayCommitResultV1;
/// let _: ExploratoryReplayCommitResultV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ExploratoryReplayCommitReceiptV1 {
    pub(crate) schema_version: u32,
    pub(crate) receipt_identity: String,
    pub(crate) request_identity: String,
    pub(crate) request_digest: String,
    pub(crate) committed_at_epoch_ms: u64,
}

/// ```compile_fail
/// use vibe_strategy_factory::exploratory_replay::SealedExploratoryReplayReadbackV1;
/// let _: SealedExploratoryReplayReadbackV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExploratoryReplayCommitResultV1 {
    pub(crate) projection: ExploratoryReplayRequestProjectionV1,
    pub(crate) locator: ExploratoryReplayRequestLocatorV1,
    pub(crate) frozen: FrozenExploratoryReplayRequestV1,
    pub(crate) receipt: ExploratoryReplayCommitReceiptV1,
}

impl ExploratoryReplayCommitResultV1 {
    pub fn projection(&self) -> &ExploratoryReplayRequestProjectionV1 {
        &self.projection
    }

    pub fn locator(&self) -> &ExploratoryReplayRequestLocatorV1 {
        &self.locator
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SealedExploratoryReplayReadbackV1 {
    pub(crate) frozen: FrozenExploratoryReplayRequestV1,
    pub(crate) receipt: ExploratoryReplayCommitReceiptV1,
    pub(crate) owner_cut_epoch_ms: u64,
}

impl SealedExploratoryReplayReadbackV1 {
    pub fn request_identity(&self) -> &str {
        self.frozen.request_identity()
    }

    pub fn request_digest(&self) -> &str {
        self.frozen.request_digest()
    }

    pub fn owner_cut_epoch_ms(&self) -> u64 {
        self.owner_cut_epoch_ms
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExploratoryReplayReadResultV1 {
    pub(crate) projection: ExploratoryReplayRequestProjectionV1,
    pub(crate) readback: Option<SealedExploratoryReplayReadbackV1>,
}

impl ExploratoryReplayReadResultV1 {
    pub fn projection(&self) -> &ExploratoryReplayRequestProjectionV1 {
        &self.projection
    }

    pub fn readback(&self) -> Option<&SealedExploratoryReplayReadbackV1> {
        self.readback.as_ref()
    }
}

#[derive(Debug, Error)]
pub enum ExploratoryReplayOwnerError {
    #[error("exploratory replay request identity was reused with conflicting meaning")]
    ConflictingReplay,
    #[error("exploratory replay proposal is invalid: {0}")]
    InvalidProposal(&'static str),
    #[error("R&D exploratory replay custody unavailable: {0}")]
    Unavailable(String),
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    type ProposalMutation = Box<dyn Fn(&mut ExploratoryReplayRequestProposalV1)>;

    fn digest(identity: &str, byte: char) -> IdentityDigestV1 {
        IdentityDigestV1 {
            identity: identity.into(),
            digest: format!("sha256:{}", byte.to_string().repeat(64)),
        }
    }

    fn proposal() -> ExploratoryReplayRequestProposalV1 {
        ExploratoryReplayRequestProposalV1 {
            request_identity: "request-1".into(),
            build_request_identity: "build-request-1".into(),
            attempt_identity: "attempt-1".into(),
            intent_identity: "intent-1".into(),
            trial_family_identity: "family-1".into(),
            artifact_identity: "artifact-1".into(),
            build_receipt_identity: "build-receipt-1".into(),
            artifact_family_binding_identity: "binding-1".into(),
            census_frontier_identity: "frontier-1".into(),
            requested_pit_scope: digest("pit-1", '1'),
            dataset: digest("dataset-1", '2'),
            feature_set: digest("features-1", '3'),
            strategy_spec: digest("spec-1", '4'),
            exact_code_bytes_digest: format!("sha256:{}", "5".repeat(64)),
            replay_config: digest("replay-1", '6'),
            runtime_kernel: VersionedIdentityV1 {
                identity: "kernel-1".into(),
                version: "1".into(),
            },
            simulator: VersionedIdentityV1 {
                identity: "simulator-1".into(),
                version: "1".into(),
            },
            backtest_engine: VersionedIdentityV1 {
                identity: "backtest-1".into(),
                version: "1".into(),
            },
            cost_model_identity: "cost-1".into(),
            slippage_model_identity: "slippage-1".into(),
            capacity_model_identity: "capacity-1".into(),
            deterministic_seed: 1,
            range_start_epoch_ms: 1,
            range_end_epoch_ms: 2,
            calendar_identity: "calendar-1".into(),
            time_zone_identity: "UTC".into(),
        }
    }

    #[rstest]
    fn every_replay_binding_changes_the_canonical_proposal_digest() {
        let original = proposal();
        let expected = exploratory_replay_proposal_digest_v1(&original).unwrap();
        let mut mutations: Vec<ProposalMutation> = vec![
            Box::new(|v| v.request_identity.push('x')),
            Box::new(|v| v.build_request_identity.push('x')),
            Box::new(|v| v.attempt_identity.push('x')),
            Box::new(|v| v.intent_identity.push('x')),
            Box::new(|v| v.trial_family_identity.push('x')),
            Box::new(|v| v.artifact_identity.push('x')),
            Box::new(|v| v.build_receipt_identity.push('x')),
            Box::new(|v| v.artifact_family_binding_identity.push('x')),
            Box::new(|v| v.census_frontier_identity.push('x')),
            Box::new(|v| v.requested_pit_scope.identity.push('x')),
            Box::new(|v| v.requested_pit_scope.digest.push('x')),
            Box::new(|v| v.dataset.identity.push('x')),
            Box::new(|v| v.dataset.digest.push('x')),
            Box::new(|v| v.feature_set.identity.push('x')),
            Box::new(|v| v.feature_set.digest.push('x')),
            Box::new(|v| v.strategy_spec.identity.push('x')),
            Box::new(|v| v.strategy_spec.digest.push('x')),
            Box::new(|v| v.exact_code_bytes_digest.push('x')),
            Box::new(|v| v.replay_config.identity.push('x')),
            Box::new(|v| v.replay_config.digest.push('x')),
            Box::new(|v| v.runtime_kernel.identity.push('x')),
            Box::new(|v| v.runtime_kernel.version.push('x')),
            Box::new(|v| v.simulator.identity.push('x')),
            Box::new(|v| v.simulator.version.push('x')),
            Box::new(|v| v.backtest_engine.identity.push('x')),
            Box::new(|v| v.backtest_engine.version.push('x')),
            Box::new(|v| v.cost_model_identity.push('x')),
            Box::new(|v| v.slippage_model_identity.push('x')),
            Box::new(|v| v.capacity_model_identity.push('x')),
            Box::new(|v| v.deterministic_seed += 1),
            Box::new(|v| v.range_start_epoch_ms += 1),
            Box::new(|v| v.range_end_epoch_ms += 1),
            Box::new(|v| v.calendar_identity.push('x')),
            Box::new(|v| v.time_zone_identity.push('x')),
        ];

        for mutate in mutations.drain(..) {
            let mut changed = original.clone();
            mutate(&mut changed);
            assert_ne!(
                exploratory_replay_proposal_digest_v1(&changed).unwrap(),
                expected
            );
        }
    }

    #[rstest]
    fn unknown_projection_statuses_fail_closed() {
        assert!(serde_json::from_str::<ExploratoryReplayAvailabilityV1>("\"FUTURE\"").is_err());
        assert!(serde_json::from_str::<ExploratoryReplayNextLegalActionV1>("\"FUTURE\"").is_err());
    }
}
