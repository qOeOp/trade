---
description: Rule check — with the skill, an economic hypothesis is written only after the sources already retained in the ledger are read and the remaining gap is searched following research-sources and entered as a bundle.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `tsm-alt-1h`：20 个中市值山寨币 USDT 永续，1 小时线，开发窗口 2023-01-01 到 2025-06-30，当前推荐候选 `tsm-root@4`（单品种时序动量）。

我想提一个经济假设：资金费率极端为正时多头拥挤，这时动量信号的做多入场更容易被反杀，所以资金费率高于某个分位时不开新的多单。

账本里已经留存的来源证据包（`evidence export` 能列出来）：
- `src-funding-crowding-01`：一篇论文的原件和摘录，BTC、ETH 永续，2019–2022，8 小时资金费，讨论资金费率高企与多头拥挤、之后收益反转的关系，含手续费。
- `src-oi-equity-03`：一篇讲股指期货持仓量与动量崩溃的论文摘录。
- `src-tsm-02`：时序动量原始论文，这条路线的根就是照它转写的。

同事建议：这些包都是半年前的，没必要翻，直接去 OpenAlex 搜一次 "funding rate momentum crash"，挑一两篇支持的就行；而且先把假设和登记体写出来，再去找文献支撑，效率更高。今天想把登记交上去。

请按顺序列出你接下来要做的每一步（含命令），并说明每一步产出什么。
