import pytest
from unit.adapters.example_modules import capture_data_tester_main
from unit.adapters.example_modules import capture_exec_tester_main
from unit.adapters.example_modules import load_example_module

from vibe_trader.adapters.bybit import BybitDataClientConfig
from vibe_trader.adapters.bybit import BybitDataClientFactory
from vibe_trader.adapters.bybit import BybitEnvironment
from vibe_trader.adapters.bybit import BybitExecClientConfig
from vibe_trader.adapters.bybit import BybitExecutionClientFactory
from vibe_trader.adapters.bybit import BybitProductType
from vibe_trader.common import Environment
from vibe_trader.live import LiveNode
from vibe_trader.live import LiveRiskEngineConfig
from vibe_trader.model import AccountId
from vibe_trader.model import TraderId


BYBIT = "BYBIT"
SMOKE_API_KEY = "test_key"
SMOKE_API_SECRET = "test_secret"
bybit_data_tester = load_example_module("bybit", "data_tester")
bybit_exec_tester = load_example_module("bybit", "exec_tester")


def test_bybit_factories_expose_python_names() -> None:
    trader_id = TraderId.from_str("TESTER-001")
    account_id = AccountId.from_str("BYBIT-001")

    assert BybitDataClientFactory().name() == BYBIT
    assert BybitExecutionClientFactory(trader_id, account_id).name() == BYBIT


def test_live_node_builder_accepts_bybit_data_factory() -> None:
    trader_id = TraderId.from_str("TESTER-001")

    node = (
        LiveNode.builder("BYBIT-DATA-PYTEST-001", trader_id, Environment.LIVE)
        .add_data_client(
            None,
            BybitDataClientFactory(),
            BybitDataClientConfig(
                product_types=[BybitProductType.LINEAR],
                environment=BybitEnvironment.MAINNET,
            ),
        )
        .build()
    )

    assert node.trader_id == trader_id
    assert node.environment == Environment.LIVE


def test_live_node_builder_accepts_bybit_exec_factory() -> None:
    trader_id = TraderId.from_str("TESTER-001")
    account_id = AccountId.from_str("BYBIT-001")

    node = (
        LiveNode.builder("BYBIT-EXEC-PYTEST-001", trader_id, Environment.LIVE)
        .with_risk_engine_config(LiveRiskEngineConfig(bypass=True))
        .add_data_client(
            None,
            BybitDataClientFactory(),
            BybitDataClientConfig(
                product_types=[BybitProductType.LINEAR],
                environment=BybitEnvironment.MAINNET,
            ),
        )
        .add_exec_client(
            None,
            BybitExecutionClientFactory(trader_id, account_id),
            BybitExecClientConfig(
                product_types=[BybitProductType.LINEAR],
                environment=BybitEnvironment.MAINNET,
                api_key=SMOKE_API_KEY,
                api_secret=SMOKE_API_SECRET,
                account_id=account_id,
            ),
        )
        .build()
    )

    assert node.trader_id == trader_id
    assert node.environment == Environment.LIVE


def test_bybit_data_tester_builds_offline(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = capture_data_tester_main(monkeypatch, bybit_data_tester, [])
    kwargs = captured["data_tester_kwargs"]

    assert isinstance(kwargs, dict)
    assert kwargs["subscribe_funding_rates"] is True
    assert "run_called" not in captured


@pytest.mark.parametrize(
    ("extra_args", "expected_dry_run", "expected_limit_sells"),
    [
        ([], True, False),
        (["--live-orders", "--limit-sells"], False, True),
    ],
)
def test_bybit_exec_tester_gates_live_orders(
    monkeypatch: pytest.MonkeyPatch,
    extra_args: list[str],
    expected_dry_run: bool,
    expected_limit_sells: bool,
) -> None:
    captured = capture_exec_tester_main(monkeypatch, bybit_exec_tester, extra_args)
    kwargs = captured["exec_tester_kwargs"]

    assert isinstance(kwargs, dict)
    assert kwargs["dry_run"] is expected_dry_run
    assert kwargs["enable_limit_sells"] is expected_limit_sells
    assert "run_called" not in captured
