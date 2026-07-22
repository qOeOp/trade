---
title: RD Replay Execution Plane
role: research-feature-contract
status: active-partial
owner: replay-execution-plane
last_verified: 2026-07-22 CST
---

# RD Replay Execution Plane

## 1. 定位

Replay Execution Plane 是冻结实验的确定性执行与证据生产面。它消费 Control Plane 授权的 Trial / Attempt / Reservation、不可变 Experiment Contract、Dataset Manifest 和 execution assumptions，产出可复读 Result / Artifact / Fingerprint。

它不生成 hypothesis，不修改 Experiment Contract，不决定 promotion，不写在线 `trade.db`，不调用 Binance write。

## 2. Authority

| 问题 | 权威 |
| --- | --- |
| 当前 maturity、active milestone、gate truth | [rd-replay-maturity-gate.json](../reliability/rd-replay-maturity-gate.json) |
| 输入输出 wire 与版本 | Plane 下各模块 `CONTRACT.md` / schema |
| Trial / Attempt / Lease / Reservation | Research Control Plane state store |
| Dataset / source lineage | frozen Dataset Manifest 与 source attestation |
| 本文 | 跨模块不变量、能力边界、禁止项 |

旧 R4.x / M4 研发日志见 [Legacy RD Replay Execution Plane Design](../../history/legacy-rd-replay-execution-plane-design.md)，不得覆盖机器 gate。

## 3. 执行链

```text
Control Plane authorization
  -> Request / Reservation / Attempt Lease validation
  -> frozen data + policy admission
  -> deterministic schedule / event ordering
  -> engine + accounting
  -> Result / Artifact / Fingerprint
  -> idempotent publication
  -> Control Plane result intake
```

每一层只放大已授权的输入，不自行补策略语义、数据或权限。

## 4. 核心不变量

- 相同 contract、dataset、code/build、policy 和 authority 输入必须得到相同结果与 fingerprint。
- event-time 与 availability-time 分离；所有 feature、signal、status、funding 必须 point-in-time 可见。
- Trial、Attempt、Lease、Reservation、Request、Result 必须 hash-bound，generation / expiry / ownership drift fail closed。
- engine 只执行冻结 schedule；未声明 order、partial、amend、cancel、reentry 或 supplemental decision 均禁止。
- cash、collateral、position、fee、funding、realized / unrealized PnL 与 risk 必须守恒并可由 artifact 重算。
- checkpoint / resume 不得重复 Fill、Funding、publication 或 sequence。
- typed unsupported 优于用 OHLCV、aggregate volume 或当前 snapshot 伪造历史 queue / liquidity / status。

## 5. 当前能力口径

机器 gate 当前证明的是受限 vertical slices，不是通用交易所模拟器。已认证项只能按 gate 中为 `true` 的 functional / evidence / cutover 字段表述；active milestone 任一要求仍为 `false` 时，不得宣称该 milestone 完成或 maturity 升级。

典型已覆盖面包括：

- 冻结单 lane 与部分 portfolio execution / accounting 证据链。
- 严格 schedule、数量边界、protection generation 与 clean/resume parity 的受限场景。
- 固定 funding / mark / terminal risk 与 artifact lineage 的已列证据。

典型未开放面包括：

- 真实 queue、market impact、概率 partial 和无历史 L2 的 maker 成交推断。
- 动态 sizing、未预声明第三次 partial、通用 post-partial mutation / reentry。
- 通用 cross-margin、borrow、完整 remote transport / OS sandbox、Fast kernel parity。
- P28 已认证的 post-partial stop replacement owner accounting、Artifact 与 bounded full-flat cycle 只属于专用 opt-in successor；不能外推为默认 Portfolio 或通用 mutation。
- P29 已认证的 bar-linked aggregate-trade sidecar 只解决一个初始 Stop-market same-bar typed ambiguity；不构成通用逐笔撮合或真实 Fill 证明。

## 6. 数据与市场现实

- OHLCV 只证明 bar 范围，不证明 intrabar queue 和成交顺序；歧义必须使用冻结 policy 或 typed unresolved。
- Funding、instrument status、aggregate trade 等 source 需要各自完整性、availability 和 lineage attestation。
- L2 只接纳 owner-pinned、单 epoch contiguous 的 compacted source。当前 bounded adapter 验证 Parquet row identity、raw payload hash 与 `U/u/pu` 邻接，但固定 `external_completeness=not_verified`、`economic_authority=none`、`runner_compatibility=not_bound`；不得跨 epoch 拼接或据此推断 queue / Fill。
- 当前 REST snapshot 不能倒推历史状态；`external_completeness=not_verified` 不能升级成 complete history。
- replay fill 是模型事实，不冒充 Binance 实际成交。

## 7. 结果与证据

Result / Artifact 至少绑定：

- experiment / candidate / trial / attempt identity。
- reservation / request / lease / generation。
- dataset / source / split / PIT lineage。
- code/build / contract / policy versions。
- event sequence、orders、fills、ledger、terminal state。
- warnings、limitations、unsupported reason 与 publication identity。

summary 不是 authority；缺 required member、hash drift 或重放不一致即拒绝 intake。

## 8. 最后一个功能纵切：bar-linked aggregate-trade path

M4-P29 只处理一个现有 typed failure：pre-entry Stop-market 在 bar 内触发后，同一 bar 又同时覆盖保护 stop/target，而 OHLCV 无法证明触发后的先后。Binance USDⓈ-M Kline 暴露 O/H/L/C、base/quote volume 与 trade count；aggregate-trade 接口给出 aggregate id、价格、数量、underlying first/last trade id、时间和 maker side，并说明它压缩 100ms 内同价同 taker side 的 market trades、排除 insurance/ADL（[Kline](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#klinecandlestick-data)、[Aggregate Trades](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#compressed-aggregate-trades-list)）。这些字段只定义输入语义，不自动构成仓库 authority。

P29 已在上述边界内完成：immutable source、同一 half-open bar window、PIT availability、aggregate/underlying id 连续性以及 O/H/L/C、base/quote volume、trade count 全部逐字段闭合后，ordered aggregate prices 才能选择该 bar 的 Stop-entry 后保护 owner；否则保留原 typed unresolved。Checkpoint、Result、Fingerprint、Artifact、clean/resume、幂等复读和 tamper rejection 已闭合。`external_completeness=not_verified` 不得改写；该 Evidence 不证明 hypothetical queue、Fill quantity、maker probability、slippage、impact、insurance/ADL 或通用跨源经济顺序。默认 OHLCV、Portfolio 与 P15–P28 路径保持不变。

## 9. 变更合同

新增能力必须在同一有界 change set 中包含：schema / contract、真实 consumer、golden / tamper / resume evidence、artifact 绑定和 maturity gate 更新。只加 schema、phase 编号或零实例壳不算进展。

完成一个 milestone 前必须运行 owner checks 与 `bun scripts/check-rd-replay-maturity-gate.ts`，并确保 gate 的所有要求同时为真。

## 10. 有限 M4/M5 收敛合同

P29 是最后一个按功能编号推进的 Replay 纵切；`M4-P30` 明确禁止。后续成熟度只由固定 exit gates 推进，不因新增 schema、successor、测试数或提交数上升。

| 等级 | 准确含义 | 退出原则 |
| --- | --- | --- |
| M3 | 多条受认证的有界纵切可产生可信证据，但公共入口、默认/opt-in/compatibility 与 wire epoch 尚未收敛 | 已退出 |
| M4 | 已声明能力形成有限产品面：公共入口唯一、opt-in 激活显式、compatibility 隔离、Result/Artifact/Checkpoint epoch 收敛、统一 owner certification 可执行 | 当前状态；九项 M4 gate 已同时为真 |
| M5 | M4 产品面达到 release-grade：跨进程复现、历史 Artifact 迁移、crash/exactly-once、容量边界、故障注入、可观测/runbook、冻结 fixture pack 与独立审计全部完成 | 九项 M5 gate 必须同时为真 |

M4/M5 都相对于**声明的能力包络**，不要求伪造不可能证明的交易所现实。queue、真实 partial-fill、impact、insurance/ADL、cross-margin、borrow 或 Fast 若缺 authority/source/独立实现，保持 typed unsupported 也可以达到 M5；不得为了“升成熟度”把它们偷偷加入范围。

机器 gate 的字段集合是封闭集合；新增 exit gate、恢复 P 编号或增加 simulator capability 都需要单独的架构重开决定，不能由自动迭代自行完成。

## 11. P1–P29 归并基线

[Capability Inventory](../reliability/rd-replay-capability-inventory.json) 冻结全部 29 条纵切：14 条进入目标 canonical 实现/入口，12 条保留为显式 opt-in，3 条只作 compatibility，当前没有未经 dependency proof 即可删除的 obsolete 条目。P12 是后续 terminal-aware/opt-in cycle runners 仍在复用的 bounded-sequence 原语，不能误判为 compatibility；P10、P11、P13 才是当前历史读回/迁移对象。该分类是迁移起点，不代表 29 套公共 API。canonical 公共面只允许四个 Runner owner 入口：

| Profile | 唯一入口 |
| --- | --- |
| single-trial | `runReplayTrial` |
| independent-lane-batch | `runReplayIndependentLaneBatch` |
| integrated-portfolio | `runReplayIntegratedPortfolio` |
| terminal-aware-bounded-cycle | `runReplayPortfolioProtectiveTerminalCycleSequence` |

其余 P19–P29 successor 必须经 capability registry 显式激活，不能继续各自演化为公共产品入口。P10/P11/P13 执行消费者已物理隔离到 `compatibility/legacy-portfolio-cycle`；其 schema 只为历史 Artifact 读回保留，禁止新增生产消费者。P12 继续由 canonical/opt-in cycle owners 复用。

## 12. Result / Artifact / Checkpoint epoch

[Evidence Epoch Registry](../reliability/rd-replay-evidence-epoch-registry.json) 冻结通用 writer 为唯一一组：Result v53、Artifact Manifest v55、Engine Checkpoint v32、Diagnostic Checkpoint Commit v2、Terminal Checkpoint v1 与 Run Outcome v35。生产源码不得继续写通用旧版本；历史版本只允许由后续 M5 migration reader 消费，不能恢复 writer。

四个公共 profile 的 profile-scoped Result/Manifest 是上层组合证据，不与通用 single-trial epoch 竞争 authority。`independent-lane-batch` 只引用 child v53/v55 与 child v32 checkpoint；`integrated-portfolio`、`terminal-aware-bounded-cycle` 当前明确没有 resumable checkpoint writer。这里的“收敛”只证明 writer 与 checkpoint mode 唯一、可机读，不把缺失能力伪装成已支持；所有 profile 的 resume/evidence 充分性仍由独立 M4 gate 验收。

## 13. Certification owner

Plane 内唯一完整认证入口是 `certification/replay-certification` 的 `bun run certify`。其 registry 必须逐一分类 Plane 下除自身外的全部 package，canonical 与 compatibility 分组顺序执行各 owner 的 `bun run check`，任一失败立即非零退出。Canonical tests 禁止反向 import compatibility；P10/P11/P13 只由 `legacy-portfolio-cycle-certification` 单向消费。该命令聚合已有证据，不产生 release verdict 或新 Artifact；M5 仍需独立冻结 release fixture/bundle。

## 14. Module / production-consumer closure

`replay-module-consumer-closure.json` 是 M4 最后一门的机器证据。扫描器以 TypeScript AST 读取 `modules/` 下静态 import、export 与 `import()`，排除 test/spec、Replay certification 源码和 Plane tests，避免把认证边误判成生产采用。当前闭包为 23 个 Replay package、66 条指向 Replay package 的生产依赖边；每个 package 必须唯一归类，每条消费者边必须落入 Replay canonical/compatibility runtime、Research Control Plane、Forward Evidence Plane 或 Agent Roles。分类计数与完整闭包 SHA-256 同时校验，新增模块、消费者或依赖变化均 fail closed。

该快照回答“当前谁在生产中依赖 Replay”，不回答“这些依赖都应该长期保留”。特别是现有 canonical 或域外 owner 对 `compatibility/` 的引用仍是迁移债务；闭包登记只防止其隐身，不授予其 canonical 地位。M4 因九门全部通过已完成；下一允许结果仅为 M5 release certification，不新增 simulator capability。

## 15. M5 cross-process reproducibility bundle

`replay-cross-process-reproducibility-bundle.json` 同时冻结两层证据。第一层是 canonical Result probe：同一 immutable fixture 由两个并发 fresh Bun process 直接调用现有 reference Engine，process identity 必须不同，runtime identity、input hash 与 Result hash 必须完全相同。第二层覆盖四个 public profile：每个 profile 的唯一 entrypoint 与 owner test source 均以 SHA-256 绑定，两个 fresh process 必须通过同一 exact semantic assertion；新增、改名或修改入口/断言均需显式复核 bundle。

跨进程复现不等于跨平台复现，也不等于所有 profile 支持 checkpoint。Receipt 明文记录当前 Bun runtime 和 PID；single-trial 认证 direct Engine checkpoint，independent batch 仅委托 child checkpoint，integrated portfolio 与 terminal-aware bounded cycle 继续声明 checkpoint 不支持。该 bundle 不替代 M5 的历史 Artifact migration、crash/exactly-once、容量、故障注入、可观测、release fixture pack 或独立审计 gate。

## 16. M5 historical Artifact read migration

P10、P11、P13 的 compatibility certification 以两层证据关闭迁移门：独立 synthetic pack 冻结 exact-v1 Manifest、role、commit marker、Result/Evidence identity 与 expected projection；完整 payload reader 另从真实 manifest-last namespace 逐文件校验 ref/raw SHA，再验证 P10 Result、P11 Result/Fingerprint、P13 Accounting/Trial Balance 的自哈希与现金不变量，输出只读 migration receipt。Pack、reader 与动态 certification test 均有冻结指纹；schema、role、payload、源码或 projection 漂移都 fail closed。Maturity checker 同时执行 pack 并验证 full-payload certification registry，不接受只改 gate 布尔值。

该 reader 没有 writer、数据库、runtime public entrypoint 或经济 authority，不产生 Result v53 / Artifact v55，不修改旧文件，也不把旧 accounting 映射成当前经济语义。Full-payload 证据由冻结测试确定性生成，不等于抽样了生产历史全集；外部生产 corpus 普查和跨版本经济升级仍不在本 gate 内。M5 当前为 `3/9`，成熟度仍为 M4；下一门固定为 crash recovery 与 exactly-once publication。

## 17. M5 crash recovery 与 exactly-once publication

Exactly-once 的权威口径是“同一 deterministic Attempt namespace 最多一个可验证 commit marker”，不是“进程只执行一次”。认证子进程先通过 local store 完成三个 payload 的 durable immutable CAS，在 manifest 前等待并被父进程真实 `SIGKILL`；此时目录必须只有 payload，因 `partial_payload_without_manifest_is_authoritative=false` 而没有 Result authority。随后两个 fresh process 并发恢复：相同 bytes 可幂等复用，不同 bytes 必须 CAS collision，最终只能有一个 `artifact-manifest.json`；第三进程必须只读得到相同 manifest/publication hash，且目录无 `.tmp`。

四个公共 profile 的恢复方式不被抹平：single-trial 可从 authorized checkpoint 恢复或确定性重跑；independent-lane-batch 没有 durable batch writer，只委托 child Trial manifest 并重算 aggregate；integrated-portfolio 与 terminal-aware-bounded-cycle 没有 checkpoint writer，只能确定性全量重跑后争用同一 manifest CAS。Bundle 冻结每个 writer、owner test 与源码 hash，防止 implementation 漂移后沿用旧认证。该结论限于单机 local filesystem、现有 fsync/CAS/manifest-last 合同；不认证 remote/distributed store、硬件损坏、exactly-once process execution，也不替代后续通用 fault injection gate。M5 当前为 `4/9`，成熟度仍为 M4；下一门固定为 declared capacity / performance envelope。
