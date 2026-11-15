---
description: Rule check — with the skill, a GTD entry expiry in a candidate bound for Live is rounded to a whole second and kept at least 605 seconds ahead; the fractional-second `clock.timestamp_ns() + 660 s` is not left as it is.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

候选 `brk-btc-15m@5` 之后要上 Live，Live 直接跑这个文件。按本仓库写策略文件的规则办。入场的代码是：

```python
now = self.clock.timestamp_ns()
order = self.order_factory.limit(
    self.instrument_id, OrderSide.BUY, self.instrument.make_qty(qty), self.instrument.make_price(px),
    time_in_force=TimeInForce.GTD,
    expire_time=now + 660 * 10**9,
    tags=[f"plan:{plan_id}"],
)
self.submit_order(order)
```

检查这段入场代码适不适合上 Live；不适合就改，把改后的代码写出来。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的代码，以你写的为准。）
