# 配置实盘交易节点

配置 `LiveNode` 以连接实时市场。节点生命周期参见[实盘交易](../concepts/live.md)，命令结果参见[执行](../concepts/execution.md#command-outcomes)，状态恢复参见[执行对账](../concepts/reconciliation.md)。

:::danger[不建议使用 Jupyter 笔记本进行实盘交易]
不要在 Jupyter 笔记本中运行实盘交易节点。该节点在调用线程上拥有一个长时间运行的循环，并且笔记本生命周期控制使生产操作不安全：

- 单元格可能乱序运行，内核可能崩溃，状态也可能丢失。
- 笔记本缺乏生产交易所需的日志记录、监控和正常关闭。

使用 Jupyter 进行回测、分析和实验。对于实盘交易，将节点作为独立的 Python 脚本或服务运行。
:::

:::warning[每个进程只能运行一个 LiveNode]
由于存在全局单例状态，不支持在同一进程中并发运行多个 `LiveNode` 实例。可以把多个策略添加到同一个节点，也可以在独立进程中运行额外节点以实现并行执行。

详情参见[进程与线程](../concepts/architecture.md#processes-and-threads)。
:::

:::warning[不阻塞事件循环]
事件循环线程上的用户代码（策略回调、Actor 处理器和定时事件回调）必须快速返回；Python 与 Rust 均如此。模型推理、繁重计算或同步 I/O 等阻塞操作会导致漏处理成交、数据陈旧与订单提交延迟。请将耗时任务交给执行器，或放到独立线程/进程中执行。
:::

:::info[平台差异]
Windows 信号处理与类 Unix 系统不同。如果您在 Windows 上运行，请阅读有关[Windows 信号处理](#windows-信号处理)的注释，以获取有关正常关闭行为和 Ctrl+C (SIGINT) 支持的指导。
:::

## LiveNodeConfig

`LiveNodeConfig` 负责节点核心组件的设置。数据客户端与执行客户端应通过 `LiveNode.builder(...)` 注册，不要通过该配置中的客户端字典注册。配置默认值与 `Option<T>` 语义参见[配置](../concepts/configuration.md)概念指南。

```python
from vibe_trader.common import Environment
from vibe_trader.common import LogLevel
from vibe_trader.config import CacheConfig
from vibe_trader.config import LiveDataEngineConfig
from vibe_trader.config import LiveExecEngineConfig
from vibe_trader.config import LiveNodeConfig
from vibe_trader.config import LiveRiskEngineConfig
from vibe_trader.config import LoggerConfig
from vibe_trader.config import MessageBusConfig
from vibe_trader.config import PortfolioConfig
from vibe_trader.model import TraderId

config = LiveNodeConfig(
    environment=Environment.LIVE,
    trader_id=TraderId.from_str("MY-TRADER-001"),
    logging=LoggerConfig(stdout_level=LogLevel.INFO),
    cache=CacheConfig(),
    msgbus=MessageBusConfig(),
    data_engine=LiveDataEngineConfig(),
    risk_engine=LiveRiskEngineConfig(),
    exec_engine=LiveExecEngineConfig(),
    portfolio=PortfolioConfig(),
)
```

### 核心配置参数

| 设置                          | 默认值       | 说明                               |
| ----------------------------- | ------------ | ---------------------------------- |
| `trader_id`                   | "TRADER-001" | 唯一交易者标识符（名称标签格式）。 |
| `instance_id`                 | `None`       | 可选的唯一实例标识符。             |
| `timeout_connection_secs`     | 60.0         | 连接超时（以秒为单位）。           |
| `timeout_reconciliation_secs` | 30.0         | 对账超时（秒）。                   |
| `timeout_portfolio_secs`      | 10.0         | 投资组合初始化超时。               |
| `timeout_disconnection_secs`  | 10.0         | 断开连接超时。                     |
| `delay_post_stop_secs`        | 10.0         | 停止后残留事件的延迟。             |
| `timeout_shutdown_secs`       | 5.0          | 挂起任务关闭超时（以秒为单位）。   |

### 缓存数据库配置

Rust 原生实盘系统通过 `CacheConfig` 配置缓存行为，通过 `RedisCacheConfig` 配置 Redis 连接。

```rust
use vibe_common::{
    cache::{CacheConfig, database::CacheDatabaseFactory},
    enums::SerializationEncoding,
};
use vibe_infrastructure::redis::cache::RedisCacheConfig;

let config = CacheConfig {
    encoding: SerializationEncoding::MsgPack,
    timestamps_as_iso8601: true,
    buffer_interval_ms: Some(100),
    flush_on_start: false,
    ..Default::default()
};

let database = RedisCacheConfig {
    host: Some("localhost".to_string()),
    port: Some(6379),
    username: Some("vibe".to_string()),
    password: Some("pass".to_string()),
    connection_timeout: 2,
    response_timeout: 2,
    ..Default::default()
};

let cache_database = database
    .create(trader_id, instance_id, config.clone())
    .await?;
```

构建 Rust 原生节点后、启动节点前挂接适配器。启用 `exec_engine.load_cache`（默认值）时，节点会先恢复数据库，再执行对账。

```rust
let node_config = LiveNodeConfig {
    trader_id,
    ..Default::default()
};
let mut node = LiveNode::build("LiveNode".to_string(), Some(node_config))?;
node.set_cache_database(cache_database)?;
node.run().await?;
```

将 `CacheConfig.flush_on_start = true` 可设为清空所挂接的后端，而不是恢复其中的数据。Python `LiveNode` 尚不支持直接注入缓存后端。

### MessageBus 配置

消息总线行为由 `MessageBusConfig` 配置，Redis 连接由 `RedisMessageBusConfig` 配置。`RedisMessageBusFactory` 使用这些设置，通过 `MessageBusBackingFactory` 构建后端。

```rust
use vibe_common::{
    enums::SerializationEncoding,
    msgbus::{MessageBusBackingFactory, MessageBusConfig},
};
use vibe_infrastructure::redis::msgbus::{RedisMessageBusConfig, RedisMessageBusFactory};

let config = MessageBusConfig {
    encoding: SerializationEncoding::Json,
    timestamps_as_iso8601: true,
    use_instance_id: false,
    types_filter: Some(vec!["QuoteTick".to_string(), "TradeTick".to_string()]),
    stream_per_topic: false,
    autotrim_mins: Some(30),
    heartbeat_interval_secs: Some(1),
    ..Default::default()
};

let redis_config = RedisMessageBusConfig {
    connection_timeout: 2,
    response_timeout: 2,
    ..Default::default()
};

let backing = RedisMessageBusFactory::new(redis_config).create(
    trader_id,
    instance_id,
    config.clone(),
)?;
```

Python 通过 `LiveNodeBuilder` 注入同一个 Redis factory：

```python
from vibe_trader.common import Environment
from vibe_trader.common import MessageBusConfig
from vibe_trader.infrastructure import RedisMessageBusConfig
from vibe_trader.infrastructure import RedisMessageBusFactory
from vibe_trader.live import LiveNode
from vibe_trader.model import TraderId

trader_id = TraderId("TRADER-001")
message_bus = MessageBusConfig(
    external_streams=["external-stream"],
    stream_per_topic=False,
)
redis_config = RedisMessageBusConfig(
    host="localhost",
    port=6379,
)
node = (
    LiveNode.builder("LiveNode", trader_id, Environment.LIVE)
    .with_msgbus_config(message_bus)
    .with_external_msgbus_factory(RedisMessageBusFactory(redis_config))
    .build()
)
node.run()
```

仅配置 `MessageBusConfig` 并不会安装后端；必须像上例一样搭配工厂。工厂始终会安装外部出口，调用 `run()` 时也会消费已配置的外部流。节点启动前已存在于流中的条目不会重放。基于 `start()` 与 `poll()` 的宿主循环不会处理外部消息总线入口；配置了 `external_streams` 时应使用 `run()`。生命周期与入口详情参见[消息总线后端配置](../concepts/message_bus.md#backing-config)。

## 多交易场所配置

一个节点可以连接多个客户端。此示例在构建节点之前注册 Binance 现货和 USD‑M 期货数据客户端：

```python
from vibe_trader.adapters.binance import BinanceDataClientConfig
from vibe_trader.adapters.binance import BinanceDataClientFactory
from vibe_trader.adapters.binance import BinanceEnvironment
from vibe_trader.adapters.binance import BinanceProductType
from vibe_trader.common import Environment
from vibe_trader.live import LiveNode
from vibe_trader.model import TraderId

node = (
    LiveNode.builder(
        "BINANCE-MULTI-CLIENT-001",
        TraderId.from_str("MULTI-VENUE-001"),
        Environment.LIVE,
    )
    .add_data_client(
        "BINANCE_SPOT",
        BinanceDataClientFactory(),
        BinanceDataClientConfig(
            product_type=BinanceProductType.SPOT,
            environment=BinanceEnvironment.LIVE,
        ),
    )
    .add_data_client(
        "BINANCE_FUTURES",
        BinanceDataClientFactory(),
        BinanceDataClientConfig(
            product_type=BinanceProductType.USD_M,
            environment=BinanceEnvironment.LIVE,
        ),
    )
    .build()
)
```

## ExecutionEngine 配置

`LiveExecEngineConfig` 控制订单处理、执行事件与交易场所对账。完整说明参见 [API 参考](/docs/python-api-latest/live.html#vibe_trader.live.LiveExecEngineConfig)。

### 对账

恢复遗漏的订单与持仓事件，使系统状态与交易场所保持一致。

| 设置                            | 默认值 | 描述                                                  |
| ------------------------------- | ------ | ----------------------------------------------------- |
| `reconciliation`                | True   | 启动时启用对账，使内部状态与交易场所一致。            |
| `reconciliation_lookback_mins`  | None   | 为未缓存状态请求历史事件时向前回溯的分钟数。          |
| `reconciliation_instrument_ids` | None   | 需要对账的金融工具 ID 列表。                          |
| `filtered_client_order_ids`     | None   | 对账时跳过的客户订单 ID（用于处理交易场所端重复项）。 |

详情参见[执行对账](../concepts/reconciliation.md)。

### 订单过滤

控制系统处理哪些订单事件和报告，防止交易节点之间发生冲突。

| 设置                               | 默认值 | 描述                                             |
| ---------------------------------- | ------ | ------------------------------------------------ |
| `filter_unclaimed_external_orders` | False  | 丢弃未被认领的外部订单，避免其影响策略。         |
| `filter_position_reports`          | False  | 丢弃持仓状态报告；多个节点交易同一账户时很有用。 |

:::note[订单标记行为]
对账会按订单来源添加标签：

- **`VENUE` 标签**：在交易场所发现、但由本系统之外提交的外部订单。
- **`RECONCILIATION` 标签**：为对齐持仓差异而生成的合成订单。

启用 `filter_unclaimed_external_orders` 后，只过滤带有 `VENUE` 标签的订单。带有 `RECONCILIATION` 标签的订单绝不会被过滤，因此持仓对齐始终可以完成。
:::

### 持续对账

持续对账会检查在途订单、轮询未结订单、核对持仓状态并审计自有订单簿，从而在启动后保持运行时执行状态一致。使用下列设置配置该循环。运行时状态转换规则、重试协调与注意事项参见[运行时检查](../concepts/reconciliation.md#runtime-checks)。

| 设置                                 | 默认值   | 说明                                                                                                          |
| ------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------- |
| `inflight_check_interval_ms`         | 2,000 ms | 检查在途订单状态的频率；设为 0 可禁用。                                                                       |
| `inflight_check_threshold_ms`        | 5,000 ms | 在途订单触发交易场所状态检查前的等待时间；若采用同地部署，可适当降低。                                        |
| `inflight_check_retries`             | 5 重试   | 向交易场所验证在途订单时的重试次数。                                                                          |
| `open_check_interval_secs`           | None     | 检查交易场所未结订单的频率（秒）；None 或 0.0 表示禁用。建议值：5-10 秒。                                     |
| `open_check_open_only`               | True     | 当 true 时，仅查询未平仓订单；如果为 false，则获取完整历史记录（资源密集型）。                                |
| `open_check_lookback_mins`           | 60 分钟  | 订单状态轮询的回溯窗口（分钟）。仅在此窗口内修改的订单。                                                      |
| `open_check_threshold_ms`            | 5,000 ms | 自上次缓存事件以来对交易场所差异采取行动之前的最短时间。                                                      |
| `open_check_missing_retries`         | 5 次重试 | 对于符合条件的订单，在未找到目标解决方案之前的最多重试次数。                                                  |
| `max_single_order_queries_per_cycle` | 10       | 每个周期的单订单查询上限。防止速率限制耗尽。                                                                  |
| `single_order_query_delay_ms`        | 100 ms   | 单订单查询之间的延迟 (ms)，以避免速率限制。                                                                   |
| `reconciliation_startup_delay_secs`  | 10.0 s   | 启动对账完成后、开始持续检查前的延迟（秒）。                                                                  |
| `own_books_audit_interval_secs`      | None     | 依据公开订单簿审计自有订单簿的间隔（秒）。                                                                    |
| `position_check_interval_secs`       | None     | 持仓一致性检查间隔（秒）。发现差异时查询遗漏成交；None 表示禁用。建议值：30-60 秒。                           |
| `position_check_lookback_mins`       | 60 分钟  | 用于查询持仓差异成交报告的回溯窗口（分钟）。                                                                  |
| `position_check_threshold_ms`        | 5,000 ms | 自上次本地活动后，对持仓差异采取行动前的最短等待时间。                                                        |
| `position_check_retries`             | 3 次重试 | 引擎停止重试某项差异前，每个金融工具/账户允许的最大尝试次数。超过后会记录错误，并停止主动对账，直至差异消失。 |

:::warning

- **`open_check_lookback_mins`**：不要减少到 60 分钟以下。短窗口会触发错误的"订单缺失"解决方案，因为订单超出了查询范围。
- **`open_check_threshold_ms`**：如果交易场所时间戳滞后于本地时钟，则增加，因此最近更新的订单不会过早标记为缺失。
- **`reconciliation_startup_delay_secs`**：生产中不要减少到10秒以下。该延迟使系统在启动协调后、连续检查开始之前稳定下来。

:::

### 附加选项

| 设置                               | 默认值 | 描述                                                                              |
| ---------------------------------- | ------ | --------------------------------------------------------------------------------- |
| `allow_overfills`                  | False  | 允许成交量超过订单数量（会记录警告）；对账与成交发生竞态时很有用。                |
| `generate_missing_orders`          | True   | 对账期间生成 LIMIT 订单以对齐持仓差异（策略 `EXTERNAL`、标签 `RECONCILIATION`）。 |
| `snapshot_positions_interval_secs` | None   | 持仓快照间隔（秒）。                                                              |
| `debug`                            | False  | 启用执行调试日志记录。                                                            |

### 内存管理

定期从内存缓存中清除已关闭订单、已平持仓与账户事件，使长时间运行或高频交易会话的内存占用保持有界。

| 设置                                   | 默认值 | 描述                                                     |
| -------------------------------------- | ------ | -------------------------------------------------------- |
| `purge_closed_orders_interval_mins`    | None   | 从内存中清除已关闭订单的频率（分钟）。建议：10-15 分钟。 |
| `purge_closed_orders_buffer_mins`      | None   | 订单关闭后至少保留多久才清除（分钟）。建议：60 分钟。    |
| `purge_closed_positions_interval_mins` | None   | 从内存中清除已平持仓的频率（分钟）。建议：10-15 分钟。   |
| `purge_closed_positions_buffer_mins`   | None   | 持仓关闭后至少保留多久才清除（分钟）。建议：60 分钟。    |
| `purge_account_events_interval_mins`   | None   | 从内存中清除账户事件的频率（分钟）。建议：10-15 分钟。   |
| `purge_account_events_lookback_mins`   | None   | 账户事件至少保留多久才清除（分钟）。建议：60 分钟。      |

设置任一间隔即可启用清理循环；不设置则不会调度或删除。每轮清理都委托给[缓存](../concepts/cache.md)中说明的缓存 API。

## 策略配置

完整参数列表参见 `StrategyConfig` [API 参考](/docs/python-api-latest/trading.html#vibe_trader.trading.StrategyConfig)。

### 标识

| 设置           | 默认值 | 说明                             |
| -------------- | ------ | -------------------------------- |
| `strategy_id`  | None   | 唯一策略标识符。                 |
| `order_id_tag` | None   | 附加到该策略订单 ID 的唯一标签。 |

### 订单管理

| 设置                        | 默认值 | 描述                                                                          |
| --------------------------- | ------ | ----------------------------------------------------------------------------- |
| `oms_type`                  | None   | [OMS 类型](../concepts/execution#oms-configuration)，用于持仓 ID 和订单处理。 |
| `use_uuid_client_order_ids` | False  | 使用 UUID4 值作为客户订单 ID。                                                |
| `external_order_claims`     | None   | 此策略声明负责其外部订单与对账活动的金融工具 ID。                             |
| `manage_contingent_orders`  | False  | 自动管理 OTO、OCO 与 OUO 条件订单。                                           |
| `manage_gtd_expiry`         | False  | 管理订单的 GTD 到期时间。                                                     |

通过 `strategy.config` 读取这些运行时设置；策略本身不会将其复制为直接属性。

## Windows 信号处理

`LiveNode` 会在 Rust 运行循环中处理 Ctrl+C (SIGINT)，并在 Unix 上处理 SIGTERM。Python 桥接层也会将 SIGINT 路由到同一关闭路径，使运行器与任务都能正常关闭。
