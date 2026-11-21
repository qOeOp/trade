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
| C-176 | 回放磁盘写满（`audited_replay` 在 `RLIMIT_FSIZE` 下）：100 MB 与 4096 字节都成功；512 字节时抛 `OSError [Errno 27] File too large`，留下截断成 512 字节的 `orders.csv`。Live 磁盘写满（回环，`RLIMIT_FSIZE` 6000 字节，连续 3 次）：日志在记入场的那一行写满，最后一行被截断、不以换行结尾；运行以 `LIVE_JOURNAL_UNAVAILABLE` 走 STOP 路径，平掉仓位、撤掉止损，退出 2，没有结束事件；`live.state.events` 对不以换行结尾的日志拒绝（`LIVE_JOURNAL_UNAVAILABLE`，留待对账），与 `live/README.md` 一致（`tests/live_loopback/test_host_faults.py`）。Paper 原生缓存（运行镜像的 redis-server，`tests/engine/test_paper_cache_faults.py`，宿主无 redis-server 时跳过，在 `exec-main` 镜像里跑，命令在文件头）：子进程被杀后 `health` 报 `exited with -9`，下一个进程从已发布的切点恢复并保留用过的原件；切点的 RDB 原件缺失时恢复以 `PAPER_RECOVERY_UNAVAILABLE`（original is missing）拒绝、切点保留（审计里被 dirty 检查先命中的分支）；SAVE 进行中被杀（`temp-*.rdb` 留在工作目录）时快照失败、不发布新切点，旧切点不变，日志多出的尾巴使恢复拒绝，截回切点后恢复成功，均与 `paper/README.md` 的恢复规则一致。Paper 时钟受控偏移：Paper 不建恢复绑定时不用 Redis，把 `engine.paper` 的 Binance 公共地址指到回环假交易所（同 `tests/live_loopback/runner` 的替换，另加 `kline_events.HOST`），假交易所的钟快 2 秒（即主机慢 2 秒）：6 根 K 线的 `ts_init` 都比收盘早约 1.84 秒，运行照常入场、成交、停止，没有拒绝；这就是 11-14 用户决定里 `paper compare` 只展示、不归因的“提前到的 K 线”。主机休眠：回环上让持仓中的 Live 运行器 `SIGSTOP` 70 秒（假交易所照常运行）再 `SIGCONT`：恢复后立即记 `drawdown_unverified` 并停止（60 秒没有权益读数，回撤刹车无法执行），平仓撤止损，退出 1，与 `live/README.md` 一致；120 秒同样结局，用户流心跳超时后重连（`tests/live_loopback/test_host_faults.py`）。Paper 的休眠与 Live 的时钟偏移没有单独做：前者的定时器与 Live 同属 Nautilus 的 LiveClock，后者的交易所时间戳窗口只能在真实交易所看 |
| C-025 | 池成员与月份取自本机全合约隔离市场（`market-full`，2020-01..2026-10，只读）：675 个合约当过成员，共 18,603 个成员月；data.binance.vision 的月度 aggTrades 列表（S3 列表 GET，675 次，间隔 0.5 秒，无拒绝）有其中 18,599 个，zip 合计 965 GB（2021-11..2026-10 为 841 GB；按年 2021 139、2022 92、2023 86、2024 200、2025 225、2026 前十个月 209 GB）。每成员月 zip 中位 24 MB、p90 108 MB、p99 504 MB、最大 2.6 GB；BTC、ETH、PEPE、SOL、DOGE 五个占 13.6%。2026-10 一个月 522 个成员 21.6 GB。临时市场（`--kind temporary`，用后删除）导入 2025-10 两个合约，含下载：NEOUSDT（zip 21.9 MB）aggTrades 13.7 秒、quotes 5.6 秒；OMUSDT（102.7 MB）52.0 秒、17.5 秒，约每 zip MB 0.7–0.9 秒（单合约串行）；落盘 agg_trade 约为 zip 的 0.62 倍、quote 约 0.26 倍。外推：全部成员月约 870 GB、串行约 200 小时（开发加留出五年约 760 GB、175 小时）；只跟新月份每月约 19 GB、4.5 小时。结论：不加 `--quotes-pool`。只往后跟的池报价要几年后才够一个开发期，补齐历史要近 1 TB 磁盘，`QUOTES_MISSING`、`TRADES_MISSING` 照旧；池上要 `quotes` 撮合须先由用户定磁盘与主机 |
| C-027 | 同一隔离市场里，当过池成员、最后一分钟有成交早于市场头（2026-10-31）三天以上的合约 160 个（按年 2020 1、2021 1、2022 13、2023 3、2024 26、2025 46、2026 70）；2021-11..2024-10 内 35 个，2024-11..2026-10 内 124 个。`EOSUSDT` 2025-05-21、`MKRUSDT` 2025-09-08、`BAKEUSDT` 2025-10-03、`AI16ZUSDT` 2025-11-06 都在内（下架后 bars 仍有零成交量的分钟，按最后有成交量的分钟算）。生命周期证据包一个市场日一份，160 个下架各是其中一个 episode。公告：币安 Delisting 栏目 447 篇（最早 2022-02-17，9 次列表 GET，间隔 3 秒）；45 个合约在合约下架标题里点名，72 个的币名只出现在其他下架标题里（要读正文才知道是否含合约），43 个没有（多为换币迁移：MATIC、FTM、AGIX、OCEAN、RNDR、EOS、MKR、AI16Z 等，在别的栏目，另有 2022-02 之前的）。抽读三篇合约下架正文（2022、2024、2026）：都给出结算与下架时刻，2026 篇另给只减仓起点，三篇都没有结算价数字。所以公开来源能补 `PRE_CLOSE` 与 `CLOSE`，补不了 `InstrumentClose`（模块规则“不编价格”）。币安规则说结算价是下架前 30 分钟指数价的均值；已下架合约的 `indexPriceKlines` 1 分钟存档仍在 data.binance.vision（`YFIIUSDT` 有到 2022-06 的文件），用它算结算价算不算交易所公布的价格，要先改生命周期规则，由用户定。录入留给新活动账本（M，用户建账本之后） |
| C-172 | 本机两个市场目录的条款只读普查（`instrument.parquet`，只读）：`market` 30 个合约 60 行、`market-full` 932 个合约 933 行，价格 tick 与数量步长全是 10 的幂，没有合约有过两种 tick；所以 `make_price` 与产品取整在非 10 的幂 tick 上的分歧目前没有后果，不加订单规则测试，等出现这样的合约再加。Live 回环：预热后把 tick 从 0.10 改成 0.01（小数位不同），源码看到的 `price_increment` 仍是启动时载入的 0.10（rc7 运行中不重载合约），下一次入场被 `TERMS_CHANGED` 拒（`price_increment: market 0.10, exchange 0.01`），没有请求到交易所，运行停止，退出 1（`tests/live_loopback/test_terms.py`）。Paper（回环，同 C-176 的做法）：同样的改动之后 Paper 没有察觉，源码仍见 0.10，按 0.10 网格的入场在 Sandbox 成交；Paper 只在启动时核对条款（`_check_terms`），运行中条款变化时 Paper 与 Live 会分开：Live 拒绝入场，Paper 照常交易。<br>**决定（2026-11-22，收紧拒绝，由协调者在用户授权「需要我定的部份最后也是一样由你决定按推荐做」下决定）**：Paper 与 Live 一样在每笔入场时读币安 `fapi/v1/exchangeInfo`，用同一个取条款函数（`engine.config.venue_terms`）与比对（`terms_changed`）对照运行市场日的条款；不一致或读不到条款时该入场不发出，记 `refusal TERMS_CHANGED` 并停止运行；只减仓单不读、照常发出。回放不会遇到：整段窗口每个合约只用一份条款快照（`market.instrument`），条款晚于窗口结束时只记 `CURRENT_SNAPSHOT_APPROXIMATION` 局限，没有拒绝；按设计不同，不改 |
