//! Request-bound, move-only inputs for one complete target-set Sim EVENT execution.
//!
//! This boundary validates the complete Owner frame, native member set, scheduling order, Plan,
//! Artifact, account, and economic terms before any `ProgramHostV2` or Backtest engine is retained.
//! After admission, the caller can move only this opaque bundle into the consumer; there is no API
//! for appending or replacing instruments or scheduling data.

use sha2::{Digest, Sha256};
use vibe_data::owner::instrument_master_v2::ValidatedCryptoPerpetualPublicTermsV2;
use vibe_data::owner::native_replay_scheduling_v1::NativeReplaySchedulingReadbackV1;
use vibe_data::owner::native_replay_scheduling_v2::NativeReplayFrameSequenceReadbackV2;
use vibe_data::owner::strategy_input_binding::{
    StrategyInputEventKind, StrategyInputUniverseFrameReceipt,
};
use vibe_model::{
    data::{Bar, BarType, Data, HasTsInit, QuoteTick},
    identifiers::{AccountId, StrategyId},
    instruments::{Instrument, InstrumentAny},
};

use crate::{
    artifact_v2::StrategyArtifactV2,
    exploratory_replay::ExploratoryReplayRequestLocatorV2,
    native_replay_execution_input_binding_v2::NativeReplayExecutionInputBindingReadbackV2,
    program_host_v2::admit_market_data_universe_program_event_v2,
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
    target_set_members::{BoundedMembers, is_admitted_member_count},
};

const SCHEDULING_DIGEST_DOMAIN_V1: &[u8] = b"strategy-factory.replay-target-set-scheduling.v1\0";
const FRAME_SEQUENCE_DIGEST_DOMAIN_V1: &[u8] =
    b"vibe.replay.target-set-execution-frame-sequence.v1\0";
const CENSUS_DIGEST_DOMAIN_V1: &[u8] = b"strategy-factory.replay-target-set-execution-census.v1\0";

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
    pub(crate) scheduling_data_digest: [u8; 32],
    pub(crate) scheduling_data_count: u64,
    pub(crate) bar_count: u64,
    pub(crate) event_count: u64,
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

    #[must_use]
    pub const fn census_digest(&self) -> [u8; 32] {
        self.census_digest
    }
}

/// Opaque move-only capability for one exact request and one complete two-member execution.
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
    pub(crate) universe_frames: Vec<StrategyInputUniverseFrameReceipt>,
    pub(crate) native_profile: ReplayNativeExecutionProfileV1,
    pub(crate) account_scope_id: AccountId,
    pub(crate) strategy_id: StrategyId,
    pub(crate) run_id: String,
    pub(crate) instruments: BoundedMembers<InstrumentAny>,
    pub(crate) bar_types: BoundedMembers<BarType>,
    pub(crate) data: Vec<Data>,
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
        universe_frames: Vec<StrategyInputUniverseFrameReceipt>,
        strategy_id: StrategyId,
        run_id: String,
        public_terms: Vec<ValidatedCryptoPerpetualPublicTermsV2>,
        sequence: NativeReplayFrameSequenceReadbackV2,
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
                frame.member_instruments().as_slice() == &*instrument_ids
                    && frame.window_end_ns_exclusive() == request_window.end_event_ns_exclusive
                    && *frame.observation_batch_digest().as_bytes()
                        == *universe_frame
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
        universe_frame: StrategyInputUniverseFrameReceipt,
        strategy_id: StrategyId,
        run_id: String,
        public_terms: Vec<ValidatedCryptoPerpetualPublicTermsV2>,
        scheduling: NativeReplaySchedulingReadbackV1,
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
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn new_with_native_instruments(
        authority: OwnerIssuedReplayExecutionProfileBindingV1,
        plan: StrategyPlanV2,
        artifact: StrategyArtifactV2,
        universe_frames: Vec<StrategyInputUniverseFrameReceipt>,
        strategy_id: StrategyId,
        run_id: String,
        instruments: BoundedMembers<InstrumentAny>,
        bar_types: BoundedMembers<BarType>,
        data: Vec<Data>,
        frame_times: &[u64],
        owner_scheduling_receipt_digests: &[[u8; 32]],
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

        for universe_frame in &universe_frames {
            let admitted = admit_market_data_universe_program_event_v2(&plan, universe_frame)?;
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
        }
        // The two sides are paired, not merely equal in length: a universe receipt admitted at one
        // instant paired with a schedule for another instant is two different frames wearing one
        // ordinal, and every per-frame check below would still pass.
        anyhow::ensure!(
            admitted_frame_times == frame_times,
            "request execution bundle universe frames and schedules are admitted at different instants"
        );
        let frame_time = frame_times[0];
        let plan_digest = *plan.canonical_plan_digest().as_bytes();
        let artifact_digest = *artifact.identity().as_bytes();
        // The request pins one universe selection for the whole window, so the series' selection
        // is the first frame's and every later frame was checked against the same member set.
        let first_frame = &universe_frames[0];
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
        anyhow::ensure!(
            authority.request_universe_selection_identity()
                == canonical_digest_text("blake3", selection_identity)
                && authority.request_universe_selection_digest() == selection_digest,
            "request execution bundle universe selection mismatches Owner request authority"
        );
        let request_window = authority.request_window();
        anyhow::ensure!(
            frame_time == request_window.start_event_ns,
            "request execution bundle frame time mismatches Owner request window"
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
            scheduling_data_digest,
            scheduling_data_count: u64::try_from(data.len())?,
            bar_count: u64::try_from(instruments.len() * universe_frames.len())?,
            event_count: u64::try_from(instruments.len() * universe_frames.len())?,
            census_digest: [0; 32],
        };
        census.census_digest = digest_census(&census)?;
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
        universe_frames: Vec<StrategyInputUniverseFrameReceipt>,
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
    universe_frames: &[StrategyInputUniverseFrameReceipt],
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

fn digest_census(census: &ReplayTargetSetExecutionCensusV1) -> anyhow::Result<[u8; 32]> {
    let mut hasher = Sha256::new();
    hasher.update(CENSUS_DIGEST_DOMAIN_V1);

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
    hasher.update(census.scheduling_data_count.to_be_bytes());
    hasher.update(census.bar_count.to_be_bytes());
    hasher.update(census.event_count.to_be_bytes());
    Ok(hasher.finalize().into())
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

        for ordinal in 0..member_count {
            let instrument_id = instruments[ordinal].id();
            anyhow::ensure!(
                bars[ordinal].bar_type == bar_types[ordinal]
                    && bars[ordinal].instrument_id() == instrument_id
                    && bars[ordinal].ts_event.as_u64() == *frame_time
                    && bars[ordinal].ts_init.as_u64() == *frame_time
                    && bars[ordinal].ts_event.as_u64() >= window_start_event_ns
                    && bars[ordinal].ts_event.as_u64() < window_end_event_ns_exclusive,
                "request execution bundle BAR scheduling order or time mismatches"
            );
            anyhow::ensure!(
                events[ordinal].instrument_id == instrument_id
                    && events[ordinal].ts_event.as_u64() > *frame_time
                    && events[ordinal].ts_event.as_u64() >= window_start_event_ns
                    && events[ordinal].ts_event.as_u64() < window_end_event_ns_exclusive
                    && events[ordinal].ts_init.as_u64() >= events[ordinal].ts_event.as_u64()
                    && events[ordinal].bid_size.as_decimal() > rust_decimal::Decimal::ZERO
                    && events[ordinal].ask_size.as_decimal() > rust_decimal::Decimal::ZERO,
                "request execution bundle EVENT scheduling order, time, or liquidity mismatches"
            );
        }
        anyhow::ensure!(
            events
                .windows(2)
                .all(|pair| pair[0].ts_event < pair[1].ts_event),
            "request execution bundle EVENT order is not canonical"
        );
    }
    // Frames that do not advance are refused here rather than by a rule of their own: every round
    // stamps its BARs at its frame time, so a frame that did not advance puts a BAR before the
    // previous round's EVENTs and breaks this order. A separate frame-time comparison was written
    // first and removed, because mutation testing showed it could be deleted with no test noticing:
    // it could never fire on its own.
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
            quote(&instruments[0], FRAME_TIME + 1, "100"),
            quote(&instruments[1], FRAME_TIME + 2, "100.0"),
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
        data.push(quote(&instruments[1], SECOND_FRAME_TIME + 2, "100.0"));
        (
            instruments,
            bar_types,
            data,
            vec![FRAME_TIME, SECOND_FRAME_TIME],
        )
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
        dry[7] = quote(&instruments[1], SECOND_FRAME_TIME + 2, "0");
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
        data[7] = quote(&instruments[1], FRAME_TIME + 2, "100.0");
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
        let sealed = [
            (FRAME_TIME, FRAME_TIME + 2),
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
                &[
                    (FRAME_TIME, FRAME_TIME + 1),
                    (FRAME_TIME + 3, FRAME_TIME + 5)
                ],
            )
            .is_err()
        );
        // First-frame liquidity must precede the successor's first BAR.
        assert!(
            verify_scheduling_data_against_sealed_frames(
                &data,
                &[
                    (FRAME_TIME, FRAME_TIME + 2),
                    (FRAME_TIME + 2, FRAME_TIME + 5)
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
}
