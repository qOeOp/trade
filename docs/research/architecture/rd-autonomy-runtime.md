---
title: R&D Autonomy Runtime
role: research-feature-contract
status: active-partial
owner: research-strategy-development
last_verified: 2026-07-30 CST
---

# R&D Autonomy Runtime

## 1. 当前闭环

J04 现在由 `research.rd-autonomy-cycle` 唤醒，但既有 `research.rd-supervisor` 仍拥有 Trial/Result/learning writeback。autonomy cycle 只补 empty/unready queue：

```text
plan_next
  -> stopped: terminal, zero model/Trial
  -> ready: existing rd-supervisor, zero model
  -> blocked + active/budgeted
       -> hypothesis model_task -> gateway -> domain assessment
       -> invalid/unready/provider failure: no state write, no Trial
       -> ready queue proposal -> queue_proposal(updated_at CAS)
       -> existing rd-supervisor
```

J05 forward tracker 与 J07 review 继续按自身 state/cadence 运行；它们不迁入 autonomy cycle，也不能因模型 proposal 自动 promotion。

这只是当前已实现 projection，不是长期策略工厂的最终停止语义。当前 `budget_exhausted / shadow_candidate_found / data_or_tool_blocked` 会令 program terminal，且 empty queue 只尝试一次 hypothesis model task；它尚不能代表无人值守持续研发。

## 2. 不变量

- task/idempotency identity 来自 program plan 与 cycle；重启同一 proposal 只能得到 identical duplicate 或 stale/conflict failure。
- `queue_proposal` 只接受 `ready=true`，要求精确 prior `updated_at` 且原子推进时间；同 hypothesis id 内容不同直接冲突。
- queue CAS 之前，模型/adapter 均无 state write；CAS 之后只由原 supervisor 消费 queue 并管理 Trial reservation、Result publication、预算和 writeback。
- `budget_exhausted / shadow_candidate_found / data_or_tool_blocked / paused` 不调用模型；已有 ready plan 也不浪费模型预算。
- `no_promote` 是研究完成结果，不是 promotion；Reviewer/Strategy Registry authority 不变。
- 全链禁止 `trade.db`、exchange write、自动打开 locked holdout、自动 draft/promotion 与执行 authority。

## 3. 失败与恢复

| 故障 | 结果 |
| --- | --- |
| credential/provider/timeout/invalid JSON | 本轮 `blocked/retryable` proposal result；RD state 保持原 active plan，可在后续 cadence 重试 |
| hypothesis schema/data/family 不 ready | no state write、no Trial；保留 assessment blocker |
| CAS stale/conflict | 本轮失败并由 runtime incident 观察；不得覆盖新状态 |
| identical proposal replay | `duplicate=true`；queue 仅一份，随后 supervisor 依既有 Result/Trial idempotency 恢复 |
| supervisor/worker crash | 沿用 Control Plane reservation、Result publication 和 program state 恢复；autonomy cycle 不制造第二套 Trial authority |
| program terminal/paused | zero model、zero supervisor |

## 4. 当前证据与采用门

本地编译测试已覆盖 stopped/ready/blocked 三分支、有效 proposal 的固定调用顺序、失败零写入、CAS 首次写入、identical duplicate、stale writer 与同 ID 冲突；J04 automation fixture 验证 registry/cwd/profile/禁止写面，既有 Control Plane 测试继续覆盖 `no_promote`、Trial completion/failure 与 Result publication。

仍未完成真实 provider + owner CLI 的端到端 campaign、进程 kill/restart 下“单 proposal/单 Trial/单 Result”演练、J04/J05/J07 长时 cadence soak，以及 server secret/incident/usage 观测。因此保持 `active-partial`；当前 server config 仍不据此获得 live 或 promotion authority。

## 5. 目标长期 R&D Factory

目标长期运行的是 Program / Control Plane，而不是一个不退出的 Agent session：

```text
durable Factory state
  -> choose ready deterministic work
  -> or dispatch bounded Planner / Developer / Reviewer Agent Run
  -> validate / freeze / reserve
  -> deterministic Trial / Replay / Forward
  -> evidence / lifecycle decision / learning
  -> choose next work, wait for dependency, or open another Campaign
```

状态和预算分两层解释：

- Campaign / Agent Run / Trial 可以 `budget_exhausted`、blocked、failed 或 candidate found；其终态必须保留并停止继续消耗。
- Factory 不因一个局部终态永久退出；它在并发/成本/安全 policy 允许时继续其他 program、创建后续 Campaign，或等待数据、代码 release、forward 样本和人工审批。
- token、trial、compute、wall time、并行度和 locked holdout 使用继续有界；不建立无界搜索或自动 promotion。
- 当前 `RdProgramStatus` 和 J04 terminal 分支尚未完成这次分层，迁移前不得把现有 supervisor 描述成持续策略工厂。

Factory 的输入不只来自 ready queue：还包括 cited research finding、失败与 rejected mechanism、forward/live decay、closed-flow review 和 Governance improvement request。外部来源只构成 `research_basis`；实验、forward 和 live evidence 保持独立。Research Source 当前只完成 P0 合同/尖峰，完整接入按 [Research Source Knowledge Integration](../sources/research-source-knowledge-integration-plan.md) 推进。

family 是 Strategy Universe 中稳定的机制身份；family implementation 才是某 engine / release 对该机制的代码实现。一个 family 可以只有 design / data backlog，也可以只具备 panel / Replay 能力而尚无 Runtime 能力。一个策略版本由 MD policy、compiled contract、证据和 implementation / Agent policy binding 冻结：

```text
Universe taxonomy -> family identity
  + strategy.md -> compiled Strategy Contract
  + family implementation or bounded Agent policy
  -> frozen strategy version binding
  -> setup
  -> trade flow
```

Developer 先做 capability assessment：区分机制是否已有 family identity，以及 data、Replay、portfolio、signal 和 Runtime implementation 分别是否 ready。目标 engine 已有实现时，只提交受 schema 约束的候选合同，Strategy Registry 从 accepted Contract 确定性物化；不得默认为每个策略生成任意代码。实现不足时只能生成隔离 patch 和 capability request；新机制还需先审查 family identity，不能用代码变更偷换旧 family 语义。代码必须经过 CI、code review、release 和新一轮实验，不能由 Factory 热改生产进程；等待 release 的 hypothesis 不占用 Trial / Agent slot。

MD 与代码不要求双向等价。机器 Trade Contract 单向编译为 Strategy IR；叙事段供用户 / Agent 理解。明确需要语义判断的 policy 可形成 bounded Agent Run 输入，但其 proposal 必须结构化验证，且没有 deterministic Replay parity 时不得继承该类证据。当前 `rnd_family_v1` MD 已能进入静态 R&D family implementation；`manual_policy_v1` 只能编译 / lint，Signal Evaluator 会拒绝，服务器 Agent-assisted runner 尚未实现。

新 release 只服务新策略版本和新 setup。已有 flow 继续绑定旧 MD source、contract、implementation / Agent policy 与 release identity，直至 exposure、recovery 和 evidence 依赖全部闭合；当前完整 binding 与兼容回收门尚未实现。

## 6. 目标 Agent Host 映射

本节只澄清未来边界，不改变上述当前闭环。当前 hypothesis model task 不是完整自主研发 Agent，也不等同于 canonical Planner Proposal v2。

目标由 Program / Control Plane 在出现语义缺口时，分别提交 Planner、Developer、Reviewer Agent Run；Host 可用 OpenClaw、Codex 或其他 adapter。Host 只产生 typed submission：

```text
Planner submission
  -> Control Plane admission
  -> Developer submission
  -> deterministic validation / freeze / Trial / Replay Result
  -> Reviewer submission
  -> Control Plane decision writeback
  -> Strategy Registry / Forward / Governance
```

Replay、Trial/Result、策略物化、promotion、pause/retire 均不迁入 Host 或 LangGraph checkpoint。详细迁移与远程部署分别见 [Agent Host Runtime Integration](../../architecture/migrations/agent-host-runtime-integration-plan.md) 和 [Remote Container Runtime Integration](../../architecture/migrations/remote-container-runtime-integration-plan.md)。

### 6.1 Agent-native 研发不是一次模型调用

Strategy Factory 中不能代码化的核心不是 Replay accounting，而是问题发现、策略语义、代码修改与失败诊断。目标 Agent Run 必须能：

- 读取 Universe、策略 MD、implementation、历史 Result / rejected mechanism 和带 citation 的 research finding。
- 判断 hypothesis 只需新参数 / MD version，还是缺 data / indicator / family implementation / portfolio / execution capability。
- Developer 在冻结 revision 的隔离 worktree 修改 MD、代码和测试；运行 allowlisted owner package / repository suite checks。
- 通过 owner MCP 请求 dataset、Trial、Replay 和 artifact read；Replay owner 生成唯一 Result，Agent 不直接写研究事实。
- 根据失败证据继续修改或终止，不因“一次回测失败”退出整个 Factory，也不以重复参数搜索伪装进展。
- 返回 patch、typed submission、test refs 和 evidence refs；CI / review / release 仍在 Agent 外。

远程采用门必须以当前 Codex 多轮研发体验为 baseline。优先候选是 Codex App Server coding kernel，可由 OpenClaw Gateway 常驻托管；OpenClaw 自身 alternate runtime 作为独立 profile 比较。LangGraph 只在单次 Run 需要 Host 原生 loop 无法满足的显式分支 / interrupt / checkpoint 时评测，不复制 Control Plane。

回测证据分层：

| 形态 | 执行 | 证据权限 |
| --- | --- | --- |
| mechanical Replay | compiled strategy + frozen implementation + deterministic Replay owner | 可进入既有统计 / promotion gate |
| Agent-assisted historical evaluation | frozen MD semantic input + model/provider/prompt/toolset + 有界历史决策点 | 探索 / 语义一致性；不能冒充 Replay 或单独 promotion |
| Forward / shadow Agent policy | 冻结 policy 对未来事实逐次输出 typed decision | 独立 Agent-policy evidence；需另设稳定性、成本与漂移 gate |

Agent-assisted 不是“让 LLM 伪造整个历史交易”。数据切分、可见事实时间、decision identity、成本 / Fill 模拟与结果登记仍由 owner 冻结；模型只在声明的 semantic decision points 产出候选判断。
