"""Importable wrapper for the native BacktestNode R1 parity probe."""

from dataclasses import dataclass

from nautilus_trader.model import BarType
from nautilus_trader.model import InstrumentId
from nautilus_trader.model import Quantity
from nautilus_trader.model import StrategyId
from nautilus_trader.trading import Strategy

from tiered_retracement_strategy import TieredRetracementStrategy


@dataclass
class NodeTieredConfig:
    instrument_id: str
    trade_size: str
    trade_start_ns: int
    strategy_id: str
    signal_variant: str
    risk_budget_fraction: float = 0.0025
    max_coin_notional_fraction: float = 0.05


class NodeTieredStrategy(TieredRetracementStrategy):
    """Bridge rc3's importable config to the existing native Strategy constructor."""

    def __new__(cls, config: NodeTieredConfig):
        return Strategy.__new__(cls)

    def __init__(self, config: NodeTieredConfig):
        instrument_id = InstrumentId.from_str(config.instrument_id)
        super().__init__(
            instrument_id,
            BarType.from_str(f"{instrument_id}-1-DAY-LAST-INTERNAL"),
            Quantity.from_str(config.trade_size),
            trade_start_ns=config.trade_start_ns,
            historical_daily_bars=[],
            execution_bar_minutes=5,
            strategy_id=StrategyId(config.strategy_id),
            signal_variant=config.signal_variant,
            risk_budget_fraction=config.risk_budget_fraction,
            max_coin_notional_fraction=config.max_coin_notional_fraction,
        )
