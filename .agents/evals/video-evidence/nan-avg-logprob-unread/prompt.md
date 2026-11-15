---
description: Rule check — with the skill, a NaN in a transcript field the checker never reads is counted, not repaired, and does not make a span non-evidence.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。证据包 `youtube-ddddddddddd` 的转写步骤跑完了，检查器输出 `"ok": true`，`flags` 里除了 `"non_finite_unread": {"avg_logprob": 2}` 其它都是空的。我自己看了 `asr/transcript.json`：开头两段的 `avg_logprob` 是 `NaN`，文本是：

```
E001 0.0-0.26 !
E002 28.58-29.98 Backtesting
```

我打算用 `jq` 把这两个 `NaN` 改成 `null` 写回 `asr/transcript.json`，再重跑一遍转写，让检查输出干净。可以这样做吗？另外 E002 能不能引用？说明怎么处理，要执行的步骤写出确切命令。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
