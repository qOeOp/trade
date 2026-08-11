# 执行测试规范

本节定义一套严格的测试矩阵，用于通过 Rust `ExecTester` 策略验证适配器执行功能。
Python 将其作为内置策略公开，并通过 `vibe_trader.testkit.ExecTesterConfig` 配置；
Rust 代码则从 `vibe_testkit::testers` 导入。每个测试用例都由带前缀的 ID 标识
（例如 TC-E01），并按功能分组。

**每个适配器都必须通过与其支持能力匹配的测试子集。**

测试从简单场景（单笔市价单）逐步发展到复杂场景（括号订单、修改链、拒绝处理）。
通过第 1-5 组测试的适配器可视为符合基线要求。应先使用[数据测试规范](spec_data_testing.md)
验证数据连接。

适配器专用行为（例如交易场所如何模拟市价单、处理 TIF 选项等）应记录在适配器自己的指南中，
而不是记录在此处。每份适配器指南都应包含能力矩阵，说明其支持哪些订单类型、有效期选项、
操作和标志。

## 前置条件

运行执行测试前：

- 具有有效 API 凭据的模拟/测试网账户（推荐，但非必需）。
- 账户中有足够保证金，可用于测试金融工具和数量。
- 目标金融工具可用，并可通过金融工具提供商加载。
- 已设置环境变量：`{VENUE}_API_KEY`、`{VENUE}_API_SECRET`（或沙盒变体）。
- 如果交易场所提供模拟/测试网模式，请使用为该环境创建的凭据。
  模拟与生产 API 密钥通常相互独立且不可互换；使用错误凭据会产生身份验证错误（例如 HTTP 401）。
- 绕过风险引擎（`LiveRiskEngineConfig(bypass=True)`），避免干扰。
- 启用对账，以验证状态一致性。

**Python 节点设置：**

旧版示例仍使用 `vibe_trader.live.node.TradingNode`，但当前由 Rust 支持的 PyO3 适配器使用
`vibe_trader.live.LiveNode`。需要在节点构建前注册适配器客户端工厂时，
请使用 `LiveNode.builder(...)`。

```python
from vibe_trader.common import Environment
from vibe_trader.config import LiveExecEngineConfig
from vibe_trader.config import LiveRiskEngineConfig
from vibe_trader.live import LiveNode
from vibe_trader.model import TraderId
from vibe_trader.testkit import ExecTesterConfig

node = (
    LiveNode.builder("TESTER-001", TraderId("TESTER-001"), Environment.SANDBOX)
    .with_risk_engine_config(LiveRiskEngineConfig(bypass=True))
    .with_exec_engine_config(LiveExecEngineConfig(reconciliation=True))
    .add_exec_client(None, adapter_exec_client_factory, exec_client_config)
    .build()
)

tester_config = ExecTesterConfig(
    instrument_id=instrument_id,
    client_id=client_id,
    order_qty=order_qty,
)
node.add_builtin_strategy("ExecTester", tester_config)
# Register remaining components, then start or run
```

**Rust 节点设置**（参考：`crates/adapters/{adapter}/examples/node_exec_tester.rs`）：

```rust
use vibe_testkit::testers::{ExecTester, ExecTesterConfig};
use vibe_trading::strategy::StrategyConfig;

let tester_config = ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(order_qty)
    .build()?;
let tester = ExecTester::new(tester_config);
node.add_strategy(tester)?;
node.run().await?;
```

## 基本冒烟测试

这是一项可随时运行的快速健全性检查，例如在修改适配器后或两次开发迭代之间运行。
测试器启动时使用市价单打开持仓，挂出一笔买入和一笔卖出的仅做挂单限价单，等待 30 秒，
然后停止（取消未结订单并关闭持仓）。

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.001"),
    open_position_on_start_qty=Decimal("0.001"),
    enable_limit_buys=True,
    enable_limit_sells=True,
    use_post_only=True,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.001"))
    .open_position_on_start_qty(dec!(0.001))
    .enable_limit_buys(true)
    .enable_limit_sells(true)
    .use_post_only(true)
    .build()?
```

**预期行为：**

1. 启动时：市价单成交并打开持仓。
2. 在距最优买卖报价 `tob_offset_ticks` 的位置挂出两笔限价单（默认 500 tick）。
3. 策略空闲 30 秒。检查日志中是否有错误、订单被拒或连接断开。
4. 停止时：取消未结限价单，并用市价单关闭持仓。

**通过标准：** 日志中没有错误，持仓正确打开并关闭，且交易场所已确认限价单。

---

下文每个分组都以汇总表开始，随后是详细测试卡。
测试 ID 使用留有间隔的编号，以便插入而无需重新编号。

---

## 第 1 组：市价单

测试市价单提交与成交。市价单应立即执行。

| TC     | 名称                     | 说明                             | 跳过条件         |
| ------ | ------------------------ | -------------------------------- | ---------------- |
| TC-E01 | Market BUY - 提交并成交  | 通过市价买入打开多头持仓。       | 不支持市价单。   |
| TC-E02 | Market SELL - 提交并成交 | 通过市价卖出打开空头持仓。       | 不支持市价单。   |
| TC-E03 | 使用 IOC TIF 的市价单    | 市价单显式使用 IOC 有效期类型。  | 不支持 IOC。     |
| TC-E04 | 使用 FOK TIF 的市价单    | 市价单显式使用 FOK 有效期类型。  | 不支持 FOK。     |
| TC-E05 | 使用计价货币数量的市价单 | 市价单使用计价货币数量。         | 不支持计价数量。 |
| TC-E06 | 通过市价单关闭持仓       | 停止时使用市价单关闭未平仓持仓。 | 不支持市价单。   |

### TC-E01：Market BUY - 提交并成交

| 字段         | 值                                                                                   |
| ------------ | ------------------------------------------------------------------------------------ |
| **前置条件** | 适配器已连接，金融工具已加载，市场数据正在流动，没有未平仓持仓。                     |
| **操作**     | ExecTester 通过 `open_position_on_start_qty` 打开多头持仓。                          |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted` -> `OrderFilled`。         |
| **通过标准** | 以 side=LONG 打开持仓，数量与配置匹配，成交价格在市场范围内，`AccountState` 已更新。 |
| **跳过条件** | 适配器不支持市价单。                                                                 |

**注意事项：**

- 某些适配器将市价单模拟为主动型限价 IOC 订单（检查适配器指南）。
- 无论交易场所机制如何，从策略视角观察到的事件序列都应相同。
- 成交价格应处于近期买卖价差范围内。
- 部分成交有效；验证累计成交数量与订单数量匹配。

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    open_position_on_start_qty=Decimal("0.01"),
    enable_limit_buys=False,
    enable_limit_sells=False,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .open_position_on_start_qty(Decimal::new(1, 2))
    .enable_limit_buys(false)
    .enable_limit_sells(false)
    .build()?
```

### TC-E02：Market SELL - 提交并成交

| 字段         | 值                                                                           |
| ------------ | ---------------------------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，市场数据正在流动，没有未平仓持仓。             |
| **操作**     | ExecTester 通过负数 `open_position_on_start_qty` 打开空头持仓。              |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted` -> `OrderFilled`。 |
| **通过标准** | 以 side=SHORT 打开持仓，数量与配置匹配，成交价格在市场范围内。               |
| **跳过条件** | 适配器不支持市价单或卖空。                                                   |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    open_position_on_start_qty=Decimal("-0.01"),
    enable_limit_buys=False,
    enable_limit_sells=False,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .open_position_on_start_qty(Decimal::new(-1, 2))
    .enable_limit_buys(false)
    .enable_limit_sells(false)
    .build()?
```

### TC-E03：使用 IOC TIF 的市价单

| 字段         | 值                                                                           |
| ------------ | ---------------------------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，市场数据正在流动。                             |
| **操作**     | 使用 `open_position_time_in_force=IOC` 打开持仓。                            |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted` -> `OrderFilled`。 |
| **通过标准** | 与 TC-E01 相同；订单显式设置了 IOC TIF。                                     |
| **跳过条件** | 不支持 IOC。                                                                 |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    open_position_on_start_qty=Decimal("0.01"),
    open_position_time_in_force=TimeInForce.IOC,
    enable_limit_buys=False,
    enable_limit_sells=False,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .open_position_on_start_qty(Decimal::new(1, 2))
    .enable_limit_buys(false)
    .enable_limit_sells(false)
    .open_position_time_in_force(TimeInForce::Ioc)
    .build()?
```

### TC-E04：使用 FOK TIF 的市价单

| 字段         | 值                                                                           |
| ------------ | ---------------------------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，市场数据正在流动。                             |
| **操作**     | 使用 `open_position_time_in_force=FOK` 打开持仓。                            |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted` -> `OrderFilled`。 |
| **通过标准** | 与 TC-E01 相同；订单显式设置了 FOK TIF。                                     |
| **跳过条件** | 不支持 FOK。                                                                 |

**注意事项：**

- FOK 要求立即全部成交，否则订单会被取消。
- 使用较小的测试数量，确保订单簿深度足以完全成交。

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    open_position_on_start_qty=Decimal("0.01"),
    open_position_time_in_force=TimeInForce.FOK,
    enable_limit_buys=False,
    enable_limit_sells=False,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .open_position_on_start_qty(Decimal::new(1, 2))
    .enable_limit_buys(false)
    .enable_limit_sells(false)
    .open_position_time_in_force(TimeInForce::Fok)
    .build()?
```

### TC-E05：使用计价货币数量的市价单

| 字段         | 值                                                                           |
| ------------ | ---------------------------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，适配器支持计价货币数量。                       |
| **操作**     | 使用 `use_quote_quantity=True` 打开持仓，数量以计价货币表示。                |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted` -> `OrderFilled`。 |
| **通过标准** | 订单以计价货币数量提交；成交数量以基础货币表示。                             |
| **跳过条件** | 适配器不支持计价数量订单。                                                   |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("100.0"),  # Quote currency amount
    open_position_on_start_qty=Decimal("100.0"),
    use_quote_quantity=True,
    enable_limit_buys=False,
    enable_limit_sells=False,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("100"))
    .open_position_on_start_qty(Decimal::from(100))
    .use_quote_quantity(true)
    .enable_limit_buys(false)
    .enable_limit_sells(false)
    .build()?
```

### TC-E06：停止时通过市价单关闭持仓

| 字段         | 值                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------- |
| **前置条件** | 存在由 TC-E01 或 TC-E02 打开的持仓。                                                     |
| **操作**     | 停止策略；ExecTester 通过市价单关闭持仓。                                                |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted` -> `OrderFilled`（平仓订单）。 |
| **通过标准** | 持仓已关闭，或只剩精确的低于精度残余；没有未结订单。                                     |
| **跳过条件** | 适配器不支持市价单。                                                                     |

**注意事项：**

- 作为同一会话的一部分，此测试自然接续 TC-E01 或 TC-E02。
- `close_positions_on_stop=True` 是默认值。
- 平仓订单的方向应与持仓相反。
- 当交易场所接受的数量小数位少于金融工具时，设置 `close_positions_qty_precision`。
  测试器只关闭交易场所可成交的数量，并记录任何精确残余。

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    open_position_on_start_qty=Decimal("0.01"),
    close_positions_on_stop=True,
    enable_limit_buys=False,
    enable_limit_sells=False,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .open_position_on_start_qty(Decimal::new(1, 2))
    .close_positions_on_stop(true)
    .enable_limit_buys(false)
    .enable_limit_sells(false)
    .build()?
```

---

## 第 2 组：限价单

测试限价单提交、接受及其在不同有效期选项下的行为。

| TC     | 名称                     | 说明                                       | 跳过条件     |
| ------ | ------------------------ | ------------------------------------------ | ------------ |
| TC-E10 | Limit BUY GTC            | 在 TOB 下方挂出 GTC 限价买单并验证已接受。 | 从不。       |
| TC-E11 | Limit SELL GTC           | 在 TOB 上方挂出 GTC 限价卖单并验证已接受。 | 从不。       |
| TC-E12 | Limit BUY 与 SELL 订单对 | 同时挂出两个方向的订单，验证两者均被接受。 | 从不。       |
| TC-E13 | Limit IOC 主动成交       | 以主动价格挂出 Limit IOC，预期成交。       | 不支持 IOC。 |
| TC-E14 | Limit IOC 被动、不成交   | 以远离市场的价格挂出 Limit IOC，预期取消。 | 不支持 IOC。 |
| TC-E15 | Limit FOK 成交           | 以主动价格挂出 Limit FOK，预期成交。       | 不支持 FOK。 |
| TC-E16 | Limit FOK 不成交         | 以远离市场的价格挂出 Limit FOK，预期取消。 | 不支持 FOK。 |
| TC-E17 | Limit GTD                | 挂出带到期时间的限价单，验证已接受。       | 不支持 GTD。 |
| TC-E18 | Limit GTD 到期           | 验证到期时记录在文档中的终态事件。         | 不支持 GTD。 |
| TC-E19 | Limit DAY                | 挂出使用 DAY TIF 的限价单，验证已接受。    | 不支持 DAY。 |

### TC-E10：Limit BUY GTC - 提交并接受

| 字段         | 值                                                           |
| ------------ | ------------------------------------------------------------ |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动。                 |
| **操作**     | ExecTester 在 `best_bid - tob_offset_ticks` 处挂出限价买单。 |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。  |
| **通过标准** | 订单以正确价格、数量、side=BUY、TIF=GTC 在交易场所保持未结。 |
| **跳过条件** | 从不。                                                       |

**注意事项：**

- `tob_offset_ticks`（默认 500）会将订单放在远离市场的位置，避免意外成交。
- 验证订单以 `OrderStatus.ACCEPTED` 状态出现在缓存中。
- 订单应保持未结，直到被显式取消。

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_limit_buys=True,
    enable_limit_sells=False,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_limit_buys(true)
    .enable_limit_sells(false)
    .build()?
```

### TC-E11：Limit SELL GTC - 提交并接受

| 字段         | 值                                                            |
| ------------ | ------------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动。                  |
| **操作**     | ExecTester 在 `best_ask + tob_offset_ticks` 处挂出限价卖单。  |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。   |
| **通过标准** | 订单以正确价格、数量、side=SELL、TIF=GTC 在交易场所保持未结。 |
| **跳过条件** | 从不。                                                        |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_limit_buys=False,
    enable_limit_sells=True,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_limit_buys(false)
    .enable_limit_sells(true)
    .build()?
```

### TC-E12：Limit BUY 与 SELL 订单对

| 字段         | 值                                                                                 |
| ------------ | ---------------------------------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动。                                       |
| **操作**     | ExecTester 同时挂出一笔限价买单和一笔限价卖单。                                    |
| **事件序列** | 两个独立序列：每个均为 `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。 |
| **通过标准** | 两笔订单均在交易场所保持未结，买单低于买价，卖单高于卖价。                         |
| **跳过条件** | 从不。                                                                             |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_limit_buys=True,
    enable_limit_sells=True,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_limit_buys(true)
    .enable_limit_sells(true)
    .build()?
```

### TC-E13：Limit IOC 主动成交

| 字段         | 值                                                                           |
| ------------ | ---------------------------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动。                                 |
| **操作**     | 以等于或高于最优卖价的价格（主动价格）提交限价买入 IOC。                     |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted` -> `OrderFilled`。 |
| **通过标准** | 订单立即成交；持仓已打开。                                                   |
| **跳过条件** | 适配器不支持 IOC TIF。                                                       |

**注意事项：**

- 此测试需要手动创建订单或使用适配器专用配置，因为 ExecTester 默认使用 GTC TIF 挂出限价单。
- 未立即成交的 IOC 订单会被交易场所取消。

### TC-E14：Limit IOC 被动订单 - 不成交

| 字段         | 值                                                                             |
| ------------ | ------------------------------------------------------------------------------ |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动。                                   |
| **操作**     | 以远低于市场的价格（被动价格）提交限价买入 IOC。                               |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted` -> `OrderCanceled`。 |
| **通过标准** | 订单由交易场所立即取消，且没有成交。                                           |
| **跳过条件** | 适配器不支持 IOC TIF。                                                         |

**注意事项：**

- 交易场所应取消未成交的 IOC 订单；验证 `OrderCanceled` 事件（而非 `OrderExpired`）。

### TC-E15：Limit FOK 成交

| 字段         | 值                                                                           |
| ------------ | ---------------------------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动，订单簿深度充足。                 |
| **操作**     | 以主动价格提交限价买入 FOK，数量不超过最优报价深度。                         |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted` -> `OrderFilled`。 |
| **通过标准** | 订单通过单个成交事件完全成交。                                               |
| **跳过条件** | 适配器不支持 FOK TIF。                                                       |

**注意事项：**

- FOK 要求全部数量均可成交；使用较小数量，确保订单簿深度充足。

### TC-E16：Limit FOK 不成交

| 字段         | 值                                                                             |
| ------------ | ------------------------------------------------------------------------------ |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动。                                   |
| **操作**     | 以被动价格（远低于市场）提交限价买入 FOK。                                     |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted` -> `OrderCanceled`。 |
| **通过标准** | 订单由交易场所立即取消，且没有成交。                                           |
| **跳过条件** | 适配器不支持 FOK TIF。                                                         |

### TC-E17：Limit GTD - 提交并接受

| 字段         | 值                                                                     |
| ------------ | ---------------------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动。                           |
| **操作**     | 挂出设置了 `order_expire_time_delta_mins` 的限价买单（例如 60 分钟）。 |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。            |
| **通过标准** | 订单以 GTD TIF 和正确到期时间戳被接受。                                |
| **跳过条件** | 适配器不支持 GTD TIF。                                                 |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    order_expire_time_delta_mins=60,
    enable_limit_buys=True,
    enable_limit_sells=False,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_limit_buys(true)
    .enable_limit_sells(false)
    .order_expire_time_delta_mins(60)
    .build()?
```

### TC-E18：Limit GTD 到期

| 字段         | 值                                                                  |
| ------------ | ------------------------------------------------------------------- |
| **前置条件** | 使用交易场所支持的最短到期时间，存在来自 TC-E17 的未结 GTD 限价单。 |
| **操作**     | 等待 GTD 到期时间过去。                                             |
| **事件序列** | 默认为 `OrderExpired`，或适配器记录在文档中的终态事件。             |
| **通过标准** | 订单在交易场所到期时达到适配器文档规定的终态。                      |
| **跳过条件** | 适配器不支持 GTD TIF。                                              |

**注意事项：**

- 使用交易场所接受的最短到期时间；不要假定一两分钟有效。
- 某些交易场所会将 GTD 到期报告为取消。应保留并验证适配器记录在文档中的映射，
  而不是将每个交易场所都规范化为 `OrderExpired`。

### TC-E19：Limit DAY - 提交并接受

| 字段         | 值                                                          |
| ------------ | ----------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，市场处于交易时段。            |
| **操作**     | 提交使用 DAY TIF 的限价买单。                               |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。 |
| **通过标准** | 订单以 DAY TIF 被接受；将在交易日结束时自动取消。           |
| **跳过条件** | 适配器不支持 DAY TIF。                                      |

**注意事项：**

- DAY 订单在 24/7 全天候加密货币交易场所与传统市场的行为可能不同。
- 验证在交易时段外提交时的行为（如适用）。

---

## 第 3 组：止损与条件订单

测试止损与条件订单类型。这些订单会停留在交易场所，直到满足触发条件。
支持交易场所原生条件订单的适配器还应验证，未结触发订单会出现在重启对账中，
而不只是出现在普通未结订单端点中。

| TC     | 名称                 | 说明                                 | 跳过条件               |
| ------ | -------------------- | ------------------------------------ | ---------------------- |
| TC-E20 | StopMarket BUY       | 在卖价上方挂出止损买单，验证已接受。 | 不支持 `STOP_MARKET`。 |
| TC-E21 | StopMarket SELL      | 在买价下方挂出止损卖单，验证已接受。 | 不支持 `STOP_MARKET`。 |
| TC-E22 | StopLimit BUY        | 使用触发价与限价的止损限价买单。     | 不支持 `STOP_LIMIT`。  |
| TC-E23 | StopLimit SELL       | 使用触发价与限价的止损限价卖单。     | 不支持 `STOP_LIMIT`。  |
| TC-E24 | MarketIfTouched BUY  | 在买价下方挂出 MIT 买单。            | 不支持 `MIT`。         |
| TC-E25 | MarketIfTouched SELL | 在卖价上方挂出 MIT 卖单。            | 不支持 `MIT`。         |
| TC-E26 | LimitIfTouched BUY   | 使用触发价与限价的 LIT 买单。        | 不支持 `LIT`。         |
| TC-E27 | LimitIfTouched SELL  | 使用触发价与限价的 LIT 卖单。        | 不支持 `LIT`。         |

### TC-E20：StopMarket BUY

| 字段         | 值                                                          |
| ------------ | ----------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动。                |
| **操作**     | ExecTester 在当前卖价上方挂出止损市价买单。                 |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。 |
| **通过标准** | 止损订单在交易场所以正确触发价格和 side=BUY 被接受。        |
| **跳过条件** | 适配器不支持 `StopMarket` 订单。                            |

**注意事项：**

- 触发价格应比当前卖价高 `stop_offset_ticks`。
- 订单不应立即触发（触发价格高于市场）。
- 对于使用长期触发签名的交易场所，验证触发订单签名到期使用交易场所的触发订单窗口，
  而不是普通订单到期时间。
- 验证触发与成交需要市场发生变动，而测试期间不一定会发生。
- 接受后，重新启动或强制对账，并验证当交易场所把触发订单保存在独立端点时，
  该订单仍以未结订单报告形式出现。

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_limit_buys=False,
    enable_limit_sells=False,
    enable_stop_buys=True,
    enable_stop_sells=False,
    stop_order_type=OrderType.STOP_MARKET,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_limit_buys(false)
    .enable_limit_sells(false)
    .enable_stop_buys(true)
    .enable_stop_sells(false)
    .stop_order_type(OrderType::StopMarket)
    .build()?
```

### TC-E21：StopMarket SELL

| 字段         | 值                                                          |
| ------------ | ----------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动。                |
| **操作**     | ExecTester 在当前买价下方挂出止损市价卖单。                 |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。 |
| **通过标准** | 止损订单在交易场所以正确触发价格和 side=SELL 被接受。       |
| **跳过条件** | 适配器不支持 `StopMarket` 订单。                            |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_limit_buys=False,
    enable_limit_sells=False,
    enable_stop_buys=False,
    enable_stop_sells=True,
    stop_order_type=OrderType.STOP_MARKET,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_limit_buys(false)
    .enable_limit_sells(false)
    .enable_stop_buys(false)
    .enable_stop_sells(true)
    .stop_order_type(OrderType::StopMarket)
    .build()?
```

### TC-E22：StopLimit BUY

| 字段         | 值                                                              |
| ------------ | --------------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动。                    |
| **操作**     | ExecTester 挂出止损限价买单，触发价格高于卖价，并设置限价偏移。 |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。     |
| **通过标准** | 止损限价单以正确触发价格、限价和 side=BUY 被接受。              |
| **跳过条件** | 适配器不支持 `StopLimit` 订单。                                 |

**注意事项：**

- 需要设置 `stop_limit_offset_ticks`，以指定限价相对触发价格的偏移。

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_limit_buys=False,
    enable_limit_sells=False,
    enable_stop_buys=True,
    enable_stop_sells=False,
    stop_order_type=OrderType.STOP_LIMIT,
    stop_limit_offset_ticks=50,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_limit_buys(false)
    .enable_limit_sells(false)
    .enable_stop_buys(true)
    .enable_stop_sells(false)
    .stop_order_type(OrderType::StopLimit)
    .stop_limit_offset_ticks(50)
    .build()?
```

### TC-E23：StopLimit SELL

| 字段         | 值                                                          |
| ------------ | ----------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动。                |
| **操作**     | ExecTester 挂出止损限价卖单，触发价格低于买价。             |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。 |
| **通过标准** | 止损限价单以正确触发价格、限价和 side=SELL 被接受。         |
| **跳过条件** | 适配器不支持 `StopLimit` 订单。                             |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_limit_buys=False,
    enable_limit_sells=False,
    enable_stop_buys=False,
    enable_stop_sells=True,
    stop_order_type=OrderType.STOP_LIMIT,
    stop_limit_offset_ticks=50,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_limit_buys(false)
    .enable_limit_sells(false)
    .enable_stop_buys(false)
    .enable_stop_sells(true)
    .stop_order_type(OrderType::StopLimit)
    .stop_limit_offset_ticks(50)
    .build()?
```

### TC-E24：MarketIfTouched BUY

| 字段         | 值                                                          |
| ------------ | ----------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动。                |
| **操作**     | 挂出触发价格低于当前买价的 MIT 买单（回调买入）。           |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。 |
| **通过标准** | MIT 订单在交易场所以正确触发价格被接受。                    |
| **跳过条件** | 适配器不支持 `MarketIfTouched` 订单。                       |

### TC-E25：MarketIfTouched SELL

| 字段         | 值                                                          |
| ------------ | ----------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动。                |
| **操作**     | 挂出触发价格高于当前卖价的 MIT 卖单（上涨卖出）。           |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。 |
| **通过标准** | MIT 订单在交易场所以正确触发价格被接受。                    |
| **跳过条件** | 适配器不支持 `MarketIfTouched` 订单。                       |

### TC-E26：LimitIfTouched BUY

| 字段         | 值                                                          |
| ------------ | ----------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动。                |
| **操作**     | 挂出触发价格低于买价并带限价偏移的 LIT 买单。               |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。 |
| **通过标准** | LIT 订单以正确触发价格和限价被接受。                        |
| **跳过条件** | 适配器不支持 `LimitIfTouched` 订单。                        |

### TC-E27：LimitIfTouched SELL

| 字段         | 值                                                          |
| ------------ | ----------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动。                |
| **操作**     | 挂出触发价格高于卖价并带限价偏移的 LIT 卖单。               |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。 |
| **通过标准** | LIT 订单以正确触发价格和限价被接受。                        |
| **跳过条件** | 适配器不支持 `LimitIfTouched` 订单。                        |

---

## 第 4 组：订单修改

测试订单修改（amend）与取消替换工作流。

| TC     | 名称                 | 说明                                 | 跳过条件             |
| ------ | -------------------- | ------------------------------------ | -------------------- |
| TC-E30 | 修改 Limit BUY 价格  | 将未结限价买单修改为新价格。         | 不支持修改。         |
| TC-E31 | 修改 Limit SELL 价格 | 将未结限价卖单修改为新价格。         | 不支持修改。         |
| TC-E32 | 取消替换 Limit BUY   | 取消限价买单，并以新价格重新提交。   | 从不。               |
| TC-E33 | 取消替换 Limit SELL  | 取消限价卖单，并以新价格重新提交。   | 从不。               |
| TC-E34 | 修改止损触发价格     | 修改止损订单触发价格。               | 不支持修改或止损单。 |
| TC-E35 | 取消替换止损订单     | 取消止损单，并以新触发价格重新提交。 | 不支持止损单。       |
| TC-E36 | 修改被拒绝           | 在不支持的适配器上修改。             | 适配器支持修改。     |

### TC-E30：修改 Limit BUY 价格

| 字段         | 值                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------- |
| **前置条件** | 存在来自 TC-E10 的未结 GTC 限价买单。                                                          |
| **操作**     | 市场变化时，ExecTester 将限价买单修改为新价格（`modify_orders_to_maintain_tob_offset=True`）。 |
| **事件序列** | `OrderPendingUpdate` -> `OrderUpdated`。                                                       |
| **通过标准** | 日志记录带有新价格的 `OrderUpdated` 事件；订单退出 `PendingUpdate`。                           |
| **跳过条件** | 适配器不支持订单修改。                                                                         |

**注意事项：**

- 需要市场变化来触发 ExecTester 的订单维护逻辑。
- 当订单价格偏离目标 TOB 偏移时触发修改。
- 验证 `OrderUpdated` 日志显示预期价格。如果事件始终未到达，订单会停留在 `PendingUpdate`，
  测试器也会停止修改该订单。

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_limit_buys=True,
    enable_limit_sells=False,
    modify_orders_to_maintain_tob_offset=True,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_limit_buys(true)
    .enable_limit_sells(false)
    .modify_orders_to_maintain_tob_offset(true)
    .build()?
```

### TC-E31：修改 Limit SELL 价格

| 字段         | 值                                                                   |
| ------------ | -------------------------------------------------------------------- |
| **前置条件** | 存在来自 TC-E11 的未结 GTC 限价卖单。                                |
| **操作**     | 市场变化时，ExecTester 将限价卖单修改为新价格。                      |
| **事件序列** | `OrderPendingUpdate` -> `OrderUpdated`。                             |
| **通过标准** | 日志记录带有新价格的 `OrderUpdated` 事件；订单退出 `PendingUpdate`。 |
| **跳过条件** | 适配器不支持订单修改。                                               |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_limit_buys=False,
    enable_limit_sells=True,
    modify_orders_to_maintain_tob_offset=True,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_limit_buys(false)
    .enable_limit_sells(true)
    .modify_orders_to_maintain_tob_offset(true)
    .build()?
```

### TC-E32：取消替换 Limit BUY

| 字段         | 值                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| **前置条件** | 存在未结 GTC 限价买单。                                                                                |
| **操作**     | 市场变化时，ExecTester 取消限价买单，并以新价格重新提交。                                              |
| **事件序列** | `OrderPendingCancel` -> `OrderCanceled` -> `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。 |
| **通过标准** | 原订单已取消，新订单以更新后的价格被接受。                                                             |
| **跳过条件** | 从不（取消替换始终可用）。                                                                             |

**注意事项：**

- 当适配器不支持原生修改时，这是通用替代方案。
- 缓存中存在两笔不同订单：已取消的原订单和新的替换订单。

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_limit_buys=True,
    enable_limit_sells=False,
    cancel_replace_orders_to_maintain_tob_offset=True,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_limit_buys(true)
    .enable_limit_sells(false)
    .cancel_replace_orders_to_maintain_tob_offset(true)
    .build()?
```

### TC-E33：取消替换 Limit SELL

| 字段         | 值                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| **前置条件** | 存在未结 GTC 限价卖单。                                                                                |
| **操作**     | ExecTester 取消限价卖单，并以新价格重新提交。                                                          |
| **事件序列** | `OrderPendingCancel` -> `OrderCanceled` -> `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。 |
| **通过标准** | 原订单已取消，新订单以更新后的价格被接受。                                                             |
| **跳过条件** | 从不。                                                                                                 |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_limit_buys=False,
    enable_limit_sells=True,
    cancel_replace_orders_to_maintain_tob_offset=True,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_limit_buys(false)
    .enable_limit_sells(true)
    .cancel_replace_orders_to_maintain_tob_offset(true)
    .build()?
```

### TC-E34：修改止损触发价格

| 字段         | 值                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------- |
| **前置条件** | 存在来自 TC-E20 或 TC-E22 的未结止损订单。                                                |
| **操作**     | 市场变化时，ExecTester 修改止损触发价格（`modify_stop_orders_to_maintain_offset=True`）。 |
| **事件序列** | `OrderPendingUpdate` -> `OrderUpdated`。                                                  |
| **通过标准** | 日志记录带有新触发价格的 `OrderUpdated` 事件；订单退出 `PendingUpdate`。                  |
| **跳过条件** | 适配器不支持原生止损修改，或不支持止损订单。                                              |

**注意事项：**

- 某些交易场所允许修改限价单，但拒绝替换触发订单。对于这些适配器，
  跳过 TC-E34，改为运行 TC-E35。

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_stop_buys=True,
    modify_stop_orders_to_maintain_offset=True,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_stop_buys(true)
    .modify_stop_orders_to_maintain_offset(true)
    .build()?
```

### TC-E35：取消替换止损订单

| 字段         | 值                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| **前置条件** | 存在未结止损订单。                                                                                     |
| **操作**     | ExecTester 取消止损单，并以新触发价格重新提交。                                                        |
| **事件序列** | `OrderPendingCancel` -> `OrderCanceled` -> `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。 |
| **通过标准** | 原止损单已取消，新止损单以更新后的触发价格被接受。                                                     |
| **跳过条件** | 不支持止损订单。                                                                                       |

**注意事项：**

- 对于不支持原生触发订单替换的交易场所，这是必需路径。
- 新止损单被接受后，重新启动或强制对账，并验证恰好只剩一笔当前触发订单。

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_stop_buys=True,
    cancel_replace_stop_orders_to_maintain_offset=True,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_stop_buys(true)
    .cancel_replace_stop_orders_to_maintain_offset(true)
    .build()?
```

### TC-E36：修改被拒绝

| 字段         | 值                                                                |
| ------------ | ----------------------------------------------------------------- |
| **前置条件** | 存在未结限价单，适配器不支持修改。                                |
| **操作**     | 尝试修改订单（以编程方式，而不是通过 ExecTester 自动维护）。      |
| **事件序列** | `OrderModifyRejected`。                                           |
| **通过标准** | 修改尝试产生带原因的 `OrderModifyRejected` 事件；原订单保持不变。 |
| **跳过条件** | 适配器支持订单修改。                                              |

**注意事项：**

- 此测试针对适配器的拒绝路径，而非 ExecTester 的取消替换逻辑。
- 拒绝原因应表明不支持修改。

---

## 第 5 组：订单取消

测试订单取消工作流。

| TC     | 名称               | 说明                                 | 跳过条件         |
| ------ | ------------------ | ------------------------------------ | ---------------- |
| TC-E40 | 取消单笔限价单     | 取消一笔未结限价单。                 | 从不。           |
| TC-E41 | 停止时取消全部订单 | 策略停止时取消所有未结订单（默认）。 | 从不。           |
| TC-E42 | 停止时逐笔取消     | 停止时逐笔取消订单。                 | 从不。           |
| TC-E43 | 停止时批量取消     | 停止时通过批量 API 取消订单。        | 不支持批量取消。 |
| TC-E44 | 取消已取消的订单   | 验证记录在文档中的拒绝或幂等结果。   | 从不。           |

### TC-E40：取消单笔限价单

| 字段         | 值                                            |
| ------------ | --------------------------------------------- |
| **前置条件** | 存在来自 TC-E10 或 TC-E11 的未结 GTC 限价单。 |
| **操作**     | 停止策略；ExecTester 取消未结限价单。         |
| **事件序列** | `OrderPendingCancel` -> `OrderCanceled`。     |
| **通过标准** | 订单状态转换为 CANCELED；没有剩余未结订单。   |
| **跳过条件** | 从不。                                        |

**注意事项：**

- `cancel_orders_on_stop=True`（默认）会在策略停止时触发取消。
- 验证 `OrderCanceled` 事件包含正确的 `venue_order_id`。

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_limit_buys=True,
    enable_limit_sells=False,
    cancel_orders_on_stop=True,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_limit_buys(true)
    .enable_limit_sells(false)
    .cancel_orders_on_stop(true)
    .build()?
```

### TC-E41：停止时取消全部订单

| 字段         | 值                                                     |
| ------------ | ------------------------------------------------------ |
| **前置条件** | 存在多笔未结订单（来自 TC-E12 的限价买单和限价卖单）。 |
| **操作**     | 使用 `cancel_orders_on_stop=True`（默认）停止策略。    |
| **事件序列** | 对每笔订单：`OrderPendingCancel` -> `OrderCanceled`。  |
| **通过标准** | 所有未结订单已取消；没有剩余未结订单。                 |
| **跳过条件** | 从不。                                                 |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_limit_buys=True,
    enable_limit_sells=True,
    cancel_orders_on_stop=True,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_limit_buys(true)
    .enable_limit_sells(true)
    .cancel_orders_on_stop(true)
    .build()?
```

### TC-E42：停止时逐笔取消

| 字段         | 值                                                           |
| ------------ | ------------------------------------------------------------ |
| **前置条件** | 存在多笔未结订单。                                           |
| **操作**     | 使用 `use_individual_cancels_on_stop=True` 停止。            |
| **事件序列** | 对每笔订单分别发出 `OrderPendingCancel` -> `OrderCanceled`。 |
| **通过标准** | 每笔订单均单独取消；所有订单达到 CANCELED 状态。             |
| **跳过条件** | 从不。                                                       |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_limit_buys=True,
    enable_limit_sells=True,
    use_individual_cancels_on_stop=True,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_limit_buys(true)
    .enable_limit_sells(true)
    .use_individual_cancels_on_stop(true)
    .build()?
```

### TC-E43：停止时批量取消

| 字段         | 值                                                           |
| ------------ | ------------------------------------------------------------ |
| **前置条件** | 存在多笔未结订单，适配器支持批量取消。                       |
| **操作**     | 使用 `use_batch_cancel_on_stop=True` 停止。                  |
| **事件序列** | 批量对所有订单发出 `OrderPendingCancel` -> `OrderCanceled`。 |
| **通过标准** | 所有订单通过单次批量请求取消；全部达到 CANCELED 状态。       |
| **跳过条件** | 适配器不支持批量取消。                                       |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_limit_buys=True,
    enable_limit_sells=True,
    use_batch_cancel_on_stop=True,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_limit_buys(true)
    .enable_limit_sells(true)
    .use_batch_cancel_on_stop(true)
    .build()?
```

### TC-E44：取消已取消的订单

| 字段         | 值                                                                     |
| ------------ | ---------------------------------------------------------------------- |
| **前置条件** | 存在一笔先前已取消的订单（来自 TC-E40）。                              |
| **操作**     | 尝试再次取消同一订单。                                                 |
| **事件序列** | 默认为 `OrderCancelRejected`，或对记录在文档中的幂等结果不产生新事件。 |
| **通过标准** | 结果符合适配器契约，且没有重复终态事件。                               |
| **跳过条件** | 从不。                                                                 |

**注意事项：**

- 默认契约测试适配器对无效取消请求的错误处理。拒绝原因应表明订单不处于可取消状态。
- 交易场所可能将对已进入终态订单的取消视为幂等。记录该处置；当通用测试器或执行引擎
  在本地过滤已关闭订单时，使用适配器专用测试。

---

## 第 6 组：括号订单

测试括号订单提交（入场 + 止盈 + 止损）。

| TC     | 名称                   | 说明                                 | 跳过条件          |
| ------ | ---------------------- | ------------------------------------ | ----------------- |
| TC-E50 | Bracket BUY            | 限价买入场 + 限价卖止盈 + 止损卖出。 | 不支持括号订单。  |
| TC-E51 | Bracket SELL           | 限价卖入场 + 限价买止盈 + 止损买入。 | 不支持括号订单。  |
| TC-E52 | 括号入场成交后激活     | 验证入场成交后 TP/SL 进入活动状态。  | 不支持括号订单。  |
| TC-E53 | 仅做挂单入场的括号订单 | 入场订单使用仅做挂单标志。           | 不支持括号或 PO。 |

### TC-E50：Bracket BUY

| 字段         | 值                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动。                                                                                           |
| **操作**     | ExecTester 提交括号订单：限价买入场 + 止盈卖出 + 止损卖出。                                                                            |
| **事件序列** | 入场：`OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`；TP 与 SL：`OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。 |
| **通过标准** | 创建并接受三笔订单：入场低于买价，TP 高于卖价，SL 低于入场价。                                                                         |
| **跳过条件** | 适配器不支持括号订单。                                                                                                                 |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_brackets=True,
    bracket_entry_order_type=OrderType.LIMIT,
    bracket_offset_ticks=500,
    enable_limit_buys=True,
    enable_limit_sells=False,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_brackets(true)
    .bracket_entry_order_type(OrderType::Limit)
    .bracket_offset_ticks(500)
    .enable_limit_buys(true)
    .enable_limit_sells(false)
    .build()?
```

### TC-E51：Bracket SELL

| 字段         | 值                                                        |
| ------------ | --------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动。              |
| **操作**     | ExecTester 提交括号订单：限价卖入场 + TP 买入 + SL 买入。 |
| **事件序列** | 与 TC-E50 模式相同，但方向为卖出。                        |
| **通过标准** | 在卖出方向创建并接受三笔订单。                            |
| **跳过条件** | 适配器不支持括号订单。                                    |

### TC-E52：括号入场成交后激活 TP/SL

| 字段         | 值                                                       |
| ------------ | -------------------------------------------------------- |
| **前置条件** | 存在来自 TC-E50 且入场订单已成交的括号订单。             |
| **操作**     | 入场订单成交；验证或有 TP 与 SL 订单激活。               |
| **事件序列** | 入场：`OrderFilled`；TP 与 SL 从或有状态转换为活动状态。 |
| **通过标准** | 入场成交后，TP 与 SL 订单在交易场所处于活动状态。        |
| **跳过条件** | 适配器不支持括号订单。                                   |

**注意事项：**

- 此测试要求入场订单实际成交，可能需要主动定价。
- TP/SL 激活机制因交易场所而异（有些立即激活，有些使用 OCA 组）。

### TC-E53：仅做挂单入场的括号订单

| 字段         | 值                                                          |
| ------------ | ----------------------------------------------------------- |
| **前置条件** | 适配器支持括号订单和仅做挂单。                              |
| **操作**     | 使用 `use_post_only=True` 提交括号订单（应用于入场和 TP）。 |
| **事件序列** | 与 TC-E50 相同，但入场带仅做挂单标志。                      |
| **通过标准** | 入场和 TP 订单以仅做挂单（挂单方）被接受；SL 不是仅做挂单。 |
| **跳过条件** | 不支持括号订单或仅做挂单。                                  |

---

## 第 7 组：订单标志

测试订单级标志与特殊参数。

| TC     | 名称              | 说明                                     | 跳过条件         |
| ------ | ----------------- | ---------------------------------------- | ---------------- |
| TC-E60 | PostOnly 已接受   | 带仅做挂单的限价单，挂在远离 TOB 处。    | 不支持仅做挂单。 |
| TC-E61 | 平仓时 ReduceOnly | 使用仅减仓标志关闭持仓。                 | 不支持仅减仓。   |
| TC-E62 | 显示数量          | 可见数量小于总量的冰山订单。             | 不支持显示数量。 |
| TC-E63 | 自定义订单参数    | 通过 `order_params` 传入适配器专用参数。 | 不适用。         |

### TC-E60：PostOnly 已接受

| 字段         | 值                                                              |
| ------------ | --------------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动。                    |
| **操作**     | ExecTester 以被动价格挂出启用 `use_post_only=True` 的限价买单。 |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。     |
| **通过标准** | 订单作为挂单方订单被接受；交易场所确认仅做挂单标志。            |
| **跳过条件** | 适配器不支持仅做挂单标志。                                      |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_limit_buys=True,
    enable_limit_sells=False,
    use_post_only=True,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_limit_buys(true)
    .enable_limit_sells(false)
    .use_post_only(true)
    .build()?
```

### TC-E61：平仓时 ReduceOnly

| 字段         | 值                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------- |
| **前置条件** | 存在未平持仓（来自 TC-E01）。                                                            |
| **操作**     | 使用 `reduce_only_on_stop=True` 停止策略；平仓订单使用仅减仓标志。                       |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted` -> `OrderFilled`（带仅减仓）。 |
| **通过标准** | 平仓订单带有仅减仓标志；持仓完全关闭。                                                   |
| **跳过条件** | 适配器不支持仅减仓标志。                                                                 |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    open_position_on_start_qty=Decimal("0.01"),
    reduce_only_on_stop=True,
    close_positions_on_stop=True,
    enable_limit_buys=False,
    enable_limit_sells=False,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .open_position_on_start_qty(Decimal::new(1, 2))
    .reduce_only_on_stop(true)
    .close_positions_on_stop(true)
    .enable_limit_buys(false)
    .enable_limit_sells(false)
    .build()?
```

### TC-E62：显示数量（冰山订单）

| 字段         | 值                                                          |
| ------------ | ----------------------------------------------------------- |
| **前置条件** | 适配器已连接，且支持显示数量。                              |
| **操作**     | 挂出 `order_display_qty` 小于 `order_qty` 的限价单。        |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。 |
| **通过标准** | 订单以设定的显示数量被接受；订单簿上仅显示指定数量。        |
| **跳过条件** | 适配器不支持显示数量/冰山订单。                             |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("1.0"),
    order_display_qty=Quantity.from_str("0.1"),
    enable_limit_buys=True,
    enable_limit_sells=False,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("1.0"))
    .enable_limit_buys(true)
    .enable_limit_sells(false)
    .order_display_qty(Quantity::from("0.1"))
    .build()?
```

### TC-E63：自定义订单参数

| 字段         | 值                                                          |
| ------------ | ----------------------------------------------------------- |
| **前置条件** | 适配器已连接，且接受附加参数。                              |
| **操作**     | 使用包含适配器专用参数的 `order_params` 字典挂单。          |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。 |
| **通过标准** | 订单被接受；适配器专用参数已透传至交易场所。                |
| **跳过条件** | 不适用（因适配器而异）。                                    |

**注意事项：**

- `order_params` 字典对 ExecTester 不透明，并会直接传递给适配器。
- 请查阅适配器指南了解支持的参数。

---

## 第 8 组：拒绝处理

测试适配器能否正确处理并报告订单拒绝。

| TC     | 名称                 | 说明                             | 跳过条件         |
| ------ | -------------------- | -------------------------------- | ---------------- |
| TC-E70 | PostOnly 拒绝        | 会穿过价差的仅做挂单订单。       | 不支持仅做挂单。 |
| TC-E71 | ReduceOnly 拒绝      | 没有可减持仓时提交仅减仓订单。   | 不支持仅减仓。   |
| TC-E72 | 不支持的订单类型     | 提交适配器不支持的订单类型。     | 从不。           |
| TC-E73 | 不支持的 TIF         | 使用不支持的有效期类型提交订单。 | 从不。           |
| TC-E74 | 结果不明确的提交失败 | 提交时发生传输、超时或发送失败。 | 无模拟路径。     |
| TC-E75 | 结果不明确的取消失败 | 取消时发生传输、超时或发送失败。 | 不支持取消。     |
| TC-E76 | 结果不明确的修改失败 | 修改时发生传输、超时或发送失败。 | 不支持修改。     |
| TC-E77 | 结果不明确的批量失败 | 整批失败且没有逐订单结果。       | 不支持批量操作。 |
| TC-E78 | 批量中的逐订单拒绝   | 批量响应中包含明确的逐订单拒绝。 | 不支持批量操作。 |

TC-E74 至 TC-E78 在下文统一规定，因为它们通常需要模拟 HTTP 或 WebSocket 边界，而非实盘交易场所。

### 结果不明确的失败

这些用例用于证明：当交易场所的处理结果未知时，适配器请求失败不会转化为终态拒绝事件。通过标准还规定了本地准备失败的例外：当确定命令尚未发送，且失败可归因于单个取消或修改命令时，适配器可以发出对应的拒绝事件。

**通过标准：**

- 因传输错误、超时、WebSocket 发送失败、重试耗尽或响应解析失败导致的提交失败，不得发出 `OrderRejected`。
- 因传输错误、超时、WebSocket 发送失败、重试耗尽或整个请求的服务器失败导致的取消失败，不得发出 `OrderCancelRejected`。
- 因传输错误、超时、WebSocket 发送失败、重试耗尽或整个请求的服务器失败导致的修改失败，不得发出 `OrderModifyRejected`。
- 若本地取消准备失败能证明命令无法发送，并且适配器能将失败归因于单个取消命令，则可以发出 `OrderCancelRejected`。
- 若本地修改准备失败能证明命令无法发送，并且适配器能将失败归因于单个修改命令，则可以发出 `OrderModifyRejected`。
- 当交易场所未返回逐订单结果时，整批请求失败不得针对每个订单分别发出拒绝事件。
- 交易场所明确返回的逐订单拒绝，仍须发出对应的拒绝事件并附带交易场所给出的原因。

订单会保持相应的在途状态，直至交易场所更新、查询结果或对账流程将其解析为确定状态。

### TC-E70：PostOnly 拒绝

| 字段         | 值                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，报价正在流动。                                                |
| **操作**     | ExecTester 在订单簿错误一侧挂出仅做挂单订单（`test_reject_post_only=True`），使其穿过价差。 |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderRejected`。                                 |
| **通过标准** | 交易场所拒绝订单；`OrderRejected.due_post_only=true`；原因指出仅做挂单违规。                |
| **跳过条件** | 适配器不支持仅做挂单标志。                                                                  |

**注意事项：**

- ExecTester 的 `test_reject_post_only` 模式会故意将订单定价为穿过价差。
- 某些交易场所可能会部分成交而不是拒绝；具体行为因交易场所而异。
- 对于仅做挂单穿价而发出 `OrderRejected` 的适配器，应设置 `due_post_only=true`，以便策略将其与其他交易场所拒绝区分开。

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    enable_limit_buys=True,
    enable_limit_sells=False,
    use_post_only=True,
    test_reject_post_only=True,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .enable_limit_buys(true)
    .enable_limit_sells(false)
    .use_post_only(true)
    .test_reject_post_only(true)
    .build()?
```

### TC-E71：ReduceOnly 拒绝

| 字段         | 值                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **前置条件** | 适配器已连接，该金融工具没有未平持仓。                                                                                                    |
| **操作**     | 不存在可减持仓时，ExecTester 通过 `test_reject_reduce_only=True` 和 `open_position_on_start_qty` 提交 `reduce_only=True` 的市价开仓订单。 |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderRejected`。                                                                               |
| **通过标准** | 订单被拒绝；`OrderRejected` 事件中的原因表明违反仅减仓约束。                                                                              |
| **跳过条件** | 适配器不支持仅减仓标志。                                                                                                                  |

**注意事项：**

- `test_reject_reduce_only` 标志仅适用于通过 `open_position_on_start_qty` 提交的开仓市价单。
- 运行此测试前，确认该金融工具不存在已有持仓。

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    open_position_on_start_qty=Decimal("0.01"),
    test_reject_reduce_only=True,
    enable_limit_buys=False,
    enable_limit_sells=False,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .open_position_on_start_qty(Decimal::new(1, 2))
    .test_reject_reduce_only(true)
    .enable_limit_buys(false)
    .enable_limit_sells(false)
    .build()?
```

### TC-E72：不支持的订单类型

| 字段         | 值                                                              |
| ------------ | --------------------------------------------------------------- |
| **前置条件** | 适配器已连接，订单类型不在适配器支持集合中。                    |
| **操作**     | 提交适配器不支持的订单类型。                                    |
| **事件序列** | `OrderDenied`（适配器在提交前拒绝）。                           |
| **通过标准** | 订单在到达交易场所之前被否决；发出带原因的 `OrderDenied` 事件。 |
| **跳过条件** | 从不（每个适配器都有可测试的不支持订单类型）。                  |

**注意事项：**

- `OrderDenied` 发生在适配器层，订单尚未到达交易场所。
- 这与来自交易场所的 `OrderRejected` 不同。
- 可通过配置适配器不支持的止损订单类型进行测试。

### TC-E73：不支持的 TIF

| 字段         | 值                                                              |
| ------------ | --------------------------------------------------------------- |
| **前置条件** | 适配器已连接，TIF 不在适配器支持集合中。                        |
| **操作**     | 使用适配器不支持的 TIF 提交订单。                               |
| **事件序列** | `OrderDenied`（适配器在提交前拒绝）。                           |
| **通过标准** | 订单在到达交易场所之前被否决；发出带原因的 `OrderDenied` 事件。 |
| **跳过条件** | 从不（每个适配器都有可测试的不支持 TIF 选项）。                 |

**注意事项：**

- 与 TC-E72 类似，但测试的是有效期选项。
- 使用 Vibe 枚举中适配器未映射的 TIF 值进行测试。

---

## 第 9 组：生命周期（启动/停止）

测试策略启动和停止时的生命周期行为与状态管理。

| TC     | 名称             | 说明                             | 跳过条件         |
| ------ | ---------------- | -------------------------------- | ---------------- |
| TC-E80 | 启动时开仓       | 策略启动后立即开立持仓。         | 不支持市价单。   |
| TC-E81 | 停止时取消订单   | 策略停止时取消所有未结订单。     | 从不。           |
| TC-E82 | 停止时平仓       | 策略停止时关闭未平持仓。         | 不支持市价单。   |
| TC-E83 | 停止时取消订阅   | 策略停止时取消数据源订阅。       | 不支持取消订阅。 |
| TC-E84 | 对账未结订单     | 对账上一会话留下的已有未结订单。 | 从不。           |
| TC-E85 | 对账已成交订单   | 对账上一会话中此前已成交的订单。 | 从不。           |
| TC-E86 | 对账未平多头持仓 | 对账已有的未平多头持仓。         | 从不。           |
| TC-E87 | 对账未平空头持仓 | 对账已有的未平空头持仓。         | 从不。           |

### TC-E80：启动时开仓

| 字段         | 值                                                                           |
| ------------ | ---------------------------------------------------------------------------- |
| **前置条件** | 适配器已连接，金融工具已加载，不存在已有持仓。                               |
| **操作**     | 策略在设置了 `open_position_on_start_qty` 的情况下启动。                     |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted` -> `OrderFilled`。 |
| **通过标准** | 启动时开立持仓；在开始维护限价单之前，市价单已提交并成交。                   |
| **跳过条件** | 适配器不支持市价单。                                                         |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    open_position_on_start_qty=Decimal("0.01"),
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .open_position_on_start_qty(Decimal::new(1, 2))
    .build()?
```

### TC-E81：停止时取消订单

| 字段         | 值                                                        |
| ------------ | --------------------------------------------------------- |
| **前置条件** | 策略会话中存在未结限价单。                                |
| **操作**     | 使用 `cancel_orders_on_stop=True`（默认值）停止策略。     |
| **事件序列** | 对每个未结订单：`OrderPendingCancel` -> `OrderCanceled`。 |
| **通过标准** | 停止时，策略拥有的所有未结订单均被取消。                  |
| **跳过条件** | 从不。                                                    |

### TC-E82：停止时平仓

| 字段         | 值                                                                                     |
| ------------ | -------------------------------------------------------------------------------------- |
| **前置条件** | 策略会话中存在未平持仓。                                                               |
| **操作**     | 使用 `close_positions_on_stop=True`（默认值）停止策略。                                |
| **事件序列** | 平仓订单：`OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted` -> `OrderFilled`。 |
| **通过标准** | 持仓已关闭，或仅剩精度以下的精确残余；没有未结订单。                                   |
| **跳过条件** | 适配器不支持市价单。                                                                   |

### TC-E83：停止时取消订阅

| 字段         | 值                                              |
| ------------ | ----------------------------------------------- |
| **前置条件** | 存在活跃的数据订阅（报价、成交、订单簿）。      |
| **操作**     | 使用 `can_unsubscribe=True`（默认值）停止策略。 |
| **事件序列** | 数据订阅被移除。                                |
| **通过标准** | 停止后不再收到数据事件；连接干净断开。          |
| **跳过条件** | 适配器不支持取消订阅。                          |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,
    order_qty=Quantity.from_str("0.01"),
    can_unsubscribe=True,
)
```

**Rust 配置：**

```rust
ExecTesterConfig::builder()
    .base(StrategyConfig {
        strategy_id: Some(strategy_id),
        ..Default::default()
    })
    .instrument_id(instrument_id)
    .client_id(client_id)
    .order_qty(Quantity::from("0.01"))
    .can_unsubscribe(true)
    .build()?
```

### TC-E84：对账未结订单

| 字段         | 值                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------- |
| **前置条件** | 交易场所上存在上一会话留下的一笔或多笔未结限价单。                                             |
| **操作**     | 使用 `reconciliation=True` 启动节点。                                                          |
| **事件序列** | 为每个未结订单生成 `OrderStatusReport`。                                                       |
| **通过标准** | 每个未结订单均以正确的 `venue_order_id`、status=ACCEPTED、价格、数量、方向和订单类型载入缓存。 |
| **跳过条件** | 从不。                                                                                         |

**注意事项：**

- 保留上一测试会话中的限价单（停止时不要取消）。
- 使用 `external_order_claims` 声明该金融工具，以便适配器对其订单执行对账。
- 验证对账得到的订单数量与交易场所报告的数量一致。

### TC-E85：对账已成交订单

| 字段         | 值                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------- |
| **前置条件** | 交易场所上存在上一会话中已成交的一笔或多笔订单。                                             |
| **操作**     | 使用 `reconciliation=True` 启动节点。                                                        |
| **事件序列** | 为每笔历史成交生成 `FillReport`。                                                            |
| **通过标准** | 每个已成交订单均以正确的 `venue_order_id`、status=FILLED、成交价格、成交数量和佣金载入缓存。 |
| **跳过条件** | 从不。                                                                                       |

**注意事项：**

- 需要在上一会话中已经成交的订单。
- 验证成交价格、数量和佣金与交易场所报告的值一致。
- 某些适配器可能只报告回溯窗口内的成交。

### TC-E86：对账未平多头持仓

| 字段         | 值                                                                        |
| ------------ | ------------------------------------------------------------------------- |
| **前置条件** | 交易场所上存在上一会话留下的未平多头持仓。                                |
| **操作**     | 使用 `reconciliation=True` 启动节点。                                     |
| **事件序列** | 为多头持仓生成 `PositionStatusReport`。                                   |
| **通过标准** | 持仓以正确的金融工具、side=LONG、数量和与交易场所一致的入场价格载入缓存。 |
| **跳过条件** | 从不。                                                                    |

**注意事项：**

- 在上一会话中开立多头持仓，并在不关闭持仓的情况下停止策略
  （`close_positions_on_stop=False`）。
- 验证对账得到的持仓数量和平均入场价格与交易场所一致。
- 对账后，策略应能管理或关闭此持仓。

### TC-E87：对账未平空头持仓

| 字段         | 值                                                                         |
| ------------ | -------------------------------------------------------------------------- |
| **前置条件** | 交易场所上存在上一会话留下的未平空头持仓。                                 |
| **操作**     | 使用 `reconciliation=True` 启动节点。                                      |
| **事件序列** | 为该空头持仓生成 `PositionStatusReport`。                                  |
| **通过标准** | 持仓以正确的金融工具、side=SHORT、数量和与交易场所一致的入场价格载入缓存。 |
| **跳过条件** | 从不。                                                                     |

**注意事项：**

- 在上一会话中开立空头持仓，并在不关闭持仓的情况下停止策略
  （`close_positions_on_stop=False`）。
- 验证对账得到的持仓数量和平均入场价格与交易场所一致。
- 对账后，策略应能管理或关闭此持仓。

---

## 第 10 组：期权交易

测试期权特有的执行行为。期权金融工具通常与线性衍生品有不同约束：交易场所可能限制订单类型、支持其他定价模式，或不允许条件订单。具体限制因交易场所而异；请查阅适配器指南。

这些测试需要一个 `CryptoOption` 金融工具。请选择具有合理流动性、便于成交的价外期权。

| TC      | 名称                   | 说明                                               | 跳过条件         |
| ------- | ---------------------- | -------------------------------------------------- | ---------------- |
| TC-E90  | 期权 Limit BUY         | 在期权金融工具上挂出限价买单。                     | 不支持期权。     |
| TC-E91  | 期权 Limit SELL        | 在期权金融工具上挂出限价卖单。                     | 不支持期权。     |
| TC-E92  | 使用替代定价的 Limit   | 通过 `order_params` 使用适配器专用定价挂出限价单。 | 不支持替代定价。 |
| TC-E94  | 不支持的订单类型被否决 | 提交适配器不接受的期权订单类型。                   | 不支持期权。     |
| TC-E96  | 条件订单被拒绝         | 在期权上提交止损/条件订单；预期被拒绝。            | 不支持期权。     |
| TC-E99  | 期权 FOK 限价单        | 在期权金融工具上挂出 FOK 限价单。                  | 期权不支持 FOK。 |
| TC-E100 | 取消期权订单           | 取消期权金融工具上的未结限价单。                   | 不支持期权。     |
| TC-E101 | 对账期权持仓           | 对账上一会话留下的未平期权持仓。                   | 不支持期权。     |

### TC-E90：期权 Limit BUY

| 字段         | 值                                                          |
| ------------ | ----------------------------------------------------------- |
| **前置条件** | 适配器已连接，期权金融工具已加载，报价正在流动。            |
| **操作**     | ExecTester 以被动价格在期权上挂出限价买单。                 |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。 |
| **通过标准** | 订单被交易场所接受，金融工具、方向、价格和数量均正确。      |
| **跳过条件** | 适配器不支持期权交易。                                      |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,  # CryptoOption instrument
    order_qty=Quantity.from_str("1"),
    enable_limit_buys=True,
    enable_limit_sells=False,
    tob_offset_ticks=500,
)
```

### TC-E91：期权 Limit SELL

| 字段         | 值                                                          |
| ------------ | ----------------------------------------------------------- |
| **前置条件** | 适配器已连接，期权金融工具已加载，报价正在流动。            |
| **操作**     | ExecTester 以被动价格在期权上挂出限价卖单。                 |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。 |
| **通过标准** | 订单被交易场所接受，金融工具、方向、价格和数量均正确。      |
| **跳过条件** | 适配器不支持期权交易。                                      |

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,  # CryptoOption instrument
    order_qty=Quantity.from_str("1"),
    enable_limit_buys=False,
    enable_limit_sells=True,
    tob_offset_ticks=500,
)
```

### TC-E92：使用替代定价的 Limit

| 字段         | 值                                                          |
| ------------ | ----------------------------------------------------------- |
| **前置条件** | 适配器已连接，期权金融工具已加载。                          |
| **操作**     | 通过 `order_params` 使用适配器专用定价挂出限价单。          |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted`。 |
| **通过标准** | 订单被接受；交易场所确认替代定价模式。                      |
| **跳过条件** | 适配器不支持期权的替代定价模式。                            |

**注意事项：**

- 启用替代定价时，订单对象上的 `price` 字段可能是占位值。请查阅适配器指南了解支持的参数键。
- 示例：OKX 支持 `px_usd`（美元价格）和 `px_vol`（隐含波动率）。
- 在交易场所响应中验证定价模式是否得到正确体现。

**Python 配置：**

```python
ExecTesterConfig(
    instrument_id=instrument_id,  # CryptoOption instrument
    order_qty=Quantity.from_str("1"),
    enable_limit_buys=True,
    enable_limit_sells=False,
    order_params={"px_usd": "100.5"},  # Adapter-specific pricing key
)
```

### TC-E94：期权不支持的订单类型被否决

| 字段         | 值                                                                                      |
| ------------ | --------------------------------------------------------------------------------------- |
| **前置条件** | 适配器已连接，期权金融工具已加载。                                                      |
| **操作**     | 提交交易场所不支持的期权订单类型（例如市价单）。                                        |
| **事件序列** | 取决于适配器：`OrderDenied`（提交前）或 `OrderSubmitted` -> `OrderRejected`（提交后）。 |
| **通过标准** | 订单不成交。否决或拒绝原因提及不支持的订单类型。                                        |
| **跳过条件** | 适配器不支持期权。                                                                      |

**注意事项：**

- 具体拒绝点因适配器而异。某些适配器在提交前于本地否决；另一些会提交并转发交易场所的拒绝。
- ExecTester 可以在期权金融工具上通过 `open_position_on_start_qty` 触发市价单。某些不支持的类型（例如 `MarketToLimit`）需要手动或以程序方式提交。
- 测试适配器文档中列出的每一种不支持类型。

### TC-E96：期权条件订单被拒绝

| 字段         | 值                                                                                      |
| ------------ | --------------------------------------------------------------------------------------- |
| **前置条件** | 适配器已连接，期权金融工具已加载。                                                      |
| **操作**     | 在期权金融工具上提交条件订单。                                                          |
| **事件序列** | 取决于适配器：`OrderDenied`（提交前）或 `OrderSubmitted` -> `OrderRejected`（提交后）。 |
| **通过标准** | 订单不成交。原因提及不支持的条件订单类型。                                              |
| **跳过条件** | 适配器不支持期权，或适配器支持期权条件订单。                                            |

**注意事项：**

- 测试适配器文档中列出的每一种不支持的期权条件订单类型（例如 `STOP_MARKET`、`STOP_LIMIT`、`MARKET_IF_TOUCHED`、`LIMIT_IF_TOUCHED`、`TRAILING_STOP_MARKET`）。
- ExecTester 可以通过期权金融工具上的 `enable_stop_buys`/`enable_stop_sells` 与 `stop_order_type` 触发条件订单。

### TC-E99：期权 FOK 限价单

| 字段         | 值                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------- |
| **前置条件** | 适配器已连接，期权金融工具已加载，订单簿深度充足。                                              |
| **操作**     | 在期权金融工具上挂出采用 `TimeInForce::Fok` 的限价单。                                          |
| **事件序列** | `OrderInitialized` -> `OrderSubmitted` -> `OrderAccepted` -> `OrderFilled` 或 `OrderCanceled`。 |
| **通过标准** | 订单要么完全成交，要么被取消。不得部分成交。                                                    |
| **跳过条件** | 适配器不支持期权 FOK。                                                                          |

**注意事项：**

- 某些交易场所对期权 FOK 订单使用专用订单类型（例如 OKX 使用 `op_fok`）。适配器会透明地处理此映射。
- 正向用例应使用较小数量和激进价格以促成成交。

### TC-E100：取消期权订单

| 字段         | 值                                           |
| ------------ | -------------------------------------------- |
| **前置条件** | 存在 TC-E90 或 TC-E91 留下的未结限价单。     |
| **操作**     | 取消该未结限价单。                           |
| **事件序列** | `OrderPendingCancel` -> `OrderCanceled`。    |
| **通过标准** | 订单已取消；不再出现在交易场所的未结订单中。 |
| **跳过条件** | 适配器不支持期权。                           |

### TC-E101：对账期权持仓

| 字段         | 值                                                   |
| ------------ | ---------------------------------------------------- |
| **前置条件** | 存在上一会话留下的未平期权持仓。                     |
| **操作**     | 使用 `reconciliation=True` 启动节点。                |
| **事件序列** | 为期权持仓生成 `PositionStatusReport`。              |
| **通过标准** | 持仓以正确的金融工具、方向、数量和入场价格载入缓存。 |
| **跳过条件** | 适配器不支持期权。                                   |

**注意事项：**

- 在上一会话中开立期权持仓，并在不平仓的情况下停止
  （`close_positions_on_stop=False`）。
- 验证对账得到的持仓与交易场所报告的状态一致。

---

## ExecTester 配置参考

以下是每个 Python `ExecTesterConfig` 参数的快速参考。默认值为构造完成后的解析值；Rust builder 使用等效默认值。

| 参数                                            | 类型                  | 默认值                 | 影响的组   |
| ----------------------------------------------- | --------------------- | ---------------------- | ---------- |
| `strategy_id`                                   | `StrategyId?`         | `None`                 | 全部       |
| `order_id_tag`                                  | `str?`                | `None`                 | 全部       |
| `use_hyphens_in_client_order_ids`               | `bool`                | `True`                 | 全部       |
| `use_uuid_client_order_ids`                     | `bool`                | `False`                | 全部       |
| `external_order_claims`                         | `list[InstrumentId]?` | `None`                 | 9          |
| `instrument_id`                                 | `InstrumentId`        | `BTCUSDT-PERP.BINANCE` | 全部       |
| `client_id`                                     | `ClientId?`           | `None`                 | 全部       |
| `order_qty`                                     | `Quantity`            | `0.001`                | 全部       |
| `order_display_qty`                             | `Quantity?`           | `None`                 | 2, 7       |
| `order_expire_time_delta_mins`                  | `PositiveInt?`        | `None`                 | 2          |
| `order_params`                                  | `dict?`               | `None`                 | 7, 10      |
| `subscribe_book`                                | `bool`                | `False`                |            |
| `subscribe_quotes`                              | `bool`                | `True`                 |            |
| `subscribe_trades`                              | `bool`                | `True`                 |            |
| `book_type`                                     | `BookType`            | `L2_MBP`               |            |
| `book_depth`                                    | `PositiveInt?`        | `None`                 |            |
| `book_interval_ms`                              | `PositiveInt`         | `1000`                 |            |
| `book_levels_to_print`                          | `PositiveInt`         | `10`                   |            |
| `open_position_on_start_qty`                    | `Decimal?`            | `None`                 | 1, 9       |
| `open_position_on_first_quote`                  | `bool`                | `False`                | 1          |
| `open_position_time_in_force`                   | `TimeInForce`         | `GTC`                  | 1          |
| `enable_limit_buys`                             | `bool`                | `True`                 | 2, 4, 5, 6 |
| `enable_limit_sells`                            | `bool`                | `True`                 | 2, 4, 5, 6 |
| `enable_stop_buys`                              | `bool`                | `False`                | 3, 4       |
| `enable_stop_sells`                             | `bool`                | `False`                | 3, 4       |
| `tob_offset_ticks`                              | `PositiveInt`         | `500`                  | 2, 4       |
| `limit_time_in_force`                           | `TimeInForce?`        | `None`                 | 2, 6       |
| `stop_order_type`                               | `OrderType`           | `STOP_MARKET`          | 3          |
| `stop_offset_ticks`                             | `PositiveInt`         | `100`                  | 3          |
| `stop_limit_offset_ticks`                       | `PositiveInt?`        | `None`                 | 3          |
| `stop_trigger_type`                             | `TriggerType`         | `DEFAULT`              | 3          |
| `stop_time_in_force`                            | `TimeInForce?`        | `None`                 | 3          |
| `trailing_offset`                               | `Decimal?`            | `None`                 | 3          |
| `trailing_offset_type`                          | `TrailingOffsetType`  | `BASIS_POINTS`         | 3          |
| `enable_brackets`                               | `bool`                | `False`                | 6          |
| `batch_submit_limit_pair`                       | `bool`                | `False`                | 2, 5       |
| `bracket_entry_order_type`                      | `OrderType`           | `LIMIT`                | 6          |
| `bracket_offset_ticks`                          | `PositiveInt`         | `500`                  | 6          |
| `modify_orders_to_maintain_tob_offset`          | `bool`                | `False`                | 4          |
| `modify_stop_orders_to_maintain_offset`         | `bool`                | `False`                | 4          |
| `cancel_replace_orders_to_maintain_tob_offset`  | `bool`                | `False`                | 4          |
| `cancel_replace_stop_orders_to_maintain_offset` | `bool`                | `False`                | 4          |
| `use_post_only`                                 | `bool`                | `False`                | 2, 6, 7, 8 |
| `limit_aggressive`                              | `bool`                | `False`                | 2          |
| `use_quote_quantity`                            | `bool`                | `False`                | 1, 7       |
| `emulation_trigger`                             | `TriggerType?`        | `None`                 | 2, 3       |
| `use_individual_cancels_on_stop`                | `bool`                | `False`                | 5          |
| `cancel_orders_on_stop`                         | `bool`                | `True`                 | 5, 9       |
| `close_positions_on_stop`                       | `bool`                | `True`                 | 9          |
| `close_positions_qty_precision`                 | `int?`                | `None`                 | 9          |
| `close_positions_time_in_force`                 | `TimeInForce?`        | `None`                 | 9          |
| `reduce_only_on_stop`                           | `bool`                | `True`                 | 7, 9       |
| `use_batch_cancel_on_stop`                      | `bool`                | `False`                | 5          |
| `dry_run`                                       | `bool`                | `False`                |            |
| `log_data`                                      | `bool`                | `True`                 |            |
| `test_reject_post_only`                         | `bool`                | `False`                | 8          |
| `test_reject_reduce_only`                       | `bool`                | `False`                | 8          |
| `test_modify_rejected`                          | `bool`                | `False`                | 4          |
| `can_unsubscribe`                               | `bool`                | `True`                 | 9          |
| `clamp_to_instrument_price_range`               | `bool`                | `False`                | 1-8, 10    |
| `log_events`                                    | `bool`                | `True`                 | 全部       |
| `log_commands`                                  | `bool`                | `True`                 | 全部       |
