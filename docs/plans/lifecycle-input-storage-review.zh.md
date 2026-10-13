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
