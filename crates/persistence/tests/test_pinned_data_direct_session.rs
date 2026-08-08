#![cfg(feature = "high-precision")]

use rstest::rstest;
use vibe_core::UnixNanos;
use vibe_model::data::{Data, HasTsInit, QuoteTick};
use vibe_persistence::backend::session::DataBackendSession;
use vibe_testkit::common::ensure_histdata_eurusd_quotes_parquet;

#[rstest]
fn test_pinned_quotes_through_direct_session() {
    let filepath = ensure_histdata_eurusd_quotes_parquet();
    let mut session = DataBackendSession::new(1_000);
    session
        .add_file::<QuoteTick>(
            "quotes",
            filepath
                .to_str()
                .expect("test data path must be valid UTF-8"),
            Some("SELECT * FROM quotes ORDER BY ts_init LIMIT 20000"),
            None,
        )
        .unwrap();
    let data: Vec<Data> = session.get_query_result().collect();

    assert_eq!(data.len(), 20_000);
    assert!(data.iter().all(|item| matches!(item, Data::Quote(_))));
    assert!(
        data.windows(2)
            .all(|pair| pair[0].ts_init() <= pair[1].ts_init())
    );
    assert_eq!(
        data.first().expect("query must return quotes").ts_init(),
        UnixNanos::from(1_577_898_010_447_000_000),
    );
    assert_eq!(
        data.last().expect("query must return quotes").ts_init(),
        UnixNanos::from(1_577_934_143_122_000_000),
    );
}
