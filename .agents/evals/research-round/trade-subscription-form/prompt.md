---
description: Rule check — with the skill, a source reading trade ticks subscribes through subscribe_data with DataType TradeTick and reads data.data in on_data, knows trades move no fill and reports trades received.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `tflow-btc-5m`，`--execution quotes`。我想写一个新候选：每根 5 分钟 K 线收盘时，用这根 K 线内的成交算主动买卖不平衡，超过阈值就在下一分钟以可成交限价单开仓，限价取这根 5 分钟线的收盘价按方向上浮或下浮 0.1%。窗口内每个月市场都有 trades。

把 source 里取这份成交数据的部分写出来：运行参数、怎么订阅、回调里怎么取到一笔成交。再写一下这些成交对订单撮合有什么影响，以及诊断里要报什么。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
