# 概览

## 简介

VibeTrader 是一个开源、生产级、原生 Rust 的多资产、多场所交易系统引擎。

系统在单一事件驱动架构中覆盖研究、确定性模拟和实盘执行，Python 作为策略逻辑、配置和编排的控制平面。

这种分离同时提供编译型交易引擎的性能与安全性，以及 Python 在系统组合和策略开发方面的灵活性。
关键工作负载的交易系统也可以完全使用 Rust 编写。

研究系统和实盘系统采用相同的执行语义与确定性时间模型。策略无需修改代码即可从研究部署到生产，
实现研究与实盘的一致性，并减少通常会引入部署风险的偏差。

VibeTrader 与资产类别无关。任何具有 REST API 或 WebSocket feed 的场所都可以通过模块化适配器集成。
集成范围包括中心化和去中心化加密货币交易所（CEX 和 DEX）、外汇（FX）、股票、期货、期权和博彩交易所。

## 功能

- **快速**：Rust 核心使用 [tokio](https://crates.io/crates/tokio) 进行异步网络处理。
- **可靠**：Rust 提供类型安全和线程安全，并可选择使用 Redis 或 PostgreSQL 作为后备存储持久化状态。
- **可移植**：运行于 Linux、macOS 和 Windows，可使用 Docker 部署。
- **灵活**：模块化适配器可集成任何 REST API 或 WebSocket feed。
- **高级订单**：有效时间选项包括 `IOC`、`FOK`、`GTC`、`GTD`、`DAY`、`AT_THE_OPEN` 和
  `AT_THE_CLOSE`。领域模型还支持条件触发、`post-only`、`reduce-only`、冰山订单，以及 `OCO`、
  `OUO`、`OTO` 联动订单。场所支持情况因适配器而异。
- **可定制**：使用用户定义组件，或通过[缓存](cache.md)和[消息总线](message_bus.md)从头组装整个系统。
- **回测**：使用历史报价、成交、K 线、订单簿和自定义数据，以纳秒分辨率同时运行多个场所、交易工具和策略。
- **实盘**：研究与实盘部署使用完全相同的策略实现。
- **多场所**：同时跨多个场所运行做市和跨场所策略。
- **AI 训练**：高吞吐量模拟支持使用强化学习（RL）或进化策略（ES）训练 AI 交易 Agent 等工作负载。

## 为什么选择 VibeTrader？

交易策略研究通常在 Python 中使用向量化方法完成，而生产交易系统则会使用编译型语言中的事件驱动架构
另行构建。

VibeTrader 消除了这种分离。

原生 Rust 核心为研究和实盘执行提供确定性事件驱动运行时，Python 则充当控制平面。
两个环境使用相同架构、执行语义和时间模型，使策略无需重新实现即可从研究进入生产。

原生 Rust 运行时的 Python 绑定通过 [PyO3](https://pyo3.rs) 提供。安装官方预编译 Python wheel
不需要 Rust 工具链。

## 用例

VibeTrader 支持三个主要用例：

- 使用历史数据回测交易系统（`backtest`）。
- 使用实时数据和虚拟执行模拟交易系统（`sandbox`）。
- 在真实或模拟账户上实盘部署交易系统（`live`）。

VibeTrader 为 Python 和 Rust 同时提供回测与实盘节点实现。sandbox 适配器为 `sandbox` 环境提供模拟执行。

:::note

- 除非另有说明，示例使用这些节点实现。
- 交易策略只是端到端交易系统的一个组件；系统还包括应用层和基础设施层。

:::

## 分布式系统

平台可以集成到更大的分布式系统中。[外部消息总线](message_bus.md#encoding)支持 JSON 和 MessagePack
payload，并为 schema 覆盖的市场数据支持 Cap'n Proto 与 Simple Binary Encoding（SBE）。Apache Arrow
和 Parquet 通过[数据 catalog](data/index.md#data-catalog)提供列式交换和持久化。格式支持情况因 payload
类型而异。

## 通用核心

通用系统核心由所有节点[环境上下文](architecture.md#environment-contexts)使用：`backtest`、`sandbox` 和
`live`。用户定义的 Actor、策略和执行算法在这些上下文中使用相同生命周期。

## 回测

把数据直接馈送给 `BacktestEngine`，或通过更高级的 `BacktestNode` 和 `ParquetDataCatalog` 馈送，
然后以纳秒分辨率使数据流经系统。有关 API 和执行模型，请参阅[回测](backtesting/)。

## 实盘交易

`LiveNode` 从多个数据和执行客户端摄取数据与事件，支持 demo、模拟和真实账户。原生 Rust 节点及其 PyO3
接口会在调用线程上运行 kernel 事件循环，异步 I/O 和后台任务则使用共享的多线程 Tokio 运行时。
有关节点生命周期和风险注意事项，请参阅[实盘交易](live.md)；有关状态恢复，请参阅
[执行对账](reconciliation.md)。

## 领域模型

交易领域模型包括 `Price`、`Quantity` 等[值类型](value_types.md)，以及聚合事件以确定状态的
[订单](orders/)和[持仓](positions.md)。

## 时间戳

VibeTrader 以 UNIX 纳秒表示系统时间戳。其标准 ISO 8601（RFC 3339）格式化器使用 UTC，
并保留全部九位小数。毫秒格式化器会为指定显示保留三位小数，例如有效期至指定日期（GTD）的到期时间。

时间戳字符串由以下部分组成：

- 始终存在的完整日期部分：`YYYY-MM-DD`。
- 日期和时间部分之间的 `T` 分隔符。
- 纳秒输出使用九位小数，毫秒输出使用三位小数。
- UTC 时区由 `Z` 后缀表示。

示例：`2024-01-05T15:30:45.123456789Z`

完整规范请参阅
[RFC 3339：互联网日期与时间](https://datatracker.ietf.org/doc/html/rfc3339)。

## UUID

`UUID4` 值类型为事件、命令、报告和其他内部消息提供随机的通用唯一标识符（UUID）版本 4 值。
它使用 `uuid` crate，在解析字符串时验证版本和 variant bit。

符合 RFC 9562 的有效 UUID v4 包含：

- 分成 5 组显示的 32 个十六进制数字。
- 组之间用连字符分隔，格式为 `8-4-4-4-12`。
- 版本 4 标识（第三组以 "4" 开头）。
- IETF variant 标识（第四组以 "8""9""a" 或 "b" 开头）。

示例：`2d89666b-1a1e-4a75-b193-4eb3b454c757`

完整规范请参阅
[RFC 9562：通用唯一标识符（UUID）](https://www.rfc-editor.org/rfc/rfc9562.html)。

## 数据类型

VibeTrader 定义了以下内置市场和参考数据类型。历史请求和实时订阅能否使用取决于 provider 和适配器。
有关字段和行为，请参阅[数据](data/index.md)。

- `OrderBookDelta`（单个订单簿变更）
- `OrderBookDeltas`（容器类型）
- `OrderBookDepth10`（每侧固定 10 档深度）
- `QuoteTick`
- `TradeTick`
- `Bar`
- `MarkPriceUpdate`
- `IndexPriceUpdate`
- `FundingRateUpdate`
- `OptionGreeks`
- `Instrument`
- `InstrumentStatus`
- `InstrumentClose`

应用特有类型使用[自定义数据](custom_data.md)。

以下 `PriceType` 选项为内部 K 线聚合选择细粒度数据：

- `BID`
- `ASK`
- `MID`
- `LAST`

`BID`、`ASK` 和 `MID` 使用 `QuoteTick` 数据，`LAST` 使用 `TradeTick` 数据。
复合 K 线类型则聚合较小 K 线。

## K 线聚合

可使用以下 `BarAggregation` 方法：

- `MILLISECOND`
- `SECOND`
- `MINUTE`
- `HOUR`
- `DAY`
- `WEEK`
- `MONTH`
- `YEAR`
- `TICK`
- `VOLUME`
- `VALUE`（也称美元 K 线）
- `RENKO`（基于价格的砖形图）
- `TICK_IMBALANCE`
- `TICK_RUNS`
- `VOLUME_IMBALANCE`
- `VOLUME_RUNS`
- `VALUE_IMBALANCE`
- `VALUE_RUNS`

所有列出的聚合都已实现为内部聚合。信息驱动聚合需要 `TradeTick` 数据。

`BarSpecification` 组合价格类型、聚合方法和正步长。固定子单位时间 K 线具有整除限制；验证规则请参阅
[K 线类型](data/index.md#bar-types)。只要所需输入数据可用，实盘交易期间也可以运行内部聚合。

## 账户类型

[账户核算引擎](accounting.md#account-types)在实盘和回测环境中都支持以下配置：

- `Cash` 单货币（基础货币）
- `Cash` 多货币
- `Margin` 单货币（基础货币）
- `Margin` 多货币
- `Betting` 单货币

## 订单类型

[订单模型](orders/)支持以下类型，具体取决于场所适配器支持：

- `MARKET`
- `LIMIT`
- `STOP_MARKET`
- `STOP_LIMIT`
- `MARKET_TO_LIMIT`
- `MARKET_IF_TOUCHED`
- `LIMIT_IF_TOUCHED`
- `TRAILING_STOP_MARKET`
- `TRAILING_STOP_LIMIT`

## 值类型

根据编译时使用的[精度模式](../getting_started/installation.md#precision-mode)，以下定点值类型由
128 位或 64 位原始整数支持。

- `Price`
- `Quantity`
- `Money`

官方 Python wheel 在所有受支持平台上使用高精度模式。纯 Rust 构建默认使用标准精度，
除非启用 `high-precision` feature。

### 高精度模式（128 位）

**启用** `high-precision` feature flag 时，值使用以下规范：

| 类型       | 原始后备类型 | 最大精度 | 最小值              | 最大值             |
| :--------- | :----------- | :------- | :------------------ | :----------------- |
| `Price`    | `i128`       | 16       | -17,014,118,346,046 | 17,014,118,346,046 |
| `Money`    | `i128`       | 16       | -17,014,118,346,046 | 17,014,118,346,046 |
| `Quantity` | `u128`       | 16       | 0                   | 34,028,236,692,093 |

### 标准精度模式（64 位）

**禁用** `high-precision` feature flag 时，值使用以下规范：

| 类型       | 原始后备类型 | 最大精度 | 最小值         | 最大值         |
| :--------- | :----------- | :------- | :------------- | :------------- |
| `Price`    | `i64`        | 9        | -9,223,372,036 | 9,223,372,036  |
| `Money`    | `i64`        | 9        | -9,223,372,036 | 9,223,372,036  |
| `Quantity` | `u64`        | 9        | 0              | 18,446,744,073 |
