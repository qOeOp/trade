# Python

VibeTrader 大部分面向用户的代码都使用 [Python](https://www.python.org/) 编程语言。
Python 拥有丰富的库和框架生态，非常适合策略开发、数据分析和系统集成。

## 代码风格

### PEP-8

代码库整体遵循 PEP-8 风格指南。
一个显著的例外是：除集合以外，不会一律利用 Python 的真值性来判断参数是否为 `None`。

按照 [Google Python 风格指南](https://google.github.io/styleguide/pyguide.html)，当函数或方法可能收到
意外对象、从而产生意外的真值判断时，不建议用真值性检查参数是否为 `None`；否则可能引入逻辑错误。

*"检查 None 值时，始终使用 if foo is None:（或 is not None）。例如，判断默认值为 None 的变量或参数
是否被设为其他值时，那个值在布尔上下文中也可能是假值！"*

:::note
检查空集合时应使用真值性（例如 `if not my_list:`），不要显式与 `None` 或空值比较。
:::

如果发现代码库无明显理由偏离 PEP-8，欢迎提供反馈。

### 类型提示

所有函数和方法签名都*必须*包含类型注解：

```python
def __init__(self, config: EMACrossConfig) -> None:
def on_bar(self, bar: Bar) -> None:
def on_save(self) -> dict[str, bytes]:
def on_load(self, state: dict[str, bytes]) -> None:
```

**联合类型语法**：可选类型使用 PEP 604 联合类型语法：

```python
# Preferred
def get_instrument(self, id: InstrumentId) -> Instrument | None:

# Avoid
def get_instrument(self, id: InstrumentId) -> Optional[Instrument]:
```

**泛型类型**：可复用函数和类使用 Python 3.12 类型参数语法：

```python
def first[T](values: list[T]) -> T:
    return values[0]
```

### 文档字符串

整个代码库使用 [NumPy 文档字符串规范](https://numpydoc.readthedocs.io/en/latest/format.html)。
必须始终遵守该规范，文档才能正确构建。

**Python** 文档字符串应使用**祈使语气**，例如 *"Return a cached client."*。

这一约定与 Python 生态的主流风格一致，也使生成的文档对最终用户而言更自然。

#### 私有方法

不要为私有方法（以 `_` 为前缀）添加文档字符串：

- 文档字符串会生成面向公众的 API 文档。
- 私有方法上的文档字符串会错误地暗示它们属于公共 API。
- 私有方法是实现细节，不面向最终用户。

以下例外情况可以使用文档字符串：

- 逻辑非常复杂、包含多个步骤或重要边界情况的方法。
- 因复杂性而需要详细说明参数或返回值的方法。

当私有方法需要补充上下文（例如棘手的前置条件或副作用）时，优先在相关逻辑附近添加简短的
行内注释（`#`），不要使用文档字符串。

### 属性与方法（PyO3 绑定）

通过 PyO3 向 Python 暴露 Rust 类型时，应根据调用点表达的含义选择 `#[getter]`（属性）或普通方法，
而不是依据值能否变化：

- **属性（`#[getter]`）：** 当前状态的低成本、无副作用、类似属性的视图。标量字段、谓词和轻量派生值
  即使会在对象生命周期内变化，也应归入此处。
  示例：`status`、`side`、`quantity`、`price`、`is_open`、`has_inputs`、
  `realized_pnl`、`venue_order_id`。
- **方法（不使用 `#[getter]`）：** 操作、变更、非平凡工作、分配/复制、I/O，或任何需要参数的行为。
  示例：`apply(fill)`、`unrealized_pnl(price)`、`calculate_pnl(...)`。
- **灰色地带（优先使用方法）：** 每次调用都会克隆或分配集合的 getter。
  使用方法可以向调用方表明其成本。
  示例：`events()`、`adjustments()`、`client_order_ids()`、`trade_ids()`。

## Python 实时回调路由

Python 实时节点保持一项运行时不变量：实盘交易期间，Tokio 工作线程不执行 Python 代码。

Rust 异步运行时执行期间，`LiveNode::py_run` 会释放 GIL。工作线程侧如需触发 Python，会使用
现有实时运行器事件通道，而不会在工作线程上调用 `Python::attach`。定时器回调使用时间事件通道。
运行器在启动缓冲阶段和主 select 循环中排空该通道，随后在实时事件循环线程上执行回调。

这条路径是无法避免的用户 Python 回调工作的边界，不应借此把适配器、提供方、数据或执行逻辑
迁移到 Python。Python 适配器模块负责配置 Rust 适配器并注册工厂；适配器操作由 Rust 负责。
如果工作线程侧的 Rust 工作需要 Python 回调，应通过属于实时运行器的特定事件类型进行路由。

添加支持 Python 的实时代码时：

- 优先使用现有运行器事件通道。
- 保持回调主体简短，因为它们会在实时事件循环中同步运行。
- 在 Python 实盘交易的 Tokio 工作任务中，不要调用 `Python::attach`。
- 不要为了适配回调路由而在 Python 中添加适配器业务逻辑。

### 测试命名

使用能够说明场景的描述性名称。测试应保持为带注解的 pytest 自由函数：

```python
def test_write_and_query_option_greeks_round_trip() -> None: ...


def test_catalog_loaded_greeks_reach_on_option_greeks() -> None: ...


def test_backend_session_rejects_zero_chunk_size() -> None: ...
```

### Ruff

代码库使用 [Ruff](https://astral.sh/ruff) 进行 lint。规则配置在 `python/pyproject.toml` 中，
被忽略规则的理由通常会以注释说明。
