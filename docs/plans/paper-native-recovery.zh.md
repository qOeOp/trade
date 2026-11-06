# Paper 原生恢复实施方案

状态：2026-11-06，用户已明确授权“实施生产恢复，该合并的 PR 也合并”。显示修复 #2200–#2203 已上线；恢复产品代码正在隔离分支实施和验收，尚未部署或切换生产 runner。旧 run 6 与策略 @2 原件不改，不更换 Nautilus 官方构建。下文早期探针与当时结论按时间保留，实施边界以末尾决定和最新验收为准。

## 恢复语义

异常重启沿用同一个未封存 `paper_id` 和同一个 digest / inputs 的 runner，保留 journal，追加进程恢复事实；明确结束时才 seal。这样不新增 `resume_from_paper_id`，不凭相邻 run 推断承接关系，不复开已封存记录，也不复利叠加同一账户的累积收益。

不回填断线期间的模拟成交。缺口仍是缺口，恢复后由原生 Sandbox 按新收到的行情撮合。

## 最小持久化数据及独立评审

依 AGENTS.md，由独立子代理 `recovery_storage_review` 只读评审。既有状态与事件能证明旧持仓和最后权益，不能恢复完整执行态。新数据应只有带一致切点的原生恢复原件，放同 run 的现有 capture bundle，不新增 SQL 列、余额汇总、持仓账本或身份副本：

- 原生 cache 数据：原生账户、订单、仓位、必要索引，由 Nautilus 的 native Redis backing 读取；消费者为 ExecutionEngine.load_cache 和 Sandbox。现有 UI fields / repr 不是稳定完整的恢复格式。
- 策略自己的 `Strategy.save/on_save` 字节状态：消费者为同源码的 `Strategy.load/on_load`。不能从任意策略的行情/成交推导私有状态。
- 一个同时约束 cache、策略状态和 journal 的已完成切点。不能分别取三个文件的“最新”。切点之后的原始事件不得截断或删除。
- 日线聚合、MARK/funding cadence 与未交付回调：优先用原始事件和原生历史聚合补齐；不能遗漏后称为完整恢复。

选同 id 后无需新增来源关联字段。若以后支持“已结束运行作为新账户的显式承接”，来源 id 另作独立存储决定，不在本次隐式添加。

## 已核实的 native 边界

锁定 Nautilus `2.0.0rc7`，官方 tag 的 commit `55c0e82053142bce3a5cba4de4221d3929c2d3bc`，本地工作副本 `/tmp/nautilus-paper-recovery-rc7`。

- `crates/adapters/sandbox/src/execution.rs:638-658,946-988`：start 从 cache 读取 open orders，并用 native matching engine.restore_open_order 恢复 Accepted / PartiallyFilled / Triggered 状态。
- 同文件 `:134-160,701-708,560-566`：connect 从 config.starting_balances 建 AccountState，可能覆盖 cache 已恢复的账户金额并清空 locked。必须修正初始化输入并原生核对 total/free/locked/margin 与后续结算。
- `LiveNodeBuilder.with_cache_database_factory` 接受注册的 native config（Redis / Postgres），不是任意 Python adapter。Redis 能保存策略状态，Postgres 不支持。
- 原生 `Strategy.save/load` 只调用 on_save/on_load，不自动保存 Python 属性。独立探针中 counter=42 的无 hook 策略 save 为 {}，load 后 counter 未变；原生 EMA 对象也不能 pickle，__getstate__ 为 None。
- 当前 ema-entryvar@2 未实现保存钩子；构造会重置 desired/plan/sequence/decision_ns 等。旧 run 6 没有完整恢复原件，不能追认为可完整恢复。

## 需要改变的现行检查 / 控制流

现在 `Daemon.seal_found` 先 seal、删除旧容器，再按既有限额创建一个新账户。拟改为：先检查可恢复性和原有重启限额，成功才 CLI resume 同一 runner；缺失/不一致 checkpoint、源码或镜像不符、缺少策略状态 hook、journal 存在未能承接的尾部时明确拒绝恢复，绝不自动降级成新账户。用户 STOP 仍是最终停止，不自动恢复。

同 id 重启不能沿用按 sealed runs / created_at 计数的 crashes()，需要从每次实际启动事实计算同一限额；不放宽数值。

## 实施与验收顺序

1. 隔离原生探针：账户余额/保证金、挂单部分成交和触发状态、策略私有状态保存/加载、日线聚合恢复。
2. 确定原子切点与 crash tail 规则，写最小 codec / artifact capture / CLI resume / daemon 控制流；不写平行撮合或账户引擎。
3. 在支持保存钩子的合成策略上，比较未中断与多次恢复的 native orders / fills / fees / funding / accounts，并覆盖 kill、写一半 checkpoint、重复 resume、STOP、限额和缺失状态。
4. 当前 EMA 的保存钩子只能形成新源码版本，不能改已发表源码。先在 /tmp 准备，再做保持行为的成对原生验证。发表到活动账本和部署新镜像需另行明确授权。
5. 当前已封存 run 6 的“只承接仓位并重新预热”是另一种语义，不冒充完整状态恢复；若用户需要，单独声明和审批。

## 不改现行规则的替代

保留已提交的显示修复和现有中断记录，异常后仍是新账户；这不能满足连续持仓。只填回余额/持仓而缺少挂单、策略和聚合状态不能作为实现。

## 原生探针结果补充

`/tmp/paper-native-recovery-probe/native_state.py` 使用锁定版本 API、纯合成输入验证：显式 on_save/on_load 可以恢复私有计数、plan 和原生 EMA 的输入历史，恢复后下一次 EMA 更新与未中断路径相同。反例也验证：原生 MarginAccount 接收与 Sandbox.connect 同形的 AccountState 后，total/locked/free 可从 99950/3000/96950 变成 100000/0/100000。因此原生 cache 可加载不等于经济状态恢复正确。该探针没有证明 LiveNode + Redis 的整体恢复和原子切点；不能据此声称功能已完成。


## 用户选择后的 LiveNode + Redis 原生验证

2026-11-06，使用同一锁定 Nautilus 版本、官方 `redis:8.2.1-alpine` 的独立测试容器（只发布本机 loopback 临时端口，无账户凭据），无 Binance 连接、无市场回放或账本写入。脚本与原始结果仅放 `/tmp/paper-native-recovery-probe/`。

| 验证 | 结果 | 证据范围 |
|---|---|---|
| `LiveNode` + native Redis backing + Sandbox 初次启动 | 通过，原生生成并持久化 AccountState，启动观察器读到 100000/0/100000 的 total/locked/free | 实际执行原生节点与原生 Redis adapter，不是 mock |
| 使用 native adapter 将原生格式的合成账户状态加载入 cache | 通过，`RedisCacheDatabase.load_all()` 读到 total=99950、locked=3000、free=96950 | 合成账户，没有人为构造生产持仓或成交 |
| 同一节点连接时 config.starting_balances=100000 | **未保持经济状态**：启动观察器读到 100000/0/100000 | 实际 Sandbox.connect 路径覆盖恢复账户金额 |
| 把 config.starting_balances 改为99950 | **仅 total 保持**：读到99950/0/99950 | 证明只填余额不够；该账户探针没有底层订单/仓位，不能据此声称真实持仓的 margin 重建也已被验证 |
| 页面 `AccountState.to_dict()` 直接当作 native Redis cache payload | 不可替代 native 序列化：native load_all 未恢复账户；原生写出的 payload 可恢复 | 两种格式的键、Money 和 timestamp 表达不同，不能把 UI 快照当恢复原件 |

原始文件：`native_state.py`、`result.json`、`redis_account.py`、`redis-account-blank.json`、`redis-account-100000.json`、`redis-account-99950.json`。其中账户重置探针是反例，不是完整恢复通过证据。

### 仍未通过的整体验收

- 带实际持仓和部分成交挂单的 total/free/locked/margin 重建，以及恢复后撤单、剩余量成交和平仓结算；目前只核对了 pinned 源码的原生恢复实现和其已有测试，未在本机执行那些 Rust 测试。
- cache、策略、runner 状态和 journal 的原子切点及 crash tail 承接。
- 日线聚合器在盘中重启后的原生历史补齐；官方 request_bars 的 update_subscriptions 路径尚未完成动态探针。
- 完整未中断/多次恢复的 orders/fills/fees/funding/accounts 对比。

结论：**原生状态保存存在可用路径，但仅开持久 cache + save/load 不能满足本产品的完整恢复；当前不能宣称原生恢复验收通过。** 本轮交付限于方案、独立评审和上述可核验原生证据，不实施新拒绝语义、不发布当前 EMA 的新源码，也不启用生产恢复。


## 实施前的第二次独立存储评审

2026-11-06，`recovery_storage_review` 再次只读审查固定 rc7，结论如下：

- 四项原件仍必要；策略状态可同存 native Redis，不应再另复制一份。
- `Cache.add` sentinel 与 order/position 写共用同一个 native Redis FIFO，可证明已经入数据库队列的写被排空，但不能证明撮合器、风险命令和执行回调队列已排空。
- 无工作单的检查必须包括全部非 terminal 订单：submit 路径先缓存 INITIALIZED，再发 risk command，仅查 open/inflight 会漏。
- journal 无尾部也不能证明切点后没有处理：原生状态或策略可在 journal 写入前改变。必须有处理前持久 intent，或原生处理屏障。
- `with_reconciliation(False)` 跳过启动 portfolio 初始化。打开它并以 checkpoint 的 native total 初始化 Sandbox 后，原生 `initialize_positions()` 可能重建持仓保证金；尚无持仓 paired probe，不宣称已通过。

### 原生依赖所需的最小完整接口

在 Nautilus 中提供一处暂停输入、排空已接收 risk/execution/data 命令与回调的屏障；在屏障内保存/加载 Sandbox 的匹配状态、延迟命令和模型状态、native cache 和账户，并给出处理边界。策略 hooks 与 runner journal 切点在同一屏障内绑定。恢复后先完成账户/订单/仓位初始化再放行数据和策略。

这部分属于原生依赖能力，不能用 Python 手工补余额、挂单或成交来替代。目前固定发布版只有 cache open-order 恢复，不暴露上述完整接口；独立评审因此不支持声称任意 crash 恢复成立。选择补丁版 Nautilus 会引入本仓库对原生依赖补丁的维护与 CI 构建责任，超出前一方案只接 published API 的范围。继续使用官方固定发布版则不能现在启用完整恢复。


## 对原生补丁方案的澄清

用户追问恢复为何涉及 Nautilus。已明确：Paper 的订单、持仓和结算由 Nautilus Sandbox 持有，当前新账户重启是本产品未实施状态承接，不能因此归因为 Nautilus 缺陷。前述补丁接口是候选方案，**现有证据只证明 cache + save/load 单独不足，尚未证明必须修改框架**。当前不更换 Nautilus 构建；继续评估既有 API 的可恢复子集与反例。

额外核对：Python MessageBus.subscribe 的 handler 只接受 PyMessage（common/src/python/msgbus.rs:333），不能把高 priority 的普通 Python 订阅当作原生 typed 行情的处理前 WAL；原生 dispatch_tap_publish 在 typed 行情处理前调用，但该 hook 未暴露 Python。插件公开 HostVTable 是 opaque token，也不能仅凭 add_plugin 的存在声称能访问完整恢复屏障。上述均是接口范围，不是完整恢复不可能的证明。


## 已上线的独立显示修复

2026-11-06，#2200/#2201/#2202/#2203 均已合并，生产 IDE 与 Paper 服务更新至 c2d297c330a0c2c73e890222ee829ea809e6c5aa。只更新这两个服务，运行中的 runner 7（bdca5af84a79，2026-11-05T04:42:46Z 启动）及 ledger/market-import/egress 均未重启。生产页面连续缩放、BTC/Equity 切换后 captured errors=0，root=1，canvas=7；这是显示验证，不是恢复验收。

本次显示代码验证：806 个 Python 单元及隔离 Dolt 集成测试通过；整合后 80 个前端测试通过，dark/light + viewport resize + DPR 1/1.5 的只读实际历史数据浏览器测试通过。


## published API 持仓原生配对测试

`/tmp/paper-native-recovery-probe/live_roundtrip.py` 使用本机合成 Binance HTTP/WS 协议夹具、真正的 native LiveNode / Binance data adapter / Sandbox / Redis backing，无外部行情或交易连接。baseline 买入 0.4 @100、卖出 @110；first 在持仓后正常停止，resume 由原生 cache + hooks 读取同一 trader 状态，以原生 total 配置 Sandbox 并启用 reconciliation 后继续同一平仓序列。

- first 停止时 total/locked/free = 99999.98 / 4 / 99995.98 USDT，持仓 0.4。
- resume 策略开始时三项金额与持仓完全相同；hooks 恢复 phase=1 与 OrderFactory counter=1。
- 两条路径的两次 native fill 价格/数量和手续费相同（0.02 + 0.022 USDT）；最终 native total/free=100003.958、locked=0、无持仓、两张订单。
- `live-roundtrip-comparison.json` 保存逐项断言；这证明 published API 的持仓+保证金+后续平仓路径可用，纠正仅账户裸样例的过度外推。
- 恢复后 native venue ID generator 先遇已占用 ID，原生逻辑跳过冲突并分配下一 ID，未覆盖旧订单。
- 范围仅正常停机、无工作单、合成简单 hooks 策略。尚未覆盖 crash 原子性、当前 EMA 源码钩子或日线 partial，不能当成生产完整恢复验收。


## 已验证的原生历史聚合承接路径

`bar_history_probe.py` 用实际 native Catalog + request_bars(update_subscriptions=True) 填入两分钟复合 bar 的第一分钟，再接相同的实时第二分钟；与不中断路径得到完全相同的 native OHLCV（100 / 111 / 99 / 110 / 30）。原件 `bar-history-comparison.json`。此测试使用 native time_bars_build_delay=1000000 微秒，让已闭合一分钟 bar 能在聚合 timer 前交付；native 输出的 ts_event 也随 build delay 后移一秒，必须纳入因果时钟验收，不能默改生产时钟。

这证明 published API 可承接 partial 聚合状态，不是必须 fork 的证据。仍不是当前 EMA 的全日、真实时序或 crash 原子切点验收。原 native 日线实际交付序列未记录于旧 journal；其 wall_ns 不是原生 timer/输入先后顺序的完整证据，不能盲目用按时间排序的 BacktestEngine 聚合替代。原生交付日线原件可能是需要保存的最小异步观察事实，正在独立评审。

## 用户提出的后续部署方向

固定公网 IP 的常驻服务器，接收 Paper 与未来 Live 的运行指令，稳定运行多个隔离容器。当前恢复沿用同一 Compose / digest 镜像结构，为迁移准备；Paper / Live 的账户状态、凭据和容器分离。服务器选型采购、开通部署和真实交易接入属于后续工作，不在当前会话执行。


## 最终存储最小集（独立评审后的实施决定）

`recovery_storage_review` 已按消费者、独立事实、派生替代逐项复核。恢复原件同存 native Redis：source hooks bytes、两个 OrderFactory count、source Cadence mark_minute/next_funding_ns、Recorder 独立 next_funding_ns / 最新 marks / minute；保护单策略仅保留未完成的稀疏 uncovered streak。last_bar、settlements、findings 从截止 journal 派生，不复制。活跃订阅及参数由 hooks 负责恢复，或在需要 native 历史聚合时保存实际 composite 类型、路由和 params。最小外部 manifest 只有 schema、既有 run/inputs 派生 identity hash、journal bytecut/hash、RDB hash；Native FIFO 使用唯一 sentinel 确证排空。原始 warmup hash 必须在首次执行前留下 receipt，不能依赖缺失的最终 summary。

另批准 minute bar 的原 native ts_init，以及在 source on_bar 的 _hold 入队前记录 native_daily（完整 native Bar 原件）。这是 timer/data publication 的独立异步观察；不另加可由 journal 全序派生的 minute cursor。仅记录存在源回调、且通过 input-start 过滤的 native daily；切点要求 held 空、回调已完成、无 callback failure。未经配对证明，daily 之后出现 minute.ts_init <= daily.ts_init，或恢复跨聚合 bucket 时应拒绝，不丢弃或改写输入。

当前实施范围为 CryptoPerpetual、可验证的 terminal-orders 切点、无用户定时器，以及显式实现恢复 hooks 的策略。其他情形保留原件、拒绝自动恢复。先验证这些条件，不将守护线程或 Python guard 声称为通用 native WAL。


## 产品接入与追加独立核验（2026-11-06）

同一原件上的原生磁盘验证已通过：`live_disk.py` 将 first 的 RDB 冻结，再在全新的 Redis 服务加载，恢复 .4@100 的持仓、99999.98/4/99995.98 total/locked/free，随后 @110 平仓得100003.958，与 baseline 相同。`product_probe.py` 进一步调用实际 `engine.paper.main` / Session / Journal：分钟策略 SIGTERM 暂停、从新 Redis 实例加载、同一run继续平仓；两笔fill/fees与连续运行相同，`product-comparison.json` 留断言。此测试不是任意 crash 或 EMA 全路径证明。

独立评审源码排除了本 Sandbox 子集的“filled已终态、但该fill的账户/仓位另排队”窗口：execution Filled 同步完成portfolio/position/account更新，msgbus直接调用handler。前提为独立owner timer、无其他execution/adaptor/调整生产者，并在所有save hooks之后复查terminal/held/timers/depth/FAILURES。停机前也要检查，不能等native stop清除时钟后才检查用户timer。

Redis adapter会吞部分write/pipeline错误，故FIFO marker只能证明进度，不能证明写成功。发布前必须经native load_all读回，对比owner的原生orders/positions/account余额及保证金。仅在瞬时账户比较中忽略factory重置的calculate_account_state flag，压缩相邻、同UUID且完整payload相同的AccountState；不同payload拒绝，非相邻重复保留，RDB不改。owner与恢复后账户都必须是已初始化的Sandbox计算模式。当前协议排除依赖account.events/event_count表现的策略。

Native Redis读接口在LiveNode的Tokio callback线程内会触发nested runtime abort；实际失败探针已找到此边界，改为owner保持阻塞、单独I/O线程读回和SAVE。未声称普通Python线程是通用native屏障。

`daily_history_backtest.py` / `daily_history_padded.py` / `daily_history_nanosecond.py` 使用实际native BacktestEngine、VirtualClock、Catalog和request_bars(update_subscriptions)：恢复前720个一分钟输入，再继续721条，日线OHLCV及双时间戳与连续1441条完全一致。实际native nanosecond字段不改。Python datetime仅精确到微秒，因此工作Catalog用同一组微秒对齐的覆盖边界（write_bars start/end）包住原始行，请求同边界，避免纳秒边缘触发Binance REST补取。Catalog只在/tmp，原始Bar字段与顺序逐项校验。

Native聚合按minute.ts_init推进历史clock与builder，不按ts_event分桶。daily发布后晚到的前一日最后一分钟（ts_event在昨日、ts_init在今日）属于新bucket；检查按ts_init，不因市场事件日期拒绝。未经验证的乱序/相等ts_init、跨daily bucket、跨未观察funding settlement仍拒绝。首个被跳过的日线边界未被实际daily观察承接时也拒绝。无partial但已有daily观察时，恢复不能再次skip首桶；waiting point尚无聚合器，可以跨午夜继续等待原input start。

新协议封存用events/native.jsonl.gz替代按日parse/dump编码，保留完整原始字节（含半行），gzip mtime=0；不双存journal。manifest字节切点只能对解压原始prefix核hash，不能拿UI已解析事件重编码验证。current及实际used的RDB/manifest原样保留；临时Redis工作文件和历史Catalog均在/tmp。此编码决定经独立存储评审通过。

当前EMA新源码仍仅在/tmp。额外独立评审将on_save缩到plan/halted/risk_not_ready；stopping只断言false，sequence由同strategy/iid native orders tags最大plan序号派生（save核等，on_start派生；on_load不可重入读取NativeStrategy属性）。Native EMA与风险向量由原始external warmup和原顺序native_daily确定性重建，不保存派生读数副本，也不为hashlib放宽source import拒绝。固定参考方差在原external边界计算。ema_hooks_probe.py通过旧/新观察状态、恢复后下一次原生EMA更新与参考方差核对；仍待CI镜像下orders/fees/funding/account与实际Paper整体验收。


## CI 候选与首次镜像验收

PR #2207 已创建，首个提交43f6d16e4的全部CI检查通过。对应runtime digest为sha256:51d2eca20e2e690cb211bd0144314148f43f4ac3670e4f75050855830e1bf17e。该镜像在--network none、只读root、drop ALL capabilities、普通用户、只读inputs与单一reports写挂载下，实际启动随镜像携带的Redis，完成首次带仓暂停并生成有效原件；不是外部Redis替代测试。后续完整恢复/配对仍在验收。

本地必跑unittest suite通过831项（565.974秒），追加变更的聚焦测试另跑；ruff/mypy通过，前端TypeScript/规则检查/80测试与build通过。额外关闭一个timer漏洞：只检查当前timer_names不够，已经触发的一次性用户timer可能被恢复on_start再次创建。因此协议记录是否曾注册用户timer，曾注册者不发布point；内部HOLD直接走native clock，不被误标。此标记仅在内存，不能新增一项“恢复已触发timer”的存储机制。

## 实际 OS 信号边界

正常调用request_stop的探针不能替代Docker SIGTERM。固定rc7的run()自己监听SIGINT/SIGTERM并直接initiate_shutdown，可能绕过Paper recorder排空；run_async虽然由host拥有signal，却明确拒绝带cache database的node。故用标准POSIX进程集成：模块入口在导入Nautilus或生成worker之前屏蔽SIGINT/SIGTERM及私有wake信号；一个sigwait线程同步收信，只request_stop，由recorder完成drain和handle.stop。采用sigwait而非sigtimedwait以兼容macOS；wake信号退出线程并恢复调用者mask。Redis子进程由独立Python exec入口清除继承的mask，避免其正常关闭被屏蔽；不使用多线程进程中不安全的preexec_fn。不改Nautilus源码、不更换框架构建。真实OS信号与native container验证通过后才启用。
