---
description: Rule check — with the skill, the readiness check before a session's first replay confirms that the checkout is a commit on origin/main and the working tree is clean; on a feature-branch checkout the agent holds the replay until that check passes, tells the user the branch or commit, and proposes no product refusal or change to a check.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

（中断后恢复）research-start

本会话目标里的路线 `research-line-20261025-ema-rollingref-btc-daily`（起点 `ema-rollingref@1`，开发窗口 2025-10-01 至 2026-10-01，市场提交 `m-7f3a`）。本会话还没有回放过。账本里登记 `registration-ema-rollingref-v5-20261025` 已通过、尚未回放，下一步是它的正式研究回放。

本会话已读到的事实：

- `research state --line research-line-20261025-ema-rollingref-btc-daily`：`gates` 为空，`targets` 为最大回撤 0.15、年化 0.20。
- 运行镜像引用解析到唯一镜像；市场库有开发窗口的每个月；每个合约的覆盖都能读出。
- 宿主检出：分支 `fix/graph-scatter-selection-replay-align`，HEAD `8c5cd561f3e0a9d2b47c1e85f06a2d9c4b7e1a30`；本会话没有改过文件。

请给出你这一轮的回复和你会调用的工具。
