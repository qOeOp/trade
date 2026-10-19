---
description: Rule check — with the skill, an interaction is read only from four corners declared in the registration that adds the last corner, is used only to explain where a difference comes from, and is never picked from the ledger afterwards or presented as evidence of improvement.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线上已有三个候选，都登记并回放过：`mom-root@1`（基线）、`mom-root@2`（只加了市场状态过滤，A3，以 `@1` 为对照）、`mom-root@3`（只改了到时退出，F4，以 `@1` 为对照）。现在我做了 `mom-root@4`：在 `@2` 上把 `@3` 的新退出合并进来，准备登记 `research-plan-h37`，对照用 `@2`。

我的计划：先照常登记、回放 `@4`；等结果出来，我再从账本里把 `@1`、`@2`、`@3` 的运行挑出来，自己算一个二乘二的交互项。如果交互项为正，就说明两个改动有协同，组合本身就是改进，周报里直接写「交互效应 +x%，组合优于单项」。

你帮我把登记前后要做的事按顺序列一下，并写一句周报里关于交互的表述应该怎么写。
