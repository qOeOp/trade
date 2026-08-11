# Greeks

Vibe 提供两种处理期权 Greeks（期权价格对市场变量变化的敏感度）的方式：

1. **交易场所提供的 Greeks（Rust/PyO3）**：Deribit、Bybit 和 OKX 等交易场所通过 `OptionGreeks` 数据类型和期权链聚合系统流式传入实时 Greeks。
2. **本地 Greeks 计算器（Cython/Python 和 Rust/PyO3）**：`GreeksCalculator` 类根据缓存的市场数据计算 Black-Scholes Greeks，并支持投资组合聚合、冲击情景和 beta 加权。

两种方式既可独立使用，也可结合使用。交易场所提供的 Greeks 通过数据订阅系统到达，无需本地计算。本地计算器则适用于不提供 Greeks 数据流的交易场所、回测以及自定义调整（冲击、beta 加权和百分比 Greeks）。

## 交易场所提供的 Greeks（Rust/PyO3）

### OptionGreeks

`OptionGreeks` 类型表示交易场所为单个期权合约提供的敏感度。它是一个通过 PyO3 向 Python 公开的 Rust 原生类型。

| 字段               | 类型               | 说明                                     |
| ------------------ | ------------------ | ---------------------------------------- |
| `instrument_id`    | `InstrumentId`     | 这些 Greeks 所对应的期权合约。           |
| `convention`       | `GreeksConvention` | Greeks 的计价基准约定。                  |
| `delta`            | `float`            | 标的每变化一个单位时，期权价格的变化率。 |
| `gamma`            | `float`            | 标的每变化一个单位时，delta 的变化率。   |
| `vega`             | `float`            | 隐含波动率变化 1% 时的敏感度。           |
| `theta`            | `float`            | 每日时间衰减（dV/dt / 365.25）。         |
| `rho`              | `float`            | 对利率变化的敏感度。                     |
| `mark_iv`          | `float` 或 None    | 标记隐含波动率。                         |
| `bid_iv`           | `float` 或 None    | 买价隐含波动率。                         |
| `ask_iv`           | `float` 或 None    | 卖价隐含波动率。                         |
| `underlying_price` | `float` 或 None    | 计算时的标的价格。                       |
| `open_interest`    | `float` 或 None    | 合约未平仓量。                           |
| `ts_event`         | `int`              | 事件的 UNIX 时间戳（纳秒）。             |
| `ts_init`          | `int`              | 初始化时的 UNIX 时间戳（纳秒）。         |

从参与者或策略订阅：

```python
self.subscribe_option_greeks(instrument_id, client_id=ClientId("DERIBIT"))
```

处理更新：

```python
def on_option_greeks(self, greeks: OptionGreeks) -> None:
    self.log.info(f"delta={greeks.delta:.4f} gamma={greeks.gamma:.6f}")
```

完整订阅 API（包括期权链聚合、行权价区间筛选和快照模式）请参阅[期权](options.md)指南。

### 持久化与重放

`OptionGreeks` 是 `Data` 枚举的原生成员，因此会持久化到数据目录，并在回测中作为内置市场数据而非自定义数据重放。写入和查询使用标准目录 API：

```python
catalog.write_data(greeks)  # greeks: list[OptionGreeks]
greeks = catalog.query(data_cls=OptionGreeks)
```

重放期间，持久化的 Greeks 会通过实盘数据所使用的同一个 `on_option_greeks` 处理程序送达已订阅的参与者或策略。它们也会进入期权链聚合：策略订阅 `OptionChainSlice` 时，回测数据引擎会针对每个期权金融工具，将重放的 `OptionGreeks` 与重放的 `QuoteTick` BBO 更新合并。`underlying_price` 字段为 ATM 选择提供基准，`delta` 则支持通过 `StrikeRange.delta(target, tolerance)` 按 delta 选择行权价。

### 核心模式与自定义数据

原生 `OptionGreeks` 字段构成规范的核心模式：五个标准 Greeks（`delta`、`gamma`、`vega`、`theta`、`rho`），以及隐含波动率、标的价格、未平仓量和计价约定。这些字段名称保持稳定。

Greeks 并不存在一种能涵盖所有情况的统一结构，因此交易场所或模型特有的值（例如 `vanna`、`volga`、`charm`）、校准输入或波动率曲面元数据应放在[自定义数据](custom_data.md)中，而不是原生类型中。交易场所提供的可选字段允许为空；解释数值所必需的字段（例如 `convention`）不可为空，并带有默认值。

### 底层 Rust 类型

核心 Rust 实现位于 `crates/model/src/data/greeks.rs`：

- `OptionGreekValues`：包含 `delta`、`gamma`、`vega`、`theta`、`rho` 字段的普通结构体，实现了用于聚合的 `Add` 和 `Mul<f64>`。
- `OptionGreeks`（位于 `crates/model/src/data/option_chain.rs`）：在 `OptionGreekValues` 外封装 `instrument_id`、`convention`、隐含波动率字段和时间戳。它实现 `Deref<Target = OptionGreekValues>`，因此可以直接访问 Greeks 字段。
- `HasGreeks` trait：提供返回 `OptionGreekValues` 的 `greeks()` 方法，由 `OptionGreekValues` 和 `OptionGreeks` 共同实现。

### Black-Scholes 函数（Rust/PyO3）

`crates/model/src/data/greeks.rs` 向 Python 公开以下底层定价函数：

```python
from vibe_trader.model import (
    black_scholes_greeks,
    imply_vol,
    imply_vol_and_greeks,
    refine_vol_and_greeks,
)

# Compute Greeks given known volatility
result = black_scholes_greeks(s=100.0, r=0.05, b=0.0, vol=0.20, is_call=True, k=100.0, t=0.25)
# result.delta, result.gamma, result.vega, result.theta, result.price, result.vol

# Imply volatility from market price, then compute Greeks
result = imply_vol_and_greeks(s=100.0, r=0.05, b=0.0, is_call=True, k=100.0, t=0.25, price=5.0)

# Refine volatility from a starting vol estimate (faster convergence)
result = refine_vol_and_greeks(
    s=100.0, r=0.05, b=0.0, is_call=True, k=100.0, t=0.25, target_price=5.0, initial_vol=0.18
)
```

这些函数返回的 `BlackScholesGreeksResult` 包含：`price`、`vol`、`delta`、`gamma`、`vega`、`theta` 和 `itm_prob`。

**约定：**

- Vega 按 0.01 缩放（即对波动率变化 1 个百分点的敏感度）。
- Theta 按 1/365.25 缩放（即每日衰减）。
- 计算 Greeks 时，美式期权按欧式期权定价。

## 本地 Greeks 计算器

### GreeksCalculator

`vibe_trader/model/greeks.pyx` 中的旧版 Cython `GreeksCalculator` 类根据缓存的市场数据计算 Black-Scholes Greeks。当前 PyO3 计算器通过 `vibe_trader.common.GreeksCalculator` 公开。两个计算器都使用缓存和时钟，并可供参与者或策略调用。

```python
from vibe_trader.common import GreeksCalculator

# Legacy Cython: from vibe_trader.model.greeks import GreeksCalculator

# Typically created in on_start()
calculator = GreeksCalculator(cache=self.cache, clock=self.clock)
```

#### 单个金融工具的 Greeks

以数量 1 计算单个金融工具（期权或标的）的 Greeks：

```python
greeks = calculator.instrument_greeks(
    instrument_id=option_id,
    flat_interest_rate=0.0425,  # used if no yield curve in cache
)
# Both surfaces return GreeksData or None while market data is warming up.
```

两个计算器都会：

1. 在缓存中查找该金融工具及其标的。
2. 获取当前价格（优先使用 MID，缺失时回退到 LAST）。
3. 从缓存中查找收益率曲线（缺失时回退到 `flat_interest_rate`）。
4. 使用 `imply_vol_and_greeks` 根据市场价格反推波动率。
5. 返回包含全部计算值的 `GreeksData` 对象。

价格缺失时返回 `None`，因此策略可以把预热阶段当作正常的无操作路径。对于缺失金融工具定义等初始化错误，v2 PyO3 接口仍会抛出 Python 异常。

对于非期权金融工具（期货、股票），计算器返回 `delta=1`（或经过 beta 加权的 delta）且不含 gamma/vega/theta 的 `GreeksData`。

**冲击情景**：对现货价格、波动率或时间应用假设变动：

```python
greeks = calculator.instrument_greeks(
    instrument_id=option_id,
    spot_shock=10.0,  # +10 points on underlying
    vol_shock=0.02,  # +2% absolute vol increase
    time_to_expiry_shock=1 / 365,  # roll forward one day
)
```

**波动率更新**：从缓存的初始值细化隐含波动率，以加快收敛：

```python
greeks = calculator.instrument_greeks(
    instrument_id=option_id,
    update_vol=True,  # use cached vol as starting point
    cache_greeks=True,  # store result for next iteration
)
```

**Beta 加权 Greeks**：以某个指数为基准表示 delta 和 gamma：

```python
greeks = calculator.instrument_greeks(
    instrument_id=option_id,
    index_instrument_id=InstrumentId.from_str("SPX.CBOE"),
    beta_weights={underlying_id: 1.15},
    percent_greeks=True,
)
```

**时间加权 vega**：对不同到期时间的 vega 进行标准化：

```python
greeks = calculator.instrument_greeks(
    instrument_id=option_id,
    vega_time_weight_base=30,  # normalize to 30-day vega
)
```

#### 投资组合 Greeks

聚合符合筛选条件的全部未平持仓的 Greeks：

```python
portfolio = calculator.portfolio_greeks(
    underlyings=["AAPL", "MSFT"],
    venue=Venue("CBOE"),
    strategy_id=StrategyId("DELTA_HEDGE-001"),
    flat_interest_rate=0.0425,
    index_instrument_id=InstrumentId.from_str("SPX.CBOE"),
    beta_weights=beta_dict,
    percent_greeks=True,
)
# Returns PortfolioGreeks: pnl, price, delta, gamma, vega, theta
```

筛选项：

- `underlyings`：代码前缀列表（例如 `["AAPL"]` 会匹配 AAPL 股票和所有 AAPL 期权）。
- `venue`：限定为一个交易场所。
- `instrument_id`：限定为一个金融工具。
- `strategy_id`：限定为一个策略。
- `side`：按持仓方向（LONG、SHORT）筛选。
- `greeks_filter`：针对每个持仓接收 `PortfolioGreeks` 的可调用对象；返回 `True` 表示纳入。

### GreeksData

在旧版 Python 接口中，`GreeksData` 是一个 Python 自定义数据类（`@customdataclass`），携带单个金融工具 Greeks 计算的完整上下文。它扩展 `Data`，并支持 Arrow 序列化、缓存存储和目录持久化。v2/PyO3 接口通过 Rust 公开相同的核心字段。

| 字段               | 类型           | 说明                                             |
| ------------------ | -------------- | ------------------------------------------------ |
| `instrument_id`    | `InstrumentId` | 金融工具。                                       |
| `is_call`          | `bool`         | True 表示看涨期权，False 表示看跌期权。          |
| `strike`           | `float`        | 行权价。                                         |
| `expiry`           | `int`          | 以 YYYYMMDD 整数表示的到期日。                   |
| `expiry_in_days`   | `int`          | 距到期日的天数。                                 |
| `expiry_in_years`  | `float`        | 距到期日的年数（天数 / 365.25）。                |
| `multiplier`       | `float`        | 合约乘数。                                       |
| `quantity`         | `float`        | 持仓数量（`instrument_greeks` 返回时始终为 1）。 |
| `underlying_price` | `float`        | 计算所使用的标的价格。                           |
| `interest_rate`    | `float`        | 计算所使用的利率。                               |
| `cost_of_carry`    | `float`        | 持有成本（r - 股息率；期货为 0）。               |
| `vol`              | `float`        | 隐含波动率。                                     |
| `pnl`              | `float`        | 相对于持仓入场价的盈亏（如果提供持仓）。         |
| `price`            | `float`        | 模型价格。                                       |
| `delta`            | `float`        | Delta。                                          |
| `gamma`            | `float`        | Gamma。                                          |
| `vega`             | `float`        | Vega（dV / 波动率变化 1%）。                     |
| `theta`            | `float`        | Theta（每日衰减）。                              |
| `itm_prob`         | `float`        | 价内概率。                                       |

`GreeksData` 通过 `to_portfolio_greeks()` 方法扩展到投资组合级别；该方法会将所有数值乘以合约 `multiplier`。`*` 运算符用于应用持仓数量：

```python
position_greeks = signed_qty * instrument_greeks  # returns PortfolioGreeks
```

### PortfolioGreeks

`PortfolioGreeks` 是 `portfolio_greeks()` 的聚合结果。它支持用加法（`+`）合并持仓，也支持用标量乘法（`*`）缩放：

| 字段    | 类型    | 说明             |
| ------- | ------- | ---------------- |
| `pnl`   | `float` | 聚合盈亏。       |
| `price` | `float` | 聚合模型价值。   |
| `delta` | `float` | 投资组合 delta。 |
| `gamma` | `float` | 投资组合 gamma。 |
| `vega`  | `float` | 投资组合 vega。  |
| `theta` | `float` | 投资组合 theta。 |

### 收益率曲线

当前 Python API 不公开 Rust `YieldCurveData` 类型。Python 计算所需利率与默认值不同时，应向 `GreeksCalculator` 方法传入 `flat_interest_rate` 和 `flat_dividend_yield`。Rust 调用方可以使用 `YieldCurveData` 表示经过插值的利率或股息率曲线。

## 如何选择两种方式

| 条件         | 交易场所提供（`OptionGreeks`）         | 本地计算器（`GreeksCalculator`）         |
| ------------ | -------------------------------------- | ---------------------------------------- |
| 计算方式     | 由交易场所计算                         | 本地 Black‑Scholes                       |
| 延迟         | 随市场数据到达                         | 按需计算                                 |
| 交易场所     | Deribit、Bybit、OKX                    | 任何提供期权金融工具的交易场所           |
| 冲击情景     | 不支持                                 | 现货价格、波动率和时间冲击               |
| 投资组合聚合 | 手动（遍历 `OptionChainSlice`）        | 通过 `portfolio_greeks()` 内置           |
| Beta 加权    | 不支持                                 | 内置                                     |
| 回测支持     | 通过录制的 `OptionGreeks` 数据         | 使用任意时点的缓存价格                   |
| 可用 Greeks  | delta、gamma、vega、theta、rho、IV、OI | delta、gamma、vega、theta、itm_prob、vol |
| 数据类型     | `OptionGreeks`（Rust/PyO3）            | `GreeksData` / `PortfolioGreeks`         |

## Greek 定义

Vibe 所计算 Greeks 的定义如下：

| Greek    | 符号 | 定义                                                                        |
| -------- | ---- | --------------------------------------------------------------------------- |
| Delta    | `d`  | 期权价格对标的价格的一阶导数（dV/dS）。                                     |
| Gamma    | `g`  | 期权价格对标的价格的二阶导数（d2V/dS2）。                                   |
| Vega     | `v`  | 隐含波动率变化 1 个百分点时的敏感度（dV/dVol）。                            |
| Theta    | `t`  | 每日时间衰减：每个日历日期权价格的变化（dV/dt / 365.25）。                  |
| Rho      | `r`  | 对无风险利率变化的敏感度（dV/dr）。                                         |
| ITM 概率 | -    | 期权到期处于价内的概率：P(ϕS_T > ϕK)，看涨期权的 ϕ = 1，看跌期权的 ϕ = -1。 |

## 示例

仓库提供以下完整可运行示例：

- `examples/live/bybit/bybit_option_greeks.py`：订阅 Bybit 交易场所提供的 Greeks。
- `examples/live/deribit/deribit_option_greeks.py`：订阅 Deribit 交易场所提供的 Greeks。
- `examples/live/okx/okx_option_greeks.py`：订阅 OKX 交易场所提供的 Greeks。

## 相关指南

- [期权](options.md) - 期权金融工具、期权链订阅和行权价筛选。
- [数据](data/) - 内置数据类型、自定义数据和订阅模型。
- [参与者](actors.md) - 订阅和处理程序参考。
- [策略](strategies.md) - 策略实现和处理程序方法。
