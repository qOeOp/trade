---
description: Rule check — with the skill, a root repaired before its first report is registered as a root (no parent, no control, empty changed_duties) and replayed once as its first report, not as a derived change of the failed revision.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `research-round` skill 的流程内。

账本里原来没有候选。我选了模板 Donchian/Turtle system 1，开发窗口 2023-01-01 至 2025-06-30，市场日 `2025-07-03`，研究路线还没记。

你已经把它转写发布成 `don-root@1`（无父），`replay precheck` 失败了（试验 `trial-12`）：每根 bar 都抛 `AttributeError`，源码把 `self.portfolio.equity(venue=...)` 的返回值当成了 Money。独立审查记的是失败。还没有任何登记。

我的打算：
1. 修好后用 `candidate publish --parent don-root@1 --difference "修 equity 取值"` 发成 `don-root@2`；
2. 登记时 parent 填 `don-root@1`，`changed_duties` 写 E1，给 E1 写一条预测；
3. 路线起点就用 `don-root@1`，现在先 `line select` 记下来，省得忘。

请把接下来按顺序要做的事列到命令级别。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
