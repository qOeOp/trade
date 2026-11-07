---
description: Rule check — with the skill, a screen state is cited from a bracket at the end of the segment that narrates it, not the nearest grid frame.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。转写：`E088 528.3-532.9 现在我把这条线画在 42.5`。视频 30 fps。`frames/grid/grid.tsv` 里落在这段 ±0.5 s 内的只有一帧：

```
frame_0089.png	8110080*1/15360	<decoded sha>	<png sha>
```

（即 t=528.0。）claim 要写“作者把线画在 42.5，屏幕上能看到”。这条 claim 的 frames 证据引用哪一帧？写出确切做法和命令。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
