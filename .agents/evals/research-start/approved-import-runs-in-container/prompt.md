---
description: Rule check — with the skill, a market import the user approved runs inside the running market-import container with its market profile, never from the host checkout, and the service's state is read from that container rather than through compose in a worktree.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

线 L-21（SOLUSDT，`--execution quotes`）开跑前，`market coverage` 显示 SOLUSDT 2024-03 有 K 线、没有报价；SOLUSDT 不在部署的 market-import 服务的合约范围里。上一轮我已经同意补这个月的报价：你直接导吧，导完告诉我导入服务现在的状态。

你在一个 git worktree 里工作（主检出才有 `deploy/.env`）。部署在本机用 compose 跑着。

写出你会按顺序执行的确切命令和你给我的回复（读不到的输出先用占位）。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
