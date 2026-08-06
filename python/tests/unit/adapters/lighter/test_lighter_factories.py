import sys

import pytest
from unit.adapters.example_modules import load_example_module

from vibe_trader.adapters.lighter import LIGHTER
from vibe_trader.adapters.lighter import LighterDataClientConfig
from vibe_trader.adapters.lighter import LighterDataClientFactory
from vibe_trader.adapters.lighter import LighterEnvironment
from vibe_trader.adapters.lighter import LighterExecClientConfig
from vibe_trader.adapters.lighter import LighterExecutionClientFactory
from vibe_trader.common import Environment
from vibe_trader.live import LiveNode
from vibe_trader.live import LiveRiskEngineConfig
from vibe_trader.model import AccountId
from vibe_trader.model import TraderId


lighter_exec_tester = load_example_module("lighter", "exec_tester")


def test_lighter_factories_expose_python_names() -> None:
    data_factory = LighterDataClientFactory()
    exec_factory = LighterExecutionClientFactory()

    assert data_factory.name() == LIGHTER
    assert exec_factory.name() == LIGHTER


def test_live_node_builder_accepts_lighter_data_factory() -> None:
    trader_id = TraderId.from_str("TESTER-001")

    node = (
        LiveNode.builder("LIGHTER-DATA-PYTEST-001", trader_id, Environment.LIVE)
        .add_data_client(
            None,
            LighterDataClientFactory(),
            LighterDataClientConfig(environment=LighterEnvironment.TESTNET),
        )
        .build()
    )

    assert node.trader_id == trader_id
    assert node.environment == Environment.LIVE


def test_live_node_builder_accepts_lighter_exec_factory() -> None:
    trader_id = TraderId.from_str("TESTER-001")
    account_id = AccountId.from_str("LIGHTER-001")

    node = (
        LiveNode.builder("LIGHTER-EXEC-PYTEST-001", trader_id, Environment.LIVE)
        .with_risk_engine_config(LiveRiskEngineConfig(bypass=True))
        .add_data_client(
            None,
            LighterDataClientFactory(),
            LighterDataClientConfig(environment=LighterEnvironment.TESTNET),
        )
        .add_exec_client(
            None,
            LighterExecutionClientFactory(),
            LighterExecClientConfig(
                trader_id=trader_id,
                account_id=account_id,
                environment=LighterEnvironment.TESTNET,
            ),
        )
        .build()
    )

    assert node.trader_id == trader_id
    assert node.environment == Environment.LIVE


@pytest.mark.parametrize(
    ("extra_args", "expected_buys", "expected_dry_run"),
    [
        ([], False, True),
        (["--live-orders"], True, False),
    ],
)
def test_lighter_exec_tester_limit_sells_stay_disabled(
    monkeypatch: pytest.MonkeyPatch,
    extra_args: list[str],
    expected_buys: bool,
    expected_dry_run: bool,
) -> None:
    captured: dict[str, object] = {}

    class CapturingExecTesterConfig:
        def __init__(self, **kwargs: object) -> None:
            captured["exec_tester_kwargs"] = kwargs

    class CapturingNode:
        def add_builtin_strategy(self, type_name: str, config: object) -> None:
            captured["strategy_type_name"] = type_name
            captured["strategy_config"] = config

    class CapturingBuilder:
        def with_reconciliation(self, reconciliation: bool) -> "CapturingBuilder":
            captured["reconciliation"] = reconciliation
            return self

        def with_exec_engine_config(self, config: object) -> "CapturingBuilder":
            captured["exec_engine_config"] = config
            return self

        def with_risk_engine_config(self, config: LiveRiskEngineConfig) -> "CapturingBuilder":
            captured["risk_engine_config"] = config
            return self

        def add_data_client(self, *args: object) -> "CapturingBuilder":
            captured["data_client_args"] = args
            return self

        def add_exec_client(self, *args: object) -> "CapturingBuilder":
            captured["exec_client_args"] = args
            return self

        def build(self) -> CapturingNode:
            return CapturingNode()

    class CapturingLiveNode:
        @staticmethod
        def builder(name: str, trader_id: TraderId, environment: Environment) -> CapturingBuilder:
            captured["builder_args"] = (name, trader_id, environment)
            return CapturingBuilder()

    monkeypatch.setattr(sys, "argv", ["exec_tester.py", *extra_args])
    monkeypatch.setattr(lighter_exec_tester, "ExecTesterConfig", CapturingExecTesterConfig)
    monkeypatch.setattr(lighter_exec_tester, "LiveNode", CapturingLiveNode)

    lighter_exec_tester.main()

    assert captured["strategy_type_name"] == "ExecTester"
    kwargs = captured["exec_tester_kwargs"]
    assert isinstance(kwargs, dict)
    assert kwargs["enable_limit_buys"] is expected_buys
    assert kwargs["enable_limit_sells"] is False
    assert kwargs["dry_run"] is expected_dry_run
