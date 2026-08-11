# OrderSubmitted

`OrderSubmitted` 表示订单已由系统提交至交易场所。`ExecutionEngine` 将该事件应用于订单、
更新 `Cache`，并在 `MessageBus` 上发布。当系统将订单发送至交易场所并等待确认时，
会触发此事件。

状态转换：`INITIALIZED` / `RELEASED` -> `SUBMITTED`。处理器：`on_order_submitted`。

## 字段

`OrderSubmitted` 仅携带[订单事件公共字段](index.md#common-order-event-fields)。在此事件中，`account_id` 已填充，
`venue_order_id` 尚未分配（`None`），且 `reconciliation` 始终为 `False`。

## 示例

在策略处理器中读取事件：

```python
def on_order_submitted(self, event: OrderSubmitted) -> None:
    self.log.info(f"Order {event.client_order_id} submitted ({event.account_id})")
```

## 相关指南

- [事件](index.md) - 事件类别、分派及订单事件公共字段。
- [订单](../orders/) - 订单类型与状态机。
