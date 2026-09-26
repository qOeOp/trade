use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use std::fmt::Display;
use vibe_backtest_owner_contracts::{
    CanonicalDigestV2, ContentIdentityV2, OpaqueIdentityV2, ReplayAuthorityClaimV2,
    ReplayModelProfilesV2, ReplayNamespaceV2, ReplayRequestDtoV2, ReplayRequestV2,
};
use vibe_data::owner::{
    replay_market_facts_v2::{
        ReplayMarketDependencyKindV2, ReplayMarketFactsShapeV2, ReplayMarketFactsV2,
        ResolvedReplayCompositionCutV1,
    },
    source_binding::BindingDigest,
};

use crate::{
    composer_artifact_family_binding_v3::ComposerArtifactFamilyReadbackV3,
    composer_replay_intent_v3::{ComposerReplayIntentV3, hex, parse_named_sha256},
    design_input_custody_v1::reread_design_universe_frame_digest_v1,
    develop_composer_postgres_v2::SealedDevelopComposerReadbackV2,
    exploratory_replay::{
        ComposerBackedExploratoryReplayProposalV3, ComposerReplayShapeRefusalV1,
        ExploratoryReplayOwnerError,
    },
    product_edge::{
        ResearchExplorationViewV1, ResearchViewAvailability, ResearchViewV1,
        canonical_research_view_identity_v2, project_composer_exploration_research_view_v3,
    },
    replay_execution_profile_binding_v1::ReplayExecutionProfileRequestSealV1,
    trial_family::TrialFamilyCensusReadbackV2,
};

/// The Composer source of a COMPOSER_V3 Replay.
///
/// Its schema records the shape of the Replay composition cut it was composed from. Schema 3 is
/// the first corpus and carries all three Instrument Master fields; schema 4 is the universe-member
/// shape, which binds no Instrument Master at composition, and carries none of them, so it never
/// records an Instrument Master as verified. Absent fields are not serialized, so a schema 3
/// source's bytes are those it had before schema 4 existed.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoredComposerReplaySourceV3 {
    pub(super) schema_version: u16,
    pub(super) proposal: ComposerBackedExploratoryReplayProposalV3,
    pub(super) trial_family_root_receipt_identity: String,
    pub(super) trial_family_root_digest: String,
    pub(super) trial_family_member_identity: String,
    pub(super) trial_family_member_digest: String,
    pub(super) census_frontier_identity: String,
    pub(super) census_frontier_digest: String,
    pub(super) composer_request_digest: BindingDigest,
    pub(super) artifact_family_binding_identity: String,
    pub(super) artifact_family_binding_digest: String,
    pub(super) artifact_family_binding_receipt_identity: String,
    pub(super) intent_identity: String,
    pub(super) intent_digest: String,
    pub(super) composer_research_request_identity: BindingDigest,
    pub(super) composer_intent_identity: BindingDigest,
    pub(super) composer_design_identity: BindingDigest,
    pub(super) composer_design_bytes_digest: BindingDigest,
    pub(super) composer_plan_bytes_digest: BindingDigest,
    pub(super) composer_artifact_package_bytes_digest: BindingDigest,
    pub(super) market_binding_receipt_identity: BindingDigest,
    pub(super) market_binding_outbox_identity: BindingDigest,
    pub(super) market_facts_identity: BindingDigest,
    pub(super) market_facts_receipt_identity: BindingDigest,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) instrument_master_identity: Option<BindingDigest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) instrument_master_receipt_identity: Option<BindingDigest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) instrument_master_outbox_identity: Option<BindingDigest>,
}

const FIRST_CORPUS_SOURCE_SCHEMA_V3: u16 = 3;
const UNIVERSE_MEMBER_SOURCE_SCHEMA_V3: u16 = 4;

impl StoredComposerReplaySourceV3 {
    /// The shape this source's schema records, refusing a source whose Instrument Master fields
    /// are not exactly those its schema carries.
    pub(super) fn shape(&self) -> Result<ReplayMarketFactsShapeV2, ExploratoryReplayOwnerError> {
        let instrument_master = [
            self.instrument_master_identity,
            self.instrument_master_receipt_identity,
            self.instrument_master_outbox_identity,
        ];

        match self.schema_version {
            FIRST_CORPUS_SOURCE_SCHEMA_V3 if instrument_master.iter().all(Option::is_some) => {
                Ok(ReplayMarketFactsShapeV2::FirstCorpus)
            }
            FIRST_CORPUS_SOURCE_SCHEMA_V3 => Err(shape_refused(
                ComposerReplayShapeRefusalV1::FirstCorpusSourceLacksInstrumentMaster,
            )),
            UNIVERSE_MEMBER_SOURCE_SCHEMA_V3 if instrument_master.iter().all(Option::is_none) => {
                Ok(ReplayMarketFactsShapeV2::UniverseMembers)
            }
            UNIVERSE_MEMBER_SOURCE_SCHEMA_V3 => Err(shape_refused(
                ComposerReplayShapeRefusalV1::UniverseSourceCarriesInstrumentMaster,
            )),
            _ => Err(shape_refused(
                ComposerReplayShapeRefusalV1::UnknownSourceSchema,
            )),
        }
    }

    /// Refuses a stored source whose schema is not the one its composition binding's shape
    /// records, before any of its fields is compared as that shape's evidence.
    pub(super) fn require_binding_shape(
        &self,
        binding_shape: ReplayMarketFactsShapeV2,
    ) -> Result<(), ExploratoryReplayOwnerError> {
        if self.shape()? == binding_shape {
            Ok(())
        } else {
            Err(shape_refused(
                ComposerReplayShapeRefusalV1::SourceSchemaDiffersFromBindingShape,
            ))
        }
    }
}

pub(super) struct ComposedComposerBackedReplayV3 {
    pub(super) request: ReplayRequestDtoV2,
    pub(super) source: StoredComposerReplaySourceV3,
}

pub(super) struct PreparedComposerReplaySealV3 {
    pub(super) canonical_request_bytes: Vec<u8>,
    pub(super) meaning_digest: String,
    pub(super) execution_profile_seal: ReplayExecutionProfileRequestSealV1,
    pub(super) frozen: StoredComposerReplayFrozenV3,
    pub(super) receipt: StoredComposerReplayReceiptV3,
}

/// Reproduces the canonical Backtest request and family-sealed profile before any Replay write.
pub(super) fn prepare_composer_replay_seal_v3(
    composed: ComposedComposerBackedReplayV3,
    census: &TrialFamilyCensusReadbackV2,
    pre_transition_research_view: ResearchViewV1,
    product_edge_request_semantic_digest: String,
    committed_at_epoch_ms: u64,
) -> Result<PreparedComposerReplaySealV3, ExploratoryReplayOwnerError> {
    let request = ReplayRequestV2::try_from(composed.request).map_err(unavailable)?;
    if request.namespace() != ReplayNamespaceV2::Exploratory
        || request.request_identity().as_str() != composed.source.proposal.request_identity
        || composed.source.trial_family_root_digest != census.legacy_family.root().root_digest()
        || composed.source.census_frontier_digest != census.census_frontier.frontier_digest()
    {
        return Err(unavailable("Composer Replay canonical source mismatch"));
    }
    let canonical_request_bytes = request.to_canonical_bytes().map_err(unavailable)?;
    let meaning_digest = request
        .meaning_digest()
        .map_err(unavailable)?
        .as_str()
        .to_owned();
    let execution_profile_seal = ReplayExecutionProfileRequestSealV1::issue(
        &census.legacy_family,
        &composed.source.proposal.request_identity,
        &meaning_digest,
    )
    .map_err(unavailable)?;
    let (frozen, receipt) = issue_composer_replay_frozen_v3(
        composed.source,
        pre_transition_research_view,
        product_edge_request_semantic_digest,
        committed_at_epoch_ms,
    )?;
    Ok(PreparedComposerReplaySealV3 {
        canonical_request_bytes,
        meaning_digest,
        execution_profile_seal,
        frozen,
        receipt,
    })
}

/// Forms the V3 Research View from the same sealed request and exact Composer facts that the
/// Replay commit will persist. The caller must atomically CAS this projection with its Replay row.
pub(super) fn project_composer_replay_view_v3(
    initial: &ResearchViewV1,
    composer: &SealedDevelopComposerReadbackV2,
    binding: &ComposerArtifactFamilyReadbackV3,
    prepared: &PreparedComposerReplaySealV3,
    canonical_receipt_identity: &str,
    canonical_seal_digest: &str,
    projection_at_epoch_ms: u64,
) -> Result<ResearchViewV1, ExploratoryReplayOwnerError> {
    verify_composer_replay_frozen_v3(&prepared.frozen, &prepared.receipt)?;
    if initial != &prepared.frozen.pre_transition_research_view {
        return Err(unavailable(
            "Composer Replay Research View preimage mismatch",
        ));
    }
    let source = &prepared.frozen.source;
    project_composer_exploration_research_view_v3(
        initial,
        composer,
        binding,
        ResearchExplorationViewV1 {
            trial_family_identity: source.proposal.trial_family_identity.clone(),
            census_frontier_identity: source.census_frontier_identity.clone(),
            census_frontier_digest: source.census_frontier_digest.clone(),
            replay_request_identity: source.proposal.request_identity.clone(),
            replay_request_meaning_digest: prepared.meaning_digest.clone(),
            replay_request_seal_digest: canonical_seal_digest.to_owned(),
            replay_receipt_identity: canonical_receipt_identity.to_owned(),
        },
        projection_at_epoch_ms,
    )
    .map_err(unavailable)
}

/// Distinct Composer-source custody; legacy Artifact Build fields never enter this digest.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoredComposerReplayFrozenV3 {
    pub(super) schema_version: u16,
    pub(super) source: StoredComposerReplaySourceV3,
    /// Exact CAS preimage, retained so restart verification does not require the old mutable View.
    pub(super) pre_transition_research_view: ResearchViewV1,
    pub(super) product_edge_request_semantic_digest: String,
    pub(super) committed_at_epoch_ms: u64,
    pub(super) request_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoredComposerReplayReceiptV3 {
    pub(super) schema_version: u16,
    pub(super) receipt_identity: String,
    pub(super) request_identity: String,
    pub(super) request_digest: String,
    pub(super) committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct ComposerFrozenMeaningV3<'a> {
    schema_version: u16,
    source: &'a StoredComposerReplaySourceV3,
    pre_transition_research_view: &'a ResearchViewV1,
    product_edge_request_semantic_digest: &'a str,
    committed_at_epoch_ms: u64,
}

pub(super) fn issue_composer_replay_frozen_v3(
    source: StoredComposerReplaySourceV3,
    pre_transition_research_view: ResearchViewV1,
    product_edge_request_semantic_digest: String,
    committed_at_epoch_ms: u64,
) -> Result<
    (StoredComposerReplayFrozenV3, StoredComposerReplayReceiptV3),
    ExploratoryReplayOwnerError,
> {
    source.shape()?;

    if committed_at_epoch_ms == 0
        || !canonical_sha256(&product_edge_request_semantic_digest)
        || pre_transition_research_view.phase
            != crate::product_edge::ResearchViewPhase::IntentFrozen
        || pre_transition_research_view.exploration.is_some()
        || pre_transition_research_view.availability != ResearchViewAvailability::Available
        || pre_transition_research_view.projection_identity
            != canonical_research_view_identity_v2(&pre_transition_research_view)
    {
        return Err(unavailable("Composer Replay frozen source is unavailable"));
    }
    let request_digest = composer_canonical_digest(
        "rd.exploratory-replay-composer-source.v3",
        &ComposerFrozenMeaningV3 {
            schema_version: 3,
            source: &source,
            pre_transition_research_view: &pre_transition_research_view,
            product_edge_request_semantic_digest: &product_edge_request_semantic_digest,
            committed_at_epoch_ms,
        },
    )?;
    let receipt_digest = composer_canonical_digest(
        "rd.exploratory-replay-composer-receipt.v3",
        &(
            3_u16,
            source.proposal.request_identity.as_str(),
            request_digest.as_str(),
            committed_at_epoch_ms,
        ),
    )?;
    let receipt = StoredComposerReplayReceiptV3 {
        schema_version: 3,
        receipt_identity: format!(
            "rd-exploratory-replay-composer-receipt-v3-{}",
            receipt_digest.trim_start_matches("sha256:")
        ),
        request_identity: source.proposal.request_identity.clone(),
        request_digest: request_digest.clone(),
        committed_at_epoch_ms,
    };
    Ok((
        StoredComposerReplayFrozenV3 {
            schema_version: 3,
            source,
            pre_transition_research_view,
            product_edge_request_semantic_digest,
            committed_at_epoch_ms,
            request_digest,
        },
        receipt,
    ))
}

pub(super) fn verify_composer_replay_frozen_v3(
    frozen: &StoredComposerReplayFrozenV3,
    receipt: &StoredComposerReplayReceiptV3,
) -> Result<(), ExploratoryReplayOwnerError> {
    let (expected_frozen, expected_receipt) = issue_composer_replay_frozen_v3(
        frozen.source.clone(),
        frozen.pre_transition_research_view.clone(),
        frozen.product_edge_request_semantic_digest.clone(),
        frozen.committed_at_epoch_ms,
    )?;

    if frozen != &expected_frozen || receipt != &expected_receipt {
        return Err(unavailable("Composer Replay frozen custody mismatch"));
    }
    Ok(())
}

fn composer_canonical_digest(
    domain: &str,
    value: &impl Serialize,
) -> Result<String, ExploratoryReplayOwnerError> {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    let bytes = serde_json::to_vec(&Envelope { domain, value }).map_err(unavailable)?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn canonical_sha256(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    })
}

/// A resolved Replay composition cut whose shape was admitted for Composer composition.
///
/// For the universe-member shape the frame was re-derived from the Design's persisted input custody
/// under the caller's transaction, and it is the frame the facts and the binding record. Market
/// Data's resolver does not re-derive it: it holds the binding alone, not the Research request and
/// decision cut the custody claim needs, so this consumer does, as the first corpus's consumer
/// re-reads its census. Only [`admit_composer_replay_market_in_transaction_v3`] builds one.
pub(super) struct AdmittedReplayMarketShapeV3 {
    facts_identity: BindingDigest,
    universe_frame: Option<BindingDigest>,
}

/// Admits a resolved cut's shape, re-deriving a universe-member cut's frame from the Composer
/// Design's persisted input custody on the caller's transaction.
pub(super) async fn admit_composer_replay_market_in_transaction_v3(
    transaction: &mut Transaction<'_, Postgres>,
    composer: &SealedDevelopComposerReadbackV2,
    market: &ResolvedReplayCompositionCutV1,
) -> Result<AdmittedReplayMarketShapeV3, ExploratoryReplayOwnerError> {
    let binding = market.binding().record();
    let facts = market.market_facts().facts();
    let rederived_frame = if binding.shape() == ReplayMarketFactsShapeV2::UniverseMembers {
        Some(
            Box::pin(reread_design_universe_frame_digest_v1(
                transaction,
                "exploratory_replay.composer_v3.universe_frame",
                composer.research_request_identity(),
                composer.design_identity(),
            ))
            .await
            .map_err(|_| shape_refused(ComposerReplayShapeRefusalV1::UniverseFrameNotRederived))?,
        )
    } else {
        None
    };
    let universe_frame = admit_replay_market_shape_v3(&ReplayMarketShapeEvidenceV3 {
        binding_shape: binding.shape(),
        facts_shape: facts.shape(),
        binding_frame: binding.universe_frame_digest(),
        facts_frame: facts.universe_frame_digest(),
        frame_dependency: universe_frame_dependency(facts)?,
        rederived_frame,
    })
    .map_err(shape_refused)?;
    Ok(AdmittedReplayMarketShapeV3 {
        facts_identity: facts.identity(),
        universe_frame,
    })
}

/// What a cut states about its shape and frame, and the frame re-derived from custody.
struct ReplayMarketShapeEvidenceV3 {
    binding_shape: ReplayMarketFactsShapeV2,
    facts_shape: ReplayMarketFactsShapeV2,
    binding_frame: Option<BindingDigest>,
    facts_frame: Option<BindingDigest>,
    /// The identity and digest of the facts' one universe frame dependency.
    frame_dependency: Option<(BindingDigest, BindingDigest)>,
    rederived_frame: Option<BindingDigest>,
}

/// Returns the universe frame a universe-member cut binds, and `None` for the first corpus.
fn admit_replay_market_shape_v3(
    evidence: &ReplayMarketShapeEvidenceV3,
) -> Result<Option<BindingDigest>, ComposerReplayShapeRefusalV1> {
    if evidence.binding_shape != evidence.facts_shape {
        return Err(ComposerReplayShapeRefusalV1::BindingAndFactsShapeDiffer);
    }

    match evidence.facts_shape {
        ReplayMarketFactsShapeV2::FirstCorpus => {
            if evidence.binding_frame.is_some()
                || evidence.facts_frame.is_some()
                || evidence.frame_dependency.is_some()
            {
                return Err(ComposerReplayShapeRefusalV1::UniverseFrameDependencyDiffers);
            }
            Ok(None)
        }
        ReplayMarketFactsShapeV2::UniverseMembers => {
            let Some((identity, digest)) = evidence.frame_dependency else {
                return Err(ComposerReplayShapeRefusalV1::UniverseFrameDependencyDiffers);
            };

            if identity != digest
                || evidence.facts_frame != Some(digest)
                || evidence.binding_frame != Some(digest)
            {
                return Err(ComposerReplayShapeRefusalV1::UniverseFrameDependencyDiffers);
            }

            if evidence.rederived_frame != Some(digest) {
                return Err(ComposerReplayShapeRefusalV1::UniverseFrameNotRederived);
            }
            Ok(Some(digest))
        }
    }
}

/// The facts' universe frame dependency, if they have exactly one; two are refused.
fn universe_frame_dependency(
    facts: &ReplayMarketFactsV2,
) -> Result<Option<(BindingDigest, BindingDigest)>, ExploratoryReplayOwnerError> {
    let mut frames = facts.frontier().dependencies().iter().filter(|dependency| {
        dependency.kind() == ReplayMarketDependencyKindV2::StrategyInputUniverseFrameV1
    });
    let frame = frames
        .next()
        .map(|dependency| (dependency.identity(), dependency.digest()));

    if frames.next().is_some() {
        return Err(shape_refused(
            ComposerReplayShapeRefusalV1::UniverseFrameDependencyDiffers,
        ));
    }
    Ok(frame)
}

pub(super) fn prepare_composer_backed_replay_v3(
    proposal: &ComposerBackedExploratoryReplayProposalV3,
    census: &TrialFamilyCensusReadbackV2,
    intent: &ComposerReplayIntentV3,
    composer: &SealedDevelopComposerReadbackV2,
    artifact_family: &ComposerArtifactFamilyReadbackV3,
    market: &ResolvedReplayCompositionCutV1,
    admitted: &AdmittedReplayMarketShapeV3,
) -> Result<ComposedComposerBackedReplayV3, ExploratoryReplayOwnerError> {
    let request = compose_composer_backed_replay_request_v3(
        proposal, census, intent, composer, market, admitted,
    )?;
    let family = &census.legacy_family;
    let root = family.root();
    let root_receipt = family.root_receipt();
    let member = family.initial_intent_member();
    let frontier = &census.census_frontier;

    if root_receipt.root_digest() != root.root_digest()
        || root_receipt.intent_identity() != member.fact_identity()
        || frontier.trial_family_identity() != root.trial_family_identity()
        || artifact_family.binding().artifact_locator() != proposal.artifact_identity
        || artifact_family.binding().composer_request_identity()
            != composer.locator().request_identity
        || artifact_family.binding().trial_family_identity() != root.trial_family_identity()
    {
        return Err(unavailable("TrialFamily composition custody mismatch"));
    }
    let binding = market.binding();
    let market_facts = market.market_facts();
    // The first corpus binds its Instrument Master here; the universe-member shape binds none
    // until the native initial binding verifies the request-keyed V2 cut, so nothing is recorded.
    let (schema_version, instrument_master) =
        match (admitted.universe_frame, market.instrument_master()) {
            (None, Some(instrument_master)) => {
                (FIRST_CORPUS_SOURCE_SCHEMA_V3, Some(instrument_master))
            }
            (Some(_), None) => (UNIVERSE_MEMBER_SOURCE_SCHEMA_V3, None),
            _ => {
                return Err(shape_refused(
                    ComposerReplayShapeRefusalV1::InstrumentMasterDiffersFromShape,
                ));
            }
        };
    Ok(ComposedComposerBackedReplayV3 {
        request,
        source: StoredComposerReplaySourceV3 {
            schema_version,
            proposal: proposal.clone(),
            trial_family_root_receipt_identity: root_receipt.receipt_identity().to_owned(),
            trial_family_root_digest: root.root_digest().to_owned(),
            trial_family_member_identity: member.member_identity().to_owned(),
            trial_family_member_digest: member.member_digest().to_owned(),
            census_frontier_identity: frontier.frontier_identity().to_owned(),
            census_frontier_digest: frontier.frontier_digest().to_owned(),
            composer_request_digest: composer.request_digest(),
            artifact_family_binding_identity: artifact_family.binding().identity().to_owned(),
            artifact_family_binding_digest: artifact_family.binding().digest().to_owned(),
            artifact_family_binding_receipt_identity: artifact_family
                .receipt()
                .identity()
                .to_owned(),
            intent_identity: intent.identity().to_owned(),
            intent_digest: intent.digest().to_owned(),
            composer_research_request_identity: composer.research_request_identity(),
            composer_intent_identity: composer.intent_identity(),
            composer_design_identity: composer.design_identity(),
            composer_design_bytes_digest: composer.design_bytes_digest(),
            composer_plan_bytes_digest: composer.plan_bytes_digest(),
            composer_artifact_package_bytes_digest: composer.artifact_package_bytes_digest(),
            market_binding_receipt_identity: binding.receipt().identity(),
            market_binding_outbox_identity: binding.outbox().identity(),
            market_facts_identity: market_facts.facts().identity(),
            market_facts_receipt_identity: market_facts.receipt().identity(),
            instrument_master_identity: instrument_master.map(|master| master.identity()),
            instrument_master_receipt_identity: instrument_master
                .map(|master| master.receipt_identity()),
            instrument_master_outbox_identity: instrument_master
                .map(|master| master.outbox_identity()),
        },
    })
}

fn compose_composer_backed_replay_request_v3(
    proposal: &ComposerBackedExploratoryReplayProposalV3,
    census: &TrialFamilyCensusReadbackV2,
    intent: &ComposerReplayIntentV3,
    composer: &SealedDevelopComposerReadbackV2,
    market: &ResolvedReplayCompositionCutV1,
    admitted: &AdmittedReplayMarketShapeV3,
) -> Result<ReplayRequestDtoV2, ExploratoryReplayOwnerError> {
    let family = &census.legacy_family;
    let root = family.root();
    let frontier = &census.census_frontier;
    let composer_locator = composer.locator();
    let market_facts = market.market_facts().facts();
    let composition = market.binding().record();
    let policy_catalog = root
        .policy()
        .replay_policy_catalog_v3()
        .ok_or_else(|| unavailable("TrialFamily has no sealed Replay execution profiles"))?;
    policy_catalog.verify().map_err(unavailable)?;
    if root.policy().replay_execution_policy_v2() != Some(policy_catalog.replay_policy_v2()) {
        return Err(unavailable("TrialFamily Catalog V2/V3 binding mismatch"));
    }
    let policy = policy_catalog
        .replay_policy_v2()
        .verify()
        .map_err(unavailable)?;

    let intent_prefix = if intent.identity().starts_with("rd-research-intent-v2-") {
        "rd-research-intent-v2-"
    } else {
        "rd-successor-research-intent-v1-"
    };

    if proposal.request_identity.is_empty()
        || root.trial_family_identity() != proposal.trial_family_identity
        || composer_locator != &proposal.composer_locator
        || composer_locator.artifact_locator != proposal.artifact_identity
        || market.binding().record().locator() != proposal.market_data_locator
        || market.market_data_scope_digest() != proposal.market_data_scope_digest
        || composer.intent_identity() != parse_named_sha256(intent.identity(), intent_prefix)?
        || composer.design_identity() != composition.strategy_design_identity()
        || market_facts.identity() != admitted.facts_identity
        || market_facts.replay_start_event_ns() != i128::from(policy.window.start_event_ns)
        || market_facts.replay_end_event_ns_exclusive()
            != i128::from(policy.window.end_event_ns_exclusive)
    {
        return Err(unavailable(
            "Composer, TrialFamily, or Market Data composition binding mismatch",
        ));
    }

    // The first corpus's owner inputs are its observation census; a universe-member cut's are the
    // universe frame, whose identity is its BLAKE3 digest.
    let resolved_owner_inputs = match admitted.universe_frame {
        None => {
            let observation = unique_dependency(
                market_facts,
                ReplayMarketDependencyKindV2::ObservationCensusV1,
            )?;
            blake3_content(observation.identity(), observation.digest())?
        }
        Some(frame) => blake3_content(frame, frame)?,
    };
    let universe = unique_dependency(
        market_facts,
        ReplayMarketDependencyKindV2::UniverseSelectionV1,
    )?;

    Ok(ReplayRequestDtoV2 {
        schema_version: 2,
        request_identity: opaque(&proposal.request_identity)?,
        frozen_research_intent: content_from_text(intent.identity(), intent.digest())?,
        trial_family: content_from_text(root.trial_family_identity(), root.root_digest())?,
        trial_family_census_frontier: content_from_text(
            frontier.frontier_identity(),
            frontier.frontier_digest(),
        )?,
        replay_authority: ReplayAuthorityClaimV2::Exploratory,
        strategy_design: sha256_content(
            composer.design_identity(),
            composer_locator.design_digest,
        )?,
        strategy_plan: sha256_content(
            composer_locator.canonical_plan_digest,
            composer_locator.canonical_plan_digest,
        )?,
        artifact: ContentIdentityV2 {
            identity: opaque(&composer_locator.artifact_locator)?,
            digest: sha256_digest(composer_locator.artifact_identity)?,
        },
        resolved_owner_inputs,
        pit_scope: sha256_content(
            market_facts.request_identity(),
            market.market_data_scope_digest(),
        )?,
        pit_snapshot: sha256_content(
            market_facts.pit_snapshot_identity(),
            market_facts.pit_fact_digest(),
        )?,
        universe_selection: sha256_content(universe.identity(), universe.digest())?,
        correction_rule: policy.correction_rule.clone(),
        market_semantics: policy.market_semantics.clone(),
        replay_configuration: policy.replay_configuration.clone(),
        models: ReplayModelProfilesV2 {
            runtime_kernel: policy.runtime_kernel.clone(),
            simulator: policy.simulator.clone(),
            cost: policy.cost.clone(),
            slippage: policy.slippage.clone(),
            capacity: policy.capacity.clone(),
        },
        runner_operational_profile: policy.runner_operational_profile.clone(),
        diagnostic_policy: policy.diagnostic_policy.clone(),
        deterministic_seed: policy.deterministic_seed,
        window: policy.window,
        calendar: policy.calendar.clone(),
        session: policy.session.clone(),
        time_zone: policy.time_zone.clone(),
        corporate_action_cut: policy.corporate_action_cut.clone(),
        historical_membership_cut: policy.historical_membership_cut,
    })
}

fn unique_dependency(
    facts: &ReplayMarketFactsV2,
    kind: ReplayMarketDependencyKindV2,
) -> Result<
    &vibe_data::owner::replay_market_facts_v2::ReplayMarketDependencyRefV2,
    ExploratoryReplayOwnerError,
> {
    let mut matching = facts
        .frontier()
        .dependencies()
        .iter()
        .filter(|dependency| dependency.kind() == kind);
    let dependency = matching
        .next()
        .ok_or_else(|| unavailable("Market Data composition dependency is unavailable"))?;
    if matching.next().is_some() {
        return Err(unavailable(
            "Market Data composition dependency is ambiguous",
        ));
    }
    Ok(dependency)
}

fn opaque(value: &str) -> Result<OpaqueIdentityV2, ExploratoryReplayOwnerError> {
    OpaqueIdentityV2::try_from(value.to_owned()).map_err(unavailable)
}

fn content_from_text(
    identity: &str,
    digest: &str,
) -> Result<ContentIdentityV2, ExploratoryReplayOwnerError> {
    Ok(ContentIdentityV2 {
        identity: opaque(identity)?,
        digest: CanonicalDigestV2::try_from(digest.to_owned()).map_err(unavailable)?,
    })
}

fn sha256_content(
    identity: BindingDigest,
    digest: BindingDigest,
) -> Result<ContentIdentityV2, ExploratoryReplayOwnerError> {
    Ok(ContentIdentityV2 {
        identity: opaque(&format!("sha256:{}", hex(identity)))?,
        digest: sha256_digest(digest)?,
    })
}

fn blake3_content(
    identity: BindingDigest,
    digest: BindingDigest,
) -> Result<ContentIdentityV2, ExploratoryReplayOwnerError> {
    Ok(ContentIdentityV2 {
        identity: opaque(&format!("blake3:{}", hex(identity)))?,
        digest: CanonicalDigestV2::try_from(format!("blake3:{}", hex(digest)))
            .map_err(unavailable)?,
    })
}

fn sha256_digest(digest: BindingDigest) -> Result<CanonicalDigestV2, ExploratoryReplayOwnerError> {
    CanonicalDigestV2::try_from(format!("sha256:{}", hex(digest))).map_err(unavailable)
}

fn unavailable(error: impl Display) -> ExploratoryReplayOwnerError {
    ExploratoryReplayOwnerError::Unavailable(error.to_string())
}

const fn shape_refused(refusal: ComposerReplayShapeRefusalV1) -> ExploratoryReplayOwnerError {
    ExploratoryReplayOwnerError::ComposerReplayShapeRefused(refusal)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use vibe_data::owner::{
        replay_market_facts_v2::ReplayCompositionBindingLocatorV1, source_binding::BindingDigest,
    };
    use vibe_product_edge::ProductEdgeAdmissionLocatorV1;

    use super::*;
    use crate::{
        develop_composer_postgres_v2::DevelopComposerSealedReadLocatorV2,
        product_edge::{
            RESEARCH_OWNER_V1, RESEARCH_SCOPE_V1, RESEARCH_VIEW_SCOPE_V1, ResearchNextLegalAction,
            ResearchViewPhase,
        },
    };

    fn digest(byte: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([byte; 32])
    }

    fn first_corpus_source() -> StoredComposerReplaySourceV3 {
        StoredComposerReplaySourceV3 {
            schema_version: 3,
            proposal: ComposerBackedExploratoryReplayProposalV3 {
                admission: ProductEdgeAdmissionLocatorV1 {
                    request_identity: "replay-request".into(),
                    admission_identity: "admission".into(),
                    admission_digest: format!("sha256:{}", "a".repeat(64)),
                },
                request_identity: "replay-request".into(),
                trial_family_identity: "trial-family".into(),
                artifact_identity: "artifact".into(),
                composer_locator: DevelopComposerSealedReadLocatorV2 {
                    schema_version: 2,
                    request_identity: "composer-request".into(),
                    operation_receipt_identity: digest(1),
                    artifact_locator: "artifact-locator".into(),
                    artifact_identity: digest(2),
                    canonical_plan_digest: digest(3),
                    design_digest: digest(4),
                },
                market_data_locator: ReplayCompositionBindingLocatorV1::from_untrusted(
                    digest(5),
                    digest(6),
                ),
                market_data_scope_digest: digest(7),
            },
            trial_family_root_receipt_identity: "root-receipt".into(),
            trial_family_root_digest: "root-digest".into(),
            trial_family_member_identity: "member".into(),
            trial_family_member_digest: "member-digest".into(),
            census_frontier_identity: "census-frontier".into(),
            census_frontier_digest: "census-frontier-digest".into(),
            composer_request_digest: digest(8),
            artifact_family_binding_identity: "family-binding".into(),
            artifact_family_binding_digest: "family-binding-digest".into(),
            artifact_family_binding_receipt_identity: "family-binding-receipt".into(),
            intent_identity: "intent".into(),
            intent_digest: "intent-digest".into(),
            composer_research_request_identity: digest(9),
            composer_intent_identity: digest(10),
            composer_design_identity: digest(11),
            composer_design_bytes_digest: digest(12),
            composer_plan_bytes_digest: digest(13),
            composer_artifact_package_bytes_digest: digest(14),
            market_binding_receipt_identity: digest(15),
            market_binding_outbox_identity: digest(16),
            market_facts_identity: digest(17),
            market_facts_receipt_identity: digest(18),
            instrument_master_identity: Some(digest(19)),
            instrument_master_receipt_identity: Some(digest(20)),
            instrument_master_outbox_identity: Some(digest(21)),
        }
    }

    fn intent_frozen_view() -> ResearchViewV1 {
        let mut view = ResearchViewV1 {
            schema_version: 1,
            projection_identity: String::new(),
            request_identity: "research-request".into(),
            trusted_principal: "admin".into(),
            authorized_scope: vec![RESEARCH_SCOPE_V1.into(), RESEARCH_VIEW_SCOPE_V1.into()],
            authorization_policy_cut: "operator-frontier".into(),
            source_owner: RESEARCH_OWNER_V1.into(),
            source_cut: "source-cut".into(),
            observed_at_epoch_ms: 1_000,
            projection_at_epoch_ms: 2_000,
            valid_through_epoch_ms: 3_000,
            availability: ResearchViewAvailability::Available,
            phase: ResearchViewPhase::IntentFrozen,
            intent_identity: "intent".into(),
            source_frontier: Vec::new(),
            attempt_identity: None,
            artifact_identity: None,
            build_receipt_identity: None,
            artifact_review_identity: None,
            composer_artifact: None,
            exploration: None,
            next_legal_action: ResearchNextLegalAction::WaitForRAndDExecution,
        };
        view.projection_identity = canonical_research_view_identity_v2(&view);
        view
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn frozen(
        source: StoredComposerReplaySourceV3,
    ) -> Result<
        (StoredComposerReplayFrozenV3, StoredComposerReplayReceiptV3),
        ExploratoryReplayOwnerError,
    > {
        issue_composer_replay_frozen_v3(
            source,
            intent_frozen_view(),
            format!("sha256:{}", "b".repeat(64)),
            2_500,
        )
    }

    fn universe_member_source() -> StoredComposerReplaySourceV3 {
        StoredComposerReplaySourceV3 {
            schema_version: 4,
            instrument_master_identity: None,
            instrument_master_receipt_identity: None,
            instrument_master_outbox_identity: None,
            ..first_corpus_source()
        }
    }

    fn refusal(error: ExploratoryReplayOwnerError) -> ComposerReplayShapeRefusalV1 {
        match error {
            ExploratoryReplayOwnerError::ComposerReplayShapeRefused(refusal) => refusal,
            other => panic!("expected a named shape refusal, found {other:?}"),
        }
    }

    /// The bytes were read from this fixture on the tree before schema 4 existed (73bf32923), and
    /// are the first corpus's stored source, frozen claim and receipt.
    #[rstest]
    fn a_first_corpus_source_keeps_its_bytes() {
        let source = first_corpus_source();
        let bytes = serde_json::to_vec(&source).unwrap();
        assert_eq!(
            sha256_hex(&bytes),
            "bc930fd482373348621de09f9323325407e967d7f78824c9f042f767e40a0f8c"
        );
        let decoded: StoredComposerReplaySourceV3 = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decoded, source);
        assert_eq!(serde_json::to_vec(&decoded).unwrap(), bytes);
        assert_eq!(
            source.shape().unwrap(),
            ReplayMarketFactsShapeV2::FirstCorpus
        );

        let (frozen, receipt) = frozen(source).unwrap();
        assert_eq!(
            sha256_hex(&serde_json::to_vec(&frozen).unwrap()),
            "f7b1281d243dcc21bcc575a0b935d914226d0553c68ec7183c0ba8fd00d17b30"
        );
        assert_eq!(
            sha256_hex(&serde_json::to_vec(&receipt).unwrap()),
            "5561236f205d52c0707db7930b0357daf3a9198be134336878ce4b01ac46d49c"
        );
        assert_eq!(
            frozen.request_digest,
            "sha256:a6b0746b59145b5243f501ce064e7764aa5490dcc3a002ce0bc99882cd319479"
        );
    }

    #[rstest]
    fn a_universe_member_source_carries_no_instrument_master() {
        let source = universe_member_source();
        let json = serde_json::to_value(&source).unwrap();
        let object = json.as_object().unwrap();
        assert!(
            object
                .keys()
                .all(|key| !key.starts_with("instrument_master")),
            "{object:?}"
        );
        assert_eq!(object["schema_version"], 4);
        let decoded: StoredComposerReplaySourceV3 = serde_json::from_value(json).unwrap();
        assert_eq!(decoded, source);
        assert_eq!(
            source.shape().unwrap(),
            ReplayMarketFactsShapeV2::UniverseMembers
        );
        let (frozen, receipt) = frozen(source).unwrap();
        verify_composer_replay_frozen_v3(&frozen, &receipt).unwrap();
    }

    #[rstest]
    #[case::schema_3_without_the_identity(3, [None, Some(20), Some(21)], ComposerReplayShapeRefusalV1::FirstCorpusSourceLacksInstrumentMaster)]
    #[case::schema_3_without_the_receipt(3, [Some(19), None, Some(21)], ComposerReplayShapeRefusalV1::FirstCorpusSourceLacksInstrumentMaster)]
    #[case::schema_3_without_the_outbox(3, [Some(19), Some(20), None], ComposerReplayShapeRefusalV1::FirstCorpusSourceLacksInstrumentMaster)]
    #[case::schema_3_without_any(3, [None, None, None], ComposerReplayShapeRefusalV1::FirstCorpusSourceLacksInstrumentMaster)]
    #[case::schema_4_with_the_identity(4, [Some(19), None, None], ComposerReplayShapeRefusalV1::UniverseSourceCarriesInstrumentMaster)]
    #[case::schema_4_with_the_outbox(4, [None, None, Some(21)], ComposerReplayShapeRefusalV1::UniverseSourceCarriesInstrumentMaster)]
    #[case::schema_4_with_all(4, [Some(19), Some(20), Some(21)], ComposerReplayShapeRefusalV1::UniverseSourceCarriesInstrumentMaster)]
    #[case::schema_2(2, [Some(19), Some(20), Some(21)], ComposerReplayShapeRefusalV1::UnknownSourceSchema)]
    #[case::schema_5(5, [None, None, None], ComposerReplayShapeRefusalV1::UnknownSourceSchema)]
    fn a_source_whose_schema_and_instrument_master_disagree_is_refused_by_name(
        #[case] schema_version: u16,
        #[case] instrument_master: [Option<u8>; 3],
        #[case] expected: ComposerReplayShapeRefusalV1,
    ) {
        let [identity, receipt, outbox] = instrument_master.map(|byte| byte.map(digest));
        let source = StoredComposerReplaySourceV3 {
            schema_version,
            instrument_master_identity: identity,
            instrument_master_receipt_identity: receipt,
            instrument_master_outbox_identity: outbox,
            ..first_corpus_source()
        };
        assert_eq!(refusal(source.shape().unwrap_err()), expected);
        assert_eq!(refusal(frozen(source).unwrap_err()), expected);
    }

    #[rstest]
    fn a_source_is_read_only_under_a_binding_of_its_own_shape() {
        let first = first_corpus_source();
        let universe = universe_member_source();
        first
            .require_binding_shape(ReplayMarketFactsShapeV2::FirstCorpus)
            .unwrap();
        universe
            .require_binding_shape(ReplayMarketFactsShapeV2::UniverseMembers)
            .unwrap();

        for (source, binding_shape) in [
            (first, ReplayMarketFactsShapeV2::UniverseMembers),
            (universe, ReplayMarketFactsShapeV2::FirstCorpus),
        ] {
            assert_eq!(
                refusal(source.require_binding_shape(binding_shape).unwrap_err()),
                ComposerReplayShapeRefusalV1::SourceSchemaDiffersFromBindingShape
            );
        }
    }

    fn first_corpus_evidence() -> ReplayMarketShapeEvidenceV3 {
        ReplayMarketShapeEvidenceV3 {
            binding_shape: ReplayMarketFactsShapeV2::FirstCorpus,
            facts_shape: ReplayMarketFactsShapeV2::FirstCorpus,
            binding_frame: None,
            facts_frame: None,
            frame_dependency: None,
            rederived_frame: None,
        }
    }

    fn universe_evidence() -> ReplayMarketShapeEvidenceV3 {
        let frame = digest(30);
        ReplayMarketShapeEvidenceV3 {
            binding_shape: ReplayMarketFactsShapeV2::UniverseMembers,
            facts_shape: ReplayMarketFactsShapeV2::UniverseMembers,
            binding_frame: Some(frame),
            facts_frame: Some(frame),
            frame_dependency: Some((frame, frame)),
            rederived_frame: Some(frame),
        }
    }

    #[rstest]
    fn each_shape_is_admitted_with_its_own_owner_inputs() {
        assert_eq!(
            admit_replay_market_shape_v3(&first_corpus_evidence()),
            Ok(None)
        );
        assert_eq!(
            admit_replay_market_shape_v3(&universe_evidence()),
            Ok(Some(digest(30)))
        );
    }

    #[rstest]
    #[case::binding_first_corpus_facts_universe(
        ReplayMarketShapeEvidenceV3 { binding_shape: ReplayMarketFactsShapeV2::FirstCorpus, ..universe_evidence() },
        ComposerReplayShapeRefusalV1::BindingAndFactsShapeDiffer,
    )]
    #[case::binding_universe_facts_first_corpus(
        ReplayMarketShapeEvidenceV3 { binding_shape: ReplayMarketFactsShapeV2::UniverseMembers, ..first_corpus_evidence() },
        ComposerReplayShapeRefusalV1::BindingAndFactsShapeDiffer,
    )]
    #[case::first_corpus_binding_names_a_frame(
        ReplayMarketShapeEvidenceV3 { binding_frame: Some(digest(30)), ..first_corpus_evidence() },
        ComposerReplayShapeRefusalV1::UniverseFrameDependencyDiffers,
    )]
    #[case::first_corpus_facts_name_a_frame(
        ReplayMarketShapeEvidenceV3 { facts_frame: Some(digest(30)), ..first_corpus_evidence() },
        ComposerReplayShapeRefusalV1::UniverseFrameDependencyDiffers,
    )]
    #[case::first_corpus_depends_on_a_frame(
        ReplayMarketShapeEvidenceV3 { frame_dependency: Some((digest(30), digest(30))), ..first_corpus_evidence() },
        ComposerReplayShapeRefusalV1::UniverseFrameDependencyDiffers,
    )]
    #[case::universe_without_a_frame_dependency(
        ReplayMarketShapeEvidenceV3 { frame_dependency: None, ..universe_evidence() },
        ComposerReplayShapeRefusalV1::UniverseFrameDependencyDiffers,
    )]
    #[case::frame_dependency_identity_is_not_its_digest(
        ReplayMarketShapeEvidenceV3 { frame_dependency: Some((digest(31), digest(30))), ..universe_evidence() },
        ComposerReplayShapeRefusalV1::UniverseFrameDependencyDiffers,
    )]
    #[case::frame_dependency_is_another_frame(
        ReplayMarketShapeEvidenceV3 { frame_dependency: Some((digest(31), digest(31))), ..universe_evidence() },
        ComposerReplayShapeRefusalV1::UniverseFrameDependencyDiffers,
    )]
    #[case::facts_record_another_frame(
        ReplayMarketShapeEvidenceV3 { facts_frame: Some(digest(31)), ..universe_evidence() },
        ComposerReplayShapeRefusalV1::UniverseFrameDependencyDiffers,
    )]
    #[case::binding_records_another_frame(
        ReplayMarketShapeEvidenceV3 { binding_frame: Some(digest(31)), ..universe_evidence() },
        ComposerReplayShapeRefusalV1::UniverseFrameDependencyDiffers,
    )]
    #[case::binding_records_no_frame(
        ReplayMarketShapeEvidenceV3 { binding_frame: None, ..universe_evidence() },
        ComposerReplayShapeRefusalV1::UniverseFrameDependencyDiffers,
    )]
    #[case::custody_rederives_another_frame(
        ReplayMarketShapeEvidenceV3 { rederived_frame: Some(digest(31)), ..universe_evidence() },
        ComposerReplayShapeRefusalV1::UniverseFrameNotRederived,
    )]
    #[case::custody_was_not_reread(
        ReplayMarketShapeEvidenceV3 { rederived_frame: None, ..universe_evidence() },
        ComposerReplayShapeRefusalV1::UniverseFrameNotRederived,
    )]
    fn a_cut_whose_shape_or_frame_does_not_hold_together_is_refused_by_name(
        #[case] evidence: ReplayMarketShapeEvidenceV3,
        #[case] expected: ComposerReplayShapeRefusalV1,
    ) {
        assert_eq!(admit_replay_market_shape_v3(&evidence), Err(expected));
    }
}
