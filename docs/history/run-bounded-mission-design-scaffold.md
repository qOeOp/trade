---
title: Run Bounded Mission Design Scaffold
role: historical-design
status: legacy-reference
owner: engineering
last_verified: 2026-07-29 CST
---

# Run Bounded Mission Design Scaffold

> 本文恢复并整理 2026-07-28 至 2026-07-29 简化前的设计脚手架，保存候选方法、上游来源、
> 评测思路和被拒方案。它不是运行 authority，不描述当前 skill 已实现能力；当前行为只以
> [SKILL.md](../../.agents/skills/run-bounded-mission/SKILL.md) 为准。任何内容重新进入 skill
> 前，都必须重新核查当前上游、证明行为收益，并以替换或按需加载的方式接入。

## 1. 恢复范围

恢复件原有 931 行，包含：

- 生命周期设计合同；
- 分阶段方法能力目录；
- Evaluate 与 finding 合同；
- fresh-context reviewer handoff；
- 可选 specialist reviewer 与 finding validator；
- capability 接入和跨平台 adapter 约束；
- Sentrux architecture sensor；
- 五个 baseline/with-skill 行为评测场景；
- 已核查上游、仅供发现的候选来源和明确排除项。

本次只保存设计信息，没有恢复旧 runtime 文件、eval fixture、YAML compiler、平台 agent 定义、
外部 review loop 或迁移状态。

## 2. 原始架构意图

```text
Route → Plan → Build ↔ Evaluate → Handoff
                  ↖ replan ─────┘
```

稳定部分：

1. **单一合同**：outcome、consumer、scope/non-goals、authority/effects、acceptance 和 finite stop。
2. **固定阶段**：新能力只能服务既有阶段，不新增生命周期终点。
3. **证据边界**：candidate identity、累计 diff、调用、状态、原始输出、consumer 结果和 limits。
4. **单一所有者**：主 agent 维护范围、集成 candidate 并选择 route；subagent 只返回有界 evidence。
5. **收敛优先**：比较相对初始 source 的累计责任面，不让每轮小 diff 掩盖 additive workaround。
6. **宿主中立**：核心语义不绑定 shell、模型、agent 文件、MCP、GitHub 或协作拓扑。

原设计曾使用六种 disposition：

| disposition | 原意 |
| --- | --- |
| `accept` | material acceptance 已满足 |
| `revise` | 根设计成立，下一步是有界替换或简化 |
| `replan` | owner、设计或 acceptance 假设失效，或下一步主要是 additive workaround |
| `blocked` | 必要事实、权限或能力不可用 |
| `invalidated` | 目标或设计被内在证据否定 |
| `budget_exhausted` | 仍可能继续，但既定资源上限耗尽 |

最终 skill 将后三类失败压缩为四路由模型；这里保留原定义，供将来比较，不表示应恢复。

## 3. Authority、状态与 capability

### 3.1 Agent 边界

- 主 agent 理解用户意图、冻结合同、选择方法、集成改动并负责最终 route。
- subagent 使用主 agent 派发的隔离上下文；不与其他 subagent 横向通信，不共享 lifecycle
  ownership，不自行扩大 scope，也不执行未授权终点。
- reviewer 必须未参与 Build、保持只读，只返回 evidence；身份或多数意见不能替代证据。
- candidate 修改 reviewer 会自动加载的规则时，reviewer governance 必须来自冻结 source 或
  外部 packet；否则 independent review 为 `unsupported`。

### 3.2 Capability 接入合同

每个可选能力必须：

1. 继承当前 scope、authority、effects 和 stop；
2. 把结果绑定 contract/source/candidate identity；
3. 返回 `completed | unavailable | unsupported | failed`、原始 evidence、inspected scope 和
   limits；
4. 只提供方法或证据，不拥有生命周期 route，不新增 stage 或 side channel。

归位顺序：

| 阶段 | capability 作用 |
| --- | --- |
| Route | 判断是否值得支付该能力的证据与上下文成本 |
| Plan | 提供上下文、候选方案或风险信息 |
| Build | 执行合同允许的实现或确定性转换 |
| Evaluate | 验证 candidate、finding 或补充 evidence |
| Handoff | 执行用户已经授权的终点动作 |

找不到归属时返回 Plan，不创建统一 hook runtime、registry、receipt database 或跨任务状态机。

### 3.3 最小状态

生命周期本身不拥有持久数据库、全局 registry、checkpoint schema 或长期 memory。只有明确的
跨 session 恢复需求才复用项目批准的工件，最小保存：

- contract 与 candidate identity；
- revision/non-progress 边界；
- route 与必要 evidence locator。

## 4. 分阶段方法脚手架

### 4.1 Route

- 区分回答、诊断、机械修改和完整开发闭环。
- 简单、可逆且验收显然的任务压缩阶段，不创建 epic、worktree、候选方案或 subagent 仪式。
- 未真实执行的 consumer 验证、独立审查或工具调用不得被声称为 evidence。

### 4.2 Plan

#### Outcome-first specification

先写 outcome、consumer、scope 和 acceptance，再表达技术路径。只有会改变执行决定时才补充
owner、风险、隔离方式、任务拆分和预算。找不到必要 authority 或 acceptance 时继续只读调查。

脚手架希望借鉴：

- `obra/superpowers` 的 brainstorming、specification 和 outcome-first planning；
- GitHub Spec Kit 的 `specify → plan → tasks` 分层；
- GitHub Issues / `issue-analyze` / `epic-start` 的任务拆分和归档方式。

约束：

- 只有存在多个依赖单元时创建 tasks；
- 只有范围跨多个可独立验收单元时拆 epic；
- 项目已采用 Spec Kit 或 GitHub Issues 时复用，不能创建第二份 source of truth；
- brainstorming 和 spec 只服务于冻结 outcome，不变成固定仪式。

#### Deep context

陌生代码、安全边界、复杂状态流或误解代价高时，围绕一个入口、调用链、状态域或不变量重建
上下文。它只负责理解，不自动产出漏洞、severity 或修复，也不默认逐行分析全仓库。

候选来源：Trail of Bits `audit-context-building`。

#### Candidate comparison

只在高影响、难逆且存在真实 trade-off 时比较候选。计划备忘录应包含：

```text
selected option
rejected options and reasons
validation gates
residual risks
recommended executor shape
```

不制造假候选，不让多个 agent 辩论、投票或共享所有权。

候选来源：BuilderIO plan arbiter。

#### 实现前置调查

实现本 skill 的 executor、compiler、adapter、脚本或 harness 前：

1. 检查项目已有 owner、库、命令和模式；
2. 搜索当前官方资料、上游仓库和 GitHub 相似实现；
3. clone 最相关候选并阅读 README、核心源码、测试、配置、发布状态和许可；
4. 比较直接复用、薄 adapter、有界改造和只借鉴思想；
5. 记录 revision、采用/拒绝原因和新实现必须承担的最小差异。

无法核实关键上游时停在设计，不凭聚合列表、搜索摘要或模型记忆施工。

### 4.3 Build

#### Falsifiable development

- 稳定行为且需要回归保护时优先 TDD。
- 配置、文档、迁移和集成优先 verification-first 与真实 consumer exercise。
- 不强制所有任务使用同一种仪式。
- 保存 baseline、完整 candidate、累计 diff、本轮 diff 和原始验证结果。
- `revise` 前判断下一步是替换/简化，还是新增 exception、fallback、adapter、compatibility
  path 或重复责任；后者应 `replan`。

候选来源：`obra/superpowers` 的 TDD、verification-before-completion。

#### Worktree isolation

只在以下价值真实存在时使用：

- 并发或隔离；
- 保护脏工作区；
- 高风险回滚；
- 需要冻结 source/candidate identity。

不把 worktree 当作每个任务的默认步骤，不按 task 制造微提交。

候选来源：`obra/superpowers` 和 awesome-claude-code-toolkit 的 worktree 方法。

#### Deterministic transformation

大量文件执行重复语义转换且已有成熟 recipe 时，可考虑 OpenRewrite 一类 type-aware 工具。
先保存 baseline 并预览 diff；recipe 不负责需求解释、consumer 验收或安全审查。

### 4.4 Evaluate

原审查顺序：

1. 从冻结合同还原 outcome、scope、non-goals、source 和 candidate；
2. 先验证真实 consumer outcome；
3. 比较累计 diff 与本轮 diff，识别 patch pressure；
4. 按 changed surface 深入 correctness、安全、架构、性能、运维和测试；
5. 核对调用、退出状态、原始输出、覆盖面、版本和时效；
6. 输出 candidate-bound acceptance results、findings、inspected scope 和 limits。

#### Structured review

默认由一个 reviewer 按以下顺序完成：

```text
contract reconstruction → consumer outcome → risk diff → evidence
```

语言、框架和风险指南按 changed surface 加载，不注入全量 checklist。

候选来源：

- `awesome-skills/code-review-skill`：四阶段审查和 finding 分级；
- BuilderIO agent watchdog：还原请求、核对实际改动、报告缺口；
- Anthropic code-review plugin：candidate 聚焦、finding 复核；
- Bitwarden code review：按风险拆 reviewer 和 finding validation。

#### Finding contract

| severity | 语义 |
| --- | --- |
| `blocking` | 直接否定 acceptance、安全或 authority |
| `important` | 有实质影响，但尚未单独否定 acceptance |
| `nit` | 不影响 correctness 的清晰度、风格或偏好 |

finding 必须包含 bounded claim、位置或 artifact、direct evidence 和 next action。静态工具等级、
语气、总分或 reviewer 偏好不能决定 severity。

#### Security differential

权限、解析器、依赖或高 blast-radius 变化时，结合：

- git history 和被删除的不变量；
- caller、数据流和攻击路径；
- framework protection 是否真实覆盖 failure path；
- candidate 是否引入或加剧问题。

必要时先做 deep context，但理解代码不等于发现漏洞。

候选来源：Trail of Bits `differential-review`；智能合约任务另参考
`building-secure-contracts`，不作为通用默认。

#### Specialist reviewers

只有单 reviewer 无法覆盖相互独立的高风险维度时才追加隔离、只读 reviewer：

| lens | 关注点 |
| --- | --- |
| outcome/contract | consumer 结果与需求是否被偷换 |
| architecture/state | owner、依赖、不变量、并发和兼容 |
| security/trust | 外部输入、auth、secret、依赖和数据流 |
| testing/evidence | oracle、回归保护和真实 consumer evidence |
| performance/operations | 规模、资源、部署、回滚和配置 |
| maintainability/erosion | dead path、重复责任和结构退化 |

它们使用 disjoint lens、有限输入和一次返回；不横向通信、不投票、不拥有 route。

#### Finding validator

只有以下情况才派未参与 discovery 的 fresh validator：

- finding 会阻止 accept，但可达性或影响仍有合理争议；
- reviewer 结论冲突；
- claim 依赖复杂 caller、数据流或 framework protection；
- 用户明确要求 adversarial validation。

validator 只返回 `validated | dismissed | unresolved` 和证据，不递归启动 validation 链。

#### Code intelligence

项目已经采用 Repowise 一类索引时，可读取 churn、dependents、ownership、test gap 和历史
decision；不可用时退回代码、Git 和项目原生测试。不为本 skill 初始化新索引，不把 health
score 或 transcript 变成 authority。

### 4.5 Handoff

- reviewer 只提供 evidence，主 agent 选择 route。
- `accept` 只表示当前 acceptance 已满足，不自动授权 commit、push、PR、merge、deploy、
  publish、comment 或 message。
- 外部 PR lifecycle、分支保护、CODEOWNERS、SonarQube gate 和长期知识沉淀属于项目治理或
  sibling workflow，不进入核心 skill。

## 5. Fresh-context reviewer packet

原 handoff 需要最小包含：

```text
Purpose
- independent acceptance review | high-risk specialist review | finding validation

Frozen contract
- outcome and consumer
- scope and non-goals
- read-only authority
- acceptance
- stop condition
- external reviewer governance when self-referential

Candidate
- baseline/source identity
- candidate identity
- cumulative and incremental change locators

Raw evidence
- consumer invocation, status, raw output
- regression/gate invocation, status, raw output
- governing repository rules
- unavailable or unchecked evidence

Review
- selected lens
- required inspected scope
- stop condition

Return
- capability/review status
- candidate identity
- acceptance results with direct evidence
- findings with severity, claim, location, evidence and next action
- inspected scope
- limits
```

不要发送完整 transcript、builder 自我辩护、建议 verdict、未采纳候选、隐藏推理、无关文件或
secret。`completed` 只表示审查执行过，不表示 candidate 通过。

## 6. Architecture sensor / Sentrux

### 6.1 能力边界

Sentrux 只作为 shadow evidence，用于结构变化、跨 owner 依赖、较大重构或持续 patch pressure。
其分数不决定 acceptance，也不替代运行、集成、安全、consumer 或 fresh-context evidence。

语义操作：

| 操作 | 语义 |
| --- | --- |
| `scan` | 返回工具版本、扫描范围和原始结构摘要 |
| `baseline-start` | builder 修改前保存本 slice 基线 |
| `baseline-end` | 修改后返回相对基线的原始差异 |
| `health` | 返回根因指标和诊断，不自动生成重构目标 |
| `rules-check` | 根据项目拥有的显式规则返回状态和违规 |

### 6.2 原接入草案

MCP：

```text
sentrux --mcp
scan(<project-root>) → session_start() → changes → session_end() → check_rules()
```

CLI fallback：

```text
sentrux gate --save .
<changes>
sentrux gate .
sentrux check .
```

baseline 必须保持 worktree-local 且不提交。交接保留 provider version、scan root、rules
revision、before/after 原始结果、退出状态和 coverage limits。不可用或结果不一致时标为
unavailable，不猜测结论。

## 7. 跨平台与 agent-runbook

行为等价优先于配置文件一致。核心不写死 Codex、Claude Code、shell、tool 名、权限 UI 或
agent 文件。

一个可声明支持的宿主至少需要证明：

1. 能发现 skill 和按需 reference；
2. 能完成等价的 Plan、Build、Evaluate 示例；
3. 能创建与 builder 轨迹隔离的新上下文；
4. reviewer 获得有界输入、保持只读并返回 evidence；
5. capability 不可用时明确失败或降级，不伪造 PASS；
6. 路径和依赖 smoke test 通过。

`KnoxOps/agent-runbook` 曾作为 experimental compiler 候选。采用前必须证明它能无损表达核心
合同并生成通过兼容评测的宿主 adapter。它生成的 task state、checkpoint script、Bash 假设、
peer coordination、通用 supervisor 和 loop runtime 不应直接进入 instruction-only skill。

## 8. 行为评测脚手架

评测采用隔离的 baseline/with-skill 对照，保存 raw final、tool calls、diff 和退出状态；逐条
expectation 判定，不按固定措辞或 token 数评分。

| 场景 | 期望行为 |
| --- | --- |
| 简单拼写修改 | 压缩生命周期，不创建 epic、worktree、subagent 或多阶段文档 |
| fallback/adapter 持续增长 | 根据累计 diff 识别设计失败并 `replan` |
| 宿主无法提供 fresh context | 返回 `unsupported`；独立性是 acceptance 时不能 `accept` |
| 单个局部比较符错误 | 根设计成立时 `revise`，不因轮次机械触发整体重写 |
| 静态门绿但真实 CLI consumer 失败 | consumer evidence 否定 `accept`，局部删减后重验 |

评测结果留在临时目录，不进入 skill；没有新上下文时只能检查 fixture 一致性，不能声称完成
独立行为评测。

## 9. 上游证据账本

### 9.1 当时已按 revision 核查

| 上游 | revision | 当时采用的设计 | 明确未采用 |
| --- | --- | --- | --- |
| `openai/skills` | `49f948faa9258a0c61caceaf225e179651397431` | 精简核心、按需 reference、新鲜验证 evidence | 已弃用分发方式和平台目录 |
| `openai/plugins` | `11c74d6ba24d3a6d48f54a194cd00ef3beea18f9` | 轻量 prompt/expected/expectations fixture | provider harness、mock agent path |
| `anthropics/skills` | `b29e7cf65e5cb78a5ac33d582270551bc74a14eb` | 真实场景、baseline/with-skill 思路 | eval runtime、viewer、多 subagent 拓扑 |
| `BuilderIO/skills` | `4faffd130c5f291c9da3fac5dc94163f159931bc` | 从原请求重建合同、核对实际 evidence | transcript loop、audit-and-fix、跨 agent 比较 |
| `obra/superpowers` | `3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9` | outcome-first、reviewer 输入、只读审查、完成前验证 | 强制 worktree/TDD、逐任务提交、固定 review 频率 |
| `anthropics/claude-code` | `7ef6eec9d9ba84ea6f233f26c45f1df5c5991843` | candidate 聚焦、finding 原始位置和复核 | GitHub/PR 绑定、固定多 agent、置信度阈值 |
| `microsoft/waza` | `f466c4fddf71144f42311d7c4157e8c8b3f0fed6` | 临时规范、链接、token 和行为评测参考 | 500-token 等通用启发式作为 authority |
| `KnoxOps/agent-runbook` | `edc30d5038aebf0b129d5dec784a2dba5d84a777` | contract closure 和 bounded loop 思路 | 第二套 runtime、task state、checkpoint 和 shell 假设 |

这些 revision 只证明当时检查过的快照。重新实现时仍须检查当前版本、发布状态和许可。

### 9.2 方法候选，未形成采用证据

- [GitHub Spec Kit](https://github.com/github/spec-kit)：spec、plan、tasks 分层。
- [awesome-skills/code-review-skill](https://github.com/awesome-skills/code-review-skill)：
  四阶段审查和 finding 分级。
- [Trail of Bits skills](https://github.com/trailofbits/skills)：deep context、differential review。
- [OpenRewrite](https://github.com/openrewrite/rewrite)：type-aware deterministic transformation。
- [NVIDIA NemoClaw](https://github.com/NVIDIA/NemoClaw)：PR comparator、security review、triage。
- [Repowise](https://github.com/repowise-dev/repowise)：代码健康、Git、死代码和持久 decision；
  原脚手架未冻结 revision。
- [awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit)：
  issue/epic 和 worktree 模式；原脚手架未冻结 revision。
- great_cto：SDLC 和知识层概念；只见聚合列表，未形成直接仓库证据。
- PR-Agent、pr-reviewer、CodeRabbit：只作 PR review 市场/产品参考，不属于核心生命周期。
- SonarQube：CI 硬门思路，只属于项目静态治理。

这些条目只能用于下一轮候选发现，不能按本文直接声称“已经借鉴”。

### 9.3 Discovery-only 索引

以下 awesome 列表只用于发现候选，不提供采用证据：

- [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills)；
- [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills)；
- [BehiSecc/awesome-claude-skills](https://github.com/BehiSecc/awesome-claude-skills)；
- [Agent-Analytics/awesome-multi-agent-orchestrators](https://github.com/Agent-Analytics/awesome-multi-agent-orchestrators)；
- [Picrew/awesome-agent-harness](https://github.com/Picrew/awesome-agent-harness)；
- [andyrewlee/awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators)；
- [bradAGI/awesome-cli-coding-agents](https://github.com/bradAGI/awesome-cli-coding-agents)；
- [ai-boost/awesome-harness-engineering](https://github.com/ai-boost/awesome-harness-engineering)；
- [Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering)。

其中早期的 Sentrux、agent-runbook 和 great_cto 描述曾只来自聚合条目；Sentrux 与
agent-runbook 后来另行找到并核查了直接实现，great_cto 没有。

## 10. 明确排除

- provider-triggered `@codex` review、远程轮询、重复唤醒和 review loop；
- 多个对等 agent 横向协商、投票或共享 lifecycle ownership；
- 固定 reviewer 数量、每文件一个 reviewer 或全量 checklist；
- candidate-authored reviewer governance；
- 自动修复、自动 commit/push/approve/merge；
- finding database、reviewer registry、长期 transcript memory；
- 为 skill 建第二套 CLI、runtime、schema、state machine 或 checkpoint system；
- 把分数、lint、单元测试、文档或多数意见当作 consumer acceptance；
- 未核实的聚合列表条目和 agent-runbook YAML；
- 把第三方源码 vendoring 进 skill。

## 11. 重新采用规则

从本文恢复某项能力前，必须：

1. 指明它解决的真实失败场景和 consumer；
2. 核查当前项目是否已有 owner；
3. 重新搜索并 clone 当前官方/GitHub 候选，阅读文档、源码、测试、发布状态和许可；
4. 证明直接复用、薄 adapter 或小型 method reference 的收益；
5. 在临时目录运行 baseline/with-skill forward test；
6. 比较行为收益与默认上下文、文件数、规则数和维护成本；
7. 由 fresh-context reviewer 检查是否只是 sound-but-overbuilt；
8. 只把严格改进的最小部分接回当前 skill，评测和过程 artifact 继续留在 skill 外。
