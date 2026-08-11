---
title: "回测（高级API）"
---

使用 `BacktestNode`，通过配置驱动的方式结合 Parquet 数据目录进行回测。对于生产工作流，推荐采用这条路径，因为这里构建的策略、Actor 和执行算法，都可以直接沿用到使用 `LiveNode` 的实盘交易中。

本教程将加载外汇报价 tick 数据并写入数据目录，然后在模拟的外汇 ECN 交易场所中回测 EMA 交叉策略。

[在 GitHub 上查看源代码](https://github.com/qOeOp/trade/blob/main/docs/getting_started/backtest_high_level.py)。

## 先决条件

- Python 3.12+
- 在本地构建 Vibe Trader 源码（`make build-debug`）

```python
import os
import shutil
from decimal import Decimal
from pathlib import Path

import pandas as pd

from vibe_trader.config import BacktestDataConfig
from vibe_trader.config import BacktestEngineConfig
from vibe_trader.backtest import BacktestNode
from vibe_trader.config import BacktestRunConfig
from vibe_trader.config import BacktestVenueConfig
from vibe_trader.config import ImportableStrategyConfig
from vibe_trader.core.datetime import dt_to_unix_nanos
from vibe_trader.model import QuoteTick
from vibe_trader.persistence import ParquetDataCatalog
from vibe_trader.persistence.wranglers import QuoteTickDataWrangler
from vibe_trader.test_kit.providers import CSVTickDataLoader
from vibe_trader.test_kit.providers import TestInstrumentProvider
```

## 下载样本数据

此示例使用 [histdata.com](https://www.histdata.com/download-free-forex-historical-data/?/ascii/tick-data-quotes/) 提供的外汇 tick 数据。请选择一个外汇货币对，并下载一个或多个月份的数据。

下载的文件如下所示：

- `DAT_ASCII_EURUSD_T_202410.csv`（2024 年 10 月欧元/美元）
- `DAT_ASCII_EURUSD_T_202411.csv`（2024 年 11 月欧元/美元）

将 CSV 文件解压到 `~/Downloads/Data/HISTDATA/`。也可以设置 `VIBE_DATA_DIR` 环境变量，使其指向包含 `HISTDATA` 子目录的父目录。

```python
DATA_DIR = Path(os.environ.get("VIBE_DATA_DIR", "~/Downloads/Data")).expanduser() / "HISTDATA"
```

```python
path = DATA_DIR
raw_files = [
    f for f in path.iterdir() if f.is_file() and (f.suffix == ".csv" or f.name.endswith(".csv.gz"))
]
assert raw_files, f"Unable to find any CSV files in directory {path}"
raw_files
```

## 将数据加载到数据目录

Histdata CSV 文件包含 `timestamp, bid_price, ask_price` 字段。先将原始数据加载到 DataFrame，再使用 `QuoteTickDataWrangler` 将其处理为 Vibe `QuoteTick` 对象。

```python
# Load the first CSV file into a pandas DataFrame
df = CSVTickDataLoader.load(
    file_path=raw_files[0],
    index_col=0,
    header=None,
    names=["timestamp", "bid_price", "ask_price", "volume"],
    usecols=["timestamp", "bid_price", "ask_price"],
    parse_dates=["timestamp"],
    date_format="%Y%m%d %H%M%S%f",
)

df = df.sort_index()
df.head(2)
```

```python
# Process quotes using a wrangler
EURUSD = TestInstrumentProvider.default_fx_ccy("EUR/USD")
wrangler = QuoteTickDataWrangler(EURUSD)

ticks = wrangler.process(df)

# Preview: see first 2 ticks
ticks[0:2]
```

更多信息请参阅[加载数据](../concepts/data)指南。

使用一个存储目录实例化 `ParquetDataCatalog`（此处使用当前目录），然后将金融工具与 tick 数据写入数据目录。

```python
CATALOG_PATH = Path.cwd() / "catalog"

# Clear if it already exists, then create fresh
if CATALOG_PATH.exists():
    shutil.rmtree(CATALOG_PATH)
CATALOG_PATH.mkdir(parents=True)

# Create a catalog instance
catalog = ParquetDataCatalog(CATALOG_PATH)

# Write instrument to the catalog
catalog.write_data([EURUSD])

# Write ticks to catalog
catalog.write_data(ticks)
```

## 查询目录

数据目录提供 `.instruments()`、`.quotes()` 等方法，可用于查询已存储的数据并确定可用的时间范围。

```python
# Get list of all instruments in catalog
catalog.instruments()
```

```python
# See 1st instrument from catalog
instrument = catalog.instruments()[0]
instrument
```

```python
# Query quote ticks from catalog to determine the data range
all_ticks = catalog.quotes(instrument_ids=[EURUSD.id.value])
print(f"Total ticks in catalog: {len(all_ticks)}")

if all_ticks:
    # Get timestamps from the data
    first_tick_time = pd.Timestamp(all_ticks[0].ts_init, unit="ns", tz="UTC")
    last_tick_time = pd.Timestamp(all_ticks[-1].ts_init, unit="ns", tz="UTC")
    print(f"Data range: {first_tick_time} to {last_tick_time}")

    # Set backtest range to first 2 weeks of data (as ISO strings for BacktestDataConfig)
    start_time = first_tick_time.isoformat()
    end_time = (first_tick_time + pd.Timedelta(days=14)).isoformat()
    print(f"Backtest range: {start_time} to {end_time}")

    # Preview selected data
    start_ns = all_ticks[0].ts_init
    end_ns = dt_to_unix_nanos(first_tick_time + pd.Timedelta(days=14))
    selected_quote_ticks = catalog.quotes(
        instrument_ids=[EURUSD.id.value],
        start=start_ns,
        end=end_ns,
    )
    print(f"Selected ticks for backtest: {len(selected_quote_ticks)}")
    selected_quote_ticks[:2]
else:
    raise ValueError("No ticks found in catalog")
```

## 添加交易场所

```python
venue_configs = [
    BacktestVenueConfig(
        name="SIM",
        oms_type="HEDGING",
        account_type="MARGIN",
        base_currency="USD",
        starting_balances=["1_000_000 USD"],
    ),
]
```

## 添加数据

```python
str(CATALOG_PATH)
```

```python
data_configs = [
    BacktestDataConfig(
        catalog_path=str(CATALOG_PATH),
        data_cls=QuoteTick,
        instrument_id=instrument.id,
        start_time=start_time,
        end_time=end_time,
    ),
]
```

## 添加策略

```python
strategies = [
    ImportableStrategyConfig(
        strategy_path="vibe_trader.examples.strategies.ema_cross:EMACross",
        config_path="vibe_trader.examples.strategies.ema_cross:EMACrossConfig",
        config={
            "instrument_id": instrument.id,
            "bar_type": "EUR/USD.SIM-15-MINUTE-BID-INTERNAL",
            "fast_ema_period": 10,
            "slow_ema_period": 20,
            "trade_size": Decimal(1_000_000),
        },
    ),
]
```

## 配置回测

`BacktestRunConfig` 将交易场所、数据与策略配置集中在一个对象中。它支持分步构建，因此可以按阶段完成配置，并减少参数扫描或网格搜索中的样板代码。

```python
config = BacktestRunConfig(
    engine=BacktestEngineConfig(strategies=strategies),
    data=data_configs,
    venues=venue_configs,
)
```

## 运行回测

`BacktestNode` 按时间戳顺序处理所有数据，并提供确定性的执行语义。这些架构模式--策略、Actor 与执行算法--都可以通过 `LiveNode` 沿用到实盘交易中。

```python
node = BacktestNode(configs=[config])

results = node.run()
results
```
