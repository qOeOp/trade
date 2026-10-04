from vibe_trading.backtest import BacktestNode
from vibe_trading.common import LogLevel
from vibe_trading.config import BacktestDataConfig
from vibe_trading.config import BacktestEngineConfig
from vibe_trading.config import BacktestRunConfig
from vibe_trading.config import BacktestVenueConfig
from vibe_trading.config import LoggerConfig
from vibe_trading.execution import FixedFeeModel
from vibe_trading.execution import MakerTakerFeeModel
from vibe_trading.execution import PerContractFeeModel
from vibe_trading.execution import ProbabilisticFillModel
from vibe_trading.execution import StaticLatencyModel
from vibe_trading.model import AccountType
from vibe_trading.model import BookType
from vibe_trading.model import InstrumentId
from vibe_trading.model import Money
from vibe_trading.model import OmsType
from vibe_trading.model import TraderId


if __name__ == "__main__":
    # Configure backtest engine
    engine_config = BacktestEngineConfig(
        trader_id=TraderId("BACKTESTER-001"),
        logging=LoggerConfig(stdout_level=LogLevel.INFO),
    )

    fill_model = ProbabilisticFillModel(
        prob_fill_on_limit=0.95,
        prob_slippage=0.05,
        random_seed=42,
    )

    latency_model = StaticLatencyModel(
        base_latency_nanos=5_000_000,
        insert_latency_nanos=2_000_000,
        update_latency_nanos=3_000_000,
        cancel_latency_nanos=1_000_000,
    )

    maker_taker_fee_model = MakerTakerFeeModel()
    fixed_fee_model = FixedFeeModel(
        commission=Money.from_str("1.50 USD"),
        charge_commission_once=True,
    )
    per_contract_fee_model = PerContractFeeModel(
        commission=Money.from_str("0.01 USD"),
    )
    recurring_fixed_fee_model = FixedFeeModel(
        commission=Money.from_str("2.00 USD"),
        charge_commission_once=False,
    )

    # Create venue configs with different models
    venue_config1 = BacktestVenueConfig(
        name="NASDAQ",
        oms_type=OmsType.NETTING,
        account_type=AccountType.CASH,
        starting_balances=["1000000 USD"],
        book_type=BookType.L1_MBP,
        fill_model=fill_model,
        latency_model=latency_model,
        fee_model=maker_taker_fee_model,
    )

    venue_config2 = BacktestVenueConfig(
        name="NYSE",
        oms_type=OmsType.NETTING,
        account_type=AccountType.CASH,
        starting_balances=["1000000 USD"],
        book_type=BookType.L1_MBP,
        fill_model=fill_model,
        latency_model=latency_model,
        fee_model=fixed_fee_model,
    )

    venue_config3 = BacktestVenueConfig(
        name="CME",
        oms_type=OmsType.NETTING,
        account_type=AccountType.MARGIN,
        starting_balances=["1000000 USD"],
        book_type=BookType.L1_MBP,
        fill_model=fill_model,
        latency_model=latency_model,
        fee_model=per_contract_fee_model,
    )

    # Create venue config with custom fixed fee model
    venue_config4 = BacktestVenueConfig(
        name="BATS",
        oms_type=OmsType.NETTING,
        account_type=AccountType.CASH,
        starting_balances=["1000000 USD"],
        book_type=BookType.L1_MBP,
        fill_model=fill_model,
        latency_model=latency_model,
        fee_model=recurring_fixed_fee_model,
    )

    # Create data config (this is just a placeholder - you would need actual data)
    data_config = BacktestDataConfig(
        data_type="QuoteTick",
        catalog_path="./data",
        instrument_id=InstrumentId.from_str("AAPL.NASDAQ"),
    )

    # Create BacktestRunConfig
    run_config = BacktestRunConfig(
        engine=engine_config,
        venues=[venue_config1, venue_config2, venue_config3, venue_config4],
        data=[data_config],
    )

    # Create and run the backtest node
    node = BacktestNode([run_config])

    # Note: This example won't actually run without proper data
    # results = node.run()

    print("Example of passing model objects to BacktestVenueConfig")
    print(f"Venue 1 fee model: {venue_config1.fee_model}")
    print(f"Venue 2 fee model: {venue_config2.fee_model}")
    print(f"Venue 3 fee model: {venue_config3.fee_model}")
    print(f"Venue 4 fee model: {venue_config4.fee_model}")
    print(f"Fill model: {venue_config1.fill_model}")
    print(f"Latency model: {venue_config1.latency_model}")
