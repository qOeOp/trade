# 2026-11-17 补做的回放与 Paper 对账（运行 1 与运行 48 至 55）

[回放与 Paper 对账](2026-11-15-replay-paper-reconciliation.zh.md)留下两项要等 2026-11-15 的 Binance 归档：跨午夜的 17 小时运行 1，和[发版前合并验证](2026-11-15-pre-release-verification.zh.md)的运行 48 至 55。本机市场目录覆盖到 2026-11-15 之后，本记录补上这一步。结论：没有新发现。运行 1 两边都没有订单，权益完全相同；运行 48 至 55 的差异都能对到验证当时注入的故障、验证源码自己的写法或已经定下的呈现方式上。运行 55 证实了 #3060 之后的恢复运行不再出现"疑似偷看未来"的误报。

| Item | Value |
|---|---|
| Sessions | 没有研究会话证据。读的是隔离 Paper 库 `audit-paper` 上的运行 1（`dow-theory@62`，2026-11-14 07:13 至 2026-11-15 00:12 UTC）和运行 48 至 55（2026-11-15 07:43 至 08:09 UTC），以及对它们各跑一次的 `paper compare` 输出 |
| Audit session | Claude Code（桌面端），会话 `0660267b-ae67-4c05-b258-d74244daae37`，与写前两份记录的是同一个会话。只写记录 |
| Checkout / ledger | 运行 1 的对账用原记录的导出快照；运行 48 至 55 的对账用 `origin/main` `b60d3930a` 的导出快照（含 #3114 的成员区间修复）。对账回放用各 Paper 运行自己记录的镜像。本机市场目录的市场日 2026-11-15。`paper compare` 不写任何库；没有写活动账本和市场目录 |
| Coverage | 运行 1、48 至 55 全部。审计和验证源码是为制造订单与故障而写的，不代表真实候选的决策；Live 没有可对的运行 |
| Cost | 9 次对账合计几分钟。从运行结束到能对账等了约两天，其中约一天是 Binance 归档的发布延迟，其余是本机市场头部被未跟进的指标卡住（[发版弱点记录](2026-11-16-release-weak-points.zh.md) 20261117-03） |
| Net change | 无新增检查、拒绝码或字段 |

## Findings

### 对账结果

| 运行 | 源码与当时的验证内容 | 订单（Paper/回放） | 成交 | 组：一致/不同 | 回放 | 实际原因 |
|---|---|---|---|---|---|---|
| 1 | `dow-theory@62`，17 小时跨午夜，无故障 | 0 / 0 | 0 / 0 | 0 / 0 | passed | 两边都没有入场，权益差 0；晚到 1 根 K 线 |
| 48 | `audit-fast-f5@1`，非整秒到期的 GTD 入场 | — | — | — | invalid | 回放以同一条 `ORDER_RULE`（GTD 须整秒到期）拒绝，与 Paper 一致 |
| 49 | `verify-churn-a@1`，按时长结束的完整运行 | 18 / 18 | 12 / 12 | 2 / 4（其中 1 组为后果） | passed | 3 组 `unexplained` 都是 Paper 的定时离场比回放早一分钟，见下 |
| 50 | `verify-gtdstop@1`，GTD STOP_MARKET 入场 | — | — | — | invalid | 回放以同一条 `ORDER_RULE`（GTD 只限限价类）拒绝，与 Paper 一致 |
| 51 | `verify-zoned@1`，`set_timer_zoned` 回调故意抛异常 | — | — | 1 / 0 | invalid | 回放记录同一个 `RUNTIME_FAILURES`（`set_timer_zoned:tick`），与 Paper 一致 |
| 52 | `verify-churn-b@1`，带持仓杀掉 Redis 子进程 | 4 / 4 | 2 / 2 | 2 / 0 | passed | 订单与成交全部一致；权益最大差 0.12 USDT，没有逐项核对 |
| 53 | `verify-churn-d@1`，带持仓杀掉 runner 后封存 | 2 / 2 | 1 / 1 | 1 / 0 | passed | 同上，权益最大差 0.10 USDT |
| 54 | `verify-churn-c@1`，带持仓时日志写入失败 | 2 / 2 | 1 / 1 | 1 / 0 | passed | 同上，权益最大差 0.10 USDT；缺 1 根 K 线，没有逐项核对 |
| 55 | `verify-hold@1`，带两笔持仓被杀两次、两次恢复 | 12 / 12 | 12 / 12 | 2 / 4（其中 1 组为后果） | invalid | 3 组归因 `missing_bar`（两次停机共缺 4 根），其后为后果；`look_ahead_suspects` 为 0。回放无效来自独立审计的 `UNPROTECTED_POSITION`：验证源码故意不挂止损，Paper 封存时同样带这条 |

对账输出在 `/tmp/trade-audit-20261114/phaseB/B1/compare-1-r1/` 与 `/tmp/trade-audit-20261114/phaseB/B2/compare-<运行号>/`（重启后会丢）。

### 运行 49 的早一分钟离场

这与原记录运行 2 的两组是同一个机制，不需要本机时钟慢 2 秒也会发生：

- 验证源码用成交事件时间加 1 毫秒再整除到分钟，作为开仓分钟（`opened_minute = (event.ts_event + MS_NS) // MINUTE_NS`），满 3 分钟离场。
- 回放里成交时间是分钟 K 线的收盘时刻 07:48:59.999，加 1 毫秒落在 07:49；Paper 的成交时间是本机处理这根 K 线的时刻 07:48:59.996，落在 07:48。Paper 于是多算一分钟，提前一分钟离场。
- 这次的 K 线比收盘时刻早到 42 根，最大提前 125 毫秒，与 2026-11-14 定下的做法一致：早到的 K 线只在证据格里展示，不作为原因。所以对账给 `unexplained`，证据格里有早到根数。

这是源码对亚秒时间取整的写法所致，不是产品缺陷。真实候选若用"成交时间所在分钟"计时，在 Paper 里会有同样的一分钟偏差；按 K 线时间计时（例如 `pa-trend-second-entry@52` 用 `bar.ts_event - position.ts_opened` 与整数个 K 线长度比较）不受影响。

### 运行 55 与 #3060

原记录说"修复后的恢复运行对账时不再出现这种误报，要等运行 55 能对账才有实证"。运行 55 三轮共 6 个仓位号各不相同（Paper `P-20261115-…`，回放 `BINANCE-1-1` 至 `BINANCE-2-3`），配对没有串组，`look_ahead_suspects` 为 0。这一条现在有实证。

## Removal list

本次没有提出删除项。

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|

## Decisions

- 本记录没有需要用户决定的事项。
