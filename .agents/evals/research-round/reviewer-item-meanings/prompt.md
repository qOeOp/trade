---
description: Rule check — a source reviewer judges readiness from indicator convergence (a recursive average's native `initialized` is not convergence; not research-start's input-coverage check) and activity from whether this precheck filled orders on the order path the change alters, keeping the source-property items apart from the per-run one.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我是候选 `rsi-pullback@5` 的独立源码审查者，按本仓库的研究流程审。它由 `rsi-pullback@4` 派生，唯一的改动是入场条件里的 RSI 阈值从 0.25 改成 0.2，止损和出场逻辑逐字相同。预检 trial 433 通过，封存执行包 `trial-433-execution`，窗口 `2024-03-01` 到 `2024-03-08`，合约 ETHUSDT，`replay report --trial-id 433 --directory /tmp/pre433` 已核对报告缓存。api 和 causal 我已经查完，都通过。还剩 activity 和 readiness 两项。

材料：

源码的决策部分（15m K 线）：

```python
def on_bar(self, bar):
    self.rsi.handle_bar(bar)
    self.trend.handle_bar(bar)  # ExponentialMovingAverage(50)
    if not (self.rsi.initialized and self.trend.initialized):
        return
    if self.rsi.value < 0.2 and bar.close > self.trend.value:
        self.enter_long(bar)
```

源码声明 `WARMUP = {"15-MINUTE": 60}`，在 `on_historical_bars` 里把这 60 根 15m 历史 K 线喂给两个指标，开始时两个指标都已经 `initialized`。这次预检里第一次走到 `self.enter_long` 是在开始后第 260 根 K 线，那时 EMA 已经输入了 320 根。

报告缓存：这次预检 2 笔成交，都是多头开仓，窗口结束时都还持有，没有平仓成交。

`market coverage`：这一周 ETHUSDT 没有缺口，也没有零量分钟。

这两项我各该判什么、依据是什么？请给出结论和理由。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
