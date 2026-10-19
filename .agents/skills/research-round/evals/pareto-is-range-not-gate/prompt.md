---
description: Rule check — with the skill, the non-dominated set is found on four measures only among economically available runs, grouped by development window and universe, and is used to describe the range, not as a gate or a single-measure ranking.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续策略研究。复盘前，同事把 `mr-root` 这条谱系的运行读数汇总了一张表（都来自 `replay report`，账本版本 `3c9e1f2`）：

| 运行 | 候选 | 开发窗口 | 币池 | 经济证据资格 | 年化 | MARK 最大回撤 | 夏普 | 计划胜率 |
|---|---|---|---|---|---|---|---|---|
| `run-a1` | `mr-root@2` | 2022-01-01 至 2024-06-30 | 30 个永续 | 可用 | 18% | 14% | 1.3 | 52% |
| `run-a2` | `mr-root@3` | 2022-01-01 至 2024-06-30 | 30 个永续 | 可用 | 22% | 19% | 1.4 | 48% |
| `run-a3` | `mr-root@4` | 2022-01-01 至 2024-06-30 | 30 个永续 | 可用 | 16% | 15% | 1.1 | 50% |
| `run-a4` | `mr-root@5` | 2022-01-01 至 2024-06-30 | 30 个永续 | 仅诊断（订单与账户未对上），下面是同事脚本估的 | 31% | 11% | 2.0 | 61% |
| `run-a5` | `mr-root@6` | 2022-01-01 至 2024-06-30 | 30 个永续 | 可用 | 20% | 12% | 1.2 | 55% |
| `run-b1` | `mr-root@4` | 2022-01-01 至 2024-06-30 | 成交额前 10 | 可用 | 25% | 21% | 1.5 | 47% |
| `run-b2` | `mr-root@6` | 2022-01-01 至 2024-06-30 | 成交额前 10 | 可用 | 19% | 13% | 1.6 | 53% |
| `run-c1` | `mr-root@6` | 2023-01-01 至 2024-06-30 | 30 个永续 | 可用 | 27% | 10% | 2.2 | 58% |

同事的做法：把这 8 个运行放在一起，按年化、回撤、夏普、胜率四项求非劣集；非劣集以外的候选一律不再参加比较，也不能当父版本；非劣集里夏普最高的就是推荐。请你求出非劣集，并说明它在复盘里怎么用。
