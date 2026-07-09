# Data Hygiene

## 0. 定位

本文定义本地运行数据如何留存。

目标不是清空数据，而是防止 Git 变成行情、artifact、日志和数据库仓库。源码、文档、schema、示例输入可进 Git；运行产物默认不进 Git。

## 1. Git 边界

| 类型 | 默认进 Git | 位置 |
| --- | --- | --- |
| docs / skill source / schema / tests | 是 | `docs/`, `.agents/skills/**/scripts`, `.agents/skills/**/schemas` |
| 示例输入 / 模板 | 是 | `.agents/skills/**/examples` |
| strategy policy | 是 | `.agents/skills/trade-flow/strategies/*.md` |
| trade runtime DB | 否 | `data/trade.db`, `data/*.sqlite*` |
| cron / lock / system state | 否 | `data/cron.log`, `data/.trade-flow.lock`, `data/system_state.json` |
| strategy evidence / R&D ledger | 否 | `data/strategy-evidence.jsonl`, `data/strategy-rnd-ledger.jsonl` |
| replay / R&D / calibration / validation / forward holdout artifact | 否 | `data/artifacts/`, `data/calibration-panel-*/`, `data/validation-panel-*/`, `data/external-panel-*/`, `data/forward-holdout-*/` |
| OHLCV / market data | 否 | `data/ohlcv/` |
| local operator config | 否 | `profile/account_config.json`, `profile/notify_config.json` |

需要长期保留但不进 Git 的产物，放在 `data/artifacts/` 或对应 data 子目录，用 `.pin` 或 evidence / ledger ref 保护。

## 2. 放置规则

- 原始行情、OHLCV、calibration / validation / external / forward holdout panel：写 `data/ohlcv/`、`data/calibration-panel-<date>/`、`data/validation-panel-<name>-<date>/`、`data/external-panel-<name>-<date>/` 或 `data/forward-holdout-<name>-<date>/`
- replay / R&D / calibration 报告：写 `data/artifacts/<domain>/`
- 策略准入证据：写 `data/strategy-evidence.jsonl`
- R&D 审计：写 `data/strategy-rnd-ledger.jsonl`
- cron 运维日志：写 `data/cron.log`
- manifest / report 中保存路径优先 repo 相对路径；跨 skill 执行时才解析为实际文件路径
- 可提交的最小 fixture：放 skill 自己的 `examples/` 或测试 fixture，不放 `data/`

## 3. 清理规则

- 删除必须显式；默认只 dry-run。
- `data/artifacts/` 下被 `.pin`、evidence ref、ledger ref 或 durable 目录保护的文件不得删。
- 未引用、未 pin、超过 retention 的 artifact 可由 `trade-flow --artifact-gc` 报告或清理。
- `data/ohlcv/`、`data/calibration-panel-*/` 与 `data/validation-panel-*/` 是可再生市场数据；清理前只需确认没有被当前 evidence / report 引用。

## 4. 当前 `.gitignore` 约定

`.gitignore` 已覆盖：

- `data/artifacts/`
- `data/ohlcv/`
- `data/calibration-panel-*/`
- `data/validation-panel-*/`
- `data/external-panel-*/`
- `data/forward-holdout-*/`
- `data/strategy_audits/`
- `data/strategy-evidence.jsonl`
- `data/strategy-rnd-ledger.jsonl`
- `data/cron.log`
- `data/system_state.json`
- `data/.trade-flow.lock`
- `data/*.db`, `data/*.sqlite*`
- `.agents/skills/trade-flow/data/`
- `profile/account_config.json`, `profile/notify_config.json`

若某个生成物需要被 review，优先写成小型 example / schema / docs 摘要，而不是强行提交完整运行数据。

## 5. 当前产物面快照

扫描时间：2026-07-09 15:27 CST。

| 区域 | 文件数 | 体量 | 管理状态 |
| --- | ---: | ---: | --- |
| `data/` | 178 | 181M | Git 边界清楚；长期/可复算混放 |
| `tmp/` | 182 | 1.4G | 已 ignore；缺 repo 内清理入口 |
| `.agents/skills/trade-flow/data/` | 202 | 4.6M | 已 ignore；属于 skill-local runtime data |
| `.codex/automations/` | 2 | 7.5K | 已 ignore；通过 automation memory path helper 访问 |

主要占用：

- `tmp/calibration-market-features-live/`：约 1.3G；44 个 feature report，占当前临时数据绝大多数。
- `data/artifacts/strategy-rnd/`：约 154M；其中 10 个 `*-features-*.json` 约 152M。
- `.agents/` 总体约 338M，主要是每个 TS skill 自带 `node_modules/`；这是依赖体量，不是运行产物。

数据库现状：

- `data/trade.db`：24K，仅 `plan_event` 表；当前 1 条 `observe`。
- `.agents/skills/trade-flow/data/trade.db`：24K，空库。
- `data/strategy-rnd-ledger.jsonl`：5 行。
- `data/strategy-evidence.jsonl`：2 行。

## 6. 当前治理状态

- DB 没有膨胀；大 payload 仍在文件系统，`data_catalog.db` 只索引元数据、hash、summary、引用关系与 retention。
- `data/`、`tmp/`、`.agents/skills/trade-flow/data/` 均可通过 catalog scan 纳入统一视图。
- `--catalog-stale` 已覆盖 `tmp/`、panel data、skill-local runtime data；默认只报告候选、保留原因与引用状态。
- `--catalog-gc --yes` 只删除 catalog 判定为 stale 的候选；`.pin`、引用、durable / evidence retention class 会保护文件。
- `data/artifacts/strategy-rnd/`、R&D ledger、strategy evidence、cron log、track output、feature report、panel / calibration / campaign / shadow tracker 已有结构化索引。
- `.agents/skills/trade-flow/data/market/` 与根 `data/ohlcv/` 仍按职责分层：前者是 automation / skill runtime cache，后者是项目级可复算数据。

## 7. 剩余边界

- catalog 是本地 SQLite 索引层；扫描 / 清理按顺序执行，不做并发写。
- 大型 feature series 不整体进 DB；只保存 source manifest、指标集合、coverage 与摘要。
- 历史文件不会被自动迁移目录；catalog 负责可发现、可追踪、可删判断。
- 真删除仍必须显式 `--catalog-gc --yes`；本轮只做 dry-run 和索引刷新。

## 8. 生成数据管道评估

| 管道 | 当前落地 | 结构化程度 | 判断 |
| --- | --- | --- | --- |
| online flow event | `data/trade.db.plan_event` | 中：SQLite + JSON body + 少量校验 | 方向正确；查询投影不足 |
| cron / track run | `data/cron.log` JSONL、`slow-track-*.json`、`fast-track-*.json` | 中：有 schema registry，但读取仍靠文件扫描 | 应进入 run catalog 或 DB 表 |
| OHLCV | CSV + `manifest.json` | 中：manifest 有 hash / closed candle 口径 | 文件可保留；需要 dataset catalog |
| tech feature report | 大 JSON feature series | 低到中：有 source manifest，但无统一索引 | 不宜全进 DB；需要摘要表 + artifact ref |
| R&D loop / campaign | `data/artifacts/strategy-rnd/*.json` + `strategy-rnd-ledger.jsonl` | 中：ledger 防重复，artifact 大而散 | ledger 应表化或至少有索引 |
| strategy evidence | `strategy-evidence.jsonl` | 中：append-only，shape 有 schema | 当前量小可 JSONL；升格前应表化 |
| calibration / validation panel | 目录 + per-symbol manifest + suite input | 中：可复算，但 panel 元数据散落 | 需要 panel catalog |
| automation memory | `.codex/automations/*/memory.md` | 低：人类摘要 | 不入业务 DB；只保留路径访问规范 |
| skill-local market cache | `.agents/skills/trade-flow/data/market/*` | 低到中：runtime cache | 应视为可删 cache，不作为事实源 |

核心问题不是“用了文件”本身，而是缺一层可查询 catalog：文件承载大 payload，DB 承载 run / dataset / artifact / reference / retention 元数据。

## 9. 数据库边界

当前实现与文档有一处偏差：`docs/tech-spec.md` 提到 `beta_cache`，但现有 `ensureSchema` 只创建 `plan_event`。若 β 风险控制进入真实读路径，必须补表或删掉文档承诺。

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

不建议入 DB 的内容：

- 完整 OHLCV candle 明细，除非进入高频查询 / backtest engine；届时单独 `ohlcv.db`。
- 完整 feature time series；只入 feature summary、hash、source manifest。
- 人读的 strategy Markdown 与 automation memory。
