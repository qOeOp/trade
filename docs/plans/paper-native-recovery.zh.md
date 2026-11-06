# Paper 原生恢复实施方案

状态：2026-11-06，用户先选择“先只完成方案与原生验证”，随后明确授权“实施生产恢复，该合并的 PR 也合并”。原方案的四项恢复原件与恢复失败拒绝分支进入实施范围；生产恢复尚未启用。已完成 pinned API、源码、独立存储评审和下列隔离原生探针；未修改产品恢复代码、活动账本、生产运行容器、策略版本或主机配置。

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
