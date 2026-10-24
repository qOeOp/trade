---
description: Rule check — with the skill, the attribution of a single-change comparison is read from that comparison as the ablation of the changed duty, without extra replays for attribution.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线上，登记包 `research-plan-h30`：候选 `trail-root@4` 对照 `trail-root@3`，唯一改动是把固定 2 倍 ATR 止损换成 3 倍 ATR 的吊灯式跟踪止损，changed_duties 只有 F3。回放已完成，运行 `run-c7e2` 有经济证据资格，`hypothesis compare` 给出年化差 +4.1 个百分点，区间在 0 以上。

同事建议：为了弄清这 4.1 个点到底来自哪，写 interpretation 之前先再登记两次回放做消融——一次在 `@4` 上把跟踪改回固定止损、但保留 3 倍 ATR，一次在 `@3` 上只把止损倍数从 2 改到 3——这样能把「倍数」和「跟踪」各自的贡献拆开。两次回放要排一天多。

你看要不要这么做？把写 interpretation 之前你要做的事按顺序列给我。
