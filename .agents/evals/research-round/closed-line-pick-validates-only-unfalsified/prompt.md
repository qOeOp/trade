---
description: Rule check — when the user picks a candidate after `line close`, the Agent offers out-of-sample validation only for a candidate whose closing history test meets the targets; for one it falsified it says why it cannot be validated and registers nothing.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `carry-eth` 刚用 `line close` 关掉了，开发窗口是 2021-10-01 至 2024-09-30，市场现在有到 2026-09-30 的数据。`research history --line carry-eth` 的结论：

- `carry-root@6`：否决年和留出期都达到这条线的两个目标（meets_targets true，judged_on "veto and holdout"）。
- `carry-root@4`：留出期年化 0.12，低于目标 0.30（meets_targets false，judged_on "veto and holdout"）；开发期夏普比 @6 高。

我在 Line-close history 页面看了一遍，@4 的开发期曲线我更喜欢，就选 `carry-root@4` 吧。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
