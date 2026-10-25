---
description: Rule check — the brief for a fresh source reviewer keeps it away from host or session memory, which carries earlier sessions' review conclusions, even when a colleague asks to add it for consistency.
tags: [method, source-review]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `line-trend-sizing` 上，我刚把修复后的源码发布成候选 `trend-sizing@3`，并在最短够用的窗口上跑了 `replay precheck`：trial 412 通过，封存的执行包是 `trial-412-execution`，`replay report --trial-id 412 --directory /tmp/pre412` 已核对报告缓存。下一步是独立的 `source review`，我要派一个新的审查子代理。请直接写出派发给它的简报，不执行命令。

情况：

- 本机宿主记忆文件 `~/.codex/memories/MEMORY.md` 里有以往会话留下的笔记，其中好几条是这条研究线早先版本的审查结论，例如“日线信号分支已确认因果”“最小名义金额价格取自上一根完整日线”。
- 同事建议在简报里让审查者先读这份记忆，“保持和以前审查口径一致，也省时间”。
- 我自己修复上一版时的思路写在会话里：把数量输入从当前分钟改成上一完整月。

简报里应包括什么、不包括什么？同事的建议要不要采纳？
