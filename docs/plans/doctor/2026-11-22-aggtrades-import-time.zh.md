# 2026-11-22 aggTrades 与 quotes 导入耗时计量

[工程工作流与治理盘点](2026-11-20-engineering-workflow-and-governance-survey.zh.md) 的 `20261120-10`：`market/aggtrades.py` 逐行解析校验、`market/quotes.py` 逐行推导买卖价，二者在导入耗时中的占比未计量。

| Item | Value |
|---|---|
| Sessions | Doctor 修复 lane（Claude Code，Claude Opus 5.5） |
| Checkout | `origin/main` `232adff38` |
| Market | 临时市场目录（`market init --kind temporary`），ETHUSDT，2026-10，30,900,903 笔 aggTrades，21,345,453 个买卖价状态 |
| Cost | minutes（每个合约月的 aggTrades 导入多约 1 分钟 CPU） |

## Measurement

单进程（一个合约时不开进程池），本机负载 15–35 时测；秒数为墙钟，CPU 秒与之相差不到 1 秒。

`market import-trades`（月）：

| 阶段 | 改前 | 改后 |
|---|---|---|
| 下载与校验（冷缓存） | 约 12 s（冷 88.8 s − 暖 76.8 s） | 不变 |
| 解压与 `csv.reader` 切行 | 16.5 s | — |
| 逐行校验与 `scaled()` 缩放 | 47.4 s | — |
| 拼 `list[tuple]` 再转 Arrow（`record_batch`） | 8.0 s | — |
| 解压、切行、校验、缩放合计 | 68.6 s | 14.8 s |
| 行检查与写 Parquet | 5.6–6.0 s | 不变 |
| 命令总耗时（暖缓存） | 76.8 s | 19.5 s |
| 峰值常驻内存 | 499 MB | 515 MB |

解析与缩放占暖缓存导入的约 90%（68.6 / 76.8 s），属实。

`market import-quotes`（月）：读当日 aggTrades 0.9 s，`derive` 5.9 s（含逐行推导），拼 Arrow 批 3.1 s，写 1.7 s；命令总耗时 14.6 s（改后 11.9 s：只有前一日的 aggTrades 改走新解析）。推导一行依赖上一行（陈旧侧被推开后延续到该侧下次成交），向量化需重写规则本身，收益不过几秒，不改。

## Change

`aggtrades.batches` 先按块（2 MiB CSV，约 3.3 万行）用 `pyarrow.csv` 读成字符串列，逐列校验与缩放：整数为 `^[0-9]{1,18}$`，价格与数量为 `^[0-9]{1,10}(\.[0-9]{1,8})?$` 且不为零，买方挂单标志为 `true`/`false`/`True`/`False`，序列、时间单调与日界用 numpy 与 `quotes.derive` 同式检查。遇到其他写法（指数、超出 8 位的尾零、空白、BOM、空行）或任一检查不过，当日改由原逐行路径（`_exact`）从头重读，跳过已交出的行：它接受 `scaled` 接受的任何写法，并在同一行给出同一拒绝。块读取不开线程：8 MiB 块加读线程时只解析就多占约 370 MB，2 MiB 单线程多占约 120 MB，耗时不变。

逐字节一致：同一缓存、两个新临时市场，改前改后 `agg_trade/2026-10/ETHUSDT.parquet` 的 sha256 均为 `a8541c0cad3ed1730c71355c73298a2138e0d84bd2eaffee25fc784adf43ab42`，`quote/2026-10/ETHUSDT.parquet` 均为 `f8bf8c952e58c430b60bfe1841ff85006d22d437e72b8de2b2f01f657e3d0283`（`files.ROW_GROUP` 固定，分批方式不改变字节）。

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261120-10 | `market` 的 `aggTrades` 解析与 `quotes` 推导逐行在 Python 里循环，导入耗时未计量 | 上表：解析与缩放占暖缓存 `import-trades` 的约 90%；`derive` 约占 `import-quotes` 的 40% | fix（aggTrades 解析向量化，字节一致；quotes 不改） | minutes | fixed a97fde8cf [#3406](https://github.com/qOeOp/trade/pull/3406) |

## Decisions

- 2026-11-22：按 `20261120-10` 的动作计量；解析占比属实，在同一 PR 里向量化 aggTrades 解析（输出逐字节一致，拒绝码与消息不变），quotes 推导保持逐行。授权依据：用户 2026-11-21 对含本行的清单回复「我都授权」。
