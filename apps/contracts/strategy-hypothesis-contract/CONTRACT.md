# contracts/strategy-hypothesis-contract

Owner of the structured R&D strategy hypothesis contract.

Responsibilities:
- validate `trade-flow.strategy-hypothesis-contract.v1`;
- project a valid hypothesis contract into an RD `next_hypothesis_queue` item;
- keep designer and supervisor tools decoupled through a shared contract layer.

Non-goals:
- does not design hypotheses;
- does not run replay, campaign, validation, holdout, or live execution.
