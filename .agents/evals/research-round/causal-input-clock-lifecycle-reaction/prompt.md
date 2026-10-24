---
description: Keep native lifecycle close reactions on their own event contract instead of imposing an extra completed-bar delay.
tags: [method, causal-input-clock]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在审查一个永续合约策略的下架分支。普通入场的日线信号、数量依据和规格价均来自严格早于提交的已完成事件，这部分已经核清。

策略在原生 `PRE_CLOSE` 状态事件到达时立即禁止新风险、撤单，并按原生实际持仓执行 reduce-only 清仓：

```python
def on_instrument_status(self, event):
    if event.action == MarketStatusAction.PRE_CLOSE:
        self.halted = True
        self.cancel_all_orders(self.iid)
        self.close_all_positions(self.iid, tags=[self.plan], reduce_only=True)
```

`PRE_CLOSE` 发生在 `12:00:10Z`，没有公布结算价的 `CLOSE` 在 `12:00:20Z` 到达。这个预检的原生事件顺序已核实为：先收到 PRE_CLOSE，再提交清仓单，再成交；它们可有相同时间戳。CLOSE 前已无持仓和工作订单，生命周期审计通过。清仓数量只来自当前原生持仓，没有读取当分钟 OHLC 或用价格推测成交。

同事想把“所有下单都必须等下一根已完成分钟 bar”的统一门禁放在清仓前：等 `12:00:59.999Z` 再平，理由是状态事件也不能和下单同刻。请评审这个改法以及当前分支的因果边界。只给判断和需要保留的限制，不执行回放或改文件。
