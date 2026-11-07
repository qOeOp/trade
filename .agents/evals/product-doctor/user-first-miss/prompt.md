---
description: Rule check — with the skill, a research session's first question to the user is checked option by option along the consumer path (can the option register now on the pinned market commit and window, does `research state` gate it, does it carry the Goal targets); findings are reported by measured cost with one id per root cause, and the user-first item names the workstream that missed it.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这是一次 product-doctor 聚焦诊断，只给判断、不实际修改。以下为题设，不需要寻找真实产品记录。

昨天的研究会话（Codex，thread `01c4d5e6-…`）第 1 轮就向用户提问，原文：

> 上一条线已到期。请选下一步：
> A. 在候选 `CAND_A@3` 上开新线，窗口 2024-01-01 至 2025-12-31，市场提交 `m7`。
> B. 先研究更长历史下的新实质问题，方向我随后提。
> C. 用候选 `CAND_B@1` 开 15m 线，窗口 2025-07-01 至 2025-12-31，市场提交 `m7`。

提问前后的产品输出（都在转录里）：

- 第 1 轮提问前 `research status`（钉 `m7`）：`CAND_A@3` 在 2024-01-01–2025-12-31 已有 trial 231（预检，同源码同提交），`registration add` 会以 `SOURCE_ALREADY_EXPOSED` 拒绝；`CAND_B@1` 在 2025-07-01–2025-12-31 无暴露，可登记。
- 第 1 轮提问前 `research state`：`gates` 只有 `RESEARCH_LINE_REQUIRED`（没有开着的线），`targets` 为 null（账本没有默认目标）。按 research-start，线和账本都没有目标时要向用户要最大回撤上限和最低年化，Goal 要用这两个目标来组，建好 Goal 才进 research-round 跑第一次回放；三个选项都没写这两个目标。
- 用户选了 A；第 3 轮 `registration add` 被 `SOURCE_ALREADY_EXPOSED` 拒；第 4–11 轮 Agent 自己在源码里找可改之处；第 12 轮用户说「是不是 A 根本登不了，你问之前没查？」；第 13 轮重新提问，用户选 C；第 15 轮 `research state` 的 `targets` 仍为 null，第 16 轮才向用户要到目标并设 Goal。按转录时间戳，从首问到第一条线能跑回放用了 41 分钟，其中第 4–11 轮占 23 分钟。
- 两天前另一场会话的首问选项也全部不能立即登记，索引里记为 `20261020-07`（原因：提问前没有按产品输出逐项核对选项；修法：提问前逐项核对），状态 `fixed abc1234`。昨天这场会话的检出已包含 `abc1234`。

请按诊断流程给出发现与记录写法。
