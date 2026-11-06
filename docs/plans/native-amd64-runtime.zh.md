# 原生 amd64 镜像与部署验证

亚洲 4 核 8GB x86 主机需要原生 linux/amd64 镜像。研究继续留在本地，远程部署沿用
`remote-paper-data-split.zh.md` 的只读研究副本与独立 Paper 数据库；不接 Live。

## 实现范围

- runtime、IDE、service 分别在 GitHub 原生 ARM 与 x86 runner 构建。依赖版本不变，Dolt
  2.4.2 按架构下载并验证固定校验和，Nautilus 仍为官方 2.0.0rc7。
- 各架构镜像检查通过后再组合发布原有 main、pr-N、sha-COMMIT 标签。另有架构后缀标签。
  revision 使用实际检出的提交，现有 manifest digest 和 platform 身份字段足以区分执行环境，
  不添加账本字段。
- runtime 检查实际镜像中的 engine、原生 Redis 保存与重载，以及已有部分成交保护用例的原生报告；
  两种 CPU 的报告用现有语义比较器比较。service 检查镜像内的 Dolt、研究副本、Paper 控制与日志接口；
  IDE 检查已构建页面和 Node；登录代理分别在两种 CPU 上验证。
- 检查只用隔离临时数据库、固定测试输入和 loopback，容器无外部网络、无主机 Docker 挂载。

## 验收边界

CI 小用例是镜像打包回归，不等于 `engine/README.md` 的完整成对 CLI 验收。上线前仍需在原生
x86 上与 ARM 对照相同策略、输入和账户，检查订单保护、费用、非零 funding、账户收益和因果时钟，
以及远程 Paper 启动、停止、同 run 恢复、日志、控制服务重启。不能将无成交的等待状态当作持仓恢复证明。

当前不改现有生产运行、不迁移旧 run、不购买服务器、不修改 DNS。新主机优先选择供应商提供的 Ubuntu
LTS，无桌面；容器依赖由镜像固定，主机版本仍需在目标机验证 Docker 与网络行为。

## 2026-11-06 后续实机验证

用户随后授权创建一台 Vultr 新加坡 vc2-4c-8gb，4 vCPU、8GB、160GB SSD、Ubuntu 26.04 LTS x64，
含自动备份页面报价 USD48/月。实例 `trade-paper-sgp-01`，主机名 `trade-sgp-01`，公网 IPv4
`139.180.214.30`。这里只记录新主机，不接管原电脑上的生产 Paper 运行。

用户单独授权生成专用 SSH 密钥并用于此机部署和测试。私钥位于操作电脑的
`~/.ssh/trade-vultr-sgp-01`，仅公钥添加到 Vultr；专用主机信任文件是
`~/.ssh/trade-vultr-sgp-01.known_hosts`。后续操作沿用专用文件，不读取其他 SSH 私钥或云账号 API 密钥。

实机确认 Ubuntu 26.04.1 LTS / x86_64，Docker 29.9.3、Compose 5.7.0，Docker 服务 active。
通过专用密钥登录，Binance 公共行情 REST 时间接口返回成功。Ubuntu 软件源和 Docker 官方软件源安装，
没有构建本地运行时镜像；产品镜像来自 #2215 合并提交的 CI。

使用相同的 BTC/ETH 输入工作副本和策略，经 CLI 在两边各自的隔离 Dolt 账本执行回放：ARM 参考镜像与
新机的 amd64 镜像的输入身份一致，现有语义比较器通过，费用、非零 funding、账户和收益序列无差异。
两边原生审计与完整性检查通过，没有未来 bar 决策或交易窗口前下单。工程工作副本、原生报告和比较结果
保留在操作电脑 `/tmp/trade-vultr-deployment/`，不把策略正文或回放收据放入 Git，也不写 active 研究账本。
已有 CI 原生部分成交保护场景也在两个 CPU 上通过。临时验证容器随命令结束自行退出，实机未留下运行中的容器。

这完成了 BTC/ETH 的目标机 CPU 验证，不等于全部策略、全币种、持仓 Paper 恢复或并发容量验收。
GitHub OAuth、HTTPS、域名切换、目标机 Paper 完整生命周期及长时运行仍待验收；当前机器只准备好基础运行环境。
Vultr 控制台提示新加坡维护窗口为 UTC 2026-11-11 16:00–18:00（北京时间 11 月 12 日 00:00–02:00）。
