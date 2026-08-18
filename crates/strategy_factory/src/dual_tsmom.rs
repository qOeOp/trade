use std::{
    collections::{BTreeMap, BTreeSet},
    str::FromStr,
    sync::OnceLock,
};

use anyhow::Context;
use sha2::{Digest as _, Sha256};
use strategy_factory_program_sdk::ProgramRunScope;
use vibe_backtest::result::CanonicalBacktestResult;
use vibe_model::{data::BarType, identifiers::InstrumentId, types::Money};

use crate::{
    artifact::ArtifactIssuance,
    cargo_artifact::{CargoBuildEvidence, VerifiedCargoBuild},
    family::{
        FormationEvaluator, FrozenFamilyDefinition, FrozenStrategyFamily, StrategyFamilyError,
    },
    formation_adapters::{bounded_cash_deletion_group_survives, bounded_cash_trial_survives},
    program_host::{ProgramEffectBudget, ProgramHostBindings},
    program_runtime::ProgramRuntimeBudget,
    receipt::{
        FormationEvidenceBoundary, FormationFamilyDisposition, FormationFamilyReceipt,
        FormationProjectionV9, FormationReceiptIssuance, FormationRobustnessProjection,
        FormationTrialDisposition, FormationTrialEvidence, FormationTrialSelection,
        OwnedFormationRun, OwnedFormationTrialEvidence,
    },
    software_control::{collect_allowed_instrument_ids, validate_completed_program_terminal},
    status::ResearchEvidenceReference,
};

const INTENT: &[u8] = include_bytes!("../assets/dual_tsmom_intent_v1.jcs");
const INTENT_SHA256: &str = "dfd12978c4ce98fa573823af1276171a40f42938ddb13a587e0e0f793f972ea2";
const INTENT_ID: &str = "researchintent-strategy-factory-btc-eth-dual-tsmom-v1";
const EXPERIMENT_ID: &str = "btc-eth-dual-tsmom-2023-v1";
const SELECTION: &str = "coord-0/lookback-60-full_is_the_only_selectable_primary_and_must_pass_activity_cost_terminal_floors_strictly_beat_two_fixed_deletions_while_both_nonselectable_sensitivities_must_independently_pass_the_same_basic_floor";
const WASM_ONE: &[u8] = include_bytes!("../assets/dual_tsmom_v1/program.first.wasm");
const WASM_TWO: &[u8] = include_bytes!("../assets/dual_tsmom_v1/program.second.wasm");
const SOURCE: &[u8] = include_bytes!("../assets/dual_tsmom_v1/source-capsule.tar");
const RECIPE: &[u8] = include_bytes!("../assets/dual_tsmom_v1/build-recipe.jcs");
const RUNTIME: ProgramRuntimeBudget = ProgramRuntimeBudget {
    max_module_bytes: 64 * 1024,
    fuel: 1_000_000,
};
const BTC: &str = "BTCUSDT-PERP.BINANCE";
const ETH: &str = "ETHUSDT-PERP.BINANCE";
const DECISION_START_NS: u64 = 1_672_532_099_999_000_000;
const RUN_END_NS: u64 = 1_704_068_099_999_000_000;
const COORDINATES: [(&str, &str, u8); 5] = [
    ("lookback-60", "full", 0),
    ("lookback-60", "without-eth", 1),
    ("lookback-60", "without-persistence", 2),
    ("lookback-30", "full", 3),
    ("lookback-90", "full", 4),
];
const TAGS: [(u32, &str); 8] = [
    (101, "open_btc"),
    (102, "open_eth"),
    (201, "close_btc"),
    (202, "close_eth"),
    (211, "terminal_btc"),
    (212, "terminal_eth"),
    (301, "drain_btc"),
    (302, "drain_eth"),
];
static BUILD: OnceLock<VerifiedCargoBuild> = OnceLock::new();

#[derive(Clone)]
struct DualTsmomAdapter {
    bindings_identity: String,
}

fn definition(error: &str) -> StrategyFamilyError {
    StrategyFamilyError::Definition(error.to_string())
}

fn field<'a>(value: &'a serde_json::Value, name: &str) -> anyhow::Result<&'a str> {
    value[name]
        .as_str()
        .with_context(|| format!("dual TSMOM intent {name} is missing"))
}

fn parse_intent() -> Result<serde_json::Value, StrategyFamilyError> {
    let intent: serde_json::Value =
        serde_json::from_slice(INTENT).map_err(|e| definition(&e.to_string()))?;
    let mut canonical = serde_json::to_vec(&intent).map_err(|e| definition(&e.to_string()))?;
    canonical.push(b'\n');
    let program = &intent["payload"]["program_contract"];
    let budget = &program["effect_budget"];

    if canonical != INTENT
        || format!("{:x}", Sha256::digest(INTENT)) != INTENT_SHA256
        || intent["identity"] != INTENT_ID
        || intent["kind"] != "ResearchIntent"
        || intent["revision"] != "1"
        || intent["schema_version"] != 1
        || intent["payload"]["experiment_id"] != EXPERIMENT_ID
        || intent["payload"]["family"]["selection"] != SELECTION
        || program["build"]["build_recipe_sha256"] != format!("{:x}", Sha256::digest(RECIPE))
        || program["build"]["source_capsule_sha256"] != format!("{:x}", Sha256::digest(SOURCE))
        || program["build"]["wasm_sha256"] != format!("{:x}", Sha256::digest(WASM_ONE))
        || budget["dmax_paired_d1_slots"] != 365
        || budget["max_total_effects"] != 732
        || budget["max_submits"] != 732
        || budget["max_opening_submits"] != 366
        || budget["btc_opening_quantity"] != "1.83"
        || budget["eth_opening_quantity"] != "18.3"
    {
        return Err(definition(
            "dual TSMOM authoritative intent binding mismatch",
        ));
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
            runtime_budget: RUNTIME,
        })
        .map_err(|e| definition(&e.to_string()))?;
        let _ = BUILD.set(build);
    }
    Ok(BUILD.get().expect("verified dual TSMOM build initialized"))
}

impl DualTsmomAdapter {
    fn frozen() -> Result<Self, StrategyFamilyError> {
        parse_intent()?;
        verified_build()?;
        Ok(Self {
            bindings_identity: dual_tsmom_bindings()?
                .identity()
                .map_err(|e| definition(&e.to_string()))?,
        })
    }
}

impl FrozenFamilyDefinition for DualTsmomAdapter {
    fn identity(&self) -> &str {
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
            .map(|(parameter, variant, _)| ((*parameter).into(), (*variant).into()))
            .collect()
    }

    fn prepare_issuance(
        &self,
        parameter_id: &str,
        variant_id: &str,
    ) -> Result<ArtifactIssuance<'_>, StrategyFamilyError> {
        let (parameters, bindings) = dual_tsmom_program_inputs(parameter_id, variant_id)?;
        if bindings
            .identity()
            .map_err(|e| definition(&e.to_string()))?
            != self.bindings_identity
        {
            return Err(StrategyFamilyError::ArtifactBinding);
        }
        Ok(ArtifactIssuance::program(
            16,
            INTENT,
            Some(self.bindings_identity.clone()),
            Some(format!("{parameter_id}/{variant_id}")),
            Some(parameters),
            verified_build()?,
        ))
    }
}

impl FormationEvaluator for DualTsmomAdapter {
    fn identity(&self) -> &'static str {
        "dual-tsmom-formation-evaluator/v1"
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
        evaluate_dual_tsmom(trials)
    }
}

impl FrozenStrategyFamily {
    pub(crate) fn frozen_dual_tsmom() -> Result<Self, StrategyFamilyError> {
        let adapter = DualTsmomAdapter::frozen()?;
        Self::from_parts(adapter.clone(), adapter)
    }
}

fn dual_tsmom_bindings() -> Result<ProgramHostBindings, StrategyFamilyError> {
    let bars = [
        (1, "BTCUSDT-PERP.BINANCE-1-DAY-LAST-EXTERNAL"),
        (2, "ETHUSDT-PERP.BINANCE-1-DAY-LAST-EXTERNAL"),
        (3, "BTCUSDT-PERP.BINANCE-1-HOUR-LAST-EXTERNAL"),
        (4, "ETHUSDT-PERP.BINANCE-1-HOUR-LAST-EXTERNAL"),
    ]
    .into_iter()
    .map(|(channel, bar)| Ok((channel, bar.parse::<BarType>()?)))
    .collect::<anyhow::Result<Vec<_>>>()
    .map_err(|e| definition(&e.to_string()))?;
    let budget = ProgramEffectBudget::new(732, 732, 366, [(1, 1.83), (2, 18.3)])
        .map_err(|e| definition(&e.to_string()))?;
    ProgramHostBindings::new(
        [(1, InstrumentId::from(BTC)), (2, InstrumentId::from(ETH))],
        bars,
        budget,
    )
    .map_err(|e| definition(&e.to_string()))
}

pub(crate) fn validate_dual_tsmom_source_projection(
    run_scope: ProgramRunScope,
    bar_types: &BTreeSet<BarType>,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        run_scope.decision_start_ns == DECISION_START_NS && run_scope.end_ns == RUN_END_NS,
        "dual TSMOM 365-slot decision scope changed"
    );

    for bar in [
        "BTCUSDT-PERP.BINANCE-1-DAY-LAST-EXTERNAL",
        "ETHUSDT-PERP.BINANCE-1-DAY-LAST-EXTERNAL",
        "BTCUSDT-PERP.BINANCE-1-HOUR-LAST-EXTERNAL",
        "ETHUSDT-PERP.BINANCE-1-HOUR-LAST-EXTERNAL",
    ] {
        anyhow::ensure!(
            bar_types.contains(&bar.parse::<BarType>()?),
            "dual TSMOM required frozen bar channel is absent"
        );
    }
    Ok(())
}

pub(crate) fn dual_tsmom_program_inputs(
    parameter_id: &str,
    variant_id: &str,
) -> Result<(Vec<u8>, ProgramHostBindings), StrategyFamilyError> {
    parse_intent()?;
    let coordinate = COORDINATES
        .iter()
        .find(|(parameter, variant, _)| *parameter == parameter_id && *variant == variant_id)
        .map(|(_, _, coordinate)| *coordinate)
        .ok_or(StrategyFamilyError::ForeignTrial)?;
    let specs = [
        (3_u16, 60_u16, 2_u16),
        (2, 60, 2),
        (1, 60, 1),
        (3, 30, 2),
        (3, 90, 2),
    ];
    let (features, lookback, persistence) = specs[usize::from(coordinate)];
    let mut parameters = [0_u8; 64];
    parameters[..4].copy_from_slice(b"TSM1");
    parameters[4] = 1;
    parameters[5] = coordinate;
    parameters[6..8].copy_from_slice(&features.to_le_bytes());
    for (index, value) in [1_u32, 2, 1, 2, 3, 4].into_iter().enumerate() {
        parameters[8 + index * 4..12 + index * 4].copy_from_slice(&value.to_le_bytes());
    }
    parameters[32..34].copy_from_slice(&lookback.to_le_bytes());
    parameters[34..36].copy_from_slice(&persistence.to_le_bytes());
    parameters[40..48].copy_from_slice(&0.01_f64.to_le_bytes());
    parameters[48..56].copy_from_slice(&0.1_f64.to_le_bytes());
    Ok((parameters.to_vec(), dual_tsmom_bindings()?))
}

pub(crate) fn dual_tsmom_coverage(tags: &[u32]) -> anyhow::Result<BTreeMap<String, usize>> {
    let mut coverage = TAGS
        .iter()
        .map(|(_, name)| ((*name).to_string(), 0))
        .collect::<BTreeMap<_, _>>();

    for tag in tags {
        let name = TAGS
            .iter()
            .find(|(candidate, _)| candidate == tag)
            .map(|(_, name)| *name)
            .with_context(|| format!("unknown dual TSMOM decision tag {tag}"))?;
        *coverage.get_mut(name).expect("known coverage tag") += 1;
    }
    Ok(coverage)
}

pub(crate) fn validate_dual_tsmom_terminal(
    result: &CanonicalBacktestResult,
    allow_eth: bool,
) -> anyhow::Result<()> {
    validate_completed_program_terminal(result)?;
    let observed = collect_allowed_instrument_ids(result.as_value(), &[BTC, ETH])?;
    anyhow::ensure!(
        allow_eth || observed.get(ETH).copied().unwrap_or_default() == 0,
        "without-ETH deletion acquired ETH order authority"
    );
    let orders = result.as_value()["orders"]
        .as_array()
        .context("dual TSMOM orders are missing")?;
    anyhow::ensure!(orders.len() <= 732, "dual TSMOM submit cap was exceeded");
    Ok(())
}

pub(crate) fn dual_tsmom_starting_balance() -> anyhow::Result<Money> {
    let intent = parse_intent().map_err(anyhow::Error::msg)?;
    Money::from_str(field(&intent["payload"]["costs"], "initial_balance")?)
        .map_err(anyhow::Error::msg)
}

fn evaluate_dual_tsmom(
    trials: &[FormationTrialEvidence<'_>],
) -> anyhow::Result<FormationProjectionV9> {
    anyhow::ensure!(
        trials.len() == 5,
        "dual TSMOM family must contain five trials"
    );

    for (trial, (parameter, variant, _)) in trials.iter().zip(COORDINATES) {
        anyhow::ensure!(
            trial.parameter_id == parameter && trial.variant_id == variant,
            "dual TSMOM coordinate order changed"
        );
    }
    let mut dispositions = vec![
        FormationTrialDisposition::EconomicRejected,
        FormationTrialDisposition::DeletionControl,
        FormationTrialDisposition::DeletionControl,
        FormationTrialDisposition::EconomicRejected,
        FormationTrialDisposition::EconomicRejected,
    ];

    if !bounded_cash_deletion_group_survives(&trials[..3])? || !primary_floors(&trials[0])? {
        return Ok(rejected(dispositions));
    }
    dispositions[0] = FormationTrialDisposition::FormationSurvivorNotQualified;
    let selected = primary_selection();
    let sensitivity = [
        bounded_cash_trial_survives(&trials[3])?,
        bounded_cash_trial_survives(&trials[4])?,
    ];
    let passed = sensitivity.into_iter().all(|value| value);
    Ok(FormationProjectionV9 {
        family_disposition: if passed {
            FormationFamilyDisposition::FormationSurvivorNotQualified
        } else {
            FormationFamilyDisposition::FormationRobustnessRejected
        },
        trial_dispositions: dispositions,
        economically_selected: Some(selected.clone()),
        selected: passed.then_some(selected),
        robustness: Some(sensitivity_projection(sensitivity)),
        robustness_error: None,
    })
}

fn primary_floors(trial: &FormationTrialEvidence<'_>) -> anyhow::Result<bool> {
    let coverage = &trial.coverage;
    let drain_btc = coverage.get("drain_btc").copied().unwrap_or_default();
    let drain_eth = coverage.get("drain_eth").copied().unwrap_or_default();
    let submits = coverage.values().try_fold(0_usize, |total, count| {
        total
            .checked_add(*count)
            .context("dual TSMOM coverage count overflow")
    })?;
    Ok(drain_btc <= 1 && drain_eth <= 1 && submits <= 732)
}

fn primary_selection() -> FormationTrialSelection {
    FormationTrialSelection {
        parameter_id: "lookback-60".into(),
        variant_id: "full".into(),
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

fn sensitivity_projection(passed: [bool; 2]) -> FormationRobustnessProjection {
    FormationRobustnessProjection {
        passed: passed.into_iter().all(|value| value),
        diagnostics: BTreeMap::from([
            (
                "method".into(),
                "FIXED_NONSELECTABLE_SENSITIVITY_FLOORS".into(),
            ),
            ("lookback_30_passed".into(), passed[0].to_string()),
            ("lookback_90_passed".into(), passed[1].to_string()),
        ]),
    }
}

fn formation_issuance(run: &OwnedFormationRun) -> anyhow::Result<FormationReceiptIssuance<'_>> {
    let intent = parse_intent().map_err(anyhow::Error::msg)?;
    let payload = &intent["payload"];
    let evidence = payload["evidence"]
        .as_array()
        .context("dual TSMOM evidence is missing")?
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
        .context("dual TSMOM non-claims are missing")?
        .iter()
        .map(|claim| {
            claim
                .as_str()
                .map(str::to_string)
                .context("dual TSMOM non-claim is malformed")
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let family = FrozenStrategyFamily::frozen_dual_tsmom()?;
    Ok(FormationReceiptIssuance {
        experiment_id: EXPERIMENT_ID.into(),
        research_intent_id: INTENT_ID.into(),
        research_intent_digest: family.intent().content_digest().into(),
        family,
        predecessor_intent_digest: "blake3:28191a097e655a7a0245ad8fbc8abd1484f0247019d57a3e5d654cfa2b0a2b66".into(),
        predecessor_disposition: "REVIEWED_PROPOSAL_NOT_AUTHORITY".into(),
        predecessor_reason: "proposal_packet_ced1adda_exact_product_promoted_without_2024_data_result_qualification_or_execution_authority".into(),
        native_producer_evidence: Some(&run.producer_evidence),
        formation_admission_reason: None,
        evidence_boundary: FormationEvidenceBoundary::SealedHoldout {
            partition: "FORMATION_2023_ONLY".into(),
            qualification_policy: "2024_SEALED_UNREAD_NOT_AUTHORIZED_NO_QUALIFICATION_CLAIM".into(),
        },
        software_error: run.software_error.clone(),
        trials: run
            .trials
            .iter()
            .map(OwnedFormationTrialEvidence::borrowed)
            .collect(),
        aggregate_coverage: run.aggregate_coverage.clone(),
        evidence,
        non_claims,
    })
}

pub(crate) fn issue_dual_tsmom_receipt(
    run: &OwnedFormationRun,
) -> anyhow::Result<FormationFamilyReceipt> {
    FormationFamilyReceipt::issue(&formation_issuance(run)?)
}

pub(crate) fn recover_dual_tsmom_receipt(
    bytes: &[u8],
    run: &OwnedFormationRun,
) -> anyhow::Result<FormationFamilyReceipt> {
    FormationFamilyReceipt::from_slice(bytes, &formation_issuance(run)?)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;
    use crate::{artifact::StrategyArtifact, receipt::FormationTrialProjection};

    #[rstest]
    fn exact_family_build_budget_and_abi_are_stable() {
        let first = FrozenStrategyFamily::frozen_dual_tsmom().unwrap();
        let second = FrozenStrategyFamily::frozen_dual_tsmom().unwrap();
        assert_eq!(first.family_digest(), second.family_digest());
        assert_eq!(first.trials().len(), 5);
        assert_eq!(first.materialize_all().unwrap().len(), 5);
        for (index, trial) in first.trials().iter().enumerate() {
            let (parameters, _) =
                dual_tsmom_program_inputs(trial.parameter_id(), trial.variant_id()).unwrap();
            assert_eq!(parameters.len(), 64);
            assert_eq!(&parameters[..5], b"TSM1\x01");
            assert_eq!(parameters[5], index as u8);
        }
        assert_eq!(
            format!("{:x}", Sha256::digest(WASM_ONE)),
            "0d1b260c3ba52cd6ec20e09007dc54a5d11a7772b5bf50b159bf16ac631c77c3"
        );
    }

    #[rstest]
    fn intent_coordinate_and_coverage_domains_fail_closed() {
        assert!(parse_intent().is_ok());
        assert!(dual_tsmom_program_inputs("lookback-60", "unknown").is_err());
        assert!(dual_tsmom_program_inputs("lookback-31", "full").is_err());
        assert!(dual_tsmom_coverage(&[101, 202, 301]).is_ok());
        assert!(dual_tsmom_coverage(&[999]).is_err());
        assert_eq!(
            dual_tsmom_starting_balance().unwrap().to_string(),
            "1000000.00000000 USDT"
        );
    }

    #[rstest]
    fn fixed_primary_deletions_and_sensitivities_cannot_reselect() {
        let family = FrozenStrategyFamily::frozen_dual_tsmom().unwrap();
        let artifacts = family.materialize_all().unwrap();

        let passing = projected_trials(
            &family,
            &artifacts,
            [
                "10.00000000 USDT",
                "9.00000000 USDT",
                "8.00000000 USDT",
                "2.00000000 USDT",
                "2.00000000 USDT",
            ],
        );
        let accepted = evaluate_dual_tsmom(&passing).unwrap();
        assert_eq!(
            accepted.family_disposition,
            FormationFamilyDisposition::FormationSurvivorNotQualified
        );
        assert_eq!(
            accepted.selected,
            Some(FormationTrialSelection {
                parameter_id: "lookback-60".into(),
                variant_id: "full".into(),
            })
        );

        let primary_failed = projected_trials(
            &family,
            &artifacts,
            [
                "1.00000000 USDT",
                "0.00000000 USDT",
                "-1.00000000 USDT",
                "100.00000000 USDT",
                "100.00000000 USDT",
            ],
        );
        let rejected = evaluate_dual_tsmom(&primary_failed).unwrap();
        assert_eq!(
            rejected.family_disposition,
            FormationFamilyDisposition::EconomicRejected
        );
        assert!(rejected.selected.is_none());

        let deletion_tied = projected_trials(
            &family,
            &artifacts,
            [
                "10.00000000 USDT",
                "10.00000000 USDT",
                "8.00000000 USDT",
                "100.00000000 USDT",
                "100.00000000 USDT",
            ],
        );
        assert_eq!(
            evaluate_dual_tsmom(&deletion_tied)
                .unwrap()
                .family_disposition,
            FormationFamilyDisposition::EconomicRejected
        );

        let sensitivity_failed = projected_trials(
            &family,
            &artifacts,
            [
                "10.00000000 USDT",
                "9.00000000 USDT",
                "8.00000000 USDT",
                "1.00000000 USDT",
                "2.00000000 USDT",
            ],
        );
        let robustness = evaluate_dual_tsmom(&sensitivity_failed).unwrap();
        assert_eq!(
            robustness.family_disposition,
            FormationFamilyDisposition::FormationRobustnessRejected
        );
        assert!(robustness.economically_selected.is_some());
        assert!(robustness.selected.is_none());
    }

    fn projected_trials<'a>(
        family: &FrozenStrategyFamily,
        artifacts: &'a [StrategyArtifact],
        objectives: [&str; 5],
    ) -> Vec<FormationTrialEvidence<'a>> {
        family
            .trials()
            .iter()
            .zip(artifacts)
            .zip(objectives)
            .map(|((trial, artifact), objective)| FormationTrialEvidence {
                parameter_id: trial.parameter_id().to_string(),
                variant_id: trial.variant_id().to_string(),
                parameters_digest: trial.parameters_digest().to_string(),
                artifact_identity: artifact.identity(),
                canonical_result: None,
                source_manifest_digest: Some("blake3:test-source".into()),
                source_counts: BTreeMap::from([("paired_d1_slots".into(), 365)]),
                projection: Some(FormationTrialProjection {
                    outcome: BTreeMap::from([
                        ("completed_round_trips".into(), "1".into()),
                        ("starting_balance".into(), "100.00000000 USDT".into()),
                        ("ending_balance".into(), "110.00000000 USDT".into()),
                        ("net_pnl_after_native_commissions".into(), objective.into()),
                        ("native_commissions".into(), "1.00000000 USDT".into()),
                        ("terminal_state".into(), "FLAT".into()),
                    ]),
                }),
                coverage: BTreeMap::new(),
                software_error: None,
            })
            .collect()
    }
}
