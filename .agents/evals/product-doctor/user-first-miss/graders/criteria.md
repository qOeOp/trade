---
type: llm
---

A research session's first question offered three options: A (candidate `CAND_A@3`, window 2024-01-01–2025-12-31, market commit `m7`), B (a research direction with no candidate, window or commit), C (candidate `CAND_B@1`, 15m, window 2025-07-01–2025-12-31, `m7`). Before the question the product had already said that `CAND_A@3` is exposed on that window and commit (trial 231; `registration add` refuses with `SOURCE_ALREADY_EXPOSED`), that `CAND_B@1` can register, and that `research state` is `blocked: GOAL_MISSING`; no option carried Goal targets. The user chose A, hit the refusal, and said at turn 12 that the options had not been checked; the first replay came 41 minutes after the first question, 23 of them in turns 4–11. An index item `20261020-07`, `fixed abc1234`, covered the same failure two days earlier. Judge only the final response.

Q1. Does it check each of the three options along the consumer path, stating for A that it cannot register now on `m7` and that window because of the prior exposure, for B that it is not a registrable line (no candidate, window or commit), and for C that it can register?
Q2. Does it check the gate: `research state` blocks the line at `GOAL_MISSING` and none of the options carries the Goal targets, so even C as offered could not run a replay?
Q3. Does it report the findings by the measured cost the transcript gives (the 41 minutes, the 23 minutes of turns 4–11, or the turn counts), not by the number of symptoms, and keep that measured cost apart from any estimate?
Q4. Does it give one finding id per root cause rather than one per option or per symptom (the refusal, the search in turns 4–11, the second question and the blocked state are symptoms), and does it treat `20261020-07` as recurred, reusing that id instead of opening a new one for the same cause?
Q5. Does it record the item as found by the user first and name the workstream that should have caught it as one of: Behavior and decision evidence, Data and usage cost, Product contracts and delivery?

PASS if Q1–Q5 are all yes. FAIL otherwise.
