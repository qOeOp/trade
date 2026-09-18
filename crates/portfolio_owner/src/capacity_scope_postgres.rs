//! PostgreSQL custody for the Portfolio Capacity Scope registry.
//!
//! This is the only production store that can seal a `BOUND` Capacity Scope. Deployment
//! configuration admits an immutable account, mode, economic pool, source binding, and adapter
//! binding; Portfolio derives the candidate-neutral scope identity from that registry and publishes
//! it. The registry is append-only: each committed cut is immutable and the head moves forward, so
//! an earlier proof frontier can never be rewritten.
//!
//! Portfolio never reads Risk state, subtracts a Reservation liability, or computes remaining
//! headroom here; this module carries scope identity and its membership proof only.
//!
//! The pool is never exposed outside test code:
//!
//! ```compile_fail
//! use vibe_portfolio_owner::capacity_scope_postgres::CapacityScopePostgresV1;
//!
//! fn raw_writer(owner: &CapacityScopePostgresV1) {
//!     let _ = owner.pool();
//! }
//! ```

use std::{
    fmt::{Debug, Display},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgPoolOptions};

use crate::capacity_scope::{
    BoundCapacityScopeReadback, CapacityScopeFailure, CapacityScopeResolution,
    OwnerCapacityScopeDecisionTime, OwnerCapacityScopeDefinition, OwnerCapacityScopeRegistryCut,
    OwnerMembershipCompleteness, UntrustedCapacityScopeRequest, derive_census_identity,
    derive_membership_proof_identity, derive_registry_cut_identity, derive_scope_identity,
    issue_bound_capacity_scope, unavailable_readback, validate_registry,
};
use crate::capacity_view::{
    CapacityViewFailure, CapacityViewReadback, ExecutionAccountFactCut, derive_view_identity,
    seal_view,
};

/// Canonical PostgreSQL role that owns every Portfolio relation.
pub const PORTFOLIO_OWNER_ROLE: &str = "portfolio_owner";
/// Canonical login role admitted to write through this custody.
pub const PORTFOLIO_WRITER_ROLE: &str = "portfolio_writer";
/// Private schema holding every Portfolio Owner relation.
pub const PORTFOLIO_PRIVATE_SCHEMA: &str = "portfolio_private";
/// Read-only schema exposing sealed readbacks to other Owners.
pub const PORTFOLIO_API_SCHEMA: &str = "portfolio_api";
/// Canonical outbox kind emitted with each committed registry cut.
pub const CAPACITY_SCOPE_REGISTRY_OUTBOX_KIND: &str = "portfolio-capacity-scope-registry-cut-v1";

const OWNED_TABLES: [&str; 5] = [
    "portfolio_capacity_scope_registry_cuts_v1",
    "portfolio_capacity_scope_registry_heads_v1",
    "portfolio_capacity_scope_bound_readbacks_v1",
    "portfolio_capacity_views_v1",
    "portfolio_owner_outbox_v1",
];
const REGISTRY_HEAD_IDENTITY: &str = "portfolio.capacity-scope.registry.v1";

/// Owner-trusted clock injected by the legal Portfolio composition root.
pub trait PortfolioOwnerClock: Send + Sync + Debug {
    /// Samples the current Owner-trusted decision time in epoch milliseconds.
    ///
    /// # Errors
    ///
    /// Returns [`CapacityScopeCustodyError::ClockUnavailable`] when no valid sample exists.
    fn now_epoch_ms(&self) -> Result<u64, CapacityScopeCustodyError>;
}

/// System clock adapter.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemPortfolioOwnerClock;

impl PortfolioOwnerClock for SystemPortfolioOwnerClock {
    fn now_epoch_ms(&self) -> Result<u64, CapacityScopeCustodyError> {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| CapacityScopeCustodyError::ClockUnavailable)?
            .as_millis();
        u64::try_from(millis).map_err(|_| CapacityScopeCustodyError::ClockUnavailable)
    }
}

/// Failure of a Portfolio custody operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CapacityScopeCustodyError {
    /// The Owner clock produced no valid sample.
    ClockUnavailable,
    /// The proposed registry cut is not a valid complete membership census.
    InvalidRegistry(CapacityScopeFailure),
    /// The same registry sequence was reused with different meaning.
    ConflictingReplay,
    /// Owner custody is unavailable, mismatched, or not admitted for this role.
    StoreUnavailable,
}

impl Display for CapacityScopeCustodyError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ClockUnavailable => formatter.write_str("Portfolio Owner clock unavailable"),
            Self::InvalidRegistry(failure) => {
                write!(formatter, "invalid registry cut: {failure:?}")
            }
            Self::ConflictingReplay => formatter.write_str("conflicting registry cut replay"),
            Self::StoreUnavailable => formatter.write_str("Portfolio custody unavailable"),
        }
    }
}

impl std::error::Error for CapacityScopeCustodyError {}

/// One deployment-admitted Capacity Scope definition proposed for the registry.
///
/// Every field is a deployment decision: which account, which mode, which economic pool, which
/// source and adapter binding, and which shared gross constraints the scope indivisibly holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapacityScopeDefinitionProposal {
    /// Account namespace the scope covers.
    pub account_namespace: String,
    /// `PAPER` or `LIVE` mode; the two are always distinct scopes.
    pub mode: crate::capacity_scope::CapacityScopeMode,
    /// Candidate-neutral economic pool identity.
    pub economic_pool_identity: String,
    /// Currency the pool is denominated in, upper-case ASCII.
    pub economic_pool_currency: String,
    /// Deployment source binding identity.
    pub source_binding_identity: String,
    /// Deployment adapter binding identity, admitted by Execution before this registry cut.
    pub adapter_binding_identity: String,
    /// Every shared, indivisible gross constraint this scope holds.
    pub shared_constraint_identities: Vec<String>,
}

impl CapacityScopeDefinitionProposal {
    fn into_owner_definition(self) -> OwnerCapacityScopeDefinition {
        OwnerCapacityScopeDefinition {
            account_namespace: self.account_namespace,
            mode: self.mode,
            economic_pool_identity: self.economic_pool_identity,
            economic_pool_currency: self.economic_pool_currency,
            source_binding_identity: self.source_binding_identity,
            adapter_binding_identity: self.adapter_binding_identity,
            shared_constraint_identities: self.shared_constraint_identities,
        }
    }
}

/// One Owner-derived Capacity Scope identity published by a committed registry cut.
///
/// Governance binds an Execution Scope to this identity; it is Portfolio's published derivation,
/// not authority. Only a sealed [`crate::capacity_scope::BoundCapacityScopeReadback`] proves the
/// scope is `BOUND`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublishedCapacityScope {
    /// Account namespace the scope covers.
    pub account_namespace: String,
    /// `PAPER` or `LIVE` mode.
    pub mode: CapacityScopeMode,
    /// Candidate-neutral economic pool identity.
    pub economic_pool_identity: String,
    /// Owner-derived immutable Capacity Scope identity.
    pub capacity_scope_identity: String,
}

/// Receipt of one committed registry cut.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapacityScopeRegistryCutReceipt {
    published_scopes: Vec<PublishedCapacityScope>,
    proof_frontier_identity: String,
    proof_frontier_sequence: u64,
    registry_cut_identity: String,
    membership_proof_identity: String,
    observed_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
}

impl CapacityScopeRegistryCutReceipt {
    /// Owner proof frontier identity of the committed cut.
    #[must_use]
    pub fn proof_frontier_identity(&self) -> &str {
        &self.proof_frontier_identity
    }

    /// Monotonic Owner proof sequence.
    #[must_use]
    pub const fn proof_frontier_sequence(&self) -> u64 {
        self.proof_frontier_sequence
    }

    /// Complete registry cut identity.
    #[must_use]
    pub fn registry_cut_identity(&self) -> &str {
        &self.registry_cut_identity
    }

    /// Complete-set disjoint shared-constraint proof identity.
    #[must_use]
    pub fn membership_proof_identity(&self) -> &str {
        &self.membership_proof_identity
    }

    /// Owner observation time of the cut.
    #[must_use]
    pub const fn observed_at_epoch_ms(&self) -> u64 {
        self.observed_at_epoch_ms
    }

    /// Exclusive validity bound of the cut.
    #[must_use]
    pub const fn valid_through_epoch_ms(&self) -> u64 {
        self.valid_through_epoch_ms
    }

    /// Every Capacity Scope identity this cut publishes, in canonical census order.
    #[must_use]
    pub fn published_scopes(&self) -> &[PublishedCapacityScope] {
        &self.published_scopes
    }
}

/// Portfolio Owner PostgreSQL custody node.
pub struct CapacityScopePostgresV1 {
    pool: PgPool,
    clock: Arc<dyn PortfolioOwnerClock>,
}

impl Debug for CapacityScopePostgresV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(CapacityScopePostgresV1))
            .finish_non_exhaustive()
    }
}

impl CapacityScopePostgresV1 {
    /// Connects as the Portfolio writer and materializes the Owner relations.
    ///
    /// # Errors
    ///
    /// Returns [`CapacityScopeCustodyError::StoreUnavailable`] when the role is not the admitted
    /// writer, the schema is absent, or DDL fails.
    pub async fn connect(
        database_url: &str,
        clock: Arc<dyn PortfolioOwnerClock>,
    ) -> Result<Self, CapacityScopeCustodyError> {
        let owner = Self::attach(database_url, clock).await?;
        owner.migrate().await?;
        owner.verify_admission().await?;
        Ok(owner)
    }

    /// Connects to an already materialized Owner topology without running DDL.
    ///
    /// # Errors
    ///
    /// Returns [`CapacityScopeCustodyError::StoreUnavailable`] when the role, its membership, or
    /// the owned relations do not match the canonical Portfolio topology.
    pub async fn connect_existing(
        database_url: &str,
        clock: Arc<dyn PortfolioOwnerClock>,
    ) -> Result<Self, CapacityScopeCustodyError> {
        let owner = Self::attach(database_url, clock).await?;
        owner.verify_admission().await?;
        Ok(owner)
    }

    async fn attach(
        database_url: &str,
        clock: Arc<dyn PortfolioOwnerClock>,
    ) -> Result<Self, CapacityScopeCustodyError> {
        let pool = PgPoolOptions::new()
            .max_connections(8)
            .connect(database_url)
            .await
            .map_err(storage)?;
        Ok(Self { pool, clock })
    }

    #[cfg(test)]
    pub(crate) fn pool(&self) -> &PgPool {
        &self.pool
    }

    async fn migrate(&self) -> Result<(), CapacityScopeCustodyError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        sqlx::query("SET LOCAL ROLE portfolio_owner")
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;

        for statement in [
            "CREATE TABLE IF NOT EXISTS portfolio_private.portfolio_capacity_scope_registry_cuts_v1 ( \
                proof_frontier_identity TEXT PRIMARY KEY CHECK (proof_frontier_identity <> ''), \
                proof_frontier_sequence BIGINT NOT NULL UNIQUE CHECK (proof_frontier_sequence > 0), \
                registry_cut_identity TEXT NOT NULL CHECK (registry_cut_identity <> ''), \
                census_identity TEXT NOT NULL UNIQUE CHECK (census_identity <> ''), \
                membership_proof_identity TEXT NOT NULL CHECK (membership_proof_identity <> ''), \
                completeness TEXT NOT NULL CHECK (completeness = 'COMPLETE'), \
                observed_at_epoch_ms BIGINT NOT NULL CHECK (observed_at_epoch_ms > 0), \
                valid_through_epoch_ms BIGINT NOT NULL CHECK (valid_through_epoch_ms > 0), \
                registry_json JSONB NOT NULL, \
                committed_at_epoch_ms BIGINT NOT NULL CHECK (committed_at_epoch_ms > 0))",
            "CREATE TABLE IF NOT EXISTS portfolio_private.portfolio_capacity_scope_registry_heads_v1 ( \
                head_identity TEXT PRIMARY KEY CHECK (head_identity <> ''), \
                proof_frontier_identity TEXT NOT NULL \
                  REFERENCES portfolio_private.portfolio_capacity_scope_registry_cuts_v1(proof_frontier_identity), \
                proof_frontier_sequence BIGINT NOT NULL CHECK (proof_frontier_sequence > 0))",
            "CREATE TABLE IF NOT EXISTS portfolio_private.portfolio_capacity_scope_bound_readbacks_v1 ( \
                request_identity TEXT PRIMARY KEY CHECK (request_identity <> ''), \
                semantic_digest TEXT NOT NULL CHECK (semantic_digest <> ''), \
                capacity_scope_identity TEXT NOT NULL CHECK (capacity_scope_identity <> ''), \
                proof_frontier_identity TEXT NOT NULL \
                  REFERENCES portfolio_private.portfolio_capacity_scope_registry_cuts_v1(proof_frontier_identity), \
                readback_json JSONB NOT NULL, \
                committed_at_epoch_ms BIGINT NOT NULL CHECK (committed_at_epoch_ms > 0))",
            "CREATE TABLE IF NOT EXISTS portfolio_private.portfolio_capacity_views_v1 ( \
                view_identity TEXT PRIMARY KEY CHECK (view_identity <> ''), \
                capacity_scope_identity TEXT NOT NULL CHECK (capacity_scope_identity <> ''), \
                account_namespace TEXT NOT NULL CHECK (account_namespace <> ''), \
                pool_methodology_version TEXT NOT NULL CHECK (pool_methodology_version <> ''), \
                account_fact_identity TEXT NOT NULL CHECK (account_fact_identity <> ''), \
                account_fact_sequence BIGINT NOT NULL CHECK (account_fact_sequence > 0), \
                proof_frontier_identity TEXT NOT NULL \
                  REFERENCES portfolio_private.portfolio_capacity_scope_registry_cuts_v1(proof_frontier_identity), \
                measured_at_epoch_ms BIGINT NOT NULL CHECK (measured_at_epoch_ms > 0), \
                valid_through_epoch_ms BIGINT NOT NULL CHECK (valid_through_epoch_ms > 0), \
                view_json JSONB NOT NULL, \
                CHECK (valid_through_epoch_ms > measured_at_epoch_ms))",
            "CREATE INDEX IF NOT EXISTS portfolio_capacity_views_scope_v1 \
               ON portfolio_private.portfolio_capacity_views_v1(capacity_scope_identity, measured_at_epoch_ms DESC)",
            "CREATE TABLE IF NOT EXISTS portfolio_private.portfolio_owner_outbox_v1 ( \
                event_identity TEXT PRIMARY KEY CHECK (event_identity <> ''), \
                event_kind TEXT NOT NULL CHECK (event_kind <> ''), \
                aggregate_identity TEXT NOT NULL CHECK (aggregate_identity <> ''), \
                payload_digest TEXT NOT NULL CHECK (payload_digest <> ''), \
                committed_at_epoch_ms BIGINT NOT NULL CHECK (committed_at_epoch_ms > 0))",
            "CREATE OR REPLACE FUNCTION portfolio_api.read_bound_capacity_scope_v1(request_identity text) \
             RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER \
             SET search_path = pg_catalog, portfolio_private AS $$ \
                SELECT readback.readback_json \
                  FROM portfolio_private.portfolio_capacity_scope_bound_readbacks_v1 readback \
                  JOIN portfolio_private.portfolio_capacity_scope_registry_heads_v1 head \
                    ON head.proof_frontier_identity = readback.proof_frontier_identity \
                 WHERE readback.request_identity = read_bound_capacity_scope_v1.request_identity \
             $$",
            "CREATE OR REPLACE FUNCTION portfolio_api.read_current_capacity_view_v1(scope_identity text, at_epoch_ms bigint) \
             RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER \
             SET search_path = pg_catalog, portfolio_private AS $$ \
                SELECT view_record.view_json \
                  FROM portfolio_private.portfolio_capacity_views_v1 view_record \
                 WHERE view_record.capacity_scope_identity = read_current_capacity_view_v1.scope_identity \
                   AND view_record.measured_at_epoch_ms <= read_current_capacity_view_v1.at_epoch_ms \
                   AND view_record.valid_through_epoch_ms > read_current_capacity_view_v1.at_epoch_ms \
                 ORDER BY view_record.measured_at_epoch_ms DESC \
                 LIMIT 1 \
             $$",
            "REVOKE ALL ON FUNCTION portfolio_api.read_bound_capacity_scope_v1(text) FROM PUBLIC",
            "REVOKE ALL ON FUNCTION portfolio_api.read_current_capacity_view_v1(text, bigint) FROM PUBLIC",
            // Strategy Governance rereads the ceiling before it admits an INITIAL_ACTIVATION.
            "GRANT EXECUTE ON FUNCTION portfolio_api.read_bound_capacity_scope_v1(text) TO governance_writer",
            "GRANT EXECUTE ON FUNCTION portfolio_api.read_current_capacity_view_v1(text, bigint) TO governance_writer",
        ] {
            sqlx::query(statement)
                .execute(&mut *transaction)
                .await
                .map_err(storage)?;
        }
        transaction.commit().await.map_err(storage)
    }

    async fn verify_admission(&self) -> Result<(), CapacityScopeCustodyError> {
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
        .bind(PORTFOLIO_WRITER_ROLE)
        .bind(PORTFOLIO_OWNER_ROLE)
        .bind(PORTFOLIO_PRIVATE_SCHEMA)
        .bind(OWNED_TABLES.len() as i64)
        .bind(OWNED_TABLES.to_vec())
        .fetch_one(&self.pool)
        .await
        .map_err(storage)?;

        if !admitted {
            return Err(CapacityScopeCustodyError::StoreUnavailable);
        }
        Ok(())
    }

    /// Commits one complete Capacity Scope registry cut and advances the head.
    ///
    /// The Owner validates the complete membership census before any write: every definition is
    /// well formed, no two definitions derive the same scope identity, and no shared constraint
    /// appears in more than one scope. An exact byte-identical replay of the current head joins it;
    /// a different census under the same sequence conflicts.
    ///
    /// # Errors
    ///
    /// Returns [`CapacityScopeCustodyError`] for an invalid census, a conflicting replay, an
    /// unavailable clock, or unavailable custody.
    pub async fn commit_registry_cut(
        &self,
        definitions: Vec<CapacityScopeDefinitionProposal>,
        valid_through_epoch_ms: u64,
    ) -> Result<CapacityScopeRegistryCutReceipt, CapacityScopeCustodyError> {
        let observed_at_epoch_ms = self.clock.now_epoch_ms()?;
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        // The registry is append-only and its head is global, so the next sequence must exceed
        // every sequence ever committed, not merely the current head's. One advisory lock on the
        // registry identity serializes concurrent commits.
        sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))")
            .bind(REGISTRY_HEAD_IDENTITY)
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
        let head = load_head(&mut transaction, false).await?;
        let highest: i64 = sqlx::query_scalar(
            "SELECT COALESCE(pg_catalog.max(proof_frontier_sequence), 0::bigint)
               FROM portfolio_private.portfolio_capacity_scope_registry_cuts_v1",
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(storage)?;
        let sequence = u64::try_from(highest)
            .map_err(|_| CapacityScopeCustodyError::StoreUnavailable)?
            .checked_add(1)
            .ok_or(CapacityScopeCustodyError::StoreUnavailable)?;
        let registry = OwnerCapacityScopeRegistryCut {
            completeness: OwnerMembershipCompleteness::Complete,
            proof_frontier_identity: format!("{REGISTRY_HEAD_IDENTITY}:{sequence}"),
            proof_frontier_sequence: sequence,
            observed_at_epoch_ms,
            valid_through_epoch_ms,
            definitions: definitions
                .into_iter()
                .map(CapacityScopeDefinitionProposal::into_owner_definition)
                .collect(),
        };
        validate_registry(&registry, observed_at_epoch_ms)
            .map_err(CapacityScopeCustodyError::InvalidRegistry)?;
        let registry_cut_identity = derive_registry_cut_identity(&registry);
        let membership_proof_identity = derive_membership_proof_identity(&registry);

        let census_identity = derive_census_identity(&registry);

        if let Some(current) = head.as_ref()
            && derive_census_identity(current) == census_identity
        {
            transaction.rollback().await.map_err(storage)?;
            return Ok(receipt_from(current));
        }
        let registry_json = serde_json::to_value(&registry)
            .map_err(|_| CapacityScopeCustodyError::StoreUnavailable)?;
        sqlx::query(
            "INSERT INTO portfolio_private.portfolio_capacity_scope_registry_cuts_v1
                (proof_frontier_identity, proof_frontier_sequence, registry_cut_identity,
                 census_identity, membership_proof_identity, completeness, observed_at_epoch_ms,
                 valid_through_epoch_ms, registry_json, committed_at_epoch_ms)
             VALUES ($1, $2, $3, $4, $5, 'COMPLETE', $6, $7, $8, $6)",
        )
        .bind(&registry.proof_frontier_identity)
        .bind(to_i64(sequence)?)
        .bind(&registry_cut_identity)
        .bind(&census_identity)
        .bind(&membership_proof_identity)
        .bind(to_i64(observed_at_epoch_ms)?)
        .bind(to_i64(valid_through_epoch_ms)?)
        .bind(registry_json)
        .execute(&mut *transaction)
        .await
        .map_err(|_| CapacityScopeCustodyError::ConflictingReplay)?;
        sqlx::query(
            "INSERT INTO portfolio_private.portfolio_capacity_scope_registry_heads_v1
                (head_identity, proof_frontier_identity, proof_frontier_sequence)
             VALUES ($1, $2, $3)
             ON CONFLICT (head_identity) DO UPDATE
                SET proof_frontier_identity = EXCLUDED.proof_frontier_identity,
                    proof_frontier_sequence = EXCLUDED.proof_frontier_sequence
              WHERE portfolio_capacity_scope_registry_heads_v1.proof_frontier_sequence
                    < EXCLUDED.proof_frontier_sequence",
        )
        .bind(REGISTRY_HEAD_IDENTITY)
        .bind(&registry.proof_frontier_identity)
        .bind(to_i64(sequence)?)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
        sqlx::query(
            "INSERT INTO portfolio_private.portfolio_owner_outbox_v1
                (event_identity, event_kind, aggregate_identity, payload_digest, committed_at_epoch_ms)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(&registry.proof_frontier_identity)
        .bind(CAPACITY_SCOPE_REGISTRY_OUTBOX_KIND)
        .bind(REGISTRY_HEAD_IDENTITY)
        .bind(&registry_cut_identity)
        .bind(to_i64(observed_at_epoch_ms)?)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
        transaction.commit().await.map_err(storage)?;
        Ok(receipt_from(&registry))
    }

    /// Resolves one untrusted Capacity Scope request against the current registry head.
    ///
    /// Only this path can produce a sealed `BoundCapacityScopeReadback`: the Owner derives every
    /// identity from its own registry and compares each caller expectation against it. Any
    /// mismatch, stale proof, unknown membership, or shared-constraint overlap returns a structured
    /// unavailable readback and writes nothing.
    ///
    /// # Errors
    ///
    /// Returns [`CapacityScopeCustodyError`] only for an unavailable clock or custody; every
    /// business refusal is an `Unavailable` resolution.
    pub async fn resolve_bound_capacity_scope(
        &self,
        request: &UntrustedCapacityScopeRequest,
    ) -> Result<CapacityScopeResolution, CapacityScopeCustodyError> {
        let decision_time = OwnerCapacityScopeDecisionTime {
            projection_at_epoch_ms: self.clock.now_epoch_ms()?,
        };
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let Some(registry) = load_head(&mut transaction, true).await? else {
            transaction.rollback().await.map_err(storage)?;
            return Ok(CapacityScopeResolution::Unavailable(unavailable_readback(
                request,
                vec![CapacityScopeFailure::MembershipUnknown],
            )));
        };
        let readback = match issue_bound_capacity_scope(request, &registry, decision_time) {
            Ok(readback) => readback,
            Err(failure) => {
                transaction.rollback().await.map_err(storage)?;
                return Ok(CapacityScopeResolution::Unavailable(unavailable_readback(
                    request,
                    vec![failure],
                )));
            }
        };
        let readback_json = serde_json::to_value(&readback)
            .map_err(|_| CapacityScopeCustodyError::StoreUnavailable)?;
        sqlx::query(
            "INSERT INTO portfolio_private.portfolio_capacity_scope_bound_readbacks_v1
                (request_identity, semantic_digest, capacity_scope_identity,
                 proof_frontier_identity, readback_json, committed_at_epoch_ms)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (request_identity) DO NOTHING",
        )
        .bind(readback.fingerprint().request_identity())
        .bind(readback.fingerprint().semantic_digest())
        .bind(readback.capacity_scope_identity())
        .bind(&registry.proof_frontier_identity)
        .bind(readback_json)
        .bind(to_i64(decision_time.projection_at_epoch_ms)?)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
        let stored: String = sqlx::query_scalar(
            "SELECT semantic_digest
               FROM portfolio_private.portfolio_capacity_scope_bound_readbacks_v1
              WHERE request_identity = $1",
        )
        .bind(readback.fingerprint().request_identity())
        .fetch_one(&mut *transaction)
        .await
        .map_err(storage)?;

        if stored != readback.fingerprint().semantic_digest() {
            transaction.rollback().await.map_err(storage)?;
            return Ok(CapacityScopeResolution::Unavailable(unavailable_readback(
                request,
                vec![CapacityScopeFailure::IdentityMismatch {
                    field: crate::capacity_scope::CapacityScopeIdentityField::CapacityScope,
                }],
            )));
        }
        transaction.commit().await.map_err(storage)?;
        Ok(CapacityScopeResolution::Bound(Box::new(readback)))
    }

    /// Projects one candidate-neutral gross Capacity View for a `BOUND` Capacity Scope.
    ///
    /// The ceiling comes from Execution's own committed opening account fact, read through the
    /// Execution Owner's read-only API inside this transaction, never from a caller assertion and
    /// never from Portfolio's own arithmetic on some other source. Recommitting the same view joins
    /// the stored one.
    ///
    /// # Errors
    ///
    /// Returns [`CapacityScopeCustodyError`] for an unavailable clock or custody; every business
    /// refusal is a [`CapacityViewFailure`] in the `Ok` value.
    pub async fn commit_capacity_view(
        &self,
        scope: &BoundCapacityScopeReadback,
        valid_through_epoch_ms: u64,
    ) -> Result<Result<CapacityViewReadback, CapacityViewFailure>, CapacityScopeCustodyError> {
        let measured_at_epoch_ms = self.clock.now_epoch_ms()?;
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let Some(registry) = load_head(&mut transaction, true).await? else {
            transaction.rollback().await.map_err(storage)?;
            return Ok(Err(CapacityViewFailure::CapacityScopeUnavailable));
        };

        if registry.proof_frontier_identity != scope.proof_frontier_identity()
            || measured_at_epoch_ms < registry.observed_at_epoch_ms
            || measured_at_epoch_ms >= registry.valid_through_epoch_ms
        {
            transaction.rollback().await.map_err(storage)?;
            return Ok(Err(CapacityViewFailure::MeasurementOutsideProof));
        }
        let opening: Option<serde_json::Value> =
            sqlx::query_scalar("SELECT execution_api.read_paper_account_opening_fact_v1($1)")
                .bind(scope.account_namespace())
                .fetch_optional(&mut *transaction)
                .await
                .map_err(storage)?
                .flatten();
        let Some(opening) = opening else {
            transaction.rollback().await.map_err(storage)?;
            return Ok(Err(CapacityViewFailure::AccountFactUnavailable));
        };
        let Some(account_fact_cut) = read_account_fact_cut(&opening) else {
            transaction.rollback().await.map_err(storage)?;
            return Ok(Err(CapacityViewFailure::AccountFactUnavailable));
        };
        let view = match seal_view(
            scope,
            &registry.proof_frontier_identity,
            account_fact_cut,
            measured_at_epoch_ms,
            valid_through_epoch_ms,
        ) {
            Ok(view) => view,
            Err(failure) => {
                transaction.rollback().await.map_err(storage)?;
                return Ok(Err(failure));
            }
        };
        let view_json =
            serde_json::to_value(&view).map_err(|_| CapacityScopeCustodyError::StoreUnavailable)?;
        sqlx::query(
            "INSERT INTO portfolio_private.portfolio_capacity_views_v1
                (view_identity, capacity_scope_identity, account_namespace, pool_methodology_version,
                 account_fact_identity, account_fact_sequence, proof_frontier_identity,
                 measured_at_epoch_ms, valid_through_epoch_ms, view_json)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (view_identity) DO NOTHING",
        )
        .bind(view.view_identity())
        .bind(view.capacity_scope_identity())
        .bind(view.account_namespace())
        .bind(view.pool_methodology_version())
        .bind(&view.account_fact_cut().fact_identity)
        .bind(to_i64(view.account_fact_cut().sequence)?)
        .bind(&registry.proof_frontier_identity)
        .bind(to_i64(view.measured_at_epoch_ms())?)
        .bind(to_i64(view.valid_through_epoch_ms())?)
        .bind(view_json)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
        let stored: serde_json::Value = sqlx::query_scalar(
            "SELECT view_json FROM portfolio_private.portfolio_capacity_views_v1
              WHERE view_identity = $1",
        )
        .bind(view.view_identity())
        .fetch_one(&mut *transaction)
        .await
        .map_err(storage)?;
        transaction.commit().await.map_err(storage)?;

        if stored["view_identity"].as_str() != Some(view.view_identity())
            || derive_view_identity(&view) != view.view_identity()
        {
            return Err(CapacityScopeCustodyError::StoreUnavailable);
        }
        Ok(Ok(view))
    }

    /// Reads back the current registry head cut.
    ///
    /// # Errors
    ///
    /// Returns [`CapacityScopeCustodyError::StoreUnavailable`] when custody is unavailable or the
    /// stored cut no longer derives its recorded identity.
    pub async fn read_current_registry_cut(
        &self,
    ) -> Result<Option<CapacityScopeRegistryCutReceipt>, CapacityScopeCustodyError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let head = load_head(&mut transaction, false).await?;
        transaction.rollback().await.map_err(storage)?;
        Ok(head.as_ref().map(receipt_from))
    }
}

fn read_account_fact_cut(opening: &serde_json::Value) -> Option<ExecutionAccountFactCut> {
    let fact = opening.get("opening")?;
    Some(ExecutionAccountFactCut {
        fact_identity: opening.get("fact_identity")?.as_str()?.to_string(),
        account_namespace: fact.get("account_namespace")?.as_str()?.to_string(),
        execution_scope_identity: fact.get("execution_scope_identity")?.as_str()?.to_string(),
        collateral_currency: fact.get("collateral_currency")?.as_str()?.to_string(),
        collateral_amount: fact.get("collateral_amount")?.as_str()?.to_string(),
        sequence: u64::try_from(opening.get("sequence")?.as_i64()?).ok()?,
    })
}

fn receipt_from(registry: &OwnerCapacityScopeRegistryCut) -> CapacityScopeRegistryCutReceipt {
    CapacityScopeRegistryCutReceipt {
        published_scopes: registry
            .definitions
            .iter()
            .map(|definition| PublishedCapacityScope {
                account_namespace: definition.account_namespace.clone(),
                mode: definition.mode,
                economic_pool_identity: definition.economic_pool_identity.clone(),
                capacity_scope_identity: derive_scope_identity(definition),
            })
            .collect(),
        proof_frontier_identity: registry.proof_frontier_identity.clone(),
        proof_frontier_sequence: registry.proof_frontier_sequence,
        registry_cut_identity: derive_registry_cut_identity(registry),
        membership_proof_identity: derive_membership_proof_identity(registry),
        observed_at_epoch_ms: registry.observed_at_epoch_ms,
        valid_through_epoch_ms: registry.valid_through_epoch_ms,
    }
}

async fn load_head(
    transaction: &mut Transaction<'_, Postgres>,
    exclusive: bool,
) -> Result<Option<OwnerCapacityScopeRegistryCut>, CapacityScopeCustodyError> {
    let statement = if exclusive {
        "SELECT cut.registry_json, cut.registry_cut_identity, cut.membership_proof_identity
           FROM portfolio_private.portfolio_capacity_scope_registry_heads_v1 head
           JOIN portfolio_private.portfolio_capacity_scope_registry_cuts_v1 cut
             ON cut.proof_frontier_identity = head.proof_frontier_identity
          WHERE head.head_identity = $1
            FOR UPDATE OF head"
    } else {
        "SELECT cut.registry_json, cut.registry_cut_identity, cut.membership_proof_identity
           FROM portfolio_private.portfolio_capacity_scope_registry_heads_v1 head
           JOIN portfolio_private.portfolio_capacity_scope_registry_cuts_v1 cut
             ON cut.proof_frontier_identity = head.proof_frontier_identity
          WHERE head.head_identity = $1"
    };
    let Some(row) = sqlx::query(statement)
        .bind(REGISTRY_HEAD_IDENTITY)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(storage)?
    else {
        return Ok(None);
    };
    let registry: OwnerCapacityScopeRegistryCut =
        serde_json::from_value(row.try_get("registry_json").map_err(storage)?)
            .map_err(|_| CapacityScopeCustodyError::StoreUnavailable)?;
    let recorded_cut: String = row.try_get("registry_cut_identity").map_err(storage)?;
    let recorded_membership: String = row.try_get("membership_proof_identity").map_err(storage)?;

    if derive_registry_cut_identity(&registry) != recorded_cut
        || derive_membership_proof_identity(&registry) != recorded_membership
    {
        return Err(CapacityScopeCustodyError::StoreUnavailable);
    }
    Ok(Some(registry))
}

fn to_i64(value: u64) -> Result<i64, CapacityScopeCustodyError> {
    i64::try_from(value).map_err(|_| CapacityScopeCustodyError::StoreUnavailable)
}

fn storage(error: sqlx::Error) -> CapacityScopeCustodyError {
    if cfg!(test) {
        eprintln!("portfolio custody storage error: {error}");
    }
    drop(error);
    CapacityScopeCustodyError::StoreUnavailable
}

/// Re-exported for the composition root that wires a Capacity Scope registry.
pub use crate::capacity_scope::CapacityScopeMode;

#[cfg(test)]
mod tests {
    use std::{
        sync::Mutex,
        time::{SystemTime, UNIX_EPOCH},
    };

    use rstest::rstest;
    use vibe_execution_owner::{
        adapter_binding::{
            AdapterBindingError, AdapterBindingState, CredentialHandleIdentity,
            PaperAdapterBindingDraft, PaperAdapterCapability, PaperMode, ReduceOnlyPolicy,
            TrustedClock, derive_paper_account_namespace, derive_paper_effect_namespace,
        },
        adapter_binding_postgres::{ExecutionOwnerClock, PaperAdapterBindingPostgresV1},
        paper_account_opening::{PAPER_ACCOUNT_OPENING_SCHEMA_VERSION, PaperAccountOpeningDraft},
    };
    use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

    use super::*;
    use crate::capacity_scope::{
        CAPACITY_SCOPE_SCHEMA_VERSION, CapacityScopeIdentityField, CapacityScopeMaturity,
        CapacityScopeState,
    };
    use crate::capacity_view::{NO_LIQUIDITY_INPUT_V1, PAPER_COLLATERAL_GROSS_CEILING_V1};

    #[derive(Debug)]
    struct FixtureClock(Mutex<u64>);

    impl FixtureClock {
        fn new(now_epoch_ms: u64) -> Arc<Self> {
            Arc::new(Self(Mutex::new(now_epoch_ms)))
        }

        fn set(&self, now_epoch_ms: u64) {
            *self.0.lock().unwrap() = now_epoch_ms;
        }
    }

    impl PortfolioOwnerClock for FixtureClock {
        fn now_epoch_ms(&self) -> Result<u64, CapacityScopeCustodyError> {
            Ok(*self.0.lock().unwrap())
        }
    }

    impl ExecutionOwnerClock for FixtureClock {
        fn now(&self) -> Result<TrustedClock, AdapterBindingError> {
            TrustedClock::new(*self.0.lock().unwrap(), 7)
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

    fn definition(suffix: &str, pool: &str) -> CapacityScopeDefinitionProposal {
        CapacityScopeDefinitionProposal {
            // Execution derives this namespace from the Execution Scope identity, so a Capacity
            // Scope that does not use Execution's own string covers an account nobody can trade.
            account_namespace: derive_paper_account_namespace(
                PaperMode::Paper,
                &format!("paper-scope-{suffix}"),
            )
            .unwrap(),
            mode: CapacityScopeMode::Paper,
            economic_pool_identity: format!("{pool}-{suffix}"),
            economic_pool_currency: "USDT".to_string(),
            source_binding_identity: format!("source-binding-{suffix}"),
            adapter_binding_identity: format!("adapter-binding-{suffix}"),
            shared_constraint_identities: vec![format!("{pool}-constraint-{suffix}")],
        }
    }

    fn request(
        suffix: &str,
        definition: &CapacityScopeDefinitionProposal,
        receipt: &CapacityScopeRegistryCutReceipt,
        scope_identity: &str,
        projection_at_epoch_ms: u64,
    ) -> UntrustedCapacityScopeRequest {
        UntrustedCapacityScopeRequest {
            schema_version: CAPACITY_SCOPE_SCHEMA_VERSION,
            request_identity: format!("capacity-request-{suffix}-{projection_at_epoch_ms}"),
            account_namespace: definition.account_namespace.clone(),
            mode: definition.mode,
            economic_pool_identity: definition.economic_pool_identity.clone(),
            expected_capacity_scope_identity: scope_identity.to_string(),
            expected_registry_cut_identity: receipt.registry_cut_identity().to_string(),
            expected_source_binding_identity: definition.source_binding_identity.clone(),
            expected_adapter_binding_identity: definition.adapter_binding_identity.clone(),
            expected_membership_proof_identity: receipt.membership_proof_identity().to_string(),
            expected_proof_frontier_identity: receipt.proof_frontier_identity().to_string(),
            expected_proof_frontier_sequence: receipt.proof_frontier_sequence(),
            projection_at_epoch_ms,
        }
    }

    async fn own_counts(pool: &PgPool, marker: &str) -> (i64, i64, i64) {
        let cuts: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM portfolio_private.portfolio_capacity_scope_registry_cuts_v1
              WHERE registry_json::text LIKE $1",
        )
        .bind(format!("%{marker}%"))
        .fetch_one(pool)
        .await
        .unwrap();
        let readbacks: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM portfolio_private.portfolio_capacity_scope_bound_readbacks_v1
              WHERE request_identity LIKE $1",
        )
        .bind(format!("%{marker}%"))
        .fetch_one(pool)
        .await
        .unwrap();
        let outbox: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM portfolio_private.portfolio_owner_outbox_v1 outbox
              WHERE EXISTS (
                SELECT 1 FROM portfolio_private.portfolio_capacity_scope_registry_cuts_v1 cut
                 WHERE cut.proof_frontier_identity = outbox.event_identity
                   AND cut.registry_json::text LIKE $1)",
        )
        .bind(format!("%{marker}%"))
        .fetch_one(pool)
        .await
        .unwrap();
        (cuts, readbacks, outbox)
    }

    #[rstest]
    fn system_clock_samples_nonzero_time() {
        assert!(SystemPortfolioOwnerClock.now_epoch_ms().unwrap() > 0);
    }

    #[tokio::test]
    #[ignore = "requires the admitted canonical Owner PostgreSQL test topology"]
    async fn postgres_capacity_scope_registry_is_append_only_and_seals_one_bound_scope() {
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = test_database.mutation();
        let database_url = test_database.database_url(CanonicalOwnerTestRoleV1::PortfolioWriter);
        let suffix = suffix();
        let clock = FixtureClock::new(1_000);
        let owner = CapacityScopePostgresV1::connect(database_url, clock.clone())
            .await
            .unwrap();
        let pool = owner.pool().clone();
        assert_eq!(own_counts(&pool, &suffix).await, (0, 0, 0));

        // One complete census of two disjoint scopes commits once; an exact replay joins it.
        let alpha = definition(&suffix, "pool-alpha");
        let beta = definition(&format!("{suffix}-b"), "pool-beta");
        let census = vec![alpha.clone(), beta.clone()];
        let first = owner
            .commit_registry_cut(census.clone(), 9_000)
            .await
            .unwrap();
        assert!(first.proof_frontier_sequence() > 0);
        assert_eq!(first.published_scopes().len(), 2);
        assert_eq!(
            owner
                .commit_registry_cut(census.clone(), 9_000)
                .await
                .unwrap(),
            first
        );
        assert_eq!(own_counts(&pool, &suffix).await, (1, 0, 1));
        assert_eq!(
            owner.read_current_registry_cut().await.unwrap().as_ref(),
            Some(&first)
        );

        // A census whose shared constraint appears twice is refused before any write.
        let mut overlapping = beta.clone();
        overlapping
            .shared_constraint_identities
            .clone_from(&alpha.shared_constraint_identities);
        assert!(matches!(
            owner
                .commit_registry_cut(vec![alpha.clone(), overlapping], 9_000)
                .await,
            Err(CapacityScopeCustodyError::InvalidRegistry(
                CapacityScopeFailure::SharedConstraintOverlap { .. }
            ))
        ));
        // A census naming the same account, mode and pool twice has no unique membership.
        assert!(matches!(
            owner
                .commit_registry_cut(vec![alpha.clone(), alpha.clone()], 9_000)
                .await,
            Err(CapacityScopeCustodyError::InvalidRegistry(
                CapacityScopeFailure::ScopeMembershipUnknown
            ))
        ));
        assert_eq!(own_counts(&pool, &suffix).await, (1, 0, 1));

        // Only the Owner's own derivation seals a BOUND readback.
        let published = first
            .published_scopes()
            .iter()
            .find(|scope| scope.account_namespace == alpha.account_namespace)
            .unwrap()
            .clone();
        let guessed = request(&suffix, &alpha, &first, "sha256:guessed", 1_000);
        let CapacityScopeResolution::Unavailable(refused) =
            owner.resolve_bound_capacity_scope(&guessed).await.unwrap()
        else {
            unreachable!("a guessed scope identity can never bind")
        };
        assert_eq!(
            refused.failures(),
            [CapacityScopeFailure::IdentityMismatch {
                field: CapacityScopeIdentityField::CapacityScope
            }]
        );
        assert_eq!(own_counts(&pool, &suffix).await, (1, 0, 1));

        let exact = request(
            &suffix,
            &alpha,
            &first,
            &published.capacity_scope_identity,
            1_000,
        );
        let CapacityScopeResolution::Bound(bound) =
            owner.resolve_bound_capacity_scope(&exact).await.unwrap()
        else {
            unreachable!("the exact Owner-derived request must bind")
        };
        assert_eq!(bound.state(), CapacityScopeState::Bound);
        assert_eq!(bound.maturity(), CapacityScopeMaturity::OwnerCustody);
        assert_eq!(
            bound.capacity_scope_identity(),
            published.capacity_scope_identity
        );
        assert_eq!(bound.account_namespace(), alpha.account_namespace);
        assert_eq!(bound.mode(), CapacityScopeMode::Paper);
        assert_eq!(
            bound.proof_frontier_identity(),
            first.proof_frontier_identity()
        );
        assert_eq!(
            bound.proof_frontier_sequence(),
            first.proof_frontier_sequence()
        );
        assert_eq!(own_counts(&pool, &suffix).await, (1, 1, 1));
        // Exact replay of the same request joins the same sealed readback.
        let CapacityScopeResolution::Bound(replayed) =
            owner.resolve_bound_capacity_scope(&exact).await.unwrap()
        else {
            unreachable!("exact replay must rebind")
        };
        assert_eq!(replayed, bound);
        assert_eq!(own_counts(&pool, &suffix).await, (1, 1, 1));

        // Governance reads the sealed readback through the Owner's read-only API function.
        let api: serde_json::Value =
            sqlx::query_scalar("SELECT portfolio_api.read_bound_capacity_scope_v1($1)")
                .bind(exact.request_identity.clone())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(api["state"], "BOUND");
        assert_eq!(
            api["capacity_scope_identity"],
            published.capacity_scope_identity
        );

        // Every caller expectation is checked against the Owner's own identity.
        for (mutate, field) in [
            (
                Box::new(|request: &mut UntrustedCapacityScopeRequest| {
                    request.expected_registry_cut_identity = "sha256:other".to_string();
                }) as Box<dyn Fn(&mut UntrustedCapacityScopeRequest)>,
                CapacityScopeIdentityField::RegistryCut,
            ),
            (
                Box::new(|request| {
                    request.expected_source_binding_identity = "source-other".to_string();
                }),
                CapacityScopeIdentityField::SourceBinding,
            ),
            (
                Box::new(|request| {
                    request.expected_adapter_binding_identity = "adapter-other".to_string();
                }),
                CapacityScopeIdentityField::AdapterBinding,
            ),
            (
                Box::new(|request| {
                    request.expected_membership_proof_identity = "sha256:other".to_string();
                }),
                CapacityScopeIdentityField::MembershipProof,
            ),
            (
                Box::new(|request| {
                    request.expected_proof_frontier_identity = "frontier-other".to_string();
                }),
                CapacityScopeIdentityField::ProofFrontier,
            ),
            (
                Box::new(|request| request.expected_proof_frontier_sequence = u64::MAX),
                CapacityScopeIdentityField::ProofFrontierSequence,
            ),
        ] {
            let mut forged = exact.clone();
            forged.request_identity = format!("{}-{field:?}", exact.request_identity);
            mutate(&mut forged);
            let CapacityScopeResolution::Unavailable(readback) =
                owner.resolve_bound_capacity_scope(&forged).await.unwrap()
            else {
                unreachable!("a mismatched expectation can never bind")
            };
            assert_eq!(
                readback.failures(),
                [CapacityScopeFailure::IdentityMismatch { field }]
            );
        }
        assert_eq!(own_counts(&pool, &suffix).await, (1, 1, 1));

        // A proof outside its validity window is stale; the Owner samples the decision time.
        clock.set(9_000);
        let stale = request(
            &suffix,
            &alpha,
            &first,
            &published.capacity_scope_identity,
            9_000,
        );
        let CapacityScopeResolution::Unavailable(expired) =
            owner.resolve_bound_capacity_scope(&stale).await.unwrap()
        else {
            unreachable!("a proof at its exclusive bound is stale")
        };
        assert_eq!(expired.failures(), [CapacityScopeFailure::ProofStale]);
        clock.set(1_000);

        // The registry is append-only: a successor census advances the head and the old cut stays.
        clock.set(2_000);
        let gamma = definition(&format!("{suffix}-c"), "pool-gamma");
        let second = owner
            .commit_registry_cut(vec![alpha.clone(), beta.clone(), gamma], 9_000)
            .await
            .unwrap();
        assert_eq!(
            second.proof_frontier_sequence(),
            first.proof_frontier_sequence() + 1
        );
        assert_ne!(
            second.registry_cut_identity(),
            first.registry_cut_identity()
        );
        assert_eq!(own_counts(&pool, &suffix).await, (2, 1, 2));
        let retained: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM portfolio_private.portfolio_capacity_scope_registry_cuts_v1
              WHERE proof_frontier_identity = $1",
        )
        .bind(first.proof_frontier_identity())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(retained, 1, "an earlier cut is never rewritten");
        assert_eq!(
            owner.read_current_registry_cut().await.unwrap().as_ref(),
            Some(&second)
        );
        // A request bound to the superseded frontier no longer matches the head.
        let superseded = request(
            &format!("{suffix}-old"),
            &alpha,
            &first,
            &published.capacity_scope_identity,
            2_000,
        );
        let CapacityScopeResolution::Unavailable(old) = owner
            .resolve_bound_capacity_scope(&superseded)
            .await
            .unwrap()
        else {
            unreachable!("a superseded frontier cannot bind against the current head")
        };
        assert_eq!(
            old.failures(),
            [CapacityScopeFailure::IdentityMismatch {
                field: CapacityScopeIdentityField::RegistryCut
            }]
        );

        // A Capacity View projects the ceiling from Execution's own committed opening fact, and
        // binds the frontier that is current when it is measured.
        clock.set(2_000);
        let current_published = second
            .published_scopes()
            .iter()
            .find(|scope| scope.account_namespace == alpha.account_namespace)
            .unwrap()
            .clone();
        let current_request = request(
            &format!("{suffix}-view"),
            &alpha,
            &second,
            &current_published.capacity_scope_identity,
            2_000,
        );
        let bound_alpha = match owner
            .resolve_bound_capacity_scope(&current_request)
            .await
            .unwrap()
        {
            CapacityScopeResolution::Bound(readback) => *readback,
            CapacityScopeResolution::Unavailable(refused) => {
                unreachable!(
                    "alpha is bound at the current head: {:?}",
                    refused.failures()
                )
            }
        };
        // Execution's own custody publishes the account, through its own production path.
        let execution = PaperAdapterBindingPostgresV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::ExecutionWriter),
            format!("execution-node-{suffix}"),
            clock.clone(),
        )
        .await
        .unwrap();
        let execution_scope_identity = format!("paper-scope-{suffix}");
        let mode = PaperMode::Paper;
        let binding = execution
            .commit(PaperAdapterBindingDraft {
                schema_version: 1,
                binding_version: 1,
                generation: 1,
                mode,
                account_namespace: derive_paper_account_namespace(mode, &execution_scope_identity)
                    .unwrap(),
                effect_namespace: derive_paper_effect_namespace(mode, &execution_scope_identity)
                    .unwrap(),
                execution_scope_identity: execution_scope_identity.clone(),
                source_account_identity: format!("strategy-account-{suffix}"),
                simulator_account_identity: format!("sim-account-{suffix}"),
                simulator_endpoint_identity: format!("simulator:endpoint:{suffix}"),
                implementation_digest: "11".repeat(32),
                configuration_digest: "22".repeat(32),
                required_capabilities: vec![
                    PaperAdapterCapability::SubmitOrder,
                    PaperAdapterCapability::CancelOrder,
                    PaperAdapterCapability::OrderReadback,
                    PaperAdapterCapability::AccountReadback,
                    PaperAdapterCapability::EnforceableReduceOnly,
                ],
                reduce_only_policy: ReduceOnlyPolicy::SimulatorRejectIncreaseOrCrossZero,
                credential_handle_identity: CredentialHandleIdentity::parse(format!(
                    "credential-handle-{suffix}"
                ))
                .unwrap(),
                trust_policy_identity: "execution-paper-trust-v1".to_string(),
                state: AdapterBindingState::Admitted,
                effective_at_epoch_ms: 1_000,
                observed_at_epoch_ms: 1_900,
                exclusive_valid_through_epoch_ms: 900_000,
                clock_epoch: 7,
            })
            .await
            .unwrap();

        // With Execution's read API present but no fact, there is nothing to project from.
        assert_eq!(
            owner
                .commit_capacity_view(&bound_alpha, 5_000)
                .await
                .unwrap(),
            Err(CapacityViewFailure::AccountFactUnavailable)
        );
        let opening = execution
            .commit_account_opening_fact(PaperAccountOpeningDraft {
                schema_version: PAPER_ACCOUNT_OPENING_SCHEMA_VERSION,
                binding_locator: binding.locator.clone(),
                collateral_currency: "USDT".to_string(),
                collateral_amount: "100000.5".to_string(),
                observed_at_epoch_ms: 1_950,
                clock_epoch: 7,
            })
            .await
            .unwrap();

        let view = owner
            .commit_capacity_view(&bound_alpha, 5_000)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            view.capacity_scope_identity(),
            bound_alpha.capacity_scope_identity()
        );
        assert!(view.candidate_neutral());
        assert_eq!(view.notional_gross_ceiling(), 100_000_500_000);
        assert_eq!(view.gross_ceilings().len(), 1);
        assert_eq!(view.gross_ceilings()[0].unit, "USDT");
        assert_eq!(
            view.pool_methodology_version(),
            PAPER_COLLATERAL_GROSS_CEILING_V1
        );
        assert_eq!(view.liquidity_input_cut_identity(), NO_LIQUIDITY_INPUT_V1);
        assert_eq!(
            view.account_fact_cut().sequence,
            opening.sequence(),
            "the view cites Execution's own stream sequence"
        );
        assert_eq!(
            view.account_fact_cut().fact_identity,
            opening.fact_identity()
        );
        assert_eq!(
            view.proof_frontier_identity(),
            second.proof_frontier_identity()
        );
        // Recommitting the same view joins the stored one.
        assert_eq!(
            owner
                .commit_capacity_view(&bound_alpha, 5_000)
                .await
                .unwrap()
                .unwrap(),
            view
        );
        // Governance reads the current ceiling through the Owner's read-only API.
        let api_view: serde_json::Value =
            sqlx::query_scalar("SELECT portfolio_api.read_current_capacity_view_v1($1, $2)")
                .bind(bound_alpha.capacity_scope_identity())
                .bind(2_500_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(api_view["view_identity"], view.view_identity());
        let expired: Option<serde_json::Value> =
            sqlx::query_scalar("SELECT portfolio_api.read_current_capacity_view_v1($1, $2)")
                .bind(bound_alpha.capacity_scope_identity())
                .bind(5_000_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(expired.is_none(), "a view past its deadline is not current");

        let untampered = owner
            .commit_capacity_view(&bound_alpha, 5_000)
            .await
            .unwrap();
        let execution_pool = mutation.pool(CanonicalOwnerTestRoleV1::ExecutionWriter);

        // A pool denominated in another currency needs a Market Data valuation fact.
        tamper_opening_collateral(execution_pool, &alpha.account_namespace, "USDC", "100000.5")
            .await;
        assert_eq!(
            owner
                .commit_capacity_view(&bound_alpha, 5_000)
                .await
                .unwrap(),
            Err(CapacityViewFailure::ValuationUnavailable {
                pool_currency: "USDT".to_string(),
                collateral_currency: "USDC".to_string(),
            })
        );
        // Collateral finer than the fixed ceiling scale is not representable.
        tamper_opening_collateral(
            execution_pool,
            &alpha.account_namespace,
            "USDT",
            "1.0000005",
        )
        .await;
        assert_eq!(
            owner
                .commit_capacity_view(&bound_alpha, 5_000)
                .await
                .unwrap(),
            Err(CapacityViewFailure::CollateralNotRepresentable {
                amount: "1.0000005".to_string()
            })
        );
        // Restoring Execution's own values reads back the same view.
        tamper_opening_collateral(execution_pool, &alpha.account_namespace, "USDT", "100000.5")
            .await;
        assert_eq!(
            owner
                .commit_capacity_view(&bound_alpha, 5_000)
                .await
                .unwrap(),
            untampered
        );

        // Native tampering fails closed, and exact restoration reads back identically.
        let before_tamper = owner.read_current_registry_cut().await.unwrap();
        sqlx::query(
            "UPDATE portfolio_private.portfolio_capacity_scope_registry_cuts_v1
                SET registry_cut_identity = $2
              WHERE proof_frontier_identity = $1",
        )
        .bind(second.proof_frontier_identity())
        .bind(format!("sha256:{}", "0".repeat(64)))
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            owner.read_current_registry_cut().await,
            Err(CapacityScopeCustodyError::StoreUnavailable)
        );
        sqlx::query(
            "UPDATE portfolio_private.portfolio_capacity_scope_registry_cuts_v1
                SET registry_cut_identity = $2
              WHERE proof_frontier_identity = $1",
        )
        .bind(second.proof_frontier_identity())
        .bind(second.registry_cut_identity())
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            owner.read_current_registry_cut().await.unwrap(),
            before_tamper
        );

        // Foreign Owner roles hold no privilege over Portfolio custody.
        for role in ["rd_owner", "product_edge_owner", "backtest_owner"] {
            let usage: bool = sqlx::query_scalar(
                "SELECT pg_catalog.has_schema_privilege($1, 'portfolio_private', 'USAGE')",
            )
            .bind(role)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert!(!usage, "{role} must not use portfolio_private");
        }
        assert_eq!(
            CapacityScopePostgresV1::connect_existing(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                clock.clone()
            )
            .await
            .map(|_| ()),
            Err(CapacityScopeCustodyError::StoreUnavailable)
        );
        assert!(
            sqlx::query(
                "SELECT COUNT(*) FROM portfolio_private.portfolio_capacity_scope_registry_cuts_v1"
            )
            .fetch_one(mutation.pool(CanonicalOwnerTestRoleV1::RdOwner))
            .await
            .is_err(),
            "rd_owner must be denied on Portfolio custody"
        );

        cleanup(
            &pool,
            execution_pool,
            &suffix,
            &execution_scope_identity,
            &format!("execution-node-{suffix}"),
        )
        .await;
        assert_eq!(own_counts(&pool, &suffix).await, (0, 0, 0));
    }

    /// Rewrites two fields of Execution's committed opening fact in place.
    ///
    /// Portfolio's own refusals need collateral Execution's validation would never commit, so the
    /// proof tampers here and restores the Owner's own values afterwards.
    async fn tamper_opening_collateral(
        pool: &PgPool,
        namespace: &str,
        currency: &str,
        amount: &str,
    ) {
        sqlx::query(
            "UPDATE execution_private.execution_paper_account_opening_facts_v1
                SET meaning_json = pg_catalog.jsonb_set(
                      pg_catalog.jsonb_set(meaning_json, '{collateral_currency}', $2),
                      '{collateral_amount}', $3)
              WHERE account_namespace = $1",
        )
        .bind(namespace)
        .bind(serde_json::Value::String(currency.to_string()))
        .bind(serde_json::Value::String(amount.to_string()))
        .execute(pool)
        .await
        .unwrap();
    }

    /// Removes exactly what this proof wrote, in both Owners' own custody.
    async fn cleanup(
        pool: &PgPool,
        execution: &PgPool,
        marker: &str,
        scope_identity: &str,
        node_identity: &str,
    ) {
        let like = format!("%{marker}%");

        for statement in [
            "DELETE FROM portfolio_private.portfolio_owner_outbox_v1 outbox
              WHERE EXISTS (SELECT 1 FROM portfolio_private.portfolio_capacity_scope_registry_cuts_v1 cut
                             WHERE cut.proof_frontier_identity = outbox.event_identity
                               AND cut.registry_json::text LIKE $1)",
            "DELETE FROM portfolio_private.portfolio_capacity_views_v1 view_record
              WHERE EXISTS (SELECT 1 FROM portfolio_private.portfolio_capacity_scope_bound_readbacks_v1 readback
                             WHERE readback.capacity_scope_identity = view_record.capacity_scope_identity
                               AND readback.request_identity LIKE $1)",
            "DELETE FROM portfolio_private.portfolio_capacity_scope_bound_readbacks_v1 WHERE request_identity LIKE $1",
            "DELETE FROM portfolio_private.portfolio_capacity_scope_registry_heads_v1 head
              WHERE EXISTS (SELECT 1 FROM portfolio_private.portfolio_capacity_scope_registry_cuts_v1 cut
                             WHERE cut.proof_frontier_identity = head.proof_frontier_identity
                               AND cut.registry_json::text LIKE $1)",
            "DELETE FROM portfolio_private.portfolio_capacity_scope_registry_cuts_v1 WHERE registry_json::text LIKE $1",
        ] {
            sqlx::query(statement)
                .bind(&like)
                .execute(pool)
                .await
                .unwrap();
        }
        cleanup_execution_scope(execution, scope_identity, node_identity).await;
    }

    /// Removes the Execution facts this proof asked Execution's own custody to commit.
    ///
    /// The stream row is shared by every scope one Execution node writes, so it is removed last
    /// and only by this proof's own node identity.
    async fn cleanup_execution_scope(
        execution: &PgPool,
        scope_identity: &str,
        node_identity: &str,
    ) {
        for statement in [
            "DELETE FROM execution_private.execution_paper_adapter_binding_outbox_v1 outbox
              WHERE EXISTS (SELECT 1 FROM execution_private.execution_paper_adapter_binding_facts_v1 fact
                             WHERE fact.fact_identity = outbox.fact_identity
                               AND fact.execution_scope_identity LIKE $1)",
            "DELETE FROM execution_private.execution_paper_account_opening_facts_v1
              WHERE execution_scope_identity LIKE $1",
            "DELETE FROM execution_private.execution_paper_adapter_binding_heads_v1
              WHERE execution_scope_identity LIKE $1",
            "DELETE FROM execution_private.execution_paper_namespace_reservations_v1
              WHERE execution_scope_identity LIKE $1",
            "DELETE FROM execution_private.execution_paper_adapter_binding_facts_v1
              WHERE execution_scope_identity LIKE $1",
        ] {
            sqlx::query(statement)
                .bind(scope_identity)
                .execute(execution)
                .await
                .unwrap();
        }
        sqlx::query(
            "DELETE FROM execution_private.execution_paper_adapter_binding_streams_v1
              WHERE owner_node_identity = $1",
        )
        .bind(node_identity)
        .execute(execution)
        .await
        .unwrap();
    }

    #[rstest]
    fn state_and_schema_vocabulary_is_stable() {
        assert_eq!(CapacityScopeState::Bound, CapacityScopeState::Bound);
        assert_eq!(CAPACITY_SCOPE_SCHEMA_VERSION, 1);
    }
}
