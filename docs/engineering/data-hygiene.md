---
title: Data Hygiene
role: engineering-contract
status: active
owner: engineering
last_verified: 2026-07-23 CST
---

# Data Hygiene

## 0. 定位

本文定义本地运行数据如何留存。

目标不是清空数据，而是防止 Git 变成行情、artifact、日志和数据库仓库。源码、文档、schema、示例输入可进 Git；运行产物默认不进 Git。

## 1. Git 边界

| 类型 | 默认进 Git | 位置 |
| --- | --- | --- |
| docs / tool source / schema / tests | 是 | `docs/`, `modules/**/src/scripts`, `modules/**/src/schemas` |
| 示例输入 / 模板 | 是 | `modules/**/examples` |
| strategy policy | 是 | `strategies/*.md` |
| trade runtime DB | 否 | `data/trade.db`, `data/*.sqlite*` |
| ops / lock / system state | 否 | `data/ops_runtime.db`；临时 lock 只能放 `tmp/` |
| strategy evidence / R&D ledger / R&D state | 否 | `data/data_catalog.db`, `data/rd_state.db` |
| immutable content evidence | 否 | `data/artifacts/`；只保存 owner-admitted、content-addressed payload |
| 临时 replay / R&D / calibration / validation / forward holdout artifact | 否 | `tmp/artifacts/`, `tmp/panels/`；不是 durable storage |
| OHLCV / market data | 否 | `data/ohlcv.db`, `data/market_data.db` |
| local operator config | 否 | `profile/account_config.json`, `profile/notify_config.json` |

需要长期保留但不进 Git 的结构化事实进入 `data/*.db`；数据库不适合承载的不可变大 payload 只能进入 `data/artifacts/`，并由数据库保存 hash、路径、lineage、引用和 release 状态。普通研究中间产物默认放 `tmp/`，必要时由 DB ref / evidence / ledger 引用；引用不改变其非 durable 身份。

## 2. 放置规则

- OHLCV canonical candles：写 `data/ohlcv.db.canonical_candle`
- 策略 policy：写 `strategies/*.md`；frontmatter 做身份索引，`## Trade Contract` 做机器契约；这是项目资产，不是 tool 源码，也不是运行数据
- calibration / validation / external / forward holdout panel：默认写 `tmp/panels/<kind>-<name>-<date>/`
- replay / R&D / calibration 普通报告：默认写 `tmp/artifacts/<domain>/`
- 已被 owner 准入且用于 Replay / Forward 的 content-addressed payload：写 `data/artifacts/<domain>/<kind>/<sha256>/`；文件自身不能充当引用或生命周期事实
- 已被策略准入、复盘或人工 review 明确引用的报告：仍留在 `tmp/` 工作区，由 `data/data_catalog.db` 记录 ref / hash / summary；不搬入 `data/` 目录
- 策略准入证据：写 `data/data_catalog.db.strategy_evidence`
- R&D 审计：写 `data/data_catalog.db.strategy_rnd_run`
- cron / health / incident / notify 运维事实：写 `data/ops_runtime.db`
- manifest / report 中保存路径优先 repo 相对路径；跨 tool 执行时才解析为实际文件路径
- 可提交的最小 fixture：放 tool 自己的 `examples/` 或测试 fixture，不放 `data/`

## 3. 清理规则

- 删除必须显式；默认只 dry-run。
- `tmp/artifacts/` / `tmp/panels/` 下被 `.pin`、evidence ref 或 ledger ref 保护的文件不得删。
- 未引用、未 pin、超过 retention 的 artifact 由 `modules/artifact-knowledge/artifact-catalog` 的 `--artifact-gc` 或 `--catalog-gc` 报告 / 清理。
- `tmp/` 下文件是可再生工作产物；清理前确认没有被当前 evidence / report 引用。canonical candles 以 `data/ohlcv.db` 为准。
- `tmp/panels/` 是可再生研究输入；默认可按 retention 清理，除非已被 ledger / evidence / `.pin` 引用。
- 路径型 `--artifact-gc` 禁止作用于 `data/` 或 `data/artifacts/`；durable evidence 只能由 catalog-aware GC 在 owner 引用闭包和显式 release 均闭合后处理。当前 catalog 将 `data/artifacts/` 分类为 `evidence`，在 release-aware GC 落地前一律保护。

## 4. 当前 `.gitignore` 约定

`.gitignore` 覆盖根 DB、SQLite sidecar、`tmp/`、profile 本地配置与历史生成目录。当前架构不把任何 module-local `data/` 视为有效运行落点。

- `data/*.db`, `data/*.sqlite*`
- `*.db-{shm,wal}`, `*.sqlite-{shm,wal}`, `*.sqlite3-{shm,wal}`, `*.duckdb-{shm,wal}`
- `tmp/`
- `profile/account_config.json`, `profile/notify_config.json`

若某个生成物需要被 review，优先写成小型 example / schema / docs 摘要，而不是强行提交完整运行数据。

`scripts/check-workspace-hygiene.ts` 额外扫描 Git index 与 module-local `data/`，不因 ignore 而漏掉源码目录污染。历史 tracked runtime ratchet 已清零；新增 tracked sidecar/runtime DB 或 module-local DB 直接失败。

`scripts/quality-check.sh` 在总闸前后运行 workspace content snapshot，拒绝本轮造成的 tracked / unignored 副作用；`scripts/audit-workspace-footprint.ts` 对 ignored 区域只做分类、体量与 stale dry-run 报告。二者都不代替 artifact catalog 的 ref / `.pin` 保护，也不在 quality 内删除文件。

## 5. 目录口径

目标是让 `data/` 只承载 SQLite durable 状态与经过 owner 准入的不可变 evidence payload：

```text
data/
  ohlcv.db                  # ohlcv_store：canonical candles
  market_data.db            # market_data_store：manifest / funding / feature refs
  rd_state.db               # research_state_store：RD program memory
  trade.db                  # 在线交易事实
  data_catalog.db           # 本地数据资产索引 + strategy evidence / R&D ledger
  ops_runtime.db            # cycle / job / health / notify / incident
  exchange_runtime.db       # exchange request / result / idempotency ledger
  governance.db             # governance ledger
  policy_registry.db        # runtime policy snapshots
  artifacts/                # content-addressed immutable evidence；authority 仍在 owner DB
```

普通中间产物放 `tmp/`：

```text
tmp/
  artifacts/                # replay / R&D / feature 大报告
  artifacts/trade-flow/     # slow / fast track JSON report
  panels/                   # calibration / validation / external / forward holdout panel
  market/                   # automation / slow-track 市场候选 cache
```

本地 learning memory 放 `data/rd_state.db`：

```text
data/
  rd_state.db               # rd_program_state；research memory，不是 strategy evidence
```

规则很简单：默认先临时；会影响准入、复盘或恢复的结构化事实进入 `data/*.db`，其不可变大 payload 才进入 `data/artifacts/`。

## 6. 当前产物面快照

扫描时间：2026-07-23 CST。

| 区域 | 文件数 | 体量 | 管理状态 |
| --- | ---: | ---: | --- |
| `data/` | SQLite DB + content evidence | 本机实际状态 | 结构化 authority 在 DB；大 payload 只允许 content-addressed evidence |
| build cache | 47,430 | 8.05G | 可再生；与 evidence GC 分离，当前 14 天 stale 约 25.3M |
| external audit clone | 19,492 | 1.30G | 独立类别；当前未超过 14 天 retention |
| protected evidence workspace | 655 | 1.07G | report-only；删除前必须解析 catalog / ledger / `.pin` |
| test residue | 6,660 | 82.7M | 可识别的 `tmp/test*` / `tmp/check`；当前未超过 14 天 retention |
| dependency cache | 5,191 | 62.5M | 可再生；当前 14 天 stale 约 29.0M |
| `.codex/automations/` | 2 | 7.5K | 已 ignore；通过 automation memory path helper 访问 |

主要占用：

- `tmp/check/`：约 2.3G，主要是定向 Rust build cache。
- `tmp/upstream-source-audit-20260722/`：约 1.3G，属于 external audit clone，不是产品 artifact。
- `tmp/panels/`：约 566M；承接 calibration / validation / external / forward holdout panel。
- `tmp/l2-recorder-bakeoff/`：约 244M；包含 soak / crash recovery 证据与工作目录。
- `tmp/artifacts/`：约 213M；其中 strategy R&D 约 209M。

数据库现状：

- `data/trade.db`：24K，仅 `plan_event` 表；当前 1 条 `observe`。
- `data/data_catalog.db.strategy_rnd_run`：5 条 R&D 防重复审计记录，完整 record 存 `record_json`。
- `data/data_catalog.db.strategy_evidence`：2 条策略准入证据记录，完整 record 存 `record_json`。

## 7. 当前治理状态

- DB 没有膨胀；`data_catalog.db` 只索引元数据、hash、summary、引用关系与 retention。
- 运行态结构化 authority 只允许落在项目根 `data/*.db`；owner-admitted immutable payload 可落 `data/artifacts/`，其余工作区产物只允许落在 `tmp/`。
- `data/` 只通过 owner DB 读写；`tmp/` 只能通过 catalog ref 被解释；旧路径输入必须在入口失败。
- `--catalog-stale` 已覆盖 `tmp/` 与 panel data；默认只报告候选、保留原因与引用状态。
- `--catalog-gc --yes` 只删除 catalog 判定为 stale 的候选；`.pin`、引用、durable / evidence retention class 会保护文件。
- `--artifact-gc` 只处理非 `data/` 工作区；它无法解释跨 owner 引用，因此代码层拒绝 `data/` 与 `data/artifacts/` 根。
- `tmp/artifacts/strategy-rnd/`、R&D ledger、strategy evidence、cron log、track output、feature report、panel / calibration / campaign / shadow tracker 已有结构化索引。
- `tmp/market/` 是 automation / slow-track 可删 cache；项目级 canonical OHLCV 只在 `data/ohlcv.db`。

## 8. 剩余边界

- catalog 是本地 SQLite 索引层；扫描 / 清理按顺序执行，不做并发写。
- 大型 feature series 不整体进 DB；DB 只保存 source manifest、指标集合、coverage、摘要与 content hash。
- 历史文件不会被自动清理；legacy tool-local 运行路径不再兼容，已有错位文件可按引用关系迁移后删除。
- 真删除仍必须显式 `--catalog-gc --yes`；`data/artifacts/` 在 release-aware 引用闭包落地前不产生删除候选。

## 9. 生成数据管道评估

| 管道 | 当前落地 | 结构化程度 | 判断 |
| --- | --- | --- | --- |
| online flow event | `data/trade.db.plan_event` | 中：SQLite + JSON body + 少量校验 | 方向正确；查询投影不足 |
| cron / track run | `data/ops_runtime.db` + `tmp/artifacts/trade-flow/*.json` | 中：DB 记录 runtime 事实，tmp 只放工作区报告 | runtime fact 进 ops DB；报告只可由 catalog ref 解释 |
| OHLCV | `data/ohlcv.db.canonical_candle` | 高：owner DB + closed candle 口径 | 不再使用 CSV / manifest 作为事实源 |
| tech feature report | summary / refs 入 DB，临时大 payload 在 `tmp/` | 中：DB 摘要 + workspace report | 不把完整 series 当 durable storage；需要时补摘要表 |
| R&D loop / campaign | `data_catalog.db.strategy_rnd_run` + `tmp/artifacts/strategy-rnd/*.json` | 中：DB 防重复，tmp report 可清理 | 保持 DB record_json + summary columns；报告只作可再生工作产物 |
| strategy evidence | `data_catalog.db.strategy_evidence` | 中：DB canonical，shape 有 schema | 不进 `trade.db`；review / promote 直接读 catalog |
| calibration / validation panel | DB refs + `tmp/panels/` workspace | 中：可复算，需 DB 摘要 | 需要 panel catalog / owner read port |
| automation memory | `.codex/automations/*/memory.md` | 低：人类摘要 | 不入业务 DB；只保留路径访问规范 |
| market candidate cache | `tmp/market/*` | 低到中：runtime cache | 可删 cache，不作为事实源 |

核心规则：数据库承载 durable fact；文件只允许作为 `tmp/` 工作区材料，不能成为长期状态或 canonical 数据。

## 10. 数据库边界

当前实现与文档有一处偏差：`docs/runtime/tech-spec.md` 提到 `beta_cache`，但现有 `ensureSchema` 只创建 `plan_event`。若 β 风险控制进入真实读路径，必须补表或删掉文档承诺。

当前分层：

- `trade.db` 继续只放在线交易事实：`plan_event`、必要 projection、risk/runtime state；不要塞 OHLCV、feature series、完整 replay payload。
- `data_catalog.db` 管研究与数据资产：dataset、artifact、run、ledger、reference、retention；已提供 init / scan / query / stale dry-run / catalog-gc，并接入主要生成时 writer。
- 大文件仍放文件系统：CSV、feature series、完整 replay/campaign report；DB 只存 hash、schema_version、path、summary metrics、引用关系。

最低表面：

| 表 | 用途 |
| --- | --- |
| `run` | 每次 slow/fast/R&D/calibration/GC 的 `run_id`、kind、status、started_at、ended_at、input_hash |
| `dataset` | OHLCV / panel dataset 的 symbol、timeframe、source、first_ts、last_ts、rows、content_hash、manifest_path |
| `artifact` | JSON/CSV/report 的 path、type、bytes、hash、schema_id、created_at、retention_class |
| `artifact_ref` | run / evidence / ledger / strategy 对 artifact 的引用边 |
| `strategy_rnd_run` | R&D run_id、candidate、family、stage、accepted、holdout_key、artifact_id |
| `strategy_evidence` | evidence record 的 strategy_id、kind、source_ref、qualification summary、artifact_id |
| `panel` | calibration / validation / external / forward holdout panel 的汇总索引 |
| `panel_member` | panel 内 dataset 成员、manifest、行数、时间范围、funding report ref |
| `feature_report` | 技术指标 / 市场特征 report 的 symbol、source manifest、indicator count、market-event flag |
| `research_report` | R&D loop / campaign / benchmark / calibration / panel / shadow tracker 的摘要索引 |
| `schema_migration` | catalog schema 版本 |

不建议入 catalog DB 的内容：

- 完整 OHLCV candle 明细不进 `artifact_catalog`；canonical candles 由 `ohlcv_store` owner DB 管理。
- 完整 feature time series；只入 feature summary、hash、source manifest。
- 人读的 strategy Markdown 与 automation memory。
