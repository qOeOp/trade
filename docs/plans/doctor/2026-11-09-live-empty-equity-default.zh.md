# 2026-11-09 Live 空收益数据默认视图

| Item | Value |
|---|---|
| Sessions | Codex 01a1b0a1-c7f5-7381-b08a-36a7084eaca9；用户于日本时间2026-11-09先发截图询问刷新后K线消失；未单独计量精确提交时间 |
| Audit session | 同会话 focused diagnosis，非全量审计；独立工作树 `/tmp/trade-live-empty-equity-default-20261109` |
| Checkout / ledger | fetch及写记录前远程核对 main `9482a8c9016737899d3bf78c5e42c4c0ffdd4df4`；不读写账本、服务器、凭据或账户 |
| Coverage | live.views._minute_results → liveTradingMap.equityOf → LiveRunCanvas默认选择 → LiveEquity/liveLine；截图不证明K线数据丢失，未核对真实运行原件 |
| Cost | 用户刷新后看到空收益页面，误以为K线不再显示；wrong output；耗时/tokens/交易影响未计量 |
| Net change | 建议复用现有liveReading的已知值判断决定默认视图；不新增存储、API、引擎、拒绝/审计规则、时区或技能文字；手动选择不变 |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261109-02 | 有equity对象但无已知分钟结果时，刷新错误默认到空Equity页 | 用户截图显示Equity选中、提示No minute…，Coins仍可选。LiveRunCanvas.tsx:30只判断run.equity对象；liveTradingMap.ts:24–25将空minute_results映射为非空equity对象；live/views.py:219无minute_result时返回空列表；LiveSwitches.tsx:35–40/liveEquity.ts:16–17需要至少一个已知分钟才有曲线。新增实际组件SSR回归在空列表情形对当前main失败，保留于 `/tmp/trade-live-refactor-goal-20261108/live-empty-equity-before.log`。原应由Product contracts and delivery覆盖；前次浏览器夹具分别覆盖字段缺省与已知结果，漏掉空列表/全null。 | fix | wrong output | open |

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| 用equity对象存在代替可画数据 | 无数据时仍能提供行情入口 | 现有liveReading按最后已知分钟派生读数；LiveEquity按相同已知值集合画线 | 空列表对象也是真值，错误选中空页 | 默认只在已有已知读数时选Equity，否则Coins；不改变用户主动选中的页面 |

## Decisions

用户已要求修复Live显示问题，执行普通展示修复和隔离测试。新增用例覆盖字段缺省、空列表、全null、零值及混合已知/未知；浏览器另核对刷新默认和手动切换。修改同一选择表达式即可消除错误，保留/加操作说明不能纠正刷新默认行为；无需增加模式偏好存储或重建历史收益。

本条不推断真实账户状态，不修改任何交易/验收检查，也不合并部署。
