use std::{collections::BTreeMap, str::FromStr};

use anyhow::Context;
use vibe_backtest::result::CanonicalBacktestResult;
use vibe_model::types::Money;

use crate::{
    artifact::StrategyArtifactIdentity,
    experiment::PriceOnlyResearchIntent,
    family::{FrozenStrategyFamily, StrategyTrial},
    intent::PilotResearchIntent,
    producer::NativeProducerEvidence,
    qualification::QualificationMetricPolicy,
    receipt::{
        FormationEvidenceBoundary, FormationFamilyReceipt, FormationProjectionV9,
        FormationReceiptIssuance, FormationRobustnessProjection, FormationTrialDisposition,
        FormationTrialEvidence, FormationTrialProjection, FormationTrialSelection,
        OwnedFormationRun, OwnedFormationTrialEvidence, QualificationPreflightBinding,
        QualificationReceiptIssuance, QualificationReceiptPolicy,
    },
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

#[derive(Debug)]
pub(crate) struct ComplexQualificationRun {
    pub(crate) intent: PriceOnlyResearchIntent,
    pub(crate) formation_receipt: FormationFamilyReceipt,
    pub(crate) artifact_identity: StrategyArtifactIdentity,
    pub(crate) canonical_result: CanonicalBacktestResult,
    pub(crate) source_manifest_digest: String,
    pub(crate) source_event_count: usize,
    pub(crate) executable_bar_count: usize,
    pub(crate) coverage: ComplexDecisionCoverage,
    pub(crate) producer_evidence: NativeProducerEvidence,
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
    let projection = project_cash_result(&result, expected_starting);
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
    let issuance = price_only_issuance(&intent, run)?;
    FormationFamilyReceipt::issue(&issuance)
}

pub(crate) fn recover_price_only_formation_receipt(
    bytes: &[u8],
    run: &OwnedFormationRun,
) -> anyhow::Result<FormationFamilyReceipt> {
    let intent = PriceOnlyResearchIntent::frozen()?;
    let issuance = price_only_issuance(&intent, run)?;
    FormationFamilyReceipt::from_slice(bytes, &issuance)
}

pub(crate) fn price_only_qualification_preflight_binding<'a>(
    intent: &'a PriceOnlyResearchIntent,
    formation_receipt: &'a FormationFamilyReceipt,
    artifact_identity: &'a StrategyArtifactIdentity,
    producer_evidence: &'a NativeProducerEvidence,
    source_manifest_digest: &'a str,
) -> anyhow::Result<QualificationPreflightBinding<'a>> {
    intent.validate_frozen_binding()?;
    Ok(QualificationPreflightBinding {
        canonical_intent_bytes: intent.canonical_bytes(),
        formation_receipt,
        artifact_identity,
        source_manifest_digest,
        producer_evidence,
        policy: price_only_qualification_policy(intent)?,
    })
}

pub(crate) fn price_only_qualification_issuance(
    run: &ComplexQualificationRun,
) -> anyhow::Result<QualificationReceiptIssuance<'_>> {
    let intent = PriceOnlyResearchIntent::frozen()?;
    anyhow::ensure!(
        run.intent == intent
            && run.source_event_count == 9_120
            && run.executable_bar_count == 9_120,
        "price-only qualification run does not bind the frozen source projection"
    );
    let coverage = run.coverage.as_counts();
    let expected_coverage = [
        "enter_trend",
        "enter_reversal",
        "exit_trailing",
        "exit_channel",
        "exit_regime",
        "exit_terminal",
    ];
    anyhow::ensure!(
        coverage.keys().map(String::as_str).eq(expected_coverage),
        "price-only qualification coverage shape mismatch"
    );
    Ok(QualificationReceiptIssuance {
        canonical_intent_bytes: intent.canonical_bytes(),
        formation_receipt: &run.formation_receipt,
        artifact_identity: &run.artifact_identity,
        canonical_result: &run.canonical_result,
        source_manifest_digest: &run.source_manifest_digest,
        source_counts: BTreeMap::from([
            ("source_events".to_string(), run.source_event_count),
            ("executable_bars".to_string(), run.executable_bar_count),
        ]),
        coverage,
        producer_evidence: &run.producer_evidence,
        policy: price_only_qualification_policy(&intent)?,
    })
}

fn price_only_qualification_policy(
    intent: &PriceOnlyResearchIntent,
) -> anyhow::Result<QualificationReceiptPolicy> {
    intent.validate_frozen_binding()?;
    let policy = &intent.payload.qualification_policy;
    let parse = |value: &str| value.parse::<u64>().map_err(anyhow::Error::from);
    Ok(QualificationReceiptPolicy {
        partition: "QUALIFICATION_2024_ONLY".to_string(),
        holdout_access: "CONSUMED_BY_ONE_CONTENT_ADDRESSED_LOGICAL_RUN".to_string(),
        status_qualification_policy: intent.payload.family.holdout_access.clone(),
        expected_source_counts: BTreeMap::from([
            ("source_events".to_string(), 9_120),
            ("executable_bars".to_string(), 9_120),
        ]),
        min_completed_round_trips: policy.min_completed_round_trips as usize,
        expected_starting_balance: intent.payload.costs.initial_balance.clone(),
        starting_balance_pointer: "/accounts/0/Cash/base/balances_starting/USDT".to_string(),
        final_balance_pointer: "/summary/account.BINANCE.balance.USDT.total".to_string(),
        commissions_pointer: "/accounts/0/Cash/base/commissions/USDT".to_string(),
        metric_policy: QualificationMetricPolicy {
            observation_source:
                "vibe-backtest-result/v1.statistics.returns_series:exact-366-utc-daily-2024"
                    .to_string(),
            observations: policy.daily_return_count as usize,
            warmup_first_timestamp_ns: 1_702_857_600_000_000_000,
            first_timestamp_ns: parse(&policy.daily_return_first_timestamp_ns)?,
            last_timestamp_ns: parse(&policy.daily_return_last_timestamp_ns)?,
            timestamp_step_ns: parse(&policy.daily_return_timestamp_step_ns)?,
            min_psr_ppm: policy.min_probabilistic_sharpe_ppm,
            max_absolute_drawdown_ppm: policy.max_absolute_drawdown_ppm,
        },
    })
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
        experiment_id: intent.payload.experiment_id.clone(),
        research_intent_id: intent.identity.clone(),
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
pub(crate) fn project_price_trial(
    trial: &StrategyTrial,
    artifact_identity: StrategyArtifactIdentity,
    canonical_result: CanonicalBacktestResult,
    source_manifest_digest: String,
    source_event_count: usize,
    executable_bar_count: usize,
    coverage: BTreeMap<String, usize>,
    expected_starting: Money,
) -> OwnedFormationTrialEvidence {
    let projection = project_cash_result(&canonical_result, expected_starting);
    OwnedFormationTrialEvidence::bound(trial, artifact_identity).completed(
        canonical_result,
        source_manifest_digest,
        BTreeMap::from([
            ("source_events".to_string(), source_event_count),
            ("executable_bars".to_string(), executable_bar_count),
        ]),
        coverage,
        projection,
        "price-only result",
    )
}

pub(crate) fn finish_price_run(
    producer_evidence: NativeProducerEvidence,
    trials: Vec<OwnedFormationTrialEvidence>,
) -> OwnedFormationRun {
    let mut aggregate_coverage = BTreeMap::<String, usize>::new();

    for trial in &trials {
        if trial.variant_id == "full" && trial.software_error.is_none() {
            for (name, count) in &trial.coverage {
                *aggregate_coverage.entry(name.clone()).or_default() += count;
            }
        }
    }
    let required = [
        "enter_trend",
        "enter_reversal",
        "exit_trailing",
        "exit_channel",
        "exit_regime",
    ];
    let software_error = if producer_evidence.is_verified() {
        (trials.iter().all(|trial| trial.software_error.is_none())
                && required
                    .iter()
                    .any(|name| aggregate_coverage.get(*name).copied().unwrap_or_default() == 0))
            .then(|| {
                "formation family did not dynamically exercise every nonterminal complex decision branch"
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

fn project_cash_result(
    result: &CanonicalBacktestResult,
    expected_starting: Money,
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
    let starting = Money::from_str(
        document
            .pointer("/accounts/0/Cash/base/balances_starting/USDT")
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
    let costs = Money::from_str(
        document
            .pointer("/accounts/0/Cash/base/commissions/USDT")
            .and_then(serde_json::Value::as_str)
            .context("canonical native USDT commissions are missing")?,
    )
    .map_err(anyhow::Error::msg)?;
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

pub(crate) fn evaluate_price_only_family(
    intent: &PriceOnlyResearchIntent,
    trials: &[FormationTrialEvidence<'_>],
) -> anyhow::Result<FormationProjectionV9> {
    anyhow::ensure!(
        intent.payload.family.selection
            == "full_variant_requires_positive_net_pnl_gt_native_commissions_and_strictly_beats_all_deletions_then_net_pnl_per_target_risk_bps_then_tuple_id",
        "unsupported price-only formation selection policy"
    );
    let trial_dispositions =
        classify_price_only_trials(trials, intent.payload.family.variants.len())?;
    let economically_selected_parameter_id =
        select_price_only_trial(trials, &trial_dispositions, intent)?;
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
                        .context("price-only full trial has no canonical result")?,
                )
            })
            .collect::<anyhow::Result<Vec<_>>>()?;
        analyze_formation_robustness(
            &selectable,
            &format!("{parameter_id}/full"),
            RobustnessPolicy {
                observations: intent.payload.robustness_policy.observations as usize,
                slices: intent.payload.robustness_policy.cscv_slices as usize,
                selectable_trials: intent.payload.robustness_policy.selectable_trial_count as usize,
                max_pbo_ppm: intent.payload.robustness_policy.max_pbo_ppm,
                min_dsr_ppm: intent.payload.robustness_policy.min_dsr_ppm,
            },
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

fn classify_price_only_trials(
    trials: &[FormationTrialEvidence<'_>],
    variant_count: usize,
) -> anyhow::Result<Vec<FormationTrialDisposition>> {
    anyhow::ensure!(
        variant_count > 1,
        "price-only deletion controls are missing"
    );
    let mut dispositions = Vec::with_capacity(trials.len());
    let mut groups = trials.chunks_exact(variant_count);

    for group in &mut groups {
        let (full, controls) = group
            .split_first()
            .context("price-only full trial is missing")?;
        let full_projection = full
            .projection
            .as_ref()
            .context("price-only full projection is missing")?;
        let objective = Money::from_str(price_outcome(full_projection, CASH_NET_PNL)?)
            .map_err(anyhow::Error::msg)?;
        let costs = Money::from_str(price_outcome(full_projection, CASH_NATIVE_COMMISSIONS)?)
            .map_err(anyhow::Error::msg)?;
        let strictly_beats_every_deletion = controls.iter().try_fold(true, |acc, control| {
            let control_projection = control
                .projection
                .as_ref()
                .context("price-only deletion projection is missing")?;
            let control_objective =
                Money::from_str(price_outcome(control_projection, CASH_NET_PNL)?)
                    .map_err(anyhow::Error::msg)?;
            Ok::<_, anyhow::Error>(acc && objective.raw > control_objective.raw)
        })?;
        let completed_round_trips =
            price_outcome(full_projection, CASH_COMPLETED_ROUND_TRIPS)?.parse::<usize>()?;
        dispositions.push(
            if completed_round_trips > 0
                && objective.raw > costs.raw
                && strictly_beats_every_deletion
            {
                FormationTrialDisposition::FormationSurvivorNotQualified
            } else {
                FormationTrialDisposition::EconomicRejected
            },
        );
        dispositions.extend(
            controls
                .iter()
                .map(|_| FormationTrialDisposition::DeletionControl),
        );
    }
    anyhow::ensure!(
        groups.remainder().is_empty(),
        "price-only deletion group is incomplete"
    );
    Ok(dispositions)
}

fn select_price_only_trial(
    trials: &[FormationTrialEvidence<'_>],
    dispositions: &[FormationTrialDisposition],
    intent: &PriceOnlyResearchIntent,
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
            .context("price-only survivor projection is missing")?;
        let objective = Money::from_str(price_outcome(projection, CASH_NET_PNL)?)
            .map_err(anyhow::Error::msg)?;
        let scale = intent
            .payload
            .family
            .tuples
            .iter()
            .find(|tuple| tuple.id == trial.parameter_id)
            .map(|tuple| tuple.target_risk_bps)
            .context("price-only survivor has no frozen risk normalizer")?;
        let replace = match selected.as_ref() {
            None => true,
            Some((current, current_objective)) => {
                let current_scale = intent
                    .payload
                    .family
                    .tuples
                    .iter()
                    .find(|tuple| tuple.id == current.parameter_id)
                    .map(|tuple| tuple.target_risk_bps)
                    .context("selected price-only survivor has no frozen risk normalizer")?;
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

fn price_outcome<'a>(
    projection: &'a FormationTrialProjection,
    name: &str,
) -> anyhow::Result<&'a str> {
    projection
        .outcome
        .get(name)
        .map(String::as_str)
        .with_context(|| format!("price-only projection has no {name}"))
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

    #[rstest]
    fn price_only_economic_and_selection_policy_stays_in_the_adapter() {
        let intent = PriceOnlyResearchIntent::frozen().unwrap();
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

        let dispositions = classify_price_only_trials(&trials, 5).unwrap();
        assert_eq!(
            select_price_only_trial(&trials, &dispositions, &intent)
                .unwrap()
                .as_deref(),
            Some(family.trials()[0].parameter_id())
        );

        trials[4]
            .projection
            .as_mut()
            .unwrap()
            .outcome
            .insert(CASH_NET_PNL.to_string(), "3.00000000 USDT".to_string());
        let dispositions = classify_price_only_trials(&trials, 5).unwrap();
        assert_eq!(
            select_price_only_trial(&trials, &dispositions, &intent)
                .unwrap()
                .as_deref(),
            Some(family.trials()[5].parameter_id())
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
            crate::producer::NativeProducerEvidence::verified_for_test(),
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
        assert!(receipt.require_sealed_qualification_boundary().is_err());
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
