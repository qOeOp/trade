//! URL helpers for dYdX services.

use super::{
    consts::{
        DYDX_GRPC_URLS, DYDX_HTTP_URL, DYDX_REST_URL, DYDX_TESTNET_GRPC_URLS,
        DYDX_TESTNET_HTTP_URL, DYDX_TESTNET_REST_URL, DYDX_TESTNET_WS_URL, DYDX_WS_URL,
    },
    enums::DydxNetwork,
};

/// Gets the HTTP base URL for the specified network.
#[must_use]
pub fn http_base_url(network: DydxNetwork) -> &'static str {
    match network {
        DydxNetwork::Testnet => DYDX_TESTNET_HTTP_URL,
        DydxNetwork::Mainnet => DYDX_HTTP_URL,
    }
}

/// Gets the WebSocket URL for the specified network.
#[must_use]
pub fn ws_url(network: DydxNetwork) -> &'static str {
    match network {
        DydxNetwork::Testnet => DYDX_TESTNET_WS_URL,
        DydxNetwork::Mainnet => DYDX_WS_URL,
    }
}

/// Gets the gRPC URLs with fallback support for the specified network.
///
/// Returns an array of gRPC endpoints that should be tried in order.
/// This is important for DEX environments where individual validator nodes
/// can become unavailable or fail.
#[must_use]
pub fn grpc_urls(network: DydxNetwork) -> &'static [&'static str] {
    match network {
        DydxNetwork::Testnet => DYDX_TESTNET_GRPC_URLS,
        DydxNetwork::Mainnet => DYDX_GRPC_URLS,
    }
}

/// Gets the primary gRPC URL for the specified network.
///
/// # Notes
///
/// For production use, consider using `grpc_urls()` to get all available
/// endpoints and implement fallback logic via `DydxGrpcClient::new_with_fallback()`.
#[must_use]
pub fn grpc_url(network: DydxNetwork) -> &'static str {
    grpc_urls(network)[0]
}

/// Gets the REST API URL (Cosmos LCD) for the specified network.
///
/// Used for querying on-chain state like authenticators.
#[must_use]
pub fn rest_url(network: DydxNetwork) -> &'static str {
    match network {
        DydxNetwork::Testnet => DYDX_TESTNET_REST_URL,
        DydxNetwork::Mainnet => DYDX_REST_URL,
    }
}
