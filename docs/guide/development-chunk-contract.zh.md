# 开发切片契约

本页是单次 Agent 开发循环可复用的规划包络。它把全局架构转成有界实现目标，但不冻结类、存储、
协议、部署拓扑或内部类型。

## 选择规则

每次只选择一条规范关系，或一个具有可观察消费者的 authority 内部不变量。Authority 包括业务 Owner
和显式建模的非业务边界托管方。切片不能是"实现整个 Owner""迁移一个 crate"或"完成整个场景"。
当前代码路径在规划时发现并绑定；目标文档不声称当前实现一致。
先选择 canonical 切片，再通过 [Agent 实现指南](./agent-implementation/)验证当前引擎 API、工具链指导与
旧开发参考。

## 可复制规划包络

```text
Chunk identity
Selection mode RELATION or AUTHORITY_LOCAL_INVARIANT
Consumer and scenario
No-change harm and bounded outcome
relation-source-role and sender boundary
relation-action-kind
request-or-object-producer-authority
carried-object-authority
business-outcome-owner-or-none-with-basis
Canonical owner object relation-or-invariant and docs-route IDs
Prerequisites and unavailable-evidence Stop
Allowed inbound dependencies and prohibited writes
Accepted rejected unknown and replay behavior
Accepted oracle Given When Then
Rejected oracle Given When Then
Unknown oracle Given When Then
Replay oracle Given When Then
Implementation latitude
Focused Owner test
Boundary consumer test
Adversarial negative test
Replay restart and concurrency test when applicable
Repository root gate
Evidence receipt
  exact candidateRevision
  non-empty per-locator implementationReferenceBindings
Docs and Flow disposition
Authority-local invariant binding or not applicable with basis
Owner migration binding or not applicable with basis
Replan authority and external-effect escalation
```

该列表只帮助规划，不是校验器输入。切片必须保存为 JSON，使用下方规范示例的准确连字符字段名与嵌套
形状。`selection-mode` 是必需判别字段。relation record 设置 `relationId`，并让 `invariantId` 使用 JSON
`null`；authority-local invariant 则相反。Invariant binding 中的 `migrationSurfaceId` 也必须保留为准确
字符串或 JSON `null`。JSON round-trip 后键被省略、JavaScript `undefined`、额外字段、文字包络或部分
形状都无效。

## 规范绑定查找与仅限 Origin 的形状 fixture

在首页 Flow 中选择一条带方向的 Owner 交接线。底部详情胶囊会展示规范 relation、object 和文档路由
ID，可见端点说明生产者与消费者，Owner 页面说明权威与不变量。若交接或对象不存在，
不得自造 ID，必须停止并回到架构规划。

可用以下已有 locator tuple 独立核对首页查找结果：

```text
Selection mode RELATION
Canonical owner IDs product-edge and rd
Canonical object ID rd-request
Canonical relation ID product-rd
Canonical docs route architecture/product-edge
```

四个语义字段必须填写完整的有效分支正文，不能填写 `relation-id#accepted` 这类不透明引用。校验器会把
所选 relation 或 invariant 解析到规范契约，只有四个分支正文都与该权威精确一致时才接受记录。

下面的准确 JSON 是已有 `portfolio-risk` 关系的非可执行
`ORIGIN_SHAPE_FIXTURE_NOT_CURRENT_CANDIDATE_EVIDENCE`。其中 `30d7c…` revision 只演示 record 形状，
不是当前 Candidate，绝不能复制为当前证据。Main 必须为每个候选物化实际 candidate tree 与
verification-context receipt；Candidate 不同于 Origin 时，任何绑定 Origin 的 record 都是 `INVALID`。
传输 存储 框架与内部类型仍留给实现规划。

```json
{
  "chunk-identity": "chunk:portfolio-risk:paper:v1",
  "selection-mode": "RELATION",
  "consumer-and-scenario": { "consumerId": "risk", "scenarioId": "paper" },
  "no-change-harm-and-bounded-outcome": {
    "noChangeHarm": "Risk could admit new exposure from incomplete or mixed Portfolio evidence",
    "boundedOutcome": "Validate and consume exactly one coherent Portfolio Risk Evidence Bundle"
  },
  "request-or-object-producer-authority": "portfolio",
  "business-outcome-owner-or-none-with-basis": { "ownerId": "risk", "noneBasis": null },
  "canonical-owner-object-relation-or-invariant-and-doc-route-ids": {
    "ownerId": "portfolio",
    "objectId": "portfolio-risk-evidence-bundle",
    "relationId": "portfolio-risk",
    "invariantId": null,
    "docsRoute": "owners/risk"
  },
  "carried-object-authority": "portfolio",
  "relation-source-role": "portfolio",
  "relation-action-kind": "fact",
  "prerequisites-and-unavailable-evidence-stop": {
    "prerequisites": ["complete Portfolio projection cut", "fresh shared Time Evidence"],
    "stopWhenUnavailable": ["bundle missing stale mixed-cut or cross-scope"]
  },
  "allowed-inbound-dependencies-and-prohibited-writes": {
    "allowedInbound": ["Portfolio Risk Evidence Bundle"],
    "prohibitedWrites": ["Portfolio facts", "Execution effects"]
  },
  "accepted-rejected-unknown-and-replay-semantics": {
    "accepted": "Risk binds one AVAILABLE Portfolio Risk Evidence Bundle whose candidate-neutral gross Capacity View projected exposure open-order membership settlement lineage valuation time evidence and Portfolio projection cut all match the Trade Intent Capacity Scope",
    "rejected": "Missing partial unavailable expired cross-scope mixed-cut duplicate-lineage methodology assumption valuation time or source-binding mismatch receives terminal REJECT and creates no add-risk Reservation",
    "unknown": "Unknown effect exposure open order settlement lineage liquidity clock or capacity fails closed and never implies remaining capacity",
    "replay": "The same bundle identity and projection cut remain bound to the frontier transition that consumed them"
  },
  "implementation-latitude": ["storage layout", "internal types", "process topology"],
  "focused-owner-test": "Risk admits a coherent fresh same-scope bundle",
  "boundary-consumer-test": "Portfolio output is consumed without acquiring Risk authority",
  "adversarial-negative-test": "Cross-scope or mixed-cut evidence returns terminal reject",
  "replay-restart-and-concurrency-test-when-applicable": "Duplicate bundle identity joins one frontier transition",
  "repository-root-gate": "make docs-site-check",
  "evidence-receipt": {
    "candidateRevision": "git-tree:30d7c401118dbe474e6d620d75a73b20c1d69543",
    "focusedTestResult": "PASS: focused owner test",
    "rootGateResult": "PASS: make docs-site-check",
    "implementationReferenceBindings": [
      {
        "candidateRevision": "git-tree:30d7c401118dbe474e6d620d75a73b20c1d69543",
        "locator": "docs/developer_guide/testing.md",
        "classification": "CURRENT_IMPLEMENTATION_REFERENCE",
        "verificationResult": "VERIFIED_AT_CANDIDATE_REVISION",
        "verificationReceipt": {
          "resolvedCandidateRevision": "git-tree:30d7c401118dbe474e6d620d75a73b20c1d69543",
          "resolvedLocatorIdentity": "tree-path:docs/developer_guide/testing.md@git-blob:180114fedbd11a05bbdba84a08e4eb27cb352ce7@content-sha256:1d36eea08dc2c525a92b2b531168c212d23c0ad02ecf474b8766578a37c2b820",
          "contentSha256": "sha256:1d36eea08dc2c525a92b2b531168c212d23c0ad02ecf474b8766578a37c2b820",
          "checkResults": [
            { "kind": "PATHS", "outcome": "PASS", "evidence": "The referenced repository path resolved at the frozen candidate revision", "basis": null },
            { "kind": "SYMBOLS", "outcome": "NOT_APPLICABLE_WITH_BASIS", "evidence": null, "basis": "This guide declares no exact implementation symbol dependency" },
            { "kind": "COMMANDS", "outcome": "PASS", "evidence": "The documented focused and root test commands were checked at the frozen candidate revision", "basis": null },
            { "kind": "PREREQUISITES", "outcome": "PASS", "evidence": "The documented toolchain and fixture prerequisites were checked at the frozen candidate revision", "basis": null }
          ],
          "verificationContextDigest": "sha256:b7c9923d0f25d2b32788cb433c4300a0002507cf7c42eb6026a4ec195988f354"
        },
        "mismatchDisposition": null
      }
    ]
  },
  "docs-and-flow-disposition": {
    "docs": "UNCHANGED_IF_CONTRACT_PRESERVED",
    "flow": "UNCHANGED_IF_TOPOLOGY_PRESERVED"
  },
  "authority-local-invariant-binding-or-not-applicable-with-basis": {
    "applicable": false,
    "basis": "The example selects a canonical relation rather than an authority-local invariant"
  },
  "owner-migration-binding-or-not-applicable-with-basis": {
    "applicable": false,
    "basis": "No authority or predecessor writer migration"
  },
  "replan-authority-and-external-effect-escalation": { "replanOwner": "Main", "externalEffectAuthority": "User" }
}
```

先把 Origin fixture 中的每个 receipt 替换为 Main 对实际候选观察到的证据，再保存 record 并从 site
package 运行公开校验器。下列 placeholder 是必需输入，不是可直接复制的字面量：

```bash
cd docs-site
npm run validate:development-chunk -- \
  --candidate-tree <ACTUAL_CANDIDATE_TREE> \
  --repo .. \
  --verification-context /absolute/path/to/main-verification-context.json \
  /absolute/path/to/chunk.json
```

Main 提供的 context 独立于 record，准确形状如下：

```json
{
  "candidateTree": "<ACTUAL_CANDIDATE_TREE>",
  "verificationContextDigests": {
    "docs/developer_guide/testing.md": "sha256:b7c9923d0f25d2b32788cb433c4300a0002507cf7c42eb6026a4ec195988f354"
  }
}
```

带同样必需 flags 时，命令也接受标准输入中的 record JSON。只有退出码为零且输出
`{"outcome":"VALID","reasons":[]}` 才有效；JSON 格式错误 未知字段 缺失键 selector 不一致或修改
规范语义都会返回 `INVALID` 与非零退出码。

切片必须写明一个消费者可观察结果、发送交接的 relation `sourceRole`、生产 request 或 object 的
authority、拥有 carried object 的 authority，以及拥有可观察业务结果的 Owner。这些是独立字段且可以
不同。R&D 是同时包含 Research 与 Develop 能力的唯一 Owner；Backtest 是消费 R&D-owned Strategy
Artifact 的独立服务 Owner。边界可以生产
类型化请求对象，但只有业务 Owner 能提交相关回执或状态转换。Owner 生产的读模型即使由边界消费，
仍由该 Owner 拥有。纯边界展示或投递只有给出明确依据才能声明没有业务事实，其业务写入集合必须
为空并把 `business-transition` 列为禁止项。Owner 内部工作在两个角色中填写同一个业务 Owner。禁止
写入包括其他 Owner 拥有的任何事实、把传输或 stage custody 误当 carried-object authority、绕过 Owner 的存储访问、把通知当证明，以及未经明确授权的
外部或实盘效果。

每个 accepted rejected unknown replay oracle 都用 `Given / When / Then` 描述，并且必须命名一个已提交
观察结果，而不是方法调用 日志或只存在于文字的期望。并发约束只规定持久原子序列化及其获胜后的可观察
状态，不指定存储原语 数据库 队列或其他内部机制。

每个切片都必须声明是否改变 Owner Migration Envelope 中的某个迁移表面。非迁移切片提供明确的
不适用依据。迁移切片绑定准确切片和表面、当前与下一相邻阶段、前驱与后继 revision、共同证据
截面、回滚或围栏向前恢复处置、事故权威和停止观测。证据绑定、回滚处置、停止观测和共同截面域
必须匹配所选迁移表面；截面身份由该域命名。其他表面的证据无效。迁移上下文缺失、来自其他表面
或阶段不相邻时停止规划。

`agent-shell-cutover` 边界不变量绑定 Agent Shell Deployment Binding、权威 history head、共享的可变 Owner 请求门禁、
三个出站请求对象及其三个接收 Owner 回执。证明必须保持有效主体、权限范围、能力与审计政策版本一致，
允许失败关闭的零 `ACTIVE` 窗口，要求准确前驱先提交不可逆 `SUPERSEDED`，政策等价后继再提交
`ACTIVE`，拒绝双写，要求每个写请求准入绑定准确 head 且其中唯一 `ACTIVE` 被选中，并按原 request
与 binding 身份解析全部已准入在途请求。只有 Research、Governance 或 Qualification
独立提交匹配回执才形成业务结果。它没有业务 Owner，也不能提交业务转换。
切片还必须完整声明规范 `accepted` `rejected` `unknown` `replay` 四个分支；缺失、部分或被修改的
分支都会停止规划。

## 有效关系语义

每条关系自己拥有唯一完整本地 `accepted` `rejected` `unknown` `replay` 块。本地块缺失 空或不完整都
无效，也不会查询第二语义来源。Owner 内部不变量必须在切片中直接写明同样四种可观察分支。
无法解析的引用、不透明 `relation#branch` 占位符、缺失分支以及偏离所选规范权威的正文都为
`INVALID`。生成的契约投影直接展示解析后的分支正文，让实现 Agent 能执行并测试所选行为，而不必查找
第二份语义来源。中文页保留规范英文正文原文，避免翻译副本成为另一套权威。

## 必需证据

- Evidence receipt 冻结一个准确 `candidateRevision` 与非空 `implementationReferenceBindings` 列表。
  每项都重复该 revision，且只能包含 `candidateRevision`、`locator`、`classification`、
  `verificationResult`、`verificationReceipt`、`mismatchDisposition`；重复 locator 或改动字段都无效。
- `CURRENT_IMPLEMENTATION_REFERENCE` 只有在使用 `VERIFIED_AT_CANDIDATE_REVISION`、提供完整 typed
  receipt 且 mismatch disposition 为 null 时有效。`LEGACY_REFERENCE` 只有在使用
  `MISMATCHED_OR_SUPERSEDED`、保留同样完整 receipt 且处置为 `DO_NOT_USE_AND_REPLAN` 时有效。
  绑定缺失、为空、过期、revision 不匹配、部分缺失或分类未知时停止切片。
- Typed verification receipt 只能包含 `resolvedCandidateRevision`、`resolvedLocatorIdentity`、
  `contentSha256`、`checkResults` 与 `verificationContextDigest`。它把准确 candidate revision 和规范化
  locator 绑定到 immutable Git blob，并让两个 identity 字段重复同一 SHA-256 digest。Context digest
  覆盖有序 typed receipt，且必须独立匹配 Main 的逐 locator context；自由文字核验声明无效。
- `checkResults` 按规范顺序恰好包含 `PATHS`、`SYMBOLS`、`COMMANDS`、`PREREQUISITES`。每项只能为
  `PASS`（具体 evidence、null basis）或 `NOT_APPLICABLE_WITH_BASIS`（null evidence、具体 basis）。
  检查缺失、重复、额外、乱序、格式错误，或 revision/content/locator/check evidence 被修改时失败关闭。
- 对 CURRENT 与 LEGACY，record 加 contract 都不足以通过。公共校验器必须取得真实 immutable Git tree 与
  仓库 object database，把每个 locator 解析到唯一 blob，读取 bytes，重新计算 Git blob ID 与 SHA-256，
  并比较外部提供的 context digest。缺少解析、tree 过期或错误、path 不存在、伪造但内部自洽的 identity、
  bytes 被修改时都无效。LEGACY 不存在"无法解析但仍有效"的例外；解析成功后仍必须
  `DO_NOT_USE_AND_REPLAN`。
- 一个聚焦测试证明权威写入者和接受结果。
- 一个边界消费者测试证明消费者读取已提交 Owner 结果。
- 一个对抗测试证明禁止写入者、过期或错误输入、权威绕过会被拒绝。
- 身份、外部效果、预留、切换或终态可能重复或未知时，必须测试重放、重启和并发。
- 记录仓库现有根门禁和准确证据回执。测试通过不会自动授权下一切片；Main 必须先接收准确证据。

Event Rail 或通知投递永远不是业务证明。保护 Qualification 结果不能反馈同一个 R&D
循环。Risk 不能签发订单，Execution 不能写 Risk 或 Portfolio 状态。

## 文档与 Flow 处置

权威、Object Owner、交接或分支语义变化时，规范契约、Flow 投影、Owner 双语页、受影响场景页和
检查必须一起更新。保持契约的内部实现应声明 Flow 不变。

只有 `guide` `architecture` `owners` `scenarios` 是规范发布根。没有新的 明确且限定范围的用户授权，
任何切片都不能恢复 重新迁移 发布或删除旧源码根。

## Stop 与升级

消费者、写入者、前置条件、判定依据、规范身份或证据未知时必须停止并返回 Main；需要新 Owner
或交接、触碰 14 组或每组五模块上限、需要外部或实盘效果时也必须停止。不能扩大切片掩盖缺失决定。
