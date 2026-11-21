# Live 下单结果不明（2026-11-21）

上接 [Live 只读 REST 读取的有界重试](live-rest-retry-20261121.zh.md)、[0.5.0 全量重判](rejudge-0.5-20261121.zh.md) C-141 与 doctor 索引 20261114-29（L-11）。

## 决定

- 2026-11-21，用户委托：「需要我定的部份最后也是一样由你决定按推荐做」。改变下单失败的判定属于改检查，按推荐做。
- `engine/live_node.py` 设 `submission_recovery_policy=SubmissionRecoveryPolicy.RETAIN_UNRESOLVED`：rc7 在途检查（约 30 秒）用完后不再本地判拒，订单留在 `SUBMITTED`，也不再自动逐单查询。
- 产品补上查询与上限（`engine/live_session.py` `follow_submissions`，Observer 每秒调用）：
  - 订单 `SUBMITTED` 满 10 秒起，每 10 秒原生 `Strategy.query_order` 一次；同时以 `unverified` 关入场（不撤已挂的入场单），订单落定且两次与交易所比对一致后重开，与断线重连相同。
  - 满 120 秒仍 `SUBMITTED`：`submission_unresolved` 事件，运行标失败走 STOP；STOP 宽限 30 秒后结束，rc7 停止时报“提交恢复未完成”，运行记 `unresolved`。上限合计约 150 秒。

## 回环验证（`tests/live_loopback`，#3334 的假交易所，无真实 Binance、无凭据）

同一探针源码、同一情形，main（`RESOLVE_LOCALLY`）与本改动对照：

| 情形 | main | 本改动 |
|---|---|---|
| 交易所收单并成交，应答、用户流、订单查询都丢 60 秒 | 约 30 秒后本地 `OrderRejected INFLIGHT_TIMEOUT`，运行停止；交易所留 0.002 BTC 多仓、无止损，运行 `unresolved` 退出 | 订单留 `SUBMITTED`，入场关；查询恢复后 2 秒内落定为该单自己的成交（`OrderFilled`，同一 client order id）、开仓、挂上交易所止损；STOP 后交易所平、无挂单。期间 rc7 持仓检查记了 EXTERNAL 仓位，运行以 `unresolved` 结束 |
| 交易所收单挂着（不成交），同样丢应答 | `OrderAccepted`，STOP 干净结束 | 相同 |
| 下单根本没到交易所（503） | 约 30 秒后本地判拒，运行停止，干净结束 | 入场关；121 秒 `submission_unresolved`、走 STOP，约 31 秒后结束，`unresolved`，退出码 1；交易所无仓无单 |

第三种情形 main 的“干净结束”是猜对了：本地判拒与第一种情形无法区分，第一种里同样的判定留下无止损仓位。本改动对两者都不猜，结果不明就停在有上限的 `unresolved`。

## 已知限制

- 成交后应答长时间丢失时，rc7 的持仓检查（30 秒）会先把交易所仓位记成 EXTERNAL，订单落定后再记一笔反向 EXTERNAL；产品比对因此以 `foreign` 关入场到运行结束，停止时交易所已平但运行记 `unresolved`。这是 rc7 的对账行为，升级 Nautilus 时复测。
- 撤单结果不明仍由 rc7 本地判撤（无对应配置），见 C-139、D-155。
