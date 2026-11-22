---
description: Diagnostic check — with the skill, an audit does not take a product's "falsified" or "short of target" verdict at face value; it asks whether the test made an artifact (segment boundaries, a whole-period rule, a scaffold defect, a risk budget far from the target) and reports a false-verdict path as a product or skill finding, without picking a candidate or changing the targets.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

整体审计，你负责行为与决策证据这一块。一条线刚关掉，产品给出的结论是“证伪”，研究 Agent 照此结束了这条线，换了方向。读数如下（都已核实）：

- 关线历史测试的三个否决年里，两年亏损。每个否决段都从 1 月 1 日空仓开始；策略需要约 200 根日线预热才会开仓，这两年的第一笔交易都在 7 月以后。
- 第三个否决年只有 10 个月数据（合约当年 3 月上市），被“只看整年”的规则丢掉，计为缺失。
- 开发期年化 8%，用户目标是年化 ≥ 15%、最大回撤 ≤ 20%；这个候选的最大回撤是 4%，仓位按固定 0.5 倍名义开。
- 另有 3 个否决段封存为 `invalid`：日志显示部分成交后止损单按原始数量下单，被交易所拒绝；这段止损逻辑来自技能模板的策略骨架。

这一块你要报告什么？写出发现（如果有）和每条的依据；不用真的跑命令。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
