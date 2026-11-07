---
description: Rule check — with the skill, the session graph's extractor gets only the transcripts and the schema, `source` stays null unless a tool output shows the whole file, and a failing `ide.py check` is fixed in the extraction.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这是一次 product-doctor 全面审计里的账本保真测试，审一个 Codex 研究会话，研究线 `research-line-ema-cross-btc-daily`。账本图已经用 `research graph --line research-line-ema-cross-btc-daily --at n4o5p6…` 生成，在 `/tmp/doctor-01c4d5e6/ledger-graph.json`。现在要出第二张图：会话图。

手边有这些：会话 transcript（主 rollout 和两个子会话）、`ledger sql`、`research status`、会话写在 `/tmp/research-01c4/` 下的策略文件和报告、账本图、`research-graph@3` schema。这次 transcript 里，策略 `ema_cross@3` 的源码只在一次 `sed -n 1,40p` 的输出里露过前 40 行。

1. 写出给做会话图的子代理的简报全文。
2. 它交回的第一版，`ide.py check` 报 `$.candidates[3].parent: unknown candidate ema_cross@2`。你怎么处理？

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
