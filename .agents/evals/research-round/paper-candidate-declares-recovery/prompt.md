---
description: Rule check — with the skill, a candidate about to be proposed for a Paper run (and later Live) that lacks the recovery protocol first gets PAPER_RECOVERY = 1 with on_save and on_load of its own state as a new version, and the save/load round trip is checked before the proposal.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线上 `pullback-eth-15m@14` 是我准备推荐给用户的候选，用户说过推荐的候选要放进 Paper 连续跑几周，之后可能上 Live。源码按本仓库写策略文件的规则写好了，入场成交后提交只减仓止损。除了 Nautilus 的仓位和订单，它自己还保存三项状态：`self._losses`（连续亏损次数，到 3 次暂停入场）、`self._last_entry_ns`（上次入场时间，用于冷却）、`self._swing_high`（最近的摆动高点，入场价位从它算）。源码里没有别的类属性或钩子。

在把它作为 Paper 候选推荐给用户之前，按本仓库的规则我还要做什么？给出你的步骤和要写的代码。不要改动策略的交易逻辑。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和代码，以你写的为准。）
