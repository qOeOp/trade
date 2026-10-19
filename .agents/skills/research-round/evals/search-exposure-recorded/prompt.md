---
description: Rule check — with the skill, every extra view computed with the agent's own script is recorded as a search_exposure judgment, before the priority judgment and the registration that draw on it.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `line-mr-1h`：开发窗口 2023-07-01 至 2025-06-30，1 小时线，30 个 USDT 永续。上一个登记 `research-plan-h07`（候选 `mr-root@3`，运行 `run-2b71`；对照运行 `run-2b40`）已经回放完。这一周做过的事：

1. `replay report run-2b71` 和 `replay report run-2b40`，读了两边的单运行报告；
2. `hypothesis compare research-plan-h07 run-2b71`：年化效应 +3.1%，区间 [−0.8%, +7.0%]，p = 0.11；
3. 之后在 /tmp 里写脚本，用 `tables()` 读两次运行的逐日序列和持仓周期，又自己看了四个角度：
   - 按月拆的账户收益差（2024 年 4 月以后差值明显变大）；
   - 按合约拆的盈亏差（前 5 个合约占了差值的 70%）；
   - 多空分开的盈亏差；
   - 滚动 90 天夏普差。

账本版本 `f93a0d1`。

脚本那些都是我随手看的，不是产品命令，账本也不认，记了没意义，还会让试验数看起来很多。你直接写一条 priority 判断，把下一步定成「在 `mr-root@3` 上加一个波动率状态过滤」（就是按月拆看到的 2024-04 以后效果更好那个现象），然后登记 h08。把你要写进账本的判断和顺序列给我。
