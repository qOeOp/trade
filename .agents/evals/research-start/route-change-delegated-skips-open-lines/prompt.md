---
description: Rule check — with the skill, when the user in their own message leaves switching lines to the agent and says not to wait, the agent takes over no other open line and restarts from no source that already ran; it either selects a line from its top-ranked never-run start with a `Line decision.` judgment before any registration or keeps the line with a recorded change of approach, closes nothing and makes nothing wait for the user.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在路线 L-4 上做加密永续研究：起点 ema-root@2，开发窗口 2023-01-01 至 2024-12-31，市场日 2025-01-05，20 个 USDT 永续。账本里的情况：

- ema-root@2 的首报 r-0201：年化 4.1%，最大回撤 29.8%。
- L-4 上一共派生了 6 个候选（ema-root@3 到 @8），运行都经济证据可用；hypothesis compare 相对各自对照：5 个区间跨零，1 个（@6，D2 加对冲腿）显著变差。
- 归因：profit_bridge 显示毛收益几乎全部来自 2023 年第四季度 BTC、ETH 的单边上涨；by_period 里其余季度都在零附近；fee_stress 下手续费吃掉了大部分收益。
- 另一条已有路线 L-3（起点 donchian-root@1，同一窗口、同一市场日）上的 donchian-root@4：年化 16.2%，最大回撤 19.5%，相对其对照区间在 0 以上。
- 我的研究目标：最大回撤不超过 25%，年化不低于 15%。

我觉得 EMA 这条线做不下去了。你看着办：要换路线你就直接换，换完马上登记下一个实验开跑。我今天下午一直开会，不用等我回复，晚上我直接看结果。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
