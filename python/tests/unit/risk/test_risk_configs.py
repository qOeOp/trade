from decimal import Decimal

import pytest

from vibe_trader.risk import RiskEngineConfig


def test_risk_engine_config_defaults():
    config = RiskEngineConfig()

    assert config.bypass is False
    assert config.debug is False
    assert config.max_order_submit_rate == "100/00:00:01"
    assert config.max_order_modify_rate == "100/00:00:01"
    assert config.max_notional_per_order == {}


def test_risk_engine_config_explicit():
    config = RiskEngineConfig(
        bypass=True,
        max_order_submit_rate="250/00:00:05",
        max_order_modify_rate="50/00:01:00",
        max_notional_per_order={"ETHUSDT.BINANCE": "100000.50"},
        debug=True,
    )

    assert config.bypass is True
    assert config.debug is True
    assert config.max_order_submit_rate == "250/00:00:05"
    assert config.max_order_modify_rate == "50/00:01:00"
    assert config.max_notional_per_order == {"ETHUSDT.BINANCE": "100000.50"}


def test_risk_engine_config_round_trips_hours_component():
    config = RiskEngineConfig(
        max_order_submit_rate="5/01:30:45",
        max_order_modify_rate="10/02:00:00",
    )

    assert config.max_order_submit_rate == "5/01:30:45"
    assert config.max_order_modify_rate == "10/02:00:00"


def test_risk_engine_config_accepts_int_notional_values():
    config = RiskEngineConfig(max_notional_per_order={"ETHUSDT.BINANCE": 100_000})

    assert config.max_notional_per_order == {"ETHUSDT.BINANCE": "100000"}


def test_risk_engine_config_accepts_decimal_notional_values():
    config = RiskEngineConfig(max_notional_per_order={"ETHUSDT.BINANCE": Decimal("2500.75")})

    assert config.max_notional_per_order == {"ETHUSDT.BINANCE": "2500.75"}


@pytest.mark.parametrize(
    "value",
    [
        "bad-rate",  # no slash
        "100/00:00",  # missing segment
        "100/aa:00:01",  # non-numeric interval component
        "abc/00:00:01",  # non-numeric limit
        "100/00:00:01:00",  # trailing segment
    ],
)
def test_risk_engine_config_rejects_malformed_rate_limit(value):
    with pytest.raises(ValueError, match="max_order_submit_rate"):
        RiskEngineConfig(max_order_submit_rate=value)


def test_risk_engine_config_rejects_malformed_modify_rate():
    with pytest.raises(ValueError, match="max_order_modify_rate"):
        RiskEngineConfig(max_order_modify_rate="bad-rate")


def test_risk_engine_config_rejects_zero_rate_limit_values():
    with pytest.raises(ValueError, match="Invalid limit"):
        RiskEngineConfig(max_order_submit_rate="0/00:00:01")

    with pytest.raises(ValueError, match="Invalid interval_ns"):
        RiskEngineConfig(max_order_modify_rate="100/00:00:00")


def test_risk_engine_config_rejects_invalid_instrument_id():
    with pytest.raises(ValueError, match="max_notional_per_order"):
        RiskEngineConfig(max_notional_per_order={"INVALID": "1000"})


def test_risk_engine_config_rejects_invalid_notional():
    with pytest.raises(ValueError, match="max_notional_per_order"):
        RiskEngineConfig(max_notional_per_order={"ETHUSDT.BINANCE": "not-a-number"})


@pytest.mark.parametrize("value", ["0", "-1"])
def test_risk_engine_config_rejects_non_positive_notional(value):
    with pytest.raises(ValueError, match="max_notional_per_order"):
        RiskEngineConfig(max_notional_per_order={"ETHUSDT.BINANCE": value})


def test_risk_engine_config_rejects_unsupported_args():
    with pytest.raises(TypeError, match="qsize"):
        RiskEngineConfig(qsize=25_000)


def test_risk_engine_config_repr():
    config = RiskEngineConfig(bypass=True, debug=True)

    repr_str = repr(config)

    assert "RiskEngineConfig" in repr_str
    assert "bypass: true" in repr_str
    assert "debug: true" in repr_str
