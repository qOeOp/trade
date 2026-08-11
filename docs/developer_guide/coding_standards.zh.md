# 编码标准

## 代码风格

当前代码库可作为格式约定的参考。以下提供补充指南。

### 通用格式规则

以下规则适用于**所有**源文件（Rust、Python、shell 等）：

- **只使用空格**，绝不使用硬制表符。
- 一般应将行长保持在 **100 个字符**以内；必要时应合理换行。
- 优先使用美式英语拼写（`color`、`serialize`、`behavior`）。

### Shell 脚本可移植性

本仓库中的 shell 脚本使用 **bash**（不是 POSIX sh），并且必须能在 **Linux** 和 **macOS** 上移植。
所有面向用户的脚本还必须能通过 Git Bash 或 WSL 在 **Windows** 上运行。

**Shebang**：为保证可移植性，始终使用 `#!/usr/bin/env bash`。

**常见陷阱**：Linux 和 macOS 的 GNU 与 BSD 工具有所不同：

| 命令               | Linux (GNU)      | macOS (BSD)       | 可移植方案                         |
| ------------------ | ---------------- | ----------------- | ---------------------------------- |
| `sed -i`           | `sed -i 's/…'`   | `sed -i '' 's/…'` | 使用备份扩展名：`sed -i.bak 's/…'` |
| `stat`（文件大小） | `stat -c%s file` | `stat -f%z file`  | 使用 `stat --version` 检测         |
| `sha256sum`        | `sha256sum file` | 不可用            | 使用 `shasum -a 256` 或进行检测    |
| `readlink -f`      | 可用             | 不可用            | 避免使用，或使用 `realpath`        |
| `grep -P`（PCRE）  | 可用             | 不可用            | 改用 `-E`（扩展正则表达式）        |
| `date`（纳秒）     | `date +%N`       | 不可用            | 使用 `$RANDOM` 生成缓存破坏值      |

**Bash 版本**：macOS 自带 bash 3.2；面向用户的脚本应避免 bash 4+ 功能：

| 功能                              | Bash 版本 | 替代方案                          |
| --------------------------------- | --------- | --------------------------------- |
| 关联数组（`declare -A`）          | 4.0+      | 使用文件或简单数组                |
| `readarray` / `mapfile`           | 4.0+      | 使用 `while read` 循环            |
| `${var,,}` / `${var^^}`（大小写） | 4.0+      | 使用 `tr '[:upper:]' '[:lower:]'` |

**CI 脚本**（`scripts/ci/*`）在 Linux runner 上运行，因此可以使用 bash 4+ 和 GNU 工具。

### 注释约定

1. 一般在每个注释块或文档字符串上方保留**一个空行**，使其与代码在视觉上分隔。
2. 使用*句首式大小写*：首字母大写，其余保持小写，专有名词或缩写除外。
3. 句号后不要使用两个空格。
4. **单行注释**结尾*不得*使用句号；但若该行以 URL 或行内 Markdown 链接结尾，则应保留链接所需的
   原有标点。
5. **多行注释**中的句子应使用逗号分隔（不要每行都以句号结尾），最后一行*应当*以句号结尾。
6. 注释应简洁；优先清晰，只解释不明显的内容--*少即是多*。
7. 文本中避免使用 emoji 符号。

### 文档注释语气

**Rust** 文档注释应使用**陈述语气**，例如 *"Returns a cached client."*。

这一约定与 Rust 生态的主流风格一致，也使生成的文档对最终用户而言更自然。

### 术语与措辞

1. **错误消息**：错误消息中避免使用 ", got"。应根据上下文使用更明确的替代词，如 ", was"、
   ", received" 或 ", found"。
   - 不佳：`"Expected string, got {type(value)}"`
   - 良好：`"Expected string, was {type(value)}"`

2. **拼写**：使用 "hardcoded"（单个词），不要使用 "hard-coded" 或 "hard coded"；前者是更现代且
   更普遍接受的拼写。

3. **错误变量命名**：捕获的错误/异常使用单字母 `e`：
   - Rust：使用 `Err(e)`，不要使用 `Err(err)` 或 `Err(error)`；闭包中使用 `|e|`，不要使用 `|err|`
   - Python：使用 `except SomeError as e:`，不要使用 `as err:` 或 `as error:`

### 命名约定

1. **内部字段**：私有/内部字段可以使用缩写（例如 `_price_prec`、`_size_prec`），使热点路径代码
   保持简洁。

2. **面向用户的 API**：公共属性、函数参数、返回类型和指标名称/标签应使用完整、描述性的名称
   （例如 `price_precision`、`size_precision`）。这样可以防止缩写术语泄漏到仪表盘或警报中。

3. **错误消息与日志**：为清晰起见应使用完整单词（例如使用 "price precision"，而非 "price prec"）。
   用户绝不应看到缩写术语。

#### 数据加载 API

无状态数据摄取使用自由函数。只有当实例会跨调用保留可复用配置、缓存、工作线程、迭代状态或开放资源时，
才使用类。不要仅为组织静态方法或类方法而使用零状态类。

遵循 [Polars I/O API](https://docs.pola.rs/api/python/stable/reference/io.html) 的语义区分，并适配既有的
Vibe `load_*` 词汇：

- `load_<source>_<data>` 立即读取、规范化并物化完整结果。
- `scan_<source>_<data>` 创建惰性查询或延迟执行计划。
- `stream_<source>_<data>` 增量产出记录或批次。
- `write_<format>` 立即写入内存中的结果。
- `sink_<format>` 通过惰性或流式执行路径写入。

对于摄取函数，名称应从一般到具体排列：动词、来源、逻辑数据，最后是可选的表示形式。
只有确实存在并列格式时才包含表示形式。例如，`load_binance_order_book_deltas` 优于无状态的
`BinanceOrderBookDeltaDataLoader.load` 类或笼统的 `load_binance_data` 函数。

#### 适配器包门面

`python/vibe_trader/adapters/` 下的每个包都是私有 `_libvibe` 扩展之上的轻量门面。
每个适配器的 `__init__.py` 都声明确定性的 `__all__`，作为其公共 API 的唯一事实来源；
`python/generate_stubs.py` 会把该列表复制到匹配的 `.pyi` 中，使运行时导出与 stub 导出完全一致。

场所适配器会暴露其规范身份常量和受支持的公共表面：

- `<VENUE>`、`<VENUE>_CLIENT_ID`、`<VENUE>_VENUE`，由 Rust 通过适配器 `python/mod.rs` 中的
  `m.add` 注册
- 数据类型、`*Config`、`*Factory`、面向用户的枚举（如 `*Environment` 和 `*ProductType`）
- 无状态加载器（`load_*`、`stream_*`、`convert_*`）和有意公开的工具
  （`decode_*`、`get_*_arrow_schema_map`）

保持门面轻量。绝不要仅为结构对等，就把原始 HTTP 或 WebSocket 客户端、wire 模型、端点辅助函数
（`get_*_url`、`*_HTTP_URL`）、缓存或其他内部实现加入 `__all__`。数据提供方（如 `databento` 和
`tardis`）、`blockchain` 数据客户端、`sandbox` 执行客户端，以及多场所 `interactive_brokers` 经纪商
不提供场所常量，因为这些常量对它们没有意义。

排列 `__all__` 条目时，应让 `RUF022` pre-commit gate 负责排序；不要手工排列列表。

### 格式

1. 对较长代码行，以及传递超过几个参数的情况，应在下一个逻辑缩进处换行对齐，而不是从起始括号处
   进行悬挂式"美观"对齐。这样可以节省右侧空间，让重要代码更居中，并能适应函数/方法名称变更。

2. 右括号应位于新行，并与逻辑缩进对齐。

3. 多个悬挂参数或实参应以尾随逗号结尾：

```python
long_method_with_many_params(
    some_arg1,
    some_arg2,
    some_arg3,  # <-- trailing comma
)
```

## 提交消息

拉取请求标题和提交主题使用带作用域的 Conventional Commits 形式。提交消息可以包含可选正文，
用于解释变更。

### 主题行

- 使用小写的 `type(scope): description`；其中 `type` 以字母开头，可以包含小写字母、数字或连字符。
- `scope` 以小写字母或数字开头，其余部分还可以包含 `.`、`_`、`/` 或 `-`。
- 仅对破坏性变更在作用域后添加 `!`。
- 描述应简洁、具体，不得包含首尾空白或控制字符。验证器只检查语法，不检查写作质量。

```text
feat(model): add Decimal constructors to Instrument
fix(execution): make order event application atomic
refactor(build): simplify cross-platform wheel validation
chore(security): remove stale audit exceptions
```

拉取请求标题语法的唯一可执行权威是 `.github/scripts/validate-pr-title.sh`。创建拉取请求前，贡献者可以
使用拟定的确切标题手动调用该脚本。一旦脚本存在于基础分支，由基础分支控制的 `pr-title` 工作流就是
仓库工作流使用方。最终合并负责人必须独立重新读取当前标题、head 和 base，然后从当前 base 运行验证器，
而不是复制其规则。

避免无作用域、含糊或不符合 Conventional Commits 的形式：

```text
fix: bug                                   # missing scope and unspecific
Update stuff                               # missing type and scope
feat(model): update stuff                  # vague description
```

### 正文

正文是可选的，但任何不止于微不足道的变更都应说明为什么进行变更，而不是复述 diff。

- 主题与正文之间用一个空行分隔。
- 正文行长不超过 79 个字符，以符合 PEP 8 和传统 Git 工具。
- 根据变更选择文字段落或项目符号。项目符号可以保持与主题相同的祈使语气，无需以句号结尾。
- 在有助于未来读者时，加入信息充分的超链接。

### Issue 引用

- 在正文中引用 issue，通常放在最后一行：提交关闭 issue 时使用 `Resolves #4534`，属于部分工作时
  使用 `Related to #4547`。
- GitHub 在 squash 合并时会将拉取请求编号附加到主题后，生成如
  `fix(execution): validate TWAP child orders (#4544)` 的主题。不要手工添加该后缀。
- 附加后缀可能使最终 squash 合并主题超过 60 个字符的限制。
