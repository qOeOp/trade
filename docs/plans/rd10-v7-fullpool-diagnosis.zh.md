# v7 全池十轮测试的入口诊断

2026-10-13。用户选择保留原开发窗口和固定月度 pool，先完成生命周期/覆盖诊断，条件厘清后再启动十轮。本次未改产品代码、市场数据、目标或审计检查；测试分支保持不合并 main。

指定实现 `732c082f91a7c24e9e7b959a2a502bfe3de359a0`、CI 构建 `08e565efe45951b8954e1cdb46fd21733157410a` 和 arm64/v7 digest `a687a619ea557cb753b86f8c8f57d3db13d2f68ccbe6df5204a7b2d9b95d2503` 的九份运行源码/依赖哈希全部一致，Nautilus 为 2.0.0rc3。市场固定提交 `ebg4rg1g7pmtlj8vfk6tu8hdlql4gbkr`；输入为 2025-10-07 00:00 至 2026-10-07 08:30 UTC，交易从 2025-10-09 00:00 开始。

生产 coverage 入口已逐合约读取全部 210 个成员合约，零读取失败。48 个合约的 LAST、47 个的 MARK 在完整输入区间有缺口，主要包含上市前区间；成员有效期内的 LAST/MARK 缺分钟均为零，首次入池前输入内 48 小时 LAST 也无缺口。AIA/LIT 时间不齐分别为 675/72 分钟；AIA 在可能延续旧仓的保守范围有 675 个 LAST 缺分钟。上述原始覆盖不证明生命周期或指标实际就绪，零量与无 funding 不作为经济排除。

## 已核实的问题

[BAKE/HIFI 官方公告](https://www.binance.com/en/support/announcement/detail/82df1b55a0d84c288fa396d5a5cead48)指定 2025-10-03 09:00 UTC 自动结算下架，早于本次预热，而固定 pool 仍包含它们的 2025-10 成员关系；输入窗口各有 526110 个全零量、固定 close 的 LAST 分钟。连续分钟条不能替代实际交易生命周期。

[AIA 官方公告](https://www.binance.com/en/support/announcement/detail/20eee4109e06448992f0557bf798bb36)指定 2025-12-11 11:45 UTC 禁止新开仓、12:15 自动结算下架，月度成员关系仍持续至月底。[旧 Litentry LIT 合约公告](https://www.binance.com/en/square/post/19274348315658)与[新 Lighter 合约公告](https://www.binance.com/en-AE/support/announcement/detail/6a33be00231c4539b3a4a625538e4d1e)则说明 ticker 被不同合约重用，旧状态不能未经核对直接成为新合约暖机。

一项事先声明用途、发布精确源码并使用实际 CI digest 的原生工程预检直接检查 AIA 下架边界。独立 Agent `/root/native_source_review` 核对原始封存：决策 11:30:59.999 UTC，订单与真实成交在下一分钟；API、因果、活动通过。但官方结算后的三个分钟采样以及最终原生头寸仍保留 100 AIA LONG。runner/auditor exit=0、G passed 不证明退市结算正确。

当前 exporter 构建静态 CryptoPerpetual，runner 仅输入 LAST Bar、MarkPriceUpdate、FundingRateUpdate，没有供应 InstrumentClose/退市事件。该真实路径未发生自动结算；这不证明 Nautilus 不支持生命周期事件。独立 source-review 的 readiness 原样保留 `unresolved`，没有为执行研究改成通过。

## 保留状态与下一步

独立库 `rd10v7`，DB `rd10v7_20261013`，profile home `/Users/vx/.local/share/trade/rd10-v7-20261013/profiles`；open branch `round/RD10-V7-FULLPOOL-20261013`。检查点 evidence `rd10-v7-checkpoint-v1`，固定 commit `a4pgrcj4gp3t6bl0ctshftqm6h9pcgra`。完整报告、210 份覆盖、原始执行、完整工程源码、独立审查和 fixture 均经官方入口保存在隔离 Dolt；`/tmp/trade-rd10-v7-20261013` 只是工作副本。备份根为 `/Users/vx/.local/share/trade/rd10-v7-20261013/dolt_backup`。

计数：一项工程预检，零存储研究 run、零经济假设登记、零研究尝试/有效比较/无效研究/已消耗未完成；十轮均尚未开始。RSI14、30/70、小时信号路线保留，适配研究根尚未发布。兼容值 .20/.05/.60 明确为工程值，未 freeze/confirm，没有账户净改善或独立验证主张。

下一步先解决真实生命周期供给、原生结算和 ticker/暖机重置，再做根源码预检、独立 review 和事前假设登记。原池、原窗继续保留；不静默删币、补数据、用私有结算替代引擎，或把该工程探针作为十轮效果。完整 210 合约权威生命周期与 RSI 实际 first-ready 尚未验收。改变当前只读市场/固定运行契约另行明确工作范围。
