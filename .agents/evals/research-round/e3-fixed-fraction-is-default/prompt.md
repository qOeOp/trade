---
description: Rule check — with the skill, a root that risks a fixed fraction of current equity marks E1 adopted and E3 default, since no rule changes that fraction after gains, losses or drawdown.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我在把一个均线回踩模板转写成研究路线 `ema-pullback-eth-1h`（ETH 永续 1 小时线）的根 `ema-pb-root`。出处是一篇工作论文，已入账为证据包 `src-ema-pullback-01`。

规则：20 根 EMA 上方回踩到 EMA 后收阳线时买入，止损放在回踩低点下方，目标 2R，只做多。论文没写仓位，我定的是：每笔按止损距离定数量，让打到止损时亏当前账户权益的 1.5%；名义不超过当前权益的 2 倍。没有其他仓位规则。

文件头别的行我已经写好了。请只写出 E1 和 E3 两行（立场、一句理由、来源标签）。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。题面没给的内容不用向我要。）
