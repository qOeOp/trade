//! Fail-closed admission for destructive PostgreSQL integration tests.

use std::{
    env,
    fmt::{Debug, Display},
};

use sqlx::{PgPool, postgres::PgPoolOptions};
use url::Url;

const EXPECTED_DATABASE_ENV: &str = "VIBE_POSTGRES_TEST_DATABASE_NAME";
const EXPECTED_MARKER_ENV: &str = "VIBE_POSTGRES_TEST_INSTANCE_MARKER";
const PRODUCTION_DATABASE_URL_ENVS: [&str; 5] = [
    "RD_OWNER_DATABASE_URL",
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
    unsafe_role_capabilities: [bool; 5],
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
            admit_owner_topology_admin(&expected_database, first).await?;

        Ok(Self {
            database_urls: urls
                .try_into()
                .map_err(|_| DedicatedPostgresTestDatabaseError::ExpectedIdentityMismatch)?,
            pools: pools
                .try_into()
                .map_err(|_| DedicatedPostgresTestDatabaseError::ExpectedIdentityMismatch)?,
            marker_identity: expected_marker,
            owner_topology_admin_pool,
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
}

async fn admit_owner_topology_admin(
    expected_database: &str,
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
    let role_is_exact: bool = sqlx::query_scalar(
        "SELECT session_user='vibe_test_owner_topology_admin'
           AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
           AND NOT rolreplication AND NOT rolbypassrls
           AND (SELECT count(*)=2 FROM pg_catalog.pg_auth_members membership
                JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
                WHERE membership.member=administrator.oid
                  AND granted.rolname IN ('replay_policy_catalog_owner','composer_owner')
                  AND membership.set_option)
           AND (SELECT count(*)=2 FROM pg_catalog.pg_auth_members membership
                WHERE membership.member=administrator.oid)
          FROM pg_catalog.pg_roles administrator
         WHERE administrator.rolname='vibe_test_owner_topology_admin' AND administrator.rolcanlogin",
    )
    .fetch_one(&pool)
    .await
    .map_err(|_| DedicatedPostgresTestDatabaseError::ReadOnlyPreflightUnavailable)?;
    if !role_is_exact {
        return Err(DedicatedPostgresTestDatabaseError::ExpectedIdentityMismatch);
    }
    Ok(pool)
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
    let rows = sqlx::query_as::<_, (String, String, String, String, bool, bool, bool, bool, bool)>(
        "SELECT marker.marker_identity, marker.database_name, marker.test_role, pg_catalog.pg_get_userbyid(class.relowner), role.rolsuper, role.rolcreatedb, role.rolcreaterole, pg_catalog.has_schema_privilege(current_user, 'vibe_test_admin', 'CREATE'), pg_catalog.has_table_privilege(current_user, 'vibe_test_admin.dedicated_postgres_test_instance_v1', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') FROM vibe_test_admin.dedicated_postgres_test_instance_v1 AS marker JOIN pg_catalog.pg_class AS class ON class.oid = 'vibe_test_admin.dedicated_postgres_test_instance_v1'::pg_catalog.regclass JOIN pg_catalog.pg_roles AS role ON role.rolname = current_user WHERE marker.test_role = current_user",
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
            unsafe_role_capabilities: [row.4, row.5, row.6, row.7, row.8],
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
            unsafe_role_capabilities: [false; 5],
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
}
