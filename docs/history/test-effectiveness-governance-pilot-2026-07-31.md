---
title: Test Effectiveness Governance Pilot
role: engineering-audit-record
status: completed-historical
owner: engineering
last_verified: 2026-07-31 CST
---

# Test Effectiveness Governance Pilot

本记录是一次只读试点，不定义当前 policy；当前规则见
[Quality Assurance System Contract](../engineering/code-quality.md) 与
[Govern Test Effectiveness](../../.agents/skills/run-bounded-mission/references/test-effectiveness-governance.md)。

## 输入

- Owner：`modules/orchestration-ops/trade-flow`；当前 Origin 有 36 个 test files，试点 candidate
  tree 有 35 个，属于现有高测试体量 owner。
- Origin：`149d338550f2769c2d346bdf62ba3a92ddba6751`，tree
  `0fc6ea9f4e0d770a2a8e272a91139b0ec0442745`。
- Candidate：`457a98c29434e0774a0ff30d02f09c5518851b6f`，tree
  `e1e042bc1ae7d406108a091e802bf648aa427310`。
- 不提供 escaped-defect classification：该历史 pair 是影响面样本，不把它伪装为已确认缺陷。

```bash
bun .agents/skills/run-bounded-mission/scripts/test-effectiveness-audit.ts \
  --origin 149d338550f2769c2d346bdf62ba3a92ddba6751 \
  --candidate 457a98c29434e0774a0ff30d02f09c5518851b6f \
  --scope modules/orchestration-ops/trade-flow
```

## 原始输出摘要

- stdout SHA-256：`4e9ad395c43fc328656c384606546979a838f613776c5117376c3fb6cd709548`；
  连续两次执行相同。
- 4 个 changed files、3 个 changed source files、1 个 affected owner；定位 3 个候选测试，
  而不是把 35 个测试全部当作影响证据。
- Consumer leads：owner `CONTRACT.md`、`src/scripts/main.ts`、package scripts 与 5 个
  production reverse importers。
- `server-runtime-container-profile.test.ts` 与其 direct imports 同改；
  `server-runtime-container-status.test.ts` 是 status source 的唯一直接候选 import；
  foreground/profile/status 三个候选均保留规模、assertion、mock/time signal 和 runtime
  unavailable。
- classification 保持 unresolved；3 个动作均为 `further_investigation`，Test Refactor
  Mission 为 `not_recommended`。输出没有宣称 coverage、mutation score、behavioral
  equivalence 或删除安全。

## 人工决策价值与修订

试点把人工审查从 owner 全部测试收敛到 3 个 direct-import/change candidates，并同时给出
unchanged production consumers；审阅者可先判断 status/profile/foreground 哪一层应承担
oracle，再回答 escaped-defect 五问。由于没有缺陷分类与 runtime cost evidence，本次不能
建议新增、替换或删除测试。

初版 helper 以任一 basename token 重合选择 17 个测试，并泄漏内部 `relevant` 标记。该
candidate-local 问题在一次必要修订中改为“测试本身变化或 direct import changed source”，
最终输出收敛为 3 个且公共 JSON 不再包含内部标记。独立复核随后要求把 exact duplicate
降为调查线索，并把不完整 direct analysis 明确命名为
`no_direct_static_candidate_evidence`；刷新后的 pilot 绑定上述最终 stdout identity。未修改
该 owner 的任何测试或业务代码。
