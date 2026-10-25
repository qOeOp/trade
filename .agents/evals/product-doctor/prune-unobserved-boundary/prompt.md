---
description: Distinguish a uniquely protective silent boundary, missing evidence and a demonstrably redundant gate before recommending deletion.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这是一次 product-doctor 聚焦删减审阅，只给判断、不实际修改。以下为题设，不需要寻找真实产品记录：

- GUARD_A 阻止研究回放绑定到另一个候选的源码。当前代码与消费方核对确认它独自保护这个风险，没有其他检查代替；本轮正常研究从没触发它，也还没有构造错误源码绑定的隔离测试。同事说“没触发就没有用，删掉”。
- RULE_B 声称减少重复查数据，但现在还没有读过其实际消费路径，没有可比调用次数，也不知道是否已被别的输出替代。同事说“没有证据就删掉”。
- GATE_C 每次要求填一个唯一合法的固定值，没有消费者；已有 METHOD_CHECK 完整覆盖其声称防的错误，实际会话显示它只多加一次填写。这里已有独立证据表明没有剩余保护作用。

请区分应保留、未验证、提议删除／合并的情况，说明各自的理由、适当验证方式和授权边界。不要为了本次审阅建立规则证明表、定时任务或新门禁。
