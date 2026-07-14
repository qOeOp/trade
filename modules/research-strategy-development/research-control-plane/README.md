# Research Control Plane

RD 权威治理面。当前 canonical owner：

```text
contracts/          跨 Plane 身份与 Draft 授权合同
state-store/        Universe、Proposal、Contract、Trial、Result、Review、Lifecycle、KG 单写者
strategy-registry/  accept_for_draft 后的确定性策略物化与注册
tests/              Contract -> Replay -> Review -> Draft -> Forward 纵切认证
program-control/    迁入的 RD program memory，待继续抽离 planning 逻辑
program-supervisor/ J04 legacy job shell，已在 Control 子树内但不等于长期权威 API
dataset-governance/ split/funding 数据准入治理
certification/      迁入的跨 Plane 回归认证
compatibility/      等待 Strategy Registry 调用方切换的旧 adapter
```

RD 根级旧模块已经物理清除；上述 migration-source/compatibility 实现仍须按 `docs/rd-module-disposition.json` 逐项拆分，不得因进入本子树就获得长期权威地位。
