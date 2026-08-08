import math

from vibe_trader.backtest import BacktestEngine
from vibe_trader.backtest import BacktestEngineConfig
from vibe_trader.model import AccountType
from vibe_trader.model import Currency
from vibe_trader.model import Money
from vibe_trader.model import OmsType
from vibe_trader.model import Venue


def _float_maps_equal(a: dict[str, float], b: dict[str, float]) -> bool:
    """
    Return True if two str->float dicts are equal, treating NaN as equal to NaN.
    """
    if a.keys() != b.keys():
        return False
    for key in a:
        va, vb = a[key], b[key]
        if math.isnan(va) and math.isnan(vb):
            continue
        if va != vb:
            return False
    return True


def _nested_float_maps_equal(
    a: dict[str, dict[str, float]],
    b: dict[str, dict[str, float]],
) -> bool:
    """
    Return True if two str->str->float dicts are equal, treating NaN as equal to NaN.
    """
    if a.keys() != b.keys():
        return False
    return all(_float_maps_equal(a[key], b[key]) for key in a)


def _engine_with_account() -> BacktestEngine:
    engine = BacktestEngine(BacktestEngineConfig(bypass_logging=True))
    engine.add_venue(
        venue=Venue("SIM"),
        oms_type=OmsType.HEDGING,
        account_type=AccountType.MARGIN,
        base_currency=Currency.from_str("USD"),
        starting_balances=[Money(1_000_000.0, Currency.from_str("USD"))],
    )
    return engine


def test_engine_exposes_portfolio_statistics():
    engine = _engine_with_account()
    engine.run()
    stats = engine.portfolio.statistics()
    assert isinstance(stats.pnls, dict)
    assert isinstance(stats.returns, dict)
    assert isinstance(stats.general, dict)
    engine.dispose()


def test_engine_portfolio_statistics_equals_result():
    engine = _engine_with_account()
    engine.run()
    stats = engine.portfolio.statistics()
    result = engine.get_result()
    assert _nested_float_maps_equal(stats.pnls, result.stats_pnls)
    assert _float_maps_equal(stats.returns, result.stats_returns)
    assert _float_maps_equal(stats.general, result.stats_general)
    engine.dispose()
