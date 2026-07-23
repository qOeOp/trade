# R&D Agent Run Orchestrator Contract

## Responsibility

- Freeze Control Plane-issued Planner, Developer, and Reviewer context into provider-neutral Agent Run requests.
- Validate terminal Agent output against the bound context, role submission contract, source revision, and evidence policy before calling an existing R&D owner write.
- Preserve restart-safe seams: immutable input/output refs plus the ops-owned Agent Run registry are sufficient to resume admission without Host transcript or reasoning.

## Boundaries

- This module does not implement a model loop, Host transport, workspace, Replay engine, Trial/Result store, strategy materialization, promotion, or exchange write.
- Agent output always has `domain_authority=none`; only existing state-store, Replay, Registry, Forward, and Governance owners may commit effects.
- Host transcript, chain-of-thought, arbitrary files, secrets, locked holdout contents, and unregistered evidence are never accepted as Control Plane facts.
- Planner context/admission, Developer capability/draft intake, and Reviewer evidence/lifecycle admission are implemented behind the same contract without bypassing current owner APIs.
- Developer patches remain review artifacts only; this module neither applies them nor treats Agent-assisted historical evaluation as mechanical Replay.
