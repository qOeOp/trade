//! Request-bound, move-only inputs for one complete target-set Sim EVENT execution.
//!
//! This boundary validates the complete Owner frame, native member set, scheduling order, Plan,
//! Artifact, account, and economic terms before any `ProgramHostV2` or Backtest engine is retained.
//! After admission, the caller can move only this opaque bundle into the consumer; there is no API
//! for appending or replacing instruments or scheduling data.

use sha2::{Digest, Sha256};
use strategy_factory_program_sdk::lifecycle_v2::TARGET_SET_MEMBER_COUNT;
use vibe_data::owner::instrument_master_v2::ValidatedCryptoPerpetualPublicTermsV2;
use vibe_data::owner::native_replay_scheduling_v1::NativeReplaySchedulingReadbackV1;
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
};

const SCHEDULING_DIGEST_DOMAIN_V1: &[u8] = b"strategy-factory.replay-target-set-scheduling.v1\0";
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
    pub(crate) event_time_ns: i128,
    pub(crate) valid_from_ns: i128,
    pub(crate) valid_until_ns_exclusive: i128,
    pub(crate) margin_model: String,
    pub(crate) maker_fee: ReplayFixedDecimalV1,
    pub(crate) taker_fee: ReplayFixedDecimalV1,
    pub(crate) initial_margin: ReplayFixedDecimalV1,
    pub(crate) maintenance_margin: ReplayFixedDecimalV1,
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
    pub(crate) universe_frame_digest: [u8; 32],
    pub(crate) universe_selection_identity: [u8; 32],
    pub(crate) universe_selection_digest: [u8; 32],
    pub(crate) observation_batch_digest: [u8; 32],
    pub(crate) member_instruments: [String; TARGET_SET_MEMBER_COUNT],
    pub(crate) instrument_terms: [ReplayTargetSetInstrumentCensusV1; TARGET_SET_MEMBER_COUNT],
    pub(crate) owner_scheduling_receipt_digest: Option<[u8; 32]>,
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

    #[must_use]
    pub const fn universe_frame_digest(&self) -> [u8; 32] {
        self.universe_frame_digest
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
    pub const fn observation_batch_digest(&self) -> [u8; 32] {
        self.observation_batch_digest
    }

    #[must_use]
    pub fn member_instruments(&self) -> &[String; TARGET_SET_MEMBER_COUNT] {
        &self.member_instruments
    }

    #[must_use]
    pub fn instrument_fact_digests(&self) -> [[u8; 32]; TARGET_SET_MEMBER_COUNT] {
        self.instrument_terms
            .each_ref()
            .map(ReplayTargetSetInstrumentCensusV1::instrument_fact_digest)
    }

    #[must_use]
    pub fn instrument_receipt_digests(&self) -> [[u8; 32]; TARGET_SET_MEMBER_COUNT] {
        self.instrument_terms
            .each_ref()
            .map(ReplayTargetSetInstrumentCensusV1::instrument_receipt_digest)
    }

    #[must_use]
    pub const fn instrument_terms(
        &self,
    ) -> &[ReplayTargetSetInstrumentCensusV1; TARGET_SET_MEMBER_COUNT] {
        &self.instrument_terms
    }

    #[must_use]
    pub const fn scheduling_data_digest(&self) -> [u8; 32] {
        self.scheduling_data_digest
    }

    #[must_use]
    pub const fn owner_scheduling_receipt_digest(&self) -> Option<[u8; 32]> {
        self.owner_scheduling_receipt_digest
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
    pub(crate) universe_frame: StrategyInputUniverseFrameReceipt,
    pub(crate) native_profile: ReplayNativeExecutionProfileV1,
    pub(crate) account_scope_id: AccountId,
    pub(crate) strategy_id: StrategyId,
    pub(crate) run_id: String,
    pub(crate) instruments: [InstrumentAny; TARGET_SET_MEMBER_COUNT],
    pub(crate) bar_types: [BarType; TARGET_SET_MEMBER_COUNT],
    pub(crate) data: Vec<Data>,
    pub(crate) census: ReplayTargetSetExecutionCensusV1,
}

impl ReplayTargetSetExecutionBundleV1 {
    /// Returns the exact four-field R&D request locator embedded in this move-only capability.
    #[must_use]
    pub const fn request_locator(&self) -> &ExploratoryReplayRequestLocatorV2 {
        self.census.request_locator()
    }

    /// Consumes one Owner-issued dual-profile authority and admits an exact complete execution.
    ///
    /// # Errors
    ///
    /// Returns before a capability exists when any profile seal, Plan/Artifact/frame binding,
    /// member, account, economic term, BAR signal, or later EVENT input is missing or mismatched.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        authority: OwnerIssuedReplayExecutionProfileBindingV1,
        plan: StrategyPlanV2,
        artifact: StrategyArtifactV2,
        universe_frame: StrategyInputUniverseFrameReceipt,
        strategy_id: StrategyId,
        run_id: String,
        public_terms: [ValidatedCryptoPerpetualPublicTermsV2; TARGET_SET_MEMBER_COUNT],
        scheduling: NativeReplaySchedulingReadbackV1,
    ) -> anyhow::Result<Self> {
        let instruments = materialize_crypto_perpetual_target_set_v2(
            authority.execution_profile_binding(),
            public_terms,
        )?;
        let request_window = authority.request_window();
        let instrument_ids = instruments.each_ref().map(Instrument::id);
        anyhow::ensure!(
            scheduling.member_instruments() == instrument_ids
                && scheduling.frame_time_ns() == request_window.start_event_ns
                && scheduling.window_end_ns_exclusive() == request_window.end_event_ns_exclusive
                && *scheduling.observation_batch_digest().as_bytes()
                    == *universe_frame
                        .selection()
                        .observation_batch_digest()
                        .as_bytes(),
            "request execution bundle scheduling authority mismatches Owner inputs"
        );
        let owner_scheduling_receipt_digest = Some(*scheduling.receipt_digest().as_bytes());
        let (bar_types, data) = scheduling.into_native_schedule();
        Self::new_with_native_instruments(
            authority,
            plan,
            artifact,
            universe_frame,
            strategy_id,
            run_id,
            instruments,
            bar_types,
            data,
            owner_scheduling_receipt_digest,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn new_with_native_instruments(
        authority: OwnerIssuedReplayExecutionProfileBindingV1,
        plan: StrategyPlanV2,
        artifact: StrategyArtifactV2,
        universe_frame: StrategyInputUniverseFrameReceipt,
        strategy_id: StrategyId,
        run_id: String,
        instruments: [InstrumentAny; TARGET_SET_MEMBER_COUNT],
        bar_types: [BarType; TARGET_SET_MEMBER_COUNT],
        data: Vec<Data>,
        owner_scheduling_receipt_digest: Option<[u8; 32]>,
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
        let admitted = admit_market_data_universe_program_event_v2(&plan, &universe_frame)?;
        anyhow::ensure!(
            matches!(
                universe_frame.trigger().lifecycle().kind(),
                StrategyInputEventKind::Bar
            ),
            "request execution bundle requires one complete Owner BAR frame"
        );

        let instrument_ids = instruments.each_ref().map(Instrument::id);
        anyhow::ensure!(
            universe_frame.selection().members().len() == TARGET_SET_MEMBER_COUNT
                && universe_frame
                    .selection()
                    .members()
                    .iter()
                    .zip(instrument_ids)
                    .all(|(member, instrument)| member.instrument() == instrument.to_string()),
            "request execution bundle member set mismatches the Owner universe"
        );
        let expected_values = plan
            .input_roles()
            .len()
            .checked_mul(TARGET_SET_MEMBER_COUNT)
            .ok_or_else(|| anyhow::anyhow!("request execution bundle value census overflows"))?;
        anyhow::ensure!(
            universe_frame.values().len() == expected_values,
            "request execution bundle has an incomplete Owner universe frame"
        );
        let frame_time = admitted.envelope().order_key.logical_time_ns;
        let plan_digest = *plan.canonical_plan_digest().as_bytes();
        let artifact_digest = *artifact.identity().as_bytes();
        let selection_identity = *universe_frame.selection().selection_identity().as_bytes();
        let selection_digest = *universe_frame.selection().selection_digest().as_bytes();
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
            frame_time,
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
            universe_frame_digest: *universe_frame.digest().as_bytes(),
            universe_selection_identity: *universe_frame
                .selection()
                .selection_identity()
                .as_bytes(),
            universe_selection_digest: *universe_frame.selection().selection_digest().as_bytes(),
            observation_batch_digest: *universe_frame
                .selection()
                .observation_batch_digest()
                .as_bytes(),
            member_instruments: instruments
                .each_ref()
                .map(|instrument| instrument.id().to_string()),
            instrument_terms: native_profile
                .instrument_terms()
                .each_ref()
                .map(ReplayTargetSetInstrumentCensusV1::from),
            owner_scheduling_receipt_digest,
            scheduling_data_digest,
            scheduling_data_count: u64::try_from(data.len())?,
            bar_count: u64::try_from(TARGET_SET_MEMBER_COUNT)?,
            event_count: u64::try_from(TARGET_SET_MEMBER_COUNT)?,
            census_digest: [0; 32],
        };
        census.census_digest = digest_census(&census)?;
        Ok(Self {
            plan,
            artifact,
            universe_frame,
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
    pub(crate) fn new_with_native_instruments_for_test(
        authority: OwnerIssuedReplayExecutionProfileBindingV1,
        plan: StrategyPlanV2,
        artifact: StrategyArtifactV2,
        universe_frame: StrategyInputUniverseFrameReceipt,
        strategy_id: StrategyId,
        run_id: String,
        instruments: [InstrumentAny; TARGET_SET_MEMBER_COUNT],
        bar_types: [BarType; TARGET_SET_MEMBER_COUNT],
        data: Vec<Data>,
    ) -> anyhow::Result<Self> {
        Self::new_with_native_instruments(
            authority,
            plan,
            artifact,
            universe_frame,
            strategy_id,
            run_id,
            instruments,
            bar_types,
            data,
            None,
        )
    }
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
        census.universe_frame_digest,
        census.universe_selection_identity,
        census.universe_selection_digest,
        census.observation_batch_digest,
        census.scheduling_data_digest,
    ] {
        hasher.update(digest);
    }
    if let Some(digest) = census.owner_scheduling_receipt_digest {
        hasher.update(b"OWNER_SCHEDULING_V1\0");
        hasher.update(digest);
    }
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

fn validate_and_digest_scheduling_data(
    data: &[Data],
    instruments: &[InstrumentAny; TARGET_SET_MEMBER_COUNT],
    bar_types: &[BarType; TARGET_SET_MEMBER_COUNT],
    frame_time: u64,
    window_start_event_ns: u64,
    window_end_event_ns_exclusive: u64,
) -> anyhow::Result<[u8; 32]> {
    let [
        Data::Bar(first_bar),
        Data::Bar(second_bar),
        Data::Quote(first_event),
        Data::Quote(second_event),
    ] = data
    else {
        anyhow::bail!(
            "request execution bundle requires two canonical BAR signals followed by two Quote EVENTs"
        );
    };
    let bars = [first_bar, second_bar];
    let events = [first_event, second_event];
    anyhow::ensure!(
        window_start_event_ns < window_end_event_ns_exclusive
            && data
                .iter()
                .all(|value| value.ts_init().as_u64() >= window_start_event_ns),
        "request execution bundle scheduling data is outside the Owner request window"
    );
    for ordinal in 0..TARGET_SET_MEMBER_COUNT {
        let instrument_id = instruments[ordinal].id();
        anyhow::ensure!(
            bars[ordinal].bar_type == bar_types[ordinal]
                && bars[ordinal].instrument_id() == instrument_id
                && bars[ordinal].ts_event.as_u64() == frame_time
                && bars[ordinal].ts_init.as_u64() == frame_time
                && bars[ordinal].ts_event.as_u64() >= window_start_event_ns
                && bars[ordinal].ts_event.as_u64() < window_end_event_ns_exclusive,
            "request execution bundle BAR scheduling order or time mismatches"
        );
        anyhow::ensure!(
            events[ordinal].instrument_id == instrument_id
                && events[ordinal].ts_event.as_u64() > frame_time
                && events[ordinal].ts_event.as_u64() >= window_start_event_ns
                && events[ordinal].ts_event.as_u64() < window_end_event_ns_exclusive
                && events[ordinal].ts_init.as_u64() >= events[ordinal].ts_event.as_u64()
                && events[ordinal].bid_size.as_decimal() > rust_decimal::Decimal::ZERO
                && events[ordinal].ask_size.as_decimal() > rust_decimal::Decimal::ZERO,
            "request execution bundle EVENT scheduling order, time, or liquidity mismatches"
        );
    }
    anyhow::ensure!(
        events[0].ts_event < events[1].ts_event,
        "request execution bundle EVENT order is not canonical"
    );
    anyhow::ensure!(
        data.windows(2)
            .all(|pair| pair[0].ts_init() <= pair[1].ts_init()),
        "request execution bundle order changes under Backtest ts_init scheduling"
    );

    let mut hasher = Sha256::new();
    hasher.update(SCHEDULING_DIGEST_DOMAIN_V1);
    hasher.update((data.len() as u64).to_be_bytes());
    for bar in bars {
        digest_bar(&mut hasher, bar)?;
    }
    for event in events {
        digest_quote(&mut hasher, event)?;
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

    fn scheduling_fixture() -> (
        [InstrumentAny; TARGET_SET_MEMBER_COUNT],
        [BarType; TARGET_SET_MEMBER_COUNT],
        Vec<Data>,
    ) {
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

    #[test]
    fn complete_bar_then_event_schedule_has_stable_census_digest() {
        let (first_instruments, first_bar_types, first_data) = scheduling_fixture();
        let (second_instruments, second_bar_types, second_data) = scheduling_fixture();
        let first = validate_and_digest_scheduling_data(
            &first_data,
            &first_instruments,
            &first_bar_types,
            FRAME_TIME,
            FRAME_TIME,
            FRAME_TIME + 3,
        )
        .unwrap();
        let second = validate_and_digest_scheduling_data(
            &second_data,
            &second_instruments,
            &second_bar_types,
            FRAME_TIME,
            FRAME_TIME,
            FRAME_TIME + 3,
        )
        .unwrap();
        assert_eq!(first, second);
        assert_ne!(first, [0; 32]);
    }

    #[test]
    fn missing_duplicate_reordered_or_no_liquidity_event_schedule_fails_closed() {
        let (instruments, bar_types, mut missing) = scheduling_fixture();
        missing.pop();
        assert!(
            validate_and_digest_scheduling_data(
                &missing,
                &instruments,
                &bar_types,
                FRAME_TIME,
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
                FRAME_TIME,
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
                FRAME_TIME,
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
                FRAME_TIME,
                FRAME_TIME,
                FRAME_TIME + 3
            )
            .is_err()
        );
    }

    #[test]
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
                FRAME_TIME,
                FRAME_TIME,
                FRAME_TIME + 11
            )
            .is_err()
        );
    }
}
