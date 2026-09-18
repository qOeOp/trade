//! PostgreSQL custody for the Governance Strategy Registry.
//!
//! This module holds the one thing the crate's static in-memory core cannot: a real source-Owner
//! reread. Before it creates an immutable Execution Scope it rereads Portfolio's own `BOUND`
//! Capacity Scope and Execution's own current `ADMITTED` PAPER adapter binding, through each
//! Owner's read-only API, inside the transaction that would do the write. The caller's request is
//! coordinates and expectations only; a prebinding the two Owners do not both confirm creates no
//! scope and writes nothing.
//!
//! What this custody deliberately does not create:
//!
//! - the **Governed Strategy Entry**, which the architecture defines as binding an exact Eligibility
//!   Fact, generation-specific economic-condition versions, and a qualified capacity ceiling.
//!   Qualification has no production writer for those, so an entry minted here would be a weaker
//!   fact than the documented one;
//! - **lifecycle requests, receipts, and Authorized Generation Decisions**, which additionally need
//!   the R&D build receipt and the Autonomous Policy Authorization. Neither has a production
//!   writer either.
//!
//! The pool is never reachable from outside this crate:
//!
//! ```compile_fail
//! use vibe_strategy_governance::registry_postgres::StrategyRegistryPostgresV1;
//!
//! fn raw_writer(registry: &StrategyRegistryPostgresV1) {
//!     let _ = registry.pool();
//! }
//! ```

use std::{
    fmt::{Debug, Display},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::Value;
use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgPoolOptions};

use crate::execution_scope::{
    AdmittedAdapterBindingFact, BoundCapacityScopeFact, ExecutionScopeDecisionTime,
    ExecutionScopePrebindingFailure, GovernedExecutionScope, UnavailableExecutionScopeReadback,
    UntrustedExecutionScopeRequest, seal_execution_scope, unavailable_readback,
};

/// Canonical PostgreSQL role that owns every Governance relation.
pub const GOVERNANCE_OWNER_ROLE: &str = "governance_owner";
/// Canonical login role admitted to write through this custody.
pub const GOVERNANCE_WRITER_ROLE: &str = "governance_writer";
/// Private schema holding every Governance Owner relation.
pub const GOVERNANCE_PRIVATE_SCHEMA: &str = "governance_private";
/// Read-only schema through which other Owners reread a Governance fact.
pub const GOVERNANCE_API_SCHEMA: &str = "governance_api";
/// Outbox kind emitted once per newly created Execution Scope.
pub const EXECUTION_SCOPE_OUTBOX_KIND: &str = "governance-execution-scope-created-v1";

const OWNED_TABLES: [&str; 2] = [
    "governance_execution_scopes_v1",
    "governance_owner_outbox_v1",
];

/// Owner-trusted clock injected by the Governance composition root.
///
/// The caller never supplies decision time. A scope's creation time and every freshness comparison
/// come from this clock alone.
pub trait GovernanceOwnerClock: Send + Sync + Debug {
    /// Samples the current Owner-trusted epoch milliseconds.
    ///
    /// # Errors
    ///
    /// Returns [`GovernanceCustodyError::ClockUnavailable`] when no valid sample exists.
    fn now_epoch_ms(&self) -> Result<u64, GovernanceCustodyError>;
}

/// System clock, the only production implementation.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemGovernanceOwnerClock;

impl GovernanceOwnerClock for SystemGovernanceOwnerClock {
    fn now_epoch_ms(&self) -> Result<u64, GovernanceCustodyError> {
        let elapsed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| GovernanceCustodyError::ClockUnavailable)?
            .as_millis();
        let now = u64::try_from(elapsed).map_err(|_| GovernanceCustodyError::ClockUnavailable)?;

        if now == 0 {
            return Err(GovernanceCustodyError::ClockUnavailable);
        }
        Ok(now)
    }
}

/// Failure of a Governance custody operation.
///
/// A business refusal is never an error here: it is an [`ExecutionScopeResolution::Unavailable`]
/// carrying every typed reason. These two members mean the Owner could not decide at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GovernanceCustodyError {
    /// The Owner clock produced no valid sample.
    ClockUnavailable,
    /// Custody is unreachable, not admitted for this role, or structurally wrong.
    StoreUnavailable,
}

impl Display for GovernanceCustodyError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match *self {
            Self::ClockUnavailable => formatter.write_str("Governance Owner clock unavailable"),
            Self::StoreUnavailable => formatter.write_str("Governance Owner custody unavailable"),
        }
    }
}

impl std::error::Error for GovernanceCustodyError {}

/// Outcome of one Execution Scope creation attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutionScopeResolution {
    /// The scope did not exist and this call created it.
    Created(Box<GovernedExecutionScope>),
    /// The scope already existed with exactly this meaning, and nothing was written.
    Replayed(Box<GovernedExecutionScope>),
    /// No scope was created and nothing was written.
    Unavailable(Box<UnavailableExecutionScopeReadback>),
}

/// Governance Strategy Registry custody node.
pub struct StrategyRegistryPostgresV1 {
    pool: PgPool,
    clock: Arc<dyn GovernanceOwnerClock>,
}

impl Debug for StrategyRegistryPostgresV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(StrategyRegistryPostgresV1))
            .finish_non_exhaustive()
    }
}

impl StrategyRegistryPostgresV1 {
    /// Connects as the Governance writer and materializes the Owner relations.
    ///
    /// # Errors
    ///
    /// Returns [`GovernanceCustodyError::StoreUnavailable`] when the connection fails, the role is
    /// not the admitted writer, or the relations cannot be created.
    pub async fn connect(
        database_url: &str,
        clock: Arc<dyn GovernanceOwnerClock>,
    ) -> Result<Self, GovernanceCustodyError> {
        let registry = Self::attach(database_url, clock).await?;
        registry.migrate().await?;
        registry.verify_admission().await?;
        Ok(registry)
    }

    /// Connects to an already materialized topology without running any DDL.
    ///
    /// # Errors
    ///
    /// Returns [`GovernanceCustodyError::StoreUnavailable`] when the role, its membership, or the
    /// owned relations do not match the canonical Governance topology.
    pub async fn connect_existing(
        database_url: &str,
        clock: Arc<dyn GovernanceOwnerClock>,
    ) -> Result<Self, GovernanceCustodyError> {
        let registry = Self::attach(database_url, clock).await?;
        registry.verify_admission().await?;
        Ok(registry)
    }

    async fn attach(
        database_url: &str,
        clock: Arc<dyn GovernanceOwnerClock>,
    ) -> Result<Self, GovernanceCustodyError> {
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

    async fn migrate(&self) -> Result<(), GovernanceCustodyError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        sqlx::query("SET LOCAL ROLE governance_owner")
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;

        for statement in [
            // The scope is columnar, not a stored document: its freshness bound is a projection of
            // the two current source facts, so nothing here may carry a validity window that ages.
            "CREATE TABLE IF NOT EXISTS governance_private.governance_execution_scopes_v1 ( \
                scope_identity TEXT PRIMARY KEY CHECK (scope_identity <> ''), \
                scope_digest TEXT NOT NULL UNIQUE CHECK (scope_digest <> ''), \
                mode TEXT NOT NULL CHECK (mode = 'PAPER'), \
                capacity_scope_identity TEXT NOT NULL CHECK (capacity_scope_identity <> ''), \
                account_namespace TEXT NOT NULL CHECK (account_namespace <> ''), \
                effect_namespace TEXT NOT NULL UNIQUE CHECK (effect_namespace <> ''), \
                economic_pool_identity TEXT NOT NULL CHECK (economic_pool_identity <> ''), \
                economic_pool_currency TEXT NOT NULL CHECK (economic_pool_currency <> ''), \
                shared_constraint_identities TEXT[] NOT NULL, \
                adapter_binding_fact_identity TEXT NOT NULL UNIQUE \
                  CHECK (adapter_binding_fact_identity <> ''), \
                adapter_binding_generation BIGINT NOT NULL CHECK (adapter_binding_generation > 0), \
                adapter_implementation_digest TEXT NOT NULL CHECK (adapter_implementation_digest <> ''), \
                adapter_configuration_digest TEXT NOT NULL CHECK (adapter_configuration_digest <> ''), \
                trust_policy_identity TEXT NOT NULL CHECK (trust_policy_identity <> ''), \
                reduce_only_policy TEXT NOT NULL CHECK (reduce_only_policy <> ''), \
                endpoint_identity TEXT NOT NULL CHECK (endpoint_identity <> ''), \
                capabilities TEXT[] NOT NULL CHECK (pg_catalog.cardinality(capabilities) > 0), \
                created_under_proof_frontier_identity TEXT NOT NULL \
                  CHECK (created_under_proof_frontier_identity <> ''), \
                created_by_request_identity TEXT NOT NULL CHECK (created_by_request_identity <> ''), \
                created_at_epoch_ms BIGINT NOT NULL CHECK (created_at_epoch_ms > 0))",
            "CREATE TABLE IF NOT EXISTS governance_private.governance_owner_outbox_v1 ( \
                event_identity TEXT PRIMARY KEY CHECK (event_identity <> ''), \
                event_kind TEXT NOT NULL CHECK (event_kind <> ''), \
                aggregate_identity TEXT NOT NULL CHECK (aggregate_identity <> ''), \
                payload_digest TEXT NOT NULL CHECK (payload_digest <> ''), \
                committed_at_epoch_ms BIGINT NOT NULL CHECK (committed_at_epoch_ms > 0))",
            "CREATE OR REPLACE FUNCTION governance_api.read_current_execution_scope_v1(scope_identity text) \
             RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER \
             SET search_path = pg_catalog, governance_private AS $$ \
                SELECT jsonb_build_object( \
                    'scope_identity', scope.scope_identity, \
                    'scope_digest', scope.scope_digest, \
                    'mode', scope.mode, \
                    'capacity_scope_identity', scope.capacity_scope_identity, \
                    'account_namespace', scope.account_namespace, \
                    'effect_namespace', scope.effect_namespace, \
                    'economic_pool_identity', scope.economic_pool_identity, \
                    'economic_pool_currency', scope.economic_pool_currency, \
                    'shared_constraint_identities', \
                        pg_catalog.to_jsonb(scope.shared_constraint_identities), \
                    'adapter_binding_fact_identity', scope.adapter_binding_fact_identity, \
                    'endpoint_identity', scope.endpoint_identity, \
                    'capabilities', pg_catalog.to_jsonb(scope.capabilities), \
                    'created_at_epoch_ms', scope.created_at_epoch_ms) \
                  FROM governance_private.governance_execution_scopes_v1 scope \
                 WHERE scope.scope_identity = read_current_execution_scope_v1.scope_identity \
             $$",
            "REVOKE ALL ON FUNCTION governance_api.read_current_execution_scope_v1(text) FROM PUBLIC",
        ] {
            sqlx::query(statement)
                .execute(&mut *transaction)
                .await
                .map_err(storage)?;
        }
        transaction.commit().await.map_err(storage)
    }

    async fn verify_admission(&self) -> Result<(), GovernanceCustodyError> {
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
                      SELECT pg_catalog.count(*) = $4
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
        .bind(GOVERNANCE_WRITER_ROLE)
        .bind(GOVERNANCE_OWNER_ROLE)
        .bind(GOVERNANCE_PRIVATE_SCHEMA)
        .bind(
            i64::try_from(OWNED_TABLES.len())
                .map_err(|_| GovernanceCustodyError::StoreUnavailable)?,
        )
        .bind(OWNED_TABLES.to_vec())
        .fetch_one(&self.pool)
        .await
        .map_err(storage)?;

        if !admitted {
            return Err(GovernanceCustodyError::StoreUnavailable);
        }
        Ok(())
    }

    /// Creates one immutable Execution Scope, or names every reason it created none.
    ///
    /// Portfolio's `BOUND` Capacity Scope and Execution's current `ADMITTED` PAPER adapter binding
    /// are reread through their own read-only APIs inside this transaction. The two Owners must
    /// agree with each other on account and prebinding, and with the caller on every expectation.
    /// A replay that binds the same meaning keeps the original creation time, refreshes the
    /// validity bound from the two current source facts, and writes nothing.
    ///
    /// # Errors
    ///
    /// Returns [`GovernanceCustodyError`] only when the clock or custody is unavailable. Every
    /// business refusal is an [`ExecutionScopeResolution::Unavailable`].
    pub async fn create_execution_scope(
        &self,
        request: &UntrustedExecutionScopeRequest,
    ) -> Result<ExecutionScopeResolution, GovernanceCustodyError> {
        let observed_at_epoch_ms = self.clock.now_epoch_ms()?;

        if !request.well_formed() {
            return Ok(refused(
                request,
                vec![ExecutionScopePrebindingFailure::RequestMalformed],
            ));
        }
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        // One scope identity is resolved at a time, so two concurrent creations cannot both see an
        // empty row and both insert.
        sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))")
            .bind(&request.execution_scope_identity)
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
        let sources = read_source_owner_facts(&mut transaction, request).await?;
        let (capacity, binding) = match sources {
            Ok(facts) => facts,
            Err(failures) => {
                transaction.rollback().await.map_err(storage)?;
                return Ok(refused(request, failures));
            }
        };
        let existing =
            load_existing_scope(&mut transaction, &request.execution_scope_identity).await?;
        let created_at_epoch_ms = existing
            .as_ref()
            .map_or(observed_at_epoch_ms, |row| row.created_at_epoch_ms);
        let sealed = match seal_execution_scope(
            request,
            &capacity,
            &binding,
            ExecutionScopeDecisionTime {
                observed_at_epoch_ms,
                created_at_epoch_ms,
            },
        ) {
            Ok(sealed) => sealed,
            Err(failures) => {
                transaction.rollback().await.map_err(storage)?;
                return Ok(refused(request, failures));
            }
        };

        if let Some(existing) = existing {
            transaction.rollback().await.map_err(storage)?;

            if existing.scope_digest != sealed.scope_digest() {
                return Ok(refused(
                    request,
                    vec![ExecutionScopePrebindingFailure::ScopeAlreadyBoundToAnotherMeaning],
                ));
            }
            return Ok(ExecutionScopeResolution::Replayed(Box::new(sealed)));
        }
        insert_scope(&mut transaction, request, &capacity, &binding, &sealed).await?;
        transaction.commit().await.map_err(storage)?;
        Ok(ExecutionScopeResolution::Created(Box::new(sealed)))
    }

    /// Rereads one Execution Scope through this Owner's own read-only API.
    ///
    /// # Errors
    ///
    /// Returns [`GovernanceCustodyError::StoreUnavailable`] when custody is unavailable.
    pub async fn read_current_execution_scope(
        &self,
        scope_identity: &str,
    ) -> Result<Option<Value>, GovernanceCustodyError> {
        sqlx::query_scalar("SELECT governance_api.read_current_execution_scope_v1($1)")
            .bind(scope_identity)
            .fetch_one(&self.pool)
            .await
            .map_err(storage)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StoredScopeRow {
    scope_digest: String,
    created_at_epoch_ms: u64,
}

async fn load_existing_scope(
    transaction: &mut Transaction<'_, Postgres>,
    scope_identity: &str,
) -> Result<Option<StoredScopeRow>, GovernanceCustodyError> {
    let row = sqlx::query(
        "SELECT scope_digest, created_at_epoch_ms
           FROM governance_private.governance_execution_scopes_v1
          WHERE scope_identity = $1
            FOR UPDATE",
    )
    .bind(scope_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(storage)?;
    let Some(row) = row else {
        return Ok(None);
    };
    let scope_digest: String = row.try_get("scope_digest").map_err(storage)?;
    let created_at: i64 = row.try_get("created_at_epoch_ms").map_err(storage)?;
    Ok(Some(StoredScopeRow {
        scope_digest,
        created_at_epoch_ms: u64::try_from(created_at)
            .map_err(|_| GovernanceCustodyError::StoreUnavailable)?,
    }))
}

async fn insert_scope(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedExecutionScopeRequest,
    capacity: &BoundCapacityScopeFact,
    binding: &AdmittedAdapterBindingFact,
    sealed: &GovernedExecutionScope,
) -> Result<(), GovernanceCustodyError> {
    sqlx::query(
        "INSERT INTO governance_private.governance_execution_scopes_v1
            (scope_identity, scope_digest, mode, capacity_scope_identity, account_namespace,
             effect_namespace, economic_pool_identity, economic_pool_currency,
             shared_constraint_identities, adapter_binding_fact_identity,
             adapter_binding_generation, adapter_implementation_digest,
             adapter_configuration_digest, trust_policy_identity, reduce_only_policy,
             endpoint_identity, capabilities, created_under_proof_frontier_identity,
             created_by_request_identity, created_at_epoch_ms)
         VALUES ($1, $2, 'PAPER', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                 $17, $18, $19)",
    )
    .bind(sealed.scope_identity())
    .bind(sealed.scope_digest())
    .bind(&capacity.capacity_scope_identity)
    .bind(&capacity.account_namespace)
    .bind(&binding.effect_namespace)
    .bind(&capacity.economic_pool_identity)
    .bind(&capacity.economic_pool_currency)
    .bind(&capacity.shared_constraint_identities)
    .bind(&binding.fact_identity)
    .bind(to_i64(binding.generation)?)
    .bind(&binding.implementation_digest)
    .bind(&binding.configuration_digest)
    .bind(&binding.trust_policy_identity)
    .bind(&binding.reduce_only_policy)
    .bind(&binding.endpoint_identity)
    .bind(&binding.capabilities)
    .bind(&capacity.proof_frontier_identity)
    .bind(&request.request_identity)
    .bind(to_i64(sealed.created_at_epoch_ms())?)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    sqlx::query(
        "INSERT INTO governance_private.governance_owner_outbox_v1
            (event_identity, event_kind, aggregate_identity, payload_digest, committed_at_epoch_ms)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(sealed.scope_identity())
    .bind(EXECUTION_SCOPE_OUTBOX_KIND)
    .bind(sealed.scope_identity())
    .bind(sealed.scope_digest())
    .bind(to_i64(sealed.created_at_epoch_ms())?)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    Ok(())
}

/// Rereads both source Owners through their own read-only APIs.
///
/// A missing row and a payload this Owner cannot parse are the same thing to a consumer, an
/// unavailable source fact, and both name which Owner was unavailable rather than collapsing into
/// one anonymous refusal.
type SourceOwnerFacts = Result<
    (BoundCapacityScopeFact, AdmittedAdapterBindingFact),
    Vec<ExecutionScopePrebindingFailure>,
>;

async fn read_source_owner_facts(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedExecutionScopeRequest,
) -> Result<SourceOwnerFacts, GovernanceCustodyError> {
    let capacity_payload: Option<Value> =
        sqlx::query_scalar("SELECT portfolio_api.read_bound_capacity_scope_v1($1)")
            .bind(&request.capacity_scope_request_identity)
            .fetch_one(&mut **transaction)
            .await
            .map_err(storage)?;
    let binding_payload: Option<Value> =
        sqlx::query_scalar("SELECT execution_api.read_current_paper_adapter_binding_v1($1)")
            .bind(&request.execution_scope_identity)
            .fetch_one(&mut **transaction)
            .await
            .map_err(storage)?;
    let capacity = capacity_payload.as_ref().and_then(parse_capacity_scope);
    let binding = binding_payload.as_ref().and_then(parse_adapter_binding);
    let mut failures = Vec::new();

    if capacity.is_none() {
        failures.push(ExecutionScopePrebindingFailure::CapacityScopeUnavailable);
    }

    if binding.is_none() {
        failures.push(ExecutionScopePrebindingFailure::AdapterBindingUnavailable);
    }

    if let (Some(capacity), Some(binding)) = (capacity, binding) {
        return Ok(Ok((capacity, binding)));
    }
    Ok(Err(failures))
}

fn parse_capacity_scope(payload: &Value) -> Option<BoundCapacityScopeFact> {
    Some(BoundCapacityScopeFact {
        state: text(payload, "state")?,
        mode: text(payload, "mode")?,
        capacity_scope_identity: text(payload, "capacity_scope_identity")?,
        account_namespace: text(payload, "account_namespace")?,
        economic_pool_identity: text(payload, "economic_pool_identity")?,
        economic_pool_currency: text(payload, "economic_pool_currency")?,
        adapter_binding_identity: text(payload, "adapter_binding_identity")?,
        shared_constraint_identities: text_list(payload, "shared_constraint_identities")?,
        proof_frontier_identity: text(payload, "proof_frontier_identity")?,
        proof_valid_through_epoch_ms: number(payload, "proof_valid_through_epoch_ms")?,
    })
}

fn parse_adapter_binding(payload: &Value) -> Option<AdmittedAdapterBindingFact> {
    let meaning = payload.get("binding")?;
    Some(AdmittedAdapterBindingFact {
        fact_identity: text(payload, "fact_identity")?,
        state: text(meaning, "state")?,
        mode: text(meaning, "mode")?,
        generation: number(meaning, "generation")?,
        execution_scope_identity: text(meaning, "execution_scope_identity")?,
        account_namespace: text(meaning, "account_namespace")?,
        effect_namespace: text(meaning, "effect_namespace")?,
        endpoint_identity: text(meaning, "simulator_endpoint_identity")?,
        implementation_digest: text(meaning, "implementation_digest")?,
        configuration_digest: text(meaning, "configuration_digest")?,
        trust_policy_identity: text(meaning, "trust_policy_identity")?,
        reduce_only_policy: text(meaning, "reduce_only_policy")?,
        capabilities: text_list(meaning, "required_capabilities")?,
        effective_at_epoch_ms: number(meaning, "effective_at_epoch_ms")?,
        exclusive_valid_through_epoch_ms: number(meaning, "exclusive_valid_through_epoch_ms")?,
    })
}

fn text(payload: &Value, field: &str) -> Option<String> {
    payload
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn text_list(payload: &Value, field: &str) -> Option<Vec<String>> {
    payload
        .get(field)
        .and_then(Value::as_array)?
        .iter()
        .map(|entry| entry.as_str().map(str::to_owned))
        .collect()
}

fn number(payload: &Value, field: &str) -> Option<u64> {
    payload.get(field).and_then(Value::as_u64)
}

fn refused(
    request: &UntrustedExecutionScopeRequest,
    failures: Vec<ExecutionScopePrebindingFailure>,
) -> ExecutionScopeResolution {
    ExecutionScopeResolution::Unavailable(Box::new(unavailable_readback(request, failures)))
}

fn to_i64(value: u64) -> Result<i64, GovernanceCustodyError> {
    i64::try_from(value).map_err(|_| GovernanceCustodyError::StoreUnavailable)
}

fn storage<E: Display>(error: E) -> GovernanceCustodyError {
    if cfg!(test) {
        eprintln!("governance custody storage error: {error}");
    }
    GovernanceCustodyError::StoreUnavailable
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use serde_json::json;

    use super::*;

    #[rstest]
    fn a_capacity_payload_missing_its_partition_is_an_unavailable_fact() {
        let payload = json!({
            "state": "BOUND",
            "mode": "PAPER",
            "capacity_scope_identity": "capacity-scope-alpha",
            "account_namespace": "paper-account-alpha",
            "economic_pool_identity": "pool-alpha",
            "economic_pool_currency": "USD",
            "adapter_binding_identity": "binding-fact-alpha",
            "proof_frontier_identity": "frontier-alpha",
            "proof_valid_through_epoch_ms": 4_000,
        });
        assert!(parse_capacity_scope(&payload).is_none());
    }

    #[rstest]
    fn an_adapter_payload_without_its_meaning_is_an_unavailable_fact() {
        let payload = json!({ "fact_identity": "binding-fact-alpha" });
        assert!(parse_adapter_binding(&payload).is_none());
    }

    #[rstest]
    fn an_empty_string_field_is_not_a_present_field() {
        assert!(text(&json!({ "state": "" }), "state").is_none());
    }

    #[rstest]
    fn the_system_clock_samples_a_non_zero_time() {
        assert!(SystemGovernanceOwnerClock.now_epoch_ms().unwrap() > 0);
    }
}

#[cfg(test)]
mod postgres_proof {
    use std::{
        sync::{Arc, Mutex},
        time::{SystemTime, UNIX_EPOCH},
    };

    use sqlx::PgPool;
    use vibe_execution_owner::{
        adapter_binding::{
            AdapterBindingError, AdapterBindingState, CredentialHandleIdentity,
            PaperAdapterBindingDraft, PaperAdapterCapability, PaperMode, ReduceOnlyPolicy,
            TrustedClock, derive_paper_account_namespace, derive_paper_effect_namespace,
        },
        adapter_binding_postgres::{ExecutionOwnerClock, PaperAdapterBindingPostgresV1},
    };
    use vibe_portfolio_owner::{
        capacity_scope::{
            BoundCapacityScopeReadback, CAPACITY_SCOPE_SCHEMA_VERSION, CapacityScopeMode,
            CapacityScopeResolution, UntrustedCapacityScopeRequest,
        },
        capacity_scope_postgres::{
            CapacityScopeCustodyError, CapacityScopeDefinitionProposal, CapacityScopePostgresV1,
            CapacityScopeRegistryCutReceipt, PortfolioOwnerClock,
        },
    };
    use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

    use super::*;
    use crate::execution_scope::ExecutionScopePrebindingFailure as Failure;

    /// One clock shared by all three Owners, so their facts share one time line.
    #[derive(Debug)]
    struct FixtureClock(Mutex<u64>);

    impl FixtureClock {
        fn new(now_epoch_ms: u64) -> Arc<Self> {
            Arc::new(Self(Mutex::new(now_epoch_ms)))
        }

        fn get(&self) -> u64 {
            *self.0.lock().unwrap()
        }

        fn set(&self, now_epoch_ms: u64) {
            *self.0.lock().unwrap() = now_epoch_ms;
        }
    }

    impl GovernanceOwnerClock for FixtureClock {
        fn now_epoch_ms(&self) -> Result<u64, GovernanceCustodyError> {
            Ok(self.get())
        }
    }

    impl PortfolioOwnerClock for FixtureClock {
        fn now_epoch_ms(&self) -> Result<u64, CapacityScopeCustodyError> {
            Ok(self.get())
        }
    }

    impl ExecutionOwnerClock for FixtureClock {
        fn now(&self) -> Result<TrustedClock, AdapterBindingError> {
            TrustedClock::new(self.get(), 7)
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

    fn capabilities() -> Vec<PaperAdapterCapability> {
        vec![
            PaperAdapterCapability::SubmitOrder,
            PaperAdapterCapability::CancelOrder,
            PaperAdapterCapability::OrderReadback,
            PaperAdapterCapability::AccountReadback,
            PaperAdapterCapability::EnforceableReduceOnly,
        ]
    }

    fn binding_draft(scope_identity: &str, generation: u64, now: u64) -> PaperAdapterBindingDraft {
        let mode = PaperMode::Paper;
        PaperAdapterBindingDraft {
            schema_version: 1,
            binding_version: 1,
            generation,
            mode,
            account_namespace: derive_paper_account_namespace(mode, scope_identity).unwrap(),
            effect_namespace: derive_paper_effect_namespace(mode, scope_identity).unwrap(),
            execution_scope_identity: scope_identity.to_string(),
            source_account_identity: format!("strategy-account-{scope_identity}"),
            simulator_account_identity: format!("sim-account-{scope_identity}"),
            simulator_endpoint_identity: format!("simulator:endpoint:{scope_identity}"),
            implementation_digest: "11".repeat(32),
            configuration_digest: "22".repeat(32),
            required_capabilities: capabilities(),
            reduce_only_policy: ReduceOnlyPolicy::SimulatorRejectIncreaseOrCrossZero,
            credential_handle_identity: CredentialHandleIdentity::parse(format!(
                "credential-handle-{scope_identity}"
            ))
            .unwrap(),
            trust_policy_identity: "execution-paper-trust-v1".to_string(),
            state: AdapterBindingState::Admitted,
            effective_at_epoch_ms: now.saturating_sub(100),
            observed_at_epoch_ms: now,
            exclusive_valid_through_epoch_ms: now + 100_000,
            clock_epoch: 7,
        }
    }

    fn capability_names() -> Vec<String> {
        vec![
            "SUBMIT_ORDER".to_string(),
            "CANCEL_ORDER".to_string(),
            "ORDER_READBACK".to_string(),
            "ACCOUNT_READBACK".to_string(),
            "ENFORCEABLE_REDUCE_ONLY".to_string(),
        ]
    }

    /// One complete prebinding as the two source Owners established it.
    struct Prebinding {
        scope_identity: String,
        account_namespace: String,
        pool_identity: String,
        constraint_identity: String,
        capacity_request_identity: String,
        capacity_scope_identity: String,
    }

    impl Prebinding {
        fn scope_request(&self, suffix: &str, attempt: &str) -> UntrustedExecutionScopeRequest {
            UntrustedExecutionScopeRequest {
                request_identity: format!("governance-scope-request-{attempt}-{suffix}"),
                capacity_scope_request_identity: self.capacity_request_identity.clone(),
                execution_scope_identity: self.scope_identity.clone(),
                expected_capacity_scope_identity: self.capacity_scope_identity.clone(),
                expected_account_namespace: self.account_namespace.clone(),
                expected_economic_pool_identity: self.pool_identity.clone(),
                expected_endpoint_identity: format!("simulator:endpoint:{}", self.scope_identity),
                expected_capabilities: capability_names(),
                expected_shared_constraint_identities: vec![self.constraint_identity.clone()],
            }
        }
    }

    /// Every relation in one Owner schema with its exact row count.
    ///
    /// The ordered chain shares one database that never resets, and each entry runs as its own
    /// single-test `cargo nextest run`, so nothing else writes while this proof does. That makes a
    /// whole-schema snapshot the honest residue check: a hand-picked list of relations can only
    /// prove the ones somebody thought of, and a foreign key only speaks when a delete is missing,
    /// never when a row is left over in a relation the cleanup forgot entirely.
    async fn schema_snapshot(pool: &PgPool, schema: &str) -> Vec<String> {
        sqlx::query_scalar(
            "SELECT relation.relname || '=' ||
                    (pg_catalog.xpath(
                       '/row/c/text()',
                       pg_catalog.query_to_xml(
                         pg_catalog.format('SELECT count(*) AS c FROM %I.%I',
                                           namespace.nspname, relation.relname),
                         false, true, '')))[1]::text
               FROM pg_catalog.pg_class relation
               JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
              WHERE namespace.nspname = $1
                AND relation.relkind = 'r'
              ORDER BY relation.relname",
        )
        .bind(schema)
        .fetch_all(pool)
        .await
        .unwrap()
        .into_iter()
        // An empty relation and a relation that does not exist yet are the same absence of
        // residue, so dropping the zeros makes a fresh database and the shared chain database
        // compare identically. A relation that went from rows to none still shows up, because its
        // entry disappears from one side only.
        .filter(|row: &String| !row.ends_with("=0"))
        .collect()
    }

    /// Portfolio's registry head, which is a single global row keyed on a constant identity.
    ///
    /// Committing any registry cut moves that one row, so a proof that commits one displaces
    /// whatever head was there. Deleting it afterwards would leave the shared chain database with
    /// no head at all, which is destroying another entry's state rather than cleaning up after
    /// this one. The proof captures it first and puts it back.
    async fn registry_head(portfolio: &PgPool) -> Option<(String, String, i64)> {
        let row = sqlx::query(
            "SELECT head_identity, proof_frontier_identity, proof_frontier_sequence
               FROM portfolio_private.portfolio_capacity_scope_registry_heads_v1",
        )
        .fetch_optional(portfolio)
        .await
        .unwrap()?;
        Some((
            row.try_get("head_identity").unwrap(),
            row.try_get("proof_frontier_identity").unwrap(),
            row.try_get("proof_frontier_sequence").unwrap(),
        ))
    }

    async fn restore_registry_head(portfolio: &PgPool, head: Option<(String, String, i64)>) {
        sqlx::query("DELETE FROM portfolio_private.portfolio_capacity_scope_registry_heads_v1")
            .execute(portfolio)
            .await
            .unwrap();

        if let Some((identity, frontier, sequence)) = head {
            sqlx::query(
                "INSERT INTO portfolio_private.portfolio_capacity_scope_registry_heads_v1
                    (head_identity, proof_frontier_identity, proof_frontier_sequence)
                 VALUES ($1, $2, $3)",
            )
            .bind(identity)
            .bind(frontier)
            .bind(sequence)
            .execute(portfolio)
            .await
            .unwrap();
        }
    }

    /// The three Owner schemas this proof can write to, in one comparable value.
    async fn all_schema_snapshots(
        governance: &PgPool,
        portfolio: &PgPool,
        execution: &PgPool,
    ) -> Vec<Vec<String>> {
        vec![
            schema_snapshot(governance, GOVERNANCE_PRIVATE_SCHEMA).await,
            schema_snapshot(portfolio, "portfolio_private").await,
            schema_snapshot(execution, "execution_private").await,
        ]
    }

    async fn own_counts(pool: &PgPool, marker: &str) -> (i64, i64) {
        let scopes: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM governance_private.governance_execution_scopes_v1
              WHERE scope_identity LIKE $1",
        )
        .bind(format!("%{marker}%"))
        .fetch_one(pool)
        .await
        .unwrap();
        let outbox: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM governance_private.governance_owner_outbox_v1
              WHERE aggregate_identity LIKE $1",
        )
        .bind(format!("%{marker}%"))
        .fetch_one(pool)
        .await
        .unwrap();
        (scopes, outbox)
    }

    fn failures(resolution: &ExecutionScopeResolution) -> Vec<Failure> {
        match resolution {
            ExecutionScopeResolution::Unavailable(readback) => readback.failures().to_vec(),
            other => panic!("expected an unavailable readback; this is {other:?}"),
        }
    }

    #[tokio::test]
    #[ignore = "requires the admitted canonical Owner PostgreSQL test topology"]
    async fn postgres_execution_scope_binds_only_what_both_source_owners_confirm() {
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = test_database.mutation();
        let suffix = suffix();
        let portfolio_pool = mutation.pool(CanonicalOwnerTestRoleV1::PortfolioWriter);
        let execution_pool = mutation.pool(CanonicalOwnerTestRoleV1::ExecutionWriter);
        let governance_pool = mutation.pool(CanonicalOwnerTestRoleV1::GovernanceWriter);
        // Taken before any custody connects, so it holds nothing this proof is about to write.
        let baseline = all_schema_snapshots(governance_pool, portfolio_pool, execution_pool).await;
        let displaced_head = registry_head(portfolio_pool).await;
        let clock = FixtureClock::new(1_000_000);
        let scope_identity = format!("paper-scope-{suffix}");
        let pool_identity = format!("pool-{suffix}");
        let constraint_identity = format!("constraint-{suffix}");
        let account_namespace =
            derive_paper_account_namespace(PaperMode::Paper, &scope_identity).unwrap();

        // Execution admits one PAPER adapter binding for this scope, through its own custody.
        let execution = PaperAdapterBindingPostgresV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::ExecutionWriter),
            format!("execution-node-{suffix}"),
            clock.clone(),
        )
        .await
        .unwrap();
        let binding = execution
            .commit(binding_draft(&scope_identity, 1, clock.get()))
            .await
            .unwrap();
        let binding_fact_identity = binding.locator.fact_identity.clone();

        // Portfolio declares a Capacity Scope prebound to exactly that adapter binding fact.
        let portfolio = CapacityScopePostgresV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::PortfolioWriter),
            clock.clone(),
        )
        .await
        .unwrap();
        let definition = CapacityScopeDefinitionProposal {
            account_namespace: account_namespace.clone(),
            mode: CapacityScopeMode::Paper,
            economic_pool_identity: pool_identity.clone(),
            economic_pool_currency: "USDT".to_string(),
            source_binding_identity: format!("source-binding-{suffix}"),
            adapter_binding_identity: binding_fact_identity.clone(),
            shared_constraint_identities: vec![constraint_identity.clone()],
        };
        let cut = portfolio
            .commit_registry_cut(vec![definition.clone()], clock.get() + 200_000)
            .await
            .unwrap();
        let bound = bind_capacity_scope(&portfolio, &definition, &cut, clock.get(), &suffix).await;
        let prebinding = Prebinding {
            scope_identity: scope_identity.clone(),
            account_namespace: account_namespace.clone(),
            pool_identity: pool_identity.clone(),
            constraint_identity: constraint_identity.clone(),
            capacity_request_identity: bound.fingerprint().request_identity().to_string(),
            capacity_scope_identity: bound.capacity_scope_identity().to_string(),
        };

        let governance = StrategyRegistryPostgresV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::GovernanceWriter),
            clock.clone(),
        )
        .await
        .unwrap();
        let pool = governance.pool().clone();
        assert_eq!(own_counts(&pool, &suffix).await, (0, 0));

        let good = prebinding.scope_request(&suffix, "good");

        // A caller expectation the Owners do not confirm creates nothing.
        let mut wrong_endpoint = good.clone();
        wrong_endpoint.request_identity = format!("governance-scope-request-endpoint-{suffix}");
        wrong_endpoint.expected_endpoint_identity = "simulator:endpoint:other".to_string();
        assert_eq!(
            failures(
                &governance
                    .create_execution_scope(&wrong_endpoint)
                    .await
                    .unwrap()
            ),
            vec![Failure::ExpectedEndpointMismatch]
        );
        assert_eq!(own_counts(&pool, &suffix).await, (0, 0));

        // An unreachable source Owner fact names which Owner, and never collapses into one reason.
        let mut unknown_capacity = good.clone();
        unknown_capacity.capacity_scope_request_identity = format!("absent-capacity-{suffix}");
        assert_eq!(
            failures(
                &governance
                    .create_execution_scope(&unknown_capacity)
                    .await
                    .unwrap()
            ),
            vec![Failure::CapacityScopeUnavailable]
        );
        let mut unknown_binding = good.clone();
        unknown_binding.execution_scope_identity = format!("absent-scope-{suffix}");
        assert_eq!(
            failures(
                &governance
                    .create_execution_scope(&unknown_binding)
                    .await
                    .unwrap()
            ),
            vec![Failure::AdapterBindingUnavailable]
        );
        assert_eq!(own_counts(&pool, &suffix).await, (0, 0));

        // Both Owners agree, so one scope is created exactly once.
        let created = match governance.create_execution_scope(&good).await.unwrap() {
            ExecutionScopeResolution::Created(scope) => *scope,
            other => panic!("expected a created scope; this is {other:?}"),
        };
        assert_eq!(created.scope_identity(), scope_identity);
        assert_eq!(
            created.adapter_binding_fact_identity(),
            binding_fact_identity
        );
        assert_eq!(
            created.capacity_scope_identity(),
            prebinding.capacity_scope_identity
        );
        assert_eq!(
            created.effect_namespace(),
            derive_paper_effect_namespace(PaperMode::Paper, &scope_identity).unwrap(),
            "the scope records Execution's own effect namespace"
        );
        assert_eq!(own_counts(&pool, &suffix).await, (1, 1));

        // The Owner's own read API returns the same scope.
        let readback = governance
            .read_current_execution_scope(&scope_identity)
            .await
            .unwrap()
            .expect("the created scope must be readable through governance_api");
        assert_eq!(readback["scope_digest"], created.scope_digest());
        assert_eq!(
            readback["capacity_scope_identity"],
            prebinding.capacity_scope_identity
        );

        // A replay keeps the creation time, refreshes the validity bound, and writes nothing.
        clock.set(clock.get() + 1_000);
        let replayed = match governance.create_execution_scope(&good).await.unwrap() {
            ExecutionScopeResolution::Replayed(scope) => *scope,
            other => panic!("expected a replay; this is {other:?}"),
        };
        assert_eq!(
            replayed.created_at_epoch_ms(),
            created.created_at_epoch_ms()
        );
        assert_eq!(replayed.scope_digest(), created.scope_digest());
        assert_eq!(own_counts(&pool, &suffix).await, (1, 1));

        // A Capacity Scope prebound to an adapter binding Execution never admitted is a conflict,
        // not a narrower scope.
        let conflicting_scope_identity = format!("paper-scope-conflict-{suffix}");
        let conflicting_account =
            derive_paper_account_namespace(PaperMode::Paper, &conflicting_scope_identity).unwrap();
        execution
            .commit(binding_draft(&conflicting_scope_identity, 1, clock.get()))
            .await
            .unwrap();
        let conflicting_definition = CapacityScopeDefinitionProposal {
            account_namespace: conflicting_account.clone(),
            mode: CapacityScopeMode::Paper,
            economic_pool_identity: format!("{pool_identity}-conflict"),
            economic_pool_currency: "USDT".to_string(),
            source_binding_identity: format!("source-binding-conflict-{suffix}"),
            adapter_binding_identity: format!("binding-never-admitted-{suffix}"),
            shared_constraint_identities: vec![format!("{constraint_identity}-conflict")],
        };
        let conflicting_cut = portfolio
            .commit_registry_cut(
                vec![definition.clone(), conflicting_definition.clone()],
                clock.get() + 200_000,
            )
            .await
            .unwrap();
        let conflicting_bound = bind_capacity_scope(
            &portfolio,
            &conflicting_definition,
            &conflicting_cut,
            clock.get(),
            &format!("{suffix}-conflict"),
        )
        .await;
        let conflicting_request = Prebinding {
            scope_identity: conflicting_scope_identity.clone(),
            account_namespace: conflicting_account.clone(),
            pool_identity: format!("{pool_identity}-conflict"),
            constraint_identity: format!("{constraint_identity}-conflict"),
            capacity_request_identity: conflicting_bound
                .fingerprint()
                .request_identity()
                .to_string(),
            capacity_scope_identity: conflicting_bound.capacity_scope_identity().to_string(),
        }
        .scope_request(&suffix, "conflict");
        assert_eq!(
            failures(
                &governance
                    .create_execution_scope(&conflicting_request)
                    .await
                    .unwrap()
            ),
            vec![Failure::AdapterBindingPrebindingConflict]
        );
        assert_eq!(own_counts(&pool, &suffix).await, (1, 1));

        // Both source Owners may legitimately advance, but the scope identity is immutable: a
        // second adapter binding generation is a different meaning, so it rebinds nothing.
        clock.set(clock.get() + 1_000);
        let regenerated = execution
            .commit(binding_draft(&scope_identity, 2, clock.get()))
            .await
            .unwrap();
        let regenerated_definition = CapacityScopeDefinitionProposal {
            adapter_binding_identity: regenerated.locator.fact_identity.clone(),
            ..definition.clone()
        };
        let regenerated_cut = portfolio
            .commit_registry_cut(
                vec![
                    regenerated_definition.clone(),
                    conflicting_definition.clone(),
                ],
                clock.get() + 200_000,
            )
            .await
            .unwrap();
        let regenerated_bound = bind_capacity_scope(
            &portfolio,
            &regenerated_definition,
            &regenerated_cut,
            clock.get(),
            &format!("{suffix}-regenerated"),
        )
        .await;
        let rebind = Prebinding {
            scope_identity: scope_identity.clone(),
            account_namespace: account_namespace.clone(),
            pool_identity: pool_identity.clone(),
            constraint_identity: constraint_identity.clone(),
            capacity_request_identity: regenerated_bound
                .fingerprint()
                .request_identity()
                .to_string(),
            capacity_scope_identity: regenerated_bound.capacity_scope_identity().to_string(),
        }
        .scope_request(&suffix, "rebind");
        assert_eq!(
            failures(&governance.create_execution_scope(&rebind).await.unwrap()),
            vec![Failure::ScopeAlreadyBoundToAnotherMeaning]
        );
        assert_eq!(own_counts(&pool, &suffix).await, (1, 1));
        assert_eq!(
            governance
                .read_current_execution_scope(&scope_identity)
                .await
                .unwrap()
                .expect("the original scope is still the one on record")["scope_digest"],
            created.scope_digest(),
            "an immutable scope keeps its first meaning"
        );

        // Foreign Owner roles hold no privilege over Governance custody.
        for role in ["rd_owner", "product_edge_owner", "backtest_owner"] {
            let usage: bool = sqlx::query_scalar(
                "SELECT pg_catalog.has_schema_privilege($1, 'governance_private', 'USAGE')",
            )
            .bind(role)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert!(!usage, "{role} must not use governance_private");
        }
        assert_eq!(
            StrategyRegistryPostgresV1::connect_existing(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                clock.clone(),
            )
            .await
            .map(|_| ()),
            Err(GovernanceCustodyError::StoreUnavailable)
        );

        cleanup(&pool, portfolio_pool, execution_pool, &suffix).await;
        restore_registry_head(portfolio_pool, displaced_head).await;
        assert_eq!(own_counts(&pool, &suffix).await, (0, 0));
        assert_eq!(
            all_schema_snapshots(governance_pool, portfolio_pool, execution_pool).await,
            baseline,
            "every relation in all three Owner schemas is left exactly as this proof found it"
        );
    }

    async fn bind_capacity_scope(
        portfolio: &CapacityScopePostgresV1,
        definition: &CapacityScopeDefinitionProposal,
        cut: &CapacityScopeRegistryCutReceipt,
        projection_at_epoch_ms: u64,
        marker: &str,
    ) -> Box<BoundCapacityScopeReadback> {
        let scope_identity = cut
            .published_scopes()
            .iter()
            .find(|published| published.account_namespace == definition.account_namespace)
            .expect("the definition just committed must appear in the receipt")
            .capacity_scope_identity
            .clone();
        let request = UntrustedCapacityScopeRequest {
            schema_version: CAPACITY_SCOPE_SCHEMA_VERSION,
            request_identity: format!("capacity-request-{marker}-{projection_at_epoch_ms}"),
            account_namespace: definition.account_namespace.clone(),
            mode: definition.mode,
            economic_pool_identity: definition.economic_pool_identity.clone(),
            expected_capacity_scope_identity: scope_identity,
            expected_registry_cut_identity: cut.registry_cut_identity().to_string(),
            expected_source_binding_identity: definition.source_binding_identity.clone(),
            expected_adapter_binding_identity: definition.adapter_binding_identity.clone(),
            expected_membership_proof_identity: cut.membership_proof_identity().to_string(),
            expected_proof_frontier_identity: cut.proof_frontier_identity().to_string(),
            expected_proof_frontier_sequence: cut.proof_frontier_sequence(),
            projection_at_epoch_ms,
        };

        match portfolio
            .resolve_bound_capacity_scope(&request)
            .await
            .unwrap()
        {
            CapacityScopeResolution::Bound(readback) => readback,
            other => panic!("Portfolio must bind the scope this proof just declared: {other:?}"),
        }
    }

    async fn cleanup(governance: &PgPool, portfolio: &PgPool, execution: &PgPool, marker: &str) {
        let like = format!("%{marker}%");

        for (pool, statement) in [
            (
                governance,
                "DELETE FROM governance_private.governance_owner_outbox_v1
                  WHERE aggregate_identity LIKE $1",
            ),
            (
                governance,
                "DELETE FROM governance_private.governance_execution_scopes_v1
                  WHERE scope_identity LIKE $1",
            ),
            (
                portfolio,
                "DELETE FROM portfolio_private.portfolio_capacity_scope_bound_readbacks_v1
                  WHERE request_identity LIKE $1",
            ),
            (
                portfolio,
                "DELETE FROM portfolio_private.portfolio_owner_outbox_v1 outbox
                  WHERE EXISTS (
                    SELECT 1 FROM portfolio_private.portfolio_capacity_scope_registry_cuts_v1 cut
                     WHERE cut.proof_frontier_identity = outbox.event_identity
                       AND cut.registry_json::text LIKE $1)",
            ),
            (
                portfolio,
                "DELETE FROM portfolio_private.portfolio_capacity_scope_registry_heads_v1 head
                  WHERE EXISTS (
                    SELECT 1 FROM portfolio_private.portfolio_capacity_scope_registry_cuts_v1 cut
                     WHERE cut.proof_frontier_identity = head.proof_frontier_identity
                       AND cut.registry_json::text LIKE $1)",
            ),
            (
                portfolio,
                "DELETE FROM portfolio_private.portfolio_capacity_scope_registry_cuts_v1
                  WHERE registry_json::text LIKE $1",
            ),
        ] {
            sqlx::query(statement)
                .bind(&like)
                .execute(pool)
                .await
                .unwrap();
        }
        cleanup_execution_scope(execution, &like, &format!("execution-node-{marker}")).await;
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
}
