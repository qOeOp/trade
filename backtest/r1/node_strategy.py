"""rc3 BacktestNode bridge for one verified external native strategy class."""

from dataclasses import dataclass
from pathlib import Path

from nautilus_trader.model import BarType, InstrumentId, Quantity, StrategyId
from nautilus_trader.trading import Strategy

from backtest.r1.strategy_loader import LoadedStrategy
from backtest.r1.replay_inputs import warmup_daily_bars


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
    daily_warmup: bool = False


class _NodeConfigured:
    """Adapt frozen native constructor and input configuration."""

    def __new__(cls, config: NodeStrategyConfig):
        return Strategy.__new__(cls)

    def __init__(self, config: NodeStrategyConfig):
        instrument_id = InstrumentId.from_str(config.instrument_id)
        super().__init__(
            instrument_id,
            BarType.from_str(f"{instrument_id}-1-DAY-LAST-INTERNAL"),
            Quantity.from_str(config.trade_size),
            trade_start_ns=config.trade_start_ns,
            historical_daily_bars=(
                warmup_daily_bars(Path(config.daily_root), config.coin, instrument_id, config.input_start_ns)
                if config.daily_warmup else []
            ),
            execution_bar_minutes=5,
            strategy_id=StrategyId(config.strategy_id),
            signal_variant=config.signal_variant,
            risk_budget_fraction=config.risk_budget_fraction,
            max_coin_notional_fraction=config.max_coin_notional_fraction,
        )
        STRATEGIES[config.instrument_id] = self


def register_strategy(loaded: LoadedStrategy) -> str:
    """Give ImportableStrategyConfig a path resolving inside this exact process."""
    name = f"NodeExternal_{loaded.source_sha256}_{loaded.entry_class}"
    wrapper = globals().get(name)
    if wrapper is None:
        wrapper = type(
            name,
            (_NodeConfigured, loaded.strategy_class),
            {"__module__": __name__},
        )
        globals()[name] = wrapper
    return f"{__name__}:{name}"
