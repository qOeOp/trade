//! Authoring the one admitted Strategy family: a single channel against a single threshold.
//!
//! `docs/owners/rd.md` admits exactly one authoring slice, and bounds it twice. The family is "a
//! single declared channel compared against a single threshold", with the decision clock taken
//! from that channel. The output "stops at meaning": this module's product is the `design` and
//! `meaning` pair and nothing further - no syntax, no new primitive, no execution path. What it
//! emits is checked by the same contract that checks a hand-written declaration, which is why
//! there is no validation here that `prepare_bounded_feature_program_v1` already performs.
//!
//! The same document forbids the thing this module could easily have become: R&D does not derive
//! a Design from research prose, because a judgement an Owner makes is a fact the Owner invented.
//! So the input is not prose and not a description. Every judgement - which channel, which
//! threshold, which comparison, and what to propose on each side of it - is stated by the author
//! in `SingleThresholdAuthoringRequestV1`. This module decides nothing about the strategy. It
//! decides only the encoding: which fields of `StrategyDesignV2` and
//! `BoundedFeatureProgramMeaningV1` those judgements land in, and it derives nothing else because
//! everything else is already fixed by the schema, the catalog and the plugin manifest.
//!
//! One other place in this crate produces a `(design, meaning)` pair, and it is worth saying what
//! is different here. `bounded_feature_program_six_role_bar_fixture_v1` is a specimen: it takes no
//! authoring input, carries six fixed BAR roles, and gives all three of its decision branches the
//! same frame as the default, so the table it declares cannot change a proposal. It also exists
//! only under `#[cfg(all(test, feature = "sealed-strategy-input-acceptance"))]`, declared on its
//! `mod` line rather than in its own file. It is there to prove that a declaration assembles.
//!
//! So nothing outside a gated test could produce the pair before this module, and the pair that
//! could be produced had a decision table with no observable effect. This module is reachable from
//! an ordinary build, takes the author's judgements as input, and refuses the degenerate table
//! rather than emitting one.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use vibe_data::owner::decimal_rescale_v1::{RescaleErrorV1, rescale_exact_v1};
use vibe_data::owner::source_binding::BindingDigest;
use vibe_data::owner::strategy_input_binding::MarketDataFieldSemantic;

use crate::{
    bounded_feature_graph_v1::{ADD, Graph, MUL, SIGNAL_UNIT, fixed_type, prior_state},
    bounded_feature_program_derivation_v1::{
        BoundedFeatureGraphBoundsV1, BoundedFeatureInputMeaningV1, BoundedFeatureProgramMeaningV1,
        redeclare_frozen_bounded_feature_program_v1,
    },
    bounded_feature_program_v1::{
        BOUNDED_FEATURE_NUMERIC_FAILURE_V1, BOUNDED_FEATURE_PLUGIN_ABI_V1,
        BOUNDED_FEATURE_PROPOSAL_OUTPUT_PORTS_V1, BoundedFeatureClockV1, BoundedFeatureConstantV1,
        BoundedFeatureConstantValueV1, BoundedFeatureParametersV1, BoundedFeaturePredicateV1,
        BoundedFeatureProgramProposalV1, BoundedFeatureProposalDecisionBranchV1,
        BoundedFeatureProposalDecisionTableV1, BoundedFeatureProposalFrameV1,
        BoundedFeatureTerminalConversionV1, BoundedFeatureTerminalOutputV1,
        BoundedFeatureValueRefV1, BoundedFeatureWarmupContractV1, BoundedFeatureWarmupPostStateV1,
        CanonicalBoundedFeatureProgramV1, OWNER_SAMPLE_COORDINATE_SOURCE_V1, manifest_width,
        prepare_bounded_feature_program_v1,
    },
    strategy_design_v2::{
        CapabilityDeclarationV2, ComputeNodeV2, InputFactClassV2, InputRoleV2, InputScopeV2,
        LifecycleKindV2, PluginManifestV2, PluginStateContractV2, PortBindingV2, PortContractV2,
        ProposalWiringV2, ReactionGraphV2, ResourceBoundsV2, STRATEGY_DESIGN_SCHEMA_V2,
        StateCellV2, StateWriteV2, StrategyDesignV2, TypedConstantV2, ValueRefV2, ValueTypeV2,
    },
    strategy_plan_v2::{
        UNIVERSE_CLOSE_FIELD_SEMANTIC_ID_V2, UNIVERSE_OPEN_FIELD_SEMANTIC_ID_V2,
        coordinate_port_id, strategy_input_role_identity_v2, universe_member_role_v2,
    },
};

/// The bounded plugin every program in this family is authored against.
const PLUGIN_SEMANTIC_ID: &str = "research.plugin.bfp.v1";
/// The capability the bounded plugin runs under.
const CAPABILITY_SEMANTIC_ID: &str = "research.bfp.v1";
/// The Design state cell carrying the plugin's own serialized state.
const PLUGIN_STATE_CELL: &str = "research.state.bfp.v1";
/// Plugin state ports. The post port is named by the bounded ABI, not by this module.
const PLUGIN_STATE_PRE_PORT: &str = "plugin.state.pre.v1";
const PLUGIN_STATE_POST_PORT: &str = "plugin.state.post.v1";
/// The compute node the consuming reaction calls.
///
/// One of these two is bounded and the other is empty, decided by the input's Owner data kind.
/// Both were bounded until the Composer refused the result: a Bar-triggered and an Event-triggered
/// consumer of the same role contradict each other for every possible input.
const BAR_NODE: &str = "research.node.bfp.bar.v1";
const EVENT_NODE: &str = "research.node.bfp.event.v1";
/// The one graph node: the channel compared against the threshold.
const COMPARISON_NODE: &str = "channel-against-threshold";
/// The manifest port the channel's value arrives on.
const CHANNEL_VALUE_PORT: &str = "input.channel.v1";
/// Plugin input port the carried role's value arrives on, in the form that has one.
const CARRIED_VALUE_PORT: &str = "input.carried.v1";
/// How wide the plugin's serialized state may be.
const PLUGIN_STATE_MAX_BYTES: u32 = 4096;

/// The one channel this family reads, as the author declares it, and which instrument it is read
/// for.
///
/// `scope` is required and has no default: a request that did not say which form it is must not
/// become the exact-instrument form by omission. `channel` and `fact_class` are absent from both
/// forms on purpose: the family reads Market Data, and an author that could name another Owner would
/// be authoring a different family.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "scope",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum SingleThresholdChannelV1 {
    /// A channel read for one instrument the author names.
    ExactInstrument {
        /// Identifier the Design and the graph both use for this role.
        role_semantic_id: String,
        /// Instrument the channel is read for.
        instrument: String,
        /// Market Data fact this channel carries.
        field_semantic_id: String,
        /// Bar timeframe.
        timeframe: String,
        /// Unit of the channel's value.
        unit: String,
        /// Fixed-point scale of the channel's value.
        scale: u8,
    },
    /// The daily close of the one member of an Owner universe, which Market Data selects when the
    /// run is requested rather than the author here.
    ///
    /// The field, timeframe, unit and scale are the universe vertical's fixed contract, so they are
    /// not asked: an author could only restate them or disagree. The vertical also fixes an `OPEN`
    /// role beside `CLOSE`; the program carries it without reading it, and the author names it
    /// because it is a Design role like any other.
    UniverseMember {
        /// Identifier of the `CLOSE` role, the channel the graph reads and its decision clock.
        close_role_semantic_id: String,
        /// Identifier of the carried `OPEN` role.
        open_role_semantic_id: String,
    },
}

impl SingleThresholdChannelV1 {
    /// The role the graph reads and takes its decision clock from.
    fn role(&self) -> &str {
        match self {
            Self::ExactInstrument {
                role_semantic_id, ..
            } => role_semantic_id,
            Self::UniverseMember {
                close_role_semantic_id,
                ..
            } => close_role_semantic_id,
        }
    }

    /// The Design role of the channel.
    fn role_v2(&self) -> InputRoleV2 {
        match self {
            Self::ExactInstrument {
                role_semantic_id,
                instrument,
                field_semantic_id,
                timeframe,
                unit,
                scale,
            } => InputRoleV2 {
                semantic_id: role_semantic_id.clone(),
                fact_class: InputFactClassV2::MarketData,
                instrument: instrument.clone(),
                scope: InputScopeV2::ExactInstrument,
                field_semantic_id: field_semantic_id.clone(),
                channel: "MARKET".to_owned(),
                timeframe: timeframe.clone(),
                unit: unit.clone(),
                scale: *scale,
                value_type: ValueTypeV2::I128,
            },
            Self::UniverseMember {
                close_role_semantic_id,
                ..
            } => {
                universe_member_role_v2(close_role_semantic_id, UNIVERSE_CLOSE_FIELD_SEMANTIC_ID_V2)
            }
        }
    }

    /// The Design role the program carries without reading, if this form has one.
    fn carried_role_v2(&self) -> Option<InputRoleV2> {
        match self {
            Self::ExactInstrument { .. } => None,
            Self::UniverseMember {
                open_role_semantic_id,
                ..
            } => Some(universe_member_role_v2(
                open_role_semantic_id,
                UNIVERSE_OPEN_FIELD_SEMANTIC_ID_V2,
            )),
        }
    }
}

/// What the program proposes on one side of the threshold.
///
/// The eleven terminal outputs a frame must carry are not all here. The five this type leaves out -
/// rebalance and the four protection values - are the same on both sides of a single threshold, so
/// asking for them twice could only produce a disagreement the author did not mean. The four that
/// are here make one side a different proposal from the other, and two more follow from them: the
/// reconciliation target, which the kernel requires to equal a position target, so each frame reads
/// it from its own side's target position; and the protection variant, which the kernel requires
/// to clear on an exit and refuses to clear otherwise, so each frame reads it from its own side's
/// position intent.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SingleThresholdOutcomeV1 {
    /// Lifecycle position intent, e.g. `kernel.position.enter.v1`.
    pub position_intent_semantic_id: String,
    /// Lifecycle target variant, e.g. `kernel.target.position.v1`.
    pub target_variant_semantic_id: String,
    /// Target position in units.
    pub target_position_units: i64,
    /// Target weight in micros of account equity, read only by a `kernel.target.weight.v1` side;
    /// the target-set Host turns it into a grid position at reconciliation. A request that names
    /// no weight omits it, and it reads as 0, so such a request keeps its bytes.
    #[serde(default, skip_serializing_if = "is_zero_weight")]
    pub target_weight_micros: i32,
}

#[allow(
    clippy::trivially_copy_pass_by_ref,
    reason = "serde passes the field by reference"
)]
const fn is_zero_weight(weight_micros: &i32) -> bool {
    *weight_micros == 0
}

/// The one target variant that reads a side's weight.
const WEIGHT_TARGET: &str = "kernel.target.weight.v1";

/// Everything an author decides about one single-threshold program.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SingleThresholdAuthoringRequestV1 {
    /// The Research Request this program answers. An author does not invent it.
    pub research_request_identity: BindingDigest,
    /// The Research Intent identity the Request carries.
    pub intent_identity: BindingDigest,
    /// The Research Intent digest the Request carries.
    pub intent_digest: BindingDigest,
    /// The one channel read, which is also the decision clock.
    pub channel: SingleThresholdChannelV1,
    /// The threshold, in the channel's own unit, as a decimal such as `"120"` or `"-0.5"`.
    ///
    /// The comparison primitive is equal-scale, so the author converts it exactly to the channel's
    /// scale and the Design stores that integer: a universe-member channel reads at Market Data's
    /// value scale, so `"120"` is the same threshold whatever instrument the scope names. Equivalent
    /// spellings, `"120"` and `"120.000"`, are one threshold; a value finer than the channel's scale
    /// is refused rather than rounded. `canonical_threshold_text` is its one spelling.
    pub threshold: String,
    /// How the channel is compared against the threshold.
    pub comparison: BoundedFeaturePredicateV1,
    /// What to propose when the comparison holds.
    pub when_true: SingleThresholdOutcomeV1,
    /// What to propose otherwise.
    pub otherwise: SingleThresholdOutcomeV1,
    /// Leave a held position once the bar close has moved this fraction against its entry close,
    /// as an exact decimal such as `"0.02"`.
    ///
    /// The exit is judged on the close and proposed at it, so it fills on the next frame, not at
    /// the stop level inside a bar. A request that omits it keeps its bytes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_loss_fraction: Option<String>,
    /// Leave a held position once the bar close has moved this fraction in its favour from its
    /// entry close, judged and filled as `stop_loss_fraction` is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub take_profit_fraction: Option<String>,
    /// Leave a held position on the frame this many frames after the frame that entered it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_holding_bars: Option<u32>,
    /// The statement this program can be wrong about.
    pub falsifier: String,
}

/// Why a request could not be authored into a program.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SingleThresholdAuthoringErrorV1 {
    /// A declared identifier is empty or padded.
    #[error("{0} must be a non-empty exact value")]
    Identifier(&'static str),
    /// Both sides of the threshold propose the same thing.
    ///
    /// Such a program assembles and prepares: the decision table is well-formed, the branch is
    /// reachable, and every terminal resolves. It simply cannot act on the comparison it declares,
    /// so the threshold it was authored around has no observable effect. Refusing it here is the
    /// difference between a program and a well-formed document.
    #[error(
        "both sides of the threshold propose the same frame, so the comparison cannot change a proposal"
    )]
    IndistinguishableOutcomes,
    /// The declared field semantic is not one the Owner resolves.
    ///
    /// The Owner's data kind decides which lifecycle may consume the input, so a semantic the
    /// Owner cannot resolve leaves that undecidable. Refusing here rather than guessing keeps the
    /// authored Design from being one the Composer must reject later, where the refusal would read
    /// as a fault of the program rather than of the request.
    #[error("channel.field_semantic_id {0} is not a field semantic this Owner resolves")]
    UnknownFieldSemantic(String),
    /// A side names a weight its target variant does not read.
    ///
    /// Only a weight target reads a weight, so on any other side it would be carried into the
    /// program and ignored, and the request would state a strategy the program does not run.
    #[error(
        "SINGLE_THRESHOLD_WEIGHT_NOT_READ: {field} is nonzero, and only a {WEIGHT_TARGET} side reads it"
    )]
    WeightNotRead { field: &'static str },
    /// A side names a weight outside the kernel's domain of -1,000,000 to 1,000,000 micros.
    #[error("SINGLE_THRESHOLD_WEIGHT_OUT_OF_RANGE: {field} is outside -1000000..=1000000 micros")]
    WeightOutOfRange { field: &'static str },
    /// A side proposes an intent the kernel refuses from every position the program can hold.
    ///
    /// The program proposes a side only from a position the kernel accepts it at, so such a side
    /// would never be proposed, and the request would state a strategy the program does not run:
    /// an exit with no side that enters, say.
    #[error(
        "SINGLE_THRESHOLD_SIDE_NEVER_PERMITTED: {field} is refused by the kernel from every position this program can hold"
    )]
    SideNeverPermitted { field: &'static str },
    /// An exit fraction is not a decimal strictly between 0 and 1 in its one canonical spelling.
    #[error(
        "SINGLE_THRESHOLD_EXIT_FRACTION_INVALID: {field} must be a decimal strictly between 0 and 1, written as 0. and its digits with no trailing zero, such as \"0.02\""
    )]
    ExitFractionInvalid { field: &'static str },
    /// An exit fraction has more decimal places than the channel's scale leaves room for.
    #[error(
        "SINGLE_THRESHOLD_EXIT_FRACTION_TOO_PRECISE: {field} and the channel's scale together exceed 38 decimal places"
    )]
    ExitFractionTooPrecise { field: &'static str },
    /// A price exit is asked of a channel that is not the bar close.
    ///
    /// The exits compare the close with the close the position was entered at, so on any other
    /// channel they would compare something that is not a price.
    #[error(
        "SINGLE_THRESHOLD_EXIT_NEEDS_CLOSE_CHANNEL: {field} is judged on the bar close, and the channel reads {channel}"
    )]
    ExitNeedsCloseChannel {
        field: &'static str,
        channel: String,
    },
    /// The threshold is not a decimal: an optional `-`, digits without a leading zero, and an
    /// optional `.` with digits.
    #[error(
        "THRESHOLD_INVALID: threshold must be a decimal such as \"120\" or \"-0.5\", without a sign of +, a leading zero, an exponent or whitespace"
    )]
    ThresholdInvalid,
    /// The threshold has more decimal places than the channel's scale, so the channel cannot hold
    /// it exactly.
    #[error(
        "THRESHOLD_FINER_THAN_CHANNEL_SCALE: threshold has more decimal places than the channel's scale of {scale}"
    )]
    ThresholdFinerThanChannelScale { scale: u8 },
    /// The threshold at the channel's scale does not fit a fixed-point I128.
    #[error(
        "THRESHOLD_OVERFLOWS_CHANNEL_SCALE: threshold does not fit an I128 at the channel's scale of {scale}"
    )]
    ThresholdOverflowsChannelScale { scale: u8 },
    /// A holding limit of zero frames, which would leave a position on the frame that enters it.
    #[error("SINGLE_THRESHOLD_MAX_HOLDING_BARS_ZERO: max_holding_bars must be at least 1")]
    MaxHoldingBarsZero,
    /// An exit is asked of a program no side of which ever holds a position.
    #[error(
        "SINGLE_THRESHOLD_EXIT_WITHOUT_POSITION: {field} is set, and no side opens a position for it to leave"
    )]
    ExitWithoutPosition { field: &'static str },
}

impl SingleThresholdAuthoringErrorV1 {
    /// The refusal's stable name, which a caller branches on instead of parsing the message.
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Identifier(_) => "SINGLE_THRESHOLD_IDENTIFIER_NOT_EXACT",
            Self::IndistinguishableOutcomes => "SINGLE_THRESHOLD_INDISTINGUISHABLE_OUTCOMES",
            Self::UnknownFieldSemantic(_) => "SINGLE_THRESHOLD_UNKNOWN_FIELD_SEMANTIC",
            Self::WeightNotRead { .. } => "SINGLE_THRESHOLD_WEIGHT_NOT_READ",
            Self::WeightOutOfRange { .. } => "SINGLE_THRESHOLD_WEIGHT_OUT_OF_RANGE",
            Self::SideNeverPermitted { .. } => "SINGLE_THRESHOLD_SIDE_NEVER_PERMITTED",
            Self::ExitFractionInvalid { .. } => "SINGLE_THRESHOLD_EXIT_FRACTION_INVALID",
            Self::ExitFractionTooPrecise { .. } => "SINGLE_THRESHOLD_EXIT_FRACTION_TOO_PRECISE",
            Self::ExitNeedsCloseChannel { .. } => "SINGLE_THRESHOLD_EXIT_NEEDS_CLOSE_CHANNEL",
            Self::MaxHoldingBarsZero => "SINGLE_THRESHOLD_MAX_HOLDING_BARS_ZERO",
            Self::ExitWithoutPosition { .. } => "SINGLE_THRESHOLD_EXIT_WITHOUT_POSITION",
            Self::ThresholdInvalid => "THRESHOLD_INVALID",
            Self::ThresholdFinerThanChannelScale { .. } => "THRESHOLD_FINER_THAN_CHANNEL_SCALE",
            Self::ThresholdOverflowsChannelScale { .. } => "THRESHOLD_OVERFLOWS_CHANNEL_SCALE",
        }
    }
}

/// Authors one single-threshold program: the Design it needs and the meaning a proposer declares.
///
/// The pair is returned together because neither half is checkable alone. Declared meaning names
/// a plugin, input roles and manifest ports, and only the Design says whether those exist; a
/// Design admits a shape of program, and only the meaning says which one. `declare` is handed
/// both, and so is the caller here.
///
/// # Errors
///
/// Returns [`SingleThresholdAuthoringErrorV1`] when a declared identifier is empty or padded, or
/// when both sides of the threshold propose the same frame.
pub fn author_single_threshold_program_v1(
    request: &SingleThresholdAuthoringRequestV1,
) -> Result<(StrategyDesignV2, BoundedFeatureProgramMeaningV1), SingleThresholdAuthoringErrorV1> {
    match &request.channel {
        SingleThresholdChannelV1::ExactInstrument {
            role_semantic_id,
            instrument,
            field_semantic_id,
            timeframe,
            unit,
            scale: _,
        } => {
            exact(role_semantic_id, "channel.role_semantic_id")?;
            exact(instrument, "channel.instrument")?;
            exact(field_semantic_id, "channel.field_semantic_id")?;
            exact(timeframe, "channel.timeframe")?;
            exact(unit, "channel.unit")?;
        }
        SingleThresholdChannelV1::UniverseMember {
            close_role_semantic_id,
            open_role_semantic_id,
        } => {
            exact(close_role_semantic_id, "channel.close_role_semantic_id")?;
            exact(open_role_semantic_id, "channel.open_role_semantic_id")?;
        }
    }
    exact(&request.falsifier, "falsifier")?;

    for (outcome, position_field, target_field, weight_field) in [
        (
            &request.when_true,
            "when_true.position_intent_semantic_id",
            "when_true.target_variant_semantic_id",
            "when_true.target_weight_micros",
        ),
        (
            &request.otherwise,
            "otherwise.position_intent_semantic_id",
            "otherwise.target_variant_semantic_id",
            "otherwise.target_weight_micros",
        ),
    ] {
        exact(&outcome.position_intent_semantic_id, position_field)?;
        exact(&outcome.target_variant_semantic_id, target_field)?;

        if !(-1_000_000..=1_000_000).contains(&outcome.target_weight_micros) {
            return Err(SingleThresholdAuthoringErrorV1::WeightOutOfRange {
                field: weight_field,
            });
        }

        if outcome.target_weight_micros != 0 && outcome.target_variant_semantic_id != WEIGHT_TARGET
        {
            return Err(SingleThresholdAuthoringErrorV1::WeightNotRead {
                field: weight_field,
            });
        }
    }

    // Checked before anything is built, because the two frames are what the rest of the program
    // exists to choose between.
    if request.when_true == request.otherwise {
        return Err(SingleThresholdAuthoringErrorV1::IndistinguishableOutcomes);
    }

    // The Owner's data kind decides which lifecycle may consume this input. `strategy_plan_v2`
    // maps BAR to Bar and QUOTE/TRADE/REFERENCE/ECONOMIC/SCALAR to Event, then requires the
    // consuming reaction's kind to equal it. This surface emitted both a Bar-triggered and an
    // Event-triggered consumer of the same role, which is refused for every possible input:
    // whichever kind the binding carries, the other reaction contradicts it.
    let channel = request.channel.role_v2();
    let semantic =
        MarketDataFieldSemantic::from_identity(&channel.field_semantic_id).ok_or_else(|| {
            SingleThresholdAuthoringErrorV1::UnknownFieldSemantic(channel.field_semantic_id.clone())
        })?;
    let bar_triggered = semantic.data_kind() == "BAR";
    let threshold = threshold_coefficient_v1(&request.threshold, channel.scale)?;
    let exits = exit_plan(request)?;
    let positions = PositionBelief::of(request)?;

    if let Some(field) = exits.first_field().filter(|_| !positions.holds_any()) {
        return Err(SingleThresholdAuthoringErrorV1::ExitWithoutPosition { field });
    }
    let design = design_for(request, bar_triggered);
    let meaning = meaning_for(request, threshold, &positions, &exits);
    Ok((design, meaning))
}

/// Refuses an identifier that is empty, or that carries surrounding whitespace.
fn exact(value: &str, field: &'static str) -> Result<(), SingleThresholdAuthoringErrorV1> {
    if value.is_empty() || value.trim() != value {
        return Err(SingleThresholdAuthoringErrorV1::Identifier(field));
    }
    Ok(())
}

/// The threshold `text` as an exact coefficient at `scale`.
///
/// `text` is an optional `-`, an integer part with no leading zero but `0` itself, and an optional
/// `.` followed by digits; trailing fractional zeros are allowed, so `"120"`, `"120.0"` and
/// `"120.000"` are one value. The conversion is Market Data's exact rescale, the one every value
/// alignment uses, so nothing here rounds.
///
/// # Errors
///
/// Refuses text that is not such a decimal, a value finer than `scale`, and one that does not fit.
pub(crate) fn threshold_coefficient_v1(
    text: &str,
    scale: u8,
) -> Result<i128, SingleThresholdAuthoringErrorV1> {
    let (negative, unsigned) = text
        .strip_prefix('-')
        .map_or((false, text), |rest| (true, rest));
    let (whole, fraction) = unsigned.split_once('.').unwrap_or((unsigned, ""));

    if whole.is_empty()
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || (whole.len() > 1 && whole.starts_with('0'))
        || (unsigned.contains('.') && fraction.is_empty())
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(SingleThresholdAuthoringErrorV1::ThresholdInvalid);
    }
    let places = u8::try_from(fraction.len())
        .map_err(|_| SingleThresholdAuthoringErrorV1::ThresholdInvalid)?;
    let magnitude: i128 = format!("{whole}{fraction}")
        .parse()
        .map_err(|_| SingleThresholdAuthoringErrorV1::ThresholdOverflowsChannelScale { scale })?;
    let mantissa = if negative { -magnitude } else { magnitude };

    rescale_exact_v1(mantissa, places, scale).map_err(|e| match e {
        RescaleErrorV1::FinerThanTarget => {
            SingleThresholdAuthoringErrorV1::ThresholdFinerThanChannelScale { scale }
        }
        RescaleErrorV1::Overflow => {
            SingleThresholdAuthoringErrorV1::ThresholdOverflowsChannelScale { scale }
        }
    })
}

/// The one spelling of a request's threshold at its channel's scale, which is what a statement's
/// identity hashes.
///
/// # Errors
///
/// Returns the threshold's refusal when the channel cannot hold it exactly.
pub(crate) fn canonical_threshold_of_v1(
    channel: &SingleThresholdChannelV1,
    threshold: &str,
) -> Result<String, SingleThresholdAuthoringErrorV1> {
    let scale = channel.role_v2().scale;
    Ok(canonical_threshold_text(
        threshold_coefficient_v1(threshold, scale)?,
        scale,
    ))
}

/// The one spelling of a threshold `coefficient` at `scale`: no trailing fractional zero, no `.`
/// for a whole value, and `0` for zero. [`threshold_coefficient_v1`] reads it back exactly, and
/// reads every equivalent spelling to the same coefficient, so a request recovered from its
/// program, and anything keyed by a canonical request, names the threshold one way.
#[must_use]
pub(crate) fn canonical_threshold_text(coefficient: i128, scale: u8) -> String {
    let digits = coefficient.unsigned_abs().to_string();
    let scale = usize::from(scale);
    let padded = format!("{digits:0>width$}", width = scale + 1);
    let (whole, fraction) = padded.split_at(padded.len() - scale);
    let fraction = fraction.trim_end_matches('0');
    let sign = if coefficient < 0 { "-" } else { "" };

    if fraction.is_empty() {
        format!("{sign}{whole}")
    } else {
        format!("{sign}{whole}.{fraction}")
    }
}

/// One Design role the plugin receives, with the value port it arrives on and the coordinate port
/// its Owner sample coordinate arrives on.
struct ReceivedRole {
    role: InputRoleV2,
    value_port: &'static str,
    coordinate_port: String,
}

impl ReceivedRole {
    fn new(role: InputRoleV2, value_port: &'static str) -> Self {
        let coordinate_port = coordinate_port_id(strategy_input_role_identity_v2(&role));
        Self {
            role,
            value_port,
            coordinate_port,
        }
    }

    /// The two plugin input bindings of this role.
    ///
    /// An exact-instrument role is read as itself. A universe-member role is read at member 0: the
    /// program emits one instrument's proposal, and under a one-member universe the host lifts it
    /// into the universe's target set.
    fn bindings(&self) -> [PortBindingV2; 2] {
        let input_id = self.role.semantic_id.clone();
        let source_semantic_id = format!("{OWNER_SAMPLE_COORDINATE_SOURCE_V1}({input_id})");
        let (value, coordinate) = match self.role.scope {
            InputScopeV2::ExactInstrument => (
                ValueRefV2::Input {
                    input_id: input_id.clone(),
                },
                ValueRefV2::OwnerSampleCoordinate {
                    input_id,
                    source_semantic_id,
                },
            ),
            InputScopeV2::UniverseMembers => (
                ValueRefV2::UniverseMemberInput {
                    input_id: input_id.clone(),
                    member_ordinal: 0,
                },
                ValueRefV2::UniverseMemberSampleCoordinate {
                    input_id,
                    member_ordinal: 0,
                    source_semantic_id,
                },
            ),
        };
        [
            PortBindingV2 {
                port_id: self.value_port.to_owned(),
                source: value,
            },
            PortBindingV2 {
                port_id: self.coordinate_port.clone(),
                source: coordinate,
            },
        ]
    }
}

fn design_for(
    request: &SingleThresholdAuthoringRequestV1,
    bar_triggered: bool,
) -> StrategyDesignV2 {
    let mut received = vec![ReceivedRole::new(
        request.channel.role_v2(),
        CHANNEL_VALUE_PORT,
    )];
    received.extend(
        request
            .channel
            .carried_role_v2()
            .map(|role| ReceivedRole::new(role, CARRIED_VALUE_PORT)),
    );
    // The host binds a plugin's inputs to its manifest ports by position, so the node's bindings
    // and the manifest's ports are listed in one order, the canonical one of the port ids.
    let mut bindings = received
        .iter()
        .flat_map(ReceivedRole::bindings)
        .collect::<Vec<_>>();
    bindings.sort_by(|a, b| a.port_id.as_bytes().cmp(b.port_id.as_bytes()));
    let input_ports = bindings
        .iter()
        .map(|binding| match binding.source {
            ValueRefV2::Input { .. } | ValueRefV2::UniverseMemberInput { .. } => PortContractV2 {
                semantic_id: binding.port_id.clone(),
                value_type: ValueTypeV2::I128,
                max_bytes: 16,
            },
            _ => PortContractV2 {
                semantic_id: binding.port_id.clone(),
                value_type: ValueTypeV2::Bytes,
                max_bytes: 308,
            },
        })
        .collect();

    // An exact-instrument role is consumed only by the lifecycle its Owner data kind triggers:
    // the Plan refuses a BAR role read by the EVENT reaction, and the reverse. A universe frame
    // carries both kinds, and the universe vertical requires exactly one compute node in each of
    // BAR and EVENT, so the universe-member form reads its roles in both.
    let universe = request.channel.role_v2().scope == InputScopeV2::UniverseMembers;
    let reacts_to_bar = universe || bar_triggered;
    let reacts_to_event = universe || !bar_triggered;

    let manifest = PluginManifestV2 {
        semantic_id: PLUGIN_SEMANTIC_ID.to_owned(),
        abi_version: BOUNDED_FEATURE_PLUGIN_ABI_V1,
        input_ports,
        output_ports: BOUNDED_FEATURE_PROPOSAL_OUTPUT_PORTS_V1
            .iter()
            .map(|(semantic_id, value_type)| PortContractV2 {
                semantic_id: (*semantic_id).to_owned(),
                value_type: *value_type,
                max_bytes: manifest_width(*value_type)
                    .expect("every proposal output port carries a bounded lifecycle value"),
            })
            .collect(),
        state: PluginStateContractV2 {
            pre_port_id: PLUGIN_STATE_PRE_PORT.to_owned(),
            post_port_id: PLUGIN_STATE_POST_PORT.to_owned(),
            value_type: ValueTypeV2::Bytes,
            max_bytes: PLUGIN_STATE_MAX_BYTES,
        },
        capability_ids: vec![CAPABILITY_SEMANTIC_ID.to_owned()],
        // Measured per invocation on the Sim: about 86,000 for a program with no exits, 205,000
        // with a price exit, and 378,000 for the family's largest program, which names every
        // exit and enters in both directions. The 100,000 this was before is what that largest
        // program's measurement replaced: it ran out on its first frame.
        max_fuel: FAMILY_MAX_FUEL,
        max_linear_memory_bytes: 1_048_576,
        max_invocations_per_event: 1,
        failure_semantic_id: BOUNDED_FEATURE_NUMERIC_FAILURE_V1.to_owned(),
    };

    StrategyDesignV2 {
        schema_version: STRATEGY_DESIGN_SCHEMA_V2,
        research_request_identity: request.research_request_identity,
        intent_identity: request.intent_identity,
        intent_digest: request.intent_digest,
        inputs: received
            .iter()
            .map(|received| received.role.clone())
            .collect(),
        joins: vec![],
        // One channel joins nothing and needs no parameter: the threshold is a frozen graph
        // constant, not a Design parameter, because a proposer declares it and the Design does not.
        parameters: vec![],
        state: vec![StateCellV2 {
            semantic_id: PLUGIN_STATE_CELL.to_owned(),
            value_type: ValueTypeV2::Bytes,
            initial: TypedConstantV2::Bytes { value: vec![] },
            max_bytes: PLUGIN_STATE_MAX_BYTES,
        }],
        reactions: vec![
            empty_reaction(LifecycleKindV2::Start),
            if reacts_to_bar {
                bounded_reaction(LifecycleKindV2::Bar, BAR_NODE, &bindings)
            } else {
                empty_reaction(LifecycleKindV2::Bar)
            },
            if reacts_to_event {
                bounded_reaction(LifecycleKindV2::Event, EVENT_NODE, &bindings)
            } else {
                empty_reaction(LifecycleKindV2::Event)
            },
            empty_reaction(LifecycleKindV2::Fill),
            empty_reaction(LifecycleKindV2::Timer),
            empty_reaction(LifecycleKindV2::Stop),
        ],
        capabilities: vec![CapabilityDeclarationV2 {
            semantic_id: CAPABILITY_SEMANTIC_ID.to_owned(),
            version: 1,
            dependencies: vec![],
        }],
        plugins: vec![manifest],
        resources: ResourceBoundsV2 {
            max_inputs: u16::try_from(received.len()).expect("a form declares at most two roles"),
            max_nodes_per_reaction: 1,
            max_dependency_edges: 256,
            max_state_bytes: PLUGIN_STATE_MAX_BYTES,
            max_plugin_calls_per_event: 1,
        },
        falsifier: request.falsifier.clone(),
    }
}

/// A lifecycle the bounded plugin does not react to.
fn empty_reaction(kind: LifecycleKindV2) -> ReactionGraphV2 {
    ReactionGraphV2 {
        kind,
        nodes: vec![],
        state_writes: vec![],
        proposal: None,
    }
}

/// A lifecycle that calls the bounded plugin and wires its eleven outputs to the proposal.
fn bounded_reaction(
    kind: LifecycleKindV2,
    node_id: &str,
    bindings: &[PortBindingV2],
) -> ReactionGraphV2 {
    let compute = ComputeNodeV2 {
        semantic_id: node_id.to_owned(),
        plugin_semantic_id: PLUGIN_SEMANTIC_ID.to_owned(),
        input_bindings: bindings.to_vec(),
        pre_state: ValueRefV2::PriorState {
            state_id: PLUGIN_STATE_CELL.to_owned(),
        },
        output_port_ids: BOUNDED_FEATURE_PROPOSAL_OUTPUT_PORTS_V1
            .iter()
            .map(|(id, _)| (*id).to_owned())
            .collect(),
        post_state_port_id: PLUGIN_STATE_POST_PORT.to_owned(),
    };
    let wire = |index: usize| ValueRefV2::NodeOutput {
        node_id: node_id.to_owned(),
        port_id: BOUNDED_FEATURE_PROPOSAL_OUTPUT_PORTS_V1[index].0.to_owned(),
    };
    ReactionGraphV2 {
        kind,
        nodes: vec![compute],
        state_writes: vec![StateWriteV2 {
            state_id: PLUGIN_STATE_CELL.to_owned(),
            source: ValueRefV2::NodeOutput {
                node_id: node_id.to_owned(),
                port_id: PLUGIN_STATE_POST_PORT.to_owned(),
            },
        }],
        proposal: Some(ProposalWiringV2 {
            position_intent: wire(0),
            target_variant: wire(1),
            target_position_units: wire(2),
            target_weight_micros: wire(3),
            rebalance_sequence: wire(4),
            reconciliation_target_units: wire(5),
            protection_variant: wire(6),
            stop_loss_ticks: wire(7),
            take_profit_ticks: wire(8),
            trailing_distance_ticks: wire(9),
            trailing_stop_ticks: wire(10),
            member_target_set: None,
        }),
    }
}

/// Constant ids. The two sides carry their own five, which is what makes the frames differ.
///
/// There is no reconciliation constant. A position target and its reconciliation target must be
/// equal, and when they were one shared constant for both sides, a program whose sides held
/// different positions could not enter at all: its entry side proposed a position of 1 reconciled
/// to 0, and the target-set Host refused it before the first order.
const THRESHOLD: &str = "threshold";
const TRUE_POSITION: &str = "when-true-position";
const TRUE_TARGET: &str = "when-true-target";
const TRUE_TARGET_POSITION: &str = "when-true-target-position";
const FALSE_POSITION: &str = "otherwise-position";
const FALSE_TARGET: &str = "otherwise-target";
const FALSE_TARGET_POSITION: &str = "otherwise-target-position";
const TRUE_PROTECTION: &str = "when-true-protection";
const FALSE_PROTECTION: &str = "otherwise-protection";
const TRUE_TARGET_WEIGHT: &str = "when-true-target-weight";
const FALSE_TARGET_WEIGHT: &str = "otherwise-target-weight";
const REBALANCE: &str = "rebalance";
const STOP_LOSS: &str = "stop-loss";
const TAKE_PROFIT: &str = "take-profit";
const TRAILING_DISTANCE: &str = "trailing-distance";
const TRAILING_STOP: &str = "trailing-stop";
/// The frame proposed when neither side may be proposed from the position the program holds.
const HOLD_IDS: FrameIds = (
    "hold-position",
    "hold-target",
    "hold-target-position",
    "hold-target-weight",
    "hold-protection",
);
/// The frame an exit proposes.
const EXIT_IDS: FrameIds = (
    "exit-position",
    "exit-target",
    "exit-target-position",
    "exit-target-weight",
    "exit-protection",
);

/// One frame's five constant ids: intent, target, target position, target weight, protection.
type FrameIds = (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
);

/// Units of the values the graph computes for itself. None of them reaches a terminal, so each is
/// only a name that keeps one kind of value from being compared with another.
const POSITION_UNIT: &str = "POSITION_NOMINAL";
const BARS_UNIT: &str = "BARS";
const RATIO_UNIT: &str = "RATIO";

/// The position the program believes it holds after the frame it last proposed.
const BELIEVED_POSITION: &str = "believed-position";
const BELIEVED_POSITION_WRITER: &str = "next-believed-position";
/// The close of the last frame at which the program believed itself flat: once it holds a
/// position, that is the close of the frame that entered it.
const ENTRY_CLOSE: &str = "entry-close";
const ENTRY_CLOSE_WRITER: &str = "next-entry-close";
const ENTRY_CLOSE_SEED: &str = "entry-close-seed";
/// Frames since the frame that entered the position, 0 while flat.
const BARS_HELD: &str = "bars-held";
const BARS_HELD_WRITER: &str = "next-bars-held";
const NO_BARS: &str = "bars-none";
const MAX_HOLDING_BARS: &str = "max-holding-bars";
/// Exit factor constants, one per exit and direction, as `{exit}-{direction}-factor`.
const STOP_LOSS_EXIT: &str = "stop-loss";
const TAKE_PROFIT_EXIT: &str = "take-profit";

/// The fuel every program of this family may burn in one invocation: about two and a half times
/// what its largest program was measured to burn.
const FAMILY_MAX_FUEL: u64 = 1_000_000;

/// The bounds every program of this family declares.
///
/// Fixed for the family, not counted per program, so that a request's graph bounds never depend
/// on which exits it names. Each is the most the family's largest program uses, which
/// `the_family_bounds_are_the_largest_programs_shape` measures, so none is a guess.
///
/// The largest program names every exit and enters in both directions, one side long and one
/// short. Every other side pair admits each side from at most one believed position and faces at
/// most one direction, so it builds a subset of that program's nodes and constants.
const FAMILY_GRAPH_BOUNDS: BoundedFeatureGraphBoundsV1 = BoundedFeatureGraphBoundsV1 {
    max_nodes: 34,
    max_edges: 132,
    max_depth: 10,
    max_ports: 119,
    max_constants: 40,
    max_fan_out: 10,
    // The graph declares no lag and no rolling window, and a zero bound is refused outright, so
    // both carry the smallest bound a program may state.
    max_lag: 1,
    max_window: 1,
    max_state_cells: 3,
    max_decision_branches: 3,
    max_source_bytes: 262_144,
    max_wasm_bytes: 1_048_576,
};

/// A side's position intent, as far as the kernel's transition rule distinguishes them.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Intent {
    Hold,
    Enter,
    Add,
    Reduce,
    Exit,
}

impl Intent {
    /// The intent a side names, or `None` for an identifier the catalog would refuse anyway.
    fn of(outcome: &SingleThresholdOutcomeV1) -> Option<Self> {
        match outcome.position_intent_semantic_id.as_str() {
            "kernel.position.hold.v1" => Some(Self::Hold),
            "kernel.position.enter.v1" => Some(Self::Enter),
            "kernel.position.add.v1" => Some(Self::Add),
            "kernel.position.reduce.v1" => Some(Self::Reduce),
            "kernel.position.exit.v1" => Some(Self::Exit),
            _ => None,
        }
    }

    /// Whether the kernel accepts this intent from `current` to `target`.
    ///
    /// This is `validate_position_transition` in the program SDK, restated: a proposal it refuses
    /// aborts the whole run, so the program may only propose what it accepts.
    fn permits(self, current: i64, target: i64) -> bool {
        let same_direction = target.signum() == current.signum();

        match self {
            Self::Hold => true,
            Self::Enter => current == 0 && target != 0,
            Self::Add => {
                current != 0 && same_direction && target.unsigned_abs() > current.unsigned_abs()
            }
            Self::Reduce => {
                current != 0
                    && target != 0
                    && same_direction
                    && target.unsigned_abs() < current.unsigned_abs()
            }
            Self::Exit => current != 0 && target == 0,
        }
    }
}

/// The position a side leaves the program at, as one signed number for a unit target and a weight
/// target alike.
///
/// A weight target's units are derived by the Host at reconciliation, so the weight stands for
/// them: its sign is the position's direction, and 0 is flat, which is all an entry and an exit
/// are judged by.
fn nominal_position(outcome: &SingleThresholdOutcomeV1) -> i64 {
    if outcome.target_variant_semantic_id == WEIGHT_TARGET {
        i64::from(outcome.target_weight_micros)
    } else {
        outcome.target_position_units
    }
}

/// Which positions the program can hold, and from which of them each side may be proposed.
///
/// The kernel accepts an entry only from flat and an exit only from a held position, and a proposal
/// it refuses aborts the run (`program_host_v2.rs`). A program that proposed its entry on every bar
/// above its threshold therefore could not survive a second such bar. So the program carries the
/// position it believes it holds, and proposes a side only from a position the kernel accepts it
/// at, holding otherwise. The belief is what the program last proposed, not what filled: an order
/// that does not fill before the next frame leaves the kernel's intent pending, and the next
/// non-holding proposal is refused as it always was.
struct PositionBelief {
    /// Every position reachable from flat, flat included, in ascending order.
    reachable: Vec<i64>,
    /// The positions from which `when_true` may be proposed, or `None` when it holds.
    when_true: Option<Vec<i64>>,
    /// The positions from which `otherwise` may be proposed, or `None` when it holds.
    otherwise: Option<Vec<i64>>,
}

impl PositionBelief {
    fn of(
        request: &SingleThresholdAuthoringRequestV1,
    ) -> Result<Self, SingleThresholdAuthoringErrorV1> {
        let sides = [&request.when_true, &request.otherwise];
        let mut reachable = std::collections::BTreeSet::from([0_i64]);

        loop {
            let before = reachable.len();

            for side in sides {
                if let Some(intent) = Intent::of(side).filter(|intent| *intent != Intent::Hold) {
                    let target = nominal_position(side);

                    if reachable
                        .iter()
                        .any(|current| intent.permits(*current, target))
                    {
                        reachable.insert(target);
                    }
                }
            }

            if reachable.len() == before {
                break;
            }
        }
        let reachable = reachable.into_iter().collect::<Vec<_>>();
        let permitted = |side: &SingleThresholdOutcomeV1, field| {
            let Some(intent) = Intent::of(side).filter(|intent| *intent != Intent::Hold) else {
                return Ok(None);
            };
            let target = nominal_position(side);
            let from = reachable
                .iter()
                .copied()
                .filter(|current| intent.permits(*current, target))
                .collect::<Vec<_>>();

            if from.is_empty() {
                return Err(SingleThresholdAuthoringErrorV1::SideNeverPermitted { field });
            }
            Ok(Some(from))
        };
        let when_true = permitted(&request.when_true, "when_true.position_intent_semantic_id")?;
        let otherwise = permitted(&request.otherwise, "otherwise.position_intent_semantic_id")?;
        Ok(Self {
            reachable,
            when_true,
            otherwise,
        })
    }

    /// Whether any side ever leaves the program holding a position.
    fn holds_any(&self) -> bool {
        self.reachable.len() > 1
    }
}

/// The exits a request names, at the one decimal scale both fractions are written at.
struct ExitPlan {
    /// The decimal places of the more precise fraction, and so of every exit factor.
    digits: u8,
    /// The stop-loss fraction as a coefficient at `digits`.
    stop_loss: Option<i128>,
    /// The take-profit fraction as a coefficient at `digits`.
    take_profit: Option<i128>,
    max_holding_bars: Option<u32>,
}

impl ExitPlan {
    /// The request field of the first exit named, if any.
    fn first_field(&self) -> Option<&'static str> {
        [
            (self.stop_loss.is_some(), "stop_loss_fraction"),
            (self.take_profit.is_some(), "take_profit_fraction"),
            (self.max_holding_bars.is_some(), "max_holding_bars"),
        ]
        .into_iter()
        .find_map(|(named, field)| named.then_some(field))
    }
}

/// The most decimal places an exit fraction may carry. The close is multiplied by `10^places`
/// before it is compared, so this keeps that product far inside a fixed-point coefficient.
const MAX_EXIT_FRACTION_PLACES: u8 = 9;

fn exit_plan(
    request: &SingleThresholdAuthoringRequestV1,
) -> Result<ExitPlan, SingleThresholdAuthoringErrorV1> {
    let channel = request.channel.role_v2();
    let mut fractions = [
        (&request.stop_loss_fraction, "stop_loss_fraction", None),
        (&request.take_profit_fraction, "take_profit_fraction", None),
    ];

    for (text, field, parsed) in &mut fractions {
        let Some(text) = text else { continue };
        let (coefficient, places) = parse_exit_fraction(text)
            .ok_or(SingleThresholdAuthoringErrorV1::ExitFractionInvalid { field })?;

        if places > MAX_EXIT_FRACTION_PLACES || u16::from(channel.scale) + u16::from(places) > 38 {
            return Err(SingleThresholdAuthoringErrorV1::ExitFractionTooPrecise { field });
        }

        if channel.field_semantic_id != UNIVERSE_CLOSE_FIELD_SEMANTIC_ID_V2 {
            return Err(SingleThresholdAuthoringErrorV1::ExitNeedsCloseChannel {
                field,
                channel: channel.field_semantic_id,
            });
        }
        *parsed = Some((coefficient, places));
    }

    if request.max_holding_bars == Some(0) {
        return Err(SingleThresholdAuthoringErrorV1::MaxHoldingBarsZero);
    }
    let digits = fractions
        .iter()
        .filter_map(|(_, _, parsed)| parsed.map(|(_, places)| places))
        .max()
        .unwrap_or(0);
    let at_digits = |parsed: Option<(i128, u8)>| {
        parsed.map(|(coefficient, places)| coefficient * 10_i128.pow(u32::from(digits - places)))
    };
    Ok(ExitPlan {
        digits,
        stop_loss: at_digits(fractions[0].2),
        take_profit: at_digits(fractions[1].2),
        max_holding_bars: request.max_holding_bars,
    })
}

/// Reads `0.` followed by digits with no trailing zero as a coefficient and its decimal places.
///
/// One spelling per fraction is what lets a request be recovered from its program: `0.020` and
/// `0.02` would compile to one program and read back as only one of them.
fn parse_exit_fraction(text: &str) -> Option<(i128, u8)> {
    let digits = text.strip_prefix("0.")?;

    if digits.is_empty()
        || digits.len() > 38
        || !digits.bytes().all(|byte| byte.is_ascii_digit())
        || digits.ends_with('0')
    {
        return None;
    }
    Some((digits.parse().ok()?, u8::try_from(digits.len()).ok()?))
}

/// The canonical spelling of a fraction `coefficient / 10^digits`, if it lies strictly between 0
/// and 1.
fn exit_fraction_text(coefficient: i128, digits: u8) -> Option<String> {
    let one = 10_i128.checked_pow(u32::from(digits))?;

    if !(1..one).contains(&coefficient) {
        return None;
    }
    let text = format!("{coefficient:0>width$}", width = usize::from(digits));
    Some(format!("0.{}", text.trim_end_matches('0')))
}

/// The id fragment naming one believed position.
fn position_label(position: i64) -> String {
    match position.signum() {
        0 => "flat".to_owned(),
        1 => format!("long-{position}"),
        _ => format!("short-{}", position.unsigned_abs()),
    }
}

impl Graph {
    /// The believed position as a constant the belief can be compared with and set to.
    fn position(&mut self, position: i64) -> BoundedFeatureValueRefV1 {
        self.fixed(
            &format!("believed-{}", position_label(position)),
            i128::from(position),
            POSITION_UNIT,
            0,
        )
    }
    /// Whether the program believed itself at `position` when this frame began.
    fn believed_at(&mut self, position: i64) -> BoundedFeatureValueRefV1 {
        let constant = self.position(position);
        self.compare(
            &format!("believed-is-{}", position_label(position)),
            prior_state(BELIEVED_POSITION),
            constant,
            BoundedFeaturePredicateV1::Equal,
        )
    }
    /// The five constants of one frame, read from `outcome`.
    fn frame_constants(&mut self, ids: FrameIds, outcome: &SingleThresholdOutcomeV1) {
        for (constant_id, value) in outcome_constants(ids, outcome) {
            self.constant(&constant_id, value);
        }
    }
}

fn meaning_for(
    request: &SingleThresholdAuthoringRequestV1,
    threshold: i128,
    positions: &PositionBelief,
    exits: &ExitPlan,
) -> BoundedFeatureProgramMeaningV1 {
    let role = request.channel.role().to_owned();
    let carried = request.channel.carried_role_v2();
    let mut inputs = vec![BoundedFeatureInputMeaningV1 {
        role_semantic_id: role.clone(),
        value_port_semantic_id: CHANNEL_VALUE_PORT.to_owned(),
        // The family's decision clock is the declared channel itself. With one channel there is
        // nothing to sample against, so the clock is its trigger.
        update_clock: BoundedFeatureClockV1::Trigger {
            input_role_id: role.clone(),
        },
    }];
    // The carried role arrives in the same Owner frame as the channel, one sample per trigger,
    // which is what a trigger clock states. Nothing advances on it, because nothing reads it.
    inputs.extend(carried.iter().map(|carried| BoundedFeatureInputMeaningV1 {
        role_semantic_id: carried.semantic_id.clone(),
        value_port_semantic_id: CARRIED_VALUE_PORT.to_owned(),
        update_clock: BoundedFeatureClockV1::Trigger {
            input_role_id: carried.semantic_id.clone(),
        },
    }));

    let mut graph = Graph::default();
    let comparison = graph.compare(
        COMPARISON_NODE,
        BoundedFeatureValueRefV1::InputValue {
            input_role_id: role,
        },
        BoundedFeatureValueRefV1::Constant {
            constant_id: THRESHOLD.to_owned(),
        },
        request.comparison,
    );
    let when_true = frame(
        &request.when_true,
        TRUE_POSITION,
        TRUE_TARGET,
        TRUE_TARGET_POSITION,
        TRUE_TARGET_WEIGHT,
        TRUE_PROTECTION,
    );
    let otherwise = frame(
        &request.otherwise,
        FALSE_POSITION,
        FALSE_TARGET,
        FALSE_TARGET_POSITION,
        FALSE_TARGET_WEIGHT,
        FALSE_PROTECTION,
    );
    let proposal_decision_table = if positions.holds_any() {
        believed_table(
            &mut graph,
            request,
            positions,
            exits,
            &comparison,
            when_true,
            otherwise,
        )
    } else {
        // No side ever holds a position, so there is nothing to believe and every side may be
        // proposed from where the program is.
        BoundedFeatureProposalDecisionTableV1 {
            branches: vec![BoundedFeatureProposalDecisionBranchV1 {
                priority: 20,
                predicate: comparison,
                frame: when_true,
            }],
            default_frame: otherwise,
        }
    };

    let mut constants = constants(request, threshold);
    constants.extend(
        graph
            .constants
            .into_iter()
            .map(|(constant_id, value)| BoundedFeatureConstantV1 { constant_id, value }),
    );

    BoundedFeatureProgramMeaningV1 {
        plugin_semantic_id: PLUGIN_SEMANTIC_ID.to_owned(),
        inputs,
        constants,
        state_cells: graph.state_cells,
        nodes: graph.nodes,
        proposal_decision_table,
        warmup: BoundedFeatureWarmupContractV1 {
            // Before the first sample the program has compared nothing, so it proposes neither
            // side of its own threshold and holds.
            position_intent_semantic_id: "kernel.position.hold.v1".to_owned(),
            target_variant_semantic_id: "kernel.target.keep.v1".to_owned(),
            target_position_units: 0,
            target_weight_micros: 0,
            rebalance_sequence: 0,
            reconciliation_target_units: 0,
            protection_variant_semantic_id: "kernel.protection.keep.v1".to_owned(),
            stop_loss_ticks: 0,
            take_profit_ticks: 0,
            trailing_distance_ticks: 0,
            trailing_stop_ticks: 0,
            post_state: BoundedFeatureWarmupPostStateV1::AdvancedCurrentEvent,
        },
        graph_bounds: FAMILY_GRAPH_BOUNDS,
        carried_input_role_ids: carried.into_iter().map(|role| role.semantic_id).collect(),
    }
}

/// The decision table of a program that holds positions: an exit first, then the side the
/// comparison chose if the believed position admits it, and a hold otherwise.
///
/// Priorities are spaced so that each branch keeps its number whichever of the others a request
/// has: 10 for the exit, 20 for `when_true`, 30 for `otherwise`.
fn believed_table(
    graph: &mut Graph,
    request: &SingleThresholdAuthoringRequestV1,
    positions: &PositionBelief,
    exits: &ExitPlan,
    comparison: &BoundedFeatureValueRefV1,
    when_true: BoundedFeatureProposalFrameV1,
    otherwise: BoundedFeatureProposalFrameV1,
) -> BoundedFeatureProposalDecisionTableV1 {
    let flat = graph.position(0);
    graph.cell(
        BELIEVED_POSITION,
        BELIEVED_POSITION_WRITER,
        fixed_type(POSITION_UNIT, 0),
        &format!("believed-{}", position_label(0)),
    );
    // Each layer is the frame one branch proposes and the belief it leaves, innermost first; the
    // belief after a frame no layer covers is the belief before it.
    let mut layers = Vec::new();
    let mut branches = Vec::new();

    let side_fires = |graph: &mut Graph, side: &str, from: &[i64], when_compared: bool| {
        let believed = from
            .iter()
            .map(|position| graph.believed_at(*position))
            .collect::<Vec<_>>();
        let admitted = graph.any_of(&format!("{side}-admitted"), &believed);
        let zero = graph.signal(0);
        let (when_true, when_false) = if when_compared {
            (admitted, zero)
        } else {
            (zero, admitted)
        };
        let fires = graph.select(
            &format!("{side}-fires-signal"),
            comparison.clone(),
            when_true,
            when_false,
            fixed_type(SIGNAL_UNIT, 0),
        );
        graph.holds(&format!("{side}-fires"), fires)
    };

    let otherwise_fires = positions
        .otherwise
        .as_ref()
        .map(|from| side_fires(graph, "otherwise", from, false));
    let true_fires = match &positions.when_true {
        Some(from) => side_fires(graph, "when-true", from, true),
        None => comparison.clone(),
    };

    if let Some(fires) = &otherwise_fires {
        let position = graph.position(nominal_position(&request.otherwise));
        layers.push(("believed-after-otherwise", fires.clone(), position));
    }

    if positions.when_true.is_some() {
        let position = graph.position(nominal_position(&request.when_true));
        layers.push(("believed-after-when-true", true_fires.clone(), position));
    }

    if exits.first_field().is_some() {
        let exit_now = exit_condition(graph, request, positions, exits);
        graph.frame_constants(EXIT_IDS, &exit_outcome());
        branches.push(BoundedFeatureProposalDecisionBranchV1 {
            priority: 10,
            predicate: exit_now.clone(),
            frame: frame(
                &exit_outcome(),
                EXIT_IDS.0,
                EXIT_IDS.1,
                EXIT_IDS.2,
                EXIT_IDS.3,
                EXIT_IDS.4,
            ),
        });
        layers.push(("believed-after-exit", exit_now, flat));
    }
    branches.push(BoundedFeatureProposalDecisionBranchV1 {
        priority: 20,
        predicate: true_fires,
        frame: when_true,
    });
    let default_frame = match otherwise_fires {
        Some(fires) => {
            branches.push(BoundedFeatureProposalDecisionBranchV1 {
                priority: 30,
                predicate: fires,
                frame: otherwise,
            });
            graph.frame_constants(HOLD_IDS, &hold_outcome());
            frame(
                &hold_outcome(),
                HOLD_IDS.0,
                HOLD_IDS.1,
                HOLD_IDS.2,
                HOLD_IDS.3,
                HOLD_IDS.4,
            )
        }
        // A holding side may be proposed from anywhere, so it is the other side of the
        // threshold as before, not a fallback.
        None => otherwise,
    };

    let mut believed = prior_state(BELIEVED_POSITION);
    let last = layers.len().saturating_sub(1);
    for (index, (node_id, condition, position)) in layers.into_iter().enumerate() {
        let node_id = if index == last {
            BELIEVED_POSITION_WRITER
        } else {
            node_id
        };
        believed = graph.select(
            node_id,
            condition,
            position,
            believed,
            fixed_type(POSITION_UNIT, 0),
        );
    }

    BoundedFeatureProposalDecisionTableV1 {
        branches,
        default_frame,
    }
}

/// Whether a held position is left at this frame's close: by its stop-loss, its take-profit or its
/// holding limit, each judged in the direction the believed position faces.
fn exit_condition(
    graph: &mut Graph,
    request: &SingleThresholdAuthoringRequestV1,
    positions: &PositionBelief,
    exits: &ExitPlan,
) -> BoundedFeatureValueRefV1 {
    let channel = request.channel.role_v2();
    let close = BoundedFeatureValueRefV1::InputValue {
        input_role_id: channel.semantic_id.clone(),
    };
    let flat = graph.believed_at(0);
    let long = positions.reachable.iter().any(|position| *position > 0);
    let short = positions.reachable.iter().any(|position| *position < 0);
    let mut long_exits = Vec::new();
    let mut short_exits = Vec::new();

    if exits.stop_loss.is_some() || exits.take_profit.is_some() {
        graph.fixed(ENTRY_CLOSE_SEED, 0, &channel.unit, channel.scale);
        graph.cell(
            ENTRY_CLOSE,
            ENTRY_CLOSE_WRITER,
            fixed_type(&channel.unit, channel.scale),
            ENTRY_CLOSE_SEED,
        );
        graph.select(
            ENTRY_CLOSE_WRITER,
            flat.clone(),
            close.clone(),
            prior_state(ENTRY_CLOSE),
            fixed_type(&channel.unit, channel.scale),
        );
        // The close and the entry close are compared at one unit and scale: the close times
        // exactly 1, and the entry close times 1 minus or plus the fraction, both in `RATIO` at
        // the fractions' decimal places. Both products are exact.
        let one = 10_i128.pow(u32::from(exits.digits));
        let ratio_one = graph.fixed("ratio-one", one, RATIO_UNIT, exits.digits);
        let product_unit = format!("{}*{RATIO_UNIT}", channel.unit);
        let product_scale = channel.scale + exits.digits;
        let scaled_close = graph.arithmetic(
            "close-at-ratio",
            MUL,
            close,
            ratio_one,
            &product_unit,
            product_scale,
        );

        for (exit, fraction, long_sign, long_predicate, short_predicate) in [
            (
                STOP_LOSS_EXIT,
                exits.stop_loss,
                -1,
                BoundedFeaturePredicateV1::LessOrEqual,
                BoundedFeaturePredicateV1::GreaterOrEqual,
            ),
            (
                TAKE_PROFIT_EXIT,
                exits.take_profit,
                1,
                BoundedFeaturePredicateV1::GreaterOrEqual,
                BoundedFeaturePredicateV1::LessOrEqual,
            ),
        ] {
            let Some(fraction) = fraction else { continue };

            for (direction, sign, predicate, faces) in [
                ("long", long_sign, long_predicate, long),
                ("short", -long_sign, short_predicate, short),
            ] {
                if !faces {
                    continue;
                }
                let factor = graph.fixed(
                    &format!("{exit}-{direction}-factor"),
                    one + sign * fraction,
                    RATIO_UNIT,
                    exits.digits,
                );
                let level = graph.arithmetic(
                    &format!("{exit}-{direction}-level"),
                    MUL,
                    prior_state(ENTRY_CLOSE),
                    factor,
                    &product_unit,
                    product_scale,
                );
                let reached = graph.compare(
                    &format!("{exit}-{direction}-reached"),
                    scaled_close.clone(),
                    level,
                    predicate,
                );

                if direction == "long" {
                    long_exits.push(reached);
                } else {
                    short_exits.push(reached);
                }
            }
        }
    }

    if let Some(limit) = exits.max_holding_bars {
        let none = graph.fixed(NO_BARS, 0, BARS_UNIT, 0);
        graph.cell(
            BARS_HELD,
            BARS_HELD_WRITER,
            fixed_type(BARS_UNIT, 0),
            NO_BARS,
        );
        let bar = graph.fixed("bar-one", 1, BARS_UNIT, 0);
        let counted = graph.arithmetic(
            "bars-plus-one",
            ADD,
            prior_state(BARS_HELD),
            bar,
            BARS_UNIT,
            0,
        );
        let held = graph.select(
            BARS_HELD_WRITER,
            flat.clone(),
            none,
            counted,
            fixed_type(BARS_UNIT, 0),
        );
        let limit = graph.fixed(MAX_HOLDING_BARS, i128::from(limit), BARS_UNIT, 0);
        let reached = graph.compare(
            "holding-limit-reached",
            held,
            limit,
            BoundedFeaturePredicateV1::GreaterOrEqual,
        );

        if long {
            long_exits.push(reached.clone());
        }

        if short {
            short_exits.push(reached);
        }
    }

    let faced = match (long, short) {
        (true, true) => {
            let leave_long = graph.any_of("exit-long", &long_exits);
            let leave_short = graph.any_of("exit-short", &short_exits);
            let flat_position = graph.position(0);
            let believed_long = graph.compare(
                "believed-long",
                prior_state(BELIEVED_POSITION),
                flat_position,
                BoundedFeaturePredicateV1::Greater,
            );
            graph.select(
                "exit-faced",
                believed_long,
                leave_long,
                leave_short,
                fixed_type(SIGNAL_UNIT, 0),
            )
        }
        (true, false) => graph.any_of("exit-long", &long_exits),
        _ => graph.any_of("exit-short", &short_exits),
    };
    // Flat, there is nothing to leave.
    let zero = graph.signal(0);
    let leave = graph.select("exit-signal", flat, zero, faced, fixed_type(SIGNAL_UNIT, 0));
    graph.holds("exit-now", leave)
}

/// What an exit proposes: flat, as a position target, clearing the protection it leaves.
fn exit_outcome() -> SingleThresholdOutcomeV1 {
    SingleThresholdOutcomeV1 {
        position_intent_semantic_id: "kernel.position.exit.v1".to_owned(),
        target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
        target_position_units: 0,
        target_weight_micros: 0,
    }
}

/// What the program proposes when neither side may be proposed from where it is.
fn hold_outcome() -> SingleThresholdOutcomeV1 {
    SingleThresholdOutcomeV1 {
        position_intent_semantic_id: "kernel.position.hold.v1".to_owned(),
        target_variant_semantic_id: "kernel.target.keep.v1".to_owned(),
        target_position_units: 0,
        target_weight_micros: 0,
    }
}

/// The five constants of one frame: intent, target, target position, target weight, protection.
fn outcome_constants(
    ids: FrameIds,
    outcome: &SingleThresholdOutcomeV1,
) -> [(String, BoundedFeatureConstantValueV1); 5] {
    [
        (
            ids.0.to_owned(),
            BoundedFeatureConstantValueV1::PositionIntentV1 {
                semantic_id: outcome.position_intent_semantic_id.clone(),
            },
        ),
        (
            ids.1.to_owned(),
            BoundedFeatureConstantValueV1::TargetVariantV1 {
                semantic_id: outcome.target_variant_semantic_id.clone(),
            },
        ),
        (
            ids.2.to_owned(),
            BoundedFeatureConstantValueV1::I64 {
                value: outcome.target_position_units,
            },
        ),
        (
            ids.3.to_owned(),
            BoundedFeatureConstantValueV1::I32 {
                value: outcome.target_weight_micros,
            },
        ),
        (
            ids.4.to_owned(),
            BoundedFeatureConstantValueV1::ProtectionVariantV1 {
                semantic_id: protection_variant(outcome).to_owned(),
            },
        ),
    ]
}

fn constants(
    request: &SingleThresholdAuthoringRequestV1,
    threshold: i128,
) -> Vec<BoundedFeatureConstantV1> {
    // The threshold is compared at the channel's own unit and scale, which the Design role states.
    let channel = request.channel.role_v2();
    let mut values = vec![(
        THRESHOLD.to_owned(),
        // The comparison primitive is equal-scale, so the threshold takes the channel's own unit
        // and scale. Nothing here can disagree with the channel, because nothing here restates it.
        BoundedFeatureConstantValueV1::FixedI128 {
            coefficient: threshold,
            unit: channel.unit,
            scale: channel.scale,
        },
    )];
    values.extend(outcome_constants(
        (
            TRUE_POSITION,
            TRUE_TARGET,
            TRUE_TARGET_POSITION,
            TRUE_TARGET_WEIGHT,
            TRUE_PROTECTION,
        ),
        &request.when_true,
    ));
    values.extend(outcome_constants(
        (
            FALSE_POSITION,
            FALSE_TARGET,
            FALSE_TARGET_POSITION,
            FALSE_TARGET_WEIGHT,
            FALSE_PROTECTION,
        ),
        &request.otherwise,
    ));
    // Shared by every frame: a single threshold does not change them, so the author is not asked
    // for them twice.
    values.extend([
        // The Host assigns a rebalance target's sequence, and a program emits 0 for it.
        (
            REBALANCE.to_owned(),
            BoundedFeatureConstantValueV1::U64 { value: 0 },
        ),
        (
            STOP_LOSS.to_owned(),
            BoundedFeatureConstantValueV1::I64 { value: 0 },
        ),
        (
            TAKE_PROFIT.to_owned(),
            BoundedFeatureConstantValueV1::I64 { value: 0 },
        ),
        (
            TRAILING_DISTANCE.to_owned(),
            BoundedFeatureConstantValueV1::U64 { value: 0 },
        ),
        (
            TRAILING_STOP.to_owned(),
            BoundedFeatureConstantValueV1::I64 { value: 0 },
        ),
    ]);

    values
        .into_iter()
        .map(|(constant_id, value)| BoundedFeatureConstantV1 { constant_id, value })
        .collect()
}

/// The protection variant a side proposes: an exit clears the protection it leaves, which the
/// kernel requires of an exit and refuses of any other intent, and every other side keeps it.
fn protection_variant(outcome: &SingleThresholdOutcomeV1) -> &'static str {
    if outcome.position_intent_semantic_id == "kernel.position.exit.v1" {
        "kernel.protection.clear.v1"
    } else {
        "kernel.protection.keep.v1"
    }
}

/// One side of the threshold, as the eleven terminal outputs a frame must carry.
fn frame(
    outcome: &SingleThresholdOutcomeV1,
    position: &str,
    target: &str,
    target_position: &str,
    target_weight: &str,
    protection: &str,
) -> BoundedFeatureProposalFrameV1 {
    BoundedFeatureProposalFrameV1 {
        terminal_outputs: [
            (
                "proposal.position-intent.v1",
                outcome.position_intent_semantic_id.as_str(),
                position,
            ),
            (
                "proposal.target-variant.v1",
                outcome.target_variant_semantic_id.as_str(),
                target,
            ),
            (
                "proposal.target-position.v1",
                outcome.target_variant_semantic_id.as_str(),
                target_position,
            ),
            ("proposal.target-weight.v1", WEIGHT_TARGET, target_weight),
            (
                "proposal.rebalance-sequence.v1",
                "kernel.target.rebalance.v1",
                REBALANCE,
            ),
            (
                "proposal.reconciliation-target.v1",
                outcome.target_variant_semantic_id.as_str(),
                target_position,
            ),
            (
                "proposal.protection-variant.v1",
                protection_variant(outcome),
                protection,
            ),
            (
                "proposal.stop-loss.v1",
                "kernel.protection.stop-loss.v1",
                STOP_LOSS,
            ),
            (
                "proposal.take-profit.v1",
                "kernel.protection.take-profit.v1",
                TAKE_PROFIT,
            ),
            (
                "proposal.trailing-distance.v1",
                "kernel.protection.trailing-adjust.v1",
                TRAILING_DISTANCE,
            ),
            (
                "proposal.trailing-stop.v1",
                "kernel.protection.trailing-adjust.v1",
                TRAILING_STOP,
            ),
        ]
        .into_iter()
        .map(|(manifest_port_id, lifecycle_semantic_id, constant_id)| {
            BoundedFeatureTerminalOutputV1 {
                manifest_port_id: manifest_port_id.to_owned(),
                lifecycle_semantic_id: lifecycle_semantic_id.to_owned(),
                source: BoundedFeatureValueRefV1::Constant {
                    constant_id: constant_id.to_owned(),
                },
                conversion: BoundedFeatureTerminalConversionV1::Exact,
            }
        })
        .collect(),
    }
}

/// What a proposer hands the Owner, in the exact shape the Owner's route accepts.
///
/// The proposer is not the Owner: `docs/owners/rd.md` assigns this translation to "a language
/// model, a person or any other caller", so the two sides are separate programs and the only
/// thing joining them is this JSON. Both ends had their own tests and nothing compared them,
/// which is the shape this repository keeps finding: two healthy parts and an unmeasured wire.
///
/// It lives here rather than in the binary so that a test can serialise what the binary actually
/// emits, instead of a copy of it that drifts on the next edit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DesignRoleIntentProposalV1 {
    /// The body of `POST /v1/strategy-designs/publish-role-intent`, field for field. The route
    /// declares `deny_unknown_fields`, so an extra key here is a refusal there.
    pub publish_role_intent: PublishRoleIntentBodyV1,
    /// The meaning that belongs with the Design. The Owner derives its own; this is what the
    /// proposer computed, carried so the author can compare them.
    pub meaning: BoundedFeatureProgramMeaningV1,
}

/// The publish-role-intent request body a proposer emits.
///
/// The caller states no identity, digest or role coordinate of its own: the Owner derives all of
/// them from the Design and from the Research custody the locator names.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PublishRoleIntentBodyV1 {
    /// Names a request the Owner already holds. The proposer does not invent it.
    pub research_request_locator: String,
    pub design: StrategyDesignV2,
}

impl DesignRoleIntentProposalV1 {
    /// Authors the pair and packages it as the Owner's route expects it.
    ///
    /// # Errors
    ///
    /// Returns the authoring refusal under its own name when the statement is not one this
    /// family admits.
    pub fn author(
        research_request_locator: impl Into<String>,
        request: &SingleThresholdAuthoringRequestV1,
    ) -> Result<Self, SingleThresholdAuthoringErrorV1> {
        let (design, meaning) = author_single_threshold_program_v1(request)?;
        Ok(Self {
            publish_role_intent: PublishRoleIntentBodyV1 {
                research_request_locator: research_request_locator.into(),
                design,
            },
            meaning,
        })
    }
}

/// Recovers the author's request from a Design and a program the Owner froze, or `None` when the
/// pair is not exactly what this family authors.
///
/// Membership is decided by authoring, not by a second reading of the family's shape. A candidate
/// request is read out of the pair leniently and then authored again, and the pair belongs to the
/// family only when that reproduces the stored program's canonical bytes, which bind the stored
/// Design's identity and digest as well. A candidate that is wrong in any field therefore fails
/// closed instead of stating a strategy the program does not run, and a later change to how this
/// family authors cannot leave a stale recognizer behind, because there is no recognizer apart
/// from the author.
///
/// A program frozen by an earlier version of this author that the current one no longer
/// reproduces is outside the family by this test. That is the honest answer: the statement this
/// returns is one the current author would turn back into exactly that program.
pub(crate) fn recover_single_threshold_request_v1(
    design: &StrategyDesignV2,
    frozen: &CanonicalBoundedFeatureProgramV1,
) -> Option<SingleThresholdAuthoringRequestV1> {
    let candidate = candidate_request(design, frozen.program())?;
    let (authored_design, authored_meaning) =
        author_single_threshold_program_v1(&candidate).ok()?;

    // One comparison covers both halves. The redeclared program is assembled against the authored
    // Design, so it carries that Design's identity and digest; its canonical bytes equal the
    // frozen program's only if the authored Design is also the frozen one. A separate Design
    // comparison was written first and removed after mutation showed nothing depended on it.
    let redeclared = redeclare_frozen_bounded_feature_program_v1(
        &authored_design,
        frozen.program(),
        &authored_meaning,
    )
    .ok()?;
    let reprepared = prepare_bounded_feature_program_v1(redeclared, &authored_design).ok()?;
    (reprepared.canonical_bytes() == frozen.canonical_bytes()).then_some(candidate)
}

/// Reads a candidate request out of a Design and program by the ids this family writes.
///
/// Nothing here is a judgement that the pair is in the family. Every field is only a guess until
/// [`recover_single_threshold_request_v1`] authors it again and compares.
fn candidate_request(
    design: &StrategyDesignV2,
    program: &BoundedFeatureProgramProposalV1,
) -> Option<SingleThresholdAuthoringRequestV1> {
    let channel = candidate_channel(design)?;
    let constant = |constant_id: &str| {
        program
            .constants
            .iter()
            .find(|constant| constant.constant_id == constant_id)
            .map(|constant| &constant.value)
    };
    let BoundedFeatureConstantValueV1::FixedI128 {
        coefficient,
        scale: threshold_scale,
        ..
    } = constant(THRESHOLD)?
    else {
        return None;
    };
    let comparison = program
        .nodes
        .iter()
        .find(|node| node.node_id == COMPARISON_NODE)
        .and_then(|node| match &node.parameters {
            BoundedFeatureParametersV1::ComparisonPredicate { predicate } => Some(*predicate),
            _ => None,
        })?;
    let outcome = |position: &str, target: &str, target_position: &str, target_weight: &str| {
        let (
            BoundedFeatureConstantValueV1::PositionIntentV1 {
                semantic_id: position_intent_semantic_id,
            },
            BoundedFeatureConstantValueV1::TargetVariantV1 {
                semantic_id: target_variant_semantic_id,
            },
            BoundedFeatureConstantValueV1::I64 {
                value: target_position_units,
            },
            BoundedFeatureConstantValueV1::I32 {
                value: target_weight_micros,
            },
        ) = (
            constant(position)?,
            constant(target)?,
            constant(target_position)?,
            constant(target_weight)?,
        )
        else {
            return None;
        };
        Some(SingleThresholdOutcomeV1 {
            position_intent_semantic_id: position_intent_semantic_id.clone(),
            target_variant_semantic_id: target_variant_semantic_id.clone(),
            target_position_units: *target_position_units,
            target_weight_micros: *target_weight_micros,
        })
    };

    Some(SingleThresholdAuthoringRequestV1 {
        research_request_identity: design.research_request_identity,
        intent_identity: design.intent_identity,
        intent_digest: design.intent_digest,
        channel,
        threshold: canonical_threshold_text(*coefficient, *threshold_scale),
        comparison,
        when_true: outcome(
            TRUE_POSITION,
            TRUE_TARGET,
            TRUE_TARGET_POSITION,
            TRUE_TARGET_WEIGHT,
        )?,
        otherwise: outcome(
            FALSE_POSITION,
            FALSE_TARGET,
            FALSE_TARGET_POSITION,
            FALSE_TARGET_WEIGHT,
        )?,
        stop_loss_fraction: candidate_fraction(constant, STOP_LOSS_EXIT, -1),
        take_profit_fraction: candidate_fraction(constant, TAKE_PROFIT_EXIT, 1),
        max_holding_bars: match constant(MAX_HOLDING_BARS) {
            Some(BoundedFeatureConstantValueV1::FixedI128 { coefficient, .. }) => {
                Some(u32::try_from(*coefficient).ok()?)
            }
            _ => None,
        },
        falsifier: design.falsifier.clone(),
    })
}

/// Reads an exit fraction back from the factor of either direction it was written for: a long
/// position's factor is `1 + long_sign * fraction`, and a short position's the opposite.
fn candidate_fraction<'a>(
    constant: impl Fn(&str) -> Option<&'a BoundedFeatureConstantValueV1>,
    exit: &str,
    long_sign: i128,
) -> Option<String> {
    [("long", long_sign), ("short", -long_sign)]
        .into_iter()
        .find_map(|(direction, sign)| {
            let BoundedFeatureConstantValueV1::FixedI128 {
                coefficient, scale, ..
            } = constant(&format!("{exit}-{direction}-factor"))?
            else {
                return None;
            };
            let one = 10_i128.checked_pow(u32::from(*scale))?;
            exit_fraction_text(coefficient.checked_sub(one)?.checked_mul(sign)?, *scale)
        })
}

/// Reads a candidate channel out of a Design's roles, by the scope each role declares.
///
/// The form is decided by that declaration, not inferred from how many roles there are: one
/// `ExactInstrument` role is the exact-instrument form, and two `UniverseMembers` roles reading
/// `CLOSE` and `OPEN` are the universe-member form. A Design of two exact-instrument roles is
/// neither, so it is outside the family here rather than read as a universe member.
///
/// The universe form's two roles are told apart by their field, never by position: a Design's
/// canonical form orders its roles by the ids the author chose, so the `CLOSE` role comes first
/// only when its id happens to sort first.
fn candidate_channel(design: &StrategyDesignV2) -> Option<SingleThresholdChannelV1> {
    match design.inputs.as_slice() {
        [input] if input.scope == InputScopeV2::ExactInstrument => {
            Some(SingleThresholdChannelV1::ExactInstrument {
                role_semantic_id: input.semantic_id.clone(),
                instrument: input.instrument.clone(),
                field_semantic_id: input.field_semantic_id.clone(),
                timeframe: input.timeframe.clone(),
                unit: input.unit.clone(),
                scale: input.scale,
            })
        }
        [first, second]
            if first.scope == InputScopeV2::UniverseMembers
                && second.scope == InputScopeV2::UniverseMembers =>
        {
            let role_reading = |field: &str| match (
                first.field_semantic_id == field,
                second.field_semantic_id == field,
            ) {
                (true, false) => Some(first.semantic_id.clone()),
                (false, true) => Some(second.semantic_id.clone()),
                _ => None,
            };

            Some(SingleThresholdChannelV1::UniverseMember {
                close_role_semantic_id: role_reading(UNIVERSE_CLOSE_FIELD_SEMANTIC_ID_V2)?,
                open_role_semantic_id: role_reading(UNIVERSE_OPEN_FIELD_SEMANTIC_ID_V2)?,
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use vibe_indicators_kernel::PrimitiveCatalogV1;

    use super::*;
    use crate::{
        bounded_feature_program_derivation_v1::{
            BoundedFeatureProgramDerivationErrorV1, derive_bounded_feature_program_proposal_v1,
        },
        bounded_feature_program_v1::{
            BoundedFeatureProgramErrorV1, BoundedFeatureProgramProposalV1,
            parse_bounded_feature_program_v1, prepare_bounded_feature_program_v1,
        },
        strategy_plan_v2::{
            BfpRoleBindingKindV1, CompilationIssueV2, StrategyCompilationV2,
            StrategyDesignPreparationV2, compile_strategy_design_v2_with_verified_bindings,
            issue_plugin_implementation_receipt_v2_for_test, prepare_strategy_design_v2,
            project_bfp_role_bindings_for_test, strategy_input_role_identity_v2,
            validate_universe_target_set_contract_for_test,
            verified_strategy_input_bindings_for_test, verified_universe_bindings_for_test,
        },
    };

    /// A distinct, non-degenerate receipt digest. `validate_inputs_and_constants` refuses an
    /// all-zero digest, so a digest that is merely absent must not read as one that is present.
    fn digest(seed: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([seed; 32])
    }

    /// The shipped example must deserialise and author.
    ///
    /// The example is what `strategy-factory-author-role-intent` is documented with, so it is the
    /// only statement of the wire form: the comparison is `GREATER`, not `Greater`, and each
    /// digest is thirty-two numbers, not hex. Both were gotten wrong on the first attempt to feed
    /// the binary by hand, and neither is visible from the Rust types. Deriving serde does not
    /// document what it produces; an example that must parse does.
    #[rstest]
    fn the_shipped_example_statement_parses_and_authors() {
        #[derive(serde::Deserialize)]
        struct Example {
            research_request_locator: String,
            authoring: SingleThresholdAuthoringRequestV1,
        }
        let raw = include_str!("../test_data/single_threshold/example_statement.json");
        let example: Example =
            serde_json::from_str(raw).expect("the shipped example parses as a statement");
        assert!(
            !example.research_request_locator.is_empty(),
            "the example names a locator, because the route's body carries one"
        );
        let (design, meaning) = author_single_threshold_program_v1(&example.authoring)
            .expect("the shipped example is authorable");
        // Serialising is the half the binary adds, and a type that authors but cannot be written
        // out would make the binary useless while every test here still passed.
        serde_json::to_string(&design).expect("the design serialises");
        serde_json::to_string(&meaning).expect("the meaning serialises");
    }

    fn request() -> SingleThresholdAuthoringRequestV1 {
        SingleThresholdAuthoringRequestV1 {
            research_request_identity: digest(1),
            intent_identity: digest(2),
            intent_digest: digest(3),
            channel: SingleThresholdChannelV1::ExactInstrument {
                role_semantic_id: "research.input.close.daily.v1".to_owned(),
                instrument: "BTCUSDT-PERP.BINANCE".to_owned(),
                field_semantic_id: "MARKET_DATA.BAR.CLOSE.PRICE.V1".to_owned(),
                timeframe: "1D".to_owned(),
                unit: "PRICE".to_owned(),
                scale: 2,
            },
            threshold: "100".to_owned(),
            comparison: BoundedFeaturePredicateV1::Greater,
            when_true: SingleThresholdOutcomeV1 {
                position_intent_semantic_id: "kernel.position.enter.v1".to_owned(),
                target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
                target_position_units: 1,
                target_weight_micros: 0,
            },
            otherwise: SingleThresholdOutcomeV1 {
                position_intent_semantic_id: "kernel.position.exit.v1".to_owned(),
                target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
                target_position_units: 0,
                target_weight_micros: 0,
            },
            stop_loss_fraction: None,
            take_profit_fraction: None,
            max_holding_bars: None,
            falsifier: "the channel never crosses the threshold in the admitted window".to_owned(),
        }
    }

    /// One authored side: position intent, target variant, target position, target weight.
    type Side = (&'static str, &'static str, i64, i32);

    const SIDE_ENTER: Side = (
        "kernel.position.enter.v1",
        "kernel.target.position.v1",
        1,
        0,
    );
    const SIDE_EXIT: Side = ("kernel.position.exit.v1", "kernel.target.position.v1", 0, 0);
    const SIDE_KEEP: Side = ("kernel.position.hold.v1", "kernel.target.keep.v1", 0, 0);
    const SIDE_REBALANCE_ENTER: Side = (
        "kernel.position.enter.v1",
        "kernel.target.rebalance.v1",
        1,
        0,
    );
    const SIDE_REBALANCE_EXIT: Side = (
        "kernel.position.exit.v1",
        "kernel.target.rebalance.v1",
        0,
        0,
    );
    const SIDE_WEIGHT_ENTER: Side = ("kernel.position.enter.v1", WEIGHT_TARGET, 0, 250_000);
    const SIDE_WEIGHT_EXIT: Side = ("kernel.position.exit.v1", WEIGHT_TARGET, 0, 0);

    /// Every side an author writes runs through a real lifecycle kernel from each position it can
    /// be proposed at.
    ///
    /// Each frame's terminals are constants. A side is decoded from all eleven by the Host's own
    /// decoder, lifted as the Host lifts a single-instrument proposal into the next target-set
    /// sequence, and applied to a kernel, which checks the whole intent transition: the target and
    /// its sequence, the reconciliation, the position transition, and the protection. An entering
    /// side is applied flat, an exiting side once a fill has made the position, a holding side at
    /// both, and an entering side again after the exit. A side's lift alone passed three terminals
    /// that were each wrong: a reconciliation shared as 0, a rebalance sequence written as one
    /// constant, and a protection shared as `keep`, which the kernel refuses on an exit.
    #[rstest]
    #[case::enter_then_exit(SIDE_ENTER, SIDE_EXIT)]
    #[case::enter_then_keep(SIDE_ENTER, SIDE_KEEP)]
    #[case::keep_then_enter(SIDE_KEEP, SIDE_ENTER)]
    #[case::exit_then_enter(SIDE_EXIT, SIDE_ENTER)]
    #[case::rebalance_enter_then_exit(SIDE_REBALANCE_ENTER, SIDE_REBALANCE_EXIT)]
    #[case::weight_enter_then_exit(SIDE_WEIGHT_ENTER, SIDE_WEIGHT_EXIT)]
    fn every_authored_side_runs_through_the_kernel(
        #[case] when_true: Side,
        #[case] otherwise: Side,
    ) {
        use strategy_factory_program_sdk::lifecycle_v1::{
            EnvelopePayloadV1, EventOrderKeyV1, FillDispositionV1, FillEventV1, FillLegV1,
            KernelIdentitiesV1, LifecycleEnvelopeV1, LifecycleKernelV1, LifecycleKind,
            PositionIntentV1, ProtectionProposalV1, TargetProposalV1, UnsealedGuestProposalV1,
            seal_guest_proposal_with_derived_digest_v1,
        };

        use crate::{
            plugin_wire_v2::TypedValueV2,
            program_host_v2::{
                ProposalTerminalV2, decode_proposal_terminals_v2, lift_single_instrument_proposal,
            },
            strategy_design_v2::ValueTypeV2,
        };

        struct Trajectory {
            kernel: LifecycleKernelV1,
            clock: u64,
            /// The sequence of the last target set a proposal was lifted into.
            sets: u64,
        }

        impl Trajectory {
            fn envelope(&mut self, payload: EnvelopePayloadV1) -> LifecycleEnvelopeV1 {
                self.clock += 1;
                let kind = match payload {
                    EnvelopePayloadV1::Start => LifecycleKind::Start,
                    EnvelopePayloadV1::Fill(_) => LifecycleKind::Fill,
                    _ => LifecycleKind::Bar,
                };
                let identity = [u8::try_from(self.clock).expect("a short trajectory"); 16];
                let order_key =
                    EventOrderKeyV1::new(self.clock, self.clock, kind, self.clock, identity)
                        .expect("an order key");
                LifecycleEnvelopeV1::new_bound(order_key, payload).expect("an envelope")
            }

            /// Seals and lifts one proposal a side decoded into, and applies the member the
            /// target-set Host would hand its kernel.
            fn propose(
                &mut self,
                label: &str,
                decode: impl FnOnce(u64) -> UnsealedGuestProposalV1,
            ) {
                self.sets += 1;
                let intent_identity =
                    [0x40 + u8::try_from(self.sets).expect("a short trajectory"); 16];
                let seal = |proposal| {
                    seal_guest_proposal_with_derived_digest_v1(
                        proposal,
                        intent_identity,
                        [8; 32],
                        [9; 32],
                    )
                    .expect("a sealed proposal")
                };
                let set = lift_single_instrument_proposal(
                    &["BTCUSDT-PERP.BINANCE"],
                    (self.sets > 1).then(|| self.sets - 1),
                    seal(decode(self.sets)),
                )
                .unwrap_or_else(|e| panic!("{label}: the Host does not lift it: {e:?}"));
                let mut member = set.members()[0];

                // The target-set Host reconciles a weight member at the grid position it derives
                // from equity and price. One unit in the weight's direction stands in for it here;
                // `an_authored_weight_program_enters_exits_and_enters_again` runs the real one.
                if let TargetProposalV1::WeightMicros(weight_micros) = member.target {
                    assert_eq!(
                        member.reconciliation_target_units, None,
                        "{label}: a lifted weight carries no reconciliation of its own"
                    );
                    member.reconciliation_target_units = Some(i64::from(weight_micros.signum()));
                }
                let proposal = seal(
                    UnsealedGuestProposalV1::new(
                        member.position,
                        member.target,
                        member.reconciliation_target_units,
                        member.protection,
                    )
                    .expect("a lifted member is a proposal"),
                );
                let envelope = self.envelope(EnvelopePayloadV1::Bar);
                self.kernel
                    .apply(envelope, Some(proposal))
                    .unwrap_or_else(|e| panic!("{label}: the kernel refuses it: {e:?}"));
            }

            /// Fills the pending intent completely.
            fn fill(&mut self) {
                let pending = self
                    .kernel
                    .checkpoint()
                    .pending_intent
                    .expect("an intent to fill");
                let envelope = self.envelope(EnvelopePayloadV1::Fill(FillEventV1 {
                    intent_identity: pending.intent_identity,
                    side: pending.side,
                    disposition: FillDispositionV1::Filled,
                    cumulative_filled_units: pending.expected_units,
                    leg: FillLegV1::Intent,
                }));
                self.kernel
                    .apply(envelope, None)
                    .expect("the kernel reconciles the fill");
            }

            fn position(&self) -> i64 {
                self.kernel.checkpoint().reconciled_position_units
            }
        }

        let mut authored = request();
        for (side, outcome) in [
            (when_true, &mut authored.when_true),
            (otherwise, &mut authored.otherwise),
        ] {
            *outcome = SingleThresholdOutcomeV1 {
                position_intent_semantic_id: side.0.to_owned(),
                target_variant_semantic_id: side.1.to_owned(),
                target_position_units: side.2,
                target_weight_micros: side.3,
            };
        }
        let (_, meaning) =
            author_single_threshold_program_v1(&authored).expect("the request is authorable");
        let table = &meaning.proposal_decision_table;
        let branch = |priority| {
            table
                .branches
                .iter()
                .find(|branch| branch.priority == priority)
                .map(|branch| &branch.frame)
        };
        let frames = [
            (when_true, branch(20).expect("the side above the threshold")),
            (otherwise, branch(30).unwrap_or(&table.default_frame)),
        ];
        let terminal_value = |frame: &BoundedFeatureProposalFrameV1, terminal| {
            let port = match terminal {
                ProposalTerminalV2::PositionIntent => "proposal.position-intent.v1",
                ProposalTerminalV2::TargetVariant => "proposal.target-variant.v1",
                ProposalTerminalV2::TargetPositionUnits => "proposal.target-position.v1",
                ProposalTerminalV2::TargetWeightMicros => "proposal.target-weight.v1",
                ProposalTerminalV2::RebalanceSequence => "proposal.rebalance-sequence.v1",
                ProposalTerminalV2::ReconciliationTargetUnits => {
                    "proposal.reconciliation-target.v1"
                }
                ProposalTerminalV2::ProtectionVariant => "proposal.protection-variant.v1",
                ProposalTerminalV2::StopLossTicks => "proposal.stop-loss.v1",
                ProposalTerminalV2::TakeProfitTicks => "proposal.take-profit.v1",
                ProposalTerminalV2::TrailingDistanceTicks => "proposal.trailing-distance.v1",
                ProposalTerminalV2::TrailingStopTicks => "proposal.trailing-stop.v1",
            };
            let terminal = frame
                .terminal_outputs
                .iter()
                .find(|terminal| terminal.manifest_port_id == port)
                .expect("every frame carries all eleven terminals");
            let BoundedFeatureValueRefV1::Constant { constant_id } = &terminal.source else {
                panic!("an authored terminal reads a constant");
            };
            let variant = |value_type, semantic_id: &String| {
                TypedValueV2::new(value_type, semantic_id.as_bytes()).expect("a variant value")
            };
            Ok(
                match &meaning
                    .constants
                    .iter()
                    .find(|constant| &constant.constant_id == constant_id)
                    .expect("a terminal's constant is declared")
                    .value
                {
                    BoundedFeatureConstantValueV1::I32 { value } => TypedValueV2::i32(*value),
                    BoundedFeatureConstantValueV1::I64 { value } => TypedValueV2::i64(*value),
                    BoundedFeatureConstantValueV1::U64 { value } => TypedValueV2::u64(*value),
                    BoundedFeatureConstantValueV1::PositionIntentV1 { semantic_id } => {
                        variant(ValueTypeV2::PositionIntentV1, semantic_id)
                    }
                    BoundedFeatureConstantValueV1::TargetVariantV1 { semantic_id } => {
                        variant(ValueTypeV2::TargetVariantV1, semantic_id)
                    }
                    BoundedFeatureConstantValueV1::ProtectionVariantV1 { semantic_id } => {
                        variant(ValueTypeV2::ProtectionVariantV1, semantic_id)
                    }
                    other => panic!("{port} reads a constant no terminal takes: {other:?}"),
                },
            )
        };
        let side = |intent: &str| {
            frames
                .iter()
                .find(|(side, _)| side.0 == intent)
                .map(|(side, frame)| {
                    let label = format!("{} {}", side.0, side.1);
                    let decode = move |sequence| {
                        decode_proposal_terminals_v2(
                            |terminal| terminal_value(frame, terminal),
                            || Some(sequence),
                        )
                        .unwrap_or_else(|e| panic!("{label}: the Host does not decode it: {e:?}"))
                    };
                    (format!("{} {}", side.0, side.1), decode)
                })
        };

        let mut trajectory = Trajectory {
            kernel: LifecycleKernelV1::new(KernelIdentitiesV1 {
                design_digest: [1; 32],
                plan_digest: [2; 32],
                artifact_digest: [3; 32],
                program_host_digest: [4; 32],
                kernel_digest: [5; 32],
                plugin_digest: [6; 32],
                market_semantics_digest: [7; 32],
            })
            .expect("a kernel"),
            clock: 0,
            sets: 0,
        };
        let start = trajectory.envelope(EnvelopePayloadV1::Start);
        trajectory
            .kernel
            .apply(start, None)
            .expect("the kernel starts");
        let hold = side("kernel.position.hold.v1");
        let enter = side("kernel.position.enter.v1");
        let exit = side("kernel.position.exit.v1");

        if let Some((label, decode)) = &hold {
            trajectory.propose(&format!("{label}, flat"), decode.clone());
        }

        if let Some((label, decode)) = &enter {
            trajectory.propose(label, decode.clone());
        } else {
            // Not authored: an exit needs a position to leave, and no authored side makes one.
            trajectory.propose("seed entry", |_| {
                UnsealedGuestProposalV1::new(
                    PositionIntentV1::Enter,
                    TargetProposalV1::Position(1),
                    Some(1),
                    ProtectionProposalV1::Keep,
                )
                .expect("a seed entry")
            });
        }
        trajectory.fill();
        assert_ne!(trajectory.position(), 0);

        if let Some((label, decode)) = &hold {
            trajectory.propose(&format!("{label}, held"), decode.clone());
        }

        if let Some((label, decode)) = &exit {
            trajectory.propose(label, decode.clone());
            trajectory.fill();
            assert_eq!(trajectory.position(), 0);

            if let Some((label, decode)) = &enter {
                trajectory.propose(&format!("{label}, again"), decode.clone());
                trajectory.fill();
                assert_ne!(trajectory.position(), 0);
            }
        }
    }

    /// A weight is read only by a weight side and only inside the kernel's domain; anything else
    /// is refused by name, on either side, and a weight side at the edges of the domain authors.
    #[rstest]
    #[case::weight_on_a_position_side(true, "kernel.target.position.v1", 1, Some(true))]
    #[case::weight_on_a_keep_side(false, "kernel.target.keep.v1", -1, Some(true))]
    #[case::weight_above_the_domain(true, WEIGHT_TARGET, 1_000_001, Some(false))]
    #[case::weight_below_the_domain(false, WEIGHT_TARGET, -1_000_001, Some(false))]
    #[case::the_full_long_weight(true, WEIGHT_TARGET, 1_000_000, None)]
    #[case::the_full_short_weight(false, WEIGHT_TARGET, -1_000_000, None)]
    fn a_weight_the_side_cannot_read_is_refused_by_name(
        #[case] when_true: bool,
        #[case] variant: &str,
        #[case] weight_micros: i32,
        #[case] refused_as_not_read: Option<bool>,
    ) {
        let mut authored = request();
        let (side, field) = if when_true {
            (&mut authored.when_true, "when_true.target_weight_micros")
        } else {
            (&mut authored.otherwise, "otherwise.target_weight_micros")
        };
        side.target_variant_semantic_id = variant.to_owned();
        side.target_weight_micros = weight_micros;

        // An exit leaves a position at nothing, so a side weighted away from 0 enters instead.
        if !when_true {
            side.position_intent_semantic_id = "kernel.position.enter.v1".to_owned();
        }

        let result = author_single_threshold_program_v1(&authored);

        match refused_as_not_read {
            None => {
                result.unwrap_or_else(|e| panic!("{weight_micros} authors: {e}"));
            }
            Some(true) => {
                let error = result.expect_err("refused");
                assert_eq!(
                    error,
                    SingleThresholdAuthoringErrorV1::WeightNotRead { field }
                );
                assert!(
                    error
                        .to_string()
                        .starts_with("SINGLE_THRESHOLD_WEIGHT_NOT_READ")
                );
            }
            Some(false) => {
                let error = result.expect_err("refused");
                assert_eq!(
                    error,
                    SingleThresholdAuthoringErrorV1::WeightOutOfRange { field }
                );
                assert!(
                    error
                        .to_string()
                        .starts_with("SINGLE_THRESHOLD_WEIGHT_OUT_OF_RANGE")
                );
            }
        }
    }

    /// Owner-shaped custody whose receipts are this test's own, not the request's.
    fn bindings(
        design: &StrategyDesignV2,
    ) -> crate::strategy_plan_v2::VerifiedStrategyInputBindingsV2 {
        verified_strategy_input_bindings_for_test(
            design,
            design
                .inputs
                .iter()
                .enumerate()
                .map(|(index, role)| {
                    let mut bytes = [0x5au8; 32];
                    bytes[0] = u8::try_from(index).expect("fewer than 256 roles");
                    (role.clone(), BindingDigest::from_untrusted_bytes(bytes))
                })
                .collect(),
        )
    }

    /// What the whole module is for: an authored pair must survive the same two steps a
    /// hand-written declaration does, with no database in reach of either.
    ///
    /// `derive` copies the graph through without inspecting it, so it cannot fail on a bad graph;
    /// `prepare` is what judges identity, bounds, inputs, the graph and the terminals. Both are
    /// here because passing only the first would prove the pair is well-formed, not that it is a
    /// program.
    #[rstest]
    fn an_authored_pair_derives_and_prepares() {
        let (design, meaning) =
            author_single_threshold_program_v1(&request()).expect("the request is authorable");

        let proposal = derive_bounded_feature_program_proposal_v1(
            &design,
            PrimitiveCatalogV1::verify().expect("a published catalog verifies"),
            &meaning,
            &bindings(&design),
        )
        .unwrap_or_else(|e| panic!("authored meaning does not assemble: {e}"));

        prepare_bounded_feature_program_v1(proposal, &design)
            .unwrap_or_else(|e| panic!("the assembled proposal does not prepare: {e}"));
    }

    /// Freezes a Design and meaning the way the Owner does: derive against Owner custody, then
    /// prepare, which is where canonical ordering and every judgement happens.
    fn frozen(
        design: &StrategyDesignV2,
        meaning: &BoundedFeatureProgramMeaningV1,
    ) -> CanonicalBoundedFeatureProgramV1 {
        let proposal = derive_bounded_feature_program_proposal_v1(
            design,
            PrimitiveCatalogV1::verify().expect("a published catalog verifies"),
            meaning,
            &bindings(design),
        )
        .unwrap_or_else(|e| panic!("meaning does not assemble: {e}"));
        prepare_bounded_feature_program_v1(proposal, design)
            .unwrap_or_else(|e| panic!("the assembled proposal does not prepare: {e}"))
    }

    fn authored(
        request: &SingleThresholdAuthoringRequestV1,
    ) -> (StrategyDesignV2, CanonicalBoundedFeatureProgramV1) {
        let (design, meaning) =
            author_single_threshold_program_v1(request).expect("the request is authorable");
        let program = frozen(&design, &meaning);
        (design, program)
    }

    /// The fields of an exact-instrument channel a case can change.
    struct ExactChannelFields<'a> {
        instrument: &'a mut String,
        timeframe: &'a mut String,
        scale: &'a mut u8,
    }

    fn exact_channel(request: &mut SingleThresholdAuthoringRequestV1) -> ExactChannelFields<'_> {
        let SingleThresholdChannelV1::ExactInstrument {
            instrument,
            timeframe,
            scale,
            ..
        } = &mut request.channel
        else {
            panic!("the base request reads one exact instrument");
        };
        ExactChannelFields {
            instrument,
            timeframe,
            scale,
        }
    }

    /// Every declared field is read out of the frozen pair, not assumed: each case differs from
    /// the base request in one field, and the statement read back must differ in that field too.
    #[rstest]
    #[case::base(|_: &mut SingleThresholdAuthoringRequestV1| {})]
    #[case::threshold(|r: &mut SingleThresholdAuthoringRequestV1| r.threshold = "-123.45".to_owned())]
    #[case::comparison(|r: &mut SingleThresholdAuthoringRequestV1| r.comparison = BoundedFeaturePredicateV1::LessOrEqual)]
    #[case::scale(|r: &mut SingleThresholdAuthoringRequestV1| *exact_channel(r).scale = 4)]
    #[case::instrument(|r: &mut SingleThresholdAuthoringRequestV1| *exact_channel(r).instrument = "ETHUSDT-PERP.BINANCE".to_owned())]
    #[case::timeframe(|r: &mut SingleThresholdAuthoringRequestV1| *exact_channel(r).timeframe = "1H".to_owned())]
    #[case::when_true(|r: &mut SingleThresholdAuthoringRequestV1| r.when_true.target_position_units = 3)]
    #[case::weight(|r: &mut SingleThresholdAuthoringRequestV1| {
        r.when_true.target_variant_semantic_id = WEIGHT_TARGET.to_owned();
        r.when_true.target_weight_micros = 250_000;
    })]
    #[case::otherwise(|r: &mut SingleThresholdAuthoringRequestV1| r.otherwise.position_intent_semantic_id = "kernel.position.hold.v1".to_owned())]
    #[case::falsifier(|r: &mut SingleThresholdAuthoringRequestV1| r.falsifier = "a different statement to be wrong about".to_owned())]
    #[case::stop_loss(|r: &mut SingleThresholdAuthoringRequestV1| r.stop_loss_fraction = Some("0.02".to_owned()))]
    #[case::take_profit(|r: &mut SingleThresholdAuthoringRequestV1| r.take_profit_fraction = Some("0.035".to_owned()))]
    #[case::max_holding_bars(|r: &mut SingleThresholdAuthoringRequestV1| r.max_holding_bars = Some(5))]
    #[case::fractions_of_two_precisions(|r: &mut SingleThresholdAuthoringRequestV1| {
        r.stop_loss_fraction = Some("0.02".to_owned());
        r.take_profit_fraction = Some("0.005".to_owned());
    })]
    #[case::every_exit_short(|r: &mut SingleThresholdAuthoringRequestV1| {
        with_every_exit(r);
        r.when_true.target_position_units = -1;
    })]
    #[case::every_exit_both_directions(largest_request_shape)]
    fn a_frozen_authored_program_states_the_request_it_was_authored_from(
        #[case] change: fn(&mut SingleThresholdAuthoringRequestV1),
    ) {
        let mut expected = request();
        change(&mut expected);
        let (design, program) = authored(&expected);

        assert_eq!(
            recover_single_threshold_request_v1(&design, &program),
            Some(expected)
        );
    }

    /// Names every exit.
    fn with_every_exit(request: &mut SingleThresholdAuthoringRequestV1) {
        request.stop_loss_fraction = Some("0.02".to_owned());
        request.take_profit_fraction = Some("0.005".to_owned());
        request.max_holding_bars = Some(5);
    }

    /// The largest program the family authors: every exit, and a side entering in each direction,
    /// so both directions' exits are judged.
    fn largest_request_shape(request: &mut SingleThresholdAuthoringRequestV1) {
        with_every_exit(request);
        request.otherwise = SingleThresholdOutcomeV1 {
            position_intent_semantic_id: "kernel.position.enter.v1".to_owned(),
            target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
            target_position_units: -1,
            target_weight_micros: 0,
        };
    }

    /// The family's bounds are exactly the largest programs' shape: each graph bound equals the
    /// most either form's largest program measures, so none is loose, and both still prepare.
    #[rstest]
    fn the_family_bounds_are_the_largest_programs_shape() {
        use crate::bounded_feature_program_v1::measure_bounded_feature_program_shape_v1;

        let mut largest = (0, 0, 0, 0, 0, 0, 0, 0);

        for mut request in [request(), universe_request()] {
            largest_request_shape(&mut request);
            let (design, meaning) =
                author_single_threshold_program_v1(&request).expect("the largest request authors");
            let proposal = derive_bounded_feature_program_proposal_v1(
                &design,
                PrimitiveCatalogV1::verify().expect("a published catalog"),
                &meaning,
                &bindings(&design),
            )
            .expect("the largest meaning assembles");
            let shape = measure_bounded_feature_program_shape_v1(proposal, &design)
                .expect("the largest program measures");
            largest = (
                largest.0.max(shape.nodes),
                largest.1.max(shape.edges),
                largest.2.max(shape.depth),
                largest.3.max(shape.ports),
                largest.4.max(shape.constants),
                largest.5.max(shape.fan_out),
                largest.6.max(shape.state_cells),
                largest.7.max(shape.decision_branches),
            );
            frozen(&design, &meaning);
        }
        let bounds = FAMILY_GRAPH_BOUNDS;

        assert_eq!(
            largest,
            (
                bounds.max_nodes,
                bounds.max_edges,
                bounds.max_depth,
                bounds.max_ports,
                bounds.max_constants,
                bounds.max_fan_out,
                bounds.max_state_cells,
                bounds.max_decision_branches,
            ),
        );
    }

    /// Each malformed exit is refused under its own name.
    #[rstest]
    #[case::fraction_without_a_leading_zero(|r: &mut SingleThresholdAuthoringRequestV1| r.stop_loss_fraction = Some(".02".to_owned()), SingleThresholdAuthoringErrorV1::ExitFractionInvalid { field: "stop_loss_fraction" })]
    #[case::fraction_with_a_trailing_zero(|r: &mut SingleThresholdAuthoringRequestV1| r.take_profit_fraction = Some("0.020".to_owned()), SingleThresholdAuthoringErrorV1::ExitFractionInvalid { field: "take_profit_fraction" })]
    #[case::fraction_of_zero(|r: &mut SingleThresholdAuthoringRequestV1| r.stop_loss_fraction = Some("0.0".to_owned()), SingleThresholdAuthoringErrorV1::ExitFractionInvalid { field: "stop_loss_fraction" })]
    #[case::fraction_of_one(|r: &mut SingleThresholdAuthoringRequestV1| r.stop_loss_fraction = Some("1".to_owned()), SingleThresholdAuthoringErrorV1::ExitFractionInvalid { field: "stop_loss_fraction" })]
    #[case::negative_fraction(|r: &mut SingleThresholdAuthoringRequestV1| r.take_profit_fraction = Some("-0.02".to_owned()), SingleThresholdAuthoringErrorV1::ExitFractionInvalid { field: "take_profit_fraction" })]
    #[case::fraction_too_precise(|r: &mut SingleThresholdAuthoringRequestV1| r.stop_loss_fraction = Some("0.0000000001".to_owned()), SingleThresholdAuthoringErrorV1::ExitFractionTooPrecise { field: "stop_loss_fraction" })]
    #[case::zero_holding_bars(|r: &mut SingleThresholdAuthoringRequestV1| r.max_holding_bars = Some(0), SingleThresholdAuthoringErrorV1::MaxHoldingBarsZero)]
    #[case::price_exit_on_another_channel(|r: &mut SingleThresholdAuthoringRequestV1| {
        let SingleThresholdChannelV1::ExactInstrument { field_semantic_id, .. } = &mut r.channel else {
            panic!("the base request is the exact-instrument form");
        };
        *field_semantic_id = "MARKET_DATA.BAR.OPEN.PRICE.V1".to_owned();
        r.stop_loss_fraction = Some("0.02".to_owned());
    }, SingleThresholdAuthoringErrorV1::ExitNeedsCloseChannel { field: "stop_loss_fraction", channel: "MARKET_DATA.BAR.OPEN.PRICE.V1".to_owned() })]
    #[case::exit_without_a_position(|r: &mut SingleThresholdAuthoringRequestV1| {
        r.when_true = r.otherwise.clone();
        r.when_true.position_intent_semantic_id = "kernel.position.hold.v1".to_owned();
        r.when_true.target_variant_semantic_id = "kernel.target.keep.v1".to_owned();
        r.otherwise = r.when_true.clone();
        r.otherwise.target_position_units = 1;
        r.max_holding_bars = Some(3);
    }, SingleThresholdAuthoringErrorV1::ExitWithoutPosition { field: "max_holding_bars" })]
    #[case::an_exit_with_nothing_to_leave(|r: &mut SingleThresholdAuthoringRequestV1| {
        r.when_true.position_intent_semantic_id = "kernel.position.hold.v1".to_owned();
        r.when_true.target_variant_semantic_id = "kernel.target.keep.v1".to_owned();
        r.when_true.target_position_units = 0;
    }, SingleThresholdAuthoringErrorV1::SideNeverPermitted { field: "otherwise.position_intent_semantic_id" })]
    fn a_malformed_exit_or_an_unreachable_side_is_refused_by_name(
        #[case] change: fn(&mut SingleThresholdAuthoringRequestV1),
        #[case] refusal: SingleThresholdAuthoringErrorV1,
    ) {
        let mut refused = request();
        change(&mut refused);

        assert_eq!(author_single_threshold_program_v1(&refused), Err(refusal));
    }

    /// A refusal's code is the name its message leads with, wherever the message names one, so a
    /// caller that reads either reads the same name.
    #[rstest]
    fn each_refusal_code_is_the_name_its_message_leads_with() {
        for error in [
            SingleThresholdAuthoringErrorV1::Identifier("falsifier"),
            SingleThresholdAuthoringErrorV1::IndistinguishableOutcomes,
            SingleThresholdAuthoringErrorV1::UnknownFieldSemantic("X".to_owned()),
            SingleThresholdAuthoringErrorV1::WeightNotRead { field: "f" },
            SingleThresholdAuthoringErrorV1::WeightOutOfRange { field: "f" },
            SingleThresholdAuthoringErrorV1::SideNeverPermitted { field: "f" },
            SingleThresholdAuthoringErrorV1::ExitFractionInvalid { field: "f" },
            SingleThresholdAuthoringErrorV1::ExitFractionTooPrecise { field: "f" },
            SingleThresholdAuthoringErrorV1::ExitNeedsCloseChannel {
                field: "f",
                channel: "C".to_owned(),
            },
            SingleThresholdAuthoringErrorV1::MaxHoldingBarsZero,
            SingleThresholdAuthoringErrorV1::ExitWithoutPosition { field: "f" },
        ] {
            let message = error.to_string();
            assert!(error.code().starts_with("SINGLE_THRESHOLD_"), "{message}");

            if message.starts_with("SINGLE_THRESHOLD_") {
                assert!(
                    message.starts_with(&format!("{}:", error.code())),
                    "{message}"
                );
            }
        }
    }

    /// A request that names no exit keeps its serialized bytes: the three fields are omitted, not
    /// written as null, so a statement written before they existed still reads and writes the same.
    #[rstest]
    fn a_request_without_exits_keeps_its_serialized_bytes() {
        let text = serde_json::to_string(&request()).expect("the request serialises");

        for field in [
            "stop_loss_fraction",
            "take_profit_fraction",
            "max_holding_bars",
        ] {
            assert!(!text.contains(field), "{field} is omitted");
        }
        let mut exits = request();
        with_every_exit(&mut exits);
        let text = serde_json::to_string(&exits).expect("the request serialises");
        let read: SingleThresholdAuthoringRequestV1 =
            serde_json::from_str(&text).expect("the request reads back");
        assert_eq!(read, exits);
    }

    /// A program whose declared fields all read back cleanly, but which fixes a terminal this
    /// family never varies, is not in the family. Reading alone would state a strategy for it;
    /// authoring again is what refuses.
    #[rstest]
    fn a_program_the_family_would_not_author_has_no_statement() {
        let (design, mut meaning) =
            author_single_threshold_program_v1(&request()).expect("the request is authorable");
        let sequence = meaning
            .constants
            .iter_mut()
            .find(|constant| constant.constant_id == REBALANCE)
            .expect("the family declares a rebalance sequence");
        sequence.value = BoundedFeatureConstantValueV1::U64 { value: 7 };
        let program = frozen(&design, &meaning);

        assert_eq!(recover_single_threshold_request_v1(&design, &program), None);
    }

    /// The same for the Design half: a Design the family would not write, carrying a program the
    /// family would, is not in the family either.
    #[rstest]
    fn a_design_the_family_would_not_author_has_no_statement() {
        let (mut design, meaning) =
            author_single_threshold_program_v1(&request()).expect("the request is authorable");
        design.resources.max_dependency_edges = 255;
        let program = frozen(&design, &meaning);

        assert_eq!(recover_single_threshold_request_v1(&design, &program), None);
    }

    /// The Design half must canonicalize on its own, which is what gives the pair an identity.
    #[rstest]
    fn the_authored_design_canonicalizes() {
        let (design, _) =
            author_single_threshold_program_v1(&request()).expect("the request is authorable");

        assert!(
            matches!(
                prepare_strategy_design_v2(&design),
                StrategyDesignPreparationV2::Prepared { .. }
            ),
            "an authored Design canonicalizes",
        );
    }

    /// The refusal this module adds over the existing specimen.
    ///
    /// The positive control is the whole point: the identical-outcome program is refused *here*,
    /// and the only difference from the accepted request above is the outcome. Without that
    /// control this test would also pass if authoring refused everything.
    #[rstest]
    fn two_identical_outcomes_are_refused() {
        let mut degenerate = request();
        degenerate.otherwise = degenerate.when_true.clone();

        assert_eq!(
            author_single_threshold_program_v1(&degenerate),
            Err(SingleThresholdAuthoringErrorV1::IndistinguishableOutcomes),
        );
        assert!(
            author_single_threshold_program_v1(&request()).is_ok(),
            "the same request with differing outcomes is authorable",
        );
    }

    /// Both frames must be emitted in full, and they must differ.
    ///
    /// A frame that dropped a terminal, or two frames that agreed on every terminal, would still
    /// derive and prepare. This is what `prepare` cannot catch.
    #[rstest]
    fn the_two_frames_are_complete_and_distinct() {
        let (_, meaning) =
            author_single_threshold_program_v1(&request()).expect("the request is authorable");
        let table = &meaning.proposal_decision_table;

        // An entry and an exit are each proposed only from where the kernel accepts them, so each
        // is a branch of its own, and the program holds when neither is admitted.
        let priorities = table
            .branches
            .iter()
            .map(|branch| branch.priority)
            .collect::<Vec<_>>();
        assert_eq!(priorities, [20, 30], "one branch per side of the threshold");
        let frames = [
            &table.branches[0].frame,
            &table.branches[1].frame,
            &table.default_frame,
        ];

        for frame in frames {
            assert_eq!(
                frame.terminal_outputs.len(),
                11,
                "every frame carries the manifest's whole proposal port set",
            );
        }
        assert_ne!(
            frames[0], frames[1],
            "the two sides of the threshold propose different frames",
        );
        assert_eq!(
            frames[2],
            &frame(
                &hold_outcome(),
                HOLD_IDS.0,
                HOLD_IDS.1,
                HOLD_IDS.2,
                HOLD_IDS.3,
                HOLD_IDS.4
            ),
            "neither side admitted, the program holds",
        );
    }

    /// The threshold takes the channel's unit and scale, because the primitive is equal-scale.
    #[rstest]
    fn the_threshold_carries_the_channel_unit_and_scale() {
        let source = request();
        let (_, meaning) =
            author_single_threshold_program_v1(&source).expect("the request is authorable");

        let threshold = meaning
            .constants
            .iter()
            .find(|constant| constant.constant_id == THRESHOLD)
            .expect("the graph declares its threshold");

        let SingleThresholdChannelV1::ExactInstrument { unit, scale, .. } = &source.channel else {
            panic!("the base request is the exact-instrument form");
        };
        assert_eq!(
            threshold.value,
            BoundedFeatureConstantValueV1::FixedI128 {
                coefficient: threshold_coefficient_v1(&source.threshold, *scale)
                    .expect("the base threshold converts"),
                unit: unit.clone(),
                scale: *scale,
            },
        );
    }

    /// A threshold is read as a decimal at the channel's scale, exactly: equivalent spellings are one
    /// value, and the value reads back from its one canonical spelling.
    #[rstest]
    #[case::whole("120", 2, 12_000)]
    #[case::trailing_zero("120.0", 2, 12_000)]
    #[case::trailing_zeros_to_the_scale("120.00", 2, 12_000)]
    #[case::trailing_zeros_past_the_scale("120.000", 2, 12_000)]
    #[case::fraction("123.45", 2, 12_345)]
    #[case::negative("-0.5", 2, -50)]
    #[case::zero("0", 2, 0)]
    #[case::negative_zero("-0", 2, 0)]
    #[case::fraction_below_one("0.07", 2, 7)]
    #[case::value_scale("120", 9, 120_000_000_000)]
    fn a_threshold_is_read_exactly_at_the_channel_scale(
        #[case] text: &str,
        #[case] scale: u8,
        #[case] coefficient: i128,
    ) {
        assert_eq!(threshold_coefficient_v1(text, scale), Ok(coefficient));
        let canonical = canonical_threshold_text(coefficient, scale);
        assert_eq!(threshold_coefficient_v1(&canonical, scale), Ok(coefficient));
        assert_eq!(
            canonical_threshold_text(
                threshold_coefficient_v1(&canonical, scale).expect("canonical reads"),
                scale
            ),
            canonical,
            "the canonical spelling is a fixed point"
        );
    }

    /// The canonical spelling has no trailing fractional zero and no `.` for a whole value.
    #[rstest]
    #[case(12_000, 2, "120")]
    #[case(12_345, 2, "123.45")]
    #[case(12_340, 2, "123.4")]
    #[case(-50, 2, "-0.5")]
    #[case(7, 2, "0.07")]
    #[case(0, 2, "0")]
    #[case(120_000_000_000, 9, "120")]
    #[case(5, 0, "5")]
    fn a_threshold_has_one_canonical_spelling(
        #[case] coefficient: i128,
        #[case] scale: u8,
        #[case] text: &str,
    ) {
        assert_eq!(canonical_threshold_text(coefficient, scale), text);
    }

    /// Text that is not a plain decimal is refused by name, as is a value the channel cannot hold.
    #[rstest]
    #[case::empty("", SingleThresholdAuthoringErrorV1::ThresholdInvalid)]
    #[case::plus("+120", SingleThresholdAuthoringErrorV1::ThresholdInvalid)]
    #[case::leading_zero("0120", SingleThresholdAuthoringErrorV1::ThresholdInvalid)]
    #[case::bare_point("120.", SingleThresholdAuthoringErrorV1::ThresholdInvalid)]
    #[case::leading_point(".5", SingleThresholdAuthoringErrorV1::ThresholdInvalid)]
    #[case::exponent("1.2e2", SingleThresholdAuthoringErrorV1::ThresholdInvalid)]
    #[case::whitespace(" 120", SingleThresholdAuthoringErrorV1::ThresholdInvalid)]
    #[case::double_sign("--1", SingleThresholdAuthoringErrorV1::ThresholdInvalid)]
    #[case::finer("123.456", SingleThresholdAuthoringErrorV1::ThresholdFinerThanChannelScale { scale: 2 })]
    #[case::overflow("170141183460469231731687303715884105727", SingleThresholdAuthoringErrorV1::ThresholdOverflowsChannelScale { scale: 2 })]
    fn a_threshold_the_channel_cannot_hold_is_refused_by_name(
        #[case] text: &str,
        #[case] refusal: SingleThresholdAuthoringErrorV1,
    ) {
        assert_eq!(threshold_coefficient_v1(text, 2), Err(refusal));
    }

    /// The author refuses the request whose threshold its channel cannot hold, and a request
    /// recovered from its program spells the threshold canonically.
    #[rstest]
    fn the_request_states_its_threshold_canonically_and_refuses_a_finer_one() {
        let mut finer = request();
        finer.threshold = "100.001".to_owned();
        assert_eq!(
            author_single_threshold_program_v1(&finer).err(),
            Some(SingleThresholdAuthoringErrorV1::ThresholdFinerThanChannelScale { scale: 2 })
        );

        let mut spelled = request();
        spelled.threshold = "100.000".to_owned();
        let (design, meaning) =
            author_single_threshold_program_v1(&spelled).expect("an equivalent spelling authors");
        let (canonical_design, canonical_meaning) =
            author_single_threshold_program_v1(&request()).expect("the base request authors");
        assert_eq!(
            (&design, &meaning),
            (&canonical_design, &canonical_meaning),
            "equivalent spellings author one program"
        );
    }

    /// An empty or padded identifier is refused, and the field is named.
    #[rstest]
    #[case::empty("")]
    #[case::padded(" research.input.close.daily.v1 ")]
    fn an_inexact_identifier_is_refused(#[case] role: &str) {
        let mut inexact = request();
        let SingleThresholdChannelV1::ExactInstrument {
            role_semantic_id, ..
        } = &mut inexact.channel
        else {
            panic!("the base request is the exact-instrument form");
        };
        *role_semantic_id = role.to_owned();

        assert_eq!(
            author_single_threshold_program_v1(&inexact),
            Err(SingleThresholdAuthoringErrorV1::Identifier(
                "channel.role_semantic_id"
            )),
        );
    }

    /// The exact-instrument form's output, pinned byte for byte.
    ///
    /// A universe-member form is being added beside this one, and it shares the builders below.
    /// Every run already authored in this form is recognised by authoring it again and comparing
    /// bytes, so a change here that no test notices silently moves every earlier run out of the
    /// family. The Design is pinned by the identity and digest it canonicalizes to; the meaning,
    /// which has no canonical form of its own until it is assembled against receipts and a
    /// catalog, is pinned by the SHA-256 of its serialized bytes. The assembled program is not
    /// pinned here: its bytes also carry the catalog and SDK digests, which change for reasons
    /// that are not this form's. If a change to this form is intended, these values change with a
    /// sentence saying why.
    #[rstest]
    fn the_exact_instrument_form_keeps_its_bytes_and_identity() {
        let (design, meaning) =
            author_single_threshold_program_v1(&request()).expect("the request is authorable");
        let StrategyDesignPreparationV2::Prepared {
            design_identity,
            design_digest,
        } = prepare_strategy_design_v2(&design)
        else {
            panic!("an authored Design canonicalizes");
        };
        let meaning_bytes = serde_json::to_vec(&meaning).expect("the meaning serialises");
        let hex = |bytes: &[u8]| {
            bytes
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        };

        assert_eq!(
            (
                hex(design_identity.as_bytes()),
                hex(design_digest.as_bytes()),
                hex(&<sha2::Sha256 as sha2::Digest>::digest(&meaning_bytes)),
            ),
            (
                // The Design moved once, when the plugin's fuel bound rose from 100,000 to the
                // family's measured need of 1,000,000.
                "5bdc590d3c37093ef2ae35cc6ae6609a76a1d870a3b9cc3461a2e4af7913ad5f".to_owned(),
                "63759f64de22d977427a5e4f7809417c91630dd3e22657809308324b74010e10".to_owned(),
                // Moved when each frame's reconciliation target began reading its own side's
                // target position instead of one shared constant of 0, and again when the
                // rebalance sequence became the Host's (0 in the program) and each frame's
                // protection began following its own side's intent, and again when each frame's
                // target weight became its own side's, and again when the program began carrying
                // the position it believes it holds and proposing a side only from a position the
                // kernel accepts it at.
                "55d45374bf8574cd9a3d97a1b9353684528f3e82947a83162fd24edf52e4b247".to_owned(),
            ),
        );
    }

    const UNIVERSE_CLOSE_ROLE: &str = "research.input.close.daily.v1";
    const UNIVERSE_OPEN_ROLE: &str = "research.input.open.daily.v1";

    /// The base request in the universe-member form: the same statement, read for the one member
    /// of an Owner universe.
    fn universe_request() -> SingleThresholdAuthoringRequestV1 {
        SingleThresholdAuthoringRequestV1 {
            channel: SingleThresholdChannelV1::UniverseMember {
                close_role_semantic_id: UNIVERSE_CLOSE_ROLE.to_owned(),
                open_role_semantic_id: UNIVERSE_OPEN_ROLE.to_owned(),
            },
            ..request()
        }
    }

    /// The universe-member pair assembled into a program, before preparation judges it.
    ///
    /// It is assembled against universe authority of one member, the only authority an Owner
    /// issues for a universe-member Design. Exact-instrument receipts for its roles would assemble
    /// too, but no Owner ever issues them for it, and assembling against them hid that derivation
    /// could not read universe authority at all.
    fn universe_proposal() -> (StrategyDesignV2, BoundedFeatureProgramProposalV1) {
        let (design, meaning) = author_single_threshold_program_v1(&universe_request())
            .expect("the universe-member request is authorable");
        let proposal = derive_bounded_feature_program_proposal_v1(
            &design,
            PrimitiveCatalogV1::verify().expect("a published catalog verifies"),
            &meaning,
            &verified_universe_bindings_for_test(&design, &["BTCUSDT-PERP.BINANCE"]),
        )
        .unwrap_or_else(|e| panic!("authored universe-member meaning does not assemble: {e}"));
        (design, proposal)
    }

    /// The universe-member form survives the same two steps as the exact-instrument form, and
    /// carries the fixed `OPEN` role without reading it.
    #[rstest]
    fn a_universe_member_pair_derives_and_prepares() {
        let (design, proposal) = universe_proposal();

        assert_eq!(
            design
                .inputs
                .iter()
                .map(|role| (
                    role.semantic_id.as_str(),
                    role.scope.clone(),
                    role.instrument.as_str()
                ))
                .collect::<Vec<_>>(),
            vec![
                (UNIVERSE_CLOSE_ROLE, InputScopeV2::UniverseMembers, ""),
                (UNIVERSE_OPEN_ROLE, InputScopeV2::UniverseMembers, ""),
            ],
            "the Design declares the vertical's two member roles and names no instrument",
        );
        assert_eq!(
            proposal.carried_input_role_ids,
            vec![UNIVERSE_OPEN_ROLE.to_owned()]
        );

        let prepared = prepare_bounded_feature_program_v1(proposal, &design)
            .unwrap_or_else(|e| panic!("the universe-member program does not prepare: {e}"));
        // The canonical bytes carry the carried role, and they are the canonical encoding of the
        // program they decode to.
        let reparsed = parse_bounded_feature_program_v1(prepared.canonical_bytes(), &design)
            .expect("the canonical bytes parse back");
        assert_eq!(reparsed.canonical_bytes(), prepared.canonical_bytes());
        assert_eq!(
            reparsed.program().carried_input_role_ids,
            vec![UNIVERSE_OPEN_ROLE.to_owned()]
        );
    }

    /// A frozen universe-member pair states the request it was authored from, read from the Design
    /// the Owner stores: its canonical form, where the member roles are ordered by the ids the
    /// author chose. The second case chooses ids that put `OPEN` first, so a reading by position
    /// would state the carried role as the channel.
    #[rstest]
    #[case::close_sorts_first(UNIVERSE_CLOSE_ROLE, UNIVERSE_OPEN_ROLE)]
    #[case::open_sorts_first("research.input.z.close.daily.v1", "research.input.a.open.daily.v1")]
    fn a_frozen_universe_member_program_states_its_request_whatever_the_role_order(
        #[case] close: &str,
        #[case] open: &str,
    ) {
        let expected = SingleThresholdAuthoringRequestV1 {
            channel: SingleThresholdChannelV1::UniverseMember {
                close_role_semantic_id: close.to_owned(),
                open_role_semantic_id: open.to_owned(),
            },
            ..request()
        };
        let (design, program) = authored(&expected);
        let stored: StrategyDesignV2 = serde_json::from_slice(
            crate::strategy_plan_v2::prepare_canonical_strategy_design_v2(&design)
                .expect("the authored Design canonicalizes")
                .canonical_bytes(),
        )
        .expect("the canonical Design parses");
        assert_eq!(
            stored.inputs[0].field_semantic_id,
            if close < open {
                UNIVERSE_CLOSE_FIELD_SEMANTIC_ID_V2
            } else {
                UNIVERSE_OPEN_FIELD_SEMANTIC_ID_V2
            },
            "the stored Design orders its roles by id, which is what this case relies on"
        );

        assert_eq!(
            recover_single_threshold_request_v1(&stored, &program),
            Some(expected)
        );
    }

    /// The channel's form is read from the scope each role declares. A Design of two
    /// exact-instrument roles that read `CLOSE` and `OPEN` is the shape an exact form carrying a
    /// second role would take; read by role count it would be guessed a universe member, and it is
    /// outside the family instead. So are mixed scopes and a single universe-member role.
    #[rstest]
    #[case::one_exact_role(|_: &mut StrategyDesignV2| {}, false, Some("EXACT"))]
    #[case::two_universe_roles(|_: &mut StrategyDesignV2| {}, true, Some("UNIVERSE"))]
    #[case::two_exact_roles(|d: &mut StrategyDesignV2| for role in &mut d.inputs {
        role.scope = InputScopeV2::ExactInstrument;
        role.instrument = "BTCUSDT-PERP.BINANCE".to_owned();
    }, true, None)]
    #[case::mixed_scopes(|d: &mut StrategyDesignV2| {
        d.inputs[0].scope = InputScopeV2::ExactInstrument;
        d.inputs[0].instrument = "BTCUSDT-PERP.BINANCE".to_owned();
    }, true, None)]
    #[case::one_universe_role(|d: &mut StrategyDesignV2| d.inputs.truncate(1), true, None)]
    fn the_channel_form_is_read_from_each_roles_declared_scope(
        #[case] change: fn(&mut StrategyDesignV2),
        #[case] universe: bool,
        #[case] expected: Option<&str>,
    ) {
        let request = if universe {
            universe_request()
        } else {
            request()
        };
        let (mut design, _) =
            author_single_threshold_program_v1(&request).expect("the request is authorable");
        change(&mut design);

        let form = candidate_channel(&design).map(|channel| match channel {
            SingleThresholdChannelV1::ExactInstrument { .. } => "EXACT",
            SingleThresholdChannelV1::UniverseMember { .. } => "UNIVERSE",
        });
        assert_eq!(form, expected);
    }

    /// The authored Design is one the universe contract admits for a one-member universe, and is
    /// refused for two, where the vertical needs a whole target set the program does not emit.
    #[rstest]
    fn the_universe_member_design_is_admitted_for_one_member_only() {
        let (design, _) = author_single_threshold_program_v1(&universe_request())
            .expect("the universe-member request is authorable");

        assert_eq!(
            validate_universe_target_set_contract_for_test(design.clone(), Some(1)),
            Ok(()),
        );
        assert!(matches!(
            validate_universe_target_set_contract_for_test(design, Some(2)),
            Err(StrategyCompilationV2::NeedsResearchRefinement(CompilationIssueV2 { reason, .. }))
                if reason.contains("more than one member requires one complete instrument target set")
        ));
    }

    /// Under a one-member universe each role binds the Owner's binding of that role at member 0,
    /// for both its value and its coordinate.
    #[rstest]
    fn the_bfp_role_table_binds_the_sole_member() {
        let (design, _) = author_single_threshold_program_v1(&universe_request())
            .expect("the universe-member request is authorable");
        let (close_digest, open_digest) = (digest(40), digest(41));
        let table = project_bfp_role_bindings_for_test(
            &design,
            vec![],
            vec![
                (design.inputs[0].clone(), vec![close_digest]),
                (design.inputs[1].clone(), vec![open_digest]),
            ],
        )
        .expect("a one-member universe projects");

        let mut rows = table
            .iter()
            .map(|row| {
                (
                    row.input_role_id().to_owned(),
                    row.kind(),
                    row.member_ordinal(),
                    row.static_binding_receipt_digest(),
                )
            })
            .collect::<Vec<_>>();
        rows.sort_by(|a, b| (&a.0, a.1).cmp(&(&b.0, b.1)));
        assert_eq!(
            rows,
            vec![
                (
                    UNIVERSE_CLOSE_ROLE.to_owned(),
                    BfpRoleBindingKindV1::Value,
                    Some(0),
                    close_digest
                ),
                (
                    UNIVERSE_CLOSE_ROLE.to_owned(),
                    BfpRoleBindingKindV1::Coordinate,
                    Some(0),
                    close_digest
                ),
                (
                    UNIVERSE_OPEN_ROLE.to_owned(),
                    BfpRoleBindingKindV1::Value,
                    Some(0),
                    open_digest
                ),
                (
                    UNIVERSE_OPEN_ROLE.to_owned(),
                    BfpRoleBindingKindV1::Coordinate,
                    Some(0),
                    open_digest
                ),
            ],
        );
    }

    /// With two members, the table is refused by name instead of binding the first member.
    ///
    /// Taking `members[0]` would bind the program to one instrument of a universe it cannot trade,
    /// and nothing downstream would notice. The control is the same Design with one member.
    #[rstest]
    fn a_two_member_universe_is_refused_by_name_not_bound_to_its_first_member() {
        let (design, _) = author_single_threshold_program_v1(&universe_request())
            .expect("the universe-member request is authorable");
        let roles = |members: usize| {
            design
                .inputs
                .iter()
                .map(|role| {
                    (
                        role.clone(),
                        (0..members).map(|m| digest(50 + m as u8)).collect(),
                    )
                })
                .collect::<Vec<_>>()
        };

        assert!(project_bfp_role_bindings_for_test(&design, vec![], roles(1)).is_ok());
        assert_eq!(
            project_bfp_role_bindings_for_test(&design, vec![], roles(2)),
            Err(StrategyCompilationV2::Unsupported(CompilationIssueV2 {
                coordinate: "universe_bindings.members".to_owned(),
                reason:
                    "a bounded feature program reads a universe only when it has exactly one member"
                        .to_owned(),
                refusal: None,
            })),
        );
    }

    /// A graph that reads the carried role is refused under that name.
    ///
    /// The mutation points the comparison at `OPEN`, so `CLOSE` also goes unread; the refusal
    /// must still be the carried one, which is why it is checked first.
    #[rstest]
    fn a_graph_that_reads_the_carried_role_is_refused_by_name() {
        let (design, mut proposal) = universe_proposal();
        proposal.nodes[0].input_bindings[0].source = BoundedFeatureValueRefV1::InputValue {
            input_role_id: UNIVERSE_OPEN_ROLE.to_owned(),
        };

        assert_eq!(
            prepare_bounded_feature_program_v1(proposal, &design).map(|_| ()),
            Err(BoundedFeatureProgramErrorV1::CarriedInputRead),
        );
    }

    /// The exemption from the unread-input rule is the carried declaration alone: the same
    /// program with the declaration removed is refused, because `OPEN` is then an input left
    /// unread. The control is the program as authored, which prepares.
    #[rstest]
    fn an_undeclared_unread_input_is_still_refused() {
        let (design, proposal) = universe_proposal();
        let mut undeclared = proposal.clone();
        undeclared.carried_input_role_ids.clear();

        assert!(prepare_bounded_feature_program_v1(proposal, &design).is_ok());
        assert_eq!(
            prepare_bounded_feature_program_v1(undeclared, &design).map(|_| ()),
            Err(BoundedFeatureProgramErrorV1::State),
        );
    }

    /// A carried section written out empty is not the canonical form of any program: the encoder
    /// writes the section only when it is non-empty, so accepting an empty one would give an
    /// ordinary program a second encoding.
    #[rstest]
    fn an_empty_carried_section_is_not_canonical() {
        let (design, meaning) =
            author_single_threshold_program_v1(&request()).expect("the request is authorable");
        let proposal = derive_bounded_feature_program_proposal_v1(
            &design,
            PrimitiveCatalogV1::verify().expect("a published catalog verifies"),
            &meaning,
            &bindings(&design),
        )
        .expect("the exact-instrument pair assembles");
        let prepared = prepare_bounded_feature_program_v1(proposal, &design).expect("it prepares");
        let mut padded = prepared.canonical_bytes().to_vec();
        // An empty sequence: its length prefix and nothing after it.
        padded.extend_from_slice(&0u16.to_le_bytes());

        assert!(parse_bounded_feature_program_v1(prepared.canonical_bytes(), &design).is_ok());
        assert_eq!(
            parse_bounded_feature_program_v1(&padded, &design).map(|_| ()),
            Err(BoundedFeatureProgramErrorV1::NonCanonical),
        );
    }

    /// A request that does not say which form it is, is refused rather than read as the
    /// exact-instrument form. The channel is written out by hand without its tag, so the refusal
    /// is judged on input a caller could send; the control is the same request with the tag,
    /// which parses back to itself.
    #[rstest]
    #[case::exact_instrument(request(), "EXACT_INSTRUMENT")]
    #[case::universe_member(universe_request(), "UNIVERSE_MEMBER")]
    fn a_request_without_its_scope_is_refused(
        #[case] source: SingleThresholdAuthoringRequestV1,
        #[case] scope: &str,
    ) {
        let untagged_channel = match &source.channel {
            SingleThresholdChannelV1::ExactInstrument {
                role_semantic_id,
                instrument,
                field_semantic_id,
                timeframe,
                unit,
                scale,
            } => serde_json::json!({
                "role_semantic_id": role_semantic_id,
                "instrument": instrument,
                "field_semantic_id": field_semantic_id,
                "timeframe": timeframe,
                "unit": unit,
                "scale": scale,
            }),
            SingleThresholdChannelV1::UniverseMember {
                close_role_semantic_id,
                open_role_semantic_id,
            } => serde_json::json!({
                "close_role_semantic_id": close_role_semantic_id,
                "open_role_semantic_id": open_role_semantic_id,
            }),
        };
        let mut untagged = serde_json::to_value(&source).expect("the request serialises");
        untagged["channel"] = untagged_channel;

        let refusal = serde_json::from_value::<SingleThresholdAuthoringRequestV1>(untagged)
            .expect_err("a channel without its scope is refused");
        assert!(refusal.to_string().contains("scope"), "{refusal}");

        let tagged = serde_json::to_value(&source).expect("the request serialises");
        assert_eq!(tagged["channel"]["scope"], scope);
        assert_eq!(
            serde_json::from_value::<SingleThresholdAuthoringRequestV1>(tagged)
                .expect("the tagged request parses"),
            source,
        );
    }

    /// A side that names no weight serialises exactly as before the field existed, and a request
    /// written without it parses with a weight of 0; a side that names one carries it.
    #[rstest]
    fn a_side_without_a_weight_keeps_its_request_bytes() {
        let source = request();
        let value = serde_json::to_value(&source).expect("the request serialises");

        for side in ["when_true", "otherwise"] {
            assert_eq!(
                value[side]
                    .as_object()
                    .expect("a side is an object")
                    .keys()
                    .map(String::as_str)
                    .collect::<Vec<_>>(),
                [
                    "position_intent_semantic_id",
                    "target_position_units",
                    "target_variant_semantic_id",
                ],
            );
        }
        assert_eq!(
            serde_json::from_value::<SingleThresholdAuthoringRequestV1>(value)
                .expect("a request without a weight parses"),
            source,
        );

        let mut weighted = request();
        weighted.when_true.target_variant_semantic_id = WEIGHT_TARGET.to_owned();
        weighted.when_true.target_weight_micros = 250_000;
        let value = serde_json::to_value(&weighted).expect("the request serialises");
        assert_eq!(value["when_true"]["target_weight_micros"], 250_000);
        assert_eq!(
            serde_json::from_value::<SingleThresholdAuthoringRequestV1>(value)
                .expect("a weighted request parses"),
            weighted,
        );
    }

    /// The universe-member pair compiles into a Plan against one-member Owner universe authority,
    /// the whole way a Plan is compiled, and the Plan binds each role's value and coordinate to the
    /// Owner binding of that role at the one member.
    ///
    /// The authority is Owner-shaped values, not Owner custody; the ordered chain is where custody
    /// is proven. The control is the same Design against a two-member universe, which does not
    /// compile, because the vertical then needs a whole target set this program does not emit.
    #[rstest]
    fn a_universe_member_pair_compiles_into_a_one_member_plan() {
        let (design, _) = author_single_threshold_program_v1(&universe_request())
            .expect("the universe-member request is authorable");
        let receipt = implementation_receipt(&design);
        let compile = |instruments: &[&str]| {
            compile_strategy_design_v2_with_verified_bindings(
                design.clone(),
                verified_universe_bindings_for_test(&design, instruments),
                std::slice::from_ref(&receipt),
            )
        };

        let StrategyCompilationV2::Compiled(plan) = compile(&["BTCUSDT-PERP.BINANCE"]) else {
            panic!(
                "the universe-member Design compiles against one member: {:?}",
                compile(&["BTCUSDT-PERP.BINANCE"])
            );
        };
        let rows = plan.bfp_role_bindings();
        assert_eq!(
            rows.len(),
            4,
            "a value and a coordinate row for each of two roles"
        );

        for row in rows {
            assert_eq!(row.member_ordinal(), Some(0));
            assert_eq!(
                Some(row.static_binding_receipt_digest()),
                plan.universe_binding_digest(
                    row.input_role_identity(),
                    "member-0",
                    "BTCUSDT-PERP.BINANCE"
                ),
                "{} binds the Owner binding of its role at the one member",
                row.input_role_id(),
            );
        }
        assert_eq!(
            rows.iter()
                .map(|row| row.input_role_identity())
                .collect::<std::collections::BTreeSet<_>>(),
            design
                .inputs
                .iter()
                .map(strategy_input_role_identity_v2)
                .collect(),
        );

        assert!(
            !matches!(
                compile(&["BTCUSDT-PERP.BINANCE", "ETHUSDT-PERP.BINANCE"]),
                StrategyCompilationV2::Compiled(_)
            ),
            "the same Design does not compile against two members",
        );
    }

    /// Declared meaning over a universe-member Design assembles against the universe authority an
    /// Owner issues for it, and each input folds in the binding the Plan binds that role to: the
    /// Owner binding of the role at the one member. Against two members it does not assemble, for
    /// the reason the Plan does not compile.
    #[rstest]
    fn a_universe_member_meaning_assembles_against_owner_universe_authority() {
        let (design, meaning) = author_single_threshold_program_v1(&universe_request())
            .expect("the universe-member request is authorable");
        let assemble = |instruments: &[&str]| {
            derive_bounded_feature_program_proposal_v1(
                &design,
                PrimitiveCatalogV1::verify().expect("a published catalog verifies"),
                &meaning,
                &verified_universe_bindings_for_test(&design, instruments),
            )
        };
        let proposal = assemble(&["BTCUSDT-PERP.BINANCE"]).unwrap_or_else(|e| {
            panic!("the meaning assembles against one-member universe authority: {e}")
        });
        let StrategyCompilationV2::Compiled(plan) =
            compile_strategy_design_v2_with_verified_bindings(
                design.clone(),
                verified_universe_bindings_for_test(&design, &["BTCUSDT-PERP.BINANCE"]),
                &[implementation_receipt(&design)],
            )
        else {
            panic!("the universe-member Design compiles against one member");
        };

        assert_eq!(
            proposal
                .inputs
                .iter()
                .map(|input| (
                    input.input_role_identity,
                    input.static_binding_receipt_digest
                ))
                .collect::<std::collections::BTreeSet<_>>(),
            design
                .inputs
                .iter()
                .map(|role| {
                    let role = strategy_input_role_identity_v2(role);
                    let bound = plan
                        .universe_binding_digest(role, "member-0", "BTCUSDT-PERP.BINANCE")
                        .expect("the Plan binds every role at the one member");
                    (role, bound)
                })
                .collect(),
            "every input folds in the Plan's binding of its role at the one member",
        );
        assert_eq!(
            assemble(&["BTCUSDT-PERP.BINANCE", "ETHUSDT-PERP.BINANCE"]).map(|_| ()),
            Err(
                BoundedFeatureProgramDerivationErrorV1::UniverseNotOneMember(
                    UNIVERSE_CLOSE_ROLE.to_owned()
                )
            ),
            "a two-member universe is refused by name, never bound to its first member",
        );
    }

    /// A plugin implementation receipt for the Design's one plugin. The Plan compiles against its
    /// digests; no module is built.
    fn implementation_receipt(
        design: &StrategyDesignV2,
    ) -> crate::strategy_plan_v2::PluginImplementationReceiptV2 {
        let manifest = &design.plugins[0];
        issue_plugin_implementation_receipt_v2_for_test(
            manifest,
            digest(71),
            digest(72),
            digest(73),
            digest(74),
            "strategy.plugin.compute.v2",
            manifest.abi_version,
            design
                .capabilities
                .iter()
                .map(|capability| (capability.semantic_id.clone(), capability.version))
                .collect(),
        )
    }

    fn plan_digest_hex(result: StrategyCompilationV2) -> String {
        let StrategyCompilationV2::Compiled(plan) = result else {
            panic!("the Design compiles: {result:?}");
        };
        plan.canonical_plan_digest()
            .as_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    /// The Plan each input scope compiles to, pinned by digest, and the refusal of a Design that
    /// mixes them. How a Design's input scope is classified is shared by the Plan compiler and by
    /// the R&D reads that must choose an Owner custody path for the Design; these pin that moving
    /// the classification between them changes no Plan byte and no refusal.
    #[rstest]
    fn each_input_scope_compiles_to_its_pinned_plan() {
        let (exact, _) = author_single_threshold_program_v1(&request())
            .expect("the exact request is authorable");
        let (universe, _) = author_single_threshold_program_v1(&universe_request())
            .expect("the universe request is authorable");

        let exact_digest = plan_digest_hex(compile_strategy_design_v2_with_verified_bindings(
            exact.clone(),
            bindings(&exact),
            &[implementation_receipt(&exact)],
        ));
        let universe_digest = plan_digest_hex(compile_strategy_design_v2_with_verified_bindings(
            universe.clone(),
            verified_universe_bindings_for_test(&universe, &["BTCUSDT-PERP.BINANCE"]),
            &[implementation_receipt(&universe)],
        ));

        assert_eq!(
            (exact_digest.as_str(), universe_digest.as_str()),
            // Both moved once, with the Design, when the plugin's fuel bound rose to 1,000,000. The
            // universe Plan moved again when its roles came to read at Market Data's value scale;
            // the exact one, whose author declares its own scale, did not.
            (
                "d9ef1d86900b14be0170b96c289da65dc8dec706a23027faf17b1b418954f7f8",
                "7cda3249525a07d186fc8caa3556244acd99f0bd6b9083dde5140b35d697a154",
            ),
        );
    }

    /// A Design whose roles mix the two scopes is refused under its own reason, before any binding
    /// is consulted.
    #[rstest]
    fn a_design_mixing_input_scopes_is_refused() {
        let (mut mixed, _) = author_single_threshold_program_v1(&universe_request())
            .expect("the universe request is authorable");
        // One role becomes exact-instrument, read the way an exact role is read - as itself, with
        // its coordinate on the port its new identity derives - so the Design is a well-formed
        // graph that mixes scopes, not one the graph validation refuses first.
        let old_port = coordinate_port_id(strategy_input_role_identity_v2(&mixed.inputs[0]));
        mixed.inputs[0].scope = InputScopeV2::ExactInstrument;
        mixed.inputs[0].instrument = "BTCUSDT-PERP.BINANCE".to_owned();
        let exact_role = mixed.inputs[0].semantic_id.clone();
        let new_port = coordinate_port_id(strategy_input_role_identity_v2(&mixed.inputs[0]));
        for port in &mut mixed.plugins[0].input_ports {
            if port.semantic_id == old_port {
                port.semantic_id.clone_from(&new_port);
            }
        }
        mixed.plugins[0]
            .input_ports
            .sort_by(|a, b| a.semantic_id.as_bytes().cmp(b.semantic_id.as_bytes()));

        for node in mixed
            .reactions
            .iter_mut()
            .flat_map(|reaction| &mut reaction.nodes)
        {
            for binding in &mut node.input_bindings {
                match &binding.source {
                    ValueRefV2::UniverseMemberInput { input_id, .. } if *input_id == exact_role => {
                        binding.source = ValueRefV2::Input {
                            input_id: exact_role.clone(),
                        };
                    }
                    ValueRefV2::UniverseMemberSampleCoordinate {
                        input_id,
                        source_semantic_id,
                        ..
                    } if *input_id == exact_role => {
                        binding.port_id.clone_from(&new_port);
                        binding.source = ValueRefV2::OwnerSampleCoordinate {
                            input_id: exact_role.clone(),
                            source_semantic_id: source_semantic_id.clone(),
                        };
                    }
                    _ => {}
                }
            }
            node.input_bindings
                .sort_by(|a, b| a.port_id.as_bytes().cmp(b.port_id.as_bytes()));
        }

        assert_eq!(
            compile_strategy_design_v2_with_verified_bindings(
                mixed.clone(),
                bindings(&mixed),
                &[implementation_receipt(&mixed)],
            ),
            StrategyCompilationV2::Unsupported(CompilationIssueV2 {
                coordinate: "inputs.scope".to_owned(),
                reason: "exact-instrument and universe-member roles cannot be mixed".to_owned(),
                refusal: None,
            }),
        );
    }
}
