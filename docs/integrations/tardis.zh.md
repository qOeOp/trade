# Tardis

Tardis 为加密货币市场提供细粒度数据，包括逐笔订单簿快照和更新、交易、未平仓量、资金费率、期权摘要，以及主流加密货币交易所的强平数据。

VibeTrader 集成了 Tardis API、Tardis Machine WebSocket 服务器和 Tardis CSV 格式。该适配器提供以下功能：

- CSV 加载和流式处理函数：将 Tardis 格式的文件批量或分块读取为 Vibe 数据。
- `TardisMachineClient`：以流式方式传输 Tardis Machine 的实时或历史重放数据，并将消息转换为 Vibe 数据。
- `TardisHttpClient`：从 Tardis HTTP API 请求金融工具元数据，并将其解析为 Vibe 金融工具定义。
- `TardisDataClient`：为 Tardis Machine 数据流提供实盘数据客户端。
- `TardisInstrumentProvider`：从 Tardis 元数据 API 加载金融工具定义。
- **数据管道函数**：从 Tardis Machine 重放历史数据，并写入 Vibe Parquet 目录文件。

:::info
Vibe 金融工具元数据调用需要 `TARDIS_API_KEY`。对于每月首日免费数据以外的历史日期，Tardis Machine 使用 `TM_API_KEY`。另请参阅[环境变量](#环境变量)。
:::

## 概述

该适配器使用 Rust 实现，并提供可选的 Python 绑定。
它不依赖任何外部 Tardis 客户端库。

:::info
**无需**为 `tardis` 执行额外安装步骤。
适配器的核心组件会编译为静态库，并在构建期间链接。
:::

## Tardis 文档

Tardis 提供详尽的用户[文档](https://docs.tardis.dev/)。
建议将 Tardis 文档与本 VibeTrader 集成指南结合使用。

## 支持的格式

Tardis 提供跨受支持交易所保持统一格式的*规范化*市场数据。
借助这种规范化，一个解析器就能处理任意 [Tardis 支持的交易所](#交易场所)的数据。
VibeTrader 的此适配器不支持 Tardis 的交易所原生市场数据格式。

VibeTrader 支持下列规范化 Tardis Machine 格式。字段模式请参阅官方 [Tardis 数据类型参考](https://docs.tardis.dev/tardis-machine/data-types)。

| Tardis 格式         | Vibe 数据类型                                                     |
| :------------------ | :---------------------------------------------------------------- |
| `book_change`       | `OrderBookDelta`                                                  |
| `book_snapshot_*`   | `OrderBookDepth10` 或 `OrderBookDeltas`                           |
| `quote`             | `QuoteTick`                                                       |
| `quote_10s`         | `QuoteTick`                                                       |
| `trade`             | `Trade`                                                           |
| `trade_bar_*`       | `Bar`                                                             |
| `instrument`        | `CurrencyPair`、`CryptoFuture`、`CryptoPerpetual`、`CryptoOption` |
| `derivative_ticker` | `FundingRateUpdate`                                               |
| `option_summary`    | `OptionGreeks`；可选择从 BBO 字段生成 `QuoteTick`                 |
| `disconnect`        | *不适用*                                                          |

**注意：**

- Tardis 将 `quote` 记载为 `book_snapshot_1_0ms` 的别名。
- Tardis 将 `quote_10s` 记载为 `book_snapshot_1_10s` 的别名。
- `quote`、`quote_10s` 和单档快照会解析为 `QuoteTick`。
- 当 `derivative_ticker` 消息中的标记价格或指数价格发生变化时，Rust 数据客户端也会发出相应更新。
- Tardis `option_summary` 消息包含最优买价/卖价字段。Vibe 始终将此数据馈送映射为 `OptionGreeks`；将 `extract_bbo_as_quotes` 设置为 `true`，还可从这些 BBO 字段发出 `QuoteTick`。

:::info
另请参阅 Tardis 的 [Tardis Machine 快速入门](https://docs.tardis.dev/tardis-machine/quickstart)。
:::

## K 线

适配器将 Tardis 交易 K 线的时间间隔和后缀转换为 Vibe `BarType`。
支持下列类型：

| Tardis 后缀 | 含义       | Vibe K 线聚合方式 |
| :---------- | :--------- | :---------------- |
| `ms`        | 毫秒       | `MILLISECOND`     |
| `s`         | 秒         | `SECOND`          |
| `m`         | 分钟       | `MINUTE`          |
| `ticks`     | tick 数量  | `TICK`            |
| `vol`       | 成交量大小 | `VOLUME`          |

## 符号体系与规范化

Tardis 集成通过统一规范化符号，确保与 VibeTrader 加密货币交易所适配器兼容。
通常，VibeTrader 使用 Tardis 提供的交易所原生命名约定。对于某些交易所，原始符号会按下述规则调整，以符合 Vibe 符号体系规范：

### 通用规则

- 所有符号均转换为大写。
- 对于部分交易所，市场类型后缀会在连字符后追加。
- 原始交易所符号保留在 Vibe 金融工具定义的 `raw_symbol` 字段中。

### 交易所特定的规范化

- **Binance**：Vibe 为所有永续合约符号追加 `-PERP` 后缀。
- **Bybit**：Vibe 使用产品类别后缀，包括 `-SPOT`、`-LINEAR`、
  `-INVERSE` 和 `-OPTION`。
- **dYdX**：Vibe 为所有永续合约符号追加 `-PERP` 后缀。
- **Gate.io**：Vibe 为所有永续合约符号追加 `-PERP` 后缀。

各交易所符号体系的详细文档：

- [Binance 符号体系](./binance.md#symbology)
- [Bybit 符号体系](./bybit.md#symbology)
- [dYdX 符号体系](./dydx.md#symbology)

## 交易场所

Tardis 将部分交易所划分为多个交易场所。
下表列出 Vibe 交易场所与相应 Tardis 交易所之间的映射：

| Vibe 交易场所      | Tardis 交易所                                                       |
| :----------------- | :------------------------------------------------------------------ |
| `ASCENDEX`         | `ascendex`                                                          |
| `BINANCE`          | `binance`、`binance-dex`、`binance-futures`、`binance-options`      |
| `BINANCE_DELIVERY` | `binance-delivery`（*币本位合约*）                                  |
| `BINANCE_US`       | `binance-us`                                                        |
| `BITFINEX`         | `bitfinex`、`bitfinex-derivatives`                                  |
| `BITFLYER`         | `bitflyer`                                                          |
| `BITGET`           | `bitget`、`bitget-futures`                                          |
| `BITMEX`           | `bitmex`                                                            |
| `BITNOMIAL`        | `bitnomial`                                                         |
| `BITSTAMP`         | `bitstamp`                                                          |
| `BLOCKCHAIN_COM`   | `blockchain-com`                                                    |
| `BYBIT`            | `bybit`、`bybit-options`、`bybit-spot`                              |
| `COINBASE`         | `coinbase`                                                          |
| `COINBASE_INTX`    | `coinbase-international`                                            |
| `COINFLEX`         | `coinflex`（*用于历史研究*）                                        |
| `CRYPTO_COM`       | `crypto-com`                                                        |
| `CRYPTOFACILITIES` | `cryptofacilities`                                                  |
| `DELTA`            | `delta`                                                             |
| `DERIBIT`          | `deribit`                                                           |
| `DYDX`             | `dydx`                                                              |
| `DYDX_V4`          | `dydx-v4`                                                           |
| `FTX`              | `ftx`、`ftx-us`（*历史研究*）                                       |
| `GATE_IO`          | `gate-io`、`gate-io-futures`                                        |
| `GEMINI`           | `gemini`                                                            |
| `HITBTC`           | `hitbtc`                                                            |
| `HUOBI`            | `huobi`、`huobi-dm`、`huobi-dm-linear-swap`、`huobi-dm-options`     |
| `HUOBI_DELIVERY`   | `huobi-dm-swap`                                                     |
| `HYPERLIQUID`      | `hyperliquid`                                                       |
| `KRAKEN`           | `kraken`                                                            |
| `KUCOIN`           | `kucoin`、`kucoin-futures`                                          |
| `MANGO`            | `mango`                                                             |
| `OKCOIN`           | `okcoin`                                                            |
| `OKEX`             | `okex`、`okex-futures`、`okex-options`、`okex-spreads`、`okex-swap` |
| `PHEMEX`           | `phemex`                                                            |
| `POLONIEX`         | `poloniex`                                                          |
| `SERUM`            | `serum`（*历史研究*）                                               |
| `STAR_ATLAS`       | `star-atlas`                                                        |
| `UPBIT`            | `upbit`                                                             |
| `WOO_X`            | `woo-x`                                                             |

Tardis 还公开 `binance-european-options` 和 `binance-jersey` 等旧版 Binance 交易所。

## 环境变量

Tardis 和 VibeTrader 使用以下环境变量。

- `TM_API_KEY`：Tardis Machine 的 API 密钥。
- `TARDIS_API_KEY`：VibeTrader Tardis 客户端的 API 密钥。
- `TARDIS_MACHINE_WS_URL`（可选）：`TardisMachineClient` 的 WebSocket URL。
- `TARDIS_BASE_URL`（可选）：VibeTrader 中 `TardisHttpClient` 的基础 URL。
- `VIBE_PATH`（可选）：包含 `catalog/` 子目录的父目录，用于存放重放输出。

Tardis 金融工具元数据 API 要求使用 Bearer 令牌授权，仅向有效的 Tardis Pro 和 Business 订阅开放。

## 运行 Tardis Machine 历史重放

[Tardis Machine Server](https://docs.tardis.dev/tardis-machine/quickstart) 是可在本地运行、内置数据缓存的服务器。它通过 HTTP 和 WebSocket API 提供 tick 级历史数据和整合后的实时加密货币市场数据。

可以使用 Python 或 Rust 完整重放 Tardis Machine WebSocket 历史数据，并以 Vibe Parquet 格式输出结果。由于该函数使用 Rust 实现，因此从 Python 或 Rust 运行时性能一致。

端到端 `run_tardis_machine_replay` 数据管道函数使用指定的[配置](#配置)执行以下步骤：

- 连接 Tardis Machine 服务器。
- 从 Tardis 金融工具元数据 API 请求并解析所有必需的金融工具定义。
- 从 Tardis Machine 以流式方式传输指定时间范围内所有请求的金融工具和数据类型。
- 按金融工具、数据类型和日期（UTC）分别生成与数据目录兼容的 `.parquet` 文件。
- 断开与 Tardis Machine 服务器的连接，并终止程序。

**文件命名约定**

每个金融工具每天写入一个文件，使用 ISO 8601 时间戳范围：

- **格式**：`{start_timestamp}_{end_timestamp}.parquet`
- **示例**：`2023-10-01T00-00-00-000000000Z_2023-10-01T23-59-59-999999999Z.parquet`
- **结构**：`data/{data_type}/{instrument_id}/{filename}`

该格式与 Vibe 数据目录的查询、整合和管理功能兼容。

:::note
每月首日的数据无需 Tardis Machine API 密钥即可请求。其他日期需要 `TM_API_KEY`。
:::

此流程针对直接输出到 Vibe Parquet 数据目录进行了优化。
请将 `VIBE_PATH` 设置为包含 `catalog/` 子目录的父目录。Parquet 文件会按数据类型写入 `<VIBE_PATH>/catalog/data/` 下的子目录。

如果未指定 `output_path` 且未设置 `VIBE_PATH`，则默认输出到当前工作目录。

### 操作步骤

首先，确保 `tardis-machine` Docker 容器正在运行。使用以下命令：

```bash
docker run -p 8000:8000 -p 8001:8001 -e "TM_API_KEY=YOUR_API_KEY" -d tardisdev/tardis-machine
```

该命令启动的 `tardis-machine` 服务器没有持久化本地缓存，可能影响性能。为获得更好的重放性能，请为其挂载持久化卷。

### 配置

接下来，确保已有可用的 JSON 配置文件。

**JSON 配置字段**

- `tardis_ws_url`（`str | null`）：Tardis Machine 的 WebSocket URL。默认为
  `TARDIS_MACHINE_WS_URL`。
- `normalize_symbols`（`bool | null`）：应用 Vibe 符号规范化。默认为 `true`。
- `output_path`（`str | null`）：Parquet 数据的输出目录。依次默认为 `VIBE_PATH`
  和当前工作目录。
- `book_snapshot_output`（`"deltas" | "depth10" | null`）：快照输出格式。默认为
  `"deltas"`。
- `extract_bbo_as_quotes`（`bool | null`）：还会根据 Tardis Machine `option_summary` 消息中的最优买价/卖价字段写入 `QuoteTick` 数据。默认为 `false`。
- `compression`（`"zstd" | "snappy" | "uncompressed" | null`）：Parquet 压缩编解码器。
  默认为 3 级 `"zstd"`。
- `proxy_url`（`str | null`）：Tardis HTTP 请求使用的代理 URL。默认不使用代理。
- `options`（`JSON[]`）：必需的重放请求选项对象。

示例配置文件位于 `crates/adapters/tardis/bin/example_config.json`：

```json
{
  "tardis_ws_url": "ws://localhost:8001",
  "output_path": null,
  "options": [
    {
      "exchange": "bitmex",
      "symbols": [
        "xbtusd",
        "ethusd"
      ],
      "data_types": [
        "trade"
      ],
      "from": "2019-10-01",
      "to": "2019-10-02"
    }
  ]
}
```

### 订单簿快照输出

`book_snapshot_output` 配置选项控制 Tardis `book_snapshot_*` 消息的转换与存储方式。

| 值        | Vibe 类型          | 输出目录             | 描述                           |
| :-------- | :----------------- | :------------------- | :----------------------------- |
| `deltas`  | `OrderBookDeltas`  | `order_book_deltas/` | 价格档位更新。                 |
| `depth10` | `OrderBookDepth10` | `order_book_depths/` | 最多包含 10 个价格档位的快照。 |

**各格式的适用场景：**

- **`deltas`（默认）**：需要重建订单簿状态，或将快照与 `book_change` 数据结合使用时选择。每个价格档位会成为一条独立的增量记录。
- **`depth10`**：策略需要定期深度快照时选择。每个快照是一条记录；若快照超过 10 档，则只保留前 10 档。

**避免覆盖文件：**

同时下载同一金融工具和日期范围的 `book_snapshot_*` 与 `book_change` 数据时，`depth10` 会将快照写入 `order_book_depths/`，避免覆盖 `order_book_deltas/`。

显式指定格式的配置示例：

```json
{
  "tardis_ws_url": "ws://localhost:8001",
  "book_snapshot_output": "depth10",
  "options": [
    {
      "exchange": "binance-futures",
      "symbols": ["btcusdt"],
      "data_types": ["book_snapshot_5_100ms", "book_change"],
      "from": "2024-01-01",
      "to": "2024-01-02"
    }
  ]
}
```

### 从期权摘要提取 BBO

请求 Tardis Machine `option_summary` 数据且回测还需要期权 BBO 报价时，请将 `extract_bbo_as_quotes` 设置为 `true`。Vibe 仍会从每条 `option_summary` 消息写入 `OptionGreeks`。当所有最优买价/卖价字段均存在且数量有效时，还会为同一金融工具和时间戳写入一条 `QuoteTick`。

该选项仅适用于 Tardis Machine `option_summary` 重放和流式消息，不会改变 Tardis CSV 加载行为。

```json
{
  "tardis_ws_url": "ws://localhost:8001",
  "extract_bbo_as_quotes": true,
  "options": [
    {
      "exchange": "deribit",
      "symbols": ["BTC-28JUN24-70000-C"],
      "data_types": ["option_summary"],
      "from": "2024-01-01",
      "to": "2024-01-02"
    }
  ]
}
```

### Python 重放

要在 Python 中运行重放，请创建类似以下内容的脚本：

```python
import asyncio
from pathlib import Path

from vibe_trader.adapters.tardis import run_tardis_machine_replay


async def run():
    config_filepath = Path("YOUR_CONFIG_FILEPATH")
    await run_tardis_machine_replay(str(config_filepath.resolve()))


if __name__ == "__main__":
    asyncio.run(run())
```

### Rust 重放

要在 Rust 中运行重放，请创建类似以下内容的二进制程序：

```rust
use std::path::PathBuf;

use vibe_adapters::tardis::replay::run_tardis_machine_replay_from_config;

#[tokio::main]
async fn main() {
    vibe_common::logging::ensure_logging_initialized();

    let config_filepath = PathBuf::from("YOUR_CONFIG_FILEPATH");
    run_tardis_machine_replay_from_config(&config_filepath).await;
}
```

日志默认为 INFO 级别。要启用调试日志，请导出以下环境变量：

```bash
export VIBE_LOG=debug
```

可用的示例二进制程序位于 `crates/adapters/tardis/bin/example_replay.rs`。

也可以使用 cargo 运行：

```bash
cargo run --bin tardis-replay <path_to_your_config>
```

### 期权链回测目录

Tardis 重放将数据写入 Vibe 数据目录后，才能开始期权链回测。回测加载器不会在运行期间请求缺失的 Tardis 数据，因此目录必须包含：

- 来自 Tardis 金融工具元数据 API 的期权金融工具。
- 来自单档期权订单簿快照、报价数据或 `option_summary` BBO 提取结果的 `QuoteTick` 数据。
- 来自 Tardis `option_summary` 消息的 `OptionGreeks` 数据。

在 `BacktestDataConfig` 列表中，为相同的期权金融工具 ID 同时使用 `QuoteTick` 和 `OptionGreeks`。期权链管理器会将重放的 BBO 和希腊字母指标聚合为 `OptionChainSlice` 快照。设置 `snapshot_interval_ms=None` 可发布原始数据，或以毫秒为单位设置间隔以发布降采样快照。

策略可以使用相对于 ATM 或 ATM 百分比的行权价范围，按价内程度选择合约；也可使用 `StrikeRange.delta(target, tolerance)` 按 delta 选择，或使用 `StrikeRange.fixed([...])` 按固定行权价选择。回测中的期权订单撮合由报价驱动：可成交订单会作为 taker 与对手方 BBO 成交，而被动限价订单可在后续 BBO 更新穿过限价时作为 maker 成交。

请在模拟交易场所上使用 `CappedOptionFeeModel` 或 `TieredNotionalOptionFeeModel` 等结构化费用模型显式配置期权费用。Tardis 交易所不会自动映射到费用模型。

### 期权链 CSV 目录转换

对于可下载 Tardis CSV 文件中的历史期权链，请使用 `convert_tardis_options_chain_csv(...)` 将 `options_chain` 行转换为 Vibe 数据目录数据。该路径不会调用 Tardis Machine 或金融工具元数据 API，因此，如果已有 Tardis CSV 文件，或者希望使用下载的数据在没有 API 密钥的情况下引导数据目录，这种方式非常实用。

转换器会为每个选定行写入 `OptionGreeks`。默认启用 `extract_bbo_as_quotes=True`，最优买价/卖价字段完整的行还会写入 `QuoteTick`。期权链回测应保持启用此选项：仅含希腊字母指标的数据目录不提供报价，因此链管理器无法为缺少 BBO 数据的行权价发布已填充的 `OptionChainSlice` 快照。

金融工具派生目前支持 Deribit 期权。对于其他期权交易场所，请在转换前设置 `write_instruments=False`，并在回测前通过其他来源加载金融工具。对非 Deribit 文件保持启用可能会在数据文件已经写入目录后失败。请按时间顺序传入每日 `options_chain` CSV 路径。`underlyings` 筛选器匹配 `["BTC-"]` 等符号前缀。设置 `snapshot_interval_ms` 可在每个输入文件的每个间隔内保留每种金融工具的最后一行；使用 `None` 则写入每个选定行。进行降采样时，每个文件中的行必须按 `local_timestamp` 排序。

请显式提供 `price_precision` 和 `size_precision`，以生成确定性的报价元数据。随着读取后续行，推断出的精度可能提高，因此同一文件中先写入的数据可能保留较低精度的元数据。

```python
from pathlib import Path

from vibe_trader.adapters.tardis import convert_tardis_options_chain_csv


convert_tardis_options_chain_csv(
    filepaths=[Path("deribit_options_chain_2020-06-08.csv")],
    catalog_path=Path("catalog"),
    underlyings=["BTC-"],
    snapshot_interval_ms=60_000,
    price_precision=4,
    size_precision=1,
)
```

## 加载 Tardis CSV 数据

可以使用 Python 或 Rust 加载 Tardis 格式的 CSV 数据。加载器从磁盘读取 CSV 文本数据，并将其解析为 Vibe 数据。由于加载器使用 Rust 实现，因此无论从 Python 还是 Rust 运行，性能都保持一致。

还可以为 `load_*` 函数和方法指定 `limit` 参数，以控制加载的最大行数。

:::note
由于精度要求，加载包含多种金融工具的混合 CSV 文件较为困难，因此不建议这样做。请改用每个文件仅包含一种金融工具的 CSV 文件。

`load_options_chain`、`stream_options_chain` 和 `convert_options_chain_csv` 方法是例外：Tardis `options_chain` 文件本身就是包含多种金融工具的期权链文件，这些路径会按金融工具跟踪精度。仍建议显式指定精度，以获得确定性输出。
:::

### 在 Python 中加载 CSV 数据

可以使用模块级 `load_tardis_*` 函数在 Python 中加载 Tardis 格式的 CSV 数据。
加载数据时，可以选择指定金融工具 ID、价格精度和数量精度。提供金融工具 ID 可提高加载性能。省略价格和数量精度时，会从 CSV 推断；但为了获得确定性输出，尤其是在处理大型文件时，建议显式指定这些值。

要加载数据，请创建类似以下内容的脚本：

```python
from pathlib import Path

from vibe_trader.adapters.tardis import load_tardis_deltas
from vibe_trader.model import InstrumentId


instrument_id = InstrumentId.from_str("BTC-PERPETUAL.DERIBIT")
deltas = load_tardis_deltas(
    filepath=Path("YOUR_CSV_DATA_PATH"),
    price_precision=1,
    size_precision=0,
    instrument_id=instrument_id,
)
```

### 在 Rust 中加载 CSV 数据

可以使用 `crates/adapters/tardis/src/csv/mod.rs` 中的加载函数，在 Rust 中加载 Tardis 格式的 CSV 数据。加载数据时，可以选择指定金融工具 ID、价格精度和数量精度。提供金融工具 ID 可提高加载性能。省略价格和数量精度时，会从 CSV 推断；但为了获得确定性输出，建议显式指定这些值。

完整示例请参阅 `crates/adapters/tardis/bin/example_csv.rs`。

要加载数据，可以使用类似以下内容的代码：

```rust
use std::path::Path;

use vibe_adapters::tardis;
use vibe_model::identifiers::InstrumentId;

#[tokio::main]
async fn main() {
    // Optionally specify precisions and the CSV filepath
    let price_precision = Some(1);
    let size_precision = Some(0);
    let filepath = Path::new("YOUR_CSV_DATA_PATH");

    // Optionally specify an instrument ID and/or limit
    let instrument_id = InstrumentId::from("BTC-PERPETUAL.DERIBIT");
    let limit = None;

    // Consider propagating any parsing error depending on your workflow
    let _deltas = tardis::csv::load_deltas(
        filepath,
        price_precision,
        size_precision,
        Some(instrument_id),
        limit,
    )
    .unwrap();
}
```

## 流式处理 Tardis CSV 数据

为节省处理大型 CSV 文件时的内存，Tardis 集成可以按可配置的分块加载和处理数据，无需一次性将整个文件载入内存。这对于处理数 GB 的 CSV 文件而不耗尽系统内存尤其有用。

Python 为以下高吞吐量 CSV 类型提供流式处理功能：

- 订单簿增量（`stream_deltas`）。
- 报价 tick（`stream_quotes`）。
- 成交 tick（`stream_trades`）。
- 订单簿深度快照（`stream_depth10`）。
- 期权链行（`stream_options_chain`）。

Rust 也为这些 CSV 类型提供流式处理函数，此外还支持批量增量和资金费率。

### 在 Python 中流式处理 CSV 数据

模块级 `stream_tardis_*` 函数返回由有界分块组成的迭代器。每个函数都接受 `chunk_size` 参数，用于控制每个分块读取的记录数：

```python
from pathlib import Path

from vibe_trader.adapters.tardis import stream_tardis_trades
from vibe_trader.model import InstrumentId

instrument_id = InstrumentId.from_str("BTC-PERPETUAL.DERIBIT")
filepath = Path("large_trades_file.csv")

trades = stream_tardis_trades(
    filepath=filepath,
    chunk_size=100_000,
    price_precision=1,
    size_precision=0,
    instrument_id=instrument_id,
)

# Stream trade ticks in chunks
for chunk in trades:
    print(f"Processing chunk with {len(chunk)} trades")
    # Process each chunk - only this chunk is in memory
    for trade in chunk:
        # Your processing logic here
        pass
```

### 流式处理订单簿数据

订单簿数据的增量和深度快照均可流式处理：

```python
from vibe_trader.adapters.tardis import stream_tardis_deltas
from vibe_trader.adapters.tardis import stream_tardis_depth10_from_snapshot5


# Stream order book deltas
for chunk in stream_tardis_deltas(filepath):
    print(f"Processing {len(chunk)} deltas")
    # Process delta chunk

# Stream depth10 snapshots from snapshot_5 files
for chunk in stream_tardis_depth10_from_snapshot5(filepath):
    print(f"Processing {len(chunk)} depth snapshots")
    # Process depth chunk
```

### 流式处理报价数据

报价数据可以采用相同方式流式处理：

```python
from vibe_trader.adapters.tardis import stream_tardis_quotes


# Stream quote ticks
for chunk in stream_tardis_quotes(filepath):
    print(f"Processing {len(chunk)} quotes")
    # Process quote chunk
```

### 内存效率优势

流式处理方式具有显著的内存效率优势：

- **可控的内存用量**：内存中每次只加载一个分块。
- **可扩展处理**：可以处理大于可用 RAM 的文件。
- **可配置分块大小**：根据系统内存和性能要求调整 `chunk_size`（默认值为 100,000）。

:::warning
使用流式处理并推断精度时，推断结果可能不同于一次性加载整个文件。精度推断仅在分块边界内进行，不同分块可能包含精度要求不同的值。为获得确定性的精度行为，请显式提供 `price_precision` 和 `size_precision` 参数。
:::

### 在 Rust 中流式处理 CSV 数据

底层流式处理功能使用 Rust 实现，可以直接调用：

```rust
use std::path::Path;

use vibe_adapters::tardis::csv::stream_trades;
use vibe_model::identifiers::InstrumentId;

#[tokio::main]
async fn main() {
    let filepath = Path::new("large_trades_file.csv");
    let chunk_size = 100_000;
    let price_precision = Some(1);
    let size_precision = Some(0);
    let instrument_id = Some(InstrumentId::from("BTC-PERPETUAL.DERIBIT"));

    // Stream trades in chunks
    let stream = stream_trades(
        filepath,
        chunk_size,
        price_precision,
        size_precision,
        instrument_id,
    ).unwrap();

    for chunk_result in stream {
        match chunk_result {
            Ok(chunk) => {
                println!("Processing chunk with {} trades", chunk.len());
                // Process chunk
            }
            Err(e) => {
                eprintln!("Error processing chunk: {}", e);
                break;
            }
        }
    }
}
```

## 请求金融工具定义

可以使用 `TardisHttpClient`，从 Python 和 Rust 请求金融工具定义。
该客户端与 [Tardis 金融工具元数据 API](https://docs.tardis.dev/api/instruments-metadata-api) 交互，请求金融工具元数据并将其解析为 Vibe 金融工具。

`TardisHttpClient` 构造函数接受可选的 `api_key`、`base_url`、
`timeout_secs`、`normalize_symbols` 和 `proxy_url` 参数。

该客户端提供方法，用于检索特定 `instrument`，或某个交易所可用的全部 `instruments`。
请使用 `binance-futures` 等 Tardis 小写 kebab-case 交易所 ID。

:::note
需要具有金融工具元数据 API 访问权限的 `TARDIS_API_KEY`。
:::

### 在 Python 中请求金融工具

要在 Python 中请求金融工具定义，请创建类似以下内容的脚本：

```python
import asyncio

from vibe_trader.adapters.tardis import TardisHttpClient


async def run():
    http_client = TardisHttpClient()

    instrument = await http_client.instruments("bitmex", symbol="xbtusd")
    print(f"Received: {instrument}")

    instruments = await http_client.instruments("bitmex")
    print(f"Received: {len(instruments)} instruments")


if __name__ == "__main__":
    asyncio.run(run())
```

### 在 Rust 中请求金融工具

要在 Rust 中请求金融工具定义，请使用类似以下内容的代码。
完整示例请参阅 `crates/adapters/tardis/bin/example_http.rs`。

```rust
use vibe_tardis::{
    enums::TardisExchange,
    http::client::TardisHttpClient,
};

#[tokio::main]
async fn main() {
    vibe_common::logging::ensure_logging_initialized();

    let client = TardisHttpClient::new(None, None, None, true, None).unwrap();

    // Tardis instrument definitions
    let resp = client
        .instruments_info(TardisExchange::Bitmex, Some("XBTUSD"), None)
        .await;
    println!("Received: {resp:?}");

    // Vibe instrument definitions
    let resp = client
        .instruments(
            TardisExchange::Bitmex,
            Some("XBTUSD"),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await;
    println!("Received: {resp:?}");
}
```

## 金融工具提供程序

`TardisInstrumentProvider` 通过 HTTP 金融工具元数据 API 从 Tardis 请求并解析金融工具定义。
由于存在多个 [Tardis 支持的交易所](#交易场所)，加载所有金融工具时，必须使用 `InstrumentProviderConfig` 筛选所需交易场所：

```python
from vibe_trader.config import InstrumentProviderConfig

# See supported venues https://github.com/qOeOp/trade/blob/main/docs/integrations/tardis.md#venues
venues = {"BINANCE", "BYBIT"}
filters = {"venues": frozenset(venues)}
instrument_provider_config = InstrumentProviderConfig(load_all=True, filters=filters)
```

也可以按常规方式加载特定金融工具定义：

```python
from vibe_trader.config import InstrumentProviderConfig

instrument_ids = [
    InstrumentId.from_str("BTCUSDT-PERP.BINANCE"),  # Uses the 'binance-futures' exchange
    InstrumentId.from_str("BTCUSDT.BINANCE"),  # Uses the 'binance' exchange
]
instrument_provider_config = InstrumentProviderConfig(load_ids=instrument_ids)
```

### 期权交易所筛选

如果未提供 `instrument_type` 筛选器，或其中不包含 `"option"`，金融工具提供程序会滤除 `binance-options`、`binance-european-options`、`bybit-options`、`okex-options` 和 `huobi-dm-options` 等期权专用交易所。

要显式加载期权金融工具，请在 `instrument_type` 筛选器中包含 `"option"`：

```python
from vibe_trader.config import InstrumentProviderConfig

venues = {"BINANCE", "BYBIT"}
filters = {
    "venues": frozenset(venues),
    "instrument_type": {"option"},  # Explicitly request options
}
instrument_provider_config = InstrumentProviderConfig(load_all=True, filters=filters)
```

这种筛选可以避免在不需要期权交易所时发起多余的 API 调用。

:::note
所有订阅使用的金融工具都必须已存在于缓存中。
为简化配置，建议加载计划订阅的交易场所中的所有金融工具。
:::

## 实盘数据客户端

`TardisDataClient` 将 Tardis Machine 与正在运行的 VibeTrader 系统集成。
Python 实盘数据客户端会将标准订阅转换为以下 Tardis Machine 数据流：

- `OrderBookDelta`（来自 Tardis 的 L2 粒度，包括增量或全深度快照）
- `QuoteTick`
- `TradeTick`
- `Bar`（采用 [Tardis 支持的 K 线聚合方式](#k-线)的交易 K 线）
- `FundingRateUpdate`（来自 derivative_ticker 消息）

当 `book_snapshot_output` 为 `depth10` 时，配置的 Tardis Machine 重放/流式选项还可以发出 `OrderBookDepth10`。Tardis Machine 重放路径和数据目录写入器支持来自 `option_summary` 的 `OptionGreeks`。设置 `extract_bbo_as_quotes` 还可以从这些 `option_summary` 消息的最优买价/卖价字段发出 `QuoteTick`。

### 数据 WebSocket

主 `TardisMachineClient` 数据 WebSocket 会管理初始连接阶段收到的所有流订阅，该阶段最长持续 `ws_connection_delay_secs` 指定的时间。此后如果出现其他订阅，则会创建新的 `TardisMachineClient`。这样，主 WebSocket 可以在单个数据流中处理大量启动时订阅。

使用 `ws_connection_delay_secs` 设置初始订阅延迟时，由于 Tardis 不支持选择性取消订阅，取消其中任一数据流不会从 Tardis Machine 数据流移除相应订阅。该组件仍会停止向消息总线发布数据。

初始延迟结束后创建的所有订阅均按常规方式运行；取消订阅时，会完全从 Tardis Machine 数据流中取消。

:::tip
如果预计会频繁订阅和取消订阅数据，请将 `ws_connection_delay_secs` 设置为零。这样会为每个初始订阅创建一个新客户端，使其在取消订阅时可以单独关闭。
:::

## 交易 ID 派生

交易 tick 使用 Tardis 消息或 CSV 行中交易场所提供的交易 ID 作为 `TradeId`。当交易场所省略交易 ID（某些交易所会提供空字符串或 null）时，WebSocket 解析器和 CSV 解析器都会回退到基于符号、时间戳、价格、数量和方向计算的确定性 FNV-1a 哈希。同一交易场所事件在不同重放中会生成相同的交易 ID，从而保持下游去重有效。

## 限制与注意事项

目前已知以下限制和注意事项：

- `TardisDataClient` 不支持历史报价和交易请求。外部历史 `Bar` 请求使用 Tardis Machine 重放，并要求基于日期的重放窗口。对于数据目录工作流，建议使用 `run_tardis_machine_replay`。

## 贡献

:::info
如需添加功能或为 Tardis 适配器做贡献，请参阅我们的[贡献指南](https://github.com/qOeOp/trade/blob/main/CONTRIBUTING.md)。
:::
