//! The production Source Binding admission refuses an impossible bar timeframe by name, unwritten,
//! and its dataset anchor admits a dataset exactly once no matter how many times it is called.

use std::env;

use super::{
    MarketDataOwnerPostgres, SourceBindingAdmissionPostgresV1,
    acceptance_fixture_v1::{declaring_bars_v1, session_bar_v1, source_proposal},
    pit_intake_member_count_tests::owner_store_v1,
};
use crate::owner::{
    source_binding::{
        UntrustedSourceBarAnchorV1, UntrustedSourceBarCadenceV1, UntrustedSourceBarClockV1,
    },
    source_binding_admission_v1::{
        ProviderReachabilityEvidenceV1, ProviderRightsEvidenceV1, SourceBindingAdmissionErrorV1,
        SourceBindingAdmissionRequestV1, SourceBindingAdmissionV1,
    },
};

#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_an_unsupported_bar_timeframe_is_refused_by_name_and_writes_nothing() {
    let admission = SourceBindingAdmissionPostgresV1 {
        owner: MarketDataOwnerPostgres::connect(
            &env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap(),
        )
        .await
        .unwrap(),
    };
    // An exchange session day counted from the Unix epoch on a continuous clock: no bar has it.
    let mut impossible = session_bar_v1("1D", UntrustedSourceBarCadenceV1::ExchangeSessionDay);
    impossible.anchor = UntrustedSourceBarAnchorV1::UnixEpoch;
    impossible.clock = UntrustedSourceBarClockV1::Continuous;
    let request = SourceBindingAdmissionRequestV1 {
        proposal: declaring_bars_v1(source_proposal(10, 99), vec![impossible]),
        rights: ProviderRightsEvidenceV1::Granted,
        reachability: ProviderReachabilityEvidenceV1::Reachable,
    };

    let before = owner_store_v1(admission.owner.pool()).await;
    let refused = admission.admit(request).await;
    let after = owner_store_v1(admission.owner.pool()).await;

    assert_eq!(
        refused,
        Err(SourceBindingAdmissionErrorV1::BarTimeframeUnsupported)
    );
    assert_eq!(before, after, "the refusal writes no Owner table");
}

#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_dataset_anchor_admits_exactly_one_binding_across_two_calls() {
    let admission = SourceBindingAdmissionPostgresV1 {
        owner: MarketDataOwnerPostgres::connect(
            &env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap(),
        )
        .await
        .unwrap(),
    };
    let dataset_key = "test/dataset-anchor-v1";
    let request = || SourceBindingAdmissionRequestV1 {
        proposal: source_proposal(1, 99),
        rights: ProviderRightsEvidenceV1::Granted,
        reachability: ProviderReachabilityEvidenceV1::Reachable,
    };

    let first = admission
        .admit_dataset_anchor(dataset_key, request())
        .await
        .expect("the dataset's first call admits it");
    let binding_count_after_first: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM market_data_private.source_binding_facts_v1",
    )
    .fetch_one(admission.owner.pool())
    .await
    .unwrap();
    assert_eq!(
        binding_count_after_first, 1,
        "the first call admits exactly one binding"
    );

    let second = admission
        .admit_dataset_anchor(dataset_key, request())
        .await
        .expect("the dataset's later call reads the anchor back");
    let binding_count_after_second: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM market_data_private.source_binding_facts_v1",
    )
    .fetch_one(admission.owner.pool())
    .await
    .unwrap();
    assert_eq!(
        binding_count_after_second, 1,
        "a second call to the same dataset admits no second binding"
    );
    assert_eq!(
        second.lineage_root(),
        first.lineage_root(),
        "both calls resolve to the one anchored binding's own lineage root"
    );
    assert_eq!(second.binding_id(), first.binding_id());
    assert_eq!(
        second.market_semantics_identity(),
        first.market_semantics_identity()
    );
}
