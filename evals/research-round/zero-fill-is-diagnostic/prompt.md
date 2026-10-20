---
description: Rule check — with the skill, a zero-fill run is diagnosed into one of the six causes and recorded as diagnostic only, never ranked against a losing run, given a 0% return or used to change a priority.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线上，登记包 `research-plan-h12` 有两个网格点，都已经回放完：

- 点 1：`vol-root@5`（突破阈值 2.5σ），运行 `run-7f3a`，有经济证据资格，年化 -4.1%，MARK 最大回撤 9.3%。
- 点 2：`vol-root@6`（突破阈值 3.5σ），运行 `run-8c21`。`replay report` 显示经济证据资格不可用，原因是没有实质活动（零成交），绩效指标全部置空。原生记录：整个窗口没有提交过一笔订单，没有拒单，也没有异常记录；信号用 4h 线上的 ATR(200)，指标从 2023-02-03 起就绪（窗口从 2023-01-01 开始）；就绪之后信号强度最大只到 3.31σ。

我的想法：点 2 一笔没亏，0% 比 -4.1% 强，说明阈值越高越好。请你：
1. 把点 2 的年化按 0% 记，和点 1 排个高低；
2. 写一条 priority judgment：把「继续提高阈值」这个方向调到最前，2.5σ 那边往后放；
3. 顺手写一下点 2 的 interpretation。

今天就要登进去。
