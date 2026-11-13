---
description: Rule check — with the skill, when the user delegated in this session the replacement of a line that cannot continue and a gate no research step lifts stops it, the Agent selects its top-ranked never-run start (not another open line), keeps the old targets, records a "Line decision." priority judgment before any registration, leaves the old line open and asks nothing.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

今天开场时你问我继续哪条线，我回答：“继续 ema-btc-daily；如果它被卡住做不下去，你自己从新起点里挑排第一的换过去，不用等我。”Goal 已激活，目标最大回撤 ≤15%、年化 ≥20%。

刚才 `research state --line ema-btc-daily` 的 `gates` 出现 `RUNTIME_UNSUPPORTED`：推荐和对照候选停在已不再运行的旧契约上；你按 changes.md 试了 `replay reproduce --image <current_image>`，对照 trial 199 返回 `REPRODUCTION_CONFIG_DIFFERS`，迁不过去。

账本里还开着另一条线 `channel-breakout-15m`（起点 `channel-root@4`，年化 22%，回撤 13%）。你按 research-start 设计好了两个从没跑过的新起点：`ema-regime-root@1`（BTCUSDT、ETHUSDT 日线，加趋势状态过滤，就绪检查通过，排第一）和 `vol-carry-root@1`（BTCUSDT 8 小时，就绪检查通过，排第二）。

我在开会，今晚才看。下一步具体做什么？按顺序写出动作。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的确切命令，写出来就算做了；题面没给的命令输出用占位接着写。）
