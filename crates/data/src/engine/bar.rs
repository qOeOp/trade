use std::fmt::Debug;

use vibe_common::msgbus::{MStr, Topic, TypedHandler};
use vibe_core::UUID4;
use vibe_model::data::{Bar, BarType, QuoteTick, TradeTick};

/// Identifies a bar aggregator instance.
///
/// Live subscriptions key on `(bar_type.standard(), None)`. Request-scoped
/// aggregators carrying a `request_id` key on `(bar_type.standard(), Some(id))`
/// so they can run alongside a live aggregator on the same bar type.
pub(crate) type BarAggregatorKey = (BarType, Option<UUID4>);

#[inline]
pub(crate) fn bar_aggregator_key(bar_type: BarType, request_id: Option<UUID4>) -> BarAggregatorKey {
    (bar_type.standard(), request_id)
}

/// Typed subscription for bar aggregator handlers.
///
/// Stores the topic and handler for each data type so we can properly
/// unsubscribe from the typed routers.
#[derive(Clone)]
pub enum BarAggregatorSubscription {
    Bar {
        topic: MStr<Topic>,
        handler: TypedHandler<Bar>,
    },
    Trade {
        topic: MStr<Topic>,
        handler: TypedHandler<TradeTick>,
    },
    Quote {
        topic: MStr<Topic>,
        handler: TypedHandler<QuoteTick>,
    },
}

impl Debug for BarAggregatorSubscription {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Bar { topic, handler } => f
                .debug_struct(stringify!(Bar))
                .field("topic", topic)
                .field("handler_id", &handler.id())
                .finish(),
            Self::Trade { topic, handler } => f
                .debug_struct(stringify!(Trade))
                .field("topic", topic)
                .field("handler_id", &handler.id())
                .finish(),
            Self::Quote { topic, handler } => f
                .debug_struct(stringify!(Quote))
                .field("topic", topic)
                .field("handler_id", &handler.id())
                .finish(),
        }
    }
}
