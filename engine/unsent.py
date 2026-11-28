"""The native end of an entry its source cancelled while the runner held it unsent.

rc7's Python Strategy has no local cancel, and an order the runner holds is not in the native cache. An execution
algorithm's order is cancelled by the algorithm itself, without the risk engine, the execution engine or the venue
(crates/trading, ExecutionAlgorithm.handle_cancel_order): OrderInitialized, then OrderCanceled, as a replay ends it.
The node must hold a running ExecutionAlgorithm with the given ID, whose base `on_order` sends nothing, and another
Strategy that gives the commands: rc7 delivers OrderCanceled within the command, and a strategy that is giving a command
is borrowed, so the source's own callback could not read its cache or order. DENIED is the
other native end (`deny_order`), but a denied order is a fault of the run (engine.audit INTEGRITY_REPORTED_FAILED) and
a source handles it as one; the source's own cancel is neither.

Paper (an entry waiting for its terms read, engine.paper_terms) and Live (an entry waiting for its account read,
engine.live_source) hold an entry the same way: `Waiting` is the one place a source's cancels and market exit reach it."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from nautilus_trader.model import ExecAlgorithmId, OrderInitialized, OrderSide
from nautilus_trader.trading import Strategy


def cancel(commander: Strategy, order: Any, algorithm: ExecAlgorithmId) -> None:
    """End `order`, which nothing has sent and the native cache does not hold, as CANCELED through `commander`. The
    cached order is the source's, with the algorithm's route; the source's order callbacks run before this returns."""
    fields = {**order.init_event.to_dict(), "exec_algorithm_id": str(algorithm),
              "exec_spawn_id": str(order.client_order_id)}
    routed = type(order).create(OrderInitialized.from_dict(fields))
    commander.submit_order(routed)
    commander.cancel_order(routed.client_order_id)


class Waiting:
    """A source's cancels and market exit reach its entries the runner holds unsent, which the native cache does not
    hold; before the order rules (OrderRules comes after this class). The mode gives the store: `_held`, the held
    orders of every instance, each with whether it is this instance's; `_cancel_waiting`, which cancels this
    instance's held entries that match and gives their client order IDs; `_holds`, whether an instrument is this
    instance's contract. `_check` runs before each path, and `_refuse_waiting` when a cancel the order rules refuse
    reaches a held entry."""

    def _held(self) -> list[tuple[Any, bool]]:
        raise NotImplementedError

    def _cancel_waiting(self, match: Callable[[Any], bool]) -> set:
        raise NotImplementedError

    def _holds(self, instrument_id) -> bool:
        raise NotImplementedError

    def _check(self) -> None:
        pass

    def _refuse_waiting(self) -> None:
        pass

    def _refused(self, match: Callable[[Any], bool]) -> None:
        if any(match(order) for order, _own in self._held()):
            self._refuse_waiting()

    def _foreign(self, client_order_ids) -> list:
        """Another instance's held entry is a known order too (engine.order_rules rule 6)."""
        ids = list(client_order_ids)
        found = [order for order, own in self._held() if not own and order.client_order_id in ids]
        if found:
            self._refuse_waiting()
        return super()._foreign(ids) + [str(order.client_order_id) for order in found]  # type: ignore[misc]

    def cancel_order(self, client_order_id, client_id=None, params=None):
        self._check()
        if params:
            self._refused(lambda order: order.client_order_id == client_order_id)
        elif self._cancel_waiting(lambda order: order.client_order_id == client_order_id):
            return None
        return super().cancel_order(client_order_id, client_id, params)  # type: ignore[misc]

    def cancel_orders(self, client_order_ids, client_id=None, params=None):
        self._check()
        ids = list(client_order_ids)
        if params:
            self._refused(lambda order: order.client_order_id in ids)
        else:
            waiting = self._cancel_waiting(lambda order: order.client_order_id in ids)
            ids = [identity for identity in ids if identity not in waiting]
            if waiting and not ids:
                return None
        return super().cancel_orders(ids, client_id, params)  # type: ignore[misc]

    def cancel_all_orders(self, instrument_id, order_side=None, client_id=None, strategy_only=True, params=None):
        self._check()
        if params or not strategy_only:
            self._refused(lambda order: order.instrument_id == instrument_id)
        elif self._holds(instrument_id):
            self._cancel_waiting(lambda order: order_side in (None, OrderSide.NO_ORDER_SIDE, order.side))
        return super().cancel_all_orders(instrument_id, order_side, client_id, strategy_only,  # type: ignore[misc]
                                         params)

    def market_exit(self):
        """The native exit cancels the orders in its cache; the held entries are the source's working orders too. A
        call natively ignored (not running, or exiting already) cancels none."""
        self._check()
        if Strategy.is_running(self) and not Strategy.is_exiting(self):  # type: ignore[arg-type]
            self._cancel_waiting(lambda order: True)
        return super().market_exit()  # type: ignore[misc]
