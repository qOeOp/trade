# 持仓

本指南介绍 VibeTrader 中持仓的工作方式，包括持仓生命周期、如何根据订单成交聚合持仓、盈亏计算，以及净额 OMS 配置中的重要概念--持仓快照。

## 概述

持仓表示对市场中某一金融工具的未平风险敞口。持仓会聚合特定金融工具的全部成交，并持续计算未实现盈亏、平均入场价和总敞口等指标，因此是跟踪交易表现和风险的基础。

订单成交时，系统会自动创建持仓并跟踪其从建立到平仓的全过程。平台通过 OMS（订单管理系统）配置支持净额和对冲两种持仓管理方式。

## 持仓生命周期

### 建立

系统在首次成交时建立持仓：

- **NETTING OMS**：某金融工具首次成交时建立（每个金融工具一个持仓）。
- **HEDGING OMS**：新的 `position_id` 首次成交时建立（每个金融工具可以有多个持仓）。

持仓会跟踪：

- 开仓订单及其成交明细。
- 入场方向（`LONG` 或 `SHORT`）。
- 初始数量和平均价格。
- 初始化和建立持仓的时间戳。

:::tip
在参与者/策略中，可以通过 Cache 的 `self.cache.position(position_id)` 或
`self.cache.positions(instrument_id=instrument_id)` 访问持仓。
:::

### 更新

发生后续成交时，持仓会：

- 聚合买入和卖出成交的数量。
- 重新计算平均入场价和平均离场价。
- 更新峰值数量（曾达到的最大敞口）。
- 跟踪所有关联的订单 ID 和交易 ID。
- 按货币累计佣金。

### 平仓

净数量归零（`FLAT`）时，持仓关闭。平仓时：

- 记录平仓订单 ID。
- 计算从开仓到平仓的持续时间。
- 计算最终已实现盈亏。
- 在 `NETTING` OMS 中，如果之后重新建立该持仓，引擎会为已经关闭的状态创建快照，以保留历史盈亏（参见[持仓快照](#持仓快照)）。

## 订单成交聚合

持仓通过聚合订单成交，准确反映市场风险敞口。聚合过程会处理两个交易方向：

### 买入成交

BUY 订单成交时：

- 增加多头敞口或减少空头敞口。
- 对开仓交易更新平均入场价。
- 对平仓交易更新平均离场价。
- 计算任何已平仓部分的已实现盈亏。

### 卖出成交

SELL 订单成交时：

- 增加空头敞口或减少多头敞口。
- 对开仓交易更新平均入场价。
- 对平仓交易更新平均离场价。
- 计算任何已平仓部分的已实现盈亏。

### 净持仓计算

持仓使用 `signed_qty` 字段表示净敞口：

- 正值表示 `LONG` 持仓。
- 负值表示 `SHORT` 持仓。
- 零表示 `FLAT`（已关闭）持仓。

```python
# Example: Position aggregation
# Initial BUY 100 units at $50
signed_qty = +100  # LONG position

# Subsequent SELL 150 units at $55
signed_qty = -50  # Now SHORT position

# Final BUY 50 units at $52
signed_qty = 0  # Position FLAT (closed)
```

## 持仓调整

持仓调整用于跟踪常规订单成交之外发生的数量或盈亏变化，确保持仓数量准确反映真实净资产头寸。系统会为这些情况生成 `PositionAdjusted` 事件。

### 基础货币佣金

交易现货货币对（例如 BTC/USDT）或外汇现货时，以基础货币支付的佣金会直接影响实际收付的净数量：

- **开仓成交**：从交易数量中扣除佣金。买入 1.0 BTC 并支付 0.001 BTC 佣金，得到的净多头持仓为 0.999 BTC。
- **平仓成交**：佣金会计入 `signed_qty`，因为它会影响实际库存。卖出 0.999 BTC 的 LONG 持仓并支付 0.000999 BTC 佣金后，实际总共交付 0.999999 BTC，因此留下的是 SHORT 0.000999 BTC，而非 FLAT。
- **反向持仓**：佣金会影响反向前后两侧的最终持仓规模。

:::note
基础货币佣金只适用于佣金币种与 `instrument.base_currency` 一致的现货货币对和外汇现货金融工具。对于其他金融工具，佣金会单独跟踪，不影响持仓数量。
:::

### 资金费用

资金费用调整用于跟踪永续期货的周期性付款，不会改变持仓数量。这类事件以 `quantity_change = None` 记录，并且可以包含盈亏影响。

### 调整记录

所有调整都会保留在持仓事件历史中：

- `position.adjustments()` 返回全部 `PositionAdjusted` 事件的列表。
- 每项调整都包含类型（`COMMISSION` 或 `FUNDING`）、数量变化和时间戳。
- 持仓关闭后重新建立时，调整历史会被清除。清除事件时，与已移除成交关联的佣金调整会重新生成；非佣金调整（例如资金费用）则会保留。

## OMS 类型与持仓管理

VibeTrader 支持两种主要 OMS 类型，它们会从根本上影响持仓的跟踪和管理方式。此外还有 `OmsType.UNSPECIFIED` 选项，默认采用组件上下文中的设置。完整说明请参阅[执行指南](execution.md#order-management-system-oms)。

### `NETTING`

在 `NETTING` 模式中，同一金融工具的所有成交都会聚合到一个持仓：

- 每个金融工具 ID 只有一个持仓。
- 所有成交都计入同一个持仓。
- 净数量变化时，持仓可以从 `LONG` 反转为 `SHORT`（反之亦然）。
- 历史快照会保留已经关闭的持仓状态。

### `HEDGING`

在 `HEDGING` 模式中，同一金融工具可以同时存在多个持仓：

- 可以同时存在多个 `LONG` 和 `SHORT` 持仓。
- 每个持仓都有唯一的持仓 ID。
- 各持仓彼此独立跟踪。
- 不会跨持仓自动轧差。
- 已关闭持仓会保留在缓存历史中，但不会重新建立；新成交会创建新持仓。

:::warning
使用 `HEDGING` 模式时，请注意每个持仓会独立占用保证金，因此保证金要求更高。某些交易场所可能不支持真正的对冲模式，并会自动轧差持仓。
:::

### 策略 OMS 与交易场所 OMS

平台允许策略和交易场所使用不同的 OMS 配置：

| 策略 OMS  | 交易场所 OMS | 行为                                          |
| --------- | ------------ | --------------------------------------------- |
| `NETTING` | `NETTING`    | 策略和交易场所层面均为每个金融工具一个持仓。  |
| `HEDGING` | `HEDGING`    | 两个层面都支持多个持仓。                      |
| `NETTING` | `HEDGING`    | 交易场所跟踪多个持仓，Vibe 维护一个持仓。     |
| `HEDGING` | `NETTING`    | 交易场所跟踪一个持仓，Vibe 维护多个虚拟持仓。 |

:::tip
对于大多数交易情形，让策略和交易场所采用一致的 OMS 类型可以简化持仓管理。覆盖配置主要用于自营交易台，或用于对接旧系统。有关交易场所特定的 OMS 配置，请参阅[实盘指南](live.md)。
:::

## 持仓快照

持仓快照是 `NETTING` OMS 配置中的一项重要功能，它会保留已关闭持仓的状态，以便准确跟踪和报告盈亏。

### 快照的重要性

在 `NETTING` 系统中，持仓关闭（变为 `FLAT`）后又因新交易重新建立时，持仓对象会重置以跟踪新的敞口。如果没有快照，上一持仓周期的历史已实现盈亏就会丢失。

### 工作原理

`NETTING` 持仓关闭后，如果同一金融工具又产生新成交，执行引擎会先为已关闭的持仓状态创建快照，再将其重置。快照保留：

- 最终数量和价格。
- 已实现盈亏。
- 所有成交事件。
- 佣金总额。

该快照按持仓 ID 索引并存储在缓存中。持仓随后针对新周期重置，之前的快照仍可访问。Portfolio 会聚合全部快照中的盈亏，以得出准确总额。

对早期周期成交进行更正的成交作废是唯一例外。此类更正会改变已存快照所描述的周期边界，因此引擎会按照更正后的历史实际关闭的周期替换快照，确保每个周期只计入一次。参见 [NETTING 周期中的持仓重放](execution.md#position-replay-across-netting-cycles)。

:::note
这一历史快照机制不同于可选的持仓状态快照（`snapshot_positions`）；后者会定期记录未平持仓状态，用于遥测。`snapshot_positions` 和 `snapshot_positions_interval_secs` 设置请参阅[实盘指南](live.md)。
:::

### 示例情景

```python
# NETTING OMS Example
# Cycle 1: Open LONG position
BUY 100 units at $50   # Position opens
SELL 100 units at $55  # Position closes, PnL = $500
# Snapshot taken preserving $500 realized PnL

# Cycle 2: Open SHORT position
SELL 50 units at $54   # Position reopens (SHORT)
BUY 50 units at $52    # Position closes, PnL = $100
# Snapshot taken preserving $100 realized PnL

# Total realized PnL = $500 + $100 = $600 (from snapshots)
```

如果没有快照，只能取得最近一个周期的盈亏，报告和分析结果会因此失真。

## 盈亏计算

VibeTrader 提供的盈亏计算会考虑金融工具规格和市场惯例。

### 已实现盈亏

持仓部分或全部关闭时进行计算：

```python
# For standard instruments
realized_pnl = (exit_price - entry_price) * closed_quantity * multiplier

# For inverse instruments (side-aware)
# LONG: realized_pnl = closed_quantity * multiplier * (1/entry_price - 1/exit_price)
# SHORT: realized_pnl = closed_quantity * multiplier * (1/exit_price - 1/entry_price)
```

引擎会根据持仓方向自动应用正确公式。

### 未实现盈亏

使用未平持仓的当前市场价格计算。`price` 参数可以接受任意参考价格（买价、卖价、中间价、最新价或标记价）：

```python
position.unrealized_pnl(last_price)  # Using last traded price
position.unrealized_pnl(bid_price)  # Conservative for LONG positions
position.unrealized_pnl(ask_price)  # Conservative for SHORT positions
```

对于 `FLAT` 持仓，无论传入什么价格，都返回 `Money(0, cost_currency)`。

### 总盈亏

合并已实现和未实现部分：

```python
total_pnl = position.total_pnl(current_price)
# Returns realized_pnl + unrealized_pnl
```

### 货币相关事项

- 盈亏以金融工具的成本货币计算：线性合约使用计价货币，反向合约使用基础货币，quanto 合约使用结算货币。
- 对于外汇，成本货币通常是计价货币。
- Portfolio 按金融工具，以成本货币聚合已实现盈亏。
- 多货币总额需要在 Position 类之外进行换算。

## 佣金和成本

持仓会跟踪所有交易成本：

- 佣金按货币累计。
- 每笔成交的佣金都会加入累计总额。
- 支持多种佣金币种。
- 只有以持仓成本货币计价的佣金才会计入已实现盈亏。
- 其他佣金会单独跟踪，可能需要换算。

```python
commissions = position.commissions()
# Returns list[Money] with aggregated commission totals per currency

notional = position.notional_value(current_price)
# Returns Money in quote (linear), base (inverse), or settlement currency (quanto)
```

**限制：**

- 如果反向金融工具未设置 `base_currency`，程序会 panic。

## 持仓属性和状态

### 标识符

- `id`：唯一持仓标识符。
- `instrument_id`：所交易的金融工具。
- `account_id`：持仓所在账户。
- `trader_id`：持仓所属交易者。
- `strategy_id`：管理持仓的策略。
- `opening_order_id`：建立持仓的客户端订单 ID。
- `closing_order_id`：关闭持仓的客户端订单 ID。

### 持仓状态

- `side`：当前持仓方向（`LONG`、`SHORT` 或 `FLAT`）。
- `entry`：当前未平持仓的方向（`LONG` 为 `Buy`，`SHORT` 为 `Sell`）。持仓反向时会更新。
- `quantity`：当前持仓的绝对数量。
- `signed_qty`：带符号的持仓数量（`LONG` 为正，`SHORT` 为负）。
- `peak_qty`：持仓生命周期内达到的最大数量。
- `is_open`：持仓当前是否未平。
- `is_closed`：持仓是否已关闭（`FLAT`）。
- `is_long`：持仓方向是否为 `LONG`。
- `is_short`：持仓方向是否为 `SHORT`。

### 定价与估值

- `avg_px_open`：平均入场价。
- `avg_px_close`：平仓时的平均离场价。
- `realized_pnl`：已实现盈亏。
- `realized_return`：以小数表示的已实现收益率（例如 0.05 表示 5%）。
- `quote_currency`：金融工具的计价货币。
- `base_currency`：适用时的基础货币。
- `settlement_currency`：盈亏结算货币。

### 金融工具规格

- `multiplier`：合约乘数。
- `price_precision`：价格的小数精度。
- `size_precision`：数量的小数精度。
- `is_inverse`：是否为反向金融工具。

### 时间戳

- `ts_init`：持仓初始化时间。
- `ts_opened`：持仓建立时间。
- `ts_last`：最近更新时间。
- `ts_closed`：持仓关闭时间。
- `duration_ns`：从开仓到平仓的持续时间（纳秒）。

### 关联数据

- `symbol`：金融工具的行情代码。
- `venue`：交易场所。
- `client_order_ids`：与持仓关联的所有客户端订单 ID。
- `venue_order_ids`：与持仓关联的所有交易场所订单 ID。
- `trade_ids`：交易场所提供的所有交易/成交 ID。
- `events`：应用于持仓的所有订单成交事件。
- `event_count`：应用的成交事件总数。
- `last_event`：最近的成交事件。
- `last_trade_id`：最近的交易 ID。

:::info
完整类型信息和详细属性文档请参阅 Position [API 参考](/docs/python-api-latest/model/position.html#vibe_trader.model.position.Position)。
:::

## 事件与跟踪

持仓会维护完整的事件历史：

- 按时间顺序保存所有订单成交事件。
- 跟踪关联的客户端订单 ID。
- 保留交易场所提供的交易 ID。
- 事件计数表示应用的成交总数。

这些历史数据可用于：

- 详细持仓分析。
- 交易对账。
- 业绩归因。
- 审计追踪。

:::tip
使用 `position.events()` 访问完整成交历史以进行对账。
`position.trade_ids()` 的结果可用于与经纪商对账单匹配。
对账最佳实践请参阅[执行指南](execution.md)。
:::

## 数值精度

持仓的盈亏和平均价格计算使用 64 位浮点（`f64`）运算。定点类型（`Price`、`Quantity`、`Money`）会在所配置的小数位上保持精确，但内部计算会转换为 `f64`，以兼顾性能并避免溢出。

### 设计依据

平台在持仓计算中使用 `f64`，以平衡性能和准确性：

- 浮点运算明显快于任意精度运算。
- 即使使用 128 位整数，原始整数乘法仍可能溢出。
- 每次计算都从精确定点值开始，避免累计误差。
- IEEE-754 双精度提供约 15 位十进制数字的精度。

### 已验证的精度特征

测试确认，在典型交易情形下，`f64` 运算能够保持准确性：

- 标准金额：对于标准货币中 ≥ 0.01 的金额，不损失精度。
- 高精度金融工具：9 位小数的加密货币价格可保持在 1e-6 容差内。
- 连续成交：100 次成交不产生漂移（佣金精度达到 1e-10）。
- 极端价格：可处理 0.00001 至 99,999.99999 的范围而不溢出。
- 往返交易：以相同价格开仓和平仓会得出精确盈亏（仅剩佣金）。

实现细节请参阅 `crates/model/src/position.rs` 中的 `test_position_pnl_precision_*` 测试。

:::note
如果监管合规或审计追踪要求精确的十进制运算，可考虑使用外部库提供的 `Decimal` 类型。小于 `f64` epsilon（约 1e-15）的极小金额可能舍入为零。这不会影响使用标准货币精度（通常为 2-9 位小数）的实际交易情形。
:::

## 与其他组件集成

持仓会与多个关键组件交互：

- **Portfolio**：跨金融工具和策略聚合持仓。
- **ExecutionEngine**：根据成交创建和更新持仓。
- **Cache**：存储持仓状态和快照。
- **RiskEngine**：监控持仓限制和风险敞口。

:::note
价差金融工具不会创建持仓。虽然条件订单仍可针对价差触发，但不会关联持仓。引擎会将价差金融工具与常规持仓分开处理。
:::

## 总结

持仓是跟踪交易活动和表现的核心。构建交易策略时，需要理解持仓如何聚合成交、计算盈亏以及处理不同 OMS 配置。持仓快照可在 `NETTING` 模式下准确保留历史记录，事件历史则支持详细分析和对账。

## 相关指南

- [事件](events/) - 成交如何生成持仓事件。
- [订单](orders/) - 创建和修改持仓的订单。
- [执行](execution.md) - 更新持仓的成交处理。
- [投资组合](portfolio.md) - 投资组合层面的持仓聚合。
