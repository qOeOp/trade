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
//! list is refused rather than answered, which an owner connection would have hidden.

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
    use super::*;

    /// Who the credential authenticates as and whether it holds the schema and one table read. The
    /// table is named by oid: naming it by path would need the schema usage being measured.
    async fn reader_privileges(reader_url: &str) -> (String, bool, bool) {
        let pool = sqlx::PgPool::connect(reader_url)
            .await
            .expect("the scheduling acceptance reader connects");
        let privileges = sqlx::query_as(
            "SELECT current_user::text,
                    pg_catalog.has_schema_privilege('market_data_private', 'USAGE'),
                    pg_catalog.has_table_privilege(
                        (SELECT relation.oid
                           FROM pg_catalog.pg_class relation
                           JOIN pg_catalog.pg_namespace namespace
                             ON namespace.oid = relation.relnamespace
                          WHERE namespace.nspname = 'market_data_private'
                            AND relation.relname = 'pit_snapshot_facts_v1'),
                        'SELECT')",
        )
        .fetch_one(&pool)
        .await
        .expect("the reader's privileges");
        pool.close().await;
        privileges
    }

    /// The composed resolver's principal holds the scheduling reads exactly while it is composed.
    ///
    /// It authenticates as the test-only principal, which holds none of them before composing, holds
    /// them after, and holds none again after the revoke; the chain store is left as it was found.
    /// The reads themselves, each against its own grant, are Market Data's proof
    /// `the_sealed_acceptance_resolver_reads_under_exactly_its_grants`.
    #[tokio::test]
    #[ignore = "requires the canonical disposable R&D Owner PostgreSQL topology"]
    async fn the_composed_scheduling_resolver_holds_its_reads_only_while_composed() {
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let reader_url = std::env::var(ACCEPTANCE_SCHEDULING_READER_URL_ENV_V1).unwrap();
        let principal = ACCEPTANCE_SCHEDULING_PRINCIPAL_V1.to_owned();

        assert_eq!(
            reader_privileges(&reader_url).await,
            (principal.clone(), false, false)
        );
        let composed = composed_native_replay_scheduling_resolver(&test_database).await;
        assert_eq!(
            reader_privileges(&reader_url).await,
            (principal.clone(), true, true)
        );
        drop(composed.resolver());
        composed.revoke().await;
        assert_eq!(
            reader_privileges(&reader_url).await,
            (principal, false, false)
        );
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
