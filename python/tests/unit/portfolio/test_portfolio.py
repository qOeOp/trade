from __future__ import annotations

import importlib
import subprocess
import sys
import textwrap


def test_portfolio_public_module_exports_pyo3_classes():
    portfolio = importlib.import_module("vibe_trader.portfolio")
    native_portfolio = importlib.import_module("vibe_trader._libvibe.portfolio")

    assert portfolio.Portfolio is native_portfolio.Portfolio
    assert portfolio.PortfolioConfig is native_portfolio.PortfolioConfig
    assert portfolio.Portfolio.__name__ == "Portfolio"
    assert portfolio.PortfolioConfig.__name__ == "PortfolioConfig"


def test_portfolio_config_defaults_equity_curve_on_and_allows_opt_out():
    from vibe_trader.portfolio import PortfolioConfig

    default = PortfolioConfig()
    disabled = PortfolioConfig(equity_curve=False)

    assert default.equity_curve is True
    assert default.snapshot_interval_ms is None
    assert disabled.equity_curve is False


def test_portfolio_public_module_sets_runtime_module_names():
    script = textwrap.dedent(
        """
        import importlib

        portfolio = importlib.import_module("vibe_trader.portfolio")
        native_portfolio = importlib.import_module("vibe_trader._libvibe.portfolio")

        assert portfolio.Portfolio is native_portfolio.Portfolio
        assert portfolio.PortfolioConfig is native_portfolio.PortfolioConfig
        assert portfolio.Portfolio.__module__ == "vibe_trader.portfolio"
        assert portfolio.PortfolioConfig.__module__ == "vibe_trader.portfolio"
        """,
    )

    result = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        check=False,
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_live_reexports_portfolio_config_for_compatibility():
    from vibe_trader.backtest import BacktestEngineConfig
    from vibe_trader.live import LiveNodeConfig
    from vibe_trader.live import PortfolioConfig as LivePortfolioConfig
    from vibe_trader.portfolio import PortfolioConfig

    live_config = LiveNodeConfig(portfolio=LivePortfolioConfig())
    backtest_config = BacktestEngineConfig(portfolio=PortfolioConfig())

    assert LivePortfolioConfig is PortfolioConfig
    assert isinstance(live_config, LiveNodeConfig)
    assert isinstance(backtest_config.portfolio, PortfolioConfig)
