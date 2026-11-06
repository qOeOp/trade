# 远程 Agent 与显示修复上线验收

2026-11-06，用户先明确授权恢复远程 Agent，再明确授权 CI 通过后合并并部署两项显示修复。
三个 PR 均基于 main，分别合入：[#2222](https://github.com/qOeOp/trade/pull/2222)
Agent、[#2223](https://github.com/qOeOp/trade/pull/2223) 阶段曲线、
[#2224](https://github.com/qOeOp/trade/pull/2224) 底部工具上下文。

## 构建与部署身份

- 产品提交：`535c0733b356077e89206e47bc8ddfdcda622f1a`。
- IDE amd64：`ghcr.io/qoeop/trade-ide@sha256:2b7d1c196ae07712de3697c1b762eaef2a51bdec59db012d5d2ddd4e4e16065a`。
- 三个 PR 的所有工作流，以及最终 main 的 quality、ide-web、ide-image、docs-pages 全部通过。
  最终 main 镜像工作流为 [42233158666](https://github.com/qOeOp/trade/actions/runs/42233158666)。
- 合并后本地前端类型、规则检查、88 项测试和生产构建通过；假 secret 的远程 Compose 检查通过。
  独立浏览器使用线上只读快照验证亮暗主题、阶段切换、Agent 空配置和三类页面工具，无页面脚本异常。
- 14:28 UTC 开始只替换 IDE，先拉取镜像并检查 amd64 和 OCI revision，再固定 digest 发布。
  旧镜像与配置均保留。没有替换 Paper、ledger、OAuth2 Proxy、Caddy 或运行器。

## 线上读回

- `/api/agent/health`、`/api/agent/agents` 内部 HTTP 均为 200，健康为 true；配置数量为 0。
  Agent 使用独立 `trade-ide_trade-ide-agent` 卷，目录权限 0700。未读取或迁移 provider key。
- 公网未登录访问 Agent 和 Paper API 均为 401；独立浏览器打开网站仍进入 GitHub 登录页。
  本轮浏览器没有已登录会话，未读取 cookies、重新登录或测试真实模型回答。
- Paper、ledger、OAuth2 Proxy、Caddy、run 3 的 runner 与 egress 的容器 ID 和启动时间在更新前后
  完全相同。更新后 run 3 仍为 running，最新行情时间向前推进；读回时仍为 0 fills、100000 权益。
- 发布时新研究图缓存需重算，初次读回为 202 computing。新镜像健康与已有运行不中断不等于
  整站每个新页面都立即可用；本次发布未宣称零停机。

## 证据与限度

操作机 `/tmp/trade-ide-display-review/` 保留只读快照、截图和部署日志；服务器
`/tmp/trade-ui-rollout-20261106T142838Z/` 保留更新前后的容器身份、旧镜像配置与源码提交。
这些工作副本不进入 Git 或活动账本。

本机三次全量 Python 测试均为 918 run、302 skipped、5 errors：本机 Dolt 1.80.2 被要求的
2.4.2 拒绝，main 基线同五项 reproduction 测试亦失败。固定 Dolt 的 PR 和最终 main CI 已通过。
本轮是工程验收，doctor 状态只推进到 fixed，不记为后续研究会话的 verified。

## 自动发布现状

GitHub 已有代码检查、镜像构建和 GHCR 推送。服务器的镜像更新仍需显式操作；本次也是一次
授权后的人工发布。仓库没有完成“构建成功即自动上线、健康切流、连接排空、失败回滚”的持续
发布链路。网页蓝绿发布可以另行实现；单实例账本与运行时镜像需要各自的发布策略，不能用
整组 `compose up` 的重建冒充对活动 Paper 无影响。
