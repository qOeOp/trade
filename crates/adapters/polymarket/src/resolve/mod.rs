//! Polymarket condition resolution tracking and reconciliation.

mod apply;
mod parsing;
mod summary;
mod watchlist;

#[allow(unused_imports)]
pub(crate) use self::{
    apply::{
        ResolveApplyBatchStats, ResolveBatchErrorMode, ResolveContext, apply_condition_resolution,
        fetch_and_apply_resolutions_by_condition_ids, merge_resolve_watch_entry,
    },
    parsing::{
        StrictResolvedMarket, build_resolved_market_from_clob_market, build_strict_resolved_market,
        parse_condition_ids_from_request_params, request_params_has_explicit_condition_selector,
    },
    summary::{
        PolymarketResolveRequestSummaryData, RESOLVE_REQUEST_TYPE_NAME, ResolveRequestSummary,
    },
    watchlist::{
        ResolveWatchEntry, ResolveWatchSelection, ResolveWatchSelectionMode, TrackedInstrument,
        collect_resolve_watch_selection, instrument_market_context, pause_resolve_watch_entries,
        update_resolve_watchlist_from_position_event, upsert_resolve_watch_entry_from_instrument,
    },
};
