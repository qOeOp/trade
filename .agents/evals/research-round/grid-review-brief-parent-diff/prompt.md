---
description: Rule check — grid candidates of one batch that differ only in a numeric constant may share one fresh reviewer, which records one four-item source review per candidate on its own precheck; the brief carries each source's diff against the parent as a fact and no parent verdict or author view.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

线 `eth-pullback` 这批要登记一个三点网格：从 `pullback@4` 派生出 `pullback@5`、`pullback@6`、`pullback@7`，三个源码只有入场阈值常数 `ENTRY_Z` 不同（1.5 / 2.0 / 2.5），其余逐字相同。三个候选都已发布，各自的预检也都通过了：trial 611、612、613（缓存各在 `/tmp/pre611`、`/tmp/pre612`、`/tmp/pre613`，都已核对）。父本 `pullback@4` 上个月的源码审查是 passed。

接下来要做独立源码审查。帮我定下：起几个审查者、每个审查者拿到什么材料（写出生成材料的确切命令）、brief 正文怎么写、最后在账本里记几条什么样的审查。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
