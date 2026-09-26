//! One frozen PIT Market Snapshot Request answered from live venue data, without a credential.
//!
//! This is the same production composition root the Databento leg drives, on a venue whose market
//! data needs no key: Operations admits a Source Binding, admits the instrument's master fact,
//! admits the historical membership behind one eligible frontier and has the Owner evaluate a
//! selection rule; R&D then reads the Owner's decision cut, freezes a request against it, and
//! receives a terminal. It then states the binding's Market Semantics, which is what a Strategy
//! Input declaration re-resolves. Nothing here supplies an observation, an evidence field, a
//! digest, a clock or a disposition.
//!
//! Its value is that it costs nothing and needs no secret, so the whole production path can be
//! exercised against a real store and a real venue whenever the disposable PostgreSQL harness is
//! available. It is `#[ignore]` because it needs that harness and a reachable venue, and runs
//! through `crates/adapters/binance/tests/run_market_data_end_to_end.bash`.

use std::{collections::BTreeMap, sync::Arc};

use vibe_binance::{
    common::enums::{BinanceEnvironment, BinanceProductType},
    futures::http::client::BinanceFuturesHttpClient,
    futures_pit_observation_source_v1::BinanceFuturesBarObservationSourceV1,
    pit_observation_source_v1::BinanceSpotBarObservationSourceV1,
    spot::http::client::BinanceSpotHttpClient,
};
use vibe_core::time::get_atomic_clock_realtime;
use vibe_data::owner::{
    frozen_observation_window_v1::frozen_window_coordinate_correlation_v1,
    instrument_master_admission_v1::{
        InstrumentDecimalSubmissionV1, InstrumentMasterFactSubmissionV1,
        InstrumentVenueSourceMappingSubmissionV1, instrument_master_admission_from_environment_v1,
    },
    market_semantics_admission_v1::{
        MarketSemanticsFactSubmissionV1, MarketSemanticsValueSubmissionV1,
        market_semantics_admission_from_environment_v1,
    },
    pit_market_snapshot_intake_v1::{
        MarketDataDecisionCutV1, PitMarketSnapshotDispositionV1, PitMarketSnapshotIntakeV1,
        pit_market_snapshot_intake_from_environment_v1,
    },
    pit_observation_source_v1::{PitObservationScopeV1, PitObservationSourceV1},
    pit_snapshot::{
        PitSnapshotSubmissionV1, UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
        UntrustedPitSnapshotTimeEvidence, UntrustedProviderAvailableTime, UntrustedRetrievalTime,
        UntrustedSnapshotDecisionCut,
    },
    source_binding::{
        BindingDigest, UntrustedAdapterBinding, UntrustedCompleteFrontier,
        UntrustedCredentialAudienceClaim, UntrustedCredentialCapabilityClaim,
        UntrustedLicensePolicy, UntrustedMarketDataAsOf, UntrustedMarketSemantics,
        UntrustedOpaqueCredentialHandle, UntrustedSourceBindingLocator,
        UntrustedSourceBindingProposal, UntrustedTrustPolicy, seal_binding_claim_v1,
    },
    source_binding_admission_v1::{
        ProviderReachabilityEvidenceV1, ProviderRightsEvidenceV1,
        SourceBindingAdmissionDispositionV1, SourceBindingAdmissionRequestV1,
        source_binding_admission_from_environment_v1,
    },
    universe_selection::{
        UntrustedUniverseSelectionLocatorV1, UntrustedUniverseSelectionRequestV1,
    },
    universe_selection_admission_v1::{
        HistoricalMembershipAdmissionRequestV1, HistoricalMembershipSubmissionV1,
        UniverseSelectionTerminalV1, universe_selection_admission_from_environment_v1,
    },
};

/// One venue product this leg admits and answers for, whole.
///
/// The seven steps below are the Owner's shape and do not vary by product. What varies is what
/// Operations would have to say to describe the thing being admitted, and the surface the Data
/// Client reads it from. Holding those differences in one value keeps the proof honest about how
/// small they are: a perpetual is not a second pipeline, it is a different set of facts through
/// the same one.
struct Product {
    /// The Owner's canonical identity for the member.
    member: &'static str,
    /// The symbol the venue knows it by. Both products spell it `BTCUSDT`, on different surfaces.
    venue_symbol: &'static str,
    /// The venue's interval word.
    interval: &'static str,
    /// The Owner timeframe that interval denotes. Asserted, not derived, so a change to the label
    /// table cannot quietly re-bind an admitted member to a different clock.
    timeframe: &'static str,
    /// The length of one bar, which is how far back the frozen coordinate has to reach.
    bar_ns: u64,
    /// The word for this product in the Owner's closed instrument-class vocabulary.
    instrument_class: &'static str,
    /// The venue surface, as the instrument's venue-source mapping names it.
    source_identity: &'static str,
    /// The host the Data Client calls, and therefore the host its binding records. The two are
    /// one value on purpose: a binding that recorded one host while the client called another is
    /// the defect this proof carried until the spot pair was fixed.
    endpoint: &'static str,
    /// The variable that replaces `endpoint` where the default host cannot be reached.
    ///
    /// This exists because a network, not a venue, decides reachability. A GitHub-hosted runner is
    /// a restricted location for this venue: measured there, `api.binance.com`, `fapi.binance.com`
    /// and `dapi.binance.com` all answer HTTP 451, "Service unavailable from a restricted
    /// location". Overriding the host is how the proof runs there; it is not a statement about
    /// which host a deployment should name, which is why the default stays the venue's own.
    endpoint_override_var: &'static str,
    /// The adapter's dataset mapping, and the frontier stream behind it.
    dataset_mapping: &'static str,
    stream_identity: &'static str,
    /// The normalization word for this surface's quotes.
    normalization: &'static str,
    /// The instrument lifecycle rules this surface follows.
    lifecycle_rules: &'static str,
    /// The venue's own price tick and quantity step, as its exchange information states them.
    price_increment: (i128, u8),
    quantity_increment: (i128, u8),
    /// The venue's own currencies for this contract. They were the same for the first two
    /// products, which is a coincidence of both being quoted in USDT rather than a property of
    /// the surface - so they are stated per product.
    base_currency: &'static str,
    quote_currency: &'static str,
    settlement_currency: &'static str,
    /// A perpetual is margined; a spot pair is not.
    margin_currency: Option<&'static str>,
    /// What the binding says a price on this surface means. Two bindings that agree on every one
    /// of these derive one Market Semantics compatibility scope, and the Owner states a scope's
    /// semantics once - so a product quoted in a different currency is a different scope, and a
    /// product that merely reads a different interval is not.
    price_meaning: &'static str,
    /// Distinguishes every digest this product mints, so two products admitted against one store
    /// cannot collide on a frontier or a correlation identity.
    ///
    /// It is a tag placed in one byte, not an offset added to all of them. An offset does not
    /// scale: the fixture bytes below span `0x11..=0x55`, so bands must be 86 apart, and three
    /// bands of 86 do not fit in a `u8` - the third would both overlap the second and overflow.
    digest_tag: u8,
    /// Binds the real Data Client for this surface. No credential is supplied on either.
    ///
    /// It takes the product rather than closing over one, because a factory that named a product
    /// directly would hand a second product on the same surface the first one's symbols and
    /// interval - silently, and with every assertion below still passing.
    observations: fn(&'static Self, String) -> Arc<dyn PitObservationSourceV1>,
}

/// The spot pair, read from the venue's public-data mirror.
static SPOT: Product = Product {
    member: "BTCUSDT.BINANCE",
    venue_symbol: "BTCUSDT",
    interval: "1m",
    timeframe: "1M",
    bar_ns: 60_000_000_000,
    instrument_class: "CRYPTO_SPOT",
    source_identity: "BINANCE_SPOT",
    endpoint: "https://data-api.binance.vision",
    endpoint_override_var: "MARKET_DATA_E2E_SPOT_ENDPOINT",
    dataset_mapping: "spot/klines/1m",
    stream_identity: "binance/spot-klines",
    normalization: "binance/spot-kline",
    lifecycle_rules: "binance/spot",
    price_increment: (1, 2),
    quantity_increment: (1, 5),
    base_currency: "BTC",
    quote_currency: "USDT",
    settlement_currency: "USDT",
    margin_currency: None,
    price_meaning: "decimal-string/usdt",
    digest_tag: 0x01,
    observations: spot_observations,
};

/// The USD-M linear perpetual, read from the venue's futures host.
///
/// Its tick and step are the venue's own: `PRICE_FILTER.tickSize` is `0.10` and `LOT_SIZE.stepSize`
/// is `0.001` on `fapi.binance.com/fapi/v1/exchangeInfo`, which is not what the spot pair states.
/// Its `deliveryDate` is a far-future sentinel rather than an expiry, because a perpetual has none;
/// the Owner's instrument fact has no expiry field to record it wrongly in, which is the reason
/// this class needs no terms the spot pair lacks.
static PERPETUAL: Product = Product {
    member: "BTCUSDT-PERP.BINANCE",
    venue_symbol: "BTCUSDT",
    interval: "4h",
    timeframe: "4H",
    bar_ns: 14_400_000_000_000,
    instrument_class: "CRYPTO_PERPETUAL",
    source_identity: "BINANCE_USDM",
    endpoint: "https://fapi.binance.com",
    endpoint_override_var: "MARKET_DATA_E2E_USDM_ENDPOINT",
    dataset_mapping: "usdm/klines/4h",
    stream_identity: "binance/usdm-klines",
    normalization: "binance/usdm-kline",
    lifecycle_rules: "binance/usdm-perpetual",
    price_increment: (1, 1),
    quantity_increment: (1, 3),
    base_currency: "BTC",
    quote_currency: "USDT",
    settlement_currency: "USDT",
    margin_currency: Some("USDT"),
    price_meaning: "decimal-string/usdt",
    digest_tag: 0x02,
    observations: futures_observations,
};

/// The host this run will actually call: the product's own, unless the environment names another.
///
/// The spot pair's default is the venue's public-data mirror rather than its trading API, because
/// the mirror is what the binding has always proposed and the trading API is what the client was
/// wrongly defaulting to. The perpetual's default is the venue's canonical USD-M host.
fn endpoint(product: &Product) -> String {
    std::env::var(product.endpoint_override_var).unwrap_or_else(|_| product.endpoint.to_string())
}

/// The same venue's daily perpetual bar, which is where the label matters.
///
/// A second member rather than a second interval on the first: the instrument fact is keyed by
/// canonical identity, and both proofs run against one store.
///
/// `1d` is the reason this product exists. On a venue that never closes it is twenty-four hours,
/// and `1D` is taken - the Owner's equity fixtures bind that label to one named exchange session
/// day. Until recently this client produced `1D` here, so a continuous-clock bar would have
/// entered custody wearing a session-day label. The unit test asserts the table; this asserts that
/// what the Owner commits carries `24H`.
///
/// It is quoted and margined in USDC, which is why it can exist beside the 4H product at all: two
/// bindings that agree on every semantics field derive one compatibility scope, and the Owner
/// states a scope's semantics exactly once. A second USDT perpetual would collide there, and which
/// of the two collided would depend on which test ran first.
///
/// Its tick is BTCUSDC-PERP's own `tickSize` 0.1, with `stepSize` 0.001.
static PERPETUAL_DAILY: Product = Product {
    member: "BTCUSDC-PERP.BINANCE",
    venue_symbol: "BTCUSDC",
    interval: "1d",
    timeframe: "24H",
    bar_ns: 86_400_000_000_000,
    instrument_class: "CRYPTO_PERPETUAL",
    source_identity: "BINANCE_USDM",
    endpoint: "https://fapi.binance.com",
    endpoint_override_var: "MARKET_DATA_E2E_USDM_ENDPOINT",
    dataset_mapping: "usdm/klines/1d",
    stream_identity: "binance/usdm-klines-daily",
    normalization: "binance/usdm-kline",
    lifecycle_rules: "binance/usdm-perpetual",
    price_increment: (1, 1),
    quantity_increment: (1, 3),
    base_currency: "BTC",
    quote_currency: "USDC",
    settlement_currency: "USDC",
    margin_currency: Some("USDC"),
    price_meaning: "decimal-string/usdc",
    digest_tag: 0x03,
    observations: futures_observations,
};

fn spot_observations(
    product: &'static Product,
    endpoint: String,
) -> Arc<dyn PitObservationSourceV1> {
    let client = BinanceSpotHttpClient::new_with_json_responses(
        BinanceEnvironment::Live,
        get_atomic_clock_realtime(),
        None,
        None,
        Some(endpoint),
        None,
        Some(30),
        None,
        true,
    )
    .expect("the keyless spot client builds");
    Arc::new(
        BinanceSpotBarObservationSourceV1::new(client, symbols(product), product.interval)
            .expect("the Data Client accepts the member mapping"),
    )
}

fn futures_observations(
    product: &'static Product,
    endpoint: String,
) -> Arc<dyn PitObservationSourceV1> {
    let client = BinanceFuturesHttpClient::new(
        BinanceProductType::UsdM,
        BinanceEnvironment::Live,
        get_atomic_clock_realtime(),
        None,
        None,
        Some(endpoint),
        None,
        Some(30),
        None,
        false,
    )
    .expect("the keyless USD-M client builds");
    Arc::new(
        BinanceFuturesBarObservationSourceV1::new(client, symbols(product), product.interval)
            .expect("the Data Client accepts the member mapping"),
    )
}

fn symbols(product: &Product) -> BTreeMap<String, String> {
    let mut symbols = BTreeMap::new();
    symbols.insert(product.member.to_string(), product.venue_symbol.to_string());
    symbols
}

fn digest(byte: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([byte; 32])
}

/// A digest this product owns, distinct from every other product's.
///
/// The tag occupies one byte and the fixture byte fills the rest, so two products collide only if
/// they share a tag - which is a duplicate to fix, not an arithmetic accident. It is never the
/// all-zero sentinel that `digest(0)` mints, because every tag is non-zero.
fn scoped(product: &Product, byte: u8) -> BindingDigest {
    let mut bytes = [byte; 32];
    bytes[0] = product.digest_tag;
    BindingDigest::from_untrusted_bytes(bytes)
}

fn decimal((mantissa, scale): (i128, u8)) -> InstrumentDecimalSubmissionV1 {
    InstrumentDecimalSubmissionV1 { mantissa, scale }
}

/// The event instant the request freezes: the close of a bar that is certainly already closed.
fn frozen_event_effective_ns(product: &Product) -> u64 {
    let now_ns = u64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("the host clock is after the epoch")
            .as_nanos(),
    )
    .expect("the host clock fits in u64 nanoseconds");
    // Two bars back, floored to a bar boundary, so the venue has certainly closed and published
    // the bar that covers the coordinate. Two rather than one: flooring alone would land on the
    // boundary of a bar that may have closed a millisecond ago and not yet been served.
    let two_bars_ago = now_ns - 2 * product.bar_ns;
    two_bars_ago - (two_bars_ago % product.bar_ns)
}

#[tokio::test]
#[ignore = "requires the disposable PostgreSQL harness and a reachable venue"]
async fn market_data_answers_one_frozen_request_without_a_credential() {
    admit_and_answer(&SPOT).await;
}

/// The same seven steps for a perpetual: a different instrument class, a different venue surface,
/// a different tick and step, and a clock this venue never closes.
///
/// It shares the store with the proof above, and the two run one at a time - the runner passes
/// `--test-threads=1` - because each reads the Owner's decision cut after admitting its own
/// binding, and a cut read across another admission is a cut for a head that has already moved.
#[tokio::test]
#[ignore = "requires the disposable PostgreSQL harness and a reachable venue"]
async fn market_data_answers_one_frozen_perpetual_request_without_a_credential() {
    admit_and_answer(&PERPETUAL).await;
}

/// The same seven steps for a perpetual's daily bar, which is where the Owner's timeframe word and
/// the venue's interval word are furthest apart.
/// Answers one year of daily coordinates and prints the sealed pair for each.
///
/// Not selected by the end-to-end runner's default set, and deliberately not a chain entry. The
/// Owner re-validates every lineage in the store on each commit and every snapshot opens its own
/// lineage, so the cost of a sweep is quadratic in what the store already holds: writing these into
/// a database that is never reset would tax every later snapshot, for every writer, permanently.
/// A disposable database pays that cost once and discards it.
///
/// Three hundred and sixty-five daily coordinates is a window a strategy can be judged over, and it
/// is cheaper than the 512 one-minute coordinates measured earlier - fewer coordinates, and the cost
/// follows the count rather than the span.
#[tokio::test]
#[ignore = "requires the disposable PostgreSQL harness and a reachable venue"]
async fn market_data_answers_one_year_of_daily_perpetual_coordinates() {
    admit_and_sweep(&PERPETUAL_DAILY, 365).await;
}

#[tokio::test]
#[ignore = "requires the disposable PostgreSQL harness and a reachable venue"]
async fn market_data_answers_one_frozen_daily_perpetual_request_without_a_credential() {
    admit_and_answer(&PERPETUAL_DAILY).await;
}

/// Everything one product's admission establishes before any snapshot is requested.
///
/// Extracted so the single-coordinate proof and the window sweep share one admission rather than
/// two copies that could drift. A sweep is not a second kind of request: it is this same
/// admission answered at more than one coordinate.
struct Admitted {
    intake: std::sync::Arc<dyn PitMarketSnapshotIntakeV1>,
    cut: MarketDataDecisionCutV1,
    binding_locator: UntrustedSourceBindingLocator,
    semantics_identity: BindingDigest,
    selection: UniverseSelectionTerminalV1,
    effective_ns: u64,
}

async fn admit(product: &'static Product) -> Admitted {
    let effective_ns = frozen_event_effective_ns(product);

    // 1. Operations admits the Source Binding. The Owner decides the disposition.
    let admission = source_binding_admission_from_environment_v1()
        .await
        .expect("the configured Market Data store opens");
    let proposal = binance_source_proposal(product, effective_ns);
    let terminal = admission
        .admit(SourceBindingAdmissionRequestV1 {
            proposal: proposal.clone(),
            rights: ProviderRightsEvidenceV1::Granted,
            reachability: ProviderReachabilityEvidenceV1::Reachable,
        })
        .await
        .expect("an admitted binding commits");
    assert_eq!(
        terminal.disposition(),
        SourceBindingAdmissionDispositionV1::Admitted,
        "granted rights and a reachable endpoint admit the binding"
    );
    let binding_lineage_root = terminal.lineage_root();
    let binding_locator = terminal.locator().clone();
    let semantics_identity = terminal.market_semantics_identity();

    // 2. Operations admits the instrument's master fact under the Owner's own clock head. The PIT
    //    intake stamps its digest from this, so without it no snapshot can be minted at all.
    let instruments = instrument_master_admission_from_environment_v1()
        .await
        .expect("the configured Market Data store opens");
    let instrument = instruments
        .admit_fact(instrument_submission(
            product,
            &binding_locator,
            effective_ns,
        ))
        .await
        .expect("the member's instrument fact is admitted");
    assert_eq!(instrument.canonical_identity(), product.member);

    // 3. Operations admits the membership behind one eligible frontier.
    let universe = universe_selection_admission_from_environment_v1()
        .await
        .expect("the configured Market Data store opens");
    let frontier = scoped(product, 0x11);
    universe
        .admit_membership(HistoricalMembershipAdmissionRequestV1 {
            eligible_instrument_frontier: frontier,
            members: vec![HistoricalMembershipSubmissionV1 {
                member_key: product.member.to_string(),
                instrument: product.member.to_string(),
                effective_from_ns: 1,
                effective_until_ns: None,
                provider_available_ns: i128::from(effective_ns),
                retrieval_ns: i128::from(effective_ns),
                correction_publication_ns: i128::from(effective_ns),
                owner_observation_ns: i128::from(effective_ns),
                decision_cut: effective_ns,
                source_binding_lineage_root: binding_lineage_root,
                correction_frontier_digest: proposal.correction_frontier.digest,
            }],
        })
        .await
        .expect("a complete frontier is admitted whole");

    // 4. The Owner evaluates the requester's rule. The requester never states members.
    let selection = universe
        .evaluate(UntrustedUniverseSelectionRequestV1::new(
            scoped(product, 0x12),
            "RESEARCH_OWNER_V1",
            scoped(product, 0x13),
            vec![0, 1, 1],
            frontier,
            1,
            i128::from(effective_ns),
            effective_ns,
            binding_lineage_root,
            proposal.correction_frontier.digest,
            scoped(product, 0x14),
        ))
        .await
        .expect("the rule evaluates against admitted membership");
    assert_eq!(
        selection.member_count(),
        1,
        "the Owner selected exactly the admitted member"
    );

    // 5. The intake binds the real Data Client. No credential is supplied anywhere.
    //
    // The client calls the host the admitted binding names. Left to its library default the spot
    // client would call `api.binance.com` while the binding recorded `data-api.binance.vision`,
    // and the Owner would be holding a provenance for an endpoint nothing contacted.
    let host = endpoint(product);
    assert_eq!(
        proposal.adapter.authenticated_endpoint_identity, host,
        "the binding records the host the Data Client is about to call"
    );
    let observations = (product.observations)(product, host);

    // What the Owner is about to take custody of is asked once here, directly, because nothing
    // downstream can be asked again: the terminal carries identities and a disposition, not rows.
    // The timeframe is the field this checks for. A venue interval word and an Owner timeframe are
    // different vocabularies, and `1d` on a venue that never closes is twenty-four hours rather
    // than the named exchange session day that label already means elsewhere in this Owner. A
    // member admitted under one and observed under the other would be a coherent, wrong fact.
    let probe = PitObservationScopeV1::from_owner_request(
        vec![product.member.to_string()],
        effective_ns,
        effective_ns,
        effective_ns,
        effective_ns,
        effective_ns,
    );
    let rows = observations
        .observe(&probe)
        .await
        .expect("the venue answers the admitted member's scope");
    assert_eq!(
        rows.len(),
        4,
        "one closed bar states an open, a high, a low and a close"
    );

    for row in &rows {
        assert_eq!(row.member_key, product.member);
        assert_eq!(
            row.timeframe, product.timeframe,
            "the observation carries the timeframe this member was admitted under"
        );
        assert_eq!(
            row.symbolic_key,
            format!("{}.{}.{}", product.member, row.field, product.timeframe),
            "the symbolic key is the member, the field and the admitted timeframe"
        );
    }
    let intake = pit_market_snapshot_intake_from_environment_v1(observations)
        .await
        .expect("the configured Market Data store opens");

    // 6. R&D reads the Owner's cut and freezes a request against it.
    let cut = intake
        .current_decision_cut()
        .await
        .expect("admitting the binding established the canonical clock head");
    Admitted {
        intake,
        cut,
        binding_locator,
        semantics_identity,
        selection,
        effective_ns,
    }
}

async fn admit_and_answer(product: &'static Product) {
    let Admitted {
        intake,
        cut,
        binding_locator,
        semantics_identity,
        selection,
        effective_ns,
    } = admit(product).await;
    let submission = frozen_submission(
        product,
        &cut,
        &binding_locator,
        semantics_identity,
        selection.selection_identity(),
        effective_ns,
        scoped(product, 0x21),
    );

    let snapshot = intake
        .submit(submission.clone(), universe_locator(&selection))
        .await
        .expect("the Owner reaches a finding");
    assert_eq!(
        snapshot.disposition(),
        PitMarketSnapshotDispositionV1::Available,
        "an admitted binding, a matching semantics identity and live coverage mint AVAILABLE"
    );
    assert_ne!(
        snapshot.snapshot_identity(),
        digest(0),
        "a committed snapshot carries a real identity"
    );
    let resealed = submission.into_request(snapshot.instrument_master_digest());
    assert_eq!(
        (
            resealed.claimed_request_identity,
            resealed.claimed_request_digest
        ),
        (snapshot.request_identity(), snapshot.request_digest()),
        "the stored submission sealed over the stamped digest is the request the Owner committed"
    );

    // 7. Operations states what the binding's observations mean. This is the last fact a Strategy
    //    Input declaration re-resolves, and the Owner derives its scope, regime and every
    //    coordinate from the snapshot it just committed.
    let semantics = market_semantics_admission_from_environment_v1()
        .await
        .expect("the configured Market Data store opens");
    let stated = semantics
        .admit_fact(MarketSemanticsFactSubmissionV1 {
            source_binding: binding_locator,
            pit_snapshot: snapshot
                .locator()
                .expect("an AVAILABLE terminal names its snapshot")
                .clone(),
            value: MarketSemanticsValueSubmissionV1 {
                normalization_identity: scoped(product, 0x41),
                // Neither surface applies a corporate action, a split or a distribution to its
                // quotes, so both are raw. This is a statement about the venue, not a default.
                price_adjustment: "RAW".into(),
                timestamp_basis: "INTERVAL_CLOSE".into(),
                price_unit_identity: scoped(product, 0x42),
                size_unit_identity: scoped(product, 0x43),
            },
        })
        .await
        .expect("the binding's semantics are admitted against its own snapshot");
    assert_eq!(
        stated.compatibility_scope_identity(),
        semantics_identity,
        "the scope is the binding's own compatibility identity"
    );

    eprintln!(
        "{} snapshot {:?} is {:?}; semantics fact {:?}",
        product.member,
        snapshot.snapshot_identity(),
        snapshot.disposition(),
        stated.fact_identity()
    );
}

/// Answers one product at `coordinates` consecutive bar boundaries, all frozen against one cut.
///
/// A series is N of the single-coordinate request rather than a second kind of request: the Owner
/// still answers "as of T" once per coordinate, through the same admitted intake the proof above
/// uses once. Nothing here resolves a BAR schedule, so **this does not claim these coordinates are
/// the venue's own bar boundaries**. What that costs is bounded and visible: the source answers
/// with the last bar already closed at each coordinate, so a step that does not line up returns the
/// same bar twice rather than a wrong one, and the repeat shows up in `event_effective`. The count
/// of distinct bars printed below is what says whether that happened.
///
/// Each coordinate prints its sealed pair so a consumer can resolve the series without this process
/// handing it rows: a snapshot identity and its fact digest are what the Owner sealed, and they are
/// the only things a downstream Owner port will accept.
async fn admit_and_sweep(product: &'static Product, coordinates: usize) {
    let Admitted {
        intake,
        cut,
        binding_locator,
        semantics_identity,
        selection,
        effective_ns,
    } = admit(product).await;

    // A second client, used only to witness which bar each coordinate resolved to. The intake asks
    // the venue itself; the terminal it returns carries identities and a disposition, not rows, so
    // the repeat check cannot be read off it.
    let witness = (product.observations)(product, endpoint(product));
    let started = std::time::Instant::now();
    let mut bars = Vec::with_capacity(coordinates);
    let mut sealed = Vec::with_capacity(coordinates);

    for index in 0..coordinates {
        let back = u64::try_from(coordinates - 1 - index).expect("the coordinate count fits");
        let at = effective_ns - back * product.bar_ns;

        let scope = PitObservationScopeV1::from_owner_request(
            vec![product.member.to_string()],
            at,
            at,
            at,
            at,
            at,
        );
        let rows = witness
            .observe(&scope)
            .await
            .expect("the venue answers every coordinate in the window");
        bars.push(
            rows.first()
                .expect("a coordinate the venue answers has at least one field")
                .event_effective,
        );

        // Each coordinate is its own intake, so it claims a correlation of its own.
        let submission = frozen_submission(
            product,
            &cut,
            &binding_locator,
            semantics_identity,
            selection.selection_identity(),
            at,
            frozen_window_coordinate_correlation_v1(scoped(product, 0x25), at),
        );
        let snapshot = intake
            .submit(submission, universe_locator(&selection))
            .await
            .expect("the Owner reaches a finding at every coordinate");
        assert_eq!(
            snapshot.disposition(),
            PitMarketSnapshotDispositionV1::Available,
            "every coordinate in an admitted window mints AVAILABLE"
        );
        sealed.push((snapshot.snapshot_identity(), snapshot.fact_digest()));
    }

    let elapsed = started.elapsed();
    let distinct_bars = bars.iter().collect::<std::collections::BTreeSet<_>>().len();
    let distinct_sealed = sealed
        .iter()
        .map(|(identity, _)| identity)
        .collect::<std::collections::BTreeSet<_>>()
        .len();

    assert_eq!(sealed.len(), coordinates, "every coordinate sealed a pair");
    assert_eq!(
        distinct_sealed, coordinates,
        "each coordinate is its own request, so each seals its own identity"
    );

    eprintln!(
        "SWEEP {} {} coordinates={coordinates} distinct_bars={distinct_bars} \
         elapsed_s={:.1} first_bar_ns={} last_bar_ns={}",
        product.member,
        product.timeframe,
        elapsed.as_secs_f64(),
        bars.first().copied().unwrap_or_default(),
        bars.last().copied().unwrap_or_default(),
    );

    for (ordinal, ((identity, digest), bar)) in sealed.iter().zip(bars.iter()).enumerate() {
        eprintln!(
            "SEALED {ordinal} event_effective_ns={bar} snapshot_identity={} fact_digest={}",
            hex(identity.as_bytes()),
            hex(digest.as_bytes())
        );
    }
}

/// Lower-case hexadecimal, so a consumer can paste an identity straight into a query.
fn hex(bytes: &[u8; 32]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn universe_locator(
    selection: &UniverseSelectionTerminalV1,
) -> UntrustedUniverseSelectionLocatorV1 {
    UntrustedUniverseSelectionLocatorV1::from_untrusted(
        selection.request_identity(),
        selection.request_meaning_digest(),
    )
}

/// The member as Operations would describe it, under the binding's own semantics and frontiers.
fn instrument_submission(
    product: &Product,
    source_binding: &UntrustedSourceBindingLocator,
    effective_ns: u64,
) -> InstrumentMasterFactSubmissionV1 {
    let observed = i128::from(effective_ns) - 1;
    InstrumentMasterFactSubmissionV1 {
        canonical_identity: product.member.to_string(),
        predecessor_fact_digest: None,
        mappings: vec![InstrumentVenueSourceMappingSubmissionV1 {
            venue_identity: "BINANCE".into(),
            source_identity: product.source_identity.into(),
            source_instrument: product.venue_symbol.as_bytes().to_vec(),
        }],
        instrument_class: product.instrument_class.into(),
        base_currency: Some(product.base_currency.into()),
        quote_currency: Some(product.quote_currency.into()),
        settlement_currency: Some(product.settlement_currency.into()),
        margin_currency: product.margin_currency.map(Into::into),
        price_increment: decimal(product.price_increment),
        quantity_increment: decimal(product.quantity_increment),
        // One contract is one unit of the base asset on both surfaces: the spot pair trades BTC
        // directly, and the USD-M perpetual is linear rather than inverse.
        contract_multiplier: decimal((1, 0)),
        // This venue never closes, so its calendar, its session and its time zone are one
        // continuous clock. Do not copy an exchange-session identity here from the equity leg.
        calendar_identity: "CRYPTO-CONTINUOUS-V1".into(),
        session_identity: "CRYPTO-CONTINUOUS-V1".into(),
        time_zone_identity: "Etc/UTC".into(),
        lifecycle_frontier: scoped(product, 0x31),
        corporate_action_frontier: scoped(product, 0x32),
        historical_membership_frontier: scoped(product, 0x11),
        source_binding: source_binding.clone(),
        effective_from: 1,
        effective_until: None,
        provider_available: observed,
        retrieval: observed,
        correction_publication: observed,
        owner_observation: observed,
    }
}

/// The request R&D freezes and stores: it states no Owner field, so the Owner stamps its own
/// Instrument Master digest and seals the request over it.
fn frozen_submission(
    product: &Product,
    cut: &MarketDataDecisionCutV1,
    binding_locator: &UntrustedSourceBindingLocator,
    market_semantics_identity: BindingDigest,
    universe_selection_digest: BindingDigest,
    effective_ns: u64,
    correlation_identity: BindingDigest,
) -> PitSnapshotSubmissionV1 {
    let id = cut.clock_identity.clone();
    let epoch = cut.clock_epoch.clone();
    PitSnapshotSubmissionV1 {
        correlation_identity,
        requester_identity: scoped(product, 0x22),
        scope_digest: scoped(product, 0x23),
        source_binding: binding_locator.clone(),
        universe_selection_digest,
        market_semantics_identity,
        time_evidence: UntrustedPitSnapshotTimeEvidence {
            event_effective: UntrustedEventEffectiveTime::from_untrusted(effective_ns, &id, &epoch),
            provider_available: UntrustedProviderAvailableTime::from_untrusted(
                effective_ns,
                &id,
                &epoch,
            ),
            retrieval: UntrustedRetrievalTime::from_untrusted(effective_ns, &id, &epoch),
            correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
                effective_ns,
                &id,
                &epoch,
            )),
            decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(
                cut.decision_cut,
                &id,
                &epoch,
            ),
            monotonic_sequence: cut.monotonic_sequence,
            restart_continuity_digest: cut.restart_continuity_digest,
            skew_bound: cut.skew_bound,
            uncertainty_bound: cut.uncertainty_bound,
            observed_at: cut.decision_cut,
            valid_through: cut.valid_through,
        },
    }
}

/// The keyless venue binding as Operations would propose it.
fn binance_source_proposal(product: &Product, effective_ns: u64) -> UntrustedSourceBindingProposal {
    let frontier = |digest_byte: u8, sequence: u64| UntrustedCompleteFrontier {
        stream_identity: product.stream_identity.to_string(),
        cut_identity: format!("{}/cut-1", product.stream_identity),
        sequence,
        digest: scoped(product, digest_byte),
    };
    let mut proposal = UntrustedSourceBindingProposal {
        claimed_binding_id: digest(0),
        schema_version: 1,
        adapter: UntrustedAdapterBinding {
            implementation_digest: scoped(product, 0x51),
            configuration_digest: scoped(product, 0x52),
            authenticated_endpoint_identity: endpoint(product),
            dataset_mapping: product.dataset_mapping.to_string(),
            account_mapping: "binance/public".to_string(),
        },
        // The venue serves this data without authentication, so the handle names a capability the
        // Owner can check rather than a secret anybody holds.
        credential_handle: UntrustedOpaqueCredentialHandle::from_untrusted_identity(
            scoped(product, 0x53),
            UntrustedCredentialAudienceClaim::MarketData,
            [
                UntrustedCredentialCapabilityClaim::MarketDataRead,
                UntrustedCredentialCapabilityClaim::ReferenceDataRead,
                UntrustedCredentialCapabilityClaim::MetadataRead,
            ],
        ),
        trust_policy: UntrustedTrustPolicy {
            identity: "binance/official-public-data".to_string(),
            version: 1,
        },
        semantics: UntrustedMarketSemantics {
            normalization: product.normalization.to_string(),
            adjustment: "raw".to_string(),
            price_meaning: product.price_meaning.to_string(),
            calendar_rules: "crypto/continuous".to_string(),
            session_rules: "crypto/continuous".to_string(),
            timezone_rules: "etc-utc".to_string(),
            instrument_lifecycle_rules: product.lifecycle_rules.to_string(),
            corporate_action_rules: "crypto/none".to_string(),
            membership_rules: "binance/static".to_string(),
            universe_rules: "requester-owned".to_string(),
            correction_policy: "provider-revision".to_string(),
        },
        license: UntrustedLicensePolicy {
            use_scope: "internal-research".to_string(),
            redistribution_scope: "none".to_string(),
            retention_policy: "retain-while-entitled".to_string(),
            redaction_policy: "no-payload-export".to_string(),
        },
        source_frontier: frontier(0x54, 1),
        correction_frontier: frontier(0x55, 1),
        // Every clock field below is overwritten by the Owner on admission; only the four
        // coordinates and the effective instant are the submitter's.
        time_evidence: UntrustedMarketDataAsOf {
            claimed_evidence_identity: digest(0),
            clock_identity: String::new(),
            clock_epoch: String::new(),
            monotonic_sequence: 0,
            restart_continuity_digest: digest(0),
            skew_bound: 0,
            uncertainty_bound: 0,
            event_effective: effective_ns,
            provider_available: effective_ns,
            retrieval: effective_ns,
            correction_publication: effective_ns,
            observed_at: 0,
            effective_at: effective_ns,
            valid_through: 0,
        },
    };
    seal_binding_claim_v1(&mut proposal);
    proposal
}
