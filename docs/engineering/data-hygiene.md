---
title: Data Hygiene
role: engineering-contract
status: active
owner: engineering
last_verified: 2026-07-31 CST
---

# Data Hygiene

## 定位

本文定义本地运行数据的当前放置与清理边界。Git 保存源码、文档、schema、测试和最小
fixture；运行数据库、行情、日志和实验 artifact 默认不进入 Git。

核心规则：

- 结构化 durable fact 进入 owner 管理的根 `data/*.db`；
- owner 准入且 content-addressed 的不可变大 payload 可以进入 `data/artifacts/`，其 authority 和引用仍在 owner DB；
- 可再生中间文件进入 `tmp/`，不因被报告引用就升级为 canonical 数据。

## Git 边界

| 类型 | 进入 Git | 位置 |
| --- | --- | --- |
| docs/source/schema/tests | 是 | `docs/`、`apps/**/src`、owner schema/test |
| 最小 example/fixture | 是 | owner `examples/` 或测试 fixture |
| strategy policy | 是 | `strategies/*.md` |
| runtime DB/sidecar | 否 | 根 `data/*.db`、`*.sqlite*`、WAL/SHM |
| market/research data | 否 | `data/ohlcv.db`、`data/market_data.db`、`data/data_catalog.db`、`data/rd_state.db` |
| immutable evidence payload | 否 | `data/artifacts/` |
| replay/R&D/panel/report | 否 | `tmp/artifacts/`、`tmp/panels/` |
| local operator config | 否 | `profile/account_config.json`、`profile/notify_config.json` |

## 当前放置

| 数据 | Canonical owner |
| --- | --- |
| OHLCV candle | `data/ohlcv.db.canonical_candle` |
| market manifest/funding/feature refs | `data/market_data.db` |
| 在线交易事实 | `data/trade.db` |
| runtime/job/health/incident/notify | `data/ops_runtime.db` |
| exchange request/result/idempotency | `data/exchange_runtime.db` |
| policy snapshot | `data/policy_registry.db` |
| governance decision | `data/governance.db` |
| R&D program state | `data/rd_state.db` |
| dataset/artifact/run/evidence catalog | `data/data_catalog.db` |
| owner-admitted immutable payload | `data/artifacts/<domain>/<kind>/<sha256>/` |
| 可再生报告与 panel | `tmp/artifacts/`、`tmp/panels/` |

manifest、report 和 DB ref 保存 repo-relative 路径；只有执行边界将其解析为实际路径。完整
OHLCV、feature series、replay/campaign report 等大 payload 不因方便查询而整体塞入错误的
DB；owner DB 保存所需 hash、schema、coverage、summary、lineage 和引用。

## 清理

- 删除必须显式，默认 dry-run。
- `.pin`、catalog ref、ledger ref 或 active evidence 保护的内容不得删除。
- `tmp/` 是可再生工作区，但清理前仍须确认当前运行和报告引用。
- `apps/artifact-knowledge/artifact-catalog` 的 GC 只按 owner 已知引用闭包处理候选。
- 路径型 `--artifact-gc` 不得作用于 `data/` 或 `data/artifacts/`。
- durable evidence 只有在 catalog-aware、release-aware 引用闭包明确后才能删除；未知引用时保留。

## 仓库卫生

`.gitignore` 覆盖根 DB、SQLite sidecar、`tmp/` 和本地 profile。当前不允许 module-local
runtime `data/`。

`scripts/check-workspace-hygiene.ts` 可扫描 Git index 与 module-local data；
`scripts/check-workspace-side-effects.ts` 检查本轮 tracked/unignored 副作用。两者都不自动
删除数据，也不替代 catalog 的引用判断。

## 已知边界

- catalog 是本地 SQLite 索引，扫描和清理按顺序执行，不假设并发写安全。
- 大型文件保留在文件系统，DB 只保存其可验证身份、摘要和引用。
- 历史错位文件不会自动迁移；迁移前先解析 owner 和引用，删除另行显式执行。
- automation memory 不是业务数据库，通过仓库 helper 访问，不进入 catalog。
