use std::sync::{
    Arc, Barrier,
    atomic::{AtomicUsize, Ordering},
};

use rstest::rstest;
use vibe_data::owner::{
    source_binding::BindingDigest,
    strategy_input_binding::{
        MarketDataFieldSemantic, StrategyInputChannel, StrategyInputUnit,
        UntrustedStrategyInputBindingRequest, UntrustedStrategyInputScope,
    },
};

use super::{
    develop_composer_operation_v2::{
        DevelopComposerA0BuildPortV2, DevelopComposerDurableEvidenceLocatorV2,
        DevelopComposerFinalEvidencePortV2, DevelopComposerLockedEvidenceV2,
        DevelopComposerOperationDispositionV2, DevelopComposerRunRequestV2,
        LocalDevelopComposerOperationV2, positive_write_boundary_count, request_digest,
    },
    develop_composer_postgres_v2::resolve_loaded_record_with_evidence,
    develop_composer_v2::{
        CurrentResearchDevelopCustodyV2, DevelopComposerTerminalKindV2, DevelopComposerTerminalV2,
    },
    develop_plugin_build_v2::{
        DevelopPluginBuildReceiptV2, UntrustedDevelopPluginCapsuleV2,
        UntrustedDevelopPluginSourceFileV2, VerifiedDevelopPluginBuildReadV2, bounded_source,
        mutated_build_receipt_bytes_for_test, portable_sealed_composer_test_evidence,
    },
    program_host_v2_tests::executable_design,
    strategy_design_v2::{InputRoleV2, PluginManifestV2, TypedConstantV2},
    strategy_design_v2_tests::bindings,
    strategy_plan_v2::{
        StrategyDesignPreparationV2, VerifiedStrategyInputBindingsV2, prepare_strategy_design_v2,
        strategy_input_role_identity_v2, verified_strategy_input_bindings_for_test,
    },
};

#[cfg(feature = "sealed-develop-composer-acceptance")]
use super::develop_composer_operation_v2::SealedDevelopComposerAcceptanceEvidenceV2;

struct CountingSealedA0 {
    calls: Arc<AtomicUsize>,
    capsule: UntrustedDevelopPluginCapsuleV2,
}

impl DevelopComposerA0BuildPortV2 for CountingSealedA0 {
    fn build(
        &mut self,
        manifest: &PluginManifestV2,
        capsule: &UntrustedDevelopPluginCapsuleV2,
    ) -> Result<VerifiedDevelopPluginBuildReadV2, DevelopComposerTerminalV2> {
        self.calls.fetch_add(1, Ordering::SeqCst);

        if capsule != &self.capsule || &capsule.manifest != manifest {
            return Err(DevelopComposerTerminalV2 {
                kind: DevelopComposerTerminalKindV2::Unavailable,
                coordinate: "sealed_a0.capsule".to_owned(),
                reason: "fixed acceptance capsule mismatch".to_owned(),
            });
        }
        Ok(portable_sealed_composer_test_evidence())
    }
}

#[derive(Clone)]
struct SealedFinalEvidence {
    research: CurrentResearchDevelopCustodyV2,
    final_research: Option<CurrentResearchDevelopCustodyV2>,
    bindings: VerifiedStrategyInputBindingsV2,
    final_bindings: Option<VerifiedStrategyInputBindingsV2>,
    expected_request_identity: String,
    expected_request_digest: BindingDigest,
    expected_design_identity: BindingDigest,
    expected_binding_requests: Vec<UntrustedStrategyInputBindingRequest>,
    reads: Arc<AtomicUsize>,
}

impl DevelopComposerFinalEvidencePortV2 for SealedFinalEvidence {
    fn lock_and_reread(
        &self,
        request: &DevelopComposerRunRequestV2,
        design_identity: BindingDigest,
        _read_cut_epoch_ms: u64,
    ) -> Result<DevelopComposerLockedEvidenceV2, DevelopComposerTerminalV2> {
        let read_index = self.reads.fetch_add(1, Ordering::SeqCst);
        let research = if read_index > 0 {
            self.final_research.as_ref().unwrap_or(&self.research)
        } else {
            &self.research
        };

        if request.research_custody_reference != research.request_locator()
            || request.binding_requests != self.expected_binding_requests
            || request
                .binding_requests
                .iter()
                .any(|binding| binding.strategy_design_identity != design_identity)
        {
            return Err(DevelopComposerTerminalV2 {
                kind: DevelopComposerTerminalKindV2::Unavailable,
                coordinate: "sealed_final_evidence".to_owned(),
                reason: "fixed acceptance evidence mismatch".to_owned(),
            });
        }
        let bindings = if read_index > 1 {
            self.final_bindings.as_ref().unwrap_or(&self.bindings)
        } else {
            &self.bindings
        };
        Ok(DevelopComposerLockedEvidenceV2 {
            research: research.clone(),
            bindings: bindings.clone(),
        })
    }

    fn lock_and_reread_durable(
        &self,
        locator: &DevelopComposerDurableEvidenceLocatorV2,
        _read_cut_epoch_ms: u64,
    ) -> Result<DevelopComposerLockedEvidenceV2, DevelopComposerTerminalV2> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        let research = self.final_research.as_ref().unwrap_or(&self.research);

        if locator.request_identity != self.expected_request_identity
            || locator.request_digest != self.expected_request_digest
            || locator.design_identity != self.expected_design_identity
            || locator.research_request_identity != research.research_request_identity()
            || locator.intent_identity != research.intent_identity()
        {
            return Err(DevelopComposerTerminalV2 {
                kind: DevelopComposerTerminalKindV2::Unavailable,
                coordinate: "sealed_durable_evidence".to_owned(),
                reason: "stored locator does not match current evidence".to_owned(),
            });
        }
        Ok(DevelopComposerLockedEvidenceV2 {
            research: research.clone(),
            bindings: self
                .final_bindings
                .as_ref()
                .unwrap_or(&self.bindings)
                .clone(),
        })
    }
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
#[rstest]
fn sealed_acceptance_durable_reread_rejects_changed_request_identity() {
    let (request, _, evidence, _, _) = fixture();
    let request = Box::leak(Box::new(request));
    let adapter = SealedDevelopComposerAcceptanceEvidenceV2::from_fixed_corpus(
        request,
        evidence.research,
        evidence.bindings,
    )
    .expect("fixed sealed acceptance evidence");
    let design_identity = match prepare_strategy_design_v2(&request.design) {
        StrategyDesignPreparationV2::Prepared {
            design_identity, ..
        } => design_identity,
        other => panic!("fixture Design did not prepare: {other:?}"),
    };
    let mut locator = DevelopComposerDurableEvidenceLocatorV2 {
        request_identity: request.request_identity.clone(),
        request_digest: request_digest(request),
        research_request_identity: request.design.research_request_identity,
        intent_identity: request.design.intent_identity,
        design_identity,
    };
    assert!(adapter.lock_and_reread_durable(&locator, 10).is_ok());

    locator.request_identity.push_str("-changed");
    assert!(adapter.lock_and_reread_durable(&locator, 11).is_err());
}

#[rstest]
fn build_receipt_roundtrips_and_every_critical_field_mutation_fails_closed() {
    let (request, mut builder, _, _, _) = fixture();
    let manifest = &request.design.plugins[0];
    let receipt = builder
        .build(manifest, &request.plugin_source_capsules[0])
        .expect("sealed A0 receipt");
    let bytes = receipt.canonical_receipt_bytes();
    let expected_receipt_digest = receipt.receipt().receipt_digest();
    let expected_module_digest = receipt.receipt().module_digest();
    assert_eq!(
        DevelopPluginBuildReceiptV2::parse_canonical(&bytes)
            .expect("canonical roundtrip")
            .canonical_bytes(),
        bytes
    );

    for mutation in mutated_build_receipt_bytes_for_test(&bytes) {
        let remains_valid =
            DevelopPluginBuildReceiptV2::parse_canonical(&mutation).is_some_and(|candidate| {
                candidate.validates_for_restart(
                    manifest,
                    expected_receipt_digest,
                    expected_module_digest,
                )
            });
        assert!(
            !remains_valid,
            "each critical mutation must fail restart validation"
        );
    }
}

#[rstest]
fn run_builds_once_joins_same_meaning_and_conflicts_on_changed_meaning() {
    let (request, builder, evidence, calls, reads) = fixture();
    let operation = LocalDevelopComposerOperationV2::new(builder, evidence);
    let first = operation.run(&request, 10);
    let joined = operation.run(&request, 11);
    assert_eq!(
        first.disposition,
        DevelopComposerOperationDispositionV2::Success
    );
    assert_eq!(first.canonical_bytes(), joined.canonical_bytes());
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(reads.load(Ordering::SeqCst), 3);

    let mut changed = request;
    changed.design.falsifier.push_str(" changed meaning");
    let conflict = operation.run(&changed, 12);
    assert_eq!(
        conflict.disposition,
        DevelopComposerOperationDispositionV2::Conflict
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[rstest]
fn concurrent_distinct_requests_sharing_semantic_identity_conflict_before_second_a0() {
    let (first, builder, evidence, calls, reads) = fixture();
    let mut second = first.clone();
    second.request_identity = "composer-request-2".to_owned();
    let operation = Arc::new(LocalDevelopComposerOperationV2::new(builder, evidence));
    let barrier = Arc::new(Barrier::new(2));
    let responses = std::thread::scope(|scope| {
        let first_operation = Arc::clone(&operation);
        let first_barrier = Arc::clone(&barrier);
        let first = scope.spawn(move || {
            first_barrier.wait();
            first_operation.run(&first, 10)
        });
        let second_operation = Arc::clone(&operation);
        let second_barrier = Arc::clone(&barrier);
        let second = scope.spawn(move || {
            second_barrier.wait();
            second_operation.run(&second, 10)
        });
        [
            first.join().expect("first operation thread"),
            second.join().expect("second operation thread"),
        ]
    });
    let mut dispositions = responses.map(|response| response.disposition);
    dispositions.sort_by_key(|disposition| match disposition {
        DevelopComposerOperationDispositionV2::Success => 0,
        DevelopComposerOperationDispositionV2::Conflict => 1,
        _ => 2,
    });
    assert_eq!(
        dispositions,
        [
            DevelopComposerOperationDispositionV2::Success,
            DevelopComposerOperationDispositionV2::Conflict,
        ]
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(reads.load(Ordering::SeqCst), 3);
}

#[rstest]
fn final_evidence_drift_after_a0_fails_without_positive_rows() {
    let (request, builder, mut evidence, calls, reads) = fixture();
    evidence.final_research = Some(CurrentResearchDevelopCustodyV2::fixture(
        "research-request-1",
        "price relation must stop producing the declared position transition",
        18,
    ));
    let operation = LocalDevelopComposerOperationV2::new(builder, evidence);
    assert_eq!(
        operation.run(&request, 10).disposition,
        DevelopComposerOperationDispositionV2::Unavailable
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(reads.load(Ordering::SeqCst), 2);
    assert_eq!(operation.positive_row_count_for_test(), 0);
}

#[rstest]
fn every_transaction_write_boundary_fault_leaves_zero_positive_rows() {
    let (request, builder, evidence, _, _) = fixture();
    let operation = LocalDevelopComposerOperationV2::new(builder, evidence);
    assert_eq!(
        operation.run(&request, 10).disposition,
        DevelopComposerOperationDispositionV2::Success
    );
    let boundary_count = positive_write_boundary_count(&operation.record_for_test());

    for boundary in 1..=boundary_count {
        let (request, builder, evidence, _, _) = fixture();
        let operation = LocalDevelopComposerOperationV2::new(builder, evidence);
        operation.set_fault_boundary_for_test(Some(boundary));
        let response = operation.run(&request, 10);
        assert_eq!(
            response.disposition,
            DevelopComposerOperationDispositionV2::Unavailable
        );
        assert_eq!(operation.positive_row_count_for_test(), 0);
    }
}

#[rstest]
fn response_loss_restart_resolve_revalidates_private_bytes_and_readmits_host() {
    let (request, builder, evidence, calls, _) = fixture();
    let mut restart_evidence = evidence.clone();
    let operation = LocalDevelopComposerOperationV2::new(builder, evidence);
    let committed = operation.run(&request, 10);
    let resolved = operation.resolve(&request.request_identity, 12);
    assert_eq!(committed.canonical_bytes(), resolved.canonical_bytes());
    assert_eq!(calls.load(Ordering::SeqCst), 1);

    let restart_record = operation.record_for_test();
    let restarted = resolve_loaded_record_with_evidence(&restart_record, &restart_evidence, 12);
    assert_eq!(committed.canonical_bytes(), restarted.canonical_bytes());
    assert_eq!(calls.load(Ordering::SeqCst), 1, "RESOLVE never invokes A0");

    restart_evidence.final_research = Some(CurrentResearchDevelopCustodyV2::fixture(
        "research-request-1",
        "price relation must stop producing the declared position transition",
        18,
    ));
    assert_eq!(
        resolve_loaded_record_with_evidence(&restart_record, &restart_evidence, 13).disposition,
        DevelopComposerOperationDispositionV2::Unavailable
    );

    let public = committed.canonical_bytes();
    assert!(!contains(&public, &restart_record.module_bytes[0]));
    assert!(!contains(&public, &restart_record.build_receipt_bytes[0]));
}

#[rstest]
fn current_binding_drift_blocks_existing_run_replay_and_resolve() {
    let (request, builder, mut evidence, calls, _) = fixture();
    let mut changed = bindings(&request.design);
    changed[0].1 = digest(0xee);
    evidence.final_bindings = Some(verified_strategy_input_bindings_for_test(
        &request.design,
        changed,
    ));
    let restart_evidence = evidence.clone();
    let operation = LocalDevelopComposerOperationV2::new(builder, evidence);
    assert_eq!(
        operation.run(&request, 10).disposition,
        DevelopComposerOperationDispositionV2::Success
    );
    assert_eq!(
        operation.run(&request, 11).disposition,
        DevelopComposerOperationDispositionV2::Unavailable
    );
    assert_eq!(
        operation.resolve(&request.request_identity, 12).disposition,
        DevelopComposerOperationDispositionV2::Unavailable
    );
    assert_eq!(
        resolve_loaded_record_with_evidence(&operation.record_for_test(), &restart_evidence, 12,)
            .disposition,
        DevelopComposerOperationDispositionV2::Unavailable
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[rstest]
fn every_private_canonical_member_mutation_fails_resolve_without_successor() {
    type Mutation = fn(&mut super::develop_composer_operation_v2::StoredDevelopComposerPositiveV2);
    let mutations: [Mutation; 14] = [
        |record| record.research_request_identity = digest(0xdf),
        |record| record.intent_identity = digest(0xe0),
        |record| record.design_identity = digest(0xe1),
        |record| record.plan_digest = digest(0xe2),
        |record| record.design_bytes[0] ^= 1,
        |record| record.plan_bytes[0] ^= 1,
        |record| record.artifact_package_bytes[0] ^= 1,
        |record| record.module_bytes[0][0] ^= 1,
        |record| record.build_receipt_bytes[0][0] ^= 1,
        |record| record.composer_receipt_bytes[0] ^= 1,
        |record| record.host_receipt_bytes[0] ^= 1,
        |record| record.operation_receipt_bytes[0] ^= 1,
        |record| record.outbox_bytes[0] ^= 1,
        |record| record.response_bytes[0] ^= 1,
    ];

    for mutation in mutations {
        let (request, builder, evidence, calls, _) = fixture();
        let operation = LocalDevelopComposerOperationV2::new(builder, evidence);
        assert_eq!(
            operation.run(&request, 10).disposition,
            DevelopComposerOperationDispositionV2::Success
        );
        operation.mutate_record_for_test(mutation);
        assert_eq!(
            operation.resolve(&request.request_identity, 12).disposition,
            DevelopComposerOperationDispositionV2::Unavailable
        );
        assert_eq!(operation.positive_row_count_for_test(), 1);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
}

fn fixture() -> (
    DevelopComposerRunRequestV2,
    CountingSealedA0,
    SealedFinalEvidence,
    Arc<AtomicUsize>,
    Arc<AtomicUsize>,
) {
    let research = CurrentResearchDevelopCustodyV2::fixture(
        "research-request-1",
        "price relation must stop producing the declared position transition",
        17,
    );
    let mut design = executable_design();
    design.research_request_identity = research.research_request_identity();
    design.intent_identity = research.intent_identity();
    design.intent_digest = research.intent_digest();
    design.falsifier = research.falsifier().to_owned();
    design.state[0].initial = TypedConstantV2::Bytes { value: vec![0] };
    design.plugins[0].max_fuel = 10_000_000;
    let design_identity = match prepare_strategy_design_v2(&design) {
        StrategyDesignPreparationV2::Prepared {
            design_identity, ..
        } => design_identity,
        other => panic!("fixture Design did not prepare: {other:?}"),
    };
    let owner_bindings = bindings(&design);
    let verified_bindings = verified_strategy_input_bindings_for_test(&design, owner_bindings);
    let binding_requests = design
        .inputs
        .iter()
        .enumerate()
        .map(|(index, input)| {
            binding_request(
                input,
                design.research_request_identity,
                design_identity,
                index as u8,
            )
        })
        .collect::<Vec<_>>();
    let manifest = design.plugins[0].clone();
    let capsule = UntrustedDevelopPluginCapsuleV2 {
        schema_version: 2,
        manifest,
        language: "rust.no_std.fixed-abi-source.v2".to_owned(),
        rustc_release: "1.97.1".to_owned(),
        rustc_commit: "8bab26f4f68e0e26f0bb7960be334d5b520ea452".to_owned(),
        target: "wasm32v1-none".to_owned(),
        build_command: [
            "cargo",
            "build",
            "--offline",
            "--locked",
            "--release",
            "--target",
            "wasm32v1-none",
            "--manifest-path=Cargo.toml",
        ]
        .map(str::to_owned)
        .to_vec(),
        files: vec![UntrustedDevelopPluginSourceFileV2 {
            path: "src/lib.rs".to_owned(),
            bytes: bounded_source(&design.plugins[0]).into_bytes(),
            symlink_target: None,
        }],
    };
    let request = DevelopComposerRunRequestV2 {
        request_identity: "composer-request-1".to_owned(),
        research_custody_reference: research.request_locator().to_owned(),
        design,
        binding_requests: binding_requests.clone(),
        plugin_source_capsules: vec![capsule.clone()],
    };
    let calls = Arc::new(AtomicUsize::new(0));
    let reads = Arc::new(AtomicUsize::new(0));
    let expected_request_identity = request.request_identity.clone();
    let expected_request_digest = request_digest(&request);
    (
        request,
        CountingSealedA0 {
            calls: Arc::clone(&calls),
            capsule,
        },
        SealedFinalEvidence {
            research,
            final_research: None,
            bindings: verified_bindings,
            final_bindings: None,
            expected_request_identity,
            expected_request_digest,
            expected_design_identity: design_identity,
            expected_binding_requests: binding_requests,
            reads: Arc::clone(&reads),
        },
        calls,
        reads,
    )
}

fn binding_request(
    input: &InputRoleV2,
    research_request_identity: BindingDigest,
    strategy_design_identity: BindingDigest,
    seed: u8,
) -> UntrustedStrategyInputBindingRequest {
    UntrustedStrategyInputBindingRequest {
        research_request_identity,
        strategy_design_identity,
        input_role_identity: strategy_input_role_identity_v2(input),
        scope: UntrustedStrategyInputScope::ExactInstrument {
            instrument: input.instrument.clone(),
        },
        field_semantic: match input.field_semantic_id.as_str() {
            "MARKET_DATA.BAR.OPEN.PRICE.V1" => MarketDataFieldSemantic::BarOpenPrice,
            _ => MarketDataFieldSemantic::BarClosePrice,
        },
        channel: StrategyInputChannel::Market,
        timeframe: input.timeframe.clone(),
        unit: StrategyInputUnit::Price,
        scale: input.scale,
        pit_request_identity: digest(seed + 1),
        pit_request_digest: digest(seed + 2),
        snapshot_identity: digest(seed + 3),
        snapshot_fact_digest: digest(seed + 4),
        observation_batch_digest: digest(seed + 5),
        source_binding_identity: digest(seed + 6),
        source_frontier_digest: digest(seed + 7),
        correction_frontier_digest: digest(seed + 8),
        instrument_master_digest: digest(seed + 9),
        universe_selection_digest: digest(seed + 10),
        market_semantics_identity: BindingDigest::from_untrusted_bytes([9; 32]),
        decision_cut: 10,
    }
}

fn digest(seed: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([seed; 32])
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty()
        && haystack
            .windows(needle.len())
            .any(|window| window == needle)
}
