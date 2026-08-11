# Deribit

Deribit 成立于 2016 年，是一家提供期权、期货、永续合约、现货和组合金融工具的加密货币衍生品交易所。按交易量计，它是最大的加密期权交易所之一，也是领先的加密衍生品交易平台。

此集成支持接入 Deribit 实盘市场数据和执行订单。

## 概述

此适配器使用 Rust 实现，并提供可选的 Python 绑定，用于基于 Python 的工作流。Deribit 在 HTTP 和 WebSocket 传输上均使用 JSON-RPC 2.0。订阅和实时数据优先使用 WebSocket。

Deribit 官方 API 参考可在 [docs.deribit.com](https://docs.deribit.com/) 查看。

Deribit 适配器包含多个组件，可根据使用场景组合使用或单独使用：

- `DeribitHttpClient`：底层 HTTP API 连接（基于 HTTP 的 JSON-RPC）。
- `DeribitWebSocketClient`：底层 WebSocket API 连接（基于 WebSocket 的 JSON-RPC）。
- `DeribitInstrumentProvider`：金融工具解析和加载功能。
- `DeribitDataClient`：市场数据源管理器。
- `DeribitExecutionClient`：账户管理和交易执行网关。
- `DeribitDataClientFactory`：Deribit 数据客户端工厂（供实盘节点 builder 使用）。
- `DeribitExecutionClientFactory`：Deribit 执行客户端工厂（供实盘节点 builder 使用）。

:::note
大多数用户会为实盘交易节点定义配置（如下所示），无需直接使用这些底层组件。
:::

### 产品支持

| 产品类型 | 数据源 | 交易 | 备注                                          |
| -------- | ------ | ---- | --------------------------------------------- |
| 永续期货 | ✓      | ✓    | 使用 `DeribitProductType.FUTURE` 加载。       |
| 定期期货 | ✓      | ✓    | 使用 `DeribitProductType.FUTURE` 加载。       |
| 期权     | ✓      | ✓    | 使用 `DeribitProductType.OPTION` 加载。       |
| 现货     | ✓      | ✓    | 使用 `DeribitProductType.SPOT` 加载。         |
| 期货组合 | ✓      | ✓    | 使用 `DeribitProductType.FUTURE_COMBO` 加载。 |
| 期权组合 | ✓      | ✓    | 使用 `DeribitProductType.OPTION_COMBO` 加载。 |

## 符号体系

Deribit 对不同金融工具类型使用特定的符号约定。引用时，所有金融工具 ID 都应包含 `.DERIBIT` 后缀（例如 BTC 永续合约使用 `BTC-PERPETUAL.DERIBIT`）。

### 数量单位

Vibe 数量映射到 Deribit 的 `amount` 字段，而非可选的 `contracts` 字段。Deribit 以 USD 为单位报告永续合约和反向期货的数量，以标的基础货币报告期权和线性期货的数量。Deribit 的 `contract_size` 字段用于在 `amount` 与合约数量之间转换；适配器不会再次将其作为 Vibe 乘数应用。

### 永续期货

格式：`{Currency}-PERPETUAL`

示例：

- `BTC-PERPETUAL` - Bitcoin 永续掉期。
- `ETH-PERPETUAL` - Ethereum 永续掉期。

在策略中订阅 BTC 永续合约：

```python
InstrumentId.from_str("BTC-PERPETUAL.DERIBIT")
```

### 定期期货

格式：`{Currency}-{DDMMMYY}`

示例：

- `BTC-25DEC26` - 2026 年 12 月 25 日到期的 Bitcoin 期货。
- `ETH-26MAR27` - 2027 年 3 月 26 日到期的 Ethereum 期货。

```python
InstrumentId.from_str("BTC-25DEC26.DERIBIT")
```

### 期权

格式：`{Currency}-{DDMMMYY}-{Strike}-{Type}`

示例：

- `BTC-25DEC26-100000-C` - 行权价 $100,000、2026 年 12 月 25 日到期的 Bitcoin 看涨期权。
- `BTC-25DEC26-80000-P` - 行权价 $80,000、2026 年 12 月 25 日到期的 Bitcoin 看跌期权。
- `ETH-26MAR27-4000-C` - 行权价 $4,000、2027 年 3 月 26 日到期的 Ethereum 看涨期权。

其中：

- `C` = 看涨期权。
- `P` = 看跌期权。

```python
InstrumentId.from_str("BTC-25DEC26-100000-C.DERIBIT")
```

### 现货

格式：`{BaseCurrency}_{QuoteCurrency}`

示例：

- `BTC_USDC` - Bitcoin 对 USDC。
- `ETH_USDC` - Ethereum 对 USDC。

```python
InstrumentId.from_str("BTC_USDC.DERIBIT")
```

### 期货组合

格式：`{Currency}-FS-{LegA}_{LegB}`

各腿为定期期货或永续合约（在组合名称中表示为 `PERP`，即使独立金融工具名称为 `BTC-PERPETUAL`）。组合随最早到期的腿到期。

示例：

- `BTC-FS-25DEC26_PERP` - 2026 年 12 月期货与永续合约之间的日历价差。
- `BTC-FS-26MAR27_25DEC26` - 两个定期期货之间的跨月价差。

```python
InstrumentId.from_str("BTC-FS-25DEC26_PERP.DERIBIT")
```

适配器将期货组合建模为 `CryptoFuturesSpread`，以各腿之间的美元价差计价，结算货币为加密货币，并根据上游 `instrument_type` 设置 `is_inverse`。

### 期权组合

格式：`{Currency}-{Strategy}-{DDMMMYY}-{Strikes}`

策略代码包括 CS（看涨价差）、PS（看跌价差）、STRG（宽跨式）、STRD（跨式）、BOX（箱式）和 RR（风险逆转）。行权价段使用 `_` 分隔多个行权价。

示例：

- `BTC-CS-25DEC26-70000_75000` - 2026 年 12 月 25 日到期的 70k / 75k 看涨价差。
- `BTC-STRG-26MAR27-72000_80000` - 2027 年 3 月 26 日到期的 72k / 80k 宽跨式。
- `BTC-STRD-26MAR27-77000` - 2027 年 3 月 26 日到期的 77k 跨式。
- `BTC-BOX-26MAR27-58000_60000` - 2027 年 3 月 26 日到期的 58k / 60k 箱式。

```python
InstrumentId.from_str("BTC-STRG-26MAR27-72000_80000.DERIBIT")
```

适配器将期权组合建模为 `CryptoOptionSpread`，按照 Deribit 的反向期权约定以基础货币计价；小数 `size_increment`（例如 `0.1`）会端到端保留。

## 交易中的到期日

Deribit 通过 `public/get_expirations` HTTP 端点公开当前交易中的到期日。期权链加载器可以使用高级 HTTP 客户端刷新活跃期权系列，无需扫描每个金融工具。

```rust tab="Rust"
use vibe_deribit::http::models::DeribitCurrency;

let expirations = client
    .request_option_expirations(DeribitCurrency::BTC)
    .await?;
```

```python tab="Python"
from vibe_trader.adapters.deribit import DeribitCurrency
from vibe_trader.adapters.deribit import DeribitHttpClient

client = DeribitHttpClient()
expirations = await client.request_option_expirations(DeribitCurrency.BTC)
```

高级方法仅返回期权到期日。对于底层 Rust 请求，请使用 `GetExpirationsParams` 调用 `client.inner().get_expirations(...)`。对于 `BTC` 等具体货币，Deribit 返回以货币为键的结果；对于 `currency=any`，则返回直接以类别为键的结果；适配器会处理这两种结构。

## 组合金融工具

当 `product_types` 包含期货组合或期权组合枚举变体时，金融工具提供商会加载组合。在 Python 中，使用 `DeribitProductType.FUTURE_COMBO` 或 `DeribitProductType.OPTION_COMBO`。Deribit 在 `/public/get_combos` 上公开每个活跃组合的腿构成，并在标准 `/public/get_instruments?kind=option_combo|future_combo` 响应中公开组合的交易元数据（tick 大小、合约大小、到期时间和最小交易数量）。

### 成交发布

Deribit 会将每笔组合成交发布两次：

- 在组合的成交频道（`trades.{combo_name}.{interval}`）上：发布父成交以及描述各腿成交的 `legs[]` 数组。
- 在每条腿的成交频道（`trades.{leg_instrument}.{interval}`）上：发布该腿的独立成交，并使用指向父成交的 `combo_id` 和 `combo_trade_id` 标记。

因此，订阅普通期权或期货的用户会在现有成交流中看到源自组合的成交，而订阅组合本身的用户会看到组合级成交。适配器不会将组合父消息扇出为额外的腿 tick；它会将上游父消息和各腿消息分别作为其对应 `InstrumentId` 的独立 `TradeTick` 转发。因此，同时订阅组合和标的腿的用户会看到一条组合 tick 及一条该组合成交的腿 tick，而不会在同一金融工具上看到重复 tick。

若要让 Deribit 数据客户端在订阅组合成交的同时打开真实的腿成交频道，请向 `subscribe_trades` 传入 `params={"subscribe_combo_legs": True}`。取消订阅该组合成交流时，Vibe 也会关闭通过此选项打开的腿订阅。

Deribit 已经按腿发布大宗成交和 Block RFQ，因此适配器通过标准 1:1 成交路径转发。有关如何在生成的 `TradeTick` 上标记源自大宗和 RFQ 的成交，请参阅[成交 ID 来源](#成交-id-来源)。

### 历史组合成交

标准的逐金融工具成交端点接受组合金融工具名称。若要一次调用遍历给定产品类别的所有组合，请通过 `DeribitHttpClient::inner()` 使用 `get_last_trades_by_currency`：

```rust
use vibe_deribit::http::{
    models::{DeribitCurrency, DeribitProductType},
    query::GetLastTradesByCurrencyParams,
};

let params = GetLastTradesByCurrencyParams::builder()
    .currency(DeribitCurrency::BTC)
    .kind(DeribitProductType::FutureCombo)
    .count(50_u32)
    .include_old(true)
    .build()?;
let resp = client.inner().get_last_trades_by_currency(params).await?;
```

每个返回的 `DeribitPublicTrade` 都包含 `legs: Option<Vec<DeribitTradeLeg>>`，以及用于关联逐腿成交的 `combo_id` 和 `combo_trade_id` 字段。

## 成交 ID 来源

当成交源自 Block RFQ、大宗成交或组合时，适配器发出的公开 `TradeTick` 会在交易场所成交 ID 前添加前缀。需要将其与普通成交区分开的策略，可以匹配 `TradeTick.trade_id` 的前缀。原始 Deribit `trade_id` 保留在前缀之后，因此与 Deribit 自有 ID 对账时只需去除前缀。

| 前缀     | 来源字段         | 含义                               |
| -------- | ---------------- | ---------------------------------- |
| `RFQ-`   | `block_rfq_id`   | 成交源自 Block RFQ。               |
| `BLK-`   | `block_trade_id` | 成交是非 RFQ 大宗成交。            |
| `COMBO-` | `combo_id`       | 父成交源自组合金融工具的逐腿成交。 |
| *无前缀* | （以上均无）     | 标准成交。                         |

同时存在多个标记时，优先级为：`RFQ-` > `BLK-` > `COMBO-`。Block RFQ 在 Deribit 上本身也是大宗成交，因此 RFQ 标记优先；以大宗成交方式执行的组合标记为 `BLK-`，因为大宗流程是更重要的对账信号。

这只适用于公开成交（`TradeTick`）。`FillReport.trade_id` 保持不变，因此针对 `get_user_trades_*` 的对账仍可正常工作。

:::note
这是单向约定。此版本之前采集的回放数据没有前缀。跨版本存储和比较 `trade_id` 字符串的策略，应在新数据一侧去除前缀，或只对已知在升级后采集的数据按前缀筛选。
:::

## 订单簿订阅

Deribit 提供两类订单簿数据源，分别适用于不同场景。

### 原始数据源（逐 tick）

原始频道会将每次更新作为单独消息传送。订阅原始订单簿后，订单簿中的每次订单插入、更新或删除都会产生通知。

- 需要经过身份验证的连接（用于防止滥用）。
- 适用于高频交易或做市中需要每次价格档位变动的场景。
- 消息量较高。

### 聚合数据源（批处理）

聚合频道按固定间隔（例如每 100ms）批量传送更新，将多次订单簿变动合并为一条消息。

- 无需身份验证即可使用。
- 推荐用于大多数场景。
- 消息量较低，更易处理。
- 默认未认证间隔：100ms。

### 订阅参数

Vibe 适配器通过订阅参数支持两类数据源：

| 参数       | 值                     | 备注                                               |
| ---------- | ---------------------- | -------------------------------------------------- |
| `interval` | `raw`, `100ms`, `agg2` | `agg2` 约以 1 秒为间隔批处理。`raw` 需要身份验证。 |
| `group`    | `none`, 价格分组       | 默认：`none`。仅适用于分组的非原始订单簿频道。     |
| `depth`    | `1`, `10`, `20`        | 默认：`10`。分组订单簿频道每侧的价格档位数量。     |

数据客户端按以下规则选择订单簿间隔：

1. 如已提供，则使用 `params["interval"]`。
2. 当 WebSocket 连接已认证且未提供间隔时，使用 `raw`。
3. 当连接未认证时，使用 Deribit 的公开 `100ms` 分组数据源。

```python
from vibe_trader.model import BookType
from vibe_trader.model import InstrumentId

instrument_id = InstrumentId.from_str("BTC-PERPETUAL.DERIBIT")

# Public 100ms aggregated feed when no API credentials are configured.
strategy.subscribe_book_deltas(instrument_id, BookType.L2_MBP)

# Raw feed. This is also the authenticated default when no interval is supplied.
strategy.subscribe_book_deltas(
    instrument_id,
    BookType.L2_MBP,
    params={"interval": "raw"},
)

# Force an aggregated feed on an authenticated connection.
strategy.subscribe_book_deltas(
    instrument_id,
    BookType.L2_MBP,
    params={"interval": "100ms", "depth": 10},
)
```

:::note
原始订单簿数据源需要经过身份验证的 WebSocket 连接。订阅原始数据源前，请确保已配置 API 凭据。
:::

:::tip
对大多数策略而言，100ms 聚合数据源能以较低消息开销提供足够的粒度。如果提供了凭据但不需要逐 tick 原始订单簿更新，请设置 `params={"interval": "100ms"}`。
:::

### 序列缺口恢复

适配器会跟踪每次订单簿更新的 `change_id` / `prev_change_id` 序列号。检测到缺口（消息丢失）时，适配器会自动：

1. 丢弃受影响金融工具的所有传入增量。
2. 取消订阅订单簿频道。
3. 重新订阅以获取新快照。
4. 快照到达后恢复正常处理。

重新同步期间，策略不会收到陈旧或不完整的订单簿更新。

## 订单能力

以下是 Deribit 支持的订单类型、执行指令和有效期选项。

### 订单类型

| Vibe 订单类型          | Deribit 订单类型 | 支持 | 备注                       |
| ---------------------- | ---------------- | ---- | -------------------------- |
| `MARKET`               | `market`         | ✓    | 以市价立即执行。           |
| `LIMIT`                | `limit`          | ✓    | 以指定价格或更优价格执行。 |
| `STOP_MARKET`          | `stop_market`    | ✓    | 触发时执行的条件市价单。   |
| `STOP_LIMIT`           | `stop_limit`     | ✓    | 触发时执行的条件限价单。   |
| `MARKET_IF_TOUCHED`    | `take_market`    | ✓    | 止盈风格的市价单。         |
| `LIMIT_IF_TOUCHED`     | `take_limit`     | ✓    | 止盈风格的限价单。         |
| `TRAILING_STOP_MARKET` | `trailing_stop`  | -    | *当前尚未实现*。           |
| `TRAILING_STOP_LIMIT`  | 不适用           | -    | *Deribit 不支持*。         |
| `MARKET_TO_LIMIT`      | `market_limit`   | -    | *当前尚未实现*。           |

### 执行指令

| 指令          | 支持 | 备注                                                       |
| ------------- | ---- | ---------------------------------------------------------- |
| `post_only`   | ✓    | 如果订单会获取流动性则拒绝。使用 `reject_post_only=true`。 |
| `reduce_only` | ✓    | 订单只能减少已有持仓。                                     |

### 有效期

| 有效期 | 支持 | 备注                                        |
| ------ | ---- | ------------------------------------------- |
| `GTC`  | ✓    | 撤销前有效（`good_til_cancelled`）。        |
| `GTD`  | ✓    | 当日有效。UTC 8:00 到期（`good_til_day`）。 |
| `IOC`  | ✓    | 立即成交或取消（`immediate_or_cancel`）。   |
| `FOK`  | ✓    | 全部成交或取消（`fill_or_kill`）。          |

Deribit 将有效期应用于限价风格订单。对于 `MARKET`、`STOP_MARKET` 和 `MARKET_IF_TOUCHED` 订单，适配器会省略 `time_in_force`，因为 Deribit 会拒绝市价风格订单类型上的该参数。

:::note
**Deribit 上的 GTD**：与接受任意到期时间的其他交易所不同，Deribit 的 `good_til_day` 始终在当天或次日 UTC 8:00 到期。自定义到期时间会记录为警告，订单将采用交易所固定的到期行为。
:::

### 触发类型

条件订单（止损订单）支持不同的触发价格来源：

| 触发类型      | 支持 | 备注                     |
| ------------- | ---- | ------------------------ |
| `last_price`  | ✓    | 使用最新成交价（默认）。 |
| `mark_price`  | ✓    | 使用标记价格。           |
| `index_price` | ✓    | 使用标的指数价格。       |

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

### 批量操作

| 操作                 | 支持 | 备注                                                                |
| -------------------- | ---- | ------------------------------------------------------------------- |
| 提交订单列表         | ✓    | 将每个订单作为单独的 Deribit 订单发送。交易场所不提供原子批量操作。 |
| 按订单 ID 批量取消   | ✓    | 对每个交易场所订单 ID 发送单独的 `private/cancel` 请求。            |
| 按金融工具全部取消   | ✓    | 未提供方向筛选器时使用 `private/cancel_all_by_instrument`。         |
| 按方向筛选的全部取消 | ✓    | 在本地筛选缓存中的未结订单，然后取消每个匹配订单。                  |
| 批量修改             | -    | *当前尚未实现*：支持单笔订单修改。                                  |

### 仅做挂单行为

Deribit 提供两种仅做挂单模式：

1. **价格调整（Deribit 默认）**：如果仅做挂单订单会穿过价差并执行，Deribit 会自动把价格调整到价差内一档。
2. **拒绝模式**：如果订单会穿过价差，则立即拒绝。

Vibe 适配器使用**拒绝模式**（`reject_post_only=true`）以提供确定性行为。如果仅做挂单订单会获取流动性，订单会以错误代码 `11054` 被拒绝，并发出 `due_post_only` 标志设为 `true` 的 `OrderRejected` 事件。

这使策略可以区分：

- 因违反仅做挂单约束而被拒绝的订单（试图获取流动性）。
- 因其他原因被拒绝的订单（保证金不足、价格无效等）。

### 订单修改

适配器使用 Deribit 原生 `private/edit` 端点，而非取消替换。这有以下优势：

| 优势           | 说明                                 |
| -------------- | ------------------------------------ |
| 单次请求       | 比取消再新建订单执行更快、延迟更低。 |
| 保留队列优先级 | 仅减少数量或保持相同价格时保留位置。 |
| 保留成交历史   | 部分成交仍与同一订单 ID 关联。       |

**队列优先级规则：**

- **仅减少数量**：保留队列位置。
- **价格相同**：保留队列位置。
- **增加数量或更改价格**：失去队列位置（视为新订单）。

### 持仓管理

| 功能       | 支持 | 备注                                         |
| ---------- | ---- | -------------------------------------------- |
| 查询持仓   | ✓    | 实时持仓更新。                               |
| 持仓模式   | -    | *Deribit 不支持*：仅支持净持仓模式。         |
| 杠杆控制   | -    | *Deribit 不支持*：不能直接设置杠杆。         |
| 保证金模式 | -    | *当前尚未实现*：Deribit 提供账户保证金模式。 |

### 订单查询

| 功能         | 支持 | 备注               |
| ------------ | ---- | ------------------ |
| 查询未结订单 | ✓    | 列出所有活跃订单。 |
| 查询订单历史 | ✓    | 历史订单数据。     |
| 订单状态更新 | ✓    | 实时订单状态变化。 |
| 成交历史     | ✓    | 执行和成交报告。   |

### 或有订单

| 功能         | 支持 | 备注                                      |
| ------------ | ---- | ----------------------------------------- |
| 订单列表     | ✓*   | 顺序提交。适配器不提供原子列表。          |
| 原生关联订单 | -    | *当前尚未实现*：Deribit 支持关联订单。    |
| OCO 订单     | -    | *当前尚未实现*：Deribit 支持 OCO 关联。   |
| 括号订单     | -    | *当前尚未实现*：Deribit 支持 OTOCO 关联。 |
| 条件止损订单 | ✓    | 止损市价单和止损限价单。                  |
| 条件止盈订单 | ✓    | 触价市价单和触价限价单。                  |

### 强平处理

Deribit 会标记由强平触发的所有成交。在 `user.trades` 流和 `private/get_user_trades_*` 端点中，可选的 `liquidation` 字段表示被强平的一方：

| 值     | 含义             |
| ------ | ---------------- |
| `"M"`  | 挂单方被强平。   |
| `"T"`  | 吃单方被强平。   |
| `"MT"` | 双方均被强平。   |
| 缺失   | 普通非强平成交。 |

适配器会针对每笔带强平标记的成交记录警告，其中包含金融工具、成交 ID、订单 ID 和强平方向，随后通过正常管线发出 `FillReport`。Deribit 没有独立于强平、保险基金/投资组合保证金流程的 ADL 机制，因此没有单独的 ADL 信号可供公开。

上游参考：

- [`user.trades.{instrument_name}.{interval}` 频道](https://docs.deribit.com/#user-trades-instrument_name-interval)
- [强平文档](https://support.deribit.com/hc/en-us/articles/25944769313309-Liquidations)

## 资金费率

Deribit 持续交换资金费（每隔几秒），而不是像大多数其他交易所那样按固定间隔交换。由于这种连续模型无法映射到离散周期，Deribit 的 `FundingRateUpdate` 上的 `interval` 字段为 `None`。

## Deribit 专用数据

### 订单簿摘要

请求 `DeribitBookSummary` 自定义数据，可获取按货币和产品类别筛选的一份批量快照。每个响应项都包含 Vibe 金融工具 ID、隐含波动率、未平仓量、价格、成交量，以及 `public/get_book_summary_by_currency` 返回的其他字段。

actor 或策略通过一次 `on_historical_data` 回调接收完整响应。每一项都是 `CustomData` 包装器，其 `data` 字段中包含 `DeribitBookSummary`：

```python
from vibe_trader.adapters.deribit import DERIBIT_CLIENT_ID
from vibe_trader.adapters.deribit import DeribitBookSummary
from vibe_trader.model import CustomData
from vibe_trader.model import DataType


def on_start(self) -> None:
    self.request_data(
        DataType(
            DeribitBookSummary.__name__,
            metadata={"currency": "BTC", "kind": "option"},
        ),
        DERIBIT_CLIENT_ID,
    )


def on_historical_data(self, data: list[CustomData]) -> None:
    for item in data:
        summary = item.data
        if isinstance(summary, DeribitBookSummary):
            self.log.info(
                f"{summary.instrument_id}: mark_iv={summary.mark_iv}, "
                f"open_interest={summary.open_interest}",
            )
```

`currency` 元数据字段为必填项。可选的 `kind` 字段默认为 `option`。以十进制为基础的交易场所字段（例如 `mark_iv` 和 `open_interest`）会作为字符串或 `None` 暴露给 Python。空响应会以空列表调用一次 `on_historical_data`。交易场所请求失败也会在记录错误后以空列表调用回调。在到达交易场所之前便被拒绝的请求（例如缺少 `currency`）不会产生回调。

### 波动率指数

适配器从 Deribit 的 `deribit_volatility_index.{index_name}` WebSocket 频道发出 `DeribitVolatilityIndex` 自定义数据。Deribit 提供 `btc_usd` 和 `eth_usd` 等波动率指数流。

| 字段         | 类型    | 说明                                     |
| ------------ | ------- | ---------------------------------------- |
| `index_name` | `str`   | Deribit 波动率指数名称，例如 `btc_usd`。 |
| `volatility` | `float` | 当前波动率指数值。                       |
| `ts_event`   | `int`   | 更新发生时的 UNIX 纳秒时间戳。           |
| `ts_init`    | `int`   | 对象构建时的 UNIX 纳秒时间戳。           |

从 actor 或策略使用 `DataType(DeribitVolatilityIndex.__name__)` 订阅。`index_name` 元数据键为必填项：

```python
from vibe_trader.adapters.deribit import DeribitVolatilityIndex
from vibe_trader.model import ClientId
from vibe_trader.model import DataType

self.subscribe_data(
    data_type=DataType(DeribitVolatilityIndex.__name__, metadata={"index_name": "btc_usd"}),
    client_id=ClientId.from_str("DERIBIT"),
)
```

## 速率限制

Deribit 使用基于信用额度且因端点而异的速率限制。Deribit 官方限制是权威依据，并可能因端点、账户等级和交易场所当前政策而异。适配器增加了本地令牌桶以减少可避免的限流，但不能替代 Deribit 自身的服务器端检查。

### HTTP 限制

| 桶/键             | 适配器桶             | 备注                           |
| ----------------- | -------------------- | ------------------------------ |
| `deribit:global`  | 20 请求/秒，突发 100 | 非撮合 HTTP 请求的默认桶。     |
| `deribit:orders`  | 5 请求/秒，突发 20   | 底层客户端的撮合引擎 HTTP 桶。 |
| `deribit:account` | 5 请求/秒，无突发    | 账户信息端点。                 |

### WebSocket 限制

| 操作          | 适配器桶           | 备注                                    |
| ------------- | ------------------ | --------------------------------------- |
| 订阅/取消订阅 | 3 请求/秒，突发 10 | 订阅操作。                              |
| 订单操作      | 5 请求/秒，突发 20 | 通过 WebSocket 买入、卖出、编辑和取消。 |

:::note
为了降低延迟，Vibe 适配器使用 WebSocket（而非 HTTP）提交订单。订单操作由 `DERIBIT_WS_ORDER_QUOTA`（5 请求/秒，突发 20）进行速率限制。
:::

### 基于信用额度的系统详情

Deribit 会持续补充非撮合引擎信用额度。当前公开文档列出的默认非撮合引擎池如下：

**非撮合引擎请求：**

| 参数         | 值                 | 备注                        |
| ------------ | ------------------ | --------------------------- |
| 每次请求成本 | 500 个信用额度     | 每次 API 调用消耗信用额度。 |
| 最大池       | 50,000 个信用额度  | 允许 100 次请求突发。       |
| 补充速率     | 10,000 信用额度/秒 | 约 20 次持续请求/秒。       |

**撮合引擎请求（默认等级）：**

| 参数     | 值        | 备注                 |
| -------- | --------- | -------------------- |
| 持续速率 | 5 请求/秒 | 持续速率限制。       |
| 突发容量 | 20 次请求 | 限流前的最大突发量。 |

根据 7 天交易量等级，做市商和大额交易者可以获得更高的撮合引擎限制。

某些 Deribit 端点具有更严格的方法专用限制。例如，当前交易场所文档将 `public/get_instruments` 列为每秒 1 次请求、突发 50 次，将订阅方法列为约每秒 3.3 次请求、突发 10 次。将 `product_types` 限定到所需产品系列，并避免在实盘系统中反复完整加载金融工具。

Vibe 适配器实现了以下配置的通用令牌桶速率限制器：

- `DERIBIT_HTTP_REST_QUOTA`：20 请求/秒，突发 100（非撮合 HTTP）
- `DERIBIT_HTTP_ORDER_QUOTA`：5 请求/秒，突发 20（撮合引擎 HTTP）
- `DERIBIT_HTTP_ACCOUNT_QUOTA`：5 请求/秒，无突发（账户 HTTP）
- `DERIBIT_WS_ORDER_QUOTA`：5 请求/秒，突发 20（撮合引擎 WebSocket）
- `DERIBIT_WS_SUBSCRIPTION_QUOTA`：3 请求/秒，突发 10（订阅和取消订阅）

更多详情请参阅[速率限制文章](https://support.deribit.com/hc/en-us/articles/25944617523357-Rate-Limits)。

:::warning
超过允许额度时，Deribit 会返回错误代码 `10028`（too_many_requests）。反复违反限制可能导致临时限流。
:::

## 连接管理

### 平台限制

| 限制                            | Deribit 当前指引 |
| ------------------------------- | ---------------- |
| 每个 API 密钥或登录的活跃会话数 | 16               |
| 每个浏览器会话的 Web 应用连接数 | 2                |

### 基于会话的身份验证

适配器为数据客户端和执行客户端使用**独立的 WebSocket 会话**，每个会话都有自己的身份验证作用域：

| 客户端     | 会话名称         | 用途                                     |
| ---------- | ---------------- | ---------------------------------------- |
| 数据客户端 | `vibe-data`      | 市场数据订阅（原始数据源需要身份验证）。 |
| 执行客户端 | `vibe-execution` | 订单操作（买入、卖出、编辑、取消）。     |

**身份验证流程：**

1. WebSocket 连接到 Deribit。
2. 客户端使用带会话作用域的 `client_signature` 授权类型进行身份验证。
3. 令牌在到期前刷新。
4. 重新连接时，以指数退避重试重新验证（最多 3 次）。如果所有尝试均失败，则仅恢复公开频道订阅。

这种基于会话的方法支持：

- 每种客户端类型独立管理令牌。
- 隔离故障域（数据身份验证失败不影响执行）。
- 在 Deribit 会话日志中提供清晰审计记录。

### 最佳实践

适配器遵循 Deribit [推荐的连接实践](https://support.deribit.com/hc/en-us/articles/25944603459613)：

1. 对实时数据**使用 WebSocket 订阅**，而不是 REST 轮询，从而减少请求、降低延迟并减少速率限制消耗。
2. 提供凭据时**对所有连接进行身份验证**。已认证用户享有更高的速率限制，也更不易受 IP 速率限制。
3. **实现心跳**（默认间隔 30 秒），以维护连接健康并及早检测断连。
4. 通过重新身份验证和恢复订阅自动**处理重新连接**。

:::tip
即使只访问公开数据，也始终提供 API 凭据。已认证连接具有更高的速率限制，而且 Deribit 在高负载期间应用限制前会联系已认证客户端。
:::

:::note
适配器默认使用 30 秒心跳间隔。Deribit 要求 WebSocket 心跳间隔至少为 10 秒。
:::

## 身份验证

Deribit 对私有端点使用带 HMAC-SHA256 签名的 API 密钥身份验证。

创建 API 凭据：

1. 登录 [deribit.com](https://www.deribit.com) 上的 Deribit 账户（测试网则登录 [test.deribit.com](https://test.deribit.com)）。
2. 前往 **Account** -> **API**。
3. 单击 **Add new key** 并配置权限：
   - 为市场数据访问启用 **read**
   - 为订单执行启用 **trade**
   - 如需访问账户余额，启用 **wallet**
4. 记录 **Client ID**（API 密钥）和 **Client Secret**（API secret）。

:::warning
请妥善保护 API secret。切勿共享或提交到版本控制。
:::

### API 密钥作用域

Deribit 上的每个 API 密钥都有默认访问作用域，用于定义最大权限。请在[创建 API 密钥](https://support.deribit.com/hc/en-us/articles/26268257333661)时配置适当权限：

| 作用域             | 所需用途                 |
| ------------------ | ------------------------ |
| `account:read`     | 账户信息、投资组合数据。 |
| `trade:read`       | 查看订单和持仓。         |
| `trade:read_write` | 下单、修改和取消订单。   |
| `wallet:read`      | 查看余额和交易历史。     |

**建议的最低交易权限：** `account:read`、`trade:read_write`、`wallet:read`

:::tip
遵循最小权限原则。对于仅访问数据（市场数据、不交易）的情况，请创建不含 `trade:read_write` 的只读密钥。
:::

## 测试网

Deribit 提供测试网环境，可在不使用真实资金的情况下测试策略。要使用测试网，请在客户端配置中设置 `environment=DeribitEnvironment.TESTNET`：

```python
from vibe_trader.adapters.deribit import DeribitDataClientConfig
from vibe_trader.adapters.deribit import DeribitEnvironment
from vibe_trader.adapters.deribit import DeribitExecClientConfig
from vibe_trader.adapters.deribit import DeribitProductType
from vibe_trader.model import AccountId
from vibe_trader.model import TraderId

product_types = [DeribitProductType.FUTURE]
trader_id = TraderId.from_str("TRADER-001")
account_id = AccountId.from_str("DERIBIT-001")

data_config = DeribitDataClientConfig(
    product_types=product_types,
    environment=DeribitEnvironment.TESTNET,
)

exec_config = DeribitExecClientConfig(
    trader_id=trader_id,
    account_id=account_id,
    product_types=product_types,
    environment=DeribitEnvironment.TESTNET,
)
```

启用测试网模式后：

- HTTP 请求使用 `https://test.deribit.com`。
- WebSocket 连接使用 `wss://test.deribit.com/ws/api/v2`。
- 从 `DERIBIT_TESTNET_API_KEY` 和 `DERIBIT_TESTNET_API_SECRET` 环境变量加载凭据。

:::note
测试网 API 密钥与生产密钥相互独立。请通过 [test.deribit.com](https://test.deribit.com) 的测试网界面专门为测试网创建 API 密钥。
:::

## 配置

### 数据客户端配置选项

| 选项                               | 默认值     | 说明                                       |
| ---------------------------------- | ---------- | ------------------------------------------ |
| `api_key`                          | `None`     | Deribit API 密钥。省略时从环境变量加载。   |
| `api_secret`                       | `None`     | Deribit API secret。省略时从环境变量加载。 |
| `product_types`                    | `[FUTURE]` | 要加载的产品类型。                         |
| `environment`                      | `MAINNET`  | 环境枚举（`MAINNET` 或 `TESTNET`）。       |
| `base_url_http`                    | `None`     | 覆盖 HTTP JSON-RPC 基础 URL。              |
| `base_url_ws`                      | `None`     | 覆盖 WebSocket 基础 URL。                  |
| `proxy_url`                        | `None`     | HTTP 和 WebSocket 传输的可选代理 URL。     |
| `http_timeout_secs`                | `60`       | HTTP 调用的请求超时秒数。                  |
| `max_retries`                      | `3`        | 可恢复错误的最大重试次数。                 |
| `retry_delay_initial_ms`           | `1,000`    | 重试前的初始延迟毫秒数。                   |
| `retry_delay_max_ms`               | `10,000`   | 重试之间的最大延迟毫秒数。                 |
| `heartbeat_interval_secs`          | `30`       | WebSocket 心跳间隔。                       |
| `update_instruments_interval_mins` | `60`       | 金融工具刷新间隔分钟数。                   |
| `auto_load_missing_instruments`    | `False`    | 订阅时延迟加载未缓存的金融工具。           |

#### 订阅时延迟加载

`subscribe_*` 命令会在发送 WebSocket 订阅前查询本地缓存中的金融工具，以便处理程序解析传入帧。当 `auto_load_missing_instruments = False`（默认值）时，订阅未预加载的金融工具（因配置的 `product_types` 而未加载）会预先返回错误，而不是静默成功后让处理程序丢弃后续帧。

若设置 `auto_load_missing_instruments = True`，则首次订阅时会通过 HTTP 获取金融工具、填充 WebSocket 处理程序缓存，然后转发订阅。HTTP 失败会记录到日志，并跳过 WebSocket 订阅。

### 执行客户端配置选项

| 选项                     | 默认值     | 说明                                       |
| ------------------------ | ---------- | ------------------------------------------ |
| `trader_id`              | 必填       | 用于生成报告和事件的 Vibe trader ID。      |
| `account_id`             | 必填       | 用于生成报告和事件的 Vibe account ID。     |
| `api_key`                | `None`     | Deribit API 密钥。省略时从环境变量加载。   |
| `api_secret`             | `None`     | Deribit API secret。省略时从环境变量加载。 |
| `product_types`          | `[FUTURE]` | 要加载的产品类型。                         |
| `environment`            | `MAINNET`  | 环境枚举（`MAINNET` 或 `TESTNET`）。       |
| `base_url_http`          | `None`     | 覆盖 HTTP JSON-RPC 基础 URL。              |
| `base_url_ws`            | `None`     | 覆盖 WebSocket 基础 URL。                  |
| `proxy_url`              | `None`     | HTTP 和 WebSocket 传输的可选代理 URL。     |
| `http_timeout_secs`      | `60`       | HTTP 调用的请求超时秒数。                  |
| `max_retries`            | `3`        | 可恢复错误的最大重试次数。                 |
| `retry_delay_initial_ms` | `1,000`    | 重试前的初始延迟毫秒数。                   |
| `retry_delay_max_ms`     | `10,000`   | 重试之间的最大延迟毫秒数。                 |

Rust 配置还公开 `transport_backend`。启用 `transport-sockudo` Cargo feature 时默认为 `Sockudo`，否则为 `Tungstenite`。Python 绑定使用编译时默认值。

### 生产配置

以下是使用 Deribit 数据和执行客户端的实盘节点示例：

```python
from vibe_trader.adapters.deribit import DeribitDataClientConfig
from vibe_trader.adapters.deribit import DeribitDataClientFactory
from vibe_trader.adapters.deribit import DeribitEnvironment
from vibe_trader.adapters.deribit import DeribitExecClientConfig
from vibe_trader.adapters.deribit import DeribitExecutionClientFactory
from vibe_trader.adapters.deribit import DeribitProductType
from vibe_trader.common import Environment
from vibe_trader.live import LiveNode
from vibe_trader.model import AccountId
from vibe_trader.model import TraderId

product_types = [DeribitProductType.FUTURE]
trader_id = TraderId.from_str("TRADER-001")
account_id = AccountId.from_str("DERIBIT-001")

node = (
    LiveNode.builder("DERIBIT-001", trader_id, Environment.LIVE)
    .add_data_client(
        None,
        DeribitDataClientFactory(),
        DeribitDataClientConfig(
            product_types=product_types,
            environment=DeribitEnvironment.MAINNET,
            api_key=None,
            api_secret=None,
        ),
    )
    .add_exec_client(
        None,
        DeribitExecutionClientFactory(),
        DeribitExecClientConfig(
            trader_id=trader_id,
            account_id=account_id,
            product_types=product_types,
            environment=DeribitEnvironment.MAINNET,
            api_key=None,
            api_secret=None,
        ),
    )
    .build()
)
```

### API 凭据

可通过多种方式向 Deribit 客户端提供凭据。可以将相应值传给配置对象，也可以设置以下环境变量：

对于 Deribit 实盘（生产）客户端：

- `DERIBIT_API_KEY`
- `DERIBIT_API_SECRET`

对于 Deribit 测试网客户端：

- `DERIBIT_TESTNET_API_KEY`
- `DERIBIT_TESTNET_API_SECRET`

:::tip
建议使用环境变量管理凭据。
:::

### 产品类型

`product_types` 配置选项控制加载哪些 Deribit 产品系列。可通过 `DeribitProductType` 枚举使用以下选项：

- `DeribitProductType.FUTURE` - 永续期货和定期期货。
- `DeribitProductType.OPTION` - 看涨期权和看跌期权。
- `DeribitProductType.SPOT` - 现货交易对。
- `DeribitProductType.FUTURE_COMBO` - 期货价差金融工具。
- `DeribitProductType.OPTION_COMBO` - 期权价差金融工具。

加载多种产品类型的示例：

```python
from vibe_trader.adapters.deribit import DeribitDataClientConfig
from vibe_trader.adapters.deribit import DeribitProductType

config = DeribitDataClientConfig(
    product_types=[
        DeribitProductType.FUTURE,
        DeribitProductType.OPTION,
    ],
    # ... other config
)
```

### 基础 URL 覆盖

可以覆盖 HTTP 和 WebSocket API 的默认基础 URL：

| 环境   | HTTP URL                   | WebSocket URL                      |
| ------ | -------------------------- | ---------------------------------- |
| 生产   | `https://www.deribit.com`  | `wss://www.deribit.com/ws/api/v2`  |
| 测试网 | `https://test.deribit.com` | `wss://test.deribit.com/ws/api/v2` |

## 服务器基础设施

Deribit 的撮合引擎位于**英国斯劳 Equinix LD4**。对于延迟敏感型策略，应考虑托管在伦敦或其附近。Deribit 直接向机构客户提供机房托管和交叉连接选项。

对于大多数通过互联网连接的用户，适配器内置的重试逻辑、心跳监控和自动重连处理可提供可靠连接。

更多详情请参阅[服务器基础设施文章](https://support.deribit.com/hc/en-us/articles/25944617582877)。

## 贡献

:::info
有关其他功能或为 Deribit 适配器贡献代码，请参阅我们的[贡献指南](https://github.com/qOeOp/trade/blob/main/CONTRIBUTING.md)。
:::
