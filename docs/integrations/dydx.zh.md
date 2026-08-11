# dYdX

dYdX 是规模最大的加密衍生品去中心化交易所之一。此集成支持 dYdX v4 的实时市场数据接入和订单执行。
dYdX v4 运行在自己的 Cosmos SDK 应用专用区块链（dYdX Chain）上，采用 CometBFT 共识。订单簿和
撮合引擎作为验证者进程的一部分在链上运行。订单以 Cosmos 交易形式通过 gRPC 提交，并在每个区块结算。
Indexer 服务则通过 REST 和 WebSocket API 提供市场数据与账户状态。

## 安装

:::note
无需安装其他 extras。适配器使用 Rust 实现，并在构建期间自动编译到核心 `vibe_trader` 包中。
:::

## 示例

- [Python 示例](https://github.com/qOeOp/trade/tree/main/examples/live/dydx/)
- [Rust 示例](https://github.com/qOeOp/trade/tree/main/crates/adapters/dydx/examples/)

## 概览

此适配器使用 Rust 实现，并通过 PyO3 提供 Python 绑定。它直接集成 dYdX 的 Indexer API
（REST/WebSocket）以获取市场数据，并通过 gRPC 提交 Cosmos SDK 交易，无需外部客户端库。

### 产品支持

| 产品类型 | 数据馈送 | 交易 | 说明                                        |
| -------- | -------- | ---- | ------------------------------------------- |
| 永续期货 | ✓        | ✓    | 所有永续合约均以 USDC 结算。                |
| 现货     | -        | -    | dYdX 在 Solana 上提供现货；此适配器不支持。 |
| 期权     | -        | -    | *dYdX 不提供*。                             |

:::note
此适配器仅支持永续期货。所有市场均以 USD 报价、以 USDC 结算。
:::

## 链架构

与提供单一 REST/WebSocket API 的中心化交易所（CEX）不同，dYdX v4 运行在自己的
**Cosmos SDK 应用专用区块链**上。这意味着每笔交易都是经过共识的 Cosmos 交易，适配器必须管理序列、
gas 和基于区块高度的到期时间。

### 传输层

适配器通过三个相互独立的传输层通信：

```
                         ┌─────────────────────────────────────────────┐
                         │              dYdX v4 Chain                  │
                         │                                             │
 ┌──────────┐  HTTP      │   ┌──────────────────────┐                  │
 │          │───────────►│   │  Indexer (read-only) │                  │
 │          │  WebSocket │   │  - REST API          │                  │
 │ Vibe │───────────►│   │  - Streaming API     │                  │
 │ Adapter  │            │   └──────────────────────┘                  │
 │          │  gRPC      │   ┌──────────────────────┐                  │
 │          │───────────►│   │  Validator (write)   │                  │
 └──────────┘            │   │  - Cosmos Tx submit  │                  │
                         │   │  - Sequence mgmt     │                  │
                         │   └──────────────────────┘                  │
                         └─────────────────────────────────────────────┘
```

| 层        | 目标      | 方向 | 用途                                 |
| --------- | --------- | ---- | ------------------------------------ |
| HTTP      | Indexer   | 只读 | 金融工具元数据、历史数据、账户状态。 |
| WebSocket | Indexer   | 只读 | 实时市场数据、订单/成交/持仓更新。   |
| gRPC      | Validator | 写入 | 下单、取消和批量操作。               |

### 基于区块的结算

dYdX 大约每 **~0.5 秒**生成一个区块（实际时间会变化）。适配器包含 `BlockTimeMonitor`，它根据
WebSocket 馈送中观测到的区块时间动态估算 `seconds_per_block`。该估算值用于将基于时间的订单到期
转换为短期订单的区块高度偏移量。

## 架构

dYdX v4 适配器包含多个可组合或单独使用的组件：

- `DydxHttpClient`：由 Rust 支持的 HTTP 客户端，用于查询 Indexer REST API。
- `DydxWebSocketClient`：由 Rust 支持的 WebSocket 客户端，用于实时市场数据和账户更新。
- `DydxGrpcClient`：由 Rust 支持的 gRPC 客户端，用于提交 Cosmos SDK 交易。
- `DydxInstrumentProvider`：金融工具解析与加载功能。
- `DydxDataClient`：市场数据馈送管理器。
- `DydxExecutionClient`：账户管理与交易执行网关。
- `DydxDataClientFactory`：dYdX v4 数据客户端工厂（供交易节点构建器使用）。
- `DydxExecutionClientFactory`：dYdX v4 执行客户端工厂（供交易节点构建器使用）。

:::note
大多数用户会为实盘交易节点定义配置（如下所示），无需直接操作这些底层组件。
:::

:::warning[首次激活账户]
dYdX v4 交易账户（子账户 0）只会在钱包首次存款或交易后创建。在此之前，所有 gRPC/Indexer 查询均返回
`NOT_FOUND`，因此 `DydxExecutionClient.connect()` 会失败。

启动 `LiveNode` 前，请从同一网络（主网/测试网）的同一钱包发送任意正数金额的 USDC 或其他受支持抵押品。
交易最终确定（几个区块）后，重新启动节点，客户端即可正常连接。
:::

## 故障排除

### `StatusCode.NOT_FOUND`：找不到账户

**原因：** 钱包/子账户从未注资，因此尚未存在于链上。

**修复方法：**

1. 在正确网络上向子账户 0 存入任意正数金额的 USDC。
2. 等待最终确定（主网约 30 秒，测试网更久）。
3. 重启 `LiveNode`；此时应可成功连接。

:::tip
在无人值守部署中，将 `connect()` 调用包装在指数退避循环中，使客户端持续重试，直到存款出现。
:::

## 符号体系

dYdX 对永续期货合约使用特定符号约定。

### 符号格式

格式：`{Base}-USD-PERP`

dYdX 上的所有永续合约均：

- 以 USD 报价
- 以 USDC 结算
- 在 Vibe 中使用 `.DYDX` 交易场所后缀

示例：

- `BTC-USD-PERP.DYDX` - 比特币永续期货
- `ETH-USD-PERP.DYDX` - 以太坊永续期货
- `SOL-USD-PERP.DYDX` - Solana 永续期货

在策略中订阅：

```python
InstrumentId.from_str("BTC-USD-PERP.DYDX")
InstrumentId.from_str("ETH-USD-PERP.DYDX")
```

:::info
为与其他适配器保持一致并为未来扩展留出空间，添加了 `-PERP` 后缀。虽然 dYdX 目前只支持永续合约，
但这种命名约定允许未来扩展到其他产品类型。
:::

## 订单能力

dYdX 支持永续期货交易，并提供完整的订单类型和执行功能。适配器会根据有效期类型和到期时间自动将订单
归类为短期或长期，无需手动标记。

### 订单类型

| 订单类型               | 永续合约 | 说明                           |
| ---------------------- | -------- | ------------------------------ |
| `MARKET`               | ✓        | 以最佳可用价格立即执行。       |
| `LIMIT`                | ✓        |                                |
| `STOP_MARKET`          | ✓        | 止损条件订单，始终为长期订单。 |
| `STOP_LIMIT`           | ✓        | 条件订单，始终为长期订单。     |
| `MARKET_IF_TOUCHED`    | ✓        | 触价时触发的止盈市价单。       |
| `LIMIT_IF_TOUCHED`     | ✓        | 触价时触发的止盈限价单。       |
| `TRAILING_STOP_MARKET` | -        | *不支持*。                     |

### 执行指令

| 指令          | 永续合约 | 说明                                                                                                                              |
| ------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `post_only`   | ✓        | 支持 LIMIT、STOP_LIMIT 和 LIMIT_IF_TOUCHED 订单。只挂单订单如果定价会跨越价差，将被交易场所**接受后立即取消**（不会带原因拒绝）。 |
| `reduce_only` | ✓        | 传递给所有订单类型。dYdX 将其作为**成交时限制**，而非下单时的前置条件：在没有持仓时提交的只减仓订单仍会正常成交。                 |

### 有效期选项

| 有效期类型 | 永续合约 | 说明                                                                                                                                     |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GTC`      | ✓        | 撤销前有效。                                                                                                                             |
| `GTD`      | ✓        | 指定日期前有效。交易场所会将到期报告为取消事件；当订单的 `expire_time` 已过时，适配器将其映射为 `OrderExpired`（而非 `OrderCanceled`）。 |
| `IOC`      | ✓        | 立即成交或取消。                                                                                                                         |
| `FOK`      | -        | *dYdX v4 已弃用*。链以 `code=48` 拒绝 FOK 订单；适配器在本地生成 `OrderDenied`，不会广播。                                               |
| `DAY`      | -        | *不支持*。适配器在本地生成 `OrderDenied`，不会广播。                                                                                     |

### 高级订单功能

| 功能          | 永续合约 | 说明                                                                                                                                                     |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 订单修改      | -        | 不支持。dYdX 支持短期订单[替换](https://docs.dydx.xyz/concepts/trading/limit-orderbook#replacements)（相同 ID、更高 GTB）；尚未作为 `ModifyOrder` 公开。 |
| 括号/OCO 订单 | -        | *不支持*。                                                                                                                                               |
| 冰山订单      | -        | *不支持*。                                                                                                                                               |

### 批量操作

| 操作     | 永续合约 | 说明                                                                                           |
| -------- | -------- | ---------------------------------------------------------------------------------------------- |
| 批量提交 | ✓        | 支持长期 `LIMIT` 订单。短期订单逐笔提交。                                                      |
| 批量修改 | -        | *不支持*。                                                                                     |
| 批量取消 | ✓        | 分区处理：短期订单使用 `MsgBatchCancel`（单次 gRPC 调用），长期订单使用批量 `MsgCancelOrder`。 |

### 持仓管理

| 功能       | 永续合约 | 说明                   |
| ---------- | -------- | ---------------------- |
| 查询持仓   | ✓        | 实时持仓更新。         |
| 持仓模式   | -        | 仅净额模式（见下文）。 |
| 杠杆控制   | ✓        | 按市场设置杠杆。       |
| 保证金模式 | -        | 仅全仓保证金。         |

:::note
dYdX 在交易场所层面支持净额模式（每个金融工具一个持仓）。适配器目前仅以 `NETTING` 模式运行。
计划在未来版本中支持对冲。
:::

### 订单查询

| 功能         | 永续合约 | 说明                 |
| ------------ | -------- | -------------------- |
| 查询未结订单 | ✓        | 列出所有活动订单。   |
| 查询订单历史 | ✓        | 历史订单数据。       |
| 订单状态更新 | ✓        | 实时订单状态变化。   |
| 成交历史     | ✓        | 执行报告和成交报告。 |

### 条件关联订单

| 功能     | 永续合约 | 说明                           |
| -------- | -------- | ------------------------------ |
| 订单列表 | -        | *不支持*。                     |
| OCO 订单 | -        | *不支持*。                     |
| 括号订单 | -        | *不支持*。                     |
| 条件订单 | ✓        | 止损、止盈市价和止盈限价订单。 |

### 净值层级限制

dYdX 根据账户净值层级，限制每个子账户**同时处于未结状态的条件订单**数量（例如，标准层级为 10 个条件订单）。
提交超过上限的条件订单会在链上以 `code=10001` 拒绝，日志消息形如
`Opening order would exceed equity tier limit of N`。请在下更多订单前取消现有条件订单，或将策略拆分到多个子账户。

### MIT 和 LIT 往返转换

dYdX 协议只使用一种带价格（`subticks`）和触发价的 `TAKE_PROFIT` 订单类型；它表现为触发后市价单还是
触发后限价单，隐含在价格中。适配器提交 Vibe `MARKET_IF_TOUCHED` 时，将价格设为允许穿价 5% 的最差价格；
提交 `LIMIT_IF_TOUCHED` 时，则使用用户限价。Indexer 返回的两种形式均为 `"type":"TAKE_PROFIT"`。
对账时，适配器会将解析的限价与已配置穿价容差比较，以恢复原始 Vibe 订单类型。如果价格位于预言机价格的
穿价区间内，订单对账为 `MARKET_IF_TOUCHED`；否则对账为 `LIMIT_IF_TOUCHED`。

### 强平与 ADL（自动减仓）处理

dYdX v4 依次应用两种风险机制：

1. 当账户低于维持保证金时运行**强平**。持仓会在距预言机价格有限价差的范围内，与保险基金对手盘平仓。
2. 当强平无法完全恢复抵押率，或预言机价格大幅跳变使账户一步变为负值时，会激活**自动减仓（ADL）**。
   自动减仓会让抵押不足的持仓与随机选取的相反方向账户进行平仓。

Indexer 通过每条 `Fill` 记录的 `type` 字段（`DydxFillType`）公开分类：

| `type`        | 含义                           |
| ------------- | ------------------------------ |
| `LIMIT`       | 正常成交。                     |
| `LIQUIDATED`  | 强平的吃单方（抵押不足方）。   |
| `LIQUIDATION` | 强平的挂单方（保险基金）。     |
| `DELEVERAGED` | 自动减仓的吃单方（ADL 平仓）。 |
| `OFFSETTING`  | 自动减仓的挂单方（对冲账户）。 |

适配器会针对每笔强平/自动减仓成交，记录包含金融工具、方向、数量和价格的警告，随后通过正常路径发出
`FillReport`。`DydxPerpetualPositionStatus::Liquidated` 会关闭对应的持仓报告。

上游参考资料：

- [强平](https://docs.dydx.xyz/concepts/trading/liquidations)
- [合约损失机制（自动减仓）](https://help.dydx.trade/en/articles/166973-contract-loss-mechanisms-on-dydx-chain)

### 订单分类

dYdX 会将每个订单归入三种链上类别之一。适配器根据有效期类型和到期时间自动确定类别，无需手动配置。

| 类别 | 存放位置 | 到期依据      | 典型用途                                                       |
| ---- | -------- | ------------- | -------------------------------------------------------------- |
| 短期 | 内存     | 区块高度      | IOC/FOK，或在 40 个区块内到期的订单。                          |
| 长期 | 链上     | 时间戳（UTC） | 到期时间超过短期窗口的 GTC/GTD（约 20 秒，按约 0.5 秒/区块）。 |
| 条件 | 链上     | 时间戳（UTC） | 止损和止盈触发。                                               |

在协议层面，**所有 dYdX 订单都是限价单**。`MARKET` 订单类型是 Vibe 提供的便利功能，适配器将其实现为
以大幅穿过订单簿的价格提交的激进 IOC 限价单。因此，市价单与限价单遵循相同的
`Submitted > Accepted > Filled` 生命周期（预期会在成交前收到 `OrderAccepted` 事件）。

有关短期订单与有状态订单机制的完整协议级说明，请参阅
[dYdX 订单文档](https://docs.dydx.xyz/concepts/trading/orders)。

#### 短期订单

短期订单**仅存在于验证者内存中**，按区块高度到期（最多 40 个区块，按约 0.5 秒/区块计算约 20 秒）。
由于跳过链上存储，它们是 dYdX 上最快的订单类型。

**属性**：

- **IOC 和 FOK 始终为短期订单**，不受其他参数影响
- 当到期时间位于动态短期窗口（`40 blocks × seconds_per_block`）内时，**GTD 订单**自动归类为短期
- 使用 Good-Til-Block（GTB）而非 Cosmos SDK 序列进行重放保护
- 可以**并发**广播（无信号量，使用缓存序列）
- 静默到期，不生成取消事件
- 无法在单笔交易中批量处理（每笔 tx 一个 `MsgPlaceOrder`）

#### 长期订单

长期（有状态）订单**存储在链上**，按 UTC 时间戳到期。到期或取消时会生成显式取消事件。

**属性**：

- **GTC** 订单默认 90 天后到期（协议上限为 95 天）
- **GTD** 订单使用用户提供的到期时间戳
- 需要正确管理 Cosmos SDK 序列（通过信号量串行化）
- 必须以递增序列号**串行**广播
- 可以在单笔交易中批量处理

#### 条件订单

条件订单（止损、止盈）**始终存储在链上**，由验证者上的价格条件触发。

**属性**：

- 始终采用基于时间戳的到期方式（GTC 默认 90 天，协议上限 95 天）
- 始终使用长期广播路径（通过信号量串行化）
- 包括 `StopMarket`、`StopLimit`、`TakeProfitMarket` 和 `TakeProfitLimit`

#### 自动路由

适配器使用 `BlockTimeMonitor` 自动确定订单生命周期：

```
max_short_term_secs = SHORT_TERM_ORDER_MAXIMUM_LIFETIME (40) × seconds_per_block
```

如果订单距离到期的时间不超过 `max_short_term_secs`，则路由为短期订单；否则路由为长期订单。
无需手动配置。

#### MARKET 订单实现

dYdX 没有原生市价单类型。适配器将 `MARKET` 订单实现为以下价格的激进**IOC 限价单**：

- **买入**：`oracle_price × (1 + 0.05)`（高于预言机价格 5%）
- **卖出**：`oracle_price × (1 - 0.05)`（低于预言机价格 5%）

这个 5% 滑点缓冲（`DEFAULT_MARKET_ORDER_SLIPPAGE = 0.05`）设定了最差价格（"穿价价格"）。由于订单
采用 IOC，未成交的滑点不会被消耗。该缓冲有意设置得较宽，以便在波动行情中最大限度提高成交概率。

### 客户端订单 ID 编码

dYdX 要求链上的客户端 ID 为 `u32`，而 Vibe 使用字符串形式的 `ClientOrderId` 值
（例如 `O-20260220-031943-001-000-51`）。适配器会对二者进行双向编码，使订单无需持久化状态也能跨重启对账。

对于标准 O 格式（`O-YYYYMMDD-HHMMSS-TTT-SSS-CCC`），编码是确定性的：

| dYdX 字段         | 位数 | 内容                                             |
| ----------------- | ---- | ------------------------------------------------ |
| `client_id`       | 32   | `[trader:10][strategy:10][count:12]`（唯一键）。 |
| `client_metadata` | 32   | 自 2020-01-01 UTC 起的秒数（时间戳）。           |

由于编码是确定性的，适配器无需数据库或映射文件，即可将任何对账订单解码回原始 `ClientOrderId` 字符串。

非标准 `ClientOrderId` 格式（自定义字符串、纯数字）会回退到顺序分配，并使用内存中的反向映射。
这些 ID 只能在同一会话内解码。

#### 防止重启冲突

重启时，Vibe 会根据对账订单数量重置内部订单计数器，该数量可能小于上一会话使用的最高计数值
（例如部分订单已从 API 响应中过期消失）。这可能导致新订单产生与上一会话订单相同的 `client_id`，
进而产生重复的交易场所订单 UUID。

适配器通过注册对账期间看到的每个 `client_id` 来避免此问题。如果新的 O 格式编码产生已使用的
`client_id`，编码器会记录警告并回退到顺序分配。顺序分配也会跳过所有已注册值。

:::note
此保护自动生效，无需用户配置。警告日志
`[ENCODER] client_id ... collides with reconciled order` 仅供参考。订单仍会使用替代 ID 成功提交。
:::

## 广播与重试策略

### 短期广播

短期订单使用 Good-Til-Block（GTB）进行重放保护。链的 `ClobDecorator` ante handler 会跳过短期消息的
Cosmos SDK 序列检查，因此：

- **无信号量**：广播完全并发
- **缓存序列**：无需递增或分配
- **不重试**：广播失败便立即失败
- 良性取消错误视为成功（见下文）

### 长期广播

长期和条件订单需要正确管理 Cosmos SDK 序列：

- 使用 1 个许可的**信号量**将所有长期广播串行化
- **指数退避**：500ms -> 1s -> 2s -> 4s（最多重试 5 次）
- **总计 10 秒的时间预算**，避免无限重试循环
- 序列不匹配时，从链上**重新同步序列**后再重试

### 序列不匹配检测

| 错误代码   | 来源               | 含义                       |
| ---------- | ------------------ | -------------------------- |
| `code=32`  | Cosmos SDK         | 账户序列不匹配             |
| `code=104` | dYdX authenticator | 签名验证失败（与序列有关） |

两者都会通过 `RetryManager` 触发自动重新同步并重试。

### 良性取消错误

短期取消操作期间出现以下错误时会视为**成功**：

| 错误代码    | 含义                                                  |
| ----------- | ----------------------------------------------------- |
| `code=19`   | 交易已存在于 mempool 缓存中（重复 tx）                |
| `code=9`    | 取消已存在于 memclob 中，且 GoodTilBlock 不低于当前值 |
| `code=3006` | 要取消的订单不存在（已成交/到期/取消）                |

### 批量取消分区

取消多个订单时，适配器按生命周期进行分区：

1. **短期订单**：通过 `broadcast_short_term()` 进行单次 `MsgBatchCancel`
2. **长期订单**：通过 `broadcast_with_retry()` 批量发送 `MsgCancelOrder` 消息

这样可确保每组订单使用适当的广播策略。

## 资金费率

dYdX 永续期货采用固定的 1 小时资金费率周期。对于 WebSocket 和历史资金费率数据，适配器都会将所有
`FundingRateUpdate` 对象的 `interval` 设置为 `60`（分钟）。

## 速率限制

### gRPC 速率限制

适配器会限制 gRPC `broadcast_tx` 调用速率，防止验证者节点返回 `ResourceExhausted`（429）错误。

| 设置                         | 默认值 | 说明                                                 |
| ---------------------------- | ------ | ---------------------------------------------------- |
| `grpc_rate_limit_per_second` | `4`    | 每秒最多发送的 gRPC 广播请求数。设为 `None` 可禁用。 |

### 提供商限制

已知公共 gRPC 提供商的速率限制：

| 提供商    | 限制                 | 说明 |
| --------- | -------------------- | ---- |
| Polkachu  | 300 req/min (~5/s)   |      |
| KingNodes | 250 req/min (~4.2/s) |      |
| AutoStake | 4 req/s              |      |

默认值 4 req/s 较为保守，适用于所有公共提供商。

### 多 gRPC URL 回退

执行配置的 `grpc_endpoint` 字段会覆盖主要 gRPC 端点。它是配置结构体字段，不是 Python
`DydxExecClientConfig` 构造函数的参数。

当 `grpc_endpoint` 未设置时，适配器使用所选网络的默认公共节点，并在公共验证者列表中内置回退。
目前 Python 配置尚未公开通过用户配置显式设置多个 URL 回退的功能。

## 价格与数量量化

dYdX 对价格和数量使用基于整数的量化方式。适配器通过 `OrderMessageBuilder` 自动处理所有转换，
但了解相关参数有助于调试。

### 市场参数

| 参数                          | 说明                                 |
| ----------------------------- | ------------------------------------ |
| `atomic_resolution`           | 将人类可读数量转换为 quantums 的指数 |
| `quantum_conversion_exponent` | 将 quantums 转换为 token 的指数      |
| `step_base_quantums`          | 以 quantums 表示的最小订单数量步长   |
| `subticks_per_tick`           | 每个 tick 内的价格粒度               |

### 市价单定价

市价单采用带 5% 滑点缓冲的预言机价格（"穿价价格"）：

- **买入**：`oracle_price × 1.05`
- **卖出**：`oracle_price × 0.95`

预言机价格从 Indexer 缓存，并定期刷新。

### 自动处理

所有价格和数量量化均由 `OrderMessageBuilder` 自动处理。通过 Vibe 提交订单时无需手动转换。

## 数据订阅

v4 适配器支持以下数据订阅：

| 数据类型     | 订阅 | 历史请求 | 说明                                            |
| ------------ | ---- | -------- | ----------------------------------------------- |
| 逐笔成交     | ✓    | ✓        |                                                 |
| 逐笔报价     | ✓    | -        | 从订单簿最优档合成。                            |
| 订单簿增量   | ✓    | -        | 仅 L2 深度。                                    |
| 订单簿快照   | -    | ✓        | 通过 HTTP 请求获取一次性快照。                  |
| K 线         | ✓    | ✓        | 参阅下方支持的分辨率。                          |
| 标记价格     | ✓    | -        | 通过 markets 频道。                             |
| 指数价格     | ✓    | -        | 通过 markets 频道。                             |
| 资金费率     | ✓    | ✓        | 通过 markets 频道实时获取，通过 HTTP 获取历史。 |
| 金融工具状态 | ✓    | -        | 通过 markets 频道。                             |

### 支持的 K 线分辨率

| 分辨率    | dYdX 蜡烛图 |
| --------- | ----------- |
| 1-MINUTE  | `1MIN`      |
| 5-MINUTE  | `5MINS`     |
| 15-MINUTE | `15MINS`    |
| 30-MINUTE | `30MINS`    |
| 1-HOUR    | `1HOUR`     |
| 4-HOUR    | `4HOURS`    |
| 1-DAY     | `1DAY`      |

## 子账户

dYdX 支持每个钱包地址拥有多个子账户，使交易策略和风险管理可以在单个钱包内相互隔离。

### 核心概念

- 每个钱包地址可以有多个编号子账户（0、1、2、...、127）。
- 子账户 0 是**默认值**，首次存款时自动创建。
- 每个子账户分别维护自己的：
  - 持仓
  - 未结订单
  - 抵押品余额
  - 保证金要求

### 配置

在执行客户端配置中指定子账户编号：

```python
from vibe_trader.adapters.dydx import DydxExecClientConfig
from vibe_trader.model import AccountId
from vibe_trader.model import TraderId


exec_config = DydxExecClientConfig(
    trader_id=TraderId.from_str("TRADER-001"),
    account_id=AccountId.from_str("DYDX-001"),
    subaccount_number=0,
)
```

:::note
大多数用户会使用子账户 `0`（默认值）。高级用户可以为不同子账户配置多个执行客户端，实现策略隔离或风险隔离。
:::

## 测试网设置

dYdX 测试网（`dydx-testnet-4`）是主网的完整副本，可用于测试策略而无需承担真实资金风险。
设置 `network=DydxNetwork.TESTNET` 后，会自动解析所有默认测试网端点。

### 1. 创建测试网钱包

**选项 A：通过 dYdX 测试网 Web 应用（最简单）**

1. 前往 [v4.testnet.dydx.exchange](https://v4.testnet.dydx.exchange)
2. 使用 MetaMask、Keplr、Phantom 或 WalletConnect 连接
3. 系统会自动生成 dYdX 账户
4. 导出助记词：点击右上角地址，然后选择"Export secret phrase"

**选项 B：使用现有 secp256k1 私钥**

任何以十六进制编码的 32 字节 secp256k1 私钥均可使用。适配器会使用 Cosmos bech32 编码，
自动从密钥派生 `dydx1...` 地址。

### 2. 为测试网账户注资

适配器连接前必须为子账户注资（参阅[首次激活账户](#架构)）。

**通过测试网 Web 应用：**

点击 [v4.testnet.dydx.exchange](https://v4.testnet.dydx.exchange) 上的存款/充值按钮，即可自动接收测试网 USDC。

**直接通过水龙头 API：**

```bash
# Fund subaccount 0 with 2000 USDC
curl -X POST https://faucet.v4testnet.dydx.exchange/faucet/tokens \
  -H "Content-Type: application/json" \
  -d '{"address": "dydx1...", "subaccountNumber": 0, "amount": 2000}'

# Fund native tokens (for gas fees)
curl -X POST https://faucet.v4testnet.dydx.exchange/faucet/native-token \
  -H "Content-Type: application/json" \
  -d '{"address": "dydx1..."}'
```

### 3. 设置环境变量

```bash
export DYDX_TESTNET_WALLET_ADDRESS="dydx1..."
export DYDX_TESTNET_PRIVATE_KEY="0x..."  # hex-encoded, 0x prefix optional
```

### 4. 配置交易节点

在数据客户端和执行客户端上都设置 `network=DydxNetwork.TESTNET`：

```python
from vibe_trader.adapters.dydx import DydxDataClientConfig
from vibe_trader.adapters.dydx import DydxExecClientConfig
from vibe_trader.adapters.dydx import DydxNetwork
from vibe_trader.model import AccountId
from vibe_trader.model import TraderId


data_config = DydxDataClientConfig(network=DydxNetwork.TESTNET)

exec_config = DydxExecClientConfig(
    trader_id=TraderId.from_str("TRADER-001"),
    account_id=AccountId.from_str("DYDX-001"),
    network=DydxNetwork.TESTNET,
    wallet_address=None,  # Falls back to DYDX_TESTNET_WALLET_ADDRESS
    private_key=None,  # Falls back to DYDX_TESTNET_PRIVATE_KEY
    subaccount_number=0,
)
```

### 测试网端点

Python 构造函数会自动选择默认测试网端点，不公开端点覆盖选项。

| 服务      | 默认 URL                                           |
| --------- | -------------------------------------------------- |
| HTTP      | `https://indexer.v4testnet.dydx.exchange`          |
| WebSocket | `wss://indexer.v4testnet.dydx.exchange/v4/ws`      |
| gRPC      | `https://test-dydx-grpc.kingnodes.com:443`（主要） |
| 水龙头    | `https://faucet.v4testnet.dydx.exchange`           |
| Web 应用  | `https://v4.testnet.dydx.exchange`                 |

### 主网端点

Python 构造函数会自动选择默认主网端点，不公开端点覆盖选项。

| 服务      | 默认 URL                                          |
| --------- | ------------------------------------------------- |
| HTTP      | `https://indexer.dydx.trade`                      |
| WebSocket | `wss://indexer.dydx.trade/v4/ws`                  |
| gRPC      | `https://dydx-ops-grpc.kingnodes.com:443`（主要） |

## 配置

通过交易节点配置 dYdX 适配器。执行客户端支持从环境变量回退获取凭证。数据客户端使用公开端点，
无需钱包凭证。

### 数据客户端配置选项

| 选项        | 默认值    | 说明                                             |
| ----------- | --------- | ------------------------------------------------ |
| `network`   | `MAINNET` | `DydxNetwork.MAINNET` 或 `DydxNetwork.TESTNET`。 |
| `proxy_url` | `None`    | 可选的 HTTP 和 WebSocket 代理 URL。              |

### 执行客户端配置选项

| 选项                | 默认值    | 说明                                               |
| ------------------- | --------- | -------------------------------------------------- |
| `trader_id`         | Required  | 客户端的 Vibe 交易者 ID。                          |
| `account_id`        | Required  | 客户端的 Vibe 账户 ID。                            |
| `network`           | `MAINNET` | `DydxNetwork.MAINNET` 或 `DydxNetwork.TESTNET`。   |
| `private_key`       | `None`    | 十六进制编码的签名密钥；回退到网络对应的环境变量。 |
| `wallet_address`    | `None`    | dYdX 钱包地址；回退到网络对应的环境变量。          |
| `subaccount_number` | `0`       | 从 `0` 到 `127` 的子账户编号。                     |
| `proxy_url`         | `None`    | 可选的 HTTP 和 WebSocket 代理 URL。                |

### 基本设置

将 `DydxDataClientConfig` 与 `DydxDataClientFactory` 搭配使用，将 `DydxExecClientConfig` 与
`DydxExecutionClientFactory` 搭配使用。当前 Python 示例展示了数据客户端和执行客户端的完整
`LiveNode.builder(...)` 配置。

### API 凭证

可以通过 Python 配置直接传入凭证（`wallet_address`、`private_key`），也可以根据已配置的 `network`
从环境变量自动解析。

#### 环境变量

| 变量                          | 网络   | 说明                                    |
| ----------------------------- | ------ | --------------------------------------- |
| `DYDX_WALLET_ADDRESS`         | 主网   | Bech32 编码的钱包地址（`dydx1...`）。   |
| `DYDX_PRIVATE_KEY`            | 主网   | 用于签名的十六进制编码 secp256k1 私钥。 |
| `DYDX_TESTNET_WALLET_ADDRESS` | 测试网 | 测试网钱包地址（`dydx1...`）。          |
| `DYDX_TESTNET_PRIVATE_KEY`    | 测试网 | 测试网私钥。                            |

#### 解析优先级

1. Python 配置中传入的值（如果非空）
2. 由 `network` 选定的环境变量

### 授权密钥交易

#### 什么是 API Trading Keys

API Trading Keys 可让你将交易权限委托给独立签名密钥，而无需分享主钱包助记词。API 密钥可以使用
所有者全仓保证金账户中的全部可用保证金进行交易，但不能提取资金或转移资产。

#### 创建 API 密钥

1. 在 dYdX Web 应用中前往 **More > API Trading Keys**
2. 点击 **Generate New API Key**
3. 保存 **API Wallet Address** 和 **Private Key**（仅显示一次，dYdX 不会存储）
4. 点击 **Authorize API Key**（将密钥作为认证器注册到链上）
5. 密钥现已激活，可用于交易

有关创建和管理 API 密钥的完整信息，请参阅
[dYdX API Trading Keys 指南](https://docs.dydx.xyz/concepts/trading/api-trading-keys)。

#### 适配器配置

将 API 密钥的私钥设为 `DYDX_PRIVATE_KEY`，将所有者的钱包地址设为 `DYDX_WALLET_ADDRESS`。
适配器在连接时检测到二者不匹配，并自动在链上查询匹配的认证器 ID。

```python
from vibe_trader.adapters.dydx import DydxExecClientConfig
from vibe_trader.model import AccountId
from vibe_trader.model import TraderId


config = DydxExecClientConfig(
    trader_id=TraderId.from_str("TRADER-001"),
    account_id=AccountId.from_str("DYDX-001"),
    wallet_address="dydx1owner...",  # Owner account (holds margin)
    private_key="0xapikey...",  # API Trading Key private key
)
```

公开 Python 配置不接受手动指定认证器 ID。

:::note
API Trading Keys 仅适用于**全仓保证金**账户和全仓市场。不支持逐仓保证金。
:::

## 订单簿

根据订阅方式，可以维护全深度订单簿或最优档报价。交易场所不直接提供报价；适配器会订阅订单簿增量，
并在最优档价格或数量变化时为 `DataEngine` 合成报价。仅支持 L2（MBP）订单簿类型。

## 贡献

:::info
如需添加功能或为 dYdX 适配器贡献代码，请参阅我们的
[贡献指南](https://github.com/qOeOp/trade/blob/main/CONTRIBUTING.md)。
:::
