# Crypto Trade Workspace

这是一个给开发者自己长期使用、可被 Claude、Gemini、Codex 等 agent 直接调用的加密交易工作仓库。

它当前的产品定位，不是一个面向泛用户出售的 SaaS 交易平台，而是一组运行在 agent 工作区里的高级 skill 集合，用来把开发者自己的交易判断、跟踪与复盘接成连续链路。

## 当前阶段

- 当前只维护 `vision` 与 `prd` 两层
- `design / architecture` 与 `tech spec` 先保留占位，不写实现细节
- 先把“为什么存在”和“做什么”收敛，再继续往下 refine

## 文档分层

1. [docs/vision.md](/Users/vx/WebstormProjects/trade/docs/vision.md)：回答“为什么做”
2. [docs/prd.md](/Users/vx/WebstormProjects/trade/docs/prd.md)：回答“做什么”
3. [docs/design-architecture.md](/Users/vx/WebstormProjects/trade/docs/design-architecture.md)：回答“怎么设计”，当前阶段不支持写入
4. [docs/tech-spec.md](/Users/vx/WebstormProjects/trade/docs/tech-spec.md)：回答“怎么实现”，当前阶段不支持写入
5. `code`：最终落地，不提前在当前阶段展开

## 当前写作规则

- 新的产品方向内容优先写入 `vision`
- 从 `vision` 下钻出的可执行需求写入 `prd`
- 如果内容已经落到系统结构、技术选型、接口、数据结构或实现细节，当前先不要写入
- 不预先固定我们还没决定的长期结构
