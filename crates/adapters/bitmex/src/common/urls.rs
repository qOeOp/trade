//! URL helpers for BitMEX services.

use super::{
    consts::{BITMEX_HTTP_TESTNET_URL, BITMEX_HTTP_URL, BITMEX_WS_TESTNET_URL, BITMEX_WS_URL},
    enums::BitmexEnvironment,
};

/// Gets the BitMEX HTTP base URL.
pub fn get_http_base_url(environment: BitmexEnvironment) -> String {
    match environment {
        BitmexEnvironment::Testnet => BITMEX_HTTP_TESTNET_URL.to_string(),
        BitmexEnvironment::Mainnet => BITMEX_HTTP_URL.to_string(),
    }
}

/// Gets the BitMEX WebSocket URL.
pub fn get_ws_url(environment: BitmexEnvironment) -> String {
    match environment {
        BitmexEnvironment::Testnet => BITMEX_WS_TESTNET_URL.to_string(),
        BitmexEnvironment::Mainnet => BITMEX_WS_URL.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;
    use crate::common::enums::BitmexEnvironment;

    #[rstest]
    fn test_http_urls() {
        assert_eq!(
            get_http_base_url(BitmexEnvironment::Mainnet),
            "https://www.bitmex.com/api/v1"
        );
        assert_eq!(
            get_http_base_url(BitmexEnvironment::Testnet),
            "https://testnet.bitmex.com/api/v1"
        );
    }

    #[rstest]
    fn test_ws_urls() {
        assert_eq!(
            get_ws_url(BitmexEnvironment::Mainnet),
            "wss://ws.bitmex.com/realtime"
        );
        assert_eq!(
            get_ws_url(BitmexEnvironment::Testnet),
            "wss://ws.testnet.bitmex.com/realtime"
        );
    }
}
