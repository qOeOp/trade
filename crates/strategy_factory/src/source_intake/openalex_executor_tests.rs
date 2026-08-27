use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use async_trait::async_trait;
use rstest::rstest;

use super::{
    AcquisitionTerminalV1, InvocationPermitV1, MAX_RESPONSE_BYTES, OpenAlexResponseObservationV1,
    OpenAlexWorkByDoiRequestV1, ProductEdgeAdmissionLocatorV1, ProductEdgeGatewayV1,
    ResponseHeaderV1, SourceAcquisitionAdmissionV1, SourceIntakeAttemptV1,
    SourceIntakePolicyEvidenceV1, SourceInterpretationV1, TestStartedCustodyV1,
    openalex_executor::{
        OutboundRequestV1, Resolver, Transport, append_bounded_body, execute_with,
    },
    openalex_http,
};

const DOI: &str = "10.1234/example";
const PUBLIC_A: IpAddr = IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34));
const PUBLIC_B: IpAddr = IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1));
const PUBLIC_V6: IpAddr = IpAddr::V6(Ipv6Addr::new(0x2606, 0x4700, 0x4700, 0, 0, 0, 0, 0x1111));

struct FakeDns {
    addresses: Vec<SocketAddr>,
    calls: AtomicUsize,
}

impl FakeDns {
    fn new(addresses: Vec<SocketAddr>) -> Self {
        Self {
            addresses,
            calls: AtomicUsize::new(0),
        }
    }
}

#[async_trait]
impl Resolver for FakeDns {
    async fn resolve(&self, host: &str, port: u16) -> Result<Vec<SocketAddr>, ()> {
        assert_eq!(host, openalex_http::HOST);
        assert_eq!(port, 443);
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self.addresses.clone())
    }
}

struct FakeServer {
    response: Mutex<Option<OpenAlexResponseObservationV1>>,
    requests: Mutex<Vec<OutboundRequestV1>>,
}

impl FakeServer {
    fn returning(response: OpenAlexResponseObservationV1) -> Self {
        Self {
            response: Mutex::new(Some(response)),
            requests: Mutex::new(Vec::new()),
        }
    }

    fn call_count(&self) -> usize {
        self.requests.lock().expect("request mutex poisoned").len()
    }
}

#[async_trait]
impl Transport for FakeServer {
    async fn get(&self, request: OutboundRequestV1) -> OpenAlexResponseObservationV1 {
        self.requests
            .lock()
            .expect("request mutex poisoned")
            .push(request);
        self.response
            .lock()
            .expect("response mutex poisoned")
            .take()
            .expect("executor retried the fake server")
    }
}

fn socket(ip: IpAddr) -> SocketAddr {
    SocketAddr::new(ip, 443)
}

fn permit(path: &str) -> InvocationPermitV1 {
    let (_, mut permit) = reserved_attempt();
    assert!(permit.invocation_identity().starts_with("sha256:"));
    permit.path = path.into();
    permit
}

fn reserved_attempt() -> (SourceIntakeAttemptV1, InvocationPermitV1) {
    reserved_attempt_with(
        vec![PUBLIC_A],
        MAX_RESPONSE_BYTES,
        openalex_http::TIMEOUT_MS,
    )
}

fn reserved_attempt_with(
    resolved_addresses: Vec<IpAddr>,
    byte_limit: usize,
    timeout_ms: u64,
) -> (SourceIntakeAttemptV1, InvocationPermitV1) {
    let request = OpenAlexWorkByDoiRequestV1 {
        request_identity: "request-001".into(),
        gateway: ProductEdgeGatewayV1::WindmillProductEdge,
        admission: ProductEdgeAdmissionLocatorV1 {
            request_identity: "request-001".into(),
            admission_identity: "admission-001".into(),
            admission_digest:
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
        },
        operation_manifest_identity: "manifest-001".into(),
        operation_manifest_digest:
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".into(),
        normalized_doi: DOI.into(),
    };
    let evidence = SourceIntakePolicyEvidenceV1::fixture(
        &request,
        resolved_addresses,
        0,
        0,
        byte_limit,
        timeout_ms,
        SourceAcquisitionAdmissionV1::Admitted,
    );
    let mut attempt = SourceIntakeAttemptV1::close_binding(request, evidence)
        .expect("binding fixture is admitted");
    let custody = TestStartedCustodyV1::fixture(
        "request-001",
        "admission-001",
        "started-state-001",
        SourceInterpretationV1 {
            bounded_explanation: "bounded explanation".into(),
            plausible_alternatives: vec!["alternative".into()],
            differentiating_prediction: "prediction".into(),
            falsifier: "falsifier".into(),
        },
    )
    .expect("custody fixture is canonical");
    attempt
        .prepare("binding-commit-001", custody)
        .expect("attempt prepares");
    let permit = attempt
        .reserve_invocation_fixture()
        .expect("invocation reserves");
    (attempt, permit)
}

fn json_headers() -> Vec<ResponseHeaderV1> {
    vec![ResponseHeaderV1 {
        name: "content-type".into(),
        value: "application/json".into(),
    }]
}

fn valid_body() -> Vec<u8> {
    br#"{"doi":"https://doi.org/10.1234/example","locations":[]}"#.to_vec()
}

fn resolved(observation: OpenAlexResponseObservationV1, bound: &[IpAddr]) -> AcquisitionTerminalV1 {
    openalex_http::resolve_response(DOI, observation, openalex_http::MAX_RESPONSE_BYTES, bound)
        .terminal
}

#[tokio::test]
async fn fixed_origin_path_and_one_shot_request_are_exact() {
    let dns = FakeDns::new(vec![socket(PUBLIC_A)]);
    let server = FakeServer::returning(OpenAlexResponseObservationV1::http(
        200,
        json_headers(),
        vec![valid_body()],
        PUBLIC_A,
    ));

    let (mut attempt, permit) = reserved_attempt();
    let execution = execute_with(&dns, &server, permit).await;
    let readback = attempt
        .resolve_openalex_execution_fixture(execution, 1_800_000_000_001)
        .expect("opaque execution resolves once");

    assert_eq!(dns.calls.load(Ordering::SeqCst), 1);
    assert_eq!(server.call_count(), 1);
    let requests = server.requests.lock().expect("request mutex poisoned");
    assert_eq!(
        requests[0].url,
        "https://api.openalex.org/works/doi:10.1234/example"
    );
    assert!(!requests[0].url.contains('?'));
    assert_eq!(requests[0].resolved_addresses, vec![socket(PUBLIC_A)]);
    assert_eq!(requests[0].accept, "application/json");
    assert_eq!(requests[0].user_agent, "vibe-trader-source-intake-v1");
    assert_eq!(requests[0].timeout_ms, openalex_http::TIMEOUT_MS);
    assert_eq!(requests[0].byte_limit, MAX_RESPONSE_BYTES);
    assert_eq!(readback.terminal, Some(AcquisitionTerminalV1::Retrieved));
    assert!(attempt.raw_payload().is_some());
    assert!(attempt.committed_provenance().is_some());
    assert!(attempt.committed_candidate().is_some());
    assert!(attempt.committed_outbox().is_some());
}

#[tokio::test]
async fn dns_drift_stops_before_transport_and_safe_order_drift_pins_the_binding() {
    let drifted_dns = FakeDns::new(vec![socket(PUBLIC_B)]);
    let drifted_server = FakeServer::returning(OpenAlexResponseObservationV1::timeout());
    let execution = execute_with(
        &drifted_dns,
        &drifted_server,
        permit("/works/doi:10.1234/example"),
    )
    .await;
    let (_, observation) = execution.into_parts();
    assert_eq!(
        resolved(observation, &[PUBLIC_A]),
        AcquisitionTerminalV1::Unavailable
    );
    assert_eq!(drifted_dns.calls.load(Ordering::SeqCst), 1);
    assert_eq!(drifted_server.call_count(), 0);

    let reordered_dns = FakeDns::new(vec![socket(PUBLIC_B), socket(PUBLIC_A)]);
    let reordered_server = FakeServer::returning(OpenAlexResponseObservationV1::timeout());
    let (_, permit) = reserved_attempt_with(
        vec![PUBLIC_A, PUBLIC_B],
        MAX_RESPONSE_BYTES,
        openalex_http::TIMEOUT_MS,
    );
    let _execution = execute_with(&reordered_dns, &reordered_server, permit).await;
    let requests = reordered_server
        .requests
        .lock()
        .expect("request mutex poisoned");
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0].resolved_addresses,
        vec![socket(PUBLIC_A), socket(PUBLIC_B)]
    );
}

#[tokio::test]
async fn owner_committed_timeout_and_byte_limit_reach_transport_exactly() {
    let dns = FakeDns::new(vec![socket(PUBLIC_A)]);
    let server = FakeServer::returning(OpenAlexResponseObservationV1::timeout());
    let (_, permit) = reserved_attempt_with(vec![PUBLIC_A], 64, 1_234);
    let _execution = execute_with(&dns, &server, permit).await;
    let requests = server.requests.lock().expect("request mutex poisoned");
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].timeout_ms, 1_234);
    assert_eq!(requests[0].byte_limit, 64);
}

#[rstest]
fn streaming_body_enforces_the_owner_committed_byte_limit() {
    let mut body = Vec::new();
    assert_eq!(append_bounded_body(&mut body, &[1; 63], 64), Ok(()));
    assert_eq!(append_bounded_body(&mut body, &[2], 64), Ok(()));
    assert_eq!(append_bounded_body(&mut body, &[3], 64), Err(()));
    assert_eq!(body.len(), 64);
}

#[tokio::test]
async fn corrupted_bounds_stop_before_dns_and_transport() {
    for (timeout_ms, byte_limit) in [
        (0, MAX_RESPONSE_BYTES),
        (openalex_http::TIMEOUT_MS + 1, MAX_RESPONSE_BYTES),
        (openalex_http::TIMEOUT_MS, 0),
        (openalex_http::TIMEOUT_MS, MAX_RESPONSE_BYTES + 1),
    ] {
        let dns = FakeDns::new(vec![socket(PUBLIC_A)]);
        let server = FakeServer::returning(OpenAlexResponseObservationV1::timeout());
        let (_, mut permit) = reserved_attempt();
        permit.timeout_ms = timeout_ms;
        permit.byte_limit = byte_limit;
        let _execution = execute_with(&dns, &server, permit).await;
        assert_eq!(dns.calls.load(Ordering::SeqCst), 0);
        assert_eq!(server.call_count(), 0);
    }
}

#[tokio::test]
async fn special_use_and_transition_ipv6_stop_before_transport() {
    let special_addresses = [
        Ipv6Addr::new(0xfec0, 0, 0, 0, 0, 0, 0, 1),
        Ipv6Addr::new(0x0064, 0xff9b, 0, 0, 0, 0, 0x0a00, 1),
        Ipv6Addr::new(0x0064, 0xff9b, 0, 0, 0, 0, 0xa9fe, 0x0101),
        Ipv6Addr::new(0x2001, 0, 0, 0, 0, 0, 0, 1),
        Ipv6Addr::new(0x2002, 0, 0, 0, 0, 0, 0, 1),
        Ipv6Addr::new(0x3ffe, 0, 0, 0, 0, 0, 0, 1),
        Ipv6Addr::new(0x3fff, 0, 0, 0, 0, 0, 0, 1),
        Ipv4Addr::new(8, 8, 8, 8).to_ipv6_mapped(),
        Ipv6Addr::new(0xfc00, 0, 0, 0, 0, 0, 0, 1),
        Ipv6Addr::new(0xfe80, 0, 0, 0, 0, 0, 0, 1),
        Ipv6Addr::new(0xff02, 0, 0, 0, 0, 0, 0, 1),
    ];

    for address in special_addresses {
        let dns = FakeDns::new(vec![socket(PUBLIC_A)]);
        let server = FakeServer::returning(OpenAlexResponseObservationV1::timeout());
        let (_, mut permit) = reserved_attempt();
        permit.resolved_addresses = vec![IpAddr::V6(address)];
        let _execution = execute_with(&dns, &server, permit).await;
        assert_eq!(dns.calls.load(Ordering::SeqCst), 0);
        assert_eq!(server.call_count(), 0);
    }
}

#[tokio::test]
async fn ordinary_global_unicast_ipv6_is_admitted() {
    let dns = FakeDns::new(vec![socket(PUBLIC_V6)]);
    let server = FakeServer::returning(OpenAlexResponseObservationV1::timeout());
    let (_, permit) = reserved_attempt_with(
        vec![PUBLIC_V6],
        MAX_RESPONSE_BYTES,
        openalex_http::TIMEOUT_MS,
    );
    let _execution = execute_with(&dns, &server, permit).await;
    assert_eq!(dns.calls.load(Ordering::SeqCst), 1);
    assert_eq!(server.call_count(), 1);
}

#[tokio::test]
async fn invalid_path_and_unsafe_dns_stop_before_the_server() {
    let invalid_path_dns = FakeDns::new(vec![socket(PUBLIC_A)]);
    let invalid_path_server = FakeServer::returning(OpenAlexResponseObservationV1::timeout());
    let execution = execute_with(
        &invalid_path_dns,
        &invalid_path_server,
        permit("/works/doi:10.1234/example?mailto=caller"),
    )
    .await;
    let (_, observation) = execution.into_parts();
    assert_eq!(
        resolved(observation, &[PUBLIC_A]),
        AcquisitionTerminalV1::Unavailable
    );
    assert_eq!(invalid_path_dns.calls.load(Ordering::SeqCst), 0);
    assert_eq!(invalid_path_server.call_count(), 0);

    for addresses in [
        Vec::new(),
        vec![socket(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)))],
        vec![socket(IpAddr::V4(Ipv4Addr::LOCALHOST))],
        vec![socket(IpAddr::V4(Ipv4Addr::new(169, 254, 1, 1)))],
        vec![socket(IpAddr::V4(Ipv4Addr::new(192, 0, 2, 1)))],
        vec![socket(IpAddr::V4(Ipv4Addr::new(224, 0, 0, 1)))],
        vec![socket(IpAddr::V6(Ipv6Addr::new(
            0x2001, 0x0db8, 0, 0, 0, 0, 0, 1,
        )))],
        vec![socket(IpAddr::V6(
            Ipv4Addr::new(8, 8, 8, 8).to_ipv6_mapped(),
        ))],
        vec![SocketAddr::new(PUBLIC_A, 444)],
        vec![socket(PUBLIC_A), socket(PUBLIC_A)],
        (1..=9)
            .map(|last| socket(IpAddr::V4(Ipv4Addr::new(8, 8, 8, last))))
            .collect(),
    ] {
        let dns = FakeDns::new(addresses);
        let server = FakeServer::returning(OpenAlexResponseObservationV1::timeout());
        let execution = execute_with(&dns, &server, permit("/works/doi:10.1234/example")).await;
        let (_, observation) = execution.into_parts();
        assert_eq!(
            resolved(observation, &[PUBLIC_A]),
            AcquisitionTerminalV1::Unavailable
        );
        assert_eq!(dns.calls.load(Ordering::SeqCst), 1);
        assert_eq!(server.call_count(), 0);
    }
}

#[tokio::test]
async fn redirect_timeout_and_response_loss_never_retry() {
    for response in [
        OpenAlexResponseObservationV1::fixture_redirect(),
        OpenAlexResponseObservationV1::fixture_timeout(),
        OpenAlexResponseObservationV1::fixture_transport_unavailable(),
        OpenAlexResponseObservationV1::fixture_response_lost(),
    ] {
        let dns = FakeDns::new(vec![socket(PUBLIC_A)]);
        let server = FakeServer::returning(response);
        let execution = execute_with(&dns, &server, permit("/works/doi:10.1234/example")).await;
        let (_, observation) = execution.into_parts();
        assert_eq!(
            resolved(observation, &[PUBLIC_A]),
            AcquisitionTerminalV1::Unavailable
        );
        assert_eq!(dns.calls.load(Ordering::SeqCst), 1);
        assert_eq!(server.call_count(), 1);
    }
}

#[rstest]
fn connected_address_must_be_one_member_of_the_resolution() {
    let member = OpenAlexResponseObservationV1::fixture_http(
        200,
        json_headers(),
        vec![valid_body()],
        vec![PUBLIC_B],
    );
    assert_eq!(
        resolved(member, &[PUBLIC_A, PUBLIC_B]),
        AcquisitionTerminalV1::Retrieved
    );

    let rebound = OpenAlexResponseObservationV1::http(
        200,
        json_headers(),
        vec![valid_body()],
        IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)),
    );
    assert_eq!(
        resolved(rebound, &[PUBLIC_A, PUBLIC_B]),
        AcquisitionTerminalV1::Unavailable
    );
}

#[rstest]
fn response_contract_maps_auth_and_rejects_malformed_evidence() {
    let auth = OpenAlexResponseObservationV1::http(401, vec![], vec![], PUBLIC_A);
    assert_eq!(
        resolved(auth, &[PUBLIC_A]),
        AcquisitionTerminalV1::AuthRequired
    );

    let wrong_media = OpenAlexResponseObservationV1::http(
        200,
        vec![ResponseHeaderV1 {
            name: "content-type".into(),
            value: "text/plain".into(),
        }],
        vec![valid_body()],
        PUBLIC_A,
    );
    let bad_json = OpenAlexResponseObservationV1::http(
        200,
        json_headers(),
        vec![b"not-json".to_vec()],
        PUBLIC_A,
    );
    let wrong_doi = OpenAlexResponseObservationV1::http(
        200,
        json_headers(),
        vec![br#"{"doi":"https://doi.org/10.9999/other","locations":[]}"#.to_vec()],
        PUBLIC_A,
    );
    let oversized_body = OpenAlexResponseObservationV1::http(
        200,
        json_headers(),
        vec![vec![b'x'; openalex_http::MAX_RESPONSE_BYTES + 1]],
        PUBLIC_A,
    );
    let too_many_headers = OpenAlexResponseObservationV1::http(
        200,
        (0..=64)
            .map(|index| ResponseHeaderV1 {
                name: format!("x-{index}"),
                value: "v".into(),
            })
            .collect(),
        vec![valid_body()],
        PUBLIC_A,
    );
    let oversized_headers = OpenAlexResponseObservationV1::http(
        200,
        vec![ResponseHeaderV1 {
            name: "content-type".into(),
            value: "x".repeat(openalex_http::MAX_HEADER_BYTES),
        }],
        vec![valid_body()],
        PUBLIC_A,
    );

    for observation in [
        wrong_media,
        bad_json,
        wrong_doi,
        oversized_body,
        too_many_headers,
        oversized_headers,
    ] {
        assert_eq!(
            resolved(observation, &[PUBLIC_A]),
            AcquisitionTerminalV1::Malformed
        );
    }
}

#[rstest]
fn exact_body_limit_is_accepted() {
    let mut body = valid_body();
    body.resize(openalex_http::MAX_RESPONSE_BYTES, b' ');
    let observation = OpenAlexResponseObservationV1::http(
        200,
        json_headers(),
        vec![body[..17].to_vec(), body[17..].to_vec()],
        PUBLIC_A,
    );
    assert_eq!(
        resolved(observation, &[PUBLIC_A]),
        AcquisitionTerminalV1::Retrieved
    );
}

#[rstest]
fn location_count_and_location_fields_are_bounded() {
    let locations = (0..129).map(|_| serde_json::json!({})).collect::<Vec<_>>();
    let too_many = serde_json::to_vec(&serde_json::json!({
        "doi": "https://doi.org/10.1234/example",
        "locations": locations,
    }))
    .expect("fixture serializes");
    let long_url = "x".repeat(2_049);
    let oversized_location = serde_json::to_vec(&serde_json::json!({
        "doi": "https://doi.org/10.1234/example",
        "locations": [{"landing_page_url": long_url}],
    }))
    .expect("fixture serializes");

    for body in [too_many, oversized_location] {
        let observation =
            OpenAlexResponseObservationV1::http(200, json_headers(), vec![body], PUBLIC_A);
        assert_eq!(
            resolved(observation, &[PUBLIC_A]),
            AcquisitionTerminalV1::Malformed
        );
    }
}
