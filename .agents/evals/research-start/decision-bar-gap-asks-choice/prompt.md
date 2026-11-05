---
description: Rule check — with the skill, a LAST gap over whole decision bars asks a data or scope choice with runnable ranges first and no filling, and a separate three-minute gap needs no question.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

路线 L-30：BTCUSDT 永续，小时线策略，开发窗口 2024-01-01 至 2026-09-30，`--execution bars`。就绪检查读到的 `market coverage`：

- LAST 有两处缺口：2025-02-11 13:00–15:20（2 小时 20 分，盖住两根完整小时 K 线）；2025-08-03 07:41–07:44（3 分钟）。
- MARK 没有缺口；资金费每期都在；镜像解析到唯一一个；窗口每个月都在。

写这次就绪检查给我的回答。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
