//! Issues and resolves universe-frame sample projections: the Owner operation R&D calls.
//!
//! R&D names a sealed Replay request, that request's universe-member composition binding and
//! which frames, and nothing else. In one Market Data transaction the operation reads the binding,
//! the roles it recorded when its issuance authenticated the composer's role set, each role's
//! stored declaration and the frame's verified batch; re-derives the universe frame through the one
//! binder that also builds the frame a host admits, and requires it to be the frame the binding
//! sealed; writes or reuses each value's sample; and stores the projection, its exact-subject
//! readback and outbox. It never reads R&D, and takes no lock on a row R&D can hold, because R&D
//! calls it while holding its own: every dependency is read at the transaction's snapshot, and
//! the only locks taken are on this operation's own table and on sample keys R&D never locks.

use std::{
    collections::BTreeSet,
    fmt::{Debug, Display},
};

use sha2::{Digest as _, Sha256};
use sqlx::{Postgres, Row, Transaction};

use super::{
    MarketDataOwnerPostgres, SampleCustodyErrorV1, load_bar_schedule_candidates,
    source_sample_custody_v1::commit_or_reuse_source_sample_in_transaction_v1,
    strategy_input_binding_registry::{
        read_owner_verified_pit_batch_v1, rederive_strategy_input_binding_declaration_read_only_v1,
    },
};
use crate::owner::{
    bar_schedule::BarScheduleReadbackV1,
    instrument_master_v2::native_replay_request_identity_v2,
    native_replay_scheduling_v1::select_native_replay_schedule_for_member_v1,
    replay_market_facts_v2::{
        ReplayCompositionBindingLocatorV1, ReplayMarketFactsShapeV2,
        postgres::{
            ReplayMarketFactsPostgresErrorV2, recover_replay_composition_binding_in_transaction_v1,
        },
    },
    sample_fact::{
        StoredSampleReadbackV1, TimeframeProjectionReceiptV1,
        prepare_bar_timeframe_projection_from_source_v1,
        prepare_point_event_timeframe_projection_for_binding_v1,
    },
    source_binding::BindingDigest,
    strategy_input_binding::{
        StrategyInputEventKind, UntrustedStrategyInputBindingRequest,
        bind_strategy_input_universe_frame_with_sources_v1,
    },
    universe_sample_projection_v1::{
        StrategyInputUniverseSampleProjectionReadbackV1, UniverseMemberSampleV1,
        prepare_universe_sample_projection_v1,
    },
};

const REQUEST_KEY_DOMAIN: &[u8] = b"market-data.universe-sample-projection-request.v1\0";

pub(super) const SCHEMA_V1: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS market_data_private.universe_sample_projections_v1 (projection_identity BYTEA PRIMARY KEY CHECK (octet_length(projection_identity)=32), subject_identity BYTEA NOT NULL UNIQUE CHECK (octet_length(subject_identity)=32), projection_bytes BYTEA NOT NULL CHECK (octet_length(projection_bytes)>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.universe_sample_projection_outbox_v1 (outbox_identity BYTEA PRIMARY KEY REFERENCES market_data_private.universe_sample_projections_v1(projection_identity), payload_bytes BYTEA NOT NULL CHECK (octet_length(payload_bytes)>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.universe_sample_projection_issuances_v1 (request_key BYTEA PRIMARY KEY CHECK (octet_length(request_key)=32), binding_identity BYTEA NOT NULL CHECK (octet_length(binding_identity)=32), binding_digest BYTEA NOT NULL CHECK (octet_length(binding_digest)=32))",
    "CREATE TABLE IF NOT EXISTS market_data_private.universe_sample_projection_issued_frames_v1 (request_key BYTEA NOT NULL REFERENCES market_data_private.universe_sample_projection_issuances_v1(request_key), frame_ordinal INTEGER NOT NULL CHECK (frame_ordinal>=0), projection_identity BYTEA NOT NULL REFERENCES market_data_private.universe_sample_projections_v1(projection_identity), PRIMARY KEY (request_key, frame_ordinal))",
    "REVOKE ALL ON TABLE market_data_private.universe_sample_projections_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.universe_sample_projection_outbox_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.universe_sample_projection_issuances_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.universe_sample_projection_issued_frames_v1 FROM PUBLIC",
];

/// Which frames of a sealed Replay request a call issues projections for.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UniverseSampleProjectionScopeV1 {
    /// The request's initial frame: the PIT snapshot its composition binding composes.
    InitialFrame,
}

impl UniverseSampleProjectionScopeV1 {
    const fn byte(self) -> u8 {
        match self {
            Self::InitialFrame => 1,
        }
    }
}

/// Why no projection was issued. Every refusal writes nothing.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UniverseSampleProjectionIssuanceErrorV1 {
    /// The sealed Replay request identity is not one this operation can key.
    InvalidRequestIdentity,
    /// No composition binding matches the exact locator.
    BindingUnavailable,
    /// The binding composes exact instruments, which have no universe frame.
    CompositionShapeMismatch,
    /// This request and scope were already issued under another binding.
    BindingConflict,
    /// The binding's recorded roles, their declarations and the frame's batch do not re-derive the
    /// universe frame the binding sealed.
    FrameMismatch,
    /// A BAR member's schedule for the frame is missing, or two would answer it.
    ScheduleUnavailable,
    /// A sample the frame reads conflicts with stored sample custody.
    SampleConflict,
    /// The frame already has a different projection.
    SubjectConflict,
    /// The store could not be read or written, or holds custody that does not verify.
    StoreUnavailable,
}

impl Display for UniverseSampleProjectionIssuanceErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidRequestIdentity => "the sealed Replay request identity is not keyable",
            Self::BindingUnavailable => "no composition binding matches the locator",
            Self::CompositionShapeMismatch => "the binding composes no universe frame",
            Self::BindingConflict => "the request was issued under another binding",
            Self::FrameMismatch => "the binding's roles do not re-derive its universe frame",
            Self::ScheduleUnavailable => "a member's BAR schedule for the frame is unavailable",
            Self::SampleConflict => "a sample conflicts with stored sample custody",
            Self::SubjectConflict => "the frame already has a different projection",
            Self::StoreUnavailable => "the Market Data store is unavailable",
        })
    }
}

impl std::error::Error for UniverseSampleProjectionIssuanceErrorV1 {}

impl MarketDataOwnerPostgres {
    /// Issues the universe-frame sample projections of one sealed Replay request's `scope`.
    ///
    /// The request key is the sealed Replay request identity with the scope. An exact retry returns
    /// the stored projections and appends nothing; the same key under another binding is refused
    /// as [`UniverseSampleProjectionIssuanceErrorV1::BindingConflict`] with zero writes.
    ///
    /// # Errors
    ///
    /// Returns the refusal that names why nothing was issued; every refusal writes nothing.
    pub(crate) async fn issue_universe_sample_projections_v1(
        &self,
        sealed_request_identity: &str,
        binding: ReplayCompositionBindingLocatorV1,
        scope: UniverseSampleProjectionScopeV1,
    ) -> Result<
        Box<[StrategyInputUniverseSampleProjectionReadbackV1]>,
        UniverseSampleProjectionIssuanceErrorV1,
    > {
        let request_key = request_key_v1(sealed_request_identity, scope)?;
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable)?;
        // The table lock comes before any read, so the snapshot this serializable transaction
        // takes already sees whatever the previous issuer committed. It conflicts with itself,
        // which serializes every issuance, and with nothing R&D takes.
        sqlx::query("LOCK TABLE market_data_private.universe_sample_projection_issuances_v1 IN SHARE ROW EXCLUSIVE MODE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable)?;

        if let Some(recorded) = recorded_binding(&mut transaction, request_key).await? {
            if recorded != (binding.binding_identity(), binding.binding_digest()) {
                return Err(UniverseSampleProjectionIssuanceErrorV1::BindingConflict);
            }
            let issued = issued_projections(&mut transaction, request_key).await?;
            transaction
                .commit()
                .await
                .map_err(|_| UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable)?;
            return Ok(issued);
        }
        let projection = match scope {
            UniverseSampleProjectionScopeV1::InitialFrame => {
                issue_initial_frame_in_transaction(&mut transaction, binding).await?
            }
        };
        persist_projection(&mut transaction, &projection).await?;
        sqlx::query("INSERT INTO market_data_private.universe_sample_projection_issuances_v1(request_key,binding_identity,binding_digest) VALUES ($1,$2,$3)")
            .bind(request_key.as_bytes().as_slice())
            .bind(binding.binding_identity().as_bytes().as_slice())
            .bind(binding.binding_digest().as_bytes().as_slice())
            .execute(&mut *transaction)
            .await
            .map_err(|_| UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable)?;
        sqlx::query("INSERT INTO market_data_private.universe_sample_projection_issued_frames_v1(request_key,frame_ordinal,projection_identity) VALUES ($1,0,$2)")
            .bind(request_key.as_bytes().as_slice())
            .bind(projection.identity().as_bytes().as_slice())
            .execute(&mut *transaction)
            .await
            .map_err(|_| UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable)?;
        transaction
            .commit()
            .await
            .map_err(|_| UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable)?;
        Ok(vec![projection].into_boxed_slice())
    }

    /// Reads the one projection issued for a universe frame, by the frame receipt's digest.
    ///
    /// `Ok(None)` means no projection was issued for that frame, and nothing else: a store that
    /// cannot be read, or custody that does not verify, is an error.
    ///
    /// # Errors
    ///
    /// Returns [`UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable`] when the store cannot
    /// be read or the stored projection does not verify.
    pub(crate) async fn resolve_universe_sample_projection_by_subject_v1(
        &self,
        subject: BindingDigest,
    ) -> Result<
        Option<StrategyInputUniverseSampleProjectionReadbackV1>,
        UniverseSampleProjectionIssuanceErrorV1,
    > {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .execute(&mut *transaction)
            .await
            .map_err(|_| UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable)?;
        let row = sqlx::query("SELECT p.projection_identity,p.projection_bytes,o.payload_bytes FROM market_data_private.universe_sample_projections_v1 AS p JOIN market_data_private.universe_sample_projection_outbox_v1 AS o ON o.outbox_identity=p.projection_identity WHERE p.subject_identity=$1")
            .bind(subject.as_bytes().as_slice())
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|_| UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable)?;
        let projection = row.map(|row| decode_projection_row(&row)).transpose()?;
        transaction
            .commit()
            .await
            .map_err(|_| UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable)?;

        if projection
            .as_ref()
            .is_some_and(|projection| projection.subject() != subject)
        {
            return Err(UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable);
        }
        Ok(projection)
    }
}

/// Market Data's universe-frame sample projection authority, as R&D holds it.
///
/// It is opened only from the deployment's Market Data Owner credential, never from a caller's
/// pool, and it does not install anything: a store the Owner's migration has not materialized
/// refuses every call instead of being created here.
pub struct UniverseSampleProjectionOwnerV1 {
    owner: MarketDataOwnerPostgres,
}

impl Debug for UniverseSampleProjectionOwnerV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(UniverseSampleProjectionOwnerV1))
            .finish_non_exhaustive()
    }
}

impl UniverseSampleProjectionOwnerV1 {
    pub(in crate::owner) const fn new(owner: MarketDataOwnerPostgres) -> Self {
        Self { owner }
    }

    /// Issues the universe-frame sample projections of one sealed Replay request's `scope`.
    ///
    /// # Errors
    ///
    /// Returns the refusal that names why nothing was issued; every refusal writes nothing.
    pub async fn issue_v1(
        &self,
        sealed_request_identity: &str,
        binding: ReplayCompositionBindingLocatorV1,
        scope: UniverseSampleProjectionScopeV1,
    ) -> Result<
        Box<[StrategyInputUniverseSampleProjectionReadbackV1]>,
        UniverseSampleProjectionIssuanceErrorV1,
    > {
        self.owner
            .issue_universe_sample_projections_v1(sealed_request_identity, binding, scope)
            .await
    }

    /// Reads the one projection issued for a universe frame, by the frame receipt's digest.
    ///
    /// # Errors
    ///
    /// Returns [`UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable`] when the store cannot
    /// be read or the stored projection does not verify; `Ok(None)` means none was issued.
    pub async fn resolve_by_subject_v1(
        &self,
        subject: BindingDigest,
    ) -> Result<
        Option<StrategyInputUniverseSampleProjectionReadbackV1>,
        UniverseSampleProjectionIssuanceErrorV1,
    > {
        self.owner
            .resolve_universe_sample_projection_by_subject_v1(subject)
            .await
    }
}

/// The request key: SHA-256 over its domain, the sealed request's Market Data key and the scope.
fn request_key_v1(
    sealed_request_identity: &str,
    scope: UniverseSampleProjectionScopeV1,
) -> Result<BindingDigest, UniverseSampleProjectionIssuanceErrorV1> {
    let request = native_replay_request_identity_v2(sealed_request_identity)
        .map_err(|_| UniverseSampleProjectionIssuanceErrorV1::InvalidRequestIdentity)?;
    let mut hasher = Sha256::new();
    hasher.update(REQUEST_KEY_DOMAIN);
    hasher.update(request.as_bytes());
    hasher.update([scope.byte()]);
    Ok(BindingDigest::from_untrusted_bytes(
        hasher.finalize().into(),
    ))
}

async fn issue_initial_frame_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: ReplayCompositionBindingLocatorV1,
) -> Result<StrategyInputUniverseSampleProjectionReadbackV1, UniverseSampleProjectionIssuanceErrorV1>
{
    use UniverseSampleProjectionIssuanceErrorV1 as E;

    let binding = recover_replay_composition_binding_in_transaction_v1(transaction, locator)
        .await
        .map_err(|e| match e {
            ReplayMarketFactsPostgresErrorV2::BindingUnavailable => E::BindingUnavailable,
            _ => E::StoreUnavailable,
        })?;
    let record = binding.record();

    if record.shape() != ReplayMarketFactsShapeV2::UniverseMembers {
        return Err(E::CompositionShapeMismatch);
    }
    let sealed_frame = record
        .universe_frame_digest()
        .ok_or(E::CompositionShapeMismatch)?;

    // The role set is the one the binding recorded when its issuance authenticated the composer's;
    // each role's declaration is the one Market Data stored, and must be the one it recorded.
    let mut requests: Vec<UntrustedStrategyInputBindingRequest> = Vec::new();

    for role in record.authenticated_roles() {
        let declaration = rederive_strategy_input_binding_declaration_read_only_v1(
            transaction,
            record.replay_request_identity(),
            record.strategy_design_identity(),
            role.role_identity,
        )
        .await
        .map_err(|_| E::FrameMismatch)?;

        if declaration.request_meaning_digest() != role.declaration_digest
            || declaration.binding_digest() != role.binding_digest
            || declaration.request().strategy_design_identity != record.strategy_design_identity()
            || declaration.request().input_role_identity != role.role_identity
            || declaration.exact_binding().is_some()
        {
            return Err(E::FrameMismatch);
        }
        requests.push(declaration.request().clone());
    }
    let batch = read_owner_verified_pit_batch_v1(transaction, record.pit_snapshot_identity())
        .await
        .map_err(|_| E::FrameMismatch)?;
    let (frame, sources) = bind_strategy_input_universe_frame_with_sources_v1(&requests, &batch)
        .map_err(|_| E::FrameMismatch)?;

    if frame.digest() != sealed_frame {
        return Err(E::FrameMismatch);
    }
    let bar = matches!(
        frame.trigger().lifecycle().kind(),
        StrategyInputEventKind::Bar
    );
    let schedules = if bar {
        let frame_time_ns =
            u64::try_from(record.replay_start_event_ns()).map_err(|_| E::FrameMismatch)?;
        member_schedules(transaction, &frame, &requests, &batch, frame_time_ns).await?
    } else {
        Vec::new()
    };
    let mut timeframes: Vec<TimeframeProjectionReceiptV1> = Vec::with_capacity(sources.len());
    let mut schedule_identities = Vec::with_capacity(sources.len());

    for member in &sources {
        if bar {
            let schedule = schedules
                .iter()
                .find(|schedule| {
                    schedule.fact().canonical_instrument() == member.source.row.instrument()
                })
                .ok_or(E::ScheduleUnavailable)?;
            timeframes.push(
                prepare_bar_timeframe_projection_from_source_v1(&member.source, schedule)
                    .map_err(|_| E::FrameMismatch)?,
            );
            schedule_identities.push(Some(schedule.identity()));
        } else {
            timeframes.push(prepare_point_event_timeframe_projection_for_binding_v1(
                member.source.binding_digest,
            ));
            schedule_identities.push(None);
        }
    }
    let mut samples: Vec<StoredSampleReadbackV1> = Vec::with_capacity(sources.len());

    for (member, timeframe) in sources.iter().zip(&timeframes) {
        samples.push(
            commit_or_reuse_source_sample_in_transaction_v1(transaction, &member.source, timeframe)
                .await
                .map_err(|e| match e {
                    SampleCustodyErrorV1::StoreUnavailable => E::StoreUnavailable,
                    _ => E::SampleConflict,
                })?,
        );
    }
    let members = sources
        .iter()
        .zip(&timeframes)
        .zip(&samples)
        .zip(&schedule_identities)
        .map(
            |(((member, timeframe), sample), schedule)| UniverseMemberSampleV1 {
                member_ordinal: member.member_ordinal,
                timeframe_projection_digest: BindingDigest::from_untrusted_bytes(
                    timeframe.digest(),
                ),
                sample,
                schedule_readback_identity: *schedule,
            },
        )
        .collect::<Vec<_>>();
    prepare_universe_sample_projection_v1(&frame, &members).map_err(|_| E::FrameMismatch)
}

/// Selects each member's one BAR schedule for the frame, by the rule the host's initial readback
/// uses, over the same candidate set its admitted port returns.
async fn member_schedules(
    transaction: &mut Transaction<'_, Postgres>,
    frame: &crate::owner::strategy_input_binding::StrategyInputUniverseFrameReceipt,
    requests: &[UntrustedStrategyInputBindingRequest],
    batch: &crate::owner::pit_snapshot::VerifiedPitObservationBatch,
    frame_time_ns: u64,
) -> Result<Vec<BarScheduleReadbackV1>, UniverseSampleProjectionIssuanceErrorV1> {
    use UniverseSampleProjectionIssuanceErrorV1 as E;

    let timeframes = requests
        .iter()
        .map(|request| request.timeframe.as_str())
        .collect::<BTreeSet<_>>();
    let [timeframe] = timeframes.into_iter().collect::<Vec<_>>()[..] else {
        return Err(E::ScheduleUnavailable);
    };
    let mut schedules = Vec::with_capacity(frame.selection().members().len());

    for member in frame.selection().members() {
        let candidates = load_bar_schedule_candidates(transaction, member.instrument())
            .await
            .map_err(|_| E::StoreUnavailable)?;
        schedules.push(
            select_native_replay_schedule_for_member_v1(
                candidates,
                batch,
                member.instrument(),
                timeframe,
                frame_time_ns,
            )
            .map_err(|_| E::ScheduleUnavailable)?,
        );
    }
    Ok(schedules)
}

async fn persist_projection(
    transaction: &mut Transaction<'_, Postgres>,
    projection: &StrategyInputUniverseSampleProjectionReadbackV1,
) -> Result<(), UniverseSampleProjectionIssuanceErrorV1> {
    use UniverseSampleProjectionIssuanceErrorV1 as E;

    let stored: Option<Vec<u8>> = sqlx::query_scalar("SELECT projection_identity FROM market_data_private.universe_sample_projections_v1 WHERE subject_identity=$1")
        .bind(projection.subject().as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| E::StoreUnavailable)?;

    match stored {
        Some(identity) if identity.as_slice() == projection.identity().as_bytes().as_slice() => {
            Ok(())
        }
        Some(_) => Err(E::SubjectConflict),
        None => {
            sqlx::query("INSERT INTO market_data_private.universe_sample_projections_v1(projection_identity,subject_identity,projection_bytes) VALUES ($1,$2,$3)")
                .bind(projection.identity().as_bytes().as_slice())
                .bind(projection.subject().as_bytes().as_slice())
                .bind(projection.canonical_bytes())
                .execute(&mut **transaction)
                .await
                .map_err(|_| E::StoreUnavailable)?;
            sqlx::query("INSERT INTO market_data_private.universe_sample_projection_outbox_v1(outbox_identity,payload_bytes) VALUES ($1,$2)")
                .bind(projection.identity().as_bytes().as_slice())
                .bind(projection.canonical_bytes())
                .execute(&mut **transaction)
                .await
                .map_err(|_| E::StoreUnavailable)?;
            Ok(())
        }
    }
}

async fn recorded_binding(
    transaction: &mut Transaction<'_, Postgres>,
    request_key: BindingDigest,
) -> Result<Option<(BindingDigest, BindingDigest)>, UniverseSampleProjectionIssuanceErrorV1> {
    let row = sqlx::query("SELECT binding_identity,binding_digest FROM market_data_private.universe_sample_projection_issuances_v1 WHERE request_key=$1")
        .bind(request_key.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable)?;
    row.map(|row| {
        Ok((
            digest_column(&row, "binding_identity")?,
            digest_column(&row, "binding_digest")?,
        ))
    })
    .transpose()
}

async fn issued_projections(
    transaction: &mut Transaction<'_, Postgres>,
    request_key: BindingDigest,
) -> Result<
    Box<[StrategyInputUniverseSampleProjectionReadbackV1]>,
    UniverseSampleProjectionIssuanceErrorV1,
> {
    let rows = sqlx::query("SELECT p.projection_identity,p.projection_bytes,o.payload_bytes FROM market_data_private.universe_sample_projection_issued_frames_v1 AS i JOIN market_data_private.universe_sample_projections_v1 AS p ON p.projection_identity=i.projection_identity JOIN market_data_private.universe_sample_projection_outbox_v1 AS o ON o.outbox_identity=p.projection_identity WHERE i.request_key=$1 ORDER BY i.frame_ordinal")
        .bind(request_key.as_bytes().as_slice())
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable)?;

    if rows.is_empty() {
        return Err(UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable);
    }
    rows.iter().map(decode_projection_row).collect()
}

/// Decodes one stored projection and its outbox payload, which must be the same exact bytes.
fn decode_projection_row(
    row: &sqlx::postgres::PgRow,
) -> Result<StrategyInputUniverseSampleProjectionReadbackV1, UniverseSampleProjectionIssuanceErrorV1>
{
    use UniverseSampleProjectionIssuanceErrorV1 as E;

    let identity = digest_column(row, "projection_identity")?;
    let bytes: Vec<u8> = row
        .try_get("projection_bytes")
        .map_err(|_| E::StoreUnavailable)?;
    let payload: Vec<u8> = row
        .try_get("payload_bytes")
        .map_err(|_| E::StoreUnavailable)?;

    if payload != bytes {
        return Err(E::StoreUnavailable);
    }
    StrategyInputUniverseSampleProjectionReadbackV1::decode(identity, &bytes)
        .map_err(|_| E::StoreUnavailable)
}

fn digest_column(
    row: &sqlx::postgres::PgRow,
    name: &str,
) -> Result<BindingDigest, UniverseSampleProjectionIssuanceErrorV1> {
    let bytes: Vec<u8> = row
        .try_get(name)
        .map_err(|_| UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable)?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable)?;
    Ok(BindingDigest::from_untrusted_bytes(bytes))
}
