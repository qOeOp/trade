use std::{cell::RefCell, collections::VecDeque, rc::Rc};

use vibe_common::messages::data::{SubscribeCommand, UnsubscribeCommand};
use vibe_model::identifiers::{InstrumentId, OptionSeriesId};

/// Deferred subscribe/unsubscribe command.
///
/// Components that lack direct `DataClientAdapter` access (handlers, timers)
/// push commands here; the `DataEngine` drains on each data tick.
#[derive(Debug, Clone)]
pub(crate) enum DeferredCommand {
    Subscribe(SubscribeCommand),
    Unsubscribe(UnsubscribeCommand),
    ExpireInstrument(InstrumentId),
    ExpireSeries(OptionSeriesId),
}

/// Shared queue for deferred subscribe/unsubscribe commands.
pub(crate) type DeferredCommandQueue = Rc<RefCell<VecDeque<DeferredCommand>>>;
