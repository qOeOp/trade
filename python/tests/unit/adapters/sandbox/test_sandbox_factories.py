import pytest
from unit.adapters.example_modules import capture_exec_tester_main
from unit.adapters.example_modules import load_example_module

from vibe_trader.adapters.sandbox import SandboxExecutionClientConfig
from vibe_trader.adapters.sandbox import SandboxExecutionClientFactory
from vibe_trader.common import Environment
from vibe_trader.execution import ProbabilityPriceFeeModel
from vibe_trader.live import LiveNode
from vibe_trader.live import LiveRiskEngineConfig
from vibe_trader.model import AccountId
from vibe_trader.model import Currency
from vibe_trader.model import Money
from vibe_trader.model import TraderId
from vibe_trader.model import Venue


SANDBOX = "SANDBOX"
sandbox_exec_tester = load_example_module("sandbox", "exec_tester")


def test_sandbox_execution_factory_exposes_python_name() -> None:
    assert SandboxExecutionClientFactory().name() == SANDBOX


def test_live_node_builder_accepts_sandbox_simulated_exec_factory() -> None:
    trader_id = TraderId.from_str("TESTER-001")

    node = (
        LiveNode.builder("SANDBOX-EXEC-PYTEST-001", trader_id, Environment.SANDBOX)
        .with_risk_engine_config(LiveRiskEngineConfig(bypass=True))
        .add_simulated_exec_client(
            None,
            SandboxExecutionClientFactory(),
            SandboxExecutionClientConfig(
                venue=Venue.from_str(SANDBOX),
                starting_balances=[Money(100000.0, Currency.from_str("USD"))],
                trader_id=trader_id,
                account_id=AccountId.from_str("SANDBOX-001"),
            ),
        )
        .build()
    )

    assert node.trader_id == trader_id
    assert node.environment == Environment.SANDBOX


def test_live_node_builder_accepts_sandbox_probability_price_fee_model() -> None:
    trader_id = TraderId.from_str("TESTER-001")

    node = (
        LiveNode.builder("SANDBOX-EXEC-PYTEST-002", trader_id, Environment.SANDBOX)
        .with_risk_engine_config(LiveRiskEngineConfig(bypass=True))
        .add_simulated_exec_client(
            None,
            SandboxExecutionClientFactory(),
            SandboxExecutionClientConfig(
                venue=Venue.from_str(SANDBOX),
                starting_balances=[Money(100000.0, Currency.from_str("USD"))],
                trader_id=trader_id,
                account_id=AccountId.from_str("SANDBOX-001"),
                fee_model=ProbabilityPriceFeeModel(),
            ),
        )
        .build()
    )

    assert node.trader_id == trader_id
    assert node.environment == Environment.SANDBOX


def test_sandbox_config_exposes_fee_model_property() -> None:
    config = SandboxExecutionClientConfig(
        venue=Venue.from_str(SANDBOX),
        starting_balances=[Money(100000.0, Currency.from_str("USD"))],
        fee_model=ProbabilityPriceFeeModel(),
    )

    assert isinstance(config.fee_model, ProbabilityPriceFeeModel)


@pytest.mark.parametrize(
    ("extra_args", "expected_dry_run", "expected_limit_sells"),
    [
        ([], True, False),
        (["--live-orders", "--limit-sells"], False, True),
    ],
)
def test_sandbox_exec_tester_uses_simulated_exec_and_gates_live_orders(
    monkeypatch: pytest.MonkeyPatch,
    extra_args: list[str],
    expected_dry_run: bool,
    expected_limit_sells: bool,
) -> None:
    captured = capture_exec_tester_main(monkeypatch, sandbox_exec_tester, extra_args)
    kwargs = captured["exec_tester_kwargs"]

    assert isinstance(kwargs, dict)
    assert kwargs["dry_run"] is expected_dry_run
    assert kwargs["enable_limit_sells"] is expected_limit_sells
    assert "simulated_exec_client_args" in captured
    assert "exec_client_args" not in captured
    assert "run_called" not in captured
