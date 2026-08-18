use std::{collections::BTreeMap, str::FromStr};

use anyhow::Context;
use vibe_backtest::result::CanonicalBacktestResult;
use vibe_model::types::Money;

use crate::{
    artifact::StrategyArtifactIdentity,
    experiment::PriceOnlyResearchIntent,
    family::{FrozenStrategyFamily, StrategyTrial},
    family_adapters::{
        REPRESENTATIVE_FORMATION_PREDECESSOR_DISPOSITION,
        REPRESENTATIVE_FORMATION_PREDECESSOR_REASON, REPRESENTATIVE_FORMATION_RETROSPECTIVE_REASON,
        REPRESENTATIVE_FORMATION_SNAPSHOT_SEMANTICS, representative_formation_evidence,
        representative_formation_non_claims,
    },
    intent::PilotResearchIntent,
    producer::NativeProducerEvidence,
    receipt::{
        FormationEvidenceBoundary, FormationFamilyReceipt, FormationProjectionV9,
        FormationReceiptIssuance, FormationRobustnessProjection, FormationTrialDisposition,
        FormationTrialEvidence, FormationTrialProjection, FormationTrialSelection,
        OwnedFormationRun, OwnedFormationTrialEvidence,
    },
    research::REPRESENTATIVE_INTENT_SHA256,
    robustness::{
        FormationRobustnessReport, RobustnessPolicy, analyze_formation_robustness,
        trial_returns_from_canonical,
    },
    status::ResearchEvidenceReference,
};

const CASH_COMPLETED_ROUND_TRIPS: &str = "completed_round_trips";
const CASH_STARTING_BALANCE: &str = "starting_balance";
const CASH_ENDING_BALANCE: &str = "ending_balance";
const CASH_NET_PNL: &str = "net_pnl_after_native_commissions";
const CASH_NATIVE_COMMISSIONS: &str = "native_commissions";
const CASH_TERMINAL_STATE: &str = "terminal_state";
const PRICE_REQUIRED_COVERAGE: [&str; 5] = [
    "enter_trend",
    "enter_reversal",
    "exit_trailing",
    "exit_channel",
    "exit_regime",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FormationAccountLedger {
    Cash,
    Margin,
}

/// Strategy-neutral economic/deletion/robustness inputs frozen by one family adapter.
pub(crate) struct BoundedCashFormationPolicy {
    pub(crate) variant_count: usize,
    pub(crate) objective_divisors: BTreeMap<String, u32>,
    pub(crate) robustness: RobustnessPolicy,
}

impl FormationAccountLedger {
    const fn json_key(self) -> &'static str {
        match self {
            Self::Cash => "Cash",
            Self::Margin => "Margin",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ComplexDecisionCoverage {
    pub(crate) enter_trend: usize,
    pub(crate) enter_reversal: usize,
    pub(crate) exit_trailing: usize,
    pub(crate) exit_channel: usize,
    pub(crate) exit_regime: usize,
    pub(crate) exit_terminal: usize,
}

impl ComplexDecisionCoverage {
    pub(crate) fn as_counts(&self) -> BTreeMap<String, usize> {
        [
            ("enter_trend", self.enter_trend),
            ("enter_reversal", self.enter_reversal),
            ("exit_trailing", self.exit_trailing),
            ("exit_channel", self.exit_channel),
            ("exit_regime", self.exit_regime),
            ("exit_terminal", self.exit_terminal),
        ]
        .into_iter()
        .map(|(action, count)| (action.to_string(), count))
        .collect()
    }

    pub(crate) fn from_tags(tags: &[u32]) -> anyhow::Result<Self> {
        let mut coverage = Self::default();
        for tag in tags {
            match tag {
                1 => coverage.enter_trend += 1,
                2 => coverage.enter_reversal += 1,
                3 => coverage.exit_trailing += 1,
                4 => coverage.exit_channel += 1,
                5 => coverage.exit_regime += 1,
                6 => coverage.exit_terminal += 1,
                _ => anyhow::bail!("unknown complex Program decision tag: {tag}"),
            }
        }
        Ok(coverage)
    }
}

pub(crate) fn pilot_receipt_issuance(
    run: &OwnedFormationRun,
) -> anyhow::Result<FormationReceiptIssuance<'_>> {
    let intent = PilotResearchIntent::frozen()?;
    let family = FrozenStrategyFamily::frozen_pilot()?;
    let trials = run
        .trials
        .iter()
        .map(OwnedFormationTrialEvidence::borrowed)
        .collect();
    Ok(FormationReceiptIssuance {
        experiment_id: intent.payload.pilot_id.clone(),
        research_intent_id: intent.identity.clone(),
        research_intent_digest: family.intent().content_digest().to_string(),
        family,
        predecessor_intent_digest: intent.payload.predecessor.disposition_sha256.clone(),
        predecessor_disposition: intent.payload.predecessor.economic_disposition.clone(),
        predecessor_reason: intent.payload.predecessor.software_acceptance.clone(),
        native_producer_evidence: Some(&run.producer_evidence),
        formation_admission_reason: None,
        evidence_boundary: FormationEvidenceBoundary::TerminalRetrospective {
            partition: "RETROSPECTIVE_2023_2024".to_string(),
            snapshot_semantics: intent.payload.data.snapshot_semantics.clone(),
            reason: "pilot intent reserves no one-way holdout".to_string(),
        },
        software_error: run.software_error.clone(),
        trials,
        aggregate_coverage: run.aggregate_coverage.clone(),
        evidence: Vec::new(),
        non_claims: intent.payload.non_claims,
    })
}

pub(crate) fn project_pilot_trial(
    trial: &StrategyTrial,
    artifact_identity: StrategyArtifactIdentity,
    result: CanonicalBacktestResult,
    source_manifest_digest: String,
    source_event_count: usize,
    executable_bar_count: usize,
    expected_starting: Money,
) -> OwnedFormationTrialEvidence {
    let projection = project_cash_result(&result, expected_starting, FormationAccountLedger::Cash);
    OwnedFormationTrialEvidence::bound(trial, artifact_identity).completed(
        result,
        source_manifest_digest,
        BTreeMap::from([
            ("source_events".to_string(), source_event_count),
            ("executable_bars".to_string(), executable_bar_count),
        ]),
        BTreeMap::new(),
        projection,
        "pilot result",
    )
}

pub(crate) fn evaluate_pilot_family(
    intent: &PilotResearchIntent,
    trials: &[FormationTrialEvidence<'_>],
) -> anyhow::Result<FormationProjectionV9> {
    anyhow::ensure!(trials.len() == 1, "pilot family must contain one trial");
    let projection = trials[0]
        .projection
        .as_ref()
        .context("pilot projection is missing")?;
    let net = Money::from_str(
        projection
            .outcome
            .get(CASH_NET_PNL)
            .context("pilot net pnl is missing")?,
    )
    .map_err(anyhow::Error::msg)?;
    let costs = Money::from_str(
        projection
            .outcome
            .get(CASH_NATIVE_COMMISSIONS)
            .context("pilot commissions are missing")?,
    )
    .map_err(anyhow::Error::msg)?;
    let round_trips = projection
        .outcome
        .get(CASH_COMPLETED_ROUND_TRIPS)
        .context("pilot round trips are missing")?
        .parse::<usize>()?;
    anyhow::ensure!(
        costs.raw > 0 && round_trips > 0,
        "pilot trading activity is missing"
    );
    let survived = net.raw > 0;
    let selection = FormationTrialSelection {
        parameter_id: trials[0].parameter_id.clone(),
        variant_id: trials[0].variant_id.clone(),
    };
    anyhow::ensure!(
        intent.payload.disposition.economic_falsifier
            == "validation_net_pnl_after_native_commissions_lte_zero",
        "unsupported pilot economic policy"
    );
    Ok(FormationProjectionV9 {
        family_disposition: if survived {
            crate::receipt::FormationFamilyDisposition::FormationSurvivorNotQualified
        } else {
            crate::receipt::FormationFamilyDisposition::EconomicRejected
        },
        trial_dispositions: vec![if survived {
            FormationTrialDisposition::FormationSurvivorNotQualified
        } else {
            FormationTrialDisposition::EconomicRejected
        }],
        economically_selected: survived.then_some(selection.clone()),
        selected: survived.then_some(selection),
        robustness: None,
        robustness_error: None,
    })
}

pub(crate) fn issue_price_only_formation_receipt(
    run: &OwnedFormationRun,
) -> anyhow::Result<FormationFamilyReceipt> {
    let intent = PriceOnlyResearchIntent::frozen()?;
    FormationFamilyReceipt::issue(&price_only_issuance(&intent, run)?)
}

pub(crate) fn issue_representative_formation_receipt(
    run: &OwnedFormationRun,
) -> anyhow::Result<FormationFamilyReceipt> {
    FormationFamilyReceipt::issue(&representative_formation_issuance(run)?)
}

pub(crate) fn recover_representative_formation_receipt(
    bytes: &[u8],
    run: &OwnedFormationRun,
) -> anyhow::Result<FormationFamilyReceipt> {
    FormationFamilyReceipt::from_slice(bytes, &representative_formation_issuance(run)?)
}

fn representative_formation_issuance(
    run: &OwnedFormationRun,
) -> anyhow::Result<FormationReceiptIssuance<'_>> {
    let family = FrozenStrategyFamily::frozen_representative_formation()?;
    let trials = run
        .trials
        .iter()
        .map(OwnedFormationTrialEvidence::borrowed)
        .collect();
    Ok(FormationReceiptIssuance {
        experiment_id: family.intent().experiment_id().to_string(),
        research_intent_id: family.intent().identity().to_string(),
        research_intent_digest: family.intent().content_digest().to_string(),
        family,
        predecessor_intent_digest: format!("sha256:{REPRESENTATIVE_INTENT_SHA256}"),
        predecessor_disposition: REPRESENTATIVE_FORMATION_PREDECESSOR_DISPOSITION.to_string(),
        predecessor_reason: REPRESENTATIVE_FORMATION_PREDECESSOR_REASON.to_string(),
        native_producer_evidence: Some(&run.producer_evidence),
        formation_admission_reason: None,
        evidence_boundary: FormationEvidenceBoundary::TerminalRetrospective {
            partition: "RETROSPECTIVE_2023_ONLY".to_string(),
            snapshot_semantics: REPRESENTATIVE_FORMATION_SNAPSHOT_SEMANTICS.to_string(),
            reason: REPRESENTATIVE_FORMATION_RETROSPECTIVE_REASON.to_string(),
        },
        software_error: run.software_error.clone(),
        trials,
        aggregate_coverage: run.aggregate_coverage.clone(),
        evidence: representative_formation_evidence()?,
        non_claims: representative_formation_non_claims()?,
    })
}

pub(crate) fn recover_price_only_formation_receipt(
    bytes: &[u8],
    run: &OwnedFormationRun,
) -> anyhow::Result<FormationFamilyReceipt> {
    let intent = PriceOnlyResearchIntent::frozen()?;
    FormationFamilyReceipt::from_slice(bytes, &price_only_issuance(&intent, run)?)
}

fn price_only_issuance<'a>(
    intent: &'a PriceOnlyResearchIntent,
    run: &'a OwnedFormationRun,
) -> anyhow::Result<FormationReceiptIssuance<'a>> {
    let family = FrozenStrategyFamily::frozen_price_only()?;
    let trials = run
        .trials
        .iter()
        .map(OwnedFormationTrialEvidence::borrowed)
        .collect();
    let evidence = intent
        .payload
        .evidence
        .iter()
        .map(|item| {
            ResearchEvidenceReference::new(item.id.clone(), item.locator.clone(), item.role.clone())
        })
        .collect();
    Ok(FormationReceiptIssuance {
        experiment_id: family.intent().experiment_id().to_string(),
        research_intent_id: family.intent().identity().to_string(),
        research_intent_digest: family.intent().content_digest().to_string(),
        family,
        predecessor_intent_digest: intent.payload.predecessor.intent_digest.clone(),
        predecessor_disposition: intent.payload.predecessor.disposition.clone(),
        predecessor_reason: intent.payload.predecessor.reason.clone(),
        native_producer_evidence: Some(&run.producer_evidence),
        formation_admission_reason: None,
        evidence_boundary: FormationEvidenceBoundary::SealedHoldout {
            partition: "FORMATION_2023_ONLY".to_string(),
            qualification_policy: intent.payload.family.holdout_access.clone(),
        },
        software_error: run.software_error.clone(),
        trials,
        aggregate_coverage: run.aggregate_coverage.clone(),
        evidence,
        non_claims: intent.payload.non_claims.clone(),
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn project_cash_trial(
    trial: &StrategyTrial,
    artifact_identity: StrategyArtifactIdentity,
    canonical_result: CanonicalBacktestResult,
    source_manifest_digest: String,
    source_counts: BTreeMap<String, usize>,
    coverage: BTreeMap<String, usize>,
    expected_starting: Money,
    account_ledger: FormationAccountLedger,
) -> OwnedFormationTrialEvidence {
    let projection = project_cash_result(&canonical_result, expected_starting, account_ledger);
    OwnedFormationTrialEvidence::bound(trial, artifact_identity).completed(
        canonical_result,
        source_manifest_digest,
        source_counts,
        coverage,
        projection,
        "cash-denominated result",
    )
}

pub(crate) fn finish_bounded_formation_run(
    producer_evidence: NativeProducerEvidence,
    trials: Vec<OwnedFormationTrialEvidence>,
    required_full_coverage: &[&str],
) -> OwnedFormationRun {
    let mut aggregate_coverage = BTreeMap::<String, usize>::new();

    for trial in &trials {
        if trial.variant_id == "full" && trial.software_error.is_none() {
            for (name, count) in &trial.coverage {
                *aggregate_coverage.entry(name.clone()).or_default() += count;
            }
        }
    }
    let software_error = if producer_evidence.allows_test_or_attested_execution() {
        (trials.iter().all(|trial| trial.software_error.is_none())
            && required_full_coverage
                .iter()
                .any(|name| aggregate_coverage.get(*name).copied().unwrap_or_default() == 0))
        .then(|| {
            "formation family did not dynamically exercise every required decision branch"
                .to_string()
        })
    } else {
        Some(producer_evidence.rejection_error())
    };
    OwnedFormationRun::finish(
        producer_evidence,
        trials,
        aggregate_coverage,
        software_error,
    )
}

pub(crate) fn finish_price_run(
    producer_evidence: NativeProducerEvidence,
    trials: Vec<OwnedFormationTrialEvidence>,
) -> OwnedFormationRun {
    finish_bounded_formation_run(producer_evidence, trials, &PRICE_REQUIRED_COVERAGE)
}

fn project_cash_result(
    result: &CanonicalBacktestResult,
    expected_starting: Money,
    account_ledger: FormationAccountLedger,
) -> anyhow::Result<FormationTrialProjection> {
    let document = result.as_value();
    anyhow::ensure!(
        document.get("schema").and_then(serde_json::Value::as_str)
            == Some("vibe-backtest-result/v1"),
        "canonical cash result schema mismatch"
    );
    let summary = document
        .get("summary")
        .and_then(serde_json::Value::as_object)
        .context("canonical cash result summary is missing")?;
    let starting_pointer = format!(
        "/accounts/0/{}/base/balances_starting/USDT",
        account_ledger.json_key()
    );
    let commissions_pointer = format!(
        "/accounts/0/{}/base/commissions/USDT",
        account_ledger.json_key()
    );
    let starting = Money::from_str(
        document
            .pointer(&starting_pointer)
            .and_then(serde_json::Value::as_str)
            .context("canonical starting USDT balance is missing")?,
    )
    .map_err(anyhow::Error::msg)?;
    let ending = Money::from_str(
        summary
            .get("account.BINANCE.balance.USDT.total")
            .and_then(serde_json::Value::as_str)
            .context("canonical ending USDT balance is missing")?,
    )
    .map_err(anyhow::Error::msg)?;
    let costs = match document.pointer(&commissions_pointer) {
        Some(value) => Money::from_str(
            value
                .as_str()
                .context("canonical native USDT commissions are malformed")?,
        )
        .map_err(anyhow::Error::msg)?,
        None => {
            sparse_zero_native_commissions(document, summary, starting, ending, account_ledger)?
        }
    };
    anyhow::ensure!(
        starting == expected_starting
            && starting.currency == ending.currency
            && starting.currency == costs.currency,
        "canonical monetary projection does not bind the frozen intent"
    );
    let completed_round_trips = document
        .pointer("/run/total_positions")
        .and_then(serde_json::Value::as_str)
        .context("canonical completed round trips are missing")?
        .parse::<usize>()?;
    let terminal_flat = ["orders.open", "orders.inflight", "positions.open"]
        .iter()
        .all(|key| summary.get(*key).and_then(serde_json::Value::as_str) == Some("0"));
    anyhow::ensure!(terminal_flat, "canonical cash result is not terminal-flat");
    Ok(FormationTrialProjection {
        outcome: BTreeMap::from([
            (
                CASH_COMPLETED_ROUND_TRIPS.to_string(),
                completed_round_trips.to_string(),
            ),
            (CASH_STARTING_BALANCE.to_string(), starting.to_string()),
            (CASH_ENDING_BALANCE.to_string(), ending.to_string()),
            (CASH_NET_PNL.to_string(), (ending - starting).to_string()),
            (CASH_NATIVE_COMMISSIONS.to_string(), costs.to_string()),
            (CASH_TERMINAL_STATE.to_string(), "FLAT".to_string()),
        ]),
    })
}

fn sparse_zero_native_commissions(
    document: &serde_json::Value,
    summary: &serde_json::Map<String, serde_json::Value>,
    starting: Money,
    ending: Money,
    account_ledger: FormationAccountLedger,
) -> anyhow::Result<Money> {
    let accounts = document
        .get("accounts")
        .and_then(serde_json::Value::as_array)
        .context("canonical accounts are missing")?;
    anyhow::ensure!(accounts.len() == 1, "canonical account count is not one");
    let base = document
        .pointer(&format!("/accounts/0/{}/base", account_ledger.json_key()))
        .context("canonical formation account is missing")?;
    let run = document.get("run").context("canonical run is missing")?;
    let money = |pointer| {
        Money::from_str(
            base.pointer(pointer)
                .and_then(serde_json::Value::as_str)
                .context("canonical current USDT balance field is missing")?,
        )
        .map_err(anyhow::Error::msg)
    };
    anyhow::ensure!(
        base.get("commissions")
            .and_then(serde_json::Value::as_object)
            .is_some_and(serde_json::Map::is_empty)
            && ["orders", "fills", "positions", "position_snapshots"]
                .iter()
                .all(|key| document
                    .get(*key)
                    .and_then(serde_json::Value::as_array)
                    .is_some_and(Vec::is_empty))
            && run.get("outcome").and_then(serde_json::Value::as_str) == Some("completed")
            && ["total_orders", "total_positions"]
                .iter()
                .all(|key| run.get(*key).and_then(serde_json::Value::as_str) == Some("0"))
            && ["orders.open", "orders.inflight", "positions.open"]
                .iter()
                .all(|key| summary.get(*key).and_then(serde_json::Value::as_str) == Some("0"))
            && starting == ending
            && starting == money("/balances/USDT/total")?
            && starting == money("/balances/USDT/free")?
            && money("/balances/USDT/locked")? == Money::zero(starting.currency),
        "missing native commission is inconsistent with zero canonical activity"
    );
    Ok(Money::zero(starting.currency))
}

pub(crate) fn evaluate_price_only_family(
    intent: &PriceOnlyResearchIntent,
    trials: &[FormationTrialEvidence<'_>],
) -> anyhow::Result<FormationProjectionV9> {
    anyhow::ensure!(
        intent.payload.family.selection
            == "full_variant_requires_positive_net_pnl_gt_native_commissions_and_strictly_beats_all_deletions_then_net_pnl_per_target_risk_bps_then_tuple_id",
        "unsupported price-only formation selection policy"
    );
    evaluate_bounded_cash_family(
        trials,
        &price_bounded_policy(intent, intent.payload.family.variants.len()),
    )
}

pub(crate) fn evaluate_representative_family(
    intent: &PriceOnlyResearchIntent,
    selection_policy: &str,
    trials: &[FormationTrialEvidence<'_>],
) -> anyhow::Result<FormationProjectionV9> {
    anyhow::ensure!(
        selection_policy
            == "full_must_pass_cost_and_risk_floors_and_strictly_beat_every_deletion_or_delete_the_noncontributing_surface",
        "unsupported representative formation selection policy"
    );
    evaluate_bounded_cash_family(trials, &price_bounded_policy(intent, 10))
}

fn price_bounded_policy(
    intent: &PriceOnlyResearchIntent,
    variant_count: usize,
) -> BoundedCashFormationPolicy {
    BoundedCashFormationPolicy {
        variant_count,
        objective_divisors: intent
            .payload
            .family
            .tuples
            .iter()
            .map(|tuple| (tuple.id.clone(), tuple.target_risk_bps))
            .collect(),
        robustness: RobustnessPolicy {
            observations: intent.payload.robustness_policy.observations as usize,
            slices: intent.payload.robustness_policy.cscv_slices as usize,
            selectable_trials: intent.payload.robustness_policy.selectable_trial_count as usize,
            max_pbo_ppm: intent.payload.robustness_policy.max_pbo_ppm,
            min_dsr_ppm: intent.payload.robustness_policy.min_dsr_ppm,
        },
    }
}

pub(crate) fn evaluate_bounded_cash_family(
    trials: &[FormationTrialEvidence<'_>],
    policy: &BoundedCashFormationPolicy,
) -> anyhow::Result<FormationProjectionV9> {
    let trial_dispositions = classify_bounded_deletion_trials(trials, policy.variant_count)?;
    let economically_selected_parameter_id =
        select_bounded_cash_trial(trials, &trial_dispositions, policy)?;
    let Some(parameter_id) = economically_selected_parameter_id else {
        return Ok(FormationProjectionV9 {
            family_disposition: crate::receipt::FormationFamilyDisposition::EconomicRejected,
            trial_dispositions,
            economically_selected: None,
            selected: None,
            robustness: None,
            robustness_error: None,
        });
    };
    let robustness = (|| -> anyhow::Result<FormationRobustnessReport> {
        let selectable = trials
            .iter()
            .filter(|trial| trial.variant_id == "full")
            .map(|trial| {
                trial_returns_from_canonical(
                    format!("{}/full", trial.parameter_id),
                    trial
                        .canonical_result
                        .context("selectable full trial has no canonical result")?,
                )
            })
            .collect::<anyhow::Result<Vec<_>>>()?;
        analyze_formation_robustness(
            &selectable,
            &format!("{parameter_id}/full"),
            policy.robustness,
        )
    })();

    match robustness {
        Ok(report) => {
            let projection = project_price_robustness(report);
            let selection = FormationTrialSelection {
                parameter_id,
                variant_id: "full".to_string(),
            };
            Ok(FormationProjectionV9 {
                family_disposition: if projection.passed {
                    crate::receipt::FormationFamilyDisposition::FormationSurvivorNotQualified
                } else {
                    crate::receipt::FormationFamilyDisposition::FormationRobustnessRejected
                },
                trial_dispositions,
                economically_selected: Some(selection.clone()),
                selected: projection.passed.then_some(selection),
                robustness: Some(projection),
                robustness_error: None,
            })
        }
        Err(e) => Ok(FormationProjectionV9 {
            family_disposition:
                crate::receipt::FormationFamilyDisposition::FormationRobustnessRejected,
            trial_dispositions,
            economically_selected: Some(FormationTrialSelection {
                parameter_id,
                variant_id: "full".to_string(),
            }),
            selected: None,
            robustness: None,
            robustness_error: Some(format!("{e:#}")),
        }),
    }
}

fn project_price_robustness(report: FormationRobustnessReport) -> FormationRobustnessProjection {
    FormationRobustnessProjection {
        passed: report.passed,
        diagnostics: BTreeMap::from([
            ("method".to_string(), "CSCV_PBO_AND_DSR".to_string()),
            ("observation_source".to_string(), report.observation_source),
            ("observations".to_string(), report.observations.to_string()),
            ("cscv_slices".to_string(), report.cscv_slices.to_string()),
            (
                "cscv_combinations".to_string(),
                report.cscv_combinations.to_string(),
            ),
            (
                "pbo_overfit_combinations".to_string(),
                report.pbo_overfit_combinations.to_string(),
            ),
            ("pbo_ppm".to_string(), report.pbo_ppm.to_string()),
            ("max_pbo_ppm".to_string(), report.max_pbo_ppm.to_string()),
            (
                "selected_daily_risk_return_ratio_bits".to_string(),
                report.selected_daily_risk_return_ratio_bits,
            ),
            (
                "expected_max_daily_risk_return_ratio_bits".to_string(),
                report.expected_max_daily_risk_return_ratio_bits,
            ),
            (
                "selected_daily_skewness_bits".to_string(),
                report.selected_daily_skewness_bits,
            ),
            (
                "selected_daily_raw_kurtosis_bits".to_string(),
                report.selected_daily_raw_kurtosis_bits,
            ),
            (
                "dsr_probability_bits".to_string(),
                report.dsr_probability_bits,
            ),
            ("dsr_ppm".to_string(), report.dsr_ppm.to_string()),
            ("min_dsr_ppm".to_string(), report.min_dsr_ppm.to_string()),
        ]),
    }
}

pub(crate) fn bounded_cash_deletion_group_survives(
    group: &[FormationTrialEvidence<'_>],
) -> anyhow::Result<bool> {
    let (full, controls) = group
        .split_first()
        .context("bounded full trial is missing")?;
    anyhow::ensure!(
        full.variant_id == "full",
        "bounded group does not begin with full"
    );
    let full_projection = full
        .projection
        .as_ref()
        .context("bounded full projection is missing")?;
    let objective = Money::from_str(cash_outcome(full_projection, CASH_NET_PNL)?)
        .map_err(anyhow::Error::msg)?;
    let strictly_beats_every_deletion = controls.iter().try_fold(true, |acc, control| {
        anyhow::ensure!(
            control.parameter_id == full.parameter_id && control.variant_id != "full",
            "bounded deletion coordinate is misgrouped"
        );
        let control_projection = control
            .projection
            .as_ref()
            .context("bounded deletion projection is missing")?;
        let control_objective = Money::from_str(cash_outcome(control_projection, CASH_NET_PNL)?)
            .map_err(anyhow::Error::msg)?;
        Ok::<_, anyhow::Error>(acc && objective.raw > control_objective.raw)
    })?;
    Ok(bounded_cash_trial_survives(full)? && strictly_beats_every_deletion)
}

pub(crate) fn bounded_cash_trial_survives(
    trial: &FormationTrialEvidence<'_>,
) -> anyhow::Result<bool> {
    let projection = trial
        .projection
        .as_ref()
        .context("bounded cash projection is missing")?;
    let objective =
        Money::from_str(cash_outcome(projection, CASH_NET_PNL)?).map_err(anyhow::Error::msg)?;
    let costs = Money::from_str(cash_outcome(projection, CASH_NATIVE_COMMISSIONS)?)
        .map_err(anyhow::Error::msg)?;
    let round_trips = cash_outcome(projection, CASH_COMPLETED_ROUND_TRIPS)?.parse::<usize>()?;
    Ok(round_trips > 0
        && objective.raw > costs.raw
        && cash_outcome(projection, CASH_TERMINAL_STATE)? == "FLAT")
}

fn classify_bounded_deletion_trials(
    trials: &[FormationTrialEvidence<'_>],
    variant_count: usize,
) -> anyhow::Result<Vec<FormationTrialDisposition>> {
    anyhow::ensure!(variant_count > 1, "bounded deletion controls are missing");
    let mut dispositions = Vec::with_capacity(trials.len());
    let mut groups = trials.chunks_exact(variant_count);

    for group in &mut groups {
        dispositions.push(if bounded_cash_deletion_group_survives(group)? {
            FormationTrialDisposition::FormationSurvivorNotQualified
        } else {
            FormationTrialDisposition::EconomicRejected
        });
        dispositions.extend(
            group[1..]
                .iter()
                .map(|_| FormationTrialDisposition::DeletionControl),
        );
    }
    anyhow::ensure!(
        groups.remainder().is_empty(),
        "bounded deletion group is incomplete"
    );
    Ok(dispositions)
}

fn select_bounded_cash_trial(
    trials: &[FormationTrialEvidence<'_>],
    dispositions: &[FormationTrialDisposition],
    policy: &BoundedCashFormationPolicy,
) -> anyhow::Result<Option<String>> {
    let mut selected: Option<(&FormationTrialEvidence<'_>, Money)> = None;

    for trial in trials
        .iter()
        .zip(dispositions)
        .filter(|(_, disposition)| {
            **disposition == FormationTrialDisposition::FormationSurvivorNotQualified
        })
        .map(|(trial, _)| trial)
    {
        let projection = trial
            .projection
            .as_ref()
            .context("bounded survivor projection is missing")?;
        let objective =
            Money::from_str(cash_outcome(projection, CASH_NET_PNL)?).map_err(anyhow::Error::msg)?;
        let scale = policy
            .objective_divisors
            .get(&trial.parameter_id)
            .copied()
            .context("bounded survivor has no frozen risk normalizer")?;
        let replace = match selected.as_ref() {
            None => true,
            Some((current, current_objective)) => {
                let current_scale = policy
                    .objective_divisors
                    .get(&current.parameter_id)
                    .copied()
                    .context("selected bounded survivor has no frozen risk normalizer")?;
                let objective_raw = objective.raw.to_string().parse::<i128>()?;
                let current_objective_raw = current_objective.raw.to_string().parse::<i128>()?;
                let left = objective_raw * i128::from(current_scale);
                let right = current_objective_raw * i128::from(scale);
                left > right || (left == right && trial.parameter_id < current.parameter_id)
            }
        };

        if replace {
            selected = Some((trial, objective));
        }
    }
    Ok(selected.map(|(trial, _)| trial.parameter_id.clone()))
}

fn cash_outcome<'a>(
    projection: &'a FormationTrialProjection,
    name: &str,
) -> anyhow::Result<&'a str> {
    projection
        .outcome
        .get(name)
        .map(String::as_str)
        .with_context(|| format!("cash projection has no {name}"))
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;
    use crate::artifact::StrategyArtifact;

    fn pilot_result() -> CanonicalBacktestResult {
        let document = serde_json::json!({
            "accounts": [{"Cash": {"base": {
                "balances_starting": {"USDT": "1000000.00000000 USDT"},
                "commissions": {"USDT": "1.00000000 USDT"}
            }}}],
            "components": {"actor_ids": [], "exec_algorithm_ids": [], "strategy_ids": [], "trader_state": "STOPPED"},
            "diagnostics": [], "fills": [], "orders": [], "portfolio_snapshots": [],
            "position_snapshots": [], "positions": [],
            "run": {"backtest_end_ns": "2", "backtest_start_ns": "1", "iterations": "1", "outcome": "completed", "run_config_id": null, "total_events": "2", "total_orders": "2", "total_positions": "1", "trader_id": "TRADER-001"},
            "schema": "vibe-backtest-result/v1",
            "statistics": {"general": {}, "pnls": {}, "returns": {}, "returns_series": []},
            "summary": {
                "account.BINANCE.balance.USDT.total": "1000002.00000000 USDT",
                "orders.open": "0", "orders.inflight": "0", "positions.open": "0"
            }
        });
        CanonicalBacktestResult::from_slice(&serde_json::to_vec(&document).unwrap()).unwrap()
    }

    fn sparse_zero_document(ledger: FormationAccountLedger) -> serde_json::Value {
        let mut document = serde_json::json!({
            "accounts": [{"Margin": {"base": {
                "balances": {"USDT": {
                    "currency": "USDT",
                    "free": "1000000.00000000 USDT",
                    "locked": "0.00000000 USDT",
                    "total": "1000000.00000000 USDT"
                }},
                "balances_starting": {"USDT": "1000000.00000000 USDT"},
                "commissions": {}
            }}}],
            "components": {"actor_ids": [], "exec_algorithm_ids": [], "strategy_ids": [], "trader_state": "STOPPED"},
            "diagnostics": [], "fills": [], "orders": [], "portfolio_snapshots": [],
            "position_snapshots": [], "positions": [],
            "run": {"backtest_end_ns": "2", "backtest_start_ns": "1", "iterations": "1", "outcome": "completed", "run_config_id": null, "total_events": "0", "total_orders": "0", "total_positions": "0", "trader_id": "TRADER-001"},
            "schema": "vibe-backtest-result/v1",
            "statistics": {"general": {}, "pnls": {}, "returns": {}, "returns_series": []},
            "summary": {
                "account.BINANCE.balance.USDT.total": "1000000.00000000 USDT",
                "orders.open": "0", "orders.inflight": "0", "positions.open": "0"
            }
        });
        if ledger == FormationAccountLedger::Cash {
            let account = document["accounts"][0].as_object_mut().unwrap();
            let margin = account.remove("Margin").unwrap();
            account.insert("Cash".to_string(), margin);
        }
        document
    }

    fn sparse_projection(
        document: &serde_json::Value,
        ledger: FormationAccountLedger,
    ) -> anyhow::Result<FormationTrialProjection> {
        let result = CanonicalBacktestResult::from_slice(&serde_json::to_vec(&document).unwrap())?;
        project_cash_result(
            &result,
            Money::from_str("1000000.00000000 USDT").unwrap(),
            ledger,
        )
    }

    #[rstest]
    fn sparse_zero_commission_is_accepted_only_for_exact_zero_activity() {
        for ledger in [FormationAccountLedger::Cash, FormationAccountLedger::Margin] {
            let document = sparse_zero_document(ledger);
            let projection = sparse_projection(&document, ledger).unwrap();
            assert_eq!(
                projection.outcome[CASH_NATIVE_COMMISSIONS],
                "0.00000000 USDT"
            );
            assert_eq!(projection.outcome[CASH_COMPLETED_ROUND_TRIPS], "0");
        }
    }

    #[rstest]
    fn sparse_zero_commission_rejects_every_contradictory_shape() {
        let ledger = FormationAccountLedger::Margin;
        let mut invalid = Vec::new();

        let mut missing_map = sparse_zero_document(ledger);
        missing_map["accounts"][0]["Margin"]["base"]
            .as_object_mut()
            .unwrap()
            .remove("commissions");
        invalid.push(missing_map);

        let mut foreign_commission = sparse_zero_document(ledger);
        foreign_commission["accounts"][0]["Margin"]["base"]["commissions"] =
            serde_json::json!({"BTC": "1.00000000 BTC"});
        invalid.push(foreign_commission);

        for (pointer, value) in [
            ("/orders", serde_json::json!([{}])),
            ("/fills", serde_json::json!([{}])),
            ("/positions", serde_json::json!([{}])),
            ("/position_snapshots", serde_json::json!([{}])),
            ("/run/outcome", serde_json::json!("failed")),
            ("/run/total_orders", serde_json::json!("1")),
            ("/run/total_positions", serde_json::json!("1")),
            (
                "/accounts/0/Margin/base/balances/USDT/total",
                serde_json::json!("999999.00000000 USDT"),
            ),
            (
                "/accounts/0/Margin/base/balances/USDT/free",
                serde_json::json!("999999.00000000 USDT"),
            ),
            (
                "/accounts/0/Margin/base/balances/USDT/locked",
                serde_json::json!("1.00000000 USDT"),
            ),
            (
                "/summary/account.BINANCE.balance.USDT.total",
                serde_json::json!("999999.00000000 USDT"),
            ),
            ("/summary/orders.open", serde_json::json!("1")),
        ] {
            let mut document = sparse_zero_document(ledger);
            *document.pointer_mut(pointer).unwrap() = value;
            invalid.push(document);
        }

        for document in invalid {
            assert!(sparse_projection(&document, ledger).is_err());
        }
    }

    fn projected_price_trial<'a>(
        trial: &crate::StrategyTrial,
        artifact: &'a StrategyArtifact,
        objective: &str,
    ) -> FormationTrialEvidence<'a> {
        FormationTrialEvidence {
            parameter_id: trial.parameter_id().to_string(),
            variant_id: trial.variant_id().to_string(),
            parameters_digest: trial.parameters_digest().to_string(),
            artifact_identity: artifact.identity(),
            canonical_result: None,
            source_manifest_digest: Some("blake3:test-source".to_string()),
            source_counts: BTreeMap::from([
                ("source_events".to_string(), 10),
                ("executable_bars".to_string(), 10),
            ]),
            projection: Some(FormationTrialProjection {
                outcome: BTreeMap::from([
                    (CASH_COMPLETED_ROUND_TRIPS.to_string(), "1".to_string()),
                    (
                        CASH_STARTING_BALANCE.to_string(),
                        "100.00000000 USDT".to_string(),
                    ),
                    (
                        CASH_ENDING_BALANCE.to_string(),
                        "103.00000000 USDT".to_string(),
                    ),
                    (CASH_NET_PNL.to_string(), objective.to_string()),
                    (
                        CASH_NATIVE_COMMISSIONS.to_string(),
                        "1.00000000 USDT".to_string(),
                    ),
                    (CASH_TERMINAL_STATE.to_string(), "FLAT".to_string()),
                ]),
            }),
            coverage: BTreeMap::new(),
            software_error: None,
        }
    }

    fn set_projected_outcome(trial: &mut FormationTrialEvidence<'_>, name: &str, value: &str) {
        trial
            .projection
            .as_mut()
            .unwrap()
            .outcome
            .insert(name.to_string(), value.to_string());
    }

    fn assert_bounded_group_is_economically_rejected(trials: &[FormationTrialEvidence<'_>]) {
        assert!(!bounded_cash_deletion_group_survives(trials).unwrap());
        assert_eq!(
            classify_bounded_deletion_trials(trials, trials.len()).unwrap()[0],
            FormationTrialDisposition::EconomicRejected
        );
    }

    #[rstest]
    fn bounded_deletion_group_helper_preserves_every_economic_and_shape_floor() {
        let family = FrozenStrategyFamily::frozen_price_only().unwrap();
        let artifacts = family.materialize_all().unwrap();
        let mut trials = family
            .trials()
            .iter()
            .take(5)
            .zip(&artifacts)
            .enumerate()
            .map(|(index, (trial, artifact))| {
                projected_price_trial(
                    trial,
                    artifact,
                    if index == 0 {
                        "3.00000000 USDT"
                    } else {
                        "2.00000000 USDT"
                    },
                )
            })
            .collect::<Vec<_>>();

        assert!(bounded_cash_deletion_group_survives(&trials).unwrap());

        set_projected_outcome(&mut trials[1], CASH_NET_PNL, "3.00000000 USDT");
        assert_bounded_group_is_economically_rejected(&trials);
        set_projected_outcome(&mut trials[1], CASH_NET_PNL, "2.00000000 USDT");

        set_projected_outcome(&mut trials[0], CASH_NET_PNL, "1.00000000 USDT");
        assert_bounded_group_is_economically_rejected(&trials);
        set_projected_outcome(&mut trials[0], CASH_NET_PNL, "3.00000000 USDT");

        set_projected_outcome(&mut trials[0], CASH_TERMINAL_STATE, "OPEN");
        assert_bounded_group_is_economically_rejected(&trials);
        set_projected_outcome(&mut trials[0], CASH_TERMINAL_STATE, "FLAT");

        set_projected_outcome(&mut trials[0], CASH_COMPLETED_ROUND_TRIPS, "0");
        assert_bounded_group_is_economically_rejected(&trials);
        set_projected_outcome(&mut trials[0], CASH_COMPLETED_ROUND_TRIPS, "1");

        trials[1].parameter_id = "misgrouped".to_string();
        assert_eq!(
            bounded_cash_deletion_group_survives(&trials)
                .unwrap_err()
                .to_string(),
            "bounded deletion coordinate is misgrouped"
        );
        assert_eq!(
            classify_bounded_deletion_trials(&trials, trials.len())
                .unwrap_err()
                .to_string(),
            "bounded deletion coordinate is misgrouped"
        );
    }

    #[rstest]
    fn price_only_economic_and_selection_policy_stays_in_the_adapter() {
        let intent = PriceOnlyResearchIntent::frozen().unwrap();
        let policy = price_bounded_policy(&intent, 5);
        let family = FrozenStrategyFamily::frozen_price_only().unwrap();
        let artifacts = family.materialize_all().unwrap();
        let mut trials = family
            .trials()
            .iter()
            .take(10)
            .zip(artifacts.iter().take(10))
            .enumerate()
            .map(|(index, (trial, artifact))| {
                projected_price_trial(
                    trial,
                    artifact,
                    if index == 0 {
                        "3.00000000 USDT"
                    } else if index == 5 {
                        "2.50000000 USDT"
                    } else {
                        "2.00000000 USDT"
                    },
                )
            })
            .collect::<Vec<_>>();

        let dispositions = classify_bounded_deletion_trials(&trials, 5).unwrap();
        assert_eq!(
            select_bounded_cash_trial(&trials, &dispositions, &policy)
                .unwrap()
                .as_deref(),
            Some(family.trials()[0].parameter_id())
        );

        trials[0]
            .projection
            .as_mut()
            .unwrap()
            .outcome
            .insert(CASH_TERMINAL_STATE.to_string(), "OPEN".to_string());
        assert_eq!(
            classify_bounded_deletion_trials(&trials, 5).unwrap()[0],
            FormationTrialDisposition::EconomicRejected
        );
        trials[0]
            .projection
            .as_mut()
            .unwrap()
            .outcome
            .insert(CASH_TERMINAL_STATE.to_string(), "FLAT".to_string());

        trials[4]
            .projection
            .as_mut()
            .unwrap()
            .outcome
            .insert(CASH_NET_PNL.to_string(), "3.00000000 USDT".to_string());
        let dispositions = classify_bounded_deletion_trials(&trials, 5).unwrap();
        assert_eq!(
            select_bounded_cash_trial(&trials, &dispositions, &policy)
                .unwrap()
                .as_deref(),
            Some(family.trials()[5].parameter_id())
        );
    }

    #[rstest]
    fn representative_deletions_reject_noncontributing_full_without_rewriting_it() {
        let intent = PriceOnlyResearchIntent::frozen().unwrap();
        let policy = price_bounded_policy(&intent, 10);
        let family = FrozenStrategyFamily::frozen_representative_formation().unwrap();
        let artifacts = family.materialize_all().unwrap();
        let mut trials = family
            .trials()
            .iter()
            .zip(&artifacts)
            .enumerate()
            .map(|(index, (trial, artifact))| {
                projected_price_trial(
                    trial,
                    artifact,
                    if index % 10 == 0 {
                        "3.00000000 USDT"
                    } else {
                        "2.00000000 USDT"
                    },
                )
            })
            .collect::<Vec<_>>();
        trials[1]
            .projection
            .as_mut()
            .unwrap()
            .outcome
            .insert(CASH_NET_PNL.to_string(), "3.00000000 USDT".to_string());

        let dispositions = classify_bounded_deletion_trials(&trials, 10).unwrap();
        assert_eq!(dispositions[0], FormationTrialDisposition::EconomicRejected);
        assert_eq!(
            dispositions[10],
            FormationTrialDisposition::FormationSurvivorNotQualified
        );
        assert_eq!(
            dispositions
                .iter()
                .filter(|value| **value == FormationTrialDisposition::DeletionControl)
                .count(),
            36
        );
        assert_ne!(
            select_bounded_cash_trial(&trials, &dispositions, &policy)
                .unwrap()
                .as_deref(),
            Some("tuple-001")
        );
        assert_eq!(family.trials()[0].variant_id(), "full");
        assert_eq!(family.trials()[1].variant_id(), "price-only");
    }

    #[rstest]
    fn representative_receipt_is_terminal_retrospective_and_never_qualification_authority() {
        let family = FrozenStrategyFamily::frozen_representative_formation().unwrap();
        let artifacts = family.materialize_all().unwrap();
        let starting = Money::from_str("1000000.00000000 USDT").unwrap();
        let trials = family
            .trials()
            .iter()
            .zip(artifacts)
            .map(|(trial, artifact)| {
                project_cash_trial(
                    trial,
                    artifact.identity().clone(),
                    pilot_result(),
                    "blake3:representative-source".to_string(),
                    BTreeMap::from([("source_events".to_string(), 1)]),
                    BTreeMap::new(),
                    starting,
                    FormationAccountLedger::Cash,
                )
            })
            .collect();
        let run = finish_bounded_formation_run(
            crate::producer::NativeProducerEvidence::test_only_for_execution(),
            trials,
            &[],
        );
        assert!(!run.producer_is_verified());
        let receipt = issue_representative_formation_receipt(&run).unwrap();
        assert_eq!(receipt.trial_count(), 40);
        assert_eq!(
            receipt.disposition(),
            crate::receipt::FormationFamilyDisposition::EconomicRejected
        );
        let bytes = receipt.to_bytes().unwrap();
        let document: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let producer = &document["body"]["native_producer_evidence"];
        assert_eq!(producer["status"], "TEST_ONLY");
        assert_eq!(producer["authority"], "cfg-test-only");
        assert_eq!(producer["accepted_public_authority"], false);
        assert_eq!(
            producer["reason"],
            "FULL_CHAIN_TEST_EXECUTION_ONLY_NO_PUBLIC_RECEIPT_AUTHORITY"
        );
        assert_eq!(producer.as_object().unwrap().len(), 4);
        assert_eq!(document["body"]["partition"], "RETROSPECTIVE_2023_ONLY");
        assert!(
            document["body"]["holdout_status"]
                .as_str()
                .unwrap()
                .starts_with("NOT_RESERVED_RETROSPECTIVE_VALIDATION_CONSUMED:")
        );
        assert!(
            document["body"]["qualification_policy"]
                .as_str()
                .unwrap()
                .starts_with("NOT_ELIGIBLE_NO_RESERVED_ONE_WAY_HOLDOUT:")
        );
        let recovered = recover_representative_formation_receipt(&bytes, &run).unwrap();
        assert_eq!(recovered, receipt);
        assert_eq!(
            recovered.status().unwrap().phase(),
            crate::status::ResearchPhase::FormationEconomicRejected
        );
    }

    #[rstest]
    fn pilot_uses_exact_common_recovery_but_never_reserves_qualification() {
        let intent = PilotResearchIntent::frozen().unwrap();
        let family = FrozenStrategyFamily::frozen_pilot().unwrap();
        let trial = &family.trials()[0];
        let artifact = family.materialize(trial).unwrap();
        let expected_starting = Money::from_str(&intent.payload.costs.initial_balance).unwrap();
        let evidence = project_pilot_trial(
            trial,
            artifact.identity().clone(),
            pilot_result(),
            "blake3:pilot-source".to_string(),
            17_543,
            17_542,
            expected_starting,
        );
        let run = OwnedFormationRun::finish(
            crate::producer::NativeProducerEvidence::test_only_for_execution(),
            vec![evidence],
            BTreeMap::new(),
            None,
        );
        let receipt =
            FormationFamilyReceipt::issue(&pilot_receipt_issuance(&run).unwrap()).unwrap();
        assert_eq!(
            receipt.disposition(),
            crate::receipt::FormationFamilyDisposition::FormationSurvivorNotQualified
        );
        let recovered = FormationFamilyReceipt::from_slice(
            &receipt.to_bytes().unwrap(),
            &pilot_receipt_issuance(&run).unwrap(),
        )
        .unwrap();
        assert_eq!(recovered, receipt);
        assert_eq!(
            recovered.status().unwrap().phase(),
            crate::status::ResearchPhase::FormationSurvivorNotQualified
        );
    }
}
