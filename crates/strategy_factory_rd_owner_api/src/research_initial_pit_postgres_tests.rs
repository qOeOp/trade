//! Ordered-chain entry: a V3 Research request's initial PIT request, issued over HTTP.
//!
//! Every Market Data step runs through its production ports on the chain's database: the Universe
//! Selection admission, the PIT intake and both reads R&D makes in its own transaction. The one
//! stand-in is the Data Client, the provider behind the intake, which answers exactly the scope
//! Market Data issues; the terminal is still Market Data's own derivation.
//!
//! What this entry cannot construct, and why:
//!
//! - A new attempt after Market Data's clock head moves. The chain's head after entry 6 is that
//!   entry's fixture clock, and the production advancer (a Source Binding admission, which mints
//!   the Owner's own clock) is refused against it as `TrustedClockMismatch` (owner-chains run
//!   36225783033). The recovery branch is driven instead, with Market Data's refusal injected at
//!   the port; at an unchanged cut it refreezes the same attempt.
//! - Market Data refusing a correlation as already committed while reading none back. Market Data
//!   refuses only on the key its correlation read reads, so the Owner's `committed_but_absent`
//!   branch answers a Market Data that contradicts itself, which this chain cannot produce.
//!
//! Two sends at one cut freeze identical bytes, which Market Data rejoins rather than refuses; the
//! `PIT_CORRELATION_ALREADY_COMMITTED` read-back branch is driven by losing the answer to a send
//! Market Data committed.

use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use async_trait::async_trait;
use axum::{body::Body, extract::Request};
use rstest::rstest;
use sha2::{Digest as _, Sha256};
use sqlx::{PgPool, Postgres, Transaction};
use tower::ServiceExt;
// The chain fixture's instrument, which entry 6 admits into the only frontier Market Data holds.
// It is not a product choice: this entry proves how R&D issues an initial PIT request, which does
// not depend on the kind of instrument a scope names.
use vibe_data::owner::chain_fixture_v1::CHAIN_FIXTURE_INSTRUMENT_V1 as CHAIN_FIXTURE_INSTRUMENT;
use vibe_data::owner::{
    pit_market_snapshot_intake_v1::{
        PitMarketSnapshotBlockerV1, PitMarketSnapshotDispositionV1, PitMarketSnapshotIntakeErrorV1,
        PitMarketSnapshotTerminalV1, pit_market_snapshot_intake_from_environment_v1,
    },
    pit_observation_source_v1::{
        PitObservationScopeV1, PitObservationSourceErrorV1, PitObservationSourceV1,
        VendorObservationV1,
    },
    pit_snapshot::{
        PIT_SUBMISSION_OWNER_FIELDS_V1, PitSnapshotSubmissionDecodeErrorV1,
        PitSnapshotSubmissionV1, research_pit_requester_identity_v1,
    },
    research_instrument_scope_v1::{ResearchInstrumentScopeV1, ResearchInstrumentScopeWireV1},
    research_pit_references_v1::{ResearchPitReferencesErrorV1, ResearchPitReferencesV1},
    research_pit_terminal_v1::{ResearchPitIntakeTerminalV1, ResearchPitTerminalReadErrorV1},
    source_binding::BindingDigest,
    universe_selection::{
        UntrustedUniverseSelectionLocatorV1, UntrustedUniverseSelectionRequestV1,
    },
    universe_selection_admission_v1::{
        UniverseSelectionAdmissionErrorV1, UniverseSelectionTerminalV1,
        universe_selection_admission_from_environment_v1,
    },
};
use vibe_product_edge::{AgentOperationManifestProposalV1, ProductEdgeAdmissionRequestV1};
use vibe_strategy_factory::{
    product_edge::{
        ProductEdgeResolution, RESEARCH_GOAL_OPERATION_V3, RESEARCH_GOAL_SCHEMA_V3,
        ResearchGoalOwnerResultV2, ResearchSourceV1,
    },
    product_edge_postgres::research_initial_pit::{
        InitialPitMarketDataPortV1, MarketDataInitialPitPortsV1,
    },
    research_initial_pit_v1::ResearchInitialPitV1,
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

use super::*;

const TOKEN: &str = "rd-owner-api-initial-pit-test";
const REQUEST_PROOF_DIGEST: &str = "sha256:rd-owner-api-initial-pit-proof";

/// The Data Client behind the chain's intakes. It answers one bar per member it is configured to
/// answer for: every member Market Data issued, or one named member only. Every configuration is
/// this one type, so any terminal it leads to is Market Data's own finding.
struct ChainFixtureObservationsV1 {
    answers_for: ChainFixtureMembersV1,
}

enum ChainFixtureMembersV1 {
    /// Exactly the members the issued scope names.
    EveryIssuedMember,
    /// One member, whatever the scope names.
    Only(&'static str),
}

#[async_trait]
impl PitObservationSourceV1 for ChainFixtureObservationsV1 {
    async fn observe(
        &self,
        scope: &PitObservationScopeV1,
    ) -> Result<Vec<VendorObservationV1>, PitObservationSourceErrorV1> {
        let members = match self.answers_for {
            ChainFixtureMembersV1::EveryIssuedMember => scope.members().to_vec(),
            ChainFixtureMembersV1::Only(member) => vec![member.to_owned()],
        };
        Ok(members
            .iter()
            .map(|member| VendorObservationV1 {
                symbolic_key: format!("{member}.CLOSE.1M"),
                member_key: member.clone(),
                instrument: member.clone(),
                channel: "MARKET".into(),
                data_kind: "BAR".into(),
                timeframe: "1M".into(),
                field: "CLOSE".into(),
                value_mantissa: 12_345,
                value_scale: 2,
                event_effective: scope.event_effective(),
                provider_available: scope.provider_available(),
                retrieval: scope.retrieval(),
                correction_publication: scope.correction_publication(),
            })
            .collect())
    }
}

/// The production ports with scripted departures, and a record of every send.
struct ScriptedMarketDataV1 {
    inner: MarketDataInitialPitPortsV1,
    /// Answered in place of the first send, which then never reaches Market Data.
    first_send: tokio::sync::Mutex<Option<PitMarketSnapshotIntakeErrorV1>>,
    /// Sent to Market Data, which commits it, and answered with this refusal in place of the
    /// terminal: the answer that reaches the Owner is lost.
    answer_lost_as: Option<PitMarketSnapshotIntakeErrorV1>,
    /// Every correlation read fails as unreadable.
    readback_unavailable: bool,
    /// Holds each send until this many have arrived.
    barrier: Option<Arc<tokio::sync::Barrier>>,
    sends: AtomicUsize,
    answered: tokio::sync::Mutex<
        Vec<Result<PitMarketSnapshotTerminalV1, PitMarketSnapshotIntakeErrorV1>>,
    >,
}

impl ScriptedMarketDataV1 {
    fn over(inner: &MarketDataInitialPitPortsV1) -> Self {
        Self {
            inner: inner.clone(),
            first_send: tokio::sync::Mutex::new(None),
            answer_lost_as: None,
            readback_unavailable: false,
            barrier: None,
            sends: AtomicUsize::new(0),
            answered: tokio::sync::Mutex::new(Vec::new()),
        }
    }
}

#[async_trait]
impl InitialPitMarketDataPortV1 for ScriptedMarketDataV1 {
    async fn resolve_references(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        scope: &ResearchInstrumentScopeV1,
    ) -> Result<ResearchPitReferencesV1, ResearchPitReferencesErrorV1> {
        self.inner.resolve_references(transaction, scope).await
    }

    async fn read_terminal_by_correlation(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        correlation: BindingDigest,
    ) -> Result<Option<ResearchPitIntakeTerminalV1>, ResearchPitTerminalReadErrorV1> {
        if self.readback_unavailable {
            return Err(ResearchPitTerminalReadErrorV1::StoreUnavailable);
        }
        self.inner
            .read_terminal_by_correlation(transaction, correlation)
            .await
    }

    async fn evaluate_universe_selection(
        &self,
        request: UntrustedUniverseSelectionRequestV1,
    ) -> Result<UniverseSelectionTerminalV1, UniverseSelectionAdmissionErrorV1> {
        self.inner.evaluate_universe_selection(request).await
    }

    async fn submit(
        &self,
        submission: PitSnapshotSubmissionV1,
        universe_selection: UntrustedUniverseSelectionLocatorV1,
    ) -> Result<PitMarketSnapshotTerminalV1, PitMarketSnapshotIntakeErrorV1> {
        self.sends.fetch_add(1, Ordering::SeqCst);

        if let Some(barrier) = &self.barrier {
            barrier.wait().await;
        }

        if let Some(answer) = self.first_send.lock().await.take() {
            return Err(answer);
        }
        let answered = self.inner.submit(submission, universe_selection).await;
        self.answered.lock().await.push(answered.clone());

        match self.answer_lost_as {
            Some(refusal) => Err(refusal),
            None => answered,
        }
    }
}

/// The 32 bytes of an Intent identity the Owner's receipt names.
fn intent_identity_bytes(intent_identity: &str) -> [u8; 32] {
    let hex = intent_identity
        .strip_prefix("rd-research-intent-v2-")
        .expect("a canonical V2 Intent identity");
    let mut bytes = [0_u8; 32];

    for (at, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[at * 2..at * 2 + 2], 16).unwrap();
    }
    bytes
}

/// Recomputed here from the contract text, not taken from the Owner's code.
fn expected_correlation(intent_identity: &str) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"rd.research-initial-pit-correlation.v1\0");
    hash.update(intent_identity_bytes(intent_identity));
    hash.finalize().into()
}

/// The 32-byte Research request identity a Design role intent carries, recomputed here.
fn research_request_identity(request_locator: &str) -> BindingDigest {
    let mut hash = Sha256::new();
    hash.update(b"rd.develop.request-identity.v2\0");
    hash.update(request_locator.as_bytes());
    BindingDigest::from_untrusted_bytes(hash.finalize().into())
}

/// Accepts one Research request through Product Edge admission and the Owner's own submit, with
/// the real Market Data scope check. `scope` makes it a V3 request.
async fn accept(
    product_edge: &ProductEdgePostgresOwnerV1,
    owner: &PostgresResearchGoalOwnerV1,
    request_identity: &str,
    scope: Option<&[&str]>,
) -> ResearchGoalOwnerResultV2 {
    let operation = ProductEdgeOperationRequestV2 {
        request_identity: request_identity.to_owned(),
        channel: ProductEdgeChannel::WindmillProductEdge,
        goal: SourcedResearchGoalV2 {
            hypothesis: "A bounded momentum effect persists after exact costs.".to_owned(),
            mechanism: "Slow information diffusion creates bounded continuation.".to_owned(),
            falsification_question: "Does the effect disappear after modeled costs?".to_owned(),
            expected_observation: "Net continuation remains positive.".to_owned(),
            required_data: vec!["PIT bars of the requested instrument".to_owned()],
            cost_assumption: "Exact acceptance cost model.".to_owned(),
            capacity_assumption: "Exact acceptance capacity model.".to_owned(),
            sources: vec![ResearchSourceV1 {
                locator: "https://example.com/initial-pit-acceptance".to_owned(),
                content_digest: format!("sha256:{}", "a".repeat(64)),
                observed_at: "2026-09-26T00:00:00Z".to_owned(),
                source_cut: "initial-pit-acceptance-cut-v1".to_owned(),
                license_basis: "public research".to_owned(),
                interpretation: "Initial PIT issuance acceptance fixture.".to_owned(),
            }],
        },
        trial_family_proposal: TrialFamilyProposalV1 {
            trial_budget: 2,
            stop_rule: "Stop on falsifier or unavailable PIT input.".to_owned(),
            pit_rule_identity: "pit-rule-v1".to_owned(),
            cost_model_identity: "cost-model-v1".to_owned(),
            slippage_model_identity: "slippage-model-v1".to_owned(),
            capacity_model_identity: "capacity-model-v1".to_owned(),
            independence_rationale: "Fresh isolated initial PIT family.".to_owned(),
        },
    };
    let instrument_scope = scope.map(|identities| ResearchInstrumentScopeWireV1 {
        schema_version: 1,
        identities: identities
            .iter()
            .map(|identity| (*identity).to_owned())
            .collect(),
    });
    let mut typed_payload = serde_json::to_value(&operation).unwrap();
    let (admitted_operation, admitted_schema) = match &instrument_scope {
        Some(wire) => {
            typed_payload["instrument_scope"] = serde_json::to_value(wire).unwrap();
            (RESEARCH_GOAL_OPERATION_V3, RESEARCH_GOAL_SCHEMA_V3)
        }
        None => (RESEARCH_GOAL_OPERATION_V2, RESEARCH_GOAL_SCHEMA_V2),
    };
    let admission = product_edge
        .admit_request(ProductEdgeAdmissionRequestV1 {
            request_identity: request_identity.to_owned(),
            typed_payload,
            operation: admitted_operation.to_owned(),
            operation_schema: admitted_schema.to_owned(),
            target_owner: RESEARCH_OWNER_V1.to_owned(),
            requested_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".to_owned()],
            request_proof_digest: REQUEST_PROOF_DIGEST.to_owned(),
            audit_correlation: format!("rd-workbench:{request_identity}"),
        })
        .await
        .unwrap();
    owner
        .submit_v2(ProductEdgeResearchGoalRequestV2 {
            request_identity: operation.request_identity,
            channel: operation.channel,
            admission: admission.locator().clone(),
            goal: operation.goal,
            trial_family_proposal: operation.trial_family_proposal,
            instrument_scope,
        })
        .await
        .unwrap()
}

async fn issue_over_http(app: &axum::Router, request_identity: &str) -> Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/v3/research-goals/{request_identity}/initial-pit"))
                .header("authorization", format!("Bearer {TOKEN}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

/// This Owner's frozen attempts of one request, as `(ordinal, submission bytes)`.
async fn attempts(rd: &PgPool, request_identity: &str) -> Vec<(i32, Vec<u8>)> {
    sqlx::query_as(
        "SELECT attempt_ordinal, submission_bytes FROM rd_research_initial_pit_attempts_v1
          WHERE request_identity = $1 ORDER BY attempt_ordinal",
    )
    .bind(request_identity)
    .fetch_all(rd)
    .await
    .unwrap()
}

/// Market Data's initial intakes under one correlation.
async fn intakes(market_data: &PgPool, correlation: [u8; 32]) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM market_data_private.pit_initial_intake_correlations_v1
          WHERE correlation_identity = $1",
    )
    .bind(correlation.as_slice())
    .fetch_one(market_data)
    .await
    .unwrap()
}

fn intent_of(result: &ResearchGoalOwnerResultV2) -> String {
    result
        .owner_receipt()
        .and_then(|receipt| receipt.resulting_research_intent_identity.clone())
        .expect("an accepted request names its Intent")
}

fn available() -> ResearchInitialPitV1 {
    ResearchInitialPitV1::Terminal {
        disposition: PitMarketSnapshotDispositionV1::Available,
        primary_blocker: None,
    }
}

/// Needs entry 6: it admits the only frontier, Instrument Master fact and Source Binding the
/// chain's Market Data holds, and this entry reads them through Market Data's own read surface.
#[rstest]
#[ignore = "requires the ordered Owner PostgreSQL chain and entry 6's Market Data fixture"]
fn a_v3_research_request_issues_its_initial_pit_request_over_http() {
    // Accepting a request and issuing its PIT request each run the Owner's deepest custody paths;
    // together they overflow the default test stack, as the other V3 entries do.
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(|| {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(Box::pin(issues_its_initial_pit_request()));
        })
        .unwrap()
        .join()
        .unwrap();
}

#[allow(
    clippy::too_many_lines,
    reason = "one ordered entry, read top to bottom"
)]
async fn issues_its_initial_pit_request() {
    let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
    // The production Market Data ports open from the deployment environment.
    unsafe {
        env::set_var(
            "MARKET_DATA_OWNER_DATABASE_URL",
            test_database.database_url(CanonicalOwnerTestRoleV1::MarketDataOwner),
        );
    }
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos()
        .to_string();
    let now: u64 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis()
        .try_into()
        .unwrap();
    let product_edge = super::tests::bootstrap_api_test_product_edge_with(
        &test_database,
        &suffix,
        REQUEST_PROOF_DIGEST,
        vec![AgentOperationManifestProposalV1 {
            operation: RESEARCH_GOAL_OPERATION_V3.to_owned(),
            operation_schema: RESEARCH_GOAL_SCHEMA_V3.to_owned(),
            target_owner: RESEARCH_OWNER_V1.to_owned(),
            allowed_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".to_owned()],
            prohibited_effects: vec!["REAL_TRADING_V1".to_owned()],
            capability_policy_digest: format!("sha256:{}", "e".repeat(64)),
            effective_from_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: now.saturating_add(3_600_000),
        }],
        Vec::new(),
    )
    .await;
    let owner = Arc::new(
        PostgresResearchGoalOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            test_database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
        )
        .await
        .unwrap(),
    );
    let rd = PgPool::connect(test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner))
        .await
        .unwrap();
    let market_data =
        PgPool::connect(test_database.database_url(CanonicalOwnerTestRoleV1::MarketDataOwner))
            .await
            .unwrap();
    let universe = universe_selection_admission_from_environment_v1()
        .await
        .unwrap();
    let intake =
        pit_market_snapshot_intake_from_environment_v1(Arc::new(ChainFixtureObservationsV1 {
            answers_for: ChainFixtureMembersV1::EveryIssuedMember,
        }))
        .await
        .unwrap();
    let ports = MarketDataInitialPitPortsV1::new(universe.clone(), intake.clone());
    let token_digest: [u8; 32] = Sha256::digest(TOKEN.as_bytes()).into();
    let app = research_initial_pit::router(owner.clone(), Some(ports.clone()), token_digest);
    let scope = [CHAIN_FIXTURE_INSTRUMENT];

    // P1: accepted by Market Data's real check, and nothing is issued yet.
    let request = format!("rd-initial-pit-p-{suffix}");
    let accepted = accept(&product_edge, &owner, &request, Some(&scope)).await;
    assert_eq!(
        accepted.resolution(),
        ProductEdgeResolution::Accepted,
        "{accepted:?}"
    );
    assert_eq!(
        accepted.initial_pit(),
        Some(ResearchInitialPitV1::NotIssued)
    );
    let intent = intent_of(&accepted);
    let correlation = expected_correlation(&intent);

    // P2: issued over HTTP; the readback states Market Data's terminal.
    let response = issue_over_http(&app, &request).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = super::tests::response_json(response).await;
    assert_eq!(
        body["initial_pit"],
        serde_json::json!({"state": "TERMINAL", "disposition": "AVAILABLE", "primary_blocker": null}),
        "{body}"
    );

    // P3: the frozen bytes are a Market Data submission stating no Owner field, under the
    // contract's correlation and requester.
    let frozen = attempts(&rd, &request).await;
    assert_eq!(frozen.len(), 1);
    let stated: serde_json::Value = serde_json::from_slice(&frozen[0].1).unwrap();
    assert!(
        PIT_SUBMISSION_OWNER_FIELDS_V1
            .iter()
            .all(|field| stated.get(*field).is_none()),
        "{stated}"
    );
    let submission = PitSnapshotSubmissionV1::from_json_value_v1(stated.clone()).unwrap();
    assert_eq!(submission.correlation_identity.as_bytes(), &correlation);
    assert_eq!(
        submission.requester_identity,
        research_pit_requester_identity_v1(research_request_identity(&request))
    );
    assert_eq!(
        submission.scope_digest,
        ResearchInstrumentScopeV1::from_identities(vec![CHAIN_FIXTURE_INSTRUMENT.to_owned()])
            .unwrap()
            .identity()
    );

    // P4: the terminal Market Data holds under the correlation seals to exactly this attempt,
    // and this Owner recorded it against the attempt.
    let mut read = rd.begin().await.unwrap();
    let held = vibe_data::owner::resolve_research_pit_terminal_by_correlation_v1(
        &mut read,
        BindingDigest::from_untrusted_bytes(correlation),
    )
    .await
    .unwrap()
    .expect("Market Data holds the committed intake");
    read.rollback().await.unwrap();
    let sealed = submission
        .clone()
        .into_request(held.terminal().instrument_master_digest());
    assert_eq!(
        sealed.claimed_request_identity,
        held.terminal().request_identity()
    );
    assert_eq!(
        sealed.claimed_request_digest,
        held.terminal().request_digest()
    );
    let recorded: (i32, Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT attempt_ordinal, pit_request_identity, pit_request_digest
           FROM rd_research_initial_pit_terminals_v1 WHERE request_identity = $1",
    )
    .bind(&request)
    .fetch_one(&rd)
    .await
    .unwrap();
    assert_eq!(recorded.0, 1);
    assert_eq!(
        recorded.1,
        held.terminal().request_identity().as_bytes().to_vec()
    );
    assert_eq!(
        recorded.2,
        held.terminal().request_digest().as_bytes().to_vec()
    );

    // I1: issuing again changes nothing.
    let before = (
        attempts(&rd, &request).await,
        intakes(&market_data, correlation).await,
    );
    let again = issue_over_http(&app, &request).await;
    assert_eq!(again.status(), StatusCode::OK);
    assert_eq!(super::tests::response_json(again).await, body);
    assert_eq!(
        (
            attempts(&rd, &request).await,
            intakes(&market_data, correlation).await
        ),
        before
    );
    assert_eq!(before.1, 1);

    // I2: two issues at once, each past the freeze before either sends, converge on one
    // terminal. Both sends carry identical bytes at one cut, and Market Data rejoins the second:
    // both answer the same terminal, and neither is refused.
    let concurrent = format!("rd-initial-pit-i2-{suffix}");
    let concurrent_intent =
        intent_of(&accept(&product_edge, &owner, &concurrent, Some(&scope)).await);
    let mut both = ScriptedMarketDataV1::over(&ports);
    both.barrier = Some(Arc::new(tokio::sync::Barrier::new(2)));
    let (first, second) = tokio::join!(
        owner.issue_research_initial_pit_v1(&concurrent, &both),
        owner.issue_research_initial_pit_v1(&concurrent, &both),
    );
    assert_eq!(first, Ok(available()));
    assert_eq!(second, Ok(available()));
    assert_eq!(both.sends.load(Ordering::SeqCst), 2);
    let answered = both.answered.lock().await.clone();
    assert!(
        answered.len() == 2
            && answered
                .iter()
                .all(|answer| answer.as_ref().is_ok_and(|terminal| {
                    answered[0]
                        .as_ref()
                        .is_ok_and(|first| first.request_identity() == terminal.request_identity())
                })),
        "{answered:?}"
    );
    assert_eq!(attempts(&rd, &concurrent).await.len(), 1);
    assert_eq!(
        intakes(&market_data, expected_correlation(&concurrent_intent)).await,
        1
    );

    // I3: Market Data refuses the send's clock evidence and holds nothing under the correlation,
    // so the Owner freezes at the current cut and sends once more. The cut has not moved here, so
    // that is the same attempt: a second one cannot be constructed on this chain (see the module
    // documentation).
    let clocked = format!("rd-initial-pit-i3-{suffix}");
    accept(&product_edge, &owner, &clocked, Some(&scope)).await;
    let refused_clock = ScriptedMarketDataV1::over(&ports);
    *refused_clock.first_send.lock().await =
        Some(PitMarketSnapshotIntakeErrorV1::ClockEvidenceNotCurrent);
    assert_eq!(
        owner
            .issue_research_initial_pit_v1(&clocked, &refused_clock)
            .await,
        Ok(available())
    );
    assert_eq!(refused_clock.sends.load(Ordering::SeqCst), 2);
    assert_eq!(attempts(&rd, &clocked).await.len(), 1);

    // I4: Market Data commits the send but the answer is lost, and the Owner hears that the
    // correlation is already committed. It reads the committed intake back by correlation and
    // records it: one send, one intake, one attempt.
    let lost_answer = format!("rd-initial-pit-i4-{suffix}");
    let lost_answer_intent =
        intent_of(&accept(&product_edge, &owner, &lost_answer, Some(&scope)).await);
    let mut committed_elsewhere = ScriptedMarketDataV1::over(&ports);
    committed_elsewhere.answer_lost_as =
        Some(PitMarketSnapshotIntakeErrorV1::CorrelationAlreadyCommitted);
    assert_eq!(
        owner
            .issue_research_initial_pit_v1(&lost_answer, &committed_elsewhere)
            .await,
        Ok(available())
    );
    assert_eq!(committed_elsewhere.sends.load(Ordering::SeqCst), 1);
    assert_eq!(attempts(&rd, &lost_answer).await.len(), 1);
    assert_eq!(
        intakes(&market_data, expected_correlation(&lost_answer_intent)).await,
        1
    );

    // N3: a correlation read that fails is not "never submitted". With a frozen attempt Market
    // Data never received, an unreadable correlation leaves the request SUBMITTED_OR_UNKNOWN and
    // sends nothing; read as None, it would send again.
    let unread = format!("rd-initial-pit-n3-{suffix}");
    let unread_intent = intent_of(&accept(&product_edge, &owner, &unread, Some(&scope)).await);
    let lost = ScriptedMarketDataV1::over(&ports);
    *lost.first_send.lock().await = Some(PitMarketSnapshotIntakeErrorV1::StoreUnavailable);
    assert_eq!(
        owner.issue_research_initial_pit_v1(&unread, &lost).await,
        Ok(ResearchInitialPitV1::SubmittedOrUnknown)
    );
    assert_eq!(attempts(&rd, &unread).await.len(), 1);
    let mut unreadable = ScriptedMarketDataV1::over(&ports);
    unreadable.readback_unavailable = true;
    assert_eq!(
        owner
            .issue_research_initial_pit_v1(&unread, &unreadable)
            .await,
        Ok(ResearchInitialPitV1::SubmittedOrUnknown)
    );
    assert_eq!(unreadable.sends.load(Ordering::SeqCst), 0);
    assert_eq!(
        intakes(&market_data, expected_correlation(&unread_intent)).await,
        0
    );
    // What this entry wrote it also finishes: once the correlation reads, the request completes.
    assert_eq!(
        owner.issue_research_initial_pit_v1(&unread, &ports).await,
        Ok(available())
    );

    // N1: a V2 request states no scope, so it issues nothing and its readback says so.
    let unscoped = format!("rd-initial-pit-n1-{suffix}");
    accept(&product_edge, &owner, &unscoped, None).await;
    let refused = issue_over_http(&app, &unscoped).await;
    assert_eq!(refused.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        refused.headers()["x-rd-rejection-code"],
        "RESEARCH_REQUEST_STATES_NO_INSTRUMENT_SCOPE"
    );
    assert_eq!(
        super::tests::response_json(refused).await["initial_pit"],
        serde_json::Value::Null
    );
    assert!(attempts(&rd, &unscoped).await.is_empty());

    // N2: a submission that states the Instrument Master digest is refused by name, by Market
    // Data's decoder and at its route, and writes nothing.
    let mut stating = stated.clone();
    stating["instrument_master_digest"] =
        serde_json::to_value(held.terminal().instrument_master_digest()).unwrap();
    assert_eq!(
        PitSnapshotSubmissionV1::from_json_value_v1(stating.clone()).map(|_| ()),
        Err(PitSnapshotSubmissionDecodeErrorV1::StatesOwnerField)
    );
    let market_data_routes = market_data_pit::router(
        Some(intake.clone()),
        None,
        Some(universe.clone()),
        None,
        None,
        None,
        token_digest,
    );
    let intakes_before = intakes(&market_data, correlation).await;
    let refused_submission = market_data_routes
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/market-data/pit-market-snapshot-requests")
                .header("authorization", format!("Bearer {TOKEN}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&serde_json::json!({
                        "submission": stating,
                        "universe_selection": submission_locator(&rd, &request).await,
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        refused_submission.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        refused_submission.headers()["x-rd-rejection-code"],
        "PIT_SUBMISSION_STATES_OWNER_FIELD"
    );
    assert_eq!(intakes(&market_data, correlation).await, intakes_before);

    // N4: a Data Client that answers for a member outside the selection. The observed members
    // then differ from the selection's, so Market Data derives INSUFFICIENT itself, and the
    // readback states it with its primary blocker. An empty answer would be the plainer case, but
    // Market Data refuses an empty batch as not canonical today, contrary to its own Data Client
    // contract; that is Market Data's to repair, and this form reaches the same terminal now.
    let uncovered = format!("rd-initial-pit-n4-{suffix}");
    accept(&product_edge, &owner, &uncovered, Some(&scope)).await;
    let uncovering_intake =
        pit_market_snapshot_intake_from_environment_v1(Arc::new(ChainFixtureObservationsV1 {
            answers_for: ChainFixtureMembersV1::Only("MSFT.XNAS"),
        }))
        .await
        .unwrap();
    let insufficient = ResearchInitialPitV1::Terminal {
        disposition: PitMarketSnapshotDispositionV1::Insufficient,
        primary_blocker: Some(PitMarketSnapshotBlockerV1::CoverageInsufficient),
    };
    assert_eq!(
        owner
            .issue_research_initial_pit_v1(
                &uncovered,
                &MarketDataInitialPitPortsV1::new(universe.clone(), uncovering_intake),
            )
            .await,
        Ok(insufficient)
    );
    assert_eq!(
        owner
            .read_research_v2(&uncovered)
            .await
            .unwrap()
            .initial_pit(),
        Some(insufficient)
    );
}

/// The Universe Selection locator the request's attempt names, as Market Data's route reads it.
async fn submission_locator(rd: &PgPool, request_identity: &str) -> serde_json::Value {
    let (identity, meaning): (Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT universe_selection_request_identity, universe_selection_request_meaning_digest
           FROM rd_research_initial_pit_attempts_v1
          WHERE request_identity = $1 AND attempt_ordinal = 1",
    )
    .bind(request_identity)
    .fetch_one(rd)
    .await
    .unwrap();
    serde_json::to_value(UntrustedUniverseSelectionLocatorV1::from_untrusted(
        BindingDigest::from_untrusted_bytes(identity.try_into().unwrap()),
        BindingDigest::from_untrusted_bytes(meaning.try_into().unwrap()),
    ))
    .unwrap()
}
