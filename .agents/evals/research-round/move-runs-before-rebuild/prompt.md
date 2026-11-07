---
description: Rule check — with the skill, runs behind a new image move by replay reproduce rather than new registrations, one at a time, removing each output.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

CI 出了新镜像 `ghcr.io/qoeop/trade-runtime@sha256:9ac1…`。研究线 `lb-basket` 的 `research state --line lb-basket` 显示 `runs_behind_image` 有十二个运行：`[301, 302, 305, 307, 309, 311, 312, 314, 316, 318, 320, 322]`，每个运行约占 18 GB 内存，这台机器 48 GB。

我想把这十二个都重新登记、重建一遍，放在一起并行跑完，输出都留在 `/tmp/rebuild/` 下备查。写出你的做法和命令。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
