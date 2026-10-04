//! A fixed-member frontier admitted at the Owner's clock is in force at the Owner's current cut,
//! so a Research scope check finds its members, and a later call rejoins it without writing.

use super::{
    UniverseSelectionAdmissionPostgresV1,
    pit_window_custody_v1_tests::{BTC, ETH, admit_members, after_close, commit_binding, d, owner},
};
use crate::owner::{
    check_research_instrument_scope_v1,
    research_instrument_scope_v1::ResearchInstrumentScopeV1,
    research_pit_references_v1::ResearchInstrumentAdmissibilityV1,
    source_binding::BindingDigest,
    universe_selection_admission_v1::{
        HistoricalMembershipAdmissionRequestV1, HistoricalMembershipSubmissionV1,
        UniverseSelectionAdmissionErrorV1, UniverseSelectionAdmissionV1,
    },
};

/// Both members, stating no observation instant: the Owner stamps them.
fn request(
    frontier: BindingDigest,
    lineage_root: BindingDigest,
    correction: BindingDigest,
) -> HistoricalMembershipAdmissionRequestV1 {
    HistoricalMembershipAdmissionRequestV1 {
        eligible_instrument_frontier: frontier,
        members: [BTC, ETH]
            .into_iter()
            .map(|member| HistoricalMembershipSubmissionV1 {
                member_key: member.to_owned(),
                instrument: member.to_owned(),
                effective_from_ns: 1,
                effective_until_ns: None,
                provider_available_ns: 0,
                retrieval_ns: 0,
                correction_publication_ns: 0,
                owner_observation_ns: 0,
                decision_cut: 0,
                source_binding_lineage_root: lineage_root,
                correction_frontier_digest: correction,
            })
            .collect(),
    }
}

async fn membership_rows(owner: &super::MarketDataOwnerPostgres) -> (i64, i64) {
    sqlx::query_as("SELECT (SELECT COUNT(*) FROM market_data_private.historical_membership_facts_v1),(SELECT COUNT(*) FROM market_data_private.historical_membership_frontiers_v1)")
        .fetch_one(owner.pool())
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_membership_admitted_at_the_owner_clock_is_in_force_now_and_rejoins() {
    let owner = owner().await;
    let binding = commit_binding(&owner, "binance/um/klines", 1, Some(after_close(false))).await;
    admit_members(&owner, &binding).await;
    let admission = UniverseSelectionAdmissionPostgresV1 {
        owner: super::pit_window_custody_v1_tests::owner().await,
    };
    let lineage_root = binding.fact().lineage_root();
    let correction = binding.receipt().locator().correction_frontier.digest;
    let frontier = d(81);

    admission
        .admit_membership_at_owner_clock(request(frontier, lineage_root, correction))
        .await
        .expect("the first call admits the frontier");
    let admitted = membership_rows(&owner).await;
    assert_eq!(admitted, (2, 1));

    let mut transaction = owner.pool().begin().await.unwrap();
    let scope = ResearchInstrumentScopeV1::from_identities(vec![BTC.to_owned()]).unwrap();
    let check = check_research_instrument_scope_v1(&mut transaction, &scope)
        .await
        .unwrap();
    transaction.rollback().await.unwrap();
    assert_eq!(
        check.rows()[0].admissibility(),
        ResearchInstrumentAdmissibilityV1::Admissible,
        "a member stamped at the Owner's cut is in force at the current cut"
    );
    assert_eq!(check.eligible_instrument_frontier(), Some(frontier));

    admission
        .admit_membership_at_owner_clock(request(frontier, lineage_root, correction))
        .await
        .expect("a later call rejoins the admitted frontier");
    assert_eq!(
        membership_rows(&owner).await,
        admitted,
        "the rejoin writes nothing"
    );

    assert_eq!(
        admission
            .admit_membership_at_owner_clock(request(frontier, d(99), correction))
            .await,
        Err(UniverseSelectionAdmissionErrorV1::RequestConflict),
        "the same members under another lineage are another meaning"
    );
    let mut one_member = request(frontier, lineage_root, correction);
    one_member.members.pop();
    assert_eq!(
        admission.admit_membership_at_owner_clock(one_member).await,
        Err(UniverseSelectionAdmissionErrorV1::RequestConflict),
        "another member set is another frontier"
    );
    assert_eq!(membership_rows(&owner).await, admitted);
}
