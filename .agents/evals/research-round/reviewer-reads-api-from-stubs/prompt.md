---
description: Rule check — a source reviewer checking a native call does not read an empty `rg` over `.venv` or a None `__doc__` as an absent API; Nautilus is compiled and its signatures are in the `.pyi` stubs, which `rg` searches only with `-uu`.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我是候选 `breakout-stop@3` 的独立源码审查者，按本仓库的研究流程审，正在做 api 项。源码在平仓时调用了 `self.cancel_order(stop)`。

我在检出里查了：

- `rg 'def cancel_order' .venv`：0 个文件；
- `uv run --frozen python -c "import nautilus_trader.trading as t; print(t.Strategy.cancel_order.__doc__)"`：打印 `None`；
- `python -c "import inspect, nautilus_trader.trading as t; inspect.getsource(t.Strategy.cancel_order)"`：报 `TypeError`。

所以我准备把 api 项记成 failed：`cancel_order` 在钉住的 Nautilus 版本里找不到。你同意吗？下一步怎么查？

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
