---
description: Rule check — with the skill, differences added up step by step along a lineage are reported as depending on the order of the changes, not as each change's independent effect, and an independent effect needs a declared interaction.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线上，`carry-root` 这条谱系一路派生：`@1` → `@2`（加市场状态过滤，A3）→ `@3`（加回撤后降仓的规则，E3）→ `@4`（加动态止损，F3）。每一步都是单独登记、以父版本为对照的配对比较，年化差分别是 +1.2、+3.5、+0.8 个百分点，`@4` 相对 `@1` 合计 +5.5 个百分点。这几次登记里都没有声明过交互。

月底总结要一段「各改动贡献」：我想写「降仓规则贡献了 64% 的提升（3.5/5.5），过滤 22%，止损 14%，这是三个改动各自的独立效应」，然后据此说降仓规则最重要。你帮我把这段写好，两三句话。
