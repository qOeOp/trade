# 2026-11-21 Paper 封存审计在成交突发时的两类误报

| Item | Value |
|---|---|
| Sessions | 远端 Paper 运行 3（`pa-trend-second-entry@52`），封存文件的只读副本；无研究会话 |
| Audit session | Claude Code（Claude Opus 5.5），0.5.0 清理协调会话的只读诊断与条目 E9 的修复会话；修复 PR 见索引 |
| Checkout / ledger | `origin/main` `ba6023dbd`；未读写账本或市场 |
| Coverage | `engine/audit.py` 的 `event_report_findings`、`venue_cancel_lead`、`live_fill_changes` 与 `generic_audit` 的资金核对；运行 3 的 `order_events.jsonl.gz`、`fills.csv`、`positions.csv`、`account.csv`、`seal.json`，`paper compare` 结果。缺口：运行 1 没有报告；运行 2、4 无此形态 |
| Cost | unknown；运行 3 因审计发现封存为未通过，经济结果不受影响 |
| Net change | 放宽两条审计检查（仅实时时钟）；不增拒绝码（250）、不增存储字段，不改 skill（27,694 词） |

## Findings

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261121-20 | 实时时钟下一个合约的部分成交突发让 Paper 封存审计误报 12 条 `EVENT_OUT_OF_ORDER` 与 14 条 `FUNDING_BALANCE_MISMATCH`，运行 3 封存为审计未通过 | **运行证据**：12 张单都是 reduce-only 退出单（OP 10、APT 2；LIMIT 与 STOP_MARKET 各 6），事件为 Initialized、Submitted、Accepted、PendingCancel、Updated（1–3 次）、Canceled；每个 Updated 比 PendingCancel 早 0.8–1.8 ms，落在同合约入场单部分成交的突发里（如 3626e1f9：成交 22:35:02.832190、.832240、.832269，Updated .832211–.832277，PendingCancel .833879）：Sandbox 在每次部分成交后把 reduce-only 单改到持仓大小，而策略在成交回调里已经发出撤单。同一时刻两笔成交相隔 96 µs（22:31:00.409009、.409105），账户变动按序落在 .411342（−1.01183261）与 .412867（−0.19150107），正是两笔手续费。`paper compare` 每个已平仓位的进出价都相同。<br>**当前产品**：`engine/audit.py` 的 `venue_cancel_lead` 只豁免最后两条事件为 (PendingCancel, Canceled) 的序列（用户 2026-11-13 方案 A，52715fc60），中间夹 Updated 不算；`live_fill_changes` 要求成交与其账户变动之间没有别的成交，连续成交都配不上。<br>**消费者**：Paper 封存（`ledger/paper.py` `audit`，摘要时钟 `live`）；Live 不跑这份审计，回放的模拟时钟不走这两条路径 | authority（只在实时时钟下放宽两条审计检查） | unknown | 见索引 |

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|

## Decisions

- 2026-11-21 用户把需要定夺的事项交给 Claude（「需要我定的部份最后也是一样由你决定按推荐做」），0.5.0 清理协调会话据此决定放宽（条目 E9），只在实时时钟（摘要 `clock` 为 `live`，即 Paper 封存；回放的模拟时钟不变）且只按证据的形态：
  - 一张 reduce-only 单在同合约成交突发里由交易所发出的 OrderUpdated 可以落在策略的 OrderPendingCancel 之后、时间戳更早，条件是把这次撤单请求移到这些 Updated 之后事件即按时间有序、单子以 OrderCanceled 结束，且每个 Updated 之前都有该合约的一笔成交、距请求不超过一秒（与方案 A 同一界限）（`engine.audit.venue_updates_before_cancel`）。
  - 之间没有账户变动的连续成交（一笔或一次突发）按序一对一取随后同样多的账户变动：每笔落后其成交不超过一秒，在下一笔成交之前，开仓或加仓的那笔等于负手续费；任何一笔不符则整次突发都不计，仍由资金核对报出（`engine.audit.live_fill_changes`）。
  - 其余仍是发现：Canceled 之后的 Updated、非 reduce-only 单的 Updated、金额不符、多出或缺少的变动。
