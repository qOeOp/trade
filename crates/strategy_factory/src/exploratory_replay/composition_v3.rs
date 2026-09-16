use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use sqlx::{Postgres, Transaction};
use std::fmt::Display;
use vibe_backtest_owner_contracts::{
    CanonicalDigestV2, ContentIdentityV2, OpaqueIdentityV2, ReplayAuthorityClaimV2,
    ReplayModelProfilesV2, ReplayNamespaceV2, ReplayRequestDtoV2, ReplayRequestV2,
};
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use vibe_data::owner::replay_market_facts_v2::resolve_bound_replay_cut_for_rd_in_transaction_v1;
use vibe_data::owner::{
    replay_market_facts_v2::{ReplayMarketDependencyKindV2, ResolvedReplayCompositionCutV1},
    source_binding::BindingDigest,
};

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use crate::composer_artifact_family_binding_v3::load_composer_artifact_family_binding_for_replay_v3;
use crate::{
    composer_artifact_family_binding_v3::ComposerArtifactFamilyReadbackV3,
    composer_replay_intent_v3::{ComposerReplayIntentV3, hex, parse_named_sha256},
    develop_composer_postgres_v2::SealedDevelopComposerReadbackV2,
    exploratory_replay::{ComposerBackedExploratoryReplayProposalV3, ExploratoryReplayOwnerError},
    product_edge::{
        ResearchExplorationViewV1, ResearchViewAvailability, ResearchViewV1,
        canonical_research_view_identity_v2, project_composer_exploration_research_view_v3,
    },
    replay_execution_profile_binding_v1::ReplayExecutionProfileRequestSealV1,
    trial_family::TrialFamilyCensusReadbackV2,
};
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use crate::{
    composer_replay_intent_v3::resolve_composer_replay_intent_in_transaction,
    develop_composer_postgres_v2::read_accepted_for_replay_in_transaction,
    source_research_composer_postgres_v2::SourceResearchComposerBindingOwnerV2,
    trial_family_postgres::load_trial_family_census_v2_by_family_in_transaction,
};

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
    pub(super) instrument_master_identity: BindingDigest,
    pub(super) instrument_master_receipt_identity: BindingDigest,
    pub(super) instrument_master_outbox_identity: BindingDigest,
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
    if source.schema_version != 3
        || committed_at_epoch_ms == 0
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

/// Resolves every Owner fact used by composition on the caller's still-open R&D transaction.
/// Composer re-locks current Research and strategy-input Owner evidence on that transaction.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub(super) async fn prepare_composer_backed_replay_in_transaction_v3<B>(
    transaction: &mut Transaction<'_, Postgres>,
    proposal: &ComposerBackedExploratoryReplayProposalV3,
    binding_owner: &B,
    read_cut_epoch_ms: u64,
) -> Result<ComposedComposerBackedReplayV3, ExploratoryReplayOwnerError>
where
    B: SourceResearchComposerBindingOwnerV2,
{
    let census = load_trial_family_census_v2_by_family_in_transaction(
        transaction,
        &proposal.trial_family_identity,
    )
    .await
    .map_err(unavailable)?;
    let composer = read_accepted_for_replay_in_transaction(
        transaction,
        &proposal.composer_locator,
        binding_owner,
        read_cut_epoch_ms,
    )
    .await
    .map_err(unavailable)?;
    let intent =
        resolve_composer_replay_intent_in_transaction(transaction, &census, &composer).await?;
    let artifact_family = load_composer_artifact_family_binding_for_replay_v3(
        transaction,
        &census,
        &intent,
        &composer,
    )
    .await
    .map_err(unavailable)?
    .ok_or_else(|| unavailable("Composer Artifact-family binding is unavailable"))?;
    let market = resolve_bound_replay_cut_for_rd_in_transaction_v1(
        transaction,
        proposal.market_data_locator,
    )
    .await
    .map_err(unavailable)?;
    prepare_composer_backed_replay_v3(
        proposal,
        &census,
        &intent,
        &composer,
        &artifact_family,
        &market,
    )
}

pub(super) fn prepare_composer_backed_replay_v3(
    proposal: &ComposerBackedExploratoryReplayProposalV3,
    census: &TrialFamilyCensusReadbackV2,
    intent: &ComposerReplayIntentV3,
    composer: &SealedDevelopComposerReadbackV2,
    artifact_family: &ComposerArtifactFamilyReadbackV3,
    market: &ResolvedReplayCompositionCutV1,
) -> Result<ComposedComposerBackedReplayV3, ExploratoryReplayOwnerError> {
    let request =
        compose_composer_backed_replay_request_v3(proposal, census, intent, composer, market)?;
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
    let instrument_master = market.instrument_master();
    Ok(ComposedComposerBackedReplayV3 {
        request,
        source: StoredComposerReplaySourceV3 {
            schema_version: 3,
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
            instrument_master_identity: instrument_master.identity(),
            instrument_master_receipt_identity: instrument_master.receipt_identity(),
            instrument_master_outbox_identity: instrument_master.outbox_identity(),
        },
    })
}

pub(crate) fn compose_composer_backed_replay_request_v3(
    proposal: &ComposerBackedExploratoryReplayProposalV3,
    census: &TrialFamilyCensusReadbackV2,
    intent: &ComposerReplayIntentV3,
    composer: &SealedDevelopComposerReadbackV2,
    market: &ResolvedReplayCompositionCutV1,
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
        || market_facts.replay_start_event_ns() != i128::from(policy.window.start_event_ns)
        || market_facts.replay_end_event_ns_exclusive()
            != i128::from(policy.window.end_event_ns_exclusive)
    {
        return Err(unavailable(
            "Composer, TrialFamily, or Market Data composition binding mismatch",
        ));
    }

    let observation = unique_dependency(
        market_facts,
        ReplayMarketDependencyKindV2::ObservationCensusV1,
    )?;
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
        resolved_owner_inputs: blake3_content(observation.identity(), observation.digest())?,
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
    facts: &vibe_data::owner::replay_market_facts_v2::ReplayMarketFactsV2,
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
