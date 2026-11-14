---
description: Rule check — mid-line, zero-volume minutes found before a registration are reported as the exchange's record with the replay's treatment, the line continues without a question to the user and the contract is not dropped.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `bb-pool-1h`：12 个 USDT 永续，开发窗口 2024-01-01 至 2025-12-31，市场日 `2026-10-31` 已钉住，Goal 已激活。下一步本来是登记 `bb-root@7`（已预检、已评审）。

登记前我看了 `market coverage`，12 个合约在窗口内：没有 LAST 缺口，没有 MARK 缺口，没有缺资金费。只有 ARBUSDT 有 1,240 个成交量为 0 的分钟，集中在 2024-02 和 2024-08；`interpretation` 说这些分钟的 K 线都在，按存下的价格和零成交量参与回放。

这一轮我不在，你自己往下推。这件事怎么处理，下一步做什么，写出具体动作。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
