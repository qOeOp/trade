---
title: R&D Event Chain Design
updated_at: 2026-07-09 20:45 CST
---

# R&D Event Chain Design

## 结论

R&D tracker 需要事件链，但不进入 `trade.db.plan_event`。

```text
live flow chain = 交易事实
rd setup chain  = 研究纸面事实
```

两者同构但隔离：共享行为语义，不共享存储和执行权限。live 用 `plan_event` 承载真实交易事实；R&D 用 artifact 承载纸面研究事实。R&D 链关闭并通过归因后，才可能被摘要成 strategy evidence。

## 概念层

```text
setup template       = class
rd setup instance    = class instance
rd event chain       = instance 的时序状态变化
review draft         = 对 event chain 的结构化总结
```

| 层 | 作用 | 示例 |
| --- | --- | --- |
| `setup_template` | 定义这类机会应满足什么 | momentum short、entry filter、stop/target、no-trade 条件 |
| `rd_setup_instance` | 一次具体触发 | `1000PEPEUSDT` 在某根 4H close 后触发 short |
| `rd_event_chain` | 触发后每次观测 | bar high/low/close、MFE/MAE、stop/target 是否触发、证据是否衰减 |
| `review_draft` | 样本闭合后的复盘输入 | 成败归因、执行偏差、是否可整理为 shadow evidence |

## 行为优先

设计不要按模块复制逻辑：

```text
rd tracker 一套 entry/observe/exit/review
shadow 一套 entry/observe/exit/review
live 一套 entry/observe/exit/review
```

正确抽象是先定义少量通用行为，再由不同运行层适配：

| 通用行为 | R&D paper | formal shadow | live |
| --- | --- | --- | --- |
| `open_setup` | 生成 `rd_entry_evidence` | 记录 shadow setup | 慢轨写 first `observe` |
| `observe_setup` | 追加 `rd_observation` | 追加 shadow observation / attribution | 慢/快轨写 `observe` |
| `act_on_setup` | 只更新 paper projection | 记录 shadow mock / paper fill | 写 `order_fill`，可能触发 Binance |
| `close_setup` | 追加 `rd_exit` | 关闭 shadow sample | 仓位/机会闭合 |
| `review_setup` | 生成 `rd_review_draft` | 生成 shadow evidence | 写 live `review` |

行为语义应复用，副作用由 backend 决定：

```text
behavior command
  -> validate common contract
  -> project current setup state
  -> choose backend
       rd artifact backend
       shadow evidence backend
       live plan_event backend
```

这样可以避免每层各自重写 MFE / MAE、失效判断、review 归因、成本反馈等重复逻辑。

## 为什么不能只存最终状态

只存 `open / closed / r` 不够。相同 `-1R` 可能来自完全不同机制：

- 入场后直接反向：entry / trigger 质量问题。
- 先到 `+1.5R` 再回撤：exit / trailing / break-even 问题。
- 横盘 12 根后 time exit：edge 衰减或触发过早。
- 期间 BTC regime 反转：no-trade / regime filter 不足。

review 必须能读取路径，而不是只读取终点。

## 事件模型

第一版只在 tracker artifact 内保存，不新建 SQLite 表；但事件 shape 应按通用行为设计。

```text
rd_chain_id
  rd_entry_evidence
  rd_observation[]
  rd_exit?
  rd_review_draft?
```

通用事件外壳：

```yaml
event_key: text
chain_id: text
behavior: open_setup | observe_setup | act_on_setup | close_setup | review_setup
backend: rd_artifact | shadow_evidence | live_plan_event
source: rd_4h_tracker | rd_fast_monitor | slow_track | fast_track | review
created_at: timestamp
payload: object
```

R&D 的 `rd_entry_evidence / rd_observation / rd_exit / rd_review_draft` 是这个外壳在 `backend=rd_artifact` 下的 payload 类型，不是另起一套思想。

### `rd_entry_evidence`

由 forward-holdout entry 生成，冻结入场当下的事实。

最小字段：

- `event_key`
- `event_type = rd_entry_evidence`
- `rd_chain_id`
- `strategy_id / setup_id / candidate_id`
- `symbol / side / timeframe`
- `signal_time / data_cutoff / generated_at`
- `source_forward_result_ref`
- `setup_template_ref`
- `entry / stop / target / max_hold_bars`
- `entry_evidence[]`
- `invalidation_rules[]`
- `no_trade_filters[]`

原则：证据必须来自 signal 计算、feature report、market snapshot 或 deterministic guard；LLM 只能摘要，不得补事实。

### `rd_observation`

每次 R&D tracker 或 fast shadow monitor 更新时追加。

最小字段：

- `event_key`
- `event_type = rd_observation`
- `rd_chain_id`
- `observed_at`
- `source = rd_4h_tracker | rd_fast_monitor`
- `bar_timeframe`
- `bar_open_time / bar_closed_at`
- `open / high / low / close`
- `mark / last / spread_bps / funding_rate`（有实时 monitor 时）
- `mfe_r / mae_r / close_r`
- `bars_held`
- `active_stop / target`
- `break_even_armed`
- `hit_stop / hit_target / hit_time_exit`
- `evidence_state`

`rd_observation` 是完整观测快照，不是 patch；后续 projection 从事件链 reduce 当前状态。

### `rd_exit`

stop / target / time_exit 任一触发时追加。

最小字段：

- `event_key`
- `event_type = rd_exit`
- `rd_chain_id`
- `exit_time`
- `exit_reason = stop | target | time_exit`
- `exit_price`
- `r`
- `bars_held`
- `same_bar_policy`
- `path_summary`

### `rd_review_draft`

只在 `rd_exit` 后生成。它是 review 输入，不是 promotion evidence。

最小字段：

- `event_key`
- `event_type = rd_review_draft`
- `rd_chain_id`
- `outcome`
- `pnl_r`
- `entry_quality`
- `exit_quality`
- `regime_attribution`
- `execution_attribution_required`
- `cost_model_feedback?`
- `can_be_strategy_evidence = false`

若要进入正式 strategy evidence，必须另由 review / attribution pipeline 转换，不能直接引用 raw tracker 结果。

## R&D observe 与 live observe 的关系

| 维度 | live `observe` | R&D `rd_observation` |
| --- | --- | --- |
| 真相来源 | Binance 账户、挂单、成交、市场事实 | closed candles、paper position、可选实时 snapshot |
| 写入位置 | `trade.db.plan_event` | R&D tracker artifact |
| 是否可驱动执行 | 可以，经 preflight/executor | 不可以 |
| 是否可作为 promotion evidence | review 后可进入 strategy evidence | 原始链不能，关闭后只作为 review 输入 |
| 频率 | 慢轨 1H/4H，快轨 5m/15m | 4H tracker，必要时 15m fast paper monitor |
| 状态语义 | 真实风险生命周期 | 研究样本生命周期 |

隔离原因：R&D 纸面事实不能污染交易事实；交易事实也不能被 paper tracker 补写。

共享点：二者都实现 `observe_setup` 行为，都必须是完整观测快照，都应能被 reduce 成当前 setup state。

差异点：live observe 可以驱动 executor；R&D observation 只能驱动 paper projection 和 review draft。

## Projection

R&D tracker 对事件链 reduce 出当前状态：

- `status = open | closed`
- `entry / active_stop / target`
- `bars_held`
- `mfe_r / mae_r / close_r`
- `break_even_armed`
- `last_observed_at`
- `exit_reason / r`
- `review_draft`

当前 tracker schema v2 已按以下结构输出：

```text
paper_positions[]
  entry_evidence
  events[]
  projection
```

## 自动化职责

### 4H R&D forward tracker

- 刷新 closed 4H OHLCV。
- 跑 forward-holdout。
- 有 entry 时创建 `rd_entry_evidence`。
- 对 open chain 追加 4H `rd_observation`。
- 触发 stop / target / time_exit 时追加 `rd_exit` 与 `rd_review_draft`。

### 15m R&D fast monitor（后续补）

- 只监控已 open 的 R&D chain。
- 不发现新策略，不创建新 entry。
- 读取 mark/last/spread/funding。
- 追加 `rd_observation(source=rd_fast_monitor)`。
- 用于 execution alignment、missed-fill、spread/funding 归因。

## 最小落地顺序

1. 已抽出通用 setup projection：输入 events，输出 `status / MFE / MAE / close_r / active_stop / exit_reason`。
2. 已给 `rd-shadow-tracker` 增加 `events[]`，用通用行为外壳记录 4H `open_setup / observe_setup / close_setup / review_setup`。
3. 已由 forward-holdout entry 生成最小 `entry_evidence`，只使用已计算字段。
4. 已让 review draft 消费整条 events 和通用 projection，而不是只读最终 `r`。
5. 待补 15m fast paper monitor；它只新增 observation source，不新增一套状态机。

## 非目标

- 不扩展 `plan_event.kind`。
- 不把 R&D event 写入 `trade.db`。
- 不允许 raw R&D chain 直接升 `live-small`。
- 不做主观交易日志。
- 不为每个指标发明自然语言解释；证据必须可回放。
