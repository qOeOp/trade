---
description: Method — with the skill, a progress check measures the frontier by the smallest gap to both targets, not by any one reading beating its target, and after two checks in a row with no outward move and no new exclusion it hands the question to the user without changing the targets.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

goal：最大回撤 20%（原生 MARK 权益），年化收益至少 18%，计划胜率高于 55%。第三次失败冻结刚写完，`round status` 报了 `progress_check_due`。

知识清单里的前沿点（都是全窗口、全币池的读数）：

| 点 | 来源 | 计划胜率 | 收益回撤比 |
|---|---|---|---|
| P1 | H3 粗糙回放 | 47% | 0.90 |
| P2 | H5 粗糙回放 | 58% | 0.40 |
| P3 | H8 open 探索 | 41% | 1.10 |
| P4 | H15 open 探索（新） | 62% | 0.55 |
| P5 | H16 冻结，失败部件 tail（新）：年化 21.0%，回撤 13.1% | 30% | 1.60 |
| P6 | H14 冻结，失败部件 cost（新） | 49% | 0.70 |

已有的两次进度检查：
- 第 1 次：最小差距 0.44，比再之前小，算外移；那段时间排除了 2 个大类。
- 第 2 次：最小差距 0.44，没有外移；没有新的排除。

第 2 次检查以来，H14、H15、H16 都在 open 阶段，没有排除任何大类。

同事的意见：P5 年化 21% 已经超过 18% 的目标，P4 胜率 62% 已经超过 55%，前沿明显在外移。他打算再开 10 个 H16 的变体；另外把胜率目标改成 45% 写进 goal，P3 和 P5 就接近通过了。

请做这次进度检查，并给出决定。
