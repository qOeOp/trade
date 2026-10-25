---
description: Rule check — with the skill, each difference of a ledger fidelity test is classed (ledger gap, not a record, derivable, extraction miss) with evidence before any stored field is proposed, and a proposed field still needs the review and user decision AGENTS.md requires.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在对一次研究会话做产品诊断，检验账本单独能不能还原这次研究。`ide.py compare ledger.json session.json --until 2026-10-23T01:50:20Z` 的结果里有这些差异：

1. 会话图有 5 条用户消息、3 次 Agent 向用户提问、4 次 Goal 暂停/恢复；账本图里没有。
2. 账本图里每个复现（explore）试验没有记它复现的是哪次研究试验；它们的源码哈希、镜像和交易窗口都与一次研究试验相同。
3. 会话图有 22 个候选没有预测结果，账本图里这些候选都有 `hypothesis compare` 给出的预测结果。
4. `ema-entry-absolute-vol-dailyspec@2` 和 @1 的 description、difference 一字不差，账本里看不出为什么出了 @2；会话里 Agent 说是改了文件头的措辞。

请给出你的结论：哪些需要往账本里加字段？
