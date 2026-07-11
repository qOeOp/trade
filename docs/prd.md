# PRD

## 1. 范围

当前产品只服务一个闭环：

```text
cron / user message
  -> OBSERVE
  -> PLAN + preflight
  -> EXECUTE
  -> REVIEW
```

目标是让 agent 基于 Binance USDM 事实、setup 资格证和 hard guards，安全推进少量 4H+ swing 实盘机会。

不做交易 SaaS、UI、跨账户、跨交易所、日内 probe、hedge 多腿。

完整系统保留离线验证链，但只作为 setup 准入机制，不展开成平台化研究系统：

```text
research / review
  -> replay / backtest
  -> shadow
  -> live-small / paused
```

外部调度只保留一条 automation supervisor。它按快轨频率唤醒，通过 `--automation-cycle` 生成任务图，再用 subagent 隔离并行盯市、慢轨、strategy R&D supervisor、R&D forward tracker 与 artifact 检查；任意时刻最多一个 worker 写 `trade.db`。平仓 review 优先由本轮闭合事件触发，并在交易 / 对账之后串行执行；低频 sweep 只负责补漏。

产品形态不是多条长期 automation，而是一个总控入口管理多条 job line：

```text
single automation entry
  -> supervisor plan
  -> cadence / lock / concurrency / permission gate
  -> subagent fan-out
     -> live opportunity watch
     -> active flow guard
     -> shadow / forward validation
     -> new strategy R&D
     -> closed-flow review
     -> catalog / artifact hygiene
  -> supervisor summary
```

总控只负责调度、隔离、权限与收口，不替代各 job 的专业判断。subagent 是上下文隔离和并行机制，不是新的事实源；所有事实仍必须落到 `trade.db`、research artifact、catalog DB 或 strategy 文件这些可审计资产里。

| Job line | 目标 | 可写入 | 不允许 |
| --- | --- | --- | --- |
| `fast_track_guard` | 守护 active flow、触发慢轨已授权动作、同步保护与对账 | `trade.db` light observe / order_fill | 新建 thesis、扩大风险、改策略 |
| `slow_track_market_watch` | 用 live-small 策略寻找和管理真钱机会 | `trade.db` full observe / order_fill | 绕过 preflight / execution contract |
| `rd_forward_shadow_trackers` | 接着验证已冻结 / 已触发的 paper 或 shadow 样本 | R&D tracker artifact / catalog | 生成 strategy evidence、触发 Binance |
| `rd_strategy_supervisor` | 自主研发新策略，失败经验进入下一轮 hypothesis | research artifact / catalog / gated draft strategy | 写 `trade.db`、调用 Binance、无界搜索 |
| `closed_flow_review_sweep` | 对已闭合 flow 做复盘并推动策略迭代 | `trade.db` review / review artifact | 与交易写入并行封口 |
| `catalog_hygiene_scan` | 维护 artifact 可见性、引用、过期候选 | `data_catalog.db` | 删除未确认资产、影响交易事实 |

优雅点在于：总控每次只生成“本轮该跑什么”的任务图；各 job line 自己有 cadence、权限和停止条件。真钱交易、shadow 验证、新策略研发、复盘迭代可以并行思考，但写事实时仍被 concurrency group 串行化。

## 2. 固定术语

| 术语 | 定义 |
| --- | --- |
| `strategy` | 规则模板；不等于实盘资格 |
| `setup` | strategy 内一个可验证的交易机会；live 动作必须引用 `setup_id` |
| `lane` | `strategy_ref + symbol + side` 的运行槽位 |
| `flow` | 一笔具体机会 / 暴露的生命周期 |
| `observe` | 本轮最小完整决策快照 |
| `order_fill` | 交易所提交、撤改、成交或对账补录事实 |
| `review` | flow 阶段性闭合后的最小复盘样本 |
| `execution_contract` | 提交前由 observe / request / 账户事实 / 交易所规格编译出的执行快照 |

## 3. 实盘准入

任何 `target_action != no_action` 且会新增风险的动作，必须满足：

- strategy / setup 已获 `live-small`
- runtime live gate 允许当前账户进入真钱路径
- `setup_id` 存在
- 账户、挂单、持仓、价格事实新鲜
- stop / invalidation / risk_budget 完整
- setup 有 replay / shadow / live 对齐契约
- preflight 通过
- `execution_contract_snapshot` 已生成
- 对账未失败

未满足时只能 observe、shadow 或减风险。

## 4. Strategy / Setup

strategy 文件使用 markdown + frontmatter：

```yaml
---
strategy_id: S-XXX
name: text
status: draft | shadow | live-small | paused
tags: []
---
```

每个可交易 setup 至少声明：

- `setup_id`
- `hypothesis`
- `regime`
- `entry_rule`
- `stop_rule`
- `no_trade_conditions`
- `size_policy`
- `evidence_ref`
- `live_permission`
- `execution_alignment`

`execution_alignment` 至少说明：

| 字段 | 含义 |
| --- | --- |
| `signal_source` | replay family / strategy rule / manual setup |
| `signal_timing` | confirmed closed candle / trigger condition / manual |
| `execution_timing` | next bar open / current mark / limit trigger |
| `exit_owner` | protective order / strategy rule / manual review |
| `same_bar_policy` | stop_first / no_same_bar / not_applicable |
| `cost_model` | fee / slippage / funding / gap 假设 |
| `live_deviation_policy` | live 与 replay 偏差如何进入 review |

`draft` 只能分析；`shadow` 可记录影子动作，不提交 Binance；`live-small` 才能小资金实盘；`paused` 只允许观察和减风险。

## 5. Replay / Backtest / Shadow

这条链路只回答一个问题：setup 有没有资格动真钱。

Strategy R&D 不是单次实验交互，而是受预算约束的学习 loop：

```text
上轮 failure_summary / reliability_gate / universe_lesson
  -> 下一条 hypothesis
  -> data split / campaign / panel / validation
  -> 若通过 gate，冻结 contract 并进入 forward / shadow
  -> 若失败，沉淀 rejected mechanism 与下一轮约束
```

停止条件固定为：`shadow_candidate_found / budget_exhausted / data_or_tool_blocked`。R&D supervisor 可以由 automation 分发给 subagent，但只允许写 research artifact、catalog metadata 与 gated strategy draft；不得写 `trade.db`、不得调用 Binance 写接口、不得把失败后调参继续伪装成同一 hypothesis。

R&D supervisor 可以临时分发 read-only scout subagent 来做历史失败审计、数据可用性盘点和新 edge 草拟；这些 scout 只产出 proposal，不写 `rd_program_state`、不消耗 trial、不打开 holdout。R&D 只有一个 state writer：`strategy-rd-supervisor` 通过 `--rd-program-state` / R&D payload writeback 更新 queue、usage 与 stop status。

持续 R&D 的事实源是机器可读 `rd_program_state` artifact，而不是临时对话记忆。它保存 objective、budget、usage、stop status、失败摘要、reliability gate、被拒机制、universe lesson、下一轮 hypothesis queue 与 artifact refs；状态为 `active` 时总控才继续派发 `rd_strategy_supervisor`，进入 `shadow_candidate_found / budget_exhausted / data_or_tool_blocked` 后自动停线。该 state 只属于 research memory，不是 strategy evidence。

`rd_program_state` 的写入必须显式：`--rd-program-state` 负责 init/read/update/plan_next；`plan_next` 只读 state，把 `next_hypothesis_queue` 编译为下一轮 `--strategy-rnd-loop` 或 `--strategy-rnd-campaign` payload 草案。`--rd-supervisor-run` 串起 `plan_next -> loop/campaign -> state writeback`，让 R&D 进入后自主循环到候选、预算耗尽或数据/工具阻断。`--strategy-rnd-loop` / `--strategy-rnd-campaign` 只有在 payload 传入 `rd_program_state_path` 时才把本轮 artifact、usage、失败机制或 validated candidate 写回；`strategy-review` 只输出 execution attribution、成本反馈和 replay-to-shadow/live decay 诊断，不直接写 RD memory，后续由 R&D supervisor 显式消费。

最小输入：

- `setup_id`
- 样本范围
- 入场规则
- stop 规则
- size 规则
- fee / slippage / funding 假设

最小输出：

- 样本数
- 净 R 或净 pnl
- 最大回撤
- 失败类型
- 是否允许进入 `shadow` 或 `live-small`

Replay / shadow / live 对齐要求：

- 没有 `execution_alignment` 的 replay 只能研究，不能作为升格 evidence。
- replay 成交口径、shadow 记录口径、live 执行口径必须能互相解释；偏差进入 review，不许事后改 replay 假设圆结果。
- `exit_owner` 只能有一个主负责人；保护单可兜底，但不得和 strategy exit 形成重复平仓竞争。
- `same_bar_policy` 必须固定；同 K 同时触发 stop/target 时不得由实现细节随机决定。

当前实现映射：

- `strategy-replay`：OHLCV manifest loader / 指标缓存 / 单 lane 撮合 / R 统计 / fee + slippage / replay gate / strategy definition
- `research.replay-runner`：只读文件，不写 DB，不触发 Binance
- `--strategy-rnd-batch`：最多 10 个候选；可先在 discovery 数据上筛 factor，再按角色、数量与参数预算组合到预声明 base family；统一 replay/OOS、candidate negative controls 和失败归因，不自动升格
- `--strategy-rnd-loop`：包装一轮 R&D batch，写 artifact JSON 与 `data_catalog.db.strategy_rnd_run`；R&D 审计不作为 promote evidence；可显式写回 `rd_program_state`
- `--strategy-rnd-campaign`：在全局最多 10 次 discovery trial 内运行 hypothesis queue；每个 hypothesis 必须带 `thesis_certificate`，缺 edge 类型、行为假设、参与者、regime、失效条件、成本敏感度、候选 universe 或 negative controls 时零 trial 停止；可选 `calibration_report_path` 未过则零 trial 停止；没有 winner 才继续，首个 winner 冻结后只查看一次不重叠 locked holdout，失败即结束 campaign；可显式写回 `rd_program_state`
- `--strategy-panel-rnd`：同一候选跨至少 3 个资产评估，保留逐资产证据，并检查 pooled sample、广度、OOS、成本与灾难损失
- `research.data-split`：新 hypothesis 开研前把历史 manifest 先切成 discovery / validation / locked_holdout 三个独立 manifest，并自动留 embargo；避免 draft 后才发现所有历史都已被研发污染
- `--rd-program-state`：初始化、读取、更新或 `plan_next` R&D learning memory artifact；`plan_next` 只生成下一轮 R&D payload，不写 `trade.db`，不产生 strategy evidence
- `--rd-supervisor-run`：执行自主 R&D supervisor loop；每轮先从 state 规划下一条 hypothesis，再运行 loop/campaign，并依赖写回结果推进 queue、usage 与 stop status
- `--automation-cycle`：单一 automation 入口的 supervisor plan；外部 Codex automation 可按任务图用 subagent 分发 fast / slow / R&D / review / catalog，慢轨、R&D 与 review 由 cadence gate 控制，不随快频入口每轮运行
- `research.benchmark-runner`：用固定多资产趋势规则、15% 目标波动、成本/资金费压力和组合权重循环移位负对照标定 R&D 管线；不写 DB、不产生准入证据
- `research.calibration-suite`：固定跑 buy-and-hold / cash baseline、趋势基准、横截面强弱基准，可消费 dataset `indicator_report_path` 中的 exact funding events 与 `symbol_status`，并输出 report hash、可选 previous-run comparison、data_panel、survivor-only 标记、beta、fee/slippage 成本拆分、funding、换手、暴露、时间/趋势/波动 regime 稳定性、time-shift / side-flip / asset-shuffle 负对照与数据广度归因；只暴露系统问题，不产生准入证据
- `research.signal-evaluator`：candidate 可由 JSON 输入或 strategy `## Trade Contract` 编译；在最新闭合 K 线上复用 replay family 并返回稳定 hash；entry reference 由在线报价注入，只返回信号，不执行、不落交易事实
- `strategy-rd` forward holdout：对已冻结 candidate 做只读 forward holdout 验收；主数据与 benchmark / supplemental 数据都必须晚于机器可读 `frozen_at`，输出 `status / next_action / frozen_candidate hash`，只作为 shadow/review 前置观察，不直接产生 promotion evidence；缺 `frozen_at` 的“frozen”描述一律不验收
- `strategy-rd --rd-shadow-tracker`：把 forward entry 信号转成 R&D schema v2 行为事件链，用 `open_setup -> observe_setup[] -> close_setup -> review_setup` 记录纸面样本，并由 projection 判定 stop / target / time_exit；不写 DB、不执行、不等同 strategy shadow evidence
- R&D tracker 事件链设计见 [rd-event-chain-design.md](rd-event-chain-design.md)；该链只存在于 R&D artifact，不进入 `trade.db.plan_event`
- replay 只能给 `shadow_candidate`；`live-small` 必须另有 shadow 样本、execution attribution 与人工确认
- strategy review 固定输出 replay -> shadow -> live-small decay diagnostics 与 `cost_model_feedback`；shadow 相对 replay 的 avg_r 保留率过低时阻断 live-small，真实 fee / slippage / funding drag 会反灌为下一轮 replay cost stress 输入，而不是靠叙事解释
- candidate family 只承载少量可检验市场机制，不做形态百科；只有通过样本外、成本和稳定性门槛的版本才可沉淀为策略 asset
- factor 由 indicator 自身 catalog descriptor 自动发现，统一使用稳定 `factor_id`；family 由目录模块自动发现，两者新增都不改 R&D core 或中央注册表
- factor transform 固定为 `level / delta / slope / zscore / percentile`，condition 固定为 `gt / lt / between`；composer 最多 3 个不同角色 factor、10 个候选、8 个参数
- scientific factor discovery 以 base family 实际 setup 的 realized R 为目标做 causal rank IC；全部被扫描 factor 统一做 5% FDR，再检查时间折、regime 与 `|corr|>=0.85` 去重。筛选结果只是 seed，不是 edge 结论
- R&D batch 固定输出 `statistical_report`，记录完整 trial universe、accepted/rejected、winner、OOS/effective sample、edge margin、deflated edge probability 与四时间块 CSCV/PBO；当前不等同完整 White Reality Check / Hansen SPA
- replay 对训练标签跨 OOS 分界做 purge；多候选样本足够时执行四时间块选择反转审计
- candidate R&D 固定输出 side-flip 与 entry-lag negative controls；候选为正但打不过有效 negative control 时不能进入下一阶段
- replay 成本包含 fee、slippage、止损 gap；有 funding events 时逐次结算，无事件时才使用 adverse funding fallback；历史 L2 queue 缺失时不估算 maker fill
- `data_catalog.db.strategy_evidence`：保存 replay / shadow / live-small / review_batch 证据，不进入 `trade.db`
- evidence fingerprint：`policy_hash + harness_hash + data_hash + assumptions_hash + temporal_contract`；data hash 同时覆盖 OHLCV 与消费的 factor report，temporal contract 记录 closed-candle reference、availability、lookback、label end、universe selection，策略、回放代码、数据、时点合同或假设任一变化均使旧证据 stale
- `anti_overfit`：普通末段切片只算 selection validation；准入证据必须是只查看一次的 locked holdout 或 locked walk-forward
- `external_validation` 可评估完整不重叠区间，但不提供 shadow 准入资格；历史上已被项目使用的数据不得重新命名为 locked holdout
- replay robustness：至少两个有效 regime 分桶、额外单边 5 bps 成本压力、预声明 ±10% 参数扰动
- `--strategy-review`：汇总 fresh / stale evidence、DB review stats 和 promotion gate
- `--strategy-promote`：默认 dry-run，满足 gate 且 `--yes` 后才改 strategy status

最终策略迭代系统必须闭环，但当前只固定最小路径：

```text
replay evidence -> shadow samples -> live-small samples -> review -> strategy policy change -> replay again
```

禁止把单次 review、单段漂亮回测或自动参数搜索直接变成实盘资格。
禁止在 trade-flow 内固定全量 indicator 体系；indicator 发现、解释和计算归 `tech-indicators`，R&D 只消费其 report / feature series，并把结果变成待 replay 的候选假设。
R&D loop 的失败结果必须进入 R&D ledger；重复失败不是交易数据，也不能污染 `trade.db` 或 strategy evidence。
R&D batch 失败不能只返回 `no_promote`；必须输出 blocker 汇总、selection audit 状态和下一步系统动作，指导回到数据、成本、regime、样本或假设层修正。
R&D artifact、strategy evidence / R&D ledger 是本地运行态，不进入 Git；保留与清理由引用、pin 和 retention policy 决定。
冻结候选在不重叠 locked holdout 上失败后必须终止整个 campaign；不得看完 holdout 后换假设继续试。修改参数、过滤器或规则均视为新 hypothesis / trial，只能进入下一轮使用新 holdout 的 campaign。
持续 R&D 的目标是找到可复现 edge，不是循环到出现漂亮回测；单个 campaign 在 locked holdout 通过、失败或 discovery budget 耗尽时结束。后续研究必须新开 hypothesis campaign 并换未查看的 holdout，不能沿用失败样本继续调到盈利。
已知机制基准不能显著优于负对照时，先诊断数据范围、组合构造和回放实现，不以放宽策略 gate 或增加搜索次数掩盖；基准通过也只证明研究管线具备识别能力，不证明任意假设都存在可交易版本。
含 indicator filter 的候选必须使用与 validation OHLCV 对齐的独立 feature report；discovery feature series 不得复用到外部验证。

升格门槛：

- `draft -> shadow`：fresh fingerprint replay 正收益、drawdown 不超阈值，并通过 locked holdout / walk-forward 与 robustness gate
- locked holdout 样本至少 10，且表现为正
- trial search budget 不能超过 10；参数数量不能超过 8
- `shadow -> live-small`：fresh replay + fresh shadow；shadow 样本至少 20，表现为正
- R&D tracker 关闭样本只能作为 review 输入；升 `live-small` 仍必须走正式 strategy evidence 与 execution attribution
- 任意状态可降级到 `paused / draft`
- 只改 `status` 不改变 `policy_hash`；改规则正文 / 名称 / tags 会使旧证据失效

若 setup 明确依赖微观结构，允许补最小分桶结果：

- own Roll / VPIN 高低分桶下表现
- BTC / ETH Roll / VPIN 压力下表现
- 对 `entry / stop / size / no_action` 的具体影响

禁止项：

- 没有规则口径就报胜率
- 只保留成功样本
- 因单个漂亮案例直接升 live-small
- 把回测系统扩成泛研究平台
- 把 Roll / VPIN 直接写成开仓信号

## 6. OBSERVE

职责：

- 拉账户 / 持仓 / 挂单 / 成交事实
- 对账；无法可靠恢复则 abort
- 拉必要市场数据
- 补 setup 相关证据
- append 完整 observe

OBSERVE 不负责拍板交易，不负责穷举所有信息。全市场扫描只能产出候选；候选必须回到单标的 setup 判断。

微观结构证据优先看 own Roll / VPIN，其次 BTC / ETH Roll / VPIN。它只说明 market quality / execution risk，默认进入 `microstructure.notes + refs`。

## 7. PLAN

职责：

- 判断 setup 是否仍成立
- 输出 `direction_state`
- 输出 `execution_verdict`
- 写 `action_intent`
- 让 preflight 决定是否可执行

PLAN 不能把“方向成立”偷换成“必须执行”。合法组合包括：`偏多已确认 + 不追`、`中性 + 持有不动`。

信号准入：

只有能改变 `entry / stop / size / no_action` 的分析，才允许进入 `action_intent`。其他内容只能进入 notes / refs。

Roll / VPIN 的默认作用是让 PLAN 更保守地处理追价、止损距离、仓位和等待条件；不得绕过 setup 资格证。

## 8. PREFLIGHT

preflight 是真钱动作前最后一道闸。

MVP hard guards：

- `G-RISK-OPEN-CAP`
- `G-RISK-DAY-FLOOR`
- `G-OBS-FRESH`
- `G-PLAN-INTENT-COMPLETE`
- `G-PLAN-VERDICT-COMPLETE`
- `G-SETUP-LIVE-PERMISSION`
- `G-KILL-SWITCH`
- `G-STOP-LADDER-MONOTONIC`
- `G-TP-LADDER-RATIO-CAP`

任一失败，本轮不执行，只 append observe。

## 9. EXECUTE

EXECUTE 只读：

```text
latest_observe.action_intent.request
```

执行顺序固定：

```text
request
  -> preview
  -> execution_contract_snapshot
  -> execute tool
  -> order_fill(source=trade_flow)
```

`order_fill(source=trade_flow)` 必须引用：

- `source_observe_event_key`
- `execution_contract_snapshot`

## 10. REVIEW

review 只做闭合样本，不自动升级策略。review 可以生成待验证假设，但必须进入 replay / backtest / shadow，不能直接升 live-small。

最小字段：

- `outcome`
- `pnl_pct`
- `thesis_held`
- `key_lesson`
- `promote_to_strategy`
- `notes`

review 只回答四类问题：

- setup 不成立
- 事实不够或不新鲜
- 执行出错
- hard guard 缺失或过严

## 11. Kill Switch

触发后禁止新增风险，只允许减风险动作：

- 对账无法恢复
- Binance API / cron 连续失败
- 日亏损接近底线
- lane / setup 连续亏损达到上限
- 重大事件窗口且 strategy 未明确允许

## 12. 数据与持久化

唯一核心表：

```text
plan_event(event_key, chain_id, kind, body_json, created_at)
```

`kind` 只允许：

- `observe`
- `order_fill`
- `review`

strategy policy 走 markdown；account / notify config 走 JSON；市场原始数据留在各 tool 输出或 refs，不塞进 `observe`。

产物生命周期：

- `trade.db` 只存事件、摘要和 refs，不存原始 OHLCV / aggTrades / replay 大对象
- 未被 strategy evidence、review、active observe 或 `.pin` 引用的文件型 artifact 必须可清理
- strategy evidence ledger 独立为 JSONL；它是策略准入证据，不是交易事实源
- ad-hoc 分析优先写 `./tmp/artifacts` / `./tmp/panels`；只有会影响策略准入或复盘的结果才归档到 `./data/artifacts` 类目录
- 清理必须默认 dry-run；只有显式确认才删除
- Git 边界与 data 留存规则见 [data-hygiene.md](data-hygiene.md)

## 13. 非目标

以下内容不进入当前 PRD：

- 平台化策略分支版本系统
- 自动策略挖矿 / 自动升格
- 无界 artifact 留存
- UI / 看板
- chat-history 实盘证据化
- 多账户 / 多交易所
- hedge 多腿净敞口
- 日内高频和 probe
