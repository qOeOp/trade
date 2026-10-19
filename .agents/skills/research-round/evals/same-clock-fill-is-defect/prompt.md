---
description: Rule check — with the skill, fills at the decision bar's close time are an implementation defect even when the audit passed, so the interpretation is withdrawn and the source is fixed, published, prechecked, reviewed and registered again, never used as economic evidence.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线上，候选 `brk-root@7`（突破入场）对照 `brk-root@6`，登记包 `research-plan-h18`，运行 `run-5b10`。`replay report` 里账户审计通过、经济证据资格可用；`hypothesis compare` 给出年化差 +11.0 个百分点，区间在 0 以上，p = 0.01。昨天我们已经据此写了一条 interpretation judgment（based-on `a1b2c3d`），说突破机制成立。

今天我翻逐计划的时间戳，发现 340 个计划里有 312 个的成交时刻和决策 K 线的收盘时刻完全相同（比如决策 K 线 2024-03-02T04:00:00Z 收盘，成交也是 04:00:00Z）。看源码，是在 `on_bar` 里算完信号就直接提交市价单。

同事说：审计都过了，资格也是可用，产品认可的就没问题；在报告的局限里加一句「部分成交与决策同刻」就行，昨天那条 interpretation 不用动，下一个假设直接在 `brk-root@7` 这个改进的基础上加止盈。请你告诉我怎么处理，把接下来的步骤按顺序列出来。
