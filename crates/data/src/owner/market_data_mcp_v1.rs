//! The `market-data` MCP server's protocol: its tools, the one request each becomes, and the
//! JSON-RPC answers around them.
//!
//! The server is `market-data-mcp`, a stateless stdio process that holds the Market Data API's
//! URL and token. Everything it decides lives here, transport-free, so it is tested where the
//! workspace's tests run; the binary adds only the HTTP client and the stdio loop. Every rule
//! lives in Market Data behind a route: a tool sends one request and passes the answer or the
//! refusal through by name, sequencing nothing and remembering nothing - exactly the shape
//! `vibe_strategy_factory::strategy_authoring_mcp_v1` already uses for the `strategy-authoring`
//! server.
//!
//! `get_bars` and `get_funding` are not tools here yet: their own routes
//! (`docs/owners/market-data.md`, "TARGET market-data MCP server") do not exist until T0-5 and
//! the funding schedule read land, in phase 3. Adding a tool for a route that always refused
//! `HOLDOUT_PARTITION_UNDEFINED` would teach nothing a caller could not already read from the
//! doc.

use serde_json::{Value, json};

/// The MCP protocol revision answered when a client asks for none.
pub const PROTOCOL_VERSION: &str = "2025-06-18";

/// One request a tool sends to the Market Data API.
#[derive(Debug, Eq, PartialEq)]
pub struct ApiRequest {
    pub method: &'static str,
    pub path: String,
    pub body: Option<Value>,
}

/// The Market Data API's answer: its status and its body, as the exact text it sent.
pub type ApiAnswer = (u16, String);

/// Sends a request to the Market Data API.
pub trait Api {
    fn send(
        &self,
        request: ApiRequest,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ApiAnswer> + Send + '_>>;
}

/// A job identity: exactly 64 lower-case hex digits, as `start_backfill` mints it
/// (`crates/strategy_factory_rd_owner_api/src/binance_backfill_job.rs::hex`).
fn parse_job_id(value: &str) -> Option<&str> {
    (value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()))
    .then_some(value)
}

/// The six tools this route set backs today, each with the input it takes.
pub fn tools() -> Value {
    let instrument = json!({
        "type": "string",
        "description": "A canonical instrument identity, for example \"BTCUSDT-PERP.BINANCE\"."
    });
    let symbol = json!({
        "type": "string",
        "description": "A Binance USD-M raw symbol among the fixed U1 set, for example \"BTCUSDT\"."
    });
    let execution_timeframe = json!({
        "type": "string",
        "description": "One of the whitelisted execution timeframes: \"1w\", \"1d\", \"4h\", \"1h\"."
    });
    json!([
        {
            "name": "list_instruments",
            "description": "List every instrument Market Data has admitted, in canonical order. A discovery read; never a Replay input.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false}
        },
        {
            "name": "describe_instrument",
            "description": "Describe one admitted instrument from its latest Instrument Master V2 fact: its tick size, lot step and every economic-terms version.",
            "inputSchema": {"type": "object", "properties": {"instrument": instrument}, "required": ["instrument"], "additionalProperties": false}
        },
        {
            "name": "admit_instrument",
            "description": "Admit one Binance USD-M perpetual among the fixed U1 set. Fetches the symbol's public exchangeInfo and commits the facts an instrument needs, in order; re-admitting an already-admitted symbol is refused ALREADY_ADMITTED before any fetch.",
            "inputSchema": {"type": "object", "properties": {"symbol": symbol}, "required": ["symbol"], "additionalProperties": false}
        },
        {
            "name": "backfill",
            "description": "Run a backfill job for one member over one half-open window, at one execution timeframe. Fetches, writes and commits the member's custody synchronously, then answers the job_id; job_status reads its outcome.",
            "inputSchema": {"type": "object", "properties": {
                "instrument": instrument,
                "execution_timeframe": execution_timeframe,
                "window_start_ns": {"type": "integer", "minimum": 0, "description": "Inclusive start of the window, in nanoseconds since the Unix epoch."},
                "window_end_ns_exclusive": {"type": "integer", "minimum": 0, "description": "Exclusive end of the window, in nanoseconds since the Unix epoch."}
            }, "required": ["instrument", "execution_timeframe", "window_start_ns", "window_end_ns_exclusive"], "additionalProperties": false}
        },
        {
            "name": "job_status",
            "description": "Read one backfill job's complete transition history: QUEUED, then RUNNING, then its terminal SUCCEEDED or FAILED disposition.",
            "inputSchema": {"type": "object", "properties": {"job_id": {"type": "string", "description": "A job_id, 64 lower-case hex digits."}}, "required": ["job_id"], "additionalProperties": false}
        },
        {
            "name": "coverage",
            "description": "The half-open ranges every successful backfill has covered for one instrument, by execution timeframe. States no market value.",
            "inputSchema": {"type": "object", "properties": {"instrument": instrument}, "required": ["instrument"], "additionalProperties": false}
        }
    ])
}

/// The one request a tool call becomes, or the refusal it is answered with before any request.
///
/// # Errors
///
/// Returns `(404, "TOOL_UNKNOWN")` for a name none of the six tools has, `(400,
/// "MALFORMED_TYPED_REQUEST")` for a call missing a required argument, naming one these tools do
/// not take, or stating one in the wrong shape, and `(404, "JOB_UNKNOWN")` for a `job_id` not
/// spelled as exactly 64 lower-case hex digits.
pub fn request_for(name: &str, arguments: &Value) -> Result<ApiRequest, (u16, Value)> {
    let malformed = || (400, json!({"error": "MALFORMED_TYPED_REQUEST"}));
    let string_field = |field: &str| {
        arguments
            .get(field)
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .ok_or_else(malformed)
    };
    // An identifier becomes part of a route's path, so only its one well-formed spelling is let
    // through; anything else could name another route.
    let job_id = || {
        arguments
            .get("job_id")
            .and_then(Value::as_str)
            .and_then(parse_job_id)
            .map(ToOwned::to_owned)
            .ok_or((404, json!({"error": "JOB_UNKNOWN"})))
    };
    let allowed = |keys: &[&str]| {
        arguments
            .as_object()
            .is_some_and(|object| object.keys().all(|key| keys.contains(&key.as_str())))
    };

    match name {
        "list_instruments" if allowed(&[]) => Ok(ApiRequest {
            method: "GET",
            path: "/v1/market-data/instruments".to_owned(),
            body: None,
        }),
        "describe_instrument" if allowed(&["instrument"]) => Ok(ApiRequest {
            method: "GET",
            path: format!(
                "/v1/market-data/instruments/{}",
                string_field("instrument")?
            ),
            body: None,
        }),
        "admit_instrument" if allowed(&["symbol"]) => Ok(ApiRequest {
            method: "POST",
            path: "/v1/market-data/binance-perpetual-admissions".to_owned(),
            body: Some(json!({"symbol": string_field("symbol")?})),
        }),
        "backfill"
            if allowed(&[
                "instrument",
                "execution_timeframe",
                "window_start_ns",
                "window_end_ns_exclusive",
            ]) =>
        {
            let window_start_ns = arguments
                .get("window_start_ns")
                .and_then(Value::as_u64)
                .ok_or_else(malformed)?;
            let window_end_ns_exclusive = arguments
                .get("window_end_ns_exclusive")
                .and_then(Value::as_u64)
                .ok_or_else(malformed)?;
            Ok(ApiRequest {
                method: "POST",
                path: "/v1/market-data/backfill-jobs".to_owned(),
                body: Some(json!({
                    "instrument": string_field("instrument")?,
                    "execution_timeframe": string_field("execution_timeframe")?,
                    "window_start_ns": window_start_ns,
                    "window_end_ns_exclusive": window_end_ns_exclusive,
                })),
            })
        }
        "job_status" if allowed(&["job_id"]) => Ok(ApiRequest {
            method: "GET",
            path: format!("/v1/market-data/backfill-jobs/{}", job_id()?),
            body: None,
        }),
        "coverage" if allowed(&["instrument"]) => Ok(ApiRequest {
            method: "GET",
            path: format!(
                "/v1/market-data/instruments/{}/coverage",
                string_field("instrument")?
            ),
            body: None,
        }),
        "list_instruments"
        | "describe_instrument"
        | "admit_instrument"
        | "backfill"
        | "job_status"
        | "coverage" => Err(malformed()),
        _ => Err((404, json!({"error": "TOOL_UNKNOWN"}))),
    }
}

/// A tool result: the Market Data API's body as text, verbatim, and parsed as structured
/// content; an error when the API refused.
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
                "serverInfo": {"name": "market-data", "version": env!("CARGO_PKG_VERSION")}
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

    struct RecordingApi {
        sent: Mutex<Vec<ApiRequest>>,
        answer: ApiAnswer,
    }

    impl Api for RecordingApi {
        fn send(
            &self,
            request: ApiRequest,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ApiAnswer> + Send + '_>> {
            self.sent.lock().unwrap().push(request);
            let answer = self.answer.clone();
            Box::pin(async move { answer })
        }
    }

    const JOB_ID: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const INSTRUMENT: &str = "BTCUSDT-PERP.BINANCE";

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

    #[rstest]
    #[case::list_instruments("list_instruments", json!({}), "GET", "/v1/market-data/instruments", None)]
    #[case::describe_instrument("describe_instrument", json!({"instrument": INSTRUMENT}), "GET", &format!("/v1/market-data/instruments/{INSTRUMENT}"), None)]
    #[case::admit_instrument("admit_instrument", json!({"symbol": "BTCUSDT"}), "POST", "/v1/market-data/binance-perpetual-admissions", Some(json!({"symbol": "BTCUSDT"})))]
    #[case::backfill(
        "backfill",
        json!({"instrument": INSTRUMENT, "execution_timeframe": "1d", "window_start_ns": 1, "window_end_ns_exclusive": 2}),
        "POST",
        "/v1/market-data/backfill-jobs",
        Some(json!({"instrument": INSTRUMENT, "execution_timeframe": "1d", "window_start_ns": 1, "window_end_ns_exclusive": 2}))
    )]
    #[case::job_status("job_status", json!({"job_id": JOB_ID}), "GET", &format!("/v1/market-data/backfill-jobs/{JOB_ID}"), None)]
    #[case::coverage("coverage", json!({"instrument": INSTRUMENT}), "GET", &format!("/v1/market-data/instruments/{INSTRUMENT}/coverage"), None)]
    #[tokio::test]
    async fn each_tool_sends_one_request_to_its_route(
        #[case] name: &str,
        #[case] arguments: Value,
        #[case] method: &str,
        #[case] path: &str,
        #[case] body: Option<Value>,
    ) {
        let answer = json!({"ok": true});
        let (result, sent) = call((200, answer.to_string()), name, arguments).await;

        assert_eq!(sent.len(), 1);
        assert_eq!((sent[0].method, sent[0].path.as_str()), (method, path));
        assert_eq!(sent[0].body, body);
        assert_eq!(result["structuredContent"], answer);
        assert_eq!(result["isError"], false);
    }

    #[rstest]
    #[tokio::test]
    async fn the_body_text_passes_through_verbatim() {
        let body = r#"{"instrument":"BTCUSDT-PERP.BINANCE","tick_size":"0.10"}"#;
        let (result, _) = call(
            (200, body.to_owned()),
            "describe_instrument",
            json!({"instrument": INSTRUMENT}),
        )
        .await;

        assert_eq!(result["content"][0]["text"], body);
        assert_eq!(result["structuredContent"]["tick_size"], "0.10");
    }

    #[rstest]
    #[tokio::test]
    async fn an_owner_refusal_passes_through_by_name() {
        let refusal = json!({"error": "TIMEFRAME_UNSUPPORTED"});
        let (result, _) = call(
            (400, refusal.to_string()),
            "backfill",
            json!({"instrument": INSTRUMENT, "execution_timeframe": "15m", "window_start_ns": 1, "window_end_ns_exclusive": 2}),
        )
        .await;

        assert_eq!(result["isError"], true);
        assert_eq!(result["structuredContent"], refusal);
    }

    #[rstest]
    #[case::non_canonical_job_id("job_status", json!({"job_id": "not-hex"}), "JOB_UNKNOWN")]
    #[case::upper_case_job_id("job_status", json!({"job_id": JOB_ID.to_uppercase()}), "JOB_UNKNOWN")]
    #[case::no_symbol("admit_instrument", json!({}), "MALFORMED_TYPED_REQUEST")]
    #[case::unknown_argument("list_instruments", json!({"instrument": INSTRUMENT}), "MALFORMED_TYPED_REQUEST")]
    #[case::bad_window("backfill", json!({"instrument": INSTRUMENT, "execution_timeframe": "1d", "window_start_ns": "soon", "window_end_ns_exclusive": 2}), "MALFORMED_TYPED_REQUEST")]
    #[case::unknown_tool("delete_instrument", json!({"instrument": INSTRUMENT}), "TOOL_UNKNOWN")]
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

    #[rstest]
    #[tokio::test]
    async fn the_server_speaks_the_mcp_handshake_and_lists_six_tools() {
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
        assert_eq!(initialized["result"]["serverInfo"]["name"], "market-data");
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
        assert_eq!(
            names,
            [
                "list_instruments",
                "describe_instrument",
                "admit_instrument",
                "backfill",
                "job_status",
                "coverage",
            ]
        );

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
