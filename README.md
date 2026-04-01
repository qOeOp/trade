# BTC Trade Workspace

这是一个在 Codex 里直接使用的 BTC 交易工作仓库。

它现在不是产品，不是应用，也不是自动化系统。
它的第一步目标只有一个：

`先把我们想要的交易工作方式写清楚，再决定要不要继续长出更多结构。`

## Product Vision

我们希望在这个仓库里，逐步形成一套稳定的 BTC 日常交易协作方式：

- 平时直接在 Codex 对话里看 BTC
- 回答方式固定，先看市场，再讲计划，再讲风险
- 只在我们明确要求时才记录
- 所有规则优先沉淀成简单、清楚、可维护的 memory

这个仓库当前最重要的不是“功能齐不齐”，而是三件事：

1. README 把 vision 讲清楚
2. AGENTS 把日常 workflow 讲清楚
3. skills 只保留最小、明确、单一职责的边界

## Current Direction

当前采用极简模式：

- 先不为未来能力预建复杂结构
- 先不把未确定的 schema、模块、链路当成既定事实
- 先把 `README.md` 迭代到足够清楚
- 再基于 README 收敛最小 skill 设计
- 最后再决定是否需要 records、templates 或更细的模块化

## Skill Direction

skill 设计还没有定稿。

当前只确定两条原则：

- skill 必须最小、单一职责、彼此独立
- 在 README 和 workflow 没定稳之前，不预先铺开 skill 结构

也就是说：

- 现在先不把 skill 文件写成既定制度
- 先把我们到底需要几个 skill、各自做什么讨论清楚
- 再落成最小实现

## Daily Workflow

我们希望 Codex 以后按这个顺序协作：

1. 用户问当前 BTC
2. 先验证最新市场数据
3. 给出 market brief
4. 如果用户要计划，再给条件式计划
5. 全程带风险边界
6. 只有用户明确说“记录 / 落盘 / 保存 / 复盘”时，才考虑是否需要写仓库

## What We Are Not Doing Yet

这些事情现在都还没有决定，不应该先做重：

- 复杂 architecture
- 过早固定 module map
- 过早固定 records schema
- 为未来可能用到的能力预建目录
- 在 workflow 未定前先铺开 skills

## Editing Principle

接下来的迭代顺序以这个 README 为准：

1. 先反复把 vision 说清楚
2. 再把 AGENTS 收紧成最小 memory
3. 再决定 skill 需要多少个以及各自职责
4. 最后才决定记录模型和更细结构

## Current Status

可以把当前仓库理解为：

- vision 正在收敛
- workflow 正在收敛
- skill boundary 正在收敛
- records 和 architecture 暂时都不应继续膨胀
