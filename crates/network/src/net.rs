//! Network abstractions for dependency injection and testing.
//!
//! The traits and type aliases let network clients use either real `tokio` networking or simulated
//! `turmoil` networking through dependency injection.
//!
//! ## Conditional compilation
//!
//! The module selects TCP types at compile time:
//! - Default builds: `tokio::net::{TcpStream, TcpListener}`
//! - Builds with `--features turmoil`: `turmoil::net::{TcpStream, TcpListener}`
//!
//! Production code therefore runs against the simulator without source changes, while default
//! builds incur no runtime dispatch or simulation overhead.

use std::{future::Future, io::Result};

use tokio::io::{AsyncRead, AsyncWrite};
// Re-export TCP types based on build configuration
// Production: use tokio networking
#[cfg(not(feature = "turmoil"))]
pub use tokio::net::{TcpListener, TcpStream};
// Testing with turmoil: use turmoil's simulated networking
#[cfg(feature = "turmoil")]
pub use turmoil::net::{TcpListener, TcpStream};

/// Trait for network types that can establish TCP connections.
pub trait TcpConnector: Send + Sync {
    type Stream: AsyncRead + AsyncWrite + Send + Unpin + 'static;

    /// Connects to the specified address.
    fn connect(&self, addr: &str) -> impl Future<Output = Result<Self::Stream>> + Send;
}

/// Production TCP connector.
///
/// Uses `tokio::net::TcpStream` in production, `turmoil::net::TcpStream` in turmoil tests.
#[derive(Default, Clone, Debug)]
pub struct RealTcpConnector;

impl TcpConnector for RealTcpConnector {
    type Stream = TcpStream;

    fn connect(&self, addr: &str) -> impl Future<Output = Result<Self::Stream>> + Send {
        TcpStream::connect(addr.to_string())
    }
}
