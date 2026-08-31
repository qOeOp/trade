use std::{collections::BTreeSet, env};

use rstest::rstest;
use sqlx::{PgPool, Row, postgres::PgPoolOptions};

use super::*;
use crate::owner::{
    bar_schedule::{
        BarScheduleResolverV1, UntrustedBarScheduleLocatorV1, prepare_bar_schedule_commit_v1,
    },
    instrument_master::{
        BACKTEST_OWNER_V1, InstrumentClass, InstrumentDecimal, InstrumentMasterError,
        InstrumentMasterFactProposalV1, InstrumentMasterResolver, InstrumentMasterScopeV1,
        InstrumentMasterUniverseMembershipResolver, InstrumentMasterUniverseMembershipV1,
        InstrumentVenueSourceMapping, UntrustedInstrumentMasterRequestV1, membership_seal,
    },
    pit_snapshot::{
        PitSnapshotOwnerResolver, UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
        UntrustedPitSnapshotEvidence, UntrustedPitSnapshotProposal, UntrustedPitSnapshotRequest,
        UntrustedPitSnapshotTimeEvidence, UntrustedProviderAvailableTime, UntrustedRetrievalTime,
        UntrustedSnapshotDecisionCut,
        authority::{TestOnlyCanonicalBasisResolver, refresh_request_claims},
    },
    research_pit_terminal::{
        ResearchPitDisposition, ResearchPitTerminalResolver, UntrustedResearchPitTerminalRequest,
        derive_license_binding_digest, derive_provenance_binding_digest,
        derive_snapshot_correction_rule_digest,
    },
    sample_fact::{
        SampleFactHeadsV1, prepare_bar_timeframe_projection_v1, prepare_sample_commit_v1,
    },
    sample_projection::{
        PreparedStrategyInputSampleProjectionV2, PreparedStrategyInputSampleProjectionV3,
        StrategyInputSampleProjectionSourceV2, StrategyInputSampleProjectionSourceV3,
        prepare_strategy_input_sample_projection_bar_v3,
        prepare_strategy_input_sample_projection_frame_v2,
    },
    source_binding::{
        SourceBindingBlocker, SourceBindingOwnerResolver, UntrustedAdapterBinding,
        UntrustedCompleteFrontier, UntrustedCredentialAudienceClaim,
        UntrustedCredentialCapabilityClaim, UntrustedLicensePolicy, UntrustedMarketDataAsOf,
        UntrustedMarketSemantics, UntrustedOpaqueCredentialHandle, UntrustedSourceBindingProposal,
        UntrustedTrustPolicy,
        authority::{
            OwnerSourceBindingDecision, SourceBindingCommit, derive_binding_id,
            derive_time_evidence_identity,
        },
    },
};

const ADMIN_URL: &str = "MARKET_DATA_ADMIN_TEST_DATABASE_URL";
const OWNER_URL: &str = "MARKET_DATA_OWNER_TEST_DATABASE_URL";
const READER_URL: &str = "MARKET_DATA_READER_TEST_DATABASE_URL";
const DATABASE_NAME: &str = "VIBE_POSTGRES_TEST_DATABASE_NAME";
const MARKER: &str = "VIBE_POSTGRES_TEST_INSTANCE_MARKER";
const OWNER_ROLE: &str = "vibe_test_role_market_data_owner";
const READER_ROLE: &str = "vibe_test_role_market_data_reader";

fn d(byte: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([byte; 32])
}

fn clock(cut: u64, sequence: u64) -> MarketDataClockAdmission {
    shared_clock("market-clock", "epoch-1", sequence, cut, d(7), 1, 2)
}

fn shared_clock(
    clock_identity: &str,
    epoch: &str,
    sequence: u64,
    cut: u64,
    continuity: BindingDigest,
    uncertainty: u64,
    skew: u64,
) -> MarketDataClockAdmission {
    MarketDataClockAdmission::seal_for_test(
        clock_identity,
        epoch,
        sequence,
        cut,
        cut,
        cut + 60,
        continuity,
        uncertainty,
        skew,
    )
}

fn source_proposal(sequence: u64, cut: u64) -> UntrustedSourceBindingProposal {
    let successor = sequence > 10;
    let mut proposal = UntrustedSourceBindingProposal {
        claimed_binding_id: d(0),
        schema_version: 1,
        adapter: UntrustedAdapterBinding {
            implementation_digest: d(1),
            configuration_digest: d(2),
            authenticated_endpoint_identity: "https://market.example/v1".into(),
            dataset_mapping: "dataset/trades".into(),
            account_mapping: "tenant/entitlement".into(),
        },
        credential_handle: UntrustedOpaqueCredentialHandle::from_untrusted_identity(
            d(6),
            UntrustedCredentialAudienceClaim::MarketData,
            [
                UntrustedCredentialCapabilityClaim::MarketDataRead,
                UntrustedCredentialCapabilityClaim::ReferenceDataRead,
                UntrustedCredentialCapabilityClaim::MetadataRead,
            ],
        ),
        trust_policy: UntrustedTrustPolicy {
            identity: "trust-policy".into(),
            version: 1,
        },
        semantics: UntrustedMarketSemantics {
            normalization: "normalization-v1".into(),
            adjustment: "raw-v1".into(),
            price_meaning: "quote-currency-per-base-v1".into(),
            calendar_rules: "calendar-v1".into(),
            session_rules: "session-v1".into(),
            timezone_rules: "iana-2026a".into(),
            instrument_lifecycle_rules: "instrument-lifecycle-v1".into(),
            corporate_action_rules: "corporate-actions-v1".into(),
            membership_rules: "historical-membership-v1".into(),
            universe_rules: "requester-rule-evaluation-v1".into(),
            correction_policy: "successor-only-v1".into(),
        },
        license: UntrustedLicensePolicy {
            use_scope: "acquire-cache-archive-backtest-model-display".into(),
            redistribution_scope: "derived-only".into(),
            retention_policy: "retain-30d-delete-v1".into(),
            redaction_policy: "no-licensed-payload-v1".into(),
        },
        source_frontier: UntrustedCompleteFrontier {
            stream_identity: "source-stream".into(),
            cut_identity: if successor {
                "source-cut-12"
            } else {
                "source-cut-10"
            }
            .into(),
            sequence,
            digest: if successor { d(8) } else { d(3) },
        },
        correction_frontier: UntrustedCompleteFrontier {
            stream_identity: "correction-stream".into(),
            cut_identity: format!(
                "correction-cut-{}",
                if successor { sequence } else { sequence + 1 }
            ),
            sequence: if successor { sequence } else { sequence + 1 },
            digest: if successor { d(9) } else { d(4) },
        },
        time_evidence: UntrustedMarketDataAsOf {
            claimed_evidence_identity: d(0),
            clock_identity: "market-clock".into(),
            clock_epoch: "epoch-1".into(),
            monotonic_sequence: if successor { 2 } else { 1 },
            restart_continuity_digest: d(7),
            skew_bound: 2,
            uncertainty_bound: 1,
            event_effective: 10,
            provider_available: if successor { 45 } else { 20 },
            retrieval: if successor { 49 } else { 30 },
            correction_publication: if successor { 49 } else { 25 },
            observed_at: cut,
            effective_at: cut,
            valid_through: cut + 60,
        },
    };
    proposal.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&proposal.time_evidence);
    proposal.claimed_binding_id = derive_binding_id(&proposal);
    proposal
}

fn pit_time(cut: u64, sequence: u64) -> UntrustedPitSnapshotTimeEvidence {
    UntrustedPitSnapshotTimeEvidence {
        event_effective: UntrustedEventEffectiveTime::from_untrusted(10, "market-clock", "epoch-1"),
        provider_available: UntrustedProviderAvailableTime::from_untrusted(
            20,
            "market-clock",
            "epoch-1",
        ),
        retrieval: UntrustedRetrievalTime::from_untrusted(30, "market-clock", "epoch-1"),
        correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
            25,
            "market-clock",
            "epoch-1",
        )),
        decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(cut, "market-clock", "epoch-1"),
        monotonic_sequence: sequence,
        restart_continuity_digest: d(7),
        skew_bound: 2,
        uncertainty_bound: 1,
        observed_at: cut,
        valid_through: cut + 60,
    }
}

fn pit_proposal(source: &SourceBindingCommit) -> UntrustedPitSnapshotProposal {
    let locator = source.receipt().locator();
    let mut request = UntrustedPitSnapshotRequest {
        claimed_request_identity: d(0),
        claimed_request_digest: d(0),
        correlation_identity: d(20),
        requester_identity: d(19),
        scope_digest: d(21),
        source_binding: locator.clone(),
        instrument_master_digest: d(22),
        universe_selection_digest: d(23),
        market_semantics_identity: d(24),
        time_evidence: pit_time(40, 1),
    };
    refresh_request_claims(&mut request);
    UntrustedPitSnapshotProposal {
        request,
        evidence: UntrustedPitSnapshotEvidence {
            normalized_records_digest: d(25),
            source_frontier: locator.source_frontier.clone(),
            correction_frontier: locator.correction_frontier.clone(),
            coverage_complete: true,
            semantics_compatible: true,
            source_available: true,
        },
    }
}

fn distinct_pit_proposal(
    source: &SourceBindingCommit,
    identity_byte: u8,
) -> UntrustedPitSnapshotProposal {
    let mut value = pit_proposal(source);
    value.request.correlation_identity = d(identity_byte);
    value.request.scope_digest = d(identity_byte.wrapping_add(1));
    refresh_request_claims(&mut value.request);
    value
}

fn basis(value: &UntrustedPitSnapshotProposal) -> TestOnlyCanonicalBasisResolver {
    basis_at(value, &clock(40, 1))
}

fn basis_at(
    value: &UntrustedPitSnapshotProposal,
    clock: &MarketDataClockAdmission,
) -> TestOnlyCanonicalBasisResolver {
    TestOnlyCanonicalBasisResolver::seal_for_test(
        value.request.clone(),
        value.evidence.clone(),
        clock.clone(),
    )
}

fn pit_correction(
    initial: &UntrustedPitSnapshotProposal,
    source: &SourceBindingCommit,
) -> UntrustedPitSnapshotProposal {
    let mut value = initial.clone();
    value.request.source_binding = source.receipt().locator().clone();
    value.request.time_evidence = UntrustedPitSnapshotTimeEvidence {
        event_effective: UntrustedEventEffectiveTime::from_untrusted(10, "market-clock", "epoch-1"),
        provider_available: UntrustedProviderAvailableTime::from_untrusted(
            45,
            "market-clock",
            "epoch-1",
        ),
        retrieval: UntrustedRetrievalTime::from_untrusted(49, "market-clock", "epoch-1"),
        correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
            49,
            "market-clock",
            "epoch-1",
        )),
        decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(50, "market-clock", "epoch-1"),
        monotonic_sequence: 2,
        restart_continuity_digest: d(7),
        skew_bound: 2,
        uncertainty_bound: 1,
        observed_at: 50,
        valid_through: 110,
    };
    value.evidence.normalized_records_digest = d(26);
    value.evidence.source_frontier = source.fact().source_frontier().clone();
    value.evidence.correction_frontier = source.fact().correction_frontier().clone();
    refresh_request_claims(&mut value.request);
    value
}

fn source_third_proposal() -> UntrustedSourceBindingProposal {
    let mut value = source_proposal(12, 50);
    value.source_frontier.cut_identity = "source-cut-13".into();
    value.source_frontier.sequence = 13;
    value.source_frontier.digest = d(10);
    value.correction_frontier.cut_identity = "correction-cut-13".into();
    value.correction_frontier.sequence = 13;
    value.correction_frontier.digest = d(11);
    value.time_evidence.monotonic_sequence = 3;
    value.time_evidence.provider_available = 55;
    value.time_evidence.retrieval = 59;
    value.time_evidence.correction_publication = 59;
    value.time_evidence.observed_at = 60;
    value.time_evidence.effective_at = 60;
    value.time_evidence.valid_through = 120;
    value.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&value.time_evidence);
    value.claimed_binding_id = derive_binding_id(&value);
    value
}

fn pit_third_correction(
    second: &UntrustedPitSnapshotProposal,
    source: &SourceBindingCommit,
) -> UntrustedPitSnapshotProposal {
    let mut value = second.clone();
    value.request.source_binding = source.receipt().locator().clone();
    value.request.time_evidence.provider_available =
        UntrustedProviderAvailableTime::from_untrusted(55, "market-clock", "epoch-1");
    value.request.time_evidence.retrieval =
        UntrustedRetrievalTime::from_untrusted(59, "market-clock", "epoch-1");
    value.request.time_evidence.correction_publication = Some(
        UntrustedCorrectionPublicationTime::from_untrusted(59, "market-clock", "epoch-1"),
    );
    value.request.time_evidence.decision_cut =
        UntrustedSnapshotDecisionCut::from_untrusted(60, "market-clock", "epoch-1");
    value.request.time_evidence.monotonic_sequence = 3;
    value.request.time_evidence.observed_at = 60;
    value.request.time_evidence.valid_through = 120;
    value.evidence.normalized_records_digest = d(30);
    value.evidence.source_frontier = source.fact().source_frontier().clone();
    value.evidence.correction_frontier = source.fact().correction_frontier().clone();
    refresh_request_claims(&mut value.request);
    value
}

async fn guarded_pools() -> (String, String, PgPool) {
    let database = env::var(DATABASE_NAME).expect("explicit disposable database name");
    let marker = env::var(MARKER).expect("explicit disposable marker");
    assert!(database.starts_with("vibe_test_"));
    assert!(!marker.is_empty());
    let admin_url = env::var(ADMIN_URL).expect("explicit disposable admin URL");
    let owner_url = env::var(OWNER_URL).expect("explicit disposable Owner URL");
    let reader_url = env::var(READER_URL).expect("explicit disposable reader URL");
    let admin = PgPoolOptions::new()
        .max_connections(2)
        .connect(&admin_url)
        .await
        .unwrap();

    for (url, expected_role) in [(&owner_url, OWNER_ROLE), (&reader_url, READER_ROLE)] {
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect(url)
            .await
            .unwrap();
        let row = sqlx::query("SELECT current_database() AS database, current_user AS role, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls, (SELECT marker_identity FROM public.vibe_test_instance_marker) AS marker FROM pg_roles AS r WHERE r.rolname=current_user")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(row.get::<String, _>("database"), database);
        assert_eq!(row.get::<String, _>("role"), expected_role);
        assert_eq!(row.get::<String, _>("marker"), marker);

        for capability in [
            "rolsuper",
            "rolcreatedb",
            "rolcreaterole",
            "rolreplication",
            "rolbypassrls",
        ] {
            assert!(!row.get::<bool, _>(capability));
        }
        assert!(
            sqlx::query("UPDATE public.vibe_test_instance_marker SET marker_identity='forged'")
                .execute(&pool)
                .await
                .is_err()
        );
        pool.close().await;
    }
    (owner_url, reader_url, admin)
}

async fn grant_reader(admin: &PgPool) {
    sqlx::query("GRANT USAGE ON SCHEMA market_data_private TO vibe_test_role_market_data_reader")
        .execute(admin)
        .await
        .unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_source_binding_v1(BYTEA) TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_pit_snapshot_v1(BYTEA) TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_source_lineage_custody_v1(BYTEA) TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_pit_lineage_custody_v1(BYTEA) TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_source_lineage_members_v1(BYTEA) TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_pit_lineage_members_v1(BYTEA) TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_source_lineage_roots_v1() TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_pit_lineage_roots_v1() TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_owner_history_census_custody_v1() TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_clock_handoff_v1(BYTEA) TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_epoch_successor_proof_v1(BYTEA) TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_clock_membership_custody_v1() TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_clock_custody_state_v1() TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_instrument_master_receipt_v1(BYTEA) TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_timeframe_projection_receipt_v1(BYTEA) TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_sample_receipt_v1(BYTEA) TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_strategy_input_sample_projection_v2(BYTEA) TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_bar_schedule_v1(BYTEA) TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_bar_schedule_history_v1(TEXT) TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_strategy_input_sample_projection_v3(BYTEA) TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
    sqlx::query("GRANT EXECUTE ON FUNCTION market_data_private.resolve_strategy_input_sample_projection_schedule_dependencies_v3(BYTEA) TO vibe_test_role_market_data_reader").execute(admin).await.unwrap();
}

fn sample_digest(byte: u8) -> [u8; 32] {
    [byte; 32]
}

#[allow(clippy::too_many_arguments)]
fn prepared_sample(
    sample: u8,
    series: u8,
    series_predecessor: Option<u8>,
    series_sequence: u64,
    slot: u8,
    correction_predecessor: Option<u8>,
    correction_sequence: u64,
    logical_time: u64,
    projection: u8,
) -> PreparedSampleCustodyV1 {
    PreparedSampleCustodyV1::from_verified_contract(
        sample_digest(sample),
        sample_digest(sample.wrapping_add(40)),
        sample_digest(series),
        series_predecessor.map(sample_digest),
        series_sequence,
        sample_digest(slot),
        correction_predecessor.map(sample_digest),
        correction_sequence,
        logical_time,
        series_sequence,
        sample_digest(projection),
        sample_digest(199),
        vec![projection, 1, 2, 3],
        vec![sample, 4, 5, 6],
        sample_digest(sample.wrapping_add(80)),
        vec![sample, 7, 8, 9],
        sample_digest(sample.wrapping_add(100)),
        sample_digest(sample.wrapping_add(120)),
        vec![sample, 10, 11, 12],
    )
}

async fn sample_counts(pool: &PgPool) -> (i64, i64, i64, i64, i64, i64) {
    sqlx::query_as("SELECT (SELECT COUNT(*) FROM market_data_private.sample_facts_v1),(SELECT COUNT(*) FROM market_data_private.sample_receipts_v1),(SELECT COUNT(*) FROM market_data_private.sample_outbox_v1),(SELECT COUNT(*) FROM market_data_private.sample_series_heads_v1),(SELECT COUNT(*) FROM market_data_private.sample_correction_heads_v1),(SELECT COUNT(*) FROM market_data_private.timeframe_projection_receipts_v1)")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn sample_custody_postgres_oracle(owner_url: &str, reader_url: &str, admin: &PgPool) {
    let owner = MarketDataOwnerPostgres::connect(owner_url).await.unwrap();
    let projection_digest = sample_digest(200);
    let projection_binding_digest = sample_digest(199);
    let projection_bytes = [200, 1, 2, 3];
    owner
        .store_timeframe_projection_receipt_v1(
            projection_digest,
            projection_binding_digest,
            &projection_bytes,
        )
        .await
        .unwrap();
    let after_projection = sample_counts(owner.pool()).await;
    owner
        .store_timeframe_projection_receipt_v1(
            projection_digest,
            projection_binding_digest,
            &projection_bytes,
        )
        .await
        .unwrap();
    assert_eq!(sample_counts(owner.pool()).await, after_projection);
    assert_eq!(
        owner
            .store_timeframe_projection_receipt_v1(
                projection_digest,
                projection_binding_digest,
                &[200, 9],
            )
            .await,
        Err(SampleCustodyErrorV1::ProjectionConflict)
    );
    assert_eq!(
        owner
            .store_timeframe_projection_receipt_v1(
                sample_digest(201),
                projection_binding_digest,
                &[201, 1, 2, 3],
            )
            .await,
        Err(SampleCustodyErrorV1::ProjectionConflict)
    );

    let missing_projection = prepared_sample(1, 20, None, 1, 30, None, 1, 10, 201);
    assert_eq!(
        owner.commit_sample_custody_v1(&missing_projection).await,
        Err(SampleCustodyErrorV1::ProjectionConflict)
    );
    assert_eq!(sample_counts(owner.pool()).await, after_projection);

    let first = prepared_sample(1, 20, None, 1, 30, None, 1, 10, 200);
    let first_readback = owner.commit_sample_custody_v1(&first).await.unwrap();
    assert_eq!(first_readback.receipt_digest(), first.receipt_digest);
    assert_eq!(first_readback.exact_receipt_bytes(), first.receipt_bytes);
    let after_first = sample_counts(owner.pool()).await;
    let replay = owner.commit_sample_custody_v1(&first).await.unwrap();
    assert_eq!(replay.exact_receipt_bytes(), first.receipt_bytes);
    assert_eq!(sample_counts(owner.pool()).await, after_first);

    let mut identity_conflict = first.clone();
    identity_conflict.receipt_digest = sample_digest(82);
    identity_conflict.receipt_bytes.push(99);
    assert_eq!(
        owner.commit_sample_custody_v1(&identity_conflict).await,
        Err(SampleCustodyErrorV1::IdentityConflict)
    );
    assert_eq!(sample_counts(owner.pool()).await, after_first);
    let cycle = prepared_sample(9, 20, Some(9), 2, 31, None, 1, 20, 200);
    assert_eq!(
        owner.commit_sample_custody_v1(&cycle).await,
        Err(SampleCustodyErrorV1::InvalidInput)
    );

    let gap = prepared_sample(2, 20, Some(1), 3, 31, None, 1, 20, 200);
    assert_eq!(
        owner.commit_sample_custody_v1(&gap).await,
        Err(SampleCustodyErrorV1::SeriesHeadConflict)
    );
    let regression = prepared_sample(2, 20, Some(1), 2, 31, None, 1, 10, 200);
    assert_eq!(
        owner.commit_sample_custody_v1(&regression).await,
        Err(SampleCustodyErrorV1::SeriesHeadConflict)
    );

    let second = prepared_sample(2, 20, Some(1), 2, 31, None, 1, 20, 200);
    owner.commit_sample_custody_v1(&second).await.unwrap();
    let branch = prepared_sample(3, 20, Some(1), 2, 32, None, 1, 21, 200);
    assert_eq!(
        owner.commit_sample_custody_v1(&branch).await,
        Err(SampleCustodyErrorV1::SeriesHeadConflict)
    );

    let other_series = prepared_sample(10, 21, None, 1, 40, None, 1, 11, 200);
    owner.commit_sample_custody_v1(&other_series).await.unwrap();
    let cross_series = prepared_sample(3, 20, Some(10), 2, 32, None, 1, 22, 200);
    assert_eq!(
        owner.commit_sample_custody_v1(&cross_series).await,
        Err(SampleCustodyErrorV1::SeriesHeadConflict)
    );
    let cross_slot = prepared_sample(3, 20, Some(2), 3, 31, Some(1), 2, 30, 200);
    assert_eq!(
        owner.commit_sample_custody_v1(&cross_slot).await,
        Err(SampleCustodyErrorV1::CorrectionHeadConflict)
    );

    let correction = prepared_sample(3, 20, Some(2), 3, 31, Some(2), 2, 30, 200);
    owner.commit_sample_custody_v1(&correction).await.unwrap();
    let before_rollback = sample_counts(owner.pool()).await;
    let rollback = prepared_sample(4, 20, Some(3), 4, 32, None, 1, 40, 200);
    assert_eq!(
        owner
            .commit_sample_custody_with_fault_v1(
                &rollback,
                SampleCustodyFaultV1::RollbackBeforeHeads,
            )
            .await,
        Err(SampleCustodyErrorV1::CommitInterrupted)
    );
    assert_eq!(sample_counts(owner.pool()).await, before_rollback);
    assert_eq!(
        owner
            .commit_sample_custody_with_fault_v1(&rollback, SampleCustodyFaultV1::ResponseLoss)
            .await,
        Err(SampleCustodyErrorV1::ResponseLost)
    );
    let contract_prepared = crate::owner::sample_fact::tests::prepared_point_event_fixture_v1();
    let contract_receipt_digest = contract_prepared.sample_receipt_digest();
    let contract_readback = owner
        .commit_prepared_sample_v1(&contract_prepared)
        .await
        .unwrap();
    assert_eq!(
        contract_readback.receipt().digest(),
        contract_receipt_digest
    );
    let after_loss = sample_counts(owner.pool()).await;
    drop(owner);

    let restarted = MarketDataOwnerPostgres::connect(owner_url).await.unwrap();
    assert_eq!(sample_counts(restarted.pool()).await, after_loss);
    let historical = restarted
        .resolve_sample_receipt_custody_v1(first.receipt_digest)
        .await
        .unwrap();
    assert_eq!(historical.exact_receipt_bytes(), first.receipt_bytes);
    let recovered = restarted
        .resolve_sample_receipt_custody_v1(rollback.receipt_digest)
        .await
        .unwrap();
    assert_eq!(recovered.exact_receipt_bytes(), rollback.receipt_bytes);
    let contract_historical = restarted
        .resolve_prepared_sample_v1(contract_receipt_digest)
        .await
        .unwrap();
    assert_eq!(
        contract_historical.receipt().digest(),
        contract_receipt_digest
    );

    let reader = MarketDataReadPostgres::connect(reader_url).await.unwrap();
    assert_eq!(
        reader
            .resolve_sample_receipt_custody_v1(first.receipt_digest)
            .await
            .unwrap()
            .exact_receipt_bytes(),
        first.receipt_bytes
    );
    assert!(
        sqlx::query("SELECT * FROM market_data_private.sample_facts_v1")
            .fetch_all(&reader.pool)
            .await
            .is_err()
    );

    for (table, denied_delete) in [
        (
            "timeframe_projection_receipts_v1",
            "DELETE FROM market_data_private.timeframe_projection_receipts_v1",
        ),
        (
            "sample_facts_v1",
            "DELETE FROM market_data_private.sample_facts_v1",
        ),
        (
            "sample_series_heads_v1",
            "DELETE FROM market_data_private.sample_series_heads_v1",
        ),
        (
            "sample_correction_heads_v1",
            "DELETE FROM market_data_private.sample_correction_heads_v1",
        ),
        (
            "sample_receipts_v1",
            "DELETE FROM market_data_private.sample_receipts_v1",
        ),
        (
            "sample_outbox_v1",
            "DELETE FROM market_data_private.sample_outbox_v1",
        ),
    ] {
        for privilege in ["INSERT", "UPDATE", "DELETE"] {
            let admitted: bool = sqlx::query_scalar("SELECT has_table_privilege($1,$2,$3)")
                .bind(READER_ROLE)
                .bind(format!("market_data_private.{table}"))
                .bind(privilege)
                .fetch_one(admin)
                .await
                .unwrap();
            assert!(!admitted);
        }
        assert!(
            sqlx::query(denied_delete)
                .execute(&reader.pool)
                .await
                .is_err()
        );
    }
    let public_execute: bool = sqlx::query_scalar("SELECT has_function_privilege('public','market_data_private.resolve_sample_receipt_v1(bytea)','EXECUTE')")
        .fetch_one(admin).await.unwrap();
    assert!(!public_execute);

    sqlx::query("UPDATE market_data_private.sample_receipts_v1 SET receipt_bytes=$1 WHERE receipt_digest=$2")
        .bind([1_u8, 2, 3].as_slice()).bind(first.receipt_digest.as_slice())
        .execute(restarted.pool()).await.unwrap();
    assert_eq!(
        restarted
            .resolve_sample_receipt_custody_v1(first.receipt_digest)
            .await,
        Err(SampleCustodyErrorV1::StoreUnavailable)
    );
    sqlx::query("UPDATE market_data_private.sample_receipts_v1 SET receipt_bytes=$1 WHERE receipt_digest=$2")
        .bind(&first.receipt_bytes).bind(first.receipt_digest.as_slice())
        .execute(restarted.pool()).await.unwrap();
}

async fn prepared_sample_projection_v2(
    owner: &MarketDataOwnerPostgres,
) -> PreparedStrategyInputSampleProjectionV2 {
    let (missing_binding, missing_frame, missing_timeframe, missing_sample) =
        crate::owner::sample_fact::tests::point_event_projection_fixture_variant_v2(
            777,
            19,
            201,
            BindingDigest::from_untrusted_bytes([91; 32]),
        );
    let missing = prepare_strategy_input_sample_projection_frame_v2(
        &missing_frame,
        &[StrategyInputSampleProjectionSourceV2 {
            binding: &missing_binding,
            timeframe: &missing_timeframe,
            sample: &missing_sample,
        }],
    )
    .unwrap();
    assert_eq!(
        owner
            .commit_strategy_input_sample_projection_v2(&missing)
            .await
            .unwrap_err(),
        SampleProjectionCustodyErrorV2::StoreUnavailable,
    );

    let (binding, frame, timeframe, sample) =
        crate::owner::sample_fact::tests::point_event_projection_fixture_v2();
    prepare_strategy_input_sample_projection_frame_v2(
        &frame,
        &[StrategyInputSampleProjectionSourceV2 {
            binding: &binding,
            timeframe: &timeframe,
            sample: &sample,
        }],
    )
    .unwrap()
}

async fn prepared_bar_sample_projection_v3(
    owner: &MarketDataOwnerPostgres,
    binding: &crate::owner::strategy_input_binding::StrategyInputBindingReceipt,
    frame: &crate::owner::strategy_input_binding::StrategyInputEventFrameReceipt,
    batch: &crate::owner::pit_snapshot::VerifiedPitObservationBatch,
    schedule: &crate::owner::bar_schedule::BarScheduleReadbackV1,
) -> PreparedStrategyInputSampleProjectionV3 {
    let timeframe = prepare_bar_timeframe_projection_v1(binding, batch, schedule)
        .expect("BAR timeframe from sealed durable schedule");
    let prepared_sample = prepare_sample_commit_v1(
        binding,
        batch,
        &timeframe,
        SampleFactHeadsV1 {
            series: None,
            slot: None,
        },
    )
    .expect("BAR sample from sealed durable schedule");
    let stored_sample = owner
        .commit_prepared_sample_v1(&prepared_sample)
        .await
        .expect("durable BAR sample custody");
    prepare_strategy_input_sample_projection_bar_v3(
        frame,
        &[StrategyInputSampleProjectionSourceV3 {
            binding,
            timeframe: &timeframe,
            sample: &stored_sample,
            schedule,
        }],
    )
    .expect("BAR lifecycle projection from durable native sample")
}

async fn sample_projection_count_v2(pool: &PgPool) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM market_data_private.strategy_input_sample_projection_receipts_v2",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn sample_projection_count_v3(pool: &PgPool) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM market_data_private.strategy_input_sample_projection_receipts_v3",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn sample_projection_schedule_dependency_count_v3(pool: &PgPool) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM market_data_private.strategy_input_sample_projection_schedule_dependencies_v3",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn sample_projection_postgres_oracle_v3(owner_url: &str, reader_url: &str, admin: &PgPool) {
    let owner = MarketDataOwnerPostgres::connect(owner_url).await.unwrap();
    let fixture = crate::owner::sample_fact::tests::bar_postgres_schedule_fixture_v1();
    let prepared_schedule = prepare_bar_schedule_commit_v1(
        fixture.schedule_proposal.clone(),
        &fixture.binding,
        &fixture.batch,
        &fixture.instrument_master,
    )
    .expect("prepared BAR schedule");
    let before_schedule: (i64, i64, i64) = sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM market_data_private.bar_schedule_facts_v1),(SELECT COUNT(*) FROM market_data_private.bar_schedule_receipts_v1),(SELECT COUNT(*) FROM market_data_private.bar_schedule_outbox_v1)",
    )
    .fetch_one(owner.pool())
    .await
    .unwrap();
    assert_eq!(
        owner
            .commit_prepared_bar_schedule_with_fault_v1(
                &prepared_schedule,
                BarScheduleCustodyFaultV1::RollbackBeforeCommit,
            )
            .await
            .unwrap_err(),
        BarScheduleCustodyErrorV1::CommitInterrupted,
    );
    assert_eq!(
        sqlx::query_as::<_, (i64, i64, i64)>(
            "SELECT (SELECT COUNT(*) FROM market_data_private.bar_schedule_facts_v1),(SELECT COUNT(*) FROM market_data_private.bar_schedule_receipts_v1),(SELECT COUNT(*) FROM market_data_private.bar_schedule_outbox_v1)",
        )
        .fetch_one(owner.pool())
        .await
        .unwrap(),
        before_schedule,
    );
    assert_eq!(
        owner
            .commit_prepared_bar_schedule_with_fault_v1(
                &prepared_schedule,
                BarScheduleCustodyFaultV1::ResponseLoss,
            )
            .await
            .unwrap_err(),
        BarScheduleCustodyErrorV1::ResponseLost,
    );
    let schedule = owner
        .commit_prepared_bar_schedule_v1(&prepared_schedule)
        .await
        .expect("same request recovers BAR schedule after response loss");
    let schedule_bytes = schedule.canonical_bytes().to_vec();
    let schedule_locator = UntrustedBarScheduleLocatorV1 {
        digest: schedule.digest(),
    };
    let reader = MarketDataReadPostgres::connect(reader_url).await.unwrap();
    assert_eq!(
        reader
            .resolve_bar_schedule_v1(&schedule_locator)
            .await
            .expect("sealed read resolver recovers BAR schedule")
            .canonical_bytes(),
        schedule_bytes,
    );
    assert!(
        sqlx::query("SELECT * FROM market_data_private.bar_schedule_facts_v1")
            .fetch_all(&reader.pool)
            .await
            .is_err()
    );
    assert!(
        sqlx::query("DELETE FROM market_data_private.bar_schedule_receipts_v1")
            .execute(&reader.pool)
            .await
            .is_err()
    );
    let public_schedule_execute: bool = sqlx::query_scalar("SELECT has_function_privilege('public','market_data_private.resolve_bar_schedule_v1(bytea)','EXECUTE')")
        .fetch_one(admin)
        .await
        .unwrap();
    assert!(!public_schedule_execute);
    let public_schedule_history_execute: bool = sqlx::query_scalar("SELECT has_function_privilege('public','market_data_private.resolve_bar_schedule_history_v1(text)','EXECUTE')")
        .fetch_one(admin)
        .await
        .unwrap();
    assert!(!public_schedule_history_execute);
    let prepared = prepared_bar_sample_projection_v3(
        &owner,
        &fixture.binding,
        &fixture.frame,
        &fixture.batch,
        &schedule,
    )
    .await;
    let receipt_digest = prepared.receipt_digest();
    let subject_identity = prepared.subject_identity();
    let receipt_bytes = prepared.canonical_bytes().to_vec();
    assert_eq!(prepared.kind_tag(), 0x01);
    assert_eq!(prepared.lifecycle_tag(), 0x02);
    assert_eq!(prepared.component_count(), 1);
    assert_eq!(receipt_bytes.len(), 42 + 612);
    let initial_count = sample_projection_count_v3(owner.pool()).await;
    let initial_dependency_count =
        sample_projection_schedule_dependency_count_v3(owner.pool()).await;

    assert_eq!(
        owner
            .commit_strategy_input_sample_projection_with_fault_v3(
                &prepared,
                SampleProjectionCustodyFaultV3::RollbackBeforeCommit,
            )
            .await
            .unwrap_err(),
        SampleProjectionCustodyErrorV2::CommitInterrupted,
    );
    assert_eq!(
        sample_projection_count_v3(owner.pool()).await,
        initial_count
    );
    assert_eq!(
        sample_projection_schedule_dependency_count_v3(owner.pool()).await,
        initial_dependency_count
    );
    assert_eq!(
        owner
            .commit_strategy_input_sample_projection_with_fault_v3(
                &prepared,
                SampleProjectionCustodyFaultV3::ResponseLoss,
            )
            .await
            .unwrap_err(),
        SampleProjectionCustodyErrorV2::ResponseLost,
    );
    assert_eq!(
        sample_projection_count_v3(owner.pool()).await,
        initial_count + 1
    );
    assert_eq!(
        sample_projection_schedule_dependency_count_v3(owner.pool()).await,
        initial_dependency_count + 1
    );

    let recovered = owner
        .commit_strategy_input_sample_projection_v3(&prepared)
        .await
        .unwrap();
    assert_eq!(recovered.receipt_digest(), receipt_digest);
    assert_eq!(recovered.lifecycle_tag(), 0x02);
    assert_eq!(recovered.subject_identity(), subject_identity);
    assert_eq!(recovered.canonical_bytes(), receipt_bytes);

    let mut successor_proposal = fixture.schedule_proposal.clone();
    successor_proposal.predecessor_fact_digest = Some(schedule.fact().digest());
    let successor_prepared = prepare_bar_schedule_commit_v1(
        successor_proposal,
        &fixture.binding,
        &fixture.batch,
        &fixture.instrument_master,
    )
    .expect("same BAR shape with successor schedule custody");
    let successor_schedule = owner
        .commit_prepared_bar_schedule_v1(&successor_prepared)
        .await
        .expect("durable successor schedule");
    let alternate_schedule_prepared = prepared_bar_sample_projection_v3(
        &owner,
        &fixture.binding,
        &fixture.frame,
        &fixture.batch,
        &successor_schedule,
    )
    .await;
    assert_eq!(alternate_schedule_prepared.canonical_bytes(), receipt_bytes);
    assert_eq!(
        owner
            .commit_strategy_input_sample_projection_v3(&alternate_schedule_prepared)
            .await
            .unwrap_err(),
        SampleProjectionCustodyErrorV2::IdentityConflict,
    );
    drop(owner);

    let restarted = MarketDataOwnerPostgres::connect(owner_url).await.unwrap();
    assert_eq!(
        restarted
            .resolve_strategy_input_sample_projection_v3(receipt_digest)
            .await
            .unwrap()
            .canonical_bytes(),
        receipt_bytes
    );
    let reader = MarketDataReadPostgres::connect(reader_url).await.unwrap();
    assert_eq!(
        reader
            .resolve_bar_schedule_v1(&schedule_locator)
            .await
            .expect("BAR schedule readback survives restart")
            .canonical_bytes(),
        schedule_bytes,
    );
    assert_eq!(
        reader
            .resolve_strategy_input_sample_projection_v3(receipt_digest)
            .await
            .unwrap()
            .canonical_bytes(),
        receipt_bytes
    );
    let production_evidence =
        StrategyInputSampleProjectionStorageEvidenceV3::from_disposable_postgres(
            reader_url.to_string(),
            receipt_digest,
        )
        .await
        .expect("fixed production V3 snapshot evidence");
    let production_readback =
        verify_admitted_sample_projection_v3(receipt_digest, &production_evidence)
            .expect("complete V3 BAR evidence promotes");
    assert_eq!(production_readback.receipt_digest(), receipt_digest);
    assert_eq!(production_readback.subject_identity(), subject_identity);
    assert_eq!(production_readback.component_count(), 1);
    assert_eq!(production_readback.canonical_bytes(), receipt_bytes);
    assert!(
        StrategyInputSampleProjectionStorageEvidenceV3::from_disposable_postgres(
            reader_url.to_string(),
            sample_digest(253),
        )
        .await
        .is_err()
    );
    assert!(
        sqlx::query(
            "SELECT * FROM market_data_private.strategy_input_sample_projection_receipts_v3",
        )
        .fetch_all(&reader.pool)
        .await
        .is_err()
    );
    assert!(
        sqlx::query("DELETE FROM market_data_private.strategy_input_sample_projection_receipts_v3")
            .execute(&reader.pool)
            .await
            .is_err()
    );
    let public_execute: bool = sqlx::query_scalar("SELECT has_function_privilege('public','market_data_private.resolve_strategy_input_sample_projection_v3(bytea)','EXECUTE')")
        .fetch_one(admin)
        .await
        .unwrap();
    assert!(!public_execute);

    let mut cross_lifecycle_bytes = receipt_bytes.clone();
    cross_lifecycle_bytes[5] = 0x01;
    sqlx::query("UPDATE market_data_private.strategy_input_sample_projection_receipts_v3 SET receipt_bytes=$1 WHERE receipt_digest=$2")
        .bind(&cross_lifecycle_bytes)
        .bind(receipt_digest.as_slice())
        .execute(restarted.pool())
        .await
        .unwrap();
    assert_eq!(
        restarted
            .resolve_strategy_input_sample_projection_v3(receipt_digest)
            .await
            .unwrap_err(),
        SampleProjectionCustodyErrorV2::StoreUnavailable,
    );
    sqlx::query("UPDATE market_data_private.strategy_input_sample_projection_receipts_v3 SET receipt_bytes=$1 WHERE receipt_digest=$2")
        .bind(&receipt_bytes)
        .bind(receipt_digest.as_slice())
        .execute(restarted.pool())
        .await
        .unwrap();
    assert_eq!(
        restarted
            .resolve_strategy_input_sample_projection_v3(receipt_digest)
            .await
            .expect("restored V3 BAR lifecycle")
            .canonical_bytes(),
        receipt_bytes,
    );

    let foreign_schedule_prepared =
        crate::owner::sample_fact::tests::foreign_bar_schedule_commit_v1(
            BindingDigest::from_untrusted_bytes([81; 32]),
            BindingDigest::from_untrusted_bytes([82; 32]),
            BindingDigest::from_untrusted_bytes([83; 32]),
            Some(successor_schedule.fact().digest()),
        );
    let foreign_schedule = restarted
        .commit_prepared_bar_schedule_v1(&foreign_schedule_prepared)
        .await
        .expect("durable internally consistent foreign schedule");
    let original_dependency = &prepared.schedule_dependencies()[0];
    let foreign_dependency = StoredStrategyInputSampleProjectionScheduleDependencyV3 {
        component_ordinal: 0,
        role_identity: original_dependency.role_identity(),
        binding_receipt_digest: original_dependency.binding_receipt_digest(),
        schedule_readback_identity: foreign_schedule.identity(),
        schedule_fact_digest: foreign_schedule.fact().digest(),
        schedule_cut_identity: foreign_schedule.cut.identity,
        schedule_cut_digest: foreign_schedule.cut.identity,
        schedule_receipt_identity: foreign_schedule.receipt_identity(),
    };
    sqlx::query("UPDATE market_data_private.strategy_input_sample_projection_schedule_dependencies_v3 SET schedule_readback_identity=$1,schedule_fact_digest=$2,schedule_cut_identity=$3,schedule_cut_digest=$4,schedule_receipt_identity=$5 WHERE receipt_digest=$6 AND component_ordinal=0")
        .bind(foreign_dependency.schedule_readback_identity.as_bytes().as_slice())
        .bind(foreign_dependency.schedule_fact_digest.as_bytes().as_slice())
        .bind(foreign_dependency.schedule_cut_identity.as_bytes().as_slice())
        .bind(foreign_dependency.schedule_cut_digest.as_bytes().as_slice())
        .bind(foreign_dependency.schedule_receipt_identity.as_bytes().as_slice())
        .bind(receipt_digest.as_slice())
        .execute(restarted.pool())
        .await
        .unwrap();
    let foreign_custody_digest = sample_projection_custody_digest_v3(
        receipt_digest,
        0x01,
        0x02,
        subject_identity,
        1,
        &receipt_bytes,
        &[foreign_dependency],
    );
    sqlx::query("UPDATE market_data_private.strategy_input_sample_projection_receipts_v3 SET custody_digest=$1 WHERE receipt_digest=$2")
        .bind(foreign_custody_digest.as_slice())
        .bind(receipt_digest.as_slice())
        .execute(restarted.pool())
        .await
        .unwrap();
    drop(restarted);
    let restarted = MarketDataOwnerPostgres::connect(owner_url).await.unwrap();
    assert_eq!(
        restarted
            .resolve_strategy_input_sample_projection_v3(receipt_digest)
            .await
            .unwrap_err(),
        SampleProjectionCustodyErrorV2::StoreUnavailable,
    );

    sqlx::query("DELETE FROM market_data_private.strategy_input_sample_projection_schedule_dependencies_v3 WHERE receipt_digest=$1")
        .bind(receipt_digest.as_slice())
        .execute(restarted.pool())
        .await
        .unwrap();
    assert_eq!(
        restarted
            .resolve_strategy_input_sample_projection_v3(receipt_digest)
            .await
            .unwrap_err(),
        SampleProjectionCustodyErrorV2::StoreUnavailable,
    );
}

async fn sample_projection_postgres_oracle_v2(owner_url: &str, reader_url: &str, admin: &PgPool) {
    let owner = MarketDataOwnerPostgres::connect(owner_url).await.unwrap();
    let prepared = prepared_sample_projection_v2(&owner).await;
    let receipt_digest = prepared.receipt_digest();
    let subject_identity = prepared.subject_identity();
    let receipt_bytes = prepared.canonical_bytes().to_vec();
    assert_eq!(prepared.kind_tag(), 0x01);
    assert_eq!(prepared.component_count(), 1);
    assert_eq!(receipt_bytes.len(), 41 + 612);
    let initial_count = sample_projection_count_v2(owner.pool()).await;

    assert_eq!(
        owner
            .commit_strategy_input_sample_projection_with_fault_v2(
                &prepared,
                SampleProjectionCustodyFaultV2::RollbackBeforeCommit,
            )
            .await
            .unwrap_err(),
        SampleProjectionCustodyErrorV2::CommitInterrupted,
    );
    assert_eq!(
        sample_projection_count_v2(owner.pool()).await,
        initial_count
    );
    assert_eq!(
        owner
            .commit_strategy_input_sample_projection_with_fault_v2(
                &prepared,
                SampleProjectionCustodyFaultV2::ResponseLoss,
            )
            .await
            .unwrap_err(),
        SampleProjectionCustodyErrorV2::ResponseLost,
    );
    assert_eq!(
        sample_projection_count_v2(owner.pool()).await,
        initial_count + 1
    );

    let recovered = owner
        .commit_strategy_input_sample_projection_v2(&prepared)
        .await
        .unwrap();
    assert_eq!(recovered.receipt_digest(), receipt_digest);
    assert_eq!(recovered.subject_identity(), subject_identity);
    assert_eq!(recovered.canonical_bytes(), receipt_bytes);
    let (replay_one, replay_two) = tokio::join!(
        owner.commit_strategy_input_sample_projection_v2(&prepared),
        owner.commit_strategy_input_sample_projection_v2(&prepared),
    );
    assert_eq!(replay_one.unwrap().canonical_bytes(), receipt_bytes);
    assert_eq!(replay_two.unwrap().canonical_bytes(), receipt_bytes);
    assert_eq!(
        sample_projection_count_v2(owner.pool()).await,
        initial_count + 1
    );

    drop(owner);
    let restarted = MarketDataOwnerPostgres::connect(owner_url).await.unwrap();
    let after_restart = restarted
        .resolve_strategy_input_sample_projection_v2(receipt_digest)
        .await
        .unwrap();
    assert_eq!(after_restart.canonical_bytes(), receipt_bytes);
    assert_eq!(
        restarted
            .resolve_strategy_input_sample_projection_v2(sample_digest(254))
            .await
            .unwrap_err(),
        SampleProjectionCustodyErrorV2::UnknownReceipt,
    );

    let reader = MarketDataReadPostgres::connect(reader_url).await.unwrap();
    let admitted = reader
        .resolve_strategy_input_sample_projection_v2(receipt_digest)
        .await
        .unwrap();
    assert_eq!(admitted.canonical_bytes(), receipt_bytes);
    let production_evidence =
        StrategyInputSampleProjectionStorageEvidenceV2::from_disposable_postgres(
            reader_url.to_string(),
            receipt_digest,
        )
        .await
        .unwrap();
    let production_readback =
        verify_admitted_sample_projection_v2(receipt_digest, &production_evidence).unwrap();
    assert_eq!(production_readback.receipt_digest(), receipt_digest);
    assert_eq!(production_readback.subject_identity(), subject_identity);
    assert_eq!(production_readback.component_count(), 1);
    assert_eq!(production_readback.canonical_bytes(), receipt_bytes);

    let sample_receipt_digest: [u8; 32] = receipt_bytes[41 + 240..41 + 272].try_into().unwrap();
    let original_sample_receipt_bytes: Vec<u8> = sqlx::query_scalar(
        "SELECT receipt_bytes FROM market_data_private.sample_receipts_v1 WHERE receipt_digest=$1",
    )
    .bind(sample_receipt_digest.as_slice())
    .fetch_one(admin)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE market_data_private.sample_receipts_v1 SET receipt_bytes=$1 WHERE receipt_digest=$2",
    )
    .bind([0x7f_u8; 32].as_slice())
    .bind(sample_receipt_digest.as_slice())
    .execute(admin)
    .await
    .unwrap();
    let tampered_dependency =
        StrategyInputSampleProjectionStorageEvidenceV2::from_disposable_postgres(
            reader_url.to_string(),
            receipt_digest,
        )
        .await
        .unwrap();
    assert!(verify_admitted_sample_projection_v2(receipt_digest, &tampered_dependency).is_err());
    sqlx::query(
        "UPDATE market_data_private.sample_receipts_v1 SET receipt_bytes=$1 WHERE receipt_digest=$2",
    )
    .bind(&original_sample_receipt_bytes)
    .bind(sample_receipt_digest.as_slice())
    .execute(admin)
    .await
    .unwrap();

    let mut missing_dependency_bytes = receipt_bytes.clone();
    missing_dependency_bytes[41 + 240..41 + 272].copy_from_slice(&sample_digest(254));
    let mut missing_receipt_hasher = Sha256::new();
    missing_receipt_hasher.update(b"market-data.sample-projection-receipt.v2\0");
    missing_receipt_hasher.update(&missing_dependency_bytes);
    let missing_receipt_digest: [u8; 32] = missing_receipt_hasher.finalize().into();
    let missing_custody_digest = sample_projection_custody_digest_v2(
        missing_receipt_digest,
        1,
        subject_identity,
        1,
        &missing_dependency_bytes,
    );
    sqlx::query("UPDATE market_data_private.strategy_input_sample_projection_receipts_v2 SET receipt_digest=$1,receipt_bytes=$2,custody_digest=$3 WHERE receipt_digest=$4")
        .bind(missing_receipt_digest.as_slice())
        .bind(&missing_dependency_bytes)
        .bind(missing_custody_digest.as_slice())
        .bind(receipt_digest.as_slice())
        .execute(admin)
        .await
        .unwrap();
    assert!(
        StrategyInputSampleProjectionStorageEvidenceV2::from_disposable_postgres(
            reader_url.to_string(),
            missing_receipt_digest,
        )
        .await
        .is_err()
    );
    assert!(
        sqlx::query(
            "SELECT * FROM market_data_private.strategy_input_sample_projection_schedule_dependencies_v3",
        )
        .fetch_all(&reader.pool)
        .await
        .is_err()
    );
    assert!(
        sqlx::query(
            "DELETE FROM market_data_private.strategy_input_sample_projection_schedule_dependencies_v3",
        )
        .execute(&reader.pool)
        .await
        .is_err()
    );
    let restored_custody_digest =
        sample_projection_custody_digest_v2(receipt_digest, 1, subject_identity, 1, &receipt_bytes);
    sqlx::query("UPDATE market_data_private.strategy_input_sample_projection_receipts_v2 SET receipt_digest=$1,receipt_bytes=$2,custody_digest=$3 WHERE receipt_digest=$4")
        .bind(receipt_digest.as_slice())
        .bind(&receipt_bytes)
        .bind(restored_custody_digest.as_slice())
        .bind(missing_receipt_digest.as_slice())
        .execute(admin)
        .await
        .unwrap();
    assert!(
        sqlx::query(
            "SELECT * FROM market_data_private.strategy_input_sample_projection_receipts_v2",
        )
        .fetch_all(&reader.pool)
        .await
        .is_err()
    );
    assert!(
        sqlx::query("DELETE FROM market_data_private.strategy_input_sample_projection_receipts_v2")
            .execute(&reader.pool)
            .await
            .is_err()
    );

    for privilege in ["INSERT", "UPDATE", "DELETE"] {
        let admitted: bool = sqlx::query_scalar("SELECT has_table_privilege($1,$2,$3)")
            .bind(READER_ROLE)
            .bind("market_data_private.strategy_input_sample_projection_receipts_v2")
            .bind(privilege)
            .fetch_one(admin)
            .await
            .unwrap();
        assert!(!admitted);
    }
    let table_owner: String = sqlx::query_scalar("SELECT pg_catalog.pg_get_userbyid(c.relowner) FROM pg_catalog.pg_class AS c JOIN pg_catalog.pg_namespace AS n ON n.oid=c.relnamespace WHERE n.nspname='market_data_private' AND c.relname='strategy_input_sample_projection_receipts_v2'")
        .fetch_one(admin).await.unwrap();
    assert_eq!(table_owner, OWNER_ROLE);
    let public_execute: bool = sqlx::query_scalar("SELECT has_function_privilege('public','market_data_private.resolve_strategy_input_sample_projection_v2(bytea)','EXECUTE')")
        .fetch_one(admin).await.unwrap();
    assert!(!public_execute);
    let public_dependency_execute: bool = sqlx::query_scalar("SELECT has_function_privilege('public','market_data_private.resolve_strategy_input_sample_projection_schedule_dependencies_v3(bytea)','EXECUTE')")
        .fetch_one(admin)
        .await
        .unwrap();
    assert!(!public_dependency_execute);
    let resolver_security_definer: bool = sqlx::query_scalar("SELECT p.prosecdef FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace WHERE n.nspname='market_data_private' AND p.proname='resolve_strategy_input_sample_projection_v2'")
        .fetch_one(admin).await.unwrap();
    assert!(resolver_security_definer);
    let resolver_config: Vec<String> = sqlx::query_scalar("SELECT p.proconfig FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace WHERE n.nspname='market_data_private' AND p.proname='resolve_strategy_input_sample_projection_v2'")
        .fetch_one(admin).await.unwrap();
    assert_eq!(resolver_config, ["search_path=pg_catalog"]);

    // Content hashes alone are not Owner authority: even a structurally valid projection whose
    // coordinate and outer digests were both recomputed cannot be promoted through durable
    // readback when it does not match the Owner-sealed custody row.
    let (recomputed_bytes, recomputed_digest) =
        crate::owner::sample_projection::tests::recomputed_coordinate_mutation_fixture_v2();
    sqlx::query("UPDATE market_data_private.strategy_input_sample_projection_receipts_v2 SET receipt_digest=$1,receipt_bytes=$2 WHERE receipt_digest=$3")
        .bind(recomputed_digest.as_slice()).bind(&recomputed_bytes).bind(receipt_digest.as_slice())
        .execute(restarted.pool()).await.unwrap();
    assert_eq!(
        restarted
            .resolve_strategy_input_sample_projection_v2(recomputed_digest)
            .await
            .unwrap_err(),
        SampleProjectionCustodyErrorV2::StoreUnavailable,
    );
    sqlx::query("UPDATE market_data_private.strategy_input_sample_projection_receipts_v2 SET receipt_digest=$1,receipt_bytes=$2 WHERE receipt_digest=$3")
        .bind(receipt_digest.as_slice()).bind(&receipt_bytes).bind(recomputed_digest.as_slice())
        .execute(restarted.pool()).await.unwrap();

    assert!(
        sqlx::query("INSERT INTO market_data_private.strategy_input_sample_projection_receipts_v2(receipt_digest,kind,subject_identity,component_count,receipt_bytes,custody_digest) VALUES ($1,1,$2,1,$3,$4)")
            .bind(sample_digest(250).as_slice())
            .bind(sample_digest(251).as_slice())
            .bind([0_u8; 652].as_slice())
            .bind(sample_digest(252).as_slice())
            .execute(restarted.pool()).await.is_err()
    );

    sqlx::query("UPDATE market_data_private.strategy_input_sample_projection_receipts_v2 SET receipt_digest=$1 WHERE receipt_digest=$2")
        .bind(sample_digest(253).as_slice()).bind(receipt_digest.as_slice())
        .execute(restarted.pool()).await.unwrap();
    assert_eq!(
        restarted
            .commit_strategy_input_sample_projection_v2(&prepared)
            .await
            .unwrap_err(),
        SampleProjectionCustodyErrorV2::SubjectConflict,
    );
    sqlx::query("UPDATE market_data_private.strategy_input_sample_projection_receipts_v2 SET receipt_digest=$1 WHERE receipt_digest=$2")
        .bind(receipt_digest.as_slice()).bind(sample_digest(253).as_slice())
        .execute(restarted.pool()).await.unwrap();

    let mut tampered = receipt_bytes.clone();
    let last = tampered.len() - 1;
    tampered[last] ^= 1;
    sqlx::query("UPDATE market_data_private.strategy_input_sample_projection_receipts_v2 SET receipt_bytes=$1 WHERE receipt_digest=$2")
        .bind(&tampered).bind(receipt_digest.as_slice())
        .execute(restarted.pool()).await.unwrap();
    assert_eq!(
        restarted
            .resolve_strategy_input_sample_projection_v2(receipt_digest)
            .await
            .unwrap_err(),
        SampleProjectionCustodyErrorV2::StoreUnavailable,
    );
    sqlx::query("UPDATE market_data_private.strategy_input_sample_projection_receipts_v2 SET receipt_bytes=$1 WHERE receipt_digest=$2")
        .bind(&receipt_bytes).bind(receipt_digest.as_slice())
        .execute(restarted.pool()).await.unwrap();
}

struct TestUniverseMembership {
    identity: BindingDigest,
    members: Vec<String>,
}

impl membership_seal::Sealed for TestUniverseMembership {}

impl InstrumentMasterUniverseMembershipResolver for TestUniverseMembership {
    fn resolve_instrument_master_membership(
        &self,
        selection_identity: BindingDigest,
    ) -> Result<InstrumentMasterUniverseMembershipV1, InstrumentMasterError> {
        if selection_identity != self.identity {
            return Err(InstrumentMasterError::MembershipMismatch);
        }
        super::super::instrument_master::authority::validate_members(&self.members)?;
        Ok(InstrumentMasterUniverseMembershipV1 {
            selection_identity,
            members: self.members.clone(),
        })
    }
}

fn instrument_clock() -> MarketDataClockAdmission {
    shared_clock(
        "12345678901234567890123456789012",
        "abcdefghijklmnopqrstuvwxyzABCDEF",
        1,
        100,
        d(90),
        1,
        2,
    )
}

fn instrument_fact(
    identity: &str,
    predecessor: Option<BindingDigest>,
    correction: u8,
) -> InstrumentMasterFactProposalV1 {
    InstrumentMasterFactProposalV1 {
        canonical_identity: identity.into(),
        predecessor_fact_digest: predecessor,
        mappings: vec![InstrumentVenueSourceMapping {
            venue_identity: "XNAS".into(),
            source_identity: "SIP".into(),
            source_instrument: identity.as_bytes().to_vec(),
        }],
        instrument_class: InstrumentClass::Equity,
        base_currency: Some("USD".into()),
        quote_currency: None,
        settlement_currency: Some("USD".into()),
        margin_currency: None,
        price_increment: InstrumentDecimal {
            mantissa: 1,
            scale: 2,
        },
        quantity_increment: InstrumentDecimal {
            mantissa: 1,
            scale: 0,
        },
        contract_multiplier: InstrumentDecimal {
            mantissa: 1,
            scale: 0,
        },
        calendar_identity: "XNYS-CALENDAR-V1".into(),
        session_identity: "XNYS-REGULAR-V1".into(),
        time_zone_identity: "America/New_York".into(),
        lifecycle_frontier: d(81),
        corporate_action_frontier: d(82),
        historical_membership_frontier: d(83),
        market_semantics_identity: d(84),
        source_frontier: d(85),
        correction_frontier: d(correction),
        effective_from: 10,
        effective_until: Some(200),
        provider_available: 90,
        retrieval: 91,
        correction_publication: 92,
        owner_observation: 99,
    }
}

fn instrument_request(
    identity: u8,
    scope: InstrumentMasterScopeV1,
    locator: UntrustedClockHeadLocator,
) -> UntrustedInstrumentMasterRequestV1 {
    UntrustedInstrumentMasterRequestV1 {
        request_identity: d(identity),
        request_meaning_digest: d(identity.wrapping_add(1)),
        consumer_role: BACKTEST_OWNER_V1.into(),
        scope,
        effective_instant: 50,
        owner_observation: 99,
        decision_cut: 100,
        clock_head: locator,
        lifecycle_frontier: d(81),
        corporate_action_frontier: d(82),
        historical_membership_frontier: d(83),
        market_semantics_identity: d(84),
        source_frontier: d(85),
        correction_frontier: d(86),
        stable_correlation: d(identity.wrapping_add(2)),
    }
}

async fn instrument_master_postgres_oracle(owner_url: &str, reader_url: &str, admin: &PgPool) {
    let owner = MarketDataOwnerPostgres::connect(owner_url).await.unwrap();
    grant_reader(admin).await;
    let clock = instrument_clock();
    let mut source_value = source_proposal(10, 100);
    source_value.time_evidence.clock_identity = clock.clock_identity.clone();
    source_value.time_evidence.clock_epoch = clock.clock_epoch.clone();
    source_value.time_evidence.monotonic_sequence = 1;
    source_value.time_evidence.restart_continuity_digest = d(90);
    source_value.time_evidence.skew_bound = 2;
    source_value.time_evidence.uncertainty_bound = 1;
    source_value.time_evidence.observed_at = 100;
    source_value.time_evidence.effective_at = 100;
    source_value.time_evidence.valid_through = 160;
    source_value.time_evidence.provider_available = 90;
    source_value.time_evidence.retrieval = 92;
    source_value.time_evidence.correction_publication = 91;
    source_value.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&source_value.time_evidence);
    source_value.claimed_binding_id = derive_binding_id(&source_value);
    owner
        .commit_source_initial(
            source_value,
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &clock,
        )
        .await
        .unwrap();
    let read = MarketDataReadPostgres::connect(reader_url).await.unwrap();
    let handoff = read
        .resolve_clock_head(build_head_fact(&clock, None).unwrap().handoff.locator())
        .await
        .unwrap();

    let facts_before: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM market_data_private.instrument_master_facts_v1")
            .fetch_one(owner.pool())
            .await
            .unwrap();
    assert_eq!(
        owner
            .append_instrument_master_fact_with_rollback(
                instrument_fact("GOOG", None, 86),
                handoff.locator()
            )
            .await,
        Err(InstrumentMasterError::CommitInterrupted)
    );
    let facts_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM market_data_private.instrument_master_facts_v1")
            .fetch_one(owner.pool())
            .await
            .unwrap();
    assert_eq!(facts_after, facts_before);

    let aapl_proposal = instrument_fact("AAPL", None, 86);
    let (first, replay) = tokio::join!(
        owner.append_instrument_master_fact(aapl_proposal.clone(), handoff.locator()),
        owner.append_instrument_master_fact(aapl_proposal, handoff.locator())
    );
    let aapl = first.unwrap();
    assert_eq!(replay.unwrap(), aapl);
    let msft = owner
        .append_instrument_master_fact(instrument_fact("MSFT", None, 86), handoff.locator())
        .await
        .unwrap();
    assert_ne!(aapl.digest(), msft.digest());

    let exact = instrument_request(
        110,
        InstrumentMasterScopeV1::ExactInstrument("AAPL".into()),
        handoff.locator().clone(),
    );
    let before: (i64, i64, i64, i64) = sqlx::query_as("SELECT (SELECT COUNT(*) FROM market_data_private.instrument_master_cuts_v1),(SELECT COUNT(*) FROM market_data_private.instrument_master_receipts_v1),(SELECT COUNT(*) FROM market_data_private.instrument_master_outbox_v1),COALESCE((SELECT append_sequence FROM market_data_private.instrument_master_state_v1 WHERE singleton),0)").fetch_one(owner.pool()).await.unwrap();
    let readback = owner.resolve_instrument_master(&exact, None).await.unwrap();
    assert!(crate::owner::instrument_master::verify_instrument_master_readback(&readback));
    let joined = owner.resolve_instrument_master(&exact, None).await.unwrap();
    assert_eq!(joined.canonical_bytes(), readback.canonical_bytes());
    let after: (i64, i64, i64, i64) = sqlx::query_as("SELECT (SELECT COUNT(*) FROM market_data_private.instrument_master_cuts_v1),(SELECT COUNT(*) FROM market_data_private.instrument_master_receipts_v1),(SELECT COUNT(*) FROM market_data_private.instrument_master_outbox_v1),(SELECT append_sequence FROM market_data_private.instrument_master_state_v1 WHERE singleton)").fetch_one(owner.pool()).await.unwrap();
    assert_eq!(
        (
            after.0 - before.0,
            after.1 - before.1,
            after.2 - before.2,
            after.3 - before.3
        ),
        (1, 1, 1, 1)
    );

    let mut conflict = exact.clone();
    conflict.effective_instant = 51;
    assert_eq!(
        owner.resolve_instrument_master(&conflict, None).await,
        Err(InstrumentMasterError::RequestConflict)
    );
    let unchanged: (i64, i64, i64, i64) = sqlx::query_as("SELECT (SELECT COUNT(*) FROM market_data_private.instrument_master_cuts_v1),(SELECT COUNT(*) FROM market_data_private.instrument_master_receipts_v1),(SELECT COUNT(*) FROM market_data_private.instrument_master_outbox_v1),(SELECT append_sequence FROM market_data_private.instrument_master_state_v1 WHERE singleton)").fetch_one(owner.pool()).await.unwrap();
    assert_eq!(unchanged, after);

    let rollback = instrument_request(
        120,
        InstrumentMasterScopeV1::ExactInstrument("AAPL".into()),
        handoff.locator().clone(),
    );
    assert_eq!(
        owner
            .resolve_instrument_master_with_rollback(&rollback, None)
            .await,
        Err(InstrumentMasterError::CommitInterrupted)
    );
    let rollback_counts: (i64, i64, i64, i64) = sqlx::query_as("SELECT (SELECT COUNT(*) FROM market_data_private.instrument_master_cuts_v1),(SELECT COUNT(*) FROM market_data_private.instrument_master_receipts_v1),(SELECT COUNT(*) FROM market_data_private.instrument_master_outbox_v1),(SELECT append_sequence FROM market_data_private.instrument_master_state_v1 WHERE singleton)").fetch_one(owner.pool()).await.unwrap();
    assert_eq!(rollback_counts, after);

    let loss = instrument_request(
        130,
        InstrumentMasterScopeV1::ExactInstrument("MSFT".into()),
        handoff.locator().clone(),
    );
    assert_eq!(
        owner
            .resolve_instrument_master_with_response_loss(&loss, None)
            .await,
        Err(InstrumentMasterError::ResponseLost)
    );
    let recovered = owner
        .recover_instrument_master(loss.request_identity, loss.request_meaning_digest)
        .await
        .unwrap();
    drop(owner);
    let restarted = MarketDataOwnerPostgres::connect(owner_url).await.unwrap();
    let restarted_readback = restarted
        .recover_instrument_master(loss.request_identity, loss.request_meaning_digest)
        .await
        .unwrap();
    assert_eq!(
        recovered.canonical_bytes(),
        restarted_readback.canonical_bytes()
    );

    let universe = TestUniverseMembership {
        identity: d(140),
        members: vec!["AAPL".into(), "MSFT".into()],
    };
    let universe_request = instrument_request(
        141,
        InstrumentMasterScopeV1::UniverseSelectionRecord(d(140)),
        handoff.locator().clone(),
    );
    let universe_readback = restarted
        .resolve_instrument_master(&universe_request, Some(&universe))
        .await
        .unwrap();
    assert_eq!(
        universe_readback.cut().expected_members(),
        &["AAPL".to_owned(), "MSFT".to_owned()]
    );
    let joined_universe = restarted
        .resolve_instrument_master(&universe_request, None)
        .await
        .unwrap();
    assert_eq!(
        joined_universe.canonical_bytes(),
        universe_readback.canonical_bytes()
    );

    let mut expired = instrument_request(
        150,
        InstrumentMasterScopeV1::ExactInstrument("AAPL".into()),
        handoff.locator().clone(),
    );
    expired.owner_observation = 160;
    assert_eq!(
        restarted.resolve_instrument_master(&expired, None).await,
        Err(InstrumentMasterError::ClockExpired)
    );
    let reader = PgPoolOptions::new()
        .max_connections(1)
        .connect(reader_url)
        .await
        .unwrap();
    assert!(
        sqlx::query("SELECT * FROM market_data_private.instrument_master_facts_v1")
            .fetch_all(&reader)
            .await
            .is_err()
    );
    assert!(
        sqlx::query("DELETE FROM market_data_private.instrument_master_receipts_v1")
            .execute(&reader)
            .await
            .is_err()
    );
    let public_execute: bool = sqlx::query_scalar("SELECT has_function_privilege('public','market_data_private.resolve_instrument_master_receipt_v1(bytea)','EXECUTE')").fetch_one(admin).await.unwrap();
    assert!(!public_execute);
    let receipt_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM market_data_private.resolve_instrument_master_receipt_v1($1)",
    )
    .bind(loss.request_identity.as_bytes().as_slice())
    .fetch_one(&reader)
    .await
    .unwrap();
    assert_eq!(receipt_count, 1);

    let next_clock = shared_clock(
        "12345678901234567890123456789012",
        "abcdefghijklmnopqrstuvwxyzABCDEF",
        2,
        120,
        d(90),
        1,
        2,
    );
    restarted
        .commit_clock_successor(&handoff, &next_clock)
        .await
        .unwrap();
    let joined_after_head_advance = restarted
        .resolve_instrument_master(&exact, None)
        .await
        .unwrap();
    assert_eq!(
        joined_after_head_advance.canonical_bytes(),
        readback.canonical_bytes()
    );

    let (outbox_identity, outbox_receipt_bytes): (Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT outbox_identity,receipt_bytes FROM market_data_private.instrument_master_outbox_v1 WHERE request_identity=$1",
    )
    .bind(exact.request_identity.as_bytes().as_slice())
    .fetch_one(restarted.pool())
    .await
    .unwrap();
    sqlx::query(
        "DELETE FROM market_data_private.instrument_master_outbox_v1 WHERE request_identity=$1",
    )
    .bind(exact.request_identity.as_bytes().as_slice())
    .execute(restarted.pool())
    .await
    .unwrap();
    assert_eq!(
        restarted.resolve_instrument_master(&exact, None).await,
        Err(InstrumentMasterError::StoreUntrusted)
    );
    sqlx::query("INSERT INTO market_data_private.instrument_master_outbox_v1(request_identity,outbox_identity,receipt_bytes) VALUES($1,$2,$3)")
        .bind(exact.request_identity.as_bytes().as_slice())
        .bind(outbox_identity)
        .bind(outbox_receipt_bytes)
        .execute(restarted.pool())
        .await
        .unwrap();

    sqlx::query(
        "UPDATE market_data_private.instrument_master_receipts_v1 SET request_meaning_digest=$2 WHERE request_identity=$1",
    )
    .bind(loss.request_identity.as_bytes().as_slice())
    .bind(d(200).as_bytes().as_slice())
    .execute(restarted.pool())
    .await
    .unwrap();
    assert_eq!(
        restarted
            .recover_instrument_master(loss.request_identity, d(200))
            .await,
        Err(InstrumentMasterError::StoreUntrusted)
    );
    sqlx::query(
        "UPDATE market_data_private.instrument_master_receipts_v1 SET request_meaning_digest=$2 WHERE request_identity=$1",
    )
    .bind(loss.request_identity.as_bytes().as_slice())
    .bind(loss.request_meaning_digest.as_bytes().as_slice())
    .execute(restarted.pool())
    .await
    .unwrap();

    sqlx::query("UPDATE market_data_private.instrument_master_outbox_v1 SET receipt_bytes=receipt_bytes || decode('00','hex') WHERE request_identity=$1").bind(loss.request_identity.as_bytes().as_slice()).execute(restarted.pool()).await.unwrap();
    assert!(
        restarted
            .recover_instrument_master(loss.request_identity, loss.request_meaning_digest)
            .await
            .is_err()
    );
}

async fn shared_time_counts(pool: &PgPool) -> (i64, i64) {
    sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM market_data_private.clock_handoffs_v1), (SELECT COUNT(*) FROM market_data_private.epoch_successor_proofs_v1)",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn assert_legacy_sequence_five_migrates(owner_url: &str) {
    let owner = MarketDataOwnerPostgres::connect(owner_url).await.unwrap();
    let legacy_clock = clock(40, 5);
    let mut legacy_source = source_proposal(10, 40);
    legacy_source.time_evidence.monotonic_sequence = legacy_clock.monotonic_sequence;
    legacy_source.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&legacy_source.time_evidence);
    legacy_source.claimed_binding_id = derive_binding_id(&legacy_source);
    owner
        .commit_source_initial(
            legacy_source,
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &legacy_clock,
        )
        .await
        .unwrap();

    let mut legacy = owner.pool().begin().await.unwrap();
    sqlx::query(
        "UPDATE market_data_private.clock_head_v1 SET shared_time_materialized=FALSE WHERE singleton",
    )
    .execute(&mut *legacy)
    .await
    .unwrap();
    sqlx::query("DELETE FROM market_data_private.owner_migrations_v1 WHERE migration_id=$1")
        .bind(SHARED_TIME_MIGRATION_ID)
        .execute(&mut *legacy)
        .await
        .unwrap();
    sqlx::query("DELETE FROM market_data_private.epoch_successor_proofs_v1")
        .execute(&mut *legacy)
        .await
        .unwrap();
    sqlx::query("DELETE FROM market_data_private.clock_handoff_head_v1")
        .execute(&mut *legacy)
        .await
        .unwrap();
    sqlx::query("DELETE FROM market_data_private.clock_handoff_membership_v1")
        .execute(&mut *legacy)
        .await
        .unwrap();
    sqlx::query("DELETE FROM market_data_private.clock_handoffs_v1")
        .execute(&mut *legacy)
        .await
        .unwrap();
    sqlx::query("DELETE FROM market_data_private.clock_handoff_state_v1")
        .execute(&mut *legacy)
        .await
        .unwrap();
    legacy.commit().await.unwrap();
    drop(owner);

    let migrated = MarketDataOwnerPostgres::connect(owner_url).await.unwrap();
    assert_eq!(shared_time_counts(migrated.pool()).await, (1, 0));
    let (sequence, materialized): (i64, bool) = sqlx::query_as(
        "SELECT monotonic_sequence,shared_time_materialized FROM market_data_private.clock_head_v1 WHERE singleton",
    )
    .fetch_one(migrated.pool())
    .await
    .unwrap();
    assert_eq!((sequence, materialized), (5, true));
    drop(migrated);

    let restarted = MarketDataOwnerPostgres::connect(owner_url).await.unwrap();
    assert_eq!(shared_time_counts(restarted.pool()).await, (1, 0));
    sqlx::query("DROP SCHEMA market_data_private CASCADE")
        .execute(restarted.pool())
        .await
        .unwrap();
}

async fn consume_direct(
    source_resolver: &impl SourceBindingOwnerResolver,
    pit_resolver: &impl PitSnapshotOwnerResolver,
    research_resolver: &impl ResearchPitTerminalResolver,
    source: &SourceBindingCommit,
    pit: &PitSnapshotCommitAggregate,
) {
    let source_readback = source_resolver
        .resolve_source_binding(source.receipt().locator())
        .await
        .unwrap();
    assert!(source_readback.is_admitted());
    assert_eq!(source_readback.fact_digest(), source.fact().digest());
    let pit_readback = pit_resolver
        .resolve_pit_snapshot(pit.receipt().locator())
        .await
        .unwrap();
    assert!(pit_readback.is_available());
    assert_eq!(pit_readback.fact_digest(), pit.fact().digest());
    assert_eq!(
        pit_readback.source_binding_identity(),
        source.fact().binding_id()
    );
    let request = research_terminal_request(source, pit);
    let terminal = research_resolver
        .resolve_research_pit_terminal(&request)
        .await
        .unwrap();
    assert_eq!(terminal.disposition(), ResearchPitDisposition::Available);
    assert!(terminal.available().is_some());
}

fn research_terminal_request(
    source: &SourceBindingCommit,
    pit: &PitSnapshotCommitAggregate,
) -> UntrustedResearchPitTerminalRequest {
    let fact = pit.fact();
    UntrustedResearchPitTerminalRequest {
        consumer_role: "RESEARCH_OWNER".into(),
        locator: pit.receipt().locator().clone(),
        requester_identity: fact.request().requester_identity,
        request_identity: fact.request_identity(),
        request_digest: fact.request_digest(),
        scope_digest: fact.request().scope_digest,
        correlation_identity: fact.correlation_identity(),
        source_binding_identity: fact.source_binding_identity(),
        source_binding_fact_digest: source.fact().digest(),
        source_binding_lineage_root: fact.source_binding_lineage_root(),
        source_binding_lineage_version: fact.source_binding_lineage_version(),
        source_frontier: fact.evidence().source_frontier.clone(),
        correction_frontier: fact.evidence().correction_frontier.clone(),
        time_evidence: fact.request().time_evidence.clone(),
        snapshot_correction_rule_digest: derive_snapshot_correction_rule_digest(
            fact.request(),
            fact.evidence().correction_frontier.clone(),
        )
        .unwrap(),
        provenance_binding_digest: derive_provenance_binding_digest(source.fact()).unwrap(),
        license_binding_digest: derive_license_binding_digest(source.fact()).unwrap(),
    }
}

async fn assert_exact_owner_replays_unavailable(
    owner: &MarketDataOwnerPostgres,
    source: &SourceBindingCommit,
    pit: &PitSnapshotCommitAggregate,
) {
    assert_eq!(
        owner
            .commit_source_initial(
                source.fact().proposal().clone(),
                OwnerSourceBindingDecision {
                    blockers: BTreeSet::new(),
                },
                &clock(40, 1),
            )
            .await,
        Err(SourceBindingError::StoreUnavailable),
    );
    let pit_proposal = UntrustedPitSnapshotProposal {
        request: pit.fact().request().clone(),
        evidence: pit.fact().evidence().clone(),
    };
    let pit_basis = TestOnlyCanonicalBasisResolver::seal_for_test(
        pit_proposal.request.clone(),
        pit_proposal.evidence.clone(),
        clock(40, 1),
    );
    assert_eq!(
        owner
            .commit_pit_initial(pit_proposal, &pit_basis, &clock(40, 1))
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
}

async fn assert_detached_clock_history_unavailable(
    owner: &MarketDataOwnerPostgres,
    reader: &MarketDataReadPostgres,
    owner_url: &str,
    source: &SourceBindingCommit,
    pit: &PitSnapshotCommitAggregate,
) {
    let prior_clock = shared_clock("detached-clock", "detached-epoch-1", 1, 200, d(60), 1, 2);
    let prior = build_head_fact(&prior_clock, None).unwrap();
    let same_clock = shared_clock("detached-clock", "detached-epoch-1", 2, 210, d(60), 1, 2);
    let same = build_head_fact(&same_clock, Some(prior.handoff.head_digest())).unwrap();
    let mut same_insert = owner.pool().begin().await.unwrap();
    insert_clock_handoff(&mut same_insert, &prior)
        .await
        .unwrap();
    insert_clock_handoff(&mut same_insert, &same).await.unwrap();
    sqlx::query(
        "UPDATE market_data_private.clock_handoff_state_v1 SET handoff_count=handoff_count+2 WHERE singleton",
    )
    .execute(&mut *same_insert)
    .await
    .unwrap();
    same_insert.commit().await.unwrap();
    assert_eq!(
        reader
            .resolve_clock_successor(&prior.handoff, same.handoff.locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    sqlx::query(
        "UPDATE market_data_private.clock_handoff_state_v1 SET handoff_count=handoff_count-2 WHERE singleton",
    )
    .execute(owner.pool())
    .await
    .unwrap();
    sqlx::query("DELETE FROM market_data_private.clock_handoffs_v1 WHERE head_identity IN ($1,$2)")
        .bind(same.handoff.head_identity().as_bytes().as_slice())
        .bind(prior.handoff.head_identity().as_bytes().as_slice())
        .execute(owner.pool())
        .await
        .unwrap();

    let next_clock = shared_clock("detached-clock", "detached-epoch-2", 1, 210, d(61), 1, 2);
    let next = build_head_fact(&next_clock, Some(prior.handoff.head_digest())).unwrap();
    let proof = build_epoch_successor_proof(&prior, &next);
    let mut next_insert = owner.pool().begin().await.unwrap();
    insert_clock_handoff(&mut next_insert, &prior)
        .await
        .unwrap();
    insert_clock_handoff(&mut next_insert, &next).await.unwrap();
    insert_epoch_proof(&mut next_insert, &proof).await.unwrap();
    sqlx::query(
        "UPDATE market_data_private.clock_handoff_state_v1 SET handoff_count=handoff_count+2,epoch_transition_count=epoch_transition_count+1 WHERE singleton",
    )
    .execute(&mut *next_insert)
    .await
    .unwrap();
    next_insert.commit().await.unwrap();
    assert_eq!(
        reader.resolve_clock_head(prior.handoff.locator()).await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    assert_eq!(
        reader
            .resolve_clock_successor(&prior.handoff, next.handoff.locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    Box::pin(assert_exact_owner_replays_unavailable(owner, source, pit)).await;
    assert!(matches!(
        MarketDataOwnerPostgres::connect(owner_url).await,
        Err(SourceBindingError::StoreUnavailable)
    ));
    let mut cleanup = owner.pool().begin().await.unwrap();
    sqlx::query(
        "UPDATE market_data_private.clock_handoff_state_v1 SET handoff_count=handoff_count-2,epoch_transition_count=epoch_transition_count-1 WHERE singleton",
    )
    .execute(&mut *cleanup)
    .await
    .unwrap();
    sqlx::query(
        "DELETE FROM market_data_private.epoch_successor_proofs_v1 WHERE proof_identity=$1",
    )
    .bind(proof.proof_identity().as_bytes().as_slice())
    .execute(&mut *cleanup)
    .await
    .unwrap();
    sqlx::query("DELETE FROM market_data_private.clock_handoffs_v1 WHERE head_identity IN ($1,$2)")
        .bind(next.handoff.head_identity().as_bytes().as_slice())
        .bind(prior.handoff.head_identity().as_bytes().as_slice())
        .execute(&mut *cleanup)
        .await
        .unwrap();
    cleanup.commit().await.unwrap();
    assert!(MarketDataOwnerPostgres::connect(owner_url).await.is_ok());
}

async fn owner_counts(pool: &PgPool) -> (i64, i64, i64, i64) {
    sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM market_data_private.source_binding_facts_v1), (SELECT COUNT(*) FROM market_data_private.source_binding_outbox_v1), (SELECT COUNT(*) FROM market_data_private.pit_snapshot_facts_v1), (SELECT COUNT(*) FROM market_data_private.pit_snapshot_outbox_v1)",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[rstest]
#[ignore = "requires the crates/data disposable PostgreSQL harness"]
fn postgres_owner_is_atomic_restart_safe_acl_sealed_and_fail_closed() {
    std::thread::Builder::new()
        .name("market-data-owner-postgres-test".into())
        .stack_size(16 * 1024 * 1024)
        .spawn(|| {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(run_postgres_owner_scenario());
        })
        .unwrap()
        .join()
        .unwrap();
}

async fn run_postgres_owner_scenario() {
    let (owner_url, reader_url, admin) = guarded_pools().await;
    assert_legacy_sequence_five_migrates(&owner_url).await;
    let owner = MarketDataOwnerPostgres::connect(&owner_url).await.unwrap();
    grant_reader(&admin).await;
    Box::pin(sample_custody_postgres_oracle(
        &owner_url,
        &reader_url,
        &admin,
    ))
    .await;
    Box::pin(sample_projection_postgres_oracle_v2(
        &owner_url,
        &reader_url,
        &admin,
    ))
    .await;
    Box::pin(sample_projection_postgres_oracle_v3(
        &owner_url,
        &reader_url,
        &admin,
    ))
    .await;

    let decision = OwnerSourceBindingDecision {
        blockers: BTreeSet::new(),
    };
    let source_value = source_proposal(10, 40);
    let source = owner
        .commit_source_initial(source_value.clone(), decision.clone(), &clock(40, 1))
        .await
        .unwrap();
    let replay = owner
        .commit_source_initial(source_value.clone(), decision.clone(), &clock(40, 1))
        .await
        .unwrap();
    assert_eq!(source, replay);

    let conflict = owner
        .commit_source_initial(
            source_value.clone(),
            OwnerSourceBindingDecision {
                blockers: [SourceBindingBlocker::SourceUnavailable]
                    .into_iter()
                    .collect(),
            },
            &clock(40, 1),
        )
        .await;
    assert_eq!(conflict, Err(SourceBindingError::ReplayConflict));

    let pit_value = pit_proposal(&source);
    let pit_basis = basis(&pit_value);
    let pit = owner
        .commit_pit_initial(pit_value.clone(), &pit_basis, &clock(40, 1))
        .await
        .unwrap();
    let pit_replay = owner
        .commit_pit_initial(pit_value.clone(), &pit_basis, &clock(40, 1))
        .await
        .unwrap();
    assert_eq!(pit, pit_replay);

    let mut pit_conflict = pit_value.clone();
    pit_conflict.evidence.normalized_records_digest = d(27);
    let pit_conflict_basis = basis(&pit_conflict);
    assert_eq!(
        owner
            .commit_pit_initial(pit_conflict, &pit_conflict_basis, &clock(40, 1))
            .await,
        Err(PitSnapshotError::ReplayConflict),
    );

    let mut pit_lost_value = pit_value.clone();
    pit_lost_value.request.correlation_identity = d(28);
    pit_lost_value.request.scope_digest = d(29);
    refresh_request_claims(&mut pit_lost_value.request);
    let pit_lost_basis = basis(&pit_lost_value);
    assert_eq!(
        owner
            .commit_pit_initial_with_fault(
                pit_lost_value.clone(),
                &pit_lost_basis,
                &clock(40, 1),
                PostgresCommitFault::ResponseLoss,
            )
            .await,
        Err(PitSnapshotError::ResponseLost),
    );
    let pit_lost = owner
        .commit_pit_initial(pit_lost_value, &pit_lost_basis, &clock(40, 1))
        .await
        .unwrap();

    let mut provider_claim = pit_value.clone();
    provider_claim.evidence.source_available = false;
    let unavailable_basis = basis(&provider_claim);
    provider_claim.evidence.source_available = true;
    assert_eq!(
        owner
            .commit_pit_initial(provider_claim, &unavailable_basis, &clock(40, 1))
            .await,
        Err(PitSnapshotError::CanonicalBasisMismatch),
    );

    let mut mismatched_validity = pit_value.clone();
    mismatched_validity.request.correlation_identity = d(88);
    mismatched_validity.request.scope_digest = d(89);
    mismatched_validity.request.time_evidence.valid_through = 101;
    refresh_request_claims(&mut mismatched_validity.request);
    let mismatched_validity_basis = basis_at(&mismatched_validity, &clock(40, 1));
    let before_validity_mismatch = owner_counts(owner.pool()).await;
    assert_eq!(
        owner
            .commit_pit_initial(
                mismatched_validity,
                &mismatched_validity_basis,
                &clock(40, 1),
            )
            .await,
        Err(PitSnapshotError::TrustedClockMismatch),
    );
    assert_eq!(owner_counts(owner.pool()).await, before_validity_mismatch);

    let mut stale = pit_value.clone();
    stale.request.time_evidence = pit_time(100, 2);
    refresh_request_claims(&mut stale.request);
    let stale_clock = clock(100, 2);
    let stale_basis = basis_at(&stale, &stale_clock);
    assert_eq!(
        owner
            .commit_pit_initial(stale, &stale_basis, &stale_clock)
            .await,
        Err(PitSnapshotError::SourceBindingUnavailable),
    );

    let mut forged_source = pit_value.clone();
    forged_source.request.source_binding.fact_digest = d(98);
    refresh_request_claims(&mut forged_source.request);
    let forged_basis = basis(&forged_source);
    assert_eq!(
        owner
            .commit_pit_initial(forged_source, &forged_basis, &clock(40, 1))
            .await,
        Err(PitSnapshotError::SourceBindingUnavailable),
    );

    let mut pit_interrupted = pit_value.clone();
    pit_interrupted.request.correlation_identity = d(34);
    pit_interrupted.request.scope_digest = d(35);
    refresh_request_claims(&mut pit_interrupted.request);
    let pit_interrupted_basis = basis(&pit_interrupted);
    assert_eq!(
        owner
            .commit_pit_initial_with_fault(
                pit_interrupted,
                &pit_interrupted_basis,
                &clock(40, 1),
                PostgresCommitFault::AfterFactBeforeOutbox,
            )
            .await,
        Err(PitSnapshotError::CommitInterrupted),
    );

    let before_counts: (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM market_data_private.source_binding_facts_v1), (SELECT COUNT(*) FROM market_data_private.source_binding_outbox_v1), (SELECT COUNT(*) FROM market_data_private.pit_snapshot_facts_v1), (SELECT COUNT(*) FROM market_data_private.pit_snapshot_outbox_v1)",
    ).fetch_one(owner.pool()).await.unwrap();
    assert_eq!(before_counts, (1, 1, 2, 2));

    let mut interrupted = source_proposal(10, 40);
    interrupted.adapter.configuration_digest = d(31);
    interrupted.claimed_binding_id = derive_binding_id(&interrupted);
    assert_eq!(
        Box::pin(owner.commit_source_initial_with_fault(
            interrupted,
            decision.clone(),
            &clock(40, 1),
            PostgresCommitFault::AfterFactBeforeOutbox
        ))
        .await,
        Err(SourceBindingError::CommitInterrupted),
    );

    let mut lost = source_proposal(10, 40);
    lost.adapter.configuration_digest = d(32);
    lost.claimed_binding_id = derive_binding_id(&lost);
    assert_eq!(
        Box::pin(owner.commit_source_initial_with_fault(
            lost.clone(),
            decision.clone(),
            &clock(40, 1),
            PostgresCommitFault::ResponseLoss
        ))
        .await,
        Err(SourceBindingError::ResponseLost),
    );
    let recovered_lost = owner
        .commit_source_initial(lost, decision.clone(), &clock(40, 1))
        .await
        .unwrap();

    let mut regressed = source_proposal(10, 39);
    regressed.adapter.configuration_digest = d(33);
    regressed.time_evidence.monotonic_sequence = 1;
    regressed.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&regressed.time_evidence);
    regressed.claimed_binding_id = derive_binding_id(&regressed);
    assert_eq!(
        owner
            .commit_source_initial(regressed, decision.clone(), &clock(39, 1))
            .await,
        Err(SourceBindingError::TrustedClockMismatch),
    );

    let before_upgrade = owner_counts(owner.pool()).await;
    let mut legacy = owner.pool().begin().await.unwrap();
    sqlx::query(
        "UPDATE market_data_private.clock_head_v1 SET shared_time_materialized=FALSE WHERE singleton",
    )
    .execute(&mut *legacy)
    .await
    .unwrap();
    sqlx::query("DELETE FROM market_data_private.owner_migrations_v1 WHERE migration_id=$1")
        .bind(SHARED_TIME_MIGRATION_ID)
        .execute(&mut *legacy)
        .await
        .unwrap();
    sqlx::query("DELETE FROM market_data_private.clock_handoff_state_v1")
        .execute(&mut *legacy)
        .await
        .unwrap();
    sqlx::query("DELETE FROM market_data_private.clock_handoff_head_v1")
        .execute(&mut *legacy)
        .await
        .unwrap();
    sqlx::query("DELETE FROM market_data_private.clock_handoff_membership_v1")
        .execute(&mut *legacy)
        .await
        .unwrap();
    sqlx::query("DELETE FROM market_data_private.clock_handoffs_v1")
        .execute(&mut *legacy)
        .await
        .unwrap();
    legacy.commit().await.unwrap();
    drop(owner);
    let restarted = MarketDataOwnerPostgres::connect(&owner_url).await.unwrap();
    let reader = MarketDataReadPostgres::connect(&reader_url).await.unwrap();
    consume_direct(&reader, &reader, &reader, &source, &pit).await;
    assert_eq!(owner_counts(restarted.pool()).await, before_upgrade);
    assert_eq!(shared_time_counts(restarted.pool()).await, (1, 0));
    let recovered_again = restarted
        .commit_source_initial(source_value, decision.clone(), &clock(40, 1))
        .await
        .unwrap();
    assert_eq!(recovered_again, source);
    let lost_again = restarted
        .commit_source_initial(
            recovered_lost.fact().proposal().clone(),
            decision,
            &clock(40, 1),
        )
        .await
        .unwrap();
    assert_eq!(lost_again, recovered_lost);
    let pit_lost_again = restarted
        .commit_pit_initial(
            UntrustedPitSnapshotProposal {
                request: pit_lost.fact().request().clone(),
                evidence: pit_lost.fact().evidence().clone(),
            },
            &TestOnlyCanonicalBasisResolver::seal_for_test(
                pit_lost.fact().request().clone(),
                pit_lost.fact().evidence().clone(),
                clock(40, 1),
            ),
            &clock(40, 1),
        )
        .await
        .unwrap();
    assert_eq!(pit_lost_again, pit_lost);

    let before_source_tamper = owner_counts(restarted.pool()).await;
    sqlx::query(
        "UPDATE market_data_private.source_binding_facts_v1 SET fact_digest=$1 WHERE binding_id=$2",
    )
    .bind(d(90).as_bytes().as_slice())
    .bind(source.fact().binding_id().as_bytes().as_slice())
    .execute(restarted.pool())
    .await
    .unwrap();
    let tampered_fact_request = distinct_pit_proposal(&source, 70);
    assert_eq!(
        restarted
            .commit_pit_initial(
                tampered_fact_request.clone(),
                &basis(&tampered_fact_request),
                &clock(40, 1),
            )
            .await,
        Err(PitSnapshotError::SourceBindingUnavailable),
    );
    assert_eq!(
        reader
            .resolve_source_binding(source.receipt().locator())
            .await,
        Err(SourceBindingError::StoreUnavailable),
    );
    sqlx::query(
        "UPDATE market_data_private.source_binding_facts_v1 SET fact_digest=$1 WHERE binding_id=$2",
    )
    .bind(source.fact().digest().as_bytes().as_slice())
    .bind(source.fact().binding_id().as_bytes().as_slice())
    .execute(restarted.pool())
    .await
    .unwrap();

    sqlx::query(
        "UPDATE market_data_private.source_binding_facts_v1 SET lineage_root=$1 WHERE binding_id=$2",
    )
    .bind(d(91).as_bytes().as_slice())
    .bind(source.fact().binding_id().as_bytes().as_slice())
    .execute(restarted.pool())
    .await
    .unwrap();
    let tampered_lineage_request = distinct_pit_proposal(&source, 72);
    assert_eq!(
        restarted
            .commit_pit_initial(
                tampered_lineage_request.clone(),
                &basis(&tampered_lineage_request),
                &clock(40, 1),
            )
            .await,
        Err(PitSnapshotError::SourceBindingUnavailable),
    );
    sqlx::query(
        "UPDATE market_data_private.source_binding_facts_v1 SET lineage_root=$1 WHERE binding_id=$2",
    )
    .bind(source.fact().lineage_root().as_bytes().as_slice())
    .bind(source.fact().binding_id().as_bytes().as_slice())
    .execute(restarted.pool())
    .await
    .unwrap();

    sqlx::query(
        "UPDATE market_data_private.source_binding_heads_v1 SET fact_digest=$1 WHERE lineage_root=$2",
    )
    .bind(d(92).as_bytes().as_slice())
    .bind(source.fact().lineage_root().as_bytes().as_slice())
    .execute(restarted.pool())
    .await
    .unwrap();
    let tampered_head_request = distinct_pit_proposal(&source, 74);
    assert_eq!(
        restarted
            .commit_pit_initial(
                tampered_head_request.clone(),
                &basis(&tampered_head_request),
                &clock(40, 1),
            )
            .await,
        Err(PitSnapshotError::SourceBindingUnavailable),
    );
    sqlx::query(
        "UPDATE market_data_private.source_binding_heads_v1 SET fact_digest=$1 WHERE lineage_root=$2",
    )
    .bind(source.fact().digest().as_bytes().as_slice())
    .bind(source.fact().lineage_root().as_bytes().as_slice())
    .execute(restarted.pool())
    .await
    .unwrap();

    sqlx::query(
        "UPDATE market_data_private.source_binding_outbox_v1 SET event_identity=$1 WHERE aggregate_identity=$2",
    )
    .bind(d(93).as_bytes().as_slice())
    .bind(source.fact().binding_id().as_bytes().as_slice())
    .execute(restarted.pool())
    .await
    .unwrap();
    let tampered_outbox_request = distinct_pit_proposal(&source, 76);
    assert_eq!(
        restarted
            .commit_pit_initial(
                tampered_outbox_request.clone(),
                &basis(&tampered_outbox_request),
                &clock(40, 1),
            )
            .await,
        Err(PitSnapshotError::SourceBindingUnavailable),
    );
    sqlx::query(
        "UPDATE market_data_private.source_binding_outbox_v1 SET event_identity=$1 WHERE aggregate_identity=$2",
    )
    .bind(source.receipt().outbox_digest().as_bytes().as_slice())
    .bind(source.fact().binding_id().as_bytes().as_slice())
    .execute(restarted.pool())
    .await
    .unwrap();
    assert_eq!(owner_counts(restarted.pool()).await, before_source_tamper);

    let source_successor_value = source_proposal(12, 50);
    let source_successor = Box::pin(restarted.commit_source_successor(
        source.receipt().locator(),
        source_successor_value.clone(),
        OwnerSourceBindingDecision {
            blockers: BTreeSet::new(),
        },
        &clock(50, 2),
    ))
    .await
    .unwrap();
    assert_eq!(
        reader
            .resolve_research_pit_terminal(&research_terminal_request(&source, &pit))
            .await,
        Err(PitSnapshotError::SourceBindingUnavailable),
    );
    let correction_value = pit_correction(&pit_value, &source_successor);
    let correction_basis = basis_at(&correction_value, &clock(50, 2));
    let correction = restarted
        .commit_pit_correction(
            pit.receipt().locator(),
            correction_value.clone(),
            &correction_basis,
            &clock(50, 2),
        )
        .await
        .unwrap();
    let correction_replay = restarted
        .commit_pit_correction(
            pit.receipt().locator(),
            correction_value.clone(),
            &correction_basis,
            &clock(50, 2),
        )
        .await
        .unwrap();
    assert_eq!(correction_replay, correction);
    let before_replaced_terminal = owner_counts(restarted.pool()).await;
    let replaced_terminal = reader
        .resolve_research_pit_terminal(&research_terminal_request(&source, &pit))
        .await;
    assert_eq!(
        replaced_terminal,
        Err(PitSnapshotError::CorrectionHeadMismatch),
    );
    assert_eq!(
        owner_counts(restarted.pool()).await,
        before_replaced_terminal
    );
    drop(reader);
    drop(restarted);
    let restarted_again = MarketDataOwnerPostgres::connect(&owner_url).await.unwrap();
    let reader_again = MarketDataReadPostgres::connect(&reader_url).await.unwrap();
    consume_direct(
        &reader_again,
        &reader_again,
        &reader_again,
        &source_successor,
        &correction,
    )
    .await;
    assert_eq!(
        reader_again
            .resolve_source_binding(source.receipt().locator())
            .await,
        Err(SourceBindingError::LocatorMismatch),
    );

    let before_pit_tamper = owner_counts(restarted_again.pool()).await;
    sqlx::query(
        "UPDATE market_data_private.clock_handoffs_v1 SET valid_through=111 WHERE clock_epoch='epoch-1' AND monotonic_sequence=2",
    )
        .execute(restarted_again.pool())
        .await
        .unwrap();
    assert_eq!(
        reader_again
            .resolve_pit_snapshot(correction.receipt().locator())
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    assert_eq!(
        reader_again
            .resolve_research_pit_terminal(&research_terminal_request(
                &source_successor,
                &correction,
            ))
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    sqlx::query(
        "UPDATE market_data_private.clock_handoffs_v1 SET valid_through=110 WHERE clock_epoch='epoch-1' AND monotonic_sequence=2",
    )
        .execute(restarted_again.pool())
        .await
        .unwrap();

    sqlx::query(
        "UPDATE market_data_private.pit_snapshot_facts_v1 SET request_identity=$1 WHERE snapshot_identity=$2",
    )
    .bind(d(94).as_bytes().as_slice())
    .bind(correction.fact().snapshot_identity().as_bytes().as_slice())
    .execute(restarted_again.pool())
    .await
    .unwrap();
    assert_eq!(
        reader_again
            .resolve_pit_snapshot(correction.receipt().locator())
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    sqlx::query(
        "UPDATE market_data_private.pit_snapshot_facts_v1 SET request_identity=$1 WHERE snapshot_identity=$2",
    )
    .bind(correction.fact().request_identity().as_bytes().as_slice())
    .bind(correction.fact().snapshot_identity().as_bytes().as_slice())
    .execute(restarted_again.pool())
    .await
    .unwrap();

    sqlx::query(
        "UPDATE market_data_private.pit_snapshot_heads_v1 SET fact_digest=$1 WHERE lineage_root=$2",
    )
    .bind(d(95).as_bytes().as_slice())
    .bind(correction.fact().lineage_root().as_bytes().as_slice())
    .execute(restarted_again.pool())
    .await
    .unwrap();
    assert_eq!(
        reader_again
            .resolve_pit_snapshot(correction.receipt().locator())
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    sqlx::query(
        "UPDATE market_data_private.pit_snapshot_heads_v1 SET fact_digest=$1 WHERE lineage_root=$2",
    )
    .bind(correction.fact().digest().as_bytes().as_slice())
    .bind(correction.fact().lineage_root().as_bytes().as_slice())
    .execute(restarted_again.pool())
    .await
    .unwrap();

    sqlx::query(
        "UPDATE market_data_private.pit_snapshot_outbox_v1 SET event_identity=$1 WHERE aggregate_identity=$2",
    )
    .bind(d(96).as_bytes().as_slice())
    .bind(correction.fact().snapshot_identity().as_bytes().as_slice())
    .execute(restarted_again.pool())
    .await
    .unwrap();
    assert_eq!(
        reader_again
            .resolve_pit_snapshot(correction.receipt().locator())
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    sqlx::query(
        "UPDATE market_data_private.pit_snapshot_outbox_v1 SET event_identity=$1 WHERE aggregate_identity=$2",
    )
    .bind(correction.outbox().digest().as_bytes().as_slice())
    .bind(correction.fact().snapshot_identity().as_bytes().as_slice())
    .execute(restarted_again.pool())
    .await
    .unwrap();
    assert_eq!(
        owner_counts(restarted_again.pool()).await,
        before_pit_tamper
    );

    let raw_select = sqlx::query("SELECT * FROM market_data_private.source_binding_facts_v1")
        .execute(&reader_again.pool)
        .await;
    assert!(raw_select.is_err());
    let raw_write = sqlx::query(
        "INSERT INTO market_data_private.owner_migrations_v1(migration_id) VALUES ('forged')",
    )
    .execute(&reader_again.pool)
    .await;
    assert!(raw_write.is_err());
    let function_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM market_data_private.resolve_source_binding_v1($1)",
    )
    .bind(source_successor.fact().binding_id().as_bytes().as_slice())
    .fetch_one(&reader_again.pool)
    .await
    .unwrap();
    assert_eq!(function_count, 1);

    let canonical_json: serde_json::Value = sqlx::query_scalar(
        "SELECT aggregate_json FROM market_data_private.source_binding_facts_v1 WHERE binding_id=$1",
    )
    .bind(source_successor.fact().binding_id().as_bytes().as_slice())
    .fetch_one(restarted_again.pool())
    .await
    .unwrap();
    sqlx::query(
        "UPDATE market_data_private.source_binding_facts_v1 SET aggregate_json='{}'::jsonb WHERE binding_id=$1",
    )
    .bind(source_successor.fact().binding_id().as_bytes().as_slice())
    .execute(restarted_again.pool())
    .await
    .unwrap();
    assert_eq!(
        reader_again
            .resolve_source_binding(source_successor.receipt().locator())
            .await,
        Err(SourceBindingError::StoreUnavailable),
    );
    sqlx::query(
        "UPDATE market_data_private.source_binding_facts_v1 SET aggregate_json=$1 WHERE binding_id=$2",
    )
    .bind(canonical_json)
    .bind(source_successor.fact().binding_id().as_bytes().as_slice())
    .execute(restarted_again.pool())
    .await
    .unwrap();
    assert!(
        reader_again
            .resolve_source_binding(source_successor.receipt().locator())
            .await
            .unwrap()
            .is_admitted()
    );

    let source_third_value = source_third_proposal();
    let source_third = Box::pin(restarted_again.commit_source_successor(
        source_successor.receipt().locator(),
        source_third_value,
        OwnerSourceBindingDecision {
            blockers: BTreeSet::new(),
        },
        &clock(60, 3),
    ))
    .await
    .unwrap();
    let pit_third_value = pit_third_correction(&correction_value, &source_third);
    let pit_third_basis = basis_at(&pit_third_value, &clock(60, 3));
    let pit_third = restarted_again
        .commit_pit_correction(
            correction.receipt().locator(),
            pit_third_value,
            &pit_third_basis,
            &clock(60, 3),
        )
        .await
        .unwrap();

    let mut same_epoch_legacy = restarted_again.pool().begin().await.unwrap();
    sqlx::query(
        "UPDATE market_data_private.clock_head_v1 SET shared_time_materialized=FALSE WHERE singleton",
    )
    .execute(&mut *same_epoch_legacy)
    .await
    .unwrap();
    sqlx::query("DELETE FROM market_data_private.owner_migrations_v1 WHERE migration_id=$1")
        .bind(SHARED_TIME_MIGRATION_ID)
        .execute(&mut *same_epoch_legacy)
        .await
        .unwrap();
    sqlx::query("DELETE FROM market_data_private.clock_handoff_state_v1")
        .execute(&mut *same_epoch_legacy)
        .await
        .unwrap();
    sqlx::query("DELETE FROM market_data_private.clock_handoff_head_v1")
        .execute(&mut *same_epoch_legacy)
        .await
        .unwrap();
    sqlx::query("DELETE FROM market_data_private.clock_handoff_membership_v1")
        .execute(&mut *same_epoch_legacy)
        .await
        .unwrap();
    sqlx::query("DELETE FROM market_data_private.clock_handoffs_v1")
        .execute(&mut *same_epoch_legacy)
        .await
        .unwrap();
    same_epoch_legacy.commit().await.unwrap();

    drop(reader_again);
    drop(restarted_again);
    let final_owner = MarketDataOwnerPostgres::connect(&owner_url).await.unwrap();
    let final_reader = MarketDataReadPostgres::connect(&reader_url).await.unwrap();
    let before_corrupt_replays = owner_counts(final_owner.pool()).await;
    let first_clock_head = build_head_fact(&clock(40, 1), None).unwrap();
    let second_clock_head =
        build_head_fact(&clock(50, 2), Some(first_clock_head.handoff.head_digest())).unwrap();
    let current_clock_head =
        build_head_fact(&clock(60, 3), Some(second_clock_head.handoff.head_digest())).unwrap();
    sqlx::query(
        "UPDATE market_data_private.source_binding_facts_v1 SET fact_digest=$1 WHERE binding_id=$2",
    )
    .bind(d(112).as_bytes().as_slice())
    .bind(source_successor.fact().binding_id().as_bytes().as_slice())
    .execute(final_owner.pool())
    .await
    .unwrap();
    assert_eq!(
        final_reader
            .resolve_source_binding(source_third.receipt().locator())
            .await,
        Err(SourceBindingError::StoreUnavailable),
    );
    assert_eq!(
        final_reader
            .resolve_pit_snapshot(pit_third.receipt().locator())
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    assert_eq!(
        final_reader
            .resolve_clock_head(current_clock_head.handoff.locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    assert!(matches!(
        MarketDataOwnerPostgres::connect(&owner_url).await,
        Err(SourceBindingError::StoreUnavailable)
    ));
    assert_eq!(
        Box::pin(final_owner.commit_source_successor(
            source.receipt().locator(),
            source_successor_value.clone(),
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &clock(50, 2),
        ))
        .await,
        Err(SourceBindingError::StoreUnavailable),
    );
    sqlx::query(
        "UPDATE market_data_private.source_binding_facts_v1 SET fact_digest=$1 WHERE binding_id=$2",
    )
    .bind(source_successor.fact().digest().as_bytes().as_slice())
    .bind(source_successor.fact().binding_id().as_bytes().as_slice())
    .execute(final_owner.pool())
    .await
    .unwrap();
    sqlx::query(
        "UPDATE market_data_private.pit_snapshot_facts_v1 SET fact_digest=$1 WHERE snapshot_identity=$2",
    )
    .bind(d(113).as_bytes().as_slice())
    .bind(correction.fact().snapshot_identity().as_bytes().as_slice())
    .execute(final_owner.pool())
    .await
    .unwrap();
    assert_eq!(
        final_reader
            .resolve_pit_snapshot(pit_third.receipt().locator())
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    assert_eq!(
        final_owner
            .commit_pit_correction(
                pit.receipt().locator(),
                correction_value.clone(),
                &correction_basis,
                &clock(50, 2),
            )
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    assert_eq!(
        final_reader
            .resolve_clock_head(current_clock_head.handoff.locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    assert!(matches!(
        MarketDataOwnerPostgres::connect(&owner_url).await,
        Err(SourceBindingError::StoreUnavailable)
    ));
    sqlx::query(
        "UPDATE market_data_private.pit_snapshot_facts_v1 SET fact_digest=$1 WHERE snapshot_identity=$2",
    )
    .bind(correction.fact().digest().as_bytes().as_slice())
    .bind(correction.fact().snapshot_identity().as_bytes().as_slice())
    .execute(final_owner.pool())
    .await
    .unwrap();
    assert_eq!(
        owner_counts(final_owner.pool()).await,
        before_corrupt_replays
    );
    sqlx::query(
        "UPDATE market_data_private.source_binding_heads_v1 SET binding_id=$1,fact_digest=$2,lineage_version=$3 WHERE lineage_root=$4",
    )
    .bind(source.fact().binding_id().as_bytes().as_slice())
    .bind(source.fact().digest().as_bytes().as_slice())
    .bind(1_i64)
    .bind(source.fact().lineage_root().as_bytes().as_slice())
    .execute(final_owner.pool())
    .await
    .unwrap();
    assert_eq!(
        final_reader
            .resolve_source_binding(source.receipt().locator())
            .await,
        Err(SourceBindingError::StoreUnavailable),
    );
    assert_eq!(
        final_owner
            .commit_source_initial(
                source.fact().proposal().clone(),
                OwnerSourceBindingDecision {
                    blockers: BTreeSet::new(),
                },
                &clock(40, 1),
            )
            .await,
        Err(SourceBindingError::StoreUnavailable),
    );
    sqlx::query(
        "UPDATE market_data_private.source_binding_heads_v1 SET binding_id=$1,fact_digest=$2,lineage_version=$3 WHERE lineage_root=$4",
    )
    .bind(source_third.fact().binding_id().as_bytes().as_slice())
    .bind(source_third.fact().digest().as_bytes().as_slice())
    .bind(3_i64)
    .bind(source_third.fact().lineage_root().as_bytes().as_slice())
    .execute(final_owner.pool())
    .await
    .unwrap();
    sqlx::query(
        "UPDATE market_data_private.pit_snapshot_heads_v1 SET snapshot_identity=$1,fact_digest=$2,lineage_version=$3 WHERE lineage_root=$4",
    )
    .bind(pit.fact().snapshot_identity().as_bytes().as_slice())
    .bind(pit.fact().digest().as_bytes().as_slice())
    .bind(1_i64)
    .bind(pit.fact().lineage_root().as_bytes().as_slice())
    .execute(final_owner.pool())
    .await
    .unwrap();
    assert_eq!(
        final_reader
            .resolve_pit_snapshot(pit.receipt().locator())
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    assert_eq!(
        final_owner
            .commit_pit_initial(pit_value.clone(), &pit_basis, &clock(40, 1))
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    sqlx::query(
        "UPDATE market_data_private.pit_snapshot_heads_v1 SET snapshot_identity=$1,fact_digest=$2,lineage_version=$3 WHERE lineage_root=$4",
    )
    .bind(pit_third.fact().snapshot_identity().as_bytes().as_slice())
    .bind(pit_third.fact().digest().as_bytes().as_slice())
    .bind(3_i64)
    .bind(pit_third.fact().lineage_root().as_bytes().as_slice())
    .execute(final_owner.pool())
    .await
    .unwrap();
    assert_eq!(
        owner_counts(final_owner.pool()).await,
        before_corrupt_replays
    );
    sqlx::query(
        "UPDATE market_data_private.source_binding_heads_v1 SET fact_digest=$1 WHERE lineage_root=$2",
    )
    .bind(d(110).as_bytes().as_slice())
    .bind(source_third.fact().lineage_root().as_bytes().as_slice())
    .execute(final_owner.pool())
    .await
    .unwrap();
    assert_eq!(
        Box::pin(final_owner.commit_source_successor(
            source.receipt().locator(),
            source_successor_value.clone(),
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &clock(50, 2),
        ))
        .await,
        Err(SourceBindingError::StoreUnavailable),
    );
    assert_eq!(
        final_owner
            .commit_pit_correction(
                pit.receipt().locator(),
                correction_value.clone(),
                &correction_basis,
                &clock(50, 2),
            )
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    assert_eq!(
        final_reader
            .resolve_pit_snapshot(pit_third.receipt().locator())
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    sqlx::query(
        "UPDATE market_data_private.source_binding_heads_v1 SET fact_digest=$1 WHERE lineage_root=$2",
    )
    .bind(source_third.fact().digest().as_bytes().as_slice())
    .bind(source_third.fact().lineage_root().as_bytes().as_slice())
    .execute(final_owner.pool())
    .await
    .unwrap();
    assert_eq!(
        owner_counts(final_owner.pool()).await,
        before_corrupt_replays
    );
    sqlx::query(
        "UPDATE market_data_private.pit_snapshot_heads_v1 SET fact_digest=$1 WHERE lineage_root=$2",
    )
    .bind(d(111).as_bytes().as_slice())
    .bind(pit_third.fact().lineage_root().as_bytes().as_slice())
    .execute(final_owner.pool())
    .await
    .unwrap();
    assert_eq!(
        final_owner
            .commit_pit_correction(
                pit.receipt().locator(),
                correction_value.clone(),
                &correction_basis,
                &clock(50, 2),
            )
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    sqlx::query(
        "UPDATE market_data_private.pit_snapshot_heads_v1 SET fact_digest=$1 WHERE lineage_root=$2",
    )
    .bind(pit_third.fact().digest().as_bytes().as_slice())
    .bind(pit_third.fact().lineage_root().as_bytes().as_slice())
    .execute(final_owner.pool())
    .await
    .unwrap();
    assert_eq!(
        owner_counts(final_owner.pool()).await,
        before_corrupt_replays
    );
    let source_second_replay = Box::pin(final_owner.commit_source_successor(
        source.receipt().locator(),
        source_successor_value,
        OwnerSourceBindingDecision {
            blockers: BTreeSet::new(),
        },
        &clock(50, 2),
    ))
    .await
    .unwrap();
    assert_eq!(source_second_replay, source_successor);
    let pit_second_replay = final_owner
        .commit_pit_correction(
            pit.receipt().locator(),
            correction_value,
            &correction_basis,
            &clock(50, 2),
        )
        .await
        .unwrap();
    assert_eq!(pit_second_replay, correction);
    consume_direct(
        &final_reader,
        &final_reader,
        &final_reader,
        &source_third,
        &pit_third,
    )
    .await;

    assert_eq!(owner_counts(final_owner.pool()).await, (4, 4, 4, 4));

    let first_clock_head = build_head_fact(&clock(40, 1), None).unwrap();
    let second_clock_head =
        build_head_fact(&clock(50, 2), Some(first_clock_head.handoff.head_digest())).unwrap();
    let epoch_one_head =
        build_head_fact(&clock(60, 3), Some(second_clock_head.handoff.head_digest()))
            .unwrap()
            .handoff;
    let epoch_one_head = final_reader
        .resolve_clock_head(epoch_one_head.locator())
        .await
        .unwrap();
    assert_eq!(epoch_one_head.clock_epoch(), "epoch-1");
    assert_eq!(shared_time_counts(final_owner.pool()).await, (3, 0));

    let same_epoch_clock = clock(70, 4);
    sqlx::query(
        "UPDATE market_data_private.source_binding_heads_v1 SET binding_id=$1,fact_digest=$2 WHERE lineage_root=$3",
    )
    .bind(source.fact().binding_id().as_bytes().as_slice())
    .bind(source.fact().digest().as_bytes().as_slice())
    .bind(source_third.fact().lineage_root().as_bytes().as_slice())
    .execute(final_owner.pool())
    .await
    .unwrap();
    assert!(matches!(
        MarketDataOwnerPostgres::connect(&owner_url).await,
        Err(SourceBindingError::StoreUnavailable)
    ));
    assert_eq!(
        final_owner
            .commit_clock_successor(&epoch_one_head, &same_epoch_clock)
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    let mut rollback_blocked_initial = source_third.fact().proposal().clone();
    rollback_blocked_initial.adapter.configuration_digest = d(112);
    rollback_blocked_initial.claimed_binding_id = derive_binding_id(&rollback_blocked_initial);
    assert_eq!(
        final_owner
            .commit_source_initial(
                rollback_blocked_initial,
                OwnerSourceBindingDecision {
                    blockers: BTreeSet::new(),
                },
                &clock(60, 3),
            )
            .await,
        Err(SourceBindingError::StoreUnavailable),
    );
    sqlx::query(
        "UPDATE market_data_private.source_binding_heads_v1 SET binding_id=$1,fact_digest=$2 WHERE lineage_root=$3",
    )
    .bind(source_third.fact().binding_id().as_bytes().as_slice())
    .bind(source_third.fact().digest().as_bytes().as_slice())
    .bind(source_third.fact().lineage_root().as_bytes().as_slice())
    .execute(final_owner.pool())
    .await
    .unwrap();

    sqlx::query(
        "UPDATE market_data_private.pit_snapshot_heads_v1 SET snapshot_identity=$1,fact_digest=$2 WHERE lineage_root=$3",
    )
    .bind(pit.fact().snapshot_identity().as_bytes().as_slice())
    .bind(pit.fact().digest().as_bytes().as_slice())
    .bind(pit_third.fact().lineage_root().as_bytes().as_slice())
    .execute(final_owner.pool())
    .await
    .unwrap();
    assert!(matches!(
        MarketDataOwnerPostgres::connect(&owner_url).await,
        Err(SourceBindingError::StoreUnavailable)
    ));
    let mut rollback_blocked_pit = distinct_pit_proposal(&source_third, 113);
    rollback_blocked_pit.request.time_evidence = pit_time(60, 3);
    refresh_request_claims(&mut rollback_blocked_pit.request);
    let rollback_blocked_pit_basis = basis_at(&rollback_blocked_pit, &clock(60, 3));
    assert_eq!(
        final_owner
            .commit_pit_initial(
                rollback_blocked_pit,
                &rollback_blocked_pit_basis,
                &clock(60, 3),
            )
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    let mut rollback_blocked_successor = source_proposal(14, 70);
    rollback_blocked_successor.time_evidence.monotonic_sequence = 4;
    rollback_blocked_successor.time_evidence.provider_available = 65;
    rollback_blocked_successor.time_evidence.retrieval = 69;
    rollback_blocked_successor
        .time_evidence
        .correction_publication = 69;
    rollback_blocked_successor
        .time_evidence
        .claimed_evidence_identity =
        derive_time_evidence_identity(&rollback_blocked_successor.time_evidence);
    rollback_blocked_successor.claimed_binding_id = derive_binding_id(&rollback_blocked_successor);
    assert_eq!(
        Box::pin(final_owner.commit_source_successor(
            source_third.receipt().locator(),
            rollback_blocked_successor,
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &same_epoch_clock,
        ))
        .await,
        Err(SourceBindingError::StoreUnavailable),
    );
    sqlx::query(
        "UPDATE market_data_private.pit_snapshot_heads_v1 SET snapshot_identity=$1,fact_digest=$2 WHERE lineage_root=$3",
    )
    .bind(pit_third.fact().snapshot_identity().as_bytes().as_slice())
    .bind(pit_third.fact().digest().as_bytes().as_slice())
    .bind(pit_third.fact().lineage_root().as_bytes().as_slice())
    .execute(final_owner.pool())
    .await
    .unwrap();

    let same_epoch = final_owner
        .commit_clock_successor(&epoch_one_head, &same_epoch_clock)
        .await
        .unwrap();
    assert!(same_epoch.epoch_successor_proof().is_none());
    let same_epoch_readback = final_reader
        .resolve_clock_successor(&epoch_one_head, same_epoch.handoff().locator())
        .await
        .unwrap();
    assert_eq!(same_epoch_readback, same_epoch);
    consume_direct(
        &final_reader,
        &final_reader,
        &final_reader,
        &source_third,
        &pit_third,
    )
    .await;

    let before_same_epoch_rejections = shared_time_counts(final_owner.pool()).await;
    let mut rejected_same_epoch = Vec::new();
    let mut value = clock(80, 5);
    value.clock_identity = "other-clock".into();
    rejected_same_epoch.push(value);
    let mut value = clock(80, 5);
    value.restart_continuity_digest = d(8);
    rejected_same_epoch.push(value);
    let mut value = clock(80, 5);
    value.uncertainty_bound = 0;
    rejected_same_epoch.push(value);
    let mut value = clock(80, 5);
    value.skew_bound = 3;
    rejected_same_epoch.push(value);
    let mut value = clock(80, 5);
    value.monotonic_sequence = same_epoch_clock.monotonic_sequence;
    rejected_same_epoch.push(value);
    for rejected in rejected_same_epoch {
        assert_eq!(
            final_owner
                .commit_clock_successor(same_epoch.handoff(), &rejected)
                .await,
            Err(SharedTimeEvidenceError::SuccessorDoesNotAdvance),
        );
        assert_eq!(
            shared_time_counts(final_owner.pool()).await,
            before_same_epoch_rejections
        );
        assert_eq!(
            final_reader
                .resolve_clock_head(same_epoch.handoff().locator())
                .await
                .unwrap(),
            *same_epoch.handoff()
        );
    }

    let mut cut_rollback = clock(80, 5);
    cut_rollback.decision_cut = same_epoch_clock.decision_cut;
    assert_eq!(
        final_owner
            .commit_clock_successor(same_epoch.handoff(), &cut_rollback)
            .await,
        Err(SharedTimeEvidenceError::SuccessorDoesNotAdvance),
    );
    let mut validity_rollback = clock(80, 5);
    validity_rollback.valid_through = same_epoch_clock.valid_through;
    assert_eq!(
        final_owner
            .commit_clock_successor(same_epoch.handoff(), &validity_rollback)
            .await,
        Err(SharedTimeEvidenceError::SuccessorDoesNotAdvance),
    );

    let response_loss_clock = clock(80, 5);
    assert_eq!(
        final_owner
            .commit_clock_successor_with_fault(
                same_epoch.handoff(),
                &response_loss_clock,
                PostgresCommitFault::ResponseLoss,
            )
            .await,
        Err(SharedTimeEvidenceError::ResponseLost),
    );
    let after_response_loss = shared_time_counts(final_owner.pool()).await;
    assert_eq!(
        final_owner
            .commit_clock_successor(&epoch_one_head, &response_loss_clock)
            .await,
        Err(SharedTimeEvidenceError::ReplayConflict),
    );
    assert_eq!(
        shared_time_counts(final_owner.pool()).await,
        after_response_loss
    );
    let recovered_response = final_owner
        .commit_clock_successor(same_epoch.handoff(), &response_loss_clock)
        .await
        .unwrap();

    drop(final_reader);
    drop(final_owner);
    let epoch_owner = MarketDataOwnerPostgres::connect(&owner_url).await.unwrap();
    let epoch_reader = MarketDataReadPostgres::connect(&reader_url).await.unwrap();
    let recovered_after_restart = epoch_reader
        .resolve_clock_successor(same_epoch.handoff(), recovered_response.handoff().locator())
        .await
        .unwrap();
    assert_eq!(recovered_after_restart, recovered_response);
    let forged_locator = UntrustedClockHeadLocator::from_untrusted(
        recovered_response.handoff().head_identity(),
        d(99),
    );
    assert_eq!(
        epoch_reader.resolve_clock_head(&forged_locator).await,
        Err(SharedTimeEvidenceError::LocatorMismatch),
    );

    sqlx::query(
        "UPDATE market_data_private.clock_handoffs_v1 SET predecessor_head_digest=NULL WHERE head_identity=$1",
    )
    .bind(same_epoch.handoff().head_identity().as_bytes().as_slice())
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    sqlx::query(
        "UPDATE market_data_private.clock_handoffs_v1 SET predecessor_head_digest=$1 WHERE head_identity=$2",
    )
    .bind(epoch_one_head.head_digest().as_bytes().as_slice())
    .bind(recovered_response.handoff().head_identity().as_bytes().as_slice())
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    assert_eq!(
        epoch_reader
            .resolve_clock_successor(&epoch_one_head, recovered_response.handoff().locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    sqlx::query(
        "UPDATE market_data_private.clock_handoffs_v1 SET predecessor_head_digest=$1 WHERE head_identity=$2",
    )
    .bind(same_epoch.handoff().head_digest().as_bytes().as_slice())
    .bind(recovered_response.handoff().head_identity().as_bytes().as_slice())
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    sqlx::query(
        "UPDATE market_data_private.clock_handoffs_v1 SET predecessor_head_digest=$1 WHERE head_identity=$2",
    )
    .bind(epoch_one_head.head_digest().as_bytes().as_slice())
    .bind(same_epoch.handoff().head_identity().as_bytes().as_slice())
    .execute(epoch_owner.pool())
    .await
    .unwrap();

    let epoch_two_clock = shared_clock("market-clock", "epoch-2", 1, 90, d(17), 2, 3);
    let before_interrupted_epoch = shared_time_counts(epoch_owner.pool()).await;
    assert_eq!(
        epoch_owner
            .commit_clock_successor_with_fault(
                recovered_response.handoff(),
                &epoch_two_clock,
                PostgresCommitFault::AfterClockHeadBeforeEpochProof,
            )
            .await,
        Err(SharedTimeEvidenceError::CommitInterrupted),
    );
    assert_eq!(
        shared_time_counts(epoch_owner.pool()).await,
        before_interrupted_epoch
    );
    assert_eq!(
        epoch_owner
            .commit_clock_successor_with_fault(
                recovered_response.handoff(),
                &epoch_two_clock,
                PostgresCommitFault::ResponseLoss,
            )
            .await,
        Err(SharedTimeEvidenceError::ResponseLost),
    );
    let epoch_two = epoch_owner
        .commit_clock_successor(recovered_response.handoff(), &epoch_two_clock)
        .await
        .unwrap();
    let epoch_proof = epoch_two.epoch_successor_proof().unwrap();
    assert_eq!(
        epoch_proof.predecessor_head_digest(),
        recovered_response.handoff().head_digest()
    );
    assert_eq!(
        epoch_proof.successor_head_digest(),
        epoch_two.handoff().head_digest()
    );
    assert_eq!(epoch_proof.prior_clock_epoch(), "epoch-1");
    assert_eq!(epoch_proof.successor_clock_epoch(), "epoch-2");
    assert_eq!(epoch_proof.commit_cut(), 90);
    assert_eq!(epoch_two.handoff().monotonic_sequence(), 1);
    assert!(
        epoch_reader
            .resolve_clock_successor(recovered_response.handoff(), epoch_two.handoff().locator())
            .await
            .unwrap()
            .epoch_successor_proof()
            .is_some()
    );
    assert_eq!(
        epoch_reader
            .resolve_clock_successor(same_epoch.handoff(), epoch_two.handoff().locator())
            .await,
        Err(SharedTimeEvidenceError::PriorHandoffMismatch),
    );
    let before_epoch_reuse = shared_time_counts(epoch_owner.pool()).await;
    let reused_epoch = shared_clock("market-clock", "epoch-1", 1, 100, d(18), 1, 2);
    assert_eq!(
        epoch_owner
            .commit_clock_successor(epoch_two.handoff(), &reused_epoch)
            .await,
        Err(SharedTimeEvidenceError::EpochSuccessorProofMismatch),
    );
    let reused_epoch_other_clock = shared_clock("other-clock", "epoch-1", 1, 100, d(18), 1, 2);
    assert_eq!(
        epoch_owner
            .commit_clock_successor(epoch_two.handoff(), &reused_epoch_other_clock)
            .await,
        Err(SharedTimeEvidenceError::EpochSuccessorProofMismatch),
    );
    assert_eq!(
        shared_time_counts(epoch_owner.pool()).await,
        before_epoch_reuse
    );

    sqlx::query(
        "UPDATE market_data_private.clock_handoffs_v1 SET wall_observed=wall_observed+1 WHERE head_identity=$1",
    )
    .bind(second_clock_head.handoff.head_identity().as_bytes().as_slice())
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    assert_eq!(
        epoch_reader
            .resolve_clock_head(epoch_two.handoff().locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    assert_eq!(
        epoch_reader
            .resolve_source_binding(source.receipt().locator())
            .await,
        Err(SourceBindingError::StoreUnavailable),
    );
    assert_eq!(
        epoch_reader
            .resolve_pit_snapshot(pit.receipt().locator())
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    assert_exact_owner_replays_unavailable(&epoch_owner, &source, &pit).await;
    assert!(matches!(
        MarketDataOwnerPostgres::connect(&owner_url).await,
        Err(SourceBindingError::StoreUnavailable)
    ));
    sqlx::query(
        "UPDATE market_data_private.clock_handoffs_v1 SET wall_observed=wall_observed-1 WHERE head_identity=$1",
    )
    .bind(second_clock_head.handoff.head_identity().as_bytes().as_slice())
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    assert!(MarketDataOwnerPostgres::connect(&owner_url).await.is_ok());

    let original_commit_cut: i64 = sqlx::query_scalar(
        "SELECT commit_cut FROM market_data_private.epoch_successor_proofs_v1 WHERE proof_identity=$1",
    )
    .bind(epoch_proof.proof_identity().as_bytes().as_slice())
    .fetch_one(epoch_owner.pool())
    .await
    .unwrap();
    sqlx::query(
        "UPDATE market_data_private.epoch_successor_proofs_v1 SET commit_cut=commit_cut+1 WHERE proof_identity=$1",
    )
    .bind(epoch_proof.proof_identity().as_bytes().as_slice())
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    assert_eq!(
        epoch_reader
            .resolve_clock_successor(recovered_response.handoff(), epoch_two.handoff().locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    assert_eq!(
        epoch_reader
            .resolve_source_binding(source.receipt().locator())
            .await,
        Err(SourceBindingError::StoreUnavailable),
    );
    assert_eq!(
        epoch_reader
            .resolve_pit_snapshot(pit.receipt().locator())
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    assert_exact_owner_replays_unavailable(&epoch_owner, &source, &pit).await;
    assert!(matches!(
        MarketDataOwnerPostgres::connect(&owner_url).await,
        Err(SourceBindingError::StoreUnavailable)
    ));
    sqlx::query(
        "UPDATE market_data_private.epoch_successor_proofs_v1 SET commit_cut=$1 WHERE proof_identity=$2",
    )
    .bind(original_commit_cut)
    .bind(epoch_proof.proof_identity().as_bytes().as_slice())
    .execute(epoch_owner.pool())
    .await
    .unwrap();

    sqlx::query(
        "DELETE FROM market_data_private.epoch_successor_proofs_v1 WHERE proof_identity=$1",
    )
    .bind(epoch_proof.proof_identity().as_bytes().as_slice())
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    assert_eq!(
        epoch_reader
            .resolve_clock_successor(recovered_response.handoff(), epoch_two.handoff().locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    sqlx::query(
        "INSERT INTO market_data_private.epoch_successor_proofs_v1(proof_identity,predecessor_head_digest,successor_head_digest,prior_clock_identity,prior_clock_epoch,successor_clock_identity,successor_clock_epoch,successor_continuity_digest,commit_cut,comparison_rule) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1)",
    )
    .bind(epoch_proof.proof_identity().as_bytes().as_slice())
    .bind(epoch_proof.predecessor_head_digest().as_bytes().as_slice())
    .bind(epoch_proof.successor_head_digest().as_bytes().as_slice())
    .bind(epoch_proof.prior_clock_identity())
    .bind(epoch_proof.prior_clock_epoch())
    .bind(epoch_proof.successor_clock_identity())
    .bind(epoch_proof.successor_clock_epoch())
    .bind(
        epoch_proof
            .successor_continuity_digest()
            .as_bytes()
            .as_slice(),
    )
    .bind(i64::try_from(epoch_proof.commit_cut()).unwrap())
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    assert!(
        sqlx::query(
            "INSERT INTO market_data_private.epoch_successor_proofs_v1(proof_identity,predecessor_head_digest,successor_head_digest,prior_clock_identity,prior_clock_epoch,successor_clock_identity,successor_clock_epoch,successor_continuity_digest,commit_cut,comparison_rule) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1)",
        )
        .bind(d(46).as_bytes().as_slice())
        .bind(epoch_proof.predecessor_head_digest().as_bytes().as_slice())
        .bind(epoch_proof.successor_head_digest().as_bytes().as_slice())
        .bind(epoch_proof.prior_clock_identity())
        .bind(epoch_proof.prior_clock_epoch())
        .bind(epoch_proof.successor_clock_identity())
        .bind(epoch_proof.successor_clock_epoch())
        .bind(epoch_proof.successor_continuity_digest().as_bytes().as_slice())
        .bind(i64::try_from(epoch_proof.commit_cut()).unwrap())
        .execute(epoch_owner.pool())
        .await
        .is_err()
    );
    assert_eq!(
        epoch_reader
            .resolve_clock_successor(recovered_response.handoff(), epoch_two.handoff().locator())
            .await
            .unwrap(),
        epoch_two
    );

    let concurrent_owner = MarketDataOwnerPostgres::connect(&owner_url).await.unwrap();
    let concurrent_a = shared_clock("market-clock", "epoch-2", 2, 100, d(17), 2, 3);
    let concurrent_b = shared_clock("market-clock", "epoch-2", 2, 101, d(17), 2, 3);
    let (result_a, result_b) = tokio::join!(
        epoch_owner.commit_clock_successor(epoch_two.handoff(), &concurrent_a),
        concurrent_owner.commit_clock_successor(epoch_two.handoff(), &concurrent_b),
    );
    let (winner, winner_clock) = match (result_a, result_b) {
        (Ok(value), Err(SharedTimeEvidenceError::PriorHandoffMismatch)) => (value, concurrent_a),
        (Err(SharedTimeEvidenceError::PriorHandoffMismatch), Ok(value)) => (value, concurrent_b),
        other => panic!("unexpected concurrent result: {other:?}"),
    };
    let (replay_a, replay_b) = tokio::join!(
        epoch_owner.commit_clock_successor(epoch_two.handoff(), &winner_clock),
        concurrent_owner.commit_clock_successor(epoch_two.handoff(), &winner_clock),
    );
    assert_eq!(replay_a.unwrap(), winner);
    assert_eq!(replay_b.unwrap(), winner);
    assert!(
        epoch_reader
            .resolve_clock_successor(epoch_two.handoff(), winner.handoff().locator())
            .await
            .unwrap()
            .epoch_successor_proof()
            .is_none()
    );
    let mut census_proposal = source_proposal(10, winner_clock.decision_cut);
    census_proposal.adapter.configuration_digest = d(46);
    census_proposal.time_evidence.clock_identity = winner_clock.clock_identity.clone();
    census_proposal.time_evidence.clock_epoch = winner_clock.clock_epoch.clone();
    census_proposal.time_evidence.monotonic_sequence = winner_clock.monotonic_sequence;
    census_proposal.time_evidence.restart_continuity_digest =
        winner_clock.restart_continuity_digest;
    census_proposal.time_evidence.skew_bound = winner_clock.skew_bound;
    census_proposal.time_evidence.uncertainty_bound = winner_clock.uncertainty_bound;
    census_proposal.time_evidence.observed_at = winner_clock.wall_observed;
    census_proposal.time_evidence.effective_at = winner_clock.decision_cut;
    census_proposal.time_evidence.valid_through = winner_clock.valid_through;
    census_proposal.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&census_proposal.time_evidence);
    census_proposal.claimed_binding_id = derive_binding_id(&census_proposal);
    let census_decision = OwnerSourceBindingDecision {
        blockers: BTreeSet::new(),
    };
    let census_aggregate = build_stored_aggregate(
        census_proposal.clone(),
        census_decision.clone(),
        SourceOwnerLineage {
            root: census_proposal.claimed_binding_id,
            version: 1,
            predecessor_binding_id: None,
            predecessor_fact_digest: None,
        },
    );
    let census_source = epoch_owner
        .commit_source_initial(census_proposal, census_decision, &winner_clock)
        .await
        .unwrap();
    assert_eq!(&census_source, census_aggregate.commit());
    let census_owner_counts = owner_counts(epoch_owner.pool()).await;
    sqlx::query("DELETE FROM market_data_private.source_binding_heads_v1 WHERE lineage_root=$1")
        .bind(census_source.fact().lineage_root().as_bytes().as_slice())
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    let custody_blocked_clock = shared_clock(
        "market-clock",
        "epoch-2",
        winner_clock.monotonic_sequence + 1,
        winner_clock.wall_observed + 10,
        d(17),
        2,
        3,
    );
    assert_eq!(
        epoch_owner
            .commit_clock_successor(winner.handoff(), &custody_blocked_clock)
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    let mut custody_blocked_source = census_aggregate.commit().fact().proposal().clone();
    custody_blocked_source.adapter.configuration_digest = d(47);
    custody_blocked_source.claimed_binding_id = derive_binding_id(&custody_blocked_source);
    assert_eq!(
        epoch_owner
            .commit_source_initial(
                custody_blocked_source,
                OwnerSourceBindingDecision {
                    blockers: BTreeSet::new(),
                },
                &winner_clock,
            )
            .await,
        Err(SourceBindingError::StoreUnavailable),
    );
    sqlx::query(
        "DELETE FROM market_data_private.source_binding_outbox_v1 WHERE aggregate_identity=$1",
    )
    .bind(census_source.fact().binding_id().as_bytes().as_slice())
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    sqlx::query("DELETE FROM market_data_private.source_binding_facts_v1 WHERE lineage_root=$1")
        .bind(census_source.fact().lineage_root().as_bytes().as_slice())
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    assert_eq!(
        epoch_reader
            .resolve_clock_head(winner.handoff().locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    assert!(matches!(
        MarketDataOwnerPostgres::connect(&owner_url).await,
        Err(SourceBindingError::StoreUnavailable)
    ));
    let mut restore_census = epoch_owner.pool().begin().await.unwrap();
    insert_source(
        &mut restore_census,
        &census_aggregate,
        PostgresCommitFault::None,
    )
    .await
    .unwrap();
    restore_census.commit().await.unwrap();
    assert_eq!(owner_counts(epoch_owner.pool()).await, census_owner_counts);
    assert_eq!(
        epoch_reader
            .resolve_clock_head(winner.handoff().locator())
            .await
            .unwrap(),
        *winner.handoff()
    );
    assert!(MarketDataOwnerPostgres::connect(&owner_url).await.is_ok());

    sqlx::query("DELETE FROM market_data_private.source_binding_heads_v1 WHERE lineage_root=$1")
        .bind(census_source.fact().lineage_root().as_bytes().as_slice())
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    sqlx::query(
        "DELETE FROM market_data_private.source_binding_outbox_v1 WHERE aggregate_identity=$1",
    )
    .bind(census_source.fact().binding_id().as_bytes().as_slice())
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    sqlx::query("DELETE FROM market_data_private.source_binding_facts_v1 WHERE lineage_root=$1")
        .bind(census_source.fact().lineage_root().as_bytes().as_slice())
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    sqlx::query(
        "DELETE FROM market_data_private.source_binding_lineage_census_v1 WHERE lineage_root=$1",
    )
    .bind(census_source.fact().lineage_root().as_bytes().as_slice())
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    assert_eq!(
        epoch_reader
            .resolve_clock_head(winner.handoff().locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    assert!(matches!(
        MarketDataOwnerPostgres::connect(&owner_url).await,
        Err(SourceBindingError::StoreUnavailable)
    ));
    let mut restore_census_count = epoch_owner.pool().begin().await.unwrap();
    sqlx::query(
        "INSERT INTO market_data_private.source_binding_lineage_census_v1(lineage_root) VALUES ($1)",
    )
    .bind(census_source.fact().lineage_root().as_bytes().as_slice())
    .execute(&mut *restore_census_count)
    .await
    .unwrap();
    insert_source(
        &mut restore_census_count,
        &census_aggregate,
        PostgresCommitFault::None,
    )
    .await
    .unwrap();
    restore_census_count.commit().await.unwrap();
    assert_eq!(owner_counts(epoch_owner.pool()).await, census_owner_counts);
    assert_eq!(
        epoch_reader
            .resolve_clock_head(winner.handoff().locator())
            .await
            .unwrap(),
        *winner.handoff()
    );
    assert!(MarketDataOwnerPostgres::connect(&owner_url).await.is_ok());

    sqlx::query(
        "DELETE FROM market_data_private.source_binding_lineage_census_v1 WHERE lineage_root=$1",
    )
    .bind(census_source.fact().lineage_root().as_bytes().as_slice())
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    assert_eq!(
        epoch_reader
            .resolve_clock_head(winner.handoff().locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    assert!(matches!(
        MarketDataOwnerPostgres::connect(&owner_url).await,
        Err(SourceBindingError::StoreUnavailable)
    ));
    sqlx::query(
        "INSERT INTO market_data_private.source_binding_lineage_census_v1(lineage_root) VALUES ($1)",
    )
    .bind(census_source.fact().lineage_root().as_bytes().as_slice())
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    assert_eq!(
        epoch_reader
            .resolve_clock_head(winner.handoff().locator())
            .await
            .unwrap(),
        *winner.handoff()
    );
    assert!(MarketDataOwnerPostgres::connect(&owner_url).await.is_ok());

    sqlx::query("DELETE FROM market_data_private.owner_history_census_state_v1 WHERE singleton")
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    assert_eq!(
        epoch_reader
            .resolve_clock_head(winner.handoff().locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    assert!(matches!(
        MarketDataOwnerPostgres::connect(&owner_url).await,
        Err(SourceBindingError::StoreUnavailable)
    ));
    sqlx::query("INSERT INTO market_data_private.owner_history_census_state_v1(singleton,source_lineage_count,pit_lineage_count) VALUES (TRUE,(SELECT COUNT(*) FROM market_data_private.source_binding_lineage_census_v1),(SELECT COUNT(*) FROM market_data_private.pit_snapshot_lineage_census_v1))")
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    assert_eq!(
        epoch_reader
            .resolve_clock_head(winner.handoff().locator())
            .await
            .unwrap(),
        *winner.handoff()
    );
    assert!(MarketDataOwnerPostgres::connect(&owner_url).await.is_ok());

    sqlx::query("UPDATE market_data_private.owner_history_census_state_v1 SET source_lineage_count=source_lineage_count+1 WHERE singleton")
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    assert_eq!(
        epoch_reader
            .resolve_clock_head(winner.handoff().locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    assert!(matches!(
        MarketDataOwnerPostgres::connect(&owner_url).await,
        Err(SourceBindingError::StoreUnavailable)
    ));
    sqlx::query("UPDATE market_data_private.owner_history_census_state_v1 SET source_lineage_count=source_lineage_count-1 WHERE singleton")
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    assert_eq!(
        epoch_reader
            .resolve_clock_head(winner.handoff().locator())
            .await
            .unwrap(),
        *winner.handoff()
    );
    assert!(MarketDataOwnerPostgres::connect(&owner_url).await.is_ok());
    sqlx::query(
        "ALTER TABLE market_data_private.epoch_successor_proofs_v1 RENAME TO epoch_successor_proofs_unavailable_test",
    )
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    let unavailable_same_epoch = shared_clock(
        "market-clock",
        "epoch-2",
        winner_clock.monotonic_sequence + 1,
        winner_clock.wall_observed + 10,
        d(17),
        2,
        3,
    );
    assert_eq!(
        epoch_owner
            .commit_clock_successor(winner.handoff(), &unavailable_same_epoch)
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    let unavailable_proof_store = shared_clock("market-clock", "epoch-3", 1, 120, d(19), 1, 2);
    assert_eq!(
        epoch_owner
            .commit_clock_successor(winner.handoff(), &unavailable_proof_store)
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    sqlx::query(
        "ALTER TABLE market_data_private.epoch_successor_proofs_unavailable_test RENAME TO epoch_successor_proofs_v1",
    )
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    assert_eq!(shared_time_counts(epoch_owner.pool()).await, (7, 1));

    sqlx::query(
        "CREATE FUNCTION market_data_private.reject_epoch_proof_for_test() RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN RAISE EXCEPTION 'proof store unavailable' USING ERRCODE='P0001'; END $function$",
    )
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    sqlx::query(
        "CREATE TRIGGER reject_epoch_proof_for_test BEFORE INSERT ON market_data_private.epoch_successor_proofs_v1 FOR EACH ROW EXECUTE FUNCTION market_data_private.reject_epoch_proof_for_test()",
    )
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    assert_eq!(
        epoch_owner
            .commit_clock_successor(winner.handoff(), &unavailable_proof_store)
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    assert_eq!(shared_time_counts(epoch_owner.pool()).await, (7, 1));
    sqlx::query(
        "DROP TRIGGER reject_epoch_proof_for_test ON market_data_private.epoch_successor_proofs_v1",
    )
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    sqlx::query("DROP FUNCTION market_data_private.reject_epoch_proof_for_test()")
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    let recovered_proof_store = epoch_owner
        .commit_clock_successor(winner.handoff(), &unavailable_proof_store)
        .await
        .unwrap();
    assert!(
        epoch_reader
            .resolve_clock_successor(winner.handoff(), recovered_proof_store.handoff().locator(),)
            .await
            .unwrap()
            .epoch_successor_proof()
            .is_some()
    );
    assert_eq!(shared_time_counts(epoch_owner.pool()).await, (8, 2));

    Box::pin(assert_detached_clock_history_unavailable(
        &epoch_owner,
        &epoch_reader,
        &owner_url,
        &source,
        &pit,
    ))
    .await;

    let snapshot_only_clock = shared_clock("market-clock", "epoch-3", 2, 140, d(19), 1, 2);
    let snapshot_only_fact = build_head_fact(
        &snapshot_only_clock,
        Some(recovered_proof_store.handoff().head_digest()),
    )
    .unwrap();
    let entered = std::sync::Arc::new(tokio::sync::Barrier::new(2));
    let release = std::sync::Arc::new(tokio::sync::Barrier::new(2));
    *READ_SNAPSHOT_TEST_HOOK.lock().unwrap() = Some((entered.clone(), release.clone()));
    let racing_reader = MarketDataReadPostgres {
        pool: epoch_reader.pool.clone(),
    };
    let racing_prior = recovered_proof_store.handoff().clone();
    let racing_locator = snapshot_only_fact.handoff.locator().clone();

    let racing_resolve = tokio::spawn(async move {
        racing_reader
            .resolve_clock_successor(&racing_prior, &racing_locator)
            .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), entered.wait())
        .await
        .unwrap();
    let mut noncanonical_insert = epoch_owner.pool().begin().await.unwrap();
    insert_clock_handoff(&mut noncanonical_insert, &snapshot_only_fact)
        .await
        .unwrap();
    noncanonical_insert.commit().await.unwrap();
    release.wait().await;
    assert_eq!(
        racing_resolve.await.unwrap(),
        Err(SharedTimeEvidenceError::LocatorMismatch),
    );
    *READ_SNAPSHOT_TEST_HOOK.lock().unwrap() = None;
    assert_eq!(
        epoch_reader
            .resolve_clock_head(snapshot_only_fact.handoff.locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    sqlx::query("DELETE FROM market_data_private.clock_handoffs_v1 WHERE head_identity=$1")
        .bind(
            snapshot_only_fact
                .handoff
                .head_identity()
                .as_bytes()
                .as_slice(),
        )
        .execute(epoch_owner.pool())
        .await
        .unwrap();

    let durable_state: (bool, i64, i64) = sqlx::query_as(
        "SELECT materialized,handoff_count,epoch_transition_count FROM market_data_private.clock_handoff_state_v1 WHERE singleton",
    )
    .fetch_one(epoch_owner.pool())
    .await
    .unwrap();
    let next_epoch_three = shared_clock("market-clock", "epoch-3", 2, 130, d(19), 1, 2);
    sqlx::query("DELETE FROM market_data_private.clock_handoff_state_v1")
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    assert_eq!(
        epoch_reader
            .resolve_clock_head(recovered_proof_store.handoff().locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    assert_eq!(
        epoch_reader
            .resolve_source_binding(source.receipt().locator())
            .await,
        Err(SourceBindingError::StoreUnavailable),
    );
    assert_eq!(
        epoch_reader
            .resolve_pit_snapshot(pit.receipt().locator())
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    assert_exact_owner_replays_unavailable(&epoch_owner, &source, &pit).await;
    assert!(matches!(
        MarketDataOwnerPostgres::connect(&owner_url).await,
        Err(SourceBindingError::StoreUnavailable)
    ));
    assert_eq!(
        epoch_owner
            .commit_clock_successor(recovered_proof_store.handoff(), &next_epoch_three)
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    sqlx::query(
        "INSERT INTO market_data_private.clock_handoff_state_v1(singleton,materialized,handoff_count,epoch_transition_count) VALUES (TRUE,$1,$2,$3)",
    )
    .bind(durable_state.0)
    .bind(durable_state.1)
    .bind(durable_state.2)
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    sqlx::query(
        "UPDATE market_data_private.clock_head_v1 SET shared_time_materialized=FALSE WHERE singleton",
    )
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    assert_eq!(
        epoch_reader
            .resolve_clock_head(recovered_proof_store.handoff().locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    assert_eq!(
        epoch_reader
            .resolve_source_binding(source.receipt().locator())
            .await,
        Err(SourceBindingError::StoreUnavailable),
    );
    assert_eq!(
        epoch_reader
            .resolve_pit_snapshot(pit.receipt().locator())
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    assert_exact_owner_replays_unavailable(&epoch_owner, &source, &pit).await;
    assert!(matches!(
        MarketDataOwnerPostgres::connect(&owner_url).await,
        Err(SourceBindingError::StoreUnavailable)
    ));
    assert_eq!(
        epoch_owner
            .commit_clock_successor(recovered_proof_store.handoff(), &next_epoch_three)
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    sqlx::query(
        "UPDATE market_data_private.clock_head_v1 SET shared_time_materialized=TRUE WHERE singleton",
    )
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    assert!(MarketDataOwnerPostgres::connect(&owner_url).await.is_ok());
    sqlx::query("DELETE FROM market_data_private.owner_migrations_v1 WHERE migration_id=$1")
        .bind(SHARED_TIME_MIGRATION_ID)
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    assert_eq!(
        epoch_reader
            .resolve_clock_head(recovered_proof_store.handoff().locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    assert_eq!(
        epoch_reader
            .resolve_source_binding(source.receipt().locator())
            .await,
        Err(SourceBindingError::StoreUnavailable),
    );
    assert_eq!(
        epoch_reader
            .resolve_pit_snapshot(pit.receipt().locator())
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    assert_exact_owner_replays_unavailable(&epoch_owner, &source, &pit).await;
    assert!(matches!(
        MarketDataOwnerPostgres::connect(&owner_url).await,
        Err(SourceBindingError::StoreUnavailable)
    ));
    sqlx::query("INSERT INTO market_data_private.owner_migrations_v1(migration_id) VALUES ($1)")
        .bind(SHARED_TIME_MIGRATION_ID)
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    assert_eq!(
        epoch_reader
            .resolve_clock_head(recovered_proof_store.handoff().locator())
            .await
            .unwrap(),
        *recovered_proof_store.handoff()
    );
    assert!(MarketDataOwnerPostgres::connect(&owner_url).await.is_ok());
    consume_direct(
        &epoch_reader,
        &epoch_reader,
        &epoch_reader,
        &source_third,
        &pit_third,
    )
    .await;
    assert_eq!(shared_time_counts(epoch_owner.pool()).await, (8, 2));

    let before_partial_loss_owner = owner_counts(epoch_owner.pool()).await;
    let before_partial_loss_shared_time = shared_time_counts(epoch_owner.pool()).await;
    sqlx::query("DELETE FROM market_data_private.clock_head_v1 WHERE singleton")
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    assert_eq!(
        epoch_reader
            .resolve_clock_head(recovered_proof_store.handoff().locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    assert_eq!(
        epoch_reader
            .resolve_source_binding(source.receipt().locator())
            .await,
        Err(SourceBindingError::StoreUnavailable),
    );
    assert_eq!(
        epoch_reader
            .resolve_pit_snapshot(pit.receipt().locator())
            .await,
        Err(PitSnapshotError::PersistenceUnavailable),
    );
    assert_exact_owner_replays_unavailable(&epoch_owner, &source, &pit).await;
    let unavailable_without_singleton = shared_clock(
        "market-clock",
        "epoch-2",
        winner_clock.monotonic_sequence + 1,
        winner_clock.wall_observed + 10,
        d(17),
        2,
        3,
    );
    assert_eq!(
        epoch_owner
            .commit_clock_successor(winner.handoff(), &unavailable_without_singleton)
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    let mut orphan_source = source_proposal(10, 130);
    orphan_source.adapter.configuration_digest = d(44);
    orphan_source.time_evidence.clock_epoch = "orphan-epoch".into();
    orphan_source.time_evidence.monotonic_sequence = 1;
    orphan_source.time_evidence.restart_continuity_digest = d(30);
    orphan_source.time_evidence.observed_at = 130;
    orphan_source.time_evidence.effective_at = 130;
    orphan_source.time_evidence.valid_through = 190;
    orphan_source.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&orphan_source.time_evidence);
    orphan_source.claimed_binding_id = derive_binding_id(&orphan_source);
    let orphan_clock = shared_clock("market-clock", "orphan-epoch", 1, 130, d(30), 1, 2);
    assert_eq!(
        epoch_owner
            .commit_source_initial(
                orphan_source,
                OwnerSourceBindingDecision {
                    blockers: BTreeSet::new(),
                },
                &orphan_clock,
            )
            .await,
        Err(SourceBindingError::StoreUnavailable),
    );
    assert_eq!(
        owner_counts(epoch_owner.pool()).await,
        before_partial_loss_owner
    );
    assert_eq!(
        shared_time_counts(epoch_owner.pool()).await,
        before_partial_loss_shared_time
    );
    let mut restore = epoch_owner.pool().begin().await.unwrap();
    insert_clock(&mut restore, &unavailable_proof_store)
        .await
        .unwrap();
    restore.commit().await.unwrap();
    consume_direct(
        &epoch_reader,
        &epoch_reader,
        &epoch_reader,
        &source_third,
        &pit_third,
    )
    .await;

    let before_lineage_head_loss = owner_counts(epoch_owner.pool()).await;
    sqlx::query("DELETE FROM market_data_private.source_binding_heads_v1 WHERE lineage_root=$1")
        .bind(source_third.fact().lineage_root().as_bytes().as_slice())
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    assert_eq!(
        epoch_reader
            .resolve_clock_head(winner.handoff().locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    assert!(matches!(
        MarketDataOwnerPostgres::connect(&owner_url).await,
        Err(SourceBindingError::StoreUnavailable)
    ));
    sqlx::query("INSERT INTO market_data_private.source_binding_heads_v1(lineage_root,binding_id,fact_digest,lineage_version) VALUES ($1,$2,$3,$4)")
        .bind(source_third.fact().lineage_root().as_bytes().as_slice())
        .bind(source_third.fact().binding_id().as_bytes().as_slice())
        .bind(source_third.fact().digest().as_bytes().as_slice())
        .bind(i64::try_from(source_third.fact().lineage_version()).unwrap())
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    assert_eq!(
        owner_counts(epoch_owner.pool()).await,
        before_lineage_head_loss
    );
    assert_eq!(
        epoch_reader
            .resolve_clock_head(winner.handoff().locator())
            .await
            .unwrap(),
        *winner.handoff()
    );
    consume_direct(
        &epoch_reader,
        &epoch_reader,
        &epoch_reader,
        &source_third,
        &pit_third,
    )
    .await;
    assert!(MarketDataOwnerPostgres::connect(&owner_url).await.is_ok());
    sqlx::query("DELETE FROM market_data_private.pit_snapshot_heads_v1 WHERE lineage_root=$1")
        .bind(pit_third.fact().lineage_root().as_bytes().as_slice())
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    assert_eq!(
        epoch_reader
            .resolve_clock_head(winner.handoff().locator())
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    assert!(matches!(
        MarketDataOwnerPostgres::connect(&owner_url).await,
        Err(SourceBindingError::StoreUnavailable)
    ));
    sqlx::query("INSERT INTO market_data_private.pit_snapshot_heads_v1(lineage_root,snapshot_identity,fact_digest,lineage_version) VALUES ($1,$2,$3,$4)")
        .bind(pit_third.fact().lineage_root().as_bytes().as_slice())
        .bind(pit_third.fact().snapshot_identity().as_bytes().as_slice())
        .bind(pit_third.fact().digest().as_bytes().as_slice())
        .bind(i64::try_from(pit_third.fact().lineage_version()).unwrap())
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    assert_eq!(
        owner_counts(epoch_owner.pool()).await,
        before_lineage_head_loss
    );
    assert_eq!(
        epoch_reader
            .resolve_clock_head(winner.handoff().locator())
            .await
            .unwrap(),
        *winner.handoff()
    );
    consume_direct(
        &epoch_reader,
        &epoch_reader,
        &epoch_reader,
        &source_third,
        &pit_third,
    )
    .await;
    assert!(MarketDataOwnerPostgres::connect(&owner_url).await.is_ok());

    assert!(
        sqlx::query("SELECT * FROM market_data_private.clock_handoffs_v1")
            .execute(&epoch_reader.pool)
            .await
            .is_err()
    );
    assert!(
        sqlx::query("UPDATE market_data_private.epoch_successor_proofs_v1 SET commit_cut=1")
            .execute(&epoch_reader.pool)
            .await
            .is_err()
    );

    let before_reverse_partial_loss = owner_counts(epoch_owner.pool()).await;
    sqlx::query("DELETE FROM market_data_private.epoch_successor_proofs_v1")
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    sqlx::query("DELETE FROM market_data_private.clock_handoff_head_v1")
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    sqlx::query("DELETE FROM market_data_private.clock_handoff_membership_v1")
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    sqlx::query("DELETE FROM market_data_private.clock_handoffs_v1")
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    assert_eq!(
        epoch_owner
            .commit_clock_successor(winner.handoff(), &unavailable_without_singleton)
            .await,
        Err(SharedTimeEvidenceError::StoreUnavailable),
    );
    let mut reverse_loss_source = source_proposal(10, winner_clock.decision_cut);
    reverse_loss_source.adapter.configuration_digest = d(45);
    reverse_loss_source.time_evidence.clock_identity = winner_clock.clock_identity.clone();
    reverse_loss_source.time_evidence.clock_epoch = winner_clock.clock_epoch.clone();
    reverse_loss_source.time_evidence.monotonic_sequence = winner_clock.monotonic_sequence;
    reverse_loss_source.time_evidence.restart_continuity_digest =
        winner_clock.restart_continuity_digest;
    reverse_loss_source.time_evidence.skew_bound = winner_clock.skew_bound;
    reverse_loss_source.time_evidence.uncertainty_bound = winner_clock.uncertainty_bound;
    reverse_loss_source.time_evidence.observed_at = winner_clock.wall_observed;
    reverse_loss_source.time_evidence.effective_at = winner_clock.decision_cut;
    reverse_loss_source.time_evidence.valid_through = winner_clock.valid_through;
    reverse_loss_source.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&reverse_loss_source.time_evidence);
    reverse_loss_source.claimed_binding_id = derive_binding_id(&reverse_loss_source);
    assert_eq!(
        epoch_owner
            .commit_source_initial(
                reverse_loss_source,
                OwnerSourceBindingDecision {
                    blockers: BTreeSet::new(),
                },
                &winner_clock,
            )
            .await,
        Err(SourceBindingError::StoreUnavailable),
    );
    assert_eq!(
        owner_counts(epoch_owner.pool()).await,
        before_reverse_partial_loss
    );
    sqlx::query("DELETE FROM market_data_private.clock_handoff_state_v1")
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    sqlx::query("DELETE FROM market_data_private.owner_migrations_v1 WHERE migration_id=$1")
        .bind(SHARED_TIME_MIGRATION_ID)
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    sqlx::query(
        "UPDATE market_data_private.clock_head_v1 SET shared_time_materialized=FALSE WHERE singleton",
    )
    .execute(epoch_owner.pool())
    .await
    .unwrap();
    assert!(matches!(
        MarketDataOwnerPostgres::connect(&owner_url).await,
        Err(SourceBindingError::StoreUnavailable)
    ));
    assert_eq!(
        owner_counts(epoch_owner.pool()).await,
        before_reverse_partial_loss
    );
    sqlx::query("DELETE FROM market_data_private.clock_head_v1 WHERE singleton")
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    assert!(matches!(
        MarketDataOwnerPostgres::connect(&owner_url).await,
        Err(SourceBindingError::StoreUnavailable)
    ));
    sqlx::query("DROP SCHEMA market_data_private CASCADE")
        .execute(epoch_owner.pool())
        .await
        .unwrap();
    Box::pin(instrument_master_postgres_oracle(
        &owner_url,
        &reader_url,
        &admin,
    ))
    .await;
    admin.close().await;
}
