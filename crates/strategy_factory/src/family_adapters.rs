use std::{str::FromStr, sync::OnceLock};

use vibe_model::{data::BarType, identifiers::InstrumentId, types::Money};

use crate::{
    artifact::ArtifactIssuance,
    cargo_artifact::{CargoBuildEvidence, VerifiedCargoBuild},
    decision::DecisionContract,
    experiment::PriceOnlyResearchIntent,
    family::{
        FormationEvaluator, FrozenFamilyDefinition, FrozenStrategyFamily, StrategyFamilyError,
    },
    formation_adapters::{evaluate_pilot_family, evaluate_price_only_family},
    intent::PilotResearchIntent,
    pilot::{
        HOUR_NS, PILOT_BAR_TYPE, pilot_program_input_digest, pilot_program_parameters,
        verified_pilot_build,
    },
    program_host::ProgramHostBindings,
    program_runtime::ProgramRuntimeBudget,
    receipt::{FormationProjectionV9, FormationTrialEvidence},
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
static PRICE_BUILD: OnceLock<VerifiedCargoBuild> = OnceLock::new();
pub(crate) const PRICE_FORMATION_EVALUATOR: &str = "price-only-formation-evaluator/v1";
pub(crate) const PILOT_FORMATION_EVALUATOR: &str = "pilot-formation-evaluator/v1";

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
        let adapter = PriceOnlyFamilyAdapter { intent };
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
}

impl FrozenFamilyDefinition for PriceOnlyFamilyAdapter {
    fn identity(&self) -> &str {
        &self.intent.identity
    }

    fn experiment_id(&self) -> &str {
        &self.intent.payload.experiment_id
    }

    fn canonical_intent_bytes(&self) -> &[u8] {
        self.intent.canonical_bytes()
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
        price_only_issuance(&self.intent, parameter_id, variant_id)
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

fn price_only_issuance<'a>(
    intent: &'a PriceOnlyResearchIntent,
    parameter_id: &str,
    variant_id: &str,
) -> Result<ArtifactIssuance<'a>, StrategyFamilyError> {
    let build =
        verified_price_build().map_err(|e| StrategyFamilyError::Definition(e.to_string()))?;
    Ok(ArtifactIssuance::program(
        10,
        intent.canonical_bytes(),
        Some(price_program_input_digest()),
        Some(format!("{parameter_id}/{variant_id}")),
        Some(price_program_parameters(intent, parameter_id, variant_id)?),
        build,
    ))
}

fn verified_price_build()
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

    use super::*;

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
}
