//! First-party Dashboard read API binary.
//!
//! The composition itself lives in the library so the ordered Owner chain can serve the exact
//! production router to a browser; this entry point only binds it to the deployment environment.

use vibe_strategy_factory_rd_owner_api::dashboard_read_api::{DashboardReadApiConfigV1, serve};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_target(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    serve(DashboardReadApiConfigV1::from_environment()?).await
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    };

    use async_trait::async_trait;
    use axum::http::{HeaderValue, header::AUTHORIZATION};
    use sqlx::Row;
    use tokio::net::TcpListener;
    use vibe_strategy_factory::{
        artifact_build::{
            ArtifactBuildResultV1, ArtifactDirectoryCompletenessV1, ArtifactDirectoryReadbackV1,
            ArtifactSourceReadbackV1,
        },
        dashboard_read::{FormationCatalogCompletenessV1, IterationTimelineStateV1},
        develop_composer_operation_v2::{
            DevelopComposerOperationDispositionV2, DevelopComposerOperationResponseV2,
            DevelopComposerReadbackOwnerErrorV2, DevelopComposerReadbackOwnerPortV2,
        },
        exploratory_replay::{
            ExploratoryReplayOwnerError, ExploratoryReplayReadResultV2,
            ExploratoryReplayRecoverySelectorV2,
        },
        product_edge::{
            ResearchDirectoryCompletenessV1, ResearchDirectoryReadbackV1, ResearchGoalOwnerError,
            ResearchGoalOwnerResultV2,
        },
        source_intake::{
            SourceIntakeOwnerErrorV1, SourceIntakeReadbackOwnerPort, SourceIntakeTerminalAtomV1,
        },
    };
    use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

    use std::sync::Arc;

    use axum::{
        extract::{Path, Query, State},
        http::{HeaderMap, StatusCode},
        response::Response,
    };
    use rstest::rstest;
    use sha2::{Digest, Sha256};
    use vibe_backtest_result_custody::BacktestReadbackRefusalV1;
    use vibe_strategy_factory::{
        BacktestResultCustodyErrorV2,
        artifact_build::{
            ArtifactBuildError, ArtifactDirectoryCursorV1, ArtifactDirectoryOwnerPort,
            ArtifactReadbackOwnerPortV1, ArtifactSourceOwnerPort,
        },
        dashboard_read::{
            DashboardReadErrorV1, FormationCatalogOwnerPortV1, FormationCatalogReadbackV1,
            IterationTimelineOwnerPortV1, IterationTimelineReadbackV1,
        },
        exploratory_replay::{
            HistoricalExploratoryReplayRejectionReadbackV1,
            HistoricalExploratoryReplayRejectionSelectorV1,
        },
        product_edge::{
            ResearchDirectoryCursorV1, ResearchDirectoryOwnerPort, ResearchReadbackOwnerPortV1,
        },
        product_edge_postgres::PostgresExploratoryReplayReadbackOwnerV2,
        rd_historical_custody::{
            HistoricalCustodyCompletenessV1, HistoricalCustodyErrorV1,
            HistoricalCustodyOwnerPortV1, HistoricalCustodyQuarantineV1,
        },
    };
    use vibe_strategy_factory::{
        ExploratoryReplayResultLocatorV2,
        backtest_run_report_read_v1::{BacktestRunReportProjectionV1, BacktestRunReportRefusalV1},
    };
    use vibe_strategy_factory_rd_owner_api::dashboard_read_api::{
        self as dashboard_read_api, ApiState, ArtifactDirectoryQueryV1, BACKTEST_RUN_ABSENT_V1,
        BacktestRunReportAnswerV1, BacktestRunReportOwnerPortV1, DashboardReadApiConfigV1,
        ExploratoryReplayHistoricalRejectionOwnerPortV1,
        ExploratoryReplayHistoricalRejectionQueryV1, ExploratoryReplayReadbackOwnerPortV2,
        ExploratoryReplayReadbackQueryV2, ExploratoryReplayResultPathV2,
        ExploratoryReplayResultQueryV2, ExploratoryReplayResultReadbackOwnerPortV2,
        READ_NONCE_HEADER, ResearchDirectoryQueryV1, UnavailableDashboardJourneyReadbackV1,
        UnavailableHistoricalCustodyV1, read_artifact, read_artifact_directory,
        read_artifact_source, read_backtest_run_report, read_develop_composer,
        read_exploratory_replay, read_exploratory_replay_historical_rejection,
        read_exploratory_replay_result, read_formation_catalog, read_historical_custodies,
        read_iteration_timeline, read_research_directory, read_research_v2, read_source_intake,
    };

    #[derive(Default)]
    struct RecordingArtifact {
        directory_calls: AtomicUsize,
        readback_calls: AtomicUsize,
        source_calls: AtomicUsize,
        request: Mutex<Option<(Option<ArtifactDirectoryCursorV1>, u32)>>,
    }

    #[async_trait]
    impl ArtifactDirectoryOwnerPort for RecordingArtifact {
        async fn list_artifacts(
            &self,
            after: Option<&ArtifactDirectoryCursorV1>,
            limit: u32,
        ) -> Result<ArtifactDirectoryReadbackV1, ArtifactBuildError> {
            self.directory_calls.fetch_add(1, Ordering::SeqCst);
            *self.request.lock().expect("request lock") = Some((after.cloned(), limit));
            Ok(ArtifactDirectoryReadbackV1 {
                schema_version: 1,
                observed_at_epoch_ms: 1,
                completeness: ArtifactDirectoryCompletenessV1::Complete,
                omitted_count: 0,
                next_cursor: None,
                items: Vec::new(),
            })
        }
    }

    #[async_trait]
    impl ArtifactSourceOwnerPort for RecordingArtifact {
        async fn read_source(
            &self,
            _build_request_identity: &str,
            _attempt_identity: &str,
        ) -> Result<Option<ArtifactSourceReadbackV1>, ArtifactBuildError> {
            self.source_calls.fetch_add(1, Ordering::SeqCst);
            Ok(None)
        }
    }

    #[async_trait]
    impl ArtifactReadbackOwnerPortV1 for RecordingArtifact {
        async fn read_artifact(
            &self,
            build_request_identity: &str,
            attempt_identity: &str,
        ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
            self.readback_calls.fetch_add(1, Ordering::SeqCst);
            Ok(ArtifactBuildResultV1::submitted_or_unknown(
                build_request_identity,
                attempt_identity,
            ))
        }
    }

    #[derive(Default)]
    struct RecordingResearch {
        directory_calls: AtomicUsize,
        readback_calls: AtomicUsize,
    }

    #[async_trait]
    impl ResearchDirectoryOwnerPort for RecordingResearch {
        async fn list_research(
            &self,
            _after: Option<&ResearchDirectoryCursorV1>,
            _limit: u32,
        ) -> Result<ResearchDirectoryReadbackV1, ResearchGoalOwnerError> {
            self.directory_calls.fetch_add(1, Ordering::SeqCst);
            Ok(ResearchDirectoryReadbackV1 {
                schema_version: 1,
                observed_at_epoch_ms: 1,
                completeness: ResearchDirectoryCompletenessV1::Complete,
                omitted_count: 0,
                next_cursor: None,
                items: Vec::new(),
            })
        }
    }

    #[async_trait]
    impl ResearchReadbackOwnerPortV1 for RecordingResearch {
        async fn read_research_v2(
            &self,
            _request_identity: &str,
        ) -> Result<ResearchGoalOwnerResultV2, ResearchGoalOwnerError> {
            self.readback_calls.fetch_add(1, Ordering::SeqCst);
            Err(ResearchGoalOwnerError::Storage("test stop".into()))
        }
    }

    #[derive(Default)]
    struct RecordingSourceIntake {
        readback_calls: AtomicUsize,
    }

    #[derive(Default)]
    struct RecordingComposer {
        readback_calls: AtomicUsize,
    }

    #[derive(Default)]
    struct RecordingReplay {
        readback_calls: AtomicUsize,
        result_calls: AtomicUsize,
        historical_rejection_calls: AtomicUsize,
    }

    struct RecordingRunReport {
        answer: BacktestRunReportAnswerV1,
        locators: Mutex<Vec<(String, String, String)>>,
    }

    impl RecordingRunReport {
        fn answering(answer: BacktestRunReportAnswerV1) -> Arc<Self> {
            Arc::new(Self {
                answer,
                locators: Mutex::new(Vec::new()),
            })
        }

        fn locators(&self) -> Vec<(String, String, String)> {
            self.locators.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl BacktestRunReportOwnerPortV1 for RecordingRunReport {
        async fn read_backtest_run_report(
            &self,
            locator: ExploratoryReplayResultLocatorV2<'_>,
        ) -> BacktestRunReportAnswerV1 {
            self.locators.lock().unwrap().push((
                locator.result_identity.to_owned(),
                locator.request_identity.to_owned(),
                locator.attempt_identity.to_owned(),
            ));
            self.answer.clone()
        }
    }

    #[derive(Default)]
    struct RecordingJourney {
        formation_calls: AtomicUsize,
        iteration_calls: AtomicUsize,
    }

    #[async_trait]
    impl FormationCatalogOwnerPortV1 for RecordingJourney {
        async fn read_formation_catalog(
            &self,
        ) -> Result<FormationCatalogReadbackV1, DashboardReadErrorV1> {
            self.formation_calls.fetch_add(1, Ordering::SeqCst);
            Ok(FormationCatalogReadbackV1 {
                schema_version: 1,
                operation: "rd.formation_catalog.read.v1",
                completeness: FormationCatalogCompletenessV1::Complete,
                observed_at_epoch_ms: 1,
                families: Vec::new(),
            })
        }
    }

    #[async_trait]
    impl IterationTimelineOwnerPortV1 for RecordingJourney {
        async fn read_iteration_timeline(
            &self,
            trial_family_identity: &str,
        ) -> Result<IterationTimelineReadbackV1, DashboardReadErrorV1> {
            self.iteration_calls.fetch_add(1, Ordering::SeqCst);
            Ok(IterationTimelineReadbackV1 {
                schema_version: 1,
                trial_family_identity: trial_family_identity.to_owned(),
                census_frontier_identity: "frontier-1".to_owned(),
                census_frontier_digest: format!("sha256:{}", "1".repeat(64)),
                consumed_trial_budget: 0,
                trial_budget: 2,
                state: IterationTimelineStateV1::AwaitingReplayResult,
                decisions: Vec::new(),
                observed_at_epoch_ms: 1,
            })
        }
    }

    #[async_trait]
    impl ExploratoryReplayReadbackOwnerPortV2 for RecordingReplay {
        async fn read_exploratory_replay(
            &self,
            _selector: &ExploratoryReplayRecoverySelectorV2,
        ) -> Result<ExploratoryReplayReadResultV2, ExploratoryReplayOwnerError> {
            self.readback_calls.fetch_add(1, Ordering::SeqCst);
            Err(ExploratoryReplayOwnerError::Unavailable(
                "test stop".to_owned(),
            ))
        }
    }

    #[async_trait]
    impl ExploratoryReplayResultReadbackOwnerPortV2 for RecordingReplay {
        async fn read_exploratory_replay_result(
            &self,
            result_identity: &str,
            request_identity: &str,
            attempt_identity: &str,
        ) -> Result<Option<Vec<u8>>, BacktestResultCustodyErrorV2> {
            self.result_calls.fetch_add(1, Ordering::SeqCst);
            Ok(Some(
                serde_json::to_vec(&serde_json::json!({
                    "result_identity": result_identity,
                    "request_identity": request_identity,
                    "attempt_identity": attempt_identity,
                }))
                .expect("recording result bytes"),
            ))
        }
    }

    #[async_trait]
    impl ExploratoryReplayHistoricalRejectionOwnerPortV1 for RecordingReplay {
        async fn read_historical_rejection(
            &self,
            selector: &HistoricalExploratoryReplayRejectionSelectorV1,
        ) -> Result<
            Option<HistoricalExploratoryReplayRejectionReadbackV1>,
            ExploratoryReplayOwnerError,
        > {
            self.historical_rejection_calls
                .fetch_add(1, Ordering::SeqCst);
            let _ = selector;
            Ok(None)
        }
    }

    #[async_trait]
    impl DevelopComposerReadbackOwnerPortV2 for RecordingComposer {
        async fn read_develop_composer(
            &self,
            request_identity: &str,
        ) -> Result<DevelopComposerOperationResponseV2, DevelopComposerReadbackOwnerErrorV2>
        {
            self.readback_calls.fetch_add(1, Ordering::SeqCst);
            Ok(DevelopComposerOperationResponseV2 {
                schema_version: 2,
                request_identity: request_identity.to_owned(),
                disposition: DevelopComposerOperationDispositionV2::Unavailable,
                receipt_identity: None,
                artifact: None,
                coordinate: Some("operation".to_owned()),
                reason: Some("terminal is unavailable".to_owned()),
            })
        }
    }

    #[async_trait]
    impl SourceIntakeReadbackOwnerPort for RecordingSourceIntake {
        async fn read_source_intake(
            &self,
            _request_identity: &str,
        ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1> {
            self.readback_calls.fetch_add(1, Ordering::SeqCst);
            Ok(None)
        }
    }

    fn state(
        artifact: Arc<RecordingArtifact>,
        research: Arc<RecordingResearch>,
        source_intake: Arc<RecordingSourceIntake>,
    ) -> ApiState {
        ApiState {
            artifact_directory: artifact.clone(),
            artifact_readback: artifact.clone(),
            artifact_source: artifact,
            research_directory: research.clone(),
            research_readback: research,
            research_questions: Arc::new(UnavailableDashboardJourneyReadbackV1),
            formation_catalog: Arc::new(UnavailableDashboardJourneyReadbackV1),
            iteration_timeline: Arc::new(UnavailableDashboardJourneyReadbackV1),
            source_intake_readback: Some(source_intake),
            composer_readback: Some(Arc::new(RecordingComposer::default())),
            exploratory_replay_readback: Arc::new(RecordingReplay::default()),
            exploratory_replay_result_readback: Arc::new(RecordingReplay::default()),
            exploratory_replay_historical_rejection_readback: Arc::new(RecordingReplay::default()),
            historical_custody: Arc::new(UnavailableHistoricalCustodyV1),
            backtest_run_report: RecordingRunReport::answering(BacktestRunReportAnswerV1::Absent),
            token_digest: Sha256::digest(b"test-token").into(),
        }
    }

    fn headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer test-token"));
        headers
    }

    const NONCE: &str = "0123456789abcdef0123456789abcdef";

    /// The read credential plus the one request nonce the Owner-clock reads require.
    fn nonced_headers() -> HeaderMap {
        let mut headers = headers();
        headers.insert(READ_NONCE_HEADER, HeaderValue::from_static(NONCE));
        headers
    }

    #[tokio::test]
    async fn unauthorized_request_makes_zero_owner_calls() {
        let artifact = Arc::new(RecordingArtifact::default());
        let research = Arc::new(RecordingResearch::default());
        let source_intake = Arc::new(RecordingSourceIntake::default());
        let api = state(artifact.clone(), research.clone(), source_intake.clone());
        let journey = Arc::new(RecordingJourney::default());
        let mut api = api;
        api.formation_catalog = journey.clone();
        api.iteration_timeline = journey.clone();
        let response = read_artifact_directory(
            State(api.clone()),
            Query(ArtifactDirectoryQueryV1 {
                limit: None,
                after_prepared_at_epoch_ms: None,
                after_build_request_identity: None,
            }),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let response = read_research_v2(
            State(api.clone()),
            Path("research-request-v2-test".to_string()),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let response = read_artifact(
            State(api.clone()),
            Path(("build-1".to_owned(), "attempt-1".to_owned())),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let response = read_source_intake(
            State(api.clone()),
            Path("source-request-test".to_string()),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            read_formation_catalog(State(api.clone()), HeaderMap::new())
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            read_iteration_timeline(
                State(api),
                Path("trial-family-1".to_owned()),
                HeaderMap::new(),
            )
            .await
            .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(artifact.directory_calls.load(Ordering::SeqCst), 0);
        assert_eq!(artifact.readback_calls.load(Ordering::SeqCst), 0);
        assert_eq!(research.readback_calls.load(Ordering::SeqCst), 0);
        assert_eq!(source_intake.readback_calls.load(Ordering::SeqCst), 0);
        assert_eq!(journey.formation_calls.load(Ordering::SeqCst), 0);
        assert_eq!(journey.iteration_calls.load(Ordering::SeqCst), 0);
        let response = read_develop_composer(
            State(state(
                Arc::new(RecordingArtifact::default()),
                Arc::new(RecordingResearch::default()),
                Arc::new(RecordingSourceIntake::default()),
            )),
            Path("composer-request-1".to_owned()),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let replay = Arc::new(RecordingReplay::default());
        let mut api = state(
            Arc::new(RecordingArtifact::default()),
            Arc::new(RecordingResearch::default()),
            Arc::new(RecordingSourceIntake::default()),
        );
        api.exploratory_replay_readback = replay.clone();
        let response = read_exploratory_replay(
            State(api),
            Query(ExploratoryReplayReadbackQueryV2 {
                request_identity: "replay-request-1".to_owned(),
                meaning_digest: format!("sha256:{}", "a".repeat(64)),
            }),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(replay.readback_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn journey_routes_dispatch_only_after_auth_and_identity_validation() {
        let journey = Arc::new(RecordingJourney::default());
        let mut api = state(
            Arc::new(RecordingArtifact::default()),
            Arc::new(RecordingResearch::default()),
            Arc::new(RecordingSourceIntake::default()),
        );
        api.formation_catalog = journey.clone();
        api.iteration_timeline = journey.clone();
        assert_eq!(
            read_formation_catalog(State(api.clone()), nonced_headers())
                .await
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            read_iteration_timeline(
                State(api.clone()),
                Path("bad identity".to_owned()),
                nonced_headers(),
            )
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            read_iteration_timeline(
                State(api),
                Path("trial-family-1".to_owned()),
                nonced_headers(),
            )
            .await
            .status(),
            StatusCode::OK
        );
        assert_eq!(journey.formation_calls.load(Ordering::SeqCst), 1);
        assert_eq!(journey.iteration_calls.load(Ordering::SeqCst), 1);
    }

    #[derive(Default)]
    struct RecordingHistoricalCustody {
        calls: AtomicUsize,
    }

    #[async_trait::async_trait]
    impl HistoricalCustodyOwnerPortV1 for RecordingHistoricalCustody {
        async fn read_historical_custodies(
            &self,
        ) -> Result<HistoricalCustodyQuarantineV1, HistoricalCustodyErrorV1> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(HistoricalCustodyQuarantineV1 {
                schema_version: 1,
                operation: "rd.historical_custody_quarantine.read.v1",
                completeness: HistoricalCustodyCompletenessV1::Complete,
                observed_at_epoch_ms: 1_758_000_000_000,
                research_total: 0,
                artifact_attempt_total: 0,
                binding_total: 0,
                research: Vec::new(),
                artifact_attempts: Vec::new(),
                bindings: Vec::new(),
            })
        }
    }

    /// This route moved here from the write API, so the read side owns its refusal as well as its
    /// answer: without the read API's own credential it must not reach the Owner at all.
    #[tokio::test]
    async fn historical_custody_answers_only_after_auth_and_dispatches_once() {
        let custody = Arc::new(RecordingHistoricalCustody::default());
        let mut api = state(
            Arc::new(RecordingArtifact::default()),
            Arc::new(RecordingResearch::default()),
            Arc::new(RecordingSourceIntake::default()),
        );
        api.historical_custody = custody.clone();
        assert_eq!(
            read_historical_custodies(State(api.clone()), HeaderMap::new())
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(custody.calls.load(Ordering::SeqCst), 0);
        assert_eq!(
            read_historical_custodies(State(api), nonced_headers())
                .await
                .status(),
            StatusCode::OK
        );
        assert_eq!(custody.calls.load(Ordering::SeqCst), 1);
    }

    /// A capability that cannot bind stays unavailable here rather than failing the whole API, and
    /// unavailable has to reach the caller as 503 rather than as an empty successful page.
    #[tokio::test]
    async fn unbound_historical_custody_answers_unavailable() {
        let api = state(
            Arc::new(RecordingArtifact::default()),
            Arc::new(RecordingResearch::default()),
            Arc::new(RecordingSourceIntake::default()),
        );
        assert_eq!(
            read_historical_custodies(State(api), nonced_headers())
                .await
                .status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }

    struct MissingTimeline;

    #[async_trait]
    impl IterationTimelineOwnerPortV1 for MissingTimeline {
        async fn read_iteration_timeline(
            &self,
            _trial_family_identity: &str,
        ) -> Result<IterationTimelineReadbackV1, DashboardReadErrorV1> {
            Err(DashboardReadErrorV1::NotFound)
        }
    }

    /// The three reads stamped from the R&D Owner's clock, each answered through `api`.
    async fn owner_clock_reads(api: &ApiState, headers: &HeaderMap) -> [Response; 3] {
        [
            read_formation_catalog(State(api.clone()), headers.clone()).await,
            read_historical_custodies(State(api.clone()), headers.clone()).await,
            read_iteration_timeline(
                State(api.clone()),
                Path("trial-family-1".to_owned()),
                headers.clone(),
            )
            .await,
        ]
    }

    fn echoed_nonce(response: &Response) -> Vec<&[u8]> {
        response
            .headers()
            .get_all(READ_NONCE_HEADER)
            .iter()
            .map(HeaderValue::as_bytes)
            .collect()
    }

    /// The BFF cannot place these projections in its own request window, because they are stamped
    /// from the Owner's clock, so the echoed nonce is its only proof that an answer is the one it
    /// asked for. The nonce therefore comes back only beside an Owner projection: a read without
    /// exactly one well-formed nonce never reaches the Owner, and a refusal or failure never carries
    /// one, so no answer that is not this request's projection can pass for it.
    #[tokio::test]
    async fn owner_clock_reads_echo_the_request_nonce_only_beside_an_owner_answer() {
        let journey = Arc::new(RecordingJourney::default());
        let custody = Arc::new(RecordingHistoricalCustody::default());
        let mut api = state(
            Arc::new(RecordingArtifact::default()),
            Arc::new(RecordingResearch::default()),
            Arc::new(RecordingSourceIntake::default()),
        );
        api.formation_catalog = journey.clone();
        api.iteration_timeline = journey.clone();
        api.historical_custody = custody.clone();

        for response in owner_clock_reads(&api, &nonced_headers()).await {
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(echoed_nonce(&response), [NONCE.as_bytes()]);
        }
        let calls = |journey: &RecordingJourney, custody: &RecordingHistoricalCustody| {
            [
                journey.formation_calls.load(Ordering::SeqCst),
                custody.calls.load(Ordering::SeqCst),
                journey.iteration_calls.load(Ordering::SeqCst),
            ]
        };
        assert_eq!(calls(&journey, &custody), [1, 1, 1]);

        let mut repeated = nonced_headers();
        repeated.append(READ_NONCE_HEADER, HeaderValue::from_static(NONCE));
        let malformed = [
            "0123456789ABCDEF0123456789ABCDEF",
            "0123456789abcdef0123456789abcde",
            "0123456789abcdef0123456789abcdef0",
            "0123456789abcdef0123456789abcdeg",
            "",
        ];
        let mut refused = vec![headers(), repeated];
        refused.extend(malformed.iter().map(|nonce| {
            let mut headers = headers();
            headers.insert(READ_NONCE_HEADER, HeaderValue::from_static(nonce));
            headers
        }));

        for headers in &refused {
            for response in owner_clock_reads(&api, headers).await {
                assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{headers:?}");
                assert!(echoed_nonce(&response).is_empty());
            }
        }
        assert_eq!(calls(&journey, &custody), [1, 1, 1]);

        let unavailable = state(
            Arc::new(RecordingArtifact::default()),
            Arc::new(RecordingResearch::default()),
            Arc::new(RecordingSourceIntake::default()),
        );

        for response in owner_clock_reads(&unavailable, &nonced_headers()).await {
            assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
            assert!(echoed_nonce(&response).is_empty());
        }
        let mut missing = unavailable;
        missing.iteration_timeline = Arc::new(MissingTimeline);
        let [.., timeline] = owner_clock_reads(&missing, &nonced_headers()).await;
        assert_eq!(timeline.status(), StatusCode::NOT_FOUND);
        assert!(echoed_nonce(&timeline).is_empty());
        let invalid_identity = read_iteration_timeline(
            State(api),
            Path("bad identity".to_owned()),
            nonced_headers(),
        )
        .await;
        assert_eq!(invalid_identity.status(), StatusCode::BAD_REQUEST);
        assert!(echoed_nonce(&invalid_identity).is_empty());
        assert_eq!(calls(&journey, &custody), [1, 1, 1]);
    }

    #[tokio::test]
    async fn artifact_directory_forwards_one_exact_cursor() {
        let artifact = Arc::new(RecordingArtifact::default());
        let response = read_artifact_directory(
            State(state(
                artifact.clone(),
                Arc::new(RecordingResearch::default()),
                Arc::new(RecordingSourceIntake::default()),
            )),
            Query(ArtifactDirectoryQueryV1 {
                limit: Some(7),
                after_prepared_at_epoch_ms: Some(42),
                after_build_request_identity: Some("artifact-build-request-42".to_string()),
            }),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            artifact.request.lock().expect("request lock").clone(),
            Some((
                Some(ArtifactDirectoryCursorV1 {
                    prepared_at_epoch_ms: 42,
                    build_request_identity: "artifact-build-request-42".to_string(),
                }),
                7,
            )),
        );
    }

    #[tokio::test]
    async fn invalid_requests_fail_before_owner_dispatch() {
        let artifact = Arc::new(RecordingArtifact::default());
        let research = Arc::new(RecordingResearch::default());
        let source_intake = Arc::new(RecordingSourceIntake::default());
        let api = state(artifact.clone(), research.clone(), source_intake.clone());
        let response = read_artifact_source(
            State(api.clone()),
            Path(("invalid identity".to_string(), "attempt-1".to_string())),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let response = read_artifact(
            State(api.clone()),
            Path(("invalid identity".to_owned(), "attempt-1".to_owned())),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let response = read_research_directory(
            State(api.clone()),
            Query(ResearchDirectoryQueryV1 {
                limit: None,
                after_committed_at_epoch_ms: Some(42),
                after_request_identity: None,
            }),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let response = read_artifact_directory(
            State(api.clone()),
            Query(ArtifactDirectoryQueryV1 {
                limit: Some(21),
                after_prepared_at_epoch_ms: None,
                after_build_request_identity: None,
            }),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let response = read_research_directory(
            State(api.clone()),
            Query(ResearchDirectoryQueryV1 {
                limit: Some(20),
                after_committed_at_epoch_ms: Some(42),
                after_request_identity: Some("short".to_string()),
            }),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let response =
            read_source_intake(State(api), Path("bad identity".to_string()), headers()).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(artifact.directory_calls.load(Ordering::SeqCst), 0);
        assert_eq!(artifact.readback_calls.load(Ordering::SeqCst), 0);
        assert_eq!(artifact.source_calls.load(Ordering::SeqCst), 0);
        assert_eq!(research.directory_calls.load(Ordering::SeqCst), 0);
        assert_eq!(source_intake.readback_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn valid_artifact_source_dispatches_once_and_preserves_missing() {
        let artifact = Arc::new(RecordingArtifact::default());
        let response = read_artifact_source(
            State(state(
                artifact.clone(),
                Arc::new(RecordingResearch::default()),
                Arc::new(RecordingSourceIntake::default()),
            )),
            Path(("build-1".to_string(), "attempt-1".to_string())),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(artifact.source_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn valid_artifact_readback_dispatches_once_and_preserves_unknown() {
        let artifact = Arc::new(RecordingArtifact::default());
        let response = read_artifact(
            State(state(
                artifact.clone(),
                Arc::new(RecordingResearch::default()),
                Arc::new(RecordingSourceIntake::default()),
            )),
            Path(("build-1".to_owned(), "attempt-1".to_owned())),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(artifact.readback_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn valid_source_intake_readback_dispatches_once_and_preserves_unknown() {
        let source_intake = Arc::new(RecordingSourceIntake::default());
        let response = read_source_intake(
            State(state(
                Arc::new(RecordingArtifact::default()),
                Arc::new(RecordingResearch::default()),
                source_intake.clone(),
            )),
            Path("source-request-1".to_string()),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        assert_eq!(
            response.headers().get("x-rd-rejection-code"),
            Some(&HeaderValue::from_static("OWNER_OUTCOME_UNKNOWN")),
        );
        assert_eq!(source_intake.readback_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn missing_source_intake_adapter_fails_closed() {
        let artifact = Arc::new(RecordingArtifact::default());
        let research = Arc::new(RecordingResearch::default());
        let mut api = state(
            artifact,
            research,
            Arc::new(RecordingSourceIntake::default()),
        );
        api.source_intake_readback = None;
        let response =
            read_source_intake(State(api), Path("source-request-1".to_string()), headers()).await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn valid_composer_readback_dispatches_once_and_preserves_terminal_status() {
        let composer = Arc::new(RecordingComposer::default());
        let mut api = state(
            Arc::new(RecordingArtifact::default()),
            Arc::new(RecordingResearch::default()),
            Arc::new(RecordingSourceIntake::default()),
        );
        api.composer_readback = Some(composer.clone());
        let response =
            read_develop_composer(State(api), Path("composer-request-1".to_owned()), headers())
                .await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(composer.readback_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn missing_composer_adapter_fails_closed() {
        let mut api = state(
            Arc::new(RecordingArtifact::default()),
            Arc::new(RecordingResearch::default()),
            Arc::new(RecordingSourceIntake::default()),
        );
        api.composer_readback = None;
        let response =
            read_develop_composer(State(api), Path("composer-request-1".to_owned()), headers())
                .await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn replay_readback_validates_selector_and_dispatches_once() {
        let replay = Arc::new(RecordingReplay::default());
        let mut api = state(
            Arc::new(RecordingArtifact::default()),
            Arc::new(RecordingResearch::default()),
            Arc::new(RecordingSourceIntake::default()),
        );
        api.exploratory_replay_readback = replay.clone();

        let invalid = read_exploratory_replay(
            State(api.clone()),
            Query(ExploratoryReplayReadbackQueryV2 {
                request_identity: " replay-request-1".to_owned(),
                meaning_digest: format!("sha256:{}", "a".repeat(64)),
            }),
            headers(),
        )
        .await;
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
        assert_eq!(replay.readback_calls.load(Ordering::SeqCst), 0);

        let unavailable = read_exploratory_replay(
            State(api),
            Query(ExploratoryReplayReadbackQueryV2 {
                request_identity: "replay-request-1".to_owned(),
                meaning_digest: format!("sha256:{}", "a".repeat(64)),
            }),
            headers(),
        )
        .await;
        assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(replay.readback_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn replay_result_readback_binds_all_three_locator_fields() {
        let replay = Arc::new(RecordingReplay::default());
        let mut api = state(
            Arc::new(RecordingArtifact::default()),
            Arc::new(RecordingResearch::default()),
            Arc::new(RecordingSourceIntake::default()),
        );
        api.exploratory_replay_result_readback = replay.clone();

        let invalid = read_exploratory_replay_result(
            State(api.clone()),
            Path(ExploratoryReplayResultPathV2 {
                result_identity: "result-1".to_owned(),
            }),
            Query(ExploratoryReplayResultQueryV2 {
                request_identity: " invalid-request-identity".to_owned(),
                attempt_identity: "attempt-1".to_owned(),
            }),
            headers(),
        )
        .await;
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
        assert_eq!(replay.result_calls.load(Ordering::SeqCst), 0);

        let response = read_exploratory_replay_result(
            State(api),
            Path(ExploratoryReplayResultPathV2 {
                result_identity: "result-1".to_owned(),
            }),
            Query(ExploratoryReplayResultQueryV2 {
                request_identity: "request-1".to_owned(),
                attempt_identity: "attempt-1".to_owned(),
            }),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(replay.result_calls.load(Ordering::SeqCst), 1);
    }

    async fn run_report(
        answer: BacktestRunReportAnswerV1,
        request_identity: &str,
        headers: HeaderMap,
    ) -> (StatusCode, Vec<u8>, Vec<(String, String, String)>) {
        let owner = RecordingRunReport::answering(answer);
        let mut api = state(
            Arc::new(RecordingArtifact::default()),
            Arc::new(RecordingResearch::default()),
            Arc::new(RecordingSourceIntake::default()),
        );
        api.backtest_run_report = owner.clone();
        let response = read_backtest_run_report(
            State(api),
            Path(ExploratoryReplayResultPathV2 {
                result_identity: "result-1".to_owned(),
            }),
            Query(ExploratoryReplayResultQueryV2 {
                request_identity: request_identity.to_owned(),
                attempt_identity: "attempt-1".to_owned(),
            }),
            headers,
        )
        .await;
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .unwrap()
            .to_vec();
        (status, body, owner.locators())
    }

    #[tokio::test]
    async fn run_report_asks_the_owner_only_for_an_authorized_exact_locator() {
        let report = BacktestRunReportAnswerV1::Report(b"{}".to_vec());
        let (status, _, locators) = run_report(report.clone(), "request-1", HeaderMap::new()).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert!(locators.is_empty());

        let (status, _, locators) = run_report(report.clone(), " request-1", headers()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(locators.is_empty());

        let (_, _, locators) = run_report(report, "request-1", headers()).await;
        assert_eq!(
            locators,
            vec![(
                "result-1".to_owned(),
                "request-1".to_owned(),
                "attempt-1".to_owned()
            )]
        );
    }

    #[tokio::test]
    async fn run_report_relays_each_owner_answer_and_adds_nothing() {
        let projection = br#"{"state":"EMPTY","run":{"result_identity":"result-1"}}"#.to_vec();
        let (status, body, _) = run_report(
            BacktestRunReportAnswerV1::Report(projection.clone()),
            "request-1",
            headers(),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, projection);

        for (answer, expected_status, reason) in [
            (
                BacktestRunReportAnswerV1::Absent,
                StatusCode::NOT_FOUND,
                BACKTEST_RUN_ABSENT_V1,
            ),
            (
                BacktestRunReportAnswerV1::Refused("NON_FINITE_VALUE"),
                StatusCode::SERVICE_UNAVAILABLE,
                "NON_FINITE_VALUE",
            ),
        ] {
            let (status, body, _) = run_report(answer, "request-1", headers()).await;
            assert_eq!(status, expected_status);
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
                serde_json::json!({ "state": "UNAVAILABLE", "reason": reason })
            );
        }

        let (status, body, _) = run_report(
            BacktestRunReportAnswerV1::Unavailable,
            "request-1",
            headers(),
        )
        .await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert!(body.is_empty(), "no Owner answer means no reason to relay");
    }

    #[tokio::test]
    async fn historical_replay_rejection_requires_auth_and_exact_selector() {
        let replay = Arc::new(RecordingReplay::default());
        let mut api = state(
            Arc::new(RecordingArtifact::default()),
            Arc::new(RecordingResearch::default()),
            Arc::new(RecordingSourceIntake::default()),
        );
        api.exploratory_replay_historical_rejection_readback = replay.clone();
        let query = || ExploratoryReplayHistoricalRejectionQueryV1 {
            request_identity: "historical-replay-request-v1".to_owned(),
            attempt_identity: "historical-replay-attempt-v1".to_owned(),
            semantic_digest: format!("sha256:{}", "a".repeat(64)),
        };

        let forbidden = read_exploratory_replay_historical_rejection(
            State(api.clone()),
            Query(query()),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
        assert_eq!(replay.historical_rejection_calls.load(Ordering::SeqCst), 0);

        let invalid = read_exploratory_replay_historical_rejection(
            State(api.clone()),
            Query(ExploratoryReplayHistoricalRejectionQueryV1 {
                semantic_digest: format!("blake3:{}", "a".repeat(64)),
                ..query()
            }),
            headers(),
        )
        .await;
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
        assert_eq!(replay.historical_rejection_calls.load(Ordering::SeqCst), 0);

        let missing =
            read_exploratory_replay_historical_rejection(State(api), Query(query()), headers())
                .await;
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
        assert_eq!(replay.historical_rejection_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    #[ignore = "requires the canonical Backtest result commit immediately before this Dashboard consumer"]
    async fn replay_result_dashboard_read_api_returns_exact_canonical_bytes() {
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = test_database.mutation();
        let aggregate = sqlx::query(
            "SELECT result.result_identity, result.request_identity, result.attempt_identity,
                    result.canonical_bytes AS result_bytes
               FROM public.backtest_replay_results_v2 result
              WHERE result.request_identity='request' AND result.attempt_identity='attempt'",
        )
        .fetch_one(mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner))
        .await
        .expect("canonical Backtest commit fixture must precede the Dashboard consumer");
        let result_identity: String = aggregate.try_get("result_identity").unwrap();
        let request_identity: String = aggregate.try_get("request_identity").unwrap();
        let attempt_identity: String = aggregate.try_get("attempt_identity").unwrap();
        let result_bytes: Vec<u8> = aggregate.try_get("result_bytes").unwrap();
        let owner = Arc::new(
            PostgresExploratoryReplayReadbackOwnerV2::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            )
            .await
            .unwrap(),
        );
        let mut api = state(
            Arc::new(RecordingArtifact::default()),
            Arc::new(RecordingResearch::default()),
            Arc::new(RecordingSourceIntake::default()),
        );
        api.exploratory_replay_result_readback = owner;

        let response = read_exploratory_replay_result(
            State(api.clone()),
            Path(ExploratoryReplayResultPathV2 {
                result_identity: result_identity.clone(),
            }),
            Query(ExploratoryReplayResultQueryV2 {
                request_identity: request_identity.clone(),
                attempt_identity: attempt_identity.clone(),
            }),
            headers(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), result_bytes.len() + 1)
            .await
            .unwrap();
        assert_eq!(body.as_ref(), result_bytes.as_slice());

        let cross_spliced = read_exploratory_replay_result(
            State(api),
            Path(ExploratoryReplayResultPathV2 { result_identity }),
            Query(ExploratoryReplayResultQueryV2 {
                request_identity: "cross-spliced-request".to_owned(),
                attempt_identity,
            }),
            headers(),
        )
        .await;
        assert_eq!(cross_spliced.status(), StatusCode::NOT_FOUND);
    }

    /// The code of the Owner's judgement about a run's report, or `None` when the answer is
    /// anything else.
    ///
    /// Which refusals are the Owner's conclusion about the run, rather than a failure to read it,
    /// is the Owner's to say: `BacktestRunReportRefusalV1::is_owner_judgement` lists every variant
    /// with no wildcard arm. A report, an absent run, and a failed transaction, snapshot or storage
    /// read are not judgements, so an acceptance that took them as "the Owner refused" would go
    /// green on a database hiccup.
    fn owner_judgement_code(
        answer: &Result<Option<BacktestRunReportProjectionV1>, BacktestRunReportRefusalV1>,
    ) -> Option<&'static str> {
        match answer {
            Err(refusal) if refusal.is_owner_judgement() => Some(refusal.code()),
            _ => None,
        }
    }

    #[rstest]
    fn only_the_owners_judgement_counts_as_its_code() {
        for (judgement, code) in [
            (
                BacktestRunReportRefusalV1::OutcomeEvidenceRefused(
                    BacktestReadbackRefusalV1::SemanticTraceAbsent,
                ),
                "SEMANTIC_TRACE_ABSENT",
            ),
            (
                BacktestRunReportRefusalV1::NoStrategyStatementForFamily,
                "NO_STRATEGY_STATEMENT_FOR_FAMILY",
            ),
        ] {
            assert_eq!(owner_judgement_code(&Err(judgement)), Some(code));
        }

        // Negative controls: each of these reaches the page as a code, and none is a judgement.
        for answer in [
            Err(BacktestRunReportRefusalV1::OutcomeEvidenceUnavailable(
                "storage unavailable".to_owned(),
            )),
            Err(BacktestRunReportRefusalV1::ReadTransactionUnavailable(
                "could not serialize".to_owned(),
            )),
            Err(BacktestRunReportRefusalV1::ReportSnapshotUnavailable(1)),
            Err(BacktestRunReportRefusalV1::ReplayRequestUnavailable(
                "storage unavailable".to_owned(),
            )),
            Err(BacktestRunReportRefusalV1::FrozenDesignUnavailable),
            Ok(None),
        ] {
            assert_eq!(owner_judgement_code(&answer), None, "{answer:?}");
        }
    }

    /// The environment names the deployed read API is given, read from its compose service.
    ///
    /// `RUST_LOG` is logging, not composition. A name added to that service without the chain
    /// answering it would leave this entry composing less than deployment does, so the comparison
    /// that uses this fails instead.
    fn deployed_read_api_environment_names() -> std::collections::BTreeSet<&'static str> {
        const COMPOSE: &str = include_str!("../../../../product/rd-workbench/docker-compose.yml");
        let service = COMPOSE
            .split("\n  rd-dashboard-owner-read-api:\n")
            .nth(1)
            .expect("the compose file defines the read API service");
        let environment = service
            .split("\n    environment:\n")
            .nth(1)
            .expect("the read API service has an environment");
        environment
            .lines()
            .take_while(|line| line.starts_with("      "))
            .filter_map(|line| {
                let line = line.trim_start();
                line.split_once(':').map(|(name, _)| name).filter(|name| {
                    !name.is_empty() && name.bytes().all(|b| b.is_ascii_uppercase() || b == b'_')
                })
            })
            .filter(|name| *name != "RUST_LOG")
            .collect()
    }

    #[rstest]
    fn the_deployed_read_api_is_given_four_composition_inputs() {
        assert_eq!(
            deployed_read_api_environment_names(),
            [
                "RD_DASHBOARD_OWNER_READ_API_TOKEN",
                "RD_DASHBOARD_OWNER_READ_DATABASE_URL",
                "RD_DASHBOARD_SOURCE_INTAKE_PRODUCT_EDGE_DATABASE_URL",
                "RD_DASHBOARD_SOURCE_INTAKE_REQUEST_PROOF",
            ]
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>()
        );
    }

    #[rstest]
    fn the_read_api_configuration_binds_source_intake_only_from_a_whole_pair() {
        const OWNER: [(&str, &str); 2] = [
            ("RD_DASHBOARD_OWNER_READ_DATABASE_URL", "postgres://owner"),
            ("RD_DASHBOARD_OWNER_READ_API_TOKEN", "read-token"),
        ];
        const HALF_PAIR: [(&str, &str); 3] = [
            OWNER[0],
            OWNER[1],
            (
                "RD_DASHBOARD_SOURCE_INTAKE_PRODUCT_EDGE_DATABASE_URL",
                "postgres://edge",
            ),
        ];
        const WHOLE_PAIR: [(&str, &str); 4] = [
            OWNER[0],
            OWNER[1],
            HALF_PAIR[2],
            ("RD_DASHBOARD_SOURCE_INTAKE_REQUEST_PROOF", "proof"),
        ];
        const EMPTY_TOKEN: [(&str, &str); 2] =
            [OWNER[0], ("RD_DASHBOARD_OWNER_READ_API_TOKEN", " ")];
        let lookup = |pairs: &'static [(&'static str, &'static str)]| {
            move |name: &str| {
                pairs
                    .iter()
                    .find(|(candidate, _)| *candidate == name)
                    .map(|(_, value)| (*value).to_string())
            }
        };

        let owner_only = DashboardReadApiConfigV1::from_lookup(lookup(&OWNER)).unwrap();
        assert!(owner_only.source_intake.is_none());
        assert_eq!(owner_only.bind, "0.0.0.0:8082");
        assert!(
            DashboardReadApiConfigV1::from_lookup(lookup(&HALF_PAIR))
                .unwrap()
                .source_intake
                .is_none()
        );
        let bound = DashboardReadApiConfigV1::from_lookup(lookup(&WHOLE_PAIR))
            .unwrap()
            .source_intake
            .expect("a whole pair binds Source Intake");
        assert_eq!(bound.product_edge_database_url, "postgres://edge");
        assert_eq!(bound.request_proof, "proof");

        for pairs in [&OWNER[..1], &EMPTY_TOKEN[..]] {
            assert!(DashboardReadApiConfigV1::from_lookup(lookup(pairs)).is_err());
        }
    }

    /// One exploratory result and the selector the `/backtest` workbench opens it with.
    struct OpenableResult {
        result_identity: String,
        request_identity: String,
        meaning_digest: String,
        attempt_identity: String,
    }

    /// What the request readback answered: its status and, beside a 200, the Owner's availability.
    #[derive(Debug, PartialEq, Eq)]
    struct RequestLayer {
        status: StatusCode,
        availability: Option<String>,
    }

    impl RequestLayer {
        /// The page opens a request only when the Owner states it `AVAILABLE`. A 200 alone is not
        /// that: the Owner answers 200 with `UNAVAILABLE` for a request it holds no sealed custody
        /// for, and the page renders that as unavailable, so the result rail never appears.
        fn opens(&self) -> bool {
            self.status == StatusCode::OK && self.availability.as_deref() == Some("AVAILABLE")
        }
    }

    /// Asks the production handlers whether the workbench can open this result: the request
    /// readback first, then the result readback. The report mounts only beneath an opened result,
    /// so a run neither of these answers is a run the page cannot reach.
    async fn workbench_opens(
        api: &ApiState,
        candidate: &OpenableResult,
    ) -> (RequestLayer, StatusCode) {
        let response = read_exploratory_replay(
            State(api.clone()),
            Query(ExploratoryReplayReadbackQueryV2 {
                request_identity: candidate.request_identity.clone(),
                meaning_digest: candidate.meaning_digest.clone(),
            }),
            headers(),
        )
        .await;
        let status = response.status();
        let availability = if status == StatusCode::OK {
            let body = axum::body::to_bytes(response.into_body(), 1 << 20)
                .await
                .unwrap();
            let body = serde_json::from_slice::<serde_json::Value>(&body).unwrap();
            Some(
                body["projection"]["availability"]
                    .as_str()
                    .expect("a request readback states its availability")
                    .to_owned(),
            )
        } else {
            None
        };
        let request = RequestLayer {
            status,
            availability,
        };
        let result = read_exploratory_replay_result(
            State(api.clone()),
            Path(ExploratoryReplayResultPathV2 {
                result_identity: candidate.result_identity.clone(),
            }),
            Query(ExploratoryReplayResultQueryV2 {
                request_identity: candidate.request_identity.clone(),
                attempt_identity: candidate.attempt_identity.clone(),
            }),
            headers(),
        )
        .await
        .status();
        (request, result)
    }

    async fn report_relation_counts(pool: &sqlx::PgPool, rd_pool: &sqlx::PgPool) -> [i64; 3] {
        let count = |sql: &'static str, pool: &sqlx::PgPool| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(sql)
                    .fetch_one(&pool)
                    .await
                    .unwrap()
            }
        };
        [
            count(
                "SELECT COUNT(*) FROM public.backtest_replay_results_v2",
                pool,
            )
            .await,
            count(
                "SELECT COUNT(*) FROM public.backtest_native_replay_outcome_evidence_v1",
                pool,
            )
            .await,
            count(
                "SELECT COUNT(*) FROM public.rd_sealed_exploratory_replay_requests_v1",
                rd_pool,
            )
            .await,
        ]
    }

    /// Full-route acceptance of the single-run report on `/backtest`, through the production read
    /// API composition, a production Dashboard build and a real browser.
    ///
    /// It proves the unavailable state from a real Owner reason: a result the workbench can open,
    /// committed without outcome evidence, which the Backtest Owner refuses under its own code. It
    /// then opens the run the preceding chain entry committed from a real engine run, which the
    /// Owner refuses too: its program is not one the single-threshold family authors, so the Owner
    /// states no strategy for it. That run's engine bytes are real, but its input is constructed
    /// quotes and it reached custody through a test writer, not through a production-produced run.
    /// This entry must follow that one.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires the ordered chain's committed run report, Dashboard dependencies and Chrome acceptance admission"]
    async fn backtest_run_report_browser_acceptance_reads_the_owner_answer() {
        if std::env::var("DASHBOARD_STRATEGY_VIEWER_BROWSER_ACCEPTANCE").as_deref() != Ok("1") {
            return;
        }
        let browser_executable = std::env::var("DASHBOARD_STRATEGY_VIEWER_BROWSER_EXECUTABLE")
            .expect("explicit browser executable is required");
        let acceptance_candidate = std::env::var("DASHBOARD_STRATEGY_VIEWER_ACCEPTANCE_CANDIDATE")
            .expect("exact committed Dashboard candidate is required");
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = test_database.mutation();
        let backtest_pool = mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner);
        let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);

        let run_rows = sqlx::query(
            "SELECT result_identity, request_identity, request_meaning_digest, attempt_identity
               FROM public.backtest_native_replay_outcome_evidence_v1
              WHERE attempt_identity LIKE 'backtest-attempt-run-report-%'",
        )
        .fetch_all(backtest_pool)
        .await
        .unwrap();
        assert_eq!(
            run_rows.len(),
            1,
            "the preceding chain entry commits exactly one run for the report"
        );
        let openable = |row: &sqlx::postgres::PgRow| OpenableResult {
            result_identity: row.try_get("result_identity").unwrap(),
            request_identity: row.try_get("request_identity").unwrap(),
            meaning_digest: row.try_get("request_meaning_digest").unwrap(),
            attempt_identity: row.try_get("attempt_identity").unwrap(),
        };
        let run = openable(&run_rows[0]);

        // Composed by the binary's own rule: `from_lookup` is what `from_environment` reads the
        // deployment through, and the chain answers the same names the deployed service is given
        // (the `rd-dashboard-owner-read-api` environment in product/rd-workbench/docker-compose.yml,
        // checked below). The request proof is the chain's own; this entry reads no Source Intake.
        let read_token = "rd-dashboard-read-run-report-acceptance";
        let read_environment = [
            (
                "RD_DASHBOARD_OWNER_READ_DATABASE_URL",
                test_database
                    .database_url(CanonicalOwnerTestRoleV1::RdOwner)
                    .to_string(),
            ),
            ("RD_DASHBOARD_OWNER_READ_API_TOKEN", read_token.to_string()),
            (
                "RD_DASHBOARD_SOURCE_INTAKE_PRODUCT_EDGE_DATABASE_URL",
                test_database
                    .database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner)
                    .to_string(),
            ),
            (
                "RD_DASHBOARD_SOURCE_INTAKE_REQUEST_PROOF",
                "rd-owner-api-run-report-acceptance".to_string(),
            ),
        ];
        assert_eq!(
            read_environment
                .iter()
                .map(|(name, _)| *name)
                .collect::<std::collections::BTreeSet<_>>(),
            deployed_read_api_environment_names(),
            "the chain answers exactly the names the deployed read API is given"
        );
        let api = dashboard_read_api::compose_state(
            &DashboardReadApiConfigV1::from_lookup(|name| {
                read_environment
                    .iter()
                    .find(|(candidate, _)| *candidate == name)
                    .map(|(_, value)| value.clone())
            })
            .unwrap(),
        )
        .await
        .unwrap();
        // Every optional port the deployment binds binds here too, so this entry serves the
        // deployed composition rather than a narrower one.
        assert!(
            api.source_intake_readback.is_some(),
            "Source Intake readback binds as it does in deployment"
        );
        let mut probe = api.clone();
        probe.token_digest = Sha256::digest(b"test-token").into();

        // Two layers stand between the page and the report. Each is asserted on its own, so a run
        // the page cannot reach names the layer that stopped it instead of reading as a report
        // that did not appear.
        let (request_layer, result_layer) = workbench_opens(&probe, &run).await;
        assert!(
            request_layer.opens(),
            "layer 1: the request readback does not open the committed run's request: \
             {request_layer:?}"
        );
        assert_eq!(
            result_layer,
            StatusCode::OK,
            "layer 2: the result readback does not open the committed run's result"
        );

        // A result the workbench opens but that carries no outcome evidence, and that the Backtest
        // Owner's custody itself refuses by name. The expected code is read from the Owner here, so
        // the browser is held to the Owner's own judgement rather than to a list of codes that are
        // not the Dashboard's: a storage or connection failure also yields a code outside that list.
        let owner = PostgresExploratoryReplayReadbackOwnerV2::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
        )
        .await
        .unwrap();
        let without_evidence = sqlx::query(
            "SELECT result.result_identity, result.request_identity,
                    result.request_meaning_digest, result.attempt_identity
               FROM public.backtest_replay_results_v2 result
              WHERE NOT EXISTS (
                    SELECT 1 FROM public.backtest_native_replay_outcome_evidence_v1 evidence
                     WHERE evidence.result_identity = result.result_identity)
              ORDER BY result.result_identity",
        )
        .fetch_all(backtest_pool)
        .await
        .unwrap();
        let mut refused = None;

        for row in &without_evidence {
            let candidate = openable(row);
            let (request_layer, result_layer) = workbench_opens(&probe, &candidate).await;

            if !request_layer.opens() || result_layer != StatusCode::OK {
                continue;
            }
            let answer = owner
                .resolve_backtest_run_report_v1(ExploratoryReplayResultLocatorV2 {
                    result_identity: &candidate.result_identity,
                    request_identity: &candidate.request_identity,
                    attempt_identity: &candidate.attempt_identity,
                })
                .await;

            if let Some(code) = owner_judgement_code(&answer) {
                refused = Some((candidate, code));
                break;
            }
        }
        let (refused, refused_code) = refused.unwrap_or_else(|| {
            panic!(
                "none of the {} results committed without outcome evidence both opens in the \
                 workbench and is refused by the Owner's judgement, so no real Owner refusal is \
                 reachable from the page",
                without_evidence.len()
            )
        });

        // The committed run's answer, read from the Owner the same way. It must be the Owner's
        // judgement about the run: a transaction or storage failure also arrives as a code, and a
        // browser held to that code would pass on a database hiccup.
        let run_answer = owner
            .resolve_backtest_run_report_v1(ExploratoryReplayResultLocatorV2 {
                result_identity: &run.result_identity,
                request_identity: &run.request_identity,
                attempt_identity: &run.attempt_identity,
            })
            .await;
        let run_code = owner_judgement_code(&run_answer).unwrap_or_else(|| {
            panic!("the committed run's report is not an Owner refusal: {run_answer:?}")
        });

        let before = report_relation_counts(backtest_pool, rd_pool).await;
        let read_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let read_address = read_listener.local_addr().unwrap();
        let read_server = tokio::spawn(async move {
            axum::serve(read_listener, dashboard_read_api::router(api)).await
        });
        let dashboard_root =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../product/dashboard");
        let mut browser = std::process::Command::new("node");
        browser
            .arg("--test")
            .arg("tests/backtest-run-report.browser.test.mjs")
            .current_dir(&dashboard_root)
            .env("DASHBOARD_STRATEGY_VIEWER_BROWSER_ACCEPTANCE", "1")
            // The same override entry 28 sets, for the same reason: the Dashboard's eight second
            // Owner-read budget is a promise about a deployment, and on a shared acceptance runner
            // it measures the runner's load. The gateway announces it whenever it is in force.
            .env("DASHBOARD_OWNER_READ_TIMEOUT_OVERRIDE_MS", "25000")
            .env(
                "DASHBOARD_STRATEGY_VIEWER_ACCEPTANCE_CANDIDATE",
                acceptance_candidate,
            )
            .env(
                "DASHBOARD_STRATEGY_VIEWER_BROWSER_EXECUTABLE",
                browser_executable,
            )
            .env(
                "RD_DASHBOARD_OWNER_READ_API_URL",
                format!("http://{read_address}/"),
            )
            .env("RD_DASHBOARD_OWNER_READ_API_TOKEN", read_token)
            .env("DASHBOARD_RUN_REPORT_REFUSED_OWNER_CODE", refused_code)
            .env("DASHBOARD_RUN_REPORT_RUN_OWNER_CODE", run_code);

        for (prefix, selected) in [("RUN", &run), ("REFUSED", &refused)] {
            browser
                .env(
                    format!("DASHBOARD_RUN_REPORT_{prefix}_RESULT_IDENTITY"),
                    &selected.result_identity,
                )
                .env(
                    format!("DASHBOARD_RUN_REPORT_{prefix}_REQUEST_IDENTITY"),
                    &selected.request_identity,
                )
                .env(
                    format!("DASHBOARD_RUN_REPORT_{prefix}_MEANING_DIGEST"),
                    &selected.meaning_digest,
                )
                .env(
                    format!("DASHBOARD_RUN_REPORT_{prefix}_ATTEMPT_IDENTITY"),
                    &selected.attempt_identity,
                );
        }
        // Waiting on the child off the worker pool keeps both workers serving the page's reads.
        let browser_status = tokio::task::spawn_blocking(move || browser.status())
            .await
            .expect("the browser acceptance wait joins")
            .unwrap();
        read_server.abort();
        let _ = read_server.await;

        let after = report_relation_counts(backtest_pool, rd_pool).await;
        assert!(browser_status.success());
        assert_eq!(
            after, before,
            "reading the report wrote to an Owner relation"
        );
    }
}
