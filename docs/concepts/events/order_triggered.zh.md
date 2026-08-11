# OrderTriggered

`OrderTriggered` 表示订单已在交易场所触发。`ExecutionEngine` 将该事件应用于订单、
更新 `Cache`，并在 `MessageBus` 上发布。当限价式条件订单（`StopLimit`、
`LimitIfTouched` 或 `TrailingStopLimit`）满足触发条件时，会触发此事件。

状态转换：`ACCEPTED` -> `TRIGGERED`。处理器：`on_order_triggered`。

## 字段

`OrderTriggered` 仅携带[订单事件公共字段](index.md#common-order-event-fields)。在此事件中，`venue_order_id` 和 `account_id`
通常已填充，但也可能为 `None`，且 `reconciliation` 携带真实值。

## 示例

在策略处理器中读取事件：

```python
def on_order_triggered(self, event: OrderTriggered) -> None:
    self.log.info(f"Order {event.client_order_id} triggered")
```

## 相关指南

- [事件](index.md) - 事件类别、分派及订单事件公共字段。
- [订单](../orders/) - 订单类型与状态机。
