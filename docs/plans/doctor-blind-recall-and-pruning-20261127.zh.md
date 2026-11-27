# `product-doctor` 黑盒盲测检出率基准与实证剪枝报告（2026-11-27）

- **实验目的**：直接回应 Owner 的核心质疑——不再只跑自写单测或靠“想当然的一句话”堆规则/脚本，而是用未修补的真实 `origin/main` (`d4460250a`) + 最新 `product-doctor` 跑 **4 组完全零提示黑盒盲测**，实测真实检出率（Recall）、工具信噪比与失效模式，并按硬数据做**减法剪枝与底层修补**。
- **隔离靶场**：`/tmp/doctor-rd-sources/blind_recall_target`（只读 `origin/main` `d4460250a`，叠加 `exp/doctor-v2-convergence` @ `71895f407` 的 `product-doctor` 技能；证据留存于 `/tmp/doctor-rd-sources/blind_recall_evidence/case_{1..4}/`）。

---

## 一、4 组完全零提示黑盒盲测成绩单（共证实 24 个 `verdict: "shown"` 缺陷）

| 盲测组 | 范围（零提示） | 已知暗坑命中情况 | 额外挖出的**全新真实缺陷**（全部 `doctor.py probe` `shown`） |
|---|---|---|---|
| **Case 1** | `live` + `replay` + `ide` | 命中 `R-UI-1`/`R-UI-2`（杠杆假绿 + 停轮询 + 复用旧 `preparedId`）、`R1`（死 `--action resolve`）、`P1-OV1`（`ide/overview` DoS）、负 `Content-Length`；**漏报 `D1`**（闭线后 `replay explore` 撞 `LINE_ENDED`） | **全新 P0**：`live/reconcile.py:104` 在 6 小时 Paper 对比回放期间持 `account.lock`（`LOCK_SH`）阻塞紧急 `live stop`；`ide/research_graph/serve.py:1106` `log_request` 访问未设 `self.path` 崩退；`replay/entry.py:420` 缺文件未转 `Refusal` |
| **Case 2** | `report`（冷代码与定量正确性） | 主动切入长期未动的 `report/attribution.py` / `measures.py` / `review.py` / `status.py` / `graph.py` | **6 个全新真缺陷（5 P1 + 1 P2）**：`attribution.py:335` 对 9 个非负指标套 `< 0 / > 0` 符号检验导致 `"down"` 数学不可能；`review.py:110` 空 `run_return` 绕过审计（伪造 +9999 PnL 返 `ok: True`）；`graph.py:305` `--retry-of` 后缓存仍报 `unchanged: True`；`measures.py:267` `deflated_sharpe` 常量非零收益除零崩溃；`status.py:313` `mean_correlation` ULP 残差返 `+1.0` 压扁 `effective_trials`；`measures.py:653` 强平 `-1.0` 触发 `log1p` 崩溃 |
| **Case 3** | `market` + `deploy` | 命中 `3A-1`（P0 退市冻结 `head` 61 天）、`3A-2`（P1 `deploy/update.py` Docker `null` 切片崩溃）；**漏报 `3A-3`**（symbol 路径穿越） | **全新 P1**：`market/follow.py:41` 与 `metrics.py:39`（`SETTLE_DAYS == LAG_DAYS == 3`）导致 404 行情下 `"lagging"` **数学不可达**、健康检查永返 0；`market/store.py:698` `_universe` 忽略 `eligible` 将复用 `EQUITY` 写入 `universe_month`；`market/export.py:436` `shown_ratio` 极端多空比 `DivisionByZero` |
| **Case 4** | `live` + `paper` + `ide/overview` | **3/3 全命中（100%）**：`3B-1` `live/notify.py` 平静日丢日报、`3B-2` `paper/serve.py` 孤儿永不封存 + `paper/runs.py` 缺 inputs 崩溃、`P1-OV1` `ide/overview` DoS + 负 `Content-Length` | **独立再次命中同一个全新 P0**：`live/reconcile.py:104` 持 `account.lock` 阻塞紧急 `live stop` |

---

## 二、4 组盲测对 `product-doctor` 自身的铁证评分与剪枝决策

| 组件 / 行为 | 4 组盲测实证表现 | 实证处置 |
|---|---|---|
| **`doctor.py gates-map`（`journey_gates.py`，1,082 行）** | **4/4 组全跑了，但 0 / 24 命中（0% 召回率）**；吐出 34 KB–717 KB 噪音 JSON，13 个高危重复告警 100% 为良性假阳性 | **彻底删除**（净砍 `-1,082` 行生产资产 + 对应测试与 eval），保留高信噪比的 92 行 `references/journey.md` 与 `journey` 透镜 |
| **`doctor.py probe`** | **4/4 组极高评价**，24/24 缺陷靠 `probe()` + `control()` 在干净 `git archive` 上铁证复现 | 保留强化 |
| **`doctor.py telemetry`** | 3/4 组直接靠它定位热点，但暴露 **2 个真工具 bug**：① `tests/*` 对象错算成 `lines: 1, analyzed_files: 0`；② 缺少包内“长期未动冷文件”列表（导致 `report/attribution.py` 隐身） | **立即修复**：修正 `tests/*` 统计，并为每个代码对象新增 `quiet_files`（最久未动前 5 个生产文件） |
| **`doctor.py surface`** | 2/2 相关组 5 秒直击 `ide/overview` DoS，但漏掉 Python HTTP 服务（`paper/serve.py`、`ide/research_graph/serve.py`）与 `Content-Length: -1` | **立即补齐**：新增 `negative_content_length` 活探针 + Python HTTP `Content-Length` 静态检查 |
| **`doctor.py` 默认 `--tree` 静默分裂 + `@name` 报错** | 3/4 组踩坑：`scan`/`telemetry`/`probe` 静默默认 `origin/main`，在非 `origin/main` 检出上容易审错提交；`unexamined` 拒绝裸 `@name` | **立即修复**：`HEAD != origin/main` 时 `stderr` 明确提示；`unexamined` 自动兼容裸 `@name` |
| **`SKILL.md` & `references/lenses.md`** | 4/4 组反馈 `SKILL.md` 80% 篇幅是全量调度官僚文案、`Focused diagnosis` 只有一行、缺少工具路由；`lenses.md` 缺少**持锁阻塞紧急停机**、**健康检查告警态不可达**、**量化域/浮点 ULP 残差/fail-open 短路**等通用失效类 | **精简重写**：顶部补齐 6 行 Focused Diagnosis + 子系统→工具路由表；`lenses.md` 提炼 5 大通用静默缺陷类取代零散旧坑背书 |
