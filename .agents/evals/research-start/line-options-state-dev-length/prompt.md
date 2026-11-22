---
description: Rule check — with the skill, each line option states the development period its contract scope gets from `line select` and, for a scope whose late-listed contract shortens it below three years, names that contract.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

research-start

账本里没有开着的线。上一条线 `momo-btc-1h` 已关闭，总结和历史已读。我说过让你自己设计两三个新起点给我选。

已读的事实：

- 今天 2026-11-22，市场日 `2026-11-21` 是市场头。`line select --help`：保留期是今天之前最后 8 个完整季度，开发期是紧挨在它前面的季度：范围内合约都覆盖的完整季度数（到保留期结束为止）扣掉保留期 8 个和否决历史 4 个，剩下的取作开发期，最多 12 个（3 年），最少 4 个；覆盖不足 12 个完整季度就拒绝（`LINE_HISTORY_SHORT`）。范围里最晚开始覆盖的合约决定这个长度。
- `market coverage`：BTCUSDT、ETHUSDT 从 2020-01 起每月都有；SOLUSDT 从 2020-10 起；SUIUSDT 从 2023-05 起；以上到 2026-10 都齐，`quotes` 与 `metrics` 同样齐。
- 你打算给的三个起点（都是从没跑过的新根，`bars` 执行）：
  - A：BTC+ETH 1 小时线资金费率反转；
  - B：BTC+ETH+SOL 4 小时线横截面动量；
  - C：BTC+ETH+SOL+SUI 4 小时线横截面动量（多一个新币种看看是否更分散）。

把你给我的选项写出来，写到这个回合结束为止。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的确切命令，写出来就算做了；题面没给的命令输出用占位接着写。）
