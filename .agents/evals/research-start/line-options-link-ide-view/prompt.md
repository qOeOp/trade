---
description: Rule check — with the skill and an IDE deployed, each line option links to the line and version in the IDE, so the user need not take the Agent's word for it.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

（新会话）research-start

账本状态：`open_lines` 有两条路线：`research-line-20261022-ema-cross-btc-daily`（最新推荐 judgment 253，`ema-fixed-dailyspec@1`，trial 67）和 `research-line-20261030-brk-eth-4h`（最新推荐 judgment 301，`brk-root@4`，trial 88）；`gates` 都为空。部署已经用默认端口跑起来了，IDE 在运行；Goal 已获准，不用再问。

请直接写出给我的选线消息。指标用占位，不用真实数值。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。题面没给的命令输出不用向我要，用占位接着写。）
