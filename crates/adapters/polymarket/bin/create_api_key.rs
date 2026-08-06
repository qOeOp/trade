//! Creates or derives Polymarket CLOB API credentials using L1 (EIP-712) authentication.
//!
//! Reads the private key from the `POLYMARKET_PK` environment variable,
//! signs an EIP-712 ClobAuth message, and calls the CLOB auth endpoints
//! to create or derive API credentials.
//!
//! # Usage
//!
//! ```sh
//! POLYMARKET_PK=0x... cargo run -p vibe-polymarket --bin polymarket-create-api-key
//! ```

use vibe_polymarket::{common::credential::EvmPrivateKey, http::auth::create_or_derive_api_key};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    let pk_str =
        std::env::var("POLYMARKET_PK").expect("POLYMARKET_PK environment variable must be set");
    let private_key = EvmPrivateKey::new(&pk_str)?;

    println!("Creating or deriving API credentials...");
    let creds = create_or_derive_api_key(&private_key, 0, None).await?;

    println!("API Key:    {}", creds.api_key);
    println!("Secret:     {}", creds.secret);
    println!("Passphrase: {}", creds.passphrase);

    Ok(())
}
