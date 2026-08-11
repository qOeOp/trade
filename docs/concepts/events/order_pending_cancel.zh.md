# OrderPendingCancel

`OrderPendingCancel` 表示 `CancelOrder` 命令已发送至交易场所。`ExecutionEngine`
将该事件应用于订单、更新 `Cache`，并在 `MessageBus` 上发布。当系统分派取消请求并等待
交易场所确认时，会触发此事件。

状态转换：`ACCEPTED` -> `PENDING_CANCEL`。处理器：`on_order_pending_cancel`。

## 字段

`OrderPendingCancel` 仅携带[订单事件公共字段](index.md#common-order-event-fields)。在此事件中，`venue_order_id` 和
`account_id` 通常已填充，但也可能为 `None`，且 `reconciliation` 携带真实值。

## 示例

在策略处理器中读取事件：

```python
def on_order_pending_cancel(self, event: OrderPendingCancel) -> None:
    self.log.info(f"Cancel pending for {event.client_order_id}")
```

## 相关指南

- [事件](index.md) - 事件类别、分派及订单事件公共字段。
- [订单](../orders/) - 订单类型与状态机。
