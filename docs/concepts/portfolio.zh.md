# 投资组合

Portfolio 是交易节点或回测中管理和跟踪所有活跃策略持仓的中央枢纽。
它汇总多个交易工具的持仓数据，统一呈现持有情况、风险敞口和整体绩效。

## 货币转换

Portfolio 支持自动转换盈亏和敞口计算中的货币，使结果能以首选货币显示。
交易多个成本货币不同的交易工具，或管理基础货币不同的多个账户时，该功能尤其有用。

### 支持的转换

以下投资组合查询支持货币转换：

- `realized_pnl()` / `realized_pnls()`--把已实现盈亏转换为目标货币。
- `unrealized_pnl()` / `unrealized_pnls()`--把未实现盈亏转换为目标货币。
- `total_pnl()` / `total_pnls()`--把总盈亏转换为目标货币。
- `net_exposure()` / `net_exposures()`--把净敞口转换为目标货币。

所有方法都接受可选的 `target_currency` 参数，用于指定所需输出货币。

### 单账户行为

查询单个账户且未指定 `target_currency` 时，Portfolio 会自动把数值转换为该账户的基础货币：

```python
# Returns exposure in the account's base currency (e.g., USD)
exposure = portfolio.net_exposures(venue=BINANCE, account_id=account_id)
```

### 多账户行为

同时查询多个账户时，行为取决于是查询所有交易工具（`net_exposures()`）还是单个交易工具
（`net_exposure()`）：

**对于 `net_exposures()`（所有交易工具）：**

- **基础货币相同**：自动转换为共同基础货币。
- **基础货币不同**：返回包含多种货币的 dict，每项都转换为其账户基础货币。
  如需单一货币结果，应提供 `target_currency`。

**对于 `net_exposure()`（跨账户的单个交易工具）：**

- **基础货币不同**：除非提供 `target_currency`，否则返回 `None`。

```python
# Scenario 1: Multiple accounts, all with USD base currency
exposures = portfolio.net_exposures(venue=BINANCE)
# Returns {USD: Money(...)}

# Scenario 2: Multiple accounts with different base currencies (USD and EUR)
exposures = portfolio.net_exposures(venue=BINANCE)
# Returns {USD: Money(...), EUR: Money(...)}

# Force single currency across accounts
exposures = portfolio.net_exposures(venue=BINANCE, target_currency=USD)
# Returns {USD: Money(...)}
```

### 转换失败

提供 `target_currency` 但货币转换失败时，行为取决于方法类型：

- **单值方法**（`realized_pnl`、`unrealized_pnl`、`total_pnl`、`net_exposure`）：
  返回 `None` 并记录 error，防止产生错误数值。
- **返回 dict 的方法**（`realized_pnls`、`unrealized_pnls`、`total_pnls`、`net_exposures`）：
  省略转换失败的交易工具，但返回转换成功的结果。

:::warning
使用 `target_currency` 进行跨货币聚合时，必须有汇率数据可用。
:::

### 转换价格类型

把敞口转换为目标货币时，Portfolio 根据持仓组成使用不同价格类型：

- **全部为多头持仓**：使用 `BID` 价格（对多头敞口采取保守估值）。
- **全部为空头持仓**：使用 `ASK` 价格（对空头敞口采取保守估值）。
- **混合持仓**：使用 `MID` 价格（多空同时存在时采用中性估值）。

这可以使转换反映真实市场条件：多头持仓会在 bid 平仓，空头持仓会在 ask 回补。
对于混合持仓，中间价提供中性估值。

如果在投资组合配置中启用 `use_mark_xrates`，混合持仓和一般转换会以 `MARK` 价格代替 `MID` 价格。

## 权益与盯市估值

Portfolio 为持续投资组合估值和已记录快照暴露 pull 风格查询。逐货币结果使用相应账户基础货币或原生成本货币。

| 方法                               | 返回                             |
| ---------------------------------- | -------------------------------- |
| `mark_values(venue, account_id)`   | 未结持仓的有符号 MTM 总额。      |
| `equity(venue, account_id)`        | 结合余额和持仓估值的总权益。     |
| `build_snapshot(account_id)`       | 账户级 MTM 总额和估值元数据。    |
| `snapshots(account_id)`            | 按发出顺序记录的账户快照。       |
| `missing_price_instruments(venue)` | 当前被标记为无法定价的交易工具。 |

多头贡献正名义价值，空头贡献负名义价值。跳过已平持仓。

### 权益公式

权益把账户余额与未结持仓估值结合；第二项因账户类型而异：

- **没有基础货币的现金账户**：从 `balances_total` 开始。对于该账户持有的持仓，如果余额已经持有基础资产，
  且交易工具成本货币不同于基础货币，则不再加入基础资产 mark value。对于反向交易工具和余额未体现的
  持仓，加入 mark value。
- **有基础货币的现金账户和投注账户**：`balances_total + Σ mark_value(open positions)`。
- **保证金账户**：`balances_total + Σ unrealized_pnl(open positions)`。

`mark_values()` 始终返回未结持仓的总值，包括多货币现金余额中已存在的资产。
"只计一次"规则意味着 `equity()` 和权益快照对每种非反向基础资产只按余额或 mark value 计入一次，
不会重复计算。保证金路径使用与 `unrealized_pnls()` 相同的缓存未实现盈亏流水线。

### 价格回退

估值按以下顺序向 `Cache` 请求价格，在首次匹配处停止：

1. 如果 `PortfolioConfig` 中 `use_mark_prices=true`（默认），且缓存中有标记价格，则使用标记价格。
2. 与方向匹配的报价：多头使用 `BID`，空头使用 `ASK`。
3. 最新成交价格。
4. 最近缓存的 K 线收盘价（在 `bar_updates=true` 时填充）。

设置 `use_mark_prices=false` 可跳过标记价格层，从与方向匹配的报价开始。

如果四种方式都无法提供当前价格，Portfolio 会沿用该交易工具和持仓方向最后一个有效价格。
下一个快照会把交易工具列入 `stale_instruments`。如果持仓从未获得有效价格，它会进入缺失价格 tracker，
列入 `unpriced_instruments`，并从总和中排除。

### 基础货币转换

当 `convert_to_account_base_currency=true`（默认）且账户设置了 `base_currency` 时，使用
`Cache.get_xrate()` 中的 `MID` 汇率把成本货币值转换为基础货币。启用 `use_mark_xrates=true` 时，
优先使用 `Cache.get_mark_xrate()` 中缓存的标记汇率，不可用时回退到 `MID`。输出 dict 此时只有一个
与基础货币匹配的 key。

当 `convert_to_account_base_currency=false`，或账户没有 `base_currency` 时，结果按每个持仓的原生成本
货币作为 key，且不应用汇率转换。

所需转换没有当前汇率时，Portfolio 会沿用最后一个有效汇率，并把源货币列入 `stale_currencies`。
如果从未有过有效汇率，持仓会被视为无法定价，通过缺失价格 tracker 标记，而不是静默按 1.0 汇率估值。

### 快照估值元数据

`PortfolioSnapshot.total_equity` 始终提供逐货币 MTM 明细。启用基础货币转换且账户有基础货币时，
`base_currency_equity` 提供该货币的主要标量。禁用转换或账户没有基础货币时，其值为 `None`。

快照使用沿用价格或汇率，或者排除了从未具备全部估值输入的持仓时，`is_stale` 为 true。
相关字段会指出原因：

- `stale_instruments`：使用沿用价格估值的交易工具。
- `stale_currencies`：使用沿用汇率转换的源货币。
- `unpriced_instruments`：因从未获得完整有效估值而被排除的交易工具。

调用 `build_snapshot(account_id)` 获取按需样本。调用 `snapshots(account_id)` 读取有界的已记录序列。
这些方法可从 Rust Portfolio 和 Strategy API 以及 Python Portfolio 绑定使用。

### 自动权益曲线

`PortfolioConfig.equity_curve=true`（默认）会在每个账户注册时、每个 UTC 午夜（即使账户为空仓），
以及回测或实盘节点关闭时，记录并发布盯市快照。对于优化器运行等不使用权益曲线的工作负载，
设置 `equity_curve=false`。按需 `equity()` 和 `build_snapshot()` 计算仍可使用。

单独的 `snapshot_interval_ms` 设置仍为选择启用。设置后，只在账户存在未结持仓时添加细粒度快照。

### 缺失价格跟踪

tracker 会保留每个按账户筛选查询作用域及未筛选场所作用域的最新缺失集合。
`missing_price_instruments(venue)` 返回它们在整个场所的并集。每次观察在相同作用域再次运行前都保持权威；
筛选结果不会声明较早的未筛选结果已解决。它有两项可观察行为：

- 当一个交易工具从没有作用域报告转为至少一个作用域报告时，warning 日志只触发一次，
  不会在每次后续调用时触发。所有报告作用域都观察到恢复后，未来再次缺失会重新 warning。
- 当场所变为空仓（没有未结持仓）时，其 tracker 条目会清除，避免过时交易工具继续被标记。

调用 `missing_price_instruments(venue)` 检查当前集合。

:::tip
如果 `equity()` 低于预期，在调查数学计算前先检查 `missing_price_instruments(venue)`。
某个交易工具的报价、成交和 K 线 feed 都为空，是静默缺口最常见的原因。
:::

### 场所与账户作用域

`mark_values` 和 `equity` 接受可选 `account_id`，把聚合限制到单个账户。
当 `account_id=None` 时，结果会聚合场所上的所有账户。

按账户筛选的估值只协调该账户的观察结果，因此同一场所其他账户引起的标记会保留。

## 投资组合统计

`crates/analysis/src/statistics` 中有多种内置投资组合统计，用于分析回测和实盘交易的投资组合绩效。

统计一般分为以下类别：

- 基于盈亏的统计（逐货币）
- 基于收益率的统计
- 基于持仓的统计
- 基于订单的统计

回测统计在运行后通过 `engine.get_result()` 暴露。

## 自定义统计

运行后分析的自定义指标可以根据报告、快照或持仓数据计算，并加入传给
`create_tearsheet_from_stats()` 等可视化 API 的 dict。

例如，根据已实现盈亏计算胜率：

```python
import pandas as pd


def calculate_win_rate(realized_pnls: pd.Series) -> float:
    if realized_pnls.empty:
        return 0.0

    winners = realized_pnls[realized_pnls > 0.0]
    return len(winners) / len(realized_pnls)
```

然后把指标加入离线 tearsheet 输入：

```python
stats_general = {
    "Win Rate": calculate_win_rate(realized_pnls),
}
```

:::tip
指标应能处理空 series 或数据不足等退化输入。对于未知或无法计算的值返回 `None`；
语义适用时也可以返回 `0.0` 等合理默认值。
:::

## 收益率：持仓与投资组合

analyzer 跟踪两组不同的收益率序列：

- **持仓收益率**（`analyzer.position_returns()`）将每个持仓的已实现收益，按方向感知的价格收益率表示，
  并以平均开仓价为基准。它反映交易工具在进出场之间的价格变化，与账户规模或杠杆无关。
- **投资组合收益率**（`analyzer.portfolio_returns()`）衡量盯市账户权益的每日百分比变化。
  一个 $100,000 账户获得 $900 收益，当日约报告 0.9%。

当完整投资组合快照至少跨越两个不同 UTC 日期时，analyzer 会使用每天的最终快照，并自动计算投资组合
收益率。它将这些收益率作为统计、tearsheet 和月度收益热力图的主要序列。恰好在 UTC 午夜发出的快照
会结算前一个日期，使每日层级与细粒度样本保持一致。首个有效注册样本会锚定不完整首日的期初值。
所有账户都获得初始有效样本后，缺失或无法定价的账户日期会向前填充。同一天的多个快照只算一个日期，
因此只有日内交易不会产生投资组合收益率。投资组合收益率不可用时，analyzer 会回退到持仓收益率；
Python tearsheet 也可以回退到账户报告。

便捷访问器 `analyzer.returns()` 会解析这种优先级：存在投资组合收益率时返回它，否则返回持仓收益率。

### 多货币账户

投资组合收益率要求每个账户的快照权益都能解析为一种共同货币。基础货币转换通常会提供该标量。
快照暴露多种货币或账户解析到不同货币时，analyzer 会回退到持仓收益率。
显式 tearsheet 货币可以选择可用的匹配逐货币权益。

如果多货币账户需要投资组合级收益率，应在外部先把余额转换为共同货币，再计算百分比变化。

### 多账户计算

回测分析会在把所有缓存账户解析到共同货币后进行聚合。对于多场所回测，tearsheet 遵循相同的账户级
聚合规则。

## 回测分析

回测运行后，引擎会把已实现盈亏、收益率、持仓和订单数据传给每个已注册统计项。
所有输出随后显示在 tearsheet 的 `Portfolio Performance` 标题下，并分为：

- 已实现盈亏统计（逐货币）
- 收益率统计（整个投资组合）
- 从持仓和订单数据派生的一般统计（整个投资组合）

## 相关指南

- [持仓](positions.md)--投资组合内的持仓跟踪。
- [报告](reports.md)--生成投资组合分析报告。
- [可视化](visualization.md)--可视化投资组合绩效。
