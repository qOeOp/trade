use std::io::Write;

use serde::{Deserialize, Serialize};

use crate::receipt::{FormationFamilyDisposition, QualificationDisposition};

const STATUS_KIND: &str = "strategy-factory-research-status";

/// A read-only phase projection. It is never a qualification or execution authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResearchPhase {
    FormationNotAdmitted,
    FormationSoftwareRejected,
    FormationEconomicRejected,
    FormationRobustnessRejected,
    FormationSurvivorNotQualified,
    QualificationStateUnavailable,
    QualificationRejected,
    QualifiedNotLive,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SelectedFormationCandidate {
    parameter_id: String,
    variant_id: String,
    parameters_digest: String,
    strategy_artifact_digest: String,
}

impl SelectedFormationCandidate {
    pub(crate) fn new(
        parameter_id: String,
        variant_id: String,
        parameters_digest: String,
        strategy_artifact_digest: String,
    ) -> Self {
        Self {
            parameter_id,
            variant_id,
            parameters_digest,
            strategy_artifact_digest,
        }
    }

    pub fn parameter_id(&self) -> &str {
        &self.parameter_id
    }

    pub fn variant_id(&self) -> &str {
        &self.variant_id
    }

    pub fn parameters_digest(&self) -> &str {
        &self.parameters_digest
    }

    pub fn strategy_artifact_digest(&self) -> &str {
        &self.strategy_artifact_digest
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchEvidenceReference {
    id: String,
    locator: String,
    role: String,
}

impl ResearchEvidenceReference {
    pub(crate) fn new(id: String, locator: String, role: String) -> Self {
        Self { id, locator, role }
    }
}

/// A deterministic query projection rebuilt from an exact, run-derived formation receipt.
///
/// This value has no deserializer by design. Callers must recover it through the application API,
/// which reruns formation and verifies the exact receipt bytes before constructing this projection.
/// Its holdout field is explicitly historical: a formation receipt cannot prove whether a later
/// qualification attempt consumed the holdout.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchStatusSnapshot {
    schema_version: u32,
    kind: String,
    source_receipt_digest: String,
    experiment_id: String,
    research_intent_id: String,
    research_intent_digest: String,
    phase: ResearchPhase,
    formation_disposition: FormationFamilyDisposition,
    formation_partition: String,
    holdout_status_as_of_source_receipt: String,
    qualification_terminal_evidence: String,
    qualification_state_reason: Option<String>,
    qualification_disposition: Option<QualificationDisposition>,
    qualification_policy: String,
    selected_candidate: Option<SelectedFormationCandidate>,
    evidence: Vec<ResearchEvidenceReference>,
    non_claims: Vec<String>,
}

impl ResearchStatusSnapshot {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        source_receipt_digest: String,
        experiment_id: String,
        research_intent_id: String,
        research_intent_digest: String,
        phase: ResearchPhase,
        formation_disposition: FormationFamilyDisposition,
        formation_partition: String,
        holdout_status_as_of_source_receipt: String,
        qualification_policy: String,
        selected_candidate: Option<SelectedFormationCandidate>,
        evidence: Vec<ResearchEvidenceReference>,
        non_claims: Vec<String>,
    ) -> Self {
        Self {
            schema_version: 2,
            kind: STATUS_KIND.to_string(),
            source_receipt_digest,
            experiment_id,
            research_intent_id,
            research_intent_digest,
            phase,
            formation_disposition,
            formation_partition,
            holdout_status_as_of_source_receipt,
            qualification_terminal_evidence: "NOT_PROVIDED_TO_FORMATION_STATUS_RECOVERY"
                .to_string(),
            qualification_state_reason: None,
            qualification_disposition: None,
            qualification_policy,
            selected_candidate,
            evidence,
            non_claims,
        }
    }

    pub(crate) fn qualification_state_unavailable(mut self, reason: String) -> Self {
        self.phase = ResearchPhase::QualificationStateUnavailable;
        self.qualification_terminal_evidence =
            "UNAVAILABLE_NO_TRUSTED_TERMINAL_RECEIPT".to_string();
        self.qualification_state_reason = Some(reason);
        self.qualification_disposition = None;
        self
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn qualification_terminal(
        source_receipt_digest: String,
        experiment_id: String,
        research_intent_id: String,
        research_intent_digest: String,
        formation_disposition: FormationFamilyDisposition,
        disposition: QualificationDisposition,
        formation_partition: String,
        holdout_status_as_of_source_receipt: String,
        qualification_policy: String,
        selected_candidate: SelectedFormationCandidate,
        evidence: Vec<ResearchEvidenceReference>,
        non_claims: Vec<String>,
    ) -> Self {
        Self {
            schema_version: 2,
            kind: STATUS_KIND.to_string(),
            source_receipt_digest,
            experiment_id,
            research_intent_id,
            research_intent_digest,
            phase: match disposition {
                QualificationDisposition::QualificationRejected => {
                    ResearchPhase::QualificationRejected
                }
                QualificationDisposition::QualifiedNotLive => ResearchPhase::QualifiedNotLive,
            },
            formation_disposition,
            formation_partition,
            holdout_status_as_of_source_receipt,
            qualification_terminal_evidence: "VERIFIED_EXACT_TERMINAL_RECEIPT".to_string(),
            qualification_state_reason: None,
            qualification_disposition: Some(disposition),
            qualification_policy,
            selected_candidate: Some(selected_candidate),
            evidence,
            non_claims,
        }
    }

    pub const fn phase(&self) -> ResearchPhase {
        self.phase
    }

    pub const fn formation_disposition(&self) -> FormationFamilyDisposition {
        self.formation_disposition
    }

    pub const fn selected_candidate(&self) -> Option<&SelectedFormationCandidate> {
        self.selected_candidate.as_ref()
    }

    pub fn source_receipt_digest(&self) -> &str {
        &self.source_receipt_digest
    }

    pub fn to_bytes(&self) -> anyhow::Result<Vec<u8>> {
        let mut bytes = serde_json::to_vec(self)?;
        bytes.push(b'\n');
        Ok(bytes)
    }

    pub fn write_to(&self, mut writer: impl Write) -> anyhow::Result<()> {
        writer.write_all(&self.to_bytes()?)?;
        Ok(())
    }
}
