# Architecture Inventory

快照时间：2026-07-08（Asia/Shanghai）

用途：作为 `architecture-cleanup-plan.md` 的 P0 基线。本文记录当前 tool、command、权限 class、代码热点与测试入口；后续每轮整理按此 diff。

## 1. 权限 class

| Class | 含义 |
| --- | --- |
| `R` | 只读事实；不写本地状态，不触发 Binance 写接口 |
| `A` | 分析 / 研究；可写 artifact，不写 `trade.db` |
| `E` | 写 evidence / R&D ledger；不写 `trade.db` |
| `V` | 写本地事件或配置；不触发 Binance 写接口 |
| `T` | 触发 Binance 写接口 |
| `C` | 读写敏感配置 / 凭证 |

## 2. Tool inventory

| Tool | Class | 当前职责 | 写入面 | 整理动作 |
| --- | --- | --- | --- | --- |
| `binance-account-snapshot` | `R` | 账户、持仓、挂单、历史订单快照 | none | 保持只读；输出字段进入 account fact contract |
| `binance-symbol-snapshot` | `R` | 单标的价格、funding、OI、轻量 K 线 | none | 保持只读；不得输出 action intent |
| `binance-aggtrades-fetch` | `R/A` | aggTrades 原材料 | artifact/stdout | 保持数据 tool；不进入 trade.db |
| `binance-liquidation-zones` | `A` | liquidation-like zone 推断 | artifact/stdout | 输出 refs；不得变成裸信号 |
| `binance-market-scan` | `A` | 全市场候选粗筛 | stdout/artifact | 只能回答“先看谁”；不得触发 live action |
| `ohlcv-fetch` | `R/A` | OHLCV / Binance Vision / calibration 数据 | CSV/manifest/artifact | 只产数据，不做 replay gate |
| `tech-indicators` | `A` | 指标、结构、factor descriptor、beta | report/artifact | 不知道交易动作；只输出 feature/report |
| `plan-preflight` | `A` | hard guards、decision card | stdout | 保持独立 guard；不写事件 |
| `trade-flow` | `E/V/T` | 在线链 glue、event、execution recording、recovery、automation | trade.db / track artifact / optional Binance | 已移除 R&D / review / artifact 旧入口；继续保持入口瘦身 |
| `strategy-rd` | `A/E` | replay、R&D、panel、benchmark、calibration、forward tracker、RD memory | research artifact / catalog metadata / strategy draft | 保持不写 `trade.db`、不触发 Binance |
| `strategy-review` | `E/V` | evidence、review、promotion gate | catalog evidence / strategy markdown | 不写 RD memory、不触发执行 |
| `artifact-catalog` | `A/V` | catalog、stale scan、artifact GC、feature refs | data_catalog.db / selected file deletion | 不做策略判断、不写 `trade.db` |
| `runtime-policy` | `C/A` | 目标模块：统一交易配置读取、校验、合成、hash | stdout / observe policy snapshot | 设计见 `docs/trading-config.md`；尚未实现为独立命令 |
| `binance-order-preview` | `A` | 执行预演、方法路由、contract compile | stdout | 统一 contract output；不发单 |
| `binance-order-place` | `T` | USDM 主单开仓 / 加仓 | Binance | 只接受 executor 编译后的 contract 作为推荐路径 |
| `binance-position-protect` | `T` | 止损、止盈、trailing 保护腿 | Binance | 输出 normalized event |
| `binance-position-adjust` | `T` | 已有仓位减仓 / 全平 | Binance | 防御动作允许在 recovery 中使用 |
| `binance-order-cancel` | `T` | 普通单 / algo 单撤单 | Binance | 防御动作；必须可审计 |
| `position-monitor` | `A/V?` | 持仓监控 orchestration | 视调用而定 | 需要明确是否只建议还是会调用执行 |
| `notify-dispatch` | `V` | 通知派发 + cron.log fallback | cron.log / external channel | 不改变 flow 状态 |

## 3. Current Command Ownership

### `trade-flow`

| Command | Class | 当前作用 | Owner |
| --- | --- | --- | --- |
| `--init` | `V` | 初始化 `plan_event` | `runtime` |
| `--append-order-fill` | `V` | 追加本地 order_fill | `runtime/execution` |
| `--record-execution` | `V` | contract + execution result -> audited order_fill | `execution` |
| `--run --mode dry-run` | `V` | mock 链路落库 | `execution` |
| `--run --mode shadow` | `V/E` | shadow order_fill | `execution/evidence` |
| `--load-runtime` | `R/C` | 读取 trading config、编译 runtime policy、适配 deprecated account config / strategy | `runtime/config` |
| `--build-observe` | `V` | 构建 observe event | `observe` |
| `--observe-from-tools` | `R/V` | 调只读 tool + observe | `observe` |
| `--run-shadow-from-tools` | `R/V/E` | 只读 facts + shadow 链 | `observe/execution` |
| `--run-live-small` | `T` | Binance 主单执行 + audited order_fill | `execution` |
| `--recover-flow` | `R` | 本地 reduce | `recovery/runtime` |
| `--reconcile-flow` | `R/A` | snapshot -> reconcile drafts | `recovery` |
| `--reconcile-from-tools` | `R/A` | account snapshot + drafts | `recovery` |
| `--apply-reconcile` | `V` | apply safe reconcile drafts | `recovery/runtime` |
| `--cron-recover-from-tools` | `R/V` | cron 入口恢复胶水 | `recovery` |

### Migrated owner commands

| Command | Class | 当前 owner |
| --- | --- | --- |
| `research.replay-runner` | `E` | `modules/research/replay-runner` |
| `--strategy-rnd-*`, `--strategy-panel-rnd`, `--strategy-data-split`, `--strategy-benchmark`, `--strategy-calibration-suite`, `--strategy-signal`, `--rd-program-state`, `--rd-supervisor-run`, `--rd-shadow-tracker` | `A/E` | `modules/research/strategy-rd` |
| `--append-strategy-evidence`, `--strategy-review`, `--strategy-promote`, `--strategy-cycle` | `E/V` | `modules/governance/strategy-review` |
| `--catalog-*`, `--artifact-gc` | `A/V` | `modules/ops/artifact-catalog` |

## 4. 当前代码热点

| 文件 | 行数级别 | 风险 | 目标 |
| --- | ---: | --- | --- |
| `modules/trade-flow/src/scripts/main.ts` | ~1500 | command router + 业务逻辑混合 | 拆 `commands/*` |
| `modules/trade-flow/src/scripts/main.test.ts` | ~1375 | 大集成测试难定位 | 按 domain fixture 拆 |
| `modules/research/strategy-rd/src/lib/strategy-rnd.ts` | 已迁移 | R&D glue 仍偏重 | 继续按 candidate / evaluation / selection 收敛 |
| `modules/research/strategy-rd/src/lib/strategy-benchmark.ts` | 已迁移 | benchmark / calibration glue | 后续按 data / simulation / report 收敛 |
| `modules/research/strategy-rd/src/lib/strategy-replay.ts` | 已迁移 | replay contract owner | 继续保持只读 research 边界 |
| `modules/governance/strategy-review/src/lib/strategy-iteration.ts` | 已迁移 | evidence / review / promote owner | 继续强化 catalog-backed evidence |
| `modules/binance/order-place/src/scripts/main.ts` | ~1021 | 执行入口复杂，安全关键 | contract-first + normalized event |
| `modules/analytics/tech-indicators/src/scripts/structure.go` | ~1204 | 指标/结构算法集中 | 后续按 indicator/domain 拆 |

## 5. 测试入口基线

项目级“改了哪里跑什么”见 [check-contract.md](check-contract.md)。本节只保留 P0 盘点时的粗入口。

| Area | 当前入口 |
| --- | --- |
| TS tool | 各 tool `bun run check` |
| `trade-flow` | `modules/trade-flow`: `bun run check` |
| `plan-preflight` | `modules/guards/plan-preflight`: `bun run check` |
| Binance TS tools | 各 tool `bun run check`; live/test endpoint 默认关闭 |
| `tech-indicators` | Go tests：`go test ./...` |
| liquidation zones | Python tests：`pytest` 或脚本自带测试 |

## 6. P0 结论

- `node_modules` 当前未被 Git 跟踪，`.gitignore` 已覆盖依赖目录。
- 原最大整理风险曾集中在 `trade-flow`：online + research + recovery + evidence 混合命令总线已拆为 `trade-flow` / `strategy-rd` / `strategy-review` / `artifact-catalog`。
- 第一批迁移已改为全迁移原则：移动与分包后删除旧 CLI 入口，以 owner 模块 contract 和质量检查作为硬验收。
