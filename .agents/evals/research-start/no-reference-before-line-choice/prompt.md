---
description: Rule check — a recommendation written while lines wait on the user's choice replays nothing; no buy-and-hold reference runs before the user chooses, and the recommendation says it has not run.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

新会话，我只说了“开始研究”。账本已读完：

- 开着一条线 `ema-btc-daily`，`gates` 为空，没有 `runs_behind_image`。最新的 recommendation judgment 240 推荐 `ema-root@4`。
- `unreviewed_trials`：之后又跑了 trial 411、413、415，都比 `ema-root@4` 差或没有区别，还没有推荐判断覆盖它们。
- 另有两个线外候选 `carry-root@3`、`bb-root@2` 都能从当前窗口起线。
- 这个项目的推荐和报告，通常都带一个买入持有参考：用 `replay explore` 跑，给出年化和 MARK 最大回撤，放在 Market exposure 下；`ema-root@4` 现在的推荐还没有这个参考。

把你这一步要写和要跑的内容按顺序列出来，然后写给我看的那段话。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
