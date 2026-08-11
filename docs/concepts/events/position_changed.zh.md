# PositionChanged

`PositionChanged` 表示持仓已发生变化。当后续成交改变未平仓持仓的数量或方向时，
`ExecutionEngine` 会发出此事件（参阅[从成交到持仓](index.md#from-fill-to-position-the-causal-chain)）。处理器：
`on_position_changed`。

## 字段

`PositionChanged` 使用持仓事件的公共字段集。有关三个事件的完整字段矩阵，请参阅
[持仓事件字段](index.md#position-event-fields)。`PositionChanged` 的区别字段如下：

| 字段              | Python 类型 | 说明                       |
| ----------------- | ----------- | -------------------------- |
| `peak_qty`        | `Quantity`  | 持仓达到的方向性峰值数量。 |
| `avg_px_close`    | `float`     | 截至目前的平均平仓价格。   |
| `realized_return` | `float`     | 该持仓的已实现收益率。     |
| `realized_pnl`    | `Money`     | 该持仓的已实现盈亏。       |
| `unrealized_pnl`  | `Money`     | 该持仓的未实现盈亏。       |

持仓保持未平仓时，`closing_order_id` 仍为 `None`。

## 示例

在策略处理器中读取事件：

```python
def on_position_changed(self, event: PositionChanged) -> None:
    self.log.info(
        f"Changed {event.instrument_id} to {event.signed_qty} (realized={event.realized_pnl})",
    )
```

## 相关指南

- [事件](index.md) - 事件类别、分派及从成交到持仓的因果链。
- [持仓](../positions.md) - 持仓生命周期、聚合与盈亏。
- [订单](../orders/) - 其成交会打开和关闭持仓的订单。
