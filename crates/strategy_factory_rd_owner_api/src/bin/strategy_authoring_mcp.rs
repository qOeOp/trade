//! `strategy-authoring-mcp`: the `strategy-authoring` server of the agent's domain MCP catalog.
//!
//! A stateless stdio process speaking MCP's JSON-RPC, one message per line. It holds the R&D API's
//! URL and token in its own environment (`RD_OWNER_API_URL`, `RD_OWNER_API_TOKEN`) and reaches
//! `/v1/strategies` only. What each message means is `vibe_strategy_factory::strategy_authoring_mcp_v1`; this
//! binary adds the HTTP client and the stdio loop. No tool argument or result carries the token.

use std::{
    future::Future,
    io::{BufRead as _, Write as _},
    pin::Pin,
};

use serde_json::{Value, json};
use vibe_strategy_factory::strategy_authoring_mcp_v1::{Api, ApiAnswer, ApiRequest, handle};

/// The R&D API over HTTP, authenticated by the token this process holds.
struct HttpApi {
    client: reqwest::Client,
    base_url: String,
    token: String,
}

impl Api for HttpApi {
    fn send(&self, request: ApiRequest) -> Pin<Box<dyn Future<Output = ApiAnswer> + Send + '_>> {
        Box::pin(async move {
            let url = format!("{}{}", self.base_url.trim_end_matches('/'), request.path);
            let builder = match request.method {
                "GET" => self.client.get(url),
                _ => self.client.post(url),
            }
            .bearer_auth(&self.token);
            let builder = match request.body {
                Some(body) => builder.json(&body),
                None => builder,
            };

            match builder.send().await {
                Ok(response) => {
                    let status = response.status().as_u16();
                    // The text as sent: a parse here would reorder the stored statement's keys.
                    let body = response.text().await.unwrap_or_default();
                    (status, body)
                }
                // The route was never reached, so there is no Owner answer to pass through.
                Err(_) => (
                    503,
                    json!({"error": "RD_OWNER_API_UNREACHABLE"}).to_string(),
                ),
            }
        })
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    let api = HttpApi {
        client: reqwest::Client::new(),
        base_url: std::env::var("RD_OWNER_API_URL")
            .map_err(|_| anyhow::anyhow!("RD_OWNER_API_URL is not set"))?,
        token: std::env::var("RD_OWNER_API_TOKEN")
            .map_err(|_| anyhow::anyhow!("RD_OWNER_API_TOKEN is not set"))?,
    };
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();

    for line in stdin.lock().lines() {
        let line = line?;

        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(message) => handle(&api, &message).await,
            Err(_) => Some(json!({
                "jsonrpc": "2.0",
                "id": Value::Null,
                "error": {"code": -32700, "message": "parse error"}
            })),
        };

        if let Some(reply) = reply {
            writeln!(stdout, "{reply}")?;
            stdout.flush()?;
        }
    }
    Ok(())
}
