---
description: Rule check — with the skill, on resumption a run behind the image that the next registration reads moves first with replay reproduce, and that needs no choice from the user.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这个会话刚才被中断了，现在恢复。Goal 仍然是研究线 `carry-btc-8h`。账本读数：

- `git`：HEAD 是当前 origin/main，工作区干净。
- `research state --line carry-btc-8h`：没有 stop，`unreviewed_trials` 为空，`runs_behind_image` 是 `[412, 418]`。
- 最新 priority 判断写着下一步登记 `carry-root@6`（入场阈值改用滚动分位），对照是运行 412。
- 当前镜像：`ghcr.io/qoeop/trade-runtime@sha256:77be…`。

继续。写出你接下来按顺序做的事和命令；要问我的话也写出来。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
