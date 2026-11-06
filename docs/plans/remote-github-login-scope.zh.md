# GitHub 首次登录回调的组织读取范围

2026-11-06，在新服务器的有效 HTTPS 域名上授权专用 OAuth App 后，回调返回 500。
代理日志记录 GitHub `/user/orgs` 返回 403，要求 `read:org` 或更大的 `user` 范围。

固定版本 oauth2-proxy v7.15.6 的 GitHub provider 在检查账号白名单前无条件读取组织与团队，
没有配置开关可以跳过。见[版本源码](https://github.com/oauth2-proxy/oauth2-proxy/blob/v7.15.6/providers/github.go#L124)。
在用户明确授权后，将范围从 `user:email` 改为 `user:email read:org`，使用官方默认的只读范围。
仍只允许配置的 GitHub 用户；不增加仓库、组织管理或写入权限，不改认证拒绝规则。
部署检查固定这一必要范围，防止配置再次缩减为无法完成会话的邮箱范围。

回调通过与否仍以真实浏览器验证为准；配置检查不能代替首次授权和回调验证。
