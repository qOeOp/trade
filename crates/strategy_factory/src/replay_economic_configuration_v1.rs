//! Compatibility facade for the R&D-owned canonical Replay economic configuration.

pub use vibe_rd_exploratory_replay_custody::replay_economic_configuration_v1::*;

#[cfg(any(test, feature = "sealed-develop-composer-acceptance"))]
pub(crate) fn economic_fixture() -> ReplayEconomicConfigurationInputV1 {
    ReplayEconomicConfigurationInputV1 {
        schema_version: 1,
        input_kind: ReplayInputKindV1::EventOnly,
        venue_census: ReplayVenueCensusV1::SingleVenue,
        venue_identity: "SIM".into(),
        oms_type: ReplayOmsTypeV1::Netting,
        account_type: ReplayAccountTypeV1::Margin,
        book_type: ReplayBookTypeV1::L1Mbp,
        starting_balance: ReplayFixedDecimalV1 {
            mantissa: 100_000,
            scale: 0,
        },
        starting_balance_currency: "USDT".into(),
        common_quote_currency: "USDT".into(),
        default_leverage: ReplayFixedDecimalV1 {
            mantissa: 10,
            scale: 0,
        },
        instrument_leverage: ReplayFixedDecimalV1 {
            mantissa: 10,
            scale: 0,
        },
        instrument_terms: InstrumentEconomicTermsBindingV1 {
            instrument_identity: "ETHUSDT-PERP".into(),
            quote_currency: "USDT".into(),
            instrument_fact_digest: [1; 32],
            instrument_receipt_digest: [2; 32],
            maker_fee: ReplayFixedDecimalV1 {
                mantissa: 2,
                scale: 4,
            },
            taker_fee: ReplayFixedDecimalV1 {
                mantissa: 4,
                scale: 4,
            },
            initial_margin: ReplayFixedDecimalV1 {
                mantissa: 1,
                scale: 1,
            },
            maintenance_margin: ReplayFixedDecimalV1 {
                mantissa: 5,
                scale: 2,
            },
        },
        margin_model: ReplayMarginModelV1::SealedInstrumentTerms,
        modules: ReplaySimulationModulesV1::None,
        fill_model: ReplayFillModelV1::DeterministicFullFill,
        fee_model: ReplayFeeModelV1::SealedInstrumentTerms,
        latency_model: DisabledEconomicModelV1::Disabled,
        slippage_model: DisabledEconomicModelV1::Disabled,
        capacity_model: DisabledEconomicModelV1::Disabled,
        routing: false,
        reject_stop_orders: true,
        support_gtd_orders: true,
        support_contingent_orders: true,
        use_position_ids: true,
        use_random_ids: false,
        use_reduce_only: true,
        use_message_queue: true,
        use_market_order_acks: false,
        bar_execution: false,
        trade_on_close: false,
        bar_adaptive_high_low_ordering: false,
        trade_execution: false,
        liquidity_consumption: false,
        allow_cash_borrowing: false,
        frozen_account: false,
        queue_position: false,
        oto_full_trigger: false,
        price_protection_points: 0,
        settlement_prices: ReplaySettlementPricesV1::None,
        liquidation_policy: ReplayLiquidationPolicyV1::Disabled,
        liquidation_cancel_open_orders: true,
    }
}
