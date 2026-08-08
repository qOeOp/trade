import pytest

from vibe_trader.execution import ExecutionEngineConfig
from vibe_trader.execution import OrderEmulatorConfig
from vibe_trader.model import ClientId


def test_execution_engine_config_defaults():
    config = ExecutionEngineConfig()
    assert config.load_cache is True
    assert config.manage_own_order_books is False
    assert config.snapshot_orders is False
    assert config.snapshot_positions is False
    assert config.snapshot_positions_interval_secs is None
    assert config.allow_overfills is False
    assert config.purge_from_database is False
    assert config.debug is False


def test_execution_engine_config_with_overrides():
    client_id = ClientId("EXEC-001")
    config = ExecutionEngineConfig(
        load_cache=False,
        manage_own_order_books=True,
        snapshot_orders=True,
        snapshot_positions=True,
        snapshot_positions_interval_secs=5.0,
        allow_overfills=True,
        external_clients=[client_id],
        purge_closed_orders_interval_mins=1,
        purge_closed_orders_buffer_mins=2,
        purge_closed_positions_interval_mins=3,
        purge_closed_positions_buffer_mins=4,
        purge_account_events_interval_mins=5,
        purge_account_events_lookback_mins=6,
        purge_from_database=True,
        debug=True,
    )
    assert config.load_cache is False
    assert config.manage_own_order_books is True
    assert config.snapshot_orders is True
    assert config.snapshot_positions is True
    assert config.snapshot_positions_interval_secs == 5.0
    assert config.allow_overfills is True
    assert config.external_clients == [client_id]
    assert config.purge_closed_orders_interval_mins == 1
    assert config.purge_closed_orders_buffer_mins == 2
    assert config.purge_closed_positions_interval_mins == 3
    assert config.purge_closed_positions_buffer_mins == 4
    assert config.purge_account_events_interval_mins == 5
    assert config.purge_account_events_lookback_mins == 6
    assert config.purge_from_database is True
    assert config.debug is True


@pytest.mark.parametrize(
    "kwargs",
    [
        {"snapshot_positions_interval_secs": 0.0},
        {"snapshot_positions_interval_secs": -1.0},
        {"purge_closed_orders_interval_mins": 0},
        {"purge_closed_positions_interval_mins": 0},
        {"purge_account_events_interval_mins": 0},
    ],
)
def test_execution_engine_config_rejects_non_positive_intervals(kwargs):
    with pytest.raises(ValueError, match="must be a positive"):
        ExecutionEngineConfig(**kwargs)


def test_execution_engine_config_repr():
    config = ExecutionEngineConfig()
    assert "ExecutionEngineConfig" in repr(config)


def test_order_emulator_config_defaults():
    config = OrderEmulatorConfig()
    assert config.debug is False


def test_order_emulator_config_debug_enabled():
    config = OrderEmulatorConfig(debug=True)
    assert config.debug is True


def test_order_emulator_config_repr():
    config = OrderEmulatorConfig()
    assert "OrderEmulatorConfig" in repr(config)
