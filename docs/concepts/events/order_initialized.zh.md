# OrderInitialized

`OrderInitialized` 表示订单已初始化。`ExecutionEngine` 将该事件应用于订单、
更新 `Cache`，并在 `MessageBus` 上发布。它是种子事件，携带足够的信息，
既可通过线路发送订单，也可完全一致地重建订单。

在本地创建，作为新订单的种子事件。处理器：`on_order_initialized`。

## 字段

除[订单事件公共字段](index.md#common-order-event-fields)外，`OrderInitialized` 还携带：

| 字段                    | Python 类型                     | 必填/默认值  | 说明                                            |
| ----------------------- | ------------------------------- | ------------ | ----------------------------------------------- |
| `side`                  | `OrderSide`                     | 必填         | 订单方向（公开为 `event.side`）。               |
| `order_type`            | `OrderType`                     | 必填         | 订单类型。                                      |
| `quantity`              | `Quantity`                      | 必填         | 订单数量。                                      |
| `time_in_force`         | `TimeInForce`                   | 必填         | 订单有效期类型。                                |
| `post_only`             | `bool`                          | 必填         | 订单是否只提供流动性（做市）。                  |
| `reduce_only`           | `bool`                          | 必填         | 订单是否带有"仅减仓"执行指令。                  |
| `quote_quantity`        | `bool`                          | 必填         | 订单数量是否以计价货币计量。                    |
| `options`               | `dict[str, str]`                | 必填         | 特定订单参数的订单初始化选项。                  |
| `emulation_trigger`     | `TriggerType`                   | `NO_TRIGGER` | 用于本地订单模拟的市场价格触发器。              |
| `trigger_instrument_id` | `InstrumentId` or `None`        | 必填         | 模拟触发金融工具 ID（默认为 `instrument_id`）。 |
| `contingency_type`      | `ContingencyType`               | 必填         | 订单或有类型。                                  |
| `order_list_id`         | `OrderListId` or `None`         | 必填         | 与订单关联的订单列表 ID。                       |
| `linked_order_ids`      | `list[ClientOrderId]` or `None` | 必填         | 关联的客户端订单 ID。                           |
| `parent_order_id`       | `ClientOrderId` or `None`       | 必填         | 订单的父客户端订单 ID。                         |
| `exec_algorithm_id`     | `ExecAlgorithmId` or `None`     | 必填         | 订单使用的执行算法 ID。                         |
| `exec_algorithm_params` | `dict[str, Any]` or `None`      | 必填         | 执行算法参数。                                  |
| `exec_spawn_id`         | `ClientOrderId` or `None`       | 必填         | 执行算法生成订单所对应的主客户端订单 ID。       |
| `tags`                  | `list[str]` or `None`           | 必填         | 订单的自定义用户标签。                          |

在此事件中，`venue_order_id` 和 `account_id` 均为 `None`，且 `ts_event` 等于
`ts_init`。这里的 `reconciliation` 属性始终返回 `False`，即使订单是在对账期间重建；
后续订单事件（例如 [`OrderAccepted`](order_accepted.md)）才会携带真实值。

## 示例

在策略处理器中读取事件：

```python
def on_order_initialized(self, event: OrderInitialized) -> None:
    self.log.info(
        f"Initialized {event.order_type} {event.side} {event.quantity} {event.instrument_id}",
    )
```

## 相关指南

- [事件](index.md) - 事件类别、分派及订单事件公共字段。
- [订单](../orders/) - 订单类型与状态机。
