---
title: "使用 Databento 构建数据目录"
---

使用 Databento 市场数据建立 Vibe Parquet 数据目录。该目录可为回测与研究提供高效的存储和查询能力。

[在 GitHub 上查看源代码](https://github.com/qOeOp/trade/blob/main/docs/how_to/data_catalog_databento.py)。

## 先决条件

- Python 3.12+
- 在本地构建 Vibe Trader 源码（`make build-debug`）
- [databento](https://pypi.org/project/databento/) Python 客户端库（`pip install databento`）
- [Databento](https://databento.com) 账户，并将 API 密钥设置为 `DATABENTO_API_KEY`

## 请求数据

初始化 Databento 历史数据客户端。默认情况下，客户端会从 `DATABENTO_API_KEY` 环境变量读取 API 密钥。

```python
import databento as db


client = db.Historical()  # Uses the DATABENTO_API_KEY environment variable
```

**每次调用 `timeseries.get_range` 请求历史数据流都会产生费用，即使请求的是相同数据。因此请务必：**

- 发出请求前检查费用
- 避免重复请求同一份数据
- 将响应以 zstd 压缩的 DBN 文件写入磁盘

每次请求前，使用元数据 [get_cost 端点](https://databento.com/docs/api-reference-historical/metadata/metadata-get-cost?historical=python&live=python)估算费用；只请求磁盘上尚不存在的数据。

响应以美元计价，并以美分的小数形式显示。

下面仅请求少量数据，用于演示这套工作流；数据量与 Medium 文章[使用 Databento 和 sklearn 在 Python 中构建高频交易信号](https://databento.com/blog/hft-sklearn-python)中的示例相同。

```python
from pathlib import Path

from databento import DBNStore
```

先为原始 Databento DBN 格式数据准备一个目录，教程后续部分都将使用它。

```python
DATABENTO_DATA_DIR = Path("databento")
DATABENTO_DATA_DIR.mkdir(exist_ok=True)
```

```python
# Request cost quote (USD) - this endpoint is 'free'
client.metadata.get_cost(
    dataset="GLBX.MDP3",
    symbols=["ES.n.0"],
    stype_in="continuous",
    schema="mbp-10",
    start="2023-12-06T14:30:00",
    end="2023-12-06T20:30:00",
)
```

通过历史 API 请求 Medium 文章所使用的数据。

```python
path = DATABENTO_DATA_DIR / "es-front-glbx-mbp10.dbn.zst"

if not path.exists():
    # Request data
    client.timeseries.get_range(
        dataset="GLBX.MDP3",
        symbols=["ES.n.0"],
        stype_in="continuous",
        schema="mbp-10",
        start="2023-12-06T14:30:00",
        end="2023-12-06T20:30:00",
        path=path,  # <-- Passing a `path` writes the data to disk
    )
```

从磁盘读取数据并转换为 pandas.DataFrame。

```python
data = DBNStore.from_file(path)

df = data.to_df()
df
```

## 写入数据目录

```python
import shutil
from pathlib import Path

from vibe_trader.adapters.databento import DatabentoDataLoader
from vibe_trader.model import InstrumentId
from vibe_trader.persistence import ParquetDataCatalog
```

```python
CATALOG_PATH = Path.cwd() / "catalog"

# Clear if it already exists
if CATALOG_PATH.exists():
    shutil.rmtree(CATALOG_PATH)
CATALOG_PATH.mkdir()

# Create a catalog instance
catalog = ParquetDataCatalog(CATALOG_PATH)
```

使用 `DatabentoDataLoader` 解码数据，并将其加载为 Vibe 对象。

```python
loader = DatabentoDataLoader()
```

`instrument_id` 参数是可选的；提供该参数可以跳过符号映射，从而加快加载速度。其值应采用 Vibe 的 `symbol.venue` 格式，例如 "ES.GLBX"。

```python
path = DATABENTO_DATA_DIR / "es-front-glbx-mbp10.dbn.zst"

# Option 1 (recommended): Let the loader infer the instrument ID from DBN metadata
depth10 = loader.load_order_book_depth10(filepath=path)

# Option 2: Explicitly specify a valid Vibe instrument ID (symbol.venue format)
# instrument_id = InstrumentId.from_str("ESZ3.GLBX")  # E-mini S&P December 2023 futures on Globex
# depth10 = loader.load_order_book_depth10(
#     filepath=path,
#     instrument_id=instrument_id,
# )
```

```python
# Write data to catalog (this takes ~20 seconds or ~250,000/second for writing MBP-10 at the moment)
catalog.write_data(depth10)
```

```python
# Test reading from catalog
depths = catalog.order_book_depth10()
len(depths)
```

## 准备一个月的 AAPL 交易

下面扩展这套工作流：使用 Databento `trade` schema 准备 Nasdaq 交易所一个月的 AAPL 成交数据，并将其转换为 Vibe `TradeTick` 对象。

```python
# Request cost quote (USD) - this endpoint is 'free'
client.metadata.get_cost(
    dataset="XNAS.ITCH",
    symbols=["AAPL"],
    schema="trades",
    start="2024-01",
)
```

请求历史数据时传入 `path` 参数，即可将数据写入磁盘。

```python
path = DATABENTO_DATA_DIR / "aapl-xnas-202401.trades.dbn.zst"

if not path.exists():
    # Request data
    client.timeseries.get_range(
        dataset="XNAS.ITCH",
        symbols=["AAPL"],
        schema="trades",
        start="2024-01",
        path=path,  # <-- Passing a `path` parameter
    )
```

从磁盘读取数据并转换为 pandas.DataFrame。

```python
data = DBNStore.from_file(path)

df = data.to_df()
df
```

这里使用值为 `"AAPL.XNAS"` 的 `InstrumentId`；其中 XNAS 是 Nasdaq 交易场所的 ISO 10383 MIC（市场标识符代码）。

传入 `instrument_id` 可跳过符号映射，从而加快加载速度。

```python
instrument_id = InstrumentId.from_str("AAPL.XNAS")

trades = loader.load_trades(
    filepath=path,
    instrument_id=instrument_id,
)
```

这里按每月一个文件组织数据；按每天一个文件组织也同样可行。

```python
# Write data to catalog
catalog.write_data(trades)
```

```python
trades = catalog.trades([instrument_id])
```

```python
len(trades)
```
