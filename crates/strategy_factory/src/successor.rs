use std::{collections::BTreeMap, str::FromStr, sync::OnceLock};

use sha2::{Digest as _, Sha256};
use vibe_common::signal::Signal;
use vibe_fred::FredObservation;
use vibe_model::{
    data::{BarType, DataType},
    identifiers::InstrumentId,
    types::Money,
};
use vibe_scheduled_events::ScheduledEventObservation;

use crate::{
    artifact::ArtifactIssuance,
    cargo_artifact::{CargoBuildEvidence, VerifiedCargoBuild},
    family::{
        FormationEvaluator, FrozenFamilyDefinition, FrozenStrategyFamily, StrategyFamilyError,
    },
    formation_adapters::{BoundedCashFormationPolicy, evaluate_bounded_cash_family},
    program_host::{ProgramCustomBinding, ProgramEffectBudget, ProgramHostBindings},
    program_runtime::ProgramRuntimeBudget,
    receipt::{
        FormationEvidenceBoundary, FormationFamilyReceipt, FormationProjectionV9,
        FormationReceiptIssuance, FormationTrialEvidence, OwnedFormationRun,
        OwnedFormationTrialEvidence,
    },
    robustness::RobustnessPolicy,
    status::ResearchEvidenceReference,
};

const INTENT_BYTES: &[u8] = include_bytes!("../assets/secac_successor_intent_v3.jcs");
const INTENT_SHA256: &str = "8b66c410af32a6c9345b537658136beaea1f60a2927bb2391323190192b41722";
const INTENT_ID: &str = "researchintent-strategy-factory-secac-v3";
const EXPERIMENT_ID: &str = "btc-perpetual-scheduled-event-cross-asset-confirmation-v3";
const SOFTWARE_PREDECESSOR_INTENT_SHA256: &str =
    "sha256:b49e4c0fe0b74faf080ab7671156ece1b6c9d2da488430a16bc0d38e0d18881c";
const PREDECESSOR_RECEIPT_SHA256: &str =
    "df304ae3e40bded59a3aaea4cee53f78b3c8d86141bc66aa9d2f2a8072714d48";
pub(crate) const SECAC_RESERVATION_SHA256: &str =
    "sha256:679cc5b2c98602770404a9018ef9dec88ace69aa4500f8203fad223befd9373a";
const SELECTION: &str = "full_requires_trading_activity_positive_net_after_native_commissions_terminal_flat_and_strictly_beats_every_deletion_then_net_pnl_then_parameter_id";
const WASM_ONE: &[u8] = include_bytes!("../assets/program_secac_v1/program.first.wasm");
const WASM_TWO: &[u8] = include_bytes!("../assets/program_secac_v1/program.second.wasm");
const SOURCE: &[u8] = include_bytes!("../assets/program_secac_v1/source-capsule.tar");
const RECIPE: &[u8] = include_bytes!("../assets/program_secac_v1/build-recipe.jcs");
const BUDGET: ProgramRuntimeBudget = ProgramRuntimeBudget {
    max_module_bytes: 64 * 1024,
    fuel: 1_000_000,
};
const SECAC_EXECUTABLE: u32 = 1;
// Predeclared M15 repair ceiling; downstream Risk and Portfolio stay authoritative.
const SECAC_MAX_EFFECTS: u32 = 100_000;
const SECAC_MAX_OPENING_SUBMITS: u32 = 50_000;
const SECAC_MAX_CUMULATIVE_OPENING_QUANTITY: f64 = 100_000.0;
static BUILD: OnceLock<VerifiedCargoBuild> = OnceLock::new();
const TUPLES: [(&str, u8); 2] = [("wait-1", 1), ("wait-2", 2)];
const VARIANTS: [(&str, u16); 5] = [
    ("full", 0xF),
    ("without-eth", 0xE),
    ("without-mtf", 0xD),
    ("without-macro-paxg", 0xB),
    ("without-dynamic-protection", 0x7),
];
const COVERAGE_TAGS: [(u32, &str); 9] = [
    (111, "entry_employment_long"),
    (112, "entry_employment_short"),
    (121, "entry_fomc_long"),
    (122, "entry_fomc_short"),
    (201, "exit_fixed_atr"),
    (202, "exit_matched_cross_asset_thesis_loss"),
    (203, "exit_max_hold"),
    (204, "exit_dynamic_trailing"),
    (205, "exit_terminal"),
];

#[derive(Clone)]
struct SecacAdapter {
    bindings_identity: String,
    evaluator_identity: &'static str,
}

fn definition(error: &impl ToString) -> StrategyFamilyError {
    StrategyFamilyError::Definition(error.to_string())
}

fn field<'a>(value: &'a serde_json::Value, name: &str) -> anyhow::Result<&'a str> {
    value[name]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("SECAC intent {name} is missing"))
}

fn parse_intent(bytes: &[u8]) -> Result<serde_json::Value, StrategyFamilyError> {
    let intent: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|error| definition(&error))?;
    let mut canonical = serde_json::to_vec(&intent).map_err(|error| definition(&error))?;
    canonical.push(b'\n');
    let digest = format!("{:x}", Sha256::digest(bytes));
    let build = &intent["payload"]["program_contract"]["build"];
    if canonical != bytes
        || digest != INTENT_SHA256
        || intent["identity"] != INTENT_ID
        || intent["kind"] != "ResearchIntent"
        || intent["revision"] != "3"
        || intent["schema_version"] != 1
        || intent["payload"]["experiment_id"] != EXPERIMENT_ID
        || intent["payload"]["family"]["selection"] != SELECTION
        || intent["payload"]["holdout"]["reservation_sha256"] != SECAC_RESERVATION_SHA256
        || intent["payload"]["predecessor"]["formation_receipt_file_sha256"]
            != format!("sha256:{PREDECESSOR_RECEIPT_SHA256}")
        || intent["payload"]["software_predecessor"]["intent_sha256"]
            != SOFTWARE_PREDECESSOR_INTENT_SHA256
        || intent["payload"]["software_predecessor"]["disposition"] != "SOFTWARE_INCOMPATIBLE"
        || intent["payload"]["software_predecessor"]["repair_scope"]
            != "scheduled_event_kind1_noop_only_no_hypothesis_parameter_threshold_cost_or_policy_change"
        || intent["payload"]["program_contract"]["scheduled_event_consumption"]
            != "exact_kind_domain_1_2_3_kind1_validated_noop_kind2_3_event_window_unknown_or_stale_rejected"
        || intent["payload"]["program_contract"]["parameter_layout"] != "secac-128-v1"
        || intent["payload"]["program_contract"]["parameter_bytes"] != 128
        || build["build_recipe_sha256"] != format!("sha256:{:x}", Sha256::digest(RECIPE))
        || build["source_capsule_sha256"] != format!("sha256:{:x}", Sha256::digest(SOURCE))
        || build["wasm_sha256"] != format!("sha256:{:x}", Sha256::digest(WASM_ONE))
    {
        return Err(definition(&"SECAC successor intent binding mismatch"));
    }
    Ok(intent)
}

fn verified_build() -> Result<&'static VerifiedCargoBuild, StrategyFamilyError> {
    if BUILD.get().is_none() {
        let build = VerifiedCargoBuild::verify(CargoBuildEvidence {
            wasm_one: WASM_ONE,
            wasm_two: WASM_TWO,
            source_capsule: SOURCE,
            build_recipe: RECIPE,
            runtime_budget: BUDGET,
        })
        .map_err(|error| definition(&error))?;
        let _ = BUILD.set(build);
    }
    Ok(BUILD.get().expect("verified SECAC build initialized"))
}

impl SecacAdapter {
    fn frozen() -> Result<Self, StrategyFamilyError> {
        parse_intent(INTENT_BYTES)?;
        let bindings_identity = secac_program_bindings()?
            .identity()
            .map_err(|error| definition(&error))?;
        verified_build()?;
        Ok(Self {
            bindings_identity,
            evaluator_identity: "secac-formation-evaluator/v3",
        })
    }
}

impl FrozenFamilyDefinition for SecacAdapter {
    fn identity(&self) -> &str {
        INTENT_ID
    }
    fn experiment_id(&self) -> &str {
        EXPERIMENT_ID
    }
    fn canonical_intent_bytes(&self) -> &[u8] {
        INTENT_BYTES
    }
    fn strategy_spec_digest(&self) -> Option<String> {
        Some(self.bindings_identity.clone())
    }
    fn coordinates(&self) -> Vec<(String, String)> {
        TUPLES
            .iter()
            .flat_map(|(tuple, _)| {
                VARIANTS
                    .iter()
                    .map(move |(variant, _)| ((*tuple).into(), (*variant).into()))
            })
            .collect()
    }
    fn prepare_issuance(
        &self,
        parameter_id: &str,
        variant_id: &str,
    ) -> Result<ArtifactIssuance<'_>, StrategyFamilyError> {
        let (parameters, bindings) = secac_program_inputs(parameter_id, variant_id)?;
        if bindings.identity().map_err(|error| definition(&error))? != self.bindings_identity {
            return Err(StrategyFamilyError::ArtifactBinding);
        }
        Ok(ArtifactIssuance::program(
            14,
            INTENT_BYTES,
            Some(self.bindings_identity.clone()),
            Some(format!("{parameter_id}/{variant_id}")),
            Some(parameters),
            verified_build()?,
        ))
    }
}

impl FormationEvaluator for SecacAdapter {
    fn identity(&self) -> &str {
        self.evaluator_identity
    }
    fn selection_policy(&self) -> &str {
        SELECTION
    }
    fn config_bytes(&self) -> Result<Vec<u8>, StrategyFamilyError> {
        Ok(INTENT_BYTES.to_vec())
    }
    fn evaluate(
        &self,
        trials: &[FormationTrialEvidence<'_>],
    ) -> anyhow::Result<FormationProjectionV9> {
        evaluate_bounded_cash_family(
            trials,
            &BoundedCashFormationPolicy {
                variant_count: 5,
                objective_divisors: TUPLES.iter().map(|(id, _)| ((*id).into(), 1)).collect(),
                robustness: RobustnessPolicy {
                    observations: 360,
                    slices: 12,
                    selectable_trials: 2,
                    max_pbo_ppm: 50_000,
                    min_dsr_ppm: 950_000,
                },
            },
        )
    }
}

impl FrozenStrategyFamily {
    pub fn frozen_secac_successor() -> Result<Self, StrategyFamilyError> {
        let adapter = SecacAdapter::frozen()?;
        Self::from_parts(adapter.clone(), adapter)
    }
}

fn secac_program_bindings() -> Result<ProgramHostBindings, StrategyFamilyError> {
    let bars = [
        (1, "BTCUSDT-PERP.BINANCE-15-MINUTE-LAST-EXTERNAL"),
        (2, "ETHUSDT-PERP.BINANCE-15-MINUTE-LAST-EXTERNAL"),
        (3, "BTCUSDT-PERP.BINANCE-1-HOUR-LAST-EXTERNAL"),
        (4, "BTCUSDT-PERP.BINANCE-4-HOUR-LAST-EXTERNAL"),
        (5, "BTCUSDT-PERP.BINANCE-1-DAY-LAST-EXTERNAL"),
        (6, "ETHUSDT-PERP.BINANCE-1-HOUR-LAST-EXTERNAL"),
        (7, "ETHUSDT-PERP.BINANCE-4-HOUR-LAST-EXTERNAL"),
        (8, "ETHUSDT-PERP.BINANCE-1-DAY-LAST-EXTERNAL"),
        (9, "PAXGUSDT.BINANCE-1-DAY-LAST-EXTERNAL"),
    ]
    .into_iter()
    .map(|(channel, value)| Ok((channel, value.parse::<BarType>()?)))
    .collect::<anyhow::Result<Vec<_>>>()
    .map_err(|error| definition(&error))?;
    let mut customs = [
        ("DTWEXBGS", 10),
        ("DEXJPUS", 11),
        ("DCOILWTICO", 12),
        ("DGS2", 13),
        ("DGS10", 14),
    ]
    .into_iter()
    .map(|(series, channel)| {
        ProgramCustomBinding::new::<FredObservation>(
            FredObservation::data_type(series),
            1024,
            channel,
        )
    })
    .collect::<anyhow::Result<Vec<_>>>()
    .map_err(|error| definition(&error))?;
    customs.push(
        ProgramCustomBinding::new::<ScheduledEventObservation>(
            ScheduledEventObservation::data_type(),
            1025,
            15,
        )
        .map_err(|error| definition(&error))?,
    );
    customs.push(
        ProgramCustomBinding::new::<Signal>(
            DataType::new(
                "Signal",
                None,
                Some("VIBE_TRADING/FX_SESSIONS/TOKYO_LONDON_NEW_YORK/V1".into()),
            ),
            1026,
            16,
        )
        .map_err(|error| definition(&error))?,
    );
    let budget = ProgramEffectBudget::new(
        SECAC_MAX_EFFECTS,
        SECAC_MAX_EFFECTS,
        SECAC_MAX_OPENING_SUBMITS,
        [(SECAC_EXECUTABLE, SECAC_MAX_CUMULATIVE_OPENING_QUANTITY)],
    )
    .map_err(|error| definition(&error))?;
    ProgramHostBindings::new(
        [(SECAC_EXECUTABLE, InstrumentId::from("BTCUSDT-PERP.BINANCE"))],
        bars,
        budget,
    )
    .and_then(|bindings| bindings.with_custom(customs))
    .map_err(|error| definition(&error))
}

pub(crate) fn secac_program_inputs(
    parameter_id: &str,
    variant_id: &str,
) -> Result<(Vec<u8>, ProgramHostBindings), StrategyFamilyError> {
    parse_intent(INTENT_BYTES)?;
    let shock_wait = TUPLES
        .iter()
        .find(|(id, _)| *id == parameter_id)
        .map(|(_, value)| *value)
        .ok_or(StrategyFamilyError::ForeignTrial)?;
    let features = VARIANTS
        .iter()
        .find(|(id, _)| *id == variant_id)
        .map(|(_, value)| *value)
        .ok_or(StrategyFamilyError::ForeignTrial)?;
    let mut bytes = Vec::with_capacity(128);
    bytes.extend_from_slice(b"SEC1");
    bytes.push(1);
    bytes.push(shock_wait);
    bytes.extend_from_slice(&features.to_le_bytes());
    for channel in 1_u32..=16 {
        bytes.extend_from_slice(&channel.to_le_bytes());
    }
    for value in [4_u16, 12, 16, 16] {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    for value in [0.010_f64, 0.5, 2.0, 1.5, 0.10, 0.5] {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    debug_assert_eq!(bytes.len(), 128);
    Ok((bytes, secac_program_bindings()?))
}

pub(crate) fn secac_coverage(tags: &[u32]) -> anyhow::Result<BTreeMap<String, usize>> {
    let mut counts = BTreeMap::new();
    for tag in tags {
        let name = COVERAGE_TAGS
            .iter()
            .find(|(known, _)| known == tag)
            .map(|(_, name)| *name)
            .ok_or_else(|| anyhow::anyhow!("unknown SECAC decision tag: {tag}"))?;
        *counts.entry(name.to_string()).or_default() += 1;
    }
    Ok(counts)
}

pub(crate) fn verify_secac_predecessor_receipt(bytes: &[u8]) -> anyhow::Result<()> {
    anyhow::ensure!(
        !bytes.is_empty() && format!("{:x}", Sha256::digest(bytes)) == PREDECESSOR_RECEIPT_SHA256,
        "archived v37 predecessor receipt does not match the SECAC intent binding"
    );
    Ok(())
}

pub(crate) fn secac_starting_balance() -> anyhow::Result<Money> {
    let intent = parse_intent(INTENT_BYTES)?;
    Money::from_str(field(&intent["payload"]["costs"], "initial_balance")?)
        .map_err(anyhow::Error::msg)
}

pub(crate) fn verify_secac_formation_source_projection(actual: &str) -> anyhow::Result<()> {
    let intent = parse_intent(INTENT_BYTES)?;
    anyhow::ensure!(
        intent["payload"]["formation_policy"]["source_projection_blake3"] == actual,
        "SECAC Formation source projection does not match its frozen intent"
    );
    Ok(())
}

fn formation_issuance(run: &OwnedFormationRun) -> anyhow::Result<FormationReceiptIssuance<'_>> {
    let intent = parse_intent(INTENT_BYTES)?;
    let family = FrozenStrategyFamily::frozen_secac_successor()?;
    let payload = &intent["payload"];
    let evidence = payload["evidence"]
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("SECAC evidence is missing"))?
        .iter()
        .map(|item| {
            Ok(ResearchEvidenceReference::new(
                field(item, "id")?.into(),
                field(item, "locator")?.into(),
                field(item, "role")?.into(),
            ))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let non_claims = payload["non_claims"]
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("SECAC non-claims are missing"))?
        .iter()
        .map(|claim| {
            claim
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| anyhow::anyhow!("SECAC non-claim is malformed"))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(FormationReceiptIssuance {
        experiment_id: EXPERIMENT_ID.into(), research_intent_id: INTENT_ID.into(),
        research_intent_digest: family.intent().content_digest().to_string(), family,
        predecessor_intent_digest: "sha256:7f51afa6736fab11266e6e95386c477a526c47233caf6f9638c8840295261961".into(),
        predecessor_disposition: "ECONOMIC_REJECTED".into(),
        predecessor_reason: "archived_v37_candidate_sha256_12c5ac04_receipt_file_sha256_df304ae3_internal_blake3_867513fd_not_reissued_by_successor_harness".into(),
        native_producer_evidence: Some(&run.producer_evidence), formation_admission_reason: None,
        evidence_boundary: FormationEvidenceBoundary::SealedHoldout { partition: "FORMATION_2023_ONLY".into(),
            qualification_policy: format!("ONE_QUALIFICATION_2024_LOGICAL_ATTEMPT_ONLY_AFTER_SURVIVOR_AND_DURABLE_CLAIM:{SECAC_RESERVATION_SHA256}") },
        software_error: run.software_error.clone(),
        trials: run.trials.iter().map(OwnedFormationTrialEvidence::borrowed).collect(),
        aggregate_coverage: run.aggregate_coverage.clone(),
        evidence, non_claims,
    })
}

#[cfg(test)]
pub(crate) fn issue_secac_formation_receipt(
    run: &OwnedFormationRun,
) -> anyhow::Result<FormationFamilyReceipt> {
    FormationFamilyReceipt::issue(&formation_issuance(run)?)
}

pub(crate) fn recover_secac_formation_receipt(
    bytes: &[u8],
    run: &OwnedFormationRun,
) -> anyhow::Result<FormationFamilyReceipt> {
    FormationFamilyReceipt::from_slice(bytes, &formation_issuance(run)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intent_family_and_parameter_abi_are_exact_and_bounded() {
        let first = FrozenStrategyFamily::frozen_secac_successor().unwrap();
        let second = FrozenStrategyFamily::frozen_secac_successor().unwrap();
        assert_eq!(first.family_digest(), second.family_digest());
        assert_eq!(first.trials().len(), 10);
        for trial in first.trials() {
            let (parameters, _) =
                secac_program_inputs(trial.parameter_id(), trial.variant_id()).unwrap();
            assert_eq!(parameters.len(), 128);
            assert_eq!(&parameters[..4], b"SEC1");
        }
        assert_eq!(first.materialize_all().unwrap().len(), 10);
    }

    #[test]
    fn canonical_intent_and_predecessor_receipt_fail_closed() {
        assert!(parse_intent(INTENT_BYTES).is_ok());
        let mut changed = INTENT_BYTES.to_vec();
        changed[10] ^= 1;
        assert!(parse_intent(&changed).is_err());
        assert!(verify_secac_predecessor_receipt(b"foreign").is_err());
        assert_eq!(
            secac_starting_balance().unwrap().to_string(),
            "1000000.00000000 USDT"
        );
        assert!(verify_secac_formation_source_projection("blake3:foreign").is_err());
    }

    #[test]
    fn decision_coverage_is_closed_and_counts_repeats() {
        let coverage = secac_coverage(&[111, 111, 122, 201, 202, 203, 204, 205]).unwrap();
        assert_eq!(coverage["entry_employment_long"], 2);
        assert_eq!(coverage["exit_terminal"], 1);
        assert!(secac_coverage(&[999]).is_err());
    }
}
