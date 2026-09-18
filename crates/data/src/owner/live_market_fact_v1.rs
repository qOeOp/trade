//! The one live market fact a Strategy Instance consumes, and the seam a venue states it through.
//!
//! A PIT snapshot answers one frozen question at one decision cut. A running strategy needs the
//! opposite: facts as they happen, each one still carrying the Market Semantics Compatibility
//! identity its historical evidence was bound to, so that a generation cannot silently change what
//! a price means when it moves from replay to live.
//!
//! The split is the same one the PIT observation seam already makes. A venue states only what a
//! venue can know: which instrument, which channel, which field, the value, when the event was
//! effective and when the venue published it. It states no Source Binding identity, no lineage, no
//! semantics identity, no sequence and no retrieval instant, because those are the Owner's and a
//! venue that could state them could place a value under a binding it was never admitted for.
//! Retrieval belongs with them: it is when this system received the observation, which is an Owner
//! observation about itself that a vendor is in no position to make.

use std::fmt::{Debug, Display};

use async_trait::async_trait;
use serde::Serialize;

use super::{
    source_binding::BindingDigest,
    strategy_input_binding::{MarketDataFieldSemantic, StrategyInputChannel},
};

/// Domain for the canonical bytes one live fact is identified by.
const LIVE_MARKET_FACT_DOMAIN: &[u8] = b"vibe.market-data.live-market-fact.v1\0";

fn digest(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(*hasher.finalize().as_bytes())
}

/// The exact scope one live channel may carry, issued by the Owner.
///
/// A Data Client cannot widen it, and neither can a caller: the instruments are the canonical
/// identities of the Instrument Master facts this Owner selected as effective and observable under
/// its own clock head, never the list a caller proposed. A caller names candidates; what a channel
/// carries is what the Owner could vouch for.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LiveMarketSubscriptionV1 {
    instruments: Vec<String>,
    channel: StrategyInputChannel,
    field_semantic: MarketDataFieldSemantic,
}

impl LiveMarketSubscriptionV1 {
    /// Issues one subscription over instruments the Owner has already vouched for.
    ///
    /// Market Data calls this on the run path with the canonical identities of the Instrument
    /// Master facts it selected. It is public so a Data Client can be exercised against an exact
    /// scope without a database; a constructed subscription confers nothing, because a fact is
    /// sealed only against the subscription the Owner re-issues inside the sealing transaction,
    /// for a binding it has just re-read as admitted.
    ///
    /// # Errors
    ///
    /// Returns `ScopeUnusable` when no instrument is named or one of them is empty, because a
    /// channel that carries nothing has nothing to refuse either.
    pub fn issue_v1(
        instruments: Vec<String>,
        channel: StrategyInputChannel,
        field_semantic: MarketDataFieldSemantic,
    ) -> Result<Self, LiveMarketFactSourceErrorV1> {
        if instruments.is_empty() || instruments.iter().any(String::is_empty) {
            return Err(LiveMarketFactSourceErrorV1::ScopeUnusable);
        }
        Ok(Self {
            instruments,
            channel,
            field_semantic,
        })
    }

    /// The instruments this channel carries, and no others.
    #[must_use]
    pub fn instruments(&self) -> &[String] {
        &self.instruments
    }

    /// The channel every fact on this subscription belongs to.
    #[must_use]
    pub const fn channel(&self) -> StrategyInputChannel {
        self.channel
    }

    /// The field every fact on this subscription measures.
    #[must_use]
    pub const fn field_semantic(&self) -> MarketDataFieldSemantic {
        self.field_semantic
    }

    /// Whether this subscription admits an instrument at all.
    #[must_use]
    pub fn carries(&self, instrument: &str) -> bool {
        self.instruments
            .iter()
            .any(|admitted| admitted == instrument)
    }
}

/// One live observation as a venue can state it.
///
/// Every field is a venue fact. The Owner-side bindings are absent by construction rather than by
/// convention, so this type cannot be used to smuggle a binding claim, and there is no retrieval
/// instant here because no vendor can say when this system received anything.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VendorLiveObservationV1 {
    /// The canonical instrument the value belongs to.
    pub instrument: String,
    /// The value mantissa.
    pub value_mantissa: i128,
    /// The value scale.
    pub value_scale: u8,
    /// When the underlying event was effective, in nanoseconds.
    pub event_effective: u64,
    /// When the venue published it, in nanoseconds, as the venue's own envelope stamps it.
    pub provider_available: u64,
}

/// Why a live source could not carry the subscription.
///
/// The categories stay bounded and carry no venue payload, endpoint or credential detail.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LiveMarketFactSourceErrorV1 {
    /// The client could not reach the venue, or the venue closed the stream.
    Unavailable,
    /// The venue answered for something the Owner's subscription does not carry.
    ScopeMismatch,
    /// The subscription names nothing the Owner could carry.
    ScopeUnusable,
    /// The venue answered in a shape this client cannot read as a value.
    Undecodable,
}

impl Display for LiveMarketFactSourceErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            Self::Unavailable => "the live market source is unavailable",
            Self::ScopeMismatch => "the live market source answered outside its subscription",
            Self::ScopeUnusable => "the subscription names no instrument the Owner can carry",
            Self::Undecodable => "the live market source answered an unreadable value",
        };
        formatter.write_str(text)
    }
}

impl std::error::Error for LiveMarketFactSourceErrorV1 {}

/// Why the Owner would not seal one observation into a fact.
///
/// These are kept apart because the right response differs: an out-of-scope answer means the venue
/// is serving a question nobody asked, contradictory instants mean the observation cannot be
/// placed in time at all, an unreadable value is a defect in this client, and a zero sequence is
/// this Owner's own invariant broken. Collapsing them would tell Operations to reconnect in three
/// cases where reconnecting fixes nothing.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum LiveMarketSealRefusalV1 {
    /// The observation names an instrument this subscription does not carry.
    OutOfScope,
    /// The observation's instants contradict each other, so it has no place in time.
    AmbiguousInstants,
    /// The value cannot be a fixed-point measurement, or a field is too long to encode.
    UndecodableValue,
    /// The Owner asked for a sequence no issued fact may carry.
    OwnerSequenceInvalid,
}

/// One Data Client that can carry an Owner-issued live subscription.
#[async_trait]
pub trait LiveMarketFactSourceV1: Send + Sync {
    /// Waits for the next batch of observations the venue has published.
    ///
    /// Returning an empty batch is not an error: a quiet market is a fact about the market, and
    /// the Owner seals nothing for it.
    ///
    /// # Errors
    ///
    /// Returns a bounded category. The Owner treats every one of them as a reason to stop sealing
    /// rather than as a reason to invent a value.
    async fn next_batch(
        &self,
        subscription: &LiveMarketSubscriptionV1,
    ) -> Result<Vec<VendorLiveObservationV1>, LiveMarketFactSourceErrorV1>;
}

/// One Owner-sealed live market fact.
///
/// It is what crosses to a Strategy Instance. Every Owner-side field is stamped by the Owner from
/// the admitted Source Binding and its own sequence; a consumer cannot construct, deserialize or
/// mint one, so holding it is evidence that Market Data issued it. `Deserialize` is deliberately
/// absent for that reason, exactly as it is on the Strategy Input universe receipts: a derived
/// deserializer ignores field privacy, and a consumer that could rebuild this type from bytes
/// could name an admitted binding it never went through.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct LiveMarketFactV1 {
    instrument: String,
    channel: StrategyInputChannel,
    field_semantic: MarketDataFieldSemantic,
    value_mantissa: i128,
    value_scale: u8,
    event_effective: u64,
    provider_available: u64,
    retrieval: u64,
    source_binding_identity: BindingDigest,
    source_binding_lineage_root: BindingDigest,
    source_binding_lineage_version: u64,
    market_semantics_identity: BindingDigest,
    owner_sequence: u64,
    identity: BindingDigest,
}

impl LiveMarketFactV1 {
    /// The instrument this fact is about.
    #[must_use]
    pub fn instrument(&self) -> &str {
        &self.instrument
    }

    /// The channel it was carried on.
    #[must_use]
    pub const fn channel(&self) -> StrategyInputChannel {
        self.channel
    }

    /// The field it measures.
    #[must_use]
    pub const fn field_semantic(&self) -> MarketDataFieldSemantic {
        self.field_semantic
    }

    /// The value mantissa, in the fixed-point semantic the scale names.
    #[must_use]
    pub const fn value_mantissa(&self) -> i128 {
        self.value_mantissa
    }

    /// The value scale.
    #[must_use]
    pub const fn value_scale(&self) -> u8 {
        self.value_scale
    }

    /// When the underlying event was effective.
    #[must_use]
    pub const fn event_effective(&self) -> u64 {
        self.event_effective
    }

    /// When the venue made it available.
    #[must_use]
    pub const fn provider_available(&self) -> u64 {
        self.provider_available
    }

    /// When this Owner received it.
    #[must_use]
    pub const fn retrieval(&self) -> u64 {
        self.retrieval
    }

    /// The admitted Source Binding this fact came through.
    #[must_use]
    pub const fn source_binding_identity(&self) -> BindingDigest {
        self.source_binding_identity
    }

    /// That binding's lineage root.
    #[must_use]
    pub const fn source_binding_lineage_root(&self) -> BindingDigest {
        self.source_binding_lineage_root
    }

    /// That binding's lineage version.
    #[must_use]
    pub const fn source_binding_lineage_version(&self) -> u64 {
        self.source_binding_lineage_version
    }

    /// The Market Semantics Compatibility identity a consumer must already be bound to.
    #[must_use]
    pub const fn market_semantics_identity(&self) -> BindingDigest {
        self.market_semantics_identity
    }

    /// This Owner's own sequence for the channel, which strictly advances.
    #[must_use]
    pub const fn owner_sequence(&self) -> u64 {
        self.owner_sequence
    }

    /// The fact's content identity.
    #[must_use]
    pub const fn identity(&self) -> BindingDigest {
        self.identity
    }
}

/// What the Owner knows about the binding a live channel runs on.
///
/// It is assembled from an admitted Source Binding readback, never from a caller, which is what
/// makes the stamped fields evidence rather than claims.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LiveMarketBindingV1 {
    pub(crate) source_binding_identity: BindingDigest,
    pub(crate) source_binding_lineage_root: BindingDigest,
    pub(crate) source_binding_lineage_version: u64,
    pub(crate) market_semantics_identity: BindingDigest,
}

/// Seals one vendor observation into an Owner fact under an exact subscription and sequence.
///
/// The observation's instrument must be one the subscription carries, its instants must be
/// ordered as a live observation's instants are, and both the sequence and the retrieval instant
/// are the Owner's. Nothing here consults a store: the caller holds the binding readback that
/// authorises the stamp.
///
/// # Errors
///
/// A bounded refusal. Every category is distinct because the response to each one differs.
pub(crate) fn seal_live_market_fact_v1(
    observation: &VendorLiveObservationV1,
    subscription: &LiveMarketSubscriptionV1,
    binding: LiveMarketBindingV1,
    owner_sequence: u64,
    retrieval: u64,
) -> Result<LiveMarketFactV1, LiveMarketSealRefusalV1> {
    if !subscription.carries(&observation.instrument) {
        return Err(LiveMarketSealRefusalV1::OutOfScope);
    }

    if owner_sequence == 0 {
        return Err(LiveMarketSealRefusalV1::OwnerSequenceInvalid);
    }

    // A venue cannot publish a fact before the event it describes. Both instants are stamped by
    // the venue's own clock, so their order is the venue's statement about itself and a broken one
    // means the row is not what it says.
    //
    // No order is asserted between `retrieval` and the venue's instants, because they are not on
    // one clock. A measured venue reads tens of milliseconds ahead of an ordinary host, so such a
    // rule would refuse every batch on a healthy system while proving nothing about either clock;
    // the Owner's own clock uncertainty is custody the clock head carries, not something to infer
    // from a foreign stamp. What the Owner does insist on is being able to place itself in time at
    // all: a system that cannot say when it received an observation cannot vouch for one.
    if observation.provider_available < observation.event_effective || retrieval == 0 {
        return Err(LiveMarketSealRefusalV1::AmbiguousInstants);
    }

    if observation.value_scale > 38 {
        return Err(LiveMarketSealRefusalV1::UndecodableValue);
    }
    let mut bytes = Vec::with_capacity(192);
    // Every variable-width field carries its own length, so no two distinct observations can share
    // canonical bytes by running one field into the next.
    append_length_prefixed(&mut bytes, observation.instrument.as_bytes())?;
    append_length_prefixed(&mut bytes, subscription.channel().canonical().as_bytes())?;
    append_length_prefixed(
        &mut bytes,
        subscription.field_semantic().identity().as_bytes(),
    )?;
    bytes.extend_from_slice(&observation.value_mantissa.to_be_bytes());
    bytes.push(observation.value_scale);
    bytes.extend_from_slice(&observation.event_effective.to_be_bytes());
    bytes.extend_from_slice(&observation.provider_available.to_be_bytes());
    bytes.extend_from_slice(&retrieval.to_be_bytes());
    bytes.extend_from_slice(binding.source_binding_identity.as_bytes());
    bytes.extend_from_slice(binding.source_binding_lineage_root.as_bytes());
    bytes.extend_from_slice(&binding.source_binding_lineage_version.to_be_bytes());
    bytes.extend_from_slice(binding.market_semantics_identity.as_bytes());
    bytes.extend_from_slice(&owner_sequence.to_be_bytes());
    let identity = digest(LIVE_MARKET_FACT_DOMAIN, &bytes);
    Ok(LiveMarketFactV1 {
        instrument: observation.instrument.clone(),
        channel: subscription.channel(),
        field_semantic: subscription.field_semantic(),
        value_mantissa: observation.value_mantissa,
        value_scale: observation.value_scale,
        event_effective: observation.event_effective,
        provider_available: observation.provider_available,
        retrieval,
        source_binding_identity: binding.source_binding_identity,
        source_binding_lineage_root: binding.source_binding_lineage_root,
        source_binding_lineage_version: binding.source_binding_lineage_version,
        market_semantics_identity: binding.market_semantics_identity,
        owner_sequence,
        identity,
    })
}

/// Appends one length-prefixed field, refusing a field no length prefix can describe.
///
/// Truncating the length instead would encode a value the prefix contradicts, which is a wrong
/// canonical form rather than a long one.
fn append_length_prefixed(
    bytes: &mut Vec<u8>,
    field: &[u8],
) -> Result<(), LiveMarketSealRefusalV1> {
    let length =
        u32::try_from(field.len()).map_err(|_| LiveMarketSealRefusalV1::UndecodableValue)?;
    bytes.extend_from_slice(&length.to_be_bytes());
    bytes.extend_from_slice(field);
    Ok(())
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    /// The Owner's own retrieval instant in these tests, strictly after the venue's publication.
    const RETRIEVAL: u64 = 102;

    fn digest(byte: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([byte; 32])
    }

    fn subscription() -> LiveMarketSubscriptionV1 {
        LiveMarketSubscriptionV1::issue_v1(
            vec!["BTCUSDT.BYBIT".to_string()],
            StrategyInputChannel::Market,
            MarketDataFieldSemantic::TradeLastPrice,
        )
        .expect("one named instrument is a usable scope")
    }

    fn binding() -> LiveMarketBindingV1 {
        LiveMarketBindingV1 {
            source_binding_identity: digest(1),
            source_binding_lineage_root: digest(2),
            source_binding_lineage_version: 3,
            market_semantics_identity: digest(4),
        }
    }

    fn observation() -> VendorLiveObservationV1 {
        VendorLiveObservationV1 {
            instrument: "BTCUSDT.BYBIT".to_string(),
            value_mantissa: 8_030_699,
            value_scale: 2,
            event_effective: 100,
            provider_available: 101,
        }
    }

    fn seal(
        observation: &VendorLiveObservationV1,
        binding: LiveMarketBindingV1,
        sequence: u64,
        retrieval: u64,
    ) -> Result<LiveMarketFactV1, LiveMarketSealRefusalV1> {
        seal_live_market_fact_v1(observation, &subscription(), binding, sequence, retrieval)
    }

    #[rstest]
    fn an_empty_scope_is_refused_before_any_fact_exists() {
        assert_eq!(
            LiveMarketSubscriptionV1::issue_v1(
                Vec::new(),
                StrategyInputChannel::Market,
                MarketDataFieldSemantic::TradeLastPrice,
            ),
            Err(LiveMarketFactSourceErrorV1::ScopeUnusable)
        );
        assert_eq!(
            LiveMarketSubscriptionV1::issue_v1(
                vec![String::new()],
                StrategyInputChannel::Market,
                MarketDataFieldSemantic::TradeLastPrice,
            ),
            Err(LiveMarketFactSourceErrorV1::ScopeUnusable)
        );
    }

    #[rstest]
    fn a_sealed_fact_carries_the_owner_stamp_and_nothing_the_venue_said_about_it() {
        let fact =
            seal(&observation(), binding(), 7, RETRIEVAL).expect("an in-scope observation seals");
        assert_eq!(fact.source_binding_identity(), digest(1));
        assert_eq!(fact.market_semantics_identity(), digest(4));
        assert_eq!(fact.owner_sequence(), 7);
        assert_eq!(fact.retrieval(), RETRIEVAL);
        assert_eq!(fact.channel(), StrategyInputChannel::Market);
        assert_eq!(
            fact.field_semantic(),
            MarketDataFieldSemantic::TradeLastPrice
        );
        assert_ne!(fact.identity(), digest(0));
    }

    #[rstest]
    fn the_identity_moves_with_every_coordinate_that_could_change_meaning() {
        let base = seal(&observation(), binding(), 7, RETRIEVAL).unwrap();
        let mut later = observation();
        later.event_effective = 101;
        assert_ne!(
            base.identity(),
            seal(&later, binding(), 7, RETRIEVAL).unwrap().identity()
        );
        assert_ne!(
            base.identity(),
            seal(&observation(), binding(), 8, RETRIEVAL)
                .unwrap()
                .identity()
        );
        assert_ne!(
            base.identity(),
            seal(&observation(), binding(), 7, RETRIEVAL + 1)
                .unwrap()
                .identity(),
            "the Owner's own retrieval instant is part of what a fact says"
        );

        let mut other_binding = binding();
        other_binding.market_semantics_identity = digest(5);
        assert_ne!(
            base.identity(),
            seal(&observation(), other_binding, 7, RETRIEVAL)
                .unwrap()
                .identity(),
            "a fact under different semantics is a different fact"
        );
    }

    #[rstest]
    fn one_field_cannot_be_read_as_another_by_running_them_together() {
        let mut split_differently = observation();
        split_differently.instrument = "BTCUSDT.BYBI".to_string();
        let shifted = LiveMarketSubscriptionV1::issue_v1(
            vec!["BTCUSDT.BYBI".to_string()],
            StrategyInputChannel::Market,
            MarketDataFieldSemantic::TradeLastPrice,
        )
        .unwrap();
        let moved = seal_live_market_fact_v1(&split_differently, &shifted, binding(), 7, RETRIEVAL)
            .unwrap();
        assert_ne!(
            seal(&observation(), binding(), 7, RETRIEVAL)
                .unwrap()
                .identity(),
            moved.identity(),
            "a shorter instrument cannot borrow the next field's first byte"
        );
    }

    #[rstest]
    fn an_instrument_the_subscription_never_named_seals_nothing() {
        let mut foreign = observation();
        foreign.instrument = "ETHUSDT.BYBIT".to_string();
        assert_eq!(
            seal(&foreign, binding(), 7, RETRIEVAL),
            Err(LiveMarketSealRefusalV1::OutOfScope)
        );
    }

    #[rstest]
    fn instants_that_contradict_each_other_seal_nothing() {
        let mut published_before_it_happened = observation();
        published_before_it_happened.provider_available = 99;
        assert_eq!(
            seal(&published_before_it_happened, binding(), 7, RETRIEVAL),
            Err(LiveMarketSealRefusalV1::AmbiguousInstants)
        );
        assert_eq!(
            seal(&observation(), binding(), 7, 0),
            Err(LiveMarketSealRefusalV1::AmbiguousInstants),
            "an Owner that cannot place itself in time cannot vouch for an observation"
        );
        seal(&observation(), binding(), 7, 100).expect(
            "a host clock reading behind the venue's is ordinary skew, not a contradiction",
        );
    }

    #[rstest]
    fn a_zero_sequence_seals_nothing_because_the_head_counts_from_one() {
        assert_eq!(
            seal(&observation(), binding(), 0, RETRIEVAL),
            Err(LiveMarketSealRefusalV1::OwnerSequenceInvalid),
            "this is the Owner's own invariant, not something the venue did"
        );
    }
}
