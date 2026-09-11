//! Move-only `ProgramHostV2` target-set execution in the real Sim Exchange EVENT route.
//!
//! Replay policy materialization owns construction of the capability. This module owns the sole
//! consumption boundary and returns observations only after native fills have been accepted by the
//! running Host. BAR values schedule ProgramHost input; `bar_execution = false` keeps execution on
//! native order-book events.

use std::{cell::Cell, collections::BTreeSet, rc::Rc};

use serde::Serialize;
use sha2::{Digest, Sha256};
use strategy_factory_program_sdk::lifecycle_v2::TARGET_SET_MEMBER_COUNT;
use vibe_model::instruments::Instrument;

use crate::{
    program_host_backtest_target_set_v2::{
        BacktestTargetSetProgramHostStrategyV2, TargetSetActualFillConsumptionV1,
        TargetSetBacktestTraceV2,
    },
    replay_target_set_execution_bundle_v1::{
        ReplayTargetSetExecutionBundleV1, ReplayTargetSetExecutionCensusV1,
    },
};

const CANONICAL_RESULT_DOMAIN: &[u8] = b"strategy.program-host.sim-event.result.v1\0";

/// One native fill proven to have advanced the exact running Host member.
///
/// It has no public constructor or deserializer. Canceled, rejected, expired, and zero-quantity
/// observations cannot produce this value.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ProgramHostSimEventFillReadbackV1 {
    client_order_id: String,
    instrument: String,
    intent_identity: [u8; 16],
    disposition: String,
    cumulative_filled_grid_units: u64,
    filled_native_quantity: String,
    checkpoint_before: [u8; 32],
    checkpoint_after: [u8; 32],
}

impl ProgramHostSimEventFillReadbackV1 {
    #[must_use]
    pub fn client_order_id(&self) -> &str {
        &self.client_order_id
    }

    #[must_use]
    pub fn instrument(&self) -> &str {
        &self.instrument
    }

    #[must_use]
    pub const fn intent_identity(&self) -> [u8; 16] {
        self.intent_identity
    }

    #[must_use]
    pub fn disposition(&self) -> &str {
        &self.disposition
    }

    #[must_use]
    pub const fn cumulative_filled_grid_units(&self) -> u64 {
        self.cumulative_filled_grid_units
    }

    #[must_use]
    pub fn filled_native_quantity(&self) -> &str {
        &self.filled_native_quantity
    }

    #[must_use]
    pub const fn checkpoint_before(&self) -> [u8; 32] {
        self.checkpoint_before
    }

    #[must_use]
    pub const fn checkpoint_after(&self) -> [u8; 32] {
        self.checkpoint_after
    }
}

impl From<TargetSetActualFillConsumptionV1> for ProgramHostSimEventFillReadbackV1 {
    fn from(value: TargetSetActualFillConsumptionV1) -> Self {
        Self {
            client_order_id: value.client_order_id,
            instrument: value.instrument,
            intent_identity: value.intent_identity,
            disposition: value.disposition,
            cumulative_filled_grid_units: value.cumulative_filled_grid_units,
            filled_native_quantity: value.filled_native_quantity,
            checkpoint_before: value.checkpoint_before,
            checkpoint_after: value.checkpoint_after,
        }
    }
}

/// Read-only proof that one bound ProgramHost target set reached native Sim EVENT fills.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ProgramHostSimEventReadbackV1 {
    execution_route: String,
    consumption_census: ReplayTargetSetExecutionCensusV1,
    canonical_result_digest: [u8; 32],
    target_set_count: usize,
    position_submit_count: usize,
    equity_snapshot_identities: Vec<[u8; 32]>,
    actual_fills: Vec<ProgramHostSimEventFillReadbackV1>,
}

impl ProgramHostSimEventReadbackV1 {
    #[must_use]
    pub fn execution_route(&self) -> &str {
        &self.execution_route
    }

    #[must_use]
    pub const fn execution_profile_digest(&self) -> [u8; 32] {
        self.consumption_census.native_materialization_digest()
    }

    #[must_use]
    pub fn instrument_fact_digests(&self) -> [[u8; 32]; TARGET_SET_MEMBER_COUNT] {
        self.consumption_census.instrument_fact_digests()
    }

    #[must_use]
    pub fn instrument_receipt_digests(&self) -> [[u8; 32]; TARGET_SET_MEMBER_COUNT] {
        self.consumption_census.instrument_receipt_digests()
    }

    #[must_use]
    pub const fn consumption_census(&self) -> &ReplayTargetSetExecutionCensusV1 {
        &self.consumption_census
    }

    #[must_use]
    pub const fn canonical_result_digest(&self) -> [u8; 32] {
        self.canonical_result_digest
    }

    #[must_use]
    pub const fn target_set_count(&self) -> usize {
        self.target_set_count
    }

    #[must_use]
    pub const fn position_submit_count(&self) -> usize {
        self.position_submit_count
    }

    #[must_use]
    pub fn equity_snapshot_identities(&self) -> &[[u8; 32]] {
        &self.equity_snapshot_identities
    }

    #[must_use]
    pub fn actual_fills(&self) -> &[ProgramHostSimEventFillReadbackV1] {
        &self.actual_fills
    }
}

/// Runs one request-bound ProgramHost target set through the real Backtest/Sim Exchange EVENT path.
///
/// # Errors
///
/// Returns an error before evidence exists if capability validation, whole-batch reconciliation,
/// native submission, callback execution, result capture, or actual fill consumption fails.
pub fn run_program_host_sim_event_consumer_v1(
    capability: ReplayTargetSetExecutionBundleV1,
) -> anyhow::Result<ProgramHostSimEventReadbackV1> {
    let ReplayTargetSetExecutionBundleV1 {
        plan,
        artifact,
        universe_frame,
        native_profile,
        account_scope_id,
        strategy_id,
        run_id,
        instruments,
        bar_types,
        data,
        census,
    } = capability;
    let trace = Rc::new(std::cell::RefCell::new(TargetSetBacktestTraceV2::default()));
    let strategy = BacktestTargetSetProgramHostStrategyV2::new(
        strategy_id,
        plan,
        artifact,
        instruments.each_ref().map(Instrument::id),
        bar_types,
        [universe_frame],
        Some(account_scope_id),
        false,
        Rc::new(Cell::new(false)),
        Rc::clone(&trace),
    )?;
    let mut engine = native_profile.into_backtest_engine(&instruments)?;
    engine.add_strategy(strategy)?;
    engine.add_data(data, None, true, true)?;
    engine.run(None, None, Some(run_id), false)?;

    let observed = trace.borrow().clone();
    if let Some(failure) = &observed.callback_failure {
        anyhow::bail!("ProgramHost Sim EVENT callback failed: {failure}");
    }
    let actual_fills = observed
        .actual_fill_consumptions
        .iter()
        .cloned()
        .map(ProgramHostSimEventFillReadbackV1::from)
        .collect::<Vec<_>>();
    validate_actual_consumption(&observed, &actual_fills, &census)?;
    let canonical_result = engine.get_canonical_result()?.to_bytes()?;
    let mut hasher = Sha256::new();
    hasher.update(CANONICAL_RESULT_DOMAIN);
    hasher.update((canonical_result.len() as u64).to_le_bytes());
    hasher.update(&canonical_result);
    let canonical_result_digest = hasher.finalize().into();

    Ok(ProgramHostSimEventReadbackV1 {
        execution_route: "EVENT".to_owned(),
        consumption_census: census,
        canonical_result_digest,
        target_set_count: observed.canonical_target_sets.len(),
        position_submit_count: observed.successful_position_submits.len(),
        equity_snapshot_identities: observed
            .equity_snapshots
            .iter()
            .map(|snapshot| snapshot.snapshot_identity)
            .collect(),
        actual_fills,
    })
}

fn validate_actual_consumption(
    observed: &TargetSetBacktestTraceV2,
    actual_fills: &[ProgramHostSimEventFillReadbackV1],
    census: &ReplayTargetSetExecutionCensusV1,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        observed.canonical_target_sets.len() == 1 && observed.equity_snapshots.len() == 1,
        "Sim EVENT run did not consume exactly one reconciled target set"
    );
    anyhow::ensure!(
        !observed.successful_position_submits.is_empty() && !actual_fills.is_empty(),
        "Sim EVENT run returned without an actual native fill"
    );
    let submitted = observed
        .successful_position_submits
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let mut consumed = BTreeSet::new();
    let mut filled_members = BTreeSet::new();
    for fill in actual_fills {
        let native_fill_observed = observed.native_order_observations.iter().any(|event| {
            event.event == "FILLED"
                && event.client_order_id == fill.client_order_id
                && event.instrument == fill.instrument
                && event.intent_identity == fill.intent_identity
                && event.filled_native_quantity == fill.filled_native_quantity
        });
        anyhow::ensure!(
            submitted.contains(fill.client_order_id())
                && native_fill_observed
                && matches!(fill.disposition(), "PARTIALLY_FILLED" | "FILLED")
                && fill.cumulative_filled_grid_units() > 0
                && fill.checkpoint_before() != fill.checkpoint_after()
                && consumed.insert((fill.client_order_id(), fill.cumulative_filled_grid_units())),
            "Sim EVENT actual-consumption evidence is not exact"
        );
        filled_members.insert(fill.instrument());
    }
    let expected_members = census
        .member_instruments()
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    anyhow::ensure!(
        filled_members == expected_members,
        "Sim EVENT run did not fill every request-bound member"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::program_host_backtest_target_set_v2::{
        TargetSetEquitySnapshotObservationV2, TargetSetNativeOrderObservationV2,
    };

    fn actual_fill() -> ProgramHostSimEventFillReadbackV1 {
        ProgramHostSimEventFillReadbackV1 {
            client_order_id: "O-1".to_owned(),
            instrument: "AAPL.XNAS".to_owned(),
            intent_identity: [7; 16],
            disposition: "FILLED".to_owned(),
            cumulative_filled_grid_units: 2,
            filled_native_quantity: "2".to_owned(),
            checkpoint_before: [1; 32],
            checkpoint_after: [2; 32],
        }
    }

    fn second_actual_fill() -> ProgramHostSimEventFillReadbackV1 {
        ProgramHostSimEventFillReadbackV1 {
            client_order_id: "O-2".to_owned(),
            instrument: "MSFT.XNAS".to_owned(),
            intent_identity: [8; 16],
            disposition: "FILLED".to_owned(),
            cumulative_filled_grid_units: 1,
            filled_native_quantity: "1".to_owned(),
            checkpoint_before: [2; 32],
            checkpoint_after: [3; 32],
        }
    }

    fn observed(event: &str) -> TargetSetBacktestTraceV2 {
        TargetSetBacktestTraceV2 {
            successful_position_submits: vec!["O-1".to_owned(), "O-2".to_owned()],
            canonical_target_sets: vec![vec![1]],
            equity_snapshots: vec![TargetSetEquitySnapshotObservationV2 {
                account_id: "XNAS-001".to_owned(),
                currency: "USD".to_owned(),
                equity: "1000000 USD".to_owned(),
                current_grid_units: [0, 0],
                derived_grid_targets: [2, 0],
                snapshot_identity: [3; 32],
            }],
            native_order_observations: vec![
                TargetSetNativeOrderObservationV2 {
                    client_order_id: "O-1".to_owned(),
                    instrument: "AAPL.XNAS".to_owned(),
                    intent_identity: [7; 16],
                    event: event.to_owned(),
                    status: event.to_owned(),
                    filled_native_quantity: "2".to_owned(),
                    cached_position_native_quantity: "2".to_owned(),
                    protection_order: false,
                },
                TargetSetNativeOrderObservationV2 {
                    client_order_id: "O-2".to_owned(),
                    instrument: "MSFT.XNAS".to_owned(),
                    intent_identity: [8; 16],
                    event: event.to_owned(),
                    status: event.to_owned(),
                    filled_native_quantity: "1".to_owned(),
                    cached_position_native_quantity: "1".to_owned(),
                    protection_order: false,
                },
            ],
            ..Default::default()
        }
    }

    fn native_observation(event: &str) -> TargetSetNativeOrderObservationV2 {
        TargetSetNativeOrderObservationV2 {
            client_order_id: "O-1".to_owned(),
            instrument: "AAPL.XNAS".to_owned(),
            intent_identity: [7; 16],
            event: event.to_owned(),
            status: event.to_owned(),
            filled_native_quantity: "2".to_owned(),
            cached_position_native_quantity: "2".to_owned(),
            protection_order: false,
        }
    }

    #[test]
    fn accepted_native_fill_is_exact_actual_consumption() {
        let census = test_census();
        validate_actual_consumption(
            &observed("FILLED"),
            &[actual_fill(), second_actual_fill()],
            &census,
        )
        .unwrap();
    }

    #[test]
    fn rejected_or_canceled_observation_cannot_count_as_actual_fill() {
        for terminal in ["REJECTED", "CANCELED", "EXPIRED"] {
            assert!(
                validate_actual_consumption(
                    &observed(terminal),
                    &[actual_fill(), second_actual_fill()],
                    &test_census()
                )
                .is_err()
            );
        }
    }

    #[test]
    fn prior_partial_fill_remains_consumed_when_order_later_cancels() {
        let mut trace = observed("FILLED");
        trace
            .native_order_observations
            .push(native_observation("CANCELED"));
        validate_actual_consumption(
            &trace,
            &[actual_fill(), second_actual_fill()],
            &test_census(),
        )
        .unwrap();
    }

    #[test]
    fn zero_or_unchanged_fill_evidence_fails_closed() {
        let mut zero = actual_fill();
        zero.cumulative_filled_grid_units = 0;
        assert!(
            validate_actual_consumption(
                &observed("FILLED"),
                &[zero, second_actual_fill()],
                &test_census()
            )
            .is_err()
        );
        let mut unchanged = actual_fill();
        unchanged.checkpoint_after = unchanged.checkpoint_before;
        assert!(
            validate_actual_consumption(
                &observed("FILLED"),
                &[unchanged, second_actual_fill()],
                &test_census()
            )
            .is_err()
        );
    }

    #[test]
    fn missing_or_duplicate_member_consumption_fails_closed() {
        assert!(
            validate_actual_consumption(&observed("FILLED"), &[actual_fill()], &test_census())
                .is_err()
        );
        assert!(
            validate_actual_consumption(
                &observed("FILLED"),
                &[actual_fill(), actual_fill()],
                &test_census()
            )
            .is_err()
        );
    }

    fn test_census() -> ReplayTargetSetExecutionCensusV1 {
        ReplayTargetSetExecutionCensusV1 {
            request_locator: crate::exploratory_replay::ExploratoryReplayRequestLocatorV2 {
                request_identity: "request".to_owned(),
                meaning_digest: "meaning".to_owned(),
                receipt_identity: "receipt".to_owned(),
                seal_digest: "seal".to_owned(),
            },
            owner_authority_digest: [16; 32],
            trial_family_identity: "trial-family".to_owned(),
            trial_family_digest: [17; 32],
            economic_configuration_digest: [18; 32],
            runner_operational_profile_digest: [19; 32],
            execution_profile_binding_digest: [1; 32],
            native_materialization_digest: [2; 32],
            canonical_plan_digest: [3; 32],
            artifact_identity: [4; 32],
            universe_frame_digest: [5; 32],
            universe_selection_identity: [6; 32],
            universe_selection_digest: [7; 32],
            observation_batch_digest: [8; 32],
            member_instruments: ["AAPL.XNAS".to_owned(), "MSFT.XNAS".to_owned()],
            instrument_terms: [
                test_instrument_census("AAPL", [9; 32], [11; 32]),
                test_instrument_census("MSFT", [10; 32], [12; 32]),
            ],
            scheduling_data_digest: [13; 32],
            scheduling_data_count: 4,
            bar_count: 2,
            event_count: 2,
            census_digest: [14; 32],
        }
    }

    fn test_instrument_census(
        instrument_identity: &str,
        instrument_fact_digest: [u8; 32],
        instrument_receipt_digest: [u8; 32],
    ) -> crate::replay_target_set_execution_bundle_v1::ReplayTargetSetInstrumentCensusV1 {
        crate::replay_target_set_execution_bundle_v1::ReplayTargetSetInstrumentCensusV1 {
            instrument_identity: instrument_identity.to_owned(),
            instrument_fact_digest,
            instrument_receipt_digest,
            terms_digest: [15; 32],
            venue_identity: "XNAS".to_owned(),
            quote_currency: "USD".to_owned(),
            account_scope_identity: "XNAS-001".to_owned(),
            event_time_ns: 1_000,
            valid_from_ns: 0,
            valid_until_ns_exclusive: 2_000,
            margin_model: "STANDARD_MARGIN_MODEL".to_owned(),
            maker_fee: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1 {
                mantissa: 1,
                scale: 4,
            },
            taker_fee: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1 {
                mantissa: 2,
                scale: 4,
            },
            initial_margin: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1 {
                mantissa: 1,
                scale: 1,
            },
            maintenance_margin: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1 {
                mantissa: 5,
                scale: 2,
            },
        }
    }
}
