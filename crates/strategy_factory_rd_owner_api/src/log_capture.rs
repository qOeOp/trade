//! Reads back what a handler wrote to the log, for the tests that assert a refusal named its cause.
//!
//! A `tracing::warn!` no test reads is a line any later edit can drop without anything going red,
//! which is how the cause behind these 503s came to be discarded in the first place.

use std::io::Write;
use std::sync::{Arc, Mutex};

use tracing_subscriber::fmt::MakeWriter;

/// One shared byte buffer the subscriber writes every event into.
#[derive(Clone, Default)]
pub(crate) struct Sink(Arc<Mutex<Vec<u8>>>);

impl Write for Sink {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().expect("sink lock").extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> MakeWriter<'a> for Sink {
    type Writer = Self;

    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

/// Runs `body` under a subscriber of this test's own and returns everything it wrote.
pub(crate) fn capture<T>(body: impl FnOnce() -> T) -> (T, String) {
    let sink = Sink::default();
    let subscriber = tracing_subscriber::fmt().with_writer(sink.clone()).finish();
    let value = tracing::subscriber::with_default(subscriber, body);
    let written = String::from_utf8(sink.0.lock().expect("sink lock").clone())
        .expect("subscriber output is UTF-8");
    (value, written)
}
