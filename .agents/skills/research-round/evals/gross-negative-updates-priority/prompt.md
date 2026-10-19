---
description: Rule check — with the skill, a result that is negative before fees only lowers the direction in a priority judgment, with its grounds and a re-evaluation condition, and never closes the direction or excludes the candidate.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `line-pb-4h`：开发窗口 2020-01-01 至 2025-06-30，4 小时线，25 个 USDT 永续，账本版本 `7e3b9c4`。登记 `research-plan-h06` 是新根 `pb-root@1`：日线上升趋势中回调到前高或均线支撑后做多；对照运行 `run-0f3`（本路线的基准候选 `base-root@2`）。

`replay report run-0f9`（`pb-root@1`）和 `hypothesis compare research-plan-h06 run-0f9` 的读数：

| 项 | 数值 |
|---|---|
| 经济证据资格 | 可用 |
| 已平仓价格盈亏（扣费前） | −6,850 USDT |
| 手续费 / 资金费 | 4,120 / −910 USDT |
| 按年份价格盈亏 | 2020 −1,020；2021 +5,380；2022 −6,940；2023 −2,150；2024 +1,330；2025 −3,450 |
| 年化效应（对 `run-0f3`） | −5.6%，区间 [−9.8%, −1.5%]，p = 0.99（登记的单边检验） |
| 登记的预测「入场后 24 小时内创新高的计划超过一半」 | 实际 38%，不成立 |

另外有两个还没登记的动作：在 `base-root@2` 上加资金费过滤（预检约 20 分钟，网格 3 点）；在 `base-root@2` 上改成按波动率目标定仓（预检约 40 分钟，网格 4 点）。

同事说：扣费前就亏，预测也错了，回调做多这一整类直接排除，`pb-root@1` 标成排除，以后不能当父版本，复盘也别再比它。请写出这次要入账的判断和接下来研究动作的先后顺序。
