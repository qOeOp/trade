# R&D Agent Run Orchestrator Contract

## Responsibility

- Freeze Control Plane-issued Planner, Developer, and Reviewer context into provider-neutral Agent Run requests.
- Validate terminal Agent output against the bound context, role submission contract, source revision, and evidence policy before calling an existing R&D owner write.
- Preserve restart-safe seams: immutable input/output refs plus the ops-owned Agent Run registry are sufficient to resume admission without Host transcript or reasoning.
- Reviewer 只接收有完整 summary hash / bytes / artifact ref 绑定的有界证据摘要；逐笔 trade、candle、fill 等高基数明细留在不可变 Result artifact，不随样本量线性灌入模型上下文。

## Boundaries

- This module does not implement a model loop, Host transport, workspace, Replay engine, Trial/Result store, strategy materialization, promotion, or exchange write.
- Agent output always has `domain_authority=none`; only existing state-store, Replay, Registry, Forward, and Governance owners may commit effects.
- Host transcript, chain-of-thought, arbitrary files, secrets, locked holdout contents, and unregistered evidence are never accepted as Control Plane facts.
- Planner context/admission, Developer capability/draft intake, and Reviewer evidence/lifecycle admission are implemented behind the same contract without bypassing current owner APIs.
- Developer patches remain review artifacts only; this module neither applies them nor treats Agent-assisted historical evaluation as mechanical Replay.
- Planner / Developer / Reviewer CLI 对共享 Research State Store 使用有界 SQLite busy wait；并发幂等恢复可等待当前 owner write，但不得无限阻塞或创建第二个领域 effect。
