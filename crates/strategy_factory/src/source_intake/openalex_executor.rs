use std::{collections::BTreeSet, net::SocketAddr, time::Duration};

use async_trait::async_trait;
use reqwest::header::ACCEPT;

use super::{
    InvocationPermitV1, OpenAlexResponseObservationV1, ResponseHeaderV1, SourceIntakeError,
    openalex_http,
};

const HTTPS_PORT: u16 = 443;
const ACCEPT_VALUE: &str = "application/json";

/// Opaque result of consuming one reserved OpenAlex invocation capability.
///
/// It is intentionally non-cloneable and cannot be constructed by callers.
#[derive(Debug)]
pub struct OpenAlexExecutionV1 {
    permit: InvocationPermitV1,
    observation: OpenAlexResponseObservationV1,
}

impl OpenAlexExecutionV1 {
    pub(crate) fn into_parts(self) -> (InvocationPermitV1, OpenAlexResponseObservationV1) {
        (self.permit, self.observation)
    }
}

#[derive(Debug)]
pub(super) struct OutboundRequestV1 {
    pub(super) url: String,
    pub(super) resolved_addresses: Vec<SocketAddr>,
    pub(super) accept: &'static str,
    pub(super) user_agent: &'static str,
    pub(super) timeout_ms: u64,
    pub(super) byte_limit: usize,
}

#[async_trait]
pub(super) trait Resolver: Sync {
    async fn resolve(&self, host: &str, port: u16) -> Result<Vec<SocketAddr>, ()>;
}

#[async_trait]
pub(super) trait Transport: Sync {
    async fn get(&self, request: OutboundRequestV1) -> OpenAlexResponseObservationV1;
}

struct SystemResolver;
struct ReqwestTransport;

/// Executes exactly one fixed-profile OpenAlex GET and consumes its permit.
///
/// Resolution, policy rejection, transport failure, timeout, and response loss
/// all consume the one-shot capability and return opaque terminal evidence. The
/// executor never retries and never follows redirects.
pub async fn execute_openalex(permit: InvocationPermitV1) -> OpenAlexExecutionV1 {
    execute_with(&SystemResolver, &ReqwestTransport, permit).await
}

pub(super) async fn execute_with<R: Resolver, T: Transport>(
    resolver: &R,
    transport: &T,
    permit: InvocationPermitV1,
) -> OpenAlexExecutionV1 {
    let observation = match sealed_request(&permit) {
        Ok(request) => match resolver.resolve(openalex_http::HOST, HTTPS_PORT).await {
            Ok(fresh_addresses)
                if resolution_matches_binding(&fresh_addresses, &request.resolved_addresses)
                    .is_ok() =>
            {
                transport
                    .get(OutboundRequestV1 {
                        url: request.url,
                        resolved_addresses: request
                            .resolved_addresses
                            .into_iter()
                            .map(|address| SocketAddr::new(address, HTTPS_PORT))
                            .collect(),
                        accept: ACCEPT_VALUE,
                        user_agent: openalex_http::USER_AGENT,
                        timeout_ms: request.timeout_ms,
                        byte_limit: request.byte_limit,
                    })
                    .await
            }
            _ => OpenAlexResponseObservationV1::transport_unavailable(),
        },
        Err(()) => OpenAlexResponseObservationV1::transport_unavailable(),
    };
    OpenAlexExecutionV1 {
        permit,
        observation,
    }
}

struct SealedRequestV1 {
    url: String,
    resolved_addresses: Vec<std::net::IpAddr>,
    timeout_ms: u64,
    byte_limit: usize,
}

fn sealed_request(permit: &InvocationPermitV1) -> Result<SealedRequestV1, ()> {
    super::validate_identity("invocation_identity", permit.invocation_identity())
        .map_err(|_| ())?;
    let (method, origin, path, resolved_addresses, timeout_ms, byte_limit) =
        permit.openalex_request();

    if method != openalex_http::METHOD || origin != openalex_http::ORIGIN {
        return Err(());
    }
    let doi = path.strip_prefix("/works/doi:").ok_or(())?;
    super::validate_normalized_doi(doi).map_err(|_| ())?;
    openalex_http::validate_public_addresses(resolved_addresses).map_err(|_| ())?;
    if timeout_ms == 0
        || timeout_ms > openalex_http::TIMEOUT_MS
        || byte_limit == 0
        || byte_limit > openalex_http::MAX_RESPONSE_BYTES
    {
        return Err(());
    }
    Ok(SealedRequestV1 {
        url: format!("{}{path}", openalex_http::ORIGIN),
        resolved_addresses: resolved_addresses.to_vec(),
        timeout_ms,
        byte_limit,
    })
}

fn resolution_matches_binding(
    fresh_addresses: &[SocketAddr],
    bound_addresses: &[std::net::IpAddr],
) -> Result<(), SourceIntakeError> {
    if fresh_addresses
        .iter()
        .any(|address| address.port() != HTTPS_PORT)
    {
        return Err(SourceIntakeError::NetworkPolicyRejected);
    }
    let fresh_addresses = fresh_addresses
        .iter()
        .map(SocketAddr::ip)
        .collect::<Vec<_>>();
    openalex_http::validate_public_addresses(&fresh_addresses)?;
    openalex_http::validate_public_addresses(bound_addresses)?;
    let fresh: BTreeSet<_> = fresh_addresses.into_iter().collect();
    let bound: BTreeSet<_> = bound_addresses.iter().copied().collect();
    if fresh != bound {
        return Err(SourceIntakeError::NetworkPolicyRejected);
    }
    Ok(())
}

#[async_trait]
impl Resolver for SystemResolver {
    async fn resolve(&self, host: &str, port: u16) -> Result<Vec<SocketAddr>, ()> {
        tokio::net::lookup_host((host, port))
            .await
            .map(|addresses| addresses.collect())
            .map_err(|_| ())
    }
}

#[async_trait]
impl Transport for ReqwestTransport {
    async fn get(&self, request: OutboundRequestV1) -> OpenAlexResponseObservationV1 {
        let client = match reqwest::Client::builder()
            .https_only(true)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .timeout(Duration::from_millis(request.timeout_ms))
            .user_agent(request.user_agent)
            .resolve_to_addrs(openalex_http::HOST, &request.resolved_addresses)
            .build()
        {
            Ok(client) => client,
            Err(_) => return OpenAlexResponseObservationV1::transport_unavailable(),
        };
        let response = client
            .get(request.url)
            .header(ACCEPT, request.accept)
            .send()
            .await;
        let mut response = match response {
            Ok(response) => response,
            Err(e) if e.is_timeout() => return OpenAlexResponseObservationV1::timeout(),
            Err(_) => return OpenAlexResponseObservationV1::transport_unavailable(),
        };
        let status = response.status().as_u16();
        let Some(connected_address) = response.remote_addr().map(|address| address.ip()) else {
            return OpenAlexResponseObservationV1::response_lost();
        };

        if !request
            .resolved_addresses
            .iter()
            .any(|address| address.ip() == connected_address)
        {
            return OpenAlexResponseObservationV1::response_lost();
        }

        if response.status().is_redirection() {
            return OpenAlexResponseObservationV1::redirect();
        }
        let headers = match bounded_headers(response.headers()) {
            Ok(headers) => headers,
            Err(()) => return OpenAlexResponseObservationV1::malformed_http(status, Vec::new()),
        };

        if status != 200 {
            return OpenAlexResponseObservationV1::http(
                status,
                headers,
                Vec::new(),
                connected_address,
            );
        }

        if response
            .content_length()
            .is_some_and(|length| length > request.byte_limit as u64)
        {
            return OpenAlexResponseObservationV1::malformed_http(status, headers);
        }
        let mut body = Vec::with_capacity(
            response
                .content_length()
                .and_then(|length| usize::try_from(length).ok())
                .unwrap_or_default(),
        );

        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    if append_bounded_body(&mut body, &chunk, request.byte_limit).is_err() {
                        return OpenAlexResponseObservationV1::malformed_http(status, headers);
                    }
                }
                Ok(None) => break,
                Err(e) if e.is_timeout() => {
                    return OpenAlexResponseObservationV1::timeout();
                }
                Err(_) => return OpenAlexResponseObservationV1::response_lost(),
            }
        }
        OpenAlexResponseObservationV1::http(status, headers, vec![body], connected_address)
    }
}

pub(super) fn append_bounded_body(
    body: &mut Vec<u8>,
    chunk: &[u8],
    byte_limit: usize,
) -> Result<(), ()> {
    let next_bytes = body.len().checked_add(chunk.len()).ok_or(())?;

    if next_bytes > byte_limit {
        return Err(());
    }
    body.extend_from_slice(chunk);
    Ok(())
}

fn bounded_headers(headers: &reqwest::header::HeaderMap) -> Result<Vec<ResponseHeaderV1>, ()> {
    if headers.len() > openalex_http::MAX_HEADER_COUNT {
        return Err(());
    }
    let mut total_bytes = 0usize;
    let mut bounded = Vec::with_capacity(headers.len());
    for (name, value) in headers {
        total_bytes = total_bytes
            .checked_add(name.as_str().len())
            .and_then(|length| length.checked_add(value.as_bytes().len()))
            .ok_or(())?;

        if total_bytes > openalex_http::MAX_HEADER_BYTES {
            return Err(());
        }
        bounded.push(ResponseHeaderV1 {
            name: name.as_str().to_string(),
            value: value.to_str().map_err(|_| ())?.to_string(),
        });
    }
    Ok(bounded)
}
