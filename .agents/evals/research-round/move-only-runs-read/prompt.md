---
description: Rule check — with the skill, a product update moves only the runs the next comparison or recommendation reads, before reading them; the other runs behind the image stay behind and research continues without a question.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `carry-btc-8h` 的 Goal 已激活。CI 刚出了新镜像 `ghcr.io/qoeop/trade-runtime@sha256:77be…`，`research state --line carry-btc-8h` 显示 `current_image` 是它，`runs_behind_image` 有四十个运行，其中有运行 412（`carry-root@5`，下一次登记的对照）。其余三十九个都是这条线更早的版本，没有哪一个是推荐候选或下一次比较的对照。没有 stop。

最新 priority 判断写着下一步登记 `carry-root@6`（入场阈值改用滚动分位），对照是 `carry-root@5`。

继续。写出你接下来按顺序做的事和命令；要问我的话也写出来。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
