# Binance Hedge 阶段 A 原生验证

日期：2026-11-06。设计基线：`5138820c1`，见 [双向账户设计](binance-live-hedge-design.zh.md)。
依赖固定为 `uv.lock` 的 Nautilus `2.0.0rc7`。本记录为离线机制验证；尚未完成全部阶段 A 验收。

## 边界与方法

本轮只使用合成本机 HTTP/WebSocket 交易所输入、原生 Binance adapter、LiveNode 和隔离 Redis。
订单生成、wire 编解码、事件处理、持仓归属、缓存序列化和启动对账均由 Nautilus 执行。
没有读取真实凭据、连接真实交易所、发送真实订单、修改账户或生产检查，也没有写研究账本。
临时脚本、输入、日志和派生结果保留在 `/tmp/trade-hedge-phase-a-20261106/`，不复制进 Git。

先用本机已安装的 rc7 wheel 验证；成功用例再用现有 CI 镜像、`--network none` 复验。
镜像为 `ghcr.io/qoeop/trade-runtime@sha256:b0986f235ed94bc9c794fbc9b355a2431f53c0915b291fa9374d62da8c1f3797`，
对应 `main` 的 `dc49edba7751e0732563200fc9347e42aeaac79e`，ARM64。
各项实际完成度在下文记录，未执行的场景不因源码或上游测试存在而算通过。

## 已发现的构造边界

第一轮 wire 用例暴露了配置与实际行为不一致：在 Python 策略子类的 `__init__` 才传入
`StrategyConfig(use_uuid_client_order_ids=True)`，`.config` 虽显示开启 UUID，原生订单工厂
仍使用默认 O 格式。正确地把配置传入原生 `Strategy.__new__` 后，需要重新验证实际订单。

rc7 的 `PyStrategy::py_new` 创建原生 StrategyCore，`__init__` 负责 Python 实例和配置对象绑定；
这两个步骤不能被当成可互换。当前产品 `_LiveConfigured.__new__` 调用无配置的
`Strategy.__new__(cls)`，而两个 Retest 工作稿在 `__init__` 才创建配置。
因此仅给工作稿追加一个 UUID 字段不足以证明产品有效。

独立代理以原生 BacktestEngine 对照，并在上述 CI 镜像禁网复验，确认：

| 配置消费者 | 仅在 `__init__` 传配置 | 完整配置进入 `__new__` |
| --- | --- | --- |
| OrderFactory UUID | 45 字符默认 O 格式 | 36 字符 UUID |
| GTD 管理 | 没有原生到期 timer | 创建原生 GTD timer |
| `manage_stop` | 直接停止，仍有模拟持仓 | 进入原生 market exit，最终模拟仓位为零 |
| 策略 NETTING | 有效 | 有效 |

NETTING 的差别来自节点注册另行读取 `.config.oms_type`，不能据前三项概括为所有配置失效。
`manage_contingent_orders` 核到同样的 core.config 消费路径，但本轮未单独运行 OCO 行为测试。

最小修正方向是源码在自己的 `__new__` 创建完整原生 StrategyConfig；宿主包装器透传既有
源码构造参数；`__init__` 保留同一配置对象。另一原生探针已证明该委托路径可以生成 UUID。
宿主不枚举配置字段、不强行覆盖源码值，也不新增配置映射语言。产品必须测真正包装后的
两个源码，不能只测裸 `Strategy(config)`。共享 replay 构造路径有相同结构；若修改它，
另按既有原生配对验收处理，不从本发现推断历史研究结果损坏。

证据目录：`construction/`；CI 复验：`root/ci/construction/`。

## Binance 协议往返

本机和固定 CI 镜像的六组均通过：LONG/SHORT 各自验证普通/算法单查询撤单后市价退出、
只用 REST 查询接受保护单、算法触发后的普通成交。原生 UUID 为 36 字符，Binance 原生编码
后的 wire ID 为 34 字符；普通单、算法单、撤单、查询和回报均关联原 ID 与原策略。
Hedge LONG/SHORT 腿正确，wire 不发送 `reduceOnly`，原生 `close_position` 和算法触发成交
都落在原 NETTING position。REST 接受用例明确不发送对应保护单 NEW WebSocket 事件；
触发用例包含算法 ID 到实际普通订单 ID 的提升，不只验证算法单接受。

脚本 `wire/native_binance_wire.py` 的 SHA256 为
`f2215252a4e7ebfc20d7ae3ddbd8e2a558d85403a723c9cc041b5ccd1f20e274`。
CI 结果在 `root/ci/wire/ci-summary.json`。这些是受控输入的协议/归属证明；
尚不代表断线、未知订单、保护竞态、费用和账户经济学已完成验收。

启动日志保留 `incomplete bounded reconciliation` 提示。rc7 Binance 在未指定 lookback
时将报告标为不完整；这批空缓存 wire 测试不因此被当成完整历史恢复证明。

## 未首成交冷恢复对照

原生节点先产生一张 `ACCEPTED` entry，确认缓存中尚无 position 且订单 `position_id=null`；
退出该节点后，用相同 trader、Redis 原件和新的原生节点进行启动对账。
假交易所此时通过原生 REST mass-status 路径报告首笔成交。

已观察到：只注册 Observer 时，补成交创建 HEDGING 风格的 `P-…` position ID；
注册同原 StrategyId、NETTING 的无交易 base Strategy 后，补成交得到
`BTCUSDT-PERP.BINANCE-LIVE-abcdef012345`，与不中断 NETTING 路径一致。
两种恢复均保留原策略归属和 `0.002` 数量，且未发出交易命令。

上述第一组对照采用原生 `generate_missing_orders=False`。本机随后补测同身份成员恢复的
默认值 True 路径，也保留正确 NETTING 身份；已存在 position 的部分成交恢复中，Observer
和同身份成员都能沿已有 NETTING position 补齐。直接通过原生 RedisCacheDatabase 读取
`general:position_oms`，确认未首成交 Observer 路径为 HEDGING、成员路径为 NETTING；
不是仅凭 ID 形状推断。上述结果已在固定 CI 镜像、禁网环境复验；节点使用镜像内自建的
loopback Redis，AOF 保留，最后通过 SHUTDOWN 正常关闭。

## 双腿启动对账

本机用完整缓存中的两个不同策略 NETTING 仓位（LONG/SHORT 各 `0.002`），分别交换
交易所报告顺序并测试原生 `generate_missing_orders`：

- False：两个顺序均启动成功，保持原两张订单与两个仓位。
- True：两个顺序均以 `Unresolved positions` 拒绝启动；缓存先新增三个 EXTERNAL 合成
  订单/仓位，新增方向受报告顺序影响。这是原生缓存修正副作用，没有向交易所发单。

另以缓存 LONG/SHORT 各 `0.002`、报告各 `0.003` 验证相同净量的错误输入：False 在两个
报告顺序下均以 `Unresolved positions` 拒绝，Observer 不启动，保留原两单两位且无场所交易
命令。上述正确/错误矩阵全部在 CI 镜像禁网复验。它证明 False 保留本组最终双腿校验，
不能扩展为所有缺失成交都能恢复；True 的反例也不意味着定期对账失败。

冷恢复脚本 `cold/native_cold.py` SHA256：
`d679b885c1828c589f1e52778e43bee36a302b90adb4a4016ae73412e43f7d20`；
错误两腿脚本 `cold/native_cold_wronggross.py` SHA256：
`3faf4d402605ac696244e1cc3d5b8a9374619c7420962801a377fbdea69dd8b5`。
本机与 CI 均包含一个不中断基准和 11 次独立冷恢复；预期拒绝不记作恢复成功。

## 同向迟到保护成交

LONG/SHORT 两个方向均运行以下受控输入顺序，并在 CI 镜像禁网复验：
A、B 各入场 `0.002`；A 的保护算法单接受；A 普通退出成交而保护仍接受；随后报告 A 的
算法触发及保护成交。此例没有请求撤单，不冒充“撤单请求与触发竞争”已经测过。

原生订单和成交继续保留 A 的 UUID、strategy/position ID。引擎拒绝从本地 reduce-only
成交重新打开 A，未把成交归给 B；A 保持 flat、B 的原生仓位仍为 `0.002`。
但输入的同一交易所腿已收到两笔入场及两笔等量退出，成交累计净量为零，形成成交与仓位
不一致。rc7 记录 `Cannot open NETTING position ... from reduce-only fill` 后继续运行，
这个分支没有自动停止节点。

这是原生错误处理边界，不是并发设计通过，也不是 Binance 实际会接受该顺序的证据；
夹具只提供场所协议输入，没有实现交易所撮合和账户状态。不能删除本地 reduce-only 来
消除错误，也不能自行把迟到成交改记给 B。共同 STOP 和最终账户空仓都不能替代中途归属一致。
因此同向并发仍未通过：需要先证明保护退出顺序、异常后的阻止开仓与原生对账路径，
再决定是否允许阶段 C。

脚本 `wire/native_binance_late_stop.py` SHA256：
`0b303e2550ac1fcc2a99ed70e0178dddd6bf72bf6d71bb7483256ad36af2f479`。
证据有四步原生快照、全部 HTTP/WS 与原生日志；CI 在 `root/ci/race/`。
根代理对 CI 原件另做 83 项语义断言（`root/verify_ci.py`、`root/ci/verified-summary.json`），
确认协议成功、预期拒绝、OMS 原件以及竞态差异；断言通过不将负向结果改记为安全执行。

## 尚未闭合

- 正式产品包装层及两个实际适配源码的构造修正与行为验收。
- 同向不同入场价的场所语义与恢复；保护撤单在途、部分成交及并发退出的完整竞态。
- 发生迟到保护成交后的阻止开仓与原生对账恢复，以及更广的重复/缺失成交覆盖。
- 阶段 A 表中的连接、存储和停止异常项；Retest 预热及实时 15m 边界另按设计验收。

Binance 官方的 [breakeven 说明](https://www.binance.com/en/support/faq/detail/8a2bc34f411b414888fb10a2db851a9b)
说明部分退出会重算 breakeven，但不足以证明 API `entryPrice` 的部分退出语义。
不得把它当作同向剩余仓位入场均价保持不变的依据；条件性合成报告也不等于真实场所事实。

本轮完成了足以修订实现方向的第一组阶段 A 验证，尚未通过全部阶段 A 条件，未进入产品
接入与真实账户试验。下一步先修正真实源码/包装层的构造契约并验收单成员生命周期；
两个 Retest 仍以顺序执行为交付方向，同向并发不提前开放。是否采用非默认缺失订单配置
须单独审阅其恢复边界；不以关闭最终对账、重写策略损益或补建仓位分摊表绕过。
