---
name: notify-dispatch
description: >-
  Dispatch operational alerts from trade-flow cron (slow / fast track) to
  user-configured channels (Telegram first, more later). Reads
  ./profile/notify_config.json for channel enablement and per-event severity
  mapping; reads channel credentials from environment variables. Always writes
  a fallback line to ./data/cron.log; never blocks the cron main path on
  channel failure.
capability_class: [V]
writes:
  trade_db: false
  evidence_ledger: false
  artifacts: false
  binance: false
requires_preflight: false
---

# notify-dispatch

trade-flow 通知出口的统一接口。所有"应该让人知道但不阻塞执行"的事件（hard guard 拦截、风险接近上限、aging 超期、对账失败、系统熔断、API 持续失败）都走这里。

## 接口

```
notify(event_type, level, title, body)
```

| 参数 | 说明 |
|---|---|
| `event_type` | 事件类型字符串，必须存在于 `notify_config.json` 的 `events` map 中（未知 event_type → 默认 level=info + warning 写 cron.log） |
| `level` | `info` / `warn` / `critical`；调用方给出的实际严重度，与 events map 里配置的 min level 取较高者作为最终级别 |
| `title` | 一行短摘要（≤ 80 字符），用于通知顶行 |
| `body` | 完整 markdown 内容，含上下文（flow_id / symbol / 触发字段值 / 建议下一步） |

## 配置 (`./profile/notify_config.json`)

```jsonc
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token_env": "TELEGRAM_BOT_TOKEN",     // 凭证从环境变量读，不入文件
      "chat_id_env": "TELEGRAM_CHAT_ID",
      "min_level": "warn",                    // 低于此级别在该通道静默
      "parse_mode": "Markdown",
      "timeout_seconds": 5
    }
  },
  "events": {
    "guard_blocked":             "warn",
    "risk_floor_approach":       "critical",
    "system_suspended":          "critical",
    "aging_overdue":             "warn",
    "aging_chronic":             "warn",
    "reconcile_abort":           "critical",
    "fast_track_streak_skip":    "warn",
    "binance_api_failure":       "warn",
    "strategy_audit_generated":  "warn"
  },
  "level_order": ["info", "warn", "critical"]
}
```

## 调用流程

```
1. 加载 notify_config.json；缺失或解析失败 → 仅写 cron.log，return
2. final_level = max(调用方传入 level, events[event_type] 配置 level)
3. 对每个 enabled channel:
     a. 若 final_level < channel.min_level → skip
     b. 读 channel 凭证环境变量；缺失 → warn 写 cron.log，skip 该通道
     c. 调用通道发送（telegram → POST sendMessage）
     d. 任何异常 → warn 写 cron.log，不抛
4. 不论成功失败，最后写一行结构化 cron.log:
     [TIMESTAMP] [LEVEL] [event_type] title | body_first_line | channels_attempted=[...] channels_ok=[...]
```

## Telegram 通道

- API: `POST https://api.telegram.org/bot{token}/sendMessage`
- payload: `{chat_id, text=f"[{LEVEL}] {title}\n\n{body}"}`（默认不传 parse_mode，纯文本最稳）
- 超时: `timeout_seconds`（缺省 5）

### 错误码处理（实测验证 2026-05-04）

| HTTP code | Telegram description | 触发原因 | notify-dispatch 行为 |
|---|---|---|---|
| 200 | ok | 成功 | 写 cron.log INFO |
| 400 | `chat not found` | chat_id 错或 bot 未被对方 start | warn cron.log，skip |
| 401 | `Unauthorized` | token 被 BotFather revoke | warn cron.log，skip |
| 403 | `Forbidden: bot was blocked by the user` | 用户在 Telegram 里 block 了 bot | warn cron.log，skip |
| 404 | `Not Found` | **token 字符串无效**（注意：不是 401！实测 token 写错走 404） | warn cron.log，skip |
| 429 | `Too Many Requests` | 限流 | warn cron.log，skip（不重试，下个事件再试） |
| 5xx | server error | Telegram 服务端故障 | warn cron.log，skip |
| 网络异常 / 超时 | — | 本机网络 / Telegram API 不可达 | warn cron.log，skip |

**任何非 2xx 响应都不抛异常、不重试、不阻塞 cron**——只 fallback 到 cron.log。critical 事件可由调用方在多通道（未来）冗余下发以提高送达率，但单通道失败永远只是降级，不是错误。

### Parse mode（可选，默认关闭）

`notify_config.json` 中 `telegram.parse_mode` 字段：

- 缺省 / 不设 / 设为 `null` → 纯文本，最稳定。**MVP 推荐这个值**
- `Markdown` / `MarkdownV2` / `HTML` → 调用方必须保证 `text` 内容已正确转义；否则 Telegram 返回 `400 Bad Request: can't parse entities`，整条消息发不出
  - 例：用户的 reason 文本里出现 `_` `*` `[` `` ` `` 等字符未转义 → 直接挂
  - 转义函数应在调用 `notify(...)` 的上游处理；notify-dispatch 本身不做内容转义（避免对纯文本 caller 的副作用）

实测：开启 Markdown 后一条普通的 `_本轮跳过_` 文本可正常发送，但只要 caller 不知道哪些字符敏感就有破解风险。MVP 默认纯文本，等出现明确格式化需求（如固定模板的 DECISION_CARD 推送）再按模板单独转义。

## 环境变量配置（用户侧）

```bash
# ~/.zshrc 或 ~/.bashrc
export TELEGRAM_BOT_TOKEN="<from @BotFather>"
export TELEGRAM_CHAT_ID="<from getUpdates>"
```

绝不把 token 写进配置文件或入 git。

## 设计原则

- **永不阻塞 cron 主流程**：任何 notify 失败都只写 cron.log，不向上抛异常
- **凭证只走环境变量**：profile/notify_config.json 全文可入 git；凭证留 `.env.local` 或 shell rc，确保配置可分享
- **cron.log 是 ground truth**：所有通知尝试都落 log，通道成功与否只是次要状态
- **未来扩展通道**：在 `channels` 下加新 key（如 `bark` / `discord` / `email`），通道处理代码独立 plugin 化；events 配置不需变

## MVP 限制

- 仅支持 Telegram；其它通道接入按需添加
- 不做去重 / rate limit / batching：一个事件一次调用，cron 节奏自然控制频率
- 不做 ack / retry：失败即放弃，下个事件正常发；critical 事件由调用方自行决定是否多个通道冗余

## 参考实现（最小可用 curl 形态）

实施前已用 curl 验证通道连通；脚本/skill 实现可直接照搬此调用形态：

```bash
# 验证（已实测 2026-05-04，返回 ok:true，message_id:4）
curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=[INFO] trade-flow notify channel test ✅"
```

要点：
- POST body 用 `--data-urlencode text=...` 而非 `-d`，避免 text 中包含 `&` `=` 等字符破坏 form 编码
- 不传 `parse_mode` → 纯文本，永不挂
- 整个调用 timeout 5s 足够（实测 < 500ms RTT）

未来 plugin 化扩展通道时，每个 channel 独立模块对外暴露同一签名：

```
def send(level: str, title: str, body: str, ch_cfg: dict) -> bool:
    """返回 True=已成功送达；False=失败已 fallback log"""
```

dispatcher 只负责 level filter + 凭证读取 + 多通道 fan-out，通道实现细节（API URL / payload 形态 / 错误码语义）封装在通道模块内。
