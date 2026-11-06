# 远程 Web IDE 与 Paper 实机验收

2026-11-06，用户授权的新加坡 4 vCPU / 8GB 主机完成远程部署。研究仍在本地；服务器读取
DoltHub 的只读研究镜像，Paper 使用独立执行数据库。没有迁移原电脑上的运行，也没有部署 Live。

## 当前部署

- 入口：https://www.vibe-trading.info/。只切换 www 的 A 记录，根域名和其他记录未变。
- Caddy 获取有效的 Let's Encrypt 证书；实测 HTTP 跳转 HTTPS、TLS 验证成功。
- 只开放 SSH、HTTP、HTTPS；Docker API、IDE、Paper、Dolt 的内部端口从公网不能连接。
- GitHub 专用 OAuth App，账号白名单仍为配置的指定用户。只有登录代理挂载 OAuth 客户端和
  会话密钥文件，IDE 和 Paper 不挂载这些凭据，也没有 DoltHub 发布密钥。
- 产品提交 f217f838abf1d8c2137d0e777e454ce4e6a9879d；正式 main CI 的质量、原生
  amd64/arm64 镜像和文档检查均通过。部署固定 digest，保留原镜像。

| 服务 | 镜像 digest |
| --- | --- |
| IDE | sha256:bf469280fdac46ba103577fbdbe4866b4407a4fa5c0ef7cd8ac270ea9cf4d647 |
| ledger / Paper service | sha256:a9e98e37d6d7ff8870e3efe4ced8c6bfc0bb8b6a655af759533cb50ef13e84d6 |
| Nautilus runtime，未改动 | sha256:8948075d6cfe47231ae39cc4ce945ed24239e65bc21ec3f993f6b1f7bee25268 |

上线发现并修复的三个独立问题：
[首次子挂载目录](remote-paper-controller-mount.zh.md)、
[GitHub 官方代理必需范围](remote-github-login-scope.zh.md)、
[外部整页导航被拒绝](remote-home-navigation.zh.md)，分别为 PR #2217、#2218、#2219。
最后一项完整回归为 858 tests，OK，5 skipped；定向 HTTP 回归 10 项通过。

## 实际验证

- 真实浏览器通过 GitHub 授权、HTTPS 回调，加载研究图与 Paper 页面。未登录和伪造会话的
  Paper API、SSE 返回 401。白名单反例由固定版本代理的隔离认证测试覆盖，未使用第二个真实账号。
- 通过网页启动 Paper，选择 BTCUSDT / ETHUSDT，读取有行数上限的运行日志和流式事件。
  退出登录请求及重新登录后仍是同一运行，没有因浏览器会话结束而停止。
- 在原生检查点与日志字节数、摘要匹配且无 dirty 标记的等待切点，SIGKILL 验证实例。
  控制器自动恢复同一未封存 run；原始日志前缀保留，一次 started、一次 resumed，没有新账户启动。
- 另一项内部 IDE HTTP 验收覆盖重复启动请求、操作回执、显式 resume、控制器重启、主动停止封存、
  封存日志与重复请求不创建账户。
- 运行中实际点击 Sync DoltHub，页面报告同步完成与目标提交，并在旧视图上显示绘图进度；
  CLI 验证并快进研究镜像，运行中的策略输入摘要没有变化。
- 从网页主动停止并封存，随后日志仍可读取。两次验证运行的记录均保留，测试结束时无活动实例。
  执行库通过产品 CLI 完成原生全历史备份，目录为 /srv/trade/dolt-backups/paper。

研究镜像第一次同步因四张表的暂存变化而拒绝，来源尚未确定。通过产品 CLI 创建独立全历史原生
备份，并在工作副本独立读回其工作集后，用户明确授权一次原生管理修复，仅清理新机 research
镜像的未提交工作集到原 main；主提交、DoltHub、本地账本及 Paper 数据库均未改写。
随后 CLI、内部 HTTP 和网页同步成功，工作集干净。修复前原件仍在
/srv/trade/dolt-backups/deployment-research-20261106，修复后再次读回确认未变。
这次授权没有变成自动 reset 或放宽同步拒绝规则。

## 验收的实际限度

验收发生于等待日线输入的干净切点，尚无交易成交；不能声称已实测持仓恢复、任意事件尾部、
断电写盘一致性或全部策略。账户查询连通也不能代替未来 Live 下单与风控验收。
现有 Paper 同时运行上限仍为四个；没有做 6–20 实例容量和长时间稳定性验收。

首次冷启动研究图需要几分钟的账本比较计算，随后缓存视图可快速打开；同步后的绘图仍可能较慢。
该性能项未在本轮优化，也没有为缩短时间省略比较或审计。检查脚本、原生输出与网页截图保留在
操作电脑和目标机的 /tmp/trade-vultr-deployment 工作目录，未把策略正文或实验收据放入 Git。
