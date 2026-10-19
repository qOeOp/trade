---
type: llm
---

Context: the user gave three reasons for a squeeze filter: a paper (`src-squeeze-01`: S&P 500 index futures, daily, 1990–2010, read the abstract, §3 and Table 2, 20-day/2σ, in-sample only, costs not mentioned in what was read), a local run (`run-b02a`, ledger commit `a1b2c3d`) and the user's own guess about liquidation cascades. A colleague suggested one sentence saying literature and backtest both support it. Judge only the final response's rationale and source notes. Quoting the colleague's sentence only to reject it never counts.

1. Is each of the three reasons labelled as exactly one class — the paper as external evidence, `run-b02a` as local diagnosis, the liquidation-cascade idea as conjecture? Any equivalent labels count (external / local / conjecture, 外部依据 / 本地诊断 / 推测).
2. For the paper, does the response state its location (§3 / Table 2), market (S&P 500 index futures), window (1990–2010), frequency (daily), costs and validation conditions (in-sample only, no out-of-sample test), with the costs given as unknown or not stated rather than assumed?
3. Does the response say what the paper supports — the mechanism, a rule parameter, or only the method — for example that it supports the compression-then-expansion mechanism but not the 120-bar / 10% parameters or their use on BTC 4h bars? Any explicit statement of the support scope counts.
4. Does the local diagnosis cite both `run-b02a` and ledger commit `a1b2c3d`?
5. Does the response present the reasons as jointly "supported by literature and backtest" (the colleague's sentence or an equivalent), or present the conjecture as supported by evidence?

PASS if 1, 2, 3 and 4 are yes and 5 is no.
FAIL otherwise.
