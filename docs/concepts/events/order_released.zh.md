# OrderReleased

`OrderReleased` 表示订单已从 `OrderEmulator` 释放。`ExecutionEngine` 将该事件应用于订单、
更新 `Cache`，并在 `MessageBus` 上发布。当模拟器的触发价格条件满足、订单被释放到
交易场所时，会触发此事件。

状态转换：`EMULATED` -> `RELEASED`。处理器：`on_order_released`。

## 字段

除[订单事件公共字段](index.md#common-order-event-fields)外，`OrderReleased` 还携带：

| 字段             | Python 类型 | 必填/默认值 | 说明                       |
| ---------------- | ----------- | ----------- | -------------------------- |
| `released_price` | `Price`     | 必填        | 促使模拟器释放订单的价格。 |

在此事件中，`venue_order_id` 和 `account_id` 均为 `None`，`reconciliation` 始终为
`False`，且 `ts_event` 等于 `ts_init`。

## 示例

在策略处理器中读取事件：

```python
def on_order_released(self, event: OrderReleased) -> None:
    self.log.info(
        f"Order {event.client_order_id} released at {event.released_price}",
    )
```

## 相关指南

- [事件](index.md) - 事件类别、分派及订单事件公共字段。
- [模拟订单](../orders/emulated.md) - 本地模拟生命周期。
