# OrderEmulated

`OrderEmulated` 表示订单已由 Vibe 系统模拟。`ExecutionEngine` 将该事件应用于订单、
更新 `Cache`，并在 `MessageBus` 上发布。当 `OrderEmulator` 接管订单并在本地模拟时，
会触发此事件。

状态转换：`INITIALIZED` -> `EMULATED`。处理器：`on_order_emulated`。

## 字段

`OrderEmulated` 仅携带[订单事件公共字段](index.md#common-order-event-fields)。在此事件中，`venue_order_id` 和 `account_id`
均为 `None`，`reconciliation` 始终为 `False`，且 `ts_event` 等于 `ts_init`。

## 示例

在策略处理器中读取事件：

```python
def on_order_emulated(self, event: OrderEmulated) -> None:
    self.log.info(f"Order {event.client_order_id} is now emulated locally")
```

## 相关指南

- [事件](index.md) - 事件类别、分派及订单事件公共字段。
- [模拟订单](../orders/emulated.md) - 本地模拟生命周期。
