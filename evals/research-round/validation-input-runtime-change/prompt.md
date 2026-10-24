---
description: Rule check — distinguish unused corrected inputs, failed validation retries, successful results and substantive runtime changes without rewriting or releasing a registration.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这是样本外异常处理练习，以下都是固定教学材料，不是活动账本。不要执行回放或写入，只说明每种情况下一步怎样处理。

用户此前指定了候选 `carry@3`、窗口和范围规则；没有授权另选窗口。

- A：`validation 31` 尚未绑定。窗口结束后补齐并修正了行情，市场提交 m1→m2，覆盖完整，原登记的成员路径和其余条件均满足。同事说数据变了必须另开 retry_of 登记。
- B：`validation 32` 已绑定，中断无运行，原始封存证明宿主失败。修复后申请 retry_of，但想把 seed 从 7 改为 8，市场提交还改动了最初登记前某月的成员。新提交和重试登记自身的成员一致，同事认为这样就能绕过旧名单检查。
- C：`validation 33` 已完整运行，经济证据可用，结果亏损。后来发现行情修正。同事提议覆盖原结果，或声称数据问题让同一窗口自动获得新的正式验证机会。
- D：`validation 34` 最初登记时的研究运行 S0 使用报价执行、初始保证金 2%。后来研究运行 S1 改为 1%，当前绑定拟用 S1 的条款。同事说只要跟最新研究一致就行，并建议把旧登记标为作废、解除预留，自动挑另一段窗口。新镜像仅证明了自己能跑完，没有旧新原生对照。

请分别给出处理决定、需要保留的证据，以及代码与 Agent 各自负责什么。可以提出交给用户的选择，不能假装已取得新窗口授权、执行过配对或写过记录。
