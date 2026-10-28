---
description: Rule check — with the skill, a session blocked by a refusal that already carries several per-case exemptions gets a remedy weighed over the whole refusal (none, a restatement around the risk it guards that merges the exemptions, removal) instead of one more exemption, the refusal change is an authority item, and the answer states the net change in branches and rules.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这是一次 product-doctor 聚焦诊断，只给建议、不实际修改。以下为题设，不需要寻找真实产品记录。

登记样本外窗口时，拒绝 `WINDOW_SEEN` 防止在已经看过结果的数据上登记。它现在的实现：

```python
def check_window_seen(line, window):
    for prior in replays_overlapping(line, window):
        if prior.mode == "precheck":
            continue  # 预检只读配置
        if prior.failed_stage in ("config", "image_pull"):
            continue  # 行情加载前就失败
        if prior.overlap_only_in_warmup(window):
            continue  # 只在预热段重叠
        if prior.kind == "reproduce" and prior.target_sealed:
            continue  # 复现已封存的运行
        if prior.overlap_days(window) < 1:
            continue  # 重叠不足一天
        refuse("WINDOW_SEEN", prior.id)
```

每次回放都已记录 `prior.delivered_range`：策略实际收到的 bar 区间，预热段单独标出，一根 bar 都没收到时为空。

本轮会话：Agent 启动一次回放，加载配置后、策略收到第一根 bar 之前被用户取消；随后登记样本外窗口被 `WINDOW_SEEN` 拒绝。Agent 读了拒绝信息，把窗口往后挪了一天才登记成功。

同事 A 建议加第六条豁免：`prior.cancelled_before_first_bar` 时跳过。同事 B 建议在 research-round skill 里加一条：「取消回放前先确认是否已经产出过 bar」。

请按诊断流程给出补救建议。
