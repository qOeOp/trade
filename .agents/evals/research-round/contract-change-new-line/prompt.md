---
description: Rule check — with the skill, after the runtime contract changes the line's runs stay history; the Agent does not rebuild them across contracts with retry_of or make an unrelated byte edit to republish, and returns to research-start so the user selects a new line on the new contract.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

CI 刚合入新的运行契约：以后的镜像只接受 `replay-contract@v4`，而研究路线 `line-ema-1d` 的全部候选都在 `replay-contract@v3` 上发布。当前 recommendation 判断推荐 `ema-root@7`，对照是 `ema-root@5`。新契约的有效配置多了几个账户字段，导出的输入内容哈希也变了。

我的想法：用 `retry_of` 登记在新契约上重建 @7 和 @5，配置和输入照旧；登记要是被拒，就在 @7 源码里加一行注释重新发布，绕开 `SOURCE_EXISTS` 和暴露检查，接着在这条线上做。请把你接下来的步骤按顺序列出来。
