# 0.5.0 探针与计量（2026-11-21）

[0.5.0 复判](rejudge-0.5-20261121.zh.md)最后一档里的只读计量与探针行，以及 C-158（Live 回环夹具）、C-174（锁定 rc7 行为）、C-176（故障探针）。计量在本机（Mac）上做，只读或只写临时目录，没有用到凭据、真实交易所或远程主机。

## Live 回环夹具（C-158）

`tests/live_loopback/`：一个只监听 127.0.0.1 的假 USD-M 交易所（REST 与 WebSocket 同一端口，标准库实现），产品的 `engine.live` 在子进程里照常运行，rc7 的 Binance 适配器只把 `base_url_http` 与 `base_url_ws` 指到假交易所。凭据是每次随机生成的测试密钥，假交易所用它验签。下单、成交、对账都由 Nautilus 完成，夹具只扮演交易所。没有 `/opt/trade/redis` 的主机上用 Nautilus 的内存缓存跑，这样的运行不证明持久化。

假交易所能注入的故障：指定请求返回某个状态码或挂起、断开用户流、`listenKeyExpired`、行情静默、同一根收盘 K 线推两次、合约状态与 tick 变化、不属于本运行的成交（手动平仓、`autoclose-` 强平）。对冲模式下平仓量超过该腿持仓返回 -2022；这个码是按币安的只减仓拒绝设定的，真实币安的应答没有读数（同 20261114-25 的说明）。

与审计回环情形的对照（本机，内存缓存）：

| 情形 | 结局 | 测试 |
|---|---|---|
| 入场、Algo 止损、平仓、撤止损、STOP | 止损为 `STOP_MARKET SELL LONG`、无 `reduceOnly`；交易所空仓无条件单，`clean_stop`，退出 0；所有请求验签通过 | `test_round_trip` |
| 入场 POST 返回 429 | `OrderRejected`，`stopping native_order_failure`，`clean_stop`，退出 1，交易所空仓 | `test_orders` |
| 小数秒 GTD、带 GTD 的 STOP_MARKET 入场 | `entry_refused ORDER_RULE`，`stopping entry_admission_failed`，退出 1，下单请求没有到交易所（审计里 GTD 止损入场的 `AttributeError` 已不再出现） | `test_gtd` |
| 用户流断开期间止损触发 | `entries_closed`，重连后补上止损成交（`PositionClosed`），`entries_opened`，退出 0 | `test_streams` |
| `listenKeyExpired` | 重连，运行继续 | 只跑了探针 |
| 同一根收盘 K 线推两次 | 源码收到两次，第二次入场被 `LIVE_BUDGET` 拒，运行以 `entry_admission_failed` 停止，退出 1（C-067 成立） | `test_streams`，`expectedFailure` |
| 手动平仓后 STOP | rc7 记位置不符，约 60 秒后生成 EXTERNAL 空仓；之后的入场被 `ORDER_RULE`（敞口超过 3 倍权益）拒，运行停止；STOP 按缓存发平仓单，以 `unresolved` 结束，退出 1 | `test_external`，`expectedFailure`（C-140） |
| 强平（`autoclose-`）后 STOP | rc7 记 “Exchange-generated liquidation fill” 后未在门限内应用，生成 EXTERNAL 仓位；STOP 的平仓单打在已无的仓位上，`unresolved`，交易所留下孤儿条件单（20261114-25 成立） | 同上 |
| 合约改为 `SETTLING` | 150 秒内运行没有反应；STOP 时平仓被 -4140 拒，`unresolved native_exit_timeout`，留下仓位 | 只跑了探针 |

两条 `expectedFailure` 是 C-067 与 C-140 的回归闸门：修好后测试意外通过，去掉标记即可。

## 计量

| 行 | 结果 |
|---|---|
| D-090 | `CATALOGUE` 250 码全部有引发处：245 个是字面调用，5 个经辅助函数参数（`RUNTIME_NOT_CI_BUILT`、`WITNESS_UNAVAILABLE`、`INPUT_UNSORTED`、`PAPER_COMPARE_UNCOVERED`、`LIVE_COMPARE_UNCOVERED`），没有可删的。测试从未点名的 8 个：`REPLICA_BUSY`、`RUNTIME_UNRESOLVED`、`EXPORT_MISMATCH`、`LEDGER_NOT_INITIALIZED`、`SERVICE_START_FAILED`、`JUDGMENT_BODY_UNREADABLE`、`QUOTE_INEXACT`、`QUOTES_UNSORTED`。给 D-089：修复说明逐字相同的有 5 组 12 码：[`BARS_UNSORTED`、`MARK_UNSORTED`、`FUNDING_UNSORTED`、`FUNDING_RATE_SHAPE`]、[`COVERAGE_MISMATCH`、`LIFECYCLE_COVERAGE_MISMATCH`]、[`GRID_MISALIGNED`、`INPUT_UNSORTED`]、[`BAR_RAW_INEXACT`、`MARK_INEXACT`]、[`PAPER_COMPARE_UNCOVERED`、`LIVE_COMPARE_UNCOVERED`] |
| C-005 | 最近 15 个改 `.agents/skills` 的非合并提交，248 个用例。以“改动段落里反引号标识符出现在 ≤5 个用例中”为覆盖：覆盖改动的用例 10 个，其中 6 个在该 PR 里没改、没跑（60%）；放宽到 ≤10 个用例：30 个覆盖、26 个没跑（87%）。都超过 20% 的门槛，按 diff 选用例的脚本值得做（另起 PR） |
| B-74 | Live maintain 每 10 秒一轮，每个运行中的 run 约 2 次 docker CLI 调用（`container_identity` 的 container inspect 加 image inspect）；本机每次约 24 ms 墙钟、14 ms user+sys，可忽略。生产主机没有量 |
| C-023 | 本机 BTCUSDT 2025-02-12 一天（1,582,562 行，zip 19.9 MB，从本地 parquet 只读重建）：`aggtrades.batches` 加 `record_batch` 5.0 秒（3.16 µs/行）；`quotes.derive` 0.4 秒（0.23 µs/行，得 1,137,673 行报价）。按 2025-02 全月 4,540 万行外推：解析约 143 秒、推导约 10 秒。下载与写入在整次导入里的占比没有量，向量化与否要等这个比例 |
| C-174 | `tests/engine/test_nautilus_behaviour.py` 锁定 rc7：限价单按 K 线量的 1/4 分批（量 40 的 K 线上 25 的限价单成交 10、10、5，市价单 10 @100.00 加 15 @100.01）；K 线量小于 4 个步长时限价单不成交仍挂着；`sync_reduce_only` 在部分平仓后把只减仓止损改为剩余量、仓位平掉后撤掉；`time_bars_build_delay` 把聚合 K 线的 `ts_event` 推后；保证金率 1、3 倍杠杆时 2.9 倍权益的入场成交、3.1 倍被 `INITIAL_MARGIN_EXCEEDS_FREE_BALANCE` 拒。没做：N2、N12、N13（Sandbox 一侧，可用回环作 Paper 数据源再做）、N7、M-05 |
| C-176 | 回放磁盘写满（`audited_replay` 在 `RLIMIT_FSIZE` 下）：100 MB 与 4096 字节都成功；512 字节时抛 `OSError [Errno 27] File too large`，留下截断成 512 字节的 `orders.csv`。Live 磁盘写满（40000 字节）没有触发，要更低的上限；Paper 的 Redis 被杀、RDB 缺失、SAVE 中被杀、时钟偏移与休眠后定时器相位没有做 |
