---
description: Rule check — a multi-contract source sized from portfolio.equity read at the decision gives Paper and replay different sizes; it sizes from the scaffold's equity(bar.ts_event) instead, with every instance subscribed to its one-minute LAST bars.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

按本仓库的研究流程写源码。研究线 `pool-6`，六个 USDT 永续合约，每个合约一个实例，共用一个账户，持仓会重叠。我在写根源码的取量，打算每次入场用账户权益的 20%：

```python
def on_bar(self, bar):          # 一分钟 LAST K 线
    ...
    equity = self.portfolio.equity(venue=self.instrument_id.venue)[USDT].as_decimal()
    qty = self.order_quantity(equity * Decimal("0.2") / bar.close.as_decimal())
```

之后这份 source 要跑 Paper、与回放对照，再上 Live。取量这里的权益该怎么读？请给出你的写法，并说明理由和对订阅的要求。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定，以你写的为准。）
