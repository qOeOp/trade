# 集成

VibeTrader 使用模块化*适配器*连接交易场所与数据提供商，将原始 API 转换为统一接口和规范化领域模型。

:::note[Python API 版本]
这些集成指南中的所有 Python 代码均以 Rust 支持的 v2 软件包为前提。本文不再介绍旧版 v1 Python
适配器和 API。
:::

目前支持以下集成：

| 名称                                                      | ID                    | 类型                  | 状态                                                 | 文档                    |
| :-------------------------------------------------------- | :-------------------- | :-------------------- | :--------------------------------------------------- | :---------------------- |
| [AX Exchange](https://architect.exchange)                 | `AX`                  | 衍生品交易所          | ![status](https://img.shields.io/badge/stable-green) | [指南](architect_ax.md) |
| [Betfair](https://betfair.com)                            | `BETFAIR`             | 体育博彩交易所        | ![status](https://img.shields.io/badge/stable-green) | [指南](betfair.md)      |
| [Binance](https://binance.com)                            | `BINANCE`             | 加密货币交易所（CEX） | ![status](https://img.shields.io/badge/stable-green) | [指南](binance.md)      |
| [Coinbase](https://coinbase.com)                          | `COINBASE`            | 加密货币交易所（CEX） | ![status](https://img.shields.io/badge/stable-green) | [指南](coinbase.md)     |
| [BitMEX](https://www.bitmex.com)                          | `BITMEX`              | 加密货币交易所（CEX） | ![status](https://img.shields.io/badge/stable-green) | [指南](bitmex.md)       |
| [区块链](blockchain.md)                                   | `BLOCKCHAIN`          | DeFi 数据提供商       | ![status](https://img.shields.io/badge/stable-green) | [指南](blockchain.md)   |
| [Bybit](https://www.bybit.com)                            | `BYBIT`               | 加密货币交易所（CEX） | ![status](https://img.shields.io/badge/stable-green) | [指南](bybit.md)        |
| [Databento](https://databento.com)                        | `DATABENTO`           | 数据提供商            | ![status](https://img.shields.io/badge/stable-green) | [指南](databento.md)    |
| [Deribit](https://www.deribit.com)                        | `DERIBIT`             | 加密货币交易所（CEX） | ![status](https://img.shields.io/badge/stable-green) | [指南](deribit.md)      |
| [Derive](https://www.derive.xyz)                          | `DERIVE`              | 加密货币交易所（DEX） | ![status](https://img.shields.io/badge/stable-green) | [指南](derive.md)       |
| [dYdX](https://dydx.exchange/)                            | `DYDX`                | 加密货币交易所（DEX） | ![status](https://img.shields.io/badge/stable-green) | [指南](dydx.md)         |
| [Hyperliquid](https://hyperliquid.xyz)                    | `HYPERLIQUID`         | 加密货币交易所（DEX） | ![status](https://img.shields.io/badge/stable-green) | [指南](hyperliquid.md)  |
| [Lighter](https://lighter.xyz)                            | `LIGHTER`             | 加密货币交易所（DEX） | ![status](https://img.shields.io/badge/stable-green) | [指南](lighter.md)      |
| [Interactive Brokers](https://www.interactivebrokers.com) | `INTERACTIVE_BROKERS` | 经纪商（多交易场所）  | ![status](https://img.shields.io/badge/stable-green) | [指南](ib.md)           |
| [Kraken](https://kraken.com)                              | `KRAKEN`              | 加密货币交易所（CEX） | ![status](https://img.shields.io/badge/stable-green) | [指南](kraken.md)       |
| [OKX](https://okx.com)                                    | `OKX`                 | 加密货币交易所（CEX） | ![status](https://img.shields.io/badge/stable-green) | [指南](okx.md)          |
| [Polymarket](https://polymarket.com)                      | `POLYMARKET`          | 预测市场（DEX）       | ![status](https://img.shields.io/badge/stable-green) | [指南](polymarket.md)   |
| [Tardis](https://tardis.dev)                              | `TARDIS`              | 加密货币数据提供商    | ![status](https://img.shields.io/badge/stable-green) | [指南](tardis.md)       |

- **ID**：集成适配器客户端的默认客户端 ID。
- **类型**：集成类型（通常是交易场所类型）。

## 状态

- `planned`：计划在未来开发。
- `building`：正在开发，可能尚不可用。
- `beta`：已达到最低可用状态，当前处于"beta"测试阶段。
- `stable`：功能集和 API 已趋于稳定，开发者与用户已进行合理程度的测试（仍可能存在一些缺陷）。

## 实现目标

VibeTrader 的首要目标是提供一个可接入多种集成的统一交易系统。为了支持尽可能广泛的交易
策略，将优先实现*标准*功能：

- 请求历史市场数据。
- 流式接收实盘市场数据。
- 对账执行状态。
- 使用标准执行指令提交标准订单类型。
- 修改现有订单（如果交易所支持）。
- 取消订单。

每项集成的实现都力求满足以下标准：

- 底层客户端组件应尽可能贴近交易所 API。
- 最终应支持交易所的全部功能（以适用于 VibeTrader 的部分为限）。
- 将添加交易所专用数据类型，以支持用户合理预期的功能和返回类型。
- 调用交易所或 VibeTrader 不支持的操作时，将记录 warning 或 error 日志。

::::warning[跟踪日志与凭据]

TRACE 日志可能包含原始出站 WebSocket 载荷，其中可能带有部分交易场所的身份验证数据。
TRACE 只应用于本地调试；共享前请清理其中的敏感信息。

::::

## API 统一

所有集成都必须符合 VibeTrader 系统 API，并进行规范化与标准化：

- 除非需要消除歧义（例如 Binance Spot 与 Binance Futures），否则符号应采用交易场所原生格式。
- 时间戳必须使用 UNIX 纪元纳秒。若使用毫秒，字段或属性名称应明确以 `_ms` 结尾。
