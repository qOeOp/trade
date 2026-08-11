# 编写策略（Rust）

策略在 Actor 的基础上增加订单管理能力。本指南将逐步构建一个最小策略：订阅报价并提交市价订单。请先阅读[编写 Actor（Rust）](write_rust_actor.md)。

策略概念与订单管理的背景知识参见[策略](../concepts/strategies.md)和 [Rust](../concepts/rust.md) 概念指南。

## 定义结构体

策略保存一个 `StrategyCore` 字段，用于运行时接线。普通策略逻辑不直接访问该字段，而应使用 `self` 上的门面方法。

```rust
use vibe_common::actor::DataActor;
use vibe_model::{
    data::QuoteTick,
    enums::OrderSide,
    identifiers::{InstrumentId, StrategyId},
    types::Quantity,
};
use vibe_trading::{vibe_strategy, strategy::{Strategy, StrategyConfig, StrategyCore}};

pub struct MyStrategy {
    core: StrategyCore,
    instrument_id: InstrumentId,
    trade_size: Quantity,
}
```

## 实现构造函数

`StrategyConfig` 接收 `strategy_id` 与 `order_id_tag`。该标签会附加到此策略生成的全部客户订单 ID，避免多个策略交易同一金融工具时发生 ID 冲突。

```rust
impl MyStrategy {
    pub fn new(instrument_id: InstrumentId) -> Self {
        let config = StrategyConfig {
            strategy_id: Some(StrategyId::from("MY_STRAT-001")),
            order_id_tag: Some("001".to_string()),
            ..Default::default()
        };
        Self {
            core: StrategyCore::new(config),
            instrument_id,
            trade_size: Quantity::from("1.0"),
        }
    }
}
```

## 连接核心并实现调试

`vibe_strategy!` 宏会生成注册所需的原生运行时接线与 `Strategy` trait 实现。默认委托给名为 `core` 的字段；若字段名不同，可传入第二个参数。该宏不会让策略或其 `StrategyCore` 解引用到运行时内部结构。它还会添加 `config()`，返回传给 `StrategyCore::new` 的 `StrategyConfig`。

运行时注册使用 `Actor` 与 `Component` 的 blanket 实现，这些实现要求原生接线与 `Debug`。宏提供原生接线；`Debug` 则需手动实现或通过 derive 生成。

```rust
vibe_strategy!(MyStrategy);

impl std::fmt::Debug for MyStrategy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MyStrategy").finish()
    }
}
```

## 实现 DataActor trait

数据处理方式与 Actor 相同：在 `on_start` 中订阅，在处理器中响应。

```rust
impl DataActor for MyStrategy {
    fn on_start(&mut self) -> anyhow::Result<()> {
        self.subscribe_quotes(self.instrument_id, None, None);
        Ok(())
    }

    fn on_quote(&mut self, quote: &QuoteTick) -> anyhow::Result<()> {
        let order = self.order().market(
            self.instrument_id,
            OrderSide::Buy,
            self.trade_size,
            None, None, None, None, None, None, None,
        );
        self.submit_order(order, None, None, None)?;
        Ok(())
    }
}
```

`self.order()` 用于构建订单与订单列表。可用方法包括：

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
- `generate_client_order_id`
- `generate_order_list_id`

宏生成的 `Strategy` trait 实现使 `self` 可以直接调用 `submit_order`。

## Native 运行时访问

策略逻辑应使用公共门面：

- `clock()`
- `cache()`
- `order()`
- `portfolio()`
- `strategy_id()`
- `Strategy` 订单管理方法

普通策略代码不会导入 `DataActorNative` 或 `StrategyNative`，也不会调用以下原生句柄：

- `core()`
- `core_mut()`
- `strategy_core()`
- `strategy_core_mut()`
- `order_factory()`
- `order_factory_rc()`
- `portfolio_rc()`

这些原生句柄会暴露借用的运行时状态，因此只应留在引擎、runtime、注册逻辑、PyO3、testkit 或明确对延迟敏感的原生代码中。[Rust 原生 trait](../concepts/rust.md#native-traits)一节给出了适用性矩阵及以下方法表：

- [`DataActorNative` 方法](../concepts/rust.md#dataactornative-methods)
- [`StrategyNative` 方法](../concepts/rust.md#strategynative-methods)

## 重写 Strategy hook

如需重写 `Strategy` trait 方法（例如订单或持仓事件处理器），请在代码块中传入这些方法。宏会自动生成内部接线；`DataActor` 处理器仍应放在独立的 `impl DataActor` 块中。

```rust
vibe_strategy!(MyStrategy, {
    fn on_order_rejected(&mut self, event: OrderRejected) {
        log::warn!("Order rejected: {}", event.reason);
    }
});
```

## 订单管理方法

`Strategy` trait 提供以下门面方法：

| 方法                  | 操作                         |
| --------------------- | ---------------------------- |
| `submit_order`        | 向交易场所提交新订单。       |
| `submit_order_list`   | 提交条件订单列表。           |
| `modify_order`        | 修改价格、数量或触发价格。   |
| `modify_orders`       | 修改同一金融工具的多个订单。 |
| `cancel_order`        | 取消特定订单。               |
| `cancel_orders`       | 取消一组已过滤的订单。       |
| `cancel_all_orders`   | 取消金融工具的所有订单。     |
| `close_position`      | 使用市价单平仓。             |
| `close_all_positions` | 关闭所有未平持仓。           |

## 完整示例

- [`EmaCross`](https://github.com/qOeOp/trade/tree/main/crates/trading/src/examples/strategies/ema_cross)：集成指标的双 EMA 交叉策略。
- [`GridMarketMaker`](https://github.com/qOeOp/trade/tree/main/crates/trading/src/examples/strategies/grid_mm)：支持可配置档位与重新报价的网格做市策略。
