//! An acceptance-only quote source for custody frames, in place of slice T0-6's derivation.
//!
//! Until T0-6 derives a custody gap's quote cut, production refuses every gap as
//! `QuoteCutMissing`, so no custody frame reaches a consumer. This module lets an acceptance proof
//! state the Quotes of each gap itself, so a consumer can be driven over several custody frames
//! before T0-6 lands. It exists only with `sealed-strategy-input-acceptance`, which no deployed
//! binary enables, and T0-6's real fill-bar derivation replaces it: a result produced with it is
//! not U1 evidence until it is re-run on the real derivation.
//!
//! Only the Quotes are stated. The stated rows are sealed by the custody quote cut seal the real
//! derivation will use, so the gap check (`d_k < instant < bound`), one complete quote per member in
//! member order, and the custody-view source all still apply, and a gap the source states nothing
//! for is refused as `QuoteCutMissing`, exactly as production refuses it.

use sha2::{Digest as _, Sha256};

use super::{QuoteDerivationV1, quote_cut::CustodyQuoteCutRequestV1};
use crate::owner::{
    native_replay_quote_cut_v2::NativeReplayQuoteCutRefusalV2,
    pit_snapshot::{
        VerifiedPitObservationBatch,
        custody_view::{
            CustodyQuoteCutInputsV1, CustodyQuoteRowV1, CustodyViewSealErrorV1,
            verify_custody_quote_cut_batch_v1,
        },
    },
    source_binding::BindingDigest,
};

const QUOTE_CUT_IDENTITY_DOMAIN: &[u8] =
    b"market-data.sealed-acceptance.custody-quote-cut.identity.v1\0";

/// What an acceptance quote source is asked for one gap: the gap after one custody frame.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SealedAcceptanceCustodyQuoteGapV1 {
    chain_root: BindingDigest,
    head_identity: BindingDigest,
    view_identity: BindingDigest,
    decision_cut_ns: u64,
    bound_ns_exclusive: u64,
    members: Vec<String>,
    fill_timeframe_identity: Option<BindingDigest>,
}

impl SealedAcceptanceCustodyQuoteGapV1 {
    pub(crate) fn of_request(request: &CustodyQuoteCutRequestV1) -> Self {
        Self {
            chain_root: request.chain_root,
            head_identity: request.head_identity,
            view_identity: request.view_identity,
            decision_cut_ns: request.decision_cut_ns,
            bound_ns_exclusive: request.bound_ns_exclusive,
            members: request.members.clone(),
            fill_timeframe_identity: request
                .fill_timeframe
                .as_ref()
                .map(|timeframe| timeframe.identity),
        }
    }

    /// The custody chain the frame was read from.
    #[must_use]
    pub const fn chain_root(&self) -> BindingDigest {
        self.chain_root
    }

    /// The head the run's frames were read from.
    #[must_use]
    pub const fn head_identity(&self) -> BindingDigest {
        self.head_identity
    }

    /// The view of the frame the gap follows.
    #[must_use]
    pub const fn view_identity(&self) -> BindingDigest {
        self.view_identity
    }

    /// `d_k`: the gap opens strictly after it.
    #[must_use]
    pub const fn decision_cut_ns(&self) -> u64 {
        self.decision_cut_ns
    }

    /// The gap's exclusive end: the next frame's event, or the run's end for the last frame.
    #[must_use]
    pub const fn bound_ns_exclusive(&self) -> u64 {
        self.bound_ns_exclusive
    }

    /// The custody's members, in member order: one complete quote is stated for each.
    #[must_use]
    pub fn members(&self) -> &[String] {
        &self.members
    }

    /// The custody's fill timeframe identity, when it declares one.
    #[must_use]
    pub const fn fill_timeframe_identity(&self) -> Option<BindingDigest> {
        self.fill_timeframe_identity
    }
}

/// One field of a member's quote.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SealedAcceptanceQuoteFieldV1 {
    BidPrice,
    AskPrice,
    BidSize,
    AskSize,
}

impl SealedAcceptanceQuoteFieldV1 {
    const fn row_field(self) -> &'static str {
        match self {
            Self::BidPrice => "BID_PRICE",
            Self::AskPrice => "ASK_PRICE",
            Self::BidSize => "BID_SIZE",
            Self::AskSize => "ASK_SIZE",
        }
    }
}

/// One member's quote value, as an acceptance quote source states it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SealedAcceptanceCustodyQuoteRowV1 {
    pub instrument: String,
    pub field: SealedAcceptanceQuoteFieldV1,
    /// The value is `value_mantissa * 10^-value_scale`, in canonical form.
    pub value_mantissa: i128,
    pub value_scale: u8,
}

/// The quote cut an acceptance quote source states for one gap: every member's quote, in member
/// order and in the field order bid price, ask price, bid size, ask size, at one instant that is
/// also its availability and publication.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SealedAcceptanceCustodyQuoteCutV1 {
    pub instant_ns: u64,
    pub derivation: QuoteDerivationV1,
    pub rows: Vec<SealedAcceptanceCustodyQuoteRowV1>,
}

/// The quote cut `quote` states for the gap `request` asks about, sealed by the custody quote cut
/// seal against `view`.
///
/// # Errors
///
/// `QuoteCutMissing` when `quote` states nothing or an instant outside the gap; `MemberMismatch`
/// when its rows are not one complete quote per member in member order; `NotAQuoteCut` when `view`
/// is not a custody view or the rows do not encode.
pub(crate) fn sealed_acceptance_custody_quote_cut_v1<F>(
    view: &VerifiedPitObservationBatch,
    request: &CustodyQuoteCutRequestV1,
    quote: &F,
) -> Result<VerifiedPitObservationBatch, NativeReplayQuoteCutRefusalV2>
where
    F: Fn(&SealedAcceptanceCustodyQuoteGapV1) -> Option<SealedAcceptanceCustodyQuoteCutV1>,
{
    let cut = quote(&SealedAcceptanceCustodyQuoteGapV1::of_request(request))
        .ok_or(NativeReplayQuoteCutRefusalV2::QuoteCutMissing)?;
    let rows = cut
        .rows
        .iter()
        .map(|row| CustodyQuoteRowV1 {
            instrument: row.instrument.clone(),
            field: row.field.row_field(),
            value_mantissa: row.value_mantissa,
            value_scale: row.value_scale,
        })
        .collect::<Vec<_>>();
    let mut hasher = Sha256::new();
    hasher.update(QUOTE_CUT_IDENTITY_DOMAIN);
    hasher.update(request.chain_root.as_bytes());
    hasher.update(request.view_identity.as_bytes());
    hasher.update(cut.instant_ns.to_be_bytes());
    let quote_cut_identity = BindingDigest::from_untrusted_bytes(hasher.finalize().into());
    verify_custody_quote_cut_batch_v1(
        view,
        CustodyQuoteCutInputsV1 {
            quote_cut_identity,
            instant_ns: cut.instant_ns,
            available_ns: cut.instant_ns,
            publication_ns: cut.instant_ns,
            bound_ns_exclusive: request.bound_ns_exclusive,
            derivation: cut.derivation,
            rows: &rows,
        },
    )
    .map_err(|e| match e {
        CustodyViewSealErrorV1::QuoteCutOutsideGap => {
            NativeReplayQuoteCutRefusalV2::QuoteCutMissing
        }
        CustodyViewSealErrorV1::RowCensus
        | CustodyViewSealErrorV1::RowMismatch
        | CustodyViewSealErrorV1::NonUniform => NativeReplayQuoteCutRefusalV2::MemberMismatch,
        CustodyViewSealErrorV1::NotAView | CustodyViewSealErrorV1::Encoding => {
            NativeReplayQuoteCutRefusalV2::NotAQuoteCut
        }
    })
}
