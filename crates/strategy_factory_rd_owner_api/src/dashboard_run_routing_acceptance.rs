//! A Dashboard Source Research `RUN` admitted, or refused, by the routing Product Edge serves.
//!
//! Chain entry 107 proves the routing read port itself: every state over HTTP, and the Dashboard's
//! routing client parsing it. This entry proves what the Dashboard does with those answers when it
//! is asked to start a run. Every routing binding is committed by the production administrative
//! writer (`product-edge-authority-bootstrap route`, staged in the archive), the read port is the
//! production composition (`serve_on`), and the Dashboard is its own code - the route handler, the
//! default resolver, the RunStore and the effect worker - run by
//! `product/dashboard/tests/source-research-run-routing-live.mjs` against a RunStore database of
//! its own. The Owner is this crate's Source Intake and Source Intake Research routers, composed
//! as `main` composes them in this build.
//!
//! What is not live, and why:
//! - The compatibility envelope is the Dashboard's test fixture: no deployed service writes one.
//! - Source Intake is the sealed acceptance router the chain build compiles in place of the
//!   production one, which answers every request as unavailable.
//! - `main` serves Research resolve routes from its own composed state, which this entry does not
//!   build; a resolve the Dashboard sends after the Research submission is answered 404 here.

use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{extract::Request, middleware::Next, response::Response};
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use vibe_product_edge::{
    ProductEdgeOperationDispatcherV1, ProductEdgeOperationRoutingKeyV1,
    ProductEdgeOperationRoutingProposalV1, SOURCE_INTAKE_OPERATION_SCHEMA_V1,
    SOURCE_INTAKE_OPERATION_V1, SOURCE_INTAKE_REQUIRED_EFFECTS_V1,
    deployment_acceptance::{
        DeploymentAcceptanceOperationV1, DeploymentAcceptanceProposalV1,
        ProductEdgeDeploymentAcceptanceFixtureV1,
        ensure_product_edge_deployment_acceptance_fixture_v1,
    },
};
use vibe_product_edge_routing_api::{RoutingReadApiConfigV1, serve_on};
use vibe_strategy_factory::product_edge_postgres::PostgresResearchGoalOwnerV1;
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

const RESEARCH_GOAL_V3: &str = "research_goal.submit_or_resolve.v3";
const CHANNEL: &str = "WINDMILL_PRODUCT_EDGE";
const ROUTING_TOKEN: &str = "dashboard-run-routing-chain-token";
const OWNER_TOKEN: &str = "dashboard-run-routing-chain-owner-token";
const CURSOR_KEY: &str = "dashboard-run-routing-chain-cursor-key-of-32-bytes";

/// The provisioning binary the chain stages into the archive; `route` is the only writer.
fn provisioning_binary() -> PathBuf {
    PathBuf::from(
        std::env::var("PRODUCT_EDGE_AUTHORITY_BOOTSTRAP_BINARY")
            .expect("the chain names the staged product-edge-authority-bootstrap"),
    )
}

fn run_key() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("epoch")
        .as_nanos();
    format!("dashboard-run-routing-{nanos}")
}

/// Commits one routing change through `product-edge-authority-bootstrap route` and returns what it
/// printed: the read port's body for the key after the change.
async fn route(
    product_edge_url: &str,
    deployment: &ProductEdgeDeploymentAcceptanceFixtureV1,
    proposal: &ProductEdgeOperationRoutingProposalV1,
    directory: &Path,
) -> serde_json::Value {
    let path = directory.join(format!("{}.json", run_key()));
    std::fs::write(&path, serde_json::to_vec(proposal).unwrap()).unwrap();
    let trust = deployment.authorization_trust.clone();
    let product_edge_url = product_edge_url.to_string();
    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new(provisioning_binary())
            .arg("route")
            .arg(&path)
            .env("PRODUCT_EDGE_DATABASE_URL", product_edge_url)
            .env(
                "PRODUCT_EDGE_TRUSTED_ISSUER_IDENTITY",
                trust.issuer_identity,
            )
            .env(
                "PRODUCT_EDGE_TRUSTED_ISSUER_KEY_VERSION",
                trust.issuer_key_version,
            )
            .env(
                "PRODUCT_EDGE_TRUSTED_AUTHORIZATION_AUDIENCE",
                trust.audience,
            )
            .output()
    })
    .await
    .unwrap()
    .expect("the provisioning binary runs");
    assert!(
        output.status.success(),
        "route exited {}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("route prints one JSON body")
}

fn binding_identity(body: &serde_json::Value) -> String {
    body["binding"]["binding_identity"]
        .as_str()
        .or_else(|| body["history_head_identity"].as_str())
        .expect("a routing body names its head")
        .to_string()
}

/// Runs the Dashboard driver once and returns the JSON line it printed.
async fn dashboard(environment: Vec<(&'static str, String)>) -> serde_json::Value {
    let dashboard_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../product/dashboard");
    // A blocking child process, off the runtime that is serving the ports it calls.
    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new("node")
            .arg("tests/source-research-run-routing-live.mjs")
            .current_dir(&dashboard_root)
            .env(
                "DASHBOARD_DATABASE_URL",
                std::env::var("DASHBOARD_RUN_STORE_TEST_DATABASE_URL")
                    .expect("the chain names a Dashboard RunStore database of this entry's own"),
            )
            .env("DASHBOARD_CURSOR_HMAC_KEY", CURSOR_KEY)
            .envs(environment)
            .output()
    })
    .await
    .unwrap()
    .expect("node runs the Dashboard driver");
    assert!(
        output.status.success(),
        "the Dashboard driver exited {}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8(output.stdout).unwrap();
    // `migrate` prints one line per applied migration and nothing else.
    stdout
        .lines()
        .last()
        .and_then(|line| serde_json::from_str(line).ok())
        .unwrap_or(serde_json::Value::Null)
}

struct Ports {
    routing: SocketAddr,
    owner: SocketAddr,
    deployment_identity: String,
}

impl Ports {
    /// One RUN, with request identities of its own.
    async fn run(&self, cell: &str) -> (String, serde_json::Value) {
        let source_request = format!("{}-{cell}-source", run_key());
        let research_request = format!("{}-{cell}-research", run_key());
        let observed = dashboard(vec![
            ("DASHBOARD_ROUTING_RUN_MODE", "run".into()),
            (
                "PRODUCT_EDGE_ROUTING_READ_API_URL",
                format!("http://{}/", self.routing),
            ),
            ("PRODUCT_EDGE_ROUTING_READ_API_TOKEN", ROUTING_TOKEN.into()),
            (
                "PRODUCT_EDGE_DEPLOYMENT_IDENTITY",
                self.deployment_identity.clone(),
            ),
            ("RD_OWNER_API_URL", format!("http://{}", self.owner)),
            ("RD_OWNER_API_TOKEN", OWNER_TOKEN.into()),
            (
                "DASHBOARD_ROUTING_RUN_SOURCE_REQUEST_IDENTITY",
                source_request.clone(),
            ),
            (
                "DASHBOARD_ROUTING_RUN_RESEARCH_REQUEST_IDENTITY",
                research_request,
            ),
        ])
        .await;
        (source_request, observed)
    }
}

/// A refused RUN: the Dashboard names the refusal, carries the observation that caused it,
/// begins no run, and calls no Owner.
fn assert_refused(
    cell: &str,
    observed: &serde_json::Value,
    research_observation: &serde_json::Value,
    owner_requests: &Mutex<Vec<String>>,
) {
    assert_eq!(observed["response"]["status"], 503, "{cell}: {observed}");
    assert_eq!(
        observed["response"]["envelope"]["unavailable_reason"], "EXECUTION_ROUTING_UNAVAILABLE",
        "{cell}: {observed}"
    );
    assert_eq!(
        observed["admission"]["unavailable_reason"], "DASHBOARD_ROUTING_UNAVAILABLE",
        "{cell}: {observed}"
    );
    // Only the Research key changed: Source Intake stays ACTIVE for the Dashboard, so the refusal
    // is the Research key's and nothing else's.
    assert_eq!(
        (
            &observed["admission"]["routing"]["source"]["state"],
            &observed["admission"]["routing"]["source"]["dispatcher"],
        ),
        (&"ACTIVE".into(), &"TRADE_DASHBOARD".into()),
        "{cell}: {observed}"
    );

    for (field, expected) in research_observation.as_object().unwrap() {
        assert_eq!(
            &observed["admission"]["routing"]["research"][field], expected,
            "{cell}: {observed}"
        );
    }
    assert_eq!(observed["tick"]["state"], "idle", "{cell}: {observed}");
    assert!(observed["recovery"].is_null(), "{cell}: {observed}");
    assert_eq!(
        *owner_requests.lock().unwrap(),
        Vec::<String>::new(),
        "{cell}: a refused RUN called the Owner"
    );
}

/// One deployment's Source Intake and Research V3 routing, driven through every answer that must
/// refuse a fresh Dashboard RUN and then the one that admits it.
///
/// Only the Research key moves between cells; Source Intake stays `ACTIVE / TRADE_DASHBOARD`
/// throughout, re-committed after the deployment cutover that makes every key stale. The entry
/// ends on the admitted RUN reaching the Owner: an admission that refused everything fails there.
#[tokio::test]
#[ignore = "requires the canonical OA/PE PostgreSQL topology, the staged provisioning binary and a Dashboard RunStore database"]
#[allow(clippy::too_many_lines)]
async fn a_dashboard_run_starts_only_on_the_routing_the_writer_committed_and_reaches_the_owner() {
    let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
    let oa_url = test_database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter);
    let pe_url = test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner);
    let rd_url = test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner);
    let qualification_url =
        test_database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter);
    let proposals = std::env::temp_dir().join(run_key());
    std::fs::create_dir_all(&proposals).unwrap();

    let deployment = ensure_product_edge_deployment_acceptance_fixture_v1(
        oa_url,
        pe_url,
        &DeploymentAcceptanceProposalV1 {
            fixture_key: run_key(),
            audience: "R_AND_D".into(),
            permissions: vec!["research:submit".into()],
            operations: vec![
                DeploymentAcceptanceOperationV1 {
                    operation: SOURCE_INTAKE_OPERATION_V1.into(),
                    operation_schema: SOURCE_INTAKE_OPERATION_SCHEMA_V1.into(),
                    allowed_effects: SOURCE_INTAKE_REQUIRED_EFFECTS_V1
                        .iter()
                        .map(|effect| (*effect).to_string())
                        .collect(),
                },
                DeploymentAcceptanceOperationV1 {
                    operation: RESEARCH_GOAL_V3.into(),
                    operation_schema: "sourced-research-goal-v3".into(),
                    allowed_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".into()],
                },
            ],
        },
    )
    .await
    .unwrap();
    let manifest = |operation: &str| {
        deployment
            .operation(operation)
            .unwrap()
            .manifest
            .manifest_identity
            .clone()
    };
    let key = |operation: &str, version: u32| ProductEdgeOperationRoutingKeyV1 {
        deployment_identity: deployment.deployment_identity.clone(),
        operation: operation.into(),
        version,
        channel: CHANNEL.into(),
    };
    let source_key = key(SOURCE_INTAKE_OPERATION_V1, 1);
    let research_key = key(RESEARCH_GOAL_V3, 3);

    // The read port, composed exactly as the shipped binary composes it.
    let routing_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let routing_address = routing_listener.local_addr().unwrap();
    let routing_config = RoutingReadApiConfigV1::from_lookup(|name| match name {
        "PRODUCT_EDGE_DATABASE_URL" => Some(pe_url.to_string()),
        "PRODUCT_EDGE_DEPLOYMENT_IDENTITY" => Some(deployment.deployment_identity.clone()),
        "PRODUCT_EDGE_ROUTING_READ_API_TOKEN" => Some(ROUTING_TOKEN.to_string()),
        _ => None,
    })
    .unwrap();

    let routing_server = tokio::spawn(serve_on(routing_listener, routing_config));

    // The Owner: Source Intake and Source Intake Research as `main` composes them in this build,
    // with every request it receives recorded together with the status it was answered.
    let owner_requests = Arc::new(Mutex::new(Vec::<String>::new()));
    let recorded = owner_requests.clone();
    let product_edge = Arc::new(deployment.connect_owner(pe_url).await.unwrap());
    let token_digest: [u8; 32] = Sha256::digest(OWNER_TOKEN.as_bytes()).into();
    let research_owner = Arc::new(
        PostgresResearchGoalOwnerV1::connect(rd_url, qualification_url)
            .await
            .unwrap()
            .bind_sealed_source_intake_research_policy(),
    );
    let owner_app = crate::source_intake::sealed_acceptance_router(
        product_edge.clone(),
        rd_url,
        token_digest,
        deployment.request_proof_digest.clone(),
    )
    .await
    .unwrap()
    .merge(crate::source_intake_research::router(
        product_edge,
        research_owner,
        token_digest,
        deployment.request_proof_digest.clone(),
        false,
    ))
    .layer(axum::middleware::from_fn(
        move |request: Request, next: Next| {
            let recorded = recorded.clone();
            async move {
                let dispatcher = request
                    .headers()
                    .get("x-trade-effect-dispatcher")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or("-")
                    .to_string();
                let line = format!("{} {} {dispatcher}", request.method(), request.uri().path());
                let response: Response = next.run(request).await;
                recorded
                    .lock()
                    .unwrap()
                    .push(format!("{line} -> {}", response.status().as_u16()));
                response
            }
        },
    ));
    let owner_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let owner_address = owner_listener.local_addr().unwrap();
    let owner_server = tokio::spawn(async move {
        axum::serve(owner_listener, owner_app).await.unwrap();
    });
    let ports = Ports {
        routing: routing_address,
        owner: owner_address,
        deployment_identity: deployment.deployment_identity.clone(),
    };

    let migrated = dashboard(vec![("DASHBOARD_ROUTING_RUN_MODE", "migrate".into())]).await;
    assert!(migrated.is_null(), "migration printed JSON: {migrated}");

    let unavailable = serde_json::json!({
        "state": "UNAVAILABLE", "dispatcher": "NONE", "binding_identity": null, "generation": null,
    });

    // Source Intake routed to the Dashboard; the Research key has no history: ABSENT.
    let source_genesis = route(
        pe_url,
        &deployment,
        &ProductEdgeOperationRoutingProposalV1::Genesis {
            key: source_key.clone(),
            dispatcher: ProductEdgeOperationDispatcherV1::TradeDashboard,
            manifest_identity: manifest(SOURCE_INTAKE_OPERATION_V1),
        },
        &proposals,
    )
    .await;
    assert_eq!(source_genesis["state"], "ACTIVE", "{source_genesis}");
    let (_, observed) = ports.run("absent").await;
    assert_refused("ABSENT", &observed, &unavailable, &owner_requests);

    // The Research key routed to Windmill: ACTIVE, but not the Dashboard's to run.
    let windmill = route(
        pe_url,
        &deployment,
        &ProductEdgeOperationRoutingProposalV1::Genesis {
            key: research_key.clone(),
            dispatcher: ProductEdgeOperationDispatcherV1::Windmill,
            manifest_identity: manifest(RESEARCH_GOAL_V3),
        },
        &proposals,
    )
    .await;
    assert_eq!(windmill["binding"]["dispatcher"], "WINDMILL", "{windmill}");
    let (_, observed) = ports.run("windmill").await;
    assert_refused(
        "WINDMILL",
        &observed,
        &serde_json::json!({
            "state": "ACTIVE", "dispatcher": "WINDMILL",
            "binding_identity": binding_identity(&windmill),
            "generation": 1,
        }),
        &owner_requests,
    );

    // Withdrawn: zero ACTIVE.
    let withdrawn = route(
        pe_url,
        &deployment,
        &ProductEdgeOperationRoutingProposalV1::Withdraw {
            key: research_key.clone(),
            expected_head_identity: binding_identity(&windmill),
        },
        &proposals,
    )
    .await;
    assert_eq!(withdrawn["state"], "ZERO_ACTIVE", "{withdrawn}");
    let (_, observed) = ports.run("zero-active").await;
    assert_refused(
        "ZERO_ACTIVE",
        &observed,
        &serde_json::json!({
            "state": "ZERO_ACTIVE", "dispatcher": "NONE", "binding_identity": null, "generation": 1,
        }),
        &owner_requests,
    );

    // Routed to the Dashboard, then the deployment cuts over: every key's head is stale. Source
    // Intake is re-committed under the new deployment binding, so only the Research key is.
    let dashboard_research = route(
        pe_url,
        &deployment,
        &ProductEdgeOperationRoutingProposalV1::Successor {
            key: research_key.clone(),
            expected_head_identity: binding_identity(&withdrawn),
            dispatcher: ProductEdgeOperationDispatcherV1::TradeDashboard,
            manifest_identity: manifest(RESEARCH_GOAL_V3),
        },
        &proposals,
    )
    .await;
    assert_eq!(
        dashboard_research["state"], "ACTIVE",
        "{dashboard_research}"
    );
    let successor_deployment = deployment.activate_successor(pe_url).await.unwrap();
    assert_ne!(
        successor_deployment.binding_identity,
        deployment.binding_identity
    );
    let source_successor = route(
        pe_url,
        &successor_deployment,
        &ProductEdgeOperationRoutingProposalV1::Successor {
            key: source_key.clone(),
            expected_head_identity: binding_identity(&source_genesis),
            dispatcher: ProductEdgeOperationDispatcherV1::TradeDashboard,
            manifest_identity: manifest(SOURCE_INTAKE_OPERATION_V1),
        },
        &proposals,
    )
    .await;
    assert_eq!(source_successor["state"], "ACTIVE", "{source_successor}");
    let (_, observed) = ports.run("stale").await;
    assert_refused("STALE", &observed, &unavailable, &owner_requests);

    // Routed to the Dashboard under the current deployment binding: the RUN is admitted, its
    // admission recorded with the exact bindings the writer committed, and the Owner receives it.
    let admitted = route(
        pe_url,
        &successor_deployment,
        &ProductEdgeOperationRoutingProposalV1::Successor {
            key: research_key.clone(),
            expected_head_identity: binding_identity(&dashboard_research),
            dispatcher: ProductEdgeOperationDispatcherV1::TradeDashboard,
            manifest_identity: manifest(RESEARCH_GOAL_V3),
        },
        &proposals,
    )
    .await;
    assert_eq!(
        admitted["binding"]["dispatcher"], "TRADE_DASHBOARD",
        "{admitted}"
    );
    let (source_request, observed) = ports.run("admitted").await;
    assert_eq!(observed["response"]["status"], 202, "{observed}");
    assert_eq!(
        observed["response"]["envelope"]["availability"], "available",
        "{observed}"
    );
    assert_eq!(
        observed["admission"]["availability"], "available",
        "{observed}"
    );
    let committed = |body: &serde_json::Value| {
        serde_json::json!({
            "state": "ACTIVE",
            "dispatcher": "TRADE_DASHBOARD",
            "binding_identity": body["binding"]["binding_identity"],
            "binding_digest": body["binding"]["binding_digest"],
            "generation": body["binding"]["generation"],
        })
    };
    // The RunStore holds the exact bindings `route` committed, recorded before the Owner call.
    assert_eq!(
        observed["recovery"]["routing"],
        serde_json::json!({
            "source": committed(&source_successor),
            "research": committed(&admitted),
        }),
        "{observed}"
    );
    assert_eq!(
        observed["recovery"]["research_operation"], RESEARCH_GOAL_V3,
        "{observed}"
    );
    assert_eq!(observed["tick"]["state"], "executed", "{observed}");
    let requests = owner_requests.lock().unwrap().clone();
    // The chain record keeps this: what the Dashboard observed and what the Owner received.
    println!("admitted RUN: {observed}\nOwner requests: {requests:?}");
    // Both effects the RUN is admitted for reach the Owner, each marked as dispatched by the
    // Dashboard, and are answered: Source Intake retrieves the sealed source, and Research V3
    // answers for the request (whatever it answers; the chain's Market Data state decides that).
    // Anything after them is a resolve or a readback, which carries no dispatcher.
    assert_eq!(
        requests.get(..2),
        Some(
            &[
                "POST /v2/source-intakes TRADE_DASHBOARD -> 200".to_string(),
                "POST /v3/source-intake-research TRADE_DASHBOARD -> 200".to_string(),
            ][..]
        ),
        "the admitted RUN's Owner calls: {requests:?}"
    );
    assert!(
        requests[2..].iter().all(|line| line.contains(" - -> ")
            && (line.contains("/resolve ") || line.contains("/readback "))),
        "after its two effects the RUN only resolves or reads back: {requests:?}"
    );
    assert!(
        observed["recovery"]["observed_phases"]
            .as_array()
            .is_some_and(|phases| phases.contains(&"SOURCE_OWNER_AVAILABLE".into())),
        "the Dashboard accepted the Owner's Source Intake answer: {observed}"
    );

    // The Owner committed it: its own readback answers for the request the Dashboard sent.
    let readback = owner_get(
        owner_address,
        &format!("/v1/source-intakes/{source_request}/readback"),
    )
    .await;
    assert!(readback.starts_with("HTTP/1.1 200"), "{readback}");
    assert!(readback.contains(&source_request), "{readback}");

    routing_server.abort();
    owner_server.abort();
    std::fs::remove_dir_all(&proposals).unwrap();
}

/// One authorized GET against the Owner, answered as raw HTTP text.
async fn owner_get(address: SocketAddr, path: &str) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {address}\r\nAuthorization: Bearer {OWNER_TOKEN}\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.unwrap();
    String::from_utf8_lossy(&response).into_owned()
}
