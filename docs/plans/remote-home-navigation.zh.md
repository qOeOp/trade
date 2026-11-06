# 外部入口与 GitHub 回调的首页导航

2026-11-06，HTTPS 与 GitHub 授权完成后，IDE 首页返回 FORBIDDEN。
在认证代理后的临时单请求探针确认 Host 为配置的 www.vibe-trading.info，
请求来源标记为 cross-site、navigate、document；原入口把所有跨站请求一律拒绝。
探针不读取 Cookie 或凭据，使用后退出并移除其代理路由。

用户已明确授权修改这一拒绝规则：仅允许合法 Host 上 GET / 的整页导航，
同时要求 Sec-Fetch-Mode=navigate 与 Sec-Fetch-Dest=document。查询参数不改变根路径。
API、资源、iframe、缺少导航标记的跨站请求及所有写操作继续拒绝；操作 token 与公网 GitHub
账号白名单仍生效。首页只是页面壳，研究数据仍由原有同源 API 获取。

定向 HTTP 回归覆盖外部首页导航以及上述反例；最终部署还须通过真实浏览器入口验证。
