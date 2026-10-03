//! `POST /v1/market-data/backfill-jobs`, `GET /v1/market-data/backfill-jobs/{job_id}` and
//! `GET /v1/market-data/instruments/{instrument}/coverage`: the Binance perpetual backfill job.
//!
//! `backfill` runs synchronously within the one HTTP request: it records `QUEUED`, then
//! `RUNNING`, fetches the member's execution bars and fill bars, builds and commits the member's
//! PIT window custody, and records `SUCCEEDED` with the committed range or `FAILED` with the
//! refusal's name. U1's scale needs no detached worker; nothing here holds job state the MCP
//! server would otherwise have to.
//!
//! The custody basis's `market_semantics_identity` is the admitted kline Source Binding's own
//! compatibility identity, not a separate fact: re-admitting the same binding (`admission.admit`)
//! rejoins it and hands back the same terminal, from which this module reads
//! `.market_semantics_identity()` and `.locator()`. The basis's `universe_selection` is a
//! `FixedMember` selection scoped to the one member being backfilled, evaluated at the fixed
//! far-future instant [`BINANCE_PERPETUAL_BACKFILL_UNIVERSE_SELECTION_CUT_V1`]: the Instrument
//! Master fact `admit_instrument` admits carries the Owner's real wall-clock reading at admission
//! time, so the universe-selection cut must be fixed far enough in the future that no real
//! admission can ever postdate it, not a fixed instant in the past that every real admission
//! already does.

use std::sync::Arc;

use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::json;
use vibe_binance::{
    common::enums::BinanceKlineInterval,
    futures::http::client::BinanceFuturesHttpClient,
    perpetual_admission_v1::{
        BINANCE_PERPETUAL_U1_MEMBERS_V1, BinancePerpetualDatasetV1,
        binance_perpetual_canonical_identity_v1, binance_perpetual_correction_frontier_digest_v1,
        binance_perpetual_eligible_frontier_v1,
        binance_perpetual_eligible_set_admission_request_v1,
        binance_perpetual_market_semantics_value_v1, binance_perpetual_membership_lineage_anchor_v1,
        binance_perpetual_source_proposal,
    },
    vision_backfill_custody_v1::{
        BackfillCustodyBasisV1, BackfillTimeframeBarsV1, custody_request_v1,
    },
    vision_backfill_v1::VisionBackfillFetcherV1,
};
use vibe_data::owner::{
    backfill_job_v1::{
        BackfillCoverageRangeV1, BackfillJobErrorV1, BackfillJobRequestV1, BackfillJobV1,
    },
    bar_schedule::SUPPORTED_EXECUTION_TIMEFRAMES_V1,
    pit_window_custody_v1::PitWindowCustodyCommitV1,
    research_instrument_scope_v1::ResearchInstrumentScopeV1,
    source_binding::{BindingDigest, UntrustedSourceBindingLocator},
    source_binding_admission_v1::{
        ProviderReachabilityEvidenceV1, ProviderRightsEvidenceV1,
        SourceBindingAdmissionDispositionV1, SourceBindingAdmissionRequestV1,
        SourceBindingAdmissionV1,
    },
    universe_selection::{
        UntrustedUniverseSelectionLocatorV1, UntrustedUniverseSelectionRequestV1,
    },
    universe_selection_admission_v1::UniverseSelectionAdmissionV1,
};

use super::authorized;

#[derive(Clone)]
pub(super) struct BinanceBackfillJobApiState {
    pub(super) jobs: Option<Arc<dyn BackfillJobV1>>,
    pub(super) admission: Option<Arc<dyn SourceBindingAdmissionV1>>,
    pub(super) universe: Option<Arc<dyn UniverseSelectionAdmissionV1>>,
    pub(super) custody_commit: Option<Arc<dyn PitWindowCustodyCommitV1>>,
    pub(super) fetcher: Option<Arc<VisionBackfillFetcherV1>>,
    pub(super) token_digest: [u8; 32],
}

pub(super) fn router(state: BinanceBackfillJobApiState) -> Router {
    Router::new()
        .route("/v1/market-data/backfill-jobs", post(start_backfill))
        .route(
            "/v1/market-data/backfill-jobs/{job_id}",
            get(backfill_job_status),
        )
        .route(
            "/v1/market-data/instruments/{instrument}/coverage",
            get(instrument_coverage),
        )
        .with_state(state)
}

fn rejection(status: StatusCode, code: &str) -> Response {
    let mut response = (status, Json(json!({ "error": code }))).into_response();
    response.headers_mut().insert(
        "x-rejection-code",
        code.parse().expect("a code is a valid header value"),
    );
    response
}

fn job_id_from_hex(job_id: &str) -> Option<BindingDigest> {
    if job_id.len() != 64 {
        return None;
    }
    let mut bytes = [0u8; 32];

    for (index, chunk) in job_id.as_bytes().chunks(2).enumerate() {
        let hex = std::str::from_utf8(chunk).ok()?;
        bytes[index] = u8::from_str_radix(hex, 16).ok()?;
    }
    Some(BindingDigest::from_untrusted_bytes(bytes))
}

fn execution_interval(execution_timeframe: &str) -> Option<BinanceKlineInterval> {
    match execution_timeframe {
        "1h" => Some(BinanceKlineInterval::Hour1),
        "4h" => Some(BinanceKlineInterval::Hour4),
        "1d" => Some(BinanceKlineInterval::Day1),
        "1w" => Some(BinanceKlineInterval::Week1),
        _ => None,
    }
}

/// The canonical row-timeframe label the kline binding's own `bar_timeframes` declares
/// (`perpetual_admission_v1.rs::BinancePerpetualDatasetV1::bar_timeframes`'s doc), for the public
/// `execution_timeframe` a `backfill` call takes. `None` for `1w`: a week additionally needs an
/// anchor naming which day it begins on, which nobody has decided, so the binding declares none
/// and this job cannot name one either without inventing that decision.
fn canonical_row_timeframe(execution_timeframe: &str) -> Option<&'static str> {
    match execution_timeframe {
        "1h" => Some("1H"),
        "4h" => Some("4H"),
        "1d" => Some("24H"),
        _ => None,
    }
}

/// The kline binding's own fixed fill-bar row timeframe: one minute, canonically `1M`.
const BINANCE_PERPETUAL_FILL_ROW_TIMEFRAME_V1: &str = "1M";

/// The venue's own raw symbol a canonical identity like `BTCUSDT-PERP.BINANCE` names, among
/// [`BINANCE_PERPETUAL_U1_MEMBERS_V1`].
fn raw_symbol_for_instrument(instrument: &str) -> Option<&'static str> {
    BINANCE_PERPETUAL_U1_MEMBERS_V1
        .iter()
        .copied()
        .find(|raw_symbol| binance_perpetual_canonical_identity_v1(raw_symbol) == instrument)
}

async fn start_backfill(
    State(state): State<BinanceBackfillJobApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE");
    }
    let (Some(jobs), Some(admission), Some(universe), Some(custody_commit), Some(fetcher)) = (
        state.jobs,
        state.admission,
        state.universe,
        state.custody_commit,
        state.fetcher,
    ) else {
        return rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_BACKFILL_JOB_UNAVAILABLE",
        );
    };
    let request: BackfillJobRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => return rejection(StatusCode::BAD_REQUEST, "MALFORMED_TYPED_REQUEST"),
    };
    let Some(raw_symbol) = raw_symbol_for_instrument(&request.instrument) else {
        return rejection(StatusCode::BAD_REQUEST, "INSTRUMENT_UNKNOWN");
    };

    if !SUPPORTED_EXECUTION_TIMEFRAMES_V1.contains(&request.execution_timeframe.as_str()) {
        return rejection(StatusCode::BAD_REQUEST, "TIMEFRAME_UNSUPPORTED");
    }
    let Some(interval) = execution_interval(&request.execution_timeframe) else {
        return rejection(StatusCode::BAD_REQUEST, "TIMEFRAME_UNSUPPORTED");
    };

    let job_id = match jobs.queue(request.clone()).await {
        Ok(job_id) => job_id,
        Err(_) => return rejection(StatusCode::BAD_REQUEST, "RANGE_INVALID"),
    };

    if let Err(e) = jobs.record_running(job_id).await {
        return rejection_for_job_error(e);
    }

    match run_backfill_v1(
        &admission,
        &universe,
        &custody_commit,
        &fetcher,
        raw_symbol,
        interval,
        &request,
    )
    .await
    {
        Ok(custody_receipt_identity) => {
            if let Err(e) = jobs
                .record_succeeded(
                    job_id,
                    custody_receipt_identity,
                    request.window_start_ns,
                    request.window_end_ns_exclusive,
                )
                .await
            {
                return rejection_for_job_error(e);
            }
        }
        Err(refusal_name) => {
            if let Err(e) = jobs.record_failed(job_id, refusal_name).await {
                return rejection_for_job_error(e);
            }
        }
    }

    (StatusCode::OK, Json(json!({ "job_id": hex(&job_id) }))).into_response()
}

async fn backfill_job_status(
    State(state): State<BinanceBackfillJobApiState>,
    headers: HeaderMap,
    Path(job_id): Path<String>,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE");
    }
    let Some(jobs) = state.jobs else {
        return rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_BACKFILL_JOB_UNAVAILABLE",
        );
    };
    let Some(job_id) = job_id_from_hex(&job_id) else {
        return rejection(StatusCode::BAD_REQUEST, "JOB_UNKNOWN");
    };

    match jobs.status(job_id).await {
        Ok(record) => (StatusCode::OK, Json(record)).into_response(),
        Err(e) => rejection_for_job_error(e),
    }
}

async fn instrument_coverage(
    State(state): State<BinanceBackfillJobApiState>,
    headers: HeaderMap,
    Path(instrument): Path<String>,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE");
    }
    let Some(jobs) = state.jobs else {
        return rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "MARKET_DATA_BACKFILL_JOB_UNAVAILABLE",
        );
    };

    if raw_symbol_for_instrument(&instrument).is_none() {
        return rejection(StatusCode::NOT_FOUND, "INSTRUMENT_UNKNOWN");
    }

    match jobs.coverage(&instrument).await {
        Ok(ranges) => (StatusCode::OK, Json(coverage_body(ranges))).into_response(),
        Err(e) => rejection_for_job_error(e),
    }
}

fn coverage_body(ranges: Vec<(String, Vec<BackfillCoverageRangeV1>)>) -> serde_json::Value {
    json!({
        "coverage": ranges
            .into_iter()
            .map(|(execution_timeframe, ranges)| {
                json!({
                    "execution_timeframe": execution_timeframe,
                    "ranges": ranges,
                })
            })
            .collect::<Vec<_>>(),
    })
}

fn rejection_for_job_error(error: BackfillJobErrorV1) -> Response {
    let code = match error {
        BackfillJobErrorV1::InvalidRequest => "RANGE_INVALID",
        BackfillJobErrorV1::JobUnknown => "JOB_UNKNOWN",
        BackfillJobErrorV1::InvalidTransition => "JOB_TRANSITION_INVALID",
        BackfillJobErrorV1::StoreUnavailable => "MARKET_DATA_OWNER_UNAVAILABLE",
    };
    let status = if error == BackfillJobErrorV1::JobUnknown {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::BAD_REQUEST
    };
    rejection(status, code)
}

fn hex(digest: &BindingDigest) -> String {
    digest
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Admits (or rejoins) the kline Source Binding, to read back its locator and compatibility
/// identity, exactly as the symbol's own admission (`crate::market_data_pit`) does.
async fn kline_binding_locator(
    admission: &Arc<dyn SourceBindingAdmissionV1>,
) -> Result<(UntrustedSourceBindingLocator, BindingDigest), String> {
    let proposal = binance_perpetual_source_proposal(BinancePerpetualDatasetV1::DailyKlines);
    let terminal = admission
        .admit(SourceBindingAdmissionRequestV1 {
            proposal,
            rights: ProviderRightsEvidenceV1::Granted,
            reachability: ProviderReachabilityEvidenceV1::Reachable,
        })
        .await
        .map_err(|e| format!("{e:?}"))?;
    if terminal.disposition() != SourceBindingAdmissionDispositionV1::Admitted {
        return Err("BindingNotAdmitted".to_owned());
    }
    Ok((
        terminal.locator().clone(),
        terminal.market_semantics_identity(),
    ))
}

/// The fixed instant this route's universe-selection check reads the Instrument Master fact as
/// of: 2100-01-01T00:00:00Z, the same far-future bound already used for economic-terms validity
/// (`market_data_pit.rs`'s `admit_instrument_economic_terms`). The Instrument Master fact an
/// `admit_instrument` call admits states `effective_from: 1` but its `clock.decision_cut` and
/// `provider_available`/`retrieval`/`observed_at` fields are the Owner's real wall-clock reading
/// at admission time - always strictly after this route shipped, never after 2100 - so this cut
/// must be a fixed instant no real admission can ever postdate, not one so far in the past
/// (2023, this route's earlier choice) that every real admission already postdates it and the
/// fact can never resolve.
const BINANCE_PERPETUAL_BACKFILL_UNIVERSE_SELECTION_CUT_V1: u64 = 4_102_444_800_000_000_000;

/// Evaluates (or rejoins) a `FixedMember` universe selection scoped to the one member this job
/// backfills, at the fixed far-future instant above.
///
/// Admits the U1 set's historical membership inline, every call, before evaluating: the
/// admission is keyed by [`binance_perpetual_membership_lineage_anchor_v1`], a fixed value rather
/// than any real Source Binding's identity, so every call submits byte-identical content and
/// genuinely rejoins rather than conflicting (`UniverseSelectionAdmissionV1::admit_membership`'s
/// own "a frontier is admitted whole or not at all" is this route's only attempt at it - there is
/// no separate one-time bootstrap step).
///
/// `ResearchInstrumentScopeV1` caps a scope at
/// [`RESEARCH_INSTRUMENT_SCOPE_MAX_MEMBERS_V1`](vibe_data::owner::research_instrument_scope_v1::RESEARCH_INSTRUMENT_SCOPE_MAX_MEMBERS_V1)
/// members (2), below the U1 set's 3, so this scope names only the requested member rather than
/// the whole eligible set: `backfill` names exactly one instrument per call, and "is this member
/// eligible" never needed the other two in scope to answer.
async fn eligible_set_universe_selection(
    universe: &Arc<dyn UniverseSelectionAdmissionV1>,
    raw_symbol: &str,
) -> Result<UntrustedUniverseSelectionLocatorV1, String> {
    universe
        .admit_membership(binance_perpetual_eligible_set_admission_request_v1(
            BINANCE_PERPETUAL_BACKFILL_UNIVERSE_SELECTION_CUT_V1,
        ))
        .await
        .map_err(|e| format!("{e:?}"))?;
    let identities = vec![binance_perpetual_canonical_identity_v1(raw_symbol)];
    let scope =
        ResearchInstrumentScopeV1::from_identities(identities).map_err(|e| format!("{e:?}"))?;
    let frontier = binance_perpetual_eligible_frontier_v1(BINANCE_PERPETUAL_U1_MEMBERS_V1);
    let cut = BINANCE_PERPETUAL_BACKFILL_UNIVERSE_SELECTION_CUT_V1;
    let correction_frontier_digest = binance_perpetual_correction_frontier_digest_v1();
    let request_identity = domain_digest(
        "backfill-job.universe-selection.request-identity",
        &[
            frontier.as_bytes().as_slice(),
            scope.identity().as_bytes().as_slice(),
        ],
    );
    let stable_correlation = domain_digest(
        "backfill-job.universe-selection.stable-correlation",
        &[
            frontier.as_bytes().as_slice(),
            scope.identity().as_bytes().as_slice(),
        ],
    );
    let request = UntrustedUniverseSelectionRequestV1::new(
        request_identity,
        "market-data-backfill",
        scope.identity(),
        scope.fixed_member_selection_rule_bytes(),
        frontier,
        i128::from(cut),
        i128::from(cut),
        cut,
        binance_perpetual_membership_lineage_anchor_v1(),
        correction_frontier_digest,
        stable_correlation,
    );
    let terminal = universe
        .evaluate(request)
        .await
        .map_err(|e| format!("{e:?}"))?;
    Ok(UntrustedUniverseSelectionLocatorV1::from_untrusted(
        terminal.request_identity(),
        terminal.request_meaning_digest(),
    ))
}

fn domain_digest(meaning: &str, parts: &[&[u8]]) -> BindingDigest {
    let digest = {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(meaning.as_bytes());
        for part in parts {
            hasher.update((part.len() as u64).to_be_bytes());
            hasher.update(part);
        }
        hasher.finalize()
    };
    let bytes: [u8; 32] = digest.into();
    BindingDigest::from_untrusted_bytes(bytes)
}

/// Fetches, builds and commits the member's custody over the request's window, returning its
/// committed identity or a named refusal.
async fn run_backfill_v1(
    admission: &Arc<dyn SourceBindingAdmissionV1>,
    universe: &Arc<dyn UniverseSelectionAdmissionV1>,
    custody_commit: &Arc<dyn PitWindowCustodyCommitV1>,
    fetcher: &Arc<VisionBackfillFetcherV1>,
    raw_symbol: &str,
    interval: BinanceKlineInterval,
    request: &BackfillJobRequestV1,
) -> Result<BindingDigest, String> {
    let (kline_source_binding, market_semantics_identity) =
        kline_binding_locator(admission).await?;
    let universe_selection = eligible_set_universe_selection(universe, raw_symbol).await?;

    let execution_bars = fetcher
        .execution_window(
            raw_symbol,
            interval,
            request.window_start_ns,
            request.window_end_ns_exclusive,
        )
        .await
        .map_err(|e| format!("{e:?}"))?;
    let availability = binance_perpetual_source_proposal(BinancePerpetualDatasetV1::DailyKlines)
        .availability_rule
        .ok_or_else(|| "NoAvailabilityRule".to_owned())?;
    let window_end_ms = i64::try_from(request.window_end_ns_exclusive / 1_000_000)
        .map_err(|_| "WindowOutOfRange".to_owned())?;
    let fill_bars = fetcher
        .fill_bars(raw_symbol, &execution_bars, &availability, window_end_ms)
        .await
        .map_err(|e| format!("{e:?}"))?;

    let row_timeframe = canonical_row_timeframe(&request.execution_timeframe)
        .ok_or_else(|| "WeekAnchorUndefined".to_owned())?;
    let basis = BackfillCustodyBasisV1 {
        source_binding: kline_source_binding,
        market_semantics_identity,
        market_semantics_value: binance_perpetual_market_semantics_value_v1(),
        universe_selection,
        member: binance_perpetual_canonical_identity_v1(raw_symbol),
        window_start_ns: request.window_start_ns,
        window_end_ns_exclusive: request.window_end_ns_exclusive,
        execution_timeframe: row_timeframe.to_owned(),
        fill_timeframe: BINANCE_PERPETUAL_FILL_ROW_TIMEFRAME_V1.to_owned(),
    };
    let inputs = [BackfillTimeframeBarsV1 {
        label: row_timeframe.to_owned(),
        bars: execution_bars,
    }];
    let custody_request =
        custody_request_v1(basis, &inputs, &fill_bars).map_err(|e| format!("{e:?}"))?;

    custody_commit
        .commit_pit_window_custody_v1(custody_request)
        .await
        .map(|receipt| receipt.custody_identity())
        .map_err(|e| format!("{e:?}"))
}

/// Builds the fetcher the backfill job runs against, from the admission's own public endpoint
/// client and a shard directory named by `BINANCE_VISION_SHARD_DIR_V1`.
///
/// # Errors
///
/// Returns an error if the environment variable is unset or the fetcher cannot be built (a
/// credentialed endpoint client, for instance).
pub(super) fn vision_backfill_fetcher_v1(
    endpoint: &BinanceFuturesHttpClient,
) -> anyhow::Result<VisionBackfillFetcherV1> {
    let shard_dir = std::env::var("BINANCE_VISION_SHARD_DIR_V1")
        .map_err(|_| anyhow::anyhow!("BINANCE_VISION_SHARD_DIR_V1 is not set"))?;
    VisionBackfillFetcherV1::new(endpoint.clone(), shard_dir)
        .map_err(|e| anyhow::anyhow!("the backfill fetcher is unusable: {e}"))
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::{execution_interval, hex, job_id_from_hex, raw_symbol_for_instrument};
    use vibe_data::owner::source_binding::BindingDigest;

    #[rstest]
    fn job_id_hex_round_trips() {
        let digest = BindingDigest::from_untrusted_bytes([7; 32]);
        let encoded = hex(&digest);
        assert_eq!(encoded.len(), 64);
        assert_eq!(job_id_from_hex(&encoded), Some(digest));
    }

    #[rstest]
    fn job_id_from_hex_refuses_the_wrong_length() {
        assert_eq!(job_id_from_hex("ab"), None);
        assert_eq!(job_id_from_hex(&"a".repeat(65)), None);
    }

    #[rstest]
    fn job_id_from_hex_refuses_non_hex_characters() {
        assert_eq!(job_id_from_hex(&"g".repeat(64)), None);
    }

    #[rstest]
    fn execution_interval_covers_exactly_the_whitelist() {
        assert!(execution_interval("1h").is_some());
        assert!(execution_interval("4h").is_some());
        assert!(execution_interval("1d").is_some());
        assert!(execution_interval("1w").is_some());
        assert!(execution_interval("15m").is_none());
        assert!(execution_interval("1m").is_none());
        assert!(execution_interval("bogus").is_none());
    }

    #[rstest]
    fn raw_symbol_resolves_every_u1_member_and_rejects_others() {
        assert_eq!(
            raw_symbol_for_instrument("BTCUSDT-PERP.BINANCE"),
            Some("BTCUSDT")
        );
        assert_eq!(
            raw_symbol_for_instrument("ETHUSDT-PERP.BINANCE"),
            Some("ETHUSDT")
        );
        assert_eq!(
            raw_symbol_for_instrument("SOLUSDT-PERP.BINANCE"),
            Some("SOLUSDT")
        );
        assert_eq!(raw_symbol_for_instrument("LINKUSDT-PERP.BINANCE"), None);
    }
}
