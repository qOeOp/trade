"""Importable rc3 BacktestNode wrappers for the existing native R1 strategies."""

from dataclasses import dataclass
from pathlib import Path

from nautilus_trader.model import BarType, InstrumentId, Quantity, StrategyId
from nautilus_trader.trading import Strategy

from r1s_strategy import R1StagedStrategy
from brooks_confirmed_strategy import BrooksConfirmedStrategy
from gap_runner_strategy import GapRunnerStrategy
from failed_range_breakout_strategy import FailedRangeBreakoutStrategy
from structural_support_strategy import StructuralSupportStrategy
from replay_inputs import warmup_daily_bars
from retracement_strategy import RetracementStrategy
from strategy import R1Strategy
from tiered_retracement_strategy import TieredRetracementStrategy
from trendline_strategy import TrendlineBreakStrategy


STRATEGIES: dict[str, R1Strategy] = {}


@dataclass
class NodeStrategyConfig:
    coin: str
    instrument_id: str
    trade_size: str
    trade_start_ns: int
    input_start_ns: int
    strategy_id: str
    signal_variant: str
    daily_root: str | None = None
    risk_budget_fraction: float | None = None
    max_coin_notional_fraction: float = 0.05


class _NodeConfigured:
    """Bridge the importable Node config to each existing Strategy constructor."""

    def __new__(cls, config: NodeStrategyConfig):
        return Strategy.__new__(cls)

    def __init__(self, config: NodeStrategyConfig):
        instrument_id = InstrumentId.from_str(config.instrument_id)
        historical_daily_bars = (
            warmup_daily_bars(
                Path(config.daily_root),
                config.coin,
                instrument_id,
                config.input_start_ns,
            )
            if config.signal_variant in ("daily-pivot", "daily-pivot-outer-4h")
            else []
        )
        super().__init__(
            instrument_id,
            BarType.from_str(f"{instrument_id}-1-DAY-LAST-INTERNAL"),
            Quantity.from_str(config.trade_size),
            trade_start_ns=config.trade_start_ns,
            historical_daily_bars=historical_daily_bars,
            execution_bar_minutes=5,
            strategy_id=StrategyId(config.strategy_id),
            signal_variant=config.signal_variant,
            risk_budget_fraction=config.risk_budget_fraction,
            max_coin_notional_fraction=config.max_coin_notional_fraction,
        )
        STRATEGIES[config.instrument_id] = self


class NodeR1Strategy(_NodeConfigured, R1Strategy):
    pass


class NodeR1StagedStrategy(_NodeConfigured, R1StagedStrategy):
    pass


class NodeTieredRetracementStrategy(_NodeConfigured, TieredRetracementStrategy):
    pass


class NodeBrooksConfirmedStrategy(_NodeConfigured, BrooksConfirmedStrategy):
    pass


class NodeGapRunnerStrategy(_NodeConfigured, GapRunnerStrategy):
    pass


class NodeFailedRangeBreakoutStrategy(_NodeConfigured, FailedRangeBreakoutStrategy):
    pass


class NodeStructuralSupportStrategy(_NodeConfigured, StructuralSupportStrategy):
    pass


class NodeRetracementStrategy(_NodeConfigured, RetracementStrategy):
    pass


class NodeTrendlineBreakStrategy(_NodeConfigured, TrendlineBreakStrategy):
    pass
