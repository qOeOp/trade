use std::{collections::BTreeSet, net::IpAddr};

use serde::{Deserialize, Deserializer, de};

use super::{
    AcquisitionTerminalV1, LocationRightsPostureV1, LocationRightsV1, OpenAlexWorkByDoiRequestV1,
    SourceAcquisitionAuthorityBindingV1, SourceAcquisitionAuthorityClassV1,
    SourceAcquisitionBindingV1, SourceIntakeError, SourceIntakePolicyEvidenceV1, digest_bytes,
    domain_identity, raw_content_digest,
};

pub(super) const METHOD: &str = "GET";
pub(super) const ORIGIN: &str = "https://api.openalex.org";
pub(super) const HOST: &str = "api.openalex.org";
pub(super) const USER_AGENT: &str = "vibe-trader-source-intake-v1";
const CONNECTOR_IDENTITY: &str = "rd.openalex-work-by-doi";
const CONNECTOR_VERSION: &str = "v1";
const TLS_STACK_IDENTITY: &str = "rustls-only-v1";
const MEDIA_TYPE: &str = "application/json";
pub(super) const TIMEOUT_MS: u64 = 5_000;
pub(crate) const MAX_RESPONSE_BYTES: usize = 1_048_576;
pub(super) const MAX_HEADER_COUNT: usize = 64;
pub(super) const MAX_HEADER_BYTES: usize = 32_768;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResponseHeaderV1 {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OpenAlexResponseObservationV1 {
    kind: OpenAlexResponseObservationKindV1,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum OpenAlexResponseObservationKindV1 {
    Http {
        status: u16,
        headers: Vec<ResponseHeaderV1>,
        body_chunks: Vec<Vec<u8>>,
        connected_addresses: Vec<IpAddr>,
    },
    Redirect,
    Timeout,
    TransportUnavailable,
    ResponseLostAfterInvocation,
    MalformedHttp {
        status: u16,
        headers: Vec<ResponseHeaderV1>,
    },
}

impl OpenAlexResponseObservationV1 {
    pub(super) fn http(
        status: u16,
        headers: Vec<ResponseHeaderV1>,
        body_chunks: Vec<Vec<u8>>,
        connected_address: IpAddr,
    ) -> Self {
        Self {
            kind: OpenAlexResponseObservationKindV1::Http {
                status,
                headers,
                body_chunks,
                connected_addresses: vec![connected_address],
            },
        }
    }

    pub(super) fn redirect() -> Self {
        Self {
            kind: OpenAlexResponseObservationKindV1::Redirect,
        }
    }

    pub(super) fn timeout() -> Self {
        Self {
            kind: OpenAlexResponseObservationKindV1::Timeout,
        }
    }

    pub(super) fn transport_unavailable() -> Self {
        Self {
            kind: OpenAlexResponseObservationKindV1::TransportUnavailable,
        }
    }

    pub(super) fn response_lost() -> Self {
        Self {
            kind: OpenAlexResponseObservationKindV1::ResponseLostAfterInvocation,
        }
    }

    pub(super) fn malformed_http(status: u16, headers: Vec<ResponseHeaderV1>) -> Self {
        Self {
            kind: OpenAlexResponseObservationKindV1::MalformedHttp { status, headers },
        }
    }

    #[cfg(any(test, feature = "sealed-source-intake-acceptance"))]
    pub(crate) fn fixture_http(
        status: u16,
        headers: Vec<ResponseHeaderV1>,
        body_chunks: Vec<Vec<u8>>,
        connected_addresses: Vec<IpAddr>,
    ) -> Self {
        Self {
            kind: OpenAlexResponseObservationKindV1::Http {
                status,
                headers,
                body_chunks,
                connected_addresses,
            },
        }
    }

    #[cfg(test)]
    pub(crate) fn fixture_redirect() -> Self {
        Self {
            kind: OpenAlexResponseObservationKindV1::Redirect,
        }
    }

    #[cfg(test)]
    pub(crate) fn fixture_timeout() -> Self {
        Self {
            kind: OpenAlexResponseObservationKindV1::Timeout,
        }
    }

    #[cfg(test)]
    pub(crate) fn fixture_transport_unavailable() -> Self {
        Self {
            kind: OpenAlexResponseObservationKindV1::TransportUnavailable,
        }
    }

    #[cfg(test)]
    pub(crate) fn fixture_response_lost() -> Self {
        Self {
            kind: OpenAlexResponseObservationKindV1::ResponseLostAfterInvocation,
        }
    }
}

pub(super) struct ResolvedResponseV1 {
    pub terminal: AcquisitionTerminalV1,
    pub response_status: Option<u16>,
    pub response_header_digest: Option<String>,
    pub connected_address: Option<IpAddr>,
    pub response_media_type: Option<String>,
    pub response_size_bytes: Option<usize>,
    pub content_digest: Option<String>,
    pub raw_payload: Option<Vec<u8>>,
    pub location_rights: Vec<LocationRightsV1>,
}

impl ResolvedResponseV1 {
    pub(super) fn without_payload(
        terminal: AcquisitionTerminalV1,
        response_status: Option<u16>,
        response_header_digest: Option<String>,
    ) -> Self {
        Self {
            terminal,
            response_status,
            response_header_digest,
            connected_address: None,
            response_media_type: None,
            response_size_bytes: None,
            content_digest: None,
            raw_payload: None,
            location_rights: Vec::new(),
        }
    }
}

pub(super) fn build_binding(
    request: &OpenAlexWorkByDoiRequestV1,
    evidence: SourceIntakePolicyEvidenceV1,
) -> Result<SourceAcquisitionBindingV1, SourceIntakeError> {
    if evidence.retry_budget != 0
        || evidence.redirect_hop_limit != 0
        || evidence.response_media_type != MEDIA_TYPE
        || evidence.response_byte_limit == 0
        || evidence.response_byte_limit > MAX_RESPONSE_BYTES
        || evidence.response_timeout_ms == 0
        || evidence.response_timeout_ms > TIMEOUT_MS
        || evidence.response_header_count_limit != MAX_HEADER_COUNT
        || evidence.response_header_byte_limit != MAX_HEADER_BYTES
        || evidence.gateway != request.gateway
        || evidence.admission() != &request.admission
        || evidence.manifest_identity() != request.operation_manifest_identity
        || evidence.manifest_digest() != request.operation_manifest_digest
    {
        return Err(SourceIntakeError::InvalidRequest(
            "binding exceeds the fixed OpenAlex profile".into(),
        ));
    }
    validate_public_addresses(&evidence.resolved_addresses)?;
    super::validate_identity("rights_basis_identity", &evidence.rights_basis_identity)?;
    super::validate_identity(
        "retention_policy_identity",
        &evidence.retention_policy_identity,
    )?;
    super::validate_digest("policy_evidence_digest", &evidence.policy_evidence_digest)?;
    super::validate_digest("dns_observation_digest", &evidence.dns_observation_digest)?;
    if evidence.shared_time.valid_through_epoch_ms <= evidence.shared_time.decision_cut_epoch_ms
        || evidence.rights_valid_through_epoch_ms <= evidence.rights_effective_at_epoch_ms
        || evidence.retention_valid_through_epoch_ms <= evidence.retention_effective_at_epoch_ms
        || evidence.shared_time.decision_cut_epoch_ms < evidence.rights_effective_at_epoch_ms
        || evidence.shared_time.decision_cut_epoch_ms >= evidence.rights_valid_through_epoch_ms
        || evidence.shared_time.decision_cut_epoch_ms < evidence.retention_effective_at_epoch_ms
        || evidence.shared_time.decision_cut_epoch_ms >= evidence.retention_valid_through_epoch_ms
    {
        return Err(SourceIntakeError::InvalidRequest(
            "policy evidence is outside its Shared Time intervals".into(),
        ));
    }

    let endpoint_path = format!("/works/doi:{}", request.normalized_doi);
    let absent_body_digest = digest_bytes("rd.http.absent-body.v1", b"");
    let allowed_header_digest = digest_bytes(
        "rd.openalex.request-headers.v1",
        b"accept:application/json\nuser-agent:vibe-trader-source-intake-v1",
    );
    let mut binding = SourceAcquisitionBindingV1 {
        schema_version: 1,
        binding_identity: String::new(),
        binding_digest: String::new(),
        authority: SourceAcquisitionAuthorityBindingV1 {
            authority_class: SourceAcquisitionAuthorityClassV1::LiveExternal,
            environment_identity: "PRODUCTION_LIVE_EXTERNAL".into(),
            provider_profile_digest:
                "sha256:18e4411c991be0a92514bc8ff238ef0429f379d7aa0fd17c1169c7a4c0f45c6b".into(),
            fixture_corpus_digest: None,
        },
        predecessor_binding_identity: None,
        request_identity: request.request_identity.clone(),
        gateway: request.gateway,
        product_edge_admission: request.admission.clone(),
        operation_manifest_identity: request.operation_manifest_identity.clone(),
        operation_manifest_digest: request.operation_manifest_digest.clone(),
        policy_evidence_identity: evidence.policy_evidence_identity,
        policy_evidence_digest: evidence.policy_evidence_digest,
        normalized_doi: request.normalized_doi.clone(),
        connector_identity: CONNECTOR_IDENTITY.into(),
        connector_version: CONNECTOR_VERSION.into(),
        connector_policy_identity: evidence.connector_policy_identity,
        connector_policy_version: evidence.connector_policy_version,
        network_policy_identity: evidence.network_policy_identity,
        network_policy_version: evidence.network_policy_version,
        scheme: "https".into(),
        host: HOST.into(),
        tls_stack_identity: TLS_STACK_IDENTITY.into(),
        tls_policy_identity: evidence.tls_policy_identity,
        tls_policy_version: evidence.tls_policy_version,
        method: METHOD.into(),
        https_origin: ORIGIN.into(),
        endpoint_path,
        endpoint_query: String::new(),
        dns_policy_identity: evidence.dns_policy_identity,
        dns_policy_version: evidence.dns_policy_version,
        dns_observation_identity: evidence.dns_observation_identity,
        dns_observation_digest: evidence.dns_observation_digest,
        resolved_addresses: evidence.resolved_addresses,
        redirect_policy_identity: evidence.redirect_policy_identity,
        redirect_policy_version: evidence.redirect_policy_version,
        redirect_predecessor_binding_identity: None,
        redirect_hop_index: 0,
        absent_body_digest,
        body_media_type: None,
        body_size_bytes: 0,
        allowed_header_digest,
        credential_policy_identity: evidence.credential_policy_identity,
        credential_handle_identity: evidence.credential_handle_identity,
        credential_audience: evidence.credential_audience,
        credential_scope: evidence.credential_scope,
        credential_placement: "ABSENT_BODY_AND_HEADERS".into(),
        egress_policy_identity: evidence.egress_policy_identity,
        egress_policy_version: evidence.egress_policy_version,
        media_type: MEDIA_TYPE.into(),
        byte_limit: evidence.response_byte_limit,
        timeout_ms: evidence.response_timeout_ms,
        header_count_limit: evidence.response_header_count_limit,
        header_byte_limit: evidence.response_header_byte_limit,
        retry_budget: 0,
        redirect_hop_limit: 0,
        rights_basis_identity: evidence.rights_basis_identity,
        rights_policy_version: evidence.rights_policy_version,
        rights_effective_at_epoch_ms: evidence.rights_effective_at_epoch_ms,
        rights_valid_through_epoch_ms: evidence.rights_valid_through_epoch_ms,
        acquisition_scope: evidence.acquisition_scope,
        retention_policy_identity: evidence.retention_policy_identity,
        retention_policy_version: evidence.retention_policy_version,
        retention_effective_at_epoch_ms: evidence.retention_effective_at_epoch_ms,
        retention_valid_through_epoch_ms: evidence.retention_valid_through_epoch_ms,
        retention_scope: evidence.retention_scope,
        shared_time: evidence.shared_time,
        admission: evidence.admission_decision,
    };
    let (binding_digest, binding_identity) = binding_content_address(&binding)?;
    binding.binding_digest = binding_digest;
    binding.binding_identity = binding_identity;
    Ok(binding)
}

pub(super) fn binding_content_address(
    binding: &SourceAcquisitionBindingV1,
) -> Result<(String, String), SourceIntakeError> {
    let mut semantic = serde_json::to_value(binding)
        .map_err(|e| SourceIntakeError::Serialization(e.to_string()))?;
    let object = semantic
        .as_object_mut()
        .ok_or_else(|| SourceIntakeError::Serialization("binding is not an object".into()))?;
    object.remove("binding_identity");
    object.remove("binding_digest");
    let canonical = serde_json::to_vec(&semantic)
        .map_err(|e| SourceIntakeError::Serialization(e.to_string()))?;
    let digest = raw_content_digest(&canonical);
    let identity = domain_identity("rd.source-acquisition-binding-identity.v1", &[&digest]);
    Ok((digest, identity))
}

#[cfg(test)]
pub fn binding_content_address_for_test(
    binding: &SourceAcquisitionBindingV1,
) -> Result<(String, String), SourceIntakeError> {
    binding_content_address(binding)
}

pub(super) fn resolve_response(
    normalized_doi: &str,
    observation: OpenAlexResponseObservationV1,
    byte_limit: usize,
    bound_addresses: &[IpAddr],
) -> ResolvedResponseV1 {
    let (status, headers, body_chunks, connected_addresses) = match observation.kind {
        OpenAlexResponseObservationKindV1::Http {
            status,
            headers,
            body_chunks,
            connected_addresses,
        } => (status, headers, body_chunks, connected_addresses),
        OpenAlexResponseObservationKindV1::MalformedHttp { status, headers } => {
            return ResolvedResponseV1::without_payload(
                AcquisitionTerminalV1::Malformed,
                Some(status),
                canonical_header_digest(&headers).ok(),
            );
        }
        _ => {
            return ResolvedResponseV1::without_payload(
                AcquisitionTerminalV1::Unavailable,
                None,
                None,
            );
        }
    };

    if validate_connected_membership(bound_addresses, &connected_addresses).is_err() {
        return ResolvedResponseV1::without_payload(AcquisitionTerminalV1::Unavailable, None, None);
    }
    let Ok(header_digest) = canonical_header_digest(&headers) else {
        return ResolvedResponseV1::without_payload(
            AcquisitionTerminalV1::Malformed,
            Some(status),
            None,
        );
    };
    let terminal = match status {
        200 => None,
        401 => Some(AcquisitionTerminalV1::AuthRequired),
        403 => Some(AcquisitionTerminalV1::AccessDenied),
        404 => Some(AcquisitionTerminalV1::NotFound),
        429 => Some(AcquisitionTerminalV1::RateLimited),
        400..=499 => Some(AcquisitionTerminalV1::Malformed),
        500..=599 => Some(AcquisitionTerminalV1::Unavailable),
        _ => Some(AcquisitionTerminalV1::Malformed),
    };

    if let Some(terminal) = terminal {
        return ResolvedResponseV1::without_payload(terminal, Some(status), Some(header_digest));
    }

    if require_json_media_type(&headers).is_err() {
        return ResolvedResponseV1::without_payload(
            AcquisitionTerminalV1::Malformed,
            Some(status),
            Some(header_digest),
        );
    }
    let Ok(raw_payload) = collect_bounded_body(body_chunks, byte_limit) else {
        return ResolvedResponseV1::without_payload(
            AcquisitionTerminalV1::Malformed,
            Some(status),
            Some(header_digest),
        );
    };
    let Ok(work) = serde_json::from_slice::<OpenAlexWorkWire>(&raw_payload) else {
        return ResolvedResponseV1::without_payload(
            AcquisitionTerminalV1::Malformed,
            Some(status),
            Some(header_digest),
        );
    };
    let expected_doi = format!("https://doi.org/{normalized_doi}");

    if work.doi.as_deref() != Some(expected_doi.as_str()) {
        return ResolvedResponseV1::without_payload(
            AcquisitionTerminalV1::Malformed,
            Some(status),
            Some(header_digest),
        );
    }

    if work.locations.len() > 128
        || work
            .locations
            .iter()
            .any(OpenAlexLocationWire::outside_bounds)
    {
        return ResolvedResponseV1::without_payload(
            AcquisitionTerminalV1::Malformed,
            Some(status),
            Some(header_digest),
        );
    }
    let content_digest = raw_content_digest(&raw_payload);
    let location_rights = work
        .locations
        .into_iter()
        .enumerate()
        .map(|(index, location)| location.into_rights(normalized_doi, index))
        .collect();
    ResolvedResponseV1 {
        terminal: AcquisitionTerminalV1::Retrieved,
        response_status: Some(status),
        response_header_digest: Some(header_digest),
        connected_address: connected_addresses.into_iter().next(),
        response_media_type: Some(MEDIA_TYPE.into()),
        response_size_bytes: Some(raw_payload.len()),
        content_digest: Some(content_digest),
        raw_payload: Some(raw_payload),
        location_rights,
    }
}

pub(super) fn validate_public_addresses(addresses: &[IpAddr]) -> Result<(), SourceIntakeError> {
    if addresses.is_empty() || addresses.len() > 8 || addresses.iter().any(is_non_public) {
        return Err(SourceIntakeError::NetworkPolicyRejected);
    }
    let unique: BTreeSet<_> = addresses.iter().collect();
    if unique.len() != addresses.len() {
        return Err(SourceIntakeError::NetworkPolicyRejected);
    }
    Ok(())
}

fn validate_connected_membership(
    bound: &[IpAddr],
    connected: &[IpAddr],
) -> Result<(), SourceIntakeError> {
    validate_public_addresses(bound)?;
    if connected.len() != 1 || is_non_public(&connected[0]) || !bound.contains(&connected[0]) {
        return Err(SourceIntakeError::NetworkPolicyRejected);
    }
    Ok(())
}

fn is_non_public(address: &IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            let [a, b, c, d] = address.octets();
            a == 0
                || a == 10
                || a == 127
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 0 && c == 0)
                || (a == 192 && b == 0 && c == 2)
                || (a == 192 && b == 88 && c == 99)
                || (a == 192 && b == 168)
                || (a == 198 && (b == 18 || b == 19))
                || (a == 198 && b == 51 && c == 100)
                || (a == 203 && b == 0 && c == 113)
                || a >= 224
                || (a == 255 && b == 255 && c == 255 && d == 255)
        }
        IpAddr::V6(address) => {
            let segments = address.segments();
            (segments[0] & 0xe000) != 0x2000
                || (segments[0] == 0x2001 && segments[1] < 0x0200)
                || (segments[0] == 0x2001 && segments[1] == 0x0db8)
                || segments[0] == 0x2002
                || segments[0] == 0x3ffe
                || (segments[0] == 0x3fff && (segments[1] & 0xf000) == 0)
        }
    }
}

fn canonical_header_digest(headers: &[ResponseHeaderV1]) -> Result<String, SourceIntakeError> {
    if headers.len() > MAX_HEADER_COUNT {
        return Err(SourceIntakeError::ResponseBoundExceeded);
    }
    let mut canonical = Vec::new();
    let mut names = BTreeSet::new();

    for header in headers {
        let name = header.name.to_ascii_lowercase();
        if name.is_empty()
            || name != header.name
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            || !names.insert(name.clone())
            || header.value.bytes().any(|byte| byte < 0x20 || byte == 0x7f)
        {
            return Err(SourceIntakeError::MalformedResponse);
        }
        canonical.push((name, header.value.trim().to_string()));
    }
    canonical.sort();
    let bytes = canonical
        .into_iter()
        .flat_map(|(name, value)| format!("{name}:{value}\n").into_bytes())
        .collect::<Vec<_>>();

    if bytes.len() > MAX_HEADER_BYTES {
        return Err(SourceIntakeError::ResponseBoundExceeded);
    }
    Ok(digest_bytes("rd.openalex.response-headers.v1", &bytes))
}

fn require_json_media_type(headers: &[ResponseHeaderV1]) -> Result<(), SourceIntakeError> {
    let media = headers
        .iter()
        .find(|header| header.name == "content-type")
        .map(|header| header.value.to_ascii_lowercase())
        .ok_or(SourceIntakeError::MalformedResponse)?;
    if media != MEDIA_TYPE && media != "application/json; charset=utf-8" {
        return Err(SourceIntakeError::MalformedResponse);
    }
    Ok(())
}

fn collect_bounded_body(
    chunks: Vec<Vec<u8>>,
    byte_limit: usize,
) -> Result<Vec<u8>, SourceIntakeError> {
    let mut body = Vec::new();
    for chunk in chunks {
        let next_len = body
            .len()
            .checked_add(chunk.len())
            .ok_or(SourceIntakeError::ResponseBoundExceeded)?;
        if next_len > byte_limit {
            return Err(SourceIntakeError::ResponseBoundExceeded);
        }
        body.extend_from_slice(&chunk);
    }

    if body.is_empty() {
        return Err(SourceIntakeError::MalformedResponse);
    }
    Ok(body)
}

#[derive(Debug)]
struct OpenAlexWorkWire {
    doi: Option<String>,
    locations: Vec<OpenAlexLocationWire>,
}

impl<'de> Deserialize<'de> for OpenAlexWorkWire {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_map(OpenAlexWorkVisitor)
    }
}

struct OpenAlexWorkVisitor;

impl<'de> de::Visitor<'de> for OpenAlexWorkVisitor {
    type Value = OpenAlexWorkWire;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("an OpenAlex Work object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: de::MapAccess<'de>,
    {
        let mut seen = BTreeSet::new();
        let mut doi = None;
        let mut locations = None;

        while let Some(key) = map.next_key::<String>()? {
            if !seen.insert(key.clone()) {
                return Err(de::Error::custom("duplicate OpenAlex field"));
            }

            match key.as_str() {
                "doi" => doi = map.next_value::<Option<String>>()?,
                "locations" => locations = Some(map.next_value::<Vec<OpenAlexLocationWire>>()?),
                _ => {
                    // OpenAlex Work metadata is intentionally open-ended. Unknown provider
                    // fields remain only in the private raw bytes and never enter the
                    // normalized authority-bearing projection.
                    map.next_value::<de::IgnoredAny>()?;
                }
            }
        }
        Ok(OpenAlexWorkWire {
            doi,
            locations: locations.unwrap_or_default(),
        })
    }
}

#[derive(Debug, Default)]
struct OpenAlexLocationWire {
    is_oa: Option<bool>,
    license: Option<String>,
    landing_page_url: Option<String>,
    pdf_url: Option<String>,
}

impl OpenAlexLocationWire {
    fn outside_bounds(&self) -> bool {
        self.license.as_ref().is_some_and(|value| value.len() > 128)
            || self
                .landing_page_url
                .as_ref()
                .is_some_and(|value| value.len() > 2_048)
            || self
                .pdf_url
                .as_ref()
                .is_some_and(|value| value.len() > 2_048)
    }

    fn into_rights(self, doi: &str, index: usize) -> LocationRightsV1 {
        let landing_page_locator_digest = self.landing_page_url.as_deref().map(|value| {
            digest_bytes(
                "rd.source-intake.location.landing-page.v1",
                value.as_bytes(),
            )
        });
        let pdf_locator_digest = self
            .pdf_url
            .as_deref()
            .map(|value| digest_bytes("rd.source-intake.location.pdf.v1", value.as_bytes()));
        let location_identity = domain_identity(
            "rd.source-intake.location-rights.v1",
            &[
                doi,
                &index.to_string(),
                landing_page_locator_digest.as_deref().unwrap_or("ABSENT"),
                pdf_locator_digest.as_deref().unwrap_or("ABSENT"),
                self.license.as_deref().unwrap_or("UNREPORTED"),
            ],
        );
        LocationRightsV1 {
            location_identity,
            is_open_access_metadata: self.is_oa,
            reported_license: self.license,
            landing_page_locator_digest,
            pdf_locator_digest,
            posture: LocationRightsPostureV1::MutableMetadataNotReuseGrant,
        }
    }
}

impl<'de> Deserialize<'de> for OpenAlexLocationWire {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_map(OpenAlexLocationVisitor)
    }
}

struct OpenAlexLocationVisitor;

impl<'de> de::Visitor<'de> for OpenAlexLocationVisitor {
    type Value = OpenAlexLocationWire;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("an OpenAlex location object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: de::MapAccess<'de>,
    {
        let mut value = OpenAlexLocationWire::default();
        let mut seen = BTreeSet::new();

        while let Some(key) = map.next_key::<String>()? {
            if !seen.insert(key.clone()) {
                return Err(de::Error::custom("duplicate OpenAlex location field"));
            }

            match key.as_str() {
                "is_oa" => value.is_oa = map.next_value::<Option<bool>>()?,
                "license" => value.license = map.next_value::<Option<String>>()?,
                "landing_page_url" => {
                    value.landing_page_url = map.next_value::<Option<String>>()?;
                }
                "pdf_url" => value.pdf_url = map.next_value::<Option<String>>()?,
                _ => {
                    // Location metadata evolves independently of the fixed rights
                    // projection; unknown values remain private untrusted raw data.
                    map.next_value::<de::IgnoredAny>()?;
                }
            }
        }
        Ok(value)
    }
}
