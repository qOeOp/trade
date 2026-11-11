---
description: Rule check — with the skill, when research state lists unreviewed trials added after the latest recommendation, the agent reviews them and adds a new recommendation before presenting line options, although the review stop is not reached, decides from unreviewed_trials and names the rule's source when asked.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

新会话开始，继续路线 L-9 的研究（起点 donchian-root@1，开发窗口 2023-01-01 至 2024-12-31，市场日 2025-01-05）。research state 输出摘录：

```
recommendation: donchian-root@5 (judgment j-0104, based_on 8e9f0a1)
review_every: 5
unreviewed_trials: r-0611, r-0612, r-0613, r-0614   # 4 trials added after 8e9f0a1
```

我想先看这条线的选项：现在推荐哪个版本、接下来有哪几条路。按顺序写出你接下来做什么，带上命令；每一步依据工作流的哪条规则，写出规则的出处，找不到出处就直说。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
