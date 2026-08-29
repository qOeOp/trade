# Strategy Factory

## 职责

Strategy Factory 是包围 R&D、探索性 Backtest 和独立 Qualification 的价值流边界。R&D 内含 Research 与 Develop 能力；该边界让 R D Q 分离清晰可见，但不成为新的 Owner。

## 正向路径

带来源假设只是一项提案。在任何保护反馈之前，R&D 先原子预提交一个绑定 principal 与 request scope 的 Independence Basis Receipt。Qualification 直接解析该准确 R&D 回执，并在检查其完整持久 principal/scope 历史后只返回 `GENESIS_EMPTY` 当前不透明 `FRONTIER(ref, cut)` 或 `UNAVAILABLE`；只有经证明 Qualification 历史为空时 genesis 才有效。Product Edge 仅搬运绑定同 principal/scope 的不透明投影，不接收保护细节。R&D 在锁定的准入事务内把自身完整本地语义前驱血缘解析为 `GENESIS_EMPTY` `COMPLETE_FRONTIER` 或 `UNAVAILABLE`。只有两个 Owner 的准确当前规范回读都成立时，才能原子创建冻结 Research Intent 永久 TrialFamily root 初始 census member 与 head 回执和 outbox。调用方不能提供或覆盖任一 frontier 独立性 disposition 或 basis identity。

Qualification 的 PostgreSQL custody 在物理上独立：`qualification_owner` 拥有其表与锁定准入函数，另一个 Qualification writer 执行投影写入。R&D role 对 Qualification 表没有 ownership、raw `SELECT` 或 DML。它只能在调用方 R&D 事务中执行固定安全 `search_path` 的 `SECURITY DEFINER` 准入函数；该函数使用全限定读取并保持锁顺序，只返回不可信 raw envelope。Qualification-owned Rust 必须把 envelope 与规范 R&D basis 和完整 Qualification 历史交叉验证后，才能构造密封且不可反序列化的正向 readback；不得公开 raw-envelope 正向构造器。

Qualification 投影构成一条按 principal/scope 绑定、只追加且无环的单链。某个准确且已验证的 Independence Basis 的最新投影若在 Qualification 提交或响应丢失后过期，只有 Qualification Owner 能在同一 principal/scope 锁下追加后继；该后继绑定准确 basis ref/digest、前驱投影 ref/digest、不变的规范 source sequence/cut/frontier、Owner clock epoch、新半开有效期、回执与 outbox，并原子推进 head。仍为 current 的投影必须按字节等价 join；调用方与 R&D 均不得自行续期。历史 R&D 终态 custody 继续绑定并暴露其实际消费的准确历史投影，而新的 S1 写入必须在最终锁定 cut 使用规范最新且仍 current 的投影。

R&D 内的 Develop 能力返回内容寻址 Strategy Artifact 和 Build Receipt，Research 能力再冻结一个 Exploratory Replay Request，绑定准确工件 数据范围 重放配置和模型身份后，独立 Backtest 服务才接收。探索事实只返回 R&D 并可形成后继 Intent。R&D 维护只追加 TrialFamily Census Frontier，且只有 R&D 能提交 Iteration Decision；终态停止不创建 Selection。只有 `READY_FOR_SELECTION` 决定才能产生仅选择 `SELECTED_FOR_QUALIFICATION` disposition 并提交 Qualification Candidate。

<a id="strategy-design-v2-shared-lifecycle-kernel"></a>

## StrategyDesignV2 与共享生命周期内核

这是把任意已接纳 Research 转换为可执行策略的顶层契约，不是第二个 Strategy Owner 或 runtime。唯一
正向形态是：

`Research Intent -> StrategyDesignV2 -> StrategyPlanV2 -> StrategyArtifactV2 package -> generic ProgramHostV2 ->`
`shared lifecycle kernel`。

成熟度边界必须明确：

- **CURRENT/PARTIAL：** V2 冻结下文所述的规范 Design/Plan 含义、内容寻址 package、有界 plugin ABI，
  以及通用 host/shared-kernel 执行边界。共享内核现已包含有界的"准确两个成员"Market Data universe
  纵向切片：一份完整 Owner-sealed frame 只调用一次 plugin、只返回一份按规范 instrument key 排序的 target
  set；只有完整集合校验成功后，host 才同时提交两个成员的生命周期状态和单一组合 checkpoint。一份
  non-default、零参数 sealed acceptance corpus 会执行真实 Market Data Owner issuance、准确 Plan 编译、单次
  guest 调用、member-causal target、malformed output 原子拒绝、replay 与 restore；这只属于有界 crate-local
  acceptance 证据。本地 bounded-plugin producer 接纳准确且 fail-closed 的 macOS arm64 与 Linux ARM64 host
  profile。Linux ARM64 只在 main-bound hosted native A0 证据边界达到 **CURRENT/PARTIAL**：准确 workflow
  [`strategy-factory-linux-a0`](https://github.com/qOeOp/trade/blob/9e5149d4293a800be3a35e6b747a9f3dba304e1f/.github/workflows/strategy-factory-linux-a0.yml)、
  head `9e5149d4293a800be3a35e6b747a9f3dba304e1f` 上的 `workflow_dispatch`
  [run 33250411708](https://github.com/qOeOp/trade/actions/runs/33250411708)，以及 job
  [`strategy factory A0 native gate (linux arm64)`](https://github.com/qOeOp/trade/actions/runs/33250411708/job/99095016988)
  已在 GitHub-hosted `ubuntu-22.04-arm` 成功，并绑定为 `github-hosted/Linux/ARM64/aarch64`。该 gate 校验
  immutable CI input、Rust 1.97.1 Cargo/rustc 的准确 commit 与 host、唯一 `wasm32v1-none` target、pure-Rust
  canonical sysroot digest、确定性双构建/准确 replay，以及真实 build 进入唯一 Composer 与 `ProgramHostV2`
  consumer 路径；builder 在每次 build 前后重读准确 tool 与 canonical target sysroot。hosted job 成功不是
  R&D Owner 业务回执。当前不具备 kernel network confinement、持久化/已部署/Windmill readiness、Paper、
  Live、deployed runtime 或生产成熟度；下述有界 Backtest
  target-set 切片是当前唯一的成员级 fill routing、account/equity 与 price conversion 证据。
  ComplexStrategy V1 只提供迁移/等价性 baseline。R&D 还可以冻结
  一个已完整绑定且消费 Owner-sealed PIT 的 pre-Artifact Develop Evaluation。该 evaluation 只是一项
  R&D 内部事实，不是 Strategy Artifact、Exploratory Replay Request 或 Result、Qualification 证据、
  Candidate 或可部署程序。
- **CURRENT/DYNAMIC，隔离 Backtest 首个纵向切片：** 一个确定性 stateful corpus 从两个 pre-admitted
  bound field 出发，经 `StrategyDesignV2`、确定性 `StrategyPlanV2`、`StrategyArtifactV2`、
  `ProgramHostV2` 与共享内核驱动真实 `BacktestEngine`/Sim Exchange consumer。它证明原生 partial/full
  order fill、cache/position 转换、`ENTER -> ADD -> REDUCE -> EXIT`、保护 replace/adjust/clear、不中断执行
  与 checkpoint restore 后缀相等，以及重复运行相等。这只是一项隔离动态 Backtest 证明，不代表 Paper、
  Live、生产 Owner readiness 或交易授权。
- **CURRENT/PARTIAL，隔离 multi-leg/multi-timeframe input join：** 第三组不可变 corpus 把 Research 声明的
  四个准确 role（两个 AAPL 1 分钟 field、一个 MSFT 1 小时 field、一个 QQQ 1 天 field）绑定到各自的
  compile-time-sealed Market Data Owner receipt。通用 `ProgramHostV2` 与共享内核经普通类型化 plugin 路径
  消费完整 joined frame，保留 regime state，并且每个 trigger 只产生一份原子 target intent。真实
  `BacktestEngine`/Sim Exchange consumer 证明确定性 join ordering、`ENTER -> ADD -> REDUCE`、原生 submit/fill、
  重复运行相等和 checkpoint/restore 后缀相等。缺失、过期、来自未来、不匹配、跨 Design/role 或 lineage
  冲突的 input 都在 guest、plugin state、lifecycle state、target 或 checkpoint 变更前被拒绝。这只是并行的
  complex-strategy substrate 与隔离 Backtest acceptance；不是默认 R&D 路径、产品 readiness、Paper、Live、
  生产 Owner readiness 或交易授权。
- **CURRENT/DYNAMIC，有界准确双成员 Backtest target-set 纵向切片：** 一份完整 Owner-sealed universe
  frame 先在克隆的 `ProgramHostV2` 上 prepare，只产生一份规范 target set 与一次 plugin 调用；只有单份
  account-scoped `Portfolio::equity` 快照、两个准确 instrument fact、Decimal target conversion、成员
  reconciliation 与两份原生 order 全部校验成功后，才提交 host。该 equity 是 margin account 的 total balance
  加 unrealized PnL；venue account 缺失或不唯一、currency 多个或错误、任一 open position 无法定价时都会
  fail closed。支持范围仅限 linear、non-inverse、non-quanto，且 settlement
  与 quote currency 都等于正 equity currency 的 instrument。weight target 使用
  `trunc_toward_zero(equity * weight_micros / 1_000_000 / price / multiplier / size_increment)` 得到有符号 grid
  units；position target 本身已是有符号 grid units。两者都只能通过 adapter 封存的不透明 reconciliation
  capability；该 capability 绑定准确 prepared target-set、运行中 Host instance、account/equity snapshot、两份
  instrument fact 与 price、current position、公式及 derived target，crate peer 与 caller 都不能构造或修改其
  数值。随后以 grid units 乘 size increment 准确重建原生 quantity，
  且 instrument normalization 必须保持其不变。提交前的 host commit 与 order preflight 对整批原子；Sim
  Exchange submit 与 fill 按顺序发生，不具备 venue 原子性：后续 submit 失败会 fault 本次运行，并保留较早的
  原生 effect 与进程内 replay 证据。一个有界 test-only second-submit boundary fault 动态证明：Host commit 后
  第一份真实 submit 已成功且原生 cached order 被保留；这不代表 venue rollback 或 all-or-none submit。每个
  `ClientOrderId` 都绑定准确 instrument 与 host-derived intent；partial/
  full/canceled/rejected progress 只推进对应成员，保留独立 residual，并把该成员 protection quantity 同步到
  实际 filled quantity。真实 `BacktestEngine`/Sim Exchange acceptance corpus 使用不同 price、multiplier 与
  size grid，证明重复运行相等，以及不中断执行与同一运行中仅恢复不透明 Host checkpoint 的后缀相等。另一份
  real-Sim regression 使用 Owner-sealed 第一帧和 test-only admitted successor frame，先开仓并形成非零
  unrealized PnL，再证明下一 weight target 使用该 batch 的 account-scoped equity，而不是 cash balance；它
  不构成第二次 dynamic Owner issuance 证据。独立创建的等价 Host 或 restored Host 也会拒绝旧 prepared
  capability。它不证明 cold engine restart、venue atomicity、Paper、Live、provider/network、persistence、
  生产 readiness 或交易授权。
- **TARGET / NOT_ADMITTED：** Paper 与 Live 只有在各自 Owner adapter 存在且被另行接纳后，才消费
  相同 plan、Artifact、事件排序、checkpoint schema、内核和语义 trace 契约。本文不声称当前已有
  Paper 或 Live 等价性、应用、外部写入或交易能力。

`StrategyDesignV2` 是类型化、版本化、内容寻址的描述，覆盖 input role、join、parameter、feature、
state、生命周期反应、portfolio target、保护政策和可选 custom-plugin 调用。它只能使用稳定 primitive
semantic ID，不能使用 renderer label、enum ordinal、生成类名或 raw order。`StrategyPlanV2` 是确定性
编译结果，绑定准确 Design 与 Intent、已解析 Owner input receipt、Market Semantics Compatibility 身份、
capability closure、primitive 与 plugin ABI 版本、资源上限、lifecycle/checkpoint schema 及规范 lowering digest。

编译器只有一条 fail-closed pipeline：

1. **Canonicalization** 校验 schema、有限集合与依赖上限、unit、scale、声明顺序、semantic ID、state
   topology 和生命周期覆盖，再输出 byte-stable Design 含义。
1. **Capability closure** 传递闭合每个被引用 primitive、lifecycle hook 和 plugin capability；未声明、
   未版本化、重复或成环 capability 一律拒绝。
1. **Binding** 通过事实 Owner 的类型化 sealed receipt 解析每个 Research 声明的 input role。receipt 绑定
   role、field semantics、instrument/universe、timeframe、PIT/live cut、unit 与 Market Semantics
   Compatibility 身份。caller 与 compiler 都不能通过启发式字符串映射、alias、名称相似度或到达顺序
   推断 Owner、instrument 或 field。
1. **Lowering** 为 `ProgramHostV2` 生成唯一规范 `StrategyPlanV2` 和内容寻址 `StrategyArtifactV2` package。
   相同输入必须产生字节完全相同的 plan、Artifact 与 binding digest。

`InputJoinV2` version 1 只接纳一种 alignment semantic：
`strategy.input-join.latest-not-after-trigger.v1`。Research 必须声明非空且唯一的 join ID、至少两个唯一的
原始类型化 input-role ID、该准确集合中的一个显式 trigger role，以及大于零、有限且不超过 31 天的
`max_staleness_ns`。join-to-join edge（包括 cycle）、重复或未知 role、一个 role 被两个 join 共用，以及
fact class、scope、value type、unit 或 scale 不兼容都属于 `UNSUPPORTED`。每个 joined role 都是带显式
instrument 与 timeframe 的 exact-instrument Market Data Owner role；一个 reaction 要么消费完整规范 role
集合，要么完全不消费。接纳时 trigger 固定 joined event 的 lifecycle 与 logical time；每个 component 必须
具有相同 lifecycle、时间不晚于 trigger，并满足
`trigger_time - component_time <= max_staleness_ns`。Host 重建并校验每个 Owner-sealed 单 role envelope，
再按规范 lifecycle order key 与 role identity 排序；caller 顺序没有权威。缺失、重复、过期、来自未来、
receipt/role/Plan 不匹配、跨 lineage version 回退、同 root 的冲突 version，或 component/event identity 冲突，
都会在 scratch execution 或任何 guest、state、target、checkpoint 变更前失败。join 是由唯一通用 Host 与
共享 lifecycle kernel 消费的规范 Plan 数据；它不会引入 feature opcode、第二 interpreter、heuristic
binding 或 raw-order 路径。

`StrategyArtifactV2` 是单个 package，其中包含规范 `StrategyPlanV2` bytes，并为 Plan 声明的每个 plugin
准确包含一个独立构建的 Wasm module。不同 plugin 声明不能共享 module。系统不会生成外层或根 strategy
Wasm module：通用 `ProgramHostV2` 解释 Plan graph、调用其 plugin module，再把得到的类型化值交给共享
生命周期内核；只有该内核拥有状态转换。这是唯一 V2 执行路径。V1 只保留为迁移与等价性 baseline，绝不
成为另一个 V2 runtime。

对于准确两个成员的纵向切片，selected instrument 只能来自实际由 Market Data Owner 封存的
`StrategyInputUniverseSelectionReceipt`，并由封闭、不可伪造的 sealed acceptance adapter 携带；两份各自有效的 singular input-binding receipt 绝不构成共享 universe
权威。该 adapter 还携带每个已声明 role/member 的准确 Owner binding identity，包括 Research request、
Strategy Design、role 与 binding digest。编译必须验证这些 identity 与规范 Design 一致；host 还必须验证每个
admitted frame value 的 role coordinate 与 binding digest 都等于 Plan 投影，因此不能仅凭相同 selection 与
role name 拼接另一份 Design 的 frame。Plan 把该 receipt 的 selection identity/digest、规范排序的 member-key/instrument 对、Instrument Master
digest、Source Binding lineage root、Market Semantics identity 与 receipt digest 投影进规范 lowering。Design
role 显式区分兼容的 exact-instrument scope 与 universe-member scope；默认 exact-instrument scope 在 schema-2
规范 JSON 中保持省略，因此 Origin Design/role identity 不漂移。当前 universe 纵向切片只声明一次 OPEN
与 CLOSE，graph reference 只能选择 Owner 规范 member 顺序中的 ordinal；role 与 guest 都不能提供 instrument
或 selection identity。每个 BAR 或 EVENT reaction 都必须消费一份实际 Owner-sealed
`StrategyInputUniverseFrameReceipt`：其 selection 必须与
Plan 投影完全一致，规范 values 必须准确覆盖每个 required role/member 坐标以及两个不同规范 instrument。
singular event frame 的 vector 不是 universe frame。每个 BAR/EVENT graph 必须准确包含一个 compute/target-producing
node，因此准确一次 plugin 调用返回
固定大小、按 instrument key 排序的规范 target set。member 缺失、重复、未知、乱序、越界、混合或非规范
时，host 必须在任一成员内核、plugin/strategy state、target set、sequence 或 checkpoint 前进前拒绝整个
结果。host 在 guest output 外层封存 selection、admitted frame、capability、program/artifact、state 与每个
成员的 lifecycle identity；guest 与 caller 都不能选择这些权威。单一不透明组合 checkpoint 包含两个成员
内核、各自 pending target/protection、规范 target set、完整 host/plugin state 与组合 sequence，因此 restore
和准确 replay 会产生相同后缀。这是一个 `ProgramHostV2`，不是每个 instrument 一个 host。当前有界
Backtest adapter 只通过原生 `ClientOrderId -> {instrument, intent identity}` binding 提供成员坐标，并在上述
限制内消费进程内 Backtest account/instrument snapshot；它不接受 caller-selected fill coordinate 或 weight
reconciliation。只有 adapter 能封存不透明 reconciliation capability；`ProgramHostV2` 不接受 free-form
target-unit array，且只有 in-process instance token 与 checkpoint frontier 仍准确匹配时才提交 prepared value。
Execution/Paper/Live routing、外部 account truth、更广 currency conversion、inverse/quanto
instrument 与 cold-engine restore 仍不可用。

每次 plugin 调用都使用 fresh 或 reset 的 module instance。guest memory 与 guest state 均不得跨调用保留；
plugin state 是通过规范 frame 搬运的显式、有界、host-owned bytes。V2 plugin module 没有 import 或 start
function，不能执行 `memory.grow`，且必须准确导出以下六项，不能有额外 export：

- `memory`；
- `strategy_factory_plugin_input_ptr_v2() -> i32` 与
  `strategy_factory_plugin_input_capacity_v2() -> i32`；
- `strategy_factory_plugin_output_ptr_v2() -> i32` 与
  `strategy_factory_plugin_output_capacity_v2() -> i32`；
- `strategy_factory_plugin_invoke_v2(i32) -> i32`。

input 与 output codec 都使用规范 96-byte header。各字段按 byte 顺序为 magic（input 用 `SFPI`，output 用
`SFPO`）、codec `u16 = 2`、ABI `u16 = 2`、规范 manifest digest `[u8; 32]`、module identity `[u8; 32]`、
host-derived invocation identity `[u8; 16]`、value count `u16`、reserved-zero `u16` 与 body length `u32`。
body 按 manifest 顺序包含 entry：ordinal `u16`、type `u8`、零 flags `u8`、length `u32` 与 payload bytes；
plugin state 使用 ordinal `0xffff`。scalar 必须是 exact-width little-endian，bytes value 不得超过声明的
bound。unknown field 或 type、trailing bytes、错误顺序、重复或缺失 entry、非零 reserved/flags、width
mismatch 以及任何其他非规范编码都必须 fail closed。output 只能包含 manifest-typed value 与 post-state。
plugin 绝不能选择或返回 proposal identity、proposal order、order 或其他 effect。host 对按 Plan 顺序排列的
plugin state bytes 计算 domain-separated 聚合 plugin-state-set digest。

Research 拥有每个 input role 的声明及其实验含义；只有事实 Owner 能把该 role 绑定到可消费事实。按事实
类别固定 binding 权威：

| Input fact 类别                                                       | Binding 权威                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| hypothesis parameter、mechanism state 与 Research‑controlled constant | R&D                                                                                 |
| market、reference、instrument、universe 与 calendar fact              | Market Data                                                                         |
| order、fill、venue acceptance 与 execution readback fact              | Runtime 中为 Execution；仅在隔离 replay namespace 中可由 Backtest Sim Exchange 提供 |
| position、balance、exposure 与 account truth                          | Portfolio                                                                           |
| limit、decision、Reservation 与 permit                                | Risk                                                                                |

compiler 校验这些类型化 receipt；绝不能把一个 Owner 的权威转交另一个 Owner，也不能把 Backtest
simulation fact 当成 Runtime account、Execution 或 Risk truth。

对于 Market Data input，静态 `StrategyInputBindingReceipt` 是唯一 role/stream 权威。其与 role 无关的
`selection_identity` 绑定 field semantics、规范 instrument 或稳定 universe scope、channel、data kind、
timeframe、unit、scale、Source Binding lineage root、correction stream 与 Market Semantics identity；PIT
request、snapshot、batch、准确 frontier/version、time、sequence、row 与 value 均为可更新 event evidence，
不进入静态 digest。runtime 使用一个
Owner-sealed event frame，而不是让每个 field row 各自拥有 lifecycle identity。Market Data 只有在持有
verified multi-field observation batch，且所选 rows 共享 snapshot/fact/batch identity、event-effective
time、provider-available time、correction-publication time、非零 correction sequence 与 event class 时，
才能签发 trigger。同一个 reaction 共同消费的所有 role 还必须共享同一个 Source Binding lineage root、
correction stream 与 Market Semantics identity，作为 frame anchor；不同 reaction 可以使用不同 lineage
root。trigger 保留这些身份，并绑定排序后的 `(input-role identity, original binding
digest, selection identity, dynamic canonical-row digest)` 集合。确定性映射为 `BAR -> BAR`、
`QUOTE|TRADE|REFERENCE|ECONOMIC|SCALAR -> EVENT`；`logical_time` 为
`max(provider_available, correction_publication)`，`event_time` 为 `event_effective`，`owner_sequence` 为
correction sequence。`event_identity` 是对规范 domain `VIBE_STRATEGY_INPUT_EVENT_FRAME_V1` 与完整 frame
projection 做 BLAKE3 后的前 16 bytes。

frame 必须消费既有静态 receipt 并在当前 verified batch 中重新解析 row，且不再复制静态 receipt。
每份按 role 排序的 value receipt 均保留原 `StrategyInputBindingReceipt` digest 与 role identity，封存带
明确 fixed-value semantic 的准确 signed i128 little-endian bytes、scale 和 canonical-row digest，并交叉
绑定 trigger 与 observation-batch digest。Strategy Factory 私有 adapter 只校验一次 trigger，只对当前
reaction 实际引用的 Owner facts 按 Plan role/type 和 frame/as-of 进行校验，并直接从 sealed trigger 派生
SDK envelope 与 order key。聚合 admitted-event digest 只补充而不替代任何原始 Owner identity；不存在
public caller envelope/value constructor。compiler 必须拒绝没有已准入 trigger 与 fact contract 可执行的
reaction/input 组合。sealed Plan binding projection 保留 Owner 的准确 `data_kind`：`BAR` fact 只能由
`BAR` reaction 引用，`QUOTE|TRADE|REFERENCE|ECONOMIC|SCALAR` fact 只能由 `EVENT` reaction 引用。
Market Data 只能签发 `BAR` 与 `EVENT`；Time/Scheduler 是未来唯一的 `TIMER`
trigger Owner，Execution 是未来唯一的 `FILL` trigger Owner，而在真实 Owner contract 存在前，两者的
positive admission 均不可用。

只有共享生命周期内核能排序并应用 `START` `BAR` `EVENT` `FILL` `TIMER` `STOP`。每个输入先规范化
为版本化 envelope，其 total-order tuple 依次为 logical/event time、按上述声明顺序固定的 lifecycle-kind
precedence、Owner sequence 和最终 stable event identity。准确 identity replay 必须按字节等价 join；相同
identity 字节冲突或缺失任一排序坐标都必须 fail closed。host 计算 `envelope_digest` 的方法是：对 domain
`strategy.lifecycle.envelope.v1\0` 与规范 128-byte envelope 拼接后取 SHA-256；计算时 envelope 的 bytes
`56..88` 必须归零。host 计算 `proposal_digest` 的方法是：对 domain
`strategy.lifecycle.proposal.v1\0` 与规范 224-byte、已完全 host-sealed 的 proposal 拼接后取 SHA-256；
计算时 proposal 的 bytes `32..64` 必须归零。caller 提供的非零 digest 绝不足以成为任一身份的权威。
版本化 checkpoint 绑定 Design、Plan、Artifact、`ProgramHostV2`、kernel、plugin 与 Market Semantics 身份，
最后消费的 order key，strategy/plugin state，
target/protection state，以及 order/fill reconciliation frontier。它还绑定按 Source Binding lineage root
确定性排序的 version frontier：version 只在同一个 lineage root 内可比较；同 root 降级必须在 guest 或
state mutation 前失败；另一 root 的较低 version 不构成降级。重启只能从完全匹配且不透明的
`ProgramCheckpointBundleV2` 恢复，并产生相同后续 semantic trace。其规范 bytes 与 digest 仍可作为
content-addressing evidence，但 caller 持有的 bytes 即使重新计算 digest 也不构成 restore authority；Host
必须在 decode 前校验 bundle 私有保存的 digest。

admission 与 evaluation 是一个 failure-atomic boundary。host 必须在任何 guest 调用前完成 admission 或
exact-replay join，然后 clone 完整 host 与 kernel state；只有 `BAR`、`EVENT` 或 `TIMER` 才 evaluation
plugin。host 必须校验所有 plugin result、post-state 与完全 host-sealed 的 proposal，把 proposal 应用到
cloned kernel，并证明规范 checkpoint encode/decode roundtrip，最后才执行一次 whole-bundle swap。
`START`、`FILL` 与 `STOP` 只由 kernel 处理，绝不调用 guest。任何 fault 都必须让 checkpoint、已消费
order、host/plugin/kernel state、digest 与 semantic trace 保持 byte-identically unchanged，并产生零
semantic effect 或 external effect。

只有内核拥有下列稳定语义 primitive 及其状态转换，Design 与 plugin 均不拥有：

- `ENTER` `ADD` `REDUCE` `EXIT` 与 `HOLD` position intent，对应 `kernel.position.enter.v1`、
  `kernel.position.add.v1`、`kernel.position.reduce.v1`、`kernel.position.exit.v1` 与
  `kernel.position.hold.v1`；
- target position、target weight 与 target rebalance，对应 `kernel.target.position.v1`、
  `kernel.target.weight.v1` 与 `kernel.target.rebalance.v1`；
- stop-loss、take-profit 与 trailing-protection adjustment，对应 `kernel.protection.stop-loss.v1`、
  `kernel.protection.take-profit.v1` 与 `kernel.protection.trailing-adjust.v1`；
- fill reconciliation 对应 `kernel.fill.reconcile.v1`，包括 partial fill、rejection、cancellation 和乱序
  readback。

每个 primitive 都有跨 Backtest 与 Runtime 含义稳定的版本化 semantic ID。内核把 target 与 protection
转换为 semantic intent record；在 Runtime 中，Risk 仍是最终准入权威，Execution 仍是 order/fill/effect
权威，Portfolio 仍是 position/account truth。R&D、Backtest、compiler 与 plugin 都不能绕过这些 Owner。

Custom plugin 是唯一有界逃生口。它是作用于 allowlisted、版本化输入记录与有界私有 state 的纯类型
函数，只能返回 allowlisted typed value 或 state proposal。manifest 固定 ABI 与 semantic ID、input/output/
state schema 与 byte limit、fuel、linear memory、invocation count 和确定性失败行为。它没有 Owner 读写、
network、filesystem、clock、randomness、subprocess、secret、account、raw-order、Risk-permit、
Execution-adapter、deployment 或 external-effect 权威。plugin 不能新增 core opcode 或返回 order；plan 只能
把其有界输出交给 kernel-owned primitive。资源耗尽或畸形 plugin 以结构化 unsupported 结果终止，并且
该事件产生零策略 effect。

编译只有两个非正向语义终态。`UNSUPPORTED` 指出准确 schema coordinate、缺失或版本不匹配的 primitive/
capability、plugin/resource bound、Owner binding 或 runtime profile，且不生成 Plan 或 Artifact。
`NEEDS_RESEARCH_REFINEMENT` 指出 Research 必须在后继 Design 冻结的含糊或未充分指定 mechanism、input
role、timeframe、state transition、target、protection rule 或 falsifier，同样不生成 Plan 或 Artifact。
两者都不能启用猜测 binding、生成 fallback code、toy renderer 或 partial executable。

ComplexStrategy V1 的 canonicalization、bounds、frozen-Intent 校验和准确 Owner binding 是迁移输入，不是
第二门永久语言。它们必须被吸收到 V2 compiler，并通过唯一 `StrategyArtifactV2`/`ProgramHostV2` 路径
lowering。
冻结等价 corpus 证明 byte-identical semantic trace 与规范 Backtest result 后，必须删除重复 V1
interpreter 与 toy renderer。禁止第三个 runtime、sidecar interpreter、生成的无限制策略代码路径或
feature-specific core opcode。

验收使用三组版本化不可变 corpus；每组都包含正向、unsupported、畸形 binding、资源耗尽和
checkpoint/restart 案例：

1. **Stateful trend：** entry、pyramiding、partial fill、stop-loss/take-profit 与 trailing-stop adjustment、
   timer action、reduction 和 exit。
1. **Cross-sectional rebalance：** 类型化 universe role、ranking、target weight、rebalance cadence、partial
   fill 和确定性 residual reconciliation。
1. **Multi-leg、multi-timeframe regime：** 准确 leg 与 timeframe role、joined event ordering、regime state、
   atomic target intent，以及 leg input 缺失或过期时 fail closed。

每组已接纳 corpus 的重复 Backtest 必须产生 byte-identical Design/Plan/Artifact 身份、ordered semantic
trace、checkpoint、fill、position、cost 和规范 result。未来获准的 Paper 或 Live Runtime 对同一
normalized event prefix 必须在 Risk/Execution adapter boundary 之前产生相同 semantic trace。任何 divergence、
heuristic binding、把 unsupported feature 提升为 opcode、plugin raw-order attempt 或保留重复 interpreter
都导致验收失败。

## 保护路径

Research 在提交前冻结 TrialFamily 穷尽 Census Frontier 跨 TrialFamily 前驱前沿 预提交独立性依据 PIT 规则 成本 容量假设 预算 证伪条件和停止规则。Qualification 校验这些 frontier 预注册内容 准确 `READY_FOR_SELECTION` 决定和仅选择 disposition，并拥有相关 TrialFamily 的累计 holdout 预留与处理，再请求保护重放。仅选择 disposition 缺失 证伪条件不匹配 遗漏同族试验 试验改名 预算不符 frontier 可变 祖先未解析 独立性依据过晚 反馈前沿过期或截面后新增族成员时都在保护回放前闭合为 `NOT_ADMITTED` 且不消耗 holdout；Research 终态停止永不进入 intake，后续试验需要后继 Candidate。保护结果可以更新 Eligibility State，但绝不能反馈同一研发循环。

## 权威边界

R&D 拥有 Intent TrialFamily Artifact Exploratory Replay Request 和 Candidate 身份。Develop 是 R&D 内部能力，不是第二 Owner。Backtest 拥有重放结果且不能替 R&D 选择下一动作，Qualification 拥有 intake 状态 holdout 状态 资格和撤销。Strategy Factory 不拥有这些事实，也没有独立存储权威。

## 实现验收

每次交接都保留不可变身份 请求关联 保护反馈祖先和实际消费输入回执。R&D basis 创建必须早于任何 Qualification 保护反馈写入。Qualification 投影绑定准确 basis ref/digest principal request scope source sequence/cut clock epoch 与半开有效期；过期 畸形 不匹配或不可用权威都不能创建 S1 转换。每个探索结果都关联一个稳定且由 R&D 拥有的请求身份，不匹配时运行前失败。Candidate intake 必须证明准确 `READY_FOR_SELECTION` 决定与 `SELECTED_FOR_QUALIFICATION` disposition 交叉绑定冻结证伪条件与探索前沿，TrialFamily frontier 在截面前不可变且穷尽，并证明累计 holdout 处理不会被 TrialFamily 改名重置。终态停止不创建 Selection 不能为 `ADMITTED` 且不消耗 holdout。任何保护结果都不能改写 R&D 输入 参数或被评估的 Artifact。

首次 S1 写入前，R&D 必须持有规范 Operator Authorization、Product Edge、本地 lineage 与 Qualification 锁，完成最后一次 Qualification 回读，然后才在第一笔写入前立即采样唯一 final cut。所有结果身份与回执都绑定同一 cut，authorization、binding、manifest 与 Qualification 的半开有效区间必须在该 cut 同时仍为 current。cut 等于任一 `valid_through` 即为 stale，并且 R&D receipt、Intent、TrialFamily、census 与 outbox 全部零写入。

在该终态写入之前，已提交的 Independence Basis 阶段即为持久下游 custody：它密封完整规范 R&D 请求含义、语义摘要、Product Edge admission locator 与历史 lineage、basis 回执及 outbox。准确 `RESOLVE` 只能使用这份经验证的密封含义恢复历史完成路径，且不得创建第二份 basis、head 或 outbox；含义变化、admission 变化、仅有裸行、custody 畸形或缺失都必须 fail closed。R&D 终态回执提交后，后续 authorization 或 view 过期仍保留准确回执、Intent、TrialFamily、basis 与历史 Qualification 投影，并以 `STALE` 只读结果返回；唯一动作是同请求解析，不授予新提交、后继或 provider effect。
