# 文档风格

本指南概述编写 VibeTrader 文档时应遵循的风格约定和最佳实践。

[Markdown 风格](markdown_style.md)指南是 Markdown 语法和格式的共享基线，
`.markdownlint.jsonc` 会强制执行其中的机械规则子集。本指南只说明 VibeTrader 文档特有的内容，
不重复该基线。

## 一般原则

- 倾向简单而非复杂，少即是多。
- 倾向简洁但可读的文字与文档。
- 重视约定、风格、模式等方面的标准化。
- 文档应适合不同技术背景的用户阅读。

## 文档类型

大多数页面应归入四种类型之一
（[Divio 文档系统](https://docs.divio.com/documentation-system/)）。
在一个页面中混合多种类型会增加阅读和维护难度。

| 类型         | 目的                   | 章节             |
| ------------ | ---------------------- | ---------------- |
| **教程**     | 通过逐步完成任务来教学 | `tutorials/`     |
| **操作指南** | 解决具体问题           | `how_to/`        |
| **解释**     | 阐明设计和架构         | `concepts/`      |
| **参考**     | 描述系统机制           | `api_reference/` |

有两个章节例外：`getting_started/` 是入门路径，把教程式演练与设置说明结合起来；
`integrations/` 页面同时包含参考内容（能力、符号体系）和操作内容（设置、配置），使每个场所页面
可以独立使用。与特定场所无关的独立操作内容应放在 `how_to/` 中。

### 选择正确的类型

- **页面是否带领新手完成一次学习过程？** 教程。
- **页面是否为已了解系统的人回答"我该如何……？"** 操作指南。
- **页面是否解释某项机制为何这样运作？** 解释。
- **页面是否列出类、配置字段、枚举或能力？** 参考。

教程会说"先做这个，再做这个，然后做这个"，路径由作者选定。
操作指南会说"下面说明如何实现 X"，读者已经知道自己想要 X。两者应保持区别：

- 教程不应假设读者具备先验知识。
- 操作指南不应教授背景概念。

一种类型需要引用另一种类型时，应链接过去，不要内嵌重复内容。例如，配置 `LiveNodeConfig` 的
操作指南应链接到 API 参考中的字段定义，而不是再次列出它们。

## 语言与语气

- 尽可能使用主动语态（"配置适配器"，而非"适配器应被配置"）。
- 描述当前功能时使用现在时。
- 仅对计划中的功能使用将来时。
- 避免不必要的术语；技术术语首次出现时应给出定义。
- 表述直接、简洁；避免"基本上""简单地""只需"等填充词。
- 列表使用平行结构；各条目的语法形式应保持一致。

## Markdown 表格

表格语法、管道符对齐和分隔符补齐遵循
[Markdown 风格](markdown_style.md#tables)指南。

### 备注与描述

- 所有备注和描述都应以句号结尾。
- 备注应简洁但信息充分。
- 使用句首式大小写（仅首字母和专有名词大写）。

### 示例

```markdown
| Order Type             | Spot | Margin | USDT Futures | Coin Futures | Notes                   |
| ---------------------- | ---- | ------ | ------------ | ------------ | ----------------------- |
| `MARKET`               | ✓    | ✓      | ✓            | ✓            |                         |
| `STOP_MARKET`          | -    | ✓      | ✓            | ✓            | Not supported for Spot. |
| `MARKET_IF_TOUCHED`    | -    | -      | ✓            | ✓            | Futures only.           |
```

### 支持状态标记

- 使用 `✓` 表示支持的功能。
- 使用 `-` 表示不支持的功能（不要使用 `✗` 或其他符号）。
- 为不支持的功能添加备注时，使用斜体强调：`*Not supported*`。
- 当原因很重要时，应明确说明不支持的原因：场所能力缺口使用 `*Not supported by <venue>*`，
  适配器能力缺口使用 `*Not currently implemented*`。
- 不需要内容时将单元格留空。

## 代码引用

行内代码和围栏代码块遵循 [Markdown 风格](markdown_style.md#code)指南。

引用代码位置时，使用 `file_path::function_name` 或 `file_path::ClassName`，不要使用会随代码变更而
失效的行号。

## 标题

标题风格、大小写和层级遵循 [Markdown 风格](markdown_style.md#headings)指南：页面标题使用标题式大小写，
其下标题使用句首式大小写。

无论标题级别如何，专有名词（产品名、技术、公司、缩写）始终按规范使用大写。

## 列表

列表标记、顺序和缩进遵循 [Markdown 风格](markdown_style.md#lists)指南。

当列表项是完整句子时，以句号结尾。

## 链接与引用

链接文本、链接风格和图像遵循
[Markdown 风格](markdown_style.md#links-and-images)指南。

适当时引用外部文档。

## 技术术语

- 能力矩阵应以 Vibe 领域模型为基础，而不是交易所特有的术语。
- 为清晰起见，必要时在括号或备注中提及交易所特有术语。
- 整套文档应使用一致的术语。

## 示例与代码样例

- 提供实用、可运行的示例。
- 包含必要的导入和上下文。
- 使用现实的变量名和值。
- 添加注释解释不明显的部分。

## 提示块

使用提示块突出重要信息：

| 提示块       | 目的                                   |
| ------------ | -------------------------------------- |
| `:::note`    | 补充用于澄清但并非必不可少的上下文。   |
| `:::info`    | 读者应当知晓的重要信息。               |
| `:::tip`     | 有用的建议或最佳实践。                 |
| `:::warning` | 潜在陷阱或重要注意事项。               |
| `:::danger`  | 可能导致数据丢失或系统故障的关键问题。 |

避免过度使用提示块；过多会削弱其效果。

## MDX 组件

文档站点（fumadocs）提供可在所有 `.md` 文件中使用的内置 MDX 组件，无需导入。

### Tabs

不同语言或变体内容使用标签页。Rust 应放在 Python 前，使 Rust 成为默认（最左侧）标签页。

对于代码示例，在连续的围栏代码块上添加 `tab="..."`：

```markdown
\`\`\`rust tab="Rust"
let params = Params::from([("close_position", true.into())]);
\`\`\`

\`\`\`python tab="Python"
strategy.submit_order(order, params={"close_position": True})
\`\`\`
```

对于表格或其他内容，将每个变体包装在 `<Tabs>` 和 `<Tab>` 中。交易工具的 Fields 表格采用这种方式，
使每种语言只显示一个类型列，而不是并排显示 Rust 和 Python 列。内层内容上下各留一个空行，
让 Markdown 正确渲染。

```markdown
<Tabs items={["Rust", "Python"]}>
<Tab value="Rust">

| Field           | Type           | Required/default | Notes                   |
| --------------- | -------------- | ---------------- | ----------------------- |
| `instrument_id` | `InstrumentId` | Required         | Stored as `id` in Rust. |

</Tab>
<Tab value="Python">

| Field           | Type           | Required/default | Notes |
| --------------- | -------------- | ---------------- | ----- |
| `instrument_id` | `InstrumentId` | Required         |       |

</Tab>
</Tabs>
```

### Steps

顺序过程使用 `Steps` 和 `Step`。

```markdown
<Steps>
<Step>
Configure the adapter.
</Step>
<Step>
Start the trading node.
</Step>
</Steps>
```

### Accordions

可折叠内容使用 `Accordions` 和 `Accordion`。

```markdown
<Accordions>
<Accordion title="Advanced configuration">
Content here.
</Accordion>
</Accordions>
```

### Files

目录树可视化使用 `Files`、`Folder` 和 `File`。

```markdown
<Files>
<Folder name="src" defaultOpen>
<File name="main.rs" />
<File name="lib.rs" />
</Folder>
</Files>
```

### Cards

链接内容网格使用 `Cards` 和 `Card`。

```markdown
<Cards>
<Card title="Getting started" href="/latest/getting_started" />
<Card title="Concepts" href="/latest/concepts" />
</Cards>
```

### TypeTable

参数或类型文档表格使用 `TypeTable`。

## API 文档

- 清晰记录参数和返回类型。
- 为复杂 API 提供使用示例。
- 解释所有副作用或重要行为。
- 参数描述应简洁但完整。
