# BitMEX

BitMEX（Bitcoin Mercantile Exchange）成立于 2014 年，是一家加密货币衍生品交易平台，提供现货、
永续合约、传统期货、预测市场及其他高级交易产品。此集成支持接入 BitMEX 实时市场数据并执行订单。

## 概览

此适配器使用 Rust 实现，并提供可选 Python 绑定，便于在基于 Python 的工作流中使用。
它不依赖外部 BitMEX 客户端库；核心组件会编译为静态库，并在构建期间自动链接。

## 示例

- [Python 示例](https://github.com/qOeOp/trade/tree/main/examples/live/bitmex/)
- [Rust 示例](https://github.com/qOeOp/trade/tree/main/crates/adapters/bitmex/examples/)

## 组件

本指南假定交易者需要同时配置实时市场数据馈送和交易执行。BitMEX 适配器包含多个组件，
可根据用例组合使用或单独使用。

- `BitmexHttpClient`：底层 HTTP API 连接。
- `BitmexWebSocketClient`：底层 WebSocket API 连接。
- `BitmexInstrumentProvider`：金融工具解析与加载功能。
- `BitmexDataClient`：市场数据馈送管理器。
- `BitmexExecutionClient`：账户管理与交易执行网关。
- `BitmexDataClientFactory`：BitMEX 数据客户端工厂（供交易节点构建器使用）。
- `BitmexExecutionClientFactory`：BitMEX 执行客户端工厂（供交易节点构建器使用）。

:::note
大多数用户会为实盘交易节点定义配置（如下所示），无需直接操作这些底层组件。
:::

## BitMEX 文档

BitMEX 为用户提供了丰富的文档：

- [BitMEX API Explorer](https://www.bitmex.com/app/restAPI) - 交互式 API 文档。
- [BitMEX API 文档](https://www.bitmex.com/app/apiOverview) - 完整 API 参考。
- [BitMEX 交易所规则](https://www.bitmex.com/exchange-rules) - 官方交易所规则和监管条款。
- [合约指南](https://www.bitmex.com/app/contract) - 详细合约规范。
- [现货交易指南](https://www.bitmex.com/app/spotGuide) - 现货交易概览。
- [永续合约指南](https://www.bitmex.com/app/perpetualContractsGuide) - 永续掉期说明。
- [期货合约指南](https://www.bitmex.com/app/futuresGuide) - 传统期货信息。

建议结合 BitMEX 文档与本 VibeTrader 集成指南阅读。

## 产品支持

| 产品类型     | 数据馈送 | 交易 | 说明                                           |
| ------------ | -------- | ---- | ---------------------------------------------- |
| 现货         | ✓        | ✓    | 交易对有限，与衍生品共用统一钱包。             |
| 永续掉期     | ✓        | ✓    | 提供反向和线性合约。                           |
| 股票永续合约 | -        | -    | *尚不支持*。目前仅在测试网提供。               |
| 期货         | ✓        | ✓    | 传统固定到期合约。                             |
| Quanto 期货  | ✓        | ✓    | 以不同于标的资产的货币结算。                   |
| 预测市场     | ✓        | ✓    | 基于事件的合约，价格范围 0-100，以 USDT 结算。 |
| 期权         | -        | -    | *BitMEX 不提供*。                              |

:::note
BitMEX 已停止期权产品，以专注于核心衍生品和现货业务。
:::

### 现货交易

- 代币/币种直接交易，立即结算。
- 主要交易对包括 XBT/USDT、ETH/USDT、ETH/XBT。
- 其他山寨币交易对（LINK、SOL、UNI、APE、AXS、BMEX 对 USDT）。

### 衍生品

- **永续合约**：反向合约（例如 XBTUSD）和线性合约（例如 ETHUSDT）。
- **传统期货**：固定到期日合约。
- **Quanto 期货**：以不同于标的资产的货币结算的合约。
- **预测市场**：基于事件的衍生品（例如 P_FTXZ26、P_SBFJAILZ26），交易者可对加密货币、金融等领域的
  事件结果进行投机。不提供杠杆，价格范围 0-100，以 USDT 结算。
- **股票永续合约**：基于股票的永续合约（例如 SPYUSDT、CRCLUSDT）。*目前仅在测试网提供；此适配器尚不支持。*

### 金融工具类型代码（CFI）

BitMEX 使用遵循 ISO 10962 标准的 CFI（金融工具分类）代码。适配器识别以下金融工具类型代码：

| 代码     | 类型         | 状态   | 说明                                    |
| -------- | ------------ | ------ | --------------------------------------- |
| `FFWCSX` | 永续合约     | 支持   | 基于加密货币的永续掉期（例如 XBTUSD）。 |
| `FFWCSF` | 外汇永续合约 | 支持   | 基于外汇的永续合约。                    |
| `FFCCSX` | 期货         | 支持   | 固定到期的日历期货。                    |
| `FFICSX` | 预测市场     | 支持   | 基于事件的预测合约。                    |
| `IFXXXP` | 现货         | 支持   | 现货交易对。                            |
| `FFSCSX` | 股票永续合约 | 不支持 | 基于股票/权益的永续合约。仅测试网。     |
| `SRMCSX` | 掉期利率     | 不支持 | 基于收益率的掉期产品（历史产品）。      |
| `MR****` | 指数         | 参考   | BitMEX 指数（不可交易，用于价格参考）。 |

详情请参阅 [BitMEX Typ 值](https://support.bitmex.com/hc/en-gb/articles/6299296145565-What-are-the-Typ-Values-for-Instrument-endpoint)。

## 符号体系

BitMEX 对交易符号采用特定命名约定。理解该约定对于正确识别和交易金融工具至关重要。

### 符号格式

BitMEX 符号通常遵循以下模式：

- **现货交易对**：基础货币 + 报价货币（例如 `XBT/USDT`、`ETH/USDT`）。
- **永续合约**：基础货币 + 报价货币（例如 `XBTUSD`、`ETHUSD`）。
- **期货合约**：基础货币 + 到期代码（例如 `XBTM24`、`ETHH25`）。
- **Quanto 合约**：非美元结算合约采用特殊命名。
- **预测市场**：`P_` 前缀 + 事件标识符 + 到期代码（例如 `P_POWELLK26`、`P_FTXZ26`）。

:::info
BitMEX 使用 `XBT` 而不是 `BTC` 作为比特币符号。这遵循 ISO 4217 货币代码标准，其中"X"表示
非国家货币。XBT 和 BTC 指的是同一种资产--比特币。
:::

### 到期代码

期货合约使用标准期货月份代码：

- `F` = 1 月
- `G` = 2 月
- `H` = 3 月
- `J` = 4 月
- `K` = 5 月
- `M` = 6 月
- `N` = 7 月
- `Q` = 8 月
- `U` = 9 月
- `V` = 10 月
- `X` = 11 月
- `Z` = 12 月

后接年份（例如，`24` 表示 2024 年，`25` 表示 2025 年）。

### VibeTrader 金融工具 ID

在 VibeTrader 中，BitMEX 金融工具直接使用原生 BitMEX 符号，并与交易场所标识符组合：

```python
from vibe_trader.model import InstrumentId

# Spot pairs (note: no slash in the symbol)
spot_id = InstrumentId.from_str("XBTUSDT.BITMEX")  # XBT/USDT spot
eth_spot_id = InstrumentId.from_str("ETHUSDT.BITMEX")  # ETH/USDT spot

# Perpetual contracts
perp_id = InstrumentId.from_str("XBTUSD.BITMEX")  # Bitcoin perpetual (inverse)
linear_perp_id = InstrumentId.from_str("ETHUSDT.BITMEX")  # Ethereum perpetual (linear)

# Futures contract (June 2024)
futures_id = InstrumentId.from_str("XBTM24.BITMEX")  # Bitcoin futures expiring June 2024

# Prediction market contracts
prediction_id = InstrumentId.from_str(
    "P_XBTETFV23.BITMEX"
)  # Bitcoin ETF SEC approval prediction expiring October 2023
```

:::note
VibeTrader 中的 BitMEX 现货符号不包含 BitMEX UI 中出现的斜杠（/）。请使用 `XBTUSDT`，而不是 `XBT/USDT`。
:::

### 数量缩放

BitMEX 以*合约*为单位报告现货和衍生品数量。每份合约对应的实际资产数量由交易所决定，并在金融工具定义中公布：

- `lotSize` - 可交易的最少合约数量。
- `underlyingToPositionMultiplier` - 每单位标的资产对应的合约数量。

例如，SOL/USDT 现货金融工具（`SOLUSDT`）公开 `lotSize = 1000` 和
`underlyingToPositionMultiplier = 10000`，这意味着一份合约代表 `1 / 10000 = 0.0001` SOL，
最小订单（`lotSize * contract_size`）为 `0.1` SOL。适配器现在直接从这些字段派生合约大小，并相应缩放
入站市场数据和出站订单，因此 Vibe 中的数量始终以基础资产单位（SOL、ETH 等）表示。

这些字段的详细说明请参阅 BitMEX API 文档：<https://www.bitmex.com/app/apiOverview#Instrument-Properties>。

## 订单能力

BitMEX 集成支持以下订单类型和执行功能。

### 订单类型

| 订单类型               | 支持 | 说明                                                            |
| ---------------------- | ---- | --------------------------------------------------------------- |
| `MARKET`               | ✓    | 立即按当前市场价格执行。不支持报价货币数量。                    |
| `LIMIT`                | ✓    | 仅按指定价格或更优价格执行。                                    |
| `STOP_MARKET`          | ✓    | 支持（设置 `trigger_price`）。                                  |
| `STOP_LIMIT`           | ✓    | 支持（设置 `price` 和 `trigger_price`）。                       |
| `MARKET_IF_TOUCHED`    | ✓    | 支持（设置 `trigger_price`）。                                  |
| `LIMIT_IF_TOUCHED`     | ✓    | 支持（设置 `price` 和 `trigger_price`）。                       |
| `TRAILING_STOP_MARKET` | ✓    | 支持（设置 `trailing_offset`）。仅支持价格偏移类型。            |
| `TRAILING_STOP_LIMIT`  | ✓    | 支持（设置 `price` 和 `trailing_offset`）。仅支持价格偏移类型。 |

### 执行指令

| 指令          | 支持 | 说明                                                            |
| ------------- | ---- | --------------------------------------------------------------- |
| `post_only`   | ✓    | 在 `LIMIT` 订单上通过 `ParticipateDoNotInitiate` 执行指令支持。 |
| `reduce_only` | ✓    | 通过 `ReduceOnly` 执行指令支持。                                |

:::note
如果只挂单订单会跨越价差，BitMEX 会取消而非拒绝。此集成将其公开为带 `due_post_only=True` 的拒绝，
便于策略以一致方式处理。
:::

### 触发类型

BitMEX 支持为以下止损/条件订单选择多种参考价格来判断触发：

- `STOP_MARKET`
- `STOP_LIMIT`
- `MARKET_IF_TOUCHED`
- `LIMIT_IF_TOUCHED`

请选择符合策略和/或风险偏好的触发类型。

| 参考价格   | Vibe `TriggerType` | BitMEX 值    | 说明                                           |
| ---------- | ------------------ | ------------ | ---------------------------------------------- |
| 最新成交价 | `LAST_PRICE`       | `LastPrice`  | BitMEX 默认值；根据最新成交价触发。            |
| 标记价格   | `MARK_PRICE`       | `MarkPrice`  | 适用于许多止损用例，可减少价格尖峰导致的止损。 |
| 指数价格   | `INDEX_PRICE`      | `IndexPrice` | 跟踪外部指数；对部分合约有用。                 |

- 如果未提供 `trigger_type`，BitMEX 使用其交易场所默认值（`LastPrice`）。
- 这些触发参考由交易所判断；订单在触发前一直挂在交易场所。

**示例**：

```python
from vibe_trader.model import TriggerType

order = self.order_factory.stop_market(
    instrument_id=instrument_id,
    order_side=order_side,
    quantity=qty,
    trigger_price=trigger,
    trigger_type=TriggerType.MARK_PRICE,  # Use BitMEX Mark Price as reference
)
```

`ExecTester` 示例配置还在 [Python 执行测试器](https://github.com/qOeOp/trade/blob/main/examples/live/bitmex/exec_tester.py)
中演示了如何设置 `stop_trigger_type=TriggerType.MARK_PRICE`。

### 追踪止损

BitMEX 支持随市场向有利方向变动而自动调整止损价的追踪止损订单。适配器将 `TRAILING_STOP_MARKET` 和
`TRAILING_STOP_LIMIT` 订单映射为使用 `TrailingStopPeg` 价格类型的 BitMEX 挂钩订单；限价变体还会携带
限价 `price`。

**限制：**

- 仅支持 `PRICE` 追踪偏移类型（绝对价格偏移，不支持基点或 tick）。
- 自动处理偏移量符号：卖出止损使用负偏移，买入止损使用正偏移。
- 触发类型可以与追踪止损组合使用，以提供更多控制。

**示例**：

```python
from vibe_trader.model import TrailingOffsetType

order = self.order_factory.trailing_stop_market(
    instrument_id=instrument_id,
    order_side=OrderSide.SELL,
    quantity=qty,
    trailing_offset=Decimal("100"),  # $100 trailing offset
    trailing_offset_type=TrailingOffsetType.PRICE,
    trigger_type=TriggerType.LAST_PRICE,  # Optional
)
```

:::note
BitMEX 会随市场变动定期更新追踪止损价格。当市场朝触发价方向变动时，止损价会冻结。
当前更新频率详情请参阅 [BitMEX API 文档](https://www.bitmex.com/app/perpetualContractsGuide)。
:::

### 挂钩订单

BitMEX 支持自动跟踪参考价格的挂钩订单（BBO）。适配器通过 `submit_order` 上的 `params` 字典支持挂钩订单，
并在交易所侧将订单类型覆盖为 `Pegged`。

| 挂钩价格类型  | 说明                                                   |
| ------------- | ------------------------------------------------------ |
| `PrimaryPeg`  | 挂钩最优买价（买入）或最优卖价（卖出）。               |
| `MarketPeg`   | 挂钩对手方价格（买入挂钩最优卖价，卖出挂钩最优买价）。 |
| `MidPricePeg` | 挂钩买卖价之间的中间价。                               |
| `LastPeg`     | 挂钩最新成交价。                                       |

**要求**：

- 基础订单必须是 `LIMIT` 订单，其他订单类型会被拒绝。
- `peg_price_type` 必填；`peg_offset_value` 可选（默认为 0）。
- `peg_offset_value` 可以为负数（例如卖出侧偏移）或小数。

**示例**：

```python
# Pegged to best bid with zero offset (BBO)
order = self.order_factory.limit(
    instrument_id=instrument_id,
    order_side=OrderSide.BUY,
    quantity=qty,
    price=price,  # Required for LIMIT order, but overridden by peg
)
self.submit_order(order, params={"peg_price_type": "PrimaryPeg", "peg_offset_value": "0"})

# Pegged to mid-price with a -0.5 offset
self.submit_order(order, params={"peg_price_type": "MidPricePeg", "peg_offset_value": "-0.5"})
```

:::note
构造 `LimitOrder` 时仍需提供 `price` 字段，但 BitMEX 会在挂钩订单中忽略它，改为持续跟踪参考价格加偏移量。
:::

### 有效期类型

| 有效期类型 | 支持 | 说明                                         |
| ---------- | ---- | -------------------------------------------- |
| `GTC`      | ✓    | 撤销前有效（默认）。                         |
| `GTD`      | -    | *BitMEX 不支持*。                            |
| `FOK`      | ✓    | 全部成交或取消--整个订单全部成交，否则取消。 |
| `IOC`      | ✓    | 立即成交或取消--允许部分成交。               |
| `DAY`      | ✓    | 于 UTC 00:00 到期（BitMEX 交易日边界）。     |

:::note
`DAY` 订单于 UTC 00:00 到期，即 BitMEX 交易日边界（当日交易时间结束）。完整详情请参阅
[BitMEX 交易所规则](https://www.bitmex.com/exchange-rules)和 [API 文档](https://www.bitmex.com/api/explorer/)。
:::

### 高级订单功能

| 功能     | 支持 | 说明                                                             |
| -------- | ---- | ---------------------------------------------------------------- |
| 订单修改 | ✓    | 修改价格、数量和触发价。                                         |
| 括号订单 | ✓    | 使用 `contingency_type` 和 `linked_order_ids`。                  |
| 冰山订单 | ✓    | 使用 `display_qty`。                                             |
| 追踪止损 | ✓    | 使用 `trailing_offset`。仅支持价格偏移类型。                     |
| 挂钩订单 | ✓    | 在 `params` 中使用 `peg_price_type`。参阅[挂钩订单](#挂钩订单)。 |

### 批量操作

| 操作     | 支持 | 说明                       |
| -------- | ---- | -------------------------- |
| 批量提交 | -    | *BitMEX 不支持*。          |
| 批量修改 | -    | *BitMEX 不支持*。          |
| 批量取消 | ✓    | 在单次请求中取消多个订单。 |

### 持仓管理

| 功能       | 支持 | 说明                             |
| ---------- | ---- | -------------------------------- |
| 查询持仓   | ✓    | REST 和 WebSocket 实时持仓更新。 |
| 全仓保证金 | ✓    | 默认保证金模式。                 |
| 逐仓保证金 | ✓    |                                  |

### 订单查询

| 功能         | 支持 | 说明                                  |
| ------------ | ---- | ------------------------------------- |
| 查询未结订单 | ✓    | 列出所有活动订单。                    |
| 查询订单历史 | ✓    | 历史订单数据。                        |
| 订单状态更新 | ✓    | 通过 WebSocket 实时接收订单状态变化。 |
| 成交历史     | ✓    | 执行报告和成交报告。                  |

### 强平与 ADL 处理

BitMEX 通过 `execution` 频道的 `execType` 字段公开强制平仓成交：

| `execType`    | 含义                                                                    |
| ------------- | ----------------------------------------------------------------------- |
| `Trade`       | 正常执行（由用户或吃单方发起）。                                        |
| `Liquidation` | 持仓被强平引擎强制关闭。BitMEX 对自动减仓和对手方强平成交都使用此代码。 |
| `Bankruptcy`  | 账户破产；持仓与保险基金对手盘平仓。                                    |
| `Settlement`  | 计划内合约结算。                                                        |
| `Funding`     | 未平持仓的资金费用结算。                                                |

适配器通过标准 `FillReport` 路径处理 `Liquidation` 和 `Bankruptcy`，并在破产执行时记录警告。
BitMEX 的公开 API 在 `execType` 中**不会**区分自动减仓和对手方强平；二者均显示为 `Liquidation`。
ADL 平掉的持仓通常可通过零佣金且本地缓存中没有匹配订单来识别（引擎会为其创建外部订单）。

上游参考资料：

- [`/execution` 字段定义](https://support.bitmex.com/hc/en-gb/articles/6205689858077--execution-field-definitions)
- [自动减仓概览](https://support.bitmex.com/hc/en-gb/articles/18589621443357-What-is-Auto-Deleveraging)
- [强平概览](https://support.bitmex.com/hc/en-gb/articles/360003188434-Liquidations)

## 市场数据

- 订单簿增量：仅 `L2_MBP`；`depth` 为 0（完整订单簿）或 25。
- 订单簿十档深度快照：通过 `orderBook10` 频道提供固定 10 档。
- 通过 WebSocket 支持报价、成交和金融工具更新。
- 在适用时支持资金费率、标记价格和指数价格。
- REST 请求：
  - 当前 L2 订单簿快照，可选深度。
  - 逐笔成交，可选 `start`、`end` 和 `limit` 筛选条件（每次调用最多 1,000 条结果）。
  - 外部聚合 LAST 价格的时间 K 线（`1m`、`5m`、`1h`、`1d`），可选择包含未完成时间桶。
  - 资金费率，可选 `start`、`end` 和 `limit` 筛选条件。

:::note
BitMEX 各表的 REST 分页大小因端点而异。资金费率请求以每页 500 行分页，直到达到请求的数量限制或耗尽时间范围；
逐笔成交和 K 线请求目前每次请求返回一个交易场所页面，最多允许 1,000 行。
:::

### 成交 ID 派生

逐笔成交和成交报告使用交易场所提供的 `trdMatchID`（UUID）作为 `TradeId`。如果交易场所省略
`trdMatchID`（桶式成交或部分执行类型），执行路径回退到交易场所的 `execID`；市场数据解析器则回退到
由符号、`ts_event`、价格、数量和方向确定性计算的 FNV-1a 哈希。同一交易场所事件在重放时会产生相同的
成交 ID，从而保持下游去重有效。

## 连接管理

### HTTP Keep-Alive

BitMEX 适配器使用 HTTP keep-alive 以获得最佳性能：

- **连接池**：自动汇集并复用连接。
- **keep-alive 超时**：90 秒（与 BitMEX 服务端超时一致）。
- **自动重连**：失败的连接会自动重新建立。
- **SSL 会话缓存**：降低后续请求的握手开销。

此配置通过保持持久连接并避免每次请求都新建连接的开销，确保与 BitMEX 服务器进行低延迟通信。

### 请求认证与到期

BitMEX 使用 `api-expires` 请求头进行请求认证，以防止重放攻击：

- 已签名请求包含 `api-expires` Unix 时间戳，设为当前时间后 `recv_window_ms / 1000` 秒（默认 10 秒）。
- 时间戳过期后 BitMEX 会拒绝请求，因此请将延迟保持在配置窗口内。

## 资金费率

适配器从 [Funding](https://www.bitmex.com/app/wsAPI#Funding) WebSocket 数据流接收资金费率数据。
BitMEX 在每条消息中返回 `fundingInterval` 日期时间字段；适配器读取小时和分钟，计算
`FundingRateUpdate` 的 `interval` 字段。

## 速率限制

BitMEX 采用双层速率限制系统：

### REST 限制

- **突发限制**：认证用户每秒 10 个请求（适用于下单、修改和取消端点）。
- **滚动分钟限制**：认证用户每分钟 120 个请求（未认证用户每分钟 30 个）。
- **订单上限**：每个符号 200 个未结订单和 10 个止损订单；超过上限会触发交易所侧拒绝。

适配器使用配置的 `max_requests_per_second` 和 `max_requests_per_minute` 值在本地强制执行这些配额。

### WebSocket 限制

- 连接请求：遵循交易所指南（目前每个 IP 每秒 3 个连接）。
- 私有数据流需要认证；超过限制时适配器会自动重连。

:::warning
超过 BitMEX 速率限制会返回 HTTP 429，并可能触发临时 IP 封禁；持续出现 4xx/5xx 错误可能延长锁定时间。
:::

### 可配置速率限制

如果账户限制不同于默认值，可以配置速率限制：

| 参数                      | 默认值（已认证） | 默认值（未认证） | 说明                           |
| ------------------------- | ---------------- | ---------------- | ------------------------------ |
| `max_requests_per_second` | 10               | 10               | 每秒最大请求数（突发限制）。   |
| `max_requests_per_minute` | 120              | 30               | 每分钟最大请求数（滚动窗口）。 |

:::info
有关速率限制的更多信息，请参阅 [BitMEX API 速率限制文档](https://www.bitmex.com/app/restAPI#Limits)。
:::

:::warning
**取消广播器速率限制注意事项**

取消广播器（当 `canceller_pool_size > 1` 时）会将每个取消请求并行扇出到多个独立 HTTP 客户端。
每个客户端都有自己的限流器，因此实际请求速率会乘以池大小。

**示例**：当 `canceller_pool_size=3` 且 `max_requests_per_second=10` 时，单次取消操作消耗
**3 个请求**（每个客户端一个）；快速取消时可能达到**每秒 30 个请求**。

由于 BitMEX **按账户级别**（而非按连接）执行速率限制，广播器可能使请求超过交易所默认的
10 req/s 突发限制和 120 req/min 滚动窗口限制。

**缓解措施**：按比例降低 `max_requests_per_second` 和 `max_requests_per_minute`（除以
`canceller_pool_size`），或调整池本身的大小（参阅[取消广播器配置](#取消广播器)）。
未来版本可能支持池内共享限流器。
:::

### 速率限制响应头

BitMEX 通过响应头公开当前可用额度：

- `x-ratelimit-limit`：当前窗口允许的请求总数。
- `x-ratelimit-remaining`：触发限流前的剩余请求数。
- `x-ratelimit-reset`：额度重置时的 UNIX 时间戳。
- `retry-after`：收到 429 响应后应等待的秒数。

## 提交广播器

BitMEX 执行客户端包含提交广播器，通过并行扇出请求，提高市价单和限价单按目标价格被接受的把握，
其代价是以重复提交风险换取更低的最小延迟。

### 概念

订单提交对时间极其敏感：策略决定建仓后，任何延迟都可能导致错失机会或成交价格不利。提交广播器的处理方式如下：

- **并行扇出**：同时向多个独立 HTTP 客户端实例广播提交请求。
- **首次成功即短路**：首个成功响应胜出，最大限度降低接受延迟。
- **共享 client_order_id**：所有传输使用同一 `client_order_id`。BitMEX 会以"duplicate clOrdID"拒绝重复提交（记为预期拒绝）。
- **延迟与重复的权衡**：接受潜在重复成交风险（多个传输可能在拒绝前成功），换取更低最小延迟和更高接受把握。

该架构通过并行使用多条网络路径，降低订单被接受的最小延迟。

### 用法

提交广播器需要选择启用，通过提交订单时的 `submit_tries` 参数控制。默认通过单个 HTTP 客户端提交。
启用广播的方式如下：

```python
# Single submission (default behavior)
self.submit_order(order)

# Broadcast to 2 parallel HTTP clients for redundancy
self.submit_order(order, params={"submit_tries": 2})

# Broadcast to 3 parallel HTTP clients (maximum recommended)
self.submit_order(order, params={"submit_tries": 3})
```

**要点**：

- `submit_tries` 必须为正整数。
- 仅当 `submit_tries > 1` 时广播；默认提交使用单个 HTTP 客户端。
- 如果 `submit_tries` 超过 `submitter_pool_size`，将截断为池大小并发出警告。
- 所有传输使用同一 `client_order_id`；BitMEX 会将重复项作为预期拒绝处理。

### 健康监控

广播器池中的每个 HTTP 客户端都维护健康指标：

- 成功提交会将客户端标记为健康。
- 请求失败会增加错误计数器。
- 后台健康检查会定期验证客户端连接。
- 降级客户端会被跟踪，但仍留在池中以维持容错能力。

广播器公开总提交数、成功提交数、失败提交数和预期拒绝数等指标，用于运维监控和调试。

#### 跟踪的指标

| 指标                 | 类型    | 说明                                                                     |
| -------------------- | ------- | ------------------------------------------------------------------------ |
| `total_submits`      | `u64`   | 已发起的提交操作总数。                                                   |
| `successful_submits` | `u64`   | 成功收到 BitMEX 确认的提交操作数量。                                     |
| `failed_submits`     | `u64`   | 池中所有 HTTP 客户端均失败的提交操作数量（无健康客户端或所有请求失败）。 |
| `expected_rejects`   | `u64`   | 检测到的预期拒绝模式数量（例如并行提交产生的重复 clOrdID）。             |
| `healthy_clients`    | `usize` | 池中当前健康的 HTTP 客户端数量（通过近期健康检查的客户端）。             |
| `total_clients`      | `usize` | 池中配置的 HTTP 客户端总数（`submitter_pool_size`）。                    |

可通过 `SubmitBroadcaster` 实例上的 `get_metrics()` 方法以编程方式访问这些指标。

### 配置

通过执行客户端配置提交广播器：

| 选项                   | 默认值 | 说明                                                     |
| ---------------------- | ------ | -------------------------------------------------------- |
| `submitter_pool_size`  | `None` | HTTP 客户端池大小。`None` 解析为 1（单客户端，无冗余）。 |
| `submitter_proxy_urls` | `None` | 可选代理 URL 列表，用于提高提交广播器的路径多样性。      |

**配置示例**：

```python
from vibe_trader.adapters.bitmex import BitmexExecClientConfig

exec_config = BitmexExecClientConfig(
    api_key="YOUR_API_KEY",
    api_secret="YOUR_API_SECRET",
    submitter_pool_size=3,  # Recommended pool size for redundancy
)
```

:::tip
对于没有更高速率限制的 HFT 策略，请权衡使用提交广播器的优势与触及速率限制的风险，因为每个客户端都有独立的速率限制预算。
默认的 `submitter_pool_size=None` 会禁用广播器。建议设置 `submitter_pool_size=3`，将每个提交请求广播到 3 个并行 HTTP 客户端以实现容错；每次提交会消耗 3 倍速率限制配额，但更能抵御网络或交易所故障。
:::

执行客户端连接时会自动启动广播器，断开连接时会停止。仅当 `submit_tries > 1` 时，提交操作才通过广播器路由；默认提交直接使用单个 HTTP 客户端。

## 取消广播器

BitMEX 执行客户端包含取消广播器，通过并行扇出请求实现容错订单取消。

### 概念

取消订单对时间极其敏感：策略决定取消订单后，任何延迟或失败都可能导致意外成交、滑点或不必要的持仓敞口。取消广播器的处理方式如下：

- **并行扇出**：同时向多个独立 HTTP 客户端实例广播取消请求。
- **首次成功即短路**：首个成功响应胜出，其余传输中请求立即中止。
- **容错**：某个 HTTP 客户端发生网络问题、DNS 故障或连接超时时，池中其他客户端继续处理。
- **幂等成功处理**：表示订单已取消的响应（如"orderID not found"或类似幂等状态）视为成功而非失败，避免传播不必要的错误。

该架构避免单条网络路径故障或慢连接阻塞取消操作，提高实盘交易中风险管理和持仓控制的可靠性。

### 健康监控

广播器池中的每个 HTTP 客户端都维护健康指标：

- 成功取消会将客户端标记为健康。
- 请求失败会增加错误计数器。
- 后台健康检查会定期验证客户端连接。
- 降级客户端会被跟踪，但仍留在池中以维持容错能力。

广播器公开总取消数、成功取消数、失败取消数、预期拒绝数（已取消订单）和幂等成功数等指标，用于运维监控和调试。

#### 跟踪的指标

| 指标                   | 类型    | 说明                                                                     |
| ---------------------- | ------- | ------------------------------------------------------------------------ |
| `total_cancels`        | `u64`   | 已发起的取消操作总数（包括单笔、批量和全部取消请求）。                   |
| `successful_cancels`   | `u64`   | 成功收到 BitMEX 确认的取消操作数量。                                     |
| `failed_cancels`       | `u64`   | 池中所有 HTTP 客户端均失败的取消操作数量（无健康客户端或所有请求失败）。 |
| `expected_rejects`     | `u64`   | 检测到的预期拒绝模式数量（例如只挂单订单拒绝）。                         |
| `idempotent_successes` | `u64`   | 幂等成功响应数量（订单已取消、找不到订单、因状态无法取消）。             |
| `healthy_clients`      | `usize` | 池中当前健康的 HTTP 客户端数量（通过近期健康检查的客户端）。             |
| `total_clients`        | `usize` | 池中配置的 HTTP 客户端总数（`canceller_pool_size`）。                    |

可通过 `CancelBroadcaster` 实例上的 `get_metrics()` 方法以编程方式访问这些指标。

### 配置

通过执行客户端配置取消广播器：

| 选项                   | 默认值 | 说明                                                     |
| ---------------------- | ------ | -------------------------------------------------------- |
| `canceller_pool_size`  | `None` | HTTP 客户端池大小。`None` 解析为 1（单客户端，无冗余）。 |
| `canceller_proxy_urls` | `None` | 可选代理 URL 列表，用于提高取消广播器的路径多样性。      |

**配置示例**：

```python
from vibe_trader.adapters.bitmex import BitmexExecClientConfig

exec_config = BitmexExecClientConfig(
    api_key="YOUR_API_KEY",
    api_secret="YOUR_API_SECRET",
    canceller_pool_size=3,  # Recommended pool size for redundancy
)
```

:::tip
对于没有更高速率限制的 HFT 策略，请权衡使用取消广播器的优势与触及速率限制的风险，因为每个客户端都有独立的速率限制预算。
默认的 `canceller_pool_size=None` 会禁用广播器。建议设置 `canceller_pool_size=3`，将每个取消请求广播到 3 个并行 HTTP 客户端以实现容错；每次取消会消耗 3 倍速率限制配额，但更能抵御网络或交易所故障。
:::

执行客户端连接时会自动启动广播器，断开连接时会停止。所有取消操作（`cancel_order`、`cancel_all_orders`、`batch_cancel_orders`）都会自动通过广播器路由，无需修改策略代码。

## 死人开关

适配器支持 BitMEX 的[死人开关](https://www.bitmex.com/app/restAPI#OrdercancelAllAfter)
（`cancelAllAfter`），它可以在连接失败时自动取消订单，作为安全保障。

### 工作原理

启用后，会在 BitMEX 服务端设置定时器。如果定时器到期前没有刷新，BitMEX 会取消账户中的**所有**未结订单。
适配器通过定期发送心跳请求维持定时器。如果适配器失去连接（网络故障、进程崩溃等），心跳便会停止，
BitMEX 会在配置的超时时间后取消订单。

流程如下：

1. **连接**时，适配器使用已配置的超时时间（毫秒）调用 `POST /api/v1/order/cancelAllAfter`，
   启动服务端定时器。
2. 后台任务按 `timeout / 4` 的**刷新间隔**（最短 1 秒）发送相同请求，在定时器到期前持续重置。
3. **断开连接**时，适配器等待后台心跳任务完全停止，再以 `timeout=0` 调用 `cancelAllAfter`，
   **解除**服务端定时器。

例如，超时时间为 60 秒时，适配器每 15 秒发送一次心跳。如果连续四次心跳失败（失去连接 60 秒），
BitMEX 会取消所有未结订单。

### 断开连接的顺序

断开连接时解除死人开关需要谨慎排序。解除请求（`timeout=0`）应当是最后到达 BitMEX 的
`cancelAllAfter` 调用。如果传输中的心跳在解除后才被处理，它会重新启动服务端定时器；即使适配器已正常
断开，订单仍可能在超时后被意外取消。

两个实现均采取了缓解措施：

- **Rust**：立即停止心跳任务（abort + await），使断开过程不会因等待 sleep 或 HTTP 超时而停滞。
  任务退出后再发送解除请求。
- **Python**：取消并等待心跳任务，确保协程完全展开后再发送解除请求。

在强制停止场景中（例如通过 `stop()` 关闭进程），心跳任务会中止，但不会解除开关。这是有意设计的，
因为进程意外退出时，服务端定时器会提供预期的安全保护。

:::note
每次心跳消耗一个 REST 速率限制令牌。60 秒超时大约会占用每分钟 120 次预算中的 4 次请求。
:::

### 配置

在执行客户端配置中设置 `deadmans_switch_timeout_secs` 以启用死人开关：

```python
from vibe_trader.adapters.bitmex import BitmexExecClientConfig

exec_config = BitmexExecClientConfig(
    api_key="YOUR_API_KEY",
    api_secret="YOUR_API_SECRET",
    deadmans_switch_timeout_secs=60,  # Cancel all orders after 60s of lost connectivity
)
```

启用后，适配器会记录：

```
Starting dead man's switch: timeout=60s, refresh_interval=15s
```

该消息在连接时出现；适配器还会记录：

```
Disarming dead man's switch
```

该消息在断开连接时出现。

:::tip
建议从 **60 秒**超时开始。较短超时保护更快，但对短暂网络波动更敏感；较长超时更能容忍短时中断，
但在真正发生故障时会使订单暴露更久。
:::

:::warning
死人开关作用于账户中的**所有**未结订单，而不仅是适配器提交的订单。如果其他系统也在同一账户下单，
启用死人开关同样会影响这些订单。
:::

## 配置

### API 凭证

BitMEX API 凭证可以直接在配置中提供，也可以通过环境变量提供：

- `BITMEX_API_KEY`：生产环境的 BitMEX API 密钥。
- `BITMEX_API_SECRET`：生产环境的 BitMEX API Secret。
- `BITMEX_TESTNET_API_KEY`：测试网的 BitMEX API 密钥。
- `BITMEX_TESTNET_API_SECRET`：测试网的 BitMEX API Secret。

生成 API 密钥：

1. 登录 BitMEX 账户。
2. 前往 Account & Security -> API Keys。
3. 创建具有适当权限的新 API 密钥。
4. 测试网请使用 [testnet.bitmex.com](https://testnet.bitmex.com)。

:::note
**测试网 API 端点**：

- REST API：`https://testnet.bitmex.com/api/v1`
- WebSocket：`wss://ws.testnet.bitmex.com/realtime`

配置 `environment=BitmexEnvironment.TESTNET` 后，适配器会自动将请求路由到正确端点。
:::

### 数据客户端配置选项

BitMEX 数据客户端提供以下配置选项：

| 选项                               | 默认值    | 说明                                                              |
| ---------------------------------- | --------- | ----------------------------------------------------------------- |
| `api_key`                          | `None`    | 可选 API 密钥；如为 `None`，则从 `environment` 选择的环境加载。   |
| `api_secret`                       | `None`    | 可选 API Secret；如为 `None`，则从 `environment` 选择的环境加载。 |
| `environment`                      | `None`    | 环境枚举（`MAINNET` 或 `TESTNET`）。                              |
| `base_url_http`                    | `None`    | REST 基础 URL 覆盖值（默认为生产环境）。                          |
| `base_url_ws`                      | `None`    | WebSocket 基础 URL 覆盖值（默认为生产环境）。                     |
| `http_timeout_secs`                | `60`      | 应用于 HTTP 调用的请求超时。                                      |
| `max_retries`                      | `3`       | HTTP 调用的最大重试次数。                                         |
| `retry_delay_initial_ms`           | `1,000`   | 重试之间的初始退避延迟（毫秒）。                                  |
| `retry_delay_max_ms`               | `10,000`  | 重试之间的最大退避延迟（毫秒）。                                  |
| `recv_window_ms`                   | `10,000`  | 已签名请求的到期窗口（毫秒）。参阅[请求认证](#请求认证与到期)。   |
| `update_instruments_interval_mins` | `None`    | 金融工具目录刷新间隔（分钟）。`None` 禁用定期刷新。               |
| `max_requests_per_second`          | `10`      | 适配器对 REST 调用执行的突发速率限制。                            |
| `max_requests_per_minute`          | `120`     | 适配器对 REST 调用执行的滚动分钟速率限制。                        |
| `proxy_url`                        | `None`    | 可选的 HTTP 和 WebSocket 传输代理 URL。                           |
| `transport_backend`                | `Sockudo` | WebSocket 传输后端。                                              |

### 执行客户端配置选项

BitMEX 执行客户端提供以下配置选项：

| 选项                           | 默认值    | 说明                                                                               |
| ------------------------------ | --------- | ---------------------------------------------------------------------------------- |
| `api_key`                      | `None`    | 可选 API 密钥；如为 `None`，则从 `environment` 选择的环境加载。                    |
| `api_secret`                   | `None`    | 可选 API Secret；如为 `None`，则从 `environment` 选择的环境加载。                  |
| `environment`                  | `None`    | 环境枚举（`MAINNET` 或 `TESTNET`）。                                               |
| `base_url_http`                | `None`    | REST 基础 URL 覆盖值（默认为生产环境）。                                           |
| `base_url_ws`                  | `None`    | WebSocket 基础 URL 覆盖值（默认为生产环境）。                                      |
| `http_timeout_secs`            | `60`      | 应用于 HTTP 调用的请求超时。                                                       |
| `max_retries`                  | `3`       | HTTP 调用的最大重试次数。                                                          |
| `retry_delay_initial_ms`       | `1,000`   | 重试之间的初始退避延迟（毫秒）。                                                   |
| `retry_delay_max_ms`           | `10,000`  | 重试之间的最大退避延迟（毫秒）。                                                   |
| `recv_window_ms`               | `10,000`  | 已签名请求的到期窗口（毫秒）。参阅[请求认证](#请求认证与到期)。                    |
| `max_requests_per_second`      | `10`      | 适配器对 REST 调用执行的突发速率限制。                                             |
| `max_requests_per_minute`      | `120`     | 适配器对 REST 调用执行的滚动分钟速率限制。                                         |
| `deadmans_switch_timeout_secs` | `None`    | 死人开关超时秒数。`None` 表示禁用。参阅[死人开关](#死人开关)。                     |
| `canceller_pool_size`          | `None`    | 取消广播器池中的 HTTP 客户端数量。`None` 解析为 1。参阅[取消广播器](#取消广播器)。 |
| `submitter_pool_size`          | `None`    | 提交广播器池中的 HTTP 客户端数量。`None` 解析为 1。参阅[提交广播器](#提交广播器)。 |
| `proxy_url`                    | `None`    | 可选的 HTTP 和 WebSocket 传输代理 URL。                                            |
| `submitter_proxy_urls`         | `None`    | 可选代理 URL 列表，用于提高提交广播器的路径多样性。                                |
| `canceller_proxy_urls`         | `None`    | 可选代理 URL 列表，用于提高取消广播器的路径多样性。                                |
| `transport_backend`            | `Sockudo` | WebSocket 传输后端。                                                               |

### 配置示例

典型 BitMEX 实盘交易配置同时包含测试网和主网选项：

```python
from vibe_trader.adapters.bitmex import BitmexDataClientConfig
from vibe_trader.adapters.bitmex import BitmexEnvironment
from vibe_trader.adapters.bitmex import BitmexExecClientConfig

# Using environment variables (recommended)
testnet_data_config = BitmexDataClientConfig(
    environment=BitmexEnvironment.TESTNET,
)

# Using explicit credentials
mainnet_data_config = BitmexDataClientConfig(
    api_key="YOUR_API_KEY",  # Or use os.getenv("BITMEX_API_KEY")
    api_secret="YOUR_API_SECRET",  # Or use os.getenv("BITMEX_API_SECRET")
    environment=BitmexEnvironment.MAINNET,
)

mainnet_exec_config = BitmexExecClientConfig(
    api_key="YOUR_API_KEY",
    api_secret="YOUR_API_SECRET",
    environment=BitmexEnvironment.MAINNET,
)
```

## 交易注意事项

### 条件关联订单

BitMEX 执行适配器将 Vibe 条件关联订单列表映射到交易所原生的 `clOrdLinkID`/`contingencyType` 机制。
当引擎提交 `ContingencyType::Oco` 或 `ContingencyType::Oto` 订单时，适配器会：

- 在 BitMEX 创建/维护关联订单组，使子止损单和目标单继承父订单状态。
- 传播订单列表更新和取消，使条件关联订单彼此与当前持仓状态保持一致。
- 公开带有适当条件关联元数据的执行报告，使策略层无需额外手动接线即可跟踪。

适配器不会将 Vibe `ContingencyType::Ouo` 映射到 BitMEX。对于包含入场、止损和止盈的括号流程，
BitMEX 可以原生关联 OTO 的入场到条件订单激活步骤，但止损腿和止盈腿之间的相互取消或更新行为需要在
策略层模拟。定义策略时，请继续使用 Vibe `OrderList`/`ContingencyType` 抽象，但不要依赖适配器为
条件退出腿提供 OUO 配对。

### 合约规范

- **反向合约**：以加密货币结算（例如 XBTUSD 以 XBT 结算）。
- **线性合约**：以稳定币结算（例如 ETHUSDT 以 USDT 结算）。
- **合约大小**：因金融工具而异，请仔细检查规范。
- **tick 大小**：最低价格增量因合约而异。

### 保证金要求

- 初始保证金要求因合约和市场状况而异。
- 维持保证金通常低于初始保证金。
- 不满足维持保证金要求时会发生强平。
- BitMEX 同时支持逐仓保证金和全仓保证金模式。
- 风险限制可以根据持仓数量，依照[交易所规则](https://www.bitmex.com/exchange-rules)进行调整。

### 费用

- **挂单方费用**：提供流动性通常为负费用（返佣）。
- **吃单方费用**：获取流动性会收取正费用。
- **资金费率**：每 8 小时适用于永续合约。
- **预测市场费用**：挂单方 0.00%，吃单方 0.25%（不允许杠杆）。

## 贡献

:::info
如需添加功能或为 BitMEX 适配器贡献代码，请参阅我们的
[贡献指南](https://github.com/qOeOp/trade/blob/main/CONTRIBUTING.md)。
:::
