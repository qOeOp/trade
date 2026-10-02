use std::sync::OnceLock;

use crate::{
    cargo_artifact::{CargoBuildEvidence, VerifiedCargoBuild},
    program_runtime::ProgramRuntimeBudget,
};

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
