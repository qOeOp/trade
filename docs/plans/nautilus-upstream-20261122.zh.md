# Nautilus 上游 issue（2026-11-22）

用户 2026-11-22：「报告的」「附上脚本吧」，以及「我们多向nautilus项目提issue很好 如果是我们现在work around 是希望他们添加的功能也可以提issue」。本页记这一批发给 nautechsystems/nautilus_trader 的 issue，以及上游修好后产品里可以删掉的绕行代码。升级 Nautilus 时逐条对照：已修的删绕行代码，并重跑对应探针。

范围：只读盘点 `engine/`、`live/`、`paper/`、`replay/`、`market/` 里补 Nautilus 的地方，逐条对照 `develop`（e68f771），查过已有 issue 后保留 9 条。缺陷类在 2.0.0rc9 上用只依赖 Nautilus 的脚本实跑（定时器一条无法让主机休眠，按读代码提交）。

| issue | 类型 | 内容 | 依据 | 上游修好后可删 |
|---|---|---|---|---|
| [#5730](https://github.com/nautechsystems/nautilus_trader/issues/5730) | 缺陷（性能） | `update_position` 每个仓位事件重算该合约全部历史仓位的已实现盈亏，回放耗时随仓位数平方增长（doctor 20261122-01） | rc7 实跑，附脚本 | 无绕行；长窗口回放提速，升级后重测 |
| [#5731](https://github.com/nautechsystems/nautilus_trader/issues/5731) | 功能 | Binance K 线推送的事件时间 `E` 被丢弃 | develop 源码 | `engine/kline_events.py` 旁路连接及其引用，约 250 行 |
| [#5732](https://github.com/nautechsystems/nautilus_trader/issues/5732) | 功能 | 与上一根同 `ts_event` 的 K 线通过 `validate_data_sequence`，策略重复决策 | develop 源码 | Paper 与 Live 的重复 K 线判断（`bar_repeated`），约 25 行 |
| [#5733](https://github.com/nautechsystems/nautilus_trader/issues/5733) | 功能 | `PositionOpened`、`PositionChanged`、`PositionClosed` 在 Python 没有 `to_dict` | develop 源码 | Live 证据里手写的仓位事件字段表，约 10 行 |
| [#5734](https://github.com/nautechsystems/nautilus_trader/issues/5734) | 缺陷 | `close_position(time_in_force=GTD)` 让进程 abort，而不是抛错 | rc9 实跑，附脚本 | 订单规则里的防护，约 3 行 |
| [#5735](https://github.com/nautechsystems/nautilus_trader/issues/5735) | 缺陷 | 撮合引擎给未成交的挂单限价单设 MAKER，没有事件 | rc9 实跑，附脚本 | 报告里去掉未成交流动性方向的处理与 Paper 恢复里的对应几行，约 16 行 |
| [#5736](https://github.com/nautechsystems/nautilus_trader/issues/5736) | 缺陷 | Redis 缓存的账户状态重复追加，清理不到数据库 | rc9 实跑，附脚本 | Paper 恢复与 Paper 读数里的账户事件去重，约 20 行 |
| [#5737](https://github.com/nautechsystems/nautilus_trader/issues/5737) | 缺陷 | Redis 中途失联后 `dispose()` 不返回 | rc9 实跑，附脚本 | 基本不能删：Redis 快速失败参数仍要保留 |
| [#5738](https://github.com/nautechsystems/nautilus_trader/issues/5738) | 缺陷 | 一小时以内时间 K 线的定时器走单调时钟，主机休眠后持续晚到 | 读代码（SIGSTOP、`docker pause` 不能复现），附脚本 | 慢到聚合 K 线的入场拒绝与 `late_aggregate` 记录，约 30–60 行（检测可能仍保留） |

此前的 issue：#5287、#5288、#5690 已修；#5695（跟踪止损激活状态随订单恢复）仍开着。

## 升级时另记

- 新版已有、可替换自有实现的：`write_funding_rate_updates`（替换 `market/export.py` 手写的资金费 Parquet）；Binance 适配器的 `instrument_refresh_interval_secs`（运行中刷新合约条款）。
- rc9 移除了 Python `RedisCacheDatabase`，Redis 缓存改为 `LiveNode.builder(...).with_cache_database_factory(RedisCacheConfig(...))`；Sandbox 用 `add_simulated_exec_client`，并须显式给 `fee_model`。
