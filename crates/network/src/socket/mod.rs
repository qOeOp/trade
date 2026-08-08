//! Raw TCP clients with suffix framing, optional TLS, heartbeats, automatic reconnection,
//! exponential backoff, and connection state management.

pub mod client;
pub mod config;
pub mod types;

pub use client::SocketClient;
pub use config::SocketConfig;
pub use types::{TcpMessageHandler, TcpReader, TcpWriter, WriterCommand};
