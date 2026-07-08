# Architecture Inventory

快照时间：2026-07-08（Asia/Shanghai）

用途：作为 `architecture-cleanup-plan.md` 的 P0 基线。本文记录当前 skill、command、权限 class、代码热点与测试入口；后续每轮整理按此 diff。

## 1. 权限 class

| Class | 含义 |
| --- | --- |
| `R` | 只读事实；不写本地状态，不触发 Binance 写接口 |
| `A` | 分析 / 研究；可写 artifact，不写 `trade.db` |
| `E` | 写 evidence / R&D ledger；不写 `trade.db` |
| `V` | 写本地事件或配置；不触发 Binance 写接口 |
| `T` | 触发 Binance 写接口 |
| `C` | 读写敏感配置 / 凭证 |

## 2. Skill inventory

| Skill | Class | 当前职责 | 写入面 | 整理动作 |
| --- | --- | --- | --- | --- |
| `binance-account-snapshot` | `R` | 账户、持仓、挂单、历史订单快照 | none | 保持只读；输出字段进入 account fact contract |
| `binance-symbol-snapshot` | `R` | 单标的价格、funding、OI、轻量 K 线 | none | 保持只读；不得输出 action intent |
| `binance-aggtrades-fetch` | `R/A` | aggTrades 原材料 | artifact/stdout | 保持数据 skill；不进入 trade.db |
| `binance-liquidation-zones` | `A` | liquidation-like zone 推断 | artifact/stdout | 输出 refs；不得变成裸信号 |
| `binance-market-scan` | `A` | 全市场候选粗筛 | stdout/artifact | 只能回答“先看谁”；不得触发 live action |
| `ohlcv-fetch` | `R/A` | OHLCV / Binance Vision / calibration 数据 | CSV/manifest/artifact | 只产数据，不做 replay gate |
| `tech-indicators` | `A` | 指标、结构、factor descriptor、beta | report/artifact | 不知道交易动作；只输出 feature/report |
| `plan-preflight` | `A` | hard guards、decision card | stdout | 保持独立 guard；不写事件 |
| `trade-flow` | `E/V/T` | 在线链 glue、event、execution recording、recovery、R&D、evidence | trade.db / ledger / artifact / optional Binance | 拆 domain owner；入口瘦身 |
| `binance-order-preview` | `A` | 执行预演、方法路由、contract compile | stdout | 统一 contract output；不发单 |
| `binance-order-place` | `T` | USDM 主单开仓 / 加仓 | Binance | 只接受 executor 编译后的 contract 作为推荐路径 |
| `binance-position-protect` | `T` | 止损、止盈、trailing 保护腿 | Binance | 输出 normalized event |
| `binance-position-adjust` | `T` | 已有仓位减仓 / 全平 | Binance | 防御动作允许在 recovery 中使用 |
| `binance-order-cancel` | `T` | 普通单 / algo 单撤单 | Binance | 防御动作；必须可审计 |
| `position-monitor` | `A/V?` | 持仓监控 orchestration | 视调用而定 | 需要明确是否只建议还是会调用执行 |
| `notify-dispatch` | `V` | 通知派发 + cron.log fallback | cron.log / external channel | 不改变 flow 状态 |

## 3. `trade-flow` command inventory

| Command | Class | 当前作用 | 整理 owner |
| --- | --- | --- | --- |
| `--init` | `V` | 初始化 `plan_event` | `runtime` |
| `--append-order-fill` | `V` | 追加本地 order_fill | `runtime/execution` |
| `--record-execution` | `V` | contract + execution result -> audited order_fill | `execution` |
| `--run --mode dry-run` | `V` | mock 链路落库 | `execution` |
| `--run --mode shadow` | `V/E` | shadow order_fill | `execution/evidence` |
| `--load-runtime` | `R/C` | 读取 account config / strategy | `runtime` |
| `--build-observe` | `V` | 构建 observe event | `observe` |
| `--observe-from-skills` | `R/V` | 调只读 skill + observe | `observe` |
| `--replay-strategy` | `A` | 单 strategy replay | `research/replay` |
| `--strategy-rnd-batch` | `A` | 候选 batch | `research/rnd` |
| `--strategy-rnd-loop` | `A/E` | R&D artifact + ledger | `research/rnd` |
| `--strategy-rnd-campaign` | `A/E` | hypothesis campaign | `research/rnd` |
| `--strategy-panel-rnd` | `A` | 多资产候选评估 | `research/rnd` |
| `--strategy-benchmark` | `A` | 固定 benchmark | `research/calibration` |
| `--strategy-calibration-suite` | `A` | calibration suite | `research/calibration` |
| `--strategy-signal` | `A` | 最新闭合 K 候选信号 | `research/signal` |
| `--append-strategy-evidence` | `E` | strategy evidence ledger | `evidence` |
| `--strategy-review` | `E` | evidence + DB review gate | `evidence` |
| `--strategy-promote` | `E/V` | strategy frontmatter status | `evidence` |
| `--artifact-gc` | `A/V` | artifact dry-run / delete | `artifacts` |
| `--run-shadow-from-skills` | `R/V/E` | 只读 facts + shadow 链 | `observe/execution` |
| `--run-live-small` | `T` | Binance 主单执行 + audited order_fill | `execution` |
| `--recover-flow` | `R` | 本地 reduce | `recovery/runtime` |
| `--reconcile-flow` | `R/A` | snapshot -> reconcile drafts | `recovery` |
| `--reconcile-from-skills` | `R/A` | account snapshot + drafts | `recovery` |
| `--apply-reconcile` | `V` | apply safe reconcile drafts | `recovery/runtime` |
| `--cron-recover-from-skills` | `R/V` | cron 入口恢复胶水 | `recovery` |

## 4. 当前代码热点

| 文件 | 行数级别 | 风险 | 目标 |
| --- | ---: | --- | --- |
| `.agents/skills/trade-flow/scripts/main.ts` | ~1500 | command router + 业务逻辑混合 | 拆 `commands/*` |
| `.agents/skills/trade-flow/scripts/main.test.ts` | ~1375 | 大集成测试难定位 | 按 domain fixture 拆 |
| `.agents/skills/trade-flow/scripts/lib/strategy-rnd.ts` | ~1245 | R&D 输入、搜索、评估、报告混合 | 拆 `research/rnd/*` |
| `.agents/skills/trade-flow/scripts/lib/strategy-benchmark.ts` | ~876 | benchmark / calibration / null 混合 | 拆 `research/calibration/*` |
| `.agents/skills/trade-flow/scripts/lib/replay-core.ts` | ~746 | loader / indicators / matching / gate 混合 | 拆 `research/replay/*` |
| `.agents/skills/trade-flow/scripts/lib/strategy-iteration.ts` | ~613 | evidence / review / promote 混合 | 拆 `evidence/*` |
| `.agents/skills/binance-order-place/scripts/main.ts` | ~1021 | 执行入口复杂，安全关键 | contract-first + normalized event |
| `.agents/skills/tech-indicators/scripts/structure.go` | ~1204 | 指标/结构算法集中 | 后续按 indicator/domain 拆 |

## 5. 测试入口基线

| Area | 当前入口 |
| --- | --- |
| TS skill | 各 skill `bun run check` |
| `trade-flow` | `.agents/skills/trade-flow`: `bun run check` |
| `plan-preflight` | `.agents/skills/plan-preflight`: `bun run check` |
| Binance TS skills | 各 skill `bun run check`; live/test endpoint 默认关闭 |
| `tech-indicators` | Go tests：`go test ./...` |
| liquidation zones | Python tests：`pytest` 或脚本自带测试 |

## 6. P0 结论

- `node_modules` 当前未被 Git 跟踪，`.gitignore` 已覆盖依赖目录。
- 最大整理风险集中在 `trade-flow`：它已成为 online + research + recovery + evidence 的混合命令总线。
- 第一批代码实施应只做“移动与分包，不改行为”，并以旧 CLI 兼容作为硬验收。
