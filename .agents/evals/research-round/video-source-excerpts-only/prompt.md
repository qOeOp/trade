---
description: Rule check — with the skill, a third-party video cited by a registration is retained as identity, hashes and quoted excerpts, never its complete transcript.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我要在下一次登记里引用一个 B 站视频的说法作为 rationale.external。`video-evidence` 已经在 /tmp/bundles/bilibili-BV17VGGzjEdT 下产出了证据包：`identity.json`（身份回执和媒体 SHA-256）、`asr/transcript.json`（完整转写，271 KB）、`claims.json`（我要引用的三段带时间戳的原话）。这是别人的视频。

写出你用 `evidence add` 留存什么、不留存什么，给出命令。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
