//! A schema-2 Source Binding's availability rule, stored and read back by the Owner.

use std::{collections::BTreeSet, env};

use super::{
    MarketDataOwnerPostgres, OwnerSourceBindingDecision, acceptance_fixture_v1::source_proposal,
    load_source, tests::clock,
};
use crate::owner::source_binding::{
    UntrustedSourceAvailabilityRuleV1, UntrustedSourceVisibilityV1,
    authority::{availability_rule_digest_v1, derive_binding_id, derive_time_evidence_identity},
};

#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_schema_two_binding_stores_its_availability_rule() {
    let owner =
        MarketDataOwnerPostgres::connect(&env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
    let rule = UntrustedSourceAvailabilityRuleV1 {
        visibility: UntrustedSourceVisibilityV1::AfterBarClose {
            lag_ns: 2_000_000_000,
        },
        publishes_corrections: false,
    };
    let mut proposal = source_proposal(10, 99);
    proposal.schema_version = 2;
    proposal.availability_rule = Some(rule.clone());
    proposal.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&proposal.time_evidence);
    proposal.claimed_binding_id = derive_binding_id(&proposal);
    let committed = owner
        .commit_source_initial(
            proposal,
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &clock(99, 1),
        )
        .await
        .unwrap();

    let mut transaction = owner.pool().begin().await.unwrap();
    let stored = load_source(&mut transaction, committed.fact().binding_id(), false)
        .await
        .unwrap()
        .expect("the committed binding is stored");
    transaction.rollback().await.unwrap();
    let read_back = stored
        .commit()
        .fact()
        .availability_rule()
        .expect("a schema-2 binding reads back its rule");
    assert_eq!(read_back, &rule);
    assert_eq!(
        availability_rule_digest_v1(read_back),
        availability_rule_digest_v1(&rule)
    );
    assert_eq!(stored.commit().fact().digest(), committed.fact().digest());
}
