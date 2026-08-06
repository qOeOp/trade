use super::{
    consts::{REST_URL_MAINNET, REST_URL_TESTNET, WS_URL_MAINNET, WS_URL_TESTNET},
    enums::DeriveEnvironment,
};

#[must_use]
pub fn rest_url(environment: DeriveEnvironment) -> &'static str {
    match environment {
        DeriveEnvironment::Mainnet => REST_URL_MAINNET,
        DeriveEnvironment::Testnet => REST_URL_TESTNET,
    }
}

#[must_use]
pub fn ws_url(environment: DeriveEnvironment) -> &'static str {
    match environment {
        DeriveEnvironment::Mainnet => WS_URL_MAINNET,
        DeriveEnvironment::Testnet => WS_URL_TESTNET,
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn test_rest_url_routes_by_environment() {
        assert_eq!(rest_url(DeriveEnvironment::Mainnet), REST_URL_MAINNET);
        assert_eq!(rest_url(DeriveEnvironment::Testnet), REST_URL_TESTNET);
    }

    #[rstest]
    fn test_ws_url_routes_by_environment() {
        assert_eq!(ws_url(DeriveEnvironment::Mainnet), WS_URL_MAINNET);
        assert_eq!(ws_url(DeriveEnvironment::Testnet), WS_URL_TESTNET);
    }
}
