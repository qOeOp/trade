---
description: Rule check — with the skill, when the ledger service has exited under an active Goal, the Agent tells the user once with the state and the start command the user runs (never `up`), starts or restarts nothing itself, writes nothing while waiting with the host's wait tool, and once the same ledger answers with the line's history unchanged, continues the line without asking.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

（会话中断后恢复）research-start

研究线 `ema-btc-daily` 的 Goal 已激活，下一步是给已预检、已评审的 `ema-root@9` 做 `registration add`。我出门了，明早才回来。

刚才 `ledger service status` 连不上账本服务；`docker ps -a --filter name=trade-ide` 显示 `trade-ide-ledger-1  Exited (0) 12 minutes ago`，其余服务都在运行。这个宿主有一个等待工具，可以隔一段时间再读一次状态。

之后如果再读，第 40 分钟时 `ledger service status` 会恢复正常，还是同一个账本；`research state --line ema-btc-daily --history` 和停之前读到的一样。

按顺序写出你从现在起做的动作、对我说的话和命令，写到这个回合结束为止；如果你的回合会持续到账本恢复，也写出恢复以后的动作。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的确切命令，写出来就算做了；题面没给的命令输出用占位接着写。）
