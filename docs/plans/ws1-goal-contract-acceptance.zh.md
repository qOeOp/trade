# WS1 目标契约：验收记录（2026-10-11）

来源：[rd-round-audit-refactor-plan.zh.md](rd-round-audit-refactor-plan.zh.md) WS1 的验收口径。文档与 skill 在 qOeOp/trade#1512；产品改动（运行器不再带仓位参数、`artifacts report` 的计划级读数、运行时契约 `r1-native-v3`）在本 PR。字段评审见 [plan-reading-field-review.zh.md](plan-reading-field-review.zh.md)。

本记录里的数值都是工程验收与对已暴露开发数据的重判，不是新的研究结论，也不写活动账本。

## 1. D11、D22 按新门槛重判

目标取自该轮 `goal-contract.json`：最大回撤 20%（原生 MARK 权益、可用观测时钟），年化净收益至少 18%（原合同写成 18%–22% 区间，按用户决定只取下限），计划级净胜率高于 60%。新门槛（`feasibility.md`）：

- 至少 100 个已平仓计划；
- 计划胜率高于 60%，打平和期末未平都算非赢；
- 开发期收益回撤比 ≥ 0.18 ÷ (0.20 × 2/3) = 1.35；读数所在仓位的回撤须不超过 2/3 × 20% ≈ 13.3%。

| | D11（`RR20261011-D11-C37`） | D22（读 `RR20261011-D19-C37`） |
|---|---|---|
| manifest SHA-256 | `66515fc3…5cb` | `db86c992…09d` |
| 原生 MARK 最大回撤（5 分钟收盘取样） | 9.70%（≤ 13.3%，读数仓位有效） | 5.91%（≤ 13.3%，有效） |
| 年化净收益 | −7.42% | −3.02% |
| 收益回撤比 | −0.77，**低于 1.35** | −0.51，**低于 1.35** |
| 计划数（已平仓 / 期末未平） | 923 / 4（≥ 100） | 112 / 3（≥ 100） |
| 计划胜率 | 443 / 927 = 47.8%，**不高于 60%** | 64 / 115 = 55.7%，**不高于 60%** |
| 判定 | 不达标：胜率、收益回撤比两道门槛都未过 | 不达标：胜率、收益回撤比两道门槛都未过 |

两者仍判失败，理由是计划胜率和收益回撤比。新门槛下，名义容量、"全部成交所需胜率"和单币名义上限都不再是理由。原决定用的是平仓周期胜率（47.9%、57.1%）、双边 CAGR 区间，以及 N/W/L 近似推出的"20% 年化需要 63.3% 胜率"（已从 skill 删除）。D22 的下一步写着改风险拒绝需要用户授权，按新契约，这类仓位方案是 Agent 的设计变量。

口径说明：

- **计划胜率是描述性重算，不是产品读数。** 两份封存都没有 `plan:` 标签，`artifacts report` 对它们给出 `plans: null`，原因是缺标签。重算把源码自己的标签映射为计划：D11 的 `ronnie-p2:<信号时间>:<挡位>` 按信号时间合并各挡位；D19 的 `ronnie-p5:…` 一个括号单一个计划。
  - D19 映射后，产品函数 `_plans` 直接给出 112 / 64 / 3。
  - D11 映射后被产品函数拒绝：有 2 个计划在持平后又被剩余挡位重新开仓，一个计划跨两个持仓周期，违反新契约。表中数字按"每个信号一个计划、合并其所有周期"描述性计算。按平仓周期算是 444 / 926 = 47.9%，结论不变。
- **回撤口径。** 回撤按 `nautilus-report-analysis` 的资本占用规则计算：账户 `total` 加上该 K 线 MARK 的未实现盈亏，范围是交易窗口内的 102,342 根 5 分钟 K 线。与 Codex 当时的读数（9.71%、5.85%）相差不到 0.1 个百分点，来自取样边界的约定，不影响判定。
- **脚本和输出在 Git 外。** 位置：`~/.local/share/trade/research-runtime/20261011-ws1-v3/rejudge/`。SHA-256：

  | 文件 | SHA-256 |
  |---|---|
  | `mark_drawdown.py` | `76a4f557…` |
  | `legacy_plans.py` | `413dee66…` |
  | `d11_descriptive_plans.py` | `69ef676f…` |
  | `RR20261011-D11-C37-dd.json` | `01678e37…` |
  | `RR20261011-D19-C37-dd.json` | `0ffaf5f6…` |
  | `legacy-plans.txt` | `46c724ad…` |
  | `d11-descriptive-plans.json` | `d5b4ea83…` |

## 2. 新镜像与配对原生回放

镜像：`localhost:15000/trade-r1-runtime@sha256:42f4d2d98d977d48ea9250a0b81ce9471c6e969e94d23295f5e60223fabd2213`，`r1-native-v3`，linux/arm64。从本 PR 的提交构建，提交号见 `source-commit.txt`。身份 JSON、镜像 tar、配对脚本 `validate.py` 和逐 run 结果都在 `~/.local/share/trade/research-runtime/20261011-ws1-v3/`。

方法：

1. 取 3 个已封存的 v2 运行。
2. 把封存源码机械改写：构造函数的两个仓位参数改成源码内默认值，取值与当时运行器传入的相同（0.0025、0.05）；配置检查去掉这两项；其余字节不动。
3. 去掉 `--risk-budget-bps` 和 `--coin-notional-cap-pct`，在新镜像里用托管同样的容器命令重放，并在镜像内审计。
4. 与封存报告比较。全程不写 Dolt。

| 封存（原镜像 `f02c4989…`） | 退出 / 审计 | `compare_node` | 订单、成交、持仓 | 账户、收益序列、持仓估值 | 审计 `native_economics` |
|---|---|---|---|---|---|
| `RR20261011-D11-CONTROL-P02`（2 币） | 0 / 通过、0 发现 | 通过 | 逐字节相同 | 逐字节相同 | 相同 |
| `RR20261011-D19-C37`（37 币） | 0 / 通过、0 发现 | 通过 | 只有原生随机 UUID 不同（`init_id`、`event_id`、快照持仓 ID） | 逐字节相同 | 相同 |
| `RR20261011-D11-C37`（37 币） | 0 / 通过、0 发现 | 通过 | 同上；930 行持仓按内容比较完全一致，只是行序随 UUID 变化 | 逐字节相同 | 相同 |

summary 的差异只在源码与镜像身份、`effective_config_sha256`、`strategy_runtime_contract`，以及 `sizing`：从 `{"mode": "native_equity_stop_risk_with_notional_cap", …}` 变为 `{"mode": "strategy_source"}`。三次运行都没有拒单，完整性没有发现。

结论：

- 仓位从运行器移入源码后，订单、成交、手续费、资金费和账户经济完全一致。
- 已有封存仍可 verify 与 report。封存根下 40 个封存用新读取逐个 report 全部读通。唯一读不通的 `source-review-s04-independent-20261011` 不是封存，在 main 上同样报错。
- v2 源码不能直接在 v3 镜像运行，因为构造参数变了。要运行，得先发表一个 `r1-native-v3` 修订。

## 3. 隔离账本演示：计划级读数与两种拒绝

隔离 Dolt 在 13346 端口，配置、数据、封存根和备份都在 `~/.local/share/trade/ws1-demo-20261011/`，不碰活动账本。

合成演示策略 `ws1.plan-demo@1` 是 v3，源码 SHA-256 `66732c50…`。规则：

- 每个完成的小时，没有活动计划的币种挂一个原生括号单：限价买入、止损 2%、目标 2%；
- 仓位是源码常量，每个计划 2% 权益；
- 三个标签：合规 / 止损单不带计划标签 / 持仓期间另挂远端限价单作为新计划。

attempt `WS1-PLAN-DEMO`（purpose `demo`）。三次托管运行都在新镜像上，BTC、ETH 全年，均已 verify、backup、register（diagnostic）。

| run | 封存 | `artifacts report` 的 `plans` |
|---|---|---|
| `WS1-DEMO-OK` | passed，`5eade9c5…` | `{"closed": 878, "wins": 442, "win_rate": 0.5034, "open": 0}` |
| `WS1-DEMO-UNTAGGED-STOP` | passed，`88f3b9fa…` | `null`；`plans is null: 1279 orders carry no plan tag (O-20251017-000000-001-BTC-2, …)` |
| `WS1-DEMO-OVERLAP` | passed，`8b8cfce2…` | `null`；`plans is null: plans BTC-1760684400000000000 and BTC-far-1760688000000000000 on BTCUSDT-PERP.BINANCE overlap: …` |

这三个运行本身都通过了完整性与审计：计划契约只决定计划读数能不能给出，不让运行失败。另外两种拒绝（一个持仓周期含两个计划、一个计划跨两个持仓周期）以及残留挂单导致的重叠，由 `tests/records/test_analysis.py` 的 `PlanReadingTests` 覆盖。

## 4. 检查

- 产品改动经独立子代理代码审查：无高危缺陷；修正了同一时刻开始的计划的重叠判定（与计划名排序无关、跳过空区间、比较此前最晚终点）、非预期字段缺失的拒绝原因、无 `orders.csv` 的原因，并补了期末未平计划之后再开计划、空区间计划、成交找不到订单三条测试。修正后重跑第 1、3 节的读数，结果不变。

- `uv run --frozen python -m unittest discover -s tests -t . -p 'test_*.py'`，并设置指向上述隔离 Dolt 的 `RESEARCH_DOLT_TEST_CONFIG`：221 个测试通过，1 个跳过（`RealSealTests` 需要外部封存根，已另行运行，见第 2 节）。
