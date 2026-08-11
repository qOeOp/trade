# Lighter

[Lighter](https://lighter.xyz) 是一家采用中央限价订单簿的去中心化交易所，支持现货和
永续期货。该交易场所通过以太坊零知识汇总完成结算，而撮合和排序则在链下进行。

VibeTrader 的 Lighter 适配器由 `vibe-lighter` crate 实现。它提供 Rust 数据客户端和执行客户端、
带类型的 REST 与 WebSocket 模型，以及内置于源码树中的 L2 交易签名器，用于该交易场所的
Schnorr / ECgFp5 签名流程。

## 概览

主要组件包括：

- `LighterRawHttpClient`：面向公开端点和账户端点的底层 REST 客户端。
- `LighterHttpClient`：领域客户端，将金融工具、交易、订单簿、订单和账户状态解析为 Vibe 模型类型。
- `LighterWebSocketClient`：可自动重连的 WebSocket 客户端，用于公开市场数据流和私有账户数据流。
- `LighterDataClient`：用于金融工具、交易、报价和 L2 MBP 订单簿的 Vibe 数据客户端。
- `LighterExecutionClient`：用于账户数据流、订单提交、修改、取消和对账报告的 Vibe 执行客户端。
- `LighterDataClientFactory` 和 `LighterExecutionClientFactory`：实盘节点的工厂接线。

Python 接口刻意保持精简。Python 扩展仅公开配置、环境选择、工厂类和集成方授权撤销；
数据客户端和执行客户端通过 Rust trait 接口使用。

## 示例

Python 示例位于
[`examples/live/lighter/`](https://github.com/qOeOp/trade/tree/main/examples/live/lighter/)，
默认只进行演练构建。传入 `--run` 才会连接；执行测试器还要求传入 `--live-orders` 以禁用
`dry_run`。

在仓库根目录运行：

```bash
.venv/bin/python examples/live/lighter/data_tester.py --lighter-environment testnet
.venv/bin/python examples/live/lighter/exec_tester.py --lighter-environment testnet
```

在仓库根目录指定金融工具并连接主网：

```bash
.venv/bin/python examples/live/lighter/data_tester.py \
    --lighter-environment mainnet \
    --instrument BTC-PERP.LIGHTER \
    --run
.venv/bin/python examples/live/lighter/exec_tester.py \
    --lighter-environment mainnet \
    --instrument DOGE-PERP.LIGHTER \
    --run
```

Rust 示例位于 `crates/adapters/lighter/examples/`。两个测试器运行时都会连接，但执行测试器只有在
源码中设置 `DRY_RUN = false` 后才会提交订单：

```bash
cargo run --example lighter-data-tester --package vibe-lighter --features examples
cargo run --example lighter-exec-tester --package vibe-lighter --features examples
```

:::warning
示例可能连接实盘交易场所。启用实盘订单流的执行示例如果指向已注资的主网账户，便可能提交
订单。运行前请检查所选金融工具、数量和环境。
:::

如需紧急清理账户，可运行 `cargo run --bin lighter-flatten -p vibe-lighter`，取消已配置 Lighter
账户的未结订单并平掉持仓。该命令会扫描所有已注册市场，因此标准的每分钟 60 次 REST 请求配额
可能使执行过程持续数分钟。请先检查当前账户和持仓，因为该操作作用于整个账户，而非仅限某个策略。

## 产品支持

| 产品类型 | 数据馈送 | 交易 | 说明                                         |
| -------- | -------- | ---- | -------------------------------------------- |
| 现货     | ✓        | ✓    | 使用 Lighter 市场索引 2048-4094 的现货市场。 |
| 永续期货 | ✓        | ✓    | 使用 Lighter 市场索引 0-254 的线性永续市场。 |
| 定期期货 | -        | -    | *不支持*。                                   |
| 期权     | -        | -    | *不支持*。                                   |

## 限制

当前适配器的范围有意小于该交易场所完整的交易接口范围：

- 尚未实现分组订单列表、OCO/OTO 组、括号订单、TWAP、追踪止损和冰山订单显示数量。批量提交不会使用
  `CreateGroupedOrders`。
- 订单列表提交和批量取消会通过 WebSocket 依次扇出独立交易。这两种操作每条命令最多处理 15 笔交易。
- `CancelAllOrders` 使用所请求金融工具的缓存未结订单。适配器不会使用 Lighter 原生的账户级全部取消交易，
  因为它可能影响无关市场。
- 现货交易支持市价单和限价单。条件止损和止盈订单仅适用于永续市场。
- 账户状态和持仓报告来自私有 WebSocket 数据流。`query_account` 和持仓状态生成会重放最新缓存的数据流状态。
- 无范围限定的订单对账仅覆盖已配置或已观察到的活跃市场，避免在标准 REST 配额下对整个交易场所执行全面扇出。

## 符号体系

Lighter 使用数字 `market_index` 标识市场。适配器先从 `GET /api/v1/orderBookDetails` 引导加载映射，
再将交易场所的原始符号转换为 Vibe `InstrumentId`。

| 交易场所产品 | Vibe 符号格式                 | 示例                    | 说明                            |
| ------------ | ----------------------------- | ----------------------- | ------------------------------- |
| 永续期货     | `{BASE}-PERP.LIGHTER`         | `BTC-PERP.LIGHTER`      | 交易场所原始符号为 `BTC`。      |
| 现货         | `{BASE}/{QUOTE}-SPOT.LIGHTER` | `ETH/USDC-SPOT.LIGHTER` | 交易场所原始符号为 `ETH/USDC`。 |

后缀用于区分现货和永续合约。出站请求会移除后缀并使用缓存的 `market_index`；现货符号则保留交易场所的交易对。

## 环境

| 环境   | REST URL                              | WebSocket URL                              | 链 ID |
| ------ | ------------------------------------- | ------------------------------------------ | ----- |
| 主网   | `https://mainnet.zklighter.elliot.ai` | `wss://mainnet.zklighter.elliot.ai/stream` | 304   |
| 测试网 | `https://testnet.zklighter.elliot.ai` | `wss://testnet.zklighter.elliot.ai/stream` | 300   |

在数据和执行配置中使用 `LighterEnvironment::Mainnet` 或 `LighterEnvironment::Testnet`。
如需使用私有网关或本地测试夹具，可以覆盖 URL。

## 集成方归因

创建和修改交易会在 `L2TxAttributes` 中携带 VibeTrader 集成方账户索引，用于衡量适配器使用情况。
挂单方和吃单方的集成方费用均为零。执行客户端启动时会提交所需的**零费用** `ApproveIntegrator` 授权。

### 撤销授权

离开该适配器时，可用撤销操作进行清理。该操作会发送 `approval_expiry = 0` 且最大费用为零的
`ApproveIntegrator`。下次启动执行客户端时会记录新的零费用授权。

```bash
export LIGHTER_API_KEY_INDEX=5
export LIGHTER_API_SECRET=REPLACE_ME
export LIGHTER_ACCOUNT_INDEX=123456
cargo run -p vibe-lighter --bin lighter-integrator-revoke           # mainnet
cargo run -p vibe-lighter --bin lighter-integrator-revoke testnet   # testnet
```

脚本源文件：
[`crates/adapters/lighter/bin/integrator_revoke.rs`](https://github.com/qOeOp/trade/blob/main/crates/adapters/lighter/bin/integrator_revoke.rs)。

```python
# Python (PyO3 binding) - reads the same env vars as the Rust bin
from vibe_trader.adapters.lighter import revoke_lighter_integrator
from vibe_trader.adapters.lighter import LighterEnvironment

await revoke_lighter_integrator()  # mainnet (default)
await revoke_lighter_integrator(LighterEnvironment.TESTNET)  # testnet
```

Rust 脚本会打印操作摘要，并在签名或发送前暂停，等待按下 Enter 键；如果摘要中有任何内容不正确，
请在此之前按 `Ctrl+C` 中止。Python 绑定不会提示：调用前请自行检查当前环境变量。

## 数据订阅

| 数据类型       | 订阅     | 快照 | 历史 | Vibe 类型           | 说明                                                |
| -------------- | -------- | ---- | ---- | ------------------- | --------------------------------------------------- |
| 金融工具元数据 | 缓存重放 | ✓    | -    | `InstrumentAny`     | 从 `orderBookDetails` 加载。                        |
| 成交逐笔       | ✓        | -    | ✓    | `TradeTick`         | WebSocket 成交；公开 `recentTrades` REST 历史记录。 |
| 报价逐笔       | ✓        | -    | -    | `QuoteTick`         | 最优买价和卖价的行情数据流。                        |
| 订单簿增量     | ✓        | ✓    | -    | `OrderBookDeltas`   | 仅支持 `L2_MBP`。                                   |
| 订单簿十档深度 | ✓        | -    | -    | `OrderBookDepth10`  | 来自维护中订单簿的实时十档视图；无 REST 快照。      |
| 订单簿快照     | -        | ✓    | -    | `OrderBook`         | REST 快照，最大深度 250。                           |
| 标记价格       | ✓        | -    | -    | `MarkPriceUpdate`   | 永续市场统计数据流。                                |
| 指数价格       | ✓        | -    | -    | `IndexPriceUpdate`  | 市场和现货统计数据流。                              |
| 资金费率       | ✓        | -    | ✓    | `FundingRateUpdate` | 当前预估值和 REST 每小时历史记录。                  |
| K 线           | ✓        | -    | ✓    | `Bar`               | WebSocket 蜡烛图数据流；用于回填的 REST 历史记录。  |
| 金融工具状态   | REST     | ✓    | -    | `InstrumentStatus`  | `active` / `inactive` 快照。                        |

订单簿增量和十档深度订阅仅接受 `BookType::L2_MBP`。其他订单簿类型会在订阅前返回错误。

WebSocket 订单簿仅通过 `subscribed/order_book` 初始化。如果 `update/order_book` 在该快照之前到达，
适配器会将其丢弃并等待真正的快照，因为增量更新不包含完整的可见订单簿。

十档深度订阅与增量订阅使用相同的 WebSocket `order_book` 数据流。每次接受快照或增量更新后，
适配器都会发出刷新后的十档视图。

K 线订阅使用交易场所的 `candle/{market_id}/{resolution}` WebSocket 频道。Lighter 大约每 500 ms
批量发送当前未收盘 K 线的更新；只有当蜡烛图的起始时间戳前移时，适配器才会发出 Vibe `Bar`，
因此消费者每个已收盘周期只会看到一个事件。重连和取消订阅时都会清空进行中 K 线的缓存。

数据流支持 `1m`、`5m`、`15m`、`30m`、`1h`、`4h`、`12h` 和 `1d`。`1w` 只能通过 REST 的
`request_bars` 使用；订阅 `1-WEEK` K 线类型会返回错误。

REST K 线历史记录会忽略开盘价、最高价、最低价或收盘价缺失、为 null、为零或为负的交易场所缺口行。
这些行无法构成有效的 Vibe K 线，也不会阻止后续有效行加载。

金融工具状态订阅会在可用时重放最新缓存的 `orderBookDetails` 状态，否则获取 REST 快照。
Lighter 不提供 WebSocket 状态变化数据流。

实时和历史资金费率的语义请参阅[资金费率](#资金费率)。

成交订阅使用公开 WebSocket 成交数据流。历史成交请求使用公开的 `/api/v1/recentTrades` 端点，
无需凭证；适配器会将请求限制在交易场所的单次调用上限，并将返回的逐笔成交筛选到请求的时间范围内。

### 不支持的数据请求

尚未实现 `request_quotes`。Lighter 通过 WebSocket `ticker` 数据流提供最优买价和卖价数据，
但适配器可用的 REST 端点不提供能安全映射到 `QuoteTick` 的带时间戳报价快照或报价历史。

尚未实现 `request_book_depth`。文档所述 REST 订单簿端点不提供 `OrderBookDepth10.ts_event` 所需的
交易场所事件时间戳；实时十档深度请使用 `subscribe_book_depth10`，REST `OrderBook` 快照请使用
`request_book_snapshot`。

## 订单能力

### 订单标识

Lighter 使用数字形式的交易场所订单索引和调用方提供的 `client_order_index`。
适配器从 Vibe `ClientOrderId` 派生一个 31 位索引，并在发生冲突时向后探测。由于重启后无法重新派生
经过冲突探测的值，订单对账会通过核心缓存解析每个原始交易场所订单 ID，并在转换订单和成交报告前
恢复其实际 `client_order_index`。缓存中的未结订单会恢复为主动跟踪状态，终态订单则使用有界重放跟踪。

恢复过程绝不会仅凭整数推断客户端订单 ID：缓存的交易场所订单 ID 必须匹配。该过程要求对账结果包含
相应订单，且核心缓存保留其交易场所订单 ID 映射；否则报告会使用唯一的交易场所订单 ID 作为外部客户端订单 ID。

查询路径会使用数字形式的交易场所订单 ID 查询活跃订单或终态历史记录。在该 ID 尚未知时，Vibe 客户端订单 ID
可以通过其派生的客户端索引查询活跃订单。仅使用客户端索引的查询不会搜索终态历史记录；若有重复的活跃匹配项，
则会因结果不明确而失败。

### 订单类型

| 订单类型               | 永续合约 | 现货 | 说明                                                |
| ---------------------- | -------- | ---- | --------------------------------------------------- |
| `MARKET`               | ✓        | ✓    | 上限根据缓存的对手方报价和滑点得出。                |
| `LIMIT`                | ✓        | ✓    | 需要限价。                                          |
| `STOP_MARKET`          | ✓        | -    | 仅限永续合约；上限根据 `trigger_price` 和滑点得出。 |
| `STOP_LIMIT`           | ✓        | -    | 仅限永续合约；映射到 Lighter 止损限价单。           |
| `MARKET_IF_TOUCHED`    | ✓        | -    | 仅限永续合约；上限根据 `trigger_price` 和滑点得出。 |
| `LIMIT_IF_TOUCHED`     | ✓        | -    | 仅限永续合约；映射到 Lighter 止盈限价单。           |
| `MARKET_TO_LIMIT`      | -        | -    | *不支持*。                                          |
| `TRAILING_STOP_MARKET` | -        | -    | *不支持*。                                          |
| `TRAILING_STOP_LIMIT`  | -        | -    | *不支持*。                                          |
| `TWAP`                 | -        | -    | *不支持*；无 Vibe 映射。                            |

条件订单需要 `trigger_price`。适配器会拒绝以下情况：`STOP_MARKET` 和 `MARKET_IF_TOUCHED` 缺少触发价；
触发价按金融工具价格精度截断后为 `0` 个 tick；以及 Lighter 不支持的现货条件订单。

Lighter 要求为市价类订单提供最差可接受 `price`。对于 `MARKET`，适配器从缓存的对手方 `QuoteTick` 开始计算；
对于 `STOP_MARKET` 和 `MARKET_IF_TOUCHED`，则从 `trigger_price` 开始计算。随后应用
`market_order_slippage_bps`（默认 50 bps），并按金融工具的价格精度取整：买入向上取整，卖出向下取整。
没有缓存报价的 `MARKET` 订单会被拒绝。可通过 `SubmitOrder.params["market_order_slippage_bps"]` 覆盖滑点。

### 条件关联订单

| 功能                  | 永续合约 | 现货 | 说明                                               |
| --------------------- | -------- | ---- | -------------------------------------------------- |
| 止损市价单            | ✓        | -    | `STOP_MARKET` 映射到 Lighter `STOP_LOSS`。         |
| 止损限价单            | ✓        | -    | `STOP_LIMIT` 映射到 Lighter `STOP_LOSS_LIMIT`。    |
| 止盈市价单            | ✓        | -    | `MARKET_IF_TOUCHED` 映射到 Lighter `TAKE_PROFIT`。 |
| 止盈限价单            | ✓        | -    | `LIMIT_IF_TOUCHED` 映射到 `TAKE_PROFIT_LIMIT`。    |
| 触发价                | ✓        | -    | 每种受支持的条件订单均必填。                       |
| 触发价类型            | -        | -    | *不支持*；无法选择触发源。                         |
| 分组订单列表          | -        | -    | *不支持*。                                         |
| OCO / OTO 订单        | -        | -    | *不支持*。                                         |
| 括号订单              | -        | -    | *不支持*。                                         |
| `CreateGroupedOrders` | -        | -    | *不支持*；订单列表使用独立交易。                   |

### 订单选项

| 选项             | 永续合约 | 现货 | 说明                                           |
| ---------------- | -------- | ---- | ---------------------------------------------- |
| `post_only`      | ✓        | ✓    | 映射到 Lighter 的只挂单有效期类型。            |
| `reduce_only`    | ✓        | -    | 直接传递给 `CreateOrder`；仅用于减少现有持仓。 |
| `quote_quantity` | -        | -    | *不支持*；请提交基础资产数量。                 |
| `display_qty`    | -        | -    | *不支持*；Lighter 不提供冰山订单显示数量字段。 |

### 适配器订单参数

| 参数                                         | 永续合约 | 现货 | 说明                                 |
| -------------------------------------------- | -------- | ---- | ------------------------------------ |
| `market_order_slippage_bps`                  | ✓        | ✓    | 覆盖市价类订单价格上限的配置默认值。 |
| 通过 `SubmitOrder.params` 设置 `post_only`   | -        | -    | *不支持*；请使用 Vibe 订单标志。     |
| 通过 `SubmitOrder.params` 设置 `reduce_only` | -        | -    | *不支持*；请使用 Vibe 订单标志。     |

### 有效期类型

| 有效期类型     | 永续合约 | 现货 | 说明                                                                 |
| -------------- | -------- | ---- | -------------------------------------------------------------------- |
| `GTC`          | ✓        | ✓    | 限价类订单使用 `GoodTillTime`；市价类订单使用 `IOC`。                |
| `DAY`          | ✓        | ✓    | 限价类和条件订单使用正数的订单到期时间。                             |
| `GTD`          | ✓        | ✓    | 提供的到期时间必须在提交后 5 分钟至 30 天之间。                      |
| `IOC`          | ✓        | ✓    | 普通 `MARKET`/`LIMIT` 使用到期时间 `0`；条件限价单使用触发到期时间。 |
| `FOK`          | -        | -    | *不支持*。                                                           |
| `AT_THE_OPEN`  | -        | -    | *不支持*。                                                           |
| `AT_THE_CLOSE` | -        | -    | *不支持*。                                                           |

适配器将 `MARKET`、`STOP_MARKET` 和 `MARKET_IF_TOUCHED` 作为 Lighter `ImmediateOrCancel` 发送；
交易场所会拒绝采用市价类 `GoodTillTime` 的订单。普通 `MARKET` 使用 `OrderExpiry = 0`，而条件市价单
在触发前保留正数到期时间。适配器会拒绝条件市价单的 Vibe `IOC`，因为 Lighter 将 IOC 留给触发后的执行。
条件限价单可以使用 `IOC`：其触发条件以正数到期时间挂起，触发后子订单使用 `ImmediateOrCancel`。

若未显式指定 GTD 到期时间，限价类 `GTC`、`DAY` 和 `GTD` 订单默认在当前时间后 28 天到期；条件
`GTC`、`DAY` 和限价类 `IOC` 也使用相同默认值。Lighter 拒绝 `-1`，接受提交后 5 分钟至 30 天的到期时间。
适配器会在留出一秒签名和传输余量的前提下强制执行该时间窗口。

### 执行指令

| 指令          | 永续合约 | 现货 | 说明                                      |
| ------------- | -------- | ---- | ----------------------------------------- |
| `post_only`   | ✓        | ✓    | 覆盖有效期类型并发送 Lighter `PostOnly`。 |
| `reduce_only` | ✓        | -    | 用于减少现有衍生品持仓的标志。            |

请对限价类订单使用 `post_only`。适配器不会合成只做挂单方的市价单。实盘主网测试已确认，
平掉永续持仓时可使用 `reduce_only=true`。无效的只减仓开仓请求可能被 Lighter 丢弃，且不提供交易场所订单报告；
适配器会将其对账为 `INFLIGHT_TIMEOUT`，而不是交易场所提供的拒绝原因。

### 高级订单功能

| 功能         | 永续合约 | 现货 | 说明                                               |
| ------------ | -------- | ---- | -------------------------------------------------- |
| 订单修改     | ✓        | ✓    | 修改活动订单的数量、价格和触发价。                 |
| 括号订单     | -        | -    | *不支持*。                                         |
| 冰山订单     | -        | -    | *不支持*。                                         |
| 追踪止损     | -        | -    | *不支持*。                                         |
| 挂钩订单     | -        | -    | *不支持*。                                         |
| TWAP 订单    | -        | -    | *不支持*；无 Vibe 映射。                           |
| 杠杆更新     | ✓        | -    | 仅限永续合约；提交已签名的 `UpdateLeverage` 交易。 |
| 原生全部取消 | -        | -    | *不支持*；适配器按金融工具限定全部取消的范围。     |
| 死人开关     | -        | -    | *不支持*。                                         |

### 订单操作

| 操作         | 永续合约 | 现货 | 说明                                                   |
| ------------ | -------- | ---- | ------------------------------------------------------ |
| 提交订单     | ✓        | ✓    | 通过 WebSocket 发送已签名的 `L2CreateOrder` 交易。     |
| 提交订单列表 | ✓        | ✓    | 依次扇出最多 15 笔独立的创建交易。                     |
| 修改订单     | ✓        | ✓    | 发送已签名的 `ModifyOrder`；报告可能再次陈述接受状态。 |
| 取消订单     | ✓        | ✓    | 发送已签名的 `L2CancelOrder` 交易。                    |
| 取消全部订单 | ✓        | ✓    | 遍历所请求金融工具的缓存未结订单。                     |
| 设置杠杆     | ✓        | -    | 仅限永续合约；提交已签名的 `UpdateLeverage` 交易。     |
| 批量取消订单 | ✓        | ✓    | 依次扇出最多 15 笔独立的取消交易。                     |
| 查询订单     | ✓        | ✓    | 需要凭证并通过 REST 查询。                             |
| 查询账户     | ✓        | ✓    | 重放最新的私有 WebSocket 账户状态。                    |
| 批量状态     | ✓        | ✓    | 限定在 WebSocket 和 REST 报告中的账户活跃市场。        |

`SubmitOrderList` 和 `BatchCancelOrders` 会按顺序签署每笔子交易，并通过按哈希关联的 WebSocket
`sendTx` 路径移交。适配器只在前一笔子交易移交完成后才分配下一个 nonce。因此，每笔交易都会得到正常的
确认、拒绝和 nonce 恢复处理。扇出操作不具备原子性：它不会创建分组的交易场所订单，也不提供 OCO/OTO
或括号订单语义。

`UpdateLeverage` 通过 `LighterExecutionClient::update_leverage(instrument_id,
initial_margin_fraction, margin_mode)` 公开。`initial_margin_fraction` 以交易场所的 tick 为单位
（比例为 1e-4）：`500` 表示 5% 初始保证金（20 倍杠杆），`1000` 表示 10%（10 倍杠杆），依此类推。

`UpdateLeverage`、`CancelAllOrders`、带集成方属性的订单修改以及条件订单创建，均按官方 Lighter v1.1.2
签名器进行字节级固定。

### 订单查询与对账

| 功能         | 永续合约 | 现货 | 说明                                        |
| ------------ | -------- | ---- | ------------------------------------------- |
| 查询未结订单 | ✓        | ✓    | 按市场限定的 REST `accountActiveOrders`。   |
| 查询订单历史 | ✓        | ✓    | 带游标分页的 REST `accountInactiveOrders`。 |
| 订单状态更新 | ✓        | ✓    | 私有 WebSocket 订单数据流和状态报告。       |
| 成交历史     | ✓        | ✓    | REST `trades`；账户历史需要凭证。           |
| 成交报告     | ✓        | ✓    | REST 和私有 WebSocket 成交载荷。            |
| 持仓报告     | ✓        | -    | 仅限永续合约；重放缓存的持仓数据流。        |
| 账户状态     | ✓        | ✓    | 重放缓存的合并账户状态快照。                |
| 批量状态     | ✓        | ✓    | 合并订单、成交和缓存持仓。                  |

已认证的非活动订单和成交分页会拒绝重复游标，并在 1,000 页后停止。成交对账在多次调用间仍可重复执行，
同时会抑制已由实时 WebSocket 数据流发出的成交。历史订单和成交报告只会将已映射的客户端索引绑定到
与其匹配的交易场所订单 ID，避免重复使用的数字索引合并无关的生命周期。

策略如果在启动后立即建仓，可能会触发短暂的持仓检查差异警告（`cached=0, venue=N`），因为交易场所的
`account_all_positions` 帧可能比对应成交事件早几毫秒到达。应用成交后警告会自行消失；不会生成对账订单。

## 账户与持仓管理

经过认证的执行客户端会订阅以下私有数据流：

- `account_all_orders`：订单状态报告。
- `account_all_trades`：成交报告。
- `account_all_positions`：持仓快照。
- `account_all_assets`：逐资产余额快照（现货余额加永续合约抵押品）。
- `user_stats`：永续账户保证金汇总（抵押品和可用余额）。

适配器将 `account_all_assets` 和 `user_stats` 合并为单一账户状态，并仅在两个数据流都交付首帧后发出该状态。

执行客户端连接前需要凭证，因为私有账户数据流和 nonce 刷新是强制要求。客户端可以在没有凭证的情况下构造，
但在 `private_key`、`account_index` 和 `api_key_index` 解析成功前不会连接实盘执行。

永续持仓使用净额模式，每个市场一个持仓；现货余额使用账户资产状态。每个 `account_all_positions` 帧都是快照：
缓存中存在但该帧遗漏的市场，或该帧中 `position` 值为零的市场，都会被平仓。空的 `positions` 映射会平掉
所有缓存持仓。无法映射或解析且持仓非零的行会继续以市场 ID 为键保存，避免产生错误的已平仓报告。

| 功能              | 永续合约 | 现货 | 说明                                               |
| ----------------- | -------- | ---- | -------------------------------------------------- |
| 账户余额          | ✓        | ✓    | 合并资产与 `user_stats`，查询时从缓存重放。        |
| 持仓快照          | ✓        | -    | 仅限永续合约；`account_all_positions` 数据流。     |
| 净额持仓          | ✓        | -    | 每个永续市场一个 Vibe 持仓。                       |
| 全仓保证金        | ✓        | -    | 直接传递 `LighterPositionMarginMode::Cross`。      |
| 逐仓保证金        | ✓        | -    | 直接传递 `LighterPositionMarginMode::Isolated`。   |
| 杠杆更新          | ✓        | -    | 已签名的 `UpdateLeverage` 交易。                   |
| 现货保证金 / 借贷 | -        | -    | *不支持*。                                         |
| 充值 / 提现       | -        | -    | 请使用交易适配器之外的交易场所工具或 Lighter API。 |

## 强平与 ADL 处理

| 事件或字段     | 支持 | 说明                                     |
| -------------- | ---- | ---------------------------------------- |
| 强平成交       | ✓    | 账户成交行可解析为成交，不产生特殊事件。 |
| 自动减仓成交   | ✓    | 账户成交行可解析为成交，不产生特殊事件。 |
| 强平价格报告   | -    | *不支持*；报告不含此字段。               |
| ADL 事件数据流 | -    | *不支持*。                               |

## 资金费率

永续合约 `market_stats` 帧会发出 `MarkPriceUpdate`、`IndexPriceUpdate` 和 `FundingRateUpdate`。
实时资金费率更新使用 `current_funding_rate` 作为下一期预估值；`funding_rate` 和 `funding_timestamp`
描述上一次已完成的支付。由于市场统计不提供未来结算时间，实时更新不会设置 `interval` 和 `next_funding_ns`。
现货 `spot_market_stats` 帧会发出 `IndexPriceUpdate`。

历史请求使用公开 `/api/v1/fundings` 中分辨率为 `1h` 的行，并设置 `interval=60`。
`direction=long` 保持为正，`short` 则转为负。分页会在适配器页数上限内覆盖请求范围，并受显式 `limit` 约束；
请参阅[速率限制](#速率限制)。不会使用账户特定的 `positionFunding`。

## 账户层级

Lighter 账户层级决定延迟、速率限制和费用。执行客户端会从 `GET /api/v1/account` 读取并记录层级，
其中也包括未知的原始 `account_type` 值。客户端不会自动提高限制，因为更高的交易场所限制需要注册 IP。

| 层级     | 延迟（挂单方 / 吃单方） | REST 加权限制   | `sendTx` 限制        | 费用（挂单方 / 吃单方）   | 说明                            |
| -------- | ----------------------- | --------------- | -------------------- | ------------------------- | ------------------------------- |
| Standard | 200 ms / 300 ms         | 60 req/min      | 60 req/min           | 0 / 0                     | 默认零费用层级。                |
| Premium  | 0 ms / 140-200 ms       | 24,000 req/min  | 4,000-40,000 req/min | 0.28-0.40 / 1.96-2.80 bps | 延迟最低；随质押 LIT 数量扩展。 |
| Plus     | 200 ms / 300 ms         | 120,000 req/min | 8,000 req/min        | 0.5 / 0.5 bps             | 提高限制，延迟仍为标准水平。    |
| Builder  | -                       | 240,000 req/min | -                    | -                         | REST 吞吐量最高。               |

Premium 数值会随质押的 LIT 数量变化，也可能发生调整。要使用更高层级，请注册调用方 IP 并显式设置配额
（参阅[速率限制](#速率限制)）。

## 速率限制

Lighter 同时限制 IP 和 L1 地址。两个客户端默认采用标准账户配额；使用更高的[账户层级](#账户层级)
需要注册 IP 并显式设置客户端配额：

- `rest_quota_per_min`：REST 读取桶的每分钟请求配额。未设置时保持 60 req/min。
  数据客户端和执行客户端均可使用。
- `sendtx_quota_per_min`：每分钟交易请求配额，在与读取分离的桶中计量。未设置时保持标准的
  60 req/min，且独立于 `rest_quota_per_min`。仅执行客户端可用。

REST 限流器每次调用计一个令牌，而不按交易场所端点权重计数。请根据实际端点组合设置
`rest_quota_per_min`：Premium 层级 24,000 加权 req/min 的限制，对于权重为 600 的端点（例如
`/api/v1/trades` 和 `/api/v1/recentTrades`）相当于每分钟 40 次调用。

交易场所会将同一账户在两种传输方式上的交易合并计入一个桶。执行客户端用单个共享限流器对 WebSocket
`sendTx`（包括订单列表和取消扇出）以及启动时集成方授权所用的 HTTP `sendTx` 强制执行
`sendtx_quota_per_min`。直接调用公开底层 HTTP `sendTxBatch` API 时也使用同一个限流器。

两个客户端按交易场所 URL 共享一个 WebSocket 消息限流器。它将两个客户端的非交易控制帧统一限制为
每分钟 200 条。闭环订阅门控将未确认请求限制为 35 个，低于交易场所每个 IP 50 条消息的上限；该计数
取决于确认延迟，而非发送速率。`sendTx` 不计入客户端消息桶。

| 范围                               | 交易场所限制                | 适配器行为                                           |
| ---------------------------------- | --------------------------- | ---------------------------------------------------- |
| REST，Standard 账户                | 60 req/min                  | 默认值；设置 `rest_quota_per_min` 可覆盖。           |
| REST，Premium 账户                 | 24,000 weighted req/min     | 会记录；设置 `rest_quota_per_min` 即可使用。         |
| REST，Plus 账户                    | 120,000 weighted req/min    | 会记录；设置 `rest_quota_per_min` 即可使用。         |
| REST，Builder 账户                 | 240,000 weighted req/min    | 会记录；设置 `rest_quota_per_min` 即可使用。         |
| `sendTx` / `sendTxBatch`，Standard | 60 req/min                  | 执行订单使用 WebSocket `sendTx`。                    |
| `sendTx` / `sendTxBatch`，Plus     | 8,000 req/min               | 设置 `sendtx_quota_per_min` 即可使用。               |
| `sendTx` / `sendTxBatch`，Premium  | 4,000-40,000 req/min        | 设置 `sendtx_quota_per_min`（随质押 LIT 数量扩展）。 |
| 默认交易类型限制                   | 40 req/min                  | 适用于成交量配额未覆盖的交易类型。                   |
| `L2UpdateLeverage` 交易限制        | 40 req/min                  | 与 `update_leverage` 相关。                          |
| 待处理订单                         | 500/account, 16/market      | 交易场所限制；适配器不预先计数。                     |
| 活跃订单                           | 1,500/account, 1,000/market | 交易场所限制；适配器不预先计数。                     |

官方文档中常见的 REST 端点权重：

| 端点组                               | 权重 | 适配器行为                                      |
| ------------------------------------ | ---- | ----------------------------------------------- |
| `sendTx`, `sendTxBatch`, `nextNonce` | 6    | 交易调用使用交易限流器；`nextNonce` 使用 REST。 |
| `accountInactiveOrders`              | 100  | 每次 HTTP 调用计一个 REST 令牌。                |
| `trades`, `recentTrades`             | 600  | 每次 HTTP 调用计一个 REST 令牌。                |
| 其他端点                             | 300  | 每次 HTTP 调用计一个 REST 令牌。                |

| 端点或传输                      | 限制       | 说明                                         |
| ------------------------------- | ---------- | -------------------------------------------- |
| `/api/v1/trades`                | 100 rows   | 适配器按此上限对对账进行分页。               |
| `/api/v1/accountInactiveOrders` | 100 rows   | 适配器按此上限跟随 `next_cursor`。           |
| `/api/v1/orderBookOrders`       | 250 levels | 快照深度被限制在交易场所上限。               |
| `/api/v1/candles`               | 500 rows   | 适配器将 REST K 线页限制在该交易场所最大值。 |
| `/api/v1/fundings`              | 100 rows   | 适配器按此交易场所上限对资金费率页进行分页。 |
| WebSocket 连接                  | 255 / IP   | 交易场所限制。                               |
| WebSocket 订阅 / 连接           | 500        | 交易场所限制。                               |
| WebSocket 唯一账户 / 连接       | 500        | 交易场所限制。                               |
| WebSocket 连接 / 分钟           | 255        | 交易场所限制。                               |
| WebSocket 客户端消息 / 分钟     | 200        | 适配器按此上限限制非交易控制帧。             |
| WebSocket 传输中消息            | 50         | 交易场所上限；订阅使用 35 帧闭环。           |
| `sendTxBatch` 批量大小          | 15 txs     | 底层 API 上限；扇出上限也是 15。             |
| WebSocket 保活                  | 2 minutes  | 适配器每 30 秒发送一次心跳。                 |
| WebSocket 出站命令队列          | Not capped | 写入前限速；无队列深度上限。                 |

历史 K 线和资金费率请求会在 500 个 REST 页面后停止。这最多覆盖 250,000 根 K 线或 49,500 个小时资金费率周期。
如果达到上限后请求范围仍有未覆盖部分，HTTP 客户端会返回 `LighterHttpError::HistoryIncomplete`，而非部分历史记录，
且不会重试已达上限的请求。在最后一个允许页面完成时仍视为成功。如果请求显式提供 `start`，并且显式 `limit`
已经满足，也仍视为成功。数据客户端会记录未完成错误且不发出响应；请缩小请求范围后继续。

## 成交量配额与无成交报价

成交量配额与传输限制相互独立。`L2CreateOrder`、`L2CancelAllOrders`、`L2ModifyOrder` 和
`L2CreateGroupedOrders` 会消耗该配额；已完成成交量和任何免费额度都会补充配额。适配器不会检查剩余配额。
当前规则和数值请参阅 Lighter 的[成交量配额](https://apidocs.lighter.xyz/docs/volume-quota-program)文档。

即使 WebSocket 和 `sendTx` 限流器正常工作，反复刷新而不成交的报价也可能耗尽该配额。实盘测试时，
应优先采用更慢的单边报价、更宽的刷新阈值、测试网，或能够获得足够成交来补充配额的有界策略。

## 连接管理

WebSocket 客户端每 30 秒发送心跳，并以 250 毫秒至 30 秒的指数退避方式重连。私有订阅使用最长 TTL
为 8 小时的认证令牌；适配器签发 7 小时令牌，每 6 小时轮换一次并重新订阅。跟踪的订阅开始重放后，
透明重连会触发新令牌和账户重新订阅。

执行客户端重连时，适配器会通过 `GET /api/v1/nextNonce` 启动 nonce 基线刷新。在此次刷新或其后台重试
为替换后的连接安装 nonce 基线之前，新的已签名交易分派都会被拒绝。

在同一会话中，交易场所确认会推进本地 nonce 窗口；确定性拒绝或移交前失败可以回滚最新 nonce；陈旧状态会触发
`GET /api/v1/nextNonce` 重新同步。可能已到达交易场所的结果会保留待处理 nonce 和订单标识，供 WebSocket
或对账恢复使用。

`LighterExecutionClient::connect()` 最多等待 30 秒，直到每个账户数据流
（`account_all_orders`、`account_all_trades`、`account_all_positions`、`account_all_assets`、
`user_stats`）都交付首帧。Lighter 没有账户或持仓状态的 REST 数据源，因此 `connect()` 会阻塞等待这些数据流，
并将其作为唯一事实依据。每次尝试都会先清除旧持仓和账户缓存，再等待当前会话的帧。透明 WebSocket 重连不会
重新进入 `connect()`：它会保留缓存持仓，直到下一个 `account_all_positions` 帧应用快照替换规则。

## API 凭证

Lighter 签名需要以下三个凭证值：

- 账户索引：数字形式的 Lighter 账户标识符。
- API 密钥索引：数字形式的 API 密钥槽位。请使用 Lighter 分配给用户创建密钥的索引，避开预留的低位索引，
  且不要使用 `255`；它是 `apikeys` 查询哨兵值，不是签名密钥。
- API 私钥：40 字节十六进制私钥，可以带或不带 `0x` 前缀。

配置值优先。如果配置字段缺失，或 API 私钥为空（空字符串或仅含空白），则回退到所选环境对应的环境变量。

| 环境   | API 密钥索引                    | API 私钥                     | 账户索引                        |
| ------ | ------------------------------- | ---------------------------- | ------------------------------- |
| 主网   | `LIGHTER_API_KEY_INDEX`         | `LIGHTER_API_SECRET`         | `LIGHTER_ACCOUNT_INDEX`         |
| 测试网 | `LIGHTER_TESTNET_API_KEY_INDEX` | `LIGHTER_TESTNET_API_SECRET` | `LIGHTER_TESTNET_ACCOUNT_INDEX` |

执行客户端会拒绝不完整的凭证。数据客户端无需凭证即可运行：其订阅和 REST 请求（金融工具、订单簿、成交、
K 线、资金费率）全部使用公开端点。

## 配置

### 数据客户端配置选项

| 选项                               | 默认值    | 说明                                         |
| ---------------------------------- | --------- | -------------------------------------------- |
| `base_url_http`                    | `None`    | 可选的 REST URL 覆盖值。                     |
| `base_url_ws`                      | `None`    | 可选的 WebSocket URL 覆盖值。                |
| `proxy_url`                        | `None`    | 可选的 HTTP 和 WebSocket 代理 URL。          |
| `environment`                      | `Mainnet` | `LighterEnvironment::Mainnet` 或 `Testnet`。 |
| `account_index`                    | `None`    | 可选的工厂字段；公开数据调用不使用。         |
| `api_key_index`                    | `None`    | 可选的工厂字段；公开数据调用不使用。         |
| `private_key`                      | `None`    | 可选的工厂字段；公开数据调用不使用。         |
| `http_timeout_secs`                | `60`      | HTTP 请求超时秒数。                          |
| `ws_timeout_secs`                  | `30`      | WebSocket 连接和重连超时。                   |
| `update_instruments_interval_mins` | `60`      | 金融工具元数据刷新间隔（分钟）。             |
| `rest_quota_per_min`               | `None`    | REST 配额覆盖值；未设置时保持 60 req/min。   |
| `transport_backend`                | Default   | WebSocket 传输后端。                         |

### 执行客户端配置选项

| 选项                        | 默认值        | 说明                                                 |
| --------------------------- | ------------- | ---------------------------------------------------- |
| `trader_id`                 | `TRADER-001`  | Vibe 交易者标识符。                                  |
| `account_id`                | `LIGHTER-001` | Vibe 在该交易场所的账户标识符。                      |
| `account_index`             | `None`        | Lighter 账户索引。                                   |
| `api_key_index`             | `None`        | Lighter API 密钥槽位。                               |
| `private_key`               | `None`        | 用于认证和 L2 交易签名的十六进制私钥。               |
| `base_url_http`             | `None`        | 可选的 REST URL 覆盖值。                             |
| `base_url_ws`               | `None`        | 可选的 WebSocket URL 覆盖值。                        |
| `proxy_url`                 | `None`        | 可选的 HTTP 和 WebSocket 代理 URL。                  |
| `environment`               | `Mainnet`     | `LighterEnvironment::Mainnet` 或 `Testnet`。         |
| `http_timeout_secs`         | `60`          | HTTP 请求超时秒数。                                  |
| `ws_timeout_secs`           | `30`          | WebSocket 连接和重连超时。                           |
| `market_order_slippage_bps` | `50`          | `MARKET` / `STOP_MARKET` / `MIT` 的滑点上限（bps）。 |
| `rest_quota_per_min`        | `None`        | REST 配额覆盖值；未设置时保持 60 req/min。           |
| `sendtx_quota_per_min`      | `None`        | 交易配额覆盖值；未设置时保持 60 req/min。            |
| `transport_backend`         | Default       | WebSocket 传输后端。                                 |

### 配置示例

```rust
use vibe_lighter::{
    common::enums::LighterEnvironment,
    config::{LighterDataClientConfig, LighterExecClientConfig},
};

let data_config = LighterDataClientConfig::builder()
    .environment(LighterEnvironment::Testnet)
    .build();

let exec_config = LighterExecClientConfig::builder()
    .trader_id(trader_id)
    .account_id(account_id)
    .environment(LighterEnvironment::Testnet)
    .build();
```

执行配置会从匹配的测试网环境变量解析凭证；直接设置其凭证字段即可覆盖这些变量。使用
`LiveExecEngineConfig.reconciliation_instrument_ids` 限定对账范围，并使用
`reconciliation_lookback_mins` 限定非活动订单和成交重放的回溯时间。

## 官方文档

- 入门：<https://apidocs.lighter.xyz/docs/get-started>
- 交易与签名：<https://apidocs.lighter.xyz/docs/trading>
- API 密钥：<https://apidocs.lighter.xyz/docs/api-keys>
- 速率限制：<https://apidocs.lighter.xyz/docs/rate-limits>
- 成交量配额：<https://apidocs.lighter.xyz/docs/volume-quota-program>
- 数据结构、常量和错误：<https://apidocs.lighter.xyz/docs/data-structures-constants-and-errors>
- REST OpenAPI：<https://raw.githubusercontent.com/elliottech/lighter-python/main/openapi.json>
- WebSocket 参考：<https://apidocs.lighter.xyz/docs/websocket-reference>

## 贡献

:::info
如需添加功能或为 Lighter 适配器贡献代码，请参阅我们的
[贡献指南](https://github.com/qOeOp/trade/blob/main/CONTRIBUTING.md)。
:::
