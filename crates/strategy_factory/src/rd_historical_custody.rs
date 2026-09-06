use async_trait::async_trait;
use serde::Serialize;
use thiserror::Error;

pub const RD_HISTORICAL_CUSTODY_OPERATION_V1: &str = "rd.historical_custody_quarantine.read.v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HistoricalCustodyCompletenessV1 {
    Complete,
    PartialTruncated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HistoricalCustodyProjectionStateV1 {
    PointReadRequired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HistoricalResearchCustodyCandidateV1 {
    pub request_identity: String,
    pub committed_at_epoch_ms: u64,
    pub projection_state: HistoricalCustodyProjectionStateV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HistoricalArtifactCustodyCandidateV1 {
    pub build_request_identity: String,
    pub attempt_identity: String,
    pub prepared_at_epoch_ms: u64,
    pub projection_state: HistoricalCustodyProjectionStateV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HistoricalBindingCustodyCandidateV1 {
    pub binding_identity: String,
    pub trial_family_identity: String,
    pub committed_at_epoch_ms: u64,
    pub projection_state: HistoricalCustodyProjectionStateV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HistoricalCustodyQuarantineV1 {
    pub schema_version: u32,
    pub operation: &'static str,
    pub completeness: HistoricalCustodyCompletenessV1,
    pub observed_at_epoch_ms: u64,
    pub research_total: u64,
    pub artifact_attempt_total: u64,
    pub binding_total: u64,
    pub research: Vec<HistoricalResearchCustodyCandidateV1>,
    pub artifact_attempts: Vec<HistoricalArtifactCustodyCandidateV1>,
    pub bindings: Vec<HistoricalBindingCustodyCandidateV1>,
}

#[derive(Debug, Error)]
pub enum HistoricalCustodyErrorV1 {
    #[error("R&D custody candidate directory unavailable: {0}")]
    Storage(String),
}

#[async_trait]
pub trait HistoricalCustodyOwnerPortV1: Send + Sync {
    async fn read_historical_custodies(
        &self,
    ) -> Result<HistoricalCustodyQuarantineV1, HistoricalCustodyErrorV1>;
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn wire_exposes_candidates_without_asserting_verified_history() {
        let value = serde_json::to_value(HistoricalCustodyQuarantineV1 {
            schema_version: 1,
            operation: RD_HISTORICAL_CUSTODY_OPERATION_V1,
            completeness: HistoricalCustodyCompletenessV1::Complete,
            observed_at_epoch_ms: 42,
            research_total: 1,
            artifact_attempt_total: 0,
            binding_total: 0,
            research: vec![HistoricalResearchCustodyCandidateV1 {
                request_identity: "research-request-v2-example".into(),
                committed_at_epoch_ms: 41,
                projection_state: HistoricalCustodyProjectionStateV1::PointReadRequired,
            }],
            artifact_attempts: Vec::new(),
            bindings: Vec::new(),
        })
        .unwrap();

        assert_eq!(value["operation"], RD_HISTORICAL_CUSTODY_OPERATION_V1);
        assert_eq!(
            value["research"][0]["projection_state"],
            "POINT_READ_REQUIRED"
        );
        assert!(value["research"][0].get("resolution").is_none());
        assert!(value["research"][0].get("disposition").is_none());
    }
}
