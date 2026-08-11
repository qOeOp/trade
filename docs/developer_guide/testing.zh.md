# 测试

自动化测试是交易平台的可执行规范。健康的测试套件会记录预期行为，让贡献者有信心进行重构，
并在回归进入生产环境前发现它们。测试也充当持续更新的示例，用于阐明复杂流程并提供快速 CI 反馈，
使问题尽早显现。

测试套件涵盖以下类别：

- 单元测试
- 集成测试
- 验收测试
- 性能测试
- 基于属性的测试
- Fuzz 测试
- 内存泄漏测试

## 测试策略

测试与运行时契约共同构成一个设计系统。[契约式设计](rust.md#design-by-contract)阶梯会尽可能把不变量
推入类型系统；下方测试阶梯则通过更大的输入空间和更丰富的执行模型，逐级处理其余未知因素。
每一层都会把覆盖范围扩展到下层无法触及的输入或执行状态。

并非每个模块都需要所有技术。添加测试或 `debug_assert!` 语句前，使用本节判断适用哪些层级。

### 机制阶梯

运行时契约详见 [Rust 指南](rust.md#design-by-contract)：首先优先使用类型系统，然后在 API 边界使用
`vibe_core::correctness` 中的 `check_*`，再对内部不变量使用 `debug_assert!`，最后对健全性关键或
始终启用的检查使用 `assert!`。

测试层级以平行方式逐级增强。从能够证明目标的最低层级开始；只有当下层不再能够检测回归，
或输入空间超出人工列举范围时，才向上升级。

| 层级           | 触发条件                                                      |
| -------------- | ------------------------------------------------------------- |
| 单元测试       | 单个函数或状态转换只有少量可列举的情况。                      |
| 参数化测试     | 相同形状在离散输入（订单方向、状态、交易工具）中重复。        |
| 基于属性的测试 | 某项不变量必须对人脑无法逐一列举的一整类输入成立。            |
| 集成测试       | 多个模块通过真实（非 mock）的引擎或运行时交互。               |
| Fuzz 测试      | 不受信任或对抗性字节进入解析器、解码器或 wire‑format 处理器。 |
| 规范验收测试   | 行为依赖实现场所契约（参阅 `spec_exec_testing.md`）。         |
| 确定性模拟     | 正确性依赖任务调度、超时或实际时钟顺序。                      |
| 形式化验证     | 纯函数具有明确不变量和值得证明的有界输入空间。                |

形式化验证这一层目前是目标：工作区还没有 Kani 或 Prusti harness。该行记录采用验证器时的升级条件，
并非当前义务。

### 投影规则

模块形状决定哪些层级值得投入。并非每个模块都需要完整阶梯。应按模块粒度而不是 crate 粒度应用该规则：
一个适配器 crate 同时包含纯解析器和 I/O 密集型客户端循环，各行适用于不同部分。

| 模块形状               | 适用层级                         | 示例                          |
| ---------------------- | -------------------------------- | ----------------------------- |
| 纯函数，不变量明确     | 单元、参数化、属性、fuzz         | 对账 kernel、投资组合数学     |
| 纯函数，无已声明不变量 | 单元、参数化、属性、fuzz         | codec、适配器解析器、格式化器 |
| 有状态、同步           | 单元、参数化、针对转换的属性测试 | 缓存、订单簿                  |
| 有状态、异步           | 单元、集成、确定性模拟           | 实盘引擎、执行管理器          |
| I/O 密集、场所契约     | 集成、规范验收、边界 fuzz        | 适配器客户端循环              |

### 不应增加覆盖的情况

- 只在测试可以触达的位置添加 `debug_assert!`。release 构建会移除该检查，因此未被执行的断言没有信号。
  针对性单元测试可以作为 harness；proptest 或 fuzz harness 会放大信号。
- 当不变量涵盖一整类输入时，优先使用 proptest，而不是手写边界情况测试。对于已知的场所异常，
  或作为缩减后反例的回归复现，针对性单元测试仍然有效。
- 不要把实盘规范验收 card 重复实现为集成测试；应链接到它。
- 不要用只验证语言或框架保证的测试填充覆盖率（例如在 `Some(..)` 后断言 `Option::is_some`，
  或在 `push` 后断言 `Vec::len`）。

### DST 就绪条件

确定性模拟测试（DST）要求运行时不存在环境非确定性。将模块提升为在 DST 下运行前，请验证：

- 时间、任务、运行时和信号原语通过 `vibe_common::live::dst` 路由，而不是直接使用 `tokio`。
  实际时钟读取通过 `vibe_core::time` 中的接缝进行，而不是在调用点使用 `SystemTime::now()`。
- 迭代顺序会影响结果的状态 map 使用 `IndexMap` 或 `IndexSet`，而不是默认哈希集合。
- 控制平面路径上的每个 `tokio::select!` 都设置 `biased`，从而固定 poll 顺序。
- 不允许 `Instant::now()`、`SystemTime::now()`、`tokio::signal::ctrl_c`、`std::thread::spawn` 或
  `tokio::task::spawn_blocking` 调用绕过接缝。阻塞线程和 OS 线程原语会像环境时钟读取一样破坏
  madsim 的确定性。
- 对重放敏感的 ID（`trade_id`、`venue_order_id`）是其输入的纯函数；请参阅
  `crates/execution/src/reconciliation/ids.rs`。其他对账路径上的临时事件 UUID 无需确定。

`crates/common/src/live/dst.rs` 中的 `surface` 探针只固定重新导出形状，并不检查调用方是否实际使用
接缝。该要求通过评审执行。每当新异步模块进入工作区，或现有模块新增控制平面调度时，都应运行审计。

## 基于属性的测试

属性测试验证逻辑对*所有*有效输入成立，而不仅是人工选择的示例。Rust 使用
[`proptest`](https://altsysrq.github.io/proptest-book/intro.html) 来强制执行不变量。

- **用例：** 核心领域类型（`Price`、`Quantity`、`UnixNanos`）、会计引擎、撮合引擎和状态机。
- **不变量示例：**
  - 往返序列化：`parse(to_string(value)) == value`
  - 逆运算：`(A + B) - B == A`
  - 传递性：`If A < B and B < C, then A < C`

## Fuzz 测试

Fuzz 测试把无结构或恶意数据引入系统，验证系统可以平稳失败。

- **用例：** 网络边界、交易所数据解析器（JSON、FIX、WebSocket feed）和复杂状态机。
- **目标：** 遇到格式错误的数据时，系统返回 `Result::Err`，绝不 panic、挂起或泄漏内存。

适配器 fuzz 二进制文件在各自适配器包中注册，并由其 `fuzz` feature 控制。从仓库根目录运行某个
适配器的所有已注册 target：

```bash
scripts/fuzz-adapter.sh derive
```

工作区固定了 `libfuzzer-sys`，共享 libFuzzer 集成由 `vibe-live` 负责。另有一个
`publish = false` 包，专用于需要某些不得进入已发布适配器依赖图的依赖项的 fuzz target，
例如 Lighter 通过 git 固定的 Pornin 差分 oracle。

构建或修改核心类型时，应编写属性测试覆盖数学边界。

性能测试帮助演进性能关键组件。

使用主要测试 runner [pytest](https://docs.pytest.org) 运行测试。
使用参数化测试和 fixture（例如 `@pytest.mark.parametrize`）避免重复代码并提高清晰度。

## 运行测试

### Python 测试

Python 测试套件位于 `python/tests/` 下，用于测试以 Rust 为后端的 PyO3 包。它需要已构建的扩展模块，
并使用 `python/` 下的 Python 项目。从仓库根目录运行：

```bash
make pytest
```

Makefile target 会在独立 pytest 进程中隔离部分测试模块，以避免全局 Rust 状态冲突。
应使用 `make pytest`，不要直接调用 pytest。

本地 `make pytest` 使用 `make build-debug` 生成的 debug 扩展，CI 则测试 release wheel。
不要在 `python/tests/` 用例中使用 `pytest.raises(BaseException)` 或类似宽泛捕获，在进程内探测 Rust
panic 路径。这些测试对 debug 构建可能看似通过，却会在 release wheel 下中止解释器。
对于可能中止的 PyO3 或 FFI 方法，应验证 Python 签名和参数名，或在子进程中隔离调用。

对于已注册的 Rust 基准测试集合：

```bash
make cargo-ci-benches
```

CI 中没有接入规范的 Python 性能套件。有关聚焦的 Criterion 和 iai 命令、性能分析及测量策略，
请参阅[基准测试指南](benchmarking.md)。基准测试应与单元测试分开运行，以避免相互干扰。

### Rust 测试

```bash
make cargo-test
# or
cargo nextest run --workspace --features "arrow,ffi,python,high-precision,streaming,defi" --cargo-profile nextest --lib --tests
```

#### Rust doctest

`cargo nextest` 无法执行 doctest，因此它们通过单独 target 运行：

```bash
make cargo-test-doc
# or
cargo test --doc --workspace --features "arrow,ffi,python,high-precision,streaming,defi" --profile nextest
```

文档示例是受维护的测试表面：CI 会对涉及 Rust 代码的拉取请求运行该 target，`pre-flight` target
也包含它。有关如何标注围栏使其参与编译，请参阅 [Rust 指南](rust.md#doc-examples)。

#### 使用可选 feature 测试

使用 `EXTRA_FEATURES` 加入 `capnp` 或 `hypersync` 等可选 feature：

```bash
# Test with capnp feature
make cargo-test EXTRA_FEATURES="capnp"

# Test with multiple features
make cargo-test EXTRA_FEATURES="capnp hypersync"

# Legacy shorthand for hypersync
make cargo-test HYPERSYNC=true

# Test specific crate with features
make cargo-test-crate-vibe-serialization FEATURES="capnp"
```

### IDE 集成

- **PyCharm**：右键点击 tests 文件夹或文件 -> "Run pytest"。
- **VS Code**：使用 Python Test Explorer 扩展。

## 测试风格

### 通用

- 按测试函数所测试的对象命名；无需把预期断言编码到名称中。
- 文档字符串能够阐明设置、场景或预期时再添加。
- 尽可能**集中断言**：先完成所有 arrange/act 步骤，再集中 assert，避免 act-assert-act 异味。
- 测试中可以使用 `unwrap`、`expect` 或直接调用 `panic!`/`assert`；在此处，清晰和简洁比防御性
  错误处理更重要。
- 不要捕获日志输出来断言日志消息。测试中的日志捕获很脆弱，因为 logger 是全局状态，测试执行顺序
  不确定，而且日志措辞变化会破坏断言。应验证日志消息所反映的可观察行为（返回值、状态变更、副作用）。

### Python 测试（`python/tests/`）

使用 **pytest 风格的自由函数和 fixture**，不要使用测试类。

- 每个测试都写成独立的 `def test_*()` 函数。
- 共享设置（交易工具、引擎实例、数据）使用 `@pytest.fixture`。需要 teardown 时优先使用 `yield`
  fixture（例如 `engine.dispose()`）。
- 使用 `@pytest.mark.parametrize` 覆盖多种输入，避免重复测试主体。
- 从 `vibe_trader.model` 导入模型类型，不要从 `vibe_trader._libvibe` 导入。
- 测试 provider 位于 `python/tests/providers.py`。常用交易工具和数据使用 `TestInstrumentProvider`
  和 `TestDataProvider`。
- 依赖未完成功能的测试使用 `@pytest.mark.skip(reason="WIP: <description>")` 标记，不要删除。

### Rust

有关 Rust 特有的测试约定（模块结构、`#[rstest]`、参数化），请参阅
[Rust 指南](rust.md#testing-conventions)。

## 等待异步效果

Rust 测试应优先使用 `vibe_common::testing` 中的 `wait_until_async(...)`，而不是任意 sleep。
它会在条件成功后立即停止，并应用有界超时。

## Mock

优先使用返回固定值的手写 stub，而不是 mocking 框架。只有需要断言调用次数/参数，或模拟复杂状态变化时，
才使用 `MagicMock`。不要 mock 实际正在测试的对象。

## 代码覆盖率

使用 `coverage` 在本地生成覆盖率报告。

应追求高覆盖率，但不要牺牲适当的错误处理，也不要对架构造成"测试诱发损伤"。

有些分支若不修改生产行为就无法测试。例如，防御性 if-else 块中的最终条件可能只会被意外值触发；
应保留这些检查，使未来变更在适用时能够执行它们。

设计阶段的异常也可能难以测试，因此 100% 覆盖率并不是目标。

## 排除代码覆盖率

当测试会产生重复价值时，使用 `pragma: no cover` 注释
[排除代码覆盖率](https://coverage.readthedocs.io/en/coverage-4.3.3/excluding.html)。典型示例包括：

- 断言抽象方法在调用时抛出 `NotImplementedError`。
- 断言无法测试的 if-else 块最终条件（如上所述）。

这类测试的维护成本很高，因为它们必须跟随重构变化，却提供很少价值。
具体的抽象方法实现应保持完整覆盖。当 `pragma: no cover` 不再适用时应将其删除，并把使用范围限制在
上述情况。

## 调试 Rust 测试

使用默认测试配置调试 Rust 测试。

若要运行带 debug symbol 的完整套件以供后续使用，请运行 `make cargo-test-debug`，不要运行
`make cargo-test`。

在 IntelliJ IDEA 中，对于参数化 `#[rstest]` 用例，应把运行配置调整为
`test --package vibe-model --lib data::bar::tests::test_get_time_bar_start::case_1`
（删除 `-- --exact`，并附加 `::case_n`，其中 `n` 从 1 开始）。该 workaround 与
[rust-analyzer issue 8964](https://github.com/rust-lang/rust-analyzer/issues/8964#issuecomment-871592851)
所述行为一致。

在 VS Code 中可以直接选择要调试的具体测试用例。

## 调试 Python 和 Rust

原生 debugger 需要 Rust symbol 时，使用工作区的 `debug-pyo3` Cargo profile 构建 PyO3 扩展：

```bash
make sync
(
  cd python
  UV_PROJECT_ENVIRONMENT=../.venv \
    CARGO_TARGET_DIR=../target \
    uv run --no-sync maturin develop --profile debug-pyo3
)
```

使用 Python debugger 启动 Python 程序或 notebook，然后把 LLDB 或 GDB 附加到该 Python 进程，
以设置 Rust breakpoint。仓库不会生成编辑器 launch 配置，因此请在所用编辑器中配置两个 debugger
session。

## 数据类型测试

每种数据类型都会流经平台的多个层级。下表说明现有类型在哪些位置接受测试，使新类型可以遵循相同模式。

### 测试层矩阵

| 层级                   | 位置                                        | 覆盖内容                                  |
| ---------------------- | ------------------------------------------- | ----------------------------------------- |
| DataEngine subscribe   | `crates/data/tests/engine.rs`               | 引擎正确处理订阅/取消订阅命令。           |
| DataEngine publish     | `crates/data/tests/engine.rs`               | 引擎把已发布数据路由到消息总线。          |
| DataActor subscribe    | `crates/common/src/actor/tests.rs`          | Actor 通过类型化 publish 订阅并接收数据。 |
| DataActor unsubscribe  | `crates/common/src/actor/tests.rs`          | 取消订阅后 Actor 停止接收数据。           |
| PyO3 actor dispatch    | `crates/common/src/python/actor.rs`         | Rust handler 分派到 Python `on_*` 方法。  |
| Python Actor subscribe | `python/tests/unit/common/test_actor.py`    | Python Actor 订阅；命令计数递增。         |
| Python Actor unsub     | `python/tests/unit/common/test_actor.py`    | Python Actor 取消订阅；订阅列表清空。     |
| Adapter live tests     | `docs/developer_guide/spec_data_testing.md` | 实时数据验收测试（DataTester）。          |

### 各数据类型的覆盖

下表说明每种数据类型在哪些层级已有测试覆盖。添加新类型时，将其作为检查清单。

| 数据类型            | Engine | Actor (Rust) | PyO3 dispatch | Actor (Python) | Adapter spec |
| ------------------- | ------ | ------------ | ------------- | -------------- | ------------ |
| `InstrumentAny`     | ✓      | ✓            | ✓             | ✓              | ✓            |
| `OrderBookDeltas`   | ✓      | ✓            | ✓             | ✓              | ✓            |
| `OrderBook`         | ✓      | ✓            | ✓             | ✓              | ✓            |
| `QuoteTick`         | ✓      | ✓            | ✓             | ✓              | ✓            |
| `TradeTick`         | ✓      | ✓            | ✓             | ✓              | ✓            |
| `Bar`               | ✓      | ✓            | ✓             | ✓              | ✓            |
| `MarkPriceUpdate`   | ✓      | ✓            | ✓             | ✓              | ✓            |
| `IndexPriceUpdate`  | ✓      | ✓            | ✓             | ✓              | ✓            |
| `FundingRateUpdate` | ✓      | ✓            | ✓             | ✓              | ✓            |
| `InstrumentStatus`  | ✓      | ✓            | ✓             | ✓              | ✓            |
| `InstrumentClose`   | ✓      | ✓            | ✓             | ✓              | ✓            |
| `OptionGreeks`      | ✓      | ✓            | ✓             | ✓              | ✓            |
| `OptionChainSlice`  | -      | ✓            | ✓             | ✓              | ✓            |
| `CustomData`        | ✓      | ✓            | ✓             | ✓              | -            |

`OptionChainSlice` 由 DataEngine 的 `OptionChainManager` 根据逐交易工具希腊字母指标和报价订阅组装，
它没有自己的引擎订阅命令。

### 添加新数据类型

引入新数据类型时，在每个层级添加测试：

1. **DataEngine**（`crates/data/tests/engine.rs`）：添加 `test_execute_subscribe_<type>` 和
   `test_execute_unsubscribe_<type>` 测试。遵循现有订阅测试的模式：注册客户端、构建命令、调用
   `engine.execute`、断言订阅列表。

1. **DataActor Rust**（`crates/common/src/actor/tests.rs`）：
   - 向 `TestDataActor` 添加 `received_<type>: Vec<Type>` 字段。
   - 在 `DataActor` trait impl 中实现 `on_<type>` handler。
   - 添加 `test_subscribe_and_receive_<type>` 和 `test_unsubscribe_<type>` 测试。
   - 对使用 `TypedHandler` 路由的类型，使用类型化 publish 函数（`msgbus::publish_<type>`），
     不要使用 `publish_any`。

1. **PyO3 actor dispatch**（`crates/common/src/python/actor.rs`）：
   - 添加调用 `py_self.call_method1("on_<type>", ...)` 的 `dispatch_on_<type>` 方法。
   - 在 `DataActor` trait impl 中添加调用该 dispatch 方法的 `on_<type>`。
   - 在 `#[pymethods]` 块中添加 `#[pyo3(name = "on_<type>")]` 方法。
   - 向 `RustTestDataActor` 包装器和内联 Python 测试类添加 `on_<type>`。
   - 添加 handler 测试和 dispatch 测试。

1. **Python Actor**（`python/tests/unit/common/test_actor.py`）：
   - 添加 `test_subscribe_<type>` 和 `test_unsubscribe_<type>` 测试。
   - 断言订阅后 `actor.subscribed_<type>()` 返回预期条目，取消订阅后为空。

1. **文档**：向 `actors.md` callback 表格、`strategies.md` handler 签名、`adapters.md` 订阅方法 stub，
   以及 `spec_data_testing.md` 测试 card 添加条目。

:::tip
在全部五个层级搜索 `instrument_close` 或 `funding_rate` 等现有类型，可以找到上述模式的具体示例。
:::
