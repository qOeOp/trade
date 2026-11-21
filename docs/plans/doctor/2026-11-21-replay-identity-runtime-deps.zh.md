# 2026-11-21 回放身份把开发依赖算进去

| Item | Value |
|---|---|
| Sessions | 0.5.0 重判（[重判表](../rejudge-0.5-20261121.zh.md) F-05，由 #3226 正文与 929022ea G-04 引出）；本记录由第三波回放、数据与读取正确性 lane 的子 agent（Claude Code，Claude Opus 5.5）写 |
| Checkout / ledger | `origin/main`；未读写账本、市场或主机 |
| Cost | unknown（每次升级 ruff、mypy 或类型桩都重建回放镜像；未计量） |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261121-30 | 回放身份 `dependency_lock_sha256` 对整个 `uv.lock` 求哈希，连镜像不安装的 dev 组（ruff、mypy、类型桩）也算进去：升级 ruff 就重建回放镜像，已有回放随之失去支撑 Live 的资格 | `engine/config.py` `dependency_lock_sha256` 解析整个 lock，只去掉本项目版本；`uv.lock` 的 `[package.dev-dependencies]` 列着 mypy、ruff；`engine/runtime/replay.Dockerfile` 以 `uv sync --frozen --no-dev` 安装；`live/admission.py` 把该字段列入 `REPLAY_CODE`；`.github/scripts/replay-changed.py` 按同一读法决定是否重建 | authority（改 Live 准入比对字段的含义；委托决定） | unknown | in PR |

## 决定

2026-11-21：用户委托：「需要我定的部份最后也是一样由你决定按推荐做」。据此定：`dependency_lock_sha256` 只对
`uv sync --no-dev` 实际安装的包求哈希（`engine.config.runtime_lock`：`requires-python` 加项目运行依赖递归可达的
lock 条目，去掉本项目版本），`replay-changed.py` 用同一函数，并且不再因 `pyproject.toml` 的 `dependency-groups`
重建。0.5.0 回放身份本来就全部重来（新账本），这是改它成本最低的时候；改后已有字段值全部变化，旧镜像与新代码
算出的该字段不可比，不做兼容。
