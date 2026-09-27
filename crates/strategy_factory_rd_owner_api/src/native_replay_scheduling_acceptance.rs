//! The Native Replay scheduling resolver the ordered chain composes in place of the one Store
//! Admission opens.
//!
//! Production opens its resolver through Store Admission (`B3`), which no deployment admits yet. An
//! acceptance entry that executes a Replay composes this one instead and passes it where production
//! passes its own: the `market_data` port of the execution service, or the `native_replay_scheduling`
//! field of the API state. No production startup code branches on it.
//!
//! It reads as `vibe_test_role_market_data_reader`, a test-only principal the chain creates with no
//! Market Data privilege. Composing grants that principal exactly the scheduling reads, as the
//! Market Data owner; [`AcceptanceSchedulingResolverV1::revoke`] takes them back, because the chain
//! store is shared and is not reset between the entries of one component. A read outside the granted
//! list is refused rather than answered, which an owner connection would have hidden. The reads go
//! through `market_data_admitted_read`, so the grants hold nothing on `market_data_private`, and the
//! Market Data Owner's own custody checks, which require that schema to have no grantee but its
//! owner, still pass while the resolver is composed.

use std::sync::Arc;

use vibe_data::owner::{
    grant_native_replay_scheduling_acceptance_reads_v1,
    native_replay_scheduling_resolver_for_sealed_acceptance_v1,
    native_replay_scheduling_v1::NativeReplaySchedulingResolverV1,
    revoke_native_replay_scheduling_acceptance_reads_v1,
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

/// The principal the resolver reads as.
pub(crate) const ACCEPTANCE_SCHEDULING_PRINCIPAL_V1: &str = "vibe_test_role_market_data_reader";

/// Where the chain exports that principal's credential.
const ACCEPTANCE_SCHEDULING_READER_URL_ENV_V1: &str = "MARKET_DATA_READER_TEST_DATABASE_URL";

/// A composed resolver and the grants it holds until [`Self::revoke`].
pub(crate) struct AcceptanceSchedulingResolverV1 {
    resolver: Arc<dyn NativeReplaySchedulingResolverV1>,
    market_data_owner_url: String,
}

impl AcceptanceSchedulingResolverV1 {
    /// The resolver, for the execution service or the API state.
    pub(crate) fn resolver(&self) -> Arc<dyn NativeReplaySchedulingResolverV1> {
        Arc::clone(&self.resolver)
    }

    /// Takes back every grant [`composed_native_replay_scheduling_resolver`] made.
    pub(crate) async fn revoke(self) {
        revoke_native_replay_scheduling_acceptance_reads_v1(
            &self.market_data_owner_url,
            ACCEPTANCE_SCHEDULING_PRINCIPAL_V1,
        )
        .await
        .expect("the scheduling acceptance reads are revoked");
    }
}

/// Grants the test-only principal exactly the scheduling reads and opens the resolver that reads as
/// it, over the same disposable database the canonical topology admitted.
pub(crate) async fn composed_native_replay_scheduling_resolver(
    test_database: &CanonicalOwnerPostgresTestDatabaseV1,
) -> AcceptanceSchedulingResolverV1 {
    let reader_url = std::env::var(ACCEPTANCE_SCHEDULING_READER_URL_ENV_V1)
        .expect("the chain exports the scheduling acceptance reader's credential");
    let market_data_owner_url = test_database
        .database_url(CanonicalOwnerTestRoleV1::MarketDataOwner)
        .to_owned();
    assert_eq!(
        user_and_database(&reader_url).0,
        ACCEPTANCE_SCHEDULING_PRINCIPAL_V1,
        "the scheduling acceptance reader is the test-only principal"
    );
    assert_eq!(
        user_and_database(&reader_url).1,
        user_and_database(&market_data_owner_url).1,
        "the reader reads the database the canonical topology admitted"
    );
    // An entry that failed before its revoke leaves its grants in the shared store. Taking them back
    // first, which is a no-op when there are none, makes what this compose holds exactly what it
    // grants below rather than whatever an earlier entry left.
    revoke_native_replay_scheduling_acceptance_reads_v1(
        &market_data_owner_url,
        ACCEPTANCE_SCHEDULING_PRINCIPAL_V1,
    )
    .await
    .expect("any scheduling acceptance reads an earlier entry left are revoked");
    grant_native_replay_scheduling_acceptance_reads_v1(
        &market_data_owner_url,
        ACCEPTANCE_SCHEDULING_PRINCIPAL_V1,
    )
    .await
    .expect("the scheduling acceptance reads are granted");
    let resolver = native_replay_scheduling_resolver_for_sealed_acceptance_v1(&reader_url)
        .expect("the sealed acceptance scheduling resolver opens");
    AcceptanceSchedulingResolverV1 {
        resolver,
        market_data_owner_url,
    }
}

/// The user and database a `postgresql://user:password@host:port/database` URL names.
fn user_and_database(url: &str) -> (&str, &str) {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    let user = rest.split([':', '@']).next().unwrap_or_default();
    let database = rest
        .rsplit_once('/')
        .map_or("", |(_, database)| database)
        .split('?')
        .next()
        .unwrap_or_default();
    (user, database)
}

#[cfg(test)]
mod tests {
    use sqlx::postgres::PgPoolOptions;
    use vibe_data::owner::replay_market_facts_v2::ReplayCompositionOwnerV1;
    use vibe_postgres_connect::{PgPoolOptionsExt, PostgresTls};

    use super::*;

    /// What the reader holds, as the reader sees it.
    #[derive(Clone, Debug, Eq, PartialEq)]
    struct ReaderPrivilegesV1 {
        /// Who the credential authenticates as.
        user: String,
        /// `USAGE` on the schema the scheduling reads go through.
        admitted_read_usage: bool,
        /// `EXECUTE` on one wrapper a scheduling read calls.
        wrapper_execute: bool,
        /// `USAGE` on the Owner's private schema.
        private_usage: bool,
        /// Roles other than its owner holding any privilege on the private schema, counted as the
        /// Owner's time-zone custody check counts them.
        private_grantees: i64,
    }

    /// The wrapper is named by oid: naming it by path would need the schema usage being measured.
    async fn reader_privileges(reader_url: &str) -> ReaderPrivilegesV1 {
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect_url(reader_url, PostgresTls::Disabled)
            .await
            .expect("the scheduling acceptance reader connects");
        let (user, admitted_read_usage, wrapper_execute, private_usage, private_grantees) =
            sqlx::query_as(
                "SELECT current_user::text,
                        pg_catalog.has_schema_privilege('market_data_admitted_read', 'USAGE'),
                        pg_catalog.has_function_privilege(
                            (SELECT procedure.oid
                               FROM pg_catalog.pg_proc procedure
                               JOIN pg_catalog.pg_namespace namespace
                                 ON namespace.oid = procedure.pronamespace
                              WHERE namespace.nspname = 'market_data_admitted_read'
                                AND procedure.proname = 'resolve_pit_snapshot_v1'),
                            'EXECUTE'),
                        pg_catalog.has_schema_privilege('market_data_private', 'USAGE'),
                        (SELECT count(*)
                           FROM pg_catalog.pg_namespace namespace,
                                pg_catalog.aclexplode(COALESCE(namespace.nspacl,
                                    pg_catalog.acldefault('n', namespace.nspowner))) acl
                          WHERE namespace.nspname = 'market_data_private'
                            AND acl.grantee <> namespace.nspowner)",
            )
            .fetch_one(&pool)
            .await
            .expect("the reader's privileges");
        pool.close().await;
        ReaderPrivilegesV1 {
            user,
            admitted_read_usage,
            wrapper_execute,
            private_usage,
            private_grantees,
        }
    }

    /// The composed resolver's principal holds the scheduling reads exactly while it is composed,
    /// and those reads reach nothing private.
    ///
    /// It authenticates as the test-only principal, which holds none of them before composing, holds
    /// them after, and holds none again after the revoke; the chain store is left as it was found.
    /// Throughout, it has no `USAGE` on `market_data_private` and that schema has no grantee but its
    /// owner. The positive control is the Market Data Owner's own connection, whose time-zone
    /// custody check refuses a private grantee: it connects while the resolver is composed. The
    /// reads themselves, each against its own grant, are Market Data's proof
    /// `the_sealed_acceptance_resolver_reads_under_exactly_its_grants`.
    #[tokio::test]
    #[ignore = "requires the canonical disposable R&D Owner PostgreSQL topology"]
    async fn the_composed_scheduling_resolver_holds_its_reads_only_while_composed() {
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let reader_url = std::env::var(ACCEPTANCE_SCHEDULING_READER_URL_ENV_V1).unwrap();
        let uncomposed = ReaderPrivilegesV1 {
            user: ACCEPTANCE_SCHEDULING_PRINCIPAL_V1.to_owned(),
            admitted_read_usage: false,
            wrapper_execute: false,
            private_usage: false,
            private_grantees: 0,
        };

        assert_eq!(reader_privileges(&reader_url).await, uncomposed);
        let composed = composed_native_replay_scheduling_resolver(&test_database).await;
        assert_eq!(
            reader_privileges(&reader_url).await,
            ReaderPrivilegesV1 {
                admitted_read_usage: true,
                wrapper_execute: true,
                ..uncomposed.clone()
            }
        );
        let owner = ReplayCompositionOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::MarketDataOwner),
            test_database.database_url(CanonicalOwnerTestRoleV1::MarketDataReader),
        )
        .await;
        assert!(
            owner.is_ok(),
            "the Market Data Owner's custody checks pass while the resolver is composed"
        );
        drop(owner);
        drop(composed.resolver());
        composed.revoke().await;
        assert_eq!(reader_privileges(&reader_url).await, uncomposed);
    }

    #[rstest::rstest]
    fn a_credential_names_its_user_and_database() {
        assert_eq!(
            user_and_database(
                "postgresql://vibe_test_role_market_data_reader:secret@127.0.0.1:5432/vibe_test_rd"
            ),
            ("vibe_test_role_market_data_reader", "vibe_test_rd")
        );
        assert_eq!(
            user_and_database("postgres://owner@localhost/vibe_test_x?sslmode=disable"),
            ("owner", "vibe_test_x")
        );
    }
}
