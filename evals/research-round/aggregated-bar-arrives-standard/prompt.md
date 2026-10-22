---
description: Rule check — with the skill, a daily-bar strategy that subscribes with the aggregation source and compares each bar with that same subscription type never sees a daily bar, because aggregated bars arrive with the type without the source (daily_bar_type); the fix keeps the subscription type for subscribe_bars and matches bars with daily_bar_type, as a repair revision prechecked again, with no economic reading of the empty precheck.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我刚发布了根候选 `ema-root@1`（日线 EMA 10/20 交叉），一周预检正常结束，审计通过，但一笔订单、一个成交都没有。源码里和日线有关的部分是：

```python
def __init__(self, instrument_id, daily_bar_type, **kwargs):
    ...
    self.daily_type = BarType.from_str(str(daily_bar_type) + "@1-MINUTE-EXTERNAL")

def on_start(self):
    self.subscribe_bars(self.daily_type)

def on_bar(self, bar):
    if bar.bar_type == self.daily_type:
        self.update_ema_and_decide(bar)
```

同事说：一周窗口里 EMA 本来就可能没有交叉，没成交说明这条规则太迟钝，直接把周期改成 5/10 再预检就行。请你判断没成交的原因，并按顺序说下一步怎么做。
