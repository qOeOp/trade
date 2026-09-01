use std::time::{SystemTime, UNIX_EPOCH};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use rstest::rstest;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::UnixListener,
};
use vibe_backtest_owner_contracts::{
    CanonicalDigestV2, ContentIdentityV2, OpaqueIdentityV2, ReplayAuthorityClaimV2,
    ReplayModelProfilesV2, ReplayRequestDtoV2, ReplayRequestV2, ReplayWindowV2,
    VersionedIdentityV2,
};
use vibe_operator_authorization::{
    OperationManifestBindingV1, OperatorAuthorizationIssuanceProposalV1,
    OperatorAuthorizationIssuerPostgresV1, OperatorAuthorizationLocatorV1,
    OperatorAuthorizationRevocationProposalV1, OperatorAuthorizationScopeV1,
};
use vibe_product_edge::{
    AgentOperationManifestProposalV1, ProductEdgeAdmissionRequestV1,
    ProductEdgeAuthorizationTrustV1, ProductEdgeBootstrapProposalV1,
    ProductEdgeInvocationClaimRequestV1, ProductEdgePostgresOwnerV1,
};
use vibe_strategy_factory::{
    artifact_build::{
        ARTIFACT_BUILD_OPERATION_V1, ARTIFACT_BUILD_SCHEMA_V1, ArtifactBuildCandidateV1,
        ArtifactBuildDisposition, ArtifactBuildOwnerPort, ArtifactBuildRequestV1,
        ArtifactBuildResolution, GeneratedDirectionV1, GeneratedSignalV1, GeneratedStrategyLogicV1,
    },
    artifact_build_postgres::PostgresArtifactBuildOwnerV1,
    exploratory_replay::{
        EXPLORATORY_REPLAY_MUTATION_EFFECT_V1, EXPLORATORY_REPLAY_MUTATION_EFFECT_V2,
        EXPLORATORY_REPLAY_OPERATION_V1, EXPLORATORY_REPLAY_OPERATION_V2,
        EXPLORATORY_REPLAY_SCHEMA_V1, EXPLORATORY_REPLAY_SCHEMA_V2,
        ExploratoryReplayAvailabilityV1, ExploratoryReplayNextLegalActionV1,
        ExploratoryReplayOwnerError, ExploratoryReplayRecoverySelectorV2,
        ExploratoryReplayRequestLocatorV1, ExploratoryReplayRequestLocatorV2,
        ExploratoryReplayRequestProposalV1, ExploratoryReplayRequestProposalV2,
        ExploratoryReplaySealedReadPortV2, IdentityDigestV1, VersionedIdentityV1,
    },
    product_edge::{
        ProductEdgeChannel, ProductEdgeResearchGoalRequestV2, RESEARCH_GOAL_OPERATION_V2,
        RESEARCH_GOAL_SCHEMA_V2, RESEARCH_OWNER_V1, ResearchGoalOwnerPortV2, ResearchSourceV1,
        SourcedResearchGoalV2, TrialFamilyProposalV1,
    },
    product_edge_postgres::PostgresResearchGoalOwnerV1,
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TestFamilyFrozenOutboxV1 {
    schema_version: u32,
    research_receipt_identity: String,
    intent_identity: String,
    trial_family_identity: String,
    root_receipt_identity: String,
    membership_receipt_identity: String,
    census_frontier_identity: String,
    census_frontier_digest: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TestArtifactBoundOutboxV1 {
    schema_version: u32,
    artifact_identity: String,
    build_receipt_identity: String,
    trial_family_identity: String,
    binding_identity: String,
    binding_receipt_identity: String,
}

struct ReplayFixture {
    database: CanonicalOwnerPostgresTestDatabaseV1,
    owner: PostgresResearchGoalOwnerV1,
    edge: TestProductEdge,
    rd_url: String,
    qualification_url: String,
    backtest_url: String,
    edge_url: String,
    proposal: ExploratoryReplayRequestProposalV1,
    proposal_v2: ExploratoryReplayRequestProposalV2,
    valid_through_epoch_ms: u64,
}

#[tokio::test]
#[ignore = "requires the canonical disposable five-role PostgreSQL route with legacy Replay custody"]
async fn legacy_replay_table_is_preserved_while_current_custody_commits_and_reads_back() {
    type LegacyReplayCatalogRow = (
        String,
        Option<String>,
        bool,
        bool,
        bool,
        bool,
        bool,
        Vec<String>,
        bool,
        bool,
    );

    let fixture = Box::pin(prepare_replay_fixture(3_600_000)).await;
    let mutation = fixture.database.mutation();
    let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);

    let sealed_catalog_is_private: bool = sqlx::query_scalar(
        "SELECT owner.rolname='rd_owner'
            AND NOT EXISTS (
              SELECT 1
                FROM pg_catalog.aclexplode(COALESCE(
                  relation.relacl,
                  pg_catalog.acldefault('r', relation.relowner)
                )) acl
               WHERE acl.grantee<>relation.relowner
            )
            AND NOT pg_catalog.has_table_privilege(
              'surprise_replay_grantee',
              relation.oid,
              'SELECT,UPDATE'
            )
            AND NOT EXISTS (
              SELECT 1
                FROM pg_catalog.pg_attribute attribute
                CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl
               WHERE attribute.attrelid=relation.oid
                 AND attribute.attnum>0
                 AND NOT attribute.attisdropped
                 AND acl.grantee<>relation.relowner
            )
           FROM pg_catalog.pg_class relation
           JOIN pg_catalog.pg_roles owner ON owner.oid=relation.relowner
          WHERE relation.oid='public.rd_sealed_exploratory_replay_requests_v1'::pg_catalog.regclass",
    )
    .fetch_one(rd_pool)
    .await
    .expect("sealed Replay table catalog");
    assert!(sealed_catalog_is_private);

    let internal_custody_was_renamed_without_orphaning: bool = sqlx::query_scalar(
        "SELECT pg_catalog.to_regclass('public.rd_exploratory_replay_request_custody_v1') IS NULL
            AND EXISTS (
              SELECT 1
                FROM public.rd_sealed_exploratory_replay_requests_v1
               WHERE request_identity='internal-continuity-replay-v1'
                 AND request_digest='sha256:internal-continuity-request-v1'
                 AND build_request_identity='internal-continuity-build-v1'
                 AND attempt_identity='internal-continuity-attempt-v1'
                 AND intent_identity='internal-continuity-intent-v1'
                 AND trial_family_identity='internal-continuity-family-v1'
                 AND artifact_identity='sha256:internal-continuity-artifact-v1'
                 AND build_receipt_identity='internal-continuity-build-receipt-v1'
                 AND artifact_family_binding_identity='internal-continuity-family-binding-v1'
                 AND census_frontier_identity='internal-continuity-census-v1'
                 AND frozen_json=pg_catalog.jsonb_build_object(
                   'kind','internal-custody-continuity','schema_version',1
                 )
                 AND receipt_json=pg_catalog.jsonb_build_object(
                   'kind','internal-custody-continuity-receipt','schema_version',1
                 )
                 AND lifecycle_state='FROZEN'
                 AND committed_at_epoch_ms=1700000000000
                 AND request_schema_version=1
                 AND v2_canonical_request_bytes IS NULL
                 AND v2_meaning_digest IS NULL
                 AND v2_seal_digest IS NULL
                 AND v2_receipt_json IS NULL
            )",
    )
    .fetch_one(rd_pool)
    .await
    .expect("internal Replay custody continuity");
    assert!(internal_custody_was_renamed_without_orphaning);

    let legacy_catalog: LegacyReplayCatalogRow = sqlx::query_as(
            "SELECT owner.rolname,
                    pg_catalog.obj_description(relation.oid, 'pg_class'),
                    pg_catalog.has_table_privilege('product_edge_owner', relation.oid, 'SELECT'),
                    pg_catalog.has_table_privilege('backtest_owner', relation.oid, 'SELECT'),
                    EXISTS (
                      SELECT 1
                        FROM pg_catalog.aclexplode(COALESCE(
                          relation.relacl,
                          pg_catalog.acldefault('r', relation.relowner)
                        )) acl
                       WHERE acl.grantee=0
                         AND acl.privilege_type='SELECT'
                    ),
                    pg_catalog.has_table_privilege('qualification_writer', relation.oid, 'SELECT'),
                    relation.relacl IS NULL,
                    ARRAY(
                      SELECT attribute.attname || ':' || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) || ':' || attribute.attnotnull::text
                        FROM pg_catalog.pg_attribute attribute
                       WHERE attribute.attrelid=relation.oid
                         AND attribute.attnum>0
                         AND NOT attribute.attisdropped
                       ORDER BY attribute.attnum
                    ),
                    EXISTS (
                      SELECT 1 FROM pg_catalog.pg_constraint constraint_entry
                       WHERE constraint_entry.conrelid=relation.oid
                         AND constraint_entry.contype='p'
                         AND constraint_entry.conkey=ARRAY[(
                           SELECT attribute.attnum FROM pg_catalog.pg_attribute attribute
                            WHERE attribute.attrelid=relation.oid
                              AND attribute.attname='replay_request_identity'
                         )]::smallint[]
                    ),
                    EXISTS (
                      SELECT 1 FROM pg_catalog.pg_constraint constraint_entry
                       WHERE constraint_entry.conrelid=relation.oid
                         AND constraint_entry.contype='u'
                         AND constraint_entry.conkey=ARRAY[(
                           SELECT attribute.attnum FROM pg_catalog.pg_attribute attribute
                            WHERE attribute.attrelid=relation.oid
                              AND attribute.attname='run_attempt_identity'
                         )]::smallint[]
                    )
               FROM pg_catalog.pg_class relation
               JOIN pg_catalog.pg_roles owner ON owner.oid=relation.relowner
              WHERE relation.oid='public.rd_exploratory_replay_requests_v1'::pg_catalog.regclass",
        )
        .fetch_one(rd_pool)
        .await
        .expect("legacy Replay table catalog");
    assert_eq!(legacy_catalog.0, "rd_owner");
    assert_eq!(
        legacy_catalog.1.as_deref(),
        Some("legacy Replay sentinel v1")
    );
    assert!(!legacy_catalog.2);
    assert!(!legacy_catalog.3);
    assert!(!legacy_catalog.4);
    assert!(!legacy_catalog.5);
    assert!(legacy_catalog.6);
    assert_eq!(
        legacy_catalog.7,
        [
            "replay_request_identity:text:true",
            "run_attempt_identity:text:true",
            "semantic_digest:text:true",
            "request_json:jsonb:true",
            "receipt_json:jsonb:true",
            "handoff_json:jsonb:false",
            "committed_at_epoch_ms:bigint:true",
            "research_view_json:jsonb:false",
            "request_schema_version:smallint:true",
            "v2_canonical_request_bytes:bytea:false",
            "v2_meaning_digest:text:false",
            "v2_seal_digest:text:false",
            "v2_receipt_json:jsonb:false",
        ]
    );
    assert!(legacy_catalog.8);
    assert!(legacy_catalog.9);

    let legacy_is_exact: bool = sqlx::query_scalar(
        "SELECT pg_catalog.count(*)=26
             AND pg_catalog.sum(committed_at_epoch_ms)=325
             AND pg_catalog.bool_and(
               replay_request_identity='legacy-replay-' || ordinal::text
               AND run_attempt_identity='legacy-attempt-' || ordinal::text
               AND semantic_digest='sha256:legacy-' || ordinal::text
               AND request_json=pg_catalog.jsonb_build_object('ordinal',ordinal,'kind','legacy-request')
               AND receipt_json=pg_catalog.jsonb_build_object('ordinal',ordinal,'kind','legacy-receipt')
               AND handoff_json=pg_catalog.jsonb_build_object('ordinal',ordinal,'kind','legacy-handoff')
               AND research_view_json=pg_catalog.jsonb_build_object('ordinal',ordinal,'kind','legacy-research-view')
               AND request_schema_version=2
               AND v2_canonical_request_bytes=pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(ordinal),2,'0'),'hex')
               AND v2_meaning_digest='sha256:legacy-meaning-' || ordinal::text
               AND v2_seal_digest='sha256:legacy-seal-' || ordinal::text
               AND v2_receipt_json=pg_catalog.jsonb_build_object('ordinal',ordinal,'kind','legacy-v2-receipt')
             )
           FROM (
             SELECT legacy.*, pg_catalog.substring(replay_request_identity, '[0-9]+$')::bigint ordinal
               FROM public.rd_exploratory_replay_requests_v1 legacy
           ) checked",
    )
    .fetch_one(rd_pool)
    .await
    .expect("legacy Replay rows");
    assert!(legacy_is_exact);

    let sealed_v1 = fixture
        .owner
        .commit_exploratory_replay_request_v1(fixture.proposal.clone())
        .await
        .expect("current Replay V1 request committed");
    let sealed_v2 = fixture
        .owner
        .commit_exploratory_replay_request_v2(fixture.proposal_v2.clone())
        .await
        .expect("current Replay V2 request committed");

    sqlx::query(
        "ALTER TABLE public.rd_sealed_exploratory_replay_requests_v1
         RENAME TO rd_exploratory_replay_request_custody_v1",
    )
    .execute(rd_pool)
    .await
    .expect("restore pre-migration internal Replay custody name");
    let restarted = PostgresResearchGoalOwnerV1::connect_with_backtest(
        &fixture.rd_url,
        &fixture.qualification_url,
        &fixture.backtest_url,
    )
    .await
    .expect("renamed internal Replay custody migrated");

    let locked_v1 = restarted
        .lock_exploratory_replay_request_for_backtest_v1(sealed_v1.locator())
        .await
        .expect("pre-migration Replay V1 request locked");
    assert_eq!(
        locked_v1
            .readback()
            .expect("sealed V1 readback")
            .request_digest(),
        sealed_v1.locator().request_digest
    );
    let committed_v1_json = serde_json::to_value(&sealed_v1).unwrap();
    let locked_v1_json = serde_json::to_value(&locked_v1).unwrap();
    assert_eq!(
        locked_v1_json.pointer("/readback/frozen"),
        committed_v1_json.pointer("/frozen")
    );
    assert_eq!(
        locked_v1_json.pointer("/readback/receipt"),
        committed_v1_json.pointer("/receipt")
    );
    let locked_v2 = restarted
        .lock_exploratory_replay_request_for_backtest_v2(sealed_v2.locator())
        .await
        .expect("pre-migration Replay V2 request locked");
    let expected = ReplayRequestV2::try_from(fixture.proposal_v2.request.clone()).unwrap();
    let locked_v2_readback = locked_v2.readback().expect("sealed V2 readback");
    assert_eq!(locked_v2_readback.request(), &expected,);
    assert_eq!(locked_v2_readback.locator(), sealed_v2.locator().clone());
    let selector = ExploratoryReplayRecoverySelectorV2 {
        request_identity: sealed_v2.locator().request_identity.clone(),
        meaning_digest: sealed_v2.locator().meaning_digest.clone(),
    };
    let resolved_v2 = restarted
        .resolve_exploratory_replay_request_v2(&selector)
        .await
        .expect("pre-migration Replay V2 request resolved");
    let resolved_v2_readback = resolved_v2.readback().expect("resolved sealed V2 readback");
    assert_eq!(
        resolved_v2_readback.canonical_request_bytes(),
        sealed_v2.canonical_request_bytes(),
    );
    assert_eq!(resolved_v2_readback.locator(), sealed_v2.locator().clone());
    assert_eq!(
        request_counts_v2(
            rd_pool,
            fixture.proposal_v2.request.request_identity.as_str(),
        )
        .await,
        [1, 1, 1]
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM public.rd_exploratory_replay_requests_v1",
        )
        .fetch_one(rd_pool)
        .await
        .unwrap(),
        26
    );

    let legacy_before = legacy_replay_fingerprint(rd_pool).await;
    let direct_ddl_denied = sqlx::query(
        "CREATE TABLE public.rd_runtime_legacy_replay_fault_must_be_denied_v1
         (sentinel BOOLEAN PRIMARY KEY)",
    )
    .execute(rd_pool)
    .await
    .expect_err("runtime R&D Owner must not create public relations");
    assert_eq!(
        direct_ddl_denied
            .as_database_error()
            .and_then(|error| error.code()),
        Some(std::borrow::Cow::Borrowed("42501"))
    );
    for denied_pool in [
        rd_pool,
        mutation.pool(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
        fixture.database.owner_topology_admin_pool(),
    ] {
        let direct_fixture_denied = sqlx::query(
            "SELECT vibe_test_legacy_replay_fault.create_duplicate_current_candidate_v1($1)",
        )
        .bind(mutation.marker_identity())
        .execute(denied_pool)
        .await
        .expect_err("non-fixture role must not execute legacy Replay fault");
        assert_eq!(
            direct_fixture_denied
                .as_database_error()
                .and_then(|error| error.code()),
            Some(std::borrow::Cow::Borrowed("42501"))
        );
    }

    let fault = fixture
        .database
        .admit_legacy_replay_duplicate_fault()
        .await
        .expect("exact one-shot legacy Replay fault");
    let wrong_marker_denied = fault
        .try_wrong_marker("wrong-legacy-replay-marker")
        .await
        .expect_err("wrong legacy Replay marker must fail closed");
    assert_eq!(
        wrong_marker_denied
            .as_database_error()
            .and_then(|error| error.code()),
        Some(std::borrow::Cow::Borrowed("55000"))
    );
    assert!(
        sqlx::query_scalar::<_, bool>(
            "SELECT pg_catalog.to_regclass(
               'public.rd_exploratory_replay_request_custody_v1'
             ) IS NULL",
        )
        .fetch_one(rd_pool)
        .await
        .expect("wrong marker zero mutation")
    );
    let used_fault = fault
        .create_duplicate()
        .await
        .expect("duplicate internal Replay candidate");
    let second_use_denied = used_fault
        .retry()
        .await
        .expect_err("legacy Replay fault must self-revoke");
    assert_eq!(
        second_use_denied
            .as_database_error()
            .and_then(|error| error.code()),
        Some(std::borrow::Cow::Borrowed("42501"))
    );
    let duplicate_authority_is_exact: bool = sqlx::query_scalar(
        "SELECT owner.rolname='rd_owner'
            AND pg_catalog.has_table_privilege(
              'surprise_replay_grantee',relation.oid,'SELECT,UPDATE'
            )
            AND NOT EXISTS (
              SELECT 1
                FROM pg_catalog.aclexplode(COALESCE(
                  relation.relacl,
                  pg_catalog.acldefault('r',relation.relowner)
                )) acl
               WHERE acl.grantee<>relation.relowner
                 AND acl.grantee<>pg_catalog.to_regrole('surprise_replay_grantee')::oid
            )
           FROM pg_catalog.pg_class relation
           JOIN pg_catalog.pg_roles owner ON owner.oid=relation.relowner
          WHERE relation.oid=
            'public.rd_exploratory_replay_request_custody_v1'::pg_catalog.regclass",
    )
    .fetch_one(rd_pool)
    .await
    .expect("duplicate internal Replay authority");
    assert!(duplicate_authority_is_exact);
    let duplicate_is_fixed_source: bool = sqlx::query_scalar(
        "SELECT pg_catalog.count(*)=1
            AND pg_catalog.bool_and(
              request_identity='internal-continuity-replay-v1'
            )
            AND (
              SELECT pg_catalog.to_jsonb(duplicate)
                FROM public.rd_exploratory_replay_request_custody_v1 duplicate
            )=(
              SELECT pg_catalog.to_jsonb(sealed)
                FROM public.rd_sealed_exploratory_replay_requests_v1 sealed
               WHERE request_identity='internal-continuity-replay-v1'
            )
           FROM public.rd_exploratory_replay_request_custody_v1",
    )
    .fetch_one(rd_pool)
    .await
    .expect("fixed legacy Replay duplicate source");
    assert!(duplicate_is_fixed_source);

    let duplicate_before = [
        replay_candidate_fingerprint(rd_pool, ReplayCandidateTable::Internal).await,
        replay_candidate_fingerprint(rd_pool, ReplayCandidateTable::Sealed).await,
    ];
    assert!(
        PostgresResearchGoalOwnerV1::connect_with_backtest(
            &fixture.rd_url,
            &fixture.qualification_url,
            &fixture.backtest_url,
        )
        .await
        .is_err(),
        "duplicate internal and sealed Replay candidates must fail closed"
    );
    let duplicate_after = [
        replay_candidate_fingerprint(rd_pool, ReplayCandidateTable::Internal).await,
        replay_candidate_fingerprint(rd_pool, ReplayCandidateTable::Sealed).await,
    ];
    assert_eq!(duplicate_after, duplicate_before);

    sqlx::query("DROP TABLE public.rd_exploratory_replay_request_custody_v1")
        .execute(rd_pool)
        .await
        .expect("remove duplicate internal Replay test candidate");
    assert_eq!(legacy_replay_fingerprint(rd_pool).await, legacy_before);
}

#[tokio::test]
#[ignore = "requires the canonical disposable Origin-current PostgreSQL route"]
async fn origin_current_replay_table_renames_with_exact_v1_v2_read_continuity() {
    let fixture = Box::pin(prepare_replay_fixture(3_600_000)).await;
    let mutation = fixture.database.mutation();
    let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
    let sealed_v1 = fixture
        .owner
        .commit_exploratory_replay_request_v1(fixture.proposal.clone())
        .await
        .expect("Origin-current Replay V1 request committed");
    let sealed_v2 = fixture
        .owner
        .commit_exploratory_replay_request_v2(fixture.proposal_v2.clone())
        .await
        .expect("Origin-current Replay V2 request committed");

    sqlx::query(
        "ALTER TABLE public.rd_sealed_exploratory_replay_requests_v1
         RENAME TO rd_exploratory_replay_requests_v1",
    )
    .execute(rd_pool)
    .await
    .expect("restore Origin current Replay table name");
    let restarted = PostgresResearchGoalOwnerV1::connect_with_backtest(
        &fixture.rd_url,
        &fixture.qualification_url,
        &fixture.backtest_url,
    )
    .await
    .expect("Origin current Replay custody migrated");
    let names_are_exact: bool = sqlx::query_scalar(
        "SELECT pg_catalog.to_regclass('public.rd_exploratory_replay_requests_v1') IS NULL
            AND pg_catalog.to_regclass('public.rd_exploratory_replay_request_custody_v1') IS NULL
            AND pg_catalog.to_regclass('public.rd_sealed_exploratory_replay_requests_v1') IS NOT NULL",
    )
    .fetch_one(rd_pool)
    .await
    .expect("Origin current Replay relation names");
    assert!(names_are_exact);
    let sealed_is_owner_private: bool = sqlx::query_scalar(
        "SELECT owner.rolname='rd_owner'
            AND NOT EXISTS (
              SELECT 1
                FROM pg_catalog.aclexplode(COALESCE(
                  relation.relacl,
                  pg_catalog.acldefault('r',relation.relowner)
                )) acl
               WHERE acl.grantee<>relation.relowner
            )
            AND NOT EXISTS (
              SELECT 1
                FROM pg_catalog.pg_attribute attribute
                CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl
               WHERE attribute.attrelid=relation.oid
                 AND attribute.attnum>0
                 AND NOT attribute.attisdropped
                 AND acl.grantee<>relation.relowner
            )
           FROM pg_catalog.pg_class relation
           JOIN pg_catalog.pg_roles owner ON owner.oid=relation.relowner
          WHERE relation.oid='public.rd_sealed_exploratory_replay_requests_v1'::pg_catalog.regclass",
    )
    .fetch_one(rd_pool)
    .await
    .expect("Origin current sealed Replay ACL");
    assert!(sealed_is_owner_private);

    let locked_v1 = restarted
        .lock_exploratory_replay_request_for_backtest_v1(sealed_v1.locator())
        .await
        .expect("Origin-current Replay V1 request locked");
    let committed_v1_json = serde_json::to_value(&sealed_v1).unwrap();
    let locked_v1_json = serde_json::to_value(&locked_v1).unwrap();
    assert_eq!(
        locked_v1_json.pointer("/readback/frozen"),
        committed_v1_json.pointer("/frozen")
    );
    assert_eq!(
        locked_v1_json.pointer("/readback/receipt"),
        committed_v1_json.pointer("/receipt")
    );

    let locked_v2 = restarted
        .lock_exploratory_replay_request_for_backtest_v2(sealed_v2.locator())
        .await
        .expect("Origin-current Replay V2 request locked");
    let locked_v2_readback = locked_v2.readback().expect("Origin-current V2 readback");
    assert_eq!(locked_v2_readback.locator(), sealed_v2.locator().clone());
    assert_eq!(
        locked_v2_readback.canonical_request_bytes(),
        sealed_v2.canonical_request_bytes()
    );

    let resolved_v2 = restarted
        .resolve_exploratory_replay_request_v2(&ExploratoryReplayRecoverySelectorV2 {
            request_identity: sealed_v2.locator().request_identity.clone(),
            meaning_digest: sealed_v2.locator().meaning_digest.clone(),
        })
        .await
        .expect("Origin-current Replay V2 request resolved");
    let resolved_v2_readback = resolved_v2
        .readback()
        .expect("resolved Origin-current V2 readback");
    assert_eq!(resolved_v2_readback.locator(), sealed_v2.locator().clone());
    assert_eq!(
        resolved_v2_readback.canonical_request_bytes(),
        sealed_v2.canonical_request_bytes()
    );
}

#[tokio::test]
#[ignore = "requires the canonical disposable five-role PostgreSQL route"]
async fn replay_at_or_after_valid_through_writes_no_frozen_row_or_outbox() {
    let fixture = Box::pin(prepare_replay_fixture(60_000)).await;
    let blocker_pool = PgPool::connect(&fixture.edge_url)
        .await
        .expect("Product Edge blocker pool");
    let mut blocker = blocker_pool.begin().await.expect("blocker transaction");
    sqlx::query(
        "SELECT request_identity FROM product_edge_request_admissions_v1 WHERE request_identity IN ($1,$2) ORDER BY request_identity FOR UPDATE",
    )
    .bind(&fixture.proposal.admission.request_identity)
    .bind(&fixture.proposal.build_request_identity)
    .fetch_all(&mut *blocker)
    .await
    .expect("locked Replay and Artifact admission rows");

    let owner = fixture.owner.clone();
    let proposal = fixture.proposal.clone();
    let request_identity = proposal.request_identity.clone();

    let commit_future = async move { owner.commit_exploratory_replay_request_v1(proposal).await };

    let commit = tokio::spawn(commit_future);

    loop {
        let database_cut: i64 = sqlx::query_scalar(
            "SELECT pg_catalog.floor(extract(epoch FROM pg_catalog.clock_timestamp()) * 1000)::bigint",
        )
        .fetch_one(&blocker_pool)
        .await
        .expect("database clock");

        if u64::try_from(database_cut).unwrap() >= fixture.valid_through_epoch_ms {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    blocker.commit().await.expect("release admission row locks");

    assert!(matches!(
        commit.await.expect("Replay commit task"),
        Err(ExploratoryReplayOwnerError::Unavailable(_))
    ));
    assert_eq!(
        request_counts(
            fixture
                .database
                .mutation()
                .pool(CanonicalOwnerTestRoleV1::RdOwner),
            &request_identity,
        )
        .await,
        [0, 0]
    );
}

async fn assert_rd_owner_resolves_only_prior_same_identity_replay_v2_custody() {
    let fixture = Box::pin(prepare_replay_fixture(3_600_000)).await;
    let mutation = fixture.database.mutation();
    let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
    let v2_catalog_is_exact: bool = sqlx::query_scalar(
        "SELECT facade_owner.rolname='rd_owner'
             AND facade.prosecdef
             AND facade.provolatile='v'
             AND facade.proparallel='u'
             AND facade.proisstrict
             AND facade.proconfig=ARRAY['search_path=pg_catalog']::text[]
             AND pg_catalog.strpos(facade.prosrc,'verify_exploratory_replay_request_internal_v2') > 0
             AND pg_catalog.has_function_privilege('backtest_owner',facade.oid,'EXECUTE')
             AND NOT pg_catalog.has_function_privilege('rd_owner',facade.oid,'EXECUTE')
             AND helper_owner.rolname='rd_owner'
             AND NOT helper.prosecdef
             AND helper.provolatile='v'
             AND helper.proparallel='u'
             AND helper.proisstrict
             AND helper.proconfig=ARRAY['search_path=pg_catalog']::text[]
             AND pg_catalog.has_function_privilege('rd_owner',helper.oid,'EXECUTE')
             AND NOT pg_catalog.has_function_privilege('backtest_owner',helper.oid,'EXECUTE')
             AND NOT EXISTS (
               SELECT 1 FROM pg_catalog.aclexplode(helper.proacl) acl
                WHERE acl.privilege_type='EXECUTE'
                  AND acl.grantee<>helper_owner.oid
             )
             AND recovery_owner.rolname='rd_owner'
             AND NOT recovery.prosecdef
             AND recovery.provolatile='v'
             AND recovery.proparallel='u'
             AND recovery.proisstrict
             AND recovery.proconfig=ARRAY['search_path=pg_catalog']::text[]
             AND pg_catalog.strpos(recovery.prosrc,'verify_exploratory_replay_request_internal_v2') > 0
             AND pg_catalog.has_function_privilege('rd_owner',recovery.oid,'EXECUTE')
             AND NOT pg_catalog.has_function_privilege('backtest_owner',recovery.oid,'EXECUTE')
             AND NOT EXISTS (
               SELECT 1 FROM pg_catalog.aclexplode(recovery.proacl) acl
                WHERE acl.privilege_type='EXECUTE'
                  AND acl.grantee<>recovery_owner.oid
             )
          FROM pg_catalog.pg_proc facade
          JOIN pg_catalog.pg_roles facade_owner ON facade_owner.oid=facade.proowner
          JOIN pg_catalog.pg_proc helper
            ON helper.oid=pg_catalog.to_regprocedure(
              'rd_owner_api.verify_exploratory_replay_request_internal_v2(text,text,text,text)'
            )
          JOIN pg_catalog.pg_roles helper_owner ON helper_owner.oid=helper.proowner
          JOIN pg_catalog.pg_proc recovery
            ON recovery.oid=pg_catalog.to_regprocedure(
              'rd_owner_api.resolve_exploratory_replay_request_v2(text,text)'
            )
          JOIN pg_catalog.pg_roles recovery_owner ON recovery_owner.oid=recovery.proowner
         WHERE facade.oid=pg_catalog.to_regprocedure(
           'rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text)'
         )",
    )
    .fetch_one(rd_pool)
    .await
    .expect("Replay V2 resolve and Backtest facade catalog");
    assert!(v2_catalog_is_exact);

    for role in [
        CanonicalOwnerTestRoleV1::BacktestOwner,
        CanonicalOwnerTestRoleV1::ProductEdgeOwner,
        CanonicalOwnerTestRoleV1::QualificationWriter,
        CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter,
    ] {
        assert!(
            sqlx::query_scalar::<_, Option<serde_json::Value>>(
                "SELECT rd_owner_api.resolve_exploratory_replay_request_v2($1,$2)",
            )
            .bind("unknown")
            .bind("unknown")
            .fetch_one(mutation.pool(role))
            .await
            .is_err()
        );
    }
    let request_identity = fixture
        .proposal_v2
        .request
        .request_identity
        .as_str()
        .to_string();
    let pre_run_owner =
        PostgresResearchGoalOwnerV1::connect_existing(&fixture.rd_url, &fixture.qualification_url)
            .await
            .expect("pre-RUN R&D Owner without Backtest capability");
    let unknown = ExploratoryReplayRecoverySelectorV2 {
        request_identity: format!("{request_identity}-unknown"),
        meaning_digest: format!("sha256:{}", "1".repeat(64)),
    };
    let expected_request = ReplayRequestV2::try_from(fixture.proposal_v2.request.clone()).unwrap();
    let selector = ExploratoryReplayRecoverySelectorV2 {
        request_identity: request_identity.clone(),
        meaning_digest: expected_request
            .meaning_digest()
            .unwrap()
            .as_str()
            .to_string(),
    };
    let unavailable = pre_run_owner
        .resolve_sealed_exploratory_replay_request_v2(&unknown)
        .await
        .expect("unknown Replay V2 resolve");
    assert_eq!(
        unavailable.projection().availability,
        ExploratoryReplayAvailabilityV1::Unavailable
    );
    assert_eq!(
        unavailable.projection().request_identity.as_str(),
        unknown.request_identity.as_str()
    );
    assert!(unavailable.readback().is_none());
    assert_eq!(
        request_counts_v2(rd_pool, &unknown.request_identity).await,
        [0, 0, 0]
    );
    drop(pre_run_owner);

    let lost_response = fixture
        .owner
        .commit_exploratory_replay_request_v2(fixture.proposal_v2.clone())
        .await
        .expect("prior committed Replay V2 custody");
    // Retain only test oracles; recovery below receives neither receipt nor seal.
    let expected_locator = lost_response.locator().clone();
    let expected_canonical_request_bytes = lost_response.canonical_request_bytes().to_vec();
    drop(lost_response);
    let counts_after_commit = request_counts_v2(rd_pool, &request_identity).await;
    let rd_only_owner =
        PostgresResearchGoalOwnerV1::connect_existing(&fixture.rd_url, &fixture.qualification_url)
            .await
            .expect("reconnected R&D Owner without Backtest capability");
    let resolved = rd_only_owner
        .resolve_sealed_exploratory_replay_request_v2(&selector)
        .await
        .expect("pre-send-selector R&D resolve after response loss");
    let readback = resolved.readback().expect("sealed R&D readback");
    let recovered_locator = readback.locator();
    assert_eq!(recovered_locator, expected_locator);
    assert_eq!(readback.request(), &expected_request);
    assert_eq!(readback.request_identity(), selector.request_identity);
    assert_eq!(readback.meaning_digest(), selector.meaning_digest);
    assert_eq!(
        readback.canonical_request_bytes(),
        expected_canonical_request_bytes
    );
    let locked = fixture
        .owner
        .lock_exploratory_replay_request_for_backtest_v2(&recovered_locator)
        .await
        .expect("Backtest consumes recovered full Owner locator");
    assert_eq!(
        locked
            .readback()
            .expect("Backtest sealed readback")
            .canonical_request_bytes(),
        expected_canonical_request_bytes
    );

    let (resolved_one, resolved_two, resolved_three) = tokio::join!(
        rd_only_owner.resolve_sealed_exploratory_replay_request_v2(&selector),
        rd_only_owner.resolve_sealed_exploratory_replay_request_v2(&selector),
        rd_only_owner.resolve_sealed_exploratory_replay_request_v2(&selector),
    );

    for replay in [resolved_one, resolved_two, resolved_three] {
        let replay = replay.expect("concurrent R&D resolve");
        let replay_readback = replay.readback().expect("concurrent sealed readback");
        assert_eq!(
            replay_readback.canonical_request_bytes(),
            expected_canonical_request_bytes
        );
        assert_eq!(replay_readback.locator(), expected_locator);
    }
    assert_eq!(
        request_counts_v2(rd_pool, &request_identity).await,
        counts_after_commit
    );

    for changed in [
        ExploratoryReplayRecoverySelectorV2 {
            request_identity: unknown.request_identity.clone(),
            meaning_digest: selector.meaning_digest.clone(),
        },
        ExploratoryReplayRecoverySelectorV2 {
            request_identity: selector.request_identity.clone(),
            meaning_digest: unknown.meaning_digest.clone(),
        },
    ] {
        let unavailable = rd_only_owner
            .resolve_sealed_exploratory_replay_request_v2(&changed)
            .await
            .expect("wrong or cross-spliced selector resolve");
        assert_eq!(
            unavailable.projection().availability,
            ExploratoryReplayAvailabilityV1::Unavailable
        );
        assert!(unavailable.readback().is_none());
    }
    assert_eq!(
        request_counts_v2(rd_pool, &request_identity).await,
        counts_after_commit
    );

    let legacy = fixture
        .owner
        .commit_exploratory_replay_request_v1(fixture.proposal.clone())
        .await
        .expect("prior committed Replay V1 custody");
    let v1_as_v2 = ExploratoryReplayRecoverySelectorV2 {
        request_identity: legacy.locator().request_identity.clone(),
        meaning_digest: selector.meaning_digest.clone(),
    };
    let unavailable = rd_only_owner
        .resolve_sealed_exploratory_replay_request_v2(&v1_as_v2)
        .await
        .expect("V1 custody through V2 namespace");
    assert_eq!(
        unavailable.projection().availability,
        ExploratoryReplayAvailabilityV1::Unavailable
    );
    assert!(unavailable.readback().is_none());
    assert_eq!(
        request_counts_v2(rd_pool, &legacy.locator().request_identity).await,
        [1, 1, 0]
    );
}

#[rstest]
#[ignore = "requires the canonical disposable five-role PostgreSQL route"]
fn frozen_exploratory_replay_request_is_sealed_for_canonical_backtest_owner() {
    std::thread::Builder::new()
        .name("frozen-exploratory-replay-request-owner-test".into())
        .stack_size(16 * 1024 * 1024)
        .spawn(|| {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(
                    run_frozen_exploratory_replay_request_is_sealed_for_canonical_backtest_owner(),
                );
        })
        .unwrap()
        .join()
        .unwrap();
}

async fn run_frozen_exploratory_replay_request_is_sealed_for_canonical_backtest_owner() {
    Box::pin(assert_rd_owner_resolves_only_prior_same_identity_replay_v2_custody()).await;

    let fixture = Box::pin(prepare_replay_fixture(3_600_000)).await;
    let ReplayFixture {
        database,
        owner,
        edge,
        rd_url,
        qualification_url,
        backtest_url,
        proposal,
        proposal_v2,
        ..
    } = fixture;
    let mutation = database.mutation();

    let mut mismatched_meaning = proposal.clone();
    mismatched_meaning.request_identity.push_str("-mismatched");
    mismatched_meaning.admission = placeholder_admission(&mismatched_meaning.request_identity);
    mismatched_meaning = edge.admit_replay(mismatched_meaning).await;
    mismatched_meaning.deterministic_seed += 1;
    mismatched_meaning.dataset = binding("dataset-v2", '9');
    assert!(matches!(
        owner
            .commit_exploratory_replay_request_v1(mismatched_meaning.clone())
            .await,
        Err(ExploratoryReplayOwnerError::Unavailable(_))
    ));
    assert_eq!(
        request_counts(
            mutation.pool(CanonicalOwnerTestRoleV1::RdOwner),
            &mismatched_meaning.request_identity,
        )
        .await,
        [0, 0]
    );

    let mut matching_new_meaning = proposal.clone();
    matching_new_meaning
        .request_identity
        .push_str("-matching-new-meaning");
    matching_new_meaning.deterministic_seed += 1;
    matching_new_meaning.dataset = binding("dataset-v2", '9');
    matching_new_meaning.admission = placeholder_admission(&matching_new_meaning.request_identity);
    matching_new_meaning = edge.admit_replay(matching_new_meaning).await;
    let matching_new = owner
        .commit_exploratory_replay_request_v1(matching_new_meaning.clone())
        .await
        .expect("fresh Replay meaning with exact full admission");
    assert_eq!(
        matching_new.projection().availability,
        ExploratoryReplayAvailabilityV1::Available
    );
    assert_eq!(
        request_counts(
            mutation.pool(CanonicalOwnerTestRoleV1::RdOwner),
            &matching_new_meaning.request_identity,
        )
        .await,
        [1, 1]
    );

    let mut tampered_locator = proposal.clone();
    tampered_locator
        .request_identity
        .push_str("-tampered-locator");
    tampered_locator.admission = placeholder_admission(&tampered_locator.request_identity);
    tampered_locator = edge.admit_replay(tampered_locator).await;
    tampered_locator.admission.admission_digest = format!("sha256:{}", "f".repeat(64));
    assert!(matches!(
        owner
            .commit_exploratory_replay_request_v1(tampered_locator.clone())
            .await,
        Err(ExploratoryReplayOwnerError::Unavailable(_))
    ));
    assert_eq!(
        request_counts(
            mutation.pool(CanonicalOwnerTestRoleV1::RdOwner),
            &tampered_locator.request_identity,
        )
        .await,
        [0, 0]
    );

    for (index, pointer) in [
        "/frozen_research_intent/digest",
        "/trial_family/digest",
        "/trial_family_census_frontier/digest",
        "/artifact/digest",
    ]
    .into_iter()
    .enumerate()
    {
        let false_lineage_identity = format!(
            "{}-false-owner-lineage-{index}",
            proposal_v2.request.request_identity.as_str()
        );
        let mut false_lineage = proposal_v2.clone();
        false_lineage.request.request_identity = opaque(&false_lineage_identity);
        let mut request_json = serde_json::to_value(&false_lineage.request).unwrap();
        let digest = request_json
            .pointer(pointer)
            .and_then(serde_json::Value::as_str)
            .unwrap();
        let mut changed_digest = digest.to_string();
        let last = changed_digest.pop().unwrap();
        changed_digest.push(if last == 'f' { 'e' } else { 'f' });
        *request_json.pointer_mut(pointer).unwrap() = serde_json::json!(changed_digest);
        false_lineage.request = serde_json::from_value(request_json).unwrap();
        false_lineage.admission = placeholder_admission(&false_lineage_identity);
        false_lineage = edge.admit_replay_v2(false_lineage).await;
        assert!(matches!(
            owner
                .commit_exploratory_replay_request_v2(false_lineage)
                .await,
            Err(ExploratoryReplayOwnerError::Unavailable(_))
        ));
        assert_eq!(
            request_counts_v2(
                mutation.pool(CanonicalOwnerTestRoleV1::RdOwner),
                &false_lineage_identity,
            )
            .await,
            [0, 0, 0]
        );
    }

    let sealed_v2 = owner
        .commit_exploratory_replay_request_v2(proposal_v2.clone())
        .await
        .expect("frozen Replay V2 request");
    let expected_v2 = ReplayRequestV2::try_from(proposal_v2.request.clone()).unwrap();
    assert_eq!(
        sealed_v2.canonical_request_bytes(),
        expected_v2.to_canonical_bytes().unwrap()
    );
    assert_eq!(
        sealed_v2.locator().meaning_digest,
        expected_v2.meaning_digest().unwrap().as_str()
    );
    assert_eq!(
        request_counts_v2(
            mutation.pool(CanonicalOwnerTestRoleV1::RdOwner),
            proposal_v2.request.request_identity.as_str(),
        )
        .await,
        [1, 1, 1]
    );
    let locked_v2 = owner
        .lock_exploratory_replay_request_for_backtest_v2(sealed_v2.locator())
        .await
        .expect("canonical Replay V2 Backtest lock");
    assert_eq!(
        locked_v2.projection().availability,
        ExploratoryReplayAvailabilityV1::Available
    );
    assert_eq!(
        locked_v2.readback().unwrap().canonical_request_bytes(),
        sealed_v2.canonical_request_bytes()
    );
    let committed_v2_cut: i64 = sqlx::query_scalar(
        "SELECT committed_at_epoch_ms FROM public.rd_sealed_exploratory_replay_requests_v1 WHERE request_identity=$1",
    )
    .bind(proposal_v2.request.request_identity.as_str())
    .fetch_one(mutation.pool(CanonicalOwnerTestRoleV1::RdOwner))
    .await
    .unwrap();
    assert!(locked_v2.readback().unwrap().owner_cut_epoch_ms() >= committed_v2_cut as u64);

    let (legacy_projection_json, lineage_request_digest, lineage_receipt_identity): (
        serde_json::Value,
        String,
        String,
    ) = sqlx::query_as(
        "SELECT frozen_json->'proposal',request_digest,receipt_json->>'receipt_identity' FROM public.rd_sealed_exploratory_replay_requests_v1 WHERE request_identity=$1",
    )
    .bind(proposal_v2.request.request_identity.as_str())
    .fetch_one(mutation.pool(CanonicalOwnerTestRoleV1::RdOwner))
    .await
    .unwrap();
    let legacy_projection: ExploratoryReplayRequestProposalV1 =
        serde_json::from_value(legacy_projection_json).unwrap();
    let legacy_v1_locator = ExploratoryReplayRequestLocatorV1 {
        request_identity: proposal_v2.request.request_identity.as_str().to_string(),
        request_digest: lineage_request_digest,
        receipt_identity: lineage_receipt_identity,
    };
    assert!(matches!(
        owner
            .commit_exploratory_replay_request_v1(legacy_projection.clone())
            .await,
        Err(ExploratoryReplayOwnerError::Unavailable(_))
    ));
    assert_unavailable(&owner, &legacy_v1_locator).await;
    assert_eq!(
        request_counts_v2(
            mutation.pool(CanonicalOwnerTestRoleV1::RdOwner),
            proposal_v2.request.request_identity.as_str(),
        )
        .await,
        [1, 1, 1]
    );

    for (index, (pointer, replacement)) in replay_v2_tamper_cases(&proposal_v2.request)
        .into_iter()
        .enumerate()
    {
        let identity = format!(
            "{}-tamper-{index}",
            proposal_v2.request.request_identity.as_str()
        );
        let mut changed = proposal_v2.clone();
        changed.request.request_identity = opaque(&identity);
        changed.admission = placeholder_admission(&identity);
        changed = edge.admit_replay_v2(changed).await;
        let mut value = serde_json::to_value(&changed.request).unwrap();
        *value
            .pointer_mut(&pointer)
            .expect("Replay V2 tamper pointer") = replacement;
        changed.request = serde_json::from_value(value).expect("valid tampered Replay V2 DTO");
        assert!(matches!(
            owner.commit_exploratory_replay_request_v2(changed).await,
            Err(ExploratoryReplayOwnerError::Unavailable(_))
        ));
        assert_eq!(
            request_counts_v2(mutation.pool(CanonicalOwnerTestRoleV1::RdOwner), &identity).await,
            [0, 0, 0]
        );
    }

    let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
    let (original_v2_bytes, original_v2_meaning, original_v2_seal, original_v2_receipt): (
        Vec<u8>,
        String,
        String,
        serde_json::Value,
    ) = sqlx::query_as(
        "SELECT v2_canonical_request_bytes,v2_meaning_digest,v2_seal_digest,v2_receipt_json FROM public.rd_sealed_exploratory_replay_requests_v1 WHERE request_identity=$1",
    )
    .bind(proposal_v2.request.request_identity.as_str())
    .fetch_one(rd_pool)
    .await
    .unwrap();
    sqlx::query("UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET v2_canonical_request_bytes=v2_canonical_request_bytes||decode('20','hex') WHERE request_identity=$1")
        .bind(proposal_v2.request.request_identity.as_str()).execute(rd_pool).await.unwrap();
    assert_unavailable_v2(&owner, sealed_v2.locator()).await;
    sqlx::query("UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET v2_canonical_request_bytes=$2 WHERE request_identity=$1")
        .bind(proposal_v2.request.request_identity.as_str()).bind(&original_v2_bytes).execute(rd_pool).await.unwrap();

    sqlx::query("UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET v2_canonical_request_bytes=NULL,v2_meaning_digest=NULL,v2_seal_digest=NULL,v2_receipt_json=NULL,request_schema_version=1 WHERE request_identity=$1")
        .bind(proposal_v2.request.request_identity.as_str()).execute(rd_pool).await.unwrap();
    assert!(matches!(
        owner
            .commit_exploratory_replay_request_v1(legacy_projection)
            .await,
        Err(ExploratoryReplayOwnerError::Unavailable(_))
    ));
    assert_unavailable(&owner, &legacy_v1_locator).await;
    assert_unavailable_v2(&owner, sealed_v2.locator()).await;
    assert_eq!(
        request_counts_v2(
            mutation.pool(CanonicalOwnerTestRoleV1::RdOwner),
            proposal_v2.request.request_identity.as_str(),
        )
        .await,
        [1, 1, 1]
    );
    sqlx::query("UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET v2_canonical_request_bytes=$2,v2_meaning_digest=$3,v2_seal_digest=$4,v2_receipt_json=$5,request_schema_version=2 WHERE request_identity=$1")
        .bind(proposal_v2.request.request_identity.as_str())
        .bind(&original_v2_bytes)
        .bind(original_v2_meaning)
        .bind(original_v2_seal)
        .bind(original_v2_receipt)
        .execute(rd_pool).await.unwrap();

    let legacy_only = ExploratoryReplayRequestLocatorV2 {
        request_identity: proposal.request_identity.clone(),
        meaning_digest: format!("sha256:{}", "1".repeat(64)),
        receipt_identity: "legacy-v1-receipt-only".into(),
        seal_digest: format!("sha256:{}", "2".repeat(64)),
    };
    assert_unavailable_v2(&owner, &legacy_only).await;

    let mut wrong_revoked_locator = sealed_v2.locator().clone();
    wrong_revoked_locator.seal_digest = format!("sha256:{}", "0".repeat(64));
    sqlx::query("UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET lifecycle_state='REVOKED' WHERE request_identity=$1")
        .bind(proposal_v2.request.request_identity.as_str()).execute(rd_pool).await.unwrap();
    assert_backtest_unavailable_v2(&owner, &wrong_revoked_locator).await;
    assert_recovery_stale_v2(&owner, &wrong_revoked_locator).await;
    sqlx::query("UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET v2_canonical_request_bytes=v2_canonical_request_bytes||decode('20','hex') WHERE request_identity=$1")
        .bind(proposal_v2.request.request_identity.as_str()).execute(rd_pool).await.unwrap();
    assert_unavailable_v2(&owner, sealed_v2.locator()).await;
    sqlx::query("UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET v2_canonical_request_bytes=$2 WHERE request_identity=$1")
        .bind(proposal_v2.request.request_identity.as_str()).bind(&original_v2_bytes).execute(rd_pool).await.unwrap();
    let stale_v2 = owner
        .lock_exploratory_replay_request_for_backtest_v2(sealed_v2.locator())
        .await
        .unwrap();
    assert_eq!(
        stale_v2.projection().availability,
        ExploratoryReplayAvailabilityV1::Stale
    );
    assert_eq!(
        stale_v2.projection().next_legal_action,
        ExploratoryReplayNextLegalActionV1::ResolveOwnerCustody
    );
    assert!(stale_v2.readback().is_none());
    sqlx::query("UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET lifecycle_state='FROZEN' WHERE request_identity=$1")
        .bind(proposal_v2.request.request_identity.as_str()).execute(rd_pool).await.unwrap();

    let first = owner
        .commit_exploratory_replay_request_v1(proposal.clone())
        .await
        .expect("frozen exploratory request");
    edge.revoke_authorization().await;
    let replay = owner
        .commit_exploratory_replay_request_v1(proposal.clone())
        .await
        .expect("response-loss retry after authority revocation");
    let replay_v2 = owner
        .commit_exploratory_replay_request_v2(proposal_v2.clone())
        .await
        .expect("Replay V2 response-loss retry after authority revocation");
    assert_eq!(
        serde_json::to_value(&first).unwrap(),
        serde_json::to_value(&replay).unwrap()
    );
    assert_eq!(
        serde_json::to_value(&sealed_v2).unwrap(),
        serde_json::to_value(&replay_v2).unwrap()
    );
    assert_eq!(
        request_counts(
            mutation.pool(CanonicalOwnerTestRoleV1::RdOwner),
            &proposal.request_identity
        )
        .await,
        [1, 1]
    );

    let mut changed = proposal.clone();
    changed.deterministic_seed += 1;
    assert!(matches!(
        owner.commit_exploratory_replay_request_v1(changed).await,
        Err(ExploratoryReplayOwnerError::ConflictingReplay)
    ));
    let mut fresh = proposal.clone();
    fresh.request_identity.push_str("-fresh-after-revoke");
    assert!(matches!(
        owner
            .commit_exploratory_replay_request_v1(fresh.clone())
            .await,
        Err(ExploratoryReplayOwnerError::Unavailable(_))
    ));
    assert_eq!(
        request_counts(
            mutation.pool(CanonicalOwnerTestRoleV1::RdOwner),
            &fresh.request_identity
        )
        .await,
        [0, 0]
    );
    let mut foreign = proposal.clone();
    foreign.request_identity.push_str("-foreign");
    foreign.intent_identity.push_str("-foreign");
    assert!(
        owner
            .commit_exploratory_replay_request_v1(foreign.clone())
            .await
            .is_err()
    );
    assert_eq!(
        request_counts(
            mutation.pool(CanonicalOwnerTestRoleV1::RdOwner),
            &foreign.request_identity
        )
        .await,
        [0, 0]
    );

    let locked = owner
        .lock_exploratory_replay_request_for_backtest_v1(first.locator())
        .await
        .expect("canonical Backtest read");
    assert_eq!(
        locked.projection().availability,
        ExploratoryReplayAvailabilityV1::Available
    );
    assert_eq!(
        locked.readback().unwrap().request_identity(),
        proposal.request_identity
    );
    let available_envelope: serde_json::Value =
        sqlx::query_scalar("SELECT rd_owner_api.lock_exploratory_replay_request_v1($1,$2,$3)")
            .bind(&first.locator().request_identity)
            .bind(&first.locator().request_digest)
            .bind(&first.locator().receipt_identity)
            .fetch_one(mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner))
            .await
            .expect("canonical raw envelope");
    let impersonator_url = std::env::var("BACKTEST_IMPERSONATOR_TEST_DATABASE_URL")
        .expect("fresh impersonator database URL");
    assert_impersonator_rejected(
        &rd_url,
        &qualification_url,
        &impersonator_url,
        first.locator(),
        &available_envelope,
    )
    .await;
    assert_impersonator_rejected(
        &rd_url,
        &qualification_url,
        &impersonator_url,
        first.locator(),
        &serde_json::json!({"schema_version":1,"availability":"STALE"}),
    )
    .await;
    assert!(
        sqlx::query("SELECT * FROM public.rd_sealed_exploratory_replay_requests_v1")
            .fetch_one(mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner))
            .await
            .is_err()
    );

    for role in [
        CanonicalOwnerTestRoleV1::RdOwner,
        CanonicalOwnerTestRoleV1::ProductEdgeOwner,
        CanonicalOwnerTestRoleV1::QualificationWriter,
        CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter,
    ] {
        assert!(
            sqlx::query_scalar::<_, Option<serde_json::Value>>(
                "SELECT rd_owner_api.lock_exploratory_replay_request_v1($1,$2,$3)",
            )
            .bind(&first.locator().request_identity)
            .bind(&first.locator().request_digest)
            .bind(&first.locator().receipt_identity)
            .fetch_one(mutation.pool(role))
            .await
            .is_err()
        );
    }

    let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
    let publication_catalog_is_exact: bool = sqlx::query_scalar(
        "SELECT facade_owner.rolname='rd_owner'
             AND facade.prosecdef
             AND facade.provolatile='v'
             AND facade.proparallel='u'
             AND facade.proisstrict
             AND facade.proconfig=ARRAY['search_path=pg_catalog']::text[]
             AND pg_catalog.has_function_privilege('backtest_owner',facade.oid,'EXECUTE')
             AND NOT pg_catalog.has_function_privilege('rd_owner',facade.oid,'EXECUTE')
             AND NOT EXISTS (
               SELECT 1 FROM pg_catalog.aclexplode(facade.proacl) acl
                WHERE acl.privilege_type='EXECUTE'
                  AND acl.grantee<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='backtest_owner')
             )
             AND helper_owner.rolname='rd_owner'
             AND NOT helper.prosecdef
             AND helper.provolatile='v'
             AND helper.proparallel='u'
             AND helper.proisstrict
             AND helper.proconfig=ARRAY['search_path=pg_catalog']::text[]
             AND pg_catalog.has_function_privilege('rd_owner',helper.oid,'EXECUTE')
             AND NOT pg_catalog.has_function_privilege('backtest_owner',helper.oid,'EXECUTE')
             AND NOT EXISTS (
               SELECT 1 FROM pg_catalog.aclexplode(helper.proacl) acl
                WHERE acl.privilege_type='EXECUTE'
                  AND acl.grantee<>helper_owner.oid
             )
          FROM pg_catalog.pg_proc facade
          JOIN pg_catalog.pg_roles facade_owner ON facade_owner.oid=facade.proowner
          JOIN pg_catalog.pg_proc helper
            ON helper.oid=pg_catalog.to_regprocedure(
              'rd_owner_api.verify_exploratory_replay_request_internal_v1(text,text,text)'
            )
          JOIN pg_catalog.pg_roles helper_owner ON helper_owner.oid=helper.proowner
         WHERE facade.oid=pg_catalog.to_regprocedure(
           'rd_owner_api.lock_exploratory_replay_request_v1(text,text,text)'
         )",
    )
    .fetch_one(rd_pool)
    .await
    .expect("published replay verifier catalog");
    assert!(publication_catalog_is_exact);

    let internal_envelope: serde_json::Value = sqlx::query_scalar(
        "SELECT rd_owner_api.verify_exploratory_replay_request_internal_v1($1,$2,$3)",
    )
    .bind(&first.locator().request_identity)
    .bind(&first.locator().request_digest)
    .bind(&first.locator().receipt_identity)
    .fetch_one(rd_pool)
    .await
    .expect("R&D-internal sealed verifier");
    assert_eq!(
        internal_envelope
            .get("availability")
            .and_then(serde_json::Value::as_str),
        Some("AVAILABLE")
    );

    for role in [
        CanonicalOwnerTestRoleV1::BacktestOwner,
        CanonicalOwnerTestRoleV1::ProductEdgeOwner,
        CanonicalOwnerTestRoleV1::QualificationWriter,
        CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter,
    ] {
        assert!(
            sqlx::query_scalar::<_, Option<serde_json::Value>>(
                "SELECT rd_owner_api.verify_exploratory_replay_request_internal_v1($1,$2,$3)",
            )
            .bind(&first.locator().request_identity)
            .bind(&first.locator().request_digest)
            .bind(&first.locator().receipt_identity)
            .fetch_one(mutation.pool(role))
            .await
            .is_err()
        );
    }

    for (break_sql, restore_sql) in [
        (
            "UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET request_digest=request_digest||'-tampered' WHERE request_identity=$1",
            "UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET request_digest=frozen_json->>'request_digest' WHERE request_identity=$1",
        ),
        (
            "UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET committed_at_epoch_ms=committed_at_epoch_ms+1 WHERE request_identity=$1",
            "UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET committed_at_epoch_ms=(receipt_json->>'committed_at_epoch_ms')::bigint WHERE request_identity=$1",
        ),
    ] {
        sqlx::query(break_sql)
            .bind(&proposal.request_identity)
            .execute(rd_pool)
            .await
            .unwrap();
        assert_unavailable(&owner, first.locator()).await;
        assert_available_v2(&owner, sealed_v2.locator()).await;
        sqlx::query(restore_sql)
            .bind(&proposal.request_identity)
            .execute(rd_pool)
            .await
            .unwrap();
    }
    sqlx::query("UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET frozen_json=jsonb_set(frozen_json,'{proposal,dataset,digest}',to_jsonb('sha256:tampered'::text)) WHERE request_identity=$1")
        .bind(&proposal.request_identity).execute(rd_pool).await.unwrap();
    assert_unavailable(&owner, first.locator()).await;
    assert_available_v2(&owner, sealed_v2.locator()).await;
    sqlx::query("UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET frozen_json=jsonb_set(frozen_json,'{proposal,dataset,digest}',to_jsonb($2::text)) WHERE request_identity=$1")
        .bind(&proposal.request_identity).bind(&proposal.dataset.digest).execute(rd_pool).await.unwrap();
    sqlx::query("UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET frozen_json=jsonb_set(frozen_json,'{proposal,admission,admission_digest}',to_jsonb('sha256:tampered'::text)) WHERE request_identity=$1")
        .bind(&proposal.request_identity).execute(rd_pool).await.unwrap();
    assert_unavailable(&owner, first.locator()).await;
    sqlx::query("UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET frozen_json=jsonb_set(frozen_json,'{proposal,admission,admission_digest}',to_jsonb($2::text)) WHERE request_identity=$1")
        .bind(&proposal.request_identity).bind(&proposal.admission.admission_digest).execute(rd_pool).await.unwrap();
    let product_edge_request_semantic_digest =
        internal_envelope["frozen"]["product_edge_request_semantic_digest"]
            .as_str()
            .unwrap();
    sqlx::query("UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET frozen_json=jsonb_set(frozen_json,'{product_edge_request_semantic_digest}',to_jsonb('sha256:tampered'::text)) WHERE request_identity=$1")
        .bind(&proposal.request_identity).execute(rd_pool).await.unwrap();
    assert_unavailable(&owner, first.locator()).await;
    sqlx::query("UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET frozen_json=jsonb_set(frozen_json,'{product_edge_request_semantic_digest}',to_jsonb($2::text)) WHERE request_identity=$1")
        .bind(&proposal.request_identity).bind(product_edge_request_semantic_digest).execute(rd_pool).await.unwrap();
    sqlx::query("UPDATE public.rd_owner_outbox_v1 SET event_kind='MISSING_FOR_TEST' WHERE aggregate_identity=$1 AND event_kind='EXPLORATORY_REPLAY_REQUEST_FROZEN_V1'")
        .bind(&proposal.request_identity).execute(rd_pool).await.unwrap();
    assert_unavailable(&owner, first.locator()).await;
    assert_available_v2(&owner, sealed_v2.locator()).await;
    sqlx::query("UPDATE public.rd_owner_outbox_v1 SET event_kind='EXPLORATORY_REPLAY_REQUEST_FROZEN_V1' WHERE aggregate_identity=$1 AND event_kind='MISSING_FOR_TEST'")
        .bind(&proposal.request_identity).execute(rd_pool).await.unwrap();

    sqlx::query("UPDATE public.rd_artifact_trial_family_bindings_v1 SET binding_digest=binding_digest||'-tampered' WHERE binding_identity=$1")
        .bind(&proposal.artifact_family_binding_identity).execute(rd_pool).await.unwrap();
    assert_unavailable(&owner, first.locator()).await;
    assert_unavailable_v2(&owner, sealed_v2.locator()).await;
    sqlx::query("UPDATE public.rd_artifact_trial_family_bindings_v1 SET binding_digest=binding_json->>'binding_digest' WHERE binding_identity=$1")
        .bind(&proposal.artifact_family_binding_identity).execute(rd_pool).await.unwrap();

    for (break_sql, restore_sql, aggregate_identity) in [
        (
            "UPDATE public.rd_owner_outbox_v1 SET event_identity=event_identity||'-tampered' WHERE aggregate_identity=$1 AND event_kind='TRIAL_FAMILY_FROZEN_V1'",
            "UPDATE public.rd_owner_outbox_v1 outbox SET event_identity=request.frozen_json->>'trial_family_outbox_event_identity' FROM public.rd_sealed_exploratory_replay_requests_v1 request WHERE outbox.aggregate_identity=$1 AND outbox.event_kind='TRIAL_FAMILY_FROZEN_V1' AND request.request_identity=$2",
            proposal.trial_family_identity.as_str(),
        ),
        (
            "UPDATE public.rd_owner_outbox_v1 SET payload_digest=payload_digest||'-tampered' WHERE aggregate_identity=$1 AND event_kind='TRIAL_FAMILY_FROZEN_V1'",
            "UPDATE public.rd_owner_outbox_v1 outbox SET payload_digest=request.frozen_json->>'trial_family_outbox_digest' FROM public.rd_sealed_exploratory_replay_requests_v1 request WHERE outbox.aggregate_identity=$1 AND outbox.event_kind='TRIAL_FAMILY_FROZEN_V1' AND request.request_identity=$2",
            proposal.trial_family_identity.as_str(),
        ),
        (
            "UPDATE public.rd_owner_outbox_v1 SET committed_at_epoch_ms=committed_at_epoch_ms+1 WHERE aggregate_identity=$1 AND event_kind='TRIAL_FAMILY_FROZEN_V1'",
            "UPDATE public.rd_owner_outbox_v1 outbox SET committed_at_epoch_ms=(request.frozen_json->>'trial_family_outbox_committed_at_epoch_ms')::bigint FROM public.rd_sealed_exploratory_replay_requests_v1 request WHERE outbox.aggregate_identity=$1 AND outbox.event_kind='TRIAL_FAMILY_FROZEN_V1' AND request.request_identity=$2",
            proposal.trial_family_identity.as_str(),
        ),
        (
            "UPDATE public.rd_owner_outbox_v1 SET event_identity=event_identity||'-tampered' WHERE aggregate_identity=$1 AND event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1'",
            "UPDATE public.rd_owner_outbox_v1 outbox SET event_identity=request.frozen_json->>'artifact_family_outbox_event_identity' FROM public.rd_sealed_exploratory_replay_requests_v1 request WHERE outbox.aggregate_identity=$1 AND outbox.event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1' AND request.request_identity=$2",
            proposal.artifact_identity.as_str(),
        ),
        (
            "UPDATE public.rd_owner_outbox_v1 SET payload_digest=payload_digest||'-tampered' WHERE aggregate_identity=$1 AND event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1'",
            "UPDATE public.rd_owner_outbox_v1 outbox SET payload_digest=request.frozen_json->>'artifact_family_outbox_digest' FROM public.rd_sealed_exploratory_replay_requests_v1 request WHERE outbox.aggregate_identity=$1 AND outbox.event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1' AND request.request_identity=$2",
            proposal.artifact_identity.as_str(),
        ),
        (
            "UPDATE public.rd_owner_outbox_v1 SET committed_at_epoch_ms=committed_at_epoch_ms+1 WHERE aggregate_identity=$1 AND event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1'",
            "UPDATE public.rd_owner_outbox_v1 outbox SET committed_at_epoch_ms=(request.frozen_json->>'artifact_family_outbox_committed_at_epoch_ms')::bigint FROM public.rd_sealed_exploratory_replay_requests_v1 request WHERE outbox.aggregate_identity=$1 AND outbox.event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1' AND request.request_identity=$2",
            proposal.artifact_identity.as_str(),
        ),
    ] {
        sqlx::query(break_sql)
            .bind(aggregate_identity)
            .execute(rd_pool)
            .await
            .unwrap();
        assert!(matches!(
            owner
                .commit_exploratory_replay_request_v1(proposal.clone())
                .await,
            Err(ExploratoryReplayOwnerError::Unavailable(_))
        ));
        assert_unavailable(&owner, first.locator()).await;
        assert_unavailable_v2(&owner, sealed_v2.locator()).await;
        assert_eq!(
            request_counts(rd_pool, &proposal.request_identity).await,
            [1, 1]
        );
        sqlx::query(restore_sql)
            .bind(aggregate_identity)
            .bind(&proposal.request_identity)
            .execute(rd_pool)
            .await
            .unwrap();
        let restored = owner
            .commit_exploratory_replay_request_v1(proposal.clone())
            .await
            .expect("restored dependency outbox retry");
        assert_eq!(
            serde_json::to_value(&restored).unwrap(),
            serde_json::to_value(&first).unwrap()
        );
    }

    for (break_sql, restore_sql, aggregate_identity, restored_value) in [
        (
            "UPDATE public.rd_owner_outbox_v1 SET payload_json=jsonb_set(payload_json,'{intent_identity}',to_jsonb('foreign-intent'::text)) WHERE aggregate_identity=$1 AND event_kind='TRIAL_FAMILY_FROZEN_V1'",
            "UPDATE public.rd_owner_outbox_v1 SET payload_json=jsonb_set(payload_json,'{intent_identity}',to_jsonb($2::text)) WHERE aggregate_identity=$1 AND event_kind='TRIAL_FAMILY_FROZEN_V1'",
            proposal.trial_family_identity.as_str(),
            proposal.intent_identity.as_str(),
        ),
        (
            "UPDATE public.rd_owner_outbox_v1 SET payload_json=jsonb_set(payload_json,'{binding_identity}',to_jsonb('foreign-binding'::text)) WHERE aggregate_identity=$1 AND event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1'",
            "UPDATE public.rd_owner_outbox_v1 SET payload_json=jsonb_set(payload_json,'{binding_identity}',to_jsonb($2::text)) WHERE aggregate_identity=$1 AND event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1'",
            proposal.artifact_identity.as_str(),
            proposal.artifact_family_binding_identity.as_str(),
        ),
    ] {
        sqlx::query(break_sql)
            .bind(aggregate_identity)
            .execute(rd_pool)
            .await
            .unwrap();
        assert!(matches!(
            owner
                .commit_exploratory_replay_request_v1(proposal.clone())
                .await,
            Err(ExploratoryReplayOwnerError::Unavailable(_))
        ));
        assert_unavailable(&owner, first.locator()).await;
        assert_raw_lock_not_available(
            mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner),
            first.locator(),
        )
        .await;
        assert_eq!(
            request_counts(rd_pool, &proposal.request_identity).await,
            [1, 1]
        );
        sqlx::query(restore_sql)
            .bind(aggregate_identity)
            .bind(restored_value)
            .execute(rd_pool)
            .await
            .unwrap();
        let restored = owner
            .commit_exploratory_replay_request_v1(proposal.clone())
            .await
            .expect("restored historical outbox retry");
        assert_eq!(
            serde_json::to_value(&restored).unwrap(),
            serde_json::to_value(&first).unwrap()
        );
    }

    let (family_payload, family_digest): (serde_json::Value, String) = sqlx::query_as(
        "SELECT payload_json,payload_digest FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='TRIAL_FAMILY_FROZEN_V1'",
    )
    .bind(&proposal.trial_family_identity)
    .fetch_one(rd_pool)
    .await
    .unwrap();
    let mut tampered_family_payload = family_payload.clone();
    tampered_family_payload["intent_identity"] = serde_json::json!("foreign-intent");
    let tampered_family: TestFamilyFrozenOutboxV1 =
        serde_json::from_value(tampered_family_payload.clone()).unwrap();
    sqlx::query("UPDATE public.rd_owner_outbox_v1 SET payload_json=$2,payload_digest=$3 WHERE aggregate_identity=$1 AND event_kind='TRIAL_FAMILY_FROZEN_V1'")
        .bind(&proposal.trial_family_identity)
        .bind(tampered_family_payload)
        .bind(dependency_payload_digest(&tampered_family))
        .execute(rd_pool).await.unwrap();
    assert!(matches!(
        owner
            .commit_exploratory_replay_request_v1(proposal.clone())
            .await,
        Err(ExploratoryReplayOwnerError::Unavailable(_))
    ));
    assert_unavailable(&owner, first.locator()).await;
    assert_unavailable_v2(&owner, sealed_v2.locator()).await;
    assert_raw_lock_not_available(
        mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner),
        first.locator(),
    )
    .await;
    assert_eq!(
        request_counts(rd_pool, &proposal.request_identity).await,
        [1, 1]
    );
    sqlx::query("UPDATE public.rd_owner_outbox_v1 SET payload_json=$2,payload_digest=$3 WHERE aggregate_identity=$1 AND event_kind='TRIAL_FAMILY_FROZEN_V1'")
        .bind(&proposal.trial_family_identity).bind(family_payload).bind(family_digest)
        .execute(rd_pool).await.unwrap();

    let (artifact_payload, artifact_digest): (serde_json::Value, String) = sqlx::query_as(
        "SELECT payload_json,payload_digest FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1'",
    )
    .bind(&proposal.artifact_identity)
    .fetch_one(rd_pool)
    .await
    .unwrap();
    let mut tampered_artifact_payload = artifact_payload.clone();
    tampered_artifact_payload["binding_identity"] = serde_json::json!("foreign-binding");
    let tampered_artifact: TestArtifactBoundOutboxV1 =
        serde_json::from_value(tampered_artifact_payload.clone()).unwrap();
    sqlx::query("UPDATE public.rd_owner_outbox_v1 SET payload_json=$2,payload_digest=$3 WHERE aggregate_identity=$1 AND event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1'")
        .bind(&proposal.artifact_identity)
        .bind(tampered_artifact_payload)
        .bind(dependency_payload_digest(&tampered_artifact))
        .execute(rd_pool).await.unwrap();
    assert!(matches!(
        owner
            .commit_exploratory_replay_request_v1(proposal.clone())
            .await,
        Err(ExploratoryReplayOwnerError::Unavailable(_))
    ));
    assert_unavailable(&owner, first.locator()).await;
    assert_raw_lock_not_available(
        mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner),
        first.locator(),
    )
    .await;
    assert_eq!(
        request_counts(rd_pool, &proposal.request_identity).await,
        [1, 1]
    );
    sqlx::query("UPDATE public.rd_owner_outbox_v1 SET payload_json=$2,payload_digest=$3 WHERE aggregate_identity=$1 AND event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1'")
        .bind(&proposal.artifact_identity).bind(artifact_payload).bind(artifact_digest)
        .execute(rd_pool).await.unwrap();
    let restored = owner
        .commit_exploratory_replay_request_v1(proposal.clone())
        .await
        .expect("coordinated outbox tamper restored");
    assert_eq!(
        serde_json::to_value(&restored).unwrap(),
        serde_json::to_value(&first).unwrap()
    );

    let wasm_bytes: Vec<u8> = sqlx::query_scalar(
        "SELECT wasm_bytes FROM public.rd_strategy_artifacts_v1 WHERE artifact_digest=$1",
    )
    .bind(&proposal.artifact_identity)
    .fetch_one(rd_pool)
    .await
    .unwrap();
    sqlx::query("UPDATE public.rd_strategy_artifacts_v1 SET wasm_bytes=wasm_bytes||decode('00','hex') WHERE artifact_digest=$1")
        .bind(&proposal.artifact_identity).execute(rd_pool).await.unwrap();
    assert_unavailable(&owner, first.locator()).await;
    assert_unavailable_v2(&owner, sealed_v2.locator()).await;
    sqlx::query(
        "UPDATE public.rd_strategy_artifacts_v1 SET wasm_bytes=$2 WHERE artifact_digest=$1",
    )
    .bind(&proposal.artifact_identity)
    .bind(wasm_bytes)
    .execute(rd_pool)
    .await
    .unwrap();

    sqlx::query("UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET lifecycle_state='REVOKED' WHERE request_identity=$1")
        .bind(&proposal.request_identity).execute(rd_pool).await.unwrap();
    let stale = owner
        .lock_exploratory_replay_request_for_backtest_v1(first.locator())
        .await
        .unwrap();
    assert_eq!(
        stale.projection().availability,
        ExploratoryReplayAvailabilityV1::Stale
    );
    assert!(stale.readback().is_none());
    sqlx::query("UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET lifecycle_state='FROZEN' WHERE request_identity=$1")
        .bind(&proposal.request_identity).execute(rd_pool).await.unwrap();

    let restarted = PostgresResearchGoalOwnerV1::connect_with_backtest_existing(
        &rd_url,
        &qualification_url,
        &backtest_url,
    )
    .await
    .unwrap();
    let recovered = restarted
        .lock_exploratory_replay_request_for_backtest_v1(first.locator())
        .await
        .unwrap();
    assert_eq!(
        recovered.readback().unwrap().request_digest(),
        first.locator().request_digest
    );
    let recovered_v2 = restarted
        .lock_exploratory_replay_request_for_backtest_v2(sealed_v2.locator())
        .await
        .unwrap();
    assert_eq!(
        recovered_v2.readback().unwrap().canonical_request_bytes(),
        sealed_v2.canonical_request_bytes()
    );
}

async fn assert_unavailable(
    owner: &PostgresResearchGoalOwnerV1,
    locator: &ExploratoryReplayRequestLocatorV1,
) {
    let result = owner
        .lock_exploratory_replay_request_for_backtest_v1(locator)
        .await
        .unwrap();
    assert_eq!(
        result.projection().availability,
        ExploratoryReplayAvailabilityV1::Unavailable
    );
    assert!(result.readback().is_none());
}

async fn assert_unavailable_v2(
    owner: &PostgresResearchGoalOwnerV1,
    locator: &ExploratoryReplayRequestLocatorV2,
) {
    assert_backtest_unavailable_v2(owner, locator).await;
    let selector = ExploratoryReplayRecoverySelectorV2 {
        request_identity: locator.request_identity.clone(),
        meaning_digest: locator.meaning_digest.clone(),
    };
    let resolved = owner
        .resolve_exploratory_replay_request_v2(&selector)
        .await
        .unwrap();
    assert_eq!(
        resolved.projection().availability,
        ExploratoryReplayAvailabilityV1::Unavailable
    );
    assert!(resolved.readback().is_none());
}

async fn assert_backtest_unavailable_v2(
    owner: &PostgresResearchGoalOwnerV1,
    locator: &ExploratoryReplayRequestLocatorV2,
) {
    let result = owner
        .lock_exploratory_replay_request_for_backtest_v2(locator)
        .await
        .unwrap();
    assert_eq!(
        result.projection().availability,
        ExploratoryReplayAvailabilityV1::Unavailable
    );
    assert!(result.readback().is_none());
}

async fn assert_recovery_stale_v2(
    owner: &PostgresResearchGoalOwnerV1,
    locator: &ExploratoryReplayRequestLocatorV2,
) {
    let selector = ExploratoryReplayRecoverySelectorV2 {
        request_identity: locator.request_identity.clone(),
        meaning_digest: locator.meaning_digest.clone(),
    };
    let resolved = owner
        .resolve_exploratory_replay_request_v2(&selector)
        .await
        .unwrap();
    assert_eq!(
        resolved.projection().availability,
        ExploratoryReplayAvailabilityV1::Stale
    );
    assert_eq!(
        resolved.projection().next_legal_action,
        ExploratoryReplayNextLegalActionV1::ResolveOwnerCustody
    );
    assert!(resolved.readback().is_none());
}

async fn assert_available_v2(
    owner: &PostgresResearchGoalOwnerV1,
    locator: &ExploratoryReplayRequestLocatorV2,
) {
    let locked = owner
        .lock_exploratory_replay_request_for_backtest_v2(locator)
        .await
        .unwrap();
    assert_eq!(
        locked.projection().availability,
        ExploratoryReplayAvailabilityV1::Available
    );
    assert!(locked.readback().is_some());
    let selector = ExploratoryReplayRecoverySelectorV2 {
        request_identity: locator.request_identity.clone(),
        meaning_digest: locator.meaning_digest.clone(),
    };
    let resolved = owner
        .resolve_exploratory_replay_request_v2(&selector)
        .await
        .unwrap();
    assert_eq!(
        resolved.projection().availability,
        ExploratoryReplayAvailabilityV1::Available
    );
    assert_eq!(resolved.readback().unwrap().locator(), locator.clone());
}

async fn assert_raw_lock_not_available(
    backtest_pool: &PgPool,
    locator: &ExploratoryReplayRequestLocatorV1,
) {
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.lock_exploratory_replay_request_v1($1,$2,$3)")
            .bind(&locator.request_identity)
            .bind(&locator.request_digest)
            .bind(&locator.receipt_identity)
            .fetch_one(backtest_pool)
            .await
            .unwrap();
    assert_ne!(
        value
            .as_ref()
            .and_then(|envelope| envelope.get("availability"))
            .and_then(serde_json::Value::as_str),
        Some("AVAILABLE")
    );
}

fn dependency_payload_digest<T: Serialize>(payload: &T) -> String {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    let bytes = serde_json::to_vec(&Envelope {
        domain: "rd.owner-outbox.payload.v1",
        value: payload,
    })
    .unwrap();
    format!("sha256:{:x}", Sha256::digest(bytes))
}

async fn assert_impersonator_rejected(
    rd_url: &str,
    qualification_url: &str,
    impersonator_url: &str,
    locator: &ExploratoryReplayRequestLocatorV1,
    envelope: &serde_json::Value,
) {
    let encoded = BASE64.encode(serde_json::to_vec(envelope).unwrap());
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(impersonator_url)
        .await
        .expect("impersonating backtest_owner pool");
    let mut connection = pool.acquire().await.unwrap();
    let configured: String =
        sqlx::query_scalar("SELECT pg_catalog.set_config('vibe.fake_envelope_base64',$1,false)")
            .bind(&encoded)
            .fetch_one(&mut *connection)
            .await
            .expect("impersonator session envelope");
    assert_eq!(configured, encoded);
    let observed: serde_json::Value =
        sqlx::query_scalar("SELECT rd_owner_api.lock_exploratory_replay_request_v1($1,$2,$3)")
            .bind(&locator.request_identity)
            .bind(&locator.request_digest)
            .bind(&locator.receipt_identity)
            .fetch_one(&mut *connection)
            .await
            .expect("impersonator function envelope");
    assert_eq!(observed, *envelope);
    drop(connection);
    assert!(
        PostgresResearchGoalOwnerV1::connect_with_backtest_existing(
            rd_url,
            qualification_url,
            impersonator_url,
        )
        .await
        .is_err()
    );
}

async fn prepare_replay_fixture(validity_ms: u64) -> ReplayFixture {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable topology");
    let rd_url = database
        .database_url(CanonicalOwnerTestRoleV1::RdOwner)
        .to_string();
    let qualification_url = database
        .database_url(CanonicalOwnerTestRoleV1::QualificationWriter)
        .to_string();
    let backtest_url = database
        .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
        .to_string();
    let edge_url = database
        .database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner)
        .to_string();
    let issuer_url = database
        .database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter)
        .to_string();
    let product_edge_mutation = database.mutation();
    let product_edge_pool = product_edge_mutation.pool(CanonicalOwnerTestRoleV1::ProductEdgeOwner);
    let forbidden_ddl = sqlx::query(
        "CREATE TABLE public.product_edge_runtime_ddl_must_remain_forbidden_v1
         (sentinel BOOLEAN PRIMARY KEY)",
    )
    .execute(product_edge_pool)
    .await
    .expect_err("runtime Product Edge role must not create public relations");
    assert_eq!(
        forbidden_ddl
            .as_database_error()
            .and_then(|error| error.code()),
        Some(std::borrow::Cow::Borrowed("42501"))
    );
    let forbidden_temporary = sqlx::query(
        "CREATE TEMP TABLE product_edge_runtime_temporary_must_remain_forbidden_v1
         (sentinel BOOLEAN PRIMARY KEY)",
    )
    .execute(product_edge_pool)
    .await
    .expect_err("runtime Product Edge role must not create temporary relations");
    assert_eq!(
        forbidden_temporary
            .as_database_error()
            .and_then(|error| error.code()),
        Some(std::borrow::Cow::Borrowed("42501"))
    );
    let suffix = format!("expiry-{}", unique_suffix());
    let edge =
        TestProductEdge::bootstrap_with_validity(&issuer_url, &edge_url, &suffix, validity_ms)
            .await;
    let owner = PostgresResearchGoalOwnerV1::connect_with_backtest_existing(
        &rd_url,
        &qualification_url,
        &backtest_url,
    )
    .await
    .expect("R&D Owner");

    let research = edge
        .admit_research(research_request(&format!("research-{suffix}")))
        .await;
    let accepted = owner.submit_v2(research).await.expect("frozen Research");
    let research_receipt = accepted.owner_receipt().expect("research receipt");
    let intent_identity = research_receipt
        .resulting_research_intent_identity
        .as_deref()
        .expect("intent")
        .to_string();
    let build_request = edge
        .admit_artifact(ArtifactBuildRequestV1 {
            build_request_identity: format!("artifact-request-{suffix}"),
            attempt_identity: format!("artifact-attempt-{suffix}"),
            intent_identity: intent_identity.clone(),
            channel: ProductEdgeChannel::WindmillProductEdge,
            admission: placeholder_admission(&format!("artifact-request-{suffix}")),
        })
        .await;
    let socket = format!("/tmp/rd-exploratory-sandbox-{suffix}.sock");
    let _ = std::fs::remove_file(&socket);
    let listener = UnixListener::bind(&socket).expect("sandbox listener");
    let sandbox = tokio::spawn(serve_one_verified_sandbox(listener, socket.clone()));
    let artifact_owner = PostgresArtifactBuildOwnerV1::connect(&rd_url, &socket, u64::MAX)
        .await
        .expect("artifact Owner");
    assert_eq!(
        artifact_owner
            .prepare(build_request.clone())
            .await
            .expect("prepared artifact request")
            .resolution(),
        ArtifactBuildResolution::Prepared
    );
    let invocation_claim = edge
        .owner
        .claim_provider_invocation(ProductEdgeInvocationClaimRequestV1 {
            admission: build_request.admission.clone(),
            attempt_identity: build_request.attempt_identity.clone(),
        })
        .await
        .expect("Product Edge invocation claim");
    let reserved_invocation = artifact_owner
        .reserve_provider_invocation_custody(
            &build_request.build_request_identity,
            &build_request.attempt_identity,
            invocation_claim,
        )
        .await
        .expect("R&D invocation reservation");
    let (start_reservation, _invocation_custody) = reserved_invocation.into_parts();
    edge.owner
        .start_provider_invocation(start_reservation)
        .await
        .expect("Product Edge invocation start");
    let started_claim = edge
        .owner
        .resolve_provider_invocation_claim(
            &build_request.admission,
            &build_request.attempt_identity,
        )
        .await
        .expect("Product Edge invocation resolution")
        .expect("started Product Edge invocation claim");
    let terminal = artifact_owner
        .submit_candidate(
            build_request.clone(),
            ArtifactBuildCandidateV1 {
                schema_version: 1,
                candidate_identity: format!("agent-program-candidate-v1-{suffix}"),
                intent_identity: intent_identity.clone(),
                intent_semantic_digest: research_receipt.semantic_digest.clone(),
                logic: GeneratedStrategyLogicV1 {
                    signal: GeneratedSignalV1::Momentum,
                    direction: GeneratedDirectionV1::LongOnly,
                    lookback_bars: 24,
                    entry_threshold_bps: 50,
                    exit_threshold_bps: 10,
                },
                structured_logic_summary: "bounded deterministic exploratory candidate".into(),
                agent_change_explanation: "test-only deterministic artifact generation".into(),
            },
            Some(&started_claim),
        )
        .await
        .expect("artifact terminal");
    let artifact_receipt = terminal.owner_receipt().expect("artifact receipt");
    assert_eq!(
        artifact_receipt.disposition,
        ArtifactBuildDisposition::Success,
        "fixture candidate must produce a successful Artifact before awaiting sandbox completion"
    );
    let artifact_identity = artifact_receipt
        .artifact_identity
        .as_deref()
        .expect("successful artifact identity")
        .to_string();
    let build_receipt_identity = artifact_receipt
        .build_receipt_identity
        .as_deref()
        .expect("successful build receipt identity")
        .to_string();
    sandbox
        .await
        .expect("sandbox task")
        .expect("sandbox response");
    let review = terminal.artifact_review().expect("artifact review");
    let artifact_family = terminal
        .artifact_trial_family()
        .expect("artifact family binding");

    let request_identity = format!("exploratory-replay-request-{suffix}");
    let mut proposal = ExploratoryReplayRequestProposalV1 {
        request_identity: request_identity.clone(),
        admission: placeholder_admission(&request_identity),
        build_request_identity: build_request.build_request_identity.clone(),
        attempt_identity: build_request.attempt_identity.clone(),
        intent_identity,
        trial_family_identity: artifact_family
            .trial_family()
            .root()
            .trial_family_identity()
            .to_string(),
        artifact_identity,
        build_receipt_identity,
        artifact_family_binding_identity: artifact_family.binding().binding_identity().to_string(),
        census_frontier_identity: artifact_family
            .trial_family()
            .census_frontier()
            .frontier_identity()
            .to_string(),
        requested_pit_scope: binding("pit-scope-v1", '1'),
        dataset: binding("dataset-v1", '2'),
        feature_set: binding("feature-set-v1", '3'),
        strategy_spec: binding("strategy-spec-v1", '4'),
        exact_code_bytes_digest: review.build_receipt.wasm_digest.clone(),
        replay_config: binding("replay-config-v1", '5'),
        runtime_kernel: versioned("runtime-kernel", "1.0.0"),
        simulator: versioned("simulator", "1.0.0"),
        backtest_engine: versioned("backtest-engine", "1.0.0"),
        cost_model_identity: "cost-model-v1".into(),
        slippage_model_identity: "slippage-model-v1".into(),
        capacity_model_identity: "capacity-model-v1".into(),
        deterministic_seed: 42,
        range_start_epoch_ms: 1_704_067_200_000,
        range_end_epoch_ms: 1_735_689_600_000,
        calendar_identity: "calendar-utc-continuous-v1".into(),
        time_zone_identity: "UTC".into(),
    };
    proposal = edge.admit_replay(proposal).await;
    let request_identity_v2 = format!("exploratory-replay-request-v2-{suffix}");
    let proposal_v2 = edge
        .admit_replay_v2(ExploratoryReplayRequestProposalV2 {
            admission: placeholder_admission(&request_identity_v2),
            build_request_identity: build_request.build_request_identity.clone(),
            attempt_identity: build_request.attempt_identity.clone(),
            build_receipt_identity: proposal.build_receipt_identity.clone(),
            artifact_family_binding_identity: proposal.artifact_family_binding_identity.clone(),
            request: ReplayRequestDtoV2 {
                schema_version: 2,
                request_identity: opaque(&request_identity_v2),
                frozen_research_intent: content_v2(
                    &proposal.intent_identity,
                    &research_receipt.semantic_digest,
                ),
                trial_family: content_v2(
                    &proposal.trial_family_identity,
                    artifact_family.trial_family().root().root_digest(),
                ),
                trial_family_census_frontier: content_v2(
                    &proposal.census_frontier_identity,
                    artifact_family
                        .trial_family()
                        .census_frontier()
                        .frontier_digest(),
                ),
                replay_authority: ReplayAuthorityClaimV2::Exploratory,
                strategy_design: content_v2_hex("strategy-design-v2", '1'),
                strategy_plan: content_v2_hex("strategy-plan-v2", '2'),
                artifact: content_v2(
                    &proposal.artifact_identity,
                    &proposal.exact_code_bytes_digest,
                ),
                resolved_owner_inputs: content_v2_hex("resolved-owner-inputs-v2", '3'),
                pit_scope: content_v2_hex("pit-scope-v2", '4'),
                pit_snapshot: content_v2_hex("pit-snapshot-v2", '5'),
                universe_selection: content_v2_hex("universe-selection-v2", '6'),
                correction_rule: version_v2("correction-rule-v2", "v1"),
                market_semantics: version_v2("market-semantics-v2", "v1"),
                replay_configuration: content_v2_hex("replay-configuration-v2", '7'),
                models: ReplayModelProfilesV2 {
                    runtime_kernel: version_v2("runtime-kernel", "1.0.0"),
                    simulator: version_v2("simulator", "1.0.0"),
                    cost: version_v2("cost-model-v1", "v1"),
                    slippage: version_v2("slippage-model-v1", "v1"),
                    capacity: version_v2("capacity-model-v1", "v1"),
                },
                runner_operational_profile: version_v2("backtest-engine", "1.0.0"),
                diagnostic_policy: version_v2("diagnostic-policy-v2", "v1"),
                deterministic_seed: 42,
                window: ReplayWindowV2 {
                    start_event_ns: 1_704_067_200_000_000_000,
                    end_event_ns_exclusive: 1_735_689_600_000_000_000,
                },
                calendar: version_v2("calendar-utc-continuous-v1", "v1"),
                session: version_v2("continuous-session-v1", "v1"),
                time_zone: version_v2("UTC", "iana-2026a"),
                corporate_action_cut: content_v2_hex("corporate-action-cut-v2", '8'),
                historical_membership_cut: content_v2_hex("historical-membership-cut-v2", '9'),
            },
        })
        .await;

    let valid_through_epoch_ms = edge.valid_through_epoch_ms;
    ReplayFixture {
        database,
        owner,
        edge,
        rd_url,
        qualification_url,
        backtest_url,
        edge_url,
        proposal,
        proposal_v2,
        valid_through_epoch_ms,
    }
}

#[derive(Clone, Copy)]
enum ReplayCandidateTable {
    Internal,
    Sealed,
}

async fn replay_candidate_fingerprint(pool: &PgPool, table: ReplayCandidateTable) -> String {
    let (relation_name, rows_sql) = match table {
        ReplayCandidateTable::Internal => (
            "public.rd_exploratory_replay_request_custody_v1",
            "SELECT COALESCE(
               pg_catalog.jsonb_agg(pg_catalog.to_jsonb(candidate) ORDER BY request_identity),
               '[]'::pg_catalog.jsonb
             )::text
               FROM public.rd_exploratory_replay_request_custody_v1 candidate",
        ),
        ReplayCandidateTable::Sealed => (
            "public.rd_sealed_exploratory_replay_requests_v1",
            "SELECT COALESCE(
               pg_catalog.jsonb_agg(pg_catalog.to_jsonb(candidate) ORDER BY request_identity),
               '[]'::pg_catalog.jsonb
             )::text
               FROM public.rd_sealed_exploratory_replay_requests_v1 candidate",
        ),
    };
    let rows: String = sqlx::query_scalar(rows_sql)
        .fetch_one(pool)
        .await
        .expect("Replay candidate rows fingerprint");
    let catalog: String = sqlx::query_scalar(
        "SELECT pg_catalog.jsonb_build_object(
           'relation_name',relation.relname,
           'relation_kind',relation.relkind,
           'persistence',relation.relpersistence,
           'replica_identity',relation.relreplident,
           'relation_options',relation.reloptions,
           'owner',owner.rolname,
           'acl',COALESCE(relation.relacl::text,'<NULL>'),
           'comment',pg_catalog.obj_description(relation.oid,'pg_class'),
           'columns',ARRAY(
             SELECT pg_catalog.jsonb_build_object(
               'number',attribute.attnum,
               'name',attribute.attname,
               'type',pg_catalog.format_type(attribute.atttypid,attribute.atttypmod),
               'not_null',attribute.attnotnull,
               'identity',attribute.attidentity,
               'generated',attribute.attgenerated,
               'acl',COALESCE(attribute.attacl::text,'<NULL>'),
               'default',pg_catalog.pg_get_expr(default_entry.adbin,default_entry.adrelid)
             )
               FROM pg_catalog.pg_attribute attribute
               LEFT JOIN pg_catalog.pg_attrdef default_entry
                 ON default_entry.adrelid=attribute.attrelid
                AND default_entry.adnum=attribute.attnum
              WHERE attribute.attrelid=relation.oid
                AND attribute.attnum>0
                AND NOT attribute.attisdropped
              ORDER BY attribute.attnum
           ),
           'constraints',ARRAY(
             SELECT constraint_entry.conname || ':' ||
                    pg_catalog.pg_get_constraintdef(constraint_entry.oid,true)
               FROM pg_catalog.pg_constraint constraint_entry
              WHERE constraint_entry.conrelid=relation.oid
              ORDER BY constraint_entry.conname
           ),
           'indexes',ARRAY(
             SELECT pg_catalog.pg_get_indexdef(index_entry.indexrelid)
               FROM pg_catalog.pg_index index_entry
              WHERE index_entry.indrelid=relation.oid
              ORDER BY index_entry.indexrelid::pg_catalog.regclass::text
           )
         )::text
           FROM pg_catalog.pg_class relation
           JOIN pg_catalog.pg_roles owner ON owner.oid=relation.relowner
          WHERE relation.oid=pg_catalog.to_regclass($1)",
    )
    .bind(relation_name)
    .fetch_one(pool)
    .await
    .expect("Replay candidate catalog fingerprint");
    format!("{catalog}\n{rows}")
}

async fn legacy_replay_fingerprint(pool: &PgPool) -> String {
    sqlx::query_scalar(
        "SELECT pg_catalog.jsonb_build_object(
           'relation_oid',relation.oid,
           'owner',owner.rolname,
           'acl',COALESCE(relation.relacl::text,'<NULL>'),
           'comment',pg_catalog.obj_description(relation.oid,'pg_class'),
           'rows',(
             SELECT COALESCE(
               pg_catalog.jsonb_agg(pg_catalog.to_jsonb(legacy)
                 ORDER BY replay_request_identity),
               '[]'::pg_catalog.jsonb
             )
               FROM public.rd_exploratory_replay_requests_v1 legacy
           )
         )::text
           FROM pg_catalog.pg_class relation
           JOIN pg_catalog.pg_roles owner ON owner.oid=relation.relowner
          WHERE relation.oid=
            'public.rd_exploratory_replay_requests_v1'::pg_catalog.regclass",
    )
    .fetch_one(pool)
    .await
    .expect("legacy Replay fingerprint")
}

async fn request_counts(pool: &PgPool, identity: &str) -> [i64; 2] {
    [
        sqlx::query_scalar("SELECT COUNT(*) FROM public.rd_sealed_exploratory_replay_requests_v1 WHERE request_identity=$1")
            .bind(identity).fetch_one(pool).await.unwrap(),
        sqlx::query_scalar("SELECT COUNT(*) FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='EXPLORATORY_REPLAY_REQUEST_FROZEN_V1'")
            .bind(identity).fetch_one(pool).await.unwrap(),
    ]
}

async fn request_counts_v2(pool: &PgPool, identity: &str) -> [i64; 3] {
    [
        sqlx::query_scalar("SELECT COUNT(*) FROM public.rd_sealed_exploratory_replay_requests_v1 WHERE request_identity=$1")
            .bind(identity).fetch_one(pool).await.unwrap(),
        sqlx::query_scalar("SELECT COUNT(*) FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='EXPLORATORY_REPLAY_REQUEST_FROZEN_V1'")
            .bind(identity).fetch_one(pool).await.unwrap(),
        sqlx::query_scalar("SELECT COUNT(*) FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='EXPLORATORY_REPLAY_REQUEST_FROZEN_V2'")
            .bind(identity).fetch_one(pool).await.unwrap(),
    ]
}

fn replay_v2_tamper_cases(request: &ReplayRequestDtoV2) -> Vec<(String, serde_json::Value)> {
    fn visit(value: &serde_json::Value, path: &str, cases: &mut Vec<(String, serde_json::Value)>) {
        if path == "/replay_authority" {
            cases.push((
                path.to_string(),
                serde_json::json!({
                    "namespace":"PROTECTED",
                    "qualification_candidate_intake":{"identity":"tampered-intake","digest":format!("sha256:{}", "a".repeat(64))},
                    "holdout_reservation":{"identity":"tampered-holdout","digest":format!("sha256:{}", "b".repeat(64))},
                    "protected_replay_plan":{"identity":"tampered-plan","digest":format!("sha256:{}", "c".repeat(64))},
                    "protected_plan_cell":{"identity":"tampered-cell","digest":format!("sha256:{}", "d".repeat(64))}
                }),
            ));
            return;
        }

        match value {
            serde_json::Value::Object(object) => {
                for (key, child) in object {
                    visit(child, &format!("{path}/{key}"), cases);
                }
            }
            serde_json::Value::String(text) => {
                let replacement = if text.starts_with("sha256:") || text.starts_with("blake3:") {
                    let mut changed = text.clone();
                    let last = changed.pop().unwrap();
                    changed.push(if last == 'f' { 'e' } else { 'f' });
                    changed
                } else {
                    format!("{text}-tampered")
                };
                cases.push((path.to_string(), serde_json::Value::String(replacement)));
            }
            serde_json::Value::Number(number) => {
                let changed = number.as_u64().unwrap() + 1;
                cases.push((path.to_string(), serde_json::json!(changed)));
            }
            _ => panic!("Replay V2 request has an unsupported leaf at {path}"),
        }
    }

    let value = serde_json::to_value(request).unwrap();
    let mut cases = Vec::new();
    visit(&value, "", &mut cases);
    cases
}

async fn serve_one_verified_sandbox(listener: UnixListener, socket: String) -> anyhow::Result<()> {
    let (mut stream, _) = listener.accept().await?;
    let length = stream.read_u32().await? as usize;
    let mut bytes = vec![0; length];
    stream.read_exact(&mut bytes).await?;
    let request: serde_json::Value = serde_json::from_slice(&bytes)?;
    let source = request["source"].as_str().expect("sandbox source");
    let response = serde_json::to_vec(&serde_json::json!({
        "protocol": "rd-build-sandbox-v1",
        "outcome": "SUCCESS",
        "failure_code": null,
        "source_capsule_base64": BASE64.encode(source_capsule(source.as_bytes())?),
        "build_recipe_base64": BASE64.encode(build_recipe()),
        "wasm_one_base64": BASE64.encode(include_bytes!("../assets/program_complex_v1/program.first.wasm")),
        "wasm_two_base64": BASE64.encode(include_bytes!("../assets/program_complex_v1/program.first.wasm")),
    }))?;
    stream.write_u32(response.len() as u32).await?;
    stream.write_all(&response).await?;
    stream.flush().await?;
    std::fs::remove_file(socket)?;
    Ok(())
}

fn source_capsule(source: &[u8]) -> anyhow::Result<Vec<u8>> {
    const MANIFEST: &str = r#"[package]
name = "rd-generated-strategy"
version = "0.1.0"
edition = "2024"
rust-version = "1.97.1"
publish = false

[lib]
crate-type = ["cdylib"]
path = "src/lib.rs"

[workspace]

[profile.release]
panic = "abort"
opt-level = "z"
codegen-units = 1
lto = "fat"
strip = "symbols"
"#;
    const LOCK: &str = "# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n[[package]]\nname = \"rd-generated-strategy\"\nversion = \"0.1.0\"\n";
    let mut bytes = Vec::new();
    {
        let mut archive = tar::Builder::new(&mut bytes);

        for (path, content) in [
            ("Cargo.lock", LOCK.as_bytes()),
            ("Cargo.toml", MANIFEST.as_bytes()),
            ("src/lib.rs", source),
        ] {
            let mut header = tar::Header::new_gnu();
            header.set_size(content.len() as u64);
            header.set_mode(0o644);
            header.set_uid(0);
            header.set_gid(0);
            header.set_mtime(1);
            header.set_cksum();
            archive.append_data(&mut header, path, content)?;
        }
        archive.finish()?;
    }
    Ok(bytes)
}

fn build_recipe() -> Vec<u8> {
    let dockerfile = include_str!("../../../product/rd-workbench/Dockerfile.sandbox");
    let mut bytes = serde_json::to_vec(&serde_json::json!({
        "build_platform":"linux/arm64",
        "dependency_policy":"locked_no_external_dependencies",
        "dockerfile_sha256":format!("sha256:{:x}", Sha256::digest(dockerfile.as_bytes())),
        "frontend":"docker/dockerfile:1.20@sha256:26147acbda4f14c5add9946e2fd2ed543fc402884fd75146bd342a7f6271dc1d",
        "manifest":"Cargo.toml",
        "network_policy":"container_network_none_cargo_offline",
        "rust_image":"public.ecr.aws/docker/library/rust:1.97.1-slim-bookworm@sha256:99e09cb2284e2ddbb73a995deee3e91783fd04d177602ccf6eab326d778ee777",
        "rustc_commit":"8bab26f4f68e0e26f0bb7960be334d5b520ea452",
        "rustc_release":"1.97.1",
        "sandbox_policy":"rd-development-sandbox-container-v1",
        "schema_version":2,
        "target":"wasm32v1-none",
        "wasm_target":"rd_generated_strategy"
    })).unwrap();
    bytes.push(b'\n');
    bytes
}

struct TestProductEdge {
    owner: ProductEdgePostgresOwnerV1,
    issuer: OperatorAuthorizationIssuerPostgresV1,
    authorization: OperatorAuthorizationLocatorV1,
    authorization_frontier_identity: String,
    valid_through_epoch_ms: u64,
    proof: String,
}

impl TestProductEdge {
    async fn bootstrap_with_validity(
        issuer_url: &str,
        edge_url: &str,
        suffix: &str,
        validity_ms: u64,
    ) -> Self {
        let now = now();
        let valid_through = now + validity_ms;
        let mut manifests = vec![
            manifest(
                RESEARCH_GOAL_OPERATION_V2,
                RESEARCH_GOAL_SCHEMA_V2,
                vec!["R_AND_D_RESEARCH_MUTATION_V1".into()],
                now,
                valid_through,
            ),
            manifest(
                ARTIFACT_BUILD_OPERATION_V1,
                ARTIFACT_BUILD_SCHEMA_V1,
                vec![
                    "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".into(),
                    "R_AND_D_PROVIDER_INVOCATION_V1".into(),
                ],
                now,
                valid_through,
            ),
            manifest(
                EXPLORATORY_REPLAY_OPERATION_V1,
                EXPLORATORY_REPLAY_SCHEMA_V1,
                vec![EXPLORATORY_REPLAY_MUTATION_EFFECT_V1.into()],
                now,
                valid_through,
            ),
            manifest(
                EXPLORATORY_REPLAY_OPERATION_V2,
                EXPLORATORY_REPLAY_SCHEMA_V2,
                vec![EXPLORATORY_REPLAY_MUTATION_EFFECT_V2.into()],
                now,
                valid_through,
            ),
        ];
        manifests.sort_by_key(|manifest| manifest.manifest_identity().unwrap());
        let proof = format!("sha256:{}", "a".repeat(64));
        let issuer = OperatorAuthorizationIssuerPostgresV1::connect(issuer_url)
            .await
            .unwrap();
        let authorization = issuer
            .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: format!("oa-exploratory-{suffix}"),
                issuer_identity: "oa-exploratory-test-v1".into(),
                issuer_key_version: "key-v1".into(),
                scope: OperatorAuthorizationScopeV1 {
                    principal: format!("principal-{suffix}"),
                    audience: format!("R_AND_D:{suffix}"),
                    permissions: vec![
                        "research:artifact-build".into(),
                        "research:submit".into(),
                        "research:view".into(),
                    ],
                },
                request_proof_digest: proof.clone(),
                operation_manifests: manifests
                    .iter()
                    .map(|item| OperationManifestBindingV1 {
                        manifest_identity: item.manifest_identity().unwrap(),
                        manifest_digest: item.manifest_digest().unwrap(),
                    })
                    .collect(),
                not_before_epoch_ms: now - 1_000,
                valid_through_epoch_ms: valid_through,
                expected_revocation_head: "EMPTY".into(),
            })
            .await
            .unwrap();
        let deployment = format!("pe-exploratory-{suffix}");
        let owner = ProductEdgePostgresOwnerV1::connect_existing(
            edge_url,
            &deployment,
            ProductEdgeAuthorizationTrustV1 {
                issuer_identity: "oa-exploratory-test-v1".into(),
                issuer_key_version: "key-v1".into(),
                audience: format!("R_AND_D:{suffix}"),
            },
        )
        .await
        .unwrap();
        owner
            .bootstrap_genesis(ProductEdgeBootstrapProposalV1 {
                deployment_identity: deployment,
                binding_identity: format!("pe-binding-exploratory-{suffix}"),
                expected_history_head: "EMPTY".into(),
                generation: 1,
                effective_principal: format!("principal-{suffix}"),
                scope_policy_version: "scope-v1".into(),
                capability_policy_version: "capability-v1".into(),
                audit_policy_version: "audit-v1".into(),
                valid_from_epoch_ms: now - 1_000,
                valid_through_epoch_ms: valid_through,
                authorization: authorization.locator(),
                manifests,
            })
            .await
            .unwrap();
        Self {
            owner,
            issuer,
            authorization: authorization.locator(),
            authorization_frontier_identity: authorization
                .frontier()
                .frontier_identity()
                .to_string(),
            valid_through_epoch_ms: valid_through,
            proof,
        }
    }

    async fn revoke_authorization(&self) {
        self.issuer
            .revoke(OperatorAuthorizationRevocationProposalV1 {
                authorization: self.authorization.clone(),
                expected_frontier_identity: self.authorization_frontier_identity.clone(),
                reason_code: "RESPONSE_LOSS_RETRY_TEST".into(),
            })
            .await
            .expect("revoke original Product Edge authorization");
    }

    async fn admit_research(
        &self,
        mut request: ProductEdgeResearchGoalRequestV2,
    ) -> ProductEdgeResearchGoalRequestV2 {
        request.admission = self.admit(&request.request_identity, serde_json::json!({"request_identity":request.request_identity,"channel":request.channel,"goal":request.goal,"trial_family_proposal":request.trial_family_proposal}), RESEARCH_GOAL_OPERATION_V2, RESEARCH_GOAL_SCHEMA_V2, vec!["R_AND_D_RESEARCH_MUTATION_V1".into()]).await;
        request
    }

    async fn admit_artifact(&self, mut request: ArtifactBuildRequestV1) -> ArtifactBuildRequestV1 {
        request.admission = self
            .owner
            .admit_artifact_build_request(ProductEdgeAdmissionRequestV1 {
                request_identity: request.build_request_identity.clone(),
                typed_payload: serde_json::json!({
                    "build_request_identity": request.build_request_identity,
                    "attempt_identity": request.attempt_identity,
                    "intent_identity": request.intent_identity,
                    "channel": request.channel,
                }),
                operation: ARTIFACT_BUILD_OPERATION_V1.into(),
                operation_schema: ARTIFACT_BUILD_SCHEMA_V1.into(),
                target_owner: RESEARCH_OWNER_V1.into(),
                requested_effects: vec![
                    "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".into(),
                    "R_AND_D_PROVIDER_INVOCATION_V1".into(),
                ],
                request_proof_digest: self.proof.clone(),
                audit_correlation: format!("test:{}", request.build_request_identity),
            })
            .await
            .unwrap()
            .locator()
            .clone();
        request
    }

    async fn admit_replay(
        &self,
        mut proposal: ExploratoryReplayRequestProposalV1,
    ) -> ExploratoryReplayRequestProposalV1 {
        let mut payload = serde_json::to_value(&proposal).unwrap();
        payload.as_object_mut().unwrap().remove("admission");
        proposal.admission = self
            .admit(
                &proposal.request_identity,
                payload,
                EXPLORATORY_REPLAY_OPERATION_V1,
                EXPLORATORY_REPLAY_SCHEMA_V1,
                vec![EXPLORATORY_REPLAY_MUTATION_EFFECT_V1.into()],
            )
            .await;
        proposal
    }

    async fn admit_replay_v2(
        &self,
        mut proposal: ExploratoryReplayRequestProposalV2,
    ) -> ExploratoryReplayRequestProposalV2 {
        let mut payload = serde_json::to_value(&proposal).unwrap();
        payload.as_object_mut().unwrap().remove("admission");
        proposal.admission = self
            .admit(
                proposal.request.request_identity.as_str(),
                payload,
                EXPLORATORY_REPLAY_OPERATION_V2,
                EXPLORATORY_REPLAY_SCHEMA_V2,
                vec![EXPLORATORY_REPLAY_MUTATION_EFFECT_V2.into()],
            )
            .await;
        proposal
    }

    async fn admit(
        &self,
        identity: &str,
        payload: serde_json::Value,
        operation: &str,
        schema: &str,
        effects: Vec<String>,
    ) -> vibe_product_edge::ProductEdgeAdmissionLocatorV1 {
        self.owner
            .admit_request(ProductEdgeAdmissionRequestV1 {
                request_identity: identity.into(),
                typed_payload: payload,
                operation: operation.into(),
                operation_schema: schema.into(),
                target_owner: RESEARCH_OWNER_V1.into(),
                requested_effects: effects,
                request_proof_digest: self.proof.clone(),
                audit_correlation: format!("test:{identity}"),
            })
            .await
            .unwrap()
            .locator()
            .clone()
    }
}

fn manifest(
    operation: &str,
    schema: &str,
    effects: Vec<String>,
    now: u64,
    valid_through: u64,
) -> AgentOperationManifestProposalV1 {
    AgentOperationManifestProposalV1 {
        operation: operation.into(),
        operation_schema: schema.into(),
        target_owner: RESEARCH_OWNER_V1.into(),
        allowed_effects: effects,
        prohibited_effects: vec!["REAL_TRADING_V1".into()],
        capability_policy_digest: format!("sha256:{}", "b".repeat(64)),
        effective_from_epoch_ms: now - 1_000,
        valid_through_epoch_ms: valid_through,
    }
}

#[tokio::test]
#[ignore = "run only by the disposable PostgreSQL deployment boundary"]
async fn product_edge_schema_is_provisioned_before_runtime_connections() {
    let edge_url = std::env::var("PRODUCT_EDGE_TEST_DATABASE_URL")
        .expect("disposable Product Edge migration URL");
    ProductEdgePostgresOwnerV1::connect(
        &edge_url,
        "product-edge-test-schema-migration-v1",
        ProductEdgeAuthorizationTrustV1 {
            issuer_identity: "product-edge-test-schema-migration-v1".into(),
            issuer_key_version: "test-key-v1".into(),
            audience: "R_AND_D".into(),
        },
    )
    .await
    .expect("canonical Product Edge schema migration");
}

#[tokio::test]
#[ignore = "run only by the disposable PostgreSQL deployment boundary"]
async fn rd_owner_schema_is_provisioned_before_runtime_connections() {
    let rd_url =
        std::env::var("RD_OWNER_FRESH_TEST_DATABASE_URL").expect("disposable R&D migration URL");
    let qualification_url = std::env::var("QUALIFICATION_WRITER_FRESH_TEST_DATABASE_URL")
        .expect("disposable Qualification validation URL");
    PostgresResearchGoalOwnerV1::connect(&rd_url, &qualification_url)
        .await
        .expect("canonical R&D Owner schema migration");
}

fn research_request(identity: &str) -> ProductEdgeResearchGoalRequestV2 {
    ProductEdgeResearchGoalRequestV2 {
        request_identity: identity.into(),
        channel: ProductEdgeChannel::WindmillProductEdge,
        admission: placeholder_admission(identity),
        goal: SourcedResearchGoalV2 {
            hypothesis: "PIT momentum survives exact costs".into(),
            mechanism: "bounded information diffusion".into(),
            falsification_question: "does exact cost remove the effect".into(),
            expected_observation: "net continuation remains positive".into(),
            required_data: vec!["PIT bars".into()],
            cost_assumption: "frozen cost model".into(),
            capacity_assumption: "frozen capacity model".into(),
            sources: vec![ResearchSourceV1 {
                locator: "https://example.com/research".into(),
                content_digest: format!("sha256:{}", "c".repeat(64)),
                observed_at: "2026-08-24T00:00:00Z".into(),
                source_cut: "source-cut-v1".into(),
                license_basis: "public research".into(),
                interpretation: "bounded interpretation".into(),
            }],
        },
        trial_family_proposal: TrialFamilyProposalV1 {
            trial_budget: 8,
            stop_rule: "stop on falsifier or budget".into(),
            pit_rule_identity: "pit-rule-v1".into(),
            cost_model_identity: "cost-model-v1".into(),
            slippage_model_identity: "slippage-model-v1".into(),
            capacity_model_identity: "capacity-model-v1".into(),
            independence_rationale: "Owner-resolved predecessor census".into(),
        },
    }
}

fn placeholder_admission(identity: &str) -> vibe_product_edge::ProductEdgeAdmissionLocatorV1 {
    vibe_product_edge::ProductEdgeAdmissionLocatorV1 {
        request_identity: identity.into(),
        admission_identity: format!("placeholder-{identity}"),
        admission_digest: format!("sha256:{}", "d".repeat(64)),
    }
}

fn binding(identity: &str, digit: char) -> IdentityDigestV1 {
    IdentityDigestV1 {
        identity: identity.into(),
        digest: format!("sha256:{}", digit.to_string().repeat(64)),
    }
}
fn versioned(identity: &str, version: &str) -> VersionedIdentityV1 {
    VersionedIdentityV1 {
        identity: identity.into(),
        version: version.into(),
    }
}
fn opaque(value: &str) -> OpaqueIdentityV2 {
    OpaqueIdentityV2::try_from(value.to_string()).unwrap()
}
fn digest_v2(value: &str) -> CanonicalDigestV2 {
    CanonicalDigestV2::try_from(value.to_string()).unwrap()
}
fn content_v2(identity: &str, digest: &str) -> ContentIdentityV2 {
    ContentIdentityV2 {
        identity: opaque(identity),
        digest: digest_v2(digest),
    }
}
fn content_v2_hex(identity: &str, digit: char) -> ContentIdentityV2 {
    content_v2(
        identity,
        &format!("sha256:{}", digit.to_string().repeat(64)),
    )
}
fn version_v2(identity: &str, version: &str) -> VersionedIdentityV2 {
    VersionedIdentityV2 {
        identity: opaque(identity),
        version: opaque(version),
    }
}
fn unique_suffix() -> String {
    format!("{}-{}", std::process::id(), now())
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}
