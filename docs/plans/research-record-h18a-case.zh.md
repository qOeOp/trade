# H18a 真实案例：假设延伸与组件复用如何分开记录

## 检验问题

这是一份**事后回填的记录设计验收**，不是新的策略实验、事前登记或独立样本。问题是：后继 Agent 查询 H18a 时，能否准确找出它从哪个假设延伸、借用了哪个旧组件、应与哪次运行比较、实际运行源码在哪里，以及哪些回退信息仍未知？原始依据是 [实验台账](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/r1_native/RD_EXPERIMENTS.md)中 H08、H15a、D55/D56 和 H18a 的登记与结果；结构化侧录见 [H08](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/records/attempts/H08/attempt.json)、[H15a](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/records/attempts/H15a/attempt.json)和 [H18a](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/records/attempts/H18a/attempt.json)。

## 实际关系与实验形态

| 对象 | 已核实的角色 | 不能推断的关系 |
| --- | --- | --- |
| H15a | 三层预算化回撤入场，是 H18a 保留的母假设和同口径经济对照。 | 仅凭假设父节点不能重建 H18a 的执行源码。 |
| H08 | `ConfirmedLineSupportTouches` 提供已确认上升线的状态计算；H08 完整的触碰反弹入场规则曾在来源正例门槛失败，未产生该规则的 37 币年度经济结论。 | 组件复用不等于 H18a 继承 H08 入场假设，更不等于 H08 策略已被证明有效。 |
| H18a | 在 H15a 首次成交后冻结趋势线；完成的四小时 bar 跌破时，只取消原始三层计划中仍未成交的入场单，保留仓位和原生保护单。 | 它不是单独的趋势线入场策略。 |

H18a 的假设父边是 `H18a → H15a`，组件来源边是 `H18a → H08`。它的动作以 **H15a 已持仓且尚有待成交层级**为前提，故 `composition_mode=dependent`。所谓 `00=origin、10=H15a、01=H08、11=H18a` 不成立：H08-only 的入场与 H18a 的取消动作不是同一个可独立开关的 B 因素。此案例只能比较 H18a 与冻结的 H15a，不能估计二因子交互。H18a 原登记提交为 `57d8c07d3`，实现及 runner 冻结提交为 `e5a882101`；侧录把后者记为运行的 `source_revision`，核对了四个实际执行源码文件的 Git 字节哈希。独立 `code_parent` 仍为 `null`，因为冻结版本不等于开发时的源码父版本；完整依赖及输入字节的重建也未验收。

另一个易错拼接是把旧的同一年 [H19a](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/records/attempts/H19a/attempt.json)、H18a、H15a 三路配对当成已完成的四格。那些历史运行确实缺少对应的“H19a 加 H18a 取消动作”原生 `11` 格；仅凭三路同口径结果不能估计交互。后来 [F01](r1-factorial-line-cancel-result.zh.md)在事前登记后用同一 runner **重新运行全部四格**，才得到可核对的组合格。H19a 是宽摆动选择、层数、止损位置与持有时间的整套候选，所以 F01 的 A 是这一整套变化，不能把交互解释成其中一个单独参数的贡献。

## 可复核的同口径证据

| 证据 | H18a 候选 | H15a 同 runner 对照 |
| --- | --- | --- |
| 原生摘要 | [H18a summary](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/r1_native/results/2026-10-08-h18a-37-summary.json)，SHA-256 `6afbecee4000071cd3f03f7cdf04026eac78dc93ced3e31891cfc597288bcd4e` | [paired H15a summary](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/r1_native/results/2026-10-08-h18a-paired-h15a-summary.json)，SHA-256 `01f828bb141d51f86c5dfdbb5f675ee1cc87b6169fbebaf50d9b4ac9bf507668` |
| 独立原生审计 | [H18a audit](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/r1_native/results/2026-10-08-h18a-37-native-audit.json)，SHA-256 `d77722e69162f1b2e45709fdb7dbbcf97951722f3861a8fee35f0e4273e59995` | [paired H15a audit](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/r1_native/results/2026-10-08-h18a-paired-h15a-native-audit.json)，SHA-256 `50282012927edb3657ac285ccf995fb22f0666bb956153cb6ced0ad8cde0cf41` |

两次运行共用冻结 runner、37 币输入身份 `ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc`、100,000 USDT 原生共享账户和可交易窗口；[候选 run](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/records/runs/H18a-2026-10-08/run.json)指定 [H15a control run](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/records/runs/H15a-paired-2026-10-08/run.json)。两份原生审计均通过，拒单和否单为零。本机复核时，两次运行的摘要、订单、成交、仓位、账户与逐期收益共 **12/12 个原始文件**仍在 `/tmp`，其字节哈希全部匹配两份审计；侧录仍标为 `temporary`，因为这不证明长期保管或未来可恢复。

原生账户终值为 **104,901.95547793 对 104,160.59375166 USDT**，H18a 的观察差值是 **+741.36172627 USDT**；年化约 **5.04% 对 4.28%**，正收益平仓率 **380/676（56.21%）对 382/676（56.51%）**。详见 [配对经济读回](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/r1_native/results/2026-10-08-h18a-paired-native-economics.json)和 [52 周配对重采样](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/research/r1_native/results/2026-10-08-h18a-paired-weekly-bootstrap.json)：年化差异的探索性 95% 区间约为 **[-2.35, +3.31] 个百分点**，跨过零，且未调整此前多次研究选择。两者均未达到预设的账户年化大于 20% 与正收益平仓率接近 60% 的联合 Goal。这里仅能说“同一已暴露年度上观察到小幅账户改善”，**不能称组合有效或已获得可重复优势**。

## 读回验收与仍缺的证据

在项目根目录执行：

```bash
uv run --frozen python -m research.records.cli validate
uv run --frozen python -m research.records.cli show H18a
uv run --frozen python -m research.records.cli compare H18a-2026-10-08 H15a-paired-2026-10-08
```

`show` 应读到 H15a 假设父节点、H08 失败的组件来源以及 H18a 的依赖式组合；`compare` 应核对已登记的配对，并返回上述账户终值差和 `development_exposed` 等级。这个真实案例检验了**不误认假设关系、找到合法对照、保留负结果**的读回能力。独立开关的多父 A+B 四格随后由 F01 单独检验；两个案例都没有验证登记时自动捕获、知识环边、原始报告长期恢复，也没有量出 Agent 检索效率或未来策略成功率。
