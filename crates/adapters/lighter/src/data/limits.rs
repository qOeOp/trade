use std::num::NonZeroUsize;

// Maximum `limit` accepted by `GET /api/v1/orderBookOrders`
pub(super) const LIGHTER_BOOK_ORDERS_MAX_LIMIT: u16 = 250;
const DEFAULT_BOOK_SNAPSHOT_LIMIT: u16 = LIGHTER_BOOK_ORDERS_MAX_LIMIT;

// Maximum `limit` accepted by `GET /api/v1/recentTrades`
pub(super) const LIGHTER_RECENT_TRADES_MAX_LIMIT: u16 = 100;
const DEFAULT_RECENT_TRADES_LIMIT: u16 = LIGHTER_RECENT_TRADES_MAX_LIMIT;

pub(super) fn clamp_book_snapshot_limit(depth: Option<NonZeroUsize>) -> u16 {
    depth
        .map_or(DEFAULT_BOOK_SNAPSHOT_LIMIT, |n| {
            u16::try_from(n.get()).unwrap_or(u16::MAX)
        })
        .min(LIGHTER_BOOK_ORDERS_MAX_LIMIT)
}

pub(super) fn clamp_recent_trades_limit(limit: Option<NonZeroUsize>) -> u16 {
    limit
        .map_or(DEFAULT_RECENT_TRADES_LIMIT, |n| {
            u16::try_from(n.get()).unwrap_or(u16::MAX)
        })
        .min(LIGHTER_RECENT_TRADES_MAX_LIMIT)
}
