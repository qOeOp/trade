//! Backend-agnostic WebSocket transport trait.

use std::pin::Pin;

use futures_util::{Sink, Stream};

use super::{error::TransportError, message::Message};

/// A backend-agnostic, bidirectional WebSocket transport.
///
/// This is the trait that the higher layers in `vibe-network` (the
/// reconnecting client, the auth tracker, the subscription manager) consume.
/// Each transport backend implements it for its own native stream type.
///
/// The trait combines [`futures_util::Stream`] for incoming messages and
/// [`futures_util::Sink`] for outgoing messages, both keyed off the neutral
/// [`Message`] type and the neutral [`TransportError`].
pub trait WsTransport:
    Stream<Item = Result<Message, TransportError>>
    + Sink<Message, Error = TransportError>
    + Send
    + Unpin
{
}

impl<T> WsTransport for T where
    T: Stream<Item = Result<Message, TransportError>>
        + Sink<Message, Error = TransportError>
        + Send
        + Unpin
{
}

/// Boxed, dynamically-dispatched [`WsTransport`].
///
/// Used by the higher layers to hide the concrete backend stream type. The
/// per-backend `connect` functions return this type so callers don't need to
/// be generic over the backend.
pub type BoxedWsTransport = Pin<Box<dyn WsTransport>>;
