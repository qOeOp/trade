//! The production Instrument Master admission takes a fact's Market Semantics scope and frontiers
//! from the Source Binding the submission names, and admits nothing under a binding it does not
//! hold admitted.

use std::collections::BTreeSet;

use super::{
    OwnerSourceBindingDecision,
    pit_intake_member_count_tests::{Fixture, clock, d, instrument_submission, source_proposal},
};
use crate::owner::{
    instrument_master::InstrumentMasterFactV1,
    instrument_master_admission_v1::InstrumentMasterAdmissionErrorV1,
    source_binding::{
        BindingDigest, SourceBindingBlocker,
        authority::{
            derive_binding_id, derive_market_semantics_compatibility_identity_v1,
            derive_time_evidence_identity,
        },
    },
};

/// The Instrument Master fact stored under `digest`, decoded by the Owner's own codec.
async fn stored_fact(fixture: &Fixture, digest: BindingDigest) -> InstrumentMasterFactV1 {
    let bytes: Vec<u8> = sqlx::query_scalar(
        "SELECT fact_bytes FROM market_data_private.instrument_master_facts_v1 WHERE fact_digest=$1",
    )
    .bind(digest.as_bytes().as_slice())
    .fetch_one(fixture.owner().pool())
    .await
    .unwrap();
    crate::owner::instrument_master::authority::decode_fact(&bytes).unwrap()
}

/// A fact admitted under a named binding states that binding's derived scope and its frontiers,
/// and a replay rejoins it. A binding Market Data does not hold, a locator that differs from the
/// stored binding's, and a binding held but not admitted are each refused as
/// `SourceBindingUnavailable`, and none of the three writes anything.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_an_instrument_fact_takes_its_scope_and_frontiers_from_the_named_binding() {
    let fixture = Fixture::install().await;
    let owner = fixture.owner();
    let source = &fixture.source;

    let admitted = owner
        .admit_instrument_master_fact_v1(instrument_submission("AAPL", source, d(81)))
        .await
        .expect("a fact under an admitted binding is admitted");
    let fact = stored_fact(&fixture, admitted.fact_digest()).await;
    assert_eq!(
        fact.market_semantics_identity(),
        derive_market_semantics_compatibility_identity_v1(&source.fact().proposal().semantics),
        "the fact states the scope derived from the named binding's semantics"
    );
    assert_eq!(
        fact.source_frontier(),
        source.fact().source_frontier().digest
    );
    assert_eq!(
        fact.correction_frontier(),
        source.fact().correction_frontier().digest
    );
    assert_eq!(
        owner
            .admit_instrument_master_fact_v1(instrument_submission("AAPL", source, d(81)))
            .await,
        Ok(admitted),
        "a replayed submission rejoins its fact"
    );

    // A binding the Owner holds but did not admit.
    let mut blocked = source_proposal();
    blocked.semantics.normalization = "normalization-blocked".into();
    blocked.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&blocked.time_evidence);
    blocked.claimed_binding_id = derive_binding_id(&blocked);
    let blocked = owner
        .commit_source_initial(
            blocked,
            OwnerSourceBindingDecision {
                blockers: BTreeSet::from([SourceBindingBlocker::SourceUnavailable]),
            },
            &clock(),
        )
        .await
        .unwrap();

    let before = fixture.store().await;
    let mut unknown = instrument_submission("MSFT", source, d(81));
    unknown.source_binding.binding_id = d(0x90);
    assert_eq!(
        owner.admit_instrument_master_fact_v1(unknown).await,
        Err(InstrumentMasterAdmissionErrorV1::SourceBindingUnavailable),
        "a binding Market Data does not hold"
    );
    let mut differing = instrument_submission("MSFT", source, d(81));
    differing.source_binding.correction_frontier.digest = d(0x91);
    assert_eq!(
        owner.admit_instrument_master_fact_v1(differing).await,
        Err(InstrumentMasterAdmissionErrorV1::SourceBindingUnavailable),
        "a locator that is not the stored binding's"
    );
    assert_eq!(
        owner
            .admit_instrument_master_fact_v1(instrument_submission("MSFT", &blocked, d(81)))
            .await,
        Err(InstrumentMasterAdmissionErrorV1::SourceBindingUnavailable),
        "a binding held but not admitted"
    );
    assert_eq!(fixture.store().await, before, "a refusal writes nothing");
}
