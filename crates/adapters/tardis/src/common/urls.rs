//! Tardis base URL constants and resolution helpers.

use super::consts::TARDIS_MACHINE_WS_URL;

/// Default Tardis REST API base URL.
pub const TARDIS_HTTP_BASE_URL: &str = "https://api.tardis.dev/v1";

/// Resolves the Tardis Machine WebSocket base URL from an explicit value or the
/// `TARDIS_MACHINE_WS_URL` environment variable.
///
/// # Errors
///
/// Returns an error if neither `url` nor the environment variable is set.
pub fn resolve_ws_base_url(url: Option<&str>) -> anyhow::Result<String> {
    url.map(ToString::to_string)
        .or_else(|| std::env::var(TARDIS_MACHINE_WS_URL).ok())
        .ok_or_else(|| {
            anyhow::anyhow!(
                "Tardis Machine `base_url` must be provided or \
                 set in the '{TARDIS_MACHINE_WS_URL}' environment variable"
            )
        })
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn test_resolve_ws_base_url_with_explicit_value() {
        let result = resolve_ws_base_url(Some("ws://localhost:8001")).unwrap();
        assert_eq!(result, "ws://localhost:8001");
    }

    #[rstest]
    fn test_resolve_ws_base_url_prefers_explicit_value() {
        let result = resolve_ws_base_url(Some("ws://custom:9999")).unwrap();
        assert_eq!(result, "ws://custom:9999");
    }
}
