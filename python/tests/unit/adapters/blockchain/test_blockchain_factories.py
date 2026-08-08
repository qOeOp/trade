import pytest
from unit.adapters.example_modules import capture_data_tester_main
from unit.adapters.example_modules import load_example_module

from vibe_trader.adapters.blockchain import BlockchainDataClientConfig
from vibe_trader.adapters.blockchain import BlockchainDataClientFactory
from vibe_trader.common import Environment
from vibe_trader.live import LiveNode
from vibe_trader.model import Chain
from vibe_trader.model import DexType
from vibe_trader.model import TraderId


BLOCKCHAIN = "BLOCKCHAIN"
blockchain_data_tester = load_example_module("blockchain", "data_tester")


def test_blockchain_data_factory_exposes_python_name() -> None:
    assert BlockchainDataClientFactory().name() == BLOCKCHAIN


def test_live_node_builder_accepts_blockchain_data_factory() -> None:
    trader_id = TraderId.from_str("TESTER-001")

    node = (
        LiveNode.builder("BLOCKCHAIN-DATA-PYTEST-001", trader_id, Environment.LIVE)
        .add_data_client(
            "BLOCKCHAIN-Arbitrum",
            BlockchainDataClientFactory(),
            BlockchainDataClientConfig(
                chain=Chain.ARBITRUM(),
                dex_ids=[DexType.UNISWAP_V3],
                http_rpc_url="https://arb1.arbitrum.io/rpc",
            ),
        )
        .build()
    )

    assert node.trader_id == trader_id
    assert node.environment == Environment.LIVE


def test_blockchain_data_tester_builds_offline(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = capture_data_tester_main(monkeypatch, blockchain_data_tester, [])
    kwargs = captured["data_tester_kwargs"]

    assert isinstance(kwargs, dict)
    assert kwargs["request_instruments"] is True
    assert "exec_client_args" not in captured
    assert "run_called" not in captured
