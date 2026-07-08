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
- 需要在总搜索预算内连续运行多条 hypothesis，并对 discovery winner 自动做不重叠外部验证
- 需要用固定多资产趋势基准和组合权重循环移位负对照标定 R&D 管线
- 需要运行固定 known-edge calibration suite，比较 beta baseline、趋势基准与横截面强弱基准
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
  - `--strategy-rnd-batch --json <payload>`：运行最多 10 个候选；`factor_discover=true + factor_compose=true` 时先做因子统计筛选，再按角色与参数预算组合到预声明 base family；统一 replay/OOS，不自动升格
  - `--strategy-rnd-loop --json <payload>`：运行一轮 R&D loop，写 artifact JSON 和 `strategy-rnd-ledger.jsonl`；不写 `trade.db`，不自动升格
  - `--strategy-rnd-campaign --json <payload>`：依次运行 hypothesis queue；未产生 discovery winner 才继续下一假设；首个 winner 冻结后只查看一次不重叠 locked holdout，通过即返回，失败即结束 campaign
  - `--strategy-panel-rnd --json <payload>`：同一候选在至少三个资产上复用统一 replay，保留逐资产证据并执行样本、广度、OOS、成本与灾难损失门槛
  - `--strategy-benchmark --json <payload>`：运行固定 30/90/180 日、15% 目标波动的多资产趋势基准、成本/资金费压力、时间折和组合权重循环移位负对照；只标定研究管线
  - `--strategy-calibration-suite --json <payload>`：运行 buy-and-hold / cash baseline、固定趋势基准、固定横截面强弱基准，并输出 beta、成本、funding、换手、暴露、时间稳定性、负对照与数据广度诊断；只回答 R&D 管线该先修哪里
  - `--strategy-signal --json <payload>`：用最新闭合 K 线与传入 `entry_price` 评估 candidate，并返回稳定 candidate hash；只返回 `entry / no_action`，不写 DB、不执行
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
- `--strategy-rnd-batch` 只读 OHLCV / factor report，不写 DB，不触发 Binance；base family 与搜索预算必须预声明，最多 10 个 trial，单候选参数数最多 8
- `--strategy-rnd-loop` 只包装 batch、artifact 和 R&D ledger；R&D ledger 是研究审计，不是策略准入 evidence
- `--strategy-rnd-campaign` 的总 discovery trial budget 最多 10；只接受预声明 hypothesis queue，validation manifest 必须与 discovery manifest 时间不重叠；locked holdout 只允许看一次，失败即结束 campaign
- discovery winner 含 indicator filter 时必须提供独立 `validation_indicator_report_path`，不得拿 discovery feature series 验证
- campaign 产出的 `validated_candidate_found` 仍只是待写 strategy policy 的候选，不自动进入 strategy evidence、shadow 或实盘
- `--strategy-benchmark` 固定规则且禁止参数搜索；结果只回答管线能否识别已知机制，不是策略准入证据，不进入 shadow / live
- `--strategy-calibration-suite` 固定规则且禁止参数搜索；buy-and-hold 只做 beta 诊断，`execution_attribution / failure_analysis` 用来暴露系统问题和下一步修复动作，suite 结果不进入 strategy evidence 或 promotion gate
- replay 与 `--strategy-signal` 调用同一 family：replay 注入下一根 open，在线评估注入当前可成交报价；family 不得读取未来 K 线
- `--strategy-signal` 默认要求最后一根闭合 K 线距当前不超过 1 个周期；陈旧或尚未闭合的数据直接拒绝
- factor 发现、目录、解释和计算由 `tech-indicators` descriptor 提供；trade-flow 只消费稳定 `factor_id` 与 feature series，不硬编码 indicator 名称
- factor condition 通用支持 `level / delta / slope / zscore / percentile` 与 `gt / lt / between`；旧 `indicator_filters` 自动映射为 `level`，仅用于兼容
- bounded composer 最多组合 3 个不同角色 factor、最多输出 10 个 candidate，并把 threshold 与 transform lookback 计入 8 参数上限；不做无界笛卡尔积
- `factor_discover=true` 先用 base family 的实际 setup/trade R 作为目标，再做 causal rank IC；全部扫描 factor 通过 5% FDR、时间折、regime 与 `|corr|>=0.85` 去重后才能成为 seed
- 多候选且样本足够时执行四时间块 rank-reversal 审计；反转率超过 50% 时 batch 不选 winner。它是轻量选择偏差诊断，不冒充完整 CSCV/PBO
- family 是少量市场机制的可执行实验模板，不追求穷举形态；未经 replay/OOS/成本/稳定性验证的 candidate 不进入长期 asset
- family 从 `scripts/lib/rnd-families/*.family.ts` 自动发现；新增 family 只新增模块，不修改 `strategy-rnd.ts`、union 或中央注册表
- 冻结 candidate 在不重叠外部样本上失败后必须停止；任何参数、过滤器或规则修改都作为新 hypothesis / trial，不能用调参覆盖失败结论
- `structure_breakout_retest_v1` 的结构位只从突破前历史窗口滚动计算，固定要求收盘突破、随后回踩守住，不消费事后生成的支撑阻力
- 当前 family 覆盖 trend pullback、structure breakout/retest、time-series momentum 与 volatility compression breakout 四类机制；不是形态百科
- replay core 固定保守口径：同一 lane 不重叠持仓、同 K 同时触发 stop/target 时先算 stop、止损跳空按更差开盘、支持 fee/slippage；factor report 含 funding events 时按方向与结算时点逐次计费，否则使用 adverse funding stress；训练标签跨 OOS 边界时 purge
- funding events 若未覆盖完整 replay 区间或存在大于 9 小时缺口，证据标记 `R-FUNDING-COVERAGE`，不得进入 shadow
- `gate.live_small_candidate` 在 replay 阶段永远是 false；live-small 还必须经过 shadow 与人工确认
- strategy iteration 使用 `./data/strategy-evidence.jsonl` 这类 JSONL ledger；不新增 DB 表，不扩大 `plan_event.kind`
- replay evidence 绑定 `policy_hash + harness_hash + data_hash + assumptions_hash`；OHLCV 与实际消费的 factor report 同属 data hash，任一变化、数据不可用或 checksum 不符即 stale
- promotion 只接受 `schema_version>=2`、`closed_candles_only=true` 且 checksum 可核验的数据；旧 manifest 可研究，不可准入
- `policy_hash` 只覆盖可交易策略定义；strategy markdown 中 `## Setup Certificate` 之前的研究引用、replay refs、迭代日志不应让 evidence stale
- 普通 chronological tail split 只算 `selection_validation`，不能授权 shadow；`draft -> shadow` 必须带 `stage=locked_holdout` 的 OOS / walk-forward proof
- `external_validation` 使用完整不重叠区间，但只做研究确认；已被项目查看过的数据不能冒充 locked holdout，也不能授权 shadow
- anti-overfit proof 的 `oos_stats.sample_count` 至少 10，且 OOS 表现必须为正；`trial_count > 10` 或 `parameter_count > 8` 会被拒绝
- replay evidence 必须在至少两个有效 market regime 分桶中具备稳定性，在额外单边 5 bps 成本后仍为正，并通过预声明的 ±10% 参数扰动
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
