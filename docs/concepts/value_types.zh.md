# 值类型

VibeTrader 提供表示核心交易概念的专用值类型：`Price`、`Quantity` 和 `Money`。
这些类型在内部使用定点算术，从而在不同平台和环境中实现高性能、确定性的计算。

## 概览

| 类型       | 用途                       | 有符号 | 货币 |
| ---------- | -------------------------- | ------ | ---- |
| `Quantity` | 成交数量、订单数量、持仓。 | 否     | -    |
| `Price`    | 市场价格、报价、价格档位。 | 是     | -    |
| `Money`    | 货币金额、盈亏、账户余额。 | 是     | 是   |

## 不可变性

所有值类型都**不可变**。值一旦构造就无法修改，操作不会改变原对象。

```python
from vibe_trader.model.objects import Quantity

qty1 = Quantity(100, precision=0)
qty2 = Quantity(50, precision=0)

# This creates a NEW Quantity; qty1 and qty2 are unchanged
result = qty1 + qty2

print(qty1)  # 100
print(qty2)  # 50
print(result)  # 150
```

该设计具有以下优点：

- **线程安全**：不可变值可以安全地在线程之间共享，无需同步。
- **可预测性**：值不会意外变化，使调试更容易。
- **可哈希性**：不可变类型可用作字典 key，也可存入 set。

## 算术运算

值类型支持标准算术运算符（`+`、`-`、`*`、`/`、`%`、`//`）和一元运算符
（`-`、`+`、`abs`）。返回类型取决于运算符和操作数类型。

### 同类型二元运算

相同值类型之间的加减法会返回该类型，从而保留领域含义（价格加价格仍是价格）：

| 运算                  | 结果       |
| --------------------- | ---------- |
| `Quantity + Quantity` | `Quantity` |
| `Quantity - Quantity` | `Quantity` |
| `Price + Price`       | `Price`    |
| `Price - Price`       | `Price`    |
| `Money + Money`       | `Money`    |
| `Money - Money`       | `Money`    |

```python
from vibe_trader.model.objects import Price

price1 = Price(100.50, precision=2)
price2 = Price(0.25, precision=2)

result = price1 + price2  # Returns Price(100.75, precision=2)
print(type(result))  # <class 'Price'>
```

相同类型的两个值之间进行乘法、除法、整除和取模会返回 `Decimal`：

| 运算             | 结果      |
| ---------------- | --------- |
| `Price * Price`  | `Decimal` |
| `Price / Price`  | `Decimal` |
| `Price // Price` | `Decimal` |
| `Price % Price`  | `Decimal` |

同一模式也适用于 `Quantity` 和 `Money`。

这些运算不返回原类型，因为结果具有不同的量纲含义。价格乘以价格会产生"价格平方"，而不是价格；
数量除以数量会产生无量纲比率，而不是数量。返回 `Decimal` 可以明确单位变化，并防止把结果误解为
仍具有原单位的值。

### 一元运算

只要结果对该类型有效，一元运算符就会保留值类型：

| 运算       | `Price`   | `Quantity` | `Money`   |
| ---------- | --------- | ---------- | --------- |
| `-x` (neg) | `Price`   | `Decimal`  | `Money`   |
| `+x` (pos) | `Price`   | `Quantity` | `Money`   |
| `abs(x)`   | `Price`   | `Quantity` | `Money`   |
| `int(x)`   | `int`     | `int`      | `int`     |
| `float(x)` | `float`   | `float`    | `float`   |
| `round(x)` | `Decimal` | `Decimal`  | `Decimal` |

`Quantity.__neg__` 返回 `Decimal` 而不是 `Quantity`，因为 `Quantity` 无符号，无法表示负值。

```python
from vibe_trader.model.objects import Price, Quantity, Money
from vibe_trader.model.currencies import USD

price = Price(100.50, precision=2)
print(-price)  # -100.50
print(type(-price))  # <class 'Price'>

money = Money(-50.00, USD)
print(abs(money))  # 50.00 USD
print(type(abs(money)))  # <class 'Money'>

qty = Quantity(10, precision=0)
print(+qty)  # 10
print(type(+qty))  # <class 'Quantity'>
```

### 混合类型运算

与其他数值类型运算时，结果类型遵循 Python 的
[数值塔](https://docs.python.org/3/library/numbers.html)约定。一般原则是运算会提升到更通用的类型：
`float` 运算返回 `float`，而 `int` 和 `Decimal` 运算为保留精度返回 `Decimal`。

该规则适用于全部六个二元运算符（`+`、`-`、`*`、`/`、`//`、`%`），并且双向有效
（`value op scalar` 和 `scalar op value`）：

| 左操作数  | 右操作数  | 结果类型  |
| --------- | --------- | --------- |
| 值类型    | `int`     | `Decimal` |
| 值类型    | `float`   | `float`   |
| 值类型    | `Decimal` | `Decimal` |
| `int`     | 值类型    | `Decimal` |
| `float`   | 值类型    | `float`   |
| `Decimal` | 值类型    | `Decimal` |

```python
from decimal import Decimal
from vibe_trader.model.objects import Quantity

qty = Quantity(100, precision=0)

# Quantity + int -> Decimal
result1 = qty + 50
print(type(result1))  # <class 'decimal.Decimal'>

# Quantity + float -> float
result2 = qty + 50.5
print(type(result2))  # <class 'float'>

# Quantity + Decimal -> Decimal
result3 = qty + Decimal("50")
print(type(result3))  # <class 'decimal.Decimal'>
```

## 精度处理

每个值类型都存储一个表示小数位数的精度字段。精度在构造时设置且不可变，不存在"未指定"精度。

### 定点表示

值类型在内部存储为按全局固定精度缩放的整数（例如高精度模式下为 10^16），而不是浮点数。
`precision` 字段记录构造时使用的小数位数，用于控制显示格式和序列化；底层原始值始终使用全局 scale。

```python
from vibe_trader.model.objects import Price

p1 = Price(1.23, precision=2)  # displays as "1.23"
p2 = Price(1.230, precision=3)  # displays as "1.230"

p1 == p2  # True: same underlying value
str(p1)  # "1.23"
str(p2)  # "1.230"
```

**精度控制显示，而不控制身份。** 两个价格的十进制值相同时，即使精度不同也彼此相等。
`precision` 字段决定字符串格式和显示的小数位数；相等性则取决于底层数值。

**市场数据序列化使用精度元数据。** 当市场数据类型（报价、成交、订单簿增量）写入 Parquet 或 Arrow
格式时，精度会存储在文件元数据中，从而正确解码数值。同一个文件内的所有市场数据值必须具有相同精度。

:::note
如果场所更改交易工具的 tick size（因而更改精度），变更前后写入的数据文件会包含不同精度元数据，
不应合并到同一个文件中。
:::

有关交易工具级精度如何约束有效价格和数量，请参阅交易工具指南的
[精度](instruments/index.md#precision)章节。

### 算术精度

对精度不同的值进行算术运算时，结果使用操作数中的最大精度。

```python
from vibe_trader.model.objects import Price

price1 = Price(100.5, precision=1)  # 1 decimal place
price2 = Price(0.125, precision=3)  # 3 decimal places

result = price1 + price2
print(result)  # 100.625
print(result.precision)  # 3 (max of 1 and 3)
```

## 类型特有约束

### Quantity

`Quantity` 表示非负数量。尝试创建负数量，或从较小数量减去较大数量时会引发错误：

```python
from vibe_trader.model.objects import Quantity

# This raises ValueError: Quantity cannot be negative
qty = Quantity(-100, precision=0)

# This also raises ValueError
qty1 = Quantity(50, precision=0)
qty2 = Quantity(100, precision=0)
result = qty1 - qty2  # Would be -50, which is invalid
```

### Money

`Money` 值包含货币。`Money` 值之间的加减要求货币匹配：

```python
from vibe_trader.model.objects import Money
from vibe_trader.model.currencies import USD, EUR

usd_amount = Money(100.00, USD)
eur_amount = Money(50.00, EUR)

# This works - same currency
result = usd_amount + Money(25.00, USD)

# This raises ValueError - currency mismatch
result = usd_amount + eur_amount
```

## 常用模式

### 累加值

由于值类型不可变，应通过重新赋值进行累加：

```python
from vibe_trader.model.objects import Money
from vibe_trader.model.currencies import USD

total = Money(0.00, USD)
amounts = [Money(100.00, USD), Money(50.00, USD), Money(25.00, USD)]

for amount in amounts:
    total = total + amount  # Reassign to new Money instance

print(total)  # 175.00 USD
```

### 转换为其他类型

值类型提供转换方法：

```python
from vibe_trader.model.objects import Price

price = Price(123.456, precision=3)

# Convert to Decimal (preserves precision)
decimal_value = price.as_decimal()

# Convert to float
float_value = price.as_double()

# Convert to string
string_value = str(price)  # "123.456"
```

### 从字符串创建

从字符串表示中解析值类型：

```python
from vibe_trader.model.objects import Quantity, Price, Money

qty = Quantity.from_str("100.5")
price = Price.from_str("99.95")
money = Money.from_str("1000.00 USD")
```
