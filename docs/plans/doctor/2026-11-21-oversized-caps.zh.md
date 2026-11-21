# 2026-11-21 超长模块只按名字冻结

0.5.0 重判表 F-11（Gemini G-02 ③）：`tests/test_source_hygiene.py` 的 `OVERSIZED` 只列 10 个超过 800 行的模块名，不记行数，列入的模块还能继续长。

| Item | Value |
|---|---|
| Sessions | 0.5.0 第三波清理 lane（Claude Code，Claude Opus 5.5） |
| Checkout | `origin/main` `9d17dbca5` |
| Cost | none（未见会话代价；Gemini 11-20 计 `ide/research_graph/serve.py` 994 行，现 1138 行） |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261121-45 | `OVERSIZED` 只按名字冻结超长模块，列入的模块继续变长检查不报 | `tests/test_source_hygiene.py` `OVERSIZED`（frozenset）；`serve.py` 11-20 为 994 行，11-21 为 1138 行 | authority（收紧检查；委托决定） | none | in PR |

## 决定

2026-11-21：用户委托：「需要我定的部份最后也是一样由你决定按推荐做」。据此定：`OVERSIZED` 改为模块名到行数上限，
上限取 2026-11-21 合入 D7 之后 `origin/main` 的实测行数；超过上限即失败；模块变短时下调上限，降到 800 行以下删掉该行，
不许上调或新增。R2（`serve.py`）等在途重构合入后各自下调对应上限。
