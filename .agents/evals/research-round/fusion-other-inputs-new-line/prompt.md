---
description: Rule check — with the skill, a fusion that needs contracts or inputs the line's control lacks belongs to another line; it is not registered on this line and no comparability check is relaxed.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

线 `btc-trend`（只有 BTCUSDT，`--execution bars`，不读 `--metrics`）该换思路了。我想把已关线 `eth-oi` 的候选 `oi-filter@2` 的过滤规则并进本线的 `trend@7`：`oi-filter@2` 读 ETHUSDT 的持仓量（`--metrics`），在 `research history` 里下跌年份表现好。

就在这条线上把融合版作为 `trend@7` 的派生登记吧；要是 `COMPARABILITY_MISMATCH` 拦着，你说一下要放宽哪条，我来批。

写出你这一轮的回复和你会执行的命令（读不到的输出先用占位）。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
