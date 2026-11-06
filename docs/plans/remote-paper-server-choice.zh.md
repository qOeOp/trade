# Remote Paper 首台服务器候选（2026-11-06）

用户要求：GitHub指定账号登录，域名www.vibe-trading.info，服务器/磁盘/固定IP每月人民币500元以内；先Paper，Live后接。现有101.132.235.122是用户的2GB服务器，不作为完整IDE+账本+多Paper部署目标，本轮未改动其服务或DNS。

## 首选：先月付验证ARM64

[Netcup VPS 4000 ARM G12.5，1M EU](https://www.netcup.com/en/server/arm-server/vps-4000-arm-g12.5-iv-24m-eu#vps-4000-arm-g12.5-iv-1m-eu)：12个ARM vCore、32GB RAM、512GB NVMe；欧洲自动分配地域。它与当前CI镜像的linux/arm64一致，不需要在生产用QEMU，也不需要先增加amd64构建。

本次读取官方页面内公开产品数据，**明确选择1M变体而非展示页默认的24M变体**：secondary_slug=vps-4000-arm-g12.5-iv-1m-eu，minimum_contract_period=1，billing_period=1，setup_costs=0，availableToOrder=true。可下单标记不是已预留资源或即时交付保证；页面也提示可能延迟开通。未访问用户账户或创建购物订单。

| 项目 | 读取值与保守预算 |
|---|---|
| 月付主机价格 | netPrice €43.34；默认19% VAT示例price €51.57 |
| IPv4+IPv6选项 | 公开配置price €0.50；为避免漏项，预算中另计€0.50税前，即使结算可能已包含 |
| 保守主机+IPv4合计 | (€43.34+€0.50)×1.19≈€52.17/月，512GB盘随主机包含，无单独加盘 |
| 人民币参考 | [ECB 2026-11-05参考汇率](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.eu.html) EUR/CNY 7.4846，约人民币390.47/月 |
| 预算余量 | 约109元留给支付汇率/手续费与异地备份；备份未获得独立报价，不声称已包含在上述主机价内 |

实际税率按真实付款资料与结算决定，不默认套用中国或日本地址。正式订单必须再次核实付款周期、IPv4、总价和交付地域，主机与必要附加项月总额不超过500元；不替用户签12/24个月合约。原始公开报价工作副本在/tmp/trade-remote-auth-check/netcup-monthly-quote.json，未写入研究账本。

## 其他路线与容量边界

- [Hetzner CAX41](https://www.hetzner.com/cloud/cost-optimized/)也是ARM64/32GB/320GB路线，但当前公开页面标注not available，不能把历史广告价当作可立即购买的报价，暂不作为首选。
- [OVH VPS](https://www.ovhcloud.com/en/vps/)是x86备选；官网当前产品代际和规格已与比较站旧48GB套餐不同。未把旧套餐价当现价，且当前产品镜像仍需amd64 CI与native配对后才能部署。
- 32GB首台用于现行最多4条Paper的工程验收，不承诺20条或任何Live容量。逐步测原生回调/检查点延迟、RSS峰值、磁盘和日线/funding边界，确定组件预算；remote env中的8g账本cap只是候选预算，不能在未经负载验证时改现有生产服务。
- 本机近期一次IDE/Dolt观测各已超过1GB，现有2GB机没有足够的整体余量；不通过关闭持久化、恢复检查或清理历史记录来挤出容量。

## 上线前的具体剩余步骤

1. 用户确认新付费主机/一个月验证及账单上限，完成服务器开通；先不更改现有域名指向。
2. 新机验证ARM64、Docker/Compose、持久盘、时钟与实际固定IPv4出口，以及Binance公共接口连通性；不使用交易凭据。
3. 在隔离账本验证登录、幂等启动、持久停止、同run恢复、日志、SSE重连及控制服务重启；明确唯一活动账本/市场目录和现有run8的迁移边界。当前协议不能把原容器缺失的跨机复制叫作resume。
4. 注册专用GitHub OAuth App，核对允许名单（示例qOeOp），回调https://www.vibe-trading.info/oauth2/callback。私有secret文件只由认证容器读取，Agent不需要查看内容。
5. 确认验收与回滚步骤后，配置域名指向及公网入口、上线新部署。实际GitHub登录和ACME签发要在该主机上验收，不能用loopback夹具证明。

代码实现分为[#2211](https://github.com/qOeOp/trade/pull/2211)认证入口和[#2212](https://github.com/qOeOp/trade/pull/2212)控制/日志。认证的5项原生隔离探针通过，业务CLI+隔离Dolt+HTTP+原生runtime等待阶段验收通过；本地全套842项Python、82项前端通过，后续DTO确认调整的50项聚焦测试与build通过。UI深浅色预览验证日志按纯文本呈现，恢复反馈及会话过期提示不清空已收到数据；预览不是生产操作。
