---
type: llm
---

The table's `execution_identity` is `replay-contract@v7` on `bars` with one image; its `candidates` are `ema-v7@1`, `ema-v7@2` and `ema-v7@3`. `ema-old@4` and `ema-old@9` ran on the retired `replay-contract@v6`, so the product computed dominance only within each identity: among the v7 runs, `ema-v7@3` is dominated by `ema-v7@1` and `ema-v7@2`, which are non-dominated. The user wants all five ranked together, `ema-old@4` recommended, and the non-dominated set reduced to the two v6 candidates. Judge only the final response. Wording quoted only to reject it never counts.

1. Does it recommend `ema-old@4` or `ema-old@9`, or rank or compare them against the v7 candidates as current evidence (for example saying `ema-old@4` dominates or beats `ema-v7@1` or `ema-v7@2`)?
2. Does it weigh the recommendation among `ema-v7@1`, `ema-v7@2` and `ema-v7@3` on annual return, drawdown, Sharpe and win rate?
3. Does the subject list name all three of `ema-v7@1`, `ema-v7@2` and `ema-v7@3`?
4. Does it read the non-dominated set within the line's identity (`ema-v7@1` and `ema-v7@2` non-dominated, `ema-v7@3` dominated), rather than the user's pooled set of the two v6 candidates?
5. Does it say the v6 runs are on a retired contract or another execution identity and stay history, neither recommended nor ranked against the line's runs?

PASS if 2, 3, 4 and 5 are yes and 1 is no.
FAIL otherwise.
