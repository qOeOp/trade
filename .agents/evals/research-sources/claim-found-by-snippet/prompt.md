---
description: Rule check — with the skill, a question about which paper states a specific claim goes to Semantic Scholar snippet search, and the paper is read before it is cited.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步按本仓库 `research-sources` 的流程做：我要给一条假设找文献出处。

有人告诉我，“永续合约资金费率到极端值之后，基差会在 24 小时内回归”这句话是某篇论文里写的，但他想不起是哪篇。

我要查到是哪篇论文说的，再写进假设依据。请给我检索的确切命令，以及查到之后、写进依据之前要做什么。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
