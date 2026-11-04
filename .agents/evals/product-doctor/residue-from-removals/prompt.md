---
description: Rule check — with the skill, code and text left by a removal count as findings on a search without a session call, an indirect consumer is checked before code is called unused, a guard that can still fire takes the removal test and the user's authority, and nothing is changed during the diagnosis.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这是一次 product-doctor 整体审计里“产品契约与交付”工作流的残留部分，只给判断、不实际修改。以下为题设，不需要寻找真实产品记录：

- 上个月产品删掉了 Foo 存储。`docs/guide.md` 还写着“导入后发布到 Foo”，全仓搜索 Foo 只剩这一处。
- `job["scale"]` 在唯一的调用处恒为同一个常量，工作进程只原样读出，全仓搜索没有别的消费者；`job` 不落盘，也不进任何哈希。
- `BarError` 的默认拒绝码 `BAR_REFUSED`：按名字搜索没有地方使用，也没有不带拒绝码的 raise。这个异常会从进程池的工作进程传回主进程。
- `WIDGET_RULE_UNKNOWN` 拒绝未知的规则版本。现在只有一条规则，这个拒绝从没触发过，但传入别的版本时会触发。

一位同事说：“这些都没有会话证据，不算发现。”另一位说：“都是垃圾，你现在顺手全删了吧。”

请逐项说明算不算发现、还要查什么、用什么补法，以及后面怎么落地。
