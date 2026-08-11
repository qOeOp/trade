# 数据

VibeTrader 支持细粒度订单簿数据、报价、成交、K 线、参考价格和自定义数据。
本概述链接到各内置类型，并说明回测、沙盒和实盘环境共有的概念。

## 内置数据类型

每种主要的内置市场数据类型都有专门的指南，介绍其字段、行为和构造方式。

| 数据类型                                      | 类别         | 说明                                     |
| --------------------------------------------- | ------------ | ---------------------------------------- |
| [`OrderBookDelta`](order_book_delta.md)       | 订单簿       | 单次增量订单簿变更。                     |
| [`OrderBookDeltas`](order_book_deltas.md)     | 订单簿       | 一批相关的订单簿增量数据。               |
| [`OrderBookDepth10`](order_book_depth10.md)   | 订单簿       | 固定的前 10 档买价和卖价。               |
| [`QuoteTick`](quote_tick.md)                  | 最优报价     | 最优买卖价格及数量。                     |
| [`TradeTick`](trade_tick.md)                  | 成交         | 交易场所的单次成交或撮合事件。           |
| [`Bar`](bar.md)                               | 聚合         | 特定 `BarType` 的 OHLCV K 线。           |
| [`MarkPriceUpdate`](mark_price_update.md)     | 衍生品参考价 | 衍生金融工具的标记价格。                 |
| [`IndexPriceUpdate`](index_price_update.md)   | 衍生品参考价 | 衍生品市场使用的指数价格。               |
| [`FundingRateUpdate`](funding_rate_update.md) | 衍生品参考价 | 资金费率及下一次资金结算元数据。         |
| [`OptionGreeks`](option_greeks.md)            | 期权         | 交易场所提供的希腊字母指标和隐含波动率。 |
| [`InstrumentStatus`](instrument_status.md)    | 金融工具事件 | 交易、报价及停牌状态变更。               |
| [`InstrumentClose`](instrument_close.md)      | 金融工具事件 | 收盘、结算或交易场所其他收盘价格事件。   |

当数据通过消息总线流动时，可按主题寻址的数据位于 `data` 根主题下。
实时数据流使用 `data.<kind>...`；数据管道路径使用 `data.pipeline.<kind>...`。
主题层级请参阅[消息总线](../message_bus.md#topic-hierarchy)。

## 订单簿

Rust `OrderBook` 在回测和实盘交易中维护单个金融工具的状态。VibeTrader 支持以下订单簿类型：

- `L3_MBO`：三级逐笔委托（MBO）数据，以每个价格档位的订单 ID 为键。
- `L2_MBP`：二级逐价（MBP）数据，按价格档位聚合。
- `L1_MBP`：一级逐价（MBP）最优报价数据，也称最佳买卖报价（BBO）。

:::note
报价、成交和 K 线数据（`QuoteTick`、`TradeTick` 和 `Bar`）也可在回测中驱动
`L1_MBP` 订单簿。
:::

### 增量标志与事件边界

每个 `OrderBookDelta` 都带有一个 `flags` 字段，该字段使用 `RecordFlag` 位掩码值，
用于向 `DataEngine` 标示事件边界：

- `F_LAST`：标记逻辑事件组中的最后一条增量数据。启用 `buffer_deltas` 后，
  `DataEngine` 会累积增量数据，并且只有遇到 `F_LAST` 时才向订阅者发布。
  每个事件组都**必须**以设置了 `F_LAST` 的增量数据结束。
- `F_SNAPSHOT`：标记属于快照（而非增量更新）的增量数据。快照序列以 `Clear`
  操作开头，随后用 `Add` 增量数据重建完整订单簿状态。快照中的最后一条增量数据
  会同时设置 `F_SNAPSHOT | F_LAST`。

:::warning
如果事件组的最后一条增量数据缺少 `F_LAST`，使用缓冲的消费者会无限期累积数据而不发布。
这同样适用于增量更新和快照，包括只发出一条 `Clear` 增量数据的空订单簿快照。
:::

## 金融工具

所有市场数据都属于某个金融工具。金融工具定义提供标识、精度、价格与数量增量、限制、
货币以及合约语义，使数据具有明确含义。

金融工具分类及各类型指南请参阅[金融工具](../instruments/)。

## K 线与聚合

### K 线简介

*K 线*也称蜡烛图或 kline，用于汇总某个区间内的价格与成交量：

- 开盘价
- 最高价
- 最低价
- 收盘价
- 成交量（或以 tick 数量作为成交量代理值）

*聚合方法*定义 VibeTrader 如何将输入数据分组为 K 线。

### 数据聚合的用途

聚合将细粒度市场数据转换为 K 线，从而：

- 为技术指标和策略提供输入。
- 匹配策略所需的时间分辨率。
- 相比高频订单簿数据，减少存储和处理开销。

### 聚合方法

VibeTrader 支持以下聚合方法：

| 名称               | 说明                                       | 类别     |
| :----------------- | :----------------------------------------- | :------- |
| `TICK`             | tick 数量。                                | 阈值     |
| `TICK_IMBALANCE`   | tick 的买卖不平衡。                        | 阈值     |
| `TICK_RUNS`        | tick 的连续买入/卖出游程。                 | 信息驱动 |
| `VOLUME`           | 成交量。                                   | 阈值     |
| `VOLUME_IMBALANCE` | 成交量的买卖不平衡。                       | 阈值     |
| `VOLUME_RUNS`      | 成交量的连续买入/卖出游程。                | 信息驱动 |
| `VALUE`            | 名义成交价值，也称美元 K 线。              | 阈值     |
| `VALUE_IMBALANCE`  | 名义成交价值的买卖不平衡。                 | 阈值     |
| `VALUE_RUNS`       | 名义成交价值的连续买入/卖出游程。          | 信息驱动 |
| `RENKO`            | 固定价格变动，砖块大小以 tick 为单位衡量。 | 价格     |
| `MILLISECOND`      | 毫秒粒度的时间区间。                       | 时间     |
| `SECOND`           | 秒粒度的时间区间。                         | 时间     |
| `MINUTE`           | 分钟粒度的时间区间。                       | 时间     |
| `HOUR`             | 小时粒度的时间区间。                       | 时间     |
| `DAY`              | 日粒度的时间区间。                         | 时间     |
| `WEEK`             | 周粒度的时间区间。                         | 时间     |
| `MONTH`            | 月粒度的时间区间。                         | 时间     |
| `YEAR`             | 年粒度的时间区间。                         | 时间     |

阈值、信息驱动和时间类别遵循 `BarSpecification` 谓词。`RENKO` 由价格驱动，
没有对应的谓词。下文更广义的信息驱动概念同时包括不平衡 K 线和游程 K 线。

### 信息驱动 K 线

信息驱动 K 线不采用固定区间，而是根据市场活动调整采样频率。它们基于*主动方方向*
（即成交发起者是买方还是卖方）的概念，分为**不平衡**和**游程**两类。

**不平衡 K 线**在买卖活动的*净值*达到阈值时收盘。每笔成交贡献一个带符号的值：
买方主动成交为正，卖方主动成交为负。当绝对不平衡值达到配置的步长时，K 线收盘。
这意味着方向相反的成交会相互抵消，因此平衡市场中的不平衡 K 线形成较慢，
而在单向行情中形成较快。

**游程 K 线**在同一主动方方向的*连续*活动达到阈值时收盘。与不平衡 K 线不同，
主动方方向变化时，游程 K 线会重置计数器。因此它们对持续的单边压力敏感，
而不是对净不平衡敏感。

两类 K 线根据衡量对象各有三种变体：

| 变体   | 不平衡             | 游程          | 衡量对象       |
| :----- | :----------------- | :------------ | :------------- |
| Tick   | `TICK_IMBALANCE`   | `TICK_RUNS`   | 成交笔数。     |
| 成交量 | `VOLUME_IMBALANCE` | `VOLUME_RUNS` | 成交数量。     |
| 价值   | `VALUE_IMBALANCE`  | `VALUE_RUNS`  | 价格乘以数量。 |

:::note
信息驱动 K 线需要 `TradeTick` 数据，因为它们需要通过 `aggressor_side` 字段对每笔成交分类。
仅凭 `QuoteTick` 数据无法聚合此类 K 线。
:::

### 聚合类型

VibeTrader 支持三种聚合输入：

| 输入         | 结果                       | 价格类型              | 语法要求          |
| ------------ | -------------------------- | --------------------- | ----------------- |
| `TradeTick`  | 从成交到 K 线的聚合。      | `LAST`                | 不使用 `@` 源。   |
| `QuoteTick`  | 从报价到 K 线的聚合。      | `BID`、`ASK` 或 `MID` | 不使用 `@` 源。   |
| 更小的 `Bar` | 从 K 线聚合为更大的 K 线。 | 目标 K 线的价格类型。 | 源位于 `@` 之后。 |

### K 线类型

`BarType` 通过以下要素标识一类 K 线：

- **金融工具 ID**（`InstrumentId`）：该 K 线对应的金融工具。
- **K 线规格**（`BarSpecification`）：
  - `step`：区间或频率。
  - `aggregation`：聚合方法。
  - `price_type`：价格基准，例如买价、卖价、中间价或最新价。
- **聚合源**（`AggregationSource`）：K 线是由 VibeTrader 聚合，还是由外部交易场所或数据提供商聚合。

:::note
Rust/PyO3 `BarSpecification` 会校验固定子单位时间聚合，使 K 线与其上级时钟或日历单位整齐对齐。
`MILLISECOND` 步长必须能整除 1000 且小于 1000；`SECOND` 和 `MINUTE` 步长必须能整除 60
且小于 60；`HOUR` 步长必须能整除 24 且小于 24；`MONTH` 步长必须能整除 12，且可以等于 12。
除 `12-MONTH` 外，当步长等于一个上级单位时，请使用下一个更大的聚合方式，例如用 `1-HOUR`
而不是 `60-MINUTE`。在此模型中，`DAY`、`WEEK`、`YEAR`、阈值、信息驱动和 `RENKO` K 线
不受此固定子单位规则限制。旧版 Cython 构造函数会拒绝 `12-MONTH`。
:::

K 线类型还可分为*标准*和*复合*两类：

- **标准**：由报价 tick 或成交 tick 等细粒度市场数据生成。
- **复合**：由粒度更细的 K 线类型派生，例如由 1 分钟 K 线聚合成 5 分钟 K 线。

### 聚合源

K 线数据聚合可以是*内部*或*外部*：

- `INTERNAL`：由 VibeTrader 聚合 K 线。
- `EXTERNAL`：由交易场所或数据提供商聚合 K 线。

对于 K 线到 K 线的聚合，目标始终为 `INTERNAL`。源可以是 `INTERNAL` 或 `EXTERNAL`。

### 使用字符串语法定义 K 线类型

#### 标准 K 线

使用以下格式定义标准 K 线类型：

`{instrument_id}-{step}-{aggregation}-{price_type}-{INTERNAL | EXTERNAL}`

以下示例定义由 VibeTrader 在本地聚合的 AAPL 5 分钟成交 K 线：

```python
bar_type = BarType.from_str("AAPL.XNAS-5-MINUTE-LAST-INTERNAL")
```

#### 复合 K 线

使用以下格式定义复合 K 线类型：

`{instrument_id}-{step}-{aggregation}-{price_type}-INTERNAL@{step}-{aggregation}-{INTERNAL | EXTERNAL}`

- 派生 K 线类型必须使用 `INTERNAL` 聚合源（因为 K 线以这种方式聚合）。
- 被采样的 K 线类型必须比派生 K 线类型粒度更细。
- 被采样的金融工具 ID 推断为与派生 K 线类型相同。
- 复合 K 线可以从 `INTERNAL` 或 `EXTERNAL` 聚合源进行聚合。

以下示例定义从外部 1 分钟 K 线聚合而成的内部 5 分钟 AAPL 成交 K 线：

```python
bar_type = BarType.from_str("AAPL.XNAS-5-MINUTE-LAST-INTERNAL@1-MINUTE-EXTERNAL")
```

### 聚合语法示例

`BarType` 字符串格式同时编码目标 K 线类型以及可选的源数据类型：

```text
{instrument_id}-{step}-{aggregation}-{price_type}-{source}@{step}-{aggregation}-{source}
```

`@` 之后的部分仅用于 K 线到 K 线的聚合：

- **没有 `@`**：从 `TradeTick` 对象聚合时使用 `LAST`；从 `QuoteTick` 对象聚合时
  使用 `BID`、`ASK` 或 `MID`。
- **带有 `@`**：从指定源类型的现有 `Bar` 对象聚合。

#### 从成交到 K 线的示例

```python
def on_start(self) -> None:
    # LAST selects TradeTick data as the source
    bar_type = BarType.from_str("6EH4.XCME-50-VOLUME-LAST-INTERNAL")
    start = self.clock.utc_now() - timedelta(days=30)

    # Deliver historical bars to on_historical_bars
    self.request_bars(bar_type, start=start)

    # Deliver live bars to on_bar
    self.subscribe_bars(bar_type)
```

#### 从报价到 K 线的示例

```python
def on_start(self) -> None:
    # Create 1-minute bars from QuoteTick ask prices
    bar_type_ask = BarType.from_str("6EH4.XCME-1-MINUTE-ASK-INTERNAL")

    # Create 1-minute bars from QuoteTick bid prices
    bar_type_bid = BarType.from_str("6EH4.XCME-1-MINUTE-BID-INTERNAL")

    # Create 1-minute bars from QuoteTick mid prices
    bar_type_mid = BarType.from_str("6EH4.XCME-1-MINUTE-MID-INTERNAL")
    start = self.clock.utc_now() - timedelta(days=30)

    self.request_bars(bar_type_ask, start=start)
    self.subscribe_bars(bar_type_ask)
```

#### 从 K 线到 K 线的示例

```python
def on_start(self) -> None:
    # Create 5-minute bars from 1-minute Bar objects
    # Format: target_bar_type@source_bar_type
    # The price type appears only on the target side
    bar_type = BarType.from_str("6EH4.XCME-5-MINUTE-LAST-INTERNAL@1-MINUTE-EXTERNAL")
    start = self.clock.utc_now() - timedelta(days=30)

    self.request_bars(bar_type, start=start)

    # Deliver live updates to on_bar
    self.subscribe_bars(bar_type)
```

#### 高级 K 线到 K 线示例

从 VibeTrader 已聚合的 K 线构建更长的聚合链：

```python
# Create 1-minute bars from TradeTick objects
primary_bar_type = BarType.from_str("6EH4.XCME-1-MINUTE-LAST-INTERNAL")

# Create 5-minute bars from the 1-minute bars
intermediate_bar_type = BarType.from_str("6EH4.XCME-5-MINUTE-LAST-INTERNAL@1-MINUTE-INTERNAL")

# Create hourly bars from the 5-minute bars
hourly_bar_type = BarType.from_str("6EH4.XCME-1-HOUR-LAST-INTERNAL@5-MINUTE-INTERNAL")
```

### 使用 K 线：请求与订阅

VibeTrader 提供两种处理 K 线的操作：

| 方法               | 用途            | 交付处理器             |
| ------------------ | --------------- | ---------------------- |
| `request_bars()`   | 获取历史 K 线。 | `on_historical_bars()` |
| `subscribe_bars()` | 订阅实时 K 线。 | `on_bar()`             |

`subscribe_bars()` 要求缓存中存在 `BarType` 对应的金融工具。其他实时市场数据订阅也有同样的前置条件。

在典型工作流中，这两种方法配合使用：

1. `request_bars()` 加载历史数据，以初始化指标或策略状态。
1. `subscribe_bars()` 通过实时 K 线延续数据流。

请求会返回一个关联 ID。历史数据通过 `on_historical_bars()` 以 `Sequence[Bar]` 形式到达；
实时数据则逐条通过 `on_bar()` 到达。

```python
from collections.abc import Sequence


def on_start(self) -> None:
    bar_type = BarType.from_str("6EH4.XCME-5-MINUTE-LAST-INTERNAL")
    start = self.clock.utc_now() - timedelta(days=30)

    # Register indicators before requesting history
    self.register_indicator_for_bars(bar_type, self.my_indicator)

    self.request_bars(bar_type, start=start)
    self.subscribe_bars(bar_type)


def on_historical_bars(self, bars: Sequence[Bar]) -> None:
    for bar in bars:
        self.log.info(f"Historical bar: {bar}")


def on_bar(self, bar):
    # Process individual bars from subscribe_bars()
    pass
```

### 请求数据前注册指标

请在请求历史数据之前注册指标，以便它们接收这些更新。

```python
start = self.clock.utc_now() - timedelta(days=30)

# Correct order
self.register_indicator_for_bars(bar_type, self.ema)
self.request_bars(bar_type, start=start)

# Incorrect order: the indicator misses historical updates
self.request_bars(bar_type, start=start)
self.register_indicator_for_bars(bar_type, self.ema)
```

### 性能注意事项

K 线聚合器使用定点数 `Price` 类型跟踪 OHLC 价格。聚合方法决定每次更新所需的额外工作：

- **时间 K 线**在每次更新时累积 OHLCV 状态，并使用计时器发出 K 线。
- **阈值 K 线**（tick、成交量、价值）在每次更新时增加计数器或执行累加器检查。
  当单笔大额成交超过剩余阈值时，成交量和价值 K 线可能将其拆分到多根 K 线中。
- **信息驱动 K 线**（不平衡、游程）跟踪主动方方向和带符号的累积值。
- **砖形 K 线**由价格驱动，一次较大的价格变动可能发出多根 K 线。
- **复合 K 线**处理聚合后的源 K 线，而不是每条底层 tick。

### 时间 K 线配置

时间 K 线行为由 `DataEngineConfig` 控制。以下选项适用于从毫秒到年的所有时间聚合：

| 选项                                | 类型   | 默认值        | 说明                                                                                                                |
| :---------------------------------- | :----- | :------------ | :------------------------------------------------------------------------------------------------------------------ |
| `time_bars_interval_type`           | `str`  | `"left-open"` | `"left-open"`：不含起点、包含终点。`"right-open"`：包含起点、不含终点。                                             |
| `time_bars_timestamp_on_close`      | `bool` | `True`        | 为 `True` 时，`ts_event` 是 K 线收盘时间；为 `False` 时，`ts_event` 是 K 线开盘时间。                               |
| `time_bars_skip_first_non_full_bar` | `bool` | `False`       | 聚合从区间中途开始时跳过发出该 K 线，以避免启动时产生不完整 K 线。                                                  |
| `time_bars_build_with_no_updates`   | `bool` | `True`        | 为 `True` 时，即使区间内没有市场更新也会发出 K 线。                                                                 |
| `time_bars_origin_offset`           | `dict` | `None`        | 将 `BarAggregation` 类型映射到 `pd.Timedelta` 或 `pd.DateOffset` 值，以偏移 K 线对齐方式（例如与 09:30 开盘对齐）。 |
| `time_bars_build_delay`             | `int`  | `0`           | 构建 K 线前的延迟，单位为微秒。用于回测时，可确保先处理 K 线边界时间戳处的数据，再触发计时器。                      |

```python
from vibe_trader.config import DataEngineConfig

config = DataEngineConfig(
    time_bars_timestamp_on_close=True,
    time_bars_build_with_no_updates=False,
    time_bars_skip_first_non_full_bar=True,
)
```

## 时间戳

许多市场数据、订单和事件对象都带有两个时间戳：

- `ts_event`：事件发生时的 UNIX 纳秒时间戳。
- `ts_init`：VibeTrader 初始化对象时的 UNIX 纳秒时间戳。

### 典型含义

| 事件类型         | `ts_event`                  | `ts_init`                      |
| ---------------- | --------------------------- | ------------------------------ |
| `TradeTick`      | 交易场所的成交时间。        | 本地对象初始化时间。           |
| `QuoteTick`      | 交易场所的报价时间。        | 本地对象初始化时间。           |
| `OrderBookDelta` | 交易场所的订单簿更新时间。  | 本地对象初始化时间。           |
| `Bar`            | 配置的 K 线开盘或收盘边界。 | 本地聚合或对象初始化时间。     |
| `DefiData`       | 区块或流动性池事件时间。    | 根据链上数据初始化对象的时间。 |
| `OrderFilled`    | 交易场所的成交时间。        | 本地成交事件初始化时间。       |
| `OrderCanceled`  | 交易场所的取消时间。        | 本地取消事件初始化时间。       |
| `NewsEvent`      | 发布时间。                  | 本地对象初始化时间。           |
| 自定义事件       | 由自定义事件定义的时间。    | 本地对象初始化时间。           |

:::note
`ts_init` 表示初始化时间，并不总是接收时间。命令和内部生成的事件也会使用它，
即使 VibeTrader 并未从外部来源接收这些对象。
:::

### 延迟分析

只有在生成两个时间戳的时钟已同步时，差值 `ts_init - ts_event` 才能衡量观测到的延迟。
否则，结果还包含时钟偏移，无法单独代表系统延迟。

### 特定环境的行为

#### 回测环境

- 数据使用稳定排序按 `ts_init` 排列。
- DeFi 数据（`DefiData`）在 `ts_init` 相同时按链上位置（区块号、交易索引、日志索引）
  打破平局，使同一区块内的事件按规范链顺序重放。
- 这种排序让回测能够确定性重放。

#### 实盘交易环境

实盘交易按数据到达顺序处理。对于来自交易场所的数据，`ts_event` 记录外部事件时间，
而 `ts_init` 通常记录接收后在本地初始化对象的时间。

### 其他说明与注意事项

- 对于来自外部来源的数据，`ts_init` 通常是本地接收或规范化时间，
  但时钟偏差意味着它不保证大于或等于 `ts_event`。
- 对于 VibeTrader 内部创建的数据，`ts_init` 和 `ts_event` 可以相同。
- 某些带有 `ts_init` 的类型没有 `ts_event`，原因如下：
  - 对象初始化与事件本身同时发生。
  - 外部事件时间这一概念并不适用。

#### 持久化数据

`ts_init` 字段保留原始初始化时间戳。对于交易场所数据，这通常是接收时间；
对于内部创建的数据，则是该对象的创建时间。

## 数据流

从 `DataEngine` 开始，无论[环境上下文](../architecture.md#environment-contexts)如何
（回测、沙盒、实盘），数据都遵循相同路径。在实盘和沙盒模式下，交易场所适配器会创建
规范化数据对象并通过通道发送；在回测中，引擎会直接馈送数据。无论哪种方式，
`DataEngine` 都会将数据存入 `Cache`（对于可缓存类型），并通过 `MessageBus`
发布给已订阅的处理器。包含时序图的逐步跟踪请参阅
[数据流：报价 tick 的生命周期](../architecture.md#data-flow-life-of-a-quote-tick)。

若要定义并发布另一种数据类型，请参阅[自定义数据](#自定义数据)。

## 加载数据

加载并转换数据可用于：

- 使用 `BacktestEngine` 运行回测。
- 通过 `ParquetDataCatalog.write_data(...)` 为 `BacktestNode` 持久化 VibeTrader Parquet 数据。
- 在研究和回测中使用相同数据。

每种用例都会将外部格式转换为 VibeTrader 数据对象。

转换过程使用：

- 面向源格式的数据加载器，它返回符合预期模式的 `pd.DataFrame`。
- 面向目标类型的数据整理器，它将数据帧转换为 `list[Data]`。

### 数据加载器

数据加载器针对特定的源格式。例如，Binance 订单簿 CSV 数据不同于
[Databento 二进制编码（DBN）](https://databento.com/docs/knowledge-base/new-users/dbn-encoding/getting-started-with-dbn)。

### 数据整理器

`vibe_trader.persistence` 模块为每种 VibeTrader 数据类型提供由 Rust 支持的数据整理器：

- `OrderBookDeltaDataWrangler`
- `OrderBookDepth10DataWrangler`
- `QuoteTickDataWrangler`
- `TradeTickDataWrangler`
- `BarDataWrangler`

这些数据整理器接收定宽 Arrow 记录批次字节，并返回 Python 模型对象。

### 定点精度与原始值

VibeTrader 对 `Price` 和 `Quantity` 使用定点运算。原始值必须与其声明精度的比例相匹配。

#### 原始值要求

构造 `Price` 或 `Quantity` 并使用 `from_raw()` 时，请采用以下来源的原始值：

- 现有值的 `.raw` 字段，例如 `price.raw`。
- VibeTrader 定点数转换函数。
- Vibe 生成的 Arrow 数据中的值。

:::warning
当精度低于 `FIXED_PRECISION` 时，原始值必须能被
`10^(FIXED_PRECISION - precision)` 整除。目前构造过程不会拒绝无效的倍数，
这可能产生错误值。
:::

#### 自动修正原始值

由早期数据整理器写入的旧版数据目录可能包含带浮点误差的原始值。
这些整理器使用 `int(value * FIXED_SCALAR)`，而不是能够感知精度的转换：

```python
int(value * FIXED_SCALAR)  # Introduces floating-point errors
round(value * 10**precision) * scale  # Correct precision-aware conversion
```

Arrow 解码路径会自动将这些值舍入到最近的有效倍数，因此受影响的数据目录无需迁移即可使用。

:::note
此修正会在数据解码期间增加少量开销。
:::

### 转换管道

1. 数据加载函数读取 CSV 等原始数据并生成 `pd.DataFrame`。
1. 数据整理器将数据帧转换为 VibeTrader 对象。
1. 管道返回 `list[Data]`。

```mermaid
flowchart LR
    raw["原始数据（CSV）"]
    loader[load_* 函数]
    wrangler[DataWrangler]
    output["Vibe list[Data] 列表"]

    raw --> loader
    loader -->|"pd.DataFrame"| wrangler
    wrangler --> output
```

加载器先规范化源格式，之后数据整理器再构造领域对象。

对于 Binance 订单簿增量数据：

- `load_binance_order_book_deltas(...)` 读取 CSV 文件并返回 `pd.DataFrame`。
- `OrderBookDeltaDataWrangler.process(...)` 将数据帧转换为 `list[OrderBookDelta]`。

以下 Python 示例应用这两个步骤：

```python
from pathlib import Path

from vibe_trader.adapters.binance import load_binance_order_book_deltas
from vibe_trader.persistence.wranglers import OrderBookDeltaDataWrangler
from vibe_trader.test_kit.providers import TestInstrumentProvider


# Load raw data
data_path = Path("test_data/binance/btcusdt-depth-snap.csv")
df = load_binance_order_book_deltas(data_path)

# Set up a wrangler
instrument = TestInstrumentProvider.btcusdt_binance()
wrangler = OrderBookDeltaDataWrangler(instrument)

# Convert the frame into OrderBookDelta objects
deltas = wrangler.process(df)
```

## 数据目录

数据目录将 VibeTrader 数据存储为 [Parquet](https://parquet.apache.org) 文件，
供回测、实盘交易和研究使用。

### 概述与架构

数据目录使用两个查询后端：

**核心组件：**

- **`ParquetDataCatalog`**：数据操作的主要 Python 接口。
- **Rust 后端**：核心数据类型（`OrderBookDelta`、`OrderBookDeltas`、
  `OrderBookDepth10`、`QuoteTick`、`TradeTick`、`Bar`、`MarkPriceUpdate`、
  `OptionGreeks`）以及已注册的同二进制 Rust 自定义数据的查询引擎。
- **PyArrow 后端**：Python 自定义数据类型和 PyArrow 过滤器的回退方案。
- **fsspec 集成**：无需外部数据库服务即可访问本地和云存储。

Parquet 提供压缩列式存储和跨语言访问。Rust `model` 与 `persistence` crate
定义核心市场数据的 Arrow 模式，而 `serialization/arrow/schema.py`
定义其他 Python 类型的模式。

### 初始化

可通过类路径对象、URI 或 `VIBE_PATH` 环境变量初始化数据目录。

:::note[VIBE_PATH 环境变量]
将 `VIBE_PATH` 设置为数据目录所在目录的父目录。例如，
`VIBE_PATH=/home/user/trading_data` 会使 `ParquetDataCatalog.from_env()` 使用
`/home/user/trading_data/catalog`。
:::

为已存储在本地路径的数据初始化数据目录：

```python
from pathlib import Path
from vibe_trader.persistence import ParquetDataCatalog


CATALOG_PATH = Path.cwd() / "catalog"

# Initialize from an explicit path
catalog = ParquetDataCatalog(CATALOG_PATH)

# Initialize from VIBE_PATH
catalog = ParquetDataCatalog.from_env()
```

### 文件系统协议与存储选项

数据目录使用 fsspec 协议访问本地和云存储。

#### 支持的文件系统协议

**本地文件系统（`file`）：**

```python
catalog = ParquetDataCatalog(
    path="/path/to/catalog",
    fs_protocol="file",  # Default protocol
)
```

**Amazon S3（`s3`）：**

```python
catalog = ParquetDataCatalog(
    path="s3://my-bucket/vibe-data/",
    fs_protocol="s3",
    fs_storage_options={
        "key": "your-access-key-id",
        "secret": "your-secret-access-key",
        "endpoint_url": "https://s3.amazonaws.com",  # Optional custom endpoint
    },
)
```

**Google Cloud Storage（`gcs`）：**

```python
catalog = ParquetDataCatalog(
    path="gcs://my-bucket/vibe-data/",
    fs_protocol="gcs",
    fs_storage_options={
        "project": "my-project-id",
        "token": "/path/to/service-account.json",  # Or "cloud" for default credentials
    },
)
```

**Azure Blob Storage：**

`abfs` 协议

```python
catalog = ParquetDataCatalog(
    path="abfs://container@account.dfs.core.windows.net/vibe-data/",
    fs_protocol="abfs",
    fs_storage_options={
        "account_name": "your-storage-account",
        "account_key": "your-account-key",
        # Or use SAS token: "sas_token": "your-sas-token"
    },
)
```

`az` 协议

```python
catalog = ParquetDataCatalog(
    path="az://container/vibe-data/",
    fs_protocol="az",
    fs_storage_options={
        "account_name": "your-storage-account",
        "account_key": "your-account-key",
        # Or use SAS token: "sas_token": "your-sas-token"
    },
)
```

#### 基于 URI 的初始化

使用 `from_uri()` 根据 URI 选择协议：

```python
# Local filesystem
catalog = ParquetDataCatalog.from_uri("/path/to/catalog")

# S3 bucket
catalog = ParquetDataCatalog.from_uri("s3://my-bucket/vibe-data/")

# With storage options
catalog = ParquetDataCatalog.from_uri(
    "s3://my-bucket/vibe-data/",
    fs_storage_options={"access_key_id": "your-key", "secret_access_key": "your-secret"},
)
```

### 写入数据

使用 `write_data()` 存储内置 `Data` 对象和已注册的自定义 `Data` 子类。

```python
# Write a list of data objects
catalog.write_data(quote_ticks)

# Write with custom timestamp range
catalog.write_data(
    trade_ticks,
    start=1704067200000000000,  # Optional start timestamp override (UNIX nanoseconds)
    end=1704153600000000000,  # Optional end timestamp override (UNIX nanoseconds)
)

# Skip disjoint check for overlapping data
catalog.write_data(bars, skip_disjoint_check=True)
```

### 文件命名与数据组织

数据目录根据时间戳范围按 `{start_timestamp}_{end_timestamp}.parquet` 模式命名文件。
它将每个 ISO 8601 时间戳中的 `:` 和 `.` 替换为 `-`，使其可安全用于文件名。

数据按数据类型和标识符（金融工具 ID、K 线类型或自定义标识符）组织到各目录。
数据目录通过移除 `/` 使标识符可安全用于 URI：

```text
catalog/
├── data/
│   ├── quote_ticks/
│   │   └── EURUSD.SIM/
│   │       └── 2024-01-01T00-00-00-000000000Z_2024-01-01T23-59-59-999999999Z.parquet
│   └── trade_ticks/
│       └── BTCUSD.BINANCE/
│           └── 2024-01-01T00-00-00-000000000Z_2024-01-01T23-59-59-999999999Z.parquet
```

:::warning
默认情况下，重叠写入会引发 `ValueError`，以维护数据完整性。
只有在确实需要重叠时，才能设置 `skip_disjoint_check=True`。
:::

### 读取数据

使用 `query()` 从数据目录读取数据：

```python
from vibe_trader.model import QuoteTick
from vibe_trader.model import TradeTick

# Query quote ticks for a specific instrument and time range
quotes = catalog.query(
    data_cls=QuoteTick,
    identifiers=["EUR/USD.SIM"],
    start="2024-01-01T00:00:00Z",
    end="2024-01-02T00:00:00Z",
)

# Query trade ticks for a specific instrument and time range
trades = catalog.query(
    data_cls=TradeTick,
    identifiers=["BTC/USD.BINANCE"],
    start="2024-01-01",
    end="2024-01-02",
)
```

### `BacktestDataConfig`：回测数据

`BacktestDataConfig` 定义 `BacktestNode` 为一次运行加载的数据目录数据。

#### 核心参数

**必填参数：**

- `catalog_path`：数据目录的路径。
- `data_cls`：数据类型类，例如 `QuoteTick`、`TradeTick`、`OrderBookDelta` 或 `Bar`。

**可选参数：**

- `catalog_fs_protocol`：文件系统协议，例如 `file`、`s3` 或 `gcs`。
- `catalog_fs_storage_options`：存储专用选项，例如凭据或区域。
- `catalog_fs_rust_storage_options`：Rust 后端的存储专用选项。
- `instrument_id`：要为其加载数据的特定金融工具。
- `instrument_ids`：金融工具列表，用于替代单个 `instrument_id`。
- `start_time`：数据筛选的开始时间（ISO 字符串或 UNIX 纳秒数）。
- `end_time`：数据筛选的结束时间（ISO 字符串或 UNIX 纳秒数）。
- `filter_expr`：额外的 PyArrow 过滤表达式。
- `client_id`：自定义数据类型的客户端 ID。
- `metadata`：数据查询的额外元数据。
- `bar_spec`：K 线数据的 K 线规格，例如 `"1-MINUTE-LAST"`。与 `instrument_id`
  或 `instrument_ids` 结合时，会构建 `...-EXTERNAL` K 线标识符。
- `bar_types`：完整 K 线类型的显式列表。用于 `INTERNAL` K 线或复合 K 线。
- `optimize_file_loading`：在支持的情况下加载目录，而不是逐个加载文件。

#### 基本用法示例

**加载报价 tick：**

```python
from vibe_trader.config import BacktestDataConfig
from vibe_trader.model import InstrumentId
from vibe_trader.model import QuoteTick

data_config = BacktestDataConfig(
    catalog_path="/path/to/catalog",
    data_cls=QuoteTick,
    instrument_id=InstrumentId.from_str("EUR/USD.SIM"),
    start_time="2024-01-01T00:00:00Z",
    end_time="2024-01-02T00:00:00Z",
)
```

**加载多个金融工具：**

```python
data_config = BacktestDataConfig(
    catalog_path="/path/to/catalog",
    data_cls=TradeTick,
    instrument_ids=["BTC/USD.BINANCE", "ETH/USD.BINANCE"],
    start_time="2024-01-01T00:00:00Z",
    end_time="2024-01-02T00:00:00Z",
)
```

**加载 K 线数据：**

```python
data_config = BacktestDataConfig(
    catalog_path="/path/to/catalog",
    data_cls=Bar,
    instrument_id=InstrumentId.from_str("AAPL.NASDAQ"),
    bar_spec="5-MINUTE-LAST",  # Loads AAPL.NASDAQ-5-MINUTE-LAST-EXTERNAL
    start_time="2024-01-01",
    end_time="2024-01-31",
)
```

#### 高级配置示例

**使用自定义过滤的云存储：**

```python
data_config = BacktestDataConfig(
    catalog_path="s3://my-bucket/vibe-data/",
    catalog_fs_protocol="s3",
    catalog_fs_storage_options={
        "key": "your-access-key",
        "secret": "your-secret-key",
        "region": "us-east-1",
    },
    data_cls=OrderBookDelta,
    instrument_id=InstrumentId.from_str("BTC/USD.COINBASE"),
    start_time="2024-01-01T09:30:00Z",
    end_time="2024-01-01T16:00:00Z",
)
```

**带客户端 ID 的自定义数据：**

```python
data_config = BacktestDataConfig(
    catalog_path="/path/to/catalog",
    data_cls="my_package.data.NewsEventData",
    client_id="NewsClient",
    metadata={"source": "reuters", "category": "earnings"},
    start_time="2024-01-01",
    end_time="2024-01-31",
)
```

#### 与 BacktestRunConfig 集成

将数据配置传给 `BacktestRunConfig`：

```python
from vibe_trader.config import BacktestRunConfig
from vibe_trader.config import BacktestVenueConfig

data_configs = [
    BacktestDataConfig(
        catalog_path="/path/to/catalog",
        data_cls=QuoteTick,
        instrument_id="EUR/USD.SIM",
        start_time="2024-01-01",
        end_time="2024-01-02",
    ),
    BacktestDataConfig(
        catalog_path="/path/to/catalog",
        data_cls=TradeTick,
        instrument_id="EUR/USD.SIM",
        start_time="2024-01-01",
        end_time="2024-01-02",
    ),
]

run_config = BacktestRunConfig(
    venues=[BacktestVenueConfig(name="SIM", oms_type="HEDGING")],
    data=data_configs,
    start="2024-01-01T00:00:00Z",
    end="2024-01-02T00:00:00Z",
)
```

#### 数据加载过程

运行回测时，`BacktestNode` 会处理每个 `BacktestDataConfig`：

1. 根据配置创建 `ParquetDataCatalog`。
1. 根据配置字段构建查询。
1. 查询选定的后端。
1. 加载所需的金融工具定义。
1. 对数据排序并将其添加到回测引擎。

### 直接访问数据目录

使用 `ParquetDataCatalog` 直接查询或写入数据目录。当一次运行需要由 `BacktestDataConfig`
指示 `BacktestNode` 加载数据目录数据时，请使用该配置。`LiveNodeConfig` 不接受数据目录配置；
请通过已配置的数据客户端请求历史数据，或直接查询数据目录。

### 查询系统与双后端架构

数据目录根据数据类型和查询参数选择查询后端。

#### 后端选择逻辑

| 后端    | 数据类型                                                     | 选择条件                       |
| ------- | ------------------------------------------------------------ | ------------------------------ |
| Rust    | 核心类型以及已注册的同二进制 Rust 自定义数据。               | 未设置 `files`。               |
| PyArrow | 其他自定义数据，以及 Python 序列化与模式系统支持的任何类型。 | 类型需要它，或已设置 `files`。 |

Rust 核心查询类型包括 `OrderBookDelta`、`OrderBookDeltas`、`OrderBookDepth10`、`QuoteTick`、
`TradeTick`、`Bar`、`MarkPriceUpdate` 和 `OptionGreeks`。

#### 查询方法与参数

```python
catalog.query(
    data_cls=QuoteTick,
    identifiers=["EUR/USD.SIM"],
    start="2024-01-01T00:00:00Z",
    end="2024-01-02T00:00:00Z",
    files=None,
)
```

- `where=` 将 DataFusion SQL 谓词传给 Rust 支持的查询。
- `filter_expr=` 将已解析的 PyArrow 数据集表达式传给 PyArrow 支持的查询。

:::warning
在当前 `Cargo.lock` 下，DataFusion SQL 时间函数使用传递依赖 `chrono-tz` 0.10.4
的数据库（IANA 2025b）解析命名时区。Rust 核心时区操作使用 Jiff 0.2.35 及其内置的
IANA 2026c 数据库。在 DataFusion 完成迁移前，如果 2025b 之后时区规则发生变化或
历史数据得到修正，时区结果可能不同。

如果 RustSec 针对 `chrono` 或 `chrono-tz` 提交未维护公告，请在 `.cargo/audit.toml`
和 `deny.toml` 中维护匹配且有文档说明的忽略项，直到 DataFusion 完成迁移。
:::

**支持的时间格式：**

- ISO 8601 字符串：`"2024-01-01T00:00:00Z"`。
- UNIX 纳秒数：`1704067200000000000`。
- pandas 时间戳：`pd.Timestamp("2024-01-01", tz="UTC")`。
- 带时区信息的 Python `datetime` 对象。

**过滤说明：**

- 对 Rust 支持的内置市场数据查询使用 `where=`。
- 对 PyArrow 支持的查询使用 `filter_expr=`，包括自定义数据，以及通过 `files=`
  强制走 PyArrow 路径的查询。

### 数据目录操作

数据目录操作可重命名、合并或删除数据文件。

#### 重置文件名

重置 Parquet 文件名，使其与内容时间戳匹配，以确保基于文件名的过滤仍然准确。

**重置数据目录中的所有文件：**

```python
# Reset all parquet files in the catalog
catalog.reset_all_file_names()
```

**重置特定数据类型：**

```python
# Reset filenames for all quote tick files
catalog.reset_data_file_names(QuoteTick)

# Reset filenames for specific instrument's trade files
catalog.reset_data_file_names(TradeTick, "BTC/USD.BINANCE")
```

#### 合并数据目录

合并小型 Parquet 文件，以减少文件数量和查询开销。

**合并整个数据目录：**

```python
# Consolidate all files in the catalog
catalog.consolidate_catalog()

# Consolidate files within a specific time range
catalog.consolidate_catalog(
    start="2024-01-01T00:00:00Z", end="2024-01-02T00:00:00Z", ensure_contiguous_files=True
)
```

**合并特定数据类型：**

```python
# Consolidate all quote tick files
catalog.consolidate_data(QuoteTick)

# Consolidate specific instrument's files
catalog.consolidate_data(
    TradeTick, identifier="BTC/USD.BINANCE", start="2024-01-01", end="2024-01-31"
)
```

#### 按周期合并数据目录

将数据文件拆分为固定周期。

**按周期合并整个数据目录：**

```python
import pandas as pd

# Consolidate all files by 1-day periods
catalog.consolidate_catalog_by_period(period=pd.Timedelta(days=1))

# Consolidate by 1-hour periods within time range
catalog.consolidate_catalog_by_period(
    period=pd.Timedelta(hours=1), start="2024-01-01T00:00:00Z", end="2024-01-02T00:00:00Z"
)
```

**按周期合并特定数据：**

```python
# Consolidate quote data by 4-hour periods
catalog.consolidate_data_by_period(data_cls=QuoteTick, period=pd.Timedelta(hours=4))

# Consolidate specific instrument by 30-minute periods
catalog.consolidate_data_by_period(
    data_cls=TradeTick,
    identifier="EUR/USD.SIM",
    period=pd.Timedelta(minutes=30),
    start="2024-01-01",
    end="2024-01-31",
)
```

#### 删除数据范围

删除某个时间范围内的数据，并可选择仅限某一数据类型和金融工具。

**删除整个数据目录范围：**

```python
# Delete all data within a time range across the entire catalog
catalog.delete_catalog_range(start="2024-01-01T00:00:00Z", end="2024-01-02T00:00:00Z")

# Delete all data from the beginning up to a specific time
catalog.delete_catalog_range(end="2024-01-01T00:00:00Z")
```

**删除特定数据类型：**

```python
# Delete all quote tick data for a specific instrument
catalog.delete_data_range(data_cls=QuoteTick, identifier="BTC/USD.BINANCE")

# Delete trade data within a specific time range
catalog.delete_data_range(
    data_cls=TradeTick,
    identifier="EUR/USD.SIM",
    start="2024-01-01T00:00:00Z",
    end="2024-01-31T23:59:59Z",
)
```

:::warning
删除操作无法撤销。数据目录会拆分部分重叠的文件，以保留范围之外的数据。
:::

### Feather 流式写入与转换

Python API 提供 `StreamingFeatherWriter` 用于直接流式写入。它没有公开
`StreamingConfig` 供 `BacktestNode` 使用。当应用程序管理写入器生命周期时，
`ParquetDataCatalog.convert_stream_to_data()` 可将已完成的 Feather 流转换为 Parquet。

## 数据迁移

`vibe_model` crate 定义内部数据格式。VibeTrader 将这些模型序列化为 Arrow 记录批次，
并存储在 Parquet 文件中。

更改[精度模式](../../getting_started/installation.md#precision-mode)或模式时，请使用迁移工具。

### 迁移工具

`vibe_persistence` crate 提供两个工具：

#### `to_json`

`to_json` 将 Parquet 文件转换为 JSON，并保留其元数据：

- 创建两个文件：

  - `<input>.json`：反序列化后的数据。
  - `<input>.metadata.json`：模式元数据和行组配置。

- 根据文件名自动检测数据类型：

  - `OrderBookDelta`：文件名包含 `deltas` 或 `order_book_delta`。
  - `QuoteTick`：文件名包含 `quotes` 或 `quote_tick`。
  - `TradeTick`：文件名包含 `trades` 或 `trade_tick`。
  - `Bar`：文件名包含 `bars`。

#### `to_parquet`

`to_parquet` 将 JSON 转换回 Parquet：

- 同时读取数据 JSON 和元数据 JSON 文件。
- 保留原始元数据中的行组大小。
- 使用 ZSTD 压缩。
- 创建 `<input>.parquet`。

### 迁移流程

以下示例使用成交数据。请从 `crates/persistence` 运行每条命令。

#### 从标准精度（64 位）迁移到高精度（128 位）

将标准精度模式转换为高精度模式：

:::note
对于价格和数量曾使用 `Int64` 和 `UInt64` Arrow 数据类型的数据目录，
请构建初始 `to_json` 转换工具，其源代码使用提交 `e284162`。
:::

1. 将标准精度 Parquet 转换为 JSON：

   ```bash
   cargo run --features python --bin to_json -- trades.parquet
   ```

   这会创建 `trades.json` 和 `trades.metadata.json`。

1. 将 JSON 转换为高精度 Parquet：

   ```bash
   cargo run --features "python high-precision" --bin to_parquet -- trades.json
   ```

   这会创建采用高精度模式的 `trades.parquet`。

#### 迁移模式变更

将数据从一个模式版本转换到另一个模式版本：

1. 将旧模式 Parquet 文件转换为 JSON：

   对于高精度源，请将 `--features python` 替换为
   `--features "python high-precision"`。

   ```bash
   cargo run --features python --bin to_json -- trades.parquet
   ```

   这会创建 `trades.json` 和 `trades.metadata.json`。

1. 切换到新模式版本：

   ```bash
   git checkout <new-version>
   ```

1. 使用新模式将 JSON 转换为 Parquet：

   ```bash
   cargo run --features "python high-precision" --bin to_parquet -- trades.json
   ```

   这会创建采用新模式的 `trades.parquet`。

### 最佳实践

- 先使用小型数据集测试迁移。
- 备份原始文件。
- 迁移后验证数据完整性。
- 将迁移应用到生产数据之前，先在预发布环境执行。

## 自定义数据

通过继承 `Data` 定义自定义数据类型。自定义类型可流经回测和实盘系统、使用消息总线，
并持久化到缓存或数据目录。

:::info
`Data` 不保存状态，因此子类无需调用 `super().__init__()`。
:::

```python
from vibe_trader.core import Data


class MyDataPoint(Data):
    """Example custom data with arbitrary user fields."""

    def __init__(
        self,
        label: str,
        x: int,
        y: int,
        z: int,
        ts_event: int,
        ts_init: int,
    ) -> None:
        self.label = label
        self.x = x
        self.y = y
        self.z = z
        self._ts_event = ts_event
        self._ts_init = ts_init

    @property
    def ts_event(self) -> int:
        """
        UNIX timestamp (nanoseconds) when the data event occurred.

        Returns
        -------
        int

        """
        return self._ts_event

    @property
    def ts_init(self) -> int:
        """
        UNIX timestamp (nanoseconds) when the object was initialized.

        Returns
        -------
        int

        """
        return self._ts_init
```

`Data` 抽象基类要求提供 `ts_event` 和 `ts_init` 属性。如上所示，
请将两个时间戳存储在后备字段中，并通过属性公开。

:::info
回测按 `ts_init` 对数据流排序。
:::

适配器可以构造此类型并将其发送给 `DataEngine`，供订阅者使用。
actor 或策略也可以直接发布它：

```python
self.publish_data(
    DataType(MyDataPoint, metadata={"some_optional_category": 1}),
    MyDataPoint(...),
)
```

可选的 `metadata` 字典会向消息总线主题添加字段。

请将相同的元数据传给用于回测数据的 `BacktestDataConfig`：

```python
from vibe_trader.config import BacktestDataConfig

data_config = BacktestDataConfig(
    catalog_path=str(catalog.path),
    data_cls=MyDataPoint,
    metadata={"some_optional_category": 1},
)
```

从 actor 或策略订阅自定义类型：

```python
self.subscribe_data(
    data_type=DataType(MyDataPoint, metadata={"some_optional_category": 1}),
    client_id=ClientId("MY_ADAPTER"),
)
```

`client_id` 将订阅路由到特定客户端。

VibeTrader 将每个收到的对象传给 `on_data()`。由于该处理器会接收所有自定义数据，
请检查对象类型：

```python
def on_data(self, data: Data) -> None:
    if isinstance(data, MyDataPoint):
        ...
```

### 发布和接收信号数据

信号是一种生成的自定义数据类型，包含名称以及一个 `str`、`float`、`int`、`bool`
或 `bytes` 值。可从 actor 或策略发布并订阅信号：

```python
self.publish_signal("signal_name", value, ts_event)
self.subscribe_signal("signal_name")


def on_signal(self, signal):
    print("Signal", signal)
```

### 期权希腊字母指标示例

以下自定义类型携带期权 Delta 数据，并支持消息总线、缓存和数据目录存储：

```python
from __future__ import annotations

import msgspec
import pyarrow as pa

from vibe_trader.core import Data
from vibe_trader.core.datetime import unix_nanos_to_iso8601
from vibe_trader.model import DataType
from vibe_trader.model import InstrumentId
from vibe_trader.serialization.arrow.serializer import register_arrow
from vibe_trader.serialization.base import register_serializable_type


class GreeksData(Data):
    def __init__(
        self,
        instrument_id: InstrumentId = InstrumentId.from_str("ES.GLBX"),
        ts_event: int = 0,
        ts_init: int = 0,
        delta: float = 0.0,
    ) -> None:
        self.instrument_id = instrument_id
        self._ts_event = ts_event
        self._ts_init = ts_init
        self.delta = delta

    def __repr__(self) -> str:
        return (
            f"GreeksData(ts_init={unix_nanos_to_iso8601(self._ts_init)}, "
            f"instrument_id={self.instrument_id}, delta={self.delta:.2f})"
        )

    @property
    def ts_event(self) -> int:
        return self._ts_event

    @property
    def ts_init(self) -> int:
        return self._ts_init

    def to_dict(self) -> dict:
        return {
            "instrument_id": self.instrument_id.value,
            "ts_event": self._ts_event,
            "ts_init": self._ts_init,
            "delta": self.delta,
        }

    @classmethod
    def from_dict(cls, data: dict) -> GreeksData:
        return cls(
            InstrumentId.from_str(data["instrument_id"]),
            data["ts_event"],
            data["ts_init"],
            data["delta"],
        )

    def to_bytes(self) -> bytes:
        return msgspec.msgpack.encode(self.to_dict())

    @classmethod
    def from_bytes(cls, data: bytes) -> GreeksData:
        return cls.from_dict(msgspec.msgpack.decode(data))

    def to_catalog(self) -> pa.RecordBatch:
        return pa.RecordBatch.from_pylist([self.to_dict()], schema=GreeksData.schema())

    @classmethod
    def from_catalog(cls, table: pa.Table) -> list[GreeksData]:
        return [cls.from_dict(data) for data in table.to_pylist()]

    @classmethod
    def schema(cls) -> pa.Schema:
        return pa.schema(
            {
                "instrument_id": pa.string(),
                "ts_event": pa.int64(),
                "ts_init": pa.int64(),
                "delta": pa.float64(),
            }
        )
```

#### 发布和接收数据

注册该类型，然后从 actor 或策略发布并订阅：

```python
register_serializable_type(GreeksData, GreeksData.to_dict, GreeksData.from_dict)


def publish_greeks(self, greeks_data: GreeksData):
    self.publish_data(DataType(GreeksData), greeks_data)


def subscribe_to_greeks(self):
    self.subscribe_data(DataType(GreeksData))


def on_data(self, data):
    if isinstance(data, GreeksData):
        print("Data", data)
```

#### 缓存存储

通过 `Cache` 写入和读取序列化的自定义数据：

```python
def greeks_key(instrument_id: InstrumentId):
    return f"{instrument_id}_GREEKS"


def cache_greeks(self, greeks_data: GreeksData):
    self.cache.add(greeks_key(greeks_data.instrument_id), greeks_data.to_bytes())


def greeks_from_cache(self, instrument_id: InstrumentId):
    return GreeksData.from_bytes(self.cache.get(greeks_key(instrument_id)))
```

#### 数据目录存储

将自定义数据流式写入 Feather 或写入 Parquet 前，请注册 Arrow 模式：

```python
register_arrow(GreeksData, GreeksData.schema(), GreeksData.to_catalog, GreeksData.from_catalog)

from vibe_trader.persistence import ParquetDataCatalog

catalog = ParquetDataCatalog(".")

catalog.write_data([GreeksData()])
```

### 自动创建自定义数据类

`@customdataclass` 装饰器会生成上文所示的时间戳、序列化和 Arrow 方法。
只有在默认方法不适合该类型时，才应覆盖生成的方法：

```python
from vibe_trader.core import Data
from vibe_trader.model import InstrumentId
from vibe_trader.model.custom import customdataclass


@customdataclass
class GreeksTestData(Data):
    instrument_id: InstrumentId = InstrumentId.from_str("ES.GLBX")
    delta: float = 0.0


GreeksTestData(
    instrument_id=InstrumentId.from_str("CL.GLBX"),
    delta=1000.0,
    ts_event=1,
    ts_init=2,
)
```

#### 仅限 Python、使用 PyO3 数据目录的自定义数据

对于使用 Rust 支持的 `ParquetDataCatalog` 的自定义数据，请使用 `@customdataclass_pyo3()`
而不是 `@customdataclass`。它会添加 JSON 和 Arrow IPC 方法。定义类后注册一次：

```python
from vibe_trader.persistence import ParquetDataCatalog
from vibe_trader.model import CustomData
from vibe_trader.model import DataType
from vibe_trader.model import register_custom_data_class
from vibe_trader.model.custom import customdataclass_pyo3


@customdataclass_pyo3()
class MarketTickPython:
    symbol: str = ""
    price: float = 0.0
    volume: int = 0


# Register once at startup
register_custom_data_class(MarketTickPython)

catalog = ParquetDataCatalog("/path/to/catalog")
data_type = DataType("MarketTickPython", metadata={"exchange": "NASDAQ"})
wrapped = [
    CustomData(
        data_type,
        MarketTickPython(ts_event=1, ts_init=1, symbol="AAPL", price=150.5, volume=1000),
    ),
]
catalog.write_custom_data(wrapped)
result = catalog.query("MarketTickPython")
ticks = [item.data for item in result]
```

详情请参阅 `vibe_trader.model.custom.customdataclass_pyo3`。

#### 自定义数据类型存根

对于运行时生成的构造函数，请添加 `.pyi` 文件，使 IDE 能解析其签名和属性。
`greeks.py` 中的自定义类型可使用以下 `greeks.pyi` 存根：

```python
from vibe_trader.core import Data
from vibe_trader.model import InstrumentId


class GreeksData(Data):
    instrument_id: InstrumentId
    delta: float

    def __init__(
        self,
        ts_event: int = 0,
        ts_init: int = 0,
        instrument_id: InstrumentId = InstrumentId.from_str("ES.GLBX"),
        delta: float = 0.0,
    ) -> None: ...
```

## 相关指南

- [金融工具](../instruments/)：数据所引用的金融工具。
- [期权](../options.md)：期权金融工具、期权链订阅和行权价过滤。
- [希腊字母指标](../greeks.md)：交易场所提供和本地计算的期权希腊字母指标。
- [缓存](../cache.md)：数据存储与检索。
- [适配器](../adapters.md)：数据源与连接。
