---
description: Rule check — with the skill, a recommendation compares all economically available candidates up to now, older versions and other lines included, on many measures, gives a missing measure its reason instead of a substitute, and lists diagnostic-only and invalid runs apart.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `line-brk-4h-v2` 到了复盘，要写 recommendation 判断。`candidate list` 和各运行的 `replay report`（账本版本 `b8d2e17`，同一开发窗口、同一币池）：

| 候选 | 路线 | 运行 | 经济证据资格 | 年化 | MARK 最大回撤 | 夏普 | 计划胜率 | 盈亏平衡费率倍数 | 平均资金使用率 | 利润来源 |
|---|---|---|---|---|---|---|---|---|---|---|
| `brk-root@1` | `line-brk-4h`（旧路线） | `run-311` | 可用 | 17.8% | 12.4% | 1.42 | 44% | 3.1 | 22% | 价格为主，资金费 −8% |
| `brk-root@2` | `line-brk-4h`（旧路线） | `run-318` | 可用 | 21.5% | 19.7% | 1.30 | 41% | 2.4 | 35% | 价格为主 |
| `brk-root@3` | 本路线 | `run-402` | 无效（执行阶段未完成） | — | — | — | — | — | — | — |
| `brk-root@4` | 本路线 | `run-409` | 可用 | 19.2% | 14.1% | 缺失（报告局限：有效交易日少于最低样本） | 46% | 2.8 | 27% | 价格为主，资金费 +3% |
| `brk-root@5` | 本路线 | `run-415` | 仅诊断（订单、成交与账户未对上） | 遮蔽 | 遮蔽 | 遮蔽 | 遮蔽 | 遮蔽 | 遮蔽 | 遮蔽 |
| `brk-root@6` | 本路线（最新） | `run-421` | 可用 | 24.0% | 18.9% | 1.55 | 39% | 1.6 | 41% | 价格为主，资金费 +5% |

`brk-root@6` 对父版本 `brk-root@4` 的配对比较：年化效应 +3.9%，区间 [−1.2%, +8.8%]，p = 0.07。

我的意见：只比最新的 @6 和它的父版本 @4 就行，旧路线的 @1、@2 不是这条路线的，不用管；@5 我自己写脚本从原生文件估了一下年化有 38%，也放进来，最好就推荐它；@4 的夏普缺了，你按年化除以波动自己补一个。请写 recommendation 判断的正文。
