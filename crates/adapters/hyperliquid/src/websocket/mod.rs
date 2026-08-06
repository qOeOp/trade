pub mod client;
pub mod dispatch;
pub mod enums;
pub mod error;
pub mod handler;
pub mod messages;
pub mod parse;
pub mod post;

pub(crate) mod book;
pub(crate) mod trades;

pub use client::HyperliquidWebSocketClient;
pub use enums::HyperliquidWsChannel;
pub use error::HyperliquidWsError;
pub use handler::HandlerCommand;
pub use messages::{ExecutionReport, VibeWsMessage};
