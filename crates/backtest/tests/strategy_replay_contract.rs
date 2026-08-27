use std::{
    cell::RefCell,
    collections::{BTreeMap, VecDeque},
    error::Error,
    fmt::Display,
    rc::Rc,
};

use rstest::rstest;
use strategy_factory_program_sdk::lifecycle_v1::{
    EnvelopePayloadV1, FillDispositionV1, FillFrontierV1, LifecycleKind, PositionIntentV1,
    ProtectionProposalV1, ProtectionSemanticSetV1, ProtectionStateV1, SemanticTraceV1,
    TRACE_SCHEMA_VERSION, TargetProposalV1, TargetSemanticV1, TargetStateV1,
    UnsealedGuestProposalV1, seal_guest_proposal_with_derived_digest_v1,
};
use vibe_backtest::{
    result::CanonicalBacktestResult,
    strategy_replay::{
        AdapterFaultV1, CanonicalStrategyReplayResultV1, ConsumedProgramIdentitiesV1, DigestV1,
        HostLifecycleOutcomeV1, LifecycleProgramHost, LifecycleSourceEvidenceV1,
        NormalizedLifecycleEventV1, SimulatedOrderIntentV1, StrategyReplayAdapterV1,
        StrategyReplayResultFaultV1, StrategyReplaySourceV1,
    },
};

fn digest(value: u8) -> DigestV1 {
    [value; 32]
}

fn source(value: u8) -> LifecycleSourceEvidenceV1 {
    LifecycleSourceEvidenceV1::new(digest(value), digest(value + 1), digest(value + 2)).unwrap()
}

fn identities() -> ConsumedProgramIdentitiesV1 {
    ConsumedProgramIdentitiesV1 {
        design_digest: digest(10),
        plan_digest: digest(11),
        artifact_digest: digest(12),
        runtime_profile_digest: digest(13),
        program_host_digest: digest(14),
        kernel_digest: digest(15),
        plugin_set_digest: digest(16),
        market_semantics_digest: digest(17),
    }
}

#[derive(Clone, Copy, Debug)]
enum Decision {
    Hold,
    Position(PositionIntentV1, i64),
}

#[derive(Debug, Default)]
struct HostProbe {
    calls: Vec<LifecycleKind>,
}

#[derive(Debug)]
struct FakeHost {
    probe: Rc<RefCell<HostProbe>>,
    decisions: VecDeque<Decision>,
    checkpoint: DigestV1,
    position_units: i64,
    fill_frontiers: BTreeMap<[u8; 16], u64>,
    fail_next: bool,
}

impl FakeHost {
    fn new(probe: Rc<RefCell<HostProbe>>, decisions: impl IntoIterator<Item = Decision>) -> Self {
        Self {
            probe,
            decisions: decisions.into_iter().collect(),
            checkpoint: digest(200),
            position_units: 0,
            fill_frontiers: BTreeMap::new(),
            fail_next: false,
        }
    }
}

#[derive(Debug)]
struct FakeHostFault;

impl Display for FakeHostFault {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("injected fake host failure")
    }
}

impl Error for FakeHostFault {}

impl LifecycleProgramHost for FakeHost {
    type Fault = FakeHostFault;

    fn consumed_identities(&self) -> ConsumedProgramIdentitiesV1 {
        identities()
    }

    fn consume(
        &mut self,
        event: &NormalizedLifecycleEventV1,
    ) -> Result<HostLifecycleOutcomeV1, Self::Fault> {
        self.probe
            .borrow_mut()
            .calls
            .push(event.envelope().order_key.kind);

        if self.fail_next {
            self.fail_next = false;
            return Err(FakeHostFault);
        }

        let before_position = self.position_units;
        let mut fill_disposition = None;
        let mut fill_frontier = FillFrontierV1::default();

        if let EnvelopePayloadV1::Fill(fill) = event.envelope().payload {
            let previous = self
                .fill_frontiers
                .insert(fill.intent_identity, fill.cumulative_filled_units)
                .unwrap_or(0);
            let newly_filled = fill.cumulative_filled_units - previous;
            let signed = i64::try_from(newly_filled).unwrap()
                * match fill.side {
                    strategy_factory_program_sdk::lifecycle_v1::FillSideV1::Buy => 1,
                    strategy_factory_program_sdk::lifecycle_v1::FillSideV1::Sell => -1,
                };
            self.position_units += signed;
            fill_disposition = Some(fill.disposition);
            fill_frontier = FillFrontierV1 {
                intent_identity: fill.intent_identity,
                cumulative_filled_units: fill.cumulative_filled_units,
                terminal_disposition: (!matches!(
                    fill.disposition,
                    FillDispositionV1::PartiallyFilled
                ))
                .then_some(fill.disposition),
            };
        }

        let proposal_required = matches!(
            event.envelope().order_key.kind,
            LifecycleKind::Bar | LifecycleKind::Event | LifecycleKind::Timer
        );
        let decision =
            proposal_required.then(|| self.decisions.pop_front().unwrap_or(Decision::Hold));
        let proposal = decision.map(|decision| {
            let (position, target, reconciliation) = match decision {
                Decision::Hold => (PositionIntentV1::Hold, TargetProposalV1::Keep, None),
                Decision::Position(position, target) => {
                    (position, TargetProposalV1::Position(target), Some(target))
                }
            };
            let guest = UnsealedGuestProposalV1::new(
                position,
                target,
                reconciliation,
                ProtectionProposalV1::Keep,
            )
            .unwrap();
            let ordinal = u8::try_from(self.probe.borrow().calls.len()).unwrap();
            seal_guest_proposal_with_derived_digest_v1(guest, [ordinal; 16], digest(80), digest(81))
                .unwrap()
        });
        let (position_intent, target_semantic, target, proposal_digest) = proposal.map_or(
            (
                PositionIntentV1::Hold,
                TargetSemanticV1::None,
                TargetStateV1::None,
                [0; 32],
            ),
            |proposal| {
                let semantic = match proposal.target {
                    TargetProposalV1::Keep => TargetSemanticV1::None,
                    TargetProposalV1::Position(_) => TargetSemanticV1::Position,
                    TargetProposalV1::WeightMicros(_) => TargetSemanticV1::Weight,
                    TargetProposalV1::RebalancePosition { .. }
                    | TargetProposalV1::RebalanceWeightMicros { .. } => TargetSemanticV1::Rebalance,
                };
                (
                    proposal.position,
                    semantic,
                    TargetStateV1::from(proposal.target),
                    proposal.proposal_digest,
                )
            },
        );
        let trace = SemanticTraceV1 {
            schema_version: TRACE_SCHEMA_VERSION,
            order_key: Some(event.envelope().order_key),
            envelope_digest: event.envelope().envelope_digest,
            proposal_digest,
            position_intent,
            target_semantic,
            protection_semantics: ProtectionSemanticSetV1::default(),
            target,
            protection: ProtectionStateV1::default(),
            fill_disposition,
            position_before_units: before_position,
            position_after_units: self.position_units,
            fill_frontier,
            strategy_state_digest: digest(80),
            plugin_state_digest: digest(81),
        };
        let before = self.checkpoint;
        let ordinal = u8::try_from(self.probe.borrow().calls.len()).unwrap();
        let after = digest(200_u8.saturating_sub(ordinal));
        self.checkpoint = after;
        let restart = vec![ordinal, event.envelope().order_key.kind as u8];
        HostLifecycleOutcomeV1::new(
            proposal,
            trace,
            before,
            after,
            restart.clone(),
            HostLifecycleOutcomeV1::restart_bundle_digest(&restart),
        )
        .map_err(|_| FakeHostFault)
    }
}

fn adapter(
    probe: Rc<RefCell<HostProbe>>,
    decisions: impl IntoIterator<Item = Decision>,
) -> StrategyReplayAdapterV1<FakeHost> {
    StrategyReplayAdapterV1::new(
        digest(1),
        digest(2),
        digest(3),
        digest(4),
        FakeHost::new(probe, decisions),
    )
    .unwrap()
}

fn inner_result() -> CanonicalBacktestResult {
    let bytes = br#"{"accounts":[],"components":{"actor_ids":[],"exec_algorithm_ids":[],"strategy_ids":[],"trader_state":"stopped"},"diagnostics":[],"fills":[],"orders":[],"portfolio_snapshots":[],"position_snapshots":[],"positions":[],"run":{"backtest_end_ns":null,"backtest_start_ns":null,"iterations":"0","outcome":"completed","run_config_id":null,"total_events":"0","total_orders":"0","total_positions":"0","trader_id":"T"},"schema":"vibe-backtest-result/v1","statistics":{"general":{},"pnls":{},"returns":{},"returns_series":[]},"summary":{}}"#;
    CanonicalBacktestResult::from_slice(bytes).unwrap()
}

fn next_order(
    adapter: &mut StrategyReplayAdapterV1<FakeHost>,
    time: u64,
) -> SimulatedOrderIntentV1 {
    adapter
        .consume(
            NormalizedLifecycleEventV1::bar(
                digest(2),
                time,
                time,
                time,
                source(u8::try_from(20 + time).unwrap()),
            )
            .unwrap(),
        )
        .unwrap()
        .unwrap()
}

fn fill(
    adapter: &mut StrategyReplayAdapterV1<FakeHost>,
    order: SimulatedOrderIntentV1,
    time: u64,
    disposition: FillDispositionV1,
    cumulative: u64,
) {
    let observation = adapter
        .seal_fill_observation(
            order.association().order_identity(),
            disposition,
            cumulative,
            time + 1,
            time + 1,
            time + 1,
            source(u8::try_from(50 + time).unwrap()),
        )
        .unwrap();
    adapter
        .consume(adapter.fill_event(&observation).unwrap())
        .unwrap();
}

#[rstest]
fn equal_time_bar_fill_timer_order_is_sdk_canonical() {
    let probe = Rc::new(RefCell::new(HostProbe::default()));
    let mut adapter = adapter(
        Rc::clone(&probe),
        [
            Decision::Position(PositionIntentV1::Enter, 5),
            Decision::Hold,
        ],
    );
    adapter
        .consume(NormalizedLifecycleEventV1::start(digest(2), 1, 1, 1, source(20)).unwrap())
        .unwrap();
    let order = adapter
        .consume(NormalizedLifecycleEventV1::bar(digest(2), 10, 10, 9, source(30)).unwrap())
        .unwrap()
        .unwrap();
    let observation = adapter
        .seal_fill_observation(
            order.association().order_identity(),
            FillDispositionV1::Filled,
            5,
            10,
            10,
            1,
            source(40),
        )
        .unwrap();
    adapter
        .consume(adapter.fill_event(&observation).unwrap())
        .unwrap();
    adapter
        .consume(NormalizedLifecycleEventV1::timer(digest(2), digest(50), 10, 10, 1).unwrap())
        .unwrap();
    adapter
        .consume(NormalizedLifecycleEventV1::stop(digest(2), 11, 11, 1, source(60)).unwrap())
        .unwrap();

    assert_eq!(
        probe.borrow().calls,
        vec![
            LifecycleKind::Start,
            LifecycleKind::Bar,
            LifecycleKind::Fill,
            LifecycleKind::Timer,
            LifecycleKind::Stop,
        ]
    );
}

#[rstest]
fn regression_is_rejected_before_host_call() {
    let probe = Rc::new(RefCell::new(HostProbe::default()));
    let mut adapter = adapter(Rc::clone(&probe), [Decision::Hold, Decision::Hold]);
    adapter
        .consume(NormalizedLifecycleEventV1::start(digest(2), 1, 1, 1, source(20)).unwrap())
        .unwrap();
    adapter
        .consume(NormalizedLifecycleEventV1::timer(digest(2), digest(21), 10, 10, 1).unwrap())
        .unwrap();
    let calls_before = probe.borrow().calls.len();
    let error = adapter
        .consume(NormalizedLifecycleEventV1::bar(digest(2), 10, 10, 2, source(30)).unwrap())
        .unwrap_err();
    assert_eq!(error, AdapterFaultV1::OrderingRegression);
    assert_eq!(probe.borrow().calls.len(), calls_before);
}

#[rstest]
fn timer_identity_is_deterministic_and_schedule_bound() {
    let first = NormalizedLifecycleEventV1::timer(digest(2), digest(3), 10, 10, 4).unwrap();
    let repeated = NormalizedLifecycleEventV1::timer(digest(2), digest(3), 10, 10, 4).unwrap();
    let different = NormalizedLifecycleEventV1::timer(digest(2), digest(4), 10, 10, 4).unwrap();
    assert_eq!(first, repeated);
    assert_ne!(
        first.envelope().order_key.event_identity,
        different.envelope().order_key.event_identity
    );
}

#[rstest]
fn target_deltas_and_fill_terminals_preserve_integer_position_semantics() {
    let probe = Rc::new(RefCell::new(HostProbe::default()));
    let decisions = [
        Decision::Position(PositionIntentV1::Enter, 10),
        Decision::Position(PositionIntentV1::Add, 15),
        Decision::Position(PositionIntentV1::Reduce, 8),
        Decision::Position(PositionIntentV1::Add, 17),
        Decision::Position(PositionIntentV1::Exit, 0),
    ];
    let mut adapter = adapter(probe, decisions);
    adapter
        .consume(NormalizedLifecycleEventV1::start(digest(2), 1, 1, 1, source(20)).unwrap())
        .unwrap();

    let enter = next_order(&mut adapter, 2);
    assert_eq!(
        (
            enter.delta_units(),
            enter.requested_units(),
            enter.reduce_only()
        ),
        (10, 10, false)
    );
    fill(&mut adapter, enter, 2, FillDispositionV1::Filled, 10);

    let add = next_order(&mut adapter, 4);
    assert_eq!(
        (add.delta_units(), add.requested_units(), add.reduce_only()),
        (5, 5, false)
    );
    fill(&mut adapter, add, 4, FillDispositionV1::Filled, 5);

    let reduce = next_order(&mut adapter, 6);
    assert_eq!(
        (
            reduce.delta_units(),
            reduce.requested_units(),
            reduce.reduce_only()
        ),
        (-7, 7, true)
    );
    fill(
        &mut adapter,
        reduce,
        6,
        FillDispositionV1::PartiallyFilled,
        3,
    );
    assert_eq!(
        adapter
            .seal_fill_observation(
                reduce.association().order_identity(),
                FillDispositionV1::Rejected,
                3,
                8,
                8,
                8,
                source(58),
            )
            .unwrap_err(),
        AdapterFaultV1::InvalidFillObservation
    );
    fill(&mut adapter, reduce, 7, FillDispositionV1::Canceled, 3);

    let rejected_add = next_order(&mut adapter, 9);
    assert_eq!(rejected_add.delta_units(), 5);
    fill(
        &mut adapter,
        rejected_add,
        9,
        FillDispositionV1::Rejected,
        0,
    );

    let exit = next_order(&mut adapter, 11);
    assert_eq!(
        (
            exit.delta_units(),
            exit.requested_units(),
            exit.reduce_only()
        ),
        (-12, 12, true)
    );
    fill(&mut adapter, exit, 11, FillDispositionV1::Filled, 12);
}

#[rstest]
fn malformed_terminal_fill_can_be_corrected_and_resealed() {
    let probe = Rc::new(RefCell::new(HostProbe::default()));
    let mut adapter = adapter(probe, [Decision::Position(PositionIntentV1::Enter, 5)]);
    adapter
        .consume(NormalizedLifecycleEventV1::start(digest(2), 1, 1, 1, source(20)).unwrap())
        .unwrap();
    let order = next_order(&mut adapter, 2);

    assert_eq!(
        adapter
            .seal_fill_observation(
                order.association().order_identity(),
                FillDispositionV1::Filled,
                5,
                3,
                3,
                0,
                source(40),
            )
            .unwrap_err(),
        AdapterFaultV1::MalformedEvent
    );
    let corrected = adapter
        .seal_fill_observation(
            order.association().order_identity(),
            FillDispositionV1::Filled,
            5,
            3,
            3,
            3,
            source(40),
        )
        .unwrap();
    adapter
        .consume(adapter.fill_event(&corrected).unwrap())
        .unwrap();
}

fn canonical_source(events: Vec<NormalizedLifecycleEventV1>) -> StrategyReplaySourceV1 {
    StrategyReplaySourceV1::canonicalize(events).unwrap()
}

fn replay_with_unreconciled_order(
    events: Vec<NormalizedLifecycleEventV1>,
) -> StrategyReplayAdapterV1<FakeHost> {
    let source = StrategyReplaySourceV1::canonicalize(events).unwrap();
    let probe = Rc::new(RefCell::new(HostProbe::default()));
    let mut adapter = adapter(
        probe,
        [
            Decision::Position(PositionIntentV1::Enter, 5),
            Decision::Hold,
        ],
    );
    adapter.consume_source(&source).unwrap();
    adapter
}

#[rstest]
fn source_is_byte_identical_under_permutation_but_result_sealing_is_unavailable() {
    let start = NormalizedLifecycleEventV1::start(digest(2), 1, 1, 1, source(20)).unwrap();
    let bar = NormalizedLifecycleEventV1::bar(digest(2), 2, 2, 2, source(30)).unwrap();
    let timer = NormalizedLifecycleEventV1::timer(digest(2), digest(40), 3, 3, 3).unwrap();
    let stop = NormalizedLifecycleEventV1::stop(digest(2), 4, 4, 4, source(50)).unwrap();
    let first = canonical_source(vec![
        start.clone(),
        bar.clone(),
        timer.clone(),
        stop.clone(),
    ]);
    let second = canonical_source(vec![
        stop.clone(),
        timer.clone(),
        start.clone(),
        bar.clone(),
    ]);
    assert_eq!(first, second);

    let adapter = replay_with_unreconciled_order(vec![start, bar, timer, stop]);
    assert_eq!(
        adapter.finish(&inner_result()).unwrap_err(),
        StrategyReplayResultFaultV1::EngineConsistencyUnavailable
    );

    assert!(CanonicalStrategyReplayResultV1::from_slice(&[0; 512]).is_err());
}

#[rstest]
fn fake_host_failure_leaves_zero_adapter_order_output() {
    let probe = Rc::new(RefCell::new(HostProbe::default()));
    let mut host = FakeHost::new(
        Rc::clone(&probe),
        [Decision::Position(PositionIntentV1::Enter, 5)],
    );
    host.fail_next = true;
    let mut adapter =
        StrategyReplayAdapterV1::new(digest(1), digest(2), digest(3), digest(4), host).unwrap();
    let bar = NormalizedLifecycleEventV1::bar(digest(2), 2, 2, 2, source(30)).unwrap();
    assert!(matches!(
        adapter.consume(bar.clone()),
        Err(AdapterFaultV1::Host(_))
    ));
    let order = adapter.consume(bar).unwrap().unwrap();
    assert_eq!(order.delta_units(), 5);
    assert_eq!(probe.borrow().calls.len(), 2);
}
