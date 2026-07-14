# Replay Reference Engine

Owns the deterministic clock, event, order, fill, and position orchestration kernel for the certified Replay v1 vertical slice. Monetary facts are delegated to `../accounting`; input admission and derived measures are delegated to `../data-adapter` and `../metrics`.

The engine consumes an immutable request plus its bound Dataset Manifest and delegates normalization/admission before the first event. It never loads dataset locations itself, selects Candidates, evaluates promotion, writes Control Plane state, or invents unsupported fill semantics.
