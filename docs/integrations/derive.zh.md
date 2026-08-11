# Derive

Derive（原 Lyra）是一个去中心化衍生品交易场所，提供欧式期权和现金结算永续掉期，也是最大的链上期权市场之一。交易通过 Derive Chain 上每位用户自己的智能合约钱包进行，因此抵押品由用户保管，而订单通过交易场所的订单簿撮合。

Derive Chain 是结算到 Ethereum 的乐观汇总。订单在链下撮合、链上结算，将订单簿执行与自主托管相结合。订单使用限定到子账户的会话密钥生成 EIP-712 类型化数据签名进行授权，使签名密钥与钱包所有者分离，并允许用户在不转移资金的情况下轮换或撤销访问权限。

## 示例

Rust 测试器示例位于 [`crates/adapters/derive/examples/`](https://github.com/qOeOp/trade/tree/main/crates/adapters/derive/examples/)。

## 概述

Derive 适配器使用 Rust 实现，位于 `crates/adapters/derive`。它公开：

- `DeriveHttpClient`：连接 `api.lyra.finance`（主网）或 `api-demo.lyra.finance`（测试网）的底层 REST。
- `DeriveWebSocketClient`：带订阅跟踪、重连和签名订单输入的 JSON-RPC WebSocket 传输（WebSocket Trading API）。
- `DeriveInstrumentProvider`：逐货币获取和缓存金融工具。
- `DeriveDataClient`：实盘市场数据客户端。
- `DeriveDataClientFactory`：实盘节点 builder 的数据客户端工厂。
- `DeriveExecutionClient`：用于签名订单、取消、查询和报告流程的实盘执行客户端。
- `DeriveExecutionClientFactory`：实盘节点 builder 的执行客户端工厂。

执行流程针对 Derive Chain 的逐操作模块合约使用 EIP-712 类型化数据签名。

## Derive 文档

Derive 在 [docs.derive.xyz](https://docs.derive.xyz) 发布 API 文档。请结合本指南查阅以了解更多详情。

## 产品

| 产品类型          | 支持 | 备注                                                           |
| ----------------- | ---- | -------------------------------------------------------------- |
| ERC-20 现货       | ✓    | 以 USDC 计价的交易对，例如 `ETH-USDC`；解析为 `CurrencyPair`。 |
| 永续掉期          | ✓    | 以 USDC 现金结算，逐货币上市，例如 `ETH-PERP`。                |
| 期权（看涨/看跌） | ✓    | 使用 `{CURRENCY}-{EXPIRY}-{STRIKE}-{C\|P}` 的欧式期权。        |

## 符号体系

Derive 金融工具使用交易场所原生符号，并带 `.DERIVE` 后缀：

- 现货：`ETH-USDC.DERIVE`（基础货币、计价货币）。
- 永续合约：`ETH-PERP.DERIVE`、`BTC-PERP.DERIVE`。
- 期权：`ETH-20260626-3000-C.DERIVE`（货币、到期日、行权价、类别）。

符号中以连字符分隔的第一段是标的货币。提供商会按货币各获取一次 `public/get_instruments`，因此启用 `auto_load_missing_instruments`（默认）时，订阅新货币会触发延迟 REST 获取。

适配器根据交易场所 `instrument_type`（`perp`、`option`、`erc20`）路由，而不是根据符号后缀，因此现货交易对不需要特殊符号解析。现货复用永续合约和期权所用的 Trade 模块签名路径；仓库内 `crates/adapters/derive/test_data/spot/` 下的 fixture 捕获了解析器和执行路径所固定的现货金融工具、订单簿、ticker 和成交字段结构。

:::warning
现货交易的实盘验证少于永续合约和期权。测试网可按 `0.1 ETH` 最小数量接受并取消被动 `ETH-USDC` 限价单，主网也已手动验证下单/取消。公开现货成交频道（`trades.erc20.ETH`、`trades.ETH-USDC`）可成功订阅，但成交量可能较低，因此成交帧会很稀疏。
:::

## 环境

在任一客户端配置上使用 `DeriveEnvironment` 枚举配置环境。

| 环境   | 配置                         | REST                            | WebSocket                        |
| ------ | ---------------------------- | ------------------------------- | -------------------------------- |
| 主网   | `DeriveEnvironment::Mainnet` | `https://api.lyra.finance`      | `wss://api.lyra.finance/ws`      |
| 测试网 | `DeriveEnvironment::Testnet` | `https://api-demo.lyra.finance` | `wss://api-demo.lyra.finance/ws` |

测试网是一条独立链，具有自己的会话密钥和余额；主网与测试网 API 密钥不可互换。公开市场数据（订单簿、ticker、成交）不需要凭据。

两个网络的 EIP-712 协议常量（`DOMAIN_SEPARATOR`、`ACTION_TYPEHASH`、逐操作模块地址）随 `crates/adapters/derive/src/common/consts.rs` 提供，并根据 Derive 的[协议常量参考](https://docs.derive.xyz/reference/protocol-constants)进行跟踪。`DeriveExecClientConfig::domain_separator`、`action_typehash` 和 `trade_module_address` 接受优先于内置值的逐实例覆盖。

## 测试网上线准备

Derive 在 Web 应用中将演示环境称为"testnet"，在 API 主机名中称为"demo"。本指南使用"测试网"，以匹配控制面板和 `DeriveEnvironment::Testnet` 枚举。要使执行客户端能够提交签名订单，请执行以下步骤：

1. **登录测试网控制面板。** 打开 [testnet.derive.xyz](https://testnet.derive.xyz)，连接 EVM 钱包（MetaMask、WalletConnect、社交登录等）。这是为下述智能合约钱包授权的所有者 EOA。
2. **注册 Derive Chain 智能合约钱包。** 首次登录会在 Derive 测试网链上为每位用户部署智能合约钱包。"Developers" -> "Derive Wallet" 下显示的地址是客户端使用的 `wallet_address`（也是 `X-LYRAWALLET` 标头）。它不同于刚连接的 EOA。
3. **创建子账户。** 在钱包下创建子账户（Standard Margin 是测试交易最简单的模式）。整数 ID 即客户端为每个 `private/order` 请求签名时使用的 `subaccount_id`。
4. **生成会话密钥。** 在"Developers" -> "Session Keys"下创建限定到该子账户的会话密钥，并复制原始 secp256k1 私钥。这是 `session_key` 值；它不会离开客户端，并会从 `Debug` 输出中隐去。会话密钥可在同一面板轮换或撤销。
5. **通过水龙头为子账户注资。** 测试网控制面板提供发放测试抵押品的 USDC 水龙头。存入子账户，使链上余额显示非零抵押品；在子账户对请求数量具有足够保证金之前，API 会拒绝订单。
6. **设置环境变量。** 导出客户端在测试网模式下读取的三个值（也可通过 `DeriveExecClientConfig` 传入，配置字段优先）：

   ```bash
   export DERIVE_TESTNET_WALLET_ADDRESS="0x..."  # Derive Chain smart-contract wallet
   export DERIVE_TESTNET_SESSION_PRIVATE_KEY="0x..."  # secp256k1 session-key private key
   export DERIVE_TESTNET_SUBACCOUNT_ID="12345"  # integer subaccount id
   ```

### 最低资金

交易场所没有固定最低值。撮合引擎接受满足结果持仓初始保证金要求的任何订单。以下可作为最小可行测试的实用下限：

- **冒烟测试（提交并取消，不成交）：** 任何正 USDC 余额都足以验证签名订单管线。
- **往返完成一笔 `ETH-PERP` 成交：** 应为最坏情况下经滑点调整的名义价值加初始保证金缓冲预留资金。按一份合约 $3500、交易场所约 10% IM 计算，约需 $350 抵押品加 $400 缓冲。约 $1000 USDC 是首次成交测试较为充裕的可用余额。
- **期权：** 期权的 IM 高于永续合约。对该期权调用 `public/get_instrument`，将合约大小乘以标记价格，再加上期权专用 IM（可在金融工具响应中查看），然后确定存款规模。

注资后，使用 `private/get_subaccount` 端点确认 `initial_margin`/`maintenance_margin` 相对于计划提交订单具有足够余量；适配器的 `query_account` 命令会将此快照作为 `AccountState` 事件发出，使策略层能据此决定是否交易。

## 主网上线准备

主网上线流程与测试网相同，但使用生产控制面板和真实资金。

1. **登录主网控制面板。** 打开 [derive.xyz](https://derive.xyz)，连接 EVM 所有者钱包（MetaMask、WalletConnect、社交登录等）。首次登录会部署 Derive Chain 智能合约钱包。
2. **复制钱包地址。** 在"Developers" -> "Derive Wallet"下复制智能合约钱包地址。这是客户端签名所针对的 `wallet_address`；它与登录所用 EOA **不同**。在 Derive Chain 浏览器中验证该地址包含合约代码（EOA 没有）。
3. **创建或选择子账户。** 在钱包下创建子账户（Standard Margin 是最简单的模式；只有理解跨保证金语义后再切换到 Portfolio Margin）。整数 ID 即 `subaccount_id`。
4. **生成主网会话密钥。** 在"Developers" -> "Session Keys"下创建限定到该子账户的会话密钥，并复制原始 secp256k1 私钥。可在同一面板轮换或撤销会话密钥；探索性测试器运行应优先使用短期密钥。
5. **为子账户注资。** 通过控制面板的存款流程将 USDC（或支持的抵押品）存入子账户。提交前通过 `private/get_subaccount`（或适配器的 `query_account`）确认 `collaterals_value` 和 `initial_margin` 余量足以覆盖目标订单。
6. **设置环境变量。** 导出三个主网值（也可通过 `DeriveExecClientConfig` 传入，配置字段优先）：

   ```bash
   export DERIVE_WALLET_ADDRESS="0x..."  # Derive Chain smart-contract wallet
   export DERIVE_SESSION_PRIVATE_KEY="0x..."  # secp256k1 session-key private key
   export DERIVE_SUBACCOUNT_ID="12345"  # integer subaccount id
   ```

   三个 Rust 示例（`node_data_tester`、`node_exec_tester`、`node_delta_neutral`）都使用
   `const DERIVE_ENVIRONMENT: DeriveEnvironment =
   DeriveEnvironment::Testnet;` literal; flip it to `DeriveEnvironment::Mainnet` 用于
   真实资金运行。生产部署通过
   `DeriveDataClientConfig::environment` / `DeriveExecClientConfig::environment` 选择网络。

## 能力

### 市场数据

| 能力                     | 支持 | 备注                                                    |
| ------------------------ | ---- | ------------------------------------------------------- |
| 请求金融工具（REST）     | ✓    | `public/get_instrument`；将一个金融工具载入本地缓存。   |
| 请求所有金融工具（REST） | ✓    | `public/get_instruments`；保留每种货币的有效行。        |
| 金融工具订阅             | -    | *不支持。* 使用配置的 REST 刷新间隔。                   |
| 订单簿增量（L2_MBP）     | ✓    | 频道：`orderbook.{instrument}.{group}.{depth}`。        |
| 订单簿 depth10（L2_MBP） | ✓    | 同一订单簿频道，使用 `depth=10`。                       |
| 按间隔的订单簿           | -    | *不支持。* 在本地根据增量维护间隔订单簿。               |
| 订单簿快照（REST）       | -    | *不支持。* 适配器未公开。                               |
| 历史订单簿增量（REST）   | -    | *不支持。* 适配器未公开。                               |
| 报价（`ticker_slim`）    | ✓    | 频道：`ticker_slim.{instrument}.{interval}`。           |
| 报价快照（REST）         | ✓    | 单次 `public/get_tickers`；发出一个 `QuoteTick`。       |
| 历史报价（REST）         | -    | *不支持。* 交易场所只公开 ticker 快照。                 |
| 成交                     | ✓    | 频道：`trades.{instrument_type}.{currency}`。           |
| 历史成交（REST）         | ✓    | 按时间排序并去重；`limit` 保留最新成交。                |
| K 线/OHLC（REST）        | ✓    | 已收盘的分钟、小时、日和周 K 线，时间戳位于周期结束。   |
| K 线/OHLC（WS）          | -    | *不支持。* 交易场所没有蜡烛图订阅频道。                 |
| 标记价格流               | ✓    | 从 `ticker_slim` 派生；共享报价订阅。                   |
| 指数价格流               | ✓    | 从 `ticker_slim` 派生；共享报价订阅。                   |
| 资金费率流               | ✓    | 从永续合约 ticker 的 `perp_details.funding_rate` 派生。 |
| 资金费率历史（REST）     | ✓    | 永续合约按时间排序；`limit` 保留最新有效行。            |
| 金融工具状态             | -    | *不支持。* Ticker payload 包含 `is_active`。            |
| 金融工具关闭             | -    | *不支持。* 期权结算仅支持 REST。                        |
| 期权 Greeks              | ✓    | 从期权 ticker 上的 `option_pricing` 派生。              |
| 期权链                   | ✓    | 从报价和 Greeks 聚合；`public/get_tickers` 引导 ATM。   |

`request_instrument` 为请求的 `InstrumentId` 调用 `public/get_instrument`，缓存返回的定义后再发出响应。缓存的金融工具包含后续报价、成交、订单簿和 K 线解析所需的精度与增量字段。

金融工具加载将交易场所错误 `12001` 视为受影响产品类型的空结果，因此某种货币没有永续合约、期权或现货上市时，不会阻止其他产品。无效金融工具行会记录并跳过，有效行则继续加载。

历史请求使用 `public/get_trade_history`、`public/get_tradingview_chart_data` 和 `public/get_funding_rate_history`。K 线 `end` 边界仍由交易场所以周期开始时间选择。响应会省略收盘时间晚于请求时间的所有周期，包括交易场所返回的仍在形成中的周期。

Derive 通过同一 `orderbook.{instrument}.{group}.{depth}` 频道系列公开订单簿增量和 depth10 快照。`subscribe_book_deltas` 将快照增量发布为 `OrderBookDeltas`，而 `subscribe_book_depth10` 固定 `depth=10` 并发布 `OrderBookDepth10` 快照。

### 执行

下单、取消、修改、查询和报告生成使用 Derive 的 EIP-712 自主托管签名流程。订单输入写操作（`private/order`、`private/cancel`、`private/cancel_all`、`private/replace`）通过 WebSocket Trading API 发送，使用的认证会话同时通过私有频道（`{subaccount_id}.orders`、`{subaccount_id}.trades`、`{subaccount_id}.balances`）流式传输账户、订单、成交和余额状态。无论传输方式如何，签名 EIP-712 正文都相同。

:::note
HTTP 订单输入端点仍可通过 `DeriveHttpClient` 用于工具和测试，但实盘执行客户端通过 WebSocket Trading API 路由所有写操作。报告生成、账户刷新和金融工具查询仍使用 REST。
:::

永续合约、期权和 ERC-20 现货交易对都使用 Derive Trade 模块。现货没有单独的签名路径；除下述仅减仓保护外，对账对待现货金融工具的方式与其他金融工具类别相同。

适配器支持普通 `private/order` 请求：采用 `GTC`、`IOC` 或 `FOK` 有效期的 `LIMIT` 和 `MARKET` 订单。它还支持下表列出的 Vibe 原生止损和触价订单类型所对应的 Derive 触发订单。不支持的 Vibe 订单类型会在签名前被拒绝，因此无法在交易场所成交。

市价单提交前需要缓存的报价。异步提交任务解析金融工具后，会刷新当前 ticker 快照，并根据该刷新报价推导带签名滑点边界的 `limit_price`。

#### 条件订单

Derive 触发订单使用仅限 WebSocket 的 `private/trigger_order` 端点，而非普通 `private/order` 端点。交易场所以 `order_status=untriggered` 存储订单，直到触发 worker 提交签名子订单。因此，对账会同时读取 `private/get_open_orders` 和 `private/get_trigger_orders`。

Derive 主网要求触发订单签名在交易场所时间的 30 至 90 天后到期。适配器以固定 31 天到期时间签署触发订单；`signature_expiry_secs` 仍控制普通 `private/order` 和 `private/replace` 写操作，且必须大于交易场所最低值 300s。

| Vibe 订单类型     | 支持 | Derive `order_type` | Derive `trigger_type` | 备注                   |
| ----------------- | ---- | ------------------- | --------------------- | ---------------------- |
| `StopMarket`      | ✓    | `market`            | `stoploss`            | 使用触发价格作为边界。 |
| `StopLimit`       | ✓    | `limit`             | `stoploss`            | 发送限价和触发价格。   |
| `MarketIfTouched` | ✓    | `market`            | `takeprofit`          | 使用触发价格作为边界。 |
| `LimitIfTouched`  | ✓    | `limit`             | `takeprofit`          | 发送限价和触发价格。   |
| `MarketToLimit`   | -    | -                   | -                     | *Derive 不支持*。      |
| 追踪止损          | -    | -                   | -                     | *Derive 不支持*。      |
| TWAP / algo / RFQ | -    | -                   | -                     | *此适配器未公开*。     |

适配器将 Vibe `TriggerType::Default` 和 `TriggerType::MarkPrice` 映射到 Derive `trigger_price_type=mark`。Derive 当前错误代码参考指出，尚不支持指数和最新成交触发价格类型，因此 `IndexPrice`、`LastPrice`、`BidAsk` 及其他触发价格类型会在签名前于本地被拒绝。

Derive 错误 `11054` 表示触发订单不能替换或被替换。因此，适配器会以 `OrderModifyRejected` 事件拒绝针对触发订单的 Vibe 修改请求；更新触发订单时应取消并重新提交。

Derive 会验证触发价格方向，并以错误 `11051` 拒绝未按预期方向越过当前价格的触发价格。触发价格在签名时固定，因此快速变动或高价金融工具上的紧密偏移可能在交易场所收到订单前漂移到错误一侧。触发偏移应明显超过提交期间的预期价格变动（对于 `ETH-PERP`，应为数十美元而非几美分）；过紧偏移会导致虚假的 `11051` 拒绝。

#### 执行指令

| 指令          | 支持 | Derive 值     | 备注                                                 |
| ------------- | ---- | ------------- | ---------------------------------------------------- |
| `post_only`   | ✓    | `post_only`   | 要求 `GTC`；如果订单会获取流动性则拒绝。             |
| `reduce_only` | ✓    | `reduce_only` | 永续合约和期权，仅限市价或 `IOC`/`FOK`；现货被否决。 |

#### 有效期

Derive 将 `gtc`、`post_only`、`fok` 和 `ioc` 记录为其 `time_in_force` 值。适配器会在签名前拒绝没有 Derive 等价项的 Vibe 值。Derive 将仅做挂单公开为 `time_in_force` 值，因此 `post_only` 不能与 `IOC` 或 `FOK` 结合。

| 有效期         | 支持 | Derive 值 | 备注              |
| -------------- | ---- | --------- | ----------------- |
| `GTC`          | ✓    | `gtc`     | 撤销前有效。      |
| `IOC`          | ✓    | `ioc`     | 立即成交或取消。  |
| `FOK`          | ✓    | `fok`     | 全部成交或取消。  |
| `GTD`          | -    | -         | *Derive 不支持*。 |
| `DAY`          | -    | -         | *Derive 不支持*。 |
| `AT_THE_OPEN`  | -    | -         | *Derive 不支持*。 |
| `AT_THE_CLOSE` | -    | -         | *Derive 不支持*。 |

#### 现货仅减仓订单

Derive 现货没有持仓概念，因此仅减仓现货订单永远无法减少任何持仓。交易场所始终以错误 `11025` 拒绝；适配器在知道金融工具是现货时会避免这次往返。缓存的现货金融工具以 `OrderDenied` 否决；延迟解析的现货金融工具在提交期间以 `OrderRejected` 拒绝。

永续合约和期权的仅减仓订单仍会到达交易场所，其结果取决于子账户持仓状态。`derive-flatten` bin 只关闭衍生品持仓，绝不处理现货，因为平掉现货余额会把基础资产卖成不同的计价资产。

Derive 只对市价单或非挂单限价单（`IOC`/`FOK`）接受 `reduce_only`。带 `reduce_only` 的挂单 `GTC` 或仅做挂单限价单会被交易场所以错误 `11024 Reduce only not supported with this time in force` 拒绝。因此，止盈腿为仅减仓 `GTC` 限价单的 Vibe 括号订单无法在 Derive 挂单：入场腿和止损腿会提交，但止盈腿会被拒绝。针对 Derive 时，请使用仅减仓 `IOC`/`FOK` 平仓，或使用非仅减仓止盈单。

#### 订单拒绝语义

状态变更写操作（`submit_order`、`modify_order`、`cancel_order`）通过 WebSocket Trading API 发送一次，不会重放。适配器根据 WebSocket 请求结果区分终态和结果不明确的处理。对于明确的交易场所失败，它会发出终态拒绝事件（`OrderRejected`、`OrderModifyRejected`、`OrderCancelRejected`）：

- 签名操作拒绝，例如参数无效、保证金不足或订单未知。
- 交易场所业务代码，例如 `11009 Zero liquidity`。
- 仅做挂单穿价拒绝（`11008 Post only order cannot cross the market`），报告为 `due_post_only=true` 的 `OrderRejected`。
- 速率限制响应（`-32000 Rate limit exceeded`），即网关在撮合引擎看到请求前将其拒绝。
- 成功的 `private/cancel_by_label` 响应中 `cancelled_orders == 0`，表示没有未结订单匹配客户端订单 ID 标签。

对于其他 `cancelled_orders` 值，适配器不会发出终态事件，而会等待交易场所订单通知或后续对账来确定状态。

对于到达交易场所的仅做挂单订单，Derive 会以 JSON-RPC `11008` 和消息 `Post only order cannot cross the market` 拒绝穿价订单。适配器会将该终态拒绝标记为 `due_post_only=true`；如果 WebSocket/订单报告拒绝携带相同原因，跟踪订单路径也会应用相同分类。对于不支持的仅做挂单 IOC/FOK 组合，本地拒绝不会标记 `due_post_only`，因为它不代表交易场所穿价拒绝。

对于结果不明确的写操作，适配器不会发出终态事件，而由 WebSocket 对账或后续状态报告确定状态。结果不明确的集合刻意限定为：

- `-32603`，通用 JSON-RPC 内部错误。
- 无法解码的响应（操作可能已处理）。
- 请求超时、重连时响应丢失和传输错误。

这种区分可保护订单生命周期的两端。虚假终态拒绝会使引擎将实盘订单视为已拒绝；虚假的结果不明确状态则可能让未下出的订单永远停留在 `Submitted`，因为不会有 WebSocket 帧到达。

## 订阅参数

`subscribe_book_deltas` 和 `subscribe_book_depth10` 接受以下 `subscribe_params` 键：

| 键      | 类型   | 默认值 | 允许值                         |
| ------- | ------ | ------ | ------------------------------ |
| `group` | string | `"1"`  | `"1"`, `"10"`, `"100"`         |
| `depth` | string | `"10"` | `"1"`, `"10"`, `"20"`, `"100"` |

`subscribe_quotes` 接受：

| 键         | 类型   | 默认值   | 允许值            |
| ---------- | ------ | -------- | ----------------- |
| `interval` | string | `"1000"` | `"100"`, `"1000"` |

未知值会在订阅时被拒绝。

### 共享 ticker 订阅

报价、标记价格、指数价格、资金费率和期权 Greeks 都派生自同一个 `ticker_slim.{instrument}.{interval}` WebSocket 订阅。适配器会对底层 WS 订阅调用进行引用计数：某个金融工具订阅的第一个数据源打开频道，最后一个取消订阅则关闭频道。因此，第一个订阅的 `interval` 优先；之后以不同间隔订阅的数据源共享现有频道。

标记价格、指数价格、资金费率和期权 Greeks 从 ticker payload 读取字段。完整 ticker 结构和紧凑 `SlimEnvelope` 结构都携带这些字段，因此派生数据源适用于二者：`mark_price` 和 `index_price` 是必填项（缺少它们的帧会反序列化失败并记录日志，而非静默丢弃），`funding_rate` 和 `option_pricing` 则是可选项，仅存在于相应金融工具类别中。报价数据源始终有效，因为两种结构都包含 bid/ask。

资金费率只对永续合约有意义，期权 Greeks 只对期权有意义。为错误金融工具类别订阅数据源（例如为期权订阅资金费率）会被接受并打开 WebSocket 订阅，但解析器不会为该数据源返回事件，因为交易场所 payload 缺少相关字段（非永续合约缺少 `perp_details`，非期权缺少 `option_pricing`）。订阅衍生品专用数据源前，请验证金融工具类别。

## 配置

### 数据客户端配置选项

类/结构体：`DeriveDataClientConfig`。

| 选项                               | 默认值    | 说明                                               |
| ---------------------------------- | --------- | -------------------------------------------------- |
| `base_url_rest`                    | `None`    | 覆盖 REST 基础 URL。                               |
| `base_url_ws`                      | `None`    | 覆盖 WebSocket 基础 URL。                          |
| `proxy_url`                        | `None`    | HTTP 和 WebSocket 传输的可选代理 URL。             |
| `environment`                      | `Mainnet` | 网络选择器（Python 中为 `MAINNET` 或 `TESTNET`）。 |
| `http_timeout_secs`                | `10`      | REST 请求超时秒数。                                |
| `ws_timeout_secs`                  | `30`      | WebSocket 连接和空闲超时秒数。                     |
| `update_instruments_interval_mins` | `60`      | 金融工具刷新间隔分钟数。                           |
| `currencies`                       | `[]`      | 连接时批量加载的货币。空值表示按需延迟加载。       |
| `include_expired`                  | `false`   | 包含 `public/get_instruments` 返回的已到期期权行。 |
| `auto_load_missing_instruments`    | `true`    | 在订阅或请求命令前延迟加载未知金融工具。           |
| `transport_backend`                | `Sockudo` | 启用 `transport-sockudo` 时使用的 WebSocket 传输。 |

### 执行客户端配置选项

类/结构体：`DeriveExecClientConfig`。

| 选项                               | 默认值    | 说明                                                                                                    |
| ---------------------------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| `wallet_address`                   | `None`    | Derive Chain 智能合约钱包地址。回退到下列环境变量。                                                     |
| `session_key`                      | `None`    | secp256k1 会话密钥私钥。回退到下列环境变量。                                                            |
| `subaccount_id`                    | `None`    | Derive 子账户 ID。回退到下列环境变量。                                                                  |
| `base_url_rest`                    | `None`    | 覆盖 REST 基础 URL。                                                                                    |
| `base_url_ws`                      | `None`    | 覆盖 WebSocket 基础 URL。                                                                               |
| `proxy_url`                        | `None`    | HTTP 和 WebSocket 传输的可选代理 URL。                                                                  |
| `environment`                      | `Mainnet` | 网络选择器（Python 中为 `MAINNET` 或 `TESTNET`）。                                                      |
| `http_timeout_secs`                | `10`      | REST 请求超时秒数。                                                                                     |
| `max_retries`                      | `3`       | 可恢复读取和明确非写入路径的重试次数。                                                                  |
| `retry_delay_initial_ms`           | `100`     | 初始重试延迟毫秒数。                                                                                    |
| `retry_delay_max_ms`               | `5000`    | 最大重试延迟毫秒数。                                                                                    |
| `max_fee_per_contract`             | 必填      | 签入每个订单的正数逐合约 USDC 费用上限。                                                                |
| `domain_separator`                 | `None`    | 可选 EIP-712 domain separator 覆盖。                                                                    |
| `action_typehash`                  | `None`    | 可选 EIP-712 action typehash 覆盖。                                                                     |
| `trade_module_address`             | `None`    | 可选 Trade 模块合约地址覆盖。                                                                           |
| `signature_expiry_secs`            | `600`     | 订单/替换 TTL；必须 >300s。触发订单使用固定 31 天 TTL。                                                 |
| `market_order_slippage_bps`        | `50`      | 市价单限价的滑点边界。                                                                                  |
| `max_matching_requests_per_second` | `None`    | 每秒最大撮合引擎写请求数（创建/取消/替换）。未设置时默认为 Trader 等级限制 1；Market Maker 账户可提高。 |
| `transport_backend`                | `Sockudo` | 启用 `transport-sockudo` 时使用的 WebSocket 传输。                                                      |

构建禁用 `transport-sockudo` feature 时，默认传输会回退到 `Tungstenite`。

未设置时，`wallet_address`、`session_key` 和 `subaccount_id` 会回退到环境变量：

| 字段             | 主网变量                     | 测试网变量                           |
| ---------------- | ---------------------------- | ------------------------------------ |
| `wallet_address` | `DERIVE_WALLET_ADDRESS`      | `DERIVE_TESTNET_WALLET_ADDRESS`      |
| `session_key`    | `DERIVE_SESSION_PRIVATE_KEY` | `DERIVE_TESTNET_SESSION_PRIVATE_KEY` |
| `subaccount_id`  | `DERIVE_SUBACCOUNT_ID`       | `DERIVE_TESTNET_SUBACCOUNT_ID`       |

会话密钥是注册到钱包、用于 API 签名的 secp256k1 私钥。`session_key` 字段会从 `Debug` 输出和 Python `repr` 中隐去。

### Python 实盘节点

Python 节点使用 `LiveNode.builder(...)` 并传入具体工厂实例。执行工厂需要 `DeriveExecFactoryConfig`，它使用底层 `DeriveExecClientConfig` 包装 trader 和 account 标识符。

```python
from decimal import Decimal

from vibe_trader.adapters.derive import DeriveDataClientConfig
from vibe_trader.adapters.derive import DeriveDataClientFactory
from vibe_trader.adapters.derive import DeriveEnvironment
from vibe_trader.adapters.derive import DeriveExecClientConfig
from vibe_trader.adapters.derive import DeriveExecFactoryConfig
from vibe_trader.adapters.derive import DeriveExecutionClientFactory
from vibe_trader.common import Environment
from vibe_trader.live import LiveNode
from vibe_trader.model import AccountId
from vibe_trader.model import TraderId

trader_id = TraderId("TESTER-001")

data_config = DeriveDataClientConfig(
    environment=DeriveEnvironment.TESTNET,
    currencies=["ETH", "BTC"],
)

exec_config = DeriveExecClientConfig(
    environment=DeriveEnvironment.TESTNET,
    max_fee_per_contract=Decimal("1000"),
)

exec_factory_config = DeriveExecFactoryConfig(
    trader_id,
    AccountId("DERIVE-001"),
    exec_config,
)

node = (
    LiveNode.builder("DERIVE-001", trader_id, Environment.LIVE)
    .add_data_client(None, DeriveDataClientFactory(), data_config)
    .add_exec_client(None, DeriveExecutionClientFactory(), exec_factory_config)
    .build()
)
```

不要将 `DeriveExecClientConfig` 直接传给 `add_exec_client`；Derive 执行工厂需要包装后的 `DeriveExecFactoryConfig`，以使用正确的 trader 和 account 标识符创建 `ExecutionClientCore`。

### Rust 数据客户端

```rust
use vibe_derive::{
    common::enums::DeriveEnvironment,
    config::DeriveDataClientConfig,
};

let config = DeriveDataClientConfig {
    environment: DeriveEnvironment::Testnet,
    currencies: vec!["ETH".to_string(), "BTC".to_string()],
    ..Default::default()
};
```

重要字段：

- `currencies`：连接时批量加载哪些货币。空值表示每次订阅时延迟加载。
- `include_expired`：包含 `public/get_instruments` 返回的已到期期权行。
- `auto_load_missing_instruments`：金融工具未知时，在订阅时延迟加载。
- `update_instruments_interval_mins`：REST 刷新间隔（默认 60 分钟）。
- `http_timeout_secs`、`ws_timeout_secs`：传输超时。

### Rust 执行客户端

```rust
use vibe_derive::{
    common::enums::DeriveEnvironment,
    config::DeriveExecClientConfig,
};
use rust_decimal::Decimal;

let config = DeriveExecClientConfig {
    wallet_address: Some("0x...".to_string()),
    session_key: Some("0x...".to_string()),
    subaccount_id: Some(1),
    environment: DeriveEnvironment::Testnet,
    max_fee_per_contract: Some(Decimal::from(1000)),
    ..Default::default()
};
```

`max_fee_per_contract` 为必填项且必须大于零。该字段缺失或非正数时，执行客户端构造会在创建交易场所客户端之前失败。

## 已知限制

- `request_instruments` 要求在 `DeriveDataClientConfig::currencies` 中至少配置一种货币；交易场所的 `public/get_instruments` 端点按货币限定，适配器不会枚举货币全集。
- `data_client.rs` 集成测试断言记录的 REST 调用集合而非顺序，因为 `fetch_instrument_definitions` 通过 `tokio::try_join!` 并行发出 `perp` 和 `option` 请求。
- 交易场所不推送金融工具状态、金融工具关闭或蜡烛图订阅；ticker payload 携带保证金参数和 `is_active`，K 线仅支持 REST。
- 交易场所不公开订单簿快照 REST 端点、历史订单簿增量或历史报价端点。参见上方能力表。
- 截至 2025 年 12 月 1 日，Derive 官方 REST 文档已将 `public/get_ticker` 标记为弃用，改用 `public/get_tickers`。适配器使用 `public/get_tickers` 获取报价快照并引导期权链远期价格。
