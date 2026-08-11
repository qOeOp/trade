# 运行实盘交易（Rust）

`LiveNode` 通过适配器客户端连接真实交易场所与数据源。本指南以 OKX 为例，介绍完整的实盘交易配置。

节点生命周期参见[实盘交易](../concepts/live.md)，命令结果参见[执行](../concepts/execution.md#command-outcomes)，状态恢复参见[执行对账](../concepts/reconciliation.md)；项目配置与功能标志参见 [Rust](../concepts/rust.md#project-setup) 概念指南。

## 依赖项

将 live crate、所需交易场所适配器及配套 crate 添加到 `Cargo.toml`：

```toml
[dependencies]
vibe-common = "0.61"
vibe-live = "0.61"
vibe-model = "0.61"
vibe-okx = "0.61"
vibe-trading = { version = "0.61", features = ["examples"] }

anyhow = "1"
dotenvy = "0.15"
log = "0.4"
tokio = { version = "1", features = ["full"] }
```

## 构建节点

`LiveNode` 使用 builder 模式。为目标交易场所添加数据客户端 factory 与执行客户端 factory，配置日志，然后构建节点。

```rust
use log::LevelFilter;
use vibe_common::{enums::Environment, logging::logger::LoggerConfig};
use vibe_live::node::LiveNode;
use vibe_model::identifiers::{AccountId, TraderId};
use vibe_okx::{
    common::enums::OKXInstrumentType,
    config::{OKXDataClientConfig, OKXExecClientConfig},
    factories::{OKXDataClientFactory, OKXExecutionClientFactory},
};

let trader_id = TraderId::from("TESTER-001");
let account_id = AccountId::from("OKX-001");

let data_config = OKXDataClientConfig::builder()
    .instrument_types(vec![OKXInstrumentType::Swap])
    .build();

let exec_config = OKXExecClientConfig::builder()
    .trader_id(trader_id)
    .account_id(account_id)
    .instrument_types(vec![OKXInstrumentType::Swap])
    .build();

let log_config = LoggerConfig {
    stdout_level: LevelFilter::Info,
    ..Default::default()
};

let mut node = LiveNode::builder(trader_id, Environment::Live)?
    .with_name("MY-NODE-001".to_string())
    .with_logging(log_config)
    .add_data_client(
        None,
        Box::new(OKXDataClientFactory::new()),
        Box::new(data_config),
    )?
    .add_exec_client(
        None,
        Box::new(OKXExecutionClientFactory::new()),
        Box::new(exec_config),
    )?
    .with_reconciliation(false) // Simplified; enable in production
    .with_delay_post_stop_secs(5)
    .build()?;
```

:::warning
为简化示例，这里禁用了对账。生产环境中应移除 `.with_reconciliation(false)`，使引擎在启动时将缓存状态与交易场所对齐。参见[执行对账](../concepts/reconciliation.md)。
:::

## 添加策略并运行

```rust
use vibe_model::{identifiers::InstrumentId, types::Quantity};
use vibe_trading::examples::strategies::{
    GridMarketMaker, GridMarketMakerConfig,
};

let mut config = GridMarketMakerConfig::builder()
    .instrument_id(InstrumentId::from("ETH-USDT-SWAP.OKX"))
    .max_position(Quantity::from("0.10"))
    .num_levels(3)
    .grid_step_bps(100)
    .skew_factor(0.5)
    .requote_threshold_bps(10)
    .expire_time_secs(8)
    .on_cancel_resubmit(true)
    .build();

// OKX rejects hyphens in client order IDs
config.base.use_hyphens_in_client_order_ids = false;

let strategy = GridMarketMaker::new(config);

node.add_strategy(strategy)?;
node.run().await?;
```

节点会持续运行，直至收到中断（Ctrl+C）或由程序主动关闭。

## 环境变量

OKX 从环境变量读取 API 凭据。可以配合 `dotenvy` 使用 `.env` 文件，也可以直接在 shell 中设置：

```bash
export OKX_API_KEY="your_api_key"
export OKX_API_SECRET="your_api_secret"
export OKX_API_PASSPHRASE="your_passphrase"
```

进行模拟交易时，请在两个配置 builder 上设置 `.environment(OKXEnvironment::Demo)`，并使用 OKX 模拟环境的 API 凭据。

各适配器所需变量均记录在对应交易场所的[集成指南](../integrations/)中。

## Async 运行时

`LiveNode::run()` 是异步函数，需要 Tokio runtime。请在主函数上使用 `#[tokio::main]`：

```rust
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    // ... node setup ...

    node.run().await?;
    Ok(())
}
```

## 适配器示例

大多数适配器都包含带有数据测试器和执行测试器的可运行示例：

| 适配器              | 示例目录                                        |
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
