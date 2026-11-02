# 市场回执记写它的代码（`writer`）

2026-11-03。按 AGENTS.md，新存储字段先做独立子 Agent 审阅，结论记在这里。计划见 `market-parquet-store.zh.md` §7。

## 字段

每份导入回执加 `writer`：写这次导入的代码的 Git 修订（40 位十六进制），即本仓库的 `HEAD`。
受跟踪文件有改动时记 `null`；镜像里没装进去的文件（`.dockerignore` 排除的）不算改动。
`market publish` 拒绝发布新回执没有 `writer` 的导入版本（`WRITER_MISSING`）。用户 2026-11-03 授权这条新拒绝。

镜像以宿主用户运行，不是 `/opt/trade` 的属主，git 默认不读那里的仓库（`dubious ownership`）。
所以 `deploy/Dockerfile` 用 `GIT_CONFIG_*` 把 `/opt/trade` 设成安全目录。实测：
加上之后，旧镜像以 uid 501 运行时 `git rev-parse HEAD` 成功，`git diff --quiet --diff-filter=d HEAD` 退出码 0。

## 谁用它

将来的 `market rebuild`：公开副本不存 metrics、agg_trade、quote 的文件，新机器按回执重新导入。
现在的代码写出的字节对不上条目的 SHA-256 时，就拒绝，并报出回执的 `writer`。
操作者用那个修订的镜像（`trade-service:sha-<writer>`）重跑。镜像被清掉的话，按修订重新构建：
Dockerfile 按摘要钉住基础镜像，`uv sync --frozen` 钉住 pyarrow 和它自带的 zstd。

## 为什么现有数据推不出来

- 规则名和编码名不随代码变：10-31 的 #1929、#1930 改了 aggTrades 导入和报价推算，`CODEC`、`RULE` 都没改名。
- 版本文件和回执都不记时间，二分镜像没有边界，每试一次都要重下归档，还分不清是代码变了还是来源变了。
- 记在版本文件里而不是回执里：一个导入版本恰好加一份回执，两者等价；转换来的版本带很多份回执，
  而文件 → 写它的版本 → 回执已经能由 `versions.imports` 推出。
- 记镜像摘要而不是修订：进程自己看不到镜像摘要，开发时也没有。

## 审阅里改了的

1. **K 线和资金费重建不出同样的字节**，所以它们也上传公开副本（用户 2026-11-03 选 E=1）。
   K 线导入的回执只有 `{month, through, universe_rule, scope}`，缺三样：
   - 归档身份（按月还是按日，各自的 SHA-256）；
   - REST 补的行（缺口、最新一天、没有归档的合约、没有月归档的资金费）；
   - 导入当时 exchangeInfo 的状态和候选合约集。

   REST 的行是不能重现的观测，按"只存回放给不回来的"也该存。
   K 线和资金费上传后，需要重建的只剩 metrics、agg_trade、quote，它们的回执记着每个归档的 SHA-256。
   按每行 14.7 字节实测（legacy 转换），主线 K 线约 20–45 GB，每月约 0.7 GB。
2. **只有干净的工作树才记修订**，否则记 `null`，发布时拒绝。从开发工作树导入的版本只留在本地。
3. **转换来的版本不靠"没有 writer"认出来**。代码里写死两个常量：`versions.CONVERTED`（7 个钉住的版本）
   和 `versions.CONVERTED_HEAD`（转换主线的最后一个版本）。在这两者里或在 `CONVERTED_HEAD` 链上的版本，
   重建靠在转换那个修订（main fbe8f396f）上从冻结的 DoltHub `vincent/trade-market`（含 `legacy-20261025` 分支）
   重跑 `market convert`。转换来的回执不加字段，否则已钉住的版本文件哈希就变了。

审阅还提到：PR 镜像的合并提交以后可能不可达。发布只发 market-import 的版本，它跑 main 镜像，
所以不另做"修订须在 main 上"的检查。
