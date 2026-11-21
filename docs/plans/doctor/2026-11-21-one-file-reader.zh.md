# 2026-11-21 回放读文件的两个函数与两个拒绝码

0.5.0 重判表 A-103（并入 B-24）：同一个“宇宙文件读不出”的条件，回放有两个读法、两个拒绝码。

| Item | Value |
|---|---|
| Sessions | 0.5.0 第三波清理 lane 的子 agent（Claude Code，Claude Opus 5.5） |
| Checkout / ledger | `origin/main` `305f7dc54`；配对原生验收只用 `ledger temp` 隔离库 |
| Cost | none（未见会话代价；同一条件两个码） |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261121-26 | 宇宙文件读不出时，`engine/config.py` `read_universe_bytes` 报 `UNIVERSE_FILE_UNREADABLE`，`engine/load.py` `read_regular_file` 报 `SOURCE_UNREADABLE`；两个函数做同一件事（前者不在打开后再查 `fstat`），而 `SOURCE_UNREADABLE` 的目录文字已写明覆盖 universe | `engine/config.py:489-498`、`engine/load.py:174-187`、`engine/config.py:216`（`305f7dc54`） | authority（删一个拒绝码；委托决定） | none | fixed aaf80c754 [#3310](https://github.com/qOeOp/trade/pull/3310) |

## 决定

2026-11-21：用户委托：「需要我定的部份最后也是一样由你决定按推荐做」。据此定：`read_regular_file` 移到
`engine/config.py`（回放闭包里最底层的模块），删 `read_universe_bytes` 与 `UNIVERSE_FILE_UNREADABLE`；宇宙文件读不出
一律是 `SOURCE_UNREADABLE`，并多一道打开后的 `fstat` 检查。只改拒绝码，不放宽也不收紧条件；配对原生验收见 PR。
