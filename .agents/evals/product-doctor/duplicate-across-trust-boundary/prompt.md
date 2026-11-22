---
description: Diagnostic check — with the skill, two similar checks are merged only when they guard the same risk for the same consumer; the same validation on each side of a trust boundary (the Agent's own pre-check and the product's recorded refusal) is two checks, while two helpers doing the same read for the same consumer are a duplicate measured by their shared span.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

同事做瘦身，交来两处“重复代码”，要删掉其中一份：

A. `registration/precheck.py` 里 Agent 跑预检时检查策略源码有没有未来函数（约 30 行），`replay/admit.py` 里回放在封存前用同一套规则再检查一遍并写入拒绝码（约 30 行，逻辑几乎一样）。预检是 Agent 自己调用、可跳过的；封存前那次是产品强制的，结果写进账本。
B. `market/read.py` 和 `market/export.py` 各有一个读月度 Parquet 并校验列的函数，都只被导出路径调用，两份 40 行里有 36 行完全相同。

你怎么判断这两处各该不该合并？写出你的判断依据，以及下结论之前要量什么。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
