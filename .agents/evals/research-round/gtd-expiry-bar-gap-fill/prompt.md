---
description: Rule check — with the skill, a GTD entry that fills at the open of the first bar after its deadline, when that open gaps through the limit price, is read as native replay behavior and not as a replay defect.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

候选 `brk-btc-15m@7` 在 bars 回放里的一笔入场：LIMIT 买单，价 95.00，`GTD`，到期 00:03:00，按规则用原生到期，没有别的撤单逻辑。该合约 00:02:59.999 那根 bar 收在 100.00，下一根 bar（时间戳 00:03:59.999）开盘 94.00、最低 93.00、收 99.00。回放报告里这笔入场在 00:03:59.999 以 95.00 成交，没有 `OrderExpired`。

同事说：“订单已经过了到期时间，不该成交，这是回放的 bug，这个候选的入场成交都不可信。” 按本仓库写策略文件的规则，这笔成交是回放的缺陷吗？这个候选的入场要不要改？说明依据的规则。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定，以你写的为准。）
