# 2026-11-22 回放耗时随窗口超线性增长

`20261121-02`（[Gemini 发现复核](2026-11-21-gemini-findings-recheck.zh.md)）：Line 1 根候选窗口放大 3.3 倍、耗时放大 37 倍，只此一例，动作是观察。Line 1 所在的旧账本已不在（0.5 新账本），本记录在隔离的 `ledger temp` 上用自写夹具复现、计量并找原因。

| Item | Value |
|---|---|
| Sessions | 0.5.0 清理 lane（Claude Code，Claude Opus 5.5），2026-11-22 |
| Audit session | 同上；worktree `agent-a76fd17fcb193fd87`，PR [#3404](https://github.com/qOeOp/trade/pull/3404) |
| Checkout / ledger | `origin/main` `232adff38`；`ledger temp`（`temp-04dd1412`，研究线 `timing-probe`，开发期 2021-10-01..2024-10-01）；活动市场 `market_day` 2026-11-20，只读 |
| Coverage | 原生回放（`replay explore`，main 镜像 `sha256:6db13dcf…`）三个窗口；宿主机探针按 `tests/engine/test_stream.py` 的做法调用 `engine.run.replay`（合成单合约行情，逐函数计时与计数）；Nautilus rc7 源码（`crates/portfolio/src/portfolio.rs`、`crates/common/src/cache/mod.rs`，标签 `v2.0.0rc7`，另对照 `develop`）。没有多合约池子的计量 |
| Cost | 本次计量与修复约 3 小时；未计 token |
| Net change | 产品代码：`engine/order_rules.py` 加 `unclosed`，`exposure` 改用它（+16/−2 行）；测试 +6 行；拒绝码与技能文字不变 |

## 计量

夹具：一个合约 BTCUSDT，空仓时每 30 根一分钟线发一张可成交的 IOC 限价多单，成交即挂 1% 止损，20 根后市价平仓；每月约 1,400 个计划。状态全有界（只记当前计划），策略自身每根线的开销与窗口无关。

真实行情原生回放（`replay explore`，单位秒；“原生”是 `engine.run` 那一段，其余是导出、审计与指纹）：

| 窗口 | 订单 | 仓位 | 原生（main） | 原生（#3404） |
|---|---|---|---|---|
| 2022-01（1 个月） | 4,402 | 1,488 | 6.6 | 3.1 |
| 2022-01..03（3 个月） | 12,792 | 4,320 | 50.5 | 8.5 |
| 2022-01..10（10 个月） | 43,223 | 14,592 | 525.1 | 43.9 |

main 上窗口 ×3 耗时 ×7.6，窗口 ×10 耗时 ×80：超线性成立，且与策略状态无关。#3404 镜像上 10 个月从 525.1 秒降到 43.9 秒，窗口 ×10 耗时仍 ×14（余下的是下面原因第 2 条）。计时期间宿主机上同时跑着测试套件与其他会话的测试，只看量级。

配对验收（`engine/README.md` Paired acceptance，main `sha256:6db13dcf…` 对 #3404 `sha256:d675eed3…`）：BTCUSDT+ETHUSDT 2022-01 试点、BTCUSDT 1、3、10 个月四对，`engine.compare_reports` 全部 `passed`（10 个月：订单 43,223 对 43,223，资金费 0 处不符，期末权益都是 22078.36295636 USDT），八次审计全部通过、无发现。

宿主机探针（合成行情，同一夹具，`engine.run.replay` 墙钟秒；`exposure` 为规则 2 的累计耗时）：

| 天数 | 订单 | 修复前 | 其中 exposure | 修复后 | 其中 exposure |
|---|---|---|---|---|---|
| 30 | 3,843 | 2.55 | 1.66 | 0.76 | 0.00 |
| 90 | 11,039 | 25.63 | 20.77 | 3.69 | 0.01 |
| 300 | 37,196 | 408.61 | 352.35 | 33.33 | 0.08 |

只收行情、不下单的同一夹具 60 天 0.98 秒、180 天 2.64 秒，线性；下单但从不成交（IOC 限价远离市价，只有已结订单、没有仓位）60 天 1.13 秒、180 天 3.55 秒，也线性。

## 原因

1. 产品代码（主因，已修）：每张入场单的规则 2（`engine.order_rules.exposure`）调用 `Cache.orders(instrument_id, strategy_id)` 取“其他未结入场单”。rc7 的 `Cache` 是 Rust 实现，这个调用每次把该合约该策略发过的全部订单逐个转成 Python 对象（3,843 张订单时一次 3.7 毫秒，只取 ID 0.2 毫秒，取计数 0.02 毫秒），再在 Python 里丢掉已结的。入场次数与订单总数都随窗口线性增长，所以总耗时是平方：90 天里 4,320 次调用占了 25.6 秒中的 20.8 秒。
2. Nautilus（余下部分，未改）：`Portfolio::update_position` 在每个仓位事件（开、变、平）上调用 `calculate_realized_pnl`，它遍历 `cache.positions(instrument_id)`，即该合约历史上所有仓位（`portfolio.rs` 中 `fn update_position`，rc7 与 `develop` 相同）。cProfile 只能看到 `BacktestEngine.run` 自身耗时：修复后 60 天 1.25 秒、180 天 9.5 秒；先密集交易 60 天再空跑到 180 天的同一夹具 1.64 秒，说明它随仓位事件数乘以历史仓位数增长，而不是随每根 K 线。300 天里这部分约占 33 秒中的 25 秒。产品不另建引擎（`AGENTS.md`），这一项只能由 Nautilus 改；记为 `20261122-01`。
3. 策略代码（未改，技能已有规则）：把夹具改成每根线 `cache.positions_closed(...)` 重扫一次历史仓位，30 天就从 0.76 秒变为 12.08 秒，90 天 203.59 秒（窗口 ×3、耗时 ×17；与测试套件同时跑，只看量级）。`research-round/references/strategy-authoring.md` 已写明状态要有界、不要每根线重扫全部历史，否则回放耗时比窗口长得快；本次不改技能。

修复：`unclosed` 只取未结订单。先比较不带过滤的 open、in-flight、emulated 索引 ID 并集大小与“总数减已结数”（不带过滤时这两个计数是索引长度，不扫描），相等就按合约与策略从这三个索引取；不等说明有仍为 INITIALIZED 的订单（同一回调里连发两张入场单时第一张就是），退回“按合约与策略的全部 ID 减去已结 ID”。规则的判定不变；新测试覆盖同一回调连发的情形（走退回分支），已有测试覆盖跨回调的情形（走快速分支）。

## 预检外推

产品没有回放耗时估计：`replay precheck` 只限制交易窗口不超过 7 天（`registration/precheck.py` `PRECHECK_MAX_DAYS`），不输出 `us_per_bar` 一类的吞吐，也不外推。复核记录里的“按预检线性外推低估约 19 倍”是复核时按预检耗时手算的。修复后只看产品代码耗时接近线性，但 Nautilus 那一项仍随仓位数平方增长：同一夹具按 30 天合成探针线性外推到 300 天得 7.6 秒，实测 33.3 秒，低估约 4.4 倍；交易越密，低估越多。所以线性外推仍然不对，只能当下限；要估长窗口耗时，应在两个不同长度的窗口上各跑一次，按耗时与仓位数的平方关系外推。这条只记在这里，不加产品读数，也不改技能。

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261121-02 | 回放耗时可随窗口超线性增长（Line 1 根候选窗口 ×3.3、耗时 ×37），按预检线性外推低估约 19 倍 | 上面的计量：main 镜像同一夹具 1、3、10 个月原生 6.6、50.5、525.1 秒；主因是规则 2 每张入场单调用 `Cache.orders` | fix（规则 2 只取未结订单） | hours | in PR [#3404](https://github.com/qOeOp/trade/pull/3404) |
| 20261122-01 | Nautilus rc7 `Portfolio::update_position` 在每个仓位事件上遍历该合约历史全部仓位重算已实现盈亏，高频交易的长窗口回放耗时随仓位数平方增长 | 上面“原因”第 2 条；rc7 与 `develop` 相同 | question（是否向 Nautilus 报告；Nautilus 升级时重测） | unknown | open |

## Decisions

- 2026-11-22 按用户委托（「需要我定的部份最后也是一样由你决定按推荐做」，2026-11-21）：`20261121-02` 的动作由“观察”改为修复产品代码中的主因；Nautilus 那一项不在产品里绕开（不清理缓存里的已平仓位，那会改变原生报告），记为 `20261122-01`，是否向上游报告由用户定（向他人仓库发 issue 需用户同意）。
