//! Fail-closed admission for destructive PostgreSQL integration tests.

use std::{
    env,
    fmt::{Debug, Display},
    time::{SystemTime, UNIX_EPOCH},
};

use sqlx::{
    PgPool,
    postgres::{PgConnectOptions, PgPoolOptions},
};
use url::Url;

const EXPECTED_DATABASE_ENV: &str = "VIBE_POSTGRES_TEST_DATABASE_NAME";
const EXPECTED_MARKER_ENV: &str = "VIBE_POSTGRES_TEST_INSTANCE_MARKER";
const LEGACY_REPLAY_FAULT_URL_ENV: &str = "VIBE_TEST_LEGACY_REPLAY_FAULT_DATABASE_URL";
const LEGACY_MIGRATION_URL_ENV: &str = "VIBE_TEST_LEGACY_MIGRATION_DATABASE_URL";
const LEGACY_MIGRATION_LEASE_IDENTITY_ENV: &str = "VIBE_TEST_LEGACY_MIGRATION_LEASE_IDENTITY";
const LEGACY_REPLAY_DUPLICATE_FUNCTION_SOURCE_SHA256_V1: &str =
    "4d055aabd875b2181a4845b6021543319911dbe97c13db739c8efa6b16856346";
const REPLAY_POLICY_CATALOG_FAULT_ACQUIRE_FUNCTION_SOURCE_SHA256_V1: &str =
    "6d6fa280093609a63a6efd14e95f394f92e36400c74409c4c33ccffdcf58a601";
const REPLAY_POLICY_CATALOG_FAULT_RELEASE_FUNCTION_SOURCE_SHA256_V1: &str =
    "dc63b386e8797231a8a25111416c1efd424061ead05c2e652ba3c39aa015977a";
const REPLAY_POLICY_CATALOG_FAULT_INJECT_MEMBERSHIP_FUNCTION_SOURCE_SHA256_V1: &str =
    "029f93c5e3f7161af85001b543515f73e29510288e0fe9bcfa93a8d01f900836";
const REPLAY_POLICY_CATALOG_FAULT_RESTORE_MEMBERSHIP_FUNCTION_SOURCE_SHA256_V1: &str =
    "8e7faf8d1a3cb98540b5f2eba0cb040ca560ec04b22b4494bd48ba2bf21cdb43";
const LEGACY_MIGRATION_ACQUIRE_FUNCTION_SOURCE_SHA256_V1: &str =
    "9a7a55a346a76d96073594d7da723a6bdb6b92b767fef86908d74a541bce1509";
const LEGACY_MIGRATION_RELEASE_FUNCTION_SOURCE_SHA256_V1: &str =
    "996cd305d65a193127680e8f37d8622684093eb189fca04772b3fafbf052df2f";
const PRODUCTION_DATABASE_URL_ENVS: [&str; 6] = [
    "RD_OWNER_DATABASE_URL",
    "RD_FACT_WRITER_DATABASE_URL",
    "WINDMILL_DATABASE_URL",
    "PRODUCT_EDGE_DATABASE_URL",
    "OPERATOR_AUTHORIZATION_DATABASE_URL",
    "BACKTEST_DATABASE_URL",
];
const DEFAULT_DATABASE_NAMES: [&str; 7] = [
    "postgres",
    "template0",
    "template1",
    "windmill",
    "trade",
    "rd_owner",
    "product_edge",
];
const CANONICAL_OWNER_TEST_URLS: [(&str, &str); 6] = [
    (
        "OPERATOR_AUTHORIZATION_TEST_DATABASE_URL",
        "operator_authorization_writer",
    ),
    ("PRODUCT_EDGE_TEST_DATABASE_URL", "product_edge_owner"),
    ("RD_OWNER_TEST_DATABASE_URL", "rd_owner"),
    ("RD_FACT_WRITER_TEST_DATABASE_URL", "rd_fact_writer"),
    ("QUALIFICATION_TEST_DATABASE_URL", "qualification_writer"),
    ("BACKTEST_TEST_DATABASE_URL", "backtest_owner"),
];

/// A stable, credential-redacting failure from dedicated test-database admission.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DedicatedPostgresTestDatabaseError {
    /// A required environment variable was absent.
    MissingEnvironment(&'static str),
    /// A caller supplied a non-test URL environment variable.
    NonTestUrlEnvironment,
    /// A URL could not be parsed without ambiguity.
    InvalidDatabaseUrl(&'static str),
    /// The URL targets a known application/default database.
    DefaultDatabaseForbidden,
    /// The test URL resolves to the same database as a production URL.
    ProductionDatabaseForbidden(&'static str),
    /// The URL user or database does not equal the admin-provisioned expectation.
    ExpectedIdentityMismatch,
    /// Cross-owner URLs do not resolve to one physical database.
    CrossOwnerDatabaseMismatch,
    /// The read-only admission connection failed.
    ReadOnlyPreflightUnavailable,
    /// The Catalog topology-administrator authority query could not execute.
    CatalogAdminAuthorityQueryUnavailable,
    /// The immutable admin marker was absent or did not match.
    MarkerMismatch,
    /// The connected role could create or mutate the marker.
    MarkerNotImmutable,
}

impl Display for DedicatedPostgresTestDatabaseError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingEnvironment(name) => write!(formatter, "missing required {name}"),
            Self::NonTestUrlEnvironment => {
                formatter.write_str("only explicit *_TEST_DATABASE_URL is accepted")
            }
            Self::InvalidDatabaseUrl(name) => write!(formatter, "invalid database URL in {name}"),
            Self::DefaultDatabaseForbidden => {
                formatter.write_str("known application/default database is forbidden")
            }
            Self::ProductionDatabaseForbidden(name) => {
                write!(
                    formatter,
                    "test database aliases production target from {name}"
                )
            }
            Self::ExpectedIdentityMismatch => {
                formatter.write_str("test database or role does not match provisioned identity")
            }
            Self::CrossOwnerDatabaseMismatch => {
                formatter.write_str("cross-owner test URLs do not identify one database")
            }
            Self::ReadOnlyPreflightUnavailable => {
                formatter.write_str("dedicated database read-only preflight unavailable")
            }
            Self::CatalogAdminAuthorityQueryUnavailable => {
                formatter.write_str("catalog administrator authority query unavailable")
            }
            Self::MarkerMismatch => formatter.write_str("dedicated database marker mismatch"),
            Self::MarkerNotImmutable => {
                formatter.write_str("dedicated database marker is mutable by test role")
            }
        }
    }
}

impl std::error::Error for DedicatedPostgresTestDatabaseError {}

#[derive(Clone, Debug, Eq, PartialEq)]
struct NormalizedDatabaseTarget {
    host: String,
    port: u16,
    database: String,
    role: String,
}

impl NormalizedDatabaseTarget {
    fn same_database(&self, other: &Self) -> bool {
        self.host == other.host && self.port == other.port && self.database == other.database
    }
}

#[derive(Debug)]
struct ExpectedMarker<'a> {
    database: &'a str,
    role: &'a str,
    identity: &'a str,
}

#[derive(Debug)]
struct ObservedMarker<'a> {
    database: &'a str,
    role: &'a str,
    identity: &'a str,
    owner: &'a str,
    unsafe_role_capabilities: [bool; 7],
}

/// Proof that an explicit URL resolves to an admin-marked disposable PostgreSQL database.
///
/// The URL is intentionally private and redacted from `Debug`. Destructive helpers must obtain a
/// [`DedicatedPostgresTestMutation`] from this admitted value before accessing its pool.
pub struct DedicatedPostgresTestDatabase {
    database_url: String,
    target: NormalizedDatabaseTarget,
    marker_identity: String,
    pool: PgPool,
}

/// Canonical non-privileged roles in the disposable OA/PE/R&D/Qualification/Backtest topology.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CanonicalOwnerTestRoleV1 {
    OperatorAuthorizationWriter,
    ProductEdgeOwner,
    RdOwner,
    RdFactWriter,
    QualificationWriter,
    BacktestOwner,
}

impl CanonicalOwnerTestRoleV1 {
    fn index(self) -> usize {
        match self {
            Self::OperatorAuthorizationWriter => 0,
            Self::ProductEdgeOwner => 1,
            Self::RdOwner => 2,
            Self::RdFactWriter => 3,
            Self::QualificationWriter => 4,
            Self::BacktestOwner => 5,
        }
    }
}

/// Proof that all canonical Owner roles resolve to one immutable, disposable database.
pub struct CanonicalOwnerPostgresTestDatabaseV1 {
    database_urls: [String; 6],
    pools: [PgPool; 6],
    marker_identity: String,
    owner_topology_admin_pool: PgPool,
    legacy_migration_caller_options: PgConnectOptions,
    legacy_migration_caller_target: NormalizedDatabaseTarget,
}

/// One-shot capability for the disposable legacy Replay duplicate fault.
pub struct LegacyReplayDuplicateFaultV1 {
    pool: PgPool,
    marker_identity: String,
}

/// Proof that the one-shot legacy Replay duplicate fault was consumed.
pub struct UsedLegacyReplayDuplicateFaultV1 {
    pool: PgPool,
    marker_identity: String,
}

/// Linear lease of the disposable Replay Policy Catalog fault authority.
pub struct ReplayPolicyCatalogFaultAuthorityV1 {
    pool: PgPool,
    marker_identity: String,
    lease_identity: String,
}

/// Proof that the Replay Policy Catalog fault authority returned to READY.
pub struct ReleasedReplayPolicyCatalogFaultAuthorityV1 {
    _marker_identity: String,
    _lease_identity: String,
}

/// Linear test-only authority for one legacy Replay migration continuity consumer.
pub struct LegacyReplayMigrationAuthorityV1 {
    pool: PgPool,
    database_identity: String,
    marker_identity: String,
    lease_identity: String,
}

/// Proof that the legacy Replay migration authority returned to READY.
pub struct ReleasedLegacyReplayMigrationAuthorityV1 {
    pool: PgPool,
    marker_identity: String,
    lease_identity: String,
}

/// A failed legacy migration lease transition retaining the recovery capability.
pub struct LegacyReplayMigrationTransitionErrorV1<T> {
    capability: T,
    source: sqlx::Error,
}

/// Proof of the exact injected third-party Catalog owner edge.
pub struct InjectedReplayPolicyCatalogThirdPartyOwnerEdgeV1 {
    pool: PgPool,
    marker_identity: String,
    lease_identity: String,
}

/// A failed lease transition that retains the capability needed for recovery.
pub struct ReplayPolicyCatalogFaultTransitionErrorV1<T> {
    capability: T,
    source: sqlx::Error,
}

impl Debug for LegacyReplayDuplicateFaultV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(LegacyReplayDuplicateFaultV1))
            .field("marker_identity", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

impl Debug for UsedLegacyReplayDuplicateFaultV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(UsedLegacyReplayDuplicateFaultV1))
            .field("marker_identity", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

impl Debug for ReplayPolicyCatalogFaultAuthorityV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(ReplayPolicyCatalogFaultAuthorityV1))
            .field("marker_identity", &"[REDACTED]")
            .field("lease_identity", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

impl Debug for ReleasedReplayPolicyCatalogFaultAuthorityV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(ReleasedReplayPolicyCatalogFaultAuthorityV1))
            .field("marker_identity", &"[REDACTED]")
            .field("lease_identity", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

impl Debug for LegacyReplayMigrationAuthorityV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(LegacyReplayMigrationAuthorityV1))
            .field("marker_identity", &"[REDACTED]")
            .field("lease_identity", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

impl Debug for ReleasedLegacyReplayMigrationAuthorityV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(ReleasedLegacyReplayMigrationAuthorityV1))
            .field("marker_identity", &"[REDACTED]")
            .field("lease_identity", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

impl<T> Debug for LegacyReplayMigrationTransitionErrorV1<T> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(LegacyReplayMigrationTransitionErrorV1))
            .field("source", &self.source)
            .finish_non_exhaustive()
    }
}

impl<T> LegacyReplayMigrationTransitionErrorV1<T> {
    /// Returns the retained linear capability for an explicit recovery attempt.
    #[must_use]
    pub fn into_capability(self) -> T {
        self.capability
    }

    /// Returns the fail-closed PostgreSQL transition error.
    #[must_use]
    pub fn source(&self) -> &sqlx::Error {
        &self.source
    }
}

impl Debug for InjectedReplayPolicyCatalogThirdPartyOwnerEdgeV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(InjectedReplayPolicyCatalogThirdPartyOwnerEdgeV1))
            .field("marker_identity", &"[REDACTED]")
            .field("lease_identity", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

impl<T> Debug for ReplayPolicyCatalogFaultTransitionErrorV1<T> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(ReplayPolicyCatalogFaultTransitionErrorV1))
            .field("source", &self.source)
            .finish_non_exhaustive()
    }
}

impl<T> ReplayPolicyCatalogFaultTransitionErrorV1<T> {
    /// Returns the retained linear capability for an explicit recovery attempt.
    #[must_use]
    pub fn into_capability(self) -> T {
        self.capability
    }

    /// Returns the fail-closed PostgreSQL transition error.
    #[must_use]
    pub fn source(&self) -> &sqlx::Error {
        &self.source
    }
}

impl Debug for CanonicalOwnerPostgresTestDatabaseV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(CanonicalOwnerPostgresTestDatabaseV1))
            .field("marker_identity", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

impl CanonicalOwnerPostgresTestDatabaseV1 {
    /// Admits the fixed OA writer, PE Owner, R&D Owner, Qualification writer and Backtest role map.
    ///
    /// This is separate from [`DedicatedPostgresTestDatabase`]: it does not relax that
    /// guard's `vibe_test_role_*` identity requirement.
    ///
    /// # Errors
    ///
    /// Returns an error when the fixed role URLs do not identify the same guarded disposable
    /// database, the marker cannot be verified, or any role has privileged capabilities.
    pub async fn admit() -> Result<Self, DedicatedPostgresTestDatabaseError> {
        let expected_database = env::var(EXPECTED_DATABASE_ENV).map_err(|_| {
            DedicatedPostgresTestDatabaseError::MissingEnvironment(EXPECTED_DATABASE_ENV)
        })?;
        let expected_marker = env::var(EXPECTED_MARKER_ENV).map_err(|_| {
            DedicatedPostgresTestDatabaseError::MissingEnvironment(EXPECTED_MARKER_ENV)
        })?;

        if !expected_database.starts_with("vibe_test_") || expected_marker.is_empty() {
            return Err(DedicatedPostgresTestDatabaseError::ExpectedIdentityMismatch);
        }

        let mut urls = Vec::with_capacity(CANONICAL_OWNER_TEST_URLS.len());
        let mut targets = Vec::with_capacity(CANONICAL_OWNER_TEST_URLS.len());
        for (name, role) in CANONICAL_OWNER_TEST_URLS {
            let value = env::var(name)
                .map_err(|_| DedicatedPostgresTestDatabaseError::MissingEnvironment(name))?;
            let target = normalize_url(name, &value)?;
            if target.database != expected_database || target.role != role {
                return Err(DedicatedPostgresTestDatabaseError::ExpectedIdentityMismatch);
            }
            urls.push(value);
            targets.push(target);
        }
        let first = targets
            .first()
            .ok_or(DedicatedPostgresTestDatabaseError::NonTestUrlEnvironment)?;
        if targets.iter().any(|target| !target.same_database(first)) {
            return Err(DedicatedPostgresTestDatabaseError::CrossOwnerDatabaseMismatch);
        }

        for name in PRODUCTION_DATABASE_URL_ENVS {
            if let Ok(value) = env::var(name) {
                let production = normalize_url(name, &value)?;
                if first.same_database(&production) {
                    return Err(
                        DedicatedPostgresTestDatabaseError::ProductionDatabaseForbidden(name),
                    );
                }
            }
        }

        let mut pools = Vec::with_capacity(urls.len());

        for ((_, role), (url, target)) in CANONICAL_OWNER_TEST_URLS
            .iter()
            .zip(urls.iter().zip(&targets))
        {
            let pool = PgPoolOptions::new()
                .max_connections(8)
                .connect(url)
                .await
                .map_err(|_| DedicatedPostgresTestDatabaseError::ReadOnlyPreflightUnavailable)?;
            verify_marker_read_only(
                &pool,
                target,
                &ExpectedMarker {
                    database: &expected_database,
                    role,
                    identity: &expected_marker,
                },
            )
            .await?;
            pools.push(pool);
        }
        let owner_topology_admin_pool =
            admit_owner_topology_admin(&expected_database, &expected_marker, first).await?;
        let (legacy_migration_caller_options, legacy_migration_caller_target) =
            admit_legacy_migration_caller(&expected_database, first)?;

        Ok(Self {
            database_urls: urls
                .try_into()
                .map_err(|_| DedicatedPostgresTestDatabaseError::ExpectedIdentityMismatch)?,
            pools: pools
                .try_into()
                .map_err(|_| DedicatedPostgresTestDatabaseError::ExpectedIdentityMismatch)?,
            marker_identity: expected_marker,
            owner_topology_admin_pool,
            legacy_migration_caller_options,
            legacy_migration_caller_target,
        })
    }

    /// Returns the admitted canonical-role URL without logging its credentials.
    #[must_use]
    pub fn database_url(&self, role: CanonicalOwnerTestRoleV1) -> &str {
        &self.database_urls[role.index()]
    }

    /// Creates the destructive-test capability after all four role checks pass.
    #[must_use]
    pub fn mutation(&self) -> CanonicalOwnerPostgresTestMutationV1<'_> {
        CanonicalOwnerPostgresTestMutationV1 { database: self }
    }

    /// Returns the CI-only topology administrator used to inject private-owner faults.
    #[must_use]
    pub fn owner_topology_admin_pool(&self) -> &PgPool {
        &self.owner_topology_admin_pool
    }

    /// Admits the exact one-shot legacy Replay duplicate fixture.
    ///
    /// # Errors
    ///
    /// Returns an error when the fixture URL, database identity, role authority, or executable
    /// definition does not match the admitted canonical test topology.
    pub async fn admit_legacy_replay_duplicate_fault(
        &self,
    ) -> Result<LegacyReplayDuplicateFaultV1, DedicatedPostgresTestDatabaseError> {
        let canonical_target =
            normalize_url(CANONICAL_OWNER_TEST_URLS[0].0, &self.database_urls[0])?;
        admit_legacy_replay_duplicate_fault(&canonical_target, &self.marker_identity).await
    }

    /// Acquires the exact disposable Replay Policy Catalog fault authority.
    ///
    /// This capability is unavailable outside the fixture's isolated PostgreSQL container and
    /// sequential fail-fast shell loop; it is not a generally concurrency-safe test authority.
    ///
    /// # Errors
    ///
    /// Returns the transition error with the original recovery capability when the fixed-source
    /// lease transition fails closed.
    pub async fn acquire_replay_policy_catalog_fault_authority(
        &self,
    ) -> Result<
        ReplayPolicyCatalogFaultAuthorityV1,
        ReplayPolicyCatalogFaultTransitionErrorV1<ReplayPolicyCatalogFaultAuthorityV1>,
    > {
        let lease_identity = format!(
            "replay-policy-catalog-fault-v1:{}:{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |duration| duration.as_nanos())
        );
        let authority = ReplayPolicyCatalogFaultAuthorityV1 {
            pool: self.owner_topology_admin_pool.clone(),
            marker_identity: self.marker_identity.clone(),
            lease_identity,
        };

        if let Err(source) = authority.acquire_readback().await {
            return Err(ReplayPolicyCatalogFaultTransitionErrorV1 {
                capability: authority,
                source,
            });
        }
        Ok(authority)
    }

    /// Acquires the exact test-only legacy Replay migration lease after clean canonical admission.
    ///
    /// # Errors
    ///
    /// Returns a transition error retaining the non-clone capability when the fixed-source acquire
    /// or its exact readback fails closed.
    pub async fn acquire_legacy_replay_migration_authority(
        &self,
    ) -> Result<
        LegacyReplayMigrationAuthorityV1,
        LegacyReplayMigrationTransitionErrorV1<LegacyReplayMigrationAuthorityV1>,
    > {
        let lease_identity = env::var(LEGACY_MIGRATION_LEASE_IDENTITY_ENV).unwrap_or_default();
        let authority = LegacyReplayMigrationAuthorityV1 {
            pool: PgPoolOptions::new()
                .max_connections(1)
                .connect_lazy_with(self.legacy_migration_caller_options.clone()),
            database_identity: self.legacy_migration_caller_target.database.clone(),
            marker_identity: self.marker_identity.clone(),
            lease_identity,
        };

        if authority.lease_identity.is_empty() {
            return Err(LegacyReplayMigrationTransitionErrorV1 {
                capability: authority,
                source: sqlx::Error::Protocol(
                    "legacy Replay migration lease identity is unavailable".into(),
                ),
            });
        }

        if let Err(source) = authority.preflight_readback().await {
            return Err(LegacyReplayMigrationTransitionErrorV1 {
                capability: authority,
                source,
            });
        }

        if let Err(source) = authority.acquire_readback().await {
            return Err(LegacyReplayMigrationTransitionErrorV1 {
                capability: authority,
                source,
            });
        }
        Ok(authority)
    }
}

impl LegacyReplayMigrationAuthorityV1 {
    async fn preflight_readback(&self) -> Result<(), sqlx::Error> {
        // Keep this readback phase-invariant so an acquire that committed before response loss can
        // repeat it. The admitted acquire_v1 source then accepts only READY without either grant or
        // LEASED with this exact identity and both exact grants.
        let exact: bool = sqlx::query_scalar(
            "SELECT session_user='vibe_test_legacy_migration_caller'
           AND pg_catalog.current_database()=$1
           AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole
           AND NOT role.rolreplication AND NOT role.rolbypassrls
           AND NOT pg_catalog.has_database_privilege(session_user,pg_catalog.current_database(),'CREATE,TEMPORARY')
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members membership WHERE membership.member=role.oid OR membership.roleid=role.oid)
           AND EXISTS (SELECT 1 FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker WHERE marker.marker_identity=$2 AND marker.database_name=$1 AND marker.test_role=session_user)
           AND pg_catalog.has_schema_privilege(session_user,'vibe_test_legacy_migration_lease','USAGE')
           AND NOT pg_catalog.has_table_privilege(session_user,'vibe_test_legacy_migration_lease.authority_state_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           AND EXISTS (
             SELECT 1 FROM pg_catalog.pg_namespace namespace
              WHERE namespace.nspname='vibe_test_legacy_migration_lease'
                AND pg_catalog.pg_get_userbyid(namespace.nspowner)='postgres'
                AND (SELECT count(*)=3
                       AND count(*) FILTER (WHERE acl.grantee=namespace.nspowner AND acl.privilege_type IN ('CREATE','USAGE') AND NOT acl.is_grantable)=2
                       AND count(*) FILTER (WHERE acl.grantee=role.oid AND acl.privilege_type='USAGE' AND NOT acl.is_grantable)=1
                       AND count(*) FILTER (WHERE acl.grantee=0 OR acl.is_grantable)=0
                     FROM pg_catalog.aclexplode(namespace.nspacl) acl)
           )
           AND (SELECT count(*)=2 AND bool_and(
                  pg_catalog.pg_get_userbyid(procedure.proowner)='postgres'
                  AND language.lanname='plpgsql' AND procedure.prokind='f'
                  AND procedure.prorettype='text'::pg_catalog.regtype
                  AND procedure.prosecdef AND procedure.proisstrict
                  AND procedure.provolatile='v' AND procedure.proparallel='u'
                  AND procedure.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
                  AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc,'UTF8')),'hex')=expected.source_digest
                  AND pg_catalog.has_function_privilege(session_user,procedure.oid,'EXECUTE')
                  AND (SELECT count(*)=2
                         AND count(*) FILTER (WHERE acl.grantee=procedure.proowner AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable)=1
                         AND count(*) FILTER (WHERE acl.grantee=role.oid AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable)=1
                         AND count(*) FILTER (WHERE acl.grantee=0 OR acl.is_grantable OR acl.privilege_type<>'EXECUTE')=0
                       FROM pg_catalog.aclexplode(procedure.proacl) acl)
                )
                  FROM (VALUES ('acquire_v1',$3::text),('release_v1',$4::text)) expected(procedure_name,source_digest)
                  JOIN pg_catalog.pg_proc procedure ON procedure.proname=expected.procedure_name
                  JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace AND namespace.nspname='vibe_test_legacy_migration_lease'
                  JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang)
          FROM pg_catalog.pg_roles role WHERE role.rolname=session_user",
        )
        .bind(&self.database_identity)
        .bind(&self.marker_identity)
        .bind(LEGACY_MIGRATION_ACQUIRE_FUNCTION_SOURCE_SHA256_V1)
        .bind(LEGACY_MIGRATION_RELEASE_FUNCTION_SOURCE_SHA256_V1)
        .fetch_one(&self.pool)
        .await?;

        if exact {
            Ok(())
        } else {
            Err(sqlx::Error::Protocol(
                "legacy Replay migration caller preflight mismatch".into(),
            ))
        }
    }

    async fn acquire_readback(&self) -> Result<(), sqlx::Error> {
        let returned = sqlx::query_scalar::<_, String>(
            "SELECT vibe_test_legacy_migration_lease.acquire_v1($1,$2)",
        )
        .bind(&self.marker_identity)
        .bind(&self.lease_identity)
        .fetch_one(&self.pool)
        .await?;

        if returned == self.lease_identity {
            Ok(())
        } else {
            Err(sqlx::Error::Protocol(
                "legacy Replay migration authority acquire mismatch".into(),
            ))
        }
    }

    /// Repeats the exact preflight and same identity-bound acquire without creating another lease.
    ///
    /// # Errors
    ///
    /// Returns an error when the exact preflight or identity-bound acquire readback fails closed.
    pub async fn retry_acquire(&self) -> Result<(), sqlx::Error> {
        self.preflight_readback().await?;
        self.acquire_readback().await
    }

    /// Proves a different lease identity cannot replace the active linear lease.
    ///
    /// # Errors
    ///
    /// Returns an error when the wrong-identity acquire cannot be evaluated.
    pub async fn try_wrong_lease(&self, wrong_lease_identity: &str) -> Result<String, sqlx::Error> {
        sqlx::query_scalar("SELECT vibe_test_legacy_migration_lease.acquire_v1($1,$2)")
            .bind(&self.marker_identity)
            .bind(wrong_lease_identity)
            .fetch_one(&self.pool)
            .await
    }

    /// Releases the exact lease and proves both temporary authorities are absent and state is READY.
    ///
    /// # Errors
    ///
    /// Returns a transition error retaining the capability when release or its readback fails.
    pub async fn release(
        self,
    ) -> Result<
        ReleasedLegacyReplayMigrationAuthorityV1,
        LegacyReplayMigrationTransitionErrorV1<Self>,
    > {
        let result = sqlx::query_scalar::<_, String>(
            "SELECT vibe_test_legacy_migration_lease.release_v1($1,$2)",
        )
        .bind(&self.marker_identity)
        .bind(&self.lease_identity)
        .fetch_one(&self.pool)
        .await;

        match result {
            Ok(phase) if phase == "READY" => Ok(ReleasedLegacyReplayMigrationAuthorityV1 {
                pool: self.pool.clone(),
                marker_identity: self.marker_identity.clone(),
                lease_identity: self.lease_identity.clone(),
            }),
            Ok(_) => Err(LegacyReplayMigrationTransitionErrorV1 {
                capability: self,
                source: sqlx::Error::Protocol(
                    "legacy Replay migration authority release mismatch".into(),
                ),
            }),
            Err(source) => Err(LegacyReplayMigrationTransitionErrorV1 {
                capability: self,
                source,
            }),
        }
    }
}

impl ReleasedLegacyReplayMigrationAuthorityV1 {
    /// Repeats the exact release readback and proves cleanup remains idempotent.
    ///
    /// # Errors
    ///
    /// Returns an error when the release readback is unavailable or does not report `READY`.
    pub async fn confirm_ready(&self) -> Result<(), sqlx::Error> {
        let phase: String =
            sqlx::query_scalar("SELECT vibe_test_legacy_migration_lease.release_v1($1,$2)")
                .bind(&self.marker_identity)
                .bind(&self.lease_identity)
                .fetch_one(&self.pool)
                .await?;

        if phase == "READY" {
            Ok(())
        } else {
            Err(sqlx::Error::Protocol(
                "legacy Replay migration authority READY readback mismatch".into(),
            ))
        }
    }
}

impl ReplayPolicyCatalogFaultAuthorityV1 {
    async fn acquire_readback(&self) -> Result<(), sqlx::Error> {
        let returned_lease_identity = sqlx::query_scalar::<_, String>(
            "SELECT vibe_test_replay_policy_catalog_fault.acquire_v1($1,$2)",
        )
        .bind(&self.marker_identity)
        .bind(&self.lease_identity)
        .fetch_one(&self.pool)
        .await?;

        if returned_lease_identity != self.lease_identity {
            return Err(sqlx::Error::Protocol(
                "Replay Policy Catalog fault authority acquire mismatch".into(),
            ));
        }
        Ok(())
    }

    /// Performs one bounded acquire retry/readback with the original lease identity.
    ///
    /// # Errors
    ///
    /// Returns the transition error while retaining this exact recovery capability.
    pub async fn retry_acquire(
        self,
    ) -> Result<Self, ReplayPolicyCatalogFaultTransitionErrorV1<Self>> {
        if let Err(source) = self.acquire_readback().await {
            return Err(ReplayPolicyCatalogFaultTransitionErrorV1 {
                capability: self,
                source,
            });
        }
        Ok(self)
    }

    /// Returns the admitted lease pool for fixed test-only Catalog fault operations.
    #[must_use]
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Atomically replaces the lease edge with the fixed Qualification-writer fault edge.
    ///
    /// # Errors
    ///
    /// Returns the PostgreSQL error when the fixed-source transition fails closed.
    pub async fn inject_third_party_owner_edge(
        self,
    ) -> Result<
        InjectedReplayPolicyCatalogThirdPartyOwnerEdgeV1,
        ReplayPolicyCatalogFaultTransitionErrorV1<Self>,
    > {
        let transition = sqlx::query_scalar::<_, String>(
            "SELECT vibe_test_replay_policy_catalog_fault.inject_third_party_owner_edge_v1($1,$2)",
        )
        .bind(&self.marker_identity)
        .bind(&self.lease_identity)
        .fetch_one(&self.pool)
        .await;
        let returned_lease_identity = match transition {
            Ok(value) => value,
            Err(source) => {
                return Err(ReplayPolicyCatalogFaultTransitionErrorV1 {
                    capability: self,
                    source,
                });
            }
        };

        if returned_lease_identity != self.lease_identity {
            return Err(ReplayPolicyCatalogFaultTransitionErrorV1 {
                capability: self,
                source: sqlx::Error::Protocol(
                    "Replay Policy Catalog membership fault lease mismatch".into(),
                ),
            });
        }
        Ok(InjectedReplayPolicyCatalogThirdPartyOwnerEdgeV1 {
            pool: self.pool,
            marker_identity: self.marker_identity,
            lease_identity: self.lease_identity,
        })
    }

    /// Releases the exact fault authority and proves the fixture returned to READY.
    ///
    /// # Errors
    ///
    /// Returns the PostgreSQL error when the fixed-source release fails closed.
    pub async fn release(
        self,
    ) -> Result<
        ReleasedReplayPolicyCatalogFaultAuthorityV1,
        ReplayPolicyCatalogFaultTransitionErrorV1<Self>,
    > {
        let transition = sqlx::query_scalar::<_, String>(
            "SELECT vibe_test_replay_policy_catalog_fault.release_v1($1,$2)",
        )
        .bind(&self.marker_identity)
        .bind(&self.lease_identity)
        .fetch_one(&self.pool)
        .await;
        let phase = match transition {
            Ok(value) => value,
            Err(source) => {
                return Err(ReplayPolicyCatalogFaultTransitionErrorV1 {
                    capability: self,
                    source,
                });
            }
        };

        if phase != "READY" {
            return Err(ReplayPolicyCatalogFaultTransitionErrorV1 {
                capability: self,
                source: sqlx::Error::Protocol(
                    "Replay Policy Catalog fault authority release mismatch".into(),
                ),
            });
        }
        Ok(ReleasedReplayPolicyCatalogFaultAuthorityV1 {
            _marker_identity: self.marker_identity,
            _lease_identity: self.lease_identity,
        })
    }
}

impl InjectedReplayPolicyCatalogThirdPartyOwnerEdgeV1 {
    /// Restores the fixed third-party owner edge and proves the fixture returned to READY.
    ///
    /// # Errors
    ///
    /// Returns the PostgreSQL error when the fixed-source restore fails closed.
    pub async fn restore(
        self,
    ) -> Result<
        ReleasedReplayPolicyCatalogFaultAuthorityV1,
        ReplayPolicyCatalogFaultTransitionErrorV1<Self>,
    > {
        let transition = sqlx::query_scalar::<_, String>(
            "SELECT vibe_test_replay_policy_catalog_fault.restore_third_party_owner_edge_v1($1,$2)",
        )
        .bind(&self.marker_identity)
        .bind(&self.lease_identity)
        .fetch_one(&self.pool)
        .await;
        let phase = match transition {
            Ok(value) => value,
            Err(source) => {
                return Err(ReplayPolicyCatalogFaultTransitionErrorV1 {
                    capability: self,
                    source,
                });
            }
        };

        if phase != "READY" {
            return Err(ReplayPolicyCatalogFaultTransitionErrorV1 {
                capability: self,
                source: sqlx::Error::Protocol(
                    "Replay Policy Catalog membership fault restore mismatch".into(),
                ),
            });
        }
        Ok(ReleasedReplayPolicyCatalogFaultAuthorityV1 {
            _marker_identity: self.marker_identity,
            _lease_identity: self.lease_identity,
        })
    }
}

impl LegacyReplayDuplicateFaultV1 {
    /// Creates the exact duplicate current Replay candidate and consumes the fixture.
    ///
    /// # Errors
    ///
    /// Returns the PostgreSQL error when the one-shot fixture invocation fails.
    pub async fn create_duplicate(self) -> Result<UsedLegacyReplayDuplicateFaultV1, sqlx::Error> {
        sqlx::query(
            "SELECT vibe_test_legacy_replay_fault.create_duplicate_current_candidate_v1($1)",
        )
        .bind(&self.marker_identity)
        .execute(&self.pool)
        .await?;
        Ok(UsedLegacyReplayDuplicateFaultV1 {
            pool: self.pool,
            marker_identity: self.marker_identity,
        })
    }

    /// Calls the fixed-source fixture with a wrong marker to prove zero mutation.
    ///
    /// # Errors
    ///
    /// Returns the PostgreSQL denial raised for the supplied marker.
    pub async fn try_wrong_marker(&self, wrong_marker: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            "SELECT vibe_test_legacy_replay_fault.create_duplicate_current_candidate_v1($1)",
        )
        .bind(wrong_marker)
        .execute(&self.pool)
        .await
        .map(|_| ())
    }
}

impl UsedLegacyReplayDuplicateFaultV1 {
    /// Replays the consumed fixture call so tests can prove server-side one-shot denial.
    ///
    /// # Errors
    ///
    /// Returns the PostgreSQL denial raised after the fixture has been consumed.
    pub async fn retry(&self) -> Result<(), sqlx::Error> {
        sqlx::query(
            "SELECT vibe_test_legacy_replay_fault.create_duplicate_current_candidate_v1($1)",
        )
        .bind(&self.marker_identity)
        .execute(&self.pool)
        .await
        .map(|_| ())
    }
}

const LEGACY_REPLAY_DUPLICATE_ADMISSION_SQL_V1: &str =
    "SELECT session_user='vibe_test_legacy_replay_fault_writer'
           AND pg_catalog.current_database()=$1
           AND EXISTS (
             SELECT 1
               FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker
              WHERE marker.marker_identity=$2
                AND marker.database_name=$1
                AND marker.test_role='vibe_test_legacy_replay_fault_writer'
           )
           AND EXISTS (
             SELECT 1 FROM pg_catalog.pg_roles role
              WHERE role.rolname='vibe_test_legacy_replay_fault_writer'
                AND role.rolcanlogin
                AND NOT role.rolsuper AND NOT role.rolcreatedb
                AND NOT role.rolcreaterole AND NOT role.rolreplication
                AND NOT role.rolbypassrls
                AND NOT EXISTS (
                  SELECT 1 FROM pg_catalog.pg_auth_members membership
                   WHERE membership.member=role.oid
                )
           )
           AND NOT pg_catalog.has_database_privilege(
             session_user, pg_catalog.current_database(), 'CREATE,TEMPORARY'
           )
           AND NOT pg_catalog.has_schema_privilege(session_user,'public','CREATE')
           AND pg_catalog.has_schema_privilege(
             session_user,'vibe_test_legacy_replay_fault','USAGE'
           )
           AND (
             SELECT owner.rolname='postgres'
                AND pg_catalog.count(*)=3
                AND pg_catalog.count(*) FILTER (
                  WHERE acl.grantee=pg_catalog.to_regrole(
                    'vibe_test_legacy_replay_fault_writer'
                  )::oid
                    AND acl.privilege_type='USAGE'
                    AND NOT acl.is_grantable
                )=1
               FROM pg_catalog.pg_namespace namespace
               JOIN pg_catalog.pg_roles owner ON owner.oid=namespace.nspowner
               CROSS JOIN LATERAL pg_catalog.aclexplode(namespace.nspacl) acl
              WHERE namespace.nspname='vibe_test_legacy_replay_fault'
              GROUP BY owner.rolname
           )
           AND (
             SELECT owner.rolname='postgres'
                AND namespace.nspname='vibe_test_legacy_replay_fault'
                AND procedure.proname='create_duplicate_current_candidate_v1'
                AND language.lanname='plpgsql'
                AND procedure.prokind='f'
                AND procedure.prorettype='void'::pg_catalog.regtype
                AND procedure.pronargs=1
                AND pg_catalog.pg_get_function_identity_arguments(procedure.oid)
                    ='expected_marker_identity text'
                AND pg_catalog.encode(
                      pg_catalog.sha256(
                        pg_catalog.convert_to(procedure.prosrc,'UTF8')
                      ),
                      'hex'
                    )=$3
                AND procedure.prosecdef AND procedure.proisstrict
                AND procedure.provolatile='v' AND procedure.proparallel='u'
                AND procedure.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
                AND pg_catalog.count(*)=2
                AND pg_catalog.count(*) FILTER (
                  WHERE acl.grantee=procedure.proowner
                    AND acl.privilege_type='EXECUTE'
                    AND NOT acl.is_grantable
                )=1
                AND pg_catalog.count(*) FILTER (
                  WHERE acl.grantee=pg_catalog.to_regrole(
                    'vibe_test_legacy_replay_fault_writer'
                  )::oid
                    AND acl.privilege_type='EXECUTE'
                    AND NOT acl.is_grantable
                )=1
                AND pg_catalog.count(*) FILTER (WHERE acl.grantee=0)=0
                AND pg_catalog.count(*) FILTER (
                  WHERE acl.privilege_type<>'EXECUTE' OR acl.is_grantable
                )=0
               FROM pg_catalog.pg_proc procedure
               JOIN pg_catalog.pg_namespace namespace
                 ON namespace.oid=procedure.pronamespace
               JOIN pg_catalog.pg_roles owner ON owner.oid=procedure.proowner
               JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang
               CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) acl
              WHERE procedure.oid=pg_catalog.to_regprocedure(
                'vibe_test_legacy_replay_fault.create_duplicate_current_candidate_v1(text)'
              )
              GROUP BY owner.rolname,namespace.nspname,procedure.proname,
                       language.lanname,procedure.prokind,procedure.prorettype,
                       procedure.pronargs,procedure.oid,procedure.prosrc,
                       procedure.prosecdef,procedure.proisstrict,
                       procedure.provolatile,procedure.proparallel,procedure.proconfig
           )
           AND pg_catalog.has_function_privilege(
             session_user,
             'vibe_test_legacy_replay_fault.create_duplicate_current_candidate_v1(text)',
             'EXECUTE'
           )
           AND NOT EXISTS (
             SELECT 1 FROM pg_catalog.unnest(ARRAY[
               'rd_owner','product_edge_owner','vibe_test_owner_topology_admin'
             ]) denied_role(role_name)
              WHERE pg_catalog.has_function_privilege(
                denied_role.role_name,
                'vibe_test_legacy_replay_fault.create_duplicate_current_candidate_v1(text)',
                'EXECUTE'
              )
           )
           AND pg_catalog.to_regclass(
             'public.rd_exploratory_replay_request_custody_v1'
           ) IS NULL
           AND pg_catalog.to_regclass(
             'public.rd_sealed_exploratory_replay_requests_v1'
           ) IS NOT NULL";

async fn admit_legacy_replay_duplicate_fault(
    canonical_target: &NormalizedDatabaseTarget,
    expected_marker: &str,
) -> Result<LegacyReplayDuplicateFaultV1, DedicatedPostgresTestDatabaseError> {
    let url = env::var(LEGACY_REPLAY_FAULT_URL_ENV).map_err(|_| {
        DedicatedPostgresTestDatabaseError::MissingEnvironment(LEGACY_REPLAY_FAULT_URL_ENV)
    })?;
    let target = normalize_url(LEGACY_REPLAY_FAULT_URL_ENV, &url)?;
    if target.role != "vibe_test_legacy_replay_fault_writer"
        || !target.same_database(canonical_target)
    {
        return Err(DedicatedPostgresTestDatabaseError::ExpectedIdentityMismatch);
    }
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .map_err(|_| DedicatedPostgresTestDatabaseError::ReadOnlyPreflightUnavailable)?;
    let fixture_is_exact: bool = sqlx::query_scalar(LEGACY_REPLAY_DUPLICATE_ADMISSION_SQL_V1)
        .bind(&target.database)
        .bind(expected_marker)
        .bind(LEGACY_REPLAY_DUPLICATE_FUNCTION_SOURCE_SHA256_V1)
        .fetch_one(&pool)
        .await
        .map_err(|_| DedicatedPostgresTestDatabaseError::ReadOnlyPreflightUnavailable)?;
    if !fixture_is_exact {
        return Err(DedicatedPostgresTestDatabaseError::ExpectedIdentityMismatch);
    }
    Ok(LegacyReplayDuplicateFaultV1 {
        pool,
        marker_identity: expected_marker.to_string(),
    })
}

async fn admit_owner_topology_admin(
    expected_database: &str,
    expected_marker: &str,
    canonical_target: &NormalizedDatabaseTarget,
) -> Result<PgPool, DedicatedPostgresTestDatabaseError> {
    const URL_ENV: &str = "VIBE_TEST_OWNER_TOPOLOGY_ADMIN_DATABASE_URL";
    let url = env::var(URL_ENV)
        .map_err(|_| DedicatedPostgresTestDatabaseError::MissingEnvironment(URL_ENV))?;
    let target = normalize_url(URL_ENV, &url)?;
    if target.database != expected_database
        || target.role != "vibe_test_owner_topology_admin"
        || !target.same_database(canonical_target)
    {
        return Err(DedicatedPostgresTestDatabaseError::ExpectedIdentityMismatch);
    }
    let pool = PgPoolOptions::new()
        .max_connections(8)
        .connect(&url)
        .await
        .map_err(|_| DedicatedPostgresTestDatabaseError::ReadOnlyPreflightUnavailable)?;
    if !owner_topology_admin_authority_is_exact(&pool, expected_database, expected_marker).await? {
        return Err(DedicatedPostgresTestDatabaseError::ExpectedIdentityMismatch);
    }
    Ok(pool)
}

fn admit_legacy_migration_caller(
    expected_database: &str,
    canonical_target: &NormalizedDatabaseTarget,
) -> Result<(PgConnectOptions, NormalizedDatabaseTarget), DedicatedPostgresTestDatabaseError> {
    let url = env::var(LEGACY_MIGRATION_URL_ENV).map_err(|_| {
        DedicatedPostgresTestDatabaseError::MissingEnvironment(LEGACY_MIGRATION_URL_ENV)
    })?;
    let target = normalize_url(LEGACY_MIGRATION_URL_ENV, &url)?;
    if target.database != expected_database
        || target.role != "vibe_test_legacy_migration_caller"
        || !target.same_database(canonical_target)
    {
        return Err(DedicatedPostgresTestDatabaseError::ExpectedIdentityMismatch);
    }
    let options = url.parse().map_err(|_| {
        DedicatedPostgresTestDatabaseError::InvalidDatabaseUrl(LEGACY_MIGRATION_URL_ENV)
    })?;
    Ok((options, target))
}

const OWNER_TOPOLOGY_ADMIN_AUTHORITY_QUERY: &str =
    "SELECT session_user='vibe_test_owner_topology_admin'
           AND pg_catalog.current_database()=$1
           AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
           AND NOT rolreplication AND NOT rolbypassrls
           AND NOT pg_catalog.has_database_privilege(
             session_user,pg_catalog.current_database(),'CREATE,TEMPORARY'
           )
           AND NOT pg_catalog.has_schema_privilege(session_user,'public','CREATE')
           AND EXISTS (
             SELECT 1 FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker
              WHERE marker.marker_identity=$2 AND marker.database_name=$1
                AND marker.test_role='vibe_test_owner_topology_admin'
           )
           AND (SELECT count(*)=1 AND bool_and(
                  granted.rolname='composer_owner' AND NOT membership.admin_option
                  AND membership.inherit_option AND membership.set_option
                )
                  FROM pg_catalog.pg_auth_members membership
                JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
                WHERE membership.member=administrator.oid
           )
           AND NOT EXISTS (
             SELECT 1 FROM pg_catalog.pg_auth_members membership
             JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
             JOIN pg_catalog.pg_roles member ON member.oid=membership.member
             WHERE granted.rolname IN (
                     'replay_policy_catalog_owner','rd_owner','rd_fact_writer'
                   )
                OR member.rolname IN (
                     'replay_policy_catalog_owner','rd_owner','rd_fact_writer'
                   )
           )
           AND EXISTS (
             SELECT 1 FROM pg_catalog.pg_namespace namespace
             JOIN pg_catalog.pg_roles owner ON owner.oid=namespace.nspowner
             WHERE namespace.nspname='vibe_test_replay_policy_catalog_fault'
               AND owner.rolname='postgres'
               AND (SELECT count(*)=3
                      AND count(*) FILTER (
                        WHERE acl.grantee=namespace.nspowner
                          AND acl.privilege_type IN ('CREATE','USAGE')
                          AND NOT acl.is_grantable
                      )=2
                      AND count(*) FILTER (
                        WHERE acl.grantee=administrator.oid
                          AND acl.privilege_type='USAGE' AND NOT acl.is_grantable
                      )=1
                      AND count(*) FILTER (WHERE acl.grantee=0)=0
                    FROM pg_catalog.aclexplode(namespace.nspacl) acl)
           )
           AND EXISTS (
             SELECT 1 FROM pg_catalog.pg_class relation
             JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
             JOIN pg_catalog.pg_roles owner ON owner.oid=relation.relowner
             WHERE namespace.nspname='vibe_test_replay_policy_catalog_fault'
               AND relation.relname='authority_state_v1' AND relation.relkind='r'
               AND relation.relpersistence='p' AND owner.rolname='postgres'
               AND NOT relation.relrowsecurity AND NOT relation.relforcerowsecurity
               AND relation.reloptions IS NULL
               AND (SELECT count(*)=8
                      AND count(*) FILTER (
                        WHERE acl.grantee=relation.relowner AND NOT acl.is_grantable
                      )=7
                      AND count(*) FILTER (
                        WHERE acl.grantee=administrator.oid
                          AND acl.privilege_type='SELECT' AND NOT acl.is_grantable
                      )=1
                      AND count(*) FILTER (
                        WHERE acl.grantee NOT IN (relation.relowner,administrator.oid)
                           OR acl.is_grantable
                      )=0
                    FROM pg_catalog.aclexplode(
                   COALESCE(relation.relacl,pg_catalog.acldefault('r',relation.relowner))
                 ) acl)
               AND NOT EXISTS (
                 SELECT 1 FROM pg_catalog.pg_trigger trigger_fact
                  WHERE trigger_fact.tgrelid=relation.oid AND NOT trigger_fact.tgisinternal
               )
               AND NOT EXISTS (
                 SELECT 1 FROM pg_catalog.pg_rewrite rewrite_fact
                  WHERE rewrite_fact.ev_class=relation.oid
               )
               AND NOT EXISTS (
                 SELECT 1 FROM pg_catalog.pg_publication_rel publication
                  WHERE publication.prrelid=relation.oid
               )
               AND (SELECT array_agg(
                      attribute.attname||':'||
                      pg_catalog.format_type(attribute.atttypid,attribute.atttypmod)||':'||
                      attribute.attnotnull::text ORDER BY attribute.attnum
                    )
                      FROM pg_catalog.pg_attribute attribute
                     WHERE attribute.attrelid=relation.oid AND attribute.attnum>0
                       AND NOT attribute.attisdropped
                   )=ARRAY[
                     'singleton:boolean:true','marker_identity:text:true',
                     'database_name:name:true','execution_boundary:text:true',
                     'phase:text:true',
                     'lease_identity:text:false',
                     'last_released_lease_identity:text:false'
                   ]::text[]
               AND (SELECT count(*)=4 AND bool_and(
                      CASE constraint_fact.conname
                        WHEN 'authority_state_v1_singleton_pk' THEN
                          constraint_fact.contype='p' AND constraint_fact.conkey::text='1'
                        WHEN 'authority_state_v1_singleton_check' THEN
                          constraint_fact.contype='c'
                          AND pg_catalog.pg_get_expr(
                            constraint_fact.conbin,constraint_fact.conrelid
                          )='singleton'
                        WHEN 'authority_state_v1_phase_check' THEN
                          constraint_fact.contype='c'
                          AND pg_catalog.pg_get_expr(
                            constraint_fact.conbin,constraint_fact.conrelid
                          )='(phase = ANY (ARRAY[''READY''::text, ''LEASED''::text, ''MEMBERSHIP_FAULT''::text]))'
                        WHEN 'authority_state_v1_lease_check' THEN
                          constraint_fact.contype='c'
                          AND pg_catalog.pg_get_expr(
                            constraint_fact.conbin,constraint_fact.conrelid
                          )='(((phase = ''READY''::text) AND (lease_identity IS NULL)) OR ((phase = ANY (ARRAY[''LEASED''::text, ''MEMBERSHIP_FAULT''::text])) AND (lease_identity IS NOT NULL)))'
                        ELSE false
                      END
                    ) FROM pg_catalog.pg_constraint constraint_fact
                    WHERE constraint_fact.conrelid=relation.oid)
               AND (SELECT count(*)=1 AND bool_and(
                      index_fact.indisprimary AND index_fact.indisunique
                      AND index_fact.indisvalid AND index_fact.indisready
                      AND index_fact.indislive AND index_fact.indexprs IS NULL
                      AND index_fact.indpred IS NULL AND index_relation.reloptions IS NULL
                    ) FROM pg_catalog.pg_index index_fact
                    JOIN pg_catalog.pg_class index_relation
                      ON index_relation.oid=index_fact.indexrelid
                    WHERE index_fact.indrelid=relation.oid)
               AND (SELECT count(*)=1 AND bool_and(
                      state.singleton AND state.marker_identity=$2
                      AND state.database_name=$1
                      AND state.execution_boundary=
                        'isolated-disposable-postgres-container:sequential-shell-loop:v1'
                      AND state.phase='READY'
                      AND state.lease_identity IS NULL
                    ) FROM vibe_test_replay_policy_catalog_fault.authority_state_v1 state)
           )
           AND (SELECT count(*)=2
                  FROM pg_catalog.pg_class relation
                  JOIN pg_catalog.pg_namespace namespace
                    ON namespace.oid=relation.relnamespace
                 WHERE namespace.nspname='vibe_test_replay_policy_catalog_fault'
                   AND relation.relkind IN ('r','i'))
           AND (SELECT count(*)=4
                  FROM pg_catalog.pg_proc procedure
                  JOIN pg_catalog.pg_namespace namespace
                    ON namespace.oid=procedure.pronamespace
                 WHERE namespace.nspname='vibe_test_replay_policy_catalog_fault')
           AND (SELECT count(*)=4 AND bool_and(
                  owner.rolname='postgres' AND language.lanname='plpgsql'
                  AND procedure.prokind='f' AND procedure.prorettype='text'::pg_catalog.regtype
                  AND procedure.pronargs=expected.argument_count
                  AND pg_catalog.pg_get_function_identity_arguments(procedure.oid)
                      =expected.identity_arguments
                  AND procedure.prosecdef AND procedure.proisstrict
                  AND procedure.provolatile='v' AND procedure.proparallel='u'
                  AND procedure.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
                  AND pg_catalog.encode(pg_catalog.sha256(
                        pg_catalog.convert_to(procedure.prosrc,'UTF8')
                      ),'hex')=expected.source_digest
                  AND (SELECT count(*)=2
                        AND count(*) FILTER (
                          WHERE acl.grantee=procedure.proowner
                            AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable
                        )=1
                        AND count(*) FILTER (
                          WHERE acl.grantee=administrator.oid
                            AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable
                        )=1
                        AND count(*) FILTER (WHERE acl.grantee=0)=0
                        AND count(*) FILTER (
                          WHERE acl.privilege_type<>'EXECUTE' OR acl.is_grantable
                        )=0
                      FROM pg_catalog.aclexplode(procedure.proacl) acl)
                )
                  FROM (VALUES
                    ('acquire_v1',2,'expected_marker_identity text, expected_lease_identity text',$3::text),
                    ('release_v1',2,'expected_marker_identity text, expected_lease_identity text',$4::text),
                    ('inject_third_party_owner_edge_v1',2,'expected_marker_identity text, expected_lease_identity text',$5::text),
                    ('restore_third_party_owner_edge_v1',2,'expected_marker_identity text, expected_lease_identity text',$6::text)
                  ) expected(procedure_name,argument_count,identity_arguments,source_digest)
                  JOIN pg_catalog.pg_proc procedure ON procedure.proname=expected.procedure_name
                  JOIN pg_catalog.pg_namespace namespace
                    ON namespace.oid=procedure.pronamespace
                   AND namespace.nspname='vibe_test_replay_policy_catalog_fault'
                  JOIN pg_catalog.pg_roles owner ON owner.oid=procedure.proowner
                  JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang
           )
          FROM pg_catalog.pg_roles administrator
         WHERE administrator.rolname='vibe_test_owner_topology_admin' AND administrator.rolcanlogin";

async fn owner_topology_admin_authority_is_exact(
    pool: &PgPool,
    expected_database: &str,
    expected_marker: &str,
) -> Result<bool, DedicatedPostgresTestDatabaseError> {
    let role_is_exact: bool = sqlx::query_scalar(OWNER_TOPOLOGY_ADMIN_AUTHORITY_QUERY)
        .bind(expected_database)
        .bind(expected_marker)
        .bind(REPLAY_POLICY_CATALOG_FAULT_ACQUIRE_FUNCTION_SOURCE_SHA256_V1)
        .bind(REPLAY_POLICY_CATALOG_FAULT_RELEASE_FUNCTION_SOURCE_SHA256_V1)
        .bind(REPLAY_POLICY_CATALOG_FAULT_INJECT_MEMBERSHIP_FUNCTION_SOURCE_SHA256_V1)
        .bind(REPLAY_POLICY_CATALOG_FAULT_RESTORE_MEMBERSHIP_FUNCTION_SOURCE_SHA256_V1)
        .fetch_one(pool)
        .await
        .map_err(|_| DedicatedPostgresTestDatabaseError::CatalogAdminAuthorityQueryUnavailable)?;
    Ok(role_is_exact)
}

/// Capability for role-specific mutation in an admitted canonical Owner test topology.
#[derive(Clone, Copy, Debug)]
pub struct CanonicalOwnerPostgresTestMutationV1<'a> {
    database: &'a CanonicalOwnerPostgresTestDatabaseV1,
}

impl CanonicalOwnerPostgresTestMutationV1<'_> {
    /// Returns the selected non-privileged Owner-role pool.
    #[must_use]
    pub fn pool(&self, role: CanonicalOwnerTestRoleV1) -> &PgPool {
        &self.database.pools[role.index()]
    }

    /// Returns the immutable marker identity for test correlation.
    #[must_use]
    pub fn marker_identity(&self) -> &str {
        &self.database.marker_identity
    }
}

impl Debug for DedicatedPostgresTestDatabase {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(DedicatedPostgresTestDatabase))
            .field("database", &self.target.database)
            .field("role", &self.target.role)
            .field("marker_identity", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

impl DedicatedPostgresTestDatabase {
    /// Admits one explicit test URL after a read-only identity and marker preflight.
    ///
    /// # Errors
    ///
    /// Returns a redacted error when configuration, isolation, or marker custody is invalid.
    pub async fn admit(
        test_database_url_env: &'static str,
    ) -> Result<Self, DedicatedPostgresTestDatabaseError> {
        Self::admit_cross_owner(&[test_database_url_env]).await
    }

    /// Admits multiple Owner URLs only when all resolve to the same marked disposable database.
    ///
    /// # Errors
    ///
    /// Returns a redacted error when any URL is missing, unsafe, mismatched, or unmarked.
    pub async fn admit_cross_owner(
        test_database_url_envs: &[&'static str],
    ) -> Result<Self, DedicatedPostgresTestDatabaseError> {
        let values = EnvironmentValues::read(test_database_url_envs)?;
        let targets = validate_environment(&values)?;
        let mut admitted_pool = None;

        for (test_url, target) in values.test_urls.iter().zip(&targets) {
            let pool = PgPoolOptions::new()
                .max_connections(4)
                .connect(&test_url.value)
                .await
                .map_err(|_| DedicatedPostgresTestDatabaseError::ReadOnlyPreflightUnavailable)?;
            verify_marker_read_only(
                &pool,
                target,
                &ExpectedMarker {
                    database: &values.expected_database,
                    role: &test_url.expected_role,
                    identity: &values.expected_marker,
                },
            )
            .await?;
            admitted_pool.get_or_insert(pool);
        }
        let first_url = &values.test_urls[0].value;
        let target = targets[0].clone();
        Ok(Self {
            database_url: first_url.clone(),
            target,
            marker_identity: values.expected_marker,
            pool: admitted_pool.ok_or(DedicatedPostgresTestDatabaseError::NonTestUrlEnvironment)?,
        })
    }

    /// Returns the admitted URL for constructing the Owner under test.
    #[must_use]
    pub fn database_url(&self) -> &str {
        &self.database_url
    }

    /// Creates a capability required by destructive/corruption helpers.
    #[must_use]
    pub fn mutation(&self) -> DedicatedPostgresTestMutation<'_> {
        DedicatedPostgresTestMutation { database: self }
    }
}

/// Capability proving that destructive SQL follows dedicated-database admission.
#[derive(Clone, Copy, Debug)]
pub struct DedicatedPostgresTestMutation<'a> {
    database: &'a DedicatedPostgresTestDatabase,
}

impl DedicatedPostgresTestMutation<'_> {
    /// Returns the pool only after dedicated-database admission has succeeded.
    #[must_use]
    pub fn pool(&self) -> &PgPool {
        &self.database.pool
    }

    /// Returns the immutable marker identity for test correlation without exposing credentials.
    #[must_use]
    pub fn marker_identity(&self) -> &str {
        &self.database.marker_identity
    }
}

struct EnvironmentValues {
    test_urls: Vec<TestUrlValue>,
    production_urls: Vec<(&'static str, String)>,
    expected_database: String,
    expected_marker: String,
}

struct TestUrlValue {
    name: &'static str,
    value: String,
    expected_role: String,
}

impl EnvironmentValues {
    fn read(
        test_database_url_envs: &[&'static str],
    ) -> Result<Self, DedicatedPostgresTestDatabaseError> {
        if test_database_url_envs.is_empty()
            || test_database_url_envs
                .iter()
                .any(|name| !name.ends_with("_TEST_DATABASE_URL"))
        {
            return Err(DedicatedPostgresTestDatabaseError::NonTestUrlEnvironment);
        }
        let mut test_urls = Vec::with_capacity(test_database_url_envs.len());
        for name in test_database_url_envs {
            let value = env::var(name)
                .map_err(|_| DedicatedPostgresTestDatabaseError::MissingEnvironment(name))?;
            let role_env = role_environment(name)
                .ok_or(DedicatedPostgresTestDatabaseError::NonTestUrlEnvironment)?;
            let expected_role = env::var(role_env)
                .map_err(|_| DedicatedPostgresTestDatabaseError::MissingEnvironment(role_env))?;
            test_urls.push(TestUrlValue {
                name,
                value,
                expected_role,
            });
        }
        let production_urls = PRODUCTION_DATABASE_URL_ENVS
            .into_iter()
            .filter_map(|name| env::var(name).ok().map(|value| (name, value)))
            .collect();
        Ok(Self {
            test_urls,
            production_urls,
            expected_database: env::var(EXPECTED_DATABASE_ENV).map_err(|_| {
                DedicatedPostgresTestDatabaseError::MissingEnvironment(EXPECTED_DATABASE_ENV)
            })?,
            expected_marker: env::var(EXPECTED_MARKER_ENV).map_err(|_| {
                DedicatedPostgresTestDatabaseError::MissingEnvironment(EXPECTED_MARKER_ENV)
            })?,
        })
    }
}

fn validate_environment(
    values: &EnvironmentValues,
) -> Result<Vec<NormalizedDatabaseTarget>, DedicatedPostgresTestDatabaseError> {
    if values.expected_database.is_empty() || values.expected_marker.is_empty() {
        return Err(DedicatedPostgresTestDatabaseError::ExpectedIdentityMismatch);
    }
    let mut targets = Vec::with_capacity(values.test_urls.len());
    for test_url in &values.test_urls {
        let expected = ExpectedMarker {
            database: &values.expected_database,
            role: &test_url.expected_role,
            identity: &values.expected_marker,
        };
        let target = normalize_url(test_url.name, &test_url.value)?;
        validate_target(&target, &expected)?;
        validate_expected_marker(&expected)?;
        targets.push(target);
    }
    let first = targets
        .first()
        .ok_or(DedicatedPostgresTestDatabaseError::NonTestUrlEnvironment)?;
    if targets.iter().any(|target| !target.same_database(first)) {
        return Err(DedicatedPostgresTestDatabaseError::CrossOwnerDatabaseMismatch);
    }

    for (name, value) in &values.production_urls {
        let production = normalize_url(name, value)?;
        if first.same_database(&production) {
            return Err(DedicatedPostgresTestDatabaseError::ProductionDatabaseForbidden(name));
        }
    }
    Ok(targets)
}

fn validate_expected_marker(
    expected: &ExpectedMarker<'_>,
) -> Result<(), DedicatedPostgresTestDatabaseError> {
    if !expected.database.starts_with("vibe_test_")
        || !expected.role.starts_with("vibe_test_role_")
        || expected.identity.is_empty()
    {
        return Err(DedicatedPostgresTestDatabaseError::ExpectedIdentityMismatch);
    }
    Ok(())
}

fn role_environment(url_environment: &str) -> Option<&'static str> {
    match url_environment {
        "RD_OWNER_TEST_DATABASE_URL" => Some("RD_OWNER_TEST_DATABASE_ROLE"),
        "PRODUCT_EDGE_TEST_DATABASE_URL" => Some("PRODUCT_EDGE_TEST_DATABASE_ROLE"),
        "OPERATOR_AUTHORIZATION_TEST_DATABASE_URL" => {
            Some("OPERATOR_AUTHORIZATION_TEST_DATABASE_ROLE")
        }
        "QUALIFICATION_TEST_DATABASE_URL" => Some("QUALIFICATION_TEST_DATABASE_ROLE"),
        "BACKTEST_TEST_DATABASE_URL" => Some("BACKTEST_TEST_DATABASE_ROLE"),
        _ => None,
    }
}

fn normalize_url(
    name: &'static str,
    value: &str,
) -> Result<NormalizedDatabaseTarget, DedicatedPostgresTestDatabaseError> {
    let parsed = Url::parse(value)
        .map_err(|_| DedicatedPostgresTestDatabaseError::InvalidDatabaseUrl(name))?;

    if !matches!(parsed.scheme(), "postgres" | "postgresql")
        || parsed.host_str().is_none()
        || parsed.username().is_empty()
        || parsed.username().contains('%')
        || parsed.path().contains('%')
    {
        return Err(DedicatedPostgresTestDatabaseError::InvalidDatabaseUrl(name));
    }
    let database = parsed.path().trim_start_matches('/');
    if database.is_empty() || database.contains('/') {
        return Err(DedicatedPostgresTestDatabaseError::InvalidDatabaseUrl(name));
    }
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    let host = if matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1" | "[::1]") {
        "loopback".to_string()
    } else {
        host
    };
    Ok(NormalizedDatabaseTarget {
        host,
        port: parsed.port().unwrap_or(5432),
        database: database.to_string(),
        role: parsed.username().to_string(),
    })
}

fn validate_target(
    target: &NormalizedDatabaseTarget,
    expected: &ExpectedMarker<'_>,
) -> Result<(), DedicatedPostgresTestDatabaseError> {
    if DEFAULT_DATABASE_NAMES.contains(&target.database.as_str()) {
        return Err(DedicatedPostgresTestDatabaseError::DefaultDatabaseForbidden);
    }

    if target.database != expected.database || target.role != expected.role {
        return Err(DedicatedPostgresTestDatabaseError::ExpectedIdentityMismatch);
    }
    Ok(())
}

async fn verify_marker_read_only(
    pool: &PgPool,
    target: &NormalizedDatabaseTarget,
    expected: &ExpectedMarker<'_>,
) -> Result<(), DedicatedPostgresTestDatabaseError> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| DedicatedPostgresTestDatabaseError::ReadOnlyPreflightUnavailable)?;
    sqlx::query("SET TRANSACTION READ ONLY")
        .execute(&mut *transaction)
        .await
        .map_err(|_| DedicatedPostgresTestDatabaseError::ReadOnlyPreflightUnavailable)?;
    let identity = sqlx::query_as::<_, (String, String)>(
        "SELECT current_database()::text, current_user::text",
    )
    .fetch_one(&mut *transaction)
    .await
    .map_err(|_| DedicatedPostgresTestDatabaseError::ReadOnlyPreflightUnavailable)?;
    if identity.0 != target.database || identity.1 != target.role {
        return Err(DedicatedPostgresTestDatabaseError::ExpectedIdentityMismatch);
    }
    let rows = sqlx::query_as::<
        _,
        (
            String,
            String,
            String,
            String,
            bool,
            bool,
            bool,
            bool,
            bool,
            bool,
            bool,
        ),
    >(
        "SELECT marker.marker_identity, marker.database_name, marker.test_role, pg_catalog.pg_get_userbyid(class.relowner), role.rolsuper, role.rolcreatedb, role.rolcreaterole, pg_catalog.has_schema_privilege(current_user, 'vibe_test_admin', 'CREATE'), pg_catalog.has_table_privilege(current_user, 'vibe_test_admin.dedicated_postgres_test_instance_v1', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), pg_catalog.has_database_privilege(current_user, pg_catalog.current_database(), 'CREATE'), pg_catalog.has_database_privilege(current_user, pg_catalog.current_database(), 'TEMPORARY') FROM vibe_test_admin.dedicated_postgres_test_instance_v1 AS marker JOIN pg_catalog.pg_class AS class ON class.oid = 'vibe_test_admin.dedicated_postgres_test_instance_v1'::pg_catalog.regclass JOIN pg_catalog.pg_roles AS role ON role.rolname = current_user WHERE marker.test_role = current_user",
    )
    .fetch_all(&mut *transaction)
    .await
    .map_err(|_| DedicatedPostgresTestDatabaseError::MarkerMismatch)?;
    transaction
        .rollback()
        .await
        .map_err(|_| DedicatedPostgresTestDatabaseError::ReadOnlyPreflightUnavailable)?;
    if rows.len() != 1 {
        return Err(DedicatedPostgresTestDatabaseError::MarkerMismatch);
    }
    let row = &rows[0];
    validate_observed_marker(
        expected,
        &ObservedMarker {
            identity: &row.0,
            database: &row.1,
            role: &row.2,
            owner: &row.3,
            unsafe_role_capabilities: [row.4, row.5, row.6, row.7, row.8, row.9, row.10],
        },
    )
}

fn validate_observed_marker(
    expected: &ExpectedMarker<'_>,
    observed: &ObservedMarker<'_>,
) -> Result<(), DedicatedPostgresTestDatabaseError> {
    if observed.identity != expected.identity
        || observed.database != expected.database
        || observed.role != expected.role
    {
        return Err(DedicatedPostgresTestDatabaseError::MarkerMismatch);
    }

    if observed.owner == expected.role
        || observed
            .unsafe_role_capabilities
            .into_iter()
            .any(|value| value)
    {
        return Err(DedicatedPostgresTestDatabaseError::MarkerNotImmutable);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn values() -> EnvironmentValues {
        EnvironmentValues {
            test_urls: vec![TestUrlValue {
                name: "RD_OWNER_TEST_DATABASE_URL",
                value: "postgres://vibe_test_role_7:secret@127.0.0.1:55432/vibe_test_7".to_string(),
                expected_role: "vibe_test_role_7".to_string(),
            }],
            production_urls: vec![],
            expected_database: "vibe_test_7".to_string(),
            expected_marker: "marker-7".to_string(),
        }
    }

    #[rstest]
    fn rejects_production_alias_default_database_wrong_role_and_cross_owner_mismatch() {
        let mut production_alias = values();
        production_alias.production_urls.push((
            "RD_OWNER_DATABASE_URL",
            "postgres://owner:other@localhost:55432/vibe_test_7".to_string(),
        ));
        assert_eq!(
            validate_environment(&production_alias).unwrap_err(),
            DedicatedPostgresTestDatabaseError::ProductionDatabaseForbidden(
                "RD_OWNER_DATABASE_URL"
            )
        );

        let mut fact_writer_exact_alias = values();
        assert!(PRODUCTION_DATABASE_URL_ENVS.contains(&"RD_FACT_WRITER_DATABASE_URL"));
        fact_writer_exact_alias.production_urls.push((
            "RD_FACT_WRITER_DATABASE_URL",
            fact_writer_exact_alias.test_urls[0].value.clone(),
        ));
        assert_eq!(
            validate_environment(&fact_writer_exact_alias).unwrap_err(),
            DedicatedPostgresTestDatabaseError::ProductionDatabaseForbidden(
                "RD_FACT_WRITER_DATABASE_URL"
            )
        );

        let mut default_database = values();
        default_database.expected_database = "postgres".to_string();
        default_database.test_urls[0].value =
            "postgres://vibe_test_role_7:secret@127.0.0.1/postgres".to_string();
        assert!(validate_environment(&default_database).is_err());
        assert_eq!(
            validate_environment(&default_database).unwrap_err(),
            DedicatedPostgresTestDatabaseError::DefaultDatabaseForbidden
        );

        let mut wrong_role = values();
        wrong_role.test_urls[0].value =
            "postgres://wrong:secret@127.0.0.1:55432/vibe_test_7".to_string();
        assert_eq!(
            validate_environment(&wrong_role).unwrap_err(),
            DedicatedPostgresTestDatabaseError::ExpectedIdentityMismatch
        );

        let mut cross_owner = values();
        cross_owner.test_urls.push(TestUrlValue {
            name: "PRODUCT_EDGE_TEST_DATABASE_URL",
            value: "postgres://vibe_test_role_7:secret@localhost:55433/vibe_test_7".to_string(),
            expected_role: "vibe_test_role_7".to_string(),
        });
        assert_eq!(
            validate_environment(&cross_owner).unwrap_err(),
            DedicatedPostgresTestDatabaseError::CrossOwnerDatabaseMismatch
        );
    }

    #[rstest]
    fn missing_and_non_test_environment_fail_without_a_connection() {
        assert_eq!(
            EnvironmentValues::read(&["VIBE_CONTAINMENT_MISSING_TEST_DATABASE_URL"])
                .err()
                .unwrap(),
            DedicatedPostgresTestDatabaseError::MissingEnvironment(
                "VIBE_CONTAINMENT_MISSING_TEST_DATABASE_URL"
            )
        );
        assert_eq!(
            EnvironmentValues::read(&[]).err().unwrap(),
            DedicatedPostgresTestDatabaseError::NonTestUrlEnvironment
        );
        assert_eq!(
            EnvironmentValues::read(&["RD_OWNER_DATABASE_URL"])
                .err()
                .unwrap(),
            DedicatedPostgresTestDatabaseError::NonTestUrlEnvironment
        );
    }

    #[rstest]
    fn marker_requires_admin_ownership_and_immutable_test_role() {
        let expected = ExpectedMarker {
            database: "vibe_test_7",
            role: "vibe_test_role_7",
            identity: "marker-7",
        };
        let valid = ObservedMarker {
            database: "vibe_test_7",
            role: "vibe_test_role_7",
            identity: "marker-7",
            owner: "postgres",
            unsafe_role_capabilities: [false; 7],
        };
        assert_eq!(validate_observed_marker(&expected, &valid), Ok(()));
        let forged = ObservedMarker {
            owner: "vibe_test_role_7",
            ..valid
        };
        assert_eq!(
            validate_observed_marker(&expected, &forged),
            Err(DedicatedPostgresTestDatabaseError::MarkerNotImmutable)
        );
        let temporary_database_authority = ObservedMarker {
            unsafe_role_capabilities: [false, false, false, false, false, false, true],
            ..valid
        };
        assert_eq!(
            validate_observed_marker(&expected, &temporary_database_authority),
            Err(DedicatedPostgresTestDatabaseError::MarkerNotImmutable)
        );
        let missing = ObservedMarker {
            identity: "forged",
            owner: "postgres",
            ..valid
        };
        assert_eq!(
            validate_observed_marker(&expected, &missing),
            Err(DedicatedPostgresTestDatabaseError::MarkerMismatch)
        );
    }

    #[rstest]
    fn errors_and_debug_never_include_url_credentials() {
        let error = DedicatedPostgresTestDatabaseError::ProductionDatabaseForbidden(
            "RD_OWNER_DATABASE_URL",
        );
        let rendered = format!("{error:?} {error}");
        assert!(!rendered.contains("secret"));
        assert!(!rendered.contains("postgres://"));
    }

    #[rstest]
    fn legacy_replay_duplicate_admission_binds_the_executable_definition() {
        let source = include_str!("postgres.rs");

        for required in [
            "procedure.prosrc",
            "language.lanname='plpgsql'",
            "procedure.prokind='f'",
            "procedure.prorettype='void'::pg_catalog.regtype",
            "pg_catalog.pg_get_function_identity_arguments(procedure.oid)",
            "='expected_marker_identity text'",
            "procedure.proname='create_duplicate_current_candidate_v1'",
            "namespace.nspname='vibe_test_legacy_replay_fault'",
        ] {
            assert!(
                source.contains(required),
                "missing definition check: {required}"
            );
        }
        assert_eq!(LEGACY_REPLAY_DUPLICATE_FUNCTION_SOURCE_SHA256_V1.len(), 64);
        assert!(
            LEGACY_REPLAY_DUPLICATE_FUNCTION_SOURCE_SHA256_V1
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        );
    }

    #[rstest]
    fn replay_policy_catalog_fault_authority_binds_linear_fixed_source_lease() {
        let source = include_str!("postgres.rs");

        for required in [
            "vibe_test_replay_policy_catalog_fault.acquire_v1($1,$2)",
            "pub async fn retry_acquire(",
            "if let Err(source) = authority.acquire_readback().await",
            "capability: authority",
            "vibe_test_replay_policy_catalog_fault.release_v1($1,$2)",
            "vibe_test_replay_policy_catalog_fault.inject_third_party_owner_edge_v1($1,$2)",
            "vibe_test_replay_policy_catalog_fault.restore_third_party_owner_edge_v1($1,$2)",
            "'singleton:boolean:true','marker_identity:text:true'",
            "state.phase='READY'",
            "last_released_lease_identity",
            "isolated-disposable-postgres-container:sequential-shell-loop:v1",
            "granted.rolname IN (\n                     'replay_policy_catalog_owner','rd_owner','rd_fact_writer'",
            "procedure.prosecdef AND procedure.proisstrict",
            "procedure.provolatile='v' AND procedure.proparallel='u'",
            "procedure.proconfig=ARRAY['search_path=pg_catalog, pg_temp']",
            "count(*)=4 AND bool_and(",
        ] {
            assert!(source.contains(required), "missing lease check: {required}");
        }

        for digest in [
            REPLAY_POLICY_CATALOG_FAULT_ACQUIRE_FUNCTION_SOURCE_SHA256_V1,
            REPLAY_POLICY_CATALOG_FAULT_RELEASE_FUNCTION_SOURCE_SHA256_V1,
            REPLAY_POLICY_CATALOG_FAULT_INJECT_MEMBERSHIP_FUNCTION_SOURCE_SHA256_V1,
            REPLAY_POLICY_CATALOG_FAULT_RESTORE_MEMBERSHIP_FUNCTION_SOURCE_SHA256_V1,
        ] {
            assert_eq!(digest.len(), 64);
            assert!(digest.bytes().all(|byte| byte.is_ascii_hexdigit()));
        }
    }

    #[rstest]
    fn legacy_replay_migration_authority_is_linear_bounded_and_failure_released() {
        let source = include_str!("postgres.rs");
        let canonical = source
            .split_once("impl CanonicalOwnerPostgresTestDatabaseV1")
            .expect("canonical database implementation")
            .1;
        let ordinary_admission = canonical
            .split_once("pub async fn admit()")
            .expect("canonical admission")
            .1
            .split_once("pub fn database_url(")
            .expect("canonical admission boundary")
            .0;
        let acquire = source
            .split_once("pub async fn acquire_legacy_replay_migration_authority(")
            .expect("legacy migration acquire")
            .1
            .split_once("impl LegacyReplayMigrationAuthorityV1")
            .expect("legacy migration acquire boundary")
            .0;
        let preflight_readback = source
            .split_once("async fn preflight_readback(&self)")
            .expect("legacy migration preflight")
            .1
            .split_once("async fn acquire_readback(&self)")
            .expect("legacy migration preflight boundary")
            .0;
        let caller_identity_admission = source
            .split_once("fn admit_legacy_migration_caller(")
            .expect("legacy migration caller identity admission")
            .1
            .split_once("const OWNER_TOPOLOGY_ADMIN_AUTHORITY_QUERY")
            .expect("legacy migration caller identity admission boundary")
            .0;
        let consumers =
            include_str!("../../strategy_factory/tests/exploratory_replay_request_owner.rs");
        let shell = include_str!("../../../scripts/ci/test-rd-owner-postgres.bash");
        let test_loop = shell
            .rsplit("# The first two filters exercise explicit legacy/origin migration")
            .next()
            .expect("legacy migration test loop");

        assert!(!source.contains("#[derive(Clone)]\npub struct LegacyReplayMigrationAuthorityV1"));
        assert!(ordinary_admission.contains("admit_legacy_migration_caller"));
        assert!(!ordinary_admission.contains("preflight_readback().await"));
        assert!(!ordinary_admission.contains("legacy_migration_caller_pool"));
        assert!(!caller_identity_admission.contains(".connect("));
        assert!(!caller_identity_admission.contains(".fetch_one("));
        assert!(acquire.contains("connect_lazy_with"));

        for exact_preflight in [
            "session_user='vibe_test_legacy_migration_caller'",
            "marker.marker_identity=$2 AND marker.database_name=$1",
            "NOT pg_catalog.has_database_privilege",
            "NOT pg_catalog.has_table_privilege",
            "procedure.proconfig=ARRAY['search_path=pg_catalog, pg_temp']",
            "LEGACY_MIGRATION_ACQUIRE_FUNCTION_SOURCE_SHA256_V1",
            "LEGACY_MIGRATION_RELEASE_FUNCTION_SOURCE_SHA256_V1",
        ] {
            assert!(
                preflight_readback.contains(exact_preflight),
                "missing exact lazy preflight check: {exact_preflight}"
            );
        }
        let preflight = acquire
            .find("preflight_readback().await")
            .expect("legacy migration preflight");
        let lease_acquire = acquire
            .find("acquire_readback().await")
            .expect("legacy migration lease acquire");
        assert!(preflight < lease_acquire);
        let retry = source
            .split_once("pub async fn retry_acquire(&self)")
            .expect("legacy migration acquire retry")
            .1
            .split_once("pub async fn try_wrong_lease(&self")
            .expect("legacy migration acquire retry boundary")
            .0;
        let retry_preflight = retry
            .find("preflight_readback().await")
            .expect("legacy migration retry preflight");
        let retry_acquire = retry
            .find("acquire_readback().await")
            .expect("legacy migration retry acquire");
        assert!(retry_preflight < retry_acquire);
        assert_eq!(
            consumers
                .matches(".acquire_legacy_replay_migration_authority()")
                .count(),
            2
        );

        for required in [
            "pub async fn retry_acquire(&self)",
            "pub async fn try_wrong_lease(&self",
            "pub async fn release(",
            "pub async fn confirm_ready(&self)",
            "CatalogAdminAuthorityQueryUnavailable",
            "vibe_test_legacy_migration_lease.release_v1(:'test_marker',:'lease_identity')",
        ] {
            assert!(
                source.contains(required) || shell.contains(required),
                "missing bounded legacy migration lease check: {required}"
            );
        }
        assert!(!test_loop.contains("GRANT CREATE ON SCHEMA public TO rd_owner;"));
        assert!(!test_loop.contains("GRANT rd_custodian TO rd_owner;"));

        for digest in [
            LEGACY_MIGRATION_ACQUIRE_FUNCTION_SOURCE_SHA256_V1,
            LEGACY_MIGRATION_RELEASE_FUNCTION_SOURCE_SHA256_V1,
        ] {
            assert_eq!(digest.len(), 64);
            assert!(digest.bytes().all(|byte| byte.is_ascii_hexdigit()));
        }
    }
}
