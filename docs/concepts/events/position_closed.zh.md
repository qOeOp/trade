# PositionClosed

`PositionClosed` 表示持仓已关闭。当一次成交使持仓变为零时，`ExecutionEngine` 会发出此事件
（参阅[从成交到持仓](index.md#from-fill-to-position-the-causal-chain)）。处理器：`on_position_closed`。

## 字段

`PositionClosed` 使用持仓事件的公共字段集。有关三个事件的完整字段矩阵，请参阅
[持仓事件字段](index.md#position-event-fields)。`PositionClosed` 的区别字段如下：

| 字段               | Python 类型     | 说明                               |
| ------------------ | --------------- | ---------------------------------- |
| `closing_order_id` | `ClientOrderId` | 关闭持仓的客户端订单 ID。          |
| `avg_px_close`     | `float`         | 平均平仓价格。                     |
| `realized_return`  | `float`         | 该持仓的已实现收益率。             |
| `realized_pnl`     | `Money`         | 该持仓最终的已实现盈亏。           |
| `duration_ns`      | `int`           | 持仓总时长（纳秒）。               |
| `ts_closed`        | `int`           | 持仓关闭时的 UNIX 时间戳（纳秒）。 |

平仓时，`side` 为 `FLAT`，且 `unrealized_pnl` 为零。

## 示例

在策略处理器中读取事件：

```python
def on_position_closed(self, event: PositionClosed) -> None:
    self.log.info(
        f"Closed {event.instrument_id}: realized={event.realized_pnl} "
        f"return={event.realized_return}",
    )
```

## 相关指南

- [事件](index.md) - 事件类别、分派及从成交到持仓的因果链。
- [持仓](../positions.md) - 持仓生命周期、聚合与盈亏。
- [订单](../orders/) - 其成交会打开和关闭持仓的订单。
