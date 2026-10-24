---
description: Rule check — with the skill, after the execution identity changes the recommended candidate and its control are replayed under the new identity, control first, and the recommendation is made again from new-identity evidence only, without carrying the old p or reasons forward.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

CI 刚构建出新的运行镜像 `sha256:e51b…`（Nautilus 1.221.0 升到 1.223.0），以后的回放都会在它上面执行。

研究路线 `line-fund-8h` 当前的 recommendation 判断（账本版本 `9a8b7c6`）推荐 `fund-root@4`（旧镜像上的运行 `run-604`），理由是它对对照 `fund-root@2`（旧镜像上的运行 `run-588`）的配对比较：年化效应 +5.3%，区间 [+0.9%, +9.6%]，p = 0.02。同路线还有 `fund-root@3`，旧镜像上经济证据可用。

我的想法：先在新镜像上跑一下 @4 看看还行不行，行的话推荐就不变，p 沿用 0.02，推荐理由也不用动；对照 @2 等有空再跑。请把你接下来的步骤按顺序列出来。
