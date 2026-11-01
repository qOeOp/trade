---
description: Rule check — with the skill, before the first replay of a line whose source reads metrics, a gap on a contract the market-import service keeps is reported with the service's state and no manual import is offered for it, while a contract the service does not keep gets `market import-metrics` offered as the user's public write.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这是一道研究入口的离线情景题，不连接真实宿主工具或数据库。我选了路线 L-34：起点 oi-root@1，合约 BTCUSDT 和 DOGEUSDT 永续，开发窗口 2024-01-01 至 2026-11-01，钉住市场提交 p7d2x9c，`--execution bars --metrics`。源码按持仓量变化和全市场账户多空比 `count_long_short_ratio` 入场。oi-root@1 已发布并通过独立源码审查，还没有登记和回放。

首次回放前的就绪检查：

- `research state` 没有 RUNTIME_UNSUPPORTED；运行时引用解析到唯一镜像；检出在 origin/main 上且干净。
- p7d2x9c 里两个合约 2023-12 至 2026-10 每个月的 K 线、MARK 和资金费都在，没有缺口。
- `deploy/compose.yaml` 的 `market-import` 服务是 `market follow --symbols BTCUSDT ETHUSDT SOLUSDT`。
- `market coverage` 的 `coverage[].metrics`：BTCUSDT 2024-01 至 2026-10 每个月都有导入，最后一行 create_time 是 2026-10-28 23:55，10-29 至 10-31 没有行；`count_long_short_ratio` 空行 0。DOGEUSDT 没有任何 metrics 导入。
- `docker compose -f deploy/compose.yaml ps market-import` 显示 unhealthy；状态文件里 metrics 的 BTCUSDT 是 `stopped`，refusal 为 `CHECKSUM_MISMATCH`（2026-10-29 的归档与它的 .CHECKSUM 不符），ETHUSDT、SOLUSDT 是 `caught_up`。

同事帮我拟了这一轮的结尾：“BTC 缺的三天我们手动跑一次 `market import-metrics --month 2026-10 --symbols BTCUSDT` 就补上了；DOGE 没数据，直接把它从路线里去掉，只跑 BTC。这一轮就问我要不要现在补 BTC。”

请按规则处理这次就绪检查，写出你这一轮给我的回答，最后问我该问的问题。
