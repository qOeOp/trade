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

Live 在分配、初始化及原生注册后检查原生保存的配置对象、原始 StrategyConfig 字段与原生实际身份，
要求 NETTING、UUID，仍拒绝源自管 stop。检查不把源码初始化后的 `.config` 单独当成
原生核心配置证明。原生 ID 必须等于 v1 固定身份，不能由 order_id_tag 改成另一个恢复键；
注册后的检查覆盖原生注册读取 Python 可见 order_id_tag 导致的身份变化；
manage_stop 也读取原生字段，避免 Python 子类遮蔽。订单 UUID、GTD timer 和 stop 管理
另由真实原生消费者验证。

## 连接与恢复

Binance 执行客户端使用 HEDGING、`use_position_ids=False`；策略内部用 NETTING。
首次全账户空仓仍是必要条件。Observer 注册在源之前，但订单命令默认关闭；
首次 timer 在原生 startup 与缓存的 socket 事件分发后，再以原只读客户端复核账户。
源可请求历史行情和订阅，但准入前的订单命令被拒绝，不排队重发。

原生 CONNECTED 只表示 transport 恢复，用户流恢复可能仍在轮换 listenKey 和补 open orders，
且 rc7 没有 Python 可用的统一 recovery-complete 信号。任何订阅到的 Binance 断线会
锁住本轮交易、停止节点并保留未决；不主动撤保护，也不以新连接重新开放。提交、修改、
撤销和退出包装入口均受连接检查约束；已发出的请求不能通过此检查追回。
断线关闭许可后，先同步调用原生 Strategy.stop，再请求异步节点停止，避免 GTD 管理和
market_exit 在节点下一次 stop-check 前继续发令。源的 on_stop 已由产品设为空操作，
原生 manage_stop=False 已被硬检查。market_exit 公开入口同样受连接检查约束。
残余成交仍更新原生缓存与日志，但停止后的 Python 源回调及其 JSONL 不再接收这些事件。
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

## 保留多资产后的准入修订（2026-11-07）

用户选择保留实际 Hedge、Multi-assets、CROSSED 账户，并逐项授权：
实际多资产现金准入；全局每单金额上限改为开仓 LIMIT 提交估值上限；
单次入场、异步账户复核、禁止修改及真实减仓归属/配置检查。以下取代前文
“其他账户和资金检查不变”的范围说明；不修改交易所模式或杠杆。

独立源码核对与实际原生适配器探针确认：rc7 不提供跨资产抵押估值的完整账户模型。
零钱包 WS/HTTP 可能省略币种而留下旧缓存；冷启动的原生保证金初始化也可能改变
venue 报告的 free。已有仓位、费用与归属可由原生恢复，但不能因此宣称现金对账一致。
因此首次和入场前均以完整 v2 account 原始响应确认 USDT，满足
`0 < entry_value <= cap <= budget <= min(USDT wallet, USDT available)`，预算最多 100 USDT。
USDT 必须可用作保证金，全部资产行须名称唯一、钱包有限且非负；不固定币种清单、不做 FX。
只读恢复使用同一模式检查，不要求现金为正、canTrade 或空仓。

原生 `max_notional_per_order` 也检查减仓：实测 0.001 BTC 在 75000 入场后，
行情涨到 100000，90 USDT 上限会拒绝 MARKET 平仓。无该上限、其余原生风险仍开启的
对照可正常平仓。因此原字段改为 LIMIT 入场提交估值，调用原生 Instrument.notional_value，
不设置全局金额上限；不承诺真实成交金额、最大损失或 CROSS 资金隔离。
减仓使用真实原生缓存仓位，核对策略、账户、品种，再调用原生 would_reduce_only。
close_position 直接进入 Rust 而不经过 Python submit，故单独核验并使用当前缓存仓位；
market_exit 的原生配置必须 reduce-only。首轮不修改订单价格/数量。

实际 CI 路径还复现了同步账户 HTTP 阻塞原生事件循环的错误：查询期间 socket 已断，
返回后已到期入场 timer 先于 DISCONNECTED 回调提交。查询因此移到单个只读 daemon 任务，
只持 reader、symbols、Future；现有 Observer 消费结果。任务不持原生节点、订单或策略，
停止不 join HTTP，也不把 Future.cancel 当成已取消正在进行的请求。

同一时刻只有一个带用途与期限的观察。首次连接期间订单关闭；入场期间只临时持有
一个尚未提交的原生 LIMIT 对象和固定的原生调用参数。Observer 重新检查 STOP、连接、
存储、当前缓存、资金、原生策略 Running、订单身份、INITIALIZED 状态和 GTD 期限，先摘除暂存对象再调用原生提交，
防止同步回调重入。取消未提交入场或 market_exit 意图会结束该尝试。失败结束本轮，
无自动重试、持久队列、自建订单事件或持仓状态。已提交的原生非减仓历史阻止第二次尝试。
原生不会替调用者重写 Order 的 strategy_id/trader_id，也不会在 submit 时拒绝已停止策略；
两个缺口均经实际原生复现后在提交边界核验，避免停掉保护回调后迟到入场或外来 OrderFactory 逃离本策略历史。

独立设计审查确认这是提交前的信任边界：rc7 没有公开的异步提交批准 hook；query_account
不能提供本合同所需的完整资产、模式及普通/algo 全账户空仓证据。使用私有 adapter runtime
反而需要额外 client/loop。现有 Observer 加单个 Future 为最小适配。
不新增存储字段：沿用 manifest 的预算/金额字段、原始账户观察和现有 journal 字段；
Future 与暂存命令仅在内存，进程中断后只能原生只读对账，不能恢复派发。

原生多资产生命周期与冷恢复探针保留了费用、原身份 NETTING、离线成交去重和追加的证据，
也保留了余额不一致、保护单不随离线成交自动扩容、flat 历史费用未重新向 venue 核对的限制。
这些是能力边界，不用“检查全绿”隐藏。最终候选的账户/命令边界测试、固定 CI 镜像、
延迟查询断线/到期反例重测、两策略与配对回放、部署观测仍须分别验收。
