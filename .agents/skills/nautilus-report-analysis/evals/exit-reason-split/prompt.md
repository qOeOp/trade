---
description: Regression — with the skill, bracket results are read by entry tag crossed with the exit reason taken from the order that closed each cycle.
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

一个 bracket 策略的封存回测：入场是带 GTD 的限价单，成交后挂止损与止盈子单（OTO 加 OCO），订单 tags 有 ENTRY、STOP_LOSS、TAKE_PROFIT，另有到期市价平仓的 TIME_EXIT；入场分 A、B 两类信号，也写在 ENTRY 订单的 tags 里。结果：闭仓 300 个周期，闭仓胜率 61%，单位入场名义的闭仓净优势只有 4 bps。

你只能读这次运行封存的 orders、fills、positions 报告。请列出你会做的分析步骤（不用真的计算），目标是找出净优势低的原因。
