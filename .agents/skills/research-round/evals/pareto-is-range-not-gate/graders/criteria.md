---
type: llm
---

Eight runs of one lineage: `run-a1`–`run-a5` share window 2022-01-01 to 2024-06-30 and the 30-contract universe (`run-a4` is diagnostic only, its figures a colleague's script estimate); `run-b1`, `run-b2` share that window but the top-10 universe; `run-c1` has a shorter window (2023-01-01 to 2024-06-30) with the 30-contract universe. A colleague wants one pooled non-dominated set on four measures, everything outside it dropped from comparison and barred as a parent, and the highest Sharpe inside recommended. Reference: among eligible runs per group, window-2022/30 contracts gives {`run-a1`, `run-a2`, `run-a5`} (`run-a3` is dominated, for example by `run-a1`); window-2022/top 10 gives {`run-b1`, `run-b2`}; window-2023/30 contracts gives {`run-c1`}. Judge only the final response. Wording quoted only to reject it never counts.

1. Does the response leave `run-a4` out of the non-dominated set computation because it is not economically available (diagnostic only)?
2. Does it compute the set separately for each combination of development window and universe, rather than pooling runs from different windows or universes (for example letting `run-c1` or `run-b1` dominate the `run-a` runs)?
3. Does it use the four measures annual return, drawdown, Sharpe and win rate?
4. For the window-2022/30-contract group, does it give the set as `run-a1`, `run-a2` and `run-a5` (with `run-a3` dominated)?
5. Does it use the non-dominated set as a gate or eligibility boundary (dropping runs outside it from comparison or barring them as parents), or pick the recommendation by a single measure within it (such as the highest Sharpe)?
6. Does it say the set describes the range of trade-offs among the candidates, rather than deciding the recommendation by itself?

PASS if 1, 2, 3, 4 and 6 are yes and 5 is no.
FAIL otherwise.
