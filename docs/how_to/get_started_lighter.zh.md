# Lighter 入门

Lighter 由 Rust 引擎提供。既可以在纯 Rust 项目中使用，也可以通过 PyO3 绑定在 Python 中使用；这些绑定会向 Python `LiveNode` 暴露相同的 Rust 数据客户端与执行客户端。

最短路径是先接入公共数据。确认数据订阅正常后，再添加执行凭据，最后接入能够提交订单的策略。

## 选择接入路径

| 路径     | 适用场景                                 | 第一步                   |
| :------- | :--------------------------------------- | :----------------------- |
| 纯 Rust  | 需要不依赖 Python 运行时的编译型应用。   | 复制 Rust 快速入门。     |
| Python   | 希望通过 Python 脚本使用 Rust 引擎。     | 运行 Python 数据测试器。 |
| RWA 示例 | 需要 Databento 信号数据与 Lighter 交易。 | 阅读组合式做市教程。     |

从这些文件开始：

- Rust 快速入门：`examples/quickstarts/lighter-rust-data-client/`。
- Python 数据测试器：`examples/live/lighter/data_tester.py`。
- RWA 教程：[组合式做市教程][lighter-rwa-composite-mm]。

Rust 与 Python 两条路径都使用以下组件：

- `LighterDataClientConfig` 选择主网或测试网，并配置可选的传输设置。
- `LighterExecClientConfig` 添加交易者/账户 ID，并解析凭据。
- `LighterDataClientFactory` 与 `LighterExecutionClientFactory` 向 `LiveNode` 注册客户端。
- `DataTester` 与 `ExecTester` 提供冒烟测试 Actor，便于在编写自定义策略前验证接线。

## 纯 Rust 起步示例

将快速入门复制到您自己的工作区中：

```bash
cp -R examples/quickstarts/lighter-rust-data-client ~/lighter-rust-data-client
cd ~/lighter-rust-data-client
cargo run
```

该示例会构建 `LiveNode`、注册 Lighter 数据客户端、添加 `DataTester`，并连接测试网公共数据流。按 Ctrl+C 可停止运行。

核心配置使用 builder，由其自动补齐可选项的默认值：

```rust
let data_config = LighterDataClientConfig::builder()
    .environment(LighterEnvironment::Testnet)
    .build();

let mut node = LiveNode::builder(trader_id, Environment::Live)?
    .with_name("LIGHTER-DATA-STARTER-001".to_string())
    .add_data_client(
        None,
        Box::new(LighterDataClientFactory::new()),
        Box::new(data_config),
    )?
    .build()?;
```

确认数据路径正常后，在调用 `.build()` 前向 builder 添加执行客户端：

```rust
let exec_config = LighterExecClientConfig::builder()
    .trader_id(trader_id)
    .account_id(account_id)
    .environment(LighterEnvironment::Testnet)
    .build();

let mut node = LiveNode::builder(trader_id, Environment::Live)?
    .with_name("LIGHTER-EXEC-STARTER-001".to_string())
    .add_data_client(
        None,
        Box::new(LighterDataClientFactory::new()),
        Box::new(data_config),
    )?
    .add_exec_client(
        None,
        Box::new(LighterExecutionClientFactory::new()),
        Box::new(exec_config),
    )?
    .build()?;
```

如需执行交易，请在连接前设置对应环境变量：

```bash
export LIGHTER_TESTNET_ACCOUNT_INDEX="123456"
export LIGHTER_TESTNET_API_KEY_INDEX="0"
export LIGHTER_TESTNET_API_SECRET="your-lighter-api-secret"
```

主网使用 `LIGHTER_ACCOUNT_INDEX`、`LIGHTER_API_KEY_INDEX` 和 `LIGHTER_API_SECRET`。

## Python 入门

Python 通过 PyO3 使用 Rust 引擎。请在源码检出目录之外安装 Python 开发版 wheel，或先从源码构建软件包，再运行这些示例。参见 [Python 安装][python-install]。

从安装了 Python 的存储库根目录：

```bash
.venv/bin/python examples/live/lighter/data_tester.py --lighter-environment testnet
```

该命令只构建节点，然后退出。传入 `--run` 才会连接：

```bash
.venv/bin/python examples/live/lighter/data_tester.py \
    --lighter-environment testnet \
    --instrument BTC-PERP.LIGHTER \
    --run
```

Python 脚本采用与 Rust 相同的配置：

```python
builder = LiveNode.builder(
    "LIGHTER-DATA-TESTER-001",
    TraderId.from_str("TESTER-001"),
    Environment.LIVE,
).add_data_client(
    None,
    LighterDataClientFactory(),
    LighterDataClientConfig(environment=LighterEnvironment.TESTNET),
)
```

仅在数据测试器正常工作后，才使用执行测试器：

```bash
.venv/bin/python examples/live/lighter/exec_tester.py \
    --lighter-environment testnet \
    --instrument DOGE-PERP.LIGHTER
```

与数据测试器一样，该命令默认只构建节点并退出。先传入 `--run` 以 dry-run 模式连接，再添加 `--live-orders` 才会提交真实订单。

## 转向策略

这些起步路径用于验证客户端接线、订阅与凭据查找。下一步是用策略替换测试器：

- 编写纯 Rust 策略时，参见[编写策略（Rust）](write_rust_strategy.md)。
- 使用 `examples/live/lighter/nvda_composite_mm.py` 完成 Python 节点接线，并调用内置的 Rust `CompositeMarketMaker` 策略。
- 需要完整 Databento 信号配置时，参见 [Lighter RWA 组合式做市][lighter-rwa-composite-mm]。

:::warning
将 `DRY_RUN` 设为 `false` 后，Rust 执行示例可以提交真实订单；Python 执行示例在传入 `--run --live-orders` 后也可以提交真实订单。请先在测试网上运行，或使用交易场所接受的最小下单量，并在运行前确认金融工具、环境、账户索引、API 密钥索引与私钥。
:::

紧急清理时，可运行 `cargo run --bin lighter-flatten -p vibe-lighter`，取消所配置 Lighter 账户的未结订单并平仓。使用前务必审查该工具：它会扫描整个账户，在标准每分钟 60 次请求的配额下可能耗时数分钟；若账户敞口覆盖更多策略或市场，其影响也会超出单一策略或市场。

[lighter-rwa-composite-mm]: ../tutorials/lighter_rwa_composite_mm.md
[python-install]: ../getting_started/installation.md#build-the-python-package
