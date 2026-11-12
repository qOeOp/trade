---
description: Rule check — a path-dependent state rebuilt from the first warm-up input (a trend state machine fed by fixed-window swing points) is ready only from the input count at which two different warm-up starts give the same state; window-start sensitivity is a readiness question, not part of the hypothesis.
tags: [method, source-review, readiness]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我是候选 `dow-swing@9` 的独立源码审查者，按本仓库的研究流程审。预检 trial 377 通过，窗口 `2024-01-08` 到 `2024-01-15`，合约 BTCUSDT。api、causal、activity 我已经查完，都通过。还剩 readiness。

源码声明 `WARMUP = {"1-DAY": 60}`，在 `on_historical_bars` 里把这 60 根日线依次送进下面的更新，之后每根新日线也送进去：

```python
def update_trend(self, bar):
    hh, ll = self.hh20.value, self.ll20.value       # 前 20 根的最高价、最低价（固定窗口）
    self.hh20.handle_bar(bar)
    self.ll20.handle_bar(bar)
    self.sma50.handle_bar(bar)                       # SimpleMovingAverage(50)
    if not self.hh20.initialized:
        return
    if bar.close > hh and self.state != "up":
        self.state = "up"                            # 向上突破才翻多，之后一直保持
    elif bar.close < ll and self.state != "down":
        self.state = "down"
```

`self.state` 初值是 `"none"`。`on_bar` 在 `self.sma50.initialized` 之后按 `self.state` 和 SMA 下单，所以从窗口第一天起决策。源码里没有递归均值。作者没有给出不同预热起点的比较。

同事的意见：用到的指标都是固定窗口，20 根最高最低价和 SMA 50 在 60 根预热里都满了，又没有 EMA 或 Wilder 这种递归指标，readiness 可以过；窗口起点不同时状态不一样，那是道氏假设本身对起点敏感，不是 readiness 缺陷。

readiness 该判什么、依据是什么？如果不判通过，下一步怎么做？请给出结论和理由。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
