---
title: R&D Module Audit
updated_at: 2026-07-15 CST
---

# R&D Module Audit

结论：方向是对的，已明显强于普通“参数搜索 + 漂亮回测”。当前机制适合做**有限假设验证**，不适合扩大成持续自动挖策略；要投入真实策略研发，最关键的是持续守住 holdout、edge margin、shadow 执行归因三道门。

## 修复状态

- 已补：Replay R4.48 用独立实现认证 R4.47 economic envelope，未推进任何 production schema/version。新增 certification-only `OHLCV Economic Oracle Fixture v1`，冻结 zero-cost fine-grid、cost-aware fine-grid、fractional-bps coarse-grid 三套 quantity/cost/increment profile；test-local BigInt rational oracle 独立计算 buy-ceil/sell-floor 滑点成交价、signed gross PnL floor、fee ceil、net contribution 与 envelope 聚合，不导入 Replay accounting/decimal。8 条 ordered-price trace × 3 profile × 2 path 全部 parity，ordered actual path containment、canonical non-improvement、long/short collision 手算 golden 和 densification metamorphic 已锁定。该结果只排除当前 TypeScript production 算法的同实现自证，不证明真实 venue 成本、tick path、完整 equity interval 或跨语言 parity。
- 已补：Replay R4.47 将 `resolution_limited` 从布尔标签升级为自哈希 Economic Impact Envelope。OHLCV Resolution Evidence v3 的每条 P1/P2 path 以同一实际 entry basis、active remaining quantity、冻结 fee/slippage、price/settlement increment 和 Numeric v3 计算 simulated execution price、gross realized PnL、exit fee 与 net terminal contribution；envelope 给出 min/max、span、canonical contribution 与 canonical-to-best shortfall。Result v33 Metrics 聚合 limited count/span/shortfall，Artifact v35/Run Outcome v30 发布；Runner 用 Request/Dataset/entry Fill 重算并把 canonical economics 与实际 terminal Fill price/fee 交叉绑定。open gap/single touch 的 span 为零，collision 的 long/short 成本方向、价格缩放 metamorphic、policy tamper 和 Fill tamper 已锁定。该指标明确排除共同 entry fee、funding、已实现 partial PnL，不是完整 counterfactual equity、真实路径概率或晋级评分。
- 已补：Replay R4.46 将 OHLCV terminal evidence 从“价格 bracket”升级为 `Active Protection Evidence v2`：每条证据绑定 `protection_generation`、post-mutation remaining quantity、stop/target Order id、trigger 与独立 protection hash。Engine 初始双保护为 generation 1；唯一 stop replacement 或 partial-fill 后原子 resize 推进到 generation 2，并写入 Checkpoint v16。Result v32/Artifact v34/Run Outcome v29 的 runner 在首次发布与幂等复读时交叉验证 SourceEvent、submitted/activated/triggered OrderEvent、terminal Fill、数量及 generation/order-id 组合；即使重算 protection/evidence/checkpoint hash，也不能让 terminal 回指旧 stop/target。未改变 Simulator v8 的成交、路径或账本语义，也未把 generation 2 外推为 multiple amendment 制度。
- 已补：Replay R4.45 以 certification-only `OHLCV Oracle Fixture v1` 校验 R4.44 simple-bracket two-path evidence，不增加 runtime capability 或 wire epoch。8 条 synthetic ordered-price fixture 覆盖 long/short、open gap、single touch 与 high-first/low-first collision；已知轨迹的首个 terminal crossing 必须落入 P1/P2 对应 outcome，canonical stop 的 raw terminal PnL 不得优于 oracle。相同 OHLC 的 high-first/low-first 轨迹可产生相反 terminal owner，但 Replay evidence 保持相同并标记 `resolution_limited`；在每段内插入中间观察不改变 OHLC、oracle 结果或 semantic envelope。该认证证明当前包络对 simple bracket 的 soundness，不代表 tick replay、真实成交重建、完整 intrabar path 枚举或 generic matching。
- 已补：Replay R4.44 将 simple-bracket OHLCV 路径不确定性从非结构化 limitation 升为自哈希 `OHLCV Resolution Evidence v1`。每次 stop/target 终止均绑定 source EventKey、bar OHLC、active bracket、P1=`open-high-low-close`、P2=`open-low-high-close`、两条 path digest、canonical path 与选择政策；open gap 和单触点标记 `exact_under_ohlc`，stop/target collision 标记 `resolution_limited / stop_target_order_ambiguous`，并保留 stop-first 作为当前 simple-bracket 的较差 canonical 结果。Result v31、Artifact v33、Run Outcome v28 与 Fingerprint 发布并重验独立 `ohlcv-resolution-evidence.json`；篡改路径后即使重算 evidence hash 仍因 path digest/语义约束被拒绝。未改变 Simulator v8 的经济执行语义，也未扩展为通用多订单 OHLC resolver、limit queue 或真实 intrabar reconstruction。
- 已补：Replay R4.43 收口 partial Fill 后的 terminal owner 组合与 checkpoint 语义防篡改。重建后的 stop、target、exact liquidation、EOD 均只消费 `abs(post-fill position)`；stop/target/liquidation 全平，EOD 不造 Fill、保留 open Position 并取消当前双保护。long/short lane 锁定相同 transition 结构，Runner 贯通 post-partial stop/target、exact-risk full liquidation、open-marked EOD 与已有 final strategy exit；同刻 pending final decision 由更早 terminal owner 写 `not_reached_terminal`。Engine Checkpoint v15 除自哈希外，还校验 event sequence、每个 Order 与最后 OrderEvent、partial Intent/Fill、重建 protection 的确定 order id/type/side/quantity/trigger；即使攻击者重算 checkpoint hash，篡改 trigger 仍拒绝。未增加 wire capability，不扩展 multiple partial、partial liquidation 或真实 liquidity matching。
- 已补：Replay R4.42 将 R4.41 draft 收敛为首条 executable partial-reduce 纵切。Request v21 / Schedule v5 认证一次 opposite-side market reduce-only fixed quantity，必须 increment-aligned、严格留下 open Position，且与 stop replacement 互斥；可选后续 final full exit。Simulator v8 在 eligible open 维持 exact risk/stop/target 优先，partial Fill 后于同一 source boundary 依次取消旧 stop/target，再以 `abs(post-fill position)` 和原 trigger 重建双保护。Result v30 的 Position/Ledger 记录 partial fee/realized PnL，后续 Funding、Margin、State Snapshot v3 使用剩余数量；terminal preemption 会取消 pending partial。Checkpoint v14 保存 partial Order/Fill 与 current bracket，clean/resume Result hash 一致。Artifact v32、Run Outcome v27、Timeline v8、Boundary v7、Context v6、Worker v7、Registry v7、Capability/Receipt v9 完成 epoch 推进。认证只覆盖模型内 fixed quantity 全成，不代表真实流动性 partial fill、multiple partial 或通用 matching。
- 已补：Replay R4.41 先冻结部分减仓的非可执行 draft seam，不提前声称 certified。`Partial Reduce Intent Draft v1` 仅允许一次 opposite-side market reduce-only `fixed_quantity`，数量必须小于初始仓位并留下 open Position；决策必须晚于入场可执行时点，成交也必须严格晚于决策。Protection Draft Policy 冻结在 partial Fill 后的同一 source boundary 取消旧 stop/target，再以 `abs(post-fill position)` 为唯一数量 authority、保留当前 trigger 价重建全量双保护；v1 draft 禁止与 stop replacement 组合，但允许后续一次 final full exit。该 draft 常量未加入 `REPLAY_CERTIFIED_CAPABILITIES`，也未加入 Request/Decision Schedule；Reservation 若要求 `partial-reduce-v1-draft`，Runner 在 Engine 前返回 unsupported 且不发布 Result/Artifact。
- 已补：Replay R4.40 认证 protective-stop replacement 的 long/short 方向对称与 OHLCV 歧义语义。镜像 fixture 锁定 short stop 只能向下收紧；replacement 后同根 bar 同时触及当前 stop/target 时，long/short 都以 stop-first 作为保守 canonical path，并必须输出 `ohlcv-stop-target-collision / resolution_limited`，不得声称 bar 内真实路径。以固定中心价镜像后，entry/stop Fill 价、net/realized PnL、return、trade count 与 OrderEvent phase/subphase 全部 parity。本阶段不增加 schema/version，也不把 stop-first 临时包络升级为一般 OHLC 路径制度。
- 已补：Replay R4.39 不扩大 wire capability，补齐止损收紧后的唯一终止 owner 组合认证。`replace -> full strategy exit` 路径锁定 Harness 下一决策必须看到新 active stop，exit fill 后只取消 replacement stop 与 target，旧 stop 保持已取消；Checkpoint 同时保存 replacement stop 与 submitted exit，clean/resume Result hash 一致且不重跑已消费决策。`replace -> exact liquidation` 路径锁定 phase-15 按 current stop cancel、target cancel、forced submit/activate/fill 顺序取得唯一 terminal Fill。新 stop 自身的后续 gap fill 已由 R4.38 覆盖；本阶段没有新建第二套 terminal arbitration 或升级为通用 OCO engine。
- 已补：Replay R4.38 认证一次全仓保护性止损仅收紧替换。Schedule v4 最多冻结一个 `authorized_protective_stop_replace`；Intent v1 绑定旧/新 trigger、opposite-side stop-market、reduce-only、`full_open_position` 与 `tighten_only_cancel_then_submit`。Engine 在非终止 closed-bar 边界以固定 EventKey 顺序取消旧 stop，再提交/激活新 stop；新 stop 若已被当前 close 穿越则拒绝，不回溯制造 same-bar fill。State Snapshot v2、Checkpoint v13 保存当前 stop/target 权威状态，测试锁定 cancel→submit→activate、后续 gap fill、terminal-before-decision、checkpoint tamper 拒绝与 resume parity。未开放止损放宽、target 改动、通用 amend/cancel-replace、连续 trailing 或部分保护量。
- 已补：Replay R4.37 认证第一条 effect-bearing position-open 决策纵切。Schedule v3 最多冻结一个末位 `authorized_reduce_only_exit`；Exit Intent v1 仅允许 opposite-side / market / reduce-only / full-open-position，并绑定 closed-bar signal 与严格更晚 earliest open。Harness 必须从 Market/State Snapshot 复算同一 Intent；Engine 在决策边界提交 strategy-exit Order，Checkpoint v12 保存 pending Order，open 上按 `exact risk -> stop gap -> target gap -> strategy exit` 执行。测试覆盖正常全平、terminal not-reached、stop-gap 抢占取消、Intent/State binding 与 cancel/resume parity；未开放 partial reduce、add/reversal、cancel/replace 或多 strategy order。
- 已补：Replay R4.36 认证第一条 position-open 只读决策纵切。Schedule v2 可在唯一入场授权后冻结 `no_action`；Engine 只在非终止 closed-bar source boundary 生成自哈希 Position/Cash State Snapshot并调用双 fresh subprocess Harness。stop/target/liquidation 同刻优先时写 `not_reached_terminal`，不事后补算；Checkpoint v11 内嵌已消费 Timeline，resume 不重跑已提交 post-entry Harness。当前仍不支持 effect-changing 持仓决策、动态 supplemental join、cancel/replace、加减仓或第二笔订单。
- 已补：Replay R4.35 移除“Timeline 最后一项就是入场授权”的位置假设。Adapter、Harness Context、Engine、Artifact writer/reader 与 Fingerprint/Checkpoint 派生字段现在都按唯一 `authorized_initial_order / authorized_order` 语义定位经济入口；完整 Timeline hash 仍覆盖全部 boundary。当前 schedule 仍拒绝持仓后 decision，直到运行时 Position/Cash State Snapshot、terminal-before-decision 与 resume prefix 合同完成，不能用事后重放补证。
- 已补：Replay R4.34 新增 Control Plane-frozen `Decision Schedule v1`。pre-entry 多 boundary 只允许 `no_action* -> authorized_initial_order`；每个 boundary 独立重建 hash-bound closed-bar PIT Snapshot、执行两次 attested Harness，并把 tagged output、Context、Boundary、Entry 与 Timeline 全链自哈希。Replay 不得增加决策时点，Engine 会对全部 entry 重算数据输入。当前不支持持仓后 decision、动态 supplemental join、cancel/replace、加减仓或第二笔订单。
- 已补：Replay R4.33 冻结 `Decision Market Input Requirement v1`，从 Dataset Manifest/Data Hash 已覆盖的 OHLCV 生成严格 closed-bar lookback Snapshot；Harness Worker 改用不含预填 Order 的白名单 Context，并以双 fresh subprocess 重算 Order。lookback 不足、gap、future-visible、Order 泄漏、输出漂移及 requirement/snapshot/artifact/checkpoint hash 漂移均拒绝。当前只认证单次 initial decision，不能外推为滚动信号或通用策略 runtime。
- 已补：campaign validation 必须与 discovery 保持 locked holdout embargo；默认按 `max(max_hold_bars, factor lookback, funding interval)` 换算。
- 已补：campaign 每个 hypothesis 必须带 `thesis_certificate`；缺 edge 类型、行为假设、参与者、regime、失效条件、成本敏感度、候选 universe 或 negative controls 时零 trial 停止。
- 已补：replay provenance 输出 `temporal_contract`，覆盖 closed-candle reference、availability、lookback start、label end、universe selection 与 supplemental report availability；strategy review 会把缺 temporal contract 的 replay evidence 判为 legacy/stale。
- 已补：R&D batch 输出 `statistical_report`，记录完整 trial universe、accepted/rejected、winner、OOS/effective sample、edge margin、deflated edge probability 与四时间块 CSCV/PBO；统计未决或 PBO 失败时不会把 winner 标成 ready。
- 已补：R&D candidate 与 strategy promotion 的 OOS gate 增加 raw/effective sample 与净 edge margin，不再只看正收益。
- 已补：`shadow -> live-small` 只接受 review-derived shadow attribution；手工填 `execution_attribution` 不能补齐 live-small gate。
- 已补：strategy review 输出 replay -> shadow -> live-small decay diagnostics；shadow 相对 replay 的 avg_r 保留率过低时阻断 live-small，并归因为 execution/reality decay。
- 已补：strategy review 输出 `cost_model_feedback`，把 review-derived fee / slippage / funding / total cost drag 反灌成 per-trade R 值与 unknown-size capacity bucket，供下一轮 replay cost stress 使用。
- 已补：forward holdout 测试版输出冻结候选 hash、状态和下一步动作；主数据与 benchmark / supplemental 数据都必须是机器可读 `frozen_at` 之后的闭合样本，缺 `frozen_at` 的真实 artifact 会被拒绝。
- 已补：calibration panel 明示 `survivor_only`，并支持通过外部归档 manifest 合入 inactive / delisted symbol；没有可靠归档输入时仍不得声称 survivorship robust。
- 已补：R&D replay / panel / campaign / forward holdout / shadow tracker 读取 manifest 时支持把迁移前 `data/*-panel-*` 路径安全解析到当前 `tmp/panels/*`，并加回归测试；旧 artifact 可复读，但新产物仍应写 repo 相对 `tmp/panels/...`。
- 已补：panel R&D 单候选时 `cross_candidate_asset_shuffle_v1` 不再显示 `passed=true`；状态仍是 `not_applicable`，避免误读成 panel-level negative control 通过。
- 已补：forward holdout 在全部阻塞原因只是主数据 / benchmark 尚未晚于 `frozen_at` 时，`next_action` 改为等待下一根闭合 K 线并刷新 manifest，而不是误报“修数据覆盖”。
- 已补：新增 `research.data-split`。新 hypothesis 开研前可把 OHLCV manifest 物理切成 discovery / validation / locked_holdout 三个独立 manifest，并自动按 max hold / feature lookback / funding interval 留 embargo；locked holdout 在策略合约冻结前不再需要靠人脑“记得别看”。
- 已补：`research/rd-artifact-summary` 可自动识别普通 R&D loop 与 panel R&D artifact；普通 loop 摘要会暴露 `failure_summary`、`reliability_gate`、候选 R/OOS 指标与 blocker，避免 no-promote 被误读为空结果。
- 未补：按订单 notional / ADV / depth 的 capacity 与 market impact 分桶、White Reality Check / Hansen SPA 完整实现、可靠 delisted 历史数据源。

## 当前测试状态

- 2026-07-13 23:20 CST，手动跑一次 J04 R&D supervisor：
  - 初始入口：`rd-supervisor --supervisor-job` 可自动初始化 `data/rd_state.db`，但空 `next_hypothesis_queue` 立即停止为 `data_or_tool_blocked`，只给出 `marketability_score_v1` queue seed 建议，未自动落 queue。
  - 为完整验证链路，手动用 `research.data-split` 把 `.cache/outline-audit/btc-usdm-20260423/manifest.json` 切为 discovery / validation / locked_holdout：216 / 72 / 72 根 4H，embargo 30 根；locked holdout 未打开。复盘修正：这里不应为适配 420 根缓存而降低 `min_segment_rows`，正确动作是先用 `ohlcv-fetch` 补足 OHLCV，再按默认门槛切分。
  - 手动生成并 validate `btc-4h-tsm-manual-2026-07-14` hypothesis contract，转成 ready queue item 后跑 supervisor；产物 `tmp/artifacts/strategy-rnd/rd-program-btc-4h-tsm-manual-2026-07-14-20260713162000.json`。
  - 策略质量：`time_series_momentum_v1` 单候选，`trial_count=1`、`accepted_count=0`、`sample_count=3`、`avg_r=-0.586246`、`total_r=-1.758737`、`PF=0.120632`、`maxDD=2R`；blocked by `R-SAMPLE-SIZE / R-EXPECTANCY / R-PROFIT-FACTOR`，结论是 `no_promote`，不得进入 validation / shadow。该结果首先说明本次数据准备不合格，其次才说明该粗糙 TSM 假说没有 edge。
  - 流程问题统计 6 个：缺 DB 时 read 报底层 `unable to open database file`；空 queue 只推荐不补队列；标准位置缺可直接研发的 manifest，需从 `.cache` 找且源 manifest 含本机绝对路径；为跑通流程降低 `min_segment_rows`，而不是先补 K 线；designer contract -> queue -> state 仍需人工桥接；queue item 默认 `mode=loop` 时即使带 `validation_manifest_path` 也只跑 discovery loop。
  - 优化点统计 6 个：read 缺库错误应分层；supervisor 可在空 queue 时自动调用 designer 或明确输出可执行 patch；准备一组 repo-relative smoke-test manifests；数据不足时先用 `ohlcv-fetch` / `ohlcv_store` 补足再切分，禁止降低研究门槛；designer `queue_item` 可支持直接生成 state update patch；带 validation manifest 的 ready item 默认走 campaign，除非显式 `mode=loop` 且说明会忽略 validation。
  - 开发过程复盘：系统成功把失败写回 `rejected_mechanisms / universe_lessons / artifact_refs`，但第二轮又因“无 ready hypothesis”把总状态置为 `data_or_tool_blocked`；这适合暴露问题，不适合无人值守连续开发。下一轮应先生成一条全新的市场机制假说，而不是给本次 TSM 加过滤器。
- 2026-07-10 19:31 CST，`S-ALT-4H-HIGH-BETA-SHORT-MOMENTUM` 按现行 `research.data-split` 重跑 validation：10 资产、validation 段、固定 STC short momentum candidate；结果 `outcome=no_promote`，pooled `sample_count=364`、`avg_r=0.021334`、`total_r=7.765575`、positive assets `5/10`，blocked by `PANEL-BREADTH / PANEL-COST`。Locked holdout 未打开；策略保持 `draft`。
- 2026-07-09 19:45 CST，新增三条 liquid-alt 机制检查：
  - `vol-compression-alt-validation-2026-07-09`：VCB long 三变体全部 `no_promote`；原始 `VCB-L-30-120` 在 8 资产 panel 上 `total_r=-32.522326`、3/8 资产正， blocked by breadth / cost / catastrophic / asset-shuffle。
  - `relative-capitulation-reversion-long-2026-07-09`：BTC 弱势里做相对输家多头回归失败；三变体全部 pooled negative，最差 `RRV-L-BTCWEAK-180-1R-RC` 为 `total_r=-199.35362`、0/8 资产正。
  - `relative-btc-weak-overstrong-short-2026-07-09`：`RRV-S-BTCWEAK-180-1R-RC` 有机制但不过 broad-universe gate；`sample_count=1322`、`avg_r=0.048568`、`total_r=64.207004`、7/8 资产正，panel asset-shuffle 通过，但 `TRXUSDT` 触发 `PANEL-CATASTROPHIC`（`total_r=-28.993152`、`max_drawdown_r=41.550344`）。
- 已新增 draft policy：`S-ALT-4H-BTC-WEAK-RELATIVE-WINNER-REVERSION-SHORT`。它只记录受限假设，不提供 shadow / promotion evidence；任何排除 TRX-like 资产的版本都必须作为新 hypothesis 在 fresh panel / forward holdout 上验证。
- 2026-07-09 20:35 CST，完成两条后续诊断：
  - 路径 fallback 修复验证：旧 `alt-panel-competition-input-2026-07-08.json` 仍含 `data/calibration-panel-*` 路径，修复后可直接复跑并得到原始 panel summary。
  - BTC 弱势相对赢家 short 风险修复诊断：0.5R BE 仍被 TRX catastrophic veto，1R BE 更差；非 TRX 外部 panel 上原始候选通过当前 gate（`total_r=7.844068`，4/5 资产正），但 SOL 为负且 panel 已被看过，只能作为机制支持。
- 2026-07-09 22:10 CST，BTC 强势相对赢家 short draft 做冻结候选外部检查：
  - `relative-reversion-btc-strong-fresh-check-2026-07-09`：`BCH/LTC/ATOM/NEAR/APT`，固定 `RRV-S-BTCSTRONG-NONMEME-120-1R-RC-FROZEN`，`sample_count=399`、`avg_r=0.063149`、`total_r=25.196466`、4/5 资产正、无 panel gate blocker。
  - `ATOMUSDT` 为负（`total_r=-5.157863`），OOS 与 cost stress 均为 false；单候选 panel asset-shuffle 不适用，不能把这轮解释成 panel negative control 通过。
  - forward holdout 以 `frozen_at=2026-07-09T14:00:00Z` 运行，全部被 `HOLDOUT-NOT-FORWARD / HOLDOUT-SUPPLEMENTAL-NOT-FORWARD` 阻塞；最新闭合 K 线是 `2026-07-09T12:00:00Z`，下一步是等下一根冻结后 4H 闭合 K 线并刷新资产与 BTC benchmark manifest。
- 2026-07-10 09:05 CST，开研 BTC 4H volatility compression breakout long：
  - 先跑 `research.data-split`：discovery `2019-09-08 -> 2023-09-04`，validation `2023-10-07 -> 2025-06-05`，locked holdout `2025-07-09 -> 2026-07-08`，embargo `200` 根 4H；locked holdout 未打开。
  - campaign `btc-4h-vcb-rd-2026-07-10-a` 预声明 6 个 long VCB candidate；discovery 结果 `accepted_count=0`、`outcome=no_promote`，未消耗 validation。
  - 主要 blocker：`R-PROFIT-FACTOR` 6/6、`RND-OOS-EFFECTIVE-SAMPLE` 6/6、`R-EXPECTANCY` 5/6；`reliability_gate.decision=reject_hypothesis`。下一步不能给旧候选事后外挂过滤器；若继续使用过滤 / 资产选择 / 风控改造，必须作为新市场机制或新 candidate strategy hypothesis 预声明。
  - artifact：`tmp/artifacts/strategy-rnd/btc-4h-vcb-rd-2026-07-10-a.campaign.json` 与 `tmp/artifacts/strategy-rnd/btc-4h-vcb-rd-2026-07-10-a-H-BTC-4H-VCB-LONG-001-discovery.json`；R&D ledger 已登记到 `data/data_catalog.db`。
- 2026-07-10 10:10 CST，开研 BTC 弱势下 high-beta alt 相对弱者 short continuation：
  - `relative-loser-continuation-btc-weak-2026-07-10-a`：6 资产 high-beta panel，4 个候选全部 `no_promote`；`RWM-S-BTCWEAK-180-1R` 有局部苗头（`sample_count=1024`、`total_r=19.099307`、asset-shuffle 通过），但仅 2/6 资产正，blocked by breadth / cost / catastrophic。
  - `relative-loser-continuation-btc-weak-broad-2026-07-10-a`：8 资产 broad liquid-alt 泛化检查仍 `no_promote`；同一 `RWM-S-BTCWEAK-180-1R` pooled `total_r=58.744121`、5/8 资产正、asset-shuffle 通过，但 blocked by OOS / cost / catastrophic，`NEAR/LTC` 亏损与多资产 drawdown 过重。
  - 结论：该机制不是“调参即可用”；若继续，必须作为新 hypothesis 明确 universe / risk owner / market-state filters，而不是排除亏损资产后复用同一 holdout。

## 外部校准

- White 的 Reality Check 重点不是“不要搜索”，而是承认时间序列里数据复用几乎不可避免，必须检验“搜索出来的最好模型是否真的优于基准”。见 [White 2000](https://www.ssc.wisc.edu/~bhansen/718/White2000.pdf)。
- Harvey/Liu/Zhu 对 factor zoo 的结论很硬：大量因子挖掘后，传统 `t > 2` 不够，新因子通常要更高门槛。见 [NBER w20592](https://www.nber.org/system/files/working_papers/w20592/w20592.pdf)。
- Bailey/Lopez de Prado 系列把问题落到 DSR/PBO：Sharpe / 回测表现要同时修正多重测试、样本长度、非正态与选择偏差。见 [DSR](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551) / [PBO](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253)。
- 实盘差异主要来自 reality model：fee、fill、slippage、capacity、market impact 与 broker/live reconciliation。见 QuantConnect [reality modeling](https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/key-concepts)、[slippage](https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/slippage/key-concepts)、[reconciliation](https://www.quantconnect.com/docs/v2/writing-algorithms/live-trading/reconciliation)。
- 参数优化如果在同一历史段反复找最优再回测，本质就是 look-ahead。见 QuantConnect [optimization parameters](https://www.quantconnect.com/docs/v2/writing-algorithms/optimization/parameters)。

## 当前强项

- `calibration -> R&D -> locked holdout -> evidence -> shadow -> live-small` 的链路边界清楚；R&D ledger 和 strategy evidence 分离，避免失败搜索污染交易事实。
- campaign 有全局 `<=10` trial budget；locked holdout 重复使用会被 `strategy-rnd-ledger` 拦住。
- replay 已固定 next-open、stop-first、gap 更差开盘、双边 fee/slippage、funding coverage gate、fingerprint freshness。
- candidate 必须过 side-flip / entry-lag negative control；panel R&D 有 asset shuffle negative control；promotion gate 会挡住缺 funding、panel negative control、robustness、shadow attribution 的证据。
- 文档明确禁止自动升格和 holdout 失败后继续调参，这是正确的研究纪律。

## P0 缺口

1. **Holdout 只查不重叠，缺 embargo。**（已补）
   `rd-campaign-runner` 只要求 discovery / validation manifest 时间范围不重叠；若 validation 紧贴 discovery，仍可能泄漏持仓标签、indicator lookback、funding/market state。
   整改：新增 `RND-HOLDOUT-EMBARGO`，要求两段之间至少隔开 `max(max_hold_bars, max_feature_lookback, funding_interval)` 对应时间；带 factor report 时 embargo 还要覆盖 factor lookback。

2. **升 shadow 的统计门槛偏低。**（已补基础门槛）
   当前 locked holdout `sample_count >= 10` 且正收益/PF `>=1.05` 可以过 replay 层。对 4H swing 可接受为“影子候选”，但不能证明 edge；在现在的市场里，10 笔很容易被 regime 和执行误差吞掉。  
   整改：增加 `effective_sample_count`、bootstrap 下置信界、DSR/PBO 或等价保守统计；同时要求净 edge 超过成本模型误差缓冲，比如 `avg_r_lower_ci > 0` 且 `net_edge > 2 * execution_error_band`。

3. **Shadow 执行归因还不够自动。**（已补 gate 来源约束）
   roadmap 已标“下一块”：从真实 shadow order/event 自动汇总 fee、slippage、funding。只要这里依赖人工填报，`shadow -> live-small` 就可能被乐观归因放行。  
   整改：live-small 前只接受由 shadow order、mark/last、funding event、exchange fill/reconcile 自动生成的 attribution；人工 notes 只能解释，不能补齐 gate 字段。

## P1 缺口

- **strategy thesis certificate 已有基础 gate。** 当前已强制 campaign 预声明 edge 类型、市场行为假设、参与者、适用 regime、失效条件、成本敏感度、候选 universe、negative controls；后续还可把预期持仓/换手与对应 negative control 的覆盖关系做得更细。
- **Panel survivorship 已有基础防线。** 当前 20 个可交易资产 panel 会明示 `survivor_only=true`；若提供可靠 inactive / delisted manifest，可合入 calibration suite 并取消 survivor-only 标记。剩余缺口是真实归档数据源与 listing-age-aware universe。
- **Panel artifact 路径边界已补读路径兼容。** 旧 artifact 中仍可见 `data/calibration-panel-*` / 绝对路径痕迹；当前已在读路径加兼容，后续仍要求新产物落在 `tmp/panels/` 且输出 repo 相对路径。
- **Reality model 已有反馈闭环基础。** 当前已有 replay -> shadow/live decay 诊断与 `cost_model_feedback`；下一步应把 review 里的订单 notional / ADV / depth 接入，形成真实 capacity / impact 分桶。继续不伪造 maker 队列成交概率。
- **统计报告已进入最小正式版。** 当前 full-trial report 已避免只看 winner，并加入 deflated edge probability 与四时间块 CSCV/PBO；后续要继续补 White Reality Check / Hansen SPA 和更严格的 DSR / min track record length。

## 实用流程判定

可投入使用的范围：

- 用 calibration suite 判断数据、成本、funding、panel 是否可靠。
- 用 campaign 做少量预声明假设验证。
- 把 locked holdout 通过者送入 shadow，禁止直接 live-small。
- 用 forward holdout 测试版验证冻结候选在 `frozen_at` 后真实闭合样本上的信号表现；结果只能进入 shadow/review 判断。
- 用 R&D shadow tracker 持续跟踪 forward 信号；关闭后生成 review draft，再决定是否整理为正式 strategy evidence。
- R&D tracker 需按 [rd-event-chain-design.md](rd-event-chain-design.md) 补 entry / observation / exit / review_draft 事件链；否则 review 只能看终点，无法区分 entry、exit、regime、execution 归因。
- 用失败 ledger 指导回到数据、成本、regime、样本或假设层，不继续加 trial。

暂不应投入使用的范围：

- 自动连续挖策略。
- 单资产漂亮回测升格。
- 未自动归因的 shadow 样本升 live-small。
- 看完 holdout 后改参数/过滤器继续使用同一 holdout。

## 最小整改队列

1. 接入可靠 delisted / inactive 历史数据源，并形成 listing-age-aware calibration universe。
2. 补 White Reality Check / Hansen SPA 与更严格 DSR / min track record length。
3. 接入订单 notional / ADV / depth，形成 capacity / impact 分桶。
