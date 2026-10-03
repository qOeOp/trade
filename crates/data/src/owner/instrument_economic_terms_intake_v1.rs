//! Production intake of the Instrument Owner's private economic terms for a Binance USDⓈ-M
//! perpetual.
//!
//! Operations names an instrument's admitted Instrument Master V2 fact, the account scope the
//! terms apply to and the end of their validity. Everything else the Owner states itself: the
//! instrument, its public fact digest, venue, quote and fee currency, the start of validity and the
//! source digest from that fact, and the fee and margin rates from the two tables below, which are
//! the only definitions of those values.
//!
//! The rates are public defaults, not an account's own: maker and taker fees are the regular (VIP
//! 0) schedule, and margin is the venue's first leverage bracket, which holds only up to that
//! bracket's notional cap. A fact issued here says so in its `source_identity` and in its
//! `FIRST_BRACKET_NOTIONAL_RATE` meaning, which carries the cap.

use std::fmt::{Debug, Display};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::instrument_economic_terms_v1::{
    INSTRUMENT_ECONOMIC_TERMS_SCHEMA_VERSION_V1, InstrumentEconomicAccountApplicabilityV1,
    InstrumentEconomicDecimalV1, InstrumentEconomicTermsErrorV1, InstrumentEconomicTermsFactV1,
    InstrumentEconomicTermsInputV1, InstrumentEconomicTermsReadbackV1, InstrumentMarginMeaningV1,
};
use super::instrument_master_v2::{FactValue, InstrumentMasterFactV2};
use super::source_binding::BindingDigest;

/// The one venue whose public defaults the tables below state.
pub const ECONOMIC_TERMS_VENUE_V1: &str = "BINANCE";

/// Names the defaults a fact issued here was derived from, so a report or Qualification reading
/// the fact can tell them from an account's own rates.
pub const ECONOMIC_TERMS_SOURCE_IDENTITY_V1: &str =
    "binance-usdm-public-default-vip0-fees-and-first-leverage-bracket-2026-10-03";

/// The revision every fact issued from these tables carries. A change to either table is a new
/// revision, issued for a validity that does not overlap the earlier one's: the Native Replay
/// resolver refuses an instrument with two facts valid at one instant.
pub const ECONOMIC_TERMS_TABLE_REVISION_V1: u64 = 1;

const fn decimal(mantissa: i128, scale: u8) -> InstrumentEconomicDecimalV1 {
    InstrumentEconomicDecimalV1 { mantissa, scale }
}

/// Binance USDⓈ-M regular user (VIP 0) maker fee, 0.0200%.
///
/// Source: the user confirmed maker 0.0200% / taker 0.0500% for USDⓈ-M perpetuals on 2026-10-03
/// (relayed: asked through `AskUserQuestion` in the Lane 3 session). The public fee pages
/// (`https://www.binance.com/en/fee/futureFee`, FAQ 360033544231) answer an automated client with
/// an empty challenge page, so the values could not be read back with curl.
pub const BINANCE_USDM_VIP0_MAKER_FEE_V1: InstrumentEconomicDecimalV1 = decimal(2, 4);

/// Binance USDⓈ-M regular user (VIP 0) taker fee, 0.0500%. Same source as the maker fee.
pub const BINANCE_USDM_VIP0_TAKER_FEE_V1: InstrumentEconomicDecimalV1 = decimal(5, 4);

/// One instrument's first leverage bracket on Binance USDⓈ-M.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FirstLeverageBracketV1 {
    /// The instrument's Instrument Master canonical identity.
    pub canonical_identity: &'static str,
    /// `bracketNotionalCap`: the largest position notional, in USDT, the bracket covers.
    pub notional_cap: InstrumentEconomicDecimalV1,
    /// `bracketMaintenanceMarginRate`.
    pub maintenance_margin: InstrumentEconomicDecimalV1,
    /// `maxOpenPosLeverage`.
    pub max_leverage: u32,
    /// `1 / maxOpenPosLeverage`, rounded up at the sixth decimal place, so that a rate the base
    /// ten cannot state exactly is never understated. A test recomputes it from `max_leverage`.
    pub initial_margin: InstrumentEconomicDecimalV1,
}

/// Binance USDⓈ-M first leverage brackets, one row per instrument terms are issued for.
///
/// Source: `POST https://www.binance.com/bapi/futures/v1/public/future/common/brackets` with body
/// `{"symbol":"<raw symbol>"}`, a public endpoint read without credentials, fetched
/// 2026-10-02T19:09:01Z (Lane 3). Each row is the response's `riskBrackets[0]`.
///
/// The venue changes its brackets without notice, and nothing here notices: these rows are
/// maintained by hand. Adding an instrument is adding a row with its source; an instrument with
/// no row is refused as `ECONOMIC_TERMS_MARGIN_BRACKET_UNLISTED`.
pub const BINANCE_USDM_FIRST_LEVERAGE_BRACKETS_V1: [FirstLeverageBracketV1; 4] = [
    FirstLeverageBracketV1 {
        canonical_identity: "BTCUSDT-PERP.BINANCE",
        notional_cap: decimal(300_000, 0),
        maintenance_margin: decimal(4, 3),
        max_leverage: 150,
        initial_margin: decimal(6_667, 6),
    },
    FirstLeverageBracketV1 {
        canonical_identity: "ETHUSDT-PERP.BINANCE",
        notional_cap: decimal(300_000, 0),
        maintenance_margin: decimal(4, 3),
        max_leverage: 150,
        initial_margin: decimal(6_667, 6),
    },
    FirstLeverageBracketV1 {
        canonical_identity: "SOLUSDT-PERP.BINANCE",
        notional_cap: decimal(50_000, 0),
        maintenance_margin: decimal(5, 3),
        max_leverage: 100,
        initial_margin: decimal(1, 2),
    },
    FirstLeverageBracketV1 {
        canonical_identity: "LINKUSDT-PERP.BINANCE",
        notional_cap: decimal(10_000, 0),
        maintenance_margin: decimal(5, 3),
        max_leverage: 75,
        initial_margin: decimal(13_334, 6),
    },
];

/// The first bracket recorded for `canonical_identity`, if any.
#[must_use]
pub fn first_leverage_bracket_v1(
    canonical_identity: &str,
) -> Option<&'static FirstLeverageBracketV1> {
    BINANCE_USDM_FIRST_LEVERAGE_BRACKETS_V1
        .iter()
        .find(|row| row.canonical_identity == canonical_identity)
}

/// What Operations states to issue one instrument's terms.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InstrumentEconomicTermsSubmissionV1 {
    /// The instrument's Instrument Master canonical identity, `<raw symbol>-PERP.BINANCE`.
    pub canonical_identity: String,
    /// The admitted Instrument Master V2 fact the terms are issued for. Its identity becomes the
    /// fact's public fact digest, which is what the Native Replay resolver matches a cut member
    /// against.
    pub instrument_fact_identity: BindingDigest,
    /// The account scope the terms apply to. The Owner cannot verify it: it is the caller's
    /// statement, and the trust boundary is the credential that reaches this intake.
    pub account_scope_identity: String,
    /// The exclusive end of validity, in nanoseconds. It must be bounded and later than Market
    /// Data's clock head; validity starts at the instrument's listing.
    pub valid_until_ns_exclusive: i128,
}

/// The issued terms' locator and what they were issued for.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InstrumentEconomicTermsAdmissionTerminalV1 {
    pub fact_identity: BindingDigest,
    pub receipt_identity: BindingDigest,
    pub canonical_identity: String,
    pub instrument_public_fact_digest: BindingDigest,
    pub account_scope_identity: String,
    pub valid_from_ns: i128,
    pub valid_until_ns_exclusive: i128,
    pub revision: u64,
}

impl InstrumentEconomicTermsAdmissionTerminalV1 {
    pub(crate) fn from_readback(readback: &InstrumentEconomicTermsReadbackV1) -> Self {
        let input = readback.fact().input();
        Self {
            fact_identity: BindingDigest::from_untrusted_bytes(readback.fact().identity()),
            receipt_identity: BindingDigest::from_untrusted_bytes(readback.receipt_identity()),
            canonical_identity: input.instrument_identity.clone(),
            instrument_public_fact_digest: BindingDigest::from_untrusted_bytes(
                input.instrument_public_fact_digest,
            ),
            account_scope_identity: input.account_scope_identity.clone(),
            valid_from_ns: input.valid_from_ns,
            valid_until_ns_exclusive: input.valid_until_ns_exclusive,
            revision: input.revision,
        }
    }
}

/// Why no terms were issued. Each refusal leaves both stores as they were.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstrumentEconomicTermsAdmissionErrorV1 {
    /// No Instrument Master V2 fact with that identity is held for that canonical identity.
    InstrumentFactUnavailable,
    /// The fact's venue is not the one the tables state defaults for.
    VenueNotAdmitted,
    /// The instrument has no recorded first leverage bracket.
    MarginBracketUnlisted,
    /// The fact states no quote or settlement currency, or they differ: the fee is charged in the
    /// settlement currency and the terms admit only a fee in the quote currency.
    CurrencyUnavailable,
    /// The end of validity is not a bounded instant.
    ValidityUnbounded,
    /// The end of validity is not later than Market Data's clock head.
    ValidityNotAfterClockHead,
    /// The derived terms do not seal; the payload is the reason.
    TermsInvalid(InstrumentEconomicTermsErrorV1),
    /// Terms with the same meaning are held with other bytes.
    MeaningConflict,
    /// Market Data holds no clock head.
    ClockUnavailable,
    /// A store could not be read or written.
    StoreUnavailable,
}

impl Display for InstrumentEconomicTermsAdmissionErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InstrumentFactUnavailable => {
                formatter.write_str("no Instrument Master V2 fact is held under that identity")
            }
            Self::VenueNotAdmitted => {
                formatter.write_str("the fact's venue has no recorded default economic terms")
            }
            Self::MarginBracketUnlisted => {
                formatter.write_str("the instrument has no recorded first leverage bracket")
            }
            Self::CurrencyUnavailable => {
                formatter.write_str("the fact states no single quote and settlement currency")
            }
            Self::ValidityUnbounded => formatter.write_str("the end of validity is unbounded"),
            Self::ValidityNotAfterClockHead => formatter
                .write_str("the end of validity is not later than Market Data's clock head"),
            Self::TermsInvalid(reason) => {
                write!(formatter, "the derived terms are invalid: {reason}")
            }
            Self::MeaningConflict => {
                formatter.write_str("terms with this meaning are held with other bytes")
            }
            Self::ClockUnavailable => formatter.write_str("Market Data holds no clock head"),
            Self::StoreUnavailable => formatter.write_str("a store is unavailable"),
        }
    }
}

impl std::error::Error for InstrumentEconomicTermsAdmissionErrorV1 {}

/// The latest instant a bounded end of validity may name: the last nanosecond an `i64` count
/// from the epoch reaches, in 2262. Anything later is taken for an open bound.
const LATEST_BOUNDED_INSTANT_NS: i128 = i64::MAX as i128;

/// Derives the terms Operations asks for from the verified Instrument Master V2 `fact` and the
/// tables above, refusing by name anything they cannot state.
///
/// `clock_head_ns` is the decision cut of Market Data's clock head, read in the snapshot `fact`
/// was read in.
///
/// # Errors
///
/// Returns the refusal that applies; nothing is derived for a refused submission.
pub fn derive_instrument_economic_terms_v1(
    fact: &InstrumentMasterFactV2,
    submission: &InstrumentEconomicTermsSubmissionV1,
    clock_head_ns: i128,
) -> Result<InstrumentEconomicTermsFactV1, InstrumentEconomicTermsAdmissionErrorV1> {
    use InstrumentEconomicTermsAdmissionErrorV1 as Refused;

    if fact.canonical_identity() != submission.canonical_identity
        || fact.identity() != submission.instrument_fact_identity
    {
        return Err(Refused::InstrumentFactUnavailable);
    }

    if fact.venue_identity() != ECONOMIC_TERMS_VENUE_V1 {
        return Err(Refused::VenueNotAdmitted);
    }
    let bracket = first_leverage_bracket_v1(fact.canonical_identity())
        .ok_or(Refused::MarginBracketUnlisted)?;
    let terms = fact.terms();
    let (FactValue::Value(quote), FactValue::Value(settlement)) =
        (&terms.quote_currency, &terms.settlement_currency)
    else {
        return Err(Refused::CurrencyUnavailable);
    };

    if quote != settlement {
        return Err(Refused::CurrencyUnavailable);
    }

    if submission.valid_until_ns_exclusive > LATEST_BOUNDED_INSTANT_NS {
        return Err(Refused::ValidityUnbounded);
    }

    if submission.valid_until_ns_exclusive <= clock_head_ns {
        return Err(Refused::ValidityNotAfterClockHead);
    }
    let provenance = fact.baseline_provenance();
    InstrumentEconomicTermsFactV1::seal(InstrumentEconomicTermsInputV1 {
        schema_version: INSTRUMENT_ECONOMIC_TERMS_SCHEMA_VERSION_V1,
        instrument_identity: fact.canonical_identity().to_owned(),
        instrument_public_fact_digest: *fact.identity().as_bytes(),
        venue_identity: ECONOMIC_TERMS_VENUE_V1.to_owned(),
        account_scope_identity: submission.account_scope_identity.clone(),
        account_applicability: InstrumentEconomicAccountApplicabilityV1::MarginAccount,
        valid_from_ns: provenance.effective_from_ns,
        valid_until_ns_exclusive: submission.valid_until_ns_exclusive,
        source_identity: ECONOMIC_TERMS_SOURCE_IDENTITY_V1.to_owned(),
        source_digest: *provenance.raw_payload_digest.as_bytes(),
        provenance_digest: tables_digest(bracket),
        revision: ECONOMIC_TERMS_TABLE_REVISION_V1,
        quote_currency: quote.clone(),
        fee_currency: settlement.clone(),
        maker_fee: BINANCE_USDM_VIP0_MAKER_FEE_V1,
        taker_fee: BINANCE_USDM_VIP0_TAKER_FEE_V1,
        initial_margin: bracket.initial_margin,
        maintenance_margin: bracket.maintenance_margin,
        margin_meaning: InstrumentMarginMeaningV1::FirstBracketNotionalRate,
        margin_notional_cap: Some(bracket.notional_cap),
    })
    .map_err(Refused::TermsInvalid)
}

/// Binds the table rows a fact was derived from, so two facts derived from different rows cannot
/// share a provenance digest.
fn tables_digest(bracket: &FirstLeverageBracketV1) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"instrument-owner.economic-terms-intake.tables.v1\0");
    hasher.update(ECONOMIC_TERMS_SOURCE_IDENTITY_V1.as_bytes());
    hasher.update(ECONOMIC_TERMS_TABLE_REVISION_V1.to_be_bytes());

    for value in [
        BINANCE_USDM_VIP0_MAKER_FEE_V1,
        BINANCE_USDM_VIP0_TAKER_FEE_V1,
        bracket.notional_cap,
        bracket.maintenance_margin,
        bracket.initial_margin,
    ] {
        hasher.update(value.mantissa.to_be_bytes());
        hasher.update([value.scale]);
    }
    hasher.update(bracket.canonical_identity.as_bytes());
    hasher.update(bracket.max_leverage.to_be_bytes());
    hasher.finalize().into()
}

/// The sole production writer of Instrument Owner economic terms.
#[async_trait::async_trait]
pub trait InstrumentEconomicTermsAdmissionV1: Send + Sync + sealed::Sealed {
    /// Issues the terms for one admitted Instrument Master V2 fact, or refuses them. Issuing the
    /// same submission again rejoins the same terms.
    ///
    /// # Errors
    ///
    /// Returns one documented refusal only when nothing was issued.
    async fn admit_terms(
        &self,
        submission: InstrumentEconomicTermsSubmissionV1,
    ) -> Result<InstrumentEconomicTermsAdmissionTerminalV1, InstrumentEconomicTermsAdmissionErrorV1>;
}

pub(crate) mod sealed {
    pub trait Sealed {}
}

impl Debug for dyn InstrumentEconomicTermsAdmissionV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("InstrumentEconomicTermsAdmissionV1")
    }
}

/// Opens the sole configured economic-terms intake.
///
/// The deployment configuration root chooses both stores: Market Data's through
/// `MARKET_DATA_OWNER_DATABASE_URL`, whose Instrument Master V2 fact and clock head the terms are
/// derived from, and the Instrument Owner's through `INSTRUMENT_OWNER_DATABASE_URL`, which holds
/// the terms.
///
/// # Errors
///
/// Returns a redacted configuration or store failure without attempting a default database.
pub async fn instrument_economic_terms_admission_from_environment_v1() -> Result<
    std::sync::Arc<dyn InstrumentEconomicTermsAdmissionV1>,
    InstrumentEconomicTermsAdmissionErrorV1,
> {
    super::postgres::instrument_economic_terms_admission_from_environment_v1().await
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    /// Each row's initial margin is `1 / max_leverage` rounded up at the sixth decimal place, and
    /// is stated canonically.
    #[rstest]
    fn each_initial_margin_is_the_reciprocal_of_the_maximum_leverage_rounded_up() {
        for row in BINANCE_USDM_FIRST_LEVERAGE_BRACKETS_V1 {
            let leverage = i128::from(row.max_leverage);
            let millionths = (1_000_000 + leverage - 1) / leverage;
            let mut expected = decimal(millionths, 6);

            while expected.scale > 0 && expected.mantissa % 10 == 0 {
                expected = decimal(expected.mantissa / 10, expected.scale - 1);
            }
            assert_eq!(row.initial_margin, expected, "{}", row.canonical_identity);
            assert!(
                row.initial_margin.mantissa * i128::from(row.max_leverage)
                    >= 10_i128.pow(u32::from(row.initial_margin.scale)),
                "{} understates 1/{}",
                row.canonical_identity,
                row.max_leverage
            );
        }
    }

    /// One row per instrument, and each instrument is a `-PERP.BINANCE` canonical identity.
    #[rstest]
    fn the_bracket_table_names_each_instrument_once_by_canonical_identity() {
        for (index, row) in BINANCE_USDM_FIRST_LEVERAGE_BRACKETS_V1.iter().enumerate() {
            assert!(row.canonical_identity.ends_with("-PERP.BINANCE"));
            assert_eq!(
                first_leverage_bracket_v1(row.canonical_identity),
                Some(&BINANCE_USDM_FIRST_LEVERAGE_BRACKETS_V1[index])
            );
        }
        assert_eq!(first_leverage_bracket_v1("DOGEUSDT-PERP.BINANCE"), None);
    }

    /// The inherited Binance adapter's recorded USD-M `exchangeInfo` response, whose one
    /// perpetual is `BTCUSDT`, listed at 1569398400000 ms.
    const USDM: &[u8] = include_bytes!(
        "../../../adapters/binance/test_data/futures/http_json/exchange_info_usdm.json"
    );
    const BTCUSDT_ONBOARD_NS: i128 = 1_569_398_400_000 * 1_000_000;
    const CLOCK_HEAD_NS: i128 = 1_790_000_000_500_000_000;

    /// The `BTCUSDT` baseline fact, after `edit` is applied to its entry.
    fn fact(edit: impl FnOnce(&mut serde_json::Value)) -> InstrumentMasterFactV2 {
        use crate::owner::instrument_master_v2::{
            ExchangeInfoBaselineV2, ExchangeInfoRetrievalV2, instrument_master_venue_v2,
        };

        let mut root: serde_json::Value = serde_json::from_slice(USDM).unwrap();
        let entry = root["symbols"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|entry| entry["symbol"] == "BTCUSDT")
            .unwrap();
        edit(entry);
        let raw_symbol = entry["symbol"].as_str().unwrap().to_owned();
        InstrumentMasterFactV2::from_exchange_info_baseline(
            ExchangeInfoBaselineV2::from_usdm_exchange_info(
                &serde_json::to_vec(&root).unwrap(),
                &raw_symbol,
                instrument_master_venue_v2("usdm/exchangeInfo").unwrap(),
                ExchangeInfoRetrievalV2 {
                    source_binding_identity: BindingDigest::from_untrusted_bytes([7; 32]),
                    source_binding_digest: BindingDigest::from_untrusted_bytes([8; 32]),
                    retrieval_time_ns: CLOCK_HEAD_NS - 500_000_000,
                    owner_observation_time_ns: CLOCK_HEAD_NS,
                },
            )
            .unwrap(),
        )
        .unwrap()
    }

    fn submission(fact: &InstrumentMasterFactV2) -> InstrumentEconomicTermsSubmissionV1 {
        InstrumentEconomicTermsSubmissionV1 {
            canonical_identity: fact.canonical_identity().to_owned(),
            instrument_fact_identity: fact.identity(),
            account_scope_identity: "rdq-research-margin".to_owned(),
            valid_until_ns_exclusive: CLOCK_HEAD_NS + 1,
        }
    }

    /// Everything but the account scope and the end of validity comes from the fact and the
    /// tables, and the margin rates are stated only up to the first bracket's cap.
    #[rstest]
    fn the_terms_are_the_facts_and_the_tables() {
        let fact = fact(|_| {});
        let terms =
            derive_instrument_economic_terms_v1(&fact, &submission(&fact), CLOCK_HEAD_NS).unwrap();
        let input = terms.input();
        let btc = first_leverage_bracket_v1("BTCUSDT-PERP.BINANCE").unwrap();

        assert_eq!(input.instrument_identity, "BTCUSDT-PERP.BINANCE");
        assert_eq!(
            input.instrument_public_fact_digest,
            *fact.identity().as_bytes()
        );
        assert_eq!(input.venue_identity, "BINANCE");
        assert_eq!(input.account_scope_identity, "rdq-research-margin");
        assert_eq!(input.valid_from_ns, BTCUSDT_ONBOARD_NS);
        assert_eq!(input.valid_until_ns_exclusive, CLOCK_HEAD_NS + 1);
        assert_eq!(
            input.source_digest,
            *fact.baseline_provenance().raw_payload_digest.as_bytes()
        );
        assert_eq!(input.source_identity, ECONOMIC_TERMS_SOURCE_IDENTITY_V1);
        assert_eq!(input.revision, ECONOMIC_TERMS_TABLE_REVISION_V1);
        assert_eq!(
            (input.quote_currency.as_str(), input.fee_currency.as_str()),
            ("USDT", "USDT")
        );
        assert_eq!(
            (input.maker_fee, input.taker_fee),
            (decimal(2, 4), decimal(5, 4))
        );
        assert_eq!(
            (input.initial_margin, input.maintenance_margin),
            (btc.initial_margin, btc.maintenance_margin)
        );
        assert_eq!(
            input.margin_meaning,
            InstrumentMarginMeaningV1::FirstBracketNotionalRate
        );
        assert_eq!(input.margin_notional_cap, Some(decimal(300_000, 0)));
    }

    #[rstest]
    #[case::another_fact(|s: &mut InstrumentEconomicTermsSubmissionV1| s.instrument_fact_identity = BindingDigest::from_untrusted_bytes([9; 32]), InstrumentEconomicTermsAdmissionErrorV1::InstrumentFactUnavailable)]
    #[case::another_instrument(|s: &mut InstrumentEconomicTermsSubmissionV1| s.canonical_identity = "ETHUSDT-PERP.BINANCE".to_owned(), InstrumentEconomicTermsAdmissionErrorV1::InstrumentFactUnavailable)]
    #[case::open_end(|s: &mut InstrumentEconomicTermsSubmissionV1| s.valid_until_ns_exclusive = i128::MAX, InstrumentEconomicTermsAdmissionErrorV1::ValidityUnbounded)]
    #[case::past_the_last_bounded_instant(|s: &mut InstrumentEconomicTermsSubmissionV1| s.valid_until_ns_exclusive = i128::from(i64::MAX) + 1, InstrumentEconomicTermsAdmissionErrorV1::ValidityUnbounded)]
    #[case::at_the_clock_head(|s: &mut InstrumentEconomicTermsSubmissionV1| s.valid_until_ns_exclusive = CLOCK_HEAD_NS, InstrumentEconomicTermsAdmissionErrorV1::ValidityNotAfterClockHead)]
    #[case::blank_account_scope(|s: &mut InstrumentEconomicTermsSubmissionV1| s.account_scope_identity = " ".to_owned(), InstrumentEconomicTermsAdmissionErrorV1::TermsInvalid(InstrumentEconomicTermsErrorV1::InvalidIdentity))]
    fn a_submission_the_fact_or_the_clock_refuses_is_refused_by_name(
        #[case] edit: fn(&mut InstrumentEconomicTermsSubmissionV1),
        #[case] refused: InstrumentEconomicTermsAdmissionErrorV1,
    ) {
        let fact = fact(|_| {});
        let mut submission = submission(&fact);
        edit(&mut submission);
        assert_eq!(
            derive_instrument_economic_terms_v1(&fact, &submission, CLOCK_HEAD_NS),
            Err(refused)
        );
    }

    /// An instrument the bracket table has no row for, and one settled in another currency than it
    /// is quoted in, are refused rather than given a neighbour's rates.
    #[rstest]
    #[case::unlisted(|entry: &mut serde_json::Value| entry["symbol"] = "DOGEUSDT".into(), InstrumentEconomicTermsAdmissionErrorV1::MarginBracketUnlisted)]
    #[case::settled_in_another_currency(|entry: &mut serde_json::Value| entry["marginAsset"] = "BTC".into(), InstrumentEconomicTermsAdmissionErrorV1::CurrencyUnavailable)]
    fn an_instrument_the_tables_do_not_state_is_refused_by_name(
        #[case] edit: fn(&mut serde_json::Value),
        #[case] refused: InstrumentEconomicTermsAdmissionErrorV1,
    ) {
        let fact = fact(edit);
        assert_eq!(
            derive_instrument_economic_terms_v1(&fact, &submission(&fact), CLOCK_HEAD_NS),
            Err(refused)
        );
    }

    #[rstest]
    fn each_refusal_reads_differently() {
        use InstrumentEconomicTermsAdmissionErrorV1 as Refused;

        let refusals = [
            Refused::InstrumentFactUnavailable,
            Refused::VenueNotAdmitted,
            Refused::MarginBracketUnlisted,
            Refused::CurrencyUnavailable,
            Refused::ValidityUnbounded,
            Refused::ValidityNotAfterClockHead,
            Refused::TermsInvalid(InstrumentEconomicTermsErrorV1::InvalidIdentity),
            Refused::MeaningConflict,
            Refused::ClockUnavailable,
            Refused::StoreUnavailable,
        ];
        let texts = refusals
            .iter()
            .map(ToString::to_string)
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(texts.len(), refusals.len());
    }
}
