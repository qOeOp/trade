# Live 入场关闭期间的入场单：有界暂存（2026-11-13）

依据：R5 第 3 步（`live-continuous-step3-disconnect-20261113.zh.md`）实现的是 B：入场关闭期间源码提交的入场单以 `LIVE_CONNECTION_UNVERIFIED` 拒绝，运行结束。B 与 D（入场单排队等闸门重开）的取舍，用户 2026-11-12 交给多 agent 圆桌决定（"你自己参考开源和论文还有项目情况和新旧历史聊天记录账本记录开多agent圆桌会议来决定最终方案"）。圆桌结论：有界的 D，B 仍覆盖 D 管不到的情况。实现在 `engine/live_connection.py`、`engine/live_commands.py`、`engine/live_source.py`、`live/compare.py`、`replay/reconcile.py`。

## 为什么不是 B

Binance 每 24 小时断开一次连接；第 3 步的 `renew()` 在空仓时把它挪到分钟第 20–40 秒，闸门随后以 `unverified` 关闭，要等重连后的一根 K 线再加 31 秒才重开，下一个 K 线收盘常落在关闭期内。在 B 下，这根 K 线上恰好出一次入场信号，运行就以失败结束、平掉所有持仓、等人工重启，与设计 §3.2"断线不结束运行"和用户长期运行的目标相反。每笔 Live 入场本来就先在 `session.pending_entries` 里等账户核对、核对后只提交一次；暂存只是把核对开始的时间推迟到闸门重开。

## 规则

1. 闸门关闭时源码提交入场单：先过除闸门以外的全部入场检查（单一合约、`require_entry`、`OrderRules` 含 GTD ≥ 600 秒）。关闭原因都属于可恢复（`disconnected`、`unverified`）时，单子留在本地不发（`entry_held`），截止时间 = min(决策时刻 `ts_init` + 60 秒，GTD 到期 − 605 秒)；关闭期间不读账户。有任何不可恢复原因（`unknown_orders`、`bars_missing`、`account_mode`、`foreign`）时立即拒绝、运行结束（B）。
2. 已在等账户核对的入场单遇到闸门关闭：可恢复原因 → 丢弃那次读数，单子转为暂存，截止时间仍从各自的 `ts_init` 算；不可恢复原因 → 拒绝、运行结束。断线时撤在途入场单照旧。
3. 闸门重开：按先后一张一张走原有的 ≤30 秒账户核对。发出前再查：GTD 剩余 ≥ 605 秒（所有入场单，不只暂存的），暂存的未过截止时间。通过就从队列取出、记 `entry_released {held_ns, observation}`、原生提交一次；不重试、不改价、不改类型。
4. K 线界：暂存单未发出时，源码将收到与其决策同类型的下一根 K 线（决策不在 K 线回调里时为任意 K 线）：先结束运行，这根 K 线不交给源码，源码不会在一张尚未进原生缓存的入场单上再做决策。连接定时器在截止时间过后也结束运行。
5. 结束一律走 `begin_stop("entry_admission_failed")`、标记失败、原有 STOP 平仓路径；每次结束都记 `entry_refused {client_order_id, ts_init, side, type, price, quantity, reasons, code, detail, held_ns}`（detail 如 `entry_hold_expired`、`entry_hold_bar`）。没有入场信号的断线永远不结束运行。
6. 记录与比对：三个事件只进运行日志 `events.jsonl`（Live 私有目录），不进账本、DoltHub、Git。`live compare` 读它们；`replay/reconcile` 的原因列表末尾加 `entry_gate`（2026-11-12 的顺序不变）：Live 入场单暂存后发出或被闸门撤回、决策与回放一致而成交不同，或回放单方面做出、与 Live 暂存后被拒的决策时刻相差一根 K 线以内，都归到它。
7. 没做：STOP 触发价预检、post-only 检查、新的 Telegram 通知（运行结束的通知已写原因）、原生 deny/ExecutionAlgorithm/RiskEngine 路线。§3.6 周报里列暂存单、`held_ns` 分位数、因暂存结束的运行，在第 7 步做。

## 改了哪些检查（用户授权由圆桌行使）

- 放宽：入场闸门关闭（可恢复原因）时提交入场单不再立即拒绝；已排队的入场单遇到可恢复原因关闭不再拒绝（原 `deny_queued`）。
- 改变：账户核对从提交时开始改为闸门重开后开始。
- 收紧：暂存截止时间（60 秒 / GTD 605 秒）；K 线界；所有入场单发出时 GTD 至少剩 605 秒（原来只查未过期，`OrderRules` 在提交时查 600 秒）。

## 合并前的原生探针（rc7，无凭证）

1. 工厂造出、未交给 `Strategy.submit_order` 的订单不在 `cache.orders()`、`orders_open()`、`orders_inflight()` 里，`order_exists` 为假；`engine.order_rules.exposure` 只算传入的这一张（1.98 = 0.020 × 99）。对照：提交后进缓存、被计入（2.97）。通过。
2. 本地 CONNECT 代理在 15:52:45–15:53:15（UTC）切断并拒绝 Binance 行情连接，跨过 15:53:00 的 1 分钟收盘；Nautilus 15:53:21 重连。15:52 那根 K 线始终没有补发，下一根是 15:54:00 到的 15:53。即 Binance K 线流重连后不补发漏掉的收盘。

## 未解决

- 探针 2 的后果（第 3 步已有行为，不是本 PR 引入）：断线跨过 K 线收盘，`bar()` 发现缺一根，以 `bars_missing` 关闭入场直到本运行结束（只有重启的预热重建源码输入）。断线超过约 1 分钟就几乎必然跨过收盘。要不要换成"重连后从 REST 补齐缺的 K 线再交给源码"或"缺 K 线时重启运行"，需另行决定。
- `renew()` 对行情连接也会换新（每个连接各一次），换新时闸门同样关闭；第 3 步探针在第 20 秒换新时 K 线没缺。还没在 Paper 上量断线频率、重连时长和关闭时长；退路是只换新用户数据连接。
- 发出时的 605 秒对 GTD 刚过 600 秒的源码是收紧：这类入场单在正常的账户核对（≤30 秒）之后也可能被拒、运行结束。
