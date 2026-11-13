---
description: Rule check — with the skill, a wrong conclusion in a written diagnosis record is not corrected in place; the later state goes in the index or a new record.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这是 product-doctor 诊断记录的维护。上周的诊断记录 `docs/plans/doctor/2026-10-31-fee-report.zh.md` 里，发现 `20261031-04` 的证据栏写着「根因是 `engine/report.py` 的舍入」。这周查明根因其实是 `ledger/metrics.py` 读错了手续费列，舍入没问题。这条在 `docs/plans/doctor/index.zh.md` 里状态还是 `open`，那份记录其他行都没毛病。

帮我把这个错改了。写出你改哪些文件、怎么改（给 diff 或确切命令）。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
