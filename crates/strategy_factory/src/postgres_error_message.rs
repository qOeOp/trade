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
    /// A malformed `jsonb` cast stands in for the deadlock that motivated this: both reach the
    /// client as a `PgDatabaseError` carrying `DETAIL`, and only one of the two can be produced on
    /// demand.
    ///
    /// It is a cast of a literal because that needs no privilege beyond `CONNECT` and writes
    /// nothing by construction. Two earlier probes were rejected by the chain's own roles, each
    /// with `42501`: `CREATE TEMP TABLE` (the init scripts revoke `TEMPORARY` from `PUBLIC` on
    /// every database and grant it to no role), then a permanent table in a rolled-back
    /// transaction (`permission denied for schema public`). Both had passed locally against a
    /// superuser. A probe that needs no rights cannot be wrong about which rights the Owner has,
    /// and it leaves the shared chain database untouched without needing a cleanup step to be
    /// correct.
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
        // It connects without admission, so it installs the collector admission would have.
        vibe_testkit::postgres::collect_warnings_into_test_log()
            .expect("the ordered chain's warning collector should install");
        let url = std::env::var("RD_OWNER_TEST_DATABASE_URL")
            .expect("RD_OWNER_TEST_DATABASE_URL: this test asserts nothing without a server");
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .expect("connect");

        let malformed = sqlx::query("SELECT '{\"a\":1'::jsonb")
            .fetch_optional(&pool)
            .await
            .expect_err("a truncated json literal must not cast");

        let discarded = malformed.to_string();
        assert!(
            !discarded.contains("ended unexpectedly"),
            "control failed: sqlx's own Display already carries the detail, so this test could no \
             longer tell the shared conversion apart from a plain to_string: {discarded}"
        );

        let reported = database_message(&malformed);
        assert!(
            reported.contains("SQLSTATE 22P02"),
            "the invalid-input sqlstate was dropped: {reported}"
        );
        assert!(
            reported.contains("detail:"),
            "no detail carried: {reported}"
        );
        assert!(
            reported.contains("ended unexpectedly"),
            "the detail did not say what PostgreSQL said: {reported}"
        );
    }
}
