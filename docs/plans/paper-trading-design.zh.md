# 模拟盘（paper trading）：从图谱一键运行、实时看盘（设计稿）

2026-10-25 用户提出：在研究图谱上悬停一个策略版本，右侧出现绿色运行按钮（和 IDE 里运行程序的按钮一样），
运行中的版本显示暂停按钮；左侧边栏加一个按钮，打开所有正在跑模拟盘的策略页面：运行列表、图表、策略行为与
事件列表，每个标的一张实时 K 线并叠加该策略在它上面的交易，按需用日历。模拟盘＝接收实时行情、照常生成交易，
但不接用户账户。看过第一版原型后，用户又定：模拟盘一般不多，面板顶部一行运行卡片就够了，不要另设运行列表，
免得信息重复。

本文是动手前的设计，只有调研和方案，没有代码。

## 结论

- **能做，而且不用自己写撮合和账户。** 锁定的 `nautilus_trader==2.0.0rc3` 已经带齐了：实时节点 `LiveNode`；
  Binance 行情客户端 `BinanceDataClientFactory`（`api_key` 可以不填，只读公开行情）；模拟成交客户端
  `SandboxExecutionClientFactory`，通过 `LiveNodeBuilder.add_simulated_exec_client` 接入，自带模拟账户、
  `bar_execution`、`fee_model`、`default_leverage`。回放里那个 `nautilus_trader.trading.Strategy` 子类原样
  `add_strategy` 进去，一行都不用改。
- **价值不只是看盘。** 模拟盘那段时间的数据，过几天会从 Binance 公开归档进市场库。到时同一份源码在同一段窗口
  回放一次，和模拟盘的成交逐笔对账，就能查出回测和实盘之间的差：偷看未来、K 线收盘口径、断线缺数据。这是
  研究链目前没有的证据。
- **用户 10-25 已拍板四件事**，见最后一节：授权模拟盘只用公开行情、无凭据、只用 Sandbox；⏸ 即停止；记录进账本
  并公开；图谱服务只开模拟盘启停。
- **前提**：图谱网页还是一次性生成的静态页，没有服务端。模拟盘需要服务端推送和启停接口，所以
  `research-graph-serve.zh.md` 的第 6 步（Docker 服务）要先做。

## 1. 现状

| 部分 | 现在是什么 | 对本功能意味着什么 |
|---|---|---|
| 图谱前端 `services/research-graph/web` | IntelliJ Islands 布局的单页；左侧边栏有 Versions（⌥1）和 Sources（⌥7）；编辑区跟随最后选中的左侧工具窗；`view.json` 注入静态 HTML | 左侧边栏加第三个按钮，点了编辑区切到看盘面板，沿用「编辑区跟随左侧选择」的规矩 |
| 版本节点 `widgets/lineage/VersionNode.tsx` | 悬停会联动高亮、压暗其他版本；右键菜单 5 项 | 运行按钮放节点右侧，右键菜单加「Run paper / Stop paper」 |
| 策略 | 一个完整 Python 文件，入口类继承 `Strategy`；构造参数由运行器给：`trade_start_ns`、`historical_daily_bars`、`universe_membership` 等；venue 是 `BINANCE` | 实时运行器按同一份合同给这些参数，策略不用知道自己跑在实时环境里 |
| 回放 `engine/` | CI 镜像里跑 `BacktestEngine`，不联网；账户固定为 100,000 USDT 保证金账户、1 倍杠杆、maker 0.0002 / taker 0.0005、1 分钟 K 线撮合 | 模拟盘用同一个镜像、同一份账户合同，换成 `LiveNode` 加 Sandbox，对应回放的 `--execution bars` |
| 存储 | 研究数据只进 Dolt 账本，并公开到 DoltHub；重放能还原的东西不存 | 只存一次性的声明和观测；行情以后会从归档进市场库，不重复存 |

## 2. 交互

### 2.1 图谱上的运行按钮

- 悬停一个**账本里有源码**的版本节点：节点右侧（版本名之后）出现 16px 的绿色 ▶，和 IntelliJ 行号旁边的
  运行图标一个样子。没有源码的版本不出现按钮。
- 单击 ▶：用这个版本**最近一次研究回放的配置**直接启动，跟 IDE 的「运行上次的配置」一样不弹窗。配置包括
  标的列表（或 `--universe pool`）和执行环境；账户固定。启动后按钮马上变成 ⏸，状态栏提示
  `Paper started · ema-12@3 · BTCUSDT, ETHUSDT`。
- `⌥`+单击 ▶，或右键菜单 **Run paper with…**：打开小浮层，可以改标的，执行环境第一版只有 bars，最后一行
  是 Start。这个版本从没回放过、没有上次配置时，单击也打开这个浮层。
- **运行中的版本**：不悬停时，节点标记右上角有一个 6px 绿点；悬停时 ▶ 换成 ⏸。同一版本同时只允许一个运行。
- 单击 ⏸：先弹确认「停止模拟盘？挂单会撤销，持仓按最后成交价记账后结束」，确认后停止（语义见 §2.4）。
- 同样的入口还会出现在三处：Versions 树每一行的右端、⌘K 命令面板（`Run paper: <版本>`、`Stop paper: <版本>`）、
  所有右键菜单。

### 2.2 左侧边栏的 Paper 按钮

- 左侧边栏在 Sources 下面加 **Paper**（⌥8），图标用 Lucide 的 `activity`。有运行中的模拟盘时图标带绿点，
  和 IntelliJ 的 Run 工具窗一样。
- 它**不开左侧工具窗**：点一下，左侧收起，编辑区整块切成**看盘面板**；再点 Versions 或 Sources 就回去。
  模拟盘同时只有少数几个，不需要单独的运行列表；切换运行的工作由面板顶部的运行卡片承担（下一节）。

### 2.3 看盘面板布局

```
┌Stripe┐┌ 编辑区：看盘面板 ───────────────────────────────────────────────┐┌ Details（右）┐
│ ⌥1   ││ 运行卡片：[◆● ema-12@3 +1.8% -2.4% ⏸] [● ema-12@5 -0.4% -0.9% ⏸] [Stopped 3 ▾] ││ 运行配置     │
│ ⌥7   ││ 指标条：净值 · 交易 · 持仓 · 胜率 · 数据延迟（只属于选中的卡片）    ││ 镜像 digest  │
│ ⌥8 ● ││ [Account] [BTCUSDT●] [ETHUSDT] [+ 标的…]                         ││ 健康         │
│      ││  ┌ K 线 + 成交标记 + 挂单价格线 + 持仓底色 ┐                      ││ 与回放对账   │
│      ││  └ 成交量 ──────────────────────────────┘                      ││              │
└──────┘└────────────────────────────────────────────────────────────────┘└──────────────┘
         └ 底部：Events ⌥9 · Orders · Positions · Calendar ──────────────────────────────┘
```

**运行卡片（面板顶部，一行）**

- 每个运行一张卡片，长相和图谱上悬停版本时一样：角色标记（带状态点）、版本名、收益、最大回撤、⏸。
  图谱上的节点和这里的卡片是同一个组件，用户在两处看到的是同一个东西。
- 单击卡片选中这次运行，下面的指标条、标的 tab、事件都跟着换；选中的卡片用蓝色描边。
- 状态点：绿＝运行；黄＝数据滞后，最后一根 1 分钟 K 线超过 2 分钟没到；红＝失败。
- 已停止和失败的运行收进行尾的 **Stopped N ▾** 卡片，点开是下拉菜单，选一个就以只读方式打开它，卡片上
  ⏸ 换成 ↻（用同一配置再跑一次）。
- 卡片的右键菜单：Stop、Locate version in graph、Open source、Copy run id。
- 卡片多到一行放不下时横向滚动。这只是兜底，按并发上限（§3，4 个）不会出现。

**指标条（卡片下方，复用 `MetricStrip`）**

只放卡片上没有的：净值、交易数、当前持仓数、胜率（只是报告维度，不是目标）、数据延迟。收益和回撤已经在卡片
上，不重复；回撤对目标的进度（目标从账本读，默认 15%）画在选中卡片的回撤数字下面。年化收益要到运行满 30 天
才显示，之前显示「样本太短」。

**标的 tab**

- 第一个 tab 是 **Account**：净值曲线，下面是水下回撤图，画一条目标回撤线；有对账结果时，再叠一条同窗口回放的
  净值虚线（§5）。
- 之后每个标的一个 tab，复用 `EditorTabStrip`。有持仓的标的在 tab 上带圆点。
- **标的多时（`--universe pool` 有两百多个）**：tab 只放有持仓、有过成交或被固定的标的，其余从 `+ 标的…` 打开，
  这是一个 cmdk 搜索列表，可按收益、成交数、名称排序。
- 每个标的 tab 的图用 TradingView 的免费开源库 **Lightweight Charts**（npm `lightweight-charts`，v5 系列，
  Apache-2.0，canvas 绘制）。下面每一项都有对应的公开 API，不用自己画：

  | 要画的 | v5 API |
  |---|---|
  | K 线 | `chart.addSeries(CandlestickSeries, …)`；首屏 `setData`，之后每根 K 线用 `series.update(bar)`：时间相同就替换最后一根，更晚就追加。不能每次都 `setData`，那会重置可视范围 |
  | 成交量 | `addSeries(HistogramSeries, { priceFormat: { type: 'volume' } }, 1)`，放在第二个 pane |
  | 开平仓标记 | `createSeriesMarkers(series, […])`，之后用 `.setMarkers()` 更新；标记时间必须落在已有 K 线上，所以成交时间要先对齐到所在周期的开盘时刻 |
  | 挂单（止损、止盈、限价入场） | `series.createPriceLine({ price, color, lineStyle, title })`；订单撤销或成交时 `removePriceLine` |
  | 持仓底色 | 序列 primitive（v5 插件机制，可用 `npm create lwc-plugin` 起骨架），在持仓的时间段画一块底色 |
  | 事件和 K 线互相跳转 | `subscribeCrosshairMove` 读出悬停时刻；`timeScale().setVisibleRange` 跳到某一事件 |
  | 统一 UTC | `localization.timeFormatter` 和 `timeScale.tickMarkFormatter` 用 `Intl.DateTimeFormat(…, { timeZone: 'UTC' })`；时间戳不平移，单位是秒 |

  React 里图表只在 `useEffect` 中创建一次，卸载时 `chart.remove()`，用 `autoSize: true` 跟随 island 尺寸。
  库默认在图上显示 TradingView 标识（`attributionLogo`），照许可保留。具体选项名以安装后的
  `dist/typings.d.ts` 为准。
  - K 线本身；
  - 周期 1m / 5m / 15m / 1h / 4h / 1d 可切换，默认是策略实际订阅的周期，由运行器从策略的订阅里报出来；
  - 成交标记：开多 ▲、开空 ▼，平仓用 ○，按出场原因分颜色：止损红、止盈绿、其他灰；
  - 当前挂单画成水平价格线：止损红实线、止盈绿实线、限价入场蓝虚线，线上标价格；
  - 持仓期间铺浅色底，多单和空单颜色不同；
  - 下面是成交量柱；
  - 十字光标、读数药丸、配色沿用 `research-graph-design-spec.zh.md`。颜色从 `tokens.css` 经 `roles.ts` 的
    `v()` 取，不在 TypeScript 里写色值。
- 点击图上的成交标记：底部 Events 跳到对应事件并高亮；反过来，点一条事件，K 线滚到那一时刻。

**底部工具窗**

- **Events（事件流，⌥9）**：时间（UTC）、标的、类别、描述，最新在上；用户不在列表顶部时，新事件只显示
  「N 条新事件」按钮，不跳动。类别做成过滤 chips：
  - 系统：启动、连上、断线、重连、停止、失败；
  - 数据：K 线缺口（缺 N 根 1 分钟线）、K 线迟到；
  - 订单：提交、接受、拒绝、风控拒绝、撤销、过期、触发、部分成交、成交。同一个 bracket（入场单、止损、止盈）
    折叠成一组；
  - 持仓：开、变、平（含已实现盈亏）；
  - 账户：资金费结算（如果 Sandbox 支持，见 §6）；
  - 策略：保护缺口，即持仓超过 1 根 K 线大于止损单数量，和回放审计同一条规则，实时报出；源码自报的
    integrity findings；
  - 生命周期：PRE_CLOSE、CLOSE。
- **Orders / Positions**：用现有 `DataTable`，列出当前挂单和持仓，以及历史订单。
- **Calendar**：月历热力图，每天一格，按当天盈亏着色（盈绿亏红，深浅表示幅度），格内写盈亏百分比和成交数。
  点某一天，K 线和事件都只看那一天；再点一次取消。运行不满一周时，这个 tab 不在边栏显示。

### 2.4 「暂停」是什么

Sandbox 的模拟账户只在内存里。Nautilus 有没有办法存下它、隔天再接着跑，需要原生探测；即使能接上，停掉的那段
时间里行情照走，持仓的盈亏也说不清。所以建议：**⏸ 的语义是停止**。

- 停止时撤销全部挂单；持仓按最后成交价记账，作为期末未平（与 WS1「期末未平算非赢」一致）；这次运行结束。
- 想继续就点 ↻，开一次新的运行。新运行从空账户开始。
- 用户 10-25 定：图标沿用 ⏸，行为就是停止。

## 3. 架构

```
浏览器（图谱页）
   │ GET /api/paper/runs、SSE /api/paper/runs/<id>/stream、POST start/stop
   ▼
图谱服务 graph.py serve（Docker，127.0.0.1:8765）── 只读 DoltHub 副本出图
   │ /api/paper/* 原样反代
   ▼
paper 守护进程（宿主机，127.0.0.1，只听本机）
   │ 每次运行起一个容器：同一个 CI 镜像 digest，python -m engine.paper
   │ 跟随读取运行目录里的事件日志，推给浏览器
   │ 运行结束时调用 python -m cli.main paper seal 写账本
   ▼
容器：LiveNode
   ├─ BinanceDataClient（USDⓈ-M 永续公开行情，api_key=None，经白名单代理出网）
   ├─ SandboxExecutionClient（venue BINANCE、MARGIN、1 倍杠杆、同一费率、bar_execution=True）
   ├─ 策略入口类（原样）
   └─ 记录 Actor：订阅订单、成交、持仓、账户事件和 K 线，写 events.jsonl 和定时快照
```

**为什么这是产品代码，不是 Agent 的工作**：AGENTS.md 只允许为三类原因加产品代码：信任边界、修已有缺陷、
Agent 做不到的事。这里同时占了两条：

- 长时间运行的进程、并发、网络边界，Agent 做不到；
- 模拟盘的成绩要由产品测量，否则就成了 Agent 给自己打分。

**同一个运行合同**

- `engine/paper.py` 在镜像里，复用 `run.py` 构造策略的代码（`_Configured`）和 `ACCOUNT_CONTRACT`，不另起
  一套账户。效果配置里记 `execution: "paper-bars"`，和回放的 `bars` 区分开，不混进可比性身份。
- 策略的构造参数在实时环境里这样给：
  - `trade_start_ns`：启动时刻向上取整到下一分钟；
  - `historical_daily_bars`：从市场库取到昨天为止的日线。市场库没更新到昨天时，拒绝启动，拒绝码
    `PAPER_WARMUP_STALE`；
  - `universe_membership`：本月成员区间，截到月末。跨月由守护进程处理：用新月份的成员表停掉旧运行、
    开新运行，两段归在同一个 `paper_session` 下。这一点待定，见 §6。

**不碰任何账户的保证（信任边界）**

- 运行器只构造 Sandbox 执行客户端。构造后断言执行客户端只有这一种，不是就拒绝，拒绝码
  `PAPER_EXEC_CLIENT_NOT_SANDBOX`。
- 守护进程用白名单环境起容器，只传运行需要的几个变量，从不转发宿主环境。本机 shell 导出了 Binance 凭据
  （§6 第 1 条），所以这一步是必需的。容器内再查一次：环境里出现任何交易所凭据变量（如 `BINANCE_*`）就拒绝
  启动（`PAPER_CREDENTIALS_PRESENT`）。数据客户端的 `api_key`、`api_secret` 写死为 `None`。
- 容器只能经白名单代理出网，白名单只有 Binance 公开行情域名（`fstream.binance.com`、`fapi.binance.com`），
  用 `BinanceDataClientConfig(proxy_url=…)` 指过去。测试网也要凭据，所以同样不用。
- 图谱服务反代的启停接口沿用 serve 方案的防护：校验 `Host`、POST 只接受 `Sec-Fetch-Site: same-origin`、
  不发 CORS 头。另外加一个启动时生成的令牌，嵌进页面。

**资源**：每个运行一个容器，带 `--memory` 上限（吸取 10-19 全池回放耗尽内存的教训），同时运行的个数设上限
（第一版 4 个）。不做调度，不自动重启：失败就停在 Failed，事件日志留着。

## 4. 存什么

按 AGENTS.md「只存重放给不回来的东西」：

| 东西 | 存不存 | 理由 |
|---|---|---|
| 运行声明：版本、源码 SHA-256、镜像 digest、标的、账户合同、执行环境、开始和结束时刻、结束原因 | 存（账本） | 声明，重放不出来 |
| 实时看到的订单和成交事件（带实时时间戳）、断线和缺口记录 | 存（账本，压缩） | 不会再发生的观测，对账要用 |
| 停止时算一次的读数：指标、日收益、审计结论、原生报告指纹 | 存（账本） | 和回放封存时存的一样 |
| 实时 K 线、标记价、资金费 | 不存 | 之后从公开归档进市场库，重复存就违反「每个事实只存一次」 |
| 看盘面板要的序列、快照 | 不存，是缓存 | 运行目录里的工作副本 |

这会新增账本表（暂名 `paper_run`，外加事件数据）。按规矩，加存储字段前要做独立子代理审阅：谁消费它、它是
哪个独立事实、为什么现有字段和关系表达不了。结论记在 `docs/plans/`。以上公开到 DoltHub 时，和其他账本数据
一样公开。

## 5. 模拟盘和回放对账

市场库导入了模拟盘那段时间的数据以后：

1. `replay run`：同一份源码、同样的标的，窗口取模拟盘的 `[开始, 结束)`，预热和模拟盘相同；
2. 逐笔比较：成交笔数、时间、方向、价格，以及净值曲线；
3. 差异按来源归类：
   - 实时 K 线和归档 K 线不一致；
   - 断线缺数据；
   - 回放里出现、模拟盘没有的交易。这类最值得查，通常是偷看未来，或用了收盘时还拿不到的数据。

结果显示在 Account tab 的叠线和 Details 里的「与回放对账」卡片上。它也是 10-03 用户批准的「只记录的前向阶段」
最自然的落地方式：前向证据来自真实时间，而且能回到研究链里对账。

## 6. 原生探测（锁定版本 2.0.0rc3，2026-10-25）

探测脚本是 Agent 的工作副本，没有进仓库；结论如下。两轮都在本机 `uv run --frozen` 的锁定环境里跑，合约是
`BTCUSDT-PERP.BINANCE`：

- 第一轮 5.5 分钟：市价单一张，bracket 一组，2 分钟内部聚合；
- 第二轮 37 分钟：持多 0.01 BTC，跨过 08:00 UTC 的资金费结算。

进程环境只带 `PATH` 和 `HOME`，见第 1 条。

| # | 问题 | 结果 | 对实现的要求 |
|---|---|---|---|
| 1 | 凭据 | 本机 shell 导出了 `BINANCE_API_KEY` 和 `BINANCE_API_SECRET`。探测脚本的检查当场拒绝了启动；之后一律用 `env -i` 起进程 | 只在容器里检查、发现就拒绝，在这台机器上会次次拒绝。守护进程必须用白名单环境起容器（`docker run` 不继承宿主环境，只传指定的变量），容器内的检查留作第二道防线。Nautilus 在 `api_key=None` 时会不会回退读环境变量，我没有验证：验证就得把真 key 放进进程 |
| 2 | 不填 key 能否订阅 USDⓈ-M 公开行情 | 能。`BinanceProductType.USD_M` + `BinanceEnvironment.LIVE`，`load_ids` 只载一个合约 | — |
| 3 | instrument id 与费率 | `BTCUSDT-PERP.BINANCE`，与回放相同；`maker_fee` 0.0002、`taker_fee` 0.0005，与 `ACCOUNT_CONTRACT` 相同 | — |
| 4 | 1 分钟 K 线语义 | 只发收盘的 K 线，`ts_event` 等于 Binance 的 `close_time`（开盘 + 60 s − 1 ms），和市场库导出的口径一样。到达延迟 73–829 ms；有一根比自己的 `close_time` 早 1.07 s 到。两轮共 42 根 1 分钟线没有缺口，第一轮 5 根与 `fapi/v1/klines` 逐字段相同（开高低收量），早到的那根也一样 | 「K 线迟到」事件以 `close_time` 加 2 s 为线；对账用 `close_time` 对齐 |
| 5 | 内部聚合 | `2-MINUTE-LAST-INTERNAL@1-MINUTE-EXTERNAL` 正常；`ts_event` 落在整分钟（收盘时刻），比触发它的 1 分钟线晚 2–10 ms 到 | 策略的订阅写法不用改 |
| 6 | Python 策略进 `LiveNode` | `LiveNode.add_strategy(<Strategy 子类实例>)` 可用；`StrategyConfig.strategy_id` 要传 `StrategyId` 对象 | 复用 `run.py` 的构造代码 |
| 7 | Sandbox 撮合 | 市价单按触发它那根 1 分钟线的收盘价成交，记 TAKER，佣金＝数量×价×0.0005。`order_factory.bracket` 在这一版返回 list，`submit_order_list` 能直接收：入场单成交，`STOP_MARKET` 止损和 `LIMIT` 止盈（`post_only`、`reduce_only`）都被接受 | — |
| 8 | 标记价与资金费的节奏 | 标记价流每秒一条，Nautilus 每秒发一个 `MarkPriceUpdate` 和一个 `FundingRateUpdate`（2,219 秒各 2,219 条）。回放每根 1 分钟 MARK 线只发一条 MARK，资金费只在存储的更新点发 | 策略收到的回调多了约 60 倍，处理办法实现时二选一：在运行器里把它降到回放的节奏（每分钟最后一条 MARK，资金费只在费率或下次结算时间变化时发）；或者原样交给策略，写进运行概要的 limitations。倾向前者，因为它让源码在两个环境里看到的是同一种输入 |
| 9 | Sandbox 是否结算资金费 | **不结算**。持多 0.01 BTC 跨过 08:00 UTC，当期费率 +0.00006047，应付约 0.049 USDT；账户总额前后都是 99,999.597127 USDT | 资金费由封存读数补上：按实时收到的结算费率、结算时刻的持仓和标记价逐期算出，单列成一项。看盘面板的净值同样扣除；运行概要写明 Sandbox 账户本身不含资金费 |
| 10 | 停止 | `LiveNode.handle().stop()` 正常退出，`on_stop` 会执行；但挂单和持仓留在 cache 里（`Residual …` 警告），Nautilus 不替我们撤 | ⏸ 的「撤挂单、持仓按最后成交价记账」由运行器在停止前做：先撤单，等撤单回报，再读持仓 |
| 11 | 线程 | `PyLiveNode` 不可跨线程，在别的线程调 `node.handle()` 会让进程中止（pyo3 断言）。要先在主线程取到 handle，别的线程只调 `handle.stop()` | 守护进程停运行走信号或 handle，不碰 node 对象 |

没有探测、留给实现 PR：断线重连后会不会补发缺失的 K 线（要人为断网）；Sandbox 有没有强平（1 倍杠杆下很难
触发）；跨月成员表的更新方式（§3）。

## 7. 不做

- 真实账户、任何凭据、Binance 测试网。
- 在面板上手工下单、撤单、平仓：模拟盘评估的是策略自己的决策。
- 第一版不做 quotes 执行环境。实时 L1 用公开的 `bookTicker` 流就能做，作为后续。
- 真暂停和续跑、自动重启、定时启停：不做调度器。
- 页面上编辑策略。源码只能经研究链改出新版本。

## 8. 交付顺序

1. `docs(plans)`：本文。
2. 原生探测（§6，已完成）；在加账本表的 PR 之前，按 AGENTS.md 做存储字段的独立子代理审阅并记在 `docs/plans/`。
3. 图谱 Docker 服务，即 `research-graph-serve.zh.md` 第 6 步，是前提。
4. `feat(engine)`：`engine/paper.py`、记录 Actor、§6 的原生探测证据；新的镜像 digest。
5. `feat(paper)`：守护进程，以及 `python -m cli.main paper start|stop|list|seal`，账本表和 `ledger upgrade`。
6. `feat(research-graph)`：节点上的 ▶ 和 ⏸、Paper 按钮、看盘面板（运行卡片、标的 tab、Events、Orders/Positions、
   Calendar）；`lightweight-charts` 进 `web/package.json`。它默认显示 TradingView 标识，按其许可保留。
7. `feat(report)`：模拟盘与回放对账。

## 9. 用户决定（2026-10-25）

1. **授权**：模拟盘只用 Binance 公开行情，不用任何凭据，只用 Sandbox 模拟成交；不接测试网，不接实盘。
   AGENTS.md「需要用户明确授权」一节里的「实时连接交易场所」，只对这一种用法放开。那一句话在第一个实现 PR
   里改，写明这个范围；实盘、测试网和任何凭据仍要另外授权。
2. **⏸ 就是停止**（§2.4）：撤销挂单，持仓按最后成交价记账后结束；继续用 ↻ 开新运行。
3. **模拟盘记录进账本，并和其他账本数据一样公开到 DoltHub**。
4. **图谱服务只开模拟盘的启停**：经反代转给本机守护进程，限定本机访问；其余仍不开写接口。
