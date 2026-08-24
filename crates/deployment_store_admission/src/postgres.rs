use std::fmt::Debug;

use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{AssertSqlSafe, Connection, PgConnection, Row};
use thiserror::Error;
use url::Url;
use zeroize::Zeroizing;

/// TLS identity observed for the exact PostgreSQL session.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct PostgresTlsIdentity {
    pub(crate) enabled: bool,
    pub(crate) server_name: String,
    pub(crate) protocol: String,
    pub(crate) cipher: String,
    pub(crate) verification_mode: String,
    pub(crate) peer_certificate_identity: String,
    pub(crate) trust_policy_identity: String,
}

impl PostgresTlsIdentity {
    /// Creates the expected no-TLS identity used only by a pinned disposable local PostgreSQL test.
    #[must_use]
    pub(crate) fn disposable_plaintext(server_name: impl Into<String>) -> Self {
        Self {
            enabled: false,
            server_name: server_name.into(),
            protocol: "PLAINTEXT_DISPOSABLE_TEST_ONLY".to_string(),
            cipher: "NONE".to_string(),
            verification_mode: "DISPOSABLE_LOOPBACK_ONLY".to_string(),
            peer_certificate_identity: "UNAVAILABLE_DISPOSABLE_PLAINTEXT".to_string(),
            trust_policy_identity: "PINNED_DISPOSABLE_POSTGRES_V1".to_string(),
        }
    }

    /// Returns whether the measured session used TLS.
    #[must_use]
    pub const fn enabled(&self) -> bool {
        self.enabled
    }
}

/// Exact catalog surfaces directly measured through the credential lease.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct PostgresMeasurementSpec {
    schema_name: String,
    migration_relation: String,
    function_signatures: Vec<String>,
    acl_relations: Vec<String>,
}

impl PostgresMeasurementSpec {
    /// Creates a bounded direct-measurement specification.
    ///
    /// Names are resolved by PostgreSQL catalog functions and are never interpolated into SQL.
    ///
    /// # Errors
    ///
    /// Returns an error for empty or unbounded catalog selections.
    pub fn new(
        schema_name: impl Into<String>,
        migration_relation: impl Into<String>,
        function_signatures: Vec<String>,
        acl_relations: Vec<String>,
    ) -> Result<Self, PostgresMeasurementError> {
        let spec = Self {
            schema_name: schema_name.into(),
            migration_relation: migration_relation.into(),
            function_signatures,
            acl_relations,
        };

        if spec.schema_name.is_empty()
            || spec.migration_relation.is_empty()
            || spec.function_signatures.is_empty()
            || spec.acl_relations.is_empty()
            || spec.function_signatures.len() > 64
            || spec.acl_relations.len() > 64
            || spec
                .function_signatures
                .iter()
                .chain(&spec.acl_relations)
                .any(|value| value.is_empty() || value.len() > 512)
            || !canonical_identifier(&spec.schema_name)
            || quoted_qualified_name(&spec.migration_relation).is_none()
            || spec
                .acl_relations
                .iter()
                .any(|relation| quoted_qualified_name(relation).is_none())
        {
            return Err(PostgresMeasurementError::InvalidSpecification);
        }
        Ok(spec)
    }
}

/// Secret-bearing credential lease resolved from one opaque handle.
///
/// The URL is zeroized on drop, excluded from serialization, and redacted from `Debug`.
pub struct PostgresCredentialLease {
    handle_identity: String,
    audience: String,
    version: String,
    valid_through_epoch_ms: u64,
    database_url: Zeroizing<String>,
}

impl PostgresCredentialLease {
    /// Wraps a resolver-produced secret without exposing it to admission artifacts.
    ///
    /// # Errors
    ///
    /// Returns an error for an empty binding, lease, or URL.
    pub fn from_resolved_secret(
        handle_identity: impl Into<String>,
        audience: impl Into<String>,
        version: impl Into<String>,
        valid_through_epoch_ms: u64,
        database_url: String,
    ) -> Result<Self, PostgresMeasurementError> {
        let lease = Self {
            handle_identity: handle_identity.into(),
            audience: audience.into(),
            version: version.into(),
            valid_through_epoch_ms,
            database_url: Zeroizing::new(database_url),
        };

        if lease.handle_identity.is_empty()
            || lease.audience.is_empty()
            || lease.version.is_empty()
            || lease.valid_through_epoch_ms == 0
            || lease.database_url.is_empty()
            || !safe_opaque_identity(&lease.handle_identity)
            || !safe_opaque_identity(&lease.audience)
            || !safe_opaque_identity(&lease.version)
        {
            return Err(PostgresMeasurementError::InvalidCredentialLease);
        }
        Ok(lease)
    }

    pub(crate) fn database_url(&self) -> &str {
        self.database_url.as_str()
    }

    pub(crate) fn handle_identity(&self) -> &str {
        &self.handle_identity
    }

    pub(crate) fn audience(&self) -> &str {
        &self.audience
    }

    pub(crate) fn version(&self) -> &str {
        &self.version
    }

    pub(crate) const fn valid_through_epoch_ms(&self) -> u64 {
        self.valid_through_epoch_ms
    }
}

impl Debug for PostgresCredentialLease {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(PostgresCredentialLease))
            .field("handle_identity", &self.handle_identity)
            .field("audience", &self.audience)
            .field("version", &self.version)
            .field("valid_through_epoch_ms", &self.valid_through_epoch_ms)
            .field("database_url", &"[REDACTED]")
            .finish()
    }
}

/// Canonical direct measurement of one PostgreSQL target and its governed catalog surface.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct PostgresMeasurement {
    pub(crate) endpoint_identity: String,
    pub(crate) tls_identity: PostgresTlsIdentity,
    pub(crate) server_identity: String,
    pub(crate) database_identity: String,
    pub(crate) schema_identity: String,
    pub(crate) migration_identity: String,
    pub(crate) function_identity: String,
    pub(crate) role_identity: String,
    pub(crate) acl_identity: String,
}

impl PostgresMeasurement {
    /// Returns the directly observed endpoint identity without credentials.
    #[must_use]
    pub fn endpoint_identity(&self) -> &str {
        &self.endpoint_identity
    }

    /// Returns the direct server-system identity.
    #[must_use]
    pub fn server_identity(&self) -> &str {
        &self.server_identity
    }

    /// Returns the direct database name/OID identity.
    #[must_use]
    pub fn database_identity(&self) -> &str {
        &self.database_identity
    }

    /// Returns the exact session role fingerprint.
    #[must_use]
    pub fn role_identity(&self) -> &str {
        &self.role_identity
    }
}

/// Secret-free direct-measurement failure.
#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum PostgresMeasurementError {
    #[error("invalid PostgreSQL measurement specification")]
    InvalidSpecification,
    #[error("invalid PostgreSQL credential lease")]
    InvalidCredentialLease,
    #[error("PostgreSQL target URL is invalid")]
    InvalidTarget,
    #[error("PostgreSQL connection is unavailable")]
    ConnectionUnavailable,
    #[error("PostgreSQL read-only measurement transaction is unavailable")]
    TransactionUnavailable,
    #[error("PostgreSQL server/database/role identity query is unavailable")]
    IdentityQueryUnavailable,
    #[error("PostgreSQL server/database/role identity decoding is unavailable")]
    IdentityDecodeUnavailable,
    #[error("PostgreSQL TLS identity is unavailable")]
    TlsIdentityUnavailable,
    #[error("PostgreSQL schema identity is unavailable")]
    SchemaIdentityUnavailable,
    #[error("PostgreSQL migration identity is unavailable")]
    MigrationIdentityUnavailable,
    #[error("PostgreSQL function identity is unavailable")]
    FunctionIdentityUnavailable,
    #[error("PostgreSQL ACL identity is unavailable")]
    AclIdentityUnavailable,
    #[error("PostgreSQL catalog target is absent or ambiguous")]
    CatalogTargetMismatch,
}

/// Read-only direct PostgreSQL target measurer for a pinned disposable loopback authority.
#[derive(Clone, Copy, Debug, Default)]
pub struct PostgresDirectMeasurer;

impl PostgresDirectMeasurer {
    /// Connects with the resolved lease and measures the target in one read-only transaction.
    ///
    /// Non-loopback, non-test-database, and TLS targets fail closed. Authenticated production TLS
    /// remains unavailable until a peer-certificate and trust-policy measuring adapter exists. No
    /// DDL, role, credential, provider, or application mutation is performed.
    ///
    /// # Errors
    ///
    /// Returns a redacted failure when the connection or any exact catalog identity is unavailable.
    pub async fn measure(
        &self,
        lease: &PostgresCredentialLease,
        spec: &PostgresMeasurementSpec,
    ) -> Result<PostgresMeasurement, PostgresMeasurementError> {
        let target = parse_target(lease.database_url())?;
        let mut connection = PgConnection::connect(lease.database_url())
            .await
            .map_err(|_| PostgresMeasurementError::ConnectionUnavailable)?;
        let mut transaction = connection
            .begin()
            .await
            .map_err(|_| PostgresMeasurementError::TransactionUnavailable)?;
        sqlx::query("SET TRANSACTION READ ONLY")
            .execute(&mut *transaction)
            .await
            .map_err(|_| PostgresMeasurementError::TransactionUnavailable)?;

        let identity = sqlx::query(
            "SELECT (pg_catalog.pg_control_system()).system_identifier::text AS system_identifier, pg_catalog.current_setting('server_version_num')::text AS server_version, pg_catalog.inet_server_addr()::text AS server_address, pg_catalog.inet_server_port()::bigint AS server_port, pg_catalog.current_database()::text AS database_name, database.oid::bigint AS database_oid, current_user::text AS role_name, role.oid::bigint AS role_oid, role.rolsuper, role.rolinherit, role.rolcreaterole, role.rolcreatedb, role.rolcanlogin, role.rolreplication, role.rolbypassrls FROM pg_catalog.pg_database AS database JOIN pg_catalog.pg_roles AS role ON role.rolname = current_user WHERE database.datname = pg_catalog.current_database()",
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::IdentityQueryUnavailable)?;
        let server_version: String = identity
            .try_get("server_version")
            .map_err(|_| PostgresMeasurementError::IdentityDecodeUnavailable)?;
        let system_identifier: String = identity
            .try_get("system_identifier")
            .map_err(|_| PostgresMeasurementError::IdentityDecodeUnavailable)?;
        let database_name: String = identity
            .try_get("database_name")
            .map_err(|_| PostgresMeasurementError::IdentityDecodeUnavailable)?;
        let database_oid: i64 = identity
            .try_get("database_oid")
            .map_err(|_| PostgresMeasurementError::IdentityDecodeUnavailable)?;
        let server_address: String = identity
            .try_get("server_address")
            .map_err(|_| PostgresMeasurementError::IdentityDecodeUnavailable)?;
        let server_port: i64 = identity
            .try_get("server_port")
            .map_err(|_| PostgresMeasurementError::IdentityDecodeUnavailable)?;
        let role_record = (
            identity.try_get::<String, _>("role_name"),
            identity.try_get::<i64, _>("role_oid"),
            identity.try_get::<bool, _>("rolsuper"),
            identity.try_get::<bool, _>("rolinherit"),
            identity.try_get::<bool, _>("rolcreaterole"),
            identity.try_get::<bool, _>("rolcreatedb"),
            identity.try_get::<bool, _>("rolcanlogin"),
            identity.try_get::<bool, _>("rolreplication"),
            identity.try_get::<bool, _>("rolbypassrls"),
        );
        let role_record = match role_record {
            (Ok(a), Ok(b), Ok(c), Ok(d), Ok(e), Ok(f), Ok(g), Ok(h), Ok(i)) => {
                (a, b, c, d, e, f, g, h, i)
            }
            _ => return Err(PostgresMeasurementError::IdentityDecodeUnavailable),
        };
        let role_membership_rows = sqlx::query(
            "WITH RECURSIVE membership_path AS (SELECT membership.roleid, membership.member, membership.grantor, membership.admin_option, membership.inherit_option, membership.set_option, ARRAY[membership.member, membership.roleid] AS path, 1::bigint AS depth FROM pg_catalog.pg_auth_members AS membership JOIN pg_catalog.pg_roles AS session_role ON session_role.oid = membership.member WHERE session_role.rolname = current_user UNION ALL SELECT next.roleid, next.member, next.grantor, next.admin_option, next.inherit_option, next.set_option, prior.path || next.roleid, prior.depth + 1 FROM membership_path AS prior JOIN pg_catalog.pg_auth_members AS next ON next.member = prior.roleid WHERE prior.depth < 32 AND NOT next.roleid = ANY(prior.path)) SELECT pg_catalog.pg_get_userbyid(roleid)::text AS role_name, pg_catalog.pg_get_userbyid(member)::text AS member_name, pg_catalog.pg_get_userbyid(grantor)::text AS grantor_name, admin_option, inherit_option, set_option, depth FROM membership_path ORDER BY depth, role_name, member_name, grantor_name",
        )
        .fetch_all(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::IdentityQueryUnavailable)?;
        if role_membership_rows.len() > 256 {
            return Err(PostgresMeasurementError::CatalogTargetMismatch);
        }
        let role_membership_identity = rows_digest(
            &role_membership_rows,
            &[
                "role_name",
                "member_name",
                "grantor_name",
                "admin_option",
                "inherit_option",
                "set_option",
                "depth",
            ],
        )?;

        let tls = sqlx::query(
            "SELECT ssl, COALESCE(version, '')::text AS protocol, COALESCE(cipher, '')::text AS cipher FROM pg_catalog.pg_stat_ssl WHERE pid = pg_catalog.pg_backend_pid()",
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::TlsIdentityUnavailable)?;
        let tls_enabled: bool = tls
            .try_get("ssl")
            .map_err(|_| PostgresMeasurementError::TlsIdentityUnavailable)?;
        let protocol: String = tls
            .try_get("protocol")
            .map_err(|_| PostgresMeasurementError::TlsIdentityUnavailable)?;
        let cipher: String = tls
            .try_get("cipher")
            .map_err(|_| PostgresMeasurementError::TlsIdentityUnavailable)?;
        if tls_enabled || !protocol.is_empty() || !cipher.is_empty() {
            return Err(PostgresMeasurementError::TlsIdentityUnavailable);
        }
        let tls_identity = PostgresTlsIdentity::disposable_plaintext(&target.host);

        let schema_rows = sqlx::query(
            "SELECT namespace.oid::bigint AS oid, namespace.nspname::text AS name, pg_catalog.pg_get_userbyid(namespace.nspowner)::text AS owner, COALESCE(namespace.nspacl::text, 'DEFAULT') AS acl FROM pg_catalog.pg_namespace AS namespace WHERE namespace.nspname = $1",
        )
        .bind(&spec.schema_name)
        .fetch_all(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::SchemaIdentityUnavailable)?;
        if schema_rows.len() != 1 {
            return Err(PostgresMeasurementError::CatalogTargetMismatch);
        }
        let schema_identity = rows_digest(&schema_rows, &["oid", "name", "owner", "acl"])?;

        let migration_rows = sqlx::query(
            "SELECT class.oid::bigint AS relation_oid, namespace.nspname::text AS schema_name, class.relname::text AS relation_name, class.relkind::text AS relation_kind, pg_catalog.pg_get_userbyid(class.relowner)::text AS owner, attribute.attnum::bigint AS ordinal, attribute.attname::text AS column_name, pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)::text AS column_type, attribute.attnotnull, COALESCE(pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid), '')::text AS default_expression FROM pg_catalog.pg_class AS class JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = class.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped LEFT JOIN pg_catalog.pg_attrdef AS default_value ON default_value.adrelid = class.oid AND default_value.adnum = attribute.attnum WHERE class.oid = pg_catalog.to_regclass($1) ORDER BY attribute.attnum",
        )
        .bind(&spec.migration_relation)
        .fetch_all(&mut *transaction)
        .await
        .map_err(|_| PostgresMeasurementError::MigrationIdentityUnavailable)?;
        if migration_rows.is_empty() {
            return Err(PostgresMeasurementError::CatalogTargetMismatch);
        }
        let migration_definition_identity = rows_digest(
            &migration_rows,
            &[
                "relation_oid",
                "schema_name",
                "relation_name",
                "relation_kind",
                "owner",
                "ordinal",
                "column_name",
                "column_type",
                "attnotnull",
                "default_expression",
            ],
        )?;
        let migration_relation = quoted_qualified_name(&spec.migration_relation)
            .ok_or(PostgresMeasurementError::InvalidSpecification)?;
        let migration_content_query = format!(
            "SELECT pg_catalog.to_jsonb(migration_row)::text AS row_json FROM {migration_relation} AS migration_row ORDER BY pg_catalog.to_jsonb(migration_row)::text"
        );
        let migration_content_rows = sqlx::query(AssertSqlSafe(migration_content_query))
            .fetch_all(&mut *transaction)
            .await
            .map_err(|_| PostgresMeasurementError::MigrationIdentityUnavailable)?;

        if migration_content_rows.len() > 10_000 {
            return Err(PostgresMeasurementError::CatalogTargetMismatch);
        }
        let migration_content_identity = rows_digest(&migration_content_rows, &["row_json"])?;
        let migration_identity =
            digest_serializable(&(migration_definition_identity, migration_content_identity));

        let mut function_records = Vec::with_capacity(spec.function_signatures.len());
        for signature in &spec.function_signatures {
            let row = sqlx::query(
                "SELECT procedure.oid::bigint AS oid, pg_catalog.pg_get_function_identity_arguments(procedure.oid)::text AS arguments, pg_catalog.pg_get_userbyid(procedure.proowner)::text AS owner, procedure.prosecdef, procedure.provolatile::text AS volatility, COALESCE(procedure.proacl::text, 'DEFAULT') AS acl, pg_catalog.pg_get_functiondef(procedure.oid)::text AS definition FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = pg_catalog.to_regprocedure($1)",
            )
            .bind(signature)
            .fetch_all(&mut *transaction)
            .await
            .map_err(|_| PostgresMeasurementError::FunctionIdentityUnavailable)?;
            if row.len() != 1 {
                return Err(PostgresMeasurementError::CatalogTargetMismatch);
            }
            function_records.push(rows_digest(
                &row,
                &[
                    "oid",
                    "arguments",
                    "owner",
                    "prosecdef",
                    "volatility",
                    "acl",
                    "definition",
                ],
            )?);
        }
        let function_identity = digest_parts(&function_records);

        let mut acl_records = Vec::with_capacity(spec.acl_relations.len() + 1);
        acl_records.push(schema_identity.clone());

        for relation in &spec.acl_relations {
            let rows = sqlx::query(
                "SELECT class.oid::bigint AS oid, namespace.nspname::text AS schema_name, class.relname::text AS relation_name, pg_catalog.pg_get_userbyid(class.relowner)::text AS owner, COALESCE(class.relacl::text, 'DEFAULT') AS acl, class.relrowsecurity, class.relforcerowsecurity FROM pg_catalog.pg_class AS class JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace WHERE class.oid = pg_catalog.to_regclass($1)",
            )
            .bind(relation)
            .fetch_all(&mut *transaction)
            .await
            .map_err(|_| PostgresMeasurementError::AclIdentityUnavailable)?;
            if rows.len() != 1 {
                return Err(PostgresMeasurementError::CatalogTargetMismatch);
            }
            acl_records.push(rows_digest(
                &rows,
                &[
                    "oid",
                    "schema_name",
                    "relation_name",
                    "owner",
                    "acl",
                    "relrowsecurity",
                    "relforcerowsecurity",
                ],
            )?);
            let column_rows = sqlx::query(
                "SELECT attribute.attnum::bigint AS ordinal, attribute.attname::text AS column_name, COALESCE(attribute.attacl::text, 'DEFAULT') AS acl FROM pg_catalog.pg_attribute AS attribute WHERE attribute.attrelid = pg_catalog.to_regclass($1) AND attribute.attnum > 0 AND NOT attribute.attisdropped ORDER BY attribute.attnum",
            )
            .bind(relation)
            .fetch_all(&mut *transaction)
            .await
            .map_err(|_| PostgresMeasurementError::AclIdentityUnavailable)?;
            acl_records.push(rows_digest(
                &column_rows,
                &["ordinal", "column_name", "acl"],
            )?);
            let policy_rows = sqlx::query(
                "SELECT policy.polname::text AS policy_name, policy.polpermissive, policy.polcmd::text AS command, policy.polroles::text AS roles, COALESCE(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '')::text AS using_expression, COALESCE(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '')::text AS check_expression FROM pg_catalog.pg_policy AS policy WHERE policy.polrelid = pg_catalog.to_regclass($1) ORDER BY policy.polname",
            )
            .bind(relation)
            .fetch_all(&mut *transaction)
            .await
            .map_err(|_| PostgresMeasurementError::AclIdentityUnavailable)?;
            if policy_rows.len() > 256 {
                return Err(PostgresMeasurementError::CatalogTargetMismatch);
            }
            acl_records.push(rows_digest(
                &policy_rows,
                &[
                    "policy_name",
                    "polpermissive",
                    "command",
                    "roles",
                    "using_expression",
                    "check_expression",
                ],
            )?);
        }
        let acl_identity = digest_parts(&acl_records);

        transaction
            .rollback()
            .await
            .map_err(|_| PostgresMeasurementError::TransactionUnavailable)?;

        Ok(PostgresMeasurement {
            endpoint_identity: format!("postgresql://{}:{}", target.host, target.port),
            tls_identity,
            server_identity: format!(
                "postgres-system:{system_identifier}:server:{server_version}@{server_address}:{server_port}"
            ),
            database_identity: format!("postgres-database:{database_name}:{database_oid}"),
            schema_identity,
            migration_identity,
            function_identity,
            role_identity: digest_serializable(&(role_record, role_membership_identity)),
            acl_identity,
        })
    }
}

#[derive(Debug)]
struct ParsedTarget {
    host: String,
    port: u16,
}

fn parse_target(database_url: &str) -> Result<ParsedTarget, PostgresMeasurementError> {
    let parsed = Url::parse(database_url).map_err(|_| PostgresMeasurementError::InvalidTarget)?;
    let database = parsed.path().trim_start_matches('/');
    if !matches!(parsed.scheme(), "postgres" | "postgresql")
        || parsed.host_str().is_none()
        || parsed.username().is_empty()
        || !database.starts_with("vibe_test_")
    {
        return Err(PostgresMeasurementError::InvalidTarget);
    }
    let host = parsed
        .host_str()
        .ok_or(PostgresMeasurementError::InvalidTarget)?
        .trim_matches(['[', ']'])
        .to_ascii_lowercase();

    if !matches!(host.as_str(), "127.0.0.1" | "localhost" | "::1") {
        return Err(PostgresMeasurementError::InvalidTarget);
    }
    Ok(ParsedTarget {
        host,
        port: parsed.port().unwrap_or(5432),
    })
}

fn safe_opaque_identity(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn canonical_identifier(value: &str) -> bool {
    let mut bytes = value.bytes();
    bytes
        .next()
        .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_')
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$'))
}

fn quoted_qualified_name(value: &str) -> Option<String> {
    let mut parts = value.split('.');
    let schema = parts.next()?;
    let relation = parts.next()?;

    if parts.next().is_some() || !canonical_identifier(schema) || !canonical_identifier(relation) {
        return None;
    }
    Some(format!("\"{schema}\".\"{relation}\""))
}

fn rows_digest(
    rows: &[sqlx::postgres::PgRow],
    columns: &[&str],
) -> Result<String, PostgresMeasurementError> {
    let mut records = Vec::with_capacity(rows.len());
    for row in rows {
        let mut record = Vec::with_capacity(columns.len());
        for column in columns {
            let value = if let Ok(value) = row.try_get::<String, _>(*column) {
                value
            } else if let Ok(value) = row.try_get::<i64, _>(*column) {
                value.to_string()
            } else if let Ok(value) = row.try_get::<bool, _>(*column) {
                value.to_string()
            } else {
                return Err(PostgresMeasurementError::IdentityDecodeUnavailable);
            };
            record.push(((*column).to_string(), value));
        }
        records.push(record);
    }
    Ok(digest_serializable(&records))
}

fn digest_parts(parts: &[String]) -> String {
    digest_serializable(parts)
}

fn digest_serializable(value: &(impl Serialize + ?Sized)) -> String {
    let bytes = serde_json::to_vec(value).unwrap_or_default();
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(71);
    output.push_str("sha256:");

    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(output, "{byte:02x}");
    }
    output
}
