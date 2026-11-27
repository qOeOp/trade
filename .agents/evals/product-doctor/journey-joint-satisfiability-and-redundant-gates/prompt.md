---
description: Rule check (v3.3) — `journey` lens requires all three L4 proofs from an empty temporary environment using only real CLI/IDE commands: joint satisfiability (`A ∧ B ∧ C ∧ D ∧ E`), per-gate independence (`¬X ∧ ⋀(Y≠X)`) to catch shadowed/redundant gates, and refusal → remedy → clear loops without breaking prior gates.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

在上线前，我们需要用 product-doctor 审查一条从研究闭环到 Paper 再到 Live 回环（loopback）的完整准入门控链路（`registration` → `replay` → `validation` → `paper` → `live`）。此前单元测试每一条单独门控都绿了，但我们担心存在三类 L4 缺陷：
1. 组合死锁：单个检查都通过，但真实用户从空白临时环境只跑真实 CLI/IDE 命令，所有前置门控 (`A ∧ B ∧ C ∧ D ∧ E`) 根本无法同时满足；
2. 影子/冗余门控：某个后置拒绝码 `X` 因为上游更早门控必然先报错，在任何可达用户状态下都无法单独触发；
3. 修复破坏前置状态：严格按拒绝文案建议的命令去修补门控 `C` 后，反而破坏了原本已满足的门控 `E`（形成循环或死胡同）。

请按 product-doctor 的 `journey` 视角规范给出完整的诊断协议、证据记录方式、判定分类，以及必须遵守的隔离与凭据边界（不用实际执行命令）。
