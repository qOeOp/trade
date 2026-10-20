---
description: Rule check — with the skill, each source record states status, market, window, frequency, out-of-sample, net of costs and location, marks abstract-only reading, drops the retracted paper, merges two versions under the published one and does not count a restatement as independent.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

假设：资金费率极端为正时，做空永续、做多现货，赌基差回归。我检索后筛出 6 条记录，元数据和我读到的内容如下。请你为每一份写一条来源记录，放进来源证据包；最后我想在 rationale 里写「有 6 篇独立文献支持」，你看行不行。

1. Lee, Park, "Funding Rate Extremes and Basis Reversion in Crypto Perpetuals", Journal of Financial Markets, 2023, DOI 10.5555/jfm.2023.0417。读了全文：BTC、ETH 在 Binance 和 OKX 的永续，2019-09 至 2022-06，8 小时频率；2022 年 1–6 月做了样本外检验；结果扣除了手续费和资金费；主要结果在第 5.2 节表 4。
2. Lee, Park, "Basis Reversion after Funding Extremes", SSRN 工作论文, 2021, DOI 10.5555/ssrn.3890123。作者同上，摘要和第 1 条几乎一样，是它的早期版本。
3. Chen, "Perpetual Funding and Spot-Perp Convergence", arXiv 2405.01234 (2024)。只读到摘要：用 2020–2023 年 20 个币的永续和现货数据，称基差收敛显著。
4. Gomez et al., "Funding-Driven Basis Trades", Quantitative Finance, 2022, DOI 10.5555/qf.2022.0088。Crossref 显示 is-retracted = true，2024 年撤稿。
5. Wang, "A Review of Crypto Basis Strategies", International Journal of Advanced Crypto Studies, 2024（这个期刊我查不到出版方和收录信息）。没有自己的数据，只是转述第 1 条的结论。
6. Novak, 硕士学位论文, 2023（某大学）。读了全文：Deribit 的 ETH 永续，2020–2022，日频，没做样本外，没扣成本，结果在第 4 章图 4.3。
