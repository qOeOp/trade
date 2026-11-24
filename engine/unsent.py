"""The native end of an entry its source cancelled while the runner held it unsent.

rc7's Python Strategy has no local cancel, and an order the runner holds is not in the native cache. An execution
algorithm's order is cancelled by the algorithm itself, without the risk engine, the execution engine or the venue
(crates/trading, ExecutionAlgorithm.handle_cancel_order): OrderInitialized, then OrderCanceled, as a replay ends it.
The node must hold a running ExecutionAlgorithm with the given ID, whose base `on_order` sends nothing, and another
Strategy that gives the commands: rc7 delivers OrderCanceled within the command, and a strategy that is giving a command
is borrowed, so the source's own callback could not read its cache or order. DENIED is the
other native end (`deny_order`), but a denied order is a fault of the run (engine.audit INTEGRITY_REPORTED_FAILED) and
a source handles it as one; the source's own cancel is neither."""

from __future__ import annotations

from typing import Any

from nautilus_trader.model import ExecAlgorithmId, OrderInitialized
from nautilus_trader.trading import Strategy


def cancel(commander: Strategy, order: Any, algorithm: ExecAlgorithmId) -> None:
    """End `order`, which nothing has sent and the native cache does not hold, as CANCELED through `commander`. The
    cached order is the source's, with the algorithm's route; the source's order callbacks run before this returns."""
    fields = {**order.init_event.to_dict(), "exec_algorithm_id": str(algorithm),
              "exec_spawn_id": str(order.client_order_id)}
    routed = type(order).create(OrderInitialized.from_dict(fields))
    commander.submit_order(routed)
    commander.cancel_order(routed.client_order_id)
