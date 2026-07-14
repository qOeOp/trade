# Replay Reference Engine

Owns the deterministic event/order/position/accounting kernel for the certified Replay v1 vertical slice.

The engine consumes an already validated immutable request plus normalized closed bars and exact funding events. It never loads datasets, selects Candidates, evaluates promotion, writes Control Plane state, or invents unsupported fill semantics.

