# 2026-11-15 发版前合并验证

[上线前全面审计](2026-11-14-pre-production-audit.zh.md)的修复在 2026-11-15 一天内由 17 个会话分别合入，各自只验证了自己那一条，有的用的是叠加镜像。本记录把这些修复放在一起，在 CI 构建的执行镜像上重跑原记录的证明：Paper 用隔离账本实跑，Live 只对本地假交易所回环。只诊断，不修。结果是已修的各条都成立、没有回退，另查出两个新问题（20261115-02、20261115-03）。回放与 Paper 的对账仍没有做成（Binance 还没有发布 2026-11-14 的 K 线归档）。

| Item | Value |
|---|---|
| Sessions | 没有新的研究会话证据。读的是本次验证自己的运行：隔离 Paper 库 `audit-paper` 上的运行 48 至 55（2026-11-15 07:40 至 08:10 UTC），和对本地假交易所的回环情形（同日 07:40 至 08:00 UTC） |
| Audit session | Claude Code（桌面端），模型 `claude-fable-5-2`，会话 `0660267b-ae67-4c05-b258-d74244daae37`，与写原记录的是同一个会话；两路验证各由一个子代理（`claude-opus`）执行，本会话核对了两个新问题的原始日志和代码位置。本会话只写记录和索引；修复由别的会话从本记录和索引出发去做 |
| Checkout / ledger | `origin/main` `4ef340f58`。被测镜像 `ghcr.io/qoeop/trade-runtime@sha256:0cd461c855b9706cc14e393575bc8c1b9cf15bdc4fddfddf8aed34aa62c98e6b`（注册表上当时的 `exec-main`，修订 `aff8e25e6`，是 `4ef340f58` 的祖先；镜像里 `engine/` 的 39 个 Python 文件与 `4ef340f58` 逐字节相同，两个提交之间只改了 `ide/`、`docs/` 和评测）。宿主侧命令从 `4ef340f58` 的导出快照运行。没有写活动账本和市场目录；隔离研究库多了 8 个 `verify-*@1` 候选，隔离 Paper 库多了运行 48 至 55 |
| Coverage | Paper：20261114-26、-27、-33（仓位号一半）、-34、-35（代码一半）、-38、-43 的原证明，外加一次 26 分钟、跨过 08:00 资金费结算、12 笔成交的完整运行。Live 回环：20261114-22、-23、-24、-25、-26、-27、-28、-29（形状项）、-31 的原证明，一次完整的启动、入场、挂止损、正常停止，以及 13 个没有改动的审计情形。缺口：没有任何真实交易所证据；`paper serve` 的自动恢复（#3021）、`live serve`、Live 页和 Telegram 没有运行（通知文字是从运行记录渲染的）；20261114-39 在运行里观察不到（两个值仍等于原生默认），只有代码和单元测试；多合约 Live、`restart_limited`、带持仓时的 GTD STOP_MARKET 入场没有情形；对账没有做 |
| Cost | 两个子代理合计约 54 万 token，墙钟约 33 分钟。其余未测 |
| Net change | 本记录只提方向。拒绝码 250（`shared/refusals.py` `CATALOGUE` 键；上一份记录 250），技能词数 27,833（`.agents/skills/**/*.md` 全部 `cat \| wc -w`；上一份 27,833）。两条处置都是修现有缺陷，不新增检查、拒绝码或技能文字 |

## Findings

### 重跑的证明

"成立"指原记录的证明在被测镜像上不再出现，且表现与修复 PR 写的一致。Live 各行证明的是产品收到模拟应答时怎么做，不是 Binance 怎样应答。

| id | 结果 | 证据 |
|---|---|---|
| 20261114-22 | 成立 | 回环：入场的账户读取收到 429，`entry_refused LIVE_ACCOUNT_UNAVAILABLE` 后走 STOP 路径，仓位平掉、止损撤掉，`clean_stop source_failed=true`；三合约预算情形里三笔仓位都平掉（审计时留下三笔仓位和三张止损单） |
| 20261114-23 | 成立 | 回环：只读客户端 429 与提交被重置两种情形现在记 `unresolved` 并带拒绝码，控制判为不是中断，下一次启动被 `LIVE_COLD_RESTART` 拒绝。交易所时钟快 5 秒时，两次启动以 `LIVE_CLOCK` 退出、不写新事件、仍可恢复，控制判为再启动；时钟恢复后正常进入保持 |
| 20261114-24 | 成立 | 回环：runner 停着时撤掉止损，恢复后得到 `held_uncovered`，通知文字写明仓位在 Binance 没有止损、要立刻处理；继承来的挂单以 `entry_cancel_requested reason=held` 撤掉。保持期间不跑刹车（价格跌 17.5% 没有动作），这是用户定的 |
| 20261114-25 | 一半成立，与索引一致 | 回环：交易所全空的三种情形（恢复时已无仓位、外部强平、用户流断开时止损被触发）都以 `venue_flat` 结束。没有管住的：手动平仓或 ADL 之后止损还留在交易所（现在会先挡住第二次入场）、手动平仓之后的 `live stop`、强平发生在 90 秒保护检查之前且没有新入场。这三种都以平仓被 -2022 拒绝、`unresolved` 结束，前两种留下一张孤儿止损单 |
| 20261114-26 | 成立 | Paper 运行 48：非整秒到期的源码被 `ORDER_RULE` 拒绝，没有订单发出；运行 49：整秒的拷贝 6 张 GTD 入场单全部被接受并成交。回环：整秒的 GTD 到达假交易所（`goodTillDate` 为整秒毫秒值），非整秒的得到 `entry_refused ORDER_RULE` |
| 20261114-27 | 拒绝成立；记录拒绝时出错，见 20261115-02 | Paper 运行 50：GTD STOP_MARKET 入场被 `ORDER_RULE` 拒绝，没有订单发出。回环：同样被拒、没有发出 |
| 20261114-28 | 成立 | 回环：缺 K 线后入场被闸门否决，源码自报 `entry_gate_findings=1`，之后的 SIGTERM 以 `interrupted` 结束 |
| 20261114-29（形状项） | 成立 | 回环：`/fapi/v1/time` 返回 HTTP 200 加错误体，比较记 `LIVE_ACCOUNT_RESPONSE`，运行继续并正常停止；保持期间两次这样的读取被丢弃，没有写 `unresolved` |
| 20261114-31 | 成立 | 回环：12 笔仓位的停止，12 次平仓和 12 次撤止损，没有限频拒绝，`clean_stop`，交易所全空 |
| 20261114-33（仓位号） | 成立 | Paper 运行 55：带着两笔持仓被杀两次，两次恢复都被接受；三轮共 6 个不同的仓位号，仓位报告里 6 行都在，没有丢成交。同一次运行露出 20261115-03 |
| 20261114-34 | 成立 | Paper 运行 52：杀掉 Redis 子进程后 1 秒出现 `PAPER_CACHE_UNAVAILABLE`，12 秒后 runner 退出，封存带同一原因 |
| 20261114-35（守卫） | 成立 | Paper 运行 51：`set_timer_zoned` 回调抛异常，失败回执的阶段为 `set_timer_zoned:tick`，封存 `RUNTIME_FAILURES` |
| 20261114-38 | 成立 | Paper 运行 53：带持仓被杀后封存，读数里没有 `positions_open_at_stop` |
| 20261114-43 | 成立 | Paper 运行 54：日志写入失败后运行停止，runner 退出码 3，封存带 `PAPER_JOURNAL_WRITE_FAILED`。这是 #3084 当时只有单元测试的那个变体 |
| 完整运行 | 没有意外 | Paper 运行 49：按时长结束，封存完整、没有原因、审计通过，runner 日志没有 WARN、ERROR 和回溯。Live 回环：`clean_stop`，日志只有一条审计基线里也有的 WARN |

没有改动的 13 个审计回环情形（各类拒单、结果不明的提交、GTD 部分成交、用户流断开、对账模式、缺 K 线后重新预热）表现与审计时一致。四个情形的结局变了，都是 #3049 有意的：撤单 429、读取 429 和两个提交被重置的情形现在记 `unresolved`，重启被拒，审计里"重启后保持着一笔没有止损的仓位"这条路走不到了。

### 新发现

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261115-02 | Live 里带 GTD 的 STOP_MARKET 入场被订单规则拒绝后，写拒绝记录时抛 `AttributeError`：`entry_refused` 事件没有写进去，停止原因记成 `source_failure` 而不是 `ORDER_RULE` | Nautilus：rc7 的 `nautilus_trader.model.StopMarketOrder` 没有 `expire_time_ns` 属性（执行镜像里的报错原文：`object has no attribute 'expire_time_ns'. Did you mean: 'expire_time'?`）。产品：`engine/live_connection.py:237` `entry_fields` 对 GTD 订单一律读 `order.expire_time_ns`；`engine/live_source.py:122` 在入场被拒的 `except` 里经 `live_connection.refused` 调到它，新异常盖掉了原来的拒绝。同文件 `deadline`（227 行）也读这个属性，但只有通过订单规则的入场会被保持，走不到 STOP_MARKET。本产品证据：回环情形 `s6_gtd_stop_entry`（`/tmp/trade-audit-20261114/verify-live/out/s6_gtd_stop_entry/runner-1.log`），订单没有发出，运行以 `clean_stop source_failed=true` 结束。消费者：运行记录、Live 页和通知读 `entry_refused` 与停止原因来说明为什么停；现在读到的是源码失败，排查会被引到候选源码里的异常上。Paper 同一种源码记录正常（运行 50）。#3045 的测试没有经过 Live 的拒绝记录路径 | 修缺陷：`entry_fields` 只在订单有到期时间时读它，并加一个让被拒的 GTD STOP_MARKET 入场经过 `refused` 的测试。不改拒绝本身，不需要授权 | none（没有在真实运行里出现；不涉及仓位，订单没有发出，运行干净停止） | open |
| 20261115-03 | Paper 带着未平的持仓恢复之后，runner 日志出现 109 条来自检查点读回的回溯，带过来的仓位平掉之前没有写出新的检查点；原因没有查清 | Nautilus：回溯原文是 PyO3 对不可跨线程对象的报错，`RuntimeError: nautilus_common::python::cache::PyCache is unsendable, but is being dropped on another thread`。产品：回溯位置 `engine/paper_redis.py:140`（`_native` 里的 `value.to_dict()`）；`snapshot` 在所有者线程上调用 `_native`，随后把冻结交给另一条 I/O 线程。本产品证据：运行 55（`verify-hold@1`，BTC 与 ETH，源码不挂止损、持有 4 分钟），封存的 `runner.log` 里这种回溯 109 条，全部出现在两次恢复之后（第 162 至 928 行），没有时间戳，也没有 "Exception ignored" 前缀；同一份日志另有 3 条 `native cache readback differs from the owner; the checkpoint stays dirty` 和多条 `a strategy callback or timer remains pending`。检查点时间：第一个进程 07:50:18，恢复后下一个在 07:53:20（带过来的两笔仓位已平），恢复后新开的仓位在 07:57:20 正常写出检查点。运行 49、51 至 54 和 #3060 的运行 29、32（恢复时没有持仓）没有这种回溯。没有确认的：回溯是不是检查点写不出来的原因；这段时间里延后检查点的是读回不一致还是回调未决；回溯为什么没有成为延后原因或封存原因；这段时间里被杀还能不能恢复（没有测，按脏标记推断不能）。消费者：Paper 的恢复协议（杀掉后 `paper resume`）依赖最近的干净检查点；审计的运行里持仓都带着挂着的止损，按设计本来就不能恢复，所以这个状态以前没有到达过 | 先查清原因再修：在隔离 Paper 库上重现（不挂止损的持仓加一次 SIGKILL 和恢复），确定回溯的来源、它与检查点延后的关系，以及这段时间里被杀能否恢复；按查到的根因修。若修法要改检查点的拒绝条件，先问用户 | unknown（只在隔离运行里观察到；这次的两次恢复都成功，成交和仓位记录完整） | open |

## Removal list

本次没有提出删除项。

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|

## Decisions

- 2026-11-15：用户指出本会话还有工作没完成，不该发半成品（"你现在急着发版了 但不是这个会话还有很多工作没完成嘛 直接发半成品嘛"）。发版 PR #3103 当时还没有合并，已改回草稿并写明暂缓；没有打过标签。本会话建议的发版条件是：对账做完且差异有解释、本记录的两个新问题有着落、用户说可以发。这三条是建议，用户还没有确认；标签仍由用户打。
- 本记录的两条处置没有需要用户先决定的事项；20261115-03 的修法若涉及检查点的拒绝条件，到时再问。
