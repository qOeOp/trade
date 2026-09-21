//! One place where a PostgreSQL error becomes text.
//!
//! `sqlx::Error`'s `Display` prints PostgreSQL's primary message and nothing else. PostgreSQL puts
//! the class of the failure in `SQLSTATE`, and the part that says *which* rows, constraints or
//! transactions were involved in `DETAIL` and `HINT`. An Owner that stringifies with `to_string()`
//! keeps the first line and discards the rest before the error has left the function that raised
//! it, so no caller can recover it afterwards.
//!
//! That cost is not hypothetical. A deadlock in the ordered chain reached the Dashboard as
//! `Owner storage unavailable: error returned from database: deadlock detected at line 1130` -
//! true, and useless: PostgreSQL had already named both processes, both statements and the relation
//! whose tuple was contended, in the `DETAIL` this conversion dropped. Finding the cause took the
//! server's own log, which exists only because a separate change kept it.
//!
//! Callers keep their own error types; only the message passes through here.

use std::fmt::Write as _;

/// Renders a `sqlx` error keeping what PostgreSQL said past its first line.
///
/// A non-database error (a pool timeout, a decode failure) has no such structure and is rendered by
/// its own `Display`, unchanged.
pub(crate) fn database_message(error: &sqlx::Error) -> String {
    let sqlx::Error::Database(database) = error else {
        return error.to_string();
    };
    let mut text = database.message().to_owned();
    if let Some(code) = database.code() {
        let _ = write!(text, " [SQLSTATE {code}]");
    }

    if let Some(postgres) = database.try_downcast_ref::<sqlx::postgres::PgDatabaseError>() {
        if let Some(detail) = postgres.detail() {
            let _ = write!(text, "; detail: {detail}");
        }

        if let Some(hint) = postgres.hint() {
            let _ = write!(text, "; hint: {hint}");
        }
    }
    text
}

#[cfg(test)]
mod postgres_tests {
    use super::database_message;

    /// Proves the shared conversion keeps `SQLSTATE` and `DETAIL`, against a real server.
    ///
    /// A unique violation stands in for the deadlock that motivated this: both reach the client as a
    /// `PgDatabaseError` carrying `DETAIL`, and only one of the two can be produced on demand.
    ///
    /// The probe table is permanent and created inside a transaction that is always rolled back,
    /// rather than `TEMP`. No role in the chain can create temporary tables: the init scripts revoke
    /// `TEMPORARY` from `PUBLIC` on every database and grant it to nobody, so a `TEMP` probe fails
    /// with `42501` for the Owner's own role while passing for a superuser - which is the shape of a
    /// proof that only works because its fixture was given rights production withholds. PostgreSQL
    /// makes DDL transactional, so the rollback leaves the shared chain database untouched, and the
    /// test reads back afterwards to say so rather than asserting it.
    ///
    /// The control matters as much as the assertion. `sqlx`'s own `Display` is checked first to
    /// *not* carry the detail: without that, a future `sqlx` that included it would leave this test
    /// passing while proving nothing.
    ///
    /// What this does not prove: that any given Owner call reaches this function. That holds because
    /// the three `storage` helpers are the only `sqlx::Error` -> `String` conversions on those
    /// Owners' query paths, which is a property of the call sites, not of this test.
    #[tokio::test]
    #[ignore = "requires an admitted R&D Owner test database URL"]
    async fn owner_storage_errors_carry_the_detail_postgres_sent() {
        const PROBE: &str = "postgres_error_message_probe_v1";
        let url = std::env::var("RD_OWNER_TEST_DATABASE_URL")
            .expect("RD_OWNER_TEST_DATABASE_URL: this test asserts nothing without a server");
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .expect("connect");

        let mut probe = pool.begin().await.expect("begin the probe transaction");
        sqlx::query("CREATE TABLE postgres_error_message_probe_v1 (k TEXT PRIMARY KEY)")
            .execute(&mut *probe)
            .await
            .expect("create the probe table");
        sqlx::query("INSERT INTO postgres_error_message_probe_v1 (k) VALUES ('same')")
            .execute(&mut *probe)
            .await
            .expect("seed the probe table");
        let conflict =
            sqlx::query("INSERT INTO postgres_error_message_probe_v1 (k) VALUES ('same')")
                .execute(&mut *probe)
                .await
                .expect_err("the second insert must violate the primary key");
        // Before any assertion: an assertion that fires here would leave the table committed.
        probe.rollback().await.expect("roll the probe back");

        let left_behind: i64 =
            sqlx::query_scalar("SELECT count(*) FROM pg_class WHERE relname = $1")
                .bind(PROBE)
                .fetch_one(&pool)
                .await
                .expect("read back what the probe left");
        assert_eq!(
            left_behind, 0,
            "the probe left a table in the shared database"
        );

        let discarded = conflict.to_string();
        assert!(
            !discarded.contains("same"),
            "control failed: sqlx's own Display already names the conflicting key, so this test \
             could no longer tell the shared conversion apart from a plain to_string: {discarded}"
        );

        let reported = database_message(&conflict);
        assert!(
            reported.contains("SQLSTATE 23505"),
            "the unique violation's sqlstate was dropped: {reported}"
        );
        assert!(
            reported.contains("detail:"),
            "no detail carried: {reported}"
        );
        assert!(
            reported.contains("same"),
            "the detail did not name the conflicting key: {reported}"
        );
    }
}
