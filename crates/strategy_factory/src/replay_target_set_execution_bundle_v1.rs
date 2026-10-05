//! Request-bound, move-only inputs for one complete target-set Sim EVENT execution.
//!
//! This boundary validates the complete Owner frame, native member set, scheduling order, Plan,
//! Artifact, account, and economic terms before any `ProgramHostV2` or Backtest engine is retained.
//! After admission, the caller can move only this opaque bundle into the consumer; there is no API
//! for appending or replacing instruments or scheduling data.

use std::collections::BTreeMap;

use sha2::{Digest, Sha256};
use vibe_data::owner::instrument_master_v2::ValidatedCryptoPerpetualPublicTermsV2;
use vibe_data::owner::native_replay_scheduling_v1::NativeReplaySchedulingReadbackV1;
use vibe_data::owner::native_replay_scheduling_v2::NativeReplayFrameSequenceReadbackV2;
use vibe_data::owner::replay_funding_schedule_v1::ReplayFundingScheduleV1;
use vibe_data::owner::strategy_input_binding::StrategyInputEventKind;
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use vibe_model::types::Money;
use vibe_model::{
    data::{Bar, BarType, Data, HasTsInit, QuoteTick},
    identifiers::{AccountId, InstrumentId, StrategyId},
    instruments::{Instrument, InstrumentAny},
    types::{Price, Quantity},
};

use crate::{
    artifact_v2::StrategyArtifactV2,
    exploratory_replay::ExploratoryReplayRequestLocatorV2,
    native_replay_custody_frames_v1::ResolvedNativeReplayCustodyFramesV1,
    native_replay_execution_input_binding_v2::NativeReplayExecutionInputBindingReadbackV2,
    program_host_v2::{
        OwnerUniverseFrameV1, UniverseSelectionPinV2, admit_owner_universe_program_event_v2,
    },
    replay_economic_configuration_v1::{ReplayEconomicConfigurationV1, ReplayFixedDecimalV1},
    replay_execution_profile_binding_v1::{
        BoundInstrumentEconomicTermsV1, InstrumentMarginModelSelectionV1,
        OwnerIssuedReplayExecutionProfileBindingV1,
    },
    replay_execution_profile_native_v1::{
        ReplayNativeExecutionProfileV1, materialize_crypto_perpetual_target_set_v2,
        materialize_event_replay_execution_profile_v1,
    },
    replay_runner_operational_profile_v1::ReplayRunnerOperationalProfileV1,
    strategy_plan_v2::StrategyPlanV2,
    target_set_members::{BoundedMembers, is_admitted_member_count, update_member_count_domain},
};

const SCHEDULING_DIGEST_DOMAIN_V1: &[u8] = b"strategy-factory.replay-target-set-scheduling.v1\0";
const FRAME_SEQUENCE_DIGEST_DOMAIN_V1: &[u8] =
    b"vibe.replay.target-set-execution-frame-sequence.v1\0";
const CENSUS_DIGEST_DOMAIN_V1: &[u8] = b"strategy-factory.replay-target-set-execution-census.v1\0";

/// One member's price grid in the Replay, and where it came from.
///
/// The Instrument Master states a perpetual's tick as the venue publishes it today, and a venue
/// coarsens a tick as the price rises: BTCUSDT's is 0.10 today, while its 2021-06-01 daily bar opened
/// at 37244.36. A Replay over that window prices at the data's own grid instead, so the bundle widens
/// the member's price precision to the finest scale its window's data shows whenever that is finer
/// than the tick, and records both and the datum that set it. The order grid then comes from the data,
/// not from the venue's tick at the time, which the Instrument Master does not hold.
#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]
pub struct ReplayPriceGridV1 {
    pub(crate) instrument_price_precision: u8,
    pub(crate) data_price_precision: u8,
    pub(crate) finest_price_at_ns: u64,
    pub(crate) replay_price_precision: u8,
}

impl ReplayPriceGridV1 {
    /// The price precision of the Instrument Master's tick.
    #[must_use]
    pub const fn instrument_price_precision(&self) -> u8 {
        self.instrument_price_precision
    }

    /// The finest price scale any of the member's BAR or Quote values in the window shows.
    #[must_use]
    pub const fn data_price_precision(&self) -> u8 {
        self.data_price_precision
    }

    /// The event instant of the member's first datum showing that finest scale.
    #[must_use]
    pub const fn finest_price_at_ns(&self) -> u64 {
        self.finest_price_at_ns
    }

    /// The price precision the Replay runs the member at: the finer of the two.
    #[must_use]
    pub const fn replay_price_precision(&self) -> u8 {
        self.replay_price_precision
    }

    /// Whether the Replay's grid came from the data rather than from the Instrument Master's tick.
    #[must_use]
    pub const fn widened_from_data(&self) -> bool {
        self.replay_price_precision > self.instrument_price_precision
    }
}

/// Exact Instrument Owner evidence and economic terms consumed for one target-set member.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
pub struct ReplayTargetSetInstrumentCensusV1 {
    pub(crate) instrument_identity: String,
    pub(crate) instrument_fact_digest: [u8; 32],
    pub(crate) instrument_receipt_digest: [u8; 32],
    pub(crate) terms_digest: [u8; 32],
    pub(crate) venue_identity: String,
    pub(crate) quote_currency: String,
    pub(crate) account_scope_identity: String,
    #[serde(serialize_with = "serialize_i128_as_decimal_string")]
    pub(crate) event_time_ns: i128,
    #[serde(serialize_with = "serialize_i128_as_decimal_string")]
    pub(crate) valid_from_ns: i128,
    #[serde(serialize_with = "serialize_i128_as_decimal_string")]
    pub(crate) valid_until_ns_exclusive: i128,
    pub(crate) margin_model: String,
    pub(crate) maker_fee: ReplayFixedDecimalV1,
    pub(crate) taker_fee: ReplayFixedDecimalV1,
    pub(crate) initial_margin: ReplayFixedDecimalV1,
    pub(crate) maintenance_margin: ReplayFixedDecimalV1,
}

fn serialize_i128_as_decimal_string<S>(value: &i128, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_str(&value.to_string())
}

impl ReplayTargetSetInstrumentCensusV1 {
    #[must_use]
    pub fn instrument_identity(&self) -> &str {
        &self.instrument_identity
    }

    #[must_use]
    pub const fn instrument_fact_digest(&self) -> [u8; 32] {
        self.instrument_fact_digest
    }

    #[must_use]
    pub const fn instrument_receipt_digest(&self) -> [u8; 32] {
        self.instrument_receipt_digest
    }

    #[must_use]
    pub const fn terms_digest(&self) -> [u8; 32] {
        self.terms_digest
    }

    #[must_use]
    pub fn account_scope_identity(&self) -> &str {
        &self.account_scope_identity
    }

    #[must_use]
    pub fn venue_identity(&self) -> &str {
        &self.venue_identity
    }

    #[must_use]
    pub fn quote_currency(&self) -> &str {
        &self.quote_currency
    }

    #[must_use]
    pub const fn event_time_ns(&self) -> i128 {
        self.event_time_ns
    }

    #[must_use]
    pub const fn valid_from_ns(&self) -> i128 {
        self.valid_from_ns
    }

    #[must_use]
    pub const fn valid_until_ns_exclusive(&self) -> i128 {
        self.valid_until_ns_exclusive
    }

    #[must_use]
    pub fn margin_model(&self) -> &str {
        &self.margin_model
    }

    #[must_use]
    pub const fn maker_fee(&self) -> ReplayFixedDecimalV1 {
        self.maker_fee
    }

    #[must_use]
    pub const fn taker_fee(&self) -> ReplayFixedDecimalV1 {
        self.taker_fee
    }

    #[must_use]
    pub const fn initial_margin(&self) -> ReplayFixedDecimalV1 {
        self.initial_margin
    }

    #[must_use]
    pub const fn maintenance_margin(&self) -> ReplayFixedDecimalV1 {
        self.maintenance_margin
    }
}

impl From<&BoundInstrumentEconomicTermsV1> for ReplayTargetSetInstrumentCensusV1 {
    fn from(terms: &BoundInstrumentEconomicTermsV1) -> Self {
        Self {
            instrument_identity: terms.instrument_identity.clone(),
            instrument_fact_digest: terms.instrument_fact_digest,
            instrument_receipt_digest: terms.instrument_receipt_digest,
            terms_digest: terms.terms_digest,
            venue_identity: terms.venue_identity.clone(),
            quote_currency: terms.quote_currency.clone(),
            account_scope_identity: terms.account_scope_identity.clone(),
            event_time_ns: terms.event_time_ns,
            valid_from_ns: terms.valid_from_ns,
            valid_until_ns_exclusive: terms.valid_until_ns_exclusive,
            margin_model: match terms.margin_model {
                InstrumentMarginModelSelectionV1::StandardMarginModel => {
                    "STANDARD_MARGIN_MODEL".to_owned()
                }
            },
            maker_fee: terms.maker_fee,
            taker_fee: terms.taker_fee,
            initial_margin: terms.initial_margin,
            maintenance_margin: terms.maintenance_margin,
        }
    }
}

/// Exact immutable admission evidence retained for later Backtest result custody.
/// The PIT window custody chain a multi-frame run's frames were read from, pinned at one head,
/// and the derived view each frame's inputs came from, in frame order.
///
/// Only the crate constructs it, from the frames Market Data resolved at that head, so a caller
/// cannot state a head or a view the run did not read.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
pub struct ReplayCustodyRunCensusV1 {
    pub(crate) chain_root: [u8; 32],
    pub(crate) head_identity: [u8; 32],
    pub(crate) head_digest: [u8; 32],
    pub(crate) head_version: u64,
    pub(crate) view_identities: Vec<[u8; 32]>,
}

impl ReplayCustodyRunCensusV1 {
    #[must_use]
    pub const fn chain_root(&self) -> [u8; 32] {
        self.chain_root
    }

    #[must_use]
    pub const fn head_identity(&self) -> [u8; 32] {
        self.head_identity
    }

    /// One derived view identity per frame, in frame order.
    #[must_use]
    pub fn view_identities(&self) -> &[[u8; 32]] {
        &self.view_identities
    }
}

/// What a bundle states about its window's funding.
///
/// Market Data's settled funding schedule reaches the bundle by value or not at all. A bundle
/// without one says so rather than reading as a run that paid no funding.
#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(tag = "statement", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayFundingStatementV1 {
    /// No funding schedule reached the bundle.
    FundingNotStated,
    /// The bundle carries Market Data's schedule for the run's window and members.
    Stated {
        /// The schedule's content digest.
        schedule_digest: [u8; 32],
    },
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
pub struct ReplayTargetSetExecutionCensusV1 {
    pub(crate) request_locator: ExploratoryReplayRequestLocatorV2,
    pub(crate) owner_authority_digest: [u8; 32],
    pub(crate) trial_family_identity: String,
    pub(crate) trial_family_digest: [u8; 32],
    pub(crate) economic_configuration_digest: [u8; 32],
    pub(crate) runner_operational_profile_digest: [u8; 32],
    pub(crate) execution_profile_binding_digest: [u8; 32],
    pub(crate) native_materialization_digest: [u8; 32],
    pub(crate) canonical_plan_digest: [u8; 32],
    pub(crate) artifact_identity: [u8; 32],
    pub(crate) frame_sequence_digest: [u8; 32],
    pub(crate) frame_count: u64,
    pub(crate) universe_selection_identity: [u8; 32],
    pub(crate) universe_selection_digest: [u8; 32],
    pub(crate) member_instruments: BoundedMembers<String>,
    pub(crate) instrument_terms: BoundedMembers<ReplayTargetSetInstrumentCensusV1>,
    pub(crate) price_grids: BoundedMembers<ReplayPriceGridV1>,
    pub(crate) scheduling_data_digest: [u8; 32],
    pub(crate) scheduling_data_count: u64,
    pub(crate) bar_count: u64,
    pub(crate) event_count: u64,
    pub(crate) funding: ReplayFundingStatementV1,
    /// The custody chain and head a multi-frame run read, absent for a snapshot run.
    pub(crate) custody: Option<ReplayCustodyRunCensusV1>,
    pub(crate) census_digest: [u8; 32],
}

impl ReplayTargetSetExecutionCensusV1 {
    #[must_use]
    pub const fn request_locator(&self) -> &ExploratoryReplayRequestLocatorV2 {
        &self.request_locator
    }

    #[must_use]
    pub const fn execution_profile_binding_digest(&self) -> [u8; 32] {
        self.execution_profile_binding_digest
    }

    #[must_use]
    pub const fn owner_authority_digest(&self) -> [u8; 32] {
        self.owner_authority_digest
    }

    #[must_use]
    pub fn trial_family_identity(&self) -> &str {
        &self.trial_family_identity
    }

    #[must_use]
    pub const fn trial_family_digest(&self) -> [u8; 32] {
        self.trial_family_digest
    }

    #[must_use]
    pub const fn economic_configuration_digest(&self) -> [u8; 32] {
        self.economic_configuration_digest
    }

    #[must_use]
    pub const fn runner_operational_profile_digest(&self) -> [u8; 32] {
        self.runner_operational_profile_digest
    }

    #[must_use]
    pub const fn native_materialization_digest(&self) -> [u8; 32] {
        self.native_materialization_digest
    }

    #[must_use]
    pub const fn canonical_plan_digest(&self) -> [u8; 32] {
        self.canonical_plan_digest
    }

    #[must_use]
    pub const fn artifact_identity(&self) -> [u8; 32] {
        self.artifact_identity
    }

    /// Seals the whole ordered frame sequence: each frame's universe digest, its observation batch
    /// and the Owner scheduling receipt it was scheduled from, in issue order.
    #[must_use]
    pub const fn frame_sequence_digest(&self) -> [u8; 32] {
        self.frame_sequence_digest
    }

    /// Returns how many Owner frames the run consumed.
    #[must_use]
    pub const fn frame_count(&self) -> u64 {
        self.frame_count
    }

    #[must_use]
    pub const fn universe_selection_identity(&self) -> [u8; 32] {
        self.universe_selection_identity
    }

    #[must_use]
    pub const fn universe_selection_digest(&self) -> [u8; 32] {
        self.universe_selection_digest
    }

    #[must_use]
    pub fn member_instruments(&self) -> &[String] {
        &self.member_instruments
    }

    #[must_use]
    pub fn instrument_fact_digests(&self) -> Vec<[u8; 32]> {
        self.instrument_terms
            .iter()
            .map(ReplayTargetSetInstrumentCensusV1::instrument_fact_digest)
            .collect()
    }

    #[must_use]
    pub fn instrument_receipt_digests(&self) -> Vec<[u8; 32]> {
        self.instrument_terms
            .iter()
            .map(ReplayTargetSetInstrumentCensusV1::instrument_receipt_digest)
            .collect()
    }

    #[must_use]
    pub fn instrument_terms(&self) -> &[ReplayTargetSetInstrumentCensusV1] {
        &self.instrument_terms
    }

    /// Each member's price grid in the Replay, in member order.
    #[must_use]
    pub fn price_grids(&self) -> &[ReplayPriceGridV1] {
        &self.price_grids
    }

    #[must_use]
    pub const fn scheduling_data_digest(&self) -> [u8; 32] {
        self.scheduling_data_digest
    }

    #[must_use]
    pub const fn scheduling_data_count(&self) -> u64 {
        self.scheduling_data_count
    }

    #[must_use]
    pub const fn bar_count(&self) -> u64 {
        self.bar_count
    }

    #[must_use]
    pub const fn event_count(&self) -> u64 {
        self.event_count
    }

    /// Whether the bundle carries its window's funding schedule.
    #[must_use]
    pub const fn funding(&self) -> ReplayFundingStatementV1 {
        self.funding
    }

    /// The custody chain and head a multi-frame run read, absent for a snapshot run.
    #[must_use]
    pub const fn custody(&self) -> Option<&ReplayCustodyRunCensusV1> {
        self.custody.as_ref()
    }

    #[must_use]
    pub const fn census_digest(&self) -> [u8; 32] {
        self.census_digest
    }
}

/// Opaque move-only capability for one exact request and one complete target-set execution.
///
/// ```compile_fail
/// use vibe_strategy_factory::replay_target_set_execution_bundle_v1::ReplayTargetSetExecutionBundleV1;
/// fn duplicate(value: ReplayTargetSetExecutionBundleV1) {
///     let _copy = value.clone();
/// }
/// ```
pub struct ReplayTargetSetExecutionBundleV1 {
    pub(crate) plan: StrategyPlanV2,
    pub(crate) artifact: StrategyArtifactV2,
    pub(crate) universe_frames: Vec<OwnerUniverseFrameV1>,
    pub(crate) native_profile: ReplayNativeExecutionProfileV1,
    pub(crate) account_scope_id: AccountId,
    pub(crate) strategy_id: StrategyId,
    pub(crate) run_id: String,
    pub(crate) instruments: BoundedMembers<InstrumentAny>,
    pub(crate) bar_types: BoundedMembers<BarType>,
    pub(crate) data: Vec<Data>,
    /// Each frame's fill-quote instants, keyed by the frame's time, one per member in member order:
    /// the instant that member's Quote arrives at, which the Host submits its decided order on.
    pub(crate) fill_quote_instants: BTreeMap<u64, Vec<u64>>,
    /// Market Data's settled funding for the run's window and members, by value.
    pub(crate) funding_schedule: Option<ReplayFundingScheduleV1>,
    pub(crate) census: ReplayTargetSetExecutionCensusV1,
}

impl ReplayTargetSetExecutionBundleV1 {
    /// Returns the exact four-field R&D request locator embedded in this move-only capability.
    #[must_use]
    pub const fn request_locator(&self) -> &ExploratoryReplayRequestLocatorV2 {
        self.census.request_locator()
    }

    #[must_use]
    pub const fn execution_profile_binding_digest(&self) -> [u8; 32] {
        self.census.execution_profile_binding_digest()
    }

    #[must_use]
    pub const fn native_materialization_digest(&self) -> [u8; 32] {
        self.census.native_materialization_digest()
    }

    /// Returns the census this bundle was built from: its Plan, universe selection, members,
    /// instrument terms and scheduling data counts, which an acceptance states against the Owner
    /// facts it expected rather than against the census digest alone.
    #[must_use]
    pub const fn census(&self) -> &ReplayTargetSetExecutionCensusV1 {
        &self.census
    }

    /// The native instruments this bundle runs, materialized from the Owners' terms.
    ///
    /// Read by the sealed first COMPOSER_V3 acceptance, which states the run's arithmetic
    /// independently of the engine from the exact values the engine was given.
    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    #[must_use]
    pub fn instruments_for_acceptance(&self) -> &[InstrumentAny] {
        &self.instruments
    }

    /// The native BAR and Quote data this bundle runs, at its instruments' precision.
    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    #[must_use]
    pub fn native_data_for_acceptance(&self) -> &[Data] {
        &self.data
    }

    /// The venue's starting balance this bundle runs with.
    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    #[must_use]
    pub fn starting_balance_for_acceptance(&self) -> Option<Money> {
        self.native_profile.starting_balance()
    }

    /// Market Data's settled funding for the run's window and members, when it reached the bundle.
    #[must_use]
    pub const fn funding_schedule(&self) -> Option<&ReplayFundingScheduleV1> {
        self.funding_schedule.as_ref()
    }

    /// Returns how many Owner-sealed universe frames this bundle was built from.
    ///
    /// It is one for a bundle built through [`Self::new_from_single_frame_v1`] and at least two for
    /// one built through [`Self::new`], so a caller that wants to state which of the two produced a
    /// given bundle can read it rather than infer it from an opaque census digest. The census
    /// already carries the number; only the passthrough was missing.
    #[must_use]
    pub const fn frame_count(&self) -> u64 {
        self.census.frame_count()
    }

    /// Binds this executable bundle to one Owner-sealed Native Replay frame sequence.
    ///
    /// Without this there is no binding point between the frame and the fills it produces: the
    /// bundle's frame time is only checked against the request window's start bound, which is a
    /// caller-chosen coordinate that any frame could be made to match. Requiring the sealed V2
    /// binding is what makes the frame that produced the fills the frame Market Data sealed.
    ///
    /// # Errors
    ///
    /// Returns when the bundle's frame is not the sequence's first frame, or when its scheduling
    /// data does not lie inside that frame and before the successor frame's first BAR.
    pub fn verify_against_native_replay_sequence_v2(
        &self,
        v2: &NativeReplayExecutionInputBindingReadbackV2,
    ) -> anyhow::Result<()> {
        verify_scheduling_data_against_sealed_frames(&self.data, &v2.binding().frame_orders())
    }

    /// Consumes one Owner-issued dual-profile authority and admits an exact complete execution.
    ///
    /// # Errors
    ///
    /// Returns before a capability exists when any profile seal, Plan/Artifact/frame binding,
    /// member, account, economic term, BAR signal, or later EVENT input is missing or mismatched.
    #[allow(clippy::too_many_arguments)]
    /// Consumes one Owner-sealed frame sequence and the universe receipts it was resolved with.
    ///
    /// The sequence arrives whole rather than as loose per-frame readbacks, because its
    /// construction is what proves the cross-frame rules hold: a caller that assembled the frames
    /// itself could satisfy every per-frame check here while presenting a window the Owner never
    /// sealed. The two collections are checked against each other rather than trusted to line up,
    /// because the resolver returning them in step does not stop a caller reordering one of them.
    ///
    /// # Errors
    ///
    /// Returns an error if the sequence and the receipts disagree in length or order, if any frame
    /// mismatches its paired receipt, or if the series does not cover the Owner request window
    /// from its start.
    pub fn new(
        authority: OwnerIssuedReplayExecutionProfileBindingV1,
        plan: StrategyPlanV2,
        artifact: StrategyArtifactV2,
        universe_frames: Vec<OwnerUniverseFrameV1>,
        strategy_id: StrategyId,
        run_id: String,
        public_terms: Vec<ValidatedCryptoPerpetualPublicTermsV2>,
        sequence: NativeReplayFrameSequenceReadbackV2,
        funding_schedule: Option<ReplayFundingScheduleV1>,
    ) -> anyhow::Result<Self> {
        let instruments = materialize_crypto_perpetual_target_set_v2(
            authority.execution_profile_binding(),
            public_terms,
        )?;
        let request_window = authority.request_window();
        let instrument_ids = instruments.map(Instrument::id);
        let (sequence_start_ns, sequence_end_ns_exclusive) = sequence.window();
        anyhow::ensure!(
            sequence_start_ns == request_window.start_event_ns
                && sequence_end_ns_exclusive == request_window.end_event_ns_exclusive,
            "request execution bundle sequence window mismatches the Owner request window"
        );
        let frames = sequence.into_frames();
        anyhow::ensure!(
            !frames.is_empty() && frames.len() == universe_frames.len(),
            "request execution bundle frame sequence and universe receipts do not correspond"
        );
        let mut bar_types: Option<BoundedMembers<BarType>> = None;
        let mut receipt_digests = Vec::with_capacity(frames.len());
        let mut frame_times = Vec::with_capacity(frames.len());
        let mut data = Vec::new();

        for (frame, universe_frame) in frames.into_iter().zip(&universe_frames) {
            anyhow::ensure!(
                frame.member_instruments() == &*instrument_ids
                    && frame.window_end_ns_exclusive() == request_window.end_event_ns_exclusive
                    && *frame.observation_batch_digest().as_bytes()
                        == *universe_frame
                            .frame()
                            .selection()
                            .observation_batch_digest()
                            .as_bytes(),
                "request execution bundle frame mismatches its paired Owner universe receipt"
            );
            receipt_digests.push(*frame.scheduling_receipt_digest_v1().as_bytes());
            frame_times.push(frame.frame_time_ns());
            let (frame_bar_types, frame_data) = frame.into_native_schedule();
            let frame_bar_types = BoundedMembers::try_from(frame_bar_types)?;

            if let Some(expected) = &bar_types {
                anyhow::ensure!(
                    *expected == frame_bar_types,
                    "request execution bundle frames disagree on the target set BAR types"
                );
            } else {
                bar_types = Some(frame_bar_types);
            }
            data.extend(frame_data);
        }
        let bar_types = bar_types
            .ok_or_else(|| anyhow::anyhow!("request execution bundle sequence carried no frame"))?;
        Self::new_with_native_instruments(
            authority,
            plan,
            artifact,
            universe_frames,
            strategy_id,
            run_id,
            instruments,
            bar_types,
            data,
            &frame_times,
            &receipt_digests,
            funding_schedule,
            None,
        )
    }

    /// Composes a bundle from one Owner V1 scheduling readback, as a series of one frame.
    ///
    /// The V1 readback and the V2 frame sequence are two consumptions of the same Owner market
    /// readback and cannot both be taken, so a caller holding the V1 form reaches the series this
    /// way rather than by reconstructing a sequence it never resolved. Every cross-frame rule
    /// still runs; with one frame they are satisfied by having nothing to disagree with.
    ///
    /// # Errors
    ///
    /// Returns an error if the readback mismatches the Owner inputs or the request window.
    #[allow(clippy::too_many_arguments)]
    pub fn new_from_single_frame_v1(
        authority: OwnerIssuedReplayExecutionProfileBindingV1,
        plan: StrategyPlanV2,
        artifact: StrategyArtifactV2,
        universe_frame: OwnerUniverseFrameV1,
        strategy_id: StrategyId,
        run_id: String,
        public_terms: Vec<ValidatedCryptoPerpetualPublicTermsV2>,
        scheduling: NativeReplaySchedulingReadbackV1,
        funding_schedule: Option<ReplayFundingScheduleV1>,
    ) -> anyhow::Result<Self> {
        let instruments = materialize_crypto_perpetual_target_set_v2(
            authority.execution_profile_binding(),
            public_terms,
        )?;
        let request_window = authority.request_window();
        let instrument_ids = instruments.map(Instrument::id);
        anyhow::ensure!(
            scheduling.member_instruments().as_slice() == &*instrument_ids
                && scheduling.frame_time_ns() == request_window.start_event_ns
                && scheduling.window_end_ns_exclusive() == request_window.end_event_ns_exclusive
                && *scheduling.observation_batch_digest().as_bytes()
                    == *universe_frame
                        .frame()
                        .selection()
                        .observation_batch_digest()
                        .as_bytes(),
            "request execution bundle scheduling authority mismatches Owner inputs"
        );
        let frame_times = vec![scheduling.frame_time_ns()];
        let receipt_digests = vec![*scheduling.receipt_digest().as_bytes()];
        let (bar_types, data) = scheduling.into_native_schedule();
        let bar_types = BoundedMembers::try_from(bar_types)?;
        Self::new_with_native_instruments(
            authority,
            plan,
            artifact,
            vec![universe_frame],
            strategy_id,
            run_id,
            instruments,
            bar_types,
            data,
            &frame_times,
            &receipt_digests,
            funding_schedule,
            None,
        )
    }

    /// Composes a bundle from every frame of one PIT window custody run, carried by value: each
    /// frame's Owner universe frame and the native schedule Market Data sealed from that frame's
    /// derived view and quote cut, in frame order, with the chain and head the run read.
    ///
    /// The frames are the run's, not a caller's list: only
    /// [`crate::native_replay_custody_frames_v1::resolve_native_replay_custody_frames_v1`] makes
    /// them, at one pinned head, one view per frame. Every per-frame and
    /// cross-frame rule of [`Self::new`] runs; frames must name the bundle's members, the request
    /// window's end, and the batch their universe frame was admitted from, and advance in time.
    ///
    /// # Errors
    ///
    /// Returns an error if the frames and the custody views disagree in count, if any frame
    /// mismatches the Owner inputs or the request window, or if the frames disagree on BAR types.
    #[allow(clippy::too_many_arguments)]
    pub fn new_from_custody_frames_v1(
        authority: OwnerIssuedReplayExecutionProfileBindingV1,
        plan: StrategyPlanV2,
        artifact: StrategyArtifactV2,
        frames: ResolvedNativeReplayCustodyFramesV1,
        strategy_id: StrategyId,
        run_id: String,
        public_terms: Vec<ValidatedCryptoPerpetualPublicTermsV2>,
        funding_schedule: Option<ReplayFundingScheduleV1>,
    ) -> anyhow::Result<Self> {
        let (frames, custody) = frames.into_parts();
        anyhow::ensure!(
            !frames.is_empty() && frames.len() == custody.view_identities.len(),
            "request execution bundle custody frames and views do not correspond"
        );
        let instruments = materialize_crypto_perpetual_target_set_v2(
            authority.execution_profile_binding(),
            public_terms,
        )?;
        let request_window = authority.request_window();
        let instrument_ids = instruments.map(Instrument::id);
        let mut universe_frames = Vec::with_capacity(frames.len());
        let mut frame_times = Vec::with_capacity(frames.len());
        let mut receipt_digests = Vec::with_capacity(frames.len());
        let mut bar_types: Option<BoundedMembers<BarType>> = None;
        let mut data = Vec::new();

        for (universe_frame, scheduling) in frames {
            anyhow::ensure!(
                scheduling.member_instruments().as_slice() == &*instrument_ids
                    && scheduling.window_end_ns_exclusive()
                        == request_window.end_event_ns_exclusive
                    && *scheduling.observation_batch_digest().as_bytes()
                        == *universe_frame
                            .frame()
                            .selection()
                            .observation_batch_digest()
                            .as_bytes(),
                "request execution bundle custody frame mismatches Owner inputs"
            );
            frame_times.push(scheduling.frame_time_ns());
            receipt_digests.push(*scheduling.receipt_digest().as_bytes());
            let (frame_bar_types, mut frame_data) = scheduling.into_native_schedule();
            // The custody BAR closes at e_k, but its values cannot drive a decision before
            // the Owner's availability cut d_k. Keep the source event stamp and deliver the
            // native BAR to the engine at that sealed cut.
            let decision_time = universe_frame.frame().trigger().lifecycle().logical_time();

            for value in frame_data.iter_mut().take(instrument_ids.len()) {
                let Data::Bar(bar) = value else {
                    anyhow::bail!("request execution bundle custody schedule has no BAR signal");
                };
                *bar = Bar::new_checked(
                    bar.bar_type,
                    bar.open,
                    bar.high,
                    bar.low,
                    bar.close,
                    bar.volume,
                    bar.ts_event,
                    decision_time.into(),
                )?;
            }
            let frame_bar_types = BoundedMembers::try_from(frame_bar_types)?;

            if let Some(expected) = &bar_types {
                anyhow::ensure!(
                    *expected == frame_bar_types,
                    "request execution bundle frames disagree on the target set BAR types"
                );
            } else {
                bar_types = Some(frame_bar_types);
            }
            data.extend(frame_data);
            universe_frames.push(universe_frame);
        }
        anyhow::ensure!(
            frame_times.windows(2).all(|pair| pair[0] < pair[1]),
            "request execution bundle custody frames do not advance"
        );
        let bar_types = bar_types
            .ok_or_else(|| anyhow::anyhow!("request execution bundle run carried no frame"))?;
        Self::new_with_native_instruments(
            authority,
            plan,
            artifact,
            universe_frames,
            strategy_id,
            run_id,
            instruments,
            bar_types,
            data,
            &frame_times,
            &receipt_digests,
            funding_schedule,
            Some(custody),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn new_with_native_instruments(
        authority: OwnerIssuedReplayExecutionProfileBindingV1,
        plan: StrategyPlanV2,
        artifact: StrategyArtifactV2,
        universe_frames: Vec<OwnerUniverseFrameV1>,
        strategy_id: StrategyId,
        run_id: String,
        instruments: BoundedMembers<InstrumentAny>,
        bar_types: BoundedMembers<BarType>,
        data: Vec<Data>,
        frame_times: &[u64],
        owner_scheduling_receipt_digests: &[[u8; 32]],
        funding_schedule: Option<ReplayFundingScheduleV1>,
        custody: Option<ReplayCustodyRunCensusV1>,
    ) -> anyhow::Result<Self> {
        let request_locator = authority.request_locator().clone();
        let owner_authority_digest = authority.authority_digest();
        let trial_family_identity = authority.trial_family_identity().to_owned();
        let trial_family_digest = authority.trial_family_digest();
        let economic_configuration_digest = authority.economic_configuration_digest();
        let runner_operational_profile_digest = authority.runner_operational_profile_digest();
        anyhow::ensure!(
            !run_id.is_empty(),
            "request execution bundle has no run identity"
        );
        artifact.validate_for_plan(&plan)?;
        anyhow::ensure!(
            !universe_frames.is_empty()
                && universe_frames.len() == frame_times.len()
                && universe_frames.len() == owner_scheduling_receipt_digests.len(),
            "request execution bundle frame census does not correspond to its receipts"
        );
        let instrument_ids = instruments.map(Instrument::id);
        let expected_values = plan
            .input_roles()
            .len()
            .checked_mul(instruments.len())
            .ok_or_else(|| anyhow::anyhow!("request execution bundle value census overflows"))?;
        let mut admitted_frame_times = Vec::with_capacity(universe_frames.len());
        let mut admitted_event_times = Vec::with_capacity(universe_frames.len());

        // A custody-run frame's own per-batch selection_receipt_digest necessarily differs from
        // the single batch H4 bound against - see UniverseSelectionPinV2's doc for why that
        // comparison is skipped for CustodyRun, and what already proves this frame's provenance
        // instead (the custody resolver's own chain_root/head_identity pin, plus the Owner-sealed,
        // no-public-constructor frame/receipt types).
        let pin = if custody.is_some() {
            UniverseSelectionPinV2::CustodyRun
        } else {
            UniverseSelectionPinV2::SnapshotReceipt
        };

        for owner_frame in &universe_frames {
            let admitted = admit_owner_universe_program_event_v2(&plan, owner_frame, pin)?;
            let universe_frame = owner_frame.frame();
            anyhow::ensure!(
                matches!(
                    universe_frame.trigger().lifecycle().kind(),
                    StrategyInputEventKind::Bar
                ),
                "request execution bundle requires every Owner frame to be a complete BAR frame"
            );
            anyhow::ensure!(
                universe_frame.selection().members().len() == instrument_ids.len()
                    && universe_frame
                        .selection()
                        .members()
                        .iter()
                        .zip(&instrument_ids)
                        .all(|(member, instrument)| member.instrument() == instrument.to_string()),
                "request execution bundle member set mismatches the Owner universe"
            );
            anyhow::ensure!(
                universe_frame.values().len() == expected_values,
                "request execution bundle has an incomplete Owner universe frame"
            );
            admitted_frame_times.push(admitted.envelope().order_key.logical_time_ns);
            admitted_event_times.push(admitted.envelope().order_key.event_time_ns);
        }
        // The two sides are paired, not merely equal in length: a universe receipt admitted at one
        // instant paired with a schedule for another instant is two different frames wearing one
        // ordinal, and every per-frame check below would still pass.
        if custody.is_some() {
            anyhow::ensure!(
                admitted_frame_times
                    .iter()
                    .enumerate()
                    .all(|(index, decision_time)| {
                        admitted_event_times[index] == frame_times[index]
                            && frame_times[index] < *decision_time
                            && *decision_time
                                < frame_times
                                    .get(index + 1)
                                    .copied()
                                    .unwrap_or(authority.request_window().end_event_ns_exclusive)
                    }),
                "request execution bundle custody decision cuts must follow their BAR and precede the next frame"
            );
        } else {
            anyhow::ensure!(
                admitted_frame_times == frame_times,
                "request execution bundle universe frames and schedules are admitted at different \
                 instants: admitted(logical_time_ns)={admitted_frame_times:?} \
                 schedule(frame_time_ns)={frame_times:?}"
            );
        }
        let frame_time = frame_times[0];
        let plan_digest = *plan.canonical_plan_digest().as_bytes();
        let artifact_digest = *artifact.identity().as_bytes();
        // The request pins one universe selection for the whole window, so the series' selection
        // is the first frame's and every later frame was checked against the same member set.
        let first_frame = universe_frames[0].frame();
        let selection_identity = *first_frame.selection().selection_identity().as_bytes();
        let selection_digest = *first_frame.selection().selection_digest().as_bytes();
        anyhow::ensure!(
            authority.request_strategy_plan_identity()
                == canonical_digest_text("sha256", plan_digest)
                && authority.request_strategy_plan_digest() == plan_digest,
            "request execution bundle Plan mismatches Owner request authority"
        );
        anyhow::ensure!(
            authority.request_artifact_identity()
                == format!("rd-strategy-artifact-v2-{}", hex_bytes(&artifact_digest))
                && authority.request_artifact_digest() == artifact_digest,
            "request execution bundle Artifact mismatches Owner request authority"
        );
        // The request's `universe_selection` is the Universe Selection Record its composition
        // depends on, not the strategy-input selection the frames carry, and the two never share
        // an identity. Market Data holds the Record against each frame's verified batch, refusing
        // another as `UniverseSelectionRecordMismatch`, when it issues the frames this bundle is
        // built from. Comparing the Record with the frames' selection here refuses every
        // production Replay.
        let request_window = authority.request_window();
        anyhow::ensure!(
            frame_time == request_window.start_event_ns,
            "request execution bundle frame time mismatches Owner request window"
        );
        let funding = state_funding_schedule(
            funding_schedule.as_ref(),
            &instrument_ids,
            request_window.start_event_ns,
            request_window.end_event_ns_exclusive,
        )?;
        let (instruments, price_grids) = widen_price_grids_to_data(instruments, &data)?;
        let data = align_native_data_to_instruments(data, &instruments)?;
        ensure_native_data_at_instrument_precision(&data, &instruments)?;
        let round_len = instruments.len() * 2;
        anyhow::ensure!(
            data.chunks_exact(round_len)
                .zip(&admitted_frame_times)
                .all(|(round, decision_time)| round[..instruments.len()].iter().all(
                    |value| matches!(value, Data::Bar(bar) if bar.ts_init.as_u64() == *decision_time)
                )),
            "request execution bundle BAR delivery time mismatches its Owner decision cut"
        );
        let scheduling_data_digest = validate_and_digest_scheduling_data(
            &data,
            &instruments,
            &bar_types,
            frame_times,
            request_window.start_event_ns,
            request_window.end_event_ns_exclusive,
        )?;

        let economic = ReplayEconomicConfigurationV1::parse_canonical(
            authority.economic_configuration_canonical_bytes(),
        )?;
        let runner = ReplayRunnerOperationalProfileV1::parse_canonical(
            authority.runner_operational_profile_canonical_bytes(),
        )?;
        anyhow::ensure!(
            economic.digest() == economic_configuration_digest
                && runner.digest() == runner_operational_profile_digest,
            "request execution bundle profile seals mismatch Owner authority"
        );
        let binding = authority.into_execution_profile_binding();
        let execution_profile_binding_digest = binding.binding_digest();
        let native_profile =
            materialize_event_replay_execution_profile_v1(binding, &economic, &runner)?;
        native_profile.validate_target_set(&instruments)?;
        native_profile.validate_account_scope()?;
        native_profile.validate_data(&data)?;
        let account_scope_id = native_profile.account_scope_id();
        let mut census = ReplayTargetSetExecutionCensusV1 {
            request_locator,
            owner_authority_digest,
            trial_family_identity,
            trial_family_digest,
            economic_configuration_digest,
            runner_operational_profile_digest,
            execution_profile_binding_digest,
            native_materialization_digest: native_profile.materialization_digest(),
            canonical_plan_digest: *plan.canonical_plan_digest().as_bytes(),
            artifact_identity: *artifact.identity().as_bytes(),
            frame_sequence_digest: digest_frame_sequence(
                &universe_frames,
                owner_scheduling_receipt_digests,
            )?,
            frame_count: u64::try_from(universe_frames.len())?,
            universe_selection_identity: selection_identity,
            universe_selection_digest: selection_digest,
            member_instruments: instruments.map(|instrument| instrument.id().to_string()),
            instrument_terms: native_profile
                .instrument_terms()
                .map(|terms| ReplayTargetSetInstrumentCensusV1::from(terms)),
            price_grids,
            scheduling_data_digest,
            scheduling_data_count: u64::try_from(data.len())?,
            bar_count: u64::try_from(instruments.len() * universe_frames.len())?,
            event_count: u64::try_from(instruments.len() * universe_frames.len())?,
            funding,
            custody,
            census_digest: [0; 32],
        };
        census.census_digest = digest_census(&census)?;
        let fill_quote_instants =
            fill_quote_instants(&data, instruments.len(), &admitted_frame_times);
        Ok(Self {
            plan,
            artifact,
            universe_frames,
            native_profile,
            account_scope_id,
            strategy_id,
            run_id,
            instruments,
            bar_types,
            data,
            fill_quote_instants,
            funding_schedule,
            census,
        })
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    #[allow(
        dead_code,
        reason = "acceptance helpers are selected by focused test targets"
    )]
    pub(crate) fn new_with_native_instruments_for_test(
        authority: OwnerIssuedReplayExecutionProfileBindingV1,
        plan: StrategyPlanV2,
        artifact: StrategyArtifactV2,
        universe_frames: Vec<OwnerUniverseFrameV1>,
        strategy_id: StrategyId,
        run_id: String,
        instruments: impl Into<Vec<InstrumentAny>>,
        bar_types: impl Into<Vec<BarType>>,
        data: Vec<Data>,
        frame_times: &[u64],
    ) -> anyhow::Result<Self> {
        let instruments = BoundedMembers::new(instruments.into())?;
        let bar_types = BoundedMembers::new(bar_types.into())?;
        let receipt_digests = vec![[0; 32]; frame_times.len()];
        Self::new_with_native_instruments(
            authority,
            plan,
            artifact,
            universe_frames,
            strategy_id,
            run_id,
            instruments,
            bar_types,
            data,
            frame_times,
            &receipt_digests,
            None,
            None,
        )
    }
}

/// Seals the ordered per-frame facts the census used to carry as three single-frame fields.
///
/// One digest rather than three columns per frame, so the census keeps a fixed width: a census
/// that is complete for two frames and one that is complete for three hundred are then the same
/// shape, and no consumer has to learn to iterate to stay correct. The order is inside the value,
/// so two frames swapped are a different sequence rather than the same one. `frame_count` stays a
/// field of its own because a digest cannot answer how many, and a one-frame series has to be
/// distinguishable from a series that carried none.
fn digest_frame_sequence(
    universe_frames: &[OwnerUniverseFrameV1],
    owner_scheduling_receipt_digests: &[[u8; 32]],
) -> anyhow::Result<[u8; 32]> {
    anyhow::ensure!(
        universe_frames.len() == owner_scheduling_receipt_digests.len(),
        "request execution bundle frame sequence digest has unpaired frames"
    );
    let mut hasher = Sha256::new();
    hasher.update(FRAME_SEQUENCE_DIGEST_DOMAIN_V1);
    hasher.update(u64::try_from(universe_frames.len())?.to_be_bytes());

    for (ordinal, (universe_frame, scheduling_receipt_digest)) in universe_frames
        .iter()
        .zip(owner_scheduling_receipt_digests)
        .enumerate()
    {
        let universe_frame = universe_frame.frame();
        hasher.update(u64::try_from(ordinal)?.to_be_bytes());
        hasher.update(universe_frame.digest().as_bytes());
        hasher.update(
            universe_frame
                .selection()
                .observation_batch_digest()
                .as_bytes(),
        );
        hasher.update(scheduling_receipt_digest);
    }
    Ok(hasher.finalize().into())
}

pub(crate) fn digest_census(census: &ReplayTargetSetExecutionCensusV1) -> anyhow::Result<[u8; 32]> {
    let mut hasher = Sha256::new();
    update_member_count_domain(
        &mut hasher,
        CENSUS_DIGEST_DOMAIN_V1,
        census.member_instruments.len(),
    );

    for value in [
        census.request_locator.request_identity.as_str(),
        census.request_locator.meaning_digest.as_str(),
        census.request_locator.receipt_identity.as_str(),
        census.request_locator.seal_digest.as_str(),
    ] {
        digest_text(&mut hasher, value)?;
    }

    for digest in [
        census.owner_authority_digest,
        census.trial_family_digest,
        census.economic_configuration_digest,
        census.runner_operational_profile_digest,
        census.execution_profile_binding_digest,
        census.native_materialization_digest,
        census.canonical_plan_digest,
        census.artifact_identity,
        census.frame_sequence_digest,
        census.universe_selection_identity,
        census.universe_selection_digest,
        census.scheduling_data_digest,
    ] {
        hasher.update(digest);
    }
    hasher.update(b"FRAME_COUNT_V1\0");
    hasher.update(census.frame_count.to_be_bytes());
    digest_text(&mut hasher, &census.trial_family_identity)?;
    for instrument in &census.member_instruments {
        digest_text(&mut hasher, instrument)?;
    }

    for terms in &census.instrument_terms {
        digest_text(&mut hasher, &terms.instrument_identity)?;
        hasher.update(terms.instrument_fact_digest);
        hasher.update(terms.instrument_receipt_digest);
        hasher.update(terms.terms_digest);
        digest_text(&mut hasher, &terms.venue_identity)?;
        digest_text(&mut hasher, &terms.quote_currency)?;
        digest_text(&mut hasher, &terms.account_scope_identity)?;
        hasher.update(terms.event_time_ns.to_be_bytes());
        hasher.update(terms.valid_from_ns.to_be_bytes());
        hasher.update(terms.valid_until_ns_exclusive.to_be_bytes());
        digest_text(&mut hasher, &terms.margin_model)?;
        for value in [
            terms.maker_fee,
            terms.taker_fee,
            terms.initial_margin,
            terms.maintenance_margin,
        ] {
            hasher.update(value.mantissa.to_be_bytes());
            hasher.update([value.scale]);
        }
    }
    hasher.update(b"PRICE_GRIDS_V1\0");

    for grid in &census.price_grids {
        hasher.update([
            grid.instrument_price_precision,
            grid.data_price_precision,
            grid.replay_price_precision,
        ]);
        hasher.update(grid.finest_price_at_ns.to_be_bytes());
    }
    hasher.update(census.scheduling_data_count.to_be_bytes());
    hasher.update(census.bar_count.to_be_bytes());
    hasher.update(census.event_count.to_be_bytes());

    // A bundle that states no funding keeps the digest it had before funding was carried.
    if let ReplayFundingStatementV1::Stated { schedule_digest } = census.funding {
        hasher.update(b"FUNDING_SCHEDULE_V1\0");
        hasher.update(schedule_digest);
    }

    // A snapshot run keeps the digest it had before custody runs existed.
    if let Some(custody) = &census.custody {
        hasher.update(b"CUSTODY_RUN_V1\0");
        hasher.update(custody.chain_root);
        hasher.update(custody.head_identity);
        hasher.update(custody.head_digest);
        hasher.update(custody.head_version.to_be_bytes());
        hasher.update(u64::try_from(custody.view_identities.len())?.to_be_bytes());

        for view_identity in &custody.view_identities {
            hasher.update(view_identity);
        }
    }
    Ok(hasher.finalize().into())
}

/// States the run's funding from Market Data's schedule, which must cover exactly the run's window
/// and members. Market Data owns the schedule's completeness; this checks only that it is the
/// schedule of this run.
fn state_funding_schedule(
    schedule: Option<&ReplayFundingScheduleV1>,
    instrument_ids: &[InstrumentId],
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
) -> anyhow::Result<ReplayFundingStatementV1> {
    let Some(schedule) = schedule else {
        return Ok(ReplayFundingStatementV1::FundingNotStated);
    };
    anyhow::ensure!(
        schedule.window() == (window_start_ns, window_end_ns_exclusive),
        "FUNDING_SCHEDULE_WINDOW_NOT_THE_RUNS: the funding schedule covers another window"
    );
    let mut members = instrument_ids
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    members.sort_unstable();
    anyhow::ensure!(
        schedule
            .members()
            .iter()
            .map(|member| member.instrument())
            .eq(members.iter().map(String::as_str)),
        "FUNDING_SCHEDULE_MEMBERS_NOT_THE_RUNS: the funding schedule covers other members"
    );
    Ok(ReplayFundingStatementV1::Stated {
        schedule_digest: schedule.digest(),
    })
}

/// Checks executed scheduling data against the Owner's sealed frame order boundaries.
///
/// The sealed sequence's last frame is not executed: it is there so the frame before it has
/// something its liquidity must close before. Everything ahead of it is a frame a run consumes, so
/// an executed BAR must be one of their first-BAR orders and an executed EVENT must fall inside
/// one of their liquidity windows.
fn verify_scheduling_data_against_sealed_frames(
    data: &[Data],
    frame_orders: &[(u64, u64)],
) -> anyhow::Result<()> {
    let Some((_, consumed)) = frame_orders.split_last() else {
        anyhow::bail!("sealed sequence carries no frame for an execution to bind to");
    };
    anyhow::ensure!(
        !consumed.is_empty(),
        "sealed sequence has nothing to bound the frame an execution would consume"
    );
    let bars: Vec<u64> = data
        .iter()
        .filter_map(|value| match value {
            Data::Bar(bar) => Some(bar.ts_event.as_u64()),
            _ => None,
        })
        .collect();
    let events: Vec<u64> = data
        .iter()
        .filter_map(|value| match value {
            Data::Quote(quote) => Some(quote.ts_event.as_u64()),
            _ => None,
        })
        .collect();
    anyhow::ensure!(
        !bars.is_empty() && !events.is_empty(),
        "executed bundle carries no BAR or no EVENT to bind to the sealed sequence"
    );
    anyhow::ensure!(
        bars.iter().all(|order| consumed
            .iter()
            .any(|(first_bar_order, _)| first_bar_order == order)),
        "executed bundle BAR frame is not one the sealed sequence consumes"
    );
    anyhow::ensure!(
        events.iter().all(|order| consumed.iter().any(
            |(first_bar_order, last_liquidity_event_order)| order > first_bar_order
                && order <= last_liquidity_event_order
        )),
        "executed bundle EVENT falls outside every sealed frame"
    );
    // "All of a frame's liquidity EVENTs must precede the next frame's first BAR."
    anyhow::ensure!(
        frame_orders.windows(2).all(|pair| pair[0].1 < pair[1].0),
        "sealed frame liquidity does not precede the next frame's first BAR"
    );
    Ok(())
}

/// Widens each member's price grid to the finest scale its window's BAR and Quote prices show.
///
/// A member whose data is no finer than its tick keeps the Instrument Master's grid. One whose data
/// is finer runs at the data's precision, with a one-unit increment at that precision, since the
/// engine requires an increment at the instrument's own precision. Only prices widen: a size grid is
/// what one grid unit of position means, so a size finer than its instrument stays refused by name
/// in [`align_native_data_to_instruments`].
fn widen_price_grids_to_data(
    instruments: BoundedMembers<InstrumentAny>,
    data: &[Data],
) -> anyhow::Result<(
    BoundedMembers<InstrumentAny>,
    BoundedMembers<ReplayPriceGridV1>,
)> {
    let mut widened = Vec::with_capacity(instruments.len());
    let mut grids = Vec::with_capacity(instruments.len());

    for instrument in instruments {
        let instrument_id = instrument.id();
        let mut finest: Option<(u8, u64)> = None;

        for datum in data
            .iter()
            .filter(|datum| datum.instrument_id() == instrument_id)
        {
            let (prices, at) = match datum {
                Data::Bar(bar) => (vec![bar.open, bar.high, bar.low, bar.close], bar.ts_event),
                Data::Quote(quote) => (vec![quote.bid_price, quote.ask_price], quote.ts_event),
                _ => continue,
            };

            for price in prices {
                let scale = u8::try_from(price.as_decimal().normalize().scale())?;

                if finest.is_none_or(|(finest_scale, _)| scale > finest_scale) {
                    finest = Some((scale, at.as_u64()));
                }
            }
        }
        let (data_price_precision, finest_price_at_ns) = finest.ok_or_else(|| {
            anyhow::anyhow!("request execution bundle member {instrument_id} has no priced data")
        })?;
        let instrument_price_precision = instrument.price_precision();
        let replay_price_precision = instrument_price_precision.max(data_price_precision);
        let instrument = if replay_price_precision > instrument_price_precision {
            let InstrumentAny::CryptoPerpetual(mut perpetual) = instrument else {
                anyhow::bail!(
                    "request execution bundle can widen only a crypto perpetual's price grid"
                );
            };
            perpetual.price_precision = replay_price_precision;
            perpetual.price_increment = Price::from_decimal_dp(
                rust_decimal::Decimal::new(1, u32::from(replay_price_precision)),
                replay_price_precision,
            )?;
            InstrumentAny::CryptoPerpetual(perpetual)
        } else {
            instrument
        };
        widened.push(instrument);
        grids.push(ReplayPriceGridV1 {
            instrument_price_precision,
            data_price_precision,
            finest_price_at_ns,
            replay_price_precision,
        });
    }
    Ok((
        BoundedMembers::try_from(widened)?,
        BoundedMembers::try_from(grids)?,
    ))
}

/// Re-expresses each native BAR and Quote at its instrument's price and size precision, exactly.
///
/// Market Data issues values at their canonical scale, without trailing fractional zeros, so a
/// close of 123.450 on a 0.001 tick arrives as 123.45 at precision 2. The engine needs every price
/// and size at the instrument's precision: its matching engine logs and drops a BAR or Quote whose
/// precision differs, and its venue rejects an order priced at another precision. The value is
/// never changed. A value finer than the instrument's grid is refused by name rather than rounded.
fn align_native_data_to_instruments(
    data: Vec<Data>,
    instruments: &[InstrumentAny],
) -> anyhow::Result<Vec<Data>> {
    data.into_iter()
        .map(|datum| {
            let instrument = instruments
                .iter()
                .find(|instrument| instrument.id() == datum.instrument_id())
                .ok_or_else(|| {
                    anyhow::anyhow!(
                        "request execution bundle native data names no target set member"
                    )
                })?;
            let price_precision = instrument.price_precision();
            let size_precision = instrument.size_precision();
            Ok(match datum {
                Data::Bar(bar) => Data::Bar(Bar {
                    open: exact_price(bar.open, price_precision)?,
                    high: exact_price(bar.high, price_precision)?,
                    low: exact_price(bar.low, price_precision)?,
                    close: exact_price(bar.close, price_precision)?,
                    volume: exact_quantity(bar.volume, size_precision)?,
                    ..bar
                }),
                Data::Quote(quote) => Data::Quote(QuoteTick {
                    bid_price: exact_price(quote.bid_price, price_precision)?,
                    ask_price: exact_price(quote.ask_price, price_precision)?,
                    bid_size: exact_quantity(quote.bid_size, size_precision)?,
                    ask_size: exact_quantity(quote.ask_size, size_precision)?,
                    ..quote
                }),
                other => other,
            })
        })
        .collect()
}

fn exact_price(price: Price, precision: u8) -> anyhow::Result<Price> {
    let aligned = Price::from_decimal_dp(price.as_decimal(), precision)?;
    anyhow::ensure!(
        aligned.as_decimal() == price.as_decimal(),
        "request execution bundle native price {price} is finer than its instrument's precision {precision}"
    );
    Ok(aligned)
}

fn exact_quantity(quantity: Quantity, precision: u8) -> anyhow::Result<Quantity> {
    let aligned = Quantity::from_decimal_dp(quantity.as_decimal(), precision)?;
    anyhow::ensure!(
        aligned.as_decimal() == quantity.as_decimal(),
        "request execution bundle native size {quantity} is finer than its instrument's precision {precision}"
    );
    Ok(aligned)
}

/// Refuses, by name, any native BAR or Quote whose precision is not its instrument's.
///
/// The engine does not refuse such data: its matching engine logs and drops it, and the run
/// completes on what remained. A price whose trailing zero was canonicalized away would silently
/// remove its whole BAR or Quote from a result that still reads as complete. This guard makes that
/// impossible past the bundle, whatever produced the data.
fn ensure_native_data_at_instrument_precision(
    data: &[Data],
    instruments: &[InstrumentAny],
) -> anyhow::Result<()> {
    for datum in data {
        let instrument = instruments
            .iter()
            .find(|instrument| instrument.id() == datum.instrument_id())
            .ok_or_else(|| {
                anyhow::anyhow!("request execution bundle native data names no target set member")
            })?;
        let (prices, sizes): (Vec<Price>, Vec<Quantity>) = match datum {
            Data::Bar(bar) => (
                vec![bar.open, bar.high, bar.low, bar.close],
                vec![bar.volume],
            ),
            Data::Quote(quote) => (
                vec![quote.bid_price, quote.ask_price],
                vec![quote.bid_size, quote.ask_size],
            ),
            _ => continue,
        };
        anyhow::ensure!(
            prices
                .iter()
                .all(|price| price.precision == instrument.price_precision())
                && sizes
                    .iter()
                    .all(|size| size.precision == instrument.size_precision()),
            "request execution bundle native data precision differs from its instrument's, which the engine would drop"
        );
    }
    Ok(())
}

/// Each frame's fill-quote instant per member, in member order, from data
/// `validate_and_digest_scheduling_data` has accepted: every round is one BAR per member then one
/// Quote per member, each after the frame's decision instant.
fn fill_quote_instants(
    data: &[Data],
    member_count: usize,
    frame_times: &[u64],
) -> BTreeMap<u64, Vec<u64>> {
    data.chunks_exact(member_count * 2)
        .zip(frame_times)
        .map(|(round, frame_time)| {
            let instants = round[member_count..]
                .iter()
                .filter_map(|value| match value {
                    Data::Quote(quote) => Some(quote.ts_event.as_u64()),
                    _ => None,
                })
                .collect();
            (*frame_time, instants)
        })
        .collect()
}

fn validate_and_digest_scheduling_data(
    data: &[Data],
    instruments: &[InstrumentAny],
    bar_types: &[BarType],
    frame_times: &[u64],
    window_start_event_ns: u64,
    window_end_event_ns_exclusive: u64,
) -> anyhow::Result<[u8; 32]> {
    let member_count = instruments.len();
    anyhow::ensure!(
        is_admitted_member_count(member_count) && bar_types.len() == member_count,
        "request execution bundle BAR types do not correspond to its target set members"
    );
    // One BAR signal per member, then one Quote EVENT per member.
    let round_len = member_count * 2;

    anyhow::ensure!(
        !frame_times.is_empty() && data.len() == round_len * frame_times.len(),
        "request execution bundle scheduling data does not carry one complete round per frame"
    );
    anyhow::ensure!(
        window_start_event_ns < window_end_event_ns_exclusive
            && data
                .iter()
                .all(|value| value.ts_init().as_u64() >= window_start_event_ns),
        "request execution bundle scheduling data is outside the Owner request window"
    );

    // Every round is checked, not only the first. A rule that reads the head of a paired shape can
    // never see a defect behind it, and the whole point of a series is that there is something
    // behind it.
    for (round, frame_time) in data.chunks_exact(round_len).zip(frame_times) {
        let (bar_signals, quote_events) = round.split_at(member_count);
        let bars = bar_signals
            .iter()
            .map(|value| match value {
                Data::Bar(bar) => Some(bar),
                _ => None,
            })
            .collect::<Option<Vec<_>>>();
        let events = quote_events
            .iter()
            .map(|value| match value {
                Data::Quote(event) => Some(event),
                _ => None,
            })
            .collect::<Option<Vec<_>>>();
        let (Some(bars), Some(events)) = (bars, events) else {
            anyhow::bail!(
                "request execution bundle requires one canonical BAR signal per member followed by one Quote EVENT per member in every round"
            );
        };
        let decision_time = bars[0].ts_init.as_u64();

        for ordinal in 0..member_count {
            let instrument_id = instruments[ordinal].id();
            anyhow::ensure!(
                bars[ordinal].bar_type == bar_types[ordinal]
                    && bars[ordinal].instrument_id() == instrument_id
                    && bars[ordinal].ts_event.as_u64() == *frame_time
                    && bars[ordinal].ts_init.as_u64() == decision_time
                    && decision_time >= *frame_time
                    && bars[ordinal].ts_event.as_u64() >= window_start_event_ns
                    && bars[ordinal].ts_event.as_u64() < window_end_event_ns_exclusive,
                "request execution bundle BAR scheduling order or time mismatches"
            );
            anyhow::ensure!(
                events[ordinal].instrument_id == instrument_id
                    && events[ordinal].ts_event.as_u64() > decision_time
                    && events[ordinal].ts_event.as_u64() >= window_start_event_ns
                    && events[ordinal].ts_event.as_u64() < window_end_event_ns_exclusive
                    && events[ordinal].ts_init.as_u64() >= events[ordinal].ts_event.as_u64()
                    && events[ordinal].bid_size.as_decimal() > rust_decimal::Decimal::ZERO
                    && events[ordinal].ask_size.as_decimal() > rust_decimal::Decimal::ZERO,
                "request execution bundle EVENT scheduling order, time, or liquidity mismatches"
            );
        }
        // Every member's Quote comes from the frame's quote cut, one PIT snapshot and so one
        // instant, so members share an event time. Their order at that instant is member order,
        // which the loop above already fixes position by position; what is refused here is a
        // Quote that goes back in time.
        anyhow::ensure!(
            events
                .windows(2)
                .all(|pair| pair[0].ts_event <= pair[1].ts_event),
            "request execution bundle EVENT order is not canonical"
        );
    }
    // Native data must reach the engine in delivery order. A custody BAR keeps its source event
    // at e_k and is delivered at d_k; the following quote must still arrive after that decision.
    anyhow::ensure!(
        data.windows(2)
            .all(|pair| pair[0].ts_init() <= pair[1].ts_init()),
        "request execution bundle order changes under Backtest ts_init scheduling"
    );

    let mut hasher = Sha256::new();
    hasher.update(SCHEDULING_DIGEST_DOMAIN_V1);
    hasher.update(u64::try_from(data.len())?.to_be_bytes());
    hasher.update(u64::try_from(frame_times.len())?.to_be_bytes());

    // Every element in issue order, so a run that reordered two rounds without changing either one
    // seals a different digest than the run the Owner issued.
    for value in data {
        match value {
            Data::Bar(bar) => digest_bar(&mut hasher, bar)?,
            Data::Quote(event) => digest_quote(&mut hasher, event)?,
            _ => {
                anyhow::bail!("request execution bundle scheduling data carries a foreign element")
            }
        }
    }
    Ok(hasher.finalize().into())
}

fn canonical_digest_text(algorithm: &str, digest: [u8; 32]) -> String {
    format!("{algorithm}:{}", hex_bytes(&digest))
}

fn hex_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn digest_bar(hasher: &mut Sha256, bar: &Bar) -> anyhow::Result<()> {
    hasher.update([1]);
    digest_text(hasher, &bar.bar_type.to_string())?;
    for value in [bar.open, bar.high, bar.low, bar.close] {
        digest_text(hasher, &value.to_string())?;
    }
    digest_text(hasher, &bar.volume.to_string())?;
    hasher.update(bar.ts_event.as_u64().to_be_bytes());
    hasher.update(bar.ts_init.as_u64().to_be_bytes());
    Ok(())
}

fn digest_quote(hasher: &mut Sha256, quote: &QuoteTick) -> anyhow::Result<()> {
    hasher.update([2]);
    digest_text(hasher, &quote.instrument_id.to_string())?;
    for value in [quote.bid_price, quote.ask_price] {
        digest_text(hasher, &value.to_string())?;
    }

    for value in [quote.bid_size, quote.ask_size] {
        digest_text(hasher, &value.to_string())?;
    }
    hasher.update(quote.ts_event.as_u64().to_be_bytes());
    hasher.update(quote.ts_init.as_u64().to_be_bytes());
    Ok(())
}

fn digest_text(hasher: &mut Sha256, value: &str) -> anyhow::Result<()> {
    let len = u64::try_from(value.len())?;
    hasher.update(len.to_be_bytes());
    hasher.update(value.as_bytes());
    Ok(())
}

#[cfg(all(test, feature = "sealed-strategy-input-acceptance"))]
mod tests {
    use vibe_model::{
        data::{BarSpecification, QuoteTick},
        enums::{AggregationSource, BarAggregation, PriceType},
        types::{Price, Quantity},
    };

    use super::*;
    use crate::program_host_v2_target_set_backtest_tests::instruments;

    const FRAME_TIME: u64 = 1_000;

    /// The instruments the scheduling fixture is for, on a 0.001 tick: its data, at the canonical
    /// scale of two places, is coarser than the instruments.
    fn finer_tick_instruments() -> ([InstrumentAny; 2], Vec<Data>) {
        let (mut instruments, _, data) = scheduling_fixture();
        for instrument in &mut instruments {
            let InstrumentAny::CryptoPerpetual(instrument) = instrument else {
                unreachable!("the scheduling fixture's instruments are perpetuals")
            };
            instrument.price_precision = 3;
            instrument.price_increment = Price::from("0.001");
        }
        (instruments, data)
    }

    /// BTCUSDT's 2021-06-01 daily bar from Binance's public USD-M `klines` endpoint, at Market
    /// Data's canonical scale of nine places, on the instrument as today's 0.10 tick makes it.
    fn btc_2021_on_todays_tick() -> (BoundedMembers<InstrumentAny>, Vec<Data>) {
        let (mut instruments, _, mut data) = scheduling_fixture();
        let InstrumentAny::CryptoPerpetual(btc) = &mut instruments[0] else {
            unreachable!("the scheduling fixture's instruments are perpetuals")
        };
        btc.price_precision = 1;
        btc.price_increment = Price::from("0.1");
        let Data::Bar(bar) = &mut data[0] else {
            unreachable!("the first datum is the first member's BAR")
        };
        bar.open = Price::from("37244.360000000");
        bar.high = Price::from("37893.760000000");
        bar.low = Price::from("35500.000000000");
        bar.close = Price::from("36693.410000000");
        (BoundedMembers::try_from(instruments).unwrap(), data)
    }

    #[rstest::rstest]
    fn a_window_finer_than_todays_tick_is_refused_on_that_tick() {
        let (instruments, data) = btc_2021_on_todays_tick();
        let refusal = align_native_data_to_instruments(data, &instruments)
            .expect_err("a two-place 2021 price is finer than today's one-place tick");
        assert_eq!(
            refusal.to_string(),
            "request execution bundle native price 37244.360000000 is finer than its instrument's precision 1"
        );
    }

    /// The bundle widens BTC's grid to the data's two places, records where that came from, and
    /// the data then aligns; the other member's data is no finer than its tick, so it keeps it.
    #[rstest::rstest]
    fn a_window_finer_than_todays_tick_widens_its_price_grid_to_the_data() {
        let (instruments, data) = btc_2021_on_todays_tick();
        let (instruments, grids) = widen_price_grids_to_data(instruments, &data).unwrap();
        assert_eq!(
            grids[0],
            ReplayPriceGridV1 {
                instrument_price_precision: 1,
                data_price_precision: 2,
                finest_price_at_ns: FRAME_TIME,
                replay_price_precision: 2,
            }
        );
        assert!(grids[0].widened_from_data());
        assert_eq!(
            (
                instruments[0].price_precision(),
                instruments[0].price_increment()
            ),
            (2, Price::from("0.01"))
        );
        assert_eq!(
            grids[1],
            ReplayPriceGridV1 {
                instrument_price_precision: 2,
                data_price_precision: 2,
                finest_price_at_ns: FRAME_TIME,
                replay_price_precision: 2,
            }
        );
        assert!(!grids[1].widened_from_data());
        let aligned = align_native_data_to_instruments(data, &instruments).unwrap();
        ensure_native_data_at_instrument_precision(&aligned, &instruments).unwrap();
        let Data::Bar(bar) = &aligned[0] else {
            unreachable!("the first datum is the first member's BAR")
        };
        assert_eq!(bar.open, Price::from("37244.36"));
    }

    #[rstest::rstest]
    fn data_at_another_precision_is_refused_by_name_before_the_engine_can_drop_it() {
        let (instruments, data) = finer_tick_instruments();
        let refusal = ensure_native_data_at_instrument_precision(&data, &instruments)
            .expect_err("two-place data is not at a three-place instrument's precision");
        assert!(
            refusal.to_string().contains("which the engine would drop"),
            "{refusal}"
        );

        let aligned = align_native_data_to_instruments(data, &instruments).unwrap();
        ensure_native_data_at_instrument_precision(&aligned, &instruments).unwrap();
    }

    #[rstest::rstest]
    fn a_value_finer_than_its_instrument_is_refused_by_name_not_rounded() {
        let (instruments, _, mut data) = scheduling_fixture();
        let Data::Quote(quote) = &mut data[2] else {
            unreachable!("the third datum is the first member's Quote")
        };
        quote.ask_price = Price::from("100.015");
        let refusal = align_native_data_to_instruments(data, &instruments)
            .expect_err("a three-place price on a two-place instrument is not exact");
        assert!(
            refusal
                .to_string()
                .contains("is finer than its instrument's precision"),
            "{refusal}"
        );
    }

    fn scheduling_fixture() -> ([InstrumentAny; 2], [BarType; 2], Vec<Data>) {
        let instruments = instruments();
        let bar_types = instruments.each_ref().map(|instrument| {
            BarType::new(
                instrument.id(),
                BarSpecification::new(1, BarAggregation::Day, PriceType::Last),
                AggregationSource::External,
            )
        });
        let data = vec![
            Data::Bar(Bar::new(
                bar_types[0],
                Price::from("186.41"),
                Price::from("188.00"),
                Price::from("185.00"),
                Price::from("187.25"),
                Quantity::from("100"),
                FRAME_TIME.into(),
                FRAME_TIME.into(),
            )),
            Data::Bar(Bar::new(
                bar_types[1],
                Price::from("419.81"),
                Price::from("425.00"),
                Price::from("418.00"),
                Price::from("421.15"),
                Quantity::from("100.0"),
                FRAME_TIME.into(),
                FRAME_TIME.into(),
            )),
            // Both members' Quotes come from the frame's quote cut, so they share its instant.
            quote(&instruments[0], FRAME_TIME + 1, "100"),
            quote(&instruments[1], FRAME_TIME + 1, "100.0"),
        ];
        (instruments, bar_types, data)
    }

    fn quote(instrument: &InstrumentAny, time: u64, size: &str) -> Data {
        Data::Quote(QuoteTick::new(
            instrument.id(),
            Price::from("100.00"),
            Price::from("100.01"),
            Quantity::from(size),
            Quantity::from(size),
            time.into(),
            time.into(),
        ))
    }

    const SECOND_FRAME_TIME: u64 = FRAME_TIME + 10;
    const TWO_ROUND_WINDOW_END: u64 = FRAME_TIME + 20;

    /// Two complete rounds, so a rule that only reads the first one has somewhere to be wrong.
    fn two_round_scheduling_fixture() -> ([InstrumentAny; 2], [BarType; 2], Vec<Data>, Vec<u64>) {
        let (instruments, bar_types, mut data) = scheduling_fixture();
        data.push(member_bar(bar_types[0], "100", SECOND_FRAME_TIME));
        data.push(member_bar(bar_types[1], "100.0", SECOND_FRAME_TIME));
        data.push(quote(&instruments[0], SECOND_FRAME_TIME + 1, "100"));
        data.push(quote(&instruments[1], SECOND_FRAME_TIME + 1, "100.0"));
        (
            instruments,
            bar_types,
            data,
            vec![FRAME_TIME, SECOND_FRAME_TIME],
        )
    }

    #[rstest::rstest]
    fn a_custody_bar_is_delivered_at_its_decision_cut_before_its_fill_quote() {
        let (instruments, _, mut data) = scheduling_fixture();
        for value in data.iter_mut().take(instruments.len()) {
            let Data::Bar(bar) = value else {
                unreachable!("the fixture starts with one BAR per member")
            };
            bar.ts_init = (FRAME_TIME + 2).into();
        }
        data[2] = quote(&instruments[0], FRAME_TIME + 3, "100");
        data[3] = quote(&instruments[1], FRAME_TIME + 3, "100.0");
        let bar_types = instruments.each_ref().map(|instrument| {
            BarType::new(
                instrument.id(),
                BarSpecification::new(1, BarAggregation::Day, PriceType::Last),
                AggregationSource::External,
            )
        });
        assert!(
            validate_and_digest_scheduling_data(
                &data,
                &instruments,
                &bar_types,
                &[FRAME_TIME],
                FRAME_TIME,
                FRAME_TIME + 10,
            )
            .is_ok(),
            "the source BAR remains at e_k and reaches the engine at d_k"
        );

        data[2] = quote(&instruments[0], FRAME_TIME + 1, "100");
        assert!(
            validate_and_digest_scheduling_data(
                &data,
                &instruments,
                &bar_types,
                &[FRAME_TIME],
                FRAME_TIME,
                FRAME_TIME + 10,
            )
            .is_err(),
            "a fill quote before the decision cut cannot execute the decision"
        );
    }

    #[rstest::rstest]
    fn a_defect_in_the_second_round_is_refused() {
        let (instruments, bar_types, data, frame_times) = two_round_scheduling_fixture();
        assert!(
            validate_and_digest_scheduling_data(
                &data,
                &instruments,
                &bar_types,
                &frame_times,
                FRAME_TIME,
                TWO_ROUND_WINDOW_END
            )
            .is_ok()
        );

        // The second round's first BAR is stamped at the first round's instant. A validator that
        // read only the head of the paired shape would accept this, because the head is intact.
        let mut late = data.clone();
        late[4] = member_bar(bar_types[0], "100", FRAME_TIME);
        assert!(
            validate_and_digest_scheduling_data(
                &late,
                &instruments,
                &bar_types,
                &frame_times,
                FRAME_TIME,
                TWO_ROUND_WINDOW_END
            )
            .is_err()
        );

        // Same shape one element further in: the second round's second EVENT loses its liquidity.
        let mut dry = data;
        dry[7] = quote(&instruments[1], SECOND_FRAME_TIME + 1, "0");
        assert!(
            validate_and_digest_scheduling_data(
                &dry,
                &instruments,
                &bar_types,
                &frame_times,
                FRAME_TIME,
                TWO_ROUND_WINDOW_END
            )
            .is_err()
        );
    }

    /// Frames that do not advance are refused, whichever rule does it.
    ///
    /// The rule that catches it is the scheduling order, not a frame-time comparison: the second
    /// round's BARs land before the first round's EVENTs. Naming the observable behaviour rather
    /// than the mechanism is deliberate, because the mechanism moved once already.
    #[rstest::rstest]
    fn frames_that_do_not_advance_are_refused() {
        let (instruments, bar_types, mut data, _) = two_round_scheduling_fixture();
        data[4] = member_bar(bar_types[0], "100", FRAME_TIME);
        data[5] = member_bar(bar_types[1], "100.0", FRAME_TIME);
        data[6] = quote(&instruments[0], FRAME_TIME + 1, "100");
        data[7] = quote(&instruments[1], FRAME_TIME + 1, "100.0");
        assert!(
            validate_and_digest_scheduling_data(
                &data,
                &instruments,
                &bar_types,
                &[FRAME_TIME, FRAME_TIME],
                FRAME_TIME,
                TWO_ROUND_WINDOW_END
            )
            .is_err()
        );
    }

    /// A frame's Quotes share their quote cut's instant, in member order, and never go back.
    ///
    /// Swapped members are refused by position; a later member's Quote stamped earlier is refused
    /// by the event order even when its `ts_init` keeps the stream sorted for Backtest.
    #[rstest::rstest]
    fn quotes_of_one_quote_cut_share_an_instant_in_member_order() {
        let (instruments, bar_types, data) = scheduling_fixture();
        let validate = |data: &[Data]| {
            validate_and_digest_scheduling_data(
                data,
                &instruments,
                &bar_types,
                &[FRAME_TIME],
                FRAME_TIME,
                FRAME_TIME + 10,
            )
        };
        assert!(validate(&data).is_ok(), "one instant, member order");

        let mut swapped = data.clone();
        swapped.swap(2, 3);
        assert!(validate(&swapped).is_err(), "members out of order");

        let mut backwards = data;
        backwards[2] = quote(&instruments[0], FRAME_TIME + 2, "100");
        backwards[3] = Data::Quote(QuoteTick::new(
            instruments[1].id(),
            Price::from("100.00"),
            Price::from("100.01"),
            Quantity::from("100.0"),
            Quantity::from("100.0"),
            (FRAME_TIME + 1).into(),
            (FRAME_TIME + 3).into(),
        ));
        assert!(
            validate(&backwards).is_err(),
            "a later member's Quote stamped before an earlier member's"
        );
    }

    #[rstest::rstest]
    fn a_frame_without_its_own_round_is_refused() {
        let (instruments, bar_types, data, frame_times) = two_round_scheduling_fixture();
        let mut short = data.clone();
        short.pop();
        assert!(
            validate_and_digest_scheduling_data(
                &short,
                &instruments,
                &bar_types,
                &frame_times,
                FRAME_TIME,
                TWO_ROUND_WINDOW_END
            )
            .is_err()
        );

        // One round of data claiming two frames, and two rounds claiming one.
        assert!(
            validate_and_digest_scheduling_data(
                &data[0..4],
                &instruments,
                &bar_types,
                &frame_times,
                FRAME_TIME,
                TWO_ROUND_WINDOW_END
            )
            .is_err()
        );
        assert!(
            validate_and_digest_scheduling_data(
                &data,
                &instruments,
                &bar_types,
                &[FRAME_TIME],
                FRAME_TIME,
                TWO_ROUND_WINDOW_END
            )
            .is_err()
        );
    }

    #[rstest::rstest]
    fn the_scheduling_digest_covers_every_round() {
        let (instruments, bar_types, data, frame_times) = two_round_scheduling_fixture();
        let whole = validate_and_digest_scheduling_data(
            &data,
            &instruments,
            &bar_types,
            &frame_times,
            FRAME_TIME,
            TWO_ROUND_WINDOW_END,
        )
        .unwrap();
        // Same lengths, same first round, one element of the second round changed. Comparing
        // against a one-round call instead would have passed on the element counts alone, which is
        // what the first version of this test did and what mutation testing caught.
        let mut altered = data;
        altered[4] = member_bar(bar_types[0], "101", SECOND_FRAME_TIME);
        let second_round_changed = validate_and_digest_scheduling_data(
            &altered,
            &instruments,
            &bar_types,
            &frame_times,
            FRAME_TIME,
            TWO_ROUND_WINDOW_END,
        )
        .unwrap();
        assert_ne!(whole, second_round_changed);
    }

    fn member_bar(bar_type: BarType, size: &str, instant: u64) -> Data {
        Data::Bar(Bar::new(
            bar_type,
            Price::from("186.41"),
            Price::from("188.00"),
            Price::from("185.00"),
            Price::from("187.25"),
            Quantity::from(size),
            instant.into(),
            instant.into(),
        ))
    }

    /// A run consumes every frame but the last, so a BAR at a later consumed frame binds too, and
    /// a BAR at the bounding frame does not bind at all.
    #[rstest::rstest]
    fn an_executed_run_binds_to_every_frame_the_sequence_consumes() {
        let (instruments, bar_types, mut data) = scheduling_fixture();

        for (ordinal, size) in ["100", "100.0"].into_iter().enumerate() {
            data.push(member_bar(bar_types[ordinal], size, FRAME_TIME + 10));
        }
        data.push(quote(&instruments[0], FRAME_TIME + 11, "100"));
        data.push(quote(&instruments[1], FRAME_TIME + 12, "100.0"));
        let sealed = [
            (FRAME_TIME, FRAME_TIME + 2),
            (FRAME_TIME + 10, FRAME_TIME + 12),
            (FRAME_TIME + 20, FRAME_TIME + 22),
        ];
        verify_scheduling_data_against_sealed_frames(&data, &sealed).unwrap();

        // The last sealed frame bounds the one before it and is never itself consumed.
        let mut beyond = data.clone();
        beyond.push(member_bar(bar_types[0], "100", FRAME_TIME + 20));
        assert!(verify_scheduling_data_against_sealed_frames(&beyond, &sealed).is_err());

        // A sequence with nothing to bound its only frame binds no execution.
        assert!(
            verify_scheduling_data_against_sealed_frames(&data, &[(FRAME_TIME, FRAME_TIME + 2)])
                .is_err()
        );
    }

    /// The executed frame must be the sealed one, and its fills must stay inside it.
    #[rstest::rstest]
    fn executed_schedule_binds_only_to_its_own_sealed_frame() {
        let (_, _, data) = scheduling_fixture();
        // Both Quotes sit on the quote cut's instant, so that is the frame's last liquidity.
        let sealed = [
            (FRAME_TIME, FRAME_TIME + 1),
            (FRAME_TIME + 3, FRAME_TIME + 5),
        ];
        verify_scheduling_data_against_sealed_frames(&data, &sealed).unwrap();

        // A different sealed first frame does not accept these fills.
        assert!(
            verify_scheduling_data_against_sealed_frames(
                &data,
                &[
                    (FRAME_TIME + 1, FRAME_TIME + 2),
                    (FRAME_TIME + 3, FRAME_TIME + 5)
                ],
            )
            .is_err()
        );
        // An EVENT after the sealed frame's last liquidity is outside it.
        assert!(
            verify_scheduling_data_against_sealed_frames(
                &data,
                &[(FRAME_TIME, FRAME_TIME), (FRAME_TIME + 3, FRAME_TIME + 5)],
            )
            .is_err()
        );
        // First-frame liquidity must precede the successor's first BAR.
        assert!(
            verify_scheduling_data_against_sealed_frames(
                &data,
                &[
                    (FRAME_TIME, FRAME_TIME + 1),
                    (FRAME_TIME + 1, FRAME_TIME + 5)
                ],
            )
            .is_err()
        );
        // A bundle with no EVENT has nothing to bind.
        assert!(verify_scheduling_data_against_sealed_frames(&data[0..2], &sealed).is_err());
        assert!(verify_scheduling_data_against_sealed_frames(&[], &[]).is_err());
    }

    #[rstest::rstest]
    fn complete_bar_then_event_schedule_has_stable_census_digest() {
        let (first_instruments, first_bar_types, first_data) = scheduling_fixture();
        let (second_instruments, second_bar_types, second_data) = scheduling_fixture();
        let first = validate_and_digest_scheduling_data(
            &first_data,
            &first_instruments,
            &first_bar_types,
            &[FRAME_TIME],
            FRAME_TIME,
            FRAME_TIME + 3,
        )
        .unwrap();
        let second = validate_and_digest_scheduling_data(
            &second_data,
            &second_instruments,
            &second_bar_types,
            &[FRAME_TIME],
            FRAME_TIME,
            FRAME_TIME + 3,
        )
        .unwrap();
        assert_eq!(first, second);
        assert_ne!(first, [0; 32]);
    }

    #[rstest::rstest]
    fn missing_duplicate_reordered_or_no_liquidity_event_schedule_fails_closed() {
        let (instruments, bar_types, mut missing) = scheduling_fixture();
        missing.pop();
        assert!(
            validate_and_digest_scheduling_data(
                &missing,
                &instruments,
                &bar_types,
                &[FRAME_TIME],
                FRAME_TIME,
                FRAME_TIME + 3
            )
            .is_err()
        );

        let (instruments, bar_types, mut duplicate) = scheduling_fixture();
        duplicate[3] = quote(&instruments[0], FRAME_TIME + 2, "100");
        assert!(
            validate_and_digest_scheduling_data(
                &duplicate,
                &instruments,
                &bar_types,
                &[FRAME_TIME],
                FRAME_TIME,
                FRAME_TIME + 3
            )
            .is_err()
        );

        let (instruments, bar_types, mut reordered) = scheduling_fixture();
        reordered.swap(2, 3);
        assert!(
            validate_and_digest_scheduling_data(
                &reordered,
                &instruments,
                &bar_types,
                &[FRAME_TIME],
                FRAME_TIME,
                FRAME_TIME + 3
            )
            .is_err()
        );

        let (instruments, bar_types, mut no_liquidity) = scheduling_fixture();
        no_liquidity[2] = quote(&instruments[0], FRAME_TIME + 1, "0");
        assert!(
            validate_and_digest_scheduling_data(
                &no_liquidity,
                &instruments,
                &bar_types,
                &[FRAME_TIME],
                FRAME_TIME,
                FRAME_TIME + 3
            )
            .is_err()
        );
    }

    #[rstest::rstest]
    fn engine_ts_init_scheduler_reversal_fails_closed() {
        let (instruments, bar_types, mut data) = scheduling_fixture();
        let Data::Quote(first_event) = &data[2] else {
            panic!("fixture first EVENT")
        };
        data[2] = Data::Quote(QuoteTick::new(
            first_event.instrument_id,
            first_event.bid_price,
            first_event.ask_price,
            first_event.bid_size,
            first_event.ask_size,
            (FRAME_TIME + 1).into(),
            (FRAME_TIME + 10).into(),
        ));
        assert!(
            validate_and_digest_scheduling_data(
                &data,
                &instruments,
                &bar_types,
                &[FRAME_TIME],
                FRAME_TIME,
                FRAME_TIME + 11
            )
            .is_err()
        );
    }

    fn funding_schedule(
        start_ns: u64,
        end_ns_exclusive: u64,
        members: &[String],
    ) -> ReplayFundingScheduleV1 {
        use vibe_data::owner::replay_funding_schedule_v1::{
            FundingSettlementV1, MemberFundingScheduleV1,
        };

        ReplayFundingScheduleV1::new(
            start_ns,
            end_ns_exclusive,
            members
                .iter()
                .map(|member| {
                    MemberFundingScheduleV1::new(
                        member.clone(),
                        vec![FundingSettlementV1::new(
                            start_ns,
                            rust_decimal::Decimal::new(1, 4),
                        )],
                    )
                })
                .collect(),
        )
        .unwrap()
    }

    /// The run's members, as the schedule orders them: by instrument, not by member ordinal.
    fn sorted_members(instrument_ids: &[InstrumentId]) -> Vec<String> {
        let mut members = instrument_ids
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        members.sort_unstable();
        members
    }

    #[rstest::rstest]
    fn a_bundle_without_a_funding_schedule_states_funding_not_stated() {
        let ids = instruments().map(|instrument| instrument.id());

        assert_eq!(
            state_funding_schedule(None, &ids, FRAME_TIME, FRAME_TIME + 3).unwrap(),
            ReplayFundingStatementV1::FundingNotStated
        );
        assert_eq!(
            serde_json::to_value(ReplayFundingStatementV1::FundingNotStated).unwrap(),
            serde_json::json!({"statement": "FUNDING_NOT_STATED"})
        );
    }

    #[rstest::rstest]
    fn a_funding_schedule_of_the_runs_window_and_members_is_stated_by_its_digest() {
        let ids = instruments().map(|instrument| instrument.id());
        let schedule = funding_schedule(FRAME_TIME, FRAME_TIME + 3, &sorted_members(&ids));

        assert_eq!(
            state_funding_schedule(Some(&schedule), &ids, FRAME_TIME, FRAME_TIME + 3).unwrap(),
            ReplayFundingStatementV1::Stated {
                schedule_digest: schedule.digest()
            }
        );
    }

    #[rstest::rstest]
    fn a_funding_schedule_of_another_window_or_member_set_is_refused_by_name() {
        let ids = instruments().map(|instrument| instrument.id());
        let members = sorted_members(&ids);
        let later = funding_schedule(FRAME_TIME, FRAME_TIME + 4, &members);
        let one_member = funding_schedule(FRAME_TIME, FRAME_TIME + 3, &members[..1]);

        let window = state_funding_schedule(Some(&later), &ids, FRAME_TIME, FRAME_TIME + 3)
            .unwrap_err()
            .to_string();
        let member_set =
            state_funding_schedule(Some(&one_member), &ids, FRAME_TIME, FRAME_TIME + 3)
                .unwrap_err()
                .to_string();

        assert!(window.starts_with("FUNDING_SCHEDULE_WINDOW_NOT_THE_RUNS"));
        assert!(member_set.starts_with("FUNDING_SCHEDULE_MEMBERS_NOT_THE_RUNS"));
    }
}
