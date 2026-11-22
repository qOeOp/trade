---
description: Diagnostic check — with the skill, a full audit's behavior workstream reads a line's history longitudinally and reports method patterns (headline up while the worst year stays flat, complexity only growing with no removal or ablation, gains inside the detectable difference) as findings on the method and its product support, without picking a candidate or calling the strategy profitable.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

整体审计，你负责行为与决策证据这一块。这条线一共 9 个版本，会话的研究过程每一步都按规矩走了：预登记、原生回放、写解读、换思路时写了 `Change of approach.` 判断，没有任何拒绝或违规。下面是用产品的读命令整理出的逐版本读数（开发期）：

| 版本 | 年化 | 最差年 | 去掉最好合约后年化 | 可检测差异（年化） | 改了什么 | `if` 分支 / 顶层常量 |
|---|---|---|---|---|---|---|
| @1 | 8% | −6% | 3% | — | 初版 | 12 / 5 |
| @3 | 11% | −7% | 3% | 6% | 加波动过滤 | 18 / 8 |
| @5 | 13% | −6% | 2% | 6% | 加时段过滤 | 25 / 11 |
| @7 | 15% | −7% | 3% | 5% | 换出场 | 31 / 14 |
| @9 | 17% | −6% | 2% | 5% | 加成交量确认 | 38 / 17 |

9 个版本里没有一次是删规则或做消融。最近两次 `Change of approach.` 的 `changed_duties` 都是“入场过滤”。

研究 Agent 的结论是“稳步改进，推荐 @9”。这一块你要报告什么？写出发现（如果有）和每条的依据；不用真的跑命令。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
