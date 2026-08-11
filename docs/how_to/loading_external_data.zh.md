---
title: "加载外部数据"
---

将 CSV 市场数据加载到 Parquet 数据目录，再使用 `BacktestNode` 运行回测。如果历史数据来自 VibeTrader 适配器尚未直接支持的外部供应商，通常可以采用这套工作流。

[在 GitHub 上查看源代码](https://github.com/qOeOp/trade/blob/main/docs/how_to/loading_external_data.py)。

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
from vibe_trader.model import BarType
from vibe_trader.model import QuoteTick
from vibe_trader.persistence import ParquetDataCatalog
from vibe_trader.persistence.wranglers import QuoteTickDataWrangler
from vibe_trader.test_kit.providers import CSVTickDataLoader
from vibe_trader.test_kit.providers import TestInstrumentProvider
```

## 加载并整理数据

将 CSV tick 文件（例如来自 [histdata.com](https://www.histdata.com/) 的文件）放入 `~/Downloads/Data/HISTDATA/`。如果数据位于其他位置，请将 `VIBE_DATA_DIR` 环境变量设为其父目录。`CSVTickDataLoader` 将原始 CSV 读入 DataFrame，`QuoteTickDataWrangler` 再将其转换为 Vibe `QuoteTick` 对象。

```python
DATA_DIR = Path(os.environ.get("VIBE_DATA_DIR", "~/Downloads/Data")).expanduser() / "HISTDATA"
```

```python
path = DATA_DIR
raw_files = [
    f for f in path.iterdir() if f.is_file() and (f.suffix == ".csv" or f.name.endswith(".csv.gz"))
]
assert raw_files, f"Unable to find any data files in directory {path}"
raw_files
```

```python
# Load the first data file into a pandas DataFrame
df = CSVTickDataLoader.load(raw_files[0], index_col=0, datetime_format="%Y%m%d %H%M%S%f")
df = df.iloc[:, :2]
df.columns = ["bid_price", "ask_price"]

# Process quotes using a wrangler
EURUSD = TestInstrumentProvider.default_fx_ccy("EUR/USD")
wrangler = QuoteTickDataWrangler(EURUSD)

ticks = wrangler.process(df)
```

## 写入数据目录

创建 `ParquetDataCatalog`，并写入金融工具定义与 tick 数据。数据目录以 Parquet 格式存储这些数据，便于回测时高效查询。

```python
CATALOG_PATH = Path.cwd() / "catalog"

# Clear if it already exists, then create fresh
if CATALOG_PATH.exists():
    shutil.rmtree(CATALOG_PATH)
CATALOG_PATH.mkdir()

catalog = ParquetDataCatalog(CATALOG_PATH)
```

```python
catalog.write_data([EURUSD])
catalog.write_data(ticks)
```

```python
# Verify instruments written to catalog
catalog.instruments()
```

```python
start = dt_to_unix_nanos(pd.Timestamp("2020-01-03", tz="UTC"))
end = dt_to_unix_nanos(pd.Timestamp("2020-01-04", tz="UTC"))

ticks = catalog.quotes(instrument_ids=[EURUSD.id.value], start=start, end=end)
ticks[:10]
```

## 配置并运行回测

配置交易场所、数据与策略，然后运行 `BacktestNode`。这里构建的策略与 Actor 可以继续用于基于 `LiveNode` 的实盘交易。

```python
instrument = catalog.instruments()[0]

venue_configs = [
    BacktestVenueConfig(
        name="SIM",
        oms_type="HEDGING",
        account_type="MARGIN",
        base_currency="USD",
        starting_balances=["1000000 USD"],
    ),
]

data_configs = [
    BacktestDataConfig(
        catalog_path=str(catalog.path),
        data_cls=QuoteTick,
        instrument_id=instrument.id,
        start_time=start,
        end_time=end,
    ),
]

strategies = [
    ImportableStrategyConfig(
        strategy_path="vibe_trader.examples.strategies.ema_cross:EMACross",
        config_path="vibe_trader.examples.strategies.ema_cross:EMACrossConfig",
        config={
            "instrument_id": instrument.id,
            "bar_type": BarType.from_str(f"{instrument.id.value}-15-MINUTE-BID-INTERNAL"),
            "fast_ema_period": 10,
            "slow_ema_period": 20,
            "trade_size": Decimal(1_000_000),
        },
    ),
]

config = BacktestRunConfig(
    engine=BacktestEngineConfig(strategies=strategies),
    data=data_configs,
    venues=venue_configs,
)
```

```python
node = BacktestNode(configs=[config])

[result] = node.run()
```

```python
result
```
