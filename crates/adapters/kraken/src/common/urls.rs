//! URL builders for Kraken HTTP and WebSocket endpoints.

use super::{
    consts::{
        KRAKEN_FUTURES_DEMO_HTTP_URL, KRAKEN_FUTURES_DEMO_WS_URL, KRAKEN_FUTURES_HTTP_URL,
        KRAKEN_FUTURES_WS_URL, KRAKEN_SPOT_HTTP_URL, KRAKEN_SPOT_WS_PRIVATE_URL,
        KRAKEN_SPOT_WS_PUBLIC_URL,
    },
    enums::{KrakenEnvironment, KrakenProductType},
};

/// Returns the HTTP base URL for the given product type and environment.
pub fn get_kraken_http_base_url(
    product_type: KrakenProductType,
    environment: KrakenEnvironment,
) -> &'static str {
    match (product_type, environment) {
        (KrakenProductType::Spot, KrakenEnvironment::Live) => KRAKEN_SPOT_HTTP_URL,
        (KrakenProductType::Spot, KrakenEnvironment::Demo) => {
            panic!("Kraken Spot does not support the demo environment")
        }
        (KrakenProductType::Futures, KrakenEnvironment::Live) => KRAKEN_FUTURES_HTTP_URL,
        (KrakenProductType::Futures, KrakenEnvironment::Demo) => KRAKEN_FUTURES_DEMO_HTTP_URL,
    }
}

/// Returns the public WebSocket URL for the given product type and environment.
pub fn get_kraken_ws_public_url(
    product_type: KrakenProductType,
    environment: KrakenEnvironment,
) -> &'static str {
    match (product_type, environment) {
        (KrakenProductType::Spot, KrakenEnvironment::Live) => KRAKEN_SPOT_WS_PUBLIC_URL,
        (KrakenProductType::Spot, KrakenEnvironment::Demo) => {
            panic!("Kraken Spot does not support the demo environment")
        }
        (KrakenProductType::Futures, KrakenEnvironment::Live) => KRAKEN_FUTURES_WS_URL,
        (KrakenProductType::Futures, KrakenEnvironment::Demo) => KRAKEN_FUTURES_DEMO_WS_URL,
    }
}

/// Returns the private WebSocket URL for the given product type and environment.
pub fn get_kraken_ws_private_url(
    product_type: KrakenProductType,
    environment: KrakenEnvironment,
) -> &'static str {
    match (product_type, environment) {
        (KrakenProductType::Spot, KrakenEnvironment::Live) => KRAKEN_SPOT_WS_PRIVATE_URL,
        (KrakenProductType::Spot, KrakenEnvironment::Demo) => {
            panic!("Kraken Spot does not support the demo environment")
        }
        (KrakenProductType::Futures, KrakenEnvironment::Live) => KRAKEN_FUTURES_WS_URL,
        (KrakenProductType::Futures, KrakenEnvironment::Demo) => KRAKEN_FUTURES_DEMO_WS_URL,
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn test_spot_live_urls() {
        assert_eq!(
            get_kraken_http_base_url(KrakenProductType::Spot, KrakenEnvironment::Live),
            KRAKEN_SPOT_HTTP_URL
        );
        assert_eq!(
            get_kraken_ws_public_url(KrakenProductType::Spot, KrakenEnvironment::Live),
            KRAKEN_SPOT_WS_PUBLIC_URL
        );
        assert_eq!(
            get_kraken_ws_private_url(KrakenProductType::Spot, KrakenEnvironment::Live),
            KRAKEN_SPOT_WS_PRIVATE_URL
        );
    }

    #[rstest]
    fn test_futures_demo_urls() {
        assert_eq!(
            get_kraken_http_base_url(KrakenProductType::Futures, KrakenEnvironment::Demo),
            KRAKEN_FUTURES_DEMO_HTTP_URL
        );
        assert_eq!(
            get_kraken_ws_public_url(KrakenProductType::Futures, KrakenEnvironment::Demo),
            KRAKEN_FUTURES_DEMO_WS_URL
        );
        assert_eq!(
            get_kraken_ws_private_url(KrakenProductType::Futures, KrakenEnvironment::Demo),
            KRAKEN_FUTURES_DEMO_WS_URL
        );
    }

    #[rstest]
    #[should_panic(expected = "Kraken Spot does not support the demo environment")]
    fn test_spot_demo_panics() {
        get_kraken_http_base_url(KrakenProductType::Spot, KrakenEnvironment::Demo);
    }
}
