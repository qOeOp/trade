# 复杂链关系图

这张图用于帮助理解：长期使用后，系统复杂度主要来自三件事同时存在：

- 在线侧不是单线推进，而是多个 `PLAN-CHAIN` 并行，各自不断在 `OBSERVE / PLAN / EXECUTE / REVIEW` 间回返
- `WAIT-CONDITION`、`WAIT-UNTIL-FILL` 是挂在 block 或执行链上的状态，不是新的主阶段
- 复盘与外部研究不会直接混进在线主线，而是进入研究与沉淀侧，最后通过 `STRATEGY-POOL` 回接主流程

```mermaid
flowchart LR
  subgraph INPUT["输入来源"]
    U["用户消息<br/>看盘 / 追问判断 / 请求执行 / 要求复盘"]
    M["市场语境<br/>OHLCV / 宏观 / 新闻 / 快讯 / 情绪"]
    A["账户事实<br/>持仓 / 挂单 / 成交 / 余额"]
    X["外部研究输入<br/>社区 / 论坛 / 论文 / 网络 / 用户假设"]
  end

  subgraph ONLINE["在线主线（可并行多条 PLAN-CHAIN）"]
    R["INTENT ROUTER<br/>决定本轮先进入 OBSERVE / EXECUTE / REVIEW"]

    subgraph PC1["PLAN-CHAIN A（展开）"]
      O1["OBSERVE<br/>补齐 checklist<br/>市场 / 账户 / 用户上下文"]
      P1["PLAN<br/>生成下一个 block"]
      S1["block 状态<br/>noop / continue-scan / draft-closed<br/>wait-condition / ready-execute / abandon"]
      E1["EXECUTE<br/>挂单 / 市价进入 / 撤单 / 改单<br/>加仓 / 减仓 / 止损 / 止盈 / 平仓"]
      F1["执行状态<br/>wait-until-fill / partial-fill / filled"]
      V1["REVIEW<br/>阶段性闭合后复盘"]

      O1 --> P1 --> S1
      S1 -->|继续观察或条件未到| O1
      S1 -->|ready-execute| E1
      E1 --> F1
      F1 -->|未完成成交 / 账户事实变化| O1
      F1 -->|阶段性闭合| V1
      S1 -->|未执行闭合 / 放弃| V1
    end

    subgraph PC2["PLAN-CHAIN B（并行中的另一条链）"]
      O2["OBSERVE <-> PLAN"]
      E2["EXECUTE / WAIT-UNTIL-FILL"]
      O2 --> E2 --> O2
    end
  end

  subgraph RESEARCH["研究与沉淀侧"]
    D1["主 agent 研究调度"]
    H1["subagent<br/>抽假设 / 收敛规则 / 局部自测"]
    B1["BACKTEST<br/>长样本回测 / sibling 对照 / 失败聚类 / 历史回放"]
    I1["ITERATE<br/>升格 / 影子 / 分叉 / 归档"]
    SP["STRATEGY-POOL<br/>当前生效分支 / 版本 / 证明材料"]

    D1 --> H1
    D1 --> B1
    H1 --> I1
    B1 --> I1
    I1 --> SP
  end

  U --> R
  R --> O1
  R --> E1
  R --> V1
  R --> O2

  M --> O1
  A --> O1
  A --> E1
  X --> D1

  V1 --> D1
  SP -.当前语境下读取.-> O1
  SP -.当前语境下读取.-> P1
  SP -.当前语境下读取.-> O2
```
