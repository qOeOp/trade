# Rust

Rust 强大的类型系统、所有权模型和可预测性能，使它非常适合 VibeTrader 的关键核心。
安全 Rust 会在编译期阻止数据竞争和许多内存错误；`unsafe` 代码必须明确说明编译器无法检查的不变量。

修改手写 Rust 源代码、Cargo manifest、PyO3 绑定或 Rust 测试时，请使用本参考。
通用 Rust 风格由 `rustfmt` 和工作区 lint 负责。本页记录容易在评审中遗漏的 VibeTrader 特有选择。

## 事实来源

| 关注点           | 来源                                               |
| ---------------- | -------------------------------------------------- |
| 格式与导入。     | `rustfmt.toml`。                                   |
| 工作区 lint。    | `Cargo.toml` 和 `clippy.toml`。                    |
| Cargo 布局。     | `.pre-commit-hooks/check_cargo_conventions.sh`。   |
| Rust 布局。      | `.pre-commit-hooks/check_formatting_rs.sh`。       |
| Vibe 类型约定。  | `.pre-commit-hooks/check_vibe_conventions.sh`。    |
| 异步边界。       | `.pre-commit-hooks/check_tokio_usage.sh`。         |
| DST 边界。       | `.pre-commit-hooks/check_dst_conventions.sh`。     |
| PyO3 绑定。      | `.pre-commit-hooks/check_pyo3_conventions.sh`。    |
| Anyhow。         | `.pre-commit-hooks/check_anyhow_usage.sh`。        |
| 错误名称。       | `.pre-commit-hooks/check_error_conventions.sh`。   |
| 日志。           | `.pre-commit-hooks/check_logging_conventions.sh`。 |
| Rustdoc 契约。   | `.pre-commit-hooks/check_docs_conventions.sh`。    |
| 测试风格。       | `.pre-commit-hooks/check_testing_conventions.sh`。 |
| 工作区测试选择。 | `scripts/ci/check-workspace-test-coverage.sh`。    |

工具无法决定某项选择时，应与邻近代码保持一致。不要直接编辑生成文件，应修改生成器输入并重新生成输出。

## Cargo manifest

### 依赖与章节

- 共享依赖使用工作区继承，例如 `serde = { workspace = true }`。只有依赖不由工作区管理时，
  才在 crate 中固定版本。
- 依赖组之间保留一个空行，每组按字母排序。manifest 通常把内部 `vibe-*` crate、必需外部 crate 和
  可选外部 crate 分组，但应保留 manifest 中有意义的本地分组。
- 保持标准章节顺序：package、lint、library、feature、`cargo-machete` 元数据、docs.rs 元数据、依赖、
  开发依赖、构建依赖、bench、二进制文件、示例和测试。
- 每个具有 library 或 binary target 的工作区 crate 都应添加 `[lints] workspace = true`。
- 适配器依赖保留在工作区 `Cargo.toml` 的 `# Adapter dependencies` 章节中。核心 crate 不得依赖该章节条目。
- 相关依赖家族应保持兼容。Cargo 约定 hook 会检查已知约束，包括 `capnp` 与 `capnpc`、`arrow` 与
  `parquet`，以及 `dydx-proto` 与 `prost`、`tonic`。
- `[package.metadata.cargo-machete] ignored` 中只能列出已声明的依赖。
- 根 `[workspace.dependencies]` 中不再被任何 crate 使用的条目应删除。只供 CI 和顶层工作区包使用的
  Cargo 工具不受此检查限制。
- 适配器 crate 应通过 `vibe-live` 获取 `libfuzzer-sys`；不要直接把它加入适配器 manifest。

当 `crates/pyo3/Cargo.toml` 单独对适配器分组时，将其 `# Adapters` 块放在核心内部 crate 下方。

### Package 字段

crate 的 `[package]` 章节使用以下规范前缀。`readme` 可选；所示其他字段均为必需项。

```toml
[package]
name = "vibe-example"
readme = "README.md"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
publish = false
description = "Example crate for VibeTrader"
repository.workspace = true
```

可选的 `build` 和 `include` 字段放在 `repository.workspace` 之后。

### Feature

- 保留 crate 现有的默认 feature 契约。大多数核心 crate 的默认 feature 为空，而许多适配器 crate
  默认启用 `high-precision`。
- 每个构建 Python 制品的 `extension-module` feature 都应包含 `"python"`，并放在
  `"pyo3/extension-module"` 旁边。
- 把 `high-precision` 传播到存储或构造定点领域值的依赖 Vibe crate。
- 在 crate 级文档中记录公共 feature。

### Target

- `bin/` 源文件使用 snake_case 文件名，可执行文件名使用 kebab-case，例如
  `path = "bin/ws_data.rs"` 和 `name = "hyperliquid-ws-data"`。
- binary 和 example target 设置 `doc = false`；binary target 还应设置 `test = false`。
- 当 crate 生成多种 library 类型时，按 `rlib`、`staticlib`、`cdylib` 顺序排列。

## 源代码布局

不要编辑生成的 Rust、C header、Python stub 或包装器文档注释；应修改生成器输入并重新运行生成器。

### 模块声明

包含子模块的模块以 `mod.rs` 为根。在每个连续声明块中，外部模块按以下章节排序：

1. `#[macro_use]` 模块。
1. 公共模块。
1. `pub(crate)` 等受限模块。
1. 由 feature 控制的模块。
1. 私有模块。
1. 仅测试模块。

每个章节内按字母排序，章节之间保留一个空行。格式 hook 会在 `mod.rs` 文件中强制该顺序。

使用能够满足调用方需求的最窄可见性。工作区拒绝无法访问的 `pub` item。

### Item 放置

- import 保持在文件或模块顶部。只有窄作用域能显著提高清晰度时才使用本地 import。
- 主要类型及其 inherent implementation 放在模块顶部附近。在适配器中，把私有路由类型、决策枚举和
  解析函数放在主要客户端实现下方。
- 私有函数和类型放在调用方下方。

### Box 风格横幅注释

不要使用 box 风格的横幅或分隔注释。使用模块和 implementation 块表达结构。

## 格式与属性

`rustfmt` 会把标准库、外部 crate 和本地 import 分组，再对各组按字母排序。运行格式化器，
不要手工排列 import。

以下位置保留一个空行：

- 函数之间，包括测试函数。
- 每个 `///` 或 `//!` 文档注释上方。
- 独立 `if`、`match`、`for`、`while` 和 `loop` 表达式上方。
- task spawn 调用上方。

如果控制流或 spawn 表达式位于代码块开头、延续前一操作，或者附带注释或属性，则上述规则不适用。

对已有变量使用行内格式参数：

```rust
anyhow::bail!("Failed to subtract {n} months from {datetime}");
```

当丢弃返回值几乎必然是错误时，应为构造器、访问器、纯转换和消费自身的 `with_*` 方法添加
`#[must_use]`。`Result` 等返回类型已经自带 `must_use` 注解。

抑制 `missing_panics_doc` 或 `missing_errors_doc` 时，应包含说明该 lint 为何不适用的理由：

```rust
#[allow(clippy::missing_panics_doc, reason = "mutex poisoning is not expected")]
```

## 类型限定

| Item                         | 约定                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| `anyhow`。                   | 只导入 `anyhow::Context`；完整限定 macro 和 `Result`。                 |
| Vibe 领域类型。              | 导入类型，然后使用短名称。                                             |
| Tokio 时间、同步和任务。     | 使用完整限定路径；使用 `std::time::Duration`。                         |
| `Debug` 和 `Display`。       | 导入 trait。                                                           |
| `Formatter` 和 `fmt::Result` | 在 implementation 中使用 `std::fmt::Formatter` 和 `std::fmt::Result`。 |
| Vibe macro。                 | 导入 `vibe_actor!` 或 `vibe_strategy!`，然后以非限定形式调用。         |

手写 `Debug` implementation 时使用 `debug_struct(stringify!(TypeName))`。

只有 macro、生成路径或条件 import 需要完整限定的 Vibe 类型时，才使用 `// vibe-import-ok`。
把 marker 放在受影响的行上，或直接放在窄代码块上方。

## 错误与日志

### 错误边界

在 API 边界选择错误类型：

| 边界                        | 返回类型                            |
| --------------------------- | ----------------------------------- |
| 可复用 library 或领域 API。 | 类型化的 `Result<T, E>`。           |
| 应用或适配器编排。          | `anyhow::Result<T>`。               |
| 公共输入验证。              | 适用时使用 `CorrectnessResult<T>`。 |

- 当调用方会检查错误或从失败中恢复时，使用 `thiserror` 定义类型化错误。
- 错误 pattern 和 closure 绑定命名为 `e`，不要命名为 `err` 或 `error`。
- 从 `anyhow::Result` 函数提前返回时使用 `anyhow::bail!`。需要错误值时使用 `anyhow::anyhow!`，
  例如在 `ok_or_else` 内。
- `.context()` 消息以小写文本开头，使链接后的错误自然可读。开头是专有名词或缩写时保留其大小写。
- 错误或断言中不要使用 `", got"`。根据上下文使用 `", was"`、`", received"` 或 `", found"`。

```rust
parse_timestamp(value).context("failed to parse timestamp")?;
connect().context("BitMEX websocket did not become active")?;
```

### 日志

- 完整限定日志 macro，例如 `log::debug!` 和 `log::info!`。
- 消息以大写单词开头，结尾不使用句号。
- 当结尾句号属于被记录值而非句子标点时，在调用处或其上方三行内使用 `// log-period-ok`。
- 连接与客户端生命周期、重连、对账和批量状态摘要保持在 `INFO`。
- 订阅细节、逐订单确认、交易工具数量、身份验证和 WebSocket 内部细节保持在 `DEBUG`。
- 当意外的、用户可处理的或数据丢失情况在本地被处理时，记录 warning 或 error。不要记录仍通过 `?`
  或 `anyhow::bail!` 向上传播的 error。
- 日志调用上方保留一个空行，除非它是函数第一行。
- 生产 library 代码不得写入 stdout 或 stderr，也不得终止进程。binary、example、bench、test、
  adapter、CLI 和 testkit 在控制进程属于其职责时可以这样做。

## 异步代码

同步核心 crate 不把 Tokio 作为常规依赖。`common` crate 保持 Tokio 可选。
Tokio 约定 hook 负责精确的 crate 列表。

适配器生产代码使用共享运行时，因为调用可能来自没有线程本地 Tokio context 的 Python 线程：

```rust
use vibe_common::live::get_runtime;

get_runtime().spawn(async move {
    run_client().await;
});
```

- 通过 `vibe_common::live` 导入 `get_runtime`，不要通过 `live::runtime` 导入。
- 同步适配器代码必须调用异步函数时，使用 `get_runtime().block_on()`。
- 测试中使用 `#[tokio::test]` 提供的运行时；其中可以使用 `tokio::spawn()`。
- 只有完整限定形式或共享运行时无法满足该位置时，才在 import 或 spawn 行上添加
  `// tokio-import-ok`。
- 在 `LiveNode::build()` 或使用任何适配器前安装自定义运行时。构建启用所有 driver 的多线程运行时。
- `set_runtime()` 会绕过默认初始化器，包括 Python 初始化。启用 `python` feature 时，应在安装
  自定义运行时前初始化 Python，或者保留默认运行时。

确定性模拟路径上的代码遵循 [DST 确定性契约](../concepts/dst.md#determinism-contract)。
时钟、随机值、任务 spawn 和网络访问都通过项目接缝路由。该路径上的 `tokio::select!` 块使用 `biased;`。

## 构造与转换

### 构造器模式

经过验证的值类型会配对提供可失败的 `new_checked()` 和便捷的 `new()`：

```rust
pub fn new_checked<T: AsRef<str>>(value: T) -> CorrectnessResult<Self> {
    let value = value.as_ref();
    check_valid_string_ascii(value, stringify!(value))?;
    Ok(Self(Ustr::from(value)))
}

pub fn new<T: AsRef<str>>(value: T) -> Self {
    Self::new_checked(value).expect_display(FAILED)
}
```

将共享 `FAILED` 常量与 `CorrectnessResultExt::expect_display` 配合使用，使 panic 消息采用标准的
`Condition failed: ...` 前缀。在 `new_checked()` 上记录错误，在 `new()` 上记录 panic。

以可选字段为主、构造器较长的类型也可以暴露 `bon` builder。在 inherent implementation 上添加
`#[bon::bon]`，使 builder 的完成方法委托给 `new_checked()`。保持 `new()` 和 `new_checked()` 为唯一
验证路径。

```rust
#[builder(start_fn = builder, finish_fn = build)]
pub fn build_checked(/* same inputs as new_checked */) -> CorrectnessResult<Self> {
    Self::new_checked(/* forward inputs */)
}
```

必需字段在 `bon` typestate 中仍为必需项。可选字段仍可省略，`build()` 返回与 `new_checked()` 相同的
`CorrectnessResult`。

### 转换模式

- 只有绝不会失败且完整的转换才实现 `From`。
- 当源可能包含无效或无法表示的值时，实现 `TryFrom`。
- 字符串解析实现 `FromStr`。
- 将会 panic 的通用 `From<T: AsRef<str>>` implementation 视为兼容性表面。新 API 不要复制该模式。
- 场所 wire enum 与 Vibe 领域 enum 保持分离。使用惯用 Rust variant 名称，通过 `serde` 或 `strum`
  属性表达 wire 拼写，并在边界显式转换。
- 构造领域对象前，把适配器 payload 反序列化为 wire 模型。解析和验证保留在转换函数中，
  不要把场所 wire 细节嵌入领域类型。

### 领域数值类型

从摄取开始，就把离散金融值保持为 decimal：

| 值                         | 类型与构造                                                   |
| -------------------------- | ------------------------------------------------------------ |
| 价格或数量。               | `Price::from_decimal_dp` 或 `Quantity::from_decimal_dp`。    |
| 金额、费用、保证金或余额。 | `Decimal`，然后使用 `Money::from_decimal` 或 `Money::zero`。 |
| 连续信号比率或时间曲线。   | decimal 精度没有领域含义时使用 `f64`。                       |

不要让 wire 值经过 `f64` 构造器。测试中，用 `.as_decimal()` 与 `dec!(value)` 比较。

## 集合

根据迭代语义和信任边界选择哈希集合：

| 要求                         | 集合                       |
| ---------------------------- | -------------------------- |
| 可观察的插入顺序迭代。       | `IndexMap` 或 `IndexSet`。 |
| 不观察迭代顺序的热点查找。   | `AHashMap` 或 `AHashSet`。 |
| key 由不受信任的第三方选择。 | `HashMap` 或 `HashSet`。   |
| 外部 API 要求标准集合。      | `HashMap` 或 `HashSet`。   |

`AHash` 迭代会在进程之间变化。当顺序离开进程或推进带种子的 RNG 时，必须固定顺序：发出的事件、命令、
发送到场所的流量、持久化输出和随机数消费。没有生产调用方消费的序列无需固定。

以下任一机制都可以满足要求：把集合保存在 `IndexMap` 或 `IndexSet` 中，或者保留哈希集合并在使用点排序。
集合的热点操作是查找或删除时优先排序，因为 `shift_remove` 为 O(n)；插入顺序本身就是有意义序列时，
优先使用 `IndexMap`。删除必须保持插入顺序时使用 `shift_remove`，无需保持时使用 `swap_remove`。

`AHashMap` 和 `AHashSet` 使用非密码学 hasher。当不受信任的 key 使 hash flooding 抗性成为安全边界
的一部分时，不要使用它们。

### 缓存订单访问

`Cache` 通过生命周期受限的访问器隐藏其 `SharedCell` 订单存储。作用域读取使用 `order_ref()` 或
`try_order_ref()`，独占写借用使用 `order_mut()`，需要跨越边界的快照使用 `order_owned()` 或
`try_order_owned()`。订单不存在时，`try_*` 形式返回 `OrderLookupError`。

`order_mut()` 需要 `&mut Cache`，因此面向适配器的 `CacheView` 代码无法修改订单。
分派事件或获取可能重新进入同一订单的借用前，应 drop `OrderRef` 或 `OrderRefMut`，然后重新查找订单，
获取事件后的状态。

## 契约式设计

使用能够表达契约的最窄机制：

| 情况                           | 机制                                      |
| ------------------------------ | ----------------------------------------- |
| 编译期状态或所有权规则。       | 类型、生命周期、newtype 和可见性。        |
| 公共输入前置条件。             | `vibe_core::correctness` 中的 `check_*`。 |
| 经过验证的值构造。             | `new_checked()` 和 `new()` 包装器。       |
| 可恢复的解析、I/O 或网络故障。 | `Result<T, E>`。                          |
| 编译器无法证明的内部不变量。   | `debug_assert!`，由针对性测试覆盖。       |
| 健全性或始终启用的不变量。     | `assert!` 或已检查的错误路径。            |

把断言放在代码首次依赖该不变量的位置。绝不要使用 `debug_assert!` 验证公共输入或健全性条件，
因为 release 构建会移除它。

debug 断言消息以 `Invariant:` 开头，并陈述正向规则。共享的 `Condition failed: ...` 前缀表示调用方
输入违规；`Invariant: ...` 表示内部契约错误。

## 文档

### 覆盖与语气

- 为公共 item 添加文档注释。只有不明显的上下文可以防止误读时，才用普通注释记录私有行为。
- 为公共模块和具有不明显契约的模块添加模块文档。不要给私有叶子模块添加样板文字。
- 使用陈述语气："Returns the account ID"，而不是 "Return the account ID"。
- 公共字段和 enum variant 文档以句号结尾。
- 文档密度与相邻 item 保持一致。不要为使空白代码块看起来统一而添加填充注释。
- 私有字段的重要上下文放入类型级文档，不要逐个记录字段。

当公共函数的契约无法完全从类型和名称看出时，应为其编写文档。涵盖失败条件、panic 条件、
安全义务和不明显的输入语义。

### Rustdoc 章节

Rustdoc 章节标题使用标题式大小写：

- `# Examples`
- `# Errors`
- `# Panics`
- `# Safety`
- `# Notes`
- `# Thread Safety`
- `# Feature Flags`

只有一个错误或 panic 条件时使用一句话：

```rust
/// # Errors
///
/// Returns an error if the currency conversion fails.
```

有多个条件时使用以句号结尾的项目符号：

```rust
/// # Errors
///
/// Returns an error if:
/// - The market price cannot be found.
/// - The conversion rate calculation fails.
```

`# Errors` 只用于返回 `Result`、`PyResult` 或 `Option` 的函数。只有函数可能 panic 时才使用
`# Panics`；如果函数不会 panic，应删除该章节，而不是说明它不会 panic。

文档 hook 能识别返回 `Result` 的函数中的直接 panic 位置。当被调用函数提供已记录的 panic 时，
把 `// panics-doc-ok` 紧邻放在文档块上方。只有签名检查无法识别特殊错误契约时，才在相同位置使用
`// errors-doc-ok`。

### 文档示例

`make cargo-test-doc` 会编译并运行文档示例。每个围栏都应添加注解：

| 围栏           | 行为             | 用途                             |
| -------------- | ---------------- | -------------------------------- |
| `rust`         | 编译并运行。     | 不依赖外部资源的自包含示例。     |
| `rust,no_run`  | 编译但不运行。   | 需要 catalog、网络或场所的示例。 |
| `ignore`       | 不编译也不运行。 | 伪代码；说明无法编译的原因。     |
| `compile_fail` | 必须编译失败。   | 演示被拒绝的用法。               |
| `text`         | 非代码。         | 目录树、输出或图表。             |
| `bash`, `json` | 非 Rust。        | 命令或 payload。                 |

只有运行时依赖不可用时，优先使用 `no_run` 而不是 `ignore`。必须参与编译但会影响渲染示例可读性的设置行，
以 `#` 为前缀。

把示例放在公共 item 上。Rustdoc 也会收集私有 item 文档中的围栏，但这些示例无法导入其所记录的 item。

## Python 绑定

### PyO3 名称与错误

- 使用 `#[pyo3(name = "...")]` 重命名的 Rust 函数以 `py_` 为前缀。
- 当绑定需要仅供 Rust 使用的包装类型时，以 `Py` 为其前缀，并暴露不带该前缀的 Python 名称。
- 公共适配器 stub 元数据使用 `vibe_trader.adapters.<adapter_name>`。运行时模块路径使用
  `vibe_trader._libvibe.<adapter_name>`。
- 标准 Python 异常使用 `vibe_core::python` 中的 `to_pyvalue_err`、`to_pytype_err`、
  `to_pyruntime_err`、`to_pykey_err`、`to_pyexception` 或 `to_pynotimplemented_err` 转换。

`crates/pyo3/src/lib.rs` 中注册的子模块属于公共 API。不要因为重构副作用，把内部 crate 添加为新的
Python 子模块。如果能保留公共包结构，应在现有子模块中注册有意公开的类。刻意修改子模块时，
还要更新 `check_vibe_conventions.sh` 中的 allowlist。

每个子模块注册保持为 `let n = "<name>"`，后接一次 `pyo3::wrap_pymodule!(<path>)` 调用。
名称必须与目标路径的最后一个组成部分匹配。

### PyO3 enum

向 Python 暴露的整数 enum 使用 `frozen`、`eq`、`eq_int`、`from_py_object` 和
`rename_all = "SCREAMING_SNAKE_CASE"`。

不要为 `eq_int` enum 添加 PyO3 的 `hash` 属性。它生成的哈希与相等整数判别值的 Python 哈希不同，
会破坏相等值必须具有相等哈希的规则。应直接返回判别值：

```rust
#[pymethods]
impl MyEnum {
    const fn __hash__(&self) -> isize {
        *self as isize
    }
}
```

### 类型 stub 注解

每个向 Python 暴露的类型和函数都需要匹配的 `pyo3-stub-gen` 注解：

| PyO3 构造         | Stub 注解                                        |
| ----------------- | ------------------------------------------------ |
| `#[pyclass]`      | `pyo3_stub_gen::derive::gen_stub_pyclass`。      |
| Enum `#[pyclass]` | `pyo3_stub_gen::derive::gen_stub_pyclass_enum`。 |
| `#[pymethods]`    | `pyo3_stub_gen::derive::gen_stub_pymethods`。    |
| `#[pyfunction]`   | `pyo3_stub_gen::derive::gen_stub_pyfunction`。   |

- class 和 enum stub 注解放在运行时 `pyo3::pyclass` 属性正下方的
  `#[cfg_attr(feature = "python", ...)]` 中。
- `gen_stub_pymethods` 紧邻放在 `#[pymethods]` 下方。
- `gen_stub_pyfunction` 放在文档注释之后、`#[pyfunction]` 正上方。
- stub `module` 设置为 Python 导入对象时使用的包。
- 把 `pyo3-stub-gen` 添加为可选依赖，并纳入 `python` feature。

### 生成的 Python 制品

Python 表面会提交 `python/vibe_trader/` 下生成的 `.pyi` 文件，以及 `crates/**/src/python/` 下生成的
包装器文档注释。使用以下命令同时重新生成二者：

```bash
make py-stubs
```

修改向 Python 暴露的 Rust item、其 stub 注解、核心文档注释或适配器 feature 接线后，运行该 target。
把所有已变更的生成制品与源代码变更一起提交。

stub 生成器在调用 Cargo 前会移除 `extension-module`。如果某项 feature 只通过 `extension-module`
启用，应将其显式加入 `python/generate_stubs.py` 中的 `cargo_features`；否则它导出的类型会从生成的
stub 中消失。Interactive Brokers 的 `gateway` feature 是参考模型。

Python target 要求使用 `python/pyproject.toml` 中 `required-version` 固定的 uv 版本。
安装版本不同时，`make sync`、`make py-stubs` 和 `make build-debug` 会在同步前停止。
请使用 preflight 输出的更新命令。

不要编辑 `crates/**/src/python/` 中包装器的 `///` 注释。编辑核心 Rust item 文档后重新生成。
文档同步过程会：

- 保留 `# Errors` 和 `# Safety`。
- 删除 `# Panics`，使 panic 契约不会跨越 Python API 边界。
- 删除 Rust intra-doc 链接。
- 把 Rust `::` 路径转换为 Python `.` 路径。

### Rust-Python 对象所有权

`Py<T>` 拥有一个 Python 对象引用。在附加到解释器时使用 `Py::clone_ref` 克隆，或使用
`vibe_core::python::clone_py_object`。额外的 `Arc<Py<T>>` 通常没有必要，因为 `Py<T>` 已提供共享所有权。

克隆 Python 引用不会打破循环。回指不应保持目标存活时，应使用 Python 弱引用。

## 测试约定

- 普通内联测试使用 `mod tests`。
- 使用 `#[rstest]` 而不是 `#[test]`，包括非参数化测试。
- 非参数化异步测试使用 `#[tokio::test]`。
- 测试模块和仅测试文件保留 `#[cfg(test)]`。不要把测试行为或接口加入生产代码。
- JSON fixture 存储在 crate 的 `test_data/` 目录中，并使用 `include_str!` 加载。
- 使用不同的、非默认输入和精确预期值。断言每个稳定字段。
- 除非测试逐步状态变化，否则在设置和操作后集中断言。
- 不要使用 Arrange、Act、Assert 分隔注释。

每个工作区 member 在 `Makefile` 的 `CORE_CRATES`、`ADAPTER_CRATES` 或 `NO_TEST_CRATES` 中恰好出现一次。
只有 crate 未定义 Rust 测试 target，且不包含 `#[test]`、`#[rstest]` 或 `#[test_case]` 函数时，
才把它加入 `NO_TEST_CRATES`。

相同行为适用于多个输入时，应参数化用例：

```rust
#[rstest]
#[case("AUDUSD", false)]
#[case("CL.FUT", true)]
fn test_symbol_is_composite(#[case] input: &str, #[case] expected: bool) {
    assert_eq!(Symbol::new(input).is_composite(), expected);
}
```

### 测试 spec

构造参数很多的事件会在 `events/<event>/spec/` 下、紧邻事件提供 fluent `bon` spec。
使用 `#[cfg(any(test, feature = "stubs"))]` 控制该模块，使下游测试可以选择启用，
又不把 spec 加入生产构建。

- 派生 `bon::Builder` 并设置 `finish_fn = into_spec`。
- 为必需字段提供确定且有效的默认值。可选字段保留为 `Option<T>`。
- 使用 `crate::stubs` 中的 `test_uuid()` 设置默认事件 ID。
- 转发到生产构造器来实现 `build()`。
- 直接返回事件，因为 spec 默认值在构造时就是有效的。
- 在 spec 模块的一个测试中固定所有默认值。

只覆盖调用方相关字段：

```rust
let fill = OrderFilledSpec::builder()
    .last_qty(Quantity::from(50_000))
    .trade_id(TradeId::from("TRADE-1"))
    .build();
```

使用普通 `cargo test` 时，在比较 UUID 序列的测试前调用 `reset_test_uuid_rng()`。
`cargo nextest` 会在新进程中启动每个测试，因此序列会自动重置。

### 基于属性的测试

当不变量涵盖示例无法覆盖的一类输入时，使用 `proptest`。strategy 放在属性套件附近，
并将范围与显式边界情况结合。

属性名称以 `prop_` 为前缀，`proptest!` 内的测试保留 `#[rstest]`。大型套件可以使用
`property_tests` 模块或专用文件，但仓库也会把聚焦的属性放在其单元测试旁边。

## Unsafe Rust

Unsafe 代码必须使其证明义务可供评审：

- 每个 unsafe 函数都要有 `# Safety` 章节，完整说明调用方义务。
- 每个 unsafe 操作正上方放置 `SAFETY:` 注释，并说明为什么该位置满足前置条件。
- 每个 unsafe 操作都包装在自己的 `unsafe { ... }` 块中。工作区 crate 禁止
  `unsafe_op_in_unsafe_fn`。
- 对 null、alignment、provenance 和其他健全性条件使用始终启用的检查。
- 为 unsafe 代码周边的可观察行为添加针对性测试。测试为证明提供支持，但不能建立健全性。
- 把 unsafe `Send` 或 `Sync` implementation 视为针对全部可达状态、alias、callback、泛型参数、
  safe 方法、克隆和析构的证明。

跨 FFI 的原始向量遵循 [FFI 内存契约](ffi.md)。外部代码在转移后拥有分配，且必须恰好调用一次匹配的
`vec_drop_*` 函数。

### 运行时不变量

Actor 注册表、组件注册表和消息总线使用 `thread_local!` 存储。在一个线程上注册的对象对其他线程不可见。
`LiveNodeHandle` 是预期的跨线程控制表面。

将 `ActorRef` 限制在一个同步作用域内。不要把它存入 struct、跨 `.await` 持有或发送到其他线程。
在长生命周期 callback 中捕获 Actor ID，并在每次 callback 运行时查找 Actor。

组件注册表使用作用域借用 guard 拒绝别名可变访问。不要让组件生命周期操作可重入。

## 其他生成制品

### FFI 绑定与精度

只有 `vibe-core` 和 `vibe-model` 暴露 `ffi` feature。修改其 C ABI 时，直接检查这两个 crate：

```bash
cargo check -q -p vibe-core --features ffi
cargo check -q -p vibe-model --features ffi,python,high-precision
```

crate 本地的 `cbindgen.toml` 文件定义原生使用方的 header 布局。不要为其他工作区 crate 添加 `ffi`
feature 或 `src/ffi` 模块。

### Cap'n Proto schema

schema 文件位于 `crates/serialization/schemas/capnp/` 下，生成的 Rust 位于
`crates/serialization/generated/capnp/` 下。

- 在末尾添加字段。
- 不要删除字段或复用字段编号。在注释中把过时字段标记为 deprecated。
- 使用 `make regen-capnp` 重新生成。
- 评审 `git diff crates/serialization/generated/capnp`。
- 运行 `make check-capnp-schemas` 验证已提交的输出。
- 使用 `make cargo-test-crate-vibe-serialization` 测试序列化 crate。

按照[环境搭建](environment_setup.md#capn-proto)中的说明安装固定版本的编译器。
生成的绑定保持提交状态，使 docs.rs 无需编译器也能构建。
