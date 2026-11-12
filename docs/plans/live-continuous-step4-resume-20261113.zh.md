# Live 连续运行第 4 步：中断后同一个运行接着跑（2026-11-13）

依据：`live-continuous-operation-design-20261110.zh.md` §3.4（用户 2026-11-10 授权：去掉 86400 秒时长上限、允许不设时长；SIGTERM 不再平仓；同一个运行中断后可以再启动并继续交易；`LIVE_COLD_RESTART` 和"冷重启只能对账"相应改变；源码还不能在持仓上重建状态之前，带持仓的重启等用户）。

## 做了什么

- 时长可以不填（一直跑到停止）；填了就从第一次 armed 算起，跨重启不重算。不再有 86400 秒上限。
- SIGTERM/SIGINT（主机重启、发版、`docker stop`）不再平仓：只撤在途入场单，持仓和交易所止损留着，记 `interrupted`，退出码 3。
- 已 armed 的运行，最近一次启动没有任何结束事件（`clean_stop`、`reconciled_flat`、`venue_flat`、`reconcile_stopped`、`unresolved`）且没有 `STOP` 文件——包括被直接杀掉、什么都没写的 runner——由配对的 control 在维护循环（每 10 秒）里用原凭证、同一个原生缓存重新启动同一个运行。一小时内最多 3 次自动重启（含第一次启动共 4 次 run 启动）；超过就记一次 `restart_limited`、发 Telegram，交给用户。其余对已 armed 运行的启动仍以 `LIVE_COLD_RESTART` 拒绝。
- 重启时检查时钟和账户模式：
  - 账户空仓：构建源码、预热、交易（事件 `resuming`）。
  - 有持仓或挂单：保持（`resuming`，`held=true`）：不构建源码、不入场，每 30 秒读一次账户，直到账户空仓（止损触发，或用户在币安手动平），记 `venue_flat_while_held`，以退出码 3 结束这次启动，下一次启动正常交易。保持期间 STOP 的结束方式与 `reconcile` 相同。
- 页面（`live/views.py` 的 `restarts`）和 Telegram 显示：中断、每次重启（交易或保持）、保持期间账户空仓、超过重启上限。
- 进程抛异常结束的仍是 `unresolved`，不自动重启。

## 没做 / 和设计的差别

- 用户决定（2026-11-13，"接受，加通知"）：设计里的"带持仓的重启等用户"按"等账户空仓"实现，保留：带持仓或挂单重启时不建源码；账户空仓后，下一次启动正常交易，不需要用户再点。新增通知：重启一发现继承来的持仓或挂单，就发 Telegram 并在 Live 页面提示，说明三件事：该持仓现在只由币安上的止损保护；策略不再管理它的出场；账户空仓后运行会自己恢复交易。用户想提前结束，可以在币安手动平仓。Telegram 的消息键沿用 `<run>:restart:resuming:<observed_ns>`，跨版本不变，不会重发（`live/notify.py HELD_TEXT`）。页面提示见 `ide/web/src/model/liveTradingMap.ts HELD_NOTICE`，手机上的状态词为 Holding。
- 第一阶段：带持仓的重启只观察、不交易，等账户空仓。源码在持仓上重建状态（让同一个源码接管已有持仓继续管理）是之后的事，需要源码侧接口。
- 重启由 control 发起，没有用 Docker 的 restart policy：control 能判断"是不是中断"、能限次、能通知。
- 页面上"时长"变成可选停止时间、亏损上限变成回撤刹车，在 Live 页面那个 PR 里做。

## 验证

- 单元测试：`tests/engine/test_live.py`（中断的运行以自身重启，已结束的不能；`armed.json` 不变）、`test_live_entry.py`（中断撤入场、留持仓和止损）、`test_live_gate.py`（保持期间 30 秒读一次、空仓后结束；时长从第一次 armed 算起；无时长不停）、`tests/live/test_runs.py`（中断的运行可以再启动，有结束事件就拒绝；一小时 3 次上限；超过上限只记一次、不启动）、`test_views.py`、`test_notify.py`。
- 没有验证：真实 Docker 里 runner 被 SIGTERM/SIGKILL 后 control 重新拉起的全过程；Redis 缓存在真实重启后的原生对账结果。这些要真实账户试验。

## 真实账户跨重启试验（用户执行，需单独授权）

前提：第 3、4 步合并、CI 发出新运行镜像、用户发版本并部署；账户空仓；Telegram 已设置。

1. 空仓中断：Live 页面小预算启动、不填时长。空仓时在主机上 `docker stop <runner 容器>`（SIGTERM）。
   期望：`events.jsonl` 有 `interrupted`；10 秒内 control 起一个新的 runner 容器（`lifecycle.jsonl` 新的 `launch_requested`），`events.jsonl` 有 `resuming`（held=false），之后预热、正常交易；Telegram 两条（中断、重启）。
2. 带持仓中断：等源码开仓（交易所上有止损）后同样 `docker stop`。
   期望：交易所持仓和止损不动；重启后 `resuming`（held=true），不入场；Telegram 立即收到持仓只由交易所止损保护的通知，Live 页面显示同样的提示（手机为 Holding）；用户在币安手动平仓并撤止损后 30 秒内 `venue_flat_while_held`，再一次重启后正常交易。
3. 被杀：`docker kill <runner 容器>`（SIGKILL）。期望与 1 相同，只是没有 `interrupted` 事件。
4. 限次：一小时内连续中断 4 次。期望：第 4 次后不再重启，`restart_limited` 和 Telegram；用户在页面上停止或对账。
