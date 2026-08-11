# 基于 K 线的执行

K 线数据记录一个区间内的开盘价、最高价、最低价、收盘价和成交量。它不会记录各个
价格在区间内出现的时间，也无法说明最高价是否先于最低价出现。因此，基于 K 线的
执行是在模拟一条合理的区间内价格路径，而不是重建原始成交。

VibeTrader 会把每根执行 K 线转换为 L1 订单簿的合成市场更新。随着这些更新依次经过
K 线价格，簿中的挂单会参与撮合。

## K 线时间戳约定

:::warning
对于执行模拟，每根 K 线的初始化时间戳（`ts_init`）必须表示区间的**收盘时刻**。
这样可以防止完整 K 线在尚未形成时就变得可见。
:::

事件时间戳（`ts_event`）可以表示开盘或收盘，具体取决于数据源：

- 对于时间戳位于收盘时刻的 K 线，将 `ts_init` 设为相同时间戳。
- 对于时间戳位于开盘时刻的 K 线，设置 `ts_init = ts_event + interval_ns`。例如，
  一分钟 K 线应增加 `60_000_000_000` 纳秒。

如果适配器提供 `bars_timestamp_on_close=True` 之类的设置，优先使用该设置，让存储的
数据遵循预期约定。对于自定义数据，应在构造 `Bar` 对象、编码 Arrow 记录批次、写入
目录或调用 `add_data()` 之前填充 `ts_event` 与 `ts_init`。`BarDataWrangler` 使用显式
时间戳字段，并不提供 `ts_init_delta` 参数。运行回测前，请先用小样本验证结果。

## 处理 K 线数据

只有满足以下条件时，才会应用 K 线执行：

- 交易场所设置了 `bar_execution=True`。
- 交易场所使用 `BookType.L1_MBP`。
- K 线采用外部聚合源。

内部聚合的 K 线以及发送到 L2 或 L3 交易场所的 K 线仍会到达已订阅的策略，但不会
更新撮合引擎的订单簿，也不会触发撮合。

对于每根适用的 K 线，引擎会：

1. 为金融工具选择已配置的最细粒度 K 线类型。
1. 将 K 线成交量分摊到四次合成更新。
1. 按配置的顺序处理开盘价、最高价和最低价，最后处理收盘价。
1. 在每次合成更新后撮合订单。
1. 将完整 K 线分发给 actor 和策略。

因此，在 K 线开始时已经挂在簿中的订单，可能在某个中间 OHLC 价格点成交。从
`on_bar` 提交的订单，则要等该 K 线的四个价格点全部处理完后才会到达。

## OHLC 价格模拟

引擎把 K 线成交量平均分配到四个价格点，并把余数分配给收盘价，以确保合成更新保留
总成交量。如果四分之一成交量低于金融工具的最小 `size_increment`，每个价格点都会
使用该最小增量。

交易场所的 `bar_adaptive_high_low_ordering` 选项控制 K 线内价格路径：

- 使用 `False`（默认值）时，每根 K 线都采用 `Open -> High -> Low -> Close`。
- 使用 `True` 时，引擎会先访问距离开盘价更近的极值：
  - 如果开盘价更接近最高价，则采用 `Open -> High -> Low -> Close`。
  - 如果开盘价更接近最低价，则采用 `Open -> Low -> High -> Close`。

自适应路径是一种确定性启发式方法，并非对实际成交顺序的重建。其准确度取决于市场、
区间和数据源。一项[探索性的 EUR/USD 分析](https://gist.github.com/stefansimik/d387e1d9ff784a8973feca0cde51e363)
为这种距离启发式方法提供了动机，但并未证明其具有普遍适用的准确率。

当保护性止损和止盈目标都位于同一根 K 线内时，路径尤其重要，因为最先访问的价位
决定哪个订单可以先成交。

在交易场所上配置自适应顺序：

```python
from vibe_trader.backtest import BacktestEngine
from vibe_trader.config import BacktestEngineConfig
from vibe_trader.model import AccountType
from vibe_trader.model import Money
from vibe_trader.model import OmsType
from vibe_trader.model import Venue

engine = BacktestEngine(BacktestEngineConfig())
engine.add_venue(
    venue=Venue("SIM"),
    oms_type=OmsType.NETTING,
    account_type=AccountType.CASH,
    starting_balances=[Money.from_str("10_000 USDT")],
    bar_adaptive_high_low_ordering=True,
)
```

## 订单提交时机

第 N 根 K 线的 OHLC 序列会先于 `on_bar(N)` 运行。没有延迟模型时，从 `on_bar` 提交的
订单会立即对第 N 根 K 线收盘后留下的订单簿进行结算。

延迟模型会推迟订单的实际到达时间。如果只有 K 线数据且期间没有定时器事件，在下一
数据时间戳到达的订单会在下一根 K 线完成 OHLC 扫描后才结算，因此看到的是该 K 线的
收盘状态。报价 tick、成交 tick 或定时器驱动的结算，可以让命令更早地针对当时的
订单簿状态完成处理。

```python
from vibe_trader.execution import StaticLatencyModel

engine.add_venue(
    venue=Venue("SIM"),
    oms_type=OmsType.NETTING,
    account_type=AccountType.CASH,
    starting_balances=[Money.from_str("10_000 USDT")],
    latency_model=StaticLatencyModel(base_latency_nanos=1_000_000_000),
)
```

:::note
引擎不提供原生的"下一根 K 线开盘成交"模式。策略可以在不使用未来信息的前提下，
根据已经完成的前一根 K 线形成信号；但下一根 K 线在分发前，其开盘价已经被处理。
如果在当前 K 线的 `on_bar` 回调中使用该 K 线开盘价，就会引入前视偏差；而仅使用
K 线数据配合延迟时，订单通常会针对更晚的订单簿状态结算，而不是下一开盘价。
:::

## 内部 K 线聚合时机

数据引擎从 tick 聚合时间 K 线时，定时器会在区间边界关闭每根 K 线。时间戳恰好等于
该边界的数据，可能会在收盘定时器之后才被处理。

在 `DataEngineConfig` 中设置 `time_bars_build_delay`，可以延迟该定时器：

```python
from vibe_trader.config import BacktestEngineConfig
from vibe_trader.config import DataEngineConfig

config = BacktestEngineConfig(
    data_engine=DataEngineConfig(
        time_bars_build_delay=1,
    ),
)
```

该值以微秒为单位。较小的延迟（例如一微秒）可以让边界数据在 K 线关闭前到达。它只
影响内部聚合的 K 线。
