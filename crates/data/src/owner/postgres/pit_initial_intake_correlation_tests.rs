//! An initial PIT intake claims its correlation once, and is read back by it.
//!
//! These drive the production intake over a real Owner store. They are the Market Data half of a
//! Research request's initial PIT lifecycle: R&D submits once per Intent under a correlation it
//! derives, and recovers a lost response by reading that correlation back rather than re-sending.

use sqlx::Row;

use super::pit_intake_member_count_tests::{Fixture, d};
use super::{
    PIT_INITIAL_INTAKE_CORRELATION_CONSTRAINT_V1,
    research_pit_terminal_v1::resolve_research_pit_terminal_by_correlation_v1,
};
use crate::owner::{
    pit_market_snapshot_intake_v1::{
        PitMarketSnapshotDispositionV1, PitMarketSnapshotIntakeErrorV1, PitMarketSnapshotIntakeV1,
    },
    research_pit_terminal_v1::{ResearchPitIntakeTerminalV1, ResearchPitTerminalReadErrorV1},
    source_binding::BindingDigest,
};

/// Reads one correlation back in a transaction of its own, as R&D does in its own.
async fn read_back(
    fixture: &Fixture,
    correlation: BindingDigest,
) -> Result<Option<ResearchPitIntakeTerminalV1>, ResearchPitTerminalReadErrorV1> {
    let mut transaction = fixture.owner().pool().begin().await.unwrap();
    let read = resolve_research_pit_terminal_by_correlation_v1(&mut transaction, correlation).await;
    transaction.rollback().await.unwrap();
    read
}

/// One initial intake per correlation, recoverable by it, and nothing else under it.
///
/// - Before any intake, the correlation reads back as `None`.
/// - The intake's terminal reads back byte for byte, with the requester the request carried, and
///   R&D's stored submission sealed over the terminal's Instrument Master digest reproduces the
///   request identity and digest the terminal reports.
/// - Re-sending the same submission rejoins the same terminal and writes nothing.
/// - A different submission under the same correlation is refused by name as
///   `CorrelationAlreadyCommitted`, and writes nothing; the primary-key constraint that decides it
///   is the one the mapping names.
/// - Two different submissions racing on one correlation converge: exactly one commits, the other
///   is refused by name, and the correlation reads back as the committed one.
/// - `None` means never committed and nothing else: a read that cannot run, and a correlation row
///   whose snapshot was requested under another correlation, are errors.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
#[allow(clippy::too_many_lines)]
async fn postgres_an_initial_intake_claims_its_correlation_once_and_reads_back_by_it() {
    let fixture = Fixture::install().await;
    fixture.admit_instrument("AAPL", d(81)).await;
    let (universe, locator) = fixture.universe(100, &[0, 1, 1], &[("AAPL", "AAPL")]).await;

    // The mapping names the constraint the store actually created, as the store reports it.
    let constraints: Vec<(String, String)> = sqlx::query(
        "SELECT conname::text, contype::text FROM pg_catalog.pg_constraint WHERE conrelid = pg_catalog.to_regclass('market_data_private.pit_initial_intake_correlations_v1') ORDER BY 1",
    )
    .fetch_all(fixture.owner().pool())
    .await
    .unwrap()
    .iter()
    .map(|row| (row.get(0), row.get(1)))
    .collect();
    assert!(
        constraints.contains(&(
            PIT_INITIAL_INTAKE_CORRELATION_CONSTRAINT_V1.to_owned(),
            "p".to_owned()
        )),
        "the correlation is the table's primary key, under the name the mapping uses: {constraints:?}"
    );

    let correlation = d(221);
    assert_eq!(read_back(&fixture, correlation).await, Ok(None));

    let submission = fixture.request(221, &universe);
    let terminal = fixture
        .intake
        .submit(submission.clone(), locator)
        .await
        .expect("the first intake under a correlation commits");
    assert_eq!(
        terminal.disposition(),
        PitMarketSnapshotDispositionV1::Available
    );
    assert_eq!(terminal.correlation_identity(), correlation);

    let recovered = read_back(&fixture, correlation)
        .await
        .expect("the store answers")
        .expect("the committed intake reads back by its correlation");
    assert_eq!(recovered.terminal(), &terminal);
    assert_eq!(
        recovered.requester_identity(),
        submission.requester_identity
    );
    let resealed = submission
        .clone()
        .into_request(terminal.instrument_master_digest());
    assert_eq!(
        resealed.claimed_request_identity,
        terminal.request_identity()
    );
    assert_eq!(resealed.claimed_request_digest, terminal.request_digest());

    // Re-sending the stored submission rejoins, and writes nothing.
    let settled = fixture.store().await;
    assert_eq!(
        fixture.intake.submit(submission.clone(), locator).await,
        Ok(terminal.clone())
    );
    assert_eq!(fixture.store().await, settled, "a rejoin writes nothing");

    // A different request under the same correlation is refused by name, and writes nothing.
    let mut other = submission.clone();
    other.scope_digest = d(99);
    assert_eq!(
        fixture.intake.submit(other, locator).await,
        Err(PitMarketSnapshotIntakeErrorV1::CorrelationAlreadyCommitted)
    );
    assert_eq!(fixture.store().await, settled, "the refusal writes nothing");
    assert_eq!(
        read_back(&fixture, correlation).await,
        Ok(Some(recovered.clone())),
        "the correlation still reads back as the first intake"
    );

    // Two different submissions racing on a fresh correlation converge on one.
    let racing = |scope: u8| {
        let mut submission = fixture.request(222, &universe);
        submission.scope_digest = d(scope);
        submission
    };
    let (left, right) = tokio::join!(
        fixture.intake.submit(racing(1), locator),
        fixture.intake.submit(racing(2), locator)
    );
    let committed = match (left, right) {
        (Ok(terminal), Err(PitMarketSnapshotIntakeErrorV1::CorrelationAlreadyCommitted))
        | (Err(PitMarketSnapshotIntakeErrorV1::CorrelationAlreadyCommitted), Ok(terminal)) => {
            terminal
        }
        outcome => panic!("exactly one racing submission commits: {outcome:?}"),
    };
    assert_eq!(
        read_back(&fixture, d(222))
            .await
            .unwrap()
            .expect("the race's winner reads back")
            .terminal(),
        &committed
    );

    // A read that cannot run is an error, never "never committed".
    let mut aborted = fixture.owner().pool().begin().await.unwrap();
    assert!(
        sqlx::query("SELECT 1/0")
            .execute(&mut *aborted)
            .await
            .is_err()
    );
    assert_eq!(
        resolve_research_pit_terminal_by_correlation_v1(&mut aborted, correlation).await,
        Err(ResearchPitTerminalReadErrorV1::StoreUnavailable)
    );
    aborted.rollback().await.unwrap();

    // A correlation row naming a snapshot requested under another correlation does not verify.
    let mut tamper = fixture.owner().pool().begin().await.unwrap();
    sqlx::query("UPDATE market_data_private.pit_initial_intake_correlations_v1 SET correlation_identity=$1 WHERE correlation_identity=$2")
        .bind(d(223).as_bytes().as_slice())
        .bind(correlation.as_bytes().as_slice())
        .execute(&mut *tamper)
        .await
        .unwrap();
    assert_eq!(
        resolve_research_pit_terminal_by_correlation_v1(&mut tamper, d(223)).await,
        Err(ResearchPitTerminalReadErrorV1::StoreUnavailable)
    );
    tamper.rollback().await.unwrap();
}
