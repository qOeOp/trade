# OrderExpired

`OrderExpired` 表示订单已在交易场所到期。`ExecutionEngine` 将该事件应用于订单、
更新 `Cache`，并在 `MessageBus` 上发布。当订单在交易场所达到其到期时间
（例如 GTD 订单）时，会触发此事件。

状态转换：`ACCEPTED` -> `EXPIRED`。处理器：`on_order_expired`。

## 字段

`OrderExpired` 仅携带[订单事件公共字段](index.md#common-order-event-fields)。在此事件中，`venue_order_id` 和 `account_id`
通常已填充，但也可能为 `None`，且 `reconciliation` 携带真实值。

## 示例

在策略处理器中读取事件：

```python
def on_order_expired(self, event: OrderExpired) -> None:
    self.log.info(f"Order {event.client_order_id} expired")
```

## 相关指南

- [事件](index.md) - 事件类别、分派及订单事件公共字段。
- [订单](../orders/) - 订单类型与状态机。
