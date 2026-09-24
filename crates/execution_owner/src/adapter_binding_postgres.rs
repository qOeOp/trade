//! PostgreSQL custody for Execution PAPER adapter bindings and account opening facts.
//!
//! This is the only production store. It applies the single Owner rule owned by
//! [`crate::adapter_binding`] under one exclusive per-node stream lock, persists each fact together
//! with its outbox record, and reads back through the same sealed resolution rule. Time is sampled
//! from the composition-injected [`ExecutionOwnerClock`]; a caller never supplies it.
//!
//! The pool is never exposed outside test code:
//!
//! ```compile_fail
//! use vibe_execution_owner::adapter_binding_postgres::PaperAdapterBindingPostgresV1;
//!
//! fn raw_writer(owner: &PaperAdapterBindingPostgresV1) {
//!     let _ = owner.pool();
//! }
//! ```

use std::{
    fmt::Debug,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgPoolOptions};

use crate::{
    adapter_binding::{
        AdapterBindingCommitDisposition, AdapterBindingError, AdmittedPaperAdapterBinding,
        BindingFactRecord, CommitContext, CommitInsert, CommitPlan, NamespaceClass,
        NamespaceReservation, PAPER_ADAPTER_BINDING_OUTBOX_KIND, PaperAdapterBindingCommitReceipt,
        PaperAdapterBindingDraft, PaperAdapterBindingLocator, PaperAdapterBindingReadPort,
        PaperAdapterCapability, PaperMode, TrustedClock, normalize_draft, plan_commit,
        resolve_fact, stream_identity_for_node,
    },
    paper_account_opening::{
        OpeningMeaning, PAPER_ACCOUNT_OPENING_KIND, PAPER_ACCOUNT_OPENING_SCHEMA_VERSION,
        PaperAccountOpeningDraft, PaperAccountOpeningError, PaperAccountOpeningFact,
        derive_opening_fact_identity, validate_amount, validate_currency,
    },
};

/// Canonical PostgreSQL role that owns every Execution relation.
pub const EXECUTION_OWNER_ROLE: &str = "execution_owner";
/// Canonical login role admitted to write through this custody.
pub const EXECUTION_WRITER_ROLE: &str = "execution_writer";
/// Private schema holding every Execution Owner relation.
pub const EXECUTION_PRIVATE_SCHEMA: &str = "execution_private";
/// Read-only schema exposing sealed readbacks to other Owners.
pub const EXECUTION_API_SCHEMA: &str = "execution_api";

const OWNED_TABLES: [&str; 6] = [
    "execution_paper_adapter_binding_streams_v1",
    "execution_paper_adapter_binding_facts_v1",
    "execution_paper_adapter_binding_heads_v1",
    "execution_paper_namespace_reservations_v1",
    "execution_paper_adapter_binding_outbox_v1",
    "execution_paper_account_opening_facts_v1",
];

/// Owner-trusted clock injected by the legal Execution composition root.
pub trait ExecutionOwnerClock: Send + Sync + Debug {
    /// Samples the current Owner-trusted time.
    ///
    /// # Errors
    ///
    /// Returns [`AdapterBindingError::InvalidTimeEvidence`] when no valid sample exists.
    fn now(&self) -> Result<TrustedClock, AdapterBindingError>;
}

/// System clock under one configured clock epoch.
///
/// The deployment fixes the epoch; a Shared Time handoff may replace this adapter without touching
/// the Owner rule.
#[derive(Debug, Clone, Copy)]
pub struct SystemExecutionOwnerClock {
    clock_epoch: u64,
}

impl SystemExecutionOwnerClock {
    /// Builds the system clock for one nonzero deployment clock epoch.
    ///
    /// # Errors
    ///
    /// Returns [`AdapterBindingError::InvalidTimeEvidence`] for a zero epoch.
    pub fn new(clock_epoch: u64) -> Result<Self, AdapterBindingError> {
        if clock_epoch == 0 {
            return Err(AdapterBindingError::InvalidTimeEvidence);
        }
        Ok(Self { clock_epoch })
    }
}

impl ExecutionOwnerClock for SystemExecutionOwnerClock {
    fn now(&self) -> Result<TrustedClock, AdapterBindingError> {
        let now_epoch_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| AdapterBindingError::InvalidTimeEvidence)?
            .as_millis();
        let now_epoch_ms =
            u64::try_from(now_epoch_ms).map_err(|_| AdapterBindingError::InvalidTimeEvidence)?;
        TrustedClock::new(now_epoch_ms, self.clock_epoch)
    }
}

/// Execution Owner PostgreSQL custody node.
pub struct PaperAdapterBindingPostgresV1 {
    pool: PgPool,
    node_identity: String,
    stream_identity: String,
    clock: Arc<dyn ExecutionOwnerClock>,
}

impl Debug for PaperAdapterBindingPostgresV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(PaperAdapterBindingPostgresV1))
            .field("node_identity", &self.node_identity)
            .field("stream_identity", &self.stream_identity)
            .finish_non_exhaustive()
    }
}

impl PaperAdapterBindingPostgresV1 {
    /// Connects as the Execution writer and materializes the Owner relations under
    /// `execution_private`, then registers this custody node's outbox stream.
    ///
    /// # Errors
    ///
    /// Returns [`AdapterBindingError`] when the role is not the admitted writer, the schema is
    /// absent, DDL fails, or the node identity is malformed.
    pub async fn connect(
        database_url: &str,
        node_identity: impl Into<String>,
        clock: Arc<dyn ExecutionOwnerClock>,
    ) -> Result<Self, AdapterBindingError> {
        let owner = Self::attach(database_url, node_identity, clock).await?;
        owner.migrate().await?;
        owner.verify_admission(true).await?;
        owner.register_stream().await?;
        Ok(owner)
    }

    /// Connects to an already materialized Owner topology without running DDL.
    ///
    /// # Errors
    ///
    /// Returns [`AdapterBindingError::StoreUnavailable`] when the role, its membership, or the
    /// owned relations do not match the canonical Execution topology.
    pub async fn connect_existing(
        database_url: &str,
        node_identity: impl Into<String>,
        clock: Arc<dyn ExecutionOwnerClock>,
    ) -> Result<Self, AdapterBindingError> {
        let owner = Self::attach(database_url, node_identity, clock).await?;
        owner.verify_admission(true).await?;
        owner.register_stream().await?;
        Ok(owner)
    }

    async fn attach(
        database_url: &str,
        node_identity: impl Into<String>,
        clock: Arc<dyn ExecutionOwnerClock>,
    ) -> Result<Self, AdapterBindingError> {
        let node_identity = node_identity.into();
        crate::adapter_binding::validate_node_identity(&node_identity)?;
        let pool = PgPoolOptions::new()
            .max_connections(8)
            .connect(database_url)
            .await
            .map_err(|_| AdapterBindingError::StoreUnavailable)?;
        Ok(Self {
            pool,
            stream_identity: stream_identity_for_node(&node_identity),
            node_identity,
            clock,
        })
    }

    #[cfg(test)]
    pub(crate) fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Returns the custody node identity.
    #[must_use]
    pub fn node_identity(&self) -> &str {
        &self.node_identity
    }

    async fn migrate(&self) -> Result<(), AdapterBindingError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        sqlx::query("SET LOCAL ROLE execution_owner")
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;

        for statement in [
            "CREATE TABLE IF NOT EXISTS execution_private.execution_paper_adapter_binding_streams_v1 ( \
                stream_identity TEXT PRIMARY KEY CHECK (stream_identity <> ''), \
                owner_node_identity TEXT NOT NULL CHECK (owner_node_identity <> ''), \
                next_sequence BIGINT NOT NULL CHECK (next_sequence > 0))",
            "CREATE TABLE IF NOT EXISTS execution_private.execution_paper_adapter_binding_facts_v1 ( \
                fact_identity TEXT PRIMARY KEY CHECK (fact_identity <> ''), \
                execution_scope_identity TEXT NOT NULL CHECK (execution_scope_identity <> ''), \
                generation BIGINT NOT NULL CHECK (generation > 0), \
                content_digest TEXT NOT NULL CHECK (content_digest <> ''), \
                stream_identity TEXT NOT NULL REFERENCES execution_private.execution_paper_adapter_binding_streams_v1(stream_identity), \
                sequence BIGINT NOT NULL CHECK (sequence > 0), \
                meaning_json JSONB NOT NULL, \
                locator_json JSONB NOT NULL, \
                committed_at_epoch_ms BIGINT NOT NULL CHECK (committed_at_epoch_ms > 0), \
                UNIQUE (execution_scope_identity, generation), \
                UNIQUE (stream_identity, sequence))",
            "CREATE TABLE IF NOT EXISTS execution_private.execution_paper_adapter_binding_heads_v1 ( \
                execution_scope_identity TEXT PRIMARY KEY CHECK (execution_scope_identity <> ''), \
                fact_identity TEXT NOT NULL REFERENCES execution_private.execution_paper_adapter_binding_facts_v1(fact_identity))",
            "CREATE TABLE IF NOT EXISTS execution_private.execution_paper_namespace_reservations_v1 ( \
                namespace TEXT PRIMARY KEY CHECK (namespace <> ''), \
                mode TEXT NOT NULL CHECK (mode = 'PAPER'), \
                namespace_class TEXT NOT NULL CHECK (namespace_class IN ('ACCOUNT', 'EFFECT')), \
                execution_scope_identity TEXT NOT NULL CHECK (execution_scope_identity <> ''))",
            "CREATE TABLE IF NOT EXISTS execution_private.execution_paper_adapter_binding_outbox_v1 ( \
                outbox_identity TEXT PRIMARY KEY CHECK (outbox_identity <> ''), \
                outbox_kind TEXT NOT NULL CHECK (outbox_kind <> ''), \
                fact_identity TEXT NOT NULL REFERENCES execution_private.execution_paper_adapter_binding_facts_v1(fact_identity), \
                content_digest TEXT NOT NULL CHECK (content_digest <> ''), \
                stream_identity TEXT NOT NULL, \
                cut_identity TEXT NOT NULL, \
                sequence BIGINT NOT NULL CHECK (sequence > 0), \
                committed_at_epoch_ms BIGINT NOT NULL CHECK (committed_at_epoch_ms > 0), \
                UNIQUE (stream_identity, sequence))",
            "CREATE TABLE IF NOT EXISTS execution_private.execution_paper_account_opening_facts_v1 ( \
                fact_identity TEXT PRIMARY KEY CHECK (fact_identity <> ''), \
                account_namespace TEXT NOT NULL UNIQUE CHECK (account_namespace <> ''), \
                execution_scope_identity TEXT NOT NULL CHECK (execution_scope_identity <> ''), \
                binding_fact_identity TEXT NOT NULL REFERENCES execution_private.execution_paper_adapter_binding_facts_v1(fact_identity), \
                stream_identity TEXT NOT NULL REFERENCES execution_private.execution_paper_adapter_binding_streams_v1(stream_identity), \
                sequence BIGINT NOT NULL CHECK (sequence > 0), \
                meaning_json JSONB NOT NULL, \
                committed_at_epoch_ms BIGINT NOT NULL CHECK (committed_at_epoch_ms > 0), \
                UNIQUE (stream_identity, sequence))",
            "CREATE OR REPLACE FUNCTION execution_api.read_current_paper_adapter_binding_v1(scope_identity text) \
             RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER \
             SET search_path = pg_catalog, pg_temp AS $$ \
                SELECT jsonb_build_object( \
                    'fact_identity', fact.fact_identity, \
                    'content_digest', fact.content_digest, \
                    'locator', fact.locator_json, \
                    'binding', fact.meaning_json - 'credential_handle_identity') \
                  FROM execution_private.execution_paper_adapter_binding_heads_v1 head \
                  JOIN execution_private.execution_paper_adapter_binding_facts_v1 fact \
                    ON fact.fact_identity = head.fact_identity \
                 WHERE head.execution_scope_identity = scope_identity \
             $$",
            "CREATE OR REPLACE FUNCTION execution_api.read_paper_account_opening_fact_v1(namespace text) \
             RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER \
             SET search_path = pg_catalog, pg_temp AS $$ \
                SELECT jsonb_build_object( \
                    'fact_identity', fact.fact_identity, \
                    'sequence', fact.sequence, \
                    'opening', fact.meaning_json) \
                  FROM execution_private.execution_paper_account_opening_facts_v1 fact \
                 WHERE fact.account_namespace = namespace \
             $$",
            "REVOKE ALL ON FUNCTION execution_api.read_current_paper_adapter_binding_v1(text) FROM PUBLIC",
            "REVOKE ALL ON FUNCTION execution_api.read_paper_account_opening_fact_v1(text) FROM PUBLIC",
            // Strategy Governance must reread the admitted binding before it creates an Execution
            // Scope, and Portfolio must reread the opening collateral fact before it projects a
            // PAPER Capacity View. Each consumer gets exactly the one function it needs.
            "GRANT EXECUTE ON FUNCTION execution_api.read_current_paper_adapter_binding_v1(text) TO governance_writer",
            "GRANT EXECUTE ON FUNCTION execution_api.read_paper_account_opening_fact_v1(text) TO portfolio_writer",
        ] {
            sqlx::query(statement)
                .execute(&mut *transaction)
                .await
                .map_err(storage)?;
        }
        transaction.commit().await.map_err(storage)
    }

    async fn verify_admission(&self, require_tables: bool) -> Result<(), AdapterBindingError> {
        let expected_tables = if require_tables {
            OWNED_TABLES.len() as i64
        } else {
            0
        };
        let admitted: bool = sqlx::query_scalar(
            "SELECT session_user::pg_catalog.text = $1
                    AND current_user::pg_catalog.text = $1
                    AND NOT pg_catalog.pg_is_in_recovery()
                    AND role.rolcanlogin
                    AND role.rolinherit
                    AND NOT role.rolsuper
                    AND NOT role.rolcreatedb
                    AND NOT role.rolcreaterole
                    AND NOT role.rolreplication
                    AND NOT role.rolbypassrls
                    AND (
                      SELECT pg_catalog.count(*) = 1
                        FROM pg_catalog.pg_auth_members membership
                        JOIN pg_catalog.pg_roles granted
                          ON granted.oid = membership.roleid
                       WHERE membership.member = role.oid
                         AND granted.rolname::pg_catalog.text = $2
                    )
                    AND (
                      SELECT pg_catalog.count(*) = 1
                        FROM pg_catalog.pg_auth_members membership
                       WHERE membership.member = role.oid
                    )
                    AND (
                      SELECT pg_catalog.count(*) >= $4
                        FROM pg_catalog.pg_class relation
                        JOIN pg_catalog.pg_namespace namespace
                          ON namespace.oid = relation.relnamespace
                       WHERE namespace.nspname::pg_catalog.text = $3
                         AND relation.relname = ANY($5::pg_catalog.text[])
                         AND relation.relkind = 'r'
                         AND relation.relowner = pg_catalog.to_regrole($2::pg_catalog.text)::oid
                    )
               FROM pg_catalog.pg_roles role
              WHERE role.rolname = current_user",
        )
        .bind(EXECUTION_WRITER_ROLE)
        .bind(EXECUTION_OWNER_ROLE)
        .bind(EXECUTION_PRIVATE_SCHEMA)
        .bind(expected_tables)
        .bind(OWNED_TABLES.to_vec())
        .fetch_one(&self.pool)
        .await
        .map_err(storage)?;

        if !admitted {
            return Err(AdapterBindingError::StoreUnavailable);
        }
        Ok(())
    }

    async fn register_stream(&self) -> Result<(), AdapterBindingError> {
        sqlx::query(
            "INSERT INTO execution_private.execution_paper_adapter_binding_streams_v1
                (stream_identity, owner_node_identity, next_sequence)
             VALUES ($1, $2, 1)
             ON CONFLICT (stream_identity) DO NOTHING",
        )
        .bind(&self.stream_identity)
        .bind(&self.node_identity)
        .execute(&self.pool)
        .await
        .map_err(storage)?;
        Ok(())
    }

    /// Validates, normalizes, and atomically records one binding fact and its outbox record.
    ///
    /// Exact replay joins the earlier record; changed meaning under the same scope and generation
    /// conflicts before any successor write. Every validation runs before a write.
    ///
    /// # Errors
    ///
    /// Returns [`AdapterBindingError`] when validation, generation, replay, namespace, or custody
    /// fails.
    pub async fn commit(
        &self,
        draft: PaperAdapterBindingDraft,
    ) -> Result<PaperAdapterBindingCommitReceipt, AdapterBindingError> {
        let meaning = normalize_draft(draft)?;
        let trusted_clock = self.clock.now()?;
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let next_sequence = self.lock_stream(&mut transaction).await?;
        let slot_fact = load_fact_for_slot(
            &mut transaction,
            &meaning.execution_scope_identity,
            meaning.generation,
        )
        .await?;
        let head_fact = load_head_fact(&mut transaction, &meaning.execution_scope_identity).await?;
        let account_reservation =
            load_reservation(&mut transaction, &meaning.account_namespace).await?;
        let effect_reservation =
            load_reservation(&mut transaction, &meaning.effect_namespace).await?;
        let plan = plan_commit(
            meaning,
            &CommitContext {
                node_identity: &self.node_identity,
                stream_identity: &self.stream_identity,
                trusted_clock,
                next_sequence,
                slot_fact: slot_fact.as_ref(),
                head_fact: head_fact.as_ref(),
                account_reservation: account_reservation.as_ref(),
                effect_reservation: effect_reservation.as_ref(),
            },
        )?;

        let receipt = match plan {
            CommitPlan::ExactReplay(locator) => PaperAdapterBindingCommitReceipt {
                disposition: AdapterBindingCommitDisposition::ExactReplay,
                locator: *locator,
            },
            CommitPlan::Insert(insert) => {
                let CommitInsert {
                    fact,
                    outbox,
                    reservations,
                    next_sequence,
                } = *insert;
                let locator = fact.locator.clone();
                sqlx::query(
                    "INSERT INTO execution_private.execution_paper_adapter_binding_facts_v1
                        (fact_identity, execution_scope_identity, generation, content_digest,
                         stream_identity, sequence, meaning_json, locator_json, committed_at_epoch_ms)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
                )
                .bind(&locator.fact_identity)
                .bind(&locator.execution_scope_identity)
                .bind(to_i64(locator.generation)?)
                .bind(&locator.content_digest)
                .bind(&locator.frontier.stream_identity)
                .bind(to_i64(locator.frontier.sequence)?)
                .bind(serde_json::to_value(&fact.meaning).map_err(|_| AdapterBindingError::StoreUnavailable)?)
                .bind(serde_json::to_value(&fact.locator).map_err(|_| AdapterBindingError::StoreUnavailable)?)
                .bind(to_i64(trusted_clock.now_epoch_ms)?)
                .execute(&mut *transaction)
                .await
                .map_err(storage)?;
                sqlx::query(
                    "INSERT INTO execution_private.execution_paper_adapter_binding_heads_v1
                        (execution_scope_identity, fact_identity)
                     VALUES ($1, $2)
                     ON CONFLICT (execution_scope_identity) DO UPDATE SET fact_identity = EXCLUDED.fact_identity",
                )
                .bind(&locator.execution_scope_identity)
                .bind(&locator.fact_identity)
                .execute(&mut *transaction)
                .await
                .map_err(storage)?;

                for (namespace, reservation) in reservations {
                    let inserted = sqlx::query(
                        "INSERT INTO execution_private.execution_paper_namespace_reservations_v1
                            (namespace, mode, namespace_class, execution_scope_identity)
                         VALUES ($1, 'PAPER', $2, $3)
                         ON CONFLICT (namespace) DO NOTHING",
                    )
                    .bind(&namespace)
                    .bind(reservation.namespace_class.as_str())
                    .bind(&reservation.execution_scope_identity)
                    .execute(&mut *transaction)
                    .await
                    .map_err(storage)?;
                    debug_assert!(inserted.rows_affected() <= 1);
                }
                sqlx::query(
                    "INSERT INTO execution_private.execution_paper_adapter_binding_outbox_v1
                        (outbox_identity, outbox_kind, fact_identity, content_digest, stream_identity,
                         cut_identity, sequence, committed_at_epoch_ms)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
                )
                .bind(&outbox.outbox_identity)
                .bind(PAPER_ADAPTER_BINDING_OUTBOX_KIND)
                .bind(&outbox.fact_identity)
                .bind(&outbox.content_digest)
                .bind(&outbox.frontier.stream_identity)
                .bind(&outbox.frontier.cut_identity)
                .bind(to_i64(outbox.frontier.sequence)?)
                .bind(to_i64(trusted_clock.now_epoch_ms)?)
                .execute(&mut *transaction)
                .await
                .map_err(storage)?;
                self.advance_stream(&mut transaction, next_sequence).await?;
                PaperAdapterBindingCommitReceipt {
                    disposition: AdapterBindingCommitDisposition::Inserted,
                    locator,
                }
            }
        };
        transaction.commit().await.map_err(storage)?;
        Ok(receipt)
    }

    /// Commits the opening collateral fact of one simulated PAPER account.
    ///
    /// The binding locator must resolve to the current admitted head. Exact replay joins the
    /// earlier fact; a different opening for the same account namespace conflicts.
    ///
    /// # Errors
    ///
    /// Returns [`PaperAccountOpeningError`] when the proposal, binding, replay, or custody fails.
    pub async fn commit_account_opening_fact(
        &self,
        draft: PaperAccountOpeningDraft,
    ) -> Result<PaperAccountOpeningFact, PaperAccountOpeningError> {
        if draft.schema_version != PAPER_ACCOUNT_OPENING_SCHEMA_VERSION {
            return Err(PaperAccountOpeningError::InvalidField("schema_version"));
        }
        validate_currency(&draft.collateral_currency)?;
        validate_amount(&draft.collateral_amount)?;

        if draft.observed_at_epoch_ms == 0 || draft.clock_epoch == 0 {
            return Err(PaperAccountOpeningError::InvalidTimeEvidence);
        }
        let trusted_clock = self
            .clock
            .now()
            .map_err(|_| PaperAccountOpeningError::InvalidTimeEvidence)?;

        if draft.clock_epoch != trusted_clock.clock_epoch
            || draft.observed_at_epoch_ms > trusted_clock.now_epoch_ms
        {
            return Err(PaperAccountOpeningError::InvalidTimeEvidence);
        }
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?;
        let next_sequence = self
            .lock_stream(&mut transaction)
            .await
            .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?;
        let binding = self
            .resolve_in_transaction(
                &mut transaction,
                &draft.binding_locator,
                &[PaperAdapterCapability::AccountReadback],
                trusted_clock,
            )
            .await
            .map_err(|_| PaperAccountOpeningError::BindingNotAdmitted)?;

        if draft.observed_at_epoch_ms < binding.effective_at_epoch_ms() {
            return Err(PaperAccountOpeningError::InvalidTimeEvidence);
        }
        let meaning = OpeningMeaning {
            schema_version: draft.schema_version,
            account_namespace: binding.account_namespace().to_string(),
            execution_scope_identity: binding.execution_scope_identity().to_string(),
            binding_fact_identity: binding.locator().fact_identity.clone(),
            collateral_currency: draft.collateral_currency,
            collateral_amount: draft.collateral_amount,
            observed_at_epoch_ms: draft.observed_at_epoch_ms,
            clock_epoch: draft.clock_epoch,
        };
        let existing = sqlx::query(
            "SELECT fact_identity, sequence, meaning_json
               FROM execution_private.execution_paper_account_opening_facts_v1
              WHERE account_namespace = $1",
        )
        .bind(&meaning.account_namespace)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?;

        if let Some(row) = existing {
            let stored: OpeningMeaning = serde_json::from_value(
                row.try_get("meaning_json")
                    .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?,
            )
            .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?;

            if stored != meaning {
                return Err(PaperAccountOpeningError::ConflictingReplay);
            }
            let fact_identity: String = row
                .try_get("fact_identity")
                .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?;
            let sequence: i64 = row
                .try_get("sequence")
                .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?;
            let sequence =
                u64::try_from(sequence).map_err(|_| PaperAccountOpeningError::StoreUnavailable)?;
            transaction
                .rollback()
                .await
                .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?;
            return Ok(PaperAccountOpeningFact::seal(
                fact_identity,
                stored,
                sequence,
            ));
        }
        let fact_identity = derive_opening_fact_identity(&meaning);
        let fact = PaperAccountOpeningFact::seal(fact_identity, meaning, next_sequence);
        sqlx::query(
            "INSERT INTO execution_private.execution_paper_account_opening_facts_v1
                (fact_identity, account_namespace, execution_scope_identity, binding_fact_identity,
                 stream_identity, sequence, meaning_json, committed_at_epoch_ms)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(fact.fact_identity())
        .bind(fact.account_namespace())
        .bind(fact.execution_scope_identity())
        .bind(fact.binding_fact_identity())
        .bind(&self.stream_identity)
        .bind(to_i64(next_sequence).map_err(|_| PaperAccountOpeningError::StoreUnavailable)?)
        .bind(
            serde_json::to_value(fact.meaning())
                .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?,
        )
        .bind(
            to_i64(trusted_clock.now_epoch_ms)
                .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?,
        )
        .execute(&mut *transaction)
        .await
        .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?;
        sqlx::query(
            "INSERT INTO execution_private.execution_paper_adapter_binding_outbox_v1
                (outbox_identity, outbox_kind, fact_identity, content_digest, stream_identity,
                 cut_identity, sequence, committed_at_epoch_ms)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(format!(
            "{}:{}",
            PAPER_ACCOUNT_OPENING_KIND,
            fact.fact_identity()
        ))
        .bind(PAPER_ACCOUNT_OPENING_KIND)
        .bind(fact.binding_fact_identity())
        .bind(fact.fact_identity())
        .bind(&self.stream_identity)
        .bind(format!("{}:{next_sequence}", self.stream_identity))
        .bind(to_i64(next_sequence).map_err(|_| PaperAccountOpeningError::StoreUnavailable)?)
        .bind(
            to_i64(trusted_clock.now_epoch_ms)
                .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?,
        )
        .execute(&mut *transaction)
        .await
        .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?;
        let successor = next_sequence
            .checked_add(1)
            .ok_or(PaperAccountOpeningError::StoreUnavailable)?;
        self.advance_stream(&mut transaction, successor)
            .await
            .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?;
        transaction
            .commit()
            .await
            .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?;
        Ok(fact)
    }

    /// Reads back the sealed opening fact of one account namespace.
    ///
    /// # Errors
    ///
    /// Returns [`PaperAccountOpeningError::FactNotFound`] when no fact exists, or
    /// [`PaperAccountOpeningError::StoreUnavailable`] when custody is unavailable.
    pub async fn read_account_opening_fact(
        &self,
        account_namespace: &str,
    ) -> Result<PaperAccountOpeningFact, PaperAccountOpeningError> {
        let row = sqlx::query(
            "SELECT fact_identity, sequence, meaning_json
               FROM execution_private.execution_paper_account_opening_facts_v1
              WHERE account_namespace = $1",
        )
        .bind(account_namespace)
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?
        .ok_or(PaperAccountOpeningError::FactNotFound)?;
        let meaning: OpeningMeaning = serde_json::from_value(
            row.try_get("meaning_json")
                .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?,
        )
        .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?;

        if meaning.account_namespace != account_namespace {
            return Err(PaperAccountOpeningError::StoreUnavailable);
        }
        let fact_identity: String = row
            .try_get("fact_identity")
            .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?;

        if derive_opening_fact_identity(&meaning) != fact_identity {
            return Err(PaperAccountOpeningError::StoreUnavailable);
        }
        let sequence: i64 = row
            .try_get("sequence")
            .map_err(|_| PaperAccountOpeningError::StoreUnavailable)?;
        let sequence =
            u64::try_from(sequence).map_err(|_| PaperAccountOpeningError::StoreUnavailable)?;
        Ok(PaperAccountOpeningFact::seal(
            fact_identity,
            meaning,
            sequence,
        ))
    }

    async fn lock_stream(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
    ) -> Result<u64, AdapterBindingError> {
        let next_sequence: i64 = sqlx::query_scalar(
            "SELECT next_sequence
               FROM execution_private.execution_paper_adapter_binding_streams_v1
              WHERE stream_identity = $1 AND owner_node_identity = $2
                FOR UPDATE",
        )
        .bind(&self.stream_identity)
        .bind(&self.node_identity)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(storage)?
        .ok_or(AdapterBindingError::StoreUnavailable)?;
        u64::try_from(next_sequence).map_err(|_| AdapterBindingError::StoreUnavailable)
    }

    async fn advance_stream(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        next_sequence: u64,
    ) -> Result<(), AdapterBindingError> {
        let updated = sqlx::query(
            "UPDATE execution_private.execution_paper_adapter_binding_streams_v1
                SET next_sequence = $2
              WHERE stream_identity = $1 AND next_sequence < $2",
        )
        .bind(&self.stream_identity)
        .bind(to_i64(next_sequence)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;

        if updated.rows_affected() != 1 {
            return Err(AdapterBindingError::StoreUnavailable);
        }
        Ok(())
    }

    async fn resolve_in_transaction(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        locator: &PaperAdapterBindingLocator,
        required_capabilities: &[PaperAdapterCapability],
        trusted_clock: TrustedClock,
    ) -> Result<AdmittedPaperAdapterBinding, AdapterBindingError> {
        let fact = load_fact_by_identity(transaction, &locator.fact_identity)
            .await?
            .ok_or(AdapterBindingError::FactNotFound)?;
        let head_identity: Option<String> = sqlx::query_scalar(
            "SELECT fact_identity
               FROM execution_private.execution_paper_adapter_binding_heads_v1
              WHERE execution_scope_identity = $1",
        )
        .bind(&fact.meaning.execution_scope_identity)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(storage)?;
        resolve_fact(
            &fact,
            locator,
            head_identity.as_deref(),
            required_capabilities,
            trusted_clock,
        )
    }
}

#[async_trait::async_trait]
impl PaperAdapterBindingReadPort for PaperAdapterBindingPostgresV1 {
    async fn resolve_admitted(
        &self,
        locator: &PaperAdapterBindingLocator,
        required_capabilities: &[PaperAdapterCapability],
    ) -> Result<AdmittedPaperAdapterBinding, AdapterBindingError> {
        let trusted_clock = self.clock.now()?;
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
        let resolved = self
            .resolve_in_transaction(
                &mut transaction,
                locator,
                required_capabilities,
                trusted_clock,
            )
            .await;
        transaction.rollback().await.map_err(storage)?;
        resolved
    }
}

async fn load_fact_for_slot(
    transaction: &mut Transaction<'_, Postgres>,
    execution_scope_identity: &str,
    generation: u64,
) -> Result<Option<BindingFactRecord>, AdapterBindingError> {
    let row = sqlx::query(
        "SELECT meaning_json, locator_json
           FROM execution_private.execution_paper_adapter_binding_facts_v1
          WHERE execution_scope_identity = $1 AND generation = $2",
    )
    .bind(execution_scope_identity)
    .bind(to_i64(generation)?)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(storage)?;
    row.as_ref().map(fact_from_row).transpose()
}

async fn load_head_fact(
    transaction: &mut Transaction<'_, Postgres>,
    execution_scope_identity: &str,
) -> Result<Option<BindingFactRecord>, AdapterBindingError> {
    let row = sqlx::query(
        "SELECT fact.meaning_json, fact.locator_json
           FROM execution_private.execution_paper_adapter_binding_heads_v1 head
           JOIN execution_private.execution_paper_adapter_binding_facts_v1 fact
             ON fact.fact_identity = head.fact_identity
          WHERE head.execution_scope_identity = $1",
    )
    .bind(execution_scope_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(storage)?;
    row.as_ref().map(fact_from_row).transpose()
}

async fn load_fact_by_identity(
    transaction: &mut Transaction<'_, Postgres>,
    fact_identity: &str,
) -> Result<Option<BindingFactRecord>, AdapterBindingError> {
    let row = sqlx::query(
        "SELECT meaning_json, locator_json
           FROM execution_private.execution_paper_adapter_binding_facts_v1
          WHERE fact_identity = $1",
    )
    .bind(fact_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(storage)?;
    row.as_ref().map(fact_from_row).transpose()
}

async fn load_reservation(
    transaction: &mut Transaction<'_, Postgres>,
    namespace: &str,
) -> Result<Option<NamespaceReservation>, AdapterBindingError> {
    let row = sqlx::query(
        "SELECT mode, namespace_class, execution_scope_identity
           FROM execution_private.execution_paper_namespace_reservations_v1
          WHERE namespace = $1",
    )
    .bind(namespace)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(storage)?;
    let Some(row) = row else {
        return Ok(None);
    };
    let mode: String = row.try_get("mode").map_err(storage)?;

    if mode != "PAPER" {
        return Err(AdapterBindingError::StoreUnavailable);
    }
    let namespace_class: String = row.try_get("namespace_class").map_err(storage)?;
    Ok(Some(NamespaceReservation {
        mode: PaperMode::Paper,
        namespace_class: NamespaceClass::parse(&namespace_class)?,
        execution_scope_identity: row.try_get("execution_scope_identity").map_err(storage)?,
    }))
}

fn fact_from_row(row: &sqlx::postgres::PgRow) -> Result<BindingFactRecord, AdapterBindingError> {
    let meaning = serde_json::from_value(row.try_get("meaning_json").map_err(storage)?)
        .map_err(|_| AdapterBindingError::StoreUnavailable)?;
    let locator = serde_json::from_value(row.try_get("locator_json").map_err(storage)?)
        .map_err(|_| AdapterBindingError::StoreUnavailable)?;
    let record = BindingFactRecord { meaning, locator };

    if record.locator.state != record.meaning.state
        || record.locator.generation != record.meaning.generation
        || record.locator.execution_scope_identity != record.meaning.execution_scope_identity
    {
        return Err(AdapterBindingError::StoreUnavailable);
    }
    Ok(record)
}

fn to_i64(value: u64) -> Result<i64, AdapterBindingError> {
    i64::try_from(value).map_err(|_| AdapterBindingError::StoreUnavailable)
}

fn storage(error: sqlx::Error) -> AdapterBindingError {
    if cfg!(test) {
        eprintln!("execution custody storage error: {error}");
    }
    drop(error);
    AdapterBindingError::StoreUnavailable
}

#[cfg(test)]
mod tests {
    use std::{
        sync::Mutex,
        time::{SystemTime, UNIX_EPOCH},
    };

    use rstest::rstest;
    use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

    use super::*;
    use crate::adapter_binding::{
        AdapterBindingState, CredentialHandleIdentity, PaperAdapterCapability, ReduceOnlyPolicy,
        derive_paper_account_namespace, derive_paper_effect_namespace,
    };

    #[derive(Debug)]
    struct FixtureClock(Mutex<TrustedClock>);

    impl FixtureClock {
        fn new(now_epoch_ms: u64, clock_epoch: u64) -> Arc<Self> {
            Arc::new(Self(Mutex::new(
                TrustedClock::new(now_epoch_ms, clock_epoch).unwrap(),
            )))
        }

        fn set(&self, now_epoch_ms: u64, clock_epoch: u64) {
            *self.0.lock().unwrap() = TrustedClock::new(now_epoch_ms, clock_epoch).unwrap();
        }
    }

    impl ExecutionOwnerClock for FixtureClock {
        fn now(&self) -> Result<TrustedClock, AdapterBindingError> {
            Ok(*self.0.lock().unwrap())
        }
    }

    fn capabilities() -> Vec<PaperAdapterCapability> {
        vec![
            PaperAdapterCapability::SubmitOrder,
            PaperAdapterCapability::CancelOrder,
            PaperAdapterCapability::OrderReadback,
            PaperAdapterCapability::AccountReadback,
            PaperAdapterCapability::EnforceableReduceOnly,
        ]
    }

    fn draft(scope: &str) -> PaperAdapterBindingDraft {
        let mode = PaperMode::Paper;
        PaperAdapterBindingDraft {
            schema_version: 1,
            binding_version: 1,
            generation: 1,
            mode,
            execution_scope_identity: scope.to_string(),
            account_namespace: derive_paper_account_namespace(mode, scope).unwrap(),
            effect_namespace: derive_paper_effect_namespace(mode, scope).unwrap(),
            source_account_identity: "strategy-account-alpha".to_string(),
            simulator_account_identity: "sim-account-alpha".to_string(),
            simulator_endpoint_identity: "simulator:sandbox:alpha".to_string(),
            implementation_digest: "11".repeat(32),
            configuration_digest: "22".repeat(32),
            required_capabilities: capabilities(),
            reduce_only_policy: ReduceOnlyPolicy::SimulatorRejectIncreaseOrCrossZero,
            credential_handle_identity: CredentialHandleIdentity::parse(
                "credential-handle-paper-alpha",
            )
            .unwrap(),
            trust_policy_identity: "execution-paper-trust-v1".to_string(),
            state: AdapterBindingState::Admitted,
            effective_at_epoch_ms: 1_000,
            observed_at_epoch_ms: 1_100,
            exclusive_valid_through_epoch_ms: 2_000,
            clock_epoch: 7,
        }
    }

    fn suffix() -> String {
        format!(
            "{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )
    }

    async fn own_counts(pool: &PgPool, stream_identity: &str) -> (i64, i64, i64, i64) {
        let facts: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM execution_private.execution_paper_adapter_binding_facts_v1 WHERE stream_identity = $1",
        )
        .bind(stream_identity)
        .fetch_one(pool)
        .await
        .unwrap();
        let outbox: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM execution_private.execution_paper_adapter_binding_outbox_v1 WHERE stream_identity = $1",
        )
        .bind(stream_identity)
        .fetch_one(pool)
        .await
        .unwrap();
        let openings: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM execution_private.execution_paper_account_opening_facts_v1 WHERE stream_identity = $1",
        )
        .bind(stream_identity)
        .fetch_one(pool)
        .await
        .unwrap();
        let reservations: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM execution_private.execution_paper_namespace_reservations_v1 reservation
              WHERE EXISTS (SELECT 1 FROM execution_private.execution_paper_adapter_binding_facts_v1 fact
                             WHERE fact.stream_identity = $1
                               AND fact.execution_scope_identity = reservation.execution_scope_identity)",
        )
        .bind(stream_identity)
        .fetch_one(pool)
        .await
        .unwrap();
        (facts, outbox, openings, reservations)
    }

    async fn cleanup(pool: &PgPool, stream_identity: &str) {
        for statement in [
            "DELETE FROM execution_private.execution_paper_adapter_binding_outbox_v1 WHERE stream_identity = $1",
            "DELETE FROM execution_private.execution_paper_account_opening_facts_v1 WHERE stream_identity = $1",
            "DELETE FROM execution_private.execution_paper_adapter_binding_heads_v1 head
              WHERE EXISTS (SELECT 1 FROM execution_private.execution_paper_adapter_binding_facts_v1 fact
                             WHERE fact.fact_identity = head.fact_identity AND fact.stream_identity = $1)",
            "DELETE FROM execution_private.execution_paper_namespace_reservations_v1 reservation
              WHERE EXISTS (SELECT 1 FROM execution_private.execution_paper_adapter_binding_facts_v1 fact
                             WHERE fact.stream_identity = $1
                               AND fact.execution_scope_identity = reservation.execution_scope_identity)",
            "DELETE FROM execution_private.execution_paper_adapter_binding_facts_v1 WHERE stream_identity = $1",
            "DELETE FROM execution_private.execution_paper_adapter_binding_streams_v1 WHERE stream_identity = $1",
        ] {
            sqlx::query(statement)
                .bind(stream_identity)
                .execute(pool)
                .await
                .unwrap();
        }
    }

    #[rstest]
    fn system_clock_rejects_zero_epoch_and_samples_nonzero_time() {
        assert!(SystemExecutionOwnerClock::new(0).is_err());
        let sample = SystemExecutionOwnerClock::new(7).unwrap().now().unwrap();
        assert_eq!(sample.clock_epoch, 7);
        assert!(sample.now_epoch_ms > 0);
    }

    #[tokio::test]
    #[ignore = "requires the admitted canonical Owner PostgreSQL test topology"]
    async fn postgres_binding_custody_is_atomic_replay_safe_and_tamper_closed() {
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = test_database.mutation();
        let database_url = test_database.database_url(CanonicalOwnerTestRoleV1::ExecutionWriter);
        let suffix = suffix();
        let clock = FixtureClock::new(1_200, 7);
        let node_identity = format!("execution-node-{suffix}");
        let owner = PaperAdapterBindingPostgresV1::connect(
            database_url,
            node_identity.clone(),
            clock.clone(),
        )
        .await
        .unwrap();
        let stream_identity = stream_identity_for_node(&node_identity);
        let pool = owner.pool().clone();
        assert_eq!(own_counts(&pool, &stream_identity).await, (0, 0, 0, 0));

        // Restart joins the same registered stream without a second row.
        let restarted = PaperAdapterBindingPostgresV1::connect_existing(
            database_url,
            node_identity.clone(),
            clock.clone(),
        )
        .await
        .unwrap();
        let streams: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM execution_private.execution_paper_adapter_binding_streams_v1 WHERE stream_identity = $1",
        )
        .bind(&stream_identity)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(streams, 1);

        // Insert once, exact replay joins, both nodes resolve the complete immutable meaning.
        let alpha = format!("paper-scope-alpha-{suffix}");
        let inserted = owner.commit(draft(&alpha)).await.unwrap();
        assert_eq!(
            inserted.disposition,
            AdapterBindingCommitDisposition::Inserted
        );
        let replayed = restarted.commit(draft(&alpha)).await.unwrap();
        assert_eq!(
            replayed.disposition,
            AdapterBindingCommitDisposition::ExactReplay
        );
        assert_eq!(inserted.locator, replayed.locator);
        assert_eq!(own_counts(&pool, &stream_identity).await, (1, 1, 0, 2));
        let admitted = owner
            .resolve_admitted(&inserted.locator, &capabilities())
            .await
            .unwrap();
        assert_eq!(admitted.locator(), &inserted.locator);
        assert_eq!(
            admitted.account_namespace(),
            draft(&alpha).account_namespace
        );
        assert_eq!(admitted.capabilities(), capabilities());
        assert_eq!(
            restarted
                .resolve_admitted(&inserted.locator, &capabilities())
                .await
                .unwrap(),
            admitted
        );

        // Changed meaning under the same slot conflicts and leaves the pair untouched.
        let mut changed = draft(&alpha);
        changed.configuration_digest = "33".repeat(32);
        assert_eq!(
            owner.commit(changed).await,
            Err(AdapterBindingError::ConflictingReplay)
        );
        assert_eq!(own_counts(&pool, &stream_identity).await, (1, 1, 0, 2));

        // A namespace reserved by another scope is refused before any write.
        let beta = format!("paper-scope-beta-{suffix}");
        sqlx::query(
            "INSERT INTO execution_private.execution_paper_namespace_reservations_v1
                (namespace, mode, namespace_class, execution_scope_identity)
             VALUES ($1, 'PAPER', 'ACCOUNT', $2)",
        )
        .bind(draft(&beta).account_namespace)
        .bind(format!("paper-scope-other-{suffix}"))
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            owner.commit(draft(&beta)).await,
            Err(AdapterBindingError::NamespaceAlreadyReserved)
        );
        assert_eq!(own_counts(&pool, &stream_identity).await, (1, 1, 0, 2));
        sqlx::query(
            "DELETE FROM execution_private.execution_paper_namespace_reservations_v1 WHERE namespace = $1",
        )
        .bind(draft(&beta).account_namespace)
        .execute(&pool)
        .await
        .unwrap();

        // The simulated account opens exactly once under the admitted binding.
        let opening = PaperAccountOpeningDraft {
            schema_version: PAPER_ACCOUNT_OPENING_SCHEMA_VERSION,
            binding_locator: inserted.locator.clone(),
            collateral_currency: "USDT".to_string(),
            collateral_amount: "100000".to_string(),
            observed_at_epoch_ms: 1_150,
            clock_epoch: 7,
        };
        let opened = owner
            .commit_account_opening_fact(opening.clone())
            .await
            .unwrap();
        assert_eq!(opened.account_namespace(), admitted.account_namespace());
        assert_eq!(
            opened.binding_fact_identity(),
            inserted.locator.fact_identity
        );
        assert_eq!(opened.collateral_amount(), "100000");
        assert_eq!(
            owner
                .commit_account_opening_fact(opening.clone())
                .await
                .unwrap(),
            opened
        );
        let mut richer = opening.clone();
        richer.collateral_amount = "200000".to_string();
        assert_eq!(
            owner.commit_account_opening_fact(richer).await,
            Err(PaperAccountOpeningError::ConflictingReplay)
        );
        assert_eq!(
            owner
                .read_account_opening_fact(admitted.account_namespace())
                .await
                .unwrap(),
            opened
        );
        assert_eq!(own_counts(&pool, &stream_identity).await, (1, 2, 1, 2));
        let api_opening: serde_json::Value =
            sqlx::query_scalar("SELECT execution_api.read_paper_account_opening_fact_v1($1)")
                .bind(admitted.account_namespace())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(api_opening["fact_identity"], opened.fact_identity());
        assert_eq!(api_opening["opening"]["collateral_amount"], "100000");
        let api_binding: serde_json::Value =
            sqlx::query_scalar("SELECT execution_api.read_current_paper_adapter_binding_v1($1)")
                .bind(&alpha)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(api_binding["fact_identity"], inserted.locator.fact_identity);
        assert_eq!(api_binding["binding"]["state"], "ADMITTED");
        assert!(
            api_binding["binding"]
                .get("credential_handle_identity")
                .is_none()
        );

        // Generation gaps never write; a lawful revoking successor makes the head non-current.
        let mut gap = draft(&alpha);
        gap.generation = 3;
        gap.observed_at_epoch_ms = 1_150;
        assert!(matches!(
            owner.commit(gap).await,
            Err(AdapterBindingError::InvalidGeneration {
                expected: 2,
                actual: 3
            })
        ));
        let mut revoked = draft(&alpha);
        revoked.generation = 2;
        revoked.state = AdapterBindingState::Revoked;
        revoked.observed_at_epoch_ms = 1_150;
        let successor = owner.commit(revoked).await.unwrap();
        assert_eq!(
            successor.disposition,
            AdapterBindingCommitDisposition::Inserted
        );
        assert_eq!(
            owner
                .resolve_admitted(&inserted.locator, &capabilities())
                .await,
            Err(AdapterBindingError::NotCurrentHead)
        );
        assert_eq!(
            owner
                .resolve_admitted(&successor.locator, &capabilities())
                .await,
            Err(AdapterBindingError::BindingRevoked)
        );
        assert_eq!(own_counts(&pool, &stream_identity).await, (2, 3, 1, 2));

        // Each remaining non-admitted state refuses under its own name against the real store, not
        // only in memory. One collapsed refusal could not tell a caller whether the binding was
        // replaced, withdrawn, or found unusable, and those carry different next actions.
        for (state, expected) in [
            (
                AdapterBindingState::Superseded,
                AdapterBindingError::BindingSuperseded,
            ),
            (
                AdapterBindingState::Incompatible,
                AdapterBindingError::BindingIncompatible,
            ),
        ] {
            let scope = format!("paper-scope-{state:?}-{suffix}").to_lowercase();
            let mut candidate = draft(&scope);
            candidate.state = state;
            let committed = owner.commit(candidate).await.unwrap();
            assert_eq!(
                owner
                    .resolve_admitted(&committed.locator, &capabilities())
                    .await,
                Err(expected)
            );
        }

        // The venue an effect may reach is projected from the admitted binding this Owner already
        // committed, and carries no credential: the handle stays here and resolves at effect time.
        let venue_scope = format!("paper-scope-venue-{suffix}");
        let venue_binding = owner.commit(draft(&venue_scope)).await.unwrap();
        let admitted = owner
            .resolve_admitted(&venue_binding.locator, &capabilities())
            .await
            .unwrap();
        let venue = crate::venue_binding::bind_paper_venue(&admitted);
        assert_eq!(venue.execution_scope_identity(), venue_scope);
        assert_eq!(venue.account_namespace(), admitted.account_namespace());
        assert_eq!(venue.effect_namespace(), admitted.effect_namespace());
        assert_eq!(venue.capabilities(), admitted.capabilities());
        assert_eq!(
            venue.binding_fact_identity(),
            venue_binding.locator.fact_identity
        );

        // Time is Owner-sampled: outside the interval or in another epoch nothing resolves.
        let gamma = format!("paper-scope-gamma-{suffix}");
        let current = owner.commit(draft(&gamma)).await.unwrap();
        clock.set(2_000, 7);
        assert_eq!(
            owner
                .resolve_admitted(&current.locator, &capabilities())
                .await,
            Err(AdapterBindingError::TimeMismatch)
        );
        clock.set(1_500, 8);
        assert_eq!(
            owner
                .resolve_admitted(&current.locator, &capabilities())
                .await,
            Err(AdapterBindingError::TimeMismatch)
        );
        clock.set(1_500, 7);
        let before_tamper = owner
            .resolve_admitted(&current.locator, &capabilities())
            .await
            .unwrap();

        // Native tampering fails closed and exact restoration reads back identically.
        sqlx::query(
            "UPDATE execution_private.execution_paper_adapter_binding_facts_v1
                SET locator_json = jsonb_set(locator_json, '{content_digest}', to_jsonb($2::text))
              WHERE fact_identity = $1",
        )
        .bind(&current.locator.fact_identity)
        .bind(format!("sha256:{}", "0".repeat(64)))
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            owner
                .resolve_admitted(&current.locator, &capabilities())
                .await,
            Err(AdapterBindingError::LocatorMismatch)
        );
        sqlx::query(
            "UPDATE execution_private.execution_paper_adapter_binding_facts_v1
                SET locator_json = jsonb_set(locator_json, '{content_digest}', to_jsonb($2::text))
              WHERE fact_identity = $1",
        )
        .bind(&current.locator.fact_identity)
        .bind(&current.locator.content_digest)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "UPDATE execution_private.execution_paper_adapter_binding_facts_v1
                SET meaning_json = jsonb_set(meaning_json, '{state}', '\"REVOKED\"'::jsonb)
              WHERE fact_identity = $1",
        )
        .bind(&current.locator.fact_identity)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            owner
                .resolve_admitted(&current.locator, &capabilities())
                .await,
            Err(AdapterBindingError::StoreUnavailable)
        );
        sqlx::query(
            "UPDATE execution_private.execution_paper_adapter_binding_facts_v1
                SET meaning_json = jsonb_set(meaning_json, '{state}', '\"ADMITTED\"'::jsonb)
              WHERE fact_identity = $1",
        )
        .bind(&current.locator.fact_identity)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            owner
                .resolve_admitted(&current.locator, &capabilities())
                .await
                .unwrap(),
            before_tamper
        );

        // Each downstream Owner may execute exactly the one read function it needs, and no more.
        for (role, function, granted) in [
            (
                "governance_writer",
                "execution_api.read_current_paper_adapter_binding_v1(text)",
                true,
            ),
            (
                "governance_writer",
                "execution_api.read_paper_account_opening_fact_v1(text)",
                false,
            ),
            (
                "portfolio_writer",
                "execution_api.read_paper_account_opening_fact_v1(text)",
                true,
            ),
            (
                "portfolio_writer",
                "execution_api.read_current_paper_adapter_binding_v1(text)",
                false,
            ),
            (
                "rd_owner",
                "execution_api.read_current_paper_adapter_binding_v1(text)",
                false,
            ),
        ] {
            let allowed: bool =
                sqlx::query_scalar("SELECT pg_catalog.has_function_privilege($1, $2, 'EXECUTE')")
                    .bind(role)
                    .bind(function)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(allowed, granted, "{role} EXECUTE on {function}");
        }

        // Foreign Owner roles hold no privilege over Execution custody.
        for role in [
            "rd_owner",
            "product_edge_owner",
            "portfolio_owner",
            "backtest_owner",
        ] {
            let usage: bool = sqlx::query_scalar(
                "SELECT pg_catalog.has_schema_privilege($1, 'execution_private', 'USAGE')",
            )
            .bind(role)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert!(!usage, "{role} must not use execution_private");
        }
        assert_eq!(
            PaperAdapterBindingPostgresV1::connect_existing(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                node_identity.clone(),
                clock.clone()
            )
            .await
            .map(|_| ()),
            Err(AdapterBindingError::StoreUnavailable)
        );
        assert!(
            sqlx::query(
                "SELECT COUNT(*) FROM execution_private.execution_paper_adapter_binding_facts_v1"
            )
            .fetch_one(mutation.pool(CanonicalOwnerTestRoleV1::RdOwner))
            .await
            .is_err(),
            "rd_owner must be denied on Execution custody"
        );

        cleanup(&pool, &stream_identity).await;
        assert_eq!(own_counts(&pool, &stream_identity).await, (0, 0, 0, 0));
    }
}
