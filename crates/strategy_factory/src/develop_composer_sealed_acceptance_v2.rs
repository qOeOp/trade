//! Compile-time sealed Durable Composer A1 composition.
//!
//! Default builds expose only the typed unavailable response. The non-default acceptance feature
//! owns one fixed AAPL/MSFT Market Data frame, Research custody, Design, and plugin source capsule.
//! No runtime value selects or replaces any member of that corpus.

#[cfg(feature = "sealed-develop-composer-acceptance")]
use vibe_data::owner::source_binding::BindingDigest;

use crate::develop_composer_operation_v2::{
    DevelopComposerOperationDispositionV2, DevelopComposerOperationResponseV2,
};

pub const SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2: &str = "sealed-develop-composer-request-v2";

pub fn default_unavailable_response(request_identity: &str) -> DevelopComposerOperationResponseV2 {
    DevelopComposerOperationResponseV2 {
        schema_version: 2,
        request_identity: request_identity.to_owned(),
        disposition: DevelopComposerOperationDispositionV2::Unavailable,
        receipt_identity: None,
        artifact: None,
        coordinate: Some("composer.acceptance".to_owned()),
        reason: Some(
            "Durable Composer is unavailable outside the compile-time sealed acceptance build"
                .to_owned(),
        ),
    }
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
mod sealed {
    use crate::{
        develop_composer_operation_v2::{
            DevelopComposerA0BuildPortV2, DevelopComposerFinalEvidencePortV2,
            DevelopComposerRunRequestV2, SealedDevelopComposerAcceptanceEvidenceV2,
        },
        develop_composer_postgres_v2::{
            DevelopComposerSealedReadErrorV2, DevelopComposerSealedReadLocatorV2,
            PostgresDevelopComposerStoreV2, SealedDevelopComposerReadbackV2,
            read_accepted_in_transaction,
        },
        develop_composer_v2::{CurrentResearchDevelopCustodyV2, DevelopComposerTerminalV2},
        develop_plugin_build_v2::{
            DevelopPluginBuildTerminalKindV2, UntrustedDevelopPluginCapsuleV2,
            UntrustedDevelopPluginSourceFileV2, VerifiedDevelopPluginBuildReadV2, bounded_source,
            sealed_corpus_verified_build_v2,
        },
        develop_plugin_build_v2_sandbox::{BUILD_COMMAND, RUSTC_COMMIT, RUSTC_RELEASE, TARGET},
        strategy_design_v2::*,
        strategy_plan_v2::{
            StrategyDesignPreparationV2, VerifiedStrategyInputBindingsV2,
            prepare_strategy_design_v2, strategy_input_role_identity_v2,
        },
    };
    use strategy_factory_program_sdk::lifecycle_v2::TARGET_SET_BYTES;
    use vibe_data::owner::{
        sealed_acceptance::issue_strategy_input_universe_frame,
        strategy_input_binding::{
            MarketDataFieldSemantic, StrategyInputChannel, StrategyInputUnit,
            UntrustedStrategyInputBindingRequest, UntrustedStrategyInputScope,
        },
    };

    use super::{
        BindingDigest, DevelopComposerOperationResponseV2,
        SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2,
    };

    const PLUGIN_ID: &str = "research.plugin.stateful-trend.v1";
    const STATE_POST: &str = "plugin.state.post.v1";
    const RESEARCH_LOCATOR: &str = "sealed-develop-research-custody-v2";
    const OUTPUT_PORTS: &[(&str, ValueTypeV2)] = &[
        ("proposal.position-intent.v1", ValueTypeV2::PositionIntentV1),
        ("proposal.target-variant.v1", ValueTypeV2::TargetVariantV1),
        ("proposal.target-position.v1", ValueTypeV2::I64),
        ("proposal.target-weight.v1", ValueTypeV2::I32),
        ("proposal.rebalance-sequence.v1", ValueTypeV2::U64),
        ("proposal.reconciliation-target.v1", ValueTypeV2::I64),
        (
            "proposal.protection-variant.v1",
            ValueTypeV2::ProtectionVariantV1,
        ),
        ("proposal.stop-loss.v1", ValueTypeV2::I64),
        ("proposal.take-profit.v1", ValueTypeV2::I64),
        ("proposal.trailing-distance.v1", ValueTypeV2::U64),
        ("proposal.trailing-stop.v1", ValueTypeV2::I64),
        ("proposal.member-target-set.v2", ValueTypeV2::Bytes),
    ];

    pub struct SealedDevelopComposerAcceptanceV2 {
        store: PostgresDevelopComposerStoreV2,
        request: &'static DevelopComposerRunRequestV2,
        evidence: SealedDevelopComposerAcceptanceEvidenceV2,
    }

    struct SealedDevelopComposerA0BuildV2;

    impl DevelopComposerA0BuildPortV2 for SealedDevelopComposerA0BuildV2 {
        fn build(
            &mut self,
            manifest: &PluginManifestV2,
            capsule: &UntrustedDevelopPluginCapsuleV2,
        ) -> Result<VerifiedDevelopPluginBuildReadV2, DevelopComposerTerminalV2> {
            sealed_corpus_verified_build_v2(manifest, capsule).map_err(|terminal| {
                DevelopComposerTerminalV2 {
                    kind: if terminal.kind == DevelopPluginBuildTerminalKindV2::Conflict {
                        crate::develop_composer_v2::DevelopComposerTerminalKindV2::Conflict
                    } else {
                        crate::develop_composer_v2::DevelopComposerTerminalKindV2::Unavailable
                    },
                    coordinate: terminal.coordinate,
                    reason: terminal.reason,
                }
            })
        }
    }

    impl SealedDevelopComposerAcceptanceV2 {
        #[doc(hidden)]
        pub async fn connect(database_url: &str) -> anyhow::Result<Self> {
            let rd_owner_database_url = std::env::var("RD_OWNER_TEST_DATABASE_URL")?;
            Self::connect_with_writer(&rd_owner_database_url, database_url).await
        }

        pub async fn connect_with_writer(
            rd_owner_database_url: &str,
            rd_fact_writer_database_url: &str,
        ) -> anyhow::Result<Self> {
            let store = PostgresDevelopComposerStoreV2::connect(
                rd_owner_database_url,
                rd_fact_writer_database_url,
            )
            .await?;
            let (request, evidence) = fixed_corpus()?;
            Ok(Self {
                store,
                request,
                evidence,
            })
        }

        pub async fn run(&self) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
            let mut builder = SealedDevelopComposerA0BuildV2;
            self.store
                .run(&mut builder, &self.evidence, self.request, 1)
                .await
        }

        pub async fn resolve(
            &self,
            request_identity: &str,
        ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
            self.store
                .resolve_with_evidence(request_identity, &self.evidence, 1)
                .await
        }

        pub async fn read_accepted_in_transaction(
            &self,
            transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
            locator: &DevelopComposerSealedReadLocatorV2,
        ) -> Result<SealedDevelopComposerReadbackV2, DevelopComposerSealedReadErrorV2> {
            let design_identity = match prepare_strategy_design_v2(&self.request.design) {
                StrategyDesignPreparationV2::Prepared {
                    design_identity, ..
                } => design_identity,
                _ => return Err(DevelopComposerSealedReadErrorV2::Unavailable),
            };
            let locked_evidence = self
                .evidence
                .lock_and_reread(self.request, design_identity, 1)
                .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
            read_accepted_in_transaction(transaction, locator, locked_evidence).await
        }
    }

    fn fixed_corpus() -> anyhow::Result<(
        &'static DevelopComposerRunRequestV2,
        SealedDevelopComposerAcceptanceEvidenceV2,
    )> {
        let frame = issue_strategy_input_universe_frame()?;
        let design = fixed_design();
        let design_identity = match prepare_strategy_design_v2(&design) {
            StrategyDesignPreparationV2::Prepared {
                design_identity, ..
            } => design_identity,
            other => anyhow::bail!("sealed Design did not prepare: {other:?}"),
        };

        if frame.role_bindings().iter().any(|role| {
            role.research_request_identity() != design.research_request_identity
                || role.strategy_design_identity() != design_identity
        }) {
            anyhow::bail!("sealed Market Data frame does not bind the fixed Design");
        }
        let bindings = VerifiedStrategyInputBindingsV2::from_sealed_universe(&frame);
        let binding_requests = design
            .inputs
            .iter()
            .enumerate()
            .map(|(ordinal, input)| {
                fixed_binding_request(
                    input,
                    design.research_request_identity,
                    design_identity,
                    frame.selection().selection_identity(),
                    ordinal as u8,
                )
            })
            .collect();
        let manifest = design.plugins[0].clone();
        let capsule = UntrustedDevelopPluginCapsuleV2 {
            schema_version: 2,
            manifest: manifest.clone(),
            language: "rust.no_std.fixed-abi-source.v2".to_owned(),
            rustc_release: RUSTC_RELEASE.to_owned(),
            rustc_commit: RUSTC_COMMIT.to_owned(),
            target: TARGET.to_owned(),
            build_command: BUILD_COMMAND
                .iter()
                .map(|value| (*value).to_owned())
                .collect(),
            files: vec![UntrustedDevelopPluginSourceFileV2 {
                path: "src/lib.rs".to_owned(),
                bytes: bounded_source(&manifest).into_bytes(),
                symlink_target: None,
            }],
        };
        let request = Box::leak(Box::new(DevelopComposerRunRequestV2 {
            request_identity: SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2.to_owned(),
            research_custody_reference: RESEARCH_LOCATOR.to_owned(),
            design,
            binding_requests,
            plugin_source_capsules: vec![capsule],
        }));
        let research = CurrentResearchDevelopCustodyV2::sealed_acceptance(RESEARCH_LOCATOR)?;
        let evidence = SealedDevelopComposerAcceptanceEvidenceV2::from_fixed_corpus(
            request, research, bindings,
        )
        .map_err(terminal_error)?;
        Ok((request, evidence))
    }

    fn terminal_error(terminal: DevelopComposerTerminalV2) -> anyhow::Error {
        let DevelopComposerTerminalV2 {
            coordinate, reason, ..
        } = terminal;
        anyhow::anyhow!("{coordinate}: {reason}")
    }

    fn fixed_binding_request(
        input: &InputRoleV2,
        research_request_identity: BindingDigest,
        strategy_design_identity: BindingDigest,
        selection_identity: BindingDigest,
        seed: u8,
    ) -> UntrustedStrategyInputBindingRequest {
        UntrustedStrategyInputBindingRequest {
            research_request_identity,
            strategy_design_identity,
            input_role_identity: strategy_input_role_identity_v2(input),
            scope: UntrustedStrategyInputScope::UniverseSelection { selection_identity },
            field_semantic: match input.field_semantic_id.as_str() {
                "MARKET_DATA.BAR.OPEN.PRICE.V1" => MarketDataFieldSemantic::BarOpenPrice,
                _ => MarketDataFieldSemantic::BarClosePrice,
            },
            channel: StrategyInputChannel::Market,
            timeframe: input.timeframe.clone(),
            unit: StrategyInputUnit::Price,
            scale: input.scale,
            pit_request_identity: digest(seed + 11),
            pit_request_digest: digest(seed + 21),
            snapshot_identity: digest(seed + 31),
            snapshot_fact_digest: digest(seed + 41),
            observation_batch_digest: digest(seed + 51),
            source_binding_identity: digest(seed + 61),
            source_frontier_digest: digest(seed + 71),
            correction_frontier_digest: digest(seed + 81),
            instrument_master_digest: digest(seed + 91),
            universe_selection_digest: digest(seed + 101),
            market_semantics_identity: digest(111),
            decision_cut: 40,
        }
    }

    fn digest(seed: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([seed; 32])
    }

    fn output(node: &str, port: &str) -> ValueRefV2 {
        ValueRefV2::NodeOutput {
            node_id: node.to_owned(),
            port_id: port.to_owned(),
        }
    }

    fn context(field: LifecycleContextV2) -> ValueRefV2 {
        ValueRefV2::LifecycleContext { field }
    }

    fn proposal(node: &str) -> ProposalWiringV2 {
        ProposalWiringV2 {
            position_intent: output(node, "proposal.position-intent.v1"),
            target_variant: output(node, "proposal.target-variant.v1"),
            target_position_units: output(node, "proposal.target-position.v1"),
            target_weight_micros: output(node, "proposal.target-weight.v1"),
            rebalance_sequence: output(node, "proposal.rebalance-sequence.v1"),
            reconciliation_target_units: output(node, "proposal.reconciliation-target.v1"),
            protection_variant: output(node, "proposal.protection-variant.v1"),
            stop_loss_ticks: output(node, "proposal.stop-loss.v1"),
            take_profit_ticks: output(node, "proposal.take-profit.v1"),
            trailing_distance_ticks: output(node, "proposal.trailing-distance.v1"),
            trailing_stop_ticks: output(node, "proposal.trailing-stop.v1"),
            member_target_set: Some(output(node, "proposal.member-target-set.v2")),
        }
    }

    fn compute_node(node: &str, state: &str, event: bool) -> ComputeNodeV2 {
        let market_source = |input_id: &str, member_ordinal| ValueRefV2::UniverseMemberInput {
            input_id: input_id.to_owned(),
            member_ordinal,
        };
        let timer_source = || ValueRefV2::Parameter {
            parameter_id: "research.parameter.timer-close.v1".to_owned(),
        };
        let mut input_bindings = vec![
            PortBindingV2 {
                port_id: "input.close.v1".to_owned(),
                source: if event {
                    market_source("research.input.close.v1", 0)
                } else {
                    timer_source()
                },
            },
            PortBindingV2 {
                port_id: "input.open.v1".to_owned(),
                source: if event {
                    market_source("research.input.open.v1", 0)
                } else {
                    timer_source()
                },
            },
            PortBindingV2 {
                port_id: "input.member-b-close.v2".to_owned(),
                source: if event {
                    market_source("research.input.close.v1", 1)
                } else {
                    timer_source()
                },
            },
            PortBindingV2 {
                port_id: "input.member-b-open.v2".to_owned(),
                source: if event {
                    market_source("research.input.open.v1", 1)
                } else {
                    timer_source()
                },
            },
            PortBindingV2 {
                port_id: "input.current-position.v1".to_owned(),
                source: context(LifecycleContextV2::CurrentPositionUnits),
            },
            PortBindingV2 {
                port_id: "input.envelope-digest.v1".to_owned(),
                source: context(LifecycleContextV2::EnvelopeDigest),
            },
            PortBindingV2 {
                port_id: "input.intent.v1".to_owned(),
                source: context(LifecycleContextV2::IntentIdentity),
            },
            PortBindingV2 {
                port_id: "input.lookback.v1".to_owned(),
                source: ValueRefV2::Parameter {
                    parameter_id: "research.parameter.lookback.v1".to_owned(),
                },
            },
            PortBindingV2 {
                port_id: "input.rebalance-sequence.v1".to_owned(),
                source: context(LifecycleContextV2::RebalanceSequence),
            },
        ];
        input_bindings.sort();
        let mut output_port_ids = OUTPUT_PORTS
            .iter()
            .map(|(port, _)| (*port).to_owned())
            .collect::<Vec<_>>();
        output_port_ids.sort();
        ComputeNodeV2 {
            semantic_id: node.to_owned(),
            plugin_semantic_id: PLUGIN_ID.to_owned(),
            input_bindings,
            pre_state: ValueRefV2::PriorState {
                state_id: state.to_owned(),
            },
            output_port_ids,
            post_state_port_id: STATE_POST.to_owned(),
        }
    }

    fn reaction(kind: LifecycleKindV2, node: &str, state: &str, event: bool) -> ReactionGraphV2 {
        ReactionGraphV2 {
            kind,
            nodes: vec![compute_node(node, state, event)],
            state_writes: vec![StateWriteV2 {
                state_id: state.to_owned(),
                source: output(node, STATE_POST),
            }],
            proposal: Some(proposal(node)),
        }
    }

    fn fixed_design() -> StrategyDesignV2 {
        let capabilities = [
            "research.trend.warmup.v1",
            "research.trend.enter.v1",
            "research.trend.add.v1",
            "research.trend.reduce.v1",
            "research.trend.trailing.v1",
            "research.trend.timer-exit.v1",
        ];
        let mut input_ports = vec![
            ("input.close.v1", ValueTypeV2::I128, 16),
            ("input.open.v1", ValueTypeV2::I128, 16),
            ("input.member-b-close.v2", ValueTypeV2::I128, 16),
            ("input.member-b-open.v2", ValueTypeV2::I128, 16),
            ("input.current-position.v1", ValueTypeV2::I64, 8),
            ("input.envelope-digest.v1", ValueTypeV2::Digest32, 32),
            ("input.intent.v1", ValueTypeV2::StableIdentity16, 16),
            ("input.lookback.v1", ValueTypeV2::I64, 8),
            ("input.rebalance-sequence.v1", ValueTypeV2::U64, 8),
        ]
        .into_iter()
        .map(|(semantic_id, value_type, max_bytes)| PortContractV2 {
            semantic_id: semantic_id.to_owned(),
            value_type,
            max_bytes,
        })
        .collect::<Vec<_>>();
        input_ports.sort();
        let mut output_ports = OUTPUT_PORTS
            .iter()
            .map(|(semantic_id, value_type)| PortContractV2 {
                semantic_id: (*semantic_id).to_owned(),
                value_type: *value_type,
                max_bytes: match *semantic_id {
                    "proposal.member-target-set.v2" => TARGET_SET_BYTES as u32,
                    _ if matches!(
                        value_type,
                        ValueTypeV2::PositionIntentV1
                            | ValueTypeV2::TargetVariantV1
                            | ValueTypeV2::ProtectionVariantV1
                    ) =>
                    {
                        64
                    }
                    _ if matches!(value_type, ValueTypeV2::I32) => 4,
                    _ => 8,
                },
            })
            .collect::<Vec<_>>();
        output_ports.sort();
        StrategyDesignV2 {
            schema_version: STRATEGY_DESIGN_SCHEMA_V2,
            research_request_identity: digest(1),
            intent_identity: digest(2),
            intent_digest: digest(3),
            inputs: vec![
                InputRoleV2 {
                    semantic_id: "research.input.close.v1".to_owned(),
                    fact_class: InputFactClassV2::MarketData,
                    instrument: String::new(),
                    scope: InputScopeV2::UniverseMembers,
                    field_semantic_id: "MARKET_DATA.BAR.CLOSE.PRICE.V1".to_owned(),
                    channel: "MARKET".to_owned(),
                    timeframe: "1D".to_owned(),
                    unit: "PRICE".to_owned(),
                    scale: 2,
                    value_type: ValueTypeV2::I128,
                },
                InputRoleV2 {
                    semantic_id: "research.input.open.v1".to_owned(),
                    fact_class: InputFactClassV2::MarketData,
                    instrument: String::new(),
                    scope: InputScopeV2::UniverseMembers,
                    field_semantic_id: "MARKET_DATA.BAR.OPEN.PRICE.V1".to_owned(),
                    channel: "MARKET".to_owned(),
                    timeframe: "1D".to_owned(),
                    unit: "PRICE".to_owned(),
                    scale: 2,
                    value_type: ValueTypeV2::I128,
                },
            ],
            joins: vec![],
            parameters: vec![
                ParameterV2 {
                    semantic_id: "research.parameter.lookback.v1".to_owned(),
                    value_type: ValueTypeV2::I64,
                    value: TypedConstantV2::I64 { value: 20 },
                    unit: "BAR_COUNT".to_owned(),
                },
                ParameterV2 {
                    semantic_id: "research.parameter.timer-close.v1".to_owned(),
                    value_type: ValueTypeV2::I128,
                    value: TypedConstantV2::I128 { value: 0 },
                    unit: "PRICE".to_owned(),
                },
            ],
            state: vec![StateCellV2 {
                semantic_id: "research.state.trend.v1".to_owned(),
                value_type: ValueTypeV2::Bytes,
                initial: TypedConstantV2::Bytes { value: vec![] },
                max_bytes: 256,
            }],
            reactions: vec![
                ReactionGraphV2 {
                    kind: LifecycleKindV2::Start,
                    nodes: vec![],
                    state_writes: vec![],
                    proposal: None,
                },
                reaction(
                    LifecycleKindV2::Bar,
                    "research.node.bar.v1",
                    "research.state.trend.v1",
                    true,
                ),
                reaction(
                    LifecycleKindV2::Event,
                    "research.node.event.v1",
                    "research.state.trend.v1",
                    true,
                ),
                ReactionGraphV2 {
                    kind: LifecycleKindV2::Fill,
                    nodes: vec![],
                    state_writes: vec![],
                    proposal: None,
                },
                reaction(
                    LifecycleKindV2::Timer,
                    "research.node.timer.v1",
                    "research.state.trend.v1",
                    false,
                ),
                ReactionGraphV2 {
                    kind: LifecycleKindV2::Stop,
                    nodes: vec![],
                    state_writes: vec![],
                    proposal: None,
                },
            ],
            capabilities: capabilities
                .iter()
                .map(|semantic_id| CapabilityDeclarationV2 {
                    semantic_id: (*semantic_id).to_owned(),
                    version: 1,
                    dependencies: vec![],
                })
                .collect(),
            plugins: vec![PluginManifestV2 {
                semantic_id: PLUGIN_ID.to_owned(),
                abi_version: 2,
                input_ports,
                output_ports,
                state: PluginStateContractV2 {
                    pre_port_id: "plugin.state.pre.v1".to_owned(),
                    post_port_id: STATE_POST.to_owned(),
                    value_type: ValueTypeV2::Bytes,
                    max_bytes: 256,
                },
                capability_ids: capabilities
                    .iter()
                    .map(|value| (*value).to_owned())
                    .collect(),
                max_fuel: 100_000,
                max_linear_memory_bytes: 1_048_576,
                max_invocations_per_event: 1,
                failure_semantic_id: "strategy.plugin.failure.unsupported.v1".to_owned(),
            }],
            resources: ResourceBoundsV2 {
                max_inputs: 8,
                max_nodes_per_reaction: 4,
                max_dependency_edges: 256,
                max_state_bytes: 4096,
                max_plugin_calls_per_event: 4,
            },
            falsifier: "trend state does not improve the frozen next-return decision".to_owned(),
        }
    }

    #[cfg(test)]
    mod tests {
        use rstest::rstest;

        use super::*;

        #[rstest]
        fn fixed_corpus_matches_the_owner_sealed_aapl_msft_frame() {
            let (request, _) = fixed_corpus().expect("fixed corpus");
            assert_eq!(
                request.request_identity,
                SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2
            );
            assert_eq!(request.design.inputs.len(), 2);
            assert_eq!(request.binding_requests.len(), 2);
            assert_eq!(request.plugin_source_capsules.len(), 1);
        }

        #[rstest]
        fn sealed_a0_accepts_only_the_exact_fixed_manifest_and_capsule() {
            let (request, _) = fixed_corpus().expect("fixed corpus");
            let manifest = &request.design.plugins[0];
            let capsule = &request.plugin_source_capsules[0];
            let mut builder = SealedDevelopComposerA0BuildV2;
            let exact = builder
                .build(manifest, capsule)
                .expect("exact sealed A0 corpus");
            exact
                .into_composer_build()
                .into_verified_for_composer(manifest)
                .expect("sealed A0 corpus passes move-bound consumption");

            let mut changed_manifest = manifest.clone();
            changed_manifest.max_fuel -= 1;
            assert!(builder.build(&changed_manifest, capsule).is_err());

            let mut changed_capsule = capsule.clone();
            changed_capsule.files[0].bytes.push(b' ');
            assert!(builder.build(manifest, &changed_capsule).is_err());
        }

        #[rstest]
        fn sealed_a0_rejects_changed_embedded_module_or_receipt_bytes() {
            let (request, _) = fixed_corpus().expect("fixed corpus");
            let manifest = &request.design.plugins[0];
            let capsule = &request.plugin_source_capsules[0];
            let module = include_bytes!("../fixtures/develop_composer_sealed_a0_v2/module.wasm");
            let receipt =
                include_bytes!("../fixtures/develop_composer_sealed_a0_v2/build_receipt.bin");

            let mut changed_module = module.to_vec();
            changed_module[0] ^= 1;
            assert!(
                crate::develop_plugin_build_v2::verify_sealed_corpus_artifacts_for_test_v2(
                    manifest,
                    capsule,
                    &changed_module,
                    receipt,
                )
                .is_err()
            );

            let mut changed_receipt = receipt.to_vec();
            changed_receipt[0] ^= 1;
            assert!(
                crate::develop_plugin_build_v2::verify_sealed_corpus_artifacts_for_test_v2(
                    manifest,
                    capsule,
                    module,
                    &changed_receipt,
                )
                .is_err()
            );
        }

        #[rstest]
        #[ignore = "regenerates the sealed A0 corpus from the exact admitted Darwin producer"]
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        fn regenerate_sealed_a0_corpus_from_real_producer() {
            let (request, _) = fixed_corpus().expect("fixed corpus");
            let (module, receipt) =
                crate::develop_plugin_build_v2::generate_sealed_corpus_artifacts_v2(
                    &request.design.plugins[0],
                    &request.plugin_source_capsules[0],
                )
                .expect("real fixed-corpus A0 build");
            let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("fixtures/develop_composer_sealed_a0_v2");
            std::fs::create_dir_all(&root).expect("sealed A0 fixture directory");
            std::fs::write(root.join("module.wasm"), module).expect("sealed A0 module fixture");
            std::fs::write(root.join("build_receipt.bin"), receipt)
                .expect("sealed A0 receipt fixture");
        }
    }
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
pub use sealed::SealedDevelopComposerAcceptanceV2;

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn default_response_is_always_receiptless_and_unavailable() {
        let response = default_unavailable_response("caller-request");
        assert_eq!(
            response.disposition,
            DevelopComposerOperationDispositionV2::Unavailable
        );
        assert!(response.receipt_identity.is_none());
        assert!(response.artifact.is_none());
    }
}
