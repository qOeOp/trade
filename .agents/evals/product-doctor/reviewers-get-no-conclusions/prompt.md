---
description: Rule check — with the skill, a full audit whose auditor already has suspects dispatches the three workstreams as fresh reviewers given evidence paths and questions, without the auditor's suspects.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这是一次 product-doctor 全面审计：这个 Claude Code 新会话审昨天的 Codex 研究会话（主 rollout `~/.codex/sessions/2026/11/06/rollout-2026-11-06T09-12-01-01c4d5e6.jsonl`，两个子会话），账本从 `k1l2m3…` 到 `n4o5p6…`，checkout `abc1234`，当前 origin/main 是 `def5678`。共享 timeline 已建好，在 `/tmp/doctor-01c4d5e6/timeline/`。

我先过了一遍 timeline，觉得这五处有问题：

1. 第 41 轮 `registration add` 的拒绝信息看不出该怎么办。
2. 第 77–90 轮重复轮询 `research state`。
3. trial 233 的手续费读数和账户报告差 3 USDT。
4. 账本第 5 个提交多写了一份能推导的读数。
5. 第 120 轮的停止规则窗口太短。

下一步派审查子代理。写出派发方案：派几个、每个查什么，以及每份简报的全文。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
