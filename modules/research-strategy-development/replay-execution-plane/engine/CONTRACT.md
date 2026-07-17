# Replay Reference Engine

Owns the deterministic EventKey total order and source-bound order orchestration for Simulator v16. Same-time phases are delisting/status `00`, funding `10`, exact mark/risk `15`, OHLC market `20`, ledger `70/100`, and order side effects `90`.

Engine 消费 Request v30、Dataset Manifest v11 与 Timeline v10。Status schedule/provenance 已由 Adapter 验证；Engine 只消费冻结 epochs，不调用 producer/provider。唯一 partial lane 在冻结 open 全成 fixed quantity，并在同一 source boundary 原子执行 old stop/target cancel → remaining-quantity stop/target submit/activate；trigger 保持不变，后续 Funding、Margin、State Snapshot 与 terminal owner 均读取剩余仓位。它不是流动性 partial-fill 模型，也不是通用 OCO/matching engine。

每个 simple-bracket stop/target 终止必须生成 `OHLCV Resolution Evidence v3`。该派生不改变 Simulator v16 Fill，不是完整 equity counterfactual 或路径概率。

R4.45 的 ordered-price oracle 仅是 tests owner 的认证参考：它以已知 observation order 判定首个 bracket crossing，证明结果属于 P1/P2 envelope，并不进入 Engine 输入、SourceEvent schema 或 capability negotiation。Engine 仍只执行 OHLCV 模式。

每个非终止 `bar_range` 完成后，Engine 必须在 checkpoint 和下一条 SourceEvent 前验证下一根 observed bar open 与当前 close 精确相隔一个 interval。若持仓将跨越普通缺失网格，立即返回 `open_position_grid_gap` evidence；只有冻结 status schedule 证明整个区间 halted 且下一 open 已 resumed 才允许继续。halt/resume SourceEvent 进入 consumed prefix；halted 时 protection 保持 active，Funding/Mark 仍可结算和观察风险，但 bar-open/strategy Fill 禁止。恢复首个真实 open 继续执行 `worse_open` bracket gap。停牌中 exact maintenance breach 返回 typed failure，不造 liquidation Fill。终态已经发生时不读取未来 gap/status，因此 consumed Result 不变。

Engine Checkpoint v22 只在一个 SourceEvent 的风险、决策、订单和保护重建副作用全部完成且 continuity fence 通过后发布；它绑定 source prefix（含 halt/resume）、Timeline、entry/current bracket generation、Limit/Stop pending entry、ordered resolution prefix、pending/filled partial Order、partial Fill、pending final exit 与风险快照，并在恢复时验证全局 event sequence、每个 Order 的最后 OrderEvent、pending authority、partial Intent/Fill 及重建 protection identity/trigger/quantity。重算 checkpoint hash 不能把语义篡改变成合法状态。Resume 必须复现 clean Result，且不得重放已提交 decision/trigger/Fill/Funding/Cancel。自动 status reconstruction、halt settlement、tick/L2、真实 partial liquidity、multiple partial、partial liquidation、external command、portfolio matching 均不在认证范围。

R4.77 的 `Exact Trade Stop Resolution v1` 是 certification-only pure resolver：long 以首条 `price >= entry_trigger`、short 以首条 `price <= entry_trigger` 选择 entry reference；保护只从严格后继 aggregate-trade id 开始，第一条 stop/target crossing 成为 terminal reference。同 timestamp 仍按 aggregate id 排序。输出自哈希并绑定 coverage/events hash，但固定 scope 为 `price-trigger-order-only`，明确排除 Fill、queue、slippage、impact、insurance/ADL trades 与 archive 外部完整性。它尚未进入 Source Reducer、Checkpoint、Result 或 Artifact。

R4.85 的 Wire candidate reducer 是与 Simulator 隔离的 pre-integration fold。它只接受已通过 `non_economic_schedule_trace` gate 的 Wire v2，逐事件保存 payload hash、cross-source key 与 ambiguity-group hash，并输出四源 observation count/last-id；所有 trace event 的 `execution_effect=none`。它不得创建 Order、Fill、Position、Ledger、Metrics、Checkpoint、Result 或 Artifact，也不得被现有 reference Engine 调用。

R4.86 的 availability cursor 只消费已验证的 Candidate Trace lineage。它不重排 effective timeline，而以 `availability_at` 推进独立 visibility timeline；同一可见时刻复用 effective time/原 event ordinal 做确定性排序，不把该顺序解释为 venue 顺序。迟到事件不得在其 availability 前查询到，抵达后也只能新增可见事实，不能追溯触发 Order、Fill、Position、Ledger、Metrics、Checkpoint、Result 或 Artifact。

R4.87 的 visibility cut builder 只接受通过完整 Trace/Wire/Gate/Ordering lineage 校验的 availability cursor。Cut 使用 `availability_at <= as_of_time`，保留原 visibility ordinal，允许首事件前的空前缀，并同时哈希 future transition ids。它只证明 as-of 可见集合的闭世界完整性，不物化 payload、不执行 Harness，也不产生 decision 或 economic authority。

R4.88 的 PIT payload materializer 只接受通过完整 Cursor/Cut lineage 校验的对象，并按 Cut ordinal 从同一 Wire Manifest 精确取回 payload。每个 record 必须同时匹配 Cut transition 与 Wire event 的 source/kind/effective/availability、ambiguity、payload/source-envelope hash；缺项、换项或 payload substitution 即使重哈希也失败。未来 payload、Harness、Order、Fill、Ledger、Metrics、Checkpoint、Result 与 Artifact 均不得产生。

R4.89 的 decision observation projector 只消费已验证 PIT Payload View，逐 record 生成无任意扩展字段的只读 observation。bar-open 不得泄漏 high/low/close/volume，closed-bar 必须 `closed=true` 且 close time 等于 effective time；status observed time、funding event time、aggregate trade event/availability time须与 record 对齐。Projector 不计算 Feature、不运行 Harness、不生成 Signal/Order，也不进入 Source Reducer。

`replay-pending-order-resolution` owns `Pending Order Resolution v2`. Simulator v16 integrates pre-entry Limit GTC/IOC 与 Stop-market GTC。Stop signal 时提交/激活，next-open 起观察；open 已越过 trigger 时以 observed open 为 reference，range 首次可证明触发时以 trigger 为 reference，二者再施加方向不利 slippage。entry Order 必须 `submitted → active → triggered → filled` 后才激活 protection。range 触发 bar 若同时触达保护 stop/target，Engine 生成 self-hashed `Stop Entry Same-bar Path Ambiguity v1` 并失败，不把未知的触发后路径静默推迟到下一 bar。Limit v1/Stop v2 Cancel intent 均可固定或由 Schedule v7 `pending_entry` Harness 重算；phase-`20` trigger/fill 先于 phase-`90` Cancel，确定 non-trigger 则 Cancel 胜，更早 Fill 为 not-reached。数据边界未触发保留 active Order 并输出 `unfilled_at_data_end`。Checkpoint v22 保存 terminal 前 resolution prefix 与 Timeline；Result v43/Artifact v45 单独绑定完整链。未冻结运行时 Cancel、amend/cancel-replace、真实 trigger feed 与多订单竞争未集成。
