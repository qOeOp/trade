# 生命周期输入修复：存储与职责决定

2026-10-14。用户授权解决全池入口诊断揭示的生命周期问题。保留原市场 commit、月度 pool、窗口、旧封存；不修改原始市场行。

独立 `/root/native_source_review` 只读检查既有 schema、evidence、输入指纹、登记绑定、v7 构造器与 `_plans` 后确认：复用 `evidence_bundle/evidence`，不新增 SQL 表或列。生命周期边界、禁新仓时间、实际结算价格是不能从分钟 LAST/MARK、funding、当前 terms 或 pool 推导的独立事实。产品代码限于不可变输入绑定、合约身份隔离和既有适配缺陷修复；订单、成交、取消、结算与账户归 Nautilus。

## 最小存储表达

新增 evidence 文件 `lifecycle.json`，原文与说明继续保存在同一 evidence bundle：

- manifest 的 `symbol` 与 `instrument_id` 映射：exporter/runner 用于将重用 ticker 分为不同原生合约及策略实例；strategy_id 由映射派生。既有单 instrument_id 关系不能表达两个独立生命周期。
- `start_ns`：episode 内截取及暖机的消费者；来自权威开市事实，初始生命周期未知可为 null（左侧截断，不声称上市）。重新上市实例须有明确起点，不能从首根 bar 猜测。
- 原生 InstrumentStatus/InstrumentClose 字典 `events`：状态事件一次表达禁新仓时点，CONTRACT_EXPIRED 一次表达结算时点及精确 Price；不另存 close_only_ns、end_ns、settlement_price。
- `sources`：指向该不可变 bundle 内已保存的事实原文；出处、发布时间、读取限制和未知项留在既有 evidence notes。字典内容或哈希本身不证明来源。

原始 market commit 仍表达原分钟数据。所选 bundle 的全部原文、manifest、原生事件与映射进入既有 export_content_sha256；新增模块进入 exporter_source_sha256。precheck/register/run 使用同一不可变 bundle 的快照，不在实际回放时重新访问网页替换事实。原 pool 范围与 episode 的实际导出/有效开仓范围分别留存，不静默删币。

v7 构造器不新增参数：每个 episode 仍接收原生 instrument_id、独立 strategy_id、episode 内历史输入及 membership。按原生身份区分实例，不能仅用目录后缀而继续按相同 coin 混合状态。旧源码需要原生预检，稳定合约需要配对回放。完整未来生命周期边界仅能声明为外生法定执行区间；不能据此宣称已完成公告时点可知的 PIT 策略回放。结算 Price 不通过构造器提前暴露给策略。

## 检查变更的授权与边界

独立审查指出：原生到期关闭订单可能没有 source `plan:` tag。目前 `_plans` 拒绝所有无标签订单。可评审的安全方向是在分析中通过原生 closing fill、唯一 position cycle、该 cycle 唯一已标记的 source plan 和本次 InstrumentClose 只读推导归属，保持原始报告原样；混合计划、孤立成交、歧义、普通无标签订单继续拒绝。

2026-10-14 已向用户具体说明“相同生命周期输入的预检校验”与“原生到期关闭单的严格只读计划归属”会改变现有检查，用户随后明确回复“授权”。这两项获得授权；仍不伪造 tag、不忽略到期订单、不接受歧义或普通无标签订单。register/bind 核对预检原始捕获中的同一不可变 lifecycle bundle 及固定 market commit，允许工程预检窗口不同；既有 source/image/native/API/causal/readiness 条件保留。

真实价格缺证据也不以 LAST/MARK 替代：币安既有原公告规定结算使用最后30分钟的1800个每秒指数价格。工程人工事件只能证明工程行为，不能作为历史结算证据或十轮效果。未来结算 Price 不改变初始 instrument precision/tick；只有其生效时刻进入原生事件。完整证据与 manifest 在只读输入挂载内，不能声称对任意 source 的未来文件访问隔离，仍须精确源码因果审查。

PRE_CLOSE 的原生语义需实际 CI 原生试验；不能假设它自动禁止非减仓，也不能用 HALT/PAUSE 冒充 close-only。原生关闭、旧工作订单及 source 的开仓范围分别检查。

## rc3 实际能力边界

独立 Agent 核对 PyPI 2.0.0rc3 对应官方源码 revision `648970ce64a304d93da0a29320cb6e19b905fa39` 与实际 CI 原生原件。其 expiration 的 `apply_fills` 仍以 instrument 的初始 precision/tick 整数网格过滤价格：人工八位价格产生了到期取消单和未平 LONG，即使 native/G 均退出0。后续人工可表示价格产生唯一到期 closing fill、FLAT0 及关闭回调。原件保留在隔离库，不改写第一次结果，不作为真实历史价格或经济反馈。

adapter 只对实际输入窗内的结算核对原始精确价格是否能在既有网格表达；不舍入、不从未来价格修改初始 precision/tick。窗口前的权威 InstrumentStatus(CLOSE) 可表达已终止生命周期，无需发明不参与本次回放的历史结算价格；窗口内 CLOSE 需同一时刻的完整 InstrumentClose。结束时间仍由原生字典推导，不新增 end_ns 或第二份价格。

只读归属从既有 Reports 内存对象读取已有事件，未增加任何 SQL/JSON 持久字段。load_run 先用 execution.read 校验原始 start/capture 身份、长度和哈希，再比对 run input_identity、source/runtime/summary；封存前核对本地事件与原始 capture 一致。旧无 lifecycle 输入的运行不追补事件；新输入捕获损坏或矛盾不能降级为空。计划归属保留其限定：字段不能认证生成者，精确源码审查必须排除仿造原生关闭单的路径。
## 未定价终止的授权边界（2026-10-14）

用户明确授权保留原池、原全年窗口和 RSI 路线，退市前原生平仓，终止时严格核验空仓及无活动订单；全池验收通过后执行十轮。该授权覆盖窗口内未定价 CLOSE 的输入检查变更及相应强制核验，未授权补造结算价或跨退市持仓。

未定价 CLOSE 只供应原生终止时钟。独立审计与生产读回共享只读核验：从原始订单、成交、仓位事件检验每个原生仓位在终止前归零，所有订单（包括 dormant/条件订单）在此前全量成交或终止；同钟平仓/取消、迟到成交、部分成交、留仓、活动订单、缺失或冲突原件均拒绝。输入覆盖原件另以只读挂载供 CI 镜像审计，不能信策略诊断字段。原有精确 InstrumentClose 价格/tick 检查与到期计划归属仍保留，原封存报告不改。

未增加 SQL 字段或另一份生命周期存储；仍从原始 input-coverage 捕获解析既有原生状态事件，使用已有 integrity/findings 和 evidence。通过只表明相关源码在终止前退出，不证明自动结算价、任意跨退市策略或真实场内逐笔成交重现。实际源码首次 RSI 就绪、重新上市重置、决策与成交时钟仍须独立原生验收。

### 2026-10-14 独立审查后的完整性修复

实际 native summary 的逐实例 InstrumentStatus/InstrumentClose 计数必须与原始 coverage 的 episode 映射一致；有原生生命周期事件时，缺 bundle identity、缺 episode、计数不一致或重复实例均拒绝，不能降级成空事件。此修复落实用户已授权的严格终止前空仓检查，不增加存储字段。

多合约生命周期实例保留唯一的原生策略订单 ID tag；单纯以 `-E1` 结尾会使 Nautilus 的默认 tag 在不同合约间冲突。无生命周期的既有策略 ID 保持原样；生命周期实例的最终 ID 段包含完整合约和批次，保留 1000 前缀以避免别名碰撞。

### 2026-10-14 全年观测报告的资源修复设计

独立只读 Agent `/root/native_source_review` 审查后支持：内部 `CapitalObserverConfig.exposure_path` 由既有 `args.output` 派生，仅把报告输出依赖传给 observer；消费者仍为现有原生曝光报告及其 reader，独立事实和持久字段仍为 `exposures.csv.gz`，无需新 SQL 或研究字段。既有 output 字段表达路径的事实，config 内部传递避免全局隐式依赖。

观察器是唯一写者，按原 `_value` 时钟、位置顺序和 Nautilus 原生估值逐行流式写出，finish 在组件停止后完成末采样并关闭压缩流；report 不覆盖文件。header、newline、encoding、gzip filename/mtime 不变，不逐行flush，要求与原完整列表写法字节一致。写入失败保留完整性 finding，flush/close失败原样传播为运行失败；中断的部分文件只能作失败原件。原精确采样计数、空仓/订单、费用/资金费、经济及封存检查不放宽。

MARK去重从实际Parquet batch合并精确unique集合，内存为当前union加一个batch，不按日历推算、不删缺口。此次修复不证明全年可运行，需新CI及BTC/ETH、原210池短窗的原生配对，随后原全年验收。独立审查保留后续consumer风险：readings整体曝光解压和capture大小限制若再次阻断，不能截断输入或跳过消费者。

后续 reader 的独立设计审查同样支持原样流式解析：逐行gzip/CSV按原类型读取并执行cycle/grid/count/residual核验；默认readings仅保留逐时钟精确Decimal汇总，耗尽生成器并验证EOF/CRC及尾部约束后才返回drawdown。显式 `tables(exposures=True)`仍返回完整验证list；不改变格式/检查/容差，没有新增存储字段。最后一行缺失、残值冲突、非法行及gzip截断均不得返回部分drawdown。原64MiB capture/evidence限额原样保留。
