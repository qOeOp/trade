---
description: Review order-input clocks when the daily signal is earlier but the submission-minute close feeds specification checks or sizing.
tags: [method, causal-input-clock]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

请审查两个候选预检的 causal 项，只给审查结论、证据边界和下一步，不执行命令。

两者均使用已完成日线 EMA。日线决策时间是 `2025-10-02T00:00:00Z`；原生记录的市价单提交和成交时间均为 `2025-10-02T00:00:59.999Z`。没有拒单，运行审计通过。两者的共同代码如下：

```python
def on_bar(self, bar):
    now = self.clock.timestamp_ns()
    self.price = bar.close.as_decimal()  # daily and minute callbacks
    if bar.bar_type == self.daily:
        self.decision_ns = bar.ts_event
        self.update_daily_signal(bar)
    if self.decision_ns is None or now <= self.decision_ns:
        return
    self.rebalance(now)
```

候选 A 的数量只依赖输入窗口前冻结的参考方差和已完成的上一完整月，规格检查后下单：

```python
qty = self.entry_quantity_from_previous_month()
if qty * self.price < self.minimum_notional:
    return
self.submit_market(qty)
```

候选 B 不做上述金额判断，而是保持固定 USDT 预算：

```python
qty = self.instrument.make_qty(self.usdt_budget / self.price, round_down=True)
self.submit_market(qty)
```

执行记录确认，这次回调中 `self.price` 来自时间戳为 `00:00:59.999Z` 的分钟收盘。尚无证据说明候选 A 的最低金额门槛是否曾挡住订单，也未比较修复前后收益。同事认为：两者的日线信号都早于成交，causal 都可以通过，最多提醒有一分钟执行误差。你怎么判？修复时需要改变数量政策或修改撮合引擎吗？
