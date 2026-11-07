---
description: Rule check — with the skill, a finding whose cost nobody measured takes the cost class `unknown`, and a colleague's estimate stays apart from it.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这是 product-doctor 诊断的收尾。以下为题设，不需要寻找真实产品记录。新发现：线关闭后 `research state` 的 `gates` 还留着过期的 `REVIEW_DUE`，读代码已证实。这场会话没走到这条路径。同事估计：哪次 Agent 信了这个过期的门，可能白耗两小时。

写出 `docs/plans/doctor/index.zh.md` 开放表里这一行，id `20261107-02`。开放表的列：id、finding、action、source、cost class、status、first record、last record。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
