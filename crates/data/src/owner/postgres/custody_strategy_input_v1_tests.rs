//! A custody run's Design declared over its first custody frame (T0-10), proved on real
//! PostgreSQL: declared once at the head the run pins and rejoined, never refused by a correction
//! committed after it, and every refusal writes nothing.

use super::{
    MarketDataOwnerPostgres,
    authenticated_design_registration_v1::register_custody_design_roles_v1,
    custody_strategy_input_v1::read_custody_frame_batch_v1,
    pit_role_resolution_v1::{AuthenticatedDesignIdentityV1, compose_binding_request_v1},
    pit_window_custody_v1_tests::{d, owner},
    pit_window_view_v1_tests::corrected_custody_chain_fixture_v1,
    strategy_input_binding_registry::{
        StrategyInputBindingRegistryErrorV1 as Registry,
        register_authenticated_role_declarations_v1,
    },
};
use crate::owner::{
    pit_window_custody_v1::{
        UntrustedPitWindowCustodyClaimV1, UntrustedPitWindowCustodyFrameV1, UntrustedPitWindowRunV1,
    },
    source_binding::BindingDigest,
    strategy_design_role_intent_v1::StrategyDesignRoleIntentV1,
    strategy_design_role_set::StrategyDesignRoleEntryV1,
    strategy_input_binding::{StrategyInputBatchSourceV1, UntrustedStrategyInputBindingRequest},
    strategy_input_binding_admission_v1::{
        StrategyInputBindingAdmissionErrorV1, StrategyInputBindingAdmissionTerminalV1,
    },
};

fn role(identity: BindingDigest, field: &str) -> StrategyDesignRoleEntryV1 {
    StrategyDesignRoleEntryV1 {
        role_identity: identity,
        semantic_id: format!("universe-{field}"),
        fact_class: "MARKET_DATA".into(),
        instrument: String::new(),
        scope: r#"{"kind":"UNIVERSE_MEMBERS"}"#.into(),
        field_semantic_id: format!("MARKET_DATA.BAR.{field}.PRICE.V1"),
        channel: "MARKET".into(),
        timeframe: "1D".into(),
        unit: "PRICE".into(),
        scale: 2,
        value_type: "I128".into(),
    }
}

fn roles() -> Vec<StrategyDesignRoleEntryV1> {
    vec![role(d(0x61), "CLOSE"), role(d(0x62), "OPEN")]
}

fn authenticated(design: BindingDigest) -> AuthenticatedDesignIdentityV1 {
    AuthenticatedDesignIdentityV1::from_role_intent(
        &StrategyDesignRoleIntentV1::from_rd_owner_projection(
            d(0x70),
            d(0x71),
            d(0x72),
            design,
            d(0x73),
            roles(),
        )
        .expect("R&D publishes the Design's roles"),
    )
}

/// `design`'s roles, admitted over `run` in one Owner transaction that commits only on success.
async fn admit(
    owner: &MarketDataOwnerPostgres,
    design: BindingDigest,
    run: UntrustedPitWindowRunV1,
) -> Result<StrategyInputBindingAdmissionTerminalV1, StrategyInputBindingAdmissionErrorV1> {
    let mut transaction = owner.pool().begin().await.unwrap();
    let outcome = Box::pin(register_custody_design_roles_v1(
        &mut transaction,
        authenticated(design),
        &roles(),
        run,
    ))
    .await;

    if outcome.is_ok() {
        transaction.commit().await.unwrap();
    } else {
        transaction.rollback().await.unwrap();
    }
    outcome
}

async fn declarations(owner: &MarketDataOwnerPostgres) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM market_data_private.strategy_input_binding_declarations_v1",
    )
    .fetch_one(owner.pool())
    .await
    .unwrap()
}

/// A Design declared over a run pinned at the chain's root composes over the root's first frame
/// view and rejoins after a correction moved the head, because the declaration re-reads at the
/// head that holds it. Pinned at the moved head, the same Design declares again over the corrected
/// view, at that view's own coordinate.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_custody_design_declares_once_at_its_pinned_head_and_survives_a_correction() {
    let owner = owner().await;
    let (root, head, fixture_run) = corrected_custody_chain_fixture_v1(&owner).await;
    // The fixture's correction changes its run's second frame, so this run starts there: its first
    // frame reads one view at the root and another at the corrected head.
    let second_frame = owner
        .pit_window_custody_frames_v1()
        .resolve_pit_window_frames_v1(fixture_run)
        .await
        .expect("the fixture's run reads")
        .frames()[1]
        .event_ns();
    let run = UntrustedPitWindowRunV1 {
        run_start_ns: second_frame,
        ..fixture_run
    };
    let pinned = |head_identity| UntrustedPitWindowRunV1 {
        head_identity: Some(head_identity),
        ..run
    };
    let before = declarations(&owner).await;

    let design = d(0x67);
    let terminal = admit(&owner, design, pinned(root.custody_identity()))
        .await
        .expect("the Design declares over the root's first frame");
    assert_eq!(terminal.design_identity(), design);
    assert_eq!(terminal.role_count(), 2);
    assert_eq!(declarations(&owner).await, before + 2);
    assert_eq!(
        admit(&owner, design, pinned(root.custody_identity())).await,
        Ok(terminal),
        "re-admission rejoins, re-reading at the root although the head moved"
    );
    assert_eq!(
        declarations(&owner).await,
        before + 2,
        "a rejoin writes nothing"
    );

    // A Design runs over more than one run: over another view it is another declaration, at that
    // view's coordinate, and the first is untouched.
    let corrected = admit(&owner, design, pinned(head.custody_identity()))
        .await
        .expect("the Design declares over the corrected view too");
    assert_ne!(
        corrected.pit_request_identity(),
        terminal.pit_request_identity(),
        "the correction changed the first frame's view"
    );
    assert_eq!(declarations(&owner).await, before + 4);
    assert_eq!(
        admit(&owner, design, pinned(root.custody_identity())).await,
        Ok(terminal)
    );
    assert_eq!(
        admit(&owner, design, pinned(head.custody_identity())).await,
        Ok(corrected)
    );
    assert_eq!(declarations(&owner).await, before + 4);
}

/// An unpinned run, a run over no chain and a run over a foreign head are each refused by name,
/// and none writes a declaration.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_every_custody_design_refusal_writes_nothing() {
    let owner = owner().await;
    let (root, _, run) = corrected_custody_chain_fixture_v1(&owner).await;
    let before = declarations(&owner).await;
    let unavailable = Err(StrategyInputBindingAdmissionErrorV1::BindingUnavailable {
        cause: "CUSTODY_RUN_UNAVAILABLE",
    });

    assert_eq!(
        admit(&owner, d(0x67), run).await,
        Err(StrategyInputBindingAdmissionErrorV1::BindingUnavailable {
            cause: "CUSTODY_HEAD_UNPINNED",
        })
    );
    assert_eq!(
        admit(
            &owner,
            d(0x67),
            UntrustedPitWindowRunV1 {
                custody: UntrustedPitWindowCustodyClaimV1 {
                    chain_root: d(0x99)
                },
                head_identity: Some(root.custody_identity()),
                ..run
            },
        )
        .await,
        unavailable
    );
    assert_eq!(
        admit(
            &owner,
            d(0x67),
            UntrustedPitWindowRunV1 {
                head_identity: Some(d(0x98)),
                ..run
            },
        )
        .await,
        unavailable
    );
    assert_eq!(declarations(&owner).await, before);
}

/// A request composed over the root's first frame view but stating another view, Universe
/// Selection record, Instrument Master key, Market Semantics fact or Source Binding than the chain
/// is refused, by name where the chain basis names it, and writes nothing.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_custody_request_disagreeing_with_its_chain_is_refused_by_name() {
    type Mutation = fn(&mut UntrustedStrategyInputBindingRequest);

    let owner = owner().await;
    let (root, _, run) = corrected_custody_chain_fixture_v1(&owner).await;
    let read = owner
        .pit_window_custody_frames_v1()
        .resolve_pit_window_frames_v1(UntrustedPitWindowRunV1 {
            head_identity: Some(root.custody_identity()),
            ..run
        })
        .await
        .expect("the run reads at the root");
    let frame = UntrustedPitWindowCustodyFrameV1 {
        custody: run.custody,
        head_identity: read.head_identity(),
        event_ns: read.frames()[0].event_ns(),
    };
    let design = authenticated(d(0x69));
    let roles = roles();
    let mut transaction = owner.pool().begin().await.unwrap();
    let (batch, _) = read_custody_frame_batch_v1(&mut transaction, &frame)
        .await
        .expect("the root's first frame view seals");
    transaction.rollback().await.unwrap();
    let composed = compose_binding_request_v1(design, &roles[0], &batch).unwrap();
    let before = declarations(&owner).await;
    let cases: [(Mutation, Option<Registry>); 5] = [
        (
            |request| {
                if let StrategyInputBatchSourceV1::CustodyView { view_identity, .. } =
                    &mut request.source
                {
                    *view_identity = d(0x90);
                }
            },
            Some(Registry::PitUnavailable),
        ),
        (
            |request| request.universe_selection_digest = d(0x91),
            Some(Registry::UniverseUnavailable),
        ),
        (
            |request| request.instrument_master_digest = d(0x92),
            Some(Registry::InstrumentMasterBatchDigestUnavailable),
        ),
        (
            |request| request.market_semantics_identity = d(0x93),
            Some(Registry::MarketSemanticsUnavailable),
        ),
        (|request| request.source_binding_identity = d(0x94), None),
    ];

    for (mutate, expected) in cases {
        let mut request = composed.clone();
        mutate(&mut request);
        let mut transaction = owner.pool().begin().await.unwrap();
        let refused = register_authenticated_role_declarations_v1(
            &mut transaction,
            design,
            &roles[..1],
            &[request],
        )
        .await
        .expect_err("a request disagreeing with its chain is refused");
        transaction.rollback().await.unwrap();

        if let Some(expected) = expected {
            assert_eq!(refused, expected);
        }
    }
    let mut transaction = owner.pool().begin().await.unwrap();
    register_authenticated_role_declarations_v1(&mut transaction, design, &roles[..1], &[composed])
        .await
        .expect("the request as composed registers");
    transaction.rollback().await.unwrap();
    assert_eq!(declarations(&owner).await, before);
}
