use std::{
    str::FromStr,
    sync::{Arc, OnceLock},
};

use serde::Serialize;
use vibe_model::{data::BarType, identifiers::InstrumentId, types::Money};

use crate::{
    artifact::{ArtifactIssuance, digest},
    cargo_artifact::{CargoBuildEvidence, VerifiedCargoBuild},
    decision::DecisionContract,
    experiment::PriceOnlyResearchIntent,
    family::{
        FormationEvaluator, FrozenFamilyDefinition, FrozenStrategyFamily, StrategyFamilyError,
    },
    formation_adapters::{
        evaluate_pilot_family, evaluate_price_only_family, evaluate_representative_family,
    },
    intent::PilotResearchIntent,
    pilot::{
        HOUR_NS, PILOT_BAR_TYPE, pilot_program_input_digest, pilot_program_parameters,
        verified_pilot_build,
    },
    program_host::{ProgramEffectBudget, ProgramHostBindings},
    program_runtime::ProgramRuntimeBudget,
    receipt::{FormationProjectionV9, FormationTrialEvidence},
    representative::representative_program_inputs,
    research::{REPRESENTATIVE_INTENT_SHA256, ResearchIntent as RepresentativeResearchIntent},
    status::ResearchEvidenceReference,
};

const PRICE_INSTRUMENT_HANDLE: u32 = 1;
const PRICE_BAR_CHANNEL: u32 = 1;
const PRICE_WASM_ONE: &[u8] = include_bytes!("../assets/program_complex_v1/program.first.wasm");
const PRICE_WASM_TWO: &[u8] = include_bytes!("../assets/program_complex_v1/program.second.wasm");
const PRICE_SOURCE_CAPSULE: &[u8] =
    include_bytes!("../assets/program_complex_v1/source-capsule.tar");
const PRICE_BUILD_RECIPE: &[u8] = include_bytes!("../assets/program_complex_v1/build-recipe.jcs");
const PRICE_RUNTIME_BUDGET: ProgramRuntimeBudget = ProgramRuntimeBudget {
    max_module_bytes: 64 * 1024,
    fuel: 1_000_000,
};
// Predeclared H1 sandbox ceiling; downstream Risk and Portfolio stay authoritative.
const PRICE_MAX_EFFECTS: u32 = 10_000;
const PRICE_MAX_OPENING_SUBMITS: u32 = 5_000;
const PRICE_MAX_CUMULATIVE_OPENING_QUANTITY: f64 = 10_000.0;
static PRICE_BUILD: OnceLock<VerifiedCargoBuild> = OnceLock::new();
pub(crate) const PRICE_FORMATION_EVALUATOR: &str = "price-only-formation-evaluator/v1";
pub(crate) const PILOT_FORMATION_EVALUATOR: &str = "pilot-formation-evaluator/v1";
pub(crate) const REPRESENTATIVE_FORMATION_EVALUATOR: &str = "representative-formation-evaluator/v1";
pub(crate) const REPRESENTATIVE_FORMATION_PREDECESSOR_DISPOSITION: &str =
    "SOFTWARE_ACCEPTED_NOT_FORMATION";
pub(crate) const REPRESENTATIVE_FORMATION_PREDECESSOR_REASON: &str =
    "V4_REMAINS_IMMUTABLE_SUCCESSOR_FROZEN_BEFORE_FORMATION_FAMILY_RESULTS";
pub(crate) const REPRESENTATIVE_FORMATION_SNAPSHOT_SEMANTICS: &str =
    "CONTENT_ADDRESSED_2023_SOURCE_SNAPSHOTS_REPLAYED_RETROSPECTIVELY";
pub(crate) const REPRESENTATIVE_FORMATION_RETROSPECTIVE_REASON: &str =
    "2023_inputs_and_software_control_already_observed_no_reserved_one_way_holdout";

fn definition(error: &impl ToString) -> StrategyFamilyError {
    StrategyFamilyError::Definition(error.to_string())
}

pub(crate) fn representative_formation_non_claims() -> Result<Vec<String>, StrategyFamilyError> {
    let representative =
        RepresentativeResearchIntent::frozen_representative().map_err(|e| definition(&e))?;
    let mut claims = representative
        .non_claims()
        .iter()
        .filter(|claim| claim.as_str() != "formation_survival")
        .cloned()
        .collect::<Vec<_>>();
    claims.extend([
        "actual_consensus_event_surprise".into(),
        "revision_aware_intraday_macro_time".into(),
        "one_way_holdout".into(),
        "retrospective_formation_is_not_unseen_evidence".into(),
        "software_control_receipt_is_not_formation_evidence".into(),
    ]);
    Ok(claims)
}

pub(crate) fn representative_formation_evidence()
-> Result<Vec<ResearchEvidenceReference>, StrategyFamilyError> {
    let representative =
        RepresentativeResearchIntent::frozen_representative().map_err(|e| definition(&e))?;
    let mut evidence = representative
        .evidence_references()
        .map(|(id, locator, role)| {
            ResearchEvidenceReference::new(id.into(), locator.into(), role.into())
        })
        .collect::<Vec<_>>();
    let price = PriceOnlyResearchIntent::frozen().map_err(|e| definition(&e))?;
    evidence.extend(
        price
            .payload
            .evidence
            .into_iter()
            .map(|item| ResearchEvidenceReference::new(item.id, item.locator, item.role)),
    );
    Ok(evidence)
}

impl FrozenStrategyFamily {
    /// Adapts the existing simple pilot into the common upper-layer port.
    pub fn frozen_pilot() -> Result<Self, StrategyFamilyError> {
        let intent = PilotResearchIntent::frozen()
            .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?;
        Self::from_parts(intent.clone(), intent)
    }

    /// Adapts the existing bounded price-only family into the common upper-layer port.
    pub fn frozen_price_only() -> Result<Self, StrategyFamilyError> {
        let intent = PriceOnlyResearchIntent::frozen()
            .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?;
        let build = verified_price_build()
            .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?
            .clone();
        let adapter = PriceOnlyFamilyAdapter::embedded(intent, build);
        Self::from_parts(adapter.clone(), adapter)
    }

    pub fn frozen_representative_formation() -> Result<Self, StrategyFamilyError> {
        let adapter = RepresentativeFormationFamilyAdapter::frozen()?;
        Self::from_parts(adapter.clone(), adapter)
    }
}

impl FrozenFamilyDefinition for PilotResearchIntent {
    fn identity(&self) -> &str {
        &self.identity
    }
    fn experiment_id(&self) -> &str {
        &self.payload.pilot_id
    }
    fn canonical_intent_bytes(&self) -> &[u8] {
        self.canonical_bytes()
    }
    fn strategy_spec_digest(&self) -> Option<String> {
        Some(pilot_program_input_digest())
    }
    fn coordinates(&self) -> Vec<(String, String)> {
        vec![(self.payload.pilot_id.clone(), "full".to_string())]
    }
    fn prepare_issuance(
        &self,
        parameter_id: &str,
        variant_id: &str,
    ) -> Result<ArtifactIssuance<'_>, StrategyFamilyError> {
        if parameter_id != self.payload.pilot_id || variant_id != "full" {
            return Err(StrategyFamilyError::ForeignTrial);
        }
        let contract = DecisionContract::for_intent(self)
            .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?;
        pilot_family_issuance(self, &contract)
    }
}

impl FormationEvaluator for PilotResearchIntent {
    fn identity(&self) -> &str {
        PILOT_FORMATION_EVALUATOR
    }
    fn selection_policy(&self) -> &str {
        &self.payload.disposition.economic_falsifier
    }
    fn config_bytes(&self) -> Result<Vec<u8>, StrategyFamilyError> {
        Ok(self.canonical_bytes().to_vec())
    }
    fn evaluate(
        &self,
        trials: &[FormationTrialEvidence<'_>],
    ) -> anyhow::Result<FormationProjectionV9> {
        evaluate_pilot_family(self, trials)
    }
}

fn pilot_family_issuance<'a>(
    intent: &'a PilotResearchIntent,
    contract: &DecisionContract,
) -> Result<ArtifactIssuance<'a>, StrategyFamilyError> {
    let build =
        verified_pilot_build().map_err(|e| StrategyFamilyError::Definition(e.to_string()))?;
    Ok(ArtifactIssuance::program(
        9,
        intent.canonical_bytes(),
        Some(pilot_program_input_digest()),
        Some(format!("{}/full", intent.payload.pilot_id)),
        Some(pilot_program_parameters(intent, contract)),
        build,
    ))
}

#[derive(Clone)]
struct PriceOnlyFamilyAdapter {
    intent: PriceOnlyResearchIntent,
    intent_identity: String,
    experiment_id: String,
    canonical_intent_bytes: Box<[u8]>,
    build: Arc<VerifiedCargoBuild>,
}

fn successor_intent_document(
    identity: &str,
    experiment_id: &str,
    authority_key: &str,
    authority: &impl Serialize,
    schema_version: u32,
) -> Result<Vec<u8>, StrategyFamilyError> {
    let mut document = serde_json::json!({
        "identity": identity,
        "kind": "ResearchIntent",
        "payload": { "experiment_id": experiment_id },
        "revision": 1,
        "schema_version": schema_version,
    });
    document["payload"][authority_key] =
        serde_json::to_value(authority).map_err(|e| definition(&e))?;
    let mut bytes = serde_json::to_vec(&document).map_err(|e| definition(&e))?;
    bytes.push(b'\n');
    Ok(bytes)
}

impl PriceOnlyFamilyAdapter {
    fn embedded(intent: PriceOnlyResearchIntent, build: VerifiedCargoBuild) -> Self {
        Self {
            intent_identity: intent.identity.clone(),
            experiment_id: intent.payload.experiment_id.clone(),
            canonical_intent_bytes: intent.canonical_bytes().into(),
            intent,
            build: Arc::new(build),
        }
    }
}

impl FrozenFamilyDefinition for PriceOnlyFamilyAdapter {
    fn identity(&self) -> &str {
        &self.intent_identity
    }

    fn experiment_id(&self) -> &str {
        &self.experiment_id
    }

    fn canonical_intent_bytes(&self) -> &[u8] {
        &self.canonical_intent_bytes
    }

    fn strategy_spec_digest(&self) -> Option<String> {
        Some(price_program_input_digest())
    }

    fn coordinates(&self) -> Vec<(String, String)> {
        self.intent
            .payload
            .family
            .tuples
            .iter()
            .flat_map(|parameter| {
                self.intent
                    .payload
                    .family
                    .variants
                    .iter()
                    .map(|variant| (parameter.id.clone(), variant.id.clone()))
            })
            .collect()
    }

    fn prepare_issuance(
        &self,
        parameter_id: &str,
        variant_id: &str,
    ) -> Result<ArtifactIssuance<'_>, StrategyFamilyError> {
        price_only_issuance(
            &self.intent,
            &self.canonical_intent_bytes,
            parameter_id,
            variant_id,
            self.build.as_ref(),
        )
    }
}

impl FormationEvaluator for PriceOnlyFamilyAdapter {
    fn identity(&self) -> &str {
        PRICE_FORMATION_EVALUATOR
    }

    fn selection_policy(&self) -> &str {
        &self.intent.payload.family.selection
    }

    fn config_bytes(&self) -> Result<Vec<u8>, StrategyFamilyError> {
        serde_json::to_vec(&self.intent).map_err(|e| StrategyFamilyError::Definition(e.to_string()))
    }

    fn evaluate(
        &self,
        trials: &[FormationTrialEvidence<'_>],
    ) -> anyhow::Result<FormationProjectionV9> {
        evaluate_price_only_family(&self.intent, trials)
    }
}

#[derive(Clone)]
struct RepresentativeFormationFamilyAdapter {
    parameter_intent: PriceOnlyResearchIntent,
    intent_identity: String,
    experiment_id: String,
    canonical_intent_bytes: Box<[u8]>,
    coordinates: Vec<(String, String)>,
    selection_policy: String,
    bindings_identity: String,
    build: Arc<VerifiedCargoBuild>,
}

impl RepresentativeFormationFamilyAdapter {
    fn frozen() -> Result<Self, StrategyFamilyError> {
        let representative =
            RepresentativeResearchIntent::frozen_representative().map_err(|e| definition(&e))?;
        let parameter_intent = PriceOnlyResearchIntent::frozen().map_err(|e| definition(&e))?;
        let build = verified_price_build().map_err(|e| definition(&e))?.clone();
        let selection_policy = representative.formation_selection_policy().to_string();
        let parameter_family_authority = representative
            .parameter_family_authority()
            .map_err(|e| definition(&e))?;
        let coordinates = parameter_intent
            .payload
            .family
            .tuples
            .iter()
            .flat_map(|tuple| {
                representative
                    .deletion_variants()
                    .iter()
                    .map(|variant| (tuple.id.clone(), variant.clone()))
            })
            .collect::<Vec<_>>();
        let (parameters, bindings) =
            representative_program_inputs(&parameter_intent, "tuple-001", "full")?;

        if parameters.len() != 172 || coordinates.len() != 40 {
            return Err(StrategyFamilyError::Definition(
                "representative Formation surface changed".into(),
            ));
        }
        let bindings_identity = bindings.identity().map_err(|e| definition(&e))?;
        let seed = serde_json::json!({
            "admission": {
                "formation": "ADMITTED_RETROSPECTIVE_2023_ONLY",
                "runtime": "PROGRAM_FIRST_RETROSPECTIVE_FORMATION_ONLY",
                "holdout": "NOT_ADMITTED_NO_RESERVED_ONE_WAY_HOLDOUT",
                "qualification": "FORBIDDEN_NO_RESERVED_ONE_WAY_HOLDOUT",
                "live": "FORBIDDEN",
            },
            "build": {
                "recipe_digest": digest(&build.build_recipe),
                "source_capsule_digest": digest(&build.source_capsule),
                "wasm_digest": digest(&build.wasm),
                "profile_digest": digest(&serde_json::to_vec(&build.profile)
                    .map_err(|e| definition(&e))?),
            },
            "coordinates": {
                "count": coordinates.len(),
                "digest": digest(&serde_json::to_vec(&coordinates)
                    .map_err(|e| definition(&e))?),
            },
            "evidence_boundary": {
                "partition": "RETROSPECTIVE_2023_ONLY",
                "snapshot_semantics": REPRESENTATIVE_FORMATION_SNAPSHOT_SEMANTICS,
                "reason": REPRESENTATIVE_FORMATION_RETROSPECTIVE_REASON,
                "qualification": "NOT_ELIGIBLE_NO_RESERVED_ONE_WAY_HOLDOUT",
            },
            "evidence_authority": representative_formation_evidence()?,
            "formation_non_claims": representative_formation_non_claims()?,
            "parameter_family": {
                "authority": parameter_family_authority,
                "blake3": digest(parameter_intent.canonical_bytes()),
            },
            "program": {
                "bindings_identity": bindings_identity,
                "parameter_abi": "representative-172-v2",
                "parameter_bytes": parameters.len(),
            },
            "representative_v4": {
                "blake3": representative.digest(),
                "identity": representative.identity(),
                "locator": "crates/strategy_factory/assets/representative_intent_v4.jcs",
                "sha256": REPRESENTATIVE_INTENT_SHA256,
            },
            "robustness_policy": parameter_intent.payload.robustness_policy,
            "selection_policy": selection_policy,
        });
        let seed_digest = digest(&serde_json::to_vec(&seed).map_err(|e| definition(&e))?);
        let intent_identity = format!("{}/formation/{seed_digest}", representative.identity());
        let experiment_id = format!("{}/formation/{seed_digest}", representative.experiment_id());
        let canonical_intent_bytes = successor_intent_document(
            &intent_identity,
            &experiment_id,
            "formation_successor",
            &seed,
            13,
        )?;
        Ok(Self {
            parameter_intent,
            intent_identity,
            experiment_id,
            canonical_intent_bytes: canonical_intent_bytes.into(),
            coordinates,
            selection_policy,
            bindings_identity,
            build: Arc::new(build),
        })
    }
}

impl FrozenFamilyDefinition for RepresentativeFormationFamilyAdapter {
    fn identity(&self) -> &str {
        &self.intent_identity
    }
    fn experiment_id(&self) -> &str {
        &self.experiment_id
    }
    fn canonical_intent_bytes(&self) -> &[u8] {
        &self.canonical_intent_bytes
    }
    fn strategy_spec_digest(&self) -> Option<String> {
        Some(self.bindings_identity.clone())
    }
    fn coordinates(&self) -> Vec<(String, String)> {
        self.coordinates.clone()
    }
    fn prepare_issuance(
        &self,
        parameter_id: &str,
        variant_id: &str,
    ) -> Result<ArtifactIssuance<'_>, StrategyFamilyError> {
        let (parameters, _) =
            representative_program_inputs(&self.parameter_intent, parameter_id, variant_id)?;
        Ok(ArtifactIssuance::program(
            13,
            &self.canonical_intent_bytes,
            Some(self.bindings_identity.clone()),
            Some(format!("{parameter_id}/{variant_id}")),
            Some(parameters),
            self.build.as_ref(),
        ))
    }
}

impl FormationEvaluator for RepresentativeFormationFamilyAdapter {
    fn identity(&self) -> &str {
        REPRESENTATIVE_FORMATION_EVALUATOR
    }
    fn selection_policy(&self) -> &str {
        &self.selection_policy
    }
    fn config_bytes(&self) -> Result<Vec<u8>, StrategyFamilyError> {
        Ok(self.canonical_intent_bytes.to_vec())
    }
    fn evaluate(
        &self,
        trials: &[FormationTrialEvidence<'_>],
    ) -> anyhow::Result<FormationProjectionV9> {
        evaluate_representative_family(&self.parameter_intent, &self.selection_policy, trials)
    }
}

fn price_only_issuance<'a>(
    intent: &'a PriceOnlyResearchIntent,
    canonical_intent_bytes: &'a [u8],
    parameter_id: &str,
    variant_id: &str,
    build: &'a VerifiedCargoBuild,
) -> Result<ArtifactIssuance<'a>, StrategyFamilyError> {
    Ok(ArtifactIssuance::program(
        10,
        canonical_intent_bytes,
        Some(price_program_input_digest()),
        Some(format!("{parameter_id}/{variant_id}")),
        Some(price_program_parameters(intent, parameter_id, variant_id)?),
        build,
    ))
}

pub(crate) fn verified_price_build()
-> Result<&'static VerifiedCargoBuild, crate::cargo_artifact::CargoArtifactError> {
    if let Some(build) = PRICE_BUILD.get() {
        return Ok(build);
    }
    let build = VerifiedCargoBuild::verify(CargoBuildEvidence {
        wasm_one: PRICE_WASM_ONE,
        wasm_two: PRICE_WASM_TWO,
        source_capsule: PRICE_SOURCE_CAPSULE,
        build_recipe: PRICE_BUILD_RECIPE,
        runtime_budget: PRICE_RUNTIME_BUDGET,
    })?;
    let _ = PRICE_BUILD.set(build);
    Ok(PRICE_BUILD
        .get()
        .expect("verified price build was initialized"))
}

pub(crate) fn price_program_host_bindings() -> anyhow::Result<ProgramHostBindings> {
    ProgramHostBindings::new(
        [(
            PRICE_INSTRUMENT_HANDLE,
            InstrumentId::from("BTCUSDT.BINANCE"),
        )],
        [(PRICE_BAR_CHANNEL, PILOT_BAR_TYPE.parse::<BarType>()?)],
        ProgramEffectBudget::new(
            PRICE_MAX_EFFECTS,
            PRICE_MAX_EFFECTS,
            PRICE_MAX_OPENING_SUBMITS,
            [(
                PRICE_INSTRUMENT_HANDLE,
                PRICE_MAX_CUMULATIVE_OPENING_QUANTITY,
            )],
        )?,
    )
}

pub(crate) fn price_program_input_digest() -> String {
    price_program_host_bindings()
        .expect("frozen price input contract is valid")
        .identity()
        .expect("frozen price input contract serializes")
}

pub(crate) fn price_program_parameters(
    intent: &PriceOnlyResearchIntent,
    parameter_id: &str,
    variant_id: &str,
) -> Result<Vec<u8>, StrategyFamilyError> {
    intent
        .validate_frozen_binding()
        .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?;
    let tuple = intent
        .tuple(parameter_id)
        .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?;
    let variant = intent
        .variant(variant_id)
        .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?;
    let variant_code = u8::try_from(
        variant
            .code()
            .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?,
    )
    .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?;
    let mut bytes = Vec::with_capacity(56);
    bytes.extend_from_slice(&PRICE_BAR_CHANNEL.to_le_bytes());
    bytes.extend_from_slice(&PRICE_INSTRUMENT_HANDLE.to_le_bytes());

    for value in [
        tuple.atr_period,
        tuple.band_period,
        tuple.breakout_lookback,
        tuple.exit_lookback,
        tuple.fast_ema,
        tuple.rsi_period,
        tuple.slow_ema,
        tuple.volatility_fast,
        tuple.volatility_slow,
    ] {
        bytes.extend_from_slice(
            &u16::try_from(value)
                .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?
                .to_le_bytes(),
        );
    }
    bytes.push(variant_code);
    bytes.push(6);

    for value in [
        tuple.band_sigma_milli,
        tuple.max_volatility_ratio_milli,
        tuple.rsi_entry_max_milli,
        tuple.target_risk_bps,
        tuple.trailing_atr_milli,
        variant.fixed_notional_bps.unwrap_or(0),
    ] {
        bytes.extend_from_slice(
            &u16::try_from(value)
                .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?
                .to_le_bytes(),
        );
    }
    bytes.extend_from_slice(&HOUR_NS.to_le_bytes());
    let balance = Money::from_str(&intent.payload.costs.initial_balance)
        .map_err(StrategyFamilyError::Definition)?;
    bytes.extend_from_slice(&balance.as_f64().to_le_bytes());
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use strategy_factory_program_sdk::{
        BALANCE_RECORD, BAR_RECORD, CODEC_V1, ORDER_EVENT_RECORD, ORDER_RECORD, POSITION_RECORD,
        ProgramRunScope, RecordMeta, order_event,
    };

    use super::*;
    use crate::{
        program_runtime::ProgramRuntimeError,
        program_session::{ProgramSession, ProgramSessionError},
    };

    #[rstest]
    fn representative_formation_family_is_complete_and_deterministic() {
        let first = FrozenStrategyFamily::frozen_representative_formation().unwrap();
        let second = FrozenStrategyFamily::frozen_representative_formation().unwrap();

        assert_eq!(first.intent(), second.intent());
        assert_eq!(first.family_digest(), second.family_digest());
        assert_eq!(first.strategy_spec_digest(), second.strategy_spec_digest());
        assert_eq!(first.trials().len(), 40);
        assert_eq!(first.trials()[0].trial_id(), "tuple-001/full");
        assert_eq!(
            first.trials()[39].trial_id(),
            "tuple-004/without-dynamic-position"
        );
        let artifacts = first.materialize_all().unwrap();
        assert_eq!(artifacts.len(), 40);
        assert!(
            artifacts
                .iter()
                .all(|artifact| artifact.identity().schema_version == 13)
        );
        assert!(artifacts.iter().all(|artifact| {
            artifact.identity().strategy_spec_digest.as_deref() == first.strategy_spec_digest()
        }));
        assert_eq!(
            first.receipt_binding().unwrap().evaluator_digest(),
            second.receipt_binding().unwrap().evaluator_digest()
        );

        let authority: serde_json::Value =
            serde_json::from_slice(first.intent().canonical_bytes()).unwrap();
        let successor = &authority["payload"]["formation_successor"];
        let representative_intent = RepresentativeResearchIntent::frozen_representative().unwrap();
        let price_intent = PriceOnlyResearchIntent::frozen().unwrap();
        assert_eq!(successor["coordinates"]["count"], 40);
        assert_eq!(successor["program"]["parameter_bytes"], 172);
        assert_eq!(
            successor["admission"]["formation"],
            "ADMITTED_RETROSPECTIVE_2023_ONLY"
        );
        assert_eq!(
            successor["evidence_boundary"]["partition"],
            "RETROSPECTIVE_2023_ONLY"
        );
        assert_eq!(
            successor["robustness_policy"],
            serde_json::to_value(&price_intent.payload.robustness_policy).unwrap()
        );
        assert_eq!(
            successor["evidence_authority"].as_array().unwrap().len(),
            representative_intent.evidence_references().count()
                + price_intent.payload.evidence.len()
        );
        let non_claims = successor["formation_non_claims"].as_array().unwrap();
        assert!(non_claims.iter().any(|claim| claim == "alpha"));
        assert!(!non_claims.iter().any(|claim| claim == "formation_survival"));
    }

    #[rstest]
    fn representative_formation_family_rejects_cross_family_trials_and_artifacts() {
        let representative = FrozenStrategyFamily::frozen_representative_formation().unwrap();
        let price = FrozenStrategyFamily::frozen_price_only().unwrap();
        let price_trial = &price.trials()[0];
        let representative_trial = &representative.trials()[0];

        assert_eq!(
            representative.materialize(price_trial).unwrap_err(),
            StrategyFamilyError::ForeignTrial
        );
        assert_eq!(
            price.materialize(representative_trial).unwrap_err(),
            StrategyFamilyError::ForeignTrial
        );
        let price_artifact = price.materialize(price_trial).unwrap();
        assert_eq!(
            representative
                .verify_materialized(representative_trial, &price_artifact)
                .unwrap_err(),
            StrategyFamilyError::ArtifactBinding
        );
    }

    #[rstest]
    fn price_only_artifact_binds_tuple_variant_and_guest_provenance() {
        assert_eq!(PRICE_WASM_ONE, PRICE_WASM_TWO);
        let family = FrozenStrategyFamily::frozen_price_only().expect("price-only family");
        let first_trial = family
            .trial_by_coordinate("tuple-001", "full")
            .expect("first trial");
        let second_trial = family
            .trial_by_coordinate("tuple-002", "full")
            .expect("second trial");
        let first = family.materialize(first_trial).expect("artifact");
        let repeated = family.materialize(first_trial).expect("artifact");
        let second = family.materialize(second_trial).expect("artifact");

        assert_eq!(first, repeated);
        assert_ne!(
            first.identity().artifact_digest,
            second.identity().artifact_digest
        );
        assert_eq!(first.identity().schema_version, 10);
        assert_eq!(first.identity().trial_id.as_deref(), Some("tuple-001/full"));
        assert!(
            first
                .identity()
                .parameters_digest
                .as_deref()
                .is_some_and(|value| value.starts_with("blake3:"))
        );
        assert_eq!(
            first.identity().strategy_spec_digest.as_deref(),
            Some(price_program_input_digest().as_str())
        );
        assert_eq!(first.identity().program_profile.schema_version, 1);

        family
            .verify_materialized(first_trial, &first)
            .expect("exact binding");
    }

    #[rstest]
    fn price_program_accepts_one_order_event_frame_and_rejects_noncanonical_frames() {
        let family = FrozenStrategyFamily::frozen_price_only().expect("price-only family");
        let trial = family
            .trial_by_coordinate("tuple-001", "full")
            .expect("trial");
        let artifact = family.materialize(trial).expect("artifact");
        let intent = PriceOnlyResearchIntent::frozen().expect("intent");
        let parameters =
            price_program_parameters(&intent, "tuple-001", "full").expect("program parameters");
        let mut session = ProgramSession::new(
            &artifact,
            &parameters,
            ProgramRunScope::new(1, 2, 10).expect("run scope"),
        )
        .expect("program session");
        assert!(session.start(1).expect("start").is_empty());

        let mut payload = [0_u8; 32];
        payload[..8].copy_from_slice(&1_u64.to_le_bytes());
        payload[8] = order_event::ACCEPTED;
        payload[9] = 1;
        let meta = RecordMeta {
            type_id: ORDER_EVENT_RECORD,
            codec_version: CODEC_V1,
            channel: PRICE_INSTRUMENT_HANDLE,
            ts_event: 2,
            available_at: 2,
        };
        assert!(
            session
                .observe(2, |encoder| encoder.push(meta, &payload))
                .expect("one order event")
                .is_empty()
        );

        let unbound = RecordMeta {
            channel: PRICE_INSTRUMENT_HANDLE + 1,
            ..meta
        };

        for records in [[meta, meta], [meta, unbound]] {
            let error = session
                .observe(2, |encoder| {
                    records
                        .into_iter()
                        .try_for_each(|record| encoder.push(record, &payload))
                })
                .expect_err("non-single order-event frame must fail closed");
            assert_eq!(
                error,
                ProgramSessionError::Runtime(ProgramRuntimeError::GuestFault(-1))
            );
        }

        let record = |type_id| RecordMeta {
            type_id,
            channel: PRICE_BAR_CHANNEL,
            ..meta
        };
        let mut bar = [0_u8; 40];
        for (index, value) in [100.0_f64, 101.0, 99.0, 100.0, 1.0].into_iter().enumerate() {
            bar[index * 8..index * 8 + 8].copy_from_slice(&value.to_bits().to_le_bytes());
        }
        let error = session
            .observe(2, |encoder| {
                encoder.push(record(BAR_RECORD), &bar)?;

                for (type_id, value) in [
                    (POSITION_RECORD, 0.0_f64),
                    (ORDER_RECORD, 0.0),
                    (BALANCE_RECORD, 100_000.0),
                ] {
                    encoder.push(record(type_id), &value.to_bits().to_le_bytes())?;
                }
                encoder.push(unbound, &payload)
            })
            .expect_err("a Bar snapshot plus an unbound event must fail closed");
        assert_eq!(
            error,
            ProgramSessionError::Runtime(ProgramRuntimeError::GuestFault(-1))
        );
    }
}
