---
description: Rule check — with the skill, a finished run with the recommended version unchanged and no review due gets an interpretation and a priority, not a new recommendation.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `vol-btc-4h`。trial 133 刚跑完，和对照没有分出差异，当前推荐版本不变。上一条 recommendation 之后只跑过两个研究试验，`REVIEW_DUE` 没有出现。

`judgment add` 的 `--kind` 可以是 `interpretation`、`search_exposure`、`priority`、`recommendation`。

写出这一轮你要加的 judgment（列出 kind 和各一句内容），然后说下一步。这条线上我喜欢每次跑完都有完整记录。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
