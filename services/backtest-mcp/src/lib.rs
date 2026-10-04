//! The `backtest` MCP server's protocol: the four tools, the one request each becomes, and the
//! JSON-RPC answers around them.
//!
//! The server is `backtest-mcp`, a stateless stdio process that holds the R&D API's URL and token.
//! Everything it decides lives here, transport-free, so it is tested where this crate's own tests
//! run; `src/main.rs` adds only the HTTP client and the stdio loop. Every rule lives in R&D behind
//! a route: a tool sends one request and passes the answer or the refusal through by name,
//! sequencing nothing and remembering nothing. This crate depends on no Owner crate.

use std::{future::Future, pin::Pin};

use serde_json::{Value, json};

/// The MCP protocol revision answered when a client asks for none.
pub const PROTOCOL_VERSION: &str = "2025-06-18";

/// The longest run id a tool puts in a route's path.
const MAX_RUN_ID_LEN: usize = 128;

/// The fields `run` sends, exactly the ones `POST /v1/backtests` reads.
const RUN_FIELDS: [&str; 7] = [
    "run_id",
    "strategy_id",
    "instrument",
    "execution_timeframe",
    "window_start_ns",
    "window_end_ns_exclusive",
    "custody_chain_root",
];

/// One request a tool sends to the R&D API.
#[derive(Debug, Eq, PartialEq)]
pub struct ApiRequest {
    pub method: &'static str,
    pub path: String,
    pub body: Option<Value>,
}

/// The R&D API's answer: its status and its body, as the exact text it sent.
///
/// The text is kept rather than parsed into a [`Value`], whose objects sort their keys: a recorded
/// run's request and answer are its stored bytes.
pub type ApiAnswer = (u16, String);

/// Sends a request to the R&D API.
pub trait Api {
    fn send(&self, request: ApiRequest) -> Pin<Box<dyn Future<Output = ApiAnswer> + Send + '_>>;
}

/// A run id a tool may put in a route's path: letters, digits, `.`, `_` and `-`, at most 128 of
/// them. A run submitted under any other spelling is not readable through this server.
fn path_safe_run_id(text: &str) -> Option<&str> {
    (!text.is_empty()
        && text.len() <= MAX_RUN_ID_LEN
        && text
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-')))
    .then_some(text)
}

/// The four tools, each with the input it takes.
#[must_use]
pub fn tools() -> Value {
    let run_id = json!({
        "type": "string",
        "description": "The run's id: letters, digits, '.', '_' and '-', at most 128 characters."
    });
    json!([
        {
            "name": "run",
            "description": "Submit a backtest of a catalogued strategy over one instrument's window. The whole run happens server-side in this one call; the answer is where it stopped, or the refusal by name. The same request under the same run_id answers the recorded run again; another request under it is refused as RUN_ID_CONFLICT.",
            "inputSchema": {"type": "object", "properties": {
                "run_id": run_id,
                "strategy_id": {"type": "string", "description": "A strategy_id from the strategy-authoring server, `sha256:` and 64 lower-case hex digits."},
                "instrument": {"type": "string", "description": "The instrument, such as BTCUSDT-PERP.BINANCE."},
                "execution_timeframe": {"type": "string", "description": "The bar timeframe the run executes on, such as 1d or 4h."},
                "window_start_ns": {"type": "integer", "minimum": 0, "description": "The window's first instant, in nanoseconds since the Unix epoch."},
                "window_end_ns_exclusive": {"type": "integer", "minimum": 0, "description": "The instant after the window's last, in nanoseconds since the Unix epoch."},
                "custody_chain_root": {"type": "string", "description": "The Market Data custody chain the window is read from."}
            }, "required": RUN_FIELDS, "additionalProperties": false}
        },
        {
            "name": "status",
            "description": "Read one recorded run: the request it was submitted with and the answer it was given.",
            "inputSchema": {"type": "object", "properties": {"run_id": run_id}, "required": ["run_id"], "additionalProperties": false}
        },
        {
            "name": "report",
            "description": "Read one run's report, or the refusal naming why it has none, such as RUN_HAS_NO_RESULT with the replay state the run stopped at.",
            "inputSchema": {"type": "object", "properties": {"run_id": run_id}, "required": ["run_id"], "additionalProperties": false}
        },
        {
            "name": "list",
            "description": "List recorded runs, newest first.",
            "inputSchema": {"type": "object", "properties": {
                "limit": {"type": "integer", "minimum": 1, "maximum": 500}
            }, "additionalProperties": false}
        }
    ])
}

/// The one request a tool call becomes, or the refusal it is answered with before any request.
///
/// # Errors
///
/// Returns the status and body of a refusal made before any request: an unknown tool, a call with
/// an argument its tool does not take or without one it needs, and a run id no route's path takes.
pub fn request_for(name: &str, arguments: &Value) -> Result<ApiRequest, (u16, Value)> {
    let malformed = || (400, json!({"error": "MALFORMED_TYPED_REQUEST"}));
    let allowed = |keys: &[&str]| {
        arguments
            .as_object()
            .is_some_and(|object| object.keys().all(|key| keys.contains(&key.as_str())))
    };
    // A run id becomes part of a route's path, so only a path-safe spelling is let through;
    // anything else could name another route.
    let run_id = || {
        arguments
            .get("run_id")
            .and_then(Value::as_str)
            .and_then(path_safe_run_id)
            .map(ToOwned::to_owned)
            .ok_or((404, json!({"error": "RUN_UNKNOWN"})))
    };

    match name {
        "run" if allowed(&RUN_FIELDS) => {
            run_id()?;
            Ok(ApiRequest {
                method: "POST",
                path: "/v1/backtests".to_owned(),
                body: Some(arguments.clone()),
            })
        }
        "status" if allowed(&["run_id"]) => Ok(ApiRequest {
            method: "GET",
            path: format!("/v1/backtests/{}", run_id()?),
            body: None,
        }),
        "report" if allowed(&["run_id"]) => Ok(ApiRequest {
            method: "GET",
            path: format!("/v1/backtests/{}/report", run_id()?),
            body: None,
        }),
        "list" if allowed(&["limit"]) => {
            let limit = match arguments.get("limit") {
                None => String::new(),
                Some(value) => format!("?limit={}", value.as_u64().ok_or_else(malformed)?),
            };
            Ok(ApiRequest {
                method: "GET",
                path: format!("/v1/backtests{limit}"),
                body: None,
            })
        }
        "run" | "status" | "report" | "list" => Err(malformed()),
        _ => Err((404, json!({"error": "TOOL_UNKNOWN"}))),
    }
}

/// A tool result: the R&D API's body as text, verbatim, and parsed as structured content; an
/// error when the API refused.
#[must_use]
pub fn tool_result((status, body): ApiAnswer) -> Value {
    let structured = serde_json::from_str::<Value>(&body).unwrap_or(Value::Null);
    json!({
        "content": [{"type": "text", "text": body}],
        "structuredContent": structured,
        "isError": !(200..300).contains(&status),
    })
}

/// Answers one JSON-RPC message, or nothing for a notification.
pub async fn handle(api: &dyn Api, message: &Value) -> Option<Value> {
    let id = message.get("id").cloned()?;
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let result = match method {
        "initialize" => {
            let requested = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or(PROTOCOL_VERSION);
            json!({
                "protocolVersion": requested,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "backtest", "version": env!("CARGO_PKG_VERSION")}
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({"tools": tools()}),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));

            match request_for(name, &arguments) {
                Ok(request) => tool_result(api.send(request).await),
                Err((status, refusal)) => tool_result((status, refusal.to_string())),
            }
        }
        _ => {
            return Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {"code": -32601, "message": format!("method not found: {method}")}
            }));
        }
    };
    Some(json!({"jsonrpc": "2.0", "id": id, "result": result}))
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use rstest::rstest;

    use super::*;

    /// Records each request and answers with a fixed status and body.
    struct RecordingApi {
        sent: Mutex<Vec<ApiRequest>>,
        answer: ApiAnswer,
    }

    impl Api for RecordingApi {
        fn send(
            &self,
            request: ApiRequest,
        ) -> Pin<Box<dyn Future<Output = ApiAnswer> + Send + '_>> {
            self.sent.lock().unwrap().push(request);
            let answer = self.answer.clone();
            Box::pin(async move { answer })
        }
    }

    async fn call(answer: ApiAnswer, name: &str, arguments: Value) -> (Value, Vec<ApiRequest>) {
        let api = RecordingApi {
            sent: Mutex::new(Vec::new()),
            answer,
        };
        let reply = handle(
            &api,
            &json!({"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": name, "arguments": arguments}}),
        )
        .await
        .expect("a request is answered");
        (reply["result"].clone(), api.sent.into_inner().unwrap())
    }

    fn run_arguments() -> Value {
        json!({
            "run_id": "t0-btc-2024",
            "strategy_id": format!("sha256:{}", "ab".repeat(32)),
            "instrument": "BTCUSDT-PERP.BINANCE",
            "execution_timeframe": "1d",
            "window_start_ns": 0,
            "window_end_ns_exclusive": 86_400_000_000_000_u64,
            "custody_chain_root": "5a5a"
        })
    }

    /// Each tool sends exactly one request to its route, and passes the answer through.
    #[rstest]
    #[case::run("run", run_arguments(), "POST", "/v1/backtests", true)]
    #[case::status("status", json!({"run_id": "t0-btc-2024"}), "GET", "/v1/backtests/t0-btc-2024", false)]
    #[case::report("report", json!({"run_id": "t0-btc-2024"}), "GET", "/v1/backtests/t0-btc-2024/report", false)]
    #[case::list("list", json!({"limit": 20}), "GET", "/v1/backtests?limit=20", false)]
    #[case::list_default("list", json!({}), "GET", "/v1/backtests", false)]
    #[tokio::test]
    async fn each_tool_sends_one_request_to_its_route(
        #[case] name: &str,
        #[case] arguments: Value,
        #[case] method: &str,
        #[case] path: &str,
        #[case] carries_body: bool,
    ) {
        let answer = json!({"replay_state": "CUSTODY_FRAMES_NOT_AVAILABLE"});
        let (result, sent) = call((200, answer.to_string()), name, arguments).await;

        assert_eq!(sent.len(), 1);
        assert_eq!((sent[0].method, sent[0].path.as_str()), (method, path));
        assert_eq!(sent[0].body, carries_body.then(run_arguments));
        assert_eq!(result["structuredContent"], answer);
        assert_eq!(result["isError"], false);
    }

    /// The body reaches the agent as the exact text R&D sent; only the structured copy is parsed.
    #[rstest]
    #[tokio::test]
    async fn the_body_text_passes_through_verbatim() {
        let body = r#"{"run_id":"r","request":{"window_start_ns":0,"run_id":"r"},"answer":{}}"#;
        let (result, _) = call((200, body.to_owned()), "status", json!({"run_id": "r"})).await;

        assert_eq!(result["content"][0]["text"], body);
        assert_eq!(result["structuredContent"]["run_id"], "r");
    }

    /// A refusal from R&D comes back as a tool error carrying R&D's body, name and all.
    #[rstest]
    #[case::conflict(409, json!({"request_identity": "r", "code": "RUN_ID_CONFLICT"}))]
    #[case::no_result(409, json!({"request_identity": "r", "code": "RUN_HAS_NO_RESULT", "replay_state": "CUSTODY_FRAMES_NOT_AVAILABLE"}))]
    #[case::unknown_strategy(404, json!({"request_identity": "r", "code": "STRATEGY_UNKNOWN"}))]
    #[tokio::test]
    async fn an_owner_refusal_passes_through_by_name(#[case] status: u16, #[case] refusal: Value) {
        let (result, _) = call(
            (status, refusal.to_string()),
            "report",
            json!({"run_id": "r"}),
        )
        .await;

        assert_eq!(result["isError"], true);
        assert_eq!(result["structuredContent"], refusal);
    }

    /// A call that cannot name a route safely sends nothing: a run id outside the path-safe
    /// spelling, a missing or unknown argument, a bad limit, and an unknown tool.
    #[rstest]
    #[case::traversal("status", json!({"run_id": "../strategies"}), "RUN_UNKNOWN")]
    #[case::slash("report", json!({"run_id": "a/b"}), "RUN_UNKNOWN")]
    #[case::too_long("status", json!({"run_id": "r".repeat(129)}), "RUN_UNKNOWN")]
    #[case::empty("status", json!({"run_id": ""}), "RUN_UNKNOWN")]
    #[case::run_with_unsafe_id("run", {
        let mut arguments = run_arguments();
        arguments["run_id"] = json!("a b");
        arguments
    }, "RUN_UNKNOWN")]
    #[case::unknown_argument("run", {
        let mut arguments = run_arguments();
        arguments["cost_profile"] = json!("x");
        arguments
    }, "MALFORMED_TYPED_REQUEST")]
    #[case::bad_limit("list", json!({"limit": "ten"}), "MALFORMED_TYPED_REQUEST")]
    #[case::unknown_tool("cancel", json!({"run_id": "r"}), "TOOL_UNKNOWN")]
    #[tokio::test]
    async fn a_call_that_cannot_name_a_route_sends_nothing(
        #[case] name: &str,
        #[case] arguments: Value,
        #[case] code: &str,
    ) {
        let (result, sent) = call((200, "{}".to_owned()), name, arguments).await;

        assert!(sent.is_empty());
        assert_eq!(result["isError"], true);
        assert_eq!(result["structuredContent"]["error"], code);
    }

    /// The protocol around the tools: the handshake, the four tools listed, a notification left
    /// unanswered, and an unknown method refused.
    #[rstest]
    #[tokio::test]
    async fn the_server_speaks_the_mcp_handshake_and_lists_four_tools() {
        let api = RecordingApi {
            sent: Mutex::new(Vec::new()),
            answer: (200, "{}".to_owned()),
        };
        let initialized = handle(
            &api,
            &json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}}),
        )
        .await
        .unwrap();
        assert_eq!(initialized["result"]["serverInfo"]["name"], "backtest");
        assert_eq!(initialized["result"]["protocolVersion"], "2025-06-18");
        assert_eq!(
            handle(
                &api,
                &json!({"jsonrpc": "2.0", "method": "notifications/initialized"})
            )
            .await,
            None
        );
        let listed = handle(
            &api,
            &json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}),
        )
        .await
        .unwrap();
        let names = listed["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(names, ["run", "status", "report", "list"]);
        let unknown = handle(
            &api,
            &json!({"jsonrpc": "2.0", "id": 3, "method": "resources/list"}),
        )
        .await
        .unwrap();
        assert_eq!(unknown["error"]["code"], -32601);
        assert!(api.sent.lock().unwrap().is_empty());
    }
}
