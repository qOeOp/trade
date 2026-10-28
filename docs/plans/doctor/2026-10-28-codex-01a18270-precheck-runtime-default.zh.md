# 2026-10-28 预检必须手填镜像，Agent 照抄旧线不能用的摘要

| 项 | 值 |
|---|---|
| 会话 | Codex，`rollout-2026-10-28T21-16-20-01a18270-9ad9-7771-86b0-7e47a96c3651.jsonl`，2026-10-28 12:16–12:35 UTC |
| 诊断会话 | Claude Code，claude-opus-5-5，会话 3479580f-9ec6-414a-86e9-ca96dca28d37；聚焦诊断（用户提问：一上来不知道先检查最新版本，是不是产品缺陷） |
| 检出 / 账本 | 检出 776cb8efa；账本 `29odre54fedbvlvvjpf2a2o55uuijv4q`（只读 `ledger sql`） |
| 覆盖 | 只读了会话中旧摘要的来源（12:17 `research status`）、两次预检调用与失败定位（12:32–12:34）、`cli/main.py` 各命令的 `--runtime`、`runtime/image.py` 的默认解析、`research-start/references/readiness.md` 与 `research-round/references/changes.md`；未分工作流，未做整场审计 |
| 时间拆分 | 12:32 预检失败，12:33–12:34 定位并换当前镜像重试；研究时间未单独计量 |
| 产品造成的无效试验 | 1（trial 213）；同因的 trial 212（01a181f4 会话）已记在 -10/-11 |
| 按动作的发现 | fix 1（-12） |
| 复发项 | -11（又一次开 trial 后才在读输入时失败） |
| 用户先发现 | 0 |
| skill 体量 | 未改 skill |

## 发现

| id | 发现 | 证据 | 动作 | 代价 | 状态 |
|---|---|---|---|---|---|
| 20261028-12 | `replay precheck --runtime` 必填、没有缺省（`cli/main.py:1753`），而 `replay run`、`replay explore`、`registration add` 缺省都是 main 标签（`cli/main.py:991`、`runtime/image.py:148`）；新线的第一次回放就是预检，产品此时唯一给出的摘要是 `research status` 里旧线的 `execution_identity.image_digest`，readiness 只要求“镜像引用解析为唯一镜像”（`readiness.md:95-96`），`RUNTIME_UNSUPPORTED` 只按契约判（`report/status.py:436`），旧镜像同为 v7 不报。Agent 照抄旧摘要，镜像读不了当前导出 | 会话 12:17 从 `research status` 读到 `sha256:9ab421a9…`，12:20 `docker inspect` 只见契约 `replay-contract@v7`；12:32 用它预检，trial 213 在 `inputs` 阶段报 `INSTRUMENT_NOT_UNIQUE`，该镜像构建于 5d1ebea4e（`uv.lock` 为 Nautilus 2.0.0rc3），当前锁定 rc7；12:34 换 main 镜像 `sha256:b0b2337d…` 重试。账本：trial 211（10-25，rc7 升级前）用同一摘要成功，212、213 两次预检用它失败；01a181f4 会话的 trial 212 是同一路径 | fix：`replay precheck --runtime` 与 `replay run` 一样缺省取 main 标签，显式摘要照旧可用；不改任何拒绝检查 | 每次换线多一条无效试验并要诊断换镜像；今天两次 | in PR |

## 移除清单

无。预检 `--runtime` 的必填约束没有守护的风险：登记、正式回放缺省同为 main 标签，审查与登记照旧核对预检的镜像身份。

## 决定

无授权项。
