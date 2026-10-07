# Product Edge

<Callout type="info" title="客户端边界，不是新的业务部门">

先看部署与领域工具，再查准确协议。客户端接纳请求并展示结果，各领域持有任务、事实与拒绝状态；兼容 transport 不改变已批准用户路径。

</Callout>

## 职责

Product Edge 是有界请求与结果视图的协议和应用边界。目标研究入口是一组 MCP 服务：数据与回测扩展当前
Nautilus 模块，R&D 是自研研究服务。MCP 转换类型化请求与身份，不成为另一套数据或交易引擎。
[能力扩展图](./capability-adoption/)定义这一基础与内部职责边界。

<a id="产品表面与安装包"></a>

## 产品表面与部署

目标用户、市场、单策略与共享账户组合范围，以及合约先行、现货后续的交付顺序，见[服务架构](./index/)。
确定性任务由各 MCP 背后的服务持有，不属于调用会话。 R&D 可经内部类型化 API
调用数据与回测服务；外部代理决定研究假设与迭代。

产品正确性不依赖内置模型或某个代理供应商。 研究需求由用户直接向外部 Agent 提出，经 MCP 发起与推进研究。 自研 Dashboard 是研究进度、证据和结果的
只读查看入口，以及上线确认、政策配置与策略运行控制客户端。 Dashboard 不发起、暂停、恢复或终止研究， 不派发或控制外部 Agent；产品服务不提供远程控制用户本地 Codex/Claude 会话的链路。
目标后台与 Web Dashboard 部署服务器，保留本地开发方式。 本地 Agent/电脑的可用性不决定服务端数据/ 回测任务与已授权策略运行的生命周期；服务器可用时，已接纳工作依既有边界继续，新研究编排等待外部
Agent。

恢复调用者先解析原 job/request 身份，再发起后继工作。 六组职责不要求六个进程。

下文已有 Compose 包与 Dashboard preview 是当前实现清单，不证明目标服务架构已经交付。
部署与真钱准入仍有独立门禁。

**当前 Dashboard 预览。** 已有 UI 入口是 `product/dashboard`--一个独立可构建的 `trade-dashboard` 镜像，包含 Vibe 衍生外壳、共享 UI
原子，以及当前已准入的第一方读面。 它自带浏览器会话网关、Trade 自有的 RunStore，以及
`dashboard-web`、`dashboard-effect-worker`、`dashboard-shadow-worker`、`dashboard-shadow-scheduler` 四个最小权限进程角色。

`/api/mcp` 是一个无状态 Streamable HTTP endpoint，走同一批有类型 handler，在 浏览器会话闸门之外但需要自己的有限 scoped Bearer
capability，并在 dispatch 前校验 Host 与 Origin。 它保留的兼容工具表包含 Source/Research action、Develop
Composer 与 Replay V2 的 request-custody action、准确 run detail 与有界 run-log 读，不暴露任意 script、database、shell 或管理工具。

外部对话客户端只是可选 consumer，不随产品打包，不拥有业务权威，也不作为实现验收依赖。

Dashboard 与 MCP 调用同一组经过挑选、带版本的操作，并且只能通过有类型 Owner port 工作。 它们不能执行 任意 Owner SQL、产生业务事实或保存影子 workflow truth。
Operations API 只读 Trade 自有的 RunStore 运维 数据；有类型的 R&D 与 Backtest 读走各自准确的 Owner 合同。 它们绝不复制运维 run 行或原始 Owner
payload，运维完成也绝不被重新解释成业务成功。

真实策略循环、行情会话、订单状态机与恢复效果仍由 Trade Runtime、Risk 与 Execution 拥有，Recovery 归 Execution；产品表面只能监督和展示，永远不是交易运行内核。

**当前部署状态：** Dashboard 的全部服务只在 opt-in 的 `dashboard-preview` profile 下启动，镜像 tag 默认
`preview`，web 主机端口默认 `127.0.0.1:3100`，运行时角色不暴露主机端口。**尚无生产部署。** Dashboard 的
effect worker 默认禁用，只有明确的一次性本地权限，且不具备任何生产交易权威。

**部署包。** `product/rd-workbench` 只打包 Postgres、Owner APIs 和自研 Dashboard；Windmill 不是部署依赖。
领域 MCP 使用独立 workspace 与服务合同。旧 wire spelling 保持原记录含义，不选择活动执行器。

已准入读面之下的路由由双语 `DRAWABLE_EXACT` 闸门约束，闸门以下仍是只能导航的占位符；路由名或保留的
源码都不是实现权威。生产部署保持 `TARGET`。Dashboard 在 preview profile 下可达或 MCP
握手成功，都不能让产品表面成为 `CURRENT`；验收必须覆盖下文定义的有界用户旅程、
共同操作、Owner 回执与未解析状态。Dashboard 切片另需直接浏览器证据；MCP 旅程需实际服务请求与结果回读。

## 代理在外的 R&D 创作

用户通过自己选择的外部 Agent 发起研究。Agent 写原生 Nautilus Strategy，提出实验、解释结果并决定迭代。
产品不发起模型调用，也不建立研究判断解释器。R&D 封存源码/参数/依赖/数据需求，记录实验、预算与证据；详见 [R&D](../owners/rd/) 和[原生策略包](./strategy-factory/)。

MCP 仅适配 Owner API；传递请求和获准结果，不传递模型 entitlement、凭据或受保护样本。
提交新内容产生新版本；未知结果保持 `SUBMITTED_OR_UNKNOWN` 并解析同一请求，不覆盖 Artifact 或以重跑猜结果。
机械条件成立即可研究，不要求固定诊断、唯一优胜者或平台认可的研究指标。

Dashboard 只读研究事实和 Agent 解释；来源、摘要与运行状态的权威清楚区分。
浏览器不编译/运行策略，不编辑或覆盖工件，不控制用户电脑 Agent。
已有只读源码查看切片保持原准入范围；新原生包展示需要准确 Owner 投影，不以现有 Wasm preview 证明已经接线。

### TARGET - 外部代理工具面

本节记录领域工具面的目标与已经存在的有界切片。完整[研究场景](../scenarios/research/)仍是目标；
server 握手或一次独立编写运行不能证明整条旅程。

自研 Dashboard 提供产品 UI，Windmill 不是部署依赖。现有托管/路由合同中的 `WINDMILL_PRODUCT_EDGE`
等历史标识，不表示仍有 Windmill 部署。外部代理组合各领域 MCP；一次 `backtest.run` 仍由服务端完成，
不能把十几个内部步骤重新交给代理。内部调用遵循[单向分层与跨层传值](../guide/architecture-rules/#owner-layering-and-inter-owner-trust)：
在外边界严格验证输入，内部消费者不回读上层再次核验其值；预算执行、保护样本隔离与未知结果处理继续成立。

**源码截面 `e71aedb332fdcbcc8a1c18e7822d355bfa19e47e`。** `services/market-data-mcp`、
`services/strategy-authoring-mcp` 与 `services/backtest-mcp` 已有独立无状态 stdio server，
`product/rd-workbench` 有本地部署 wrapper；Dashboard 也保留 `/api/mcp`。当前验收与限制以对应 Owner 页的
记录为准。这里的源码清单不证明部署或操作级 CLI parity。

**服务形态。** 各领域 MCP 连接所属后端；原生扩展与自研职责见[能力采用](./capability-adoption/)，调用边界如下。

- Market Data MCP 暴露扩展后的原生数据服务；Backtest MCP 暴露扩展后的原生回测服务；R&D MCP 暴露研究准入、
  编写、实验记录与研究决定。当前 `strategy-authoring-mcp` 清单本身不证明完整目标 R&D 服务。
- R&D 经内部类型化 API 消费数据与回测。MCP 是外部协议入口，不是内部服务依赖；确定性数据准备与任务依赖由服务执行，
  外部代理在冻结边界内决定研究方向。
- 数据按引用传递，不经代理搬运。消费服务解析并记录准确的已准入托管；任务身份、状态和结果独立于 MCP 断连存续。
- 直接调用 Backtest MCP 或由 R&D 内部调用，都执行相同的范围与拒绝规则。研究试验须绑定已登记准入，计入冻结预算
  与试验台账；未知尝试仍计数，并按同一身份解析，不能盲目重试。
- 原生 execution/cache/portfolio 保持交易事实权威。研究与托管扩展只增加明确分配给自己的记录，
  不维护能独立推进的镜像订单簿或账户总账。
- 共享框架代码不合并凭据、保护缓存或数据库权限。保护读取与有界公开结论在服务内部执行，不能只守 MCP dispatch。
- 已提供的 CLI 与 MCP 使用同一类型化服务操作和检查；CLI parity 不证明完整研究旅程已经实现。

**CURRENT T0/U1 兼容入口。** 下列数据描述、周期白名单及全窗口分钟回填保留当前有界协议。目标准备入口绑定完整 1m 执行输入与原生订阅/聚合配置，不提供下钻或局部精度切换；数据修正形成不可变后继并完整原生重放。现有列表不是目标周期上限。

**`dataset_ref`。** 对一段行情数据的纯描述：标的、执行周期（`1w`、`1d`、`4h` 或 `1h`）与以事件纳秒计的半开区间 `[start, end)`。
它不是任何一方签发的令牌：代理照 `coverage` 报告的结果自己写。消费它的服务在运行那一刻于 Market Data 的托管里解析它；
托管不覆盖时以 `DATASET_REF_UNRESOLVED` 按名拒绝，周期不是执行周期时以 `TIMEFRAME_UNSUPPORTED` 拒绝。运行解析到的托管随
运行一起记录，因此重放读到同样的数据。

**`market-data`**，由 Market Data 提供：

- `list_instruments()` → 已准入的标的。
- `describe_instrument(instrument)` → tick size、lot size 与当前经济条款（费率与保证金），或 `INSTRUMENT_UNKNOWN`。
- `admit_instrument(symbol)` → 交易所 symbol（例如 `BTCUSDT`）的准入回执，由 Market Data 映射到其 canonical 标的；
  或按名给出的准入拒绝。
- `backfill(instrument, timeframe, range)` → 一个 `job_id`。`timeframe` 是执行周期 `1w`、`1d`、`4h` 或 `1h`，成交读取的 `1m` bar 随之
  一起回填；其他周期为 `TIMEFRAME_UNSUPPORTED`。其他拒绝：`INSTRUMENT_UNKNOWN`、`RANGE_INVALID`。
- `job_status(job_id)` → 任务状态，取 `QUEUED`、`RUNNING`、`SUCCEEDED` 或 `FAILED` 之一；`SUCCEEDED` 时给出新增的覆盖；
  `FAILED` 时按名给出成因。未知任务为 `JOB_UNKNOWN`。
- `coverage(instrument)` → 每个周期已覆盖的区间。
- `get_bars(instrument, execution_timeframe, range)` → 内联且有界地返回 bar。拒绝：`RANGE_NOT_COVERED`、
  `RANGE_TOO_LARGE_FOR_INLINE` 与 `HOLDOUT_PARTITION_UNDEFINED`。回测从不经它读取数据：回测接收 `dataset_ref`。
- `get_funding(instrument, range)` → 资金费率，同样有界、同一组拒绝。
- **当前兼容入口**尚无可执行保护分区，这两个工具对每个请求都以 `HOLDOUT_PARTITION_UNDEFINED` 拒绝。
  **V0.1 目标**是在首次普通研究读取前，由 Market Data 登记获批准的研究与保护范围及准确版本，并逐次检查授权和重叠；
  范围未定义或请求触及保护输入仍拒绝。完整 Qualification 保护评估协议后续接入，不是开放普通研究读取的前置服务。
- 每个返回行情数值的工具都在作答的同一事务里把这次读取追加到 Market Data 的代理数据读取台账，写不进去就拒绝
  （[Market Data](../owners/market-data/) 中的「Agent data-read ledger」）。试验行仍归 R&D，其 census 向下读取 Market Data
  的台账。
- 单独验收的条件：代理能在一次性 store 上对一个标的端到端地完成列出、描述、准入、回填与读取，且每个拒绝都被驱动到一次。

**`strategy-authoring`**，由 R&D 提供：

- 它属于 R&D 的编写层（Strategy Artifact）：负责编写、编译检查并保存不可变版本。它不登记已合格的策略，也不负责其生命周期与
  资金，那是 Strategy Governance 与以后的 `governance` server；它也不运行任何东西，那是 Runtime。
- **CURRENT 有界目录：** `spec` 接受单阈值陈述，或语言为 `research.strategy-authoring.v1` 的 JSON 文档，
  与工具公布输入及 R&D 的封闭 `StrategyStatementV1` 一致。两族保留各自规范内容/hash domain，独立于 Research 身份。
  编写面存在不证明完整 R-1 执行。
- **TARGET 原生策略接入：** Agent 直接提交 Nautilus Strategy 源码包、参数、依赖与数据需求；R&D 核验机械条件并封存内容与环境。
  R-1 使用原生订单接口表达挂单、失效、保护及分段退出，缺失接口列为接入/扩展缺口，不增加 JSON 策略语言或 BFP/Wasm 编译链。
  当前六个 statement 工具不证明源码包入口已经交付；原生包另按最小纵向切片准入。见 [R&D](../owners/rd/) 与[策略包契约](./strategy-factory/)。
- `validate(spec)` → `VALID`，或按 authoring 编译器自己的名字给出全部违规，不写入任何东西。
- `create(spec)` → `strategy_id`，即规范化 spec 的内容摘要。同一份 spec 再次创建返回同一个 id。
- `get(strategy_id)` 逐字节返回 spec；`list(filter)`。
- `revise(strategy_id, spec)` → 新 spec 的 `strategy_id`，记录为点名其前驱；没有任何东西被原地修改。
- `archive(strategy_id)` 追加一条归档记录。策略仍可读取，但不能再运行。
- 单独验收的条件：只用这一个 server、不碰任何行情数据，一个 spec 被验证、创建、逐字节读回、修订出后继并归档，且每个拒绝
  都被驱动到一次。

**`backtest`**，由调用 Backtest 的 R&D 运行路由提供：

- **CURRENT 有界路由：** `run(run_id, strategy_id, instrument, execution_timeframe, window_start_ns, window_end_ns_exclusive)` 是现有单阈值路由，在 run 内形成 goal。
  它是有限的编写到报告切片，不是自主研究家族的预登记，不能被描述为完整研究闭环。
  当前工具不接受 `dataset_ref` 或 `cost_profile` 字段，执行在一次调用内完成；准确参数以工具公布 schema 为准。
- **TARGET 研究路由：** 版本化运行请求还须点名已冻结 Research Intent 与被接纳的试验。R&D 在派发确定性任务前
  核对 Artifact、范围、执行语义、成本、前驱数据读取与资源额度；不能在读取结果后发明假设。失败与未知尝试仍计数，
  准确重试加入同一请求。
- 提交返回持久 `run_id`/job 引用；`status`、`list` 与 `report` 在之后观察它。所属领域持有执行与恢复，
  所以 MCP 进程或代理会话结束不丢失任务。
- `report` 绑定原生 Result 身份，陈述覆盖、事件排序分辨率、手续费、资金费、滑点、保证金与容量假设。
  组合收益、回撤、重叠敞口及持有/现金基线是主报告，可选随机入场对照与逐交易诊断辅助 Agent 解释，不把自动对照回放设为报告前提；探索细节可读，保护细节不可读。
- 保护分区不存在时报告明确只作探索，不证明独立资格；分区登记后重叠的研究读取与运行以 `HOLDOUT_WINDOW_OVERLAP` 拒绝。
- 完整验收是研究场景的 R-1 旅程，含会话重启、亏损与失败试验和原生读回；单阈值报告验收仍是更小的当前切片。

**`research`**，由 R&D 提供（V0.2 完整研究管理 TARGET；V0.1 保留最小实验登记）：

- 在实验结果数据被读取之前，登记 Agent 实验方案、比较目标、策略包、数据范围、配置、资源和批准政策。
  R&D 按实际接纳任务和参数组记账，不从调用方手报次数推断完整普查。
- 响应绑定 Research Intent、永久 TrialFamily 与 census frontier。一个 family 有后继 Intent，所以假设、家族与每个实验
  不能被压成一个身份。Market Data 台账与完整前驱血缘核对已有读取；旧知识能推动新实验，旧结果不能被改名成独立验证。
- 代理可在用户冻结主题与资源额度内开立新机制家族。越出该范围的协议或主题变更需要新用户请求。每轮提出诊断与后继/停止，
  只有 R&D 准入才创建 Iteration Decision。
- `list_trials` 与 `census` 完整解析每个已接纳 attempt、原生 run/report 引用、结果类别与计数，含失败和未知。
  试验次数与资源支出分别陈述；legacy 预算字段在完成已记录迁移前仍是 legacy 事实，不能被称为新支出报告。
- MCP transport 不直接写 Owner 存储；每次写都调用 R&D 原生 operation 并取得回执。缺少生产者或读回是实现依赖，MCP adapter 不能补造。
- 保护数值、判决原因与逐交易保护记录不可访问；公开 `CLOSED_NOT_QUALIFIED` 不关闭研究机制。探索诊断经原生 Result 引用读取。
- 验收登记实验、拒绝无效预登记、运行其冻结 Artifact，并在会话重启后读回完整 attempt 与 Iteration Decision，且没有保护细节。

**组合入口与读回（TARGET）。** `research` 登记封存的多策略组合实验，`backtest` 接纳其成员集合与共享账户配置，
`qualification` 接纳独立选定的组合并返回受限资格结论，`governance` 生命周期请求引用准确组合资格与用户确认。
状态/结果读回必须区分成员资格和组合资格，展示组合配置身份与评估范围；不把单 `strategy_id` 请求隐式解释成成员列表。
继续复用现有 MCP/API 能力目录，组合是输入和证据形状的扩展，不新增 server 或直接交易工具。

**其余领域 API 目录（TARGET；不要求分别新建 server）。** 细节以对应 Owner 的阶段规定为准。

- **`knowledge`**，由 R&D 知识台账提供：`family_status`、`record_conclusion` 与 `check_before_research`。红线：条目只追加，
  不持有任何受保护数值。构件检索返回准确规则版本、适用范围、证据等级与反例；正向发现和负向结论同样保存，
  复用进入新 Intent，不继承策略资格。完整契约见 [研究知识台账](../owners/rd.zh.md#knowledge-reuse)。
- **`qualification`**，由 Qualification 提供：`submit_candidate`、`status` 与 `verdict`；可选 `forward_register`/`forward_status` 单独保持未准入，不是真实试盘前提。红线：任何 holdout 数值都不出去。今天 Qualification 把每个负向终态都按字节相同地投影为
  `CLOSED_NOT_QUALIFIED`，因此 `verdict` 只答 `QUALIFIED` 或 `CLOSED_NOT_QUALIFIED`。内部评估可区分通过、等价无效与
  证据不足，这些类别保持受保护；任何公开负向判决都不关闭研究机制。
- **按需找币**复用 Market Data 的直接查询；有状态策略观察复用 Backtest 原生回放。
  R&D 按需保存研究请求与结果引用，不提供另一个观察 Host 或必经扫描路由，也不提供扫描计划 CRUD；运行策略持续消费原生行情判断机会。
  扫描结果不是激活权威。见 [R&D 按需发现](../owners/rd.zh.md#on-demand-read-only-opportunity-discovery)。
- **`governance`**，由 Strategy Governance 提供：`list_eligible`、`request_trial`（准确版本与用户确认的真实试盘政策）、`pause`、`retire`
  与只读的 `capital_policy`。红线：请求本身不创建激活。用户在 Dashboard 批准适用政策与权限，试盘达到冻结条件后自动转正；
  初次进入试盘必须由用户确认准确候选与冻结政策。合格候选可留在 R&D；有效策略可主动下架改进而不记为经济失效，用户停止后不自动重新上线。
- **`portfolio`**，由 Portfolio 提供：`account_state`、`exposure`、`performance` 与 `capacity`，全部只读。
- **运行只读查询**，通过已准入类型化接口读取 Runtime、Risk、Execution 与可观测性视图，不要求新建聚合 server：
  `instance_status`、`readiness`、`orders`、`fills`、`drift` 与 `alerts`。红线：kill switch 只可读，只有用户本人能触发它。

**真钱红线。** MCP 不直接下单或接触交易凭据。生命周期效果必须在用户批准的政策与授权内，
符合冻结条件的自动转正由 Governance 决定，不要求每次重复人工批准；当前真实效果仍未准入。

**长时间运行的工作。** 任务生命周期与托管属于对应领域服务：

- MCP server 是代理会话的 stdio 子进程。它随该会话启停，不保存状态，不托管任何长任务，也不启动容器：启动容器需要
  Docker socket，而那等于主机 root。
- 长时间运行的确定性工作由所属领域服务持久执行，使用 worker 与该领域已准入的调度。回测、数据准备和按需发现
  均可在 MCP 会话退出后继续。市场扫描不另设定时任务，运行策略通过原生节点持续消费和判断行情。
- **TARGET：** 长任务提交返回持久 job/run 身份，代理之后读状态与结果；回测、准备、按需发现和可选前向记录按所属领域恢复。
  当前有界 backfill 和 backtest.run 在单次请求内执行并记录结果，不证明完整异步 worker 已实现。
  服务目标与[当前及目标 API 清单](./index.zh.md#后台服务清单与-api-能力目录)分别验收。
- 当前 `rd-build-sandbox` 是既有编译链的容器。目标原生包复用普通 Docker/任务资源上限；该容器不构成新增源码路线或真实交易隔离证明。它不按任务
  启动。
- 需要模型、不确定的工作，例如代理定期做研究，由宿主侧的定时器唤醒一个代理会话，再由该会话调用各个 MCP server。产品里不放
  任何代理。
- 既有 Dashboard shadow/effect-worker 接线是兼容入口，不拥有业务调度权威。领域服务持有持久 job；Dashboard 只读研究事实，只提交获准的 Governance 控制。旧 Scanner 的调度不作为目标能力迁入新服务。

**权限。**

- 每个 server 在自己的环境中持有它向自己的 Owner 出示的凭据。任何工具参数或结果都不携带凭据，代理也从不看到凭据。
- 没有工具到达 Paper、Live、交易所凭据或任何执行路径。真钱边界不变。
- 更换代理，或改用命令行而不是 MCP，只改变归属，从不改变权威，正如下文 Agent Shell 部署绑定对每个 channel 的规定。

**只给结论，从不给受保护数值。**

- 没有工具调用 Qualification 的受保护读取，也没有研究运行读到已登记的保护范围：当前范围未定义时 `get_bars` 与
  `get_funding` 拒绝一切；V0.1 经 Market Data 登记获批准的范围后只开放普通研究读取，重叠的读取和回测仍拒绝。
  后续 Qualification 只通过其公开状态作答。
- 拒绝按名透传。没有任何拒绝被折叠成泛化失败。

**Dashboard MCP。** `/api/mcp` 是 preview 界面的有界操作通道，不是外部研究代理的领域入口，
不扩展为研究工具聚合器。保留的兼容工具为 Source/Research、Develop Composer、Replay V2 请求动作及精确 run/log 读取，
使用既有类型化 handler 和准入；这些研究动作不属于目标 Dashboard 研究路线，研究视图仍只读。没有 Artifact Formation preflight/action 或内部模型构建工具。

## 类型化 Owner 请求

客户端向所属领域 API 提交稳定请求身份、准确内容、principal、scope 和该操作要求的授权。领域服务在外边界验证权限、有效期、撤销状态、输入版本及幂等含义，内部只传递已验证的值。MCP 工具名称、自然语言、客户端配置或传输成功都不能授予业务权限。

相同身份与相同含义加入原请求；同一身份的内容、scope 或授权含义变化必须拒绝。未知结果保持 `SUBMITTED_OR_UNKNOWN`，只能解析该身份的 Owner 回执，不以重新提交新身份猜测成功。到期/撤销禁止尚未提交的新效果，不能重写已提交事实；已接纳的恢复仅闭合原 custody，不授予新调用。

无人值守交易另须显式 Autonomous Policy Authorization，绑定策略版本、generation、账户和效果 scope、允许动作、资金政策及有效区间。Governance、Runtime、Risk、Execution 保留该 lineage；缺失、过期、撤销、跨 scope、混合版本或未知效果时停止新增风险。凭据只由服务解析不透明最小权限 handle，绝不进入请求、工件或日志。

当前旧请求入口仍使用 deployment binding、history head、operation manifest 和 Product Edge admission；这些准确身份与原拒绝继续约束该入口，不回填 legacy 行，也不解除 quarantine 或重放围栏。原生领域 API 不要求重新建设一套 Shell 历史数据库。

`ProductEdgeResearchGoalRequestV3` 的一至两个标的是现有窄切片，不是产品研究上限。目标研究请求显式绑定完整 instrument set、数据需求和版本，可承接 research 的数十标的；不默认补齐，不把未实现的批量范围宣称为已可用。

## 只读视图

每个 Product Edge 只读模型都是有界 Owner 投影，不是影子存储。 共同 envelope 绑定稳定 read-request 身份 trusted principal、准确授权 scope 或账户与
Execution Scope、authorization-policy 身份与截面、 来源 Owner、完整权威 source frontier 或 snapshot cut、observed/projection
time、新鲜度和 valid-through。

可用结果明确为 `AVAILABLE` `STALE` 或 `UNAVAILABLE`；完整性要求更严格的模型还可额外失败关闭。
同一请求在同一来源截面重放返回同一投影身份；新来源截面创建后继视图。 跨 principal scope 账户 mode、 政策过期 时间过期或同请求冲突重放都不返回缓存视图，也不创建 Owner transition。

Research View 状态为 `AVAILABLE` `STALE` 或 `UNAVAILABLE`，并暴露一个阶段：
`REQUEST_UNRESOLVED` `INTENT_FROZEN` `ARTIFACT_AVAILABLE` `EXPLORATION_ACTIVE` 或 `SELECTION_TERMINAL`。

它只包含 R&D 拥有的来源血缘 Research Intent 状态 Strategy Artifact 与 Build Receipt 引用 探索请求结果摘要 Research Selection
Disposition，以及已授权请求的有界 D-only Repair Disposition。 它不包含保护重放测量 参数 结果 holdout 消耗或可解引用 Qualification 证据。

Exploratory Run Result View 只从完整 Backtest frontier 向已授权 Research scope 投影 Backtest-owned 探索结果。 Governance
Decision View 只从完整 Governance frontier 投影 lifecycle state、policy bounds、 effective interval、有界 rationale
和不透明已提交事实引用。

两者读取可用性均为 `AVAILABLE` `STALE` 或 `UNAVAILABLE`，都不暴露保护评估细节；Governance view 也不证明
Runtime application 或外部效果。

Qualification Status Summary 只暴露 `NOT_ADMITTED` `ADMITTED` `EVALUATING` `CLOSED_NOT_QUALIFIED`
`QUALIFIED` `EXPIRED` `REVOKED` 或 `UNAVAILABLE`。内部 replay 拒绝或无效、diagnostic 无效或未解析、
assessment 无效以及 `INELIGIBLE` fact 全部映射为同一个 `CLOSED_NOT_QUALIFIED` outcome，并使用类型
不透明且不可解引用的 reference。Product Edge 不能区分、计数、分组或过滤这些内部负面原因。

Portfolio View 状态为 `AVAILABLE` `INCOMPLETE_FAIL_CLOSED` `STALE` 或 `UNAVAILABLE`，只包含 Portfolio 拥有的账户 暴露 表现
和 gross Capacity View 投影，并绑定获准读取的 Execution Scope 与一致 Portfolio 快照截面。它不包含
Risk Reservation Aggregate Commitment Frontier usage 剩余 headroom Risk Decision 或部署交易权限。
来源截面缺失 未授权 过期或混合时保持明确不可用，不能拼接或推断。

Effect Closure View 由 Product Edge 针对稳定 effect-view request 与已授权 Execution Scope 直接向 Execution 请求。
`AVAILABLE` 只返回一个 `UNKNOWN_EFFECT` `NO_EFFECT` 或 `SETTLED` 投影，并绑定 attempt 账户
mode effect namespace Effect Journal frontier 回读/对账截面 blocker 责任 Owner projection cut 和 valid-through。

政策缺失或过期、跨 principal/账户/mode、请求含义变化或 case/fence 不匹配时不返回 view。 source frontier 或权威回读未解析时，同一请求保持
`UNAVAILABLE`，不能推断闭合。 同一来源截面 准确重放加入同一投影，较新截面创建后继 view。 Product Edge 可以用该 view 解释进度，但效果与 Recovery
状态只能由已提交 Execution 及其他来源 Owner 事实建立，Research 永不把该 view 当 provenance。

## 产品闭环与应用层

只有用户能把一个有界目标从入口推进到权威结果及其下一个合法动作，而不需要手工拼接 Owner 数据库、
回执、日志或终端输出时，产品闭环才成立。Product Edge 用类型化 Owner 请求、请求关联回执和有界只读
模型组合这段旅程，但不拥有旅程中展示的业务转换。

研究旅程关联 Agent 来源与假设、封存原生包、已登记实验、实际 Backtest 证据，以及 Agent 的解释、选择或下一步。
R&D 保存这些记录，不要求固定诊断管线、唯一后继或自动修复请求。Dashboard 按相同引用只读展示；研究由外部 Agent 经领域 MCP 提交，
只有已准入 Governance 操作使用 Dashboard 控制。所属服务给出请求相等的终态回执前保持未决；可见按钮或运维状态不能推进业务事实。

Product Edge 可以拥有筛选、布局和未提交表单等短暂交互细节，但不拥有 Research 血缘、Iteration
Decision、Qualification 状态、生命周期状态或外部效果闭合。Observability 可以为旅程标注进度与诊断；
遥测可用性、Dashboard 状态和告警投递永远不能证明完成或选择下一个业务动作。

## 权威边界

它不拥有研究、策略、订单、账户、风险或恢复事实。Agent 操作成功只证明本地提交状态，不是 Owner 回执或业务结果。

向某 principal 投影每个有界 Qualification 阶段事实时，Product Edge 都推进不可解引用的保护反馈
观察前沿。后续 Research 与 Qualification 请求必须提交相关前沿和前驱身份，使 Shell 切换 请求改名
或新 TrialFamily 不能静默擦除已经观察到的反馈。

## 交接

历史 ScheduledScanId/Scanner Receipt 的读面仅用于旧契约兼容，不要求新建扫描计划、生成部署提案或将其作为新目标上线前置。
普通找币使用 Market Data 查询与 Agent 宿主分析，无须 R&D job；需要有状态策略观察时登记原生回放，结果遵守准确工件、数据截面、授权与未知状态边界。

研究与生命周期 admission 请求只能通过接收 Owner 的终态回执闭合；已接受 D-only admission 与后续由
R&D 拥有的 D-only Repair Disposition 保持分离。只有 Runtime 的 Generation Application
Receipt 才能把策略显示为正在运行，Governance 授权本身不能证明已运行。

Product Edge 可以请求 Research 工作、独立 Qualification 评估，或准确一个 Strategy Governance 规范生命周期动作：`INITIAL_ACTIVATION`
`PROMOTION` `REDUCTION` `PAUSE` `RETIREMENT` `DE_RISK` 或
`RECOVERY`。

冲突按 `RECOVERY > RETIREMENT > PAUSE > DE_RISK > REDUCTION > PROMOTION > INITIAL_ACTIVATION` 解析；`PROMOTION` 要求无人值守政策，并按自身 evidence key 绑定新鲜兼容的 Capacity View、Performance
与 Exposure 证据。 它可以读取 Research View Portfolio View 探索 Backtest 结果 有界 Qualification Status Summary 每个
ScheduledScanId 的唯一终态 Scanner Receipt，以及有界 Governance Decision View。

Research View 的终态停止只来自 Iteration Decision，只有存在仅选择 `SELECTED_FOR_QUALIFICATION` disposition 才显示 Selection。 Intake
状态保留只写一次的 `NOT_ADMITTED` 或 `ADMITTED` 回执；`EVALUATING` 是 `ADMITTED`
回执加上进行中或未知保护请求派生的摘要，不是 Intake Receipt 状态。

所有负面保护终态只显示为 `CLOSED_NOT_QUALIFIED`，不投影内部 replay、diagnostic、assessment 或 ineligibility 原因。 已提交正向 Eligibility
Fact 以 `QUALIFIED` 取代视图阶段，但不改写先前事实。 Product Edge 直接读取 Scanner Receipt，不保存竞争的 Scanner-owned 投影。
回执显示准确完成状态和一个 expected-set 分支。

已解析分支包含准确 expected observed 与 missing，未解析分支包含权威未解析 disposition observed 事实 missing-members-unavailable
标记和终态原因。 只有完整 `PROPOSED` 回执含准确 proposal members，不完整 `FAILED` 不能宣称集合完整。 Qualification 和
Governance 视图只含公共状态 条件或政策边界 生效区间和类型不透明且不可解引用的已提交事实引用，绝不暴露保护测量 负面原因或评估细节。 通知不是终态证明。

## 禁止事项

它不得让 Dashboard、MCP client 或 workflow 成为竞争业务写入者，不接受自我声明 operator identity，不得用任意 SQL 或
命令绕过 Owner 存储，不调用 admitted manifest 之外的 operation，不暴露 credential，不绕过 Risk
创建订单 批准资格 解引用保护证据，也不得用 Agent 记忆宣告恢复成功。

## 决策契约

- **输入** - 自然语言意图 唯一 active Agent Shell Deployment Binding trusted principal 与 scope
  Operator Authorization admitted Agent Operation Manifest 和有界 Owner 只读模型请求。
- **诊断与决定** - 解析唯一规范 Owner operation 与 semantic payload，再以准确 Authorization Lineage
  提交一个类型化请求，或在任何业务写入前拒绝。
- **冲突解析** - 权威 deployment-history head 和政策等价 active binding 优先；意图歧义 双 Shell 写入
  过期切换 含义改变的重放或 scope 冲突都失败关闭。
- **输出与终态负例** - 请求关联 Owner 回执或有界视图；本地 Shell 成功仍为 `SUBMITTED_OR_UNKNOWN`，
  授权拒绝或 Owner 回执未解析都不能变成业务成功。
- **反馈与经济意义** - 把自然语言转成可归因 可安全重放的产品工作，同时不让 Agent credential 通知
  或 UI cache 成为交易权威。
- **禁止事项** - 不执行无 schema 命令或 SQL 不自签身份 不扩大能力 不写业务状态 不披露保护证据
  不创建订单 不分配资金 不绕过 Risk 也不宣称 Recovery。

## Agent Shell 部署绑定

Product Edge 为每个部署拥有一个非业务 Agent Shell Deployment Binding。 目标 binding 指向规范 `TRADE_PRODUCT_EDGE`
准入网关；在该名字存在之前封存的每条准入仍带着 `WINDMILL_PRODUCT_EDGE`。 App 与 MCP 调用是同一网关后的 channel，不是竞争 Shell writer。 binding 记录选择
generation、有效 principal、scope policy 版本、已批准 Skill/MCP 能力集版本、 审计政策版本和 cutover epoch。

不同 channel 可以使用不同凭证，但有效 principal 与政策必须完全相同； 切换外部对话客户端或 transport 只改变归因，不改变权限。

每次 binding 提交还必须绑定提交前后的权威 deployment history head。只有部署从未存在 binding
历史时才允许 genesis，且必须是 generation 一并且没有 predecessor。历史一旦存在，后继必须以
在准确当前 head 上持久原子序列化，引用已 `SUPERSEDED` 的前驱，generation 只增加一，cutover
epoch 严格递增，并使用历史中从未出现过的 binding identity。零 `ACTIVE` 窗口不会清空 history head。

规范绑定状态只有 `ACTIVE` 和 `SUPERSEDED`，且 `SUPERSEDED` 单调不可逆。 切换期间允许短暂没有
`ACTIVE` Shell，但此时必须失败 关闭且不得向 Owner 提交写请求；同时存在两个 `ACTIVE`、generation 过期或政策不匹配也不得写入。
准确前驱必须先提交 `SUPERSEDED`，以此形成持久请求来源围栏，政策完全等价的后继才能提交 `ACTIVE`。

每个写请求原子读取并绑定权威 history head，且准入要求唯一 `ACTIVE` binding 等于该 head。 已由合法前驱准入的请求保留原 request 与 binding
身份，新 head 生效后仍按该原绑定解析， 不会发生写入重叠或裸重试。 如果其首次 downstream mutation 尚无回执，则只有在直接政策等价 successor 已成为
`ACTIVE`、原始存储 lineage 仍准确匹配且原 Operator Authorization 在 final write cut 仍 current 时才可继续。

零 `ACTIVE` fence 会阻断这种连续性，所有新 admission 仍必须使用当前 `ACTIVE` head。

Product Edge 只读一个时钟。 它检查或记录的每个时刻，即 binding 的 genesis、successor 的激活及其 fence、admission 或 claim 的 read cut 与
final write cut、invocation 的 start，都取自在其自身事务内读取的 `pg_catalog.clock_timestamp()`，从不取自应用进程时钟。 binding 的有效窗口来自操作员，操作员不代
Product Edge 读取任何时钟，因此 genesis 与之后每次 admission 都用同一个时钟比较该窗口。

在 admission 的 cut 上，研究窗口与 R&D Owner 的 `owner_cut` 和投影时间比较，而 R&D 用同一数据库时钟为它们盖戳，因此每次比较的两侧都来自同一个时钟。 研究
View 的 `valid_through` 不属于这个窗口：它是读者的新鲜度，R&D Owner 在它自己的每一次变更上证明该 Research 仍可在其准入时所依据的权威下继续。 Qualification
对其 Owner cut 持有同一权威。

Operator Authorization Issuer 判定或盖戳的一切都读取同一个 store 时钟：授权的签发、撤销、后继与过期 manifest 恢复，以及 grant 的签发、后继与撤销。
授权的窗口在签发时由 Issuer 判定，在 genesis 与每次 admission 时再由 Product Edge 判定；两个判官读取同一个时钟，因此任何时钟偏差都不会让某个窗口对一方 current
而对另一方不是。 每次调用都带 schema 限定，因此经 `search_path` 可达的任何函数都无法取代它。

### 管理员 bootstrap 与控制面 writer

Product Edge 是 deployment binding 与 head、内容寻址 operation manifest、不可变 request admission 及其 outbox 的唯一 writer。
独立命名的 **Operator Authorization Issuer** 是授权签发与 revocation frontier 的唯一 writer。 它是 Product Edge 边界内独立控制面
writer，不是另一个业务 Owner，也不是 Product Edge admission helper。

Product Edge 只能直接解析其事实而不能写入；执行器、API、R&D、配置和持有 token 都不能签发 authorization。

两个 writer 在同一 authority database 使用不同 PostgreSQL role。Request-admission transaction 在写入
admission 前以共享读锁锁定准确 issuance 与当前 revocation frontier；issuance 或 revocation 使用冲突的更新
锁。因此两个 writer 的提交截面可被强制执行，不需要第三 verifier、cache、Event Store 或复制的 caller
assertion。

第一个 deployment binding 只能由显式且执行一次的管理员 bootstrap 创建。 Bootstrap 禁止出现在服务 启动和任何产品请求路径。 它验证完整 binding 与 head
历史为空，要求 expected head 为 `EMPTY`、generation 为一、有限有效区间、内容寻址 manifest 和已预先签发且当前有效的 Operator
Authorization。 Binding、head、 manifest receipt 与 outbox 原子提交。 准确重放加入原字节；含义改变或并发失败的 genesis 尝试发生冲突且 没有部分写入。

后继属于独立管理员 cutover：先提交准确前驱的 `SUPERSEDED` fence，随后且仅随后政策 等价后继才能以 generation 加一成为 `ACTIVE`。

### Store provisioning 顺序

Product Edge store 按两个有序步骤 provision，且都在任何 Owner 连接之前运行：`10-migrate-authority-custody.sh` 创建 Owner 的 schema、核心 relation
及其授权，然后 `product-edge-authority-bootstrap materialize-schema` 创建 Owner 自行物化的 relation（到期 manifest 恢复 epoch 与操作路由历史）。 `connect_existing` 不运行任何
DDL，并以 `TopologyNotAdmitted` 拒绝缺少其十五个 relation 中任何一个的 store。

两个步骤都是幂等的，部署包在每次启动时重跑两者，因此新增 relation 的升级会在任何服务连接之前完成 provision。

### 操作路由

Product Edge 是部署所准入的类型化变更操作的唯一路由权威。 对每个路由 key（部署身份、类型化操作、其版本，以及其请求被封存于其下的准入网关 channel；今天每个准入都携带
`WINDMILL_PRODUCT_EDGE`），Product Edge 维护一段 operation routing binding 历史。 binding 指名对该 key 而言哪个 dispatcher 是新鲜的业务
writer：`WINDMILL`（遗留 effect runner）或 `TRADE_DASHBOARD`（第一方 Dashboard effect worker）。

部署 flag 与凭据从不选择 dispatcher，只有这段历史决定。 key 的 version 就是操作名的 `.vN` 后缀（`research_goal.submit_or_resolve.v2` 的
version 为 2）；version 与该后缀不一致的 key 不指名任何操作，会被拒绝。

binding 记录其 key、generation、前驱 binding（恰在 generation 一时没有）、它提交时所依据的 `ACTIVE` 部署绑定（identity 与
digest）、它路由的 operation manifest（identity 与 digest；该部署绑定必须为此操作与版本准入该 manifest）、其 dispatcher，以及以 store
时钟记录的提交时间。

其 digest 是
`canonical_digest("product-edge.operation-routing-binding.v1", content)`，按此顺序恰好覆盖这些字段：`schema_version`（1）、`key`（`deployment_identity`、`operation`、`version`、`channel`）、`generation`、`predecessor_binding_identity`、`deployment_binding_identity`、`deployment_binding_digest`、`manifest_identity`、`manifest_digest`、`dispatcher`、`committed_at_epoch_ms`。

其 identity 是 `identity("product-edge-operation-routing-binding-v1", [digest])`。 Dashboard 从收到的每个 observation 重算这两者，因此一份共享向量文件为两边实现钉住编码。

路由 key 的历史遵循部署绑定的规则。 genesis 只对没有历史的 key 有效，generation 为一且没有前驱。 每个 successor 都对确切的当前 head
串行化，将其指名为前驱，generation 加一，并引入该 key 从未使用过的 binding identity。 状态只有 `ACTIVE` 与 `SUPERSEDED`，且
`SUPERSEDED` 单调。

撤回 head 会使其 superseded 而没有 successor；此时该 key 有一个零 `ACTIVE` 的 head，下一个 successor 将其指名为前驱。 一旦
binding 所指名的部署绑定不再是该部署的 `ACTIVE` head，该 binding 即为过期；在新部署绑定下的路由需要在其下提交一个路由 successor。 只有显式管理员
writer `product-edge-authority-bootstrap route` 提交路由 binding，每次调用一个 proposal；任何服务启动或产品请求路径都不提交。

在已部署或共享环境中提交 `TRADE_DASHBOARD` binding，是 Dashboard 合同所指名的单独显式效果，本合同不授权它。

读端口是 `GET /v1/operation-routing?operation=...&version=...&channel=...`，带 bearer token，由 `product-edge-routing-read-api` 提供，针对服务所配置的部署作答。 它在只读事务中读取，不取行锁。 当 head 为
`ACTIVE` 且当前时，它以 head binding 与来自 store 时钟的 `observed_at_epoch_ms` 答 `ACTIVE`；当 head
已被撤回时，以 key、generation 与 head identity 答 `ZERO_ACTIVE`。

其余每种情形都是具名拒绝：没有历史的 key 为 `OPERATION_ROUTING_ABSENT`（404），过期 head 为
`OPERATION_ROUTING_STALE`（409），`OPERATION_ROUTING_QUERY_INVALID`（400），缺失或错误的 token 为 `OPERATION_ROUTING_UNAUTHORIZED`（401），store 无法作答为
`OPERATION_ROUTING_UNAVAILABLE`（503）。 Dashboard 只在 dispatcher 为 `TRADE_DASHBOARD` 的 `ACTIVE` 上准入新鲜
`RUN`；其余每个回答在那里都 fail closed。

### 到期 manifest 恢复 epoch

当前到期 manifest 的恢复只适用于已使用该权限存储的入口，不是原生研究任务的准备步骤。恢复绑定原授权前沿、原 deployment head、后继 manifest 内容以及准确目标数据库、PostgreSQL system identifier 和两个不同 Owner role；两端只读回读不一致时不写入。

Operator Authorization 的 OA2 必须先提交或精确重放，Product Edge 才能不可逆围栏 B1 并 CAS 提交 B2。部分完成保持失败关闭；旧请求、授权与事实不改写。相同恢复身份只解析原结果，不能绕过到期、撤销或另开效果。此接口不授予自动恢复、默认 bootstrap、生产写入或交易。

## 封存执行器兼容合同

### 执行器能力合同

本节治理第一方确定性任务执行器；产品入口使用上一节的领域服务合同。
`Capability Adoption` 记录了它每项能力的去向。以下合同约束确定性服务任务和 Dashboard 已准入的效应托管，不引入产品内模型。

| 执行器原语          | Product Edge 角色                                                      | 强制边界                                                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 产品应用            | Dashboard 是第一方用户客户端                                           | 只允许已认证 operator 执行。禁止 public、anonymous 与 publisher 执行，因为它们抹掉调用者的有效权限边界。                                                                               |
| MCP endpoint        | 通往同一组带版本 operation 的可选对话通道                              | scoped token 暴露准确 allowlist，默认拒绝。不得暴露对应用、script、resource、variable、schedule 或 worker 的 preview 或增删改工具。仅靠 folder 过滤不充分。                            |
| 有类型适配器与编排  | Owner port 之上的有类型适配器与有界编排                                | 可以路由、等待、重试与组合；绝不写 Owner 存储、不发明业务状态、不把编排成功变成 Owner 结果。                                                                                           |
| run、进度、日志与流 | 运维 run 身份、实时进度、诊断与 UI 流                                  | 运维 run id、百分比、结果或日志都不是 Owner receipt。运维保留期有界，所以持久研究 artifact 与结果事实留在 Trade Owner。                                                                |
| Schedule            | 触发已准入的确定性数据、回放、报告与维护工作                           | schedule 不是部署注册表、生命周期权威或实时策略运行时。正确性依靠执行器层的错误路径与同请求解析。                                                                                      |
| worker 与负载隔离   | 队列支撑的执行与按准入角色的负载隔离                                   | worker 丢失会让业务结果保持未解析，直到查询接收方 Owner。                                                                                                                              |
| 外部代理工具        | 宿主侧代理经领域 MCP 提交和查询                                        | 产品不运行模型；代理不能直接写 Owner SQL、签发生命周期/风险许可或访问秘密。                                                                                                            |
| 连接配置与 secret   | 有类型连接配置与不透明凭据托管                                         | 执行器的 secret 访问不是 Operator Authorization。最小权限路径是强制的；secret 值绝不进入 prompt、Owner 请求、日志、artifact 或 receipt。                                               |
| 运维状态            | 只保存 UI 偏好与可明确重建的非权威缓存                                 | 禁止存放研究血缘、receipt、Qualification、Governance、Runtime、Risk、Execution 与 Portfolio 真相，含 Execution 拥有的 Recovery 真相。长寿命 artifact 使用 Owner 存储或已准入对象存储。 |
| 部署版本            | 应用及其 operation、schedule 与 resource schema 的 repository‑first 源 | 已部署状态是仓库的投影。晋级要把 Git revision、镜像摘要、schema 版本与回滚目标记录为一个兼容截面。                                                                                     |

Operator UI 可见性不是授权边界。可分发的 MCP profile 默认拒绝：允许的工具只有精选的 Product Edge
operation 加上只读的运维 run 读取。应用与 MCP 调用绑定同一 operation 版本与语义请求；任一通道都不得
部署或编辑它正在使用的 operation。

无人值守执行从规范 due-slot identity 开始，并在第一次调用 Owner 前派生唯一稳定 Product Edge request identity。 retry、worker
restart、timeout recovery 与 manual resolution 复用该 identity 和 meaning。 如果 执行器不能证明 Owner 是否接受调用，run 保持
`SUBMITTED_OR_UNKNOWN`，resolver 查询 Owner receipt； 不得提交裸 successor。

并行或重叠 schedule delivery 只有在 due-slot 与 Owner idempotency contract 汇合到 同一 receipt 时才无害。 Flow error handling
可以通知并排队解析，但只有 Owner receipt 能闭合业务操作。

due slot 只提供 identity，不提供权威。 无人值守提交就是普通的变更提交，绑定同一条完整 Authorization Lineage，其中包括在该次运行自身截面上解析出的、当前有效且不能自我声明的
Operator Authorization。 schedule、 due slot、worker 角色、它的传输 credential 与它的环境都不提供这些成员，因此无法解析出当前 Operator
Authorization 的无人值守运行在第一次调用 Owner 之前就 fail closed，不创建 admission、run 或 provider claim。

**TARGET / NOT_ADMITTED：** 在该授权的签发路径被单独规定并准入之前，无人值守的非交易执行保持关闭； 无人值守交易还额外需要下文定义的 Autonomous Policy
Authorization。

Artifact Formation 除冻结 Research Intent identity 外，还使用稳定 build-request identity 与稳定 attempt identity。 相同语义
tuple 的重放汇合到同一 Owner attempt；任一 identity 被不同语义复用都形成 identity conflict。

穷尽的 Owner disposition 是 `SUCCESS`、`FAILED_NO_ARTIFACT`、`REJECTED_NO_WRITE` 与
`OUTCOME_UNKNOWN`；`SUBMITTED_OR_UNKNOWN` 只是查询状态，不是业务 disposition。 只有 `SUCCESS` 才原子 提交新的不可变
Artifact、Build Receipt、Artifact Review 与 `ARTIFACT_AVAILABLE` projection；其他处置 均不产生 Artifact。

commit 后响应丢失会解析到准确回执，commit 前 timeout 只能以 unknown 且无 Artifact 闭合。 App 与 MCP 调用同一个带版本 Formation operation，绝不以运维
run state 代替它。

Product Edge 只有在规范 authorization、deployment binding、manifest 与 admission 锁全部持有后，才会在第一笔写入前立即采样
request-admission commit cut。 四项权威必须在同一个半开 cut 重新验证，该 cut 同时绑定 admission identity 与 receipt。
如果锁等待期间跨过到期边界，请求必须零写入。

Product Edge unavailable 或 storage unknown（包括 admission custody 可能已存在）必须返回 `SUBMITTED_OR_UNKNOWN`，且只有
`RESOLVE_SAME_ATTEMPT_IDENTITY`；绝不能转成 `REJECTED_NO_WRITE` 或 successor 权威。

Provider invocation claim 本身是持久且一次性的 custody。若 claim 已提交但响应丢失，同 attempt 解析必须返回准确 `CLAIMED` claim 与唯一动作 `RUN_BOUNDED_EXECUTION_AGENT`。App 与脚本随后只能启动这一个既有 claim 一次；不得创建 successor claim 或第二次调用 provider。进入 `INVOCATION_STARTED` 后，除非已有权威终态 Owner receipt，否则唯一安全投影是人工 provider 对账。

#### 来源接入与组合验收

来源接入、R&D 编写与回放必须通过当前服务合同组合验收。固定语料或隔离数据库通过，只证明该有界链路，
不证明 provider 真实性、默认部署、外部效果、Paper/Live 或交易可用。验收隔离 executor、数据库、网络与 volume，
清理后证明原基线未变；同身份响应丢失和重启应恢复相同回执，不能重新执行已完成的副作用。

#### 封存 Source Intake-to-Composer 兼容合同

现有 Source Intake/Composer 读口可解析其已经封存的身份，但不属于原生策略研发的必经路径。原生路线使用 Agent 来源引用、R&D 项目与 Git Strategy 包，不建设 A0/A1/A2、ProgramHost 或双重构建链。

已有兼容消费者继续要求准确来源绑定、请求与含义相等、唯一 Owner 写入、事务内回执及 outbox 原子提交、重启后同身份回读。缺失或冲突不产生正向结果；历史字节不改写、legacy quarantine 不回填。现有拒绝和密封只约束实际兼容入口，不能凭本页准入新 Composer、provider 调用或交易。

## 实现验收

切换外部对话客户端或 Product Edge transport 时必须保持相同的有效主体、权限范围、能力与审计政策 和 Owner 权威规则。 测试必须证明只选择一个准入网关、允许失败关闭的零活动切换窗口、前驱先
`SUPERSEDED` 后继再 `ACTIVE`、取代不可逆、双写或政策漂移被拒、每个请求按准确权威 head 准入， 以及所有已准入在途请求身份被保留。 Dashboard 与
MCP 测试还必须证明相同语义请求到达相同带 版本 operation 与 Owner 回执，不兼容客户端在业务写入前失败关闭。 每个写操作都有类型 可归因 可安全重放且绑定接收 Owner 回执。

Qualification review 复用 Candidate Intake Receipt 作为关联请求终态回执，并独立于有界状态视图返回它。 仅含义相同不能加入 Candidate 尝试 状态
结果或身份不同的回执。 Research 与生命周期接受回执绑定准确结果事实，拒绝回执证明没有写入。 Runtime 在证明 `APPLIED` 或 `REJECTED_NO_INSTANCE`
前必须显式保持 `APPLICATION_UNKNOWN`。 自然语言存在歧义时必须在业务写入前失败关闭。

只读模型测试必须证明每个视图保留稳定请求 principal scope 授权政策截面 来源 Owner 来源截面
observed/projection time 新鲜度 valid-through 和明确可用状态；拒绝混合截面 过期政策 冲突重放和未授权
scope；并证明保护 Qualification 细节 Risk headroom 或授权不能进入任何投影。

Dashboard 读取已准入页面需要的有界 Owner 和 RunStore 投影；页面确需全局状态时才可增加可重建投影，
保留 projection 版本、来源 frontier、新鲜度与完整性，不以全局聚合服务为前提。过期、部分、重建中或不可用
视图必须保持明确非当前。Dashboard 中任何可能改变 Owner 的动作都要转成新的 typed 且独立授权的
Product Edge 请求，绝不能直接写入 projection。

切换测试还必须拒绝历史存在后的伪 genesis 过期 history head 重用 binding identity 不递增的
generation 或 epoch，以及并发竞争同一 head 时除唯一序列化获胜者以外的所有后继。

安全测试还必须在提交前拒绝错误 issuer audience subject scope expiry revocation frontier proof digest manifest operation
schema 或 target Owner，并证明任何 Shell 都不能扩大已准入 operation。

Lineage 测试必须证明每个已接受生命周期决定及其最终效果与回读都解析到同一 request principal scope 已准入 Shell binding 与 history head Operator
Authorization operation manifest 和授权模式；无人值守 lineage 还必须解析到同一 Autonomous Policy Authorization。
任一必需成员缺失或不匹配时必须在新增风险前失败。
