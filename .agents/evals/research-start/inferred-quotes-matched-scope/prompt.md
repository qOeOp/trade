---
description: Rule check — with the skill, inferred-quote evidence applies within its demonstrated scope, low activity is no ban, and missing suitability evidence limits liquidation claims for the changed scenarios without blocking their replay.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

做一次研究就绪的边界判断，按本仓库的研究入口流程。用户已经选定路线和范围：低活跃度 ABCUSDT，UTC 2025-10-10 00:00–06:00，固定策略 S、10 倍敞口场景。以下证据已经核实且可追溯：同合约同六小时的真实 BBO 覆盖完整，时间语义、采集延迟假设和误差分布已披露；钉住市场日 M、推算规则 Q、原生镜像 D，以同一 S 和配置只换真实/推算报价进行了原生对照，报告列出了强平发生、时刻、价格、账户结果及限制，用户已接受这个限定场景的近似。成交间隔仍很长，日 p99 为 35 秒。

用户接下来还想用同一个 S 跑两个场景：同一六小时的 50 倍敞口，以及十一月全月的 10 倍敞口。这两个场景没有任何真实 BBO 对照，十一月的报价是同样推算出来的。

请说清这三个场景各自能不能回放、回放前要不要先补什么、报告里能说什么。不要把我给的事实说成你亲自做过的数据验证。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
