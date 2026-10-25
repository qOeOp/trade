# 产品 Agent 聊天面板

2026-10-25 用户提出：IDE 的右侧边栏加一个机器人图标，打开聊天面板。它是整个产品的 Agent，用聊天处理产品
相关的事：查策略、查策略的运行情况、分析研究路线与账本等。只接 DeepSeek、ChatGPT（OpenAI）、Claude（Anthropic）
三家。面板里能配置 Agent，配置好并通过测试的 Agent 显示为活跃；聊天时可以切换模型。

同日用户定了四件事：**只读**；API key **放在服务里**；回答要有**打字机效果**；网页服务和聊天一起做，服务端语言
由我选（§3.1）。网页服务已由 #1709 做成 Docker 服务（`services/ide`，`ide.py serve`），本功能加在它上面。

## 结论

- **聊天界面和多家模型都用现成开源库。** 前端用 `assistant-ui`（React 聊天基础组件，不带样式），后端用 Vercel
  AI SDK（`ai` 加 `@ai-sdk/deepseek`、`@ai-sdk/openai`、`@ai-sdk/anthropic`，统一流式输出和多步工具调用），
  两者经 `@assistant-ui/ai-sdk` 直接拼上。
- **Agent 不连数据库，只调产品命令行的只读命令。** 每个回答里的数字都来自一次可展开查看的工具调用（命令、
  参数、原始 JSON），这是对模型编数的唯一可靠检查。
- **只读。** 理由在 §5：AGENTS.md 规定研究由外部 Agent 带 skill 做、写账本只走 CLI 且要守用户授权；10-03 用户定过
  「代理在外、规矩在内」。只读的问答助手不选研究问题、不写账本，和这两条不冲突。
- **API key 只放在聊天服务的数据目录里**（权限 0600）。账本和市场库都公开在 DoltHub，所以 key 不进 Dolt，
  也不进仓库和浏览器存储；页面只能写入，读不回来。
- **服务端语言：页面服务保持 Python，聊天服务用 TypeScript（Node 24）**，理由见 §3.1。

## 1. 开源方案对比

| 方案 | 是什么 | 取舍 |
|---|---|---|
| **assistant-ui** + **Vercel AI SDK**（采用） | 前者是 React 聊天组件库（`@assistant-ui/react` 0.15），后者是 TypeScript 的多模型统一调用层（`ai` 7.0），三家都有官方 provider | 组件可拆、能放进现有 Island 布局，样式走我们自己的 token；工具调用、流式、停止、重试、换模型都现成 |
| LibreChat、LobeChat、Open WebUI | 完整的独立聊天应用，自带账号、数据库、插件和 Agent 市场 | 嵌不进侧边栏（只能 iframe），拿不到图谱当前选中的版本，也不能反过来让图谱跳转；自带一套 Agent 和数据存储，等于平行系统 |
| CopilotKit | React 内嵌 copilot 框架 | 偏「AI 操作页面状态」，自带后端运行时；我们的重点是查产品数据，assistant-ui 更轻 |
| LiteLLM（Python） | 多模型代理与 SDK | 能统一三家，但依赖树大；前端协议还得自己对接 assistant-ui，AI SDK 两头都现成 |

2026-10-25 npm 上的版本：`ai` 7.0.153、`@ai-sdk/deepseek` 3.0.73、`@ai-sdk/openai` 4.0.102、
`@ai-sdk/anthropic` 4.0.88、`@assistant-ui/react` 0.15.31、`@assistant-ui/ai-sdk` 0.0.15（AI SDK 7 的运行时；
旧名 `@assistant-ui/react-ai-sdk` 只配到 AI SDK 6）、`@assistant-ui/react-markdown` 0.14.24、`remark-gfm` 4.0.1。
都锁具体版本。

## 2. 交互

界面文字照 10-25 的决定全英文；聊天内容随用户用什么语言。

### 2.1 右侧边栏的 Agent 按钮

- 右侧边栏在 Details（⌥2）下面加 **Agent**（⌥0），图标用 Lucide 的 `bot`。只在页面的服务带着聊天服务时出现
  （`ide.py serve --agent=…`，Docker 镜像默认带）；渲染成文件的页面没有它。
- 和 Details 共用右侧：同一时刻右侧只显示一个工具窗，沿用现有 stripe 的切换规矩。聊天运行时挂在整个窗口上，
  切到别的工具窗或收起右侧，回答照样在后台写完。
- 第一版没做：图标随状态变（无活跃 Agent 空心、回答中带蓝点）。

### 2.2 面板布局

```
┌ Agent ───────────────────────────────── [+] [⏱] [⚙] [⇥] ┐
│ Thread: ema-12 drawdown since trial 40                   │
├──────────────────────────────────────────────────────────┤
│  you  ema-12@5 为什么回撤超了？                            │
│                                                          │
│  ◆ Claude Sonnet 5.5                                     │
│   ▸ research state --line current          ✓ 0.8 s       │
│   ▸ ledger sql  SELECT … FROM trial …      ✓ 0.3 s       │
│   ema-12@5 在 trial 52 的最大回撤 18.4%，超过目标 15%……    │
│   [ema-12@5] ← 可点，图谱定位到该版本                       │
├──────────────────────────────────────────────────────────┤
│ Context: ema-12@5 · ledger 3f2a91c          [×]          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Ask about strategies, runs, the ledger…              │ │
│ └──────────────────────────────────────────────────────┘ │
│ [◆ Claude Sonnet 5.5 ▾]                      [↑ Send]    │
└──────────────────────────────────────────────────────────┘
```

- **头部**：`+` 新线程、`⏱` 历史线程列表（Chats）、`⚙` Agent 配置（Agents）、隐藏。线程标题取第一个问题的
  第一行（不为起标题多花一次模型调用），在历史列表里显示。
- **消息**：
  - 每条回答标出是哪个模型、哪个 Agent 答的（换模型后一眼看出哪段出自谁）。
  - 工具调用是折叠卡片：工具名、参数、成败；展开看完整命令行和原始 JSON，被截断时写明模型看到了多少字符。
    失败的卡片显示 CLI 的拒绝 JSON。
  - 回答里图上有的版本名（ID@N）做成链接：点击后图谱定位并选中。
  - Stop 按钮停止、重答（用当前选中的模型，所以先换模型再点就是换模型重试）、复制。
- **上下文**：每条消息自动带上图谱当前选中的版本、研究线和账本提交，写进系统提示词。
- **输入区**：Enter 发送、Shift+Enter 换行（和 IntelliJ AI Assistant 一致）；左下角模型选择器只列测试通过的模型，
  按 Agent 分组；线程中途可以换，下一条消息起生效。
- **没有活跃 Agent 时**：面板中间只有一句说明和 **Add an agent** 链接，输入框禁用。
- 第一版没做：可去掉的上下文条、⌘. 停止、trial 号链接、工具卡片上的耗时。

### 2.3 Agent 配置（⚙）

一个 Agent＝一家 provider 的一份凭据加一组允许使用的模型。

```
┌ Agents ────────────────────────────────────── [+ Add] ┐
│ ● Claude       anthropic   3 models   tested 10:42    │
│ ● DeepSeek     deepseek    2 models   tested 10:40    │
│ ○ ChatGPT      openai      untested           [Test]  │
│ ✕ ChatGPT-2    openai      failed: tool call   [Test] │
└───────────────────────────────────────────────────────┘
```

添加 / 编辑表单：

| 字段 | 说明 |
|---|---|
| Name | 显示名 |
| Provider | DeepSeek / OpenAI / Anthropic 三选一 |
| API key | 只写：保存后只显示末四位，读不回来；留空表示不改 |
| Base URL | 可选，默认官方地址（给代理或兼容网关用） |
| Models | 保存 key 后从 provider 的模型列表接口拉取，勾选要用的（OpenAI 的列表只留聊天模型） |
| Default model | 新线程默认用它 |

**Test（测试通过才是活跃）**，三步，逐步显示结果：

1. **Key**：调 provider 的模型列表接口，确认 key 有效、Base URL 可达。
2. **Reply**：对每个勾选的模型发一条最短的流式请求，确认能出字。
3. **Tools**：给模型一个假工具 `ping`，要求它调用一次再用结果回答，确认这个模型会调工具。产品的所有查询都走
   工具，不会调工具的模型（例如某些纯推理模型）在这一步标为不可用，不进模型选择器。

三步全过：●活跃。任何一步失败：✕，写明哪一步、provider 返回的错误。改了 key、Base URL 或模型列表，状态回到
○未测试。测试结果只存时间、通过的模型和 key 的指纹（末四位加哈希），用来判断 key 换过没有。

活跃只说明「上次测试时能用」。聊天时 provider 返回 401/403，这个 Agent 自动转为 ✕ 并提示重测。

### 2.4 外观：和 IDE 对齐

10-25 拆包检查 `@assistant-ui/react` 0.15.31：不带 CSS 文件，组件里没有写死的 class；只有一个默认的文本渲染器带两处
内联样式（`white-space`、`font-family`），我们换成自己的渲染器后就不存在了。它是 Radix 式的无样式基础组件
（`ThreadPrimitive`、`ComposerPrimitive`、`MessagePrimitive`、`ActionBarPrimitive` 等），支持 `asChild`，依赖的
`radix-ui ^1.8.1` 与我们现在用的是同一个包，React 19 可用。常见的「assistant-ui 长相」来自它可选的 shadcn
主题（用 CLI 拷进项目的源码），我们不用。所以外观完全由我们自己的组件决定，照 `research-graph-design-spec.zh.md`：

- **放在哪**：聊天用的按钮、输入框、卡片放 `components/`（`check-rules.mjs` 只许那里出现 `<button>` 和 Radix
  trigger），用 `asChild` 套现有的 `IconButton`、`TextButton`；面板本身放 `shell/`。每个文件不超过 200 行，
  颜色只经 `roles.ts`，图标进 `icons/registry.ts`（`bot`、`arrow-up`、`square`、`copy`、`rotate-ccw`）。
- **消息**：不用聊天气泡，照 IntelliJ AI Assistant 的样子。用户的话是一张 L2 卡片（色阶 3 加半透明描边），
  回答直接排在岛面上；模型名用注释字号的次要文字。工具调用卡片也是 L2，用 Radix `Collapsible` 折叠；
  原始 JSON 放等宽的 `<pre>`（最高 320px，岛的覆盖式滚动条），不为它加 CodeMirror 的 JSON 语言包。
- **Markdown**：模型输出 Markdown，用 `@assistant-ui/react-markdown`（内部是 `react-markdown`）加 `remark-gfm`
  （表格），把每种元素映射到我们的样式：标题最多两档、600，行内代码是带描边的小块，表格是细线表，中文段落
  行高 1.6。字体继承页面的 Supply 加 HarmonyOS Sans SC，不用另设。渲染器和元素映射必须保持同一个组件身份：
  每次渲染新建一个组件会让流式中的文本整段重挂，平滑从头开始，结果要等回答写完才一次出现（10-25 实测踩到）。
- **弹层**：模型选择器用现有的 `Dropdown`（L3：描边加两层阴影）。
- **打字机效果**（用户 10-25 要求）：服务端用 AI SDK 的 `smoothStream` 把模型的输出切成小块匀速发出，中文按字、
  拉丁文按词切，页面收到多少就显示多少。逐字出现靠的是内容本身的节奏，不是 CSS 动画，所以不违反设计规格的
  「只动 transform 和 opacity」；不做闪烁光标。生成中的提示只用 opacity 过渡，遵守 `prefers-reduced-motion`。
  用户停在底部时自动跟随，往上翻了就不跳。页面这边 `react-markdown` 自带的平滑再把到手的字匀开。
  10-25 实测（本机假 DeepSeek 端点、真账本）：服务端约 13 ms 发一块，`serve` 的转发不攒包；页面里一段 300 字的
  回答在约 1.7 s 内分 80 多次长出来。
- **快捷键**：⌥0 开关面板（和其他工具窗一样进命令面板），⇧Esc 隐藏。

做不到或要先试的：

- **数字格式**：IDE 规定百分比两位小数（20.00%）。工具卡片里的数字经 `lib/format.ts` 排版，能保证；模型自己写的
  句子只能靠系统提示词要求，渲染器不改模型的原文。
- **滚动条**：assistant-ui 的 `ThreadPrimitive.Viewport` 自己管滚动容器，OverlayScrollbars 直接挂在它上面
  （`ScrollArea.tsx` 抽出的 `useOverlayBars`），所以岛里仍没有原生滚动条。OverlayScrollbars 接管视口的内边距，
  留白要放在视口里面的一层上。
- **体积**：页面是单个 HTML 文件，没法按需加载。实测 `dist/index.html` 从 1,589.96 kB（gzip 579.50 kB）涨到
  2,582.33 kB（gzip 865.91 kB），多出的主要是 assistant-ui、AI SDK 的客户端和 Markdown 解析。页面在本机打开，
  这个代价可以接受；渲染成文件的页面同样带着这部分代码，只是不显示面板。

## 3. 架构

```
浏览器（IDE 页面 + Agent 面板，assistant-ui）
   │  同源 HTTP：/api/view、/api/events、/api/agent/*
   ▼
页面服务（Python，ide.py serve）──────────────┐ 子进程：research graph、ledger sql
   │  /api/agent/* 原样转发（流式）            │
   ▼                                          ▼
聊天服务（TypeScript，Node 24，AI SDK）── 子进程：只读白名单命令（reader 账号）── Dolt
   │
   └── 三家 provider 的 HTTPS
```

### 3.1 服务端语言

| 选项 | 结论 | 理由 |
|---|---|---|
| **TypeScript（Node 24）做聊天服务** | 采用 | AI SDK 只有 TypeScript 版，三家 provider、流式、多步工具调用、assistant-ui 用的消息流协议都现成；页面也是 TypeScript，消息类型两头一致；Node 24 直接跑 `.ts`（类型擦除），服务不用打包；镜像的构建阶段已经有 Node |
| **Python 保持页面服务** | 不改 | `ide.py serve` 刚由 #1709 做好，标准库实现、经过两轮审阅、CI 出镜像；重写成别的语言不带来新能力。只加一个 `--agent` 参数，把 `/api/agent/*` 转发给聊天服务 |
| Python 做聊天服务 | 不用 | 要么引入 LiteLLM（依赖树大），要么用两家官方 SDK 自己拼工具调用循环，再手写 assistant-ui 要的流协议；页面服务是标准库实现，也不该为聊天加第三方依赖 |
| Go、Rust | 不用 | 没有和 AI SDK 相当、同时覆盖三家并对接 assistant-ui 的库，要自己写各家流式和工具调用；仓库里也没有别处用这两种工具链 |

### 3.2 各部分

- **聊天服务**：`services/ide/agent/`，自己的 `package.json` 和锁文件。监听 `127.0.0.1:8766`（容器内，不对外发布）。
  它不导入产品 Python 包、不连 Dolt；工具一律以子进程调 `uv run --frozen python -m cli.main`，带 reader profile，
  参数写成 `--name=value`，不经 shell。**信任边界是两层**：命令白名单（§4，模型能做的事由它决定，不由提示词
  决定），以及 reader 账号（容器里的服务文件只有只读账号，数据库层面就写不了）。
- **页面服务**：新参数 `--agent=URL`。给了才转发 `/api/agent/*`（GET、POST、PUT、DELETE），先做和其他接口相同的
  Host 与跨站检查；没给时这些路径是 404，页面据此不显示 Agent 按钮。页面服务只向下调聊天服务，聊天服务不回调它。
- **镜像**：最终镜像加 Node 运行时和聊天服务的生产依赖；入口脚本先在后台起聊天服务（数据目录 `/data/agent`），
  再起页面服务并带 `--agent=http://127.0.0.1:8766`。
- **页面**：Agent 面板是新的右侧工具窗，不是 view model 里的 widget，由外壳单独注册；一次性 `render` 出的离线页面
  没有服务端，不显示 Agent 按钮。回答里出现的版本名（如 `ema-12@5`）由页面对照当前 view 识别成链接，点了图谱定位，
  不需要前端工具。
- **线程**：assistant-ui 的线程列表适配器接聊天服务的 `/api/agent/threads`，消息按 assistant-ui 的行格式
  （`id`、`parent_id`、`format`、`content`）存。

## 4. 工具（全部只读）

| 工具 | 对应命令 | 用途 |
|---|---|---|
| `research_state` | `research state` | 当前路线、目标、现行判断 |
| `research_status` | `research status` | 事实计数、路线比较表 |
| `candidate_list` / `candidate_show` | `candidate list` / `candidate show` | 策略版本及其完整源码 |
| `replay_report` | `replay report` | 一次封存回放的结果、指标 |
| `ledger_sql` | `ledger sql` | 一条只读查询（reader 账号只有 SELECT，数据库层面就写不了） |
| `market_coverage` | `market coverage` | 某个市场提交上各合约的覆盖 |
| `paper_runs` | 模拟盘的运行状态接口 | 模拟盘做好之后加：「策略的运行情况」 |

- 系统提示词里放：产品是什么、账本主要表的说明（从 schema 生成，不手写）、工具清单、「数字必须来自工具结果，
  没查到就说没查到」。不放研究方法——方法属于 research-round 等 skill，给外部 Agent 用。
- 工具结果过大（完整源码、长查询结果）时截断并告诉模型截断了多少，避免撑爆上下文。
- 单条消息的工具调用步数设上限（例如 12 步），到上限就停下来报告。

## 5. 为什么只读

- AGENTS.md：研究问题和方法由外部 Agent 选；不建平行的研究流程；写账本只走 CLI；用户的两个研究目标、拒绝和审计
  检查的改动要用户授权；发布只追加、全部公开。
- 10-03 用户决定「代理在外、规矩在内」：产品经 MCP 和 CLI 给 Claude Code 等外部 Agent 用，不自建产品内研发代理。
- 账本里存有第三方来源原件（论文、网页）和自由文本，模型读到的内容里可能夹着指令（提示词注入）。只读时这类
  注入最多让回答出错；能写的话就可能写进一份公开、只追加、删不掉的账本。

以后若要放开写，建议的形状：写工具只包一层 CLI 写命令；每次调用在面板里行内显示完整命令，用户点 Approve 才
执行（assistant-ui 自带行内审批）；`line targets` 这类用户专属的决定不进工具清单。这一步要用户另行决定。

## 6. 存储

| 东西 | 放哪 | 为什么 |
|---|---|---|
| Agent 配置（含 key） | 聊天服务数据目录（容器里是卷上的 `/data/agent`）下的 `agents.json`，权限 0600，先写临时文件再改名 | key 是私密的，账本和市场库全部公开 |
| 测试结果 | 同上 | 本机状态，不是研究数据 |
| 聊天线程 | 同一数据目录下 `threads/`，每线程一个 JSON 文件，可在面板里删除 | 对话不是研究数据（AGENTS.md：账本只存重放给不回来的研究事实），属于工作副本 |

不进 Dolt、不进仓库、不进浏览器的 localStorage。key 不出现在网址、日志和发给页面的任何响应里。

## 7. 安全

- 页面服务只发布到 `127.0.0.1`。聊天服务有写接口（保存配置、发消息），所以两层都检查：页面服务照旧校验
  `Host`、拒绝 `Sec-Fetch-Site: cross-site`；聊天服务自己也只接受发给它自己地址的 `Host`、拒绝跨站请求，写请求
  必须是 `Content-Type: application/json`（跨源时浏览器必须先预检，而两个服务都不发 CORS 头，预检必败）。本机
  开发时聊天服务的端口在宿主机上可达，这一层就是给那种情况的。
- 发给 provider 的内容：问题、页面上下文（选中的版本、研究线、账本提交）、工具结果。这些都出自公开的账本和市场库，不额外泄露东西；但用户在
  聊天里自己打的字会发给所选的 provider。
- 不连交易场所、不碰交易凭据（AGENTS.md 第一条）。

## 8. 交付

一个 PR（`feat(ide)`）：本文、聊天服务、页面服务的 `--agent` 转发、镜像与入口脚本、Agent 面板。三部分要一起才能
用：没有面板，服务没人调；没有转发，面板连不上服务。

验收：本机起页面服务和聊天服务，打开 IDE，添加一个 Agent，测试通过后显示活跃；问「当前推荐版本的回撤和目标差
多少」，回答里有 `research state` 的工具卡片且数字一致；中途换模型继续问，回答标出换了模型；点回答里的版本名，
图谱定位到该版本。界面交付前按惯例截亮暗两张图，交独立子代理挑毛病。

10-25 已做到的部分：没有真 key，用本机一个假的 DeepSeek 兼容端点（Base URL 指过去）走完了添加 → 列模型 →
测试（一个模型三步全过、一个被标失败）→ 活跃 → 提问 → `research state` 在真账本上执行 → 流式回答 → 版本链接；
七个工具各在真账本和市场库上跑过一次。真 provider（DeepSeek、OpenAI、Anthropic 各自的 key）的测试和「数字
一致」那一条要用户的 key 才能验。

模拟盘做好之后再加 `paper_runs` 工具。
