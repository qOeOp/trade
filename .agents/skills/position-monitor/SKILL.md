---
name: position-monitor
description: >-
  Orchestrate active-position monitoring using capability-based steps rather
  than fixed skill names. Use when Codex needs to decide whether current
  holdings or working orders need adjustment.
---

# Position Monitor

这是一个任务级编排 skill，不绑定具体实现名，只定义能力顺序。

## 目标

当用户问“盘面变了吗”“现在要不要调整”“我的持仓现在怎么看”时，先恢复账户暴露，再围绕活跃标的做快照和深判，最后给出动作建议。

## 编排原则

- 只描述能力块，不把当前 skill 名固化成长期接口
- 优先复用仓库里现成的原子能力
- 如果已有证据足够回答，就可以提前停止；如果证据不足，再进入下一层

## 能力顺序

1. 恢复账户暴露
   读取当前持仓、挂单、保护单、余额，识别活跃 symbol。

2. 获取单标的实时快照
   对活跃 symbol 补 `24h ticker`、合约 funding、open interest 这类快照语境。

3. 拉取多周期 K 线
   当用户在问“要不要调整”“结构有没有变”“哪里加减仓”时，默认拉取相关 symbol 的 `1d / 4h / 1h`。

4. 运行技术分析
   基于本地 OHLCV 输出结构、支撑阻力、趋势线、失效位和指标摘要。

5. 汇总调整建议
   输出“维持 / 减仓 / 上移止损 / 等待 / 放弃 / 重新观察”等结论，并明确证据来自哪一层。

## 运行边界

- 这是编排入口，不应该重复实现底层数据拉取逻辑
- 当前仓库里可用的具体 skill 只是“当前实现”，不是这个编排 skill 的长期接口
- 若当前没有活跃持仓或挂单，再考虑切到全市场扫描
