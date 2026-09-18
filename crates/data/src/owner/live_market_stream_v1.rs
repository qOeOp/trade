//! The Owner-sealed intake that turns a venue's stream into facts a Strategy Instance may consume.
//!
//! One channel is one admitted Source Binding, one set of instruments, one field. The Owner opens
//! it, and from then on every fact it hands over is stamped by the Owner: the binding identity and
//! lineage, the binding's Market Semantics Compatibility identity, and a sequence that strictly
//! advances. A venue that answers for an instrument outside the channel is refused rather than
//! normalised, because a channel that quietly widened would let a strategy consume a fact its
//! generation was never bound to.
//!
//! The head is durable for one reason: a restart must hand over from where it stopped. Without it
//! the Owner would either replay facts a strategy already acted on, or renumber them, and a
//! consumer that ordered its own state by that sequence could not tell the difference.

use std::{
    fmt::{Debug, Display},
    sync::Arc,
};

use async_trait::async_trait;

use super::{
    live_market_fact_v1::{
        LiveMarketFactSourceErrorV1, LiveMarketFactSourceV1, LiveMarketFactV1,
        LiveMarketSealRefusalV1, LiveMarketSubscriptionV1,
    },
    source_binding::{BindingDigest, UntrustedSourceBindingLocator},
    strategy_input_binding::{MarketDataFieldSemantic, StrategyInputChannel},
};

/// What Operations asks the Owner to open.
///
/// It names the admitted binding and proposes what to carry. It cannot name a lineage, a semantics
/// identity or a sequence: those are what the Owner resolves and stamps. Nor does proposing an
/// instrument put it on the channel. The Owner issues the subscription from the Instrument Master
/// facts it holds for those candidates, and a candidate it cannot vouch for is refused rather than
/// carried.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LiveMarketChannelRequestV1 {
    /// The admitted Source Binding the stream runs on.
    pub source_binding: UntrustedSourceBindingLocator,
    /// The canonical instruments proposed for the channel.
    pub proposed_instruments: Vec<String>,
    /// The channel the facts belong to.
    pub channel: StrategyInputChannel,
    /// The field the facts measure.
    pub field_semantic: MarketDataFieldSemantic,
}

/// Why a channel could not be opened, or could not continue.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LiveMarketChannelErrorV1 {
    /// The request names no instrument, or one the Owner cannot carry.
    InvalidRequest,
    /// The binding is not this Owner's, is superseded, or is not admitted.
    BindingUnavailable,
    /// No Instrument Master fact this Owner holds covers a proposed instrument right now.
    InstrumentUnavailable,
    /// Another channel with this identity is already open in this process.
    ChannelBusy,
    /// The venue is unreachable or closed the stream.
    SourceUnavailable,
    /// The venue answered for something outside the subscription the Owner issued.
    SourceOutOfScope,
    /// The venue answered in a shape the Data Client cannot read as a value.
    SourceUndecodable,
    /// The observation's own instants contradict each other, so it has no place in time.
    ObservationAmbiguous,
    /// The Owner store is unreachable or refused the head.
    StoreUnavailable,
    /// The stored head does not verify against the channel it claims to belong to.
    StoreUntrusted,
}

impl Display for LiveMarketChannelErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            Self::InvalidRequest => "the live channel request names nothing this Owner can carry",
            Self::BindingUnavailable => "the request names no admitted Source Binding",
            Self::InstrumentUnavailable => {
                "no Instrument Master fact covers a proposed instrument now"
            }
            Self::ChannelBusy => "this live channel is already open in this process",
            Self::SourceUnavailable => "the venue stream is unavailable",
            Self::SourceOutOfScope => "the venue answered outside the subscription",
            Self::SourceUndecodable => "the venue answered an unreadable value",
            Self::ObservationAmbiguous => "the observation's own instants contradict each other",
            Self::StoreUnavailable => "the Market Data store is unavailable",
            Self::StoreUntrusted => "the stored channel head does not verify",
        };
        formatter.write_str(text)
    }
}

impl std::error::Error for LiveMarketChannelErrorV1 {}

impl From<LiveMarketFactSourceErrorV1> for LiveMarketChannelErrorV1 {
    /// Kept exhaustive on purpose: a category added to the vendor seam must be given an Operations
    /// meaning here, not silently become one more reason to reconnect.
    fn from(error: LiveMarketFactSourceErrorV1) -> Self {
        match error {
            LiveMarketFactSourceErrorV1::ScopeUnusable => Self::InvalidRequest,
            LiveMarketFactSourceErrorV1::ScopeMismatch => Self::SourceOutOfScope,
            LiveMarketFactSourceErrorV1::Undecodable => Self::SourceUndecodable,
            LiveMarketFactSourceErrorV1::Unavailable => Self::SourceUnavailable,
        }
    }
}

impl From<LiveMarketSealRefusalV1> for LiveMarketChannelErrorV1 {
    fn from(refusal: LiveMarketSealRefusalV1) -> Self {
        match refusal {
            LiveMarketSealRefusalV1::OutOfScope => Self::SourceOutOfScope,
            LiveMarketSealRefusalV1::AmbiguousInstants => Self::ObservationAmbiguous,
            LiveMarketSealRefusalV1::UndecodableValue => Self::SourceUndecodable,
            // The Owner asked itself for a sequence it may not issue. Nothing about the venue or
            // the request explains that, so it is reported as custody that does not verify.
            LiveMarketSealRefusalV1::OwnerSequenceInvalid => Self::StoreUntrusted,
        }
    }
}

/// Where one channel had got to when the Owner last handed a fact over.
///
/// A consumer never sees this. It exists so the Owner can answer, after a restart, the only
/// question that matters for an ordered stream: which sequence did I last issue?
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LiveMarketChannelHeadV1 {
    channel_identity: BindingDigest,
    owner_sequence: u64,
    last_fact_identity: Option<BindingDigest>,
}

impl LiveMarketChannelHeadV1 {
    pub(crate) const fn seal(
        channel_identity: BindingDigest,
        owner_sequence: u64,
        last_fact_identity: Option<BindingDigest>,
    ) -> Self {
        Self {
            channel_identity,
            owner_sequence,
            last_fact_identity,
        }
    }

    /// The channel this head belongs to.
    #[must_use]
    pub const fn channel_identity(&self) -> BindingDigest {
        self.channel_identity
    }

    /// The last sequence the Owner issued, zero when it has issued none.
    #[must_use]
    pub const fn owner_sequence(&self) -> u64 {
        self.owner_sequence
    }

    /// The last fact the Owner issued, absent when it has issued none.
    #[must_use]
    pub const fn last_fact_identity(&self) -> Option<BindingDigest> {
        self.last_fact_identity
    }
}

/// One opened live channel. Facts come out of it in the Owner's own order.
#[async_trait]
pub trait LiveMarketChannelV1: Send + Sync + sealed::Sealed {
    /// The channel's identity, derived by the Owner from the binding and what it carries.
    fn channel_identity(&self) -> BindingDigest;

    /// Waits for the venue's next batch and seals whatever it admits.
    ///
    /// An empty result means the market was quiet, not that the channel failed. Every fact
    /// returned carries a sequence one greater than the last, and the durable head has already
    /// advanced by the time a caller sees them, so a restart never re-issues a sequence.
    ///
    /// One channel is one consumer. The Owner refuses to open a second channel with the same
    /// identity while one is live, because two pollers would take the head lock in whatever order
    /// they finished waiting on the venue, and a consumer ordering its state by sequence would see
    /// the venue's own order inverted with no way to detect it.
    ///
    /// # Errors
    ///
    /// A bounded category. The Owner stops sealing rather than inventing: an out-of-scope answer
    /// from the venue ends the batch instead of being trimmed to fit.
    async fn next_facts(&self) -> Result<Vec<LiveMarketFactV1>, LiveMarketChannelErrorV1>;

    /// The Owner's durable head for this channel.
    ///
    /// # Errors
    ///
    /// A bounded category when the store cannot answer or the stored head does not verify.
    async fn head(&self) -> Result<LiveMarketChannelHeadV1, LiveMarketChannelErrorV1>;
}

/// The sealed production intake. Operations reaches it; no consumer can implement it.
#[async_trait]
pub trait LiveMarketFactIntakeV1: Send + Sync + sealed::Sealed {
    /// Opens one channel on an admitted binding, resuming its durable head if it has one.
    ///
    /// The Owner resolves the binding, issues the subscription from its own Instrument Master and
    /// reads the head here, so a channel that could never carry anything is refused before a
    /// consumer is left waiting on it.
    ///
    /// # Errors
    ///
    /// A bounded category only when no channel was opened. `ChannelBusy` when this process already
    /// holds an open channel with the same identity.
    async fn open_channel(
        &self,
        request: LiveMarketChannelRequestV1,
    ) -> Result<Arc<dyn LiveMarketChannelV1>, LiveMarketChannelErrorV1>;
}

pub(crate) mod sealed {
    pub trait Sealed {}
}

/// Opens the sole configured live market fact intake.
///
/// The deployment configuration root chooses the database through
/// `MARKET_DATA_OWNER_DATABASE_URL`, and the caller supplies the one Data Client behind it.
///
/// # Errors
///
/// Returns a redacted configuration or store failure without attempting a default database.
pub async fn live_market_fact_intake_from_environment_v1(
    source: Arc<dyn LiveMarketFactSourceV1>,
) -> Result<Arc<dyn LiveMarketFactIntakeV1>, LiveMarketChannelErrorV1> {
    super::postgres::live_market_fact_intake_from_environment_v1(source).await
}

/// Derives the identity of one channel from everything that decides what it carries.
///
/// Two channels that differ in any of these are different channels and must not share a head: a
/// consumer ordering by sequence would otherwise see one stream's numbering applied to another's
/// facts.
pub(crate) fn derive_channel_identity_v1(
    source_binding_identity: BindingDigest,
    subscription: &LiveMarketSubscriptionV1,
) -> BindingDigest {
    let mut sorted = subscription.instruments().to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"vibe.market-data.live-market-channel.v1\0");
    hasher.update(source_binding_identity.as_bytes());
    // Every variable-width field is length-prefixed, including the two canonical words, so no two
    // channels can collide by running one field into the next.
    hash_field(&mut hasher, subscription.channel().canonical().as_bytes());
    hash_field(
        &mut hasher,
        subscription.field_semantic().identity().as_bytes(),
    );
    hasher.update(&length_prefix(sorted.len()));

    for instrument in &sorted {
        hash_field(&mut hasher, instrument.as_bytes());
    }
    BindingDigest::from_untrusted_bytes(*hasher.finalize().as_bytes())
}

fn hash_field(hasher: &mut blake3::Hasher, bytes: &[u8]) {
    hasher.update(&length_prefix(bytes.len()));
    hasher.update(bytes);
}

/// Encodes one length for the channel identity.
///
/// A length beyond `u32` cannot arise here: instruments are canonical Instrument Master identities
/// and the two words are compile-time constants, so saturating is unreachable rather than lossy.
fn length_prefix(length: usize) -> [u8; 4] {
    u32::try_from(length).unwrap_or(u32::MAX).to_be_bytes()
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn digest(byte: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([byte; 32])
    }

    fn subscription(instruments: &[&str]) -> LiveMarketSubscriptionV1 {
        LiveMarketSubscriptionV1::issue_v1(
            instruments
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
            StrategyInputChannel::Market,
            MarketDataFieldSemantic::TradeLastPrice,
        )
        .expect("a named instrument is a usable scope")
    }

    #[rstest]
    fn channel_identity_ignores_the_order_a_caller_listed_instruments_in() {
        assert_eq!(
            derive_channel_identity_v1(digest(1), &subscription(&["A", "B"])),
            derive_channel_identity_v1(digest(1), &subscription(&["B", "A"])),
        );
    }

    #[rstest]
    fn channel_identity_separates_every_coordinate_that_changes_what_is_carried() {
        let base = derive_channel_identity_v1(digest(1), &subscription(&["A"]));
        assert_ne!(
            base,
            derive_channel_identity_v1(digest(2), &subscription(&["A"])),
            "another binding is another channel"
        );
        assert_ne!(
            base,
            derive_channel_identity_v1(digest(1), &subscription(&["A", "B"])),
            "another instrument set is another channel"
        );
        let other_field = LiveMarketSubscriptionV1::issue_v1(
            vec!["A".to_string()],
            StrategyInputChannel::Market,
            MarketDataFieldSemantic::QuoteBidPrice,
        )
        .unwrap();
        assert_ne!(
            base,
            derive_channel_identity_v1(digest(1), &other_field),
            "another field is another channel"
        );
        let other_channel = LiveMarketSubscriptionV1::issue_v1(
            vec!["A".to_string()],
            StrategyInputChannel::Reference,
            MarketDataFieldSemantic::TradeLastPrice,
        )
        .unwrap();
        assert_ne!(
            base,
            derive_channel_identity_v1(digest(1), &other_channel),
            "another channel kind is another channel"
        );
    }

    #[rstest]
    fn every_vendor_and_seal_refusal_keeps_its_own_operations_meaning() {
        assert_eq!(
            LiveMarketChannelErrorV1::from(LiveMarketFactSourceErrorV1::ScopeMismatch),
            LiveMarketChannelErrorV1::SourceOutOfScope
        );
        assert_eq!(
            LiveMarketChannelErrorV1::from(LiveMarketFactSourceErrorV1::ScopeUnusable),
            LiveMarketChannelErrorV1::InvalidRequest
        );
        assert_eq!(
            LiveMarketChannelErrorV1::from(LiveMarketFactSourceErrorV1::Undecodable),
            LiveMarketChannelErrorV1::SourceUndecodable
        );
        assert_eq!(
            LiveMarketChannelErrorV1::from(LiveMarketFactSourceErrorV1::Unavailable),
            LiveMarketChannelErrorV1::SourceUnavailable
        );
        assert_eq!(
            LiveMarketChannelErrorV1::from(LiveMarketSealRefusalV1::OutOfScope),
            LiveMarketChannelErrorV1::SourceOutOfScope
        );
        assert_eq!(
            LiveMarketChannelErrorV1::from(LiveMarketSealRefusalV1::AmbiguousInstants),
            LiveMarketChannelErrorV1::ObservationAmbiguous
        );
        assert_eq!(
            LiveMarketChannelErrorV1::from(LiveMarketSealRefusalV1::UndecodableValue),
            LiveMarketChannelErrorV1::SourceUndecodable
        );
        assert_eq!(
            LiveMarketChannelErrorV1::from(LiveMarketSealRefusalV1::OwnerSequenceInvalid),
            LiveMarketChannelErrorV1::StoreUntrusted,
            "reconnecting to the venue cannot fix this Owner's own sequencing"
        );
    }

    #[rstest]
    fn one_channel_field_cannot_be_read_as_another() {
        let short = LiveMarketSubscriptionV1::issue_v1(
            vec!["AB".to_string(), "C".to_string()],
            StrategyInputChannel::Market,
            MarketDataFieldSemantic::TradeLastPrice,
        )
        .unwrap();
        let long = LiveMarketSubscriptionV1::issue_v1(
            vec!["A".to_string(), "BC".to_string()],
            StrategyInputChannel::Market,
            MarketDataFieldSemantic::TradeLastPrice,
        )
        .unwrap();
        assert_ne!(
            derive_channel_identity_v1(digest(1), &short),
            derive_channel_identity_v1(digest(1), &long),
            "the same concatenated bytes split differently are different channels"
        );
    }
}
