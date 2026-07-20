---
title: R&D Reliability Roadmap
---

# R&D Reliability Roadmap

目标：先让系统稳定暴露问题，再让 R&D 搜索策略。

Replay 已完成 M4-P25 并选择 M4-P26：protective-stop cancel 风险降级已闭合；下一有界纵切是一次预声明 next-open fixed-quantity partial reduce 的 Portfolio quantity/risk resize。P26 尚未实现，默认 Portfolio projection 继续拒绝 partial；动态 sizing、重复 partial、reentry、cross-margin、真实 liquidity 与 Fast 均未进入，整体仍为 M3。

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
- 当前：calibration panel / OHLCV / artifact 的 Git 边界与留存位置已纳入 [data-hygiene.md](data-hygiene.md)。
- 下一块：从真实 shadow order/event 自动汇总 attribution，减少人工填报。
- 完成信号：系统能回答“这次失败是策略退化，还是数据/成本/harness 变化”。

## 8. Shadow 层

- 目标：locked holdout 后仍必须用真实 shadow 样本证明执行链不吃掉 edge。
- 当前：`shadow -> live-small` 要求 shadow evidence 带 cost / slippage / funding attribution；review 会输出 cost feedback 给下一轮 replay。R&D shadow tracker 已升级为 schema v2 行为事件链，输出仍只是 review 输入；R&D event chain 设计见 [rd-event-chain-design.md](rd-event-chain-design.md)。
- 下一块：补 15m fast paper monitor、missed-fill、订单规模与流动性分桶。
- 完成信号：`shadow -> live-small` 不只看胜率，还看真实执行损耗是否在 replay 假设内，并能转成下一轮成本压力参数。

## 9. Simulator Fidelity 层

- 目标：replay、forward shadow、live signal 看到同一份策略事实；性能优化、批量 replay 或 paper tracker 不改变交易路径。
- Jesse 调研吸收：借鉴其 step / fast simulator parity、K 线内触价、多订单排序、partial exit、reduce-only 数量上限等内核纪律；只重写等价行为，不引入 Jesse 运行依赖。
- 当前：Replay 已到 M3 单资产 Step 纵切；M3-G1–G8 与 M4-P1–P25 已冻结，M4-P26 已选择但尚未实现。单资产 fixed partial 已正式限制为一次 frozen next-open market fixed quantity，Fill 后在同一 source boundary 将 generation-1 bracket 原子替换为相同 trigger、剩余数量的 generation 2；long/short、Funding、stop/target/strategy-exit、open-at-end、exact liquidation、resume 与 tamper 已有证据。Portfolio predecessor 仍 fail closed。成熟度仍为 M3。
- 缺口：Portfolio 尚不能在 fixed partial-reduce full Fill 后同步提交 realized PnL/fee、settled/available cash、remaining quantity、Funding、isolated Margin、gross/net exposure、current stop risk 与 protection generation，因此 terminal owner、open-at-end NAV 和下一周期资格均可能失真。仍无动态/重复 partial、周期内 reentry、partial liquidation、cross-margin、borrow、generic matching、真实 liquidity partial 或 Fast parity。
- 下一块：M4-P26 `fixed-partial-reduce-portfolio-risk-resize-end-to-end`。只消费一次已冻结的 fixed-quantity partial；generation-1 boundary 先决，订单自身 full Fill 后按剩余绝对仓位重建 generation 2，随后 exact Funding/Mark/Margin/liquidation 与 stop/target/final strategy exit 都必须使用新数量。历史 admission fact 保留，current exposure/risk utilization 按剩余仓位重算；没有 venue collateral-release authority，isolated collateral 保留到 full-flat，下降的 utilization 不授权新入场、reentry 或 successor。
- 完成信号：默认 Portfolio projection 继续 fail closed；显式 successor 在同一 change set 内锁定 long/short、decision-boundary bracket race、partial 前后 t-minus Funding、post-partial stop/target/strategy-exit/liquidation、open-at-end cash/保留抵押/exposure/risk、owner-keyed accounting、1–8 full-flat cycle、唯一 opening equity、retry、failure、publication interruption 与 tamper。P15–P25 不改写；不得开放动态 sizing、第二次 partial、partial 后 amend、订单 partial fill、reentry、cross-margin、真实 liquidity 或 Fast。
