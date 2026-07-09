# Trading Config

目标：用一个项目级配置入口管理交易底线、执行假设、R&D 约束与运行权限；不把账户事实、策略规则和运行状态塞进配置文件。

## 1. 判断

当前已有配置，但没有统一配置系统：

- `profile/account_config.json` 已承载账户风险阈值。
- `profile/notify_config.json` 已承载通知策略。
- strategy markdown frontmatter / setup certificate 承载策略规则。
- R&D / benchmark / campaign payload 各自携带 fee、slippage、funding、trial budget。
- `plan-preflight` 只消费了账户配置的一部分，文档中已有的 leverage / gross exposure / beta / funding guard 尚未完全合流。

问题不是缺字段，而是缺少 **typed runtime policy compiler**。

## 2. Canonical Entry

新增唯一人工维护入口：

```text
profile/trading-config.json
```

旧文件迁移规则：

- `profile/account_config.json`：保留为兼容输入；新 loader 优先读 `trading-config.json`，缺失时从旧文件适配。
- `profile/notify_config.json`：保留为兼容输入；后续迁入 `notifications` 段，但凭证仍只走环境变量。
- strategy markdown：继续独立存在；统一配置只管理启用、权限、风险覆盖，不复制 strategy 规则。

## 3. What Config Is Not

配置文件不保存：

- live equity、available balance、positions、orders。
- 当前 mark、funding、spread、depth。
- flow 当前状态、active orders、current position。
- API key、Telegram token、chat id 等凭证。
- replay / shadow / review 样本。

这些分别来自 exchange snapshot、market snapshot、event projection、environment、ledger / artifact。

## 4. Shape

第一版只固定必须合流的项目级结构，不提前扩成平台配置。

```json
{
  "schema_version": 1,
  "profile_id": "retail-small-usdm",
  "mode": "live",
  "permissions": {
    "live_small_enabled": true,
    "max_stage": "live-small"
  },
  "risk": {
    "equity_source": "live_exchange_snapshot",
    "max_single_trade_risk_usdt": 50,
    "max_open_risk_usdt": 150,
    "max_day_loss_usdt": 200,
    "max_open_risk_pct": 0.01,
    "max_day_loss_pct": 0.03,
    "max_concurrent_risk_flows": 2
  },
  "exposure": {
    "max_entry_notional_usdt": 1000,
    "max_symbol_notional_usdt": 1000,
    "max_gross_notional_usdt": 2500,
    "max_single_position_leverage": 2,
    "max_gross_exposure": 2.5,
    "max_btc_equiv_net_risk_pct": 0.015,
    "max_btc_equiv_gross_risk_pct": 0.02
  },
  "execution": {
    "market": "usdm",
    "default_margin_mode": "isolated",
    "default_order_preference": "limit_first",
    "slippage_buffer_pct": 0.001,
    "max_funding_rate_pct": 0.001,
    "max_funding_erosion_ratio": 0.5,
    "stop_price_protect": false
  },
  "research": {
    "max_trials_per_campaign": 10,
    "max_parameters_per_candidate": 8,
    "default_fee_bps": 2,
    "default_slippage_bps": 1,
    "default_adverse_funding_bps_per_8h": 1,
    "allow_auto_promote": false
  },
  "lanes": [
    {
      "strategy_ref": "S-ALT-4H-BTC-STRONG-RELATIVE-REVERSION-SHORT",
      "symbol": "*",
      "side": "short",
      "enabled": false,
      "max_entry_notional_usdt": 500,
      "max_single_trade_risk_usdt": 25
    }
  ],
  "notifications": {
    "enabled": true,
    "min_severity": "warning"
  }
}
```

## 5. Merge Semantics

配置合成顺序：

```text
global trading config
  -> strategy / setup policy
  -> lane override
  -> current plan
  -> live account + market facts
  -> effective runtime policy snapshot
```

合成规则：

- 权限：explicit deny wins。项目级配置默认允许 `live-small` 路径，但 strategy / setup / lane / runtime health 任一层明确禁止新增风险，最终不可 live。
- 风险 / 暴露上限：most restrictive wins。数值 cap 取更小者。
- 成本假设：more conservative wins。fee / slippage / adverse funding 取更大者。
- strategy 规则：strategy owns。配置不能重写 entry / stop / thesis，只能限制是否启用和能承担多少风险。
- live facts：facts do not override policy。账户和行情事实只参与 gate 计算，不写回配置。

## 6. Runtime Policy Snapshot

所有执行前置链路只消费编译后的快照，不直接散读配置文件。

```json
{
  "schema_version": "runtime-policy.v1",
  "profile_id": "retail-small-usdm",
  "mode": "live",
  "source_hash": "sha256:...",
  "compiled_at": "2026-07-09T00:00:00Z",
  "effective_limits": {
    "max_single_trade_risk_usdt": 25,
    "max_entry_notional_usdt": 500,
    "max_single_position_leverage": 2
  },
  "cost_model": {
    "fee_bps": 2,
    "slippage_bps": 1,
    "adverse_funding_bps_per_8h": 1
  },
  "permissions": {
    "can_observe": true,
    "can_shadow": true,
    "can_live_small": true
  },
  "applied_overrides": ["lane:S-ALT-4H-BTC-STRONG-RELATIVE-REVERSION-SHORT/*/short"],
  "warnings": []
}
```

`observe.body_json.policy_snapshot` 应保存该快照的 compact 版本，至少包含 `source_hash / effective_limits / permissions / cost_model`，让 review 能追溯当时按什么底线放行。

## 7. Consumers

| Consumer | 只消费 |
| --- | --- |
| slow track | `runtime_policy + strategy policy + live facts` |
| fast track | latest slow observe 继承字段 + `runtime_policy` 子集 |
| plan-preflight | `runtime_policy.effective_limits` |
| execution contract compiler | `runtime_policy.execution + current_plan + exchange rules` |
| R&D / benchmark / campaign | `runtime_policy.cost_model + research limits` |
| strategy review | policy snapshot + actual execution attribution |
| notify dispatch | `notifications` 段 + 环境变量凭证 |

## 8. Small Account Defaults

本项目默认不是机构账户。几万 U 资金、单笔几百到 1000U 的账户，默认 profile 应偏保守：

- 单笔新增名义不超过 `1000 USDT`。
- 单笔 stop 风险先限制在 `25-50 USDT`。
- 同时承担风险的 active flow 不超过 `2`。
- 默认 isolated margin。
- 项目账户默认允许 `live-small` 路径；这不是自动升格，真实执行仍必须由 strategy / setup lifecycle、preflight、execution contract 与 `--run-live-small --yes` 同时放行。
- R&D 通过最多进入 `shadow_candidate` / `shadow` 资格，不能直接触发 live-small。

## 9. Migration Plan

1. 新增 `runtime-policy` loader：读取 `trading-config.json`，缺失时适配旧 `account_config.json / notify_config.json`。
2. 给 `trading-config.json` 建 schema 与 hash，输出 `runtime-policy.v1`。
3. `plan-preflight` 改为消费 `runtime_policy.effective_limits`，补齐 notional / leverage / concurrent flow guards。
4. execution contract compiler 用 runtime policy 编译 target leverage、notional cap、slippage buffer。
5. R&D / benchmark 默认成本模型来自 runtime policy，payload 只能更保守覆盖。
6. slow / fast observe 写入 compact `policy_snapshot`。
7. 旧 `account_config.json` 降级为兼容输入，文档标记 deprecated。

## 10. Non Goals

- 不做多账户、多交易所、多用户配置中心。
- 不引入数据库配置表。
- 不让 config 直接授权绕过 setup / preflight / execution contract。
- 不把 R&D 搜索空间、strategy family 数量或 indicator 体系写成长期固定制度。
