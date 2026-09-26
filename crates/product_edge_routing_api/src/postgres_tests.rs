//! The routing read port answered over HTTP from a real Product Edge store, with every binding
//! committed by the administrative writer the bootstrap binary calls.

use std::{
    net::SocketAddr,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::http::StatusCode;
use rstest::rstest;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};
use vibe_product_edge::{
    ProductEdgeError, ProductEdgeOperationDispatcherV1, ProductEdgeOperationRoutingBindingV1,
    ProductEdgeOperationRoutingKeyV1, ProductEdgeOperationRoutingObservationV1,
    ProductEdgeOperationRoutingProposalV1, ProductEdgePostgresOperationRoutingReadPortV1,
    deployment_acceptance::{
        DeploymentAcceptanceOperationV1, DeploymentAcceptanceProposalV1,
        ensure_product_edge_deployment_acceptance_fixture_v1,
    },
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

use crate::{
    OPERATION_ROUTING_ABSENT_V1, OPERATION_ROUTING_PATH_V1, OPERATION_ROUTING_QUERY_INVALID_V1,
    OPERATION_ROUTING_STALE_V1, OPERATION_ROUTING_UNAUTHORIZED_V1, RoutingApiStateV1, router,
};

const TOKEN: &str = "operation-routing-chain-token";
const RESEARCH_GOAL_V2: &str = "research_goal.submit_or_resolve.v2";
const ARTIFACT_BUILD_V1: &str = "artifact_build.submit_or_resolve.v1";
const CHANNEL: &str = "WINDMILL_PRODUCT_EDGE";

fn run_key() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("epoch")
        .as_nanos();
    format!("operation-routing-{nanos}")
}

async fn get(address: SocketAddr, token: &str, query: &str) -> (StatusCode, serde_json::Value) {
    let mut stream = TcpStream::connect(address).await.unwrap();
    let request = format!(
        "GET {OPERATION_ROUTING_PATH_V1}?{query} HTTP/1.1\r\nHost: {address}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
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
    (
        status,
        serde_json::from_slice(&response[header_end..]).expect("JSON body"),
    )
}

fn research_query() -> String {
    format!("operation={RESEARCH_GOAL_V2}&version=2&channel={CHANNEL}")
}

/// The ACTIVE body's binding, re-sealed from its content: what the Dashboard recomputes.
fn active_binding(body: &serde_json::Value) -> ProductEdgeOperationRoutingBindingV1 {
    assert_eq!(body["state"], "ACTIVE", "{body}");
    assert_eq!(
        body["history_head_identity"],
        body["binding"]["binding_identity"]
    );
    let binding: ProductEdgeOperationRoutingBindingV1 =
        serde_json::from_value(body["binding"].clone()).unwrap();
    binding.verify().unwrap();
    assert!(body["observed_at_epoch_ms"].as_u64().unwrap() >= binding.committed_at_epoch_ms);
    binding
}

/// What the Dashboard's own routing client makes of the live read port for the research key:
/// `product/dashboard/tests/product-edge-routing-live.mjs`, run with the Dashboard's environment
/// names. The client recomputes the binding's digest and identity from the served bytes.
async fn dashboard_observation(
    address: SocketAddr,
    deployment_identity: &str,
) -> serde_json::Value {
    let dashboard_root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../product/dashboard");
    let deployment_identity = deployment_identity.to_string();
    // A blocking child process, off the runtime that is serving the port it reads.
    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new("node")
            .arg("tests/product-edge-routing-live.mjs")
            .current_dir(&dashboard_root)
            .env(
                "PRODUCT_EDGE_ROUTING_READ_API_URL",
                format!("http://{address}/"),
            )
            .env("PRODUCT_EDGE_ROUTING_READ_API_TOKEN", TOKEN)
            .env("PRODUCT_EDGE_DEPLOYMENT_IDENTITY", deployment_identity)
            .env("PRODUCT_EDGE_ROUTING_LIVE_OPERATION", RESEARCH_GOAL_V2)
            .env("PRODUCT_EDGE_ROUTING_LIVE_VERSION", "2")
            .env("PRODUCT_EDGE_ROUTING_LIVE_CHANNEL", CHANNEL)
            .output()
    })
    .await
    .unwrap()
    .expect("node runs the Dashboard routing client");
    assert!(
        output.status.success(),
        "the Dashboard routing client exited {}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("one JSON observation")
}

fn dashboard_active(binding: &ProductEdgeOperationRoutingBindingV1) -> serde_json::Value {
    serde_json::json!({
        "state": "ACTIVE",
        "dispatcher": binding.dispatcher,
        "binding_identity": binding.binding_identity,
        "binding_digest": binding.binding_digest,
        "generation": binding.generation,
        "history_head_identity": binding.binding_identity,
    })
}

/// One deployment's routing history for the research goal key, driven through every transition
/// the administrative writer commits and every answer the read port gives, over HTTP.
///
/// The chain database is never reset, so each run creates a deployment of its own. The run ends
/// on an `ACTIVE` answer: a read port that refused everything would fail here, not pass.
#[rstest]
#[tokio::test]
#[ignore = "requires the disposable canonical OA/PE PostgreSQL topology"]
async fn the_operation_routing_read_port_answers_every_routing_state_over_http() {
    let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
    let oa_url = test_database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter);
    let pe_url = test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner);
    let pe_pool = &sqlx::PgPool::connect(pe_url).await.unwrap();
    let operation = |operation: &str, schema: &str, effect: &str| DeploymentAcceptanceOperationV1 {
        operation: operation.into(),
        operation_schema: schema.into(),
        allowed_effects: vec![effect.into()],
    };
    let deployment = ensure_product_edge_deployment_acceptance_fixture_v1(
        oa_url,
        pe_url,
        &DeploymentAcceptanceProposalV1 {
            fixture_key: run_key(),
            audience: "R_AND_D".into(),
            permissions: vec!["research:submit".into()],
            operations: vec![
                operation(
                    RESEARCH_GOAL_V2,
                    "sourced-research-goal-v2",
                    "R_AND_D_RESEARCH_MUTATION_V1",
                ),
                operation(
                    ARTIFACT_BUILD_V1,
                    "rd-artifact-build-request-v1",
                    "R_AND_D_ARTIFACT_BUILD_MUTATION_V1",
                ),
            ],
        },
    )
    .await
    .unwrap();
    let research_manifest = deployment
        .operation(RESEARCH_GOAL_V2)
        .unwrap()
        .manifest
        .manifest_identity
        .clone();
    let artifact_manifest = deployment
        .operation(ARTIFACT_BUILD_V1)
        .unwrap()
        .manifest
        .manifest_identity
        .clone();
    let key = ProductEdgeOperationRoutingKeyV1 {
        deployment_identity: deployment.deployment_identity.clone(),
        operation: RESEARCH_GOAL_V2.into(),
        version: 2,
        channel: CHANNEL.into(),
    };
    let writer = deployment.connect_owner(pe_url).await.unwrap();
    let rows = || async {
        sqlx::query_scalar::<_, i64>(
            "SELECT (SELECT COUNT(*) FROM product_edge_operation_routing_bindings_v1 WHERE deployment_identity = $1) + (SELECT COUNT(*) FROM product_edge_operation_routing_heads_v1 WHERE deployment_identity = $1)",
        )
        .bind(&deployment.deployment_identity)
        .fetch_one(pe_pool)
        .await
        .unwrap()
    };

    let port = ProductEdgePostgresOperationRoutingReadPortV1::connect(
        pe_url,
        deployment.deployment_identity.clone(),
    )
    .await
    .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();

    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            router(RoutingApiStateV1::new(Arc::new(port), TOKEN)),
        )
        .await
        .unwrap();
    });

    // No history: a named refusal, and a query or token that names nothing reads nothing.
    let (status, body) = get(address, TOKEN, &research_query()).await;
    assert_eq!(
        (status, &body["refusal"]),
        (StatusCode::NOT_FOUND, &OPERATION_ROUTING_ABSENT_V1.into())
    );
    let (status, body) = get(address, "not-the-token", &research_query()).await;
    assert_eq!(
        (status, &body["refusal"]),
        (
            StatusCode::UNAUTHORIZED,
            &OPERATION_ROUTING_UNAUTHORIZED_V1.into()
        )
    );
    let (status, body) = get(
        address,
        TOKEN,
        &format!("operation={RESEARCH_GOAL_V2}&version=3&channel={CHANNEL}"),
    )
    .await;
    assert_eq!(
        (status, &body["refusal"]),
        (
            StatusCode::BAD_REQUEST,
            &OPERATION_ROUTING_QUERY_INVALID_V1.into()
        )
    );

    // The writer routes only a manifest the current deployment binding admits for the key's
    // operation, and a refused change writes nothing.
    for manifest_identity in [
        artifact_manifest.clone(),
        "manifest-never-admitted".to_string(),
    ] {
        assert!(matches!(
            writer
                .commit_operation_routing(ProductEdgeOperationRoutingProposalV1::Genesis {
                    key: key.clone(),
                    dispatcher: ProductEdgeOperationDispatcherV1::TradeDashboard,
                    manifest_identity,
                })
                .await,
            Err(ProductEdgeError::InvalidProposal(_) | ProductEdgeError::Unavailable(_))
        ));
    }
    assert_eq!(rows().await, 0);

    // Genesis: ACTIVE, answered with the exact committed binding under the current deployment
    // binding. A second genesis for the key is refused.
    let ProductEdgeOperationRoutingObservationV1::Active {
        binding: genesis, ..
    } = writer
        .commit_operation_routing(ProductEdgeOperationRoutingProposalV1::Genesis {
            key: key.clone(),
            dispatcher: ProductEdgeOperationDispatcherV1::TradeDashboard,
            manifest_identity: research_manifest.clone(),
        })
        .await
        .unwrap()
    else {
        panic!("genesis commits an ACTIVE binding");
    };
    assert_eq!(genesis.generation, 1);
    assert_eq!(
        genesis.deployment_binding_identity,
        deployment.binding_identity
    );
    let (status, body) = get(address, TOKEN, &research_query()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(active_binding(&body), genesis);
    assert_eq!(
        dashboard_observation(address, &deployment.deployment_identity).await,
        dashboard_active(&genesis)
    );
    assert!(matches!(
        writer
            .commit_operation_routing(ProductEdgeOperationRoutingProposalV1::Genesis {
                key: key.clone(),
                dispatcher: ProductEdgeOperationDispatcherV1::TradeDashboard,
                manifest_identity: research_manifest.clone(),
            })
            .await,
        Err(ProductEdgeError::ConflictingReplay)
    ));

    // The read takes no row lock: it answers while a writer holds the head row.
    let mut locking_writer = pe_pool.begin().await.unwrap();
    sqlx::query("SELECT 1 FROM product_edge_operation_routing_heads_v1 WHERE deployment_identity = $1 FOR UPDATE")
        .bind(&deployment.deployment_identity)
        .execute(&mut *locking_writer)
        .await
        .unwrap();
    let (status, _) = tokio::time::timeout(
        Duration::from_secs(5),
        get(address, TOKEN, &research_query()),
    )
    .await
    .expect("the read port waited on a writer's row lock");
    assert_eq!(status, StatusCode::OK);
    locking_writer.rollback().await.unwrap();

    // A deployment cutover leaves the head naming a binding that is no longer ACTIVE: stale,
    // until a successor is committed under the new deployment binding.
    let successor_deployment = deployment.activate_successor(pe_url).await.unwrap();
    let (status, body) = get(address, TOKEN, &research_query()).await;
    assert_eq!(
        (status, &body["refusal"]),
        (StatusCode::CONFLICT, &OPERATION_ROUTING_STALE_V1.into())
    );
    assert_eq!(
        dashboard_observation(address, &deployment.deployment_identity).await["state"],
        "UNAVAILABLE"
    );
    assert!(matches!(
        writer
            .commit_operation_routing(ProductEdgeOperationRoutingProposalV1::Successor {
                key: key.clone(),
                expected_head_identity: "not-the-head".into(),
                dispatcher: ProductEdgeOperationDispatcherV1::TradeDashboard,
                manifest_identity: research_manifest.clone(),
            })
            .await,
        Err(ProductEdgeError::ConflictingReplay)
    ));
    let ProductEdgeOperationRoutingObservationV1::Active {
        binding: second, ..
    } = writer
        .commit_operation_routing(ProductEdgeOperationRoutingProposalV1::Successor {
            key: key.clone(),
            expected_head_identity: genesis.binding_identity.clone(),
            dispatcher: ProductEdgeOperationDispatcherV1::TradeDashboard,
            manifest_identity: research_manifest.clone(),
        })
        .await
        .unwrap()
    else {
        panic!("a successor commits an ACTIVE binding");
    };
    assert_eq!(second.generation, 2);
    assert_eq!(
        second.predecessor_binding_identity.as_deref(),
        Some(genesis.binding_identity.as_str())
    );
    assert_eq!(
        second.deployment_binding_identity,
        successor_deployment.binding_identity
    );
    let (status, body) = get(address, TOKEN, &research_query()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(active_binding(&body), second);

    // Withdrawal: zero ACTIVE, answered with the key, generation and head; it cannot repeat.
    let withdrawn = writer
        .commit_operation_routing(ProductEdgeOperationRoutingProposalV1::Withdraw {
            key: key.clone(),
            expected_head_identity: second.binding_identity.clone(),
        })
        .await
        .unwrap();
    assert!(matches!(
        withdrawn,
        ProductEdgeOperationRoutingObservationV1::ZeroActive { .. }
    ));
    let (status, body) = get(address, TOKEN, &research_query()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["state"], "ZERO_ACTIVE");
    assert_eq!(body["generation"], 2);
    assert_eq!(
        body["history_head_identity"],
        second.binding_identity.as_str()
    );
    assert_eq!(body["key"], serde_json::to_value(&key).unwrap());
    let dashboard = dashboard_observation(address, &deployment.deployment_identity).await;
    assert_eq!(dashboard["state"], "ZERO_ACTIVE");
    assert_eq!(
        dashboard["history_head_identity"],
        second.binding_identity.as_str()
    );
    assert!(matches!(
        writer
            .commit_operation_routing(ProductEdgeOperationRoutingProposalV1::Withdraw {
                key: key.clone(),
                expected_head_identity: second.binding_identity.clone(),
            })
            .await,
        Err(ProductEdgeError::ConflictingReplay)
    ));

    // The next successor names the withdrawn head, and the key is ACTIVE again with the
    // dispatcher it names.
    let ProductEdgeOperationRoutingObservationV1::Active { binding: third, .. } = writer
        .commit_operation_routing(ProductEdgeOperationRoutingProposalV1::Successor {
            key: key.clone(),
            expected_head_identity: second.binding_identity.clone(),
            dispatcher: ProductEdgeOperationDispatcherV1::Windmill,
            manifest_identity: research_manifest,
        })
        .await
        .unwrap()
    else {
        panic!("a successor after withdrawal commits an ACTIVE binding");
    };
    assert_eq!(third.generation, 3);
    let (status, body) = get(address, TOKEN, &research_query()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(active_binding(&body), third);
    assert_eq!(body["binding"]["dispatcher"], "WINDMILL");
    assert_eq!(
        dashboard_observation(address, &deployment.deployment_identity).await,
        dashboard_active(&third)
    );

    // Another key of the same deployment has no history of its own.
    let (status, body) = get(
        address,
        TOKEN,
        &format!("operation={ARTIFACT_BUILD_V1}&version=1&channel={CHANNEL}"),
    )
    .await;
    assert_eq!(
        (status, &body["refusal"]),
        (StatusCode::NOT_FOUND, &OPERATION_ROUTING_ABSENT_V1.into())
    );
    assert_eq!(rows().await, 3 + 1);
    server.abort();
}
