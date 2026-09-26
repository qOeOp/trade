//! The first COMPOSER_V3 Replay the ordered chain commits, as one handle both F entries read.
//!
//! The prefix entry commits it through the production routes and asserts that it was created. The
//! body entry calls [`ensure_first_composer_v3_replay_acceptance_v1`] again with the same key and
//! gets the same Replay back, so it reads the Replay the prefix committed rather than making a
//! second one. The same key with other content is refused by name, as in
//! `vibe_product_edge::deployment_acceptance`.
//!
//! The Design behind it is an R&D-authored universe Bounded Feature Program Design: one member,
//! with coordinate rows, registered through the production chain (the initial PIT request, the
//! universe declaration, custody, the Composer run). An oracle-built Design would make this fixture
//! prove itself, so none is used. Its author is `author_single_threshold_program_v1`, the proposer
//! `docs/owners/rd.md` admits, in its universe-member form.
//!
//! Each step is a production route or Owner function, with two departures, both stated where they
//! happen:
//!
//! - The Data Client behind Market Data's PIT intake is a stand-in that answers for exactly the
//!   members Market Data issues, as in the initial PIT entry. The terminal is still Market Data's
//!   own derivation.
//! - The Composer runs through the library, not `POST /v2/develop-composer/runs`. That route runs
//!   the frozen program only in the default build, and the sealed build this chain runs - the only
//!   one carrying the COMPOSER_V3 commit route - routes it to the fixed corpus instead. It is a
//!   build mismatch, not a production path: a deployment has to carry both halves before a
//!   Composer artifact it produces can reach a COMPOSER_V3 commit.

use std::sync::Arc;

use async_trait::async_trait;
use axum::{body::Body, extract::Request};
use tower::ServiceExt;
use vibe_data::owner::{
    chain_fixture_v1::CHAIN_FIXTURE_INSTRUMENT_V1,
    market_semantics_admission_v1::{
        MarketSemanticsFactSubmissionV1, MarketSemanticsValueSubmissionV1,
    },
    pit_market_snapshot_intake_v1::pit_market_snapshot_intake_from_environment_v1,
    pit_observation_source_v1::{
        PitObservationScopeV1, PitObservationSourceErrorV1, PitObservationSourceV1,
        VendorObservationV1,
    },
    pit_snapshot::PitSnapshotSubmissionV1,
    replay_market_facts_v2::ReplayCompositionBindingLocatorV1,
    research_instrument_scope_v1::ResearchInstrumentScopeWireV1,
    source_binding::BindingDigest,
    universe_selection_admission_v1::universe_selection_admission_from_environment_v1,
};
use vibe_product_edge::{
    ProductEdgeAdmissionRequestV1,
    deployment_acceptance::{
        DeploymentAcceptanceOperationV1, DeploymentAcceptanceProposalV1,
        ProductEdgeDeploymentAcceptanceFixtureV1,
        ensure_product_edge_deployment_acceptance_fixture_v1,
    },
};
use vibe_strategy_factory::{
    bounded_feature_program_v1::BoundedFeaturePredicateV1,
    exploratory_replay::{
        EXPLORATORY_REPLAY_MUTATION_EFFECT_V3, EXPLORATORY_REPLAY_OPERATION_V3,
        EXPLORATORY_REPLAY_SCHEMA_V3, ExploratoryReplayRequestLocatorV2,
    },
    product_edge::{
        ProductEdgeResolution, RESEARCH_GOAL_OPERATION_V3, RESEARCH_GOAL_SCHEMA_V3,
        ResearchGoalOwnerResultV2, ResearchSourceV1,
    },
    product_edge_postgres::research_initial_pit::MarketDataInitialPitPortsV1,
    rd_bounded_feature_program_postgres_v1::PostgresResearchBoundedFeatureProgramOwnerV1,
    single_threshold_authoring_v1::{
        SingleThresholdAuthoringRequestV1, SingleThresholdChannelV1, SingleThresholdOutcomeV1,
        author_single_threshold_program_v1,
    },
    source_research_composer_postgres_v2::PostgresSourceResearchComposerProductionV2,
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

use super::*;

/// The one key both F entries use, so the body joins exactly what the prefix committed.
pub(crate) const FIRST_COMPOSER_V3_REPLAY_FIXTURE_KEY_V1: &str = "f-first-composer-v3";

const TOKEN: &str = "rd-owner-api-first-composer-v3";
const CLOSE_ROLE: &str = "research.input.close.daily.v1";
const OPEN_ROLE: &str = "research.input.open.daily.v1";

/// One Owner record by its identity and the digest it was issued under.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OwnerRecordLocatorV1 {
    pub(crate) identity: String,
    pub(crate) digest: String,
}

/// Everything the first COMPOSER_V3 Replay was built from, by the locators the Owners issued.
#[derive(Debug)]
#[expect(
    dead_code,
    reason = "the prefix entry asserts the fields the body does not read, and its body is not written yet"
)]
pub(crate) struct FirstComposerV3ReplayV1 {
    pub(crate) deployment: ProductEdgeDeploymentAcceptanceFixtureV1,
    pub(crate) research_request_identity: String,
    pub(crate) design_identity: String,
    pub(crate) artifact_locator: String,
    pub(crate) plan_canonical_digest: [u8; 32],
    pub(crate) replay_request: ExploratoryReplayRequestLocatorV2,
    pub(crate) attempt_identity: String,
    pub(crate) composition_binding: ReplayCompositionBindingLocatorV1,
    pub(crate) execution_input_binding: OwnerRecordLocatorV1,
    pub(crate) instrument_master_cut: OwnerRecordLocatorV1,
    pub(crate) universe_selection_identity: [u8; 32],
    pub(crate) member_instrument: String,
    /// Whether this call committed the Replay. The prefix asserts `true` on a fresh database; the
    /// body asserts `false`.
    pub(crate) created: bool,
}

/// The Data Client behind Market Data's PIT intake: one daily open and close per member Market Data
/// issues, which are the two fields the universe vertical fixes. What Market Data makes of them is
/// its own derivation. Values are in canonical form (no trailing zero at a nonzero scale), as a
/// real client normalizes them; Market Data refuses any other row as not canonical.
struct UniverseMemberDailyBarsV1;

#[async_trait]
impl PitObservationSourceV1 for UniverseMemberDailyBarsV1 {
    async fn observe(
        &self,
        scope: &PitObservationScopeV1,
    ) -> Result<Vec<VendorObservationV1>, PitObservationSourceErrorV1> {
        let mut observations = scope
            .members()
            .iter()
            .flat_map(|member| {
                [("OPEN", 12_301), ("CLOSE", 12_345)].map(|(field, value_mantissa)| {
                    VendorObservationV1 {
                        symbolic_key: format!("{member}.{field}.1D"),
                        member_key: member.clone(),
                        instrument: member.clone(),
                        channel: "MARKET".into(),
                        data_kind: "BAR".into(),
                        timeframe: "1D".into(),
                        field: field.into(),
                        value_mantissa,
                        value_scale: 2,
                        event_effective: scope.event_effective(),
                        provider_available: scope.provider_available(),
                        retrieval: scope.retrieval(),
                        correction_publication: scope.correction_publication(),
                    }
                })
            })
            .collect::<Vec<_>>();
        // Market Data takes a batch only in its canonical order, strictly increasing by symbolic
        // key and then member (`decode_canonical_observation_batch`), and does not reorder one.
        observations.sort_by(|left, right| {
            (&left.symbolic_key, &left.member_key).cmp(&(&right.symbolic_key, &right.member_key))
        });
        Ok(observations)
    }
}

/// A registry meaning named for this fixture, so no value is borrowed from another entry's.
fn first_composer_v3_digest(meaning: &str) -> BindingDigest {
    BindingDigest::from_untrusted_bytes(
        Sha256::digest(format!("first-composer-v3-replay.{meaning}").as_bytes()).into(),
    )
}

/// A route's answer as `(status, "[rejection code] body")`: the code is a header, and two refusals
/// with the same status differ only there.
async fn post(app: &Router, path: &str, body: Option<serde_json::Value>) -> (StatusCode, String) {
    let request = Request::builder()
        .method("POST")
        .uri(path)
        .header("authorization", format!("Bearer {TOKEN}"))
        .header("content-type", "application/json")
        .body(body.map_or_else(Body::empty, |body| {
            Body::from(serde_json::to_vec(&body).expect("a JSON body serializes"))
        }))
        .expect("a well-formed request");
    let response = app
        .clone()
        .oneshot(request)
        .await
        .expect("the router answers");
    let status = response.status();
    let code = response
        .headers()
        .get("x-rd-rejection-code")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("-")
        .to_owned();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("the body is read");
    (
        status,
        format!("[{code}] {}", String::from_utf8_lossy(&bytes)),
    )
}

fn json_of(answer: &str) -> serde_json::Value {
    serde_json::from_str(answer.split_once("] ").expect("the code prefix").1)
        .expect("the answer is JSON")
}

/// Accepts the Research request through Product Edge admission and the Owner's own submit, with the
/// real Market Data scope check. The scope makes it a V3 request.
async fn accept_research(
    deployment: &ProductEdgeDeploymentAcceptanceFixtureV1,
    product_edge_url: &str,
    owner: &PostgresResearchGoalOwnerV1,
    request_identity: &str,
) -> ResearchGoalOwnerResultV2 {
    let operation = ProductEdgeOperationRequestV2 {
        request_identity: request_identity.to_owned(),
        channel: ProductEdgeChannel::WindmillProductEdge,
        goal: SourcedResearchGoalV2 {
            hypothesis: "A daily close above a fixed level continues for one session.".to_owned(),
            mechanism: "Slow information diffusion creates bounded continuation.".to_owned(),
            falsification_question: "Does the continuation vanish after modeled costs?".to_owned(),
            expected_observation: "Net continuation remains positive.".to_owned(),
            required_data: vec!["PIT daily bars of the requested instrument".to_owned()],
            cost_assumption: "Exact acceptance cost model.".to_owned(),
            capacity_assumption: "Exact acceptance capacity model.".to_owned(),
            sources: vec![ResearchSourceV1 {
                locator: "https://example.com/first-composer-v3-replay".to_owned(),
                content_digest: format!("sha256:{}", "b".repeat(64)),
                observed_at: "2026-09-26T00:00:00Z".to_owned(),
                source_cut: "first-composer-v3-replay-cut-v1".to_owned(),
                license_basis: "public research".to_owned(),
                interpretation: "First COMPOSER_V3 Replay acceptance fixture.".to_owned(),
            }],
        },
        trial_family_proposal: TrialFamilyProposalV1 {
            trial_budget: 2,
            stop_rule: "Stop on falsifier or unavailable PIT input.".to_owned(),
            pit_rule_identity: "pit-rule-v1".to_owned(),
            cost_model_identity: "cost-model-v1".to_owned(),
            slippage_model_identity: "slippage-model-v1".to_owned(),
            capacity_model_identity: "capacity-model-v1".to_owned(),
            independence_rationale: "First COMPOSER_V3 Replay family.".to_owned(),
        },
    };
    let instrument_scope = ResearchInstrumentScopeWireV1 {
        schema_version: 1,
        identities: vec![CHAIN_FIXTURE_INSTRUMENT_V1.to_owned()],
    };
    let mut typed_payload = serde_json::to_value(&operation).expect("the operation serializes");
    typed_payload["instrument_scope"] =
        serde_json::to_value(&instrument_scope).expect("the scope serializes");
    let admission = deployment
        .connect_owner(product_edge_url)
        .await
        .expect("the deployment's Product Edge Owner opens")
        .admit_request(ProductEdgeAdmissionRequestV1 {
            request_identity: request_identity.to_owned(),
            typed_payload,
            operation: RESEARCH_GOAL_OPERATION_V3.to_owned(),
            operation_schema: RESEARCH_GOAL_SCHEMA_V3.to_owned(),
            target_owner: RESEARCH_OWNER_V1.to_owned(),
            requested_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".to_owned()],
            request_proof_digest: deployment.request_proof_digest.clone(),
            audit_correlation: format!("rd-workbench:{request_identity}"),
        })
        .await
        .expect("Product Edge admits the V3 Research request");
    owner
        .submit_v2(ProductEdgeResearchGoalRequestV2 {
            request_identity: operation.request_identity,
            channel: operation.channel,
            admission: admission.locator().clone(),
            goal: operation.goal,
            trial_family_proposal: operation.trial_family_proposal,
            instrument_scope: Some(instrument_scope),
        })
        .await
        .expect("the R&D Owner answers the V3 Research request")
}

/// Commits the first COMPOSER_V3 Replay under `fixture_key`, or returns the one already committed
/// under it.
#[allow(
    clippy::too_many_lines,
    reason = "one ordered path, read top to bottom"
)]
pub(crate) async fn ensure_first_composer_v3_replay_acceptance_v1(
    test_database: &CanonicalOwnerPostgresTestDatabaseV1,
    fixture_key: &str,
) -> FirstComposerV3ReplayV1 {
    let rd_url = test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner);
    let product_edge_url = test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner);
    // The production Market Data ports open from the deployment environment, under the roles the
    // deployment gives them.
    super::tests::composed_market_data_binding_admission(test_database).await;
    let token_digest: [u8; 32] = Sha256::digest(TOKEN.as_bytes()).into();

    // The deployment admits the two operations this Replay is made of: the V3 Research request and
    // the COMPOSER_V3 Replay composed from it.
    let deployment = ensure_product_edge_deployment_acceptance_fixture_v1(
        test_database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
        product_edge_url,
        &DeploymentAcceptanceProposalV1 {
            fixture_key: fixture_key.to_owned(),
            audience: RESEARCH_OWNER_V1.to_owned(),
            permissions: vec!["research:submit".to_owned()],
            operations: vec![
                DeploymentAcceptanceOperationV1 {
                    operation: RESEARCH_GOAL_OPERATION_V3.to_owned(),
                    operation_schema: RESEARCH_GOAL_SCHEMA_V3.to_owned(),
                    allowed_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".to_owned()],
                },
                DeploymentAcceptanceOperationV1 {
                    operation: EXPLORATORY_REPLAY_OPERATION_V3.to_owned(),
                    operation_schema: EXPLORATORY_REPLAY_SCHEMA_V3.to_owned(),
                    allowed_effects: vec![EXPLORATORY_REPLAY_MUTATION_EFFECT_V3.to_owned()],
                },
            ],
        },
    )
    .await
    .unwrap_or_else(|e| panic!("the F deployment: {e}"));

    let bounded_feature_program_owner = Arc::new(
        PostgresResearchBoundedFeatureProgramOwnerV1::connect(rd_url)
            .await
            .expect("the Bounded Feature Program Owner opens"),
    );
    let routes =
        bounded_feature_program::router(bounded_feature_program_owner.clone(), token_digest).merge(
            market_data_pit::router(
                None,
                bootstrap_market_data_source_binding_admission()
                    .await
                    .expect("the Source Binding admission composes"),
                bootstrap_market_data_universe_selection()
                    .await
                    .expect("the Universe Selection admission composes"),
                bootstrap_market_data_strategy_input_bindings()
                    .await
                    .expect("the Strategy Input Binding admission composes"),
                bootstrap_market_data_instrument_master_admission()
                    .await
                    .expect("the Instrument Master admission composes"),
                bootstrap_market_data_market_semantics_admission()
                    .await
                    .expect("the Market Semantics admission composes"),
                token_digest,
            ),
        );

    // H1: the V3 Research request, scoped to the chain fixture's instrument.
    let owner = Arc::new(
        PostgresResearchGoalOwnerV1::connect(
            rd_url,
            test_database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
        )
        .await
        .expect("the R&D Owner opens"),
    );
    let research_request_identity = format!("{fixture_key}-research");
    let accepted = Box::pin(accept_research(
        &deployment,
        product_edge_url,
        &owner,
        &research_request_identity,
    ))
    .await;
    assert_eq!(
        accepted.resolution(),
        ProductEdgeResolution::Accepted,
        "H1: the V3 Research request must be accepted: {accepted:?}",
    );

    // H2: its initial PIT request, issued over the production route to Market Data's production
    // intake.
    let ports = MarketDataInitialPitPortsV1::new(
        universe_selection_admission_from_environment_v1()
            .await
            .expect("Market Data's Universe Selection admission opens"),
        pit_market_snapshot_intake_from_environment_v1(Arc::new(UniverseMemberDailyBarsV1))
            .await
            .expect("Market Data's PIT intake opens"),
    );
    let initial_pit = research_initial_pit::router(owner.clone(), Some(ports), token_digest);
    let (status, answer) = post(
        &initial_pit,
        &format!("/v3/research-goals/{research_request_identity}/initial-pit"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "H2: {answer}");
    assert_eq!(
        json_of(&answer)["initial_pit"],
        serde_json::json!({"state": "TERMINAL", "disposition": "AVAILABLE", "primary_blocker": null}),
        "H2: Market Data must derive an AVAILABLE terminal: {answer}",
    );

    // The snapshot Market Data committed and the Source Binding R&D froze it under, read back rather
    // than restated: the snapshot through Market Data's public correlation read, the binding from
    // the exact submission bytes R&D froze and Market Data checked against its receipt.
    let rd = sqlx::PgPool::connect(rd_url)
        .await
        .expect("the R&D Owner pool opens");
    let (correlation, submission_bytes): (Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT attempt.correlation_identity, attempt.submission_bytes
           FROM rd_research_initial_pit_terminals_v1 terminal
           JOIN rd_research_initial_pit_attempts_v1 attempt
             ON attempt.request_identity = terminal.request_identity
            AND attempt.attempt_ordinal = terminal.attempt_ordinal
          WHERE terminal.request_identity = $1",
    )
    .bind(&research_request_identity)
    .fetch_one(&rd)
    .await
    .expect("H2: the terminal names the attempt it seals to");
    let submission = PitSnapshotSubmissionV1::from_json_value_v1(
        serde_json::from_slice(&submission_bytes).expect("the frozen submission is JSON"),
    )
    .expect("the frozen submission decodes with Market Data's own decoder");
    let mut read = rd.begin().await.expect("a read transaction opens");
    let held = vibe_data::owner::resolve_research_pit_terminal_by_correlation_v1(
        &mut read,
        BindingDigest::from_untrusted_bytes(
            correlation
                .as_slice()
                .try_into()
                .expect("a correlation is 32 bytes"),
        ),
    )
    .await
    .expect("Market Data answers the correlation read")
    .expect("Market Data holds the committed intake");
    read.rollback().await.expect("the read transaction closes");
    let pit_snapshot = held
        .terminal()
        .locator()
        .expect("an AVAILABLE terminal locates its snapshot")
        .clone();

    // H2b: the Market Semantics fact for this snapshot, which the universe declaration below
    // requires and nothing in this flow creates. Operations states it through the production route.
    // A scope that already has heads admits only the value they carry, so Operations restates the
    // value Market Data reads back for the binding's scope; only a scope with no head yet takes
    // Operations' own statement about the feed.
    let mut read = rd.begin().await.expect("a read transaction opens");
    let scope_value = vibe_data::owner::resolve_market_semantics_scope_value_v1(
        &mut read,
        &submission.source_binding,
    )
    .await
    .unwrap_or_else(|e| panic!("H2b: Market Data states the binding's scope value: {e:?}"));
    read.rollback().await.expect("the read transaction closes");
    let value = scope_value
        .value()
        .cloned()
        .unwrap_or_else(|| MarketSemanticsValueSubmissionV1 {
            normalization_identity: first_composer_v3_digest("normalization"),
            price_adjustment: "RAW".to_owned(),
            timestamp_basis: "EVENT_EFFECTIVE".to_owned(),
            price_unit_identity: first_composer_v3_digest("price-unit"),
            size_unit_identity: first_composer_v3_digest("size-unit"),
        });
    let (status, answer) = post(
        &routes,
        "/v1/market-data/market-semantics",
        Some(
            serde_json::to_value(MarketSemanticsFactSubmissionV1 {
                source_binding: submission.source_binding.clone(),
                pit_snapshot: pit_snapshot.clone(),
                value,
            })
            .expect("the Market Semantics submission serializes"),
        ),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "H2b: the snapshot's Market Semantics fact: {answer}"
    );

    // H3 and H4: the Design, authored by the admitted proposer in its universe-member form from the
    // Research custody's own facts, then published, bound and frozen over the production routes.
    let facts = bounded_feature_program_owner
        .read_research_authoring_facts_v1(&research_request_identity)
        .await
        .unwrap_or_else(|e| panic!("H4: the Research custody states its authoring facts: {e:?}"));
    let (design, meaning) =
        author_single_threshold_program_v1(&SingleThresholdAuthoringRequestV1 {
            research_request_identity: facts.research_request_identity,
            intent_identity: facts.intent_identity,
            intent_digest: facts.intent_digest,
            channel: SingleThresholdChannelV1::UniverseMember {
                close_role_semantic_id: CLOSE_ROLE.to_owned(),
                open_role_semantic_id: OPEN_ROLE.to_owned(),
            },
            threshold_coefficient: 12_000,
            comparison: BoundedFeaturePredicateV1::Greater,
            when_true: SingleThresholdOutcomeV1 {
                position_intent_semantic_id: "kernel.position.enter.v1".to_owned(),
                target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
                target_position_units: 1,
            },
            otherwise: SingleThresholdOutcomeV1 {
                position_intent_semantic_id: "kernel.position.exit.v1".to_owned(),
                target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
                target_position_units: 0,
            },
            falsifier: facts.falsifier.clone(),
        })
        .expect("H4: the proposer authors the universe-member statement");
    let (status, answer) = post(
        &routes,
        "/v1/strategy-designs/publish-role-intent",
        Some(serde_json::json!({
            "research_request_locator": research_request_identity,
            "design": design,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "H3: the role intent: {answer}");
    let published = json_of(&answer);
    let (status, answer) = post(
        &routes,
        "/v1/market-data/strategy-input-bindings/from-design-intent",
        Some(serde_json::json!({ "design_identity": published["design_identity"] })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "H4: the universe declaration: {answer}"
    );
    let (status, answer) = post(
        &routes,
        "/v1/bounded-feature-programs/declare",
        Some(serde_json::json!({
            "research_request_locator": research_request_identity,
            "design": design,
            "meaning": meaning,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "H4: the freeze: {answer}");

    // H5: the production Composer, through the library (see the module documentation for why not
    // its route).
    let composer = PostgresSourceResearchComposerProductionV2::connect(
        rd_url,
        test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
    )
    .await
    .expect("the production Composer opens");
    let composed = Box::pin(composer.run_bounded_feature_program(&research_request_identity))
        .await
        .expect("H5: the Composer transaction completes");
    assert_eq!(
        composed.disposition,
        DevelopComposerOperationDispositionV2::Success,
        "H5: the universe-member program must compose: {:?} at {:?}",
        composed.reason,
        composed.coordinate,
    );

    // The R&D Owner API's own state, as `main` composes it, for the two routes below that read it:
    // the universe-member composition issuance and the COMPOSER_V3 commit.
    let app = owner_state_routes().with_state(
        Box::pin(owner_api_state(
            test_database,
            &deployment,
            owner.clone(),
            token_digest,
        ))
        .await,
    );

    // H6: the universe-member composition binding, over the production route. The Design's role
    // set is the Composer operation's own positive answer; the four authority locators are Market
    // Data's answer for this snapshot and binding, not restated here. The window is the one
    // instant the snapshot's reference facts cover: Market Data derives its R0 record, and the
    // Market Semantics fact over it, for [event effective, event effective + 1).
    let composer_locator = DevelopComposerSealedReadLocatorV2::from_accepted_response(&composed)
        .expect("H6: a successful Composer operation locates its artifact");
    let mut read = rd.begin().await.expect("a read transaction opens");
    let basis = vibe_data::owner::resolve_universe_member_composition_basis_v1(
        &mut read,
        &pit_snapshot,
        &submission.source_binding,
    )
    .await
    .unwrap_or_else(|e| panic!("H6: Market Data states the snapshot's composition basis: {e:?}"));
    read.rollback().await.expect("the read transaction closes");
    let event_effective = i128::from(submission.time_evidence.event_effective.value);
    let composition: ReplayCompositionUniverseBindingIssuanceRequestV1 =
        serde_json::from_value(serde_json::json!({
            "composer_locator": composer_locator,
            "pit_locator": pit_snapshot,
            "source_binding_locator": submission.source_binding,
            "replay_start_event_ns": event_effective,
            "replay_end_event_ns_exclusive": event_effective + 1,
            "universe_selection_locator": basis.universe_selection_locator(),
            "reference_fact_r0_locator": basis.reference_fact_r0_locator(),
            "market_semantics_locator": basis.market_semantics_locator(),
            "correction_policy_locator": basis.correction_policy_locator(),
        }))
        .expect("the issuance command states exactly the universe-member composition's fields");
    let issuance = ReplayCompositionLocatorOnlyIssuanceRequestV1::new(
        first_composer_v3_digest(&format!("{fixture_key}:composition")),
        composition,
    )
    .expect("the issuance command encodes canonically");
    let (status, answer) = post(
        &app,
        "/v1/replay-compositions/universe-member-issuances",
        Some(serde_json::to_value(&issuance).expect("the issuance command serializes")),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "H6: the composition binding: {answer}"
    );
    let composition_binding: ReplayCompositionBindingLocatorV1 =
        serde_json::from_value(json_of(&answer)["binding"]["locator"].clone())
            .expect("H6: the issuance answers its binding's locator");

    // H7: the COMPOSER_V3 Replay, committed over the production route. Its TrialFamily is the one
    // H1's Research request formed, and its window is that family's sealed Replay policy window,
    // which R&D requires the Market Data facts to span exactly.
    let family = accepted
        .trial_family()
        .expect("H1: an accepted Research request forms its TrialFamily");
    let policy_window = family
        .root()
        .policy()
        .replay_policy_catalog_v3()
        .expect("H1: the TrialFamily seals a Replay policy catalog")
        .replay_policy_v2()
        .verify()
        .expect("H1: the sealed Replay policy verifies")
        .window;
    let replay_request_identity = format!("{fixture_key}-replay");
    let (status, answer) = post(
        &app,
        "/v3/exploratory-replay-requests/composer-backed",
        Some(serde_json::json!({
            "request_identity": replay_request_identity,
            "trial_family_identity": family.root().trial_family_identity(),
            "artifact_identity": composer_locator.artifact_locator,
            "composer_locator": composer_locator,
            "market_data_locator": composition_binding,
            "market_data_scope_digest": submission.scope_digest,
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "H7: the COMPOSER_V3 Replay (TrialFamily window {}..{}, Market Data window \
         {event_effective}..{}): {answer}",
        policy_window.start_event_ns,
        policy_window.end_event_ns_exclusive,
        event_effective + 1,
    );
    let replay_request: ExploratoryReplayRequestLocatorV2 =
        serde_json::from_value(json_of(&answer)["locator"].clone())
            .expect("H7: the commit answers its Replay's locator");

    todo!(
        "H8: the execution input binding, once a scheduling resolver exists for it, over \
         {replay_request:?}"
    )
}

/// The R&D Owner API's state for the routes this fixture drives, composed from the deployment the
/// fixture admitted.
async fn owner_api_state(
    test_database: &CanonicalOwnerPostgresTestDatabaseV1,
    deployment: &ProductEdgeDeploymentAcceptanceFixtureV1,
    owner: Arc<PostgresResearchGoalOwnerV1>,
    token_digest: [u8; 32],
) -> ApiState {
    let rd_url = test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner);
    // No route this fixture drives builds an Artifact, so the sandbox socket is never dialled.
    let artifact_owner = Arc::new(
        PostgresArtifactBuildOwnerV1::connect(rd_url, SANDBOX_SOCKET_DEFAULT, 600_000)
            .await
            .expect("the Artifact Owner opens"),
    );
    ApiState {
        product_edge: Arc::new(
            deployment
                .connect_owner(
                    test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
                )
                .await
                .expect("the deployment's Product Edge Owner opens"),
        ),
        owner: owner.clone(),
        artifact_owner: artifact_owner.clone(),
        artifact_source_owner: artifact_owner.clone(),
        artifact_directory_owner: artifact_owner,
        research_directory_owner: owner.clone(),
        research_readback_owner: owner,
        historical_custody_owner: Arc::new(
            PostgresHistoricalCustodyOwnerV1::connect_read_only(rd_url)
                .await
                .expect("the historical custody Owner opens"),
        ),
        token_digest,
        request_proof_digest: deployment.request_proof_digest.clone(),
        allow_acceptance_faults: false,
        _market_data_research_pit: None,
        native_replay_scheduling: None,
        instrument_master_v2: None,
        instrument_economic_terms: None,
        universe_sample_projection: None,
        develop_composer_read: None,
        develop_composer: Arc::new(
            SealedPostgresSourceResearchComposerV2::connect(
                rd_url,
                test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
            )
            .await
            .expect("the Composer opens"),
        ),
        replay_composition: Some(Arc::new(
            ReplayCompositionOwnerV1::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::MarketDataOwner),
                test_database.database_url(CanonicalOwnerTestRoleV1::MarketDataReader),
            )
            .await
            .expect("Market Data's replay composition Owner opens"),
        )),
    }
}
