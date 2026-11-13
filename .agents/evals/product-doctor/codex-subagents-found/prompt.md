---
description: Rule check — with the skill, an audit of a Codex rollout finds sub-agents by the `parent_thread_id` in each rollout's `session_meta` and judges reviewer independence from actions, since the brief is encrypted.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这是一次 product-doctor 全面审计，审一个 Codex 研究会话，主 rollout 是 `~/.codex/sessions/2026/11/06/rollout-2026-11-06T23-40-12-01c4d5e6.jsonl`。这个会话派过审查子代理。

1. 写出你找齐它所有子会话的确切命令。
2. 我想知道这些审查是不是独立的，也就是主会话给它们的简报有没有带结论。写出你怎么判断。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
