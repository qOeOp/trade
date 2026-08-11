# PositionOpened

`PositionOpened` 表示持仓已打开。当一次成交创建新持仓时，`ExecutionEngine` 会发出此事件
（参阅[从成交到持仓](index.md#from-fill-to-position-the-causal-chain)）。处理器：`on_position_opened`。

## 字段

`PositionOpened` 使用持仓事件的公共字段集。有关三个事件的完整字段矩阵，请参阅
[持仓事件字段](index.md#position-event-fields)。`PositionOpened` 的区别字段如下：

| 字段           | Python 类型    | 说明                                |
| -------------- | -------------- | ----------------------------------- |
| `entry`        | `OrderSide`    | 打开持仓的入场订单方向。            |
| `side`         | `PositionSide` | 当前持仓方向（`LONG` 或 `SHORT`）。 |
| `quantity`     | `Quantity`     | 当前未平仓数量。                    |
| `avg_px_open`  | `float`        | 平均开仓价格。                      |
| `realized_pnl` | `Money`        | 该持仓的已实现盈亏。                |

开仓时，`closing_order_id` 为 `None`，`avg_px_close` 和 `realized_return` 为零。

## 示例

在策略处理器中读取事件：

```python
def on_position_opened(self, event: PositionOpened) -> None:
    self.log.info(
        f"Opened {event.side} {event.quantity} {event.instrument_id} @ {event.avg_px_open}",
    )
```

## 相关指南

- [事件](index.md) - 事件类别、分派及从成交到持仓的因果链。
- [持仓](../positions.md) - 持仓生命周期、聚合与盈亏。
- [订单](../orders/) - 其成交会打开和关闭持仓的订单。
