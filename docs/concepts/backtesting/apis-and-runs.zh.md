# 回测 API 与重复运行

VibeTrader 提供底层 `BacktestEngine` API 以便直接控制，也提供高层 `BacktestNode` API，
用于基于目录执行可配置的回测。

## 选择 API 层级

以下情况适合使用底层 API：

- 数据可以放入内存，或你准备手动流式传入各批数据。
- 需要从 Vibe Parquet 目录以外的格式加载数据。
- 需要直接控制交易场所、金融工具、actor、策略或执行算法。
- 希望在只更改部分组件后，重新运行已经加载的数据。

以下情况适合使用高层 API：

- 数据位于 `ParquetDataCatalog` 中。
- 数据需要自动分块加载。
- 希望用一个配置对象描述并标识基于目录的运行。
- 希望每次独立运行都使用全新的引擎。

## 底层 API

底层 API 以 `BacktestEngine` 为核心。使用 `BacktestEngineConfig` 创建引擎，然后添加
交易场所、金融工具、组件和数据，最后调用 `run()`：

```python
from vibe_trader.backtest import BacktestEngine
from vibe_trader.config import BacktestEngineConfig

engine = BacktestEngine(BacktestEngineConfig())
engine.add_venue(...)
engine.add_instrument(instrument)
engine.add_strategy(strategy)
engine.add_data(data)
engine.run()
```

### 加载数据

每次调用 `add_data()` 都会把输入复制到一条独立的数据流。引擎按回放时间戳排列每条
数据流，并在运行时按时间顺序合并所有数据流。为每个金融工具添加一批数据，并不会
反复排序一个不断增长的累积列表：

```python
engine.add_data(instrument1_bars)
engine.add_data(instrument2_bars)
engine.add_data(instrument3_bars)
engine.run()
```

除非批处理工作流有意自行管理运行就绪状态，否则请保留默认的 `sort=True`。使用
`sort=False` 调用会把引擎标记为尚未准备运行。应在 `run()` 前调用 `sort_data()`，
除非后续的 `add_data(..., sort=True)` 已经恢复就绪状态：

```python
engine.add_data(instrument1_bars, sort=False)
engine.add_data(instrument2_bars, sort=False)
engine.sort_data()
engine.run()
```

`sort_data()` 会把各自已经排好顺序的数据流标记为可以回放。重复调用也是安全的。

引擎会复制每个输入序列。在 `add_data()` 之后清空或修改原始 Python 列表，不会改变
已经加载的数据流。

### 手动流式传入批次

完整数据集无法放入内存时，请使用流式模式：

```python
engine.add_strategy(strategy)

for batch in data_batches:
    engine.add_data(batch)
    engine.run(streaming=True)
    engine.clear_data()

engine.end()
```

当前数据耗尽时，`run(streaming=True)` 会暂停。它不会结束 trader，也不会把定时器推进
到该批次之外。最后一批数据处理完后调用 `end()`，以便把定时器刷新到最后一次运行的
边界、调用停止处理器并生成最终结果。

底层 API 不提供基于生成器的 `add_data_iterator()` 方法。`BacktestNode` 可以自动对
目录数据分块；直接使用引擎时，应通过上面的循环流式处理。

## 高层 API

高层 API 以 `BacktestNode` 为核心。每个 `BacktestRunConfig` 包含：

- 一个或多个 `BacktestVenueConfig` 对象。
- 一个或多个 `BacktestDataConfig` 对象。
- 可选的 `BacktestEngineConfig`。
- 可选的分块大小、时间边界、异常处理和释放设置。

先构建节点，再通过该次运行专用的方法添加策略：

```python
from vibe_trader.config import BacktestDataConfig
from vibe_trader.config import BacktestEngineConfig
from vibe_trader.backtest import BacktestNode
from vibe_trader.config import BacktestRunConfig
from vibe_trader.config import BacktestVenueConfig
from vibe_trader.model import AccountType
from vibe_trader.model import BookType
from vibe_trader.model import OmsType

venue = BacktestVenueConfig(
    name="SIM",
    oms_type=OmsType.HEDGING,
    account_type=AccountType.MARGIN,
    book_type=BookType.L1_MBP,
    starting_balances=["1_000_000 USD"],
)
data = BacktestDataConfig(
    data_type="QuoteTick",
    catalog_path="/data/catalog",
    instrument_id=instrument_id,
)
config = BacktestRunConfig(
    venues=[venue],
    data=[data],
    engine=BacktestEngineConfig(),
    chunk_size=100_000,
)

node = BacktestNode([config])
node.build()
node.add_strategy_from_config(config.id, strategy_config)
results = node.run()
```

`BacktestNode` 还提供向已构建运行添加 actor 和内置策略的方法。

## 出错时关闭

设置 `BacktestEngineConfig.shutdown_on_error=True`，可以在 Rust 日志记录器发出错误记录时
请求正常关闭：

```python
from vibe_trader.config import BacktestEngineConfig

config = BacktestEngineConfig(shutdown_on_error=True)
```

回测循环会观察该请求，停止 trader 和各引擎，并返回截至当时已经收集的结果。它不会
中止进程。即使错误记录被组件过滤器抑制，或设置了 `bypass_logging=True`，仍会请求
关闭；Python 的 `logging.error(...)` 调用则不会触发该请求。

新的内核运行开始时，触发状态会重置。最终 `on_stop` 与命令结算的行为，请参阅
[关闭语义](execution-flow.md#shutdown-semantics)。

## 重复运行

`BacktestEngine.reset()` 会把交易状态和已加载组件的状态恢复为初始值，同时保留已经
注册的数据、金融工具、交易场所、actor、策略和执行算法。

重置会清除：

- 订单、持仓和账户余额。
- 组件运行时状态。
- 引擎计数器和时间戳。

重置会保留：

- 通过 `add_data()` 添加的数据。
- 金融工具和交易场所配置。
- 已注册的 actor、策略和执行算法。

金融工具会继续保持加载，因为默认回测缓存配置设置了
`drop_instruments_on_reset=False`。

### 为独立运行使用全新节点

`BacktestNode` 接受一个 `BacktestRunConfig`。运行相互独立的配置时，请逐个创建并
释放节点：

```python
configs = [
    BacktestRunConfig(...),
    BacktestRunConfig(...),
    BacktestRunConfig(...),
]
results = []

for config in configs:
    node = BacktestNode([config])
    try:
        results.extend(node.run())
    finally:
        node.dispose()
```

如果策略不是由控制器提供，应在调用 `run()` 前构建每个节点并注册相应策略。

### 复用已加载数据进行参数化运行

如果多次运行需要共用已经加载的数据和交易场所设置，请使用 `reset()`：

```python
engine = BacktestEngine(BacktestEngineConfig())
engine.add_venue(...)
engine.add_instrument(instrument)
engine.add_data(data)

engine.add_strategy(strategy1)
engine.run()

engine.reset()
engine.run()

engine.reset()
engine.clear_strategies()
engine.add_strategy(strategy2)
engine.run()
```

替换策略实例前调用 `clear_strategies()`。只有下一次运行需要加载不同数据集时，才使用
`clear_data()`。
