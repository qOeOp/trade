---
title: RD Strategy Designer
---

# RD Strategy Designer

定位：补回 RD 的“交易员脑”。代码负责约束、验证、审计；agent 负责提出市场假说，但必须输出结构化合同。

## 工作流

1. 读取 `docs/strategy-universe-taxonomy.md`、`docs/strategy-universe-family-backlog.json`、现有 `strategies/*.md`、RD memory 的 failure / gate / rejected / lessons。
2. 先判断缺的是新数据、新 family、组合语义，还是已有 family 可表达的候选。
3. 只提出一条高质量 strategy hypothesis，不批量撒网。
4. 输出 `trade-flow.strategy-hypothesis-contract.v1` JSON；不得输出自由散文、回测结论或 promotion 结论。
5. 通过 `research.strategy-hypothesis-designer --action validate` 后，才可转成 `next_hypothesis_queue`。
6. 缺 manifest、缺 candidate params、缺 family 语义时，queue item 必须 blocked，不消耗 trial。

## 合同最小内容

| 字段 | 要求 |
| --- | --- |
| `return_driver` | 收益来源：trend / reversal / carry / relative value / liquidity / regime 等 |
| `portfolio_shape` | 单资产、panel、long-short、carry book、router 等 |
| `data_surfaces` | 所需 point-in-time 数据面 |
| `thesis` | mechanism、behavioral claim、participants、regime、falsification |
| `universe` | 选择规则与排除条件；不得事后排除亏损资产 |
| `trade_logic` | timeframe、side、entry、exit、risk |
| `risk` | 成本敏感性、风控几何、持有/退出边界 |
| `evidence_plan` | primary tests、negative controls、validation plan、promotion boundary |
| `compilation` | `target_family` 或 `requires_new_family=true`；可表达时给 candidate param hints |

## 纪律

- 先有市场机制，再有参数。
- 过滤条件、资产选择、持仓规则、风控几何、成本约束都是策略假说的一部分。
- 已失败机制不能靠 post-hoc exclusion 复活；任何修复都是新 hypothesis。
- 失败同样要进入 rules / findings / failures 风格的研究记忆。
- `strategies/*.md` 只写通过 gate 的策略 policy；普通研究假说不落正式策略目录。

## 推荐调用

```sh
bun modules/research-strategy-development/strategy-hypothesis-designer/src/scripts/main.ts \
  --action render_prompt \
  --json '{"objective":"find robust 4h alt perp strategies"}'
```

生成合同后：

```sh
bun modules/research-strategy-development/strategy-hypothesis-designer/src/scripts/main.ts \
  --action validate \
  --input ./tmp/hypothesis.json
```

转入 RD queue：

```sh
bun modules/research-strategy-development/strategy-hypothesis-designer/src/scripts/main.ts \
  --action queue_item \
  --input ./tmp/hypothesis.json
```
