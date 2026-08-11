# 账户核算

账户核算子系统跟踪平台所连接每个账户的余额、保证金和盈亏。本指南介绍数据模型、策略使用的查询 API，以及适配器作者为确保各交易场所行为一致而必须遵循的约定。

这些内容同样适用于回测和实盘交易。回测专用配置（起始余额、各交易场所的保证金模型选择）请参阅[回测](backtesting/)。

## 账户类型

将交易场所接入实盘交易或回测引擎时，可以通过 `account_type` 选择三种账户核算模式之一：

| 账户类型 | 典型用途                        | 引擎锁定的金额                                   |
| -------- | ------------------------------- | ------------------------------------------------ |
| 现金     | 现货交易（例如 BTC/USDT、股票） | 每个待执行订单可能建立的持仓所对应的名义价值。   |
| 保证金   | 衍生品或任何允许使用杠杆的产品  | 每笔订单的初始保证金，以及未平持仓的维持保证金。 |
| 投注     | 体育博彩、博彩坐庄              | 交易场所要求的投注额；不使用杠杆。               |

### 现金账户

现金账户全额结算交易，不使用杠杆，因此不存在保证金概念。锁定余额反映为待执行订单预留的名义金额。

### 保证金账户

保证金账户支持期货、杠杆加密货币永续合约等需要抵押品的金融工具。它们会跟踪账户余额，为未执行订单和未平持仓预留保证金，并按金融工具应用可配置的杠杆。保证金分两个作用域跟踪，参见下文[保证金作用域](#保证金作用域)。

**关键术语**：

- **杠杆**：相对于账户权益放大风险敞口。杠杆越高，潜在收益和风险都越大。
- **初始保证金**：提交订单时预留的抵押品。
- **维持保证金**：维持未平持仓所需的最低抵押品。
- **锁定余额**：预留作抵押品、不可用于新订单的资金。

:::note
只减仓订单不会增加现金账户的 `balance_locked`，也不会增加保证金账户的初始保证金，因为它们只能减少风险敞口。
:::

### 投注账户

投注账户专用于以一定投注额赢取或损失固定赔付的交易场所，例如预测市场和体育博彩平台。引擎只锁定交易场所要求的投注额；杠杆和保证金均不适用。

## 余额模型

一个 `AccountBalance` 包含同一货币下的三个值：

- `total`：交易场所报告的总余额数值（具体可能是钱包余额、净清算价值或保证金余额）。
- `locked`：为未执行订单和未平持仓预留的金额。
- `free`：可用于新订单的金额（`total - locked`）。

在货币精度范围内，必须始终满足不变量 `total == locked + free`。

Python 的 `AccountBalance(total, locked, free)` 构造函数要求预先提供全部三个字段。使用 Rust 编写的适配器代码还有两个派生构造函数，可以集中保证该不变量；当交易场所只报告三个值中的两个时，应优先使用它们，而不是 `AccountBalance::new`：

| Rust 辅助函数                           | 适用情形                                                          |
| --------------------------------------- | ----------------------------------------------------------------- |
| `AccountBalance::from_total_and_locked` | 交易场所报告总额和锁定额；派生 `free` 并将其限制在 `[0, total]`。 |
| `AccountBalance::from_total_and_free`   | 交易场所报告总额和可用额；派生 `locked` 并进行限制。              |
| `AccountBalance::new`                   | 三个值都已知且一致（测试、直接传递）。                            |

当 `total >= 0` 时，这些辅助函数会把派生字段限制在 `[0, total]`，因此交易场所舍入造成的短暂超出不会使账户进入不一致状态。

## 货币与估值契约

账户核算数值会保留其源货币，直到显式换算成功。这样可以避免把有效数值错误标记为另一种货币，也不会把不可用值当作零处理。

| 数值                     | 货币契约                                                    |
| ------------------------ | ----------------------------------------------------------- |
| 金融工具成本货币         | 反向合约用基础货币，quanto 合约用结算货币，其他用计价货币。 |
| 持仓盈亏                 | 使用建立持仓时记录的金融工具成本货币。                      |
| 计算得出的锁定额和保证金 | 每笔计算金额保留各自货币，并独立进行换算。                  |
| 投资组合聚合值           | 保留原生货币分桶；换算成功后也可使用账户基础货币。          |

聚合时只会合并货币兼容的 `Money` 值。没有基础货币的账户会保留各自独立的原生货币分桶。查询单个金融工具的已实现盈亏时，如果结果混合多种货币，则返回不可用，而不会强行合并。

账户核算和估值路径还遵循以下规则：

- 名义价值、盈亏、费用、锁定余额和保证金的结果如果无效或无法表示，会产生错误、不可用值或未定价状态，不会用零代替。重新计算已实现盈亏失败时，也会清除之前缓存的结果。
- 对于没有基础货币的多货币现金账户，`equity()` 只计算一次已入账的非反向基础资产。`mark_values()` 仍是总持仓价值查询，因此会包含该资产。
- MTM 快照会区分沿用的过期输入与从未具备完整估值数据的持仓。过期价格元数据只覆盖未平金融工具与持仓方向的组合。

权益公式、价格和汇率选择、快照元数据以及缺失价格的查询范围，请参阅[投资组合](portfolio.md#equity-and-mark-to-market)。

## 保证金作用域

`MarginBalance` 有四个字段：`initial`、`maintenance`、`currency`，以及用于选择两种作用域之一的 `Optional[InstrumentId]`。

### 按金融工具作用域

`MarginBalance.instrument_id` 设置为具体金融工具。适用于：

- 逐仓保证金（每个持仓单独使用抵押品）。
- 回测或计算得出的保证金；此时 `AccountsManager` 在本地按金融工具，根据未执行订单和未平持仓派生保证金。

### 账户级作用域

`MarginBalance.instrument_id` 为 `None`，条目以其 `currency`（抵押品货币）为键。适用于按抵押品货币报告单个聚合值的全仓保证金交易场所。交易场所可以发出一个账户级条目（单一抵押品全仓保证金），也可以发出多个条目（每种抵押币一个）。

两个作用域会共存于同一个 `MarginAccount` 的不同内部存储中。`AccountState` 事件可以携带任一作用域或两个作用域的条目，`MarginAccount.apply()` 会根据是否设置 `instrument_id`，把每个条目路由到正确的存储。

:::note
`MarginAccount.apply()` 会用传入事件**替换**两个存储，而不是与之前的状态合并。发出部分快照的适配器必须在每次更新中包含所有有效保证金条目，否则缺失条目会被删除，直到下一次完整快照到达。余额列表也会以同样方式替换。
:::

## 策略查询 API

应使用与交易场所报告形态相符的查询。交易场所按金融工具报告保证金时，使用 `InstrumentId` 查询；报告账户级保证金时，则使用 `Currency` 查询。

| 所需数值的作用域           | 使用                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| 按金融工具的保证金（逐仓） | `margin(id)` / `margin_init(id)` / `margin_maint(id)`                                           |
| 某种抵押品的账户级保证金   | `margin_for_currency(ccy)` / `margin_init_for_currency(ccy)` / `margin_maint_for_currency(ccy)` |
| 两个作用域的合计           | `total_margin_init(ccy)` / `total_margin_maint(ccy)`                                            |

单项查询在条目不存在时返回 `None`；合计查询始终返回 `Money`（如果没有匹配项，则返回该货币下的零值）。

:::note
下列名称是 `MarginAccount` 上的 Python / Cython API。使用 `vibe-model` crate 的 Rust 策略则调用 `account_margin(&currency)`、`account_initial_margin(&currency)`、`account_maintenance_margin(&currency)`、`total_initial_margin(currency)` 和 `total_maintenance_margin(currency)`：两者都按 `Option<InstrumentId>` 区分作用域，只是方法名称不同。
:::

### 按金融工具查询（`MarginAccount`）

- `margin(instrument_id) -> MarginBalance | None`
- `margin_init(instrument_id) -> Money | None`
- `margin_maint(instrument_id) -> Money | None`
- `margins() -> dict[InstrumentId, MarginBalance]`（所有按金融工具条目）
- `margins_init() -> dict[InstrumentId, Money]`
- `margins_maint() -> dict[InstrumentId, Money]`

这些方法只查询按金融工具存储。在全仓保证金交易场所，它们会返回空字典或 `None`；此时应使用下文的账户级查询。

### 账户级查询（`MarginAccount`）

- `margin_for_currency(currency) -> MarginBalance | None`
- `margin_init_for_currency(currency) -> Money | None`
- `margin_maint_for_currency(currency) -> Money | None`
- `account_margins() -> dict[Currency, MarginBalance]`（所有账户级条目）
- `account_margins_init() -> dict[Currency, Money]`
- `account_margins_maint() -> dict[Currency, Money]`

### 合计（`MarginAccount`）

以下方法会针对指定货币，汇总按金融工具和账户级两个作用域中的条目：

- `total_margin_init(currency) -> Money`
- `total_margin_maint(currency) -> Money`

如果策略在可能同时出现两种作用域的交易场所交易（例如逐仓持仓与全仓抵押品并存），这些方法很有用。

### 清除账户级条目

- `clear_account_margin(currency)` 会删除指定抵押品货币的账户级条目，并触发余额重新计算。按金融工具条目的对应方法是 `clear_margin(instrument_id)`。

这些是系统方法；适配器代码通过 `MarginAccount.apply()` 隐式调用它们，策略通常不需要直接调用。

### 投资组合级查询

保证金查询：

- `portfolio.margins_init(venue=..., account_id=...) -> dict[InstrumentId, Money]`
- `portfolio.margins_maint(venue=..., account_id=...) -> dict[InstrumentId, Money]`

它们对应 `MarginAccount.margins_init` / `margins_maint`，只返回按金融工具条目。对于全仓保证金交易场所的账户级数据，应通过 `portfolio.account(venue).margin_init_for_currency(ccy)` 直接查询账户。

盈亏、敞口、按市值计价和权益查询都接受 `venue` 和可选的 `account_id`，用于限定多账户交易场所中的账户范围：

- `portfolio.unrealized_pnls(venue=..., account_id=...) -> dict[Currency, Money]`
- `portfolio.realized_pnls(venue=..., account_id=...) -> dict[Currency, Money]`
- `portfolio.total_pnls(venue=..., account_id=...) -> dict[Currency, Money]`
- `portfolio.net_exposures(venue=..., account_id=...) -> dict[Currency, Money]`
- `portfolio.mark_values(venue=..., account_id=...) -> dict[Currency, Money]`
- `portfolio.equity(venue=..., account_id=...) -> dict[Currency, Money]`
- `portfolio.missing_price_instruments(venue) -> list[InstrumentId]`

权益公式、价格回退链、基础货币换算行为和仅警告一次的缺失价格跟踪器，请参阅[投资组合指南](portfolio.md#equity-and-mark-to-market)。

### 示例

单一抵押品全仓保证金（一个账户级条目）：

```python
usdc_margin = margin_account.margin_init_for_currency(USDC)
usdc_total = margin_account.total_margin_init(USDC)
```

逐币种全仓保证金（每种抵押品货币一个条目）：

```python
for ccy, margin_balance in margin_account.account_margins().items():
    print(ccy, margin_balance.initial, margin_balance.maintenance)
```

## 保证金模型

VibeTrader 为计算路径提供灵活的保证金计算模型。计算路径包括回测，以及以 `calculate_account_state=True` 运行、用于对账的实盘策略。交易场所报告的保证金会直接进入 `_account_margins` 或 `_margins`，不经过模型。

### 概述

不同交易场所采用不同的杠杆处理方式：

- **传统经纪商**（Interactive Brokers、TD Ameritrade）：无论杠杆如何，都使用固定保证金比例。
- **加密货币交易所**（Binance 等）：杠杆可能降低保证金要求。

两个内置模型都使用金融工具的 `margin_init` 和 `margin_maint` 字段，按名义价值的一定比例计算保证金。两者的唯一区别在于杠杆是否会降低预留金额。对于真正按合约收取固定保证金的交易场所（CME / ICE），应设置 `instrument.margin_init` 和 `margin_maint`，使按比例计算的结果还原为所需金额。

### HEDGING 模式下的净额计算

在 `OmsType.HEDGING` 下，每次成交都会建立独立的 `Position`，因此一个账户可以持有同一金融工具的多个未平子持仓。账户管理器按 `ts_opened` 顺序，把这些子持仓合并到一个假设的 NETTING 持仓上，再对最终的带符号净数量和平均开仓价执行一次保证金模型。

重放遵循与 `Position.apply` 相同的规则：同向成交生成按数量加权的平均开仓价；反向成交按现有平均价部分平仓；成交跨越零点时，剩余反向持仓采用该笔反向成交的价格。`ts_opened` 相同的子持仓按 `(ts_opened, position_id)` 顺序归并，因此结果不受缓存迭代顺序影响。

对于相同成交序列，HEDGING 与 NETTING 账户会计算出相同的维持保证金；保证金要求随净经济敞口变化。

### 可用模型

#### `StandardMarginModel`

使用固定比例，不除以杠杆，符合传统经纪商的行为。

```python
# Fixed percentages - leverage ignored
margin = notional * instrument.margin_init
```

- 初始保证金：`notional_value * instrument.margin_init`
- 维持保证金：`notional_value * instrument.margin_maint`

**适用情形**：传统经纪商（如 Interactive Brokers），以及采用固定保证金要求的外汇经纪商。

#### `LeveragedMarginModel`

将保证金要求除以杠杆。

```python
# Leverage reduces margin requirements
adjusted_notional = notional / leverage
margin = adjusted_notional * instrument.margin_init
```

- 初始保证金：`(notional_value / leverage) * instrument.margin_init`
- 维持保证金：`(notional_value / leverage) * instrument.margin_maint`

**适用情形**：使用杠杆降低保证金要求的加密货币交易所，以及杠杆会影响保证金要求的其他交易场所。

### 默认行为

`MarginAccount` 默认使用 `LeveragedMarginModel`。回测可以把 `StandardMarginModel` 直接传给 `BacktestVenueConfig.margin_model` 来选择该模型。

### 示例：EUR/USD

- **金融工具**：EUR/USD
- **数量**：100,000 EUR
- **价格**：1.10000
- **名义价值**：$110,000
- **杠杆**：50x
- **`instrument.margin_init`**：3%

| 模型 | 计算                   | 结果   | 比例  |
| ---- | ---------------------- | ------ | ----- |
| 标准 | $110,000 × 0.03        | $3,300 | 3.00% |
| 杠杆 | ($110,000 ÷ 50) × 0.03 | $66    | 0.06% |

对于余额 $10,000 的账户，标准模型会阻止这笔交易，杠杆模型则允许交易。

### Python 模型选择

将 `StandardMarginModel()` 或 `LeveragedMarginModel()` 直接传给回测交易场所。当前 Python 绑定不接受自定义保证金模型子类，也不接受 `MarginModelConfig` 包装器。参见[回测](backtesting/accounts-and-margin.md#margin-models)。

## 适配器约定

实盘适配器会把交易场所响应转换为 `AccountBalance` 和 `MarginBalance` 实例。适配器作者必须遵循以下约定：

### 构建 `AccountBalance`

应优先使用派生辅助函数，以便集中执行取值限制和 `total == locked + free` 不变量。只有三个值都已具备权威性、可以直接传递时（例如测试），才适合手动计算三个字段并传给 `AccountBalance::new`。

### 构建 `MarginBalance`

选择与交易场所报告内容相符的作用域：

| 交易场所报告内容                       | 作用域     | 生成方式                                                |
| -------------------------------------- | ---------- | ------------------------------------------------------- |
| 按金融工具报告（逐仓持仓）             | 按金融工具 | `MarginBalance::new(initial, maint, Some(id))`          |
| 每种抵押品报告一个聚合值（全仓保证金） | 账户级     | `MarginBalance::new(initial, maint, None)`              |
| 报告多个聚合值，每种抵押品一个         | 账户级     | 每种货币一个 `MarginBalance`，并设 `instrument_id=None` |

:::note
系统不使用合成的 `ACCOUNT.{VENUE}` 或 `ACCOUNT-{COIN}.{VENUE}` `InstrumentId` 占位符。账户级条目携带 `instrument_id=None`，并以 `currency` 为键。
:::

## 相关指南

- [回测](backtesting/)：起始余额、保证金模型和回测专用账户设置。
- [投资组合](portfolio.md)：投资组合级盈亏、敞口和货币换算。
- [持仓](positions.md)：持仓生命周期、聚合和盈亏。
- [适配器](adapters.md)：适配器作者应遵循的要求和最佳实践。
