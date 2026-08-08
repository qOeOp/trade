//! Socket types and type aliases.

use std::sync::Arc;

use bytes::Bytes;
use tokio::io::{ReadHalf, WriteHalf};
use tokio_tungstenite::MaybeTlsStream;

use crate::net::TcpStream;

/// The write half of a plain or TLS TCP stream.
pub type TcpWriter = WriteHalf<MaybeTlsStream<TcpStream>>;

/// The read half of a plain or TLS TCP stream.
pub type TcpReader = ReadHalf<MaybeTlsStream<TcpStream>>;

/// A thread‑safe callback for complete suffix‑framed messages.
pub type TcpMessageHandler = Arc<dyn Fn(&[u8]) + Send + Sync>;

/// A command processed by the socket writer task.
#[derive(Debug)]
pub enum WriterCommand<W = TcpWriter> {
    /// Replaces the writer after reconnection and reports whether buffered messages were drained.
    Update(W, tokio::sync::oneshot::Sender<bool>),
    /// Sends data to the server.
    Send(Bytes),
}
