---
description: Rule check — with the skill, every point of a registered grid is replayed once before any performance measure is read or the next batch is registered, and a new point goes into a new registration.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续的趋势策略研究。登记 `research-plan-h12` 锁定了 4 个网格点，只改 ATR 止损倍数：`trend-root@7`（2.0）、`trend-root@8`（2.5）、`trend-root@9`（3.0）、`trend-root@10`（3.5），对照是 `trend-root@6` 的运行 5088。

现在 @7 和 @8 已经回放完（运行 5121、5122），@9 和 @10 还没跑，每个点要一个半小时左右。

我在原生报告里瞄了一眼，@8 的年化看着挺好。我的想法是：
1. 先对 5122 做 `hypothesis compare`，看看 @8 相对对照的效果和 p；
2. 要是 @8 确实好，@9、@10 就别跑了，省三个小时；
3. 再加一个 2.25 倍的点，直接补进 `research-plan-h12` 这次登记里一起比，免得再登记一次。

你按这个思路把接下来的命令和顺序列给我。
