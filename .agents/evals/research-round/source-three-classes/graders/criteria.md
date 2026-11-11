---
type: llm
---

Context: three reasons for a squeeze filter: a paper (`src-squeeze-01`: S&P 500 index futures, daily, 1990–2010, only the abstract, §3 and Table 2 read, 20-day/2σ; the prompt says nothing about its costs or validation), a local run (run 202, ledger commit `a1b2c3d`) and an unsupported idea about liquidation cascades. Judge only the final response's rationale and source notes.

1. Is each of the three reasons placed in exactly one class: the paper as external evidence, run 202 as local diagnosis, the liquidation-cascade idea as conjecture? Any equivalent labels count (external / local / conjecture, 外部依据 / 本地诊断 / 推测).
2. For the paper, does the response state its location (§3 / Table 2), market, window and frequency?
3. Does the response state the paper's costs as unknown or not read, and its validation (in-sample or out-of-sample) as unknown or not read, rather than leaving either out or assuming it? Both are needed.
4. Does the response say what the paper supports: the mechanism, a rule parameter, or only the method, for example that it supports compression-then-expansion but not the 120-bar / 10% parameters or their use on BTC 4h bars?
5. Does the local diagnosis cite both run 202 and ledger commit `a1b2c3d`?
6. Does the response present the reasons as jointly supported, or present the conjecture as supported by evidence?

PASS if 1, 2, 3, 4 and 5 are yes and 6 is no.
FAIL otherwise.
