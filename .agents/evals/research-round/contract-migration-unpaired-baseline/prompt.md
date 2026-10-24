---
description: Fixed-source v6-to-v7 recovery rebuilds a valid unpaired baseline when its old control is withdrawn, then uses only rebuilt v7 controls.
tags: [runtime, migration]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

继续已授权的开发研究。用户已明确授权把整套比较从 v6 迁到 v7 bars；产品也已支持该迁移。
源码、市场库/提交、成员、窗口和账户条款保持不变，v7 新增显式 bars 默认配置和导出元数据，
导出器和产物摘要将重新固定，没有引擎 parity 证据。每个新镜像预检仍须 fresh 审查。

旧 v6 登记链为：budget@2 的对照是 bad@1；fixed@1 的对照是 budget@2；risk@2 的对照是 fixed@1。
budget@2、fixed@1、risk@2 的源码审查有效。bad@1 后来被发现使用同刻价格输入，经济证据已撤回，
旧 v6 镜像现在不受支持。当前推荐保留 fixed@1 与 risk@2。

给出接下来如何登记和重建的顺序，并说明旧比较还能支持什么结论。不要实际执行命令。
