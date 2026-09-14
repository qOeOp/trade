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
    source_frontier_is_current: bool,
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

    pub const fn source_frontier_is_current(&self) -> bool {
        self.source_frontier_is_current
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
    source_frontier_is_current: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredPublicStatusReadEnvelopeV1 {
    schema_version: u16,
    fact: serde_json::Value,
    history: Vec<serde_json::Value>,
    terminal_event: Option<StoredPublicTerminalEventV1>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredPublicTerminalEventV1 {
    event_identity: String,
    payload_digest: String,
    payload_json: serde_json::Value,
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
    source_frontier_is_current: bool,
}

#[derive(Serialize)]
struct PublicTerminalEventMeaningV1<'a> {
    schema_version: u16,
    status: QualificationPublicStatusV1,
    opaque_reference: &'a str,
    source_frontier_identity: &'a str,
    source_frontier_digest: &'a str,
    source_frontier_is_current: bool,
}

pub(crate) struct PublicStatusFactInputV1<'a> {
    pub(crate) review_request_identity: &'a str,
    pub(crate) candidate_identity: &'a str,
    pub(crate) status: QualificationPublicStatusV1,
    pub(crate) native_source_identity: &'a str,
    pub(crate) native_source_digest: &'a str,
    pub(crate) source_frontier_identity: &'a str,
    pub(crate) source_frontier_digest: &'a str,
    pub(crate) source_frontier_is_current: bool,
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
            source_frontier_is_current: input.source_frontier_is_current,
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
        source_frontier_is_current: input.source_frontier_is_current,
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
        source_frontier_is_current: stored.source_frontier_is_current,
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
    let envelope: StoredPublicStatusReadEnvelopeV1 =
        serde_json::from_value(value.clone()).map_err(|error| unavailable(&error.to_string()))?;
    if envelope.schema_version != 1 {
        return Err(unavailable("Qualification public status envelope changed"));
    }
    let fact = decode_public_status_public_fact_v1(&envelope.fact)?;
    let history = envelope
        .history
        .iter()
        .map(decode_public_status_public_fact_v1)
        .collect::<Result<Vec<_>, _>>()?;
    let mut previous_status = None;
    for historical in &history {
        let transition_is_valid = matches!(
            (previous_status, historical.status()),
            (
                None,
                QualificationPublicStatusV1::NotAdmitted | QualificationPublicStatusV1::Admitted
            ) | (
                Some(QualificationPublicStatusV1::Admitted),
                QualificationPublicStatusV1::Evaluating
            ) | (
                Some(QualificationPublicStatusV1::Evaluating),
                QualificationPublicStatusV1::ClosedNotQualified
            )
        );
        if !transition_is_valid
            || historical.review_request_identity() != fact.review_request_identity()
            || historical.candidate_identity() != fact.candidate_identity()
            || historical.source_frontier_identity() != fact.source_frontier_identity()
            || historical.source_frontier_digest() != fact.source_frontier_digest()
        {
            return Err(unavailable("Qualification public status history changed"));
        }
        previous_status = Some(historical.status());
    }
    if history.last() != Some(&fact) {
        return Err(unavailable("Qualification public status head is stale"));
    }
    match (fact.terminal_event_v1()?, envelope.terminal_event) {
        (None, None) => {}
        (Some((expected_identity, expected_digest, expected_json)), Some(stored_event))
            if stored_event.event_identity == expected_identity
                && stored_event.payload_digest == expected_digest
                && stored_event.payload_json == expected_json => {}
        _ => {
            return Err(unavailable("Qualification public terminal event changed"));
        }
    }
    Ok(fact)
}

fn decode_public_status_public_fact_v1(
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
            source_frontier_is_current: stored.source_frontier_is_current,
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
        source_frontier_is_current: stored.source_frontier_is_current,
    };
    if fact.as_json()? != *value {
        return Err(unavailable(
            "Qualification public status JSON is not canonical",
        ));
    }
    Ok(fact)
}

impl QualificationPublicStatusFactV1 {
    pub(crate) fn terminal_event_v1(
        &self,
    ) -> Result<Option<(String, String, serde_json::Value)>, QualificationOwnerError> {
        if self.status != QualificationPublicStatusV1::ClosedNotQualified {
            return Ok(None);
        }
        let payload = serde_json::to_value(PublicTerminalEventMeaningV1 {
            schema_version: 1,
            status: self.status,
            opaque_reference: &self.opaque_reference,
            source_frontier_identity: &self.source_frontier_identity,
            source_frontier_digest: &self.source_frontier_digest,
            source_frontier_is_current: self.source_frontier_is_current,
        })
        .map_err(|error| unavailable(&error.to_string()))?;
        let digest = canonical_digest("qualification.public-status-terminal-event.v1", &payload)?;
        Ok(Some((
            identity("qualification-public-status-terminal-event-v1", &digest),
            digest,
            payload,
        )))
    }
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
    fn postgres_canonical_digest_interop_vector_is_stable() {
        let value = serde_json::json!({
            "z": [2, {"b": true, "a": "x"}],
            "a": null,
        });
        assert_eq!(
            canonical_digest("test.domain", &value).unwrap(),
            "sha256:9d00d10c5eafa9ac29b9367ed0c7cd299d0077017025789d17bfca0b280da223"
        );
        assert_eq!(
            canonical_digest("test.bytes", &br#"{"a":1}"#.to_vec()).unwrap(),
            "sha256:fc36c838cbb3673d095a291739429a7fdb5850c2f42a16bd48ac90a8e5b343fc"
        );
        let opaque_digest = canonical_digest(
            "qualification.public-status-opaque-reference.v1",
            &OpaqueReferenceMeaningV1 {
                schema_version: 1,
                review_request_identity: "review-r5",
                candidate_identity: "candidate-r5",
                native_source_identity: "native-r5",
                native_source_digest: concat!(
                    "sha256:",
                    "1111111111111111111111111111111111111111111111111111111111111111"
                ),
            },
        )
        .unwrap();
        assert_eq!(
            opaque_digest,
            "sha256:d7324219d241aae0353a49d08abe33e0b9608ff587933b8fe5e530a48fa776f7"
        );
        let opaque_reference = format!(
            "qualification-public-reference-v1-{}",
            opaque_digest.strip_prefix("sha256:").unwrap()
        );
        assert_eq!(
            canonical_digest(
                "qualification.public-status-fact.v1",
                &PublicFactMeaningV1 {
                    schema_version: 1,
                    review_request_identity: "review-r5",
                    candidate_identity: "candidate-r5",
                    status: QualificationPublicStatusV1::ClosedNotQualified,
                    opaque_reference: &opaque_reference,
                    source_frontier_identity: "frontier-r5",
                    source_frontier_digest: concat!(
                        "sha256:",
                        "2222222222222222222222222222222222222222222222222222222222222222"
                    ),
                    source_frontier_is_current: true,
                },
            )
            .unwrap(),
            "sha256:a2894972d1f29cfd9ad53674183017788f3d541fba0f33075a4d462d7f2bb111"
        );
    }

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
            source_frontier_is_current: true,
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
            source_frontier_is_current: true,
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
        assert!(!replay_json.to_string().contains("committed_at"));
        assert!(
            !replay
                .terminal_event_v1()
                .unwrap()
                .unwrap()
                .2
                .to_string()
                .contains("committed_at")
        );
    }

    #[test]
    fn public_readback_rejects_stale_head_and_terminal_event_drift() {
        let frontier_digest = format!("sha256:{}", "f".repeat(64));
        let frontier_identity = format!(
            "qualification-protected-feedback-frontier-v1-{}",
            "f".repeat(64)
        );
        let fact = |status, source: char| {
            let digest = format!("sha256:{}", source.to_string().repeat(64));
            form_public_status_fact_v1(&PublicStatusFactInputV1 {
                review_request_identity: "review-1",
                candidate_identity: "candidate-1",
                status,
                native_source_identity: &format!(
                    "qualification-native-source-v1-{}",
                    source.to_string().repeat(64)
                ),
                native_source_digest: &digest,
                source_frontier_identity: &frontier_identity,
                source_frontier_digest: &frontier_digest,
                source_frontier_is_current: true,
            })
            .unwrap()
        };
        let admitted = fact(QualificationPublicStatusV1::Admitted, 'a');
        let evaluating = fact(QualificationPublicStatusV1::Evaluating, 'b');
        let closed = fact(QualificationPublicStatusV1::ClosedNotQualified, 'c');
        let (event_identity, payload_digest, payload_json) =
            closed.terminal_event_v1().unwrap().unwrap();
        let history = vec![
            admitted.as_json().unwrap(),
            evaluating.as_json().unwrap(),
            closed.as_json().unwrap(),
        ];
        let valid = serde_json::json!({
            "schema_version": 1,
            "fact": closed.as_json().unwrap(),
            "history": history,
            "terminal_event": {
                "event_identity": event_identity,
                "payload_digest": payload_digest,
                "payload_json": payload_json,
            },
        });
        assert_eq!(decode_public_status_readback_v1(&valid).unwrap(), closed);

        let mut stale = valid.clone();
        stale["fact"] = admitted.as_json().unwrap();
        stale["terminal_event"] = serde_json::Value::Null;
        assert!(decode_public_status_readback_v1(&stale).is_err());

        let mut event_drift = valid;
        event_drift["terminal_event"]["payload_digest"] =
            serde_json::Value::String(format!("sha256:{}", "0".repeat(64)));
        assert!(decode_public_status_readback_v1(&event_drift).is_err());
    }
}
