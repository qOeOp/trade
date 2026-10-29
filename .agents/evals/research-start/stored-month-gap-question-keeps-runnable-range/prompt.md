---
description: Rule check — with the skill, a data/scope question about a MARK gap inside a stored month lists the range that can run now first, keeps the options already offered, says the missing minutes come in only through a fix to the import and the user's authority to replace the stored month, and is not reduced to approving a product change.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这是一道研究入口的离线情景题，不连接真实宿主工具或数据库。我选了路线 L-14：起点 ema-root@5，只有 ETHUSDT 永续，开发窗口 2021-01-01 至 2026-10-01，市场提交 a71c2e9。策略只读日线收盘价，回放带 200 天日线预热，交易从窗口起点开始。ema-root@5 已发布并通过独立源码审查，根的登记 research-plan-e20 已入账（一个网格点，还没回放）。

首次回放前的就绪检查：

- `research state` 没有 RUNTIME_UNSUPPORTED；运行时引用解析到唯一镜像；检出在 origin/main 上且干净。
- a71c2e9 里 2020-06 至 2026-09 每个月都在且都导入到月末，ETHUSDT 的覆盖回执可读，资金费和 LAST 都没有缺失。
- `market coverage`：ETHUSDT 的 MARK 缺 2021-07-01 整天（1,440 分钟），其余没有缺口。官方日档里有这一天的 MARK；导入时跳过了月边界上的这段，这是导入的缺陷。
- 我试着重导：`market import --month 2021-07` 被 `MONTH_EXISTS` 拒绝（The market database already holds that month through its end ...），`next_actions` 是 “Import the next month or the month before the earliest; a stored month is never rewritten.”，什么都没写。

上一轮你给过我两个方案：方案 1，交易从 2021-07-02 开始、窗口终点不变，这样缺口落在预热期；方案 2，保持现在的选择，先把缺的那天补进来。

同事帮我拟了这一轮的结尾问题：“是否授权我开一个 PR，新增一个补数入口，然后重导 2021-07？”他说就问这一句就够了。

请按规则处理这次就绪检查，写出你这一轮给我的回答，最后问我该问的问题。
