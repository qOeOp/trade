# 迟到 K 线按 Binance 发出时间判定：存储字段审阅

2026-11-18。用户决定（原话「按 Binance 发出时间算」）：一根 K 线迟到，指主机收到它的时刻减去 Binance 为这根 K 线推送的事件时间 E 超过 2 秒，即只算我方的延迟。Binance 在收盘后多久才推送，作为证据显示在差异旁边（和提前到达的 K 线一样），不作为原因。Paper 的记录器和日志、`paper compare`、`live compare` 用同一条规则。

这条规则需要每根 K 线的 E，而现在没有任何地方记录它，所以要新增存储字段。按 AGENTS.md，加字段前先由一个独立子代理审阅，结论记在这里。本记录只做设计和审阅，不实施；是否加字段由用户决定。审阅只读代码，基于 `origin/main` 40fbb124c。

## 结论

需要新增一种日志行 `kline_event`，按审阅意见修改后的设计见下文"字段"。它记录的事实（Binance 推送这根已收盘 K 线时的 E）只出现在那条 websocket 消息里，已存的数据都推不出来。不加字段的几种办法，要么做不到用户的规则，要么同样是新的存储值。

## 现状

- 现行规则：主机收到时刻减去收盘时刻（`close + 1 ms`）超过 2 秒即迟到。
  - Paper 运行时在 `on_bar` 里写 `late_bar` 行（`engine/paper.py`，`LATE_BAR_NS`）；封存读数 `late_bars` 是这些行的条数（`ledger/paper.py`）；IDE 运行中的读数也这样算（`paper/serve.py` 的 `readings`）。
  - `replay.comparison.bars` 用 `bar` 行的 `wall_ns` 重新算一遍（`LATE_NS`），`paper compare` 和 `live compare` 都用它。
- 这条规则把 Binance 自己的推送延迟算在我方头上：
  - 2026-11-17 在 Mac 上用探测脚本自己的 websocket 连接，对 20 个合约、80 个收盘测量：E 比收盘晚，最多 3.001 秒；探测连接收到消息的主机时刻约为 E 加 45 毫秒；主机判为迟到的 5 根，正是 E 本身已晚 2 秒以上的 5 根。
  - 生产 Paper 第 2 次运行 27195 根里有 4791 根（17.6%）被判迟到，第 3 次 15960 根里 3220 根（20.2%）。迟到量中位数 0.56 秒，90 分位 3.05 秒，最大 3.06 秒，与 Binance 自身的推送延迟一致。

## Nautilus 拿不到 E

固定版本 `nautilus-trader==2.0.0rc7`（`uv.lock`）：

- 本机核对：`nautilus_trader.adapters.binance.BinanceBar` 只有 `bar_type`、OHLCV、`quote_volume`、`count`、两项主动买入量、`ts_event`、`ts_init`。
- 源码（标签 v2.0.0rc7）：
  - `crates/adapters/binance/src/futures/websocket/streams/messages.rs`：`BinanceFuturesKlineMsg` 反序列化了 `E`（`event_time`）。
  - `parse_data.rs` 的 `parse_kline`：只用 `k.T` 收盘时间作 `ts_event`，E 被丢弃。
  - `crates/adapters/binance/src/futures/data.rs`：`ts_init` 是每条消息读一次的实时时钟，即收到时刻；结果只作为 `Bar` 和 `BinanceBar` 发出，没有原始消息的回调或钩子。
  - Python 包里没有 websocket 客户端或原始消息回调，`BinanceDataClientConfig` 也没有相关选项。
- v2.0.0rc9 的 `parse_data.rs` 与 rc7 是同一个文件（同一 blob），升级不能解决。
- 标记价格的 `ts_event` 是它那条流自己的 E（`parse_mark_price`），不是 K 线的。

所以拿到 E 只有一条路：运行自己再连一个 websocket，订阅同一批合约的一分钟 K 线流，读其中已收盘消息的 E。

## 字段

一种新的日志行，Paper 和 Live 相同：

| 行 | 字段 | 写在哪里 |
|---|---|---|
| `kline_event` | `instrument_id`；`ts_event`：这根 K 线的收盘时刻 `k.T`，换成纳秒，与 Nautilus 的 `bar.ts_event` 同一个键；`event_ns`：Binance 推送这根已收盘 K 线时的 E，换成纳秒 | Paper：运行目录的 `events.jsonl`，封存后进远端主机的私有 Paper 数据库。Live：证据包的 `market.jsonl`，在 Live 私有根目录下 |

- `wall_ns` 和 `kind` 是日志每行都有的外壳（封存按 `wall_ns` 分日），不是新字段。规则不用这一行的 `wall_ns`，它只说明旁路连接自己收到的时刻。
- `ts_event` 要存：用 E 推它，在 E 晚于收盘一分钟以上时会错。
- 只记一分钟周期、`x` 为真的消息，每个（合约，`k.T`）只记第一条。每个合约每分钟一行，Paper 私有数据库的行数约翻一倍。
- 两种执行记录都不进研究账本、DoltHub 或 Git。
- 单独成行而不是 `bar` 行上的一个字段：`bar` 行在 Nautilus 交出 K 线时写，旁路消息可能早到也可能晚到，等它会延误写入。比较时按（合约，收盘时刻）对上。

### 规则用哪个收到时刻

用 `bar.ts_init`：它就是 Nautilus 从连接上收到这条消息的时刻，已经存在 `bar` 行里。`bar.wall_ns` 还包含队列和 Paper 扣住数据（`release_before`）的时间，不是"收到"。所以：

- 迟到：`bar.ts_init − kline_event.event_ns > 2 秒`；
- 证据：Binance 推送延迟 `event_ns − (close + 1 ms)`，像 `early_bars`、`early_lead_ms` 那样列在差异旁边，不进原因。

### 对不上的 K 线

旁路连接掉线、Binance 每 24 小时断开、重连间隙、恢复和停机、运行刚开始时，会有 `bar` 行没有对应的 `kline_event`。这些 K 线单独计数为"未知"，不退回旧规则，也不当作准时。

### 不再在运行时写 `late_bar`

- `late_bar.late_ns` 本来就能由同一次调用写的 `bar` 行推出。有了 E 之后，运行时判定还要等旁路消息，成了两条连接的竞争。
- 改为：去掉运行时的 `late_bar` 行，封存读数 `late_bars` 由 `bar` 行和 `kline_event` 行算出。
- `paper/serve.py` 的 `Journal.read` 现在丢弃 `bar` 行、只计数，运行中的读数会因此算不出来。它要为每个（合约，收盘）保留 `ts_init`，才能和 `kline_event` 对上。

### IDE 推送

`kline_event` 和 K 线一样频繁。照现在的做法，它会作为非 K 线的行全部推给页面、留在内存里、算进续传的位置（`paper/serve.py`）。要像 `bar` 行那样处理，或者不推送；若过滤，续传的计数也要同样排除。

### 旁路连接的代价

- 仓库里没有 websocket 库（`pyproject.toml` 没有，`engine/`、`live/`、`paper/` 也没有 websocket 代码），要么加依赖，要么手写客户端。
- Paper 只能经 CONNECT 代理出网（`engine/egress.py` 已允许 `fstream.binance.com:443`，网络配置不用改）；出网日志会多一条 CONNECT。
- 要处理重连、ping 和 24 小时断开。每次运行多一条连接，远低于 Binance 每个 IP 的连接上限。
- 旁路连接失败不停止运行，只让那段时间的 K 线成为"未知"。
- Paper 写 `kline_event` 要走 `Journal.write` 的锁和失败锁存，且不在 `@mutation` 里；Live 走 `_append`，失败记为证据包的 market 部分失败。

### 主机时钟偏差

`ts_init − E` 比较的是主机时钟和 Binance 的时钟。网络延迟约 45 毫秒，主机时钟快 2 秒左右就会把每根都判为迟到；负值说明主机时钟慢了，像现在的 `early` 那样作为证据报告。现行规则也有同样的依赖（收盘是 Binance 的时间）。

### 谁读它

- `replay.comparison.bars`（`paper compare` 和 `live compare` 共用）：迟到判定、Binance 推送延迟证据、"未知"计数。
- `ledger/paper.py` 的封存读数 `late_bars`。
- `paper/serve.py` 运行中的读数，和 IDE 的迟到计数（沿用 `late_bars` 键）。

## 不加字段的办法

| 办法 | 是否新增存储 | 能否实现用户的规则 | 问题 |
|---|---|---|---|
| A. 维持现行规则（收到时刻减收盘） | 否 | 否 | 就是现在的问题：约 18% 到 20% 的 K 线因 Binance 的延迟被判迟到 |
| B. 把门槛提高到 2 秒加上观察到的 Binance 最大推送延迟（例如 5 秒） | 否 | 否，只是近似 | 不能逐根区分；改门槛是改审计检查，要用户授权；Binance 偶尔更晚时仍误判 |
| C. 用标记价格流估计我方延迟：Nautilus 里已有标记价格的 `ts_init − ts_event`（收到时刻减它自己的 E），运行时取收盘前后最近一条作为我方延迟来判迟到 | 是：要改 `late_bar.late_ns` 的含义，存的是一个判断而不是事实；Live 还要新增 `late_bar` 行 | 近似：量的是同一时刻我方链路的延迟，不是这根 K 线的 | 优点是不用旁路连接。但标记价格样本不记日志，判断无法审计或重算；Binance 的推送延迟也无法作为证据 |
| D. 每次运行只存两个汇总数：Binance 晚到的根数和我方晚到的根数 | 是：读数应由日志的行推出（`late_bars` 就是 `late_bar` 行的条数），这两个数推不出，是新的独立存储值 | 运行级别可以，逐根不行 | 仍要旁路连接取 E；比较页无法把某个分岔归因到某根 K 线；比逐根的行丢的信息更多 |
| E. 等 Nautilus 上游在 `BinanceBar` 上带出 E | 字段仍要加，但不用旁路连接 | 可以 | rc9 仍没有，时间不可控；可以同时向上游提 issue 或 PR |

## 审阅

一个独立子代理只读审阅了本设计的初稿和相关代码（`engine/paper.py`、`engine/live_evidence.py`、`ledger/paper.py`、`paper/serve.py`、`replay/comparison.py`、`live/compare.py`、`engine/egress.py`、`uv.lock`），并直接核对了已安装的 rc7 和上游 v2.0.0rc7 与 v2.0.0rc9 源码。

- 结论：需要，按意见修改。
- 谁读它：`replay.comparison.bars`、封存读数 `late_bars`、IDE 运行中的读数。初稿说"IDE 沿用现有键，不需要新字段"，只在保留运行时 `late_bar` 行时成立；已改为由 `bar` 行和 `kline_event` 行推出，并写明 `Journal.read` 要保留 `ts_init`。
- 独立事实：成立。E 只在 websocket 消息里，rc7 解析后丢弃，rc9 相同；REST、档案、`bar` 行的各时刻、快照行都没有它；标记价格不记日志。
- 已有数据为什么表达不了：成立，没有任何关系或推导能得到 E。
- 要求的修改（均已写进上文）：
  1. 明确规则用的收到时刻（`ts_init`），并写明探测的"E 加 45 毫秒"用的是哪个时刻；
  2. 对不上的 K 线计为"未知"；
  3. 去掉运行时 `late_bar` 行，封存时推出；
  4. 处理 IDE 推送；
  5. 写明旁路连接的代价和失败处理；
  6. 写明主机时钟偏差；
  7. 字段：`wall_ns`、`kind` 是外壳，`ts_event` 要存，每个（合约，`k.T`）只记第一条。
- 初稿的错误：办法 C 写成"Paper 不新增存储"不对，也漏了它不用旁路连接这个优点；已改正。

## 用户决定

2026-11-18 用户授权（原话「授权 (Recommended)」），按上文"字段"实施：Paper 的 `events.jsonl` 和 Live 的 `market.jsonl` 新增 `kline_event` 行，旁路连接取 E，迟到 = `ts_init − E > 2 秒`，对不上的计为未知，运行时不再写 `late_bar` 行，Binance 的推送延迟只作证据。旁路连接手写，不加依赖；出网白名单不变。

## 当时待用户决定的

- 是否授权新增 `kline_event` 行（`instrument_id`、`ts_event`、`event_ns`），写进 Paper 日志和 Live 证据包。
- 授权的话，同时意味着：每次 Paper 和 Live 运行多一条到 `fstream.binance.com` 的 websocket 连接；可能加一个 websocket 依赖；运行时不再写 `late_bar` 行，`late_bars` 改为封存时推出；比较多出"未知"和 Binance 推送延迟两项证据。
- 不授权的话，可选 B（改门槛，也要授权）或维持现状 A。

# 旁路连接的断线与重连：存储字段审阅

2026-11-18。`kline_event` 实施后（#3172）留下一个缺口：旁路连接自己的断线、重连不记录。旁路连接掉线时，Binance 推送的 K 线没有 `kline_event`，这些 K 线在比较里只显示"没有 Binance 发出时间"，看不出是旁路断了，还是连接正常而某条消息没到。

## 结论

新增一种日志行 `kline_socket`，按审阅意见修改后的设计见下文"字段"。审阅认为需要；用户已授权（见"用户决定"），据此实施。

## 字段

一种新的日志行 `kline_socket`，Paper 和 Live 相同，只在旁路连接的状态变化时写：

| 字段 | 含义 |
|---|---|
| `state` | `up`：Binance 答应了升级（101），开始收消息；`down`：连接不在 |
| `at_ns` | 主机时钟，在旁路线程上取。`up`：升级成功的时刻。`down`：这条连接最后一次被证明活着的时刻，即最后一次收到帧的时刻（连上后没收到过帧则是 `up` 的时刻）；这次进程里还没连上过，则是这次尝试开始的时刻 |
| `reason` | 只在 `down` 上，有界分类，见下表 |

`reason` 与旁路连接代码的对应：

| `reason` | 何时 |
|---|---|
| `closed` | 已经 `up` 后，服务端发来关闭帧，或连接被对端断开、读到流结束（含 Binance 每 24 小时的断开） |
| `silent` | 已经 `up` 后，30 秒没有任何帧（读超时） |
| `refused` | 代理拒绝隧道，或流拒绝升级（单独的异常类型） |
| `error` | 其他一切，包括连上之前的超时 |

- 写在哪里：Paper 运行目录的 `events.jsonl`，在节点线程上和 `kline_event` 一起每秒取出写入；Live 证据包的 `market.jsonl`。都是执行记录，不进研究账本、DoltHub 或 Git。
- 只写变化：`up` 之后的第一次失败写一条 `down`；已经 `down` 时，只有 `reason` 变了才再写一条（重试间隔最长 30 秒）。停机时不写：停机后没有 K 线。
- `wall_ns`、`kind` 是外壳。`at_ns` 要单独存：这一行每秒取出一次才写，`wall_ns` 晚于事件；`silent` 要在最后一帧之后 30 秒才发现，用 `wall_ns` 会把这 30 秒算成"连着"。改写 `wall_ns` 也不行，日志会不按时间排序，封存按 `wall_ns` 分日。

### 进程开始：推出，不存

每个进程开始时旁路连接还没连上，从进程开始到它第一条 `up` 都算断开，原因显示为"还没连上"（`starting`，不存）。进程开始由已有的数据给出：

- Paper：同一个 `events.jsonl` 里的 `started` 和每条 `resumed` 的 `wall_ns`，它们都在旁路线程开始之前写。
- Live：`live compare` 一次只比较一个进程（一个交易启动），取这个进程第一条日志的 `observed_ns`，`market.jsonl` 也只取这个进程的行。

所以恢复或重启后、新连接连上前的那段时间，不会被算进上一个进程的 `up`。

### 谁读它

- `replay.comparison.bars`（`paper compare` 和 `live compare` 共用，经 `engine.kline_events.received`）：一根没有 `kline_event` 的 K 线，如果从它的收盘到 Nautilus 收到它之后 2 秒（`bar.ts_init + LATE_NS`）之间，旁路连接有任何时刻不是 `up`，就计为"旁路断开"，带上那时断开的原因；其余没有 `kline_event` 的才是"未知"。窗口延到 `ts_init` 之后，因为旁路收到同一条消息的时刻可能比 Nautilus 晚几十毫秒；窗口从收盘开始，在收盘之后、E 之前恢复的断开也算，这对这些不知道 E 的 K 线可以接受。
- 比较结果：汇总和每个合约各有 `side_down_bars`；每个合约列出前几根（收盘、原因）；每个差异旁的证据有 `side_down_bars` 和 `side_down_reasons`。和"未知"一样只是证据，不是原因，不改变归因或前视嫌疑。比较格式改为 `run-comparison@2026-11-18.1`，旧格式的缓存结果会重新比较。
- IDE 比较视图：计数行和每个差异旁的证据，把"旁路断开时没有发出时间的 K 线"（带原因）和"没有 Binance 发出时间的 K 线"分开显示。
- IDE 运行日志列表：这一行显示为发出时间连接的状态。

### 已有数据为什么表达不了

- `kline_event` 只在收到消息时写。缺一条时，无法区分旁路断了还是连接正常而这条消息没到，这正是要区分的。
- Paper 的 `socket` 行、Live 的 `socket_state` 事件是 Nautilus 自己数据连接的状态，不是旁路连接。复用 `socket` 行（换一个 `endpoint`）会把旁路的状态算进封存读数 `socket_events`，IDE 也把 `socket` 行当作 Nautilus 的端点显示。
- `KlineEvents.failures` 只在内存里，不写任何地方。
- 出网日志只记 CONNECT 尝试，没有断开和时长，分不出旁路和 Nautilus 的连接（都连 `fstream.binance.com:443`），封存里只留尾部，而且只有 Paper 有。
- 从 `kline_event` 的间隔推断（某个收盘所有合约都缺 E 就当作断开）：只有一个合约时推不出；Binance 没发某个收盘与连接断开无法区分；断开的原因完全丢失；断开的起止落在分钟中间时对不准。
- 进程开始可以由 `started`、`resumed` 和 Live 的进程分段推出，所以不存（见上）；其他断开推不出。

## 审阅

一个独立子代理只读审阅了初稿和相关代码（`engine/kline_events.py`、`engine/paper.py`、`engine/live.py`、`engine/live_session.py`、`engine/live_evidence.py`、`engine/live_lifecycle.py`、`engine/egress.py`、`replay/comparison.py`、`paper/compare.py`、`live/compare.py`、`ledger/paper.py`、`paper/serve.py`、IDE 的 `Compare.tsx` 和 `model/paper.ts`）。

- 结论：需要，三处小改。
- 谁读它：成立。两种比较已经把这些 K 线一并列为"没有 Binance 发出时间"，拆开正是用户指出的缺口。`at_ns` 和 `ts_init` 都是主机时钟，可以比较。
- 独立事实：成立。旁路连接的状态哪里都没有记录（`failures` 只在内存，`socket`/`socket_state` 是 Nautilus 的连接，出网日志分不出两条连接）。
- 已有数据为什么表达不了：成立；`at_ns` 必要（理由同上）；`reason` 可以保留，它是最弱的字段，只用于显示，但能区分处理办法不同的几种断开。
- 要求的修改（均已写进上文）：
  1. 去掉初稿里存的 `start` 原因：进程开始由 Paper 的 `started`/`resumed` 和 Live 的进程分段推出；
  2. 窗口终点从 `ts_init` 改为 `ts_init + LATE_NS`，否则旁路比 Nautilus 晚几十毫秒收到最后一帧、随即静默时，会把这根 K 线误计为"未知"；
  3. 写明原因与代码的对应：关闭帧或流结束为 `closed`，`up` 之后的读超时为 `silent`，代理或升级被拒为 `refused`（要单独的异常类型），其余包括连上之前的超时为 `error`。

## 用户决定

2026-11-18 用户授权加字段（原话「第二个限制我授权加字段 你走评审吧」），要求先走审阅；审阅认为需要，按上文"字段"实施。
