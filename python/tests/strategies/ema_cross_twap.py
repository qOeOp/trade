"""
EMA cross strategy routing orders through the TWAP execution algorithm.

Identical to ``EMACross`` except entries are submitted with an
``exec_algorithm_id`` so the engine routes them to a registered TWAP
execution algorithm for slicing.

"""

from __future__ import annotations

from strategies.ema_cross import EMACross
from strategies.ema_cross import EMACrossConfig

from vibe_trader.core import UUID4
from vibe_trader.model import ClientOrderId
from vibe_trader.model import ContingencyType
from vibe_trader.model import ExecAlgorithmId
from vibe_trader.model import MarketOrder
from vibe_trader.model import OrderSide
from vibe_trader.model import TimeInForce


class EMACrossTWAPConfig(EMACrossConfig):
    """
    Configuration for the EMA cross TWAP test strategy.
    """

    def __new__(cls, *args, **kwargs):
        kwargs.pop("exec_algorithm_id", None)
        kwargs.pop("twap_horizon_secs", None)
        kwargs.pop("twap_interval_secs", None)
        return super().__new__(cls, *args, **kwargs)

    def __init__(
        self,
        instrument_id: str,
        bar_type: str,
        trade_size: str,
        fast_ema_period: int = 10,
        slow_ema_period: int = 20,
        exec_algorithm_id: str = "TWAP",
        twap_horizon_secs: float = 30.0,
        twap_interval_secs: float = 3.0,
        **kwargs,
    ):
        super().__init__(
            instrument_id=instrument_id,
            bar_type=bar_type,
            trade_size=trade_size,
            fast_ema_period=fast_ema_period,
            slow_ema_period=slow_ema_period,
            **kwargs,
        )
        self.exec_algorithm_id = exec_algorithm_id
        self.twap_horizon_secs = twap_horizon_secs
        self.twap_interval_secs = twap_interval_secs


class EMACrossTWAP(EMACross):
    """
    EMA cross test strategy submitting entries via the TWAP execution algorithm.
    """

    def __init__(self, config: EMACrossTWAPConfig):
        super().__init__(config)
        self._exec_algorithm_id = ExecAlgorithmId(config.exec_algorithm_id)
        self._exec_algorithm_params = {
            "horizon_secs": str(config.twap_horizon_secs),
            "interval_secs": str(config.twap_interval_secs),
        }

    def _submit_market(self, side: OrderSide):
        self._order_count += 1
        client_order_id = ClientOrderId(f"{self.strategy_id}-{self._order_count}")
        order = MarketOrder(
            trader_id=self.trader_id,
            strategy_id=self.strategy_id,
            instrument_id=self._instrument_id,
            client_order_id=client_order_id,
            order_side=side,
            quantity=self._trade_size,
            init_id=UUID4(),
            ts_init=self.clock.timestamp_ns(),
            time_in_force=TimeInForce.GTC,
            reduce_only=False,
            quote_quantity=False,
            contingency_type=ContingencyType.NO_CONTINGENCY,
            exec_algorithm_id=self._exec_algorithm_id,
            exec_algorithm_params=self._exec_algorithm_params,
            exec_spawn_id=client_order_id,
        )
        self.submit_order(order)
