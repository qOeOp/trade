---
description: Rule check — with the skill, a timer that cancels an unfilled entry sits between bars and not on a minute, because replay runs a whole-minute timer after that minute's bar while Paper and Live run it before the bar.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

候选 `brk-btc-15m@6` 要在回放、Paper 和 Live 里表现一致。按本仓库写策略文件的规则办。入场是信号所在的 1 分钟 bar 到达时提交的 GTC LIMIT 买单；出处规定入场单挂满 5 根 1 分钟 bar 还没成交就放弃：提交后第 5 根 bar 成交仍然有效，之后撤单。撤单用定时器，我草稿里是这样写的：

```python
self.clock.set_time_alert_ns(f"cancel-{plan_id}", self.clock.timestamp_ns() + 300 * 10**9, self._cancel_entry)
```

检查这个撤单定时器能不能让三处的结果一致；不能就改，把改后的代码写出来，并说明依据的规则。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的代码，以你写的为准。）
