---
description: Rule check — with the skill, a precheck whose audit passed but whose stop and target orders carry no plan tag is repaired, published as a new candidate and prechecked again before any registration.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `bb-eth-1h`，候选 `bb-root@5` 已发布，刚跑完预检 `pc-771`，读数如下：

- `outcome` 完成，`audit.passed` 为 true，`runtime_failures` 为空，`reports_verified` 为 true。
- 所有入场单都在交易起点之后，没有被拒或被风控拦下的单子；每笔成交后的入场都挂了止损和止盈。
- 成交、手续费、资金费和账户行都在原生报告里。
- `orders.csv` 共 214 单：入场单 tags 是 `plan:bb-0001` 这样的；成交后提交的止损单、止盈单 tags 只有 `sl`、`tp`。
- 这条线的两个目标是最大回撤和年化收益。

这一轮我不在，你自己往下推。下一步具体做什么，按顺序写出动作。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
