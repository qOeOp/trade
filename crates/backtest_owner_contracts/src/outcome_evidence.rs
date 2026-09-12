//! Forgeable wire vocabulary for evidence about one canonical Backtest result.
//!
//! Successful validation proves only that the JSON and its internal bindings are consistent. It
//! does not prove that Backtest produced, retained, or authorized the evidence.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    CanonicalDigestV2, ComponentObservationLocatorV2, ContentIdentityV2, ObservationComponentV2,
    OpaqueIdentityV2,
};

const OUTCOME_EVIDENCE_SCHEMA_V1: u16 = 1;
const CANONICAL_RESULT_SCHEMA_V1: &str = "vibe-backtest-result/v1";
const OUTCOME_EVIDENCE_DIGEST_DOMAIN_V1: &[u8] = b"vibe.backtest.outcome-evidence.v1\0";
const OUTCOME_EVIDENCE_IDENTITY_PREFIX_V1: &str = "backtest-outcome-evidence-v1-";

/// Binding to the exact canonical result bytes evaluated by a later Owner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CanonicalResultBindingDtoV1 {
    /// Canonical result wire schema. Version 1 accepts only `vibe-backtest-result/v1`.
    pub schema_identity: OpaqueIdentityV2,
    /// Digest of the exact canonical result bytes.
    pub canonical_bytes_digest: CanonicalDigestV2,
    /// Length of the exact canonical result bytes.
    pub canonical_bytes_length: u64,
}

/// Non-self-referential bindings used to construct forgeable outcome evidence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BacktestOutcomeEvidenceBindingsV1 {
    pub result_identity: OpaqueIdentityV2,
    pub result_digest: CanonicalDigestV2,
    pub request_identity: OpaqueIdentityV2,
    pub request_meaning_digest: CanonicalDigestV2,
    pub attempt_identity: OpaqueIdentityV2,
    pub frozen_research_intent: ContentIdentityV2,
    pub trial_family_census_frontier: ContentIdentityV2,
    pub semantic_trace: ComponentObservationLocatorV2,
    pub canonical_result: CanonicalResultBindingDtoV1,
}

/// Dependency-neutral and forgeable outcome-evidence vocabulary.
///
/// This type carries no Backtest authority. A consumer must obtain authority from an Owner
/// receipt/readback rather than from successful validation of this DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BacktestOutcomeEvidenceDtoV1 {
    pub schema_version: u16,
    pub evidence_identity: OpaqueIdentityV2,
    pub evidence_digest: CanonicalDigestV2,
    pub result_identity: OpaqueIdentityV2,
    pub result_digest: CanonicalDigestV2,
    pub request_identity: OpaqueIdentityV2,
    pub request_meaning_digest: CanonicalDigestV2,
    pub attempt_identity: OpaqueIdentityV2,
    pub frozen_research_intent: ContentIdentityV2,
    pub trial_family_census_frontier: ContentIdentityV2,
    pub semantic_trace: ComponentObservationLocatorV2,
    pub canonical_result: CanonicalResultBindingDtoV1,
}

impl BacktestOutcomeEvidenceDtoV1 {
    /// Constructs internally consistent, but still forgeable, evidence from exact bindings.
    ///
    /// # Errors
    ///
    /// Rejects invalid semantic-trace or canonical-result bindings.
    pub fn from_bindings(
        bindings: BacktestOutcomeEvidenceBindingsV1,
    ) -> Result<Self, BacktestOutcomeEvidenceErrorV1> {
        let placeholder_digest = CanonicalDigestV2::try_from(format!("blake3:{}", "0".repeat(64)))?;
        let mut evidence = Self {
            schema_version: OUTCOME_EVIDENCE_SCHEMA_V1,
            evidence_identity: OpaqueIdentityV2::try_from("pending".to_owned())?,
            evidence_digest: placeholder_digest,
            result_identity: bindings.result_identity,
            result_digest: bindings.result_digest,
            request_identity: bindings.request_identity,
            request_meaning_digest: bindings.request_meaning_digest,
            attempt_identity: bindings.attempt_identity,
            frozen_research_intent: bindings.frozen_research_intent,
            trial_family_census_frontier: bindings.trial_family_census_frontier,
            semantic_trace: bindings.semantic_trace,
            canonical_result: bindings.canonical_result,
        };
        evidence.validate_bindings()?;
        evidence.evidence_digest = evidence.compute_evidence_digest()?;
        evidence.evidence_identity = evidence.expected_evidence_identity()?;
        Ok(evidence)
    }

    /// Decodes the one canonical JSON representation accepted by this vocabulary.
    ///
    /// Validation proves wire consistency only; it does not confer Backtest authority.
    ///
    /// # Errors
    ///
    /// Rejects malformed, unknown, duplicate, noncanonical, or inconsistent input.
    pub fn from_canonical_bytes(bytes: &[u8]) -> Result<Self, BacktestOutcomeEvidenceErrorV1> {
        let evidence: Self = serde_json::from_slice(bytes)
            .map_err(|error| BacktestOutcomeEvidenceErrorV1::InvalidEncoding(error.to_string()))?;
        evidence.validate()?;
        if evidence.encode_unchecked()? != bytes {
            return Err(BacktestOutcomeEvidenceErrorV1::NonCanonicalEncoding);
        }
        Ok(evidence)
    }

    /// Validates schema, bindings, content digest, and content-derived identity.
    ///
    /// Validation proves wire consistency only; it does not confer Backtest authority.
    ///
    /// # Errors
    ///
    /// Rejects any invalid binding, digest, or identity.
    pub fn validate(&self) -> Result<(), BacktestOutcomeEvidenceErrorV1> {
        if self.schema_version != OUTCOME_EVIDENCE_SCHEMA_V1 {
            return Err(BacktestOutcomeEvidenceErrorV1::UnsupportedSchema {
                expected: OUTCOME_EVIDENCE_SCHEMA_V1,
                actual: self.schema_version,
            });
        }
        self.validate_bindings()?;
        if self.evidence_digest != self.compute_evidence_digest()? {
            return Err(BacktestOutcomeEvidenceErrorV1::EvidenceDigestMismatch);
        }
        if self.evidence_identity != self.expected_evidence_identity()? {
            return Err(BacktestOutcomeEvidenceErrorV1::EvidenceIdentityMismatch);
        }
        Ok(())
    }

    /// Returns canonical JSON bytes after strict validation.
    ///
    /// Validation proves wire consistency only; it does not confer Backtest authority.
    ///
    /// # Errors
    ///
    /// Rejects inconsistent evidence or unavailable JSON encoding.
    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, BacktestOutcomeEvidenceErrorV1> {
        self.validate()?;
        self.encode_unchecked()
    }

    fn validate_bindings(&self) -> Result<(), BacktestOutcomeEvidenceErrorV1> {
        if self.semantic_trace.component != ObservationComponentV2::SemanticTrace {
            return Err(BacktestOutcomeEvidenceErrorV1::InvalidSemanticTraceComponent);
        }
        if self.canonical_result.schema_identity.as_str() != CANONICAL_RESULT_SCHEMA_V1 {
            return Err(BacktestOutcomeEvidenceErrorV1::InvalidCanonicalResultSchema);
        }
        if self.canonical_result.canonical_bytes_length == 0 {
            return Err(BacktestOutcomeEvidenceErrorV1::EmptyCanonicalResult);
        }
        Ok(())
    }

    fn compute_evidence_digest(&self) -> Result<CanonicalDigestV2, BacktestOutcomeEvidenceErrorV1> {
        #[derive(Serialize)]
        struct EvidenceDigestPreimageV1<'a> {
            schema_version: u16,
            result_identity: &'a OpaqueIdentityV2,
            result_digest: &'a CanonicalDigestV2,
            request_identity: &'a OpaqueIdentityV2,
            request_meaning_digest: &'a CanonicalDigestV2,
            attempt_identity: &'a OpaqueIdentityV2,
            frozen_research_intent: &'a ContentIdentityV2,
            trial_family_census_frontier: &'a ContentIdentityV2,
            semantic_trace: &'a ComponentObservationLocatorV2,
            canonical_result: &'a CanonicalResultBindingDtoV1,
        }

        let preimage = EvidenceDigestPreimageV1 {
            schema_version: self.schema_version,
            result_identity: &self.result_identity,
            result_digest: &self.result_digest,
            request_identity: &self.request_identity,
            request_meaning_digest: &self.request_meaning_digest,
            attempt_identity: &self.attempt_identity,
            frozen_research_intent: &self.frozen_research_intent,
            trial_family_census_frontier: &self.trial_family_census_frontier,
            semantic_trace: &self.semantic_trace,
            canonical_result: &self.canonical_result,
        };
        let bytes = serde_json::to_vec(&preimage).map_err(|error| encoding_error(&error))?;
        let mut hasher = blake3::Hasher::new();
        hasher.update(OUTCOME_EVIDENCE_DIGEST_DOMAIN_V1);
        hasher.update(&bytes);
        CanonicalDigestV2::try_from(format!("blake3:{}", hasher.finalize().to_hex()))
            .map_err(Into::into)
    }

    fn expected_evidence_identity(
        &self,
    ) -> Result<OpaqueIdentityV2, BacktestOutcomeEvidenceErrorV1> {
        let hex = self
            .evidence_digest
            .as_str()
            .strip_prefix("blake3:")
            .ok_or(BacktestOutcomeEvidenceErrorV1::EvidenceDigestMismatch)?;
        OpaqueIdentityV2::try_from(format!("{OUTCOME_EVIDENCE_IDENTITY_PREFIX_V1}{hex}"))
            .map_err(Into::into)
    }

    fn encode_unchecked(&self) -> Result<Vec<u8>, BacktestOutcomeEvidenceErrorV1> {
        serde_json::to_vec(self).map_err(|error| encoding_error(&error))
    }
}

/// Typed failures at the forgeable outcome-evidence wire boundary.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum BacktestOutcomeEvidenceErrorV1 {
    #[error("unsupported Backtest outcome-evidence schema: expected {expected}, received {actual}")]
    UnsupportedSchema { expected: u16, actual: u16 },
    #[error("Backtest outcome evidence must reference the SEMANTIC_TRACE component")]
    InvalidSemanticTraceComponent,
    #[error("Backtest outcome evidence has the wrong canonical-result schema")]
    InvalidCanonicalResultSchema,
    #[error("Backtest outcome evidence cannot bind empty canonical-result bytes")]
    EmptyCanonicalResult,
    #[error("Backtest outcome-evidence content digest does not match its canonical preimage")]
    EvidenceDigestMismatch,
    #[error("Backtest outcome-evidence identity does not match its content digest")]
    EvidenceIdentityMismatch,
    #[error("Backtest outcome-evidence encoding is invalid: {0}")]
    InvalidEncoding(String),
    #[error("Backtest outcome-evidence bytes are not canonical JSON")]
    NonCanonicalEncoding,
    #[error("Backtest outcome-evidence canonical encoding is unavailable: {0}")]
    CanonicalEncodingUnavailable(String),
    #[error(transparent)]
    ReplayContract(#[from] crate::ReplayContractErrorV2),
}

fn encoding_error(error: &serde_json::Error) -> BacktestOutcomeEvidenceErrorV1 {
    BacktestOutcomeEvidenceErrorV1::CanonicalEncodingUnavailable(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(value: &str) -> OpaqueIdentityV2 {
        OpaqueIdentityV2::try_from(value.to_owned()).expect("fixture identity must be valid")
    }

    fn digest(byte: char) -> CanonicalDigestV2 {
        CanonicalDigestV2::try_from(format!("blake3:{}", byte.to_string().repeat(64)))
            .expect("fixture digest must be valid")
    }

    fn content(name: &str, byte: char) -> ContentIdentityV2 {
        ContentIdentityV2 {
            identity: identity(name),
            digest: digest(byte),
        }
    }

    fn evidence() -> BacktestOutcomeEvidenceDtoV1 {
        BacktestOutcomeEvidenceDtoV1::from_bindings(BacktestOutcomeEvidenceBindingsV1 {
            result_identity: identity("backtest-replay-result-v2-result"),
            result_digest: digest('1'),
            request_identity: identity("request-1"),
            request_meaning_digest: digest('2'),
            attempt_identity: identity("attempt-1"),
            frozen_research_intent: content("intent-1", '3'),
            trial_family_census_frontier: content("census-1", '4'),
            semantic_trace: ComponentObservationLocatorV2 {
                component: ObservationComponentV2::SemanticTrace,
                reference: identity("semantic-trace-1"),
                digest: digest('5'),
            },
            canonical_result: CanonicalResultBindingDtoV1 {
                schema_identity: identity(CANONICAL_RESULT_SCHEMA_V1),
                canonical_bytes_digest: digest('6'),
                canonical_bytes_length: 4096,
            },
        })
        .expect("fixture evidence must be valid")
    }

    #[test]
    fn canonical_round_trip_is_stable_but_not_authoritative() {
        let evidence = evidence();
        let bytes = evidence.to_canonical_bytes().expect("fixture must encode");
        let decoded = BacktestOutcomeEvidenceDtoV1::from_canonical_bytes(&bytes)
            .expect("canonical fixture must decode");
        assert_eq!(decoded, evidence);
        assert_eq!(decoded.to_canonical_bytes().unwrap(), bytes);
    }

    #[test]
    fn changed_binding_without_new_content_digest_is_rejected() {
        let mut evidence = evidence();
        evidence.attempt_identity = identity("attempt-2");
        assert_eq!(
            evidence.validate(),
            Err(BacktestOutcomeEvidenceErrorV1::EvidenceDigestMismatch)
        );
    }

    #[test]
    fn tampered_digest_and_identity_are_rejected_independently() {
        let mut digest_tampered = evidence();
        digest_tampered.evidence_digest = digest('a');
        assert_eq!(
            digest_tampered.validate(),
            Err(BacktestOutcomeEvidenceErrorV1::EvidenceDigestMismatch)
        );

        let mut identity_tampered = evidence();
        identity_tampered.evidence_identity = identity("forged-evidence");
        assert_eq!(
            identity_tampered.validate(),
            Err(BacktestOutcomeEvidenceErrorV1::EvidenceIdentityMismatch)
        );
    }

    #[test]
    fn decoder_rejects_unknown_fields() {
        let bytes = evidence()
            .to_canonical_bytes()
            .expect("fixture must encode");
        let mut value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        value["unknown"] = serde_json::json!(true);
        assert!(matches!(
            BacktestOutcomeEvidenceDtoV1::from_canonical_bytes(
                &serde_json::to_vec(&value).unwrap()
            ),
            Err(BacktestOutcomeEvidenceErrorV1::InvalidEncoding(_))
        ));
    }

    #[test]
    fn zero_length_canonical_result_is_rejected() {
        let mut evidence = evidence();
        evidence.canonical_result.canonical_bytes_length = 0;
        assert_eq!(
            evidence.validate(),
            Err(BacktestOutcomeEvidenceErrorV1::EmptyCanonicalResult)
        );
    }

    #[test]
    fn wrong_semantic_trace_component_is_rejected() {
        let mut evidence = evidence();
        evidence.semantic_trace.component = ObservationComponentV2::Artifact;
        assert_eq!(
            evidence.validate(),
            Err(BacktestOutcomeEvidenceErrorV1::InvalidSemanticTraceComponent)
        );
    }
}
