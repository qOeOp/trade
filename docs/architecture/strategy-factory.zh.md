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
  compile-time-sealed Market Data Owner receipt。Market Data 在完整已验证 PIT/correction census 上执行
  latest-not-after argmax，并签发一份不透明 `StrategyInputJoinedCutReceiptV1`；Host 不再具有 frame-slice
  selection 路径。通用 `ProgramHostV2` 与共享内核经普通类型化 plugin 路径消费该完整 joined cut，保留
  regime state，并且每个 trigger 只产生一份原子 target intent。真实
  `BacktestEngine`/Sim Exchange consumer 证明确定性 join ordering、`ENTER -> ADD -> REDUCE`、原生 submit/fill、
  重复运行相等和 checkpoint/restore 后缀相等。缺失、过期、来自未来、不匹配、跨 Design/role 或 lineage
  冲突的 input 都在 guest、plugin state、lifecycle state、target 或 checkpoint 变更前被拒绝。这只是并行的
  complex-strategy substrate 与隔离 Backtest acceptance；不是默认 R&D 路径、产品 readiness、Paper、Live、
  生产 Owner readiness 或交易授权。**CURRENT/PARTIAL，仅 Native Replay preparation：** preparation seam
  现在还必须接收准确 Owner-sealed V1 joined-cut receipt 与 move-only V2 JOINED_CUT projection readback。
  在构造 ProgramHost handoff 前，它校验 EVENT lifecycle、准确 joined-cut subject digest、正且完整的
  component count，以及 projection role/binding set 与已编译 Plan 的严格相等。handoff 保留准确 projection
  digest/count，并在 promote 前重新校验绑定。这只是 fail-closed preparation 与 public consumer-shape
  evidence；它不执行 Native Replay，不启动 production resolver，不证明 dynamic PostgreSQL product
  composition 或 end-to-end Windmill acceptance，也不准入 trading。
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
- **TARGET / NOT_ADMITTED - ARC Complex D Bounded Feature Program V1：** frozen Research 可提供下文定义的
  有界类型化 feature/state program。Strategy Factory 使用 first-party source 对该规范 program 做确定性
  lowering，生成一个现有 bounded plugin，随后只经过 `PluginManifestV2`、`StrategyPlanV2`、
  `StrategyArtifactV2`、`ProgramHostV2` 与共享生命周期内核。仓库当前没有 executable
  `BoundedFeatureProgramV1`、V3 producer 或持久 V3 readback。本契约不声称 executable D-loop、Native Replay、
  Windmill acceptance、稳定盈利、Paper、Live、production 或 trading authority。

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

### TARGET - ARC Complex D Bounded Feature Program V1

`BoundedFeatureProgramV1`（BFP V1）是唯一接纳的通用 Complex D 表示。R&D/Develop 将其规范含义与 Research
Intent、`StrategyDesignV2` 一同冻结；Strategy Factory 负责验证与 lowering，但不能发明 Research 含义。
它唯一的前向路径是：

`Frozen Research -> canonical BoundedFeatureProgramV1 typed DAG -> deterministic first-party source lowering ->`
`versioned V3 build capsule/receipt -> existing PluginManifestV2/Composer/StrategyArtifactV2 ->`
`existing ProgramHostV2 -> shared lifecycle kernel -> Backtest`。

BFP 是 Design 所声明准确一个 bounded plugin 的 build input，不是 Host graph extension、Host feature opcode、
interpreter、runtime、strategy template、raw-order program 或新 Owner。LLM 或 caller 可以提出 Research 含义，
但不能创作 Rust、Wasm、dependency、ABI、公式实现、build command、clock、Owner receipt 或 executable
fallback。只有冻结的规范 BFP 能进入 first-party lowerer。lowerer 必须确定且 dependency-closed，只能从已 pin
SDK 与 primitive-kernel catalog 组装 source；不得接纳 caller source、package、build script、带 ambient input 的
macro、network、filesystem input、randomness、floating point 或未声明 import/export。尤其是 BFP 含义、
lowering、plugin state、wire value 和 acceptance 中任何 `f32` 或 `f64` value/operation 都不合法。

规范 BFP schema 必须绑定下列全部内容，并拒绝 unknown field 与 unknown semantic ID：

- schema 与 semantic version；准确 Research request、Research Intent、`StrategyDesignV2`、plugin semantic ID
  和规范 `PluginManifestV2` digest；
- 每个 input 的 Owner、fact type、role identity、timeframe、signed fixed-I128 unit 与 decimal scale、静态
  binding receipt digest，以及声明的 trigger 或 sample clock；
- primitive-catalog semantic version 与 content digest、first-party SDK/source digest、lifecycle-output
  semantic ID，以及按规范拓扑顺序排列的完整 typed DAG；
- node、edge、depth、port、constant、lag/rolling window、state cell/byte、source byte、Wasm byte、fuel、
  linear memory 与每 event invocation 的有限上限；
- 覆盖上述所有字段、全部 constant 与 frozen rounding mode 的 domain-separated 规范 bytes 与 digest。

node ID 与 port ID 都是唯一稳定 string；edge 只能引用更早的 typed output；每个 output 都必须被消费或声明为
terminal，每个 fan-out 都必须显式且有界，state 只有一个 writer 且声明初值。unreachable node、cycle、forward reference、duplicate
ID、implicit cast、implicit rescale、unit mismatch、unbounded window 或与 manifest 不一致的 bound 都在 source
generation 前成为 `UNSUPPORTED`。规范排序只使用 schema 定义的 byte key，不使用 source order、map
iteration、locale、platform、enum ordinal 或 caller-provided digest。对规范 bytes 再 canonicalize 必须字节一致。

首个 primitive catalog 必须版本化并由 `vibe-indicators-kernel` 拥有。Strategy Factory 只引用每个 primitive
的 semantic ID 与已 pin catalog/source digest，不得复制、重新解释或独立实现公式。首个 catalog 至少包括：

- checked fixed-I128 add、subtract、multiply、divide、显式 rescale、compare 与 select，全部绑定 frozen
  rounding 与 overflow terminal；
- lag 与 rolling sum、mean、minimum、maximum；
- EMA、Wilder smoothing、true range、ATR 与 RSI；
- candle body、range、upper/lower wick 与 gap geometry；
- rolling swing high 与 low；
- `range_fraction(low, high, numerator, denominator)`：ratio 是冻结且约分后的 rational，denominator 为正，
  bounds 与 scale 显式，Fibonacci level 只能使用冻结的有理常量。

price-action rule 与 candlestick pattern 是这些 catalog primitive 的类型化组合，不是命名 strategy template、
opaque label、复制的公式或新 Host opcode。

#### 数值、指标与 availability 语义

BFP V1 fixed decimal 是带 `0..=38` base-10 scale 的 signed I128 coefficient；其数学值为
`coefficient * 10^-scale`。scale 是每个 port 与 state type 的组成部分。node 不得推断、对齐或静默改变
scale。add、subtract、compare、select 与 OHLC geometry 要求 input scale 相等；其他 scale 变化都必须是显式
rescale 或 node-declared output scale。唯一接纳的 rounding mode 是 `TowardZero` 与
`NearestTiesToEven`。每次 arithmetic/indicator update 都把所有十进制幂和 rational factor 纳入一个准确 signed
two's-complement I256 expression，然后只做一次最终 division/rounding，得到声明 output scale。intermediate
超过 I128 但能装入 I256 且舍入后能装入 I128 时合法。I256 overflow、divide by zero、invalid scale、在未声明
rounding mode 时丢弃非零 remainder，或最终 I128 overflow（包括 I128 `MIN / -1`）都返回命名终态
`NUMERIC_FAILURE_NO_STATE_CHANGE`。

`NUMERIC_FAILURE_NO_STATE_CHANGE` 是 failure-atomic：input admission 可以被记录，但 primitive state、warm-up
counter、已存 sample coordinate、plugin/BFP/kernel state、lifecycle output、target/protection、semantic trace 与
checkpoint bytes 必须和 event 前逐字节相同。执行前发现的 validation failure 仍是 `UNSUPPORTED`，且不生成
Artifact。合法 warm-up event 不是 numeric failure：它推进已声明 state，并暴露没有可读 value 的类型化
`WARMING` availability。下游 node 不能读取 `WARMING` value；warm-up 期间的 lifecycle output 必须由 Design
把 availability 显式 wiring 到现有 `HOLD` semantic。

以下 V1 定义为规范语义：

- `lag(offset)` 要求 `offset` 属于 `1..=declared_max_lag`，返回当前 coordinate 之前准确 `offset` 次 advance 的
  value 与 Owner sample coordinate，并首次成为 `READY` 于 sample `offset + 1`。
- rolling sum、mean、minimum、maximum 与 rolling swing 要求正 window。它们保持 `WARMING`，直到准确
  `window` 个不同 update-clock sample 已接纳；此时状态为 `READY`，对应 sample `window`。mean 使用一次
  I256 sum 除以 `window`，按 node rounding mode 只舍入一次；V1 不接纳 partial-window result。
- period `p > 0` 的 EMA 在首个 sample 即 `READY` 并以该准确 sample 为 seed；之后把
  `previous + (2 / (p + 1)) * (sample - previous)` 作为一个 wide expression，只做一次最终舍入。
- period `p > 0` 的 Wilder smoothing 在首个 sample 即 `READY` 并以该准确 sample 为 seed；之后把
  `previous + (1 / p) * (sample - previous)` 作为一个 wide expression，只做一次最终舍入。
- true range 先校验 OHLC。首个 sample 为 `high - low`；之后为
  `max(high - low, abs(high - previous_close), abs(low - previous_close))`。ATR V1 只能是该 true-range series
  经过前述 first-sample-seeded Wilder update 的结果；configurable SMA ATR 不属于 V1。
- period `p > 0` 的 RSI 先保存 previous close，再准确累计 `p` 个 delta 的 gain/loss。它的首次 `READY` output
  是 sample `p + 1`，使用这 `p` 个 gain 与这 `p` 个 loss 的 arithmetic mean；后续 average gain/loss 使用前述 Wilder
  update。output 是 node-declared scale 上 `[0, 100]` 的 dimensionless value。average gain/loss 同时为零时准确
  为 `50`；gain 为正且 loss 为零时准确为 `100`；gain 为零且 loss 为正时准确为 `0`；其他情况按
  `100 * gain / (gain + loss)` 只做一次最终舍入。
- candle body 为 `abs(close - open)`，range 为 `high - low`，upper wick 为
  `high - max(open, close)`，lower wick 为 `min(open, close) - low`，gap 是 signed
  `open - previous_close`。只有 gap 在首个 sample 为 `WARMING`。scale mismatch 或违反
  `low <= min(open, close) <= max(open, close) <= high` 时，必须在任何 geometry 或 previous-close state 推进前
  返回 no-state-change terminal。
- rolling swing high 是声明完整 trailing window 内的 maximum high，rolling swing low 是 minimum low。每个
  output 同时包含获胜 value 与其完整 Owner sample coordinate；extremum 相等时选择 Owner order 中最新的
  coordinate。它是 trailing-window extremum，不是 future-looking confirmed pivot。
- `range_fraction(low, high, numerator, denominator)` 要求 low/high scale 相等、`low <= high`、rational 已
  约分、numerator/denominator 编码为规范 unsigned 32-bit、denominator 为正且
  `0 <= numerator <= denominator`。它把
  `low + (high - low) * numerator / denominator` 作为一个 I256 expression，在声明 output scale 只做一次
  最终舍入。闭区间之外的 ratio 在 V1 中 unavailable，不得 clamp 或 extension。

warm-up count、period/window/lag value、ring index 与 add count 是规范 unsigned 32-bit field；Owner sequence
是规范 unsigned 64-bit field；numeric coefficient 是规范 signed 128-bit field；scale 与 rounding tag 是规范
unsigned 8-bit field；保存的 Owner coordinate 使用 `StrategyInputSampleCoordinateV1` 的准确 fixed-width
canonical field。所有 integer 在规范 state bytes 中使用 little-endian。Rust layout、`usize`、pointer width、
platform alignment、map order 与 JSON number parsing 均无 authority。

primitive catalog 原子发布整个 family。下列清单是封闭的 V1 namespace：

- Numeric policy：`bfp.numeric.fixed-i128.max-scale-38.explicit-rescale.i256-single-round.v1`、
  `bfp.round.toward-zero.v1`、`bfp.round.nearest-ties-to-even.v1` 与
  `bfp.numeric.failure.no-state-change.v1`。
- Add：`bfp.fixed-i128.add.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1` 与
  `bfp.fixed-i128.add.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1`。
- Subtract：`bfp.fixed-i128.sub.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1` 与
  `bfp.fixed-i128.sub.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1`。
- Multiply：`bfp.fixed-i128.mul.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1` 与
  `bfp.fixed-i128.mul.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1`。
- Divide：`bfp.fixed-i128.div.max-scale-38.explicit-rescale.i256-single-round.toward-zero.v1` 与
  `bfp.fixed-i128.div.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1`。
- Rescale：`bfp.fixed-i128.rescale.max-scale-38.i256-single-round.toward-zero.v1` 与
  `bfp.fixed-i128.rescale.max-scale-38.i256-single-round.nearest-ties-to-even.v1`。
- Compare/select：`bfp.fixed-i128.compare.equal-scale.v1` 与 `bfp.fixed-i128.select.equal-scale.v1`。
- Availability/state：`bfp.availability.warming-ready.v1`、`bfp.state.post.fixed-canonical.v1` 与
  `bfp.lag.coordinate.offset.full-history.v1`。
- Rolling：`bfp.rolling.sum.full-window.v1`、`bfp.rolling.mean.full-window.toward-zero.v1`、
  `bfp.rolling.mean.full-window.nearest-ties-to-even.v1`、`bfp.rolling.min.full-window.v1` 与
  `bfp.rolling.max.full-window.v1`。
- EMA：`bfp.ema.first-sample.alpha-2-over-period-plus-1.toward-zero.v1` 与
  `bfp.ema.first-sample.alpha-2-over-period-plus-1.nearest-ties-to-even.v1`。
- Wilder：`bfp.wilder.first-sample.alpha-1-over-period.toward-zero.v1` 与
  `bfp.wilder.first-sample.alpha-1-over-period.nearest-ties-to-even.v1`。
- TR/ATR：`bfp.true-range.ohlc.first-high-low.v1`、
  `bfp.atr.true-range.wilder-first-sample.toward-zero.v1` 与
  `bfp.atr.true-range.wilder-first-sample.nearest-ties-to-even.v1`。
- RSI：`bfp.rsi.period-deltas.wilder.flat-50.toward-zero.v1` 与
  `bfp.rsi.period-deltas.wilder.flat-50.nearest-ties-to-even.v1`。
- Candle：`bfp.candle.body-magnitude.ohlc-validated.v1`、`bfp.candle.range.ohlc-validated.v1`、
  `bfp.candle.upper-wick.ohlc-validated.v1`、`bfp.candle.lower-wick.ohlc-validated.v1` 与
  `bfp.candle.gap-signed.previous-close.ohlc-validated.v1`。
- Swing：`bfp.swing-high.trailing-full-window.latest-coordinate-tie.v1` 与
  `bfp.swing-low.trailing-full-window.latest-coordinate-tie.v1`。
- Range fraction：`bfp.range-fraction.closed-unit-rational.toward-zero.v1` 与
  `bfp.range-fraction.closed-unit-rational.nearest-ties-to-even.v1`。
- Kernel output reference：`kernel.position.enter.v1`、`kernel.position.add.v1`、
  `kernel.position.reduce.v1`、`kernel.position.exit.v1`、`kernel.position.hold.v1`、
  `kernel.target.position.v1`、`kernel.target.weight.v1`、`kernel.target.rebalance.v1`、
  `kernel.protection.stop-loss.v1`、`kernel.protection.take-profit.v1` 与
  `kernel.protection.trailing-adjust.v1`。

其他 primitive、alias、optional subset 或 extension 都不属于 catalog V1。每一行都在规范 catalog bytes 中
绑定其准确 formula、type/unit/scale contract、适用的 rounding ID、availability/update-clock rule、state
encoding 与 required golden-vector identity。缺失或增加任一行、formula、semantic ID、golden vector 或
failure oracle 都使整个 V1 catalog digest unavailable；Strategy Factory 必须拒绝 BFP，不能发布或替换为
partial toy catalog。

每个 golden 都是规范 `BoundedFeatureGoldenVectorV1` binary bytes：magic `BFGV` `[u8; 4]`、schema
`u16 = 1`、reserved-zero `u16`、ASCII vector semantic ID 与 primitive semantic ID（各自编码为
`u16 length || bytes`）、rounding tag `u8`（`0 = none`、`1 = TowardZero`、
`2 = NearestTiesToEven`）、terminal tag `u8`（`0 = READY`、`1 = WARMING`、
`2 = NUMERIC_FAILURE_NO_STATE_CHANGE`、`3 = UNSUPPORTED`），随后依次为 pre-state、规范 input frame、
expected output 与 post-state 四个 `u32 length || bytes` field。integer 使用 little-endian，string 必须为
non-empty ASCII，reserved byte 与 trailing byte 被禁止，重新编码必须逐字节相同。vector identity 是
`bfp.golden-vector.v1\0 || canonical bytes` 的 SHA-256。catalog 按 vector semantic-ID bytes 排序完整 vector，
拒绝 duplicate，并把各 vector 的 `u32 length || canonical bytes` 拼接后纳入自身 digest。

对于上述 Add 至 Range fraction 各 family 的每个 executable primitive ID，V1 准确要求一个
`bfp.golden.primitive.<primitive-id-without-bfp-prefix>.success.v1` vector；semantic ID 已经冻结 rounding
选择，规范 node argument 与 expected readiness 则位于 vector bytes 中。Numeric policy ID 与 kernel-output
reference ID 不 mint primitive success vector。额外的封闭 cross-cutting vector-ID set 是这里明确命名的
Cartesian product：rounding mode token `toward-zero|nearest-ties-to-even`、sign token
`positive|negative` 与 quotient token `even|odd`，套入
`bfp.golden.round.<rounding>.<sign>.<quotient>-half.v1`；frontier token
`before-ready|first-ready` 与每个 family token
`lag-offset-2|rolling-sum-window-3|rolling-mean-window-3|rolling-min-window-3|rolling-max-window-3|swing-high-window-3|swing-low-window-3|rsi-period-3`，
套入 `bfp.golden.warm-up.<family>.<frontier>.v1`；以及 literal ID
`bfp.golden.ema-period-3.first-ready.v1`、`bfp.golden.wilder-period-3.first-ready.v1`、
`bfp.golden.atr-period-3.first-ready.v1`、`bfp.golden.gap.before-ready.v1`、
`bfp.golden.gap.first-ready.v1`、`bfp.golden.rsi.flat-50.v1`、
`bfp.golden.rsi.zero-loss-100.v1`、`bfp.golden.rsi.zero-gain-0.v1`、
`bfp.golden.true-range.first.v1`、`bfp.golden.true-range.previous-close.v1`、
`bfp.golden.numeric.i256-overflow.state-byte-identity.v1`、
`bfp.golden.numeric.divide-by-zero.state-byte-identity.v1`、
`bfp.golden.numeric.invalid-scale.state-byte-identity.v1`、
`bfp.golden.numeric.remainder-without-rounding.state-byte-identity.v1`、
`bfp.golden.numeric.final-i128-overflow.state-byte-identity.v1`、
`bfp.golden.numeric.min-div-negative-one.state-byte-identity.v1`、
`bfp.golden.numeric.scale-mismatch.state-byte-identity.v1`、
`bfp.golden.ohlc.ordering-violation.state-byte-identity.v1`、
`bfp.golden.swing-high.latest-coordinate-tie.v1`、
`bfp.golden.swing-low.latest-coordinate-tie.v1`、`bfp.golden.sample.same-no-advance.v1`、
`bfp.golden.sample.equal-value-new-advance.v1`、`bfp.golden.numeric.wide-fit-after-scale.v1`、
`bfp.golden.range-fraction.denominator-zero.v1`、
`bfp.golden.range-fraction.non-reduced-rational.v1`、`bfp.golden.range-fraction.above-one.v1` 与
`bfp.golden.range-fraction.low-above-high.v1`。发布时有限 token set 展开成 literal ID；brace、token 或
generator text 都不进入 catalog bytes。这些 literal state-byte-identity ID 穷尽 primitive numeric 与 OHLC
failure golden。coordinate/receipt、ABI、build 与 resource rejection 位于 primitive evaluation 之外，是下文
required corpus oracle，而不是额外 catalog golden。

每个 stateful primitive 准确声明一个 update coordinate：reaction trigger clock，或一个命名 input 的 sample
clock。BFP 还声明有界的 holding status、add count、high-water mark、protection state 等策略 state，并且只能
生成 manifest-typed post-state、现有 `PositionIntentV1`、`TargetVariantV1`、`ProtectionVariantV1`、target 与
protection field。Host 校验这些 bytes、封存 proposal identity/order，再把 proposal 交给共享生命周期内核。
只有内核解释 `ENTER`、`ADD`、`REDUCE`、`EXIT`、`HOLD`、target position/weight、stop-loss、take-profit、
trailing protection 与 fill reconciliation。BFP/plugin 绝不能输出 order、`Action::Submit`、Risk permit、
Execution request 或 external effect。

#### Sample-coordinate 契约

数值相等不代表 sample identity。BFP V1 可以执行之前，Market Data 必须为每个已接纳 event 或 joined cut
component 提供 dependency-neutral、Owner-sealed `StrategyInputSampleCoordinateV1`。其 canonical bytes 按以下
顺序准确为 308 bytes：schema `u16 = 1`、reserved-zero `u16`、input role identity `[u8; 32]`、timeframe
identity `[u8; 32]`、Owner event identity `[u8; 16]`、sample identity `[u8; 32]`、logical time `u64`、
event-effective time `u64`、Owner sequence `u64`、static binding receipt digest `[u8; 32]`、dynamic
canonical-row digest `[u8; 32]`、Source Binding lineage root `[u8; 32]`、lineage version `u64`、Market
Semantics identity `[u8; 32]` 与 stable Owner sample-receipt digest `[u8; 32]`。integer 使用 little-endian；
reserved 或 trailing byte 被禁止。coordinate digest 是
`strategy.input.sample-coordinate.v1\0 || canonical bytes` 的 SHA-256。Market Data event/joined-cut receipt
cross-bind 该 digest；coordinate 不包含 enclosing trigger receipt，因此被后续 trigger 携带的同一个 component
sample 保持逐字节相同。此处的 `Owner event identity` 是 Market Data 定义的 role-independent native
sample-event identity，不是绑定 Design、role 与 static binding 的 V1 frame-trigger event identity。

这些保持不变的 308 bytes 的 Owner-native 来源是新增的 Market Data `SampleFactV1` 与 trigger-independent
`SampleReceiptV1` 合同。`TimeframeSpecV1` 在 `market-data.timeframe.identity.v1` 下把 kind/step/unit 与
anchor、calendar、session、time-zone、label、partial-bar identity/rule 一起绑定；`1d` 是
exchange-session day，绝不是 UTC-duration day。
`SampleFactV1` 绑定 series/slot 与 predecessor topology、source snapshot/fact/batch、instrument/channel/
data-kind/field meaning/timeframe、Owner event/sequence、logical time 以及四个 event-effective/provider-available/
retrieval/correction-publication clock、准确 value semantic/bytes/scale、canonical-row digest，以及
binding/lineage/frontier/master/universe/Market Semantics/correction evidence。
`fact_digest = SHA-256(market-data.sample-fact.v1\0 || fact_bytes)`，且
`sample_identity = SHA-256(market-data.sample.identity.v1\0 || fact_digest)`；两者不同于既有 BLAKE3 row
digest。

未改变的 V1 binding timeframe string 不授权该 identity。只有 Market Data 能提供以准确 V1
binding-receipt digest 为键的 immutable `TimeframeProjectionReceiptV1`，其中携带完整 spec bytes/identity
及其 Owner evidence identity。projection 缺失、冲突、不唯一或由 caller 解析时，都必须在 coordinate 构造
前失败；后续 calendar/mapping 改变不能修改 historical readback。

`SampleReceiptV1` 携带准确 role-independent Owner fact projection。其 domain-separated SHA-256 stable digest
提供既有 sample-receipt-digest 字段；fact identity 与 receipt digest 均不依赖 trigger、frame、join、
consumer、Design、role 或 static binding。新增 `StrategyInputFrameEvidenceIdentityV2` 在不改变 V1 的前提下，
以 additive 方式标识穷尽且有序的 V1 trigger/value evidence。`StrategyInputSampleProjectionReceiptV2` 是唯一
V2 frame/join envelope；其闭集 `FRAME|JOINED_CUT` kind、FRAME evidence identity 或准确 V1 JOINED_CUT
receipt digest 与按 role 严格排序的 fixed entry，把每份未改变的 V1
binding/frame-evidence/trigger/value receipt 与其 timeframe-projection receipt、native sample receipt 和准确
308-byte coordinate cross-bind。不存在独立 V2 event/value/frame/join codec。envelope 把 role-bound V1 trigger
identity 与 role-independent native event identity 分开。ProgramHostV2 与 Backtest 只能接收该准确 V2
projection 及其引用的原生历史 receipt，不能从 value、row digest、frame/event digest、
trigger time、latest head 或本地 timeframe 解释派生或修复任何一个。restart 必须为同一 identity 解析出
相同 native receipt bytes，并为同一 role/binding 解析出相同 coordinate bytes。

**CURRENT/PARTIAL：** 保留的 JOINED_CUT slice 已为 EVENT component 实现该 V2 结构 projection 与准确 digest
readback shape；Native Replay preparation 仅在同时持有准确 V1 joined-cut receipt 和完整 Plan binding set 时消费
它。这不会使未来 BFP coordinate port 可执行，也不证明 Native Replay run、production startup、durable product
composition 或 Backtest 闭合。

Market Data 为 sealed static binding 解析准确 historical timeframe-projection receipt，并从 verified census
中选择、封存 coordinate。R&D、Strategy Factory、Host caller、Backtest 与 plugin 都不能 mint、narrow、
hash-substitute 或 advance 它。对于一个 role，replay 只有在 308 bytes 全部相同时才能 join。同一
role/timeframe/sample identity 若对应不同 bytes 即为 conflict。新 sample 必须保持 static binding、timeframe、
lineage root 与 Market Semantics identity 不变，lineage version 不递减，sample identity 不同，并且
`(logical_time, event_time, owner_sequence, event_identity, sample_identity)` tuple 按 lexicographic order 严格
增大。cross-lineage coordinate 不可比较且 fail closed。state 是否推进由这些 equality/order rule 决定，而不
由 numeric value equality 决定。

TARGET Design/Plan seam 是版本化 source semantic
`strategy.value-ref.owner-sample-coordinate.v1(input_role_id)`。对于每个被 sample-clock node 使用的 BFP
role，lowerer 必须创建一个 manifest input port，其 literal semantic ID 是
`strategy.input.sample-coordinate.v1.<role_identity_hex>`，其中 `role_identity_hex` 准确为该 role
`[u8; 32]` identity 的 64 个 lowercase hex character。uppercase、非 64-length suffix 或与绑定 role 不等的
suffix 都是 noncanonical。该 port 的 type 为 `ValueTypeV2::Bytes`，准确 `max_bytes = 308`。BFP role input
port 按 `(role_identity_bytes, kind_tag)` 排序，其中 `kind_tag = 0` 是 role value port，`kind_tag = 1` 是其
coordinate port，因此每个存在的 coordinate 准确跟随自己的 value，而不依赖 source order。
`StrategyPlanV2` 绑定 role、完整 derived port ID、coordinate-source semantic ID、port ordinal、static
binding、coordinate codec/digest rule 与 update clock。不含这一 tagged source 的既有 Design 保持逐字节
相同的 V2 含义。

唯一通用 `ProgramHostV2` 扩展其既有 Owner-event evidence adapter，而不是扩展 graph opcode set 或 runtime，
以保留已经验证的 coordinate bytes 并解析该 Plan-bound metadata source。它拒绝未被已接纳 Market Data
receipt cross-bind 的 coordinate，随后把准确 308 Owner bytes 复制到普通 typed plugin input port。guest 不会
收到 caller coordinate，也不能请求另一个 role。这是唯一接纳的 transport；禁止从 I128 value、driver
envelope、trigger count、local hash 或 guest state 派生 coordinate。

trigger-clock node 对每个新接纳 trigger coordinate 推进一步。sample-clock node 只有在其命名 role 收到严格
新的 Owner-sealed sample coordinate 时才推进。同一 1-hour sample 被多个 1-minute trigger 携带时，必须复用
旧 sample-clock state 而不推进，即使其他 trigger value 改变；新封存的 1-hour sample 即使 OHLC 数值与前一个
完全相同，也必须准确推进一次。value comparison、caller time、trigger count、arrival order、narrowed R04 或
event hash、本地派生 timestamp 都不是合法替代。缺失、stale、duplicate-conflicting、cross-role、
cross-timeframe、cross-lineage、regressed-version、receipt-mismatched 或非规范 coordinate，都必须在 guest
调用或任何 BFP/plugin/lifecycle/target/protection/trace/checkpoint mutation 前失败。

已接纳 correction 是具有准确 series/correction predecessor 的 immutable successor sample。它创建新的
fact、receipt、identity 与 coordinate，并让 sample clock 准确推进一次；绝不 rewrite、追溯 replace 或
replay predecessor state。普通的等值 successor 也推进一次。单一 V2 projection receipt 交叉绑定准确
sample identity、native receipt digest 与 coordinate digest，同时保留所有 V1 byte
与含义。一个 sample 被后续 trigger 重复选择时保持逐字节相同，且不会再次推进。

该 TARGET 仍只达到 architecture-contract maturity。规范 acceptance 必须复用既有 disposable PostgreSQL
harness 和仓库权威 Makefile、pre-commit、CI wiring，以证明逐字段 mutation、idempotency/conflict 与
correction topology、response loss/restart/rollback/historical readback、tamper/cross-splice rejection、V1
preservation 与 Owner-only ACL。consumer oracle 覆盖同一 1-hour 与 exchange-session `1d` sample 在 1-minute
trigger 间重复、等值 successor、correction，以及 restart 后 byte-identical native receipt recovery。它不
证明 provider authenticity、production migration/deployment、Dashboard、Paper、Live、BFP executable
maturity 或 trading authority。

#### TARGET plugin failure-status 兼容

命名 numeric terminal 使用既有 manifest、wire 与 `ProgramHostV2` 的兼容版本化扩展，而不是 plugin output、
Host feature opcode 或第二 runtime。既有 ABI 2 manifest、frame bytes、receipt 与
`strategy.plugin.failure.unsupported.v1` handling 保持逐字节权威。BFP V1 plugin 改用
`PluginManifestV2.abi_version = 3` 与
`failure_semantic_id = bfp.numeric.failure.no-state-change.v1`；Plan、V3 build receipt、
`PluginImplementationReceiptV2`、module identity 与 Artifact 全部绑定这两个值。ABI 3 保留规范 port-entry
layout，frame header 使用 ABI `u16 = 3`，只改变 invocation status map：nonnegative 值是规范 output length，
`-1` 是 `NUMERIC_FAILURE_NO_STATE_CHANGE`，其他所有 negative 值都是 unsupported/unknown guest status。

当 ABI 3 status 为 `-1` 时，`ProgramHostV2` 不 decode output，丢弃 scratch guest/BFP/kernel bundle，发出绑定
已接纳 event 与 plugin identity 的命名 terminal，并证明 pre-event checkpoint bytes/digest 未改变。output
frame 不能声明该 terminal，status 也不能携带 post-state、intent、target、protection 或 effect bytes。
ABI/version/failure-ID mismatch、unknown status、trap 或 status/output-length conflict 都通过既有通用
unsupported boundary fail closed。任何 V2 row 或 receipt 都不会被 rewrite、reinterpret 或 promote。

#### V3 build capsule 与持久兼容

`DevelopPluginBuildProducerV2` 是 CURRENT/PARTIAL，只从 manifest 派生固定空实现，无法诚实承载可变 BFP
含义。因此 TARGET producer 接受单独 tagged V3 capsule，绝不对 V2 做未版本化改写。规范 V3 capsule 与
build receipt 绑定 plugin semantic ID/manifest digest、BFP 规范 bytes/digest、准确 first-party SDK 与
`vibe-indicators-kernel` catalog/source digest、lowerer identity/source digest、compiler/linker/target sysroot/
toolchain/target/build-profile identity、固定 command/configuration、完整 source-file set/digest，以及声明的
source/Wasm、fuel、memory、import、export、ABI、port、state、invocation bounds。两个 fresh private build
必须成功完成，并生成字节一致的 source 与 Wasm。随后现有 ABI/resource verifier 拒绝所有未声明 import/
export、start function、`memory.grow`、floating-point opcode、ABI/manifest mismatch 或资源超限。

`PluginImplementationReceiptV2` 可以继续绑定结果 module 与不透明 `verified_build_receipt_digest`，但不解释
或 mint V3 authority。Composer durable custody 必须存储并回读显式
`V2(existing canonical bytes) | V3(canonical bytes)` receipt tag，使用对应 decoder 校验所选 schema，并把 tagged
receipt digest 绑定进 Plan/Artifact 路径。既有 V2 row 与 digest 保持逐字节权威和可读；migration 不得 rewrite、
reinterpret、backfill 或静默提升为 V3。missing tag、unknown version、cross-tag replay、V3 tag 下的 V2 bytes、
同一 build identity 下改变 BFP，或 V3 coverage 不完整，都必须 fail closed 且不生成 Plan/Artifact。

新 corpus 通过唯一 BFP-to-Wasm 路径证明仍被接纳的 legacy behavior 等价后，`complex_strategy_ir`、
`complex_strategy_program`、其 interpreter/compiler 路径和手写 V1 complex program 必须被删除或退休为非
authoritative。其 floating-point semantics 与 raw `Action::Submit` plumbing 不得被翻译、包装或保留为 BFP、
SDK、primitive、Host 或 migration authority。

#### 首个未来 executable corpus 与 falsifier

首个未来 executable corpus 必须不可变且预提交。其单一 `InputJoinV2` 包含 1-minute raw
open/high/low/close price role，以及 1-hour-close 与 1-day-close regime-source price role。每个 joined role
都具有相同 fixed-I128 value type、price unit 与 scale；1-minute-close role 是显式 trigger。这个 V1 corpus
不包含 volume role。在 1-minute trigger clock 上计算 ATR、RSI、candle geometry、rolling swing 与 rational
Fibonacci range fraction，在命名的 1-hour-close/1-day-close sample clock 上更新 multi-timeframe regime state。
reaction 准确消费该完整 join role set。有界 holding、add-count、high-water 与 protection state 驱动一段连续
event sequence，其中包含
`ENTER -> ADD -> REDUCE -> EXIT` 和显式 `HOLD`，并输出动态 stop-loss、take-profit 与 trailing protection。

验收要求规范 BFP 两次 lowering 得到字节一致 source，两次 build 得到字节一致 Wasm 与 tagged V3 receipt，
经 Composer 进入同一 `StrategyArtifactV2`，并通过真实 `ProgramHostV2`/Backtest shared-kernel path 执行。
完整重复运行必须生成字节一致的 BFP、source、Wasm、build receipt、Plan/Artifact identity、ordered semantic
trace、checkpoint、fill、position、protection、cost 与规范 Backtest result。在每个声明 state frontier 恢复
checkpoint 都必须复现字节一致 suffix。

corpus 必须为以下情况提供负向 oracle：unknown opcode/field/semantic ID；scale/unit mismatch；每个 checked
overflow 与 rounding boundary；missing/stale/cross-lineage binding/coordinate；same-sample duplicate；
equal-valued new sample；duplicate/conflicting state advance；DAG/window/state/fuel/memory/source/Wasm
exhaustion；noncanonical bytes；build/source/Wasm inequality；ABI/import/export violation；floating-point
presence；以及任何 raw-order output。它还覆盖 missing/duplicate/noncanonical golden ID 或 vector、ABI 3
failure-semantic mismatch、unknown negative status、status/output-length conflict，以及携带 output 或 post-state
的伪造 numeric terminal。每个负向案例都必须在命名 boundary 终止且不生成 fallback，并按适用
情况让 checkpoint、BFP/plugin/kernel state、target/protection、semantic trace、Plan、Artifact 与 external
effect 保持字节不变或不存在。

golden vector 还必须冻结：两种 rounding mode 的正负 half tie；每个 lag、rolling、EMA、Wilder、ATR、RSI、
gap 与 swing 在 `READY` 前一刻和首次 READY 的 warm-up frontier；flat-price RSI `50`；zero-loss RSI `100`；
zero-gain RSI `0`；首个及后续 true range；OHLC rejection；latest-coordinate swing tie；same-sample 不推进；
equal-valued-new-sample 推进；I128 intermediate 会 overflow 但 I256 intermediate 与最终 scaled result 均可容纳
的计算；I128 `MIN / -1`；denominator 为零、rational 未约分、numerator 大于 denominator 或 low 大于 high
这些可表示的 invalid range fraction；以及上述 closed state-byte-identity ID 命名的每个 primitive
failure class。每个这类 vector 的 pre/post state 与 checkpoint 必须逐字节相同。transport、receipt、ABI、
build 与 resource failure path 则通过各自不同的命名 corpus oracle 证明同一 no-change property。任一 required
golden vector 缺失，或在两次 lowering、两次 build、完整 rerun、checkpoint-restored suffix 之间不同，都必须
使 publication 失败。

`InputJoinV2` version 1 只接纳一种 alignment semantic：
`strategy.input-join.latest-not-after-trigger.v1`。Research 必须声明非空且唯一的 join ID、至少两个唯一的
原始类型化 input-role ID、该准确集合中的一个显式 trigger role，以及大于零、有限且不超过 31 天的
`max_staleness_ns`。join-to-join edge（包括 cycle）、重复或未知 role、一个 role 被两个 join 共用，以及
fact class、scope、value type、unit 或 scale 不兼容都属于 `UNSUPPORTED`。每个 joined role 都是带显式
instrument 与 timeframe 的 exact-instrument Market Data Owner role；一个 reaction 要么消费完整规范 role
集合，要么完全不消费。接纳时 trigger 固定 joined event 的 lifecycle 与 logical time；每个 component 必须
具有相同 lifecycle、时间不晚于 trigger，并满足
`trigger_time - component_time <= max_staleness_ns`。Market Data 在一份完整已验证 PIT/correction census 与
frontier 上执行逐 role latest-not-after argmax，再把 trigger、准确 Design/join/role 集合、所选 frame identity
与 digest、selection-basis/frontier digest、source/correction lineage、staleness proof、Market Semantics identity
和 receipt digest 封存在不可 `Deserialize`、没有 public constructor 的
`StrategyInputJoinedCutReceiptV1` 中。Host 只接收该 receipt，校验其准确 Plan 投影和 Owner 规范 component
顺序，不能选择、替换、重排或推断 frame；`SealedReplayInput` 只能作为 Owner 内部证据基础。缺失、重复、
过期、来自未来、receipt/role/Plan 不匹配、跨 census 或跨 Design 拼接、跨 lineage version 回退、同 root
的冲突 version，或 component/event identity 冲突，
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

## TARGET / NOT_ADMITTED - TrialFamily 拥有的 Replay execution policy V2

R&D 必须在 TrialFamily formation 时冻结准确一份规范嵌套 `replay_execution_policy_v2`。永久 family root、
policy 与初始 Census Frontier 必须交叉绑定各自身份和规范摘要，使后续 family member、Composer、Windmill
flow、Backtest adapter 或其他 caller 都不能替换或重新解释该 policy。该内容仍是目标架构契约；当前
caller-authored `ReplayRequestDtoV2` 路径不满足此契约，本文不声称已有 PostgreSQL 或 Windmill acceptance。

该嵌套 policy 拥有组合完整 `ReplayRequestDtoV2` 含义所需的每项执行选择：

- runtime-kernel、simulator、cost、slippage 与 capacity profile 的身份和版本；
- runner operational profile、diagnostic policy 与 deterministic seed；
- 半开 replay window，以及 calendar、session 与 time-zone 的身份和版本；以及
- correction-rule 与 market-semantics 的身份和版本、corporate-action cut、historical-membership cut，及请求中
  其他应由 family policy 而非 input Owner 选择的内容。

TrialFamily 既有顶层 cost-model、slippage-model 与 capacity-model 身份必须与对应嵌套 model profile 准确
相等；不匹配即 unavailable，而不是另一种兼容表示。缺少密封 policy 的 legacy TrialFamily 仍可按历史事实
读取，但对 Replay V2 composition 不合格且不可用：不得提供 default、backfill、caller substitution，也不得从
更新的 family 推断。

Windmill 与其他任何 Exploratory Replay caller 只能提交 Artifact 与 TrialFamily 身份，以及 Owner-sealed
Composer、Market Data 和 replay-policy locator/digest。这些值只是证据定位器，不是选择权威。只有 R&D Owner
能够解析它们并组合完整规范 Replay request；caller 不能提供或覆盖 runtime/model profile、replay window、
calendar/session/time zone、deterministic seed、diagnostic policy、correction rule、market semantics 或任一
historical cut。

在同一个 `commit_v2` 事务内、第一笔 `INSERT` 之前，R&D 必须锁定并重新读取 composition 使用的每一项规范
Owner fact，包括 Artifact-family binding、family root 与当前 Census Frontier、密封 replay policy、Composer
fact 和 Market Data cut。任何 input 缺失、过期、摘要不匹配、跨来源拼接或被 caller 覆盖，都必须拒绝操作，
并保证 Replay request、receipt、outbox 与 head 全部零变化。Backtest 只接收由 R&D Owner 生成的密封 request，
且只拥有其 result；它绝不创建 request 或选择 execution policy。

该设计既不增加第二个 request aggregate，也不增加新 Owner。它保留
`StrategyDesignV2 -> StrategyPlanV2 -> StrategyArtifactV2 -> ProgramHostV2`、既有 R&D request identity 与
custody，以及 response-loss recovery：准确 `RESOLVE` 只能恢复同一份既存密封 request meaning，不能组合
replacement、改变 policy，或创建第二份 request、receipt、outbox 或 head。只有实现完成，并由真实 disposable
PostgreSQL Owner readback 与 end-to-end Windmill acceptance 证明完整 composition 和每种零变化拒绝后，该
TARGET 才能获准；它不授予 production 或 trading authority。

## 保护路径

Research 在提交前冻结 TrialFamily 穷尽 Census Frontier 跨 TrialFamily 前驱前沿 预提交独立性依据 PIT 规则 成本 容量假设 预算 证伪条件和停止规则。Qualification 校验这些 frontier 预注册内容 准确 `READY_FOR_SELECTION` 决定和仅选择 disposition，并拥有相关 TrialFamily 的累计 holdout 预留与处理，再请求保护重放。仅选择 disposition 缺失 证伪条件不匹配 遗漏同族试验 试验改名 预算不符 frontier 可变 祖先未解析 独立性依据过晚 反馈前沿过期或截面后新增族成员时都在保护回放前闭合为 `NOT_ADMITTED` 且不消耗 holdout；Research 终态停止永不进入 intake，后续试验需要后继 Candidate。保护结果可以更新 Eligibility State，但绝不能反馈同一研发循环。

## 权威边界

R&D 拥有 Intent TrialFamily Artifact Exploratory Replay Request 和 Candidate 身份。Develop 是 R&D 内部能力，不是第二 Owner。Backtest 拥有重放结果且不能替 R&D 选择下一动作，Qualification 拥有 intake 状态 holdout 状态 资格和撤销。Strategy Factory 不拥有这些事实，也没有独立存储权威。

## 实现验收

每次交接都保留不可变身份 请求关联 保护反馈祖先和实际消费输入回执。R&D basis 创建必须早于任何 Qualification 保护反馈写入。Qualification 投影绑定准确 basis ref/digest principal request scope source sequence/cut clock epoch 与半开有效期；过期 畸形 不匹配或不可用权威都不能创建 S1 转换。每个探索结果都关联一个稳定且由 R&D 拥有的请求身份，不匹配时运行前失败。Candidate intake 必须证明准确 `READY_FOR_SELECTION` 决定与 `SELECTED_FOR_QUALIFICATION` disposition 交叉绑定冻结证伪条件与探索前沿，TrialFamily frontier 在截面前不可变且穷尽，并证明累计 holdout 处理不会被 TrialFamily 改名重置。终态停止不创建 Selection 不能为 `ADMITTED` 且不消耗 holdout。任何保护结果都不能改写 R&D 输入 参数或被评估的 Artifact。

首次 S1 写入前，R&D 必须持有规范 Operator Authorization、Product Edge、本地 lineage 与 Qualification 锁，完成最后一次 Qualification 回读，然后才在第一笔写入前立即采样唯一 final cut。所有结果身份与回执都绑定同一 cut，authorization、binding、manifest 与 Qualification 的半开有效区间必须在该 cut 同时仍为 current。cut 等于任一 `valid_through` 即为 stale，并且 R&D receipt、Intent、TrialFamily、census 与 outbox 全部零写入。

在该终态写入之前，已提交的 Independence Basis 阶段即为持久下游 custody：它密封完整规范 R&D 请求含义、语义摘要、Product Edge admission locator 与历史 lineage、basis 回执及 outbox。准确 `RESOLVE` 只能使用这份经验证的密封含义恢复历史完成路径，且不得创建第二份 basis、head 或 outbox；含义变化、admission 变化、仅有裸行、custody 畸形或缺失都必须 fail closed。R&D 终态回执提交后，后续 authorization 或 view 过期仍保留准确回执、Intent、TrialFamily、basis 与历史 Qualification 投影，并以 `STALE` 只读结果返回；唯一动作是同请求解析，不授予新提交、后继或 provider effect。
