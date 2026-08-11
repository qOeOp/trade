# Rust

Vibe 在 `crates/` 目录下提供完整的 Rust 实现。无需 Python，即可编写参与者和策略、运行回测并进行实盘交易。所有路径共享同一个领域模型；v2 PyO3 路径会直接在 Rust 引擎上运行 Python 策略。

:::warning
Rust API 正在积极开发中，各版本之间的方法签名和 trait 要求可能发生变化。
:::

## 系统实现

Vibe 有三种实现。了解各自的现状，有助于为具体用例选择合适路径。

- **v1 legacy**：`vibe_trader/` 下的 Cython/Python 类。功能最完整，组件覆盖范围最广。
- **v2 Rust**：`crates/` 下的纯 Rust 实现，无需 Python 即可运行。
- **v2 PyO3**：通过 PyO3 绑定，让 Python 用户组件（参与者、策略）运行在 Rust 核心上，兼具 Python 的便利性和 Rust 引擎的性能。

### 能力矩阵

| 组件            | v1 legacy（Cython） | v2 Rust | v2 PyO3（Python on Rust） |
| --------------- | ------------------- | ------- | ------------------------- |
| Strategy        | ✓                   | ✓       | ✓                         |
| Actor           | ✓                   | ✓       | ✓                         |
| DataEngine      | ✓                   | ✓       | ✓                         |
| ExecutionEngine | ✓                   | ✓       | ✓                         |
| RiskEngine      | ✓                   | ✓       | ✓                         |
| BacktestEngine  | ✓                   | ✓       | ✓                         |
| BacktestNode    | ✓                   | ✓       | ✓                         |
| LiveNode        | ✓                   | ✓       | ✓                         |
| OrderEmulator   | ✓                   | ✓       | ✓                         |
| 撮合引擎        | ✓                   | ✓       | ✓                         |
| Portfolio       | ✓                   | ✓       | ✓                         |
| 账户            | ✓                   | ✓       | ✓                         |
| Cache           | ✓                   | ✓       | ✓                         |
| MessageBus      | ✓                   | ✓       | ✓                         |
| 数据目录        | ✓                   | ✓       | ✓                         |
| 指标            | ✓                   | ✓       | ✓                         |
| 执行算法        | TWAP                | TWAP    | TWAP                      |
| Controller      | ✓                   | -       | ✓                         |
| 绩效报告        | ✓                   | -       | ✓                         |
| 配置序列化      | ✓                   | -       | -                         |

### 适配器

| 适配器              | v1 legacy（Cython） | v2 Rust | v2 PyO3 |
| ------------------- | ------------------- | ------- | ------- |
| Architect AX        | ✓                   | ✓       | ✓       |
| Betfair             | ✓                   | ✓       | ✓       |
| Binance             | ✓                   | ✓       | ✓       |
| BitMEX              | ✓                   | ✓       | ✓       |
| Blockchain          | -                   | ✓       | ✓       |
| Bybit               | ✓                   | ✓       | ✓       |
| Coinbase            | -                   | ✓       | ✓       |
| Databento           | ✓                   | ✓       | ✓       |
| Deribit             | ✓                   | ✓       | ✓       |
| Derive              | -                   | ✓       | ✓       |
| dYdX                | ✓                   | ✓       | ✓       |
| Hyperliquid         | ✓                   | ✓       | ✓       |
| Interactive Brokers | ✓                   | ✓       | ✓       |
| Kraken              | ✓                   | ✓       | ✓       |
| Lighter             | -                   | ✓       | ✓       |
| OKX                 | ✓                   | ✓       | ✓       |
| Polymarket          | ✓                   | ✓       | ✓       |
| Sandbox             | ✓                   | ✓       | ✓       |
| Tardis              | ✓                   | ✓       | ✓       |

### 路径选择

- **v1 legacy** 是当前最完整的实现。如果需要 Controller 或配置序列化，应使用此路径。
- **v2 Rust** 无需 Python 运行时即可提供原生性能，支持全部核心交易功能。它适合对延迟敏感的部署，或偏好编译型语言的团队。
- **v2 PyO3** 让 Python 用户组件（参与者、策略）运行在 Rust 核心引擎上：数据处理和执行采用 Rust 性能，同时保留 Python 编写体验。

## 项目设置

Vibe crate 是未公开发布的内部工作区包。工作区成员应从根 `Cargo.toml` 继承这些依赖；外部实验项目可以显式固定仓库：

```toml
[dependencies]
vibe-backtest = { git = "https://github.com/qOeOp/trade.git", branch = "main" }
vibe-common = { git = "https://github.com/qOeOp/trade.git", branch = "main" }
vibe-execution = { git = "https://github.com/qOeOp/trade.git", branch = "main" }
vibe-model = { git = "https://github.com/qOeOp/trade.git", branch = "main", features = ["stubs"] }
vibe-trading = { git = "https://github.com/qOeOp/trade.git", branch = "main", features = ["examples"] }

anyhow = "1"
log = "0.4"
```

实盘交易还需添加 live crate 和对应交易场所的适配器：

```toml
[dependencies]
vibe-live = "0.61"
vibe-okx = "0.61"
```

如需跟踪最新开发分支，应将所有 Vibe 依赖指向同一个 git 源，以免 crates.io 与 git 版本之间出现类型不匹配：

```toml
[dependencies]
vibe-backtest = { git = "https://github.com/qOeOp/trade.git", branch = "main" }
vibe-common = { git = "https://github.com/qOeOp/trade.git", branch = "main" }
vibe-execution = { git = "https://github.com/qOeOp/trade.git", branch = "main" }
vibe-model = { git = "https://github.com/qOeOp/trade.git", branch = "main", features = ["stubs"] }
vibe-trading = { git = "https://github.com/qOeOp/trade.git", branch = "main", features = ["examples"] }
```

最低支持的 Rust 版本（MSRV）为 **1.97.1**。

### 功能标志

| 标志             | Crate           | 作用                                           |
| ---------------- | --------------- | ---------------------------------------------- |
| `high-precision` | `vibe-model`    | 16 位定点精度（默认为 9 位），加密货币必需。   |
| `stubs`          | `vibe-model`    | 测试金融工具桩（`audusd_sim` 等）。            |
| `examples`       | `vibe-trading`  | 示例策略（`EmaCross`、`GridMarketMaker`）。    |
| `streaming`      | `vibe-backtest` | 通过 `BacktestNode` 执行基于目录的数据流处理。 |
| `defi`           | `vibe-model`    | DeFi 数据类型，并隐式启用 `high-precision`。   |

:::tip
标准的 9 位精度可以处理大多数传统金融工具。对于价格可能包含很多小数位的加密货币交易场所（例如 `0.00000001`），应启用 `high-precision`。
:::

### 内存分配器

Linux 和 Windows 上的 `vibe` CLI 与 Python wheel 使用 [mimalloc](https://crates.io/crates/mimalloc) 进行 Rust 内存分配。macOS Python wheel 使用系统分配器，以保持与嵌入自有分配器的 Python 包兼容。Rust 二进制文件自行选择分配器；如需保持一致，可添加 mimalloc：

```toml
[dependencies]
mimalloc = "0.1"
```

```rust
use mimalloc::MiMalloc;

#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;
```

默认系统分配器同样可用，但会显著降低回测吞吐量，Windows 上尤其明显，其分配器开销可能达到热循环运行时间的一半。背景信息请参阅[架构指南](architecture.md#memory-allocation)。

## 参与者

参与者接收市场数据、自定义数据/信号和系统事件，但不管理订单。实现 `DataActor` trait，并使用 `vibe_actor!` 将 `DataActorCore` 字段接入运行时契约。类型应实现或派生 `Debug`；宏会生成原生运行时连接。用户代码通常使用 `DataActor` 门面方法来订阅、访问缓存和访问时钟。

### 处理程序方法

覆写 `DataActor` trait 中的任意处理程序，即可接收相应数据或事件。所有处理程序都有默认的空操作实现，因此只需覆写实际需要的方法。

| 处理程序               | 接收内容              |
| ---------------------- | --------------------- |
| `on_start`             | 参与者已启动。        |
| `on_stop`              | 参与者已停止。        |
| `on_quote`             | `QuoteTick`           |
| `on_trade`             | `TradeTick`           |
| `on_bar`               | `Bar`                 |
| `on_book_deltas`       | `OrderBookDeltas`     |
| `on_book`              | `OrderBook`（按间隔） |
| `on_instrument`        | `InstrumentAny`       |
| `on_mark_price`        | `MarkPriceUpdate`     |
| `on_index_price`       | `IndexPriceUpdate`    |
| `on_funding_rate`      | `FundingRateUpdate`   |
| `on_option_greeks`     | `OptionGreeks`        |
| `on_option_chain`      | `OptionChainSlice`    |
| `on_instrument_status` | `InstrumentStatus`    |
| `on_order_filled`      | `OrderFilled`         |
| `on_order_canceled`    | `OrderCanceled`       |
| `on_time_event`        | `TimeEvent`           |

分步说明请参阅[编写参与者（Rust）](../how_to/write_rust_actor.md)操作指南。完整示例请参阅 [`BookImbalanceActor`](https://github.com/qOeOp/trade/tree/main/crates/trading/src/examples/actors/imbalance)。

## 策略

策略在参与者基础上增加订单管理能力。实现 `DataActor` 以处理数据，并使用 `vibe_strategy!` 将 `StrategyCore` 字段接入策略运行时契约。`StrategyCore` 保存策略运行时状态；常规策略逻辑通过 `self` 上的门面方法访问它。运行时注册需要宏生成的原生连接，但常规策略逻辑使用 `Strategy` 方法和 `self` 上的门面方法。

### 订单管理

`Strategy` trait 通过门面提供订单方法：

| 方法                  | 操作                       |
| --------------------- | -------------------------- |
| `submit_order`        | 向交易场所提交新订单。     |
| `submit_order_list`   | 提交一组条件订单。         |
| `modify_order`        | 修改价格、数量或触发价格。 |
| `cancel_order`        | 取消指定订单。             |
| `cancel_orders`       | 取消筛选后的订单集合。     |
| `cancel_all_orders`   | 取消某金融工具的全部订单。 |
| `close_position`      | 使用市价订单平掉一个持仓。 |
| `close_all_positions` | 平掉所有未平持仓。         |

`OrderApi`（通过 `self.order()` 访问）用于构建订单和订单列表：

- `generate_client_order_id`
- `generate_order_list_id`
- `market`
- `limit`
- `stop_market`
- `stop_limit`
- `market_to_limit`
- `market_if_touched`
- `limit_if_touched`
- `trailing_stop_market`
- `trailing_stop_limit`
- `bracket`
- `create_list`

### 核心连接宏

Rust 参与者、策略和执行算法把运行时核心保存为结构体字段。以下宏用于告诉 trait 该字段的位置。

| 宏                                         | 核心字段                 | 生成内容                  |
| ------------------------------------------ | ------------------------ | ------------------------- |
| `vibe_actor!(Type)`                        | `DataActorCore`          | 运行时连接。              |
| `vibe_strategy!(Type)`                     | `StrategyCore`           | 运行时连接和 `Strategy`。 |
| `vibe_execution_algorithm!(Type, { ... })` | `ExecutionAlgorithmCore` | 运行时连接和算法。        |

这些宏默认查找名为 `core` 的字段；如有需要，可通过第二个参数传入字段名。它们不会让参与者、策略或 `StrategyCore` 解引用到运行时内部结构。执行算法宏接收一个 `on_order()` 实现块，因为该方法定义算法必须具备的订单处理逻辑。常规代码使用以下门面方法：

- `actor_id()`
- `trader_id()`
- `is_registered()`
- `config()`
- `strategy_id()`
- `clock()`
- `cache()`
- `order()`
- `portfolio()`

### 原生 trait

默认应使用门面方法：

- `actor_id()`
- `trader_id()`
- `is_registered()`
- `config()`
- `strategy_id()`
- `clock()`
- `cache()`
- `order()`
- `portfolio()`

`DataActorNative`、`StrategyNative` 和 `ExecutionAlgorithmNative` 用于访问门面之下的原生接口。本节面向引擎、运行时以及明确对延迟敏感的原生 Rust 代码，而不是可移植的常规编写路径。

| 编写路径               | 是否使用原生 trait | 常规 API                         |
| ---------------------- | ------------------ | -------------------------------- |
| 原生 Rust 二进制文件   | 仅在需要时         | `Strategy` 和 `DataActor` 门面。 |
| 从 Python 启动的 Rust  | 仅在需要时         | 与原生 Rust 相同。               |
| 使用 Python 编写的组件 | 否                 | 仅使用门面。                     |

原生 trait 会公开借用的核心状态、`Rc<RefCell<_>>` 和运行时引用。只有当原生 Rust 代码为明确的延迟敏感路径有意接受这些借用规则时，才应使用它们。引擎、运行时、注册、PyO3 和 testkit 代码在需要访问参与者核心、策略核心或执行算法核心时，可以导入 `DataActorNative`、`StrategyNative` 或 `ExecutionAlgorithmNative`。普通的可移植参与者、策略、执行算法逻辑或 Python 编写的组件不应使用它们，因为这些类型不会跨越 Python 边界。

`ExecutionAlgorithmCore` 拥有一个 `DataActorCore`，但不会解引用为后者。常规执行算法逻辑应使用 `id()`、`actor_id()`、`trader_id()`、`clock()` 和 `cache()`。只有代码需要原生执行算法状态时才使用 `ExecutionAlgorithmNative`。

应选择最小的原生句柄，并限制每次借用的作用域。常规策略订单构建使用 `order()`；只有原生代码需要直接可变借用工厂时，才使用 `order_factory()`。

#### `DataActorNative` 方法

| 原生方法      | 返回形式                 | 适用情形               |
| ------------- | ------------------------ | ---------------------- |
| `core()`      | `&DataActorCore`         | 读取参与者内部状态。   |
| `core_mut()`  | `&mut DataActorCore`     | 修改参与者内部状态。   |
| `clock_mut()` | `RefMut<'_, dyn Clock>`  | 需要时钟的可变借用。   |
| `clock_rc()`  | `Rc<RefCell<dyn Clock>>` | 存储或传递共享时钟。   |
| `cache_ref()` | `Ref<'_, Cache>`         | 需要短期读取实盘缓存。 |
| `cache_rc()`  | `Rc<RefCell<Cache>>`     | 修改、存储或传递缓存。 |

#### `StrategyNative` 方法

| 原生方法              | 返回形式                    | 适用情形                 |
| --------------------- | --------------------------- | ------------------------ |
| `strategy_core()`     | `&StrategyCore`             | 读取策略内部状态。       |
| `strategy_core_mut()` | `&mut StrategyCore`         | 修改策略内部状态。       |
| `order_factory()`     | `RefMut<'_, OrderFactory>`  | 需要工厂的直接可变借用。 |
| `order_factory_rc()`  | `Rc<RefCell<OrderFactory>>` | 存储或传递工厂。         |
| `portfolio_rc()`      | `Rc<RefCell<Portfolio>>`    | 存储或传递投资组合。     |

#### `ExecutionAlgorithmNative` 方法

| 原生方法                    | 返回形式                      | 适用情形               |
| --------------------------- | ----------------------------- | ---------------------- |
| `exec_algorithm_core()`     | `&ExecutionAlgorithmCore`     | 读取执行算法内部状态。 |
| `exec_algorithm_core_mut()` | `&mut ExecutionAlgorithmCore` | 修改执行算法内部状态。 |

分步说明请参阅[编写策略（Rust）](../how_to/write_rust_strategy.md)操作指南。完整示例请参阅 [`EmaCross`](https://github.com/qOeOp/trade/tree/main/crates/trading/src/examples/strategies/ema_cross) 和 [`GridMarketMaker`](https://github.com/qOeOp/trade/tree/main/crates/trading/src/examples/strategies/grid_mm)。

### 运行 Rust 组件

Rust 策略和参与者可以通过两种路径运行。以下示例使用策略，但相同模式也适用于通过 `add_actor`（纯 Rust）和 `add_builtin_actor`（从 Python）添加的内置参与者。

#### 纯 Rust

使用 Rust 编写策略和 `main` 函数，再通过 `cargo build` 构建独立二进制文件。此路径不需要 Python 运行时。

```rust
let strategy = GridMarketMaker::new(config);
node.add_strategy(strategy)?;
node.run().await?;
```

完整说明请参阅[运行 Rust 实盘交易](../how_to/run_rust_live_trading.md)。

#### 从 Python 使用内置示例

向 `add_builtin_strategy` 传入类型名称和配置，即可从 Python 注册内置示例策略。该路径旨在让 Rust 和 Python 的文档、示例及测试共用同一份内置示例策略代码，不是添加原生策略的正式扩展路径。自定义原生组件应使用纯 Rust。

```python
from vibe_trader.trading import GridMarketMakerConfig

config = GridMarketMakerConfig(
    instrument_id=InstrumentId.from_str("BTC-USDT-SWAP.OKX"),
    max_position=Quantity.from_str("10.0"),
    trade_size=Quantity.from_str("0.1"),
    num_levels=5,
    grid_step_bps=15,
)

node.add_builtin_strategy("GridMarketMaker", config)
```

内置策略配置：

| 配置                         | 策略                   |
| ---------------------------- | ---------------------- |
| `CompositeMarketMakerConfig` | `CompositeMarketMaker` |
| `DeltaNeutralVolConfig`      | `DeltaNeutralVol`      |
| `EmaCrossConfig`             | `EmaCross`             |
| `ExecTesterConfig`           | `ExecTester`           |
| `GridMarketMakerConfig`      | `GridMarketMaker`      |
| `HurstVpinDirectionalConfig` | `HurstVpinDirectional` |

`add_builtin_actor` 对示例和测试使用的参与者遵循相同的"仅限内置组件"规则。

内置参与者配置（通过 `add_builtin_actor`）：

| 配置                       | 参与者               |
| -------------------------- | -------------------- |
| `BookImbalanceActorConfig` | `BookImbalanceActor` |
| `DataTesterConfig`         | `DataTester`         |

## 回测

两种 API 的带注释分步说明，请参阅[运行回测（Rust）](../how_to/run_rust_backtest.md)操作指南。

### `BacktestEngine`（底层 API）

构建引擎，添加交易场所和金融工具，加载数据，注册策略，然后运行。完整可运行示例：

```bash
cargo run -p vibe-backtest --features examples --example engine-ema-cross
```

源代码：
[`crates/backtest/examples/engine_ema_cross.rs`](https://github.com/qOeOp/trade/tree/main/crates/backtest/examples/engine_ema_cross.rs)

### `BacktestNode`（高层 API）

从 `ParquetDataCatalog` 加载数据，并支持以可配置的分块大小进行流式处理。需要为 `vibe-backtest` 启用 `streaming` 功能。完整可运行示例：

```bash
cargo run -p vibe-backtest --features examples,streaming --example node-ema-cross
```

源代码：
[`crates/backtest/examples/node_ema_cross.rs`](https://github.com/qOeOp/trade/tree/main/crates/backtest/examples/node_ema_cross.rs)

## 实盘交易

带注释的分步说明请参阅[运行 Rust 实盘交易](../how_to/run_rust_live_trading.md)操作指南。

`LiveNode` 通过适配器客户端连接真实交易场所和数据源。构建器模式用于配置数据与执行客户端，随后由 `run()` 启动异步事件循环。每个适配器都有自己的工厂和配置类型。

| 适配器              | 示例                                            |
| ------------------- | ----------------------------------------------- |
| Architect AX        | `crates/adapters/architect_ax/examples/`        |
| Betfair             | `crates/adapters/betfair/examples/`             |
| Binance             | `crates/adapters/binance/examples/`             |
| BitMEX              | `crates/adapters/bitmex/examples/`              |
| Blockchain          | `crates/adapters/blockchain/examples/`          |
| Bybit               | `crates/adapters/bybit/examples/`               |
| Coinbase            | `crates/adapters/coinbase/examples/`            |
| Databento           | `crates/adapters/databento/examples/`           |
| Deribit             | `crates/adapters/deribit/examples/`             |
| Derive              | `crates/adapters/derive/examples/`              |
| dYdX                | `crates/adapters/dydx/examples/`                |
| Hyperliquid         | `crates/adapters/hyperliquid/examples/`         |
| Interactive Brokers | `crates/adapters/interactive_brokers/examples/` |
| Kraken              | `crates/adapters/kraken/examples/`              |
| Lighter             | `crates/adapters/lighter/examples/`             |
| OKX                 | `crates/adapters/okx/examples/`                 |
| Polymarket          | `crates/adapters/polymarket/examples/`          |
| Sandbox             | `crates/adapters/sandbox/examples/`             |
| Tardis              | `crates/adapters/tardis/examples/`              |

大多数适配器都包含 `node_data_tester.rs` 和 `node_exec_tester.rs` 示例，用于针对实盘交易场所测试数据请求、流式处理和订单执行。

## 相关指南

- [编写参与者（Rust）](../how_to/write_rust_actor.md) - 参与者分步说明。
- [编写策略（Rust）](../how_to/write_rust_strategy.md) - 策略分步说明。
- [运行回测（Rust）](../how_to/run_rust_backtest.md) - BacktestEngine 和 BacktestNode 的用法。
- [运行 Rust 实盘交易](../how_to/run_rust_live_trading.md) - LiveNode 设置和交易场所连接。
- [架构](architecture.md) - 系统设计以及数据/执行流。
- [参与者](actors.md) - 参与者概念（同时适用于 Python 和 Rust）。
- [策略](strategies.md) - 策略概念和处理程序参考。
- [事件](events/) - 事件类型和处理程序分派。
- [回测](backtesting/) - 回测概念和撮合引擎行为。
