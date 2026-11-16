# 2026-11-16 生产 Web 内存超限，Market 页一直 502

用户报告生产 Market 页不可用。本记录只诊断；修复由别的会话从本记录与索引出发去做。

| Item | Value |
|---|---|
| Sessions | 用户报告（2026-11-16 04:1x UTC）；没有研究会话证据 |
| Audit session | Claude Code（桌面端），会话 `0660267b-ae67-4c05-b258-d74244daae37` |
| Checkout / ledger | 服务器运行 0.4.0（`17b93b347`）；代码读 `origin/main` |
| Coverage | 服务器内核日志的 OOM 记录、Web 容器的请求日志与进程表、`deploy/entrypoint.sh`、`ide/research_graph/serve.py` `Product.run` 的代码阅读。没有复现 |
| Cost | Market 页从 03:30 到 04:2x UTC 不可用；重启 Web 容器后恢复 |
| Net change | 只提方向 |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261116-01 | Web 对每个产品读取起一个 `python -m cli.main` 子进程（`ide/research_graph/serve.py` `Product.run`），并发没有上限；一张研究线页面同时发出的读取会让容器撞上内存上限 | 03:30 UTC 内核在 Web 容器的 cgroup（上限 1.5 GiB）里连续杀了 18 个 `python3` 子进程（每个 anon-rss 220–390 MB）；当时用户在看新账本的研究线（62 个版本、45 次研究运行）。`Product.run` 直接 `subprocess.run`，请求由 `ThreadingHTTPServer` 每个一线程 | 修缺陷：限制同时运行的产品读取数（按容器内存给出上限，超出的排队），排队不改变答案 | minutes（一次超限就丢掉页面的读取与 Market 页，直到有人重启） | open |
| 20261116-02 | Market 页的概览服务（Node）由 `deploy/entrypoint.sh` 放在后台运行，死后没有任何东西拉起它，Web 只把 `/api/overview/*` 答成 502 | 同一次超限里内核先杀了 `MainThread`（Node 的主线程，pid 1629663）；此后 Web 容器里只剩 `ide.py serve`，`/api/overview/health` 从 03:30:45 起每次 502。重启 Web 容器后两个进程都在，健康检查 200。发布只在切换时检查一次 `/api/overview/health`（`deploy/release_host.py` `health`） | 修缺陷：概览进程退出时由容器内的监督拉起，或让容器退出交给 Docker 的重启策略；二选一以现有部署方式为准 | minutes（Market 页不可用直到重启） | open |

## Decisions

- 2026-11-16 用户："market也修一下"。已重启生产 Web 容器（04:2x UTC），概览健康检查恢复 200。
- 观察：同一时刻 Paper 运行 2 的 runner 容器内存 521.8 MiB / 640 MiB，没有超限，不另立发现。
