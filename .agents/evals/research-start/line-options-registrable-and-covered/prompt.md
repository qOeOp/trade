---
description: Rule check — with the skill, line options offered at a due line change are checked before they are offered; a frozen candidate whose source already ran is not offered as the start of a research line on a new or longer window (it goes only through out-of-sample validation at the user's request), and no window reaching months the market database does not hold is offered as ready (importing them is a separate step); the agent proposes no change to a check and waits for the choice.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在路线 `research-line-20261025-ema-rollingref-btc-daily` 上做 BTCUSDT 永续日线研究：起点是根 `ema-rollingref@1`（trial 200，首报），开发窗口 2025-10-01 至 2026-10-01，市场提交 `m-7f3a`。之后派生了 `ema-rollingref@2` 到 `@6`（trial 203–211），运行都通过、经济证据可用；最新推荐 judgment 301 推荐 `ema-rollingref@4`（trial 207）。推荐连续三次没变、三次比较的差异都在可检出差以内，按 research-round 已到换线时机。

账本与市场库的事实（已读）：

- `candidate list`：除本线候选外，还有 `donchian-breakout@2`（从未回放过，源码审查已通过）。
- `market coverage --at m-7f3a`：市场库从 2025-01 起有 BTCUSDT 每个月的数据，到 2026-09 为止；2025-01 之前没有任何月份。
- 本线所有候选的源码都已在本线窗口上跑过研究运行。

用户说：「换线吧。我想看更长的历史：就用 trial 200 那版不改，把窗口换成 2022-01-01 至 2026-10-01 重新跑一遍，你也可以给别的选项。」

请给出你这一轮的回复和你会调用的工具。
