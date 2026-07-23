---
title: User Story
role: product-contract
status: active
owner: product
last_verified: 2026-07-23 CST
---

# 用户故事

## 1. 使用边界

用户配置策略、权限、风险底线与可选 Agent Host，program runtime 按 cadence 推进工作；用户主要在阻断、异常和复盘时介入。在线动作始终复用同一套 event、preflight、execution 和 reconcile 合同，不因 scheduler、Codex、OpenClaw、LangGraph 或人工触发而改变权限。

本文只描述产品可观察行为。具体命令、字段和 Guard ID 分别以 `toolset.json`、owner module `CONTRACT.md`、[Event and Flow Contract](../runtime/event-flow-contract.md) 和 [Risk Control Contract](../runtime/risk-control-contract.md) 为准。

## 2. 用户需要理解的对象层级

```text
Strategy Universe
  -> taxonomy / 大类
  -> family / 机制族
  -> strategy version / 具体策略文档
  -> setup / 一次机会
  -> flow / 一次暴露生命周期
```

| 层 | 用户视角 | 例子 | 与代码的关系 |
| --- | --- | --- | --- |
| 数据 / indicator | 策略可读取的事实或特征 | OHLCV、funding、ATR、L2 imbalance | 由数据 / 指标实现提供 |
| Strategy Universe | 全部可研究机制的地图 | trend、mean reversion、carry、relative value | taxonomy 本身不执行 |
| strategy family | 地图中的稳定机制身份 | time-series momentum、breakout-retest | 可以尚无代码；coverage status 说明实现到哪一层 |
| family implementation | 某 engine / release 对 family 的实现 | Replay family module、panel scorer | 这是代码，但不等于 family 本身 |
| strategy version | 一份冻结的 MD policy、机器合同、证据与 implementation binding | BTC 4H long、lookback=20、stop=2 ATR | 编译后运行；不执行整篇 MD |
| setup | 某版本在某 symbol 上出现的一次机会 | 本轮突破回踩成立 | 由策略版本判断或提出 |
| flow | setup 引发的一次订单 / 暴露生命周期 | 从计划、成交到平仓复盘 | 绑定精确策略版本 |

`strategies/*.md` 是“可读策略源文档”：叙事段供用户 / Agent 理解，`## Trade Contract` 是机器可编译部分。多数 R&D candidate 可引用已有 family implementation 并只冻结参数 / 合同；只有缺少 signal、portfolio、data 或 execution implementation 时才产生代码 patch。MD 与代码不做无损双向翻译：MD 编译为运行合同，代码用 capability / version manifest 说明自己实现什么。

## 3. 核心故事

### US-01 周期开始但没有可执行机会

- 系统读取 runtime health、账户、订单、持仓和必要市场事实。
- 没有合格 setup、事实不新鲜、cadence 未到或 guard blocked 时，结果必须是可解释的 `no_action / skipped / blocked`。
- 不得为了让周期“有产出”创建订单、研究任务或新 flow。

验收：用户能从 summary / refs 看出谁跳过、为何跳过、是否需要介入。

### US-02 慢轨识别新 setup

- 慢轨先用全市场粗筛寻找值得深入观察的 symbol，不为整个市场无差别拉取高频深度。
- 晋级候选可以声明短期 L2 需求；已有 active flow、挂单和持仓声明更高优先级且持续到安全释放的数据需求。
- Runtime 与 R&D 对同一 symbol / coverage 的兼容需求应由 Market Data owner 合并；候选过期、被淘汰或调用方退出后释放短期需求，不让僵尸租约长期占用容量。
- Market Data owner 负责订阅、重连、epoch、落盘和 readiness；慢轨不能直接控制 L2 进程，未 ready 时只能等待或 `no_action`。
- 慢轨可以形成 thesis、entry、stop、invalidation、risk budget 和 action intent。
- 同一 `strategy_ref + symbol + side` 同时最多一个 active flow；旧 flow 未闭合时，新理由必须并回旧 flow 或等待闭合。
- action intent 只是待裁决意图，不是 exchange write 授权。

验收：新 flow 有稳定身份、输入 refs、完整 plan；缺一项即不得新增风险。

### US-03 快轨守护已有意图

- 快轨只消费 active flow 已冻结的意图、最新事实和 policy snapshot。
- 它可以触发已授权动作或做 reduce / cancel / protection 等防御动作；不得新建 thesis、扩大授权范围或改写 risk budget。
- spread、depth、funding 等尚未统一进入 preflight 的能力只能作为事实、warning 或策略约束，不得伪装为已执行的硬门。

验收：每次执行能回指慢轨意图；没有授权时只能阻断或减风险。

### US-04 执行新增风险

- strategy / setup 具备 `live-small` 权限，runtime 未被 kill switch / risk lock 阻断。
- 同时出现多个合格 setup 时，先在账户级比较现有 exposure、相关性、总风险和可用资金；单个 setup 通过不等于全部都可执行。
- facts、plan、policy、preflight verdict 和 execution contract 均完整且 fresh。
- exchange write 必须显式授权、幂等，并在提交后确认或进入 reconcile。
- submit 不等于成交；只有 fill / reconciled fill 改变 position。

验收：任何真钱动作都能回答“基于哪次 observe、哪项 policy、哪次 verdict、哪份 execution contract”。

### US-05 管理挂单和持仓

- 周期先以交易所事实校对本地 projection。
- 继续等待、撤单、保护修复、减仓、平仓或加仓都形成新的事件事实；不得覆盖旧计划或旧结果。
- 加仓属于新增风险，必须重新完整 preflight；明确的减风险动作在 safe mode 下仍可进行，但必须审计。

验收：重跑不会重复下单，未知订单或无法归属持仓会触发 risk lock。

### US-06 对账失败

- owner recovery 尝试用账户、订单和成交事实恢复缺失事件。
- 无法可靠归属时进入 `unknown / needs_review`，停止新增风险，不猜测填充历史。
- 用户可以在交易所确认事实或修复配置；恢复仍通过正式 owner 入口写入。

验收：风险锁解除前只有 observe、review 和明确减风险动作可继续。

### US-07 flow 闭合并复盘

- flow 闭合后生成量化结果、成本、执行归因和最小定性结论。
- review 区分 thesis、data、execution、guard、cost 和 process 问题。
- 单笔 review 可以提出 hypothesis 或 policy feedback，但不能直接改策略、改历史 verdict、自动 promotion 或仅凭一次亏损退役策略。
- 聚合 review 只有在最小独立样本、时间跨度、regime coverage、成本完整度和 execution attribution 达到该决策所需成熟度时，才可触发 Governance 的 keep / observe / pause / retire 或 improvement request；否则继续观察。
- 改进必须进入 R&D 并形成新版本；旧版本和历史 flow 不被回写。

验收：同一 lane 的下一次独立机会使用新 flow，旧 flow 保持可复读；lifecycle decision 能回指精确策略版本、成熟样本和 review evidence。

### US-08 研发候选策略

- R&D Factory 在后台长期寻找可证伪问题、生成或修改候选、回测、评审并推进 forward / shadow 验证。
- 每个 Campaign、Agent Run 和 Trial 仍在冻结的 hypothesis、dataset split、局部预算和 execution assumptions 下运行；一次局部预算耗尽或失败不会永久停止 Factory。
- Planner 可以消费带精确 citation 的论文 / 研究 finding，也可以从失败、closed-flow review 和 improvement request 形成 hypothesis；来源依据与实验依据必须分开显示。
- discovery、validation、locked holdout、negative control 与失败结果都留下权威记录。
- Replay / Forward 产生 evidence；governance 决定是否物化 draft、进入 shadow 或允许 live-small。

验收：研究任务不能写在线交易事件，不能调用 Binance write，不能自动升格；Factory 重启后从 owner state 继续，而不是依赖 Agent session 或聊天记忆。

### US-09 用户调整配置或策略

- 配置只控制权限、上限、成本假设和启用范围；不能重写策略 entry / stop / thesis。
- 策略变更使依赖旧版本的证据 stale，需要重新验证。
- 放宽风险底线必须是显式配置 / governance 变更，不得在一次 blocked verdict 上临时覆盖。

验收：新配置从下一次编译 policy snapshot 起生效，历史 snapshot 与 verdict 不变。

### US-10 切换 Agent Host

- 用户可以按任务或部署 profile 选择受支持的 Agent Host，而不迁移 strategy、trade、research 或 governance 状态。
- 每个 Host 看到同一组 allowlisted owner capabilities；Host 私有 session、checkpoint 和 memory 不得补写领域事实。
- 切换前后使用稳定 request identity、prompt/toolset version 和 result validation；未完成任务不能被当成成功接管。

验收：相同只读或 proposal-only 任务可在候选 Host 上回放比较；关闭旧 Host 不影响确定性 program job。

### US-11 常驻程序请求语义任务

- job 只有在确定性代码无法完成、且 task type 已登记时，才提交有 deadline、token/tool budget、输入 refs、输出 schema 和 approval policy 的 Agent run。
- Agent 只能返回 validated proposal、artifact/ref 或明确的 `blocked / retryable / no_action`；不得直接改变 owner state。
- Planner / Reviewer 默认只读；Developer 的代码执行是策略研发能力，不是通用 Host 权限，必须在冻结 revision、无凭证、默认无网络、有资源上限的隔离 worktree / sandbox 中运行，并通过私有 MCP 调用受控 owner 能力。

验收：每次语义任务都能追到模型、Host、版本、预算、tool calls、审批和最终验证；超时或非法调用 fail closed。

### US-12 Agent 或 provider 故障

- Host/provider 退出、限流、超时或重启时，依赖语义能力的 job 进入可恢复状态，不伪造结果、不重复副作用。
- L2、账户对账、risk lock、保护与其他确定性 job 继续运行；只有其自身 owner health 可以阻断它们。
- 恢复后按稳定 identity 继续、重试或人工取消，不能依赖聊天记忆猜测先前进度。

验收：kill/restart 与重复投递测试中最多形成一个 owner effect；无法确认时保持 blocked 并要求审阅。

### US-13 远程容器长期运行

- 用户在单台远程 Linux 主机启动受版本约束的 runtime profile；L2、control/owner 与 Agent Host 具有独立 health、restart 和 volume。
- L2、OHLCV 补数、指标刷新、快慢轨和 R&D cadence 由 Program / owner 推进，不依赖用户保持 Codex 会话。
- Agent Host、provider 或 MCP 故障只阻断对应语义任务；容器 alive 不得被当成 owner/data ready。

验收：主机或单容器重启后，系统能从 owner store、epoch、watermark 和 lease 恢复；不靠 Agent transcript 补业务事实，也不重复 Trial、Result 或交易 effect。

### US-14 开发、评审与退役策略

- Planner Agent 基于 Control Plane context 提交 Proposal，Developer Agent 基于 admitted brief 提交 Contract Draft，Reviewer Agent 基于已登记 evidence 提交 Review Decision。
- 当某 family 已有满足目标 engine 的实现时，Developer 只产生受约束的候选参数 / 合同，不为每个策略生成任意 Python 或 TypeScript；Registry 从正式接受入口物化冻结策略版本。
- family 可以合法存在但尚无 Replay / Runtime 实现；此时 Developer 在每 Run 的隔离 worktree 中读取和修改 MD、implementation 与测试，调用 owner 请求 Replay，依据失败 artifact 继续修订或明确终止。patch 只有通过 CI、code review、release 和新一轮研究后才能形成新的 implementation / indicator / execution 能力，不能热改生产。
- Control Plane 拥有 validate/freeze/Trial/Result 和 decision writeback，Replay owner 执行回测，Strategy Registry 只从正式接受入口物化 Draft。
- 机械 Replay 只执行 compiled contract 与冻结 implementation；需要 Agent 判断的 MD policy 使用显式 Agent-assisted historical evaluation / Forward 合同，冻结 model、prompt、toolset 和事实切片，不能冒充机械 Replay 或单独升格。
- Governance 可以将策略保持或迁移为 `draft / shadow / live-small / paused / retired`；`retired` 版本保留证据但不得产生新 setup、forward 或 live 动作。
- 退役不遗弃既有挂单或仓位；快轨、reconcile 和减风险路径继续管理其已存在的 exposure，直到安全闭合。

验收：Developer 能完成“读策略与代码 → 修改 → 测试 → 请求 Replay → 读取失败 → 二次修改 / reject”，且只能交付 patch、typed submission 与 evidence refs；Agent 不能越过 owner 落地策略或改变状态。被 retire 的版本在所有 program lane 中 fail closed，恢复其思想需新版本和新证据。

## 4. 深挖出的跨闭环故事

### US-15 多个机会竞争同一账户

- 慢轨可以同时产生多个通过单标的资格的 setup，但 Capital Allocation 必须在账户级统一排序、缩放、互斥或拒绝。
- 分配必须考虑已有仓位 / 挂单、相关暴露、组合风险、流动性和本轮其他候选；顺序执行不得让先到候选偶然吃掉全部预算。
- 分配结果冻结后，每个获批 intent 仍独立走 fresh preflight；一个候选失败不伪造其他候选已执行。

验收：用户能看见“策略看对但组合未分配”的 `no_action`，并能回指同轮候选集与账户级裁决。当前缺口：已有 `CapitalAllocationProposal` 语义，跨候选账户级仲裁尚未闭环。

### US-16 磁盘压力触发自治 GC

- Program 平时就维护容量预算和分类账，不等磁盘告急才由用户手工找文件。
- 后台 GC 可以自动删除已过 retention、无 ref / pin、可重建的 cache、tmp 和中间 artifact；任何 active flow、待运行 Trial、冻结 dataset、review evidence、durable store 与未闭合 incident 都受保护。
- 对未知或异常大文件，Agent 可以扫描上下文、解释用途并提出候选；真正删除仍由文件所属 owner 依据 lineage、reference closure、pin、retention 和 release gate 确定性授权，Agent 不能凭自然语言直接删除。
- L2 raw 必须先完成 segment finalize / compaction、所有 consumer 引用闭包和 retention release，才可进入专属 GC；通用 artifact GC 不得越权删除 raw。
- soft watermark 先加速 GC / compaction、缩减 cache 并延后低优先级新增采集或研究写入；回收后重新测量。只有回收失败且达到 hard safety line 时，才局部停止新增非必要写入和新增风险，reconcile、已有 exposure 的保护 / 减风险和证据保全继续。

验收：空间从软水位恢复无需用户介入；每个删除结果都有 owner、reason、bytes、引用审计和可重建依据，误删受保护数据的测试 fail closed。当前缺口：artifact GC 已有 ref / pin / durable 保护但默认人工确认；L2 raw release authority 和 program-owned 自动回收尚未完成。

### US-17 新想法决定“配参数”还是“写代码”

- Developer 先确定 hypothesis 在 Universe / family 中的机制身份，再检查目标阶段所需的 data、Replay、portfolio、signal 和 Runtime implementation coverage。
- 若已有实现可执行 MD 中的机器合同，只生成冻结候选合同并进入 Trial；不得把代码生成当作每个策略的默认步骤。
- 若 family 已存在但实现不足，形成 code capability request；若机制本身不同，先新增 / 评审 family identity，再开发实现，不能用新代码偷偷改变旧 family 含义。
- 若策略保留只能由 Agent 判断的语义条款，必须标为 Agent-assisted contract：Program 提交有界语义任务，Agent 返回 typed proposal。它不能冒充 deterministic strategy，也不能沿用不匹配的 Replay 证据。

验收：用户能从 blocker 看出缺的是 family 设计、数据、参数合同、Replay implementation、Runtime implementation 还是 Agent policy runner。当前缺口：已有 Universe backlog、静态 R&D family registry、MD compiler 和隔离 patch 边界，但 coverage assessment、Agent-assisted execution 与 release handoff 尚未统一。

### US-18 发布新代码时旧 flow 继续按旧版本运行

- strategy version 必须绑定 MD source hash、compiled contract hash、可选 family identity、implementation / Agent policy binding、数据与执行假设以及 release identity；observe、intent、execution、review 均继承该绑定。
- 新 family release 或策略改进只影响新版本和新 setup；已有挂单 / 仓位继续按其冻结版本管理，除非独立风险 policy 要求减风险。
- 旧 release 被移除前必须证明没有 active flow、恢复任务或待复读 evidence 依赖；否则保留兼容执行能力。

验收：部署发生在持仓期间仍可回答“这个 flow 由哪份 MD、哪份编译合同、哪份实现或 Agent policy 管理”，且不会被新版本重新解释。当前缺口：`strategy_ref`、policy / contract hash 已部分存在，完整 implementation binding 及旧 flow 兼容回收门尚未闭合。

### US-19 Runtime 与 R&D 共享数据但互不挤占

- Market Data owner 合并相同需求并记录各 consumer 的 coverage、优先级、租约和 release 条件；共享一份 source 不复制成多份事实。
- active exposure / reconcile 的新鲜数据优先于普通候选和可延期研究；R&D 已冻结的历史 source 不因在线需求结束而被回收。
- 容量不足时先驱逐已过期、可重建、低优先级数据，不以静默降采样或删除已引用 source 假装服务正常。

验收：每个订阅和保留对象都能回答“谁需要、需要到何时、何时可删”；调用方退出不会遗留永久需求。当前缺口：L2 当前仍是固定单 symbol，尚无正式 demand reconciliation。

### US-20 策略工厂长期工作但不形成失控积压

- Factory 按 ready dependency、预期信息增益、组合缺口、资源成本和治理优先级选择下一项，不以队列先来先服务等同产品价值。
- 同一 family 的相似 hypothesis 要去重；等待数据、代码 release、forward 样本或人工审批的工作进入可恢复等待，不占用活跃 Agent / Trial slot。
- 失败、rejected mechanism 和已知低价值搜索空间反哺 Planner；Factory 可以持续工作，但每个 Campaign / Agent Run / Trial 仍有局部预算和终态。

验收：长时间运行后不会重复开发同一想法、饿死高价值 improvement request 或让 blocked 工作占满并发。当前缺口：program terminal 尚未拆成长期 Factory 与局部终态，跨来源优先级 / 去重仍待实现。

### US-21 市场候选在深化期间失效

- 候选等待 L2、Agent 分析或账户预算期间，Runtime 持续检查 setup TTL、symbol tradability、数据 freshness 和 invalidation。
- 候选失效后撤销未获批 intent、释放短期数据需求且不创建空 flow；若已有 exchange effect，则转入正式 reconcile / flow 管理。
- 新上市、下架、暂停交易或合约规则变化先更新 instrument facts，再决定是否允许研究或交易。

验收：等待不会把旧机会变成迟到订单，symbol 状态变化不会靠 Agent 常识猜测。当前缺口：粗筛和单标的链已存在，候选租约 / 失效与 instrument lifecycle 的跨 owner 闭环仍待实现。

## 5. 深挖结论

上述故事将产品缺口收敛为六条横向能力，而不是继续堆独立 Agent 或 tool：

1. 账户级候选仲裁与精确版本归因。
2. Market Data demand、优先级、租约和安全释放。
3. owner-authorized 自动 GC 与 L2 专属 retention release。
4. review 成熟度、lifecycle decision 与 improvement 回流。
5. family capability assessment、代码 release 和旧 flow 兼容。
6. 长期 Factory 的优先级、去重、等待和局部预算。

## 6. 人工介入优先级

出现异常时，用户依次判断：

1. 是否需要先在交易所减风险或确认事实。
2. 是否是 transient API / scheduler 故障，可安全重跑。
3. 是否需要修复 config、strategy 或 owner 数据。
4. 是否形成 control review / R&D lesson。

禁止直接编辑 durable DB 制造“已恢复”状态。

## 7. 非目标

- probe / 日内高频、做市、hedge 多腿组合。
- 多账户、多交易所、自建通用聊天 UI / SaaS。
- 人工逐笔聊天式下单作为主路径。
- 依靠固定唤醒分钟、某个 prompt 或未实现 Guard ID 定义长期产品合同。
- 把 Codex、OpenClaw、LangGraph 或任何模型 provider 固定成不可替换的业务 authority。
