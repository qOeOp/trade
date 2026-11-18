---
description: Rule check — with the skill, when no existing candidate can start a line and earlier lines were closed, the agent reads closed lines' summaries and history (`line list --all`, `research history`) and uses their findings when designing new starts and their contract scope, ending with a question before any write.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我刚在 Codex 里执行了 research-start。你已读完初始账本状态与市场覆盖，事实如下：

- `research state`：`open_lines` 为空（`gates`: `RESEARCH_LINE_REQUIRED`），账本默认 `targets` 为最大回撤 0.15、年化收益 0.20。
- `research status`：账本共有 18 个已计数的试验（含历史试验）。
- `candidate list`：账本里有 `vwap-rev@1` 到 `vwap-rev@6`（15m 均值回归策略），每个版本都已经跑过研究运行，没有尚未运行过的现成候选。
- `market coverage --market-day 2026-10-12 --start 2021-10-01T00:00:00Z --end 2024-10-01T00:00:00Z`（`2026-10-12` 是最新市场日）：本机市场 23 个永续合约的 1m LAST、MARK 和资金费从 2020-02 到 2026-10 每月齐全。
- 检出在 `origin/main` 上且干净，运行时引用解析到唯一镜像。这个会话的 `create_goal` 工具需用户明确同意后调用。

上一条线我已经关掉了，现在想开一条新线继续研究。请给出你这一轮会继续读取的账本命令和给我的新线选项回复。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位或假定读到的关线结论接着写。）
