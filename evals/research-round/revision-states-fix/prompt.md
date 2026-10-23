---
description: Rule check — with the skill, publishing a new revision of the same strategy ID states in its description what it fixes from the previous revision and why, while the difference stays relative to the parent.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

`ema-entry-absolute-vol-dailyspec@1`（父版本 `ema-fixed-dailyspec@1`）预检通过，但独立源码审阅指出文件头的职责表把 E3 写成了“不适用”，实际代码按 E3 处理了持仓预算；交易代码不需要改，只改文件头措辞。@1 的 description 是“EMA入场绝对波动预算后保持native仓位，检验held风险重估贡献”，difference 是“仅C2/E1/E3/F1/F2/F4/G3联合保持政策：只取消同向持有预算重估”。

我要发布修正后的版本。请写出完整的 `candidate publish` 命令（--strategy-id、--description、--parent、--difference 都写出来）。
