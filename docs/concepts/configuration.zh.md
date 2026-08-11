# 配置

VibeTrader 在整个平台中使用强类型配置结构体。每个组件（数据客户端、执行客户端、引擎和策略）都有专用的配置结构体来控制其行为。

## 设计原则

### 默认值在配置边界解析

对于始终存在合理默认值的字段，配置结构体直接保存具体值。超时时间、重试次数、退避延迟和心跳间隔都使用 `u64` 或 `u32` 等普通类型，并内置默认值。下游代码接收已经解析的值，无需重复实现默认值逻辑。

### Option 表示语义上的缺省，而不是"使用默认值"

仅当 `None` 具有实际语义时才使用 `Option<T>` 字段：功能已关闭、回看窗口没有边界，或运行时从环境继承该值。如果字段最终总会解析为具体值，就不会将其包装在 `Option` 中。

这种区分让配置语义直接体现在类型中。普通 `u64` 字段始终有值；`Option<u64>` 字段则可能缺省，使用该字段的代码会据此分支处理。

### 默认值的单一事实来源

每个配置结构体都使用 `bon::Builder`，通过 `#[builder(default = value)]` 注解在唯一位置定义默认值。`Default` 实现委托给构建器（`Self::builder().build()`），因此不会存在另一份可能与其不同步的默认值副本。

### 配置解码在未知字段上失败

配置解码遇到未知字段时会快速失败。Vibe 将多余的键视为错误，而不是无害输入。这样可以在节点或客户端以错误设置启动之前，捕获拼写错误、配置重命名后遗留的旧名称以及复制粘贴错误。

## Python 配置

从 `vibe_trader.config` 导入核心配置类型；从适配器的公共模块导入适配器配置，例如 `vibe_trader.adapters.bybit`。

大多数运行时配置类都是 Rust 配置结构体的 PyO3 包装器。构造函数参数中的 `None` 会根据字段含义解析为 Rust 默认值，或保留为可选值。只读属性公开已经解析且不含秘密信息的值。固定配置类收到不支持的关键字时会抛出 `TypeError`。`DataActorConfig`、`StrategyConfig` 和 `ExecutionAlgorithmConfig` 等可扩展组件配置允许 Python 子类添加额外字段。由 Python 实现的分析配置仍保持其文档所述的 dataclass 行为。

```python
from vibe_trader.adapters.bybit import BybitDataClientConfig

# All defaults: 60s timeout, 3 retries, etc.
config = BybitDataClientConfig()

# Override just the timeout
config = BybitDataClientConfig(http_timeout_secs=30)

# Read back the resolved value
assert config.http_timeout_secs == 30
```

## Rust 配置

所有配置结构体都派生 [`bon::Builder`](https://bon-rs.com)，由它生成类型安全的构建器，并在编译时检查必填字段。带有 `#[builder(default = value)]` 的字段可以在构建器调用中省略，此时会使用声明的默认值。以下三种配置构造方式等价：

使用 Serde 反序列化的 Rust 配置结构体还会设置 `#[serde(deny_unknown_fields)]`。未知键会导致反序列化失败，而不会被忽略。

```rust
// Builder: only set what differs from defaults
let config = BybitDataClientConfig::builder()
    .http_timeout_secs(30)
    .build();

// Struct literal with default spread
let config = BybitDataClientConfig {
    http_timeout_secs: 30,
    ..Default::default()
};

// Full defaults
let config = BybitDataClientConfig::default();
```

对于未指定的字段，这三种方式会产生相同结果。

## 通用配置字段

大多数适配器配置共享一组通用字段：

| 字段                               | 类型  | 默认值 | 用途                 |
| ---------------------------------- | ----- | ------ | -------------------- |
| `http_timeout_secs`                | `u64` | 60     | REST 请求超时时间。  |
| `max_retries`                      | `u32` | 3      | 最大重试次数。       |
| `retry_delay_initial_ms`           | `u64` | 1,000  | 初始退避延迟。       |
| `retry_delay_max_ms`               | `u64` | 10,000 | 最大退避延迟。       |
| `heartbeat_interval_secs`          | `u64` | 各异   | WebSocket 保活间隔。 |
| `recv_window_ms`                   | `u64` | 各异   | 签名请求的有效窗口。 |
| `update_instruments_interval_mins` | 各异  | 各异   | 定期刷新金融工具。   |

适配器特有的字段（速率限制、轮询间隔和保证金模式）记录在各适配器的集成指南中。

## 引擎配置

引擎配置（`LiveExecEngineConfig`、`DataEngineConfig` 等）遵循相同模式。`reconciliation`、`inflight_check_interval_ms` 和 `open_check_threshold_ms` 等字段使用带构建器默认值的普通类型。真正可选的功能则使用 `Option<T>`：

```python
from vibe_trader.config import LiveExecEngineConfig

config = LiveExecEngineConfig(
    reconciliation=True,
    open_check_interval_secs=30.0,  # Enable open order polling
    open_check_lookback_mins=60,  # Look back 60 minutes
    # position_check_interval_secs=None  # Disabled by default
)
```
