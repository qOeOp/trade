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
    };
    use sha2::{Digest, Sha256};
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
    use vibe_strategy_factory_rd_owner_api::dashboard_read_api::{
        ApiState, ArtifactDirectoryQueryV1, ExploratoryReplayHistoricalRejectionOwnerPortV1,
        ExploratoryReplayHistoricalRejectionQueryV1, ExploratoryReplayReadbackOwnerPortV2,
        ExploratoryReplayReadbackQueryV2, ExploratoryReplayResultPathV2,
        ExploratoryReplayResultQueryV2, ExploratoryReplayResultReadbackOwnerPortV2,
        ResearchDirectoryQueryV1, UnavailableDashboardJourneyReadbackV1,
        UnavailableHistoricalCustodyV1, read_artifact, read_artifact_directory,
        read_artifact_source, read_develop_composer, read_exploratory_replay,
        read_exploratory_replay_historical_rejection, read_exploratory_replay_result,
        read_formation_catalog, read_historical_custodies, read_iteration_timeline,
        read_research_directory, read_research_v2, read_source_intake,
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
            token_digest: Sha256::digest(b"test-token").into(),
        }
    }

    fn headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer test-token"));
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
            read_formation_catalog(State(api.clone()), headers())
                .await
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            read_iteration_timeline(
                State(api.clone()),
                Path("bad identity".to_owned()),
                headers(),
            )
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            read_iteration_timeline(State(api), Path("trial-family-1".to_owned()), headers(),)
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
            read_historical_custodies(State(api), headers())
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
            read_historical_custodies(State(api), headers())
                .await
                .status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
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
}
