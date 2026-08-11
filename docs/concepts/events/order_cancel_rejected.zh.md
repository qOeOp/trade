# OrderCancelRejected

`OrderCancelRejected` 表示 `CancelOrder` 命令被交易场所拒绝。`ExecutionEngine`
将该事件应用于订单、更新 `Cache`，并在 `MessageBus` 上发布。当交易场所拒绝取消请求时，
会触发此事件。

状态转换：`PENDING_CANCEL` -> 先前状态（例如 `ACCEPTED`）。处理器：
`on_order_cancel_rejected`。

## 字段

除[订单事件公共字段](index.md#common-order-event-fields)外，`OrderCancelRejected` 还携带：

| 字段     | Python 类型 | 必填/默认值 | 说明                 |
| -------- | ----------- | ----------- | -------------------- |
| `reason` | `str`       | 必填        | 订单取消被拒的原因。 |

在此事件中，`venue_order_id` 和 `account_id` 通常已填充，但也可能为 `None`，
且 `reconciliation` 携带真实值。

## 示例

在策略处理器中读取事件：

```python
def on_order_cancel_rejected(self, event: OrderCancelRejected) -> None:
    self.log.warning(
        f"Cancel rejected for {event.client_order_id}: {event.reason}",
    )
```

## 相关指南

- [事件](index.md) - 事件类别、分派及订单事件公共字段。
- [订单](../orders/) - 订单类型与状态机。
