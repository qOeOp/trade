use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Display,
    str::FromStr,
    sync::OnceLock,
};

use anyhow::Context;
use sha2::{Digest as _, Sha256};
use vibe_backtest::result::CanonicalBacktestResult;
use vibe_model::{data::BarType, identifiers::InstrumentId, types::Money};

use crate::{
    artifact::ArtifactIssuance,
    cargo_artifact::{CargoBuildEvidence, VerifiedCargoBuild},
    family::{
        FormationEvaluator, FrozenFamilyDefinition, FrozenStrategyFamily, StrategyFamilyError,
    },
    formation_adapters::bounded_cash_deletion_group_survives,
    program_host::{ProgramEffectBudget, ProgramHostBindings},
    program_runtime::ProgramRuntimeBudget,
    receipt::{
        FormationEvidenceBoundary, FormationFamilyDisposition, FormationFamilyReceipt,
        FormationProjectionV9, FormationReceiptIssuance, FormationRobustnessProjection,
        FormationTrialDisposition, FormationTrialEvidence, FormationTrialSelection,
        OwnedFormationRun, OwnedFormationTrialEvidence,
    },
    robustness::{
        FormationRobustnessReport, RobustnessPolicy, analyze_formation_robustness,
        trial_returns_from_canonical,
    },
    software_control::{collect_allowed_instrument_ids, validate_completed_program_terminal},
    status::ResearchEvidenceReference,
};

const INTENT: &[u8] = include_bytes!("../assets/pairs_relative_value_intent_v1.jcs");
const INTENT_SHA256: &str = "7bcff118534924a41d3e4ac9a0d4afffcab381d35df3b77149401a5a24a56823";
const INTENT_ID: &str = "researchintent-strategy-factory-btc-eth-relative-value-v1";
const EXPERIMENT_ID: &str = "btc-eth-relative-value-2023-v1";
const SELECTION: &str = "coord-0/full_is_the_only_selectable_primary_and_must_pass_activity_cost_terminal_repair_submit_and_unresolved_floors_strictly_beat_its_four_deletions_and_pass_fixed_four-coordinate_robustness";
const WASM_ONE: &[u8] = include_bytes!("../assets/pairs_relative_value_v1/program.first.wasm");
const WASM_TWO: &[u8] = include_bytes!("../assets/pairs_relative_value_v1/program.second.wasm");
const SOURCE: &[u8] = include_bytes!("../assets/pairs_relative_value_v1/source-capsule.tar");
const RECIPE: &[u8] = include_bytes!("../assets/pairs_relative_value_v1/build-recipe.jcs");
const RUNTIME: ProgramRuntimeBudget = ProgramRuntimeBudget {
    max_module_bytes: 64 * 1024,
    fuel: 1_000_000,
};
const BTC: &str = "BTCUSDT-PERP.BINANCE";
const ETH: &str = "ETHUSDT-PERP.BINANCE";
const COORDINATES: [(&str, u8, u16, u16, u16, u16); 4] = [
    ("coord-0", 0, 32, 96, 2_000, 500),
    ("coord-1", 1, 32, 96, 2_500, 500),
    ("coord-2", 2, 64, 192, 2_000, 750),
    ("coord-3", 3, 64, 192, 2_500, 750),
];
const VARIANTS: [(&str, u16); 5] = [
    ("full", 15),
    ("without-h1-regime", 14),
    ("without-rolling-variance", 13),
    ("without-convergence", 11),
    ("without-eth-leg", 7),
];
const TAGS: [(u32, &str); 9] = [
    (101, "entry_long_spread"),
    (102, "entry_short_spread"),
    (201, "exit_convergence"),
    (202, "exit_max_hold"),
    (203, "exit_h1_regime"),
    (204, "exit_terminal"),
    (301, "repair_btc"),
    (302, "repair_eth"),
    (303, "repair_both"),
];
static BUILD: OnceLock<VerifiedCargoBuild> = OnceLock::new();

#[derive(Clone)]
struct PairsAdapter {
    bindings_identity: String,
}

fn definition(error: &str) -> StrategyFamilyError {
    StrategyFamilyError::Definition(error.to_string())
}

fn field<'a>(value: &'a serde_json::Value, name: &str) -> anyhow::Result<&'a str> {
    value[name]
        .as_str()
        .with_context(|| format!("pairs intent {name} is missing"))
}

fn parse_intent() -> Result<serde_json::Value, StrategyFamilyError> {
    let intent: serde_json::Value =
        serde_json::from_slice(INTENT).map_err(|e| definition(&e.to_string()))?;
    let mut canonical = serde_json::to_vec(&intent).map_err(|e| definition(&e.to_string()))?;
    canonical.push(b'\n');
    let program = &intent["payload"]["program_contract"];

    if canonical != INTENT
        || format!("{:x}", Sha256::digest(INTENT)) != INTENT_SHA256
        || intent["identity"] != INTENT_ID
        || intent["kind"] != "ResearchIntent"
        || intent["revision"] != "5"
        || intent["schema_version"] != 1
        || intent["payload"]["experiment_id"] != EXPERIMENT_ID
        || intent["payload"]["family"]["selection"] != SELECTION
        || program["build"]["build_recipe_sha256"] != format!("{:x}", Sha256::digest(RECIPE))
        || program["build"]["source_capsule_sha256"] != format!("{:x}", Sha256::digest(SOURCE))
        || program["build"]["wasm_sha256"] != format!("{:x}", Sha256::digest(WASM_ONE))
    {
        return Err(definition("pairs authoritative intent binding mismatch"));
    }
    Ok(intent)
}

fn verified_build() -> Result<&'static VerifiedCargoBuild, StrategyFamilyError> {
    if BUILD.get().is_none() {
        let value = VerifiedCargoBuild::verify(CargoBuildEvidence {
            wasm_one: WASM_ONE,
            wasm_two: WASM_TWO,
            source_capsule: SOURCE,
            build_recipe: RECIPE,
            runtime_budget: RUNTIME,
        })
        .map_err(|e| definition(&e.to_string()))?;
        let _ = BUILD.set(value);
    }
    Ok(BUILD.get().expect("verified pairs build initialized"))
}

impl PairsAdapter {
    fn frozen() -> Result<Self, StrategyFamilyError> {
        parse_intent()?;
        verified_build()?;
        Ok(Self {
            bindings_identity: pairs_bindings()?
                .identity()
                .map_err(|e| definition(&e.to_string()))?,
        })
    }
}

impl FrozenFamilyDefinition for PairsAdapter {
    fn identity(&self) -> &'static str {
        INTENT_ID
    }
    fn experiment_id(&self) -> &str {
        EXPERIMENT_ID
    }
    fn canonical_intent_bytes(&self) -> &[u8] {
        INTENT
    }
    fn strategy_spec_digest(&self) -> Option<String> {
        Some(self.bindings_identity.clone())
    }
    fn coordinates(&self) -> Vec<(String, String)> {
        COORDINATES
            .iter()
            .flat_map(|(coordinate, ..)| {
                VARIANTS
                    .iter()
                    .map(move |(variant, _)| ((*coordinate).into(), (*variant).into()))
            })
            .collect()
    }
    fn prepare_issuance(
        &self,
        parameter_id: &str,
        variant_id: &str,
    ) -> Result<ArtifactIssuance<'_>, StrategyFamilyError> {
        let (parameters, bindings) = pairs_program_inputs(parameter_id, variant_id)?;
        if bindings
            .identity()
            .map_err(|e| definition(&e.to_string()))?
            != self.bindings_identity
        {
            return Err(StrategyFamilyError::ArtifactBinding);
        }
        Ok(ArtifactIssuance::program(
            15,
            INTENT,
            Some(self.bindings_identity.clone()),
            Some(format!("{parameter_id}/{variant_id}")),
            Some(parameters),
            verified_build()?,
        ))
    }
}

impl FormationEvaluator for PairsAdapter {
    fn identity(&self) -> &'static str {
        "pairs-relative-value-formation-evaluator/v1"
    }
    fn selection_policy(&self) -> &'static str {
        SELECTION
    }
    fn config_bytes(&self) -> Result<Vec<u8>, StrategyFamilyError> {
        Ok(INTENT.to_vec())
    }
    fn evaluate(
        &self,
        trials: &[FormationTrialEvidence<'_>],
    ) -> anyhow::Result<FormationProjectionV9> {
        evaluate_pairs(trials)
    }
}

impl FrozenStrategyFamily {
    pub(crate) fn frozen_pairs_relative_value() -> Result<Self, StrategyFamilyError> {
        let adapter = PairsAdapter::frozen()?;
        Self::from_parts(adapter.clone(), adapter)
    }
}

fn pairs_bindings() -> Result<ProgramHostBindings, StrategyFamilyError> {
    let bars = [
        (1, "BTCUSDT-PERP.BINANCE-15-MINUTE-LAST-EXTERNAL"),
        (2, "ETHUSDT-PERP.BINANCE-15-MINUTE-LAST-EXTERNAL"),
        (3, "BTCUSDT-PERP.BINANCE-1-HOUR-LAST-EXTERNAL"),
        (4, "ETHUSDT-PERP.BINANCE-1-HOUR-LAST-EXTERNAL"),
    ]
    .into_iter()
    .map(|(channel, bar)| Ok((channel, bar.parse::<BarType>()?)))
    .collect::<anyhow::Result<Vec<_>>>()
    .map_err(|e| definition(&e.to_string()))?;
    let budget = ProgramEffectBudget::new(6, 6, 2, [(1, 1_000_000.0), (2, 1_000_000.0)])
        .map_err(|e| definition(&e.to_string()))?;
    ProgramHostBindings::new(
        [(1, InstrumentId::from(BTC)), (2, InstrumentId::from(ETH))],
        bars,
        budget,
    )
    .map_err(|e| definition(&e.to_string()))
}

pub(crate) fn pairs_program_inputs(
    parameter_id: &str,
    variant_id: &str,
) -> Result<(Vec<u8>, ProgramHostBindings), StrategyFamilyError> {
    parse_intent()?;
    let &(_, index, window, hold, entry, exit) = COORDINATES
        .iter()
        .find(|(id, ..)| *id == parameter_id)
        .ok_or(StrategyFamilyError::ForeignTrial)?;
    let features = VARIANTS
        .iter()
        .find(|(id, _)| *id == variant_id)
        .map(|(_, mask)| *mask)
        .ok_or(StrategyFamilyError::ForeignTrial)?;
    let mut bytes = vec![0; 96];
    bytes[..4].copy_from_slice(b"PRV1");
    bytes[4] = 1;
    bytes[5] = index;
    bytes[6..8].copy_from_slice(&features.to_le_bytes());
    for (offset, value) in [(8, 1_u32), (12, 2), (16, 1), (20, 2), (24, 3), (28, 4)] {
        bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }

    for (offset, value) in [(32, window), (34, hold), (36, entry), (38, exit)] {
        bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
    }
    bytes[40..48].copy_from_slice(&2_000_f64.to_le_bytes());
    Ok((bytes, pairs_bindings()?))
}

pub(crate) fn pairs_coverage(tags: &[u32]) -> anyhow::Result<BTreeMap<String, usize>> {
    let mut counts = BTreeMap::new();

    for tag in tags {
        let name = TAGS
            .iter()
            .find(|(known, _)| known == tag)
            .map(|(_, name)| *name)
            .with_context(|| format!("unknown pairs decision tag: {tag}"))?;
        *counts.entry(name.to_string()).or_default() += 1;
    }
    Ok(counts)
}

pub(crate) fn validate_pairs_program_terminal(
    result: &CanonicalBacktestResult,
    allow_pair_activity: bool,
) -> anyhow::Result<()> {
    validate_completed_program_terminal(result)?;
    let value = result.as_value();
    let mut observed = BTreeSet::new();
    let mut activity = false;

    for field_name in ["orders", "fills", "positions"] {
        let records = value[field_name]
            .as_array()
            .with_context(|| format!("pairs {field_name} are missing"))?;
        activity |= !records.is_empty();
        for record in records {
            let counts = collect_allowed_instrument_ids(record, &[BTC, ETH])?;
            anyhow::ensure!(
                counts.values().sum::<usize>() > 0,
                "pairs {field_name} record has no instrument identity"
            );
            observed.extend(counts.into_keys());
        }
    }
    validate_activity_domain(allow_pair_activity, activity, &observed)
}

fn validate_activity_domain(
    allow: bool,
    active: bool,
    observed: &BTreeSet<String>,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        allow || !active,
        "without-eth-leg deletion acquired order authority"
    );
    anyhow::ensure!(
        !active || observed == &BTreeSet::from([BTC.to_string(), ETH.to_string()]),
        "active pairs run did not observe both exact executables"
    );
    Ok(())
}

pub(crate) fn pairs_starting_balance() -> anyhow::Result<Money> {
    let intent = parse_intent().map_err(anyhow::Error::msg)?;
    Money::from_str(field(&intent["payload"]["costs"], "initial_balance")?)
        .map_err(anyhow::Error::msg)
}

fn evaluate_pairs(trials: &[FormationTrialEvidence<'_>]) -> anyhow::Result<FormationProjectionV9> {
    anyhow::ensure!(
        trials.len() == 20,
        "pairs family must contain exactly twenty trials"
    );

    for (trial, (coordinate, variant)) in trials.iter().zip(
        COORDINATES
            .iter()
            .flat_map(|(id, ..)| VARIANTS.iter().map(move |(variant, _)| (*id, *variant))),
    ) {
        anyhow::ensure!(
            trial.parameter_id == coordinate && trial.variant_id == variant,
            "pairs family coordinate order changed"
        );
    }
    let mut dispositions = Vec::with_capacity(20);
    for _ in 0..4 {
        dispositions.push(FormationTrialDisposition::EconomicRejected);
        dispositions.extend([FormationTrialDisposition::DeletionControl; 4]);
    }
    let full = &trials[0];
    let cash_and_deletions_survive = bounded_cash_deletion_group_survives(&trials[..5])?;
    let without_eth_empty = trial_activity(&trials[4])? == 0;
    if !(cash_and_deletions_survive && primary_pair_floors(full)? && without_eth_empty) {
        return Ok(rejected(dispositions));
    }
    let drawdown_ppm = match primary_drawdown_ppm(full) {
        Ok(value) => value,
        Err(e) => return Ok(robustness_rejected(dispositions, None, e)),
    };

    if drawdown_ppm > 250_000 {
        return Ok(rejected(dispositions));
    }
    dispositions[0] = FormationTrialDisposition::FormationSurvivorNotQualified;
    let returns = trials
        .iter()
        .step_by(5)
        .map(|trial| {
            trial_returns_from_canonical(
                format!("{}/full", trial.parameter_id),
                trial
                    .canonical_result
                    .context("pairs full result is missing")?,
            )
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let selected = primary_selection();

    match analyze_formation_robustness(
        &returns,
        "coord-0/full",
        RobustnessPolicy {
            observations: 360,
            slices: 12,
            selectable_trials: 4,
            max_pbo_ppm: 50_000,
            min_dsr_ppm: 950_000,
        },
    ) {
        Ok(report) => {
            let robustness = project_robustness(report, drawdown_ppm);
            Ok(FormationProjectionV9 {
                family_disposition: if robustness.passed {
                    FormationFamilyDisposition::FormationSurvivorNotQualified
                } else {
                    FormationFamilyDisposition::FormationRobustnessRejected
                },
                trial_dispositions: dispositions,
                economically_selected: Some(selected.clone()),
                selected: robustness.passed.then_some(selected),
                robustness: Some(robustness),
                robustness_error: None,
            })
        }
        Err(e) => Ok(robustness_rejected(dispositions, Some(selected), e)),
    }
}

fn rejected(trial_dispositions: Vec<FormationTrialDisposition>) -> FormationProjectionV9 {
    FormationProjectionV9 {
        family_disposition: FormationFamilyDisposition::EconomicRejected,
        trial_dispositions,
        economically_selected: None,
        selected: None,
        robustness: None,
        robustness_error: None,
    }
}

fn robustness_rejected(
    trial_dispositions: Vec<FormationTrialDisposition>,
    economically_selected: Option<FormationTrialSelection>,
    error: impl Display,
) -> FormationProjectionV9 {
    FormationProjectionV9 {
        family_disposition: FormationFamilyDisposition::FormationRobustnessRejected,
        trial_dispositions,
        economically_selected,
        selected: None,
        robustness: None,
        robustness_error: Some(format!("{error:#}")),
    }
}

fn primary_selection() -> FormationTrialSelection {
    FormationTrialSelection {
        parameter_id: "coord-0".into(),
        variant_id: "full".into(),
    }
}

fn trial_activity(trial: &FormationTrialEvidence<'_>) -> anyhow::Result<usize> {
    let value = trial
        .canonical_result
        .context("pairs canonical result is missing")?
        .as_value();
    ["orders", "fills", "positions"]
        .into_iter()
        .try_fold(0, |count, field| {
            Ok(count
                + value[field]
                    .as_array()
                    .with_context(|| format!("pairs {field} are missing"))?
                    .len())
        })
}

fn primary_pair_floors(trial: &FormationTrialEvidence<'_>) -> anyhow::Result<bool> {
    let result = trial
        .canonical_result
        .context("pairs primary result is missing")?
        .as_value();
    let submits = result["orders"]
        .as_array()
        .context("pairs orders are missing")?
        .len();
    let unresolved = ["orders.open", "orders.inflight", "positions.open"]
        .into_iter()
        .any(|key| result["summary"][key] != "0");
    Ok(valid_repair_pattern(&trial.coverage) && submits <= 6 && !unresolved)
}

fn valid_repair_pattern(coverage: &BTreeMap<String, usize>) -> bool {
    matches!(
        (
            coverage.get("repair_btc").copied().unwrap_or_default(),
            coverage.get("repair_eth").copied().unwrap_or_default(),
            coverage.get("repair_both").copied().unwrap_or_default(),
        ),
        (0 | 1, 0, 0) | (0, 1, 0) | (0, 0, 2)
    )
}

fn primary_drawdown_ppm(trial: &FormationTrialEvidence<'_>) -> anyhow::Result<u32> {
    let returns = trial_returns_from_canonical(
        "coord-0/full".into(),
        trial
            .canonical_result
            .context("pairs primary result is missing")?,
    )?;
    anyhow::ensure!(
        returns.returns.len() >= 360,
        "pairs drawdown series is too short"
    );
    let (mut wealth, mut peak, mut maximum) = (1.0_f64, 1.0_f64, 0.0_f64);
    for value in returns.returns.values().take(360) {
        wealth *= 1.0 + value;
        anyhow::ensure!(
            wealth.is_finite() && wealth > 0.0,
            "pairs compounded return is invalid"
        );
        peak = peak.max(wealth);
        maximum = maximum.max((peak - wealth) / peak);
    }
    Ok((maximum * 1_000_000.0).ceil() as u32)
}

fn project_robustness(
    report: FormationRobustnessReport,
    drawdown_ppm: u32,
) -> FormationRobustnessProjection {
    FormationRobustnessProjection {
        passed: report.passed,
        diagnostics: BTreeMap::from([
            ("method".into(), "CSCV_PBO_AND_DSR_FIXED_PRIMARY".into()),
            ("observation_source".into(), report.observation_source),
            ("pbo_ppm".into(), report.pbo_ppm.to_string()),
            ("max_pbo_ppm".into(), report.max_pbo_ppm.to_string()),
            ("dsr_ppm".into(), report.dsr_ppm.to_string()),
            ("min_dsr_ppm".into(), report.min_dsr_ppm.to_string()),
            ("primary_max_drawdown_ppm".into(), drawdown_ppm.to_string()),
            ("max_drawdown_ppm".into(), "250000".into()),
        ]),
    }
}

fn formation_issuance(run: &OwnedFormationRun) -> anyhow::Result<FormationReceiptIssuance<'_>> {
    let intent = parse_intent().map_err(anyhow::Error::msg)?;
    let payload = &intent["payload"];
    let evidence = payload["evidence"]
        .as_array()
        .context("pairs evidence is missing")?
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
        .context("pairs non-claims are missing")?
        .iter()
        .map(|claim| {
            claim
                .as_str()
                .map(str::to_string)
                .context("pairs non-claim is malformed")
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let family = FrozenStrategyFamily::frozen_pairs_relative_value()?;
    Ok(FormationReceiptIssuance {
        experiment_id: EXPERIMENT_ID.into(), research_intent_id: INTENT_ID.into(),
        research_intent_digest: family.intent().content_digest().into(), family,
        predecessor_intent_digest: "blake3:e3ad92c1780539793dc6da7312f4698ecce7590a0c8daf9c6e951c67e369c3e3".into(),
        predecessor_disposition: "REVIEWED_PROPOSAL_NOT_AUTHORITY".into(),
        predecessor_reason: "proposal_packet_d8f4468d_exact_product_promoted_without_2024_data_result_qualification_or_execution_authority".into(),
        native_producer_evidence: Some(&run.producer_evidence), formation_admission_reason: None,
        evidence_boundary: FormationEvidenceBoundary::SealedHoldout {
            partition: "FORMATION_2023_ONLY".into(),
            qualification_policy: "2024_SEALED_UNREAD_NOT_AUTHORIZED_NO_QUALIFICATION_CLAIM".into(),
        },
        software_error: run.software_error.clone(),
        trials: run.trials.iter().map(OwnedFormationTrialEvidence::borrowed).collect(),
        aggregate_coverage: run.aggregate_coverage.clone(), evidence, non_claims,
    })
}

pub(crate) fn issue_pairs_relative_value_receipt(
    run: &OwnedFormationRun,
) -> anyhow::Result<FormationFamilyReceipt> {
    FormationFamilyReceipt::issue(&formation_issuance(run)?)
}

pub(crate) fn recover_pairs_relative_value_receipt(
    bytes: &[u8],
    run: &OwnedFormationRun,
) -> anyhow::Result<FormationFamilyReceipt> {
    FormationFamilyReceipt::from_slice(bytes, &formation_issuance(run)?)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn exact_family_and_abi_are_stable() {
        let first = FrozenStrategyFamily::frozen_pairs_relative_value().unwrap();
        let second = FrozenStrategyFamily::frozen_pairs_relative_value().unwrap();
        assert_eq!(first.family_digest(), second.family_digest());
        assert_eq!(first.trials().len(), 20);
        for trial in first.trials() {
            let (parameters, _) =
                pairs_program_inputs(trial.parameter_id(), trial.variant_id()).unwrap();
            assert_eq!(parameters.len(), 96);
            assert_eq!(&parameters[..5], b"PRV1\x01");
            assert_eq!(&parameters[48..], &[0; 48]);
        }
        assert_eq!(first.materialize_all().unwrap().len(), 20);
    }

    #[rstest]
    fn intent_product_and_coordinate_surface_fail_closed() {
        assert!(parse_intent().is_ok());
        assert_eq!(
            format!("{:x}", Sha256::digest(WASM_ONE)),
            "11296228d9cc1927cd6b5606cb4f1155cf951fd95c515cc51dd4c21afc0568b6"
        );
        assert!(pairs_program_inputs("coord-4", "full").is_err());
        assert!(pairs_program_inputs("coord-0", "unknown").is_err());
        assert_eq!(
            pairs_starting_balance().unwrap().to_string(),
            "1000000.00000000 USDT"
        );
    }

    #[rstest]
    fn coverage_and_recursive_instrument_domain_are_closed() {
        let coverage = pairs_coverage(&[101, 101, 204, 301, 303]).unwrap();
        assert_eq!(coverage["entry_long_spread"], 2);
        assert_eq!(coverage["repair_both"], 1);
        assert!(pairs_coverage(&[401]).is_err());
        let value = serde_json::json!({"events":[{"instrument_id":BTC},{"instrument_id":ETH}]});
        let observed = collect_allowed_instrument_ids(&value, &[BTC, ETH]).unwrap();
        assert_eq!(observed.values().sum::<usize>(), 2);
        assert_eq!(
            observed.keys().cloned().collect::<BTreeSet<_>>(),
            pair_set()
        );
        assert!(
            collect_allowed_instrument_ids(
                &serde_json::json!({"instrument_id":"SOLUSDT-PERP.BINANCE"}),
                &[BTC, ETH]
            )
            .is_err()
        );
        assert!(validate_activity_domain(true, false, &BTreeSet::new()).is_ok());
        assert!(validate_activity_domain(false, false, &BTreeSet::new()).is_ok());
        assert!(validate_activity_domain(true, true, &pair_set()).is_ok());
        assert!(validate_activity_domain(true, true, &BTreeSet::from([BTC.to_string()])).is_err());
        assert!(validate_activity_domain(false, true, &pair_set()).is_err());
    }

    #[rstest]
    fn fixed_primary_deletions_and_repair_batches_are_fail_closed() {
        let selection = primary_selection();
        assert_eq!(
            (
                selection.parameter_id.as_str(),
                selection.variant_id.as_str()
            ),
            ("coord-0", "full")
        );

        for values in [(0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 2)] {
            assert!(valid_repair_pattern(&repair_coverage(values)));
        }

        for values in [(1, 1, 0), (0, 0, 1), (2, 0, 0), (0, 0, 3)] {
            assert!(!valid_repair_pattern(&repair_coverage(values)));
        }
    }

    fn repair_coverage((btc, eth, both): (usize, usize, usize)) -> BTreeMap<String, usize> {
        BTreeMap::from([
            ("repair_btc".into(), btc),
            ("repair_eth".into(), eth),
            ("repair_both".into(), both),
        ])
    }

    fn pair_set() -> BTreeSet<String> {
        BTreeSet::from([BTC.to_string(), ETH.to_string()])
    }
}
