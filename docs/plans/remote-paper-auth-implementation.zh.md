# Remote Paper 登录入口实施（2026-11-06）

用户已明确要求按方案实施远程Paper登录、启停、恢复、日志，Live后接；登录采用GitHub指定账号，域名www.vibe-trading.info，总预算每月500元以内。现有域名指向用户的2GB服务器，本轮不改DNS、不部署到该主机，不读取凭据或采购服务器。

采用Caddy 2.11.9 + OAuth2 Proxy 7.15.6，均核实官方release并锁定镜像digest。独立remote Compose overlay只公开80/443，移除IDE和Dolt发布端口；现有同源/Host/CSRF检查保留，公网域名加入明确允许项。GitHub用户名必须显式配置，示例qOeOp待实际开通时核对。OAuth client secret及32字节原始cookie secret用私有文件单独挂载给认证服务，不进入IDE、Paper、账本或Git。没有新认证数据库。

本地用最终固定镜像实际执行配置检查；提取同一镜像的原生proxy二进制，在无外网容器内以loopback模拟GitHub与上游验证5项：未登录页面/API/SSE不达后端、允许名单账号进入、非名单账号无会话且不达后端、过期会话401、SSE早于上游结束就交付。固定版GitHub名单拒绝发生在session enrichment，回调返回500而不是403；测试按该实际行为断言，同时确认后端未访问。该证据不是实际GitHub账户登录或该域名ACME签发证明。

新增remote-paper-auth工作流在原生ARM CI上复跑认证及拓扑检查。Caddy配置验证通过；dummy Compose解析确认仅edge公开、登录服务无Docker网络、业务服务未获得OAuth secret。

当前Docker API代理仍是按路径过滤的特权边界，不宣称能防控制服务失陷或不可信策略作者；首版只给指定可信操作者使用。rootless或请求体级启动边界、多用户隔离、Live、6–20容量与跨机接管都不在本PR启用。部署前还需要确定可用新服务器、确认全账单与付款周期、注册专用GitHub OAuth App并准备私有文件；迁移活动账本与运行另行具体确认。
