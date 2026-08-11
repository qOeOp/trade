# OrderFilled

`OrderFilled` 表示订单已在交易所成交。`ExecutionEngine` 将该事件应用于订单、
更新 `Cache`，并在 `MessageBus` 上发布。当交易场所报告订单发生部分或全部执行时，
会触发此事件，继而驱动持仓事件。

状态转换：`ACCEPTED` -> `FILLED` / `PARTIALLY_FILLED`。处理器：`on_order_filled`。

## 字段

除[订单事件公共字段](index.md#common-order-event-fields)外，`OrderFilled` 还携带：

| 字段             | Python 类型            | 必填/默认值 | 说明                                                        |
| ---------------- | ---------------------- | ----------- | ----------------------------------------------------------- |
| `trade_id`       | `TradeId`              | 必填        | 成交撮合 ID（由交易场所分配）。                             |
| `position_id`    | `PositionId` or `None` | 必填        | 与该成交关联的持仓 ID（由交易场所分配）。                   |
| `order_side`     | `OrderSide`            | 必填        | 执行订单方向。                                              |
| `order_type`     | `OrderType`            | 必填        | 执行订单类型。                                              |
| `last_qty`       | `Quantity`             | 必填        | 本次执行的成交数量。                                        |
| `last_px`        | `Price`                | 必填        | 本次执行的成交价格（并非平均价格）。                        |
| `currency`       | `Currency`             | 必填        | 成交价格的货币。                                            |
| `commission`     | `Money`                | 必填        | 成交佣金。                                                  |
| `liquidity_side` | `LiquiditySide`        | 必填        | 执行流动性方向（`MAKER`、`TAKER` 或 `NO_LIQUIDITY_SIDE`）。 |
| `info`           | `dict[str, object]`    | `None`      | 其他成交信息（省略时强制转换为 `{}`）。                     |

在此事件中，`venue_order_id` 和 `account_id` 均已填充，且 `reconciliation`
携带真实值。

## 示例

在策略处理器中读取事件：

```python
def on_order_filled(self, event: OrderFilled) -> None:
    self.log.info(
        f"Filled {event.last_qty} @ {event.last_px} "
        f"({event.liquidity_side}) commission={event.commission}",
    )
```

## 相关指南

- [事件](index.md) - 事件类别、分派及订单事件公共字段。
- [持仓](../positions.md) - 由成交创建和修改的持仓。
- [订单](../orders/) - 订单类型与状态机。
