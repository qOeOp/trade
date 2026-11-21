# 2026-11-21 ruff 只开 E、F、B

0.5.0 重判表 F-09（来源 Gemini G-02 ①）：`ruff.toml` 只开 E、F、B，过时写法、可简化的结构和逐个 append 的循环
都没有检查。

| Item | Value |
|---|---|
| Sessions | 0.5.0 第三波清理 lane 的子 agent（Claude Code，Claude Opus 5.5） |
| Checkout / ledger | `origin/main` `7d2500324`；配对原生验收只用 `ledger temp` 隔离库 |
| Cost | none（未见会话代价） |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261121-46 | 质量检查不查 UP、PIE、PERF、SIM：开启后 `7d2500324` 上有 98 处（UP017 24、SIM105 21、PIE807 12、PERF401 10、UP031 10、SIM115 9、UP035 6、UP037 2、SIM102、SIM114、SIM401、UP033 各 1；SIM117 另计，已忽略） | `ruff.toml` `extend-select = ["B"]`；`ruff check --statistics` | authority（收紧质量检查；委托决定） | none | in PR |

## 决定

2026-11-21：用户委托：「需要我定的部份最后也是一样由你决定按推荐做」。据此定：开 UP、PIE、PERF、SIM，忽略 SIM117
（嵌套 with 分开写同样清楚，60 处改动只是搬动）；不开 I（导入排序，纯噪声）和 C90（122 个函数超复杂度 10，只能逐个冻结）。
由所有者负责关闭的长期句柄（日志流、导入锁、测试里交给 `addCleanup` 的文件）逐行标 `# noqa: SIM115`，其余全部改掉。
