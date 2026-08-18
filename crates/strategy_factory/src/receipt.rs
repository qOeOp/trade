use std::{
    collections::{BTreeMap, BTreeSet},
    io::Write,
};

use anyhow::Context;
use serde::Serialize;
use vibe_backtest::result::CanonicalBacktestResult;

use crate::{
    artifact::StrategyArtifactIdentity,
    family::{FrozenFamilyReceiptBinding, FrozenStrategyFamily},
    producer::NativeProducerEvidence,
    status::{
        ResearchEvidenceReference, ResearchPhase, ResearchStatusSnapshot,
        SelectedFormationCandidate,
    },
};

const FORMATION_RECEIPT_KIND: &str = "strategy-factory-formation-family-receipt";
const PROGRAM_CONTROL_RECEIPT_KIND: &str =
    "strategy-factory-representative-program-software-control-receipt";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RepresentativeProgramControlReceiptIssuance<'a> {
    pub(crate) input_manifest_digests: BTreeMap<String, String>,
    pub(crate) source_counts: BTreeMap<String, usize>,
    pub(crate) artifact_identity: &'a StrategyArtifactIdentity,
    pub(crate) canonical_result: &'a [u8],
    pub(crate) decision_tags: &'a [u32],
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct RepresentativeProgramControlReceiptBody {
    schema_version: u32,
    kind: &'static str,
    disposition: &'static str,
    representative_intent_digest: String,
    input_manifest_digests: BTreeMap<String, String>,
    source_counts: BTreeMap<String, usize>,
    artifact_identity: StrategyArtifactIdentity,
    canonical_result_digest: String,
    decision_tags: Vec<u32>,
    non_claims: [&'static str; 13],
}

/// Proof that one complex multi-source Program traversed native owners. It is software evidence
/// only: never Formation, Qualification, economic/Alpha/holdout evidence, or live authority.
/// ```compile_fail
/// let _: vibe_strategy_factory::RepresentativeProgramControlReceipt =
///     serde_json::from_slice(b"{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RepresentativeProgramControlReceipt {
    body: RepresentativeProgramControlReceiptBody,
    receipt_digest: String,
}

impl RepresentativeProgramControlReceipt {
    pub(crate) fn issue(
        issuance: RepresentativeProgramControlReceiptIssuance<'_>,
    ) -> anyhow::Result<Self> {
        anyhow::ensure!(
            !issuance.artifact_identity.intent_digest.is_empty()
                && issuance
                    .input_manifest_digests
                    .keys()
                    .map(String::as_str)
                    .eq(["alfred", "market", "schedule"])
                && issuance
                    .input_manifest_digests
                    .values()
                    .all(|value| !value.is_empty())
                && issuance.source_counts.len() == 14
                && issuance.source_counts.values().all(|count| *count > 0)
                && issuance.artifact_identity.strategy_spec_digest.is_some()
                && issuance.artifact_identity.parameters_digest.is_some()
                && !issuance.canonical_result.is_empty()
                && !issuance.decision_tags.is_empty(),
            "representative Program software-control issuance is incomplete"
        );
        let body = RepresentativeProgramControlReceiptBody {
            schema_version: 1,
            kind: PROGRAM_CONTROL_RECEIPT_KIND,
            disposition: "SOFTWARE_ACCEPTED_NOT_FORMATION",
            representative_intent_digest: issuance.artifact_identity.intent_digest.clone(),
            input_manifest_digests: issuance.input_manifest_digests,
            source_counts: issuance.source_counts,
            artifact_identity: issuance.artifact_identity.clone(),
            canonical_result_digest: digest(issuance.canonical_result),
            decision_tags: issuance.decision_tags.to_vec(),
            non_claims: [
                "ALPHA",
                "AUTOMATED_CAPTURE_HTML_OR_HTTP_OWNER",
                "CONTEMPORANEOUS_2023_CLIENT_OBSERVATION",
                "ECONOMIC_VALIDITY",
                "EVENT_SURPRISE_OR_DIRECTIONAL_EFFECT",
                "FORMATION",
                "ONE_WAY_HOLDOUT",
                "PUBLISHER_ATTESTATION",
                "QUALIFICATION",
                "REDISTRIBUTION_OR_PRODUCTION_USE_LICENSE",
                "REVISION_AWARE_INTRADAY_MACRO_TIME",
                "LIVE_OR_EXECUTION_AUTHORITY",
                "REAL_TRADING",
            ],
        };
        let receipt_digest = digest(&serde_json::to_vec(&body)?);
        Ok(Self {
            body,
            receipt_digest,
        })
    }

    pub fn receipt_digest(&self) -> &str {
        &self.receipt_digest
    }

    pub fn to_bytes(&self) -> anyhow::Result<Vec<u8>> {
        let mut bytes = serde_json::to_vec(self)?;
        bytes.push(b'\n');
        Ok(bytes)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FormationFamilyDisposition {
    FormationNotAdmitted,
    SoftwareRejected,
    EconomicRejected,
    FormationRobustnessRejected,
    FormationSurvivorNotQualified,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FormationTrialDisposition {
    NotAttempted,
    SoftwareRejected,
    DeletionControl,
    EconomicRejected,
    FormationSurvivorNotQualified,
}

#[derive(Debug, Clone)]
pub(crate) struct FormationTrialProjection {
    pub(crate) outcome: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
pub(crate) struct FormationTrialEvidence<'a> {
    pub(crate) parameter_id: String,
    pub(crate) variant_id: String,
    pub(crate) parameters_digest: String,
    pub(crate) artifact_identity: &'a StrategyArtifactIdentity,
    pub(crate) canonical_result: Option<&'a CanonicalBacktestResult>,
    pub(crate) source_manifest_digest: Option<String>,
    pub(crate) source_counts: BTreeMap<String, usize>,
    pub(crate) projection: Option<FormationTrialProjection>,
    pub(crate) coverage: BTreeMap<String, usize>,
    pub(crate) software_error: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct OwnedFormationTrialEvidence {
    pub(crate) parameter_id: String,
    pub(crate) variant_id: String,
    pub(crate) parameters_digest: String,
    pub(crate) artifact_identity: StrategyArtifactIdentity,
    pub(crate) canonical_result: Option<CanonicalBacktestResult>,
    pub(crate) source_manifest_digest: Option<String>,
    pub(crate) source_counts: BTreeMap<String, usize>,
    pub(crate) projection: Option<FormationTrialProjection>,
    pub(crate) coverage: BTreeMap<String, usize>,
    pub(crate) software_error: Option<String>,
}

impl OwnedFormationTrialEvidence {
    pub(crate) fn bound(
        trial: &crate::family::StrategyTrial,
        artifact_identity: StrategyArtifactIdentity,
    ) -> Self {
        Self {
            parameter_id: trial.parameter_id().to_string(),
            variant_id: trial.variant_id().to_string(),
            parameters_digest: trial.parameters_digest().to_string(),
            artifact_identity,
            canonical_result: None,
            source_manifest_digest: None,
            source_counts: BTreeMap::new(),
            projection: None,
            coverage: BTreeMap::new(),
            software_error: None,
        }
    }

    pub(crate) fn failed(mut self, error: impl Into<String>) -> Self {
        self.software_error = Some(error.into());
        self
    }

    pub(crate) fn completed(
        mut self,
        canonical_result: CanonicalBacktestResult,
        source_manifest_digest: String,
        source_counts: BTreeMap<String, usize>,
        coverage: BTreeMap<String, usize>,
        projection: anyhow::Result<FormationTrialProjection>,
        projection_owner: &str,
    ) -> Self {
        self.canonical_result = Some(canonical_result);
        self.source_manifest_digest = Some(source_manifest_digest);
        self.source_counts = source_counts;
        self.coverage = coverage;

        match projection {
            Ok(value) => self.projection = Some(value),
            Err(e) => {
                self.software_error = Some(format!("{projection_owner} projection failed: {e:#}"));
            }
        }
        self
    }

    pub(crate) fn borrowed(&self) -> FormationTrialEvidence<'_> {
        FormationTrialEvidence {
            parameter_id: self.parameter_id.clone(),
            variant_id: self.variant_id.clone(),
            parameters_digest: self.parameters_digest.clone(),
            artifact_identity: &self.artifact_identity,
            canonical_result: self.canonical_result.as_ref(),
            source_manifest_digest: self.source_manifest_digest.clone(),
            source_counts: self.source_counts.clone(),
            projection: self.projection.clone(),
            coverage: self.coverage.clone(),
            software_error: self.software_error.clone(),
        }
    }

    #[cfg(test)]
    pub(crate) fn artifact_identity(&self) -> &StrategyArtifactIdentity {
        &self.artifact_identity
    }

    #[cfg(test)]
    pub(crate) fn software_error(&self) -> Option<&str> {
        self.software_error.as_deref()
    }
}

#[derive(Debug)]
pub(crate) struct OwnedFormationRun {
    pub(crate) producer_evidence: NativeProducerEvidence,
    pub(crate) trials: Vec<OwnedFormationTrialEvidence>,
    pub(crate) aggregate_coverage: BTreeMap<String, usize>,
    pub(crate) software_error: Option<String>,
}

impl OwnedFormationRun {
    pub(crate) fn finish(
        producer_evidence: NativeProducerEvidence,
        trials: Vec<OwnedFormationTrialEvidence>,
        aggregate_coverage: BTreeMap<String, usize>,
        software_error: Option<String>,
    ) -> Self {
        let software_error = software_error.or_else(|| {
            (!producer_evidence.allows_test_or_attested_execution())
                .then(|| producer_evidence.rejection_error())
        });
        Self {
            producer_evidence,
            trials,
            aggregate_coverage,
            software_error,
        }
    }

    pub(crate) fn producer_is_verified(&self) -> bool {
        self.producer_evidence.is_verified()
    }

    #[cfg(test)]
    pub(crate) fn trials(&self) -> &[OwnedFormationTrialEvidence] {
        &self.trials
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FormationRobustnessProjection {
    pub(crate) passed: bool,
    pub(crate) diagnostics: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FormationTrialSelection {
    pub(crate) parameter_id: String,
    pub(crate) variant_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
/// Family-owned projection into the existing v9 receipt codec.
///
/// The common receipt owner treats these fields as opaque codec material. Economic rules,
/// counterfactual relationships, selection, and robustness semantics remain in the frozen family
/// evaluator.
pub(crate) struct FormationProjectionV9 {
    pub(crate) family_disposition: FormationFamilyDisposition,
    pub(crate) trial_dispositions: Vec<FormationTrialDisposition>,
    pub(crate) economically_selected: Option<FormationTrialSelection>,
    pub(crate) selected: Option<FormationTrialSelection>,
    pub(crate) robustness: Option<FormationRobustnessProjection>,
    pub(crate) robustness_error: Option<String>,
}

pub(crate) struct FormationReceiptIssuance<'a> {
    pub(crate) experiment_id: String,
    pub(crate) research_intent_id: String,
    pub(crate) research_intent_digest: String,
    pub(crate) family: FrozenStrategyFamily,
    pub(crate) predecessor_intent_digest: String,
    pub(crate) predecessor_disposition: String,
    pub(crate) predecessor_reason: String,
    pub(crate) native_producer_evidence: Option<&'a NativeProducerEvidence>,
    pub(crate) formation_admission_reason: Option<String>,
    pub(crate) evidence_boundary: FormationEvidenceBoundary,
    pub(crate) software_error: Option<String>,
    pub(crate) trials: Vec<FormationTrialEvidence<'a>>,
    pub(crate) aggregate_coverage: BTreeMap<String, usize>,
    pub(crate) evidence: Vec<ResearchEvidenceReference>,
    pub(crate) non_claims: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum FormationEvidenceBoundary {
    SealedHoldout {
        partition: String,
        qualification_policy: String,
    },
    TerminalRetrospective {
        partition: String,
        snapshot_semantics: String,
        reason: String,
    },
}

impl FormationEvidenceBoundary {
    fn receipt_fields(&self) -> anyhow::Result<(&str, String, String)> {
        let fields = match self {
            Self::SealedHoldout {
                partition,
                qualification_policy,
            } => (
                partition.as_str(),
                "SEALED_NOT_READ_AS_OF_FORMATION_RECEIPT".to_string(),
                qualification_policy.clone(),
            ),
            Self::TerminalRetrospective {
                partition,
                snapshot_semantics,
                reason,
            } => (
                partition.as_str(),
                format!("NOT_RESERVED_RETROSPECTIVE_VALIDATION_CONSUMED:{snapshot_semantics}"),
                format!("NOT_ELIGIBLE_NO_RESERVED_ONE_WAY_HOLDOUT:{reason}"),
            ),
        };
        anyhow::ensure!(
            !fields.0.is_empty() && !fields.1.is_empty() && !fields.2.is_empty(),
            "formation evidence boundary is incomplete"
        );
        Ok(fields)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct FormationTrialReceiptBody {
    parameter_id: String,
    variant_id: String,
    parameters_digest: Option<String>,
    strategy_artifact_digest: Option<String>,
    source_manifest_digest: Option<String>,
    canonical_result_digest: Option<String>,
    source_counts: BTreeMap<String, usize>,
    outcome: Option<BTreeMap<String, String>>,
    software_disposition: String,
    software_error: Option<String>,
    economic_disposition: FormationTrialDisposition,
    coverage: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct FormationFamilyReceiptBody {
    schema_version: u32,
    kind: String,
    experiment_id: String,
    research_intent_id: String,
    research_intent_digest: String,
    family_digest: String,
    formation_evaluator_digest: String,
    predecessor_intent_digest: String,
    predecessor_disposition: String,
    predecessor_reason: String,
    native_producer_evidence: Option<NativeProducerEvidence>,
    formation_admission_reason: Option<String>,
    native_result_schema: Option<String>,
    partition: String,
    selection_policy: String,
    holdout_status: String,
    qualification_policy: String,
    software_error: Option<String>,
    robustness_error: Option<String>,
    family_disposition: FormationFamilyDisposition,
    economically_selected_parameter_id: Option<String>,
    economically_selected_variant_id: Option<String>,
    selected_parameter_id: Option<String>,
    selected_variant_id: Option<String>,
    formation_robustness: Option<FormationRobustnessProjection>,
    trials: Vec<FormationTrialReceiptBody>,
    aggregate_coverage: BTreeMap<String, usize>,
    evidence: Vec<ResearchEvidenceReference>,
    non_claims: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FormationFamilyReceipt {
    body: FormationFamilyReceiptBody,
    receipt_digest: String,
}

impl FormationFamilyReceipt {
    /// Issues one deterministic family receipt from shape-neutral, owner-validated evidence.
    pub(crate) fn issue(issuance: &FormationReceiptIssuance<'_>) -> anyhow::Result<Self> {
        let family_binding = issuance.family.receipt_binding()?;
        validate_formation_issuance(issuance, &family_binding)?;
        let formation_admitted = issuance.formation_admission_reason.is_none();
        let common_software_failed = formation_admitted
            && (!issuance
                .native_producer_evidence
                .is_some_and(NativeProducerEvidence::allows_test_or_attested_execution)
                || issuance.software_error.is_some()
                || issuance
                    .trials
                    .iter()
                    .any(|trial| trial.software_error.is_some()));
        let evaluation_result = if !formation_admitted {
            Ok(None)
        } else if common_software_failed {
            Ok(Some(FormationProjectionV9 {
                family_disposition: FormationFamilyDisposition::SoftwareRejected,
                trial_dispositions: vec![
                    FormationTrialDisposition::SoftwareRejected;
                    issuance.trials.len()
                ],
                economically_selected: None,
                selected: None,
                robustness: None,
                robustness_error: None,
            }))
        } else {
            issuance
                .family
                .evaluate_formation(&issuance.trials)
                .map(Some)
        };
        let (evaluation, evaluation_error) = match evaluation_result {
            Ok(value) => (value, None),
            Err(e) => (None, Some(format!("formation evaluator failed: {e:#}"))),
        };

        if let Some(evaluation) = &evaluation {
            validate_formation_evaluation(issuance, &family_binding, evaluation)?;
        }
        let trials = issuance
            .trials
            .iter()
            .enumerate()
            .map(|trial| {
                let (index, trial) = trial;
                if !formation_admitted {
                    not_attempted_formation_trial_body(trial)
                } else if let Some(error) = &trial.software_error {
                    failed_formation_trial_body(trial, error.clone())
                } else {
                    let disposition = evaluation
                        .as_ref()
                        .and_then(|value| value.trial_dispositions.get(index))
                        .copied()
                        .unwrap_or(FormationTrialDisposition::SoftwareRejected);
                    completed_formation_trial_body(
                        trial,
                        &issuance.research_intent_digest,
                        disposition,
                    )
                    .unwrap_or_else(|e| {
                        failed_formation_trial_body(
                            trial,
                            format!("receipt derivation failed: {e:#}"),
                        )
                    })
                }
            })
            .collect::<Vec<_>>();
        let has_software_failure = formation_admitted
            && (!issuance
                .native_producer_evidence
                .is_some_and(NativeProducerEvidence::allows_test_or_attested_execution)
                || issuance.software_error.is_some()
                || evaluation_error.is_some()
                || trials
                    .iter()
                    .any(|trial| trial.software_disposition != "ACCEPTED"));
        let economically_selected = (!has_software_failure)
            .then(|| {
                evaluation
                    .as_ref()
                    .and_then(|value| value.economically_selected.clone())
            })
            .flatten();
        let selected = (!has_software_failure)
            .then(|| evaluation.as_ref().and_then(|value| value.selected.clone()))
            .flatten();
        let economically_selected_parameter_id = economically_selected
            .as_ref()
            .map(|coordinate| coordinate.parameter_id.clone());
        let economically_selected_variant_id = economically_selected
            .as_ref()
            .map(|coordinate| coordinate.variant_id.clone());
        let selected_parameter_id = selected
            .as_ref()
            .map(|coordinate| coordinate.parameter_id.clone());
        let selected_variant_id = selected
            .as_ref()
            .map(|coordinate| coordinate.variant_id.clone());
        let formation_robustness = (!has_software_failure)
            .then(|| {
                evaluation
                    .as_ref()
                    .and_then(|value| value.robustness.clone())
            })
            .flatten();
        let robustness_error = (!has_software_failure)
            .then(|| {
                evaluation
                    .as_ref()
                    .and_then(|value| value.robustness_error.clone())
            })
            .flatten();
        let family_disposition = if !formation_admitted {
            FormationFamilyDisposition::FormationNotAdmitted
        } else if has_software_failure {
            FormationFamilyDisposition::SoftwareRejected
        } else {
            evaluation
                .as_ref()
                .context("admitted formation has no family evaluator projection")?
                .family_disposition
        };
        let (partition, holdout_status, qualification_policy) =
            issuance.evidence_boundary.receipt_fields()?;
        let body = FormationFamilyReceiptBody {
            schema_version: 9,
            kind: FORMATION_RECEIPT_KIND.to_string(),
            experiment_id: issuance.experiment_id.clone(),
            research_intent_id: issuance.research_intent_id.clone(),
            research_intent_digest: issuance.research_intent_digest.clone(),
            family_digest: family_binding.family_digest().to_string(),
            formation_evaluator_digest: family_binding.evaluator_digest().to_string(),
            predecessor_intent_digest: issuance.predecessor_intent_digest.clone(),
            predecessor_disposition: issuance.predecessor_disposition.clone(),
            predecessor_reason: issuance.predecessor_reason.clone(),
            native_producer_evidence: issuance.native_producer_evidence.cloned(),
            formation_admission_reason: issuance.formation_admission_reason.clone(),
            native_result_schema: formation_admitted.then(|| "vibe-backtest-result/v1".to_string()),
            partition: partition.to_string(),
            selection_policy: family_binding.selection_policy().to_string(),
            holdout_status,
            qualification_policy,
            software_error: issuance.software_error.clone().or(evaluation_error),
            robustness_error,
            family_disposition,
            economically_selected_parameter_id,
            economically_selected_variant_id,
            selected_parameter_id,
            selected_variant_id,
            formation_robustness,
            trials,
            aggregate_coverage: issuance.aggregate_coverage.clone(),
            evidence: issuance.evidence.clone(),
            non_claims: issuance.non_claims.clone(),
        };
        Ok(Self {
            receipt_digest: digest(&serde_json::to_vec(&body)?),
            body,
        })
    }

    pub(crate) fn from_slice(
        bytes: &[u8],
        issuance: &FormationReceiptIssuance<'_>,
    ) -> anyhow::Result<Self> {
        let expected = Self::issue(issuance)?;
        validate_formation_canonical_bytes(bytes, &expected)?;
        Ok(expected)
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

    pub const fn disposition(&self) -> FormationFamilyDisposition {
        self.body.family_disposition
    }

    pub fn formation_admission_reason(&self) -> Option<&str> {
        self.body.formation_admission_reason.as_deref()
    }

    pub fn trial_count(&self) -> usize {
        self.body.trials.len()
    }

    pub fn selected_parameter_id(&self) -> Option<&str> {
        self.body.selected_parameter_id.as_deref()
    }

    pub fn selected_variant_id(&self) -> Option<&str> {
        self.body.selected_variant_id.as_deref()
    }

    /// Returns the parameter coordinate chosen by the adapter's economic/deletion selector before the auxiliary
    /// robustness gate. This is evidence, not qualification eligibility.
    pub fn economically_selected_parameter_id(&self) -> Option<&str> {
        self.body.economically_selected_parameter_id.as_deref()
    }

    /// Returns the adapter-defined robustness decision without prescribing its statistical test.
    pub fn formation_robustness_passed(&self) -> Option<bool> {
        self.body
            .formation_robustness
            .as_ref()
            .map(|projection| projection.passed)
    }

    /// Returns the frozen adapter's named diagnostics as receipt evidence, never qualification.
    pub fn formation_robustness_diagnostics(&self) -> Option<&BTreeMap<String, String>> {
        self.body
            .formation_robustness
            .as_ref()
            .map(|projection| &projection.diagnostics)
    }

    pub fn receipt_digest(&self) -> &str {
        &self.receipt_digest
    }

    /// Projects an upper-layer query view from this already run-derived receipt.
    pub(crate) fn status(&self) -> anyhow::Result<ResearchStatusSnapshot> {
        let phase = match self.body.family_disposition {
            FormationFamilyDisposition::FormationNotAdmitted => ResearchPhase::FormationNotAdmitted,
            FormationFamilyDisposition::SoftwareRejected => {
                ResearchPhase::FormationSoftwareRejected
            }
            FormationFamilyDisposition::EconomicRejected => {
                ResearchPhase::FormationEconomicRejected
            }
            FormationFamilyDisposition::FormationRobustnessRejected => {
                ResearchPhase::FormationRobustnessRejected
            }
            FormationFamilyDisposition::FormationSurvivorNotQualified => {
                ResearchPhase::FormationSurvivorNotQualified
            }
        };
        let selected_candidate = match (
            self.body.selected_parameter_id.as_deref(),
            self.body.selected_variant_id.as_deref(),
        ) {
            (None, None) => None,
            (Some(parameter_id), Some(variant_id)) => {
                let selected = self
                    .body
                    .trials
                    .iter()
                    .find(|trial| {
                        trial.parameter_id == parameter_id
                            && trial.variant_id == variant_id
                            && trial.economic_disposition
                                == FormationTrialDisposition::FormationSurvivorNotQualified
                    })
                    .context("selected formation parameter has no surviving candidate trial")?;
                anyhow::ensure!(
                    selected.economic_disposition
                        == FormationTrialDisposition::FormationSurvivorNotQualified,
                    "selected formation parameter is not a survivor"
                );
                Some(SelectedFormationCandidate::new(
                    parameter_id.to_string(),
                    variant_id.to_string(),
                    selected
                        .parameters_digest
                        .clone()
                        .context("selected formation parameter has no parameters digest")?,
                    selected
                        .strategy_artifact_digest
                        .clone()
                        .context("selected formation parameter has no artifact digest")?,
                ))
            }
            _ => anyhow::bail!("selected formation coordinate is incomplete"),
        };
        anyhow::ensure!(
            selected_candidate.is_some()
                == matches!(phase, ResearchPhase::FormationSurvivorNotQualified),
            "formation disposition and selected parameter disagree"
        );

        Ok(ResearchStatusSnapshot::new(
            self.receipt_digest.clone(),
            self.body.experiment_id.clone(),
            self.body.research_intent_id.clone(),
            self.body.research_intent_digest.clone(),
            phase,
            self.body.family_disposition,
            self.body.partition.clone(),
            self.body.holdout_status.clone(),
            self.body.qualification_policy.clone(),
            selected_candidate,
            self.body.evidence.clone(),
            self.body.non_claims.clone(),
        ))
    }
}

fn validate_formation_issuance(
    issuance: &FormationReceiptIssuance<'_>,
    family_binding: &FrozenFamilyReceiptBinding,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        !issuance.experiment_id.is_empty()
            && !issuance.research_intent_id.is_empty()
            && issuance.research_intent_digest.starts_with("blake3:")
            && !issuance.trials.is_empty(),
        "formation issuance identity or bounded family is incomplete"
    );
    anyhow::ensure!(
        family_binding.intent_digest() == issuance.research_intent_digest
            && family_binding.len() == issuance.trials.len()
            && issuance.trials.iter().enumerate().all(|(index, trial)| {
                family_binding.matches_coordinate(
                    index,
                    &trial.parameter_id,
                    &trial.variant_id,
                    &trial.parameters_digest,
                    &trial.artifact_identity.artifact_digest,
                )
            }),
        "formation issuance does not bind the complete frozen family"
    );
    let mut trial_ids = BTreeSet::new();

    for trial in &issuance.trials {
        let trial_id = format!("{}/{}", trial.parameter_id, trial.variant_id);
        anyhow::ensure!(
            trial_ids.insert(trial_id.clone())
                && trial.artifact_identity.intent_digest == issuance.research_intent_digest
                && trial.artifact_identity.trial_id.as_deref() == Some(trial_id.as_str())
                && trial.artifact_identity.parameters_digest.as_deref()
                    == Some(trial.parameters_digest.as_str()),
            "formation trial does not bind its frozen family coordinate"
        );
    }

    anyhow::ensure!(
        issuance.formation_admission_reason.is_none()
            && issuance.native_producer_evidence.is_some()
            && issuance
                .trials
                .iter()
                .all(|trial| trial.projection.is_some() || trial.software_error.is_some()),
        "formation issuance is missing owner evidence or policy"
    );
    Ok(())
}

fn validate_formation_evaluation(
    issuance: &FormationReceiptIssuance<'_>,
    _family_binding: &FrozenFamilyReceiptBinding,
    evaluation: &FormationProjectionV9,
) -> anyhow::Result<()> {
    let software_failed = !issuance
        .native_producer_evidence
        .is_some_and(NativeProducerEvidence::allows_test_or_attested_execution)
        || issuance.software_error.is_some()
        || issuance
            .trials
            .iter()
            .any(|trial| trial.software_error.is_some());

    if software_failed {
        anyhow::ensure!(
            evaluation.family_disposition == FormationFamilyDisposition::SoftwareRejected
                && evaluation.trial_dispositions.len() == issuance.trials.len()
                && evaluation
                    .trial_dispositions
                    .iter()
                    .all(|value| *value == FormationTrialDisposition::SoftwareRejected)
                && evaluation.economically_selected.is_none()
                && evaluation.selected.is_none()
                && evaluation.robustness.is_none()
                && evaluation.robustness_error.is_none(),
            "software-rejected formation cannot retain adapter selection authority"
        );
        return Ok(());
    }

    if let Some(robustness) = &evaluation.robustness {
        anyhow::ensure!(
            !robustness.diagnostics.is_empty()
                && robustness
                    .diagnostics
                    .iter()
                    .all(|(name, value)| !name.is_empty() && !value.is_empty()),
            "adapter robustness projection is incomplete"
        );
    }

    anyhow::ensure!(
        !matches!(
            evaluation.family_disposition,
            FormationFamilyDisposition::FormationNotAdmitted
                | FormationFamilyDisposition::SoftwareRejected
        ) && evaluation.trial_dispositions.len() == issuance.trials.len()
            && evaluation.trial_dispositions.iter().all(|disposition| {
                !matches!(
                    disposition,
                    FormationTrialDisposition::NotAttempted
                        | FormationTrialDisposition::SoftwareRejected
                )
            }),
        "family-bound evaluator returned an invalid admitted v9 projection"
    );
    let coordinate_exists = |selection: &FormationTrialSelection| {
        issuance.trials.iter().any(|trial| {
            trial.parameter_id == selection.parameter_id && trial.variant_id == selection.variant_id
        })
    };
    anyhow::ensure!(
        evaluation
            .economically_selected
            .as_ref()
            .is_none_or(&coordinate_exists)
            && evaluation.selected.as_ref().is_none_or(&coordinate_exists),
        "family evaluator selected a coordinate outside the frozen family"
    );
    Ok(())
}

fn completed_formation_trial_body(
    trial: &FormationTrialEvidence<'_>,
    intent_digest: &str,
    economic_disposition: FormationTrialDisposition,
) -> anyhow::Result<FormationTrialReceiptBody> {
    let artifact = trial.artifact_identity;
    let expected_trial_id = format!("{}/{}", trial.parameter_id, trial.variant_id);
    anyhow::ensure!(
        artifact.intent_digest == intent_digest
            && artifact.trial_id.as_deref() == Some(expected_trial_id.as_str()),
        "formation artifact does not bind intent, parameter, and deletion variant"
    );
    anyhow::ensure!(
        artifact.parameters_digest.as_deref() == Some(trial.parameters_digest.as_str()),
        "formation artifact changed the frozen parameter digest"
    );
    let canonical_result = trial
        .canonical_result
        .context("completed formation trial has no canonical result")?;
    let document = canonical_result.as_value();
    anyhow::ensure!(
        document.get("schema").and_then(serde_json::Value::as_str)
            == Some("vibe-backtest-result/v1"),
        "formation canonical result schema mismatch"
    );
    let projection = trial
        .projection
        .as_ref()
        .context("completed formation trial has no adapter projection")?;
    anyhow::ensure!(
        !trial.source_counts.is_empty() && trial.source_counts.keys().all(|name| !name.is_empty()),
        "formation adapter source counts are incomplete"
    );
    anyhow::ensure!(
        !projection.outcome.is_empty()
            && projection
                .outcome
                .iter()
                .all(|(name, value)| !name.is_empty() && !value.is_empty()),
        "formation adapter projection is incomplete"
    );
    Ok(FormationTrialReceiptBody {
        parameter_id: trial.parameter_id.clone(),
        variant_id: trial.variant_id.clone(),
        parameters_digest: Some(trial.parameters_digest.clone()),
        strategy_artifact_digest: Some(artifact.artifact_digest.clone()),
        source_manifest_digest: Some(
            trial
                .source_manifest_digest
                .as_deref()
                .context("completed formation trial has no source manifest")?
                .to_string(),
        ),
        canonical_result_digest: Some(canonical_result.digest()?),
        source_counts: trial.source_counts.clone(),
        outcome: Some(projection.outcome.clone()),
        software_disposition: "ACCEPTED".to_string(),
        software_error: None,
        economic_disposition,
        coverage: trial.coverage.clone(),
    })
}

fn failed_formation_trial_body(
    trial: &FormationTrialEvidence<'_>,
    error: String,
) -> FormationTrialReceiptBody {
    FormationTrialReceiptBody {
        parameter_id: trial.parameter_id.clone(),
        variant_id: trial.variant_id.clone(),
        parameters_digest: Some(trial.parameters_digest.clone()),
        strategy_artifact_digest: Some(trial.artifact_identity.artifact_digest.clone()),
        source_manifest_digest: trial.source_manifest_digest.clone(),
        canonical_result_digest: trial
            .canonical_result
            .and_then(|result| result.digest().ok()),
        source_counts: trial.source_counts.clone(),
        outcome: None,
        software_disposition: "REJECTED".to_string(),
        software_error: Some(error),
        economic_disposition: FormationTrialDisposition::SoftwareRejected,
        coverage: trial.coverage.clone(),
    }
}

fn not_attempted_formation_trial_body(
    trial: &FormationTrialEvidence<'_>,
) -> FormationTrialReceiptBody {
    FormationTrialReceiptBody {
        parameter_id: trial.parameter_id.clone(),
        variant_id: trial.variant_id.clone(),
        parameters_digest: Some(trial.parameters_digest.clone()),
        strategy_artifact_digest: Some(trial.artifact_identity.artifact_digest.clone()),
        source_manifest_digest: None,
        canonical_result_digest: None,
        source_counts: BTreeMap::new(),
        outcome: None,
        software_disposition: "NOT_ATTEMPTED".to_string(),
        software_error: None,
        economic_disposition: FormationTrialDisposition::NotAttempted,
        coverage: trial.coverage.clone(),
    }
}

fn digest(bytes: &[u8]) -> String {
    format!("blake3:{}", blake3::hash(bytes).to_hex())
}

fn validate_formation_canonical_bytes(
    bytes: &[u8],
    expected: &FormationFamilyReceipt,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        expected.to_bytes()? == bytes,
        "formation family receipt does not match the complete run"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use rstest::rstest;

    use super::*;
    use crate::{
        artifact::ArtifactIssuance,
        experiment::PriceOnlyResearchIntent,
        family::{
            FormationEvaluator, FrozenFamilyDefinition, FrozenStrategyFamily, StrategyFamilyError,
        },
        formation_adapters::ComplexDecisionCoverage,
    };

    fn sample_formation_trial(
        parameter_id: &str,
        variant_id: &str,
        objective: &str,
        disposition: FormationTrialDisposition,
    ) -> FormationTrialReceiptBody {
        FormationTrialReceiptBody {
            parameter_id: parameter_id.to_string(),
            variant_id: variant_id.to_string(),
            parameters_digest: Some(format!("blake3:parameters-{parameter_id}-{variant_id}")),
            strategy_artifact_digest: Some(format!("blake3:artifact-{parameter_id}-{variant_id}")),
            source_manifest_digest: Some("blake3:source".to_string()),
            canonical_result_digest: Some(format!("blake3:result-{parameter_id}-{variant_id}")),
            source_counts: BTreeMap::from([
                (
                    "source_events".to_string(),
                    FORMATION_ACTUAL_EVENTS_FOR_TEST,
                ),
                (
                    "executable_bars".to_string(),
                    FORMATION_EXECUTABLE_BARS_FOR_TEST,
                ),
            ]),
            outcome: Some(BTreeMap::from([
                ("objective".to_string(), objective.to_string()),
                ("terminal_state".to_string(), "FLAT".to_string()),
            ])),
            software_disposition: "ACCEPTED".to_string(),
            software_error: None,
            economic_disposition: disposition,
            coverage: ComplexDecisionCoverage {
                enter_trend: 1,
                enter_reversal: 1,
                exit_trailing: 1,
                exit_channel: 1,
                exit_regime: 1,
                exit_terminal: 0,
            }
            .as_counts(),
        }
    }

    fn sample_formation_receipt() -> FormationFamilyReceipt {
        let frozen = PriceOnlyResearchIntent::frozen().unwrap();
        let intent_digest = format!("blake3:{}", blake3::hash(frozen.canonical_bytes()).to_hex());
        let producer_evidence = crate::producer::verify_native_producer(
            crate::NativeProducerVerificationRequest::from_bundle(
                "/definitely/not/a/strategy-factory-attestation-bundle",
            ),
        );
        let producer_error = producer_evidence.rejection_error();
        let body = FormationFamilyReceiptBody {
            schema_version: 9,
            kind: FORMATION_RECEIPT_KIND.to_string(),
            experiment_id: frozen.payload.experiment_id.clone(),
            research_intent_id: frozen.identity,
            research_intent_digest: intent_digest,
            family_digest: crate::FrozenStrategyFamily::frozen_price_only()
                .unwrap()
                .family_digest()
                .to_string(),
            formation_evaluator_digest: crate::FrozenStrategyFamily::frozen_price_only()
                .unwrap()
                .receipt_binding()
                .unwrap()
                .evaluator_digest()
                .to_string(),
            predecessor_intent_digest: frozen.payload.predecessor.intent_digest,
            predecessor_disposition: frozen.payload.predecessor.disposition,
            predecessor_reason: frozen.payload.predecessor.reason,
            native_producer_evidence: Some(producer_evidence),
            formation_admission_reason: None,
            native_result_schema: Some("vibe-backtest-result/v1".to_string()),
            partition: "FORMATION_2023_ONLY".to_string(),
            selection_policy: frozen.payload.family.selection.clone(),
            holdout_status: "SEALED_NOT_READ_AS_OF_FORMATION_RECEIPT".to_string(),
            qualification_policy: frozen.payload.family.holdout_access.clone(),
            software_error: Some(producer_error),
            robustness_error: None,
            family_disposition: FormationFamilyDisposition::SoftwareRejected,
            economically_selected_parameter_id: None,
            economically_selected_variant_id: None,
            selected_parameter_id: None,
            selected_variant_id: None,
            formation_robustness: None,
            trials: vec![sample_formation_trial(
                "tuple-001",
                "full",
                "1.00000000 USDT",
                FormationTrialDisposition::FormationSurvivorNotQualified,
            )],
            aggregate_coverage: ComplexDecisionCoverage::default().as_counts(),
            evidence: frozen
                .payload
                .evidence
                .iter()
                .map(|item| {
                    ResearchEvidenceReference::new(
                        item.id.clone(),
                        item.locator.clone(),
                        item.role.clone(),
                    )
                })
                .collect(),
            non_claims: frozen.payload.non_claims,
        };
        FormationFamilyReceipt {
            receipt_digest: digest(&serde_json::to_vec(&body).unwrap()),
            body,
        }
    }

    const FORMATION_ACTUAL_EVENTS_FOR_TEST: usize = 8_759;
    const FORMATION_EXECUTABLE_BARS_FOR_TEST: usize = 8_758;

    fn empty_canonical_result() -> CanonicalBacktestResult {
        let document = serde_json::json!({
            "accounts": [],
            "components": {
                "actor_ids": [],
                "exec_algorithm_ids": [],
                "strategy_ids": [],
                "trader_state": "STOPPED"
            },
            "diagnostics": [],
            "fills": [],
            "orders": [],
            "portfolio_snapshots": [],
            "position_snapshots": [],
            "positions": [],
            "run": {
                "backtest_end_ns": "2",
                "backtest_start_ns": "1",
                "iterations": "1",
                "outcome": "completed",
                "run_config_id": null,
                "total_events": "0",
                "total_orders": "0",
                "total_positions": "0",
                "trader_id": "TRADER-001"
            },
            "schema": "vibe-backtest-result/v1",
            "statistics": {
                "general": {},
                "pnls": {},
                "returns": {},
                "returns_series": []
            },
            "summary": {}
        });
        CanonicalBacktestResult::from_slice(&serde_json::to_vec(&document).unwrap()).unwrap()
    }

    #[rstest]
    fn formation_receipt_parser_rejects_tamper_and_noncanonical_bytes() {
        let receipt = sample_formation_receipt();
        let bytes = receipt.to_bytes().unwrap();
        assert!(validate_formation_canonical_bytes(&bytes, &receipt).is_ok());

        let mut tampered: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        tampered["body"]["holdout_status"] = "READ".into();
        assert!(
            validate_formation_canonical_bytes(&serde_json::to_vec(&tampered).unwrap(), &receipt)
                .is_err()
        );

        let mut tampered_producer: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        tampered_producer["body"]["native_producer_evidence"]["error_code"] =
            "VERIFICATION_ACCEPTED".into();
        assert!(
            validate_formation_canonical_bytes(
                &serde_json::to_vec(&tampered_producer).unwrap(),
                &receipt,
            )
            .is_err()
        );

        let reordered = format!(
            "{{\"receipt_digest\":{},\"body\":{}}}",
            serde_json::to_string(&receipt.receipt_digest).unwrap(),
            serde_json::to_string(&receipt.body).unwrap()
        );
        assert!(validate_formation_canonical_bytes(reordered.as_bytes(), &receipt).is_err());

        let mut self_consistent_forgery: serde_json::Value =
            serde_json::from_slice(&bytes).unwrap();
        self_consistent_forgery["body"]["holdout_status"] = "READ".into();
        self_consistent_forgery["receipt_digest"] =
            digest(&serde_json::to_vec(&self_consistent_forgery["body"]).unwrap()).into();
        let mut forged = serde_json::to_vec(&self_consistent_forgery).unwrap();
        forged.push(b'\n');
        assert!(validate_formation_canonical_bytes(&forged, &receipt).is_err());
    }

    #[rstest]
    fn research_status_is_deterministic_and_carries_no_qualification_authority() {
        let rejected = sample_formation_receipt();
        let first = rejected.status().unwrap();
        let second = rejected.status().unwrap();
        assert_eq!(first, second);
        assert_eq!(first.to_bytes().unwrap(), second.to_bytes().unwrap());
        assert_eq!(first.phase(), ResearchPhase::FormationSoftwareRejected);
        assert!(first.selected_candidate().is_none());
        assert_eq!(first.source_receipt_digest(), rejected.receipt_digest());

        let mut robustness_rejected = rejected.clone();
        robustness_rejected.body.family_disposition =
            FormationFamilyDisposition::FormationRobustnessRejected;
        robustness_rejected.body.economically_selected_parameter_id = Some("tuple-001".to_string());
        robustness_rejected.body.economically_selected_variant_id = Some("full".to_string());
        robustness_rejected.body.software_error = None;
        robustness_rejected.receipt_digest =
            digest(&serde_json::to_vec(&robustness_rejected.body).unwrap());
        let status = robustness_rejected.status().unwrap();
        assert_eq!(status.phase(), ResearchPhase::FormationRobustnessRejected);
        assert!(status.selected_candidate().is_none());

        let mut survivor = rejected;
        survivor.body.family_disposition =
            FormationFamilyDisposition::FormationSurvivorNotQualified;
        survivor.body.economically_selected_parameter_id = Some("tuple-001".to_string());
        survivor.body.economically_selected_variant_id = Some("full".to_string());
        survivor.body.selected_parameter_id = Some("tuple-001".to_string());
        survivor.body.selected_variant_id = Some("full".to_string());
        survivor.body.software_error = None;
        survivor.body.trials[0].economic_disposition =
            FormationTrialDisposition::FormationSurvivorNotQualified;
        survivor.receipt_digest = digest(&serde_json::to_vec(&survivor.body).unwrap());
        let status = survivor.status().unwrap();
        assert_eq!(status.phase(), ResearchPhase::FormationSurvivorNotQualified);
        let selected = status.selected_candidate().unwrap();
        assert_eq!(selected.parameter_id(), "tuple-001");
        assert_eq!(
            selected.strategy_artifact_digest(),
            "blake3:artifact-tuple-001-full"
        );
        let document: serde_json::Value =
            serde_json::from_slice(&status.to_bytes().unwrap()).unwrap();
        assert_eq!(document["schema_version"], 3);
        assert_eq!(
            document["holdout_status_as_of_source_receipt"],
            "SEALED_NOT_READ_AS_OF_FORMATION_RECEIPT"
        );
        assert_eq!(
            document["qualification_policy"],
            "one_content_addressed_logical_run_after_selection_deterministic_recovery_may_reread"
        );
        for removed_authority_field in [
            "qualification_terminal_evidence",
            "qualification_state_reason",
            "qualification_disposition",
        ] {
            assert!(document.get(removed_authority_field).is_none());
        }
    }

    #[rstest]
    fn producer_rejection_precedes_cache_and_retains_every_frozen_attempt() {
        crate::application::reset_market_data_load_attempts();
        let run = crate::application::execute_frozen_complex_formation(
            std::path::Path::new("/definitely/not/a/strategy-factory-formation-cache"),
            crate::NativeProducerVerificationRequest::from_bundle(
                "/definitely/not/a/strategy-factory-attestation-bundle",
            ),
        )
        .unwrap();
        assert_eq!(crate::application::market_data_load_attempts(), 0);
        assert_eq!(run.trials().len(), 20);
        assert!(
            run.trials()
                .iter()
                .all(|trial| trial.software_error().is_some())
        );
        assert!(run.trials().iter().all(|trial| {
            trial
                .artifact_identity()
                .artifact_digest
                .starts_with("blake3:")
        }));

        let receipt = crate::formation_adapters::issue_price_only_formation_receipt(&run).unwrap();
        assert_eq!(
            receipt.disposition(),
            FormationFamilyDisposition::SoftwareRejected
        );
        assert_eq!(receipt.selected_parameter_id(), None);
        assert_eq!(receipt.body.trials.len(), 20);
        assert!(receipt.body.trials.iter().all(|trial| {
            trial.software_disposition == "REJECTED"
                && trial.economic_disposition == FormationTrialDisposition::SoftwareRejected
                && trial.software_error.is_some()
                && trial.parameters_digest.is_some()
                && trial.strategy_artifact_digest.is_some()
        }));
        assert!(
            !receipt
                .body
                .native_producer_evidence
                .as_ref()
                .unwrap()
                .is_verified()
        );
        assert!(
            receipt
                .body
                .software_error
                .as_deref()
                .is_some_and(|e| e.starts_with("native producer verification rejected: "))
        );
    }

    #[rstest]
    fn formation_owner_rejects_misordered_or_parameter_rebound_adapter_evidence() {
        let family = crate::FrozenStrategyFamily::frozen_price_only().unwrap();
        let artifacts = family.materialize_all().unwrap();
        let producer = crate::producer::verify_native_producer(
            crate::NativeProducerVerificationRequest::from_bundle(
                "/definitely/not/a/strategy-factory-attestation-bundle",
            ),
        );
        let make_trials = || {
            family
                .trials()
                .iter()
                .zip(&artifacts)
                .map(|(trial, artifact)| FormationTrialEvidence {
                    parameter_id: trial.parameter_id().to_string(),
                    variant_id: trial.variant_id().to_string(),
                    parameters_digest: trial.parameters_digest().to_string(),
                    artifact_identity: artifact.identity(),
                    canonical_result: None,
                    source_manifest_digest: None,
                    source_counts: BTreeMap::new(),
                    projection: None,
                    coverage: BTreeMap::new(),
                    software_error: Some("producer rejected".to_string()),
                })
                .collect::<Vec<_>>()
        };
        let make_issuance = |trials| FormationReceiptIssuance {
            experiment_id: family.intent().experiment_id().to_string(),
            research_intent_id: family.intent().identity().to_string(),
            research_intent_digest: family.intent().content_digest().to_string(),
            family: crate::FrozenStrategyFamily::frozen_price_only().unwrap(),
            predecessor_intent_digest: "sha256:predecessor".to_string(),
            predecessor_disposition: "SUPERSEDED".to_string(),
            predecessor_reason: "test".to_string(),
            native_producer_evidence: Some(&producer),
            formation_admission_reason: None,
            evidence_boundary: FormationEvidenceBoundary::SealedHoldout {
                partition: "FORMATION_TEST".to_string(),
                qualification_policy: "forbidden".to_string(),
            },
            software_error: Some("producer rejected".to_string()),
            trials,
            aggregate_coverage: BTreeMap::new(),
            evidence: Vec::new(),
            non_claims: vec!["alpha".to_string()],
        };

        let mut misordered = make_trials();
        misordered.swap(0, 1);
        assert!(FormationFamilyReceipt::issue(&make_issuance(misordered)).is_err());

        let mut incomplete = make_trials();
        incomplete.truncate(9);
        assert!(FormationFamilyReceipt::issue(&make_issuance(incomplete)).is_err());

        let mut rebound = make_trials();
        rebound[0].parameters_digest = "blake3:rebound".to_string();
        assert!(FormationFamilyReceipt::issue(&make_issuance(rebound)).is_err());
    }

    #[derive(Clone, Copy)]
    struct SimpleFamilyAdapter {
        evaluator_mode: &'static str,
    }

    static STABLE_SIMPLE_ADAPTER: SimpleFamilyAdapter = SimpleFamilyAdapter {
        evaluator_mode: "stable-v1",
    };

    impl SimpleFamilyAdapter {
        fn stable() -> Self {
            Self {
                evaluator_mode: "stable-v1",
            }
        }
    }

    impl FrozenFamilyDefinition for SimpleFamilyAdapter {
        fn identity(&self) -> &'static str {
            "simple-score-intent"
        }

        fn experiment_id(&self) -> &'static str {
            "simple-score-experiment"
        }

        fn canonical_intent_bytes(&self) -> &[u8] {
            b"{\"identity\":\"simple-score-intent\"}"
        }

        fn strategy_spec_digest(&self) -> Option<String> {
            None
        }

        fn coordinates(&self) -> Vec<(String, String)> {
            [
                "without-signal-a",
                "baseline-a",
                "baseline-b",
                "without-signal-b1",
                "without-signal-b2",
            ]
            .into_iter()
            .map(|variant| ("single-parameter".to_string(), variant.to_string()))
            .collect()
        }

        fn prepare_issuance(
            &self,
            parameter_id: &str,
            variant_id: &str,
        ) -> Result<ArtifactIssuance<'_>, StrategyFamilyError> {
            if parameter_id != "single-parameter"
                || !matches!(
                    variant_id,
                    "without-signal-a"
                        | "baseline-a"
                        | "baseline-b"
                        | "without-signal-b1"
                        | "without-signal-b2"
                )
            {
                return Err(StrategyFamilyError::Definition(
                    "unknown simple family coordinate".to_string(),
                ));
            }
            Ok(ArtifactIssuance::program(
                1,
                self.canonical_intent_bytes(),
                None,
                Some(format!("{parameter_id}/{variant_id}")),
                Some(b"{\"window\":2}".to_vec()),
                crate::pilot::verified_pilot_build().expect("sealed pilot build"),
            ))
        }
    }

    impl FormationEvaluator for SimpleFamilyAdapter {
        fn identity(&self) -> &'static str {
            "simple-score-evaluator/v1"
        }

        fn selection_policy(&self) -> &'static str {
            "candidate_score_must_exceed_cost_floor_and_deletion_then_walk_forward_stability"
        }

        fn config_bytes(&self) -> Result<Vec<u8>, StrategyFamilyError> {
            serde_json::to_vec(&(self.evaluator_mode, 1u32))
                .map_err(|e| StrategyFamilyError::Definition(e.to_string()))
        }

        fn evaluate(
            &self,
            trials: &[FormationTrialEvidence<'_>],
        ) -> anyhow::Result<FormationProjectionV9> {
            anyhow::ensure!(
                self.evaluator_mode == "stable-v1",
                "simple evaluator mode is not admitted"
            );
            evaluate_simple_family(trials)
        }
    }

    struct ForeignSimpleEvaluator;

    impl FormationEvaluator for ForeignSimpleEvaluator {
        fn identity(&self) -> &'static str {
            FormationEvaluator::identity(&STABLE_SIMPLE_ADAPTER)
        }

        fn selection_policy(&self) -> &'static str {
            STABLE_SIMPLE_ADAPTER.selection_policy()
        }

        fn config_bytes(&self) -> Result<Vec<u8>, StrategyFamilyError> {
            STABLE_SIMPLE_ADAPTER.config_bytes()
        }

        fn evaluate(
            &self,
            trials: &[FormationTrialEvidence<'_>],
        ) -> anyhow::Result<FormationProjectionV9> {
            evaluate_simple_family(trials)
        }
    }

    struct StatefulSimpleFamilyAdapter {
        evaluation_calls: Cell<u32>,
    }

    impl FormationEvaluator for StatefulSimpleFamilyAdapter {
        fn identity(&self) -> &'static str {
            FormationEvaluator::identity(&STABLE_SIMPLE_ADAPTER)
        }

        fn selection_policy(&self) -> &'static str {
            STABLE_SIMPLE_ADAPTER.selection_policy()
        }

        fn config_bytes(&self) -> Result<Vec<u8>, StrategyFamilyError> {
            serde_json::to_vec(&("stateful-v1", self.evaluation_calls.get()))
                .map_err(|e| StrategyFamilyError::Definition(e.to_string()))
        }

        fn evaluate(
            &self,
            trials: &[FormationTrialEvidence<'_>],
        ) -> anyhow::Result<FormationProjectionV9> {
            self.evaluation_calls
                .set(self.evaluation_calls.get().saturating_add(1));
            evaluate_simple_family(trials)
        }
    }

    fn evaluate_simple_family(
        trials: &[FormationTrialEvidence<'_>],
    ) -> anyhow::Result<FormationProjectionV9> {
        let expected_variants = [
            "without-signal-a",
            "baseline-a",
            "baseline-b",
            "without-signal-b1",
            "without-signal-b2",
        ];
        anyhow::ensure!(
            trials
                .iter()
                .map(|trial| trial.variant_id.as_str())
                .eq(expected_variants),
            "simple evaluator topology mismatch"
        );
        let score = |index: usize| -> anyhow::Result<i64> {
            trials[index]
                .projection
                .as_ref()
                .context("simple projection is missing")?
                .outcome
                .get("information_coefficient_milli")
                .context("simple information coefficient is missing")?
                .parse::<i64>()
                .map_err(Into::into)
        };
        let candidate_passes =
            |candidate_index: usize, deletion_indices: &[usize]| -> anyhow::Result<bool> {
                let projection = trials[candidate_index]
                    .projection
                    .as_ref()
                    .context("simple candidate projection is missing")?;
                let candidate_score = score(candidate_index)?;
                let turnover = projection
                    .outcome
                    .get("turnover_milli")
                    .context("simple turnover is missing")?
                    .parse::<i64>()?;
                let risk_floor_passed = projection
                    .outcome
                    .get("risk_floor_passed")
                    .map(String::as_str)
                    == Some("true");
                let beats_deletions = deletion_indices.iter().try_fold(true, |acc, index| {
                    Ok::<_, anyhow::Error>(acc && candidate_score > score(*index)?)
                })?;
                Ok(candidate_score > turnover && risk_floor_passed && beats_deletions)
            };
        let baseline_a_passes = candidate_passes(1, &[0])?;
        let baseline_b_passes = candidate_passes(2, &[3, 4])?;
        anyhow::ensure!(
            !baseline_a_passes && baseline_b_passes,
            "simple frozen selector expected only baseline-b to survive"
        );
        Ok(FormationProjectionV9 {
            family_disposition: FormationFamilyDisposition::FormationSurvivorNotQualified,
            trial_dispositions: vec![
                FormationTrialDisposition::DeletionControl,
                FormationTrialDisposition::EconomicRejected,
                FormationTrialDisposition::FormationSurvivorNotQualified,
                FormationTrialDisposition::DeletionControl,
                FormationTrialDisposition::DeletionControl,
            ],
            economically_selected: Some(FormationTrialSelection {
                parameter_id: "single-parameter".to_string(),
                variant_id: "baseline-b".to_string(),
            }),
            selected: Some(FormationTrialSelection {
                parameter_id: "single-parameter".to_string(),
                variant_id: "baseline-b".to_string(),
            }),
            robustness: Some(FormationRobustnessProjection {
                passed: true,
                diagnostics: BTreeMap::from([
                    (
                        "method".to_string(),
                        "WALK_FORWARD_SCORE_STABILITY".to_string(),
                    ),
                    ("folds".to_string(), "3".to_string()),
                ]),
            }),
            robustness_error: None,
        })
    }

    #[rstest]
    fn admitted_simple_shape_uses_same_receipt_without_price_or_risk_normalizers() {
        let family = FrozenStrategyFamily::from_parts(
            SimpleFamilyAdapter::stable(),
            SimpleFamilyAdapter::stable(),
        )
        .unwrap();
        let artifacts = family.materialize_all().unwrap();
        let admitted_parameter_id = family.trials()[0].parameter_id().to_string();
        let results = (0..family.trials().len())
            .map(|_| empty_canonical_result())
            .collect::<Vec<_>>();
        let trials = family
            .trials()
            .iter()
            .zip(&artifacts)
            .zip(&results)
            .map(|((trial, artifact), result)| FormationTrialEvidence {
                parameter_id: trial.parameter_id().to_string(),
                variant_id: trial.variant_id().to_string(),
                parameters_digest: trial.parameters_digest().to_string(),
                artifact_identity: artifact.identity(),
                canonical_result: Some(result),
                source_manifest_digest: Some("blake3:alternate-source".to_string()),
                source_counts: BTreeMap::from([
                    ("observations".to_string(), 12),
                    ("universe_members".to_string(), 10),
                ]),
                projection: Some(FormationTrialProjection {
                    outcome: BTreeMap::from([
                        ("observations".to_string(), "10".to_string()),
                        (
                            "information_coefficient_milli".to_string(),
                            match trial.variant_id() {
                                "without-signal-a" | "without-signal-b1" => "1",
                                "baseline-a" | "without-signal-b2" => "2",
                                "baseline-b" => "4",
                                _ => unreachable!(),
                            }
                            .to_string(),
                        ),
                        ("turnover_milli".to_string(), "2".to_string()),
                        ("risk_floor_passed".to_string(), "true".to_string()),
                        (
                            "decision_state".to_string(),
                            "NO_PENDING_DECISION".to_string(),
                        ),
                    ]),
                }),
                coverage: BTreeMap::from([("observations".to_string(), 10)]),
                software_error: None,
            })
            .collect::<Vec<_>>();
        let producer = crate::producer::NativeProducerEvidence::test_only_for_execution();
        let mut issuance = FormationReceiptIssuance {
            experiment_id: family.intent().experiment_id().to_string(),
            research_intent_id: family.intent().identity().to_string(),
            research_intent_digest: family.intent().content_digest().to_string(),
            family: FrozenStrategyFamily::from_parts(
                SimpleFamilyAdapter::stable(),
                SimpleFamilyAdapter::stable(),
            )
            .unwrap(),
            predecessor_intent_digest: "sha256:alternate-predecessor".to_string(),
            predecessor_disposition: "SUPERSEDED".to_string(),
            predecessor_reason: "alternate-shape-contract-test".to_string(),
            native_producer_evidence: Some(&producer),
            formation_admission_reason: None,
            evidence_boundary: FormationEvidenceBoundary::SealedHoldout {
                partition: "ALTERNATE_FORMATION_PARTITION".to_string(),
                qualification_policy: "requires_separate_frozen_holdout_receipt".to_string(),
            },
            software_error: None,
            trials,
            aggregate_coverage: BTreeMap::from([("observations".to_string(), 10)]),
            evidence: Vec::new(),
            non_claims: vec!["alpha".to_string()],
        };

        let receipt = FormationFamilyReceipt::issue(&issuance).unwrap();
        assert_eq!(
            receipt.disposition(),
            FormationFamilyDisposition::FormationSurvivorNotQualified
        );
        assert_eq!(receipt.trial_count(), 5);
        assert_eq!(receipt.formation_robustness_passed(), Some(true));
        assert_eq!(
            receipt.selected_parameter_id(),
            Some(admitted_parameter_id.as_str())
        );
        assert_eq!(receipt.selected_variant_id(), Some("baseline-b"));
        let status = receipt.status().unwrap();
        assert_eq!(
            status.selected_candidate().unwrap().variant_id(),
            "baseline-b"
        );
        assert_eq!(
            receipt
                .formation_robustness_diagnostics()
                .unwrap()
                .get("method")
                .map(String::as_str),
            Some("WALK_FORWARD_SCORE_STABILITY")
        );
        let document: serde_json::Value =
            serde_json::from_slice(&receipt.to_bytes().unwrap()).unwrap();
        assert_eq!(
            document["body"]["trials"][0]["outcome"]["information_coefficient_milli"],
            "1"
        );
        let trial_body = document["body"]["trials"][0].as_object().unwrap();

        for price_only_field in [
            "completed_round_trips",
            "starting_balance",
            "ending_balance",
            "net_pnl_after_native_commissions",
            "native_commissions",
            "terminal_state",
            "selection_normalizer",
        ] {
            assert!(!trial_body.contains_key(price_only_field));
        }

        let accepted_bytes = receipt.to_bytes().unwrap();
        assert_eq!(
            FormationFamilyReceipt::from_slice(&accepted_bytes, &issuance).unwrap(),
            receipt
        );
        assert_eq!(FormationFamilyReceipt::issue(&issuance).unwrap(), receipt);
        let original_evaluator_digest = issuance
            .family
            .receipt_binding()
            .unwrap()
            .evaluator_digest()
            .to_string();
        issuance.family = FrozenStrategyFamily::from_parts(
            SimpleFamilyAdapter::stable(),
            SimpleFamilyAdapter {
                evaluator_mode: "alternate-v1",
            },
        )
        .unwrap();
        assert_ne!(
            issuance
                .family
                .receipt_binding()
                .unwrap()
                .evaluator_digest(),
            original_evaluator_digest
        );
        assert!(FormationFamilyReceipt::from_slice(&accepted_bytes, &issuance).is_err());

        issuance.family =
            FrozenStrategyFamily::from_parts(SimpleFamilyAdapter::stable(), ForeignSimpleEvaluator)
                .unwrap();
        assert_ne!(
            issuance
                .family
                .receipt_binding()
                .unwrap()
                .evaluator_digest(),
            original_evaluator_digest
        );
        assert!(FormationFamilyReceipt::from_slice(&accepted_bytes, &issuance).is_err());
        issuance.family = FrozenStrategyFamily::from_parts(
            SimpleFamilyAdapter::stable(),
            StatefulSimpleFamilyAdapter {
                evaluation_calls: Cell::new(0),
            },
        )
        .unwrap();
        let stateful_rejected = FormationFamilyReceipt::issue(&issuance).unwrap();
        assert_eq!(
            stateful_rejected.disposition(),
            FormationFamilyDisposition::SoftwareRejected
        );
        assert!(FormationFamilyReceipt::from_slice(&accepted_bytes, &issuance).is_err());

        issuance.family = FrozenStrategyFamily::from_parts(
            SimpleFamilyAdapter::stable(),
            SimpleFamilyAdapter::stable(),
        )
        .unwrap();

        issuance.trials[4]
            .projection
            .as_mut()
            .unwrap()
            .outcome
            .clear();
        let rejected = FormationFamilyReceipt::issue(&issuance).unwrap();
        assert_eq!(
            rejected.disposition(),
            FormationFamilyDisposition::SoftwareRejected
        );
        assert_eq!(rejected.selected_parameter_id(), None);
        let bytes = rejected.to_bytes().unwrap();
        assert_eq!(
            FormationFamilyReceipt::from_slice(&bytes, &issuance).unwrap(),
            rejected
        );
    }
}
