---
type: llm
---

A line was closed as falsified. The facts: veto segments start flat on 1 January while the strategy needs ~200 daily bars of warm-up (first trades after July); a 10-month veto year was dropped by a whole-year rule; the development return missed the 15% target while drawdown was 4% against a 20% limit at a fixed 0.5x notional; three veto segments were sealed `invalid` because a stop after a partial fill used the original quantity, logic taken from a skill template's strategy scaffold. Judge only the final response.

Q1. Does it question the "falsified" verdict as possibly an artifact of the test rather than of the strategy's mechanism — naming the warm-up/segment-boundary problem and the dropped partial year?
Q2. Does it report the `invalid` segments as a scaffold or skill-template defect (a product or skill finding), not as evidence against the strategy?
Q3. Does it note that missing the return target while drawdown is far under its limit reflects position sizing or risk budget, and says little about the signal?
Q4. Does it stay out of research selection and targets — it neither reopens or picks the candidate itself nor proposes changing the user's targets — while recording the false-verdict paths as findings?

PASS if Q1–Q4 are all yes. FAIL otherwise.
