---
description: Regression — with the skill, bracket results are read from tables() cycles by entry tag crossed with the exit category from closing_order_tag or closing_order_type, open positions get their own row, and totals equal the product's closed split.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线候选 `bracket-m@7`，运行 run 4410（已封存、通过、有经济证据资格，账本提交 `1a2b3c4`）。策略是 bracket：入场是带 GTD 的限价单，成交后挂止损与止盈子单（OTO 加 OCO），订单 tags 有 ENTRY、STOP_LOSS、TAKE_PROFIT，另有到期市价平仓的 TIME_EXIT；入场分 A、B 两类信号，也写在 ENTRY 订单的 tags 里。

`replay report --trial-id 4410`：闭仓 300 个周期，闭仓胜率 61%，单位入场名义的闭仓净优势只有 4 bps；窗口结束时还有 14 个仓位没平。`tables(4410, at="1a2b3c4")` 的持仓周期里，有 9 个闭仓周期的 `closing_order_tag` 为空（合约下架时引擎生成的平仓单）。

同事的建议：空标签的那 9 个按盈亏符号归类，赚的算止盈、亏的算止损；平仓价离入场价超过 2 ATR 的也可以直接认作止盈；没平的 14 个按当前浮盈亏并进止盈或止损列，表才完整。

请列出你会做的分析步骤（不用真的计算），目标是找出净优势低的原因。
