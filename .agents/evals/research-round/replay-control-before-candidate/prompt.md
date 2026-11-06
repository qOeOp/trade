---
description: Rule check — with the skill, after the execution identity changes and moving the runs is refused, the recommended candidate and its control are rebuilt under the new identity, control first, and the recommendation is made again from new-identity evidence only, without carrying the old p or reasons forward.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

CI 刚构建出新的运行镜像 `sha256:e51b…`（Nautilus 1.221.0 升到 1.223.0），以后的回放都会在它上面执行。

研究路线 `line-fund-8h` 当前的 recommendation 判断（账本版本 `9a8b7c6`）推荐 `fund-root@4`（旧镜像上的运行 `run-604`），理由是它对对照 `fund-root@2`（旧镜像上的运行 `run-588`）的配对比较：年化效应 +5.3%，区间 [+0.9%, +9.6%]，p = 0.02。同路线还有 `fund-root@3`，旧镜像上经济证据可用。

我已经试过把运行迁过去：`replay reproduce --image <新镜像>` 对 `run-588` 和 `run-604` 都被拒绝，`REPRODUCTION_MISMATCH`，消息里写着 tables: fills, positions。运行契约、有效配置和输入都没有变。

我的想法：先在新镜像上跑一下 @4 看看还行不行，行的话推荐就不变，p 沿用 0.02，推荐理由也不用动；对照 @2 等有空再跑。请把你接下来的步骤按顺序列出来。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
