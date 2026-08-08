//! Trackers for in-flight submit and cancel commands whose venue order ID is not yet known.

use std::sync::{Arc, Mutex};

use ahash::AHashSet;
use vibe_common::cache::fifo::FifoCacheMap;
use vibe_core::MUTEX_POISONED;
use vibe_model::identifiers::{ClientOrderId, VenueOrderId};

/// Maps an in-flight submit's expected venue order ID to its local client order ID, so the
/// cache-free WS dispatch can resolve a tracked own order before the submit response lands.
#[derive(Clone, Debug, Default)]
pub(crate) struct PendingSubmitTracker {
    venue_to_client: Arc<Mutex<FifoCacheMap<VenueOrderId, ClientOrderId, 10_000>>>,
}

impl PendingSubmitTracker {
    pub(crate) fn insert(&self, venue_order_id: VenueOrderId, client_order_id: ClientOrderId) {
        self.venue_to_client
            .lock()
            .expect(MUTEX_POISONED)
            .insert(venue_order_id, client_order_id);
    }

    pub(crate) fn client_order_id(&self, venue_order_id: &VenueOrderId) -> Option<ClientOrderId> {
        self.venue_to_client
            .lock()
            .expect(MUTEX_POISONED)
            .get(venue_order_id)
            .copied()
    }
}

/// Tracks client order IDs whose cancel was deferred because the venue order ID was not yet
/// known, so the cancel can be issued once the submit response lands.
#[derive(Clone, Debug, Default)]
pub(crate) struct PendingCancelTracker {
    client_order_ids: Arc<Mutex<AHashSet<ClientOrderId>>>,
}

impl PendingCancelTracker {
    pub(crate) fn insert(&self, client_order_id: ClientOrderId) {
        self.client_order_ids
            .lock()
            .expect(MUTEX_POISONED)
            .insert(client_order_id);
    }

    pub(crate) fn remove(&self, client_order_id: &ClientOrderId) -> bool {
        self.client_order_ids
            .lock()
            .expect(MUTEX_POISONED)
            .remove(client_order_id)
    }

    pub(crate) fn contains(&self, client_order_id: &ClientOrderId) -> bool {
        self.client_order_ids
            .lock()
            .expect(MUTEX_POISONED)
            .contains(client_order_id)
    }
}
