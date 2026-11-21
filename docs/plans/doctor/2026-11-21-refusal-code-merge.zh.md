# 2026-11-21 修复文字相同、条件也相同的拒绝码合并（D-089）

[0.5.0 重判](../rejudge-0.5-20261121.zh.md) D-089：发布计划以“收益低”判不做，这不是允许的理由；改拒绝码属委托决定。

| Item | Value |
|---|---|
| Sessions | 0.5.0 第三波清理 lane 的子 agent（Claude Code，Claude Opus 5.5） |
| Checkout / ledger | `origin/main` `305f7dc54`；未读写账本、市场或主机 |
| Cost | none（拒绝码只是名字；同一条件两个码让读拒绝的人多查一处） |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261121-30 | 同一条件、同一修复文字有两到三个拒绝码 | `shared/refusals.py` `CATALOGUE` 250 码按修复文字分组，5 组重复（下表）；逐组读引发处，3 组条件也相同 | authority（合并拒绝码；委托决定） | none | in PR |

| 组 | 引发处 | 判定 |
|---|---|---|
| `PAPER_COMPARE_UNCOVERED`、`LIVE_COMPARE_UNCOVERED` | `paper/compare.py`、`live/compare.py` 同一个 `shared.archive` 调用：市场缺运行的分钟 | 合并为 `COMPARE_UNCOVERED` |
| `GRID_MISALIGNED`、`INPUT_UNSORTED` | `market/series.py`：时间不是严格递增的整步网格（后者只是一分钟步长） | 合并为 `GRID_MISALIGNED` |
| `BARS_UNSORTED`、`MARK_UNSORTED`、`FUNDING_UNSORTED` | `market/export.py`：K 线、MARK、资金费时间不严格递增 | 合并为 `SERIES_UNSORTED` |
| `BAR_RAW_INEXACT`、`MARK_INEXACT` | `market/export.py`：价格或数量在合约精度下不精确 | 合并为 `EXPORT_INEXACT` |
| `FUNDING_RATE_SHAPE` 与上一组的 `*_UNSORTED` | 资金费率不是有限小数，条件不同 | 不并 |
| `COVERAGE_MISMATCH`、`LIFECYCLE_COVERAGE_MISMATCH` | 前者核对覆盖回执与原生摘要，后者核对生命周期回执的格式、窗口与市场日（`engine/load.py`，回放闭包）；条件不同 | 不并 |

没有技能或评测点名被合并的码。

## 决定

2026-11-21：用户委托：「需要我定的部份最后也是一样由你决定按推荐做」。据此合并上表三组条件与修复文字都相同的码（共 10 码并为 4 码），条件不同的两组不并。导出路径改动只动拒绝分支：固定的合成市场日（`tests/market/test_metrics.py` 的夹具，K 线、MARK、资金费与 metrics）改前改后导出的 7 个文件逐字节相同。
