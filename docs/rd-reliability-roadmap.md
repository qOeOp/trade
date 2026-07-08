---
title: R&D Reliability Roadmap
---

# R&D Reliability Roadmap

目标：先让系统稳定暴露问题，再让 R&D 搜索策略。

## 1. 数据层

- 目标：20+ 可交易资产，减少 current-symbol survivorship bias。
- 当前：`--strategy-calibration-suite` 已输出 `data_panel`；`ohlcv-fetch/scripts/calibration-panel.ts` 已生成并实跑 20 symbol panel。
- 下一块：补 delisted / 下架资产来源，降低 survivor-only 样本偏差。
- 完成信号：calibration suite 不再触发 `CAL-PANEL-BREADTH / CAL-PANEL-SCHEMA / CAL-PANEL-ALIGNMENT`。

## 2. Funding 层

- 目标：calibration / replay / R&D 统一使用 exact funding events；覆盖不足时只诊断，不准入。
- 当前：`--strategy-calibration-suite` 已消费 dataset `indicator_report_path` 的 `market_events.funding`；`ohlcv-fetch/scripts/calibration-market-features.ts` 已实跑完整 panel，失败缓存可重试，最终输出 full funding coverage；strategy evidence 已继承 replay `funding_event_coverage`，partial / invalid 时阻断升 `shadow`。
- 下一块：把 exact funding coverage 继续接入 shadow / live-small execution attribution 的自动汇总。
- 完成信号：输出 `funding_event_coverage.status=full` 与 `historical_funding_attribution`。

## 3. 成本层

- 目标：把 gross edge、turnover、fee、slippage、funding drag 拆开。
- 当前：calibration cost model 已从单一 bps 拆为 `maker_fee_bps / taker_fee_bps / market_order_share / slippage_bps`，并输出 fee/slippage drag。
- 下一块：从账户配置或交易所费率源注入真实 fee tier；继续不伪造 maker 队列成交概率。
- 完成信号：`CAL-COST-FRAGILE` 能定位到换手、费率或滑点。

## 4. Regime 层

- 目标：失败不是只按时间切片，而是按趋势、波动、流动性、funding regime 定位。
- 当前：calibration 已输出趋势/波动 `regime_attribution`，并用 `CAL-REGIME-FRAGILITY` 暴露单一市场状态依赖。
- 下一块：有可靠历史数据后补 liquidity / funding regime。
- 完成信号：R&D before-search report 能说明候选适用/失效的 market state。

## 5. 负对照层

- 目标：所有 known-edge 和 candidate 都必须战胜合理 null。
- 当前：calibration 已保留 weight time-shift，并新增 side flip / asset-label shuffle 诊断；candidate batch 已输出 side-flip / entry-lag null controls；panel R&D 已输出 cross-candidate asset shuffle null，单候选时显式 `not_applicable`；campaign 可消费 `panel_report_path`，panel null 失败时停止在 `panel_null_failed`；strategy evidence 已记录 `panel_null_gate` 并在 blocked / not evaluated 时阻断升 `shadow`。
- 下一块：把 shadow 阶段的真实执行归因自动汇总，避免 replay 合格但执行吃掉 edge。
- 完成信号：轻微正收益但未过 null 的候选不会进入下一阶段。

## 6. R&D 搜索层

- 目标：只有 calibration 过关后才搜索；搜索失败回到系统诊断，不盲目换假设。
- 当前：`--strategy-rnd-campaign` 可读取 `calibration_report_path`；未校准或含 blocker 时零 trial 停止；candidate batch 已输出 `failure_summary` 与 `reliability_gate`，把样本画像、失败层和继续 trial 权限机器化。
- 下一块：把 campaign / evidence 的 qualification 汇总写入策略 review 报告的失败归因，减少人工翻 artifact。
- 完成信号：pipeline 能自动拒绝在未校准环境下扩大 trial budget。

## 7. Evidence 层

- 目标：calibration artifact 可存档、可 diff、可发现退化，但不进入 strategy promotion evidence。
- 当前：calibration 已输出 `report_hash`，并可通过 `previous_calibration_report_path` 输出 previous-run comparison。
- 下一块：把 calibration artifact 存档位置纳入运行约定。
- 完成信号：系统能回答“这次失败是策略退化，还是数据/成本/harness 变化”。

## 8. Shadow 层

- 目标：locked holdout 后仍必须用真实 shadow 样本证明执行链不吃掉 edge。
- 当前：`shadow -> live-small` 要求 shadow evidence 带 cost / slippage / funding attribution。
- 下一块：从真实 shadow order/event 自动汇总 attribution，减少人工填报。
- 完成信号：`shadow -> live-small` 不只看胜率，还看真实执行损耗是否在 replay 假设内。
