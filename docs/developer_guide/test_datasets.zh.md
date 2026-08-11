# 测试数据集

本文定义用于测试 fixture 的外部数据集在整理、存储和使用方面的目标标准。
新数据集应遵循这些标准。早于本策略的现有数据集记录在[旧版数据集](#旧版数据集)中。

## 数据集类别

**小型数据**（< 1 MB）与 `metadata.json` 文件一起直接提交到 `test_data/<source>/`。
无需网络访问即可始终使用这些文件。

**大型数据**（> 1 MB）以 Parquet 格式托管在 R2 测试数据 bucket 中。
SHA-256 校验和记录在 `test_data/large/checksums.json` 中。
`ensure_test_data_exists()` 辅助函数会在首次使用时下载文件并验证完整性。

当供应商许可证、授权模型或访问控制不允许 VibeTrader 通过公共仓库或公共 R2 bucket 重新分发数据时，
使用**用户自行获取的数据**。在这种模式下，仓库只存储清单、获取说明和转换代码。每位用户使用自己的
供应商账户下载源数据，并在本地转换。

出现以下任一情况时使用用户自行获取模式：

- 供应商要求每位用户拥有自己的账户、API key 或历史数据许可证。
- 许可证允许内部使用，但未明确允许重新分发派生 fixture。
- 数据集适合示例或选择性集成测试，但不适合默认 CI。

## 必需元数据

每个存储或重新分发具体制品的已整理数据集至少必须包含一个具备以下字段的 `metadata.json`：

| 字段           | 描述                             |
| -------------- | -------------------------------- |
| `file`         | 数据集文件名。                   |
| `sha256`       | 文件的 SHA-256 哈希。            |
| `size_bytes`   | 文件大小（字节）。               |
| `original_url` | 原始源数据的下载 URL。           |
| `licence`      | 许可证条款和所有重新分发限制。   |
| `added_at`     | 整理数据集时的 ISO 8601 时间戳。 |

这些字段与 `scripts/curate-dataset.sh` 的输出一致。建议增加以下字段以提供更丰富的来源记录：

| 字段            | 描述                                             |
| --------------- | ------------------------------------------------ |
| `instrument`    | 所涵盖的交易工具代码。                           |
| `date`          | 所涵盖的交易日期。                               |
| `format`        | 存储格式（例如 "Vibe OrderBookDelta Parquet"）。 |
| `original_file` | 转换前的供应商原始文件名。                       |
| `parser`        | 转换所用的解析器（例如 "itchy 0.3.4"）。         |

用户自行获取的数据集在适用时使用相同元数据字段，还应包含：

| 字段                | 描述                                            |
| ------------------- | ----------------------------------------------- |
| `distribution`      | 必须为 `"user-fetch"`。                         |
| `fetch_method`      | 用户获取源数据的方式（API、Web 门户、CLI 等）。 |
| `fetch_reference`   | 面向用户的下载流程 URL 或文档引用。             |
| `auth`              | 所需凭证或授权（如有）。                        |
| `transform_version` | 生成最终文件的本地转换流水线版本。              |
| `redistribution`    | 描述数据集重新分发限制的简短说明。              |
| `public_mirror`     | 对受限供应商数据集必须为 `false`。              |

对于没有单一已提交或镜像制品的用户自行获取数据集，可以从 `metadata.json` 省略 `file`、`sha256` 和
`size_bytes`。此时，`manifest.json` 中的 `target_files` 是本地输出文件的权威定义。
对于用户自行获取的数据集，当具体文件按用户账户或每次请求生成时，`original_url` 可以指向供应商下载
入口，而不是确切文件 URL。

其他元数据字段在适用时仍建议提供。尤其是用户自行获取的数据集仍应记录 `licence` 和 `added_at`。

## 存储格式

新数据集应存储为 **Vibe Parquet**（而非供应商原始格式）。这样可以确保：

- 所有测试数据集的数据类型一致。
- 测试期间无需解析供应商格式。
- 许可证所需的派生作品状态清晰。

使用 ZSTD 压缩（级别 3）和 1M 行组。

用户自行获取的数据集完成本地转换后也应成为 Vibe Parquet。供应商原始文件应留在仓库和公共 R2 bucket
之外。

## 命名约定

```
<source>_<instrument>_<date>_<datatype>.parquet
```

示例：

- `itch_AAPL_2019-01-30_deltas.parquet`
- `tardis_BTCUSDT_2020-09-01_depth10.parquet`
- `histdata_EURUSD.SIM_2020-01_quotes.parquet`

## 整理工作流

### 简单文件（单次下载）

使用 `scripts/curate-dataset.sh`：

```bash
scripts/curate-dataset.sh <slug> <filename> <download-url> <licence>
```

该脚本会创建版本化目录（`v1/<slug>/`），其中包含文件、`LICENSE.txt` 和具备上述必需字段的
`metadata.json`。

### 复杂流水线（解析 + 转换）

对于需要格式转换的数据集（例如从二进制 ITCH 转换为 Parquet）：

1. 在 `crates/testkit/src/<source>/` 中编写整理函数，并使用 `#[cfg(test)]` gate 或 `#[ignore]` 测试。
2. 函数应完成：下载、解析、筛选、转换为 VibeTrader 类型、写入 Parquet。
3. 将 Parquet 文件和 `metadata.json` 输出到本地目录。
4. 手动上传到 R2，再将校验和加入 `checksums.json`。

### 用户自行获取流水线（限制重新分发）

对于 VibeTrader 无法重新分发的数据集：

1. 提交清单和 `metadata.json`，但不要提交真实供应商数据或派生的 Parquet 输出。
2. 提供使用用户自己的供应商凭证、授权或已购买历史文件的本地获取命令或辅助工具。
3. 在本地把供应商数据转换为 Vibe Parquet。
4. 将生成文件存储到由 git 忽略的本地缓存路径。
5. 测试和示例必须选择性启用；缺少数据集时应干净地跳过。

新数据集的默认分发优先级是：

1. 提交到仓库的小型数据。
2. 公共 R2 大型数据。
3. 用户自行获取的数据。

只有当前两种方案不符合供应商条款时，才选择用户自行获取。

禁止：

- 将受限供应商数据集上传到公共 R2 bucket。
- 在重新分发权利不明确时，将真实供应商派生的 Parquet 文件提交到仓库。
- 让默认 CI 依赖供应商凭证或付费历史数据访问。

许可证允许内部共享时，可以为内部 CI 或员工维护私有镜像。应将其视为独立的运维路径，
而不是公共测试数据标准的一部分。

## 添加新数据集

1. 按照上述工作流整理数据。
2. 编写包含所有必需字段的 `metadata.json`。
3. 对于小型数据：提交到 `test_data/<source>/`。
4. 对于大型数据：把 Parquet 上传到 R2，并把校验和加入 `test_data/large/checksums.json`。
5. 对于用户自行获取的数据：只提交清单和获取说明，源数据和派生数据都不得进入仓库或公共 R2 bucket。
6. 需要共享 testkit 访问时，向 `crates/testkit/src/common.rs` 添加路径辅助函数。
7. 编写使用该数据集的测试。

对于用户自行获取的数据，优先使用以下布局：

```text
test_data/<source>/<slug>/
  metadata.json
  manifest.json
  README.md
```

使用 `test_data/local/<source>/<slug>/` 作为生成制品的标准本地缓存路径。
需要在本地保留供应商原始下载时，应放在同一缓存路径下的同级 `vendor/` 目录中。

清单应当机器可读且稳定，并包含在另一台机器上复现获取和转换步骤所需的最少信息。

`metadata.json` 是来源、许可证和重新分发规则的权威定义。
`manifest.json` 是获取输入、命令、缓存位置和输出文件的权威定义。

建议的清单字段：

| 字段                | 描述                                               |
| ------------------- | -------------------------------------------------- |
| `slug`              | 稳定的数据集标识符。                               |
| `vendor`            | 供应商或场所名称。                                 |
| `source_type`       | `api`、`portal-download`、`purchased-archive` 等。 |
| `source_filters`    | 代码、事件 ID、市场 ID、日期范围或文件名。         |
| `target_files`      | 转换后预期生成的 Vibe Parquet 文件。               |
| `cache_dir`         | 相对于 `test_data/local/` 的本地输出位置。         |
| `fetch_command`     | 建议的命令或脚本入口。                             |
| `transform_command` | 建议的本地转换命令。                               |
| `env`               | 必需的环境变量。                                   |
| `notes`             | 面向用户的简短运维说明。                           |

依赖用户自行获取数据的测试应当：

- 与默认 CI 测试分开标记或分组。
- 本地数据集不存在时，以明确消息跳过。
- 除非用户明确选择启用，否则避免网络访问。
- 复用稳定的本地缓存路径，使每台机器只需获取一次。

对于基于 pytest 的测试，优先使用如下 guard：

```python
if not filepath.exists():
    pytest.skip(f"User-fetched test data not found: {filepath}")
```

对于需要手动准备数据集的 Rust 测试，如果测试不应在默认 CI 中运行，优先使用 `#[ignore]`。

## 测试运行器串行化

下载大型数据文件的测试会在不同测试二进制文件之间共享目标路径。由于 `nextest` 会在独立进程中运行
每个二进制文件，同时下载到同一路径可能发生竞争。`.config/nextest.toml` 中的 nextest 配置定义了
一个 `large-data-tests` 组，并设置 `max-threads = 1` 来串行运行这些二进制文件。

添加会下载大型共享文件的新测试二进制文件时，将它加入组筛选器：

```toml
[[profile.default.overrides]]
filter = 'binary(grid_mm_itch) | binary(orderbook_integration) | binary(your_new_binary)'
test-group = 'large-data-tests'
```

## 重新生成数据集

当 schema 变更导致大型 Parquet 文件失效时，应通过下面的整理测试从原始源数据重新生成。
重新生成后：

1. `sha256sum /tmp/<output_file>.parquet`
2. 使用新哈希更新 `test_data/large/checksums.json`。
3. 更新相应的 `metadata.json`（sha256、size_bytes）。
4. 将 Parquet 文件上传到 R2。
5. 提交 `checksums.json` 和 `metadata.json`（这也会使 CI 缓存失效）。

### ITCH AAPL L3 增量

来源：NASDAQ EMI 提供的 `01302019.NASDAQ_ITCH50.gz`（约 4.4 GB）。

```bash
# Download source (keep a local copy, this is a large file)
wget -O ~/Downloads/01302019.NASDAQ_ITCH50.gz \
  "https://emi.nasdaq.com/ITCH/Nasdaq%20ITCH/01302019.NASDAQ_ITCH50.gz"

# Curation test expects source at /tmp
ln -sf ~/Downloads/01302019.NASDAQ_ITCH50.gz /tmp/01302019.NASDAQ_ITCH50.gz

# Regenerate parquet (output: /tmp/itch_AAPL.XNAS_2019-01-30_deltas.parquet)
cargo test -p vibe-testkit --lib test_curate_aapl_itch -- --ignored --nocapture
```

### Tardis Deribit BTC-PERPETUAL L2 增量

来源： [Tardis](https://tardis.dev/) 提供的
`tardis_deribit_incremental_book_L2_2020-04-01_BTC-PERPETUAL.csv.gz`。
每月首日数据可作为免费样本获取（无需 API key）。

```bash
# Download source (free sample, no API key needed)
wget -O test_data/large/tardis_deribit_incremental_book_L2_2020-04-01_BTC-PERPETUAL.csv.gz \
  "https://datasets.tardis.dev/v1/deribit/incremental_book_L2/2020/04/01/BTC-PERPETUAL.csv.gz"

# Regenerate parquet (output: /tmp/tardis_BTC-PERPETUAL.DERIBIT_2020-04-01_deltas.parquet)
cargo test -p vibe-tardis test_curate_deribit_deltas -- --ignored --nocapture
```

## 教程测试数据

多个教程和指南会加载用户提供的市场数据。`VIBE_DATA_DIR` 环境变量可以覆盖其基础数据路径。
应使用 `test_data/local/` 作为仓库内被忽略的文件位置。

### 目录布局

```text
test_data/local/
  Binance/
    BTCUSDT_T_DEPTH_2022-11-01_depth_snap.csv
    BTCUSDT_T_DEPTH_2022-11-01_depth_update.csv
  Bybit/
    2024-12-01_XRPUSDT_ob500.data.zip
  HISTDATA/
    DAT_ASCII_EURUSD_T_202001.csv.gz
```

`test_data/local/` 目录已被 gitignore。缺少预期文件时，教程脚本会输出数据缺失消息并停止。

### 获取数据

**Binance 深度快照**可从 [Binance 公共数据门户](https://data.binance.vision/)获取。
下载 2022-11-01 的 BTCUSDT T_DEPTH 文件，并将 snap 和 update CSV 放在
`test_data/local/Binance/` 下。测试时使用一部分行（例如前 10,000 行）即可。

**Bybit ob500 订单簿数据**可从 Bybit CDN 获取：

```bash
curl -L "https://quote-saver.bycsi.com/orderbook/linear/XRPUSDT/2024-12-01_XRPUSDT_ob500.data.zip" \
  -o test_data/local/Bybit/2024-12-01_XRPUSDT_ob500.data.zip
```

完整文件约 360 MB。测试时可提取前几百行并重新打包为较小的 zip。

**HISTDATA tick 数据**可从 [histdata.com](https://www.histdata.com/) 获取。
下载任意月份的 EUR/USD ASCII tick 数据，并将 CSV（或 `.csv.gz`）放在
`test_data/local/HISTDATA/` 下。

### 运行教程

构建 V2 Python 包，然后从仓库根目录运行源教程：

```bash
make build-debug
UV_PROJECT_ENVIRONMENT="$PWD/.venv" \
  VIBE_DATA_DIR="$PWD/test_data/local" \
  uv run --project python --no-sync python docs/tutorials/backtest_orderbook_binance.py
UV_PROJECT_ENVIRONMENT="$PWD/.venv" \
  VIBE_DATA_DIR="$PWD/test_data/local" \
  uv run --project python --no-sync python docs/tutorials/backtest_orderbook_bybit.py
```

## 旧版数据集

这些数据集早于本策略，使用供应商原始格式（CSV/CSV.gz），且没有 `metadata.json`。
它们对现有测试仍然有效。新数据集应遵循上述 Parquet 标准。

| 数据集                   | 来源     | 格式            | 位置                | 状态   |
| ------------------------ | -------- | --------------- | ------------------- | ------ |
| Tardis Deribit L2 增量   | Tardis   | Parquet（大型） | `test_data/large/`  | 已整理 |
| ITCH AAPL L3 增量        | NASDAQ   | Parquet（大型） | `test_data/large/`  | 已整理 |
| HISTDATA EURUSD.SIM 报价 | HISTDATA | Parquet（大型） | `test_data/large/`  | 已迁移 |
| Tardis Deribit L2        | Tardis   | CSV（已提交）   | `test_data/tardis/` | 旧版   |
| Tardis Binance 快照      | Tardis   | CSV.gz（大型）  | `test_data/large/`  | 旧版   |
| Tardis Bitmex 成交       | Tardis   | CSV.gz（大型）  | `test_data/large/`  | 旧版   |

上面的 HISTDATA EURUSD.SIM Parquet 文件替代了原来的外部 catalog 布局。
HISTDATA 原始 CSV 文件仍由用户自行获取。

未提交到 Git 的大型 fixture 需要 `VIBE_TEST_DATA_BASE_URL`。该值必须标识已配置的 fixture 主机根目录；
testkit 会附加 `/large/<filename>`，并根据 `test_data/large/checksums.json` 验证下载。
系统未内嵌任何默认外部主机。
