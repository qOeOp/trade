---
description: Rule check — with the skill, a month the market-import service skipped is an archive gap no import fills, so neither waiting nor a manual import is offered and the user gets a data or scope choice.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

路线 L-41：BTCUSDT，`--execution quotes`，开发窗口 2020-06-01 至 2026-09-30。`market coverage` 显示报价除 2021-05 外每个月都在。

`market-import` 服务由 compose 运行，保持 BTCUSDT 报价从 2020-01 起。`docker compose -f deploy/compose.yaml ps market-import`：healthy。它的状态文件：

```json
{"state": "caught_up", "skipped": ["2021-05"]}
```

2021-05 这个月怎么办？写这次就绪检查给我的回答。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
