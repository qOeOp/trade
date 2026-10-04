//! An acceptance-only custody chain committed through Market Data's production intakes (slice
//! T0-5d).
//!
//! A multi-frame consumer proof - Strategy Factory's N-frame proof, rd-owner-api's `backtest.run`
//! chain entry - needs a custody chain to read frames from. This module commits one from a
//! synthetic spec, and it writes nothing itself: every row it causes is written by the Owner's own
//! intake, in the order production reaches them.
//!
//! 1. The Source Binding admission admits a synthetic schema 2 binding whose availability rule is
//!    the spec's lag after bar close, publishing no corrections, and which declares the execution and
//!    fill timeframes as continuous fixed intervals labelled at interval close. The admission mints
//!    the Owner clock it is committed on.
//! 2. The Instrument Master V1 admission admits one fact per member, in force from instant 1, on that
//!    clock. A member the store already holds a fact for - an earlier entry of an ordered chain
//!    admitted it - keeps that fact, and the spec's bars must fit its increments.
//! 3. The Universe Selection intake admits the members' historical membership as one frontier, named
//!    for the members and the window, then evaluates the fixed-member selection of exactly those
//!    members.
//! 4. The custody intake commits one root custody: one original cross-section per bar of both
//!    timeframes, retrieved at the bar's availability, over the window from the first execution bar's
//!    open to one execution interval after the last execution bar's close.
//!
//! A malformed spec is refused by the intake it reaches, under that intake's name, never by this
//! module, which refuses only what it cannot state as a submission at all. It names no Research
//! request, Strategy Design or role: the chain it returns is Market Data's alone.
//!
//! It exists only with `sealed-strategy-input-acceptance`, which no deployed binary enables, and only
//! on a disposable loopback `vibe_test_` database. Its output is production code run on synthetic
//! inputs: it is never U1 evidence.

use crate::owner::{
    instrument_master_admission_v1::InstrumentMasterAdmissionErrorV1,
    market_semantics_admission_v1::MarketSemanticsValueSubmissionV1,
    pit_window_custody_v1::{PitWindowCustodyRefusalV1, PitWindowRunRefusalV1},
    source_binding::{BindingDigest, UntrustedSourceBindingLocator},
    source_binding_admission_v1::{
        SourceBindingAdmissionDispositionV1, SourceBindingAdmissionErrorV1,
    },
    universe_selection::UntrustedUniverseSelectionLocatorV1,
    universe_selection_admission_v1::UniverseSelectionAdmissionErrorV1,
};

/// An exact decimal, `mantissa * 10^-scale`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SealedAcceptanceDecimalV1 {
    pub mantissa: i128,
    pub scale: u8,
}

impl SealedAcceptanceDecimalV1 {
    /// The decimal a plain decimal string spells, such as `65000.10` or `-1`, keeping the scale it
    /// is written at. `None` for anything else: a sign without digits, an exponent, a second
    /// point, or a value beyond `i128`.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        let (negative, unsigned) = text
            .strip_prefix('-')
            .map_or((false, text), |rest| (true, rest));
        let (whole, fraction) = unsigned.split_once('.').unwrap_or((unsigned, ""));

        if whole.is_empty()
            || !whole.bytes().all(|byte| byte.is_ascii_digit())
            || !fraction.bytes().all(|byte| byte.is_ascii_digit())
            || (unsigned.contains('.') && fraction.is_empty())
        {
            return None;
        }
        let scale = u8::try_from(fraction.len()).ok()?;
        let magnitude = format!("{whole}{fraction}").parse::<i128>().ok()?;
        Some(Self {
            mantissa: if negative { -magnitude } else { magnitude },
            scale,
        })
    }
}

/// One member's bar values.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SealedAcceptanceOhlcvV1 {
    pub open: SealedAcceptanceDecimalV1,
    pub high: SealedAcceptanceDecimalV1,
    pub low: SealedAcceptanceDecimalV1,
    pub close: SealedAcceptanceDecimalV1,
    pub volume: SealedAcceptanceDecimalV1,
}

/// One bar of a timeframe: its open instant, and each member's values in member order.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SealedAcceptanceBarV1 {
    /// The instant the bar opens, in nanoseconds; it closes one interval later, at the instant its
    /// declaration labels it by.
    pub open_ns: u64,
    /// One value set per member of the spec, in the spec's member order.
    pub members: Vec<SealedAcceptanceOhlcvV1>,
}

/// A timeframe the synthetic binding declares, and every bar of it the custody holds.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SealedAcceptanceTimeframeV1 {
    /// The row timeframe label, such as `1D` or `1H`.
    pub label: String,
    /// The fixed interval the label declares, in seconds, aligned to the Unix epoch.
    pub interval_seconds: u64,
    pub bars: Vec<SealedAcceptanceBarV1>,
}

/// The increments every member's Instrument Master fact states.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SealedAcceptanceInstrumentIncrementsV1 {
    pub price: SealedAcceptanceDecimalV1,
    pub quantity: SealedAcceptanceDecimalV1,
}

impl SealedAcceptanceInstrumentIncrementsV1 {
    /// A price tick of 0.1 and a lot of 0.001.
    pub const DEFAULT: Self = Self {
        price: SealedAcceptanceDecimalV1 {
            mantissa: 1,
            scale: 1,
        },
        quantity: SealedAcceptanceDecimalV1 {
            mantissa: 1,
            scale: 3,
        },
    };
}

/// What [`commit_sealed_acceptance_custody_chain_v1`] commits.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SealedAcceptanceCustodyChainSpecV1 {
    /// The members' canonical Instrument Master identities, one or two, in canonical order.
    pub members: Vec<String>,
    /// The timeframe frames are enumerated from; it is the custody's only input timeframe.
    pub execution_timeframe: SealedAcceptanceTimeframeV1,
    /// The finer timeframe quote cuts are derived from. Its interval must be exactly 60 seconds:
    /// a fill bar's open is its close less one minute, and the custody intake refuses any other
    /// interval as `PIT_WINDOW_FILL_TIMEFRAME_NOT_ONE_MINUTE`.
    pub fill_timeframe: SealedAcceptanceTimeframeV1,
    /// How long after its close a bar becomes available, in nanoseconds.
    pub lag_ns: u64,
    /// [`SealedAcceptanceInstrumentIncrementsV1::DEFAULT`] when `None`.
    pub instrument_increments: Option<SealedAcceptanceInstrumentIncrementsV1>,
    /// A raw, interval-close value with fixture-named unit identities when `None`.
    pub market_semantics_value: Option<MarketSemanticsValueSubmissionV1>,
}

/// The chain [`commit_sealed_acceptance_custody_chain_v1`] committed, as the Owner's intakes and its
/// frames read answered it. It has no public constructor.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SealedAcceptanceCustodyChainV1 {
    pub(crate) chain_root: BindingDigest,
    pub(crate) head_identity: BindingDigest,
    pub(crate) window: (u64, u64),
    pub(crate) source_binding: UntrustedSourceBindingLocator,
    pub(crate) source_binding_lineage_root: BindingDigest,
    pub(crate) market_semantics_identity: BindingDigest,
    pub(crate) universe_selection: UntrustedUniverseSelectionLocatorV1,
    pub(crate) universe_selection_record_identity: BindingDigest,
    pub(crate) universe_selection_record_digest: BindingDigest,
    pub(crate) instrument_fact_digests: Vec<BindingDigest>,
    pub(crate) instrument_master_cut_digest: BindingDigest,
    pub(crate) instrument_master_key: BindingDigest,
    pub(crate) frame_instants_ns: Vec<u64>,
}

impl SealedAcceptanceCustodyChainV1 {
    /// The chain's root custody; a run names the chain by it.
    #[must_use]
    pub const fn chain_root(&self) -> BindingDigest {
        self.chain_root
    }

    /// The chain's head, which is its root: the fixture commits no successor.
    #[must_use]
    pub const fn head_identity(&self) -> BindingDigest {
        self.head_identity
    }

    /// The custody window, `[start, end)` in nanoseconds.
    #[must_use]
    pub const fn window(&self) -> (u64, u64) {
        self.window
    }

    /// The admitted Source Binding the custody names.
    #[must_use]
    pub const fn source_binding(&self) -> &UntrustedSourceBindingLocator {
        &self.source_binding
    }

    /// The Source Binding's lineage root.
    #[must_use]
    pub const fn source_binding_lineage_root(&self) -> BindingDigest {
        self.source_binding_lineage_root
    }

    /// The Market Semantics compatibility identity the binding implies.
    #[must_use]
    pub const fn market_semantics_identity(&self) -> BindingDigest {
        self.market_semantics_identity
    }

    /// The Universe Selection record the custody names, as its locator.
    #[must_use]
    pub const fn universe_selection(&self) -> UntrustedUniverseSelectionLocatorV1 {
        self.universe_selection
    }

    /// The identity of that record, as the evaluation answered it.
    #[must_use]
    pub const fn universe_selection_record_identity(&self) -> BindingDigest {
        self.universe_selection_record_identity
    }

    /// The digest of that record, as the Owner recovers it.
    #[must_use]
    pub const fn universe_selection_record_digest(&self) -> BindingDigest {
        self.universe_selection_record_digest
    }

    /// Each member's admitted Instrument Master V1 fact digest, in member order.
    #[must_use]
    pub fn instrument_fact_digests(&self) -> &[BindingDigest] {
        &self.instrument_fact_digests
    }

    /// The digest of the Instrument Master cut the chain's basis names.
    #[must_use]
    pub const fn instrument_master_cut_digest(&self) -> BindingDigest {
        self.instrument_master_cut_digest
    }

    /// The custody's Instrument Master key over its members' facts.
    #[must_use]
    pub const fn instrument_master_key(&self) -> BindingDigest {
        self.instrument_master_key
    }

    /// Every frame instant `e_k`, ascending: each execution bar's close, as the frames read
    /// answered it over the whole window.
    #[must_use]
    pub fn frame_instants_ns(&self) -> &[u64] {
        &self.frame_instants_ns
    }
}

/// Why no chain was committed, named by the step that refused it. An intake's refusal is that
/// intake's own value.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum SealedAcceptanceCustodyChainErrorV1 {
    /// The Owner URL is not a disposable loopback `vibe_test_` database.
    #[error("the Owner URL is not a disposable loopback vibe_test_ database")]
    NotADisposableStore,
    /// The spec cannot be stated as a submission: no execution bar, a bar whose value count is not
    /// the member count, or an instant or interval that does not fit.
    #[error("the spec cannot be stated as intake submissions")]
    InvalidSpec,
    #[error("the Market Data store is unavailable")]
    StoreUnavailable,
    #[error("the Source Binding admission refused: {0:?}")]
    SourceBindingAdmission(SourceBindingAdmissionErrorV1),
    #[error("the Source Binding admission did not admit the binding: {0:?}")]
    SourceBindingNotAdmitted(SourceBindingAdmissionDispositionV1),
    #[error("the Instrument Master admission refused: {0:?}")]
    InstrumentMasterAdmission(InstrumentMasterAdmissionErrorV1),
    #[error("the historical membership admission refused: {0:?}")]
    HistoricalMembershipAdmission(UniverseSelectionAdmissionErrorV1),
    #[error("the Universe Selection evaluation refused: {0:?}")]
    UniverseSelectionEvaluation(UniverseSelectionAdmissionErrorV1),
    #[error("the custody intake refused: {0}")]
    CustodyCommit(PitWindowCustodyRefusalV1),
    #[error("the custody frames read refused: {0}")]
    CustodyFramesRead(PitWindowRunRefusalV1),
}

/// Commits `spec` as one custody chain on the Market Data Owner store at `owner_url`, through the
/// production intakes this module's documentation lists, and reads its frames back.
///
/// **Acceptance only.** `owner_url` must name a disposable loopback `vibe_test_` database. Each
/// call admits its own Source Binding, so a store holds at most one fixture chain per call; a
/// second call over the same store may be refused by an intake whose scope the first already
/// holds.
///
/// # Errors
///
/// [`SealedAcceptanceCustodyChainErrorV1::NotADisposableStore`] before anything is opened;
/// otherwise the step that refused, with the intake's own refusal.
pub async fn commit_sealed_acceptance_custody_chain_v1(
    owner_url: &str,
    spec: &SealedAcceptanceCustodyChainSpecV1,
) -> Result<SealedAcceptanceCustodyChainV1, SealedAcceptanceCustodyChainErrorV1> {
    if !crate::owner::sealed_acceptance_disposable_owner_url_v1(owner_url) {
        return Err(SealedAcceptanceCustodyChainErrorV1::NotADisposableStore);
    }
    Box::pin(
        crate::owner::postgres::sealed_acceptance_custody_chain_v1::commit_sealed_acceptance_custody_chain_in_store_v1(
            owner_url, spec,
        ),
    )
    .await
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::{
        SealedAcceptanceCustodyChainErrorV1, SealedAcceptanceCustodyChainSpecV1,
        SealedAcceptanceDecimalV1, SealedAcceptanceTimeframeV1,
        commit_sealed_acceptance_custody_chain_v1,
    };

    /// The fixture opens only a disposable loopback `vibe_test_` database, refusing any other
    /// before it connects: the URLs below name no reachable store.
    #[rstest]
    #[case::empty("")]
    #[case::a_remote_host("postgresql://owner@db.example/vibe_test_decoy")]
    #[case::a_hostaddr_override("postgresql://owner@127.0.0.1/vibe_test_decoy?hostaddr=192.0.2.1")]
    #[case::not_disposable("postgresql://owner@127.0.0.1/market_data")]
    #[tokio::test]
    async fn the_fixture_opens_only_a_disposable_database(#[case] url: &str) {
        let timeframe = |label: &str| SealedAcceptanceTimeframeV1 {
            label: label.to_owned(),
            interval_seconds: 60,
            bars: Vec::new(),
        };
        let spec = SealedAcceptanceCustodyChainSpecV1 {
            members: vec!["BTCUSDT-PERP.BINANCE".to_owned()],
            execution_timeframe: timeframe("1D"),
            fill_timeframe: timeframe("1M"),
            lag_ns: 0,
            instrument_increments: None,
            market_semantics_value: None,
        };
        assert_eq!(
            commit_sealed_acceptance_custody_chain_v1(url, &spec)
                .await
                .map(|_| ()),
            Err(SealedAcceptanceCustodyChainErrorV1::NotADisposableStore)
        );
    }

    #[rstest]
    #[case("65000.10", Some((6_500_010, 2)))]
    #[case("-1", Some((-1, 0)))]
    #[case("0.001", Some((1, 3)))]
    #[case("", None)]
    #[case("-", None)]
    #[case("1.", None)]
    #[case(".5", None)]
    #[case("1e3", None)]
    #[case("1.2.3", None)]
    fn a_decimal_string_keeps_the_scale_it_is_written_at(
        #[case] text: &str,
        #[case] expected: Option<(i128, u8)>,
    ) {
        assert_eq!(
            SealedAcceptanceDecimalV1::parse(text).map(|value| (value.mantissa, value.scale)),
            expected
        );
    }
}
