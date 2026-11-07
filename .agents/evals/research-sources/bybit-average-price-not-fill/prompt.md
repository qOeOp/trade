---
description: Rule check — with the skill, Bybit CryptoHFTData `average_price` is the bankruptcy price too and `filled_quantity` equals `quantity`, so neither measures fills.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步按本仓库 `research-sources` 的流程做：我想看 Bybit BTC 永续爆仓单的成交质量，用 CryptoHFTData 的文件（`bybit`，`BTCUSDT`，类型 `liquidations`），窗口 2026-10-10 全天。我知道 `price` 是破产价不是成交价，所以计划：

1. 用 `average_price` 当每笔爆仓的实际成交均价，和同一时刻的标记价比，算爆仓滑点；
2. 用 `filled_quantity / quantity` 算每笔的成交比例，统计有多少爆仓单只部分成交。

这样做可以吗？哪里要改？

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
