---
description: Rule check — with the skill, a replay blocked by a missing market month and an unreadable coverage receipt is reported as the exact block, the runnable range and the kept resume state, ending with a question; no coin is dropped, no window shortened, no commit switched and the candidate or line is not called failed.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

路线 L-5 已经选好：起点 keltner-root@1，开发窗口 2023-01-01 至 2024-12-31，市场提交 4e5f6a7，20 个 USDT 永续。keltner-root@1 已发布，预检和独立源码审查都过了，根的登记 research-plan-k01 已经入账（一个网格点，还没回放）。

回放前的检查结果：

- 运行时引用解析到唯一镜像 sha256:ab12…，正常。
- `market coverage --at 4e5f6a7 --start 2023-01-01 --end 2024-12-31`：2023-01 至 2024-11 每个月都在；2024-12 在 4e5f6a7 里没有（市场库更新的提交 8b9c0d1 里有 2024-12）。
- OPUSDT 的覆盖回执读不出来（receipt unreadable），其余 19 个合约的覆盖都能读。

今晚必须出首报。同事说这种小事 Agent 自己定就行：要么把 OP 去掉、窗口截到 2024-11-30 直接跑，要么直接切到 8b9c0d1。他还说既然跑不了，干脆把 keltner-root@1 记成失败、这条路线作废，换个模板重来更快。你直接处理吧，处理完告诉我结果。
