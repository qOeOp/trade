# Polymarket

Polymarket 成立于 2020 年，是一个去中心化预测市场平台，交易者可通过买卖结果代币对事件结果进行投机。

VibeTrader 通过 Polymarket 中央限价订单簿（CLOB）API 提供数据和执行集成。

适配器使用 Rust 实现，并通过 `vibe_trader.adapters.polymarket` 向 Python 公开；因此 Rust 和 Python 的数据、执行、签名及 WebSocket 操作行为一致。

VibeTrader 支持多种 Polymarket 订单签名类型，可灵活适配不同钱包配置，并由 VibeTrader 处理签名和订单准备。

## 安装

Python 包已包含 Polymarket 适配器，无需安装适配器专用额外依赖。

安装最新预发布构建：

```bash
uv pip install --pre vibe_trader
```

从源代码构建 Python 包时，在仓库根目录运行：

```bash
make build-debug
```

有关开发 wheel 和源代码构建前置条件，请参阅[安装指南](../getting_started/installation.md)。

## 示例

维护中的 Rust 示例位于 [`crates/adapters/polymarket/examples`](https://github.com/qOeOp/trade/tree/main/crates/adapters/polymarket/examples)。Python 可使用 Rust 原生[数据测试器](https://github.com/qOeOp/trade/blob/main/examples/live/polymarket/data_tester.py)、[执行测试器](https://github.com/qOeOp/trade/blob/main/examples/live/polymarket/exec_tester.py)或 [Up/Down 冒烟测试器](https://github.com/qOeOp/trade/blob/main/examples/live/polymarket/updown_smoke_tester.py)。执行测试器配置应用 Polymarket 市价 SELL 订单所需的[平仓精度](#执行测试器平仓剩余量)。

## 二元期权

[二元期权](https://en.wikipedia.org/wiki/Binary_option)是一种金融奇异期权合约，交易者押注一个是非命题的结果。预测正确时，交易者获得固定收益；否则一无所获。VibeTrader 将 Polymarket 结果代币表示为 `BinaryOption` 金融工具。

Polymarket 使用 **pUSD** 作为交易抵押代币，更多信息[见下文](#pusd)。

## Polymarket 文档

Polymarket 为不同受众提供以下资源：

- [Polymarket Learn](https://learn.polymarket.com/)：帮助用户了解平台及其使用方式的教育内容和指南。
- [Polymarket CLOB API](https://docs.polymarket.com/getting-started/api)：面向 Polymarket CLOB API 开发者的技术文档。

## 概述

本指南假定交易者同时设置实盘市场数据馈送和交易执行。Rust 实现包含多个组件，可按用例组合或单独使用。

- `PolymarketWebSocketClient`：基于 Vibe Rust `WebSocketClient` 构建的底层 WebSocket API 连接。
- `PolymarketInstrumentProvider`：`BinaryOption` 金融工具解析和加载功能。
- `PolymarketDataClient`：市场数据馈送管理器。
- `PolymarketExecutionClient`：交易执行网关。
- `PolymarketDataClientFactory`：Polymarket 数据客户端工厂（供实盘节点构建器使用）。
- `PolymarketExecutionClientFactory`：Polymarket 执行客户端工厂（供实盘节点构建器使用）。

:::note
Python 用户通过导出的配置类和工厂类配置实盘节点。直接 WebSocket、提供程序、数据客户端和执行客户端类型是仅限 Rust 的实现组件。
:::

## pUSD

**pUSD** 是 Polymarket 交易使用的抵押代币。它是 Polygon 上由 USDC 支持的标准 ERC-20 代币。

Polygon 上的代理合约地址为 [0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB](https://polygonscan.com/address/0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB)。直接链上注资通过 [CollateralOnramp](https://docs.polymarket.com/resources/contracts) 将 Polygon USDC.e（桥接 USDC）包装为 pUSD。Bridge API 也可以从其他链存入受支持资产，并在转换后计入 pUSD。

## 钱包和账户

要通过 VibeTrader 与 Polymarket 交互，需要一个兼容 **Polygon** 的钱包（例如 MetaMask）。

### 签名类型

Polymarket 支持多种订单签名和验证类型：

| 签名类型 | 钱包类型            | 描述                                             | 用例                                                           |
| -------- | ------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| `0`      | EOA（外部拥有账户） | 由直接控制私钥的钱包生成标准 EIP712 签名。       | **适配器默认值。** 获准的 EOA 交易，注资方和签名方为同一地址。 |
| `1`      | Proxy Wallet        | 通过电子邮件或社交登录创建的旧版智能合约钱包。   | 要求提供 Proxy Wallet `funder` 地址。                          |
| `2`      | Safe Wallet         | 使用外部浏览器钱包创建的旧版 Gnosis Safe 钱包。  | 要求提供 Safe Wallet `funder` 地址。                           |
| `3`      | Deposit Wallet      | 新 Polymarket 账户钱包使用的 ERC-1271 智能钱包。 | 要求提供 Deposit Wallet `funder`；API 凭证仍绑定到签名方。     |

:::note
Polymarket 对 2026 年 5 月 4 日及以后部署的账户钱包使用 Deposit Wallet。直接 EOA 交易要求 EOA 已获准。账户类型和设置流程请参阅 Polymarket [钱包和身份验证指南](https://docs.polymarket.com/trading/wallets-auth)。
:::

VibeTrader 默认使用签名类型 0（EOA），也可通过 `signature_type` 配置参数使用任一受支持签名类型。

使用环境变量时，每个交易者实例支持一个钱包地址；也可通过多个执行客户端实例配置多个钱包。

:::note
请确保钱包已有 **pUSD** 资金，否则提交订单时会遇到 "not enough balance or allowance" API 错误。
:::

### 设置 EOA 授权额度

适配器包含用于 EOA 账户的直接链上授权额度命令。只有注资钱包就是签名方（`SignatureType::Eoa`）时才能使用。为 EOA 准备支付 gas 的 POL，设置 `POLYMARKET_PK`，然后运行：

```bash
cargo run -p vibe-polymarket --bin polymarket-set-allowances
```

该命令向 CTF Exchange、Neg Risk CTF Exchange 和 `NegRiskCtfCollateralAdapter` 授予最大的 pUSD 与 CTF 授权额度。默认使用 `https://polygon.drpc.org`；设置 `POLYGON_RPC_URL` 可使用其他 Polygon RPC 端点。如果 Polymarket 更改所需合约，请再次运行。

### 设置智能钱包授权额度

不要为 Proxy、Safe 或 Deposit Wallet 注资方运行 EOA 命令。该命令使用 EOA 密钥签署交易，无法从智能合约钱包授予授权。

使用 Polymarket [钱包和身份验证流程](https://docs.polymarket.com/trading/wallets-auth)从账户钱包提交授权。Deposit Wallet 授权使用由签名方授权并通过 Relayer 提交的有序 `WALLET` 批次。Safe 和 Proxy Wallet 授权需要相应钱包专用的 SDK 载荷。

授权交易确认后，刷新 CLOB 缓存。Rust 调用方可以使用 `PolymarketClobHttpClient::update_balance_allowance`，pUSD 对应 `AssetType::Collateral`。条件代币授权额度使用 `AssetType::Conditional` 和条件代币 ID。两种形式还都需要账户的签名类型。经身份验证的请求映射到 `GET /balance-allowance/update`。Deposit Wallet 使用 `SignatureType::Poly1271`。

## API 密钥

执行客户端要求 CLOB L2 凭证。请使用 Polymarket [API 身份验证流程](https://docs.polymarket.com/getting-started/api#authentication)创建或派生凭证。适配器提供一个读取 `POLYMARKET_PK` 并输出已创建或派生凭证的命令：

```bash
cargo run -p vibe-polymarket --bin polymarket-create-api-key
```

将返回值设置为：

- `POLYMARKET_API_KEY`
- `POLYMARKET_API_SECRET`
- `POLYMARKET_PASSPHRASE`

凭证验证私钥签名方，而不是 proxy 或 Deposit Wallet 注资方。公共数据客户端不需要这些凭证。

## 配置

设置 VibeTrader 使用 Polymarket 时，必须正确配置所需参数，尤其是私钥。

**关键参数**：

- `private_key`：用于签署订单的钱包私钥。其解释取决于 `signature_type` 配置。配置中未显式提供时，自动读取 `POLYMARKET_PK` 环境变量。
- `funder`：为交易注资的 **pUSD** 钱包地址。未提供时读取 `POLYMARKET_FUNDER` 环境变量。
- API 凭证：与 Polymarket CLOB 交互需要提供以下 API 凭证：
  - `api_key`：未提供时读取 `POLYMARKET_API_KEY` 环境变量。
  - `api_secret`：未提供时读取 `POLYMARKET_API_SECRET` 环境变量。
  - `passphrase`：未提供时读取 `POLYMARKET_PASSPHRASE` 环境变量。
  API 凭证由私钥签名方创建，用于 L2 身份验证。对于 `POLY_1271`，deposit wallet 仍为 `funder`，但并不是 L2 身份验证地址。
- `auto_load_missing_instruments`（默认 `True`）：控制订阅或请求缓存中尚不存在的金融工具时，是否通过 Gamma API 触发临时加载。禁用后，订阅未缓存金融工具会返回错误。请参阅[运行时金融工具加载](#运行时金融工具加载)。
- `auto_load_debounce_ms`（默认 `100`）：将并发自动加载请求合并为单个 Gamma 批量调用的时间窗口（毫秒）。

:::tip
建议使用环境变量管理凭证。
:::

## 数据能力

Polymarket 支持实盘 `L2_MBP` 订单簿增量、报价和成交。金融工具定义由引导、配置刷新、新市场发现和 tick 大小变更发布。

## 订单能力

Polymarket 是预测市场，与传统交易所相比，其订单类型和指令更有限。

:::tip
对于 Polymarket 实盘执行，请使用 `with_timeout_disconnection_secs(30)` 和 `with_delay_post_stop_secs(30)`，将断开连接超时和停止后延迟都设为 30 秒。延迟让剩余订单和取消事件在断开前到达，超时则为每个客户端留出正常关闭时间。
:::

### 订单类型

| 订单类型               | 二元期权 | 说明                                                      |
| ---------------------- | -------- | --------------------------------------------------------- |
| `MARKET`               | ✓        | **BUY 订单要求计价货币数量**，SELL 订单要求基础货币数量。 |
| `LIMIT`                | ✓        |                                                           |
| `STOP_MARKET`          | -        | *Polymarket 不支持*。                                     |
| `STOP_LIMIT`           | -        | *Polymarket 不支持*。                                     |
| `MARKET_IF_TOUCHED`    | -        | *Polymarket 不支持*。                                     |
| `LIMIT_IF_TOUCHED`     | -        | *Polymarket 不支持*。                                     |
| `TRAILING_STOP_MARKET` | -        | *Polymarket 不支持*。                                     |

### 数量语义

Polymarket 根据订单类型和方向以不同方式解释订单数量：

- **限价**订单将 `quantity` 解释为条件代币数量（基础货币单位）。
- **市价 SELL** 订单也使用基础货币单位数量。
- **市价 BUY** 订单将 `quantity` 解释为以 **pUSD** 计价的名义价值。

因此，使用基础货币数量提交的市价买单会执行远超预期的数量。

提交市价 BUY 订单时，在订单上设置 `quote_quantity=True`。适配器会先将计价金额（pUSD）转换为已签名的基础货币份额数量，再提交到 CLOB。Polymarket 执行客户端会拒绝以基础货币计量的市价买单，以防意外成交。

```python
# Market BUY with quote quantity (spend $10 pUSD)
order = strategy.order_factory.market(
    instrument_id=instrument_id,
    order_side=OrderSide.BUY,
    quantity=instrument.make_qty(10.0),
    time_in_force=TimeInForce.IOC,  # Maps to Polymarket FAK
    quote_quantity=True,  # Interpret as pUSD notional
)
strategy.submit_order(order)
```

### 执行指令

| 指令          | 二元期权 | 说明                                       |
| ------------- | -------- | ------------------------------------------ |
| `post_only`   | ✓        | 仅支持有效期为 `GTC` 或 `GTD` 的限价订单。 |
| `reduce_only` | -        | *Polymarket 不支持*。                      |

### 有效期选项

Polymarket 将 `POST /order` 字段称为 `orderType`。在 VibeTrader 中，该字段映射到 `TimeInForce`。有效组合取决于 Vibe 订单类型：

| Vibe TIF | Polymarket `orderType` | Vibe 订单范围       | 说明                                         |
| -------- | ---------------------- | ------------------- | -------------------------------------------- |
| `GTC`    | `GTC`                  | 仅 `LIMIT`          | 撤销前有效；挂在订单簿上。                   |
| `GTD`    | `GTD`                  | 仅 `LIMIT`          | 到期日前有效；在到期、成交或取消前保持挂单。 |
| `FOK`    | `FOK`                  | `LIMIT` 或 `MARKET` | 立即全部成交，否则取消整笔订单。             |
| `IOC`    | `FAK`                  | `LIMIT` 或 `MARKET` | 立即成交可用数量，并取消剩余部分。           |

:::note
Polymarket 使用 `FAK`（Fill-And-Kill）表达 VibeTrader 所称的 `IOC`（Immediate or Cancel）语义。Polymarket 文档将 `FOK` 和 `FAK` 归类为市价订单类型，将 `GTC` 和 `GTD` 归类为限价订单类型。对于 Vibe `MARKET` 订单，适配器只接受 `IOC` 和 `FOK`；`GTC` 和 `GTD` 只适用于挂单的 `LIMIT` 订单。
:::

:::note
请从每个市场的订单簿读取 `min_order_size`；活动市场通常报告 5 份额。可成交订单名义价值低于 **1 pUSD** 时也可能以 `invalid amount for a marketable BUY order … min size: $1` 被拒绝。适配器不设置金融工具 `min_quantity`，因为市价 BUY 数量使用 pUSD，而其他订单数量使用份额。
:::

:::note
`GTD` 到期时间至少应比提交时间晚三分钟。Polymarket 应用约一分钟的到期缓冲，所以订单实际挂单时长会比请求时长短约一分钟。交易场所将到期报告为 `OrderCanceled` 事件，而非 `OrderExpired`。
:::

### 高级订单功能

| 功能             | 二元期权 | 说明                  |
| ---------------- | -------- | --------------------- |
| 修改订单         | -        | 仅支持取消功能。      |
| Bracket/OCO 订单 | -        | *Polymarket 不支持*。 |
| Iceberg 订单     | -        | *Polymarket 不支持*。 |

### 批量操作

| 操作     | 二元期权 | 说明                                                                                                      |
| -------- | -------- | --------------------------------------------------------------------------------------------------------- |
| 批量提交 | ✓        | 适配器使用 `POST /orders` 处理独立的限价订单批次（每个请求最多 15 笔订单）。请参阅[批量提交](#批量提交)。 |
| 批量修改 | -        | *Polymarket 不支持*。                                                                                     |
| 批量取消 | ✓        | 适配器使用 `DELETE /orders`。请参阅[批量取消](#批量取消)。                                                |

#### 批量提交

`SubmitOrderList` 命令路由到 Polymarket 的 `POST /orders` 端点。该端点每个请求最多接受 15 笔订单（`BATCH_ORDER_LIMIT`）；更大的列表会拆成连续的 15 笔订单分块。

- 只批处理 `LIMIT` 订单。列表中的 `MARKET` 订单路由到单订单路径，该路径签署可成交订单，并根据 Vibe `time_in_force` 使用 `FAK` 或 `FOK` 提交。
- `reduce_only` 订单、`quote_quantity` 订单，以及使用市价 TIF（`IOC` 或 `FOK`）的 `post_only` 订单，会在提交前被拒绝。
- 单个符合条件的订单会转入 `POST /order`，以保留单订单重试语义；批量路径特意禁用重试，因为交易场所不公开幂等键。
- 如果批量响应遗漏某个订单分支，该订单会保持已提交状态等待对账。适配器注册已签名订单的预期哈希，使后续 WebSocket 事件和取消仍能解析到本地订单。响应遗漏无法证明交易场所拒绝了该订单。

#### 批量取消

已解析交易场所订单 ID 的 `BatchCancelOrders` 和 `CancelAllOrders` 命令使用 Polymarket [`DELETE /orders`](https://docs.polymarket.com/api-reference/trade/cancel-multiple-orders)端点。适配器连续发送分块，每个新分块的大小取端点 1,000 个 ID 限制与签名方当前取消突发容量中的较小值。签名方最初使用 Standard 层级的 120 个令牌突发容量，某次响应报告的层级会应用到下一个新分块。

每个分块独立使用相同订单 ID 重试，除非报告的较低层级要求在重试前缩小分块。适配器合并已完成响应，并在所有分块成功后处理每个请求订单一次。如果后续分块耗尽重试，之前的分块可能已经改变交易场所状态，但适配器不会发出部分单订单结果；对账会解析未知的总体结果。

### 提交错误处理

Polymarket 公共文档描述了包含 `success`、`orderID`、`status` 和 `errorMsg` 的成功 [`POST /order`](https://docs.polymarket.com/api-reference/trade/post-a-new-order) 响应，并将 [API 错误](https://docs.polymarket.com/resources/error-codes)记录为结构化错误响应。文档没有将无状态客户端异常或传输失败定义为交易场所拒绝。

只有响应证明订单未被接受时，适配器才会拒绝，例如 `success=false`、已记录的订单处理错误，或其他不可重试的客户端/API 错误。传输失败、超时、含义不明确的重试耗尽、响应序列化或解码失败、本地 I/O 失败和服务端失败都会让订单保持已提交。批量端点将被拒订单分支报告为 `success=true`，`orderID` 为空，原因位于 `errorMsg` 中（例如交易场所无法接受的无抵押卖单）：适配器使用交易场所原因拒绝该分支。既没有 `orderID` 也没有原因的分支会保持已提交状态等待对账。

只要任一次单订单提交尝试产生不明确结果，之后的重试错误就无法证明第一次尝试失败。因此，即使后续尝试返回订单已存在等客户端错误，适配器仍让订单保持已提交。

适配器发送 `POST /order` 前的失败会发出 `OrderDenied`，而不是 `OrderRejected`，其中包括调整市价 BUY 手续费所需的 pUSD 余额查询失败。

当拒绝原因表示仅挂单订单与订单簿交叉时，`OrderRejected` 事件设置 `due_post_only=true`，使策略可将其与其他交易场所拒绝区分开来。

对于未知结果，适配器会尽可能根据已签名 EIP-712 订单派生预期 Polymarket 订单哈希，并缓存为 `VenueOrderId`。之后的 WebSocket 订单事件（或对账报告）会关联到本地 `ClientOrderId`，而不是成为外部订单。

计价货币数量的市价 BUY 订单即使走未知路径，仍会应用已签名的计价货币到基础货币数量更新。提交结果未知期间请求的取消会推迟到预期交易场所订单 ID 已知后执行，并在该 ID 下注册成交跟踪。

### 持仓管理

| 功能       | 二元期权 | 说明                                      |
| ---------- | -------- | ----------------------------------------- |
| 查询持仓   | ✓        | 来自 Polymarket Data API 的当前用户持仓。 |
| 持仓模式   | -        | 仅二元结果持仓。                          |
| 杠杆控制   | -        | 不提供杠杆。                              |
| 保证金模式 | -        | 不提供保证金交易。                        |

### 订单查询

| 功能         | 二元期权 | 说明               |
| ------------ | -------- | ------------------ |
| 查询未结订单 | ✓        | 仅活动订单。       |
| 查询订单历史 | ✓        | 有限的历史数据。   |
| 订单状态更新 | ✓        | 实时订单状态变化。 |
| 交易历史     | ✓        | 执行和成交报告。   |

### 条件订单

| 功能         | 二元期权 | 说明                                     |
| ------------ | -------- | ---------------------------------------- |
| 订单列表     | -        | 存在独立订单批次，但没有关联的条件语义。 |
| OCO 订单     | -        | *Polymarket 不支持*。                    |
| Bracket 订单 | -        | *Polymarket 不支持*。                    |
| 条件订单     | -        | *Polymarket 不支持*。                    |

### 精度限制

Polymarket 根据 tick 大小和 `orderType` 强制执行不同精度限制。

**二元期权金融工具**通常支持最多 6 位金额小数（tick 大小为 0.0001），但**市价订单（`FAK` 和 `FOK`）的精度要求更严格**：

- **市价订单类型（`FAK` 和 `FOK`）：**
  - 直接 maker 金额最多 **2 位小数**。
  - 计算得到的 taker 金额使用市场 tick 精度加两位数量小数。
  - 使用 `FAK` 或 `FOK` 提交的限价订单也必须满足更严格的市价订单金额验证。交易场所会拒绝对挂单有效、但对此市价订单类型无效的值。
  - 对于限价 BUY，`quantity` 是限价处的名义份额数量。使用 `FAK` 或 `FOK` 时，Polymarket 会花费相应 pUSD maker 预算，因此价格改善可能返回更多份额；适配器会将订单数量更新为实际成交量。
  - 当 `quantity * price` 不是精确的美分金额时，适配器会在签名前拒绝订单。它不会舍入并重新计算名义份额数量，因为这会改变签名的价格/金额比率。

- **挂单限价订单类型（`GTC` 和 `GTD`）：** 根据市场 tick 大小采用更灵活的精度。

### tick 大小精度层级

| Tick 大小 | 价格小数位数 | 数量小数位数 | 金额小数位数 |
| --------- | ------------ | ------------ | ------------ |
| 0.1       | 1            | 2            | 3            |
| 0.01      | 2            | 2            | 4            |
| 0.0025    | 4            | 2            | 6            |
| 0.001     | 3            | 2            | 5            |
| 0.0001    | 4            | 2            | 6            |

:::note

- 适配器在签名前验证 tick 大小，也会拒绝 maker 金额超过两位小数的限价 `FAK` 或 `FOK` BUY。这适用于单笔和批量提交。
- 挂单 `GTC` 和 `GTD` 限价订单及所有 SELL 订单保留由 tick 派生的金额精度。
- 适配器在签名前拒绝当前市场 `tick_size` 到 `1 - tick_size` 范围之外的限价。
- 发布的 `BinaryOption` 将 `min_price` 和 `max_price` 分别公布为 `tick_size` 和 `1 - tick_size`，因此按金融工具边界截断的消费者会保持在可接受范围内。
- 市价订单精度限制包括卖出数量的两位小数，以及由 tick 派生的计算金额边界。
- 市况变化时 tick 大小可动态改变，尤其是在市场变成单边时。

:::

### tick 大小变更处理

市场 tick 大小变化（`tick_size_change` WebSocket 事件）时，旧订单簿档位可能不符合新网格（例如 `0.505` 符合 `0.001` tick，但不符合 `0.01` tick）。为避免旧网格价格进入新阶段，适配器将变更视为订单簿阶段转换：

1. 发布更新后的 `BinaryOption`，包含新的 `price_increment`、`price_precision`，以及相对于 tick 的 `min_price`/`max_price` 边界。
2. 删除该金融工具的本地订单簿。
3. 将金融工具标记为等待新快照。
4. 在快照到达前丢弃增量 `price_change` 订单簿增量。
5. 使用快照重新初始化订单簿并恢复正常处理。

成交 tick 和金融工具更新保持不变。报价处理遵循 `drop_quotes_missing_side`：启用时，报价 tick 要求买价和卖价都存在；禁用时，缺失侧使用 Polymarket 边界价格和零数量。适配器可以从每个 `price_change` 读取 `best_bid` 和 `best_ask`，使报价在间隙期间继续流动。

## 成交

Polymarket 成交可能具有以下状态：

- `MATCHED`：成交已撮合并发送到执行器服务。执行器将其作为交易提交到 Exchange 合约。
- `MINED`：观察到成交已在链上完成挖矿，但尚未建立最终性阈值。
- `CONFIRMED`：成交已达到强概率最终性且成功。
- `RETRYING`：成交交易失败（回滚或重组），操作方正在重试/重新提交。
- `FAILED`：成交失败且不再重试。

成交初次撮合后，后续状态更新通过用户 WebSocket 到达。执行适配器在 `MATCHED` 时发出一个 `OrderFilled`。它将 `MINED` 和 `RETRYING` 作为结算更新，不再发出成交。`CONFIRMED` 记录最终性并刷新账户。如果成交达到 `FAILED`，适配器会为每笔本地已应用成交发出一个 `OrderFillVoided` 并刷新账户。更正不会重新挂出失败数量，但会保留已在工作的 maker 订单剩余量。执行完成的订单变为 `VOIDED`。已撮合 WebSocket 成交会在 `OrderFilled` 事件的 `info` 字段中保留原始成交字段。

### 成交 ID 派生

Polymarket 不在 `last_trade_price` 市场数据事件上发布成交 ID。适配器使用 FNV-1a，通过 Rust `determine_trade_id` 函数根据资产 ID、方向、价格、数量和时间戳派生确定性 `TradeId`。对于执行成交，taker 报告在 REST 对账和用户 WebSocket 中都使用交易场所成交 `id`，因此同一成交可以跨来源去重。一笔 maker 成交可能成交用户多笔挂单，因此 maker 报告会组合交易场所成交 ID 和 maker 交易场所订单 ID。同一交易场所事件在各次重放中生成相同成交 ID。对于历史 Data API 成交，加载器使用 `{transactionHash[-24:]}-{asset[-4:]}-{seq:06d}` 区分同一交易中的成交。

## 费用

适配器读取每个金融工具的 `fee_schedule`，并按以下方式应用其 `rate` 和 `exponent`：

```text
platform fee = shares * rate * (price * (1 - price)) ^ exponent
```

当前公共费用表使用指数 `1`，即 Polymarket 公布的 `C * feeRate * p * (1 - p)` 公式。平台费用在 `p = 0.50` 时最高，向两端对称降低，并且只适用于 taker 成交。

| 类别      | Taker `feeRate` | Maker `feeRate` | Maker 返佣 |
| --------- | --------------- | --------------- | ---------- |
| 加密货币  | 0.07            | 0               | 20%        |
| 体育      | 0.05            | 0               | 15%        |
| 金融      | 0.04            | 0               | 25%        |
| 政治      | 0.04            | 0               | 25%        |
| 经济      | 0.05            | 0               | 25%        |
| 文化      | 0.05            | 0               | 25%        |
| 天气      | 0.05            | 0               | 25%        |
| 其他/综合 | 0.05            | 0               | 25%        |
| 提及      | 0.04            | 0               | 25%        |
| 科技      | 0.04            | 0               | 25%        |
| 地缘政治  | 0               | 0               | -          |

适配器签署的每笔订单都携带硬编码的 Vibe 构建器代码。其构建器费率固定为零，且不可配置。

`FillReport.commission` 以 pUSD 计价，并将平台费用舍入到五位小数。

:::note
最新公共费用表请参阅 Polymarket [费用](https://docs.polymarket.com/trading/fees)文档。
:::

### 回测费用模型

当前指数为 `1` 的费用表应使用 `ProbabilityPriceFeeModel`。它从二元期权金融工具读取 maker 和 taker 费率，并应用相同的概率价格曲线：

```python
from vibe_trader.execution import ProbabilityPriceFeeModel

fee_model = ProbabilityPriceFeeModel()
```

将该对象传给 `BacktestVenueConfig.fee_model`。它不支持其他费用指数或未来的 maker 返佣分配，因此应在回测配置中显式说明这些假设。

## 对账

按 Polymarket 订单 ID（`venue_order_id`）查询时，Polymarket API 会返回所有**活动**（未结）订单或指定订单。Polymarket 执行对账流程如下：

- 为 Polymarket 报告的所有存在活动（未结）订单的金融工具生成订单报告。
- 根据 Polymarket Data API 报告的当前用户持仓生成持仓报告。
- 将这些报告与 Vibe 执行状态比较。
- 生成缺失订单，使 Vibe 执行状态与 Polymarket 报告的持仓一致。

单订单查询可以返回活动或终结状态。如果没有返回订单，适配器会在遗漏终结 WebSocket 更新时，从成交历史恢复缓存中的单个订单。只有 `CONFIRMED` 成交参与恢复成交；待处理和失败的结算状态不参与。

批量状态对账会将每份订单报告与其交易场所成交报告配对。它先应用真实成交以保留成交 ID 和佣金，再只推断达到交易场所报告状态所需的剩余数量。REST 订单报告会将撮合数量限制为本地已应用成交与经过身份验证的 `CONFIRMED` 成交历史中的较大者，因此待处理结算不会生成推断成交。当交易场所报告的撮合数量多于本地订单和 WebSocket 成交跟踪器时，运行时订单检查会获取已确认成交历史。未配对的成交报告保留常规的仅成交路径。

### 从成交恢复单笔订单

`/data/order/{id}` 可以返回活动或终结订单。如果已知 ID 没有返回订单，`generate_order_status_report` 会回退到按交易场所订单 ID 筛选的 `/data/trades`。这可以避免引擎将本地 `ACCEPTED` 订单解析为 `REJECTED`，从而丢弃交易场所已经发生的成交。缓存订单通过 `client_order_id` 解析；如果只有交易场所 ID，则回退到缓存的 `venue_order_id` 索引。恢复以缓存订单为键；没有缓存订单时，会交由引擎处理，而不是只根据成交历史合成外部订单：

- 缓存订单 + 已恢复成交覆盖缓存数量（在 CLOB 美分 tick 截断的 `DUST_SNAP_THRESHOLD` 范围内）：返回 `Filled`。引擎通过推断成交对账超过缓存 `filled_qty` 的差值。
- 缓存订单 + 已恢复成交比缓存数量少，且差距超过微量阈值：返回 `Canceled` 和已恢复的 `filled_qty`。引擎的 CANCELED 分支在缓存 `filled_qty` 处转换订单，因此这种罕见的部分取消情况下，仅通过 REST（而非 WS）到达的新恢复成交不会被应用。优先关闭订单，而不是让其一直处于未结状态；如果此情形需要精确成交元数据，可手动检查交易场所成交历史。
- 缓存订单，无成交：返回 `Canceled`，并设置 `cancel_reason="ORDER_NOT_FOUND_AT_VENUE"`。
- 缓存订单存在任何 `MATCHED`、`MINED` 或 `RETRYING` 成交：单订单查询会保留本地已应用撮合数量，而终结 REST 恢复等待 `CONFIRMED` 或 `FAILED`。
- 没有缓存订单（无论是否有成交）：返回 `None`；引擎的交易场所未找到路径会解析本地条目。

批量未结订单检查无法对 `GET /orders` 遗漏的已撮合订单使用此回退。使用默认 `open_check_open_only=true` 时，引擎会让这些缓存订单保持未结，等待后续对账。使用 `open_check_open_only=false` 时，缺失订单重试可能在待处理结算确认前将订单标记为已拒绝。单订单查询或下次启动对账会从已确认成交历史恢复已结算数量。

## 成交数量规范化

Polymarket 线协议金额使用六位小数定点尾数。市价 SELL 签名会将以份额计量的 `makerAmount` 截断为两位小数，而市价 BUY 计价货币转换可能使注册数量与成交数量之间存在数个微份额漂移。两种影响都以绝对份额计，因此适配器使用 `DUST_SNAP_THRESHOLD = 0.01` 份额。达到或超过该阈值的差异仍是真实的部分成交或超额成交。

| 方向     | 来源                                 | 适配器行为                       |
| -------- | ------------------------------------ | -------------------------------- |
| 超额成交 | 市价 BUY 计价货币转换（微份额）      | 将成交向下对齐到 `submitted_qty` |
| 不足成交 | 已签名或交易场所数量截断（`< 0.01`） | 规范化原子 FOK；取消 FAK 剩余量  |

对于挂单 maker 订单，终结数量规范化由 `MATCHED` 订单更新触发；对于原子 FOK 订单，则直接由确认中的 taker 成交触发。它会发出对账 `OrderUpdated`，将订单数量降低到交易场所累计成交。它不会发出成交，也不会改变持仓、余额或佣金。

IOC 映射到交易场所 FAK。taker 成交确认后，`original_size` 与 `size_matched` 之间的每个正差值都是交易场所已取消的未成交剩余量。因此适配器会在真实成交后发出 `OrderCanceled`，而不是规范化数量或让订单保持部分成交。当 `MATCHED` FAK 的 `size_matched < original_size` 时，REST 报告采用相同规则。确认成交先于提交响应到达时，同一终结处理会在缓冲成交排空后运行。缓冲的 `Canceled`、`Expired` 或 `Rejected` 报告优先。

`FillReport.commission` 始终反映交易场所报告数量，而不是对齐后的数量。数个 ulp 的差值折合 pUSD 后小于一微美分。

成交跟踪器以 `venue_order_id` 为键，并在订单接受时注册，因此其他会话下单的成交报告会原样通过。`DUST_SNAP_THRESHOLD` 不能按策略配置；它位于 `vibe_polymarket::common::consts`。

### 执行测试器平仓剩余量

`close_positions_qty_precision` 是 `ExecTesterConfig` 选项。默认为 `None`，即提交完整持仓数量。Rust 和 Python Polymarket 示例将其设为 `2`，因为[市价订单 maker 金额允许两位小数](#精度限制)。示例还设置 `close_positions_time_in_force=IOC`；自定义配置必须使用 `IOC` 或 `FOK`，因为 Polymarket 拒绝 `GTC` 市价订单。

停止时，测试器只将提交的市价 SELL 数量截断到配置的小数精度，并以 WARN 级别记录确切差值。它不会舍入持仓状态或创建合成成交。

5 pUSD BUY 成交 5.1975 份额时，会提交 5.19 份额的平仓。交易场所成交该订单后，持仓仍精确剩余 0.0075 份额。如果整个持仓低于 0.01 份额，测试器会发出警告，不提交零数量订单。应将停止时平仓视为尽力而为，并在假定账户已空仓前检查持仓和警告。非零平仓还必须达到 [1 pUSD 可成交订单最小值](#有效期选项)；拒绝会使完整持仓保持未平仓。有关低于 0.01 份额的交易场所报告，请参阅[持仓报告限制](#限制和注意事项)。

## WebSocket

`PolymarketWebSocketClient` 构建于使用 Rust 编写的高性能 Vibe `WebSocketClient` 基类之上。

### 数据

数据适配器会随着金融工具请求动态打开 `market` 订阅。它将这些订阅分散到市场 WebSocket 连接池中，使单个连接承载的资产不超过 `ws_max_subscriptions`。连接池延迟增长（低于上限的全集只使用一个连接），次要连接不再拥有资产时会关闭。每个连接重连时只重放自己的资产。

单个 `price_change` 载荷可以包含多个资产交错的更新。适配器按金融工具对更新分组，为每个金融工具发布一个原子订单簿增量批次，而报价处理仍遵循交易场所载荷顺序。

#### 有效增量

`compute_effective_deltas` 默认为 `false`。启用后会以额外处理换取更小的快照批次（请参阅[数据客户端选项](#数据客户端选项)）：

- 已有本地状态的完整订单簿快照只发出净档位变化：新档位为 `ADD`，大小变化为 `UPDATE`，移除档位为携带最后已知大小的 `DELETE`。无操作快照不发出内容，最后一条记录携带 `F_LAST`。
- 没有之前状态时（例如 [tick 大小变更](#tick-大小变更处理)后），快照原样通过，为新订单簿阶段初始化。
- 增量 `price_change` 批次保持不变，并更新本地比较状态。
- 该选项只改变订单簿增量流；报价和成交不变。

#### RTDS 自定义数据

数据客户端还支持 Polymarket 实时数据（RTDS）的加密货币和股票主题。通过通用自定义数据订阅，并提供必填且非空的 `symbol` 元数据值：

```python
from vibe_trader.adapters.polymarket import POLYMARKET_CLIENT_ID
from vibe_trader.adapters.polymarket import PolymarketRtdsCryptoPrice
from vibe_trader.adapters.polymarket import PolymarketRtdsEquityPrice
from vibe_trader.model import DataType

crypto_type = DataType(
    PolymarketRtdsCryptoPrice.__name__,
    metadata={"symbol": "btcusdt"},
)
equity_type = DataType(
    PolymarketRtdsEquityPrice.__name__,
    metadata={"symbol": "AAPL"},
)

strategy.subscribe_data(crypto_type, client_id=POLYMARKET_CLIENT_ID)
strategy.subscribe_data(equity_type, client_id=POLYMARKET_CLIENT_ID)
```

符号匹配不区分大小写，发布的符号为小写。加密货币 RTDS 使用 `crypto_prices` 主题；股票 RTDS 使用 `equity_prices`。交易场所提供 `full_accuracy_value` 时，股票更新优先使用该值；快照或更新省略时回退到 `value`。

### 运行时金融工具加载

Polymarket 列出数千个活动市场，而且全天不断出现新市场，因此在启动时预加载完整全集通常不实际。数据适配器会按需自动加载缺失金融工具，使策略可以订阅缓存中不存在的市场：

- 策略针对未缓存金融工具发出 `subscribe_quotes`、`subscribe_trades`、`subscribe_book_deltas` 或 `request_instrument` 时，适配器注册请求并等待 `auto_load_debounce_ms`（默认 100 ms），以合并并发请求。
- 随后发出单个批量 Gamma API 调用。超过 Gamma `condition_ids` 查询上限（约 100）的批次会拆分为多个调用并合并。
- 金融工具加载后，会发布给数据引擎（填充缓存），延迟的订阅则以原子方式打开其 WebSocket 订阅。自动加载仍在进行时取消订阅的策略不会看到意外打开的订阅。

该功能默认启用。在 `PolymarketDataClientConfig` 上设置 `auto_load_missing_instruments=False` 可禁用。若要在启动时预加载一组已知市场，请在 `PolymarketInstrumentProviderConfig` 上提供 `load_ids`、`event_slugs`、`market_slugs` 或 `event_slug_builder`。

新创建市场会经历数分钟的 CLOB 补全窗口，此时 Gamma 报告 `active=true`，但 `GET /markets/{cid}` 返回 404，或返回 200 但 `token_id` 字符串为空。适配器将其归类为暂时性错误，并使用带抖动的有界指数退避重试自动加载。使用 `auto_load_max_retries`（默认 12）、`auto_load_retry_delay_initial_secs`（默认 5.0）和 `auto_load_retry_delay_max_secs`（默认 15.0）调整节奏；默认值将重试窗口限制在约 3 分钟。设置 `auto_load_max_retries=0` 可禁用重试。5 分钟市场（例如 updown 加密货币）可能在交易场所完成补全前到期，因此应预留时间或提高上限。重试预算耗尽后，Gamma 上仍缺失的条件会记录为终结缺失；市场可用后调用方必须重新订阅。

### 市场裁决事件

Rust 数据客户端在 `condition_id` 层级跟踪 Polymarket 风险敞口，使交易场所裁决市场时 YES 和 NO 两个分支同时关闭。持仓事件会将未结 Polymarket 二元期权金融工具加入内部观察列表。观察中的条件到期后，数据客户端等待 `resolve_poll_grace_secs`，再每隔 `resolve_poll_interval_secs` 轮询 Gamma，直到条件完成裁决或经过 `resolve_poll_max_wait_secs`。

裁决使用严格的获胜者推断：

- Gamma 必须返回已关闭二元市场，其中恰好有两个代币 ID、两个结果和二元 `outcomePrices` 结构。
- 如果 Gamma 没有为条件提供严格结果，客户端会回退到 CLOB `GET /markets/{condition_id}` 并使用 `tokens[].winner`。
- 非二元、含义不明确、格式错误或尚未裁决的载荷会被跳过。它们保留在观察列表中，直到轮询窗口超时或手动请求触发裁决。

客户端应用裁决结果时，会为每个跟踪分支发出一个 `InstrumentStatus` 关闭和一个 `InstrumentClose`。获胜分支以 `1` 关闭，失败分支以 `0` 关闭。关闭类型为 `InstrumentCloseType.ContractExpired`。该事件会关闭 Vibe 风险敞口，但不会在链上赎回代币或领取资金。

同一应用路径处理 WebSocket `market_resolved` 事件、自动轮询和手动请求。经过 `resolve_poll_max_wait_secs` 后，自动轮询会暂停观察条件并记录日志，供手动恢复。之后手动请求仍可重试该条件。

#### 手动裁决请求

使用数据类型为 `PolymarketResolveRequest` 的 `request_data()` 强制执行裁决检查。请求接受以下任一参数：

| 参数             | 类型                 | 描述                                            |
| ---------------- | -------------------- | ----------------------------------------------- |
| `condition_id`   | `str`                | 裁决一个 Polymarket 条件。                      |
| `condition_ids`  | `str` 或 `list[str]` | 裁决一个或多个 Polymarket 条件。                |
| `instrument_ids` | `str` 或 `list[str]` | 裁决 Polymarket 金融工具 ID；忽略其他交易场所。 |

如果请求省略所有选择器，客户端使用观察列表。启用自动轮询时，回退会选择暂停或超时的条目。禁用自动轮询时，会选择所有已到期且符合条件的条目，使操作人员可手动运行恢复流程。

响应载荷是采用以下字典结构的自定义数据：

| 键                           | 含义                                              |
| ---------------------------- | ------------------------------------------------- |
| `requested_condition_ids`    | 请求检查的已去重条件 ID。                         |
| `fetched_markets`            | 批量查找返回的 Gamma 市场。                       |
| `resolved_markets`           | 具有严格 Gamma 结果或成功 CLOB 回退结果的条件。   |
| `skipped_non_binary_markets` | 因裁决结构非二元或含义不明确而跳过的 Gamma 市场。 |
| `clob_fallback_successes`    | 通过 CLOB 回退路径裁决的条件。                    |
| `emitted_condition_ids`      | 至少发出一个 `InstrumentClose` 的条件。           |
| `failed_condition_ids`       | Gamma 和 CLOB 查找均失败的条件。                  |
| `used_watchlist_fallback`    | 请求是否从观察列表选择条件。                      |
| `timed_out_watchlist`        | 回退选择期间看到的超时观察列表条目。              |
| `error`                      | 首个摘要错误（如果发生）。                        |

赎回属于独立的账户或执行工作流。不要扩展数据客户端的裁决路径来领取资金；它只向 Vibe 发布市场结果关闭事件。

### 在运行时清理金融工具

Polymarket 按需自动加载金融工具，因此长期运行的会话会随着市场完成裁决、新市场出现和策略轮换事件而持续扩大缓存。使用 `cache.purge_instrument` 移除策略不再跟踪的市场。该调用会移除金融工具记录和每个以其为键、由缓存所有的映射（订单簿、报价、成交、K 线）。

```python
class PolymarketHousekeeping(Strategy):
    def on_position_closed(self, event: PositionClosed) -> None:
        # Drop the market once the position is closed and you have no further interest.
        instrument_id = event.instrument_id
        self.unsubscribe_quotes(instrument_id)
        self.unsubscribe_book_deltas(instrument_id)
        self.cache.purge_instrument(instrument_id)
```

Polymarket 上的常见触发条件：

- 市场完成裁决后不再产生交易。
- 事件结束，策略从其市场轮换离开。
- 策略轮换固定大小的观察列表并移除最早条目。

清理会跳过仍有非终结订单（已初始化、已提交、已接受、已模拟、已释放或传输中）或未平仓持仓的金融工具，因此无需与执行客户端协调即可安全调用。活动 WebSocket 订阅归数据引擎所有。如果不再需要更新，请先取消订阅，再执行清理。

缓存还提供 `purge_order`、`purge_position`、`purge_closed_orders`、`purge_closed_positions` 和 `purge_account_events`，用于清理已关闭执行状态。对于长期运行的 Polymarket 节点，请通过 `LiveExecEngineConfig` 调度批量清理（15 分钟间隔、60 分钟缓冲期是合理默认值）。完整方法请参阅[缓存：清理缓存数据](../concepts/cache.md#purging-cached-data)。

:::warning
调用方负责判断何时不再需要某个金融工具。如果清理其他 Actor、策略或引擎仍依赖的金融工具，查询时将找不到该金融工具，并会丢失市场数据历史。
:::

### 执行

执行适配器保持一个 `user` 频道连接以接收订单和成交事件，并根据交易期间看到的金融工具按需管理市场订阅。

适配器支持动态 WebSocket 订阅和取消订阅操作。已撮合 WebSocket 成交及其更正会从缓存订单历史恢复，并跨重连去重。如果成交到达时金融工具尚不可用，适配器不会将其加入去重状态。事件重新传递或之后的 REST 对账可以在金融工具加载完成后应用它。对于完全撮合的订单，终结数量规范化会等待订单 `associate_trades` 列表中的每个成交 ID 确认后，才将订单数量降低到实际成交数量。如果已确认成交在 WebSocket 中断后通过 REST 恢复，对账会应用相同的仅订单规范化。如果 `MATCHED` WebSocket 更新省略 `associate_trades`，适配器不会推断结算已经最终确定；下次 REST 对账会在成交达到 `CONFIRMED` 后恢复剩余量。

### 订阅限制

Polymarket 当前速率限制文档没有公布 WebSocket 订阅上限。因此，`ws_max_subscriptions`（默认 200）是自行选择的保守单连接可靠性边界，而不是交易场所强制限制：观察发现单连接订阅量过高时，连接可能静默停滞。适配器通过将资产订阅分片到市场连接池来强制执行此边界，仅在现有连接已满时打开新连接，并在次要连接不再拥有资产时将其关闭。

## 速率限制

Polymarket 对其 API 应用 Cloudflare IP 限制，并对 CLOB 订单和取消请求应用独立的逐签名方令牌桶。适配器在进程中强制执行签名方限制。同一签名方的所有客户端共享一个限速器，其中订单桶和取消桶彼此独立。

### 逐签名方 CLOB 交易限制

适配器最初将每个签名方设为 Standard 层级。Polymarket 根据 maker 钱包过去 30 天的累计交易量确定层级资格，即使 maker 与签名方不同，并每三小时刷新分配。适配器不计算资格：已识别的 `Poly-RateLimit-Tier` 响应头会选择以下编码配置之一并更新两个桶；未知层级会记录并忽略。

| 层级     | Maker 30 天交易量 | 订单速率（令牌/秒） | 订单突发容量 | 取消速率（令牌/秒） | 取消突发容量 | 允许取消负余额 |
| -------- | ----------------- | ------------------: | -----------: | ------------------: | -----------: | -------------- |
| Standard | -                 |                  40 |           60 |                  80 |          120 | 是             |
| Copper   | $30,000+          |                  60 |           90 |                 120 |          180 | 是             |
| Bronze   | $50,000+          |                  80 |          120 |                 160 |          240 | 是             |
| Silver   | $100,000+         |                 200 |          300 |                 400 |          600 | 是             |
| Gold     | $500,000+         |                 400 |          600 |                 800 |        1,200 | 是             |
| Platinum | $2.5M+            |                 450 |          675 |                 900 |        1,350 | 否             |
| Diamond  | $5M+              |                 525 |          787 |               1,050 |        1,575 | 否             |
| Elite    | $10M+             |                 600 |          900 |               1,200 |        1,800 | 否             |

涵盖的请求消耗：

| 桶   | 请求                           | 令牌成本             |
| ---- | ------------------------------ | -------------------- |
| 订单 | `POST /order`                  | 1                    |
| 订单 | `POST /orders`                 | 订单数               |
| 取消 | `DELETE /order`                | 1                    |
| 取消 | `DELETE /orders`               | 提交的订单 ID 数量   |
| 取消 | `DELETE /cancel-all`           | 1 加成功取消数       |
| 取消 | `DELETE /cancel-market-orders` | 1 加成功匹配的取消数 |

请求会等待获得完整令牌成本；只有成本超过当前层级突发容量时，才会在本地被拒绝。每个新 `DELETE /orders` 分块前，适配器会根据端点 1,000 个 ID 限制和该突发容量中的较小值重新计算上限。全部取消和按市场取消请求在请求前扣除一个令牌，响应后再为每个成功取消扣除令牌。Standard 至 Gold 层级允许产生取消欠账；Platinum 至 Elite 层级会将余额下限设为零。

`Poly-RateLimit-Remaining` 可以降低本地余额，`Poly-RateLimit-Reset` 会延长已拒绝或欠账桶的等待时间。适配器会记录 `Poly-RateLimit-Warning` 响应，包括端点、令牌成本、层级、剩余余额和重置时间。

带 `Retry-After` 的 `429 Too Many Requests` 响应会至少在该延迟期间阻塞相应桶，之后可以重试；没有 `Retry-After` 时，适配器不会自动重试。单独的 429 是确定的交易场所拒绝。传输失败、超时以及任何包含更早不明确尝试的提交仍是不明确结果。

### 选定的基于 IP 的 REST 限制

Polymarket 会随时间调整这些配额。截至 2026-08-04，官方限制如下：

| 端点                                | 突发（10 秒） | 持续（10 分钟） | 说明                                 |
| ----------------------------------- | ------------- | --------------- | ------------------------------------ |
| 通用速率限制                        | 15,000        | -               | 已记录的全局速率限制。               |
| 健康检查（`/ok`）                   | 100           | -               | 健康端点。                           |
| CLOB 通用                           | 9,000         | -               | 所有 CLOB 端点合计。                 |
| CLOB `POST /order`                  | 5,000         | 120,000         | 单订单提交。                         |
| CLOB `POST /orders`                 | 2,000         | 21,000          | 批量提交（每个请求最多 15 笔订单）。 |
| CLOB `DELETE /order`                | 5,000         | 120,000         | 单订单取消。                         |
| CLOB `DELETE /orders`               | 2,000         | 15,000          | 批量取消。                           |
| CLOB `DELETE /cancel-all`           | 250           | 6,000           | 取消所有订单。                       |
| CLOB `DELETE /cancel-market-orders` | 1,500         | 21,000          | 取消一个市场的订单。                 |
| CLOB `GET /balance-allowance`       | 200           | -               | 余额和授权额度查询。                 |
| CLOB API 密钥端点                   | 100           | -               | 密钥管理。                           |
| Gamma 通用                          | 4,000         | -               | 所有 Gamma 端点合计。                |
| Gamma `/markets`                    | 300           | -               | 市场元数据。                         |
| Gamma `/events`                     | 500           | -               | 事件元数据。                         |
| Data 通用                           | 1,000         | -               | 所有 Data API 端点合计。             |
| Data `/trades`                      | 200           | -               | 成交历史。                           |
| Data `/positions`                   | 150           | -               | 当前持仓。                           |

### WebSocket 限制

WebSocket 配额不在公布的 REST 速率限制表中。适配器通过将订阅分片到市场连接池，强制执行 `ws_max_subscriptions`（默认 200）。

:::warning
超过基于 IP 的限制会触发 Cloudflare 限速。请求使用滑动窗口排队，而不是立即拒绝，但持续超限可能导致 HTTP 429 响应或暂时阻止。
:::

:::info
最新限制请参阅 Polymarket 官方 [CLOB 交易速率限制](https://docs.polymarket.com/api-reference/trading-rate-limits)和[通用速率限制](https://docs.polymarket.com/api-reference/rate-limits)。
:::

## 限制和注意事项

目前已知以下限制：

- 不支持只减仓订单。
- 批量提交（`POST /orders`）每个请求最多接受 15 笔订单；适配器将更大的 `SubmitOrderList` 命令拆成连续的 15 笔订单分块。
- 批量取消（`DELETE /orders`）每个请求最多接受 1,000 个订单 ID；适配器还会将每个新分块限制为签名方当前取消突发容量，并在分块前重新计算该限制。
- 持仓报告省略低于 0.01 份额的余额。不要将报告遗漏视为微量持仓已经归零的证据；低于最小值的剩余量无法通过市场最小订单量退出，而活动市场通常报告最小订单量为 5 份额。因此，持仓对账容忍不超过 0.009999 份额的差异，并对账达到或超过 0.01 份额的差异。

## 客户端配置

Rust 结构体和 Python 类公开相同的客户端配置。只有 `PolymarketDataClientConfig` 上的编程式 `filters` 和 `new_market_filter` trait 对象仅限 Rust。

### 数据客户端选项

类/结构体：`PolymarketDataClientConfig`。

| 选项                                   | 默认值     | 描述                                                       |
| -------------------------------------- | ---------- | ---------------------------------------------------------- |
| `instrument_config`                    | `None`     | 引导范围，作为 `PolymarketInstrumentProviderConfig` 传入。 |
| `filters`                              | `[]`       | 加载和发现期间应用的仅限 Rust 的金融工具筛选器。           |
| `base_url_http`, `base_url_ws`         | `None`     | 覆盖 CLOB HTTP 或 WebSocket 端点。                         |
| `base_url_gamma`, `base_url_data_api`  | `None`     | 覆盖 Gamma 或 Data API 端点。                              |
| `base_url_rtds`                        | `None`     | 覆盖 RTDS 端点。                                           |
| `proxy_url`                            | `None`     | 所有数据传输使用的 HTTP 或 HTTPS 代理。                    |
| `http_timeout_secs`, `ws_timeout_secs` | `60`, `30` | HTTP 和 WebSocket 超时（秒）。                             |
| `ws_max_subscriptions`                 | `200`      | 单连接订阅上限；市场连接池在此边界处分片连接。             |
| `update_instruments_interval_mins`     | `60`       | 金融工具目录刷新间隔；传入 `None` 可禁用。                 |
| `subscribe_new_markets`                | `false`    | 订阅新市场发现事件。                                       |
| `new_market_filter`                    | `None`     | 新发现市场在发出金融工具前应用的仅限 Rust 的筛选器。       |
| `new_market_fetch_max_concurrency`     | `8`        | 限制发现事件并发获取市场的数量。                           |
| `drop_quotes_missing_side`             | `true`     | 丢弃未同时包含买价和卖价的报价。                           |
| `compute_effective_deltas`             | `false`    | 已存在之前订单簿状态时，发出净快照变化。                   |
| `auto_load_missing_instruments`        | `true`     | 为受支持的请求和订阅加载未知金融工具。                     |
| `auto_load_debounce_ms`                | `100`      | 合并并发自动加载请求。                                     |
| `auto_load_max_retries`                | `12`       | 重试暂时性 CLOB 补全缺失；`0` 禁用重试。                   |
| `auto_load_retry_delay_initial_secs`   | `5.0`      | 自动加载初始重试延迟。                                     |
| `auto_load_retry_delay_max_secs`       | `15.0`     | 自动加载最大重试延迟。                                     |
| `resolve_poll_enabled`                 | `true`     | 轮询观察中已到期条件的裁决状态。                           |
| `resolve_poll_interval_secs`           | `30`       | 裁决轮询间隔。                                             |
| `resolve_poll_grace_secs`              | `10`       | 到期后开始轮询前的延迟。                                   |
| `resolve_poll_max_wait_secs`           | `1800`     | 等待达到此时长后暂停自动轮询。                             |
| `transport_backend`                    | `Sockudo`  | WebSocket 传输实现。                                       |

### 执行客户端选项

类/结构体：`PolymarketExecClientConfig`。

| 选项                                                | 默认值              | 描述                                                               |
| --------------------------------------------------- | ------------------- | ------------------------------------------------------------------ |
| `trader_id`                                         | 默认 `TraderId`     | 客户端注册的交易者标识符。                                         |
| `account_id`                                        | `POLYMARKET-001`    | 此执行客户端的账户标识符。                                         |
| `private_key`                                       | `POLYMARKET_PK`     | EIP-712 签名密钥。                                                 |
| `api_key`, `api_secret`, `passphrase`               | 环境变量            | CLOB L2 身份验证凭证。                                             |
| `funder`                                            | `POLYMARKET_FUNDER` | 注资钱包；proxy 和 deposit‑wallet 签名要求其与签名地址不同。       |
| `signature_type`                                    | `Eoa`               | `Eoa`、`PolyProxy`、`PolyGnosisSafe` 或 `Poly1271`。               |
| `base_url_http`, `base_url_ws`, `base_url_data_api` | `None`              | 覆盖相应生产端点。                                                 |
| `proxy_url`                                         | `None`              | 所有执行传输使用的 HTTP 或 HTTPS 代理。                            |
| `http_timeout_secs`                                 | `60`                | HTTP 超时（秒）。                                                  |
| `max_retries`                                       | `3`                 | 单订单提交/取消请求和每个批量取消分块的重试次数。                  |
| `retry_delay_initial_ms`                            | `1000`              | 初始重试延迟。                                                     |
| `retry_delay_max_ms`                                | `10000`             | 最大重试延迟。                                                     |
| `heartbeat_enabled`                                 | `false`             | 执行就绪后立即发送需要身份验证的订单安全心跳，之后每五秒发送一次。 |
| `transport_backend`                                 | `Sockudo`           | WebSocket 传输实现。                                               |

:::warning
启用 `heartbeat_enabled` 会让账户加入 Polymarket 订单安全心跳契约。适配器发送第一个空心跳 ID，串联每个返回 ID，并使用 HTTP 400 响应中的替换 ID 重新同步。Polymarket 在 10 秒内未收到心跳时会取消未结订单，另有 5 秒缓冲。身份验证或交易场所拒绝，或连续两次可重试请求失败，会让执行客户端报告为已断开，直到显式断开并重新连接。
:::

### 代理路由

设置 `proxy_url`，对该客户端拥有的每种传输应用同一个 HTTP 或 HTTPS 代理。数据客户端通过代理路由 CLOB HTTP、Gamma HTTP、Data API HTTP、市场 WebSocket 连接池和 RTDS。执行客户端通过代理路由已认证 CLOB HTTP、Data API HTTP 和已认证用户 WebSocket。同时运行数据和执行时，应在两个客户端上配置相同值。

SOCKS URL 和格式错误 URL 无法通过配置验证。`proxy_url` 为 `None` 时，适配器不显式配置代理：HTTP 保留 reqwest 的环境代理行为，WebSocket 直接连接。包含凭证的代理 URL 应视为敏感信息，因为序列化配置包含所提供 URL。Python 只公开 `has_proxy_url`；配置 `Debug` 输出和传输诊断会脱敏代理凭证。

批量提交从不重试，因为 Polymarket 不公开幂等键。除非存在 `funder` 且与签名地址不同，否则 proxy 签名客户端会在构建期间失败。

### 金融工具提供程序选项

将 `PolymarketInstrumentProviderConfig` 作为数据客户端配置的 `instrument_config` 传入。

| 选项                 | 默认值  | 描述                                   |
| -------------------- | ------- | -------------------------------------- |
| `load_all`           | `false` | 启动时加载完整交易场所目录。           |
| `load_ids`           | `None`  | 加载确切 Vibe 金融工具 ID。            |
| `filters`            | `None`  | 已验证的 Gamma 市场 keyset 筛选器。    |
| `event_slugs`        | `None`  | 引导时解析所列事件的所有市场。         |
| `market_slugs`       | `None`  | 引导时加载所列 Gamma 市场 slug。       |
| `event_slug_builder` | `None`  | Rust 支持的 Up/Down 事件 slug 生成器。 |
| `log_warnings`       | `true`  | 发出提供程序警告。                     |
| `use_gamma_markets`  | `false` | 保留的兼容字段，无额外作用。           |

#### Gamma 查询筛选器

适配器使用 Gamma 市场和事件 keyset 端点。它会在第一次 HTTP 请求前验证筛选器，跟随 `next_cursor`，并应用每页 100 个市场和 500 个事件的端点上限。

市场 keyset 字段：

| 类别     | 字段                                                                                                                                                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 标量     | `limit`, `order`, `ascending`, `closed`, `decimalized`, `liquidity_num_min`, `liquidity_num_max`, `volume_num_min`, `volume_num_max`, `start_date_min`, `start_date_max`, `end_date_min`, `end_date_max`, `related_tags`, `tag_match`, `cyom`, `rfq_enabled`, `uma_resolution_status`, `game_id`, `include_tag`, `locale` |
| 重复     | `id`, `slug`, `clob_token_ids`, `condition_ids`, `question_ids`, `market_maker_address`, `tag_id`, `sports_market_types`                                                                                                                                                                                                  |
| 兼容性   | `active`, `archived`                                                                                                                                                                                                                                                                                                      |
| 别名     | `is_active`                                                                                                                                                                                                                                                                                                               |
| 仅客户端 | `offset`, `max_markets`                                                                                                                                                                                                                                                                                                   |

提供程序 `filters` 字典只接受市场字段。Rust 调用方使用 `EventParamsFilter` 和 `GetGammaEventsParams` 配置事件发现；`live` 或 `tag_slug` 等仅事件字段不是有效的提供程序字典键。

事件 keyset 字段：

| 类别     | 字段                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 标量     | `limit`, `order`, `ascending`, `closed`, `live`, `featured`, `cyom`, `title_search`, `liquidity_min`, `liquidity_max`, `volume_min`, `volume_max`, `start_date_min`, `start_date_max`, `end_date_min`, `end_date_max`, `start_time_min`, `start_time_max`, `tag_slug`, `related_tags`, `tag_match`, `event_date`, `event_week`, `featured_order`, `recurrence`, `parent_event_id`, `include_children`, `partner_slug`, `include_chat`, `include_template`, `include_best_lines`, `locale` |
| 重复     | `id`, `slug`, `tag_id`, `exclude_tag_id`, `series_id`, `game_id`, `created_by`                                                                                                                                                                                                                                                                                                                                                                                                            |
| 兼容性   | `active`, `archived`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 仅客户端 | `offset`, `max_events`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

重复字段作为重复查询键发送。`offset` 应用于返回的 keyset 页面之间，绝不发送到 Gamma。`max_markets` 在本地限制市场数，每个二元市场通常生成两个金融工具。`max_events` 在本地限制事件数；每个事件可以包含多个市场。`condition_ids` 最多接受 100 个值，事件 `tag_id` 值不得与 `exclude_tag_id` 值重叠。

提供程序 `filters` 字典在原生 Rust 配置中只接受字符串；将映射形式的 Python 配置转换时，也接受 Python `bool`、`int`、有限 `float`、字符串或这些标量值的列表。Python 转换会忽略 `None` 条目；原生配置条目必须为字符串。`is_active=true` 会提供 `active=true`、`archived=false` 和 `closed=false`；显式值会覆盖这些默认值。未知键、格式错误值、空列表、无效日期或数值边界及无效组合，会在 Python 配置转换期间引发 `ValueError`。

交易场所契约请参阅官方[市场 keyset](https://docs.polymarket.com/api-reference/markets/list-markets-keyset-pagination)和[事件 keyset](https://docs.polymarket.com/api-reference/events/list-events-keyset-pagination)参考。

#### 事件 slug 构建器

适配器将 Python 视为配置、工厂和用户策略边界。提供程序、数据和执行操作在 Rust 中运行。因此 `event_slug_builder` 接受 Rust 支持的 `PolymarketUpDownEventSlugConfig`，不接受 Python callable 路径。

使用该构建器可在不下载完整交易场所目录的情况下生成可预测的 Polymarket Up/Down 事件 slug。构建器为配置窗口内对齐的时间段生成 `{asset}-updown-{interval_mins}m-{unix_timestamp}` 格式的 slug。

```python
from vibe_trader.adapters.polymarket import PolymarketInstrumentProviderConfig
from vibe_trader.adapters.polymarket import PolymarketUpDownEventSlugConfig

instrument_config = PolymarketInstrumentProviderConfig(
    event_slug_builder=PolymarketUpDownEventSlugConfig(
        assets=["btc"],
        interval_mins=5,
        periods=3,
        start_offset_periods=0,
    ),
)
```

对于自定义事件模式，请传入显式 `event_slugs`、直接 `market_slugs`，或添加 Rust 筛选器或构建器。适配器拒绝 Python callable `event_slug_builder` 值，避免实盘交易期间适配器操作跨入 Python。

## Python 发现和历史数据

Python 包导出 Rust 支持的 `PolymarketDataLoader`，用于公共发现、金融工具构建和历史成交。它使用 Rust Gamma、CLOB 和 Data API 客户端，因此不需要交易凭证，也不会在 Python 中运行网络操作。

所有网络方法都是异步的。使用市场 slug 构建加载器，并按索引选择其结果代币：

```python
from vibe_trader.adapters.polymarket import PolymarketDataLoader

loader = await PolymarketDataLoader.from_market_slug(
    "will-jd-vance-win-the-2028-us-presidential-election",
    token_index=0,
)

instrument = loader.instrument
token_id = loader.token_id
condition_id = loader.condition_id
```

`instrument` 是规范化的 `BinaryOption`。携带解析结果的字段绝不会进入 `instrument.info`。回测或模拟后请单独读取：

```python
metadata = loader.resolution_metadata
winner = next(
    (token["outcome"] for token in metadata["tokens"] if token["winner"]),
    None,
)
```

事件工厂为事件中的每个市场返回一个加载器：

```python
loaders = await PolymarketDataLoader.from_event_slug(
    "how-many-fed-rate-cuts-in-2026",
    token_index=1,
)
```

负代币索引或超出市场代币列表的索引会引发 `ValueError`。Gamma 没有匹配 slug，或 CLOB 尚未填充可用代币 ID 时，构建也会明确失败。

### 公共发现

静态查询方法返回稳定的 Python 映射和列表，而验证和分页由 Rust 负责：

```python
market = await PolymarketDataLoader.query_market_by_slug("some-market")
details = await PolymarketDataLoader.query_market_details(market["conditionId"])
event = await PolymarketDataLoader.query_event_by_slug("some-event")

markets = await PolymarketDataLoader.query_markets(
    filters={
        "is_active": True,
        "tag_id": [21, 42],
        "order": "volume",
        "max_markets": 200,
    },
)
events = await PolymarketDataLoader.query_events(
    filters={
        "active": True,
        "closed": False,
        "max_events": 100,
    },
)
tags = await PolymarketDataLoader.query_tags()
results = await PolymarketDataLoader.query_search(
    "bitcoin",
    events_status="active",
    limit_per_type=20,
)
```

市场和事件筛选器字典使用 [Gamma 查询筛选器](#gamma-查询筛选器)中列出的字段。提供程序配置只接受市场字段，`query_events` 接受事件字段。未知或格式错误筛选器会在请求前引发 `ValueError`。

### 历史成交

`load_trades` 按时间顺序返回规范化 `TradeTick` 对象：

```python
from datetime import UTC, datetime, timedelta

end = datetime.now(UTC)
start = end - timedelta(days=1)

trades = await loader.load_trades(
    start=start,
    end=end,
    limit=1_000,
)
```

时间窗口包含边界。Data API 以整秒记录成交时间戳，因此 Rust 会保留 `start` 和 `end` 边界秒内的所有成交。提供 `start` 时，`limit` 保留窗口中最早的匹配成交；不提供 `start` 时，保留最近的匹配成交。公共 API 将基于偏移量的分页限制为 10,000；达到上限时，无锚点请求返回可用的部分结果并记录警告。以起始时间为锚点的请求会在上限处引发错误，因为 Rust 无法保证从请求起点开始结果完整；请缩小时间窗口并重试。

## 贡献

:::info
如需增加功能或为 Polymarket 适配器贡献代码，请参阅[贡献指南](https://github.com/qOeOp/trade/blob/main/CONTRIBUTING.md)。
:::
