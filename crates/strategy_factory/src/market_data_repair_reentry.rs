//! R&D authority to form a request-equal Replay after a usable Market Data repair.

#![allow(
    dead_code,
    reason = "the crate-private repaired-request former awaits T156c Owner composition"
)]

use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_backtest_owner_contracts::{
    CanonicalDigestV2, ContentIdentityV2, OpaqueIdentityV2, ReplayRequestV2,
};
use vibe_data::owner::source_binding::BindingDigest;

use crate::{
    MarketDataRepairResolutionReadbackV1,
    exploratory_replay::{ExploratoryReplayRequestLocatorV2, SealedExploratoryReplayReadbackV2},
    market_data_repair_resolution::{
        MarketDataRepairResolutionDispositionV1, RepairedMarketDataSnapshotV1,
    },
};

const AUTHORITY_DOMAIN_V1: &str = "rd.market-data-repair-replay-reentry-authority.v1";
const REQUEST_IDENTITY_DOMAIN_V1: &str = "rd.market-data-repaired-replay-request-identity.v1";

/// Move-only authority for the later R&D Owner composition of one repaired Replay request.
/// It is not a Replay Request and cannot invoke Backtest.
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct MarketDataRepairReplayReentryAuthorityV1 {
    schema_version: u16,
    authority_identity: String,
    authority_digest: String,
    predecessor_replay: ExploratoryReplayRequestLocatorV2,
    decision_identity: String,
    repair_request_identity: String,
    repair_request_digest: String,
    market_data_terminal_identity: String,
    market_data_terminal_digest: String,
    resolution_identity: String,
    resolution_digest: String,
    resolution_committed_at_epoch_ms: u64,
    correlation_identity: BindingDigest,
    repaired_snapshot_identity: BindingDigest,
    repaired_normalized_records_digest: BindingDigest,
}

/// One request-equal Replay V2 request bound to the exact repaired-result authority.
///
/// The wrapper is move-only and cannot be deserialized into positive R&D custody.
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct MarketDataRepairedReplayRequestV1 {
    schema_version: u16,
    authority: MarketDataRepairReplayReentryAuthorityV1,
    request: ReplayRequestV2,
}

impl MarketDataRepairedReplayRequestV1 {
    #[must_use]
    pub const fn authority(&self) -> &MarketDataRepairReplayReentryAuthorityV1 {
        &self.authority
    }

    #[must_use]
    pub const fn request(&self) -> &ReplayRequestV2 {
        &self.request
    }

    /// Returns canonical bytes for later append-only R&D custody.
    ///
    /// # Errors
    ///
    /// Returns an encoding error if canonical serialization is unavailable.
    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, MarketDataRepairReplayReentryErrorV1> {
        serde_json::to_vec(self).map_err(encoding)
    }
}

impl MarketDataRepairReplayReentryAuthorityV1 {
    #[must_use]
    pub fn authority_identity(&self) -> &str {
        &self.authority_identity
    }

    #[must_use]
    pub fn authority_digest(&self) -> &str {
        &self.authority_digest
    }

    #[must_use]
    pub const fn predecessor_replay(&self) -> &ExploratoryReplayRequestLocatorV2 {
        &self.predecessor_replay
    }

    #[must_use]
    pub const fn repaired_snapshot_identity(&self) -> BindingDigest {
        self.repaired_snapshot_identity
    }

    #[must_use]
    pub const fn repaired_normalized_records_digest(&self) -> BindingDigest {
        self.repaired_normalized_records_digest
    }

    /// Returns canonical bytes for later append-only R&D custody.
    ///
    /// # Errors
    ///
    /// Returns an encoding error if canonical serialization is unavailable.
    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, MarketDataRepairReplayReentryErrorV1> {
        serde_json::to_vec(self).map_err(encoding)
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum MarketDataRepairReplayReentryErrorV1 {
    #[error("only a persisted REPAIRED Market Data resolution permits Replay re-entry")]
    NotRepaired,
    #[error("the repaired resolution does not belong to the exact predecessor Replay")]
    CustodyMismatch,
    #[error("the repaired snapshot does not advance the predecessor PIT snapshot")]
    SnapshotNotAdvanced,
    #[error("the repaired Replay request cannot be formed: {0}")]
    Request(String),
    #[error("Market Data repair Replay re-entry encoding is unavailable: {0}")]
    Encoding(String),
}

/// Forms the only Replay V2 request admitted by one repaired-result authority.
///
/// All predecessor semantics are copied byte-for-byte. The function derives a new request
/// identity and replaces only the Market Data PIT snapshot. The additive authority carries the
/// repair binding; generic `resolved_owner_inputs` content addressing remains unchanged.
pub(crate) fn form_market_data_repaired_replay_request_v1(
    predecessor: &SealedExploratoryReplayReadbackV2,
    authority: MarketDataRepairReplayReentryAuthorityV1,
) -> Result<MarketDataRepairedReplayRequestV1, MarketDataRepairReplayReentryErrorV1> {
    if authority.predecessor_replay != predecessor.locator() {
        return Err(MarketDataRepairReplayReentryErrorV1::CustodyMismatch);
    }
    let predecessor_request = predecessor.request().as_dto();

    let mut successor = predecessor_request.clone();
    successor.request_identity = repaired_request_identity(&authority)?;
    successor.pit_snapshot = ContentIdentityV2 {
        identity: opaque_binding(authority.repaired_snapshot_identity)?,
        digest: canonical_binding(authority.repaired_normalized_records_digest)?,
    };
    let request = ReplayRequestV2::try_from(successor)
        .map_err(|error| MarketDataRepairReplayReentryErrorV1::Request(error.to_string()))?;
    Ok(MarketDataRepairedReplayRequestV1 {
        schema_version: 1,
        authority,
        request,
    })
}

/// Consumes persisted R&D resolution custody and issues authority for later Replay composition.
///
/// This operation creates no Replay Request, Intent, Selection, effect, or trading action.
pub fn authorize_market_data_repair_replay_reentry_v1(
    predecessor: &SealedExploratoryReplayReadbackV2,
    resolution_readback: MarketDataRepairResolutionReadbackV1,
) -> Result<MarketDataRepairReplayReentryAuthorityV1, MarketDataRepairReplayReentryErrorV1> {
    let committed_at_epoch_ms = resolution_readback.committed_at_epoch_ms();
    let resolution = resolution_readback.into_resolution();
    let repaired = resolution
        .repaired()
        .filter(|_| {
            resolution.disposition() == MarketDataRepairResolutionDispositionV1::Repaired
                && resolution.stop_reason().is_none()
        })
        .ok_or(MarketDataRepairReplayReentryErrorV1::NotRepaired)?;
    validate_predecessor(predecessor, &resolution)?;
    let predecessor_snapshot = &predecessor.request().as_dto().pit_snapshot;
    let repaired_identity = repaired.snapshot_identity();
    let repaired_digest = repaired.normalized_records_digest();
    if predecessor_snapshot.identity.as_str() == binding_identity(repaired_identity)
        && predecessor_snapshot.digest.as_str() == binding_digest(repaired_digest)
    {
        return Err(MarketDataRepairReplayReentryErrorV1::SnapshotNotAdvanced);
    }
    issue_authority(
        predecessor.locator(),
        &resolution,
        repaired,
        committed_at_epoch_ms,
    )
}

fn validate_predecessor(
    predecessor: &SealedExploratoryReplayReadbackV2,
    resolution: &crate::market_data_repair_resolution::MarketDataRepairResearchTerminalV1,
) -> Result<(), MarketDataRepairReplayReentryErrorV1> {
    let reproduced_bytes = predecessor
        .request()
        .to_canonical_bytes()
        .map_err(encoding)?;
    let reproduced_digest = predecessor.request().meaning_digest().map_err(encoding)?;
    let decision_cut = resolution.decision_evidence_cut();
    if reproduced_bytes != predecessor.canonical_request_bytes()
        || reproduced_digest.as_str() != predecessor.meaning_digest()
        || decision_cut.request_identity != predecessor.request_identity()
        || decision_cut.request_digest != predecessor.meaning_digest()
    {
        return Err(MarketDataRepairReplayReentryErrorV1::CustodyMismatch);
    }
    Ok(())
}

fn issue_authority(
    predecessor_replay: ExploratoryReplayRequestLocatorV2,
    resolution: &crate::market_data_repair_resolution::MarketDataRepairResearchTerminalV1,
    repaired: &RepairedMarketDataSnapshotV1,
    resolution_committed_at_epoch_ms: u64,
) -> Result<MarketDataRepairReplayReentryAuthorityV1, MarketDataRepairReplayReentryErrorV1> {
    let meaning = AuthorityMeaningV1 {
        schema_version: 1,
        predecessor_replay: &predecessor_replay,
        decision_identity: resolution.decision_identity(),
        repair_request_identity: resolution.repair_request_identity(),
        repair_request_digest: resolution.repair_request_digest(),
        market_data_terminal_identity: resolution.market_data_terminal_identity(),
        market_data_terminal_digest: resolution.market_data_terminal_digest(),
        resolution_identity: resolution.resolution_identity(),
        resolution_digest: resolution.resolution_digest(),
        resolution_committed_at_epoch_ms,
        correlation_identity: resolution.correlation_identity(),
        repaired_snapshot_identity: repaired.snapshot_identity(),
        repaired_normalized_records_digest: repaired.normalized_records_digest(),
    };
    let authority_digest = digest(&meaning)?;
    Ok(MarketDataRepairReplayReentryAuthorityV1 {
        schema_version: 1,
        authority_identity: format!(
            "rd-market-data-repair-replay-reentry-v1-{}",
            authority_digest.trim_start_matches("sha256:")
        ),
        authority_digest,
        predecessor_replay,
        decision_identity: resolution.decision_identity().to_owned(),
        repair_request_identity: resolution.repair_request_identity().to_owned(),
        repair_request_digest: resolution.repair_request_digest().to_owned(),
        market_data_terminal_identity: resolution.market_data_terminal_identity().to_owned(),
        market_data_terminal_digest: resolution.market_data_terminal_digest().to_owned(),
        resolution_identity: resolution.resolution_identity().to_owned(),
        resolution_digest: resolution.resolution_digest().to_owned(),
        resolution_committed_at_epoch_ms,
        correlation_identity: resolution.correlation_identity(),
        repaired_snapshot_identity: repaired.snapshot_identity(),
        repaired_normalized_records_digest: repaired.normalized_records_digest(),
    })
}

#[derive(Serialize)]
struct AuthorityMeaningV1<'a> {
    schema_version: u16,
    predecessor_replay: &'a ExploratoryReplayRequestLocatorV2,
    decision_identity: &'a str,
    repair_request_identity: &'a str,
    repair_request_digest: &'a str,
    market_data_terminal_identity: &'a str,
    market_data_terminal_digest: &'a str,
    resolution_identity: &'a str,
    resolution_digest: &'a str,
    resolution_committed_at_epoch_ms: u64,
    correlation_identity: BindingDigest,
    repaired_snapshot_identity: BindingDigest,
    repaired_normalized_records_digest: BindingDigest,
}

fn digest(value: &impl Serialize) -> Result<String, MarketDataRepairReplayReentryErrorV1> {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    serde_json::to_vec(&Envelope {
        domain: AUTHORITY_DOMAIN_V1,
        value,
    })
    .map(|bytes| format!("sha256:{:x}", Sha256::digest(bytes)))
    .map_err(encoding)
}

fn binding_identity(value: BindingDigest) -> String {
    format!("sha256:{}", hex(value))
}

fn binding_digest(value: BindingDigest) -> String {
    format!("sha256:{}", hex(value))
}

fn repaired_request_identity(
    authority: &MarketDataRepairReplayReentryAuthorityV1,
) -> Result<OpaqueIdentityV2, MarketDataRepairReplayReentryErrorV1> {
    #[derive(Serialize)]
    struct Meaning<'a> {
        authority_digest: &'a str,
    }
    let bytes = serde_json::to_vec(&Meaning {
        authority_digest: authority.authority_digest(),
    })
    .map_err(encoding)?;
    let mut hasher = Sha256::new();
    hasher.update(REQUEST_IDENTITY_DOMAIN_V1.as_bytes());
    hasher.update([0]);
    hasher.update(bytes);
    OpaqueIdentityV2::try_from(format!(
        "rd-market-data-repaired-replay-v1-{:x}",
        hasher.finalize()
    ))
    .map_err(|error| MarketDataRepairReplayReentryErrorV1::Request(error.to_string()))
}

fn opaque_binding(
    value: BindingDigest,
) -> Result<OpaqueIdentityV2, MarketDataRepairReplayReentryErrorV1> {
    OpaqueIdentityV2::try_from(binding_identity(value))
        .map_err(|error| MarketDataRepairReplayReentryErrorV1::Request(error.to_string()))
}

fn canonical_binding(
    value: BindingDigest,
) -> Result<CanonicalDigestV2, MarketDataRepairReplayReentryErrorV1> {
    CanonicalDigestV2::try_from(binding_digest(value))
        .map_err(|error| MarketDataRepairReplayReentryErrorV1::Request(error.to_string()))
}

fn hex(value: BindingDigest) -> String {
    value
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn encoding(error: impl std::fmt::Display) -> MarketDataRepairReplayReentryErrorV1 {
    MarketDataRepairReplayReentryErrorV1::Encoding(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use vibe_backtest_owner_contracts::{
        CanonicalDigestV2, ContentIdentityV2, OpaqueIdentityV2, ReplayAuthorityClaimV2,
        ReplayModelProfilesV2, ReplayRequestDtoV2, ReplayRequestV2, ReplayWindowV2,
        VersionedIdentityV2,
    };

    fn identity(value: impl Into<String>) -> OpaqueIdentityV2 {
        OpaqueIdentityV2::try_from(value.into()).unwrap()
    }

    fn content(name: &str, value: u8) -> ContentIdentityV2 {
        ContentIdentityV2 {
            identity: identity(name),
            digest: CanonicalDigestV2::try_from(format!("sha256:{}", hex_byte(value))).unwrap(),
        }
    }

    fn version(name: &str) -> VersionedIdentityV2 {
        VersionedIdentityV2 {
            identity: identity(name),
            version: identity("v1"),
        }
    }

    fn hex_byte(value: u8) -> String {
        format!("{value:02x}").repeat(32)
    }

    fn predecessor(request_identity: &str) -> SealedExploratoryReplayReadbackV2 {
        let request = ReplayRequestV2::try_from(ReplayRequestDtoV2 {
            schema_version: 2,
            request_identity: identity(request_identity),
            frozen_research_intent: content("intent", 1),
            trial_family: content("family", 2),
            trial_family_census_frontier: content("census", 3),
            replay_authority: ReplayAuthorityClaimV2::Exploratory,
            strategy_design: content("design", 4),
            strategy_plan: content("plan", 5),
            artifact: content("artifact", 6),
            resolved_owner_inputs: content("owner-inputs", 7),
            pit_scope: content("pit-scope", 8),
            pit_snapshot: content("old-pit-snapshot", 9),
            universe_selection: content("universe", 10),
            correction_rule: version("correction"),
            market_semantics: version("semantics"),
            replay_configuration: content("replay-config", 11),
            models: ReplayModelProfilesV2 {
                runtime_kernel: version("runtime"),
                simulator: version("simulator"),
                cost: version("cost"),
                slippage: version("slippage"),
                capacity: version("capacity"),
            },
            runner_operational_profile: version("runner"),
            diagnostic_policy: version("diagnostic"),
            deterministic_seed: 17,
            window: ReplayWindowV2 {
                start_event_ns: 1,
                end_event_ns_exclusive: 2,
            },
            calendar: version("calendar"),
            session: version("session"),
            time_zone: version("time-zone"),
            corporate_action_cut: content("corporate-actions", 12),
            historical_membership_cut: content("membership", 13),
        })
        .unwrap();
        crate::exploratory_replay::issue_sealed_exploratory_replay_readback_for_acceptance_v2(
            request,
        )
        .unwrap()
    }

    fn readback(
        resolution: crate::market_data_repair_resolution::MarketDataRepairResearchTerminalV1,
    ) -> MarketDataRepairResolutionReadbackV1 {
        MarketDataRepairResolutionReadbackV1::for_test(resolution, 100)
    }

    fn repaired_readback(
        predecessor: &SealedExploratoryReplayReadbackV2,
    ) -> MarketDataRepairResolutionReadbackV1 {
        readback(
            crate::market_data_repair_resolution::tests::repaired_resolution_for_replay_fixture(
                predecessor.request_identity(),
                predecessor.meaning_digest(),
            ),
        )
    }

    fn authority(
        predecessor: &SealedExploratoryReplayReadbackV2,
    ) -> MarketDataRepairReplayReentryAuthorityV1 {
        authorize_market_data_repair_replay_reentry_v1(predecessor, repaired_readback(predecessor))
            .unwrap()
    }

    #[test]
    fn repaired_resolution_issues_deterministic_reentry_authority() {
        let predecessor = predecessor("replay-request");
        let first = authorize_market_data_repair_replay_reentry_v1(
            &predecessor,
            repaired_readback(&predecessor),
        )
        .unwrap();
        let second = authorize_market_data_repair_replay_reentry_v1(
            &predecessor,
            repaired_readback(&predecessor),
        )
        .unwrap();
        assert_eq!(first.to_canonical_bytes(), second.to_canonical_bytes());
        assert_eq!(first.predecessor_replay(), &predecessor.locator());
    }

    #[test]
    fn unavailable_or_wrong_predecessor_creates_no_reentry_authority() {
        assert_eq!(
            authorize_market_data_repair_replay_reentry_v1(
                &predecessor("replay-request"),
                readback(
                    crate::market_data_repair_resolution::tests::unavailable_resolution_fixture()
                ),
            ),
            Err(MarketDataRepairReplayReentryErrorV1::NotRepaired)
        );
        let expected = predecessor("replay-request");
        let wrong = predecessor("different-request");
        assert_eq!(
            authorize_market_data_repair_replay_reentry_v1(&wrong, repaired_readback(&expected)),
            Err(MarketDataRepairReplayReentryErrorV1::CustodyMismatch)
        );
    }

    #[test]
    fn repaired_request_changes_only_identity_and_snapshot() {
        let predecessor = predecessor("replay-request");
        let first =
            form_market_data_repaired_replay_request_v1(&predecessor, authority(&predecessor))
                .unwrap();
        let second =
            form_market_data_repaired_replay_request_v1(&predecessor, authority(&predecessor))
                .unwrap();
        assert_eq!(first.to_canonical_bytes(), second.to_canonical_bytes());
        assert_ne!(
            first.request().request_identity(),
            predecessor.request().request_identity()
        );

        let mut expected = predecessor.request().as_dto().clone();
        expected.request_identity = first.request().as_dto().request_identity.clone();
        expected.pit_snapshot = first.request().as_dto().pit_snapshot.clone();
        assert_eq!(first.request().as_dto(), &expected);
        assert_eq!(
            first.request().as_dto().pit_snapshot.identity.as_str(),
            binding_identity(first.authority().repaired_snapshot_identity())
        );
        assert_eq!(
            first.request().as_dto().pit_snapshot.digest.as_str(),
            binding_digest(first.authority().repaired_normalized_records_digest())
        );
    }
}
