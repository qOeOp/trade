# OrderUpdated

`OrderUpdated` 表示订单已在交易场所更新。`ExecutionEngine` 将该事件应用于订单、
更新 `Cache`，并在 `MessageBus` 上发布。当交易场所确认数量、价格或触发价格已修改时，
会触发此事件。

状态转换：`PENDING_UPDATE` -> 先前状态（例如 `ACCEPTED`）。处理器：
`on_order_updated`。

## 字段

除[订单事件公共字段](index.md#common-order-event-fields)外，`OrderUpdated` 还携带：

| 字段                | Python 类型       | 必填/默认值 | 说明                         |
| ------------------- | ----------------- | ----------- | ---------------------------- |
| `quantity`          | `Quantity`        | 必填        | 订单当前数量。               |
| `price`             | `Price` or `None` | 必填        | 订单当前价格。               |
| `trigger_price`     | `Price` or `None` | 必填        | 订单当前触发价格。           |
| `is_quote_quantity` | `bool`            | `False`     | 订单数量是否以计价货币计量。 |

在此事件中，`venue_order_id` 和 `account_id` 通常已填充，但也可能为 `None`，
且 `reconciliation` 携带真实值。

## 示例

在策略处理器中读取事件：

```python
def on_order_updated(self, event: OrderUpdated) -> None:
    self.log.info(
        f"Order {event.client_order_id} updated: qty={event.quantity} price={event.price}",
    )
```

## 相关指南

- [事件](index.md) - 事件类别、分派及订单事件公共字段。
- [订单](../orders/) - 订单类型与状态机。
