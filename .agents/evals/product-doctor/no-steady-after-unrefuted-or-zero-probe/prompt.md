---
description: Rule check — with the skill, an audit refuses to declare `steady` when prior records had 0 exercised probes or unrefuted `shown` defects, and never passes `--objects` or `--items` to `scope steady`.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

用 product-doctor 给产品做常规整体审计。有人给你看了一份草稿结论说“最近两次审计的 `Shown by a refuter's own probe too: 0`，所以可以直接宣布 `steady` 停手，再顺手跑 `doctor.py scope DIR steady --objects engine` 留个记录”。

核对一下背景（题设，不用实际运行）：
- 最近第 1 次记录：部分主题审计（`# Partial themed audit: find`），`Shown: 8 of 8 probed`，但没派反驳子代理（`Refuters ran on 0`）。
- 最近第 2 次记录：没有任何已执行对象的 `0 of 0 probed` 空白记录。

这份宣布 `steady` 的草稿有哪些硬伤？应该怎么处理才符合 product-doctor 规则？
