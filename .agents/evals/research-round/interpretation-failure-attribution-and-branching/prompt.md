---
description: Rule check — with the skill, when a derived candidate ties or loses to its control on a deep rule chain, the interpretation attributes the miss across the four classes citing the product slices (here cost/execution drag while gross price moved as predicted), and next-experiment selection checks lineage history and prefers branching from a simpler ancestor or pruning an unseparated rule over stacking another filter or cosmetic constant on the latest leaf.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `trend-perp-1h`（BTCUSDT 与 ETHUSDT 永续，1 小时 bar；目标最大回撤 ≤15%、年化 ≥20%），Goal 已激活，这是唯一开着的线，`gates` 为空，`review_every` 5，当前未区分计数仅 1 次（还没到换思路）。

谱系已从根 `trend-perp@1` 连续线性叠加到第 6 代：`@2` 加 A3 波动率过滤（与对照未区分）、`@3` 叠加 B1 双均线斜率过滤、`@4` 叠加 C2 冷却期、`@5` 叠加 F3 追踪止盈（当前推荐版本，trial 310，年化 14.2%，MARK 最大回撤 10.8%）。

刚刚完成一次派生运行 `trend-perp@6`（trial 318，注册 ID 44，对照 trial 310，账本版本 `a1b2c3d`），改了职责 B1（收紧入场突破确认并加快切换）：

- `hypothesis compare`：四个区间都含零，年化差 -1.6%；
- `profit_bridge`：`price` +34,200 对照 +28,400（差 +5,800 USDT，注册预测方向为 up，成立），`fee` -24,900 对照 -16,100（差 -8,800 USDT），`funding` -1,100 对照 -900；
- `fee_stress`：`daily_turnover` 0.82 对照 0.49，`breakeven_fee_multiple` 1.37 对照 1.76；
- `capital_scaled`：`mean_notional` 18,400 对照 18,100，`unit_return` 降了 0.008；
- `by_period` / `by_regime`：`residual_after_top5_days` 与高低波动率切片均与对照接近。

请先写出对 trial 318 的 `interpretation` 结论归因，再决定下一步试验方向（是否继续在 `trend-perp@6` 上叠加一层成交量过滤，还是别的做法），给出理由与命令顺序。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的判断和你会执行的确切命令，写出来就算做了；题面没给的命令输出用占位接着写。）
