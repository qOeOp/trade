//! Custody and issuance of a V3 Research Intent's initial PIT request.
//!
//! R&D states the scope's fixed-member rule to Market Data's Universe Selection intake, freezes the
//! PIT submission for the selection Market Data recorded, sends it to the PIT intake and records
//! the terminal against the one attempt that seals to it. Market Data is reached through its two
//! admission ports, the same pair its own routes serve, so it runs on its own pool and in its own
//! transactions and R&D hands it only untrusted input. Its two reads of the scope and of the
//! correlation run in this Owner's transaction, as Market Data's read surface provides.
//!
//! Attempts are appended, never rewritten, and every attempt of an Intent carries one correlation.
//! Market Data commits at most one initial intake per correlation, so an Intent has at most one
//! initial PIT request. A send that got no answer is resolved by reading back by correlation, not
//! by sending again: once Market Data's clock head has moved, the frozen bytes no longer rejoin.

use std::sync::Arc;

use async_trait::async_trait;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use thiserror::Error;
use vibe_data::owner::{
    pit_market_snapshot_intake_v1::{
        PitMarketSnapshotBlockerV1, PitMarketSnapshotDispositionV1, PitMarketSnapshotIntakeErrorV1,
        PitMarketSnapshotIntakeV1, PitMarketSnapshotTerminalV1,
    },
    pit_snapshot::PitSnapshotSubmissionV1,
    research_instrument_scope_v1::ResearchInstrumentScopeV1,
    research_pit_references_v1::{ResearchPitReferencesErrorV1, ResearchPitReferencesV1},
    research_pit_terminal_v1::{ResearchPitIntakeTerminalV1, ResearchPitTerminalReadErrorV1},
    source_binding::BindingDigest,
    universe_selection::{
        UntrustedUniverseSelectionLocatorV1, UntrustedUniverseSelectionRequestV1,
    },
    universe_selection_admission_v1::{
        UniverseSelectionAdmissionErrorV1, UniverseSelectionAdmissionV1,
        UniverseSelectionTerminalV1,
    },
};

use super::{PostgresResearchGoalOwnerV1, owner_clock_epoch_ms_in_transaction, storage};
use crate::{
    develop_composer_v2::{research_intent_identity_v2, research_request_identity_v2},
    product_edge::{FrozenResearchGoalIntent, ResearchGoalOwnerError, ResearchRequestDisposition},
    rd_owner_postgres_custody::{
        ResearchCustodyLookupV1, VerifiedResearchCustodyV1, admit_research_custody_in_transaction,
    },
    research_initial_pit_v1::{
        FrozenInitialPitAttemptV1, InitialPitAttributionErrorV1, InitialPitSubjectV1,
        ResearchInitialPitV1, attribute_initial_pit_terminal_v1, pit_submission_v1,
        universe_selection_request_v1,
    },
    storage_diagnostic,
};

pub(crate) const TABLES: &[crate::schema_materialization::PublicTableSpec] = &[
    crate::schema_materialization::PublicTableSpec {
        name: "rd_research_initial_pit_attempts_v1",
        runtime_read_grantees: &[],
        columns: &[
            crate::schema_materialization::required("request_identity", "text"),
            crate::schema_materialization::required("attempt_ordinal", "integer"),
            crate::schema_materialization::required("correlation_identity", "bytea"),
            crate::schema_materialization::required("universe_selection_request_identity", "bytea"),
            crate::schema_materialization::required(
                "universe_selection_request_meaning_digest",
                "bytea",
            ),
            crate::schema_materialization::required("submission_bytes", "bytea"),
            crate::schema_materialization::required("submission_digest", "bytea"),
            crate::schema_materialization::required("frozen_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "f:request_identity:public.rd_research_request_receipts_v1(request_identity):a:a:s:false:false:true:",
            "p:request_identity,attempt_ordinal:::false:false:true:",
            "u:request_identity,submission_digest:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("request_identity,attempt_ordinal"),
            crate::schema_materialization::unique_index("request_identity,submission_digest"),
        ],
    },
    crate::schema_materialization::PublicTableSpec {
        name: "rd_research_initial_pit_terminals_v1",
        runtime_read_grantees: &[],
        columns: &[
            crate::schema_materialization::required("request_identity", "text"),
            crate::schema_materialization::required("attempt_ordinal", "integer"),
            crate::schema_materialization::required("pit_request_identity", "bytea"),
            crate::schema_materialization::required("pit_request_digest", "bytea"),
            crate::schema_materialization::required("instrument_master_digest", "bytea"),
            crate::schema_materialization::required("snapshot_identity", "bytea"),
            crate::schema_materialization::required("fact_digest", "bytea"),
            crate::schema_materialization::required("disposition", "text"),
            crate::schema_materialization::optional("primary_blocker", "text"),
            crate::schema_materialization::required("recorded_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "f:request_identity,attempt_ordinal:public.rd_research_initial_pit_attempts_v1(request_identity,attempt_ordinal):a:a:s:false:false:true:",
            "p:request_identity:::false:false:true:",
        ],
        indexes: &[crate::schema_materialization::primary_index(
            "request_identity",
        )],
    },
];

/// Materializes the two relations, which only this Owner reads and writes.
pub(super) async fn migrate(
    pool: &PgPool,
    _admitted: &crate::schema_materialization::PreCutoverMaterializationAdmitted,
) -> Result<(), ResearchGoalOwnerError> {
    crate::schema_materialization::materialize_public_table(
        pool,
        "rd_research_initial_pit_attempts_v1",
        "CREATE TABLE IF NOT EXISTS rd_research_initial_pit_attempts_v1 (
            request_identity TEXT NOT NULL REFERENCES rd_research_request_receipts_v1(request_identity),
            attempt_ordinal INTEGER NOT NULL,
            correlation_identity BYTEA NOT NULL,
            universe_selection_request_identity BYTEA NOT NULL,
            universe_selection_request_meaning_digest BYTEA NOT NULL,
            submission_bytes BYTEA NOT NULL,
            submission_digest BYTEA NOT NULL,
            frozen_at_epoch_ms BIGINT NOT NULL,
            PRIMARY KEY (request_identity, attempt_ordinal),
            UNIQUE (request_identity, submission_digest)
        )",
    )
    .await
    .map_err(|e| storage(&e))?;
    crate::schema_materialization::materialize_public_table(
        pool,
        "rd_research_initial_pit_terminals_v1",
        "CREATE TABLE IF NOT EXISTS rd_research_initial_pit_terminals_v1 (
            request_identity TEXT PRIMARY KEY,
            attempt_ordinal INTEGER NOT NULL,
            pit_request_identity BYTEA NOT NULL,
            pit_request_digest BYTEA NOT NULL,
            instrument_master_digest BYTEA NOT NULL,
            snapshot_identity BYTEA NOT NULL,
            fact_digest BYTEA NOT NULL,
            disposition TEXT NOT NULL,
            primary_blocker TEXT,
            recorded_at_epoch_ms BIGINT NOT NULL,
            FOREIGN KEY (request_identity, attempt_ordinal)
                REFERENCES rd_research_initial_pit_attempts_v1(request_identity, attempt_ordinal)
        )",
    )
    .await
    .map_err(|e| storage(&e))?;

    for statement in [
        "ALTER TABLE public.rd_research_initial_pit_attempts_v1 OWNER TO rd_owner",
        "ALTER TABLE public.rd_research_initial_pit_terminals_v1 OWNER TO rd_owner",
        "REVOKE ALL ON TABLE public.rd_research_initial_pit_attempts_v1, public.rd_research_initial_pit_terminals_v1 FROM PUBLIC, market_data_owner, market_data_reader, backtest_owner, product_edge_owner, operator_authorization_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    ] {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(|e| storage(&e))?;
    }
    Ok(())
}

/// Market Data as the issuance reaches it: its read surface in this Owner's transaction, and its
/// two admission ports on its own pool.
///
/// The production implementation is [`MarketDataInitialPitPortsV1`]. If Market Data becomes its
/// own process, this is where an HTTP client replaces the two ports; the issuance does not change.
#[async_trait]
pub trait InitialPitMarketDataPortV1: Send + Sync {
    /// Every Market Data reference the request carries, at Market Data's current decision cut.
    async fn resolve_references(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        scope: &ResearchInstrumentScopeV1,
    ) -> Result<ResearchPitReferencesV1, ResearchPitReferencesErrorV1>;

    /// The initial intake Market Data committed under a correlation; `None` only when it never
    /// committed one.
    async fn read_terminal_by_correlation(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        correlation: BindingDigest,
    ) -> Result<Option<ResearchPitIntakeTerminalV1>, ResearchPitTerminalReadErrorV1>;

    /// Evaluates the scope's fixed-member rule. The same request rejoins the same record.
    async fn evaluate_universe_selection(
        &self,
        request: UntrustedUniverseSelectionRequestV1,
    ) -> Result<UniverseSelectionTerminalV1, UniverseSelectionAdmissionErrorV1>;

    /// Sends one frozen submission to the PIT intake.
    async fn submit(
        &self,
        submission: PitSnapshotSubmissionV1,
        universe_selection: UntrustedUniverseSelectionLocatorV1,
    ) -> Result<PitMarketSnapshotTerminalV1, PitMarketSnapshotIntakeErrorV1>;
}

/// Market Data's two admission ports, shared with the routes that serve them.
#[derive(Clone)]
pub struct MarketDataInitialPitPortsV1 {
    universe: Arc<dyn UniverseSelectionAdmissionV1>,
    intake: Arc<dyn PitMarketSnapshotIntakeV1>,
}

impl MarketDataInitialPitPortsV1 {
    /// Binds the issuance to the same port instances Market Data's routes use.
    #[must_use]
    pub fn new(
        universe: Arc<dyn UniverseSelectionAdmissionV1>,
        intake: Arc<dyn PitMarketSnapshotIntakeV1>,
    ) -> Self {
        Self { universe, intake }
    }
}

#[async_trait]
impl InitialPitMarketDataPortV1 for MarketDataInitialPitPortsV1 {
    async fn resolve_references(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        scope: &ResearchInstrumentScopeV1,
    ) -> Result<ResearchPitReferencesV1, ResearchPitReferencesErrorV1> {
        vibe_data::owner::resolve_research_pit_references_v1(transaction, scope).await
    }

    async fn read_terminal_by_correlation(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        correlation: BindingDigest,
    ) -> Result<Option<ResearchPitIntakeTerminalV1>, ResearchPitTerminalReadErrorV1> {
        vibe_data::owner::resolve_research_pit_terminal_by_correlation_v1(transaction, correlation)
            .await
    }

    async fn evaluate_universe_selection(
        &self,
        request: UntrustedUniverseSelectionRequestV1,
    ) -> Result<UniverseSelectionTerminalV1, UniverseSelectionAdmissionErrorV1> {
        self.universe.evaluate(request).await
    }

    async fn submit(
        &self,
        submission: PitSnapshotSubmissionV1,
        universe_selection: UntrustedUniverseSelectionLocatorV1,
    ) -> Result<PitMarketSnapshotTerminalV1, PitMarketSnapshotIntakeErrorV1> {
        self.intake.submit(submission, universe_selection).await
    }
}

/// Why issuance refused, by name. None of these writes anything.
#[derive(Clone, Debug, Eq, PartialEq, Error)]
pub enum ResearchInitialPitErrorV1 {
    /// This Owner holds no Research request under the identity.
    #[error("no Research request is held under this identity")]
    UnknownRequest,
    /// The request is not an accepted one, so it froze no Intent.
    #[error("the Research request froze no Intent")]
    NotAccepted,
    /// The request is a V2 one: it states no instrument scope, so it issues no initial PIT request.
    #[error("the Research request states no instrument scope")]
    NoInstrumentScope,
    /// Market Data holds no single member of its current frontier for an identity of the scope at
    /// its current cut. The remedy is a successor request.
    #[error("an identity of the scope is not eligible at Market Data's current cut")]
    InstrumentScopeNotEligible,
    /// The scope's identities name more than one Source Binding lineage or correction frontier.
    #[error("the scope's identities name more than one Source Binding lineage")]
    SourceBindingLineagesDiffer,
    /// The one lineage the scope names has no admitted head.
    #[error("the scope's Source Binding lineage has no admitted head")]
    SourceBindingUnavailable,
    /// Market Data's frontier moved again while this Owner re-read it.
    #[error("Market Data's eligible-instrument frontier moved while the request was frozen")]
    FrontierMoved,
    /// Market Data reached no finding: its clock or store could not answer.
    #[error("Market Data is unavailable")]
    MarketDataUnavailable,
    /// Market Data refused a request this Owner froze. That is a defect on one side of the
    /// contract, never a decided negative about the market.
    #[error("Market Data refused the frozen request: {0}")]
    RefusedByMarketData(&'static str),
    /// Market Data's terminal does not seal to exactly one frozen attempt.
    #[error("the terminal Market Data answered is attributable to no single frozen attempt")]
    TerminalUnattributable,
    /// This Owner's own custody is unavailable or untrusted.
    #[error("R&D Owner storage unavailable: {0}")]
    Storage(String),
}

impl From<ResearchGoalOwnerError> for ResearchInitialPitErrorV1 {
    fn from(error: ResearchGoalOwnerError) -> Self {
        Self::Storage(error.to_string())
    }
}

impl From<InitialPitAttributionErrorV1> for ResearchInitialPitErrorV1 {
    fn from(_: InitialPitAttributionErrorV1) -> Self {
        Self::TerminalUnattributable
    }
}

/// What the locked first stage decided.
enum InitialPitStageV1 {
    /// A terminal is recorded, now or earlier.
    Recorded(ResearchInitialPitV1),
    /// An attempt was sent and its outcome cannot be read yet.
    Unknown,
    /// This attempt is to be sent.
    Send(Box<FrozenInitialPitAttemptV1>),
}

impl PostgresResearchGoalOwnerV1 {
    /// Issues, or resolves, the initial PIT request of one accepted V3 Research request.
    ///
    /// Repeating it is safe: a recorded terminal is returned as it is, a send whose outcome was
    /// lost is read back by correlation, and only a request Market Data never committed is sent
    /// again.
    ///
    /// # Errors
    ///
    /// A named [`ResearchInitialPitErrorV1`] when the request cannot issue one or Market Data
    /// refused it. Market Data answering nothing is not an error: the state is then
    /// `SUBMITTED_OR_UNKNOWN`.
    pub async fn issue_research_initial_pit_v1(
        &self,
        request_identity: &str,
        market_data: &dyn InitialPitMarketDataPortV1,
    ) -> Result<ResearchInitialPitV1, ResearchInitialPitErrorV1> {
        let attempt = match self
            .prepare_initial_pit_v1(request_identity, market_data, false)
            .await?
        {
            InitialPitStageV1::Recorded(state) => return Ok(state),
            InitialPitStageV1::Unknown => return Ok(ResearchInitialPitV1::SubmittedOrUnknown),
            InitialPitStageV1::Send(attempt) => attempt,
        };
        let sent = market_data
            .submit(attempt.submission.clone(), attempt.universe_selection)
            .await;

        match self
            .settle_initial_pit_v1(request_identity, sent, market_data)
            .await?
        {
            Settled::Done(state) => Ok(state),
            // The frozen bytes named a clock head Market Data has since left and it committed
            // nothing under the correlation: freeze at the current cut and send that once.
            Settled::RefreezeAtCurrentCut => {
                let InitialPitStageV1::Send(attempt) = self
                    .prepare_initial_pit_v1(request_identity, market_data, true)
                    .await?
                else {
                    return Ok(ResearchInitialPitV1::SubmittedOrUnknown);
                };
                let sent = market_data
                    .submit(attempt.submission.clone(), attempt.universe_selection)
                    .await;

                match self
                    .settle_initial_pit_v1(request_identity, sent, market_data)
                    .await?
                {
                    Settled::Done(state) => Ok(state),
                    Settled::RefreezeAtCurrentCut => Ok(ResearchInitialPitV1::SubmittedOrUnknown),
                }
            }
        }
    }

    /// Under the Intent's lock: returns a recorded terminal, reads back an earlier send, or
    /// freezes the attempt to send.
    ///
    /// With `refreeze`, a new attempt is frozen at Market Data's current cut even though earlier
    /// ones exist; that is only right once Market Data has refused the latest one's clock evidence
    /// and holds nothing under the correlation.
    async fn prepare_initial_pit_v1(
        &self,
        request_identity: &str,
        market_data: &dyn InitialPitMarketDataPortV1,
        refreeze: bool,
    ) -> Result<InitialPitStageV1, ResearchInitialPitErrorV1> {
        let mut transaction = self.pool.begin().await.map_err(|e| storage(&e))?;
        lock_initial_pit(&mut transaction, request_identity).await?;
        let subject = load_subject(&mut transaction, request_identity).await?;

        if let Some(state) = load_recorded_state(&mut transaction, request_identity).await? {
            transaction.commit().await.map_err(|e| storage(&e))?;
            return Ok(InitialPitStageV1::Recorded(state));
        }
        let attempts = load_attempts(&mut transaction, request_identity).await?;

        if let Some(latest) = attempts.last().filter(|_| !refreeze).cloned() {
            let readback = match market_data
                .read_terminal_by_correlation(&mut transaction, subject.correlation())
                .await
            {
                Ok(readback) => readback,
                Err(e) => {
                    storage_diagnostic::refused_by_store(
                        "research_goal_owner.initial_pit.prepare.readback",
                        &format_args!("{e:?}"),
                    );
                    transaction.commit().await.map_err(|e| storage(&e))?;
                    return Ok(InitialPitStageV1::Unknown);
                }
            };
            let stage = match readback {
                Some(terminal) => InitialPitStageV1::Recorded(
                    record_terminal(
                        &mut transaction,
                        request_identity,
                        &subject,
                        &attempts,
                        &terminal,
                    )
                    .await?,
                ),
                // Market Data committed nothing under the correlation: send the latest attempt's
                // stored bytes again.
                None => InitialPitStageV1::Send(Box::new(latest)),
            };
            transaction.commit().await.map_err(|e| storage(&e))?;
            return Ok(stage);
        }
        let attempt =
            freeze_attempt(&mut transaction, request_identity, &subject, market_data).await?;
        transaction.commit().await.map_err(|e| storage(&e))?;
        Ok(InitialPitStageV1::Send(Box::new(attempt)))
    }

    /// Records what one send answered, reading back by correlation whenever the answer is not a
    /// terminal.
    async fn settle_initial_pit_v1(
        &self,
        request_identity: &str,
        sent: Result<PitMarketSnapshotTerminalV1, PitMarketSnapshotIntakeErrorV1>,
        market_data: &dyn InitialPitMarketDataPortV1,
    ) -> Result<Settled, ResearchInitialPitErrorV1> {
        let clock_moved = match sent {
            Ok(terminal) => {
                let mut transaction = self.pool.begin().await.map_err(|e| storage(&e))?;
                lock_initial_pit(&mut transaction, request_identity).await?;
                let subject = load_subject(&mut transaction, request_identity).await?;
                let attempts = load_attempts(&mut transaction, request_identity).await?;
                let state = record_answered_terminal(
                    &mut transaction,
                    request_identity,
                    &subject,
                    &attempts,
                    &terminal,
                )
                .await?;
                transaction.commit().await.map_err(|e| storage(&e))?;
                return Ok(Settled::Done(state));
            }
            // Another send under the correlation was committed: read it back.
            Err(PitMarketSnapshotIntakeErrorV1::CorrelationAlreadyCommitted) => false,
            // The frozen bytes name a clock head Market Data has left. If it committed nothing
            // under the correlation, the request has to be frozen again at the current cut.
            Err(PitMarketSnapshotIntakeErrorV1::ClockEvidenceNotCurrent) => true,
            // Market Data reached no finding: whether it committed is unknown until it can be read.
            Err(
                e @ (PitMarketSnapshotIntakeErrorV1::StoreUnavailable
                | PitMarketSnapshotIntakeErrorV1::ClockUnavailable
                | PitMarketSnapshotIntakeErrorV1::ObservationUnavailable),
            ) => {
                storage_diagnostic::refused_by_store(
                    "research_goal_owner.initial_pit.settle.no_finding",
                    &format_args!("{e:?}"),
                );
                return Ok(Settled::Done(ResearchInitialPitV1::SubmittedOrUnknown));
            }
            Err(e) => {
                return Err(ResearchInitialPitErrorV1::RefusedByMarketData(
                    intake_refusal_name(e),
                ));
            }
        };
        let mut transaction = self.pool.begin().await.map_err(|e| storage(&e))?;
        lock_initial_pit(&mut transaction, request_identity).await?;
        let subject = load_subject(&mut transaction, request_identity).await?;

        if let Some(state) = load_recorded_state(&mut transaction, request_identity).await? {
            transaction.commit().await.map_err(|e| storage(&e))?;
            return Ok(Settled::Done(state));
        }
        let attempts = load_attempts(&mut transaction, request_identity).await?;
        let readback = match market_data
            .read_terminal_by_correlation(&mut transaction, subject.correlation())
            .await
        {
            Ok(readback) => readback,
            Err(e) => {
                storage_diagnostic::refused_by_store(
                    "research_goal_owner.initial_pit.settle.readback",
                    &format_args!("{e:?}"),
                );
                transaction.commit().await.map_err(|e| storage(&e))?;
                return Ok(Settled::Done(ResearchInitialPitV1::SubmittedOrUnknown));
            }
        };
        let settled = match readback {
            Some(terminal) => Settled::Done(
                record_terminal(
                    &mut transaction,
                    request_identity,
                    &subject,
                    &attempts,
                    &terminal,
                )
                .await?,
            ),
            None if clock_moved => Settled::RefreezeAtCurrentCut,
            // Refused as already committed, yet nothing reads back: the answer is not trusted.
            None => {
                storage_diagnostic::refused_by_store(
                    "research_goal_owner.initial_pit.settle.committed_but_absent",
                    &"Market Data refused the correlation as committed and reads none back",
                );
                Settled::Done(ResearchInitialPitV1::SubmittedOrUnknown)
            }
        };
        transaction.commit().await.map_err(|e| storage(&e))?;
        Ok(settled)
    }
}

enum Settled {
    Done(ResearchInitialPitV1),
    RefreezeAtCurrentCut,
}

/// The state the Research readback carries for one custody: `None` unless it is an accepted V3
/// request, whose Intent binds a scope.
pub(crate) async fn initial_pit_for_custody_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    custody: &VerifiedResearchCustodyV1,
) -> Result<Option<ResearchInitialPitV1>, ResearchGoalOwnerError> {
    let binds_scope = matches!(
        custody.intent(),
        Some(FrozenResearchGoalIntent::V2(intent)) if intent.instrument_scope.is_some()
    );

    if !binds_scope
        || custody.receipt().disposition != ResearchRequestDisposition::Accepted
        || custody.is_legacy_quarantined()
    {
        return Ok(None);
    }
    let request_identity = custody.receipt().request_identity.as_str();

    if let Some(state) = load_recorded_state(transaction, request_identity)
        .await
        .map_err(|e| ResearchGoalOwnerError::Storage(e.to_string()))?
    {
        return Ok(Some(state));
    }
    let attempted: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM rd_research_initial_pit_attempts_v1 WHERE request_identity = $1)",
    )
    .bind(request_identity)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|e| storage(&e))?;
    Ok(Some(if attempted {
        ResearchInitialPitV1::SubmittedOrUnknown
    } else {
        ResearchInitialPitV1::NotIssued
    }))
}

/// The recorded terminal's request, for a Design role intent that names it. `None` until the
/// recorded terminal is `AVAILABLE`.
pub(crate) async fn available_initial_pit_request_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
) -> Result<Option<(BindingDigest, BindingDigest)>, ResearchGoalOwnerError> {
    let row = sqlx::query(
        "SELECT pit_request_identity, pit_request_digest, disposition
           FROM rd_research_initial_pit_terminals_v1 WHERE request_identity = $1",
    )
    .bind(request_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|e| storage(&e))?;
    let Some(row) = row else {
        return Ok(None);
    };

    if row.get::<String, _>("disposition")
        != disposition_name(PitMarketSnapshotDispositionV1::Available)
    {
        return Ok(None);
    }
    Ok(Some((
        digest_column(&row, "pit_request_identity")?,
        digest_column(&row, "pit_request_digest")?,
    )))
}

async fn lock_initial_pit(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
) -> Result<(), ResearchInitialPitErrorV1> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("rd.research-initial-pit.v1:{request_identity}"))
        .execute(&mut **transaction)
        .await
        .map_err(|e| storage(&e))?;
    Ok(())
}

/// The Research request, Intent and scope the request is issued for, from verified custody.
async fn load_subject(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
) -> Result<InitialPitSubjectV1, ResearchInitialPitErrorV1> {
    let custody = Box::pin(admit_research_custody_in_transaction(
        transaction,
        ResearchCustodyLookupV1::RequestV2(request_identity),
    ))
    .await?
    .ok_or(ResearchInitialPitErrorV1::UnknownRequest)?;

    if custody.receipt().disposition != ResearchRequestDisposition::Accepted
        || custody.is_legacy_quarantined()
    {
        return Err(ResearchInitialPitErrorV1::NotAccepted);
    }
    let Some(FrozenResearchGoalIntent::V2(intent)) = custody.intent() else {
        return Err(ResearchInitialPitErrorV1::NotAccepted);
    };
    let frozen = intent
        .instrument_scope
        .as_ref()
        .ok_or(ResearchInitialPitErrorV1::NoInstrumentScope)?;
    let scope = frozen.scope().ok_or_else(|| {
        ResearchInitialPitErrorV1::Storage(
            "the frozen Intent's instrument scope is not canonical".into(),
        )
    })?;
    let intent_identity =
        research_intent_identity_v2(&intent.intent_identity).ok_or_else(|| {
            ResearchInitialPitErrorV1::Storage("the frozen Intent identity is not canonical".into())
        })?;
    Ok(InitialPitSubjectV1 {
        research_request_identity: research_request_identity_v2(request_identity),
        intent_identity,
        scope,
    })
}

/// Freezes the next attempt at Market Data's current cut, after Market Data recorded the scope's
/// selection. An attempt identical to one already frozen is that attempt, not a second one.
async fn freeze_attempt(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
    subject: &InitialPitSubjectV1,
    market_data: &dyn InitialPitMarketDataPortV1,
) -> Result<FrozenInitialPitAttemptV1, ResearchInitialPitErrorV1> {
    let mut frontier_moves = 0;
    let (references, selection) = loop {
        let references = market_data
            .resolve_references(transaction, &subject.scope)
            .await
            .map_err(references_refusal)?;
        let request = universe_selection_request_v1(subject, &references)
            .map_err(|_| ResearchInitialPitErrorV1::MarketDataUnavailable)?;
        let locator = request.locator();

        match market_data.evaluate_universe_selection(request).await {
            Ok(selection)
                if selection.request_identity() == locator.request_identity()
                    && selection.request_meaning_digest() == locator.request_meaning_digest() =>
            {
                break (references, (locator, selection.selection_identity()));
            }
            Ok(_) => {
                return Err(ResearchInitialPitErrorV1::RefusedByMarketData(
                    "UNIVERSE_SELECTION_ANSWERED_ANOTHER_REQUEST",
                ));
            }
            // The frontier moved between the read and the evaluation: read the references again.
            Err(UniverseSelectionAdmissionErrorV1::FrontierNotCurrent) if frontier_moves == 0 => {
                frontier_moves += 1;
            }
            Err(UniverseSelectionAdmissionErrorV1::FrontierNotCurrent) => {
                return Err(ResearchInitialPitErrorV1::FrontierMoved);
            }
            Err(
                UniverseSelectionAdmissionErrorV1::FixedMemberUnresolved
                | UniverseSelectionAdmissionErrorV1::FixedMemberNotInFrontier,
            ) => return Err(ResearchInitialPitErrorV1::InstrumentScopeNotEligible),
            Err(UniverseSelectionAdmissionErrorV1::StoreUnavailable) => {
                return Err(ResearchInitialPitErrorV1::MarketDataUnavailable);
            }
            Err(
                e @ (UniverseSelectionAdmissionErrorV1::InvalidRequest
                | UniverseSelectionAdmissionErrorV1::RequestConflict
                | UniverseSelectionAdmissionErrorV1::UnknownIdentity),
            ) => {
                return Err(ResearchInitialPitErrorV1::RefusedByMarketData(
                    universe_refusal_name(e),
                ));
            }
        }
    };
    let (universe_selection, selection_identity) = selection;
    let submission = pit_submission_v1(subject, &references, selection_identity);
    let bytes = serde_json::to_vec(&submission)
        .map_err(|e| ResearchInitialPitErrorV1::Storage(e.to_string()))?;
    let digest: [u8; 32] = Sha256::digest(&bytes).into();
    let existing: Option<i32> = sqlx::query_scalar(
        "SELECT attempt_ordinal FROM rd_research_initial_pit_attempts_v1
          WHERE request_identity = $1 AND submission_digest = $2",
    )
    .bind(request_identity)
    .bind(digest.as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|e| storage(&e))?;

    let ordinal = if let Some(ordinal) = existing {
        ordinal
    } else {
        let next: i32 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(attempt_ordinal), 0) + 1 FROM rd_research_initial_pit_attempts_v1
              WHERE request_identity = $1",
        )
        .bind(request_identity)
        .fetch_one(&mut **transaction)
        .await
        .map_err(|e| storage(&e))?;
        let frozen_at = owner_clock_epoch_ms_in_transaction(transaction).await?;
        sqlx::query(
            "INSERT INTO rd_research_initial_pit_attempts_v1 (
                request_identity, attempt_ordinal, correlation_identity,
                universe_selection_request_identity, universe_selection_request_meaning_digest,
                submission_bytes, submission_digest, frozen_at_epoch_ms
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(request_identity)
        .bind(next)
        .bind(subject.correlation().as_bytes().as_slice())
        .bind(universe_selection.request_identity().as_bytes().as_slice())
        .bind(
            universe_selection
                .request_meaning_digest()
                .as_bytes()
                .as_slice(),
        )
        .bind(&bytes)
        .bind(digest.as_slice())
        .bind(
            i64::try_from(frozen_at)
                .map_err(|e| ResearchInitialPitErrorV1::Storage(e.to_string()))?,
        )
        .execute(&mut **transaction)
        .await
        .map_err(|e| storage(&e))?;
        next
    };
    Ok(FrozenInitialPitAttemptV1 {
        ordinal: u32::try_from(ordinal)
            .map_err(|e| ResearchInitialPitErrorV1::Storage(e.to_string()))?,
        universe_selection,
        submission,
    })
}

/// Every frozen attempt of the request, in order, each re-verified against its stored digest.
async fn load_attempts(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
) -> Result<Vec<FrozenInitialPitAttemptV1>, ResearchInitialPitErrorV1> {
    let rows = sqlx::query(
        "SELECT attempt_ordinal, correlation_identity, universe_selection_request_identity,
                universe_selection_request_meaning_digest, submission_bytes, submission_digest
           FROM rd_research_initial_pit_attempts_v1
          WHERE request_identity = $1
          ORDER BY attempt_ordinal",
    )
    .bind(request_identity)
    .fetch_all(&mut **transaction)
    .await
    .map_err(|e| storage(&e))?;
    let untrusted =
        |what: &str| ResearchInitialPitErrorV1::Storage(format!("frozen attempt {what}"));
    let mut attempts = Vec::with_capacity(rows.len());

    for (index, row) in rows.iter().enumerate() {
        let ordinal: i32 = row.get("attempt_ordinal");
        let bytes: Vec<u8> = row.get("submission_bytes");
        let stored_digest: Vec<u8> = row.get("submission_digest");
        let digest: [u8; 32] = Sha256::digest(&bytes).into();

        if usize::try_from(ordinal).ok() != Some(index + 1) || stored_digest != digest {
            return Err(untrusted("is not the exact stored sequence"));
        }
        let value: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| untrusted("is not JSON"))?;
        let submission = PitSnapshotSubmissionV1::from_json_value_v1(value)
            .map_err(|_| untrusted("is not a Market Data submission"))?;

        if submission.correlation_identity.as_bytes().as_slice()
            != row.get::<Vec<u8>, _>("correlation_identity").as_slice()
        {
            return Err(untrusted("carries another correlation"));
        }
        attempts.push(FrozenInitialPitAttemptV1 {
            ordinal: u32::try_from(ordinal).map_err(|_| untrusted("ordinal is out of range"))?,
            universe_selection: UntrustedUniverseSelectionLocatorV1::from_untrusted(
                digest_column(row, "universe_selection_request_identity")
                    .map_err(ResearchInitialPitErrorV1::from)?,
                digest_column(row, "universe_selection_request_meaning_digest")
                    .map_err(ResearchInitialPitErrorV1::from)?,
            ),
            submission,
        });
    }
    Ok(attempts)
}

/// Records a terminal the intake answered to a send, which must be under this Intent's
/// correlation.
async fn record_answered_terminal(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
    subject: &InitialPitSubjectV1,
    attempts: &[FrozenInitialPitAttemptV1],
    terminal: &PitMarketSnapshotTerminalV1,
) -> Result<ResearchInitialPitV1, ResearchInitialPitErrorV1> {
    if terminal.correlation_identity() != subject.correlation() {
        return Err(ResearchInitialPitErrorV1::TerminalUnattributable);
    }
    write_terminal(transaction, request_identity, attempts, terminal).await
}

/// Records a terminal read back by correlation, which must name this Research request's requester.
async fn record_terminal(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
    subject: &InitialPitSubjectV1,
    attempts: &[FrozenInitialPitAttemptV1],
    readback: &ResearchPitIntakeTerminalV1,
) -> Result<ResearchInitialPitV1, ResearchInitialPitErrorV1> {
    if readback.requester_identity() != subject.requester_identity() {
        return Err(ResearchInitialPitErrorV1::TerminalUnattributable);
    }
    record_answered_terminal(
        transaction,
        request_identity,
        subject,
        attempts,
        readback.terminal(),
    )
    .await
}

/// Writes the terminal once, against the one attempt it seals to, and reads it back.
async fn write_terminal(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
    attempts: &[FrozenInitialPitAttemptV1],
    terminal: &PitMarketSnapshotTerminalV1,
) -> Result<ResearchInitialPitV1, ResearchInitialPitErrorV1> {
    let ordinal = attribute_initial_pit_terminal_v1(attempts, terminal)?;
    let recorded_at = owner_clock_epoch_ms_in_transaction(transaction).await?;
    let state = ResearchInitialPitV1::Terminal {
        disposition: terminal.disposition(),
        primary_blocker: terminal.primary_blocker(),
    };
    sqlx::query(
        "INSERT INTO rd_research_initial_pit_terminals_v1 (
            request_identity, attempt_ordinal, pit_request_identity, pit_request_digest,
            instrument_master_digest, snapshot_identity, fact_digest, disposition,
            primary_blocker, recorded_at_epoch_ms
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (request_identity) DO NOTHING",
    )
    .bind(request_identity)
    .bind(i32::try_from(ordinal).map_err(|e| ResearchInitialPitErrorV1::Storage(e.to_string()))?)
    .bind(terminal.request_identity().as_bytes().as_slice())
    .bind(terminal.request_digest().as_bytes().as_slice())
    .bind(terminal.instrument_master_digest().as_bytes().as_slice())
    .bind(terminal.snapshot_identity().as_bytes().as_slice())
    .bind(terminal.fact_digest().as_bytes().as_slice())
    .bind(disposition_name(terminal.disposition()))
    .bind(terminal.primary_blocker().map(blocker_name))
    .bind(
        i64::try_from(recorded_at)
            .map_err(|e| ResearchInitialPitErrorV1::Storage(e.to_string()))?,
    )
    .execute(&mut **transaction)
    .await
    .map_err(|e| storage(&e))?;

    // Write-once: a terminal recorded earlier must be exactly this one.
    let stored = sqlx::query(
        "SELECT attempt_ordinal, pit_request_identity, pit_request_digest
           FROM rd_research_initial_pit_terminals_v1 WHERE request_identity = $1",
    )
    .bind(request_identity)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|e| storage(&e))?;

    if u32::try_from(stored.get::<i32, _>("attempt_ordinal")).ok() != Some(ordinal)
        || digest_column(&stored, "pit_request_identity")? != terminal.request_identity()
        || digest_column(&stored, "pit_request_digest")? != terminal.request_digest()
    {
        return Err(ResearchInitialPitErrorV1::Storage(
            "a different terminal is already recorded for this Intent".into(),
        ));
    }
    load_recorded_state(transaction, request_identity)
        .await?
        .filter(|recorded| *recorded == state)
        .ok_or_else(|| {
            ResearchInitialPitErrorV1::Storage("the recorded terminal does not read back".into())
        })
}

async fn load_recorded_state(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
) -> Result<Option<ResearchInitialPitV1>, ResearchInitialPitErrorV1> {
    let row = sqlx::query(
        "SELECT disposition, primary_blocker
           FROM rd_research_initial_pit_terminals_v1 WHERE request_identity = $1",
    )
    .bind(request_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|e| storage(&e))?;
    let Some(row) = row else {
        return Ok(None);
    };
    let untrusted =
        || ResearchInitialPitErrorV1::Storage("the recorded terminal is not canonical".into());
    let disposition =
        disposition_from_name(&row.get::<String, _>("disposition")).ok_or_else(untrusted)?;
    let primary_blocker = row
        .get::<Option<String>, _>("primary_blocker")
        .map(|name| blocker_from_name(&name).ok_or_else(untrusted))
        .transpose()?;

    if (disposition == PitMarketSnapshotDispositionV1::Available) != primary_blocker.is_none() {
        return Err(untrusted());
    }
    Ok(Some(ResearchInitialPitV1::Terminal {
        disposition,
        primary_blocker,
    }))
}

fn digest_column(
    row: &sqlx::postgres::PgRow,
    column: &str,
) -> Result<BindingDigest, ResearchGoalOwnerError> {
    let bytes: Vec<u8> = row.get(column);
    <[u8; 32]>::try_from(bytes.as_slice())
        .map(BindingDigest::from_untrusted_bytes)
        .map_err(|_| ResearchGoalOwnerError::Storage(format!("{column} is not a 32-byte digest")))
}

fn references_refusal(error: ResearchPitReferencesErrorV1) -> ResearchInitialPitErrorV1 {
    match error {
        ResearchPitReferencesErrorV1::InstrumentNotAdmissible => {
            ResearchInitialPitErrorV1::InstrumentScopeNotEligible
        }
        ResearchPitReferencesErrorV1::SourceBindingLineagesDiffer => {
            ResearchInitialPitErrorV1::SourceBindingLineagesDiffer
        }
        ResearchPitReferencesErrorV1::SourceBindingUnavailable => {
            ResearchInitialPitErrorV1::SourceBindingUnavailable
        }
        ResearchPitReferencesErrorV1::ClockUnavailable
        | ResearchPitReferencesErrorV1::StoreUnavailable => {
            ResearchInitialPitErrorV1::MarketDataUnavailable
        }
    }
}

const fn universe_refusal_name(error: UniverseSelectionAdmissionErrorV1) -> &'static str {
    match error {
        UniverseSelectionAdmissionErrorV1::InvalidRequest => "UNIVERSE_SELECTION_INVALID_REQUEST",
        UniverseSelectionAdmissionErrorV1::RequestConflict => "UNIVERSE_SELECTION_REQUEST_CONFLICT",
        UniverseSelectionAdmissionErrorV1::UnknownIdentity => "UNIVERSE_SELECTION_UNKNOWN_IDENTITY",
        UniverseSelectionAdmissionErrorV1::StoreUnavailable => {
            "UNIVERSE_SELECTION_STORE_UNAVAILABLE"
        }
        UniverseSelectionAdmissionErrorV1::FrontierNotCurrent => {
            "UNIVERSE_SELECTION_FRONTIER_NOT_CURRENT"
        }
        UniverseSelectionAdmissionErrorV1::FixedMemberUnresolved => {
            "UNIVERSE_SELECTION_MEMBER_UNRESOLVED"
        }
        UniverseSelectionAdmissionErrorV1::FixedMemberNotInFrontier => {
            "UNIVERSE_SELECTION_MEMBER_NOT_IN_FRONTIER"
        }
    }
}

const fn intake_refusal_name(error: PitMarketSnapshotIntakeErrorV1) -> &'static str {
    match error {
        PitMarketSnapshotIntakeErrorV1::InvalidRequest => "PIT_INVALID_REQUEST",
        PitMarketSnapshotIntakeErrorV1::SourceBindingUnavailable => {
            "PIT_SOURCE_BINDING_UNAVAILABLE"
        }
        PitMarketSnapshotIntakeErrorV1::ObservationUnavailable => "PIT_OBSERVATION_UNAVAILABLE",
        PitMarketSnapshotIntakeErrorV1::ObservationBatchInvalid => "PIT_OBSERVATION_BATCH_INVALID",
        PitMarketSnapshotIntakeErrorV1::ClockUnavailable => "PIT_CLOCK_UNAVAILABLE",
        PitMarketSnapshotIntakeErrorV1::StoreUnavailable => "PIT_STORE_UNAVAILABLE",
        PitMarketSnapshotIntakeErrorV1::RequestConflict => "PIT_REQUEST_CONFLICT",
        PitMarketSnapshotIntakeErrorV1::InstrumentMasterUnavailable => {
            "PIT_INSTRUMENT_MASTER_UNAVAILABLE"
        }
        PitMarketSnapshotIntakeErrorV1::UniverseMemberCountUnadmitted => {
            "PIT_UNIVERSE_MEMBER_COUNT_UNADMITTED"
        }
        PitMarketSnapshotIntakeErrorV1::UniverseMemberKeyIsNotInstrument => {
            "PIT_UNIVERSE_MEMBER_KEY_IS_NOT_INSTRUMENT"
        }
        PitMarketSnapshotIntakeErrorV1::CorrelationAlreadyCommitted => {
            "PIT_CORRELATION_ALREADY_COMMITTED"
        }
        PitMarketSnapshotIntakeErrorV1::ClockEvidenceNotCurrent => "PIT_CLOCK_EVIDENCE_NOT_CURRENT",
    }
}

const fn disposition_name(disposition: PitMarketSnapshotDispositionV1) -> &'static str {
    match disposition {
        PitMarketSnapshotDispositionV1::Available => "AVAILABLE",
        PitMarketSnapshotDispositionV1::Unlicensed => "UNLICENSED",
        PitMarketSnapshotDispositionV1::Ambiguous => "AMBIGUOUS",
        PitMarketSnapshotDispositionV1::Stale => "STALE",
        PitMarketSnapshotDispositionV1::Insufficient => "INSUFFICIENT",
        PitMarketSnapshotDispositionV1::Unavailable => "UNAVAILABLE",
    }
}

fn disposition_from_name(name: &str) -> Option<PitMarketSnapshotDispositionV1> {
    [
        PitMarketSnapshotDispositionV1::Available,
        PitMarketSnapshotDispositionV1::Unlicensed,
        PitMarketSnapshotDispositionV1::Ambiguous,
        PitMarketSnapshotDispositionV1::Stale,
        PitMarketSnapshotDispositionV1::Insufficient,
        PitMarketSnapshotDispositionV1::Unavailable,
    ]
    .into_iter()
    .find(|disposition| disposition_name(*disposition) == name)
}

const fn blocker_name(blocker: PitMarketSnapshotBlockerV1) -> &'static str {
    match blocker {
        PitMarketSnapshotBlockerV1::RightsUnlicensed => "RIGHTS_UNLICENSED",
        PitMarketSnapshotBlockerV1::IdentitySemanticsOrTimeAmbiguous => {
            "IDENTITY_SEMANTICS_OR_TIME_AMBIGUOUS"
        }
        PitMarketSnapshotBlockerV1::EvidenceStale => "EVIDENCE_STALE",
        PitMarketSnapshotBlockerV1::CoverageInsufficient => "COVERAGE_INSUFFICIENT",
        PitMarketSnapshotBlockerV1::SourceUnavailable => "SOURCE_UNAVAILABLE",
    }
}

fn blocker_from_name(name: &str) -> Option<PitMarketSnapshotBlockerV1> {
    [
        PitMarketSnapshotBlockerV1::RightsUnlicensed,
        PitMarketSnapshotBlockerV1::IdentitySemanticsOrTimeAmbiguous,
        PitMarketSnapshotBlockerV1::EvidenceStale,
        PitMarketSnapshotBlockerV1::CoverageInsufficient,
        PitMarketSnapshotBlockerV1::SourceUnavailable,
    ]
    .into_iter()
    .find(|blocker| blocker_name(*blocker) == name)
}
