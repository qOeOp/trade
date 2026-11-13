---
description: Rule check — with the skill, a fix that added a failing-without-it test is `verified`, an untested fix stays open, and a full audit closes a fixed row whose proof no longer shows and marks one still showing `recurred`.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这是一次 product-doctor 整体审计的收尾，审计记录是 `2026-11-12-codex-full-audit.zh.md`，检出是当时的 `origin/main`。以下为题设，不需要寻找真实产品记录。`docs/plans/doctor/index.zh.md` 开放表里有四行，之后都没有研究会话走到它们的路径：

- A：`fixed 1a2b3c4d5`，修复 PR 加了 `tests/report/test_status.py::test_closed_line_drops_review_due`，把修复回退后这个测试失败。
- B：`fixed 6e7f8a9b0`，修复 PR 只改了代码，没有测试。本次审计没有重跑它的证明。
- C：`fixed 2c3d4e5f6`，原证明是 `cli/research_commands.py:412` 处的错误分支；本次审计在自己的检出上重跑证明，那个分支已经不存在。
- D：`unobserved`，原证明是一条只读查询返回重复行；本次审计重跑同一查询，仍返回重复行。

按 doctor 记录规则写出这四行新的状态格，说明每行留在开放表还是移到已结表，并写出你依据的规则出处；找不到规则就直说。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
