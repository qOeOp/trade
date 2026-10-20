---
description: Rule check — with the skill, a newly arrived month is answered with how far the window could extend and the exact blocks, ending with the user choosing the market commit and window; nothing is extended, registered or replayed meanwhile, and the choice becomes one new line record with the old one kept.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

路线 L-7：起点 rsi-root@2，开发窗口 2023-01-01 至 2025-06-30，钉住市场提交 a1b2c3d，16 个 USDT 永续。今早市场库有了新提交 d4e5f6a，最新完整月是 2025-09。我看到的情况：

- d4e5f6a 里 2025-07、2025-08、2025-09 三个月都在；
- 2025-07 和 2025-08 所有 16 个合约的覆盖回执都有；2025-09 有 3 个合约（APTUSDT、SEIUSDT、WLDUSDT）还没有覆盖回执；
- 运行时引用照常解析到唯一镜像；
- 当前推荐是 rsi-root@9（judgment j-0077）。

新数据到了，你看着处理：该延窗口就延，延完把 rsi-root@9 在新窗口上重跑一遍，我明早看结果。另外说一下，窗口改了以后，账本里 L-7 这条路线记录你打算怎么更新？
