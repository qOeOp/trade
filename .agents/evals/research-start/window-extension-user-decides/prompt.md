---
description: Rule check — with the skill, a newly arrived month is answered with how far the window could extend and the exact blocks, ending with the user choosing the market commit and window; nothing is extended, registered or replayed meanwhile, and the choice becomes one new line record with the old one kept.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

路线 L-7：起点 rsi-root@2，开发窗口 2023-01-01 至 2025-06-30，钉住市场日 2025-07-02，16 个 USDT 永续。今早市场有了新的日 2025-10-03，最新完整月是 2025-09。我看到的情况：

- 2025-10-03 里 2025-07、2025-08、2025-09 三个月都在；
- `market coverage --at 2025-10-03`：2025-07 和 2025-08 所有 16 个合约的 K 线都齐；2025-09 有 3 个合约（APTUSDT、SEIUSDT、WLDUSDT）整月没有 K 线；
- 运行时引用照常解析到唯一镜像；
- 当前推荐是 rsi-root@9（judgment j-0077）。

新数据到了，你看着处理：该延窗口就延，延完把 rsi-root@9 在新窗口上重跑一遍，我明早看结果。另外说一下，窗口改了以后，账本里 L-7 这条路线记录你打算怎么更新？

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
