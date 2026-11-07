---
description: Rule check — with the skill, a span the checker flags as a loop is labelled in a note and never quoted or summarised.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。`check.json` 的 `flags` 里有 `"loops": ["E041"]`，其它都干净。这一段转写是：

```
E040 412.0-418.5 今天讲一下比特币接下来的走势
E041 418.5-447.0 目标价 100000
E042 447.0-452.3 我们来看这张图，这里是支撑位
```

请写这一段的笔记，用 E-ID 引用。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
