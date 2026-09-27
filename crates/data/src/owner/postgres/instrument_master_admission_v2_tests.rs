//! The production Instrument Master V2 baseline intake, proven through production paths only.
//!
//! The clock head moves only through the Owner's own Source Binding admission, never by writing it.
//! The payload is the inherited Binance adapter's recorded USD-M `exchangeInfo` response (added in
//! #180). The cut is issued for a Universe Selection whose request carries the decision cut R&D
//! reads, through `market_data_rd_api.read_owner_clock_head_for_research_v1()`, so the cut resolves
//! the admitted fact on the coordinate the selection side actually uses, not on a chosen value.

use std::collections::BTreeSet;

use super::{MarketDataOwnerPostgres, OwnerSourceBindingDecision, SourceBindingCommit};
use crate::owner::{
    instrument_master_admission_v2::{
        InstrumentMasterAdmissionErrorV2, InstrumentMasterAdmissionTerminalV2,
        InstrumentMasterBaselineSubmissionV2, InstrumentTermsBasisWireV2,
    },
    instrument_master_v2::{
        FactValue, InstrumentDecimalV2, InstrumentMasterCustodyErrorV2,
        InstrumentMasterCutRequestV2, InstrumentMasterFactV2, InstrumentTermsBasisV2,
    },
    instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
    source_binding::{
        BindingDigest, MarketDataClockAdmission, UntrustedSourceBindingLocator,
        authority::{derive_binding_id, derive_time_evidence_identity},
    },
    universe_selection::{
        UniverseSelectionReadbackV1, UntrustedUniverseSelectionRequestV1,
        authority::{
            CanonicalUniverseSelectionRuleEvaluatorV1, HistoricalMembershipFactProposalV1,
        },
    },
};

pub(super) const USDM: &str = include_str!(
    "../../../../adapters/binance/test_data/futures/http_json/exchange_info_usdm.json"
);
const COINM: &str = include_str!(
    "../../../../adapters/binance/test_data/futures/http_json/exchange_info_delivery_coinm.json"
);
const CLOCK_IDENTITY: &str = "market-clock.identity.v2-intake-01";
const CLOCK_EPOCH: &str = "market-clock.epoch.v2-intake-00001";
/// 2026-09-21 in nanoseconds: a head on the real clock, after `BTCUSDT`'s listing.
pub(super) const FIRST_CUT: u64 = 1_790_000_000_000_000_000;
pub(super) const SECOND: u64 = 1_000_000_000;
const BTCUSDT_ONBOARD_NS: i128 = 1_569_398_400_000 * 1_000_000;

pub(super) fn d(byte: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([byte; 32])
}

fn clock(sequence: u64, decision_cut: u64) -> MarketDataClockAdmission {
    MarketDataClockAdmission::seal_for_test(
        CLOCK_IDENTITY,
        CLOCK_EPOCH,
        sequence,
        decision_cut,
        decision_cut,
        decision_cut + 3_600 * SECOND,
        d(7),
        1,
        2,
    )
}

/// Commits one admitted Source Binding over `dataset_mapping` with `clock`, which is how the Owner's
/// clock head moves in production.
pub(super) async fn commit_binding(
    owner: &MarketDataOwnerPostgres,
    dataset_mapping: &str,
    sequence: u64,
    decision_cut: u64,
) -> SourceBindingCommit {
    commit_binding_on(owner, dataset_mapping, &clock(sequence, decision_cut)).await
}

/// Commits one admitted Source Binding over `dataset_mapping` on exactly `clock`.
pub(super) async fn commit_binding_on(
    owner: &MarketDataOwnerPostgres,
    dataset_mapping: &str,
    clock: &MarketDataClockAdmission,
) -> SourceBindingCommit {
    let sequence = clock.monotonic_sequence;
    let decision_cut = clock.decision_cut;
    let mut proposal = super::pit_intake_member_count_tests::source_proposal();
    proposal.adapter.dataset_mapping = dataset_mapping.to_owned();
    proposal.semantics.normalization = format!("normalization-{dataset_mapping}-{sequence}");
    let time = &mut proposal.time_evidence;
    time.clock_identity.clone_from(&clock.clock_identity);
    time.clock_epoch.clone_from(&clock.clock_epoch);
    time.restart_continuity_digest = clock.restart_continuity_digest;
    time.skew_bound = clock.skew_bound;
    time.uncertainty_bound = clock.uncertainty_bound;
    time.monotonic_sequence = sequence;
    time.event_effective = decision_cut - 30;
    time.provider_available = decision_cut - 20;
    time.correction_publication = decision_cut - 15;
    time.retrieval = decision_cut - 10;
    time.observed_at = decision_cut;
    time.effective_at = decision_cut;
    time.valid_through = decision_cut + 3_600 * SECOND;
    proposal.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&proposal.time_evidence);
    proposal.claimed_binding_id = derive_binding_id(&proposal);
    owner
        .commit_source_initial(
            proposal,
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            clock,
        )
        .await
        .expect("the Owner admits the binding and its clock")
}

pub(super) fn submission(
    binding: &SourceBindingCommit,
    raw_symbol: &str,
    retrieval_time_ns: u64,
    raw_payload: &str,
) -> InstrumentMasterBaselineSubmissionV2 {
    InstrumentMasterBaselineSubmissionV2 {
        raw_symbol: raw_symbol.to_owned(),
        instrument_class: "CRYPTO_PERPETUAL".to_owned(),
        retrieval_time_ns: i128::from(retrieval_time_ns),
        raw_payload: raw_payload.to_owned(),
        source_binding: binding.receipt().locator().clone(),
    }
}

/// The real payload with `edit` applied to its `BTCUSDT` entry.
fn edited(edit: impl FnOnce(&mut serde_json::Value)) -> String {
    let mut root: serde_json::Value = serde_json::from_str(USDM).unwrap();
    let entry = root["symbols"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|entry| entry["symbol"] == "BTCUSDT")
        .unwrap();
    edit(entry);
    serde_json::to_string(&root).unwrap()
}

fn price_filter(entry: &mut serde_json::Value) -> &mut serde_json::Value {
    entry["filters"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|filter| filter["filterType"] == "PRICE_FILTER")
        .unwrap()
}

/// Every V2 fact row, in a stable order, for "nothing was written".
pub(super) async fn facts(owner: &MarketDataOwnerPostgres) -> Vec<(Vec<u8>, String, Vec<u8>)> {
    sqlx::query_as(
        "SELECT fact_identity,canonical_identity,fact_bytes FROM market_data_instrument_master_v2.facts ORDER BY fact_identity",
    )
    .fetch_all(owner.pool())
    .await
    .unwrap()
}

/// The decision cut R&D reads, through the function R&D reads it with.
pub(super) async fn research_decision_cut(owner: &MarketDataOwnerPostgres) -> u64 {
    let cut: i64 = sqlx::query_scalar(
        "SELECT decision_cut FROM market_data_rd_api.read_owner_clock_head_for_research_v1()",
    )
    .fetch_one(owner.pool())
    .await
    .unwrap();
    u64::try_from(cut).unwrap()
}

/// A Universe Selection over `BTCUSDT-PERP.BINANCE`, evaluated by the Owner, whose request carries
/// `decision_cut` as its Owner observation exactly as R&D's request does.
pub(super) async fn selection(
    owner: &MarketDataOwnerPostgres,
    binding: &SourceBindingCommit,
    frontier: u8,
    decision_cut: u64,
) -> UniverseSelectionReadbackV1 {
    let lineage_root = binding.fact().lineage_root();
    let correction = binding.receipt().locator().correction_frontier.digest;
    let at = i128::from(decision_cut);
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
    let mut transaction = owner.pool().begin().await.unwrap();
    super::universe_selection::persist_historical_membership_frontier_v1(
        &mut transaction,
        d(frontier),
        vec![HistoricalMembershipFactProposalV1 {
            member_key: b"btc".to_vec(),
            instrument: b"BTCUSDT-PERP.BINANCE".to_vec(),
            predecessor_identity: None,
            // A membership fact's identity does not bind its frontier, so each frontier's member
            // is its own fact.
            effective_from_ns: i128::from(frontier),
            effective_until_ns: None,
            provider_available_ns: at - 20,
            retrieval_ns: at - 10,
            correction_publication_ns: at - 15,
            owner_observation_ns: at,
            decision_cut,
            source_binding_lineage_root: lineage_root,
            correction_frontier_digest: correction,
        }],
    )
    .await
    .unwrap();
    let readback = super::universe_selection::resolve_universe_selection_in_transaction_v1(
        &mut transaction,
        &request,
        Some(&CanonicalUniverseSelectionRuleEvaluatorV1),
    )
    .await
    .unwrap();
    transaction.commit().await.unwrap();
    readback
}

/// The baseline intake admits one instrument's first V2 fact from the real payload, through the
/// production clock, and the request-keyed cut resolves it on the decision cut R&D reads; every
/// refusal a submission can reach is driven once and writes nothing.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
#[expect(
    clippy::too_many_lines,
    reason = "one store, one clock: each step depends on the head the one before left"
)]
async fn postgres_a_v2_baseline_is_admitted_from_its_payload_and_resolved_at_the_research_cut() {
    use InstrumentMasterAdmissionErrorV2 as Refused;

    let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL")
        .expect("explicit disposable Owner URL");
    let database =
        std::env::var("VIBE_POSTGRES_TEST_DATABASE_NAME").expect("disposable database name");
    assert!(
        database.starts_with("vibe_test_"),
        "this proof writes; it runs only against a disposable database"
    );
    let owner = MarketDataOwnerPostgres::connect(&owner_url)
        .await
        .expect("Owner connects and migrates");
    let instruments = InstrumentMasterV2PostgresOwner::install(owner.pool().clone())
        .await
        .expect("the V2 store installs");
    let usdm = commit_binding(&owner, "usdm/exchangeInfo", 1, FIRST_CUT).await;
    let retrieval = FIRST_CUT + SECOND;

    // 1. Retrieved after the head: refused by name until the head passes the retrieval.
    assert_eq!(
        owner
            .admit_instrument_master_baseline_v2(submission(&usdm, "BTCUSDT", retrieval, USDM))
            .await,
        Err(Refused::RetrievalAfterOwnerClock)
    );
    assert!(facts(&owner).await.is_empty(), "the refusal wrote nothing");

    // 2. The head advances through a production Source Binding admission.
    let second_cut = FIRST_CUT + 2 * SECOND;
    let coinm = commit_binding(&owner, "coinm/exchangeInfo", 2, second_cut).await;
    assert_eq!(research_decision_cut(&owner).await, second_cut);

    // 3. Before admission, the cut at this decision cut finds no fact.
    let before = selection(&owner, &usdm, 60, research_decision_cut(&owner).await).await;
    assert_eq!(
        instruments
            .issue_cut(
                InstrumentMasterCutRequestV2::new(d(61), second_cut),
                &before
            )
            .await
            .map(|_| ()),
        Err(InstrumentMasterCustodyErrorV2::MissingFact)
    );

    // 4. Admission derives the fact from the payload and stamps the head's decision cut.
    let admitted = owner
        .admit_instrument_master_baseline_v2(submission(&usdm, "BTCUSDT", retrieval, USDM))
        .await
        .expect("the retrieval is now before the head");
    assert_eq!(admitted.canonical_identity(), "BTCUSDT-PERP.BINANCE");
    assert_eq!(admitted.owner_observation_time_ns(), i128::from(second_cut));
    assert_eq!(
        admitted.terms_basis(),
        InstrumentTermsBasisWireV2::RetrievedTermsAssumedSinceListing
    );
    let stored = facts(&owner).await;
    assert_eq!(stored.len(), 1);
    let fact = InstrumentMasterFactV2::from_canonical_bytes(&stored[0].2, None).unwrap();
    assert_eq!(fact.identity(), admitted.fact_identity());
    assert_eq!(
        fact.baseline_provenance().effective_from_ns,
        BTCUSDT_ONBOARD_NS
    );
    assert_eq!(
        fact.baseline_provenance().retrieval_time_ns,
        i128::from(retrieval)
    );
    assert_eq!(
        fact.baseline_provenance().source_binding_identity,
        usdm.receipt().locator().binding_id
    );
    assert_eq!(
        fact.terms().price_increment_from_filter,
        FactValue::Value(InstrumentDecimalV2 {
            mantissa: 1,
            scale: 1
        })
    );
    assert_eq!(
        fact.terms().quantity_increment_from_filter,
        FactValue::Value(InstrumentDecimalV2 {
            mantissa: 1,
            scale: 3
        })
    );

    // 5. After admission, a cut at the same decision cut, read as R&D reads it, resolves the fact.
    let research_cut = research_decision_cut(&owner).await;
    assert_eq!(
        research_cut, second_cut,
        "the admission did not move the head"
    );
    let after = selection(&owner, &usdm, 70, research_cut).await;
    let readback = instruments
        .issue_cut(
            InstrumentMasterCutRequestV2::new(d(71), research_cut),
            &after,
        )
        .await
        .expect("the cut resolves the admitted fact");
    let members = readback.cut().members();
    assert_eq!(members.len(), 1);
    assert_eq!(members[0].fact().identity(), admitted.fact_identity());
    assert_eq!(
        members[0].fact().canonical_identity(),
        "BTCUSDT-PERP.BINANCE"
    );
    assert_eq!(
        members[0].fact().terms_basis(),
        InstrumentTermsBasisV2::RetrievedTermsAssumedSinceListing
    );

    // 6. A stored row that no longer answers to its instrument: the same fact identity is stored
    // under another canonical identity, so the submission's insert collides. Refused, then restored
    // and read back.
    let untampered = facts(&owner).await;
    sqlx::query(
        "UPDATE market_data_instrument_master_v2.facts SET canonical_identity='TAMPERED-PERP.BINANCE' WHERE fact_identity=$1",
    )
    .bind(admitted.fact_identity().as_bytes().as_slice())
    .execute(owner.pool())
    .await
    .unwrap();
    assert_eq!(
        owner
            .admit_instrument_master_baseline_v2(submission(&usdm, "BTCUSDT", retrieval, USDM))
            .await,
        Err(Refused::AdmissionConflict)
    );
    sqlx::query(
        "UPDATE market_data_instrument_master_v2.facts SET canonical_identity='BTCUSDT-PERP.BINANCE' WHERE fact_identity=$1",
    )
    .bind(admitted.fact_identity().as_bytes().as_slice())
    .execute(owner.pool())
    .await
    .unwrap();
    assert_eq!(
        facts(&owner).await,
        untampered,
        "the tampered row is restored"
    );

    // 7. Replay after the head has advanced again rejoins the fact and returns the same terminal.
    let third_cut = FIRST_CUT + 3 * SECOND;
    let _ = commit_binding(&owner, "coinm/exchangeInfo", 3, third_cut).await;
    assert_eq!(
        owner
            .admit_instrument_master_baseline_v2(submission(&usdm, "BTCUSDT", retrieval, USDM))
            .await,
        Ok(admitted.clone()),
        "a replay rejoins"
    );

    // 8. Every refusal a submission can reach, each writing nothing.
    let before_refusals = facts(&owner).await;
    let refusals: Vec<(&str, InstrumentMasterBaselineSubmissionV2, Refused)> = vec![
        (
            "a later retrieval of unchanged terms",
            submission(&usdm, "BTCUSDT", third_cut - 1, USDM),
            Refused::BaselineExists,
        ),
        (
            "a changed tick",
            submission(
                &usdm,
                "BTCUSDT",
                retrieval,
                &edited(|entry| price_filter(entry)["tickSize"] = "0.20".into()),
            ),
            Refused::BaselineExists,
        ),
        (
            "another class",
            InstrumentMasterBaselineSubmissionV2 {
                instrument_class: "EQUITY".to_owned(),
                ..submission(&usdm, "ETHUSDT", retrieval, USDM)
            },
            Refused::UnsupportedClass,
        ),
        (
            "a dataset outside the venue table",
            submission(&coinm, "BTCUSDT", retrieval, USDM),
            Refused::UnsupportedVenue,
        ),
        (
            "an absent symbol",
            submission(&usdm, "ETHUSDT", retrieval, USDM),
            Refused::SymbolAbsent,
        ),
        (
            "an ambiguous symbol",
            submission(&usdm, "BTCUSDT", retrieval, &{
                let mut root: serde_json::Value = serde_json::from_str(USDM).unwrap();
                let first = root["symbols"][0].clone();
                root["symbols"].as_array_mut().unwrap().push(first);
                serde_json::to_string(&root).unwrap()
            }),
            Refused::SymbolAmbiguous,
        ),
        (
            "a TRADIFI_PERPETUAL",
            submission(&usdm, "XAUUSDT", retrieval, USDM),
            Refused::ContractTypeUnsupported,
        ),
        (
            "a COIN-M entry under a USD-M binding",
            submission(&usdm, "BTCUSD_260925", retrieval, COINM),
            Refused::DatasetMismatch,
        ),
        (
            "an onboard date after the retrieval",
            submission(
                &usdm,
                "BTCUSDT",
                retrieval,
                &edited(|entry| entry["onboardDate"] = 1_800_000_000_000_i64.into()),
            ),
            Refused::OnboardDateUnavailable,
        ),
        (
            "a missing price filter",
            submission(
                &usdm,
                "BTCUSDT",
                retrieval,
                &edited(|entry| {
                    entry["filters"]
                        .as_array_mut()
                        .unwrap()
                        .retain(|filter| filter["filterType"] != "PRICE_FILTER");
                }),
            ),
            Refused::FilterUnavailable,
        ),
        (
            "a payload that is not exchangeInfo",
            submission(&usdm, "BTCUSDT", retrieval, "not json"),
            Refused::InvalidSubmission,
        ),
        (
            "a locator that is not the stored binding's",
            InstrumentMasterBaselineSubmissionV2 {
                source_binding: {
                    let mut locator: UntrustedSourceBindingLocator =
                        usdm.receipt().locator().clone();
                    locator.correction_frontier.digest = d(0x91);
                    locator
                },
                ..submission(&usdm, "BTCUSDT", retrieval, USDM)
            },
            Refused::SourceBindingUnavailable,
        ),
    ];

    for (name, refused, refusal) in refusals {
        assert_eq!(
            owner.admit_instrument_master_baseline_v2(refused).await,
            Err(refusal),
            "{name}"
        );
    }
    assert_eq!(
        facts(&owner).await,
        before_refusals,
        "no refusal wrote anything"
    );

    // 9. The store's ownership assertion: a privilege granted to another role on a V2 table makes
    // the store refuse to be written. Revoked and read back.
    let acl = || async {
        sqlx::query_scalar::<_, Option<String>>(
            "SELECT relacl::text FROM pg_catalog.pg_class WHERE oid='market_data_instrument_master_v2.facts'::regclass",
        )
        .fetch_one(owner.pool())
        .await
        .unwrap()
    };
    let untouched = acl().await;
    sqlx::query("GRANT SELECT ON market_data_instrument_master_v2.facts TO vibe_test_role_market_data_reader")
        .execute(owner.pool())
        .await
        .unwrap();
    assert_eq!(
        owner
            .admit_instrument_master_baseline_v2(submission(&usdm, "BTCUSDT", retrieval, USDM))
            .await,
        Err(Refused::StoreUnavailable)
    );
    sqlx::query("REVOKE SELECT ON market_data_instrument_master_v2.facts FROM vibe_test_role_market_data_reader")
        .execute(owner.pool())
        .await
        .unwrap();
    assert_eq!(acl().await, untouched, "the grant is revoked");
    assert_eq!(
        owner
            .admit_instrument_master_baseline_v2(submission(&usdm, "BTCUSDT", retrieval, USDM))
            .await
            .map(|terminal: InstrumentMasterAdmissionTerminalV2| terminal.fact_identity()),
        Ok(admitted.fact_identity()),
        "and the store answers again"
    );
}
