use sqlx::postgres::PgPoolOptions;
use vibe_data::owner::{
    instrument_economic_terms_postgres_v1::{
        InstrumentEconomicTermsPostgresErrorV1, InstrumentEconomicTermsPostgresOwnerV1,
    },
    instrument_economic_terms_v1::{
        InstrumentEconomicAccountApplicabilityV1, InstrumentEconomicDecimalV1,
        InstrumentEconomicTermsFactV1, InstrumentEconomicTermsInputV1,
        InstrumentEconomicTermsLocatorV1, InstrumentMarginMeaningV1,
    },
};

fn fact() -> InstrumentEconomicTermsFactV1 {
    InstrumentEconomicTermsFactV1::seal(InstrumentEconomicTermsInputV1 {
        schema_version: 1,
        instrument_identity: "BTCUSDT-PERP".into(),
        instrument_public_fact_digest: [1; 32],
        venue_identity: "BINANCE".into(),
        account_scope_identity: "RDQ-MARGIN".into(),
        account_applicability: InstrumentEconomicAccountApplicabilityV1::MarginAccount,
        valid_from_ns: 100,
        valid_until_ns_exclusive: 200,
        source_identity: "fee-schedule-1".into(),
        source_digest: [2; 32],
        provenance_digest: [3; 32],
        revision: 1,
        quote_currency: "USDT".into(),
        fee_currency: "USDT".into(),
        maker_fee: InstrumentEconomicDecimalV1 {
            mantissa: 2,
            scale: 4,
        },
        taker_fee: InstrumentEconomicDecimalV1 {
            mantissa: 4,
            scale: 4,
        },
        initial_margin: InstrumentEconomicDecimalV1 {
            mantissa: 1,
            scale: 1,
        },
        maintenance_margin: InstrumentEconomicDecimalV1 {
            mantissa: 5,
            scale: 2,
        },
        margin_meaning: InstrumentMarginMeaningV1::StandardNotionalRate,
    })
    .unwrap()
}

#[tokio::test]
async fn atomic_exact_replay_restart_tamper_and_acl_fail_closed() {
    let Ok(url) = std::env::var("INSTRUMENT_ECONOMIC_TERMS_TEST_DATABASE_URL") else {
        return;
    };
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&url)
        .await
        .unwrap();
    let owner = InstrumentEconomicTermsPostgresOwnerV1::install(pool.clone())
        .await
        .unwrap();
    let fact = fact();
    let first = owner.issue(&fact).await.unwrap();
    let replay = owner.issue(&fact).await.unwrap();
    assert_eq!(first.locator(), replay.locator());
    assert_eq!(
        first.fact().canonical_bytes(),
        replay.fact().canonical_bytes()
    );
    let restarted = InstrumentEconomicTermsPostgresOwnerV1::install(pool.clone())
        .await
        .unwrap();
    assert_eq!(
        restarted.resolve(first.locator()).await.unwrap().locator(),
        first.locator()
    );

    let wrong =
        InstrumentEconomicTermsLocatorV1::from_identities(first.locator().fact_identity(), [9; 32])
            .unwrap();
    assert_eq!(
        restarted.resolve(wrong).await,
        Err(InstrumentEconomicTermsPostgresErrorV1::UnknownLocator)
    );
    let mut conflicting = fact.input().clone();
    conflicting.maker_fee.mantissa = 3;
    assert_eq!(
        restarted
            .issue(&InstrumentEconomicTermsFactV1::seal(conflicting).unwrap())
            .await,
        Err(InstrumentEconomicTermsPostgresErrorV1::MeaningConflict)
    );

    sqlx::query("UPDATE instrument_owner_private.economic_terms_facts_v1 SET custody_digest=decode(repeat('00',32),'hex') WHERE fact_identity=$1")
        .bind(first.locator().fact_identity().as_slice()).execute(&pool).await.unwrap();
    assert_eq!(
        restarted.resolve(first.locator()).await,
        Err(InstrumentEconomicTermsPostgresErrorV1::CorruptReadback)
    );
    sqlx::query("GRANT SELECT ON instrument_owner_private.economic_terms_facts_v1 TO PUBLIC")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        restarted.resolve(first.locator()).await,
        Err(InstrumentEconomicTermsPostgresErrorV1::AclUnavailable)
    );
}
