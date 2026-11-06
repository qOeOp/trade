# 2026-11-06 Paper 中断后替换账户

| 项目 | 内容 |
|---|---|
| 会话 / 覆盖 | 用户报告 Paper 数据与交易不连续，随后要求恢复并授权实施生产恢复及合并 PR；聚焦恢复，不是全产品审计 |
| 产品事实 | 原 Daemon.seal_found 先封存、移除中断容器，再 paper start 新账户；engine.paper 只写观察 journal/summary，不保存可恢复执行态；当前 ema-entryvar@2 无 save/load hooks |
| 证据 | [先前运行边界诊断](2026-11-06-paper-run-boundaries.zh.md)记录 run6 持仓及 run7 新账户；[恢复方案](../paper-native-recovery.zh.md)记录固定 rc7 源码、独立存储评审及隔离 native LiveNode/Redis/日线探针。退出255具体原因未定，不归因为Nautilus缺陷 |
| 验证范围 | 合成 loopback Binance 协议、实际 native LiveNode/Sandbox/Redis、磁盘加载新Redis实例、native VirtualClock/Catalog日线承接；不是任意工作单、跨日或实盘恢复证明 |
| 代价 | wrong output；时间/token未单独计量 |
| 净变化 | 同一未封存run恢复、最小原生原件及一致切点、恢复失败拒绝替换账户；不新增SQL列、不改旧sealed run或旧策略源码、不构建平行执行/账户引擎 |

## 发现

| id | 发现 | 证据与消费者 | 动作 | 状态 |
|---|---|---|---|---|
| 20261106-05 | Paper中断恢复路径封存并新建Sandbox账户，订单/持仓/策略态未承接 | Daemon.seal_found→seal/start；engine.paper.main没有native cache或策略hook原件。显示能标示中断，不能代替执行状态恢复 | fix：一致原生checkpoint恢复同一未封存run；缺失/不一致/未承接尾部/不支持状态时保留原件、拒绝恢复，不自动新账户 | open |

## 授权和边界

用户先限定方案与原生验证，后明确要求“实施生产恢复吧，该合并的pr也合并”，覆盖恢复控制流与拒绝替换账户语义。当前采用官方固定Nautilus rc7，无框架fork；真实交易及凭据未授权。旧run6没有完整原件，不能追认恢复。旧@2源码不改；新EMA恢复源码仍在/tmp，必须通过配对验收才发表/启用。

存储字段、owner切点、native FIFO读回及原始journal编码的独立评审决定见恢复方案。当前协议只接受固定minute/daily订阅、显式hooks、terminal orders、无用户timers、已完成callback；不能承接的daily/funding边界拒绝。所有工程账本测试使用隔离Dolt。
