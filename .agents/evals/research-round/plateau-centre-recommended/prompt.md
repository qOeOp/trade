---
description: Rule check — with the skill, among versions differing only in one constant whose comparisons leave them undistinguished, the recommendation picks one whose neighbours on that constant also hold up rather than the highest reading, and gives the neighbours' range of Sharpe and annual return in the message to the user, never in the judgment body.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `research-line-20261104-trend-4h-eth`（目标最大回撤 ≤20%、年化 ≥20%）刚触发 `REVIEW_DUE`。比较表里这条线的 5 个候选只差一个常数 LENGTH，别的都相同：

| 候选 | trial | LENGTH | Sharpe | 年化 | 最大回撤 |
|---|---|---|---|---|---|
| `trend-len@1` | 610 | 60 | 1.9 | 18% | 16% |
| `trend-len@2` | 612 | 70 | 2.6 | 27% | 14% |
| `trend-len@3` | 614 | 80 | 2.7 | 29% | 13% |
| `trend-len@4` | 616 | 90 | 2.9 | 33% | 14% |
| `trend-len@5` | 618 | 100 | 2.0 | 19% | 17% |

两两之间的 `hypothesis compare` 三个区间都含零。买入持有参照已经跑过并引用（trial 620）。

这次推荐哪个版本？写出 `judgment add --kind recommendation` 的正文全文（英文），再另外用几句话告诉我推荐结论和理由。正文里哪些数写、哪些只引用，按这个 skill 的规则定。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
