use std::{collections::BTreeSet, fmt::Debug};

use serde::Serialize;
use thiserror::Error;

use crate::{
    artifact::{ArtifactError, ArtifactIssuance, StrategyArtifact},
    program_project::FrozenProgramProject,
    receipt::{FormationProjectionV9, FormationTrialEvidence},
};

/// Content-addressed, strategy-shape-independent projection of a validated frozen ResearchIntent.
///
/// The strategy adapter retains responsibility for validating its payload. The upper layer owns
/// only the common identity and canonical bytes; callers cannot construct or deserialize another
/// authority-bearing intent.
///
/// ```compile_fail
/// use vibe_strategy_factory::ResearchIntent;
///
/// let _: ResearchIntent = serde_json::from_slice(b"{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResearchIntent {
    canonical_bytes: Box<[u8]>,
    content_digest: String,
    experiment_id: String,
    identity: String,
}

impl ResearchIntent {
    pub fn identity(&self) -> &str {
        &self.identity
    }

    pub fn experiment_id(&self) -> &str {
        &self.experiment_id
    }

    pub fn content_digest(&self) -> &str {
        &self.content_digest
    }

    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    fn from_validated(
        identity: impl Into<String>,
        experiment_id: impl Into<String>,
        canonical_bytes: &[u8],
    ) -> Self {
        Self {
            canonical_bytes: canonical_bytes.into(),
            content_digest: digest(canonical_bytes),
            experiment_id: experiment_id.into(),
            identity: identity.into(),
        }
    }
}

/// One family-issued coordinate in a bounded, strategy-defined trial surface.
///
/// A coordinate is bound to the family that issued it. Passing a coordinate from another family
/// fails closed; raw field construction is intentionally unavailable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StrategyTrial {
    family_digest: String,
    parameter_id: String,
    parameters_digest: String,
    trial_id: String,
    variant_id: String,
}

/// Raw trial construction is unavailable outside the factory.
///
/// ```compile_fail
/// use vibe_strategy_factory::StrategyTrial;
///
/// let _ = StrategyTrial {
///     family_digest: String::new(),
///     parameter_id: String::new(),
///     parameters_digest: String::new(),
///     trial_id: String::new(),
///     variant_id: String::new(),
/// };
/// ```
const _: () = ();

impl StrategyTrial {
    pub fn trial_id(&self) -> &str {
        &self.trial_id
    }

    pub fn parameter_id(&self) -> &str {
        &self.parameter_id
    }

    pub fn parameters_digest(&self) -> &str {
        &self.parameters_digest
    }

    pub fn variant_id(&self) -> &str {
        &self.variant_id
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum StrategyFamilyError {
    #[error("frozen strategy definition is unavailable: {0}")]
    Definition(String),
    #[error(transparent)]
    Artifact(#[from] ArtifactError),
    #[error("trial coordinate does not belong to this frozen strategy family")]
    ForeignTrial,
    #[error("materialized artifact does not bind the frozen family and trial")]
    ArtifactBinding,
}

pub(crate) trait FrozenFamilyDefinition: 'static {
    fn identity(&self) -> &str;
    fn experiment_id(&self) -> &str;
    fn canonical_intent_bytes(&self) -> &[u8];
    fn strategy_spec_digest(&self) -> Option<String>;
    fn coordinates(&self) -> Vec<(String, String)>;
    fn prepare_issuance(
        &self,
        parameter_id: &str,
        variant_id: &str,
    ) -> Result<ArtifactIssuance<'_>, StrategyFamilyError>;
}

pub(crate) trait FormationEvaluator: 'static {
    fn identity(&self) -> &str;
    fn selection_policy(&self) -> &str;
    fn config_bytes(&self) -> Result<Vec<u8>, StrategyFamilyError>;
    fn evaluate(
        &self,
        trials: &[FormationTrialEvidence<'_>],
    ) -> anyhow::Result<FormationProjectionV9>;
}

/// Opaque upper-layer port shared by materially different frozen strategy shapes.
///
/// Adding another strategy supplies a sealed adapter. It does not add another public Artifact
/// issuance protocol, result owner, registry, or execution authority.
pub struct FrozenStrategyFamily {
    definition: Box<dyn FrozenFamilyDefinition>,
    evaluator: Box<dyn FormationEvaluator>,
    evaluator_type_identity: &'static str,
    evaluator_authority: FrozenEvaluatorAuthority,
    family_digest: String,
    intent: ResearchIntent,
    strategy_spec_digest: Option<String>,
    trials: Vec<StrategyTrial>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FrozenEvaluatorAuthority {
    identity: String,
    selection_policy: String,
    config: Box<[u8]>,
    coordinates: Vec<FrozenEvaluatorCoordinate>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FrozenEvaluatorCoordinate {
    parameter_id: String,
    variant_id: String,
}

#[derive(Debug, Clone)]
pub(crate) struct FrozenFamilyReceiptBinding {
    family_digest: String,
    intent_digest: String,
    selection_policy: String,
    evaluator_digest: String,
    coordinates: Vec<FrozenFamilyCoordinateBinding>,
}

#[derive(Debug, Clone, Serialize)]
struct FrozenFamilyCoordinateBinding {
    parameter_id: String,
    variant_id: String,
    parameters_digest: String,
    artifact_digest: String,
}

impl FrozenFamilyReceiptBinding {
    pub(crate) fn family_digest(&self) -> &str {
        &self.family_digest
    }

    pub(crate) fn intent_digest(&self) -> &str {
        &self.intent_digest
    }

    pub(crate) fn selection_policy(&self) -> &str {
        &self.selection_policy
    }

    pub(crate) fn evaluator_digest(&self) -> &str {
        &self.evaluator_digest
    }

    pub(crate) fn len(&self) -> usize {
        self.coordinates.len()
    }

    pub(crate) fn matches_coordinate(
        &self,
        index: usize,
        parameter_id: &str,
        variant_id: &str,
        parameters_digest: &str,
        artifact_digest: &str,
    ) -> bool {
        self.coordinates.get(index).is_some_and(|coordinate| {
            coordinate.parameter_id == parameter_id
                && coordinate.variant_id == variant_id
                && coordinate.parameters_digest == parameters_digest
                && coordinate.artifact_digest == artifact_digest
        })
    }
}

impl Debug for FrozenStrategyFamily {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(FrozenStrategyFamily))
            .field("family_digest", &self.family_digest)
            .field("intent", &self.intent)
            .field("strategy_spec_digest", &self.strategy_spec_digest)
            .field("trials", &self.trials)
            .finish_non_exhaustive()
    }
}

impl FrozenStrategyFamily {
    pub(crate) fn from_parts(
        definition: impl FrozenFamilyDefinition,
        evaluator: impl FormationEvaluator,
    ) -> Result<Self, StrategyFamilyError> {
        let evaluator_type_identity = std::any::type_name_of_val(&evaluator);
        let intent = ResearchIntent::from_validated(
            definition.identity(),
            definition.experiment_id(),
            definition.canonical_intent_bytes(),
        );
        let strategy_spec_digest = definition.strategy_spec_digest();
        let family_digest =
            family_digest(intent.content_digest(), strategy_spec_digest.as_deref())?;
        let mut trials = Vec::new();
        let coordinates = definition.coordinates();

        for (parameter_id, variant_id) in &coordinates {
            let issuance = definition.prepare_issuance(parameter_id, variant_id)?;
            let trial_id = format!("{parameter_id}/{variant_id}");
            let parameters_digest = issuance
                .parameters_digest()
                .ok_or(StrategyFamilyError::ArtifactBinding)?;

            if issuance.intent_digest() != intent.content_digest
                || issuance.trial_id() != Some(&trial_id)
                || issuance.strategy_spec_digest() != strategy_spec_digest.as_deref()
            {
                return Err(StrategyFamilyError::ArtifactBinding);
            }
            trials.push(trial(
                &family_digest,
                parameter_id,
                &parameters_digest,
                variant_id,
            ));
        }
        let frozen_evaluator_authority = evaluator_authority(&evaluator, &coordinates)?;
        if evaluator_authority(&evaluator, &coordinates)? != frozen_evaluator_authority {
            return Err(StrategyFamilyError::Definition(
                "formation evaluator authority changed while freezing the family".to_string(),
            ));
        }
        let family = Self::new(
            intent,
            strategy_spec_digest,
            trials,
            Box::new(definition),
            Box::new(evaluator),
            evaluator_type_identity,
            frozen_evaluator_authority,
        )?;
        family.ensure_definition_authority()?;
        family.materialize_all()?;
        Ok(family)
    }

    pub fn intent(&self) -> &ResearchIntent {
        &self.intent
    }

    pub fn family_digest(&self) -> &str {
        &self.family_digest
    }

    pub fn strategy_spec_digest(&self) -> Option<&str> {
        self.strategy_spec_digest.as_deref()
    }

    pub fn trials(&self) -> &[StrategyTrial] {
        &self.trials
    }

    #[cfg(test)]
    pub(crate) fn trial_by_coordinate(
        &self,
        parameter_id: &str,
        variant_id: &str,
    ) -> Result<&StrategyTrial, StrategyFamilyError> {
        self.trials
            .iter()
            .find(|trial| trial.parameter_id == parameter_id && trial.variant_id == variant_id)
            .ok_or(StrategyFamilyError::ForeignTrial)
    }

    pub(crate) fn verify_materialized(
        &self,
        trial: &StrategyTrial,
        artifact: &StrategyArtifact,
    ) -> Result<(), StrategyFamilyError> {
        if &self.materialize(trial)? != artifact {
            return Err(StrategyFamilyError::ArtifactBinding);
        }
        Ok(())
    }

    /// Materializes one deterministic StrategyArtifact through the sealed family adapter.
    pub fn materialize(
        &self,
        trial: &StrategyTrial,
    ) -> Result<StrategyArtifact, StrategyFamilyError> {
        if trial.family_digest != self.family_digest || !self.trials.contains(trial) {
            return Err(StrategyFamilyError::ForeignTrial);
        }
        let issuance = self
            .definition
            .prepare_issuance(trial.parameter_id(), trial.variant_id())?;
        let issuance_parameters_digest = issuance
            .parameters_digest()
            .ok_or(StrategyFamilyError::ArtifactBinding)?;

        if issuance.intent_digest() != self.intent.content_digest
            || issuance.trial_id() != Some(trial.trial_id())
            || issuance.strategy_spec_digest() != self.strategy_spec_digest.as_deref()
            || issuance_parameters_digest != trial.parameters_digest
        {
            return Err(StrategyFamilyError::ArtifactBinding);
        }
        let artifact = StrategyArtifact::issue(&issuance)?;
        let identity = artifact.identity();
        if identity.intent_digest != self.intent.content_digest
            || identity.trial_id.as_deref() != Some(trial.trial_id())
            || identity.parameters_digest.as_deref() != Some(trial.parameters_digest())
            || identity.strategy_spec_digest.as_deref() != self.strategy_spec_digest.as_deref()
        {
            return Err(StrategyFamilyError::ArtifactBinding);
        }
        Ok(artifact)
    }

    /// Materializes the entire bounded family in frozen coordinate order.
    pub fn materialize_all(&self) -> Result<Vec<StrategyArtifact>, StrategyFamilyError> {
        self.trials
            .iter()
            .map(|trial| self.materialize(trial))
            .collect()
    }

    /// Returns the one program project shared by every bounded family coordinate.
    pub fn program_project(&self) -> Result<FrozenProgramProject<'_>, StrategyFamilyError> {
        self.ensure_definition_authority()?;
        let mut build = None;
        for trial in &self.trials {
            let issuance = self
                .definition
                .prepare_issuance(trial.parameter_id(), trial.variant_id())?;
            let candidate = issuance.verified_build();
            if build.is_some_and(|expected| expected != candidate) {
                return Err(StrategyFamilyError::Definition(
                    "frozen strategy family spans multiple program projects".to_string(),
                ));
            }
            build = Some(candidate);
        }
        Ok(FrozenProgramProject {
            family: self,
            build: build.ok_or_else(|| {
                StrategyFamilyError::Definition("frozen family has no program project".to_string())
            })?,
        })
    }

    pub(crate) fn receipt_binding(
        &self,
    ) -> Result<FrozenFamilyReceiptBinding, StrategyFamilyError> {
        self.ensure_evaluator_authority()?;
        let artifacts = self.materialize_all()?;
        self.ensure_evaluator_authority()?;
        let coordinates = self
            .trials
            .iter()
            .zip(artifacts)
            .map(|(trial, artifact)| FrozenFamilyCoordinateBinding {
                parameter_id: trial.parameter_id.clone(),
                variant_id: trial.variant_id.clone(),
                parameters_digest: trial.parameters_digest.clone(),
                artifact_digest: artifact.identity().artifact_digest.clone(),
            })
            .collect::<Vec<_>>();
        Ok(FrozenFamilyReceiptBinding {
            family_digest: self.family_digest.clone(),
            intent_digest: self.intent.content_digest.clone(),
            selection_policy: self.evaluator_authority.selection_policy.clone(),
            evaluator_digest: evaluator_digest(
                &self.intent.content_digest,
                &self.evaluator_authority.identity,
                &self.evaluator_authority.selection_policy,
                self.evaluator_type_identity,
                &self.evaluator_authority.config,
                &coordinates,
            )?,
            coordinates,
        })
    }

    pub(crate) fn evaluate_formation(
        &self,
        trials: &[FormationTrialEvidence<'_>],
    ) -> anyhow::Result<FormationProjectionV9> {
        self.ensure_evaluator_authority()?;
        let first = self.evaluator.evaluate(trials)?;
        self.ensure_evaluator_authority()?;
        let second = self.evaluator.evaluate(trials)?;
        self.ensure_evaluator_authority()?;
        anyhow::ensure!(
            first == second,
            "formation evaluator is not deterministic under its frozen configuration"
        );
        Ok(first)
    }

    fn ensure_evaluator_authority(&self) -> Result<(), StrategyFamilyError> {
        self.ensure_definition_authority()?;
        let coordinates = self
            .trials
            .iter()
            .map(|trial| (trial.parameter_id.clone(), trial.variant_id.clone()))
            .collect::<Vec<_>>();
        let first = evaluator_authority(self.evaluator.as_ref(), &coordinates)?;
        let second = evaluator_authority(self.evaluator.as_ref(), &coordinates)?;
        if first != self.evaluator_authority || second != self.evaluator_authority {
            return Err(StrategyFamilyError::Definition(
                "formation evaluator authority changed after family freeze".to_string(),
            ));
        }
        Ok(())
    }

    fn ensure_definition_authority(&self) -> Result<(), StrategyFamilyError> {
        let coordinates = self.definition.coordinates();
        if self.definition.identity() != self.intent.identity
            || self.definition.experiment_id() != self.intent.experiment_id
            || self.definition.canonical_intent_bytes() != self.intent.canonical_bytes.as_ref()
            || self.definition.strategy_spec_digest() != self.strategy_spec_digest
            || coordinates.len() != self.trials.len()
            || coordinates
                .iter()
                .zip(&self.trials)
                .any(|((parameter_id, variant_id), trial)| {
                    parameter_id != trial.parameter_id() || variant_id != trial.variant_id()
                })
        {
            return Err(StrategyFamilyError::Definition(
                "frozen family definition authority changed".to_string(),
            ));
        }
        Ok(())
    }

    fn new(
        intent: ResearchIntent,
        strategy_spec_digest: Option<String>,
        trials: Vec<StrategyTrial>,
        definition: Box<dyn FrozenFamilyDefinition>,
        evaluator: Box<dyn FormationEvaluator>,
        evaluator_type_identity: &'static str,
        evaluator_authority: FrozenEvaluatorAuthority,
    ) -> Result<Self, StrategyFamilyError> {
        let family_digest =
            family_digest(intent.content_digest(), strategy_spec_digest.as_deref())?;
        let unique = trials
            .iter()
            .map(|trial| trial.trial_id.as_str())
            .collect::<BTreeSet<_>>();

        if trials.is_empty()
            || unique.len() != trials.len()
            || trials
                .iter()
                .any(|trial| trial.family_digest != family_digest)
        {
            return Err(StrategyFamilyError::Definition(
                "bounded trial coordinates".to_string(),
            ));
        }
        Ok(Self {
            definition,
            evaluator,
            evaluator_type_identity,
            evaluator_authority,
            family_digest,
            intent,
            strategy_spec_digest,
            trials,
        })
    }
}

fn trial(
    family_digest: &str,
    parameter_id: &str,
    parameters_digest: &str,
    variant_id: &str,
) -> StrategyTrial {
    StrategyTrial {
        family_digest: family_digest.to_string(),
        parameter_id: parameter_id.to_string(),
        parameters_digest: parameters_digest.to_string(),
        trial_id: format!("{parameter_id}/{variant_id}"),
        variant_id: variant_id.to_string(),
    }
}

#[derive(Serialize)]
struct FamilyDigestSeed<'a> {
    intent_digest: &'a str,
    schema_version: u32,
    strategy_spec_digest: Option<&'a str>,
}

fn family_digest(
    intent_digest: &str,
    strategy_spec_digest: Option<&str>,
) -> Result<String, StrategyFamilyError> {
    let bytes = serde_json::to_vec(&FamilyDigestSeed {
        intent_digest,
        schema_version: 1,
        strategy_spec_digest,
    })
    .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?;
    Ok(digest(&bytes))
}

fn evaluator_authority<E: FormationEvaluator + ?Sized>(
    evaluator: &E,
    coordinates: &[(String, String)],
) -> Result<FrozenEvaluatorAuthority, StrategyFamilyError> {
    let identity = evaluator.identity().to_string();
    let selection_policy = evaluator.selection_policy().to_string();
    let config = evaluator.config_bytes()?;
    let coordinates = coordinates
        .iter()
        .map(|(parameter_id, variant_id)| FrozenEvaluatorCoordinate {
            parameter_id: parameter_id.clone(),
            variant_id: variant_id.clone(),
        })
        .collect::<Vec<_>>();

    if identity.is_empty()
        || selection_policy.is_empty()
        || config.is_empty()
        || coordinates.is_empty()
    {
        return Err(StrategyFamilyError::Definition(
            "formation evaluator authority is incomplete".to_string(),
        ));
    }
    Ok(FrozenEvaluatorAuthority {
        identity,
        selection_policy,
        config: config.into_boxed_slice(),
        coordinates,
    })
}

fn evaluator_digest(
    intent_digest: &str,
    identity: &str,
    selection_policy: &str,
    adapter_type_identity: &str,
    evaluator_config: &[u8],
    coordinates: &[FrozenFamilyCoordinateBinding],
) -> Result<String, StrategyFamilyError> {
    let bytes = serde_json::to_vec(&(
        intent_digest,
        identity,
        selection_policy,
        adapter_type_identity,
        evaluator_config,
        coordinates,
        1u32,
    ))
    .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?;
    Ok(digest(&bytes))
}

fn digest(bytes: &[u8]) -> String {
    format!("blake3:{}", blake3::hash(bytes).to_hex())
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use rstest::rstest;

    use super::*;

    struct ParameterSwitchingAdapter {
        prepared_once: Cell<bool>,
    }

    impl FrozenFamilyDefinition for ParameterSwitchingAdapter {
        fn identity(&self) -> &'static str {
            "test-intent"
        }

        fn experiment_id(&self) -> &'static str {
            "test-experiment"
        }

        fn canonical_intent_bytes(&self) -> &[u8] {
            b"{}"
        }

        fn strategy_spec_digest(&self) -> Option<String> {
            None
        }

        fn coordinates(&self) -> Vec<(String, String)> {
            vec![("parameter".to_string(), "full".to_string())]
        }

        fn prepare_issuance(
            &self,
            parameter_id: &str,
            variant_id: &str,
        ) -> Result<ArtifactIssuance<'_>, StrategyFamilyError> {
            let parameters = if self.prepared_once.replace(true) {
                b"changed".to_vec()
            } else {
                b"frozen".to_vec()
            };
            Ok(ArtifactIssuance::program(
                1,
                self.canonical_intent_bytes(),
                None,
                Some(format!("{parameter_id}/{variant_id}")),
                Some(parameters),
                crate::pilot::verified_pilot_build().expect("sealed pilot build"),
            ))
        }
    }

    struct StableTestEvaluator;

    impl FormationEvaluator for StableTestEvaluator {
        fn identity(&self) -> &'static str {
            "test-evaluator/v1"
        }

        fn selection_policy(&self) -> &'static str {
            "test-policy/v1"
        }

        fn config_bytes(&self) -> Result<Vec<u8>, StrategyFamilyError> {
            Ok(b"stable-test-evaluator".to_vec())
        }

        fn evaluate(
            &self,
            _trials: &[FormationTrialEvidence<'_>],
        ) -> anyhow::Result<FormationProjectionV9> {
            anyhow::bail!("test adapter has no formation evaluator")
        }
    }

    #[rstest]
    fn adapter_cannot_change_frozen_parameter_material_before_artifact_issuance() {
        let result = FrozenStrategyFamily::from_parts(
            ParameterSwitchingAdapter {
                prepared_once: Cell::new(false),
            },
            StableTestEvaluator,
        );

        assert_eq!(result.unwrap_err(), StrategyFamilyError::ArtifactBinding);
    }
}
