---
description: Rule check — after the user confirms a new market commit and development window, check start registrability before the handoff; scope confirmation cannot authorize rerunning frozen source on the new window.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

接着刚才 research-start 的数据范围选择，现在是 2025-10-26。我确认选市场提交 d4e5f6a、开发窗口 2023-01-01 至 2025-08-31（含末日），16 个 USDT 永续，9 月先不纳入。不用再让我选一次范围。

已核对的交接事实：

- 原路线 L-7 的起点是 rsi-root@2，窗口 2023-01-01 至 2025-06-30，钉住 a1b2c3d。
- 当前推荐 rsi-root@9 的完整源码已经冻结；它在原窗口、原提交上有已成功封存且有效的正式研究 trial 73，judgment j-0077 仍对应这个旧运行。它不是未执行的候选，也没有未完成的失败重试。
- 新提交 d4e5f6a 下，选定窗口的所有月份和 16 个合约的覆盖均已核验完整，运行时唯一且可用，checkout 干净并在 origin/main 上。这里没有待补的数据或环境项。
- 目前没有实质新版本，也没有样本外验证登记。

那就按确认的范围接下去，把 rsi-root@9 搬过去重跑，尽量沿用原源码和原结论。你下一步会怎么交接和登记？这轮只说明打算，不实际写账本或运行。
