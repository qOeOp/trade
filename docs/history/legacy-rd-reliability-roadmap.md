---
title: Legacy R&D Reliability Roadmap
role: historical-plan
status: legacy-reference
owner: research-strategy-development
last_verified: 2026-07-22 CST
---

# Legacy R&D Reliability Roadmap

> 本文保留某一时点的 M4-P27、数据、成本与搜索进度，正文状态会随实现快速失效。当前可靠性合同见 [R&D Reliability Roadmap](../research/reliability/rd-reliability-roadmap.md)，Replay 真假以机器 maturity gate 为准。

目标：先让系统稳定暴露问题，再让 R&D 搜索策略。

Replay 已完成 M4-P26，并进入 M4-P27：单资产 Request/Schedule/Engine/Result/Checkpoint 已认证最多两次、全部预声明且各自 full-fill 的 fixed partial，以及 generation-2/3、t-minus Funding、State 和 resume；独立 Portfolio terminal/risk Engine consumer 已逐笔绑定 cash、collateral、fill-price exposure 与 active-stop risk。Control Plane-issued Reservation 已从 durable Trial/Attempt registry 锁定 Trial、Reservation、run、active lease、request 与有效窗，Runner-owned projection 再于正式 Lane Replay 前验证双 partial authority，且不修改 P26。完整 terminal/preemption matrix、Artifact、owner-keyed accounting 与 bounded cycle 尚未接入，P27 仍为 in progress。动态 sizing、第三次 partial、partial 后 amend/cancel、reentry、cross-margin、borrow、真实 liquidity 与 Fast 均继续禁止，整体仍为 M3。

## 1. 数据层

- 目标：20+ 可交易资产，减少 current-symbol survivorship bias。
- 当前：`research.calibration-suite` 已输出 `data_panel`、`survivor_only` 与 symbol status 分布；`ohlcv-fetch/scripts/calibration-panel.ts` 已生成 20 symbol panel，并可通过外部归档 manifest 合入 inactive / delisted symbol。
- 下一块：接入可靠 delisted / 下架历史数据源，形成 listing-age-aware universe。
- 完成信号：calibration suite 不再触发 `CAL-PANEL-BREADTH / CAL-PANEL-SCHEMA / CAL-PANEL-ALIGNMENT`。

## 2. Funding 层

- 目标：calibration / replay / R&D 统一使用 exact funding events；覆盖不足时只诊断，不准入。
- 当前：`research.calibration-suite` 已消费 dataset `indicator_report_path` 的 `market_events.funding`；`ohlcv-fetch/scripts/calibration-market-features.ts` 已实跑完整 panel，失败缓存可重试，最终输出 full funding coverage；strategy evidence 已继承 replay `funding_event_coverage`，partial / invalid 时阻断升 `shadow`。
- 下一块：把 exact funding coverage 继续接入 shadow / live-small execution attribution 的自动汇总。
- 完成信号：输出 `funding_event_coverage.status=full` 与 `historical_funding_attribution`。

## 3. 成本层

- 目标：把 gross edge、turnover、fee、slippage、funding drag 拆开。
- 当前：calibration cost model 已从单一 bps 拆为 `maker_fee_bps / taker_fee_bps / market_order_share / slippage_bps`，并输出 fee/slippage drag；strategy review 已输出 `cost_model_feedback`，把 shadow/live 真实成本反灌为 per-trade R 值。
- 下一块：从账户配置或交易所费率源注入真实 fee tier，并接入订单 notional / ADV / depth 分桶；继续不伪造 maker 队列成交概率。
- 完成信号：`CAL-COST-FRAGILE` 能定位到换手、费率或滑点。

## 4. Regime 层

- 目标：失败不是只按时间切片，而是按趋势、波动、流动性、funding regime 定位。
- 当前：calibration 已输出趋势/波动 `regime_attribution`，并用 `CAL-REGIME-FRAGILITY` 暴露单一市场状态依赖。
- 下一块：有可靠历史数据后补 liquidity / funding regime。
- 完成信号：R&D before-search report 能说明候选适用/失效的 market state。

## 5. 负对照层

- 目标：所有 known-edge 和 candidate 都必须战胜合理 negative control。
- 当前：calibration 已保留 weight time-shift，并新增 side flip / asset-label shuffle 诊断；candidate batch 已输出 side-flip / entry-lag negative controls；panel R&D 已输出 cross-candidate asset shuffle negative control，单候选时显式 `not_applicable`；campaign 可消费 `panel_report_path`，panel negative control 失败时停止在 `panel_negative_control_failed`；strategy evidence 已记录 `panel_negative_control_gate` 并在 blocked / not evaluated 时阻断升 `shadow`。
- 下一块：把 shadow 阶段的真实执行归因自动汇总，避免 replay 合格但执行吃掉 edge。
- 完成信号：轻微正收益但未过 negative control 的候选不会进入下一阶段。

## 6. R&D 搜索层

- 目标：只有 calibration 过关后才搜索；搜索失败进入学习记忆并生成下一条更受约束的 hypothesis，不盲目换参数。
- 当前：`research.rd-campaign-runner` 可读取 `calibration_report_path`；未校准或含 blocker 时零 trial 停止；candidate batch 已输出 `failure_summary` 与 `reliability_gate`，把样本画像、失败层和继续 trial 权限机器化。
- 当前：strategy review 已输出 `diagnostics.qualification` 与 `diagnostics.failure_attribution`，能直接暴露 funding / panel negative control / anti-overfit / robustness / shadow attribution 阻断层。
- 当前：`--automation-cycle` 已能生成 `rd_strategy_supervisor` job；该 job 由 subagent 在 artifact/catalog scope 内循环到 `shadow_candidate_found / budget_exhausted / data_or_tool_blocked`，并把 `failure_summary / reliability_gate / rejected_mechanisms / universe_lessons / next_hypothesis_queue` 写回学习记忆。
- 当前：learning memory 已进入 `research_state_store.rd_program`；总控通过 `rd_state_db + rd_program_id` 读取 objective / budget / usage / lessons / queue，并在 state 非 `active` 时停止 R&D supervisor。
- 当前：`research.rd-program-state` 可 init/read/update；`research.rd-loop-runner` / `research.rd-campaign-runner` 可显式写回 usage、failure、reliability 与 artifact refs；`strategy-review` 产出 execution attribution、cost feedback 与 replay-to-shadow/live decay 诊断，由 R&D supervisor 显式消费，不直接写 state。
- 当前：`research.rd-program-state action=plan_next` 可只读消费 `next_hypothesis_queue`，生成下一轮 `research.rd-loop-runner` / `research.rd-campaign-runner` payload 草案；`research.rd-supervisor` 已把 plan、执行、写回、再规划串成自主 loop。
- 当前：panel / loop 失败后不得表述为“panel 精炼”或“外部过滤器补丁”；市场状态过滤、资产选择、持仓规则、风控几何和成本约束都必须作为下一代 candidate strategy hypothesis 的预声明组成部分。
- 当前：新增 `research.strategy-hypothesis-designer`，把 agent-native 策略设计脑放在 candidate batch 前：先生成 `trade-flow.strategy-hypothesis-contract.v1`，再 validate / queue seed；缺数据、缺 family 或缺参数时阻断，不消耗 trial。
- 下一块：让 R&D supervisor 自动调用 designer prompt，把 failure / review feedback 编译成更受约束的 `next_hypothesis_queue`；生成内容必须是新策略假说，不是对已失败候选做事后排除。
- 完成信号：pipeline 能在预算内自主连续迭代 hypothesis，同时自动拒绝在未校准环境下扩大 trial budget。

## 7. Evidence 层

- 目标：calibration artifact 可存档、可 diff、可发现退化，但不进入 strategy promotion evidence。
- 当前：calibration 已输出 `report_hash`，并可通过 `previous_calibration_report_path` 输出 previous-run comparison。
- 当前：calibration panel / OHLCV / artifact 的 Git 边界与留存位置已纳入 [data-hygiene.md](../engineering/data-hygiene.md)。
- 下一块：从真实 shadow order/event 自动汇总 attribution，减少人工填报。
- 完成信号：系统能回答“这次失败是策略退化，还是数据/成本/harness 变化”。

## 8. Shadow 层

- 目标：locked holdout 后仍必须用真实 shadow 样本证明执行链不吃掉 edge。
- 当前：`shadow -> live-small` 要求 shadow evidence 带 cost / slippage / funding attribution；review 会输出 cost feedback 给下一轮 replay。R&D shadow tracker 已升级为 schema v2 行为事件链，输出仍只是 review 输入；R&D event chain 设计见 [rd-event-chain-design.md](../research/architecture/rd-event-chain-design.md)。
- 下一块：补 15m fast paper monitor、missed-fill、订单规模与流动性分桶。
- 完成信号：`shadow -> live-small` 不只看胜率，还看真实执行损耗是否在 replay 假设内，并能转成下一轮成本压力参数。

## 9. Simulator Fidelity 层

- 目标：replay、forward shadow、live signal 看到同一份策略事实；性能优化、批量 replay 或 paper tracker 不改变交易路径。
- Jesse 调研吸收：借鉴其 step / fast simulator parity、K 线内触价、多订单排序、partial exit、reduce-only 数量上限等内核纪律；只重写等价行为，不引入 Jesse 运行依赖。
- 当前：Replay 已到 M3；M3-G1–G8 与 M4-P1–P26 已冻结。P26 用认证单资产 Replay Result 作为 Lane execution authority，显式 successor 完成 generation-2、quantity-aware Funding/Mark/Margin/liquidation、cash/collateral、gross/net exposure、历史 admission/current stop-risk 分离、owner-keyed accounting 与 bounded cycle；默认 predecessor 仍 fail closed。P27 单资产双 partial authority/Engine/Checkpoint 已实现，Portfolio 以后门禁未闭合。
- 缺口：仍无动态/重复 partial、partial 后 order mutation、周期内 reentry、cross-margin、borrow、generic matching、真实 liquidity partial 或独立 Fast parity；不得从 P26 的 fixed full-fill 模型外推。
- 下一块：M4-P27 `two-predeclared-fixed-partial-reduces-end-to-end`。同一 frozen Schedule 最多两次严格递增的 next-open fixed-quantity reduce-only partial；每个 Order 自身只能 full-fill，第一、第二次 Fill 后都必须保留正仓位，累计数量必须严格小于 initial quantity。每次 executable boundary 均先让当前 generation protection 与 exact risk 取得终态机会；成功后按剩余绝对数量原子重建下一 generation。实现必须一次闭合单资产 Result/Checkpoint、Portfolio quantity/Funding/Mark/Margin/liquidation、current risk/exposure、owner-keyed accounting、manifest-last Artifact 与 1–8 full-flat cycle；不得拆成零实例 schema 阶段。
- P27 不做：动态数量、第三次 partial、订单级 partial fill、partial 后 stop/target amend/cancel、加仓/reentry、抵押释放再授权、cross-margin、borrow、真实 L2/queue、Fast。
- 已锁完成信号：long/short、decision-boundary bracket race、partial 前后 Funding、post-partial owner、open-at-end cash/保留抵押/exposure/risk、双分录、四周期 cash bridge、唯一 opening equity、retry/failure/interruption/tamper 与 P15–P25 回归均通过。
