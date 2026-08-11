# Kraken

Kraken 为多种数字资产提供现货和衍生品交易。此集成连接 Kraken Pro，支持为 Kraken Spot 和
Kraken Derivatives（期货）接入实时市场数据并执行订单。

## 概览

此适配器使用 Rust 实现，并提供 Python 绑定，便于在基于 Python 的工作流中使用。它不依赖外部
Kraken 客户端库；核心组件会编译为静态库，并在构建过程中自动链接。

本指南假定交易者需要同时配置实时市场数据馈送和交易执行。Kraken 适配器包含多个组件，
可根据用例组合使用或单独使用。

- `KrakenSpotRawHttpClient` 和 `KrakenFuturesRawHttpClient`：底层 HTTP API 连接。
- `KrakenSpotHttpClient` 和 `KrakenFuturesHttpClient`：支持金融工具缓存和对账的高级 HTTP 客户端。
- `KrakenInstrumentProvider`：金融工具解析和加载功能。
- `KrakenDataClient`：市场数据馈送管理器。
- `KrakenExecutionClient`：账户管理与交易执行网关。
- `KrakenDataClientFactory`：Kraken 数据客户端工厂（供交易节点构建器使用）。
- `KrakenExecutionClientFactory`：Kraken 执行客户端工厂（供交易节点构建器使用）。

:::note
大多数用户会为实盘交易节点定义配置（如下所示），无需直接操作这些底层组件。
:::

## 示例

- [Python 示例](https://github.com/qOeOp/trade/tree/main/examples/live/kraken/)
- [Rust 示例](https://github.com/qOeOp/trade/tree/main/crates/adapters/kraken/examples/)

## Kraken 文档

Kraken 为用户提供了详细文档：

- [Kraken API 文档](https://docs.kraken.com/api/)
- [Kraken Spot REST API](https://docs.kraken.com/api/docs/guides/spot-rest-intro)
- [Kraken Futures REST API](https://docs.kraken.com/api/docs/futures-api)

请结合 Kraken 文档与本 VibeTrader 集成指南阅读。

## 产品

Kraken 支持两大产品类别：

| 产品类型          | 支持 | 说明                                         |
| ----------------- | ---- | -------------------------------------------- |
| 现货              | ✓    | 标准加密货币交易对，支持保证金。             |
| 期货（永续）      | ✓    | 反向（`PI_`）和美元保证金（`PF_`）永续掉期。 |
| 期货（定期/灵活） | ✓    | 固定到期（`FI_`）和灵活（`FF_`）合约。       |

:::note
**每个客户端仅支持一种产品类型**：每个 Kraken 数据客户端或执行客户端只配置一种 `product_type`
（`SPOT` 或 `FUTURES`）；单个客户端不会同时跨越两个市场。
:::

## K 线流

### 支持的周期

Kraken 适配器支持通过 WebSocket 为现货市场传输实时 K 线（OHLC）。可用周期如下：

| 周期    | BarType 规范     |
| ------- | ---------------- |
| 1 分钟  | `1-MINUTE-LAST`  |
| 5 分钟  | `5-MINUTE-LAST`  |
| 15 分钟 | `15-MINUTE-LAST` |
| 30 分钟 | `30-MINUTE-LAST` |
| 1 小时  | `1-HOUR-LAST`    |
| 4 小时  | `4-HOUR-LAST`    |
| 1 天    | `1-DAY-LAST`     |
| 1 周    | `1-WEEK-LAST`    |
| 15 天   | `15-DAY-LAST`    |

:::note
**期货限制**：Kraken Futures 不支持通过 WebSocket 传输 K 线。请改用 `request_bars()` 获取历史 K 线数据。
:::

### K 线发出延迟

Kraken 的 WebSocket OHLC 频道会在每笔成交发生时推送*当前*（尚未完成）K 线的更新。与部分交易所
（例如 Binance）不同，Kraken 不提供"is_closed"指示器来标明 K 线是否完成。

为了避免发出局部或未完成的 K 线，适配器会缓存当前 K 线，并仅在下一周期开始时（即收到带有新
`interval_begin` 时间戳的消息时）发出。这意味着：

- K 线的发出延迟最多为一个 K 线周期。
- 对于 1 分钟 K 线，最大延迟约为 1 分钟。
- 发出的 K 线数据完整且已最终确定。

我们选择这种方式而不是基于定时器发出，原因如下：

- 基于定时器发出可能错过 K 线收盘前的最后一次更新。
- Kraken 不保证更新恰好在周期边界到达。
- 缓存以增加延迟为代价，确保数据完整性。

:::warning
如果 K 线延迟对策略很重要，请考虑使用逐笔成交数据，并通过 `BarAggregator` 在本地聚合 K 线。
:::

:::tip
对于大多数用例，我们建议使用 `INTERNAL` K 线聚合（订阅成交并在本地聚合 K 线），而不是交易所提供的
`EXTERNAL` K 线：

- K 线一旦完成便立即发出，无缓存延迟。
- 所有交易所的行为一致，可简化多交易场所策略。

:::

## 符号体系

### 比特币符号格式（BTC 与 XBT）

Kraken 的不同 API 对比特币采用不同的符号约定：

| 市场 | 符号格式 | 示例               | 说明                                |
| ---- | -------- | ------------------ | ----------------------------------- |
| 现货 | `BTC`    | `BTC/USD.KRAKEN`   | 适配器在加载时将 XBT 规范化为 BTC。 |
| 期货 | `XBT`    | `PI_XBTUSD.KRAKEN` | 使用 Kraken 原生 XBT 格式。         |

:::note
Kraken 的 REST API 对比特币返回 `XBT`（遵循 ISO 4217 对超国家货币的约定），但其 WebSocket v2 API
要求使用 `BTC` 格式。加载金融工具时，无论 XBT 是基础货币（例如从 `XBT/USD` 转为 `BTC/USD`）还是
报价货币（例如从 `ETH/XBT` 转为 `ETH/BTC`），适配器都会自动将现货符号规范化为 `BTC`。
期货则保留 Kraken 原生的 `XBT` 格式。
:::

### 现货市场

VibeTrader 对 Kraken Spot 金融工具符号使用 ISO 4217-A3 格式，在不同交易所间提供标准化表示。
适配器会在内部处理到 Kraken 原生格式的转换。

**金融工具 ID 格式：**

```python
InstrumentId.from_str("BTC/USD.KRAKEN")  # Spot BTC/USD
InstrumentId.from_str("ETH/USD.KRAKEN")  # Spot ETH/USD
InstrumentId.from_str("SOL/USD.KRAKEN")  # Spot SOL/USD
InstrumentId.from_str("BTC/USDT.KRAKEN")  # Spot BTC/USDT
InstrumentId.from_str("ETH/BTC.KRAKEN")  # Spot ETH/BTC (normalized from ETH/XBT)
```

### 期货市场

Kraken Futures 金融工具采用带前缀的特定命名约定：

- `PI_` - 永续反向合约（例如 `PI_XBTUSD`）
- `PF_` - 永续固定保证金合约（例如 `PF_XBTUSD`）
- `FI_` - 固定到期反向合约（例如 `FI_XBTUSD_230929`）
- `FF_` - 灵活期货合约

**金融工具 ID 格式：**

```python
InstrumentId.from_str("PI_XBTUSD.KRAKEN")  # Perpetual inverse BTC
InstrumentId.from_str("PI_ETHUSD.KRAKEN")  # Perpetual inverse ETH
InstrumentId.from_str("PF_XBTUSD.KRAKEN")  # Perpetual fixed-margin BTC
```

## 数据能力

### 订阅（实时）

| 数据类型            | 现货 | 期货 | 说明                                   |
| ------------------- | ---- | ---- | -------------------------------------- |
| `QuoteTick`         | ✓    | ✓    | 从 ticker 频道派生。                   |
| `TradeTick`         | ✓    | ✓    |                                        |
| `OrderBookDeltas`   | ✓    | ✓    | 现货 L2/L3 和期货 L2 更新。            |
| `OrderBookDepth10`  | -    | -    | 使用深度为 `10` 的 `OrderBookDeltas`。 |
| `Bar`               | ✓    | -    | 现货 WS OHLC 频道。请参阅 K 线章节。   |
| `MarkPriceUpdate`   | -    | ✓    | 来自期货 ticker 数据馈送。             |
| `IndexPriceUpdate`  | -    | ✓    | 来自期货 ticker 数据馈送。             |
| `FundingRateUpdate` | -    | ✓    | 仅限永续合约。                         |
| `InstrumentStatus`  | ✓    | ✓    | 适配器轮询金融工具刷新。               |

### 请求（历史）

| 数据类型            | 现货 | 期货 | 说明                               |
| ------------------- | ---- | ---- | ---------------------------------- |
| `TradeTick`         | ✓    | ✓    |                                    |
| `Bar`               | ✓    | ✓    |                                    |
| `OrderBook`（快照） | ✓    | ✓    | 通过 HTTP 深度端点。               |
| `FundingRateUpdate` | -    | ✓    | 客户端侧的开始/结束/数量限制筛选。 |

## L3 订单簿（逐笔委托）

Kraken 通过 `wss://ws-l3.kraken.com/v2` 上的 WebSocket v2 `level3` 频道公开现货逐笔委托订单簿数据。
其中包括交易场所订单 ID、逐笔订单数量和真正的增量事件（`add`、`modify`、`delete`）。适配器会将每个
交易场所订单 ID 散列为 VibeTrader 所用 `u64` 类型的 `BookOrder.order_id` 字段。

### 前置条件

L3 订阅需要现货 API 凭证，因为 Kraken 的 `level3` 频道需要认证。请在 `KrakenDataClientConfig` 中设置，
或通过 `KRAKEN_SPOT_API_KEY` 和 `KRAKEN_SPOT_API_SECRET` 设置：

```python
from vibe_trader.adapters.kraken import KrakenDataClientConfig

config = KrakenDataClientConfig(
    api_key="YOUR_KEY",
    api_secret="YOUR_SECRET",
)
```

然后使用 `book_type=BookType.L3_MBO` 进行订阅：

```python
from vibe_trader.model import BookType

await client.subscribe_book_deltas(
    instrument_id=instrument_id,
    book_type=BookType.L3_MBO,
    depth=1000,  # valid: 10, 100, 1000
)
```

有效深度为 `10`、`100` 和 `1000`。`depth` 为 `0` 时使用 `1000`。

### CRC32 校验和验证

默认情况下，只要 Kraken 提供校验和，适配器就会验证每个 L3 快照和更新的 CRC32 校验和。如果不匹配，
适配器会发出 `Clear` 增量、清除本地 L3 状态、刷新认证令牌并重新订阅，以便 Kraken 发送新快照。
如需为基准测试禁用验证：

```python
config = KrakenDataClientConfig(
    api_key="...",
    api_secret="...",
    validate_l3_checksum=False,
)
```

### 存储建议

`OrderBookDelta` 的 Arrow 模式已包含 `order_id: u64`，因此 L3 数据在 `ParquetDataCatalog` 中的存储方式
与 L2 完全相同。L3 为每个金融工具生成的事件明显多于 L2。建议设置如下：

- 使用较小的分块大小（例如 `chunk_size=50_000`），以加快并行读取。
- 在目录配置中启用 `zstd` 压缩。
- 按金融工具划分路径分区（默认启用）。

## 订单能力

### 订单类型

| 订单类型               | 现货 | 期货 | 说明                                      |
| ---------------------- | ---- | ---- | ----------------------------------------- |
| `MARKET`               | ✓    | ✓    | 按市场价格立即执行。                      |
| `LIMIT`                | ✓    | ✓    | 按指定价格或更优价格执行。                |
| `STOP_MARKET`          | ✓    | ✓    | 条件市价单（止损）。                      |
| `MARKET_IF_TOUCHED`    | ✓    | ✓    | 条件市价单（止盈）。                      |
| `STOP_LIMIT`           | ✓    | ✓    | 条件限价单（止损限价）。                  |
| `LIMIT_IF_TOUCHED`     | ✓    | ✓    | 映射到带 `limit_price` 的 `take_profit`。 |
| `TRAILING_STOP_MARKET` | ✓    | -    | 带 `trailing_offset` 的追踪止损。         |
| `TRAILING_STOP_LIMIT`  | ✓    | -    | 带 `limit_offset` 的追踪止损限价单。      |

### 有效期类型

| 有效期类型 | 现货 | 期货 | 说明                                             |
| ---------- | ---- | ---- | ------------------------------------------------ |
| `GTC`      | ✓    | ✓    | 撤销前有效。                                     |
| `GTD`      | ✓    | -    | 指定日期前有效（仅限现货，需要 `expire_time`）。 |
| `IOC`      | ✓    | ✓    | 立即成交或取消。                                 |
| `FOK`      | ✓    | -    | 仅限现货限价单。                                 |

:::note
**市价单**本身会立即执行，不支持有效期类型。`IOC` 仅适用于限价类订单。
:::

### 执行指令

| 指令             | 现货 | 期货 | 说明                                                    |
| ---------------- | ---- | ---- | ------------------------------------------------------- |
| `post_only`      | ✓    | ✓    | 可用于限价单。                                          |
| `reduce_only`    | ✓    | ✓    | 现货要求 `spot_account_type=Margin`（仅限保证金订单）。 |
| `quote_quantity` | ✓    | -    | 仅限现货。以报价货币计量数量（`viqc`）。                |
| `display_qty`    | ✓    | -    | 仅限现货。冰山订单（`displayvol`）。                    |

### 触发类型

条件订单（止损、止盈、追踪止损）在现货市场支持选择触发价格参考：

| 触发类型      | 现货 | 期货 | 说明                   |
| ------------- | ---- | ---- | ---------------------- |
| `LAST_PRICE`  | ✓    | ✓    | 默认值。最新成交价。   |
| `INDEX_PRICE` | ✓    | ✓    | 更广泛的市场指数价格。 |
| `MARK_PRICE`  | -    | ✓    | 仅限期货。             |

:::note
适配器会在提交时拒绝不支持的触发类型（例如 `BID_ASK`），而不会静默转换。
:::

### 批量操作

| 操作     | 现货 | 期货 | 说明                                           |
| -------- | ---- | ---- | ---------------------------------------------- |
| 批量提交 | ✓    | ✓    | 现货每批 15 个订单。期货每批 10 个。           |
| 批量修改 | -    | ✓    | 仅期货 HTTP 辅助方法。执行层每次发送一条命令。 |
| 批量取消 | ✓    | ✓    | 自动拆分为每批 50 个。                         |

:::note
**取消全部订单**：

- 不支持按订单方向筛选；无论方向如何，都会取消所有订单。
- 现货：取消所有符号的全部未结订单。
- 期货：需要 `instrument_id`；仅取消该符号的订单。

:::

### 持仓管理

| 功能       | 现货 | 期货 | 说明                                                     |
| ---------- | ---- | ---- | -------------------------------------------------------- |
| 查询持仓   | ✓    | ✓    | 现货保证金使用 `OpenPositions`；现货现金模式需选择启用。 |
| 持仓模式   | -    | -    | 每个金融工具一个持仓。                                   |
| 杠杆控制   | ✓    | ✓    | 现货档位；逐订单 `params={"leverage": N}`。              |
| 保证金模式 | ✓    | ✓    | 现货/期货全仓保证金；现货不支持逐仓保证金。              |

### 订单查询

| 功能         | 现货 | 期货 | 说明                                  |
| ------------ | ---- | ---- | ------------------------------------- |
| 查询未结订单 | ✓    | ✓    | 列出所有活动订单。                    |
| 查询订单历史 | ✓    | ✓    | 带分页的历史订单数据。                |
| 订单状态更新 | ✓    | ✓    | 通过 WebSocket 实时接收订单状态变化。 |
| 成交历史     | ✓    | ✓    | 执行报告和成交报告。                  |

### 条件关联订单

| 功能     | 现货 | 期货 | 说明             |
| -------- | ---- | ---- | ---------------- |
| 订单列表 | -    | -    | *不支持*。       |
| OCO 订单 | -    | -    | *不支持*。       |
| 括号订单 | -    | -    | *不支持*。       |
| 条件订单 | ✓    | ✓    | 止损和止盈订单。 |

## 订单路由（现货）

现货执行客户端默认通过 Kraken 已认证的 WebSocket v2 交易频道路由 `submit_order`、`modify_order`、
`cancel_order` 和 `submit_order_list`，WebSocket 未激活时则回退到 REST。在 `KrakenExecClientConfig`
中设置 `use_ws_trade=False`，即可通过 REST 路由所有订单操作。

### 通过 REST 路由的订单形态

部分现货订单形态始终通过 REST 路由。它们分为两类：Kraken WS v2 API 完全不支持的形态，
以及 WS API 支持但此适配器尚未编码的形态。

**Kraken WS v2 限制：**

| 形态             | 原因                                            |
| ---------------- | ----------------------------------------------- |
| 不支持的触发类型 | `triggers.reference` 仅接受 `last` 和 `index`。 |
| 混合符号订单列表 | `batch_add` 要求所有订单共享同一符号。          |

**此适配器尚未编码（后续工作，目前使用 REST）：**

| 形态                      | 说明                                                                          |
| ------------------------- | ----------------------------------------------------------------------------- |
| `FOK` 有效期类型          | 可编码为 `FOK` 有效期类型，但构建器会路由到 REST。                            |
| 追踪止损 / 止损限价       | 可通过 `triggers.price` + `triggers.price_type` 编码，但构建器会路由到 REST。 |
| 冰山订单（`display_qty`） | 可编码为 `order_type: "iceberg"` + `display_qty`，但构建器会路由到 REST。     |
| 报价货币数量订单          | 买入市价单的报价数量映射到 `cash_order_qty`；目前路由到 REST。                |

逐次调用时设置 `params={"use_ws_trade": False}`，可强制单条命令通过 REST，而不受配置默认值影响。
可以在 `SubmitOrder`、`ModifyOrder`、`CancelOrder` 或 `SubmitOrderList` 上设置。

### WebSocket 请求超时

当 WebSocket 往返时间超过 `ws_request_timeout_secs`（默认 `5`）时，分派器会将命令结果视为未知，
并使订单保持当前的传输中状态：

- 提交 / batch_add：分派器可能通过同一个 WebSocket 尽力发送补偿性 `cancel_order`，以免交易场所延迟接受后
  留下孤立订单。
- 修改：订单保持 `PENDING_UPDATE`。
- 取消：订单保持 `PENDING_CANCEL`。

超时本身不会发出 `OrderRejected`、`OrderModifyRejected` 或 `OrderCancelRejected`。如果交易场所实际已接受
命令，则通过 WebSocket 订单更新或实盘执行对账引擎（`open_check_interval_secs`）恢复。

:::tip
请将 `ws_request_timeout_secs` 设置为明显高于实际观测到的往返延迟（默认值 `5` 约为典型延迟的 25 倍），
使超时只在真实网络故障时触发。
:::

### WebSocket 订单路由选项

`KrakenExecClientConfig` 提供以下选项：

| 选项                      | 默认值 | 说明                                   |
| ------------------------- | ------ | -------------------------------------- |
| `use_ws_trade`            | `True` | 交易频道活跃时通过 WS 路由订单。       |
| `ws_request_timeout_secs` | `5`    | 将命令结果标记为未知前的 WS 往返超时。 |

## 对账

Kraken 适配器为现货和期货市场提供对账能力，使交易者可以在启动或运行期间同步本地状态与交易所状态。

### 现货对账

**订单状态报告：**

- 未结订单：获取所有当前活动订单。
- 已关闭订单：通过分页获取历史订单。
- 限定时间的查询：支持按开始/结束时间戳筛选。

**成交报告：**

- 成交历史：通过分页获取执行历史。
- 限定时间的查询：支持按开始/结束时间戳筛选。
- 所有成交类型：市价单、限价单和条件订单的成交。

**保证金持仓报告**（当 `spot_account_type=Margin` 时）：

- 未平持仓：从 `POST /0/private/OpenPositions` 获取，并按（交易对、方向）聚合为 `PositionStatusReport` 条目。
- 合成 FLAT 清理：如果本地缓存中有未平的现货保证金持仓，但交易场所不再返回该持仓（Kraken 会从
  `OpenPositions` 中省略已平持仓），适配器会在下一次持仓检查 tick 发出合成 FLAT 报告，使引擎对账为已平仓。
- 保证金余额：刷新账户状态时还会调用 `POST /0/private/TradeBalance`；已用保证金填充
  `MarginBalance.initial`，其余指标写入 `AccountState.info`（参阅现货保证金交易）。

### 期货对账

**订单状态报告：**

- 未结订单：获取所有当前活动的期货订单。
- 历史订单：当 `open_only=False` 时获取已关闭和已成交订单。
- 订单事件：通过 `/api/history/v2/orders` 端点获取完整的订单生命周期历史。

**成交报告：**

- 成交历史：获取所有执行报告。
- 时间筛选：在客户端侧按开始/结束时间戳筛选（解析 RFC3339 时间戳）。
- 所有成交类型：包含费用信息的挂单方和吃单方成交。

**持仓状态报告：**

- 未平持仓：获取所有活动的期货持仓。
- 实时数据：包含未实现资金费用、平均价格和持仓数量。

:::note
**期货时间筛选**：Kraken Futures 成交端点不支持服务端时间范围筛选。适配器通过解析 `fillTime` 字段，
并与请求的开始/结束时间戳比较，在客户端侧实现筛选。
:::

### 现货持仓报告（现金模式）

在现金模式下，Kraken 适配器可选择将钱包余额报告为现货金融工具的持仓状态报告。此功能默认关闭，
必须通过配置显式启用。保证金模式账户应保持关闭，并改用 `OpenPositions`（参阅现货保证金交易）。

**工作原理：**

- 启用后，钱包余额会转换为 `PositionStatusReport` 对象。
- 正余额报告为 `LONG` 持仓。
- 仅报告与已配置报价货币匹配的金融工具（默认：`USDT`）。
- 这样可以避免同一资产存在多种报价货币时产生重复报告（例如 BTC/USD、BTC/USDT、BTC/EUR）。

**配置：**

```python
from vibe_trader.adapters.kraken import KrakenExecClientConfig
from vibe_trader.model import AccountId
from vibe_trader.model import TraderId


exec_config = KrakenExecClientConfig(
    trader_id=TraderId.from_str("TRADER-001"),
    account_id=AccountId.from_str("KRAKEN-001"),
    api_key="YOUR_API_KEY",
    api_secret="YOUR_API_SECRET",
    use_spot_position_reports=True,
    spot_positions_quote_currency="USDT",  # Default
)
```

:::warning
**请谨慎使用**：如果策略并非为处理现货持仓而设计，启用现货持仓报告可能导致意外行为。例如，
预期平仓的策略可能尝试卖出钱包中的资产。
:::

## 现货保证金交易

Kraken Spot 支持对部分交易对进行杠杆交易。Kraken 会在金融工具端点通过
`AssetPairInfo.leverage_buy` 和 `leverage_sell` 公布各交易对是否可用及有效杠杆档位；适配器会在加载
金融工具时缓存这些信息，并在提交订单前验证请求的档位。通过执行客户端的 `spot_account_type` 启用保证金交易，
并用逐订单 `leverage` 参数指定杠杆。

### 配置

```python
from vibe_trader.adapters.kraken import KrakenExecClientConfig
from vibe_trader.model import AccountId
from vibe_trader.model import AccountType
from vibe_trader.model import TraderId


exec_config = KrakenExecClientConfig(
    trader_id=TraderId.from_str("TRADER-001"),
    account_id=AccountId.from_str("KRAKEN-001"),
    api_key="YOUR_API_KEY",
    api_secret="YOUR_API_SECRET",
    spot_account_type=AccountType.MARGIN,
    default_leverage=3,  # Optional config-level default
    margin_balance_asset="ZGBP",  # Optional summary-display asset
)
```

`margin_balance_asset` 仅控制 Kraken `TradeBalance` 端点返回的账户汇总指标（净值、可用保证金、
已用保证金等）的计价单位。来自 `OpenPositions` 的逐持仓数据始终以所交易货币对的报价货币计价。

### 逐订单杠杆

可通过 `params` 为单个订单覆盖已配置的默认值：

```python
order = strategy.order_factory.limit(
    instrument_id=BTC_USD,
    order_side=OrderSide.BUY,
    quantity=Quantity.from_str("0.01"),
    price=Price.from_str("50000.00"),
    params={"leverage": 5},
)
```

提交前，适配器会根据该交易对的 `AssetPairInfo.leverage_buy` / `leverage_sell` 验证请求的档位；
无效档位会产生 `OrderDenied` 事件，且绝不会发送到交易场所。

### 只减仓

保证金订单可以携带 `reduce_only=True`；如果不存在匹配持仓，Kraken 会拒绝该订单。现金订单忽略此标志。

### 账户状态

当 `spot_account_type=Margin` 时，适配器会调用 Kraken 的 `TradeBalance` 端点，并在两处公开结果：

- `MarginBalance.initial`：已用保证金（`m`）。
- `AccountState.info` 字典：完整的 `TradeBalance` 快照：
  - `equity`：净值
  - `free_margin`：净值减已用保证金
  - `unrealized_pnl`：未平持仓损益
  - `margin_level`：有未平持仓时的净值 / 已用保证金（%）
  - `trade_balance`：存入的抵押品
  - `equivalent_balance`：多币种钱包折算后的等值余额
  - `cost_basis`、`valuation`、`unexecuted_value`、`used_margin`：原始 `TradeBalance` 字段
  - `asset`：解析后的计价资产（例如 `USD`、`GBP`）

每次刷新账户状态都会发出一条 INFO 日志：

```text
Margin metrics: equity=1234.56 GBP, free_margin=1100.00, unrealized_pnl=12.34
```

策略可通过 `account_state.info["equity"]` 等方式读取这些值。

### 持仓对账

每个 `position_check_interval_secs` tick 都会通过 `POST /0/private/OpenPositions` 公开未平现货保证金持仓。
如果交易场所的持仓已平，但本地缓存仍显示未平，则会在下一轮扫描时对账为 FLAT。此路径独立于
`use_spot_position_reports`（后者从钱包派生，且仅适用于现金模式）。

## 资金费率

适配器从 [Ticker](https://docs.kraken.com/api/docs/futures-api/websocket/ticker) WebSocket 数据馈送接收
资金费率数据，其中为永续期货提供 `relative_funding_rate` 和 `next_funding_rate_time`。

对于 Kraken，`FundingRateUpdate` 的 `interval` 字段为 `None`，因为 ticker 数据馈送不包含资金费率周期字段，
Kraken API 文档也未指定固定的资金费率周期。

## 速率限制

适配器实现自动速率限制，以符合 Kraken API 要求。

| 端点类型          | 限制（请求/秒） | 说明                      |
| ----------------- | --------------- | ------------------------- |
| 现货 REST（全局） | 5               | 现货 API 的全局速率限制。 |
| 期货 REST（全局） | 5               | 期货 API 的全局速率限制。 |

:::info
Kraken 采用按账户层级确定限制的计数器限流系统：

- **Starter 层级**：计数器最大值 15，以 -0.33/秒衰减
- **Intermediate 层级**：计数器最大值 20，以 -0.5/秒衰减
- **Pro 层级**：计数器最大值 20，以 -1/秒衰减

账本/成交历史调用会使计数器增加 +2；其他调用增加 +1。
:::

:::warning
Kraken 可能会临时封禁超过速率限制的 IP 地址。接近限制时，适配器会自动将请求排队。
:::

### 对账间隔指南

执行引擎的 `open_check_interval_secs` 和 `position_check_interval_secs` 设置会持续产生 REST API 负载，
可能耗尽 Kraken 基于计数器的速率限制；Starter 层级尤其如此，其计数器仅以 0.33/秒衰减。每次未结订单检查会
产生 1-3 次 REST 调用（每次使计数器增加 +1 或 +2），在间隔较短时，计数器会在衰减前溢出，导致
`EAPI:Rate limit exceeded` 错误。

Kraken 建议设置如下：

```python
exec_engine = LiveExecEngineConfig(
    reconciliation=True,
    open_check_interval_secs=30.0,  # 30s minimum for Starter tier
    position_check_interval_secs=120.0,  # 2 minutes
)
```

计数器衰减更快的高级账户可以使用更短的间隔。如果日志中出现 `EAPI:Rate limit exceeded` 错误，
请增大这些间隔，或降低适配器配置中的 `max_requests_per_second`。

## 配置

每个客户端的产品类型通过 `product_type` 选项指定。

### 数据客户端配置选项

| 选项                      | 默认值    | 说明                                               |
| ------------------------- | --------- | -------------------------------------------------- |
| `product_type`            | `SPOT`    | 此客户端的产品类型（`SPOT` 或 `FUTURES`）。        |
| `environment`             | `LIVE`    | 交易环境（`LIVE` 或 `DEMO`）；演示环境仅限期货。   |
| `api_key`                 | `None`    | API 密钥；省略时从环境变量加载。                   |
| `api_secret`              | `None`    | API Secret；省略时从环境变量加载。                 |
| `base_url`                | `None`    | Kraken REST 基础 URL 的覆盖值。                    |
| `ws_public_url`           | `None`    | 公开 WebSocket URL 的覆盖值。                      |
| `ws_private_url`          | `None`    | 私有 WebSocket URL 的覆盖值。                      |
| `ws_l3_url`               | `None`    | 现货 L3 WebSocket URL 的覆盖值。                   |
| `validate_l3_checksum`    | `True`    | 验证 Kraken Spot L3 校验和，并在不匹配时重新同步。 |
| `proxy_url`               | `None`    | 可选的 HTTP 和 WebSocket 传输代理 URL。            |
| `timeout_secs`            | `30`      | HTTP 请求超时秒数。                                |
| `heartbeat_interval_secs` | `30`      | WebSocket 心跳间隔秒数。                           |
| `ws_idle_timeout_ms`      | `10000`   | 现货 v2 WebSocket 空闲超时；`0` 表示禁用。         |
| `max_requests_per_second` | `None`    | 速率限制覆盖值；默认为 5 req/s。                   |
| `transport_backend`       | `Sockudo` | WebSocket 传输后端。                               |

### 执行客户端配置选项

| 选项                            | 默认值    | 说明                                              |
| ------------------------------- | --------- | ------------------------------------------------- |
| `api_key`                       | required  | Kraken API 密钥。                                 |
| `api_secret`                    | required  | Kraken API Secret。                               |
| `product_type`                  | `SPOT`    | 此客户端的产品类型（`SPOT` 或 `FUTURES`）。       |
| `environment`                   | `LIVE`    | 交易环境（`LIVE` 或 `DEMO`）；演示环境仅限期货。  |
| `base_url`                      | `None`    | Kraken REST 基础 URL 的覆盖值。                   |
| `ws_url`                        | `None`    | Kraken WebSocket URL 的覆盖值。                   |
| `proxy_url`                     | `None`    | 可选的 HTTP 和 WebSocket 传输代理 URL。           |
| `timeout_secs`                  | `30`      | HTTP 请求超时秒数。                               |
| `heartbeat_interval_secs`       | `30`      | WebSocket 心跳间隔秒数。                          |
| `max_requests_per_second`       | `None`    | 速率限制覆盖值；默认为 5 req/s。                  |
| `spot_account_type`             | `CASH`    | 现货交易账户类型；`MARGIN` 启用杠杆和报告。       |
| `default_leverage`              | `None`    | 设置后，以 `"N:1"` 发送默认现货保证金杠杆。       |
| `use_spot_position_reports`     | `False`   | 将钱包余额报告为持仓；仅限现金模式。              |
| `spot_positions_quote_currency` | `"USDT"`  | 现货钱包持仓报告的报价货币筛选条件。              |
| `margin_balance_asset`          | `None`    | `TradeBalance` 的汇总资产；`None` 默认为 `ZUSD`。 |
| `transport_backend`             | `Sockudo` | WebSocket 传输后端。                              |

对于现货保证金，如果订单没有逐订单杠杆参数，则应用 `default_leverage`。`margin_balance_asset` 只改变
`TradeBalance` 的汇总计价单位；逐持仓数据仍以交易对的报价货币计价。

### 演示环境设置

要使用 Kraken Futures 演示环境（模拟交易）进行测试：

1. 在 [https://demo-futures.kraken.com](https://demo-futures.kraken.com) 注册并生成 API 凭证。
2. 使用演示凭证设置环境变量：
   - `KRAKEN_FUTURES_DEMO_API_KEY`
   - `KRAKEN_FUTURES_DEMO_API_SECRET`
3. 使用 `environment=KrakenEnvironment.DEMO` 和 `product_type=KrakenProductType.FUTURES` 配置适配器。

[Python 示例](https://github.com/qOeOp/trade/tree/main/examples/live/kraken/)展示了完整的演示和实盘
`LiveNode` 配置。

### 生产配置

将 `KrakenDataClientConfig` 与 `KrakenDataClientFactory` 搭配使用，将 `KrakenExecClientConfig` 与
`KrakenExecutionClientFactory` 搭配使用。当前 Python 示例展示了数据客户端和执行客户端的完整
`LiveNode.builder(...)` 配置。

### API 凭证

可通过两种方式向 Kraken 客户端提供凭证：将相应的 `api_key` 和 `api_secret` 值传给配置对象，
或设置以下环境变量：

| 环境变量                         | 说明                               |
| -------------------------------- | ---------------------------------- |
| `KRAKEN_SPOT_API_KEY`            | Kraken Spot 实盘交易 API 密钥。    |
| `KRAKEN_SPOT_API_SECRET`         | Kraken Spot 实盘交易 API Secret。  |
| `KRAKEN_FUTURES_API_KEY`         | Kraken Futures 实盘 API 密钥。     |
| `KRAKEN_FUTURES_API_SECRET`      | Kraken Futures 实盘 API Secret。   |
| `KRAKEN_FUTURES_DEMO_API_KEY`    | Kraken Futures（演示）API 密钥。   |
| `KRAKEN_FUTURES_DEMO_API_SECRET` | Kraken Futures（演示）API Secret。 |

:::note
**演示环境**：只有 Kraken Futures 提供无需真实资金即可测试的演示环境
（`https://demo-futures.kraken.com`）。Kraken Spot 没有演示或测试网环境。
:::

:::tip
建议使用环境变量管理凭证。
:::

启动交易节点时，系统会立即确认凭证是否有效以及是否具备交易权限。

## 贡献

:::info
如需添加功能或为 Kraken 适配器贡献代码，请参阅我们的
[贡献指南](https://github.com/qOeOp/trade/blob/main/CONTRIBUTING.md)。
:::
