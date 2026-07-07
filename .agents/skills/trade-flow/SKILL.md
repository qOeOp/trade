---
name: trade-flow
description: 4H+ swing 交易主流程 glue。只负责事件流落库、执行结果审计字段校验和最小 SQLite schema；不直接判断策略、不直接调用 Binance。
---

# Trade Flow

本 skill 是在线交易链的最小 glue：

```text
latest_observe.action_intent.request
  -> preflight
  -> execution_contract_snapshot
  -> execute skill / mock executor
  -> order_fill
```

## 何时使用

- 需要初始化 `./data/trade.db`
- 需要把执行 skill 返回结果写成 `plan_event(kind='order_fill')`
- 需要保证 `source=trade_flow` 的事件必含 `source_observe_event_key + execution_contract_snapshot`
- 需要把已 armable 的 preflight、contract input 和执行结果收束为可审计事件
- 需要先跑一条 end-to-end dry-run，确认主链能落库并读回
- 需要跑 shadow，记录真实观察后的影子动作，但不触发 Binance 写接口
- 需要加载 account config 和 strategy markdown
- 需要把 account / market skill 输出压成最小完整 observe event
- 需要通过统一 JSON adapter 调用其他 skill CLI
- 需要对 draft strategy 做机械 replay，产生 shadow / live-small 资格证据
- 需要用统一 replay core + strategy registry 回放不同策略
- 需要运行受搜索预算约束的 strategy R&D candidate batch
- 需要运行一轮可审计的 strategy R&D loop，并写入 R&D artifact / JSONL ledger
- 需要把 replay / shadow / live-small 样本写入 strategy evidence ledger
- 需要生成 strategy review 报告，判断 stale evidence / promotion gate / 下一步
- 需要按证据门槛把 strategy status 从 `draft -> shadow -> live-small / paused`
- 需要报告或清理过期、未引用、未 pin 的 replay / market artifact
- 需要从本地 `plan_event` 恢复单条 flow 的 current_orders / current_position / open_action_gap 投影
- 需要生成并显式 apply `source=reconcile` 补录事件

## 不该使用

- 不做市场分析
- 不生成交易观点
- dry-run 模式不调用 Binance
- 不替代 `plan-preflight`
- 不替代 `binance-order-preview / place / protect / adjust / cancel`

## 脚本

- 入口：`./scripts/main.ts`
- 示例输入：`./examples/*.example.json`
- 支持动作：
  - `--init`：初始化 `plan_event`
  - `--append-order-fill --json <body>`：校验并追加 order_fill
  - `--record-execution --json <payload>`：要求 `preflight_result.verdict=armable`，编译 `execution_contract`，把执行 skill 返回结果封成 `order_fill` 并落库
  - `--run --mode dry-run --json <payload>`：跑 `preflight -> contract -> mock execution -> order_fill -> reducer readback`
  - `--run --mode shadow --json <payload>`：同 dry-run，但 `execution_result.mode=shadow`
  - `--load-runtime --account-config <path> --strategies-dir <path>`：加载运行配置与 strategy policy
  - `--build-observe --json <payload>`：从账户 / 市场投影构建 observe event
  - `--observe-from-skills --json <payload>`：调用只读 `binance-account-snapshot` / `binance-symbol-snapshot` 后构建 observe event
  - `--replay-strategy --manifest <manifest> --strategy-id <id>`：读取 OHLCV manifest，通过 replay registry 机械回放策略，并输出统计与 gate
  - `--strategy-rnd-batch --json <payload>`：运行最多 10 个预声明候选的 R&D 批次，统一 replay/OOS，输出 winner 或 no_promote；可消费 `tech-indicators` report / feature series 做 indicator research，也可 `auto_candidates=true` 受限合成候选；不自动升格
  - `--strategy-rnd-loop --json <payload>`：运行一轮 R&D loop，写 artifact JSON 和 `strategy-rnd-ledger.jsonl`；不写 `trade.db`，不自动升格
  - `--append-strategy-evidence --strategy <path> --ledger <path> --json <payload>`：把 replay / shadow / live-small / review_batch 证据追加进 JSONL ledger
  - `--strategy-review --strategy <path> --ledger <path> [--db <path>]`：读取 strategy、evidence ledger 和可选 DB review，生成迭代报告
  - `--strategy-promote --strategy <path> --ledger <path> --to <status> [--yes]`：按 gate dry-run 或更新 strategy frontmatter status
  - `--artifact-gc --artifact-root <path> --retention-hours <n>`：报告或清理过期未引用 artifact；默认 dry-run，删除必须加 `--yes`
  - `--run-shadow-from-skills --json <payload>`：调用只读 snapshot skills，构建 observe，然后跑 shadow 链并落 `order_fill`
  - `--run-live-small --yes --json <payload>`：通过 `binance-order-place` 执行主单，并把返回结果落成 audited `order_fill`
  - `--recover-flow --chain-id <chain_id>`：从本地事件流 reduce 出 latest_observe / latest_order_fill / current_orders / current_position / open_action_gap
  - `--reconcile-flow --chain-id <chain_id> --json <account_snapshot>`：用传入账户快照生成 `source=reconcile` 草案
  - `--reconcile-from-skills --chain-id <chain_id> --json <payload>`：调用只读 `binance-account-snapshot --include-history` 后生成 `source=reconcile` 草案
  - `--apply-reconcile --yes --json <reconcile_result>`：把 `can_reconcile=true` 的 `source=reconcile` 草案 append 到本地 DB
  - `--cron-recover-from-skills --chain-id <chain_id> --json <payload>`：本地 reduce + 只读对账；有 `unmatched` 则 abort，无缺口则返回草案或在 `apply_reconcile=true + --yes` 时本地补录

## 约束

- `plan_event` 是 append-only
- `kind` 当前只允许 `observe / order_fill / review`
- `source=trade_flow` 的 order_fill 必须可追溯到 observe 与 execution contract
- `--record-execution` 不接受 blocked / abstain preflight
- `--run --mode dry-run|shadow` 遇到 blocked preflight 只返回 blocked 结果，不写 `order_fill`
- `--build-observe` 只构建事实快照，不判断交易，不写 DB
- `--observe-from-skills` 只调用只读 skill，不触发 Binance 写接口
- `--replay-strategy` 只读 OHLCV 文件，不写 DB，不触发 Binance；replay 结果只能作为 draft / shadow evidence
- `--strategy-rnd-batch` 只读 OHLCV 文件，不写 DB，不触发 Binance；候选必须预声明，最多 10 个 trial，单候选参数数最多 8
- `--strategy-rnd-loop` 只包装 batch、artifact 和 R&D ledger；R&D ledger 是研究审计，不是策略准入 evidence
- indicator 的发现、目录、解释和计算由 `tech-indicators` 提供；trade-flow 只消费其 report / feature series，不在 R&D 内硬编码全量指标体系
- `auto_candidates=true` 只做 bounded candidate synthesis；仍受 trial / parameter / OOS gate 约束，不能直接写 strategy status
- replay core 固定保守口径：同一 lane 不重叠持仓、同 K 同时触发 stop/target 时先算 stop、支持 fee/slippage bps、输出 replay gate
- `gate.live_small_candidate` 在 replay 阶段永远是 false；live-small 还必须经过 shadow 与人工确认
- strategy iteration 使用 `./data/strategy-evidence.jsonl` 这类 JSONL ledger；不新增 DB 表，不扩大 `plan_event.kind`
- 每条 evidence 绑定当前 `policy_hash`；strategy policy 改动后旧 evidence 自动变 stale，不可用于 promote
- `policy_hash` 只覆盖可交易策略定义；strategy markdown 中 `## Setup Certificate` 之前的研究引用、replay refs、迭代日志不应让 evidence stale
- `draft -> shadow` 需要 fresh replay 正收益，且 replay evidence 必须带 `anti_overfit.method=out_of_sample|walk_forward`
- anti-overfit proof 的 `oos_stats.sample_count` 至少 10，且 OOS 表现必须为正；`trial_count > 10` 或 `parameter_count > 8` 会被拒绝
- `shadow -> live-small` 需要 fresh replay + fresh shadow，且 shadow 样本数至少 20
- `--strategy-promote` 默认 dry-run；更新 strategy 文件必须显式 `--yes`
- `--artifact-gc` 不打开 DB、不触发 Binance；只扫描显式 `--artifact-root`，保留 `.pin` / referenced / durable store，默认不删除
- `--run-shadow-from-skills` 会写 shadow `order_fill`，但不触发 Binance 写接口
- `--run-live-small` 会触发 Binance 写接口；没有 `--yes` 必须拒绝
- `--recover-flow` 只读本地 DB；`submit` 只进入 current_orders，只有 `fill / partial_fill` 才改变 current_position
- `--reconcile-flow / --reconcile-from-skills` 只生成草案；遇到无法可靠归属的订单 / 仓位差异必须放进 `unmatched`
- `--apply-reconcile` 只写本地 DB，不调用 Binance；没有 `--yes`、`can_reconcile!=true` 或 draft 不是 `order_fill(source=reconcile)` 都必须拒绝
- `--cron-recover-from-skills` 是 cron 入口恢复胶水；对账不能可靠归属时只返回 abort，不继续 EXECUTE
- 子 skill 调用必须返回 JSON；非零退出或非 JSON 输出直接视为失败
- 插入使用 SQLite 主键天然幂等；重复 `event_key` 会被拒绝
