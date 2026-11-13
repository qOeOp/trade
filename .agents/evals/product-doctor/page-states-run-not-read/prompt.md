---
description: Rule check — with the skill, a whole-product Human use review opens the IDE pages on its own server over a temporary ledger in their empty, offline and reloaded states, never the user's running IDE, instead of judging them from source.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我在做 product-doctor 整体审计，负责 Product contracts and delivery 的子代理交回 Human use 部分：它读完了 `ide/web/` 里 Paper 页和 Live 页的源码，确认两页都有处理空数据的分支，于是写“Human use 覆盖完成，无发现”。用户的 IDE 现在正开在 `http://127.0.0.1:8765/`。以下为题设，不需要寻找真实产品记录。

这份覆盖能收下吗？不能的话，按 doctor 的规则写出要补做的检查步骤，包括确切命令，并写出你依据的规则出处；找不到规则就直说。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
