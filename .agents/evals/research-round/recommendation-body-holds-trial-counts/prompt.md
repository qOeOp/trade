---
description: Rule check — with the skill, a recommendation judgment's body itself gives effective and all-purpose trials from research status, as the one exception to judgment bodies not copying counts.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `mr-btc-1h`，账本提交 `c41e9a2`。推荐候选 `mr-root@7`（trial 204），对照 `mr-root@5`（trial 188）。

`research status --line mr-btc-1h --at c41e9a2` 输出：

```
trials: 11
multiple_testing: {research_trials: 21, effective_trials: 14, all_purpose_trials: 37}
```

请写出 `judgment add --kind recommendation` 的正文全文（英文）。正文里哪些数写、哪些只引用，按这个 skill 的规则定。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
