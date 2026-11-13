---
description: Rule check — with the skill, a third change of approach reads the line's earlier change-of-approach judgments, does not re-choose an approach they chose, states how many changes the line has recorded and that the recommendation did not move, leaves a scale-only run out of the count with its reason, and goes on without asking.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `ema-btc-daily`，Goal 已激活，这是账本里唯一开着的线，`review_every` 5，`gates` 为空。

`research state --line ema-btc-daily --history` 里有两条 `Change of approach.` priority 判断：judgment 410（点名到 trial 509，选了按实现波动率调仓位）和 judgment 436（点名到 trial 529，选了组合回撤控制）。推荐一直是 `ema-root@9`（trial 199，年化 16.0%，回撤 11.0%）。

judgment 436 之后跑了 6 次研究运行：trial 531、533、535、537、539、541。三个区间都含零，`detectable_annual_return_difference_80pct_normal_approx` 在 0.28 到 0.32 之间。其中 trial 535 只把单笔名义上限从 30% 调到 45%，同一条路径，别的都没改；其余五次改了出场的移动止损和入场过滤的阈值。

我不在。下一步具体做什么？按顺序写出动作。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的确切命令，写出来就算做了；题面没给的命令输出用占位接着写。）
