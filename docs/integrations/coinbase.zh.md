# Coinbase

Coinbase 成立于 2012 年，是美国受监管规模最大的加密货币交易所之一，通过 Advanced Trade API 提供现货、永续掉期和有到期日期货交易。该适配器通过共享执行客户端，支持现货（Cash）和 CFM 衍生品（Margin）账户的实盘市场数据接入和订单执行；账户类型由工厂选择（请参阅[执行范围](#执行范围)）。

## 概述

Coinbase 适配器使用 Rust 实现，并通过配置、工厂、枚举和常量向 Python 公开。

组件：

- `CoinbaseHttpClient`：双层 REST 客户端（原始端点方法和领域包装器）。
- `CoinbaseWebSocketClient`：使用 JWT 订阅身份验证的底层 WebSocket 连接。
- `CoinbaseInstrumentProvider`：金融工具解析和加载。
- `CoinbaseDataClient`：市场数据馈送管理器。
- `CoinbaseDataClientFactory`：数据客户端工厂。
- `CoinbaseExecutionClient`：执行客户端（现货或 CFM 衍生品；REST 订单和 WS 数据流）。
- `CoinbaseExecutionClientFactory`：执行客户端工厂；根据配置中的 `account_type` 选择现货或 CFM 衍生品。

`vibe_trader.adapters.coinbase` 提供的 Python 接口：

- `CoinbaseDataClientConfig`, `CoinbaseExecClientConfig`
- `CoinbaseDataClientFactory`, `CoinbaseExecutionClientFactory`
- `CoinbaseEnvironment`, `CoinbaseMarginType`
- `COINBASE`, `COINBASE_CLIENT_ID`, and `COINBASE_VENUE`

## 示例

- [Python 示例](https://github.com/qOeOp/trade/tree/main/examples/live/coinbase/)
- [Rust 示例](https://github.com/qOeOp/trade/tree/main/crates/adapters/coinbase/examples/)

## Coinbase 文档

Coinbase 为 Advanced Trade API 提供以下文档：

- [REST API 参考](https://docs.cdp.coinbase.com/advanced-trade/reference)
- [WebSocket 频道](https://docs.cdp.coinbase.com/advanced-trade/docs/ws-channels)
- [API 密钥身份验证](https://docs.cdp.coinbase.com/coinbase-app/authentication-authorization/api-key-authentication)
- [速率限制](https://docs.cdp.coinbase.com/advanced-trade/docs/rate-limits)

建议结合 Coinbase 文档和本 VibeTrader 集成指南使用。

:::info
此适配器面向 Coinbase Advanced Trade API。独立的 [Coinbase International Exchange（INTX）](https://international.coinbase.com)交易场所由专用 `coinbase_intx` 适配器支持。
:::

## 产品

产品是多个相关金融工具类型的统称。

支持以下产品类型：

| 产品类型 | 支持 | 说明                                          |
| -------- | ---- | --------------------------------------------- |
| 现货     | ✓    | 以 USD、USDC 和 USDT 计价的现货交易对。       |
| 永续合约 | ✓    | FCM 交易场所上以 USD 为保证金的永续掉期。     |
| 期货合约 | ✓    | 有到期日的交割期货（微型 BTC、微型 ETH 等）。 |

## 符号规则

Coinbase 直接使用交易场所原生的 `product_id` 字段作为 Vibe 符号。金融工具 ID 为 `{product_id}.COINBASE`。

| 产品     | 格式                            | 示例                                    |
| -------- | ------------------------------- | --------------------------------------- |
| 现货     | `{base}-{quote}`                | `BTC-USD`、`ETH-USDC`、`SOL-USDT`。     |
| 永续合约 | `{contract_code}-{ddMMMyy}-CDE` | `BIP-20DEC30-CDE`（BTC PERP）。         |
| 到期期货 | `{contract_code}-{ddMMMyy}-CDE` | `BIT-24APR26-CDE`（BTC 2026 年 4 月）。 |

`-CDE` 后缀表示 Coinbase Derivatives Exchange（FCM 交易场所）。永续合约带有交易所分配的远期到期日（例如 `20DEC30`），但会根据持续存在的资金费率归类为 `CryptoPerpetual`。有到期日的期货归类为 `CryptoFuture`。

适配器根据 API 元数据从结构上解析产品类型（`future_product_details.contract_expiry_type`；当其为 `EXPIRING` 时，还会将非空 `future_product_details.funding_rate` 作为仅永续合约具有的结构信号）；回退启发式会检查 `display_name` 中是否包含 `PERP` 或 `Perpetual` 子串。

完整 Vibe 金融工具 ID 示例：

- `BTC-USD.COINBASE`（Bitcoin/USD 现货）。
- `ETH-USDC.COINBASE`（Ether/USDC 现货）。
- `BIP-20DEC30-CDE.COINBASE`（BTC 永续掉期）。
- `BIT-24APR26-CDE.COINBASE`（BTC 有到期日期货，2026 年 4 月）。

### 别名产品（USDC 和 USD）

Coinbase 将同一交易对的 USDC 和 USD 计价版本合并到同一个撮合引擎订单簿中，并通过 `GET /products` 的 `alias` 和 `alias_to` 字段公开两者关系：

```text
BTC-USD :  alias=""        alias_to=["BTC-USDC"]   # canonical
BTC-USDC:  alias="BTC-USD" alias_to=[]             # alias of BTC-USD
```

调用方使用别名侧订阅或提交时，交易场所会在线协议上将请求改写为规范 ID。适配器会透明处理这一过程：引导时记录 `product_id -> alias` 映射，在订阅和提交订单时发送规范 ID，在 WebSocket 客户端上注册反向映射，并在解析前将入站消息重新设置为调用方提供的 ID。

因此，只持有 USDC 的策略可以端到端交易 `BTC-USDC.COINBASE`，无需引用规范 `BTC-USD`。结算货币由提交的 `product_id` 决定，所以在 `BTC-USDC.COINBASE` 上下单始终借记或贷记 USDC 钱包。

## 环境

Coinbase 提供两种交易环境。请使用客户端配置中的 `environment` 字段选择相应环境。

| 环境 | `environment` 值              | REST 基础 URL                      |
| ---- | ----------------------------- | ---------------------------------- |
| 实盘 | `CoinbaseEnvironment.LIVE`    | `https://api.coinbase.com`         |
| 沙盒 | `CoinbaseEnvironment.SANDBOX` | `https://api-sandbox.coinbase.com` |

### 实盘（生产）

实盘环境是使用真实资金交易的默认环境。

```python
config = CoinbaseExecClientConfig(
    api_key="YOUR_API_KEY",
    api_secret="YOUR_API_SECRET",
    # environment=CoinbaseEnvironment.LIVE (default)
)
```

环境变量：`COINBASE_API_KEY`、`COINBASE_API_SECRET`。

### 沙盒

沙盒是用于集成接线的静态模拟测试环境，详见[沙盒文档](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/sandbox)。

```python
config = CoinbaseExecClientConfig(
    api_key="ANY_NON_EMPTY_STRING",  # required by the adapter constructor
    api_secret="ANY_NON_EMPTY_STRING",
    environment=CoinbaseEnvironment.SANDBOX,
)
```

沙盒交易场所不强制身份验证，但 `CoinbaseExecutionClient::new` 仍要求同时提供这两个字段（或相应环境变量），才能完成构建。

:::warning
**沙盒不是并行交易场所：**

- 所有响应都是静态预定义值；不存在实盘市场或动态定价。
- 只有 Accounts 和 Orders 端点可用；其他资源不可用。
- 不要求也不强制身份验证。
- 自定义 `X-Sandbox` 请求头可以触发预定义错误情形。

沙盒可用于接通客户端并验证请求/响应结构；任何真实行为测试都应谨慎使用生产环境（涉及真实资金）。
:::

## 身份验证

Coinbase Advanced Trade 使用 ES256 JWT 身份验证。每个 REST 请求和每条 WebSocket 订阅都会生成一个使用 EC 私钥签名的短期 JWT。适配器从环境变量或配置字段中解析凭证。

### 创建 API 密钥

Coinbase 提供多种密钥类型。适配器要求使用签名算法为 **ECDSA**（而非 Ed25519）的 **Coinbase App Secret API 密钥**。

<Steps>
<Step>
前往 CDP 门户的 API 密钥页面：
[portal.cdp.coinbase.com/projects/api-keys](https://portal.cdp.coinbase.com/projects/api-keys)。
</Step>
<Step>
选择 **Secret API Keys** 标签页并点击 **Create API key**。
</Step>
<Step>
输入昵称（例如 `vibe-trading`）。
</Step>
<Step>
展开 **API restrictions**，将权限设置为 **View** 和 **Trade**。
</Step>
<Step>
展开 **Advanced Settings**，将签名算法从 Ed25519 更改为 **ECDSA**。此步骤为必需操作：Ed25519 密钥不能用于 Advanced Trade API。
</Step>
<Step>
点击 **Create API key**。保存弹窗中的密钥名称和私钥。密钥名称类似 `organizations/{org_id}/apiKeys/{key_id}`。私钥是 PEM 编码的 EC 密钥（SEC1 格式）。
</Step>
</Steps>

:::warning
Coinbase 不再自动下载密钥文件。关闭创建弹窗前，请复制其中的值或点击下载按钮。之后无法再次获取私钥。
:::

:::info
请勿使用已过期的旧版 Coinbase App API 密钥。请创建 CDP API 密钥并选择 ECDSA 算法；适配器使用 ES256 为请求签名。请参阅 Coinbase 的[旧版密钥迁移指南](https://docs.cdp.coinbase.com/coinbase-app/authentication-authorization/legacy-keys)。
:::

完整详情请参阅 Coinbase [API 密钥身份验证指南](https://docs.cdp.coinbase.com/coinbase-app/authentication-authorization/api-key-authentication)。

### 环境变量

| 变量                  | 描述                                                    |
| --------------------- | ------------------------------------------------------- |
| `COINBASE_API_KEY`    | 密钥名称（`organizations/{org_id}/apiKeys/{key_id}`）。 |
| `COINBASE_API_SECRET` | PEM 编码的 EC 私钥（完整多行字符串）。                  |

示例：

```bash
export COINBASE_API_KEY="organizations/abc-123/apiKeys/def-456"
export COINBASE_API_SECRET="$(cat ~/path/to/cdp_api_key.pem)"
```

:::tip
建议使用环境变量管理凭证。
:::

### JWT 有效期

Coinbase JWT 在 120 秒后过期。根据 [WebSocket 概述](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-overview)，每条需要身份验证的 WebSocket 消息（即每次订阅）都必须生成不同的 JWT。适配器会为每个签名 REST 请求和每条需要身份验证的订阅消息重新生成 JWT，无需手动轮换。

## 投资组合

Coinbase 账户可以包含一个或多个**投资组合**。每个投资组合都有自己的钱包（USD、USDC、BTC 等）、余额和订单范围。每个账户都有一个 `DEFAULT` 投资组合；用户可以创建额外的 `CONSUMER` 投资组合，以隔离策略、风险或税务批次。

CDP API 密钥在创建时会**绑定到单个投资组合**。除非显式指定其他投资组合，否则每个经过身份验证的请求（账户查询、订单提交、取消）都作用于该投资组合。

### 查找投资组合 UUID

运行适配器中需要身份验证的探测二进制文件；它会输出 CDP 密钥可见的投资组合、绑定投资组合中的账户余额，以及几个参考 REST 调用：

```bash
cargo run --bin coinbase-http-private --package vibe-coinbase
```

输出示例：

```
Found 1 portfolio(s)
  name=Default type=DEFAULT uuid=ca7244bc-21d1-5e4c-bfe5-80f208ac5723 deleted=false
Account has 3 balance(s)
  USDC total=100.00000000 USDC free=100.00000000 USDC locked=0.00000000 USDC
  AUD total=0.00 AUD free=0.00 AUD locked=0.00 AUD
  BTC total=0.00000000 BTC free=0.00000000 BTC locked=0.00000000 BTC
```

等效 curl（需要先使用 CDP PEM 密钥自行签署 ES256 JWT）：

```bash
curl -H "Authorization: Bearer $JWT" \
  https://api.coinbase.com/api/v3/brokerage/portfolios
```

### 何时需要 `retail_portfolio_id`

Coinbase 的 `POST /orders` 端点默认路由到密钥绑定的投资组合，因此只有单个投资组合的账户无需设置此字段。在以下任一情况成立时，请在 [`CoinbaseExecClientConfig`](#执行客户端配置选项) 上设置该字段：

- 账户包含多个投资组合，而你希望针对非密钥默认值的投资组合进行交易。
- 交易场所以 `account is not available` 拒绝订单，并且已经排除下述钱包问题。

### 创建新投资组合

大多数用户无需创建新投资组合；账户默认投资组合可直接使用。只有需要以下能力时，才在 [coinbase.com/portfolios](https://www.coinbase.com/portfolios) 创建投资组合：

- 将 API 驱动的交易与手动零售活动隔离。
- 隔离不同策略之间的风险或盈亏。
- 绕过受限的默认投资组合（例如 Vault）。

创建投资组合后，请先为其注资（在 coinbase.com 上从默认投资组合的钱包转账），再发送订单；否则交易场所会针对计价货币返回 `account is not available`。

### `account is not available` 故障排除

交易场所会因多种不同原因返回此错误；请运行上述探测二进制文件并检查投资组合的钱包列表进行诊断。

| 症状                                             | 可能原因                                                                                                                       | 修复方法                                                                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 只拒绝特定产品（例如只有 USDC 时交易 `BTC-USD`） | 投资组合缺少该产品计价货币的钱包。USD 和 USDC 在 Coinbase 上彼此独立，交易场所根据提交的 `product_id` 而不是规范别名路由订单。 | 针对所持计价货币的产品提交（例如 USDC 钱包使用 `BTC-USDC`）。适配器会在内部解析数据侧别名，无需更改配置。也可以通过 coinbase.com 为缺失的钱包注资，但只持有一种货币时没有必要。 |
| 所有产品的每笔订单都被拒绝                       | 密钥绑定到非默认投资组合，且未设置 `retail_portfolio_id`。                                                                     | 在 `CoinbaseExecClientConfig` 上将 `retail_portfolio_id` 设为目标投资组合 UUID。                                                                                                |
| 非美国账户的 `*-USD` 产品被拒绝                  | 司法辖区限制（例如 AU 账户不能交易以 USD 计价的交易对）。                                                                      | 使用本地可用的计价货币（USDC、AUD、EUR 等），而不是 USD。                                                                                                                       |
| 轮换密钥后立即被拒绝                             | 新密钥创建在与旧密钥不同的投资组合中。                                                                                         | 更新 `retail_portfolio_id` 以匹配新密钥的投资组合，或转移资金。                                                                                                                 |

## 订单能力

下表描述 Coinbase **交易场所**的订单接口。交付的 [`CoinbaseExecutionClient`](#执行范围) 根据配置的 `account_type` 处理现货或 CFM 衍生品。Coinbase 的订单能力在现货和衍生品之间有所不同（永续合约和有到期日期货使用相同的 FCM 订单接口）。

### 执行范围

`CoinbaseExecutionClientFactory` 生成单一的 `CoinbaseExecutionClient` 类型。产品系列由 `CoinbaseExecClientConfig` 的 `account_type` 字段选择：

| `account_type`        | 引导金融工具                                   | 账户状态来源                                                                                     |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `AccountType::Cash`   | 仅 `CoinbaseProductType::Spot`。               | `/accounts` REST 端点。                                                                          |
| `AccountType::Margin` | `CoinbaseProductType::Future`（永续 + 到期）。 | CFM `balance_summary` REST + `futures_balance_summary` WS，以及来自 `cfm/positions` 的持仓报告。 |

其他账户类型会在工厂创建时被拒绝。OMS 始终为 `Netting`，因为交易场所不公开对冲模式。

为防止跨账户数据混入：

1. 连接时的金融工具引导仅限已配置的产品系列；另一系列的产品绝不会进入进程内缓存。
2. `submit_order` 拒绝金融工具不在该缓存中的任何订单。
3. `generate_order_status_report(s)` 和 `generate_fill_reports` 会使用同一缓存对输出进行后置筛选，因此同时具有现货和衍生品活动的 Coinbase 账户不会通过单个客户端公开另一范围的报告。

每个范围运行一个执行客户端；如果同一个交易者同时需要现货和 CFM 活动，请使用不同的 `account_type` 值（以及不同的 `account_id`）实例化两个客户端。

### 订单类型

该矩阵列出 Vibe 模型公开的订单类型。右列显示适配器发出的相应 `order_configuration` 键。表中未列出的 Coinbase 订单类型（TWAP、Bracket、Scaled、SOR LIMIT IOC）记录在[高级订单功能](#高级订单功能)中，并注明适配器*尚不支持*。

| 订单类型               | 现货 | 永续合约 | 期货 | 线协议结构                                                       |
| ---------------------- | ---- | -------- | ---- | ---------------------------------------------------------------- |
| `MARKET`               | ✓    | ✓        | ✓    | `market_market_ioc`（现货 + CFM）；`market_market_fok`（仅 CFM） |
| `LIMIT`                | ✓    | ✓        | ✓    | `limit_limit_gtc` / `limit_limit_gtd` / `limit_limit_fok`        |
| `STOP_LIMIT`           | -    | ✓        | ✓    | `stop_limit_stop_limit_gtc` / `stop_limit_stop_limit_gtd`        |
| `STOP_MARKET`          | -    | -        | -    | *交易场所未公开*。                                               |
| `MARKET_IF_TOUCHED`    | -    | -        | -    | *交易场所未公开*。                                               |
| `LIMIT_IF_TOUCHED`     | -    | -        | -    | *交易场所未公开*。                                               |
| `TRAILING_STOP_MARKET` | -    | -        | -    | *交易场所未公开*。                                               |

### 执行指令

| 指令          | 现货 | 永续合约 | 期货 | 说明                        |
| ------------- | ---- | -------- | ---- | --------------------------- |
| `post_only`   | ✓    | ✓        | ✓    | 仅 LIMIT GTC 和 LIMIT GTD。 |
| `reduce_only` | -    | ✓        | ✓    | 仅衍生品。                  |

### 有效期

适配器接受此矩阵中的值；未列出的组合会在提交时以 `"Unsupported TIF {tif} for {order_type}"` 被拒绝。

| 订单类型     | GTC | GTD | IOC | FOK | 说明                                                                                                                                                                |
| ------------ | --- | --- | --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MARKET`     | ✓   | -   | ✓   | (✓) | GTC 映射到 IOC；遵循显式 IOC。FOK 构建交易场所的 `market_market_fok` 结构，但撮合引擎目前会在现货上以 `UNSUPPORTED_ORDER_CONFIGURATION` 拒绝；只能用于 CFM 衍生品。 |
| `LIMIT`      | ✓   | ✓   | -   | ✓   | GTD 要求 `expire_time`。尚不支持 LIMIT IOC（请参阅 [SOR LIMIT IOC](#高级订单功能)）。                                                                               |
| `STOP_LIMIT` | ✓   | ✓   | -   | -   | 要求 `trigger_price`。仅衍生品。                                                                                                                                    |

### 高级订单功能

| 功能          | 现货 | 永续合约 | 期货 | 说明                                                                     |
| ------------- | ---- | -------- | ---- | ------------------------------------------------------------------------ |
| 修改订单      | ✓    | ✓        | ✓    | 仅 GTC 变体（LIMIT、STOP_LIMIT、Bracket）；其他类型使用取消并替换。      |
| Bracket 订单  | -    | -        | -    | *尚不支持*。交易场所公开 `trigger_bracket_gtc` / `trigger_bracket_gtd`。 |
| OCO 订单      | -    | -        | -    | 交易场所未将其作为独立订单类型公开。                                     |
| Iceberg 订单  | -    | -        | -    | *交易场所未公开*。                                                       |
| TWAP 订单     | -    | -        | -    | *尚不支持*。交易场所公开 `twap_limit_gtd`。                              |
| Scaled 订单   | -    | -        | -    | *尚不支持*。交易场所公开 `scaled_limit_gtc`。                            |
| SOR LIMIT IOC | -    | -        | -    | *尚不支持*。交易场所为智能路由的 LIMIT IOC 公开 `sor_limit_ioc`。        |

底层交易场所规格请参阅[创建订单参考](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/create-order)和[编辑订单参考](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/edit-order)。

### 持仓控制（衍生品）

| 控制       | 说明                               |
| ---------- | ---------------------------------- |
| 杠杆       | 每笔订单设置；默认 `1.0`。         |
| 保证金类型 | 每笔订单设置：全仓（默认）或逐仓。 |
| 持仓模式   | 仅单向；不公开对冲模式。           |

### 批量操作

| 操作     | 说明                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------- |
| 批量提交 | 不支持。每笔订单对应一个 `Create Order` 请求。                                                                          |
| 批量修改 | 不支持。每次编辑对应一个 `Edit Order` 请求。                                                                            |
| 批量取消 | `POST /api/v3/brokerage/orders/batch_cancel` 接受 `order_ids` 数组。没有记录最大大小；响应包含每笔订单的成功/失败结果。 |

### 订单查询

| 功能         | 现货 | 永续合约 | 期货 | 说明                               |
| ------------ | ---- | -------- | ---- | ---------------------------------- |
| 查询未结订单 | ✓    | ✓        | ✓    | 列出所有活动订单。                 |
| 查询订单历史 | ✓    | ✓        | ✓    | 使用游标分页的历史订单数据。       |
| 订单状态更新 | ✓    | ✓        | ✓    | 通过 `user` 频道获取实时状态变化。 |
| 交易历史     | ✓    | ✓        | ✓    | 执行和成交报告。                   |

### 现货交易限制

- 现货订单不支持 `reduce_only`（该指令适用于衍生品）。
- 不支持追踪止损订单。
- 现货不提供原生止损限价订单和 Bracket 订单。
- 支持以计价货币计量的 MARKET 订单；LIMIT 订单以基础货币单位计量。

### 衍生品交易

Coinbase 衍生品通过 FCM（Futures Commission Merchant）交易场所交易。执行客户端通过与现货相同的 `POST /orders` 端点提交订单；每笔订单的 `leverage` 和 `margin_type`（`CROSS` 或 `ISOLATED`）默认值来自 `CoinbaseExecClientConfig.default_leverage` 和 `default_margin_type`。保证金余额同时通过 REST `cfm/balance_summary` 端点（连接时快照、`query_account` 和 WebSocket 重连时）以及需要身份验证的 `futures_balance_summary` WebSocket 频道更新。持仓报告来自 REST `cfm/positions` 端点。

Coinbase Advanced Trade API 的创建订单 schema 未记录 `reduce_only` 字段，尽管交易场所的失败原因枚举承认这一概念。客户端为保持 API 一致性，在其 `submit_order` 签名中传递 `reduce_only`，并且只在该值为 `true` 时将标志加入线协议；如果交易场所之后接受该字段，无需修改客户端。

#### 资金费率

适配器以 `derivatives_poll_interval_secs`（默认 15 秒）为间隔轮询 REST `/products/{id}` 端点，并在 FCM `future_product_details` 载荷中存在 `funding_rate` 时发出 `FundingRateUpdate`。资金费率间隔从 `funding_interval` 字段解析（通常为 `"3600s"`，即每小时一次），下一资金费率时间戳来自 `funding_time`。Coinbase Advanced Trade 不在 WebSocket `ticker` 频道发布 `funding_rate`，因此 REST 轮询是唯一实盘来源。

历史资金费率请求（`DataTester` TC-D53）尚未实现；未来版本可以使用同一个 REST 产品端点，并根据连续资金费率时间戳派生间隔。

#### 金融工具状态

首次订阅时，`subscribe_instrument_status` 会加入 Coinbase WebSocket `status` 频道（交易场所为所有产品发布一个状态馈送），将入站事件筛选到已订阅的金融工具，并发出 `InstrumentStatus` 事件：`online` 对应 `MarketStatusAction::Trading`，`offline` 对应 `Halt`，`delisted` 对应 `Close`。报告空 `status` 字符串的期货产品没有可供数据引擎使用的信息，因此会被跳过。取消订阅最后一个金融工具后，会移除频道订阅。

#### 持仓对账

对于 Cash（现货）账户，客户端不返回持仓报告，因为 Coinbase 现货没有持仓。对于 Margin 账户，持仓报告来自 REST `cfm/positions`（列表）和 `cfm/positions/{product_id}`（单个）端点，并会根据引导金融工具缓存进行后置筛选。连接时以及 `LiveExecEngineConfig` 设置的标准对账间隔内，会通过 REST 的 `generate_order_status_report(s)` 和 `generate_fill_reports` 对账未结订单和历史成交。

#### 成交去重

用户频道 WebSocket 可能在重连时重放事件。执行客户端维护一个容量为 10,000 的 FIFO 去重结构，以 `(venue_order_id, trade_id)` 为键，并丢弃合成成交 ID 与近期已见 ID 匹配的成交。累计状态映射也限制为相同容量，以防订单在此客户端生命周期内始终未收到终结事件。长时间断开连接（超出内存去重窗口）后，重放的成交可能发出重复 `FillReport` 值；此时策略应依靠 REST 对账恢复规范状态。

## 执行客户端行为

本节介绍 `CoinbaseExecutionClient` 如何将 Vibe 订单命令和 Coinbase 交易场所事件转换为 Vibe 执行事件。

### 提交订单

`submit_order` 直接根据 Vibe 订单字段构建 Coinbase `order_configuration` 结构：

- `MARKET` -> `market_market_ioc`。只接受 `TimeInForce::Ioc` 和 `Gtc`（Vibe 默认值）；市价订单上任何显式 `Fok`、`Day` 或 `Gtd` 都会在 HTTP 调用前被拒绝，避免调用方在不知情的情况下得到 IOC 语义。使用 `Gtc` 构建的 `MARKET` 订单会在交易场所以 IOC 执行；需要严格保持回测/实盘一致性的策略，应使用显式 `Ioc` 构建 `MarketOrder`。
- `LIMIT` GTC -> `limit_limit_gtc`，GTD -> `limit_limit_gtd`（要求 `expire_time`），FOK -> `limit_limit_fok`。
- `STOP_LIMIT` GTC -> `stop_limit_stop_limit_gtc`，GTD -> `stop_limit_stop_limit_gtd`。止损方向根据订单方向派生（`Buy` -> `STOP_DIRECTION_STOP_UP`，`Sell` -> `STOP_DIRECTION_STOP_DOWN`）。
- 交易场所不公开 `STOP_MARKET`、`MARKET_IF_TOUCHED`、`LIMIT_IF_TOUCHED` 和追踪止损变体。它们会以 `OrderRejected` 呈现，并携带派生提交任务中的 `build_order_configuration` 错误（订单会先作为 `OrderSubmitted` 发出）。

HTTP 创建成功后，会发出携带 `success_response.order_id` 所返回交易场所订单 ID 的 `OrderAccepted`。当响应为 `success=false` 时，会发出包含格式化交易场所失败原因的 `OrderRejected`。交易场所结果未知的 HTTP 失败会让订单保持传输中状态，等待 WebSocket 更新、未结订单轮询或对账。

### 修改订单

`modify_order` 使用类型化 `EditOrderRequest` 向 `/orders/edit` 发出 POST。Coinbase 将编辑限制为 GTC 变体（LIMIT、STOP_LIMIT、Bracket）；其他订单类型必须使用取消并替换。

Coinbase 的 `/orders/edit` 要求同时提供 `price` 和 `size`，即使只修改其中一个字段；省略 `size` 会按 0 读取，并以 `INVALID_EDITED_SIZE` 或 `CANNOT_EDIT_TO_BELOW_FILLED_SIZE` 拒绝。执行客户端会根据缓存订单自动补全缺失字段，因此策略调用 `modify_order(price=X)` 时无需重复当前数量。优先使用 `ModifyOrder` 命令中的值；否则使用缓存订单当前的 `price` 和 `quantity`。

交易场所编辑失败会发出带类型化 `EditOrderResponse` 原因的 `OrderModifyRejected`（优先使用 `edit_failure_reason`，回退到 `preview_failure_reason`）。交易场所结果未知的 HTTP 失败会让订单保持 `PENDING_UPDATE`，直到更新、查询结果或对账将其解析。

### 取消

- `cancel_order` 提交只含单个 ID 的 `batch_cancel`。明确的单笔订单交易场所失败会呈现为 `OrderCancelRejected`；整个请求的传输失败如果导致交易场所结果未知，则让订单保持 `PENDING_CANCEL` 等待对账。
- `cancel_all_orders` 通过 REST 列出未结订单，但不使用仅 `OPEN` 筛选器（因为 Coinbase 的 `OPEN` 筛选器会排除仍可取消的 `PENDING` 和 `QUEUED` 订单）；随后在本地筛选到 `{Submitted, Accepted, Triggered, PendingUpdate, PartiallyFilled}` 和请求的订单方向，再将 `batch_cancel` 调用按每组 100 笔分块。单笔订单的交易场所失败会发出 `OrderCancelRejected`；整个请求失败如果导致交易场所结果未知，则让受影响订单等待对账。
- `batch_cancel_orders` 采用相同的分块方式，并将明确的单笔订单交易场所失败呈现为 `OrderCancelRejected`。交易场所结果未知的传输失败会让受影响订单等待对账。

### 用户 WebSocket 频道

`CoinbaseExecutionClient` 使用新 JWT 订阅不带 `product_ids` 筛选器的 `user` 频道，将每个事件解析为 `OrderStatusReport`，并送入执行事件流。Coinbase 报告每笔订单的累计状态，而不是逐笔成交，因此执行客户端根据累计增量合成 `FillReport`。每笔成交价格按 `(avg_now * qty_now - avg_prev * qty_prev) / delta_qty` 派生，使包含多笔成交的订单携带正确的成交价格，而不是累计加权平均值。对于交易场所将 `leaves_quantity` 置零的终结更新（`CANCELLED`、`EXPIRED`、`FAILED`），会恢复原始数量。

用户频道不会回显 `price`、`stop_price`、`trigger_type` 或 maker/taker 分类。执行客户端会在提交时按 `client_order_id` 缓存这些值，并在发出前补全报告，因此对账器不会观察到 `Some(price) -> None` 分歧，而 `post_only` 成交也会正确标记 `liquidity_side = Maker`。订单状态 `PENDING`、`QUEUED` 和 `OPEN` 均映射到 `OrderStatus::Accepted`，避免用户频道更新与 REST `OrderAccepted` 事件发生竞态时产生错误的反向状态转换警告。

携带 `INVALID_LIMIT_PRICE_POST_ONLY`（或等效的预览/新订单原因）的 `submit_order` 拒绝事件会以 `due_post_only = true` 发出，使策略能够响应仅挂单穿价（通常针对新的 TOB 重新报价）。

重连时，会通过 REST 重新获取账户状态，以恢复断开窗口期间的余额变化。每笔订单的累计跟踪会跨重连保留，使合成成交增量保持正确。

## 速率限制

Coinbase 为 Advanced Trade API 公布以下限制：

| 接口                   | 限制                                                       | 来源                                 |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------ |
| WebSocket 连接         | 每个 IP 地址每秒 8 个                                      | Advanced Trade WebSocket Rate Limits |
| WebSocket 未认证消息   | 每个 IP 地址每秒 8 条                                      | Advanced Trade WebSocket Rate Limits |
| WebSocket 订阅截止时间 | 连接后 5 秒内必须发送第一条订阅消息，否则服务器断开连接    | Advanced Trade WebSocket Overview    |
| 已认证 WebSocket JWT   | 120 秒；每条已认证订阅消息都必须生成新的 JWT               | Advanced Trade WebSocket Overview    |
| 每个密钥的 REST 配额   | 每个 API 密钥每小时 10,000 个请求（Coinbase App 通用策略） | Coinbase App Rate Limiting           |

超过 REST 限制时，Coinbase 返回 HTTP `429` 和以下响应体：

```json
{
  "errors": [
    {
      "id": "rate_limit_exceeded",
      "message": "Too many requests"
    }
  ]
}
```

:::info
截至本文编写时，Advanced Trade 文档尚未单独公布其特有的 REST 配额（每秒上限、每个投资组合限制）；上述 Coinbase App 每小时配额是已记录的最具体数值。参考资料：
[REST 速率限制](https://docs.cdp.coinbase.com/advanced-trade/docs/rest-api-rate-limits/)、
[WebSocket 速率限制](https://docs.cdp.coinbase.com/advanced-trade/docs/ws-rate-limits)、
[Coinbase App 速率限制](https://docs.cdp.coinbase.com/coinbase-app/api-architecture/rate-limiting)。
:::

## 重连和重新订阅

WebSocket 客户端重连时使用指数退避，基数为 250ms，上限为 30s。重连后，订阅会按照创建顺序自动恢复。Coinbase 要求连接后 5 秒内发送订阅消息，否则服务器会断开连接；适配器会在 WebSocket 握手完成后立即发送排队的订阅。

对于需要身份验证的频道（`user`，以及 Margin 客户端上的 `futures_balance_summary`），适配器会为每条订阅消息生成新 JWT；根据 Coinbase 文档，"每发送一条 websocket 消息，都必须生成不同的 JWT，因为 JWT 会在 120 秒后过期"。订阅被接受后，数据流会在 WebSocket 连接的整个生命周期内继续运行，无需进一步身份验证。

执行客户端的 WebSocket 重连时，会从头重建内部客户端（而不是依赖现有连接的状态机），以确保获得新的 `cmd_tx`/`out_rx`/signal 三元组，即使上一个会话的 `Disconnect` 命令在与关闭信号的竞态中丢失。每笔订单的累计跟踪会跨重连保留，使合成成交增量保持正确。

## 配置

### 数据客户端配置选项

| 选项                               | 默认值    | 描述                                                              |
| ---------------------------------- | --------- | ----------------------------------------------------------------- |
| `api_key`                          | `None`    | 回退到 `COINBASE_API_KEY` 环境变量。                              |
| `api_secret`                       | `None`    | 回退到 `COINBASE_API_SECRET` 环境变量。                           |
| `base_url_rest`                    | `None`    | 覆盖 REST 基础 URL。                                              |
| `base_url_ws`                      | `None`    | 覆盖 WebSocket 市场数据 URL。                                     |
| `proxy_url`                        | `None`    | HTTP 和 WebSocket 传输的可选代理 URL。                            |
| `environment`                      | `Live`    | `Live` 或 `Sandbox`。                                             |
| `http_timeout_secs`                | `10`      | HTTP 请求超时（秒）。                                             |
| `ws_timeout_secs`                  | `30`      | WebSocket 超时（秒）。                                            |
| `update_instruments_interval_mins` | `60`      | 金融工具目录刷新间隔。                                            |
| `derivatives_poll_interval_secs`   | `15`      | 发出 `IndexPriceUpdate` 和 `FundingRateUpdate` 的 REST 轮询间隔。 |
| `transport_backend`                | `Sockudo` | WebSocket 传输后端。                                              |

### 执行客户端配置选项

| 选项                     | 默认值    | 描述                                                                                                                                             |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api_key`                | `None`    | 回退到 `COINBASE_API_KEY` 环境变量。                                                                                                             |
| `api_secret`             | `None`    | 回退到 `COINBASE_API_SECRET` 环境变量。                                                                                                          |
| `base_url_rest`          | `None`    | 覆盖 REST 基础 URL。                                                                                                                             |
| `base_url_ws`            | `None`    | 覆盖用户数据 WebSocket URL。                                                                                                                     |
| `proxy_url`              | `None`    | HTTP 和 WebSocket 传输的可选代理 URL。                                                                                                           |
| `environment`            | `Live`    | `Live` 或 `Sandbox`。                                                                                                                            |
| `http_timeout_secs`      | `10`      | HTTP 请求超时（秒）。                                                                                                                            |
| `max_retries`            | `3`       | HTTP 请求最大重试次数。                                                                                                                          |
| `retry_delay_initial_ms` | `100`     | 初始重试延迟（毫秒）。                                                                                                                           |
| `retry_delay_max_ms`     | `5000`    | 最大重试延迟（毫秒）。                                                                                                                           |
| `account_type`           | `Cash`    | 现货使用 `Cash`，CFM 衍生品使用 `Margin`。请参阅[执行范围](#执行范围)。                                                                          |
| `default_margin_type`    | `None`    | 应用于衍生品订单的默认 `CoinbaseMarginType`（`Cross` 或 `Isolated`）。Cash 上忽略。                                                              |
| `default_leverage`       | `None`    | 应用于衍生品订单的默认杠杆。Cash 上忽略。                                                                                                        |
| `retail_portfolio_id`    | `None`    | CDP 零售投资组合 UUID。API 密钥绑定到非默认投资组合时必填（否则交易场所会以 `account is not available` 拒绝订单）。请参阅[投资组合](#投资组合)。 |
| `transport_backend`      | `Sockudo` | WebSocket 传输后端。                                                                                                                             |

配置通过适配器的公共 Python 模块构建：

```python
from vibe_trader.adapters.coinbase import CoinbaseDataClientConfig
from vibe_trader.adapters.coinbase import CoinbaseEnvironment
from vibe_trader.adapters.coinbase import CoinbaseExecClientConfig

data_config = CoinbaseDataClientConfig(
    api_key="YOUR_COINBASE_API_KEY",
    api_secret="YOUR_COINBASE_API_SECRET",
    environment=CoinbaseEnvironment.LIVE,
)

exec_config = CoinbaseExecClientConfig(
    api_key="YOUR_COINBASE_API_KEY",
    api_secret="YOUR_COINBASE_API_SECRET",
    environment=CoinbaseEnvironment.LIVE,
)
```

当前 Python 示例展示了如何在 `LiveNode.builder(...)` 中将这些配置与 `CoinbaseDataClientFactory` 和 `CoinbaseExecutionClientFactory` 配合使用。

## 已知限制

### 交易场所侧

- 修改订单仅限 GTC 订单（LIMIT、STOP_LIMIT、Bracket）；其他类型必须使用取消并替换。
- OCO 订单未作为独立订单类型公开。
- 交易场所不公开追踪止损、MARKET_IF_TOUCHED、LIMIT_IF_TOUCHED 和 Iceberg 订单。
- 不提供批量提交和批量修改；只提供批量取消。
- 沙盒是静态模拟环境（只有 Accounts 和 Orders 端点、预定义响应，没有真实市场数据）。
- 用户频道 WebSocket 报告每笔订单的累计状态，而非逐笔成交。执行客户端根据累计增量派生每笔成交的数量、价格和佣金；每笔成交的 `trade_id` 根据 `(venue_order_id, cumulative_quantity)` 合成。

### 适配器侧

- **实盘与 REST 路径的稳定成交标识不同。** 用户频道不提供 Coinbase 的逐笔成交 `trade_id`，因此实盘 `FillReport` 值使用根据交易场所订单 ID 和累计数量合成的 ID。REST 对账使用交易场所 `trade_id`，所以实盘处理和对账的标识符可能不同。
- **每个客户端只处理一个产品系列。** 提交、修改、取消和报告生成都会筛选到已配置的产品系列（`AccountType::Cash` 下为现货；`AccountType::Margin` 下为永续合约和有到期日期货）。金融工具不在引导缓存中的订单会被拒绝。请参阅[执行范围](#执行范围)。
- **Cash 账户的持仓报告始终为空。** Coinbase 现货没有持仓。衍生品（CFM）持仓报告来自 `cfm/positions`，且只会出现在 Margin 客户端上。
- **用户频道更新省略 `price`、`stop_price` 和 `trigger_type`。** 对于此客户端提交的订单，缺失字段会使用 `submit_order` 时填充的缓存进行补全。对于外部订单（由其他进程或 Coinbase UI 提交），用户频道处理程序首次看到订单时，会获取 `/orders/historical/{venue_order_id}` 并缓存结果，以丰富报告。REST 调用会增加外部订单第一条用户频道更新的延迟；后续更新使用缓存中的补充信息。
- **全部取消和批量取消的 REST 列表失败只会记录日志。** 如果列出未结订单的 REST 调用失败，不会为每笔订单发出 `OrderCancelRejected`；订单会保持 `PendingCancel`，直到下次对账将其恢复。这与 Bybit 适配器模式一致。
- **新挂牌产品需要重连后才能交易。** 金融工具缓存会在连接时填充；之后挂牌的产品不在缓存中，`submit_order` 会将其拒绝。
- **MARKET 订单默认为 IOC。** 使用 Vibe 默认 `TimeInForce::Gtc` 构建的 `MarketOrder` 会在交易场所映射到 `market_market_ioc`。遵循显式 `TimeInForce::Ioc`；`TimeInForce::Fok` 会路由到 `market_market_fok`，但撮合引擎会在现货运行时以 `UNSUPPORTED_ORDER_CONFIGURATION` 拒绝（API 规格记录了该线协议结构，但只有 CFM 衍生品接受）。`Day` 和 `Gtd` 会在提交时被拒绝。

## 身份验证二进制文件

两个二进制文件可用于实盘验证和账户清理：

- `coinbase-http-private` 列出投资组合、输出钱包余额、为 `BTC-USD` 和 `BTC-USDC` 运行 `/orders/preview`，并显示每个产品的准入标志。新账户上线时建议先运行此工具。
- `coinbase-cancel-all-open` 取消通过身份验证的 CDP 密钥下的每笔未结订单。适合在测试运行之间清理挂单。

两者都从环境中读取 `COINBASE_API_KEY` 和 `COINBASE_API_SECRET`。

## 贡献

:::info
如需增加功能或为 Coinbase 适配器贡献代码，请参阅[贡献指南](https://github.com/qOeOp/trade/blob/main/CONTRIBUTING.md)。
:::
