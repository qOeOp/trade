use std::{collections::BTreeSet, env};

use sqlx::{PgPool, Row, postgres::PgPoolOptions};

use super::*;
use crate::owner::{
    pit_snapshot::{
        PitSnapshotOwnerResolver, UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
        UntrustedPitSnapshotEvidence, UntrustedPitSnapshotProposal, UntrustedPitSnapshotRequest,
        UntrustedPitSnapshotTimeEvidence, UntrustedProviderAvailableTime, UntrustedRetrievalTime,
        UntrustedSnapshotDecisionCut,
        authority::{TestOnlyCanonicalBasisResolver, refresh_request_claims},
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
    MarketDataClockAdmission::seal_for_test(
        "market-clock",
        "epoch-1",
        sequence,
        cut,
        cut,
        cut + 60,
        d(7),
        1,
        2,
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
}

async fn consume_direct(
    source_resolver: &impl SourceBindingOwnerResolver,
    pit_resolver: &impl PitSnapshotOwnerResolver,
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
}

async fn owner_counts(pool: &PgPool) -> (i64, i64, i64, i64) {
    sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM market_data_private.source_binding_facts_v1), (SELECT COUNT(*) FROM market_data_private.source_binding_outbox_v1), (SELECT COUNT(*) FROM market_data_private.pit_snapshot_facts_v1), (SELECT COUNT(*) FROM market_data_private.pit_snapshot_outbox_v1)",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "requires the crates/data disposable PostgreSQL harness"]
async fn postgres_owner_is_atomic_restart_safe_acl_sealed_and_fail_closed() {
    let (owner_url, reader_url, admin) = guarded_pools().await;
    let owner = MarketDataOwnerPostgres::connect(&owner_url).await.unwrap();
    grant_reader(&admin).await;

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
        owner
            .commit_source_initial_with_fault(
                interrupted,
                decision.clone(),
                &clock(40, 1),
                PostgresCommitFault::AfterFactBeforeOutbox
            )
            .await,
        Err(SourceBindingError::CommitInterrupted),
    );

    let mut lost = source_proposal(10, 40);
    lost.adapter.configuration_digest = d(32);
    lost.claimed_binding_id = derive_binding_id(&lost);
    assert_eq!(
        owner
            .commit_source_initial_with_fault(
                lost.clone(),
                decision.clone(),
                &clock(40, 1),
                PostgresCommitFault::ResponseLoss
            )
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

    drop(owner);
    let restarted = MarketDataOwnerPostgres::connect(&owner_url).await.unwrap();
    let reader = MarketDataReadPostgres::connect(&reader_url).await.unwrap();
    consume_direct(&reader, &reader, &source, &pit).await;
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
        Err(SourceBindingError::LocatorMismatch),
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
    drop(reader);
    drop(restarted);
    let restarted_again = MarketDataOwnerPostgres::connect(&owner_url).await.unwrap();
    let reader_again = MarketDataReadPostgres::connect(&reader_url).await.unwrap();
    consume_direct(&reader_again, &reader_again, &source_successor, &correction).await;
    assert_eq!(
        reader_again
            .resolve_source_binding(source.receipt().locator())
            .await,
        Err(SourceBindingError::LocatorMismatch),
    );

    let before_pit_tamper = owner_counts(restarted_again.pool()).await;
    sqlx::query("UPDATE market_data_private.clock_head_v1 SET valid_through=111 WHERE singleton")
        .execute(restarted_again.pool())
        .await
        .unwrap();
    assert_eq!(
        reader_again
            .resolve_pit_snapshot(correction.receipt().locator())
            .await,
        Err(PitSnapshotError::TrustedClockMismatch),
    );
    sqlx::query("UPDATE market_data_private.clock_head_v1 SET valid_through=110 WHERE singleton")
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
        Err(PitSnapshotError::LocatorMismatch),
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
        Err(PitSnapshotError::LocatorMismatch),
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
        Err(PitSnapshotError::LocatorMismatch),
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

    drop(reader_again);
    drop(restarted_again);
    let final_owner = MarketDataOwnerPostgres::connect(&owner_url).await.unwrap();
    let final_reader = MarketDataReadPostgres::connect(&reader_url).await.unwrap();
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
    consume_direct(&final_reader, &final_reader, &source_third, &pit_third).await;

    assert_eq!(owner_counts(final_owner.pool()).await, (4, 4, 4, 4));
    admin.close().await;
}
