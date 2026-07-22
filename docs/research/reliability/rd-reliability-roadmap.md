---
title: R&D Reliability Roadmap
role: research-roadmap
status: active
owner: research-strategy-development
last_verified: 2026-07-22 CST
---

# R&D Reliability Roadmap

目标：先证明数据、实验、执行和证据链可信，再扩大策略搜索。本文只给可靠性维度与退出条件，不复制快速变化的 milestone 进度。

当前 Replay maturity、active milestone 和 gate truth 只看 [rd-replay-maturity-gate.json](./rd-replay-maturity-gate.json)；过程问题与修复记录写入 [rd-audit.md](./rd-audit.md)。

## 1. 数据可靠性

要求：

- universe、listing / delisting、source revision 与 availability point-in-time。
- discovery / validation / locked holdout 预先分离。
- OHLCV、funding、status、supplemental source 有 coverage、freshness、completeness 和 lineage。
- 缺失数据产生 blocker / limitation，不自动缩小样本或降低门槛。

退出信号：任一 Result 可回到冻结 dataset / split / source bytes 或 owner store ref，未来数据不会改变已冻结输入。

## 2. 统计可靠性

要求：

- 完整 trial universe、预算和 rejected candidate 可重建。
- effective sample、cost stress、regime robustness、parameter stability 与 family-appropriate negative control。
- selection / multiple-testing 风险显式，不只报告 winner。
- locked holdout 不被 hypothesis 生成、调参或事后筛选消费。

退出信号：轻微正收益、样本不足、negative control 未过或依赖单一 regime 的候选不会进入下一阶段。

## 3. 执行现实

要求：

- fee、slippage、funding、turnover 与 missed-fill 分开归因。
- replay / forward / live-small 的 order、timing、position 与 cost vocabulary 可映射。
- 无 L2 / queue / historical status 时不伪造 maker probability、impact 或精确 intrabar path。
- 模拟能力只按已通过 maturity gate 的场景声明。

退出信号：系统能区分 gross edge 不足、成本吞噬、execution mismatch 和数据模型缺口。

## 4. Evidence 与生命周期

要求：

- Contract、Trial、Result、Review、Artifact、Fingerprint 与 promotion decision 各有 owner。
- append-only / create-or-identical；重试不产生第二个权威结果。
- artifact 缺失、hash drift、source unavailable 和 stale evidence fail closed。
- external rationale、empirical evidence、shadow / live attribution 不互相代替。

退出信号：任一策略资格都能沿 typed refs 回到原实验、数据、代码、成本和治理裁决。

## 5. 自动研发纪律

要求：

- calibration / capability gate 通过后才消耗 trial。
- failure summary、rejected mechanism 和 lesson 约束下一条 hypothesis。
- 新 hypothesis 必须有机制差异，不是对失败候选追加事后过滤器。
- budget exhausted、data/tool blocked、no_promote 都是正常终态。
- agent 不直接改权威 state、strategy status 或 promotion。

退出信号：自动循环能在预算内停止，且失败比“漂亮但不可审计的候选”更容易保存。

## 6. Forward 与 live alignment

要求：

- frozen candidate 之后的 forward / shadow 样本完整保留，包括 no_action、expired、blocked 和 missed execution。
- replay-to-shadow、shadow-to-live 的 performance / cost decay 可归因。
- live-small 资格需要 fresh evidence，不因旧回测或少数盈利案例永久有效。

退出信号：真实执行偏差能反馈到下一轮成本与策略假设，不直接覆盖历史研究结果。

## 7. 优先级

1. 修复会污染既有证据的正确性问题。
2. 闭合 active maturity gate 中已有 consumer 的缺口。
3. 补数据 / source completeness 与真实执行 attribution。
4. 才扩大 family、trial 数量或 simulator capability。

任何 roadmap 项只有在 owner contract、真实 consumer、durable evidence 和 executable check 同时存在时才算完成。

## 8. Replay 收敛顺序

Replay 的 M4-P1–P29 功能纵切已冻结；不得继续创建 P30。后续只允许：

1. 依 [capability inventory](./rd-replay-capability-inventory.json) 收敛 canonical / opt-in / compatibility owner boundary。
2. 完成 [maturity gate](./rd-replay-maturity-gate.json) 中固定九项 M4 exit gates，使现有能力成为一个有限、可解释、可认证的产品面。
3. M4 完成后只做固定九项 M5 release certification，不增加 simulator capability。
4. M5 后进入 maintenance；新市场语义必须由显式架构重开决定，不能借 bugfix、schema epoch 或自动迭代隐式扩权。

提交数、schema 数、测试数、successor 数与 P 编号都不是 maturity 指标。M4 只奖励归并，M5 只奖励可复现、迁移、故障恢复、容量和独立发布审计。
