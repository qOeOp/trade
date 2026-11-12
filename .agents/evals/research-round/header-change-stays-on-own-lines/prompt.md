---
description: Rule check — with the skill, a child header changes only the lines of the duties whose own rule changes; lines whose rule is unchanged are not edited to restate or cite the new rule, and changed_duties names only the changed lines.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续策略研究，路线 `trend-btc-eth`。下一个改动是在 `trend-root@6` 上加账户回撤缩仓：每日决策时把账户权益和过去 60 天的最高权益比，敞口系数 = max(0.25, 1 − 回撤 / 0.15)；新计划的数量乘这个系数，已有计划比「入场数量 × 系数」多出 25% 以上时用只减仓单减到这个目标。其他规则都不动。

这是 `candidate export trend-root@6` 导出到 /tmp/trend7/strategy.py 的文件头：

```text
"""
Daily trend follower: hold BTC and ETH perpetuals in the direction of a confirmed daily breakout.
Source: https://example.org/papers/trend-confirm.pdf (v2, 2019-05-10); source bundle src-trend-confirm-01

Duty stances: one line each, "id stance | one-sentence reason | source label"
stance in adopted / default / not applicable; source label in source / implementer / researcher
(researcher: a rule from the source carried to another market, timeframe or instrument)

[A Instruments and applicability]
A1 Investable instruments and eligibility: adopted | BTCUSDT and ETHUSDT perpetuals, the two contracts the line names | researcher
A2 Dynamic selection and replacement: default | no ranking; both contracts trade | implementer
A3 Market-structure / condition filter for the mechanism: default | no market filter | source

[B Forecasting and learning]
B1 Expected return / relative mispricing: adopted | a daily close above the 55-day high (below the 55-day low) forecasts continuation | researcher
B2 Forecast horizon and decay: adopted | the trend is held until the opposite 20-day break; no timed exit | researcher
B3 Signal combination and estimate updating: adopted | 55-day and 20-day extremes of completed daily closes, updated at each daily close | researcher

[C First action and memory]
C1 First entry and trigger: adopted | enter on the first minute after the daily close that breaks the 55-day extreme | researcher
C2 Inaction, re-entry and path dependence: adopted | after a stop-out, re-enter only on a new 55-day break | implementer

[D Economic structure]
D1 Single-leg / multi-leg structure: adopted | one single-leg position per contract | implementer
D2 Hedging and nonlinear exposure: default | no hedge | implementer

[E Risk and allocation]
E1 Per-opportunity risk and size: adopted | notional per plan is 25% of current equity times (0.6 over the contract's 60-day annualised volatility), at most 100% of equity per contract | implementer
E2 Portfolio exposure, concentration and common risk: adopted | gross notional is at most 200% of equity; the two contracts' common direction is accepted | implementer
E3 Risk budget after equity changes: default | size is computed from current equity at entry; an open plan is not resized | implementer
E4 Allocation across opportunities / strategies: adopted | each contract is sized on its own from equity; neither waits for the other | implementer

[F Position path]
F1 Active scaling in and adding: default | the whole size is entered at once | implementer
F2 Active reduction and position path: default | no partial reduction | implementer
F3 Dynamic protective / profit boundaries: adopted | stop at the 20-day low (high) at entry, moved only in the position's favour at each daily close | researcher
F4 Full exit, timed exit and post-exit cleanup: adopted | the whole position is closed on the opposite 20-day break | researcher
F5 Handling existing holdings on membership / model change: adopted | when the breakout signal lapses without an opposite break, holdings stay under their stops | implementer

[G Implementation]
G1 Execution style and price: adopted | every order is a limit order 1% through the last completed minute close | implementer
G2 Waiting, refreshing and post-fill feedback: adopted | an unfilled order is cancelled after 10 minutes; the next daily decision decides afresh | implementer
G3 Impact, capacity and implementation speed: default | no volume cap | implementer

[H Capital]
H1 Cash, financing and carry costs: default | no funding rule | implementer
H2 Margin, collateral and buffers: adopted | gross notional of at most 200% of equity keeps maintenance margin about 49% away on both contracts | implementer
H3 Short availability and financing disruption: default | no rule | implementer

[I Lifecycle and feasibility]
I1 Contract / event lifecycle: default | no entry after a contract's trading status changes; no early-exit rule | implementer
I2 Exit feasibility and future resources: default | no rule | implementer

"""
```

请写出 `trend-root@7` 的文件头（只给改动的行、并说明其余各行不动也行），再写登记体里的 `changed_duties`。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
