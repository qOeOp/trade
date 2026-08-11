# DST

<!-- Keep this title as "DST"; longer titles do not render well in the left navigation. -->

确定性模拟测试（DST）让 VibeTrader 在由种子控制的运行时中执行，使对时序敏感的执行行为可以凭一个整数逐位复现。本页定义确定性契约：运行时在种子控制下保证什么、哪些适配层实现这些保证、哪个预提交钩子强制执行这些约束，以及保证在哪里终止。每项声明都指出对应源码位置，便于用户和审计人员对照代码核验契约。

:::note
依赖 VibeTrader 确定性的下游测试工具，应使用其固定 VibeTrader 提交中对应版本的本文档。修改本文档就是修改这些使用方所依赖的契约，应按契约变更进行审查。
:::

## DST 是什么

DST 是一种面向并发系统的测试技术。一个种子可完全决定一次执行，包括任务调度、计时器触发和随机值。种子、二进制文件和配置相同的两次运行，会产生完全相同的可观察行为。属性检查失败时，种子本身就是复现条件：使用同一种子，每次都能重放该故障。

异步运行时的调度决策通常来自进程环境状态，例如任务唤醒顺序、计时器精度、线程调度和哈希种子。测试工具无法控制这些因素，因此只在 CI 中偶发一次的竞态通常很难按需复现。DST 用带种子的伪随机序列替代这些环境来源，使任务交错顺序成为种子的函数。

FoundationDB 从约 2009 年起把这种模式用于生产级分布式数据库。在 Rust 生态中，[madsim](https://github.com/madsim-rs/madsim) 会拦截 `tokio` 原语，提供确定性调度器。

DST 重点发现单元测试、集成测试、属性测试和验收测试容易遗漏的问题：通道唤醒顺序、关闭时的排空竞态、启动顺序、对账顺序以及恢复路径正确性。这些问题都涉及其他测试层无法穷尽的交错情况，而确定性调度器可以系统探索这些情况。

## 目标

- **种子可复现执行**：覆盖 VibeTrader 运行时中纳入范围的部分。
- **如实说明范围**：契约明确列出覆盖和未覆盖内容。系统不会悄然回退到真实墙上时钟或无种子 RNG；所有会削弱保证的条件都会列明。
- **在源码中强制执行**：预提交钩子会拒绝向 DST 路径添加禁用模式的提交，使契约无需完全依赖审查人员的注意力也能保持成立。
- **最少必要插桩**：只有契约要求的时间、任务调度和随机性才经确定性来源路由，其他部分保持不变。

## 实现方式

`madsim` 只能让经其别名子模块（`time`、`task`、`runtime`、`signal`）路由的 `tokio` 原语具有确定性。墙上时钟读取、单调时钟读取、RNG 取值、哈希迭代和 `select!` 轮询完全绕过 `tokio`，需要各自的适配层。第 1 层把别名子模块替换为 `madsim`，第 2 层提供其他适配层。

### 第 1 层：运行时替换

为 `vibe-common` 启用 `simulation` Cargo 功能，并设置 `RUSTFLAGS="--cfg madsim"` 后，四个 `tokio` 子模块会经 `madsim` 路由：

- `time`（计时器、间隔、单调 `Instant`）。
- `task`（生成和连接异步任务）。
- `runtime`（运行时构建器和句柄）。
- `signal`（`ctrl_c` 等进程信号）。重新导出已经存在，但调用点尚未全部采用（参见[信号处理](#信号处理)）。

这些重新导出位于 `vibe_common::live::dst`。DST 路径中使用 `time`、`task` 和 `runtime` 的调用点从该模块导入，而不是直接从 `tokio` 导入，因此切换功能即可在一个位置替换已完整路由原语所使用的异步运行时。普通构建中，重新导出解析到真实 `tokio`；在 `simulation` + `cfg(madsim)` 下，则解析到 `madsim` 的确定性实现。

`tokio` 的其他功能（`sync`、`io`、作为宏的 `select!`、`fs`、`net`）始终使用真实 `tokio`。传递依赖 crate（`tokio-tungstenite`、`tokio-rustls`、`reqwest`）不受影响。

### 第 2 层：替换非确定性来源

异步运行时之外的非确定性通过显式适配层重定向：

- **墙上时钟读取**经 `vibe_core::time::duration_since_unix_epoch`。模拟时，它路由到 `madsim::time::TimeHandle::try_current()`，为订单和成交时间戳保留 Unix 纪元语义。在 madsim 运行时之外（普通 `#[rstest]` 测试体）调用时，会回退到 `SystemTime::now()`；在 `cfg(madsim)` 下，libc 会将其拦截为普通构建所使用的同一个真实系统调用。模拟中的生产路径始终在运行时内执行，因此仍会取得虚拟时间。
- **单调时钟读取**经 `vibe_common::live::dst::time::Instant`。普通构建中该类型解析为 `tokio::time::Instant`，确保 `tokio::test(start_paused)` 测试仍可工作；模拟时则解析为 `madsim::time::Instant`。
- **网络内部的单调时钟读取**经 `vibe_network::dst::time`。该 crate 在依赖图中位于 `vibe-common` 下层，并公开语义相同的本地重新导出模块。
- 对账管理器和订单撮合引擎中对**哈希迭代顺序**敏感的路径使用 `IndexMap` 和 `IndexSet`，而不是 `AHashMap` 和 `AHashSet`。`AHash` 会为每个进程随机化哈希器；当迭代顺序决定下游事件发布顺序，或决定带种子的 `FillModel` RNG 消耗顺序时，必须按插入顺序迭代。
- DST 路径的每个生产调用点都为 **`tokio::select!` 轮询顺序**使用 `biased;` 修饰符。无偏 `select!` 会按未被拦截的 RNG 所选择的顺序轮询各分支。

## 确定性契约

满足下列条件时，同一平台上由 `(seed, binary hash, configuration hash)` 标识的运行会逐位产生相同的：

- 异步任务调度顺序。
- 计时器触发顺序（虚拟单调时钟和虚拟墙上时钟）。
- `madsim::rand` 的 RNG 输出。
- `tokio::sync` 通道的交付顺序。

### 必要条件

只有同时满足下列全部条件，契约才成立：

- 必须启用 `simulation` Cargo 功能并设置 `RUSTFLAGS="--cfg madsim"`。前者启用确定性运行时，后者启用 `madsim` 在 libc 层对 `clock_gettime` 和 `getrandom` 的拦截。缺少任意一项都会悄然回退到真实 `tokio`，在不报错的情况下破坏确定性。
- DST 路径中的每个 `tokio::select!` 调用点都使用 `biased;` 修饰符。
- 单调时钟读取经 DST 适配层（`vibe_common::live::dst::time` 或 `vibe_network::dst::time`）路由，而不是直接调用 `std::time::Instant::now`。
- 墙上时钟读取经 `vibe_core::time::duration_since_unix_epoch` 路由。
- 随机性经 `madsim::rand` 路由。`rand::thread_rng`、`rand::rng()`、`fastrand`、`getrandom` 和 `OsRng` 不会被拦截。
- 对迭代顺序敏感的集合使用 `IndexMap` 或 `IndexSet`，或在使用位置排序。
- 模拟时通过 cfg 排除 `tokio::task::LocalSet` 构造。`madsim` 不提供 `LocalSet`，而 `spawn_local` 无需它即可工作。
- `tokio::task::spawn_blocking` 调用点通过 cfg 排除或移除。阻塞调用会逃离确定性调度器。

## 静态强制检查

静态强制检查分为两层：

- `clippy.toml` 和 `[workspace.lints.clippy]` 中的 Clippy 策略会禁止整个工作区 DST 契约不允许的 API：直接调用 `getrandom::{fill,u32,u64}` 和 `tokio::task::LocalSet`。
- 名为 `check-dst-conventions` 的预提交钩子执行 Clippy 难以清晰表达的范围感知、路径感知和 cfg 感知结构检查。

钩子位于 `.pre-commit-hooks/check_dst_conventions.sh`，在标准预提交套件和 CI 中运行。规则 1 至 6 适用于范围内的 17 个工作区 crate，规则 7 适用于 madsim 构建路径上的 9 个 crate。发现下列情况时，钩子会拒绝提交：

- **规则 1**：直接读取 `std::time::Instant::now()`、`SystemTime::now()`、`jiff::Timestamp::now()` 或 `jiff::Zoned::now()`；如果所在文件从 `std::time` 导入相应类型，或从 `jiff` 导入 `Timestamp` 或 `Zoned`，其简写形式也包括在内。
- **规则 2**：使用原始 RNG（`rand::thread_rng`、`rand::rng()`、`fastrand::`、`getrandom::`、`OsRng`），或未受 cfg 保护的 `Uuid::new_v4()`。
- **规则 3**：`tokio::select!` 块的前三行没有 `biased;`。
- **规则 4**：`std::thread::spawn`、`std::thread::Builder::new` 或 `tokio::task::spawn_blocking` 调用之前没有 `#[cfg(test)]`、`#[cfg(not(madsim))]` 或 `#[cfg(not(all(feature = "simulation", madsim)))]` 属性。
- **规则 5**：DST 路径中对迭代顺序敏感的文件使用 `AHashMap` 或 `AHashSet`。强制检查覆盖两个已审计文件：`crates/live/src/execution/manager.rs` 和 `crates/execution/src/matching_engine/engine.rs`；完整文件集合仍在审计。
- **规则 6**：直接调用绕过 `vibe_network::net` 的 `tokio::net::TcpStream::connect` / `tokio::net::TcpListener::bind`。该适配层在普通构建中重新导出 `tokio::net` 类型，在启用 `turmoil` 功能时替换为 `turmoil::net`，使所有 TCP 入口共享一个受 cfg 控制的替换点。
- **规则 7**：madsim 构建路径的生产代码直接使用 `tokio::{time,task,runtime,signal}` 路径。调用方应通过 `vibe_common::live::dst` 路由这些模块；门面定义、进程级真实 Tokio 运行时和测试基础设施属于明确例外。

钩子支持两种例外形式：

- 在特定行添加内联 `// dst-ok` 标记，通常附带简短原因，例如只用于日志、不影响状态的墙上时钟计时。
- 在钩子脚本中维护一个小型文件级允许列表，记录代码库审计中判定为无需改动的位置，例如缓存模块的日志计时、日志桥接和写入器的记录时间戳，以及 DeFi 模块的进度报告。

测试文件、`tests/`、`python/`、`ffi/` 目录下的文件，以及内联 `#[cfg(test)]` 模块中的行均被排除，因为它们不属于 DST 路径。

### 范围内的 crate

钩子适用于 17 个工作区 crate：`vibe-live` 传递依赖闭包中的 16 个 crate（`analysis`、`common`、`core`、`cryptography`、`data`、`execution`、`indicators`、`live`、`model`、`network`、`persistence`、`portfolio`、`risk`、`serialization`、`system` 和 `trading`），再加上 `backtest`。

适配器 crate 和基础设施 crate（Redis、Postgres）不在范围内。它们进入 DST 路径前，需要另行审计 DST 适用性。

## 网络种子压力测试

[Turmoil](https://github.com/tokio-rs/turmoil) 在带种子的调度器下模拟网络，使 `vibe-network` 传输测试可以探索 madsim 运行时替换无法触及的链路与重连顺序。测试分两层运行：

- 固定种子测试在夜间测试套件中运行，覆盖连接、重连、网络分区、重连期间关闭、退避期间关闭，以及以可复现种子重复断开服务器的场景。
- 一个默认忽略的重连压力测试会持续遍历 Turmoil 种子，直到被停止或完成 `VIBE_TURMOIL_SOAK_COUNT` 个种子。启用 `transport-sockudo` 时，每个种子先运行 Tungstenite WebSocket 后端，再运行 Sockudo 后端，使两者经历相同的调度搜索路径。

运行持续压力测试：

```bash
scripts/soak-network-turmoil.sh
```

运行有界压力测试：

```bash
env VIBE_TURMOIL_SOAK_COUNT=100 scripts/soak-network-turmoil.sh
```

`VIBE_TURMOIL_SOAK_START` 设置首个种子，可从上一次停止的位置继续遍历。每个种子中，Turmoil 会随机安排节点运行顺序，并把链路延迟随机设置在 1 ms 至 25 ms 之间；测试场景则反复断开服务器，让客户端经历各重连状态，并断言应用消息的精确顺序。压力测试不启用 Turmoil `fail_rate`：对 TCP 而言，该选项会在没有重传模型的情况下断开链路，从而夸大顺序保持测试中的客户端交付保证。

Turmoil 测试使用模拟网络且不局限于 Linux，因此 macOS 等平台也能遍历种子。部分真实 localhost 套接字和 WebSocket 单元测试为保证 CI 稳定性而使用 `target_os = "linux"`，所以在 macOS 运行不会覆盖这些主机 TCP 路径。只有在 Linux CI 或 Linux 工作站运行后，才能认为网络测试集完整覆盖。

## 实现说明

以下是 DST 审计产生的具体变更。检查代码路径是否属于 DST 路径以及如何路由时，应从此处开始。

### 迭代顺序适配层

以下生产位置使用 `IndexMap` / `IndexSet` 而不是 `AHashMap` / `AHashSet`，因为其迭代顺序在 DST 路径上可观察：

- **撮合引擎**（`crates/execution/src/matching_engine/engine.rs`）：十个字段（`execution_bar_types`、`execution_bar_deltas`、`account_ids`、`cached_filled_qty`、`bid_consumption`、`ask_consumption`、`queue_ahead_orders`、`queue_ahead_total`、`queue_excess`、`queue_pending`）。迭代期间删除使用 `.shift_remove()`。关闭 #3914（源 issue #3914）。
- **对账管理器**（`crates/live/src/execution/manager.rs`）：由钩子强制检查；`ReconciliationResult` 报告映射（`orders`、`fills`）在 `crates/execution/src/reconciliation/types.rs` 中使用 `IndexMap`。
- **账户 trait**（`crates/model/src/accounts/`）：`balances`、`balances_total`、`balances_free`、`balances_locked`、`starting_balances` 的返回值。`BaseAccount` 和 `MarginAccount` 的余额与保证金存储字段使用 `IndexMap`；`commissions` 和 `leverages` 仍使用 `AHashMap`。
- **持仓事件**（`crates/model/src/position.rs`）：`Position::commissions`，由 `events/position/snapshot.rs` 中的 `.values()` 消费。
- **投资组合聚合**（`crates/portfolio/src/portfolio.rs`）：`unrealized_pnls`、`realized_pnls`、`net_positions` 存储；`accumulate_mark_values` 构建 `IndexMap<Currency, Decimal>`。
- **数据引擎**（`crates/data/src/engine/`）：`book_snapshot_counts`、`bar_aggregators`、`BookSnapshotInfos`。迭代期间删除使用 `.shift_remove()`。
- **执行引擎**（`crates/execution/src/engine/`）：`ExecutionEngine.clients`，以及 `get_clients_for_orders()` 中的 `client_ids` / `venues` 累加器。
- **回测引擎和交易所**（`crates/backtest/src/engine.rs`、`crates/backtest/src/exchange.rs`）：`BacktestEngine.venues` 和 `SimulatedExchange.matching_engines` 会保留交易场所与金融工具迭代顺序，用于结算、到期、强平和带种子的 `FillModel` 取值（#4480（源 issue #4480））。
- **交易算法**（`crates/trading/src/algorithm/core.rs`）：`strategy_event_handlers`，负责按序驱动 `msgbus::unsubscribe_*` 扇出。
- **分析器**（`crates/analysis/src/analyzer.rs`）：`account_balances`、`account_balances_starting`。
- **缓存 API**（`crates/common/src/cache/mod.rs`）：`get_orders_for_ids` 和 `get_positions_for_ids` 返回前按 `client_order_id` / `position_id` 对 `Vec` 排序。存储仍使用 `AHashSet`（集合语义）。
- **金融工具存储**（`crates/common/src/providers.rs`）：`InstrumentStore.instruments`，因为 Betfair、Derive 和 Polymarket 适配器会直接按 `get_all()` / `list_all()` 的条目逐个发布 `DataEvent::Instrument`。继续使用 `ahash` 哈希器。
- **订单模拟器**（`crates/execution/src/order_emulator/emulator.rs`）：`on_reset` 会在 `msgbus::unsubscribe_*` 扇出之前，对排空的 `subscribed_quotes`、`subscribed_trades` 和 `subscribed_strategies` 排序。报价和成交路径还会推进带种子的 `UUID4::new` 取值序列。存储仍使用 `AHashSet`。
- **WebSocket 订阅**（`crates/network/src/websocket/subscription.rs`）：`topics_from_map` 对返回的 `Vec` 排序，从而固定 `all_topics()` 背后的重连重放顺序。存储仍使用值为 `AHashSet` 的 `DashMap`。

原始 `vibe-live` 闭包中其余 `AHashMap` / `AHashSet` 位置只用于查询、位于并发共享所有权包装器（`Arc<DashMap>`、`AtomicMap`）之后，或参与满足交换律的聚合。`backtest` 仍保留规则 5 双文件强制范围之外的其他哈希集合，包括运行前验证和结果映射。在逐条路径完成审计前，其迭代顺序不属于静态保证。

### 时间适配层

DST 路径上保留的 `Instant::now` / `SystemTime::now` 调用点，要么位于 `#[cfg(test)]` 中、列入钩子文件允许列表，要么带有说明原因的内联 `// dst-ok` 标记：

- `crates/common/src/testing.rs`：`wait_until` / `wait_until_async` 计时器。
- `crates/execution/src/engine/mod.rs`：`load_cache` 中的初始化日志计时。
- `crates/common/src/cache/mod.rs`：`check_integrity` 和 `audit_own_order_books` 中的计时（文件允许列表）。
- `crates/model/src/defi/reporting.rs`：进度日志（文件允许列表）。
- `crates/core/src/time.rs`：适配层定义位置（文件允许列表）。

钩子禁止范围内 crate 使用 `jiff::Timestamp::now` 和 `jiff::Zoned::now`。其余时间戳调用点位于日志桥接和写入器中，已在[日志运行在真实 OS 线程上](#日志运行在真实-os-线程上)排除。`crates/core/src/datetime.rs::is_within_last_24_hours` 经 `vibe_core::time::nanos_since_unix_epoch()` 路由，并直接用 `u64` 纳秒值比较。

### 随机性适配层

DST 路径中的生产 RNG 位置：

- `crates/core/src/uuid.rs::UUID4::new()` 在模拟中的 madsim 运行时内调用时，经 `madsim::rand::thread_rng()` 路由；在运行时之外以及普通构建中，回退到 `rand::rng()`。模拟中的生产路径始终在运行时内，因此会消费带种子的字节；`cfg(madsim)` 下的普通 `#[rstest]` 测试使用主机 RNG。`vibe-common` 和 `vibe-risk` 中的订单与事件工厂可以触达该路径。
- `crates/execution/src/models/fill.rs::default_std_rng()` 采用相同路由。未提供种子时由 `ProbabilisticFillState::new()` 调用；提供种子时，`StdRng::seed_from_u64` 按构造即具有确定性。
- `crates/execution/src/matching_engine/ids_generator.rs` 在 `use_random_ids` 路径的持仓和交易场所订单 ID 生成器中使用 `vibe_core::UUID4::new()`。不使用该路径时，默认 ID 方案（`{venue}-{raw_id}-{count}`）本身具有确定性。

一个位置带有标记：`crates/network/src/backoff.rs` 中用于重连退避的抖动采样，因属于传输层而标记 `// dst-ok`。

### Tokio 子模块拆分

`madsim` 为 `time`、`task`、`runtime` 和 `signal` 提供别名。其他 `tokio` 子模块（`sync`、`io`、`select!`、`fs`、`net`）在模拟时仍使用真实 `tokio`。进一步扩大替换范围需要针对垫片化的 `tokio::net::TcpStream` 重新构建 `tokio-tungstenite`、`tokio-rustls` 和 `reqwest`，审计认为这种方式侵入性过强。

范围内直接接触真实 `tokio::net` / `tokio::io` 的位置：

- `crates/network/src/net.rs` 重新导出 `tokio::net::{TcpListener, TcpStream}`。
- `crates/network/src/socket/client.rs` 使用 `tokio::io::{AsyncReadExt, AsyncWriteExt}`。
- `crates/network/src/tls.rs` 使用 `tokio::io::{AsyncRead, AsyncWrite}`。
- `crates/network/src/socket/types.rs` 通过 `tokio::io::{ReadHalf, WriteHalf}` 为 `MaybeTlsStream<TcpStream>` 定义拆分后的两端；TCP 类型本身经 `crate::net` 适配层获得。

即使在模拟中，这些路径也使用真实套接字。`tokio::sync` 的通道交付顺序仍具有确定性，因为尽管通道实现真实存在，发送方和接收方任务都由 madsim 执行器调度。

### 原始线程逃逸规则

钩子规则 4 禁止在以下三种例外之外生成原始线程：

- `#[cfg(test)]` 测试模块。
- `#[cfg(not(madsim))]` 或 `#[cfg(not(all(feature = "simulation", madsim)))]` 生产位置（例如日志写入器线程）。
- 内联 `// dst-ok` 标记。

`madsim` 不支持 `tokio::task::LocalSet` 和 `tokio::task::spawn_blocking`。代码库审计未在范围内 crate 发现这两者的生产调用点；新增位置必须带 cfg 条件或 `// dst-ok` 标记。

### 模拟中的日志测试

模拟时通过 cfg 排除日志写入器线程；在 `cfg(madsim)` 下，日志事件会被丢弃。初始化文件日志写入器的测试可能挂起，或对空日志文件进行断言，因此受影响的子模块在模块边界被排除：

- `crates/common/src/logging/logger.rs::tests::serial_tests`。
- `crates/common/src/logging/macros.rs::tests`。

`logger.rs::tests::sim_tests::test_init_under_madsim_skips_writer_thread_and_forces_bypass` 在模拟中运行，用于固定这一受 cfg 控制的行为。

## 范围边界

该契约有意保持狭窄。下列限制都是明确边界，而非疏漏。

### Python 和 FFI 不在 DST 范围内

DST 在原生 Rust 测试工具中运行，期间不会启动 Python 解释器。`crates/*/src/python/` 下的 PyO3 绑定、`crates/core/src/ffi/` 和 `crates/model/src/ffi/` 下的 Rust FFI 模块，以及 `python/vibe_trader/` 下的 Python 包均不属于契约。只能经这些绑定触达的代码不在范围内；原生 DST 测试工具能够触达的任何 Rust 路径都必须满足契约，即使同一类型也经绑定导出。

`check-dst-conventions` 钩子通过跳过范围内 crate 的 `/python/` 和 `/ffi/` 路径来落实该策略。这些路径之后的时钟、RNG 和线程调用点不受契约约束。

DST 的首要目标是保障 Rust 引擎本身的可靠性，包括订单生命周期、对账、撮合、风险和执行状态机。确定性重放用户策略是次要目标，而且仅适用于使用 Rust 编写或由 Rust 原生测试工具驱动的策略。调用 `time.time()`、发起任意网络请求或依赖线程调度的 Python 策略，其命令流可能在多次运行间变化；Rust 核心会确定性地处理每次收到的流，但不保证从 Python 入口端到端重放。

### 平台限定

`madsim` 在 libc 层对 `clock_gettime` 和 `getrandom` 的替换与平台相关。本契约不声称跨平台逐位可复现。在 Linux x86_64 上复现故障的种子，可能无法在 macOS aarch64 上复现。

### 未使用别名的依赖会悄然逃逸

任何经未使用别名的路径访问 OS 的依赖（直接 `libc` 调用、绕过适配层的 `std::net`、使用 `fastrand` 或 `OsRng` 的 crate），都会在不报错的情况下逃离模拟器。范围内 crate 已完成审计；适配器和基础设施 crate 进入 DST 路径前仍需各自审计。

### 不模拟传输层 I/O

`tokio-tungstenite`、`tokio-rustls`、`reqwest`、`redis` 和 `sqlx` 内部使用真实 `tokio`。模拟时，WebSocket 和 HTTP I/O 仍运行在真实网络上。这是有意为之：初始目标是订单生命周期确定性，而不是传输故障注入。实现传输层确定性需要目前不存在的逐 crate `madsim` 垫片。

驱动真实 localhost 套接字的测试模块（`crates/network/src/socket/client.rs::tests`、`::rust_tests`；`crates/network/src/websocket/client.rs::tests`、`::rust_tests`；`crates/network/tests/websocket_proxy.rs`）在 `all(feature = "simulation", madsim)` 下通过 cfg 排除，因为其生产代码路径会使用 `dst::time::*`（madsim 时间原语），而从 `#[tokio::test]` 运行时调用这些原语会 panic。重试测试模块（`crates/network/src/retry.rs::tests`、`::proptest_tests`）会在模拟中运行：每个测试属性通过 `cfg_attr` 在 `#[tokio::test(start_paused = true)]` 和 `#[madsim::test]` 之间切换；时间读取和休眠经 `crate::dst::time` 路由；显式推进虚拟时间则经 `cfg` 控制的 `advance_clock` 函数完成，使同一测试体覆盖两个运行时。

### 信号处理

`vibe_common::live::dst::signal` 公开已路由的 `ctrl_c` 和 `terminate` 重新导出。`crates/live/src/node/mod.rs` 的运行循环经它们路由，因此在 `cfg(madsim)` 下，测试代码可以通过 `madsim::runtime::Handle::send_ctrl_c` 注入由 `ctrl_c` 驱动的节点关闭。适配器二进制入口仍直接调用 `tokio::signal::ctrl_c`，因此不在范围内。

### 日志运行在真实 OS 线程上

日志子系统通过 `std::thread::Builder` 生成写入器线程，并使用 `std::sync::mpsc`。模拟时不生成该线程，日志事件会被丢弃。日志输出不属于确定性契约：写入器只写数据，从不读取或改变模拟状态。

### 适配器

适配器 crate 不在范围内。不同适配器各自包含直接访问时钟、RNG 和传输层的调用点（`jiff::Timestamp::now`、`jiff::Zoned::now`、`SystemTime::now`、原始传输客户端）。适配器进入 DST 路径前，必须审计这些调用点，契约才能覆盖其行为。

## 与其他测试层的关系

DST 补充现有测试，但不替代任何测试层。

| 测试层            | 覆盖内容                               | 与 DST 的关系                        |
| ----------------- | -------------------------------------- | ------------------------------------ |
| 单元测试          | 纯逻辑、计算、解析器、转换器。         | 不变。                               |
| 集成测试          | 组件交互、I/O 边界。                   | 不变。DST 与其并行运行，而非取代它。 |
| 属性测试          | 输入域上的不变量（解析器、往返转换）。 | 不变。                               |
| 验收测试          | 端到端回测和实盘情景。                 | 不变。                               |
| 确定性模拟（DST） | 异步时序、调度、恢复正确性。           | 增加可按种子重放的探索。             |

DST 的独特价值在于异步并发与状态机正确性的交集。它针对的缺陷包括"关闭期间，在特定唤醒顺序下丢失一条消息"或"迭代顺序反转时丢失一个对账事件"。其他问题应继续使用原有测试层处理。

## 状态

- 第 1 层（运行时替换）已实现。`vibe_common::live::dst` 为 `time`、`task`、`runtime` 和 `signal` 提供已路由的重新导出。`time`、`task` 和 `runtime` 的生产调用点已经过适配层路由；信号调用点仍只部分采用（参见[信号处理](#信号处理)）。
- 第 2 层（替换非确定性来源）已在范围内的 17 个 crate 实现，提供墙上时钟、单调时钟、随机性和迭代顺序适配层。[实现说明](#实现说明)列出已完成的审计闭包和剩余允许调用点。
- 预提交和 CI 已启用 `check-dst-conventions` 静态强制检查。钩子覆盖维持契约所必需的条件；`// dst-ok` 标记约定允许有充分理由的逐行例外。
- 端到端运行时验证（对范围内代码路径执行同种子差异比较）不属于本仓库范围。钩子强制满足结构条件；从适配层设计推断，同一种子应能在多次运行中复现相同可观察行为，但这一声明尚未由回归门验证。

### 模拟冒烟门

本地 `make cargo-test-sim` 门会在 `cfg(madsim)` 下以 `--features simulation` 构建 `vibe-common`、`vibe-core`、`vibe-network`、`vibe-execution` 和 `vibe-live`，再运行下列兼容模拟的测试分支。每个分支都使用自身 crate 的 `--features simulation`，适用时使用 `#[madsim::test]`，从而同时验证显式 cfg 分支和虚拟时间。`vibe-common` 和 `vibe-execution` 会使用 `vibe-model` 类型，因此还会分别以 `--features "simulation,high-precision"` 运行第二个分支，在两种定点宽度下（`QuantityRaw` 和 `PriceRaw` 分别使用 `u64` 与 `u128`）执行经适配层路由的代码路径。

该门覆盖：

- 所有兼容模拟的 `vibe-common` 测试。此分支在编译时传播 `vibe-core/simulation`，因此测试套件中的每项测试都会选择显式 `wall_clock_now` cfg 分支。普通 `#[rstest]` 测试在 madsim 运行时之外运行，经适配层的 `SystemTime::now()` 回退路径处理；该路径与 madsim libc 垫片在运行时之外使用的路径相同。`LiveClock` 测试模块通过 cfg 排除，因为其中的普通 `#[rstest]` 用例会在没有 madsim 运行时的情况下启动 `LiveTimer` 任务，而且多数用例还会等待真实墙上时钟推进。`live::dst::tests::test_dst_wall_clock_advances_with_virtual_time` 使用 `#[madsim::test]`，并断言 `nanos_since_unix_epoch` 会随 `madsim::time::sleep` 推进，因此该分支端到端验证虚拟墙上时钟行为。
- `vibe-live` 启动对账超时回归测试。它在 madsim 运行时中验证待处理的批量状态请求会达到配置的超时、报告预期错误，并清理节点，而不是进入真实 Tokio 计时器。
- `vibe-network` 的全部测试，其中依赖传输的测试模块已在源码中排除。包括虚拟时间下休眠、超时和速率限制器的适配层固定测试，以及覆盖退避时序的重试套件。
- `vibe-execution` 的全部测试。这些是普通 `#[rstest]` 用例，因此会编译并执行撮合引擎、成交模型和执行引擎状态机中受 cfg 控制的分支，但不会进入 madsim 运行时；`default_std_rng()` 此时采用主机 RNG 回退。
- `vibe-core` 中跨 crate 的适配层固定测试（`wall_clock_now` 虚拟时间）。

确定性调度器覆盖来自 `vibe-common`、`vibe-core`、`vibe-network` 和 `vibe-live` 中的 `#[madsim::test]` 用例。整个门可以发现受 cfg 控制的 DST 适配层发生漂移，但不验证端到端确定性。

## 延伸阅读

- `.pre-commit-hooks/check_dst_conventions.sh` 完整定义七项强制规则，并记录 `// dst-ok` 标记约定。
- [FoundationDB 测试理念](https://apple.github.io/foundationdb/testing.html)。
- [TigerBeetle 模拟测试系列博客](https://tigerbeetle.com/blog/)。
- [madsim 仓库](https://github.com/madsim-rs/madsim)，确定性运行时。
- [Turmoil 仓库](https://github.com/tokio-rs/turmoil)，确定性网络模拟器。
