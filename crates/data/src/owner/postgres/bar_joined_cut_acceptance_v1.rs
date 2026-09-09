//! Disposable PostgreSQL acceptance issuance for one exact six-role BAR joined cut.
//!
//! This module exists only with `sealed-strategy-input-acceptance`. It accepts an already-admitted
//! canonical Owner test database and untrusted design identities, then uses the real Market Data
//! PostgreSQL write and readback paths. The returned fixture is move-only and exposes no database
//! handle, URL, raw row, writer, or constructor for an authenticated native-join capability.

use std::collections::BTreeSet;

use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

use super::{
    MarketDataOwnerPostgres, load_pit_for_update, load_pit_observation_batch_for_update,
    load_source_for_update,
};
use crate::owner::{
    bar_schedule::{
        BarScheduleCompletionV1, BarScheduleKindV1, BarScheduleLabelV1, BarScheduleUnitV1,
        UntrustedBarScheduleProposalV1, prepare_bar_schedule_commit_v1,
    },
    instrument_master::{
        BACKTEST_OWNER_V1, InstrumentClass, InstrumentDecimal, InstrumentMasterError,
        InstrumentMasterFactProposalV1, InstrumentMasterReadbackV1, InstrumentMasterResolver,
        InstrumentMasterScopeV1, InstrumentVenueSourceMapping, UntrustedInstrumentMasterRequestV1,
    },
    observation_census::UntrustedObservationCensusRequestV1,
    pit_snapshot::{
        UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime, UntrustedPitObservation,
        UntrustedPitObservationBatchProposal, UntrustedPitSnapshotEvidence,
        UntrustedPitSnapshotProposal, UntrustedPitSnapshotRequest,
        UntrustedPitSnapshotTimeEvidence, UntrustedProviderAvailableTime, UntrustedRetrievalTime,
        UntrustedSnapshotDecisionCut,
        authority::{
            TestOnlyCanonicalBasisResolver, derive_observation_batch_digest,
            refresh_request_claims, verify_observation_batch,
        },
    },
    reference_fact_coordinates::r0::{
        UntrustedReferenceFactR0RequestV1, request_meaning_digest_v1 as r0_request_meaning_digest,
    },
    replay_market_facts_v2::UntrustedComposerNativeJoinRequestV1,
    sample_fact::{
        SampleFactHeadsV1, prepare_bar_timeframe_projection_v1, prepare_sample_commit_v1,
    },
    sample_projection::{
        StrategyInputSampleProjectionSourceV3, prepare_strategy_input_sample_projection_bar_v3,
    },
    sealed_replay_input::{
        SealedReplayInput, UntrustedSealedReplayInputRequest, seal_replay_input,
    },
    source_binding::{
        BindingDigest, MarketDataClockAdmission, SourceBindingError, UntrustedAdapterBinding,
        UntrustedCompleteFrontier, UntrustedCredentialAudienceClaim,
        UntrustedCredentialCapabilityClaim, UntrustedLicensePolicy, UntrustedMarketDataAsOf,
        UntrustedMarketSemantics, UntrustedOpaqueCredentialHandle, UntrustedSourceBindingProposal,
        UntrustedTrustPolicy,
        authority::{OwnerSourceBindingDecision, derive_binding_id, derive_time_evidence_identity},
    },
    strategy_design_role_set::StrategyDesignRoleSetReceiptV1,
    strategy_input_binding::{
        MarketDataFieldSemantic, StrategyInputBindingReceipt, StrategyInputChannel,
        StrategyInputUnit, UntrustedStrategyInputBindingRequest, UntrustedStrategyInputScope,
        bind_strategy_input_event_frame, bind_strategy_input_role,
    },
    strategy_input_joined_cut::{
        StrategyInputJoinRoleClaimV1, StrategyInputJoinedCutReceiptV1,
        UntrustedStrategyInputJoinClaimV1, derive_strategy_input_join_identity_v2,
    },
    universe_selection::{
        UniverseSelectionErrorV1, UntrustedUniverseSelectionRequestV1,
        authority::{
            CanonicalUniverseSelectionRuleEvaluatorV1, HistoricalMembershipFactProposalV1,
        },
    },
};

const INSTRUMENT: &str = "AAPL";

/// Caller-authored identities for the fixed six-role acceptance design.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedBarJoinedCutAcceptanceDesignClaimsV1 {
    pub research_request_identity: BindingDigest,
    pub strategy_design_identity: BindingDigest,
    pub input_role_identities: [BindingDigest; 6],
}

/// Move-only PostgreSQL basis that exposes only Owner-bound input bindings for plan compilation.
pub struct OwnerBarJoinedCutAcceptanceBasisV1 {
    owner: MarketDataOwnerPostgres,
    claims: UntrustedBarJoinedCutAcceptanceDesignClaimsV1,
    pit: crate::owner::pit_snapshot::PitSnapshotCommitAggregate,
    batch: crate::owner::pit_snapshot::VerifiedPitObservationBatch,
    instrument_master: InstrumentMasterReadbackV1,
    binding_requests: [UntrustedStrategyInputBindingRequest; 6],
    input_bindings: Vec<StrategyInputBindingReceipt>,
}

impl std::fmt::Debug for OwnerBarJoinedCutAcceptanceBasisV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(OwnerBarJoinedCutAcceptanceBasisV1))
            .field("input_binding_count", &self.input_bindings.len())
            .finish_non_exhaustive()
    }
}

impl OwnerBarJoinedCutAcceptanceBasisV1 {
    /// Returns the native Owner bindings needed to compile the final plan and R&D role set.
    #[must_use]
    pub fn input_bindings(&self) -> &[StrategyInputBindingReceipt] {
        &self.input_bindings
    }
}

/// Redacted failure from the disposable Owner acceptance builder.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("disposable Market Data BAR joined-cut acceptance issuance was unavailable")]
pub struct BarJoinedCutAcceptanceUnavailableV1;

/// Bounded phase where the disposable basis issuance became unavailable.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum BarJoinedCutAcceptanceBasisUnavailableV1 {
    #[error("disposable Market Data BAR joined-cut acceptance claims were unavailable")]
    Claims,
    #[error("disposable Market Data BAR joined-cut acceptance Owner connection was unavailable")]
    OwnerConnection,
    #[error("disposable Market Data BAR joined-cut acceptance source was unavailable: {0}")]
    Source(SourceBindingError),
    #[error("disposable Market Data BAR joined-cut acceptance clock head was unavailable")]
    ClockHead,
    #[error("disposable Market Data BAR joined-cut acceptance instrument append was unavailable")]
    InstrumentAppend,
    #[error("disposable Market Data BAR joined-cut acceptance instrument readback was unavailable")]
    InstrumentReadback,
    #[error("disposable Market Data BAR joined-cut acceptance universe was unavailable")]
    Universe,
    #[error("disposable Market Data BAR joined-cut acceptance PIT was unavailable")]
    Pit,
    #[error("disposable Market Data BAR joined-cut acceptance R0 was unavailable")]
    R0,
    #[error("disposable Market Data BAR joined-cut acceptance semantics were unavailable")]
    Semantics,
    #[error("disposable Market Data BAR joined-cut acceptance bindings were unavailable")]
    Bindings,
}

/// Bounded phase where completion of the disposable Owner fixture became unavailable.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum BarJoinedCutAcceptanceCompletionUnavailableV1 {
    #[error("disposable Market Data BAR joined-cut acceptance role set was unavailable")]
    RoleSet,
    #[error("disposable Market Data BAR joined-cut acceptance registry request was unavailable")]
    RegistryRequest,
    #[error("disposable Market Data BAR joined-cut acceptance registry PIT was unavailable")]
    RegistryPit,
    #[error("disposable Market Data BAR joined-cut acceptance registry universe was unavailable")]
    RegistryUniverse,
    #[error("disposable Market Data BAR joined-cut acceptance registry source was unavailable")]
    RegistrySource,
    #[error("disposable Market Data BAR joined-cut acceptance registry instrument was unavailable")]
    RegistryInstrument,
    #[error("disposable Market Data BAR joined-cut acceptance registry semantics were unavailable")]
    RegistrySemantics,
    #[error("disposable Market Data BAR joined-cut acceptance registry binding was unavailable")]
    RegistryBinding,
    #[error("disposable Market Data BAR joined-cut acceptance registry store was unavailable")]
    RegistryStore,
    #[error("disposable Market Data BAR joined-cut acceptance registry readback mismatched")]
    RegistryReadback,
    #[error("disposable Market Data BAR joined-cut acceptance frames were unavailable")]
    Frames,
    #[error("disposable Market Data BAR joined-cut acceptance join claim was unavailable")]
    JoinClaim,
    #[error("disposable Market Data BAR joined-cut acceptance census was unavailable")]
    Census,
    #[error("disposable Market Data BAR joined-cut acceptance projections were unavailable")]
    Projections,
    #[error("disposable Market Data BAR joined-cut acceptance sealing inputs were unavailable")]
    SealingInputs,
    #[error("disposable Market Data BAR joined-cut acceptance replay seal was unavailable")]
    ReplaySeal,
}

/// Move-only output from one real PostgreSQL Owner issuance chain.
#[derive(Debug)]
pub struct OwnerBarJoinedCutAcceptanceFixtureV1 {
    replay_input: SealedReplayInput,
    instrument_master: InstrumentMasterReadbackV1,
    input_bindings: Vec<StrategyInputBindingReceipt>,
    joined_cut: StrategyInputJoinedCutReceiptV1,
    native_join_request: UntrustedComposerNativeJoinRequestV1,
}

/// Move-only parts needed by the Strategy Factory acceptance consumer.
pub type OwnerBarJoinedCutAcceptancePartsV1 = (
    SealedReplayInput,
    InstrumentMasterReadbackV1,
    Vec<StrategyInputBindingReceipt>,
    StrategyInputJoinedCutReceiptV1,
    UntrustedComposerNativeJoinRequestV1,
);

impl OwnerBarJoinedCutAcceptanceFixtureV1 {
    #[must_use]
    pub fn into_parts(self) -> OwnerBarJoinedCutAcceptancePartsV1 {
        (
            self.replay_input,
            self.instrument_master,
            self.input_bindings,
            self.joined_cut,
            self.native_join_request,
        )
    }
}

/// Builds the real PostgreSQL basis needed to compile the final plan and role set.
///
/// This phase performs no registry, joined-cut, schedule, V3, or V4 write. It validates only that
/// caller identities are non-zero and unique, then issues the native Owner facts through PIT and
/// derives the exact six bindings from the re-read PostgreSQL batch.
///
/// # Errors
///
/// Returns a redacted unavailable value if any real Owner write, exact readback, or binding fails.
pub async fn prepare_owner_bar_joined_cut_acceptance_basis_v1(
    database: &CanonicalOwnerPostgresTestDatabaseV1,
    claims: UntrustedBarJoinedCutAcceptanceDesignClaimsV1,
) -> Result<OwnerBarJoinedCutAcceptanceBasisV1, BarJoinedCutAcceptanceBasisUnavailableV1> {
    validate_initial_claims(&claims)
        .map_err(|_| BarJoinedCutAcceptanceBasisUnavailableV1::Claims)?;
    let owner_url = database.database_url(CanonicalOwnerTestRoleV1::MarketDataOwner);
    let owner = MarketDataOwnerPostgres::connect_existing(owner_url)
        .await
        .map_err(|_| BarJoinedCutAcceptanceBasisUnavailableV1::OwnerConnection)?;
    let clock = acceptance_clock();
    let source = owner
        .commit_source_initial(
            acceptance_source_proposal(),
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &clock,
        )
        .await
        .map_err(BarJoinedCutAcceptanceBasisUnavailableV1::Source)?;
    let head = async {
        let mut transaction = owner.pool.begin().await.map_err(|_| ())?;
        let head = super::load_current_clock_fact_for_update(&mut transaction)
            .await
            .map_err(|_| ())?
            .ok_or(())?;
        transaction.commit().await.map_err(|_| ())?;
        Ok::<_, ()>(head)
    }
    .await
    .map_err(|()| BarJoinedCutAcceptanceBasisUnavailableV1::ClockHead)?;
    let instrument_request = acceptance_instrument_request(head.handoff.locator().clone());
    let instrument = match owner
        .resolve_instrument_master(&instrument_request, None)
        .await
    {
        Ok(instrument) => instrument,
        Err(InstrumentMasterError::UnknownIdentity) => {
            owner
                .append_instrument_master_fact(acceptance_instrument_fact(), head.handoff.locator())
                .await
                .map_err(|_| BarJoinedCutAcceptanceBasisUnavailableV1::InstrumentAppend)?;
            owner
                .resolve_instrument_master(&instrument_request, None)
                .await
                .map_err(|_| BarJoinedCutAcceptanceBasisUnavailableV1::InstrumentReadback)?
        }
        Err(_) => return Err(BarJoinedCutAcceptanceBasisUnavailableV1::InstrumentReadback),
    };

    let membership_frontier = acceptance_identity(170);
    let universe_request = UntrustedUniverseSelectionRequestV1::new(
        acceptance_identity(171),
        "RESEARCH_OWNER_V1",
        acceptance_identity(172),
        vec![0, 1, 1],
        membership_frontier,
        50,
        99,
        100,
        source.fact().lineage_root(),
        digest(86),
        acceptance_identity(173),
    );
    let universe = async {
        let mut transaction = owner
            .pool
            .begin()
            .await
            .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
        let readback =
            match super::universe_selection::resolve_universe_selection_in_transaction_v1(
                &mut transaction,
                &universe_request,
                Some(&CanonicalUniverseSelectionRuleEvaluatorV1),
            )
            .await
            {
                Ok(readback) => readback,
                Err(UniverseSelectionErrorV1::UnknownIdentity) => {
                    super::universe_selection::persist_historical_membership_frontier_v1(
                        &mut transaction,
                        membership_frontier,
                        vec![HistoricalMembershipFactProposalV1 {
                            member_key: INSTRUMENT.as_bytes().to_vec(),
                            instrument: INSTRUMENT.as_bytes().to_vec(),
                            predecessor_identity: None,
                            effective_from_ns: 1,
                            effective_until_ns: None,
                            provider_available_ns: 90,
                            retrieval_ns: 92,
                            correction_publication_ns: 91,
                            owner_observation_ns: 99,
                            decision_cut: 100,
                            source_binding_lineage_root: source.fact().lineage_root(),
                            correction_frontier_digest: digest(86),
                        }],
                    )
                    .await
                    .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
                    super::universe_selection::resolve_universe_selection_in_transaction_v1(
                        &mut transaction,
                        &universe_request,
                        Some(&CanonicalUniverseSelectionRuleEvaluatorV1),
                    )
                    .await
                    .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?
                }
                Err(_) => return Err(BarJoinedCutAcceptanceUnavailableV1),
            };
        transaction
            .commit()
            .await
            .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
        Ok::<_, BarJoinedCutAcceptanceUnavailableV1>(readback)
    }
    .await
    .map_err(|_| BarJoinedCutAcceptanceBasisUnavailableV1::Universe)?;

    let (pit, batch) = Box::pin(persist_pit_and_reread(
        &owner,
        &clock,
        &source,
        &instrument,
        universe.record().identity(),
    ))
    .await
    .map_err(|_| BarJoinedCutAcceptanceBasisUnavailableV1::Pit)?;
    let r0 = persist_r0(&owner, &pit, &source)
        .await
        .map_err(|_| BarJoinedCutAcceptanceBasisUnavailableV1::R0)?;
    Box::pin(persist_market_semantics(
        &owner,
        &pit,
        &source,
        &batch,
        &instrument,
        &r0,
    ))
    .await
    .map_err(|_| BarJoinedCutAcceptanceBasisUnavailableV1::Semantics)?;
    let binding_requests = acceptance_binding_requests(&claims, &batch);
    let input_bindings = binding_requests
        .iter()
        .map(|request| bind_strategy_input_role(request, &batch))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| BarJoinedCutAcceptanceBasisUnavailableV1::Bindings)?;

    Ok(OwnerBarJoinedCutAcceptanceBasisV1 {
        owner,
        claims,
        pit,
        batch,
        instrument_master: instrument,
        binding_requests,
        input_bindings,
    })
}

/// Completes registry and joined-cut issuance after the final R&D role set exists.
///
/// The complete role set is validated before any phase-two write. This phase persists the six
/// registry declarations, joined cut, three schedules, and six V3 FRAME projections. It deliberately
/// stops before V4 issuance and returns only an untrusted request for the real Composer native-join
/// Owner method.
///
/// # Errors
///
/// Returns a redacted unavailable value if the role set differs from the frozen basis or any Owner
/// write, re-read, or seal fails.
pub async fn complete_owner_bar_joined_cut_acceptance_fixture_v1(
    basis: OwnerBarJoinedCutAcceptanceBasisV1,
    role_set: StrategyDesignRoleSetReceiptV1,
) -> Result<OwnerBarJoinedCutAcceptanceFixtureV1, BarJoinedCutAcceptanceCompletionUnavailableV1> {
    validate_design_role_set(&basis.claims, &role_set)
        .map_err(|_| BarJoinedCutAcceptanceCompletionUnavailableV1::RoleSet)?;
    let OwnerBarJoinedCutAcceptanceBasisV1 {
        owner,
        claims,
        pit,
        batch,
        instrument_master,
        binding_requests,
        input_bindings,
    } = basis;

    let mut registered_bindings = Vec::with_capacity(6);
    for request in &binding_requests {
        let mut transaction = owner
            .pool
            .begin()
            .await
            .map_err(|_| BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryStore)?;
        let declaration =
            register_acceptance_binding(&mut transaction, request, &binding_requests, &role_set)
                .await
                .map_err(|error| map_registry_completion_error(&error))?;
        transaction
            .commit()
            .await
            .map_err(|_| BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryStore)?;
        registered_bindings.push(declaration.binding().clone());
    }
    if registered_bindings != input_bindings {
        return Err(BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryReadback);
    }
    let frames = registered_bindings
        .iter()
        .map(|binding| bind_strategy_input_event_frame(std::slice::from_ref(binding), &batch))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| BarJoinedCutAcceptanceCompletionUnavailableV1::Frames)?;
    let [validated_join] = role_set.joins.as_slice() else {
        return Err(BarJoinedCutAcceptanceCompletionUnavailableV1::JoinClaim);
    };
    let join_claim = UntrustedStrategyInputJoinClaimV1 {
        strategy_design_identity: claims.strategy_design_identity,
        join_semantic_id: validated_join.semantic_id.clone(),
        join_identity: validated_join.join_identity,
        alignment_semantic_id: validated_join.alignment_semantic_id.clone(),
        trigger_input_id: validated_join.trigger_input_id.clone(),
        max_staleness_ns: validated_join.max_staleness_ns,
        roles: validated_join
            .roles
            .iter()
            .map(|role| StrategyInputJoinRoleClaimV1 {
                semantic_id: role.semantic_id.clone(),
                input_role_identity: role.role_identity,
            })
            .collect(),
    };
    let census_request = UntrustedObservationCensusRequestV1::new(
        acceptance_identity(205),
        pit.receipt().locator().clone(),
        join_claim,
        frames
            .last()
            .ok_or(BarJoinedCutAcceptanceCompletionUnavailableV1::Frames)?
            .trigger()
            .lifecycle()
            .logical_time(),
        claims.research_request_identity,
    );
    let joined = {
        let mut transaction = owner
            .pool
            .begin()
            .await
            .map_err(|_| BarJoinedCutAcceptanceCompletionUnavailableV1::Census)?;
        let (_, joined) = super::observation_census::resolve_and_commit_observation_census_v1(
            &mut transaction,
            &census_request,
        )
        .await
        .map_err(|_| BarJoinedCutAcceptanceCompletionUnavailableV1::Census)?;
        transaction
            .commit()
            .await
            .map_err(|_| BarJoinedCutAcceptanceCompletionUnavailableV1::Census)?;
        joined
    };
    let frame_projection_digests = persist_schedules_and_v3_frames(
        &owner,
        &registered_bindings,
        &frames,
        &batch,
        &instrument_master,
    )
    .await
    .map_err(|_| BarJoinedCutAcceptanceCompletionUnavailableV1::Projections)?;
    let (stored_pit, stored_source, stored_batch) = reread_sealing_inputs(&owner, &pit)
        .await
        .map_err(|_| BarJoinedCutAcceptanceCompletionUnavailableV1::SealingInputs)?;
    let replay_input = seal_acceptance_replay_input(&stored_pit, &stored_source, &stored_batch)
        .map_err(|_| BarJoinedCutAcceptanceCompletionUnavailableV1::ReplaySeal)?;
    let joined_cut = joined.record().joined_cut_receipt().clone();
    let native_join_request = UntrustedComposerNativeJoinRequestV1 {
        joined_cut_identity: joined.record().identity(),
        joined_cut_digest: joined.record().digest(),
        frame_projection_digests,
    };
    Ok(OwnerBarJoinedCutAcceptanceFixtureV1 {
        replay_input,
        instrument_master,
        input_bindings: registered_bindings,
        joined_cut,
        native_join_request,
    })
}

fn map_registry_completion_error(
    error: &super::strategy_input_binding_registry::StrategyInputBindingRegistryErrorV1,
) -> BarJoinedCutAcceptanceCompletionUnavailableV1 {
    use super::strategy_input_binding_registry::StrategyInputBindingRegistryErrorV1 as Registry;

    match error {
        Registry::InvalidRequest | Registry::CapacityExceeded | Registry::CodecMismatch => {
            BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryRequest
        }
        Registry::PitUnavailable => BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryPit,
        Registry::UniverseUnavailable => {
            BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryUniverse
        }
        Registry::SourceUnavailable => {
            BarJoinedCutAcceptanceCompletionUnavailableV1::RegistrySource
        }
        Registry::InstrumentMasterUnavailable => {
            BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryInstrument
        }
        Registry::MarketSemanticsUnavailable => {
            BarJoinedCutAcceptanceCompletionUnavailableV1::RegistrySemantics
        }
        Registry::BindingUnavailable(_) => {
            BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryBinding
        }
        Registry::StrategyDesignRoleSetUnavailable => {
            BarJoinedCutAcceptanceCompletionUnavailableV1::RoleSet
        }
        Registry::UnknownDeclaration
        | Registry::RequestConflict
        | Registry::StoreUnavailable
        | Registry::StoreUntrusted => BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryStore,
    }
}

fn digest(value: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([value; 32])
}

fn acceptance_identity(value: u8) -> BindingDigest {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"VIBE_OWNER_BAR_JOINED_CUT_ACCEPTANCE_V1");
    hasher.update(&[0, value]);
    BindingDigest::from_untrusted_bytes(*hasher.finalize().as_bytes())
}

fn validate_initial_claims(
    claims: &UntrustedBarJoinedCutAcceptanceDesignClaimsV1,
) -> Result<(), BarJoinedCutAcceptanceUnavailableV1> {
    let mut identities = claims.input_role_identities;
    identities.sort_unstable();
    if claims.research_request_identity.as_bytes() == &[0; 32]
        || claims.strategy_design_identity.as_bytes() == &[0; 32]
        || identities[0].as_bytes() == &[0; 32]
        || identities.windows(2).any(|pair| pair[0] == pair[1])
    {
        return Err(BarJoinedCutAcceptanceUnavailableV1);
    }
    Ok(())
}

fn validate_design_role_set(
    claims: &UntrustedBarJoinedCutAcceptanceDesignClaimsV1,
    role_set: &StrategyDesignRoleSetReceiptV1,
) -> Result<(), BarJoinedCutAcceptanceUnavailableV1> {
    let semantics = [
        ("minute-open", "MARKET_DATA.BAR.OPEN.PRICE.V1", "1M"),
        ("minute-high", "MARKET_DATA.BAR.HIGH.PRICE.V1", "1M"),
        ("minute-low", "MARKET_DATA.BAR.LOW.PRICE.V1", "1M"),
        ("minute-close", "MARKET_DATA.BAR.CLOSE.PRICE.V1", "1M"),
        ("hour-close", "MARKET_DATA.BAR.CLOSE.PRICE.V1", "1H"),
        (
            "exchange-session-day-close",
            "MARKET_DATA.BAR.CLOSE.PRICE.V1",
            "1D",
        ),
    ];
    let mut semantic_ids = semantics.map(|(semantic_id, _, _)| semantic_id.to_owned());
    semantic_ids.sort_unstable();
    let expected_join_identity = derive_strategy_input_join_identity_v2(
        "replay-composition-six-role-v1",
        &semantic_ids,
        "strategy.input-join.latest-not-after-trigger.v1",
        "minute-close",
        1,
    );
    if !role_set.has_valid_integrity()
        || claims.research_request_identity.as_bytes() == &[0; 32]
        || claims.strategy_design_identity.as_bytes() == &[0; 32]
        || role_set.research_request_identity != claims.research_request_identity
        || role_set.design_identity != claims.strategy_design_identity
        || role_set.roles.len() != 6
    {
        return Err(BarJoinedCutAcceptanceUnavailableV1);
    }
    for ((semantic_id, field, timeframe), role_identity) in
        semantics.iter().zip(&claims.input_role_identities)
    {
        let Some(role) = role_set.role(*role_identity) else {
            return Err(BarJoinedCutAcceptanceUnavailableV1);
        };
        if role.semantic_id != *semantic_id
            || role.fact_class != "MARKET_DATA"
            || role.instrument != INSTRUMENT
            || role.scope != r#"{"kind":"EXACT_INSTRUMENT"}"#
            || role.field_semantic_id != *field
            || role.channel != "MARKET"
            || role.timeframe != *timeframe
            || role.unit != "PRICE"
            || role.scale != 2
            || role.value_type != "I128"
        {
            return Err(BarJoinedCutAcceptanceUnavailableV1);
        }
    }
    let mut expected_join_roles = semantics
        .iter()
        .zip(&claims.input_role_identities)
        .map(|((semantic_id, _, _), identity)| (*semantic_id, *identity))
        .collect::<Vec<_>>();
    expected_join_roles.sort_unstable_by(|left, right| left.0.cmp(right.0));
    let [join] = role_set.joins.as_slice() else {
        return Err(BarJoinedCutAcceptanceUnavailableV1);
    };
    if join.join_identity != expected_join_identity
        || join.semantic_id != "replay-composition-six-role-v1"
        || join.alignment_semantic_id != "strategy.input-join.latest-not-after-trigger.v1"
        || join.trigger_input_id != "minute-close"
        || join.max_staleness_ns != 1
        || join.roles.len() != 6
        || join
            .roles
            .iter()
            .zip(&expected_join_roles)
            .any(|(role, (semantic_id, identity))| {
                role.semantic_id != *semantic_id || role.role_identity != *identity
            })
    {
        return Err(BarJoinedCutAcceptanceUnavailableV1);
    }
    Ok(())
}

fn acceptance_clock() -> MarketDataClockAdmission {
    MarketDataClockAdmission::seal_for_test(
        "12345678901234567890123456789012",
        "abcdefghijklmnopqrstuvwxyzABCDEF",
        2,
        100,
        100,
        160,
        digest(90),
        1,
        2,
    )
}

fn acceptance_source_proposal() -> UntrustedSourceBindingProposal {
    let mut proposal = UntrustedSourceBindingProposal {
        claimed_binding_id: digest(0),
        schema_version: 1,
        adapter: UntrustedAdapterBinding {
            implementation_digest: digest(1),
            configuration_digest: digest(2),
            authenticated_endpoint_identity: "https://market.example/v1".into(),
            dataset_mapping: "dataset/trades".into(),
            account_mapping: "tenant/entitlement".into(),
        },
        credential_handle: UntrustedOpaqueCredentialHandle::from_untrusted_identity(
            digest(6),
            UntrustedCredentialAudienceClaim::MarketData,
            [
                UntrustedCredentialCapabilityClaim::MarketDataRead,
                UntrustedCredentialCapabilityClaim::ReferenceDataRead,
                UntrustedCredentialCapabilityClaim::MetadataRead,
            ],
        ),
        trust_policy: UntrustedTrustPolicy {
            identity: "trust-policy".into(),
            version: 1,
        },
        semantics: UntrustedMarketSemantics {
            normalization: "normalization-v1".into(),
            adjustment: "raw-v1".into(),
            price_meaning: "quote-currency-per-base-v1".into(),
            calendar_rules: "calendar-v1".into(),
            session_rules: "session-v1".into(),
            timezone_rules: "iana-2026a".into(),
            instrument_lifecycle_rules: "instrument-lifecycle-v1".into(),
            corporate_action_rules: "corporate-actions-v1".into(),
            membership_rules: "historical-membership-v1".into(),
            universe_rules: "requester-rule-evaluation-v1".into(),
            correction_policy: "successor-only-v1".into(),
        },
        license: UntrustedLicensePolicy {
            use_scope: "acquire-cache-archive-backtest-model-display".into(),
            redistribution_scope: "derived-only".into(),
            retention_policy: "retain-30d-delete-v1".into(),
            redaction_policy: "no-licensed-payload-v1".into(),
        },
        source_frontier: UntrustedCompleteFrontier {
            stream_identity: "source-stream".into(),
            cut_identity: "instrument-source-cut-85".into(),
            sequence: 10,
            digest: digest(85),
        },
        correction_frontier: UntrustedCompleteFrontier {
            stream_identity: "correction-stream".into(),
            cut_identity: "instrument-correction-cut-86".into(),
            sequence: 11,
            digest: digest(86),
        },
        time_evidence: UntrustedMarketDataAsOf {
            claimed_evidence_identity: digest(0),
            clock_identity: "12345678901234567890123456789012".into(),
            clock_epoch: "abcdefghijklmnopqrstuvwxyzABCDEF".into(),
            monotonic_sequence: 2,
            restart_continuity_digest: digest(90),
            skew_bound: 2,
            uncertainty_bound: 1,
            event_effective: 10,
            provider_available: 90,
            retrieval: 92,
            correction_publication: 91,
            observed_at: 100,
            effective_at: 100,
            valid_through: 160,
        },
    };
    proposal.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&proposal.time_evidence);
    proposal.claimed_binding_id = derive_binding_id(&proposal);
    proposal
}

fn acceptance_instrument_fact() -> InstrumentMasterFactProposalV1 {
    InstrumentMasterFactProposalV1 {
        canonical_identity: INSTRUMENT.into(),
        predecessor_fact_digest: None,
        mappings: vec![InstrumentVenueSourceMapping {
            venue_identity: "XNAS".into(),
            source_identity: "SIP".into(),
            source_instrument: INSTRUMENT.as_bytes().to_vec(),
        }],
        instrument_class: InstrumentClass::Equity,
        base_currency: Some("USD".into()),
        quote_currency: None,
        settlement_currency: Some("USD".into()),
        margin_currency: None,
        price_increment: InstrumentDecimal {
            mantissa: 1,
            scale: 2,
        },
        quantity_increment: InstrumentDecimal {
            mantissa: 1,
            scale: 0,
        },
        contract_multiplier: InstrumentDecimal {
            mantissa: 1,
            scale: 0,
        },
        calendar_identity: "XNYS-CALENDAR-V1".into(),
        session_identity: "XNYS-REGULAR-V1".into(),
        time_zone_identity: "Etc/UTC".into(),
        lifecycle_frontier: digest(81),
        corporate_action_frontier: digest(82),
        historical_membership_frontier: digest(83),
        market_semantics_identity: digest(84),
        source_frontier: digest(85),
        correction_frontier: digest(86),
        effective_from: 10,
        effective_until: Some(200),
        provider_available: 90,
        retrieval: 91,
        correction_publication: 92,
        owner_observation: 99,
    }
}

fn acceptance_instrument_request(
    clock_head: crate::owner::shared_time_evidence::UntrustedClockHeadLocator,
) -> UntrustedInstrumentMasterRequestV1 {
    UntrustedInstrumentMasterRequestV1 {
        request_identity: acceptance_identity(110),
        request_meaning_digest: acceptance_identity(111),
        consumer_role: BACKTEST_OWNER_V1.into(),
        scope: InstrumentMasterScopeV1::ExactInstrument(INSTRUMENT.into()),
        effective_instant: 50,
        owner_observation: 99,
        decision_cut: 100,
        clock_head,
        lifecycle_frontier: digest(81),
        corporate_action_frontier: digest(82),
        historical_membership_frontier: digest(83),
        market_semantics_identity: digest(84),
        source_frontier: digest(85),
        correction_frontier: digest(86),
        stable_correlation: acceptance_identity(112),
    }
}

async fn persist_pit_and_reread(
    owner: &MarketDataOwnerPostgres,
    clock: &MarketDataClockAdmission,
    source: &crate::owner::source_binding::authority::SourceBindingCommit,
    instrument: &InstrumentMasterReadbackV1,
    universe_identity: BindingDigest,
) -> Result<
    (
        crate::owner::pit_snapshot::PitSnapshotCommitAggregate,
        crate::owner::pit_snapshot::VerifiedPitObservationBatch,
    ),
    BarJoinedCutAcceptanceUnavailableV1,
> {
    let time_evidence = UntrustedPitSnapshotTimeEvidence {
        event_effective: UntrustedEventEffectiveTime::from_untrusted(
            50,
            &clock.clock_identity,
            &clock.clock_epoch,
        ),
        provider_available: UntrustedProviderAvailableTime::from_untrusted(
            90,
            &clock.clock_identity,
            &clock.clock_epoch,
        ),
        retrieval: UntrustedRetrievalTime::from_untrusted(
            92,
            &clock.clock_identity,
            &clock.clock_epoch,
        ),
        correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
            91,
            &clock.clock_identity,
            &clock.clock_epoch,
        )),
        decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(
            100,
            &clock.clock_identity,
            &clock.clock_epoch,
        ),
        monotonic_sequence: clock.monotonic_sequence,
        restart_continuity_digest: clock.restart_continuity_digest,
        skew_bound: clock.skew_bound,
        uncertainty_bound: clock.uncertainty_bound,
        observed_at: 100,
        valid_through: 160,
    };
    let mut proposal = UntrustedPitSnapshotProposal {
        request: UntrustedPitSnapshotRequest {
            claimed_request_identity: digest(0),
            claimed_request_digest: digest(0),
            correlation_identity: acceptance_identity(174),
            requester_identity: acceptance_identity(175),
            scope_digest: acceptance_identity(176),
            source_binding: source.receipt().locator().clone(),
            instrument_master_digest: instrument.digest(),
            universe_selection_digest: universe_identity,
            market_semantics_identity: digest(84),
            time_evidence,
        },
        evidence: UntrustedPitSnapshotEvidence {
            normalized_records_digest: digest(0),
            source_frontier: source.receipt().locator().source_frontier.clone(),
            correction_frontier: source.receipt().locator().correction_frontier.clone(),
            coverage_complete: true,
            semantics_compatible: true,
            source_available: true,
        },
    };
    let observation = UntrustedPitObservationBatchProposal {
        rows: [
            ("AAPL.CLOSE.1H", "CLOSE", "1H", 12_301),
            ("AAPL.CLOSE.1M", "CLOSE", "1M", 12_345),
            ("AAPL.CLOSE.EXCHANGE_SESSION_1D", "CLOSE", "1D", 12_299),
            ("AAPL.HIGH.1M", "HIGH", "1M", 12_401),
            ("AAPL.LOW.1M", "LOW", "1M", 12_211),
            ("AAPL.OPEN.1M", "OPEN", "1M", 12_251),
        ]
        .into_iter()
        .map(
            |(symbolic_key, field, timeframe, value_mantissa)| UntrustedPitObservation {
                symbolic_key: symbolic_key.into(),
                member_key: INSTRUMENT.into(),
                instrument: INSTRUMENT.into(),
                channel: "MARKET".into(),
                data_kind: "BAR".into(),
                timeframe: timeframe.into(),
                field: field.into(),
                value_mantissa,
                value_scale: 2,
                event_effective: 50,
                provider_available: 90,
                retrieval: 92,
                correction_publication: 91,
                source_binding_identity: source.fact().binding_id(),
                source_frontier_digest: digest(85),
                instrument_master_digest: instrument.digest(),
                universe_selection_digest: universe_identity,
                market_semantics_identity: digest(84),
                correction_stream_identity: source
                    .receipt()
                    .locator()
                    .correction_frontier
                    .stream_identity
                    .clone(),
                correction_sequence: source.receipt().locator().correction_frontier.sequence,
                correction_frontier_digest: digest(86),
            },
        )
        .collect(),
    };
    proposal.evidence.normalized_records_digest = derive_observation_batch_digest(&observation)
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    refresh_request_claims(&mut proposal.request);
    let basis = TestOnlyCanonicalBasisResolver::seal_for_test(
        proposal.request.clone(),
        proposal.evidence.clone(),
        clock.clone(),
    );
    let pit = owner
        .commit_pit_initial_with_observation_batch(proposal, observation, &basis, clock)
        .await
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    let (_, _, batch) = reread_sealing_inputs(owner, &pit).await?;
    Ok((pit, batch))
}

async fn reread_sealing_inputs(
    owner: &MarketDataOwnerPostgres,
    pit: &crate::owner::pit_snapshot::PitSnapshotCommitAggregate,
) -> Result<
    (
        crate::owner::pit_snapshot::PitSnapshotCommitAggregate,
        crate::owner::source_binding::authority::SourceBindingStoredAggregate,
        crate::owner::pit_snapshot::VerifiedPitObservationBatch,
    ),
    BarJoinedCutAcceptanceUnavailableV1,
> {
    let mut transaction = owner
        .pool
        .begin()
        .await
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    let stored_pit = load_pit_for_update(&mut transaction, pit.fact().snapshot_identity(), false)
        .await
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?
        .ok_or(BarJoinedCutAcceptanceUnavailableV1)?;
    let stored_source = load_source_for_update(
        &mut transaction,
        stored_pit.fact().source_binding_identity(),
        false,
    )
    .await
    .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?
    .ok_or(BarJoinedCutAcceptanceUnavailableV1)?;
    let stored = load_pit_observation_batch_for_update(&mut transaction, &stored_pit)
        .await
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?
        .ok_or(BarJoinedCutAcceptanceUnavailableV1)?;
    let batch = verify_observation_batch(
        &stored_pit,
        stored.source_binding_identity,
        stored.source_binding_lineage_root,
        stored.source_binding_lineage_version,
        stored.digest,
        &stored.bytes,
        &stored.rows,
    )
    .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    transaction
        .commit()
        .await
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    Ok((stored_pit, stored_source, batch))
}

async fn persist_r0(
    owner: &MarketDataOwnerPostgres,
    pit: &crate::owner::pit_snapshot::PitSnapshotCommitAggregate,
    source: &crate::owner::source_binding::authority::SourceBindingCommit,
) -> Result<
    crate::owner::reference_fact_coordinates::r0::ReferenceFactR0ReadbackV1,
    BarJoinedCutAcceptanceUnavailableV1,
> {
    let mut request = UntrustedReferenceFactR0RequestV1 {
        request_identity: acceptance_identity(183),
        request_meaning_digest: digest(0),
        pit_locator_bytes: serde_json::to_vec(pit.receipt().locator())
            .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?
            .into_boxed_slice(),
        source_binding_locator_bytes: serde_json::to_vec(source.receipt().locator())
            .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?
            .into_boxed_slice(),
        replay_start_event_ns: 50,
        replay_end_event_ns_exclusive: 51,
        effective_from_ns: 50,
        effective_until_ns: Some(51),
        provider_available_ns: 90,
        retrieval_ns: 92,
        correction_publication_ns: 91,
        owner_observation_ns: 100,
        decision_cut: 100,
        predecessor_identity: None,
        stable_correlation: acceptance_identity(179),
    };
    request.request_meaning_digest =
        r0_request_meaning_digest(&request).map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    let mut transaction = owner
        .pool
        .begin()
        .await
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    let issued = super::reference_fact_coordinates::resolve_reference_fact_r0_in_transaction_v1(
        &mut transaction,
        &request,
    )
    .await
    .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    let recovered = super::reference_fact_coordinates::recover_reference_fact_r0_in_transaction_v1(
        &mut transaction,
        request.locator(),
    )
    .await
    .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    if issued.canonical_bytes() != recovered.canonical_bytes() {
        return Err(BarJoinedCutAcceptanceUnavailableV1);
    }
    transaction
        .commit()
        .await
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    Ok(issued)
}

async fn persist_market_semantics(
    owner: &MarketDataOwnerPostgres,
    pit: &crate::owner::pit_snapshot::PitSnapshotCommitAggregate,
    source: &crate::owner::source_binding::authority::SourceBindingCommit,
    batch: &crate::owner::pit_snapshot::VerifiedPitObservationBatch,
    instrument: &InstrumentMasterReadbackV1,
    r0: &crate::owner::reference_fact_coordinates::r0::ReferenceFactR0ReadbackV1,
) -> Result<(), BarJoinedCutAcceptanceUnavailableV1> {
    use crate::owner::market_semantics::{
        MarketSemanticsConsumerV1, MarketSemanticsErrorV1, MarketSemanticsPriceAdjustmentV1,
        MarketSemanticsTimestampBasisV1, MarketSemanticsValueV1,
        UntrustedMarketSemanticsProposalV1, authority,
    };
    let mut transaction = owner
        .pool
        .begin()
        .await
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    let aggregate = load_source_for_update(&mut transaction, source.fact().binding_id(), false)
        .await
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?
        .ok_or(BarJoinedCutAcceptanceUnavailableV1)?;
    let source_readback =
        crate::owner::source_binding::SourceBindingOwnerReadback::from_verified(&aggregate);
    transaction
        .commit()
        .await
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    let value = MarketSemanticsValueV1 {
        normalization_identity: digest(180),
        price_adjustment: MarketSemanticsPriceAdjustmentV1::Raw,
        timestamp_basis: MarketSemanticsTimestampBasisV1::EventEffective,
        price_unit_identity: digest(181),
        size_unit_identity: digest(182),
    };
    let registry_key =
        authority::derive_registry_key_v1(digest(84), &source_readback, batch, instrument, r0)
            .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    let registry = authority::seal_registry_entry_v1(registry_key, value, acceptance_identity(187))
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    let mut transaction = owner
        .pool
        .begin()
        .await
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    super::market_semantics::register_market_semantics_registry_entry_v1(
        &mut transaction,
        &registry,
    )
    .await
    .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    transaction
        .commit()
        .await
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    let mut instrument_locator_bytes = Vec::with_capacity(64);
    instrument_locator_bytes.extend_from_slice(instrument.request_identity.as_bytes());
    instrument_locator_bytes.extend_from_slice(instrument.request_meaning_digest.as_bytes());
    let mut r0_locator_bytes = Vec::with_capacity(64);
    r0_locator_bytes.extend_from_slice(r0.cut().request_identity.as_bytes());
    r0_locator_bytes.extend_from_slice(r0.cut().request_meaning_digest.as_bytes());
    let mut proposal = UntrustedMarketSemanticsProposalV1 {
        request_identity: acceptance_identity(188),
        request_meaning_digest: digest(0),
        consumer: MarketSemanticsConsumerV1::StrategyInputBindingRegistry,
        compatibility_scope_identity: digest(84),
        predecessor_identity: None,
        value,
        effective_from_ns: 50,
        effective_until_ns: Some(51),
        effective_instant_ns: 50,
        owner_observation_ns: 100,
        decision_cut: 100,
        pit_locator_bytes: serde_json::to_vec(pit.receipt().locator())
            .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?
            .into_boxed_slice(),
        source_binding_locator_bytes: serde_json::to_vec(source.receipt().locator())
            .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?
            .into_boxed_slice(),
        instrument_master_locator_bytes: instrument_locator_bytes.into_boxed_slice(),
        r0_locator_bytes: r0_locator_bytes.into_boxed_slice(),
        stable_correlation: acceptance_identity(179),
    };
    proposal.request_meaning_digest = authority::request_meaning_digest_v1(&proposal)
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    let mut transaction = owner
        .pool
        .begin()
        .await
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    let readback = match super::market_semantics::resolve_market_semantics_scope_in_transaction_v1(
        &mut transaction,
        digest(84),
        50,
        100,
        100,
    )
    .await
    {
        Ok(readback) => readback,
        Err(MarketSemanticsErrorV1::UnknownIdentity) => {
            super::market_semantics::resolve_market_semantics_in_transaction_v1(
                &mut transaction,
                &proposal,
            )
            .await
            .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?
        }
        Err(_) => return Err(BarJoinedCutAcceptanceUnavailableV1),
    };
    let [fact] = readback.facts() else {
        return Err(BarJoinedCutAcceptanceUnavailableV1);
    };
    if fact.compatibility_scope_identity() != digest(84) || fact.value() != value {
        return Err(BarJoinedCutAcceptanceUnavailableV1);
    }
    transaction
        .commit()
        .await
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
    Ok(())
}

fn acceptance_binding_requests(
    claims: &UntrustedBarJoinedCutAcceptanceDesignClaimsV1,
    batch: &crate::owner::pit_snapshot::VerifiedPitObservationBatch,
) -> [UntrustedStrategyInputBindingRequest; 6] {
    let specs = [
        (MarketDataFieldSemantic::BarOpenPrice, "1M"),
        (MarketDataFieldSemantic::BarHighPrice, "1M"),
        (MarketDataFieldSemantic::BarLowPrice, "1M"),
        (MarketDataFieldSemantic::BarClosePrice, "1M"),
        (MarketDataFieldSemantic::BarClosePrice, "1H"),
        (MarketDataFieldSemantic::BarClosePrice, "1D"),
    ];
    std::array::from_fn(|index| UntrustedStrategyInputBindingRequest {
        research_request_identity: claims.research_request_identity,
        strategy_design_identity: claims.strategy_design_identity,
        input_role_identity: claims.input_role_identities[index],
        scope: UntrustedStrategyInputScope::ExactInstrument {
            instrument: INSTRUMENT.into(),
        },
        field_semantic: specs[index].0,
        channel: StrategyInputChannel::Market,
        timeframe: specs[index].1.into(),
        unit: StrategyInputUnit::Price,
        scale: 2,
        pit_request_identity: batch.request_identity(),
        pit_request_digest: batch.request_digest(),
        snapshot_identity: batch.snapshot_identity(),
        snapshot_fact_digest: batch.fact_digest(),
        observation_batch_digest: batch.digest(),
        source_binding_identity: batch.source_binding_identity(),
        source_frontier_digest: batch.source_frontier_digest(),
        correction_frontier_digest: batch.correction_frontier_digest(),
        instrument_master_digest: batch.instrument_master_digest(),
        universe_selection_digest: batch.universe_selection_digest(),
        market_semantics_identity: batch.market_semantics_identity(),
        decision_cut: batch.time_evidence().decision_cut.value,
    })
}

async fn persist_schedules_and_v3_frames(
    owner: &MarketDataOwnerPostgres,
    bindings: &[StrategyInputBindingReceipt],
    frames: &[crate::owner::strategy_input_binding::StrategyInputEventFrameReceipt],
    batch: &crate::owner::pit_snapshot::VerifiedPitObservationBatch,
    instrument: &InstrumentMasterReadbackV1,
) -> Result<[BindingDigest; 6], BarJoinedCutAcceptanceUnavailableV1> {
    let minute = UntrustedBarScheduleProposalV1 {
        canonical_instrument: INSTRUMENT.into(),
        predecessor_fact_digest: None,
        effective_from: 1,
        effective_until: Some(200),
        kind: BarScheduleKindV1::FixedInterval,
        step: 1,
        unit: BarScheduleUnitV1::Minute,
        anchor_identity: acceptance_identity(206),
        label: BarScheduleLabelV1::IntervalClose,
        completion: BarScheduleCompletionV1::CompleteOnly,
    };
    let proposals = [
        minute.clone(),
        minute.clone(),
        minute.clone(),
        minute.clone(),
        UntrustedBarScheduleProposalV1 {
            unit: BarScheduleUnitV1::Hour,
            anchor_identity: acceptance_identity(207),
            ..minute.clone()
        },
        UntrustedBarScheduleProposalV1 {
            kind: BarScheduleKindV1::ExchangeSession,
            unit: BarScheduleUnitV1::ExchangeSessionDay,
            anchor_identity: acceptance_identity(208),
            ..minute
        },
    ];
    let initial_predecessor = {
        let mut transaction = owner
            .pool
            .begin()
            .await
            .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
        let head = super::validate_bar_schedule_history(&mut transaction, INSTRUMENT, false)
            .await
            .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
        transaction
            .commit()
            .await
            .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
        head
    };
    let mut schedules = Vec::with_capacity(3);
    let mut schedule_indices = Vec::with_capacity(6);
    for (binding, proposal) in bindings.iter().zip(&proposals) {
        let existing = proposals[..schedule_indices.len()]
            .iter()
            .position(|candidate| {
                candidate.kind == proposal.kind
                    && candidate.unit == proposal.unit
                    && candidate.anchor_identity == proposal.anchor_identity
            });
        let index =
            if let Some(index) = existing.and_then(|prior| schedule_indices.get(prior).copied()) {
                index
            } else {
                let mut proposal = proposal.clone();
                proposal.predecessor_fact_digest = schedules
                    .last()
                    .map(crate::owner::bar_schedule::BarScheduleReadbackV1::fact)
                    .map(crate::owner::bar_schedule::BarScheduleFactV1::digest)
                    .or(initial_predecessor);
                let prepared = prepare_bar_schedule_commit_v1(proposal, binding, batch, instrument)
                    .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
                let stored = owner
                    .commit_prepared_bar_schedule_v1(&prepared)
                    .await
                    .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
                schedules.push(stored);
                schedules.len() - 1
            };
        schedule_indices.push(index);
    }
    let mut digests = Vec::with_capacity(6);
    for (((binding, frame), _proposal), schedule_index) in bindings
        .iter()
        .zip(frames)
        .zip(&proposals)
        .zip(schedule_indices)
    {
        let schedule = &schedules[schedule_index];
        let timeframe = prepare_bar_timeframe_projection_v1(binding, batch, schedule)
            .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
        let prepared_sample = prepare_sample_commit_v1(
            binding,
            batch,
            &timeframe,
            SampleFactHeadsV1 {
                series: None,
                slot: None,
            },
        )
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
        let sample = owner
            .commit_prepared_sample_v1(&prepared_sample)
            .await
            .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
        let prepared_v3 = prepare_strategy_input_sample_projection_bar_v3(
            frame,
            &[StrategyInputSampleProjectionSourceV3 {
                binding,
                timeframe: &timeframe,
                sample: &sample,
                schedule,
            }],
        )
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
        owner
            .commit_strategy_input_sample_projection_v3(&prepared_v3)
            .await
            .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?;
        digests.push(BindingDigest::from_untrusted_bytes(
            prepared_v3.receipt_digest(),
        ));
    }
    digests
        .try_into()
        .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)
}

#[cfg(not(test))]
async fn register_acceptance_binding(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
    complete_requests: &[UntrustedStrategyInputBindingRequest],
    role_set: &StrategyDesignRoleSetReceiptV1,
) -> Result<
    super::strategy_input_binding_registry::StrategyInputBindingDeclarationReadbackV1,
    super::strategy_input_binding_registry::StrategyInputBindingRegistryErrorV1,
> {
    super::strategy_input_binding_registry::register_strategy_input_binding_declaration_v1(
        transaction,
        request,
        complete_requests,
        role_set,
    )
    .await
}

#[cfg(test)]
async fn register_acceptance_binding(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
    _complete_requests: &[UntrustedStrategyInputBindingRequest],
    _role_set: &StrategyDesignRoleSetReceiptV1,
) -> Result<
    super::strategy_input_binding_registry::StrategyInputBindingDeclarationReadbackV1,
    super::strategy_input_binding_registry::StrategyInputBindingRegistryErrorV1,
> {
    super::strategy_input_binding_registry::register_strategy_input_binding_declaration_v1(
        transaction,
        request,
    )
    .await
}

fn seal_acceptance_replay_input(
    pit: &crate::owner::pit_snapshot::PitSnapshotCommitAggregate,
    source: &crate::owner::source_binding::authority::SourceBindingStoredAggregate,
    batch: &crate::owner::pit_snapshot::VerifiedPitObservationBatch,
) -> Result<SealedReplayInput, BarJoinedCutAcceptanceUnavailableV1> {
    let fact = pit.fact();
    let semantics = &source.commit().fact().proposal().semantics;
    let request = UntrustedSealedReplayInputRequest {
        consumer_role: "STRATEGY_FACTORY_RD_OWNER_API_V1".into(),
        locator: pit.receipt().locator().clone(),
        request_identity: fact.request_identity(),
        request_digest: fact.request_digest(),
        scope_digest: fact.request().scope_digest,
        source_binding_identity: fact.source_binding_identity(),
        source_binding_lineage_root: fact.source_binding_lineage_root(),
        source_binding_lineage_version: fact.source_binding_lineage_version(),
        source_frontier: fact.evidence().source_frontier.clone(),
        correction_frontier: fact.evidence().correction_frontier.clone(),
        instrument_master_digest: fact.request().instrument_master_digest,
        universe_selection_digest: fact.request().universe_selection_digest,
        market_semantics_identity: fact.request().market_semantics_identity,
        snapshot_correction_rule_digest:
            crate::owner::research_pit_terminal::derive_snapshot_correction_rule_digest(
                fact.request(),
                fact.evidence().correction_frontier.clone(),
            )
            .map_err(|_| BarJoinedCutAcceptanceUnavailableV1)?,
        calendar_rules: semantics.calendar_rules.clone(),
        session_rules: semantics.session_rules.clone(),
        time_zone_rules: semantics.timezone_rules.clone(),
        corporate_action_rules: semantics.corporate_action_rules.clone(),
        historical_membership_rules: semantics.membership_rules.clone(),
    };
    seal_replay_input(pit, source, batch, &request).map_err(|_| BarJoinedCutAcceptanceUnavailableV1)
}
