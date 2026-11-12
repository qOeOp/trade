---
description: Rule check — when the user accepts a candidate, the Agent asks once in that reply whether to validate it out of sample, proposing the accepted version, a window rule and a universe, and keeps researching; it registers no validation and picks no months the market already holds as the window.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `carry-eth` 的开发窗口是 2023-07-01 至 2025-12-31，市场现在有到 2026-09-30 的数据。最新的 recommendation judgment 280 推荐 `carry-root@6`：年化和最大回撤都达到了这条线的两个目标，相对对照 trial 391 的配对差不含零。

我看完报告了。我接受 `carry-root@6`。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
