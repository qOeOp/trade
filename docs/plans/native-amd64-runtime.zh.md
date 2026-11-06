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
