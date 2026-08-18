use std::sync::OnceLock;

use thiserror::Error;
use vibe_model::{data::BarType, identifiers::InstrumentId};

use crate::{
    artifact::{ArtifactError, StrategyArtifact},
    cargo_artifact::{CargoArtifactError, CargoBuildEvidence, VerifiedCargoBuild},
    decision::{DecisionContract, DecisionError},
    family::{FrozenStrategyFamily, StrategyFamilyError, StrategyTrial},
    intent::{IntentError, PilotResearchIntent},
    program_host::{ProgramEffectBudget, ProgramHostBindings},
    program_runtime::ProgramRuntimeBudget,
};

pub(crate) const HOUR_NS: u64 = 3_600_000_000_000;
pub(crate) const CLOSED_HOUR_OFFSET_NS: u64 = HOUR_NS - 1_000_000;
pub(crate) const VALIDATION_START_NS: u64 = 1_704_067_200_000_000_000;
pub(crate) const VALIDATION_END_NS: u64 = 1_735_686_000_000_000_000;
pub(crate) const PILOT_INSTRUMENT_HANDLE: u32 = 1;
pub(crate) const PILOT_BAR_CHANNEL: u32 = 1;
pub(crate) const PILOT_BAR_TYPE: &str = "BTCUSDT.BINANCE-1-HOUR-LAST-EXTERNAL";

const PILOT_WASM_ONE: &[u8] = include_bytes!("../assets/program_pilot_v1/program.first.wasm");
const PILOT_WASM_TWO: &[u8] = include_bytes!("../assets/program_pilot_v1/program.second.wasm");
const PILOT_SOURCE_CAPSULE: &[u8] = include_bytes!("../assets/program_pilot_v1/source-capsule.tar");
const PILOT_BUILD_RECIPE: &[u8] = include_bytes!("../assets/program_pilot_v1/build-recipe.jcs");
const PILOT_RUNTIME_BUDGET: ProgramRuntimeBudget = ProgramRuntimeBudget {
    max_module_bytes: 64 * 1024,
    fuel: 1_000_000,
};
// Predeclared H1 sandbox ceiling; downstream Risk and Portfolio stay authoritative.
const PILOT_MAX_EFFECTS: u32 = 10_000;
const PILOT_MAX_OPENING_SUBMITS: u32 = 5_000;
const PILOT_MAX_CUMULATIVE_OPENING_QUANTITY: f64 = 10_000.0;

static PILOT_BUILD: OnceLock<VerifiedCargoBuild> = OnceLock::new();

#[derive(Debug, Error)]
pub(crate) enum PreparationError {
    #[error(transparent)]
    Intent(#[from] IntentError),
    #[error(transparent)]
    Decision(#[from] DecisionError),
    #[error(transparent)]
    Artifact(#[from] ArtifactError),
    #[error(transparent)]
    Build(#[from] CargoArtifactError),
    #[error(transparent)]
    Family(#[from] StrategyFamilyError),
}

pub(crate) fn verified_pilot_build() -> Result<&'static VerifiedCargoBuild, CargoArtifactError> {
    if let Some(build) = PILOT_BUILD.get() {
        return Ok(build);
    }
    let build = VerifiedCargoBuild::verify(CargoBuildEvidence {
        wasm_one: PILOT_WASM_ONE,
        wasm_two: PILOT_WASM_TWO,
        source_capsule: PILOT_SOURCE_CAPSULE,
        build_recipe: PILOT_BUILD_RECIPE,
        runtime_budget: PILOT_RUNTIME_BUDGET,
    })?;
    let _ = PILOT_BUILD.set(build);
    Ok(PILOT_BUILD
        .get()
        .expect("verified pilot build was initialized"))
}

pub(crate) fn pilot_program_parameters(
    intent: &PilotResearchIntent,
    contract: &DecisionContract,
) -> Vec<u8> {
    let parameters = &intent.payload.mechanism.parameters;
    let mut bytes = Vec::with_capacity(56);
    bytes.extend_from_slice(&PILOT_BAR_CHANNEL.to_le_bytes());
    bytes.extend_from_slice(&PILOT_INSTRUMENT_HANDLE.to_le_bytes());

    for value in [
        parameters.fast_ema,
        parameters.slow_ema,
        parameters.entry_lookback,
        parameters.exit_lookback,
    ] {
        bytes.extend_from_slice(&(value as u16).to_le_bytes());
    }
    bytes.extend_from_slice(&contract.trade_quantity().as_f64().to_le_bytes());
    bytes.extend_from_slice(&VALIDATION_START_NS.to_le_bytes());
    bytes.extend_from_slice(&VALIDATION_END_NS.to_le_bytes());
    bytes.extend_from_slice(&(VALIDATION_END_NS - HOUR_NS).to_le_bytes());
    bytes.extend_from_slice(&CLOSED_HOUR_OFFSET_NS.to_le_bytes());
    bytes
}

pub(crate) fn pilot_host_bindings() -> anyhow::Result<ProgramHostBindings> {
    ProgramHostBindings::new(
        [(
            PILOT_INSTRUMENT_HANDLE,
            InstrumentId::from("BTCUSDT.BINANCE"),
        )],
        [(PILOT_BAR_CHANNEL, PILOT_BAR_TYPE.parse::<BarType>()?)],
        ProgramEffectBudget::new(
            PILOT_MAX_EFFECTS,
            PILOT_MAX_EFFECTS,
            PILOT_MAX_OPENING_SUBMITS,
            [(
                PILOT_INSTRUMENT_HANDLE,
                PILOT_MAX_CUMULATIVE_OPENING_QUANTITY,
            )],
        )?,
    )
}

pub(crate) fn pilot_program_input_digest() -> String {
    pilot_host_bindings()
        .expect("frozen pilot input contract is valid")
        .identity()
        .expect("frozen pilot input contract serializes")
}

pub(crate) fn prepare_frozen_pilot(
    family: &FrozenStrategyFamily,
    trial: &StrategyTrial,
    artifact: &StrategyArtifact,
) -> Result<(PilotResearchIntent, DecisionContract, Vec<u8>), PreparationError> {
    let intent = PilotResearchIntent::frozen()?;
    let contract = DecisionContract::for_intent(&intent)?;
    family.verify_materialized(trial, artifact)?;
    let parameters = pilot_program_parameters(&intent, &contract);
    artifact.verify_parameters(&parameters)?;
    Ok((intent, contract, parameters))
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn sealed_program_and_artifact_issuance_are_deterministic() {
        let build = verified_pilot_build().expect("verified pilot build");
        assert_eq!(PILOT_WASM_ONE, PILOT_WASM_TWO);
        assert_eq!(build.wasm.as_ref(), PILOT_WASM_ONE);

        let family = FrozenStrategyFamily::frozen_pilot().expect("pilot family");
        let trial = &family.trials()[0];
        let first = family.materialize(trial).expect("first artifact");
        let second = family.materialize(trial).expect("second artifact");
        assert_eq!(first, second);
        assert_eq!(first.identity().schema_version, 9);
        assert_eq!(first.identity().program_profile.schema_version, 1);
        assert_eq!(build.source_capsule.as_ref(), PILOT_SOURCE_CAPSULE);
        assert_eq!(build.build_recipe.as_ref(), PILOT_BUILD_RECIPE);
    }

    #[rstest]
    fn tampered_intent_cannot_bypass_pilot_artifact_binding() {
        let family = FrozenStrategyFamily::frozen_pilot().expect("pilot family");
        let foreign = FrozenStrategyFamily::frozen_price_only().expect("foreign family");
        assert!(family.materialize(&foreign.trials()[0]).is_err());
    }
}
