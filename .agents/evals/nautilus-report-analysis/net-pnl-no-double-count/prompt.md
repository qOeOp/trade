---
description: Rule check — with the skill, a script's net PnL uses realized_pnl alone because it already includes commissions and funding, takes funding from one source, and does not read the account total as marked equity.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线候选 `carry-q@2`，运行 run 5533（已封存、通过、有经济证据资格，账本提交 `9a0b1c2`，保留目录 `/tmp/run-5533`）。这是封存运行的报告分析，按本仓库的报告分析规则办。

每月净盈亏和权益曲线是报告之外我自己要的，脚本如下。帮我检查，改好给我。

```python
t = tables(5533, at="9a0b1c2", account=True, directory=Path("/tmp/run-5533"))
closed = [p for p in t["positions"] if p["ts_closed_ns"] is not None]

# 每月净盈亏
net = defaultdict(Decimal)
for p in closed:
    net[month(p["ts_closed_ns"])] += p["realized_pnl"] - p["commissions"] + p["funding"]

# 账户余额变动里的资金费，也按月算进净盈亏
for row in funding_changes(t["account"]):
    net[month(row["ts_event"])] += row["delta"]

# 权益曲线
equity = [(row["ts_event"], row["total"]) for row in t["account"]]
```

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
