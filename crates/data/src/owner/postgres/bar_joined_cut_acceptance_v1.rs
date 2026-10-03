//! Disposable PostgreSQL acceptance issuance for one exact six-role BAR joined cut.
//!
//! This module exists only with `sealed-strategy-input-acceptance`. It accepts an already-admitted
//! canonical Owner test database and untrusted design identities, then uses the real Market Data
//! PostgreSQL write and readback paths. The returned fixture is move-only and exposes no database
//! handle, URL, raw row, writer, or constructor for an authenticated native-join capability.

use std::fmt::Debug;

use super::{
    MarketDataOwnerPostgres, load_pit_for_update, load_pit_observation_batch_for_update,
    load_source_for_update, pit_role_resolution_v1::AuthenticatedDesignIdentityV1,
};
use crate::owner::{
    bar_schedule::{
        BarScheduleClockV1, BarScheduleCompletionV1, BarScheduleKindV1, BarScheduleLabelV1,
        BarScheduleUnitV1, UntrustedBarScheduleProposalV1, prepare_bar_schedule_commit_v1,
    },
    instrument_master::InstrumentMasterReadbackV1,
    observation_census::UntrustedObservationCensusRequestV1,
    pit_snapshot::authority::verify_observation_batch,
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
    source_binding::BindingDigest,
    strategy_design_role_intent_v1::StrategyDesignRoleIntentV1,
    strategy_design_role_set::{StrategyDesignRoleEntryV1, StrategyDesignRoleSetReceiptV1},
    strategy_input_binding::{
        MarketDataFieldSemantic, StrategyInputBindingReceipt, StrategyInputChannel,
        StrategyInputUnit, UntrustedStrategyInputBindingRequest, UntrustedStrategyInputScope,
        bind_strategy_input_event_frame, bind_strategy_input_role,
    },
    strategy_input_joined_cut::{
        StrategyInputJoinRoleClaimV1, StrategyInputJoinedCutReceiptV1,
        UntrustedStrategyInputJoinClaimV1, derive_strategy_input_join_identity_v2,
    },
};

// The chain fixtures' instrument, shared with every entry that writes the same custody.
use super::chain_market_base_v1::{
    ChainMarketBaseRecordsV1, ChainMarketBaseSnapshotV1, MarketDataAcceptanceBasisErrorV1,
    chain_market_base_records_on_v1, chain_market_base_scope_v1,
};

const INSTRUMENT: &str = crate::owner::chain_fixture_v1::CHAIN_FIXTURE_INSTRUMENT_V1;

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

impl Debug for OwnerBarJoinedCutAcceptanceBasisV1 {
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
    #[error("disposable Market Data BAR joined-cut acceptance market base was unavailable: {0}")]
    MarketBase(MarketDataAcceptanceBasisErrorV1),
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
    #[error(
        "disposable Market Data BAR joined-cut acceptance registry instrument scope was unavailable"
    )]
    RegistryInstrumentScope,
    #[error(
        "disposable Market Data BAR joined-cut acceptance registry instrument batch digest was unavailable"
    )]
    RegistryInstrumentBatchDigest,
    #[error(
        "disposable Market Data BAR joined-cut acceptance registry instrument cut locator was unavailable"
    )]
    RegistryInstrumentCutLocator,
    #[error(
        "disposable Market Data BAR joined-cut acceptance registry instrument readback was unavailable"
    )]
    RegistryInstrumentReadback,
    #[error(
        "disposable Market Data BAR joined-cut acceptance registry instrument fact count was unavailable"
    )]
    RegistryInstrumentFactCount,
    #[error(
        "disposable Market Data BAR joined-cut acceptance registry instrument digest was unavailable"
    )]
    RegistryInstrumentDigest,
    #[error(
        "disposable Market Data BAR joined-cut acceptance registry instrument cut was unavailable"
    )]
    RegistryInstrumentCut,
    #[error(
        "disposable Market Data BAR joined-cut acceptance registry instrument canonical identity was unavailable"
    )]
    RegistryInstrumentCanonicalIdentity,
    #[error(
        "disposable Market Data BAR joined-cut acceptance registry instrument semantics identity was unavailable"
    )]
    RegistryInstrumentSemanticsIdentity,
    #[error(
        "disposable Market Data BAR joined-cut acceptance registry instrument source frontier was unavailable"
    )]
    RegistryInstrumentSourceFrontier,
    #[error(
        "disposable Market Data BAR joined-cut acceptance registry instrument correction frontier was unavailable"
    )]
    RegistryInstrumentCorrectionFrontier,
    #[error(
        "disposable Market Data BAR joined-cut acceptance registry instrument effective range was unavailable"
    )]
    RegistryInstrumentEffectiveRange,
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
/// The caller resolves `owner_url` for the Market Data Owner role. Taking the resolved URL rather
/// than a test-database handle keeps the disposable harness out of this crate's dependency graph,
/// so enabling this feature links no test harness into a deployed image.
///
/// This phase performs no registry, joined-cut, schedule, V3, or V4 write. It validates only that
/// caller identities are non-zero and unique, then issues the native Owner facts through PIT and
/// derives the exact six bindings from the re-read PostgreSQL batch.
///
/// # Errors
///
/// Returns a redacted unavailable value if any real Owner write, exact readback, or binding fails.
pub async fn prepare_owner_bar_joined_cut_acceptance_basis_v1(
    owner_url: &str,
    claims: UntrustedBarJoinedCutAcceptanceDesignClaimsV1,
) -> Result<OwnerBarJoinedCutAcceptanceBasisV1, BarJoinedCutAcceptanceBasisUnavailableV1> {
    validate_initial_claims(&claims)
        .map_err(|_| BarJoinedCutAcceptanceBasisUnavailableV1::Claims)?;
    let owner = MarketDataOwnerPostgres::connect_existing(owner_url)
        .await
        .map_err(|_| BarJoinedCutAcceptanceBasisUnavailableV1::OwnerConnection)?;
    // The corpus is the chain's one Market Data base: written here when the store holds none,
    // rejoined when an earlier entry wrote it, and never provisioned a second time under other
    // identities.
    let ChainMarketBaseRecordsV1 {
        pit,
        batch,
        instrument,
    } = chain_market_base_records_on_v1(&owner)
        .await
        .map_err(BarJoinedCutAcceptanceBasisUnavailableV1::MarketBase)?;
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

/// Binds a later Design to the acceptance corpus this store already carries.
///
/// The basis above provisions a corpus. Provisioning it twice in one store does not produce the same
/// corpus: it reads the Owner's current clock head into its instrument and universe requests, so a
/// store whose clock has advanced raises a second PIT snapshot while the Market Semantics fact stays
/// bound to the first. That is correct Owner behaviour and not something to defeat, so a later Design
/// binds to the corpus that is already complete rather than raising another.
///
/// Which corpus that is, `market_base` names: the market base's snapshot, found by its correlation.
/// A scope carries one Market Semantics chain per snapshot, so the scope alone would answer only
/// while nothing else had been admitted under it. Under that snapshot the Market Semantics fact
/// gives the batch, and a registration re-derives each binding and refuses unless the fact names the
/// very snapshot the batch came from. Nothing resolves a coordinate, so a store holding several
/// lineages is never asked to choose between them.
///
/// # Errors
///
/// Returns a redacted unavailable value when this store carries no complete acceptance corpus, when
/// the publication does not describe this Design or its exact role set, or when any Owner write or
/// re-read fails.
pub async fn register_bar_joined_cut_declarations_for_published_design_v1(
    owner_url: &str,
    market_base: ChainMarketBaseSnapshotV1,
    claims: &UntrustedBarJoinedCutAcceptanceDesignClaimsV1,
    intent: &StrategyDesignRoleIntentV1,
) -> Result<(), BarJoinedCutAcceptanceCompletionUnavailableV1> {
    validate_published_role_coverage(claims, intent)?;
    let owner = MarketDataOwnerPostgres::connect_existing(owner_url)
        .await
        .map_err(|_| BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryStore)?;
    let mut transaction = owner
        .pool
        .begin()
        .await
        .map_err(|_| BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryStore)?;
    // A scope carries one chain per PIT snapshot, and a production admission under the same scope
    // adds another, so the scope alone names no single corpus. The caller names the market base's
    // snapshot, which must carry the one fact the base sealed.
    super::chain_market_base_v1::require_chain_market_base_fact_v1(
        &mut transaction,
        chain_market_base_scope_v1(),
        market_base,
    )
    .await
    .map_err(|_| BarJoinedCutAcceptanceCompletionUnavailableV1::RegistrySemantics)?;
    let batch = super::strategy_input_binding_registry::load_owner_verified_pit_batch_v1(
        &mut transaction,
        market_base.snapshot_identity(),
    )
    .await
    .map_err(|e| map_registry_completion_error(&e))?;
    transaction
        .rollback()
        .await
        .map_err(|_| BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryStore)?;

    let requests = acceptance_binding_requests(claims, &batch);
    let design = AuthenticatedDesignIdentityV1::from_role_intent(intent);

    for request in &requests {
        let mut transaction = owner
            .pool
            .begin()
            .await
            .map_err(|_| BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryStore)?;
        register_acceptance_binding(&mut transaction, request, &requests, design, intent.roles())
            .await
            .map_err(|e| map_registry_completion_error(&e))?;
        transaction
            .commit()
            .await
            .map_err(|_| BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryStore)?;
    }
    Ok(())
}

/// The publication must describe this Design and exactly the roles the claims name.
fn validate_published_role_coverage(
    claims: &UntrustedBarJoinedCutAcceptanceDesignClaimsV1,
    intent: &StrategyDesignRoleIntentV1,
) -> Result<(), BarJoinedCutAcceptanceCompletionUnavailableV1> {
    if intent.research_request_identity() != claims.research_request_identity
        || intent.design_identity() != claims.strategy_design_identity
    {
        return Err(BarJoinedCutAcceptanceCompletionUnavailableV1::RoleSet);
    }
    let mut published = intent
        .roles()
        .iter()
        .map(|role| role.role_identity)
        .collect::<Vec<_>>();
    let mut declared = claims.input_role_identities.to_vec();
    published.sort_unstable();
    declared.sort_unstable();

    if published != declared {
        return Err(BarJoinedCutAcceptanceCompletionUnavailableV1::RoleSet);
    }
    Ok(())
}

/// Registers this basis's Strategy Input declarations from what R&D published about the Design.
///
/// The joined cut, schedules and V3 projections stay in the completion above, because they need the
/// join a Composer attests. Declarations do not: a Design's roles are stated by R&D, and until a
/// Composer has run the only statement that exists is the published role intent. This is therefore
/// the only way a Design's first cycle can reach declarations at all, and it is also why the
/// Composer that would attest them can exist at all: its program's identity folds in the very
/// binding receipts registered here.
///
/// The requests are the ones this basis composed from its own verified batch, so nothing here
/// resolves a coordinate. A Market Data store that holds two lineages answering one coordinate at
/// one decision cut refuses to choose between them, which is correct and is not this fixture's
/// question to answer.
///
/// # Errors
///
/// Returns a redacted unavailable value when the publication does not describe this basis's Design
/// or its exact role set, or when any Owner write or re-read fails.
pub async fn register_owner_bar_joined_cut_declarations_from_role_intent_v1(
    basis: &OwnerBarJoinedCutAcceptanceBasisV1,
    intent: &StrategyDesignRoleIntentV1,
) -> Result<(), BarJoinedCutAcceptanceCompletionUnavailableV1> {
    if intent.research_request_identity() != basis.claims.research_request_identity
        || intent.design_identity() != basis.claims.strategy_design_identity
    {
        return Err(BarJoinedCutAcceptanceCompletionUnavailableV1::RoleSet);
    }
    let mut published = intent
        .roles()
        .iter()
        .map(|role| role.role_identity)
        .collect::<Vec<_>>();
    let mut declared = basis.claims.input_role_identities.to_vec();
    published.sort_unstable();
    declared.sort_unstable();

    if published != declared {
        return Err(BarJoinedCutAcceptanceCompletionUnavailableV1::RoleSet);
    }
    let design = AuthenticatedDesignIdentityV1::from_role_intent(intent);

    for (ordinal, request) in basis.binding_requests.iter().enumerate() {
        let mut transaction = basis
            .owner
            .pool
            .begin()
            .await
            .map_err(|_| BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryStore)?;
        let declaration = register_acceptance_binding(
            &mut transaction,
            request,
            &basis.binding_requests,
            design,
            intent.roles(),
        )
        .await
        .map_err(|e| map_registry_completion_error(&e))?;

        // The basis pairs its requests and its bindings by position. Reading the pair by ordinal
        // says that directly, and a basis whose two sequences disagree in length is reported as a
        // readback that does not verify rather than ending the process.
        let expected = basis
            .input_bindings
            .get(ordinal)
            .ok_or(BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryReadback)?;

        if declaration.exact_binding() != Some(expected) {
            return Err(BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryReadback);
        }
        transaction
            .commit()
            .await
            .map_err(|_| BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryStore)?;
    }
    Ok(())
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
        let declaration = register_acceptance_binding(
            &mut transaction,
            request,
            &binding_requests,
            AuthenticatedDesignIdentityV1::from_role_set(&role_set),
            &role_set.roles,
        )
        .await
        .map_err(|e| map_registry_completion_error(&e))?;
        transaction
            .commit()
            .await
            .map_err(|_| BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryStore)?;
        registered_bindings.push(
            declaration
                .exact_binding()
                .ok_or(BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryReadback)?
                .clone(),
        );
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
        Registry::InstrumentMasterScopeUnavailable => {
            BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryInstrumentScope
        }
        Registry::InstrumentMasterBatchDigestUnavailable => {
            BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryInstrumentBatchDigest
        }
        Registry::InstrumentMasterCutLocatorUnavailable => {
            BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryInstrumentCutLocator
        }
        Registry::InstrumentMasterReadbackUnavailable => {
            BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryInstrumentReadback
        }
        Registry::InstrumentMasterFactCountUnavailable => {
            BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryInstrumentFactCount
        }
        Registry::InstrumentMasterDigestUnavailable => {
            BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryInstrumentDigest
        }
        Registry::InstrumentMasterCutUnavailable => {
            BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryInstrumentCut
        }
        Registry::InstrumentMasterCanonicalIdentityUnavailable => {
            BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryInstrumentCanonicalIdentity
        }
        Registry::InstrumentMasterSemanticsIdentityUnavailable => {
            BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryInstrumentSemanticsIdentity
        }
        Registry::InstrumentMasterSourceFrontierUnavailable => {
            BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryInstrumentSourceFrontier
        }
        Registry::InstrumentMasterCorrectionFrontierUnavailable => {
            BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryInstrumentCorrectionFrontier
        }
        Registry::InstrumentMasterEffectiveRangeUnavailable => {
            BarJoinedCutAcceptanceCompletionUnavailableV1::RegistryInstrumentEffectiveRange
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
        source: batch
            .binding_request_source_v1()
            .unwrap_or_else(|| unreachable!("an acceptance batch is a committed snapshot's")),
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
        clock: BarScheduleClockV1::ScheduleBounded,
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
        let index = if let Some(index) =
            existing.and_then(|prior| schedule_indices.get(prior).copied())
        {
            index
        } else {
            let mut proposal = proposal.clone();
            proposal.predecessor_fact_digest = schedules
                .last()
                .map(crate::owner::bar_schedule::BarScheduleReadbackV1::fact)
                .map(crate::owner::bar_schedule::BarScheduleFactV1::digest)
                .or(initial_predecessor);
            let prepared =
                prepare_bar_schedule_commit_v1(proposal, binding, batch, instrument, instrument)
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
    design: AuthenticatedDesignIdentityV1,
    roles: &[StrategyDesignRoleEntryV1],
) -> Result<
    super::strategy_input_binding_registry::StrategyInputBindingDeclarationReadbackV1,
    super::strategy_input_binding_registry::StrategyInputBindingRegistryErrorV1,
> {
    super::strategy_input_binding_registry::register_strategy_input_binding_declaration_v1(
        transaction,
        request,
        complete_requests,
        design,
        roles,
    )
    .await
}

#[cfg(test)]
async fn register_acceptance_binding(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
    _complete_requests: &[UntrustedStrategyInputBindingRequest],
    _design: AuthenticatedDesignIdentityV1,
    _roles: &[StrategyDesignRoleEntryV1],
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
