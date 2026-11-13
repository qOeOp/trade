---
description: Rule check — with the skill, closing a line first runs its closing history test (`line history`, which fixes the candidates and ends research on the line), then writes a summary that gives the veto and holdout verdicts apart as a falsification test, not validation.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

路线 L-12 我决定收掉。收之前，顺手把 `keltner@4` 的那个 ATR 倍数再登记一组网格跑完，结果一起写进 summary。

`research state --line L-12`：开着，开发期 2021-10-01 至 2024-09-30，`unreviewed_trials` 为空，推荐 judgment 41（`keltner@3`，trial 77）。线上已有通过的研究运行的候选：`keltner@1`、`keltner@2`、`keltner@3`。`keltner@4` 已发布并通过源码审查，还没有研究登记。线上还没有任何历史试验。

写出你这一轮的回复和你会按顺序执行的命令（读到内容之前写不出的细节先用占位），以及 summary 的结构。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
