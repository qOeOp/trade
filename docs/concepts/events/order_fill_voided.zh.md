# OrderFillVoided

`OrderFillVoided` 记录先前报告的全部或部分成交不再具有经济效力。`ExecutionEngine`
将更正应用于订单和持仓，随后刷新投资组合中的持仓与盈亏缓存，再将事件发布到 `MessageBus`。
交易场所适配器从其权威账户端点刷新账户余额。

该更正会就地更新缓存的持仓聚合值。它不会合成 `PositionChanged` 或 `PositionClosed`；
更正后的缓存状态可用后，策略会收到 `OrderFillVoided`。

更正并非一笔方向相反的成交。它保留原始成交标识，使重放、对账和策略审计历史能够直接描述
交易场所的操作。

处理器：`on_order_fill_voided`。

## 契约

对于所引用的 `trade_id`，`voided_qty` 和 `commission_voided` 是累计值。数量更正不能减少。
对于已在本地应用的成交，费用更正也不能减少，后续修订可以增加任一数值，或在数量相同时
更改 `is_reopened`。重复、过时以及作废量过大的更正都会被拒绝。

Vibe 如何解释更正，取决于本地订单历史中是否已有所引用的 `OrderFilled`：

| 成交是否在本地 | `is_reopened` | 结果                                                   |
| -------------- | ------------- | ------------------------------------------------------ |
| 是             | `false`       | 应用；更正的数量不会重新成为可执行数量。               |
| 是             | `true`        | 应用；更正的数量重新成为可执行数量，但受终态规则约束。 |
| 否             | `false`       | 应用；整个订单以零剩余量进入终态。                     |
| 否             | `true`        | 拒绝。                                                 |

引用成交未在本地应用且未重新打开订单的更正，是订单级终态断言。即使 `voided_qty` 小于订单数量，这一点仍然成立：
该值记录的是失效的成交数量，而不是可执行剩余量。事件必须与订单标识匹配，不能超过订单数量，
也不能作废非零佣金。没有本地成交时，Vibe 不会冲销持仓或账户敞口。

### 适配器要求

- 在重新打开的更正，或任何应让订单保持可执行的部分更正之前，发布并持久化所引用的
  `OrderFilled`。重放会强制执行与实盘处理相同的顺序。
- 只有在整个订单已由权威信息确认进入终态时，才可在没有其引用成交的情况下发出更正。
- 不要依靠后续处于工作状态的 `OrderStatusReport` 修复事件顺序。若没有明确的作废证据，
  持续对账会忽略工作状态报告中的成交减少；`VOIDED` 不会重新打开订单；快照对账只根据
  保留的成交派生更正。

### 存在本地成交时的状态行为

默认情况下，更正的数量不会重新变为可执行：

- 已成交订单会进入终态 `VOIDED`，即使仍保留部分有效成交数量。
- 部分成交订单保留原本已处于工作状态的剩余量。其状态根据仍然有效的成交推导，
  其剩余量不包含未重新打开的作废数量。
- 已取消或已到期的订单保持其终态。
- `is_reopened=true` 的更正还会使更正数量重新计入可执行剩余量。没有有效成交时，
  订单推导为 `ACCEPTED`；仍有部分数量有效时，则推导为 `PARTIALLY_FILLED`。

无论更正路径如何，`VOIDED` 都是终态。后续成交、取消、更新、更正及工作状态报告均不会
重新打开该订单。

:::note
模式通过追加此事件和状态来保持现有记录不变。旧版 v2 读取器无法识别新值，
因此应先升级消费者，再让其读取更正后的数据流或数据目录数据。
:::

## 字段

除[订单事件公共字段](index.md#common-order-event-fields)外，`OrderFillVoided`
还携带：

| 字段                | Python 类型                | 必填/默认值 | 说明                             |
| ------------------- | -------------------------- | ----------- | -------------------------------- |
| `correction_id`     | `str`                      | 必填        | 此次更正修订的标识。             |
| `trade_id`          | `TradeId`                  | 必填        | 原始交易场所成交 ID。            |
| `voided_qty`        | `Quantity`                 | 必填        | 该成交的累计失效数量。           |
| `commission_voided` | `Money` or `None`          | `None`      | 该成交的累计费用更正。           |
| `order_side`        | `OrderSide`                | 必填        | 原始成交的方向。                 |
| `order_type`        | `OrderType`                | 必填        | 原始订单的类型。                 |
| `last_px`           | `Price`                    | 必填        | 原始成交的价格。                 |
| `currency`          | `Currency`                 | 必填        | 原始成交价格的货币。             |
| `liquidity_side`    | `LiquiditySide`            | 必填        | 原始成交的流动性方向。           |
| `position_id`       | `PositionId` or `None`     | `None`      | 与原始成交关联的持仓 ID。        |
| `reason`            | `str` or `None`            | `None`      | 交易场所或对账提供的更正原因。   |
| `info`              | `dict[str, str]` or `None` | `None`      | 其他交易场所更正元数据。         |
| `is_reopened`       | `bool`                     | `False`     | 交易场所是否证明订单可再次执行。 |

## 示例

```python
def on_order_fill_voided(self, event: OrderFillVoided) -> None:
    self.log.warning(
        f"Corrected {event.trade_id}: voided={event.voided_qty} reopened={event.is_reopened}",
    )
```

## 相关指南

- [执行](../execution.md) - 更正应用与发布顺序。
- [OrderFilled](order_filled.md) - 原始成交事件。
- [订单](../orders/) - 订单状态与状态流。
