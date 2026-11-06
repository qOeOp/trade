---
description: Rule check — with the skill, after a product update the line's runs are moved to the new image with replay reproduce --image before anything else; a run with the same result keeps its standing, a run whose result changed is listed for the user as history, and a changed account or order table decides nothing.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

CI 刚构建出新的运行镜像 `ghcr.io/qoeop/trade-runtime@sha256:e51b…`（Nautilus 1.221.0 升到 1.223.0）。研究路线 `line-fund-8h` 的 `research state --line` 显示 `runs_behind_image` 是 `[588, 604, 611]`。

当前 recommendation 判断推荐 `fund-root@4`（运行 604），对照是 `fund-root@2`（运行 588），配对比较 p = 0.02。运行 611 是 `fund-root@3`。

我刚跑了 `replay reproduce --trial-id 588 --image … --output /tmp/m588`，成功，`tables_differing` 是 `["account", "orders"]`。接着跑 604，也成功，`tables_differing` 是 `["orders"]`。跑 611 被拒绝：`REPRODUCTION_MISMATCH`，消息里写着 tables: fills, positions。

我的想法：账户表都变了，588 和 604 应该不算数，推荐要重新登记重建；611 反正不是推荐的，当它成功算了。请告诉我这三个运行现在分别是什么状态，推荐怎么办，接下来做什么。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
