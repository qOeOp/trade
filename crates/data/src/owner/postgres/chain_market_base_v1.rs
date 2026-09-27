//! The chain market base's acceptance corpus, named by the correlation the base submits under.
//!
//! A compatibility scope carries one Market Semantics chain per PIT snapshot, so once anything else
//! is admitted under the market base's scope, the scope alone no longer names the base's corpus. The
//! base's snapshot does, and the base's correlation finds it.

use std::{collections::BTreeSet, future::Future, pin::Pin};

use sqlx::{PgPool, Postgres, Transaction};
use thiserror::Error;

use super::{
    MarketDataOwnerPostgres,
    acceptance_fixture_v1::{
        d, instrument_fact, instrument_request, market_base_pit_time_v1, shared_clock,
        source_proposal,
    },
    public_decision_cut_v1,
};
use crate::owner::{
    chain_fixture_v1::{
        CHAIN_FIXTURE_INSTRUMENT_V1, CHAIN_MARKET_BASE_PIT_CORRELATION_V1,
        CHAIN_MARKET_BASE_RESEARCH_REQUEST_V1,
    },
    instrument_master::{
        InstrumentMasterReadbackV1, InstrumentMasterResolver, InstrumentMasterScopeV1,
    },
    market_semantics::{
        MarketSemanticsConsumerV1, MarketSemanticsPriceAdjustmentV1, MarketSemanticsReadbackV1,
        MarketSemanticsTimestampBasisV1, MarketSemanticsValueV1,
        UntrustedMarketSemanticsProposalV1, authority as market_semantics_authority,
    },
    pit_market_snapshot_intake_v1::MarketDataDecisionCutV1,
    pit_snapshot::{
        PitSnapshotCommitAggregate, UntrustedCorrectionPublicationTime,
        UntrustedEventEffectiveTime, UntrustedPitObservation, UntrustedPitObservationBatchProposal,
        UntrustedPitSnapshotEvidence, UntrustedPitSnapshotLocator, UntrustedPitSnapshotProposal,
        UntrustedPitSnapshotRequest, UntrustedPitSnapshotTimeEvidence,
        UntrustedProviderAvailableTime, UntrustedRetrievalTime, UntrustedSnapshotDecisionCut,
        VerifiedPitObservationBatch,
        authority::{
            TestOnlyCanonicalBasisResolver, derive_observation_batch_digest,
            refresh_request_claims, verify_observation_batch,
        },
        research_pit_requester_identity_v1,
    },
    reference_fact_coordinates::r0::{
        ReferenceFactR0ReadbackV1, UntrustedReferenceFactR0RequestV1,
        request_meaning_digest_v1 as r0_request_meaning_digest,
    },
    shared_time_evidence::{UntrustedClockHeadLocator, build_head_fact},
    source_binding::{
        BindingDigest, MarketDataClockAdmission, SourceBindingOwnerReadback,
        UntrustedSourceBindingLocator, UntrustedSourceBindingProposal,
        authority::{
            OwnerSourceBindingDecision, SourceBindingCommit, derive_binding_id,
            derive_market_semantics_compatibility_identity_v1, derive_time_evidence_identity,
        },
    },
    universe_selection::{
        UniverseSelectionReadbackV1, UntrustedUniverseSelectionRequestV1,
        authority::{
            CanonicalUniverseSelectionRuleEvaluatorV1, HistoricalMembershipFactProposalV1,
        },
    },
};

/// The instants and cut the market base seals its Market Semantics fact under.
const BASE_EFFECTIVE_INSTANT_NS: i128 = 50;
const BASE_OWNER_OBSERVATION_NS: i128 = 100;
const BASE_DECISION_CUT: u64 = 100;

/// The chain market base's PIT snapshot, found by the correlation the base submits under.
///
/// Only this module builds one, so a caller holding one names the base's corpus and no other
/// snapshot.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ChainMarketBaseSnapshotV1(BindingDigest);

impl ChainMarketBaseSnapshotV1 {
    pub(crate) const fn snapshot_identity(self) -> BindingDigest {
        self.0
    }
}

/// Why the chain market base's corpus could not be named.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum ChainMarketBaseUnavailableV1 {
    #[error("the Market Data store was unavailable")]
    Store,
    #[error("no initial PIT snapshot carries the chain market base's correlation and requester")]
    NoSnapshot,
    #[error(
        "more than one initial PIT snapshot carries the chain market base's correlation and requester"
    )]
    Ambiguous,
    #[error("the market base's snapshot carries no single Market Semantics fact under this scope")]
    Semantics,
}

/// Finds the chain market base's PIT snapshot in the store at `owner_url`.
///
/// # Errors
///
/// [`ChainMarketBaseUnavailableV1::NoSnapshot`] when the store holds no snapshot under the base's
/// correlation, and [`ChainMarketBaseUnavailableV1::Store`] when it cannot be read.
pub async fn chain_market_base_snapshot_v1(
    owner_url: &str,
) -> Result<ChainMarketBaseSnapshotV1, ChainMarketBaseUnavailableV1> {
    let owner = MarketDataOwnerPostgres::connect_existing(owner_url)
        .await
        .map_err(|_| ChainMarketBaseUnavailableV1::Store)?;
    let mut transaction = owner
        .pool
        .begin()
        .await
        .map_err(|_| ChainMarketBaseUnavailableV1::Store)?;
    let snapshot = chain_market_base_snapshot_in_transaction_v1(&mut transaction).await?;
    transaction
        .rollback()
        .await
        .map_err(|_| ChainMarketBaseUnavailableV1::Store)?;
    Ok(snapshot)
}

/// Finds the chain market base's PIT snapshot: the one initial snapshot whose request carries the
/// base's correlation and requester.
///
/// Both are compared as the Owner stored them, in the snapshot's aggregate, serialized by the same
/// encoder that wrote it.
pub(crate) async fn chain_market_base_snapshot_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<ChainMarketBaseSnapshotV1, ChainMarketBaseUnavailableV1> {
    let correlation = serde_json::to_value(BindingDigest::from_untrusted_bytes(
        CHAIN_MARKET_BASE_PIT_CORRELATION_V1,
    ))
    .map_err(|_| ChainMarketBaseUnavailableV1::Store)?;
    let requester = serde_json::to_value(research_pit_requester_identity_v1(
        BindingDigest::from_untrusted_bytes(CHAIN_MARKET_BASE_RESEARCH_REQUEST_V1),
    ))
    .map_err(|_| ChainMarketBaseUnavailableV1::Store)?;
    let snapshots: Vec<Vec<u8>> = sqlx::query_scalar(
        "SELECT snapshot_identity FROM market_data_private.pit_snapshot_facts_v1 \
         WHERE lineage_version=1 \
           AND aggregate_json #> '{fact,request,correlation_identity}' = $1 \
           AND aggregate_json #> '{fact,request,requester_identity}' = $2",
    )
    .bind(correlation)
    .bind(requester)
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| ChainMarketBaseUnavailableV1::Store)?;
    let snapshot = match snapshots.as_slice() {
        [] => return Err(ChainMarketBaseUnavailableV1::NoSnapshot),
        [snapshot] => snapshot,
        _ => return Err(ChainMarketBaseUnavailableV1::Ambiguous),
    };
    let snapshot: [u8; 32] = snapshot
        .as_slice()
        .try_into()
        .map_err(|_| ChainMarketBaseUnavailableV1::Store)?;
    Ok(ChainMarketBaseSnapshotV1(
        BindingDigest::from_untrusted_bytes(snapshot),
    ))
}

/// Requires exactly one Market Semantics fact under `scope` for the base's snapshot, the one the
/// base sealed, whatever else the scope carries.
pub(crate) async fn require_chain_market_base_fact_v1(
    transaction: &mut Transaction<'_, Postgres>,
    scope: BindingDigest,
    market_base: ChainMarketBaseSnapshotV1,
) -> Result<(), ChainMarketBaseUnavailableV1> {
    let readback = super::market_semantics::resolve_market_semantics_scope_in_transaction_v1(
        transaction,
        scope,
        market_base.0,
        BASE_EFFECTIVE_INSTANT_NS,
        BASE_OWNER_OBSERVATION_NS,
        BASE_DECISION_CUT,
    )
    .await
    .map_err(|_| ChainMarketBaseUnavailableV1::Semantics)?;
    let [fact] = readback.facts() else {
        return Err(ChainMarketBaseUnavailableV1::Semantics);
    };

    if fact.pit_snapshot_identity != market_base.0 {
        return Err(ChainMarketBaseUnavailableV1::Semantics);
    }
    Ok(())
}

/// Identifies one Market Data acceptance basis a chain entry asks for.
///
/// The chain has one basis, [`CHAIN_MARKET_DATA_ACCEPTANCE_BASIS_V1`]. Every entry names it by
/// that constant instead of spelling its bytes, so a second basis could only be added here.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MarketDataAcceptanceBasisIdentityV1([u8; 32]);

/// The chain's Market Data acceptance basis: the market base the replay composition entry asserts
/// over and every later entry reads.
pub const CHAIN_MARKET_DATA_ACCEPTANCE_BASIS_V1: MarketDataAcceptanceBasisIdentityV1 =
    MarketDataAcceptanceBasisIdentityV1(CHAIN_MARKET_BASE_PIT_CORRELATION_V1);

/// The exact request an Owner record of the basis was resolved for.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MarketDataAcceptanceRequestLocatorV1 {
    request_identity: BindingDigest,
    request_meaning_digest: BindingDigest,
}

impl MarketDataAcceptanceRequestLocatorV1 {
    pub const fn request_identity(&self) -> BindingDigest {
        self.request_identity
    }

    pub const fn request_meaning_digest(&self) -> BindingDigest {
        self.request_meaning_digest
    }
}

/// The coordinates of the one role value the basis's snapshot carries for authored programs: the
/// instrument's daily close.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MarketDataAcceptanceRoleCoordinatesV1 {
    channel: &'static str,
    data_kind: &'static str,
    field: &'static str,
    timeframe: &'static str,
    scale: u8,
}

impl MarketDataAcceptanceRoleCoordinatesV1 {
    pub const fn channel(&self) -> &'static str {
        self.channel
    }

    pub const fn data_kind(&self) -> &'static str {
        self.data_kind
    }

    pub const fn field(&self) -> &'static str {
        self.field
    }

    pub const fn timeframe(&self) -> &'static str {
        self.timeframe
    }

    pub const fn scale(&self) -> u8 {
        self.scale
    }
}

/// A pointer the Owner holds as current, which later writers may move away from the basis.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MarketDataAcceptanceBasisPointerV1 {
    /// The Owner clock head, which fixes the decision cut every current read is taken at.
    ClockHead,
    /// The eligible-instrument frontier a universe selection is evaluated against.
    EligibleFrontier,
}

/// Why the acceptance basis could not be ensured or is not what the store currently holds.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum MarketDataAcceptanceBasisErrorV1 {
    #[error("no Market Data acceptance basis is defined under this identity")]
    UnknownBasis,
    #[error("the store's {step} does not match the acceptance basis")]
    Diverged { step: &'static str },
    #[error("the Owner clock head is at or past the basis's valid-through {valid_through}")]
    Expired { valid_through: u64 },
    #[error("the Owner's current {0:?} is not the acceptance basis's")]
    NotCurrent(MarketDataAcceptanceBasisPointerV1),
    #[error("the Market Data store was unavailable")]
    StoreUnavailable,
}

/// The chain's Market Data acceptance basis, as the store holds it.
///
/// Only [`ensure_market_data_acceptance_basis_v1`] builds one, from the store: holding one means the
/// basis was written or rejoined, never that a caller assembled its values.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketDataAcceptanceBasisV1 {
    decision_cut: MarketDataDecisionCutV1,
    eligible_frontier: BindingDigest,
    source_binding: UntrustedSourceBindingLocator,
    market_semantics: MarketDataAcceptanceRequestLocatorV1,
    pit: UntrustedPitSnapshotLocator,
    instrument: &'static str,
    instrument_master: MarketDataAcceptanceRequestLocatorV1,
    role_coordinates: MarketDataAcceptanceRoleCoordinatesV1,
}

impl MarketDataAcceptanceBasisV1 {
    /// The Owner decision cut the basis was written at.
    pub const fn decision_cut(&self) -> &MarketDataDecisionCutV1 {
        &self.decision_cut
    }

    /// The eligible-instrument frontier the basis's universe selection was evaluated against.
    pub const fn eligible_frontier(&self) -> BindingDigest {
        self.eligible_frontier
    }

    pub const fn source_binding(&self) -> &UntrustedSourceBindingLocator {
        &self.source_binding
    }

    /// The Market Semantics request the basis's fact was resolved for.
    pub const fn market_semantics(&self) -> MarketDataAcceptanceRequestLocatorV1 {
        self.market_semantics
    }

    pub const fn pit(&self) -> &UntrustedPitSnapshotLocator {
        &self.pit
    }

    /// The venue-qualified instrument the basis admits and observes.
    pub const fn instrument(&self) -> &'static str {
        self.instrument
    }

    /// The Instrument Master request the basis's snapshot binds the instrument under.
    pub const fn instrument_master(&self) -> MarketDataAcceptanceRequestLocatorV1 {
        self.instrument_master
    }

    pub const fn role_coordinates(&self) -> MarketDataAcceptanceRoleCoordinatesV1 {
        self.role_coordinates
    }

    /// Requires the Owner's current `pointer` in the store at `owner_url` to be the basis's.
    ///
    /// An entry that reads a current pointer states this first: another entry may have moved the
    /// pointer since the basis was written, and a read that silently took the moved pointer would
    /// still pass. The read takes no lock and writes nothing.
    ///
    /// # Errors
    ///
    /// [`MarketDataAcceptanceBasisErrorV1::NotCurrent`] naming `pointer` when it has moved, and
    /// [`MarketDataAcceptanceBasisErrorV1::StoreUnavailable`] when the store cannot be read.
    pub async fn require_current_in(
        &self,
        owner_url: &str,
        pointer: MarketDataAcceptanceBasisPointerV1,
    ) -> Result<(), MarketDataAcceptanceBasisErrorV1> {
        let owner = MarketDataOwnerPostgres::connect_existing(owner_url)
            .await
            .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?;
        self.require_current_on_v1(&owner.pool, pointer).await
    }

    /// [`Self::require_current_in`] on a pool the caller already holds.
    pub(super) async fn require_current_on_v1(
        &self,
        pool: &PgPool,
        pointer: MarketDataAcceptanceBasisPointerV1,
    ) -> Result<(), MarketDataAcceptanceBasisErrorV1> {
        let mut transaction = pool
            .begin()
            .await
            .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?;
        sqlx::query("SET TRANSACTION READ ONLY")
            .execute(&mut *transaction)
            .await
            .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?;
        let current = match pointer {
            MarketDataAcceptanceBasisPointerV1::ClockHead => {
                super::load_owner_clock_head_v1(&mut transaction)
                    .await
                    .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?
                    .is_some_and(|head| public_decision_cut_v1(&head) == self.decision_cut)
            }
            MarketDataAcceptanceBasisPointerV1::EligibleFrontier => {
                super::universe_selection::resolve_current_eligible_frontier_v1(&mut transaction)
                    .await
                    .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?
                    == Some(self.eligible_frontier)
            }
        };
        transaction
            .rollback()
            .await
            .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?;

        if current {
            Ok(())
        } else {
            Err(MarketDataAcceptanceBasisErrorV1::NotCurrent(pointer))
        }
    }
}

/// The future [`ensure_market_data_acceptance_basis_v1`] returns.
pub type MarketDataAcceptanceBasisFutureV1<'a> = Pin<
    Box<
        dyn Future<Output = Result<MarketDataAcceptanceBasisV1, MarketDataAcceptanceBasisErrorV1>>
            + 'a,
    >,
>;

/// Ensures the Market Data acceptance basis `basis` in the store at `owner_url`, and returns it.
///
/// A store that holds no basis gets the chain market base written through the Owner's own write
/// paths, in this order: the Source Binding under the historical clock (which admits the clock
/// head), its Instrument Master fact and cut, the historical native Reference Fact R0 corpus, the
/// clock successor, the successor Instrument Master fact and cut, and then the base corpus -
/// eligible frontier, universe selection, PIT snapshot with its observation batch, Reference Fact
/// R0, Market Semantics registry entry and fact. Only this first write moves the Owner's clock
/// head and current eligible frontier. A store that already holds the base rejoins it: every value
/// is read back and compared, nothing is written, and no pointer moves, even when a later writer
/// has since moved one; [`MarketDataAcceptanceBasisV1::require_current_in`] is how a reader
/// states that it has not. An expired basis is refused by name and never written again.
///
/// One step is not the production mint. The base's two PIT snapshots are committed against a
/// canonical basis the base seals itself ([`TestOnlyCanonicalBasisResolver`]), as the replay
/// composition entry has always committed them and as the other sealed acceptance fixtures do,
/// rather than through `commit_pit_initial_from_owner_custody_v1`. The evidence sealed is what the
/// Owner's own determination finds for these snapshots - an admitted binding, the binding's own
/// compatibility identity, and a batch covering exactly the selected member - but the production
/// mint also appends the Owner's R0 record for each snapshot it makes Available, which the base
/// does not hold beside its own Reference Fact R0 requests. Moving the base to that mint changes
/// what every later chain entry reads, so it is its own change, measured across the chain.
///
/// The future is built here rather than in the caller's poll frame, because the chain's entries
/// call this at their start, on frames the rest of the entry is still deep under.
///
/// The future answers [`MarketDataAcceptanceBasisErrorV1::UnknownBasis`] for an identity no basis
/// is defined under, [`MarketDataAcceptanceBasisErrorV1::Diverged`] naming the first step whose
/// stored state does not match the basis, [`MarketDataAcceptanceBasisErrorV1::Expired`] when the
/// Owner clock head is at or past the basis's valid-through, and
/// [`MarketDataAcceptanceBasisErrorV1::StoreUnavailable`] when the store cannot be reached.
pub fn ensure_market_data_acceptance_basis_v1(
    owner_url: &str,
    basis: MarketDataAcceptanceBasisIdentityV1,
) -> MarketDataAcceptanceBasisFutureV1<'_> {
    Box::pin(async move {
        if basis != CHAIN_MARKET_DATA_ACCEPTANCE_BASIS_V1 {
            return Err(MarketDataAcceptanceBasisErrorV1::UnknownBasis);
        }
        let owner = MarketDataOwnerPostgres::connect(owner_url)
            .await
            .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?;
        ensure_chain_market_base_on_v1(&owner).await
    })
}

/// [`ensure_market_data_acceptance_basis_v1`] for the chain's basis, on an Owner the caller already
/// holds.
pub(super) fn ensure_chain_market_base_on_v1(
    owner: &MarketDataOwnerPostgres,
) -> MarketDataAcceptanceBasisFutureV1<'_> {
    Box::pin(async move {
        let existing = existing_chain_market_base_v1(owner).await?;

        match existing {
            None => write_chain_market_base_v1(owner)
                .await
                .map(|written| written.basis()),
            Some(snapshot) => rejoin_chain_market_base_v1(owner, snapshot)
                .await
                .map(|(basis, _)| basis),
        }
    })
}

/// The chain market base's snapshot, when the store already holds one.
async fn existing_chain_market_base_v1(
    owner: &MarketDataOwnerPostgres,
) -> Result<Option<ChainMarketBaseSnapshotV1>, MarketDataAcceptanceBasisErrorV1> {
    let mut transaction = owner
        .pool
        .begin()
        .await
        .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?;
    let existing = match chain_market_base_snapshot_in_transaction_v1(&mut transaction).await {
        Ok(snapshot) => Some(snapshot),
        Err(ChainMarketBaseUnavailableV1::NoSnapshot) => None,
        Err(ChainMarketBaseUnavailableV1::Ambiguous) => return Err(diverged("pit_snapshot")),
        Err(_) => return Err(MarketDataAcceptanceBasisErrorV1::StoreUnavailable),
    };
    transaction
        .rollback()
        .await
        .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?;
    Ok(existing)
}

/// The base's records a chain entry builds its own custody over: the base's PIT snapshot, the
/// snapshot's verified observation batch, and the Instrument Master cut the snapshot binds.
pub(super) struct ChainMarketBaseRecordsV1 {
    pub(super) pit: PitSnapshotCommitAggregate,
    pub(super) batch: VerifiedPitObservationBatch,
    pub(super) instrument: InstrumentMasterReadbackV1,
}

/// Ensures the chain market base on `owner`, as [`ensure_market_data_acceptance_basis_v1`] does,
/// and returns the base's records rather than its handle.
///
/// A rejoin reads the records back after the same comparisons the handle's rejoin makes, and adds
/// one: the Instrument Master cut it resolves is the one the snapshot binds.
pub(super) fn chain_market_base_records_on_v1(
    owner: &MarketDataOwnerPostgres,
) -> Pin<
    Box<
        dyn Future<Output = Result<ChainMarketBaseRecordsV1, MarketDataAcceptanceBasisErrorV1>>
            + '_,
    >,
> {
    Box::pin(async move {
        let Some(snapshot) = existing_chain_market_base_v1(owner).await? else {
            let written = write_chain_market_base_v1(owner).await?;
            return Ok(ChainMarketBaseRecordsV1 {
                pit: written.corpus.pit,
                batch: written.corpus.batch,
                instrument: written.instrument,
            });
        };
        let (_, pit) = rejoin_chain_market_base_v1(owner, snapshot).await?;
        let batch = {
            let mut transaction = owner
                .pool
                .begin()
                .await
                .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?;
            let stored = super::load_pit_observation_batch_for_update(&mut transaction, &pit)
                .await
                .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?
                .ok_or_else(|| diverged("pit_observation_batch"))?;
            let batch = verify_observation_batch(
                &pit,
                stored.source_binding_identity,
                stored.source_binding_lineage_root,
                stored.source_binding_lineage_version,
                stored.digest,
                &stored.bytes,
                &stored.rows,
            )
            .map_err(|_| diverged("pit_observation_batch"))?;
            transaction
                .rollback()
                .await
                .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?;
            batch
        };
        let historical = build_head_fact(&chain_market_base_historical_clock_v1(), None)
            .map_err(|_| diverged("clock_head"))?;
        let successor = build_head_fact(
            &chain_market_base_clock_v1(),
            Some(historical.handoff.head_digest()),
        )
        .map_err(|_| diverged("clock_head"))?;
        let instrument = owner
            .resolve_instrument_master(
                &instrument_request(
                    BASE_INSTRUMENT_MASTER_REQUEST,
                    InstrumentMasterScopeV1::ExactInstrument(CHAIN_FIXTURE_INSTRUMENT_V1.into()),
                    successor.handoff.locator().clone(),
                ),
                None,
            )
            .await
            .map_err(|_| diverged("instrument_master_cut"))?;

        if instrument.digest() != pit.fact().request().instrument_master_digest {
            return Err(diverged("instrument_master_cut"));
        }
        Ok(ChainMarketBaseRecordsV1 {
            pit,
            batch,
            instrument,
        })
    })
}

/// The instant the basis is written at and every basis record is observed by.
const BASE_WRITTEN_AT: u64 = 100;
/// The historical instant the base's native Reference Fact R0 corpus is written at.
const BASE_HISTORICAL_AT: u64 = 99;
/// The eligible-instrument frontier the base's universe selection is evaluated against.
const BASE_ELIGIBLE_FRONTIER: u8 = 170;
/// The scope digest the base's PIT request states.
const BASE_PIT_SCOPE: u8 = 176;
/// The Instrument Master request the base's snapshot binds the instrument under.
const BASE_INSTRUMENT_MASTER_REQUEST: u8 = 110;
/// The Instrument Master request the historical native corpus binds the instrument under.
const HISTORICAL_INSTRUMENT_MASTER_REQUEST: u8 = 107;
/// The Reference Fact R0 request the base resolves over its snapshot.
const BASE_R0_REQUEST: u8 = 183;
/// The Market Semantics request the base's fact is resolved for.
const BASE_MARKET_SEMANTICS_REQUEST: u8 = 188;

/// The clock identity and epoch the base's two clocks share.
pub(super) const BASE_CLOCK_IDENTITY: &str = "12345678901234567890123456789012";
pub(super) const BASE_CLOCK_EPOCH: &str = "abcdefghijklmnopqrstuvwxyzABCDEF";

/// The clock the base's corpus is written on: the successor of the historical clock.
pub(super) fn chain_market_base_clock_v1() -> MarketDataClockAdmission {
    shared_clock(
        BASE_CLOCK_IDENTITY,
        BASE_CLOCK_EPOCH,
        2,
        BASE_WRITTEN_AT,
        d(90),
        1,
        2,
    )
}

/// The clock the base's Source Binding and historical native corpus are written on.
pub(super) fn chain_market_base_historical_clock_v1() -> MarketDataClockAdmission {
    shared_clock(
        BASE_CLOCK_IDENTITY,
        BASE_CLOCK_EPOCH,
        1,
        BASE_HISTORICAL_AT,
        d(90),
        1,
        2,
    )
}

/// The Source Binding the base admits, on the historical clock.
pub(super) fn chain_market_base_source_proposal_v1(
    historical_clock: &MarketDataClockAdmission,
) -> UntrustedSourceBindingProposal {
    let mut proposal = source_proposal(10, BASE_HISTORICAL_AT);
    let time = &mut proposal.time_evidence;
    time.clock_identity
        .clone_from(&historical_clock.clock_identity);
    time.clock_epoch.clone_from(&historical_clock.clock_epoch);
    time.monotonic_sequence = 1;
    time.restart_continuity_digest = d(90);
    time.skew_bound = 2;
    time.uncertainty_bound = 1;
    time.observed_at = BASE_HISTORICAL_AT;
    time.effective_at = BASE_HISTORICAL_AT;
    time.valid_through = 159;
    time.provider_available = 89;
    time.retrieval = 91;
    time.correction_publication = 90;
    proposal.source_frontier.cut_identity = "instrument-source-cut-85".into();
    proposal.source_frontier.digest = d(85);
    proposal.correction_frontier.cut_identity = "instrument-correction-cut-86".into();
    proposal.correction_frontier.digest = d(86);
    proposal.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&proposal.time_evidence);
    proposal.claimed_binding_id = derive_binding_id(&proposal);
    proposal
}

/// The Market Semantics compatibility scope of the base's Source Binding, derived from its
/// semantics by the function production admits under.
pub(super) fn chain_market_base_scope_v1() -> BindingDigest {
    derive_market_semantics_compatibility_identity_v1(
        &chain_market_base_source_proposal_v1(&chain_market_base_historical_clock_v1()).semantics,
    )
}

/// The base's writes, as the Owner committed them.
pub(super) struct ChainMarketBaseWriteV1 {
    pub(super) clock: MarketDataClockAdmission,
    pub(super) source: SourceBindingCommit,
    pub(super) instrument: InstrumentMasterReadbackV1,
    pub(super) native_r0: ReferenceFactR0ReadbackV1,
    pub(super) corpus: MarketBaseCorpusV1,
}

impl ChainMarketBaseWriteV1 {
    fn basis(&self) -> MarketDataAcceptanceBasisV1 {
        chain_market_base_basis_v1(
            &self.clock,
            self.corpus.pit.receipt().locator().clone(),
            self.source.receipt().locator().clone(),
            self.corpus.semantics_request,
        )
    }
}

/// The values every basis handle carries, from the base's clock and its three stored locators.
fn chain_market_base_basis_v1(
    clock: &MarketDataClockAdmission,
    pit: UntrustedPitSnapshotLocator,
    source_binding: UntrustedSourceBindingLocator,
    market_semantics: MarketDataAcceptanceRequestLocatorV1,
) -> MarketDataAcceptanceBasisV1 {
    MarketDataAcceptanceBasisV1 {
        decision_cut: public_decision_cut_v1(clock),
        eligible_frontier: d(BASE_ELIGIBLE_FRONTIER),
        source_binding,
        market_semantics,
        pit,
        instrument: CHAIN_FIXTURE_INSTRUMENT_V1,
        instrument_master: base_instrument_locator_v1(),
        role_coordinates: MarketDataAcceptanceRoleCoordinatesV1 {
            channel: "MARKET",
            data_kind: "BAR",
            field: "CLOSE",
            timeframe: "1D",
            scale: 2,
        },
    }
}

/// Writes the chain market base on a store that holds none.
///
/// The replay composition entry and the Market Data suite's base fixtures take the committed
/// records from here; [`ensure_market_data_acceptance_basis_v1`] keeps only the handle.
pub(super) fn write_chain_market_base_v1(
    owner: &MarketDataOwnerPostgres,
) -> Pin<
    Box<dyn Future<Output = Result<ChainMarketBaseWriteV1, MarketDataAcceptanceBasisErrorV1>> + '_>,
> {
    Box::pin(async move {
        let historical_clock = chain_market_base_historical_clock_v1();
        let clock = chain_market_base_clock_v1();
        let source = owner
            .commit_source_initial(
                chain_market_base_source_proposal_v1(&historical_clock),
                OwnerSourceBindingDecision {
                    blockers: BTreeSet::new(),
                },
                &historical_clock,
            )
            .await
            .map_err(|_| diverged("source_binding"))?;
        let historical_head =
            build_head_fact(&historical_clock, None).map_err(|_| diverged("clock_head"))?;
        let historical_fact = owner
            .append_instrument_master_fact(
                instrument_fact(CHAIN_FIXTURE_INSTRUMENT_V1, None, 85),
                historical_head.handoff.locator(),
            )
            .await
            .map_err(|_| diverged("instrument_master_fact"))?;
        let mut historical_request = instrument_request(
            HISTORICAL_INSTRUMENT_MASTER_REQUEST,
            InstrumentMasterScopeV1::ExactInstrument(CHAIN_FIXTURE_INSTRUMENT_V1.into()),
            historical_head.handoff.locator().clone(),
        );
        historical_request.owner_observation = i128::from(BASE_HISTORICAL_AT);
        historical_request.decision_cut = BASE_HISTORICAL_AT;
        historical_request.correction_frontier = d(85);
        let historical_instrument = owner
            .resolve_instrument_master(&historical_request, None)
            .await
            .map_err(|_| diverged("instrument_master_cut"))?;
        let native_r0 = persist_historical_native_r0_v1(
            owner,
            &source,
            &historical_instrument,
            &historical_clock,
        )
        .await?;
        let successor = owner
            .commit_clock_successor(&historical_head.handoff, &clock)
            .await
            .map_err(|_| diverged("clock_head"))?;
        owner
            .append_instrument_master_fact(
                instrument_fact(
                    CHAIN_FIXTURE_INSTRUMENT_V1,
                    Some(historical_fact.digest()),
                    86,
                ),
                successor.handoff().locator(),
            )
            .await
            .map_err(|_| diverged("instrument_master_fact"))?;
        let request = instrument_request(
            BASE_INSTRUMENT_MASTER_REQUEST,
            InstrumentMasterScopeV1::ExactInstrument(CHAIN_FIXTURE_INSTRUMENT_V1.into()),
            successor.handoff().locator().clone(),
        );
        let instrument = owner
            .resolve_instrument_master(&request, None)
            .await
            .map_err(|_| diverged("instrument_master_cut"))?;
        let corpus = commit_market_base_corpus_v1(owner, &source, &instrument, &clock).await?;
        Ok(ChainMarketBaseWriteV1 {
            clock,
            source,
            instrument,
            native_r0,
            corpus,
        })
    })
}

/// Rejoins the chain market base a store already holds: reads every value back, compares it with
/// the basis, and writes nothing.
async fn rejoin_chain_market_base_v1(
    owner: &MarketDataOwnerPostgres,
    snapshot: ChainMarketBaseSnapshotV1,
) -> Result<
    (MarketDataAcceptanceBasisV1, PitSnapshotCommitAggregate),
    MarketDataAcceptanceBasisErrorV1,
> {
    let clock = chain_market_base_clock_v1();
    let expected_source = derive_binding_id(&chain_market_base_source_proposal_v1(
        &chain_market_base_historical_clock_v1(),
    ));
    let mut transaction = owner
        .pool
        .begin()
        .await
        .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?;
    let head = super::load_owner_clock_head_v1(&mut transaction)
        .await
        .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?
        .ok_or_else(|| diverged("clock_head"))?;
    if head.clock_identity != clock.clock_identity || head.clock_epoch != clock.clock_epoch {
        return Err(diverged("clock_head"));
    }

    if head.decision_cut >= clock.valid_through {
        return Err(MarketDataAcceptanceBasisErrorV1::Expired {
            valid_through: clock.valid_through,
        });
    }
    let pit = super::load_pit(&mut transaction, snapshot.snapshot_identity(), false, false)
        .await
        .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?
        .ok_or_else(|| diverged("pit_snapshot"))?;
    let request = pit.fact().request();
    if request.scope_digest != d(BASE_PIT_SCOPE)
        || request.source_binding.binding_id != expected_source
        || request.time_evidence.decision_cut.value != BASE_WRITTEN_AT
        || request.time_evidence.decision_cut.clock_identity != clock.clock_identity
        || request.time_evidence.decision_cut.clock_epoch != clock.clock_epoch
    {
        return Err(diverged("pit_snapshot"));
    }
    let scope = request.market_semantics_identity;
    require_chain_market_base_fact_v1(&mut transaction, scope, snapshot)
        .await
        .map_err(|_| diverged("market_semantics"))?;
    let source_locator = request.source_binding.clone();
    let pit_locator = pit.receipt().locator().clone();
    let semantics_request = market_base_semantics_proposal_v1(
        scope,
        &pit_locator,
        &source_locator,
        base_instrument_locator_v1(),
    )?;
    super::market_semantics::recover_market_semantics_in_transaction_v1(
        &mut transaction,
        semantics_request.locator(),
    )
    .await
    .map_err(|_| diverged("market_semantics"))?;
    transaction
        .rollback()
        .await
        .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?;
    let basis = chain_market_base_basis_v1(
        &clock,
        pit_locator,
        source_locator,
        MarketDataAcceptanceRequestLocatorV1 {
            request_identity: semantics_request.request_identity,
            request_meaning_digest: semantics_request.request_meaning_digest,
        },
    );
    Ok((basis, pit))
}

const fn diverged(step: &'static str) -> MarketDataAcceptanceBasisErrorV1 {
    MarketDataAcceptanceBasisErrorV1::Diverged { step }
}

/// The Instrument Master request the base's snapshot binds the instrument under, as the base's
/// Market Semantics fact names it.
fn base_instrument_locator_v1() -> MarketDataAcceptanceRequestLocatorV1 {
    let request = instrument_request(
        BASE_INSTRUMENT_MASTER_REQUEST,
        InstrumentMasterScopeV1::ExactInstrument(CHAIN_FIXTURE_INSTRUMENT_V1.into()),
        UntrustedClockHeadLocator::from_untrusted(d(0), d(0)),
    );
    MarketDataAcceptanceRequestLocatorV1 {
        request_identity: request.request_identity,
        request_meaning_digest: request.request_meaning_digest,
    }
}

/// The one exact instrument a base corpus binds: the canonical identity of the single fact its
/// Instrument Master readback holds, and none when it holds any other number.
pub(super) fn exact_instrument_identity_v1(readback: &InstrumentMasterReadbackV1) -> Option<&str> {
    match readback.facts() {
        [fact] => Some(fact.canonical_identity()),
        _ => None,
    }
}

/// The records a market base corpus commits over one Source Binding and Instrument Master cut.
pub(super) struct MarketBaseCorpusV1 {
    pub(super) source_readback: SourceBindingOwnerReadback,
    pub(super) universe: UniverseSelectionReadbackV1,
    pub(super) pit: PitSnapshotCommitAggregate,
    pub(super) batch: VerifiedPitObservationBatch,
    pub(super) r0_request: UntrustedReferenceFactR0RequestV1,
    pub(super) r0: ReferenceFactR0ReadbackV1,
    pub(super) semantics_proposal: UntrustedMarketSemanticsProposalV1,
    pub(super) semantics: MarketSemanticsReadbackV1,
    semantics_request: MarketDataAcceptanceRequestLocatorV1,
}

/// The six bar values a market base snapshot observes for its instrument, each at scale 2.
const MARKET_BASE_OBSERVATIONS: [(&str, &str, &str, i128); 6] = [
    ("AAPL.CLOSE.1H", "CLOSE", "1H", 12_301),
    ("AAPL.CLOSE.1M", "CLOSE", "1M", 12_345),
    ("AAPL.CLOSE.EXCHANGE_SESSION_1D", "CLOSE", "1D", 12_299),
    ("AAPL.HIGH.1M", "HIGH", "1M", 12_401),
    ("AAPL.LOW.1M", "LOW", "1M", 12_211),
    ("AAPL.OPEN.1M", "OPEN", "1M", 12_251),
];

/// One PIT observation batch over `rows`, bound to `source`, `instrument` and `universe`, with the
/// row times of one snapshot.
fn market_base_observation_batch_v1(
    rows: &[(&str, &str, &str, i128)],
    member: &str,
    source: &SourceBindingCommit,
    instrument_master_digest: BindingDigest,
    universe_selection_digest: BindingDigest,
    scope: BindingDigest,
    times: MarketBaseRowTimesV1,
) -> UntrustedPitObservationBatchProposal {
    let correction = &source.receipt().locator().correction_frontier;
    UntrustedPitObservationBatchProposal {
        rows: rows
            .iter()
            .map(
                |&(symbolic_key, field, timeframe, value_mantissa)| UntrustedPitObservation {
                    symbolic_key: symbolic_key.into(),
                    member_key: member.into(),
                    instrument: member.into(),
                    channel: "MARKET".into(),
                    data_kind: "BAR".into(),
                    timeframe: timeframe.into(),
                    field: field.into(),
                    value_mantissa,
                    value_scale: 2,
                    event_effective: 50,
                    provider_available: times.provider_available,
                    retrieval: times.retrieval,
                    correction_publication: times.correction_publication,
                    source_binding_identity: source.fact().binding_id(),
                    source_frontier_digest: d(85),
                    instrument_master_digest,
                    universe_selection_digest,
                    market_semantics_identity: scope,
                    correction_stream_identity: correction.stream_identity.clone(),
                    correction_sequence: correction.sequence,
                    correction_frontier_digest: d(86),
                },
            )
            .collect(),
    }
}

/// The availability instants a market base snapshot's rows carry.
#[derive(Clone, Copy)]
struct MarketBaseRowTimesV1 {
    provider_available: u64,
    retrieval: u64,
    correction_publication: u64,
}

/// Admits `membership_frontier` with `member` as its one member and evaluates one universe
/// selection over it.
#[allow(clippy::too_many_arguments)]
async fn admit_market_base_universe_v1(
    owner: &MarketDataOwnerPostgres,
    source: &SourceBindingCommit,
    member: &str,
    membership_frontier: BindingDigest,
    selection: [BindingDigest; 3],
    times: MarketBaseRowTimesV1,
    owner_observation: u64,
    decision_cut: u64,
) -> Result<UniverseSelectionReadbackV1, MarketDataAcceptanceBasisErrorV1> {
    let [request_identity, request_meaning, correlation] = selection;
    let request = UntrustedUniverseSelectionRequestV1::new(
        request_identity,
        "RESEARCH_OWNER_V1",
        request_meaning,
        vec![0, 1, 1],
        membership_frontier,
        50,
        i128::from(owner_observation),
        decision_cut,
        source.fact().lineage_root(),
        d(86),
        correlation,
    );
    let mut transaction = owner
        .pool
        .begin()
        .await
        .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?;
    super::universe_selection::persist_historical_membership_frontier_v1(
        &mut transaction,
        membership_frontier,
        vec![HistoricalMembershipFactProposalV1 {
            member_key: member.as_bytes().to_vec(),
            instrument: member.as_bytes().to_vec(),
            predecessor_identity: None,
            effective_from_ns: 1,
            effective_until_ns: None,
            provider_available_ns: i128::from(times.provider_available),
            retrieval_ns: i128::from(times.retrieval),
            correction_publication_ns: i128::from(times.correction_publication),
            owner_observation_ns: i128::from(owner_observation),
            decision_cut,
            source_binding_lineage_root: source.fact().lineage_root(),
            correction_frontier_digest: d(86),
        }],
    )
    .await
    .map_err(|_| diverged("eligible_frontier"))?;
    let readback = super::universe_selection::resolve_universe_selection_in_transaction_v1(
        &mut transaction,
        &request,
        Some(&CanonicalUniverseSelectionRuleEvaluatorV1),
    )
    .await
    .map_err(|_| diverged("universe_selection"))?;
    transaction
        .commit()
        .await
        .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?;
    Ok(readback)
}

/// Commits one Available market base snapshot with its observation batch, against the canonical
/// basis the base seals (see [`ensure_market_data_acceptance_basis_v1`] for why not the Owner's
/// own determination).
async fn commit_market_base_snapshot_v1(
    owner: &MarketDataOwnerPostgres,
    mut proposal: UntrustedPitSnapshotProposal,
    observation: UntrustedPitObservationBatchProposal,
    clock: &MarketDataClockAdmission,
) -> Result<PitSnapshotCommitAggregate, MarketDataAcceptanceBasisErrorV1> {
    proposal.evidence.normalized_records_digest =
        derive_observation_batch_digest(&observation).map_err(|_| diverged("pit_snapshot"))?;
    refresh_request_claims(&mut proposal.request);
    let basis = TestOnlyCanonicalBasisResolver::seal_for_test(
        proposal.request.clone(),
        proposal.evidence.clone(),
        clock.clone(),
    );
    owner
        .commit_pit_initial_with_observation_batch(proposal, observation, &basis, clock)
        .await
        .map_err(|_| diverged("pit_snapshot"))
}

/// The base's Reference Fact R0 request over its snapshot.
fn market_base_r0_request_v1(
    pit: &UntrustedPitSnapshotLocator,
    source: &UntrustedSourceBindingLocator,
) -> Result<UntrustedReferenceFactR0RequestV1, MarketDataAcceptanceBasisErrorV1> {
    let mut request = UntrustedReferenceFactR0RequestV1 {
        request_identity: d(BASE_R0_REQUEST),
        request_meaning_digest: d(0),
        pit_locator_bytes: canonical_locator_bytes(pit)?,
        source_binding_locator_bytes: canonical_locator_bytes(source)?,
        replay_start_event_ns: 50,
        replay_end_event_ns_exclusive: 51,
        effective_from_ns: 50,
        effective_until_ns: Some(51),
        provider_available_ns: 90,
        retrieval_ns: 92,
        correction_publication_ns: 91,
        owner_observation_ns: i128::from(BASE_WRITTEN_AT),
        decision_cut: BASE_WRITTEN_AT,
        predecessor_identity: None,
        stable_correlation: d(179),
    };
    request.request_meaning_digest =
        r0_request_meaning_digest(&request).map_err(|_| diverged("reference_fact_r0"))?;
    Ok(request)
}

/// The Market Semantics value the base states for its scope.
fn market_base_semantics_value_v1() -> MarketSemanticsValueV1 {
    MarketSemanticsValueV1 {
        normalization_identity: d(180),
        price_adjustment: MarketSemanticsPriceAdjustmentV1::Raw,
        timestamp_basis: MarketSemanticsTimestampBasisV1::EventEffective,
        price_unit_identity: d(181),
        size_unit_identity: d(182),
    }
}

/// The base's Market Semantics request, over its snapshot, Source Binding, Instrument Master cut
/// and Reference Fact R0 request.
fn market_base_semantics_proposal_v1(
    scope: BindingDigest,
    pit: &UntrustedPitSnapshotLocator,
    source: &UntrustedSourceBindingLocator,
    instrument: MarketDataAcceptanceRequestLocatorV1,
) -> Result<UntrustedMarketSemanticsProposalV1, MarketDataAcceptanceBasisErrorV1> {
    let r0 = market_base_r0_request_v1(pit, source)?;
    let mut instrument_locator_bytes = Vec::with_capacity(64);
    instrument_locator_bytes.extend_from_slice(instrument.request_identity.as_bytes());
    instrument_locator_bytes.extend_from_slice(instrument.request_meaning_digest.as_bytes());
    let mut r0_locator_bytes = Vec::with_capacity(64);
    r0_locator_bytes.extend_from_slice(r0.request_identity.as_bytes());
    r0_locator_bytes.extend_from_slice(r0.request_meaning_digest.as_bytes());
    let mut proposal = UntrustedMarketSemanticsProposalV1 {
        request_identity: d(BASE_MARKET_SEMANTICS_REQUEST),
        request_meaning_digest: d(0),
        consumer: MarketSemanticsConsumerV1::StrategyInputBindingRegistry,
        compatibility_scope_identity: scope,
        predecessor_identity: None,
        value: market_base_semantics_value_v1(),
        effective_from_ns: 50,
        effective_until_ns: Some(51),
        effective_instant_ns: 50,
        owner_observation_ns: i128::from(BASE_WRITTEN_AT),
        decision_cut: BASE_WRITTEN_AT,
        pit_locator_bytes: r0.pit_locator_bytes,
        source_binding_locator_bytes: r0.source_binding_locator_bytes,
        instrument_master_locator_bytes: instrument_locator_bytes.into_boxed_slice(),
        r0_locator_bytes: r0_locator_bytes.into_boxed_slice(),
        stable_correlation: d(179),
    };
    proposal.request_meaning_digest =
        market_semantics_authority::request_meaning_digest_v1(&proposal)
            .map_err(|_| diverged("market_semantics"))?;
    Ok(proposal)
}

fn canonical_locator_bytes(
    locator: &impl serde::Serialize,
) -> Result<Box<[u8]>, MarketDataAcceptanceBasisErrorV1> {
    serde_json::to_vec(locator)
        .map(Vec::into_boxed_slice)
        .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)
}

/// Commits a market base corpus over `source` and the exact Instrument Master cut `instrument`,
/// on `clock`: eligible frontier, universe selection, PIT snapshot with its observation batch,
/// Reference Fact R0, Market Semantics registry entry and fact.
///
/// The chain market base commits one; the Market Data suite's Instrument Master oracle commits one
/// over its own binding and instrument.
pub(super) fn commit_market_base_corpus_v1<'a>(
    owner: &'a MarketDataOwnerPostgres,
    source: &'a SourceBindingCommit,
    instrument: &'a InstrumentMasterReadbackV1,
    clock: &'a MarketDataClockAdmission,
) -> Pin<Box<dyn Future<Output = Result<MarketBaseCorpusV1, MarketDataAcceptanceBasisErrorV1>> + 'a>>
{
    Box::pin(async move {
        // The scope production derives for this binding, never a written one.
        let scope =
            derive_market_semantics_compatibility_identity_v1(&source.fact().proposal().semantics);
        // The instrument is the caller's Instrument Master cut's, never a name written here.
        let member = exact_instrument_identity_v1(instrument)
            .ok_or_else(|| diverged("instrument_master_cut"))?
            .to_owned();
        let source_readback = {
            let mut transaction = owner
                .pool
                .begin()
                .await
                .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?;
            let aggregate =
                super::load_source_for_update(&mut transaction, source.fact().binding_id(), false)
                    .await
                    .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?
                    .ok_or_else(|| diverged("source_binding"))?;
            let readback = SourceBindingOwnerReadback::from_verified(&aggregate);
            transaction
                .commit()
                .await
                .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?;
            readback
        };
        let times = MarketBaseRowTimesV1 {
            provider_available: 90,
            retrieval: 92,
            correction_publication: 91,
        };
        let universe = admit_market_base_universe_v1(
            owner,
            source,
            &member,
            d(BASE_ELIGIBLE_FRONTIER),
            [d(171), d(172), d(173)],
            times,
            BASE_HISTORICAL_AT,
            BASE_WRITTEN_AT,
        )
        .await?;
        let request = UntrustedPitSnapshotRequest {
            claimed_request_identity: d(0),
            claimed_request_digest: d(0),
            correlation_identity: BindingDigest::from_untrusted_bytes(
                CHAIN_MARKET_BASE_PIT_CORRELATION_V1,
            ),
            // The requester R&D writes for the base's Research request, so a Design of that
            // request can name this PIT request as its initial one.
            requester_identity: research_pit_requester_identity_v1(
                BindingDigest::from_untrusted_bytes(CHAIN_MARKET_BASE_RESEARCH_REQUEST_V1),
            ),
            scope_digest: d(BASE_PIT_SCOPE),
            source_binding: source.receipt().locator().clone(),
            instrument_master_digest: instrument.digest(),
            universe_selection_digest: universe.record().identity(),
            market_semantics_identity: scope,
            time_evidence: market_base_pit_time_v1(clock),
        };
        let observation = market_base_observation_batch_v1(
            &MARKET_BASE_OBSERVATIONS,
            &member,
            source,
            instrument.digest(),
            universe.record().identity(),
            scope,
            times,
        );
        let pit = commit_market_base_snapshot_v1(
            owner,
            UntrustedPitSnapshotProposal {
                request,
                evidence: market_base_evidence_v1(source),
            },
            observation,
            clock,
        )
        .await?;
        let mut transaction = owner
            .pool
            .begin()
            .await
            .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?;
        let aggregate =
            super::load_pit_for_update(&mut transaction, pit.fact().snapshot_identity(), false)
                .await
                .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?
                .ok_or_else(|| diverged("pit_snapshot"))?;
        let stored = super::load_pit_observation_batch_for_update(&mut transaction, &aggregate)
            .await
            .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?
            .ok_or_else(|| diverged("pit_observation_batch"))?;
        let batch = verify_observation_batch(
            &aggregate,
            stored.source_binding_identity,
            stored.source_binding_lineage_root,
            stored.source_binding_lineage_version,
            stored.digest,
            &stored.bytes,
            &stored.rows,
        )
        .map_err(|_| diverged("pit_observation_batch"))?;
        let r0_request =
            market_base_r0_request_v1(pit.receipt().locator(), source.receipt().locator())?;
        let r0 = super::reference_fact_coordinates::resolve_reference_fact_r0_in_transaction_v1(
            &mut transaction,
            &r0_request,
        )
        .await
        .map_err(|_| diverged("reference_fact_r0"))?;
        let registry_key = market_semantics_authority::derive_registry_key_v1(
            scope,
            &source_readback,
            &batch,
            instrument,
            &r0,
        )
        .map_err(|_| diverged("market_semantics_registry"))?;
        let registry = market_semantics_authority::seal_registry_entry_v1(
            registry_key,
            market_base_semantics_value_v1(),
            d(187),
        )
        .map_err(|_| diverged("market_semantics_registry"))?;
        super::market_semantics::register_market_semantics_registry_entry_v1(
            &mut transaction,
            &registry,
        )
        .await
        .map_err(|_| diverged("market_semantics_registry"))?;
        let instrument_locator = MarketDataAcceptanceRequestLocatorV1 {
            request_identity: instrument.request_identity,
            request_meaning_digest: instrument.request_meaning_digest,
        };
        let semantics_proposal = market_base_semantics_proposal_v1(
            scope,
            pit.receipt().locator(),
            source.receipt().locator(),
            instrument_locator,
        )?;
        let semantics = super::market_semantics::resolve_market_semantics_in_transaction_v1(
            &mut transaction,
            &semantics_proposal,
        )
        .await
        .map_err(|_| diverged("market_semantics"))?;
        transaction
            .commit()
            .await
            .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?;
        let semantics_request = MarketDataAcceptanceRequestLocatorV1 {
            request_identity: semantics_proposal.request_identity,
            request_meaning_digest: semantics_proposal.request_meaning_digest,
        };
        Ok(MarketBaseCorpusV1 {
            source_readback,
            universe,
            pit,
            batch,
            r0_request,
            r0,
            semantics_proposal,
            semantics,
            semantics_request,
        })
    })
}

/// The evidence a market base snapshot states: its Source Binding's own frontiers, complete
/// coverage, compatible semantics and an available source.
fn market_base_evidence_v1(source: &SourceBindingCommit) -> UntrustedPitSnapshotEvidence {
    UntrustedPitSnapshotEvidence {
        normalized_records_digest: d(0),
        source_frontier: source.receipt().locator().source_frontier.clone(),
        correction_frontier: source.receipt().locator().correction_frontier.clone(),
        coverage_complete: true,
        semantics_compatible: true,
        source_available: true,
    }
}

/// Persists the base's historical native Reference Fact R0 corpus, on the historical clock: an
/// eligible frontier, universe selection and PIT snapshot one cut before the base, and the R0 over
/// that snapshot.
fn persist_historical_native_r0_v1<'a>(
    owner: &'a MarketDataOwnerPostgres,
    source: &'a SourceBindingCommit,
    instrument: &'a InstrumentMasterReadbackV1,
    clock: &'a MarketDataClockAdmission,
) -> Pin<
    Box<
        dyn Future<Output = Result<ReferenceFactR0ReadbackV1, MarketDataAcceptanceBasisErrorV1>>
            + 'a,
    >,
> {
    Box::pin(async move {
        let scope =
            derive_market_semantics_compatibility_identity_v1(&source.fact().proposal().semantics);
        let times = MarketBaseRowTimesV1 {
            provider_available: 89,
            retrieval: 91,
            correction_publication: 90,
        };
        let universe = admit_market_base_universe_v1(
            owner,
            source,
            CHAIN_FIXTURE_INSTRUMENT_V1,
            d(240),
            [d(241), d(242), d(243)],
            times,
            98,
            BASE_HISTORICAL_AT,
        )
        .await?;
        let time_evidence = UntrustedPitSnapshotTimeEvidence {
            event_effective: UntrustedEventEffectiveTime::from_untrusted(
                50,
                &clock.clock_identity,
                &clock.clock_epoch,
            ),
            provider_available: UntrustedProviderAvailableTime::from_untrusted(
                89,
                &clock.clock_identity,
                &clock.clock_epoch,
            ),
            retrieval: UntrustedRetrievalTime::from_untrusted(
                91,
                &clock.clock_identity,
                &clock.clock_epoch,
            ),
            correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
                90,
                &clock.clock_identity,
                &clock.clock_epoch,
            )),
            decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(
                BASE_HISTORICAL_AT,
                &clock.clock_identity,
                &clock.clock_epoch,
            ),
            monotonic_sequence: clock.monotonic_sequence,
            restart_continuity_digest: clock.restart_continuity_digest,
            skew_bound: clock.skew_bound,
            uncertainty_bound: clock.uncertainty_bound,
            observed_at: BASE_HISTORICAL_AT,
            valid_through: clock.valid_through,
        };
        let request = UntrustedPitSnapshotRequest {
            claimed_request_identity: d(0),
            claimed_request_digest: d(0),
            correlation_identity: d(244),
            requester_identity: d(245),
            scope_digest: d(246),
            source_binding: source.receipt().locator().clone(),
            instrument_master_digest: instrument.digest(),
            universe_selection_digest: universe.record().identity(),
            market_semantics_identity: scope,
            time_evidence,
        };
        let observation = market_base_observation_batch_v1(
            &MARKET_BASE_OBSERVATIONS,
            CHAIN_FIXTURE_INSTRUMENT_V1,
            source,
            instrument.digest(),
            universe.record().identity(),
            scope,
            times,
        );
        let pit = commit_market_base_snapshot_v1(
            owner,
            UntrustedPitSnapshotProposal {
                request,
                evidence: market_base_evidence_v1(source),
            },
            observation,
            clock,
        )
        .await?;
        let mut request = UntrustedReferenceFactR0RequestV1 {
            request_identity: d(247),
            request_meaning_digest: d(0),
            pit_locator_bytes: canonical_locator_bytes(pit.receipt().locator())?,
            source_binding_locator_bytes: canonical_locator_bytes(source.receipt().locator())?,
            replay_start_event_ns: 50,
            replay_end_event_ns_exclusive: 51,
            effective_from_ns: 50,
            effective_until_ns: Some(51),
            provider_available_ns: 89,
            retrieval_ns: 91,
            correction_publication_ns: 90,
            owner_observation_ns: i128::from(BASE_HISTORICAL_AT),
            decision_cut: BASE_HISTORICAL_AT,
            predecessor_identity: None,
            stable_correlation: d(248),
        };
        request.request_meaning_digest =
            r0_request_meaning_digest(&request).map_err(|_| diverged("reference_fact_r0"))?;
        let mut transaction = owner
            .pool
            .begin()
            .await
            .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?;
        let issued =
            super::reference_fact_coordinates::resolve_reference_fact_r0_in_transaction_v1(
                &mut transaction,
                &request,
            )
            .await
            .map_err(|_| diverged("reference_fact_r0"))?;
        transaction
            .commit()
            .await
            .map_err(|_| MarketDataAcceptanceBasisErrorV1::StoreUnavailable)?;
        Ok(issued)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn only_the_chain_basis_is_ensured() {
        // Refused before any connection is attempted: no store is named here.
        assert_eq!(
            ensure_market_data_acceptance_basis_v1(
                "postgres://unreachable.invalid/none",
                MarketDataAcceptanceBasisIdentityV1([1; 32]),
            )
            .await,
            Err(MarketDataAcceptanceBasisErrorV1::UnknownBasis)
        );
    }
}
