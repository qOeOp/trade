//! PostgreSQL custody for the Risk Owner capacity input read port.
//!
//! One read, sealed. Inside a single transaction this rereads Portfolio's own `BOUND` Capacity
//! Scope and its current Capacity View through that Owner's `portfolio_api` read functions, and
//! writes one observation recording what it read and the evidence cut it read it at.
//!
//! It makes no Risk decision, commits no Reservation, writes no fence, and consumes no Trade
//! Intent. Those four have no producer upstream, and minting a weaker version of any of them here
//! would be a documentation change rather than an implementation.
//!
//! The pool is never reachable from outside this crate:
//!
//! ```compile_fail
//! use vibe_risk_owner::capacity_read_port_postgres::RiskCapacityReadPortPostgresV1;
//!
//! fn raw_writer(port: &RiskCapacityReadPortPostgresV1) {
//!     let _ = port.pool();
//! }
//! ```

use std::{
    fmt::{Debug, Display},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, postgres::PgPoolOptions};

use crate::capacity_observation::{
    CapacityObservationRefusal, RISK_CAPACITY_OBSERVATION_SCHEMA_V1, SealedCapacityObservationV1,
};

/// Canonical PostgreSQL role that owns every Risk relation.
pub const RISK_OWNER_ROLE: &str = "risk_owner";
/// Canonical login role admitted to write through this custody.
pub const RISK_WRITER_ROLE: &str = "risk_writer";
/// Private schema holding every Risk Owner relation.
pub const RISK_PRIVATE_SCHEMA: &str = "risk_private";
/// Read-only schema through which other Owners would reread a Risk fact.
pub const RISK_API_SCHEMA: &str = "risk_api";
/// Domain separator for a sealed observation identity.
const OBSERVATION_IDENTITY_DOMAIN: &[u8] = b"vibe.risk.capacity-observation.v1\0";

const OWNED_TABLES: [&str; 1] = ["risk_capacity_observations_v1"];

/// Owner-sampled clock. The caller never supplies observation time.
pub trait RiskOwnerClock: Send + Sync + Debug {
    /// Samples the current Owner-trusted epoch milliseconds.
    ///
    /// # Errors
    ///
    /// Returns [`RiskCustodyError::ClockUnavailable`] when no valid sample exists.
    fn now_epoch_ms(&self) -> Result<u64, RiskCustodyError>;
}

/// System clock, the only production implementation.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemRiskOwnerClock;

impl RiskOwnerClock for SystemRiskOwnerClock {
    fn now_epoch_ms(&self) -> Result<u64, RiskCustodyError> {
        let elapsed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| RiskCustodyError::ClockUnavailable)?
            .as_millis();
        let now = u64::try_from(elapsed).map_err(|_| RiskCustodyError::ClockUnavailable)?;

        if now == 0 {
            return Err(RiskCustodyError::ClockUnavailable);
        }
        Ok(now)
    }
}

/// Failure of a Risk custody operation.
///
/// A business refusal is never an error here: it is an [`CapacityObservation::Refused`] carrying
/// its own named cause. These two mean the Owner could not decide at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RiskCustodyError {
    /// The Owner clock produced no valid sample.
    ClockUnavailable,
    /// The database could not be reached at all.
    ///
    /// Distinct from the two below: nothing about this Owner's topology has been examined yet.
    ConnectionUnavailable,
    /// The Owner relations could not be materialised.
    RelationsUnavailable,
    /// The connected role is not this Owner's admitted writer, or its relations are not shaped
    /// the way admission requires.
    ///
    /// Kept apart from [`Self::RelationsUnavailable`] because the two have different causes and
    /// different repairs: one is a migration that could not run, the other a migration that ran
    /// and produced something admission rejects. Collapsing them cost one full ordered-chain
    /// round to tell apart when this custody was first written.
    NotAdmitted,
}

impl Display for RiskCustodyError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match *self {
            Self::ClockUnavailable => formatter.write_str("Risk Owner clock unavailable"),
            Self::ConnectionUnavailable => formatter.write_str("Risk Owner database unreachable"),
            Self::RelationsUnavailable => {
                formatter.write_str("Risk Owner relations could not be materialised")
            }
            Self::NotAdmitted => formatter.write_str("Risk Owner custody is not admitted"),
        }
    }
}

impl std::error::Error for RiskCustodyError {}

/// Outcome of one capacity observation attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CapacityObservation {
    /// The observation did not exist and this call sealed it.
    Sealed(Box<SealedCapacityObservationV1>),
    /// An observation of exactly this content already existed, and nothing was written.
    ///
    /// The identity is derived from observed content and never from observation time, so a second
    /// observation of the same evidence cut joins the first rather than appending a row.
    Replayed(Box<SealedCapacityObservationV1>),
    /// Nothing was observed and nothing was written.
    Refused(CapacityObservationRefusal),
}

/// Risk capacity input read port custody node.
pub struct RiskCapacityReadPortPostgresV1 {
    pool: PgPool,
    clock: Arc<dyn RiskOwnerClock>,
}

impl Debug for RiskCapacityReadPortPostgresV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(RiskCapacityReadPortPostgresV1))
            .finish_non_exhaustive()
    }
}

impl RiskCapacityReadPortPostgresV1 {
    /// Connects as the Risk writer and materializes the Owner relations.
    ///
    /// # Errors
    ///
    /// Returns [`RiskCustodyError::ConnectionUnavailable`] when the database cannot be reached,
    /// [`RiskCustodyError::RelationsUnavailable`] when the relations cannot be materialised, and
    /// [`RiskCustodyError::NotAdmitted`] when the role or the materialised relations are not what
    /// admission requires.
    pub async fn connect(
        database_url: &str,
        clock: Arc<dyn RiskOwnerClock>,
    ) -> Result<Self, RiskCustodyError> {
        let port = Self::attach(database_url, clock).await?;
        port.migrate().await?;
        port.verify_admission().await?;
        Ok(port)
    }

    /// Connects to an already materialized topology without running any DDL.
    ///
    /// # Errors
    ///
    /// Returns [`RiskCustodyError::ConnectionUnavailable`] when the database cannot be reached,
    /// and [`RiskCustodyError::NotAdmitted`] when the role, its membership, or the owned relations
    /// do not match the canonical Risk topology.
    pub async fn connect_existing(
        database_url: &str,
        clock: Arc<dyn RiskOwnerClock>,
    ) -> Result<Self, RiskCustodyError> {
        let port = Self::attach(database_url, clock).await?;
        port.verify_admission().await?;
        Ok(port)
    }

    async fn attach(
        database_url: &str,
        clock: Arc<dyn RiskOwnerClock>,
    ) -> Result<Self, RiskCustodyError> {
        let pool = PgPoolOptions::new()
            .max_connections(4)
            .connect(database_url)
            .await
            .map_err(storage)?;
        Ok(Self { pool, clock })
    }

    /// Pool handle for this crate's own PostgreSQL proof only.
    ///
    /// Not public: a caller outside this crate cannot reach the pool, which is what keeps the
    /// sealed observation the only way to learn what this Owner read.
    #[cfg(test)]
    pub(crate) const fn pool(&self) -> &PgPool {
        &self.pool
    }

    async fn migrate(&self) -> Result<(), RiskCustodyError> {
        let mut transaction = self.pool.begin().await.map_err(relations)?;

        // A relation created by the writer role is owned by the writer role, and admission
        // requires the Owner role to own it. An earlier revision of this custody omitted this and
        // left a wrongly-owned relation on the ordered chain's shared database, which never
        // resets: every later run then failed identically at admission, on this Owner's entry,
        // with nothing pointing at the run that caused it.
        //
        // So the ownership is repaired first, as the writer, which may do it because it is the
        // relation's current owner and a member of the Owner role. Only then does the session
        // assume the Owner role, so a relation created here lands owned correctly the first time.
        sqlx::query(
            "DO $repair$ BEGIN \
               IF EXISTS (SELECT 1 \
                            FROM pg_catalog.pg_class relation \
                            JOIN pg_catalog.pg_namespace namespace \
                              ON namespace.oid = relation.relnamespace \
                           WHERE namespace.nspname = 'risk_private' \
                             AND relation.relname = 'risk_capacity_observations_v1' \
                             AND relation.relowner \
                                 <> pg_catalog.to_regrole('risk_owner')::oid) \
               THEN ALTER TABLE risk_private.risk_capacity_observations_v1 OWNER TO risk_owner; \
               END IF; END $repair$",
        )
        .execute(&mut *transaction)
        .await
        .map_err(relations)?;
        sqlx::query("SET LOCAL ROLE risk_owner")
            .execute(&mut *transaction)
            .await
            .map_err(relations)?;

        for statement in [
            "CREATE TABLE IF NOT EXISTS risk_private.risk_capacity_observations_v1( \
                 observation_identity TEXT PRIMARY KEY, \
                 schema_version INTEGER NOT NULL CHECK (schema_version > 0), \
                 capacity_scope_identity TEXT NOT NULL, \
                 account_namespace TEXT NOT NULL, \
                 economic_pool_identity TEXT NOT NULL, \
                 ceiling_dimension TEXT NOT NULL, \
                 ceiling_unit TEXT NOT NULL, \
                 gross_ceiling_scaled BIGINT NOT NULL CHECK (gross_ceiling_scaled >= 0), \
                 portfolio_proof_frontier_identity TEXT NOT NULL, \
                 account_fact_identity TEXT NOT NULL, \
                 account_fact_sequence BIGINT NOT NULL CHECK (account_fact_sequence >= 0), \
                 measured_at_epoch_ms BIGINT NOT NULL CHECK (measured_at_epoch_ms > 0), \
                 valid_through_epoch_ms BIGINT NOT NULL \
                   CHECK (valid_through_epoch_ms > measured_at_epoch_ms), \
                 observed_at_epoch_ms BIGINT NOT NULL CHECK (observed_at_epoch_ms > 0))",
        ] {
            sqlx::query(statement)
                .execute(&mut *transaction)
                .await
                .map_err(relations)?;
        }

        transaction.commit().await.map_err(relations)
    }

    /// Rereads Portfolio's `BOUND` Capacity Scope and current Capacity View, and seals what it saw.
    ///
    /// Both reads happen in one transaction, so the observation records one coherent cut rather
    /// than two reads that could straddle a Portfolio commit.
    ///
    /// # Errors
    ///
    /// Returns [`RiskCustodyError`] only when this Owner could not decide at all. Every business
    /// refusal is a [`CapacityObservation::Refused`] carrying its own named cause.
    pub async fn observe_capacity(
        &self,
        request_identity: &str,
    ) -> Result<CapacityObservation, RiskCustodyError> {
        let observed_at = self.clock.now_epoch_ms()?;
        let mut transaction = self.pool.begin().await.map_err(storage)?;

        let scope: Option<Value> =
            match sqlx::query_scalar("SELECT portfolio_api.read_bound_capacity_scope_v1($1)")
                .bind(request_identity)
                .fetch_one(&mut *transaction)
                .await
            {
                Ok(value) => value,
                Err(e) => {
                    // `42883` is undefined_function: Portfolio's read API is not deployed here.
                    // That is a different situation from a deployed API holding no such fact, and
                    // collapsing them would cost a caller the difference between "deploy the
                    // upstream Owner" and "wait for it to commit something".
                    let undeployed = e
                        .as_database_error()
                        .and_then(sqlx::error::DatabaseError::code)
                        .is_some_and(|code| code == "42883");
                    transaction.rollback().await.map_err(storage)?;
                    return Ok(CapacityObservation::Refused(if undeployed {
                        CapacityObservationRefusal::UpstreamCustodyNotDeployed
                    } else {
                        return Err(RiskCustodyError::ConnectionUnavailable);
                    }));
                }
            };

        let Some(scope) = scope else {
            transaction.rollback().await.map_err(storage)?;
            return Ok(CapacityObservation::Refused(
                CapacityObservationRefusal::FactUnavailable,
            ));
        };

        let Some((scope_identity, account_namespace, economic_pool_identity)) =
            scope_coordinates(&scope)
        else {
            transaction.rollback().await.map_err(storage)?;
            return Ok(CapacityObservation::Refused(
                CapacityObservationRefusal::ReadbackMalformed,
            ));
        };

        let view: Option<Value> =
            sqlx::query_scalar("SELECT portfolio_api.read_current_capacity_view_v1($1, $2)")
                .bind(&scope_identity)
                .bind(i64::try_from(observed_at).map_err(|_| RiskCustodyError::ClockUnavailable)?)
                .fetch_one(&mut *transaction)
                .await
                .map_err(storage)?;

        let Some(view) = view else {
            // The read function filters by the validity window, so a NULL here means either no
            // view at all or one that has fallen out of it. Portfolio answers the second question
            // directly, through its own API: this Owner must not read `portfolio_private`, and an
            // earlier revision of this branch did exactly that. It could only ever have refused
            // under one name, because `risk_writer` holds no `USAGE` on that schema and the
            // failure was being read as "found nothing".
            let expired: bool =
                sqlx::query_scalar("SELECT portfolio_api.capacity_view_expired_at_v1($1, $2)")
                    .bind(&scope_identity)
                    .bind(
                        i64::try_from(observed_at)
                            .map_err(|_| RiskCustodyError::ClockUnavailable)?,
                    )
                    .fetch_one(&mut *transaction)
                    .await
                    .map_err(storage)?;

            transaction.rollback().await.map_err(storage)?;

            return Ok(CapacityObservation::Refused(if expired {
                CapacityObservationRefusal::FactExpired
            } else {
                CapacityObservationRefusal::FactUnavailable
            }));
        };

        let Some(observed) = seal(
            &view,
            scope_identity,
            account_namespace,
            economic_pool_identity,
        ) else {
            transaction.rollback().await.map_err(storage)?;
            return Ok(CapacityObservation::Refused(
                CapacityObservationRefusal::ReadbackMalformed,
            ));
        };

        let inserted = sqlx::query(
            "INSERT INTO risk_private.risk_capacity_observations_v1(                  observation_identity, schema_version, capacity_scope_identity, account_namespace,                  economic_pool_identity, ceiling_dimension, ceiling_unit, gross_ceiling_scaled,                  portfolio_proof_frontier_identity, account_fact_identity, account_fact_sequence,                  measured_at_epoch_ms, valid_through_epoch_ms, observed_at_epoch_ms)              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)              ON CONFLICT (observation_identity) DO NOTHING",
        )
        .bind(&observed.observation_identity)
        .bind(i32::try_from(observed.schema_version).map_err(storage)?)
        .bind(&observed.capacity_scope_identity)
        .bind(&observed.account_namespace)
        .bind(&observed.economic_pool_identity)
        .bind(&observed.ceiling_dimension)
        .bind(&observed.ceiling_unit)
        .bind(i64::try_from(observed.gross_ceiling_scaled).map_err(storage)?)
        .bind(&observed.portfolio_proof_frontier_identity)
        .bind(&observed.account_fact_identity)
        .bind(i64::try_from(observed.account_fact_sequence).map_err(storage)?)
        .bind(i64::try_from(observed.measured_at_epoch_ms).map_err(storage)?)
        .bind(i64::try_from(observed.valid_through_epoch_ms).map_err(storage)?)
        .bind(i64::try_from(observed_at).map_err(storage)?)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?
        .rows_affected();

        transaction.commit().await.map_err(storage)?;
        Ok(if inserted == 1 {
            CapacityObservation::Sealed(Box::new(observed))
        } else {
            CapacityObservation::Replayed(Box::new(observed))
        })
    }

    async fn verify_admission(&self) -> Result<(), RiskCustodyError> {
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
        .bind(RISK_WRITER_ROLE)
        .bind(RISK_OWNER_ROLE)
        .bind(RISK_PRIVATE_SCHEMA)
        .bind(i64::try_from(OWNED_TABLES.len()).map_err(|_| RiskCustodyError::NotAdmitted)?)
        .bind(OWNED_TABLES.to_vec())
        .fetch_one(&self.pool)
        .await
        .map_err(admission)?;

        if !admitted {
            return Err(RiskCustodyError::NotAdmitted);
        }
        Ok(())
    }
}

fn storage<E>(_error: E) -> RiskCustodyError {
    RiskCustodyError::ConnectionUnavailable
}

fn relations<E>(_error: E) -> RiskCustodyError {
    RiskCustodyError::RelationsUnavailable
}

fn admission<E>(_error: E) -> RiskCustodyError {
    RiskCustodyError::NotAdmitted
}

fn observation_identity(observation: &SealedCapacityObservationV1) -> String {
    let mut hasher = Sha256::new();
    hasher.update(OBSERVATION_IDENTITY_DOMAIN);
    // Deliberately excludes every observation-time coordinate. Two observations of the same
    // evidence cut are the same fact, so the second must join the first rather than append a row.
    for field in [
        observation.capacity_scope_identity.as_str(),
        observation.account_namespace.as_str(),
        observation.economic_pool_identity.as_str(),
        observation.ceiling_dimension.as_str(),
        observation.ceiling_unit.as_str(),
        observation.portfolio_proof_frontier_identity.as_str(),
        observation.account_fact_identity.as_str(),
    ] {
        hasher.update(u32::try_from(field.len()).unwrap_or(u32::MAX).to_be_bytes());
        hasher.update(field.as_bytes());
    }
    hasher.update(observation.gross_ceiling_scaled.to_be_bytes());
    hasher.update(observation.account_fact_sequence.to_be_bytes());
    hasher.update(observation.measured_at_epoch_ms.to_be_bytes());
    hasher.update(observation.valid_through_epoch_ms.to_be_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(str::to_owned)
}

fn scope_coordinates(scope: &Value) -> Option<(String, String, String)> {
    Some((
        text(scope, "capacity_scope_identity")?,
        text(scope, "account_namespace")?,
        text(scope, "economic_pool_identity")?,
    ))
}

fn seal(
    view: &Value,
    capacity_scope_identity: String,
    account_namespace: String,
    economic_pool_identity: String,
) -> Option<SealedCapacityObservationV1> {
    let ceiling = view.get("gross_ceilings")?.as_array()?.first()?;
    let cut = view.get("account_fact_cut")?;
    let mut observation = SealedCapacityObservationV1 {
        schema_version: RISK_CAPACITY_OBSERVATION_SCHEMA_V1,
        observation_identity: String::new(),
        capacity_scope_identity,
        account_namespace,
        economic_pool_identity,
        ceiling_dimension: text(ceiling, "dimension")?,
        ceiling_unit: text(ceiling, "unit")?,
        gross_ceiling_scaled: ceiling.get("scaled_amount")?.as_u64()?,
        portfolio_proof_frontier_identity: text(view, "proof_frontier_identity")?,
        account_fact_identity: text(cut, "fact_identity")?,
        account_fact_sequence: cut.get("sequence")?.as_u64()?,
        measured_at_epoch_ms: view.get("measured_at_epoch_ms")?.as_u64()?,
        valid_through_epoch_ms: view.get("valid_through_epoch_ms")?.as_u64()?,
    };
    observation.observation_identity = observation_identity(&observation);
    Some(observation)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn observation_identity_excludes_observation_time() {
        // The identity is derived from observed content alone, so two observations of the same
        // evidence cut are the same fact. Encoding the observation moment into it would declare
        // that content never repeats, which is how an append-only table grows a row per poll.
        let observation = SealedCapacityObservationV1 {
            schema_version: RISK_CAPACITY_OBSERVATION_SCHEMA_V1,
            observation_identity: String::new(),
            capacity_scope_identity: "paper-scope-alpha".into(),
            account_namespace: "paper/alpha".into(),
            economic_pool_identity: "pool-alpha".into(),
            ceiling_dimension: "GROSS_NOTIONAL".into(),
            ceiling_unit: "USD".into(),
            gross_ceiling_scaled: 5_000,
            portfolio_proof_frontier_identity: "frontier-1".into(),
            account_fact_identity: "fact-1".into(),
            account_fact_sequence: 1,
            measured_at_epoch_ms: 1_000,
            valid_through_epoch_ms: 2_000,
        };
        let first = observation_identity(&observation);
        let second = observation_identity(&observation);
        assert_eq!(first, second);

        let mut moved = observation;
        moved.gross_ceiling_scaled = 5_001;
        assert_ne!(observation_identity(&moved), first);
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
        paper_account_opening::{PAPER_ACCOUNT_OPENING_SCHEMA_VERSION, PaperAccountOpeningDraft},
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

    impl RiskOwnerClock for FixtureClock {
        fn now_epoch_ms(&self) -> Result<u64, RiskCustodyError> {
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

    fn binding_draft(scope_identity: &str, now: u64) -> PaperAdapterBindingDraft {
        let mode = PaperMode::Paper;
        PaperAdapterBindingDraft {
            schema_version: 1,
            binding_version: 1,
            generation: 1,
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
            request_identity: format!("capacity-request-{marker}"),
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

    /// Exact row counts of every relation in a schema, dropping empties so a clean database and
    /// the chain's shared one compare equal.
    ///
    /// Hand-picked counters cannot see three things a whole-schema snapshot can: a table the
    /// cleanup forgot entirely, rows deleted that belonged to someone else, and a global
    /// singleton displaced rather than appended to.
    async fn schema_snapshot(pool: &PgPool, schema: &str) -> Vec<String> {
        sqlx::query_scalar(
            "SELECT relation.relname || '=' || \
                    (pg_catalog.xpath('/row/c/text()', \
                       pg_catalog.query_to_xml( \
                         pg_catalog.format('SELECT count(*) AS c FROM %I.%I', \
                                           namespace.nspname, relation.relname), \
                         false, true, '')))[1]::text \
               FROM pg_catalog.pg_class relation \
               JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace \
              WHERE namespace.nspname = $1 AND relation.relkind = 'r' \
              ORDER BY relation.relname",
        )
        .bind(schema)
        .fetch_all(pool)
        .await
        .unwrap()
        .into_iter()
        .filter(|row: &String| !row.ends_with("=0"))
        .collect()
    }

    async fn registry_head(portfolio: &PgPool) -> Option<(String, String, i64)> {
        sqlx::query_as(
            "SELECT head_identity, proof_frontier_identity, proof_frontier_sequence \
               FROM portfolio_private.portfolio_capacity_scope_registry_heads_v1",
        )
        .fetch_optional(portfolio)
        .await
        .unwrap()
    }

    async fn restore_registry_head(portfolio: &PgPool, head: Option<(String, String, i64)>) {
        let Some((head_identity, frontier, sequence)) = head else {
            return;
        };
        sqlx::query(
            "INSERT INTO portfolio_private.portfolio_capacity_scope_registry_heads_v1( \
                 head_identity, proof_frontier_identity, proof_frontier_sequence) \
             VALUES ($1, $2, $3) \
             ON CONFLICT (head_identity) DO UPDATE \
                SET proof_frontier_identity = EXCLUDED.proof_frontier_identity, \
                    proof_frontier_sequence = EXCLUDED.proof_frontier_sequence",
        )
        .bind(head_identity)
        .bind(frontier)
        .bind(sequence)
        .execute(portfolio)
        .await
        .unwrap();
    }

    #[tokio::test]
    #[ignore = "requires the canonical Owner PostgreSQL test topology"]
    async fn postgres_capacity_observation_seals_only_what_portfolio_currently_publishes() {
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = test_database.mutation();
        let suffix = suffix();
        let risk_pool = mutation.pool(CanonicalOwnerTestRoleV1::RiskWriter);
        let portfolio_pool = mutation.pool(CanonicalOwnerTestRoleV1::PortfolioWriter);
        let execution_pool = mutation.pool(CanonicalOwnerTestRoleV1::ExecutionWriter);
        // Taken before any custody connects, so it holds nothing this proof is about to write.
        let baseline = (
            schema_snapshot(risk_pool, "risk_private").await,
            schema_snapshot(portfolio_pool, "portfolio_private").await,
            schema_snapshot(execution_pool, "execution_private").await,
        );
        // The registry head is one row for the whole database. Committing a cut moves it rather
        // than appending, so it is captured before anything commits and put back at cleanup.
        let displaced_head = registry_head(portfolio_pool).await;

        let clock = FixtureClock::new(1_000_000);
        let scope_identity = format!("paper-scope-{suffix}");
        let account_namespace =
            derive_paper_account_namespace(PaperMode::Paper, &scope_identity).unwrap();

        // Execution commits its own binding and opening collateral fact, through its own custody.
        let execution = PaperAdapterBindingPostgresV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::ExecutionWriter),
            format!("execution-node-{suffix}"),
            clock.clone(),
        )
        .await
        .unwrap();
        let binding = execution
            .commit(binding_draft(&scope_identity, clock.get()))
            .await
            .unwrap();
        execution
            .commit_account_opening_fact(PaperAccountOpeningDraft {
                schema_version: PAPER_ACCOUNT_OPENING_SCHEMA_VERSION,
                binding_locator: binding.locator.clone(),
                collateral_currency: "USDT".to_string(),
                collateral_amount: "100000.5".to_string(),
                observed_at_epoch_ms: clock.get(),
                clock_epoch: 7,
            })
            .await
            .unwrap();

        // Portfolio binds the scope and projects the view, through its own custody.
        let portfolio = CapacityScopePostgresV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::PortfolioWriter),
            clock.clone(),
        )
        .await
        .unwrap();
        let definition = CapacityScopeDefinitionProposal {
            account_namespace: account_namespace.clone(),
            mode: CapacityScopeMode::Paper,
            economic_pool_identity: format!("pool-{suffix}"),
            economic_pool_currency: "USDT".to_string(),
            source_binding_identity: format!("source-binding-{suffix}"),
            adapter_binding_identity: binding.locator.fact_identity.clone(),
            shared_constraint_identities: vec![format!("constraint-{suffix}")],
        };
        let cut = portfolio
            .commit_registry_cut(vec![definition.clone()], clock.get() + 200_000)
            .await
            .unwrap();
        let bound = bind_capacity_scope(&portfolio, &definition, &cut, clock.get(), &suffix).await;
        let view = portfolio
            .commit_capacity_view(&bound, clock.get() + 50_000)
            .await
            .unwrap()
            .unwrap();

        let risk = RiskCapacityReadPortPostgresV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::RiskWriter),
            clock.clone(),
        )
        .await
        .unwrap();
        let pool = risk.pool().clone();
        let request_identity = bound.fingerprint().request_identity().to_string();
        assert_eq!(own_count(&pool, bound.capacity_scope_identity()).await, 0);

        // The positive path: one observation, sealed from what Portfolio currently publishes.
        let CapacityObservation::Sealed(sealed) =
            risk.observe_capacity(&request_identity).await.unwrap()
        else {
            panic!("Portfolio publishes a current view, so this must seal");
        };
        assert_eq!(
            sealed.capacity_scope_identity,
            bound.capacity_scope_identity()
        );
        assert_eq!(sealed.account_namespace, account_namespace);
        assert_eq!(
            sealed.portfolio_proof_frontier_identity,
            view.proof_frontier_identity()
        );
        assert_eq!(
            sealed.account_fact_identity,
            view.account_fact_cut().fact_identity
        );
        assert_eq!(sealed.valid_through_epoch_ms, clock.get() + 50_000);
        assert_eq!(own_count(&pool, bound.capacity_scope_identity()).await, 1);

        // Observing the same evidence cut again joins the first row rather than appending one,
        // because the identity is derived from observed content and never from observation time.
        let CapacityObservation::Replayed(replayed) =
            risk.observe_capacity(&request_identity).await.unwrap()
        else {
            panic!("a second observation of one evidence cut is the same fact");
        };
        assert_eq!(replayed.observation_identity, sealed.observation_identity);
        assert_eq!(own_count(&pool, bound.capacity_scope_identity()).await, 1);

        // Each refusal names its own cause. A single `Unavailable` could not tell a caller
        // whether the fact is missing, expired, or shaped in a way this Owner cannot read.
        assert_eq!(
            risk.observe_capacity(&format!("absent-request-{suffix}"))
                .await
                .unwrap(),
            CapacityObservation::Refused(CapacityObservationRefusal::FactUnavailable)
        );

        // Past the view's validity the fact is present but no longer current. Portfolio's read
        // function returns NULL for both that and "no view at all", so this Owner asks a second
        // question to tell them apart rather than refusing under one name.
        clock.set(1_000_000 + 60_000);
        assert_eq!(
            risk.observe_capacity(&request_identity).await.unwrap(),
            CapacityObservation::Refused(CapacityObservationRefusal::FactExpired)
        );
        clock.set(1_000_000);

        // A readback this Owner cannot interpret refuses under its own name and writes nothing.
        // The tamper is restored immediately: the chain database is shared and never reset.
        let original: serde_json::Value = sqlx::query_scalar(
            "SELECT view_json FROM portfolio_private.portfolio_capacity_views_v1 \
              WHERE capacity_scope_identity = $1",
        )
        .bind(bound.capacity_scope_identity())
        .fetch_one(portfolio_pool)
        .await
        .unwrap();
        sqlx::query(
            "UPDATE portfolio_private.portfolio_capacity_views_v1 \
                SET view_json = view_json - 'gross_ceilings' \
              WHERE capacity_scope_identity = $1",
        )
        .bind(bound.capacity_scope_identity())
        .execute(portfolio_pool)
        .await
        .unwrap();
        assert_eq!(
            risk.observe_capacity(&request_identity).await.unwrap(),
            CapacityObservation::Refused(CapacityObservationRefusal::ReadbackMalformed)
        );
        assert_eq!(own_count(&pool, bound.capacity_scope_identity()).await, 1);
        sqlx::query(
            "UPDATE portfolio_private.portfolio_capacity_views_v1 SET view_json = $2 \
              WHERE capacity_scope_identity = $1",
        )
        .bind(bound.capacity_scope_identity())
        .bind(&original)
        .execute(portfolio_pool)
        .await
        .unwrap();

        // `UpstreamCustodyNotDeployed` is deliberately not asserted here. It needs a database
        // where `portfolio_api` does not exist, and on the ordered chain's shared database
        // Portfolio's custody is already materialised before this entry runs. Driving it would
        // mean dropping another Owner's schema, which is destroying state this proof does not own.

        cleanup(
            &pool,
            portfolio_pool,
            execution_pool,
            &suffix,
            bound.capacity_scope_identity(),
        )
        .await;
        restore_registry_head(portfolio_pool, displaced_head).await;
        assert_eq!(
            (
                schema_snapshot(risk_pool, "risk_private").await,
                schema_snapshot(portfolio_pool, "portfolio_private").await,
                schema_snapshot(execution_pool, "execution_private").await,
            ),
            baseline,
            "every schema must hold exactly what it held before this proof ran"
        );
    }

    /// Removes every row this proof caused, from the schemas of all three Owners it touched.
    ///
    /// The identity columns are content-derived, so none of them contains `marker`: an earlier
    /// revision matched on `capacity_scope_identity LIKE '%marker%'` and deleted nothing at all.
    /// Portfolio's rows are reached the way Portfolio's own proof reaches them, through the two
    /// columns that do carry a caller-supplied string - `request_identity` on the readback and the
    /// marker inside `registry_json` - and everything else is joined to those. This Owner's own
    /// row is deleted by the exact scope identity the observation sealed, which the caller holds.
    async fn cleanup(
        risk: &PgPool,
        portfolio: &PgPool,
        execution: &PgPool,
        marker: &str,
        scope_identity: &str,
    ) {
        sqlx::query(
            "DELETE FROM risk_private.risk_capacity_observations_v1 \
              WHERE capacity_scope_identity = $1",
        )
        .bind(scope_identity)
        .execute(risk)
        .await
        .unwrap();

        let like = format!("%{marker}%");

        for statement in [
            "DELETE FROM portfolio_private.portfolio_owner_outbox_v1 outbox \
              WHERE EXISTS (SELECT 1 \
                              FROM portfolio_private.portfolio_capacity_scope_registry_cuts_v1 cut \
                             WHERE cut.proof_frontier_identity = outbox.event_identity \
                               AND cut.registry_json::text LIKE $1)",
            "DELETE FROM portfolio_private.portfolio_capacity_views_v1 view_record \
              WHERE EXISTS (SELECT 1 \
                              FROM portfolio_private.portfolio_capacity_scope_bound_readbacks_v1 readback \
                             WHERE readback.capacity_scope_identity = view_record.capacity_scope_identity \
                               AND readback.request_identity LIKE $1)",
            "DELETE FROM portfolio_private.portfolio_capacity_scope_bound_readbacks_v1 \
              WHERE request_identity LIKE $1",
            "DELETE FROM portfolio_private.portfolio_capacity_scope_registry_heads_v1 head \
              WHERE EXISTS (SELECT 1 \
                              FROM portfolio_private.portfolio_capacity_scope_registry_cuts_v1 cut \
                             WHERE cut.proof_frontier_identity = head.proof_frontier_identity \
                               AND cut.registry_json::text LIKE $1)",
            "DELETE FROM portfolio_private.portfolio_capacity_scope_registry_cuts_v1 \
              WHERE registry_json::text LIKE $1",
        ] {
            sqlx::query(statement)
                .bind(&like)
                .execute(portfolio)
                .await
                .unwrap();
        }
        let stream = format!("execution.paper-adapter-binding.execution-node-{marker}");

        for statement in [
            "DELETE FROM execution_private.execution_paper_adapter_binding_outbox_v1 \
              WHERE stream_identity = $1",
            "DELETE FROM execution_private.execution_paper_account_opening_facts_v1 \
              WHERE stream_identity = $1",
            "DELETE FROM execution_private.execution_paper_adapter_binding_heads_v1 head \
              WHERE EXISTS (SELECT 1 \
                              FROM execution_private.execution_paper_adapter_binding_facts_v1 fact \
                             WHERE fact.fact_identity = head.fact_identity \
                               AND fact.stream_identity = $1)",
            "DELETE FROM execution_private.execution_paper_namespace_reservations_v1 reservation \
              WHERE EXISTS (SELECT 1 \
                              FROM execution_private.execution_paper_adapter_binding_facts_v1 fact \
                             WHERE fact.stream_identity = $1 \
                               AND fact.execution_scope_identity \
                                   = reservation.execution_scope_identity)",
            "DELETE FROM execution_private.execution_paper_adapter_binding_facts_v1 \
              WHERE stream_identity = $1",
            "DELETE FROM execution_private.execution_paper_adapter_binding_streams_v1 \
              WHERE stream_identity = $1",
        ] {
            sqlx::query(statement)
                .bind(&stream)
                .execute(execution)
                .await
                .unwrap();
        }
    }

    async fn own_count(pool: &PgPool, scope_identity: &str) -> i64 {
        sqlx::query_scalar(
            "SELECT count(*) FROM risk_private.risk_capacity_observations_v1 \
              WHERE capacity_scope_identity = $1",
        )
        .bind(scope_identity)
        .fetch_one(pool)
        .await
        .unwrap()
    }
}
