//! Complete ordered EVENT corpus composition into the real Backtest engine.
//!
//! The adapter derives its scheduler frames from the move-only Owner package. Callers cannot
//! select, omit, duplicate, or reorder corpus members, and one strategy owns one persistent Host.

use std::{fmt::Debug, rc::Rc, sync::Arc};

use serde::Serialize;
use strategy_factory_program_sdk::lifecycle_v1::{
    EnvelopePayloadV1, EventOrderKeyV1, LifecycleEnvelopeV1, LifecycleKind,
};
use vibe_common::actor::DataActor;
use vibe_core::UnixNanos;
use vibe_data::owner::{
    source_binding::BindingDigest,
    strategy_input_event_corpus_v1::StrategyInputEventReplayPackageV1,
};
use vibe_model::{
    data::{CustomData, CustomDataTrait, Data, DataType, HasTsInit},
    identifiers::StrategyId,
};
use vibe_trading::{
    strategy::{StrategyConfig, StrategyCore},
    vibe_strategy,
};

use crate::{native_replay_v2::PreparedProgramHostHandoffV2, program_host_v2::ProgramHostV2};

const EVENT_CORPUS_DATA_TYPE_V1: &str = "StrategyInputEventCorpusTriggerV1";

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
struct EventCorpusTriggerV1 {
    corpus_digest: [u8; 32],
    ordinal: usize,
    logical_time_ns: u64,
    event_time_ns: u64,
    owner_sequence: u64,
    event_identity: [u8; 16],
}

impl HasTsInit for EventCorpusTriggerV1 {
    fn ts_init(&self) -> UnixNanos {
        self.logical_time_ns.into()
    }
}

impl CustomDataTrait for EventCorpusTriggerV1 {
    fn type_name(&self) -> &'static str {
        EVENT_CORPUS_DATA_TYPE_V1
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn ts_event(&self) -> UnixNanos {
        self.event_time_ns.into()
    }

    fn to_json(&self) -> anyhow::Result<String> {
        serde_json::to_string(self).map_err(Into::into)
    }

    fn clone_arc(&self) -> Arc<dyn CustomDataTrait> {
        Arc::new(self.clone())
    }

    fn eq_arc(&self, other: &dyn CustomDataTrait) -> bool {
        other.as_any().downcast_ref::<Self>() == Some(self)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(crate) struct EventCorpusBacktestTransitionV1 {
    pub(crate) ordinal: usize,
    pub(crate) logical_time_ns: u64,
    pub(crate) event_time_ns: u64,
    pub(crate) owner_sequence: u64,
    pub(crate) event_identity: [u8; 16],
    pub(crate) checkpoint_before: [u8; 32],
    pub(crate) checkpoint_after: [u8; 32],
    pub(crate) semantic_trace: Vec<u8>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub(crate) struct EventCorpusBacktestTraceV1 {
    pub(crate) callback_failure: Option<String>,
    pub(crate) host_identity: [u8; 32],
    pub(crate) corpus_digest: [u8; 32],
    pub(crate) expected_count: usize,
    pub(crate) plugin_calls: u64,
    pub(crate) transitions: Vec<EventCorpusBacktestTransitionV1>,
}

pub(crate) struct EventCorpusBacktestStrategyV1 {
    core: StrategyCore,
    host: ProgramHostV2,
    package: StrategyInputEventReplayPackageV1,
    data_type: DataType,
    next_ordinal: usize,
    trace: Rc<std::cell::RefCell<EventCorpusBacktestTraceV1>>,
}

impl EventCorpusBacktestStrategyV1 {
    pub(crate) fn from_handoff(
        strategy_id: StrategyId,
        handoff: PreparedProgramHostHandoffV2,
        trace: Rc<std::cell::RefCell<EventCorpusBacktestTraceV1>>,
    ) -> anyhow::Result<(Self, Vec<Data>)> {
        let (host, package) = handoff.into_event_corpus_parts_v1()?;
        Self::from_parts(strategy_id, host, package, trace)
    }

    fn from_parts(
        strategy_id: StrategyId,
        host: ProgramHostV2,
        package: StrategyInputEventReplayPackageV1,
        trace: Rc<std::cell::RefCell<EventCorpusBacktestTraceV1>>,
    ) -> anyhow::Result<(Self, Vec<Data>)> {
        anyhow::ensure!(
            package.has_valid_digest(),
            "invalid Owner EVENT corpus package"
        );
        let corpus = package.corpus();
        anyhow::ensure!(
            corpus.expected_count() >= 2 && corpus.expected_count() == corpus.members().len(),
            "incomplete Owner EVENT corpus"
        );
        let corpus_digest = corpus.digest();
        let data_type = DataType::new(EVENT_CORPUS_DATA_TYPE_V1, None, None);
        let data = corpus
            .members()
            .iter()
            .enumerate()
            .map(|(ordinal, member)| {
                let key = member.order_key();
                Data::Custom(CustomData::new(
                    Arc::new(EventCorpusTriggerV1 {
                        corpus_digest: *corpus_digest.as_bytes(),
                        ordinal,
                        logical_time_ns: key.logical_time(),
                        event_time_ns: key.event_time(),
                        owner_sequence: key.owner_sequence(),
                        event_identity: key.event_identity(),
                    }),
                    data_type.clone(),
                ))
            })
            .collect();
        *trace.borrow_mut() = EventCorpusBacktestTraceV1 {
            callback_failure: None,
            host_identity: *host.host_identity().as_bytes(),
            corpus_digest: *corpus_digest.as_bytes(),
            expected_count: corpus.expected_count(),
            plugin_calls: 0,
            transitions: Vec::with_capacity(corpus.expected_count()),
        };
        Ok((
            Self {
                core: StrategyCore::new(
                    StrategyConfig::builder().strategy_id(strategy_id).build()?,
                ),
                host,
                package,
                data_type,
                next_ordinal: 0,
                trace,
            },
            data,
        ))
    }

    fn on_start_checked(&mut self) -> anyhow::Result<()> {
        let first = self
            .package
            .corpus()
            .members()
            .first()
            .ok_or_else(|| anyhow::anyhow!("Owner EVENT corpus is empty"))?
            .order_key();
        let logical_time = first.logical_time().saturating_sub(1);
        let envelope = lifecycle_envelope(
            logical_time,
            logical_time,
            LifecycleKind::Start,
            1,
            stable_identity(
                b"strategy.event-corpus-backtest.start.v1\0",
                self.package.corpus().digest(),
            ),
            EnvelopePayloadV1::Start,
        )?;
        let event = self.host.admit_backtest_lifecycle_event(envelope)?;
        self.host.apply_event(&event)?;
        self.subscribe_data(self.data_type.clone(), None, None);
        Ok(())
    }

    fn on_data_checked(&mut self, data: &CustomData) -> anyhow::Result<()> {
        anyhow::ensure!(
            data.data_type == self.data_type,
            "foreign EVENT scheduler type"
        );
        let trigger = data
            .data
            .as_any()
            .downcast_ref::<EventCorpusTriggerV1>()
            .ok_or_else(|| anyhow::anyhow!("foreign EVENT scheduler payload"))?;
        anyhow::ensure!(
            trigger.ordinal == self.next_ordinal
                && trigger.corpus_digest == *self.package.corpus().digest().as_bytes(),
            "EVENT scheduler omitted, duplicated, or reordered a corpus member"
        );
        let member = self
            .package
            .corpus()
            .members()
            .get(self.next_ordinal)
            .ok_or_else(|| anyhow::anyhow!("EVENT scheduler exceeded the Owner corpus"))?;
        let key = member.order_key();
        anyhow::ensure!(
            (
                trigger.logical_time_ns,
                trigger.event_time_ns,
                trigger.owner_sequence,
                trigger.event_identity,
            ) == (
                key.logical_time(),
                key.event_time(),
                key.owner_sequence(),
                key.event_identity(),
            ),
            "EVENT scheduler identity does not match the next Owner member"
        );
        let before = self.host.checkpoint().digest();
        let semantic_trace = self
            .host
            .apply_market_data_joined_cut(member.joined_cut())?;
        let after = self.host.checkpoint().digest();
        self.trace
            .borrow_mut()
            .transitions
            .push(EventCorpusBacktestTransitionV1 {
                ordinal: self.next_ordinal,
                logical_time_ns: key.logical_time(),
                event_time_ns: key.event_time(),
                owner_sequence: key.owner_sequence(),
                event_identity: key.event_identity(),
                checkpoint_before: *before.as_bytes(),
                checkpoint_after: *after.as_bytes(),
                semantic_trace: semantic_trace.encode().to_vec(),
            });
        self.next_ordinal += 1;
        self.trace.borrow_mut().plugin_calls = self.host.plugin_calls();
        Ok(())
    }

    fn on_stop_checked(&mut self) -> anyhow::Result<()> {
        self.unsubscribe_data(self.data_type.clone(), None, None);
        anyhow::ensure!(
            self.next_ordinal == self.package.corpus().expected_count(),
            "Backtest stopped before exhausting the Owner EVENT corpus"
        );
        let now = self.clock().timestamp_ns().as_u64();
        let envelope = lifecycle_envelope(
            now,
            now,
            LifecycleKind::Stop,
            u64::MAX,
            stable_identity(
                b"strategy.event-corpus-backtest.stop.v1\0",
                self.package.corpus().digest(),
            ),
            EnvelopePayloadV1::Stop,
        )?;
        let event = self.host.admit_backtest_lifecycle_event(envelope)?;
        self.host.apply_event(&event)?;
        Ok(())
    }

    fn finish_callback(&self, result: anyhow::Result<()>) -> anyhow::Result<()> {
        if let Err(e) = &result {
            self.trace.borrow_mut().callback_failure = Some(format!("{e:#}"));
        }
        result
    }
}

vibe_strategy!(EventCorpusBacktestStrategyV1);

impl Debug for EventCorpusBacktestStrategyV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("EventCorpusBacktestStrategyV1")
    }
}

impl DataActor for EventCorpusBacktestStrategyV1 {
    fn on_start(&mut self) -> anyhow::Result<()> {
        let result = self.on_start_checked();
        self.finish_callback(result)
    }

    fn on_data(&mut self, data: &CustomData) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.trace.borrow().callback_failure.is_none(),
            "EVENT corpus Backtest strategy is faulted"
        );
        let result = self.on_data_checked(data);
        self.finish_callback(result)
    }

    fn on_stop(&mut self) -> anyhow::Result<()> {
        let result = self.on_stop_checked();
        self.finish_callback(result)
    }
}

fn lifecycle_envelope(
    logical_time_ns: u64,
    event_time_ns: u64,
    kind: LifecycleKind,
    owner_sequence: u64,
    event_identity: [u8; 16],
    payload: EnvelopePayloadV1,
) -> anyhow::Result<LifecycleEnvelopeV1> {
    let key = EventOrderKeyV1::new(
        logical_time_ns,
        event_time_ns,
        kind,
        owner_sequence,
        event_identity,
    )
    .map_err(|e| anyhow::anyhow!("EVENT corpus lifecycle key rejected: {e:?}"))?;
    LifecycleEnvelopeV1::new_bound(key, payload)
        .map_err(|e| anyhow::anyhow!("EVENT corpus lifecycle rejected: {e:?}"))
}

fn stable_identity(domain: &[u8], digest: BindingDigest) -> [u8; 16] {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(digest.as_bytes());
    hasher.finalize()[..16]
        .try_into()
        .expect("SHA-256 prefix has fixed length")
}

#[cfg(all(test, feature = "sealed-strategy-input-acceptance"))]
mod tests {
    use std::{cell::RefCell, rc::Rc};

    use rstest::rstest;
    use vibe_backtest::{config::BacktestEngineConfig, engine::BacktestEngine};
    use vibe_data::owner::pit_snapshot::joined_input_sealed_acceptance::issue_strategy_input_event_replay_package_for_sealed_acceptance_v1;
    use vibe_model::identifiers::StrategyId;

    use super::*;
    use crate::program_host_v2::{
        ProgramHostV2, admit_market_data_joined_program_event_v2, event_corpus_plan_and_artifact,
    };

    #[rstest]
    fn complete_owner_event_corpus_runs_repeatably_through_one_host_and_real_backtest() {
        let first = run_event_corpus().expect("first complete EVENT Backtest run");
        let repeated = run_event_corpus().expect("repeated complete EVENT Backtest run");
        assert_eq!(first, repeated);
        assert_eq!(first.expected_count, 3);
        assert_eq!(first.transitions.len(), first.expected_count);
        assert_eq!(first.plugin_calls, first.expected_count as u64);
        assert!(first.callback_failure.is_none());
        assert!(
            first
                .transitions
                .windows(2)
                .all(|pair| pair[0].checkpoint_after == pair[1].checkpoint_before)
        );
        assert!(
            first
                .transitions
                .iter()
                .all(|transition| transition.checkpoint_before != transition.checkpoint_after)
        );
    }

    fn run_event_corpus() -> anyhow::Result<EventCorpusBacktestTraceV1> {
        let acceptance = issue_strategy_input_event_replay_package_for_sealed_acceptance_v1()?;
        let (bindings, package) = acceptance.into_parts();
        let (plan, artifact) = event_corpus_plan_and_artifact(&bindings);
        for (ordinal, member) in package.corpus().members().iter().enumerate() {
            admit_market_data_joined_program_event_v2(&plan, member.joined_cut())
                .unwrap_or_else(|e| {
                    panic!(
                        "Owner EVENT corpus member {ordinal} did not admit against the exact Plan: {e:?}"
                    )
                });
        }
        let host = ProgramHostV2::new(plan, artifact)?;
        let trace = Rc::new(RefCell::new(EventCorpusBacktestTraceV1::default()));
        let (strategy, data) = EventCorpusBacktestStrategyV1::from_parts(
            StrategyId::from("OWNER-EVENT-CORPUS-BACKTEST-001"),
            host,
            package,
            Rc::clone(&trace),
        )?;
        let mut engine = BacktestEngine::new(BacktestEngineConfig {
            bypass_logging: true,
            run_analysis: false,
            ..Default::default()
        })?;
        engine.add_strategy(strategy)?;
        engine.add_data(data, None, true, true)?;
        engine.run(None, None, Some("owner-event-corpus-v1".into()), false)?;
        let observed = trace.borrow().clone();
        Ok(observed)
    }
}
