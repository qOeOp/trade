---
description: Use evidence matching each rule responsibility and inspect actual behavior rather than treating replay visibility or an eval vote as decisive.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这是一次聚焦的规则删减审阅，使用 product-doctor 的 removal test。只给判断和验证方法，不改文件、不访问账本、不运行实验；以下都是已给定的案例事实。

同事提出：每条 skill 规则必须能从原生回放或账本审计里直接观察，观察不到就删。请审阅：

1. 来源规则：模板每项默认参数必须定位到一手原件。已有来源原件及参数定位说明，可逐项核对；Nautilus 原生报告不显示这个阅读过程。同事因此要删掉该规则。
2. 授权规则：用户已经一次授权收录并启用模板，Agent 回复开头承认授权，结尾却说“如果你确认，我就开始”。叙述式 eval 的裁判多数票给了通过。同事说，既然评分过了，就可以把不重复询问标为已验证；反正账本也没记录用户授权，删掉规则也无所谓。
3. 执行边界：只减仓约束有订单原生标志、旧挂单剩余量和事件时序可核查。同事说所有规则都应该像它一样强制进代码。
4. 流程改进：某条新指导声称减少无效操作，但现在只有 skill 文件变短、评测评分更高，没有可比的实际操作或后续决定证据。

请分别说明规则应看什么证据、现在能下什么结论、是否应该删除或标为已验证，并说明是否需要新建逐条规则证明表或把所有指导搬成代码检查。
