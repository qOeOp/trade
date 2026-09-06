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

## Calendar 与 Time Zone 原生 Owner 契约

### 持久 R0 observation-evidence foundation

**CURRENT：** `ReferenceFactR0RecordV1` 是独立原生 reference authority 共用的唯一持久 R0
observation-evidence aggregate。R0 不是 business fact、coordinate selector 或第二 clock。其私有 PostgreSQL
resolver 只接收不受信 request 与准确 locator `{request_identity, request_meaning_digest}`。它规范解码准确
PIT Snapshot 与 Source Binding locator，解析并逐字节匹配其原生 Owner custody，解析完整共提交 PIT
observation batch 与准确历史 Shared Time head，随后才创建 record。Head、latest、history scan、caller 携带的
authenticated input 或仅结构有效的 locator 都不能产生 positive R0 custody。

Record 交叉绑定准确 PIT request identity/digest、snapshot identity/fact digest 与经验证 PIT outbox digest；
完整 observation-batch digest；Source Binding identity/fact digest/outbox digest、lineage root/version；准确
source/correction frontier stream/cut-identity bytes、sequence/digest；准确 clock/epoch bytes、monotonic sequence、wall
observation、decision cut、排他的 valid-through、head identity/digest、restart continuity、uncertainty/skew；
replay/effective bound；provider-available、retrieval、correction-publication 与 Owner-observation coordinate；
可选 predecessor；以及 stable correlation。每个重复 time/frontier field 都与准确 PIT observation batch、
Source Binding locator、PIT time evidence 与解析所得 Shared Time head 逐字节匹配。R0 保留 PIT Owner 既有
outbox digest；它不会对 locator bytes 铸造 digest，也不重新解释旧 shared helper 的 SHA-256/little-endian
identity。

R0 version 1 的所有整数均为 big-endian，可选 tag 准确为 `0x00`/`0x01`，reserved 为 `u16BE = 0`；identity
是下列 NUL-terminated domain 加准确 canonical bytes 的 BLAKE3-256。

- Request-meaning domain 为 `vibe.market-data.reference-fact-r0-request.v1\0`；bytes 为 schema、reserved、
  以 `u32BE length || bytes` 编码的规范 PIT 与 Source Binding locator、replay start/exclusive end、
  effective-from、可选 effective-until、四个 observation coordinate、decision cut、可选 predecessor 与
  stable correlation。Request identity 是独立 idempotency key。
- Record domain 为 `vibe.market-data.reference-fact-r0-record.v1\0`；bytes 为 schema、reserved、request
  identity/meaning、按上述顺序排列的准确 PIT、observation、Source Binding、frontier 与 Shared Time field，
  随后为 replay/effective bound、四个 observation coordinate、decision cut、可选 predecessor 与 stable
  correlation。可变 clock、epoch 与 frontier stream/cut identity 使用 `u32BE length || bytes`。
- Cut domain 为 `vibe.market-data.reference-fact-r0-cut.v1\0`；bytes 为 schema、reserved、request
  identity/meaning、准确 member count `u32BE = 1`、record identity/digest，以及 gap count `u32BE = 0`。
  推断 empty 或 multi-record cut 均非 positive。
- Receipt domain 为 `vibe.market-data.reference-fact-r0-receipt.v1\0`；bytes 为 schema、reserved、request
  identity/meaning、cut identity/digest、store-generation identity、正 append sequence 与 stable correlation。
  Outbox identity 等于 receipt identity，payload 等于准确 receipt bytes。
- Readback domain 为 `vibe.market-data.reference-fact-r0-readback.v1\0`；bytes 为 schema、reserved、record
  identity/length/bytes、cut identity/length/bytes、receipt identity/length/bytes 与 outbox identity。

一个 transaction 在私有 table 中存储 record、单 record 完整 cut、generation/append state、receipt 与
outbox。准确 identity/meaning replay 重新解码、重新 hash 并交叉验证每一 row，返回逐字节相同的 move-only
readback。Meaning 改变、locator 缺失/篡改、partial row、scalar/frontier splice、canonical drift 或
response-loss retry mismatch 均不 append。**NOT_ADMITTED：** R0 不授予 provider authenticity、default 或
production database write、deployment、runtime、Dashboard 或 trading authority。

### ReferenceFactCatalogV1 业务值权威

**TARGET：** `ReferenceFactCatalogV1` 是 Calendar、Time Zone 与 Session 业务值的唯一 Market Data Owner
catalog。它与 R0 属于不同权威轴：catalog 拥有 typed value、business scope、业务生效半开区间、revision、
correction lineage 与 direct predecessor；R0 只拥有解析该值时使用的准确 PIT/Source/Shared-Time observation
evidence。R0 的 replay/effective bound 绝不能扩大、截断或创建 catalog 业务区间。

闭合 value tag 为 `1 CALENDAR`、`2 TIME_ZONE` 与 `3 SESSION`。Calendar entry 绑定一个准确 civil-day 的
open/closed 值；Time Zone entry 绑定一个准确 time-zone/ruleset/UTC-offset 值及 offset 保持不变的 UTC
区间；Session entry 绑定一个准确 trading day、连续 interval ordinal 与带显式 fold resolution 的 local
open/close boundary，绝不存储权威 UTC endpoint。只有 Session 能依据准确 Time Zone cut 重算 endpoint，
并且必须证明 open 与 close 两个 instant 都被覆盖。

只有已准入 bootstrap/admin source 可以 append immutable catalog entry。Runtime 只接收不受信的准确 entry
locator，并且只能解析及逐字节验证；caller 携带的 typed proposal、latest/head 选择或仅结构有效的 bytes
都不能铸造 positive custody。Entry 绑定准确 Source Binding identity/fact/lineage 与 source/correction
frontier。原生 Calendar、Time Zone 与 Session fact 重复已解析 catalog identity，并保留独立 R0
observation coordinate。Entry 缺失、meaning 改变、source splice、predecessor branch、非规范顺序、区间
overlap/gap，或 Session boundary 位于 Time Zone coverage 外，都必须写入零 native fact、cut、receipt 与
outbox row。

Catalog key 与 entry identity 分别是
`vibe.market-data.reference-fact-catalog-key.v1\0` 与
`vibe.market-data.reference-fact-catalog-entry.v1\0` 加规范 big-endian bytes 的 BLAKE3-256。Key 绑定闭合
kind、business scope、正 revision、source lineage root 与完整 typed value。Stable catalog-head scope 准确由
stable business-scope identity 加该 source lineage root 构成；revision 与 typed value 都不得选择另一个 head。
Business-scope identity 是 `vibe.market-data.reference-fact-business-scope.v1\0` 加 schema `u16BE = 1`、
reserved zero `u16BE`、闭合 kind `u8` 与准确一个 native key 的规范 bytes 的 BLAKE3-256：Calendar identity
`u32BE length || bytes` 加 civil day `i32BE`；Time Zone identity `u32BE length || bytes` 加 ruleset identity
`[u8; 32]`；或 Session identity `u32BE length || bytes`、trading day `i32BE` 与 interval ordinal `u32BE`。
Entry 在完整 catalog-key bytes 之后另外依次绑定 command identity、可选 catalog predecessor、正 correction
sequence、业务生效区间、准确 Source provenance、administrator admission identity 与 stable correlation；
它不重复已经由该 key 绑定的 typed value。
Catalog predecessor 始终是同一 head scope 内的前一 catalog entry identity，绝不是 native fact identity。
Genesis 的 correction sequence 为 `1` 且没有 catalog predecessor；每个后继 entry 都绑定紧邻的前一 catalog
entry，且 sequence 准确加一。Time Zone 后继要么修正同一个恒定 offset regime 并保留 byte-identical
effective bounds，要么描述紧邻 regime，且其 lower bound 必须等于 predecessor 的 upper bound。Calendar
与 Session 后继修正同一个 stable native key，因此保留 byte-identical effective bounds。使用前必须解码、
重新 hash 并匹配准确 stored bytes。
**NOT_ADMITTED：** 隔离验收 catalog 数据不证明 vendor authenticity，也不授予 default/production database、
deployment、provider、Dashboard、runtime 或 trading effect。

### 共享原生边界与 custody

**CURRENT：** Replay V2 已有 typed Calendar 与 Time Zone value，而 PIT 与 Instrument Master 仍只携带
calendar、time-zone 或 ruleset identity，不携带原生 Calendar/Time Zone readback。Shared Time 只认证
Market Data 何时观察到 fact；绝不提供 calendar day、open disposition、time-zone rule 或 UTC offset。

**TARGET：** Calendar 与 Time Zone 是相互独立的 Market Data 原生权威。其固定消费者是：直接保留原生
cut identity/digest 的 PIT；绑定原生 cut identity/digest 而非字符串的 Instrument Master；接收确定性
projection 的 Replay V2；以及后续 BAR resolution。Session 是准确 Calendar 与 Time Zone cut 的唯一 join。
两个原生权威互不依赖 Session，也不复制对方 fact。不受信 private proposal 不得重新解释既有 Replay V2
value 或铸造 positive custody。

Calendar、Time Zone 与 Session 各权威都只接受一个不受信的准确 catalog-entry locator 来选择 catalog，
并在 caller 的 Owner transaction 中重新解析准确 stored `ReferenceFactCatalogV1` entry，同时解析准确已准入
Source Binding。Latest/current-head lookup 只验证已解析 entry 的 lineage position，绝不参与选择。Native
typed business value 从该 catalog entry 派生并与之逐字节匹配；caller proposal 不能提供或覆盖该值。一个
已验证 `ReferenceFactCoordinatesV1` 只作为 observation evidence，绝不是 business-value 或 lineage authority。

每条 native fact 拥有自身 lineage root、正 native correction sequence、可选 native predecessor 与 current
native head。Native lineage root 准确等于 catalog scope identity；该 scope 只标识一个 native fact key：
`(calendar identity, civil day)`、`(time-zone identity, ruleset identity)` 或 `(session identity,
trading day, interval ordinal)`。它既不从 Source Binding lineage coordinate 派生，也不与其比较。Native predecessor
始终是同一 native fact key 与 domain 的紧邻前一 fact identity，绝不是
catalog entry identity。Catalog 与 native correction sequence 一一对应。Genesis 时两个 sequence 均为 `1`
且两个 predecessor 都不存在。每个 sequence 大于 `1` 的 correction 必须同时具备两个 predecessor，native
fact 的 catalog entry 必须指明 catalog predecessor，并且前一 native fact 必须绑定该准确 catalog
predecessor；即使属于同一 revision，catalog entry hash 与 native fact hash 仍然不同。Predecessor 缺失、
branch、cycle、sequence gap 或 regression、cross-source splice、effective overlap/gap、请求 coverage 不完整、
clock mismatch 或 observation 过期，都在任何 write 前失败。Positive fact、完整 cut、receipt 与 move-only
readback 没有 public constructor/deserializer。公共 caller 只能取得不受信 sealed locator；resolver 由
crate sealed。

Version 1 整数均为 big-endian，可选 tag 准确为 `0x00`/`0x01`，boolean 为 `0x00`/`0x01`，identity/digest
均为 32 bytes。每个 artifact identity 都是 listed NUL-terminated domain 加准确 bytes 的 BLAKE3-256。
每个权威的 receipt bytes 均为 schema `u16BE = 1`、reserved `u16BE = 0`、request identity、
request-meaning digest、cut identity/digest、store-generation identity、正 append sequence `u64BE`、stable
correlation。Receipt identity 因此绑定 generation，并对其 receipt domain 加上述准确 bytes 做 hash。
Outbox identity 与该 receipt identity 完全相同；它没有独立 domain 或 hash，payload 是准确 receipt bytes。
Readback bytes 为 schema、reserved、正 fact count `u32BE`、按 cut 顺序的
每条 fact identity、`u32BE` length 与准确 bytes，随后是 cut identity/length/bytes、receipt
identity/length/bytes 与 outbox identity。Unknown tag、零 required identity、duplicate 或非规范顺序、
malformed length 与 trailing byte 均不受支持。

一个 caller-owned transaction 原子 append 不可变 fact/head row、完整 cut、receipt、outbox 与
generation/append state。准确 identity/meaning replay 会 rejoin 并重新验证完整 stored aggregate；meaning
变化产生 conflict。Partial custody、canonical/scalar drift 或 dependency splice 使 custody 不可信。
Response loss 通过准确 sealed locator 恢复，并在不再次 append 的情况下返回逐字节相同 readback。Table
与 schema 不向 runtime 授权；`PUBLIC` 无任何 privilege；只接纳固定、non-grantable 的 Owner/writer 与
准确 non-grantable reader `EXECUTE` manifest。任何 validation、ACL 或 recovery failure 均写入零 row。

**NOT_ADMITTED：** 这些契约不声称 implementation、migration、store admission、已注册 product
composition、provider authenticity、production/default write、deployment、Dashboard 工作、runtime 或
trading。

### Calendar V1：完整 day/open 权威

`CalendarFactV1` value 是准确 calendar identity `u32BE length || bytes`、从 `1970-01-01` 起算的 signed
UTC civil-day ordinal `i32BE`，以及 `is_open` `u8`。Fact domain 为
`vibe.market-data.calendar-fact.v1\0`；schema 与 reserved 之后的 bytes 是上述从 catalog 派生的完整 value、
准确 catalog entry identity `[u8; 32]`、native lineage root、native correction sequence `u64BE`、可选 native
predecessor、effective-from 与可选 effective-until `i128BE`、provider-available、retrieval、
correction-publication 与 Owner-observation `i128BE`、decision cut `u64BE`、R0 coordinate identity/digest、
Source Binding identity/fact digest/lineage root/`u64BE` version，以及 source/correction frontier digest。

Request-meaning domain 为 `vibe.market-data.calendar-request.v1\0`；bytes 是 schema、reserved、closed
consumer tag（`1 PIT`、`2 INSTRUMENT_MASTER`、`3 REPLAY_V2`、`4 BAR`）、calendar identity、inclusive
first 与 exclusive last day `i32BE`、Owner-observation、decision cut、各自按
`u32BE length || bytes` 编码的 Source Binding 与 R0 locator bytes，以及 stable correlation。Cut domain 为
`vibe.market-data.calendar-cut.v1\0`；bytes 是 schema、reserved、request identity/meaning、consumer tag、
calendar identity、day bound、Owner-observation、decision cut、R0 cut identity/digest、expected-day count
`u32BE`，随后是请求中每个 civil day 准确一项、按 day 排序的 fact identity/digest，再随后是 gap count
与排序后的 missing day ordinal。Positive 表示 gap 为零、day 不重复且 open/closed disposition 完整；空
range 无效。Receipt 与 readback domain 分别把 `calendar-cut` 替换为 `calendar-receipt` 与
`calendar-readback`，版本均为 `v1\0`；outbox identity 按共享原生规则等于 receipt identity，且没有 domain。

### Time Zone V1：完整 UTC-offset transition 权威

`TimeZoneFactV1` value 是准确 time-zone identity 与 ruleset identity（`u32BE length || bytes`，随后
`[u8; 32]`），再加 signed UTC offset seconds `i32BE`。其半开 effective interval 是该 offset 保持不变的
UTC interval。Ruleset transition 是不可变 successor；相邻 before/after interval 在 offset 减小时确定
local fold，在 offset 增大时确定 gap，因此两种情形都不得被猜测或 normalize away。

Fact domain 为 `vibe.market-data.time-zone-fact.v1\0`；bytes 是 schema、reserved、上述从 catalog 派生的
完整 value、准确 catalog entry identity `[u8; 32]`、native lineage root、native correction sequence、可选
native predecessor，随后是按相同顺序排列的 Calendar 所定义 effective、observation 与准确 R0/Source
Binding/frontier tail。Request-meaning domain 为
`vibe.market-data.time-zone-request.v1\0`；bytes 是 schema、reserved、consumer tag、time-zone identity、
ruleset identity、replay-window start 与 exclusive end `i128BE`、Owner-observation、decision cut、
length-prefixed Source Binding 与 R0 locator bytes，以及 stable correlation。Cut domain 为
`vibe.market-data.time-zone-cut.v1\0`；bytes 是 schema、reserved、request identity/meaning、consumer tag、
time-zone/ruleset identity、window bound、Owner-observation、decision cut、R0 cut identity/digest、transition
count `u32BE`、按 interval start 排序的 fact identity/digest entry，随后是 gap count 与排序的半开 gap
bound。Positive coverage 在 window start 或更早开始、在 window end 或更晚结束，并以准确相邻 interval
覆盖每个 instant 且每个 instant 只有一个 offset，包括 fold 与 gap。Receipt 与 readback domain
分别为 `vibe.market-data.time-zone-receipt.v1\0` 与 `vibe.market-data.time-zone-readback.v1\0`；outbox identity
按共享原生规则等于 receipt identity，且没有 domain。

### Session V1：唯一原生 Calendar 与 Time Zone join

**CURRENT：** Replay V2 已有 typed Session value，BAR V1 已有既存 structural bytes，但两者都不是原生
Session join 或权威。**TARGET：** Session 是准确 positive 且相互独立的 `CalendarCutV1` 与
`TimeZoneCutV1` 在一个 Market Data transaction 中的唯一原生 join；同一 transaction 还解析已准入
Source Binding、准确 Instrument Master
reference tuple 与已验证 Shared Time observation。其唯一 raw resolver consumer 是
`MARKET_DATA_OWNER_V1`；内部 PIT、Replay 与 additive BAR composition 可以消费它，而 Backtest 与
Strategy Factory 只能接收 sealed projection。Caller 字符串、UTC endpoint、nearest transition 或 private
proposal 都不能铸造 session fact。Gap local time 没有 positive fact，且绝不 shift。
**NOT_ADMITTED：** 本契约不声称 Session implementation、native store、已注册 composition、product
reachability、production write、deployment、runtime 或 trading。

`SessionFactV1` 绑定非空 stable session identity、从 `1970-01-01` 起算且采用 proleptic Gregorian
calendar 的 signed `i32BE` trading day，以及从零开始连续的 interval ordinal `u32BE`。每个 local boundary
是 local day `i32BE`、nanoseconds-of-day `u64BE < 86_400_000_000_000`，以及 resolution tag `u8`：
`1 EXACT`、`2 EARLIER_INSTANT` 或 `3 LATER_INSTANT`。唯一 local time 要求 `EXACT`；fold 要求经认证的
earlier/later choice，并依据准确 Time Zone transition 重新计算。Leap-second spelling 与每个 gap boundary
均不受支持。Fact 重复 recomputed UTC open/close `i128BE`，要求 `open < close`，并绑定准确 Calendar
fact/cut identity/digest、Time Zone open/close boundary fact identity/digest 加 cut identity/digest、Instrument
Master reference tuple、Source Binding identity/lineage、source/correction frontier、correction identity 与完整
R0 observation coordinate。从 catalog 派生的 typed business value 与准确 entry 逐字节匹配；每个派生 UTC
与 dependency scalar 都从 join 的原生 fact 重新计算。

Fact domain 为 `vibe.market-data.session-fact.v1\0`；bytes 是 schema `u16BE = 1`、reserved、session
identity `u32BE length || bytes`、trading day、interval ordinal、local-open tuple 与 local-close tuple，作为从
catalog 派生的完整 typed business value；随后是准确 catalog entry identity `[u8; 32]`、native lineage root、
重算 UTC open、UTC close、Calendar fact identity/digest 与 cut identity/digest、Time Zone open fact
identity/digest、close fact identity/digest 与 cut identity/digest、Instrument Master readback/fact/cut digest、
可选 native predecessor、native correction sequence `u64BE`、provider-available、retrieval、
correction-publication 与 Owner-observation `i128BE`、decision cut `u64BE`、R0 coordinate identity/digest、
Source Binding identity/fact
digest/lineage root/`u64BE` version、source frontier、correction frontier 与 correction identity。Correction
是准确 `(session identity, trading day, interval ordinal)` native key 的不可变 current-head direct successor。

Request-meaning domain 为 `vibe.market-data.session-request.v1\0`；bytes 是 schema、reserved、固定 raw
consumer tag `1 MARKET_DATA_OWNER_V1`、session identity、inclusive first/exclusive last trading day、准确
Calendar 与 Time Zone cut locator、Instrument Master reference locator、按 length-prefixed bytes 编码的
Source Binding 与 R0 locator、Owner-observation、decision cut 与 stable correlation。Cut domain 为
`vibe.market-data.session-cut.v1\0`；bytes 是 schema、reserved、request identity/meaning、consumer tag、
session/day scope、Calendar 与 Time Zone cut identity/digest、Instrument Master reference tuple、
Owner-observation、decision cut、R0 cut identity/digest、day count `u32BE`，随后是每个顺序 day 及其
open/closed tag、interval count 与 interval-ordinal/fact-identity/fact-digest entry，再随后是 gap count 与
missing-day ordinal。Open day 包含从零开始的完整连续 ordinal set；closed day 具有显式 zero-member
census。因此 all-closed window 可以有 positive explicit empty-fact cut。Duplicate key、ordinal gap、UTC
interval overlap、requested day 缺失，或 declared open schedule 内存在 interval gap，都不产生 positive
cut。

Receipt 与 readback domain 为 `vibe.market-data.session-receipt.v1\0` 与
`vibe.market-data.session-readback.v1\0`；outbox identity 等于 receipt identity、没有 domain，并采用
共享原生 write-once、sealed rejoin/recovery、ACL 与 zero-write rule。Replay V2 保留其既有 Session bytes，BAR V1
保留其既有 bytes；采用原生 Session 需要 additive dependency/aggregate field 与 additive BAR successor
contract，绝不重新解释 stored Replay V2 或 BAR V1 custody。

## Market Semantics Owner 契约

### 状态、边界与固定消费者

**CURRENT：** Market Data 架构拥有 Market Semantics Compatibility；`ReplayMarketFactsV2` 已具备下文所述
closed typed Market Semantics value。Source Binding 仍只把 free-form normalization 与 meaning 字符串作为
不受信 source claim 携带；Source Binding admission、字符串相等，或 PIT/Instrument Master 携带的 digest
本身都不能认证 typed Market Semantics。

**CURRENT：** Market Data 已有一个独立 `MarketSemanticsFactV1` 权威 foundation。其首个固定消费者是 Strategy Input
Binding Registry；`ReplayMarketFactsV2` 随后把同一个 Owner readback 作为确定性 projection 消费。不受信
proposal 只能携带 request identity/meaning、stable correlation、声称的 typed value、声称的 predecessor
与 dependency locator；不得提供 positive fact、coordinate、cut、canonical bytes、digest 或 receipt。
Market Data 私下解析已准入的原生 Source Binding readback、准确原生 PIT Snapshot 与 Instrument Master
readback，以及准确且经 Owner 认证的 `ReferenceFactR0ReadbackV1`；随后解析由 Market Data
拥有的 closed registry entry，该 entry 把这些准确 dependency identity 映射到 typed semantic value。
Free-form Source Binding 字符串、adapter label、provider field、caller mapping 与名称相似性绝不选择或
认证 registry entry。

Positive resolver 只接收不受信 proposal。它规范解码准确 PIT、Source Binding、Instrument Master 与 R0
locator，在 caller transaction 中解析四份 Owner readback，派生 closed registry key，并仅按该 key 解析一条
immutable registry record。Registry-key domain 为
`vibe.market-data.market-semantics-registry-key.v1\0`；bytes 为 schema、reserved、compatibility-scope
identity、R0 record identity/digest 与 cut identity/digest、PIT snapshot identity/fact digest、Source Binding
identity/fact digest/lineage root/`u64BE` version、Instrument Master readback/fact/cut digest、source frontier
与 correction frontier。Registry-record domain 为
`vibe.market-data.market-semantics-registry-record.v1\0`；bytes 为 schema、reserved、key identity、`u32BE`
key length 加准确 key bytes、五个 typed value field，以及 correction identity。Key identity 是私有 table
primary key，record identity 是准确 record bytes 的 BLAKE3 digest。Zero、many、missing、canonical drift、
dependency splice 或 value mismatch 均 unavailable/untrusted；不准按 name、value、scope、latest 或 history
lookup。Test-only seal 不是 production positive path。

**NOT_ADMITTED：** 本契约不声称 provider ingestion/authenticity、default 或 production database migration/write、Strategy Input Registry 或 Replay V2 产品 composition、
deployment、runtime execution、Dashboard 工作或 trading authority。Fixture、caller-carried identity、
结构有效的 bytes 或既有 Replay V2 fact 都不是独立 Owner readback。

### 有类型事实、时间与修正拓扑

Version 1 的 closed value 准确包含：非零 normalization identity `[u8; 32]`；price adjustment `u16BE`，
其值为 `1 RAW`、`2 SPLIT_ADJUSTED` 或 `3 TOTAL_RETURN_ADJUSTED`；timestamp basis `u16BE`，其值为
`1 EVENT_EFFECTIVE`、`2 INTERVAL_OPEN` 或 `3 INTERVAL_CLOSE`；非零 price-unit identity `[u8; 32]`；
以及非零 size-unit identity `[u8; 32]`。零值与所有未列出 tag 均不受支持。Unit identity 命名
Owner-registry meaning，而不是 unit 字符串、currency default、scale 猜测或 Instrument Master increment
field。

每条不可变 fact 绑定一个 Owner-registry compatibility-scope identity、可选的准确 predecessor、一个半开
effective interval `[effective_from, effective_until)`、provider-available、retrieval、
correction-publication 与 Owner-observation coordinate，以及正 decision cut。它还绑定准确 R0 coordinate
identity/digest、准确已准入 PIT Snapshot、Source Binding 与 Instrument Master identity/digest、Source
Binding lineage、source/correction frontier 与 correction identity。所有重复 coordinate scalar 必须与解析
所得 `ReferenceFactR0ReadbackV1` 逐字节一致；该独立权威不创建第二 clock 或 coordinate authority。
Effective containment 与 observation availability 是相互独立的 predicate。每个 availability coordinate
都必须在同一 authenticated clock 与 decision cut 下可观察。

Correction 是同一 compatibility scope 内的不可变 direct successor。它指向 current predecessor，推进经
认证的 correction/observation evidence，并可保留被修正的 effective interval；绝不重写 predecessor，也
不会让 predecessor 在更早 cut 上失效。不同 effective regime 不得重叠。Predecessor 缺失、branch、cycle、
ambiguous overlap、coordinate/frontier 回退，或在更早 observation cut 选择更晚 correction，都不产生
positive fact 或 cut。

### 规范 codec、完整 cut 与 custody

Version 1 的每个整数均为 big-endian。可选 absence/presence 准确为 `0x00`/`0x01`；每个 identity/digest
均为 32 bytes；reserved 为 `u16BE = 0`；malformed length、零 required identity、alternate tag、duplicate、
非规范顺序或 trailing byte 均不受支持。Identity 是在下列 NUL-terminated domain 后拼接准确 canonical
bytes 所得的 BLAKE3-256。

- Request-meaning domain 为 `vibe.market-data.market-semantics-request.v1\0`；bytes 顺序为：schema
  `u16BE = 1`、reserved、consumer tag、compatibility-scope identity、可选 predecessor、按 fact 顺序排列的
  五个 typed value field、effective-from、可选 effective-until、Owner-observation、decision cut，随后是 PIT
  Snapshot、Source Binding、Instrument Master 与 R0 的不受信 locator bytes；每项均为
  `u32BE length || bytes`；最后是 stable correlation。Request identity 是独立 idempotency key，不属于
  request meaning。
- Fact domain 为 `vibe.market-data.market-semantics-fact.v1\0`；bytes 顺序为：schema `u16BE = 1`、
  reserved、compatibility-scope identity、可选 predecessor、normalization identity、price-adjustment tag、
  timestamp-basis tag、price-unit identity、size-unit identity、effective-from `i128BE`、可选
  effective-until、provider-available `i128BE`、retrieval `i128BE`、correction-publication `i128BE`、
  Owner-observation `i128BE`、decision cut `u64BE`、R0 coordinate identity 与 digest、PIT Snapshot identity
  与 fact digest、Source Binding identity、fact digest、lineage root 与 `u64BE` lineage version、Instrument
  Master readback/fact/cut digest、source frontier、correction frontier 与 correction identity。
- Cut domain 为 `vibe.market-data.market-semantics-cut.v1\0`；bytes 为 schema、reserved、request identity、
  request meaning digest、closed consumer tag（`1 STRATEGY_INPUT_BINDING_REGISTRY_V1`、
  `2 REPLAY_MARKET_FACTS_V2`）、compatibility-scope identity、effective instant `i128BE`、Owner-observation
  `i128BE`、decision cut `u64BE`、R0 cut identity 与 digest、expected-member count `u32BE`、按 scope 严格
  排序且由 scope identity 加 fact identity/digest 组成的 entry，随后是 gap count `u32BE` 与严格排序的
  gap-scope identity。Positive cut 具备完整 expected manifest 且 gap 为零；显式空 manifest 不是推断的
  success。
- Receipt domain 为 `vibe.market-data.market-semantics-receipt.v1\0`；bytes 为 schema、reserved、request
  identity、request meaning digest、consumer tag、cut identity/digest、store-generation identity、正 append
  sequence `u64BE` 与 stable correlation。Receipt identity 是该 domain 加准确 receipt bytes 所得且绑定
  generation 的 BLAKE3-256。Outbox identity 与 receipt identity 完全相同，没有独立 domain 或 hash，且其
  payload 是准确 receipt bytes。
- Readback domain 为 `vibe.market-data.market-semantics-readback.v1\0`；bytes 为 schema、reserved、正 fact
  count `u32BE`、按 cut 顺序排列的每条 fact identity 及其 `u32BE` byte length 与准确 fact bytes，随后是
  cut identity、length 与 bytes，receipt identity、length 与 bytes，以及 outbox identity。Positive fact、
  cut、receipt 与 move-only readback 没有 public constructor 或 deserializer；resolver 由 crate sealed。

一个 Owner transaction 原子 append 不可变 fact/head、完整 cut、receipt、outbox 与 store
generation/append state。准确 request identity 加准确 meaning 是 idempotent；meaning 变化产生 conflict；
partial row、scalar/canonical drift、dependency splice 或 digest mismatch 使 custody 不可信。Response loss
绝不授权再次 append：recovery 只接受准确 identity/meaning locator，重新验证完整 stored aggregate，并返回
逐字节相同的 move-only readback。

既有 `ReplayReferenceFactValueV2::MarketSemantics` 是从已验证独立 readback 的五个 typed value field
得到的确定性 projection。Replay V2 保留自己的 aggregate fact/cut identity，并且只有在其 time、scope、
source 与 correction projection 与该 readback 逐字节相等后才重复这些 projection。它既不替换独立 fact，
也不会成为第二个 Market Semantics authority。

## Correction Policy 私有 Replay projection

**CURRENT：** Source Binding 拥有 correction lineage/frontier，Replay V2 已有 typed `CorrectionPolicy`
value。**TARGET：** Market Data 从准确已准入 Source Binding lineage 加已验证
`ReferenceFactCoordinatesV1` 为 Replay 确定性派生该 value；不存在独立 Correction Policy receipt、
outbox、state、locator 或 resolver。**NOT_ADMITTED：** caller 字符串、通用 policy label、单独 frontier
digest 或 Replay storage 都不能铸造 policy authority；该 projection 也不声称 implementation、provider
authenticity、production write、deployment 或 trading authority。

私有 version-1 value 是准确非空 correction-stream identity、正 `u64BE` sequence 与
`successor_only = 0x01`；false 与所有 alternate tag 均不受支持。它还绑定准确 Source Binding
identity/fact/lineage、correction-frontier digest identity、不同 frontier change 之间的一个半开 effective
interval，以及第一个已准入 version 的 provider-available、retrieval、correction-publication、
Owner-observation、decision cut、clock 和 R0 coordinate identity/digest。第一个 lineage version 建立
availability；即使其 R0 record 使用有限 replay/evidence interval，该 correction regime 仍保持开放，只有
不同 successor frontier 才能关闭它。随后携带逐字节相同 source、stream、sequence、successor-only value
与 frontier 的 version
被 coalesce 到同一 interval，且不能把 availability 提前。下一个不同 frontier 关闭前一个 interval，且
必须是 direct、sequence-advancing successor。Gap、regression、branch、cross-source splice、stream 改变却
无新 lineage，或 clock/coordinate mismatch，都不产生 projection。

确定性私有 projection domain 为 `vibe.market-data.correction-policy-projection.v1\0`。Canonical bytes 是
schema `u16BE = 1`、reserved、stream `u32BE length || bytes`、sequence、successor-only tag、Source
Binding identity/fact digest/lineage root/`u64BE` version、correction-frontier digest、effective-from 与可选
effective-until `i128BE`、四个 availability/observation coordinate `i128BE`、decision cut `u64BE`、
clock-head identity/digest 与 R0 coordinate identity/digest。Replay V2 只把 stream、sequence 与
successor-only 投影到既有 typed value，并且仅在 time/source/correction field 准确相等后重复这些 field；
其 aggregate custody 不创建第二 policy authority。

## Corporate Action 原生 Instrument Master 子权威

### 状态、输入与 typed action

**CURRENT：** Instrument Master 拥有 corporate-action term/frontier，Replay V2 已有 closed Split、
CashDividend、SymbolChange、Expiry 与 Roll variant，但尚无独立原生 Corporate Action readback。
**TARGET：** Instrument Master 是 `CorporateActionFactV1` 的唯一 writer；固定消费者是 Replay V2 与
Backtest。签发在一个 Owner transaction 中解析准确 positive Instrument Master cut/fact、已准入 Source
Binding、PIT Snapshot、shared-clock observation、correction frontier 与 `ReferenceFactCoordinatesV1`。
Caller digest、symbol、latest row 或 Replay fact 均不得替换它们。**NOT_ADMITTED：** 本契约不声称
implementation、provider ingestion/authenticity、production/default migration/write、product composition、
deployment、runtime、Dashboard 或 trading authority。

每条 fact 绑定一个非零 action identity、准确 canonical instrument bytes 与一个 closed term：

- `1 SPLIT`：正 numerator 与 denominator `u64BE`。方向固定为 post-action quantity 等于 pre-action
  quantity 乘 numerator/denominator，post-action price 等于 pre-action price 乘 denominator/numerator；
  reversal 或隐式 vendor convention 不受支持。
- `2 CASH_DIVIDEND`：signed `i128BE` mantissa、`u8` decimal scale 与非空 canonical currency identity。
- `3 SYMBOL_CHANGE`：非空 successor canonical instrument；predecessor instrument 保留为历史事实。
- `4 EXPIRY`：无 payload。
- `5 ROLL`：非空 successor canonical instrument；只记录 reference transition，不授予 order。

Fact 还绑定可选 direct predecessor、一个半开 effective interval、四个 availability/observation
coordinate、decision cut、R0 coordinate identity/digest、准确 Instrument Master readback/fact/cut digest、
PIT Snapshot identity/fact digest、Source Binding identity/fact/lineage/version、source/correction frontier 与
correction identity。Correction 是同一 action/instrument lineage 内不可变 current-head successor，不能重写
更早 observability。Predecessor 缺失、branch、cycle、sequence/frontier regression、action 或 instrument
splice、无效 ratio/currency/successor、effective ambiguity 或 clock mismatch，都在 write 前失败。

### 规范完整 census 与 custody

Fact domain 为 `vibe.market-data.corporate-action-fact.v1\0`。Bytes 是 schema `u16BE = 1`、reserved、
action identity、instrument `u32BE length || bytes`、上述顺序的 term tag 与 payload、可选 predecessor、
effective-from 与可选 effective-until `i128BE`、provider-available、retrieval、correction-publication 与
Owner-observation `i128BE`、decision cut `u64BE`、R0 coordinate identity/digest、Instrument Master
readback/fact/cut digest、PIT Snapshot identity/fact digest、Source Binding identity/fact digest/lineage root/
`u64BE` version、source frontier、correction frontier 与 correction identity。

Request-meaning domain 为 `vibe.market-data.corporate-action-request.v1\0`；bytes 是 schema、reserved、
closed consumer tag（`1 REPLAY_V2`、`2 BACKTEST`）、inclusive/exclusive replay-window bound `i128BE`、正
instrument count `u32BE`、严格排序的 length-prefixed canonical instrument、Owner-observation、decision
cut、length-prefixed Instrument Master、PIT、Source Binding 与 R0 locator bytes，以及 stable correlation。
Cut domain 为 `vibe.market-data.corporate-action-cut.v1\0`；bytes 是 schema、reserved、request
identity/meaning、consumer tag、window bound、Owner-observation、decision cut、R0 cut identity/digest、
Instrument Master 与 PIT cut digest、instrument count，随后是每个排序 instrument 及 action count 和按
effective start 与 action identity 排序的 action-identity/fact-digest entry，再随后是 gap count 与排序的
gap instrument。每个 requested instrument 准确出现一次。零 action 是该 instrument 的 canonical
`u32BE = 0` census，而不是 missing row 或 `NO_ACTIONS`；positive cut 的 gap 为零。

Receipt 与 readback domain 为 `vibe.market-data.corporate-action-receipt.v1\0` 与
`vibe.market-data.corporate-action-readback.v1\0`；outbox identity 等于 receipt identity，且没有 domain。
其准确 layout、write-once caller-transaction custody、sealed resolution、rejoin、response-loss recovery、ACL
与 zero-write failure rule 采用上述共享原生规则。
Replay V2 把一条 fact 一对一 projection 成既有 action identity、instrument 与 term variant，并且只在
time/source/correction 准确相等后重复这些 field。Backtest 保留相同原生 fact 与 cut identity/digest；
两个 consumer 都不得 normalize 或 synthesize term。

## Replay Market Facts V2 基础

**CURRENT / PARTIAL：** Market Data 定义了 additive、dependency-neutral 的
`ReplayMarketFactsV2` contract 与规范 codec。一个完整 cut 包含有类型且内容寻址的 calendar-day、
session-interval、time-zone ruleset、Market Semantics、successor-only correction-policy、
corporate-action 与 historical-membership 事实。每条事实绑定半开 effective interval、
provider-available、retrieval、correction-publication、Owner-observation、decision cut、Source identity
与 correction identity。Corporate action 携带实际 split、cash-dividend、symbol-change、expiry 或 roll
条款；historical membership 携带准确 selection、member、instrument 与 inclusion disposition。
Corporate-action 或 membership cut 可以完整地包含零个 member，但该空 census 必须是绑定准确 scope
与 decision cut 的显式内容寻址 cut；`NO_ACTIONS` 等字符串绝不等价。

V2 frontier 仅通过各 producer 的准确 identity 与 digest 引用既有 PIT Snapshot、Source Binding、
Instrument Master cut、Universe Selection、normalized observation census、V1 joined-cut receipt 与 V2
sample projection；不复制或重新解释其规范 bytes，也不创建第二权威。公共 request 只接受一个不受信
PIT locator 与半开 replay event-time interval。事实、dependency reference、census、规范 bytes 与
aggregate digest 只能通过 Market Data-private authority 进入。所得 receipt 与 readback 没有 public
constructor 或 deserializer，read port 由 crate sealed。校验会重新编码每条 fact、cut、frontier、
aggregate 与 receipt，并逐字节比较全部重复 scalar projection；canonical-byte、scalar-only 或
cross-splice 漂移都 fail closed。

**CURRENT/PARTIAL，W0/U/C custody seam：** 规范 DTO/codec、私有签发权威与 sealed readback 已实现。
Replay storage leaf 还具备 candidate-private PostgreSQL schema 与 caller-transaction storage；它只机械持久化已经验证的
readback，拒绝 identity/meaning conflict 与 corruption，并且只暴露负向 resolution，stored bytes 不能铸造
positive readback。U 增加 caller-transaction historical-membership 与原生 Universe Selection custody。C
增加完整 observation census 及其准确、未改变 V1 joined-cut receipt 的 caller-transaction custody。这些 leaf
不会自行打开或提交 pool，尚未注册为 positive product composition，也不会把 opaque dependency locator
提升为 Owner authority。

**CURRENT/PARTIAL，W3 positive composition binding：** Market Data 定义 additive sealed
`ReplayCompositionBindingV1` record、receipt、准确 receipt-payload outbox，以及一个不受信的内容寻址 locator。
其 canonical identity 交叉绑定准确 PIT request/snapshot 与 replay window、一个经过认证的
`StrategyDesignV2` identity、排序且完整的 typed-role set、durable registry 的每条 declaration 与 binding、
完整 observation census、未改变的 V1 joined cut、V4 JOINED_CUT sample projection，以及准确原生 PIT、Source
Binding、Universe Selection、Instrument Master 与 Market Semantics locator。W3 绝不接受 V2 或 V3 代替 V4
JOINED_CUT。Additive
`UntrustedReplayMarketFactsCompositionRequestV1` 只包含既有 Replay V2 request 与该准确 binding locator。
Positive issuance 从该 locator 开始，认证并逐字节验证完整 binding，要求每个 native 与 role/binding
projection 准确一致，随后复用既有 Replay V2 issuer 及其未改变的 canonical bytes、readback 与七种类
frontier。Replay storage meaning 还由 binding identity 约束。既有 unbound row 仍仅可产生负向结果：绝不
backfill、infer、按 latest 选择或通过 full scan 发现。

**TARGET，持久 R&D attestation seam：** positive R&D Develop Composer transaction 将一份不可变、完整的
`StrategyDesignRoleSetReceiptV1` attestation 与 Composer aggregate、receipt 及 outbox 一起规范持久化。它绑定
准确 Research request、Composer aggregate 与
`StrategyDesignV2`、按规范顺序排列的 typed role、每个 semantic coordinate 与完整 role coverage。其内容寻址
准确 locator 在发送前已知。Replay Policy V2 composition 由 R&D-owned A1 跨两个 Owner-isolated transaction
协调。固定 `market_data_reader` 打开一个 read-only transaction，取得 Composer request 的 shared writer-key cut
lock，只调用 Composer Owner 按 locator 读取的 `SECURITY DEFINER` lock/read function，校验完整 canonical
evidence，并保持该 transaction 直到 Market terminal decision。随后 Market Data Owner 打开一个 SERIALIZABLE
transaction，证明两条连接共享同一 live primary、database、postmaster incarnation 与 advisory lock manager；固定
`market_data_owner` login principal 在任何 Market lock 或 write 前取得同一个 shared Composer cut lock。该
principal 只对自己的 `market_data_private` relation 保留 raw authority，不获得 Composer 或 R&D raw access。
Composer writer 在每次 mutation 前都必须持有匹配的 exclusive lock；因此 reader 丢失时，只要 Market
transaction 仍持有 handoff lock，就不能重新打开 mutation window。两个 principal 都不获得另一 Owner 的
raw-table `SELECT` 或 DML、role membership、generic query surface、public positive constructor/deserializer、
receipt/readback input、bearer token、cryptographic-key authority、latest/history/full scan 或 cross-Owner parser。
该边界保证 guarded window 内 Composer evidence 稳定以及 Market write 原子性；它不声称 shared XID、MVCC
snapshot 或 cross-Owner atomic commit。

W3 issuance 只接受该不受信 R&D attestation locator 与准确 Market dependency locator。Market Data 在内部校验
恢复的 attestation，随后独立重新解析每条持久 registry declaration、完整 observation census、未改变的 V1
joined cut、V4 BAR JOINED_CUT sample projection、R0 与独立 Market Semantics record，并要求 Market Semantics cut 指向准确恢复
的 R0 cut。它不消费 `StrategyPlanV2`，也不依赖 Strategy Factory。Binding record、receipt 与 receipt-payload
outbox 与未改变的 Replay V2 fact、receipt、outbox row 原子持久化；按准确 binding locator 的 recovery 会
decode、rehash、cross-check 两套 custody aggregate，并返回逐字节相同的 payload。response loss 后按准确
attestation locator recovery 会 join 既有 R&D attestation 而不 append。公共边界不接受 resolver、authoritative
receipt/readback、role list、count 或 token，且任何 caller representation 都不能铸造 positive role set。

**NOT_ADMITTED：** 该 target 不证明 R&D persistence/read function、其 database ACL、registered W3 composition、
disposable PostgreSQL Owner readback、deployment、production write、runtime 或 trading authority。

**TARGET：** admitted deployment 与隔离 disposable PostgreSQL acceptance 必须证明准确 replay、
response-loss recovery、successor-only
correction，以及 move-only Strategy Factory 与 Backtest consumer 路径。

**NOT_ADMITTED：** 已实现 storage、custody 与固定 API composition 不是 admitted store、隔离 PostgreSQL
acceptance、provider ingestion/authenticity proof、default product composition、Strategy Factory
或 Backtest consumer、runtime execution、production write、deployment 或 trading authority。它们不会把
既有准确二成员 Universe receipt 当作通用 Universe Selection Record，不会以 V2 codec 替换 V1 joined-cut
codec，也不允许 Source Binding rule string 或通用 `version = "v2"` 标签冒充规范 fact cut。

## Instrument Master Owner 契约

### Public Fact V2 原生 projection foundation

**CURRENT/PARTIAL：** `InstrumentMasterFactV2` 是 additive、无 effect 的 public-fact kernel，首个范围只
覆盖 crypto-perpetual native projection。它不重新解释或改变任何 V1 fact、cut、receipt、readback、database
grammar 或 stored byte。Fact 绑定规范 instrument/venue/raw-symbol identity、闭合 crypto-perpetual class、
准确 public contract term、direct predecessor 与正 correction sequence、原始 raw-snapshot provenance、
最新 raw-delta provenance、canonical bytes，以及 domain-separated content identity。

V2 identity 是 `BLAKE3-256("VIBE_INSTRUMENT_MASTER_PUBLIC_FACT_V2" || 0x00 || bytes)`。Bytes 使用
big-endian，依次从 schema `u16 = 2`、reserved `u16 = 0`、canonical identity、venue identity、raw symbol、
closed class、optional predecessor fact digest、correction sequence、baseline provenance、optional latest delta
开始，随后按声明的 struct order 编码完整 materialized term set。Text 是 `u32 length || UTF-8`，digest 为
32 bytes，optional tag 为 `0`/`1`，`FactValue` tag 依次为 `1 VALUE`、`2 UNBOUNDED`、
`3 NOT_APPLICABLE`、`4 UNAVAILABLE`，boolean 为 `0`/`1`，time 与 decimal mantissa 为 signed `i128`。
Unknown tag、nonzero reserved、trailing byte、超限 text/record、无效 UTF-8、zero provenance digest 或
non-canonical decimal 均被拒绝。

每个 public term 准确使用一个 `FactValue`：`VALUE`、`UNBOUNDED`、`NOT_APPLICABLE` 或
`UNAVAILABLE`。后三种状态互不相同，不得折叠成 `None`、zero、one、false 或其他 constructor default。
Decimal 使用 signed `i128` mantissa 加 `u8` scale 的最小 trailing-zero 表示，不使用 floating point。
Public fact 明确排除 maker/taker fee、initial/maintenance margin、account-specific commission schedule、
leverage bracket 与所有 execution-profile authority。

本 slice 唯一获准的 source composition 是一个 raw public `exchangeInfo` baseline，随后接零个或多个 raw
public `!contractInfo` delta。每个 artifact 都绑定准确已准入 Source Binding identity/digest 与 raw payload
digest。Delta 还绑定 canonical instrument、prior raw-event digest、紧邻下一 correction sequence、provider
event time、retrieval time、Owner observation time 与 field-wise patch。省略的 patch member 保留
baseline/materialized value；存在的 member 替换完整 `FactValue`，包括 non-value state。首版 delta grammar
只接纳 `!contractInfo` 携带的 public contract-status member；currency、inverse semantics、executable filter、
multiplier、lot 与 limit 仍由 baseline 拥有。Source、instrument、
raw predecessor、sequence 或 observation-time 不匹配时拒绝 successor。Provider `serverTime` 不是 event 或
provenance authority，不进入 fact。Price/quantity precision 与 increment 只能来自可执行 price/lot filter，
不得使用 display-precision field。Baseline `effective_from` 是独立于 `serverTime` 的明确 Owner-admitted
coordinate；native `ts_event` 使用该 coordinate 或最新 delta event time，`ts_init` 使用与之匹配的 Owner
observation。

`validate_native_crypto_perpetual_public_terms` 是唯一 V2 public/native validation constructor。其
`ValidatedCryptoPerpetualPublicTermsV2` 结果没有 public constructor，并绑定准确 fact、identity mapping、
Source Binding、baseline/latest raw provenance、correction sequence、timestamp 与完整 public structural
term。Contract status、inverse semantics、base/quote/settlement currency、filter-derived precision/increment、
contract multiplier、lot size 与每个 optional limit disposition 必须全部明确，否则 fail closed。
`UNBOUNDED` 或 `NOT_APPLICABLE` 可转换为明确 absent 的 optional limit；`UNAVAILABLE` 不可转换。Filter
precision 必须等于其准确 increment scale。Token 不含 maker/taker fee、initial/maintenance margin、
commission、leverage bracket 或 execution-profile authority，也不调用或构造 `InstrumentAny`。

Strategy Factory 仍是唯一 `ReplayExecutionProfileV1` 的 sole owner。后续 Strategy Factory composition
可以把这个 Market Data token 与其 private sealed Instrument Owner economic provenance 及该准确 execution
profile 组合。Market Data 不 import Strategy Factory，也不 validate、copy、hash、select 或 issue replay
economic value。

**NOT_ADMITTED：** V2 当前不声称 provider parser/call、authenticated ingestion、durable storage/migration、
V2 cut/receipt/readback、product composition、database write、deployment、production effect 或 trading。
本 slice 不实现或声称后续 Strategy Factory combination。

### 状态与固定消费者

**CURRENT/PARTIAL：** Market Data 已实现下文描述的原生 `InstrumentMasterFactV1`、
`InstrumentMasterCutV1`、write-once receipt/outbox、move-only `InstrumentMasterReadbackV1`，以及面向准确
`BACKTEST_OWNER_V1` role 的 sealed PostgreSQL resolver/recovery 路径。PIT 与 Strategy Input 产品路径仍携带
request 提供的 `instrument_master_digest` 并与 Owner-verified batch 比对；代表性 Strategy Factory 路径仍冻结
data-Owner role 字符串与 AAPL/MSFT fixture。这些旧 provenance、role 与 mapping 路径不能替代原生权威，也
不证明产品已消费该权威。

**TARGET：** Backtest 产品直接消费既有 Owner-sealed resolution，并以它替换旧 digest 与硬编码 Strategy
Factory role/mapping 路径。R&D 声明研究 scope，Strategy compiler 消费该 resolution，但两者均不得直接
查询 Instrument Master storage、维护 symbol-to-instrument 或 venue mapping，也不得合成 resolution。

**NOT_ADMITTED：** 本状态不声称 provider ingestion/authenticity、production migration、
production/default database write、deployment、Dashboard 工作、Backtest 动态产品验收、inverse/quanto
target-consumption 语义或交易。只要准确 Instrument Master evidence 支持 canonical fixed/session bar，BAR
custody 本身不区分 instrument class。caller-carried digest、看似规范的字符串、静态 fixture、transport
success、仅 Owner test 或文档检查都不能声称产品闭合。

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

**TARGET，durable Strategy Input Binding Registry：** Market Data 拥有 write-once、validated binding
declaration；每份 declaration 以准确 PIT request、`StrategyDesignV2` 与 typed input role 为 key。R&D 与
Strategy Factory 只能提供 Owner-authenticated Design/role intent，绝不提供或选择 member、frame 或 binding
digest。在一个 Market Data Owner transaction 中，registration 通过原生 authority 解析 PIT Snapshot、
Universe Selection、Source Binding、Instrument Master 与 Market Semantics，派生并存储 declaration/digest，
重新生成既有 V1 binding 与 frame，再原样运行既有 V1 complete-census 与 joined-cut authority。registry
registration 缺失，或 request/Design/role、membership、frame、lineage、semantics、digest 任一不匹配时，都不
生成 declaration、census、joined cut 或 replay input。该 registry 是 Replay V2 positive composition 与真实
Owner-driven Strategy Factory/Backtest consumption 的前置条件；它不是 provider registry、deployment registry
或 caller-authored data path。

**CURRENT/PARTIAL，authenticated role-set foundation：** dependency-neutral 的准确 Composer locator 与
`StrategyDesignRoleSetReceiptV1` DTO 已存在；production positive-registration seam 在接受未改变的 V1 request
前必须取得 authenticated complete role set。它校验请求的 Design、Research request、派生 role identity、每项
semantic coordinate 及准确完整的 role coverage。observation-census seam 同样要求未改变的 V1 join claim 在
complete-census/latest-not-after selection 前准确重复一个 authenticated join。既有 V1 request、binding、
receipt bytes 与准确 legacy recovery 均保持不变。**TARGET：** W3 只通过 R&D-owned、same-Composer-transaction
durable attestation 的准确 locator DB-ACL read function 接纳该 attestation，并让这条 seam 成为唯一可达的
positive path；Market Data 随后独立解析自身 registry、census、join、V4 sample、R0 与 Market Semantics authority，
再原子签发 binding。**NOT_ADMITTED：** caller-proposed Design/role/join 字段、receipt/readback/token、receipt
hash、latest/history/full scan、raw R&D table parsing 或 Market Data storage 都不能认证 Design meaning；Market
Data 不依赖 Strategy Factory，不拥有也不重新解释 Strategy Design role/join，且该 foundation 不声称 registered
W3 resolver 或 production write。

Market Data 只消费、但不定义也不重新解释 R&D Owner contract 中明确规定的 big-endian canonical binary
codec；其 JSON 表示不是 canonical receipt material。registration 必须通过固定 R&D adapter 取得
byte-identical 准确 locator recovery；独立重算、重排或修改的 bytes 即使 integrity hash self-consistent，
仍然只是 caller evidence。

**仅限 SEALED_ACCEPTANCE：** 非默认编译期 Cargo feature
`sealed-strategy-input-acceptance` 只暴露一个零参数 fixture adapter，语料固定为 AAPL/MSFT 与
OPEN/CLOSE。adapter 先经过 crate-private Source Binding admission 和 PIT
prepare/aggregate/verify 权威路径，再调用正常 universe-frame binder；它不接受 caller 选择的 row、
request、locator、digest、clock、provider、persistence 或 runtime selector。默认与生产 manifest 均不
启用该 feature；即使 release build 显式启用它，该 build 也仍是隔离 acceptance artifact，绝不是生产
build。此 fixture 只证明编译期验收拓扑，不证明 PostgreSQL custody、provider 连通性、已部署 Windmill
readiness、生产 composition 或任何交易权威。

### `ISOLATED_EVENT_REPLAY_ACCEPTANCE_V1`

**TARGET / ISOLATED_ACCEPTANCE_ONLY：** 这个被显式选择、由 request 驱动的 profile 授权最小动态 PostgreSQL
验收拓扑；它与上面的编译期 fixture 分离，绝不是默认或生产路径。只有在 Market Data 私有 Deployment
Store Admission custodian 消费 canonical management plane 在 repository、candidate、caller、consumer 与被测进程之外
预置的 immutable acceptance trust bundle 后，才可构造其 disposable PostgreSQL store。bundle 固定 environment、
signer key fingerprint、witness、credential-resolver 与 direct-measurer identity。分别执行的独立 principal 签发
signed append-only manifest/history 及其准确 current head、维护 anti-rollback witness、租赁 opaque least-
privilege credential handle、直接测量 target 并关闭 rotation fence；candidate/caller 不拥有 signer private key、
witness write authority、credential material 或 measurement authority。sealed admission receipt 交叉绑定 bundle
与每项 observation。signature、predecessor/generation、current-
head、rotation、endpoint/TLS/server/database、schema/migration/function/role/ACL、credential audience/version 与
measurement identity 必须在 repository 构造前和受保护 use boundary 再次校验时全部相等。custodian 将全部 raw
admission、credential、measurement、PIT、Source Binding、clock 与 head evidence 保留在 Market Data 内部。

输入是一个准确的 R&D Owner-issued 密封 request locator 与 receipt，绝不是 caller-authored request DTO。
Market Data 必须通过固定只读 R&D Owner port resolve 并验证 canonical request bytes digest Owner 请求者角色与
request identity；locator 标签或 Market Data 自己的证明都不充分。在一个 Market Data transaction 内，Owner
解析该 request，选择其准确 `EVENT` projection 与 native event receipt，并提交 request
到 projection/event locator 及 durable Owner readback。完全相同含义的 replay 返回逐字节相同 locator/readback
bytes；含义变化或同一 identity 不同 bytes 均冲突且零写入。restart 后解析该 locator 必须返回相同 canonical
request、projection、event identity 与 bytes。现有 Replay V2 的 `resolved_owner_inputs` content identity 只是
通用 content addressing，单独并不构成这项权威，也绝不能被静默重新解释。隔离路径必须新增一个版本化 Owner
binding receipt，在签发任何 resolver 之前交叉绑定 sealed R&D request identity、准确 Market Data projection
receipt digest 与 Owner-native event identity。
越过边界交给 Strategy Factory 或 Backtest composition 的唯一值
是针对该 request-selected event 的密封、只读 `StrategyInputSampleEventResolverV1` capability；insert、update、
delete、head advance、generic query、raw DSN、credential、admission receipt 或 evidence accessor 均不得越过
Owner 边界。

caller digest、DSN、fixture、fixed corpus、in-memory/temp-file writer，以及由 candidate、caller、consumer 或
被测进程派生的 signer/witness/credential/measurer 均不能铸造
request locator、resolver、event 或 readback。head、rotation、ACL、credential、measurement、request、role、
projection、event、locator 或 readback 任一缺失、过期、已取代或不匹配，都必须在 `ProgramHost` 或 Backtest
state mutation 前失败，且不产生正向 resolver 或 terminal result。成功证明只授权该 disposable profile；
production resolver、signer、anti-rollback witness、credential-resolver、direct-measurement adapter 与默认产品
入口仍保持 `UNAVAILABLE`。它不证明 provider authenticity、production readiness/deployment authority、
Dashboard、Paper、Live、real trading 或其他 production write。

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

### CURRENT/PARTIAL EVENT 与 BAR Owner custody；TARGET BAR 产品权威

Market Data 已实现版本化 `TimeframeSpecV1`、`TimeframeProjectionReceiptV1`、`SampleFactV1`、
`SampleReceiptV1`、其原生 exact-receipt resolver，以及 `POINT_EVENT` 的 durable PostgreSQL custody。代码还
还实现了 BAR schedule fact/cut/receipt/outbox/head state、已准入准确 schedule readback 与 V3 BAR FRAME
projection receipt 的 durable PostgreSQL custody。这些路径在 isolated dynamic PostgreSQL acceptance 通过后
属于 `CURRENT / PARTIAL` Owner 权威。sealed exact-digest V3 resolver core 同样属于 `CURRENT / PARTIAL`，
但固定 `STRATEGY_FACTORY_RD_OWNER_API_V1` production startup 仍会 fail closed，因为其 production admission
adapter 仍不可用。production startup 与产品或 composite 消费保持 `TARGET / UNAVAILABLE`。BAR 仍仅限完整 fixed-interval bar 与
exchange-session bar，partial bar 仍是
TARGET。Market Data 仍是所有已准入 record 的唯一 writer。所有既有 V1
binding、event、value、frame、joined-cut、row、digest 与 byte 含义继续保持权威且逐字节不变；不得删除、
合成、backfill、garbage-collect、reinterpret 或 promote 任何 V1 record。新增的
`StrategyInputSampleProjectionReceiptV2` 仍是 Owner fact 之上的 canonical EVENT FRAME 或 JOINED_CUT
projection，不是替代权威。不存在独立的 V2 event/value/frame/joined-cut codec；未改变的 V1
event/value/frame 与 joined-cut receipt 仍是准确 evidence input。V2 JOINED_CUT projection 与准确 locator
readback 在下述结构 Owner-custody seam 达到 `CURRENT / PARTIAL`；它们不证明 production startup 或产品消费。
BAR 只能使用下述独立 V3 FRAME projection；其 durable Owner custody 是 CURRENT/PARTIAL，而
其 sealed exact historical resolver core 是 CURRENT/PARTIAL，而 production startup 与产品 resolution 仍为
TARGET/UNAVAILABLE。它绝不扩大或重新解释 V2。新增 V4 FRAME/JOINED_CUT 与 BAR lifecycle 是
TARGET/NOT_ADMITTED，且绝不扩大或重新解释 V2 或 V3。

`TimeframeSpecV1` 只有一种 fixed canonical codec，字段顺序是：schema `u16LE = 1`、reserved-zero `u16LE`、
kind `u8`、正 step `u32LE`、unit `u8`、anchor identity `[u8; 32]`、calendar identity `[u8; 32]`、session
identity `[u8; 32]`、time-zone identity `[u8; 32]`、label-rule `u8`、partial-bar-rule `u8`；禁止 trailing
bytes。其 identity 是 `market-data.timeframe.identity.v1\0 || canonical TimeframeSpecV1 bytes` 的 SHA-256。
尤其是 `1d`
表示绑定 calendar、session 与 time zone 下的一个命名 exchange-session day，绝不表示 UTC-duration day 或
无 anchor 的 24 小时间隔。已接纳组合要求的任一字段缺失或含糊时，timeframe 必须 unavailable，consumer
不得填入 default。

tag registry 是封闭的。kind 只能是 `0x01 POINT_EVENT`、`0x02 FIXED_INTERVAL_BAR` 或
`0x03 EXCHANGE_SESSION_BAR`。unit 只能是 `0x00 NOT_APPLICABLE`、`0x01 SECOND`、`0x02 MINUTE`、
`0x03 HOUR` 或 `0x04 EXCHANGE_SESSION_DAY`。label rule 只能是 `0x00 EVENT_EFFECTIVE`、
`0x01 INTERVAL_OPEN` 或 `0x02 INTERVAL_CLOSE`。partial-bar rule 只能是 `0x00 NOT_APPLICABLE`、
`0x01 COMPLETE_ONLY` 或 `0x02 ADMIT_PARTIAL_AS_DISTINCT_SLOT`。全零 32-byte value 是唯一的
not-applicable identity；每个 applicable identity 都必须非零。

只有以下组合是 canonical：

- `POINT_EVENT` 要求 `step = 1`、`unit = NOT_APPLICABLE`、四个 identity 全零、
  `label = EVENT_EFFECTIVE`、`partial = NOT_APPLICABLE`；
- `FIXED_INTERVAL_BAR` 要求 `step > 0`，unit 为 `SECOND`、`MINUTE` 或 `HOUR`，anchor/time-zone identity
  非零；continuous clock 的 calendar/session identity 同时为零，schedule-bounded clock 的二者同时非零；
  label 为 `INTERVAL_OPEN` 或 `INTERVAL_CLOSE`，partial 为 `COMPLETE_ONLY` 或
  `ADMIT_PARTIAL_AS_DISTINCT_SLOT`；以及
- `EXCHANGE_SESSION_BAR` 要求 `step = 1`、`unit = EXCHANGE_SESSION_DAY`、四个 identity 均非零，label
  为 `INTERVAL_OPEN` 或 `INTERVAL_CLOSE`，partial 为 `COMPLETE_ONLY` 或
  `ADMIT_PARTIAL_AS_DISTINCT_SLOT`。

其他 tag、identity 零值组合、step/unit pair 或组合都 unsupported，且不生成 timeframe identity。
`ADMIT_PARTIAL_AS_DISTINCT_SLOT` 要求 partial observation 获得自己的 root slot identity，绝不能 replace
或 alias completed slot。每个 bar interval 都是在绑定 anchor/schedule 下的 half-open `[open, close)`；
`INTERVAL_OPEN` 使用 `open` 作为 event-effective time，`INTERVAL_CLOSE` 使用 `close`；`POINT_EVENT` 使用
source event-effective time。

首个 TARGET BAR slice 对 `FIXED_INTERVAL_BAR` 与 `EXCHANGE_SESSION_BAR` 只接受 `COMPLETE_ONLY`。规范
`ADMIT_PARTIAL_AS_DISTINCT_SLOT` codec 为后续 TARGET 保留，但本 slice 不准入其执行，且不生成 positive
projection、fact、receipt 或 resolver result。

既有 V1 binding 的 free-form timeframe string 仅是 provenance。它绝不解析成 typed schedule bytes，且对它
的修改不能改变 schedule identity、timeframe identity 或 series identity。caller 可以命名一个 untrusted 所需
BAR shape，但该 input 没有直接 projection 权威，也不能铸造、选择或改写 schedule、calendar、session、
time-zone、anchor、label、partial rule 或 instrument evidence。

结构 `BarScheduleFactV1` codec 支撑 CURRENT/PARTIAL durable PostgreSQL schedule 权威。其 canonical
bytes 按顺序为：schema `u16LE = 1`、reserved-zero `u16LE`、canonical instrument
`u16LE length || UTF-8 bytes`、predecessor-fact presence `u8` 并仅在 present 时后接 digest `[u8; 32]`、
effective-from `i128LE`、effective-until presence `u8` 并仅在 present 时后接 `i128LE`、kind `u8`、正 step
`u32LE`、unit `u8`、anchor/calendar/session/time-zone identity 各 `[u8; 32]`、label `u8`、completion `u8`、
Instrument Master readback/fact/cut digest 各 `[u8; 32]`、Market Semantics identity `[u8; 32]`、schedule
source/correction frontier 各 `[u8; 32]`，以及 cut-effective instant `i128LE`。absence/presence 只能是
`0x00`/`0x01`；trailing bytes、空 instrument、所需 identity 为零、unsupported tag combination，以及空或
倒置的 half-open effective interval 均被禁止。fact identity 与 digest 是
`market-data.bar-schedule-fact.v1\0 || canonical fact bytes` 的同一 SHA-256；不存在单独编码的 schedule
identity。Owner-local proposal 提供 effective interval、kind、step、unit、anchor、label 与 completion，但
它本身不能铸造权威。preparation 只接纳与一份准确原生 `InstrumentMasterReadbackV1` 交叉绑定的 BAR row；
Market Data 从该 readback 派生 calendar/session/time-zone identity，并拒绝 instrument、Market Semantics、
frontier、effective containment 或 Instrument Master mismatch。

结构 `BarScheduleCutV1` canonical bytes 按顺序为：schema `u16LE = 1`、reserved-zero `u16LE`、fact digest
`[u8; 32]`、同一 canonical-instrument variable bytes、effective instant `i128LE`，随后是 Instrument Master
readback/fact/cut digest、Market Semantics identity、source frontier 与 correction frontier，均为
`[u8; 32]`。effective instant 必须等于 selected BAR row 的 event-effective instant 与 Instrument Master cut
effective instant，且 schedule fact 与 Instrument Master fact 的 effective interval 都必须包含它。当前结构
codec 不编码 interval open/close 或 Owner observation/decision-cut coordinate；这些 predicate 保持
TARGET/PENDING，不能从该 cut 推断。cut identity 与 digest 是
`market-data.bar-schedule-cut.v1\0 || canonical cut bytes` 的同一 SHA-256。

结构 `BarScheduleReceiptV1` 恰好是 108 bytes：schema `u16LE = 1`、reserved-zero `u16LE`、fact digest、cut
digest 与 store-generation identity 各 `[u8; 32]`，再接正 store-append sequence `u64LE`。其 identity 与
digest 是 `market-data.bar-schedule-receipt.v1\0 || canonical receipt bytes` 的同一 SHA-256。
`BarScheduleReadbackV1` 以 schema `u16LE = 1`、reserved-zero `u16LE` 开始，随后对 fact、cut、receipt 依次
编码其 identity `[u8; 32]`、byte length `u32LE` 与 canonical bytes。其 identity 与 digest 是
`market-data.bar-schedule-readback.v1\0 || canonical readback bytes` 的同一 SHA-256；outbox identity 被定义为
等于 receipt identity。readback 没有 public constructor、`Clone` 或 deserialization path。当前 Owner 包含
BAR schedule fact、cut、receipt、outbox 与 head table；一个 atomic append/recovery 路径；固定的
`SECURITY DEFINER` 准确及历史 read；reader ACL；admitted capability issuance/revalidation；以及 public
startup resolver。逐字节相同 recovery 返回准确 stored readback，mismatch 或 tamper fail closed。这是
CURRENT/PARTIAL schedule custody 与 admitted read 权威，不是 Windmill、Backtest、composite 或其他产品
reachability。caller locator、结构 decode 或重建 bytes 都不产生 schedule 权威。

在 CURRENT/PARTIAL BAR schedule 路径中，只有具备 custody verification 的 readback 才能授权以准确 V1
binding-receipt digest 为键的新增 immutable `TimeframeProjectionReceiptV1`。其既有 canonical bytes 与 domain
保持不变：schema `u16LE = 1`、
reserved-zero `u16LE`、V1 binding-receipt digest `[u8; 32]`、timeframe identity `[u8; 32]` 与完整
fixed-width canonical `TimeframeSpecV1` bytes，SHA-256 domain 为
`market-data.timeframe-projection-receipt.v1\0`。同一 V1 digest 加逐字节相同 projection idempotent，不同
bytes conflict。schedule readback 缺失、含糊、不唯一或非 durable 时 unavailable。consumer 不得把 `1D`、
`1h`、其他 label、venue convention 或 default 解析成 spec。后续 Owner mapping/calendar 改变后仍可回读
准确 historical schedule 与 projection；这些改变必须形成新的 Owner schedule fact/cut，不能通过 free-form
binding label 偷渡。

`SampleFactV1`、`SampleReceiptV1` 与 308-byte coordinate 携带的 `Owner event identity` 是新增的
role-independent Market Data identity，并非既有 V1 frame-trigger event identity。其 canonical preimage 按顺序
为：schema `u16LE = 1`、reserved-zero `u16LE`、source snapshot identity `[u8; 32]`、source-snapshot fact
digest `[u8; 32]`、observation-batch digest `[u8; 32]`、canonical-row digest `[u8; 32]`、logical time
`u64LE`、event-effective time `u64LE`、provider-available time `u64LE`、retrieval time `u64LE`、
correction-publication time `u64LE`、Owner sequence `u64LE`、correction-stream
`u16LE length || bytes` 与 correction-frontier digest `[u8; 32]`。identity 是
`market-data.sample-event.identity.v1\0 || canonical preimage` 的 SHA-256 前 16 bytes；全零结果、其他
encoding 或不等于所引用 historical Owner row 的 coordinate 都 unsupported。Design、role、static binding、
trigger、frame、join 与 consumer field 均不进入该 preimage。

`SampleFactV1` 是一个 series slot 的 immutable Owner fact。其 canonical bytes 先是 schema `u16LE = 1` 与
reserved-zero `u16LE`，随后按顺序绑定：series identity、slot identity、series-predecessor sample identity、
可选 correction-predecessor sample identity、source snapshot identity、source-snapshot fact digest、
observation-batch digest、canonical instrument bytes、channel、data kind、field-semantic bytes、timeframe
identity、Owner event identity、logical time、
event-effective、provider-available、retrieval、
correction-publication、Owner sequence、value-semantic bytes、准确 value bytes、scale、canonical-row digest、
Source Binding identity、Source Binding lineage root、lineage version、source-frontier digest、correction-stream
bytes、correction-frontier digest、Instrument Master digest、Universe Selection digest 与 Market Semantics
identity。固定 identity/digest 是 32 bytes，Owner event identity 是 16 bytes，time/sequence/version 字段是
`u64LE`，channel/data-kind/scale 是 `u8`，optional absence/presence 是 `0x00`/`0x01`，variable bytes 是
`u16LE length || bytes`；reserved/trailing bytes、超长 value 与其他 encoding 均被禁止。

version 1 channel tag registry 是穷尽闭集：`0x01 MARKET`、`0x02 REFERENCE`、`0x03 ECONOMIC`。version 1
data-kind tag registry 也是穷尽闭集：`0x01 BAR`、`0x02 QUOTE`、`0x03 TRADE`、`0x04 SCALAR`。这些 tag 是
未改变的 V1 Owner `StrategyInputChannel` 与 `MarketDataFieldSemantic.data_kind` 返回字符串的唯一 canonical
encoding；tag 只能由准确 historical V1 binding/event value 选择，consumer 不能自行选择。`0x00`、任何未列出的
tag 或字符串、tag/string 不匹配，以及在 schema version 1 下出现的后续 registry value 都 unsupported，且不生成
fact、series identity、receipt、EVENT V2 coordinate 或 BAR V3 coordinate。扩展任一 registry 都必须使用 successor schema version，不得
重新解释已存储的 version-1 bytes。

version 1 series projection 只有一个有序的 Owner-derived codec。其 bytes 按顺序为：schema `u16LE = 1`、
reserved-zero `u16LE`、canonical instrument variable bytes、channel tag `u8`、data-kind tag `u8`、canonical
field-semantic variable bytes、timeframe identity `[u8; 32]`、准确
`strategy.input.fixed-i128-le.v1` value-semantic variable bytes、准确 V1 unit variable bytes（`PRICE`、
`QUANTITY` 或 `SCALAR`）、scale `u8`、Source Binding lineage root `[u8; 32]`、correction-stream variable bytes
与 Market Semantics identity `[u8; 32]`。每个 variable field 使用与 `SampleFactV1` 相同的
`u16LE length || bytes` encoding。每个成员都复制自准确 historical V1 Owner binding/event 或其 historical
timeframe projection；consumer 不提供任何成员。准确 value bytes、slot/predecessor、snapshot/fact/batch、
Owner event/time/sequence、canonical-row digest、Source Binding identity/lineage version、source/correction
frontier 及其他所有可更新的 per-fact field 明确排除在外。因此 value/time 更新仍属于同一 series，而
correction stream、unit、scale、lineage root 或其他已列 static member 改变时必须形成不同 series。series
identity 是
`market-data.sample-series.identity.v1\0 || canonical version-1 series projection bytes` 的 SHA-256。

root slot identity 是对 `market-data.sample-slot.identity.v1\0` 加 series identity、event-effective time 与
source-snapshot fact digest 的 SHA-256；已接纳 correction 必须保留 predecessor 的 slot identity，不能重新计算。
`fact_digest` 是 `market-data.sample-fact.v1\0 || canonical SampleFactV1 bytes` 的 SHA-256，`sample_identity` 是
`market-data.sample.identity.v1\0 || fact_digest` 的 SHA-256。因此，即使 value bytes 相同，sample identity
也不同于且不得替换为既有 BLAKE3 canonical-row digest。全零 series predecessor 只对 series 首个 fact
canonical；correction predecessor absence 只对 slot 首个 fact canonical。每个 correction 都必须有 present
predecessor，之后每个 fact 都必须命名当前对应 head。

`SampleReceiptV1` 与 trigger、consumer、Design、role 均无关。其 canonical bytes 恰好是 244 bytes，按顺序为：
schema `u16LE = 1`、reserved-zero `u16LE`、sample identity `[u8; 32]`、fact digest `[u8; 32]`、timeframe
identity `[u8; 32]`、Owner event identity `[u8; 16]`、logical time `u64LE`、event-effective time `u64LE`、
Owner sequence `u64LE`、canonical-row digest `[u8; 32]`、Source Binding lineage root `[u8; 32]`、lineage
version `u64LE` 与 Market Semantics identity `[u8; 32]`；其中不含 input-role identity 或 static binding
digest。任何其他 width、endianness、order、reserved value、缺失 byte 或 trailing byte 都 unsupported，且不生成
receipt identity、EVENT V2 coordinate 或 BAR V3 coordinate。其 stable digest 是
`market-data.sample-receipt.v1\0 || canonical SampleReceiptV1 bytes` 的 SHA-256；这些 bytes 准确等于上述
role-independent fact projection；该 digest 同时是 receipt identity，并提供既有准确 308-byte coordinate
的最后一个 sample-receipt-digest 字段。原生 resolver 只接受该准确 Owner-authorized stable digest，并返回历史
存储的 canonical receipt bytes；绝不从 row、frame、trigger、value、latest head、role、binding 或 caller
coordinate 重建它们。

`StrategyInputFrameEvidenceIdentityV2` 是覆盖一份完整、未改变 V1 frame 的 additive identity；它不改变或
替换任何 V1 receipt。其 canonical preimage 按顺序为：schema `u16LE = 2`、reserved-zero `u16LE`、准确 V1
frame-trigger receipt digest `[u8; 32]`、正 value count `u32LE`，以及 V1 frame 每个 value 对应的一份 96-byte
entry。每份 entry 是 input-role identity `[u8; 32]`、static V1 binding-receipt digest `[u8; 32]` 与 V1
value-receipt digest `[u8; 32]`。entry 按 input-role identity 严格排序，重复 role unsupported；总长度恰好是
`40 + 96 * count`。其 identity 是
`market-data.strategy-input-frame-evidence.identity.v2\0 || canonical preimage bytes` 的 SHA-256。缺失、多余、
乱序或不匹配的 trigger/value evidence 都不生成 identity。该 identity 不是 V1 frame receipt，不替换 joined-cut
receipt 的 private single-value component digest，也不能只从一个 trigger 或一个 value 派生。

只有 `StrategyInputSampleProjectionReceiptV2` 形成既有 EVENT FRAME 或 JOINED_CUT role-bound coordinate projection。其 canonical bytes 是
一个 header 后接 fixed component entry。header 按顺序为：schema `u16LE = 2`、reserved-zero `u16LE`、kind
闭集为 `u8 = 0x01 FRAME` 或 `0x02 JOINED_CUT`、准确 subject identity/digest `[u8; 32]` 与正 component count
`u32LE`。每个 entry 恰好是 612 bytes，按顺序为：input-role identity `[u8; 32]`、static V1 binding-receipt
digest `[u8; 32]`、frame-evidence identity `[u8; 32]`、V1 frame-trigger receipt digest `[u8; 32]`、V1
role-bound trigger event identity `[u8; 16]`、V1 value-receipt digest `[u8; 32]`、historical timeframe-
projection-receipt digest `[u8; 32]`、sample identity `[u8; 32]`、native `SampleReceiptV1` digest `[u8; 32]`、
coordinate digest `[u8; 32]` 与准确 308 coordinate bytes。entry 按 input-role identity bytes 严格排序，重复 role
unsupported；总长度恰好是 `41 + 612 * count`。reserved、闭集外 kind、zero count、其他 order/width、缺失或
trailing byte 都不生成 receipt。

subject identity 是 additive frame-evidence identity，entry 穷尽同一有序 role value。每个 entry 解析准确
binding 及其 historical `TimeframeProjectionReceiptV1`；coordinate 的 role、binding、
timeframe、row digest、lineage、Market Semantics、sample identity、native receipt digest 与 coordinate digest
必须等于这些 resolved bytes。V1 frame/value row 与 batch evidence 必须等于被引用 `SampleFactV1`，且该 fact
的 source snapshot/correction census 必须验证其 lineage version。V1 trigger 的 logical/event time 与 Owner
sequence 必须等于 component coordinate；其 role-bound event identity 只作为单独存储的 V1 evidence，绝不复制
进 role-independent native event identity 或与之判等。current/latest lookup、partial component set、cross-
frame splice 或 caller-derived field 都 unsupported。每个 V2 component 必须解析未改变的 V1 `EVENT`
lifecycle。对于 FRAME，subject 是穷尽的 frame-evidence identity，且所有 entry 共享它。对于 JOINED_CUT，
subject 是准确且有效的 V1 joined-cut receipt digest，至少包含两个 component；每个 component 都是准确的
single-value EVENT frame，且独立重算的 frame-evidence identity 必须匹配该 entry。entry 仍按 role 严格排序。
Market Data 只有在 stored closed kind、subject、count、canonical bytes、custody digest 与准确 receipt-digest
locator 全部匹配后，才能 promote move-only readback。BAR lifecycle、BAR timeframe、BAR schedule receipt 或
其他 V2 kind 仍 unsupported，且不生成 V2 receipt 或 readback。

V2 receipt identity 与 digest 是
`market-data.sample-projection-receipt.v2\0 || canonical receipt bytes` 的同一 SHA-256。Market Data 按该 digest
存储并解析准确 bytes；逐字节相同 replay idempotent，同 digest 不同 bytes conflict。因此，一个 Owner sample
保持一份 native receipt，并在同一 role/binding 下被后续 trigger 携带时保持逐字节相同 coordinate，而 enclosing
V2 projection 随其 V1 frame 正确改变。任何 projection 都不能 mint 或改写 Owner sample receipt。

crate-private `StrategyInputSampleProjectionReceiptV3` 结构 codec 是当前唯一存在的 BAR role-bound
projection shape。其 header 按顺序为：schema `u16LE = 3`、reserved-zero `u16LE`、projection kind
`u8 = 0x01 FRAME`、lifecycle `u8 = 0x02 BAR`、准确 frame-evidence identity `[u8; 32]` 与正 component count
`u32LE`。每个 entry 恰好是与 V2 所列相同的 612-byte component layout；当前 V3 codec 不追加 schedule
receipt 或 cut digest。entry 仍按 input-role identity 严格排序，总长度恰好是 `42 + 612 * count`。V3
identity 与 digest 是 `market-data.sample-projection-receipt.v3\0 || canonical receipt bytes` 的同一 SHA-256。
其 frame-evidence preimage 按顺序为：schema `u16LE = 3`、reserved-zero `u16LE`、lifecycle
`u8 = 0x02 BAR`、准确 V1 frame-trigger receipt digest `[u8; 32]`、正 value count `u32LE`，以及与 V2 相同的
有序 96-byte role/binding/value entry；总长度是 `41 + 96 * count`，identity domain 是
`market-data.strategy-input-frame-evidence.identity.v3\0`。lifecycle `EVENT`、任何非 FRAME projection kind、
V2 下的 BAR entry，或其他 order、width、count、trailing byte 都 unsupported。

当前 V3 source 交叉绑定准确 V1 binding、BAR `TimeframeProjectionReceiptV1`、原生 `SampleReceiptV1`、
coordinate、trigger、value 与 frame evidence；native verification 要求 BAR timeframe 与逐字节相同的
sample/timeframe dependency。其 canonical bytes 不携带 `BarScheduleReceiptV1` 或 `BarScheduleCutV1`；durable
dependency column 在 codec 外交叉绑定这些 Owner artifact。V3 PostgreSQL table、atomic commit、逐字节相同
recovery、tamper rejection 与 writer/reader ACL oracle 是 CURRENT/PARTIAL durable Owner custody，并已通过
isolated dynamic PostgreSQL acceptance。其 sealed public locator/readback contract 与 resolver core 是
`CURRENT / PARTIAL`：一个准确 receipt digest 只能读取一个历史 FRAME/BAR projection，并且必须在同一个
fixed PostgreSQL snapshot 中完整验证 projection custody、timeframe/sample fact、schedule dependency、准确
schedule readback 与 append-only schedule history，且在读取前、读取后及 promote 前立即重新验证 admission。
resolver 不能选择 kind/lifecycle、执行 latest lookup、解析 V2 BAR 或 JOINED_CUT，也不暴露 storage authority。
Strategy Factory production startup、产品 composition、ProgramHost、Backtest、composite、Windmill 与其他
所有产品消费保持 `TARGET / UNAVAILABLE`；当 external admission adapter 不可用时，required production startup
不得返回 resolver。stored V3 row 或结构 V3 bytes 本身不产生 consumer 权威或 mutation。

**TARGET / NOT_ADMITTED，additive BAR native join：** `StrategyInputSampleProjectionV4` 的 projection
kind 闭集准确为 `FRAME` 与 `JOINED_CUT`，lifecycle 闭集为 `BAR`。它既不替换也不改变任何 V1 receipt、V2
EVENT projection 或 V3 BAR FRAME projection；所有既有 canonical bytes、domain、identity、semantics、
persistence 与 resolver 均保持逐字节不变。对于 FRAME，V4 绑定准确 Owner-resolved V3 BAR FRAME source 及其
完整 schedule dependency。对于 JOINED_CUT，其 subject 是未改变且有效的 V1 joined-cut receipt 的准确 digest。
canonical V4 receipt bytes 在按 role 排序的 component set 之前包含准确 schedule-dependency-set digest，因此
domain-separated V4 receipt identity 必然同时绑定两者。schedule-dependency set 以穷尽、规范的方式把每个
component role 绑定到准确 BAR schedule cut/receipt 与 timeframe dependency；缺失、多余、重复或乱序 entry
均 unsupported。

每个 V4 component 在完整 role、static binding、frame evidence、trigger、value、timeframe projection、sample
identity、native sample receipt、308-byte coordinate、schedule cut 与 schedule receipt field 上，都必须严格等于
其对应的 exact-locator V3 BAR FRAME component。重新计算外观等价的 component、替换 digest、解析 timeframe
label，或混入其他 frame、slot、batch、joined cut 或 schedule set 的 component，都不生成 V4 receipt。首个
admitted-shape corpus 准确包含六个 role：`1m OPEN`、`1m HIGH`、`1m LOW`、`1m CLOSE`、`1h CLOSE` 与
exchange-session `1d CLOSE`。`1m CLOSE` 是 trigger；四个 `1m` role 必须共享准确完整 schedule slot 与
observation batch。`1h CLOSE` 与 `1d CLOSE` 只能选择在各自 schedule 下不晚于该 trigger 的完整 latest-closed
sample。`1d` role 必须绑定 `EXCHANGE_SESSION_BAR` day，绝不能是 UTC day 或无 anchor 的 24-hour interval。

一个 Market Data Owner transaction 必须 lock 并重新解析准确 V1 joined-cut receipt、每个 V3 FRAME projection、
sample/timeframe fact 与 schedule cut/receipt；校验完整 schedule-dependency set 和全部 strict component
equality；随后原子存储 V4 receipt、准确 locator readback 与 outbox。locator 是准确 V4 receipt identity，且在
发送前已知。逐字节相同 replay 或 response-loss recovery 解析该 locator，以零 append 返回相同 historical
bytes。exact-locator resolver 不读取 latest/head，也不执行 history scan；只有在一个 fixed snapshot 中完整
重新校验后，才能 promote move-only positive readback。private table 不授予 `PUBLIC` 任何 privilege；只有
固定 non-grantable Owner/writer role 能够 mutation，固定 non-grantable W3 reader 只能获得 resolver 的
`EXECUTE`，绝无 raw `SELECT` 或 DML。locator、ACL、canonical-byte、V1-subject、schedule-set、component、
custody、response-loss 或 admission 任一失败时，V4 receipt、readback、outbox 与 W3 binding 均零写入。W3
只消费该 V4 JOINED_CUT locator/readback。该合同不声称 implementation、migration、registered product
composition、production startup/write、ProgramHost、Backtest、deployment、runtime 或 trading authority。

已接纳 correction 是 immutable successor，同时具有准确 series predecessor 与 correction predecessor。
它创建新的 `SampleFactV1`、`SampleReceiptV1`、`sample_identity` 与 coordinate，并让 sample clock 准确推进
一次，即使其 value bytes 与 predecessor 相等。它绝不 rewrite、replace、mask、replay 或追溯推进 predecessor
state。普通的等值新 slot 同样是新 sample，并准确推进一次。对未来获准的 BAR path，同一 1-hour 或
exchange-session `1d` sample 被后续 1-minute trigger 携带时，必须返回相同 receipt/coordinate bytes，且不得
第二次推进 sample clock。

当前 POINT_EVENT PostgreSQL 路径包含 Owner-owned timeframe-projection-receipt、sample-fact、series-head、
per-slot correction-head、sample-receipt、outbox table 与 exact native resolver。一个 Market Data transaction
插入 fact、receipt、outbox row，并从 fact
绑定的 predecessor 对 series/correction head 执行 compare-and-swap 前进；普通新 slot 从规范 absence 把其
correction head 推进到首个 fact。逐字节相同的 replay 执行零次
write，并返回准确历史 receipt bytes。identity/content mismatch、time/version regression、predecessor 或
sequence gap、competing branch、cycle、cross-lineage splice、head mismatch、缺失/冲突 timeframe projection
或非规范 bytes 都必须 fail closed，且两个 head 均不前进。successor 与 correction 之后仍可读取历史 exact receipt。caller、Strategy
Factory、ProgramHost、Backtest、fixture、migration 与 reconciliation process 都不获得 insert/update/delete、
head-advance、synthesis、backfill 或 garbage-collection 权威。

上述 BAR schedule fact/cut/receipt/readback PostgreSQL 路径、BAR sample custody 与 V3 projection PostgreSQL
路径在 isolated dynamic acceptance 后是 CURRENT/PARTIAL durable Owner custody。schedule 已具备 admitted
capability、revalidation、固定 read/history、reader ACL 与 public startup resolution。V3 已具备 durable
commit/recovery/tamper/ACL evidence，并具备 sealed exact historical resolver core；V3 production startup、产品
与 composite 消费仍为 TARGET/UNAVAILABLE。crate-private 结构 codec 或 stored row 本身不是产品 acceptance
evidence。

对于 EVENT，V2 projection receipt 交叉绑定每个 selected component 的准确 `sample_identity`、`SampleReceiptV1`
digest、已接纳 V1 role/binding evidence 与既有 308-byte coordinate bytes/digest。它保留所有 V1 trigger、
value、frame 与 row identity，而不从这些 identity 派生 sample 权威。因此，同一个 sample 被后续 event
frame 在同一 role/binding 下选中时，native receipt 与 coordinate bytes 保持逐字节相同。对于 BAR，
只有 Owner sealed、经过动态验证的 V3 resolver core 才能在其已准入边界形成对应 historical projection
readback；该 capability 不准入 production startup 或任何产品 consumer。从 row/frame/trigger digest、caller
timestamp 或 `1d` 的 UTC 24 小时解释计算 coordinate digest 均不具备权威，并在 consumer state mutation
之前失败。

规范 acceptance 必须复用仓库既有 disposable PostgreSQL harness 以及仓库权威的 Makefile、pre-commit 与
CI wiring。它覆盖每个规范 identity/fact field 的逐字段 mutation、逐字节 idempotency 与 same-identity
conflict、普通/correction predecessor topology、response loss、restart、transaction rollback、历史 exact
readback、receipt/coordinate tamper 与 cross-splice、predecessor gap/branch/cycle/regression/cross-lineage
rejection、V1 byte/meaning preservation，以及所有 non-Owner write path 的数据库 ACL denial。consumer
oracle 在 1-minute trigger 间重复同一 1-hour 与 exchange-session `1d` sample 而不 double advance；等值新
sample 与已接纳 correction 各推进一次；restart 后返回相同 native receipt bytes。在具备该 dynamic evidence
前，本合同不声称 provider authenticity、production migration/deployment、Dashboard、Paper、Live、BFP
executable maturity、Backtest 产品闭合（包括 inverse/quanto target-consumption 语义）、
Windmill/default-database 准入或 trading authority。这些 Backtest 限制不创建 Market Data instrument-class
rejection。

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
