# Replay Reference Engine

Owns the deterministic EventKey total order and source-bound order orchestration for Simulator v9. Same-time phases are delisting `00`, funding `10`, exact mark/risk/liquidation `15`, OHLC market `20`, ledger `70/100`, and order side effects `90`. A venue-risk epoch effective at `t` is resolved before each SourceEvent. Exact breach and stop/target gap/touch retain priority over strategy Orders.

Engine 消费 Request v21、Dataset Manifest v7 与 Timeline v8。唯一 partial lane 在冻结 open 全成 fixed quantity，并在同一 source boundary 原子执行 old stop/target cancel → remaining-quantity stop/target submit/activate；trigger 保持不变，后续 Funding、Margin、State Snapshot 与 terminal owner 均读取剩余仓位。它不是流动性 partial-fill 模型，也不是通用 OCO/matching engine。

每个 simple-bracket stop/target 终止必须生成 `OHLCV Resolution Evidence v3`：除 source/bar/path/protection 外，每条 path 以实际 entry basis、当前数量、冻结 cost/Numeric/increment 计算 execution price、gross PnL、exit fee、net terminal contribution；envelope 输出 min/max/span/canonical shortfall。open gap、单触点 span 为零；collision 保守选 stop 且 span 非零。该派生不改变 Simulator v9 Fill，不是完整 equity counterfactual 或路径概率。

R4.45 的 ordered-price oracle 仅是 tests owner 的认证参考：它以已知 observation order 判定首个 bracket crossing，证明结果属于 P1/P2 envelope，并不进入 Engine 输入、SourceEvent schema 或 capability negotiation。Engine 仍只执行 OHLCV 模式。

每个非终止 `bar_range` 完成后，Engine 必须在 checkpoint 和下一条 SourceEvent 前验证下一根 observed bar open 与当前 close 精确相隔一个 interval。若持仓将跨越缺失网格，立即返回 `open_position_grid_gap` evidence；后续 Funding/Mark/open 均不可消费。终态已经发生时不读取未来 gap，因此 consumed Result 不变。该 fence 位于 checkpoint 前，恢复不能从缺口后继续。它与连续 bar 间 observed-open `worse_open` 是不同语义。

Engine Checkpoint v16 只在一个 SourceEvent 的风险、决策、订单和保护重建副作用全部完成且 continuity fence 通过后发布；它绑定 source prefix、Timeline、entry/current bracket generation、pending/filled partial Order、partial Fill、pending final exit 与风险快照，并在恢复时验证全局 event sequence、每个 Order 的最后 OrderEvent、partial Intent/Fill 及重建 protection identity/trigger/quantity。重算 checkpoint hash 不能把语义篡改变成合法状态。Resume 必须复现 clean Result，且不得重放已提交 partial decision/Fill。Generic status/halt、tick/L2、真实 partial liquidity、multiple partial、partial liquidation、external command、portfolio matching 均不在认证范围。
