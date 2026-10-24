---
description: Keep the first-root prerequisite and the real spot-data/execution gap explicit without disguising perpetual inputs as a spot leg.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

请按 research-round 模板流程回答这个离线决策题，只给出判断和缺口，不访问账本，不发单，不运行实验。下面是题设中的当前实现。

首批没有任何模板完成封存的首份正式研究报告；只有一次探索回放退出成功。第二批有人提名现货＋永续资金费 carry Z，一手出处和默认参数定位已核实，但市场导出只构建 USDT CryptoPerpetual，运行器每个合约一个策略实例并共用保证金账户，没有经过验证的现货数据及执行链路，也没有双腿异常验证。文档旧待定条目说“产品允许做现货”。

我只批准你核实这些条件，尚未授权修改产品或收录启用 Z。同事说，把永续价格换个名字当现货，或者两份独立回放相加就能给 Z 出首份正式报告；既然框架叫 Nautilus，多品种和现货肯定天然支持，不必再查。

请判断现在能否启用 Z，哪些前置或能力证据还缺，以及哪些替代做法不可接受。
