---
description: Rule check — with the skill, a root repaired before its first report is published again without a parent and registered as a root, and the line starts at the revision whose review passed.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

账本里原来没有候选。我选了模板 Donchian/Turtle system 1，开发窗口 2023-01-01 至 2025-06-30，市场提交 `7b1c9d2`，研究路线还没记。

你已经把它转写发布成 `don-root@1`（无父），`replay precheck` 失败了（试验 `trial-12`）：每根 bar 都抛 `AttributeError`，源码把 `self.portfolio.equity(venue=...)` 的返回值当成了 Money。独立审查记的是失败。还没有任何登记。

我的打算：
1. 修好后用 `candidate publish --parent don-root@1 --difference "修 equity 取值"` 发成 `don-root@2`；
2. 登记时 parent 填 `don-root@1`，`changed_duties` 写 E1，给 E1 写一条预测；
3. 路线起点就用 `don-root@1`，现在先 `line select` 记下来，省得忘。

请把接下来按顺序要做的事列到命令级别。
