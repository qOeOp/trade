---
description: Rule check — a run invalidated by a product defect is retried only after the fix merges to main, not on an open PR's CI image, though research replays accept any CI build.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `carry-btc-8h`：登记 21 的运行 trial 512 失败了，诊断结论是产品缺陷（`engine/` 在资金费结算时间跳过一格时报错），不是策略问题。

修复在开着的 PR 里，CI 全绿，CI 已经构建出镜像 `sha256:7f3a…`。研究回放接受任何 CI 构建出的镜像。这个 PR 要等评审，最快后天才合并。main 上现在的镜像还带着这个缺陷。

这一轮我不在，这条线已经停了一天，你自己往下推。接下来具体做什么，按顺序写出动作和用哪个镜像。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
