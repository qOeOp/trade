# OrderRejected

`OrderRejected` 表示订单已被交易场所拒绝。`ExecutionEngine` 将该事件应用于订单、
更新 `Cache`，并在 `MessageBus` 上发布。当交易场所拒绝已提交的订单时，会触发此事件。

状态转换：`SUBMITTED` -> `REJECTED`。处理器：`on_order_rejected`。

## 字段

除[订单事件公共字段](index.md#common-order-event-fields)外，`OrderRejected` 还携带：

| 字段            | Python 类型 | 必填/默认值 | 说明                                                 |
| --------------- | ----------- | ----------- | ---------------------------------------------------- |
| `reason`        | `str`       | 必填        | 订单被拒的原因。                                     |
| `due_post_only` | `bool`      | `False`     | 是否因订单仅做挂单且会以吃单方身份立即执行而被拒绝。 |

在此事件中，`account_id` 已填充，`venue_order_id` 为 `None`，且 `reconciliation`
携带真实值。

## 示例

在策略处理器中读取事件：

```python
def on_order_rejected(self, event: OrderRejected) -> None:
    self.log.warning(f"Order {event.client_order_id} rejected: {event.reason}")
```

## 相关指南

- [事件](index.md) - 事件类别、分派及订单事件公共字段。
- [订单](../orders/) - 订单类型与状态机。
