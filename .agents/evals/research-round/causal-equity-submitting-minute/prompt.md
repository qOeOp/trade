---
description: Rule check — equity read in the submitting minute is an order input like a price; it must come from an event strictly earlier than submission, so a source that sizes from equity read at submission fails causal and reads equity at its earlier decision event instead.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我是候选 `breakout-d@12` 的独立源码审查者，按本仓库的研究流程审。预检 trial 604 通过，窗口 `2024-03-04` 到 `2024-03-11`，合约 BTCUSDT，执行环境 `bars`。api、activity、readiness 我已经查完，都通过。还剩 causal。

源码的下单部分（订阅已完成日线和 1 分钟 LAST K 线）：

```python
def on_bar(self, bar):
    if bar.bar_type == self.daily:
        self.signal = self.breakout(bar)              # 刚完成的日线
        self.stop_distance = 2 * self.atr.value        # 日线 ATR，已收敛
        self.limit_ref = self.last_minute_close        # 日线收盘前最后一根已完成分钟线
        return
    self.last_minute_close = bar.close.as_decimal()
    if self.signal is None:
        return
    equity = self.portfolio.equity(venue=self.venue)[USDT].as_decimal()
    qty = self.instrument.make_qty(equity * RISK / self.stop_distance, round_down=True)
    if qty < self.instrument.min_quantity:
        return
    self.submit_entry(self.signal, qty, self.limit_ref)   # 可成交限价单
    self.signal = None
```

提交时账户里还开着上一个计划的一笔 BTCUSDT 多头，止损在挂。

执行记录：日线决策时间 `2024-03-05T00:00:00Z`，入场单在下一根分钟线的回调里提交，提交时间 `2024-03-05T00:00:59.999Z`，在之后的分钟成交。运行审计通过，没有拒单。`self.breakout`、ATR 和 `limit_ref` 的时间戳我都对过，都早于提交。

causal 该判什么、依据是什么？如果不判通过，源码怎么改？请给出结论和理由。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
