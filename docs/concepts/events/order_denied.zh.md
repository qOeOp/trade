# OrderDenied

`OrderDenied` 表示订单已被 Vibe 系统否决。`ExecutionEngine` 将该事件应用于订单、
更新 `Cache`，并在 `MessageBus` 上发布。当一个原本有效的订单因风险限额或功能不受支持等原因
无法提交时，会触发此事件。

状态转换：`INITIALIZED` -> `DENIED`。处理器：`on_order_denied`。

## 字段

除[订单事件公共字段](index.md#common-order-event-fields)外，`OrderDenied` 还携带：

| 字段     | Python 类型 | 必填/默认值 | 说明               |
| -------- | ----------- | ----------- | ------------------ |
| `reason` | `str`       | 必填        | 订单被否决的原因。 |

在此事件中，`venue_order_id` 和 `account_id` 均为 `None`，`reconciliation` 始终为
`False`，且 `ts_event` 等于 `ts_init`。

## 示例

在策略处理器中读取事件：

```python
def on_order_denied(self, event: OrderDenied) -> None:
    self.log.warning(f"Order {event.client_order_id} denied: {event.reason}")
```

## 相关指南

- [事件](index.md) - 事件类别、分派及订单事件公共字段。
- [执行](../execution.md) - 风险检查与订单被否决的原因。
- [订单](../orders/) - 订单类型与状态机。
