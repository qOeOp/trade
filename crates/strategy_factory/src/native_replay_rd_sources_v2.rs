//! Move-only R&D Owner source carriers for Native Replay observation issuance.

use thiserror::Error;
use vibe_product_edge::ProductEdgeAdmissionReadbackV1;

use crate::{
    exploratory_replay::SealedExploratoryReplayReadbackV2,
    product_edge::ResearchRequestDisposition, rd_owner_postgres_custody::VerifiedResearchCustodyV1,
};

/// Stable name of one exact R&D-produced source record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeReplayRdSourceKindV2 {
    ProductEdgeAdmission,
    ResearchRequestCustody,
    ResearchRequestReceipt,
    FrozenResearchIntent,
    TrialFamilyRoot,
    TrialFamilyRootReceipt,
    TrialFamilyInitialIntentMember,
    TrialFamilyMembershipReceipt,
    TrialFamilyCensusFrontier,
    ExploratoryReplayRequest,
    ExploratoryReplayReceipt,
    ExploratoryReplayOutbox,
}

/// One exact canonical byte record retained inside the R&D producer bundle.
pub struct NativeReplayRdSourceRecordV2 {
    kind: NativeReplayRdSourceKindV2,
    canonical_bytes: Vec<u8>,
    owner_storage_digest: String,
}

impl NativeReplayRdSourceRecordV2 {
    #[must_use]
    pub const fn kind(&self) -> NativeReplayRdSourceKindV2 {
        self.kind
    }

    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    #[must_use]
    pub fn owner_storage_digest(&self) -> &str {
        &self.owner_storage_digest
    }
}

pub(crate) const PRODUCT_EDGE_ADMISSION_STORAGE_DOMAIN_V1: &str =
    "product-edge.admission-readback.storage.v1";
pub(crate) const RESEARCH_REQUEST_STORAGE_DOMAIN_V1: &str = "rd.research-request.storage.v1";
pub(crate) const RESEARCH_RECEIPT_STORAGE_DOMAIN_V1: &str = "rd.research-receipt.storage.v1";
pub(crate) const RESEARCH_INTENT_STORAGE_DOMAIN_V1: &str = "rd.research-intent.storage.v1";
pub(crate) const TRIAL_FAMILY_ROOT_STORAGE_DOMAIN_V1: &str = "rd.trial-family-root.storage.v1";
pub(crate) const TRIAL_FAMILY_ROOT_RECEIPT_STORAGE_DOMAIN_V1: &str =
    "rd.trial-family-root-receipt.storage.v1";
pub(crate) const TRIAL_FAMILY_MEMBER_STORAGE_DOMAIN_V1: &str = "rd.trial-family-member.storage.v1";
pub(crate) const TRIAL_FAMILY_MEMBERSHIP_RECEIPT_STORAGE_DOMAIN_V1: &str =
    "rd.trial-family-membership-receipt.storage.v1";
pub(crate) const TRIAL_FAMILY_FRONTIER_STORAGE_DOMAIN_V1: &str =
    "rd.trial-family-frontier.storage.v1";
pub(crate) const REPLAY_REQUEST_STORAGE_DOMAIN_V1: &str = "rd.replay-request.storage.v1";
pub(crate) const REPLAY_RECEIPT_STORAGE_DOMAIN_V1: &str = "rd.replay-receipt.storage.v1";
pub(crate) const REPLAY_OUTBOX_STORAGE_DOMAIN_V1: &str = "rd.replay-outbox.storage.v1";
pub(crate) const REPLAY_OUTBOX_ENVELOPE_STORAGE_DOMAIN_V1: &str =
    "rd.replay-outbox-envelope.storage.v1";

pub(crate) fn owner_storage_digest(domain: &str, bytes: &[u8]) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain.as_bytes());
    hasher.update(&[0]);
    hasher.update(bytes);
    format!("blake3:{}", hasher.finalize().to_hex())
}

pub(crate) struct StoredSourceRecordV2 {
    pub(crate) bytes: Vec<u8>,
    pub(crate) digest: String,
}

pub(crate) struct NativeReplayStoredRowsV2 {
    pub(crate) research_request: StoredSourceRecordV2,
    pub(crate) research_receipt: StoredSourceRecordV2,
    pub(crate) research_intent: StoredSourceRecordV2,
    pub(crate) trial_family_root: StoredSourceRecordV2,
    pub(crate) trial_family_root_receipt: StoredSourceRecordV2,
    pub(crate) trial_family_initial_member: StoredSourceRecordV2,
    pub(crate) trial_family_membership_receipt: StoredSourceRecordV2,
    pub(crate) trial_family_frontier: StoredSourceRecordV2,
    pub(crate) replay_request: StoredSourceRecordV2,
    pub(crate) replay_receipt: StoredSourceRecordV2,
    pub(crate) replay_outbox: StoredSourceRecordV2,
}

/// A single move-only carrier issued from one locked and cross-bound R&D custody cut.
///
/// Callers cannot construct or destructure the bundle:
///
/// ```compile_fail
/// use vibe_strategy_factory::NativeReplayRdSourcesV2;
/// let _ = NativeReplayRdSourcesV2 {};
/// ```
///
/// It cannot be cloned or deserialized:
///
/// ```compile_fail
/// use vibe_strategy_factory::NativeReplayRdSourcesV2;
/// fn require_clone<T: Clone>() {}
/// require_clone::<NativeReplayRdSourcesV2>();
/// ```
///
/// ```compile_fail
/// use vibe_strategy_factory::NativeReplayRdSourcesV2;
/// fn require_deserialize<T: for<'de> serde::Deserialize<'de>>() {}
/// require_deserialize::<NativeReplayRdSourcesV2>();
/// ```
pub struct NativeReplayRdSourcesV2 {
    request_locator: crate::exploratory_replay::ExploratoryReplayRequestLocatorV2,
    product_edge_admission: NativeReplayRdSourceRecordV2,
    research_request_custody: NativeReplayRdSourceRecordV2,
    research_request_receipt: NativeReplayRdSourceRecordV2,
    frozen_research_intent: NativeReplayRdSourceRecordV2,
    trial_family_root: NativeReplayRdSourceRecordV2,
    trial_family_root_receipt: NativeReplayRdSourceRecordV2,
    trial_family_initial_intent_member: NativeReplayRdSourceRecordV2,
    trial_family_membership_receipt: NativeReplayRdSourceRecordV2,
    trial_family_census_frontier: NativeReplayRdSourceRecordV2,
    exploratory_replay_request: NativeReplayRdSourceRecordV2,
    exploratory_replay_receipt: NativeReplayRdSourceRecordV2,
    exploratory_replay_outbox: NativeReplayRdSourceRecordV2,
}

macro_rules! record_accessors {
    ($($name:ident),+ $(,)?) => {$(
        #[must_use]
        pub const fn $name(&self) -> &NativeReplayRdSourceRecordV2 {
            &self.$name
        }
    )+};
}

impl NativeReplayRdSourcesV2 {
    #[must_use]
    pub const fn request_locator(
        &self,
    ) -> &crate::exploratory_replay::ExploratoryReplayRequestLocatorV2 {
        &self.request_locator
    }

    /// Returns the same unique Product Edge Owner record used as Replay authority evidence.
    #[must_use]
    pub const fn replay_authority(&self) -> &NativeReplayRdSourceRecordV2 {
        &self.product_edge_admission
    }

    record_accessors!(
        product_edge_admission,
        research_request_custody,
        research_request_receipt,
        frozen_research_intent,
        trial_family_root,
        trial_family_root_receipt,
        trial_family_initial_intent_member,
        trial_family_membership_receipt,
        trial_family_census_frontier,
        exploratory_replay_request,
        exploratory_replay_receipt,
        exploratory_replay_outbox,
    );
}

#[derive(Debug, Error)]
pub enum NativeReplayRdSourcesErrorV2 {
    #[error("R&D Native Replay source custody unavailable: {0}")]
    Unavailable(String),
}

fn bytes_record(
    kind: NativeReplayRdSourceKindV2,
    domain: &str,
    canonical_bytes: &[u8],
    stored_digest: &str,
) -> Result<NativeReplayRdSourceRecordV2, NativeReplayRdSourcesErrorV2> {
    if canonical_bytes.is_empty() || owner_storage_digest(domain, canonical_bytes) != stored_digest
    {
        return Err(NativeReplayRdSourcesErrorV2::Unavailable(format!(
            "{kind:?} canonical storage unavailable"
        )));
    }
    Ok(NativeReplayRdSourceRecordV2 {
        kind,
        canonical_bytes: canonical_bytes.to_vec(),
        owner_storage_digest: stored_digest.to_string(),
    })
}

fn verify_rd_lineage_v2(
    request: &vibe_backtest_owner_contracts::ReplayRequestV2,
    intent: &crate::product_edge::FrozenResearchGoalIntent,
    research_receipt: &crate::product_edge::ResearchRequestReceiptV1,
    family: &crate::trial_family::TrialFamilyReadbackV1,
) -> Result<(), NativeReplayRdSourcesErrorV2> {
    let crate::product_edge::FrozenResearchGoalIntent::V2(intent_v2) = intent else {
        return Err(NativeReplayRdSourcesErrorV2::Unavailable(
            "Replay V2 requires frozen Research intent V2".into(),
        ));
    };
    let request_dto = request.as_dto();
    let root = family.root();
    let member = family.initial_intent_member();
    let frontier = family.census_frontier();
    if research_receipt.disposition != ResearchRequestDisposition::Accepted
        || research_receipt.request_identity != intent.request_identity()
        || research_receipt.semantic_digest != intent.semantic_digest()
        || research_receipt
            .resulting_research_intent_identity
            .as_deref()
            != Some(intent.intent_identity())
        || request_dto.frozen_research_intent.identity.as_str() != intent.intent_identity()
        || request_dto.frozen_research_intent.digest.as_str() != intent.semantic_digest()
        || request_dto.trial_family.identity.as_str() != root.trial_family_identity()
        || request_dto.trial_family.digest.as_str() != root.root_digest()
        || intent_v2.trial_family_identity != root.trial_family_identity()
        || intent_v2.trial_family_policy_digest != root.policy_digest()
        || request_dto.trial_family_census_frontier.identity.as_str()
            != frontier.frontier_identity()
        || request_dto.trial_family_census_frontier.digest.as_str() != frontier.frontier_digest()
        || root.root_digest() != family.root_receipt().root_digest()
        || family.root_receipt().intent_identity() != intent.intent_identity()
        || member.fact_identity() != intent.intent_identity()
        || member.fact_digest() != intent.semantic_digest()
        || frontier.member_digests().len() != 1
        || frontier.member_digests()[0] != member.member_digest()
    {
        return Err(NativeReplayRdSourcesErrorV2::Unavailable(
            "cross-request R&D source composition mismatch".into(),
        ));
    }
    Ok(())
}

pub(crate) fn issue_native_replay_rd_sources_v2(
    replay: &SealedExploratoryReplayReadbackV2,
    replay_admission: &ProductEdgeAdmissionReadbackV1,
    research: &VerifiedResearchCustodyV1,
    stored: NativeReplayStoredRowsV2,
) -> Result<NativeReplayRdSourcesV2, NativeReplayRdSourcesErrorV2> {
    let request = replay.request();
    let intent = research.intent().ok_or_else(|| {
        NativeReplayRdSourcesErrorV2::Unavailable("frozen Research intent missing".into())
    })?;
    let family = research.family().ok_or_else(|| {
        NativeReplayRdSourcesErrorV2::Unavailable("TrialFamily custody missing".into())
    })?;
    let research_admission = research.product_edge_admission().ok_or_else(|| {
        NativeReplayRdSourcesErrorV2::Unavailable("Research Product Edge admission missing".into())
    })?;
    let _research_request = research.request_json().ok_or_else(|| {
        NativeReplayRdSourcesErrorV2::Unavailable(
            "canonical Research request custody missing".into(),
        )
    })?;
    let research_receipt = research.receipt();
    let exact_request_bytes = request.to_canonical_bytes().map_err(|error| {
        NativeReplayRdSourcesErrorV2::Unavailable(format!(
            "Replay request canonicalization failed: {error}"
        ))
    })?;
    if exact_request_bytes != replay.canonical_request_bytes()
        || replay.product_edge_admission() != replay_admission.locator()
        || replay_admission.locator().request_identity != replay.request_identity()
        || !crate::exploratory_replay::postgres::same_product_edge_authority(
            replay_admission,
            research_admission,
        )
        || research.request_schema_version() != 2
    {
        return Err(NativeReplayRdSourcesErrorV2::Unavailable(
            "cross-request R&D source composition mismatch".into(),
        ));
    }
    verify_rd_lineage_v2(request, intent, research_receipt, family)?;

    Ok(NativeReplayRdSourcesV2 {
        request_locator: replay.locator(),
        product_edge_admission: bytes_record(
            NativeReplayRdSourceKindV2::ProductEdgeAdmission,
            PRODUCT_EDGE_ADMISSION_STORAGE_DOMAIN_V1,
            replay_admission.canonical_storage_bytes(),
            replay_admission.canonical_storage_digest(),
        )?,
        research_request_custody: bytes_record(
            NativeReplayRdSourceKindV2::ResearchRequestCustody,
            RESEARCH_REQUEST_STORAGE_DOMAIN_V1,
            &stored.research_request.bytes,
            &stored.research_request.digest,
        )?,
        research_request_receipt: bytes_record(
            NativeReplayRdSourceKindV2::ResearchRequestReceipt,
            RESEARCH_RECEIPT_STORAGE_DOMAIN_V1,
            &stored.research_receipt.bytes,
            &stored.research_receipt.digest,
        )?,
        frozen_research_intent: bytes_record(
            NativeReplayRdSourceKindV2::FrozenResearchIntent,
            RESEARCH_INTENT_STORAGE_DOMAIN_V1,
            &stored.research_intent.bytes,
            &stored.research_intent.digest,
        )?,
        trial_family_root: bytes_record(
            NativeReplayRdSourceKindV2::TrialFamilyRoot,
            TRIAL_FAMILY_ROOT_STORAGE_DOMAIN_V1,
            &stored.trial_family_root.bytes,
            &stored.trial_family_root.digest,
        )?,
        trial_family_root_receipt: bytes_record(
            NativeReplayRdSourceKindV2::TrialFamilyRootReceipt,
            TRIAL_FAMILY_ROOT_RECEIPT_STORAGE_DOMAIN_V1,
            &stored.trial_family_root_receipt.bytes,
            &stored.trial_family_root_receipt.digest,
        )?,
        trial_family_initial_intent_member: bytes_record(
            NativeReplayRdSourceKindV2::TrialFamilyInitialIntentMember,
            TRIAL_FAMILY_MEMBER_STORAGE_DOMAIN_V1,
            &stored.trial_family_initial_member.bytes,
            &stored.trial_family_initial_member.digest,
        )?,
        trial_family_membership_receipt: bytes_record(
            NativeReplayRdSourceKindV2::TrialFamilyMembershipReceipt,
            TRIAL_FAMILY_MEMBERSHIP_RECEIPT_STORAGE_DOMAIN_V1,
            &stored.trial_family_membership_receipt.bytes,
            &stored.trial_family_membership_receipt.digest,
        )?,
        trial_family_census_frontier: bytes_record(
            NativeReplayRdSourceKindV2::TrialFamilyCensusFrontier,
            TRIAL_FAMILY_FRONTIER_STORAGE_DOMAIN_V1,
            &stored.trial_family_frontier.bytes,
            &stored.trial_family_frontier.digest,
        )?,
        exploratory_replay_request: bytes_record(
            NativeReplayRdSourceKindV2::ExploratoryReplayRequest,
            REPLAY_REQUEST_STORAGE_DOMAIN_V1,
            &stored.replay_request.bytes,
            &stored.replay_request.digest,
        )?,
        exploratory_replay_receipt: bytes_record(
            NativeReplayRdSourceKindV2::ExploratoryReplayReceipt,
            REPLAY_RECEIPT_STORAGE_DOMAIN_V1,
            &stored.replay_receipt.bytes,
            &stored.replay_receipt.digest,
        )?,
        exploratory_replay_outbox: bytes_record(
            NativeReplayRdSourceKindV2::ExploratoryReplayOutbox,
            REPLAY_OUTBOX_ENVELOPE_STORAGE_DOMAIN_V1,
            &stored.replay_outbox.bytes,
            &stored.replay_outbox.digest,
        )?,
    })
}

#[cfg(test)]
mod tests {
    use vibe_backtest_owner_contracts::{
        CanonicalDigestV2, ContentIdentityV2, OpaqueIdentityV2, ReplayAuthorityClaimV2,
        ReplayModelProfilesV2, ReplayRequestDtoV2, ReplayRequestV2, ReplayWindowV2,
        VersionedIdentityV2,
    };

    use super::*;
    use crate::{
        product_edge::{
            FrozenResearchGoalIntent, FrozenResearchGoalIntentV2, ResearchRequestReceiptV1,
        },
        trial_family::{
            TrialFamilyIndependenceDispositionV1, TrialFamilyPolicyV1, form_initial_family,
        },
    };

    fn opaque(value: &str) -> OpaqueIdentityV2 {
        OpaqueIdentityV2::try_from(value.to_string()).unwrap()
    }

    fn digest(byte: char) -> String {
        format!("sha256:{}", byte.to_string().repeat(64))
    }

    fn content(identity: &str, digest_byte: char) -> ContentIdentityV2 {
        ContentIdentityV2 {
            identity: opaque(identity),
            digest: CanonicalDigestV2::try_from(digest(digest_byte)).unwrap(),
        }
    }

    fn version(identity: &str) -> VersionedIdentityV2 {
        VersionedIdentityV2 {
            identity: opaque(identity),
            version: opaque("v1"),
        }
    }

    fn family(
        intent_identity: &str,
        intent_digest: &str,
    ) -> crate::trial_family::TrialFamilyReadbackV1 {
        form_initial_family(
            intent_identity,
            intent_digest,
            TrialFamilyPolicyV1 {
                trial_budget: 1,
                stop_rule: "one-terminal-attempt".into(),
                pit_rule_identity: "pit-rule-v1".into(),
                cost_model_identity: "cost-v1".into(),
                slippage_model_identity: "slippage-v1".into(),
                capacity_model_identity: "capacity-v1".into(),
                semantic_predecessor_frontier: Vec::new(),
                protected_feedback_frontier: "feedback-v1".into(),
                independence_disposition: TrialFamilyIndependenceDispositionV1::Independent,
                independence_basis_identity: "basis-v1".into(),
                frozen_falsifier_binding: digest('f'),
                replay_execution_policy_v2: None,
                replay_policy_catalog_v3: None,
                decision_policy_v1: None,
            },
            7,
        )
        .unwrap()
    }

    fn intent(
        identity: &str,
        semantic_digest: &str,
        family: &crate::trial_family::TrialFamilyReadbackV1,
    ) -> FrozenResearchGoalIntent {
        FrozenResearchGoalIntent::V2(FrozenResearchGoalIntentV2 {
            schema_version: 2,
            intent_identity: identity.into(),
            request_identity: "research-request-v2".into(),
            semantic_digest: semantic_digest.into(),
            source_frontier: Vec::new(),
            goal: crate::product_edge::SourcedResearchGoalV2 {
                hypothesis: "h".into(),
                mechanism: "m".into(),
                falsification_question: "f".into(),
                expected_observation: "o".into(),
                required_data: vec!["d".into()],
                cost_assumption: "c".into(),
                capacity_assumption: "c".into(),
                sources: Vec::new(),
            },
            independence_basis_identity: "basis-v1".into(),
            independence_basis_digest: digest('b'),
            protected_feedback_projection_identity: "feedback-v1".into(),
            protected_feedback_projection_digest: digest('c'),
            trial_family_identity: family.root().trial_family_identity().into(),
            trial_family_policy_digest: family.root().policy_digest().into(),
            frozen_at_epoch_ms: 7,
        })
    }

    fn receipt(intent_identity: &str, semantic_digest: &str) -> ResearchRequestReceiptV1 {
        ResearchRequestReceiptV1 {
            schema_version: 1,
            receipt_identity: "research-receipt-v2".into(),
            request_identity: "research-request-v2".into(),
            semantic_digest: semantic_digest.into(),
            disposition: ResearchRequestDisposition::Accepted,
            resulting_research_intent_identity: Some(intent_identity.into()),
            committed_at_epoch_ms: 7,
            rejection_code: None,
        }
    }

    fn replay(
        intent_identity: &str,
        intent_digest: &str,
        family: &crate::trial_family::TrialFamilyReadbackV1,
    ) -> ReplayRequestV2 {
        ReplayRequestV2::try_from(ReplayRequestDtoV2 {
            schema_version: 2,
            request_identity: opaque("replay-request-v2"),
            frozen_research_intent: ContentIdentityV2 {
                identity: opaque(intent_identity),
                digest: CanonicalDigestV2::try_from(intent_digest.to_string()).unwrap(),
            },
            trial_family: ContentIdentityV2 {
                identity: opaque(family.root().trial_family_identity()),
                digest: CanonicalDigestV2::try_from(family.root().root_digest().to_string())
                    .unwrap(),
            },
            trial_family_census_frontier: ContentIdentityV2 {
                identity: opaque(family.census_frontier().frontier_identity()),
                digest: CanonicalDigestV2::try_from(
                    family.census_frontier().frontier_digest().to_string(),
                )
                .unwrap(),
            },
            replay_authority: ReplayAuthorityClaimV2::Exploratory,
            strategy_design: content("design-v2", '1'),
            strategy_plan: content("plan-v2", '2'),
            artifact: content("artifact-v2", '3'),
            resolved_owner_inputs: content("inputs-v2", '4'),
            pit_scope: content("pit-scope-v2", '5'),
            pit_snapshot: content("pit-snapshot-v2", '6'),
            universe_selection: content("universe-v2", '7'),
            correction_rule: version("correction-v2"),
            market_semantics: version("market-v2"),
            replay_configuration: content("config-v2", '8'),
            models: ReplayModelProfilesV2 {
                runtime_kernel: version("kernel-v2"),
                simulator: version("simulator-v2"),
                cost: version("cost-v2"),
                slippage: version("slippage-v2"),
                capacity: version("capacity-v2"),
            },
            runner_operational_profile: version("runner-v2"),
            diagnostic_policy: version("diagnostic-v2"),
            deterministic_seed: 9,
            window: ReplayWindowV2 {
                start_event_ns: 1,
                end_event_ns_exclusive: 2,
            },
            calendar: version("calendar-v2"),
            session: version("session-v2"),
            time_zone: version("timezone-v2"),
            corporate_action_cut: content("actions-v2", '9'),
            historical_membership_cut: content("membership-v2", 'a'),
        })
        .unwrap()
    }

    #[test]
    fn exact_lineage_accepts_and_tampered_intent_fails_closed() {
        let intent_digest = digest('0');
        let family = family("intent-v2", &intent_digest);
        let intent = intent("intent-v2", &intent_digest, &family);
        let replay = replay("intent-v2", &intent_digest, &family);
        let receipt = receipt("intent-v2", &intent_digest);
        verify_rd_lineage_v2(&replay, &intent, &receipt, &family).unwrap();

        let mut tampered = intent.clone();
        let FrozenResearchGoalIntent::V2(tampered_v2) = &mut tampered else {
            unreachable!()
        };
        tampered_v2.semantic_digest = digest('e');
        assert!(verify_rd_lineage_v2(&replay, &tampered, &receipt, &family).is_err());
    }

    #[test]
    fn cross_family_splice_and_missing_exact_bytes_fail_closed() {
        let intent_digest = digest('0');
        let family_a = family("intent-v2", &intent_digest);
        let intent = intent("intent-v2", &intent_digest, &family_a);
        let family_b = family("intent-b", &digest('b'));
        let replay = replay("intent-v2", &intent_digest, &family_a);
        let receipt = receipt("intent-v2", &intent_digest);
        assert!(verify_rd_lineage_v2(&replay, &intent, &receipt, &family_b).is_err());
        assert!(
            bytes_record(
                NativeReplayRdSourceKindV2::ExploratoryReplayOutbox,
                REPLAY_OUTBOX_STORAGE_DOMAIN_V1,
                &[],
                ""
            )
            .is_err()
        );
    }

    #[test]
    fn stored_record_preserves_exact_canonical_bytes_and_digest() {
        let value = serde_json::json!({"request_identity":"research-request-v2","ordinal":1});
        let expected = serde_json::to_vec(&value).unwrap();
        let digest = owner_storage_digest(RESEARCH_REQUEST_STORAGE_DOMAIN_V1, &expected);
        let record = bytes_record(
            NativeReplayRdSourceKindV2::ResearchRequestCustody,
            RESEARCH_REQUEST_STORAGE_DOMAIN_V1,
            &expected,
            &digest,
        )
        .unwrap();
        assert_eq!(record.canonical_bytes(), expected);
        assert_eq!(record.owner_storage_digest(), digest);
        assert!(
            bytes_record(
                NativeReplayRdSourceKindV2::ResearchRequestCustody,
                RESEARCH_REQUEST_STORAGE_DOMAIN_V1,
                &expected,
                &owner_storage_digest(RESEARCH_RECEIPT_STORAGE_DOMAIN_V1, &expected),
            )
            .is_err()
        );
    }
}
