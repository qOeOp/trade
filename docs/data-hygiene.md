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
| replay / R&D / calibration artifact | 否 | `data/artifacts/`, `data/calibration-panel-*/` |
| OHLCV / market data | 否 | `data/ohlcv/` |
| local operator config | 否 | `profile/account_config.json`, `profile/notify_config.json` |

需要长期保留但不进 Git 的产物，放在 `data/artifacts/` 或对应 data 子目录，用 `.pin` 或 evidence / ledger ref 保护。

## 2. 放置规则

- 原始行情、OHLCV、calibration panel：写 `data/ohlcv/` 或 `data/calibration-panel-<date>/`
- replay / R&D / calibration 报告：写 `data/artifacts/<domain>/`
- 策略准入证据：写 `data/strategy-evidence.jsonl`
- R&D 审计：写 `data/strategy-rnd-ledger.jsonl`
- cron 运维日志：写 `data/cron.log`
- 可提交的最小 fixture：放 skill 自己的 `examples/` 或测试 fixture，不放 `data/`

## 3. 清理规则

- 删除必须显式；默认只 dry-run。
- `data/artifacts/` 下被 `.pin`、evidence ref、ledger ref 或 durable 目录保护的文件不得删。
- 未引用、未 pin、超过 retention 的 artifact 可由 `trade-flow --artifact-gc` 报告或清理。
- `data/ohlcv/` 与 `data/calibration-panel-*/` 是可再生市场数据；清理前只需确认没有被当前 evidence / report 引用。

## 4. 当前 `.gitignore` 约定

`.gitignore` 已覆盖：

- `data/artifacts/`
- `data/ohlcv/`
- `data/calibration-panel-*/`
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
