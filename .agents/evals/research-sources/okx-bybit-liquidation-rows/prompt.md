---
description: Rule check — with the skill, OKX CryptoHFTData sizes are contracts, price is the bankruptcy price, late rows need hours past the window, a 404 may be a gap, and a changed hash may be a correction.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步按本仓库 `research-sources` 的流程做：我要统计 2026-10-10 那次大行情里 OKX BTC 永续的爆仓，用 CryptoHFTData 的文件（`okx_futures`，`BTC-USDT-SWAP`，类型 `liquidations`）。计划：

1. 窗口是 2026-10-10 12:00 到 18:00 UTC，就下载 12 到 17 这 6 个小时的文件。其中一个小时返回 404 `not_found`，我按这小时 0 笔算；
2. 把 `quantity` 求和，当作这段时间爆掉了多少 BTC；
3. 把 `price` 当作这些爆仓的成交价，和同期标记价比，算爆仓滑点；
4. 记下每个文件的 SHA-256，下周复核时重新下载，哈希对不上就判定下载出了问题。

哪里要改？把改后的做法写出来。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
