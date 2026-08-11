# OKX

OKX 成立于 2017 年，是一家提供现货、保证金、永续掉期、期货、期权、价差和事件合约交易的加密货币交易所。此集成支持接入 OKX 实盘市场数据和执行订单。

## 概述

此适配器使用 Rust 编写，并为 Python 工作流提供可选的 Python 绑定。它不需要外部 OKX 客户端库。核心组件编译为静态库，并在构建期间自动链接。

## 示例

- [Python 示例](https://github.com/qOeOp/trade/tree/main/examples/live/okx/)
- [Rust 示例](https://github.com/qOeOp/trade/tree/main/crates/adapters/okx/examples/)

### 产品支持

| 产品     | 金融工具来源            | 数据 | 执行 | 备注                               |
| -------- | ----------------------- | ---- | ---- | ---------------------------------- |
| 现货     | `public/instruments`    | 是   | 是   | 现货交易对。                       |
| 保证金   | `public/instruments`    | 是   | 是   | 使用保证金或杠杆的现货金融工具。   |
| 永续掉期 | `public/instruments`    | 是   | 是   | 线性和反向合约。                   |
| 期货     | `public/instruments`    | 是   | 是   | 定期期货合约。                     |
| 期权     | `public/instruments`    | 是   | 是   | 限价风格订单执行。                 |
| 价差     | `sprd/spreads`          | 是   | 是   | business WS 上的快照、报价和成交。 |
| 事件合约 | `event-contract/*` 端点 | 是   | 是   | 解析为 Vibe `BinaryOption`。       |

相关 OKX 文档：

- [获取金融工具](https://www.okx.com/docs-v5/en/#public-data-rest-api-get-instruments)。
- [获取限价](https://www.okx.com/docs-v5/en/#public-data-rest-api-get-limit-price)。
- [获取价差（公开）](https://www.okx.com/docs-v5/en/#spread-trading-rest-api-get-spreads-public)。
- [价差交易下单](https://www.okx.com/docs-v5/en/#spread-trading-rest-api-place-order)。
- [事件合约系列](https://www.okx.com/docs-v5/en/#public-data-rest-api-get-series)。

:::note
**期权支持**：适配器支持期权市场数据、交易场所提供的 Greeks（`subscribe_option_greeks`）及期权金融工具的订单执行。详情参见下文[期权交易](#期权交易)一节，订阅模式参见[期权](../concepts/options.md)指南。
:::

:::info
**金融工具乘数**：对于衍生品（`SWAP`、`FUTURES`、`OPTION`），金融工具乘数计算为 OKX `ctMult` 与 `ctVal` 字段的乘积，使持仓规模与 OKX 合约大小和价值保持一致。
:::

:::info
**价格限制**：OKX 在现货、保证金、掉期和期货金融工具的 `public/instruments` 上公开 `initPxLmtPct`、`floatPxLmtPct` 和 `maxPxLmtPct`。适配器将非空值保留在金融工具 `info` 字段中，键分别为 `okx_init_px_lmt_pct`、`okx_float_px_lmt_pct` 和 `okx_max_px_lmt_pct`。这些字段描述交易所价格带百分比，因此不会解析为静态 Vibe `min_price` 或 `max_price` 值。

需要 OKX `GET /api/v5/public/price-limit` 端点当前计算的买卖限制时，请使用 `OKXHttpClient.request_price_limit(instrument_id)`。OKX 文档指出，期权和事件合约的百分比字段为空；适配器不会更改其金融工具 `info`。
:::

:::note
`/api/v5/finance/okusd/*` 等 OKX 金融产品端点不在 OKX 交易适配器范围内。
:::

OKX 适配器包含多个组件，可单独或组合使用：

- `OKXHttpClient`：底层 HTTP API 连接。
- `OKXWebSocketClient`：底层 WebSocket API 连接。
- `OKXInstrumentProvider`：金融工具解析和加载功能。
- `OKXDataClient`：市场数据源管理器。
- `OKXExecutionClient`：账户管理和交易执行网关。
- `OKXDataClientFactory`：OKX 数据客户端工厂。
- `OKXExecutionClientFactory`：OKX 执行客户端工厂。

:::note
大多数用户会为实盘交易节点定义配置（如下所示），无需直接使用这些底层组件。
:::

## 符号体系

OKX 对不同金融工具类型使用特定的符号约定。在 Vibe 中引用金融工具时添加 `.OKX` 后缀，例如 `BTC-USDT.OKX`。

### 按金融工具类型划分的符号格式

#### SPOT

格式：`{BaseCurrency}-{QuoteCurrency}`

示例：

- `BTC-USDT` - Bitcoin 对 USDT（Tether）
- `BTC-USDC` - Bitcoin 对 USDC
- `ETH-USDT` - Ethereum 对 USDT
- `SOL-USDT` - Solana 对 USDT

在策略中订阅 Bitcoin 现货美元交易对：

```python
InstrumentId.from_str("BTC-USDT.OKX")  # For USDT-quoted spot
InstrumentId.from_str("BTC-USDC.OKX")  # For USDC-quoted spot
```

#### SWAP（永续掉期）

格式：`{BaseCurrency}-{QuoteCurrency}-SWAP`

示例：

- `BTC-USDT-SWAP` - Bitcoin 永续掉期（线性，以 USDT 为保证金）
- `BTC-USD-SWAP` - Bitcoin 永续掉期（反向，以币为保证金）
- `ETH-USDT-SWAP` - Ethereum 永续掉期（线性）
- `ETH-USD-SWAP` - Ethereum 永续掉期（反向）

线性与反向合约：

- **线性**（以 USDT 为保证金）：使用 USDT 等稳定币作为保证金。
- **反向**（以币为保证金）：使用基础加密货币作为保证金。

#### FUTURES（定期期货）

格式：`{BaseCurrency}-{QuoteCurrency}-{YYMMDD}`

示例：

- `BTC-USD-251226` - 2025 年 12 月 26 日到期的 Bitcoin 期货
- `ETH-USD-251226` - 2025 年 12 月 26 日到期的 Ethereum 期货
- `BTC-USD-250328` - 2025 年 3 月 28 日到期的 Bitcoin 期货

注意：期货通常为反向合约（以币为保证金）。

#### SPREADS

格式：`{Leg1InstrumentId}_{Leg2InstrumentId}`

示例：

- `BTC-USDT_BTC-USDT-SWAP` - BTC-USDT 现货与 BTC-USDT 永续掉期之间的价差
- `ETH-USD-SWAP_ETH-USD-231229` - ETH-USD 永续掉期与定期期货之间的价差

在数据客户端上设置 `load_spreads=True`，可从 OKX [获取价差（公开）](https://www.okx.com/docs-v5/en/#spread-trading-rest-api-get-spreads-public)端点加载实盘 OKX 价差金融工具。适配器将每个 OKX `sprdId` 映射到带 `.OKX` 交易场所后缀的 Vibe 价差金融工具 ID。

价差金融工具简要说明：

- 价差市场数据在 OKX business WebSocket 上流式传输：报价（`sprd-bbo-tbt`）、成交（`sprd-public-trades`）和 5 档订单簿快照（`sprd-books5`）。价差没有增量订单簿频道，因此每次 `sprd-books5` 更新都是通过订单簿订阅传送的完整快照（标记为快照，而非增量 L2 更新）。
- 当前 OKX 实盘价差发现返回现货、掉期和期货腿组合。
- 如果 OKX 通过同一价差端点公开期权腿价差定义，解析器可以表示它们。
- OKX 期权 RFQ 和大宗交易工作流不同于 Nitro 价差订单簿 API，不由此价差路径路由。

#### OPTIONS

格式：`{BaseCurrency}-{QuoteCurrency}-{YYMMDD}-{Strike}-{Type}`

示例：

- `BTC-USD-251226-100000-C` - 行权价 $100,000、2025 年 12 月 26 日到期的 Bitcoin 看涨期权
- `BTC-USD-251226-100000-P` - 行权价 $100,000、2025 年 12 月 26 日到期的 Bitcoin 看跌期权
- `ETH-USD-251226-4000-C` - 行权价 $4,000、2025 年 12 月 26 日到期的 Ethereum 看涨期权

其中：

- `C` = 看涨期权
- `P` = 看跌期权

#### EVENTS

OKX 事件合约金融工具 ID 使用 OKX 金融工具 API 返回的市场 ID。适配器将这些市场表示为 Vibe `BinaryOption` 金融工具。

示例：

- `BTC-ABOVE-DAILY-260224-1600-65000` - `BTC-ABOVE-DAILY` 系列中的事件合约市场。

### 常见问题

**问：如何订阅 Bitcoin 现货美元交易对？**
答：以 USDT 为保证金的现货使用 `BTC-USDT.OKX`，以 USDC 为保证金的现货使用 `BTC-USDC.OKX`。

**问：BTC-USDT-SWAP 与 BTC-USD-SWAP 有什么区别？**
答：`BTC-USDT-SWAP` 是线性永续合约（以 USDT 为保证金），`BTC-USD-SWAP` 是反向永续合约（以 BTC 为保证金）。

**问：如何确定使用哪种合约类型？**
答：线性和反向金融工具具有不同符号。公开 Python 配置不提供合约类型筛选器，因此适配器会为所选衍生品金融工具类型加载两者。

**问：如何加载事件合约？**
答：使用 `OKXInstrumentType.EVENTS`。公开 Python 配置会加载所有可发现的事件合约系列，不提供系列筛选器。

## 零售价格改善（RPI）

使用零售价格改善（RPI）可消费 OKX 的综合自然流动性与 RPI 深度、挂出 RPI 挂单方订单，或让标准订单获取 RPI 流动性。适配器将这些功能映射到现有 Vibe 订单簿、订单和生命周期类型。RPI 路由为选择启用，因此标准订阅和订单保持不变。

### RPI 市场数据

向 `subscribe_book_deltas` 或 `request_book_snapshot` 传入 `params={"rpi": True}`，以使用公开 `books-rpi` 频道或 `GET /api/v5/market/books-rpi`。该数据源合并自然流动性数量和可执行的 RPI 数量。

每个原始深度档位的线格式为 `[price, totalQty, nonRpiQty, count]`：

| 线字段      | Rust 类型 | 含义                          |
| ----------- | --------- | ----------------------------- |
| `price`     | `Decimal` | 价格档位。                    |
| `totalQty`  | `Decimal` | 自然流动性和可用 RPI 数量。   |
| `nonRpiQty` | `Decimal` | 无 RPI 吃单权限时可用的数量。 |
| `count`     | `u64`     | 该价格档位的聚合订单数。      |

Vibe `OrderBookDeltas` 和 `OrderBook` 使用 `totalQty` 作为档位数量。类型化原始模型保留 `nonRpiQty`；两者之差即为可用 RPI 流动性。

WebSocket 快照和更新保留 `seqId` 与 `prevSeqId`。发出的增量携带 `seqId` 作为序列。数据客户端会将每次更新的 `prevSeqId` 与上一个已接受的 `seqId` 比较；这些值无需每次递增一。若不匹配，客户端会：

- 丢弃不匹配的帧。
- 阻止该金融工具的后续更新。
- 替换一次订阅以请求新快照。
- 收到 `prevSeqId: -1` 的快照后恢复发出数据。

若配置的快照超时前快照仍未到达，订单簿监控器会记录警告，客户端保持故障关闭。当 `prevSeqId` 存在时，适配器会对标准增量 OKX 订单簿频道应用相同的关联规则。`books-rpi` 没有校验和。

对于 WebSocket 订阅，`rpi=True` 会选择 `books-rpi`，而不是深度或 VIP 频道选择。对于 REST 快照，请求深度成为 `sz`；OKX 默认每侧一档，最多接受 400 档。

底层 Rust 客户端公开：

- WebSocket：`OKXWebSocketClient.subscribe_book_rpi` 和 `unsubscribe_book_rpi`。
- REST：`OKXRawHttpClient.get_rpi_order_book` 和 `OKXHttpClient.request_rpi_book_snapshot`。

公开金融工具响应会公开交易场所的 RPI 间距阈值：

| 线字段         | Rust 类型         | 金融工具 `info` 键    |
| -------------- | ----------------- | --------------------- |
| `rpiMinLevel`  | `Option<u64>`     | `okx_rpi_min_level`   |
| `rpiMinPxBand` | `Option<Decimal>` | `okx_rpi_min_px_band` |

`rpiMinLevel` 计算自然流动性价格档位数，`rpiMinPxBand` 衡量相对于对手方自然流动性最优价格的基点数。`info` 映射将价格带存储为精确十进制字符串。适配器不会根据这些值拒绝订单或对订单取整，因为 OKX 应用权威的金融工具和账户规则。请使用 `rpi_px_round` 或处理交易场所拒绝。

### RPI 执行

通过 `submit_order`、`submit_order_list` 或 `modify_order` 命令的 `params` 传入 RPI 控制项。这些控制项适用于 HTTP 和私有 WebSocket 执行：

| 参数               | 类型   | 操作                  | 行为                                                 |
| ------------------ | ------ | --------------------- | ---------------------------------------------------- |
| `rpi`              | `bool` | 下单和批量下单        | 发送 `ordType: rpi`；Vibe 订单必须是 `LIMIT`。       |
| `rpi_taker_access` | `bool` | 下单和修改，单笔/批量 | 允许标准订单获取 RPI 流动性。                        |
| `rpi_px_round`     | `bool` | 下单和修改，单笔/批量 | 允许 OKX 将 RPI 挂单方价格向外取整至符合条件的档位。 |

```python
order = strategy.order_factory.limit(
    instrument_id=instrument_id,
    order_side=OrderSide.SELL,
    quantity=instrument.make_qty("250000"),
    price=instrument.make_price("0.0001600"),
)
strategy.submit_order(
    order,
    params={
        "rpi": True,
        "rpi_px_round": True,
    },
)
```

仅在标准吃单方订单上设置 `rpi_taker_access`，仅在 RPI 挂单方订单上设置 `rpi_px_round`。应省略不适用的控制项，而不是传入 `False`，因为 OKX 可能拒绝不支持的组合。两个控制项都默认为 `false`，修改时不会继承 `rpi_taker_access`。每次需要保留权限的修改都应重复设置 `rpi_taker_access=True`。

底层 Rust 客户端公开相同的单笔和批量矩阵：

| 操作     | REST 方法      | WebSocket 方法        |
| -------- | -------------- | --------------------- |
| 下单     | `place_order`  | `submit_order`        |
| 批量下单 | `place_orders` | `batch_submit_orders` |
| 修改     | `amend_order`  | `modify_order`        |
| 批量修改 | `amend_orders` | `batch_modify_orders` |

WebSocket 批量修改 tuple 接受可选请求 ID，并将其序列化为 `reqId`；它不会替换订单的客户端 ID。

### RPI 响应与生命周期

私有订单消息同时解析 `ordType: rpi` 和迁移别名 `ordType: elp`。如果未成交 RPI 下单首次出现在私有订单频道时为 `state: canceled`，且 `accFillSz` 为零或空，适配器会发出仅做挂单订单的拒绝事件，而不会先发出接受事件。后备原因为 `RPI order canceled before acceptance`。当 RPI 价格不符合间距规则且 `rpiPxRound` 为 false 时，OKX 可使用此路径。订单报告将 RPI 订单表示为带 `post_only=True` 的 Vibe `LIMIT` 订单。

使用 `get_account_instruments` 读取类型化 `OKXRpiPermission` 值：

- `Disabled` 映射到 `rpi: "0"`。
- `Enabled` 映射到 `rpi: "1"`，且不授予挂出 RPI 订单的权限。
- `Permitted` 映射到 `rpi: "2"`，并授予挂出 RPI 订单的权限。

公开金融工具端点不返回账户权限。原始费用响应将 `rpiMaker` 公开为可选 `Decimal`；空值表示 RPI 不适用。

过渡期间，响应可能同时包含 RPI 和 ELP 字段名称。适配器优先使用 `rpi` 和 `rpiMaker`，将 `elp` 和 `elpMaker` 作为响应别名读取，并且只发送 RPI 名称。原始成交消息将 `source: "1"` 描述为 RPI 订单。

### RPI 排除项

适配器有意排除：

- 不公开过时的 `books-elp` 订阅，也不发出 `ordType: elp`。
- 不将已发布的 RPI 间距阈值视为权威的客户端验证依据。
- 不将 RPI 控制项应用于 algo 订单。常规 HTTP 订单路径会拒绝价差订单的 RPI 控制项。
- 不将通用仅做挂单重放去重作为 RPI 支持的一部分添加。

OKX 对期权和事件合约忽略 `rpiPxRound`。

参见 [OKX RPI 迁移变更日志](https://www.okx.com/docs-v5/log_en/#2026-07-28)和 [RPI 计划指南](https://www.okx.com/help/okx-retail-price-improvement-program-rpi)。

## 订单能力

以下是 OKX 线性永续掉期产品支持的订单类型、执行指令和有效期选项。

### WebSocket 订单标识

OKX WebSocket 订单操作使用 `instIdCode`（数字金融工具标识符），而非字符串 `instId` 参数。适配器根据启动期间获取的金融工具定义解析 `instIdCode` 值，并在会话生命周期内缓存。如果金融工具缓存为空（例如引导失败），订单提交会以明确错误失败。

### 客户端订单 ID 要求

:::note
OKX 对客户端订单 ID 有特定要求：

- **不允许连字符**：OKX 不接受客户端订单 ID 中的连字符（`-`）。
- 最大长度：32 个字符。
- 允许字符：仅字母和数字。

配置策略时，请确保设置：

```python
use_hyphens_in_client_order_ids = False
```

:::

### 订单类型

| 订单类型               | 线性永续掉期 | 备注                                          |
| ---------------------- | ------------ | --------------------------------------------- |
| `MARKET`               | ✓            | 以市价立即执行。支持计价货币数量。            |
| `MARKET_TO_LIMIT`      | ✓            | 转换为 IOC 限价单的市价单。                   |
| `LIMIT`                | ✓            | 以指定价格或更优价格执行。                    |
| `STOP_MARKET`          | ✓            | 通过 OKX algo 订单执行的条件市价单。          |
| `STOP_LIMIT`           | ✓            | 通过 OKX algo 订单执行的条件限价单。          |
| `MARKET_IF_TOUCHED`    | ✓            | 通过 OKX algo 订单执行的条件市价单。          |
| `LIMIT_IF_TOUCHED`     | ✓            | 通过 OKX algo 订单执行的条件限价单。          |
| `TRAILING_STOP_MARKET` | ✓            | 通过 OKX 高级 algo 订单执行的追踪止损市价单。 |

:::info
**条件订单**：`STOP_MARKET`、`STOP_LIMIT`、`MARKET_IF_TOUCHED`、`LIMIT_IF_TOUCHED` 和 `TRAILING_STOP_MARKET` 使用 OKX algo 订单。`TRAILING_STOP_MARKET` 路径使用 OKX 高级 algo 订单 API（`move_order_stop`），取消时需要 `cancel-advance-algos` 端点。
:::

### 价差订单

OKX 价差金融工具使用独立的价差交易订单簿和 API 系列。执行客户端当前按价差金融工具 ID（例如 `ETH-USD-SWAP_ETH-USD-231229.OKX`）通过 HTTP `/api/v5/sprd/*` 端点路由价差订单。

适配器使用 OKX 价差 REST 端点执行提交、取消、批量取消、订单状态和成交报告。它订阅 OKX business WebSocket [`sprd-orders` 频道](https://www.okx.com/docs-v5/en/#spread-trading-websocket-private-channel-order-channel)，获取实盘价差订单更新。

OKX `sprd-orders` WebSocket 更新不包含费用字段。从该频道发出的实盘价差成交报告使用零佣金；来自 REST [`sprd/trades` 端点](https://www.okx.com/docs-v5/en/#spread-trading-rest-api-get-trades)的历史和对账成交报告包含 OKX 费用数据。

支持的价差订单指令：

- 使用 GTC 有效期的 `LIMIT`。
- 使用 IOC 有效期的 `LIMIT`。
- 使用仅做挂单执行的 `LIMIT`。

OKX 价差交易 API 路径不支持价差订单列表、条件订单、FOK 有效期和修改请求。

相关 OKX 文档：

- [价差订单下单](https://www.okx.com/docs-v5/en/#spread-trading-rest-api-place-order)。
- [价差订单详情](https://www.okx.com/docs-v5/en/#spread-trading-rest-api-get-order-details)。
- [价差订单频道](https://www.okx.com/docs-v5/en/#spread-trading-websocket-private-channel-order-channel)。

### 执行指令

| 指令          | 线性永续掉期 | 备注         |
| ------------- | ------------ | ------------ |
| `post_only`   | ✓            | 仅限限价单。 |
| `reduce_only` | ✓            | 仅限衍生品。 |

### 有效期

| 有效期 | 线性永续掉期 | 备注                           |
| ------ | ------------ | ------------------------------ |
| `GTC`  | ✓            | 撤销前有效。                   |
| `FOK`  | ✓            | 全部成交或取消。               |
| `IOC`  | ✓            | 立即成交或取消。               |
| `GTD`  | -            | *OKX 没有原生订单有效期指令。* |

:::note
**GTD（指定日期前有效）有效期**：OKX 通过 `expTime` 支持请求到期，但这是请求超时，而非原生订单到期指令。

如需 GTD 功能，请使用 Vibe 由策略管理的 GTD 功能。它会在指定到期时间取消订单。
:::

### 批量操作

| 操作     | 线性永续掉期 | 备注                   |
| -------- | ------------ | ---------------------- |
| 批量提交 | ✓            | 单次请求提交多个订单。 |
| 批量修改 | ✓            | 单次请求修改多个订单。 |
| 批量取消 | ✓            | 单次请求取消多个订单。 |

### 持仓管理

| 功能       | 线性永续掉期 | 备注                              |
| ---------- | ------------ | --------------------------------- |
| 查询持仓   | ✓            | 实时持仓更新。                    |
| 持仓模式   | ✓            | 净持仓与多头/空头模式（见下文）。 |
| 杠杆控制   | ✓            | 按金融工具动态调整杠杆。          |
| 保证金模式 | ✓            | 支持现金、逐仓和全仓模式。        |

#### 持仓模式

OKX 支持两种衍生品交易持仓模式：

- **净持仓模式**（净额结算）：每个金融工具一个持仓。买卖订单相互净额结算。这是默认模式，推荐大多数交易者使用。
- **多头/空头模式**（对冲）：同一金融工具分别持有多头和空头持仓，支持同时持有多空敞口。

:::note
持仓模式必须通过 OKX Web 或应用界面配置，并作用于整个账户。适配器会检测当前持仓模式并相应处理持仓报告。
:::

### 交易模式与保证金配置

OKX 统一账户系统支持不同的现货和衍生品交易模式。请先通过 OKX Web 或应用界面配置账户模式；API 无法首次设置。

账户模式详情参见 [OKX 账户模式文档](https://www.okx.com/docs-v5/en/#overview-account-mode)。

#### 交易模式概述

Python 执行配置按以下方式选择交易模式：

| 金融工具 | 交易模式   | 配置                                            |
| -------- | ---------- | ----------------------------------------------- |
| 现货     | `cash`     | 自动。                                          |
| 衍生品   | `isolated` | 默认，或 `margin_mode=OKXMarginMode.ISOLATED`。 |
| 衍生品   | `cross`    | `margin_mode=OKXMarginMode.CROSS`。             |

```python
from vibe_trader.adapters.okx import OKXExecClientConfig
from vibe_trader.adapters.okx import OKXInstrumentType
from vibe_trader.adapters.okx import OKXMarginMode
from vibe_trader.model import AccountId
from vibe_trader.model import TraderId


exec_config = OKXExecClientConfig(
    trader_id=TraderId.from_str("TRADER-001"),
    account_id=AccountId.from_str("OKX-001"),
    instrument_types=[OKXInstrumentType.SWAP],
    margin_mode=OKXMarginMode.CROSS,
)
```

公开 Python 配置目前不公开现货保证金选择，因此现货订单使用现金模式。在混合现货和衍生品客户端中，`margin_mode` 只适用于衍生品。

:::warning
**手动交易模式覆盖**：可以用 `params={"td_mode": "..."}` 按订单覆盖交易模式。这会绕过适配器选择；如果值与金融工具类型不匹配（例如现货金融工具使用 `isolated`），可能导致订单被拒绝。

仅在配置无法满足要求时使用手动覆盖。
:::

### 订单查询

| 功能         | 线性永续掉期 | 备注               |
| ------------ | ------------ | ------------------ |
| 查询未结订单 | ✓            | 列出所有活跃订单。 |
| 查询订单历史 | ✓            | 历史订单数据。     |
| 订单状态更新 | ✓            | 实时订单状态变化。 |
| 成交历史     | ✓            | 执行和成交报告。   |

### 或有订单

| 功能     | 线性永续掉期 | 备注                           |
| -------- | ------------ | ------------------------------ |
| 订单列表 | ✓            | 通过 WS 批量处理；仅常规订单。 |
| OCO 订单 | ✓            | 二选一取消订单。               |
| 括号订单 | ✓            | 止损与止盈组合。               |
| 条件订单 | ✓            | 止损和触价限价单。             |

#### 条件订单架构

条件订单（OKX algo 订单）采用混合架构：

- **提交**：HTTP REST API（`/api/v5/trade/order-algo`）。
- **状态更新**：WebSocket business 端点（`/ws/v5/business`）上的 `orders-algo` 频道。
- **取消**：通过 HTTP REST API 跟踪 algo 订单 ID。

此设计确保：

- 通过 HTTP 立即确认提交。
- 通过 WebSocket 实时更新状态。
- 通过 algo 订单 ID 映射正确管理订单生命周期。

#### 支持的条件订单类型

| 订单类型               | 触发类型          | 备注                     |
| ---------------------- | ----------------- | ------------------------ |
| `STOP_MARKET`          | Last, Mark, Index | 触发时按市价执行。       |
| `STOP_LIMIT`           | Last, Mark, Index | 触发时挂出限价单。       |
| `MARKET_IF_TOUCHED`    | Last, Mark, Index | 价格触及时按市价执行。   |
| `LIMIT_IF_TOUCHED`     | Last, Mark, Index | 价格触及时挂出限价单。   |
| `TRAILING_STOP_MARKET` | Last, Mark, Index | 使用回调比例的追踪止损。 |

#### 触发价格类型

条件订单支持不同的触发价格来源：

- **最新价格**（`TriggerType.LAST_PRICE`）：使用最新成交价（默认）。
- **标记价格**（`TriggerType.MARK_PRICE`）：使用标记价格。
- **指数价格**（`TriggerType.INDEX_PRICE`）：使用标的指数价格。

```python
# Example: Stop loss using mark price trigger
stop_order = order_factory.stop_market(
    instrument_id=instrument_id,
    order_side=OrderSide.SELL,
    quantity=Quantity.from_str("0.1"),
    trigger_price=Price.from_str("45000.0"),
    trigger_type=TriggerType.MARK_PRICE,  # Use mark price for trigger
)
strategy.submit_order(stop_order)
```

## 风险管理

### 强平和 ADL 事件处理

OKX 适配器会检测交易所发起的风险管理事件：

- **强平订单**：交易所强平持仓时，适配器会检测强平类别并记录含订单详情的警告。这些订单继续通过正常订单和成交管线。
- **自动减仓（ADL）**：OKX 为抵销对手方强平而关闭你的持仓时，适配器会检测并记录含持仓详情的 ADL 事件。

检测由订单记录上的 `category` 字段驱动。识别的值为：

| `category`            | 含义           |
| --------------------- | -------------- |
| `full_liquidation`    | 完全强平持仓。 |
| `partial_liquidation` | 部分强平持仓。 |
| `adl`                 | 自动减仓平仓。 |
| `delivery`            | 合约到期交割。 |
| `normal` / 其他值     | 常规订单流。   |

检测在两条路径上运行：

- WebSocket `orders` 频道（实盘订单/成交更新）。
- HTTP `GET /api/v5/trade/orders-history` 和 `orders-history-archive`（用于对账和冷启动批量状态）。

:::info
**强平和 ADL 事件以 WARNING 级别记录**，详情包括订单 ID、金融工具和状态。请将这些日志作为风险管理流程的一部分进行监控。

适配器会处理这些交易所生成的订单、发出相关 `OrderFilled` 事件并更新持仓。策略代码无需单独路径。
:::

上游参考：

- [订单频道和 `category` 字段](https://www.okx.com/docs-v5/en/#order-book-trading-trade-ws-order-channel)
- [自动减仓机制](https://www.okx.com/help/okx-contract-auto-deleveraging-adl)
- [强平机制](https://www.okx.com/help/introduction-to-liquidation)

## 期权交易

OKX 适配器支持交易期权（`OPTION` 金融工具类型），但与其他衍生品存在一些差异。OKX 期权是以标的加密货币结算的反向合约。完整 API 详情参见 [OKX 期权交易文档](https://www.okx.com/docs-v5/en/#order-book-trading-trade-post-place-order)。

### 支持的订单类型

仅支持限价风格订单。OKX 不允许期权市价单。

| 订单类型 | 支持 | 备注                        |
| -------- | ---- | --------------------------- |
| `LIMIT`  | ✓    | 标准限价单。                |
| `MARKET` | -    | 在到达 API 前由适配器拒绝。 |

期权支持 FOK 和 IOC 有效期。OKX 对期权 FOK 订单使用专用 `op_fok` 订单类型；适配器自动处理此映射。

期权不支持条件/algo 订单（`STOP_MARKET`、`STOP_LIMIT`、`MARKET_IF_TOUCHED`、`LIMIT_IF_TOUCHED`、`TRAILING_STOP_MARKET`），会被否决。

### 定价模式

期权订单可通过三种互斥方式定价。通过订单 `params` 传入定价模式：

| 模式 | 参数     | 说明                                   |
| ---- | -------- | -------------------------------------- |
| 价格 | （默认） | 以合约货币表示的标准限价。             |
| USD  | `px_usd` | 以 USD 表示的价格。                    |
| IV   | `px_vol` | 以隐含波动率表示的价格（1.0 = 100%）。 |

```python
# Price in USD
order = strategy.order_factory.limit(
    instrument_id=InstrumentId.from_str("BTC-USD-250328-50000-C.OKX"),
    order_side=OrderSide.BUY,
    quantity=Quantity.from_int(1),
    price=Price.from_str("0"),  # Placeholder; px_usd takes precedence
    params={"px_usd": "100.5"},
)

# Price in implied volatility
order = strategy.order_factory.limit(
    instrument_id=InstrumentId.from_str("BTC-USD-250328-50000-C.OKX"),
    order_side=OrderSide.BUY,
    quantity=Quantity.from_int(1),
    price=Price.from_str("0"),  # Placeholder; px_vol takes precedence
    params={"px_vol": "0.55"},
)
```

修改订单时，可向修改命令传入相同的 `px_usd` 或 `px_vol` params，以原定价模式修改价格。

### 期权 Greeks

OKX 在 `opt-summary` 频道发布两组并行 Greeks：

- **Black-Scholes（`BLACK_SCHOLES`）**：以 USD 计价，与 Deribit 和 Bybit 适配器的约定一致。
- **价格调整（`PRICE_ADJUSTED`）**：以标的币单位计价，与 OKX 原生合约约定一致。

默认情况下，适配器在每个 `opt-summary` tick 上发出两组。每个 `OptionGreeks` 都携带设为 `GreeksConvention.BLACK_SCHOLES` 或 `GreeksConvention.PRICE_ADJUSTED` 的 `convention` 字段，接收方可按消息分支处理。

要缩小数据流，请在订阅时传入 `params["greeks_convention"]`：

- 单个字符串：`"BLACK_SCHOLES"` 或 `"PRICE_ADJUSTED"`（不区分大小写）。
- 字符串列表：`["BLACK_SCHOLES", "PRICE_ADJUSTED"]`。
- 省略：适配器发出两者。

未知条目会记录警告并跳过。如果所有请求条目均未知，适配器会回退为发出两者。

```python
# Default (both conventions, receiver branches)
self.subscribe_option_greeks(instrument_id)


def on_option_greeks(self, greeks: OptionGreeks) -> None:
    if greeks.convention == GreeksConvention.BLACK_SCHOLES:
        self._handle_bs(greeks)
    else:
        self._handle_pa(greeks)
```

```python
# Single-convention narrowing
self.subscribe_option_greeks(
    instrument_id,
    params={"greeks_convention": "PRICE_ADJUSTED"},
)
```

```python
# Explicit list (equivalent to the default when both are listed)
self.subscribe_option_greeks(
    instrument_id,
    params={"greeks_convention": ["BLACK_SCHOLES", "PRICE_ADJUSTED"]},
)
```

:::note
数据引擎按 `instrument_id` 对期权 Greeks 订阅去重，因此如果一个节点上的两个 actor 以不同的单一约定订阅同一金融工具，只有第一个会到达适配器。第二个 actor 会获得第一个 actor 的约定集合。解决方法：任一 actor 均可不带 `params`（或带完整列表）订阅两条数据流，并在本地按 `greeks.convention` 筛选。
:::

### 持仓 Greeks

适配器从 OKX 持仓数据公开持仓级 Black-Scholes Greeks（`delta_bs`、`gamma_bs`、`theta_bs`、`vega_bs`），可通过标准持仓报告管线获得。

### 限制

- `reduce_only` 不适用于期权，会自动移除。
- 持仓方向默认为 `Net`。

### 配置

:::warning
期权发现至少需要一个 `instrument_families` 值。公开 Python 数据和执行配置构造函数目前不公开此字段，因此选择 `OKXInstrumentType.OPTION` 会跳过期权加载并记录警告。
:::

## 事件合约

OKX 通过 `instType=EVENTS` 提供预测市场合约。适配器将这些金融工具加载为 Vibe `BinaryOption` 金融工具，并在金融工具的 `info` 字段中保留 `seriesId`、`instCategory`、`instIdCode`、`state` 和 `ruleType` 等 OKX 元数据。

### 加载事件合约金融工具

在数据或执行客户端配置中使用 `OKXInstrumentType.EVENTS`。适配器先请求事件合约系列列表，再请求每个系列的金融工具。

```python
from vibe_trader.adapters.okx import OKXDataClientConfig
from vibe_trader.adapters.okx import OKXInstrumentType


data_config = OKXDataClientConfig(instrument_types=[OKXInstrumentType.EVENTS])
```

### 事件合约市场数据

底层 HTTP 客户端公开 OKX 的公共事件合约发现端点：

- `request_event_contract_series`。
- `request_event_contract_events`。
- `request_event_contract_markets`。

底层 WebSocket 客户端通过 `subscribe_event_contract_markets` 和 `unsubscribe_event_contract_markets` 支持 `event-contract-markets` 频道。该频道发布市场状态和最低执行价生成更新，没有初始快照，且不包含 `instId`，因此适配器将其作为原始交易场所 JSON 转发。

:::note
OKX 的标准市场数据端点为 `EVENTS` 返回 YES 侧数据。当策略需要两个结果时，请根据 YES 侧价格推导 NO 侧价格。
:::

### 事件合约交易

提交事件合约订单时，通过订单 `params` 传入 OKX 事件结果：

```python
order = strategy.order_factory.limit(
    instrument_id=InstrumentId.from_str("BTC-ABOVE-DAILY-260224-1600-65000.OKX"),
    order_side=OrderSide.BUY,
    quantity=Quantity.from_int(1),
    price=Price.from_str("0.42"),
    params={"outcome": "yes"},
)
strategy.submit_order(order)
```

OKX 要求 `EVENTS` 订单提供 `outcome`。非 post-only 事件合约订单及其修改还要求 `speedBump=1`。适配器会在发送订单前验证 `outcome`；对于未提供 `speedBump` 的非 post-only 事件订单，默认将其设为 `1`。

结算成交的 OKX 订单类别为 `delivery`。适配器会在实时订单更新和对账期间识别此类别。

上游参考资料：

- [事件合约 REST 端点](https://www.okx.com/docs-v5/en/#public-data-rest-api-get-series)。
- [WS 频道](https://www.okx.com/docs-v5/en/#public-data-websocket-event-contract-markets-channel)。
- [下单请求字段](https://www.okx.com/docs-v5/en/#order-book-trading-trade-post-place-order)。

## 身份验证

要使用 OKX 适配器，请在您的 OKX 账户中创建 API 凭证：

1. 登录 OKX 账户并前往 API 管理页面。
2. 创建一个新 API 密钥，并授予交易和数据访问所需的权限。
3. 记录 API 密钥、secret key 和 passphrase。

您可以通过环境变量提供这些凭证：

```bash
export OKX_API_KEY="your_api_key"
export OKX_API_SECRET="your_api_secret"
export OKX_API_PASSPHRASE="your_passphrase"
```

也可以直接在配置中传入（不建议用于生产环境）。

## 模拟交易

OKX 提供模拟交易环境，可在不使用真实资金的情况下测试策略。

### 设置模拟账户

1. 在 [okx.com](https://www.okx.com) 登录您的 OKX 账户。
2. 前往 **交易** > **模拟交易**。
3. 进入模拟交易中的 **个人中心**。
4. 选择 **模拟交易 API** 并创建新的 API 密钥。
5. 记录模拟 API 密钥、secret key 和 passphrase。

您可以通过环境变量提供模拟凭证：

```bash
export OKX_API_KEY="your_demo_api_key"
export OKX_API_SECRET="your_demo_api_secret"
export OKX_API_PASSPHRASE="your_demo_passphrase"
```

### 配置

在客户端配置中设置 `environment=OKXEnvironment.DEMO`：

```python
from vibe_trader.adapters.okx import OKXDataClientConfig
from vibe_trader.adapters.okx import OKXEnvironment


data_config = OKXDataClientConfig(environment=OKXEnvironment.DEMO)
```

启用模拟模式时：

- REST API 请求包含 `x-simulated-trading: 1` 标头。
- WebSocket 连接使用模拟端点（`wspap.okx.com`）。

:::note
模拟 API 密钥与生产密钥相互独立。请通过模拟交易界面创建模拟交易 API 密钥；生产 API 密钥不能用于模拟模式。
:::

## 区域端点

OKX 为各区域提供不同的端点，API 密钥仅对其注册区域有效（使用密钥访问其他区域的端点会返回 `API key doesn't exist`）。设置 `region` 以选择正确的端点集合：

| 区域     | 注册站点      | REST          | WebSocket 主机  |
| -------- | ------------- | ------------- | --------------- |
| `GLOBAL` | `www.okx.com` | `www.okx.com` | `ws.okx.com`    |
| `EEA`    | `my.okx.com`  | `eea.okx.com` | `wseea.okx.com` |
| `US`     | `app.okx.com` | `us.okx.com`  | `wsus.okx.com`  |

`region` 默认为 `GLOBAL`。例如，对于 EEA 账户：

```python
from vibe_trader.adapters.okx import OKXDataClientConfig
from vibe_trader.adapters.okx import OKXRegion


data_config = OKXDataClientConfig(region=OKXRegion.EEA)
```

`region` 选择区域默认值，并与 `environment` 组合以选择模拟主机（例如 EEA 模拟环境使用 `wseeapap.okx.com`）。显式的 `base_url_http` 和 `base_url_ws` 覆盖始终优先于区域默认值。

## 资金费率

适配器从 [Funding Rate Channel](https://www.okx.com/docs-v5/en/#public-data-websocket-funding-rate-channel) WebSocket 数据流接收资金费率数据。OKX 在每条消息中同时提供 `fundingTime` 和 `nextFundingTime`，适配器将二者之差计算为 `interval`。

对于历史资金费率请求，适配器根据 [Get Funding Rate History](https://www.okx.com/docs-v5/en/#public-data-rest-api-get-funding-rate-history) 端点返回的连续资金费率时间戳计算间隔。

## 速率限制

适配器强制执行 OKX 的逐端点配额，同时为 REST 和 WebSocket 调用保留合理的默认限制。

### REST 限制

- 内部全局桶：每秒 250 个请求。
- 下表列出了各端点配额；在 OKX 已公布限制的情况下，表中配额与其保持一致。

### WebSocket 限制

- 建立连接：每秒 3 个请求（按 IP）。
- 订阅操作（subscribe/unsubscribe/login）：每个连接每小时 480 个请求。
- 下表列出了订单操作桶；在 OKX 已公布限制的情况下，表中配额与其保持一致。

| 操作键         | 限制（请求/秒） | 说明                                         |
| -------------- | --------------- | -------------------------------------------- |
| `order`        | 30              | OKX 每 2 秒 60 个请求。                      |
| `cancel`       | 30              | OKX 每 2 秒 60 个请求。                      |
| `amend`        | 30              | OKX 每 2 秒 60 个请求。                      |
| `batch-order`  | 7               | OKX 每 2 秒 300 个订单，按完整批次向下取整。 |
| `batch-cancel` | 7               | OKX 每 2 秒 300 个订单，按完整批次向下取整。 |
| `batch-amend`  | 7               | OKX 每 2 秒 300 个订单，按完整批次向下取整。 |
| `mass-cancel`  | 2               | OKX 每 2 秒 5 个请求，向下取整。             |
| `algo-order`   | 10              | OKX 每 2 秒 20 个请求。                      |
| `algo-cancel`  | 1               | OKX 每 2 秒 20 个订单，按完整批次向下取整。  |

:::warning
OKX 强制执行逐端点和逐账户配额。超出配额会导致 HTTP 429 响应，并暂时限制该密钥的请求。
:::

| 键 / 端点                               | 限制（请求/秒） | 说明                               |
| --------------------------------------- | --------------- | ---------------------------------- |
| `okx:global`                            | 250             | 适配器级共享桶。                   |
| `/api/v5/account/set-position-mode`     | 2               | OKX 每 2 秒 5 个请求，向下取整。   |
| `/api/v5/account/balance`               | 5               | OKX 每 2 秒 10 个请求。            |
| `/api/v5/account/trade-fee`             | 2               | OKX 每 2 秒 5 个请求，向下取整。   |
| `/api/v5/account/instruments`           | 10              | OKX 每 2 秒 20 个请求。            |
| `/api/v5/account/positions`             | 5               | OKX 每 2 秒 10 个请求。            |
| `/api/v5/account/positions-history`     | 5               | OKX 每 2 秒 10 个请求。            |
| `/api/v5/public/instruments`            | 10              | OKX 每 2 秒 20 个请求。            |
| `/api/v5/public/position-tiers`         | 5               | OKX 每 2 秒 10 个请求。            |
| `/api/v5/public/event-contract/series`  | 5               | OKX 每 2 秒 10 个请求。            |
| `/api/v5/public/event-contract/events`  | 5               | OKX 每 2 秒 10 个请求。            |
| `/api/v5/public/event-contract/markets` | 5               | OKX 每 2 秒 10 个请求。            |
| `/api/v5/public/opt-summary`            | 10              | OKX 每 2 秒 20 个请求。            |
| `/api/v5/public/price-limit`            | 10              | OKX 每 2 秒 20 个请求。            |
| `/api/v5/public/time`                   | 5               | OKX 每 2 秒 10 个请求。            |
| `/api/v5/public/mark-price`             | 5               | OKX 每 2 秒 10 个请求。            |
| `/api/v5/public/funding-rate-history`   | 5               | OKX 每 2 秒 10 个请求。            |
| `/api/v5/market/index-tickers`          | 10              | OKX 每 2 秒 20 个请求。            |
| `/api/v5/market/books`                  | 20              | OKX 每 2 秒 40 个请求。            |
| `/api/v5/market/books-rpi`              | 20              | OKX 每 2 秒 40 个请求。            |
| `/api/v5/market/candles`                | 20              | OKX 每 2 秒 40 个请求。            |
| `/api/v5/market/history-candles`        | 10              | OKX 每 2 秒 20 个请求。            |
| `/api/v5/market/history-trades`         | 10              | OKX 每 2 秒 20 个请求。            |
| `/api/v5/sprd/spreads`                  | 10              | OKX 每 2 秒 20 个请求。            |
| `/api/v5/sprd/order`                    | 10              | OKX 每 2 秒 20 个请求。            |
| `/api/v5/sprd/cancel-order`             | 10              | OKX 每 2 秒 20 个请求。            |
| `/api/v5/sprd/mass-cancel`              | 5               | OKX 每 2 秒 10 个请求。            |
| `/api/v5/sprd/orders-pending`           | 5               | OKX 每 2 秒 10 个请求。            |
| `/api/v5/sprd/orders-history`           | 10              | OKX 每 2 秒 20 个请求。            |
| `/api/v5/sprd/trades`                   | 10              | OKX 每 2 秒 20 个请求。            |
| `/api/v5/trade/order`                   | 30              | OKX 每 2 秒 60 个请求。            |
| `/api/v5/trade/batch-orders`            | 7               | OKX 每 2 秒 300 个订单，向下取整。 |
| `/api/v5/trade/amend-order`             | 30              | OKX 每 2 秒 60 个请求。            |
| `/api/v5/trade/amend-batch-orders`      | 7               | OKX 每 2 秒 300 个订单，向下取整。 |
| `/api/v5/trade/cancel-batch-orders`     | 7               | OKX 每 2 秒 300 个订单，向下取整。 |
| `/api/v5/trade/orders-pending`          | 30              | OKX 每 2 秒 60 个请求。            |
| `/api/v5/trade/orders-history`          | 20              | OKX 每 2 秒 40 个请求。            |
| `/api/v5/trade/fills`                   | 30              | OKX 每 2 秒 60 个请求。            |
| `/api/v5/trade/order-algo`              | 10              | OKX 每 2 秒 20 个请求。            |
| `/api/v5/trade/cancel-algos`            | 1               | OKX 每 2 秒 20 个订单。            |
| `/api/v5/trade/cancel-advance-algos`    | 1               | 高级 algo 取消操作的保守配额桶。   |
| `/api/v5/trade/amend-algos`             | 10              | OKX 每 2 秒 20 个请求。            |
| `/api/v5/trade/orders-algo-pending`     | 10              | OKX 每 2 秒 20 个请求。            |
| `/api/v5/trade/orders-algo-history`     | 10              | OKX 每 2 秒 20 个请求。            |

所有键都包含 `okx:global` 桶。执行速率限制前会移除查询字符串以规范化 URL，因此带有不同筛选条件的请求共享同一配额。

对于基于订单数的批量配额，适配器使用假定完整批次大小的请求级桶：常规批量操作每个请求 20 个订单，algo 取消每个请求 10 个订单。OKX 的公开文档未列出 `/api/v5/trade/cancel-advance-algos` 的速率限制，但由于 HTTP 客户端可以调用该旧版路径，适配器仍为其设置了端点专用桶。

:::info
请参阅 [OKX 速率限制文档](https://www.okx.com/docs-v5/en/#rest-api-rate-limit)。
:::

## 配置

### 配置选项

OKX 数据客户端提供以下 Python 配置选项。

#### 数据客户端

| 选项                               | 默认值                      | 描述                                  |
| ---------------------------------- | --------------------------- | ------------------------------------- |
| `instrument_types`                 | `(OKXInstrumentType.SPOT,)` | 要加载的 OKX 金融工具类型。           |
| `load_spreads`                     | `False`                     | 加载实时价差金融工具。                |
| `base_url_http`                    | `None`                      | 覆盖 OKX REST 端点。                  |
| `base_url_ws_public`               | `None`                      | 覆盖公共 WebSocket URL。              |
| `base_url_ws_business`             | `None`                      | 覆盖 business WebSocket URL。         |
| `api_key`                          | `None`                      | 未设置时回退到 `OKX_API_KEY`。        |
| `api_secret`                       | `None`                      | 未设置时回退到 `OKX_API_SECRET`。     |
| `api_passphrase`                   | `None`                      | 回退到 `OKX_API_PASSPHRASE`。         |
| `environment`                      | `LIVE`                      | 环境枚举（`LIVE` 或 `DEMO`）。        |
| `region`                           | `GLOBAL`                    | 区域枚举（`GLOBAL`、`EEA` 或 `US`）。 |
| `http_timeout_secs`                | `60`                        | REST 市场数据请求超时。               |
| `max_retries`                      | `3`                         | 可恢复 REST 错误的重试次数。          |
| `retry_delay_initial_ms`           | `1,000`                     | 重试前的初始延迟。                    |
| `retry_delay_max_ms`               | `10,000`                    | 最大指数退避延迟。                    |
| `update_instruments_interval_mins` | `60`                        | 后台金融工具刷新间隔。                |
| `book_stale_check_interval_secs`   | `5`                         | 陈旧订单簿检查间隔。                  |
| `book_stale_threshold_secs`        | `30`                        | 发出陈旧订单簿警告前的空闲时间。      |
| `book_snapshot_timeout_secs`       | `3`                         | 重连后的快照等待时间。                |
| `vip_level`                        | `None`                      | 按 VIP 等级启用更深档位的订单簿。     |
| `proxy_url`                        | `None`                      | 可选的 HTTP 和 WebSocket 代理 URL。   |
| `transport_backend`                | `Sockudo`                   | WebSocket 传输后端。                  |

将 `book_stale_check_interval_secs`、`book_stale_threshold_secs` 或 `book_snapshot_timeout_secs` 设为 `0` 可禁用对应的健康监控。交易清淡的市场可能长时间没有订单簿更新；对于稀疏交易的金融工具，请增大 `book_stale_threshold_secs`。

数据客户端支持的 `instrument_types` 值为 `SPOT`、`MARGIN`、`SWAP`、`FUTURES`、`OPTION` 和 `EVENTS`。从 Python 选择 `OPTION` 前，请参阅[期权交易](#期权交易)。

价差金融工具使用 `load_spreads` 而不是 `instrument_types`，因为 OKX 通过 `/api/v5/sprd/spreads` 提供这些工具。

OKX 执行客户端提供以下配置选项：

#### 执行客户端

| 选项                     | 默认值                      | 描述                                  |
| ------------------------ | --------------------------- | ------------------------------------- |
| `instrument_types`       | `(OKXInstrumentType.SPOT,)` | 可交易的 OKX 金融工具类型。           |
| `load_spreads`           | `False`                     | 加载实时价差金融工具。                |
| `trader_id`              | 必填                        | 客户端的 Vibe trader ID。             |
| `account_id`             | 必填                        | 客户端的 Vibe account ID。            |
| `base_url_http`          | `None`                      | 覆盖 OKX 交易 REST 端点。             |
| `base_url_ws_private`    | `None`                      | 覆盖私有 WebSocket URL。              |
| `base_url_ws_business`   | `None`                      | 覆盖 business WebSocket URL。         |
| `api_key`                | `None`                      | 未设置时回退到 `OKX_API_KEY`。        |
| `api_secret`             | `None`                      | 未设置时回退到 `OKX_API_SECRET`。     |
| `api_passphrase`         | `None`                      | 回退到 `OKX_API_PASSPHRASE`。         |
| `environment`            | `LIVE`                      | 环境枚举（`LIVE` 或 `DEMO`）。        |
| `region`                 | `GLOBAL`                    | 区域枚举（`GLOBAL`、`EEA` 或 `US`）。 |
| `margin_mode`            | `None`                      | 保证金模式（`ISOLATED` 或 `CROSS`）。 |
| `http_timeout_secs`      | `60`                        | REST 交易请求超时。                   |
| `max_retries`            | `3`                         | 可恢复 REST 错误的重试次数。          |
| `retry_delay_initial_ms` | `1,000`                     | 重试前的初始延迟。                    |
| `retry_delay_max_ms`     | `10,000`                    | 最大指数退避延迟。                    |
| `auth_timeout_secs`      | `None`                      | 覆盖 WebSocket 身份验证超时。         |
| `proxy_url`              | `None`                      | 可选的 HTTP 和 WebSocket 代理 URL。   |
| `transport_backend`      | `Sockudo`                   | WebSocket 传输后端。                  |

执行客户端支持的 `instrument_types` 值为 `SPOT`、`MARGIN`、`SWAP`、`FUTURES`、`OPTION` 和 `EVENTS`。从 Python 选择 `OPTION` 前，请参阅[期权交易](#期权交易)。

价差金融工具使用 OKX 价差 ID，而不是 `instrument_types`；交易前，请在数据和执行客户端上使用 `load_spreads=True` 加载这些金融工具。

### 手动覆盖端点

设置 `region`（请参阅[区域端点](#区域端点)）会自动选择正确的 EEA 或 US 端点，这是推荐做法。显式的 `base_url_*` 覆盖仍可用于代理、自定义路由或区域未涵盖的端点，并优先于 `region` 默认值。下表以 EEA 基础地址为例。

| 配置字段               | 实时基础地址               | 模拟基础地址                  | WebSocket 路径    |
| ---------------------- | -------------------------- | ----------------------------- | ----------------- |
| `base_url_http`        | `https://eea.okx.com`      | `https://eea.okx.com`         |                   |
| `base_url_ws_public`   | `wss://wseea.okx.com:8443` | `wss://wseeapap.okx.com:8443` | `/ws/v5/public`   |
| `base_url_ws_private`  | `wss://wseea.okx.com:8443` | `wss://wseeapap.okx.com:8443` | `/ws/v5/private`  |
| `base_url_ws_business` | `wss://wseea.okx.com:8443` | `wss://wseeapap.okx.com:8443` | `/ws/v5/business` |

对于 WebSocket 字段，请拼接同一行中的基础地址和路径。

数据客户端配置使用 `base_url_ws_public`，执行客户端配置使用 `base_url_ws_private`。覆盖任一 WebSocket URL 时，还需设置 `base_url_ws_business`，因为适配器不会根据其他覆盖值派生自定义 business WebSocket URL。

有关当前官方端点列表，请参阅 [OKX EEA API 文档](https://my.okx.com/docs-v5/en/)。

将 `OKXDataClientConfig` 与 `OKXDataClientFactory` 配合使用，将 `OKXExecClientConfig` 与 `OKXExecutionClientFactory` 配合使用。当前 Python 示例展示了数据和执行客户端的完整 `LiveNode.builder(...)` 配置。

## 贡献

:::info
有关其他功能或为 OKX 适配器贡献代码，请参阅我们的[贡献指南](https://github.com/qOeOp/trade/blob/main/CONTRIBUTING.md)。
:::
