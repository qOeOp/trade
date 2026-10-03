//! The `strategy-authoring` MCP server's protocol: the six tools, the one request each becomes, and the
//! JSON-RPC answers around them.
//!
//! The server is `strategy-authoring-mcp` in `rd-owner-api`'s package, a stateless stdio process that holds
//! the R&D API's URL and token. Everything it decides lives here, transport-free, so it is tested
//! where the workspace's tests run; the binary adds only the HTTP client and the stdio loop. Every
//! rule lives in R&D behind a route: a tool sends one request and passes the answer or the refusal
//! through by name, sequencing nothing and remembering nothing.

use std::{future::Future, pin::Pin};

use serde_json::{Value, json};

use crate::strategy_catalog_v1::StrategyIdentityV1;

/// The MCP protocol revision answered when a client asks for none.
pub const PROTOCOL_VERSION: &str = "2025-06-18";

/// One request a tool sends to the R&D API.
#[derive(Debug, Eq, PartialEq)]
pub struct ApiRequest {
    pub method: &'static str,
    pub path: String,
    pub body: Option<Value>,
}

/// The R&D API's answer: its status and its body, as the exact text it sent.
///
/// The text is kept rather than parsed into a [`Value`], whose objects sort their keys: a strategy's
/// `spec` is its stored bytes, which hash to its `strategy_id` only in the order they were stored.
pub type ApiAnswer = (u16, String);

/// Sends a request to the R&D API.
pub trait Api {
    fn send(&self, request: ApiRequest) -> Pin<Box<dyn Future<Output = ApiAnswer> + Send + '_>>;
}

/// The six tools, each with the input it takes.
pub fn tools() -> Value {
    let spec = json!({
        "type": "object",
        "description": "A single-threshold strategy statement: channel, threshold_coefficient, comparison, when_true, otherwise, falsifier, and optionally stop_loss_fraction, take_profit_fraction and max_holding_bars."
    });
    let strategy_id = json!({
        "type": "string",
        "description": "A strategy_id, `sha256:` and 64 lower-case hex digits."
    });
    json!([
        {
            "name": "validate",
            "description": "Author a statement and report VALID with the strategy_id it would have, or the refusal by name. Writes nothing.",
            "inputSchema": {"type": "object", "properties": {"spec": spec}, "required": ["spec"], "additionalProperties": false}
        },
        {
            "name": "create",
            "description": "Write a statement and return its immutable strategy_id. The same statement is always the same strategy.",
            "inputSchema": {"type": "object", "properties": {"spec": spec}, "required": ["spec"], "additionalProperties": false}
        },
        {
            "name": "get",
            "description": "Read one strategy, archived or not, with its statement exactly as stored.",
            "inputSchema": {"type": "object", "properties": {"strategy_id": strategy_id}, "required": ["strategy_id"], "additionalProperties": false}
        },
        {
            "name": "list",
            "description": "List strategies in the order they were written; archived ones only when include_archived is true.",
            "inputSchema": {"type": "object", "properties": {
                "include_archived": {"type": "boolean"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 500}
            }, "additionalProperties": false}
        },
        {
            "name": "revise",
            "description": "Write a new statement that names strategy_id as its predecessor and return its own strategy_id. Nothing is edited in place.",
            "inputSchema": {"type": "object", "properties": {"strategy_id": strategy_id, "spec": spec}, "required": ["strategy_id", "spec"], "additionalProperties": false}
        },
        {
            "name": "archive",
            "description": "Archive a strategy: it stays readable and can no longer be revised or run.",
            "inputSchema": {"type": "object", "properties": {"strategy_id": strategy_id}, "required": ["strategy_id"], "additionalProperties": false}
        }
    ])
}

/// The one request a tool call becomes, or the refusal it is answered with before any request.
pub fn request_for(name: &str, arguments: &Value) -> Result<ApiRequest, (u16, Value)> {
    let malformed = || (400, json!({"error": "MALFORMED_TYPED_REQUEST"}));
    let spec = || arguments.get("spec").cloned().ok_or_else(malformed);
    // An identifier becomes part of a route's path, so only the one spelling of a strategy_id is
    // let through; anything else could name another route.
    let strategy_id = || {
        arguments
            .get("strategy_id")
            .and_then(Value::as_str)
            .and_then(StrategyIdentityV1::parse)
            .map(|identity| identity.to_string())
            .ok_or((404, json!({"error": "STRATEGY_UNKNOWN"})))
    };
    let allowed = |keys: &[&str]| {
        arguments
            .as_object()
            .is_some_and(|object| object.keys().all(|key| keys.contains(&key.as_str())))
    };

    match name {
        "validate" | "create" if allowed(&["spec"]) => Ok(ApiRequest {
            method: "POST",
            path: if name == "validate" {
                "/v1/strategies/validate".to_owned()
            } else {
                "/v1/strategies".to_owned()
            },
            body: Some(json!({"spec": spec()?})),
        }),
        "get" if allowed(&["strategy_id"]) => Ok(ApiRequest {
            method: "GET",
            path: format!("/v1/strategies/{}", strategy_id()?),
            body: None,
        }),
        "list" if allowed(&["include_archived", "limit"]) => {
            let include_archived = match arguments.get("include_archived") {
                None => false,
                Some(value) => value.as_bool().ok_or_else(malformed)?,
            };
            let limit = match arguments.get("limit") {
                None => String::new(),
                Some(value) => format!("&limit={}", value.as_u64().ok_or_else(malformed)?),
            };
            Ok(ApiRequest {
                method: "GET",
                path: format!("/v1/strategies?include_archived={include_archived}{limit}"),
                body: None,
            })
        }
        "revise" if allowed(&["strategy_id", "spec"]) => Ok(ApiRequest {
            method: "POST",
            path: format!("/v1/strategies/{}/revisions", strategy_id()?),
            body: Some(json!({"spec": spec()?})),
        }),
        "archive" if allowed(&["strategy_id"]) => Ok(ApiRequest {
            method: "POST",
            path: format!("/v1/strategies/{}/archive", strategy_id()?),
            body: None,
        }),
        "validate" | "create" | "get" | "list" | "revise" | "archive" => Err(malformed()),
        _ => Err((404, json!({"error": "TOOL_UNKNOWN"}))),
    }
}

/// A tool result: the R&D API's body as text, verbatim, and parsed as structured content; an
/// error when the API refused.
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
                "serverInfo": {"name": "strategy-authoring", "version": env!("CARGO_PKG_VERSION")}
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

    const ID: &str = "sha256:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

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

    /// Each tool sends exactly one request to its route, and passes the answer through.
    #[rstest]
    #[case::validate("validate", json!({"spec": {"x": 1}}), "POST", "/v1/strategies/validate", true)]
    #[case::create("create", json!({"spec": {"x": 1}}), "POST", "/v1/strategies", true)]
    #[case::get("get", json!({"strategy_id": ID}), "GET", &format!("/v1/strategies/{ID}"), false)]
    #[case::list("list", json!({"include_archived": true, "limit": 20}), "GET", "/v1/strategies?include_archived=true&limit=20", false)]
    #[case::list_defaults("list", json!({}), "GET", "/v1/strategies?include_archived=false", false)]
    #[case::revise("revise", json!({"strategy_id": ID, "spec": {"x": 1}}), "POST", &format!("/v1/strategies/{ID}/revisions"), true)]
    #[case::archive("archive", json!({"strategy_id": ID}), "POST", &format!("/v1/strategies/{ID}/archive"), false)]
    #[tokio::test]
    async fn each_tool_sends_one_request_to_its_route(
        #[case] name: &str,
        #[case] arguments: Value,
        #[case] method: &str,
        #[case] path: &str,
        #[case] carries_spec: bool,
    ) {
        let answer = json!({"strategy_id": ID});
        let (result, sent) = call((200, answer.to_string()), name, arguments).await;

        assert_eq!(sent.len(), 1);
        assert_eq!((sent[0].method, sent[0].path.as_str()), (method, path));
        assert_eq!(
            sent[0].body,
            carries_spec.then(|| json!({"spec": {"x": 1}}))
        );
        assert_eq!(result["structuredContent"], answer);
        assert_eq!(result["isError"], false);
    }

    /// The body reaches the agent as the exact text R&D sent, so a `spec` in its stored key order
    /// still hashes to its `strategy_id`; only the structured copy is parsed.
    #[rstest]
    #[tokio::test]
    async fn the_body_text_passes_through_verbatim() {
        let body =
            r#"{"strategy_id":"x","spec":{"scope":"EXACT_INSTRUMENT","role_semantic_id":"r"}}"#;
        let (result, _) = call((200, body.to_owned()), "get", json!({"strategy_id": ID})).await;

        assert_eq!(result["content"][0]["text"], body);
        assert_eq!(
            result["structuredContent"]["spec"]["scope"],
            "EXACT_INSTRUMENT"
        );
    }

    /// A refusal from R&D comes back as a tool error carrying R&D's body, name and all.
    #[rstest]
    #[tokio::test]
    async fn an_owner_refusal_passes_through_by_name() {
        let refusal = json!({"error": "STRATEGY_ARCHIVED"});
        let (result, _) = call(
            (409, refusal.to_string()),
            "archive",
            json!({"strategy_id": ID}),
        )
        .await;

        assert_eq!(result["isError"], true);
        assert_eq!(result["structuredContent"], refusal);
    }

    /// A call that cannot name a route safely sends nothing: an identifier in any other spelling,
    /// a missing statement, an unknown argument, and an unknown tool.
    #[rstest]
    #[case::non_canonical_id("get", json!({"strategy_id": "../strategies"}), "STRATEGY_UNKNOWN")]
    #[case::upper_case_id("archive", json!({"strategy_id": ID.to_uppercase()}), "STRATEGY_UNKNOWN")]
    #[case::no_spec("create", json!({}), "MALFORMED_TYPED_REQUEST")]
    #[case::unknown_argument("validate", json!({"spec": {}, "research_request": "x"}), "MALFORMED_TYPED_REQUEST")]
    #[case::bad_limit("list", json!({"limit": "ten"}), "MALFORMED_TYPED_REQUEST")]
    #[case::unknown_tool("delete", json!({"strategy_id": ID}), "TOOL_UNKNOWN")]
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

    /// The protocol around the tools: the handshake, the six tools listed, a notification left
    /// unanswered, and an unknown method refused.
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
        assert_eq!(
            initialized["result"]["serverInfo"]["name"],
            "strategy-authoring"
        );
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
            ["validate", "create", "get", "list", "revise", "archive"]
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
