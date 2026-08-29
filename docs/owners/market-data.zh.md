# Market Data

## 职责

向所有分析和交易消费者提供规范 时间正确的市场 参考和标的事实。Market Data 拥有数据含义和可观察时间，但不替某个策略决定本轮应消费哪些标的。

## 拥有的权威事实

- 标准化市场记录明确区分事件时间 provider 可用时间 本系统检索时间和修订发布时间。可观察表示该事实
  在绑定决定截面已经可被本系统使用，而不只表示底层事件已经发生。
- 数据版本 时点可用性 覆盖范围 血缘 修订和许可约束。
- 规范标的身份 场所映射 最小价格单位 合约周期 币种和估值条款，包括按生效时间版本化的交易
  calendar session time-zone rule corporate action symbol change expiry/roll 事实和历史 membership。
- Universe Selection Record 绑定请求方拥有的 selection rule、eligible-instrument frontier、生效与可观察
  时间、历史 membership cut、排除原因和结果身份。Market Data 只执行外部提供的规则，不替策略选 universe。
- PIT Market Snapshot 身份绑定来源与数据版本 四类时间 共享时钟和决定截面可用前沿、Instrument Master 与 Universe
  Selection Record 版本、calendar/session/time-zone 与 corporate-action cut、覆盖 许可 修订血缘和唯一
  Market Semantics Compatibility 身份。
- 每个普通 Research snapshot disposition 还重复准确 PIT Market Snapshot Request 身份与内容摘要、请求
  instrument 与 universe scope、决定截面、provenance license correction、稳定 correlation 和 Time Evidence。
  Research 侧的 `PREPARED` 或 `SUBMITTED_OR_UNKNOWN` 都不能证明数据可用。
- 历史 snapshot 与 live stream 共享的 Market Semantics Compatibility 身份，绑定 normalization adjustment
  timestamp interpretation instrument/reference mapping 与输入含义版本。
- **TARGET：** 类型化 Strategy Input Binding Receipt，把一个 Research 声明的 market/reference role 解析到
  准确 instrument/universe、field、timeframe、unit、PIT/live cut、source 与 Market Semantics 身份。
- 不可变 Market Data Source Binding 绑定来源实现与配置摘要、已认证 endpoint 与 dataset/account mapping、
  trust 与 normalization policy、license 与 redistribution scope 和不透明最小权限 credential handle。
- 每个 Source Binding 保留完整 supported failure-category set。版本化稳定优先级与证据到达顺序无关地
  选择一个 primary category 与规范状态：权利撤销为 `REVOKED`，明确拒绝为 `UNLICENSED`，权利证据
  未解析或来源不可用为 `UNAVAILABLE`，identity/configuration 或 semantics 不匹配为 `INCOMPATIBLE`。
  `ADMITTED` 是互斥状态，要求 failure set 为空。
- **CURRENT：** 一个私有规范 clock head 与 Owner-local Source Binding 和 PIT fact 原子持久化。当前支持准确
  replay 与同 epoch 前进；epoch 变化、sealed 跨 Owner handoff 与 Epoch Successor Proof 均非当前能力。
- **TARGET：** immutable、content-addressed 且可按准确身份回读的 sealed clock-head handoff 绑定 head
  identity/digest、clock identity/epoch、monotonic sequence、wall observation、decision cut、排他的 valid-through、
  restart-continuity digest、uncertainty/skew bound 与 comparison rule。同 epoch successor 严格推进必需 cut。
  新 epoch 还要求一个 direct immutable Epoch Successor Proof 与新 head 原子提交，绑定准确 predecessor/successor
  head digest、前后 epoch identity、successor continuity digest、proof identity、commit cut 与 comparison rule。

## 模块

- **Data Clients** - 连接官方数据商和交易场所，取得原始成交 报价 K线和参考文件，但不定义业务身份。
- **Data Engine** - 统一记录格式和时间语义，提供订阅查询并生成可复现快照。
- **PIT Catalog** - 记录数据 calendar session action membership 与 correction 何时可观察，并执行外部
  提供的 universe-selection rule，防止未来信息进入历史研究或重放。
- **Instrument Master** - 拥有按生效时间版本化的标的身份 场所映射 合约条款 session time zone
  lifecycle 与 corporate-action 事实，不选择本轮运行标的。

## Instrument Master Owner 契约

### 状态与固定消费者

**CURRENT/PARTIAL：** PIT 与 Strategy Input 路径携带 request 提供的 `instrument_master_digest`，并将其与
Owner-verified batch 携带的 digest 比对。该 digest 是当前有界路径的 provenance，但不是原生 Instrument
Master fact、cut、write receipt 或 sealed readback。代表性 Strategy Factory 路径还冻结了一个 data-Owner
role 字符串以及 AAPL/MSFT fixture。这些硬编码 role 与 mapping 是 implementation target，不是 Instrument
Master 权威。当前代码或动态验收均未建立下述 TARGET 契约。

**TARGET：** Market Data 是原生 Instrument Master 状态路径的唯一 writer 与 resolver。其固定跨 Owner
consumer role 是准确 ASCII 身份 `BACKTEST_OWNER_V1`。R&D 声明研究 scope，Strategy compiler 消费
Owner-sealed resolution，但两者均不得直接查询 Instrument Master storage、维护 symbol-to-instrument 或
venue mapping，也不得合成 resolution。用直接 Owner resolution 替换当前硬编码 Strategy Factory
role/mapping 路径是必需的后续实现工作。

**NOT_ADMITTED：** 本契约不准入 Rust 实现、schema migration、provider ingestion、production/default
database write、Dashboard 工作、动态产品验收或交易。caller-carried digest、看似规范的字符串、静态
fixture、transport success 或文档检查都不能声称原生 Instrument Master custody。

### 原生不可变记录

`InstrumentMasterFactV1` 是按生效时间版本化的不可变 fact。它包含以下全部字段，consumer 不得替换：

- 规范 instrument identity 与可选的准确 predecessor fact digest；
- venue 与 source mapping；instrument class；以及适用的 base、quote、settlement 与 margin currency；
- price increment、quantity increment 与 contract multiplier；每项均编码为 signed `i128` mantissa 加明确
  decimal scale，不得使用 floating-point representation；
- trading calendar、session 与 time-zone identity；
- lifecycle、corporate-action、historical-membership、Market Semantics Compatibility、source 与 correction
  frontier；
- 一个半开 effective interval `[effective_from, effective_until)`；upper bound 缺失表示 open，并不表示
  latest；以及
- provider-available、retrieval、correction-publication 与 Owner-observation coordinate，并附接纳该
  observation 使用的准确 clock identity/epoch/sequence、decision cut 与完整 sealed clock-head projection。

`InstrumentMasterFactV1` 与 `InstrumentMasterCutV1` 都声明既有规范 `timeEvidenceCutKind`
`MARKET_DATA_AS_OF`，不创建新的 Time Evidence kind。每个 fact 与 cut 都绑定接纳它的既有 sealed
clock-head handoff 的完整 projection：head identity 与 digest、clock identity 与 epoch、monotonic sequence、
wall observation、decision cut、排他的 `valid-through`、restart-continuity digest、uncertainty 与 skew bound，
以及 comparison rule。新 epoch 还绑定随该 head 一同解析的唯一 direct immutable Epoch Successor Proof
identity 与 digest；只有未消费 epoch transition 时 absence 才是规范值。这些字段仍位于 fact 与 cut domain
内，不创建第五个 identity domain。

fact 内的 provider-available、retrieval、correction-publication 与 Owner-observation coordinate 都绑定其唯一
准确 sealed head。cut 内的 Owner-observation time 与 decision cut 绑定其唯一准确 sealed head。唯一
comparison rule 是 `SAME_CLOCK_EPOCH_SEQUENCE_AND_CUT_V1`：cut head 必须是 commit 时从 Owner 直接解析的
准确 current head，其 identity/digest 与 optional Epoch Successor Proof 必须验证，restart continuity 必须已
证明，cut Owner-observation time 必须严格早于其排他 `valid-through`，且 uncertainty 与 skew 必须位于获准
bound 内。只有 fact 与 cut 的 clock identity 和 epoch 逐字节相等、fact monotonic sequence 不大于 cut
sequence、fact decision cut 不大于请求 decision cut，且 fact 的每个 availability、retrieval、correction 与
observation coordinate 都不晚于 cut Owner-observation time 时，该 fact 才在 cut 可观察。consumer 不得遍历
head 或 epoch-proof chain、跳过 predecessor 或跨 epoch 比较 sequence。head 不可用、不匹配、过期或不连续，
epoch transition 未证明，clock/epoch 混合或未知，uncertainty 或 skew 超限，sequence 或 decision-cut 回退，
以及 cut 后的 correction 或 observation 都不产生 positive result。effective-time containment 是独立的第二个
predicate。

effective time 与 observation/decision-cut time 是相互独立的双时间轴。fact 可以早于其可观察时间生效。
resolution 必须同时证明请求的 effective instant 位于半开 interval 内，且 fact 在绑定 decision cut 已可观察。
late correction 只能创建以被修正 fact 为 predecessor 的不可变 successor；它不得改写 predecessor，也不得
让 correction 在更早 cut 可用。

`InstrumentMasterCutV1` 是面向 `BACKTEST_OWNER_V1` 的 content-addressed 不可变 resolution cut。它绑定
consumer role、请求的 instrument 或 Universe Selection Record scope、effective instant、
observation/decision cut、完整 sealed clock-head projection、准确 expected canonical member set、按契约排序的
已解析 canonical identity 与 `InstrumentMasterFactV1` digest、全部必需 frontier identity，以及明确完整的 gap
set。任何带 gap 或 conflict 的 cut 都不是 positive。

每次获准 resolution 都在 Market Data write authority 下原子 append 一份 write-once receipt 及其 outbox
entry。receipt 绑定 request identity 与 meaning、`BACKTEST_OWNER_V1`、fact 与 cut digest、canonical bytes、
store commit coordinate、stable correlation 和 outbox identity。receipt 与 outbox entry 均不得 update、
replace、通过重排获得另一 identity，也不得在 durable commit 前被视为 positive。

`InstrumentMasterReadbackV1` 是 move-only 且由 Market Data 密封的记录。它携带 consumer 所需的完整准确
canonical `InstrumentMasterFactV1` record bytes 与 `InstrumentMasterCutV1` record bytes，并重复准确 request
identity 与 meaning、consumer role、派生的 fact 与 cut identity/digest、stable correlation 与 durable
receipt/outbox coordinate。普通 consumer 不能 construct、clone、deserialize、implement 或 mint 它。
response loss 后只能通过它恢复；transport acknowledgement、retry success、digest-only existence proof 或
caller 复制的旧字段都不是 readback。

### 规范身份与 codec

原生记录统一使用 domain-separated canonical binary codec 与 BLAKE3-256。准确四个 ASCII domain 为：

1. `VIBE_INSTRUMENT_MASTER_FACT_V1`
1. `VIBE_INSTRUMENT_MASTER_CUT_V1`
1. `VIBE_INSTRUMENT_MASTER_RECEIPT_V1`
1. `VIBE_INSTRUMENT_MASTER_READBACK_V1`

每个 identity 都是
`BLAKE3-256(domain_utf8 || 0x00 || canonical_record_bytes)`；其中 `domain_utf8` 准确等于上述四个字符串
之一，其内部不加 length 或 terminator。record codec 只有以下一种 wire grammar：

- `codec_version` 准确为 `0x0001`；unsigned integer 按字段指定的宽度编码为 big-endian `u8`、`u16`、
  `u32` 或 `u64`；signed decimal
  mantissa 与 time coordinate 编码为 two's-complement big-endian `i128`；decimal scale 为 `u8`；
- 每个 content identity、digest、request identity、correlation、clock identity、store-generation identity、
  clock epoch 与 frontier 准确为 32 bytes；每个 enum discriminant 为 `u16`；optional absence/presence
  准确为 `0x00`/`0x01`，只有 present 时才后接 value；其他值均无效；
- UTF-8 或 opaque byte string 是 big-endian `u32` byte length 后接准确 bytes；list 是 big-endian `u32`
  element count 后接各 element；以及
- time coordinate 是 signed `i128` Unix-epoch nanoseconds。clock sequence 与 decision cut 都是 `u64`；
  store append sequence 也是 `u64`。Uncertainty 与 skew bound 是非负 `u64` nanoseconds。interval 比较
  decoded time coordinate，不按 signed representation 的 bytes 排序。

price increment、quantity increment 与 contract multiplier 的准确数值是
`mantissa * 10^(-scale)`。mantissa 必须大于零，scale 必须位于 `0..=38`。唯一 canonical normal form 要求
`scale == 0` 或 `mantissa % 10 != 0`；因此多余的小数尾零无效。zero、negative value、超过 38 的 scale 与
non-minimal scale 都必须在 canonical bytes 进入 hash 前拒绝。

instrument-class discriminant 只能是 `0x0001 EQUITY`、`0x0002 FUTURE`、`0x0003 OPTION`、`0x0004 FX_PAIR`、
`0x0005 CRYPTO_SPOT`、`0x0006 CRYPTO_PERPETUAL`、`0x0007 FIXED_INCOME`、`0x0008 FUND`、`0x0009 INDEX`、
`0x000a COMMODITY`、`0x000b BETTING` 或 `0x000c SYNTHETIC`；其他值均 unsupported，不产生 positive
record。canonical instrument identity、venue identity、source identity、source instrument、currency、calendar
identity、session identity、time-zone identity 与 consumer role 都是按上述 string rule
编码的准确 case-sensitive UTF-8 byte string，不做 normalization。consumer role bytes 必须准确等于 ASCII
`BACKTEST_OWNER_V1`。currency bytes 是 Market Data 拥有的 currency semantic identity，不是 consumer 解析的
display code。

`InstrumentMasterFactV1` 的 field order 准确为：`codec_version:u16`、准确 UTF-8 string
`MARKET_DATA_AS_OF`、canonical identity、optional predecessor fact digest、venue/source mapping、
instrument-class discriminant、依次为 optional base、quote、
settlement 与 margin currency、price-increment mantissa/scale、quantity-increment mantissa/scale、
contract-multiplier mantissa/scale、calendar identity、session identity、time-zone identity、lifecycle
frontier、corporate-action frontier、historical-membership frontier、Market Semantics identity、source
frontier、correction frontier、effective-from time、optional effective-until time、provider-available time、
retrieval time、correction-publication time、Owner-observation time、clock identity、clock epoch、clock
sequence、decision cut、clock-head identity、clock-head digest、clock-head wall observation、排他的
`valid-through`、restart-continuity digest、uncertainty bound、skew bound、optional Epoch Successor Proof
identity、optional Epoch Successor Proof digest，以及准确 UTF-8 string
`SAME_CLOCK_EPOCH_SEQUENCE_AND_CUT_V1`。两个 optional proof field 必须同时 absent 或同时 present。
venue/source mapping 是一个 count-prefixed list。每项 mapping 是 tuple
`(venue identity, source identity, source instrument bytes)`；mapping 必须按完整 canonical tuple bytes 严格递增，
duplicate 无效。

scope discriminant 只能是 `0x0001 EXACT_INSTRUMENT` 后接一个 canonical instrument identity string，或
`0x0002 UNIVERSE_SELECTION_RECORD` 后接一个 32-byte Universe Selection Record identity。
`InstrumentMasterCutV1` 的 field order 准确为：`codec_version:u16`、consumer role、request identity、
准确 UTF-8 string `MARKET_DATA_AS_OF`、request-meaning digest、scope discriminant 与其规定 payload、
准确 expected canonical member identity、effective instant、Owner-observation time、decision cut、clock
identity、clock epoch、clock sequence、clock-head identity、clock-head digest、clock-head wall observation、
排他的 `valid-through`、restart-continuity digest、uncertainty bound、skew bound、optional Epoch Successor Proof
identity、optional Epoch Successor Proof digest、准确 UTF-8 string
`SAME_CLOCK_EPOCH_SEQUENCE_AND_CUT_V1`、ordered resolution、lifecycle frontier、corporate-action frontier、
historical-membership frontier、Market Semantics identity、source frontier、correction frontier 与 ordered gap。
expected member、resolution 与 gap 是三个独立 count-prefixed list。expected member 是按准确 bytes 严格递增
的 canonical identity string。对于 `EXACT_INSTRUMENT(A)`，该 list 准确等于 `[A]`。对于 Universe Selection
Record，它必须逐字节等于通过绑定 record identity 直接从 Owner 解析的完整 canonical membership set；
caller-carried list 或 digest 不能建立该集合。每项 resolution 是
`(canonical identity, fact digest)`，并按 canonical identity bytes 严格递增；每项 gap 是
`(gap-kind:u16, canonical scope bytes)`，并按完整 tuple bytes 严格递增。duplicate resolution 或
gap 无效。gap kind 只能是 `0x0001 UNKNOWN_IDENTITY`、`0x0002 AMBIGUOUS_IDENTITY`、`0x0003 OVERLAP`、
`0x0004 STALE`、`0x0005 WRONG_ROLE`、`0x0006 WRONG_CUT`、`0x0007 DIGEST_MISMATCH`、
`0x0008 CODEC_MISMATCH`、`0x0009 COVERAGE_GAP`、`0x000a STORE_UNAVAILABLE`、
`0x000b STORE_UNTRUSTED` 或 `0x000c FRONTIER_MISMATCH`。其他 scope 或 gap discriminant 以及 duplicate
resolution 或 gap 均无效。canonical scope bytes 是准确 scope discriminant 后接其规定 payload，再按 opaque
byte-string rule 包裹一次。

fact identity 与 digest 都是 fact domain 下同一份 32-byte result；cut identity 与 digest 都是 cut domain 下
同一份 32-byte result。receipt-domain record 的 field order 准确为：`codec_version:u16`、request identity、
request-meaning digest、consumer role、按 cut resolution order 排列的完整 length-prefixed canonical fact
record bytes 的 count-prefixed list、完整 length-prefixed canonical cut record bytes、store-generation identity、store append
sequence 与 stable correlation。receipt identity 与 digest 都是 receipt domain 下同一份 32-byte result。
outbox identity 定义为与该 receipt identity 完全相同；它在 hash 后派生，不编码进 receipt record，且 outbox
保存准确 receipt bytes。

`InstrumentMasterReadbackV1` 的 field order 准确为：`codec_version:u16`、request identity、request-meaning
digest、consumer role、按 cut order 排列的同一个完整 length-prefixed canonical fact record bytes 的
count-prefixed list、同一份完整
length-prefixed canonical cut record bytes、stable correlation、store-generation identity、store append
sequence、receipt identity 与 outbox identity。receipt 与 outbox identity 必须逐字节相等。readback identity
与 digest 都是 readback domain 下同一份 32-byte result。该 nested encoding 是 Owner-sealed atomic retrieval
result。expected-member list 与 ordered resolution 必须具有完全相同的 identity，每个 member 准确对应一个
resolution，不得缺失或额外存在。每个 resolution identity 必须逐字节等于 nested fact 的 canonical identity，
且每个 resolution digest 必须等于这些准确 nested fact bytes 的 fact-domain hash。consumer 使用前必须验证
这些等式，并按每个 nested record 自己的 domain 验证。

decode 必须消费全部 bytes、校验每个 reserved value 与 canonical order；任何 identity 获准前，重新 encode
必须与原 bytes 逐字节相等。JSON、map 或 map iteration、locale、display formatting、symbol 或 alias
normalization、database row order 与 evidence arrival order 都不能定义 bytes 或 identity。receipt 与
readback domain 绑定各自 record payload；outbox 保存准确 receipt identity 与 canonical receipt bytes，
不引入第五个 identity domain。

### 解析、失败与恢复

request 只有通过面向 `BACKTEST_OWNER_V1` 的当前 Market Data Owner store 才能 positive resolution。对每个
请求 effective coordinate，Market Data 先保留 half-open effective interval 覆盖该 coordinate，且类型化
`MARKET_DATA_AS_OF` evidence 满足上述准确 same-clock/epoch、sequence、decision-cut 与 Owner-observation
以及完整 sealed clock-head 比较的 fact。correction chain 中每个 predecessor 的 canonical instrument identity
必须与 successor 相同。correction 只有在形成一条完整 predecessor chain 时才可与其 predecessor overlap。
resolution 选择该 chain 中唯一 maximal observable fact，即不再是另一 eligible fact 的
predecessor 的 eligible fact。无 eligible fact、存在多个 maximal fact、branch、predecessor cycle、缺失
predecessor，或不属于同一 chain 的 fact overlap 都是 gap 或 conflict，不产生 positive result。在 cut 后才
观察到的 successor 对该 cut 必须忽略，且绝不能追溯替换 predecessor。

positive `EXACT_INSTRUMENT(A)` cut 准确包含唯一 expected member A 与唯一一项 A 的 resolution。positive
Universe Selection Record cut 准确包含该 record identity 绑定的完整 Owner-resolved membership set，并为每个
member 准确包含一项 resolution。两种情形的 gap set 都为空，每个 resolution identity 与 digest 都等于其
nested fact 的 identity 与 bytes，且每条 nested predecessor chain 都保持同一 canonical identity。member
缺失或额外存在、exact-instrument resolution 为空、membership mismatch、nested identity 或 digest mismatch，
或跨 identity predecessor 都不产生 positive cut、receipt 或 readback。

未知或含糊 identity、任何无效 overlap 或 chain、过期 fact 或 frontier、错误 consumer role、错误 decision
cut、fact/cut/digest mismatch、codec/version mismatch、membership 或 coverage gap、clock-head evidence
不可用、不匹配、过期或不连续、uncertainty 或 skew 超限，以及 store unavailable 或 untrusted 都不产生
positive cut、receipt 或 readback。

相同 request identity 加逐字节相同 meaning 会 join durable receipt，并可取得其原生 sealed readback。相同
identity 但 meaning 改变属于 conflict，不创建状态转换。effective scope、observation cut、consumer role、
frontier 或 codec meaning 任一改变都要求 successor request identity。response loss 不授权第二次 write：
恢复只能准确查找 receipt 并签发对应的 move-only `InstrumentMasterReadbackV1`。

### 必需消费与保留

PIT snapshot 创建、Universe Selection Record 求值、Strategy input binding 与 Backtest input admission 都必须
通过本 Owner 契约直接解析 Instrument Master fact。禁止 symbol、ticker、alias、latest-row、
nearest-effective、venue-default 或 consumer-maintained mapping fallback。R&D 与 Strategy compiler artifact
可以携带 sealed fact/cut projection，但不能成为 mapping authority。

每个 Backtest result 必须保留实际消费的准确 `InstrumentMasterFactV1` identity/digest 与
`InstrumentMasterCutV1` identity/digest。只携带 symbol、alias、latest Instrument Master digest 或另一 cut
的 result 不是该 admitted input 的 result。Runtime、Portfolio、Scanner 与 Execution adoption 属于独立后续
工作，不得弱化固定 Backtest consumer 契约。

## 策略 input-role binding

对于 [StrategyDesignV2 compiler](../architecture/strategy-factory#strategy-design-v2-shared-lifecycle-kernel)，
Research 声明类型化 input role，且只有 Market Data 能把 market/reference role 解析为准确 sealed binding
receipt。receipt 把 role 绑定到与 role 无关的稳定 selection identity；后者覆盖 field semantics、instrument
或稳定 Universe Selection Record scope、timeframe/bar specification、unit、scale、Source Binding lineage
root、correction stream 与 Market Semantics identity。可更新的 PIT、snapshot、batch、frontier/version、
time、sequence、row 与 value 不进入静态 digest。它只授予数据消费，不选择策略 universe、mechanism、target、lifecycle action 或 order。

role 解析缺失、过期、含糊、不兼容或不唯一时，binding 必须 unavailable，且不生成 `StrategyPlanV2` 或
replay/runtime input。Market Data、R&D 与 compiler 均不得从 ticker、自由文本 label、alias、substring、
名称相似度、列表位置或到达顺序推断 binding。历史 Backtest 与未来获准 Runtime adapter 必须保留相同
role 与 Market Semantics 身份；不匹配时 fail closed，不能由 consumer 静默 normalize。

**CURRENT/PARTIAL，Owner-binding M1：** Market Data 只能从完整 `VerifiedPitObservationBatch`
派生一个准确含两个成员的 universe，并原子封存按规范顺序排列的 member key、不同的规范 instrument、
Owner 派生 selection identity/digest、Instrument Master digest、batch/snapshot fact、Source Binding
lineage、Market Semantics identity 以及每个请求的 `(member, role)` value。Owner 派生的静态 selection identity/digest 绑定一一对应的
member/instrument 集合、Instrument Master、Source Binding lineage root 与 Market Semantics cut；原 PIT
request universe digest 仅为动态 provenance。caller 到达顺序不影响结果。成员缺失、重复、出现第三个成员、
同一 member 对应不一致 instrument 或不同 member 复用同一 instrument，member-role row 缺失或含糊，
selection/master/semantics/lineage 任一拼接，
以及 caller `InstrumentSet` scope 都不产生 positive selection 或 frame。该状态仅表示当前 Owner-local
binding contract，不声称 compiler、shared kernel、ProgramHost、Backtest、Paper、Live 或生产成熟度。

**仅限 SEALED_ACCEPTANCE：** 非默认编译期 Cargo feature
`sealed-strategy-input-acceptance` 只暴露一个零参数 fixture adapter，语料固定为 AAPL/MSFT 与
OPEN/CLOSE。adapter 先经过 crate-private Source Binding admission 和 PIT
prepare/aggregate/verify 权威路径，再调用正常 universe-frame binder；它不接受 caller 选择的 row、
request、locator、digest、clock、provider、persistence 或 runtime selector。默认与生产 manifest 均不
启用该 feature；即使 release build 显式启用它，该 build 也仍是隔离 acceptance artifact，绝不是生产
build。此 fixture 只证明编译期验收拓扑，不证明 PostgreSQL custody、provider 连通性、已部署 Windmill
readiness、生产 composition 或任何交易权威。

runtime handoff 使用既有静态 receipts 与一个 verified batch 重新解析每个 selection；frame 只携带
trigger 与动态 value receipts，不复制静态 receipt。Market Data 只有在同一个 Owner-verified
observation batch 中所选 rows 具有完全相同的 snapshot/fact/batch identity、event-effective、
provider-available 与 correction-publication time、非零 correction sequence 及 event class 时，才能签发
trigger。bar 映射为 `BAR`；quote、trade、reference、economic 与 scalar frame 映射为 `EVENT`；logical
time 取 provider-available 与 correction-publication time 的较大值；event time 取 event-effective time；
Owner sequence 取 correction sequence。stable event identity 是对这些坐标及排序后的
role/binding/row-digest 集合做 domain-separated BLAKE3 后的前 16 bytes。每份按 role 排序的 value receipt
保留原 binding digest 与 role identity，封存明确 fixed-i128 semantic、准确 little-endian bytes、scale 与
row digest，并交叉绑定 trigger 和 observation-batch digest。consumer 必须从 trigger 派生 lifecycle
envelope，不能从 caller 选择的 value 或 order key 铸造。Market Data 绝不签发 `TIMER` 或 `FILL`
trigger；在真实 Time/Scheduler 与 Execution Owner contract 分别存在前，两者都保持 unavailable。

## 输入交接

- 数据商和交易场所通过 Data Clients 提供原始行情和参考记录。
- [R&D](./rd/) 在探索消费前提交初始冻结 PIT Market Snapshot Request，绑定 Research Request
  Intent TrialFamily、instrument 或 universe scope、四时间决定截面、必需 provenance license correction
  frontier、稳定 correlation 和 Time Evidence。
- [R&D](./rd/) 只有从已提交 `REPAIR_INPUTS` Iteration Decision 才能发出一个 Market Data
  Repair Request。它重复原始 PIT 请求身份与证明摘要 标的范围 决策截面 有界理由 稳定 correlation
  必需 provenance license correction 字段和共享 Time Evidence。
- 运维提供 Market Data Source Binding 不透明 credential handle 许可范围和修订数据，但不能改写历史可观察时间。
  凭据不能进入 snapshot stream artifact 或产品视图。

## 输出交接

- 向 [R&D](./rd/) 提供 move-only、由 Market Data 密封的 `ResearchPitTerminal`；其规范六状态 disposition
  关联准确初始请求身份 内容摘要 scope cut provenance license correction 和稳定 correlation，并附准确 Universe Selection Record 身份与
  摘要用于假设检验。修复请求另以同一关联请求身份返回携带已修复 snapshot 的 `AVAILABLE`，或携带
  有界决定性来源类别的终态 `UNAVAILABLE`。
  Strategy Factory 不能 import、construct、deserialize 或 implement terminal authority，也得不到 raw store
  receipt、PIT lineage row、Source Binding lineage row 或 clock row。
- 向 [Backtest](./backtest/) 提供绑定请求 PIT 范围和 snapshot/correction rule 的准确 PIT Market Snapshot
  与 Universe Selection Record。**TARGET：** 直接 `BACKTEST_OWNER_V1` Instrument Master resolution 提供
  sealed fact/cut readback；实际消费与 Run Result 必须重复准确 snapshot、selection、Instrument Master
  fact/cut 以及每个冻结 execution identity。
- 向 [Scanner](./scanner/) 提供已发布激活条件请求的准确 PIT Market Snapshot。
- 向 [Runtime](./runtime/) 提供携带同一 Market Semantics Compatibility 身份的实时行情流和标的更新；
  generation 的 Strategy Artifact 与历史证据必须消费该身份。
- 向 [Portfolio](./portfolio/) 提供价格 汇率 合约规格 估值事实，以及 Capacity View 使用的带身份流动性输入截面。
- **TARGET，在 Shared Time producer 闭合后，向 [Portfolio](./portfolio/)：** 为 `PORTFOLIO_FRESHNESS` 提供
  sealed 规范 clock-head handoff。Portfolio 提交自己的准确 prior handoff 并独自授权自身 transition；不能
  遍历或跳过 proof link，也不能跨 epoch 比较 monotonic sequence。

## 拒绝和禁止事项

- 不替研究 回测或扫描选择标的和时间窗口。
- 不静默填补 改写或前移缺失的历史事实。
- 不把数据源可访问等同于许可完整 PIT 正确或适合某策略。
- 不准入不可用 已撤销 endpoint 不匹配 摘要不匹配 不可信或无许可来源，不暴露 credential 值，
  也不在 redistribution scope 之外投递数据。
- 不拥有策略 资格 部署 订单或账户状态。
- 不从送达 静默 旧 snapshot 或不匹配请求证明推断修复终态。修复不改写旧 snapshot 或 Research Intent。
- 不从提交或传输确认推断普通 snapshot 结果，也不在请求身份 内容摘要 scope 决定截面或政策 binding
  已变化时复用旧 snapshot。
- 不成为 global Time Owner，也不替其他 Owner 决定 clock transition。
- 不仅凭 DSN、secret、caller assertion 或含糊 store state 构造受治理 Market Data PostgreSQL repository。
  Market Data 私有 store-admission seam 必须消费并 revalidate 准确 sealed Deployment Store Admission receipt；
  随后 Market Data 必须校验当前
  PIT、Source Binding 与 clock head，才能密封 `ResearchPitTerminal`。普通 consumer 永远得不到 receipt、
  capability、raw evidence 或 caller-selected snapshot query。
  production resolution 与动态 product composition 保持 `TARGET / UNAVAILABLE`。

## 失败与恢复

数据不可用 过期 无许可 含义不明或不足时，依赖消费者必须失败关闭。修订生成新的可追踪版本，不能改写旧回执。恢复期间 Market Data 继续提供估值事实，但不能宣布持仓 外部效果或 Recovery Case 已闭合。

provider catalog 的 `LEGAL_REVIEW_REQUIRED` 或其他权利未知映射为 `RIGHTS_EVIDENCE_UNRESOLVED` 与
Source Binding `UNAVAILABLE`；没有决定性拒绝证据时不得变成 `UNLICENSED`。`TERMS_OR_LICENSE_BLOCKED`
只属于 R&D Source Intake 终态，不是 Market Data 状态。Market Data 必须用自己的政策重新评估底层
rights evidence，绝不能跨 Owner 复制该终态。

同时支持多个 blocker 时，binding 与 snapshot 保留完整集合并选择一个稳定 primary。Snapshot 优先级为
`UNLICENSED`、`AMBIGUOUS`、`STALE`、`INSUFFICIENT`、`UNAVAILABLE`。来源 `REVOKED` 或
`UNLICENSED` 映射 snapshot `UNLICENSED`，`INCOMPATIBLE` 映射 `AMBIGUOUS`，来源 `UNAVAILABLE`
映射 snapshot `UNAVAILABLE`。后续证据只能创建后继 binding 与 snapshot，不能升级旧终态。

任一时间坐标或共享决定截面缺失 冲突，或不能证明该事实在决定时已经可用，快照必须为 `AMBIGUOUS`
或不可用。只有事件时间不能接纳历史事实，决定截面之后取得的数据不能回填更早决定。

## 决策契约

- **输入** - 已接纳 source binding 原始行情与参考记录 correction feed license scope，以及请求方拥有
  的 universe rule 或 PIT scope。
- **诊断与决定** - 统一含义 建立四时间可用性 解析 instrument identity coverage correction license，
  再生成一个版本化事实或 snapshot disposition。
- **冲突解析** - source lineage 和决定时可用性高于后续 correction；identity clock version 冲突时保持
  ambiguous，修订只创建后继。
- **输出与终态负例** - stream instrument fact selection record PIT snapshot，或明确 `INSUFFICIENT`
  `STALE` `UNLICENSED` `AMBIGUOUS` unavailable。
- **反馈与经济意义** - 历史和实时含义一致可阻止 look-ahead 错误合约条款或无许可不完整数据造成的
  虚假 Alpha 估值漂移和不安全 sizing。
- **禁止** - 不决定研究目标或策略 universe，不拥有生命周期 订单 账户投影，不泄露 credential，不
  forward fill 或改写可用性历史。

## 后续实现验收

- 历史查询可以证明请求时点实际可观察的数据版本。
- 每条已接纳事实都用同一时钟和决定截面证明事件 provider 可用 检索和修订发布时间，后知事实不能
  变成更早已知证据。
- 标的身份和合约条款在研究 重放 实时数据 估值和执行适配器之间一致。
- 历史与实时消费者遇到 Market Semantics Compatibility 身份不匹配时必须拒绝，不能在部署时静默改变
  normalization adjustment timestamp 含义或 instrument mapping。
- 每个 PIT 请求都证明 calendar session time zone corporate action lifecycle 历史 membership 和
  universe-selection 版本在请求截面同时已经生效且可观察。
- 每个普通 Research 响应都重复准确初始 PIT Market Snapshot Request 与 correlation binding；含义变化
  必须创建后继请求，静默不能创建 Market Data 或 Research transition。
- 数据不足或过期会得到显式结果，而不是合成成功。
- 对相同准入版本重复生成快照可得到相同规范输入。
- 快照结果必须明确为 `AVAILABLE` `INSUFFICIENT` `STALE` `UNLICENSED` `AMBIGUOUS` 或
  `UNAVAILABLE`。每个修复响应还必须重复 repair request 身份 稳定 correlation 和原始请求证明摘要。
- rights compatibility freshness sufficiency availability 同时失败时保留完整 blocker set，并由冻结优先级
  在任意证据到达排列下选择相同 primary。
- Qualification 冻结保护请求后，重放不能替换 PIT 范围 Universe Selection Record 身份或摘要 快照规则 修订前沿或快照身份。
- 同 epoch handoff replay 合并准确 bytes；前进必须严格推进必需 cut 且不改变 epoch 语义。新 epoch 的新 head
  与 direct immutable proof 若未原子提交并可按 digest 准确回读，必须失败关闭。
- 面向 `BACKTEST_OWNER_V1` 的原生 Instrument Master resolution 对相同 request identity 与 meaning 返回相同
  fact/cut identity 和 canonical bytes；wrong-role、overlap、late-correction、gap、stale、unavailable-store、
  response-loss 与 changed-meaning case 都证明上述 fail-closed 与 successor-only rule。

## 可观测性与持久化

Market Data 在自身写权威下持久化 Source Binding、rights/retention decision、semantics profile、instrument history、PIT request/snapshot、stream/valuation fact、correction 与发布 outbox。Telemetry 记录 provider request latency、新鲜度、缺口、rate limit、correction lag 与有界拒绝类别，但不导出 API key 或受许可约束的 payload body。Dashboard 的来源健康状态必须携带 source/semantics 版本、as-of frontier、license disposition、完整性与 valid-through；绿色 provider metric 不能替代缺失或过期的 PIT fact。
