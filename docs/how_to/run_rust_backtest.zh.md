# 运行回测（Rust）

Vibe 提供两套 Rust 回测 API：低级 `BacktestEngine`，以及支持从数据目录流式加载数据的高级 `BacktestNode`。本指南会介绍两者。

回测概念、成交模型与撮合引擎行为参见[回测](../concepts/backtesting/)概念指南；项目配置与功能标志参见 [Rust](../concepts/rust.md#project-setup) 概念指南。

## 依赖项

将以下内容添加到 `Cargo.toml`。只有高级 `BacktestNode` API 需要 `streaming` 与 `vibe-persistence` 条目。

```toml
[dependencies]
vibe-backtest = { version = "0.61", features = ["streaming"] }
vibe-execution = "0.61"
vibe-model = { version = "0.61", features = ["stubs"] }
vibe-persistence = "0.61"
vibe-trading = { version = "0.61", features = ["examples"] }

ahash = "0.8"
anyhow = "1"
tempfile = "3"
ustr = "1"
```

如果只需要低级 `BacktestEngine`，请移除 `streaming`、`vibe-persistence`、`tempfile` 和 `ustr`。

## BacktestEngine（低级 API）

低级 API 提供直接控制：构建引擎、添加交易场所与金融工具、把数据加载到内存、注册策略，然后运行。

### 1. 创建引擎

```rust
use vibe_backtest::{config::BacktestEngineConfig, engine::BacktestEngine};

let mut engine = BacktestEngine::new(BacktestEngineConfig::default())?;
```

### 2. 添加交易场所

`SimulatedVenueConfig` 使用 `bon::Builder`：只需设置必填字段，其余设置均采用文档所述的默认值。`build()` 会验证配置并返回 `ConfigResult`，因此需要向上传播错误或显式解包。

```rust
use vibe_backtest::config::SimulatedVenueConfig;
use vibe_model::{
    enums::{AccountType, BookType, OmsType},
    identifiers::Venue,
    types::Money,
};

engine.add_venue(
    SimulatedVenueConfig::builder()
        .venue(Venue::from("SIM"))
        .oms_type(OmsType::Hedging)
        .account_type(AccountType::Margin)
        .book_type(BookType::L1_MBP)
        .starting_balances(vec![Money::from("1_000_000 USD")])
        .build()?,
)?;
```

可以通过链式 setter 覆盖任意默认值，例如 `.reject_stop_orders(false)` 或 `.allow_cash_borrowing(true)`。

### 3. 添加金融工具和数据

```rust
use vibe_model::instruments::{
    Instrument, InstrumentAny, stubs::audusd_sim,
};

let instrument = InstrumentAny::CurrencyPair(audusd_sim());
let instrument_id = instrument.id();
engine.add_instrument(&instrument)?;

let quotes = generate_quotes(instrument_id); // Your data loading function
engine.add_data(quotes, None, true, true)?;
```

### 4. 注册策略并运行

```rust
use vibe_model::types::Quantity;
use vibe_trading::examples::strategies::EmaCross;

let strategy = EmaCross::new(
    instrument_id,
    Quantity::from("100000"),
    10, // fast EMA period
    20, // slow EMA period
);

engine.add_strategy(strategy)?;
engine.run(None, None, None, false)?;
```

### 运行完整示例

```bash
cargo run -p vibe-backtest --features examples --example engine-ema-cross
```

来源：[`crates/backtest/examples/engine_ema_cross.rs`](https://github.com/qOeOp/trade/tree/main/crates/backtest/examples/engine_ema_cross.rs)

## BacktestNode（高级 API）

高级 API 从 `ParquetDataCatalog` 加载数据，并按可配置的块大小流式传输。它要求为 `vibe-backtest` 启用 `streaming` feature。

### 1. 将数据写入数据目录

```rust
use vibe_model::instruments::{
    Instrument, InstrumentAny, stubs::audusd_sim,
};
use vibe_persistence::backend::catalog::ParquetDataCatalog;
use tempfile::TempDir;

let instrument = InstrumentAny::CurrencyPair(audusd_sim());
let instrument_id = instrument.id();
let quotes = generate_quotes(instrument_id);

let temp_dir = TempDir::new()?;
let catalog_path = temp_dir.path().to_str()
    .context("temp dir path is not valid UTF-8")?
    .to_string();
let catalog = ParquetDataCatalog::new(
    temp_dir.path(), None, None, None, None,
);

catalog.write_instruments(vec![instrument])?;
catalog.write_to_parquet(&quotes, None, None, None)?;
```

### 2. 配置运行

```rust
use vibe_backtest::config::{
    BacktestDataConfig, BacktestRunConfig, BacktestVenueConfig, VibeDataType,
};
use vibe_model::enums::{AccountType, BookType, OmsType};

let venue_config = BacktestVenueConfig::builder()
    .name("SIM")
    .oms_type(OmsType::Hedging)
    .account_type(AccountType::Margin)
    .book_type(BookType::L1_MBP)
    .starting_balances(vec!["1_000_000 USD".to_string()])
    .build()?;

let data_config = BacktestDataConfig::builder()
    .data_type(VibeDataType::QuoteTick)
    .catalog_path(catalog_path)
    .instrument_id(instrument_id)
    .build()?;

let run_config = BacktestRunConfig::builder()
    .id("ema-cross-run".to_string())
    .venues(vec![venue_config])
    .data(vec![data_config])
    .chunk_size(100)
    .build()?;
```

### 3. 构建节点、添加策略并运行

```rust
use vibe_backtest::node::BacktestNode;
use vibe_model::types::Quantity;
use vibe_trading::examples::strategies::EmaCross;

let mut node = BacktestNode::new(vec![run_config])?;
node.build()?;

let engine = node.get_engine_mut("ema-cross-run")
    .context("engine not found for run config ID")?;
let strategy = EmaCross::new(
    instrument_id,
    Quantity::from("100000"),
    10,
    20,
);
engine.add_strategy(strategy)?;

node.run()?;
```

### 运行完整示例

```bash
cargo run -p vibe-backtest --features examples,streaming --example node-ema-cross
```

来源：[`crates/backtest/examples/node_ema_cross.rs`](https://github.com/qOeOp/trade/tree/main/crates/backtest/examples/node_ema_cross.rs)
