# 统一策略源码：rc7 原生组合与数据边界实验

2026-11-08。承接 [R1 正式设计草稿](https://github.com/qOeOp/trade/pull/2480) 的 U1；本次未升级 Nautilus、放开产品检查、修改交易验收或实现自有订单管理器。**当前候选 B 未满足持续保护要求，不能进入正式源迁移 U2。模块化 R1–R4 继续独立推进。**

本报告区分三类证据：锁定版本源码/文档说明提供了什么，原生本地实验说明具体组合如何执行，真实交易验收说明交易所实际发生了什么。本次仅有前两类。策略正文、合成输入和原始结果仅在 `/tmp/trade-live-refactor-goal-20261108`，不进入研究账本或 Git。

## 1. 原生 OTO 的真实 Binance adapter 路径

候选 B 为原生 LIMIT/GTD parent、venue STOP_MARKET、LAST_PRICE emulated target，使用原生 `manage_contingent_orders=True`。此前原生模拟匹配器可修改 stop，不能据此推导 Binance adapter 能处理同命令。

这次先测试独立 stop，再将真实原生 bracket/OTO 放进 LiveNode：Binance data/execution factories 的全部地址指向本机 loopback；使用虚构 key、合成行情和协议回报。框架负责配置、订单、风险、持仓与状态更新；fixture 只发送 HTTP/WS 数据，不写 native cache、不手调用策略回调或 modify。

| 原生路径 | 实际观察 | 结论范围 |
| --- | --- | --- |
| STOP_MARKET 接受后改量 | POST algo 接受 0.001；修改为0.002时返回 `OrderModifyRejected`，原因是缺少价格；没有订单 PUT，缓存仍为 ACCEPTED 0.001 | 精确的 adapter 本地拒绝，不是交易所回绝 |
| B 的两次部分成交 | parent 0.002，第一笔0.001后原生 OTO 释放并接受0.001 stop；第二笔0.001后原生 manager 发出扩量，adapter 拒绝；最终 native持仓0.002、已接受stop0.001 | 当前 B 在该事件序列不能持续覆盖已成交数量 |

第二组 parent 的GTD保留整秒精度和超过600秒的提前量；第二笔结束时parent已完全成交，未声称覆盖余单到期、目标触发或整个退出生命周期。首次非整秒deadline的失败原件保留，之后只修正实验输入精度，没有放宽原生要求。

调用链在 rc7 源码：`order_manager/manager.rs` 的 OTO quantity action → `trading/strategy/mod.rs` 的原生 quantity-only modify → `adapters/binance/src/futures/execution.rs` 的 `price = cmd.price.or_else(order.price)` 检查。STOP_MARKET 没有 limit price，拒绝发生在 HTTP/WS 请求之前。给它虚构 price 或换 STOP_LIMIT 会改变语义，不能当作通过该场景的补丁。

原件：`u1-protection/native_stop_resize.py`、`resize-result.json`、`native_partial_resize.py`、`partial-resize-result.json`及日志。独立评审 `U1-RESIZE-PROBE-REVIEW.md`、`U1-PARTIAL-RESIZE-REVIEW.md`认可上述局部反例，未认可正式实盘方案。

## 2. 框架已有 close-all，仍需区分组合与模式

rc7 的 [Binance 文档](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/docs/integrations/binance.md#close-position)已提供单个条件单的 `params={"close_position": True}`、对应风险配置及 Hedge closing side。其作用域是账户的品种方向腿；不能把它当作交易所认识策略子仓位。

检查 Python 桥接、原生 manager、adapter 和现有测试后，有三个明确边界：

- OTO/list 的原生子命令创建路径使用 `params=None`，当前组合不会把close-all参数自然传给stop；native manager也没有因此停止后续resize。
- Backtest和Sandbox的SubmitOrder路径只把OrderAny交给匹配器，不将该参数变成整仓关闭语义；风险allowlist只处理准入，不补执行能力。
- 现产品独立限制params/list/emulation/modify；这属于产品边界，不能误称框架不支持。当前数量保护判据也不能用placeholder或一次查询快照代替。

已经用**同一文件、同一个Probe类、同样业务参数**执行原生Backtest和LiveNode+Sandbox反例：开仓1.000，提交0.250 reduce-only stop并携带close_position参数，风险allowlist启用；两个模式均成交0.250，原生持仓剩余0.750。Sandbox使用原生simulated execution factory，数据client仅发送四个合成quote，没有自写成交模型或100ms完成屏障。

这证明该小于实际仓位的占位数量不能仅靠该参数获得三模式整仓退出；未执行真实Binance close-all，也没有用此实验声称严格收益parity。原件 `u1-protection/close_all_simulation.py`、两份 `close-all-*.json` 与日志；独立评审 `U1-CLOSE-ALL-SIM-REVIEW.md`。已有原生机制及未验证替代项详见 `U1-NATIVE-PROTECTION-REVIEW.md`，本报告不批准自写cancel/replace、增量stop分发器或execution algorithm。

## 3. 历史响应与因果时钟

复用 rc7 `python/tests/integration/test_python_data_client.py` 的历史请求相关性测试路径：原生 LiveNode → request_bars → Python MarketDataClient → BarsResponse → DataEngine → on_historical_bars。没有网络或execution client。

| 输入 | 实际结果 |
| --- | --- |
| 完整81根 | 一次相关回调、原序列完整 |
| 缺根、重复、倒序、空响应 | 交付80/81/81/0根；探针的精确集合检查不就绪 |
| 一根超请求end | 原生范围裁剪后只交付80根，按缺根失败；不是策略看见未来根再拒绝 |
| 约T+29秒返回 | 实测29.000426秒，期限前就绪 |
| 约T+30／31秒返回 | 实测30.001324／31.001351秒，期限已失败，晚响应不重新就绪 |
| 无响应 | 期限失败，无伪造完成回调 |

T在本探针中为原生on_start时间，尚未与正式15m对齐启动组合。探针故意在期限后继续观察响应；不能把它描述为正式策略已执行停止。也未测试timer与响应精确同一纳秒的先后。

同correlation重复响应只回调一次，但**并不意味着引擎/cache没有处理第二包**：故意将第二包同刻最后close从1.20000改成1.20500，策略只收到首次1.20000、仍ready=true，最终原生cache却为1.20500。源码处理顺序是范围裁剪、bars/cache处理，然后一次性取走response handler。正式设计中的“矛盾重复响应失败”若包括已完成请求的额外包，策略回调层目前无法证明它；该要求仍未验证，不能偷偷改成自动通过或另造响应代理。

另用同一Probe在原生BacktestEngine注入实际1m先/15m先两种同刻顺序，均跳过边界1m，在下一分钟消费新signal。实际回调顺序与native clock逐项核对。这里只验证设计中的因果选择，不是完整Retest信号/订单验证。

原件在 `u1-warmup/`；独立评审 `U1-DATA-REVIEW.md`已核对上述边界。第二包是合成adapter故意违约，不能据此推断Binance会发送该数据。

## 4. 后续原生同步与经济结果（2026-11-09 补证）

以下补证保留前述失败。它缩小了旧 placeholder 反例的适用范围，没有把候选 B 的 quantity-only modify 反例改为通过，也没有放开产品 params 准入。

### 4.1 优先使用匹配器已有的减仓单同步

锁定源码 `crates/execution/src/matching_engine/mod.rs` 的 `sync_reduce_only_orders` 在 position fills 后同步同一 native position 的被动 reduce-only 单：目标数量包括已成交量与当前剩余量；独立单不受 parent quantity cap。`resize_order` 不只允许减小。原生测试 `test_position_fills_sync_reduce_only_orders` 已覆盖独立单/关联单、NETTING/HEDGING、inline/deferred、LIMIT/STOP_MARKET/STOP_LIMIT 等组合。本次直接复用发布版原生匹配器验证增长和缩量，不在 source 中调用 ModifyOrder 或重建数量账本。

| 独立原生实验 | 实际输入与观察 | 能证明的范围 |
| --- | --- | --- |
| 两次入场增长 | 原生仓位先0.250，此时提交数量等于当前仓位的独立 stop；追加0.750，stop由原生OrderUpdated扩至1.000，随后完整退出 | 已有机制能增长；这组两次入场不是产品首轮一次入场合同 |
| 单LIMIT分两次成交 | 一张LIMIT 1.000，L1原生liquidity consumption使其先成交0.250再0.750；stop原生0.250→1.000，最终flat | 不需要策略自写resize；相同文件/class用于Backtest与Sandbox |
| 默认风控配置 | 上述单LIMIT使用默认RiskEngineConfig/LiveRiskEngineConfig，不设置full_position_exit_venues；两端仍stop1.000成交、flat | q=P且满足普通filter时无需placeholder风险例外；不是小余仓或venue过滤全覆盖 |
| 部分退出 | 累计入场1.000后，提交0.500原生reduce-only MARKET；独立stop原生1.000→0.500，再触发退出剩余0.500，最终flat | 原生同步同时支持增长与缩量，无策略Modify/Cancel；未覆盖网络竞态或真实venue |

这些是内存合成报价的能力探针，不是CI固定镜像回放或正式Retest验证。原件在 `u1-protection/` 的 `close_all_growth.py`、`close_all_partial.py`、`close_all_default_risk_v1.py`、`close_all_partial_exit_v2.py` 及各自模式结果；策略不读MODE，模式只选择原生builder，业务参数相同。partial-exit v1最后的诊断断言误用了原生to_dict键 `reduce_only`（实际为 `is_reduce_only`）；v1失败与输出保留，v2仅修正该读取，未改执行逻辑或原产品验收。

Binance close-all原生请求/数量delta/恢复机制需要另行核对。模拟器忽略close_position参数这一事实仍成立；这里只证明初始q=P再使用原生同步的组合，不证明真实Binance会产生相同中间OrderUpdated，也不把实际腿级close-all覆盖自动算成产品当前的accepted leaves覆盖。

### 4.2 不能把数量通过等同经济结果一致

同一单LIMIT部分成交探针出现可重复的差异：首0.250 @100两端均TAKER、费用0.0125 USDT；第二0.750 @100在Backtest为MAKER、费用0.015，在Sandbox为TAKER、费用0.0375。加上同样的stop退出费用0.045，两端总费用分别0.0725和0.095 USDT。经济一致性没有通过，没有对齐费率或删除费用维度。

为隔离原因，另用同一最小文件移除所有保护单、close_position params和风险例外，仅保留一张LIMIT及两次原生成交。差异仍在：Backtest入场费用0.0275，Sandbox0.05 USDT。这个探针有意留下模拟仓位，用来隔离入场分类，不能称完整生命周期通过。它没有导入产品Live/Paper wrapper，说明现象不依赖保护逻辑或该接入层。

在两次成交间加入101的不成交报价并只读native cache：两边均PARTIALLY_FILLED/0.250，Backtest订单liquidity_side为MAKER，Sandbox为TAKER。rc7源码中，首次marketable LIMIT fill后将剩余缓存订单标为MAKER；Sandbox handler通过异步channel传递fill，随后OrderFilled应用会写入fill的TAKER字段。下一fill使用cache snapshot中的side。这与观察一致，但尚未用原生inline/deferred最小测试直接证明内部覆盖顺序是唯一原因。

原件 `liquidity_side_trace_v2.py`、`liquidity_single_limit_v1.py`及两模式JSON/log。trace v1在订单回调读取clock触发native借用错误，保留为失败；v2只在quote回调采样，时间取事件字段，日志无该错误。版本读取来自实际importlib metadata（2.0.0rc7），不冒充固定OCI身份认证。没有修改框架、提出已完成修复或向上游发消息。

统一源码不承诺不同成交环境的收益逐值相等；但同模型、同合成流中的这项未解释完毕的执行差异必须保留。后续正式验证要明确可解释差异与合同失败，不能把本机制探针包装成策略经济parity。

## 5. 后续门槛保持

本轮发现具体组合的反例，而不是证明Nautilus整体没有保护机制。下一步应继续用原生配置、事件、订单管理与官方测试评估替代组合；如确需补充机制，先给出具体缺口、不可由现有能力组合表达的证据和最小设计，独立评审后才实施。

当前不迁移两份正式Retest，不修改SOURCE_REACH、Live命令准入、保护数量判据、GTD分类、历史记录或风险范围。完整同hash/class/业务参数的三模式验证、正式自然信号、无hold异步、恢复与连续交易仍未完成；不能拿受控类或本报告的Probe代替。
