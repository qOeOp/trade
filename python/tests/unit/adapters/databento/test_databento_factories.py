from pathlib import Path

import pytest
from unit.adapters.example_modules import capture_data_tester_main
from unit.adapters.example_modules import load_example_module

from vibe_trader.adapters.databento import DatabentoDataClientFactory
from vibe_trader.adapters.databento import DatabentoLiveClientConfig
from vibe_trader.common import Environment
from vibe_trader.live import LiveNode
from vibe_trader.model import TraderId


DATABENTO = "DATABENTO"
SMOKE_API_KEY = "00000000000000000000000000000000"
databento_data_tester = load_example_module("databento", "data_tester")


def test_databento_data_factory_exposes_python_name() -> None:
    assert DatabentoDataClientFactory().name() == DATABENTO


def test_live_node_builder_accepts_databento_data_factory() -> None:
    trader_id = TraderId.from_str("TESTER-001")

    node = (
        LiveNode.builder("DATABENTO-DATA-PYTEST-001", trader_id, Environment.LIVE)
        .add_data_client(
            None,
            DatabentoDataClientFactory(),
            DatabentoLiveClientConfig(
                api_key=SMOKE_API_KEY,
                publishers_filepath=publishers_filepath(),
            ),
        )
        .build()
    )

    assert node.trader_id == trader_id
    assert node.environment == Environment.LIVE


def test_databento_live_config_stores_venue_dataset_map() -> None:
    config = DatabentoLiveClientConfig(
        api_key=SMOKE_API_KEY,
        publishers_filepath=publishers_filepath(),
        venue_dataset_map={"EQUS": "EQUS.PLUS"},
    )

    # No field getter is exposed, so the repr is the observable for the stored override.
    assert "EQUS" in repr(config)
    assert "EQUS.PLUS" in repr(config)


def test_databento_data_tester_builds_offline(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = capture_data_tester_main(monkeypatch, databento_data_tester, [])
    kwargs = captured["data_tester_kwargs"]

    assert isinstance(kwargs, dict)
    assert kwargs["subscribe_trades"] is True
    assert "exec_client_args" not in captured
    assert "run_called" not in captured


def publishers_filepath() -> Path:
    return Path(__file__).resolve().parents[5] / "crates/adapters/databento/publishers.json"
