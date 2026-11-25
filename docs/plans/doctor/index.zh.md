# Doctor

发现只记在带 `agent-finding` 标签的 [GitHub issue](https://github.com/qOeOp/trade/issues?q=label%3Aagent-finding) 里（英文；规则见 product-doctor 的 `record.md`，[决定](../doctor-issues-20261123.zh.md)）。本页只留有意保留的形状。

2026-11-23 之前的行（含 `fixed` 而未复验的 146 行）冻结在[切换前的索引](https://github.com/qOeOp/trade/blob/780a7ea08/docs/plans/doctor/index.zh.md)里，只读：整体审计从那里取未复验的行重跑证明，仍出现的开新 issue 并写旧 id。当时未结、没有修好的行都已迁成 issue。

## 有意保留

结构审查遇到下列形状不再报告，除非理由不再成立。

| 形状 | 理由 | 日期 | 决定 |
|---|---|---|---|
| `live` 包内 `credentials` 与 `runs` 互相导入（2026-11-11 认可时是 `authority`、`credentials`、`inventory`、`release`、`requests`、`runs` 六个模块的一个循环，之后拆得只剩这一对） | 它们共同管理同一次真实账户运行的状态，依赖本来就是双向的；拆开要在真钱代码里加一层转接，又不修任何缺陷 | 2026-11-11 | 用户在会话里认可，见本表加入时的 PR |
