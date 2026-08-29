use super::*;
use rstest::rstest;

#[derive(Clone)]
enum TestRead {
    Unavailable,
    Nonterminal,
    Terminal(Box<SealedBacktestTerminalResultV1>),
}

#[derive(Clone)]
struct SealedTestBacktestPort {
    read: TestRead,
}

impl sealed::BacktestTerminalResultReadPortSealed for SealedTestBacktestPort {}

#[async_trait]
impl BacktestTerminalResultReadPortV1 for SealedTestBacktestPort {
    async fn read_terminal_result(
        &self,
        _locator: &BacktestResultLocatorV1,
    ) -> Result<BacktestResultReadV1, ResearchDecisionError> {
        Ok(match &self.read {
            TestRead::Unavailable => BacktestResultReadV1::Unavailable,
            TestRead::Nonterminal => BacktestResultReadV1::Nonterminal,
            TestRead::Terminal(result) => BacktestResultReadV1::Terminal(result.clone()),
        })
    }
}

fn digest(identity: &str, byte: char) -> IdentityDigestV1 {
    IdentityDigestV1 {
        identity: identity.to_string(),
        digest: format!("sha256:{}", byte.to_string().repeat(64)),
    }
}

fn version(identity: &str, version: &str) -> VersionedIdentityV1 {
    VersionedIdentityV1 {
        identity: identity.to_string(),
        version: version.to_string(),
    }
}

fn locator() -> BacktestResultLocatorV1 {
    BacktestResultLocatorV1 {
        request_identity: "exploratory-request-1".to_string(),
        request_meaning_digest: format!("sha256:{}", "1".repeat(64)),
        result_identity: "backtest-result-1".to_string(),
        result_digest: format!("sha256:{}", "2".repeat(64)),
    }
}

fn bindings() -> ReplayEvidenceBindingsV1 {
    ReplayEvidenceBindingsV1 {
        intent: digest("intent-1", '3'),
        trial_family: digest("family-1", '4'),
        trial_family_census_frontier: digest("census-1", '5'),
        replay_authority: digest("exploratory-replay-authority", '6'),
        strategy_design: digest("strategy-design-1", '7'),
        strategy_plan: digest("strategy-plan-1", '8'),
        artifact: digest("artifact-1", '6'),
        resolved_owner_inputs: digest("resolved-owner-inputs-1", '7'),
        replay_request: IdentityDigestV1 {
            identity: locator().request_identity,
            digest: locator().request_meaning_digest,
        },
        requested_pit_scope: digest("pit-scope-1", '8'),
        pit_snapshot: digest("pit-snapshot-1", '9'),
        universe_selection: digest("universe-selection-1", 'a'),
        instrument_master_facts: vec![
            digest("instrument-master-fact-a", '2'),
            digest("instrument-master-fact-b", '3'),
        ],
        instrument_master_cut: digest("instrument-master-cut", '4'),
        correction_rule: digest("correction-rule-meaning", 'b'),
        market_semantics: digest("market-semantics-meaning", 'a'),
        replay_configuration: digest("replay-configuration-meaning", 'c'),
        runtime_kernel: digest("kernel-meaning", 'd'),
        simulator: digest("simulator-meaning", 'e'),
        cost_model: digest("cost-model-meaning", 'f'),
        slippage_model: digest("slippage-model-meaning", '0'),
        capacity_model: digest("capacity-model-meaning", '1'),
        runner_operational_profile: digest("runner-operational-profile-meaning", '2'),
        diagnostic_policy: digest("diagnostic-policy-meaning", '3'),
        deterministic_seed: digest("deterministic-seed-meaning", '4'),
        replay_window: digest("replay-window-meaning", '5'),
        calendar: digest("calendar-meaning", '6'),
        session: digest("session-meaning", '7'),
        time_zone: digest("time-zone-meaning", '8'),
        corporate_action_cut: digest("corporate-action-cut", '9'),
        historical_membership_cut: digest("historical-membership-cut", 'a'),
        semantic_trace: digest("semantic-trace", 'b'),
    }
}

fn evidence(category: DiagnosticCategoryV2, byte: char) -> DiagnosticEvidenceV1 {
    DiagnosticEvidenceV1 {
        category,
        evidence: digest(&format!("evidence-{category:?}"), byte),
    }
}

fn diagnosis() -> DiagnosisV1 {
    let finding = |identity: &str, byte| DiagnosisFindingV1 {
        disposition: DimensionDispositionV1::Supported,
        evidence: digest(identity, byte),
    };
    DiagnosisV1 {
        evidence_integrity: finding("diagnosis-integrity", '9'),
        mechanism_validity: finding("diagnosis-mechanism", 'a'),
        economic_viability: finding("diagnosis-economics", 'b'),
        robustness: finding("diagnosis-robustness", 'c'),
        failure_attribution: finding("diagnosis-attribution", 'd'),
        information_value: finding("diagnosis-information", 'e'),
    }
}

fn candidate(identity: &str, byte: char, rank: u32, tie: &str) -> SuccessorCandidateV1 {
    SuccessorCandidateV1 {
        candidate: digest(identity, byte),
        admissibility: CandidateAdmissibilityV1::AdmissibleAboveThreshold,
        information_value: InformationValueEvidenceV1 {
            decision_uncertainty: digest(&format!("{identity}-uncertainty"), '1'),
            distinguishing_observation_or_falsifier: digest(
                &format!("{identity}-distinguishing-observation"),
                '2',
            ),
            result_to_action_map: digest(&format!("{identity}-result-action-map"), '3'),
            bounded_acquisition_cost: digest(&format!("{identity}-acquisition-cost"), '4'),
            remaining_family_budget_effect: digest(&format!("{identity}-budget-effect"), '5'),
            competing_alternatives: vec![digest(&format!("{identity}-alternative"), '6')],
            ordinal_rationale: digest(&format!("{identity}-ordinal-rationale"), '7'),
        },
        uncertainty_reduction_rank: rank,
        tie_break_key: tie.to_string(),
        experiment: ExperimentModeV1::SingleDimension {
            changed_dimension: HypothesisDimensionV1::ReturnMechanism,
        },
    }
}

fn policy() -> DecisionPolicyV1 {
    DecisionPolicyV1 {
        policy: version("rd-decision-policy", "v1"),
        evidence_cut: digest("evidence-cut-1", 'f'),
        falsifier: digest("falsifier-1", '0'),
        stop_rule: digest("stop-rule-1", '1'),
        applicable_hard_stop: None,
        ready_for_selection: None,
        candidate_set: Some(CandidateSetV1 {
            generation_rule: digest("candidate-rule-1", '2'),
            frontier: digest("candidate-frontier-1", '3'),
            expected_cardinality: 2,
            candidates: vec![
                candidate("candidate-b", '4', 2, "b"),
                candidate("candidate-a", '5', 1, "a"),
            ],
            threshold: digest("threshold-1", '6'),
        }),
    }
}

fn readiness() -> ReadyForSelectionEvidenceV1 {
    ReadyForSelectionEvidenceV1 {
        exploratory_frontier: digest("exploratory-frontier-1", '7'),
        consumed_family_budget: digest("consumed-family-budget-1", '8'),
        completeness_proof: digest("selection-completeness-proof-1", '9'),
    }
}

fn request(identity: &str) -> DecisionCommitRequestV1 {
    DecisionCommitRequestV1 {
        decision_request_identity: identity.to_string(),
        expected_result: locator(),
        expected_bindings: bindings(),
        diagnosis: diagnosis(),
        policy: policy(),
    }
}

fn terminal(diagnostics: Vec<DiagnosticEvidenceV1>) -> SealedBacktestTerminalResultV1 {
    seal_backtest_terminal_result_v1(
        locator(),
        "backtest-attempt-1".to_string(),
        ReplayNamespaceV2::Exploratory,
        ReplayTerminalV2::TerminalResult,
        bindings(),
        diagnostics,
    )
    .unwrap()
}

fn valid_economic_terminal() -> SealedBacktestTerminalResultV1 {
    terminal(vec![evidence(DiagnosticCategoryV2::NoExecutionDefect, '7')])
}

#[rstest]
fn complete_defect_set_is_preserved_and_repair_winner_is_deterministic() {
    let diagnostics = vec![
        evidence(DiagnosticCategoryV2::ReplayConfiguration, '7'),
        evidence(DiagnosticCategoryV2::Simulator, '8'),
        evidence(DiagnosticCategoryV2::BacktestOperational, '9'),
        evidence(DiagnosticCategoryV2::RuntimeKernel, 'a'),
        evidence(DiagnosticCategoryV2::Artifact, 'b'),
        evidence(DiagnosticCategoryV2::MarketData, 'c'),
    ];
    let result = derive_decision(
        &request("decision-request-repair"),
        &terminal(diagnostics.clone()),
        42,
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        result.decision().outcome(),
        &IterationOutcomeV1::RepairInputs {
            supported_diagnostics: diagnostics,
            selected_target: RepairTargetV1::MarketData,
        }
    );
}

#[rstest]
fn unresolved_mismatch_and_incomplete_frontier_create_no_decision() {
    assert!(
        derive_decision(
            &request("decision-request-unresolved"),
            &terminal(vec![evidence(DiagnosticCategoryV2::UnresolvedFailure, '7')]),
            42,
        )
        .unwrap()
        .is_none()
    );

    let mut mismatched = request("decision-request-mismatch");
    mismatched.expected_bindings.artifact = digest("other-artifact", '8');
    assert!(
        derive_decision(&mismatched, &valid_economic_terminal(), 42)
            .unwrap()
            .is_none()
    );

    let mut incomplete = request("decision-request-incomplete");
    incomplete
        .policy
        .candidate_set
        .as_mut()
        .unwrap()
        .expected_cardinality = 3;
    assert!(
        derive_decision(&incomplete, &valid_economic_terminal(), 42)
            .unwrap()
            .is_none()
    );
}

#[rstest]
fn deterministic_winner_and_low_information_stop_are_canonical() {
    let winner_request = request("decision-request-winner");
    let first = derive_decision(&winner_request, &valid_economic_terminal(), 42)
        .unwrap()
        .unwrap();
    let replay = derive_decision(&winner_request, &valid_economic_terminal(), 42)
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::to_vec(&first).unwrap(),
        serde_json::to_vec(&replay).unwrap()
    );
    let IterationOutcomeV1::SuccessorExperiment { winner, .. } = first.decision().outcome() else {
        panic!("successor expected")
    };
    assert_eq!(winner.candidate.identity, "candidate-a");

    let mut low = request("decision-request-low-information");
    for candidate in &mut low.policy.candidate_set.as_mut().unwrap().candidates {
        candidate.admissibility = CandidateAdmissibilityV1::AdmissibleBelowThreshold;
    }
    let stopped = derive_decision(&low, &valid_economic_terminal(), 42)
        .unwrap()
        .unwrap();
    assert!(matches!(
        stopped.decision().outcome(),
        IterationOutcomeV1::TerminalStop {
            reason: TerminalStopV1::LowInformationValue,
            stop_evidence: _,
            candidate_set_frontier: Some(_),
        }
    ));
}

#[rstest]
fn missing_information_value_evidence_creates_no_decision() {
    let mut incomplete = request("decision-request-information-incomplete");
    incomplete.policy.candidate_set.as_mut().unwrap().candidates[0]
        .information_value
        .competing_alternatives
        .clear();
    assert!(derive_decision(&incomplete, &valid_economic_terminal(), 42).is_err());
}

#[rstest]
fn contradictory_diagnosis_cannot_be_promoted_to_ready() {
    for (identity, disposition) in [
        (
            "decision-request-falsified-ready",
            DimensionDispositionV1::Falsified,
        ),
        (
            "decision-request-impossible-ready",
            DimensionDispositionV1::EconomicallyImpossible,
        ),
        (
            "decision-request-unavailable-ready",
            DimensionDispositionV1::InputUnavailable,
        ),
    ] {
        let mut contradictory = request(identity);
        contradictory.policy.ready_for_selection = Some(readiness());
        contradictory.diagnosis.mechanism_validity.disposition = disposition;
        assert!(
            derive_decision(&contradictory, &valid_economic_terminal(), 42)
                .unwrap()
                .is_none()
        );
    }
}

#[rstest]
fn protected_result_cannot_enter_research_diagnosis() {
    assert!(
        seal_backtest_terminal_result_v1(
            locator(),
            "protected-attempt".to_string(),
            ReplayNamespaceV2::Protected,
            ReplayTerminalV2::TerminalResult,
            bindings(),
            vec![evidence(DiagnosticCategoryV2::NoExecutionDefect, '7')],
        )
        .is_err()
    );
}

#[rstest]
fn selection_requires_ready_and_cross_binds_every_frozen_authority() {
    let mut ready_request = request("decision-request-ready");
    ready_request.policy.ready_for_selection = Some(readiness());
    let ready = derive_decision(&ready_request, &valid_economic_terminal(), 42)
        .unwrap()
        .unwrap();
    let selection_request = SelectionCommitRequestV1 {
        selection_request_identity: "selection-request-1".to_string(),
        decision: ready.locator().clone(),
        result: locator(),
        trial_family: bindings().trial_family,
        census_frontier: bindings().trial_family_census_frontier,
        artifact: bindings().artifact,
        cost_model: bindings().cost_model,
        slippage_model: bindings().slippage_model,
        capacity_model: bindings().capacity_model,
        falsifier: ready_request.policy.falsifier.clone(),
        stop_rule: ready_request.policy.stop_rule.clone(),
        evidence_cut: ready_request.policy.evidence_cut.clone(),
        policy: ready_request.policy.policy.clone(),
        rationale: SelectionRationaleV1::InformationFrontierComplete,
    };
    let selection = derive_selection(&selection_request, &ready, 43).unwrap();
    assert_eq!(
        selection.selection.disposition,
        "SELECTED_FOR_QUALIFICATION"
    );

    let successor = derive_decision(
        &request("decision-request-not-ready"),
        &valid_economic_terminal(),
        42,
    )
    .unwrap()
    .unwrap();
    let mut illegal = selection_request;
    illegal.decision = successor.locator().clone();
    assert!(derive_selection(&illegal, &successor, 43).is_err());

    let mut wrong_artifact = SelectionCommitRequestV1 {
        selection_request_identity: "selection-request-wrong-artifact".to_string(),
        decision: ready.locator().clone(),
        result: locator(),
        trial_family: bindings().trial_family,
        census_frontier: bindings().trial_family_census_frontier,
        artifact: digest("wrong-artifact", '8'),
        cost_model: bindings().cost_model,
        slippage_model: bindings().slippage_model,
        capacity_model: bindings().capacity_model,
        falsifier: ready_request.policy.falsifier.clone(),
        stop_rule: ready_request.policy.stop_rule.clone(),
        evidence_cut: ready_request.policy.evidence_cut.clone(),
        policy: ready_request.policy.policy,
        rationale: SelectionRationaleV1::InformationFrontierComplete,
    };
    assert!(derive_selection(&wrong_artifact, &ready, 43).is_err());

    wrong_artifact.artifact = bindings().artifact;
    wrong_artifact.cost_model = digest("wrong-cost-model", '9');
    assert!(derive_selection(&wrong_artifact, &ready, 43).is_err());
}

#[rstest]
fn repair_and_terminal_stop_cannot_produce_selection() {
    let repair_request = request("decision-request-repair-selection");
    let repair = derive_decision(
        &repair_request,
        &terminal(vec![evidence(DiagnosticCategoryV2::MarketData, '8')]),
        42,
    )
    .unwrap()
    .unwrap();
    let mut selection_request = SelectionCommitRequestV1 {
        selection_request_identity: "selection-request-repair".to_string(),
        decision: repair.locator().clone(),
        result: locator(),
        trial_family: bindings().trial_family,
        census_frontier: bindings().trial_family_census_frontier,
        artifact: bindings().artifact,
        cost_model: bindings().cost_model,
        slippage_model: bindings().slippage_model,
        capacity_model: bindings().capacity_model,
        falsifier: repair_request.policy.falsifier.clone(),
        stop_rule: repair_request.policy.stop_rule.clone(),
        evidence_cut: repair_request.policy.evidence_cut.clone(),
        policy: repair_request.policy.policy,
        rationale: SelectionRationaleV1::InformationFrontierComplete,
    };
    assert!(derive_selection(&selection_request, &repair, 43).is_err());

    let mut stop_request = request("decision-request-stop-selection");
    stop_request.diagnosis.mechanism_validity.disposition = DimensionDispositionV1::Falsified;
    stop_request.policy.applicable_hard_stop = Some(HardStopV1 {
        reason: TerminalStopV1::FalsifierTriggered,
        evidence: digest("falsifier-stop-evidence", '9'),
    });
    let stopped = derive_decision(&stop_request, &valid_economic_terminal(), 42)
        .unwrap()
        .unwrap();
    selection_request.selection_request_identity = "selection-request-stop".to_string();
    selection_request.decision = stopped.locator().clone();
    selection_request.falsifier = stop_request.policy.falsifier;
    selection_request.stop_rule = stop_request.policy.stop_rule;
    selection_request.evidence_cut = stop_request.policy.evidence_cut;
    selection_request.policy = stop_request.policy.policy;
    assert!(derive_selection(&selection_request, &stopped, 43).is_err());
}

#[rstest]
fn higher_priority_diagnosis_cannot_be_overridden_by_budget_stop() {
    let mut stop_request = request("decision-request-stop-precedence");
    stop_request.diagnosis.evidence_integrity.disposition =
        DimensionDispositionV1::InputUnavailable;
    stop_request.policy.applicable_hard_stop = Some(HardStopV1 {
        reason: TerminalStopV1::BudgetExhausted,
        evidence: digest("budget-stop-evidence", '9'),
    });

    assert!(matches!(
        derive_decision(&stop_request, &valid_economic_terminal(), 42),
        Err(ResearchDecisionError::InvalidInput(_))
    ));
}

#[rstest]
fn backtest_bindings_keep_identity_digest_distinct_from_rd_policy_version() {
    let result = terminal(vec![evidence(DiagnosticCategoryV2::NoExecutionDefect, '7')]);
    let result_json = serde_json::to_value(&result).unwrap();
    assert!(result_json.get("backtest_owner_cut_epoch_ms").is_none());
    assert_eq!(
        result_json["bindings"]["runtime_kernel"]["digest"],
        bindings().runtime_kernel.digest
    );
    assert!(
        result_json["bindings"]["runtime_kernel"]
            .get("version")
            .is_none()
    );
    assert_eq!(
        result_json["bindings"]["instrument_master_facts"]
            .as_array()
            .unwrap()
            .len(),
        2
    );

    let decision = derive_decision(&request("decision-request-semantic-types"), &result, 42)
        .unwrap()
        .unwrap();
    let decision_json = serde_json::to_value(decision.decision()).unwrap();
    assert_eq!(decision_json["policy"]["policy"]["version"], "v1");
    assert!(decision_json["policy"]["policy"].get("digest").is_none());
}

#[tokio::test]
async fn unavailable_and_nonterminal_ports_remain_submitted_or_unknown() {
    for read in [TestRead::Unavailable, TestRead::Nonterminal] {
        let port = SealedTestBacktestPort { read };
        let observed = port.read_terminal_result(&locator()).await.unwrap();
        assert!(matches!(
            observed,
            BacktestResultReadV1::Unavailable | BacktestResultReadV1::Nonterminal
        ));
    }
}

#[tokio::test]
#[ignore = "requires an admitted RD_OWNER_TEST_DATABASE_URL; sealed result is test-only foundation evidence"]
async fn postgres_atomic_recovery_concurrency_conflict_selection_and_malformed_fail_close() {
    use postgres::PostgresResearchIterationDecisionOwnerV1;
    use vibe_testkit::postgres::DedicatedPostgresTestDatabase;

    let database = DedicatedPostgresTestDatabase::admit("RD_OWNER_TEST_DATABASE_URL")
        .await
        .unwrap();
    let pool = database.mutation().pool().clone();
    let owner = PostgresResearchIterationDecisionOwnerV1::connect(pool.clone())
        .await
        .unwrap();
    let suffix = format!(
        "{}-{}",
        database.mutation().marker_identity().replace(':', "-"),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let request_identity = format!("decision-request-pg-{suffix}");
    let mut ready_request = request(&request_identity);
    ready_request.policy.ready_for_selection = Some(readiness());
    let port = SealedTestBacktestPort {
        read: TestRead::Terminal(Box::new(valid_economic_terminal())),
    };

    let acl_is_closed: bool = sqlx::query_scalar(
        "SELECT count(*)=3
           AND bool_and(owner.rolname='rd_owner')
           AND bool_and(NOT EXISTS (
                 SELECT 1 FROM pg_catalog.aclexplode(class.relacl) acl
                  WHERE acl.grantee=0
               ))
           FROM pg_catalog.pg_class class
           JOIN pg_catalog.pg_roles owner ON owner.oid=class.relowner
          WHERE class.oid IN (
            'public.rd_research_iteration_decisions_v1'::regclass,
            'public.rd_research_selections_v1'::regclass,
            'public.rd_research_decision_outbox_v1'::regclass
          )",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(acl_is_closed);

    let mut rollback_request = request(&format!("decision-request-rollback-{suffix}"));
    rollback_request.policy.ready_for_selection = Some(readiness());
    sqlx::query(
        "ALTER TABLE public.rd_research_decision_outbox_v1 ADD CONSTRAINT rd_test_reject_atomic_v1 CHECK (event_kind <> 'RESEARCH_ITERATION_DECIDED_V1')",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        owner
            .submit_or_resolve_decision(&rollback_request, &port)
            .await
            .is_err()
    );
    let rolled_back: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.rd_research_iteration_decisions_v1 WHERE decision_request_identity=$1",
    )
    .bind(&rollback_request.decision_request_identity)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rolled_back, 0);
    sqlx::query(
        "ALTER TABLE public.rd_research_decision_outbox_v1 DROP CONSTRAINT rd_test_reject_atomic_v1",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (left, right) = tokio::join!(
        owner.submit_or_resolve_decision(&ready_request, &port),
        owner.submit_or_resolve_decision(&ready_request, &port),
    );
    let left = left.unwrap();
    let right = right.unwrap();
    let DecisionOwnerResponseV1::Committed { result: first } = left else {
        panic!("committed decision expected")
    };
    let DecisionOwnerResponseV1::Committed { result: replay } = right else {
        panic!("committed replay expected")
    };
    assert_eq!(
        serde_json::to_vec(&first).unwrap(),
        serde_json::to_vec(&replay).unwrap()
    );
    assert_eq!(
        owner.resolve_decision(first.locator()).await.unwrap(),
        Some(*first.clone())
    );
    let response_loss_replay = owner
        .submit_or_resolve_decision(
            &ready_request,
            &SealedTestBacktestPort {
                read: TestRead::Unavailable,
            },
        )
        .await
        .unwrap();
    let DecisionOwnerResponseV1::Committed {
        result: recovered_without_backtest,
    } = response_loss_replay
    else {
        panic!("committed response-loss recovery expected")
    };
    assert_eq!(
        serde_json::to_vec(&first).unwrap(),
        serde_json::to_vec(&recovered_without_backtest).unwrap()
    );

    let counts: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM public.rd_research_iteration_decisions_v1 WHERE decision_request_identity=$1), (SELECT count(*) FROM public.rd_research_decision_outbox_v1 WHERE aggregate_identity=$2 AND event_kind=$3)",
    )
    .bind(&request_identity)
    .bind(first.decision().decision_identity())
    .bind(DECISION_EVENT_V1)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(counts, (1, 1));

    let mut conflict = ready_request.clone();
    conflict.diagnosis.information_value.evidence = digest("changed-information", '8');
    assert!(matches!(
        owner.submit_or_resolve_decision(&conflict, &port).await,
        Err(ResearchDecisionError::DecisionConflict)
    ));

    let selection_request = SelectionCommitRequestV1 {
        selection_request_identity: format!("selection-request-pg-{suffix}"),
        decision: first.locator().clone(),
        result: locator(),
        trial_family: bindings().trial_family,
        census_frontier: bindings().trial_family_census_frontier,
        artifact: bindings().artifact,
        cost_model: bindings().cost_model,
        slippage_model: bindings().slippage_model,
        capacity_model: bindings().capacity_model,
        falsifier: ready_request.policy.falsifier.clone(),
        stop_rule: ready_request.policy.stop_rule.clone(),
        evidence_cut: ready_request.policy.evidence_cut.clone(),
        policy: ready_request.policy.policy,
        rationale: SelectionRationaleV1::InformationFrontierComplete,
    };
    let selection = Box::pin(owner.submit_or_resolve_selection(&selection_request))
        .await
        .unwrap();
    assert_eq!(
        owner.resolve_selection(selection.locator()).await.unwrap(),
        Some(selection.clone())
    );
    let selection_counts: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM public.rd_research_selections_v1 WHERE selection_request_identity=$1), (SELECT count(*) FROM public.rd_research_decision_outbox_v1 WHERE aggregate_identity=$2 AND event_kind=$3)",
    )
    .bind(&selection_request.selection_request_identity)
    .bind(&selection.selection.selection_identity)
    .bind(SELECTION_EVENT_V1)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(selection_counts, (1, 1));
    let mut selection_conflict = selection_request.clone();
    selection_conflict.rationale = SelectionRationaleV1::MechanismSupported;
    assert!(matches!(
        Box::pin(owner.submit_or_resolve_selection(&selection_conflict)).await,
        Err(ResearchDecisionError::SelectionConflict)
    ));
    let mut decision_binding_conflict = selection_request.clone();
    decision_binding_conflict.decision.decision_request_identity =
        format!("absent-decision-request-{suffix}");
    assert!(matches!(
        Box::pin(owner.submit_or_resolve_selection(&decision_binding_conflict)).await,
        Err(ResearchDecisionError::SelectionConflict)
    ));

    sqlx::query("UPDATE public.rd_research_iteration_decisions_v1 SET fact_json=jsonb_set(fact_json,'{decision_identity}',to_jsonb('malformed'::text)) WHERE decision_request_identity=$1")
        .bind(&request_identity)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        owner.resolve_decision(first.locator()).await,
        Err(ResearchDecisionError::Unavailable(_))
    ));
}
