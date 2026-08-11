# 合成金融工具

合成金融工具是在本地定义、价格由其他金融工具派生而来的金融工具。它可以组合来自一个或多个交易场所的组成金融工具，并以合成交易场所代码 `SYNTH` 将结果呈现为标准 Vibe 金融工具。

合成金融工具适用于：

- 让 `DataActor` 和 `Strategy` 组件订阅报价或成交数据流。
- 根据派生价格触发模拟订单。
- 从合成报价或成交构建 K 线。

合成金融工具不能直接交易。它们仅存在于平台本地，用作分析工具。未来，Vibe 可能支持根据合成金融工具的行为交易其组成金融工具。

## 公式语言

每个合成金融工具都定义一个派生公式。Vibe 使用内置的数值表达式引擎计算该公式，并将最终数值结果转换为合成 `Price`。

### 支持的语法

公式可以直接引用组成金融工具的 `InstrumentId` 值，包括含有 `/` 和 `-` 的 ID。

| 语法元素         | 示例                                           | 说明                                           |
| ---------------- | ---------------------------------------------- | ---------------------------------------------- |
| 组成金融工具引用 | `BTCUSDT.BINANCE`                              | 使用原始 `InstrumentId` 文本。                 |
| 组成金融工具引用 | `AUD/USD.SIM`                                  | 可以使用含 `/` 的 ID。                         |
| 组成金融工具引用 | `ETH-USDT-SWAP.OKX`                            | 可以使用含 `-` 的 ID。                         |
| 数值字面量       | `1`、`0.5`、`1.2e-3`                           | 按 `f64` 语义求值。                            |
| 布尔字面量       | `true`、`false`                                | 用于条件和逻辑表达式。                         |
| 圆括号           | `(a + b) / 2`                                  | 使用圆括号改变运算优先级。                     |
| 一元运算符       | `-x`、`!flag`                                  | 一元 `-` 对数值取负；一元 `!` 对布尔值取反。   |
| 二元运算符       | `+ - * / % ^`、`== !=`、`< <= > >=`、`&& \|\|` | 算术运算符作用于数值；逻辑运算符作用于布尔值。 |
| 局部赋值         | `spread = a - b; spread / 2`                   | 语句从左到右执行；公式必须以一个值结尾。       |
| 注释             | `// line`、`/* block */`                       | 注释会被忽略。                                 |

:::note
新公式应使用原始 `InstrumentId` 值。为保持向后兼容，仍接受将组成金融工具 ID 中的 `-` 替换为 `_` 的公式。
:::

### 运算符优先级

表达式引擎按以下顺序计算运算符，从最高优先级到最低优先级：

| 级别 | 运算符               | 说明                                   |
| ---- | -------------------- | -------------------------------------- |
| 最高 | `^`                  | 幂运算，右结合。                       |
|      | 一元 `-`、一元 `!`   | `-2 ^ 2` 的结果为 `-(2 ^ 2)`。         |
|      | `*`, `/`, `%`        | 乘法、除法和取模。                     |
|      | `+`, `-`             | 加法和减法。                           |
|      | `<`、`<=`、`>`、`>=` | 数值比较。                             |
|      | `==`、`!=`           | 相等与不等比较；两侧必须具有相同类型。 |
| 最低 | `&&`, `\|\|`         | 布尔运算符。                           |

赋值不属于表达式运算符。使用 `;` 分隔语句，并让最后一条语句成为合成金融工具应生成的值。

### 内置函数

| 函数    | 签名                                   | 说明                                                           |
| ------- | -------------------------------------- | -------------------------------------------------------------- |
| `abs`   | `abs(x)`                               | 绝对值。                                                       |
| `ceil`  | `ceil(x)`                              | 向上取整。                                                     |
| `floor` | `floor(x)`                             | 向下取整。                                                     |
| `round` | `round(x)`                             | 按 Rust `f64` 规则舍入到最接近的整数。                         |
| `min`   | `min(x1, x2, ...)`                     | 接受一个或多个数值参数。                                       |
| `max`   | `max(x1, x2, ...)`                     | 接受一个或多个数值参数。                                       |
| `if`    | `if(condition, when_true, when_false)` | 条件必须为布尔值；两个分支的类型必须匹配；只对选中的分支求值。 |

### 类型规则

- 组成金融工具输入为数值。
- 算术运算符要求数值操作数，并返回数值结果。
- `<`、`<=`、`>`、`>=` 要求数值操作数，并返回布尔结果。
- `==` 和 `!=` 接受任意相同类型（两侧均为数值或均为布尔值），并返回布尔结果。
- `&&`、`||` 和一元 `!` 要求布尔操作数。
- `&&` 和 `||` 采用短路求值，仅在需要时对右侧求值。
- 局部变量在使用前必须先赋值。
- 局部变量名必须以字母或 `_` 开头，后续字符可以是字母、数字或 `_`。
- 最终的公式结果必须是数字。以赋值结尾或生成布尔结果的公式对于合成金融工具无效。

### 限制

表达式引擎执行以下编译时限制。超出限制的公式会在构造时产生明确错误。

| 限制     | 值  | 说明                       |
| -------- | --- | -------------------------- |
| 栈深度   | 32  | 求值栈中间值的最大数量。   |
| 局部变量 | 16  | 不同局部变量名的最大数量。 |

这些限制足以容纳任何实际的定价公式。包含 8 个组成项的加权和，其峰值栈深度仅为 3，且不使用局部变量。

### 示例

```python
# Simple spread
formula = "BTCUSDT.BINANCE - ETHUSDT.BINANCE"

# Average of two FX pairs
formula = "(AUD/USD.SIM + NZD/USD.SIM) / 2"

# Reuse an intermediate value
formula = "spread = BTCUSDT.BINANCE - ETHUSDT.BINANCE; spread / 2"

# Conditional output
formula = "if(BTCUSDT.BINANCE > ETHUSDT.BINANCE, BTCUSDT.BINANCE, ETHUSDT.BINANCE)"
```

## 创建合成金融工具

定义新的合成金融工具之前，请确保所有组成金融工具已经存在于缓存中。

以下示例通过 actor 或策略创建一个合成金融工具。该金融工具表示 Binance 上比特币与以太坊现货价格之间的简单价差，并假定 `BTCUSDT.BINANCE` 和 `ETHUSDT.BINANCE` 已经存在于缓存中。

```python
from vibe_trader.model.instruments import SyntheticInstrument

btcusdt_binance_id = InstrumentId.from_str("BTCUSDT.BINANCE")
ethusdt_binance_id = InstrumentId.from_str("ETHUSDT.BINANCE")

synthetic = SyntheticInstrument(
    symbol=Symbol("BTC-ETH:BINANCE"),
    price_precision=8,
    components=[
        btcusdt_binance_id,
        ethusdt_binance_id,
    ],
    formula=f"{btcusdt_binance_id} - {ethusdt_binance_id}",
    ts_event=self.clock.timestamp_ns(),
    ts_init=self.clock.timestamp_ns(),
)

self._synthetic_id = synthetic.id
self.add_synthetic(synthetic)
self.subscribe_quotes(self._synthetic_id)
```

:::note
上例中合成金融工具的 `instrument_id` 为 `{symbol}.SYNTH`，因此会生成 `BTC-ETH:BINANCE.SYNTH`。
:::

## 更新公式

可以随时更新合成公式。

```python
synthetic = self.cache.synthetic(self._synthetic_id)

new_formula = "(BTCUSDT.BINANCE + ETHUSDT.BINANCE) / 2"
synthetic.change_formula(new_formula)

self.update_synthetic(synthetic)
```

## 触发金融工具 ID

可以根据合成价格触发模拟订单。在以下示例中，合成价格达到触发条件后，合成金融工具会释放一笔模拟订单。

```python
order = self.strategy.order_factory.limit(
    instrument_id=ETHUSDT_BINANCE.id,
    order_side=OrderSide.BUY,
    quantity=Quantity.from_str("1.5"),
    price=Price.from_str("30000.00000000"),
    emulation_trigger=TriggerType.DEFAULT,
    trigger_instrument_id=self._synthetic_id,
)

self.strategy.submit_order(order)
```

## 性能

公式在构造时编译一次，并在每个组成金融工具价格 tick 到达时求值。表达式引擎采用"一次编译、多次求值"的架构，使用零分配的 f64 栈，因此对 tick 处理路径增加的开销可以忽略不计。

在 Apple M4 Pro、rustc 1.94.1、发布配置文件（opt-level 3）上测量：

### 评估（热路径）

| 公式模式                                | 时间  |
| --------------------------------------- | ----- |
| `(A + B) / 2.0`                         | 12 ns |
| `A * 0.4 + B * 0.3 + C * 0.2 + D * 0.1` | 18 ns |
| `if(A > B, A - B, B - A)`               | 12 ns |
| `spread = A - B; mid = ...; mid + ...`  | 19 ns |
| `max(min(A, B * 20), abs(A - B))`       | 15 ns |

### 求值规模（加权和）

| 组成项数量 | 时间  |
| ---------- | ----- |
| 2          | 14 ns |
| 4          | 18 ns |
| 8          | 28 ns |

### 编译（冷路径）

| 公式模式      | 时间   |
| ------------- | ------ |
| 简单平均      | 675 ns |
| 4 项输入加权  | 1.4 us |
| 条件表达式    | 1.0 us |
| 使用局部变量  | 1.3 us |
| 含连字符的 ID | 755 ns |

## 错误处理

Vibe 会在每个边界验证合成金融工具。公式编译会拒绝未知符号、类型错误和容量溢出；求值会在价格进入公式之前拒绝错误的输入数量和非有限价格（NaN、Infinity）。

有关输入要求和异常，请参阅 [`SyntheticInstrument` API 参考](/docs/python-api-latest/model/instruments.html#vibe_trader.model.instruments.synthetic.SyntheticInstrument)。

## 相关指南

- [金融工具](instruments/) - 金融工具定义和交易场所特定的金融工具类型。
- [数据](data/) - 引用金融工具的市场数据类型。
- [订单](orders/) - 订单可以将合成金融工具 ID 用作模拟触发条件。
