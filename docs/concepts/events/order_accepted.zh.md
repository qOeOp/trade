# OrderAccepted

`OrderAccepted` 表示订单已被交易场所接受。`ExecutionEngine` 将该事件应用于订单、
更新 `Cache`，并在 `MessageBus` 上发布。当交易场所确认订单已收到且有效时
（通常对应 FIX `NEW` OrdStatus），会触发此事件。

状态转换：`SUBMITTED` -> `ACCEPTED`。处理器：`on_order_accepted`。

## 字段

`OrderAccepted` 仅携带[订单事件公共字段](index.md#common-order-event-fields)。在此事件中，`venue_order_id` 和 `account_id`
均已填充，`reconciliation` 携带真实值（默认为 `False`）。

## 示例

在策略处理器中读取事件：

```python
def on_order_accepted(self, event: OrderAccepted) -> None:
    self.log.info(
        f"Order {event.client_order_id} accepted as {event.venue_order_id}",
    )
```

## 相关指南

- [事件](index.md) - 事件类别、分派及订单事件公共字段。
- [订单](../orders/) - 订单类型与状态机。
