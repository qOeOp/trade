//! The crate's own tests: the Owner API's routes over its composition, and `required_env`.
//!
//! Each test keeps the name the ordered chain selects it by
//! (`vibe-strategy-factory-rd-owner-api|vibe_strategy_factory_rd_owner_api|tests::...`).

use vibe_postgres_connect::{PgPoolOptionsExt, PostgresTls};
/// Installs a subscriber so the servers this module spawns can be heard.
///
/// The acceptance harness serves `dashboard_read_api` and the Owner API in-process with
/// `tokio::spawn`, and a test does not run `main`, which held the crate's only subscriber. The
/// read API's thirteen `tracing::warn!` sites were therefore formatted and dropped, including
/// the one that names why a Formation Catalog read answered 503. A line that is written and a
/// line that is emitted are two different histories, and the log a reader greps looks the same
/// under both, so the absence of that line was read as the handler not having run.
///
/// It shares the process's one subscriber with the chain's warning collector. Installed as a
/// subscriber of its own, it took that slot first and left the collector nowhere to go, so the
/// ordered chain reported this entry as not observed. Installed once per process; a process may
/// host more than one test.
#[cfg(all(
    feature = "sealed-artifact-source-browser-acceptance",
    feature = "sealed-source-intake-acceptance"
))]
fn install_acceptance_tracing() {
    use tracing_subscriber::Layer as _;

    let heard = tracing_subscriber::fmt::layer()
        .with_test_writer()
        .with_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .boxed();
    vibe_testkit::postgres::collect_warnings_into_test_log_alongside(Some(heard))
        .expect("the acceptance subscriber and the warning collector should install");
}

use std::{
    sync::atomic::{AtomicUsize, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(all(
    feature = "sealed-artifact-source-browser-acceptance",
    feature = "sealed-source-intake-acceptance"
))]
use crate::dashboard_read_api::{self, DashboardReadApiConfigV1, SourceIntakeReadConfigV1};
use async_trait::async_trait;
use rstest::rstest;
use sqlx::Row;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use vibe_data::owner::chain_market_base_v1::{
    CHAIN_MARKET_DATA_ACCEPTANCE_BASIS_V1, MarketDataAcceptanceBasisPointerV1,
    MarketDataAcceptanceBasisV1, ensure_market_data_acceptance_basis_v1,
};
use vibe_operator_authorization::{
    OperationManifestBindingV1, OperatorAuthorizationIssuanceProposalV1,
    OperatorAuthorizationIssuerPostgresV1, OperatorAuthorizationScopeV1,
};
use vibe_product_edge::{AgentOperationManifestProposalV1, ProductEdgeBootstrapProposalV1};
use vibe_product_edge::{
    ProductEdgeSubjectKindV1, ProductEdgeUnavailableReasonV1, ProductEdgeUnavailableV1,
};
#[cfg(all(
    feature = "sealed-artifact-source-browser-acceptance",
    feature = "sealed-source-intake-acceptance"
))]
use vibe_product_edge::{
    SOURCE_INTAKE_OPERATION_SCHEMA_V1, SOURCE_INTAKE_OPERATION_V1,
    SOURCE_INTAKE_REQUIRED_EFFECTS_V1, SOURCE_INTAKE_TARGET_OWNER_V1,
};
use vibe_rd_artifact_invocation_custody::{
    ArtifactInvocationReservationMeaningV1, seal_invocation_reservation,
};
#[cfg(feature = "sealed-source-intake-acceptance")]
use vibe_strategy_factory::replay_policy_catalog_sealed_acceptance_v2::ensure_replay_policy_catalog_fixture_v3;
#[cfg(all(
    feature = "sealed-artifact-source-browser-acceptance",
    feature = "sealed-source-intake-acceptance"
))]
use vibe_strategy_factory::source_intake::{
    ProductEdgeGatewayV1, SealedSourceIntakeEnvironmentV1, SourceIntakeOperationRequestV1,
    SourceIntakeOwnerV1, SourceInterpretationV1,
};
use vibe_strategy_factory::{
    ExploratoryReplayResultLocatorV2,
    artifact_build::{ARTIFACT_BUILD_SCOPE_V1, ReservedArtifactBuildInvocationV1},
    product_edge::{RESEARCH_SCOPE_V1, RESEARCH_VIEW_SCOPE_V1, ResearchSourceV1},
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

use crate::server::*;
use crate::*;
use vibe_strategy_factory::product_edge::ResearchGoalOwnerResultV2;

#[rstest]
fn composer_startup_uses_two_owner_urls_without_preissued_native_join() {
    let source = include_str!("main.rs");
    assert!(source.contains("MARKET_DATA_OWNER_DATABASE_URL"));
    assert!(source.contains("MARKET_DATA_RD_ROLE_SET_DATABASE_URL"));
    let removed_native_env = ["MARKET_DATA_COMPOSER", "_NATIVE_JOIN_LOCATORS_V1"].concat();
    let removed_native_issue = ["issue_composer", "_native_join_v1"].concat();
    let removed_native_connect = ["connect_with_writer", "_and_native_join"].concat();
    assert!(!source.contains(&removed_native_env));
    assert!(!source.contains(&removed_native_issue));
    assert!(!source.contains(&removed_native_connect));
    let forbidden_route = ["/v1/strategy-design-role-sets", "/resolve"].concat();
    assert!(!source.contains(&forbidden_route));
}

#[rstest]
fn startup_mode_admits_only_default_serve_or_exact_schema_materialization() {
    assert!(!schema_materialization_requested(&[]).unwrap());
    assert!(schema_materialization_requested(&["--materialize-schema".to_owned()]).unwrap());
    assert!(schema_materialization_requested(&["--unknown".to_owned()]).is_err());
    assert!(
        schema_materialization_requested(&[
            "--materialize-schema".to_owned(),
            "--unknown".to_owned(),
        ])
        .is_err()
    );
    let materializer = include_str!("main.rs")
        .split("if schema_materialization_requested(&arguments)?")
        .nth(1)
        .expect("materialization mode")
        .split("return Ok(())")
        .next()
        .expect("materialization boundary");
    assert!(materializer.contains("PostgresDevelopComposerStoreV2::materialize_schema"));
}

#[rstest]
fn research_readback_identity_accepts_only_bounded_route_safe_values() {
    assert!(valid_research_readback_identity(
        "research-request-v2/example:attempt_1.2"
    ));
    assert!(!valid_research_readback_identity(""));
    assert!(!valid_research_readback_identity("request identity"));
    assert!(!valid_research_readback_identity("request?identity"));
    assert!(!valid_research_readback_identity(&"x".repeat(193)));
}

#[tokio::test]
async fn deployment_store_consumer_seam_preserves_default_and_fails_closed_when_required() {
    assert!(
        bootstrap_deployment_store_admission_from_lookup(|_| None)
            .await
            .is_ok()
    );

    let invalid_mode = bootstrap_deployment_store_admission_from_lookup(|name| {
        (name == "DEPLOYMENT_STORE_ADMISSION_MODE").then(|| "positive".to_string())
    })
    .await
    .err()
    .expect("invalid mode must fail closed");
    assert!(
        invalid_mode
            .downcast_ref::<ResearchPitTerminalBootstrapError>()
            .is_some_and(|e| e.failure() == ResearchPitTerminalBootstrapFailure::InvalidMode)
    );
    let empty_mode = bootstrap_deployment_store_admission_from_lookup(|name| {
        (name == "DEPLOYMENT_STORE_ADMISSION_MODE").then(String::new)
    })
    .await
    .err()
    .expect("empty mode must fail closed");
    assert!(
        empty_mode
            .downcast_ref::<ResearchPitTerminalBootstrapError>()
            .is_some_and(|e| e.failure() == ResearchPitTerminalBootstrapFailure::InvalidMode)
    );

    let missing_head = bootstrap_deployment_store_admission_from_lookup(|name| match name {
        "DEPLOYMENT_STORE_ADMISSION_MODE" => Some("required".to_string()),
        "DEPLOYMENT_STORE_ENVIRONMENT_IDENTITY" => Some("test-environment".to_string()),
        "DEPLOYMENT_STORE_DEPLOYMENT_IDENTITY" => Some("rd-workbench-test".to_string()),
        _ => None,
    })
    .await
    .err()
    .expect("missing head must fail closed");
    assert!(
        missing_head
            .downcast_ref::<ResearchPitTerminalBootstrapError>()
            .is_some_and(|e| {
                e.failure() == ResearchPitTerminalBootstrapFailure::MissingRequiredIdentity
            })
    );

    let unavailable = bootstrap_deployment_store_admission_from_lookup(|name| match name {
        "DEPLOYMENT_STORE_ADMISSION_MODE" => Some("required".to_string()),
        "DEPLOYMENT_STORE_ENVIRONMENT_IDENTITY" => Some("test-environment".to_string()),
        "DEPLOYMENT_STORE_DEPLOYMENT_IDENTITY" => Some("rd-workbench-test".to_string()),
        "DEPLOYMENT_STORE_EXPECTED_HEAD_IDENTITY" => Some(format!("sha256:{}", "a".repeat(64))),
        _ => None,
    })
    .await
    .err()
    .expect("unavailable production admission must fail closed");
    assert!(
        unavailable
            .downcast_ref::<ResearchPitTerminalBootstrapError>()
            .is_some_and(|e| {
                e.failure() == ResearchPitTerminalBootstrapFailure::StoreAdmissionRejected
            })
    );
}

async fn assert_receiptless_artifact_unknown(response: Response) {
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(value["resolution"], "SUBMITTED_OR_UNKNOWN");
    assert_eq!(value["owner_receipt"], serde_json::Value::Null);
    assert_eq!(value["next_legal_action"], "RESOLVE_SAME_ATTEMPT_IDENTITY");
}

#[tokio::test]
async fn receiptless_artifact_failures_require_same_attempt_resolution() {
    for response in [
        artifact_error(
            &ArtifactBuildError::Candidate("provider failure code"),
            "build-1",
            "attempt-1",
        ),
        artifact_error(
            &ArtifactBuildError::Unauthorized("lineage"),
            "build-1",
            "attempt-1",
        ),
        artifact_rejection(
            StatusCode::BAD_REQUEST,
            "MALFORMED_TYPED_REQUEST",
            "build-1",
            "attempt-1",
        ),
        artifact_product_edge_error(
            &ProductEdgeError::InvalidProposal("request admission"),
            "build-1",
            "attempt-1",
        ),
    ] {
        assert_receiptless_artifact_unknown(response).await;
    }

    assert_receiptless_artifact_unknown(artifact_preparation_rejection(
        StatusCode::FORBIDDEN,
        "AUTHORIZATION_LINEAGE_REJECTED",
        "build-1",
        "attempt-1",
    ))
    .await;
}

#[rstest]
fn invocation_start_recovery_accepts_claimed_and_started_custody() {
    assert!(invocation_start_recovery_state(
        ProductEdgeInvocationStateV1::Claimed
    ));
    assert!(invocation_start_recovery_state(
        ProductEdgeInvocationStateV1::InvocationStarted
    ));
}

async fn bootstrap_api_test_product_edge(
    test_database: &CanonicalOwnerPostgresTestDatabaseV1,
    suffix: &str,
    request_proof_digest: &str,
) -> ProductEdgePostgresOwnerV1 {
    bootstrap_api_test_product_edge_with(
        test_database,
        suffix,
        request_proof_digest,
        |_| Vec::new(),
        Vec::new(),
    )
    .await
}

/// The one window every manifest, the authorization and the binding of an API test's Product
/// Edge are cut from.
///
/// A manifest has to cover the binding that names it. Cutting the two from separate readings
/// of any clock leaves the binding ending one millisecond past the manifest whenever the
/// readings straddle a millisecond, so an extra manifest takes this window from the bootstrap
/// rather than reading a clock of its own.
#[derive(Clone, Copy, Debug)]
pub(super) struct ApiTestProductEdgeWindowV1 {
    pub(super) effective_from_epoch_ms: u64,
    pub(super) valid_through_epoch_ms: u64,
}

/// Bootstraps the Research and Artifact manifests plus any extra operation manifests and
/// Operator Authorization permissions one acceptance needs beyond that pair.
///
/// Every window is cut from one reading of the Product Edge Owner's clock, the clock that
/// checks it: Product Edge, Operator Authorization and R&D all read their cuts from
/// `pg_catalog.clock_timestamp()`.
pub(super) async fn bootstrap_api_test_product_edge_with(
    test_database: &CanonicalOwnerPostgresTestDatabaseV1,
    suffix: &str,
    request_proof_digest: &str,
    extra_manifests: impl FnOnce(ApiTestProductEdgeWindowV1) -> Vec<AgentOperationManifestProposalV1>,
    extra_permissions: Vec<String>,
) -> ProductEdgePostgresOwnerV1 {
    let product_edge_url = test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner);
    let anchor = OwnerClockAnchorV1::read(product_edge_url).await;
    let now = anchor.owner_epoch_ms;
    let window = ApiTestProductEdgeWindowV1 {
        effective_from_epoch_ms: now.saturating_sub(1_000),
        valid_through_epoch_ms: now.saturating_add(3_600_000),
    };
    let principal = format!("rd-api-retry-principal-{suffix}");
    let mut manifests = vec![
        AgentOperationManifestProposalV1 {
            operation: RESEARCH_GOAL_OPERATION_V2.to_string(),
            operation_schema: RESEARCH_GOAL_SCHEMA_V2.to_string(),
            target_owner: RESEARCH_OWNER_V1.to_string(),
            allowed_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".to_string()],
            prohibited_effects: vec!["REAL_TRADING_V1".to_string()],
            capability_policy_digest: format!("sha256:{}", "c".repeat(64)),
            effective_from_epoch_ms: window.effective_from_epoch_ms,
            valid_through_epoch_ms: window.valid_through_epoch_ms,
        },
        AgentOperationManifestProposalV1 {
            operation: ARTIFACT_BUILD_OPERATION_V1.to_string(),
            operation_schema: ARTIFACT_BUILD_SCHEMA_V1.to_string(),
            target_owner: RESEARCH_OWNER_V1.to_string(),
            allowed_effects: vec![
                "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string(),
                "R_AND_D_PROVIDER_INVOCATION_V1".to_string(),
            ],
            prohibited_effects: vec!["REAL_TRADING_V1".to_string()],
            capability_policy_digest: format!("sha256:{}", "d".repeat(64)),
            effective_from_epoch_ms: window.effective_from_epoch_ms,
            valid_through_epoch_ms: window.valid_through_epoch_ms,
        },
    ];
    manifests.extend(extra_manifests(window));
    manifests.sort_by_key(|manifest| manifest.manifest_identity().unwrap());
    let operation_manifests = manifests
        .iter()
        .map(|manifest| OperationManifestBindingV1 {
            manifest_identity: manifest.manifest_identity().unwrap(),
            manifest_digest: manifest.manifest_digest().unwrap(),
        })
        .collect();
    let issuer = OperatorAuthorizationIssuerPostgresV1::connect(
        test_database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
    )
    .await
    .unwrap();
    let authorization = issuer
        .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
            authorization_identity: format!("rd-api-retry-authorization-{suffix}"),
            issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
            issuer_key_version: "test-key-v1".to_string(),
            scope: OperatorAuthorizationScopeV1 {
                principal: principal.clone(),
                audience: RESEARCH_OWNER_V1.to_string(),
                permissions: {
                    let mut permissions = vec![
                        ARTIFACT_BUILD_SCOPE_V1.to_string(),
                        RESEARCH_SCOPE_V1.to_string(),
                        RESEARCH_VIEW_SCOPE_V1.to_string(),
                    ];
                    permissions.extend(extra_permissions);
                    permissions.sort();
                    permissions.dedup();
                    permissions
                },
            },
            request_proof_digest: request_proof_digest.to_string(),
            operation_manifests,
            not_before_epoch_ms: window.effective_from_epoch_ms,
            valid_through_epoch_ms: window.valid_through_epoch_ms,
            expected_revocation_head: "EMPTY".to_string(),
        })
        .await
        .unwrap();
    let deployment_identity = format!("rd-api-retry-deployment-{suffix}");
    let product_edge = ProductEdgePostgresOwnerV1::connect(
        product_edge_url,
        &deployment_identity,
        ProductEdgeAuthorizationTrustV1 {
            issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
            issuer_key_version: "test-key-v1".to_string(),
            audience: RESEARCH_OWNER_V1.to_string(),
        },
    )
    .await
    .unwrap();
    let genesis = product_edge
        .bootstrap_genesis(ProductEdgeBootstrapProposalV1 {
            deployment_identity,
            binding_identity: format!("rd-api-retry-binding-{suffix}"),
            expected_history_head: "EMPTY".to_string(),
            generation: 1,
            effective_principal: principal,
            scope_policy_version: "research-scope-v1".to_string(),
            capability_policy_version: "capability-v1".to_string(),
            audit_policy_version: "audit-v1".to_string(),
            valid_from_epoch_ms: window.effective_from_epoch_ms,
            valid_through_epoch_ms: window.valid_through_epoch_ms,
            authorization: authorization.locator(),
            manifests: vibe_product_edge::AgentOperationManifestSetV1::new(manifests).unwrap(),
        })
        .await;

    if let Err(refusal) = genesis {
        panic!(
            "Product Edge genesis refused: {refusal}; window {window:?}; {}",
            anchor.describe_after_refusal().await,
        );
    }
    product_edge
}

/// The Owner-clock reading an API test's Product Edge windows are cut from, and what it needs
/// to explain a refusal of one of them.
///
/// A window refused as not current after it was cut from the clock that checks it leaves two
/// explanations: a stall between the reading and the check, or a step in the Owner's clock.
/// The description tells them apart: a stall shows as wall time of the window's margin or more,
/// and a clock step as little wall time with at least that much advance on the Owner's clock.
struct OwnerClockAnchorV1 {
    owner_epoch_ms: u64,
    process_epoch_ms: u64,
    taken_at: std::time::Instant,
    owner_url: String,
}

impl OwnerClockAnchorV1 {
    async fn read(owner_url: &str) -> Self {
        let process_epoch_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis()
            .try_into()
            .unwrap();
        let taken_at = std::time::Instant::now();
        let owner_epoch_ms = owner_clock_epoch_ms(owner_url)
            .await
            .expect("the Owner clock reads");
        Self {
            owner_epoch_ms,
            process_epoch_ms,
            taken_at,
            owner_url: owner_url.to_owned(),
        }
    }

    async fn describe_after_refusal(&self) -> String {
        let wall_ms = self.taken_at.elapsed().as_millis();
        let owner_after = owner_clock_epoch_ms(&self.owner_url).await.map_or_else(
            |e| format!("unreadable ({e})"),
            |epoch_ms| epoch_ms.to_string(),
        );
        format!(
            "cut from Owner clock {}; process clock at that reading {}; Owner clock after the \
             refusal {owner_after}; wall time from the reading to the refusal {wall_ms} ms",
            self.owner_epoch_ms, self.process_epoch_ms,
        )
    }
}

async fn owner_clock_epoch_ms(owner_url: &str) -> Result<u64, sqlx::Error> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_url(owner_url, PostgresTls::Disabled)
        .await?;
    let epoch_ms: i64 = sqlx::query_scalar(
        "SELECT pg_catalog.floor(EXTRACT(epoch FROM pg_catalog.clock_timestamp()) * 1000)::bigint",
    )
    .fetch_one(&pool)
    .await?;
    pool.close().await;
    Ok(u64::try_from(epoch_ms).expect("the Owner clock is after the epoch"))
}

/// Every R&D and Product Edge relation the Dashboard browser acceptance may touch. The
/// acceptance compares this snapshot before and after the browser journey, so a read that
/// leaked a write into any of them fails the proof.
#[cfg(all(
    feature = "sealed-artifact-source-browser-acceptance",
    feature = "sealed-source-intake-acceptance"
))]
async fn dashboard_owner_readback_acceptance_snapshot(
    rd_owner_pool: &sqlx::PgPool,
    product_edge_pool: &sqlx::PgPool,
) -> serde_json::Value {
    const RD_RELATIONS: [(&str, &str); 7] = [
        ("rd_artifact_build_attempts_v1", "build_request_identity"),
        ("rd_strategy_artifacts_v1", "attempt_identity"),
        ("rd_owner_outbox_v1", "event_identity"),
        ("rd_research_request_receipts_v1", "request_identity"),
        ("rd_source_intake_bindings_v1", "request_identity"),
        ("rd_source_intake_receipts_v1", "receipt_identity"),
        (
            "rd_sealed_exploratory_replay_requests_v1",
            "request_identity",
        ),
    ];
    const PRODUCT_EDGE_RELATIONS: [(&str, &str); 2] = [
        ("product_edge_request_admissions_v1", "request_identity"),
        ("product_edge_owner_outbox_v1", "event_identity"),
    ];
    let mut snapshot = serde_json::Map::new();

    for (pool, relations) in [
        (rd_owner_pool, RD_RELATIONS.as_slice()),
        (product_edge_pool, PRODUCT_EDGE_RELATIONS.as_slice()),
    ] {
        for (relation, order) in relations {
            let rows: Vec<serde_json::Value> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT to_jsonb(row_value) FROM (SELECT * FROM public.{relation} ORDER BY {order}) row_value"
            )))
            .fetch_all(pool)
            .await
            .unwrap_or_else(|e| panic!("snapshot of {relation} must read: {e}"));
            snapshot.insert((*relation).to_owned(), serde_json::Value::Array(rows));
        }
    }
    serde_json::Value::Object(snapshot)
}

/// Serves every admitted Dashboard Owner read to a real browser from real Owner custody.
///
/// The custody is committed through the write API handlers exactly as an operator would
/// commit it; the browser then reads it through the production
/// `strategy-factory-rd-dashboard-read-api` router plus the write API's historical custody
/// route, which is the deployed topology. The chain entries before this one must already
/// have sealed one Replay V2 request, because that custody cannot be created from this crate.
#[cfg(all(
    feature = "sealed-artifact-source-browser-acceptance",
    feature = "sealed-source-intake-acceptance"
))]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires explicit local PostgreSQL, Dashboard dependencies, and Chrome acceptance admission"]
async fn strategy_source_browser_acceptance_reads_canonical_terminal_owner_custody() {
    // Fail closed like the two inputs below: an early return here reported PASS from any run
    // that lacked the input, having driven nothing (scripts/ci/chain-entry-early-return.py).
    assert_eq!(
        env::var("DASHBOARD_STRATEGY_VIEWER_BROWSER_ACCEPTANCE").as_deref(),
        Ok("1"),
        "DASHBOARD_STRATEGY_VIEWER_BROWSER_ACCEPTANCE must be exactly 1 for this browser acceptance",
    );

    install_acceptance_tracing();

    // Reported rather than assumed: this harness pins `worker_threads = 2`, and whether that
    // is a constraint or a restatement of the default depends on a number nobody here has
    // measured. Two sessions have carried "the runner has 2 vCPUs" as fact with no measurement
    // behind it, while `owner-chains.yml` says 4 for a public repository. This is the figure
    // tokio actually defaults to, read in the process that would use it.
    tracing::info!(
        available_parallelism = ?std::thread::available_parallelism(),
        pinned_worker_threads = 2,
        "acceptance harness runtime width"
    );

    let browser_executable = env::var("DASHBOARD_STRATEGY_VIEWER_BROWSER_EXECUTABLE")
        .expect("explicit browser executable is required");
    let acceptance_candidate = env::var("DASHBOARD_STRATEGY_VIEWER_ACCEPTANCE_CANDIDATE")
        .expect("exact committed Dashboard candidate is required");
    let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
    let mutation = test_database.mutation();
    {
        let catalog_admin_pool = sqlx::postgres::PgPoolOptions::new()
            .connect_url(
                test_database
                    .database_url(CanonicalOwnerTestRoleV1::ReplayPolicyCatalogAdminWriter),
                PostgresTls::Disabled,
            )
            .await
            .unwrap();
        ensure_replay_policy_catalog_fixture_v3(&catalog_admin_pool)
            .await
            .unwrap();
    }

    let token = "rd-owner-strategy-source-browser-acceptance";
    let token_digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
    let request_proof_digest = format!("sha256:{}", hex_digest(&token_digest));
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let product_edge = Arc::new(
        bootstrap_api_test_product_edge_with(
            &test_database,
            &format!("strategy-source-{suffix}"),
            &request_proof_digest,
            |window| {
                vec![AgentOperationManifestProposalV1 {
                    operation: SOURCE_INTAKE_OPERATION_V1.to_string(),
                    operation_schema: SOURCE_INTAKE_OPERATION_SCHEMA_V1.to_string(),
                    target_owner: SOURCE_INTAKE_TARGET_OWNER_V1.to_string(),
                    allowed_effects: SOURCE_INTAKE_REQUIRED_EFFECTS_V1
                        .into_iter()
                        .map(ToString::to_string)
                        .collect(),
                    prohibited_effects: vec!["REAL_TRADING_V1".to_string()],
                    capability_policy_digest: format!("sha256:{}", "e".repeat(64)),
                    effective_from_epoch_ms: window.effective_from_epoch_ms,
                    valid_through_epoch_ms: window.valid_through_epoch_ms,
                }]
            },
            vec!["research:source-intake".to_string()],
        )
        .await,
    );
    let product_edge_pool = mutation.pool(CanonicalOwnerTestRoleV1::ProductEdgeOwner);
    let owner = PostgresResearchGoalOwnerV1::connect(
        test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
        test_database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
    )
    .await
    .unwrap();
    #[cfg(feature = "sealed-source-intake-acceptance")]
    let owner = owner.bind_sealed_source_intake_research_policy();
    let owner = Arc::new(owner);
    let artifact_owner = Arc::new(
        PostgresArtifactBuildOwnerV1::connect_with_sealed_artifact_source_acceptance(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            u64::MAX,
        )
        .await
        .unwrap(),
    );
    let historical_custody_owner = Arc::new(
        PostgresHistoricalCustodyOwnerV1::connect_read_only(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
        )
        .await
        .unwrap(),
    );
    let state = ApiState {
        product_edge,
        owner: owner.clone(),
        artifact_owner: artifact_owner.clone(),
        artifact_source_owner: artifact_owner.clone(),
        artifact_directory_owner: artifact_owner,
        research_directory_owner: owner.clone(),
        research_readback_owner: owner,
        historical_custody_owner,
        token_digest,
        request_proof_digest,
        allow_acceptance_faults: false,
        _market_data_research_pit: None,
        #[cfg(feature = "composer-replay-issuance")]
        native_replay_scheduling: None,
        #[cfg(feature = "composer-replay-issuance")]
        instrument_master_v2: None,
        #[cfg(feature = "composer-replay-issuance")]
        instrument_economic_terms: None,
        #[cfg(feature = "composer-replay-issuance")]
        universe_sample_projection: None,
        #[cfg(feature = "composer-replay-issuance")]
        develop_composer_read: None,
        #[cfg(all(
            feature = "sealed-develop-composer-acceptance",
            not(feature = "sealed-source-intake-composer-acceptance")
        ))]
        develop_composer: Arc::new(
            SealedDevelopComposerAcceptanceV2::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
            )
            .await
            .unwrap(),
        ),
        #[cfg(feature = "sealed-source-intake-composer-acceptance")]
        develop_composer: Arc::new(
            SealedPostgresSourceResearchComposerV2::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
            )
            .await
            .unwrap(),
        ),
        #[cfg(not(feature = "sealed-develop-composer-acceptance"))]
        develop_composer: Arc::new(
            PostgresSourceResearchComposerProductionV2::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
            )
            .await
            .unwrap(),
        ),
        #[cfg(feature = "composer-replay-issuance")]
        replay_composition: None,
    };
    let headers = bearer_headers(token);
    let research = ProductEdgeOperationRequestV2 {
        request_identity: format!("strategy-source-research-{suffix}"),
        channel: ProductEdgeChannel::WindmillProductEdge,
        goal: SourcedResearchGoalV2 {
            hypothesis: "A bounded momentum effect persists after exact costs.".to_string(),
            mechanism: "Slow information diffusion creates bounded continuation.".to_string(),
            falsification_question: "Does the effect disappear after modeled costs?".to_string(),
            expected_observation: "Net continuation remains positive.".to_string(),
            required_data: vec!["PIT adjusted bars".to_string()],
            cost_assumption: "Exact acceptance cost model.".to_string(),
            capacity_assumption: "Exact acceptance capacity model.".to_string(),
            sources: vec![ResearchSourceV1 {
                locator: "https://example.com/strategy-source-acceptance".to_string(),
                content_digest: format!("sha256:{}", "a".repeat(64)),
                observed_at: "2026-09-08T00:00:00Z".to_string(),
                source_cut: "strategy-source-acceptance-cut-v1".to_string(),
                license_basis: "public research".to_string(),
                interpretation: "Bounded strategy source browser acceptance fixture.".to_string(),
            }],
        },
        trial_family_proposal: TrialFamilyProposalV1 {
            trial_budget: 2,
            stop_rule: "Stop on falsifier or unavailable PIT input.".to_string(),
            pit_rule_identity: "pit-rule-v1".to_string(),
            cost_model_identity: "cost-model-v1".to_string(),
            slippage_model_identity: "slippage-model-v1".to_string(),
            capacity_model_identity: "capacity-model-v1".to_string(),
            independence_rationale: "Fresh isolated strategy source family.".to_string(),
        },
    };
    let research_response = Box::pin(research_goal_submission::submit_v2(
        State(state.research_goal_submission()),
        headers.clone(),
        Bytes::from(serde_json::to_vec(&research).unwrap()),
    ))
    .await;
    assert_eq!(research_response.status(), StatusCode::OK);
    let research_json = response_json(research_response).await;
    let readback_response = read_research_v2(
        State(state.clone()),
        Path(research.request_identity.clone()),
        headers.clone(),
    )
    .await;
    assert_eq!(readback_response.status(), StatusCode::OK);
    assert_eq!(
        response_json(readback_response).await["request_identity"],
        research.request_identity
    );
    let intent_identity = research_json["owner_receipt"]["resulting_research_intent_identity"]
        .as_str()
        .unwrap_or_else(|| panic!("research custody unavailable: {research_json}"))
        .to_string();
    let build_request_identity = format!("strategy-source-build-{suffix}");
    let attempt_identity = format!("strategy-source-attempt-{suffix}");
    let build = serde_json::json!({
        "build_request_identity": build_request_identity,
        "attempt_identity": attempt_identity,
        "intent_identity": intent_identity,
        "channel": "WINDMILL_PRODUCT_EDGE",
    });
    let prepared = prepare_artifact_build(
        State(state.clone()),
        headers.clone(),
        Bytes::from(serde_json::to_vec(&build).unwrap()),
    )
    .await;
    assert_eq!(prepared.status(), StatusCode::OK);
    let prepared_json = response_json(prepared).await;
    assert_eq!(prepared_json["resolution"], "PREPARED");
    let intent_semantic_digest = prepared_json["intent_semantic_digest"]
        .as_str()
        .unwrap()
        .to_string();
    let candidate = serde_json::json!({
        "request": build,
        "candidate": {
            "schema_version": 1,
            "candidate_identity": format!("agent-program-candidate-v1-strategy-source-{suffix}"),
            "intent_identity": intent_identity,
            "intent_semantic_digest": intent_semantic_digest,
            "logic": {
                "signal": "MOMENTUM",
                "direction": "LONG_ONLY",
                "lookback_bars": 24,
                "entry_threshold_bps": 50,
                "exit_threshold_bps": 10
            },
            "structured_logic_summary": "Bounded momentum source viewer acceptance.",
            "agent_change_explanation": "Produces canonical read-only source custody without provider execution."
        }
    });
    let submitted = submit_artifact_candidate(
        State(state.clone()),
        headers.clone(),
        Bytes::from(serde_json::to_vec(&candidate).unwrap()),
    )
    .await;
    assert_eq!(submitted.status(), StatusCode::OK);
    let submitted_json = response_json(submitted).await;
    assert_eq!(submitted_json["resolution"], "SUCCESS");
    assert!(submitted_json["provider_invocation"].is_null());

    // Source Intake custody through the sealed acceptance environment: the same Owner
    // workflow the production router runs, with the provider fixed instead of live.
    let rd_owner_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
    let source_intake_request_identity = format!("strategy-source-intake-{suffix}");
    let source_intake_owner = Arc::new(SourceIntakeOwnerV1::sealed_acceptance(
        SealedSourceIntakeEnvironmentV1::new(
            state.product_edge.clone(),
            rd_owner_pool.clone(),
            state.request_proof_digest.clone(),
        )
        .unwrap(),
    ));
    let source_intake_terminal = source_intake_owner
        .run(SourceIntakeOperationRequestV1 {
            request_identity: source_intake_request_identity.clone(),
            channel: ProductEdgeGatewayV1::WindmillProductEdge,
            normalized_doi: "10.5555/sealed-success".to_string(),
            interpretation: SourceInterpretationV1 {
                bounded_explanation:
                    "A bounded momentum effect persists after exact costs in the sealed corpus."
                        .to_string(),
                plausible_alternatives: vec![
                    "Cost model error".to_string(),
                    "Survivorship bias".to_string(),
                ],
                differentiating_prediction:
                    "Net continuation stays positive after the modeled costs.".to_string(),
                falsifier: "Continuation vanishes once exact costs are applied.".to_string(),
            },
        })
        .await
        .unwrap()
        .expect("sealed Source Intake must reach a terminal");
    let source_intake_terminal = serde_json::to_value(&source_intake_terminal).unwrap();
    assert_eq!(source_intake_terminal["terminal"], "RETRIEVED");
    let source_intake_content_digest = source_intake_terminal["content_digest"]
        .as_str()
        .unwrap_or_else(|| {
            panic!("retrieved Source Intake must carry a content digest: {source_intake_terminal}")
        })
        .to_string();

    // One pre-V2 rejection selector. Nothing in the repository materializes the legacy
    // `rd_exploratory_replay_rejections_v1` relation and the chain revokes CREATE on the
    // public schema, so the quarantine read is proven on its fail-closed path: the Owner port
    // reports the relation unavailable and the browser renders exactly that.
    let rejection_request_identity = format!("strategy-source-rejected-replay-{suffix}");
    let rejection_attempt_identity = format!("strategy-source-rejected-attempt-{suffix}");
    let rejection_semantic_digest = format!(
        "sha256:{}",
        hex_digest(&Sha256::digest(rejection_request_identity.as_bytes()))
    );

    // The sealed Replay V2 request the preceding chain entries committed. Its selector is
    // handed to the browser exactly as an operator would paste it.
    let replay_row = sqlx::query(
        "SELECT request_identity, v2_meaning_digest FROM public.rd_sealed_exploratory_replay_requests_v1 WHERE v2_meaning_digest IS NOT NULL ORDER BY committed_at_epoch_ms DESC, request_identity DESC LIMIT 1",
    )
    .fetch_one(rd_owner_pool)
    .await
    .expect("a sealed Replay V2 request committed by the preceding chain entries must precede the Dashboard browser consumer");
    let replay_request_identity: String = replay_row.try_get("request_identity").unwrap();
    let replay_meaning_digest: String = replay_row.try_get("v2_meaning_digest").unwrap();

    let claim_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM product_edge_effect_invocation_claims_v1 WHERE attempt_identity=$1",
    )
    .bind(&attempt_identity)
    .fetch_one(product_edge_pool)
    .await
    .unwrap();
    assert_eq!(claim_count, 0);
    let before =
        dashboard_owner_readback_acceptance_snapshot(rd_owner_pool, product_edge_pool).await;

    let source_response = read_artifact_source(
        State(state.clone()),
        Path((build_request_identity.clone(), attempt_identity.clone())),
        headers,
    )
    .await;
    assert_eq!(source_response.status(), StatusCode::OK);
    let source = response_json(source_response).await;
    let artifact_identity = source["artifact_identity"].as_str().unwrap().to_string();
    let source_digest = source["source_digest"].as_str().unwrap().to_string();
    assert_eq!(source["wasm_preview_status"], "NOT_RUN");

    // The production Dashboard read API, composed exactly as its binary composes it, with a
    // credential of its own so the browser proves it never borrows the write credential.
    let read_token = "rd-dashboard-read-browser-acceptance";
    let mut read_state = dashboard_read_api::compose_state(&DashboardReadApiConfigV1 {
        owner_database_url: test_database
            .database_url(CanonicalOwnerTestRoleV1::RdOwner)
            .to_string(),
        token: read_token.to_string(),
        source_intake: Some(SourceIntakeReadConfigV1 {
            product_edge_database_url: test_database
                .database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner)
                .to_string(),
            request_proof: token.to_string(),
        }),
        bind: String::new(),
    })
    .await
    .unwrap();
    assert!(
        read_state.source_intake_readback.is_some(),
        "Source Intake readback must bind to the disposable topology"
    );
    // Sealed Source Intake custody carries the sealed authority class, which the production
    // readback port refuses by design because it binds live external authority. The sealed
    // Owner reads its own custody back exactly as the sealed write API router does; every
    // other port keeps the production composition bound above.
    read_state.source_intake_readback = Some(source_intake_owner.clone());
    let read_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let read_address = read_listener.local_addr().unwrap();
    let read_server = tokio::spawn(async move {
        axum::serve(read_listener, dashboard_read_api::router(read_state)).await
    });
    let owner_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let owner_address = owner_listener.local_addr().unwrap();

    let owner_server = tokio::spawn(async move {
        axum::serve(
            owner_listener,
            // Historical custody used to be bolted on here, because the read API had no such
            // route and the write API did. An acceptance that has to reproduce the write API's
            // shape to pass is not proving the production path; the read API serves it now.
            artifact_source_router().with_state(state),
        )
        .await
    });
    let dashboard_root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../product/dashboard");
    // The browser run takes minutes, and this runtime has two worker threads with both API
    // servers spawned onto it. Waiting on the child with `Command::status` blocks the worker
    // this future sits on for the whole run, leaving one worker to serve every request the
    // page makes - on a runner already sharing two vCPUs with the Rust test process, node,
    // the Next server, Chrome and PostgreSQL. `spawn_blocking` moves the wait off the worker
    // pool, so both servers keep both workers.
    let mut browser = std::process::Command::new("node");
    browser
        .arg("--test")
        .arg("tests/dashboard-owner-readback.browser.test.mjs")
        .current_dir(&dashboard_root)
        .env("DASHBOARD_STRATEGY_VIEWER_BROWSER_ACCEPTANCE", "1")
        // The Dashboard declares an eight second budget for an Owner read, and that is a
        // production promise about eleven operations. It is not a claim this harness can keep:
        // one runner runs Chrome, the Next server, this crate's two HTTP servers, PostgreSQL
        // and the Rust test process on two vCPUs, and the budget is an `AbortSignal.timeout`,
        // so it measures the client process's wall clock rather than the Owner's latency.
        //
        // The value is the harness's own `attemptTimeoutMs`, not a new number: the browser step
        // already gives an attempt twenty-five seconds, so a read that cannot finish inside the
        // attempt is the attempt's failure to report, and two nested budgets that disagree only
        // decide which one reports it. This says the acceptance measures the attempt, and says
        // nothing about how long an Owner read takes.
        .env("DASHBOARD_OWNER_READ_TIMEOUT_OVERRIDE_MS", "25000")
        .env(
            "DASHBOARD_STRATEGY_VIEWER_ACCEPTANCE_CANDIDATE",
            acceptance_candidate,
        )
        .env(
            "DASHBOARD_STRATEGY_VIEWER_BROWSER_EXECUTABLE",
            browser_executable,
        )
        .env(
            "DASHBOARD_OWNER_READBACK_RESEARCH_REQUEST_IDENTITY",
            &research.request_identity,
        )
        .env(
            "DASHBOARD_OWNER_READBACK_RESEARCH_HYPOTHESIS",
            &research.goal.hypothesis,
        )
        .env(
            "DASHBOARD_OWNER_READBACK_BUILD_REQUEST_IDENTITY",
            &build_request_identity,
        )
        .env(
            "DASHBOARD_OWNER_READBACK_ATTEMPT_IDENTITY",
            &attempt_identity,
        )
        .env(
            "DASHBOARD_OWNER_READBACK_UNKNOWN_BUILD_REQUEST_IDENTITY",
            format!("strategy-source-unknown-build-{suffix}"),
        )
        .env(
            "DASHBOARD_OWNER_READBACK_MISMATCH_ATTEMPT_IDENTITY",
            format!("strategy-source-mismatch-{suffix}"),
        )
        .env(
            "DASHBOARD_OWNER_READBACK_ARTIFACT_IDENTITY",
            artifact_identity,
        )
        .env("DASHBOARD_OWNER_READBACK_SOURCE_DIGEST", source_digest)
        .env(
            "DASHBOARD_OWNER_READBACK_SOURCE_INTAKE_REQUEST_IDENTITY",
            &source_intake_request_identity,
        )
        .env(
            "DASHBOARD_OWNER_READBACK_SOURCE_INTAKE_CONTENT_DIGEST",
            source_intake_content_digest,
        )
        .env(
            "DASHBOARD_OWNER_READBACK_REPLAY_REQUEST_IDENTITY",
            replay_request_identity,
        )
        .env(
            "DASHBOARD_OWNER_READBACK_REPLAY_MEANING_DIGEST",
            replay_meaning_digest,
        )
        .env(
            "DASHBOARD_OWNER_READBACK_REJECTION_REQUEST_IDENTITY",
            &rejection_request_identity,
        )
        .env(
            "DASHBOARD_OWNER_READBACK_REJECTION_ATTEMPT_IDENTITY",
            &rejection_attempt_identity,
        )
        .env(
            "DASHBOARD_OWNER_READBACK_REJECTION_SEMANTIC_DIGEST",
            &rejection_semantic_digest,
        )
        .env(
            "RD_DASHBOARD_OWNER_READ_API_URL",
            format!("http://{read_address}/"),
        )
        .env("RD_DASHBOARD_OWNER_READ_API_TOKEN", read_token)
        .env("RD_OWNER_API_URL", format!("http://{owner_address}/"))
        .env("RD_OWNER_API_TOKEN", token);
    let browser_status = tokio::task::spawn_blocking(move || browser.status())
        .await
        .expect("the browser acceptance wait joins")
        .unwrap();
    read_server.abort();
    let _ = read_server.await;
    owner_server.abort();
    let _ = owner_server.await;

    let after =
        dashboard_owner_readback_acceptance_snapshot(rd_owner_pool, product_edge_pool).await;
    assert!(browser_status.success());
    assert_eq!(after, before);
}

#[tokio::test]
#[ignore = "requires the disposable canonical OA/PE/R&D/Qualification PostgreSQL topology"]
async fn same_identity_started_retry_returns_http_ok_with_exact_custody_once() {
    let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
    let mutation = test_database.mutation();
    #[cfg(feature = "sealed-source-intake-acceptance")]
    {
        let catalog_admin_pool = sqlx::postgres::PgPoolOptions::new()
            .connect_url(
                test_database
                    .database_url(CanonicalOwnerTestRoleV1::ReplayPolicyCatalogAdminWriter),
                PostgresTls::Disabled,
            )
            .await
            .unwrap();
        ensure_replay_policy_catalog_fixture_v3(&catalog_admin_pool)
            .await
            .unwrap();
    }
    let token = "rd-owner-api-start-retry-test";
    let token_digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
    let request_proof_digest = format!("sha256:{}", hex_digest(&token_digest));
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let product_edge = Arc::new(
        bootstrap_api_test_product_edge(&test_database, &suffix.to_string(), &request_proof_digest)
            .await,
    );
    let product_edge_pool = mutation.pool(CanonicalOwnerTestRoleV1::ProductEdgeOwner);
    let owner = Arc::new(
        PostgresResearchGoalOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            test_database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
        )
        .await
        .unwrap(),
    );
    let artifact_owner = Arc::new(
        PostgresArtifactBuildOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            "/tmp/unused-rd-sandbox.sock",
            u64::MAX,
        )
        .await
        .unwrap(),
    );
    let historical_custody_owner = Arc::new(
        PostgresHistoricalCustodyOwnerV1::connect_read_only(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
        )
        .await
        .unwrap(),
    );
    let state = ApiState {
        product_edge,
        owner: owner.clone(),
        artifact_owner: artifact_owner.clone(),
        artifact_source_owner: artifact_owner.clone(),
        artifact_directory_owner: artifact_owner,
        research_directory_owner: owner.clone(),
        research_readback_owner: owner.clone(),
        historical_custody_owner,
        token_digest,
        request_proof_digest,
        allow_acceptance_faults: false,
        _market_data_research_pit: None,
        #[cfg(feature = "composer-replay-issuance")]
        native_replay_scheduling: None,
        #[cfg(feature = "composer-replay-issuance")]
        instrument_master_v2: None,
        #[cfg(feature = "composer-replay-issuance")]
        instrument_economic_terms: None,
        #[cfg(feature = "composer-replay-issuance")]
        universe_sample_projection: None,
        #[cfg(feature = "composer-replay-issuance")]
        develop_composer_read: None,
        #[cfg(all(
            feature = "sealed-develop-composer-acceptance",
            not(feature = "sealed-source-intake-composer-acceptance")
        ))]
        develop_composer: Arc::new(
            SealedDevelopComposerAcceptanceV2::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
            )
            .await
            .unwrap(),
        ),
        #[cfg(feature = "sealed-source-intake-composer-acceptance")]
        develop_composer: Arc::new(
            SealedPostgresSourceResearchComposerV2::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
            )
            .await
            .unwrap(),
        ),
        #[cfg(not(feature = "sealed-develop-composer-acceptance"))]
        develop_composer: Arc::new(
            PostgresSourceResearchComposerProductionV2::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
            )
            .await
            .unwrap(),
        ),
        #[cfg(feature = "composer-replay-issuance")]
        replay_composition: None,
    };
    let headers = bearer_headers(token);
    let research_request_identity = format!("rd-api-retry-research-{suffix}");
    let research = ProductEdgeOperationRequestV2 {
        request_identity: research_request_identity.clone(),
        channel: ProductEdgeChannel::WindmillProductEdge,
        goal: SourcedResearchGoalV2 {
            hypothesis: "A bounded point-in-time continuation effect remains after costs."
                .to_string(),
            mechanism: "Slow information diffusion creates bounded continuation.".to_string(),
            falsification_question: "Does the effect disappear after exact modeled costs?"
                .to_string(),
            expected_observation: "Net continuation remains positive.".to_string(),
            required_data: vec!["PIT adjusted bars".to_string()],
            cost_assumption: "Exact test cost model identity.".to_string(),
            capacity_assumption: "Exact test capacity model identity.".to_string(),
            sources: vec![ResearchSourceV1 {
                locator: "https://example.com/rd-api-retry".to_string(),
                content_digest: format!("sha256:{}", "a".repeat(64)),
                observed_at: "2026-08-23T00:00:00Z".to_string(),
                source_cut: "rd-api-retry-source-cut-v1".to_string(),
                license_basis: "public research".to_string(),
                interpretation: "Bounded API retry fixture only.".to_string(),
            }],
        },
        trial_family_proposal: TrialFamilyProposalV1 {
            trial_budget: 2,
            stop_rule: "Stop on falsifier or unavailable PIT input.".to_string(),
            pit_rule_identity: "pit-rule-v1".to_string(),
            cost_model_identity: "cost-model-v1".to_string(),
            slippage_model_identity: "slippage-model-v1".to_string(),
            capacity_model_identity: "capacity-model-v1".to_string(),
            independence_rationale: "Fresh isolated API retry family.".to_string(),
        },
    };
    let research_response = Box::pin(research_goal_submission::submit_v2(
        State(state.research_goal_submission()),
        headers.clone(),
        Bytes::from(serde_json::to_vec(&research).unwrap()),
    ))
    .await;
    assert_eq!(research_response.status(), StatusCode::OK);
    let research_json = response_json(research_response).await;
    let intent_identity = research_json["owner_receipt"]["resulting_research_intent_identity"]
        .as_str()
        .unwrap_or_else(|| panic!("research API did not return accepted custody: {research_json}"))
        .to_string();

    let peeked_research: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.peek_current_research_for_artifact_v1($1)")
            .bind(&intent_identity)
            .fetch_one(product_edge_pool)
            .await
            .unwrap_or_else(|e| panic!("artifact research peek failed: {e:?}"));
    assert!(
        peeked_research.is_some(),
        "artifact research peek returned unavailable"
    );

    let build_request_identity = format!("rd-api-retry-build-{suffix}");
    let attempt_identity = format!("rd-api-retry-attempt-{suffix}");
    let build = ArtifactBuildOperationRequestV1 {
        build_request_identity: build_request_identity.clone(),
        attempt_identity: attempt_identity.clone(),
        intent_identity,
        channel: ProductEdgeChannel::WindmillProductEdge,
    };
    let build_body = Bytes::from(serde_json::to_vec(&build).unwrap());
    let prepared =
        prepare_artifact_build(State(state.clone()), headers.clone(), build_body.clone()).await;
    let prepared_status = prepared.status();
    let prepared_rejection_code = prepared
        .headers()
        .get("x-rd-rejection-code")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("none")
        .to_string();
    let prepared_json = response_json(prepared).await;
    assert_eq!(
        prepared_status,
        StatusCode::OK,
        "artifact preparation failed: rejection_code={prepared_rejection_code}, body={prepared_json}"
    );

    let custody_response = read_historical_custodies(State(state.clone()), headers.clone()).await;
    assert_eq!(custody_response.status(), StatusCode::OK);
    let custody_json = response_json(custody_response).await;
    assert_eq!(
        custody_json["operation"],
        "rd.historical_custody_quarantine.read.v1"
    );
    let research_candidates = custody_json["research"].as_array().unwrap();
    let research_candidate = research_candidates
        .iter()
        .find(|candidate| {
            candidate["request_identity"].as_str() == Some(research_request_identity.as_str())
        })
        .unwrap_or_else(|| panic!("canonical Research custody candidate missing: {custody_json}"));
    assert_eq!(
        research_candidate["projection_state"],
        "POINT_READ_REQUIRED"
    );
    assert!(research_candidate.get("resolution").is_none());
    assert!(research_candidate.get("disposition").is_none());
    let attempt_candidates = custody_json["artifact_attempts"].as_array().unwrap();
    let attempt_candidate = attempt_candidates
        .iter()
        .find(|candidate| {
            candidate["build_request_identity"].as_str() == Some(build_request_identity.as_str())
                && candidate["attempt_identity"].as_str() == Some(attempt_identity.as_str())
        })
        .unwrap_or_else(|| panic!("canonical Artifact custody candidate missing: {custody_json}"));
    assert_eq!(attempt_candidate["projection_state"], "POINT_READ_REQUIRED");
    assert!(attempt_candidate.get("resolution").is_none());
    assert!(attempt_candidate.get("disposition").is_none());

    let claimed =
        claim_provider_invocation(State(state.clone()), headers.clone(), build_body).await;
    assert_eq!(claimed.status(), StatusCode::OK);
    let claimed_json = response_json(claimed).await;
    let claim_identity = claimed_json["claim_identity"].as_str().unwrap().to_string();

    let product_edge_state_before_foreign_start: serde_json::Value = sqlx::query_scalar(
        "SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
    )
    .bind(&claim_identity)
    .fetch_one(product_edge_pool)
    .await
    .unwrap();
    let foreign_start_body = Bytes::from(
        serde_json::to_vec(&serde_json::json!({
            "build_request_identity": build_request_identity,
            "attempt_identity": attempt_identity,
            "research_request_identity": "foreign-research-request",
        }))
        .unwrap(),
    );
    let foreign_start =
        start_provider_invocation(State(state.clone()), headers.clone(), foreign_start_body).await;
    assert_eq!(foreign_start.status(), StatusCode::CONFLICT);
    assert_eq!(
        foreign_start.headers().get("x-rd-rejection-code").unwrap(),
        "RESEARCH_REQUEST_IDENTITY_CONFLICT"
    );
    let product_edge_state_after_foreign_start: serde_json::Value = sqlx::query_scalar(
        "SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
    )
    .bind(&claim_identity)
    .fetch_one(product_edge_pool)
    .await
    .unwrap();
    let foreign_started_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE event_kind='PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1' AND aggregate_identity=$1",
    )
    .bind(&claim_identity)
    .fetch_one(product_edge_pool)
    .await
    .unwrap();
    assert_eq!(
        product_edge_state_after_foreign_start,
        product_edge_state_before_foreign_start
    );
    assert_eq!(foreign_started_events, 0);

    let start_body = Bytes::from(
        serde_json::to_vec(&serde_json::json!({
            "build_request_identity": build_request_identity,
            "attempt_identity": attempt_identity,
            "research_request_identity": research_request_identity,
        }))
        .unwrap(),
    );
    let started =
        start_provider_invocation(State(state.clone()), headers.clone(), start_body.clone()).await;
    assert_eq!(started.status(), StatusCode::OK);
    let started_json = response_json(started).await;
    assert_eq!(
        started_json["invocation_start"]["disposition"],
        "STARTED_NEW"
    );
    assert_exact_start_custody(&started_json, &build_request_identity, &attempt_identity);
    assert_eq!(
        started_json["execution_custody"]["claim_identity"],
        claim_identity
    );
    let started_events_after_first: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE event_kind='PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1' AND aggregate_identity=$1",
    )
    .bind(&claim_identity)
    .fetch_one(product_edge_pool)
    .await
    .unwrap();
    assert_eq!(started_events_after_first, 1);
    let rd_attempt_after_first: serde_json::Value = sqlx::query_scalar(
        "SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1",
    )
    .bind(&build_request_identity)
    .fetch_one(mutation.pool(CanonicalOwnerTestRoleV1::RdOwner))
    .await
    .unwrap();

    let retried =
        start_provider_invocation(State(state.clone()), headers.clone(), start_body.clone()).await;
    assert_eq!(retried.status(), StatusCode::OK);
    let retried_json = response_json(retried).await;
    assert_eq!(
        retried_json["invocation_start"]["disposition"],
        "OUTCOME_UNKNOWN"
    );
    assert_exact_start_custody(&retried_json, &build_request_identity, &attempt_identity);
    assert_eq!(
        retried_json["execution_custody"],
        started_json["execution_custody"]
    );
    let started_events_after_retry: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE event_kind='PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1' AND aggregate_identity=$1",
    )
    .bind(&claim_identity)
    .fetch_one(product_edge_pool)
    .await
    .unwrap();
    assert_eq!(started_events_after_retry, started_events_after_first);
    let rd_attempt_after_retry: serde_json::Value = sqlx::query_scalar(
        "SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1",
    )
    .bind(&build_request_identity)
    .fetch_one(mutation.pool(CanonicalOwnerTestRoleV1::RdOwner))
    .await
    .unwrap();
    assert_eq!(rd_attempt_after_retry, rd_attempt_after_first);

    let rd_owner_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
    let mut missing_snapshot_attempt = rd_attempt_after_retry.clone();
    missing_snapshot_attempt
        .as_object_mut()
        .unwrap()
        .remove("invocation_custody");
    sqlx::query(
        "UPDATE rd_artifact_build_attempts_v1 SET attempt_json=$1 WHERE build_request_identity=$2",
    )
    .bind(&missing_snapshot_attempt)
    .bind(&build_request_identity)
    .execute(rd_owner_pool)
    .await
    .unwrap();
    let product_edge_state_before_missing_snapshot: serde_json::Value = sqlx::query_scalar(
        "SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
    )
    .bind(&claim_identity)
    .fetch_one(product_edge_pool)
    .await
    .unwrap();
    let product_edge_outbox_before_missing_snapshot: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE aggregate_identity=$1",
    )
    .bind(&claim_identity)
    .fetch_one(product_edge_pool)
    .await
    .unwrap();
    let missing_snapshot_rejected =
        start_provider_invocation(State(state.clone()), headers.clone(), start_body.clone()).await;
    let product_edge_state_after_missing_snapshot: serde_json::Value = sqlx::query_scalar(
        "SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
    )
    .bind(&claim_identity)
    .fetch_one(product_edge_pool)
    .await
    .unwrap();
    let product_edge_outbox_after_missing_snapshot: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE aggregate_identity=$1",
    )
    .bind(&claim_identity)
    .fetch_one(product_edge_pool)
    .await
    .unwrap();
    let rd_attempt_after_missing_snapshot: serde_json::Value = sqlx::query_scalar(
        "SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1",
    )
    .bind(&build_request_identity)
    .fetch_one(rd_owner_pool)
    .await
    .unwrap();
    // Everything the refusal is judged on has been read, so the tamper is restored before any
    // of it is asserted. The ordered chain shares one store and never resets it: asserting
    // first would leave the tamper behind on exactly the run that fails, and every later
    // entry that verifies recent attempts would then fail with no apparent cause.
    sqlx::query(
        "UPDATE rd_artifact_build_attempts_v1 SET attempt_json=$1 WHERE build_request_identity=$2",
    )
    .bind(&rd_attempt_after_retry)
    .bind(&build_request_identity)
    .execute(rd_owner_pool)
    .await
    .unwrap();
    assert_eq!(
        missing_snapshot_rejected.status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(
        missing_snapshot_rejected
            .headers()
            .get("x-rd-rejection-code")
            .unwrap(),
        "OWNER_OUTCOME_UNKNOWN"
    );
    assert_eq!(
        product_edge_state_after_missing_snapshot,
        product_edge_state_before_missing_snapshot
    );
    assert_eq!(
        product_edge_outbox_after_missing_snapshot,
        product_edge_outbox_before_missing_snapshot
    );
    assert_eq!(rd_attempt_after_missing_snapshot, missing_snapshot_attempt);

    let mut tampered_attempt = rd_attempt_after_retry.clone();
    let reservation = tampered_attempt["invocation_claim"]
        .as_object_mut()
        .unwrap();
    let tampered_claimed_state_digest = format!("sha256:{}", "b".repeat(64));
    reservation.insert(
        "claimed_state_digest".to_string(),
        tampered_claimed_state_digest.clone().into(),
    );
    let request_identity = reservation["request_identity"]
        .as_str()
        .unwrap()
        .to_string();
    let admission_identity = reservation["admission_identity"]
        .as_str()
        .unwrap()
        .to_string();
    let reserved_attempt_identity = reservation["attempt_identity"]
        .as_str()
        .unwrap()
        .to_string();
    let reserved_claim_identity = reservation["claim_identity"].as_str().unwrap().to_string();
    let claim_digest = reservation["claim_digest"].as_str().unwrap().to_string();
    let admission_receipt_identity = reservation["invocation_admission_receipt_identity"]
        .as_str()
        .unwrap()
        .to_string();
    let admission_receipt_digest = reservation["invocation_admission_receipt_digest"]
        .as_str()
        .unwrap()
        .to_string();
    let execution_custody_digest = reservation["execution_custody_digest"]
        .as_str()
        .unwrap()
        .to_string();
    let reserved_at_epoch_ms = reservation["reserved_at_epoch_ms"].as_u64().unwrap();
    let tampered_seal = seal_invocation_reservation(ArtifactInvocationReservationMeaningV1 {
        request_identity: &request_identity,
        admission_identity: &admission_identity,
        attempt_identity: &reserved_attempt_identity,
        claim_identity: &reserved_claim_identity,
        claim_digest: &claim_digest,
        invocation_admission_receipt_identity: &admission_receipt_identity,
        invocation_admission_receipt_digest: &admission_receipt_digest,
        claimed_state_digest: &tampered_claimed_state_digest,
        execution_custody_digest: &execution_custody_digest,
        reserved_at_epoch_ms,
    })
    .unwrap();
    reservation.insert(
        "reservation_identity".to_string(),
        tampered_seal.reservation_identity().into(),
    );
    reservation.insert(
        "reservation_digest".to_string(),
        tampered_seal.reservation_digest().into(),
    );
    sqlx::query(
        "UPDATE rd_artifact_build_attempts_v1 SET attempt_json=$1 WHERE build_request_identity=$2",
    )
    .bind(&tampered_attempt)
    .bind(&build_request_identity)
    .execute(rd_owner_pool)
    .await
    .unwrap();
    let product_edge_state_before_tampered_retry: serde_json::Value = sqlx::query_scalar(
        "SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
    )
    .bind(&claim_identity)
    .fetch_one(product_edge_pool)
    .await
    .unwrap();
    let product_edge_outbox_before_tampered_retry: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE aggregate_identity=$1",
    )
    .bind(&claim_identity)
    .fetch_one(product_edge_pool)
    .await
    .unwrap();

    let rejected = start_provider_invocation(State(state), headers, start_body).await;
    let product_edge_state_after_tampered_retry: serde_json::Value = sqlx::query_scalar(
        "SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
    )
    .bind(&claim_identity)
    .fetch_one(product_edge_pool)
    .await
    .unwrap();
    let product_edge_outbox_after_tampered_retry: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE aggregate_identity=$1",
    )
    .bind(&claim_identity)
    .fetch_one(product_edge_pool)
    .await
    .unwrap();
    let rd_attempt_after_tampered_retry: serde_json::Value = sqlx::query_scalar(
        "SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1",
    )
    .bind(&build_request_identity)
    .fetch_one(rd_owner_pool)
    .await
    .unwrap();

    // The ordered chain shares one store: a later entry's directory read verifies every
    // recent attempt and would rightly refuse this tampered seal. Restore the exact custody
    // the proof found after its own legitimate retry, and prove the restoration reads back,
    // before anything about the refusal is asserted, so a failed assertion cannot leave the
    // tamper behind.
    sqlx::query(
        "UPDATE rd_artifact_build_attempts_v1 SET attempt_json=$1 WHERE build_request_identity=$2",
    )
    .bind(&rd_attempt_after_retry)
    .bind(&build_request_identity)
    .execute(rd_owner_pool)
    .await
    .unwrap();
    let rd_attempt_after_restore: serde_json::Value = sqlx::query_scalar(
        "SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1",
    )
    .bind(&build_request_identity)
    .fetch_one(rd_owner_pool)
    .await
    .unwrap();
    assert_eq!(rd_attempt_after_restore, rd_attempt_after_retry);
    assert_eq!(rejected.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        rejected.headers().get("x-rd-rejection-code").unwrap(),
        "OWNER_OUTCOME_UNKNOWN"
    );
    assert_eq!(
        product_edge_state_after_tampered_retry,
        product_edge_state_before_tampered_retry
    );
    assert_eq!(
        product_edge_outbox_after_tampered_retry,
        product_edge_outbox_before_tampered_retry
    );
    assert_eq!(rd_attempt_after_tampered_retry, tampered_attempt);
}

async fn rd_owned_relation_snapshot(pool: &sqlx::PgPool) -> Vec<(String, serde_json::Value)> {
    let relations: Vec<String> = sqlx::query_scalar(
        "SELECT class.relname
           FROM pg_catalog.pg_class class
           JOIN pg_catalog.pg_namespace namespace ON namespace.oid=class.relnamespace
           JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=class.relowner
          WHERE namespace.nspname='public'
            AND class.relkind IN ('r','p')
            AND owner_role.rolname='rd_owner'
          ORDER BY class.relname",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    let mut snapshot = Vec::with_capacity(relations.len());
    for relation in relations {
        let quoted = relation.replace('"', "\"\"");
        let rows: serde_json::Value = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT COALESCE(jsonb_agg(row_value ORDER BY row_value::text),'[]'::jsonb)
               FROM (SELECT to_jsonb(table_row) AS row_value
                       FROM public.\"{quoted}\" table_row) relation_snapshot"
        )))
        .fetch_one(pool)
        .await
        .unwrap();
        snapshot.push((relation, rows));
    }
    snapshot
}

async fn get_exploratory_result_target(
    address: std::net::SocketAddr,
    token: &str,
    target: &str,
) -> (StatusCode, Vec<u8>) {
    let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
    let request = format!(
        "GET {target} HTTP/1.1\r\nHost: {address}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.unwrap();
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .expect("HTTP response headers")
        + 4;
    let status = std::str::from_utf8(&response[..header_end])
        .unwrap()
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok())
        .and_then(|value| StatusCode::from_u16(value).ok())
        .expect("HTTP response status");
    (status, response[header_end..].to_vec())
}

async fn get_exploratory_result(
    address: std::net::SocketAddr,
    token: &str,
    result_identity: &str,
    request_identity: &str,
    attempt_identity: &str,
    extra_query: Option<(&str, &str)>,
) -> (StatusCode, Vec<u8>) {
    let extra_query = extra_query
        .map(|(name, value)| format!("&{name}={value}"))
        .unwrap_or_default();
    get_exploratory_result_target(
        address,
        token,
        &format!(
            "/v2/exploratory-replay-results/{result_identity}?request_identity={request_identity}&attempt_identity={attempt_identity}{extra_query}"
        ),
    )
    .await
}

/// The Result this entry reads is the Backtest Owner's own fixture: no R&D request seals its
/// request, so no TrialFamily census can count it. The custody adapter still locks it and
/// returns it exactly, and the HTTP read refuses it by name rather than show a Result no
/// census counts. A counted Result reading back is proven by the run report entry, which counts
/// its run, and by the browser entry after it, which opens that Result through the read API.
#[tokio::test]
#[ignore = "requires the canonical Backtest result commit immediately before this R&D HTTP consumer"]
async fn exploratory_replay_result_http_read_locks_exact_custody_and_refuses_an_uncounted_result() {
    let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
    let mutation = test_database.mutation();
    let backtest_pool = mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner);
    let aggregate = sqlx::query(
        "SELECT result.result_identity, result.request_identity, result.attempt_identity,
                result.canonical_bytes AS result_bytes,
                receipt.canonical_bytes AS receipt_bytes,
                outbox.canonical_bytes AS outbox_bytes
           FROM public.backtest_replay_results_v2 result
           JOIN public.backtest_replay_result_receipts_v1 receipt
             ON receipt.result_identity=result.result_identity
           JOIN public.backtest_replay_result_outbox_v1 outbox
             ON outbox.result_identity=result.result_identity
          WHERE result.request_identity='request' AND result.attempt_identity='attempt'",
    )
    .fetch_one(backtest_pool)
    .await
    .expect("canonical Backtest commit fixture must precede the R&D consumer");
    let result_identity: String = aggregate.try_get("result_identity").unwrap();
    let request_identity: String = aggregate.try_get("request_identity").unwrap();
    let attempt_identity: String = aggregate.try_get("attempt_identity").unwrap();
    let result_bytes: Vec<u8> = aggregate.try_get("result_bytes").unwrap();
    let receipt_bytes: Vec<u8> = aggregate.try_get("receipt_bytes").unwrap();
    let outbox_bytes: Vec<u8> = aggregate.try_get("outbox_bytes").unwrap();

    let owner = Arc::new(
        PostgresResearchGoalOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            test_database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
        )
        .await
        .unwrap(),
    );
    let rd_database_url = test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner);
    let query_separator = if rd_database_url.contains('?') {
        '&'
    } else {
        '?'
    };
    let unavailable_owner = Arc::new(
        PostgresResearchGoalOwnerV1::connect(
            &format!("{rd_database_url}{query_separator}options=-c%20lock_timeout%3D200ms"),
            test_database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
        )
        .await
        .unwrap(),
    );
    let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
    let locator = ExploratoryReplayResultLocatorV2 {
        result_identity: &result_identity,
        request_identity: &request_identity,
        attempt_identity: &attempt_identity,
    };
    let mut custody = rd_pool.begin().await.unwrap();
    let locked = vibe_strategy_factory::resolve_exploratory_replay_result_for_rd_in_transaction(
        &mut custody,
        locator,
    )
    .await
    .expect("canonical Backtest aggregate must pass locked R&D resolution")
    .expect("exact result locator must resolve");
    custody.rollback().await.unwrap();
    assert_eq!(locked.result_canonical_bytes(), result_bytes);
    assert_eq!(locked.receipt_canonical_bytes(), receipt_bytes);
    assert_eq!(locked.outbox_canonical_bytes(), outbox_bytes);
    assert!(
        matches!(
            owner.resolve_exploratory_replay_result_v2(locator).await,
            Err(vibe_strategy_factory::ExploratoryResultCensusErrorV1::RequestUnavailable(_))
        ),
        "a Result no R&D request seals is not shown"
    );

    let before = rd_owned_relation_snapshot(rd_pool).await;
    let token = "rd-exploratory-result-consumer-test";
    let token_digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();

    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            exploratory_replay::result_router(owner, token_digest),
        )
        .await
    });
    let (status, body) = get_exploratory_result(
        address,
        token,
        &result_identity,
        &request_identity,
        &attempt_identity,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()["error"],
        "EXPLORATORY_RESULT_REQUEST_UNAVAILABLE"
    );

    for (result, request, attempt) in [
        (
            "unknown-result",
            request_identity.as_str(),
            attempt_identity.as_str(),
        ),
        (
            result_identity.as_str(),
            "cross-spliced-request",
            attempt_identity.as_str(),
        ),
        (
            result_identity.as_str(),
            request_identity.as_str(),
            "cross-spliced-attempt",
        ),
    ] {
        assert_eq!(
            get_exploratory_result(address, token, result, request, attempt, None)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
    }
    assert_eq!(
        get_exploratory_result(
            address,
            token,
            &result_identity,
            &request_identity,
            &attempt_identity,
            Some(("result_bytes", "caller-supplied")),
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let invalid_or_missing_targets = [
        format!(
            "/v2/exploratory-replay-results/%20?request_identity={request_identity}&attempt_identity={attempt_identity}"
        ),
        format!(
            "/v2/exploratory-replay-results/{result_identity}?request_identity=%20&attempt_identity={attempt_identity}"
        ),
        format!(
            "/v2/exploratory-replay-results/{result_identity}?request_identity={request_identity}&attempt_identity=%20"
        ),
        format!("/v2/exploratory-replay-results/{result_identity}"),
        format!(
            "/v2/exploratory-replay-results/{result_identity}?request_identity={request_identity}"
        ),
        format!(
            "/v2/exploratory-replay-results/{result_identity}?attempt_identity={attempt_identity}"
        ),
    ];

    for target in invalid_or_missing_targets {
        let (status, body) = get_exploratory_result_target(address, token, &target).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap()["error"],
            "INVALID_EXPLORATORY_REPLAY_RESULT_LOCATOR"
        );
    }

    server.abort();
    let _ = server.await;

    let mut topology_fault = rd_pool.begin().await.unwrap();
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))")
        .bind("vibe.backtest.result-topology.v2")
        .execute(&mut *topology_fault)
        .await
        .unwrap();
    let unavailable_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let unavailable_address = unavailable_listener.local_addr().unwrap();

    let unavailable_server = tokio::spawn(async move {
        axum::serve(
            unavailable_listener,
            exploratory_replay::result_router(unavailable_owner, token_digest),
        )
        .await
    });
    let (status, body) = get_exploratory_result(
        unavailable_address,
        token,
        &result_identity,
        &request_identity,
        &attempt_identity,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()["error"],
        "EXPLORATORY_REPLAY_RESULT_UNAVAILABLE"
    );
    unavailable_server.abort();
    let _ = unavailable_server.await;
    topology_fault.rollback().await.unwrap();

    let after = rd_owned_relation_snapshot(rd_pool).await;
    assert_eq!(
        after, before,
        "R&D HTTP result readback must write no R&D fact"
    );
}

/// The columns a replay needs from a stored joint freeze: the Research locator it was
/// committed under, the canonical Design identity and bytes, the joint freeze digest, and the
/// commit time a replay has to rejoin rather than replace.
type StoredJointFreeze = (String, Vec<u8>, Vec<u8>, Vec<u8>, i64);

/// Ensures the sealed Catalog V3 head a chain entry's Research request forms its TrialFamily
/// against, so the entry needs no earlier entry to have published it. Alone on a fresh cluster
/// this creates the head; after another entry has ensured it, it resolves the same head exactly.
#[cfg(feature = "sealed-source-intake-acceptance")]
pub(crate) async fn ensure_sealed_catalog_v3(test_database: &CanonicalOwnerPostgresTestDatabaseV1) {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_url(
            test_database.database_url(CanonicalOwnerTestRoleV1::ReplayPolicyCatalogAdminWriter),
            PostgresTls::Disabled,
        )
        .await
        .expect("the Catalog administrator connects");
    ensure_replay_policy_catalog_fixture_v3(&pool)
        .await
        .expect("the sealed Catalog V3 head is created or resolved exactly");
}

/// Ensures the chain's Market Data acceptance basis - Source Binding, Instrument Master fact,
/// eligible frontier, clock head, base PIT and Market Semantics - for an entry that reads it, so
/// the entry needs no earlier entry to have written it. Alone on a fresh cluster this writes the
/// basis; after another entry has, it rejoins it exactly and moves no pointer.
pub(crate) async fn ensure_market_data_acceptance_basis(
    test_database: &CanonicalOwnerPostgresTestDatabaseV1,
) -> MarketDataAcceptanceBasisV1 {
    ensure_market_data_acceptance_basis_v1(
        test_database.database_url(CanonicalOwnerTestRoleV1::MarketDataOwner),
        CHAIN_MARKET_DATA_ACCEPTANCE_BASIS_V1,
    )
    .await
    .expect("the chain's Market Data acceptance basis is written or rejoined")
}

/// An entry that reads a current Market Data pointer states it first: another entry in the same
/// database may have moved it since the basis was written, and a read that took the moved
/// pointer would still pass.
pub(crate) async fn require_basis_pointer(
    test_database: &CanonicalOwnerPostgresTestDatabaseV1,
    basis: &MarketDataAcceptanceBasisV1,
    pointer: MarketDataAcceptanceBasisPointerV1,
) {
    basis
        .require_current_in(
            test_database.database_url(CanonicalOwnerTestRoleV1::MarketDataOwner),
            pointer,
        )
        .await
        .unwrap_or_else(|e| {
            panic!("Market Data's current {pointer:?} is the acceptance basis's: {e}")
        });
}

/// A frozen program replays over HTTP to the same freeze the in-process entry committed.
///
/// `product_edge_postgres::tests::declared_bounded_feature_program_assembles_from_owner_custody_and_freezes`
/// proves this path against the Owner directly. It cannot prove the transport, because it
/// never crosses one, and `market_data_pit::router` is private to this binary, so nothing
/// drove these routes in order. While nothing did, the declaration's refusal read as a
/// missing capability rather than a missing call.
///
/// The Design is read back rather than built. A Design that can carry Market Data custody is
/// not a static document: it is a base bound at run time to live Research custody, so its
/// identity differs every run and a committed copy matches no published intent. The bound
/// bytes survive in the freeze the entry above committed, which is the only place they do.
/// Declared meaning is committed, because none of the four bound fields are meaning.
///
/// Publishing the role intent is therefore not driven here. That step needs a Design bound to
/// custody that has not been frozen yet, and what this database holds is one already frozen.
///
/// Sending the frozen pair again is a replay, and that is the stronger assertion: the receipt
/// must name the freeze already stored, not merely answer 200. A route that reached some other
/// freeze, or minted a second one, would still answer 200.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires the ordered chain's PostgreSQL and the freeze an earlier entry commits"]
async fn frozen_program_replays_over_http_to_the_same_joint_freeze() {
    use axum::body::Body;
    use axum::extract::Request;
    use tower::ServiceExt;
    use vibe_strategy_factory::{
        bounded_feature_program_derivation_v1::BoundedFeatureProgramMeaningV1,
        strategy_design_v2::StrategyDesignV2,
    };

    let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
    // The Market Data acceptance basis this entry reads, ensured here rather than left to an
    // earlier entry.
    let _basis = ensure_market_data_acceptance_basis(&test_database).await;
    #[cfg(feature = "sealed-source-intake-acceptance")]
    ensure_sealed_catalog_v3(&test_database).await;

    let bindings = composed_market_data_binding_admission(&test_database).await;

    let rd_pool = sqlx::postgres::PgPoolOptions::new()
        .connect_url(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            PostgresTls::Disabled,
        )
        .await
        .unwrap();
    let freezes_before: i64 =
        sqlx::query_scalar("SELECT count(*) FROM public.rd_bounded_feature_program_freezes_v1")
            .fetch_one(&rd_pool)
            .await
            .unwrap();
    let frozen: Option<StoredJointFreeze> = sqlx::query_as(
        "SELECT request_identity, design_identity, design_bytes, joint_freeze_digest,
                committed_at_epoch_ms
           FROM public.rd_bounded_feature_program_freezes_v1
          ORDER BY committed_at_epoch_ms DESC
          LIMIT 1",
    )
    .fetch_optional(&rd_pool)
    .await
    .unwrap();
    // Zero rows is a statement about the entries before this one, not about these routes.
    // Reporting it as a route failure would send the next reader to the wrong place.
    let (locator, design_identity, design_bytes, stored_joint_freeze, _stored_committed_at) =
        frozen.expect(
            "an earlier ordered entry must have committed a Bounded Feature Program freeze: this \
         entry replays one rather than minting it, so no rows means that entry did not run",
        );

    let design: StrategyDesignV2 = serde_json::from_slice(&design_bytes)
        .expect("the stored Design bytes are the canonical Design");
    let meaning: BoundedFeatureProgramMeaningV1 = serde_json::from_str(
        &std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/test_data/six_role_bar_bounded_feature/meaning.json"
        ))
        .unwrap(),
    )
    .expect("the committed declared meaning parses");

    let token = "rd-owner-api-http-replay-test";
    let token_digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
    let owner = Arc::new(
        PostgresResearchBoundedFeatureProgramOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
        )
        .await
        .unwrap(),
    );
    let app = bounded_feature_program::router(owner, token_digest).merge(market_data_pit::router(
        market_data_pit::MarketDataAdmissions {
            intake: bootstrap_market_data_pit_intake().await.unwrap(),
            admission: bootstrap_market_data_source_binding_admission()
                .await
                .unwrap(),
            universe: bootstrap_market_data_universe_selection().await.unwrap(),
            bindings,
            instruments: bootstrap_market_data_instrument_master_admission()
                .await
                .unwrap(),
            instruments_v2: bootstrap_market_data_instrument_master_admission_v2()
                .await
                .unwrap(),
            semantics: bootstrap_market_data_market_semantics_admission()
                .await
                .unwrap(),
            economic_terms: bootstrap_instrument_economic_terms_admission()
                .await
                .unwrap(),
            catalog: None,
            binance_perpetual_admission: bootstrap_market_data_binance_perpetual_admission()
                .unwrap(),
        },
        token_digest,
    ));

    // Driven through the router rather than a socket: what is unproven is that these paths,
    // their bearer guard and their typed bodies compose in order, and the router is where all
    // three live. A listener would add the one layer nothing here doubts.
    let post = async |app: Router, path: &str, body: serde_json::Value| -> (StatusCode, String) {
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(path)
                    .header("authorization", format!("Bearer {token}"))
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        // The rejection code is a header, not a body field, and it is the only part that says
        // which refusal this is: two different 409s are spelled identically in the body.
        let code = response
            .headers()
            .get("x-rd-rejection-code")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("-")
            .to_owned();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (
            status,
            format!("[{code}] {}", String::from_utf8_lossy(&bytes)),
        )
    };

    let (status, body) = post(
        app.clone(),
        "/v1/market-data/strategy-input-bindings/from-design-intent",
        // `BindingDigest` is a newtype over `[u8; 32]` with derived serde, so the wire shape
        // is an array of thirty-two numbers rather than a hex string.
        serde_json::json!({ "design_identity": design_identity }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "admitting binding custody from the published intent: {body}",
    );

    let (status, body) = post(
        app,
        "/v1/bounded-feature-programs/declare",
        serde_json::json!({
            "research_request_locator": locator,
            "design": design,
            "meaning": meaning,
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "replaying the declaration: {body}");

    let receipt: serde_json::Value =
        serde_json::from_str(body.split_once("] ").expect("the code prefix").1)
            .expect("the freeze receipt parses");
    // The same freeze, not merely a freeze: a route that reached another one, or minted a
    // second, would also have answered 200.
    assert_eq!(
        receipt["joint_freeze_digest"].as_str().unwrap_or_default(),
        format!("sha256:{}", hex_digest(&stored_joint_freeze)),
        "the replay must name the stored joint freeze",
    );
    // Counted rather than compared against the stored commit time. Both receipt paths take
    // `committed_at_epoch_ms` from the Owner clock at the moment of the call rather than from
    // the row, so a rejoin reports when it was asked, not when the freeze was committed, and
    // the two agree only by coincidence. What a replay must not do is add a row.
    let freezes_after: i64 =
        sqlx::query_scalar("SELECT count(*) FROM public.rd_bounded_feature_program_freezes_v1")
            .fetch_one(&rd_pool)
            .await
            .unwrap();
    assert_eq!(
        freezes_after, freezes_before,
        "the replay must rejoin the stored freeze rather than commit a second one",
    );
}

/// This entry's own source-bound Research, and the Research fixture's two promises checked on the
/// way: a deployment without the Research Goal operation is refused by name, and the same
/// Research identity answers the same custody twice.
///
/// The setup runs on its own thread with a 4 MiB stack. The Research Owner's submission is a
/// deep call chain in a debug build: in the full ordered chain, under the `ci-pr` profile, it
/// overflowed a 2 MiB stack inside `submit_source_intake_research_v2`, first from this entry's
/// test body and then from a spawned task on a runtime worker, so the depth is the submission's
/// own and not this entry's. Measured by `RUST_MIN_STACK` bisection, it needs more than
/// 2,097,152 and at most 2,490,368 bytes. It overflows only on the database state the full chain
/// leaves behind; the same code passes a filtered run on a fresh database. Production runs a
/// release build, where these frames are a fraction of the size.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
mod authored_design_research {
    use std::{future::Future, pin::Pin};

    use vibe_product_edge::{
        SOURCE_INTAKE_OPERATION_SCHEMA_V1, SOURCE_INTAKE_OPERATION_V1,
        SOURCE_INTAKE_REQUIRED_EFFECTS_V1, SOURCE_INTAKE_TARGET_OWNER_V1,
        deployment_acceptance::{
            DeploymentAcceptanceOperationV1, DeploymentAcceptanceProposalV1,
            ProductEdgeDeploymentAcceptanceFixtureV1,
            ensure_product_edge_deployment_acceptance_fixture_v1,
        },
    };
    use vibe_strategy_factory::{
        product_edge::{RESEARCH_GOAL_OPERATION_V2, RESEARCH_GOAL_SCHEMA_V2},
        rd_bounded_feature_program_postgres_v1::{
            PostgresResearchBoundedFeatureProgramOwnerV1, ResearchAuthoringFactsV1,
            ResearchBoundedFeatureProgramOwnerErrorV1,
        },
        source_bound_research_acceptance_fixture_v1::{
            CurrentSourceBoundResearchAcceptanceErrorV1, CurrentSourceBoundResearchV1,
            ensure_current_source_bound_research_acceptance_fixture_v1,
        },
    };
    use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

    type Boxed<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

    /// The role URLs the setup connects with, owned so the setup task can outlive the borrow.
    struct OwnerUrlsV1 {
        operator_authorization: String,
        product_edge: String,
        rd_owner: String,
        qualification_writer: String,
        catalog_admin: String,
    }

    /// The entry's Research locator and its authoring facts, read again at a fresh cut.
    pub(super) fn research<'a>(
        test_database: &'a CanonicalOwnerPostgresTestDatabaseV1,
        owner: &'a PostgresResearchBoundedFeatureProgramOwnerV1,
    ) -> Boxed<'a, (String, ResearchAuthoringFactsV1)> {
        let urls = OwnerUrlsV1 {
            operator_authorization: test_database
                .database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter)
                .to_owned(),
            product_edge: test_database
                .database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner)
                .to_owned(),
            rd_owner: test_database
                .database_url(CanonicalOwnerTestRoleV1::RdOwner)
                .to_owned(),
            qualification_writer: test_database
                .database_url(CanonicalOwnerTestRoleV1::QualificationWriter)
                .to_owned(),
            catalog_admin: test_database
                .database_url(CanonicalOwnerTestRoleV1::ReplayPolicyCatalogAdminWriter)
                .to_owned(),
        };
        Box::pin(async move {
            let (locator, current) = tokio::task::spawn_blocking(move || {
                std::thread::Builder::new()
                    .name("rd-api-authored-design-research".into())
                    .stack_size(4 * 1024 * 1024)
                    .spawn(move || {
                        tokio::runtime::Builder::new_current_thread()
                            .enable_all()
                            .build()
                            .expect("the setup thread's runtime starts")
                            .block_on(own_research(urls))
                    })
                    .expect("the setup thread starts")
                    .join()
            })
            .await
            .expect("the setup thread is joined")
            .unwrap_or_else(|failure| std::panic::resume_unwind(failure));
            assert_eq!(
                authoring_facts(owner, &locator)
                    .await
                    .expect("the committed Research is current at a fresh cut"),
                current.authoring
            );
            (locator, current.authoring)
        })
    }

    async fn own_research(urls: OwnerUrlsV1) -> (String, CurrentSourceBoundResearchV1) {
        let suffix = format!(
            "{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let source_intake_operation = DeploymentAcceptanceOperationV1 {
            operation: SOURCE_INTAKE_OPERATION_V1.into(),
            operation_schema: SOURCE_INTAKE_OPERATION_SCHEMA_V1.into(),
            allowed_effects: SOURCE_INTAKE_REQUIRED_EFFECTS_V1.map(Into::into).to_vec(),
        };
        let research_operation = DeploymentAcceptanceOperationV1 {
            operation: RESEARCH_GOAL_OPERATION_V2.into(),
            operation_schema: RESEARCH_GOAL_SCHEMA_V2.into(),
            allowed_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".into()],
        };

        let without_research = deployment(
            &urls,
            "rd-api-authored-design-source-intake-only",
            vec![source_intake_operation.clone()],
        )
        .await;
        let refused_identity = format!("rd-api-authored-design-refused-{suffix}");
        let refused = source_bound_research(&urls, &without_research, &refused_identity).await;
        assert!(
            matches!(
                refused,
                Err(
                    CurrentSourceBoundResearchAcceptanceErrorV1::OperationNotDeployed {
                        operation: RESEARCH_GOAL_OPERATION_V2
                    }
                )
            ),
            "{refused:?}"
        );

        let with_research = deployment(
            &urls,
            "rd-api-authored-design",
            vec![source_intake_operation, research_operation],
        )
        .await;
        let locator = format!("rd-api-authored-design-{suffix}");
        let current = source_bound_research(&urls, &with_research, &locator)
            .await
            .expect("this entry's source-bound Research is committed and current");
        // Idempotent through the Owners' own replays: the same identity answers the same
        // custody.
        assert_eq!(
            source_bound_research(&urls, &with_research, &locator)
                .await
                .expect("the same Research identity resolves again"),
            current
        );
        (locator, current)
    }

    /// This entry's Product Edge deployment under `fixture_key`, bound to exactly `operations`.
    fn deployment<'a>(
        urls: &'a OwnerUrlsV1,
        fixture_key: &'a str,
        operations: Vec<DeploymentAcceptanceOperationV1>,
    ) -> Boxed<'a, ProductEdgeDeploymentAcceptanceFixtureV1> {
        Box::pin(async move {
            ensure_product_edge_deployment_acceptance_fixture_v1(
                &urls.operator_authorization,
                &urls.product_edge,
                &DeploymentAcceptanceProposalV1 {
                    fixture_key: fixture_key.to_owned(),
                    audience: SOURCE_INTAKE_TARGET_OWNER_V1.into(),
                    permissions: vec![
                        "research:source-intake".into(),
                        "research:submit".into(),
                        "research:view".into(),
                    ],
                    operations,
                },
            )
            .await
            .unwrap_or_else(|e| panic!("the deployment {fixture_key} is ensured: {e}"))
        })
    }

    /// The source-bound Research fixture for `identity`, admitted through `deployment`.
    fn source_bound_research<'a>(
        urls: &'a OwnerUrlsV1,
        deployment: &'a ProductEdgeDeploymentAcceptanceFixtureV1,
        identity: &'a str,
    ) -> Boxed<'a, Result<CurrentSourceBoundResearchV1, CurrentSourceBoundResearchAcceptanceErrorV1>>
    {
        Box::pin(ensure_current_source_bound_research_acceptance_fixture_v1(
            &urls.rd_owner,
            &urls.qualification_writer,
            &urls.catalog_admin,
            &urls.product_edge,
            deployment,
            identity,
        ))
    }

    /// The R&D Owner's authoring facts for `locator` at a fresh cut.
    fn authoring_facts<'a>(
        owner: &'a PostgresResearchBoundedFeatureProgramOwnerV1,
        locator: &'a str,
    ) -> Boxed<'a, Result<ResearchAuthoringFactsV1, ResearchBoundedFeatureProgramOwnerErrorV1>>
    {
        Box::pin(owner.read_research_authoring_facts_v1(locator))
    }
}

/// Carries a Design this repository authored, not one an acceptance fixture committed, through
/// the three routes that publish it, bind it and freeze it.
///
/// `POST /v1/strategy-designs/publish-role-intent` had never been called by anything. The route
/// is mounted and alive, and `author_single_threshold_program_v1` produces exactly the body it
/// accepts, but nothing joined the two: the only producer reachable from a default build writes
/// its JSON to stdout. Every other entry that reaches this area replays a Design read back from
/// a freeze that `bounded_feature_program_six_role_bar_fixture_v1` committed, and that fixture
/// exists only under `cfg(all(test, feature = "sealed-strategy-input-acceptance"))`.
///
/// Everything the Research custody owns is taken from it rather than invented, and the two
/// routes disagree about how much that is. `derive_design_role_intent_v1` compares three
/// identities, so publication accepts a Design that carries its own falsifier;
/// `freeze_research_bounded_feature_program_v1` compares four, the fourth being the falsifier,
/// so the same Design is refused at declare with `RESEARCH_CUSTODY_MISMATCH`. Authoring one
/// field freely is enough to pass the first route and fail the second. What is new here is the
/// Design, not the Research.
///
/// The authored channel is the daily close of the chain fixtures' instrument
/// (`CHAIN_FIXTURE_INSTRUMENT_V1`) because the binding admission resolves
/// every role against this Owner's own PIT custody at the decision cut, and the only coordinates
/// the ordered chain supplies are the six that
/// `prepare_owner_bar_joined_cut_acceptance_basis_v1` commits at entry 33 - `MARKET`, `BAR`,
/// scale 2, on that instrument. A freely chosen coordinate is refused with
/// `STRATEGY_INPUT_SNAPSHOT_UNAVAILABLE`, which would be a true statement about what the chain
/// stocks and no statement at all about the route under test.
///
/// The declaration is asserted to add exactly one freeze rather than to answer 200. A Design
/// that was already frozen rejoins its freeze and also answers 200, so the count is what
/// separates a first declaration from a replay, and the stored bytes are compared against what
/// was authored because some other Design's freeze would satisfy the count too.
// It authors on the chain fixtures' instrument and commits its own source-bound Research, both
// of which only the sealed acceptance build the ordered chain runs exposes; outside that build
// the test is `ignore`d anyway.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires the ordered chain's PostgreSQL; it ensures the Market Data basis it reads"]
async fn an_authored_design_is_published_bound_and_frozen_over_http() {
    use axum::body::Body;
    use axum::extract::Request;
    use tower::ServiceExt;
    use vibe_strategy_factory::{
        bounded_feature_program_v1::BoundedFeaturePredicateV1,
        rd_bounded_feature_program_postgres_v1::PostgresResearchBoundedFeatureProgramOwnerV1,
        single_threshold_authoring_v1::{
            SingleThresholdAuthoringRequestV1, SingleThresholdChannelV1, SingleThresholdOutcomeV1,
            author_single_threshold_program_v1,
        },
    };

    let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
    // The Market Data acceptance basis this entry reads, ensured here rather than left to an
    // earlier entry.
    let basis = ensure_market_data_acceptance_basis(&test_database).await;
    require_basis_pointer(
        &test_database,
        &basis,
        MarketDataAcceptanceBasisPointerV1::ClockHead,
    )
    .await;

    let rd_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect_url(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            PostgresTls::Disabled,
        )
        .await
        .unwrap();

    let token = "rd-owner-api-authored-design-test";
    let token_digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
    let owner = Arc::new(
        PostgresResearchBoundedFeatureProgramOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
        )
        .await
        .unwrap(),
    );

    // A Research identity accepts exactly one freeze, and answers every later, different
    // Design with JOINT_FREEZE_CHANGED_MEANING, so this entry freezes a Research of its own,
    // committed for this run through the production Owners, rather than one an earlier entry
    // left behind.
    let (locator, facts) = authored_design_research::research(&test_database, &owner).await;

    let (authored, meaning) =
        author_single_threshold_program_v1(&SingleThresholdAuthoringRequestV1 {
            research_request_identity: facts.research_request_identity,
            intent_identity: facts.intent_identity,
            intent_digest: facts.intent_digest,
            channel: SingleThresholdChannelV1::ExactInstrument {
                role_semantic_id: "research.input.close.daily.v1".to_owned(),
                instrument: vibe_data::owner::chain_fixture_v1::CHAIN_FIXTURE_INSTRUMENT_V1
                    .to_owned(),
                field_semantic_id: "MARKET_DATA.BAR.CLOSE.PRICE.V1".to_owned(),
                timeframe: "1D".to_owned(),
                unit: "PRICE".to_owned(),
                scale: 2,
            },
            threshold: "100".to_owned(),
            comparison: BoundedFeaturePredicateV1::Greater,
            when_true: SingleThresholdOutcomeV1 {
                position_intent_semantic_id: "kernel.position.enter.v1".to_owned(),
                target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
                target_position_units: 1,
                target_weight_micros: 0,
            },
            otherwise: SingleThresholdOutcomeV1 {
                position_intent_semantic_id: "kernel.position.exit.v1".to_owned(),
                target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
                target_position_units: 0,
                target_weight_micros: 0,
            },
            // From custody, not invented. The freeze compares four fields against the
            // accepted Research custody and the falsifier is the fourth: an authored one
            // publishes (that route derives the role intent from three identities) and then
            // refuses at declare with RESEARCH_CUSTODY_MISMATCH.
            stop_loss_fraction: None,
            take_profit_fraction: None,
            max_holding_bars: None,
            falsifier: facts.falsifier.clone(),
        })
        .expect("the authoring surface must author this statement");

    let bindings = composed_market_data_binding_admission(&test_database).await;
    let app = bounded_feature_program::router(owner, token_digest).merge(market_data_pit::router(
        market_data_pit::MarketDataAdmissions {
            intake: bootstrap_market_data_pit_intake().await.unwrap(),
            admission: bootstrap_market_data_source_binding_admission()
                .await
                .unwrap(),
            universe: bootstrap_market_data_universe_selection().await.unwrap(),
            bindings,
            instruments: bootstrap_market_data_instrument_master_admission()
                .await
                .unwrap(),
            instruments_v2: bootstrap_market_data_instrument_master_admission_v2()
                .await
                .unwrap(),
            semantics: bootstrap_market_data_market_semantics_admission()
                .await
                .unwrap(),
            economic_terms: bootstrap_instrument_economic_terms_admission()
                .await
                .unwrap(),
            catalog: None,
            binance_perpetual_admission: bootstrap_market_data_binance_perpetual_admission()
                .unwrap(),
        },
        token_digest,
    ));

    let post = async |app: Router, path: &str, body: serde_json::Value| -> (StatusCode, String) {
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(path)
                    .header("authorization", format!("Bearer {token}"))
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        // The rejection code is a header, not a body field, and it is the only part that
        // says which refusal this is: two different 409s are spelled identically in the
        // body.
        let code = response
            .headers()
            .get("x-rd-rejection-code")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("-")
            .to_owned();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (
            status,
            format!("[{code}] {}", String::from_utf8_lossy(&bytes)),
        )
    };

    let (status, body) = post(
        app.clone(),
        "/v1/strategy-designs/publish-role-intent",
        serde_json::json!({
            "research_request_locator": locator,
            "design": authored,
        }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "the first authored Design this repository ever sent must be published: {body}",
    );

    // 200 alone would also be the answer of a route that accepted the body and published the
    // Design it already had. The published intent must name the authored Design, so its identity
    // is compared against the frozen one whose Research identities this entry borrowed.
    let published: serde_json::Value =
        serde_json::from_str(body.split_once("] ").expect("the code prefix").1)
            .expect("the published role intent is JSON");
    let published_design_identity = published
        .get("design_identity")
        .expect("the published role intent names the Design it published")
        .clone();
    // A shape check rather than a comparison against another Design. This entry no longer
    // borrows a frozen Design's identities, so there is no second digest to be unequal to;
    // what the published intent names is settled at the end, by the bytes the freeze stores.
    let published_bytes = published_design_identity
        .as_array()
        .expect("a published design identity is a byte array");
    assert_eq!(
        published_bytes.len(),
        32,
        "a design identity is a 32-byte digest",
    );
    assert!(
        published
            .get("roles")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|roles| !roles.is_empty()),
        "a published role intent with no roles describes no Design: {body}",
    );

    // Publishing proves the Design is well formed and names its Research. It does not prove this
    // Owner can bind it: that route resolves every role against its own PIT custody at the
    // decision cut and refuses a coordinate it does not hold, which is why the authored channel
    // is the daily close of the instrument the ordered chain's basis supplies rather than a
    // coordinate chosen freely.
    let (status, body) = post(
        app.clone(),
        "/v1/market-data/strategy-input-bindings/from-design-intent",
        serde_json::json!({ "design_identity": published_design_identity }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "the authored Design's roles must resolve to Owner-held snapshots: {body}",
    );

    // Counted for this Research identity rather than for the table, because other ordered
    // entries commit freezes of their own and a whole-table delta would be their count as
    // much as this one's. Zero here is also what makes the declaration below a first freeze
    // rather than a replay: a replay answers 200 and adds none.
    let freezes_before: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.rd_bounded_feature_program_freezes_v1
          WHERE request_identity = $1",
    )
    .bind(&locator)
    .fetch_one(&rd_pool)
    .await
    .unwrap();
    assert_eq!(
        freezes_before, 0,
        "the selected Research identity already has a freeze, so this entry would be asserting \
         a replay rather than a first freeze",
    );
    let (status, body) = post(
        app,
        "/v1/bounded-feature-programs/declare",
        serde_json::json!({
            "research_request_locator": locator,
            "design": authored,
            "meaning": meaning,
        }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "declaring the authored Design must assemble and freeze it: {body}",
    );

    let freezes_after: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.rd_bounded_feature_program_freezes_v1
          WHERE request_identity = $1",
    )
    .bind(&locator)
    .fetch_one(&rd_pool)
    .await
    .unwrap();
    assert_eq!(
        freezes_after, 1,
        "an authored Design on an unfrozen Research identity must commit exactly one freeze",
    );

    // The count alone would also be satisfied by a freeze of some other Design committed by
    // this call, so the stored Design is compared against the one this entry published.
    //
    // By identity rather than by bytes. The Owner stores the canonical Design, and
    // `serde_json::to_vec` of the authored value is not that: canonicalization sorts
    // `reactions`, `plugins` and each node's `output_port_ids`, so the two encodings differ in
    // order while being the same Design, and comparing them failed while everything it was
    // meant to check was correct. The canonicalizer is `pub(crate)`, so this crate cannot
    // reproduce those bytes, and hand-rolling an order-insensitive comparison here would be a
    // second, weaker statement of the Owner's own notion of Design equality. The identity is
    // that notion: it is derived from the canonical bytes, the publication reported it for the
    // Design this entry authored, and the freeze row carries it for the Design it committed.
    let stored_design_identity: Vec<u8> = sqlx::query_scalar(
        "SELECT design_identity
           FROM public.rd_bounded_feature_program_freezes_v1
          WHERE request_identity = $1",
    )
    .bind(&locator)
    .fetch_one(&rd_pool)
    .await
    .unwrap();
    let published_identity_bytes: Vec<u8> = published_bytes
        .iter()
        .map(|byte| {
            u8::try_from(byte.as_u64().expect("a digest byte is a JSON number"))
                .expect("a digest byte fits in u8")
        })
        .collect();
    assert_eq!(
        stored_design_identity.len(),
        32,
        "a stored design identity is a 32-byte digest",
    );
    assert_eq!(
        stored_design_identity, published_identity_bytes,
        "the freeze this entry committed must hold the Design this entry published",
    );
}

/// Composes the Market Data binding admission the ordered chain's entries drive their routes
/// with, and refuses to hand back one that is absent.
///
/// The admission is composed from the environment and the chain exports neither URL, so an
/// entry that omits them receives `None`, and its routes then answer 503 about their own
/// configuration rather than about the Design under test.
///
/// The two variables and the check that they worked live in one function because separating
/// them is how they came apart: an entry took the assertion from its neighbour without the
/// block three hundred lines above that makes it hold, and failed on the assertion rather than
/// on the omission. The comment there predicted that failure exactly and did not prevent it,
/// because code is copied upward and comments are not read upward. Here the assertion cannot
/// be taken without the setup.
///
/// The roles are pinned in SQL rather than by convention: the composer cut lock refuses any
/// `session_user` outside ('market_data_reader','market_data_owner'), and the reader's connect
/// checks sixteen ACL flags exactly, including that it reaches a published intent only through
/// a function and holds no direct table privilege. A wrong role fails the way a missing URL
/// does.
pub(super) async fn composed_market_data_binding_admission(
    test_database: &CanonicalOwnerPostgresTestDatabaseV1,
) -> Option<Arc<dyn StrategyInputBindingAdmissionV1>> {
    unsafe {
        env::set_var(
            "MARKET_DATA_OWNER_DATABASE_URL",
            test_database.database_url(CanonicalOwnerTestRoleV1::MarketDataOwner),
        );
    }
    unsafe {
        env::set_var(
            "MARKET_DATA_RD_ROLE_SET_DATABASE_URL",
            test_database.database_url(CanonicalOwnerTestRoleV1::MarketDataReader),
        );
    }
    let bindings = bootstrap_market_data_strategy_input_bindings()
        .await
        .unwrap();
    assert!(
        bindings.is_some(),
        "the strategy input binding admission must be composed before its routes are driven",
    );
    bindings
}

/// Runs the production Composer on a Design this repository authored, to a durable Artifact.
///
/// The entry before this one authors a Design, carries it through publication and binding
/// admission, and freezes it. Nothing then ran it. The chain's only Composer RUN is
/// `frozen_program_runs_the_production_composer_to_a_durable_artifact`, which drives the same
/// production code from `bounded_feature_program_six_role_bar_fixture_v1` behind
/// `sealed-strategy-input-acceptance`: the production path was covered, its production input
/// was not.
///
/// The freeze is found by the Design's own shape rather than by ordering. Ordering would pick
/// whatever froze last, and entries after the authoring one commit freezes of their own; the
/// authored program declares exactly one input role, the daily close of the chain fixtures'
/// instrument, while every other frozen Design in this database carries the fixture's six.
/// Exactly one match is asserted, so a second authored Design later would fail here rather
/// than silently pick one.
///
/// `Success` is asserted rather than `Ok`. A Research request with no verifiable joint freeze
/// returns a terminal disposition and writes nothing, so the call returns `Ok` for five of the
/// six dispositions and `.is_ok()` would hold for every refusal this entry exists to rule out.
///
/// The Artifact's `design_digest` is then compared against the one stored on the freeze row.
/// `Success` alone would also be the answer of a run that built the fixture's Artifact, and
/// both digests are the Owner's own, derived from canonical bytes this crate cannot reproduce.
///
/// It costs two real compiler invocations, so it sits immediately before the destructive
/// drain, for the same reason the fixture run does: the most expensive entry with the least
/// history behind it.
// It authors on the chain fixtures' instrument, which only the sealed acceptance build (the one
// the ordered chain runs) exposes; outside that build the test is `ignore`d anyway.
#[cfg(feature = "sealed-develop-composer-acceptance")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires the ordered chain's PostgreSQL, the freeze an earlier entry commits, and the pinned local wasm compiler"]
async fn the_authored_frozen_program_runs_the_production_composer() {
    use vibe_strategy_factory::strategy_design_v2::StrategyDesignV2;

    let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
    #[cfg(feature = "sealed-source-intake-acceptance")]
    ensure_sealed_catalog_v3(&test_database).await;
    let rd_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect_url(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            PostgresTls::Disabled,
        )
        .await
        .unwrap();

    let frozen: Vec<(String, Vec<u8>, Vec<u8>)> = sqlx::query_as(
        "SELECT request_identity, design_bytes, design_digest
           FROM public.rd_bounded_feature_program_freezes_v1",
    )
    .fetch_all(&rd_pool)
    .await
    .unwrap();
    let mut authored: Vec<(String, Vec<u8>)> = frozen
        .into_iter()
        .filter_map(|(locator, design_bytes, design_digest)| {
            let design: StrategyDesignV2 = serde_json::from_slice(&design_bytes).ok()?;
            let single_authored_role = design.inputs.len() == 1
                && design.inputs[0].semantic_id == "research.input.close.daily.v1"
                && design.inputs[0].instrument
                    == vibe_data::owner::chain_fixture_v1::CHAIN_FIXTURE_INSTRUMENT_V1;
            single_authored_role.then_some((locator, design_digest))
        })
        .collect();
    // Zero is a statement about the entry that authors and freezes, not about the Composer.
    assert_eq!(
        authored.len(),
        1,
        "expected exactly one authored single-role freeze to run, found {}: with none there is \
         nothing this entry can run, and with several it would be picking one arbitrarily",
        authored.len(),
    );
    let (locator, stored_design_digest) = authored.pop().expect("the single authored freeze");

    let composer =
        vibe_strategy_factory::source_research_composer_postgres_v2::PostgresSourceResearchComposerProductionV2::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
        )
        .await
        .expect("the production Composer opens against its two R&D roles");

    // Acceptance gate 6 (product-edge.md), on the production Composer's own path: each stored
    // Research column below, changed alone, must leave the Composer without a composition. The
    // source-ancestry evidence digest (a different well-formed sha256) is held to the request's
    // recorded source cut when the Research custody is admitted; the artifact evidence and its
    // digest are re-derived by the artifact readback the Composer's Research lock decodes. The
    // replay path never reads the artifact evidence, so this entry is where those two are
    // anchored. Each change is restored, and the entry goes on exactly as before.
    let (original_ancestry_digest, original_evidence_digest, original_evidence_json): (
        String,
        String,
        String,
    ) =
        sqlx::query_as(
            "SELECT source_ancestry_evidence_digest, artifact_evidence_digest, artifact_evidence_json::text
           FROM public.rd_research_request_receipts_v1
          WHERE request_identity=$1 AND source_ancestry_evidence_digest IS NOT NULL
            AND artifact_evidence_digest IS NOT NULL AND artifact_evidence_json IS NOT NULL",
        )
        .bind(&locator)
        .fetch_one(&rd_pool)
        .await
        .expect("the authored Research carries its ancestry and artifact evidence");
    let research_tampers = [
        (
            "source_ancestry_evidence_digest",
            "UPDATE public.rd_research_request_receipts_v1
                SET source_ancestry_evidence_digest='sha256:'||encode(sha256('stored-tamper'::bytea),'hex')
              WHERE request_identity=$1",
            "UPDATE public.rd_research_request_receipts_v1 SET source_ancestry_evidence_digest=$2
              WHERE request_identity=$1",
            &original_ancestry_digest,
        ),
        (
            "artifact_evidence_digest",
            "UPDATE public.rd_research_request_receipts_v1
                SET artifact_evidence_digest=artifact_evidence_digest||'-stored-tamper'
              WHERE request_identity=$1",
            "UPDATE public.rd_research_request_receipts_v1 SET artifact_evidence_digest=$2
              WHERE request_identity=$1",
            &original_evidence_digest,
        ),
        (
            "artifact_evidence_json",
            "UPDATE public.rd_research_request_receipts_v1
                SET artifact_evidence_json=artifact_evidence_json||'{\"stored_tamper\":true}'::jsonb
              WHERE request_identity=$1",
            "UPDATE public.rd_research_request_receipts_v1 SET artifact_evidence_json=$2::jsonb
              WHERE request_identity=$1",
            &original_evidence_json,
        ),
    ];

    for (column, tamper, restore, original) in research_tampers {
        let tampered = sqlx::query(tamper)
            .bind(&locator)
            .execute(&rd_pool)
            .await
            .unwrap_or_else(|e| panic!("change {column}: {e}"))
            .rows_affected();
        assert_eq!(
            tampered, 1,
            "changing {column} must touch exactly the authored Research"
        );
        let refused = Box::pin(composer.run_bounded_feature_program(&locator)).await;
        eprintln!("stored tamper {column}: {refused:?}");
        assert!(
            !matches!(
                &refused,
                Ok(response) if response.disposition == DevelopComposerOperationDispositionV2::Success
            ),
            "the production Composer composed over a changed {column}: {refused:?}",
        );
        let restored = sqlx::query(restore)
            .bind(&locator)
            .bind(original)
            .execute(&rd_pool)
            .await
            .unwrap_or_else(|e| panic!("restore {column}: {e}"))
            .rows_affected();
        assert_eq!(
            restored, 1,
            "restoring {column} must touch exactly the authored Research"
        );
    }

    let response = Box::pin(composer.run_bounded_feature_program(&locator))
        .await
        .expect("the R&D transaction completes");
    assert_eq!(
        response.disposition,
        DevelopComposerOperationDispositionV2::Success,
        "the authored frozen program must compose to an Artifact: {:?} at {:?}",
        response.reason,
        response.coordinate,
    );

    let artifact = response
        .artifact
        .as_ref()
        .expect("a successful Composer operation carries its Artifact");
    assert_eq!(
        artifact.design_digest.as_bytes().as_slice(),
        stored_design_digest.as_slice(),
        "the Artifact must be built from the authored Design this entry selected",
    );
    // A disposition and an Artifact projection are what the call returned; a receipt is what
    // it committed. Without this the entry would accept a Success that wrote nothing.
    assert!(
        response.receipt_identity.is_some(),
        "a successful Composer operation must carry the receipt it committed",
    );

    // Replaying the same locator must resolve the operation already committed rather than
    // build a second Artifact for one frozen meaning. This is also what distinguishes a
    // durable commit from a call that merely answered: a response that can be resolved again,
    // identically, came from storage.
    let replay = Box::pin(composer.run_bounded_feature_program(&locator))
        .await
        .expect("the replay transaction completes");
    assert_eq!(
        replay, response,
        "replaying one frozen meaning must resolve the committed operation, not compose again",
    );
}

/// F: the first COMPOSER_V3 Replay, committed through the production routes from a V3 Research
/// request to an execution input binding that reads back (the prefix), then run through the
/// production execution route and stated by the report (the body).
///
/// One entry, because the body runs what the prefix just committed. Joining it from a second
/// entry would have to replay the prefix's admissions, and those take Market Data's clock
/// head, which has moved: the replayed Instrument Master fact is no successor and is refused.
/// The steps are in `first_composer_v3_replay_acceptance` and
/// `first_composer_v3_replay_body_acceptance`.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[rstest]
#[ignore = "requires the ordered chain's PostgreSQL, entry 6's Market Data fixture and the pinned local wasm compiler"]
fn the_first_composer_v3_replay_runs_as_its_one_member_universe_and_is_reported() {
    // Accepting a request, issuing its PIT request and composing run the Owners' deepest
    // custody paths; together they overflow the default test stack, as the other V3 entries do.
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(|| {
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .unwrap()
                .block_on(Box::pin(async {
                    let test_database =
                        CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
                    let replay = Box::pin(
                        crate::first_composer_v3_replay_acceptance::ensure_first_composer_v3_replay_acceptance_v1(
                            &test_database,
                            crate::first_composer_v3_replay_acceptance::FIRST_COMPOSER_V3_REPLAY_FIXTURE_KEY_V1,
                        ),
                    )
                    .await;
                    assert!(
                        replay.created,
                        "F runs on a fresh chain database, so it must be the call that created \
                         the first COMPOSER_V3 Replay rather than one that joined it",
                    );
                    Box::pin(
                        crate::first_composer_v3_replay_body_acceptance::assert_the_first_composer_v3_replay_runs_as_its_universe_v1(
                            &test_database,
                            &replay,
                        ),
                    )
                    .await;
                }));
        })
        .unwrap()
        .join()
        .unwrap();
}

/// `backtest.run`'s own chain proof, distinct from F: a fresh catalog strategy, run through
/// the production orchestration (a new Research goal, its initial PIT request, authoring,
/// role binding and freeze), driven up to the exact point the replay step cannot proceed -
/// nothing on `main` implements Market Data's T0-5 derived view yet. See
/// `backtest_run_v1`'s and `backtest_run_chain_entry_acceptance`'s module docs.
///
/// Follows F because it reuses the perpetual F admits (its Source Binding, Instrument Master
/// fact and historical membership); F is the chain's only producer of that fixture.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[rstest]
#[ignore = "requires the ordered chain's PostgreSQL, after F admits the perpetual"]
fn backtest_run_reaches_the_replay_step_over_a_catalogued_strategy() {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(|| {
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .unwrap()
                .block_on(Box::pin(async {
                    let test_database =
                        CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
                    Box::pin(
                        crate::backtest_run_chain_entry_acceptance::assert_backtest_run_reaches_the_replay_step_v1(
                            &test_database,
                        ),
                    )
                    .await;
                }));
        })
        .unwrap()
        .join()
        .unwrap();
}

/// `list_instruments` and `describe_instrument` answer over HTTP from the facts Market Data
/// holds: the perpetual F admitted is listed, its tick size and lot step are its `exchangeInfo`
/// entry's own, its economic terms are the ones F's H0 admitted, and an instrument Market Data
/// never admitted is refused by name.
///
/// It follows F because F is the chain's only producer of an Instrument Master V2 fact with
/// terms. It reads Market Data and the Instrument Owner only, starts no Research and writes
/// nothing, so the state F leaves behind cannot affect it.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[rstest]
#[ignore = "requires the ordered chain's PostgreSQL after F, which admits the perpetual and its terms"]
#[tokio::test]
async fn an_admitted_perpetual_is_listed_and_described_over_http() {
    use tower::ServiceExt as _;

    let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
    composed_market_data_binding_admission(&test_database).await;
    let token = "rd-owner-api-instrument-catalog";
    let catalog = bootstrap_market_data_instrument_catalog().await.unwrap();
    assert!(
        catalog.is_some(),
        "the chain configures both stores the catalog reads"
    );
    let routes = market_data_pit::router(
        market_data_pit::MarketDataAdmissions {
            intake: None,
            admission: None,
            universe: None,
            bindings: None,
            instruments: None,
            instruments_v2: None,
            semantics: None,
            economic_terms: None,
            catalog,
            binance_perpetual_admission: None,
        },
        Sha256::digest(token.as_bytes()).into(),
    );
    let get = |path: String, authorization: Option<String>| {
        let routes = routes.clone();
        async move {
            let mut request = axum::extract::Request::builder().method("GET").uri(path);
            if let Some(authorization) = authorization {
                request = request.header(axum::http::header::AUTHORIZATION, authorization);
            }
            let response = routes
                .oneshot(request.body(axum::body::Body::empty()).unwrap())
                .await
                .unwrap();
            let status = response.status();
            let code = response
                .headers()
                .get("x-rd-rejection-code")
                .map(|value| value.to_str().unwrap().to_owned());
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            (
                status,
                code,
                serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
            )
        }
    };
    let bearer = Some(format!("Bearer {token}"));
    let perpetual = crate::first_composer_v3_replay_acceptance::PERPETUAL_V1;

    let (status, _, listed) = get("/v1/market-data/instruments".to_owned(), bearer.clone()).await;
    assert_eq!(status, StatusCode::OK, "{listed}");
    let listing = listed["instruments"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["instrument"] == perpetual)
        .unwrap_or_else(|| panic!("the perpetual F admitted is listed: {listed}"));
    assert_eq!(listing["venue"], "BINANCE", "{listing}");

    let (status, _, described) = get(
        format!("/v1/market-data/instruments/{perpetual}"),
        bearer.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{described}");
    let entry: serde_json::Value = serde_json::from_str(
        crate::first_composer_v3_replay_acceptance::PERPETUAL_EXCHANGE_INFO_V1,
    )
    .unwrap();
    let filter = |filter_type: &str, field: &str| {
        let text = entry["symbols"][0]["filters"]
            .as_array()
            .unwrap()
            .iter()
            .find(|filter| filter["filterType"] == filter_type)
            .and_then(|filter| filter[field].as_str())
            .unwrap()
            .to_owned();
        if text.contains('.') {
            text.trim_end_matches('0').trim_end_matches('.').to_owned()
        } else {
            text
        }
    };
    assert_eq!(
        described["price_increment"],
        filter("PRICE_FILTER", "tickSize")
    );
    assert_eq!(
        described["quantity_increment"],
        filter("LOT_SIZE", "stepSize")
    );
    let terms = described["economic_terms"].as_array().unwrap();
    assert!(
        !terms.is_empty(),
        "F's H0 admitted the perpetual's terms: {described}"
    );
    assert!(
        terms.iter().all(|version| version["taker_fee"]
            .as_str()
            .is_some_and(|fee| !fee.is_empty())),
        "{described}"
    );

    let (status, code, _) = get(
        "/v1/market-data/instruments/NEVERADMITTED-PERP.BINANCE".to_owned(),
        bearer,
    )
    .await;
    assert_eq!(
        (status, code.as_deref()),
        (StatusCode::NOT_FOUND, Some("INSTRUMENT_UNKNOWN"))
    );
    let (status, code, _) = get("/v1/market-data/instruments".to_owned(), None).await;
    assert_eq!(
        (status, code.as_deref()),
        (StatusCode::FORBIDDEN, Some("UNAUTHORIZED_PRODUCT_EDGE"))
    );
}

pub(super) fn bearer_headers(token: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::AUTHORIZATION,
        format!("Bearer {token}").parse().unwrap(),
    );
    headers
}

pub(super) async fn response_json(response: Response) -> serde_json::Value {
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&body).unwrap()
}

fn assert_exact_start_custody(
    response: &serde_json::Value,
    build_request_identity: &str,
    attempt_identity: &str,
) {
    assert_eq!(
        response["execution_custody"]["request"]["build_request_identity"],
        build_request_identity
    );
    assert_eq!(
        response["execution_custody"]["request"]["attempt_identity"],
        attempt_identity
    );
    assert_eq!(
        response["execution_custody"]["claim_identity"],
        response["invocation_start"]["claim_identity"]
    );
    assert_eq!(
        response["execution_custody"]["claim_digest"],
        response["invocation_start"]["claim_digest"]
    );

    for field in [
        "reservation_identity",
        "reservation_digest",
        "execution_custody_digest",
        "canonical_intent_bytes",
        "trial_family_identity",
        "census_frontier_identity",
    ] {
        assert!(
            response["execution_custody"][field]
                .as_str()
                .is_some_and(|value| !value.is_empty())
        );
    }
}

#[tokio::test]
async fn receiptless_v2_rejections_require_same_identity_resolution() {
    for (status, code) in [
        (StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE"),
        (StatusCode::BAD_REQUEST, "MALFORMED_TYPED_REQUEST"),
        (StatusCode::SERVICE_UNAVAILABLE, "OWNER_UNAVAILABLE"),
    ] {
        let response = rejection_v2(status, code, "request-v2");
        assert_eq!(response.status(), status);
        assert_eq!(response.headers().get("x-rd-rejection-code").unwrap(), code);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["resolution"], "SUBMITTED_OR_UNKNOWN");
        assert_eq!(value["request_identity"], "request-v2");
        assert_eq!(value["owner_receipt"], serde_json::Value::Null);
        assert_eq!(value["next_legal_action"], "RESOLVE_SAME_REQUEST_IDENTITY");
    }
}

#[tokio::test]
async fn product_edge_unavailable_projects_same_attempt_resolution() {
    let response = artifact_product_edge_error(
        &ProductEdgeError::unavailable(vibe_product_edge::ProductEdgeUnavailableReasonV1::Missing),
        "build-1",
        "attempt-1",
    );
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        response.headers().get("x-rd-rejection-code").unwrap(),
        "OWNER_OUTCOME_UNKNOWN"
    );
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(value["resolution"], "SUBMITTED_OR_UNKNOWN");
    assert_eq!(value["build_request_identity"], "build-1");
    assert_eq!(value["attempt_identity"], "attempt-1");
    assert_eq!(value["next_legal_action"], "RESOLVE_SAME_ATTEMPT_IDENTITY");
}

#[tokio::test]
async fn missing_artifact_admission_is_truthful_same_attempt_unknown() {
    let response = artifact_unknown(
        StatusCode::SERVICE_UNAVAILABLE,
        "OWNER_OUTCOME_UNKNOWN",
        "build-1",
        "attempt-1",
    );
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        response.headers().get("x-rd-rejection-code").unwrap(),
        "OWNER_OUTCOME_UNKNOWN"
    );
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(value["resolution"], "SUBMITTED_OR_UNKNOWN");
    assert_eq!(value["build_request_identity"], "build-1");
    assert_eq!(value["attempt_identity"], "attempt-1");
    assert_eq!(value["owner_receipt"], serde_json::Value::Null);
    assert_eq!(value["next_legal_action"], "RESOLVE_SAME_ATTEMPT_IDENTITY");
}

#[cfg(feature = "composer-replay-issuance")]
#[rstest]
#[case::invalid_request(
    ReplayCompositionBindingErrorV1::InvalidRequest,
    StatusCode::BAD_REQUEST,
    None
)]
#[case::issuance_identity_conflict(
    ReplayCompositionBindingErrorV1::IssuanceIdentityConflict,
    StatusCode::CONFLICT,
    Some("CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY")
)]
#[case::price_adjustment_unknown(
    ReplayCompositionBindingErrorV1::PriceAdjustmentUnknown,
    StatusCode::UNPROCESSABLE_ENTITY,
    None
)]
#[case::execution_role_ambiguous(
    ReplayCompositionBindingErrorV1::ExecutionRoleAmbiguous,
    StatusCode::UNPROCESSABLE_ENTITY,
    Some("EXECUTION_ROLE_AMBIGUOUS")
)]
#[case::execution_timeframe_not_declared(
    ReplayCompositionBindingErrorV1::ExecutionTimeframeNotDeclared,
    StatusCode::UNPROCESSABLE_ENTITY,
    Some("EXECUTION_TIMEFRAME_NOT_DECLARED")
)]
#[case::execution_bar_exceeds_r0_window(
    ReplayCompositionBindingErrorV1::ExecutionBarExceedsR0Window,
    StatusCode::UNPROCESSABLE_ENTITY,
    Some("EXECUTION_BAR_EXCEEDS_R0_WINDOW")
)]
#[case::session_outside_replay_window(
    ReplayCompositionBindingErrorV1::SessionOutsideReplayWindow,
    StatusCode::UNPROCESSABLE_ENTITY,
    Some("SESSION_OUTSIDE_REPLAY_WINDOW")
)]
#[case::replay_v2_unavailable(
    ReplayCompositionBindingErrorV1::ReplayV2Unavailable,
    StatusCode::SERVICE_UNAVAILABLE,
    None
)]
#[case::digest_mismatch(
    ReplayCompositionBindingErrorV1::DigestMismatch,
    StatusCode::SERVICE_UNAVAILABLE,
    None
)]
#[case::unknown_binding(
    ReplayCompositionBindingErrorV1::UnknownBinding,
    StatusCode::SERVICE_UNAVAILABLE,
    None
)]
#[case::non_canonical_order(
    ReplayCompositionBindingErrorV1::NonCanonicalOrder,
    StatusCode::SERVICE_UNAVAILABLE,
    None
)]
#[case::incomplete_composition(
    ReplayCompositionBindingErrorV1::IncompleteComposition,
    StatusCode::SERVICE_UNAVAILABLE,
    None
)]
#[case::dependency_mismatch(
    ReplayCompositionBindingErrorV1::DependencyMismatch,
    StatusCode::SERVICE_UNAVAILABLE,
    None
)]
#[case::ambiguous_binding(
    ReplayCompositionBindingErrorV1::AmbiguousBinding,
    StatusCode::SERVICE_UNAVAILABLE,
    None
)]
#[case::legacy_unbound(
    ReplayCompositionBindingErrorV1::LegacyUnbound,
    StatusCode::SERVICE_UNAVAILABLE,
    None
)]
fn replay_composition_refusal_follows_the_cause(
    #[case] error: ReplayCompositionBindingErrorV1,
    #[case] status: StatusCode,
    #[case] code: Option<&str>,
) {
    let response = replay_composition_refusal(error);
    assert_eq!(response.status(), status);
    assert_eq!(
        response
            .headers()
            .get("x-rd-rejection-code")
            .map(|value| value.to_str().expect("rejection code is ASCII")),
        code
    );
}

struct FailingResearchReadbackOwner(&'static str);

#[async_trait]
impl ResearchReadbackOwnerPortV1 for FailingResearchReadbackOwner {
    async fn read_research_v2(
        &self,
        _request_identity: &str,
    ) -> Result<ResearchGoalOwnerResultV2, ResearchGoalOwnerError> {
        Err(ResearchGoalOwnerError::Storage(self.0.to_string()))
    }
}

/// The 503 is unchanged and says nothing, so the log is the only place the store's own error
/// survives. The capture subscriber is thread-local, so the future runs on this thread.
#[rstest]
fn research_readback_store_failure_keeps_its_503_and_logs_the_cause() {
    let owner = FailingResearchReadbackOwner("readback store down");
    let (response, written) = crate::log_capture::capture(|| {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("current-thread runtime")
            .block_on(read_research_v2_through(
                &owner,
                "research-request-readback",
            ))
    });

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert!(
        written.contains("Research readback unavailable"),
        "{written}"
    );
    assert!(written.contains("readback store down"), "{written}");
    assert!(written.contains("research-request-readback"), "{written}");
}

struct MockArtifactBuildOwner {
    preflight: Result<ArtifactRequestIdentityPreflightV1, String>,
    preflight_calls: AtomicUsize,
}

#[async_trait]
impl ArtifactBuildOwnerPort for MockArtifactBuildOwner {
    async fn preflight_request_identity(
        &self,
        _build_request_identity: &str,
        _attempt_identity: &str,
    ) -> Result<ArtifactRequestIdentityPreflightV1, ArtifactBuildError> {
        self.preflight_calls.fetch_add(1, Ordering::SeqCst);
        self.preflight.clone().map_err(ArtifactBuildError::Storage)
    }

    async fn prepare(
        &self,
        _request: ArtifactBuildRequestV1,
    ) -> Result<ArtifactBuildPreparationV1, ArtifactBuildError> {
        panic!("preflight test must not prepare")
    }

    async fn reserve_provider_invocation_custody(
        &self,
        _build_request_identity: &str,
        _attempt_identity: &str,
        _claim: ProductEdgeInvocationClaimReadbackV1,
    ) -> Result<ReservedArtifactBuildInvocationV1, ArtifactBuildError> {
        panic!("preflight test must not resolve invocation custody")
    }

    async fn submit_candidate(
        &self,
        _request: ArtifactBuildRequestV1,
        _candidate: ArtifactBuildCandidateV1,
        _invocation: Option<&ProductEdgeInvocationClaimReadbackV1>,
    ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
        panic!("preflight test must not submit a candidate")
    }

    async fn fail_no_artifact(
        &self,
        _request: ArtifactBuildRequestV1,
        _failure_code: &str,
        _invocation: Option<&ProductEdgeInvocationClaimReadbackV1>,
    ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
        panic!("preflight test must not terminalize")
    }

    async fn resolve(
        &self,
        _build_request_identity: &str,
        _attempt_identity: &str,
        _admission: &vibe_product_edge::ProductEdgeAdmissionLocatorV1,
    ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
        panic!("preflight test must not resolve")
    }

    async fn resolve_legacy_terminal_quarantined(
        &self,
        _build_request_identity: &str,
        _attempt_identity: &str,
    ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
        panic!("preflight test must not resolve legacy custody")
    }
}

#[tokio::test]
async fn legacy_collision_stops_before_product_edge_admission_through_owner_port() {
    let concrete = Arc::new(MockArtifactBuildOwner {
        preflight: Ok(ArtifactRequestIdentityPreflightV1::LegacyTerminalQuarantined),
        preflight_calls: AtomicUsize::new(0),
    });
    let artifact_owner: Arc<dyn ArtifactBuildOwnerPort> = concrete.clone();
    let product_edge_admission_calls = AtomicUsize::new(0);

    let result = preflight_then_admit_artifact_request(
        artifact_owner.as_ref(),
        "artifact-build-request-legacy",
        "artifact-build-attempt-legacy",
        || async {
            product_edge_admission_calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        },
    )
    .await;

    let Err((ProductEdgeError::Unavailable(detail), _, _)) = result else {
        panic!("a legacy collision must refuse as unavailable, was {result:?}");
    };
    assert_eq!(
        detail.reason(),
        &ProductEdgeUnavailableReasonV1::DownstreamCustodyMismatch
    );
    assert_eq!(concrete.preflight_calls.load(Ordering::SeqCst), 1);
    assert_eq!(product_edge_admission_calls.load(Ordering::SeqCst), 0);
}

/// The response is the same for both refusals, so the only thing that can be wrong is which
/// error reaches the log. A store failure must reach it as storage, carrying its own text.
#[tokio::test]
async fn artifact_preflight_store_failure_is_storage_not_a_custody_mismatch() {
    let concrete = Arc::new(MockArtifactBuildOwner {
        preflight: Err("preflight store down".to_string()),
        preflight_calls: AtomicUsize::new(0),
    });
    let artifact_owner: Arc<dyn ArtifactBuildOwnerPort> = concrete.clone();
    let product_edge_admission_calls = AtomicUsize::new(0);

    let result = preflight_then_admit_artifact_request(
        artifact_owner.as_ref(),
        "artifact-build-request-store",
        "artifact-build-attempt-store",
        || async {
            product_edge_admission_calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        },
    )
    .await;

    let Err((ProductEdgeError::Storage(detail), build_request_identity, attempt_identity)) = result
    else {
        panic!("a store failure must refuse as storage, was {result:?}");
    };
    assert!(detail.contains("preflight store down"), "{detail}");
    assert_eq!(build_request_identity, "artifact-build-request-store");
    assert_eq!(attempt_identity, "artifact-build-attempt-store");
    assert_eq!(concrete.preflight_calls.load(Ordering::SeqCst), 1);
    assert_eq!(product_edge_admission_calls.load(Ordering::SeqCst), 0);
}

#[rstest]
#[case::vacant(ResearchRequestIdentityPreflightV1::Vacant)]
#[case::current(ResearchRequestIdentityPreflightV1::Current)]
fn research_preflight_lets_a_vacant_or_current_identity_proceed(
    #[case] preflight: ResearchRequestIdentityPreflightV1,
) {
    assert!(research_preflight_refusal(Ok(preflight), "research-request").is_none());
}

#[tokio::test]
async fn research_preflight_keeps_the_legacy_quarantine_answer() {
    let response = research_preflight_refusal(
        Ok(ResearchRequestIdentityPreflightV1::LegacyQuarantined),
        "research-request-legacy",
    )
    .expect("a legacy-quarantined identity must be refused");

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert!(response.headers().get("x-rd-rejection-code").is_none());
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(value["resolution"], "SUBMITTED_OR_UNKNOWN");
    assert_eq!(value["next_legal_action"], "RESOLVE_SAME_REQUEST_IDENTITY");
    assert_eq!(value["request_identity"], "research-request-legacy");
}

#[rstest]
fn research_preflight_store_failure_is_owner_unavailable_and_logs_its_cause() {
    let (response, written) = crate::log_capture::capture(|| {
        research_preflight_refusal(
            Err(ResearchGoalOwnerError::Storage(
                "research preflight store down".to_string(),
            )),
            "research-request-store",
        )
    });
    let response = response.expect("a store failure must be refused");

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        response.headers().get("x-rd-rejection-code").unwrap(),
        "OWNER_UNAVAILABLE"
    );
    assert!(
        written.contains("research preflight store down"),
        "{written}"
    );
    assert!(written.contains("research-request-store"), "{written}");
}

/// This response carries no rejection code at all, so the log is the only place the cause survives.
#[rstest]
#[case::authority(
    ProductEdgeError::Unavailable(ProductEdgeUnavailableV1::about(
        ProductEdgeUnavailableReasonV1::Missing,
        ProductEdgeSubjectKindV1::Admission,
        "product-edge-authority",
    )),
    "product-edge-authority",
    "Product Edge authority unavailable"
)]
#[case::storage(
    ProductEdgeError::Storage("product-edge-storage".to_string()),
    "product-edge-storage",
    "Product Edge storage unavailable",
)]
fn an_unresolved_result_names_its_cause_in_the_log(
    #[case] error: ProductEdgeError,
    #[case] detail: &str,
    #[case] message: &str,
) {
    let (response, written) =
        crate::log_capture::capture(|| product_edge_error(&error, "request-1", false));

    assert_eq!(
        response.status(),
        StatusCode::SERVICE_UNAVAILABLE,
        "{written}"
    );
    assert!(written.contains("WARN"), "{written}");
    assert!(written.contains(detail), "{written}");
    assert!(written.contains(message), "{written}");
}

/// `OWNER_OUTCOME_UNKNOWN` is one code for both causes; the log is where they come apart.
#[rstest]
#[case::authority(
    ProductEdgeError::Unavailable(ProductEdgeUnavailableV1::about(
        ProductEdgeUnavailableReasonV1::Missing,
        ProductEdgeSubjectKindV1::Admission,
        "artifact-build-authority",
    )),
    "artifact-build-authority",
    "Product Edge authority unavailable"
)]
#[case::storage(
    ProductEdgeError::Storage("artifact-build-storage".to_string()),
    "artifact-build-storage",
    "Product Edge storage unavailable",
)]
fn an_unknown_artifact_outcome_names_its_cause_in_the_log(
    #[case] error: ProductEdgeError,
    #[case] detail: &str,
    #[case] message: &str,
) {
    let (response, written) =
        crate::log_capture::capture(|| artifact_product_edge_error(&error, "build-1", "attempt-1"));

    assert_eq!(
        response.status(),
        StatusCode::SERVICE_UNAVAILABLE,
        "{written}"
    );
    assert!(written.contains("WARN"), "{written}");
    assert!(written.contains(detail), "{written}");
    assert!(written.contains(message), "{written}");
}

use crate::required_env;

/// Positive control. Without it, every assertion below is satisfied by a `required_env` that
/// refuses everything, and the refusals would carry no information.
#[rstest]
fn a_variable_with_a_value_is_returned_unchanged() {
    let name = "VIBE_RD_OWNER_API_REQUIRED_ENV_PRESENT";
    unsafe { std::env::set_var(name, " spaced value ") };
    assert_eq!(required_env(name).unwrap(), " spaced value ");
    unsafe { std::env::remove_var(name) };
}

#[rstest]
fn an_absent_variable_is_refused_as_missing() {
    let name = "VIBE_RD_OWNER_API_REQUIRED_ENV_ABSENT";
    unsafe { std::env::remove_var(name) };
    let error = required_env(name).unwrap_err().to_string();
    assert!(error.contains("is missing"), "{error}");
}

/// The defect this function exists for: an empty token digests to a value a request can
/// present, so an empty variable must not reach a caller at all.
#[rstest]
fn an_empty_variable_is_refused_rather_than_returned() {
    let name = "VIBE_RD_OWNER_API_REQUIRED_ENV_EMPTY";
    unsafe { std::env::set_var(name, "") };
    let error = required_env(name).unwrap_err().to_string();
    assert!(error.contains("carries no value"), "{error}");
    unsafe { std::env::remove_var(name) };
}

#[rstest]
fn a_whitespace_only_variable_is_refused_rather_than_returned() {
    let name = "VIBE_RD_OWNER_API_REQUIRED_ENV_BLANK";
    unsafe { std::env::set_var(name, "   ") };
    let error = required_env(name).unwrap_err().to_string();
    assert!(error.contains("carries no value"), "{error}");
    unsafe { std::env::remove_var(name) };
}
