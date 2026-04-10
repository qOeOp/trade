# Indicator Guide

这份文档说明 `tech-indicators` 目前已接入的指标，重点讲：

- 它吃什么数据
- 它输出什么
- 它代表什么含义
- 实际要观测什么

所有指标默认都使用标准 OHLCV 数据：

- `date`
- `open`
- `high`
- `low`
- `close`
- `volume`

## 目录

- [总体理解](#总体理解)
- [趋势类](#趋势类)
- [均线类](#均线类)
- [动量类](#动量类)
- [波动类](#波动类)
- [量能类](#量能类)
- [水平位与位置类](#水平位与位置类)
- [杂项](#杂项)
- [我们自己的结构输出](#我们自己的结构输出)

## 总体理解

不要把所有指标当成“独立交易信号”。

更好的使用方式是：

- 用趋势类指标判断方向
- 用波动类指标判断环境
- 用动量类指标判断强弱
- 用量能类指标判断确认
- 用我们自己的支撑压力与趋势线判断结构位置

## 趋势类

### `ichimoku`

- 输出：云层、转换线、基准线、迟行线等
- 含义：趋势方向、支撑压力、未来云层方向
- 观测：价格在云上还是云下；转换线与基准线是否交叉；未来云是扩张还是收缩

### `supertrend`

- 输出：趋势线、方向状态
- 含义：ATR 驱动的趋势跟随与动态止损
- 观测：方向翻转、趋势线是否被跌破/站回

### `SSLChannels`

- 输出：上下通道
- 含义：趋势通道状态
- 观测：上下轨翻转、价格是否重新站上通道

### `PMAX`

- 输出：PMAX 相关列
- 含义：均线与 ATR 结合的趋势系统
- 观测：方向切换、价格与 pmax 线的位置

### `gentrends`

- 输出：`Data`、`Max Line`、`Min Line`
- 含义：基于极值点生成的趋势线
- 观测：价格相对上沿/下沿趋势线的偏离和突破

### `segtrends`

- 输出：`Data`、`Max Line`、`Min Line`
- 含义：分段极值趋势线
- 观测：不同 segment 下趋势线方向是否一致

## 均线类

### `ema`

- 输出：一条 EMA
- 含义：偏重近期价格的趋势均线
- 观测：价格与 EMA 的相对位置、EMA 斜率

### `sma`

- 输出：一条 SMA
- 含义：基础均值线
- 观测：趋势方向、价格偏离均值程度

### `dema`

- 输出：一条 DEMA
- 含义：更快响应的均线
- 观测：比 EMA 更早出现的趋势拐点

### `zema`

- 输出：与 `dema` 类似
- 含义：兼容别名
- 观测：同 `dema`

### `tema`

- 输出：一条 TEMA
- 含义：更低滞后的三重指数均线
- 观测：趋势平滑与快速转向

### `hull_moving_average`

- 输出：HMA
- 含义：在平滑和灵敏之间折中
- 观测：趋势延续和斜率拐点

### `tv_wma` / `tv_hma` / `tv_alma` / `tv_trama`

- 输出：对应均线序列
- 含义：TradingView 风格的不同平滑方式
- 观测：不同均线对趋势和噪音的处理差异

### `VIDYA`

- 输出：自适应均线
- 含义：根据波动变化调整响应速度
- 观测：波动放大时是否明显加快跟随

### `MADR`

- 输出：MADR 相关列
- 含义：价格相对均线的偏离率
- 观测：是否进入极端偏离区

### `mmar`

- 输出：一组均线带
- 含义：趋势展开/压缩
- 观测：均线带发散、收敛、排列顺序

## 动量类

### `macd`

- 当前 skill 在 `core_context` 里始终给出
- 含义：快慢均线差值动量
- 观测：MACD 与 Signal 交叉、零轴上下、柱体放大缩小

### `laguerre`

- 输出：Laguerre RSI
- 含义：低噪音动量
- 观测：超买超卖、拐头、背离

### `osc`

- 输出：方向动量占比
- 含义：上涨与下跌动量强弱对比
- 观测：动量是否向单边集中

### `stc`

- 输出：STC
- 含义：结合周期和趋势的振荡器
- 观测：25/75 附近切换与趋势延续

### `RMI`

- 输出：RMI
- 含义：更偏趋势持续性的动量指标
- 观测：强趋势里是否持续维持高位或低位

### `TKE`

- 输出：`TKE`、`TKEema`
- 含义：多振荡器综合后的动量均值
- 观测：主值与平滑值关系、方向变化

### `williams_percent`

- 输出：Williams %R
- 含义：区间位置型超买超卖指标
- 观测：高低位反转、背离、回归中值

### `madrid_sqz`

- 输出：三条 squeeze 相关序列
- 含义：挤压与释放
- 观测：压缩结束后方向是否清晰

### `td_sequential`

- 输出：TD Sequential 计数相关列
- 含义：潜在衰竭节奏
- 观测：9 / 13 计数是否接近完成

## 波动类

### `bollinger_bands`

- 输出：上轨、中轨、下轨
- 含义：波动区间和均值回归框架
- 观测：带宽收缩/扩张、价格贴轨、跌破后回收

### `atr_percent`

- 输出：ATR 占现价百分比
- 含义：相对波动率
- 观测：市场是否进入高波动或低波动阶段

### `chopiness`

- 输出：Chopiness Index
- 含义：趋势市还是震荡市
- 观测：高值偏震荡，低值偏趋势

## 量能类

### `chaikin_money_flow`

- 输出：CMF
- 含义：资金净流入流出
- 观测：趋势是否有量能确认

### `vfi`

- 输出：`vfi`、`vfima`、`vfi_hist`
- 含义：量价资金流方向
- 观测：价格趋势与资金流是否同向

### `vpci`

- 输出：VPCI
- 含义：量价确认
- 观测：量价是否共振还是背离

### `vpcii`

- 输出：VPCI 派生强度值
- 含义：量价确认强度
- 观测：当前趋势是否被量能强化

### `vwmacd`

- 输出：量能加权 MACD 相关列
- 含义：在 MACD 中引入成交量权重
- 观测：放量推动的趋势是否更强

### `vwma`

- 输出：VWMA
- 含义：成交量加权均线
- 观测：大成交量区间是否改变均线方向

## 水平位与位置类

### `fibonacci_retracements`

- 输出：当前价格对应的回撤层级
- 含义：回撤位置映射
- 观测：价格处于哪一个回撤区、该区是否有反应

### `pivots_points`

- 输出：pivot、`s1/s2/...`、`r1/r2/...`
- 含义：库内 pivot levels 变体
- 观测：作为补充水平位使用
- 注意：不要把它等同于我们自己的结构支撑压力

## 杂项

## 我们自己的结构输出

除了库指标，这个 skill 还会固定输出：

- `supports`
- `resistances`
- `trendlines`
- `bullish_invalidation`
- `bearish_invalidation`
- `structure_validation`

这些是我们自己的价格结构口径，不来自 `freqtrade/technical`。

### 字段说明

#### `supports[]` / `resistances[]`

每个水平位对象至少包含这些字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `price` | `number` | 当前水平位中心价 |
| `zone_low` | `number` | 当前水平位区间下边界 |
| `zone_high` | `number` | 当前水平位区间上边界 |
| `touches` | `number` | 当前口径下触碰次数 |
| `strength` | `string` | 强度标签，当前可能值为 `weak / moderate / strong` |
| `last_touch_index` | `number` | 最近一次触碰对应的 K 线索引 |
| `last_touch_time` | `string` | 最近一次触碰时间，`RFC3339` |
| `source_prices` | `number[]` | 参与聚类的原始 pivot 价位 |
| `cluster_size` | `number` | 参与当前水平位聚类的 pivot 数量 |
| `cluster_tolerance` | `number` | 当前聚类和触碰判定使用的容差 |
| `distance_from_price_pct` | `number` | 当前水平位中心价相对最新价格的距离比例 |
| `validation` | `object` | 当前水平位自身历史触碰统计 |

#### `trendlines[]`

每个趋势线对象至少包含这些字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `kind` | `string` | 当前可能值为 `support` 或 `resistance` |
| `line_family` | `string` | 当前可能值为 `base` 或 `acceleration` |
| `structure_role` | `string` | 当前可能值为 `boundary` 或 `internal` |
| `break_meaning` | `string` | 当前可能值为 `structure_risk` 或 `loss_of_acceleration` |
| `basis` | `string` | 当前趋势线使用的取价口径，当前可能值为 `wick` 或 `close` |
| `scale` | `string` | 当前趋势线使用的坐标口径，当前可能值为 `linear` 或 `log` |
| `anchor_method` | `string` | 当前锚点生成方式；目前为 `two-pivot` |
| `confirmation` | `string` | 当前可能值为 `early / developing / confirmed` |
| `anchor_indices` | `number[]` | 两个锚点的 K 线索引 |
| `anchor_prices` | `number[]` | 两个锚点价格 |
| `touches` | `number` | 当前口径下趋势线触碰次数 |
| `pivot_touches` | `number` | 当前趋势线穿过的 pivot 数量 |
| `span_bars` | `number` | 两个锚点之间跨越的 bar 数 |
| `touch_tolerance` | `number` | 当前趋势线触碰判定使用的容差 |
| `slope` | `number` | 当前趋势线斜率 |
| `intercept` | `number` | 当前趋势线截距 |
| `projected_price` | `number` | 当前最后一根 K 线位置对应的趋势线中心价 |
| `projected_low` | `number` | 当前最后一根 K 线位置对应的趋势线带下边界 |
| `projected_high` | `number` | 当前最后一根 K 线位置对应的趋势线带上边界 |
| `distance_from_price_pct` | `number` | 当前趋势线中心价相对最新价格的距离比例 |
| `last_touch_index` | `number` | 最近一次触碰对应的 K 线索引 |
| `last_touch_time` | `string` | 最近一次触碰时间，`RFC3339` |
| `invalidation` | `string` | 当前趋势线对应的失效描述文本 |
| `score` | `number` | 当前内部排序分数 |
| `validation` | `object` | 当前趋势线自身历史触碰统计 |

#### `validation`

`supports[]`、`resistances[]`、`trendlines[]` 内部的 `validation` 字段结构一致：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `window_bars` | `number` | 当前验证窗口 bar 数 |
| `sample_count` | `number` | 已纳入统计的样本数 |
| `respected` | `number` | 被判定为 `respected` 的样本数 |
| `broken` | `number` | 被判定为 `broken` 的样本数 |
| `unresolved` | `number` | 被判定为 `unresolved` 的样本数 |
| `respect_rate` | `number` | `respected / sample_count` |
| `break_rate` | `number` | `broken / sample_count` |
| `breakout_samples` | `number` | 水平位或趋势线在验证窗口内发生有效突破的样本数 |
| `rejected_breakouts` | `number` | 突破后重新回到原区间或带内的样本数 |
| `accepted_breakouts` | `number` | 突破后直到窗口结束仍未回到原区间或带内的样本数 |
| `avg_bars_outside_zone` | `number` | 突破样本中位于区间或带外的平均 bar 数 |
| `avg_outside_close_count` | `number` | 突破样本中收盘位于区间或带外的平均 bar 数 |
| `avg_max_excursion_pct` | `number` | 突破样本中价格离开区间或带边界后的平均最大延伸比例 |
| `avg_return_to_zone_bars` | `number` | 在 `rejected_breakouts` 样本中，平均多少根 bar 返回区间或带内 |
| `last_sample_time` | `string` | 最近一个纳入统计样本的时间，`RFC3339` |
| `note` | `string` | 可选说明字段；仅在样本不足或没有可用样本时出现 |

#### `structure_validation`

`structure_validation` 是按 timeframe 输出的聚合统计对象。常见键包括：

- `support`
- `resistance`
- `support_trendline_overall`
- `resistance_trendline_overall`
- `support_trendline_wick_linear`
- `support_trendline_wick_log`
- `support_trendline_close_linear`
- `support_trendline_close_log`
- `resistance_trendline_wick_linear`
- `resistance_trendline_wick_log`
- `resistance_trendline_close_linear`
- `resistance_trendline_close_log`

每个聚合对象至少包含这些字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `window_bars` | `number` | 当前聚合统计使用的验证窗口 bar 数 |
| `sample_step_bars` | `number` | walk-forward 滑窗取样间隔 |
| `sample_count` | `number` | 已纳入聚合统计的样本数 |
| `respected` | `number` | 被判定为 `respected` 的样本数 |
| `broken` | `number` | 被判定为 `broken` 的样本数 |
| `unresolved` | `number` | 被判定为 `unresolved` 的样本数 |
| `respect_rate` | `number` | `respected / sample_count` |
| `break_rate` | `number` | `broken / sample_count` |
| `breakout_samples` | `number` | 聚合口径下发生有效突破的样本数 |
| `rejected_breakouts` | `number` | 聚合口径下突破后回到原区间或带内的样本数 |
| `accepted_breakouts` | `number` | 聚合口径下突破后直到窗口结束仍未回到原区间或带内的样本数 |
| `avg_bars_outside_zone` | `number` | 聚合口径下突破样本位于区间或带外的平均 bar 数 |
| `avg_outside_close_count` | `number` | 聚合口径下突破样本收盘位于区间或带外的平均 bar 数 |
| `avg_max_excursion_pct` | `number` | 聚合口径下突破样本离开区间或带边界后的平均最大延伸比例 |
| `avg_return_to_zone_bars` | `number` | 在 `rejected_breakouts` 样本中，平均多少根 bar 返回区间或带内 |
| `avg_distance_from_price_pct` | `number` | 当前聚合对象中心价相对最新价格的平均距离比例 |
| `last_sample_time` | `string` | 最近一个纳入统计样本的时间，`RFC3339` |
| `note` | `string` | 可选说明字段；仅在样本不足或没有可用样本时出现 |

这里的 `validation` 是基于本地 OHLCV 的历史触碰后窗口统计；`structure_validation` 是基于历史 walk-forward 重算的聚合统计。两者都属于当前仓库内部口径。
