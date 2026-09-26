//! Probe only, never merged: what the shared chain database's current frontier admits.

use std::fmt::Write as _;

use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

use crate::owner::{
    check_research_instrument_scope_v1, postgres::MarketDataOwnerPostgres,
    research_instrument_scope_v1::ResearchInstrumentScopeV1, resolve_research_pit_references_v1,
};

fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut out, byte| {
        let _ = write!(out, "{byte:02x}");
        out
    })
}

#[tokio::test]
#[ignore = "requires the ordered Owner PostgreSQL chain"]
async fn frontier_probe_reports_current_members() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner topology");
    let owner_url = database.database_url(CanonicalOwnerTestRoleV1::MarketDataOwner);
    let owner = MarketDataOwnerPostgres::connect(owner_url).await.unwrap();
    let pool = owner.pool();
    let mut report = String::from("FRONTIER PROBE\n");

    let frontiers: Vec<(Vec<u8>, Option<i64>)> = sqlx::query_as(
        "SELECT eligible_frontier, admission_sequence FROM market_data_private.historical_membership_frontiers_v1 ORDER BY admission_sequence NULLS FIRST",
    )
    .fetch_all(pool)
    .await
    .unwrap();

    for (frontier, sequence) in &frontiers {
        let members: Vec<(Vec<u8>, Vec<u8>, i64)> = sqlx::query_as(
            "SELECT member_key, instrument, count(*) FROM market_data_private.historical_membership_facts_v1 WHERE eligible_frontier=$1 GROUP BY 1,2 ORDER BY 1,2",
        )
        .bind(frontier.as_slice())
        .fetch_all(pool)
        .await
        .unwrap();
        let members: Vec<String> = members
            .iter()
            .map(|(key, instrument, facts)| {
                format!(
                    "{}=>{}x{facts}",
                    String::from_utf8_lossy(key),
                    String::from_utf8_lossy(instrument)
                )
            })
            .collect();
        let _ = writeln!(
            report,
            "frontier {} seq {sequence:?} members {members:?}",
            hex(frontier)
        );
    }
    let current: Option<Vec<u8>> =
        sqlx::query_scalar("SELECT market_data_private.current_eligible_frontier_v1()")
            .fetch_one(pool)
            .await
            .unwrap();
    let _ = writeln!(report, "current {:?}", current.as_deref().map(hex));

    let identities: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT canonical_identity FROM market_data_private.instrument_master_facts_v1 ORDER BY 1",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    let _ = writeln!(report, "instrument master identities {identities:?}");

    let mut candidates: Vec<String> = match current.as_deref() {
        Some(frontier) => sqlx::query_scalar(
            "SELECT DISTINCT convert_from(instrument,'UTF8') FROM market_data_private.historical_membership_facts_v1 WHERE eligible_frontier=$1 ORDER BY 1",
        )
        .bind(frontier)
        .fetch_all(pool)
        .await
        .unwrap(),
        None => Vec::new(),
    };
    candidates.extend(identities.iter().cloned());
    candidates.sort();
    candidates.dedup();

    for identity in candidates {
        let Ok(scope) = ResearchInstrumentScopeV1::from_identities(vec![identity.clone()]) else {
            let _ = writeln!(report, "{identity}: scope refused");
            continue;
        };
        let mut transaction = pool.begin().await.unwrap();
        let check = check_research_instrument_scope_v1(&mut transaction, &scope).await;
        let references = resolve_research_pit_references_v1(&mut transaction, &scope).await;
        transaction.rollback().await.unwrap();
        let standing = check.map(|check| {
            check
                .rows()
                .iter()
                .map(crate::owner::research_pit_references_v1::ResearchInstrumentCheckRowV1::admissibility)
                .collect::<Vec<_>>()
        });
        let _ = writeln!(
            report,
            "{identity}: check {standing:?} references {:?}",
            references.map(|resolved| hex(resolved.eligible_instrument_frontier().as_bytes()))
        );
    }
    panic!("{report}");
}
