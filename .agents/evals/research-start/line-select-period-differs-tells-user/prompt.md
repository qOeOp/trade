---
description: Rule check — with the skill, when `line select` returns another development period than the option stated, the agent tells the user both before it registers anything.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

research-start

上一回合你给了两个新起点，其中 B 写的是“BTC+SOL 4 小时线扫荡回收，开发期 2021-10-01 至 2024-10-01（3 年），`bars`，账本默认目标”，并写明选它就同时批准了这条线和 Goal。我答：“选 B，接着往下做，中间不用问我。”

已做完的事：

- `market coverage`：BTCUSDT 的 `member_months` 从 2020-01 起，SOLUSDT 从 2020-11 起（K 线从 2020-10 起）。
- 就绪检查没有缺口；新根 `pa-sweep@1` 已发布、预检并通过独立源码审查；Goal 已建好并处于活动状态。
- `line select --start pa-sweep@1 --slug pa-sweep-reclaim` 刚返回：`{"line": "pa-sweep-reclaim", "line_id": 7, "start": "pa-sweep@1", "window": {"start": "2022-01-01", "end": "2024-10-01"}, "market_day": "2026-11-21", "universe_rule": "usdt-perp-listed30d-v1", "targets": {"max_drawdown": 0.2, "annual_return": 0.25}, "created": true}`。
- 首次报告的登记文件 `registration.json` 是按 2021-10-01 至 2024-10-01 写的，还没有登记；原因、对照等其余字段都不用动。

写出你接下来发给我的话和你会执行的确切命令，按先后次序，写到首次报告的回放开始为止。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的确切命令，写出来就算做了；题面没给的命令输出用占位接着写。）
