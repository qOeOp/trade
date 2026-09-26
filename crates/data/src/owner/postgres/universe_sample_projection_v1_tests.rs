//! A universe-member composition's initial frame gets one sample projection, issued by the Owner
//! operation R&D calls, over a real Owner store.

use super::{
    replay_market_facts_v2::universe_issuance::postgres_tests::UniverseMemberIssuanceFixtureV1,
    universe_sample_projection_v1::{
        UniverseSampleProjectionIssuanceErrorV1, UniverseSampleProjectionScopeV1,
    },
};
use crate::owner::{
    bar_schedule::{
        BarScheduleCompletionV1, BarScheduleKindV1, BarScheduleLabelV1, BarScheduleUnitV1,
        UntrustedBarScheduleProposalV1, prepare_bar_schedule_commit_v1,
    },
    native_replay_scheduling_v1::{
        NativeReplayInitialMarketRequestV1, NativeReplayInitialUniverseRoleV1,
        native_replay_universe_binding_requests_v1,
    },
    replay_market_facts_v2::ReplayCompositionBindingLocatorV1,
    sample_fact::{
        SampleFactHeadsV1, prepare_bar_timeframe_projection_v1, prepare_sample_commit_v1,
    },
    source_binding::BindingDigest,
    strategy_input_binding::bind_strategy_input_universe_frame,
    universe_sample_projection_v1::UniverseSampleProjectionLifecycleV1,
};

const SEALED_REQUEST: &str = "universe-sample-projection-replay-v1";

fn d(value: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([value; 32])
}

/// Rows in every table the issuance can write: its own, and every sample custody table.
async fn projection_state(pool: &sqlx::PgPool) -> Vec<i64> {
    let mut counts = Vec::new();

    for query in [
        "SELECT COUNT(*) FROM market_data_private.universe_sample_projections_v1",
        "SELECT COUNT(*) FROM market_data_private.universe_sample_projection_outbox_v1",
        "SELECT COUNT(*) FROM market_data_private.universe_sample_projection_issuances_v1",
        "SELECT COUNT(*) FROM market_data_private.universe_sample_projection_issued_frames_v1",
        "SELECT COUNT(*) FROM market_data_private.timeframe_projection_receipts_v1",
        "SELECT COUNT(*) FROM market_data_private.sample_facts_v1",
        "SELECT COUNT(*) FROM market_data_private.sample_receipts_v1",
        "SELECT COUNT(*) FROM market_data_private.sample_outbox_v1",
        "SELECT COUNT(*) FROM market_data_private.sample_series_heads_v1",
        "SELECT COUNT(*) FROM market_data_private.sample_correction_heads_v1",
        "SELECT COUNT(*) FROM market_data_private.sample_projection_attachments_v1",
    ] {
        counts.push(sqlx::query_scalar(query).fetch_one(pool).await.unwrap());
    }
    counts
}

fn delta(after: &[i64], before: &[i64]) -> Vec<i64> {
    after.iter().zip(before).map(|(a, b)| a - b).collect()
}

/// One universe frame, one projection, over the frame the host admits.
///
/// - While the member has no BAR schedule at the frame, the issuance is refused by name as
///   `ScheduleUnavailable` and writes nothing.
/// - A frame that already holds a different projection is refused by name as `SubjectConflict`
///   and writes nothing; a stored projection that does not verify reads back as an error, never as
///   absent.
/// - Once the member's schedule is admitted, the issuance writes one projection, outbox, issuance
///   and issued frame, and a timeframe projection and an attachment for each of the Design's two
///   member bindings, and no sample: both roles read the row the exact 1M close binding already
///   sampled in the same snapshot, so all three bindings share that one sample and no head moves.
/// - The projection's subject is the frame the binding sealed and the frame the host's own request
///   builder binds, byte for byte; it is a BAR projection with a schedule set, and each component's
///   coordinate verifies.
/// - An exact retry returns the stored bytes and appends nothing; the same request under another
///   binding is refused by name as `BindingConflict` and writes nothing.
/// - The exact-subject resolver reads the projection by its frame, and nothing for another frame.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
#[allow(clippy::too_many_lines)]
async fn postgres_a_universe_frame_issues_one_sample_projection_over_the_host_frame() {
    let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap();
    let fixture = Box::pin(UniverseMemberIssuanceFixtureV1::issue(&owner_url)).await;
    let market = &fixture.market;
    let pool = &fixture.pool;
    let base = &fixture.base;
    let binding = fixture.binding_locator;
    let issue = async |binding: ReplayCompositionBindingLocatorV1| {
        market
            .issue_universe_sample_projections_v1(
                SEALED_REQUEST,
                binding,
                UniverseSampleProjectionScopeV1::InitialFrame,
            )
            .await
    };

    // The frame the binding sealed, and the frame the host's own request builder binds.
    let sealed_frame = {
        let mut transaction = pool.begin().await.unwrap();
        let readback =
            crate::owner::replay_market_facts_v2::postgres::recover_replay_composition_binding_in_transaction_v1(
                &mut transaction,
                binding,
            )
            .await
            .unwrap();
        transaction.rollback().await.unwrap();
        readback.record().universe_frame_digest().unwrap()
    };
    let host_request = NativeReplayInitialMarketRequestV1::new(
        base.batch.snapshot_identity(),
        base.batch.fact_digest(),
        fixture.requests[0].research_request_identity,
        fixture.requests[0].strategy_design_identity,
        crate::owner::strategy_input_binding::derive_universe_selection(&base.batch)
            .unwrap()
            .selection_identity(),
        base.batch.universe_selection_digest(),
        base.batch.instrument_master_digest(),
        base.batch.source_binding_lineage_root(),
        base.batch.market_semantics_identity(),
        fixture
            .requests
            .iter()
            .map(|request| {
                NativeReplayInitialUniverseRoleV1::new(
                    request.input_role_identity,
                    request.field_semantic,
                    request.channel,
                    request.timeframe.clone(),
                    request.unit,
                    request.scale,
                )
            })
            .collect(),
        // The members' native instruments name the host's bars and schedules, not the frame: the
        // binding requests the frame is bound from carry none of them.
        Vec::new(),
        50,
        51,
    );
    let host_frame = bind_strategy_input_universe_frame(
        &native_replay_universe_binding_requests_v1(&host_request, &base.batch),
        &base.batch,
    )
    .expect("the host's builder binds the frame");
    assert_eq!(
        host_frame.digest(),
        sealed_frame,
        "the host admits the frame the binding sealed"
    );

    // No schedule for the member at the frame: refused by name, nothing written.
    let before = projection_state(pool).await;
    assert_eq!(
        issue(binding).await,
        Err(UniverseSampleProjectionIssuanceErrorV1::ScheduleUnavailable)
    );
    assert_eq!(
        projection_state(pool).await,
        before,
        "the refusal writes nothing"
    );

    // The member's minute schedule, and the row's sample under the exact 1M close binding. The
    // member is the one instrument of the fixture's Instrument Master cut, read from it rather than
    // named again here.
    let [member_fact] = base.instrument.facts() else {
        panic!("the fixture's Instrument Master cut holds one instrument");
    };
    let member = member_fact.canonical_identity().to_owned();
    let exact_close = &base.bindings[3];
    let minute = UntrustedBarScheduleProposalV1 {
        canonical_instrument: member.clone(),
        predecessor_fact_digest: None,
        effective_from: 1,
        effective_until: Some(200),
        kind: BarScheduleKindV1::FixedInterval,
        step: 1,
        unit: BarScheduleUnitV1::Minute,
        anchor_identity: d(206),
        label: BarScheduleLabelV1::IntervalClose,
        completion: BarScheduleCompletionV1::CompleteOnly,
    };
    let schedule = market
        .commit_prepared_bar_schedule_v1(
            &prepare_bar_schedule_commit_v1(
                minute,
                exact_close,
                &base.batch,
                &base.instrument,
                &base.instrument,
            )
            .unwrap(),
        )
        .await
        .expect("the member's minute schedule");
    let exact_sample = market
        .commit_prepared_sample_v1(
            &prepare_sample_commit_v1(
                exact_close,
                &base.batch,
                &prepare_bar_timeframe_projection_v1(exact_close, &base.batch, &schedule).unwrap(),
                SampleFactHeadsV1 {
                    series: None,
                    slot: None,
                },
            )
            .unwrap(),
        )
        .await
        .expect("the exact binding's sample of the row");

    // A frame already holding a different projection is refused by name, and writes nothing; the
    // unverifiable stored row reads back as an error, not as absent.
    sqlx::query("INSERT INTO market_data_private.universe_sample_projections_v1(projection_identity,subject_identity,projection_bytes) VALUES ($1,$2,$3)")
        .bind(d(0xE1).as_bytes().as_slice())
        .bind(sealed_frame.as_bytes().as_slice())
        .bind([1_u8].as_slice())
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO market_data_private.universe_sample_projection_outbox_v1(outbox_identity,payload_bytes) VALUES ($1,$2)")
        .bind(d(0xE1).as_bytes().as_slice())
        .bind([1_u8].as_slice())
        .execute(pool)
        .await
        .unwrap();
    let occupied = projection_state(pool).await;
    assert_eq!(
        issue(binding).await,
        Err(UniverseSampleProjectionIssuanceErrorV1::SubjectConflict)
    );
    assert_eq!(
        projection_state(pool).await,
        occupied,
        "the refusal writes nothing"
    );
    assert_eq!(
        market
            .resolve_universe_sample_projection_by_subject_v1(sealed_frame)
            .await,
        Err(UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable)
    );
    // Moved to another frame, the unverifiable row stays an error there and frees this frame.
    sqlx::query("UPDATE market_data_private.universe_sample_projections_v1 SET subject_identity=$1 WHERE projection_identity=$2")
        .bind(d(0xE5).as_bytes().as_slice())
        .bind(d(0xE1).as_bytes().as_slice())
        .execute(pool)
        .await
        .unwrap();

    // The issuance: one projection over the sealed frame, reusing the row's sample.
    let before = projection_state(pool).await;
    let issued = issue(binding)
        .await
        .expect("the initial frame's projection");
    let after = projection_state(pool).await;
    assert_eq!(
        delta(&after, &before),
        [1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 2],
        "one projection, outbox, issuance and issued frame; a timeframe projection and an \
         attachment for each of the two member bindings; and no sample"
    );
    let [projection] = &issued[..] else {
        panic!("the initial frame has one projection: {issued:?}");
    };
    assert_eq!(projection.subject(), sealed_frame);
    assert_eq!(
        projection.lifecycle(),
        UniverseSampleProjectionLifecycleV1::Bar
    );
    assert!(projection.schedule_dependency_set_digest().is_some());
    assert_eq!(projection.components().len(), host_frame.values().len());

    for (component, value) in projection.components().iter().zip(host_frame.values()) {
        assert_eq!(component.member_ordinal(), 0);
        assert_eq!(component.instrument(), member);
        assert_eq!(component.input_role_identity(), value.input_role_identity());
        assert_eq!(component.member_binding_digest(), value.binding_digest());
        assert_eq!(component.value_receipt_digest(), value.digest());
        assert_eq!(component.trigger_digest(), host_frame.trigger().digest());
        assert_eq!(
            projection.component(0, value.input_role_identity()),
            Some(component)
        );
    }

    for component in projection.components() {
        assert_eq!(
            component.sample_identity().as_bytes(),
            &exact_sample.fact().sample_identity(),
            "every member binding reads the exact binding's sample of the same row"
        );
        assert_eq!(
            component.sample_receipt_digest().as_bytes(),
            &exact_sample.receipt().digest()
        );
    }
    assert_eq!(
        crate::owner::universe_sample_projection_v1::StrategyInputUniverseSampleProjectionReadbackV1::decode(
            projection.identity(),
            projection.canonical_bytes(),
        )
        .as_ref(),
        Ok(projection),
        "the stored bytes decode to the issued projection"
    );

    // A retry returns the stored bytes; another binding under the key is refused; neither writes.
    assert_eq!(issue(binding).await.as_deref(), Ok(&issued[..]));
    assert_eq!(
        projection_state(pool).await,
        after,
        "a retry appends nothing"
    );
    assert_eq!(
        issue(ReplayCompositionBindingLocatorV1::from_untrusted(
            d(0xE2),
            d(0xE3)
        ))
        .await,
        Err(UniverseSampleProjectionIssuanceErrorV1::BindingConflict)
    );
    assert_eq!(
        projection_state(pool).await,
        after,
        "the refusal writes nothing"
    );

    // The exact-subject resolver reads it by its frame, and nothing for another frame.
    assert_eq!(
        market
            .resolve_universe_sample_projection_by_subject_v1(sealed_frame)
            .await,
        Ok(Some(projection.clone()))
    );
    assert_eq!(
        market
            .resolve_universe_sample_projection_by_subject_v1(d(0xE4))
            .await,
        Ok(None)
    );
    assert_eq!(
        market
            .resolve_universe_sample_projection_by_subject_v1(d(0xE5))
            .await,
        Err(UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable),
        "a stored projection that does not verify is an error, never absent"
    );
}
