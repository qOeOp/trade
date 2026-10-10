# F01 四格真实回放：宽摆动计划与趋势线取消

## 检验范围

[事前登记](r1-factorial-line-cancel-prereg.zh.md)先于新组合的实现和经济结果；最初暂名 H20a，年度运行前更名 F01，规则未改。四格均在当前 `BacktestNode`、同一 37 币五分钟 LAST/MARK 与 Catalog funding、同一 100,000 USDT 原生共享账户、相同费用和 2025-10-17 至 2026-10-07 可交易窗口重新运行。A 是 H19a 的**整套**宽摆动双层计划，B 是首个实际成交后确认上升线跌破时只取消未成交原始入场单；B 对 H15a 和 H19a 各自可单独开关。结果保存在[比较报告](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/reports/r1_factorial_f01/comparison.json)和[证据 manifest](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/reports/r1_factorial_f01/manifest.json)。

先通过 10 条[原生合成生命周期](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/reports/r1_factorial_f01/lifecycle.json)，再通过 BTC/ETH pilot 的[独立原生审计](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/reports/r1_factorial_f01/pilot-audit.json)。年度 00、10、01 三格分别与既有冻结运行作逐订单、成交、仓位、资金费和账户序列行为配对，三份[配对回执](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/reports/r1_factorial_f01/00-parity.json)、[10 回执](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/reports/r1_factorial_f01/10-parity.json)、[01 回执](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/reports/r1_factorial_f01/01-parity.json)均通过。四格各自的独立原生审计均通过，零否单、零拒单；11 格是新运行，没有历史 11 格可作迁移 parity。四格的原生 CSV 哈希均记录于各格审计和 manifest。

## 四格结果

| 格 | 运行 | 期末账户权益 USDT | 年化净收益 | 正收益平仓 | 日收盘最大回撤 | B 取消请求 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 00 | H15a | 104,160.59 | +4.28% | 382/676，56.51% | 6.88% | 0 |
| 10 | H19a | 111,664.47 | +12.00% | 212/496，42.74% | 15.33% | 0 |
| 01 | H18a | 104,901.96 | +5.04% | 380/676，56.21% | 7.05% | 131 |
| 11 | F01 组合 | 111,081.83 | +11.40% | 212/496，42.74% | 14.59% | 37 |

在 H15a 上加 B 的账户观察差为 **+741.36172627 USDT**；在 H19a 上加相同 B 则为 **−582.64175047 USDT**。四格差中差 `Y11−Y10−Y01+Y00 = −1,324.00347674 USDT`。用 356 个相同日期的原生每日收益按 52 个 ISO 周配对重采样 5,000 次，年化日收益差中差的探索性 95% 区间为 **[−5.01, +1.84] 个百分点**，跨过零；H19a 上 B 的直接差区间为 **[−3.78, +1.24] 个百分点**。区间未对先前多候选选择调整，不能据此断言稳定的负交互或预测新年度。

10 与 11 的宽摆动来源计划均为 **2,940**、提交计划均为 **2,939**，原生 OTO 均为 **5,878**；B 在 11 格发出 37 次取消请求，使正数量成交入场从 **881** 降至 **853**，两格仍各有 496 个已平仓和 11 个开放仓位，开放仓位的原生保护通过审计。11 格的成交手续费为 **930.52 USDT**、仓位资金费净调整为 **+29.17 USDT**，10 格分别为 **971.32** 与 **+46.21 USDT**；费用较低并未带来更高的净账户终值。原生账户已包含这些费用和资金费，不能再从权益重复扣减。这里只能归因于已冻结整套 B 动作改变了账户路径，不能从账户差额倒推出某一层订单的独立盈亏。

**经济裁决：**11 格的 +11.40% 年化和 42.74% 正收益平仓率均未达预定的 >20% 年化、接近 60% 胜率联合目标；这次组合失败。它在这个已反复看过的年度上比 H19a 少约 582.64 USDT，日收盘回撤略小，但没有建立可重复的组合优势。不会按这次结果改线、层数、持有期或风险预算。

## 设计稿验收与剩余边界

这个案例实际填满了 00/10/01/11，证明**两个可分别开关的研究方向可以在同一原生账户中做四格配对**。它还迫使记录区分假设父节点、真实执行源码、四格运行 ID 和失败的组合节点；失败的 11 格必须保留以供后续检索。它不证明四格管理会提高 Agent 研究效率或策略成功率；那需要另做检索盲评和未来未暴露样本。

执行源码行为冻结于 `9c5b1fd17`，F01 命名及 runner 摘要字节冻结于 `2349502cb`；[manifest](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/reports/r1_factorial_f01/manifest.json)保存实际锁文件哈希、输入身份与四格原始报告哈希及当前本机路径。原生摘要中的历史 `source_commit` 是旧来源基线字段，**不是**这次实际执行源码提交；应以这里的冻结提交及摘要源码 SHA-256 辨认运行字节。本次[输入重核](https://github.com/qOeOp/trade/blob/44e229331fdc7d9b78e234079673b8df71faefc4/reports/r1_factorial_f01/input-recheck.json)按历史身份文件的逐字节算法验证了 37 币 minute/daily 共 **74 棵 Catalog 树**及数量 CSV，全部一致。大体量 CSV 仍在 `/tmp`，保管状态为临时，尚未通过长期恢复测试。
