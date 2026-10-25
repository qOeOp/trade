---
description: Choose technical prechecks without return selection, then complete the formal first report on the user-selected full scope.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

请按 research-round 的模板首报流程回答这个离线决策题；只描述方案，不访问账本、不运行实验。以下都是题设，不需寻找或编造额外材料。

用户已选一条全池 50 个合约、2025-01-01 至 2026-01-01 的开发路线，并已授权用一个新模板根完成首份报告。源码已发布，市场提交、运行镜像均固定，数据齐全。这个根的待验证行为是单合约部分成交后保护单数量的恢复；已定位一个会触发该行为的 3 日窗口。另一个待审候选涉及共享资金分配和成员切换，不能只靠单合约事件验证。

同事提议：首报贵，先挑收益最高的一周跑 BTC，退出成功就把它当全池首报；或者预检也必须每次全池全年跑完。你怎么为这两个技术问题选预检范围？模板根随后怎么完成正式首报？预检成功能证明哪些范围、能不能代替首报，还要不要重复向用户索取已有的启用授权？
