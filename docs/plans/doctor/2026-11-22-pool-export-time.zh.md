# 2026-11-22 币池导出耗时

来源：0.5.0 发布前 Docker 端到端运行（2026-11-22）。两次 3 天的币池 `replay explore`（含预热 7 天输入，约 259 个合约）各用 1071.5 s 和 937.0 s；原生回放、审计与指纹合计约 1 分钟，其余约 15 分钟在宿主侧 `market/export.py`（4 个工作进程）。

| Item | Value |
|---|---|
| Sessions | 0.5.0 端到端运行的步骤日志（`48-pool`、`50-pool2`）；诊断与修复 lane（Claude Code，Claude Opus 5.5） |
| Checkout / market | `origin/main` `48851741e`；活动市场只读，市场日 2026-10-30；导出写到 scratchpad（`export_catalogs(fresh=True)`），不写市场或账本 |
| Coverage | `market/export.py`（`_export_episode`、`price_grid`、`daily_bars`、`export_catalogs`）、`market/coverage.py`（`bar_blocks`、`_edges`、`coverage_facts`）、`market/files.py`（`file_batches`）、`market/read.py`（`market bars --timeframe 1d`） |
| Cost | minutes（每次币池回放多约 15 分钟） |

## Measurement

窗口 `[2024-09-20, 2024-09-27)`，`include_quotes=False`（bars 执行）。`bar` 表 82 个月文件共 23 GB，每个文件约 27 个行组，按 symbol 排序，一个行组装着十几个合约。

逐阶段（改前，单进程，BTCUSDT 与 DOGEUSDT 两个合约合计 39.7 s）：

| 阶段 | 秒 | 解码的行组 | 解压后字节 |
|---|---|---|---|
| `price_grid`（从 0 读到市场日的全部 LAST） | 23.7 | 177 | 6.2 GB |
| `daily_bars`（从 0 读到窗口末的全部 LAST，预热日线） | 11.1 | 123 | 4.5 GB |
| `coverage_facts`（含 `_edges` 找首末 K 线） | 0.6 | 小 | 小 |
| 窗口内的 LAST、MARK、资金费与写 Catalog | 约 0.8 | 4 | 0.1 GB |

每个合约把自己出现过的每个月文件读两遍全史，而一个行组装着十几个合约：259 个合约的币池里同一行组被解码约 2 × 12 次。`_edges` 在停止交易的合约上要从最新文件往回找（MATIC 的 LAST 从 2026-10 找到 2024-09）；只改两遍全史时它成了剩下的主要成本（每合约约 1.2 s，币池导出 237 s），所以也改由同一遍读取给出。

## Change

`market.contract_history`（新模块 `market/history.py`）一次读完每个 `bar` 月文件，交给全部导出的合约：每个文件一个任务，在导出的同一进程池里跑；文件按 (symbol, price_type, ts_open) 有序、按整 UTC 日分月，所以一个合约在一个文件里的 LAST 行连续，日线可以逐文件推导再按文件顺序拼接。每个合约留下：LAST 行数、全部价格与窗口起点后价格的最大公约数（`price_grid` 的小数位与是否在 tick 网格上，只依赖整除，最大公约数等价）、各片段的预热日线、LAST 与 MARK 的首末开盘时刻（`coverage_facts` 不再另读）。`daily_bars`（`market bars --timeframe 1d`）走同一函数，只读与区间相交的文件。

逐字节一致（改前在 `origin/main` `48851741e` 的独立检出上跑，改后在本分支上跑，同一市场日、窗口、4 个工作进程，`fresh=True`）：

| 切片 | 改前 | 改后 | `export_sha256`（semantic） | 全部字节 |
|---|---|---|---|---|
| BTCUSDT | 21.2 s | 7.8 s | `0b9386620a12…` 两边相同 | `c37f2a943554…` 两边相同 |
| 币池 259 个合约 | 1065.1 s | 79.6 s | `9ad12933828e…` 两边相同 | `a760fa4349a5…` 两边相同 |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261122-05 | 导出按合约各读两遍全史（`price_grid`、`daily_bars`），同一 `bar` 行组在币池导出里被每个同组合约重复解码；停止交易的合约另要往回扫多个文件找末根 K 线 | 上表 | fix（每个文件读一次，交给全部合约；字节一致） | minutes | open |

## Decisions

- 2026-11-22：按任务说明修复，不涉及存储字段、市场写入或检查改动；导出的每个字节与改前相同。
- 2026-11-22：#3434 合入为 696a0f620，本行记为 fixed；依据用户 2026-11-21 对待办项的授权「我都授权」。
