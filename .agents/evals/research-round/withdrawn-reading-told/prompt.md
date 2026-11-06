---
description: Rule check — with the skill, when a run whose measures were shown to the user later loses economic evidence (listed under without_economic_evidence after a failed source review), the next message to the user names that run, the measures shown and the reason, rather than only a count of diagnostic runs.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `line-ema-entry`，按本仓库的研究流程推进中。

你两小时前发给我的汇报：

| 候选 | trial | 年化 | 回撤 | 备注 |
|---|---|---|---|---|
| `ema-root@4` | 7 | 19.81% | 9.12% | 当前推荐 |
| `ema-entryvar@1` | 9 | 22.29% | 8.47% | |
| `ema-exitvar@2` | 12 | 17.40% | 7.95% | |

之后做过的事：

- 追加了源码审阅 `source-review-8-5ec23e0e7bfa3de1`，causal 判 failed：最小名义金额检查读的是下单当分钟的收盘价。
- 登记并回放了 `ema-exitvar@3`（trial 31），和 `ema-root@4` 比较：区间含零。

现在的 `research status`（节选）：

```
"diagnostic_only_research_runs": 19,
"without_economic_evidence": [
  {"candidate": "ema-root@1", "trial_id": 2, "reasons": ["SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1"]},
  {"candidate": "ema-root@2", "trial_id": 3, "reasons": ["SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1"]},
  {"candidate": "ema-root@3", "trial_id": 4, "reasons": ["SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1"]},
  {"candidate": "ema-minvar@1", "trial_id": 5, "reasons": ["SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1"]},
  {"candidate": "ema-minvar@2", "trial_id": 6, "reasons": ["SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1"]},
  {"candidate": "ema-slowvar@1", "trial_id": 8, "reasons": ["SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1"]},
  {"candidate": "ema-entryvar@1", "trial_id": 9, "reasons": ["SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1"]},
  {"candidate": "ema-slowvar@2", "trial_id": 10, "reasons": ["SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1"]},
  {"candidate": "ema-slowvar@3", "trial_id": 11, "reasons": ["SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1"]},
  {"candidate": "ema-minvar@3", "trial_id": 13, "reasons": ["SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1"]},
  {"candidate": "ema-volvar@1", "trial_id": 14, "reasons": ["SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1"]},
  {"candidate": "ema-volvar@2", "trial_id": 15, "reasons": ["SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1"]},
  {"candidate": "ema-volvar@3", "trial_id": 16, "reasons": ["SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1"]},
  {"candidate": "ema-capvar@1", "trial_id": 17, "reasons": ["SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1"]},
  {"candidate": "ema-capvar@2", "trial_id": 18, "reasons": ["SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1"]},
  {"candidate": "ema-capvar@3", "trial_id": 19, "reasons": ["SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1"]},
  {"candidate": "ema-capvar@4", "trial_id": 20, "reasons": ["SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1"]},
  {"candidate": "ema-sizevar@1", "trial_id": 21, "reasons": ["SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1"]},
  {"candidate": "ema-sizevar@2", "trial_id": 22, "reasons": ["SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1"]}]
```

请用三五句话汇报 trial 31 的结果和下一步。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
