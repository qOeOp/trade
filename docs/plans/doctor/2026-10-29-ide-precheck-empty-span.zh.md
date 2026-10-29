# 2026-10-29 IDE 旧预检重新撑开空白区

| Item | Value |
|---|---|
| Sessions | 当前 Codex 会话；用户在部署 #1886 后提供 `ema-entrybudget-202210` 滑动到左端的截图 |
| Audit session | Codex；`01a186b8-0609-74a1-8dac-29820838c998`；工作区 `/Users/vx/.codex/worktrees/e510/trade`；本会话编写 #1886、#1887；聚焦复查，非独立完整审计 |
| Checkout / ledger | 检出及运行镜像均为 `f72cdb370`；只读 IDE 图数据保存在 `/tmp/ide-entrybudget-live-view.json`；截图为 `tdsomdac`，当前读取未钉该短引用 |
| Coverage | 实际节点、尺标 trial 列表、几何边界、初始化、Home、滚轮平移及共享轴；不评价策略或研究结论 |
| Cost | 用户再次发现错误输出；研究及本次诊断耗时、tokens 未单独计量；未运行研究试验，未写活动账本 |
| Net change | 替换左边界的来源，移除把尺标历史当画布内容的取最小值规则；不新增定位模式、存储字段、skill 规则或拒绝分支；回归覆盖早于首节点的旧预检 |

## Findings

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261029-201 | #1886 把 trial 0 改为该线最早 trial，却仍把未画成节点的旧预检当作画布内容。用户滑至左端时又看到大片空区 | 用户截图首节点 239、左端 212；真实视图的节点从 239 开始、axis.min 为 236.5，trials 仍含预检 212/236；`bounds()` 的 `Math.min(widget.axis.min, ...trials)` 得到 212。原生浏览器验收只测了另一条线，其首预检恰好接近首节点；几何测试还错误要求旧预检可撑开边界。属于 Product contracts and delivery 漏报，用户先发现 | fix：左边界由实际绘制的节点确定；继续保留真实 trial 编号、详情中的旧预检，以及右侧重跑和收益点的可达范围。验证真实 EMA budget 与 channel breakout 两条线的初始化、Home、节点聚焦、左右平移、宽窄视口和侧栏切换 | wrong output | recurred |

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| 最早尺标 trial 决定画布左端 | 让旧预检在尺标上可见 | 详情的 Replays 表保留所有预检；画布本身只在每版本的首研究运行或无研究运行时的首 trial 画节点 | 旧预检 212 没有节点，却把第一个节点 239 推到约 864px 之后 | 删除此规则；左端从实际节点派生，保留数据和编号 |

## Decisions

沿用用户本会话已要求的全部修复、测试、创建 PR、合并、更新 IDE 镜像和重启授权。`none` 不能修复实际错误输出；用已有节点定义边界即可，无须新机制或改写历史记录。上次的 channel-breakout 验收不能证明这条 EMA 线已修复，原始记录保留，本记录追踪复发。
