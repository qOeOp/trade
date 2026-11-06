# Hedge Live 单成员实现记录

2026-11-06；关联[设计](binance-live-hedge-design.zh.md)、[独立设计评审](binance-live-hedge-review.zh.md)
和[阶段 A 原生验证](binance-live-hedge-phase-a.zh.md)。本记录覆盖阶段 B 的产品实现，
不把离线通过视为实盘或多策略并发通过。

## 权限与范围

用户逐项授权四项产品检查变更：实际账户只接受 Hedge 且原生客户端匹配；
`SOURCE_REACH` 对规范原生分配的窄例外；Live 源码必须显式原生 NETTING 和 UUID；
首次连接后复核账户、断线结束本轮且保持未决，不自动恢复交易。
其他账户、资金、品种、来源、保护和持久化检查保留，不改交易所设置。

维持 `live-run-v1`、单成员、单品种和固定私有账户 root。两个 Retest 顺序验收。
不引入持久成员字段、账户持仓副本、订单引擎或自建对账流程。
阶段 C 的同向并发与双腿缺单恢复仍有阶段 A 反例，因此不在本次开放。

## 原生配置与构造

rc7 的 `Strategy.__new__` 才将 `StrategyConfig` 提取进 Rust core；只调用
`super().__init__(config)` 会替换 Python 配置对象，UUID、GTD 和 stop 管理仍可能用默认值。
旧 Replay、Paper、Live 包装器直接无参调用原生分配，绕过源码分配器。

三个包装器统一转发经一次转换的参数到源码分配器，继承分配器也按 MRO 解析；
原生默认分配器保持无参旧行为。分配结果必须是指定包装类，不重试 TypeError，
不复制或重建策略配置。相同参数对象传给源码初始化，临时参数随即删除。

源码检查只允许无装饰的同步 `__new__` 直接返回
`Strategy.__new__(cls, config_expression)`，`Strategy` 为唯一、未遮蔽的原生导入，
`cls` 仅作该调用首参。其他 dunder、反射、别名分配器、类逃逸和包装类替换继续拒绝。
这仍是源码可达性检查，不是恶意 Python 的安全沙箱。

Live 在分配后及初始化后检查原生保存的配置对象、原始 StrategyConfig 字段与指定身份，
要求 NETTING、UUID，仍拒绝源自管 stop。检查不把源码初始化后的 `.config` 单独当成
原生核心配置证明。订单 UUID、GTD timer 和 stop 管理另由真实原生消费者验证。

## 连接与恢复

Binance 执行客户端使用 HEDGING、`use_position_ids=False`；策略内部用 NETTING。
首次全账户空仓仍是必要条件。Observer 注册在源之前，但订单命令默认关闭；
首次 timer 在原生 startup 与缓存的 socket 事件分发后，再以原只读客户端复核账户。
源可请求历史行情和订阅，但准入前的订单命令被拒绝，不排队重发。

原生 CONNECTED 只表示 transport 恢复，用户流恢复可能仍在轮换 listenKey 和补 open orders，
且 rc7 没有 Python 可用的统一 recovery-complete 信号。任何订阅到的 Binance 断线会
锁住本轮交易、停止节点并保留未决；不主动撤保护，也不以新连接重新开放。提交、修改、
撤销和退出包装入口均受连接检查约束；已发出的请求不能通过此检查追回。
Nautilus 继续拥有缓存、订单、成交和对账。新鲜账户读取失败同样保留未决。

冷恢复不导入旧源码：在原生 cache load/reconcile 之前，用原 v1 身份注册无交易 base Strategy，
指定 NETTING，关闭 stop/GTD/contingent 管理。它补足“已受理但未首笔成交”订单缺失的
策略 OMS 注册，已有仓位仍由原生缓存恢复。`generate_missing_orders` 保持默认，
没有把阶段 A 的双腿问题通过改默认值绕过去。

## 验证与限制

构造回归覆盖 hash-checked loader、importable replay bridge、Paper、实际 Live 包装器、
继承分配、输入只转换一次、配置身份、UUID、GTD 及原生管理退出。连接测试覆盖默认关闭、
连接后账户模式变化、所有包装交易入口、断线后 CONNECTED 不重开及成交事件继续记录。
必要的本地接口 LiveNode、持久冷恢复、CI 镜像、配对 replay 和部署验收另记最终执行结果；
本记录不预先宣称这些通过。

两个 Retest 私有派生源码改用 Binance 原生已收盘外部 15m 信号，1m 仅作连续性和因果检查。
内部定时聚合在末分钟晚到时曾静默给出缺一分钟的 OHLCV，因此不能仅增加固定延迟。
外部信号保持真实 T−1ms 时间戳；未宣称收益或与旧内部聚合的完整执行 parity。
源码和实验输出保留在私有临时工作目录，不写入 Git 或研究账本。

本次 authoring reference 净增 23 个英文单词：替换“dunders 全拒绝”的笼统表述并链接
engine README 的单一规范说明；无 eval case 新增或修改，现有策略信号/来源判据不变。
