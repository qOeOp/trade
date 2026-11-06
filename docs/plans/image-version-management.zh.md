# 镜像版本管理：现状核对与修复计划

状态：实施中。2026-11-07 用户要求核对 Docker 镜像版本管理是否符合生产发布规范，不符合则制定修复计划；
看过本计划后答复“同意，开始修复”，其中包括下表第一项的收紧检查。两台主机的切换仍逐台确认。

## 结论

不完全符合。研究与 Paper 运行、服务器的自动发布都已按 digest 管理；不符合的是 `deploy/compose.yaml`
里的三个产品镜像，其中 `trade-docker-api:main` 是 #2239 刚引入的退步。

仓库没有一份统一的镜像版本规范。下面的判断依据是散在各处的已有规则：

- `AGENTS.md`：研究运行使用钉住 digest 的 OCI 运行时。
- `remote-continuous-delivery.zh.md`、`paper-continuous-delivery.zh.md`：主机只拉 CI 准入的 digest；
  会移动的 `main` 标签证明不了哪个产物通过了检查。
- `ghcr-image-retention.zh.md`：保留规则。
- 现有做法：第三方镜像和基础镜像都钉 digest。

## 符合的部分

| 范围 | 做法 | 依据 |
|---|---|---|
| 基础镜像、第三方镜像 | 全部钉 digest（node、uv、docker、python、redis、golang、caddy、oauth2-proxy） | `deploy/Dockerfile`、`engine/runtime/Dockerfile`、`deploy/remote/*.yaml` |
| 回放与 Paper 运行 | `image_ref` 存 digest，`--pull never` | `runtime/image.py`、`runtime/container.py`；本机运行中的 runner 是 `trade-runtime@sha256:40dedf76…` |
| 服务器 Web 与 Paper 发布 | 只拉 `deploy-ready` 准入的 digest，并核对 revision、source、平台 | `deploy/release.py`、`release_host.py`、`paper_host.py` |
| trade-runtime 保留 | 全部保留，一个不删 | `ghcr-image-retention.zh.md` |

研究回放默认解析 `trade-runtime:main` 这一点不改：解析后的 digest 写入账本，`require_main_build` 要求它来自 main，
复现不依赖标签。

## 不符合的部分

### 1. Docker API 代理用了会移动的标签

- HAProxy 原来钉 digest。#2239 换成 `ghcr.io/qoeop/trade-docker-api:main`，这是我引入的退步。
- 这个容器持有引擎 socket，是权限最高的一环。标签一动，下一次 `pull` 再 `up` 就换掉了这道边界，没有任何审阅。
- `release.json` 不含它是对的：发布器按设计不重建 Docker API，所以它该像 HAProxy 那样钉在 compose 里。

### 2. 本机部署跟随 `main` 标签

本机持有活动账本和运行中的 Paper，实际上是生产环境，但它走的是另一条路：

- `trade-ide:main`、`trade-service:main` 在各自镜像工作流结束时移动，不等 `quality` 和第三方检查。
  准入工作流才等这些检查，本机没有经过它。这是流程决定的缺口；通道现有 10 条记录里没有检查失败的提交，所以尚未实际出事。
- 同一个标签名下跑着三个版本，配置文件说不清现在跑的是什么：

  | 容器 | 镜像 | revision |
  |---|---|---|
  | ledger | `a1e159d685fc` | `d0fec246` |
  | market-import | `812c5fa379a9` | `65193c1b` |
  | paper、ide | `:main` 的旧本地副本 | `c4853abb` |

- ledger 与 market-import 的本地镜像 `RepoDigests` 已为空，只能靠 revision 标签反查 digest。
- 回滚参照只有“切换前手记的摘要”，记在仓库之外。
- 本机 `paper serve` 不带 `--runtime`，新运行取当时最新的 `trade-runtime:main`；服务器取准入的 digest。

### 3. 准入只覆盖 amd64，文档说的不一样

- `release-ready.cjs` 只取 amd64 产物，`release_host.py`、`paper_host.py` 写死 `Architecture == amd64`。
- 本机是 arm64，不能直接用通道里的 digest。
- `deploy/remote/README.md` 写“arm64 或 amd64”，自动发布在 arm64 服务器上实际会拒绝。
  `compose.yaml` 开头又写“arm64 only”，这句也过时了。

### 4. 首次部署文档与实际做法不一致

- `deploy/remote/README.md` 第 5 步用 `compose pull` 加 `up`，拉的是 `:main`。
- 生产验收记录写的是“部署固定 digest”，靠主机上手写的 `/etc/trade/images.json`。这个文件的格式在仓库里没有说明。

### 5. 保留规则已过时

- `ghcr-image-retention.zh.md` 说 trade-ide 与 trade-service 没有持久记录依赖。现在 `deploy-ready` 历史和主机配置都引用它们。
- 那条规则写于单架构时期。现在每次构建是一个多架构索引加两个子版本，各有独立的版本 id，子版本带自己的 `-arm64`、`-amd64` 标签。
  只按 `sha-<提交>` 选保留对象，会删掉子版本，索引随之失效；通道准入的 digest 恰好就是 amd64 子版本。
- 版本数：trade-ide 471、trade-service 456（10-31 才清到各 6 个）、trade-runtime 258、trade-docker-api 持续增长。公开包不收费，
  所以这不紧急；风险在于按旧规则再清一次。

### 不算问题的

PR 镜像和生产镜像在同一个包里。同仓库 PR 的工作流持有 `packages: write`，理论上能改写 `main` 标签。
部署全部改钉 digest 后，改写标签影响不到部署，不需要拆包。

## 修复方案

只用一套机制：**产品镜像的 digest 放在 compose 覆盖文件里，内容由准入通道生成。** 服务器已经这样做（`images.json`），
本机改成相同做法。不改通道格式，不动主机上的发布控制器，不新增存储字段。

### 第 1 步：钉住 Docker API 代理（一个 PR）

- `deploy/compose.yaml` 改为 `trade-docker-api@sha256:…`，取 main 构建的多架构索引 digest（`648b0e5b` 已构建）。
- 以后改代理的流程：代码 PR 合并，main 构建，再开一个 PR 改 digest。回滚就是还原这一行。
- `ide-image.yml` 在 main 上比较 `deploy/docker-api/` 与所钉镜像的 revision，不一致时给 warning，避免改了代码却没上线。
  warning 不阻塞，因为代码 PR 合并到改 digest 之间必然不一致。

### 第 2 步：产品镜像改由覆盖文件提供（一个 PR）

- `deploy/compose.yaml` 去掉 `trade-ide:main`、`trade-service:main`。已实测：不带覆盖文件时 compose 拒绝
  （`has neither an image nor a build context`），未启用 profile 的服务不受影响。
- 新增 `python3 -m deploy.release images [--revision <提交>]`，从 `deploy-ready` 历史生成覆盖文件：
  - 取最新的、之后未被撤回的准入记录。正在检查中的 `image: null` 提交不算撤回更早的提交。
  - 读 `sha-<revision>` 的多架构索引，要求通道准入的 amd64 digest 确实在索引内，再取本机架构的子版本。
    已用真实数据核对：`e60fbfc0` 的 ide、service 和 `a038ebf3` 的 runtime 都对得上。
  - 输出 `ide`、`ledger`、`paper`、`market-import` 的镜像，以及 paper 的默认 runtime。
  - 这是信任边界上的读取，不让人手抄 digest，符合 `AGENTS.md` 加产品代码的条件。
- `paper serve` 增加环境变量形式的默认 runtime（覆盖文件无法追加命令参数）。未设置时行为不变，服务器不受影响。
- `deploy/images.json` 加入 `.gitignore`，`deploy/.env` 用 `COMPOSE_FILE=compose.yaml:images.json`（已实测）。
- `check-remote-deploy.py` 带假覆盖文件运行，并新增断言：解析后每个镜像都含 `@sha256:`。
- 文档一并改：
  - `deploy/README.md` 新增“镜像版本”一节写明规则，并重写 Updating；回滚即 `images --revision <旧提交>`。
  - `deploy/remote/README.md` 第 5 步改用同一命令，说明 `images.json` 的格式；自动发布写明只支持 amd64。
  - 修正 `compose.yaml` 开头的架构说明。
- 单元测试覆盖：撤回、检查中、V1 记录、digest 不在索引内、架构选择。

### 第 3 步：更新保留规则（文档，可并入第 2 步）

保留集合改为：`main` 与开放 PR；最近 5 个 main 构建；`deploy-ready` 全部历史引用的 digest；
compose 历史钉过的 docker-api digest；各主机正在用的 digest。索引与其两个子版本视为一个整体。
不加定时工作流，不做任何删除。trade-runtime 仍全部保留。

### 第 4 步：主机切换（逐台确认）

- **本机**：生成覆盖文件后逐服务重建。docker-api 先确认没有进行中的 reconcile；ledger 选没有回放写入的时刻；
  顺序和影响按 `deploy/README.md` 的 Updating。Paper 运行容器不受影响。
- **服务器**：更新 `/opt/trade-app` 前先核对 `/etc/trade/images.json` 含 `ledger`、`paper` 等启用服务的条目，否则 compose 会拒绝。
  这个文件的内容我还没读过。自动发布不依赖 compose，不受影响。

### 验证

- 第 1、2 步：Python 全量测试、ruff、mypy、`check-remote-deploy.py`、`docker compose config`。
- 第 4 步后：`docker inspect` 显示每个产品容器的 `Config.Image` 都带 digest，且 revision 与准入记录一致；
  Paper 运行容器的 ID、StartedAt 不变；新起的 Paper 运行 `image_ref` 等于覆盖文件中的 runtime。
- 回滚演练：在隔离的 compose 项目里用 `--revision` 生成旧版本覆盖文件并解析。不在活动部署上演练。
- 镜像内容不变，只改引用方式，因此不需要 `engine/README.md` 的配对回放；第 4 步如顺带升级 revision，按该文档判断。

## 需要用户确认的事项

| 事项 | 现在 | 改后 | 替代办法 |
|---|---|---|---|
| compose 不带覆盖文件时拒绝启动；CI 新增“镜像必须含 digest”断言（收紧检查） | 可以直接拉 `:main` | 必须先生成覆盖文件 | 保留 `:main` 作默认值，只改文档；约束最弱 |
| 重建本机 `docker-api`、`ledger`、`paper`、`market-import`、`ide` | 运行旧版本 | 运行钉住的准入版本 | 不切换，新规则只在下次更新时生效 |
| 服务器读取 `/etc/trade/images.json` 并更新 `/opt/trade-app` | 旧检出 | 新检出 | 服务器暂不更新检出 |

删除 GHCR 版本不在本计划内；真要清理时另行授权。

## 明确不做

镜像签名和 SBOM、语义化版本标签、独立的预发布仓库、自动提 digest 更新的机器人、PR 镜像拆包、
arm64 自动发布。单操作者、自托管的形态下，这些的成本都超过收益；`revision` 加 digest 已足够定位版本。
若以后发布面向他人的固定版本，再考虑版本标签。
