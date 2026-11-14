---
description: Rule check — with the skill, a whole-product review skips a shape the index keeps on purpose while its reason holds, reports a new cycle, and remedies a recurring mechanical class with a CI check raised as an authority item.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

product-doctor 整体审计里，负责 Product contracts and delivery 的子代理交回三条结构观察。以下为题设，不需要寻找真实产品记录。

1. `live` 包里 `runs`、`requests`、`credentials` 等模块互相导入成循环。`docs/plans/doctor/index.zh.md` 的有意保留表已经列了它，理由是这些模块共管同一次真实账户运行的状态；本次检出里这些模块的职责没变。
2. `ledger` 包里 `lines` 和 `judgments` 两个模块新出现了互相导入，有意保留表里没有它。
3. web 前端里没人引用的导出：前两次整体审计各报过一批，删掉以后这次又出现 9 个新的。

按 doctor 的规则说明三条各自怎么处理：是否作为发现报告；要报告的给出补救动作（`fix`、`remove`、`skill`、`authority`、`measure`、`none` 之一或组合）和理由。写出你依据的规则出处，找不到就直说。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
