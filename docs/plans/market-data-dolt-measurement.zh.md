# 市场数据进 Dolt：WS8a 实测报告（2026-10-11）

来源：[rd-round-audit-refactor-plan.zh.md](rd-round-audit-refactor-plan.zh.md) 的 WS8 节和第 1 节（"持久数据只存 Dolt"）。这是一次测量，不改产品代码；数据只写会话临时目录里的隔离 Dolt 实例，没有连 `127.0.0.1:13326` 或任何现有账本，也没有写 `~/.local/share/trade/`。

## 0. 结论

五道建议门槛全部达标，建议进入 WS8b。推荐方案如下：

- **表设计用 B：按合约精度缩放的 BIGINT。** 它比 DECIMAL 方案小 14%，导入快 14%，导出查询快 1.6–2.1 倍，客户端内存约为一半。
- **只存 1m 的 LAST 和 MARK**，再加 funding 和 instruments 两张表；5m 及更高周期在导出时派生。派生要按下面第 3 节的规则做：开、高、低三项跳过 0 成交的分钟。按这条规则，1m 聚合结果与币安原生 5m/1h/1d 在 840 万根上**完全一致**。从 Dolt 的 1m 派生出的 5m Catalog，也与现有 Catalog 逐字节一致。
- **导出走 sql-server 加流式客户端**（pymysql `SSCursor`，按合约并行）。不要用 `dolt sql` CLI 作远程客户端。

| 门槛（建议值） | 实测（推荐配置） | 判定 |
|---|---|---|
| Dolt 体积（gc 后）≤ 同数据 Parquet 的 3 倍 | 1m+5m：1,090MB。同数据 Nautilus Catalog 1,948MB，为其 0.56 倍；普通 Parquet zstd 661MB，为其 1.65 倍 | 达标 |
| 一年 37 币 1m（LAST+MARK）首次全量导入 ≤ 30 分钟 | 只存 1m：Dolt 导入 271 秒。1m+5m 一起：预处理 68 秒 + 导入 333 秒，共 6.7 分钟 | 达标 |
| 追加一个月 ≤ 3 分钟 | 26 秒（另有预处理 3 秒）；gc 后体积增长 98MB | 达标 |
| 导出 5m Catalog ≤ 2 分钟 | 服务路径 6.9 秒；从 1m 派生 19.8 秒；CLI 路径 39 秒 | 达标 |
| 导出 1m Catalog ≤ 10 分钟 | 服务路径 26 秒；CLI 路径 120 秒 | 达标 |
| 导入、导出峰值内存都 ≤ 16GB | 导入：Dolt 1.14GB，预处理 1.19GB。导出 1m：客户端进程树 5.1GB，服务端 2.1GB | 达标；但第一版导出器开 16 进程、不分块，峰值 19.5GB，不达标，见第 7 节 |
| 重叠窗口逐根一致，或每处差异都能解释 | 5m LAST/MARK 各 3,893,214 根、funding 42,779 条，**零差异**；合约条款和 bar 元数据相同 | 达标 |

MB 都按 2²⁰ 字节计。

## 1. 数据与环境

- **窗口**：与现有 Catalog `r1-37-1y-5m-2026oct7` 的输入窗口相同，即 `[2025-10-07T00:00Z, 2026-10-07T08:30Z)`。这个窗口本身包含运行器 `trade_start` 之前的预热部分。`--daily-warmup` 用的日线 Catalog 是另一份数据，**不在本次范围内**（见第 8 节）。
- **币种**：`full-37.json` 的 `coins`，共 37 个。PEPE 和 SHIB 在币安的合约是 `1000PEPEUSDT` 和 `1000SHIBUSDT`。
- **来源**：只用币安公开数据。
  - data.binance.vision 的 USD-M 永续归档：klines（LAST）和 markPriceKlines（MARK）各取 1m、5m，取 2025-10 至 2026-09 的月归档，加 2026-10-01 至 07 的日归档；fundingRate 取月归档。
  - 追加测试用 2025-09 的月归档。
  - 比较用的原生 1h、1d 月归档。
  - 2026-10 的 funding 用公开 REST `/fapi/v1/fundingRate`：fundingRate 没有日归档，日归档 URL 返回 404。
  - 合约条款用公开 REST `exchangeInfo`（2026-10-11 快照）。
- **校验**：共 5,365 个 zip，每个都用对应的 `.CHECKSUM` 做 SHA-256 校验，**全部通过**。主批 3,441 个文件（1.4GB）下载用时 73 秒（24 并发）。
- **行数**：
  - bars 46,718,568 行：37 币 × (1m 526,110 + 5m 105,222) × LAST/MARK。
  - funding 42,779 行：35 币 8 小时一期，各 1,097 条；IMX 和 TIA 4 小时一期，各 2,192 条。
- **环境**：
  - Dolt 2.4.2（`~/.local/share/trade/ledger-probe/dolt-20261009/...`），用 `DOLT_ROOT_PATH` 把配置隔离到临时目录。sql-server 端口 13400，测完已关。
  - Nautilus 用 `uv.lock` 钉住的 2.0.0rc3。
  - 本机 128GB 内存、16 核。机器上同时有用户自己的账本服务和其他会话在运行，这些计时没有做隔离。

## 2. 表设计

```sql
CREATE TABLE bars (
  instrument VARCHAR(40) NOT NULL,                 -- 例：BTCUSDT-PERP.BINANCE
  price_type ENUM('LAST','MARK') NOT NULL,
  timeframe  ENUM('1m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','1w') NOT NULL,
  ts_open    BIGINT NOT NULL,                      -- 币安 open_time，UTC 毫秒
  open BIGINT NOT NULL, high BIGINT NOT NULL, low BIGINT NOT NULL, close BIGINT NOT NULL,
  volume BIGINT NOT NULL,                          -- 方案 A：价格 DECIMAL(20,8)、量 DECIMAL(24,8)
  PRIMARY KEY (instrument, price_type, timeframe, ts_open));
CREATE TABLE funding (
  instrument VARCHAR(40) NOT NULL, funding_time BIGINT NOT NULL,  -- 实际结算毫秒，带交易所的毫秒抖动
  rate DECIMAL(20,10) NOT NULL, interval_hours TINYINT,
  PRIMARY KEY (instrument, funding_time));
CREATE TABLE instruments (
  instrument VARCHAR(40) NOT NULL, valid_from BIGINT NOT NULL,     -- 条款按生效时间分版本
  raw_symbol, base/quote/settlement_currency,
  price_precision, size_precision, mark_precision TINYINT,         -- MARK 归档是 8 位小数
  price_increment, size_increment, min/max_quantity, min_notional, min/max_price,
  margin_init, margin_maint, maker_fee, taker_fee,                 -- 后四项 exchangeInfo 没有，沿用旧 Catalog 的假设值
  PRIMARY KEY (instrument, valid_from));
```

- **方案 B 的缩放**：LAST 价格乘 10^`price_precision`，MARK 价格乘 10^`mark_precision`（8），量乘 10^`size_precision`。预处理用 Arrow 的 `decimal128` 安全转换，任何一位会丢失就报错。全量数据没有一处丢位。
- **到 Nautilus 的转换**：Nautilus 高精度模式的 Price/Quantity raw 等于"值 × 10¹⁶"，Parquet 里存成 16 字节小端整数。Arrow `decimal128(38,16)` 的存储正好是同一组字节，所以两种方案都是先转成 `decimal128(38,16)`，再按 `fixed_size_binary(16)` 重解释。转换结果交给 Nautilus 自己的 `BarDataWrangler.process_record_batch_bytes` 解码，再用 `ParquetDataCatalog.write_bars` 写出。
- **不存的列**：币安 kline 的 quote_volume、成交笔数和主动买量都没有存。Nautilus Bar 用不到它们，派生也只需要 `volume > 0`（见第 3 节）。以后要加，先按 AGENTS.md 做存储字段评审。

| | A：DECIMAL | B：缩放 BIGINT |
|---|---|---|
| 全量导入（1m+5m，`dolt table import -u`） | 385 秒（导入时同机在生成参照 Parquet，有 CPU 争用） | 333 秒 |
| 导入峰值内存（Dolt） | 1.13GB | 1.14GB |
| gc 前 / gc 后 | 1,864MB / 1,266MB | 1,586MB / 1,090MB |
| 追加一个月：耗时，gc 后增长 | 29.9 秒，+114MB | 25.9 秒，+98MB |
| 导出 1m，CLI：总计（其中查询） | 232 秒（207） | 120 秒（97） |
| 导出 1m，服务路径：总计，客户端 / 服务端峰值 | 45 秒，9.3 / 3.1GB | 26 秒，5.1 / 2.1GB |

选 B 的理由：

- 所有数字都更好。
- 精度由 instruments 表显式给出，和 Nautilus 的 precision 元数据一一对应。
- DECIMAL 在客户端会变成 Python `Decimal` 对象，内存翻倍。

B 的代价是：直接读表的人要乘回精度。这可以由导出器和一个只读视图承担。

## 3. 只存 1m，还是各周期都存

用户 10-05 要求先比较"1m 聚合"和"交易所原生 bar"是否一致。比较范围是 2025-10 至 2026-09 的整月，37 币，LAST 和 MARK 都比，用精确小数比较：

| 原生周期 | 比较根数（LAST / MARK） | 朴素聚合不一致（LAST） | 按规则聚合不一致 |
|---|---|---|---|
| 5m | 3,889,440 / 3,889,440 | 1,063 根（0.027%）：开盘价 1,063 根，高 159 根，低 135 根 | 0 / 0 |
| 1h | 324,120 / 323,232 | 8 根（0.0025%）：开 8，高 1，低 1 | 0 / 0 |
| 1d | 13,505 / 13,468 | 0 | 0 / 0 |

朴素聚合指：开 = 第一根 1m 的开，高 = 最高，低 = 最低，收 = 最后一根的收，量 = 求和。MARK 在朴素聚合下也全部一致。MARK 1h/1d 少比的 888 根和 37 根，是 2026-06-29 那一天，原因见第 7 节。

- **原因**：没有成交的分钟，币安在 1m 归档里填成"开 = 高 = 低 = 收 = 前一根收盘价，量 0，笔数 0"。原生的更高周期 bar 不看这种填充分钟：开盘价是区间内第一笔真实成交，高低价也只算有成交的分钟。例：ALGOUSDT 2025-10-26 21:10 这根 5m，第一分钟无成交，被填成 0.1878；原生 5m 的开盘价是第二分钟的第一笔成交 0.1877。收盘价和量从来没有不一致过。
- **规则**：开 = 第一根有成交的 1m 的开；高、低只在有成交的 1m 里取；整段都没有成交时，退回全部 1m。收 = 最后一根的收；量 = 求和。
- **成交笔数可以省掉**：在已下载的全部 LAST 1m 归档里（2,147 万行，含 2025-09 和重复下载的 06-29），"笔数 = 0"与"量 = 0"完全等价。两者同时为 0 的有 13,610 行，只有一方为 0 的有 0 行。所以只用 `volume > 0` 就够了。
- **端到端验证**：导出器从 Dolt 读窗口 commit 的 1m，按上面的规则派生 5m，写成 Catalog。结果与现有 Catalog 逐字节一致。另外，导出的 1m Catalog 按同一规则聚合后，与导出的 5m Catalog 7,786,428 根全部相同。
- **体积**：只存 1m 时，gc 后 898MB；1m+5m 是 1,090MB。如果全部周期都存原生 bar，行数比只存 1m 多约 34%，其中 5m 占 20 个百分点。

建议只存 1m，导出时派生。好处是数据源只有一个，不需要维护多套周期之间的一致性。代价是派生规则成了承重代码，WS8b 要用原生归档做回归测试。1w（周一 00:00 UTC 对齐）和 15m/30m/2h/4h/6h/8h/12h 本次没有测，WS8b 实现时要补比较。

## 4. 数字

### 4.1 导入（B，全新库）

| 步骤 | 耗时 | 峰值 RSS |
|---|---|---|
| 下载（主批 3,441 个文件，24 并发） | 73 秒 | — |
| 预处理（解压、拼接、补缺日、校验连续性，写两种方案的 CSV） | 68.3 秒 | 1.19GB |
| `dolt table import -u bars`（46,718,568 行） | 332.9 秒（约 14 万行/秒） | 1.14GB |
| instruments + funding 导入 | 0.3 秒 | 0.13GB |
| `dolt add` + `dolt commit` | 0.35 秒 | 0.30GB |
| `dolt gc` | 20.7 秒 | 1.18GB |
| 只存 1m 的库：`table import`（38,932,140 行） | 270.7 秒 | 1.08GB |
| 只存 1m 的库：`dolt gc` | 17.6 秒 | 1.02GB |

### 4.2 追加一个月（2025-09：3,836,160 根 bar + 3,510 条 funding）

| | B | A |
|---|---|---|
| 预处理 | 2.8 秒 | （与 B 同一次） |
| 导入 + add + commit | 25.9 秒（bars 25.5 秒，峰值 0.97GB） | 29.9 秒 |
| 体积：追加前 → gc 前 → gc 后 | 1,090 → 1,238 → 1,188MB（+98MB） | 1,266 → 1,430 → 1,380MB（+114MB） |
| 追加后的 `dolt gc` | 1.95 秒 | 2.2 秒 |

追加的是窗口之前的月份，插入位置在每个合约键区间的开头。按月向后追加时，插入位置在每个合约键区间的末尾。两种情况下 B 树要改写的块数量级相同。

### 4.3 体积对比（同样数据：1m+5m，LAST+MARK，funding）

| 存储 | 大小 | Dolt B 与之相比 |
|---|---|---|
| Dolt B（gc 后） | 1,090MB | — |
| Dolt A（gc 后） | 1,266MB | — |
| Dolt B 只存 1m（gc 后） | 898MB | — |
| Nautilus Catalog 导出（1m 1,604MB + 5m 344MB） | 1,948MB | 0.56 倍 |
| 普通 Parquet，方案 B 列（snappy / zstd） | 1,036 / 661MB | 1.05 / 1.65 倍 |
| 普通 Parquet，方案 A 列（snappy / zstd） | 1,120 / 731MB | — |
| 币安原始 zip（窗口内的 1m、5m、funding） | 1,236MB | 0.88 倍 |
| 现有 Catalog 的 5m 部分 / 本次导出的 5m | 357MB（5,367 个文件）/ 344MB（148 个文件） | — |

Nautilus 的价格和量都是 16 字节定长，所以它的 Catalog 比 Dolt 大。普通 Parquet zstd 是最严格的参照：B 是它的 1.65 倍，A 是 1.73 倍，都在 3 倍以内。

### 4.4 导出（`AS OF <commit>`，Nautilus ParquetDataCatalog，37 币）

布局与现有 Catalog 相同：`<root>/<COIN>/minute/data/...`，并带上运行器要读的 `r1-download-complete.json` 和 `instrument-assumption.json`。转换步骤用 4 个进程，每次 25 万行写一个文件。

| 路径 | 5m：总计（查询） | 1m：总计（查询） | 峰值：客户端进程树 / 服务端 |
|---|---|---|---|
| sql-server + pymysql `SSCursor`，按合约 8 连接 | 6.9 秒（4.9） | 26.0 秒（17.7） | 5m：2.0 / 1.2GB；1m：5.1 / 2.1GB |
| 同上，从 1m 派生 5m | 19.8 秒（17.5） | — | 5.1 / 2.3GB |
| `dolt sql -r parquet` CLI，单个查询 | 39.4 秒（34.1） | 120.5 秒（97.0） | 5m：2.5GB；1m：4.5GB（含 Dolt 进程 1.3GB） |
| 方案 A，服务路径 | 9.7 秒（7.7） | 45.4 秒（37.0） | 1m：9.3 / 3.1GB |
| 方案 A，CLI | 65.6 秒（59.9） | 232.1 秒（206.6） | 1m：5.1GB |

峰值内存的取法：

- 客户端用每 0.2 秒对进程树 RSS 求和取最大值。多个 Python 进程共享的动态库页面会被重复计数，所以偏保守。
- 服务端每次都从冷启动开始，取 sql-server 进程的 RSS 峰值。
- 单进程步骤用 `/usr/bin/time -l` 的 maximum resident set size。

### 4.5 Nautilus 实际加载

用现有运行器的读取路径加载导出的 5m Catalog：`replay_inputs.read_instruments` 和 `validate_funding_receipt`，`native_node._prepare_mark_catalog`，以及 `ACCOUNT_CONTRACT`，都原样调用。BacktestNode 不加策略，每个币配一份 Bar LAST、MarkPriceUpdate 和 FundingRateUpdate。

| Catalog | 事件数 / 回执期望 | 耗时 | 峰值 |
|---|---|---|---|
| 现有 `r1-37-1y-5m-2026oct7`（基线，只读） | 7,829,207 / 7,829,207 | 19.2 秒 | 5.4GB |
| Dolt 导出（B，CLI 路径） | 7,829,207 / 7,829,207 | 13.9 秒 | 4.4GB |

两者 `query_bars` 取出的样本 bar 字符串完全相同。测完核对了现有 Catalog：文件的修改时间和大小都没有变。

## 5. 正确性（重叠窗口，逐根、逐条）

比较对象有四个：导出的 5m（B 的 CLI 路径、B 的服务路径、B 从 1m 派生、A 的 CLI 路径）分别与现有 Catalog 比较。四个的结果相同：

- **bars**：LAST、MARK 各 3,893,214 根，时间戳集合完全相同。`open`/`high`/`low`/`close`/`volume` 的 16 字节定点值**全部相等**。`ts_init` 等于 `ts_event`，也就是收盘时间减 1 毫秒，与旧数据一致。各 bar 类型的 Parquet 元数据（`bar_type`、`price_precision`（MARK 为 8）、`size_precision`）相同。
- **funding**：42,779 条，时间戳全部相同，包括交易所的毫秒抖动，例如 `08:00:00.002`。数值相等的比较按 `Decimal`，费率全部相等。归档的 `calc_time` 与 REST 的 `fundingTime` 精确相同。
- **合约条款**：用 2026-10-11 的 exchangeInfo 构造 `CryptoPerpetual`，与旧 Catalog 的 instruments 记录逐字段相同。手续费和保证金不在 exchangeInfo 里，这两项本来就是从旧 Catalog 沿用的值，不构成独立验证。
- **差异与解释**：没有差异，也就没有需要归因到数据源修正、时间边界或精度的项。值得注意的是，旧 Catalog 是当年经 Nautilus Binance 数据客户端走 REST 取的（当时 fork 的 Binance 公开数据客户端，见 `4d7af05f7^:research/r1_native/prepare.py`），本次用的是月度和日归档。两种来源在这个窗口里逐字节相同。
- **commit 可复现**：从 1m 派生 5m 那次导出，是在 2025-09 追加提交已经落到 `main` 之后，按窗口 commit `AS OF` 读的，结果仍与现有 Catalog 逐字节一致。

## 6. 门槛对照

见第 0 节的表。逐条说明如下：

- **体积**：B 是同数据 Nautilus Catalog 的 0.56 倍，是最严格参照（普通 Parquet zstd）的 1.65 倍。达标。
- **全量导入**：只存 1m 时，Dolt 导入 271 秒。1m+5m 从原始 zip 开始算，预处理加导入共 6.7 分钟。再加上下载的 73 秒，约 8 分钟（校验步骤没有单独计时）。达标。
- **追加一个月**：26 秒加预处理 3 秒。达标。
- **导出 5m**：服务路径 6.9 秒，从 1m 派生 19.8 秒，CLI 39 秒。达标。
- **导出 1m**：服务路径 26 秒，CLI 120 秒。达标。
- **峰值内存**：导入最高 1.19GB。导出在推荐配置下，1m 的客户端加服务端合计约 7.2GB；方案 A 合计约 12.4GB。只在推荐配置下达标，原因见第 7 节第 5 条。
- **正确性**：零差异。达标。

## 7. 发现的坑

1. **月度归档会缺天**：2026-06 的 markPriceKlines 月归档，在全部 37 币上都缺 2026-06-29 整天，1m、5m、1h、1d 都缺。日归档里有这一天，校验通过。LAST 当天的日归档与月归档逐行相同。获取代码必须检查每个序列连续、不重复。缺口用日归档补；重复行只有在整行完全相同时才去重，否则报错。没有这一步，5m 每个币都会少 288 根 MARK。
2. **0 成交分钟的填充**：见第 3 节。朴素聚合在 LAST 5m 上错 0.027%，而且只错在开、高、低三项上。只抽查收盘价发现不了这个问题。
3. **rc3 没有写 funding 的 Python API**：Nautilus 2.0.0rc3 的 `ParquetDataCatalog` 只有 `write_bars`、`write_mark_price_updates`、`write_custom_data` 等方法。旧代码用的 `write_funding_rate_updates` 已经没有了；`write_custom_data` 要求包一层 `CustomData`，它写出的文件能否被 BacktestNode 的 `FundingRateUpdate` 加载器读取，本次没有验证。本次导出器按旧 Catalog 的同一 schema 直接写 `funding_rate_update/<id>/*.parquet`：列为 `instrument_id`、字符串 `rate`、`interval`、`next_funding_ns`、`ts_event`、`ts_init`，元数据 `type=FundingRateUpdate`。之后用 BacktestNode 实际加载，事件数相符。这是对 Nautilus 内部文件格式的耦合，WS8b 要把"BacktestNode 读出的 funding 条数与 Dolt 相同"做成导出后的固定检查；Nautilus 升级时还要重测。
4. **不要用 Dolt CLI 作远程客户端**：`dolt --host ... sql -r parquet` 连 sql-server 时，所有列都变成字符串，内存也很高：导出 1m 时服务端约 10.5GB，客户端进程树 28.6GB（那一次在转换阶段因列类型不对中止）。改用 pymysql 流式游标后，服务端只要 2.1GB，导出 1m 只要 26 秒（本地 CLI 路径要 120 秒）。
5. **导出器内存来自 Bar 对象**：Dolt 查询本身峰值只有 1.3GB。第一版导出器开 16 个转换进程，每个进程一次持有一个币约 105 万根 1m `Bar` 对象，峰值 19.5GB（A 方案 22.8GB），超过 16GB。改成每 25 万行写一个文件、转换进程 4 个之后，峰值 4.5GB，耗时不变，因为瓶颈在查询。
6. **DECIMAL 的客户端成本**：在 Dolt 里只大 16%，但到了 Python 客户端会变成 `Decimal` 对象，服务路径导出 1m 的客户端峰值从 5.1GB 涨到 9.3GB。
7. **funding 的当月没有日归档**：fundingRate 只有月归档，`daily/fundingRate/...` 返回 404。当月只能用公开 REST 拼接，也就是用户 10-05 定的"当月 REST 拼接"那一段。本次 2026-10-01 至 07 的 funding 来自 REST，与旧 Catalog 逐条相同。
8. **`dolt sql -r parquet` 是单线程**：CLI 路径约 23–40 万行/秒，1m 的导出时间几乎都花在这里。服务路径可以按合约并行，8 个连接合计约 220 万行/秒。
9. **合约历史条款仍是近似**：exchangeInfo 只有当前快照，手续费和保证金也不在里面。instruments 表用 `valid_from` 分版本，留出了表达历史条款的位置，但历史值从哪里来，本次没有解决。

## 8. 采用建议与 WS8b 的输入

建议采用。WS8b 实现时按以下几点做：

- **库与表**：建一个独立的 Dolt 库，和研究账本用同一个服务。建 `bars`（方案 B，只存 1m 的 LAST 和 MARK）、`funding`、`instruments`（按 `valid_from` 分版本）三张表。运行用数据 commit 引用输入。
- **获取**：按"月归档 → 日归档补缺和当月 → REST 补 funding 当月"的顺序拼接。每个文件都校验 `.CHECKSUM`。每个序列都要连续、无冲突重复；不满足就拒绝提交。
- **导出**：走 sql-server 流式读取，按合约并行，转换分块写。周期由派生得到，第 3 节的规则写进代码，并用原生归档做回归测试；测试要补上本次没有覆盖的周期，包括 1w。funding 的写出与加载按第 7 节第 3 条做固定检查。
- **待定**：`--daily-warmup` 的日线需要窗口前至少 200 天的数据。两个选项：
  - 从 1m 派生日线。这要把 1m 的存储往前多延伸约 200 天，体积约增加 55%。
  - 单独存原生 1d。每币每年只有 365 行，代价很小，但会多出一个数据源。
  
  这一项留给 WS8b 和用户商定。

## 9. 临时数据、脚本和关键片段

全部在会话临时目录 `/private/tmp/claude-501/-Users-vx-WebstormProjects-trade/0b2cbbcb-6968-453d-afd5-8c77f8974d35/scratchpad/`，约 10GB。不在持久目录，可以随时删除，重启后也可能被清空。可重建的中间文件已经删掉，包括规范化 CSV（11GB）、参照 Parquet 和多余的导出副本。

| 位置 | 内容 |
|---|---|
| `dl/` | 校验过的币安原始 zip 和 `.CHECKSUM`、`rest/exchangeInfo.json`、`rest/funding-*-2026-10.json` |
| `dolt/A`、`dolt/B`、`dolt/B1m` | 三个 Dolt 库。窗口 commit 分别是 `53amftrgqk61rk52iir1ohtg4e9ele0t`、`ej3v251qc18s273mn1qvplol4fngonpe`、`38vn8qlif9807n9rscmffqcjcj8tnaf0`；A、B 上还有 2025-09 的追加 commit |
| `export/` | 导出的 Catalog（`B_5m_w4`、`B_1m_w4`、`B_1m_server`、`B_5m_server_derived`、`A_5m_w4`、`A_1m_w4`）及各次的 `export_*.json` |
| `out/` | 全部 `/usr/bin/time -l` 输出、峰值采样 `*.mem.json`、比对结果 `compare_*.json`、`agg_compare*.json`、加载结果 `load_*.json` |
| `scripts/` | `urls.sh`、`fetch.sh`、`verify.sh`（下载与校验）；`prep.py`（规范化）；`schema.sh`、`import.sh`（建表与导入）；`export.py`（导出）；`compare_catalog.py`、`verify_1m.py`、`agg_compare.py`、`count_vs_volume.py`、`gaps.py`（比对）；`load.py`（Nautilus 加载）；`peakmem.py`、`sample_pid.sh`、`server_measure.sh`（测量） |

关键片段（`export.py`）：

```python
# 值 → Nautilus raw（值 × 10^16，小端 i128）；方案 B 先把缩放整数重解释为 decimal128(38, scale)
v = col.to_numpy().astype(np.int64)
words = np.empty((len(v), 2), np.int64); words[:, 0], words[:, 1] = v, v >> 63
dec = pa.Array.from_buffers(pa.decimal128(38, scale), len(v), [None, pa.py_buffer(words.tobytes())])
dec = pc.cast(dec, pa.decimal128(38, 16), safe=True)
raw = pa.Array.from_buffers(pa.binary(16), len(dec), [None, dec.buffers()[1]], offset=dec.offset)
# → 加上 schema 元数据 bar_type/price_precision/size_precision，按 IPC 交给
#   BarDataWrangler(bar_type, pp, sp).process_record_batch_bytes(...)，再 catalog.write_bars(...)

# 1m → 高周期派生：开/高/低只看有成交（volume > 0）的分钟，整段无成交才退回全部
traded = v > 0
any_traded = np.add.reduceat(traded.astype(np.int64), st) > 0
first = np.where(any_traded, np.minimum.reduceat(np.where(traded, np.arange(n), BIG), st), st)
open_ = o[first]
high = np.where(any_traded, np.maximum.reduceat(np.where(traded, h, MIN), st), np.maximum.reduceat(h, st))
low = np.where(any_traded, np.minimum.reduceat(np.where(traded, l, BIG), st), np.minimum.reduceat(l, st))
close, volume = c[st + k - 1], np.add.reduceat(v, st)
```

服务路径每个合约执行一条查询，用 pymysql `SSCursor` 每次 `fetchmany(200_000)`：

```sql
SELECT price_type, ts_open, open, high, low, close, volume FROM bars AS OF '<commit>'
WHERE instrument = %s AND timeframe = '1m' AND ts_open >= %s AND ts_open < %s
ORDER BY instrument, price_type, timeframe, ts_open
```
