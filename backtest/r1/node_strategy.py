"""Importable rc3 BacktestNode wrappers for the existing native R1 strategies."""

from dataclasses import dataclass
from pathlib import Path

from nautilus_trader.model import BarType, InstrumentId, Quantity, StrategyId
from nautilus_trader.trading import Strategy

from research.r1_variants.r1s_strategy import R1StagedStrategy
from research.r1_variants.brooks_confirmed_strategy import BrooksConfirmedStrategy
from research.r1_variants.gap_runner_strategy import GapRunnerStrategy
from research.r1_variants.failed_range_breakout_strategy import FailedRangeBreakoutStrategy
from research.r1_variants.structural_support_strategy import StructuralSupportStrategy
from backtest.r1.replay_inputs import warmup_daily_bars
from research.r1_variants.retracement_strategy import RetracementStrategy
from research.r1_variants.strategy import R1Strategy as LegacyR1Strategy
from research.r1_variants.tiered_retracement_strategy import TieredRetracementStrategy
from research.r1_variants.trendline_strategy import TrendlineBreakStrategy
from strategies.r1 import R1Strategy


STRATEGIES: dict[str, Strategy] = {}


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


class NodeR1Strategy(_NodeConfigured, LegacyR1Strategy):
    pass


class NodeH19aStrategy(_NodeConfigured, R1Strategy):
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
