# 2026-11-07 增长与性能：服务器重测与 -158、-159 结论

| Item | Value |
|---|---|
| Sessions | 无被审研究会话；续 [增长与性能](2026-11-07-trial-growth-scaling.zh.md) |
| Audit session | Claude Code（桌面应用），claude-opus-5-5；与上份记录同一会话 |
| Checkout / ledger | 服务器 web 为 428229681（含 #2435、#2436、#2441、#2442，不含 #2444）；服务器镜像 head `kgfa3qhe3op9i808c3etppebn2t9d9du`，测量 `--at` `ic7kgug8h6rrad7r90780ud1p720d34d`（2,358 trial，与 11-07 早先测量同一提交） |
| Coverage | 用户 11-07 授权只读 SSH（“我都授权”）。主机密钥与记录的 SHA256:W8V8…LWk 一致，用独立 known_hosts。只发 GET 到 web 容器，读 cgroup `cpu.stat`；未进容器执行代码。未测：复用检查（`have=`），#2444 发布后的写路径（服务器不写研究） |
| Cost | 审计约 20 min；tokens 未测 |
| Net change | 无代码与 skill 变化 |

## 服务器实测

| 测量 | 11-07 早先 | 本次 |
|---|---|---|
| 23 个版本的线（video-macd-first-return-engulf）冷画图 | 209 s（4 worker）；53 s，web 55.6 CPU-s、ledger 30.9 CPU-s（8e294b576） | 25.5 s，web 24.3 CPU-s、ledger 8.5 CPU-s |
| 冷 `/api/lines`（`at=` 未缓存提交，含进程启动） | 未测 | 679 trial 2.7 s，1,363 trial 3.8 s，2,358 trial 4.3 s |

主机 4 核、负载约 1；web 限 1.5 核、1.5 GiB，测量时 Live run 2 在跑，web 与 Live 都无压力迹象。

## 结论

- 20261107-160：已测，见上表；关闭。
- 20261107-159：#2444 合入 128a6f400。写事务内 `validate` 在本地 0.85 → 0.10 s（73 trial 的线）、0.64 → 0.13 s（短线），全量测试与逐运行对照见 PR。
- 20261107-158：用户授权删除孤立临时文件，`docker exec … rm` 被自动模式以不可逆本地删除拒绝，由用户自己执行；行保持 open，待文件删除后关闭。
