use serde::{Deserialize, Serialize};

use crate::QualificationOwnerError;
use crate::postgres::{canonical_digest, identity};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum QualificationPublicStatusV1 {
    NotAdmitted,
    Admitted,
    Evaluating,
    ClosedNotQualified,
}

/// Qualification-owned, serialize-only public phase fact.
///
/// The opaque reference commits to the native source fact without revealing
/// its protected type or disposition. Product Edge never receives the native
/// source identity or digest.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct QualificationPublicStatusFactV1 {
    schema_version: u16,
    fact_identity: String,
    fact_digest: String,
    review_request_identity: String,
    candidate_identity: String,
    status: QualificationPublicStatusV1,
    opaque_reference: String,
    source_frontier_identity: String,
    source_frontier_digest: String,
    committed_at_epoch_ms: u64,
}

impl QualificationPublicStatusFactV1 {
    pub fn fact_identity(&self) -> &str {
        &self.fact_identity
    }

    pub fn fact_digest(&self) -> &str {
        &self.fact_digest
    }

    pub fn review_request_identity(&self) -> &str {
        &self.review_request_identity
    }

    pub fn candidate_identity(&self) -> &str {
        &self.candidate_identity
    }

    pub const fn status(&self) -> QualificationPublicStatusV1 {
        self.status
    }

    pub fn opaque_reference(&self) -> &str {
        &self.opaque_reference
    }

    pub fn source_frontier_identity(&self) -> &str {
        &self.source_frontier_identity
    }

    pub fn source_frontier_digest(&self) -> &str {
        &self.source_frontier_digest
    }

    pub const fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }

    pub(crate) fn as_json(&self) -> Result<serde_json::Value, QualificationOwnerError> {
        serde_json::to_value(self).map_err(|error| unavailable(&error.to_string()))
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredQualificationPublicStatusFactV1 {
    schema_version: u16,
    fact_identity: String,
    fact_digest: String,
    review_request_identity: String,
    candidate_identity: String,
    status: QualificationPublicStatusV1,
    opaque_reference: String,
    source_frontier_identity: String,
    source_frontier_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct OpaqueReferenceMeaningV1<'a> {
    schema_version: u16,
    review_request_identity: &'a str,
    candidate_identity: &'a str,
    native_source_identity: &'a str,
    native_source_digest: &'a str,
}

#[derive(Serialize)]
struct PublicFactMeaningV1<'a> {
    schema_version: u16,
    review_request_identity: &'a str,
    candidate_identity: &'a str,
    status: QualificationPublicStatusV1,
    opaque_reference: &'a str,
    source_frontier_identity: &'a str,
    source_frontier_digest: &'a str,
    committed_at_epoch_ms: u64,
}

pub(crate) struct PublicStatusFactInputV1<'a> {
    pub(crate) review_request_identity: &'a str,
    pub(crate) candidate_identity: &'a str,
    pub(crate) status: QualificationPublicStatusV1,
    pub(crate) native_source_identity: &'a str,
    pub(crate) native_source_digest: &'a str,
    pub(crate) source_frontier_identity: &'a str,
    pub(crate) source_frontier_digest: &'a str,
    pub(crate) committed_at_epoch_ms: u64,
}

pub(crate) fn form_public_status_fact_v1(
    input: &PublicStatusFactInputV1<'_>,
) -> Result<QualificationPublicStatusFactV1, QualificationOwnerError> {
    for value in [
        input.review_request_identity,
        input.candidate_identity,
        input.native_source_identity,
        input.native_source_digest,
        input.source_frontier_identity,
        input.source_frontier_digest,
    ] {
        if value.trim().is_empty() || value != value.trim() {
            return Err(unavailable(
                "Qualification public status binding is invalid",
            ));
        }
    }
    if !is_sha256_digest(input.native_source_digest)
        || !is_sha256_digest(input.source_frontier_digest)
    {
        return Err(unavailable("Qualification public status digest is invalid"));
    }
    if digest_from_identity_suffix(input.native_source_identity)? != input.native_source_digest
        || digest_from_identity(
            "qualification-protected-feedback-frontier-v1-",
            input.source_frontier_identity,
        )? != input.source_frontier_digest
    {
        return Err(unavailable(
            "Qualification public status source binding changed",
        ));
    }

    let opaque_digest = canonical_digest(
        "qualification.public-status-opaque-reference.v1",
        &OpaqueReferenceMeaningV1 {
            schema_version: 1,
            review_request_identity: input.review_request_identity,
            candidate_identity: input.candidate_identity,
            native_source_identity: input.native_source_identity,
            native_source_digest: input.native_source_digest,
        },
    )?;
    let opaque_reference = identity("qualification-public-reference-v1", &opaque_digest);
    let fact_digest = canonical_digest(
        "qualification.public-status-fact.v1",
        &PublicFactMeaningV1 {
            schema_version: 1,
            review_request_identity: input.review_request_identity,
            candidate_identity: input.candidate_identity,
            status: input.status,
            opaque_reference: &opaque_reference,
            source_frontier_identity: input.source_frontier_identity,
            source_frontier_digest: input.source_frontier_digest,
            committed_at_epoch_ms: input.committed_at_epoch_ms,
        },
    )?;

    Ok(QualificationPublicStatusFactV1 {
        schema_version: 1,
        fact_identity: identity("qualification-public-status-fact-v1", &fact_digest),
        fact_digest,
        review_request_identity: input.review_request_identity.to_string(),
        candidate_identity: input.candidate_identity.to_string(),
        status: input.status,
        opaque_reference,
        source_frontier_identity: input.source_frontier_identity.to_string(),
        source_frontier_digest: input.source_frontier_digest.to_string(),
        committed_at_epoch_ms: input.committed_at_epoch_ms,
    })
}

pub(crate) fn decode_public_status_fact_v1(
    value: &serde_json::Value,
    native_source_identity: &str,
    native_source_digest: &str,
) -> Result<QualificationPublicStatusFactV1, QualificationOwnerError> {
    let stored: StoredQualificationPublicStatusFactV1 =
        serde_json::from_value(value.clone()).map_err(|error| unavailable(&error.to_string()))?;
    let expected = form_public_status_fact_v1(&PublicStatusFactInputV1 {
        review_request_identity: &stored.review_request_identity,
        candidate_identity: &stored.candidate_identity,
        status: stored.status,
        native_source_identity,
        native_source_digest,
        source_frontier_identity: &stored.source_frontier_identity,
        source_frontier_digest: &stored.source_frontier_digest,
        committed_at_epoch_ms: stored.committed_at_epoch_ms,
    })?;
    if expected.as_json()? != *value {
        return Err(unavailable(
            "stored Qualification public status fact changed",
        ));
    }
    Ok(expected)
}

pub(crate) fn decode_public_status_readback_v1(
    value: &serde_json::Value,
) -> Result<QualificationPublicStatusFactV1, QualificationOwnerError> {
    let stored: StoredQualificationPublicStatusFactV1 =
        serde_json::from_value(value.clone()).map_err(|error| unavailable(&error.to_string()))?;
    if !is_content_addressed_identity(
        "qualification-public-reference-v1-",
        &stored.opaque_reference,
    ) || !is_content_addressed_identity(
        "qualification-protected-feedback-frontier-v1-",
        &stored.source_frontier_identity,
    ) || !is_sha256_digest(&stored.source_frontier_digest)
        || digest_from_identity(
            "qualification-protected-feedback-frontier-v1-",
            &stored.source_frontier_identity,
        )? != stored.source_frontier_digest
    {
        return Err(unavailable(
            "Qualification public status reference is invalid",
        ));
    }
    let fact_digest = canonical_digest(
        "qualification.public-status-fact.v1",
        &PublicFactMeaningV1 {
            schema_version: stored.schema_version,
            review_request_identity: &stored.review_request_identity,
            candidate_identity: &stored.candidate_identity,
            status: stored.status,
            opaque_reference: &stored.opaque_reference,
            source_frontier_identity: &stored.source_frontier_identity,
            source_frontier_digest: &stored.source_frontier_digest,
            committed_at_epoch_ms: stored.committed_at_epoch_ms,
        },
    )?;
    if stored.schema_version != 1
        || stored.fact_digest != fact_digest
        || stored.fact_identity != identity("qualification-public-status-fact-v1", &fact_digest)
    {
        return Err(unavailable("Qualification public status readback changed"));
    }
    let fact = QualificationPublicStatusFactV1 {
        schema_version: stored.schema_version,
        fact_identity: stored.fact_identity,
        fact_digest: stored.fact_digest,
        review_request_identity: stored.review_request_identity,
        candidate_identity: stored.candidate_identity,
        status: stored.status,
        opaque_reference: stored.opaque_reference,
        source_frontier_identity: stored.source_frontier_identity,
        source_frontier_digest: stored.source_frontier_digest,
        committed_at_epoch_ms: stored.committed_at_epoch_ms,
    };
    if fact.as_json()? != *value {
        return Err(unavailable(
            "Qualification public status JSON is not canonical",
        ));
    }
    Ok(fact)
}

pub(crate) fn digest_from_identity(
    prefix: &str,
    value: &str,
) -> Result<String, QualificationOwnerError> {
    let suffix = value
        .strip_prefix(prefix)
        .ok_or_else(|| unavailable("content-addressed identity prefix is invalid"))?;
    if suffix.len() != 64
        || !suffix
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(unavailable("content-addressed identity digest is invalid"));
    }
    Ok(format!("sha256:{suffix}"))
}

fn digest_from_identity_suffix(value: &str) -> Result<String, QualificationOwnerError> {
    let (_, suffix) = value
        .rsplit_once('-')
        .ok_or_else(|| unavailable("content-addressed identity prefix is invalid"))?;
    if suffix.len() != 64
        || !suffix
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(unavailable("content-addressed identity digest is invalid"));
    }
    Ok(format!("sha256:{suffix}"))
}

pub(crate) const fn public_status_name(status: QualificationPublicStatusV1) -> &'static str {
    match status {
        QualificationPublicStatusV1::NotAdmitted => "NOT_ADMITTED",
        QualificationPublicStatusV1::Admitted => "ADMITTED",
        QualificationPublicStatusV1::Evaluating => "EVALUATING",
        QualificationPublicStatusV1::ClosedNotQualified => "CLOSED_NOT_QUALIFIED",
    }
}

fn is_sha256_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|suffix| {
        suffix.len() == 64
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn is_content_addressed_identity(prefix: &str, value: &str) -> bool {
    value.strip_prefix(prefix).is_some_and(|suffix| {
        suffix.len() == 64
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn unavailable(message: &str) -> QualificationOwnerError {
    QualificationOwnerError::Unavailable(message.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_negative_kinds_share_one_public_shape() {
        let replay_source_digest = format!("sha256:{}", "a".repeat(64));
        let source_frontier_digest = format!("sha256:{}", "b".repeat(64));
        let replay = form_public_status_fact_v1(&PublicStatusFactInputV1 {
            review_request_identity: "review-1",
            candidate_identity: "candidate-1",
            status: QualificationPublicStatusV1::ClosedNotQualified,
            native_source_identity: &format!(
                "qualification-protected-attempt-disposition-v1-{}",
                "a".repeat(64)
            ),
            native_source_digest: &replay_source_digest,
            source_frontier_identity: &format!(
                "qualification-protected-feedback-frontier-v1-{}",
                "b".repeat(64)
            ),
            source_frontier_digest: &source_frontier_digest,
            committed_at_epoch_ms: 7,
        })
        .unwrap();
        let ineligible_source_digest = format!("sha256:{}", "c".repeat(64));
        let ineligible = form_public_status_fact_v1(&PublicStatusFactInputV1 {
            review_request_identity: "review-1",
            candidate_identity: "candidate-1",
            status: QualificationPublicStatusV1::ClosedNotQualified,
            native_source_identity: &format!(
                "qualification-protected-eligibility-fact-v1-{}",
                "c".repeat(64)
            ),
            native_source_digest: &ineligible_source_digest,
            source_frontier_identity: &format!(
                "qualification-protected-feedback-frontier-v1-{}",
                "b".repeat(64)
            ),
            source_frontier_digest: &source_frontier_digest,
            committed_at_epoch_ms: 7,
        })
        .unwrap();

        let replay_json = replay.as_json().unwrap();
        let ineligible_json = ineligible.as_json().unwrap();
        assert_eq!(replay_json["status"], ineligible_json["status"]);
        assert_eq!(
            replay_json.as_object().unwrap().keys().collect::<Vec<_>>(),
            ineligible_json
                .as_object()
                .unwrap()
                .keys()
                .collect::<Vec<_>>()
        );
        assert_ne!(replay.opaque_reference(), ineligible.opaque_reference());
        assert!(!replay_json.to_string().contains("REPLAY"));
        assert!(!ineligible_json.to_string().contains("INELIGIBLE"));
    }
}
