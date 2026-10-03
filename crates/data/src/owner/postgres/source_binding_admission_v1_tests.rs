//! The production Source Binding admission refuses an impossible bar timeframe by name, unwritten.

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
