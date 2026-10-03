//! PIT window custody (slice T0-4a), proved on real PostgreSQL through the sealed commit port.
//!
//! Every Source Binding is committed on the Owner's own clock, so the clock a custody commit mints
//! from the wall is its ordinary successor. Every refusal is checked against a snapshot of every
//! Owner table, clock included: a refusal writes nothing.

use std::{collections::BTreeSet, sync::Arc};

use sqlx::Row;

use super::{
    MarketDataClockAdmission, MarketDataOwnerPostgres, OWNER_CLOCK_EPOCH_V1,
    OWNER_CLOCK_IDENTITY_V1, OWNER_CLOCK_SKEW_BOUND_NS, OWNER_CLOCK_UNCERTAINTY_BOUND_NS,
    OWNER_CLOCK_VALIDITY_WINDOW_NS, OwnerSourceBindingDecision, SourceBindingCommit,
    pit_intake_member_count_tests::{instrument_submission, owner_store_v1, source_proposal},
    pit_window_custody_v1::{
        read_pit_window_instrument_master_chain_v1, read_pit_window_market_semantics_chain_v1,
        read_pit_window_r0_chain_record_v1, read_pit_window_schedules_v1,
    },
    seal_owner_clock_admission_v1,
};
use crate::owner::{
    market_semantics_admission_v1::MarketSemanticsValueSubmissionV1,
    pit_window_custody_v1::{
        CrossSectionVersionKindV1, PitWindowCustodyCommitV1, PitWindowCustodyReceiptV1,
        PitWindowCustodyRefusalV1 as Refused, UntrustedCrossSectionVersionV1,
        UntrustedCustodyRowV1, UntrustedPitWindowCustodyClaimV1,
        UntrustedPitWindowCustodyRequestV1,
    },
    sample_fact::v2::{SampleFactV2, decode_sample_fact_v2},
    source_binding::{
        BindingDigest, UntrustedSourceAvailabilityRuleV1, UntrustedSourceBarAnchorV1,
        UntrustedSourceBarCadenceV1, UntrustedSourceBarClockV1, UntrustedSourceBarCompletionV1,
        UntrustedSourceBarLabelV1, UntrustedSourceBarTimeframeV1, UntrustedSourceBarUnitV1,
        UntrustedSourceVisibilityV1,
        authority::{
            availability_rule_digest_v1, derive_binding_id,
            derive_market_semantics_compatibility_identity_v1, derive_time_evidence_identity,
        },
    },
    universe_selection::{
        UntrustedUniverseSelectionLocatorV1, UntrustedUniverseSelectionRequestV1,
        authority::{
            CanonicalUniverseSelectionRuleEvaluatorV1, HistoricalMembershipFactProposalV1,
        },
    },
};

/// 2026-09-21: the Owner clock's first head, on the real clock.
const FIRST_CUT: u64 = 1_790_000_000_000_000_000;
const SECOND: u64 = 1_000_000_000;
const MINUTE: u64 = 60 * SECOND;
const DAY: u64 = 86_400 * SECOND;
/// The backfilled window starts on a UTC midnight in 2023.
const WINDOW_START: u64 = 19_700 * DAY;
const BTC: &str = "BTCUSDT-PERP.BINANCE";
const ETH: &str = "ETHUSDT-PERP.BINANCE";
/// When the backfill retrieved its rows: after the Owner's first head, before the wall clock.
const RETRIEVED: u64 = FIRST_CUT + 10 * SECOND;

fn d(byte: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([byte; 32])
}

fn owner_clock(sequence: u64, instant: u64) -> MarketDataClockAdmission {
    seal_owner_clock_admission_v1(
        OWNER_CLOCK_IDENTITY_V1,
        OWNER_CLOCK_EPOCH_V1,
        sequence,
        instant,
        OWNER_CLOCK_VALIDITY_WINDOW_NS,
        OWNER_CLOCK_UNCERTAINTY_BOUND_NS,
        OWNER_CLOCK_SKEW_BOUND_NS,
    )
    .expect("the instant seals on the Owner clock")
}

async fn owner() -> MarketDataOwnerPostgres {
    let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL")
        .expect("explicit disposable Owner URL");
    let database =
        std::env::var("VIBE_POSTGRES_TEST_DATABASE_NAME").expect("disposable database name");
    assert!(
        database.starts_with("vibe_test_"),
        "this proof writes custodies and clocks; it runs only against a disposable database"
    );
    MarketDataOwnerPostgres::connect(&owner_url)
        .await
        .expect("Owner connects and migrates")
}

fn continuous(
    label: &str,
    step: u32,
    unit: UntrustedSourceBarUnitV1,
) -> UntrustedSourceBarTimeframeV1 {
    UntrustedSourceBarTimeframeV1 {
        row_timeframe: label.to_owned(),
        cadence: UntrustedSourceBarCadenceV1::FixedInterval { step, unit },
        anchor: UntrustedSourceBarAnchorV1::UnixEpoch,
        clock: UntrustedSourceBarClockV1::Continuous,
        label: UntrustedSourceBarLabelV1::IntervalClose,
        completion: UntrustedSourceBarCompletionV1::CompleteOnly,
    }
}

/// A daily bar, a minute bar, a two-day bar and an exchange session day.
fn declarations() -> Vec<UntrustedSourceBarTimeframeV1> {
    vec![
        continuous("1D", 24, UntrustedSourceBarUnitV1::Hour),
        continuous("1M", 1, UntrustedSourceBarUnitV1::Minute),
        continuous("2D", 48, UntrustedSourceBarUnitV1::Hour),
        UntrustedSourceBarTimeframeV1 {
            row_timeframe: "3D".to_owned(),
            cadence: UntrustedSourceBarCadenceV1::ExchangeSessionDay,
            anchor: UntrustedSourceBarAnchorV1::SessionOpen,
            clock: UntrustedSourceBarClockV1::ScheduleBounded,
            label: UntrustedSourceBarLabelV1::IntervalClose,
            completion: UntrustedSourceBarCompletionV1::CompleteOnly,
        },
    ]
}

/// Visible two minutes after the bar closes.
fn after_close(publishes_corrections: bool) -> UntrustedSourceAvailabilityRuleV1 {
    UntrustedSourceAvailabilityRuleV1 {
        visibility: UntrustedSourceVisibilityV1::AfterBarClose { lag_ns: 2 * MINUTE },
        publishes_corrections,
    }
}

/// Commits one admitted Source Binding over `dataset` on the Owner clock's `sequence`th head, as
/// schema 2 with `rule` and every declaration when a rule is given, and as schema 1 otherwise.
/// Every binding states the same semantics, so all share one Market Semantics identity.
async fn commit_binding(
    owner: &MarketDataOwnerPostgres,
    dataset: &str,
    sequence: u64,
    rule: Option<UntrustedSourceAvailabilityRuleV1>,
) -> SourceBindingCommit {
    let cut = FIRST_CUT + (sequence - 1) * SECOND;
    let clock = owner_clock(sequence, cut);
    let mut proposal = source_proposal();
    proposal.adapter.dataset_mapping = dataset.to_owned();
    let time = &mut proposal.time_evidence;
    time.clock_identity.clone_from(&clock.clock_identity);
    time.clock_epoch.clone_from(&clock.clock_epoch);
    time.restart_continuity_digest = clock.restart_continuity_digest;
    time.skew_bound = clock.skew_bound;
    time.uncertainty_bound = clock.uncertainty_bound;
    time.monotonic_sequence = sequence;
    time.event_effective = cut - 30;
    time.provider_available = cut - 20;
    time.correction_publication = cut - 15;
    time.retrieval = cut - 10;
    time.observed_at = cut;
    time.effective_at = cut;
    time.valid_through = clock.valid_through;

    if let Some(rule) = rule {
        proposal.schema_version = 2;
        proposal.availability_rule = Some(rule);
        proposal.bar_timeframes = declarations();
    }
    proposal.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&proposal.time_evidence);
    proposal.claimed_binding_id = derive_binding_id(&proposal);
    owner
        .commit_source_initial(
            proposal,
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &clock,
        )
        .await
        .expect("the Owner admits the binding and its clock")
}

/// Admits both members' Instrument Master facts, in force from instant 1 with no end. `BTC`'s
/// tick is 0.10, as `BTCUSDT`'s is today.
async fn admit_members(owner: &MarketDataOwnerPostgres, binding: &SourceBindingCommit) {
    for member in [BTC, ETH] {
        let mut submission = instrument_submission(member, binding, d(81));

        if member == BTC {
            submission.price_increment.mantissa = 1;
            submission.price_increment.scale = 1;
        }
        owner
            .admit_instrument_master_fact_v1(submission)
            .await
            .unwrap();
    }
}

/// The Owner's clock: every handoff, and the head's decision cut.
async fn clock(owner: &MarketDataOwnerPostgres) -> (i64, u64) {
    let handoffs: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM market_data_private.clock_handoffs_v1")
            .fetch_one(owner.pool())
            .await
            .unwrap();
    let cut: i64 = sqlx::query_scalar(
        "SELECT decision_cut FROM market_data_private.clock_head_v1 WHERE singleton",
    )
    .fetch_one(owner.pool())
    .await
    .unwrap();
    (handoffs, u64::try_from(cut).unwrap())
}

/// A Universe Selection including both members, evaluated by the Owner at its head. ETH's
/// membership begins at `eth_from` when one is given; a membership still in force at the head
/// is the only kind a selection evaluated there includes.
async fn universe(
    owner: &MarketDataOwnerPostgres,
    binding: &SourceBindingCommit,
    frontier: u8,
    eth_from: Option<u64>,
) -> UntrustedUniverseSelectionLocatorV1 {
    let (_, decision_cut) = clock(owner).await;
    let at = i128::from(decision_cut);
    let lineage_root = binding.fact().lineage_root();
    let correction = binding.receipt().locator().correction_frontier.digest;
    let request = UntrustedUniverseSelectionRequestV1::new(
        d(frontier.wrapping_add(1)),
        "RESEARCH_OWNER_V1",
        d(202),
        vec![0, 1, 1],
        d(frontier),
        at,
        at,
        decision_cut,
        lineage_root,
        correction,
        d(203),
    );
    let membership = [(BTC, None), (ETH, eth_from.map(i128::from))]
        .into_iter()
        .map(|(member, from)| HistoricalMembershipFactProposalV1 {
            member_key: member.as_bytes().to_vec(),
            instrument: member.as_bytes().to_vec(),
            predecessor_identity: None,
            // A membership fact's identity does not bind its frontier, so each frontier's member
            // is its own fact.
            effective_from_ns: from.unwrap_or(i128::from(frontier)),
            effective_until_ns: None,
            provider_available_ns: at - 20,
            retrieval_ns: at - 10,
            correction_publication_ns: at - 15,
            owner_observation_ns: at,
            decision_cut,
            source_binding_lineage_root: lineage_root,
            correction_frontier_digest: correction,
        })
        .collect();
    let mut transaction = owner.pool().begin().await.unwrap();
    super::universe_selection::persist_historical_membership_frontier_v1(
        &mut transaction,
        d(frontier),
        membership,
    )
    .await
    .unwrap();
    super::universe_selection::resolve_universe_selection_in_transaction_v1(
        &mut transaction,
        &request,
        Some(&CanonicalUniverseSelectionRuleEvaluatorV1),
    )
    .await
    .unwrap();
    transaction.commit().await.unwrap();
    UntrustedUniverseSelectionLocatorV1::from_untrusted(
        request.request_identity(),
        request.request_meaning_digest(),
    )
}

/// [`rows`] for `members`.
fn rows_of(members: &[&str], base: i128, retrieval_ns: u64) -> Vec<UntrustedCustodyRowV1> {
    rows(base, retrieval_ns)
        .into_iter()
        .filter(|row| row.instrument == BTC)
        .flat_map(|row| {
            members.iter().map(move |member| UntrustedCustodyRowV1 {
                instrument: (*member).to_owned(),
                ..row.clone()
            })
        })
        .collect()
}

/// One row per member and BAR field, values from `base`, all retrieved at `retrieval_ns`: prices at
/// two places, volumes as integers. Custody states each at the fixed value scale.
fn rows(base: i128, retrieval_ns: u64) -> Vec<UntrustedCustodyRowV1> {
    [BTC, ETH]
        .into_iter()
        .flat_map(|member| {
            ["OPEN", "HIGH", "LOW", "CLOSE", "VOLUME"]
                .into_iter()
                .zip(0..)
                .map(move |(field, offset)| UntrustedCustodyRowV1 {
                    instrument: member.to_owned(),
                    field: field.to_owned(),
                    value_mantissa: base + offset,
                    value_scale: if field == "VOLUME" { 0 } else { 2 },
                    retrieval_ns,
                    retrieval_route: "data.binance.vision/daily-klines".to_owned(),
                })
        })
        .collect()
}

fn original(timeframe: &str, event: u64) -> UntrustedCrossSectionVersionV1 {
    UntrustedCrossSectionVersionV1 {
        timeframe: timeframe.to_owned(),
        event_effective_ns: event,
        kind: CrossSectionVersionKindV1::Original,
        correction_sequence: 1,
        predecessor_version: None,
        publication_ns: None,
        rows: rows(6_500_000, RETRIEVED),
    }
}

fn correction(
    event: u64,
    predecessor: BindingDigest,
    correction_sequence: u64,
    publication_ns: u64,
) -> UntrustedCrossSectionVersionV1 {
    UntrustedCrossSectionVersionV1 {
        timeframe: "1D".to_owned(),
        event_effective_ns: event,
        kind: CrossSectionVersionKindV1::Correction,
        correction_sequence,
        predecessor_version: Some(predecessor),
        publication_ns: Some(publication_ns),
        rows: rows(6_600_000, RETRIEVED),
    }
}

fn withdrawal(
    event: u64,
    predecessor: BindingDigest,
    correction_sequence: u64,
    publication_ns: Option<u64>,
) -> UntrustedCrossSectionVersionV1 {
    UntrustedCrossSectionVersionV1 {
        timeframe: "1D".to_owned(),
        event_effective_ns: event,
        kind: CrossSectionVersionKindV1::Withdrawal,
        correction_sequence,
        predecessor_version: Some(predecessor),
        publication_ns,
        rows: Vec::new(),
    }
}

/// The typed Market Semantics value every fixture custody claims.
fn market_semantics_value() -> MarketSemanticsValueSubmissionV1 {
    MarketSemanticsValueSubmissionV1 {
        normalization_identity: d(31),
        price_adjustment: "RAW".to_owned(),
        timestamp_basis: "INTERVAL_CLOSE".to_owned(),
        price_unit_identity: d(32),
        size_unit_identity: d(33),
    }
}

/// Two members over three days: daily bars for inputs and execution, minute bars for fills.
fn request(
    binding: &SourceBindingCommit,
    universe: UntrustedUniverseSelectionLocatorV1,
) -> UntrustedPitWindowCustodyRequestV1 {
    UntrustedPitWindowCustodyRequestV1 {
        source_binding: binding.receipt().locator().clone(),
        market_semantics_identity: derive_market_semantics_compatibility_identity_v1(
            &binding.fact().proposal().semantics,
        ),
        market_semantics_value: market_semantics_value(),
        universe_selection: universe,
        members: vec![BTC.to_owned(), ETH.to_owned()],
        window_start_ns: WINDOW_START,
        window_end_ns_exclusive: WINDOW_START + 3 * DAY,
        execution_timeframe: "1D".to_owned(),
        input_timeframes: vec!["1D".to_owned()],
        fill_timeframe: Some("1M".to_owned()),
        predecessor: None,
        cross_sections: vec![
            original("1D", WINDOW_START + DAY),
            original("1D", WINDOW_START + 2 * DAY),
            original("1M", WINDOW_START + DAY + MINUTE),
        ],
    }
}

fn successor(
    root: &PitWindowCustodyReceiptV1,
    template: &UntrustedPitWindowCustodyRequestV1,
    versions: Vec<UntrustedCrossSectionVersionV1>,
) -> UntrustedPitWindowCustodyRequestV1 {
    let mut request = template.clone();
    request.predecessor = Some(UntrustedPitWindowCustodyClaimV1 {
        chain_root: root.chain_root(),
    });
    request.cross_sections = versions;
    request
}

async fn commit(
    intake: &Arc<dyn PitWindowCustodyCommitV1>,
    request: UntrustedPitWindowCustodyRequestV1,
) -> Result<PitWindowCustodyReceiptV1, Refused> {
    Box::pin(intake.commit_pit_window_custody_v1(request)).await
}

/// Commits `request` and requires the refusal it names, with every Owner table unchanged.
async fn refused(
    owner: &MarketDataOwnerPostgres,
    intake: &Arc<dyn PitWindowCustodyCommitV1>,
    request: UntrustedPitWindowCustodyRequestV1,
    expected: Refused,
) {
    let before = owner_store_v1(owner.pool()).await;
    assert_eq!(commit(intake, request).await, Err(expected));
    assert_eq!(
        owner_store_v1(owner.pool()).await,
        before,
        "{expected:?} wrote nothing, the clock included"
    );
}

async fn count(owner: &MarketDataOwnerPostgres, table: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT COUNT(*) FROM market_data_private.{table}"
    )))
    .fetch_one(owner.pool())
    .await
    .unwrap()
}

/// The identity of the version `custody` holds at `event`.
async fn version_at(
    owner: &MarketDataOwnerPostgres,
    custody: BindingDigest,
    event: u64,
) -> BindingDigest {
    let bytes: Vec<u8> = sqlx::query_scalar(
        "SELECT version_identity FROM market_data_private.pit_window_cross_section_versions_v1 WHERE custody_identity=$1 AND event_ns=$2",
    )
    .bind(custody.as_bytes().as_slice())
    .bind(i64::try_from(event).unwrap())
    .fetch_one(owner.pool())
    .await
    .unwrap();
    BindingDigest::from_untrusted_bytes(bytes.try_into().unwrap())
}

/// The BTC CLOSE row fact of `version`, decoded and verified from its stored bytes.
async fn close_fact(owner: &MarketDataOwnerPostgres, version: BindingDigest) -> SampleFactV2 {
    let row = sqlx::query(
        "SELECT fact_bytes,fact_digest FROM market_data_private.pit_window_custody_rows_v1 WHERE version_identity=$1 AND member_ordinal=0 AND field='CLOSE'",
    )
    .bind(version.as_bytes().as_slice())
    .fetch_one(owner.pool())
    .await
    .unwrap();
    let bytes: Vec<u8> = row.get("fact_bytes");
    let digest: Vec<u8> = row.get("fact_digest");
    decode_sample_fact_v2(&bytes, digest.try_into().unwrap()).expect("the stored fact verifies")
}

/// Every `bar_schedule_*` table of the snapshot path's per-instrument schedule chain.
async fn bar_schedule_tables(owner: &MarketDataOwnerPostgres) -> Vec<(String, i64, String)> {
    tables_named(owner, "bar_schedule_", 6).await
}

/// Every Owner table whose name starts with `prefix`, at least `installed` of them, so a snapshot
/// of them can show a write.
async fn tables_named(
    owner: &MarketDataOwnerPostgres,
    prefix: &str,
    installed: usize,
) -> Vec<(String, i64, String)> {
    let tables = owner_store_v1(owner.pool())
        .await
        .into_iter()
        .filter(|(table, _, _)| table.starts_with(prefix))
        .collect::<Vec<_>>();
    assert!(
        tables.len() >= installed,
        "the {prefix}* tables are installed, so their snapshot can show a write"
    );
    tables
}

/// The Market Semantics fact and registry entry of the chain rooted at `chain_root`.
async fn market_semantics_of(
    owner: &MarketDataOwnerPostgres,
    chain_root: BindingDigest,
) -> Result<
    Option<(
        crate::owner::pit_window_custody_v1::chain_records::MarketSemanticsChainFactV1,
        crate::owner::pit_window_custody_v1::chain_records::MarketSemanticsChainRegistryEntryV1,
    )>,
    Refused,
> {
    let mut transaction = owner.pool().begin().await.unwrap();
    let fact = read_pit_window_market_semantics_chain_v1(&mut transaction, chain_root).await;
    transaction.rollback().await.unwrap();
    fact
}

/// The Instrument Master link and readback of the chain rooted at `chain_root`.
async fn instrument_master_of(
    owner: &MarketDataOwnerPostgres,
    chain_root: BindingDigest,
) -> Result<
    Option<(
        crate::owner::pit_window_custody_v1::chain_records::InstrumentMasterChainLinkV1,
        crate::owner::instrument_master::InstrumentMasterReadbackV1,
    )>,
    Refused,
> {
    let mut transaction = owner.pool().begin().await.unwrap();
    let link = read_pit_window_instrument_master_chain_v1(&mut transaction, chain_root).await;
    transaction.rollback().await.unwrap();
    link
}

/// The R0 record and cut of the chain rooted at `chain_root`, through the crate's readback.
async fn chain_r0_of(
    owner: &MarketDataOwnerPostgres,
    chain_root: BindingDigest,
) -> Result<
    Option<(
        crate::owner::pit_window_custody_v1::chain_records::ReferenceFactR0ChainRecordV1,
        crate::owner::pit_window_custody_v1::chain_records::ReferenceFactR0ChainCutV1,
    )>,
    Refused,
> {
    let mut transaction = owner.pool().begin().await.unwrap();
    let record = read_pit_window_r0_chain_record_v1(&mut transaction, chain_root).await;
    transaction.rollback().await.unwrap();
    record
}

/// The window schedules of the chain rooted at `chain_root`, through the crate's readback.
async fn schedules_of(
    owner: &MarketDataOwnerPostgres,
    chain_root: BindingDigest,
) -> Vec<crate::owner::pit_window_custody_v1::schedule::PitWindowScheduleFactV1> {
    let mut transaction = owner.pool().begin().await.unwrap();
    let schedules = read_pit_window_schedules_v1(&mut transaction, chain_root)
        .await
        .expect("the stored schedules verify");
    transaction.rollback().await.unwrap();
    schedules
}

fn wall_now_ns() -> u64 {
    u64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
    )
    .unwrap()
}

/// A custody commits once, minting the one Owner clock its rows need, and stores its versions and
/// row facts chained on one another. The same request, and the same versions with other retrieval
/// evidence, rejoin it: the original receipt and minting cut, nothing written, no clock minted. A
/// stored identity whose bytes differ is another meaning and is refused.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_custody_commits_once_and_a_resubmission_rejoins_without_writing() {
    let owner = owner().await;
    let binding = commit_binding(&owner, "binance/um/klines", 1, Some(after_close(false))).await;
    admit_members(&owner, &binding).await;
    let universe = universe(&owner, &binding, 10, None).await;
    let intake = owner.pit_window_custody_commit_v1();
    let mut first = request(&binding, universe);
    // The second bar's BTC CLOSE is written at one decimal place: 65000.1, which the custody states
    // at the price increment's two, so it stays in the series of the first bar's CLOSE.
    let second_close = first.cross_sections[1]
        .rows
        .iter_mut()
        .find(|row| row.instrument == BTC && row.field == "CLOSE")
        .unwrap();
    second_close.value_mantissa = 650_001;
    second_close.value_scale = 1;
    // The first bar's BTC HIGH is a 2021 BTCUSDT close at its own precision, 37244.36: finer than
    // the instrument's tick today, and still a value.
    let historical = first.cross_sections[0]
        .rows
        .iter_mut()
        .find(|row| row.instrument == BTC && row.field == "HIGH")
        .unwrap();
    historical.value_mantissa = 3_724_436;
    historical.value_scale = 2;

    let (handoffs, head) = clock(&owner).await;
    let before_wall = wall_now_ns();
    let instrument_schedules = bar_schedule_tables(&owner).await;
    let snapshot_r0 = tables_named(&owner, "reference_fact_r0_", 5).await;
    let cuts_before = count(&owner, "instrument_master_cuts_v1").await;
    let snapshot_heads = tables_named(&owner, "market_semantics_heads_v2", 1).await;
    let receipt = commit(&intake, first.clone())
        .await
        .expect("the custody commits");
    assert_eq!(
        bar_schedule_tables(&owner).await,
        instrument_schedules,
        "a custody never writes, or advances, an instrument's BAR schedule chain"
    );
    assert_eq!(
        tables_named(&owner, "reference_fact_r0_", 5).await,
        snapshot_r0,
        "a custody writes no snapshot R0, and no frame R0 is stored"
    );

    // One R0 record for the chain, from the window's start to the end its last frame claims: the
    // last daily close is the window's third day, and a daily input claims one day after it.
    let (r0_record, r0_cut) = chain_r0_of(&owner, receipt.chain_root())
        .await
        .expect("the chain R0 verifies")
        .expect("a root records its chain's R0");
    assert_eq!(count(&owner, "pit_window_r0_chain_records_v1").await, 1);
    assert_eq!(
        (r0_record.window_start_ns, r0_record.window_end_ns_exclusive),
        (WINDOW_START, WINDOW_START + 3 * DAY)
    );
    assert_eq!(r0_record.root_custody_identity, receipt.custody_identity());
    assert_eq!(r0_record.clock.decision_cut, receipt.minting_cut_ns());
    assert_eq!(r0_cut.record_identity, r0_record.identity());

    // One Instrument Master cut, issued in the commit on the clock it admitted, for exactly the
    // facts the custody selected; the chain links its key to it.
    let (link, instrument_master) = instrument_master_of(&owner, receipt.chain_root())
        .await
        .expect("the chain's Instrument Master verifies")
        .expect("a root issues its chain's Instrument Master cut");
    assert_eq!(
        count(&owner, "instrument_master_cuts_v1").await,
        cuts_before + 1
    );
    assert_eq!(
        count(&owner, "pit_window_instrument_master_chains_v1").await,
        1
    );
    assert_eq!(link.fact_digests.len(), 2);
    assert_eq!(
        instrument_master
            .facts()
            .iter()
            .map(|fact| fact.canonical_identity().to_owned())
            .collect::<Vec<_>>(),
        [BTC, ETH]
    );
    assert_eq!(instrument_master.cut().identity(), link.cut_identity);

    // One Market Semantics fact for the chain, under its own head and registry entry, stating the
    // claimed value; the snapshot path's heads are untouched, byte for byte.
    let (semantics, registry) = market_semantics_of(&owner, receipt.chain_root())
        .await
        .expect("the chain's Market Semantics verifies")
        .expect("a root records its chain's Market Semantics fact");
    assert_eq!(
        crate::owner::market_semantics_admission_v1::MarketSemanticsValueSubmissionV1::from_value(
            &semantics.value
        ),
        market_semantics_value()
    );
    assert_eq!(semantics.r0_record_identity, r0_record.identity());
    assert_eq!(semantics.instrument_master_cut_identity, link.cut_identity);
    assert_eq!(semantics.registry_record_identity, registry.identity());
    assert_eq!(
        (semantics.effective_from_ns, semantics.effective_until_ns),
        (r0_record.window_start_ns, r0_record.window_end_ns_exclusive)
    );

    for table in [
        "market_semantics_chain_registry_v1",
        "market_semantics_chain_facts_v1",
        "market_semantics_chain_heads_v1",
    ] {
        assert_eq!(count(&owner, table).await, 1, "{table}");
    }
    assert_eq!(
        tables_named(&owner, "market_semantics_heads_v2", 1).await,
        snapshot_heads,
        "a custody never writes a snapshot's Market Semantics head"
    );
    assert_eq!(
        link.instrument_master_key,
        schedules_of(&owner, receipt.chain_root()).await[0].instrument_master_key,
        "the key every row and schedule carries maps to the cut"
    );

    // One window schedule per member, over the custody's window, at its minting cut.
    let schedules = schedules_of(&owner, receipt.chain_root()).await;
    assert_eq!(count(&owner, "pit_window_schedule_facts_v1").await, 2);
    assert_eq!(
        schedules
            .iter()
            .map(|schedule| (schedule.member_ordinal, schedule.instrument.as_str()))
            .collect::<Vec<_>>(),
        [(0, BTC), (1, ETH)]
    );

    for schedule in &schedules {
        assert_eq!(schedule.custody_identity, receipt.custody_identity());
        assert_eq!((schedule.interval_ns, schedule.phase_ns), (DAY, 0));
        assert_eq!(
            (schedule.window_start_ns, schedule.window_end_ns_exclusive),
            (WINDOW_START, WINDOW_START + 3 * DAY)
        );
        assert_eq!(schedule.cut_ns, receipt.minting_cut_ns());
    }
    let (minted_handoffs, minted) = clock(&owner).await;
    assert_eq!(
        minted_handoffs,
        handoffs + 1,
        "exactly one clock was minted"
    );
    assert!(minted > head && minted >= before_wall && minted > RETRIEVED);
    assert_eq!(receipt.minting_cut_ns(), minted);
    assert_eq!(receipt.chain_version(), 1);
    assert_eq!(receipt.chain_root(), receipt.custody_identity());
    assert_eq!(
        receipt.availability_rule_digest(),
        availability_rule_digest_v1(&after_close(false))
    );
    assert_eq!(count(&owner, "pit_window_custodies_v1").await, 1);
    assert_eq!(count(&owner, "pit_window_custody_heads_v1").await, 1);
    assert_eq!(
        count(&owner, "pit_window_cross_section_versions_v1").await,
        3
    );
    assert_eq!(count(&owner, "pit_window_custody_rows_v1").await, 30);

    // Availability is derived from the rule: two minutes after the daily bar closes. A source that
    // publishes no corrections publishes at availability.
    let first_bar = version_at(&owner, receipt.custody_identity(), WINDOW_START + DAY).await;
    let instants = sqlx::query(
        "SELECT availability_ns,publication_ns,kind FROM market_data_private.pit_window_cross_section_versions_v1 WHERE version_identity=$1",
    )
    .bind(first_bar.as_bytes().as_slice())
    .fetch_one(owner.pool())
    .await
    .unwrap();
    let available = WINDOW_START + DAY + 2 * MINUTE;
    assert_eq!(
        instants.get::<i64, _>("availability_ns"),
        i64::try_from(available).unwrap()
    );
    assert_eq!(
        instants.get::<i64, _>("publication_ns"),
        i64::try_from(available).unwrap()
    );
    assert_eq!(instants.get::<i16, _>("kind"), 1);

    // The second bar's row fact extends the first's series.
    let first_close = close_fact(&owner, first_bar).await;
    let second_close = close_fact(
        &owner,
        version_at(&owner, receipt.custody_identity(), WINDOW_START + 2 * DAY).await,
    )
    .await;
    assert_eq!(first_close.series_sequence(), 1);
    assert_eq!(second_close.series_sequence(), 2);
    assert_eq!(
        second_close.series_predecessor(),
        first_close.sample_identity(),
        "a value written at another scale extends its series"
    );
    assert_eq!(
        second_close.series_identity(),
        first_close.series_identity()
    );
    assert_eq!(first_close.correction_predecessor(), None);

    // The same request rejoins.
    let stored = owner_store_v1(owner.pool()).await;
    assert_eq!(commit(&intake, first.clone()).await, Ok(receipt.clone()));
    assert_eq!(
        owner_store_v1(owner.pool()).await,
        stored,
        "a rejoin writes nothing"
    );

    // So do the same versions retrieved again, later and elsewhere.
    let mut retried = first.clone();

    for version in &mut retried.cross_sections {
        for row in &mut version.rows {
            row.retrieval_ns += 5 * SECOND;
            row.retrieval_route = "fapi.binance.com/fapi/v1/klines".to_owned();
        }
    }
    assert_eq!(commit(&intake, retried).await, Ok(receipt.clone()));
    assert_eq!(owner_store_v1(owner.pool()).await, stored);
    assert_eq!(
        clock(&owner).await,
        (minted_handoffs, minted),
        "no rejoin mints"
    );

    // A stored identity whose bytes are not the request's is another meaning.
    sqlx::query("UPDATE market_data_private.pit_window_custodies_v1 SET canonical_bytes=canonical_bytes||'\\x00'::bytea WHERE custody_identity=$1")
        .bind(receipt.custody_identity().as_bytes().as_slice())
        .execute(owner.pool())
        .await
        .unwrap();
    refused(&owner, &intake, first, Refused::IdentityConflict).await;

    // A stored chain Market Semantics fact whose bytes no longer state its identity does not read
    // back.
    sqlx::query("UPDATE market_data_private.market_semantics_chain_facts_v1 SET fact_bytes=fact_bytes||'\\x00'::bytea WHERE chain_root=$1")
        .bind(receipt.chain_root().as_bytes().as_slice())
        .execute(owner.pool())
        .await
        .unwrap();
    assert_eq!(
        market_semantics_of(&owner, receipt.chain_root()).await,
        Err(Refused::StoreUnavailable)
    );

    // A stored chain R0 whose bytes no longer state its identity does not read back.
    sqlx::query("UPDATE market_data_private.pit_window_r0_chain_records_v1 SET record_bytes=record_bytes||'\\x00'::bytea WHERE chain_root=$1")
        .bind(receipt.chain_root().as_bytes().as_slice())
        .execute(owner.pool())
        .await
        .unwrap();
    assert_eq!(
        chain_r0_of(&owner, receipt.chain_root()).await,
        Err(Refused::StoreUnavailable)
    );
}

/// Every refusal the commit reaches is decided before any write: each leaves every Owner table,
/// the clock included, exactly as it was.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
#[expect(
    clippy::too_many_lines,
    reason = "one store: each refusal is checked against the same unchanged snapshot"
)]
async fn postgres_every_custody_refusal_writes_nothing() {
    let owner = owner().await;
    let binding = commit_binding(&owner, "binance/um/klines", 1, Some(after_close(false))).await;
    let schema_one = commit_binding(&owner, "binance/um/legacy", 2, None).await;
    admit_members(&owner, &binding).await;
    let universe_locator = universe(&owner, &binding, 10, None).await;
    let joining = universe(&owner, &binding, 11, Some(WINDOW_START + DAY)).await;
    let intake = owner.pit_window_custody_commit_v1();
    let valid = request(&binding, universe_locator);
    let edited = |edit: &dyn Fn(&mut UntrustedPitWindowCustodyRequestV1)| {
        let mut request = valid.clone();
        edit(&mut request);
        request
    };

    refused(
        &owner,
        &intake,
        edited(&|r| r.members.push("XRPUSDT-PERP.BINANCE".to_owned())),
        Refused::InvalidRequest,
    )
    .await;
    refused(
        &owner,
        &intake,
        edited(&|r| r.source_binding.fact_digest = d(98)),
        Refused::SourceBindingUnavailable,
    )
    .await;
    refused(
        &owner,
        &intake,
        edited(&|r| r.source_binding = schema_one.receipt().locator().clone()),
        Refused::SourceBindingDeclaresNoAvailabilityRule,
    )
    .await;
    refused(
        &owner,
        &intake,
        edited(&|r| r.market_semantics_identity = d(99)),
        Refused::MarketSemanticsMismatch,
    )
    .await;
    refused(
        &owner,
        &intake,
        edited(&|r| r.universe_selection = joining),
        Refused::WindowMemberNotValidThroughout,
    )
    .await;
    refused(
        &owner,
        &intake,
        edited(&|r| {
            r.execution_timeframe = "3D".to_owned();
            r.input_timeframes = vec!["3D".to_owned()];
            r.fill_timeframe = None;
            r.cross_sections = vec![original("3D", WINDOW_START + DAY)];
        }),
        Refused::ExecutionTimeframeNotFixedInterval,
    )
    .await;
    refused(
        &owner,
        &intake,
        edited(&|r| {
            r.execution_timeframe = "1M".to_owned();
            r.input_timeframes = vec!["1M".to_owned()];
            r.fill_timeframe = None;
            r.cross_sections = vec![original("1M", WINDOW_START + MINUTE)];
        }),
        Refused::AvailabilityLagNotBelowBarInterval,
    )
    .await;
    refused(
        &owner,
        &intake,
        edited(&|r| {
            r.fill_timeframe = Some("2D".to_owned());
            r.cross_sections.pop();
        }),
        Refused::FillTimeframeNotFinerThanExecution,
    )
    .await;
    refused(
        &owner,
        &intake,
        edited(&|r| {
            r.fill_timeframe = Some("1D".to_owned());
            r.cross_sections.pop();
        }),
        Refused::FillTimeframeIsAnInputTimeframe,
    )
    .await;
    let future = wall_now_ns() + DAY;
    refused(
        &owner,
        &intake,
        edited(&|r| r.cross_sections[0].rows[3].retrieval_ns = future),
        Refused::RetrievalAfterMintingCut,
    )
    .await;
    refused(
        &owner,
        &intake,
        edited(&|r| {
            r.cross_sections.insert(
                1,
                correction(WINDOW_START + DAY, d(9), 2, WINDOW_START + DAY + MINUTE),
            );
        }),
        Refused::CrossSectionCorrectionNotPublishedBySource,
    )
    .await;
    refused(
        &owner,
        &intake,
        edited(&|r| {
            r.cross_sections
                .insert(1, withdrawal(WINDOW_START + DAY, d(9), 2, None));
        }),
        Refused::CrossSectionCorrectionNotPublishedBySource,
    )
    .await;
    refused(
        &owner,
        &intake,
        edited(&|r| {
            let again = r.cross_sections[0].clone();
            r.cross_sections.insert(1, again);
        }),
        Refused::CrossSectionBranch,
    )
    .await;
    assert_eq!(count(&owner, "pit_window_custodies_v1").await, 0);
    assert_eq!(
        count(&owner, "pit_window_schedule_facts_v1").await,
        0,
        "no refusal mints a schedule"
    );
    assert_eq!(
        count(&owner, "pit_window_r0_chain_records_v1").await,
        0,
        "no refusal records a chain R0"
    );
    assert_eq!(
        count(&owner, "pit_window_instrument_master_chains_v1").await,
        0,
        "no refusal issues a chain's Instrument Master cut"
    );
    assert_eq!(
        count(&owner, "market_semantics_chain_facts_v1").await,
        0,
        "no refusal records a chain's Market Semantics fact"
    );

    // The request every refusal edited commits.
    assert!(commit(&intake, valid).await.is_ok());
}

/// A source that publishes corrections corrects a committed custody with a successor that names
/// the chain by its root and restates its basis: the successor appends its version, its row facts
/// chain onto the corrected ones, and the head moves. Its resubmission rejoins; a branch of a
/// corrected cross-section and a changed basis are refused unwritten; a withdrawal appends.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_successor_corrects_its_chain_and_refuses_a_branch_or_a_changed_basis() {
    let owner = owner().await;
    let binding = commit_binding(&owner, "synthetic/corrections", 1, Some(after_close(true))).await;
    admit_members(&owner, &binding).await;
    let universe = universe(&owner, &binding, 10, None).await;
    let intake = owner.pit_window_custody_commit_v1();
    let template = request(&binding, universe);
    let root = commit(&intake, template.clone())
        .await
        .expect("the root commits");
    let (handoffs, head) = clock(&owner).await;
    let bar = WINDOW_START + DAY;
    let original_version = version_at(&owner, root.custody_identity(), bar).await;

    // The correction appends.
    let corrected = successor(
        &root,
        &template,
        vec![correction(bar, original_version, 2, bar + 3 * MINUTE)],
    );
    let root_schedules = schedules_of(&owner, root.chain_root()).await;
    let instrument_schedules = bar_schedule_tables(&owner).await;
    let receipt = commit(&intake, corrected.clone())
        .await
        .expect("the successor commits");
    assert_eq!(
        count(&owner, "pit_window_schedule_facts_v1").await,
        2,
        "a successor mints no schedule"
    );
    assert_eq!(
        schedules_of(&owner, receipt.chain_root()).await,
        root_schedules,
        "the successor's chain reads back its root's schedules"
    );
    assert_eq!(bar_schedule_tables(&owner).await, instrument_schedules);
    assert_eq!(
        count(&owner, "pit_window_r0_chain_records_v1").await,
        1,
        "a successor records no R0"
    );
    assert_eq!(
        count(&owner, "pit_window_instrument_master_chains_v1").await,
        1,
        "a successor issues no Instrument Master cut"
    );
    assert_eq!(
        instrument_master_of(&owner, receipt.chain_root())
            .await
            .unwrap()
            .map(|(link, _)| link),
        instrument_master_of(&owner, root.chain_root())
            .await
            .unwrap()
            .map(|(link, _)| link),
    );
    assert_eq!(
        chain_r0_of(&owner, receipt.chain_root()).await,
        chain_r0_of(&owner, root.chain_root()).await,
        "the successor's chain reads back its root's R0"
    );
    assert_eq!(
        count(&owner, "market_semantics_chain_facts_v1").await,
        1,
        "a successor records no Market Semantics fact"
    );
    assert_eq!(
        market_semantics_of(&owner, receipt.chain_root()).await,
        market_semantics_of(&owner, root.chain_root()).await,
    );
    assert_eq!(receipt.chain_root(), root.chain_root());
    assert_eq!(receipt.chain_version(), 2);
    assert_ne!(receipt.custody_identity(), root.custody_identity());
    assert_eq!(
        clock(&owner).await,
        (handoffs, head),
        "rows retrieved before the head mint no clock"
    );
    assert_eq!(receipt.minting_cut_ns(), head);
    let moved: Vec<u8> = sqlx::query_scalar(
        "SELECT head_identity FROM market_data_private.pit_window_custody_heads_v1 WHERE chain_root=$1",
    )
    .bind(root.chain_root().as_bytes().as_slice())
    .fetch_one(owner.pool())
    .await
    .unwrap();
    assert_eq!(moved, receipt.custody_identity().as_bytes().to_vec());
    let correction_version = version_at(&owner, receipt.custody_identity(), bar).await;
    let original_close = close_fact(&owner, original_version).await;
    let corrected_close = close_fact(&owner, correction_version).await;
    assert_eq!(
        corrected_close.slot_identity(),
        original_close.slot_identity()
    );
    assert_eq!(corrected_close.correction_sequence(), 2);
    assert_eq!(
        corrected_close.correction_predecessor(),
        Some(original_close.sample_identity())
    );
    assert_eq!(
        corrected_close.series_sequence(),
        original_close.series_sequence()
    );

    // Its resubmission rejoins.
    let stored = owner_store_v1(owner.pool()).await;
    assert_eq!(commit(&intake, corrected).await, Ok(receipt.clone()));
    assert_eq!(owner_store_v1(owner.pool()).await, stored);

    // A second correction of the corrected original branches the cross-section.
    refused(
        &owner,
        &intake,
        successor(
            &root,
            &template,
            vec![correction(bar, original_version, 2, bar + 4 * MINUTE)],
        ),
        Refused::CrossSectionBranch,
    )
    .await;
    // A successor over another window is another basis.
    let mut wider = successor(
        &root,
        &template,
        vec![correction(bar, correction_version, 3, bar + 4 * MINUTE)],
    );
    wider.window_end_ns_exclusive += DAY;
    refused(&owner, &intake, wider, Refused::SuccessorBasisChanged).await;
    // So is a successor that states another Market Semantics value.
    let mut revalued = successor(
        &root,
        &template,
        vec![correction(bar, correction_version, 3, bar + 4 * MINUTE)],
    );
    revalued.market_semantics_value.price_adjustment = "SPLIT_ADJUSTED".to_owned();
    refused(&owner, &intake, revalued, Refused::SuccessorBasisChanged).await;

    // A withdrawal of the correction appends as the chain's third custody.
    let withdrawn = commit(
        &intake,
        successor(
            &root,
            &template,
            vec![withdrawal(
                bar,
                correction_version,
                3,
                Some(bar + 5 * MINUTE),
            )],
        ),
    )
    .await
    .expect("a correcting source withdraws a cross-section");
    assert_eq!(withdrawn.chain_version(), 3);
    assert_eq!(count(&owner, "pit_window_custodies_v1").await, 3);
    assert_eq!(
        count(&owner, "pit_window_cross_section_versions_v1").await,
        5
    );
    assert_eq!(count(&owner, "pit_window_custody_rows_v1").await, 40);
}

/// One daily bar at `event`, its rows retrieved at `retrieval_ns`, in a window around it.
fn single_bar(
    binding: &SourceBindingCommit,
    universe: UntrustedUniverseSelectionLocatorV1,
    event: u64,
    retrieval_ns: u64,
) -> UntrustedPitWindowCustodyRequestV1 {
    let mut request = request(binding, universe);
    let mut bar = original("1D", event);
    bar.rows = rows(6_500_000, retrieval_ns);
    request.window_start_ns = event - 2 * DAY;
    request.window_end_ns_exclusive = event + 2 * DAY;
    request.fill_timeframe = None;
    request.cross_sections = vec![bar];
    request
}

/// Availability follows the binding's rule and never passes the minting cut. A lag one nanosecond
/// below the execution bar is admitted and one equal to it refused; today's still-open bar, and a
/// closed bar whose rows the rule does not make visible by the cut, are refused unwritten; a rule
/// set to the retrieval instant makes every row available at the custody's minting cut.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_availability_follows_the_rule_and_never_passes_the_minting_cut() {
    let owner = owner().await;
    let at_retrieval = commit_binding(
        &owner,
        "synthetic/at-retrieval",
        1,
        Some(UntrustedSourceAvailabilityRuleV1 {
            visibility: UntrustedSourceVisibilityV1::AtRetrieval,
            publishes_corrections: false,
        }),
    )
    .await;
    let lag = |lag_ns| UntrustedSourceAvailabilityRuleV1 {
        visibility: UntrustedSourceVisibilityV1::AfterBarClose { lag_ns },
        publishes_corrections: false,
    };
    let below_bar = commit_binding(&owner, "binance/um/lagged", 2, Some(lag(DAY - 1))).await;
    let one_bar = commit_binding(&owner, "binance/um/late", 3, Some(lag(DAY))).await;
    admit_members(&owner, &at_retrieval).await;
    let universe = universe(&owner, &at_retrieval, 10, None).await;
    let intake = owner.pit_window_custody_commit_v1();

    refused(
        &owner,
        &intake,
        request(&one_bar, universe),
        Refused::AvailabilityLagNotBelowBarInterval,
    )
    .await;
    // Today's bar, retrieved before it closes.
    let now = wall_now_ns();
    refused(
        &owner,
        &intake,
        single_bar(&below_bar, universe, now + DAY / 2, now - SECOND),
        Refused::RowRetrievedBeforeBarClose,
    )
    .await;
    // A bar closed half a minute ago, whose rows the rule makes visible almost a day later.
    refused(
        &owner,
        &intake,
        single_bar(&below_bar, universe, now - 30 * SECOND, now - 10 * SECOND),
        Refused::VersionNotAvailableAtMintingCut,
    )
    .await;
    assert_eq!(count(&owner, "pit_window_custodies_v1").await, 0);

    let lagged = commit(&intake, request(&below_bar, universe))
        .await
        .expect("a lag below the execution bar is admitted");
    let first_bar = version_at(&owner, lagged.custody_identity(), WINDOW_START + DAY).await;
    let available: i64 = sqlx::query_scalar(
        "SELECT availability_ns FROM market_data_private.pit_window_cross_section_versions_v1 WHERE version_identity=$1",
    )
    .bind(first_bar.as_bytes().as_slice())
    .fetch_one(owner.pool())
    .await
    .unwrap();
    assert_eq!(
        available,
        i64::try_from(WINDOW_START + 2 * DAY - 1).unwrap()
    );

    let retrieved = commit(&intake, request(&at_retrieval, universe))
        .await
        .expect("a rule set to the retrieval instant is admitted");
    let instants: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT availability_ns,publication_ns FROM market_data_private.pit_window_cross_section_versions_v1 WHERE custody_identity=$1",
    )
    .bind(retrieved.custody_identity().as_bytes().as_slice())
    .fetch_all(owner.pool())
    .await
    .unwrap();
    let cut = i64::try_from(retrieved.minting_cut_ns()).unwrap();
    assert_eq!(instants.len(), 3);
    assert!(
        instants.iter().all(|instants| *instants == (cut, cut)),
        "every version is available, and published, at the minting cut"
    );
}

/// A snapshot and a custody chain under one compatibility scope: binding `A` (schema 1) holds a
/// research snapshot of `AAPL`, binding `B` (schema 2, declaring bars) states the same semantics,
/// so both resolve to one scope. The Owner clock then moves to `FIRST_CUT`, so a custody whose
/// rows were retrieved before it is minted at the head.
///
/// It runs on the test clock, not the Owner clock: the snapshot fixtures (`research_request_pit_v1`
/// and its universe, Instrument Master and R0 base) are minted at the test clock's instants 40 and
/// below and commit against that exact clock head, so on the Owner clock no snapshot could be
/// taken. The custody therefore mints no clock here: it is minted at the advanced test head.
struct SharedScopeV1 {
    owner: MarketDataOwnerPostgres,
    snapshot_binding: SourceBindingCommit,
    snapshot: crate::owner::pit_snapshot::PitSnapshotCommitAggregate,
    custody: UntrustedPitWindowCustodyRequestV1,
}

async fn shared_scope_v1() -> SharedScopeV1 {
    use super::{
        acceptance_fixture_v1::declaring_bars_v1,
        tests::{
            clock as test_clock, one_member_universe_v1, oracle_instrument_submission_v1,
            research_request_pit_v1, source_proposal as fixture_proposal,
        },
    };

    let owner = owner().await;
    let decision = || OwnerSourceBindingDecision {
        blockers: BTreeSet::new(),
    };
    let snapshot_binding = owner
        .commit_source_initial(fixture_proposal(10, 40), decision(), &test_clock(40, 1))
        .await
        .unwrap();
    let mut proposal = fixture_proposal(10, 40);
    proposal.adapter.dataset_mapping = "dataset/bars".to_owned();
    let mut proposal = declaring_bars_v1(proposal, declarations());
    proposal.availability_rule = Some(after_close(false));
    proposal.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&proposal.time_evidence);
    proposal.claimed_binding_id = derive_binding_id(&proposal);
    let custody_binding = owner
        .commit_source_initial(proposal, decision(), &test_clock(40, 1))
        .await
        .unwrap();
    assert_eq!(
        derive_market_semantics_compatibility_identity_v1(
            &snapshot_binding.fact().proposal().semantics
        ),
        derive_market_semantics_compatibility_identity_v1(
            &custody_binding.fact().proposal().semantics
        ),
        "the two bindings share one compatibility scope"
    );
    owner
        .admit_instrument_master_fact_v1(oracle_instrument_submission_v1(
            "AAPL",
            snapshot_binding.receipt().locator(),
        ))
        .await
        .unwrap();
    let universe = one_member_universe_v1(&owner, &snapshot_binding, "AAPL", 20).await;
    let snapshot = research_request_pit_v1(&owner, &snapshot_binding, "AAPL", &universe, 20).await;

    // The Owner clock moves on, through its own admission, to the instant the backfill ran.
    let mut transaction = owner.pool().begin().await.unwrap();
    super::admit_clock(&mut transaction, &test_clock(FIRST_CUT, 2))
        .await
        .unwrap();
    transaction.commit().await.unwrap();

    let mut custody = request(&custody_binding, universe.0);
    custody.members = vec!["AAPL".to_owned()];
    custody.fill_timeframe = None;
    custody.cross_sections = vec![
        UntrustedCrossSectionVersionV1 {
            rows: rows_of(&["AAPL"], 6_500_000, FIRST_CUT - SECOND),
            ..original("1D", WINDOW_START + DAY)
        },
        UntrustedCrossSectionVersionV1 {
            rows: rows_of(&["AAPL"], 6_600_000, FIRST_CUT - SECOND),
            ..original("1D", WINDOW_START + 2 * DAY)
        },
    ];
    SharedScopeV1 {
        owner,
        snapshot_binding,
        snapshot,
        custody,
    }
}

/// The custody stating the value the snapshot fixtures state, with `price_adjustment`.
fn stating(
    custody: &UntrustedPitWindowCustodyRequestV1,
    price_adjustment: &str,
) -> UntrustedPitWindowCustodyRequestV1 {
    let mut custody = custody.clone();
    custody.market_semantics_value = super::tests::market_semantics_value_v1(price_adjustment);
    custody
}

/// A custody chain stating another value than a snapshot of its scope already states is refused
/// by name and writes nothing; stating the same value it commits.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_custody_after_a_snapshot_of_its_scope_states_the_scope_value() {
    let shared = Box::pin(shared_scope_v1()).await;
    let owner = &shared.owner;
    assert_eq!(
        super::tests::admit_market_semantics_v1(
            owner,
            &shared.snapshot_binding,
            &shared.snapshot,
            "RAW"
        )
        .await,
        Ok(())
    );
    let intake = owner.pit_window_custody_commit_v1();

    refused(
        owner,
        &intake,
        stating(&shared.custody, "SPLIT_ADJUSTED"),
        Refused::MarketSemanticsScopeValueConflict,
    )
    .await;
    let receipt = commit(&intake, stating(&shared.custody, "RAW"))
        .await
        .expect("a custody stating its scope's value commits");
    assert!(
        market_semantics_of(owner, receipt.chain_root())
            .await
            .unwrap()
            .is_some()
    );
}

/// A snapshot stating another value than a custody chain of its scope already states is refused
/// as the scope conflict the snapshot path names; stating the same value it is admitted.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_snapshot_after_a_custody_of_its_scope_states_the_scope_value() {
    use crate::owner::market_semantics_admission_v1::MarketSemanticsAdmissionErrorV1;

    let shared = Box::pin(shared_scope_v1()).await;
    let owner = &shared.owner;
    let intake = owner.pit_window_custody_commit_v1();
    commit(&intake, stating(&shared.custody, "RAW"))
        .await
        .expect("the custody commits");

    // A second chain of the scope - another window, so another root - stating another value is
    // refused by the first chain's head alone.
    let mut later = stating(&shared.custody, "SPLIT_ADJUSTED");
    later.window_start_ns += DAY;
    later.window_end_ns_exclusive += DAY;
    later.cross_sections.remove(0);
    refused(
        owner,
        &intake,
        later,
        Refused::MarketSemanticsScopeValueConflict,
    )
    .await;

    // The scope's value is read over its chain heads too: with no snapshot head yet, the
    // custody's value is the scope's.
    let mut transaction = owner.pool().begin().await.unwrap();
    let scope_value =
        super::universe_member_composition_basis_v1::resolve_market_semantics_scope_value_v1(
            &mut transaction,
            shared.snapshot_binding.receipt().locator(),
        )
        .await
        .expect("the scope's value reads");
    transaction.rollback().await.unwrap();
    assert_eq!(
        scope_value.value(),
        Some(&super::tests::market_semantics_value_v1("RAW"))
    );
    let before = owner_store_v1(owner.pool()).await;

    assert_eq!(
        super::tests::admit_market_semantics_v1(
            owner,
            &shared.snapshot_binding,
            &shared.snapshot,
            "SPLIT_ADJUSTED"
        )
        .await,
        Err(MarketSemanticsAdmissionErrorV1::ScopeValueConflict)
    );
    assert_eq!(
        owner_store_v1(owner.pool()).await,
        before,
        "the refusal wrote nothing"
    );
    assert_eq!(
        super::tests::admit_market_semantics_v1(
            owner,
            &shared.snapshot_binding,
            &shared.snapshot,
            "RAW"
        )
        .await,
        Ok(())
    );
}
