# AX Exchange

[AX Exchange](https://architect.exchange) 是一家受监管的中心化衍生品交易所，面向传统标的资产类别。AX 由 Architect Bermuda Ltd. 运营，并获得[百慕大金融管理局（BMA）](https://www.bma.bm/)许可；生产环境挂牌永续合约，沙盒目录还提供有到期日的期货。

本集成支持接入 AX Exchange 的实盘市场数据和订单执行。

## 示例

- [Python 示例](https://github.com/qOeOp/trade/tree/main/examples/live/architect_ax/)
- [Rust 示例](https://github.com/qOeOp/trade/tree/main/crates/adapters/architect_ax/examples/)

## 概述

本指南假定交易者同时设置实盘市场数据馈送和交易执行。
AX Exchange 适配器包含多个组件，可根据用例组合使用或单独使用。

- `AxHttpClient`：底层 HTTP API 连接。
- `AxMdWebSocketClient`：市场数据 WebSocket 连接。
- `AxOrdersWebSocketClient`：订单 WebSocket 连接。
- `AxInstrumentProvider`：金融工具解析和加载功能。
- `AxDataClient`：市场数据馈送管理器。
- `AxExecutionClient`：账户管理和交易执行网关。
- `AxDataClientFactory`：AX 数据客户端工厂。
- `AxExecutionClientFactory`：AX 执行客户端工厂。

:::note
大多数用户会为实盘交易节点定义配置（如下所示），无需直接操作这些底层组件。
:::

## AX Exchange 文档

AX Exchange 为用户提供的文档位于 [Architect 文档站](https://docs.architect.exchange/)。
建议结合 AX Exchange 文档和本 VibeTrader 集成指南使用。

## 产品

生产目录目前包含以下交易场所类别的永续合约：

| 交易场所类别 | 示例                         | Vibe 资产类别 |
| ------------ | ---------------------------- | ------------- |
| 外汇         | `EURUSD-PERP`、`JPYUSD-PERP` | FX            |
| 股票         | `AAPL-PERP`、`NVDA-PERP`     | Equity        |
| 能源 ETF     | `USO-PERP`、`UNG-PERP`       | Equity        |
| 金属         | `XAU-PERP`、`XAG-PERP`       | Commodity     |
| 能源         | `WTI-PERP`                   | Commodity     |
| 国债         | `UST10Y-PERP`                | Debt          |
| 算力         | `OCPI-H100-PERP`             | Alternative   |

沙盒还挂牌 `XAU-2026-SEP` 和 `XAU-2026-DEC` 等有到期日的黄金合约。

### 永续合约

永续合约（永续掉期）是一种跟踪标的资产价格且没有到期日的衍生品。与标准期货不同，它没有结算日期，因而消除了展期成本并简化持仓管理。资金费率机制通过多头和空头持有者之间的定期支付，使合约价格与标的指数价格保持一致。有关资金费率机制和合约规格的详情，请参阅 [Architect 文档](https://docs.architect.exchange/)。

AX 永续合约的特点：

- **以 USD 现金结算**：不进行实物交割。所有盈亏均以 USD 结算。
- **资金费率**：定期支付使合约价格与标的保持一致。
- **乘数为 1**：每份合约代表一个单位的标的风险敞口。
- **仅支持整数合约**：不支持小数数量。
- **保证金**：开仓需要初始保证金；维持持仓需要维持保证金。

适配器将没有到期日的 AX 金融工具表示为 `PerpetualContract`，将有到期日的金融工具表示为 `FuturesContract`。交易场所类别决定 Vibe 资产类别。适配器使用 `MARGIN` 账户类型和 `NETTING` 订单管理方式。

## 符号规则

适配器保留每个 AX 符号，并附加 Vibe 交易场所标识符 `.AX`。永续合约符号使用 `-PERP` 后缀。有到期日的合约符号包含年份和合约月份。

| 合约         | AX 符号        | Vibe InstrumentId |
| ------------ | -------------- | ----------------- |
| EUR/USD 永续 | `EURUSD-PERP`  | `EURUSD-PERP.AX`  |
| 黄金永续     | `XAU-PERP`     | `XAU-PERP.AX`     |
| 到期黄金     | `XAU-2026-SEP` | `XAU-2026-SEP.AX` |

交易场所标识符为 `AX`。构建 Vibe `InstrumentId` 的方式如下：

```python
from vibe_trader.model import InstrumentId

instrument_id = InstrumentId.from_str("EURUSD-PERP.AX")
```

## 环境

AX Exchange 提供两种交易环境。请使用客户端配置中的 `environment` 参数选择相应环境。

| 环境     | 配置                                   | 描述                     |
| -------- | -------------------------------------- | ------------------------ |
| **沙盒** | `environment=AxEnvironment.SANDBOX`    | 使用模拟资金的测试环境。 |
| **生产** | `environment=AxEnvironment.PRODUCTION` | 使用真实资金的实盘交易。 |

### 沙盒

沙盒是使用模拟资金进行开发和测试的默认环境。
设置 `environment=AxEnvironment.SANDBOX` 后，所有沙盒端点都会自动解析。

#### 1. 创建沙盒账户

按照 [Architect 文档](https://docs.architect.exchange/)创建沙盒账户。注册时需要邀请码。

#### 2. 创建 API 密钥并为账户注资

使用 AX 沙盒 UI 生成 API 密钥，并向账户存入模拟资金。
请安全保存 `api_key` 和 `api_secret`。

#### 3. 设置环境变量

```bash
export AX_API_KEY="your-sandbox-api-key"
export AX_API_SECRET="your-sandbox-api-secret"
```

#### 4. 配置实盘节点

在数据和执行客户端配置上设置 `environment=AxEnvironment.SANDBOX`。完整 `LiveNode` 设置请参阅 [Python 示例](https://github.com/qOeOp/trade/tree/main/examples/live/architect_ax/)。

### 生产

生产环境用于使用真实资金进行实盘交易，需要经过验证的 AX Exchange 账户。

```python
config = AxExecClientConfig(
    environment=AxEnvironment.PRODUCTION,
)
```

:::warning
下单前请确保使用了正确的环境。
默认使用沙盒，以防意外进行实盘交易。
:::

## 市场数据

适配器通过 WebSocket 订阅提供实时市场数据，并通过 HTTP 端点回补历史数据。

### 数据类型

| AX 数据      | Vibe 数据类型       | 说明                                                |
| ------------ | ------------------- | --------------------------------------------------- |
| 订单簿（L1） | `QuoteTick`         | 来自 L1 订单簿订阅的最优买价/卖价。                 |
| 订单簿（L2） | `OrderBookDelta`    | 聚合价格档位。                                      |
| 订单簿（L3） | `OrderBookDelta`    | 每个快照中的订单数量，使用合成 ID。                 |
| 成交         | `TradeTick`         | 来自仅成交 WebSocket 订阅的实时成交事件。           |
| 标记价格     | `MarkPriceUpdate`   | 从 L1 ticker 订阅中提取。                           |
| K 线         | `Bar`               | OHLCV 数据（仅含总成交量，不区分买入/卖出）。       |
| 资金费率     | `FundingRateUpdate` | 通过 HTTP 轮询；间隔可配置。                        |
| 金融工具状态 | `InstrumentStatus`  | 来自 L1 ticker 订阅的状态变化（开放、暂停、关闭）。 |

:::note
AX Exchange 不支持历史报价 tick 请求。只有通过 WebSocket L1 订单簿订阅获取的实时报价数据可用。
:::

:::note
AX L3 快照包含每笔订单的数量，但不包含交易场所订单 ID。适配器在每个快照内分配合成 ID，无法跨快照跟踪同一笔订单。
:::

:::note
AX 不为市场数据发布成交标识符，因此适配器根据成交自身的时间戳和内容派生 `TradeTick.trade_id`。当 REST 和 WebSocket 都报告成交的主动方时，两者会为同一成交生成相同 ID。AX 以完全相同方式报告的成交记录会共享一个 ID；这只影响按 `trade_id` 对市场数据去重的消费者，因为成交回报使用交易场所自身的成交 ID。
:::

### WebSocket 订阅行为

AX 市场数据 WebSocket 订阅为每个符号使用一个活动流。适配器选择能够覆盖当前 Vibe 订阅的最小数据流：

- `subscribe_trades` 使用 AX `level: "TRADES"`，只传递成交记录。
- 仅订单簿和仅报价订阅会设置 AX `trades: false` 和 `ticker: false`，以抑制未请求的成交和 ticker 事件。
- 标记价格和金融工具状态订阅需要 AX ticker 事件，因此只要任一数据类型处于活动状态，适配器就会在 L1 流上启用 ticker 传递。
- 如果某个符号有多个 Vibe 数据类型处于活动状态，适配器只在所需 AX level 或传递标志变化时重新订阅。

AX 发布说明还介绍了 ticker 事件中的预估资金费率，以及订单 WebSocket 的预估资金费率请求。Vibe 目前通过 HTTP 轮询公开已结算的资金费率更新；适配器不会解析交易场所的预估资金费率字段，也不会将其作为独立的 Vibe 数据类型发出。

### HTTP API 行为

- `GET /tickers` 返回 limit/offset 分页元数据，并支持 `limit`、`offset` 和 `sort` 查询参数。
- `GET /ticker` 在顶层 `ticker` 响应字段中返回 ticker。
- `GET /open-orders` 使用 limit/offset 分页。未结订单对账会遍历所有页面，并验证总数、偏移量、重复项和完整性，使检测到的响应漂移导致请求失败。
- `GET /fills` 和 `GET /funding-rates` 使用游标分页。适配器会以尽力而为的历史读取方式遍历每条游标链；遍历期间 AX 的更正并不构成原子快照。
- `GET /orders` 公开游标元数据，并支持 `order_id`、`order_ids`、`account_id` 和可选的时间戳筛选器。启动时批量状态对账会遍历其游标链，接受不完整页面，并拒绝重复游标或重复订单 ID。
- 未结订单、历史订单、成交和持仓报告请求会通过 `GET /instrument` 解析缓存中不存在的符号，并缓存结果。金融工具请求或解析失败会使整个报告请求失败，而不是丢弃交易场所状态。
- `GET /transactions` 要求提供 `start_timestamp_ns` 和 `end_timestamp_ns`，且范围不得超过 7 天。底层客户端公开其游标和账户选择器。
- `GET /order-status` 可以为被拒订单包含 `reject_reason` 和 `reject_message`。
- 省略账户选择器时，AX 使用主账户。高层执行客户端拥有一个主账户；底层请求模型公开已记录的账户选择器。

### K 线间隔

| 间隔  | 描述    |
| ----- | ------- |
| `1s`  | 1 秒    |
| `5s`  | 5 秒    |
| `1m`  | 1 分钟  |
| `5m`  | 5 分钟  |
| `15m` | 15 分钟 |
| `1h`  | 1 小时  |
| `1d`  | 1 天    |

## 订单能力

当前 AX 订单录入 API 没有订单类型选择器。其唯一原生订单结构要求提供价格，适配器将其映射为 Vibe `LIMIT` 订单。适配器通过预览激进价格，并以 IOC 提交该带价格的结构，来模拟 Vibe `MARKET` 订单。

当前官方 [REST 下单](https://docs.architect.exchange/api-reference/order-management/place-order)和[订单 WebSocket](https://docs.architect.exchange/api-reference/order-management/orders-ws)请求 schema 不包含 `order_type` 或 `trigger_price` 字段。2026-07-18 的沙盒测试提交了触发条件尚未满足的买入和卖出止损限价请求，两个请求都立即按当前限价执行。这没有证实条件执行语义，因此适配器会在发送前拒绝交易场所原生止损限价订单。

Vibe 仍可在本地模拟止损限价订单。通用订单模拟器会等待配置的触发条件，再向此适配器发送普通限价订单。

### Vibe 订单类型

| 订单类型               | 支持 | 说明                           |
| ---------------------- | ---- | ------------------------------ |
| `MARKET`               | ✓    | 适配器使用激进 IOC 价格模拟。  |
| `LIMIT`                | ✓    | 映射到 AX 原生带价格订单结构。 |
| `STOP_LIMIT`           | -    | *AX Exchange 不支持*。         |
| `LIMIT_IF_TOUCHED`     | -    | *AX Exchange 不支持*。         |
| `STOP_MARKET`          | -    | *AX Exchange 不支持*。         |
| `MARKET_IF_TOUCHED`    | -    | *AX Exchange 不支持*。         |
| `TRAILING_STOP_MARKET` | -    | *AX Exchange 不支持*。         |

### 执行指令

| 指令             | 支持 | 说明                                           |
| ---------------- | ---- | ---------------------------------------------- |
| `post_only`      | ✓    | 仅挂单；如果订单会立即成交，则予以拒绝。       |
| `reduce_only`    | -    | 本地拒绝；AX 未公开只减仓字段。                |
| `quote_quantity` | -    | 本地拒绝；适配器线协议路径只编码基础货币数量。 |
| `display_qty`    | -    | 本地拒绝；适配器线协议路径没有显示数量字段。   |

2026-07-18 的沙盒测试证实了为何需要此边界。当线协议载荷中省略只减仓指令时，AX 将只减仓订单作为普通订单接受并成交。现在，适配器会在提交前拒绝只减仓订单。测试后，沙盒账户恢复为空仓；未测试生产环境行为。

适配器还会拒绝计价货币数量和显示数量指令，因为当前 AX 线协议路径无法编码这些语义。这是适配器边界，并非声称 AX Exchange 会拒绝等效的交易场所原生功能。

### 有效期

| 有效期         | 支持 | 说明               |
| -------------- | ---- | ------------------ |
| `GTC`          | ✓    | 撤销前有效。       |
| `GTD`          | -    | 适配器在本地拒绝。 |
| `DAY`          | ✓    | 交易日结束前有效。 |
| `IOC`          | ✓    | 立即成交或取消。   |
| `FOK`          | -    | 适配器在本地拒绝。 |
| `AT_THE_OPEN`  | -    | 适配器在本地拒绝。 |
| `AT_THE_CLOSE` | -    | 适配器在本地拒绝。 |

交易场所已弃用 `DAY`，并建议改用 `GTC`。

### 高级订单功能

| 功能         | 支持 | 说明                                            |
| ------------ | ---- | ----------------------------------------------- |
| 修改订单     | ✓    | 仅 Rust 客户端支持；Python 客户端拒绝修改请求。 |
| 取消订单     | ✓    | 取消单笔订单。                                  |
| 取消所有订单 | ✓    | 取消某个金融工具的所有未结订单。                |
| 批量取消     | -    | 适配器逐笔发送取消。                            |
| 订单列表     | ✓    | 顺序提交（逐笔提交订单，非原子操作）。          |

### 持仓管理

| 功能       | 支持 | 说明                             |
| ---------- | ---- | -------------------------------- |
| 查询持仓   | ✓    | 实时持仓更新。                   |
| 持仓模式   | -    | 仅支持净额模式。                 |
| 全仓保证金 | ✓    | 在所有金融工具间使用全仓保证金。 |

### 订单查询

| 功能         | 支持 | 说明                                                     |
| ------------ | ---- | -------------------------------------------------------- |
| 查询未结订单 | ✓    | 列出所有活动订单。                                       |
| 查询单笔订单 | ✓    | 按交易场所订单 ID 或客户端订单 ID 查询（任意订单状态）。 |
| 订单状态报告 | ✓    | 未结订单检查和启动时历史批量状态。                       |
| 成交报告     | ✓    | 执行和成交历史。                                         |

:::note
启用 `open_check_open_only` 时，批量未结订单检查使用 `/open-orders`，这是默认设置。否则使用 `/orders`。启动时批量状态对账使用 `/orders`，因此其快照包含已成交和已取消订单等历史终结订单。通过 `query_order` 查询单笔订单时，使用专用 `/order-status` 端点，该端点适用于任何订单状态。

AX 未结订单和历史订单载荷不公开止损订单类型或触发价格。因此，从 REST 派生的对账会将每笔可见外部订单都报告为限价订单。适配器不提交交易场所原生条件订单。
:::

## 身份验证

AX Exchange 使用 Bearer token 身份验证：

1. API 密钥和 secret 通过 `/authenticate` 获取会话令牌。
2. 后续 REST 和 WebSocket 请求使用该会话令牌作为 Bearer token。
3. 适配器请求有效期一小时的会话令牌，并每 30 分钟刷新一次。
4. 刷新会更新 REST 身份验证和下次 WebSocket 重连所用的令牌，而不会中断活动连接。

## 配置

### 环境和端点

| 环境 | HTTP API（市场数据）                             | HTTP API（订单）                                    | 市场数据 WS                                      | 订单 WS                                              |
| ---- | ------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| 沙盒 | `https://gateway.sandbox.architect.exchange/api` | `https://gateway.sandbox.architect.exchange/orders` | `wss://gateway.sandbox.architect.exchange/md/ws` | `wss://gateway.sandbox.architect.exchange/orders/ws` |
| 生产 | `https://gateway.architect.exchange/api`         | `https://gateway.architect.exchange/orders`         | `wss://gateway.architect.exchange/md/ws`         | `wss://gateway.architect.exchange/orders/ws`         |

:::info
订单管理 HTTP 端点（下单、取消、订单状态）使用与市场数据端点不同的基础 URL。适配器配置会自动处理这一点。
:::

### 数据客户端配置选项

| 选项                               | 默认值    | 描述                                                |
| ---------------------------------- | --------- | --------------------------------------------------- |
| `api_key`                          | `None`    | API 密钥；省略时从 `AX_API_KEY` 环境变量加载。      |
| `api_secret`                       | `None`    | API secret；省略时从 `AX_API_SECRET` 环境变量加载。 |
| `environment`                      | `SANDBOX` | 交易环境（`SANDBOX` 或 `PRODUCTION`）。             |
| `base_url_http`                    | `None`    | 覆盖 REST 基础 URL。                                |
| `base_url_ws_public`               | `None`    | 覆盖市场数据 WebSocket URL。                        |
| `base_url_ws_private`              | `None`    | 覆盖私有订单 WebSocket URL。                        |
| `proxy_url`                        | `None`    | HTTP 和 WebSocket 传输的可选代理 URL。              |
| `http_timeout_secs`                | `60`      | REST 请求超时（秒）。                               |
| `max_retries`                      | `3`       | REST 请求最大重试次数。                             |
| `retry_delay_initial_ms`           | `1,000`   | 两次重试之间的初始延迟（毫秒）。                    |
| `retry_delay_max_ms`               | `10,000`  | 两次重试之间的最大延迟（毫秒，指数退避）。          |
| `heartbeat_interval_secs`          | `20`      | WebSocket 连接的心跳间隔（秒）。                    |
| `recv_window_ms`                   | `5,000`   | 签名请求的接收窗口（毫秒）。                        |
| `update_instruments_interval_mins` | `60`      | 两次金融工具目录刷新之间的间隔（分钟）。            |
| `funding_rate_poll_interval_mins`  | `15`      | 两次资金费率轮询请求之间的间隔（分钟）。            |
| `transport_backend`                | `Sockudo` | WebSocket 传输后端。                                |

### 执行客户端配置选项

| 选项                      | 默认值       | 描述                                                |
| ------------------------- | ------------ | --------------------------------------------------- |
| `trader_id`               | `TRADER-001` | 执行客户端的交易者 ID。                             |
| `account_id`              | `AX-001`     | 执行客户端的账户 ID。                               |
| `api_key`                 | `None`       | API 密钥；省略时从 `AX_API_KEY` 环境变量加载。      |
| `api_secret`              | `None`       | API secret；省略时从 `AX_API_SECRET` 环境变量加载。 |
| `environment`             | `SANDBOX`    | 交易环境（`SANDBOX` 或 `PRODUCTION`）。             |
| `base_url_http`           | `None`       | 覆盖市场数据 REST 基础 URL。                        |
| `base_url_orders`         | `None`       | 覆盖订单 REST 基础 URL。                            |
| `base_url_ws_private`     | `None`       | 覆盖订单 WebSocket URL。                            |
| `proxy_url`               | `None`       | HTTP 和 WebSocket 传输的可选代理 URL。              |
| `http_timeout_secs`       | `60`         | REST 请求超时（秒）。                               |
| `max_retries`             | `3`          | REST 请求最大重试次数。                             |
| `retry_delay_initial_ms`  | `1,000`      | 两次重试之间的初始延迟（毫秒）。                    |
| `retry_delay_max_ms`      | `10,000`     | 两次重试之间的最大延迟（毫秒，指数退避）。          |
| `heartbeat_interval_secs` | `30`         | WebSocket 连接的心跳间隔（秒）。                    |
| `recv_window_ms`          | `5,000`      | 签名请求的接收窗口（毫秒）。                        |
| `cancel_on_disconnect`    | `False`      | 断开连接时取消此 WebSocket 会话的未结订单。         |
| `transport_backend`       | `Sockudo`    | WebSocket 传输后端。                                |

当 `transport_backend=None` 时，如果启用了 `transport-sockudo` Cargo 功能，编译后的 Rust 默认设置选择 Sockudo；否则选择 Tungstenite。

将 `AxDataClientConfig` 与 `AxDataClientFactory` 配合使用，将 `AxExecClientConfig` 与 `AxExecutionClientFactory` 配合使用。当前 Python 示例展示了数据和执行客户端的完整 `LiveNode.builder(...)` 配置。

### API 凭证

向 AX Exchange 客户端提供凭证有两种方式。
可以将相应的 `api_key` 和 `api_secret` 值传给配置对象，也可以设置以下环境变量：

- `AX_API_KEY`
- `AX_API_SECRET`

:::tip
建议使用环境变量管理凭证。
:::

启动交易节点时，会立即确认凭证是否有效以及是否具有交易权限。

## 实现说明

- **仅支持整数合约**：AX 使用整数合约数量。适配器将数量增量和手数都建模为一份合约，同时强制执行每个金融工具各自的 `minimum_order_size`。小数数量会在本地生成 `OrderDenied`。
- **有到期日期货的启用时间**：AX 发布到期时间，但不发布启用时间戳。适配器对未知启用时间使用零值，并在金融工具元数据中保留此限制。
- **速率限制**：适配器采用每秒 10 个请求的保守速率限制，并在收到速率限制响应时自动进行指数退避。
- **市价订单**：AX 不支持原生市价订单。适配器使用预览端点确定穿透价格，并提交激进的 IOC 限价订单。
- **止损限价订单**：适配器拒绝交易场所原生止损限价提交，因为实盘沙盒测试未能证实条件执行语义。策略需要止损限价订单时，请使用本地订单模拟。
- **修改订单**：AX 通过 `POST /replace-order` 支持原子替换订单。Rust 客户端将 `modify_order` 映射到该端点，并接收新的订单 ID。Python 客户端拒绝修改请求；应改为取消并重新提交。
- **断开连接时取消**：在执行客户端配置中设置 `cancel_on_disconnect=True`，可在订单 WebSocket 断开时让交易所取消所有未结订单。
- **金融工具费率**：AX 在 `GET /whoami` 中按账户报告 maker 和 taker 费率，因此适配器会在身份验证后解析这些费率，并应用于每个金融工具。如果该查询失败，执行客户端会连接失败，而不是在整个进程生命周期内报告零费用。未配置凭证的数据客户端无法读取费率，因此报告零费用。
- **成交佣金**：来自 WebSocket 的实时成交事件不包含费用数据。流式成交的佣金报告为零。对账期间，REST `/fills` 端点会提供准确的费用信息。
- **成交对账窗口**：`/fills` 端点要求有界时间范围，并将跨度限制为七天。对账请求最近七天的成交；更早的成交不会对账。
- **成交订单标识**：AX 可以为大宗交易和最终结算成交省略 `order_id`。对于这些已分类记录，适配器会根据 `trade_id` 派生确定性对账订单 ID。对于具有有效 `order_id` 的普通成交，分类字段可选。适配器会拒绝既没有订单 ID，也没有明确特殊成交分类的行，并拒绝不一致的分类。
- **未成交 IOC/FOK**：AX 将未成交的立即执行订单报告为过期；适配器将其映射到 `OrderCanceled`，以符合 VibeTrader 语义。

## 贡献

:::info
如需增加功能或为 AX Exchange 适配器贡献代码，请参阅[贡献指南](https://github.com/qOeOp/trade/blob/main/CONTRIBUTING.md)。
:::
