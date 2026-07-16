# Replay Reference Engine

Owns the deterministic EventKey total order and source-bound order orchestration for Simulator v11. Same-time phases are delisting/status `00`, funding `10`, exact mark/risk `15`, OHLC market `20`, ledger `70/100`, and order side effects `90`.

Engine 消费 Request v23、Dataset Manifest v9 与 Timeline v8。Status schedule/provenance 已由 Adapter 验证；Engine 只消费冻结 epochs，不调用 producer/provider。唯一 partial lane 在冻结 open 全成 fixed quantity，并在同一 source boundary 原子执行 old stop/target cancel → remaining-quantity stop/target submit/activate；trigger 保持不变，后续 Funding、Margin、State Snapshot 与 terminal owner 均读取剩余仓位。它不是流动性 partial-fill 模型，也不是通用 OCO/matching engine。

每个 simple-bracket stop/target 终止必须生成 `OHLCV Resolution Evidence v3`。该派生不改变 Simulator v11 Fill，不是完整 equity counterfactual 或路径概率。

R4.45 的 ordered-price oracle 仅是 tests owner 的认证参考：它以已知 observation order 判定首个 bracket crossing，证明结果属于 P1/P2 envelope，并不进入 Engine 输入、SourceEvent schema 或 capability negotiation。Engine 仍只执行 OHLCV 模式。

每个非终止 `bar_range` 完成后，Engine 必须在 checkpoint 和下一条 SourceEvent 前验证下一根 observed bar open 与当前 close 精确相隔一个 interval。若持仓将跨越普通缺失网格，立即返回 `open_position_grid_gap` evidence；只有冻结 status schedule 证明整个区间 halted 且下一 open 已 resumed 才允许继续。halt/resume SourceEvent 进入 consumed prefix；halted 时 protection 保持 active，Funding/Mark 仍可结算和观察风险，但 bar-open/strategy Fill 禁止。恢复首个真实 open 继续执行 `worse_open` bracket gap。停牌中 exact maintenance breach 返回 typed failure，不造 liquidation Fill。终态已经发生时不读取未来 gap/status，因此 consumed Result 不变。

Engine Checkpoint v17 只在一个 SourceEvent 的风险、决策、订单和保护重建副作用全部完成且 continuity fence 通过后发布；它绑定 source prefix（含 halt/resume）、Timeline、entry/current bracket generation、pending/filled partial Order、partial Fill、pending final exit 与风险快照，并在恢复时验证全局 event sequence、每个 Order 的最后 OrderEvent、partial Intent/Fill 及重建 protection identity/trigger/quantity。重算 checkpoint hash 不能把语义篡改变成合法状态。Resume 必须复现 clean Result，且不得重放已提交 partial decision/Fill/Funding。自动 status reconstruction、halt settlement、tick/L2、真实 partial liquidity、multiple partial、partial liquidation、external command、portfolio matching 均不在认证范围。

`replay-pending-order-resolution` owns `Pending Order Resolution v1`. Simulator v11 integrates only pre-entry Limit GTC：signal 时 active，next-open 起观察，open marketable/strict-cross 可在冻结 capacity 内全成但始终 queue-limited；touch remains resting。Limit Fill 严格晚于 decisive SourceEvent且不得劣价，随后才激活 bracket。Checkpoint v18 保存 resolution prefix 与 pending entry；Result v37/Artifact v39 单独绑定完整链。IOC、Stop pending、Cancel side effect 与多订单竞争未集成。
