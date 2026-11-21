# 0.5.0 破坏性大版本：修复、清理与架构调整计划（2026-11-21）

上接[第三轮瘦身计划](slimming-round-3-20261121.zh.md)。那一轮的判定隐含“改后旧数据与旧运行照常可用”的前提；本版不再有这个前提，所以按新前提重判了全部条目，本文件是本版的执行依据。之后的 [0.5.0 全量重判](rejudge-0.5-20261121.zh.md)（#3303）又把八类来源里所有被否、暂缓与未判的提议过了一遍；它改判的项与第三波见文末“重判后的同步”。

## 用户的决定

- 2026-11-21：「还有我很关注的大清扫 可能Gemini回答的不对或随意 但需求是真需求 这次所有修复都完成发的是大版本 我们又会清空数据库 重跑的 可以激进策略清理技术债和做一些架构优化补充大改动的」
- 2026-11-21：「包括之前所有被拒绝gemini提议也过一遍 因为大前提变了 这个是大版本更新」
- 2026-11-21：「需要我定的部份最后也是一样由你决定按推荐做」——本文件里标“Claude 决定”的条目都据此决定，包括改拒绝或审计检查、新增存储字段与发布机制改动；每个新增存储字段仍先做独立评审并在本目录留记录。
- 2026-11-21（D-160）：「Live 首次试运行的 100 USDT 上限 这个删掉啊 实际live运行不是依据用户账户可以用的合约资金来的吗」——删去现金底线不超过 100 USDT 的准入检查；现金底线仍是首次武装时 USDT 钱包的 85%，3 倍权益入场上限（`LIVE_BUDGET`）、`LIVE_FUNDS` 与回撤刹车不变。
- 仍归用户本人：打版本标签、启动 Live 运行与下单、凭据、切换时新建活动账本。

## 前提

- 版本 0.5.0，破坏性：研究账本、Paper 库与 Live 私有记录从空开始，代码不读、不迁移任何旧格式（AGENTS.md：1.0 前不兼容）。
- 升级时 Live 空闲（发布准入已在账户锁下检查）。
- 不变的约束：Nautilus 管订单、成交、风控与账户；账本只经 `python -m cli.main` 写；Overview 保持 Node；K 线 `E` 字段的 WebSocket 保留（Nautilus 丢 `E`）；改变回放行为的改动做配对原生验收（`engine/README.md`）；技能文字改动按 `.agents/README.md` 跑评测。

## 依据

四份分区清理审计（执行侧；数据与研究核心；部署、IDE 与 CI；测试、评测与文档）、Gemini 全部被否提议的重判、Gemini 2026-11-18..21 全部会话的缺陷覆盖核对与 11-18 以来的生产日志审阅，均在 `origin/main` `38fe2b741`..`b7ab9b3af` 上只读完成。各审计的结论摘在下文对应条目里。

总体量化结论：Gemini 估计的“代码减半”不成立——死代码几乎为零（vulture、knip），复制粘贴率很低（Web 0.26%），Paper 与 Live 真重复约 150–190 行，发布流程已接近最小。真正的赘肉是：结构性私有名互调（112 处）、market 内部 20 条导入环、同一事实多处各推一遍（Web 持仓 8 处、注册表清零 3 份）、按进程数而非内存的读取限流，以及约 1.3 万行可删或合并的文档。

## 本版修复的缺陷

| 缺陷 | 来源 | 状态 |
|---|---|---|
| 生产 Web 11-19 内存超限 9 次（单次读取 385–440 MB，`READS = 3`），读取直接失败 | 生产日志；20261116-01 复发 | 已合入 7b41fbdc8 [#3256](https://github.com/qOeOp/trade/pull/3256)：按容器内存准入；上线后读一周超限日志（[重判](rejudge-0.5-20261121.zh.md) A-91） |
| 未登录客户端每 2 秒请求一次、持续 3 天（oauth2 拒绝约 15 万次） | 生产日志 | 已合入 [#3258](https://github.com/qOeOp/trade/pull/3258)：登录过期后停掉全部轮询并提示登录 |
| Live 失败记录的合约恒为 `unconstructed`；结束时不补写失败计数 | 执行侧审计 | 已合入 8a653e334 [#3267](https://github.com/qOeOp/trade/pull/3267)（E1） |
| Progress 柱点击不选中版本；手机 Paper 多持仓时只显示第一个合约的 mark；关线热力格斜线丢失；命令行接 `\| head` 报 `BrokenPipeError` | Gemini 会话覆盖核对 | 已合入：[#3257](https://github.com/qOeOp/trade/pull/3257)、[#3259](https://github.com/qOeOp/trade/pull/3259)、[#3261](https://github.com/qOeOp/trade/pull/3261)、[#3253](https://github.com/qOeOp/trade/pull/3253) |
| Paper 遇主机卡顿即结束运行（#3234）未进 v0.4.4 | 生产日志 | 已在 main，随本版发布；发布前不在远端新开 Paper |

## 执行项

“授权”一列：无 = 不需要；Claude 决定 = 按上文委托决定；用户 = 仍归用户。“验收”一列写证明没有回归的方式。

### 执行侧（engine、live、paper、runtime）

| id | 内容 | 净行数 | 验收 | 授权 |
|---|---|---|---|---|
| E1 | `strategy_runtime.begin_run(output, served)` 统一清零全部注册表并设 `FAILURE_PATH`，回测、Paper、Live 各调一次；Live 登记 `STRATEGIES`、结束时 `write_failures()` | −15 | 配对原生验收；Live 单测 | 无 |
| E2 | `history.read_until(fn, deadline, retry)`，收拢 history、Paper Holder、metrics 三处后台读取重试 | −30 | 与 E1 同一次配对验收 | 无 |
| E3 | 删无人读取的 `ledger/paper.py` `READINGS`、`engine/config.py` `INTEGRITY_CODES`、`warmup.EXPORTED` | −15 | 与 E1 同一次配对验收 | 无 |
| E4 | `runtime/image.py` 单键版本注册表改常量，直接引用 `engine.config.RUNTIME_SOURCE_PATHS` | −40 | 单测；`runtime inspect` 探针 | 无 |
| E5 | Paper 运行器：`FETCH`、`READ_METRICS` 进 `PaperInputs`；Recorder 直接 `add_actor`；`NATIVE_EXECUTION_FAILED` 构造不变式保留 | −20 | Paper 工程试跑 | 无 |
| E6 | 实时侧小件：`redis_child.config(port)` 合并两份 `NativeConnection`；`engine/signals.py`；`node_base()`；`Cadence.wrap`；`METRICS_VALUES` 引用 `metrics.ENDPOINTS`；每月成员文件写入收进 `market.universe` | −45 | `test_live*`、`test_stream`；Paper 工程试跑 | 无 |
| E7 | Paper 与 Live 行情证据统一为一种格式（`engine/realtime.market_rows`），合并两个 `run_record`，删 `live/compare.py` 适配器与 `received_warmup`；Live 证据包改写预热摘要行 | −220..−280（含测试） | Paper 工程试跑后 `paper compare`；Live 伪造证据包 `live compare` | Claude 决定（Live 新增一种存储行，先做字段评审） |
| E8 | Live 请求日志去掉“已认领但结果未知”一层、按 `request_id` 幂等 | 约 −950（含 IDE 与测试） | 先做只读设计评审；通过才实施 | Claude 决定（删 `LIVE_REQUEST_*` 拒绝码），以评审结论为准 |

不做：Paper/Live 并核重写（差异是本质的）；全局改依赖注入；删 `runs.earlier()`（每次破坏性升级跳过旧格式运行要用它，删了会复现 20261114-01；改为清空 Live 私有 `runs/` 属删除执行记录）；合并 Paper 与 Live 的 Redis 持久化（语义刻意不同）；压缩 `live/notify.py`（大小与职责相称）；换第三方 WebSocket 库（改变回放身份，价值低）。

### 数据与研究核心（ledger、registration、replay、report、market、cli、shared）

| id | 内容 | 净行数 | 验收 | 授权 |
|---|---|---|---|---|
| D1 | 用户 11-14 批准、延到下一代 schema 的三处：删 `run_reading.computed_at`；`trial_instrument.instrument_id` 改名 `symbol`；`trial_capture.table_hashes` 改为 `run.fingerprints` 的形状 | −15 | 单测与 Dolt 集成测试 | 已有（11-14） |
| D2 | `shared/clock.py` 收拢时间换算（3 个 `_months`、2 个 `_month_end`、3 个 UTC 解析、`series._day_ms` 30 处调用） | −60..−80 | 固定市场日导出逐字节相同（`export_sha256` 相等） | 无 |
| D3 | market 改用 `shared.errors.Refusal`，删 `MarketError`（码与条件不变） | −40 | 单测；进程池内触发一次拒绝 | 无 |
| D4 | market 四条导入流水线共用 `store.import_contracts(...)` 骨架，返回结构统一 | −60..−90 | 临时市场导入一个月，文件哈希改前改后相同 | 无（返回 JSON 变化，写进 CHANGELOG） |
| D5 | 拆 market 内部导入环（`CYCLE_EDGES` 只删不加） | ±0 | 分层测试 | 无 |
| D6 | `ledger/server.py` 从 `db.py`（934 行）拆出 Dolt 服务管理，消掉 `_admin`、`_known_service`、`_binary` 等私有互调与两份 config.yaml、三份就绪等待 | −50..−80 | Dolt 集成测试；compose 首启探针 | 无 |
| D7 | CLI 表驱动：每条命令一次声明（handler、选项、契约），`set_defaults(run=…)` 分发 | −350..−450 | 全部命令 `--help` 与 `--version` 快照改前改后相同；`skill-names.py` | 无 |
| D8 | `derive_measures` 只算请求的度量 | ≈0 | 抽样 `research status` JSON 相同 | 无 |
| D9 | 报告读时派生各出场类别净盈亏（`exit_net` 不再丢弃），不存储 | +20 | report 单测 | 无 |
| D10 | `registration/seams.py` 里的产品逻辑移到 `registration/runner.py`，seams 只留可替换部分 | −15 | 单测；分层测试 | 无 |
| D11 | 派生候选文件头的职责行与 `changed_duties` 对账，不一致则 `registration add` 拒绝 | +60 | 拒绝路径测试 | Claude 决定（新增拒绝） |
| D12 | 删过时 docstring（`report/attribution.py` 的 merge3 与四角交互） | −3 | — | 无 |

不做：删读时第二次经济对账（`CYCLE_*_MISMATCH`，省 20 行不值得少一道审计）；合并 `comparison_design`、去掉 trial 冗余身份列或生成列（它们是数据库层检查）；FORMAT 标签统一重置（无行为收益）；封存时存读时度量（违反“能推导的不存”）。

### 部署、IDE 与 CI

| id | 内容 | 净行数 | 验收 | 授权 |
|---|---|---|---|---|
| R1 | Web 读取按内存预算准入、按读取类别计价，轻读不排在重读后；`/api/about` 按账本 head 缓存；读子进程不经 `uv run` 并设 `oom_score_adj=1000`；Overview 堆封顶 | +100（含测试） | 负载探针（1.5 GiB cgroup 并发 10 个读取无超限）；`test_serve` | 无 |
| R2 | research_graph 两个队列合一、8 个缓存合成一个按字节封顶的 LRU、两条“不重画”路径合一 | −550（含测试） | `test_serve`；页面明暗截图 | 无 |
| P1 | 删只为旧主机状态存在的分支（`requires_live` 与“没有配对控制的主机”） | −105（含测试与 README） | deploy 单测 | 无 |
| P2 | 提交后直接停掉旧 Live 控制，删协作式排空（`drain`、`_retired`、`kept`、`retire`） | −160（含测试） | deploy 单测；发布探针 | Claude 决定（改 11-16 授权的发布机制） |
| P3 | 发布从 service 镜像提取 compose 文件，删 `/opt/trade-app` 手工 checkout、`composes()` 检查、drift 通知与手工步骤 | 净减，M | deploy 单测；首装探针 | Claude 决定（改发布在主机上动的东西） |
| P4 | `Notices` 移到 `deploy/notices.py` | ±0 | deploy 单测 | 无 |
| W1 | `model/runSnapshot.ts`：桌面与手机共用的持仓、挂单、成交、资金、状态；刹车按数字传，不再从显示文字回读 | −110 | web 测试；明暗截图 | 无 |
| W2 | `polled(url, ms, map)` 原语替换 8 个手写轮询模块 | −100 | web 测试 | 无 |
| W3 | `ui/` 放通用原语，业务组件回到 `widgets/<功能>`；构建规则改为“`<button>` 只在 `ui/`” | ±0 | web 测试；截图对比无变化 | 无（构建规则，不是产品检查） |
| W4 | 去掉 5 个多余 `export` | −5 | knip | 无 |
| C1 | CI 路径清单只写一份（`ci-paths` 读本工作流 `on.push.paths`） | −140 | 工作流自测 | 无 |
| C2 | 去掉 `remote-paper-auth` 的 arm64 腿 | −10 | — | 无 |
| C3 | agent 与 overview 合用一套 Node 工具链 | 小 | ide-web 工作流 | 无 |

不做：PR 上跳过 arm64 镜像构建；Overview 单独容器、独立读取服务、账本状态文件；Paper 事务化切换、Web 蓝绿与 journal、控制代码 handoff、账户锁身份检查（都是有用的安全机制）。

### 测试、评测、技能与文档

| id | 内容 | 净行数 | 授权 |
|---|---|---|---|
| T1 | 测试样板收敛：104 处 `assertRaises…code` 改用 `tests.helpers.refused`；31 个局部拒绝助手并入；`tests.helpers.tempdir`；原生报告 CSV 夹具共享 | −350..−450 | 无（排在各代码批次之后，避免冲突） |
| K1 | `research-round` 验证规则自相矛盾（`SKILL.md` 首次达标告知验证 vs 只对关线达标候选提验证）修文字，并改写 `targets-met-tells-validation-once` | 小 | 无（技能与评测各一个 PR） |
| K2 | 评测全量 with-without 计量（DeepSeek flash，约 ¥50），再逐题复判；不能区分的先改写一次，仍不行逐个删；`header-*` 一对先处理；`no-targets-asks-user` 保留 | 每个用例约 −30 | Claude 决定（花费） |
| K3 | `strategy-authoring.md` 写明有界状态写法（代替给源码审查加复杂度项） | 小 | 无 |
| K4 | 关线总结要求写明“这段留出期已被前三代账本搜过约 3,100 次”；CHANGELOG 同写 | 小 | 无 |
| K5 | 20 个零命中技能段落逐段查因，删或改（20261121-04）；`research-sources` 里会过期的测量数字改为“先测再用” | 小 | 无 |
| K6 | #3196 的评测补跑 | — | 无 |
| X1 | 删 36 份已结 doctor 记录（2,955 行），索引改永久链接；索引“已结”一节较早的行压成一条永久链接 | −3,475 | Claude 决定（有先例） |
| X2 | 删或标取代 51 份无外部引用的计划（最多 6,834 行）；`new-ledger-*` 两份随新 schema 一并处理 | 最多 −6,834 | Claude 决定（有先例） |
| X3 | 10 份存储字段审阅合成一份字段登记表（每字段一行：消费者、独立事实、为何不能派生、授权原话），放在本目录，AGENTS.md 不改 | −440 | Claude 决定 |
| X4 | 设计站删 259 个代码锚页脚与验证徽章（与用户 10-17“设计站不锚定现有代码”一致）；`appendix-open` 随新一代重置；11 个数据库设计页合成一页（写为什么存与不变式，不逐列复述） | −1,220 | Claude 决定（推翻第一轮 -111 的保留） |
| X5 | `engine/README.md` 的 Paper、Live 两节归位到 `paper/README.md`、`live/README.md` | ±0 | 无 |

不做：统一两份 Docker 假件（场景不同）；按 Gemini 的“重叠 450 行”大删 `strategy-authoring.md`（实测重叠约 28 行，这 28 行改判为做，见 A-76）；skill_heat 资产去留等 20261121-04 计量。

### 重判后的研究流程与治理提议

Gemini 被否的研究流程、拒绝与闸门、存储字段与治理提议，当初都不是因兼容而否，重判后结论：

- 做：D9（出场净盈亏）、D11（文件头职责对账）、K3、K4、K5；Live 准入要求关线未证伪（#3251）与 Paper 对账（`LIVE_PAPER_UNRECONCILED`，后台派生、不存储，随后单独 PR）。
- 留出期跨代重叠：不加字段、不改窗口，按 K4 写明；Paper 之后的数据才算未见数据。重判另加两项（E-20、E-21，见文末）。
- 不做：宿主钩子拦截（AGENTS.md「Code or Agent」与用户 10-31 决定，重判 C-007）；源码审查加复杂度项（E-46 要新存储字段，等用户；根因探查改判为做，见 C-004）；判定容差（目标不降是用户规则）；仓库内放基准策略（AGENTS.md：策略体不进 Git）；开线原型目录、结构化对账头、选币核查表、只在差异日检验。原列在这里的 `LEDGER_UNAVAILABLE` 自动重试、审查沿用父本结论、容忍多余 `--line` 与内置基准的 IDE 半边，重判改为做，见文末。
- Nautilus：本版不升。rc9 去掉 Python `RedisCacheDatabase`（Paper 带仓恢复依赖），rc8 的 `MARK_PRICE` 在 Sandbox 不触发。若打标签前 2.0.0 正式版发布，先实测这两点，通过就随本版一起升（账本重来时升级最便宜）。

## 执行顺序

依赖：E1 → E2、E3（同一次配对验收）→ E5、E6 → E7；D2 → D3 → D4 → D5，D3 → D7 → D10；D1 与 D6 并行；R1（内存超限修复为第一步）→ R2；W1、W3 排在在途 IDE PR（#3240、#3245、#3247、#3250）合入之后；T1 排在各代码批次之后；X3、X4 的数据库页合并随 D1 的 schema 改动。

- 第一波（互不碰文件，并行）：E1+E2+E3；D2→D3→D4→D5 链；D1+D6；P1–P4；C1–C3；X1、X2、X5；K1、K3、K4、K6；D8、D9、D12。
- 第二波：E4–E7；D7、D10、D11；R2；W1–W4；X3、X4；K2、K5；E8 设计评审。
- 第三波：T1；全量测试与配对原生验收复核；CHANGELOG 汇总破坏性变更与升级丢弃项。

## 发布与切换

- 发布前：全部 PR 合入 main 并通过；全量测试；涉及回放的改动配对原生验收报告；CHANGELOG 写明丢弃项（旧账本、Paper 库与 Live 私有运行不再读取）。
- 打 `v0.5.0` 标签：用户。
- 切换：新建活动账本（`ledger init --kind active`）由用户确认时机；全量行情目录切换按 20261118-01/02 的方案在 Live 空闲时做；远端主机随标签发布。

## 重判后的同步（2026-11-21）

依据 [0.5.0 全量重判](rejudge-0.5-20261121.zh.md)（#3303）。下文的 A-、B-、C-、D-、E-、F-、G-、H- 都是重判主表的行 id，规模、依赖与验收以那一行为准。“Claude 决定”沿用上文的委托：「需要我定的部份最后也是一样由你决定按推荐做」。

### 计划里的不做项，重判改为做

12 项，都还没有合入，都排进第三波：

| 原不做项 | 重判行 | 新判定 | 去向 |
|---|---|---|---|
| 删 `runtime_contract` | A-87 | 做（Claude 决定），M：两列在一代账本里恒为常量，可由镜像推出；`RUNTIME_CONTRACT_MISMATCH` 保留，改为镜像契约对代码常量 | 清理 lane |
| 合并修复文字相同的 12 个拒绝码 | D-089 | 做（Claude 决定），S：只合并条件与修复文字都相同、技能未点名的码 | 清理 lane，排在 D-090 拒绝码普查与 D7 之后 |
| `LEDGER_UNAVAILABLE` 自动重试 | A-23 | 做，S：连接时只对无应答或拒连做有界退避（总计约 90 秒），拒绝消息说明已重试 | 研究流程 lane |
| 审查沿用父本结论 | A-22、E-17 | 做（Claude 决定），S：不沿用父本结论；把与父本的 diff 作为事实交给审查者；只有常数不同的网格点由一个审查者批量审，仍逐点给四项 | 研究流程 lane（技能文字，跑评测） |
| 容忍多余的 `--line` | A-02 | 做，S：不放宽检查，`USAGE_ERROR` 附上该命令的 usage 行与可选项 | 研究流程 lane |
| 内置基准 | A-28 | 仓库内放基准策略仍不做；IDE 叠加篮子收益做，S | 等 web lane |
| 共享 `skill-fired` 评分器 | A-45 | 做，S：先实测评测运行器是否跟随 Git 符号链接，跟随则每技能留一份 | 清理 lane |
| 删 `strategy-authoring.md` 与 README 的重叠 | A-76 | 做，S：删实测重叠的约 28 行，技能留一处 | 清理 lane |
| 放宽 Web 文件 200 行上限 | A-89 | 做，S：规则改为同时限行宽或按字节计，再重排相关文件（构建规则，不是产品检查） | 清理 lane |
| 用结构拆分解决 Web 内存超限 | A-91 | 做（计量），S：v0.5.0 上线后读一周生产超限日志，复发再议 | 发布后 |
| 源码审查加复杂度项 | C-004 | 先做根因探查，S：在 `ledger temp` 上对该候选做 1 年与 3.3 年两次 `replay explore` 加 cProfile；线性外推告警仍不做 | 探针与夹具 lane |
| 留出期跨代重叠“按 K4 写明即可” | E-20、E-21 | 做：技能规定跨线只学否决年（E-20）；留出期另给一个计入 `holdout_prior_trials` 的 DSR，读时派生、不存储（E-21，Claude 决定） | 研究流程 lane；E-21 的 IDE 显示等 web lane |

### 合入时漏掉的三项

| 重判行 | 漏在哪里 | 去向 |
|---|---|---|
| B-35 | Dolt 环境（`DOLT_ROOT_PATH`、`DOLT_DISABLE_EVENT_FLUSH`）仍在 4 个文件各拼一份，D6（#3280）没有包含；改为一个 `dolt_env(home)` 助手 | 清理 lane |
| B-80 | X5（#3264）把 Paper、Live 两节归位后没有逐段对照代码核对；`paper/README.md`、`live/README.md` 逐段核对，只改文档 | 清理 lane |
| B-90 | Live 的止损缺口计时仍自记，E6（#3288）没有包含；改用 `protection.Gaps`，边界随 Paper 为 `>` | Live 正确性 lane |

### 第三波

五个 lane 在跑，行按重判“做”的排序分档分配：

| lane | 重判行 |
|---|---|
| Live 正确性 | B-90、C-067、C-083、C-160、C-143、C-058、D-155、D-149（先做 D-147 探针）、C-142、C-141、C-062、H-47、D-128、B-64、D-216、D-258 |
| 回放与数据 | D-088、D-166、B-23（与 E1 同一次配对验收）、F-05 |
| 研究流程 | E-01、E-16、E-05、E-20、E-21、A-24、A-23、A-02、A-22、E-17、H-01、C-200、C-203、F-32、C-197、C-190、C-202、C-192、D-085、D-072、D-275、D-270、D-260、E-10、E-19、E-32、A-21；27 职责余项 A-29、D-185..D-187 |
| 清理 | A-87、H-46、D-089（在 D-090 之后）、B-35、B-38、A-38、F-07、A-103、B-25、B-62、C-049、B-27、B-65、A-45、F-09、F-11、A-89、B-54、A-50、E-71、F-03、B-49、A-105、A-109、A-119；文档 A-76、A-77、B-80、E-73、E-84、C-188、B-48 |
| 探针与夹具 | C-158、C-174、C-176、C-004、C-005、C-023、C-025、C-027、D-090、D-093、D-122、B-74 |

另有：A-91 在 v0.5.0 上线后做；原第三波的 T1、全量测试、配对原生验收复核与 CHANGELOG 汇总不变。

等 web lane 的 IDE 行（每项合并前给明暗截图）：G-37、H-32、G-32、C-012、C-015、C-013、C-014、A-73、C-009、G-31、G-48、H-24、H-34、G-69、G-26、G-27；另有 A-28 的篮子叠加与 E-21 的 IDE 显示。

### 等用户

以下重判行只能由用户决定，本计划不替用户决定；建议写在重判的“需用户的项与建议”一节：

| 重判行 | 事项 | 类别 |
|---|---|---|
| C-044 | 主检出 `.env` 里两行已作废的交易所凭据 | 凭据 |
| C-139、D-150、D-156、D-289 | 只能在真实账户上回答的项（断线带仓重启、受控手动平仓、429 与请求权重、实收资金费、`availableBalance` 口径、按方向批量撤单、幻影仓位等） | Live 运行 |
| C-111 | 上线后表现衰减的检测 | Live 运行 |
| D-160 | 首次试运行的 100 USDT 固定上限（`LIVE_BUDGET`）与 11-13“不设上限”不一致；用户 2026-11-21 已定删掉（见“用户的决定”） | Live 运行的规模 |
| D-107 | 分年 MARK 回撤 | 新存储字段 |
| D-108 | 离线变体数 K 改为一列 | 新存储字段 |
| D-228 | 样本外验证改由 Paper 承担 | 新存储字段，并涉及 AGENTS.md |
| D-086 | 只放大仓位的运行不计入换思路 | 新存储字段 |
| D-252 | 逐决策记录 | 新存储字段 |
| C-117 | 用户选择与 Agent 判断的“作者”字段 | 新存储字段 |
| C-206 | 研究登记的外部时间戳 | 新存储字段 |
| E-46 | 源码审查加每 bar 复杂度与有界状态项 | 新存储字段 |
| D-146 | 一个会话同时跑两个策略 | 新存储字段与真实账户试验 |
| D-284 | 视频转写语言入证据包 | 新存储字段 |
| D-092 | 凭据暴露后的轮换 | 凭据 |
| H-10 | 在上游 issue 回复“已在 rc8/rc9 验证” | 以用户名义对外发言 |
