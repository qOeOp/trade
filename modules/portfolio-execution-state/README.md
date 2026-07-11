# Portfolio Execution State

本域拥有真钱交易事件与可重建投影。

当前已抽出：

- `event-store`: `trade.db.plan_event` schema、append/read、唯一 event write owner。
- `flow-projector`: active flow、lane conflict、position/order projection，可由 event store 重建。

其他域不得直接写 `trade.db`。跨域只传 event write request、projection ref、idempotency key 与 schema-valid result。
