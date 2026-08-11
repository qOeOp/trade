# Binance

Binance 成立于 2017 年，是按日交易量、加密资产及加密衍生品未平仓量计算规模最大的加密货币交易所之一。

VibeTrader 提供 Binance 实时市场数据和执行集成。适配器使用 Rust 实现，并通过相同的公开配置、
工厂和数据类型向 Python 提供接口。

支持的产品：

- **Binance Spot**（包括 Binance US）
- **Binance USDT 保证金期货**（加密货币和 TradFi 永续合约；当月、次月以及当季、次季交割合约）
- **Binance 币本位期货**（永续合约及当季或次季交割合约）

## 示例

- [Python 示例](https://github.com/qOeOp/trade/tree/main/examples/live/binance/)
- [Rust 现货示例](https://github.com/qOeOp/trade/tree/main/crates/adapters/binance/examples/spot/)
- [Rust 期货示例](https://github.com/qOeOp/trade/tree/main/crates/adapters/binance/examples/futures/)

## 概览

适配器公开以下组件：

- `BinanceDataClientConfig` 和 `BinanceExecClientConfig`：实盘客户端配置。
- `BinanceInstrumentProviderConfig`：金融工具选择、筛选、警告和费用策略。
- `BinanceDataClientFactory` 和 `BinanceExecutionClientFactory`：交易节点客户端工厂。
- `load_binance_instruments`：独立的已配置金融工具发现功能。
- `load_binance_order_book_deltas`：由 Rust 支持的 Binance 深度 CSV 加载器，用于整理订单簿数据。
- `BINANCE`、`BINANCE_CLIENT_ID`、`BINANCE_VENUE` 及客户端订单 ID 解码器：公开标识符和解码工具。

:::note
大多数用户会配置实盘交易节点（如下所示），无需直接操作这些底层组件。
:::

底层 HTTP 和 WebSocket 客户端、其缓存以及产品特定的金融工具提供器对象均为私有 Rust 实现细节。
请使用实盘配置和工厂或独立金融工具加载器，不要依赖这些内部实现。

进行独立发现时，请传入与实盘客户端相同的数据客户端和提供器配置：

```python
import asyncio

from vibe_trader.adapters.binance import BinanceDataClientConfig
from vibe_trader.adapters.binance import BinanceInstrumentProviderConfig
from vibe_trader.adapters.binance import BinanceProductType
from vibe_trader.adapters.binance import load_binance_instruments

config = BinanceDataClientConfig(
    product_type=BinanceProductType.USD_M,
    instrument_provider=BinanceInstrumentProviderConfig(
        load_all=False,
        load_ids=["BTCUSDT-PERP.BINANCE"],
    ),
)
instruments = asyncio.run(load_binance_instruments(config))
```

此函数支持 Spot、USD-M 和 COIN-M。它会使用已配置的环境、URL、代理、接收窗口、Binance US 模式、
筛选器、警告策略和佣金策略。Margin 不是受支持的 Binance 产品，因而会被拒绝。

对于 Binance 深度 CSV 数据，请直接调用无状态加载器：

```python
from vibe_trader.adapters.binance import load_binance_order_book_deltas

df = load_binance_order_book_deltas(path, nrows=1_000_000)
```

加载器会保留源值和列顺序。文件打开失败以及无效的数字或方向值会引发 `RuntimeError`。

### 产品支持

| 产品类型                      | 支持 | 说明                 |
| ----------------------------- | ---- | -------------------- |
| 现货市场（包括 Binance US）   | ✓    |                      |
| 保证金账户（全仓与逐仓）      | -    | *尚未实现。*         |
| USDT 保证金期货（永续与交割） | ✓    | 月度和季度交割合约。 |
| 币本位期货（永续与交割）      | ✓    | 季度交割合约。       |

:::note
借款、还款和逐仓保证金管理等保证金账户功能尚未实现。
:::

:::info
每个 Binance 客户端实例只处理一种产品类型。配置使用单数 `product_type` 字段，实盘工厂从一份配置
创建一个数据客户端或执行客户端。要在同一节点运行 Spot 和 Futures，请使用 `BINANCE_SPOT` 和
`BINANCE_FUTURES` 等不同 ID 配置独立客户端，然后在策略订阅或提交订单时传入匹配的 `client_id`。
完整客户端设置请参阅当前 Python 示例。
:::

## 数据类型

集成包含多种自定义数据类型：

- `BinanceSpotTicker`：现货 24 小时 ticker 数据，包括价格、成交量和交易统计。
- `BinanceFuturesTicker`：期货 24 小时 ticker 数据，包括价格和统计信息。
- `BinanceBar`：包含额外成交量指标的 K 线数据，用于历史和实时场景。
- `BinanceFuturesMarkPriceUpdate`：期货标记数据，包括预估结算价。
- `BinanceFuturesLiquidation`：来自 `forceOrder` 数据流的期货强平事件。

完整定义请参阅 Binance [API 参考](/docs/python-api-latest/adapters/binance.html)。

## 符号体系

现货和期货合约尽可能使用 Binance 原生符号。由于 VibeTrader 支持多交易场所交易，必须区分现货交易对
`BTCUSDT` 和永续期货合约 `BTCUSDT`（Binance 对二者使用相同符号）。

Vibe 会为 USD-M 永续符号添加 `-PERP`。例如，Binance USD-M `BTCUSDT` 永续合约会变为
`BTCUSDT-PERP`。USD-M `TRADIFI_PERPETUAL` 上市品种也使用相同后缀，因此 `XAUUSDT` 会变为
`XAUUSDT-PERP`。

适配器将 `TRADIFI_PERPETUAL` 上市品种映射为 `PerpetualContract`，并根据 Binance 的
`underlyingType` 派生其资产类别：

| Binance `underlyingType`                        | Vibe 资产类别 |
| ----------------------------------------------- | ------------- |
| `EQUITY`, `KR_EQUITY`, `HK_EQUITY`, `PREMARKET` | 股票          |
| `COMMODITY`                                     | 大宗商品      |

其他值或缺失值的上市品种会被跳过并发出警告。

适配器为 COIN-M 永续合约保留 Binance 原生 `_PERP` 后缀，因此 `BTCUSD_PERP` 保持不变。

交割符号保留 Binance 的 `_YYMMDD` 后缀。例如，`BTCUSDT_260925` 和 `BTCUSD_260925` 在 Vibe 中
保持不变。USD-M 支持文档所述的 `CURRENT_MONTH`、`NEXT_MONTH`、`CURRENT_QUARTER` 和
`NEXT_QUARTER` 合约类型。COIN-M 支持 `CURRENT_QUARTER` 和 `NEXT_QUARTER`。合约可用性因环境和上市周期而异。

USD-M 交割金融工具为线性合约，以保证金资产结算。COIN-M 交割金融工具为反向合约，以保证金资产
（基础货币）结算，并使用 Binance 的 `contractSize` 作为金融工具乘数。二者都使用 `onboardDate` 和
`deliveryDate` 表示激活和到期时间。请参阅 Binance 官方
[USD-M 通用定义](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/common-definition)
和 [COIN-M 通用定义](https://developers.binance.com/en/docs/products/derivatives-trading-coin-futures/common-definition)。

Rust Futures 数据测试器无需修改源码即可接受交割金融工具：

```bash
BINANCE_FUTURES_INSTRUMENT_ID=BTCUSDT_260925.BINANCE \
  cargo run -p vibe-binance --example binance-futures-data-tester --features examples
```

## 订单能力

下列表格详细说明各 Binance 账户类型支持的订单类型、执行指令和有效期选项。

### 订单类型

| 订单类型               | 现货 | 保证金 | USDT 期货 | 币本位期货 | 说明                       |
| ---------------------- | ---- | ------ | --------- | ---------- | -------------------------- |
| `MARKET`               | ✓    | -      | ✓         | ✓          | 报价货币数量支持：仅现货。 |
| `LIMIT`                | ✓    | -      | ✓         | ✓          |                            |
| `STOP_MARKET`          | -    | -      | ✓         | ✓          | 仅期货。                   |
| `STOP_LIMIT`           | ✓    | -      | ✓         | ✓          |                            |
| `MARKET_IF_TOUCHED`    | -    | -      | ✓         | ✓          | 仅期货。                   |
| `LIMIT_IF_TOUCHED`     | ✓    | -      | ✓         | ✓          |                            |
| `TRAILING_STOP_MARKET` | -    | -      | ✓         | ✓          | 仅期货。                   |

### 执行指令

| 指令          | 现货 | 保证金 | USDT 期货 | 币本位期货 | 说明                           |
| ------------- | ---- | ------ | --------- | ---------- | ------------------------------ |
| `post_only`   | ✓    | -      | ✓         | ✓          | 参阅下方限制。                 |
| `reduce_only` | -    | -      | ✓         | ✓          | 仅期货；在 Hedge Mode 中禁用。 |

#### 只挂单限制

仅*限价*订单类型支持 `post_only`。

| 订单类型     | 现货 | 保证金 | USDT 期货 | 币本位期货 | 说明                                         |
| ------------ | ---- | ------ | --------- | ---------- | -------------------------------------------- |
| `LIMIT`      | ✓    | -      | ✓         | ✓          | 现货使用 `LIMIT_MAKER`，期货使用 `GTX` TIF。 |
| `STOP_LIMIT` | -    | -      | ✓         | ✓          | 仅期货。                                     |

### 有效期类型

| 有效期类型 | 现货 | 保证金 | USDT 期货 | 币本位期货 | 说明                             |
| ---------- | ---- | ------ | --------- | ---------- | -------------------------------- |
| `GTC`      | ✓    | -      | ✓         | ✓          | 撤销前有效。                     |
| `GTD`      | ✓*   | -      | ✓         | ✓*         | *通过 `GTC` 进行非默认本地映射。 |
| `FOK`      | ✓    | -      | ✓         | ✓          | 全部成交或取消。                 |
| `IOC`      | ✓    | -      | ✓         | ✓          | 立即成交或取消。                 |

#### GTD 策略

[Binance Spot 有效期值](https://github.com/binance/binance-spot-api-docs/blob/master/enums.md)为
`GTC`、`IOC` 和 `FOK`；Spot 没有原生 `GTD` 或 `goodTillDate`。USD-M 对 `LIMIT` 以及 `STOP` 和
`TAKE_PROFIT` 的限价形式支持原生 `GTD`。适配器通过 HTTP 或 WebSocket 交易路由普通订单，通过 HTTP
`batchOrders` 路由独立批次，通过 HTTP `algoOrder` 路由条件算法订单。当前 Binance WebSocket 算法模式
包含 `goodTillDate`，但其 `timeInForce` 枚举不包含 `GTD`，因此适配器不会通过该端点路由 GTD 算法订单。
COIN-M 的订单 API 文档中没有原生 `GTD` 值或 `goodTillDate` 参数。请参阅官方
[USD-M 交易 API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade)
和 [COIN-M 通用定义](https://developers.binance.com/en/docs/products/derivatives-trading-coin-futures/common-definition)。

USD-M `goodTillDate` 是以毫秒为单位的 epoch 时间戳，但 Binance 会忽略亚秒部分。Vibe 会拒绝不在整秒边界
上的到期时间，而不是静默取整。到期时间必须严格大于当前时间加 600 秒，且严格小于 `253402300799000`。
原生 GTD 还会拒绝市价单、只挂单订单以及任何没有到期时间的订单。

`use_gtd=True` 是默认值。它使用 USD-M 原生 GTD，并拒绝 Spot 和 COIN-M 上的原生 GTD。
仅当提交策略设置了 `manage_gtd_expiry=True` 时才可设置 `use_gtd=False`。此时适配器会发出警告并发送
`GTC`，而 Vibe 会在本地到期时取消订单。

### 高级订单功能

| 功能     | 现货 | 保证金 | USDT 期货 | 币本位期货 | 说明                                 |
| -------- | ---- | ------ | --------- | ---------- | ------------------------------------ |
| 订单修改 | ✓    | -      | ✓         | ✓          | 仅限 `LIMIT` 订单的价格和数量。      |
| OCO 订单 | ✓    | -      | -         | -          | 现货 OCO 通过 `orderList/oco` 提交。 |
| 括号订单 | -    | -      | -         | -          | *已规划*。目前提交时拒绝。           |
| 冰山订单 | ✓    | -      | ✓         | ✓          | 将大额订单拆分为可见部分。           |

### 批量操作

| 操作     | 现货 | 保证金 | USDT 期货 | 币本位期货 | 说明                            |
| -------- | ---- | ------ | --------- | ---------- | ------------------------------- |
| 批量提交 | ✓    | -      | ✓         | ✓          | 现货 OCO 或期货 `batchOrders`。 |
| 批量修改 | -    | -      | -         | -          | 尚未实现。                      |
| 批量取消 | -*   | -      | ✓         | ✓          | *现货回退到逐笔取消。           |

#### 取消全部订单行为

策略调用 `cancel_all_orders()` 时，适配器会同时包含未结状态和传输中（SUBMITTED）状态的订单，
从而取消尚未被 Binance 确认的订单。

**多策略安全**：多个策略交易同一金融工具时，适配器会将请求策略拥有的订单与该金融工具的全部订单比较。
如果该策略拥有所有订单，则使用单次全部取消 API 调用；否则按策略发送取消请求（普通订单批量取消，
算法订单逐笔取消），避免影响其他策略。

**期货算法订单**：条件订单类型（`STOP_MARKET`、`STOP_LIMIT`、`TAKE_PROFIT`、
`TAKE_PROFIT_MARKET`、`TRAILING_STOP_MARKET`）需要不同的取消端点。适配器会自动路由到正确端点。
算法订单触发并变为普通订单后，使用标准取消端点。

**使用的端点**：

| 账户类型    | 普通订单                        | 算法订单（批量）                 | 算法订单（逐笔）            |
| ----------- | ------------------------------- | -------------------------------- | --------------------------- |
| 现货/保证金 | `DELETE /api/v3/openOrders`     | N/A                              | N/A                         |
| USDT 期货   | `DELETE /fapi/v1/allOpenOrders` | `DELETE /fapi/v1/algoOpenOrders` | `DELETE /fapi/v1/algoOrder` |
| 币本位期货  | `DELETE /dapi/v1/allOpenOrders` | `DELETE /dapi/v1/algoOpenOrders` | `DELETE /dapi/v1/algoOrder` |

#### 提交、修改和取消的重试策略

执行客户端对每条提交、修改或取消命令只发送一次。超时、网络故障或 Binance 未知状态响应后不会盲目重试，
因为首个请求可能已到达撮合引擎。重试可能创建重复订单或再次应用修改。

- 明确的本地验证错误或交易场所拒绝会发出对应的拒绝事件。
- 不明确的传输结果保持传输中状态，由私有数据流或 REST 对账解决。交易场所结果未知时，适配器不会发出错误拒绝。
- 期货算法取消可能从触发前算法端点回退到普通订单端点。这是在订单触发后更换端点，不会向同一端点重复发送相同取消请求。
- 当命令结果不明确时，策略代码不得重新提交。请等待对账，或使用客户端订单 ID 查询订单。

配置不提供订单命令重试控制，因为重新发送结果不明确的命令可能重复创建订单或修改。

### 持仓管理

| 功能       | 现货 | 保证金 | USDT 期货 | 币本位期货 | 说明                           |
| ---------- | ---- | ------ | --------- | ---------- | ------------------------------ |
| 查询持仓   | -    | -      | ✓         | ✓          | 实时持仓更新。                 |
| 持仓模式   | -    | -      | ✓         | ✓          | 单向与 Hedge 模式（持仓 ID）。 |
| 杠杆控制   | -    | -      | ✓         | ✓          | 按符号动态调整杠杆。           |
| 保证金模式 | -    | -      | ✓         | ✓          | 按符号设置全仓或逐仓保证金。   |

### 风险事件

| 功能     | 现货 | 保证金 | USDT 期货 | 币本位期货 | 说明             |
| -------- | ---- | ------ | --------- | ---------- | ---------------- |
| 强平处理 | -    | -      | ✓         | ✓          | 交易所强制平仓。 |
| ADL 处理 | -    | -      | ✓         | ✓          | 自动减仓事件。   |

Binance Futures 可能因风险事件触发交易所生成的订单：

- **强平**：保证金不足以维持持仓时，Binance 会按破产价格强制平仓。这些订单的客户端 ID 以 `autoclose-` 开头。
- **ADL（自动减仓）**：保险基金耗尽时，Binance 会关闭盈利持仓以弥补损失。这些订单使用客户端 ID 前缀 `adl_autoclose`。
- **结算（USDT-M）**：资金/保证金结算订单使用以 `settlement_autoclose-` 开头的客户端 ID。
- **交割（COIN-M）**：到期交割合约会自动平仓，其客户端 ID 以 `delivery_autoclose-` 开头。
- **保险基金**：保险基金接管使用状态 `NEW_INSURANCE`（公共变更日志已弃用，但线上仍可观察到）。

适配器会先于执行类型检查，通过客户端 ID 模式检测这些特殊订单类型，然后：

1. 记录包含订单详情的警告，以便监控。
2. 生成成交详情正确且流动性方向为 TAKER 的 `FillReport`。
3. 生成用于对账的 `OrderStatusReport`。

上游参考资料：

- [USDT-M `ORDER_TRADE_UPDATE`](https://developers.binance.com/docs/derivatives/usds-margined-futures/user-data-streams/Event-Order-Update)
- [COIN-M `ORDER_TRADE_UPDATE`](https://developers.binance.com/docs/derivatives/coin-margined-futures/user-data-streams/Event-Order-Update)

如果运行时状态报告中的订单尚未进入缓存，执行引擎会根据报告创建外部订单。这涵盖首次发现的交易所生成订单
（实盘强平或 ADL 事件的典型情况）。引擎会将订单分配给通过 `external_order_claims` 声明该金融工具的策略，
默认则分配给 `EXTERNAL` 策略。

#### 佣金估算

当 Binance 从成交事件中省略佣金字段（`N`/`n`）时，适配器会使用报价货币，按
`default_taker_fee * qty * price` 估算佣金。这仅适用于 USD-M 线性合约。COIN-M 反向合约回退为零佣金，
因为线性公式没有计入合约大小。请在 `BinanceExecClientConfig` 上配置 `default_taker_fee` 以匹配费用层级
（默认：0.0004 / 0.04%）。

#### Hedge 模式持仓 ID

启用 `use_position_ids`（默认）时，交易所生成的成交报告会包含由金融工具和持仓方向派生的
`venue_position_id`（例如 `ETHUSDT-PERP.BINANCE-LONG`）。Binance 双向持仓应保持启用。
仅对于使用 `OmsType.HEDGING`、由引擎管理持仓身份的虚拟持仓，才应将 `use_position_ids` 设为 false。

对于使用双向持仓模式的 Futures 账户，请设置 `oms_type=OmsType.HEDGING`。单向持仓模式下，适配器默认为
`OmsType.NETTING`。请保持启用 `use_position_ids`，以跟踪 Binance 独立的多头和空头方向。

:::note
状态报告和成交报告会捆绑为单个 `OrderWithFills` 执行报告。引擎先根据状态报告创建外部订单，再应用真实成交，
保留交易场所的 `trade_id` 和 `commission`。捆绑成交未覆盖的剩余数量会使用状态报告的 `avg_px`
推断成交并关闭。
:::

### 订单查询

| 功能         | 现货 | 保证金 | USDT 期货 | 币本位期货 | 说明                 |
| ------------ | ---- | ------ | --------- | ---------- | -------------------- |
| 查询未结订单 | ✓    | ✓      | ✓         | ✓          | 列出所有活动订单。   |
| 查询订单历史 | ✓    | ✓      | ✓         | ✓          | 历史订单数据。       |
| 订单状态更新 | ✓    | ✓      | ✓         | ✓          | 实时订单状态变化。   |
| 成交历史     | ✓    | ✓      | ✓         | ✓          | 执行报告和成交报告。 |

### 条件关联订单

| 功能     | 现货 | 保证金 | USDT 期货 | 币本位期货 | 说明                           |
| -------- | ---- | ------ | --------- | ---------- | ------------------------------ |
| 订单列表 | ✓    | -      | ✓         | ✓          | 现货 OCO 列表；期货独立批次。  |
| OCO 订单 | ✓    | -      | -         | -          | 仅现货，通过 `orderList/oco`。 |
| 括号订单 | -    | -      | -         | -          | *已规划*。目前提交时拒绝。     |
| 条件订单 | ✓    | ✓      | ✓         | ✓          | 止损和触价市价订单。           |

### 订单参数

调用 `Strategy.submit_order`（Python）时提供 `params` 字典，或在 `SubmitOrder` 命令（Rust）上设置
`Params`，即可自定义单个订单。Binance 执行客户端识别：

| 参数             | 类型   | 账户类型       | 说明                                                                                                                                        |
| ---------------- | ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `price_match`    | `str`  | USDT/COIN 期货 | 设置 Binance 的某种 `priceMatch` 模式（参阅下方价格匹配章节），将价格选择委托给交易所。不能与 `post_only` 或冰山（`display_qty`）指令组合。 |
| `close_position` | `bool` | USDT/COIN 期货 | 触发时关闭整个持仓（参阅下方关闭持仓章节）。仅对 `StopMarket` 和 `MarketIfTouched` 订单有效。不能与 `reduce_only` 组合。                    |

### 价格匹配

Binance Futures 通过 `priceMatch` 参数支持 BBO（最优买价/卖价）价格匹配，将价格选择委托给交易所。
限价单无需指定确切价位，即可动态加入订单簿中的最优价格。

使用 `price_match` 时，需提交带参考价格（用于本地风险检查）的限价单，由 Binance 根据当前市场状态和
价格匹配模式确定实际挂单价格。

#### 有效的价格匹配值

| 值            | 行为                                        |
| ------------- | ------------------------------------------- |
| `OPPONENT`    | 加入订单簿对手方最优价格。                  |
| `OPPONENT_5`  | 加入对手方价格，但最多允许偏移 5 个 tick。  |
| `OPPONENT_10` | 加入对手方价格，但最多允许偏移 10 个 tick。 |
| `OPPONENT_20` | 加入对手方价格，但最多允许偏移 20 个 tick。 |
| `QUEUE`       | 加入同侧最优价格（保持为挂单方）。          |
| `QUEUE_5`     | 加入同侧队列，但最多偏移 5 个 tick。        |
| `QUEUE_10`    | 加入同侧队列，但最多偏移 10 个 tick。       |
| `QUEUE_20`    | 加入同侧队列，但最多偏移 20 个 tick。       |

:::info
更多详情请参阅[官方文档](https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api)。
:::

#### 事件序列

使用 `price_match` 提交订单时：

1. Vibe 使用 `priceMatch` 参数向 Binance 发送订单，但 API 请求中省略限价。
2. Binance 接受订单并确定实际挂单价格。
3. Vibe 生成 `OrderAccepted` 事件。
4. 如果 Binance 接受的价格与参考价格不同，Vibe 会生成带实际挂单价格的 `OrderUpdated` 事件。
5. Vibe 缓存中的订单价格此时与 Binance 接受的价格一致。

#### 示例

```python
order = strategy.order_factory.limit(
    instrument_id=InstrumentId.from_str("BTCUSDT-PERP.BINANCE"),
    order_side=OrderSide.BUY,
    quantity=Quantity.from_int(1),
    price=Price.from_str("65000"),  # Reference price for local risk checks
)

strategy.submit_order(
    order,
    params={"price_match": "QUEUE"},
)
```

:::note
如果 Binance 接受订单时采用不同价格（例如 64,995.50），你会先收到 `OrderAccepted` 事件，
随后收到包含新价格的 `OrderUpdated` 事件。
:::

### 关闭持仓

Binance Futures 条件订单支持 `closePosition`，在触发时关闭整个持仓。Binance 会在触发时根据当前持仓数量
在服务端确定数量。

与 `reduce_only` 不同，`closePosition` 会适应持仓数量变化；通过其他方式平仓时，Binance 会自动取消该订单。

在 `StopMarket` 或 `MarketIfTouched` 订单的 `params` 字典中传入 `close_position`。
不能与 `reduce_only` 组合。

```rust tab="Rust"
let params = Params::from([("close_position", true.into())]);
let cmd = SubmitOrder::new(order).with_params(params);
```

```python tab="Python"
strategy.submit_order(order, params={"close_position": True})
```

:::info
设置 `close_position` 后，Vibe 会从 API 请求中省略 `quantity` 和 `reduceOnly`。
订单数量仅用于本地风险检查。
:::

### 追踪止损

对于 Binance 上的追踪止损市价单：

- 使用 `activation_price`（可选）指定追踪机制何时激活。
- 省略时，Binance 使用提交时的当前市场价格。
- 使用 `trailing_offset` 指定回调率（以基点计）。

:::warning
追踪止损订单不要使用 `trigger_price`：这会失败并报错。请改用 `activation_price`。
:::

## Link & Trade

对于通过 Binance 适配器下达的每个订单，所有系统生成的客户端订单 ID 都会自动加上 VibeTrader 集成 ID 前缀。
这样无需用户配置，即可通过 Binance 的 [Link and Trade](https://developers.binance.com/docs/binance_link/link-and-trade)
计划透明地进行订单归因。

适配器使用确定性的双向编码，将出站 `ClientOrderId` 值压缩为适合 Binance 36 字符 `newClientOrderId`
限制的紧凑格式，并在入站订单事件到达策略前解码回原始 ID。此转换完全透明：策略始终只会看到原始
`ClientOrderId` 值。

:::note
集成 ID 前缀适用于所有订单操作，包括提交、修改、取消和状态查询。添加此支持前下达的订单会通过透传解码妥善处理。
:::

### 解码客户端订单 ID

直接查询 Binance（REST API、Web UI 或自己的 HTTP 代码）时，`clientOrderId` 字段包含编码后的形式。
两个工具函数可以恢复原始 Vibe `ClientOrderId`：

```python
from vibe_trader.adapters.binance import (
    decode_binance_futures_client_order_id,
    decode_binance_spot_client_order_id,
)

# Encoded ID from a Binance REST response or the web UI
encoded = "x-TD67BGP9-T0000000000000"
original = decode_binance_spot_client_order_id(encoded)
# Returns "O-20200101-000000-000-000-0"

# Futures equivalent
encoded_futures = "x-aHRE4BCj-T0000000000000"
original_futures = decode_binance_futures_client_order_id(encoded_futures)
# Returns "O-20200101-000000-000-000-0"
```

不带 broker 前缀的字符串会原样返回，因此可以安全地对任何 `clientOrderId` 值调用这些函数。

:::note
领域级 HTTP 客户端（`BinanceSpotHttpClient`、`BinanceFuturesHttpClient`）返回
`OrderStatusReport` 等 Vibe 类型时会自动解码。只有在适配器之外工作时才需手动解码：直接 REST 查询、
Binance Web UI 或原始交易场所模型。
:::

## 订单簿

订单簿可以按完整深度或部分深度维护。Spot 与 Futures 的 WebSocket 数据流更新速率不同，Vibe 使用最高可用速率：

- **Spot SBE 差分深度**：25ms
- **Spot JSON 差分深度**：100ms
- **Futures**：0ms（不限流）

`L1_MBP` 订阅要求深度为 1，使用 Spot `bestBidAsk` 或 `bookTicker` 数据流，以及 Futures `bookTicker`
数据流。每次更新都会发出正常的 `QuoteTick`，以及带 `F_MBP` 标志的双边 `OrderBookDeltas` 批次，
使受管理的 L1 订单簿收到相同的最优档状态。报价和 L1 订阅通过引用计数共享交易场所数据流。
客户端会拒绝同一金融工具并发的 L1 和 L2 订阅。

显式订单簿快照请求与订阅同步分开支持。Spot 接受 1 到 5000 的深度。Futures 接受 5、10、20、50、
100、500 或 1000。

以下情况会触发订单簿快照重建：

- 首次订阅订单簿数据。
- 数据 WebSocket 重连。

事件序列如下：

- 开始缓存增量。
- 请求并等待快照。
- 将快照响应解析为 `OrderBookDeltas`。
- 将快照增量发送给 `DataEngine`。
- 遍历缓存增量，丢弃序列号不大于快照最后一个增量的项目。
- 停止缓存增量。
- 将剩余增量发送给 `DataEngine`。

:::note
此快照加缓存序列适用于 Futures 以及未显式指定深度的 Spot `BookDeltas` 订阅。
Spot 部分深度订阅会交付自包含的前 N 档快照。请参阅[现货市场数据模式](#现货市场数据模式)。
:::

## Binance 数据差异

`QuoteTick` 的 `ts_event` 字段因传输方式而异。Spot SBE 使用微秒事件时间戳。Spot 公共 JSON
`bookTicker` 消息可能省略事件时间戳，此时适配器使用 `ts_init`。Futures 使用交易时间。

## K 线与历史市场数据

Spot 订阅和历史请求支持一秒 K 线。实时 Spot K 线订阅要求 `spot_market_data_mode=Json`，因为 Binance
不会通过 Spot SBE 发布 K 线或 ticker 数据流。Binance Futures 不提供秒级 K 线，因而会拒绝。

已收盘的交易场所 K 线会发出核心 `Bar` 和 `BinanceBar` 自定义数据事件。`BinanceBar` 会保留报价成交量、
成交笔数、吃单方买入基础资产量和吃单方买入报价资产量。历史核心 K 线请求返回 `Bar`；使用
`bar_type` 元数据请求 `BinanceBar` 自定义数据，可在历史响应中保留扩展字段。

不带边界的历史成交请求使用近期成交端点。带时间边界的请求使用聚合成交，最多接受 1000 条记录。
Spot 将提供的边界传给 `/api/v3/aggTrades`。Futures 接受过去 24 小时内的任一边界；同时提供两个边界时，
范围必须短于一小时。

历史核心 K 线请求接受外部聚合的时间 K 线，并使用对应的交易场所 K 线端点。内部聚合 K 线由
`DataEngine` 通过 `bar_types` 请求参数，根据原始成交、报价或源 K 线响应构建；Binance 数据客户端不进行聚合。

## Binance 特定数据

随着 Binance 特定数据流可用，你可以进行订阅。

:::note
K 线、标记价格、指数价格和资金费率可以按常规方式订阅。以下自定义数据订阅通过 Python API
公开交易场所特定的额外字段。
:::

Binance Futures 标记价格载荷会在 `BinanceFuturesMarkPriceUpdate` 中保留交易场所的 `P` 预估结算价。
Vibe 还会从同一数据流发出标准标记价格、指数价格和资金费率更新。可选的 USD-M `ap` 移动平均字段
会在传输边界解析，但不会作为领域数据或自定义数据公开。

### `BinanceSpotTicker`

现货 24 小时 ticker 自定义数据要求公共 JSON 市场数据模式和 `instrument_id` 元数据值：

```python
from vibe_trader.adapters.binance import BinanceSpotTicker
from vibe_trader.model import ClientId
from vibe_trader.model import DataType

self.subscribe_data(
    data_type=DataType(
        BinanceSpotTicker.__name__,
        metadata={"instrument_id": "BTCUSDT.BINANCE"},
    ),
    client_id=ClientId.from_str("BINANCE"),
)
```

适配器订阅该金融工具的 `@ticker` 数据流。SBE 模式会拒绝此订阅，因为 Binance Spot SBE 不提供该数据流。

### `BinanceFuturesTicker`

订阅特定 Futures 金融工具的 24 小时 ticker 统计：

```python
from vibe_trader.adapters.binance import BinanceFuturesTicker
from vibe_trader.model import ClientId
from vibe_trader.model import DataType

client_id = ClientId.from_str("BINANCE")

self.subscribe_data(
    data_type=DataType(
        BinanceFuturesTicker.__name__,
        metadata={"instrument_id": "BTCUSDT-PERP.BINANCE"},
    ),
    client_id=client_id,
)
```

适配器订阅金融工具的 `@ticker` 数据流，并发出带
`metadata={"instrument_id": "<instrument_id>"}` 的 `BinanceFuturesTicker` 自定义数据。
ticker 自定义数据要求 `instrument_id`；不支持全市场 ticker 订阅。

### `BinanceFuturesMarkPriceUpdate`

从 actor 或策略订阅 `BinanceFuturesMarkPriceUpdate`（包括资金费率信息）：

```python
from vibe_trader.adapters.binance import BinanceFuturesMarkPriceUpdate
from vibe_trader.model import DataType
from vibe_trader.model import ClientId

# In your `on_start` method
self.subscribe_data(
    data_type=DataType(
        BinanceFuturesMarkPriceUpdate.__name__, metadata={"instrument_id": self.instrument.id}
    ),
    client_id=ClientId("BINANCE"),
)
```

收到的 `BinanceFuturesMarkPriceUpdate` 对象会传给 `on_data` 方法。由于该方法处理所有自定义/通用数据，
请检查类型。

```python
def on_data(self, data):
    # First check the type of data
    if isinstance(data, BinanceFuturesMarkPriceUpdate):
        # Do something with the data
```

### `BinanceFuturesLiquidation`

订阅以下任一种强平更新：

- 特定金融工具（`<symbol>@forceOrder`），或
- 省略 `instrument_id`，订阅所有符号（`!forceOrder@arr`）。

```python
from vibe_trader.adapters.binance import BinanceFuturesLiquidation
from vibe_trader.model import ClientId
from vibe_trader.model import DataType

client_id = ClientId.from_str("BINANCE")

# Instrument-specific
self.subscribe_data(
    data_type=DataType(
        BinanceFuturesLiquidation.__name__,
        metadata={"instrument_id": "BTCUSDT-PERP.BINANCE"},
    ),
    client_id=client_id,
)

# All-market (no instrument_id metadata)
self.subscribe_data(
    data_type=DataType(BinanceFuturesLiquidation.__name__),
    client_id=client_id,
)
```

对于特定金融工具订阅，`CustomData.data_type` 包含
`metadata={"instrument_id": "<instrument_id>"}`。全市场订阅的数据类型不含元数据。

同时订阅两种模式时，全市场订阅优先。全市场订阅处于活动状态时，适配器会暂停逐符号强平数据流；
取消全市场订阅后，会恢复活动的逐符号数据流。

## 资金费率

适配器通过 `subscribe_funding_rates` 将 `FundingRateUpdate` 作为一等数据类型发出。数据来自
[标记价格数据流](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Mark-Price-Stream)
WebSocket 端点，该端点在提供标记价格和指数价格的同时，也提供当前资金费率和下一次资金费率时间。
三个订阅（`subscribe_mark_prices`、`subscribe_index_prices`、`subscribe_funding_rates`）通过引用计数的
订阅管理共享同一个 `@markPrice@1s` 数据流。

可以通过 `request_funding_rates` 获取历史资金费率，它会查询
[获取资金费率历史](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History)
REST 端点（USD-M 为 `GET /fapi/v1/fundingRate`，COIN-M 为 `GET /dapi/v1/fundingRate`）。
每条历史记录映射为 `FundingRateUpdate`，其 `ts_event` 设为资金费率时间。历史记录的 `next_funding_ns`
字段为 `None`，因为该端点不提供此值。

适配器还通过 `BinanceFuturesMarkPriceUpdate` 自定义数据订阅公开交易场所载荷
（参阅 [Binance 特定数据](#binance-特定数据)）。

对于 Binance，`FundingRateUpdate` 的 `interval` 字段为 `None`，因为标记价格数据流和资金费率历史端点
均不包含资金费率周期字段。Binance 通过
[获取资金费率信息](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-Info)
REST 端点公开 `fundingIntervalHours`，但适配器不使用它。

## 金融工具状态轮询

:::info
此功能可用于数据客户端及其 Python 绑定。
:::

适配器会定期轮询 Binance `exchangeInfo`，以检测金融工具交易状态的变化。符号在不同状态之间转换时
（例如从 Trading 变为 Halt，或临近到期的期货合约从 Trading 变为 Delivering），适配器会发出
`InstrumentStatus` 事件。

轮询间隔默认为 3600 秒（60 分钟），可通过数据客户端配置中的 `instrument_status_poll_secs` 配置。
设为 `0` 可完全禁用轮询。

首次连接时，适配器会根据交易所信息响应填充状态缓存，但不会发出事件。只有后续轮询检测到状态变化时，
才会发出 `InstrumentStatus` 事件。如果符号从交易所信息中消失（例如下架或合约到期后），适配器会发出
`NotAvailableForTrading`。

状态轮询不会重新加载金融工具定义。独立的 `instrument_refresh_interval_secs` 任务会完整加载经过筛选的目录，
以原子方式替换数据客户端和 WebSocket 查找映射，将刷新的金融工具发送给数据引擎，并更新状态快照。
它还会刷新执行客户端的精度缓存。默认完整刷新间隔为 3600 秒；设为 `0` 可禁用。断开连接会取消任务，
重新连接则使用新的取消令牌启动一个替代任务。

### 状态映射

#### 现货

| Binance 状态     | MarketStatusAction     |
| ---------------- | ---------------------- |
| Trading          | Trading                |
| EndOfDay         | Close                  |
| Halt             | Halt                   |
| Break            | Pause                  |
| NonRepresentable | NotAvailableForTrading |

#### 期货（USD-M）

| Binance 状态      | MarketStatusAction |
| ----------------- | ------------------ |
| Trading           | Trading            |
| PendingTrading    | PreOpen            |
| PreTrading        | PreOpen            |
| PostTrading       | PostClose          |
| EndOfDay          | Close              |
| Halt              | Halt               |
| AuctionMatch      | Cross              |
| Break             | Pause              |
| PreDelivering     | PreClose           |
| Delivering        | Close              |
| Delivered         | Close              |
| PreSettle         | PreClose           |
| Settling          | Close              |
| Close             | Close              |
| TradingHalt       | Halt               |
| TradingCancelOnly | Halt               |

#### 期货（COIN-M）

| Binance 状态      | MarketStatusAction     |
| ----------------- | ---------------------- |
| Trading           | Trading                |
| PendingTrading    | PreOpen                |
| PreDelivering     | PreClose               |
| Delivering        | Close                  |
| Delivered         | Close                  |
| PreSettle         | PreClose               |
| Settling          | Close                  |
| Close             | Close                  |
| PreDelisting      | PreClose               |
| Delisting         | Suspend                |
| Down              | NotAvailableForTrading |
| TradingHalt       | Halt                   |
| TradingCancelOnly | Halt                   |

:::note
仅跟踪连接时处于可交易状态的金融工具。连接时处于非交易状态（例如连接时已暂停）的符号不会出现在
金融工具缓存中，因此不会监控其状态转换。
:::

## 速率限制

Binance 使用基于时间间隔的速率限制系统，在固定时间窗口内跟踪请求权重（每分钟一个窗口，在 :00 秒重置）。
每个 API 端点都有指定的权重成本，总权重使用量按 IP 地址跟踪。

### 全局权重限制

以下是所有端点共享的主要限制：

| 账户类型    | 权重限制 | 间隔   |
| ----------- | -------- | ------ |
| 现货/保证金 | 6,000    | 1 分钟 |
| 期货        | 2,400    | 1 分钟 |

### 端点权重成本

部分端点的单次请求权重成本较高：

| 端点                      | 权重 | 说明                       |
| ------------------------- | ---- | -------------------------- |
| `/api/v3/order`           | 1    | 现货下单。                 |
| `/api/v3/allOrders`       | 20   | 现货历史订单（成本较高）。 |
| `/api/v3/klines`          | 2+   | 随 `limit` 参数变化。      |
| `/fapi/v1/order`          | 1    | 期货下单。                 |
| `/fapi/v1/algoOrder`      | 0    | 使用订单计数限制。         |
| `/fapi/v1/allOrders`      | 20   | 期货历史订单（成本较高）。 |
| `/fapi/v1/commissionRate` | 20   | 期货佣金费率查询。         |
| `/fapi/v1/klines`         | 5+   | 随 `limit` 参数变化。      |

USD-M Futures `POST /fapi/v1/algoOrder` 会同时消耗 `X-MBX-ORDER-COUNT-10S` 和
`X-MBX-ORDER-COUNT-1M` 的 `1` 个额度。Binance 不对此端点收取 IP 请求权重；作为本地节流模型的一部分，
适配器仍会将其放入全局桶排队。

### WebSocket API 限制

WebSocket API（用于用户数据流）与 REST API 共享相同权重配额：

| 限制类型     | 值    | 说明                     |
| ------------ | ----- | ------------------------ |
| 请求权重     | 共享  | 计入 REST API 权重配额。 |
| 握手         | 5     | 每次连接尝试的权重成本。 |
| Ping/pong 帧 | 5/sec | 最大 ping/pong 速率。    |

### 适配器行为

适配器使用令牌桶限流器近似 Binance 基于间隔的限制。这样可以降低违反配额的风险，同时维持正常操作吞吐量。

对于动态权重端点（例如 `/klines` 会随 `limit` 参数变化），适配器每次调用提取一个令牌。
大型历史请求可能需要手动节流。请监控 `X-MBX-USED-WEIGHT-*` 响应头以跟踪实际用量。

:::warning
超过允许权重时 Binance 会返回 HTTP 429。反复违规会触发临时 IP 封禁（屡次违规时从 2 分钟逐步增加到 3 天）。
:::

:::info
要获取最新速率限制，请查询 `/api/v3/exchangeInfo`（Spot）或 `/fapi/v1/exchangeInfo`（Futures），或者参阅：

- [Spot API 限制](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/limits)
- [Futures API 限制](https://developers.binance.com/docs/derivatives/usds-margined-futures/general-info)

:::

## 配置

### 数据客户端

| 选项                               | 默认值    | 说明                                                             |
| ---------------------------------- | --------- | ---------------------------------------------------------------- |
| `product_type`                     | `Spot`    | `Spot`、`UsdM` 或 `CoinM` 之一。                                 |
| `environment`                      | `Live`    | `Live`、`Testnet` 或 `Demo` 之一。                               |
| `base_url_http`                    | `None`    | 可选 HTTP 端点覆盖值。                                           |
| `base_url_ws`                      | `None`    | 可选市场 WebSocket 端点覆盖值。                                  |
| `api_key` / `api_secret`           | `None`    | Spot SBE 必填；公共 JSON 和 Futures 数据可选。                   |
| `spot_market_data_mode`            | `Sbe`     | `Json` 保留无需凭证的 Global Spot 路径。Binance US 要求 `Json`。 |
| `instrument_provider`              | default   | 加载、筛选、解析器警告和佣金策略。                               |
| `instrument_refresh_interval_secs` | `3600`    | 完整目录刷新间隔；`0` 表示禁用。                                 |
| `instrument_status_poll_secs`      | `3600`    | 仅状态的交易所信息轮询间隔；`0` 表示禁用。                       |
| `proxy_url`                        | `None`    | 应用于 HTTP 和每个市场 WebSocket 连接的代理。                    |
| `recv_window_ms`                   | `5000`    | 已签名 HTTP 接收窗口，包含范围 `1..=60000`。                     |
| `us`                               | `False`   | 将实盘 Spot JSON 客户端路由到 Binance US。                       |
| `transport_backend`                | `Sockudo` | WebSocket 传输后端。                                             |

### 执行客户端

| 选项                               | 默认值    | 说明                                                                 |
| ---------------------------------- | --------- | -------------------------------------------------------------------- |
| `trader_id` / `account_id`         | Required  | Vibe 执行身份。                                                      |
| `product_type`                     | `Spot`    | `Spot`、`UsdM` 或 `CoinM` 之一。                                     |
| `environment`                      | `Live`    | `Live`、`Testnet` 或 `Demo` 之一。                                   |
| `base_url_http`                    | `None`    | 可选 HTTP 端点覆盖值。                                               |
| `base_url_ws`                      | `None`    | 可选私有数据流覆盖值。                                               |
| `base_url_ws_trading`              | `None`    | 可选 Global Spot 或 USD-M WebSocket 交易覆盖值。                     |
| `use_ws_trading`                   | `True`    | 在支持时使用 Global WebSocket 下单；Binance US 使用 HTTP。           |
| `ws_trading_setup_timeout_ms`      | `10,000`  | WebSocket 交易认证和设置超时。                                       |
| `instrument_provider`              | default   | 加载、筛选、解析器警告和佣金策略。                                   |
| `instrument_refresh_interval_secs` | `3600`    | 执行精度缓存刷新间隔；`0` 表示禁用。                                 |
| `proxy_url`                        | `None`    | 应用于 HTTP、私有数据流和 WebSocket 交易的代理。                     |
| `recv_window_ms`                   | `5000`    | 已签名 HTTP 和 WebSocket 接收窗口，包含范围 `1..=60000`。            |
| `us`                               | `False`   | 将实盘 Spot 执行客户端路由到 Binance US。                            |
| `api_key` / `api_secret`           | `None`    | Global 使用 Ed25519 WebSocket 认证；Binance US 使用 HMAC HTTP 签名。 |
| `use_gtd`                          | `True`    | 使用上文所述的原生 USD-M GTD 策略。                                  |
| `use_position_ids`                 | `True`    | 公开 Futures 对冲方向持仓 ID。                                       |
| `oms_type`                         | `None`    | `None` 选择 Futures 净额模式；双向模式使用 `Hedging`。               |
| `default_taker_fee`                | `0.0004`  | 交易所生成 Futures 成交的回退值。                                    |
| `futures_leverages`                | `None`    | 按 Futures 符号设置初始杠杆。                                        |
| `futures_margin_types`             | `None`    | 按 Futures 符号设置初始保证金类型。                                  |
| `treat_expired_as_canceled`        | `False`   | 将 `EXPIRED` 执行事件映射为已取消事件。                              |
| `use_trade_lite`                   | `False`   | 使用延迟更低的 USD‑M trade‑lite 成交数据流。                         |
| `bnfcr_currency`                   | `USDT`    | 用于解析 `BNFCR` 余额和费用的货币。                                  |
| `transport_backend`                | `Sockudo` | WebSocket 传输后端。                                                 |

### 实盘节点配置

将 `BinanceDataClientConfig` 与 `BinanceDataClientFactory` 搭配使用，将 `BinanceExecClientConfig` 与
`BinanceExecutionClientFactory` 搭配使用。当前 Python 示例展示了数据客户端和执行客户端的完整
`LiveNode.builder(...)` 配置。

### Futures Credits Trading Mode（BNFCR）

Binance Futures Credits Trading Mode 是一种欧盟监管模式，其中 USD-M 期货钱包、保证金、损益和费用均以
`BNFCR` 计价。它是一种与美元 1:1 挂钩的内部信用单位，用于替代稳定币余额。由于 `BNFCR`
不是可交易资产，适配器会将其映射到 `bnfcr_currency` 执行配置选项（默认为 `USDT`），使账户余额和
佣金能够按交易合约结算所用的稳定币进行对账。交易 USDC 保证金永续合约时，请将 `bnfcr_currency`
设置为 `USDC`。其他无法识别的期货资产会注册为通用加密货币，而不是导致失败。

### 现货市场数据模式

`spot_market_data_mode`（Rust `BinanceDataClientConfig`）选择 Spot 数据传输方式。它只影响 Spot；
Futures 不受影响。

| 模式   | 凭证            | 报价         |
| ------ | --------------- | ------------ |
| `Sbe`  | Ed25519（必填） | `bestBidAsk` |
| `Json` | 无（公开）      | `bookTicker` |

`Sbe`（默认）使用 Binance Simple Binary Encoding 数据流，并要求 Ed25519 密钥（参阅[密钥类型](#密钥类型)）；
缺少密钥时客户端会拒绝连接。`Json` 使用无需凭证的公开数据流。完整 Spot `BookDeltas` 订阅在 `Sbe`
模式下使用 25ms SBE 差分深度数据流，在 `Json` 模式下使用 100ms 公共 JSON 差分深度数据流，并通过
REST 快照同步。显式深度订阅使用部分订单簿快照（参阅[订单簿](#订单簿)）。

:::note
在 Python 中通过 `vibe_trader.adapters.binance` 上的 `BinanceSpotMarketDataMode` 公开。
:::

### 密钥类型

Binance 支持三种 API 密钥类型：**Ed25519**、**HMAC-SHA256** 和 **RSA**。适配器会根据 API Secret 格式
自动检测密钥类型，因此无需配置。

**强烈建议使用 Ed25519。** Binance 建议使用性能和安全性更高的 Ed25519。未来版本的 VibeTrader
将只允许 Ed25519。

| 密钥类型 | 数据客户端 | 执行客户端 | 状态                         |
| -------- | ---------- | ---------- | ---------------------------- |
| Ed25519  | ✓          | ✓          | **推荐**                     |
| HMAC     | ✓          | ✓          | 已弃用，将在未来版本中移除。 |
| RSA      | ✓          | -          | 已弃用，不支持执行。         |

:::tip
请立即改用 Ed25519 密钥。生成 Ed25519 密钥对并在 Binance 注册。请参阅下方[生成 Ed25519 密钥](#生成-ed25519-密钥)。
:::

:::note
Ed25519 密钥必须采用未加密的 PEM 格式（以 base64 编码的 ASN.1/DER）。实现会自动从 DER 结构提取
32 字节种子。不支持加密（密码保护）的 PEM 密钥。如果密钥已加密，请先解密：
`openssl pkey -in encrypted.pem -out decrypted.pem`
:::

#### 生成 Ed25519 密钥

**选项 1：OpenSSL（推荐）**

```bash
# Generate private key (PKCS#8 PEM format)
openssl genpkey -algorithm ed25519 -out binance_ed25519_private.pem

# Extract public key
openssl pkey -in binance_ed25519_private.pem -pubout -out binance_ed25519_public.pem
```

**选项 2：Binance Key Generator**

从发布页面下载 [Binance Asymmetric Key Generator](https://github.com/binance/asymmetric-key-generator)，
然后运行它以生成密钥对。

**在 Binance 注册**

1. 登录 Binance，前往 **Profile** -> **API Management**
2. 点击 **Create API**，选择 **Self-generated**
3. 粘贴公钥文件内容（包括 `-----BEGIN PUBLIC KEY-----` 头和尾）
4. 配置权限（Enable Spot & Margin Trading 等）

**与 VibeTrader 搭配使用**

将私钥设为 API Secret：

```bash
export BINANCE_API_KEY="your-api-key-from-binance"
export BINANCE_API_SECRET="$(cat binance_ed25519_private.pem)"
```

也可以直接在配置中传入 PEM 内容。

:::warning
请妥善保管私钥。切勿共享或提交到版本控制系统。
:::

### API 凭证

将凭证直接传给配置对象，或设置适当的环境变量（各环境变量请参阅[环境](#环境)）。

:::tip
所有客户端均应使用 Ed25519 密钥。HMAC 密钥仍可用于数据客户端和执行客户端，但 Ed25519 性能更好，
并将在未来版本中成为唯一受支持的密钥类型。请参阅[密钥类型](#密钥类型)。
:::

:::warning
Spot/Margin 的 `BINANCE_ED25519_*` 和 `BINANCE_*_ED25519_*` 环境变量已被移除。
Futures 中这些变量也已弃用，并将在未来版本中移除。请将其重命名为 `BINANCE_API_KEY` /
`BINANCE_API_SECRET`（现在会自动检测 Ed25519 密钥）。
:::

交易节点启动时，会收到凭证是否有效及是否具有交易权限的确认。

### 产品类型

配置通过 `product_type` 字段和 `BinanceProductType` 枚举选择一种受支持产品：

- `SPOT`
- `USD_M`（USDT、USDC 或 BNFCR 抵押品）
- `COIN_M`（加密货币抵押品）

:::note
保证金交易尚未实现。实盘客户端和独立金融工具加载器会拒绝其他枚举变体。
请参阅[产品支持](#产品支持)。
:::

### 基础 URL 覆盖

可以覆盖 HTTP REST 和 WebSocket API 的默认基础 URL。这适用于配置 API 集群，或使用 Binance 提供的专用端点。

### Binance US

在配置中设置 `us=True`，即可使用一等的 Binance US Spot 路由。Binance US 并非自定义 URL 别名：
此开关会选择 `api.binance.us`、公共 JSON 数据流、HMAC 签名的 HTTP 执行，以及使用端口 443 并定期
keepalive 的 listen-key 私有数据流。

此路由背后的交易场所契约请参阅 Binance US 官方
[REST API](https://github.com/binance-us/binance-us-api-docs/blob/master/rest-api.md)、
[市场数据流](https://github.com/binance-us/binance-us-api-docs/blob/master/web-socket-streams.md)和
[用户数据流](https://github.com/binance-us/binance-us-api-docs/blob/master/web-socket-api.md)文档。

受支持的组合是有意限定的：

- 数据：`product_type=Spot`、`environment=Live`、`spot_market_data_mode=Json`。
- 执行：`product_type=Spot`、`environment=Live`；下单使用 HTTP，私有事件使用 listen-key 数据流。
- 当 `us=True` 时，Futures、Testnet、Demo 和 Spot SBE 配置会验证失败。

Binance US 公共 JSON 涵盖实时市场数据、深度快照、近期和聚合成交历史以及 K 线历史。
它使用账户级挂单方和吃单方费率。Global Binance 在 `us=False` 且 `spot_market_data_mode=Json` 时，
继续保持现有的无需凭证 Spot JSON 行为。

### 环境

Binance 提供三个交易环境，每个环境都有独立的 API 凭证和端点。通过 `environment` 配置选项进行选择。

| 环境       | 配置                    | 说明                                        |
| ---------- | ----------------------- | ------------------------------------------- |
| **实盘**   | `environment="LIVE"`    | 使用真实资金进行生产交易（默认）。          |
| **演示**   | `environment="DEMO"`    | 使用模拟 Spot 和 Futures 资金进行演示交易。 |
| **测试网** | `environment="TESTNET"` | 旧版 Spot 和 Futures 测试网络。             |

#### 实盘（生产）

使用真实资金进行实盘交易的默认环境。使用 Binance 主账户凭证。

```python
config = BinanceExecClientConfig(
    trader_id=TraderId.from_str("TRADER-001"),
    account_id=AccountId.from_str("BINANCE-001"),
    api_key="YOUR_API_KEY",
    api_secret="YOUR_API_SECRET",
    product_type=BinanceProductType.SPOT,
    # environment=BinanceEnvironment.LIVE (default)
)
```

| 变量                 | 说明              |
| -------------------- | ----------------- |
| `BINANCE_API_KEY`    | 实盘 API 密钥。   |
| `BINANCE_API_SECRET` | 实盘 API Secret。 |

#### 演示交易

在生产基础设施上使用模拟资金练习交易。演示账户与实盘账户使用同一 Binance 登录名，但交易使用虚拟余额。

**获取演示凭证：**

1. 登录 [binance.com/en/demo-trading](https://www.binance.com/en/demo-trading)。
2. 前往 **API Management**，创建演示 API 密钥。
3. 演示密钥可用于 Spot 和 Futures 演示端点。

| 端点        | URL                        |
| ----------- | -------------------------- |
| Spot HTTP   | `demo-api.binance.com`     |
| Spot WS     | `demo-stream.binance.com`  |
| USD-M HTTP  | `demo-fapi.binance.com`    |
| USD-M WS    | `demo-fstream.binance.com` |
| COIN-M HTTP | `demo-dapi.binance.com`    |
| COIN-M WS   | `demo-dstream.binance.com` |

```python
config = BinanceExecClientConfig(
    trader_id=TraderId.from_str("TRADER-001"),
    account_id=AccountId.from_str("BINANCE-001"),
    api_key="YOUR_DEMO_API_KEY",
    api_secret="YOUR_DEMO_API_SECRET",
    product_type=BinanceProductType.SPOT,
    environment=BinanceEnvironment.DEMO,
)
```

| 变量                      | 说明              |
| ------------------------- | ----------------- |
| `BINANCE_DEMO_API_KEY`    | 演示 API 密钥。   |
| `BINANCE_DEMO_API_SECRET` | 演示 API Secret。 |

#### 测试网

旧版测试网络拥有独立的用户账户、余额和订单簿。新的模拟交易设置应优先使用
`environment=BinanceEnvironment.DEMO`。Spot 测试网仍位于 `testnet.binance.vision`；
期货测试网端点可能会通过 Demo Trading 基础设施路由。

**获取 Spot 测试网凭证：**

1. 前往 [testnet.binance.vision](https://testnet.binance.vision/)。
2. 使用 GitHub 登录。
3. 生成 API 密钥（HMAC、RSA 或 Ed25519）。

**期货测试网：** 使用 `BinanceEnvironment.TESTNET` 的现有配置仍然有效，但新的 Futures 测试应使用
`BinanceEnvironment.DEMO`。

```python
config = BinanceExecClientConfig(
    trader_id=TraderId.from_str("TRADER-001"),
    account_id=AccountId.from_str("BINANCE-001"),
    api_key="YOUR_TESTNET_API_KEY",
    api_secret="YOUR_TESTNET_API_SECRET",
    product_type=BinanceProductType.SPOT,
    environment=BinanceEnvironment.TESTNET,
)
```

| 变量                                 | 说明                        |
| ------------------------------------ | --------------------------- |
| `BINANCE_TESTNET_API_KEY`            | Spot 测试网 API 密钥。      |
| `BINANCE_TESTNET_API_SECRET`         | Spot 测试网 API Secret。    |
| `BINANCE_FUTURES_TESTNET_API_KEY`    | Futures 测试网 API 密钥。   |
| `BINANCE_FUTURES_TESTNET_API_SECRET` | Futures 测试网 API Secret。 |

:::note
测试网凭证与实盘账户完全独立。市场数据和流动性与生产环境不同。
:::

### 聚合成交

Binance 提供聚合成交数据端点作为另一种成交来源。与默认成交端点不同，聚合成交端点可以返回
`start_time` 与 `end_time` 之间的所有逐笔数据。

设置 `use_agg_trade_ticks=True` 可使用聚合成交（默认为 `False`）。

:::note
对于 Futures（USD-M 和 COIN-M），WebSocket 成交订阅始终使用 `@aggTrade`。Binance 只在 Futures
WebSocket 上发布聚合成交；旧版 `@trade` 数据流没有文档，现已停止发布。HTTP `request_trades`
路径继续遵循 `use_agg_trade_ticks`。
:::

### 佣金费率查询

金融工具提供器同时控制选择和费用策略：

```python
from vibe_trader.adapters.binance import BinanceInstrumentProviderConfig

instrument_provider = BinanceInstrumentProviderConfig(
    load_all=False,
    load_ids=["BTCUSDT.BINANCE", "ETHUSDT.BINANCE"],
    filters={"quotes": ["USDT"], "bases": ["BTC", "ETH"]},
    log_warnings=True,
    query_commission_rates=True,
)
```

`load_all=False` 只选择 `load_ids`；随后交易场所筛选器以交集方式应用。支持的筛选器为 `symbols`、
`bases` 和 `quotes`，Futures 还支持 `contract_types`。值可以是字符串或非空字符串列表，匹配不区分大小写。
适配器拒绝 `filter_callable`；请使用受支持的声明式筛选器。

每个已解析金融工具都会获得挂单方和吃单方费用：

- Spot 在有凭证时使用账户级费率，否则挂单方和吃单方均为 0.1%。
- Futures 在有凭证时使用账户 VIP 层级，否则使用 VIP 0。
- `query_commission_rates=True` 会让 Global Spot 和 Futures 选择执行受限流保护的精确逐符号查询。
  查询失败或无效时，该符号会回退到账户或层级费率。
- Binance US 使用账户级佣金费率，因为它不提供 Global `account/commission` 端点。

精确查询行为遵循 Global Spot
[佣金 FAQ](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/commission_faq.md)和 USD-M
[用户佣金费率](https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/User-Commission-Rate)
端点。

精确查询需要凭证。由于它们会为每个选定符号发送一条私有请求，在大型目录中使用此选项时，
请结合 `load_ids` 或筛选器。

### 解析器警告

部分 Binance 金融工具包含超出平台处理范围的字段值，无法解析为 Vibe 对象。这些金融工具会被跳过并发出警告。

要抑制这些警告：

```python
from vibe_trader.adapters.binance import BinanceInstrumentProviderConfig

instrument_provider = BinanceInstrumentProviderConfig(
    load_all=True,
    log_warnings=False,
)
```

### Futures Hedge 模式

Binance Futures Hedge 模式允许同时持有同一金融工具的多头和空头持仓。

要使用 Hedge 模式，请先在 Binance 配置，然后在 `BinanceExecClientConfig` 上设置
`oms_type=OmsType.HEDGING`，并保持 `use_position_ids=True` 以跟踪交易场所的两个持仓方向：

```python
from vibe_trader.adapters.binance import BinanceExecClientConfig
from vibe_trader.adapters.binance import BinanceProductType
from vibe_trader.model import AccountId
from vibe_trader.model import OmsType
from vibe_trader.model import TraderId

config = BinanceExecClientConfig(
    trader_id=TraderId.from_str("TRADER-001"),
    account_id=AccountId.from_str("BINANCE-001"),
    product_type=BinanceProductType.USD_M,
    oms_type=OmsType.HEDGING,
    use_position_ids=True,
)
```

### COIN-M / USD-M 架构

Binance COIN-M Futures（CM / DAPI）和 USD-M Futures（UM / FAPI）共享统一架构。
本节说明其对适配器的影响。

完整详情请参阅
[重要 CM-UM 集成公告](https://developers.binance.com/docs/derivatives/coin-margined-futures/Important-CM-UM-Integration-Notice)。

#### WebSocket 数据流

市场数据流载荷在 `<symbol>@aggTrade`、`<symbol>@ticker`、`<symbol>@bookTicker`、
`<symbol>@depth<levels>`、`<symbol>@miniTicker` 和所有 `!*@arr` 数据流上包含 `st`
（符号类型：`1` = UM，`2` = CM）。UM 侧单符号数据流还会在 `<symbol>@bookTicker`、
`<symbol>@depth<levels>`、`<symbol>@miniTicker` 和 `<symbol>@rpiDepth` 上包含 `ps`（交易对符号）。

适配器使用 `msgspec`（Python）和 `serde`（Rust）解码 JSON，二者默认都会忽略未知字段。这些字段会被静默丢弃。

全市场数组数据流（`!ticker@arr`、`!miniTicker@arr`、`!bookTicker`、`!forceOrder@arr`、
`!contractInfo`）会在 `fstream` 和 `dstream` 上同时交付合并的 UM + CM 内容。

#### REST 和 WebSocket API

- 下单和修改确认响应不包含 `avgPrice` / `cumQuote` / `cumBase`。适配器从用户数据流获取成交。
  查询端点（`GET /{f,d}api/v1/order`、`userTrades`）仍会返回这些字段。
- `PUT /dapi/v1/order`（COIN-M 修改）同时要求 `price` 和 `quantity`。适配器的 `_modify_order`
  会发送两个字段，并回退到缓存订单的值。
- COIN-M 条件订单（STOP、TAKE_PROFIT 等）使用 `/dapi/v1/algoOrder` 端点。适配器会通过算法订单 API
  路由所有期货条件订单。
- 使用无效符号调用 `GET /dapi/v1/openOrders` 会返回错误 `-1121`。

#### 速率限制池

UM 和 CM 共享 Binance 速率限制池：每个 IP 每分钟 2400 权重，此外每个账户每分钟 1200 个订单、
每 10 秒 300 个订单。同一进程中的 Rust 期货 HTTP 客户端，如果环境或自定义端点范围和已配置出口路径相同，
会在 UM 和 CM 之间共享请求权重状态。使用同一 API 密钥认证时，无论出口路径如何，它们都会在 UM 和 CM
之间共享订单计数状态。

实盘、测试网、演示和无关自定义端点范围彼此隔离。不同配置的出口路径使用独立请求权重状态，
不同 API 密钥使用独立订单计数状态。独立进程以及同一 Binance 账户的多个 API 密钥仍需外部协调。

#### dualSidePosition

UM 和 CM 共享同一个 `dualSidePosition` 设置。在任一侧更改都会影响两侧。切换设置前，请确保 UM 和 CM
均无未结订单或持仓。

## 贡献

:::info
要为 Binance 适配器贡献代码，请参阅
[贡献指南](https://github.com/qOeOp/trade/blob/main/CONTRIBUTING.md)。
:::
