# Bybit

Bybit 成立于 2018 年，是按日交易量、加密资产及加密衍生品未平仓量计算规模最大的加密货币交易所之一。
此集成支持接入 Bybit 实时市场数据并执行订单。

## 示例

- [Python 示例](https://github.com/qOeOp/trade/tree/main/examples/live/bybit/)
- [Rust 示例](https://github.com/qOeOp/trade/tree/main/crates/adapters/bybit/examples/)

## 概览

本指南假定交易者需要同时配置实时市场数据馈送和交易执行。Bybit 适配器包含多个组件，
可根据用例组合使用或单独使用。

- `BybitHttpClient`：底层 HTTP API 连接。
- `BybitWebSocketClient`：底层 WebSocket API 连接。
- `BybitInstrumentProvider`：金融工具解析与加载功能。
- `BybitDataClient`：市场数据馈送管理器。
- `BybitExecutionClient`：账户管理与交易执行网关。
- `BybitDataClientFactory`：Bybit 数据客户端工厂。
- `BybitExecutionClientFactory`：Bybit 执行客户端工厂。

:::note
大多数用户会为实盘交易节点定义配置（如下所示），无需直接操作这些底层组件。
:::

## Bybit 文档

Bybit 为用户提供了丰富的文档，可在 [Bybit 帮助中心](https://www.bybit.com/en/help-center)查看。
建议结合 Bybit 文档与本 VibeTrader 集成指南阅读。

## 产品

产品是对一组相关金融工具类型的统称。

:::note
在 Bybit v5 API 中，产品也称为 `category`。
:::

Bybit 支持以下产品类型：

| 产品类型     | 支持 | 说明                       |
| ------------ | ---- | -------------------------- |
| 现货加密货币 | ✓    | 支持保证金的原生现货市场。 |
| 线性永续合约 | ✓    | USDT/USDC 保证金永续掉期。 |
| 线性期货合约 | ✓    | 交割结算的线性期货。       |
| 反向永续合约 | ✓    | 币本位永续掉期。           |
| 反向期货合约 | ✓    | 币本位交割期货。           |
| 期权合约     | ✓    | 以 USDT 结算的欧式期权。   |

## 符号体系

为区分 Bybit 上的不同产品类型，Vibe 对符号使用特定的产品类别后缀：

- `-SPOT`：现货加密货币
- `-LINEAR`：永续和期货合约
- `-INVERSE`：反向永续和反向期货合约
- `-OPTION`：期权合约

这些后缀必须附加到 Bybit 原始符号字符串，才能标识金融工具 ID 的具体产品类型。例如：

- Ether/Tether 现货货币对使用 `-SPOT` 标识，例如 `ETHUSDT-SPOT`。
- BTCUSDT 永续期货合约使用 `-LINEAR` 标识，例如 `BTCUSDT-LINEAR`。
- BTCUSD 反向永续期货合约使用 `-INVERSE` 标识，例如 `BTCUSD-INVERSE`。
- BTC USDT 结算看跌期权：`BTC-27MAR26-70000-P-USDT-OPTION`。
- ETH USDC 结算看涨期权：`ETH-28FEB25-2800-C-OPTION`。

Bybit 的期权符号会为 USDT 结算合约包含结算货币（例如 `BTC-27MAR26-70000-P-USDT`），
但 USDC 结算合约会省略（例如 `ETH-28FEB25-2800-C`）。适配器会在 API 返回的符号后附加 `-OPTION`。

## 金融工具加载

数据客户端和执行客户端连接时，会加载其配置的 `product_types` 对应的所有金融工具。默认值为 `LINEAR`。
请包含订阅或订单所需的每种产品类型。

## 环境

Bybit 提供三个交易环境。使用客户端配置上的 `environment` 枚举选择适当环境。

| 环境       | 配置                       | 说明                                   |
| ---------- | -------------------------- | -------------------------------------- |
| **主网**   | `BybitEnvironment.MAINNET` | 使用真实资金进行生产交易。             |
| **演示**   | `BybitEnvironment.DEMO`    | 在主网基础设施上使用模拟资金练习交易。 |
| **测试网** | `BybitEnvironment.TESTNET` | 用于开发和集成测试的独立测试网络。     |

### 主网（生产）

使用真实资金进行实盘交易的默认环境。

```python
from vibe_trader.adapters.bybit import BybitEnvironment
from vibe_trader.adapters.bybit import BybitExecClientConfig

config = BybitExecClientConfig(
    api_key="YOUR_API_KEY",
    api_secret="YOUR_API_SECRET",
    environment=BybitEnvironment.MAINNET,
)
```

环境变量：`BYBIT_API_KEY`、`BYBIT_API_SECRET`

### 演示交易

演示交易在 Bybit 主网基础设施上使用模拟资金。请从
[Bybit 演示交易页面](https://www.bybit.com/en/demo-trading)创建演示 API 密钥。

```python
from vibe_trader.adapters.bybit import BybitEnvironment
from vibe_trader.adapters.bybit import BybitExecClientConfig

config = BybitExecClientConfig(
    api_key="YOUR_DEMO_API_KEY",
    api_secret="YOUR_DEMO_API_SECRET",
    environment=BybitEnvironment.DEMO,
)
```

环境变量：`BYBIT_DEMO_API_KEY`、`BYBIT_DEMO_API_SECRET`

:::warning
**演示环境限制：**

- 演示交易**不支持** WebSocket Trade API。演示模式下，VibeTrader 自动使用 HTTP REST API 执行订单操作。
- 新订单上的原生 TP/SL 和期权参数（`order_iv`、`mmp`）可通过 HTTP 创建订单端点在演示环境使用。
- 演示环境不支持自定义 TP/SL 触发价 `tp_trigger_price` 和 `sl_trigger_price`（设置这些参数的订单会被拒绝）；
  创建订单端点无法携带这些参数。
- 演示私有数据流使用 `wss://stream-demo.bybit.com`，但公共市场数据使用 Bybit 主网公共数据流
  `wss://stream.bybit.com`。

:::

### 测试网

用于开发和集成测试的独立测试网络。

```python
from vibe_trader.adapters.bybit import BybitEnvironment
from vibe_trader.adapters.bybit import BybitExecClientConfig

config = BybitExecClientConfig(
    api_key="YOUR_TESTNET_API_KEY",
    api_secret="YOUR_TESTNET_API_SECRET",
    environment=BybitEnvironment.TESTNET,
)
```

环境变量：`BYBIT_TESTNET_API_KEY`、`BYBIT_TESTNET_API_SECRET`

:::note
测试网支持包括 WebSocket Trade API 在内的所有交易功能。其基础设施与主网完全分离，
因此市场数据和流动性与生产环境有明显差异。
:::

当 `environment=BybitEnvironment.TESTNET` 时，适配器会自动解析 Bybit 文档所述的测试网端点：

- REST API：`https://api-testnet.bybit.com`
- 公共 WebSocket：`wss://stream-testnet.bybit.com/v5/public/{spot|linear|inverse|option}`
- 私有 WebSocket：`wss://stream-testnet.bybit.com/v5/private`
- 交易 WebSocket：`wss://stream-testnet.bybit.com/v5/trade`

### 测试网设置

设置 Bybit 测试网账户和凭证：

1. 在桌面浏览器中打开 [testnet.bybit.com](https://testnet.bybit.com)。
2. 创建独立测试网账户，或登录现有测试网账户。
3. 通过 **Assets -> Assets Overview -> Request Test Coins** 请求测试币，使账户具有测试余额。
4. 打开 **API Management**：
   [testnet.bybit.com/app/user/api-management](https://testnet.bybit.com/app/user/api-management)。
5. 点击 **Create New Key**。
6. 选择用例所需的权限。
7. 完成 2FA 提示，并复制 API 密钥和 Secret。
8. 在 shell 中导出凭证：

   ```bash
   export BYBIT_TESTNET_API_KEY="YOUR_TESTNET_API_KEY"
   export BYBIT_TESTNET_API_SECRET="YOUR_TESTNET_API_SECRET"
   ```

Bybit 当前测试网指南还指出：

- API 密钥在网站而非移动应用中创建。
- 新用户注册后的前 48 小时内可能无法创建 API 密钥。
- 测试网与主网相互独立。不要向测试网账户存入真实资金。
- Bybit 当前规定通过桌面浏览器设置测试网账户。

## 订单能力

Bybit 提供灵活的触发类型组合，支持更广泛的 Vibe 订单。除追踪止损（使用持仓相关 API）外，
下列所有订单类型均可作为入场或退出订单。

### 订单类型

| 订单类型               | 现货 | 线性 | 反向 | 期权 | 说明                |
| ---------------------- | ---- | ---- | ---- | ---- | ------------------- |
| `MARKET`               | ✓    | ✓    | ✓    | ✓    | 支持报价货币数量。  |
| `LIMIT`                | ✓    | ✓    | ✓    | ✓    |                     |
| `STOP_MARKET`          | ✓    | ✓    | ✓    | -    | *期权不支持*。      |
| `STOP_LIMIT`           | ✓    | ✓    | ✓    | -    | *期权不支持*。      |
| `MARKET_IF_TOUCHED`    | ✓    | ✓    | ✓    | -    | *期权不支持*。      |
| `LIMIT_IF_TOUCHED`     | ✓    | ✓    | ✓    | -    | *期权不支持*。      |
| `TRAILING_STOP_MARKET` | -    | ✓    | ✓    | -    | *现货/期权不支持*。 |

### 执行指令

| 指令          | 现货 | 线性 | 反向 | 期权 | 说明                  |
| ------------- | ---- | ---- | ---- | ---- | --------------------- |
| `post_only`   | ✓    | ✓    | ✓    | ✓    | 仅 `LIMIT` 订单支持。 |
| `reduce_only` | -    | ✓    | ✓    | ✓    | *现货不支持*。        |

### 有效期类型

| 有效期类型 | 现货 | 线性 | 反向 | 期权 | 说明             |
| ---------- | ---- | ---- | ---- | ---- | ---------------- |
| `GTC`      | ✓    | ✓    | ✓    | ✓    | 撤销前有效。     |
| `GTD`      | -    | -    | -    | -    | *不支持*。       |
| `FOK`      | ✓    | ✓    | ✓    | ✓    | 全部成交或取消。 |
| `IOC`      | ✓    | ✓    | ✓    | ✓    | 立即成交或取消。 |

### 高级订单功能

| 功能          | 现货 | 线性 | 反向 | 期权 | 说明                                |
| ------------- | ---- | ---- | ---- | ---- | ----------------------------------- |
| 订单修改      | ✓    | ✓    | ✓    | ✓    | 修改价格和数量。                    |
| 括号/OCO 订单 | ✓    | ✓    | ✓    | -    | 仅 UI；API 用户需手动实现。         |
| 冰山订单      | ✓    | ✓    | ✓    | -    | 每个账户最多 10 个，每个符号 1 个。 |

### 批量操作

| 操作     | 现货 | 线性 | 反向 | 期权 | 说明                       |
| -------- | ---- | ---- | ---- | ---- | -------------------------- |
| 批量提交 | ✓    | ✓    | ✓    | ✓    | 在单次请求中提交多个订单。 |
| 批量修改 | ✓    | ✓    | ✓    | ✓    | 在单次请求中修改多个订单。 |
| 批量取消 | ✓    | ✓    | ✓    | ✓    | 在单次请求中取消多个订单。 |

### 持仓管理

| 功能       | 现货 | 线性 | 反向 | 期权 | 说明                         |
| ---------- | ---- | ---- | ---- | ---- | ---------------------------- |
| 查询持仓   | -    | ✓    | ✓    | ✓    | 实时持仓更新。               |
| 持仓模式   | -    | ✓    | ✓    | -    | 期权仅支持单向模式。         |
| 杠杆控制   | -    | ✓    | ✓    | -    | 不适用于期权。               |
| 保证金模式 | -    | ✓    | ✓    | ✓    | 全仓、逐仓或投资组合保证金。 |

#### Hedge 模式（BothSides）

Bybit 只在线性 USDT 永续合约上接受 Both Sides 模式。请先在 Bybit 配置持仓模式，然后通过订单 `params`
传入 `position_idx`：多头方向为 `1`，空头方向为 `2`。单向模式使用 `0` 或省略该参数。

Bybit 在 V5 [切换持仓模式](https://bybit-exchange.github.io/docs/v5/position/position-mode)和
[下单](https://bybit-exchange.github.io/docs/v5/order/create-order#request-parameters) API 中说明了这些值。

`positionIdx=0`（单向 / Merged Single 模式）的订单和报告不携带交易场所持仓 ID。对于 Hedge 模式索引
`1` 和 `2`，适配器将报告映射到以 `-LONG` 和 `-SHORT` 结尾的交易场所持仓 ID；当 Bybit 执行消息不含
`positionIdx` 时，也会把相同 ID 附加到成交报告。

要覆盖此行为，请通过 `params` 传入 `position_idx`：

```python
params = {"position_idx": 1}  # 0 one-way, 1 long, 2 short
```

### 风险事件

| 功能         | 现货 | 线性 | 反向 | 期权 | 说明                                        |
| ------------ | ---- | ---- | ---- | ---- | ------------------------------------------- |
| 强平处理     | -    | ✓    | ✓    | ✓    | 接管成交标记为交易所生成。                  |
| ADL 处理     | -    | ✓    | ✓    | ✓    | 自动减仓成交会被标记并记录。                |
| ADL 排名警告 | -    | ✓    | ✓    | ✓    | 当 `adlRankIndicator >= 4` 时记录持仓报告。 |

Bybit 发出由交易场所发起的成交时，`execType` 会设置为：

- `AdlTrade`：自动减仓执行。保险基金无法弥补损失后，会选中一个相反方向的盈利持仓，关闭抵押不足的对手方。
- `BustTrade`：强平接管。保证金耗尽后，强平引擎接管持仓。
- `Delivery`：USDC 期货交割。
- `Settle`：反向期货结算。
- `CorporateAction`：拆股或反向拆股。

适配器会将每笔成交标记为交易所生成，并记录包含执行 ID、符号、方向、数量和价格的警告。成交通过正常
`FillReport` 路径处理；由于这些订单携带空的 `orderLinkId`，执行引擎会将其视为外部订单，并通过
`external_order_claims` 分配（默认则分配给 `EXTERNAL` 策略）。

Bybit 还通过持仓更新中的 `adlRankIndicator` 字段发布 ADL 排名。范围从 0（已平仓 / 无持仓）到 5
（即将自动减仓）。只要未平持仓的排名达到 4 或更高，适配器就会记录警告，便于在交易场所强制平仓前作出响应。

上游参考资料：

- [V5 `execType` 值](https://bybit-exchange.github.io/docs/v5/enum#exectype)
- [V5 `createType` 值](https://bybit-exchange.github.io/docs/v5/enum#createtype)
- [强平机制](https://www.bybit.com/en/help-center/article/Liquidation-Process-Derivatives-Trading)
- [自动减仓机制](https://www.bybit.com/en/help-center/article/Auto-Deleveraging-ADL-Derivatives-Trading)

### 订单查询

| 功能         | 现货 | 线性 | 反向 | 期权 | 说明                 |
| ------------ | ---- | ---- | ---- | ---- | -------------------- |
| 查询未结订单 | ✓    | ✓    | ✓    | ✓    | 列出所有活动订单。   |
| 查询订单历史 | ✓    | ✓    | ✓    | ✓    | 历史订单数据。       |
| 订单状态更新 | ✓    | ✓    | ✓    | ✓    | 实时订单状态变化。   |
| 成交历史     | ✓    | ✓    | ✓    | ✓    | 执行报告和成交报告。 |

### 条件关联订单

| 功能     | 现货 | 线性 | 反向 | 期权 | 说明                        |
| -------- | ---- | ---- | ---- | ---- | --------------------------- |
| 订单列表 | ✓    | ✓    | ✓    | ✓    | 通过 WebSocket 以批次提交。 |
| OCO 订单 | ✓    | ✓    | ✓    | -    | 仅 UI；API 用户需手动实现。 |
| 括号订单 | ✓    | ✓    | ✓    | -    | 仅 UI；API 用户需手动实现。 |
| 条件订单 | ✓    | ✓    | ✓    | -    | 止损和触价限价订单。        |

### 订单参数

提交订单时可以使用 `params` 字典自定义单个订单：

| 参数               | 类型             | 说明                                                          |
| ------------------ | ---------------- | ------------------------------------------------------------- |
| `is_leverage`      | `bool`           | 仅现货。启用保证金交易（借款）。默认：`False`。               |
| `take_profit`      | `str` 或 `float` | TP 触发价。为订单附加原生 TP。                                |
| `stop_loss`        | `str` 或 `float` | SL 触发价。为订单附加原生 SL。                                |
| `tp_trigger_by`    | `str`            | TP 触发类型：`"LastPrice"`、`"IndexPrice"` 或 `"MarkPrice"`。 |
| `sl_trigger_by`    | `str`            | SL 触发类型：`"LastPrice"`、`"IndexPrice"` 或 `"MarkPrice"`。 |
| `tp_order_type`    | `str`            | TP 执行类型：`"Market"` 或 `"Limit"`。默认：`"Market"`。      |
| `sl_order_type`    | `str`            | SL 执行类型：`"Market"` 或 `"Limit"`。默认：`"Market"`。      |
| `tp_limit_price`   | `str` 或 `float` | `tp_order_type` 为 `"Limit"` 时的 TP 限价。                   |
| `sl_limit_price`   | `str` 或 `float` | `sl_order_type` 为 `"Limit"` 时的 SL 限价。                   |
| `tp_trigger_price` | `str` 或 `float` | 自定义 TP 触发价（覆盖 `take_profit`）。                      |
| `sl_trigger_price` | `str` 或 `float` | 自定义 SL 触发价（覆盖 `stop_loss`）。                        |
| `close_on_trigger` | `bool`           | TP/SL 触发时平仓。默认：`False`。                             |
| `position_idx`     | `int`            | Hedge 模式持仓索引。参阅 [Hedge 模式](#hedge-模式bothsides)。 |
| `bbo_side_type`    | `str`            | 线性/反向 BBO 方向：`"Queue"` 或 `"Counterparty"`。           |
| `bbo_level`        | `str` 或 `int`   | 线性/反向 BBO 订单簿档位：`"1"` 至 `"5"`。                    |

:::note
演示环境中，原生 TP/SL 参数通过 HTTP 创建订单端点路由，但有一个例外：不支持自定义触发价
`tp_trigger_price` 和 `sl_trigger_price`，因为该端点无法携带这些参数，设置任一参数的订单都会被拒绝。
`is_leverage` 参数仅适用于 Spot 产品。请参阅 [Bybit isLeverage 文档](https://bybit-exchange.github.io/docs/v5/order/create-order#request-parameters)。
:::

设置 `bbo_side_type` 和 `bbo_level` 后，Vibe 会发送 Bybit 的 `bboSideType` 和 `bboLevel` 字段，
并从 API 请求中省略订单价格。BBO 订单支持线性和反向的限价单、止损限价单及触价限价单。

#### 示例：带原生 TP/SL 的订单

```python
order = strategy.order_factory.limit(
    instrument_id=InstrumentId.from_str("BTCUSDT-LINEAR.BYBIT"),
    order_side=OrderSide.BUY,
    quantity=Quantity.from_str("0.01"),
    price=Price.from_str("60000.0"),
    params={
        "take_profit": "65000.0",
        "stop_loss": "58000.0",
        "tp_trigger_by": "LastPrice",
        "sl_trigger_by": "LastPrice",
    },
)
strategy.submit_order(order)
```

#### 示例：BBO 订单

```python
order = strategy.order_factory.limit(
    instrument_id=InstrumentId.from_str("BTCUSDT-LINEAR.BYBIT"),
    order_side=OrderSide.BUY,
    quantity=Quantity.from_str("0.01"),
    price=Price.from_str("60000.0"),
    params={"bbo_side_type": "Queue", "bbo_level": 1},
)
strategy.submit_order(order)
```

#### 示例：现货保证金交易

```python
# Submit a Spot order with margin enabled
order = strategy.order_factory.market(
    instrument_id=InstrumentId.from_str("BTCUSDT-SPOT.BYBIT"),
    order_side=OrderSide.BUY,
    quantity=Quantity.from_str("0.1"),
    params={"is_leverage": True},  # Enable margin for this order
)
strategy.submit_order(order)
```

:::note
params 中没有 `is_leverage=True` 时，即使 Bybit 账户已启用自动借款，现货订单也只使用可用余额，不会借款。
:::

包括 `is_leverage` 在内的订单参数完整示例，请参阅
[Python 执行测试器](https://github.com/qOeOp/trade/blob/main/examples/live/bybit/exec_tester.py)。

## 现货保证金借款与还款

VibeTrader 提供自动现货保证金借款还款功能，防止关闭 Bybit 空头持仓后继续产生利息。

### 背景

启用保证金（`is_leverage=True`）交易 Spot 时，执行空头交易后 Bybit 会自动借币。但是平掉空头持仓
（BUY 订单成交）后，借入的币**不会自动偿还**，而会持续产生每小时利息，直到手动还款。
如果无人处理，可能产生高额利息成本。

### 自动还款（推荐）

现货金融工具的 BUY 订单全部成交后，执行客户端可以自动偿还现货保证金借款。此功能默认禁用，
需设置 `auto_repay_spot_borrows=True` 以选择启用。

**工作原理：**

1. Spot BUY 订单在标准 `execution` 频道全部成交后，执行客户端尝试偿还基础币借款。
1. 还款金额上限为未偿借款与该订单各次执行中获得的基础资产数量两者中的较小值。
1. 执行客户端使用 Bybit 的转换还款端点，以覆盖以基础资产计价的交易费用。对于 Bybit 不允许转换还款的 MNT，
   则使用不转换还款，并从金额中减去以 MNT 计价的费用。
1. 请求失败或结果状态为 `FA` 时会记录日志，但不会使执行客户端崩溃。结果状态 `P` 记录为处理中，而非完成。
1. 在 Bybit UTC 禁止时段，执行客户端会推迟队列中的还款。

**示例：**

```python
from vibe_trader.adapters.bybit import BybitExecClientConfig

config = BybitExecClientConfig(
    api_key="YOUR_API_KEY",
    api_secret="YOUR_API_SECRET",
    product_types=[BybitProductType.SPOT],
    auto_repay_spot_borrows=True,  # Opt in; default is False
)
```

### 手动保证金操作

策略可以通过带 `BybitMarginAction` 枚举的 `query_account` 直接控制保证金借款和还款：

| 操作                                  | 说明                 |
| ------------------------------------- | -------------------- |
| `BybitMarginAction.BORROW`            | 借入保证金交易资金。 |
| `BybitMarginAction.REPAY`             | 偿还借入资金。       |
| `BybitMarginAction.GET_BORROW_AMOUNT` | 查询当前借款金额。   |

#### 借款

```python
self.query_account(
    account_id=self.account_id,
    params={"action": BybitMarginAction.BORROW, "coin": "USDT", "amount": 1000},
)
```

#### 还款

```python
# Repay specific amount
self.query_account(
    account_id=self.account_id,
    params={"action": BybitMarginAction.REPAY, "coin": "USDT", "amount": 500},
)

# Repay all (omit amount)
self.query_account(
    account_id=self.account_id,
    params={"action": BybitMarginAction.REPAY, "coin": "USDT"},
)
```

#### 查询借款金额

```python
self.query_account(
    account_id=self.account_id,
    params={"action": BybitMarginAction.GET_BORROW_AMOUNT, "coin": "USDT"},
)
```

:::note
`account_id` 可以从 `self.portfolio.account(BYBIT_VENUE).id` 获取，也可以在策略初始化期间通过配置存储。
:::

#### 接收结果

结果会作为自定义数据发布到消息总线。在策略中订阅即可接收：

```python
from vibe_trader.adapters.bybit import BybitMarginAction
from vibe_trader.adapters.bybit import BybitMarginBorrowResult
from vibe_trader.adapters.bybit import BybitMarginRepayResult
from vibe_trader.adapters.bybit import BybitMarginStatusResult
from vibe_trader.model import DataType


class MyStrategy(Strategy):
    def on_start(self):
        self.subscribe_data(DataType(BybitMarginBorrowResult.__name__))
        self.subscribe_data(DataType(BybitMarginRepayResult.__name__))
        self.subscribe_data(DataType(BybitMarginStatusResult.__name__))

    def on_data(self, data):
        if isinstance(data, BybitMarginBorrowResult):
            if data.success:
                self.log.info(f"Borrowed {data.amount} {data.coin}")
            else:
                self.log.error(f"Borrow failed: {data.message}")
        elif isinstance(data, BybitMarginRepayResult):
            if data.success:
                self.log.info(f"Repaid {data.amount or 'all'} {data.coin}")
            else:
                self.log.error(f"Repay failed: {data.message}")
        elif isinstance(data, BybitMarginStatusResult):
            self.log.info(f"Borrow amount for {data.coin}: {data.borrow_amount}")
```

### UTC 禁止时段

Bybit 为计算利息，会在每个 UTC 小时开始后的**第 4 分钟至第 5 分 30 秒**阻止两个还款端点。
自动还款会让请求继续排队，并在该小时的第 5 分 31 秒尝试。

### 自动还款配置

| 选项                      | 类型   | 默认值  | 说明                                                                          |
| ------------------------- | ------ | ------- | ----------------------------------------------------------------------------- |
| `auto_repay_spot_borrows` | `bool` | `False` | 如果为 `True`，Spot 保证金 BUY 订单全部成交后自动还款。禁止时段内会推迟还款。 |

### 自动还款说明

- 自动还款只由 **Spot BUY 订单**触发，不包括衍生品。
- 除 MNT 使用不转换还款外，其余使用转换还款。
- Bybit 在[手动还款](https://bybit-exchange.github.io/docs/v5/account/repay)和
  [不转换资产的手动还款](https://bybit-exchange.github.io/docs/v5/account/no-convert-repay)中说明了端点限制和结果状态。
- 除非 Bybit 账户启用了自动借款，否则建空仓前仍需手动借款。

### 现货交易限制

由于交易场所侧不跟踪现货持仓，Spot 产品有以下限制：

- *不支持* `reduce_only` 订单。
- *不支持*追踪止损订单。

### 期权交易

Bybit 上市以 USDT 或 USDC 结算的 BTC 和 ETH 欧式期权。适配器使用 `CryptoOption` 金融工具类型和
`-OPTION` 符号后缀。完整符号格式请参阅[符号体系章节](#符号体系)。

#### 期权数据

适配器通过 WebSocket ticker 频道支持实时期权市场数据：

| 数据类型          | 说明                                               |
| ----------------- | -------------------------------------------------- |
| 报价（买价/卖价） | 每份期权合约的最优档价格和数量。                   |
| Greeks            | Delta、gamma、vega、theta，以及买价/卖价/标记 IV。 |
| 标记价格          | 每份期权合约的交易所标记价格。                     |
| 指数价格          | 标的指数价格。                                     |
| 标的（远期）价格  | 按到期日计算的远期价格，用于确定 ATM。             |
| 未平仓量          | 逐合约未平仓量。                                   |
| 订单簿增量        | 来自期权订单簿数据流的 L2 MBP 更新。               |

可以订阅逐金融工具 Greeks，也可以使用相对于 ATM 的行权价筛选，将其聚合为期权链快照。
订阅模式请参阅[期权概念指南](../concepts/options.md)，分步操作请参阅
[期权数据教程](../tutorials/options_data_bybit.md)。VibeTrader 会根据 Bybit 的逐合约期权市场数据，
在本地构建期权链视图。

期权不提供 K 线数据。Bybit 不为此产品类型提供 K 线数据流。

#### 期权订单参数

除标准订单参数外，期权订单还接受：

| 参数       | 类型             | 说明                                 |
| ---------- | ---------------- | ------------------------------------ |
| `order_iv` | `str` 或 `float` | 按隐含波动率而非价格下单或修改订单。 |
| `mmp`      | `bool`           | 为订单启用做市商保护。               |

这些参数通过 `SubmitOrder` 上的 `params` 传递。主网中通过 WebSocket 交易频道传输；演示环境中通过
HTTP 创建订单端点路由。演示模式不支持通过 `order_iv` 修改现有订单。

#### 期权交易限制

- 演示模式不支持按隐含波动率（`order_iv`）修改订单及其他仅限 WS 交易的功能。
- 杠杆不可配置。期权买方支付权利金；卖方缴纳保证金。
- 仅支持单向持仓模式，不支持 Hedge 模式。
- 不支持条件订单类型（`STOP_MARKET`、`STOP_LIMIT`、`MARKET_IF_TOUCHED`、`LIMIT_IF_TOUCHED`）。
- 不支持交易止损（持仓上的 TP/SL）。
- 资金费率不适用于期权。
- 期权要求 Unified Trading Account（UTA）。

### 追踪止损

Bybit 上的追踪止损在交易场所侧没有客户端订单 ID（但有 `venue_order_id`）。这是因为追踪止损与金融工具的
净额持仓相关联。使用 Bybit 追踪止损时请注意：

- 可以使用 `reduce_only` 指令
- 与追踪止损关联的持仓关闭后，追踪止损会在交易场所侧自动"停用"（关闭）。
- 无法查询尚未处于未结状态的追踪止损订单（在此之前 `venue_order_id` 未知）。
- 可以在 GUI 中手动调整触发价，这会更新 Vibe 订单。

## 资金费率

适配器从[线性 Ticker](https://bybit-exchange.github.io/docs/v5/websocket/public/ticker#linear-inverse-perpetual-response)
WebSocket 数据流接收资金费率数据。Bybit 在 ticker 更新中提供 `fundingIntervalHour` 字段，适配器用它填充
`FundingRateUpdate` 的 `interval` 字段。

适配器按符号缓存最近已知的 `fundingIntervalHour`，因此省略该字段的部分 ticker 更新仍会携带正确周期。

对于历史资金费率请求，适配器根据相邻资金费率时间戳计算周期。

## 速率限制

每次 HTTP 调用都会消耗全局令牌桶以及任何带键配额。使用量超过某个桶时，请求会自动排队，
因此很少需要手动限流。

| 键 / 端点                | 限制（请求/秒） | 说明                              |
| ------------------------ | --------------- | --------------------------------- |
| `bybit:global`           | 120             | 全交易所上限为 600 req / 5 s。    |
| `/v5/market/kline`       | 20              | 历史扫描的限流略低于全局值。      |
| `/v5/market/trades`      | 24              | 与全局配额一致。                  |
| `/v5/order/create`       | 10              | 标准下单。                        |
| `/v5/order/cancel`       | 10              | 取消单个订单。                    |
| `/v5/order/create-batch` | 5               | 批量下单端点。                    |
| `/v5/order/cancel-batch` | 5               | 批量取消端点。                    |
| `/v5/order/cancel-all`   | 2               | 全订单簿取消，以符合 Bybit 指南。 |

:::warning
超过速率限制时，Bybit 会响应错误代码 `10016`；如果请求持续发送且不退避，可能临时封禁 IP。
:::

:::info
有关速率限制的更多信息，请参阅官方文档：<https://bybit-exchange.github.io/docs/v5/rate-limit>。
:::

### 数据客户端

如果没有指定产品类型，将加载并提供所有产品类型。

### 执行客户端

适配器会根据配置的产品类型自动确定账户类型：

- **仅现货**：使用已启用借款支持的 `CASH` 账户类型
- **衍生品或混合产品**：使用 `MARGIN` 账户类型（UTA - Unified Trading Account）

这样便可在单个 Unified Trading Account 中同时交易 Spot 和衍生品，这是大多数 Bybit 用户的标准账户类型。

:::info
**Unified Trading Account（UTA）与现货保证金交易**

随着 Bybit 引导新用户使用 Unified Trading Account（UTA），现在大多数 Bybit 用户都使用 UTA。
Classic 账户被视为旧版账户。

在 UTA 账户上进行 Spot 保证金交易：

- 借款**不会自动启用**，需要显式 API 配置
- 要通过 API 使用 Spot 保证金，提交订单时必须在参数中设置 `is_leverage=True`
  （参阅 [Bybit 文档](https://bybit-exchange.github.io/docs/v5/order/create-order#request-parameters)）
- 如果 Bybit 账户启用了自动借款/自动还款，交易场所会为这些保证金订单自动借款/还款
- 未启用自动借款时，需要通过 Bybit 界面手动管理借款

**重要**：Vibe Bybit 适配器对 Spot 订单默认使用 `is_leverage=False`，即除非显式启用，否则不会使用保证金。
:::

## 费用货币逻辑

了解 Bybit 如何确定交易费用货币，对于准确记账和持仓跟踪非常重要。Spot 与衍生品的费用货币规则不同。

### 现货交易费用

Spot 交易的费用货币取决于订单方向，以及费用是否为返佣（挂单方订单的负费用）：

#### 正常费用（正数）

- **BUY 订单**：以**基础货币**收取费用（例如 BTCUSDT 使用 BTC）
- **SELL 订单**：以**报价货币**收取费用（例如 BTCUSDT 使用 USDT）

#### 挂单方返佣（负费用）

挂单方费用为负数（返佣）时，货币逻辑会**反转**：

- **带挂单方返佣的 BUY 订单**：以**报价货币**支付返佣（例如 BTCUSDT 使用 USDT）
- **带挂单方返佣的 SELL 订单**：以**基础货币**支付返佣（例如 BTCUSDT 使用 BTC）

:::note
**吃单方订单绝不会使用反转逻辑**，即使挂单方费率为负。吃单方费用始终遵循正常费用货币规则。
:::

#### 示例：BTCUSDT Spot

- **作为吃单方买入 1 BTC（0.1% 费用）**：支付 0.001 BTC 费用
- **作为吃单方卖出 1 BTC（0.1% 费用）**：支付等值 USDT 费用
- **作为挂单方买入 1 BTC（-0.01% 返佣）**：获得 USDT 返佣（反转）
- **作为挂单方卖出 1 BTC（-0.01% 返佣）**：获得 BTC 返佣（反转）

### 衍生品交易费用

所有衍生品（LINEAR、INVERSE、OPTION）的费用始终以**结算货币**收取：

| 产品类型 | 结算货币                       | 费用货币 |
| -------- | ------------------------------ | -------- |
| LINEAR   | USDT（通常）                   | USDT     |
| INVERSE  | 基础币（例如 BTCUSD 使用 BTC） | 基础币   |
| OPTION   | USDT                           | USDT     |

### 费用计算

当 WebSocket 执行消息不提供确切费用金额（`execFee`）时，适配器按以下方式计算费用：

#### 现货产品

- **BUY 订单**：`fee = base_quantity × fee_rate`
- **SELL 订单**：`fee = notional_value × fee_rate`（其中 `notional_value = quantity × price`）

#### 衍生品

- 所有衍生品：`fee = notional_value × fee_rate`

### 官方文档

有关 Bybit 费用结构和货币规则的完整信息，请参阅：

- [Bybit WebSocket 私有执行](https://bybit-exchange.github.io/docs/v5/websocket/private/execution)
- [Bybit 现货费用货币指令](https://bybit-exchange.github.io/docs/v5/enum#spot-fee-currency-instruction)

## 配置

每个客户端的产品类型必须在配置中指定。

### 数据客户端配置选项

| 选项                               | 默认值     | 说明                                                                                                     |
| ---------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| `product_types`                    | `[LINEAR]` | 要启用的 `BybitProductType` 值序列。                                                                     |
| `environment`                      | `MAINNET`  | Bybit 环境枚举。使用 `BybitEnvironment.MAINNET`、`BybitEnvironment.DEMO` 或 `BybitEnvironment.TESTNET`。 |
| `api_key`                          | `None`     | API 密钥；省略时从匹配的环境变量加载。                                                                   |
| `api_secret`                       | `None`     | API Secret；省略时从匹配的环境变量加载。                                                                 |
| `base_url_http`                    | `None`     | REST 基础 URL 覆盖值。                                                                                   |
| `base_url_ws_public`               | `None`     | 公共 WebSocket URL 覆盖值。                                                                              |
| `base_url_ws_private`              | `None`     | 私有 WebSocket URL 覆盖值。                                                                              |
| `proxy_url`                        | `None`     | 可选 HTTP 和 WebSocket 传输代理 URL。                                                                    |
| `http_timeout_secs`                | `60`       | REST 请求超时（秒）。                                                                                    |
| `max_retries`                      | `3`        | REST 请求的最大重试次数。                                                                                |
| `retry_delay_initial_ms`           | `1,000`    | 初始重试延迟（毫秒）。                                                                                   |
| `retry_delay_max_ms`               | `10,000`   | 最大重试延迟（毫秒）。                                                                                   |
| `heartbeat_interval_secs`          | `20`       | WebSocket 客户端心跳间隔（秒）。                                                                         |
| `recv_window_ms`                   | `5,000`    | 已签名 REST 请求的接收窗口（毫秒）。                                                                     |
| `update_instruments_interval_mins` | `60`       | 金融工具目录刷新间隔（分钟）。                                                                           |
| `instrument_status_poll_secs`      | `60`       | 金融工具和状态轮询间隔（秒）。                                                                           |
| `transport_backend`                | `Sockudo`  | WebSocket 传输后端。                                                                                     |

### 执行客户端配置选项

| 选项                        | 默认值     | 说明                                                                                                     |
| --------------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| `product_types`             | `[LINEAR]` | 要启用的 `BybitProductType` 值序列。执行时 Spot 不能与衍生品混合。                                       |
| `environment`               | `MAINNET`  | Bybit 环境枚举。使用 `BybitEnvironment.MAINNET`、`BybitEnvironment.DEMO` 或 `BybitEnvironment.TESTNET`。 |
| `api_key`                   | `None`     | API 密钥；省略时从匹配的环境变量加载。                                                                   |
| `api_secret`                | `None`     | API Secret；省略时从匹配的环境变量加载。                                                                 |
| `base_url_http`             | `None`     | REST 基础 URL 覆盖值。                                                                                   |
| `base_url_ws_private`       | `None`     | 私有 WebSocket 基础 URL 覆盖值。                                                                         |
| `base_url_ws_trade`         | `None`     | 交易 WebSocket 基础 URL 覆盖值。                                                                         |
| `proxy_url`                 | `None`     | 可选 HTTP 和 WebSocket 传输代理 URL。                                                                    |
| `http_timeout_secs`         | `60`       | REST 请求超时（秒）。                                                                                    |
| `max_retries`               | `3`        | REST 请求的最大重试次数。                                                                                |
| `retry_delay_initial_ms`    | `1,000`    | 初始重试延迟（毫秒）。                                                                                   |
| `retry_delay_max_ms`        | `10,000`   | 最大重试延迟（毫秒）。                                                                                   |
| `heartbeat_interval_secs`   | `5`        | WebSocket 客户端心跳间隔（秒）。                                                                         |
| `auth_timeout_secs`         | `None`     | 可选 WebSocket 认证超时（秒）。                                                                          |
| `recv_window_ms`            | `5,000`    | 已签名 REST 请求的接收窗口（毫秒）。                                                                     |
| `account_id`                | `None`     | 与此客户端关联的可选账户 ID。                                                                            |
| `use_spot_position_reports` | `False`    | 为 `True` 时将 Spot 钱包余额报告为持仓。                                                                 |
| `auto_repay_spot_borrows`   | `False`    | Spot 保证金 BUY 订单全部成交后自动偿还已跟踪借款。                                                       |
| `margin_mode`               | `None`     | 账户的统一保证金模式设置。                                                                               |
| `transport_backend`         | `Sockudo`  | WebSocket 传输后端。                                                                                     |

编译时，如果启用 `transport-sockudo` Cargo 功能，则默认为 Sockudo；否则默认为 Tungstenite。

将 `BybitDataClientConfig` 与 `BybitDataClientFactory` 搭配使用，将 `BybitExecClientConfig` 与
`BybitExecutionClientFactory` 搭配使用。当前 Python 示例展示了数据客户端和执行客户端的完整
`LiveNode.builder(...)` 配置。

### API 凭证

有两种方式向 Bybit 客户端提供凭证：将相应 `api_key` 和 `api_secret` 值传给配置对象，
或设置以下环境变量。

Bybit 实盘客户端可以设置：

- `BYBIT_API_KEY`
- `BYBIT_API_SECRET`

Bybit 演示客户端可以设置：

- `BYBIT_DEMO_API_KEY`
- `BYBIT_DEMO_API_SECRET`

Bybit 测试网客户端可以设置：

- `BYBIT_TESTNET_API_KEY`
- `BYBIT_TESTNET_API_SECRET`

:::tip
建议使用环境变量管理凭证。
:::

启动交易节点时，会立即收到凭证是否有效以及是否具有交易权限的确认。

## 贡献

:::info
如需添加功能或为 Bybit 适配器贡献代码，请参阅我们的
[贡献指南](https://github.com/qOeOp/trade/blob/main/CONTRIBUTING.md)。
:::
