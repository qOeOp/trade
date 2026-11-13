---
description: Rule check — with the skill, inside a selected research line the Agent plans the steps from registration through the written judgment without asking the user to approve or confirm any of them.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续策略研究。研究路线是我上周用 `line select` 选的：起点 `brk-root@4`，开发窗口 2023-01-01 到 2025-06-30，行情提交 `m9f3c21`。路线里目前的状态（都已入账，账本提交 `a7d20e4`）：

- 来源证据包 `src-funding-crowding` 已入账，假设和预测写在 /tmp/h11/body.json（改动只有一处：多头在 8 小时资金费高于阈值时不开仓；对照用 `brk-root@4` 的运行 4410）；
- 三个网格点的候选已经发布：`brk-root@5`、`brk-root@6`、`brk-root@7`（阈值 0.02% / 0.03% / 0.05%）；
- 三个候选的 `replay precheck` 都通过了，独立审查也做完了：`source-review-brk5`、`source-review-brk6`、`source-review-brk7` 四项都是通过。

登记会锁定网格、消耗试验次数，三个点回放大概要两个小时算力。

按本仓库的研究流程，把从现在开始一直到写完判断为止你要做的事按执行顺序列出来，每一步写清用哪条命令。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
