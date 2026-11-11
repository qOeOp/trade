# 全新安装 E2E

状态：已定并实现。来源：doctor 20261107-136；[refactor-coverage-20261111](refactor-coverage-20261111.zh.md) M11（用户 11-11 全按建议）。

## 做什么

`ide-image.yml` 的 `fresh-install` job，在每次构建镜像的提交上，从空主机状态跑到一次回放：

1. 按 `deploy/README.md` 写 `.env`、建主机目录、`deploy/images.py` 取镜像，再把 ide 和 service 换成本次构建的 amd64 镜像。
2. `docker compose up -d --wait`：账本首启（不经页面，`TRADE_RESEARCH_ORIGIN` 加 key 目录）、ide、paper、docker-api。
3. 主机命令行：写市场 profile 和市场目录，`candidate new` 出策略桩，`replay explore` 回放 BTCUSDT 两天，要求 `passed`。
4. 在 ledger 容器里 `ledger export --kind backup`、`ledger review` 无发现无限制（容器带 Dolt，主机不必装；主机上跑这两条要 Dolt 2.7.2，CI 第一次运行就停在这里）；IDE 的 `/api/about` 读到同一账本提交，且没有未发布的写入。

脚本是 `.github/scripts/fresh-install.sh`。回放用的运行时：本提交改了 `runtime-image` 的输入时用本提交的构建（等它推送），否则用 `main` 标签当前的运行时，与 release-ready 的配对一致。

## 与真人安装不同的地方

| 步骤 | 真人 | CI | 原因 |
|---|---|---|---|
| 账本首启的远端 | DoltHub 仓库与 `dolt login` 的 key | `$TRADE_DATA/dolt-backups/origin` 的 `file://` 仓库，key 由 `dolt creds new` 现做 | CI 没有 DoltHub 账号，也不该往公开仓库写。`ledger/publish.py` 本就接受 `file://` |
| market-import | 启动，从 Binance 下载 | 不启动；市场目录用命令行测试的夹具（`tests/cli/test_commands.py` 的 `_fill_market`：BTCUSDT 一分钟 LAST/MARK、资金费、成员） | 托管 runner 访问 fapi 得 HTTP 451 |
| 镜像 | `deploy/images.py` 取已准入的 `main` 构建 | ide、service 用本次构建；运行时见上 | 测的是本次构建 |

账本是 runner 上新建的空账本，跑完删除，不是任何人的账本。

## 不做的

- **macOS job。** GitHub 托管的 macOS runner 是 arm64，没有嵌套虚拟化，跑不了 Docker；部署在 macOS 上走 Docker Desktop 的 linux/arm64 引擎，镜像与 `ide-image.yml` 在 `ubuntu-24.04-arm` 上测的是同一批。macOS 特有的差别在主机一侧（绑定挂载的权限与 socket、主机 Python），只能在真机上看。脚本可以在工作站上跑（`FRESH_ENV`、`TRADE_DATA`、`COMPOSE_PROJECT_NAME`、两个端口挪开，已有同名 compose 项目、数据目录或 env 文件时拒绝）。2026-11-11 在 macOS arm64、Docker 29.1.3 上跑通一次（`main` 镜像 d7beace00，trial passed，review 无发现）。
- **paper、Live、market-import 的运行。** paper 只检查健康；Live 需要真实账户。
- **arm64 的全新安装。** 镜像在 arm64 上已由 `image` job 测；compose 与命令行在两种 CPU 上相同。
