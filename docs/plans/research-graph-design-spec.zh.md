# 研究图谱页设计规格（草案，待确认）

对象：`services/research-graph/web` 渲染的研究图谱页（IntelliJ Islands 风格工作台），以及页内三张图：研究进展柱状图、年化 vs 回撤散点、谱系画布。

起因：用户反馈整页「AI 味重、细节不足，像一堆没有高级特性的 frame 和样式拼起来」，图表「没有质感」。

本文先诊断原因，再给出一套成体系的规格。第 7 节列出需要用户拍板的决定；确认之前不改代码。

## 1. 诊断：为什么显得粗糙

以下每条都对应代码或截图里的证据，行号以 main `8fbadf854` 为准。

### 1.1 层次手段太少

- 字号有四档，都挤在 10.5–13px 之间，相邻档只差 0.5–1px（`src/theme/tokens.css` 的 `--text-ui/dense/small/badge`）。
- 强调只用颜色，字重几乎不变（全仓 `font-semibold` 只出现 8 处），这是早先定下的「统一字体字号字重、只用颜色强调」。
- 结果是每张卡片、每个标题都一样重，页面没有视觉焦点。
- 参照：IntelliJ 自己用 4 档字号（12/13/16/18），并用粗体做唯一的强调手段（[JetBrains Typography](https://plugins.jetbrains.com/docs/intellij/typography.html)）；Linear 标题用 Inter Display，正文用 Inter（[Linear 改版 Part II](https://linear.app/now/how-we-redesigned-the-linear-ui)）。

### 1.2 面、边缘和层级是默认值，不成系统

- **圆角不同心**：卡片圆角 8px，放在圆角 10px 的岛里、离岛边 8px。Vercel 指南要求嵌套圆角同心，且子级不大于父级（[web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines)）。
- **弹层阴影是套件默认值**：直接用 Tailwind 的 `shadow-xl` / `shadow-lg`（`Dropdown.tsx:27`、`VersionMenu.tsx:28`、`Tip.tsx:14`），没有自己的层级体系。指南要求至少两层阴影（环境光加直射光），并配半透明描边。
- **卡片没有层级**：卡片只是一块 `bg-island-alt` 纯色圆角矩形，没有描边，也没有层级差。
- **颜色是手抄的**：
  - 十六进制值是手工抄来的。悬停、按下统一叠一层黑或白的透明度，不随所在表面变化。
  - Linear 的做法是在 LCH 色彩空间里只用 3 个输入（底色、强调色、对比度）生成整套主题，表面层级也由同一公式拉开（同上 Part II）。

### 1.3 动效有令牌，几乎没用

- `base.css` 里定义了 `--t-fast 110ms`、`--t-mid 180ms` 和缓动曲线，但组件基本只用 Tailwind 默认的 `transition-colors`。
- 面板开合、选中切换、标签切换都是瞬间跳变。
- 菜单和提示用 `.enter` 关键帧动画。这违反了两条通行规则：
  - 高频操作（右键菜单、命令菜单）不做动画（[Rauno Freiberg](https://rauno.me/craft/interaction-design)、[Emil Kowalski](https://emilkowal.ski/ui/you-dont-need-animations)）。
  - 动画要能被打断，关键帧做不到（[Emil Kowalski](https://emilkowal.ski/ui/great-animations)）。
- 更正：我上一轮说「没有自己的动效规则」不准确，规则存在，只是没有落到组件上。

### 1.4 内容没有经过设计

- 详情里「改了什么」「结论」是账本原文直接贴出：中英混排，夹着哈希和路径，不分段、不提炼。
- 一大段文字墙对「AI 味」的贡献可能最大，边框做得再细也盖不住。

### 1.5 图表停在库默认值或临时决定上

- **研究进展**：
  - 网格线是虚线（`Progress.tsx:50`）。
  - 选中的柱子靠描边标出（`Progress.tsx:69`）。
  - 「目标 20%」标签直接用数据色绿色（`Progress.tsx:53`）。
  - 柱子四角都是 1.5px 圆角。
  - 视野里常常只有两三根柱子，整张图大半是空的。
- **散点**：
  - 两个方向都有网格线（`Scatter.tsx:43-44`），还有 visx 默认的刻度线。
  - 所有点同一种灰，半径 3.5px，没有防重叠的底色描边（`Scatter.tsx:68`）。
  - 「两项都达标」区只有 6% 不透明度，暗色主题下几乎看不见（`Scatter.tsx:46`）。
  - 图注挤在右上角压着绘图区（`Scatter.tsx:89`）。
- **谱系画布**：
  - 全宽的行条纹让大片空白也有了「内容感」。
  - 版本树和画布上重复了几十个「失去资格」灰色徽章。
  - 主视图常常大半是空的。

### 1.6 做法本身容易出这种结果

- 这一轮是「看截图 → 改一处 → 加一条几何检查」，从没先定规格再统一套用。
- `verify.mjs` 能保证对齐、不越界，但保证不了好看。
- 没有具体参照时，结果会滑向所有界面的平均值（[superdesign](https://www.superdesign.dev/blog/why-ai-design-looks-generic)、[saasui](https://www.saasui.design/blog/saas-ui-looks-ai-generated)）。

## 2. 原则

1. **以 IntelliJ Islands 为骨架**：度量、颜色语义、交互节奏尽量取 JetBrains 自己的数值（见 3.x 的出处）。不发明另一套「看起来像 IDE」的东西。
2. **数据最响，其余退后**：轴、网格、边框、条纹都只要「刚好看得见」（[Few 的配色规则 7](https://www.perceptualedge.com/articles/visual_business_intelligence/rules_for_using_color.pdf)）。
3. **一处定义，处处生效**：颜色、字号、间距、圆角、阴影、时长都是令牌。组件里不出现临时数值，状态色从表面色推导。
4. **每个组件都有完整的状态**：静止、悬停、按下、选中、聚焦、禁用、空、加载。缺一个状态，就会露出「没做完」的感觉。
5. **用参照验收**：每改一块，和真实 IntelliJ / Linear 截图并排比较，而不是只看自己的截图。

## 3. 界面规格

### 3.1 颜色

- **生成方式**：中性色阶在 OKLCH 中生成：一个底色加对比度参数生成 12 级，语义沿用 Radix 的 12 级分工（[Radix scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)）：

  | 级 | 用途 |
  |---|---|
  | 1 | 窗口框架 |
  | 2 | 岛 |
  | 3 | 卡片 / 组件底 |
  | 4 | 悬停 |
  | 5 | 按下、未聚焦时的选中 |
  | 6 | 分隔线 |
  | 7 | 可交互边框 |
  | 8 | 强边框、聚焦 |
  | 11 | 次要文字 |
  | 12 | 主文字 |

- **状态推导**：悬停、按下由所在表面推导，例如 `oklch(from var(--surface) calc(l ± 0.03) c h)`，不再叠固定的黑白透明度（[OKLCH in CSS](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)）。
- **色温**：中性灰略带暖意、低饱和。Linear 2025 年改版正是把冷灰调暖（[Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh)）。
- **选中与聚焦**：取 IntelliJ 新 UI 的值，见下表（[expUI 主题 JSON](https://github.com/JetBrains/intellij-community/blob/master/platform/platform-resources/src/themes/expUI/expUI_dark.theme.json)）。

  | 角色 | 亮色 | 暗色 |
  |---|---|---|
  | 选中 | #D4E2FF | #2E436E |
  | 未聚焦时的选中 | #DFE1E5 | #43454A |
  | 聚焦 | #3574F0 | #3574F0 |

- **框架与岛**：两者对比度至少 1.20:1。暗色下框架比岛亮，亮色下框架比岛暗（[Supporting Islands theme](https://plugins.jetbrains.com/docs/intellij/supporting-islands-theme.html)）。
- **对比度目标（APCA）**：正文 Lc ≥ 75（13px 次要文字同样按此），标题和细图标 Lc ≥ 45，分隔线 Lc ≈ 15（[APCA in a Nutshell](https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell.html)）。
- **数据四色**（推荐蓝、达标绿、亏损琥珀、失格红）保持不变，已通过色觉校验。

### 3.2 字体与排版

- **字号**：沿用 IntelliJ 的相对制，以默认 13px 为基准：

  | 档 | 字号 | 用途 |
  |---|---|---|
  | H1 | 18px | 版本详情标题 |
  | H2 | 16px | 岛内分组标题 |
  | 正文 | 13px | 默认 |
  | 次要 | 12px | 读数、表格 |
  | 注释 | 11px | 轴、图例；最小字号，取消 10.5px |

- **字重**：只用 400 和 600 两种，600 只给标题和当前项（**需确认**，见第 7 节）。
- **数字**：一律等宽数字（`tnum`），Inter 的 `tnum` 在各字重下等宽（[Inter](https://rsms.me/inter/)）。单独展示的大数字用比例数字。
- **中英混排**：
  - 用 CSS `text-autospace`，由浏览器在汉字和拉丁字母之间加 ⅛ 字宽的空隙，不手打空格（[css-text-4](https://drafts.csswg.org/css-text-4/)、[MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/text-autospace)）。
  - 中文段落行高 1.6–1.7（[W3C clreq §7.1.1](https://www.w3.org/TR/clreq/)）；界面单行文字保持 1.45。
- **等宽字体的范围**：JetBrains Mono 只用于版本名、哈希、代码。中文旁的数字用 Inter，避免中文和等宽数字混排时节奏不齐。

### 3.3 间距与尺寸

- **网格**：全部取 4px 的倍数，取消 3px、6px 这类零碎值。
- **岛**：圆角 10px，岛间距从现在的 6px 改为 4px，与 IntelliJ 一致（[Islands](https://plugins.jetbrains.com/docs/intellij/supporting-islands-theme.html)，**需确认**）。
- **组件度量**（取自 JetBrains 自己的 Jewel 组件库源码，[Jewel styling](https://github.com/JetBrains/intellij-community/tree/master/platform/jewel/int-ui/int-ui-standalone/src/main/kotlin/org/jetbrains/jewel/intui/standalone/styling)）：
  - 树和列表：行高 24px，水平内边距 12px，图标与文字间距 4px。
  - 标签：高 40px，水平内边距 8px，下划线 3px。
  - 按钮：最小高 28px（小号 24px），内边距 12×6。
  - 图标按钮：24×24。
  - 菜单项：最小高 20px，内边距 12×4，选中底色内缩 6px。
- **点击区**：不小于 24px（Vercel 指南）。

### 3.4 圆角

- **层级**：岛 10px → 弹层 8px → 卡片 6px → 控件 4px → 徽章 3px。
- **同心**：元素贴着父级、内缩 d < 父级圆角时，子级圆角 = 父级圆角 − d。例如岛内贴边 4px 的选中行用 6px。
- **IntelliJ 的数值**：控件 4px，选中行 2–4px（Jewel）。

### 3.5 层级、阴影与边框

| 层 | 表面 | 边缘 |
|---|---|---|
| L0 | 窗口框架 | 无 |
| L1 | 岛 | 无阴影，靠与框架的对比 |
| L2 | 卡片 | 色阶 3 加半透明描边，无阴影 |
| L3 | 弹层（菜单、提示、下拉） | 1px 半透明描边加两到三层阴影 |

- **阴影配方**：
  - 浅色：`0 1px 2px` 和 `0 4px 12px`，带背景色调，不用纯黑（[Josh Comeau](https://www.joshwcomeau.com/css/designing-shadows/)、[Tobias Ahlin](https://tobiasahlin.com/blog/layered-smooth-box-shadows/)）。
  - 暗色：靠更亮的表面加更亮的描边表达层级，阴影只作辅助（[Apple HIG Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)）。
  - 不对分层阴影做动画。
- **分隔线**：少用。能用间距分组就不画线。保留下来的线用色阶 6，端点圆头。

### 3.6 动效

- **令牌**：
  - 时长分 100 / 150 / 200 / 250ms 四档；界面动画不超过 250ms（[Material 3 Durations](https://api.flutter.dev/flutter/material/Durations-class.html)、Emil Kowalski）。
  - 缓动默认 ease-out `cubic-bezier(0.2, 0, 0, 1)`。
- **要动的**：
  - 侧栏开合（200ms，宽度用 transform 实现）。
  - 选中底色（100ms）。
  - 画布定位平移（250ms）。
  - 悬停联动的变暗（100ms）。
  - 新内容出现时淡入（150ms）。
- **不动的**：右键菜单、命令面板、下拉菜单、准星，以及键盘触发的操作。
- **提示框**：首个延迟 500ms，相邻的立即出现（IntelliJ 与 Vercel 指南一致）。
- **实现约束**：只动 `transform` 和 `opacity`，用 CSS transition 而不是关键帧，以便被打断；遵守 `prefers-reduced-motion`。

### 3.7 状态矩阵

每个可交互组件按下表补全，验收时逐格截图。

| 状态 | 规则 |
|---|---|
| 静止 | 表面色 |
| 悬停 | 色阶 +1，对比必须高于静止 |
| 按下 | 色阶 +2 |
| 选中 | 选中色；所在岛未聚焦时用未聚焦选中色 |
| 聚焦 | 2px 聚焦色描边，外扩 1px，只用 `:focus-visible` |
| 禁用 | 文字降到色阶 11 的 50% |
| 空 | 一句说明加下一步操作，不留白板 |
| 加载 | 延迟 150–300ms 才出现，出现后至少显示 300–500ms，避免闪烁 |

### 3.8 图标

- **线宽**：IntelliJ 图标是 16px、2px 线宽、像素对齐（[Icons style](https://plugins.jetbrains.com/docs/intellij/icons-style.html)）。我们现在用 Lucide 1.25 线宽，比 IDE 图标细，导致图标显得发虚。
- **建议**：16px 图标用 1.5 线宽，并检查像素对齐。
- **文字配合**：图标加文字的组合里，图标线宽和文字字重相配（Vercel 指南）。

### 3.9 内容

- **详情长文**：开头一行摘要（取首句或由账本的结构化字段生成），其余默认折叠。
- **长串**：哈希、路径、登记号显示成可复制的胶囊，中间截断（`ema-…@9m65aq`），悬停显示全文。
- **重复的状态**：「失去资格」这类反复出现的状态，用一个图标加整行变淡表达，不重复文字徽章。
- **数字**：百分比统一两位小数，去掉无意义的尾零；指标标签和数字之间的距离固定。

## 4. 图表规格

### 4.1 所有图共用

- **网格**：实线、1px，文字色 10% 不透明度，只画数值轴方向（[Observable Plot](https://raw.githubusercontent.com/observablehq/plot/main/src/marks/axis.js)、[TradingView](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/GridLineOptions)）。
- **轴**：
  - 不画刻度线。
  - 轴文字 11px、次要文字色、等宽数字。
  - 轴标题放在轴端，带方向箭头（「年化 ↑」「最大回撤 →」，Plot 的默认做法）。
- **虚线**：只留给准星和参考线（目标线），网格永远是实线（TradingView 正是这样分工：网格实线，准星和最新价线虚线，见上方 Grid 与 Crosshair 链接）。
- **配色**：
  - 灰色是主色，大部分数据用灰，强调色只给要讲的那一点（[Datawrapper 配色](https://www.datawrapper.de/blog/colors-for-data-vis-style-guides)）。
  - 小标记可以饱和，大面积必须淡。
- **文字**：
  - 文字不用数据色。标签用文字色，旁边放一个色块说明身份（「目标 20%」改成文字色，配一小段绿色线）。
  - 只用两种字号，不旋转标签（[Datawrapper 文字](https://www.datawrapper.de/blog/text-in-data-visualizations)）。
  - 能直接标注的就不放远处的图例。
- **悬停**：
  - 当前项保持原样，其余降到 30% 不透明度（[Vega-Lite 示例](https://vega.github.io/vega-lite/examples/interactive_bar_select_highlight.html)）。
  - 三张图和版本树联动（已有机制，补齐变暗）。
- **读数胶囊**：沿用现在的深色胶囊，统一圆角 4px、字号 11px、内边距 6×2；TradingView 准星的轴标签就是这种做法（[CrosshairLineOptions](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/CrosshairLineOptions)）。
- **留白**：数据不顶到边框，数值轴上方留 10–20% 余量（TradingView price scale 的 scaleMargins）。
- **键盘**：Tab 进入图表，方向键逐点移动，焦点样式等同悬停（[Chartability](https://chartability.fizz.studio/)）。

### 4.2 研究进展柱状图

- **柱子**：
  - 宽度不超过 24px，占槽位 60–80%（库默认 60%–90%，没有权威比例，**未查到一手依据**）。
  - 柱顶 2px 圆角，底部贴基线处为直角（全圆角会模糊柱端，[The Data School](https://thedataschool.co.uk/jonathan-allenby/the-dangers-of-rounded-bar-charts)）。
- **选中**：取消描边（描边是非数据墨水），改为选中色的外框条，与悬停高亮同一机制、颜色更深。
- **目标**：保留目标线（虚线，参考线），并在 0 到目标之间铺极淡的「未达标区」底带（Tufte 迷你图的「正常范围灰带」，[sparkline theory](https://www.edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/)）。
- **全历史概览条**（新增，**需确认**）：
  - 主图跟着画布平移，视野里常常只有几根柱子。
  - 在主图上方加一条约 24px 高的迷你图，画出全部研究运行，并用一个可拖动的视野框表示画布当前范围，拖动它就平移画布。
  - 这是 TradingView、IDE 小地图式的能力，也是现在「没有高级特性」的主要缺口。
- **图例**：改为直接标注，三种状态的说明移到图标题行右侧。

### 4.3 年化 vs 回撤散点

- **点**：
  - 被支配的点用灰色、60% 不透明度，外圈 2px 岛色描边且保持 100% 不透明度，解决重叠（[Datawrapper](https://www.datawrapper.de/blog/colors-for-data-vis-style-guides)、[Optuna 帕累托图](https://raw.githubusercontent.com/optuna/optuna/master/optuna/visualization/_pareto_front.py)）。
  - 半径至少 4px。
- **前沿**：
  - 前沿上的点用强调色，前沿线 1.5px 实线（现在是 1px 虚线）。
  - 前沿两端和当前推荐直接标版本名。
- **达标区**：两项都达标的角落铺 8–10% 的达标绿，区内写「两项都达标」（Artificial Analysis 的「Most attractive quadrant」做法，[示例](https://artificialanalysis.ai/models)；具体不透明度**未查到一手依据**）。
- **其它**：
  - 只保留 y 方向网格，去掉刻度线。
  - 右上角那句图注拆成直接标注，删掉。
  - 新旧程度可以用不透明度表示：越早的运行越淡（可选）。

### 4.4 谱系画布

- **行条纹**：降到几乎看不见，或只在悬停行显示（[Few 规则 1](https://www.perceptualedge.com/articles/visual_business_intelligence/rules_for_using_color.pdf)：数据背后的背景保持一致）。
- **标尺**：
  - 只标每 5 或 10 个 trial 的数字，其余为小刻度。
  - 当前 trial 用深色胶囊显示在标尺上（TradingView 的时间轴标签做法）。
  - 版本占用的 trial 段保持浅色块。
- **准星吸附**：横线吸附到最近的版本行，竖线吸附到 trial（TradingView 的 Magnet 模式，[CrosshairMode](https://tradingview.github.io/lightweight-charts/docs/api/enumerations/CrosshairMode)）。
- **失格版本**：去掉文字徽章，整行降到 40% 不透明度，红色只留在图标上。
- **空白**：配合 4.2 的全历史概览条。打开页面时把有内容的区段放进视野，而不是停在一片空行上。

### 4.5 表格（版本表、回放表、数据缺口）

- 数字右对齐、等宽数字，表头与数字同样右对齐。
- 行高 24px，悬停用色阶 4，选中用选中色。
- 列分隔只用间距，不画竖线；表头下方一条色阶 6 的分隔线。

## 5. 实施顺序

1. **令牌**：OKLCH 中性色阶、字号字重、间距、圆角、阴影、时长。只改 `theme/`，整页随之变化，截图对比。
2. **组件状态**：按 3.7 补全每个组件；菜单去掉动画。侧栏开合过渡挪到第 4 步：现在开合一侧会重建面板组，要先让布局不重建才能过渡。
3. **图表**：先做 4.1 的共用部分，再逐张做 4.2–4.4；概览条单独一步。
4. **内容**：详情摘要与折叠、胶囊化的长串、失格版本的表达。
5. **验收**：每一步与 IntelliJ / Linear 截图并排评审。`verify.mjs` 只为能证明产品真坏的回归加检查（越界、对齐、交互），不为样式数值加检查。

## 6. 不做的事

- 不加渐变、玻璃模糊、噪点纹理、发光等装饰效果（Few 规则 9：不用光影效果）。
- 不换掉 IntelliJ Islands 的骨架，不另起一套视觉语言。
- 不改数据四色及其含义。

## 7. 需要用户确认的决定

1. **字重**：放开「统一字重、只用颜色强调」，引入 600 字重和 16/18px 标题（3.2）。
2. **岛间距**：从 6px 改为 IntelliJ 的 4px（3.3）。
3. **中性色**：整套改为 OKLCH 生成、偏暖低饱和（3.1）。所有灰色都会变。
4. **全历史概览条**：给研究进展图加概览条，可拖动视野框联动画布（4.2）。
5. **散点着色**：只给前沿上色，其余全灰（4.3）。
6. **详情长文**：默认折叠，只显示一行摘要（3.9）。

## 参考

- JetBrains：[Typography](https://plugins.jetbrains.com/docs/intellij/typography.html) · [Supporting Islands theme](https://plugins.jetbrains.com/docs/intellij/supporting-islands-theme.html) · [Icons style](https://plugins.jetbrains.com/docs/intellij/icons-style.html) · [Tooltip](https://plugins.jetbrains.com/docs/intellij/tooltip.html) · [Jewel styling 源码](https://github.com/JetBrains/intellij-community/tree/master/platform/jewel/int-ui/int-ui-standalone/src/main/kotlin/org/jetbrains/jewel/intui/standalone/styling) · [expUI 主题 JSON](https://github.com/JetBrains/intellij-community/blob/master/platform/platform-resources/src/themes/expUI/expUI_dark.theme.json)
- Linear：[How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui) · [Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh)
- 界面细节：[Vercel web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) · [Rauno Freiberg：Invisible Details of Interaction Design](https://rauno.me/craft/interaction-design) · [Emil Kowalski：You don't need animations](https://emilkowal.ski/ui/you-dont-need-animations) · [Emil Kowalski：Great animations](https://emilkowal.ski/ui/great-animations)
- 颜色与对比：[Radix 色阶](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) · [OKLCH in CSS](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl) · [APCA in a Nutshell](https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell.html) · [Stripe：Accessible color systems](https://stripe.com/blog/accessible-color-systems)
- 阴影与层级：[Josh Comeau：Designing beautiful shadows](https://www.joshwcomeau.com/css/designing-shadows/) · [Tobias Ahlin：Layered smooth box shadows](https://tobiasahlin.com/blog/layered-smooth-box-shadows/) · [Apple HIG：Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode) · [Apple HIG：Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
- 动效：[Material 3 Durations](https://api.flutter.dev/flutter/material/Durations-class.html)
- 排版：[Inter](https://rsms.me/inter/) · [W3C clreq](https://www.w3.org/TR/clreq/) · [CSS text-autospace](https://developer.mozilla.org/en-US/docs/Web/CSS/text-autospace)
- 图表：
  - TradingView lightweight-charts：[Crosshair](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/CrosshairLineOptions) · [CrosshairMode](https://tradingview.github.io/lightweight-charts/docs/api/enumerations/CrosshairMode) · [Grid](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/GridLineOptions)
  - [Observable Plot 轴的默认值](https://raw.githubusercontent.com/observablehq/plot/main/src/marks/axis.js)
  - Datawrapper：[Better charts](https://www.datawrapper.de/blog/better-charts) · [配色](https://www.datawrapper.de/blog/colors-for-data-vis-style-guides) · [图中文字](https://www.datawrapper.de/blog/text-in-data-visualizations) · [字体](https://www.datawrapper.de/blog/fonts-for-data-visualization)
  - [Stephen Few：Rules for using color](https://www.perceptualedge.com/articles/visual_business_intelligence/rules_for_using_color.pdf) · [Tufte：Sparkline theory](https://www.edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/) · [Apple HIG：Charts](https://developer.apple.com/design/human-interface-guidelines/charts)
  - [Vega-Lite 悬停高亮示例](https://vega.github.io/vega-lite/examples/interactive_bar_select_highlight.html) · [Chartability](https://chartability.fizz.studio/) · [Optuna 帕累托图源码](https://raw.githubusercontent.com/optuna/optuna/master/optuna/visualization/_pareto_front.py) · [The Data School：圆角柱的问题](https://thedataschool.co.uk/jonathan-allenby/the-dangers-of-rounded-bar-charts)
