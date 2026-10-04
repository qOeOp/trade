//! Builds the facts Market Data's Binance perpetual admission route commits, from one real
//! USD-M `exchangeInfo` payload.
//!
//! This module names only what the route itself cannot get from the Owner's own intakes: the
//! Source Binding proposals for the two datasets the route reads (daily klines, `exchangeInfo`),
//! and the Instrument Master V1 submission, whose fields the venue's filters must be read to fill.
//! The Instrument Master V2 baseline derives the same fields from the raw payload inside the Owner,
//! so the route passes that payload through unparsed.
//!
//! The two Source Binding proposals carry no symbol and claim the same fixed effective instant
//! every time: a binding's identity
//! (`crates/data/src/owner/source_binding/authority.rs::canonical_semantic_bytes`) hashes the
//! adapter, credential, trust, semantics, license, availability-rule, bar-timeframe and claimed
//! time-evidence fields, and none of the first six vary by instrument for one dataset - but the
//! claimed effective instant does vary by call unless it is fixed, since
//! `encode_time_without_claim` folds `event_effective`/`provider_available`/`retrieval`/
//! `correction_publication`/`effective_at` into the same hash. `BINANCE_PERPETUAL_BINDING_EFFECTIVE_NS_V1`
//! fixes that instant so admitting the second symbol through this route derives the same binding
//! identity as the first and rejoins it; the route never admits one binding per instrument.
//!
//! Historical membership is different: it is admitted once, whole, for
//! [`BINANCE_PERPETUAL_U1_MEMBERS_V1`]'s complete set, never per symbol (see
//! [`binance_perpetual_eligible_frontier_v1`]'s doc for why one symbol at a time does not work),
//! so this module only builds that one-time request plus the per-symbol fields that must name the
//! same frontier it admits.

use rust_decimal::Decimal;
use serde_json::Value;
use vibe_data::owner::{
    instrument_master_admission_v1::{
        InstrumentDecimalSubmissionV1, InstrumentMasterFactSubmissionV1,
        InstrumentVenueSourceMappingSubmissionV1,
    },
    market_semantics_admission_v1::MarketSemanticsValueSubmissionV1,
    source_binding::{
        BindingDigest, UntrustedAdapterBinding, UntrustedCompleteFrontier,
        UntrustedCredentialAudienceClaim, UntrustedCredentialCapabilityClaim,
        UntrustedLicensePolicy, UntrustedMarketDataAsOf, UntrustedMarketSemantics,
        UntrustedOpaqueCredentialHandle, UntrustedSourceAvailabilityRuleV1,
        UntrustedSourceBarAnchorV1, UntrustedSourceBarCadenceV1, UntrustedSourceBarClockV1,
        UntrustedSourceBarCompletionV1, UntrustedSourceBarLabelV1, UntrustedSourceBarTimeframeV1,
        UntrustedSourceBarUnitV1, UntrustedSourceBindingLocator, UntrustedSourceBindingProposal,
        UntrustedSourceVisibilityV1, UntrustedTrustPolicy, seal_binding_claim_v1,
    },
    universe_selection_admission_v1::HistoricalMembershipAdmissionRequestV1,
};

/// The route's own venue identity: `BINANCE`, source `BINANCE_USDM`.
pub const BINANCE_PERPETUAL_VENUE_IDENTITY_V1: &str = "BINANCE";
/// The route's own source identity: `BINANCE`, source `BINANCE_USDM`.
pub const BINANCE_PERPETUAL_SOURCE_IDENTITY_V1: &str = "BINANCE_USDM";

/// The datasets the route's two Source Bindings name.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BinancePerpetualDatasetV1 {
    /// Daily klines: the execution bars U1's `1d` custody reads.
    DailyKlines,
    /// The venue's `exchangeInfo`, which the Instrument Master V2 intake reads.
    ExchangeInfo,
}

impl BinancePerpetualDatasetV1 {
    /// The stable name this dataset's one durable Source Binding anchor is keyed by
    /// (`SourceBindingAdmissionV1::admit_dataset_anchor`). The anchor store is generic across every
    /// dataset Market Data anchors, so the key carries the venue.
    #[must_use]
    pub const fn dataset_anchor_key(self) -> &'static str {
        match self {
            Self::DailyKlines => "binance/usdm/klines/1d",
            Self::ExchangeInfo => "binance/usdm/exchangeInfo",
        }
    }

    const fn mapping(self) -> &'static str {
        match self {
            Self::DailyKlines => "usdm/klines/1d",
            Self::ExchangeInfo => "usdm/exchangeInfo",
        }
    }

    /// The klines binding declares what its rows mean as bars, which only schema 2 can; the
    /// `exchangeInfo` binding serves no BAR row and stays schema 1.
    const fn schema_version(self) -> u16 {
        match self {
            Self::DailyKlines => 2,
            Self::ExchangeInfo => 1,
        }
    }

    /// A kline row is visible one second after its bar closes, and the venue never corrects a
    /// closed kline. `exchangeInfo` is not a bar feed and declares no availability rule.
    const fn availability_rule(self) -> Option<UntrustedSourceAvailabilityRuleV1> {
        match self {
            Self::DailyKlines => Some(UntrustedSourceAvailabilityRuleV1 {
                visibility: UntrustedSourceVisibilityV1::AfterBarClose {
                    lag_ns: 1_000_000_000,
                },
                publishes_corrections: false,
            }),
            Self::ExchangeInfo => None,
        }
    }

    /// Every row timeframe this binding backs: `SUPPORTED_EXECUTION_TIMEFRAMES_V1`'s four members
    /// (`1h`/`4h`/`1d`/`1w`, declared as `1H`/`4H`/`24H`/`1W` - not `1D`, which already names a
    /// named exchange session day elsewhere, `pit_observation_source_v1.rs::owner_timeframe`'s own
    /// doc explains why a perpetual's continuous 24-hour bar must not share that label) plus `1M`,
    /// the backfill job's fixed fill timeframe. Every row is labelled at its close, complete only:
    /// a perpetual never closes, so none of these is an exchange session. `1H`/`1M`/`24H`/`4H` run
    /// on the Unix epoch grid; `1W` runs on the week-start-Monday grid Binance's own weekly klines
    /// use (00:00 UTC Monday), the user's own decision for where a week begins.
    fn bar_timeframes(self) -> Vec<UntrustedSourceBarTimeframeV1> {
        match self {
            Self::DailyKlines => {
                let bar = |row_timeframe: &str,
                           step: u32,
                           unit: UntrustedSourceBarUnitV1,
                           anchor: UntrustedSourceBarAnchorV1| {
                    UntrustedSourceBarTimeframeV1 {
                        row_timeframe: row_timeframe.to_owned(),
                        cadence: UntrustedSourceBarCadenceV1::FixedInterval { step, unit },
                        anchor,
                        clock: UntrustedSourceBarClockV1::Continuous,
                        label: UntrustedSourceBarLabelV1::IntervalClose,
                        completion: UntrustedSourceBarCompletionV1::CompleteOnly,
                    }
                };
                let continuous =
                    |row_timeframe: &str, step: u32, unit: UntrustedSourceBarUnitV1| {
                        bar(
                            row_timeframe,
                            step,
                            unit,
                            UntrustedSourceBarAnchorV1::UnixEpoch,
                        )
                    };
                // Declarations must sort in strictly ascending byte order by `row_timeframe`
                // (`source_binding/authority.rs`'s "one set of declarations has one encoding"),
                // which is not numeric order for these labels: "1H" < "1M" < "1W" < "24H" < "4H".
                vec![
                    continuous("1H", 1, UntrustedSourceBarUnitV1::Hour),
                    continuous("1M", 1, UntrustedSourceBarUnitV1::Minute),
                    bar(
                        "1W",
                        168,
                        UntrustedSourceBarUnitV1::Hour,
                        UntrustedSourceBarAnchorV1::WeekStartMonday,
                    ),
                    continuous("24H", 24, UntrustedSourceBarUnitV1::Hour),
                    continuous("4H", 4, UntrustedSourceBarUnitV1::Hour),
                ]
            }
            Self::ExchangeInfo => Vec::new(),
        }
    }
}

/// A registry meaning named for this route, so no value is borrowed from a test fixture's.
fn binance_perpetual_admission_digest_v1(meaning: &str) -> BindingDigest {
    let digest = aws_lc_rs::digest::digest(
        &aws_lc_rs::digest::SHA256,
        format!("binance-perpetual-admission.v1.{meaning}").as_bytes(),
    );
    let bytes: [u8; 32] = digest
        .as_ref()
        .try_into()
        .expect("SHA-256 is always 32 bytes");
    BindingDigest::from_untrusted_bytes(bytes)
}

/// U1's fixed, complete set of Binance perpetual raw symbols. Historical membership is admitted
/// once for this whole set (see [`binance_perpetual_eligible_frontier_v1`]'s doc for why it
/// cannot grow one symbol at a time), and every per-symbol admission through this route assumes
/// the set it belongs to is this one.
pub const BINANCE_PERPETUAL_U1_MEMBERS_V1: &[&str] = &["BTCUSDT", "ETHUSDT", "SOLUSDT"];

/// Whether `raw_symbol` is one of [`BINANCE_PERPETUAL_U1_MEMBERS_V1`]. The route checks this
/// before any admission step, and refuses by name rather than letting a symbol outside the fixed
/// set fail partway through as a generic conflict: growing the set is its own deliberate
/// successor-frontier admission (see [`binance_perpetual_eligible_frontier_v1`]'s doc), not
/// something this route does on an unrecognised symbol.
#[must_use]
pub fn binance_perpetual_symbol_is_eligible_v1(raw_symbol: &str) -> bool {
    BINANCE_PERPETUAL_U1_MEMBERS_V1.contains(&raw_symbol)
}

/// The eligible-instrument frontier for one fixed, complete member set: a domain-separated digest
/// over the sorted canonical identities, so a different set derives a different frontier instead
/// of colliding with this one's manifest.
///
/// A frontier's manifest is fixed at the instant it is first admitted
/// (`crates/data/src/owner/postgres/universe_selection.rs::persist_historical_membership_frontier_v1`):
/// a later admission naming a member outside that manifest refuses `RequestConflict`, because
/// `HistoricalMembershipAdmissionRequestV1` is one complete, atomic declaration of a closed set,
/// not an append-only list. A per-symbol frontier does not avoid this either, because the Owner
/// tracks only one global "current" frontier (the most recently admitted one) and an Instrument
/// Master cut requires every member fact in it to name the same `historical_membership_frontier`
/// (`crates/data/src/owner/instrument_master/authority.rs`, `FrontierMismatch`): a two-member cut
/// over two different per-symbol frontiers would always fail. So this route admits membership once
/// for [`BINANCE_PERPETUAL_U1_MEMBERS_V1`]'s whole set (via the generic
/// `POST /v1/market-data/historical-memberships` route, see
/// [`binance_perpetual_eligible_set_admission_request_v1`]), before any symbol's own admission,
/// and every per-symbol Instrument Master V1 fact names this same frontier.
///
/// # Panics
///
/// Never in practice: SHA-256 always produces exactly 32 bytes.
#[must_use]
pub fn binance_perpetual_eligible_frontier_v1(raw_symbols: &[&str]) -> BindingDigest {
    let mut sorted: Vec<&str> = raw_symbols.to_vec();
    sorted.sort_unstable();
    let mut encoder_input = String::from("binance-perpetual-admission.v1.eligible-frontier");

    for raw_symbol in sorted {
        encoder_input.push('\u{0}');
        encoder_input.push_str(&binance_perpetual_canonical_identity_v1(raw_symbol));
    }
    let digest = aws_lc_rs::digest::digest(&aws_lc_rs::digest::SHA256, encoder_input.as_bytes());
    let bytes: [u8; 32] = digest
        .as_ref()
        .try_into()
        .expect("SHA-256 is always 32 bytes");
    BindingDigest::from_untrusted_bytes(bytes)
}

/// The kline and `exchangeInfo` Source Bindings' own `correction_frontier.digest`
/// (`binance_perpetual_source_proposal`'s `frontier("correction-frontier")`), for a caller that
/// must restate it rather than read it back from an admitted locator, which exposes no accessor
/// for it.
#[must_use]
pub fn binance_perpetual_correction_frontier_digest_v1() -> BindingDigest {
    binance_perpetual_admission_digest_v1("correction-frontier")
}

/// The one-time, complete historical-membership admission for [`BINANCE_PERPETUAL_U1_MEMBERS_V1`],
/// to send through the generic `POST /v1/market-data/historical-memberships` route before any
/// symbol's own Instrument Master submission. Re-sending it rejoins the same frontier.
///
/// `source_binding_lineage_root` must be the kline dataset's own anchored lineage root
/// (`BinancePerpetualDatasetV1::DailyKlines`'s dataset anchor), not a value this function derives itself:
/// `admit()` is not idempotent (see `source_binding_dataset_anchor_v1`'s module doc), so there is
/// no fixed value this function could compute that would ever equal a real kline fact's lineage
/// root once a caller checks the two against each other.
#[must_use]
pub fn binance_perpetual_eligible_set_admission_request_v1(
    effective_ns: u64,
    source_binding_lineage_root: BindingDigest,
) -> HistoricalMembershipAdmissionRequestV1 {
    use vibe_data::owner::universe_selection_admission_v1::HistoricalMembershipSubmissionV1;

    let observed = i128::from(effective_ns);
    let mut members: Vec<&str> = BINANCE_PERPETUAL_U1_MEMBERS_V1.to_vec();
    members.sort_unstable();
    HistoricalMembershipAdmissionRequestV1 {
        eligible_instrument_frontier: binance_perpetual_eligible_frontier_v1(
            BINANCE_PERPETUAL_U1_MEMBERS_V1,
        ),
        members: members
            .into_iter()
            .map(|raw_symbol| {
                let canonical_identity = binance_perpetual_canonical_identity_v1(raw_symbol);
                HistoricalMembershipSubmissionV1 {
                    member_key: canonical_identity.clone(),
                    instrument: canonical_identity,
                    effective_from_ns: 1,
                    effective_until_ns: None,
                    provider_available_ns: observed,
                    retrieval_ns: observed,
                    correction_publication_ns: observed,
                    owner_observation_ns: observed,
                    decision_cut: effective_ns,
                    source_binding_lineage_root,
                    correction_frontier_digest: binance_perpetual_admission_digest_v1(
                        "correction-frontier",
                    ),
                }
            })
            .collect(),
    }
}

/// The fixed claimed effective instant every proposal from this route uses: 2023-11-14T22:13:20Z,
/// chosen only for being safely in the past of any Owner clock head this route will ever run
/// against. `canonical_semantic_bytes` folds the claimed time-evidence tuple into a binding's
/// identity (`encode_time_without_claim`), so a proposal that claimed "now" would derive a new
/// binding identity on every call; fixing it is what makes the second symbol's identical proposal
/// rejoin the first symbol's binding instead of minting a second one.
///
/// Also reused by the backfill job as the fixed `decision_cut`/`effective_at_ns`/
/// `owner_observation_ns` of its universe-selection `evaluate()` request: every Instrument Master
/// fact this route admits states `effective_from: 1`, so it is in force at this instant
/// regardless of when it was actually admitted, and reusing one fixed instant (rather than "now")
/// is what makes a repeat backfill of the same job rejoin the same evaluated selection, and so
/// the same custody, instead of minting a new one each run.
pub const BINANCE_PERPETUAL_BINDING_EFFECTIVE_NS_V1: u64 = 1_700_000_000_000_000_000;

/// The Market Semantics value a PIT window custody of this route's kline binding claims: raw venue
/// prices in USDT and quantities in the base asset, each bar labelled at its interval close. It is
/// stated once, beside the binding whose semantics it restates, so every custody of the binding
/// claims the same value and the Owner never sees two values for one scope.
#[must_use]
pub fn binance_perpetual_market_semantics_value_v1() -> MarketSemanticsValueSubmissionV1 {
    MarketSemanticsValueSubmissionV1 {
        normalization_identity: binance_perpetual_admission_digest_v1("normalization.usdm-kline"),
        price_adjustment: "RAW".to_owned(),
        timestamp_basis: "INTERVAL_CLOSE".to_owned(),
        price_unit_identity: binance_perpetual_admission_digest_v1("price-unit.usdt"),
        size_unit_identity: binance_perpetual_admission_digest_v1("size-unit.base-asset"),
    }
}

/// The perpetual's Source Binding, as this route proposes one: a public USD-M feed that needs no
/// credential. Every clock field is the Owner's and is overwritten on admission; the proposer's
/// claimed effective instant is fixed (see
/// `BINANCE_PERPETUAL_BINDING_EFFECTIVE_NS_V1`) so the proposal is the same for every instrument.
#[must_use]
pub fn binance_perpetual_source_proposal(
    dataset: BinancePerpetualDatasetV1,
) -> UntrustedSourceBindingProposal {
    let effective_ns = BINANCE_PERPETUAL_BINDING_EFFECTIVE_NS_V1;
    let frontier = |meaning: &str| UntrustedCompleteFrontier {
        stream_identity: "binance/usdm-klines".to_owned(),
        cut_identity: "binance/usdm-klines/cut-1".to_owned(),
        sequence: 1,
        digest: binance_perpetual_admission_digest_v1(meaning),
    };
    let mut proposal = UntrustedSourceBindingProposal {
        claimed_binding_id: BindingDigest::from_untrusted_bytes([0; 32]),
        schema_version: dataset.schema_version(),
        adapter: UntrustedAdapterBinding {
            implementation_digest: binance_perpetual_admission_digest_v1("adapter.implementation"),
            configuration_digest: binance_perpetual_admission_digest_v1("adapter.configuration"),
            authenticated_endpoint_identity: "https://fapi.binance.com".to_owned(),
            dataset_mapping: dataset.mapping().to_owned(),
            account_mapping: "binance/public".to_owned(),
        },
        credential_handle: UntrustedOpaqueCredentialHandle::from_untrusted_identity(
            binance_perpetual_admission_digest_v1("credential"),
            UntrustedCredentialAudienceClaim::MarketData,
            [
                UntrustedCredentialCapabilityClaim::MarketDataRead,
                UntrustedCredentialCapabilityClaim::ReferenceDataRead,
                UntrustedCredentialCapabilityClaim::MetadataRead,
            ],
        ),
        trust_policy: UntrustedTrustPolicy {
            identity: "binance/official-public-data".to_owned(),
            version: 1,
        },
        semantics: UntrustedMarketSemantics {
            normalization: "binance/usdm-kline".to_owned(),
            adjustment: "raw".to_owned(),
            price_meaning: "decimal-string/usdt".to_owned(),
            calendar_rules: "crypto/continuous".to_owned(),
            session_rules: "crypto/continuous".to_owned(),
            timezone_rules: "etc-utc".to_owned(),
            instrument_lifecycle_rules: "binance/usdm-perpetual".to_owned(),
            corporate_action_rules: "crypto/none".to_owned(),
            membership_rules: "binance/static".to_owned(),
            universe_rules: "requester-owned".to_owned(),
            correction_policy: "provider-revision".to_owned(),
        },
        license: UntrustedLicensePolicy {
            use_scope: "internal-research".to_owned(),
            redistribution_scope: "none".to_owned(),
            retention_policy: "retain-while-entitled".to_owned(),
            redaction_policy: "no-payload-export".to_owned(),
        },
        source_frontier: frontier("source-frontier"),
        correction_frontier: frontier("correction-frontier"),
        time_evidence: UntrustedMarketDataAsOf {
            claimed_evidence_identity: BindingDigest::from_untrusted_bytes([0; 32]),
            clock_identity: String::new(),
            clock_epoch: String::new(),
            monotonic_sequence: 0,
            restart_continuity_digest: BindingDigest::from_untrusted_bytes([0; 32]),
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
        availability_rule: dataset.availability_rule(),
        bar_timeframes: dataset.bar_timeframes(),
    };
    seal_binding_claim_v1(&mut proposal);
    proposal
}

/// Why [`binance_perpetual_instrument_master_submission`] could not read the fields it needs from
/// the real `exchangeInfo` payload.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BinancePerpetualAdmissionErrorV1 {
    /// The payload is not `exchangeInfo` JSON.
    PayloadMalformed,
    /// No `symbols` entry has the raw symbol.
    SymbolAbsent,
    /// The entry's `contractType` is not `PERPETUAL`.
    NotAPerpetual,
    /// A required filter or field is absent or not an accepted decimal.
    FilterUnavailable,
}

/// The perpetual's canonical identity, in this route's one naming convention.
#[must_use]
pub fn binance_perpetual_canonical_identity_v1(raw_symbol: &str) -> String {
    format!("{raw_symbol}-PERP.BINANCE")
}

/// The perpetual's Instrument Master V1 fact, as this route describes it from the real
/// `exchangeInfo` entry: a linear USD-M perpetual on a venue that never closes, observed under the
/// admitted kline binding just before the effective instant.
///
/// # Errors
///
/// Returns a named reason when the payload does not name the symbol as a perpetual with the
/// filters this fact needs.
pub fn binance_perpetual_instrument_master_submission(
    raw_symbol: &str,
    exchange_info_payload: &str,
    kline_source_binding: &UntrustedSourceBindingLocator,
    effective_ns: u64,
) -> Result<InstrumentMasterFactSubmissionV1, BinancePerpetualAdmissionErrorV1> {
    let info: Value = serde_json::from_str(exchange_info_payload)
        .map_err(|_| BinancePerpetualAdmissionErrorV1::PayloadMalformed)?;
    let symbols = info
        .get("symbols")
        .and_then(Value::as_array)
        .ok_or(BinancePerpetualAdmissionErrorV1::PayloadMalformed)?;
    let symbol = symbols
        .iter()
        .find(|entry| entry.get("symbol").and_then(Value::as_str) == Some(raw_symbol))
        .ok_or(BinancePerpetualAdmissionErrorV1::SymbolAbsent)?;
    if symbol.get("contractType").and_then(Value::as_str) != Some("PERPETUAL") {
        return Err(BinancePerpetualAdmissionErrorV1::NotAPerpetual);
    }
    let asset = |field: &str| -> Result<String, BinancePerpetualAdmissionErrorV1> {
        symbol
            .get(field)
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .ok_or(BinancePerpetualAdmissionErrorV1::FilterUnavailable)
    };
    let base_currency = asset("baseAsset")?;
    let quote_currency = asset("quoteAsset")?;
    let margin_currency = asset("marginAsset")?;
    let filters = symbol
        .get("filters")
        .and_then(Value::as_array)
        .ok_or(BinancePerpetualAdmissionErrorV1::FilterUnavailable)?;
    let price_increment = filter_decimal(filters, "PRICE_FILTER", "tickSize")?;
    let quantity_increment = filter_decimal(filters, "LOT_SIZE", "stepSize")?;
    let observed = i128::from(effective_ns) - 1;

    Ok(InstrumentMasterFactSubmissionV1 {
        canonical_identity: binance_perpetual_canonical_identity_v1(raw_symbol),
        predecessor_fact_digest: None,
        mappings: vec![InstrumentVenueSourceMappingSubmissionV1 {
            venue_identity: BINANCE_PERPETUAL_VENUE_IDENTITY_V1.to_owned(),
            source_identity: BINANCE_PERPETUAL_SOURCE_IDENTITY_V1.to_owned(),
            source_instrument: raw_symbol.as_bytes().to_vec(),
        }],
        instrument_class: "CRYPTO_PERPETUAL".to_owned(),
        base_currency: Some(base_currency),
        quote_currency: Some(quote_currency),
        settlement_currency: Some(margin_currency.clone()),
        margin_currency: Some(margin_currency),
        price_increment,
        quantity_increment,
        contract_multiplier: InstrumentDecimalSubmissionV1 {
            mantissa: 1,
            scale: 0,
        },
        calendar_identity: "CRYPTO-CONTINUOUS-V1".to_owned(),
        session_identity: "CRYPTO-CONTINUOUS-V1".to_owned(),
        time_zone_identity: "Etc/UTC".to_owned(),
        lifecycle_frontier: binance_perpetual_admission_digest_v1("lifecycle-frontier"),
        corporate_action_frontier: binance_perpetual_admission_digest_v1(
            "corporate-action-frontier",
        ),
        historical_membership_frontier: binance_perpetual_eligible_frontier_v1(
            BINANCE_PERPETUAL_U1_MEMBERS_V1,
        ),
        source_binding: kline_source_binding.clone(),
        effective_from: 1,
        effective_until: None,
        provider_available: observed,
        retrieval: observed,
        correction_publication: observed,
        owner_observation: observed,
    })
}

/// One decimal filter value of the entry's `filters` array, in canonical form (no trailing zero
/// at a nonzero scale).
fn filter_decimal(
    filters: &[Value],
    filter_type: &str,
    field: &str,
) -> Result<InstrumentDecimalSubmissionV1, BinancePerpetualAdmissionErrorV1> {
    let text = filters
        .iter()
        .find(|filter| filter["filterType"] == filter_type)
        .and_then(|filter| filter[field].as_str())
        .ok_or(BinancePerpetualAdmissionErrorV1::FilterUnavailable)?;
    let value = Decimal::from_str_exact(text)
        .map_err(|_| BinancePerpetualAdmissionErrorV1::FilterUnavailable)?
        .normalize();
    let mantissa = value.mantissa();
    let scale = u8::try_from(value.scale())
        .map_err(|_| BinancePerpetualAdmissionErrorV1::FilterUnavailable)?;
    Ok(InstrumentDecimalSubmissionV1 { mantissa, scale })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use rstest::rstest;
    use vibe_data::owner::source_binding::UntrustedSourceBindingLocatorFields;

    use super::*;

    /// A real USD-M `exchangeInfo` response, sliced to one entry. Shared with
    /// `first_composer_v3_replay_acceptance.rs`'s fixture of the same bytes.
    const LINKUSDT_EXCHANGE_INFO: &str =
        include_str!("../test_data/futures/http_json/exchange_info_usdm_linkusdt.json");

    fn test_locator(binding_id: BindingDigest) -> UntrustedSourceBindingLocator {
        UntrustedSourceBindingLocator::from_untrusted(UntrustedSourceBindingLocatorFields {
            owner: "market-data".to_owned(),
            lineage_root: binding_id,
            lineage_version: 1,
            predecessor_binding_id: None,
            predecessor_fact_digest: None,
            binding_id,
            fact_digest: binding_id,
            credential_handle_identity: BindingDigest::from_untrusted_bytes([0; 32]),
            credential_audience: UntrustedCredentialAudienceClaim::MarketData,
            credential_capabilities: BTreeSet::new(),
            source_frontier: UntrustedCompleteFrontier {
                stream_identity: "binance/usdm-klines".to_owned(),
                cut_identity: "binance/usdm-klines/cut-1".to_owned(),
                sequence: 1,
                digest: binding_id,
            },
            correction_frontier: UntrustedCompleteFrontier {
                stream_identity: "binance/usdm-klines".to_owned(),
                cut_identity: "binance/usdm-klines/cut-1".to_owned(),
                sequence: 1,
                digest: binding_id,
            },
            time_evidence: UntrustedMarketDataAsOf {
                claimed_evidence_identity: BindingDigest::from_untrusted_bytes([0; 32]),
                clock_identity: String::new(),
                clock_epoch: String::new(),
                monotonic_sequence: 0,
                restart_continuity_digest: BindingDigest::from_untrusted_bytes([0; 32]),
                skew_bound: 0,
                uncertainty_bound: 0,
                event_effective: 1,
                provider_available: 1,
                retrieval: 1,
                correction_publication: 1,
                observed_at: 0,
                effective_at: 1,
                valid_through: 0,
            },
        })
    }

    /// The proposal is deterministic across calls (the fixed effective instant is what makes two
    /// admissions of the same dataset - as admitting two different symbols through this route
    /// does - derive the same binding and rejoin it, instead of minting a second one).
    #[rstest]
    fn kline_proposal_identity_is_deterministic() {
        let first = binance_perpetual_source_proposal(BinancePerpetualDatasetV1::DailyKlines);
        let second = binance_perpetual_source_proposal(BinancePerpetualDatasetV1::DailyKlines);
        assert_eq!(first.claimed_binding_id, second.claimed_binding_id);
    }

    /// The two datasets this route names still derive different binding identities from each
    /// other: different schema, mapping and availability rule.
    #[rstest]
    fn kline_and_exchange_info_proposals_derive_different_identities() {
        let kline = binance_perpetual_source_proposal(BinancePerpetualDatasetV1::DailyKlines);
        let exchange_info =
            binance_perpetual_source_proposal(BinancePerpetualDatasetV1::ExchangeInfo);
        assert_ne!(kline.claimed_binding_id, exchange_info.claimed_binding_id);
    }

    #[rstest]
    fn instrument_master_submission_reads_the_real_filters() {
        let locator = test_locator(BindingDigest::from_untrusted_bytes([7; 32]));
        let submission = binance_perpetual_instrument_master_submission(
            "LINKUSDT",
            LINKUSDT_EXCHANGE_INFO,
            &locator,
            1_790_500_656_000_000_000,
        )
        .expect("the real LINKUSDT entry names a perpetual with both required filters");

        assert_eq!(submission.canonical_identity, "LINKUSDT-PERP.BINANCE");
        assert_eq!(submission.base_currency, Some("LINK".to_owned()));
        assert_eq!(submission.quote_currency, Some("USDT".to_owned()));
        assert_eq!(submission.settlement_currency, Some("USDT".to_owned()));
        assert_eq!(
            submission.historical_membership_frontier,
            binance_perpetual_eligible_frontier_v1(BINANCE_PERPETUAL_U1_MEMBERS_V1),
            "the V1 fact's claimed frontier must be the one the one-time membership step admits into"
        );
    }

    #[rstest]
    fn instrument_master_submission_refuses_an_absent_symbol() {
        let locator = test_locator(BindingDigest::from_untrusted_bytes([7; 32]));
        let error = binance_perpetual_instrument_master_submission(
            "DOGEUSDT",
            LINKUSDT_EXCHANGE_INFO,
            &locator,
            1,
        )
        .expect_err("the fixture names only LINKUSDT");
        assert_eq!(error, BinancePerpetualAdmissionErrorV1::SymbolAbsent);
    }

    #[rstest]
    fn eligible_set_admission_request_names_the_given_lineage_root_and_correction_frontier() {
        let lineage_root = BindingDigest::from_untrusted_bytes([9; 32]);
        let request = binance_perpetual_eligible_set_admission_request_v1(1, lineage_root);
        assert_eq!(
            request.eligible_instrument_frontier,
            binance_perpetual_eligible_frontier_v1(BINANCE_PERPETUAL_U1_MEMBERS_V1)
        );
        assert_eq!(request.members.len(), BINANCE_PERPETUAL_U1_MEMBERS_V1.len());
        let instruments: Vec<&str> = request
            .members
            .iter()
            .map(|member| member.instrument.as_str())
            .collect();
        assert_eq!(
            instruments,
            vec![
                "BTCUSDT-PERP.BINANCE",
                "ETHUSDT-PERP.BINANCE",
                "SOLUSDT-PERP.BINANCE"
            ]
        );

        for member in &request.members {
            assert_eq!(
                member.source_binding_lineage_root, lineage_root,
                "the request carries the caller's real anchored lineage root, not a value it derives itself"
            );
            assert_eq!(
                member.correction_frontier_digest,
                binance_perpetual_admission_digest_v1("correction-frontier")
            );
        }
    }

    #[rstest]
    fn symbol_eligibility_matches_the_fixed_u1_set() {
        for raw_symbol in BINANCE_PERPETUAL_U1_MEMBERS_V1 {
            assert!(binance_perpetual_symbol_is_eligible_v1(raw_symbol));
        }
        assert!(!binance_perpetual_symbol_is_eligible_v1("LINKUSDT"));
        assert!(!binance_perpetual_symbol_is_eligible_v1("DOGEUSDT"));
    }

    /// A different member set derives a different frontier, instead of colliding with
    /// [`BINANCE_PERPETUAL_U1_MEMBERS_V1`]'s manifest.
    #[rstest]
    fn eligible_frontier_depends_on_the_member_set() {
        let full = binance_perpetual_eligible_frontier_v1(BINANCE_PERPETUAL_U1_MEMBERS_V1);
        let one = binance_perpetual_eligible_frontier_v1(&["BTCUSDT"]);
        assert_ne!(full, one);
    }

    /// Order of the input slice does not matter: the frontier is derived from the sorted set.
    #[rstest]
    fn eligible_frontier_is_order_independent() {
        let forward = binance_perpetual_eligible_frontier_v1(&["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
        let reversed = binance_perpetual_eligible_frontier_v1(&["SOLUSDT", "ETHUSDT", "BTCUSDT"]);
        assert_eq!(forward, reversed);
    }
}
