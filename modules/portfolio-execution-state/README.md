# Portfolio Execution State

本域拥有真钱交易事件与可重建投影，是实盘状态的账本域。

当前已抽出：

- `event-store`: `trade.db.plan_event` schema、append/read、chain scan、latest order-fill lookup、唯一 event write owner。
- `flow-projector`: active flow、lane conflict、latest slow observe、position/order/risk projection，可由 event store 重建。

## Access rule

其他域不得直接写 `trade.db`，生产代码也不得跨域 import 本域 `src/lib/*`。

跨域只允许通过 owner tool / protocol bus 传递 event write request、projection query、projection ref、idempotency key 与 schema-valid result。测试可以 import 本域库作为行为锚点，但不能把测试捷径复制到生产路径。
