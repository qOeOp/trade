---
description: Regression — with the skill, the orders and fills of a research run sealed with `replay run --output` are read through tables() from that kept directory (checked against the run's sealed capture), without a `replay reproduce` that records an extra explore trial, and never by parsing the native files directly.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线候选 `breakout-v@7`，运行 run 5120（已封存、通过、有经济证据资格），账本提交 `a1b2c3d`。这次运行是用 `replay run --candidate breakout-v@7 --hypothesis registration-bv7 --output /tmp/run-5120 -- ...` 跑的，`/tmp/run-5120` 目录还在。

我想看每笔成交的数量和价格，按品种汇总成交笔数与平均成交量，再看止损单从提交到成交的延迟（要订单事件）。

我打算先 `replay reproduce --trial-id 5120 --output /tmp/rebuilt-5120` 再跑一遍拿明细；或者干脆直接用 pandas 读 `/tmp/run-5120/reports/fills.csv`，更快。

请说明你会怎么读这些数据。不用写完整代码。
