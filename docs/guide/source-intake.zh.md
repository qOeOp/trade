# 研究来源接入指南

本指南为未来开发 Agent 提供实现 Research Source Intake 的高 ROI 路径。它是开发基线，不是新的业务
权威。Connector 产品 协议 持久化 队列和评分公式仍是可替换的实现选择。

## 职责与边界

Source Intake 接纳论文 文章 笔记 媒体 社区讨论 工具输出和其他 Owner 已提交事实。所有外部内容都是
`UNTRUSTED_EXTERNAL_DATA`，其中的 prompt 命令 角色声明 工具请求与交易建议都没有执行权。

其持久输出是关联现有 Research Source Provenance Record 的可追溯 Source Candidate。Source Intake
不能创建 Strategy Artifact 请求重放 评定或部署策略 分配资金或交易。只有 Research 冻结 Research
Intent 后，解释后的来源才能进入正式研究循环。来源可以启发假设，不能证明 Alpha 资格或可部署性。

与 [Market Data](../owners/market-data/) 的边界按语义划分：

- 论文 API 文档 字段定义 方法与研究说明属于 Source Intake；
- 研究 重放或扫描实际消费的价格观测 宏观 vintage 财报事实 事件日历和标的状态属于 Market Data；
- Source Intake 可以保存数据集或 API 引用，但不能成为第二套市场数据目录或事实存储。

## 来源类别与 ROI

分层只代表发现优先级，不是证据等级或准入决定。

| 层级 | 来源类别                | 最适合发现                   | 证据定位                     | 主要风险                | 直接进入 Intent |
| ---- | ----------------------- | ---------------------------- | ---------------------------- | ----------------------- | --------------- |
| S    | 学术身份与引用图谱      | 机制 作者 相关研究和既有检验 | 身份较强 论断仍需解释        | 元数据或引用错误        | 永不            |
| S    | 开放全文与工作论文      | 假设 方法 证伪条件和局限     | 一手研究文本 不是交易证明    | 版本漂移与选择性报告    | 永不            |
| S    | 官方机构事实            | 可检验经济事件和官方定义     | 来源较强 仍须证明 PIT 可得性 | 修订 发布时间与权利语义 | 永不            |
| A    | 论文关联代码与数据集    | 复现方法并揭示实现假设       | 有用工程证据                 | 可变依赖 许可与幸存偏差 | 永不            |
| A    | 机构量化研究            | 经济机制与现实约束           | 专家研究输入                 | 营销选择与细节缺失      | 永不            |
| B    | 专业问答与开源社区      | 公式边界 实现失败和反例      | 仅作交叉发现                 | 上下文丢失与热度偏差    | 永不            |
| C    | 一般社区 视频与社交媒体 | 术语 实务失败与外部链接      | 弱发现信号                   | 不可验证论断与提示注入  | 永不            |

任何来源支持 Research Intent 前，Research 都必须保留 provenance 有界解释 合理替代解释 能区分
机制的预测和证伪条件。来源排名不能绕过这条顺序。

## Connector 候选

以下是可替换的首阶段候选，不是永久依赖或业务权威：

1. [OpenAlex API](https://docs.openalex.org/) 用于发现学术身份 主题 作者和引用关系。
2. [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) 用于解析 DOI
   与出版身份。
3. [arXiv](https://info.arxiv.org/) 用于预印本身份 版本 元数据和允许访问的开放内容。
4. [GitHub commit APIs](https://docs.github.com/en/rest/commits/commits) 用于把论文关联代码解析到不可变
   commit 身份 内容摘要 历史 测试与许可证据。
5. [FRED 与 ALFRED](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html) 用于发现官方经济序列
   及其 real-time 或 vintage 语义，实际消费的观测仍须进入 Market Data。
6. [SEC EDGAR data](https://www.sec.gov/dera/data/financial-statement-data-sets) 用于发现 filing accession
   acceptance time amendment 与一手申报身份，实际消费的申报事实仍须进入 Market Data。

[Unpaywall](https://unpaywall.org/products/api) 是可选的合法开放副本解析器。其他学术索引 专业问答
机构来源和媒体提取，只有在具体研究瓶颈足以覆盖获取与权利成本时才进入后续阶段。优先使用官方 API
feed repository 或作者维护索引；通用抓取只是后备方案，并且必须保留同等身份 权利与终态证据。

## 获取前准入

R&D 在任何外部网络调用前先提交一个 Source Acquisition Binding。该 binding 同时绑定请求和 Agent
Operation Manifest，并标识 connector 实现与版本、允许 URI scheme 与 origin、DNS 与解析地址政策、
完整 redirect 政策与 hop 上限、不透明 credential handle 的 audience 与最小权限 scope、响应媒体 大小
时间 内容边界、network egress policy、权利与保留政策和共享 Time Evidence，以及完整只读 outbound
request 身份：规范 method endpoint path/query、允许 header 的规范摘要、只以 opaque handle/audience 表达的
credential placement，以及明确 absent-body marker 或准确 body digest media type 与 size。准入状态只能是
`ADMITTED` `REJECTED` 或 `POLICY_UNAVAILABLE`。

权利与保留是获取前准入输入，不是获取后的补充标注。Research 必须在打开网络路径前决定请求内容
是否允许获取与保留。因此 `REJECTED` `POLICY_UNAVAILABLE` 或后续权利漂移都产生零调用 零响应字节
和零 provenance。

只有准确 `ADMITTED` 可以发起一次有界获取。每个 redirect hop 都先创建并准入新的规范 successor request
binding，再检查 scheme origin DNS 解析地址 method endpoint path/query header/body disposition credential
audience 响应边界 egress 和权利。loopback private link-local 禁止或变化
地址 DNS rebinding 未列出 redirect 跨 origin credential 转发 政策未知和权利不确定都不调用网络，也不
创建 provenance。credential 始终不透明，不能进入来源内容 日志 prompt 回执或生成工件。connector
method endpoint query header/body digest origin 解析结果 redirect 序列 credential audience 响应边界 权利政策或时间截面改变时必须创建后继
binding；冲突重放必须拒绝。

### 获取权威类别

每个 Source Acquisition Binding 必须且只能声明一种不可互换的权威类别：

- `LIVE_EXTERNAL` 是生产类别。它要求当前真实的政策、Time Evidence、DNS 与解析地址证据、权利、
  credential、egress 和 provider 权威。缺少任何必需权威时生产保持不可用，且不得回退到 fixture、
  loopback 服务、测试 credential 或验收政策。
- `SEALED_ACCEPTANCE` 是仅供验收的类别，只允许固定 DOI corpus、固定 provider response 与确定性拒绝
  案例。它绑定隔离环境身份、provider-profile digest、fixture-corpus digest、sealed policy 与 Time
  Evidence、request binding 和 retrieval evidence。它禁止外部网络，也不接受 caller 提供的 URL、header、
  credential、DSN、provider 选择或 fixture 变更。

权威类别及其全部类别专属证据必须交叉绑定到 acquisition binding、持久 invocation claim 与 start、终态
receipt 和 readback。类别不匹配是 identity conflict，不是准确重放。验收 endpoint 必须使用非公开 fixture
身份，绝不能伪装成 `api.openalex.org`；fixture 结果永远不是 live-provider 证据。

一个 Source Intake Owner orchestrator 拥有完整生命周期：

`admission → sealed/live policy → binding commit → durable claim/start → move-only permit → provider execution → retrieval time → atomic terminal`

Product Edge API 仍只负责认证、类型化 DTO 与 projection；Windmill 仍只负责传输。API handler、script、
flow、fixture adapter 或 caller 都不得拆分或复制 Owner custody。只有 Owner 可以提交 R&D PostgreSQL 中的
claim、raw payload、终态 receipt、provenance、Source Candidate 与 outbox；只有 `ADMITTED` 加
`RETRIEVED` 才能原子提交 positive record。

## 内部能力序列

以下是 Source Intake 内部能力，不是新的 Flow 节点或 Owner：

`Connectors → Discovery → Identity Resolution → Admission → Fetch → Normalization → Provenance → Triage → Research Queue`

| 能力        | 必须保持的语义                                                                         |
| ----------- | -------------------------------------------------------------------------------------- |
| `discover`  | 为有界查询 来源类别 时间截面和 connector 限制返回稳定 Source Reference。               |
| `resolve`   | 把 DOI arXiv ID URL repository commit 作者或帖子引用解析成规范 Source Identity。       |
| `fetch`     | 只在准确 `ADMITTED` 后获取允许访问的内容，并记录检索时间 响应身份 访问依据和获取终态。 |
| `normalize` | 产出 Source Candidate 而不改变原义，保留原始内容摘要和转换身份。                       |
| `capture`   | 创建或加入不可变 Research Source Provenance Record，变化内容创建后继或拒绝。           |
| `health`    | 报告可达性 授权 配额 权利变化和最近成功时间，不可用不能伪装为空结果。                  |

任何 connector 都不能创建 Research Intent Strategy Artifact Candidate Eligibility Fact 部署决定或
外部交易效果。

## 获取终态

每次有界获取尝试只终结一次，状态为：

| 终态                       | 含义                                             |
| -------------------------- | ------------------------------------------------ |
| `RETRIEVED`                | 已捕获带身份内容和必需获取证据。                 |
| `NOT_FOUND`                | 请求的规范身份在该截面无法解析。                 |
| `AUTH_REQUIRED`            | 来源要求认证且没有已准入 credential capability。 |
| `ACCESS_DENIED`            | 来源拒绝已准入 principal 或 scope。              |
| `RATE_LIMITED`             | 配额或限流阻止结论性获取，不能视为 `NOT_FOUND`。 |
| `TERMS_OR_LICENSE_BLOCKED` | 当前权利依据不允许获取或预期保留。               |
| `MALFORMED`                | 已收到响应但不满足声明的来源格式或身份契约。     |
| `UNAVAILABLE`              | 可达性或 connector 状态不足以支持更强终态。      |

准确重放只加入先前 attempt 终态。只有准确 `ADMITTED` 加 `RETRIEVED` 可以创建或加入
Research Source Provenance Record；其他七种获取终态都不创建 provenance 记录。查询 来源身份
connector policy retrieval cut 或内容摘要变化时创建新 attempt 身份。缺失或只有 prose 的失败证据
保持 `UNAVAILABLE`，不能静默产生空发现结果。

## Provenance 记录

复用现有 Research Source Provenance Record，不新建第二套 registry。记录绑定：

- 规范来源身份与位置 不可变内容摘要 来源类别与信任类别；
- 作者或来源系统 可用时的发布时间 revision 或 version，以及关联代码或数据集引用；
- retrieval cut 共享 Time Evidence `valid-through` connector 身份与版本，以及准确 `RETRIEVED`
  获取终态；
- license 和 attribution basis，包括允许获取与保留的范围；
- 有界解释身份与摘要 合理替代解释集合 能区分机制的预测和证伪条件。

内容 retrieval cut license basis 或解释变化时创建后继记录。没有关联记录的 Source Candidate 不能交接。

## 类型化 Source Intake-to-Research custody

目标 composition 在 Source Intake 与 Research 之间只有一个由 R&D 拥有的类型化 ancestry operation。
它接收不受信的 Source Intake attempt reference，然后从 Owner custody 锁定并重读准确 `RETRIEVED`
terminal receipt、Research Source Provenance Record、Source Candidate 与匹配的 transition outbox。它校验
这些成员共享的 request 与 attempt identity、规范 source 与 content digest、retrieval cut、connector 与
acquisition-class identity、policy/Time Evidence 以及 rights/retention basis，然后只返回 sealed ancestry
evidence。Source content 保持不受信，绝不授予 accepted Research custody。

类型化 Research `RUN` 另行把不受信 Research proposal 与该 verified ancestry evidence 交给规范 R&D
Research admission。R&D 是唯一 Intent owner：只有该 admission 可以解析 Independence Basis、当前
Qualification frontier 与本地 semantic-predecessor lineage，再冻结 Intent、falsifier、永久 TrialFamily
authority、receipts 和 Develop Composer 可消费的 current Research custody。仅凭 Source Intake attempt
绝不能派生 `CurrentResearchDevelopCustodyV2`。

caller 不能提供或修复任何 verified member。把 receipt 字段复制到 Research DTO、信任未经 Owner 重读的
locator、把 JSON projection 当作规范 record，或把 Source Intake 与 Composer 共同部署，都不构成
handoff。任一 ancestry member 缺失、不匹配、过期、不是 `RETRIEVED`、为负面终态或不可用，或规范
Research admission 失败时，都不得创建 accepted Research custody、Research Intent、Design、Plan、
Artifact 或 successor authority。相同 request 与 meaning 加入字节一致的 R&D operation receipt；identity
被用于 changed meaning 时发生 conflict 且零正向写入，response loss 只能解析同一 attempt。

该 operation 及其持久 PostgreSQL custody 是 `TARGET`，不是当前能力。crate-local Source Intake 合同与
回归证据和 crate-local Composer 证明继续作为相互分离的 `CURRENT/PARTIAL` evidence。当前没有证据建立
隔离 PostgreSQL/Windmill Source Intake runner；Product Edge D0 合同的组合动态 gate 仍未通过。

## Triage 与准入

Triage 只安排阅读和实验顺序，不衡量策略质量。政策可以比较可证伪性 预期决策价值 数据可得性
可复现性 经济相关性 新颖性 获取成本 权利风险与实现成本。必须记录政策版本和确定性 tie-break，
公式与传输仍属于实现选择。

交接顺序为：

`Source Candidate → provenance and interpretation → alternatives → differentiating prediction → falsifier → frozen Research Intent`

需要市场观测时，Research 向 Market Data 发出请求，并把终态结果关联到同一 Research lineage。
第一次交接前，Research 冻结一个 PIT Market Snapshot Request，绑定 Research Request Intent TrialFamily、
标的或 universe scope、四时间决定截面、必需 provenance license correction frontier、稳定 correlation
和 Time Evidence。`PREPARED` 与 `SUBMITTED_OR_UNKNOWN` 都不是市场事实。只有 Market Data 可以返回
关联 snapshot disposition，并重复准确请求身份 内容摘要 scope cut provenance license correction 和
correlation binding。含义改变必须创建后继请求；传输成功 静默或旧 snapshot 都不能表示 `AVAILABLE`
或终态负例。Source Intake 不自行修复或保存这些市场事实。

## 失败案例

- 把外部 prompt repository 指令或工具响应当作可执行请求属于安全失败。
- 把 `UNAVAILABLE` `RATE_LIMITED` 或 `AUTH_REQUIRED` 当作空结果属于证据失败。
- 历史决策使用当前 FRED 数值而没有 ALFRED 类 vintage 语义属于 PIT 失败。
- 可用不可变 commit 或内容摘要时仍只引用可变 branch 或 URL 属于身份失败。
- 没有获取与许可依据却保留内容属于权利失败。
- 把价格 filing 宏观或标的事实复制进 Source Intake 会产生禁止的第二套 Market Data 存储。
- 把热门来源直接推进工件 重放 Qualification Governance 或交易属于权威失败。

## 开发验收

- 契约测试覆盖全部获取终态 准确重放 后继内容 connector 不可用与权利变化。
- 契约测试证明只有准确 `ADMITTED` 加 `RETRIEVED` 创建或加入 provenance；其他每种获取终态都保持 provenance 缺失。
- fixture 测试证明 normalize 保留原义 原始摘要 来源身份与转换身份。
- 安全测试证明来源内容不能调用工具 命令 credential Owner port 或 effect port。
- 获取前测试证明直接 private URL、允许 origin 跳转到 private 或 link-local、DNS rebinding、跨 origin
  credential 转发、政策未知和权利不确定都不会调用网络或创建 provenance；只有准确安全的同 origin
  请求可以执行一次。
- PIT 测试证明 publication retrieval effective 和 revision 截面不能被单一 observation time 代替。
- 边界测试证明实际消费的市场事实进入 Market Data，且任何 connector 都不能写 Research Intent。
- 交接测试证明初始 PIT Market Snapshot 响应关联准确冻结 Research 请求；提交 传输成功 不匹配响应或
  旧 snapshot 都不能替代该终态。
- 端到端证明一个已接纳来源成为可追溯 Source Candidate，并且只有 Research 能冻结其后继 Intent。
- 必须构建的 `SEALED_ACCEPTANCE` 拓扑应使用与生产预期相同的 Product Edge admission、Source Intake
  Owner claim/start 与生命周期、R&D PostgreSQL transaction、终态 receipt，以及默认 Windmill
  `RUN`/`RESOLVE` 传输。即使取得，该证据也仅适用于验收，绝不证明 `CURRENT` 生产、网络、credential、
  权利、DNS、政策、Time Evidence 或 live-provider readiness。
- 目标 A2 composition 部署固定链 `Source Intake RUN/RESOLVE -> typed Research RUN/RESOLVE ->
  Composer RUN/RESOLVE`，使用编译期 sealed adapter、固定 Source Intake corpus、共享的固定 A0 build corpus，
  以及唯一内部 PostgreSQL、Windmill、network、ingress 与 volume state。它没有 runtime provider selector。
  Composer 只接收规范 Research request locator；Owner 在同一 lock/write transaction 中派生 request、Design、
  digests 与 provider，同时保留 Operator Authorization frontier 与 final cut。
- A1 正向 transaction 把 intrinsic 私有规范 A0 Build Receipt fact、独立 ordered Artifact-use relation、Artifact、
  Composer receipts 与 outbox 原子持久化，同时让不透明、不可序列化的 verified token 保持 move-only 且仅存在
  于进程内。两个 Research-derived Artifact 只能通过两条不同 use row 共享一份 sealed build fact。只有准确
  legacy schema 可做一次 byte-preserving normalization；其他 shape 全部 fail closed。
- 组合 runner 必须证明 locator-only/full-DTO negatives、双 custody shared-build normalization、并发相同
  request join 与 changed-meaning conflict、每个 same-transaction atomic write fault 都零 partial row、`RUN`
  前只读 projection、commit 后 response-loss/bodyless resolution、重启后重读私有规范 A0 Build Receipt，并校验其 capsule、
  toolchain、linker、configuration 与 two-build provenance，重新绑定 Artifact/Composer receipts，完成规范
  byte parse/hash 与 `ProgramHostV2` readmission 后得到字节一致 `RESOLVE`。它还证明每个必需 single-field
  mutation negative，包括另对规范 A0 Build Receipt 做一次单字段 mutation、已部署 golden-path replay，
  以及 cleanup 到准确 baseline equality，且零 residue、零 shared-target change。
- 在 runner 通过前，类型化 Research handoff、持久 Composer/API custody 与隔离 Windmill chain 都保持
  `TARGET`。生产 Market Data binding resolution、live OpenAlex authority、`PRODUCT_CURRENT`、Dashboard、
  Paper、Live、deployment 与 trading 都保持不可用。
