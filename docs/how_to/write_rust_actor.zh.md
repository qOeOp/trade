# 编写一个 Actor (Rust)

Actor 接收市场数据、自定义数据/信号与系统事件，但不负责管理订单。本指南将逐步构建一个 `SpreadMonitor`：订阅报价并记录买卖价差。

Actor、trait 与处理器调度的背景知识参见 [Actor](../concepts/actors.md) 和 [Rust](../concepts/rust.md) 概念指南。

## 定义结构体

Actor 拥有 `DataActorCore` 以及自身所需的状态。core 保存 Actor 的运行时状态；用户代码通常通过 `DataActor` 门面方法访问这些状态，例如：

- `clock()`
- `cache()`
- `config()`
- `actor_id()`
- `trader_id()`
- 订阅方法

```rust
use vibe_common::{vibe_actor, actor::{DataActor, DataActorConfig, DataActorCore}};
use vibe_model::{data::QuoteTick, identifiers::{ActorId, InstrumentId}};

pub struct SpreadMonitor {
    core: DataActorCore,
    instrument_id: InstrumentId,
}
```

## 实现构造函数

使用 Actor ID 创建 `DataActorConfig`，再传给 `DataActorCore::new`。配置字段采用带默认值的 `Option`，因此 `..Default::default()` 可以覆盖 Actor ID 之外的所有字段。

```rust
impl SpreadMonitor {
    pub fn new(instrument_id: InstrumentId) -> Self {
        let config = DataActorConfig {
            actor_id: Some(ActorId::from("SPREAD_MON-001")),
            ..Default::default()
        };
        Self {
            core: DataActorCore::new(config),
            instrument_id,
        }
    }
}
```

## 连接核心并实现调试

`vibe_actor!` 宏把 Actor 的 `DataActorCore` 字段接入运行时契约。默认委托给名为 `core` 的字段；若字段名不同，可传入第二个参数。普通回调不应调用生成的原生访问器，而应在 `self` 上使用 `DataActor` 门面方法。

运行时注册使用 `Actor` 与 `Component` 的 blanket 实现。宏负责原生运行时接线；`Debug` 则需手动实现或通过 derive 生成。

```rust
vibe_actor!(SpreadMonitor);

impl std::fmt::Debug for SpreadMonitor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SpreadMonitor").finish()
    }
}
```

## 实现 DataActor trait

重写处理器方法以接收数据。所有处理器都有默认的空操作实现，因此只需覆盖实际需要的方法。每个处理器都返回 `anyhow::Result<()>`。

```rust
impl DataActor for SpreadMonitor {
    fn on_start(&mut self) -> anyhow::Result<()> {
        self.subscribe_quotes(self.instrument_id, None, None);
        Ok(())
    }

    fn on_quote(&mut self, quote: &QuoteTick) -> anyhow::Result<()> {
        let spread = quote.ask_price.as_f64() - quote.bid_price.as_f64();
        log::info!("Spread: {spread:.5}");
        Ok(())
    }
}
```

通过 `DataActor` trait，可以直接在 `self` 上调用 `subscribe_quotes`。所有可用处理器参见[处理器表](../concepts/rust.md#handler-methods)。

## Native 运行时访问

默认使用公共 `DataActor` 门面。只有在门面方法无法满足明确的纯原生访问路径时，才添加 `DataActorNative`。门面提供以下只读属性：

- `config()`
- `actor_id()`
- `trader_id()`
- `is_registered()`

[Rust 原生 trait](../concepts/rust.md#native-traits)一节给出了原生 trait 的适用性矩阵及以下方法表：

- [`DataActorNative` 方法](../concepts/rust.md#dataactornative-methods)

这些类型不会跨越 Python 边界，因此可移植 Actor 应使用门面方法，例如：

- `clock()`
- `cache()`

## Actor注册

使用 `BacktestEngine`：

```rust
let actor = SpreadMonitor::new(instrument_id);
engine.add_actor(actor)?;
```

使用 `LiveNode`：

```rust
let actor = SpreadMonitor::new(instrument_id);
node.add_actor(actor)?;
```

## Guard 安全

系统向 Actor 分发消息时，会从注册表获取一个生命周期很短的 `ActorRef` guard。无需直接管理这些 guard。若回调代码需要访问其他 Actor，请遵循以下规则：

- 每次都按 ID 查找 Actor，不要缓存 `ActorRef`。
- 在作用域结束前释放 guard，绝不能把它存入字段。
- 绝不能跨越 `.await` 点持有 guard。

`DataActorCore` 上的订阅方法会捕获 Actor ID，并在回调闭包内执行查找，因此能够正确处理这一问题。完整的线程与注册表模型参见[运行时不变量](../developer_guide/rust.md#runtime-invariants)。

## 完整示例

更完整的示例参见 [`BookImbalanceActor`](https://github.com/qOeOp/trade/tree/main/crates/trading/src/examples/actors/imbalance)：它会跟踪每个金融工具的状态，并在停止时打印摘要。
