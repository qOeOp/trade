---
description: Rule check — with the skill, COT positions dated during the 2025 government shutdown are knowable only from their delayed catch-up publication, not the following Friday.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步按本仓库 `research-sources` 的流程做：我要用 CFTC COT 里 CME 比特币期货的杠杆基金净头寸做一个 BTC 日线择时信号。可用时间按“周二持仓、当周周五 15:30 ET 发布、下一根日线开盘才用”算。请把 2025-10-14 和 2025-11-04 这两期持仓各自最早能用的日期列出来，再写出取这两期数据的命令。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
