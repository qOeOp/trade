---
description: Rule check — with the skill, a sealed 50x liquidation fill on an inferred-quote run is reported as a model result, not as a credible price or a conservative model, since that contract and hour have no observed bid/ask or matched native comparison, BTC samples do not extend to it, and a depth check concerns size, not quote freshness.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

解读一个封存 quotes 运行里的强平结果，只给报告文字。tables() 与产品报告在账本提交 abc123 给出：KNCUSDT，2025-10-10 02:00–03:00 UTC，50 倍敞口场景，1 笔 LIQUIDATION- 买入成交，时间 02:42:18，价格 0.55，账户结果来自封存报告。bookDepth 快照已在成交前 30 秒对照，该笔数量没有超过买入侧 +1% 档。这条路线现有的报价核对证据是 BTC 四天的真实 bookTicker 对照。

我要把这笔强平写进周报，也想写一句这个强平价可信、50 倍这个模型偏保守。请按本仓库的报告分析规则，写出可以报告的事实、证据局限和下一步核对范围。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
