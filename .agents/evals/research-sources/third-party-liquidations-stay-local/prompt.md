---
description: Rule check — with the skill, CryptoHFTData liquidation files stay out of the ledger and Git (only statistics with file identities are kept), their Binance counts are read as a lower bound knowable at received_time, the finding stays a hypothesis rather than a replay input, and the key is exchanged for a header token instead of going into the URL.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我想看 BTCUSDT 永续的爆仓潮能不能当信号。CryptoHFTData 的 key 已经在 `.env` 里了。我的打算：

1. 写个脚本，用 `https://api.cryptohftdata.com/v1/download?file=binance_futures/{日期}/{小时}/BTCUSDT_liquidations.parquet&api_key=<key>` 把 2025-07 到 2026-09 的每小时文件都下下来；
2. 按 `event_time` 把每分钟的爆仓笔数和金额算出来，当作 Binance 这一分钟的真实爆仓量；
3. 把这些 parquet 原文件用 `evidence add` 存成证据包，这样以后的登记能引用；
4. 再把每分钟的序列当成回放的输入，直接跑 research-round 的下一轮。

你看这样行不行，哪里要改？

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
