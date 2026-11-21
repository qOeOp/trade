# Live 停止时重发 Binance 确定没收下的平仓（2026-11-21）

来源：[0.5.0 重判](rejudge-0.5-20261121.zh.md) D-155；doctor 20261121-42。

## 问题

Live 走 STOP 路径时，Observer 对每个仓位发一张平仓单，记进 `exits` 后不再发。平仓单被拒（例如快速行情里价格超出 PERCENT_PRICE），运行在 30 秒后以 `native_exit_timeout` 结束，仓位留在账户里，交易所上可能没有止损。行里提到的“开仓成交没有止损”已由覆盖检查兜底（90 秒无覆盖即走 STOP），不再另加 GTD 强制。

## 被拒原因（rc7 源码，`v2.0.0rc7`）

读 `crates/adapters/binance/src/futures/execution.rs` 与 `common/failure.rs`：

- `OrderRejected("submit-order-error: …")` 只在两种情况下发出：没发出去（校验、凭据），或 Binance 给了确定答复且错误码既不可重试也不含糊。这时交易所上肯定没有这张单。
- 429、5xx、超时、断线等含糊结果不发拒绝，单子留在途中等对账；对账查不清时本地判 `INFLIGHT_TIMEOUT`，这时交易所可能已经成交。

回环夹具（C-158，#3334）合入前没有跑原生回环探针；分类直接取自上面的源码分支，测试用假对象。

## 决定

2026-11-21，用户委托：「需要我定的部份最后也是一样由你决定按推荐做」。按推荐做：

- `submit-order-error:` 被拒的平仓在后续 tick 重发，每个仓位至多 3 次，每次记 `close_resent`。同样的答复多半会再来，次数用完就交给原有的超时。
- `INFLIGHT_TIMEOUT` 不重发：第二张平仓可能作用在已经平掉的仓位上。
- 被拒本身照旧让运行以失败结束；限频拒单（`OrderDenied`）的重发不变。
