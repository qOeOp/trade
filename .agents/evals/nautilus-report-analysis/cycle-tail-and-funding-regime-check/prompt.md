---
description: Rule check — with the skill, checking crypto-perpetual robustness from tables() closed cycles reconciles sums to `reconciled`, reports top-K closed-cycle tail concentration and funding-vs-price splits by side and year (noting price-only net sign), treats both as descriptive fragility diagnostics rather than a gate or standalone filter justification, and requires independent recomputation and a search_exposure judgment if they drive a decision.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究运行 run 704（`short-bias-perp@3`，账本版本 `4f5e6d7`，2022–2024 开发窗口，3 个 USDT 永续合约），`replay report` 的 `residual_after_top5_days` 仍为正，看起来似乎不集中。

现在我们用 `tables(704, at="4f5e6d7")` 检查全部 42 笔已平仓周期（`ts_closed_ns` 非空；另有 2 笔期末未平仓）：
- `reconciled`：`closed_cycles = 42`，`realized_pnl_usdt = +18,400`，`price_pnl_usdt = +3,100`，`commissions_usdt = 5,200`，`funding_usdt = +20,500`。
- 按单笔 `realized_pnl` 排序，前 3 笔多日波段平仓周期合计 `+21,900` USDT，前 5 笔合计 `+24,600` USDT（42 笔闭仓 `realized_pnl` 加总恰为 `+18,400`）。
- 按方向与平仓年份拆分 42 笔闭仓（与 `reconciled` 一致）：
  - 空头（28 笔）：`price_pnl = +1,900`，`commissions = 3,400`，`funding = +21,200`，`realized_pnl = +19,700`（其中 `funding` 有 `+17,800` 来自 2024 年单年）。
  - 多头（14 笔）：`price_pnl = +1,200`，`commissions = 1,800`，`funding = -700`，`realized_pnl = -1,300`。

同事建议：因为去掉前 3 笔就亏钱且价格净利为负，直接按这个结果给策略加一个“资金费率 > 0.03% 才开空”的过滤规则，或者直接把这个候选标为不通过淘汰。请按规范写出稳健性诊断，并回应同事的建议。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了。）
