//! Cross-binding and fail-closed preflight for the two Replay execution-profile seals.
//!
//! This module exposes no engine constructor and no admitted result. A complete binding privately
//! retains the exact Instrument Owner terms needed by the native materializer, while preflight
//! remains unavailable until the real `ProgramHostV2` to Sim Exchange EVENT consumer exists.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use strategy_factory_program_sdk::lifecycle_v2::TARGET_SET_MEMBER_COUNT;
use thiserror::Error;
use vibe_backtest_owner_contracts::ReplayWindowV2;
use vibe_data::owner::instrument_economic_terms_v1::{
    InstrumentEconomicAccountApplicabilityV1, InstrumentEconomicTermsReadbackV1,
    InstrumentMarginMeaningV1,
};

use crate::{
    exploratory_replay::{ExploratoryReplayRequestLocatorV2, SealedExploratoryReplayReadbackV2},
    replay_economic_configuration_v1::{
        InstrumentEconomicTermsBindingV1, ReplayEconomicConfigurationV1,
    },
    replay_runner_operational_profile_v1::ReplayRunnerOperationalProfileV1,
    trial_family::{TrialFamilyReadbackV1, verify_family},
};

/// Replay execution-profile family/request binding schema version.
pub const REPLAY_EXECUTION_PROFILE_BINDING_SCHEMA_VERSION_V1: u16 = 1;
const PROFILE_BINDING_DIGEST_DOMAIN_V1: &[u8] =
    b"strategy-factory.replay-execution-profile-binding.v1\0";
const MAX_IDENTITY_BYTES_V1: usize = 256;

/// TrialFamily-owned choice of the two exact profile contents.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayExecutionProfileFamilyBindingV1 {
    pub schema_version: u16,
    pub trial_family_identity: String,
    pub trial_family_digest: [u8; 32],
    pub economic_configuration_digest: [u8; 32],
    pub runner_operational_profile_digest: [u8; 32],
}

/// Request-owned repetition of the exact TrialFamily and two profile contents.
///
/// This remains a standalone V1 binding so the existing Replay V2 request codec and custody are
/// unchanged. It is not a replacement request DTO or an execution receipt.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayExecutionProfileRequestBindingV1 {
    pub schema_version: u16,
    pub request_identity: String,
    pub request_meaning_digest: [u8; 32],
    pub trial_family_identity: String,
    pub trial_family_digest: [u8; 32],
    pub economic_configuration_digest: [u8; 32],
    pub runner_operational_profile_digest: [u8; 32],
}

/// Additive seal repeated by the frozen Replay request, receipt, and outbox.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ReplayExecutionProfileRequestSealV1 {
    schema_version: u16,
    request: ReplayExecutionProfileRequestBindingV1,
    catalog_v3_binding_digest: [u8; 32],
    family_profile_binding_digest: [u8; 32],
    request_profile_binding_digest: [u8; 32],
}

impl ReplayExecutionProfileRequestSealV1 {
    pub(crate) fn issue(
        family: &TrialFamilyReadbackV1,
        request_identity: &str,
        request_meaning_digest: &str,
    ) -> Result<Self, ReplayExecutionProfileBindingErrorV1> {
        verify_family(family)
            .map_err(|_| ReplayExecutionProfileBindingErrorV1::OwnerAuthorityUnavailable)?;
        let root = family.root();
        let catalog_v3 = root
            .policy()
            .replay_policy_catalog_v3()
            .ok_or(ReplayExecutionProfileBindingErrorV1::OwnerAuthorityUnavailable)?;
        let (economic, runner) = catalog_v3
            .verify()
            .map_err(|_| ReplayExecutionProfileBindingErrorV1::OwnerAuthorityUnavailable)?;
        if root.policy().replay_execution_policy_v2() != Some(catalog_v3.replay_policy_v2()) {
            return Err(ReplayExecutionProfileBindingErrorV1::OwnerAuthorityUnavailable);
        }
        let family_digest = decode_canonical_digest(root.root_digest())?;
        let request = ReplayExecutionProfileRequestBindingV1 {
            schema_version: REPLAY_EXECUTION_PROFILE_BINDING_SCHEMA_VERSION_V1,
            request_identity: request_identity.to_owned(),
            request_meaning_digest: decode_canonical_digest(request_meaning_digest)?,
            trial_family_identity: root.trial_family_identity().to_owned(),
            trial_family_digest: family_digest,
            economic_configuration_digest: economic.digest(),
            runner_operational_profile_digest: runner.digest(),
        };
        let family_binding = ReplayExecutionProfileFamilyBindingV1 {
            schema_version: REPLAY_EXECUTION_PROFILE_BINDING_SCHEMA_VERSION_V1,
            trial_family_identity: root.trial_family_identity().to_owned(),
            trial_family_digest: family_digest,
            economic_configuration_digest: economic.digest(),
            runner_operational_profile_digest: runner.digest(),
        };
        validate_schema_and_identity(&family_binding, &request)?;
        let family_profile_binding_digest =
            family_profile_binding_digest(&family_binding, catalog_v3.binding_digest())?;
        let request_profile_binding_digest =
            request_profile_binding_digest(&request, family_profile_binding_digest)?;
        Ok(Self {
            schema_version: REPLAY_EXECUTION_PROFILE_BINDING_SCHEMA_VERSION_V1,
            request,
            catalog_v3_binding_digest: catalog_v3.binding_digest(),
            family_profile_binding_digest,
            request_profile_binding_digest,
        })
    }

    pub(crate) fn verify_for_family(
        &self,
        family: &TrialFamilyReadbackV1,
        request_identity: &str,
        request_meaning_digest: &str,
    ) -> Result<(), ReplayExecutionProfileBindingErrorV1> {
        let expected = Self::issue(family, request_identity, request_meaning_digest)?;
        if self != &expected {
            return Err(ReplayExecutionProfileBindingErrorV1::ProfileMismatch);
        }
        Ok(())
    }

    pub(crate) fn request_binding(&self) -> &ReplayExecutionProfileRequestBindingV1 {
        &self.request
    }

    pub(crate) const fn family_profile_binding_digest(&self) -> [u8; 32] {
        self.family_profile_binding_digest
    }
}

/// Move-only proof issued by a future Strategy Factory-private adapter from sealed Instrument
/// Owner readback.
///
/// It has no public constructor and no serialization surface. A caller-visible economic profile
/// cannot manufacture the authority needed to accept maker/taker fees or margin values.
///
/// ```compile_fail
/// use vibe_strategy_factory::replay_execution_profile_binding_v1::SealedInstrumentEconomicTermsProvenanceV1;
/// let forged = SealedInstrumentEconomicTermsProvenanceV1 {};
/// ```
///
/// ```compile_fail
/// use vibe_strategy_factory::replay_execution_profile_binding_v1::SealedInstrumentEconomicTermsProvenanceV1;
/// fn require_clone<T: Clone>() {}
/// require_clone::<SealedInstrumentEconomicTermsProvenanceV1>();
/// ```
pub struct SealedInstrumentEconomicTermsProvenanceV1 {
    instrument_identity: String,
    instrument_fact_digest: [u8; 32],
    instrument_receipt_digest: [u8; 32],
    terms_digest: [u8; 32],
    economic_configuration_digest: [u8; 32],
    venue_identity: String,
    quote_currency: String,
    account_scope_identity: String,
    event_time_ns: i128,
    valid_from_ns: i128,
    valid_until_ns_exclusive: i128,
    margin_model: InstrumentMarginModelSelectionV1,
    maker_fee: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1,
    taker_fee: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1,
    initial_margin: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1,
    maintenance_margin: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1,
}

/// Exact native margin implementation selected by verified Owner meaning.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstrumentMarginModelSelectionV1 {
    StandardMarginModel,
}

/// Request coordinates which must be covered by the private Owner fact.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InstrumentEconomicTermsConsumptionContextV1<'a> {
    pub venue_identity: &'a str,
    pub account_scope_identity: &'a str,
    pub event_time_ns: i128,
}

/// Mints move-only provenance solely from a verified Instrument Owner exact-locator readback.
///
/// The visible economic configuration is compared field-for-field but is never evidence. V1
/// accepts only fixed notional rates and maps that meaning explicitly to `StandardMarginModel`.
///
/// # Errors
///
/// Returns before provenance exists for invalid custody, identity, venue, account, time, currency,
/// value, receipt, or margin meaning.
pub fn seal_instrument_economic_terms_provenance_v1(
    readback: &InstrumentEconomicTermsReadbackV1,
    economic: &ReplayEconomicConfigurationV1,
    context: InstrumentEconomicTermsConsumptionContextV1<'_>,
) -> Result<SealedInstrumentEconomicTermsProvenanceV1, ReplayExecutionProfileBindingErrorV1> {
    let provenance = seal_target_set_member_instrument_economic_terms_provenance_v1(
        readback, economic, context,
    )?;
    let expected = &economic.input().instrument_terms;
    if provenance.instrument_identity != expected.instrument_identity
        || provenance.instrument_fact_digest != expected.instrument_fact_digest
        || provenance.instrument_receipt_digest != expected.instrument_receipt_digest
        || provenance.terms_digest != instrument_terms_digest(expected)?
        || provenance.quote_currency != expected.quote_currency
        || provenance.maker_fee != expected.maker_fee
        || provenance.taker_fee != expected.taker_fee
        || provenance.initial_margin != expected.initial_margin
        || provenance.maintenance_margin != expected.maintenance_margin
    {
        return Err(ReplayExecutionProfileBindingErrorV1::InstrumentTermsProvenanceMismatch);
    }
    Ok(provenance)
}

/// Mints one member of the complete target-set terms capability from verified Owner readback.
///
/// Unlike the legacy primary-member helper, this function does not compare the Owner fact to the
/// profile's caller-visible primary instrument. The verified readback is authoritative for the
/// additional member; its exact terms are retained privately and joined into the profile binding.
///
/// # Errors
///
/// Returns before provenance exists for invalid custody, venue, account, time, currency, receipt,
/// or margin meaning.
pub fn seal_target_set_member_instrument_economic_terms_provenance_v1(
    readback: &InstrumentEconomicTermsReadbackV1,
    economic: &ReplayEconomicConfigurationV1,
    context: InstrumentEconomicTermsConsumptionContextV1<'_>,
) -> Result<SealedInstrumentEconomicTermsProvenanceV1, ReplayExecutionProfileBindingErrorV1> {
    if !readback.verify() {
        return Err(ReplayExecutionProfileBindingErrorV1::InstrumentTermsProvenanceMismatch);
    }
    let owner = readback.fact().input();
    if context.venue_identity != economic.input().venue_identity
        || owner.venue_identity != context.venue_identity
        || owner.account_scope_identity != context.account_scope_identity
        || owner.account_applicability != InstrumentEconomicAccountApplicabilityV1::MarginAccount
        || context.event_time_ns < owner.valid_from_ns
        || context.event_time_ns >= owner.valid_until_ns_exclusive
        || owner.quote_currency != economic.input().common_quote_currency
        || owner.fee_currency != economic.input().common_quote_currency
        || owner.margin_meaning != InstrumentMarginMeaningV1::StandardNotionalRate
        || owner.instrument_public_fact_digest == [0; 32]
        || readback.receipt_identity() == [0; 32]
    {
        return Err(ReplayExecutionProfileBindingErrorV1::InstrumentTermsProvenanceMismatch);
    }
    let terms = InstrumentEconomicTermsBindingV1 {
        instrument_identity: owner.instrument_identity.clone(),
        quote_currency: owner.quote_currency.clone(),
        instrument_fact_digest: owner.instrument_public_fact_digest,
        instrument_receipt_digest: readback.receipt_identity(),
        maker_fee: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1 {
            mantissa: owner.maker_fee.mantissa,
            scale: owner.maker_fee.scale,
        },
        taker_fee: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1 {
            mantissa: owner.taker_fee.mantissa,
            scale: owner.taker_fee.scale,
        },
        initial_margin: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1 {
            mantissa: owner.initial_margin.mantissa,
            scale: owner.initial_margin.scale,
        },
        maintenance_margin: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1 {
            mantissa: owner.maintenance_margin.mantissa,
            scale: owner.maintenance_margin.scale,
        },
    };
    Ok(SealedInstrumentEconomicTermsProvenanceV1 {
        instrument_identity: owner.instrument_identity.clone(),
        instrument_fact_digest: owner.instrument_public_fact_digest,
        instrument_receipt_digest: readback.receipt_identity(),
        terms_digest: instrument_terms_digest(&terms)?,
        economic_configuration_digest: economic.digest(),
        venue_identity: context.venue_identity.into(),
        quote_currency: owner.quote_currency.clone(),
        account_scope_identity: context.account_scope_identity.into(),
        event_time_ns: context.event_time_ns,
        valid_from_ns: owner.valid_from_ns,
        valid_until_ns_exclusive: owner.valid_until_ns_exclusive,
        margin_model: InstrumentMarginModelSelectionV1::StandardMarginModel,
        maker_fee: terms.maker_fee,
        taker_fee: terms.taker_fee,
        initial_margin: terms.initial_margin,
        maintenance_margin: terms.maintenance_margin,
    })
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) struct BoundInstrumentEconomicTermsV1 {
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
    pub(crate) margin_model: InstrumentMarginModelSelectionV1,
    pub(crate) maker_fee: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1,
    pub(crate) taker_fee: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1,
    pub(crate) initial_margin: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1,
    pub(crate) maintenance_margin: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1,
}

/// Content binding produced before any engine state exists.
#[derive(Debug, Eq, PartialEq)]
pub struct ReplayExecutionProfileBindingV1 {
    request_identity: String,
    request_meaning_digest: [u8; 32],
    economic_configuration_digest: [u8; 32],
    runner_operational_profile_digest: [u8; 32],
    binding_digest: [u8; 32],
    instrument_terms: [BoundInstrumentEconomicTermsV1; TARGET_SET_MEMBER_COUNT],
}

/// Move-only R&D Owner authority for consuming one exact dual-profile Replay request.
///
/// Public family/request binding DTOs remain useful for comparison, but cannot construct this
/// value. The private payload retains the complete verified Instrument Owner terms and can only be
/// transferred as a whole to the Backtest materializer.
pub struct OwnerIssuedReplayExecutionProfileBindingV1 {
    request_locator: ExploratoryReplayRequestLocatorV2,
    trial_family_identity: String,
    trial_family_digest: [u8; 32],
    economic_configuration_canonical_bytes: Vec<u8>,
    economic_configuration_digest: [u8; 32],
    runner_operational_profile_canonical_bytes: Vec<u8>,
    runner_operational_profile_digest: [u8; 32],
    request_strategy_plan_identity: String,
    request_strategy_plan_digest: [u8; 32],
    request_artifact_identity: String,
    request_artifact_digest: [u8; 32],
    request_universe_selection_identity: String,
    request_universe_selection_digest: [u8; 32],
    request_window: ReplayWindowV2,
    authority_digest: [u8; 32],
    execution_profile_binding: ReplayExecutionProfileBindingV1,
}

impl OwnerIssuedReplayExecutionProfileBindingV1 {
    #[must_use]
    pub fn request_locator(&self) -> &ExploratoryReplayRequestLocatorV2 {
        &self.request_locator
    }

    #[must_use]
    pub fn matches_request_locator(&self, locator: &ExploratoryReplayRequestLocatorV2) -> bool {
        &self.request_locator == locator
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
    pub fn economic_configuration_canonical_bytes(&self) -> &[u8] {
        &self.economic_configuration_canonical_bytes
    }

    #[must_use]
    pub const fn economic_configuration_digest(&self) -> [u8; 32] {
        self.economic_configuration_digest
    }

    #[must_use]
    pub fn runner_operational_profile_canonical_bytes(&self) -> &[u8] {
        &self.runner_operational_profile_canonical_bytes
    }

    #[must_use]
    pub const fn runner_operational_profile_digest(&self) -> [u8; 32] {
        self.runner_operational_profile_digest
    }

    pub(crate) fn request_strategy_plan_identity(&self) -> &str {
        &self.request_strategy_plan_identity
    }

    pub(crate) const fn request_strategy_plan_digest(&self) -> [u8; 32] {
        self.request_strategy_plan_digest
    }

    pub(crate) fn request_artifact_identity(&self) -> &str {
        &self.request_artifact_identity
    }

    pub(crate) const fn request_artifact_digest(&self) -> [u8; 32] {
        self.request_artifact_digest
    }

    pub(crate) fn request_universe_selection_identity(&self) -> &str {
        &self.request_universe_selection_identity
    }

    pub(crate) const fn request_universe_selection_digest(&self) -> [u8; 32] {
        self.request_universe_selection_digest
    }

    pub(crate) const fn request_window(&self) -> &ReplayWindowV2 {
        &self.request_window
    }

    #[must_use]
    pub const fn authority_digest(&self) -> [u8; 32] {
        self.authority_digest
    }

    pub(crate) fn into_execution_profile_binding(self) -> ReplayExecutionProfileBindingV1 {
        self.execution_profile_binding
    }
}

/// Issues execution-profile authority solely from verified R&D family and request readbacks.
///
/// Historical families without both canonical profiles are unavailable. The complete request
/// locator, family root, exact profile bytes, and the verified per-member binding digest all enter
/// the authority digest.
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "issued by the separately leased exploratory Replay composition slice"
    )
)]
pub(crate) fn issue_owner_replay_execution_profile_binding_v1(
    family: &TrialFamilyReadbackV1,
    request: &SealedExploratoryReplayReadbackV2,
    instrument_terms: [SealedInstrumentEconomicTermsProvenanceV1; TARGET_SET_MEMBER_COUNT],
) -> Result<OwnerIssuedReplayExecutionProfileBindingV1, ReplayExecutionProfileBindingErrorV1> {
    verify_family(family)
        .map_err(|_| ReplayExecutionProfileBindingErrorV1::OwnerAuthorityUnavailable)?;
    let root = family.root();
    let catalog_v3 = root
        .policy()
        .replay_policy_catalog_v3()
        .ok_or(ReplayExecutionProfileBindingErrorV1::OwnerAuthorityUnavailable)?;
    if root.policy().replay_execution_policy_v2() != Some(catalog_v3.replay_policy_v2()) {
        return Err(ReplayExecutionProfileBindingErrorV1::OwnerAuthorityUnavailable);
    }
    let (economic, runner) = catalog_v3
        .verify()
        .map_err(|_| ReplayExecutionProfileBindingErrorV1::OwnerAuthorityUnavailable)?;

    let locator = request.locator();
    request
        .execution_profile_seal()
        .ok_or(ReplayExecutionProfileBindingErrorV1::OwnerAuthorityUnavailable)?
        .verify_for_family(family, &locator.request_identity, &locator.meaning_digest)?;
    let family_digest = decode_canonical_digest(root.root_digest())?;
    let request_meaning_digest = decode_canonical_digest(request.meaning_digest())?;
    let request_dto = request.request().as_dto();
    let request_family = &request_dto.trial_family;
    if request_family.identity.as_str() != root.trial_family_identity()
        || request_family.digest.as_str() != root.root_digest()
    {
        return Err(ReplayExecutionProfileBindingErrorV1::TrialFamilyMismatch);
    }

    let family_binding = ReplayExecutionProfileFamilyBindingV1 {
        schema_version: REPLAY_EXECUTION_PROFILE_BINDING_SCHEMA_VERSION_V1,
        trial_family_identity: root.trial_family_identity().to_owned(),
        trial_family_digest: family_digest,
        economic_configuration_digest: economic.digest(),
        runner_operational_profile_digest: runner.digest(),
    };
    let request_binding = ReplayExecutionProfileRequestBindingV1 {
        schema_version: REPLAY_EXECUTION_PROFILE_BINDING_SCHEMA_VERSION_V1,
        request_identity: locator.request_identity.clone(),
        request_meaning_digest,
        trial_family_identity: root.trial_family_identity().to_owned(),
        trial_family_digest: family_digest,
        economic_configuration_digest: economic.digest(),
        runner_operational_profile_digest: runner.digest(),
    };
    let execution_profile_binding = bind_replay_execution_profiles_v1(
        &family_binding,
        &request_binding,
        &economic,
        &runner,
        instrument_terms,
    )?;

    let mut hasher = Sha256::new();
    hasher.update(b"rd.owner-issued-replay-execution-profile-binding.v1\0");
    encode_bytes(&mut hasher, locator.request_identity.as_bytes())?;
    encode_bytes(&mut hasher, locator.meaning_digest.as_bytes())?;
    encode_bytes(&mut hasher, locator.receipt_identity.as_bytes())?;
    encode_bytes(&mut hasher, locator.seal_digest.as_bytes())?;
    encode_bytes(&mut hasher, root.trial_family_identity().as_bytes())?;
    hasher.update(family_digest);
    hasher.update(economic.digest());
    encode_bytes(&mut hasher, economic.canonical_bytes())?;
    hasher.update(runner.digest());
    encode_bytes(&mut hasher, runner.canonical_bytes())?;
    let request_strategy_plan_digest =
        decode_canonical_digest(request_dto.strategy_plan.digest.as_str())?;
    let request_artifact_digest = decode_canonical_digest(request_dto.artifact.digest.as_str())?;
    let request_universe_selection_digest =
        decode_canonical_digest(request_dto.universe_selection.digest.as_str())?;
    encode_bytes(
        &mut hasher,
        request_dto.strategy_plan.identity.as_str().as_bytes(),
    )?;
    hasher.update(request_strategy_plan_digest);
    encode_bytes(
        &mut hasher,
        request_dto.artifact.identity.as_str().as_bytes(),
    )?;
    hasher.update(request_artifact_digest);
    encode_bytes(
        &mut hasher,
        request_dto.universe_selection.identity.as_str().as_bytes(),
    )?;
    hasher.update(request_universe_selection_digest);
    hasher.update(request_dto.window.start_event_ns.to_be_bytes());
    hasher.update(request_dto.window.end_event_ns_exclusive.to_be_bytes());
    hasher.update(execution_profile_binding.binding_digest());
    let authority_digest = hasher.finalize().into();

    Ok(OwnerIssuedReplayExecutionProfileBindingV1 {
        request_locator: locator,
        trial_family_identity: root.trial_family_identity().to_owned(),
        trial_family_digest: family_digest,
        economic_configuration_canonical_bytes: economic.canonical_bytes().to_vec(),
        economic_configuration_digest: economic.digest(),
        runner_operational_profile_canonical_bytes: runner.canonical_bytes().to_vec(),
        runner_operational_profile_digest: runner.digest(),
        request_strategy_plan_identity: request_dto.strategy_plan.identity.as_str().to_owned(),
        request_strategy_plan_digest,
        request_artifact_identity: request_dto.artifact.identity.as_str().to_owned(),
        request_artifact_digest,
        request_universe_selection_identity: request_dto
            .universe_selection
            .identity
            .as_str()
            .to_owned(),
        request_universe_selection_digest,
        request_window: request_dto.window.clone(),
        authority_digest,
        execution_profile_binding,
    })
}

/// Issues the profile authority from the exact two Owner terms readbacks retained by Native Replay.
///
/// Venue, account scope, and event time are derived from Owner-held state instead of accepting a
/// second caller-selected context. This remains crate-private so the complete retained preparation
/// cut is the only production composition entrypoint.
pub(crate) fn issue_owner_replay_execution_profile_binding_from_readbacks_v1(
    family: &TrialFamilyReadbackV1,
    request: &SealedExploratoryReplayReadbackV2,
    instrument_terms: [InstrumentEconomicTermsReadbackV1; TARGET_SET_MEMBER_COUNT],
) -> Result<OwnerIssuedReplayExecutionProfileBindingV1, ReplayExecutionProfileBindingErrorV1> {
    let catalog = family
        .root()
        .policy()
        .replay_policy_catalog_v3()
        .ok_or(ReplayExecutionProfileBindingErrorV1::OwnerAuthorityUnavailable)?;
    let (economic, _) = catalog
        .verify()
        .map_err(|_| ReplayExecutionProfileBindingErrorV1::OwnerAuthorityUnavailable)?;
    let account_scope_identity = instrument_terms[0]
        .fact()
        .input()
        .account_scope_identity
        .clone();
    let context = InstrumentEconomicTermsConsumptionContextV1 {
        venue_identity: &economic.input().venue_identity,
        account_scope_identity: &account_scope_identity,
        event_time_ns: i128::from(request.request().as_dto().window.start_event_ns),
    };
    let [first, second] = instrument_terms;
    let provenance = [
        seal_target_set_member_instrument_economic_terms_provenance_v1(&first, &economic, context)?,
        seal_target_set_member_instrument_economic_terms_provenance_v1(
            &second, &economic, context,
        )?,
    ];
    issue_owner_replay_execution_profile_binding_v1(family, request, provenance)
}

/// Test-only entrypoint that exercises the real Owner verification and issuance path.
///
/// It accepts only already issued Owner readbacks/provenance and delegates without synthesizing,
/// defaulting, or weakening any production predicate.
#[cfg(test)]
pub(crate) fn issue_owner_replay_execution_profile_binding_for_test_v1(
    family: &TrialFamilyReadbackV1,
    request: &SealedExploratoryReplayReadbackV2,
    instrument_terms: [SealedInstrumentEconomicTermsProvenanceV1; TARGET_SET_MEMBER_COUNT],
) -> Result<OwnerIssuedReplayExecutionProfileBindingV1, ReplayExecutionProfileBindingErrorV1> {
    issue_owner_replay_execution_profile_binding_v1(family, request, instrument_terms)
}

/// Genuine fixed Owner-readback fixture for the Backtest consumer seam.
#[cfg(test)]
pub(crate) fn owner_replay_execution_profile_binding_fixture_v1(
    plan: &crate::strategy_plan_v2::StrategyPlanV2,
    artifact: &crate::artifact_v2::StrategyArtifactV2,
    universe_frame: &vibe_data::owner::strategy_input_binding::StrategyInputUniverseFrameReceipt,
    window: ReplayWindowV2,
) -> OwnerIssuedReplayExecutionProfileBindingV1 {
    use crate::{
        exploratory_replay::issue_sealed_exploratory_replay_readback_with_profiles_for_acceptance_v2,
        replay_economic_configuration_v1::economic_fixture,
        replay_execution_policy_v2::ReplayExecutionPolicyV2,
        replay_policy_catalog_v2::{ReplayPolicyCatalogBindingV2, ReplayPolicyCatalogBindingV3},
        replay_runner_operational_profile_v1::runner_fixture,
        trial_family::{
            TrialFamilyIndependenceDispositionV1, TrialFamilyPolicyV1, form_initial_family,
        },
    };
    use vibe_backtest_owner_contracts::{
        CanonicalDigestV2, ContentIdentityV2, OpaqueIdentityV2, ReplayAuthorityClaimV2,
        ReplayModelProfilesV2, ReplayRequestDtoV2, ReplayRequestV2, VersionedIdentityV2,
    };

    fn opaque(value: &str) -> OpaqueIdentityV2 {
        OpaqueIdentityV2::try_from(value.to_owned()).expect("fixture opaque identity")
    }
    fn digest(value: u8) -> CanonicalDigestV2 {
        CanonicalDigestV2::try_from(format!("sha256:{}", format!("{value:x}").repeat(64)))
            .expect("fixture digest")
    }
    fn content(identity: &str, value: CanonicalDigestV2) -> ContentIdentityV2 {
        ContentIdentityV2 {
            identity: opaque(identity),
            digest: value,
        }
    }
    fn versioned(identity: &str) -> VersionedIdentityV2 {
        VersionedIdentityV2 {
            identity: opaque(identity),
            version: opaque("v1"),
        }
    }

    let mut economic_input = economic_fixture();
    economic_input.venue_identity = "XNAS".into();
    economic_input.starting_balance =
        crate::replay_economic_configuration_v1::ReplayFixedDecimalV1 {
            mantissa: 1_000_000,
            scale: 0,
        };
    economic_input.starting_balance_currency = "USD".into();
    economic_input.common_quote_currency = "USD".into();
    economic_input.instrument_terms.instrument_identity = "AAPL".into();
    economic_input.instrument_terms.quote_currency = "USD".into();
    let economic = ReplayEconomicConfigurationV1::seal(economic_input).expect("economic fixture");
    let runner = ReplayRunnerOperationalProfileV1::seal(runner_fixture()).expect("runner fixture");
    let execution_policy = ReplayExecutionPolicyV2 {
        runtime_kernel: versioned("runtime-kernel-v2"),
        simulator: versioned("simulator-v2"),
        cost: versioned("cost-model-v1"),
        slippage: versioned("slippage-model-v1"),
        capacity: versioned("capacity-model-v1"),
        runner_operational_profile: versioned("runner-profile-v1"),
        diagnostic_policy: versioned("diagnostic-policy-v1"),
        deterministic_seed: 17,
        window: window.clone(),
        calendar: versioned("xnas-calendar-v1"),
        session: versioned("xnas-session-v1"),
        time_zone: versioned("america-new-york-v1"),
        correction_rule: versioned("correction-rule-v1"),
        market_semantics: versioned("market-semantics-v1"),
        replay_configuration: content(
            "economic-profile-v1",
            CanonicalDigestV2::try_from(format!(
                "sha256:{}",
                economic
                    .digest()
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>()
            ))
            .expect("economic configuration digest"),
        ),
        corporate_action_cut: content("corporate-action-cut-v1", digest(2)),
        historical_membership_cut: content("membership-cut-v1", digest(3)),
    };
    let catalog_v2 = ReplayPolicyCatalogBindingV2::from_policy(
        "replay-policy-catalog-aapl-msft-v2",
        1,
        &execution_policy,
    )
    .expect("Catalog V2 fixture");
    let catalog_v3 = ReplayPolicyCatalogBindingV3::issue(catalog_v2.clone(), &economic, &runner)
        .expect("Catalog V3 fixture");
    let family = form_initial_family(
        "rd-research-intent-aapl-msft-v1",
        &format!("sha256:{}", "4".repeat(64)),
        TrialFamilyPolicyV1 {
            trial_budget: 1,
            stop_rule: "one fixed attempt".into(),
            pit_rule_identity: "pit-rule-v1".into(),
            cost_model_identity: "cost-model-v1".into(),
            slippage_model_identity: "slippage-model-v1".into(),
            capacity_model_identity: "capacity-model-v1".into(),
            semantic_predecessor_frontier: Vec::new(),
            protected_feedback_frontier: "protected-feedback-frontier-v1".into(),
            independence_disposition: TrialFamilyIndependenceDispositionV1::Independent,
            independence_basis_identity: "independence-basis-v1".into(),
            frozen_falsifier_binding: format!("sha256:{}", "5".repeat(64)),
            replay_execution_policy_v2: Some(catalog_v2),
            replay_policy_catalog_v3: Some(catalog_v3.clone()),
        },
        1,
    )
    .expect("verified family fixture");
    let request = ReplayRequestV2::try_from(ReplayRequestDtoV2 {
        schema_version: 2,
        request_identity: opaque("rd-replay-request-aapl-msft-v2"),
        frozen_research_intent: content("rd-research-intent-aapl-msft-v1", digest(4)),
        trial_family: content(
            family.root().trial_family_identity(),
            CanonicalDigestV2::try_from(family.root().root_digest().to_owned())
                .expect("family digest"),
        ),
        trial_family_census_frontier: content(
            family.census_frontier().frontier_identity(),
            CanonicalDigestV2::try_from(family.census_frontier().frontier_digest().to_owned())
                .expect("frontier digest"),
        ),
        replay_authority: ReplayAuthorityClaimV2::Exploratory,
        strategy_design: content("strategy-design-v2", digest(6)),
        strategy_plan: content(
            &format!(
                "sha256:{}",
                hex_bytes(plan.canonical_plan_digest().as_bytes())
            ),
            CanonicalDigestV2::try_from(format!(
                "sha256:{}",
                hex_bytes(plan.canonical_plan_digest().as_bytes())
            ))
            .expect("canonical Plan digest"),
        ),
        artifact: content(
            &format!(
                "rd-strategy-artifact-v2-{}",
                hex_bytes(artifact.identity().as_bytes())
            ),
            CanonicalDigestV2::try_from(format!(
                "sha256:{}",
                hex_bytes(artifact.identity().as_bytes())
            ))
            .expect("artifact digest"),
        ),
        resolved_owner_inputs: content("owner-inputs-v2", digest(9)),
        pit_scope: content("pit-scope-v2", digest(10)),
        pit_snapshot: content("pit-snapshot-v2", digest(11)),
        universe_selection: content(
            &format!(
                "blake3:{}",
                hex_bytes(universe_frame.selection().selection_identity().as_bytes())
            ),
            CanonicalDigestV2::try_from(format!(
                "blake3:{}",
                hex_bytes(universe_frame.selection().selection_digest().as_bytes())
            ))
            .expect("universe selection digest"),
        ),
        correction_rule: execution_policy.correction_rule.clone(),
        market_semantics: execution_policy.market_semantics.clone(),
        replay_configuration: execution_policy.replay_configuration.clone(),
        models: ReplayModelProfilesV2 {
            runtime_kernel: execution_policy.runtime_kernel.clone(),
            simulator: execution_policy.simulator.clone(),
            cost: execution_policy.cost.clone(),
            slippage: execution_policy.slippage.clone(),
            capacity: execution_policy.capacity.clone(),
        },
        runner_operational_profile: execution_policy.runner_operational_profile.clone(),
        diagnostic_policy: execution_policy.diagnostic_policy.clone(),
        deterministic_seed: execution_policy.deterministic_seed,
        window,
        calendar: execution_policy.calendar,
        session: execution_policy.session,
        time_zone: execution_policy.time_zone,
        corporate_action_cut: execution_policy.corporate_action_cut,
        historical_membership_cut: execution_policy.historical_membership_cut,
    })
    .expect("Replay V2 fixture");
    let request =
        issue_sealed_exploratory_replay_readback_with_profiles_for_acceptance_v2(request, &family)
            .expect("sealed Replay Owner fixture");
    let terms = &economic.input().instrument_terms;
    let provenance = [
        instrument_terms_provenance_for_fixture(
            &economic,
            "AAPL".into(),
            terms.instrument_fact_digest,
            terms.instrument_receipt_digest,
            terms.maker_fee,
            terms.taker_fee,
            terms.initial_margin,
            terms.maintenance_margin,
            "XNAS-001",
            0,
            i128::MAX,
        ),
        instrument_terms_provenance_for_fixture(
            &economic,
            "MSFT".into(),
            [21; 32],
            [22; 32],
            terms.maker_fee,
            terms.taker_fee,
            terms.initial_margin,
            terms.maintenance_margin,
            "XNAS-001",
            0,
            i128::MAX,
        ),
    ];
    issue_owner_replay_execution_profile_binding_for_test_v1(&family, &request, provenance)
        .expect("Owner-issued dual-profile fixture")
}

impl ReplayExecutionProfileBindingV1 {
    #[must_use]
    pub const fn binding_digest(&self) -> [u8; 32] {
        self.binding_digest
    }

    #[must_use]
    pub fn request_identity(&self) -> &str {
        &self.request_identity
    }

    pub(crate) const fn request_meaning_digest(&self) -> [u8; 32] {
        self.request_meaning_digest
    }

    pub(crate) const fn economic_configuration_digest(&self) -> [u8; 32] {
        self.economic_configuration_digest
    }

    pub(crate) const fn runner_operational_profile_digest(&self) -> [u8; 32] {
        self.runner_operational_profile_digest
    }

    pub(crate) fn instrument_terms(
        &self,
    ) -> &[BoundInstrumentEconomicTermsV1; TARGET_SET_MEMBER_COUNT] {
        &self.instrument_terms
    }

    pub(crate) fn into_instrument_terms(
        self,
    ) -> [BoundInstrumentEconomicTermsV1; TARGET_SET_MEMBER_COUNT] {
        self.instrument_terms
    }
}

/// Finite prerequisites that prevent end-to-end EVENT execution admission.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReplayExecutionProfileUnavailablePrerequisiteV1 {
    /// No non-test consumer currently carries the prepared ProgramHost EVENT through the real
    /// Backtest engine and Sim Exchange to engine-produced consumption evidence.
    ProgramHostV2SimExchangeEventConsumer,
}

/// Successful preflight is still explicitly unavailable; there is no admitted variant in V1.
#[derive(Debug, Eq, PartialEq)]
pub struct ReplayExecutionProfilePreflightUnavailableV1 {
    pub binding_digest: [u8; 32],
    pub prerequisites: [ReplayExecutionProfileUnavailablePrerequisiteV1; 1],
}

/// Cross-binds family, request, both exact content seals, and sealed Instrument Owner terms.
///
/// # Errors
///
/// Returns before producing a binding if any identity, digest, or provenance is missing or
/// cross-spliced.
pub fn bind_replay_execution_profiles_v1(
    family: &ReplayExecutionProfileFamilyBindingV1,
    request: &ReplayExecutionProfileRequestBindingV1,
    economic: &ReplayEconomicConfigurationV1,
    runner: &ReplayRunnerOperationalProfileV1,
    instrument_terms: [SealedInstrumentEconomicTermsProvenanceV1; TARGET_SET_MEMBER_COUNT],
) -> Result<ReplayExecutionProfileBindingV1, ReplayExecutionProfileBindingErrorV1> {
    validate_schema_and_identity(family, request)?;
    if family.trial_family_identity != request.trial_family_identity
        || family.trial_family_digest != request.trial_family_digest
    {
        return Err(ReplayExecutionProfileBindingErrorV1::TrialFamilyMismatch);
    }

    if family.economic_configuration_digest != economic.digest()
        || request.economic_configuration_digest != economic.digest()
        || family.runner_operational_profile_digest != runner.digest()
        || request.runner_operational_profile_digest != runner.digest()
    {
        return Err(ReplayExecutionProfileBindingErrorV1::ProfileMismatch);
    }
    let instrument_context =
        instrument_terms.map(|terms| validate_instrument_terms(economic, terms));
    let [first, second] = instrument_context;
    let mut instrument_context = [first?, second?];
    instrument_context
        .sort_by(|left, right| left.instrument_identity.cmp(&right.instrument_identity));
    if instrument_context[0].instrument_identity == instrument_context[1].instrument_identity
        || instrument_context
            .iter()
            .filter(|terms| terms_match_profile_primary(terms, economic).unwrap_or(false))
            .count()
            != 1
        || instrument_context[0].venue_identity != instrument_context[1].venue_identity
        || instrument_context[0].quote_currency != instrument_context[1].quote_currency
        || instrument_context[0].account_scope_identity
            != instrument_context[1].account_scope_identity
    {
        return Err(ReplayExecutionProfileBindingErrorV1::InstrumentTermsProvenanceMismatch);
    }

    let mut hasher = Sha256::new();
    hasher.update(PROFILE_BINDING_DIGEST_DOMAIN_V1);
    encode_bytes(&mut hasher, request.request_identity.as_bytes())?;
    hasher.update(request.request_meaning_digest);
    encode_bytes(&mut hasher, family.trial_family_identity.as_bytes())?;
    hasher.update(family.trial_family_digest);
    hasher.update(economic.digest());
    hasher.update(runner.digest());
    for terms in &instrument_context {
        encode_bytes(&mut hasher, terms.instrument_identity.as_bytes())?;
        hasher.update(terms.instrument_fact_digest);
        hasher.update(terms.instrument_receipt_digest);
        hasher.update(terms.terms_digest);
        encode_bytes(&mut hasher, terms.venue_identity.as_bytes())?;
        encode_bytes(&mut hasher, terms.account_scope_identity.as_bytes())?;
        hasher.update(terms.event_time_ns.to_be_bytes());
        hasher.update(terms.valid_from_ns.to_be_bytes());
        hasher.update(terms.valid_until_ns_exclusive.to_be_bytes());
    }
    Ok(ReplayExecutionProfileBindingV1 {
        request_identity: request.request_identity.clone(),
        request_meaning_digest: request.request_meaning_digest,
        economic_configuration_digest: economic.digest(),
        runner_operational_profile_digest: runner.digest(),
        binding_digest: hasher.finalize().into(),
        instrument_terms: instrument_context,
    })
}

fn terms_match_profile_primary(
    terms: &BoundInstrumentEconomicTermsV1,
    economic: &ReplayEconomicConfigurationV1,
) -> Result<bool, ReplayExecutionProfileBindingErrorV1> {
    let expected = &economic.input().instrument_terms;
    Ok(terms.instrument_identity == expected.instrument_identity
        && terms.instrument_fact_digest == expected.instrument_fact_digest
        && terms.instrument_receipt_digest == expected.instrument_receipt_digest
        && terms.terms_digest == instrument_terms_digest(expected)?
        && terms.quote_currency == expected.quote_currency
        && terms.maker_fee == expected.maker_fee
        && terms.taker_fee == expected.taker_fee
        && terms.initial_margin == expected.initial_margin
        && terms.maintenance_margin == expected.maintenance_margin)
}

/// Revalidates the two seals against the binding and returns the exact unavailable prerequisites.
///
/// This function cannot return an admission or construct Backtest state.
///
/// # Errors
///
/// Returns if either supplied seal differs from the already-bound content.
pub fn preflight_event_replay_execution_profile_v1(
    binding: &ReplayExecutionProfileBindingV1,
    economic: &ReplayEconomicConfigurationV1,
    runner: &ReplayRunnerOperationalProfileV1,
) -> Result<ReplayExecutionProfilePreflightUnavailableV1, ReplayExecutionProfileBindingErrorV1> {
    if binding.economic_configuration_digest != economic.digest()
        || binding.runner_operational_profile_digest != runner.digest()
    {
        return Err(ReplayExecutionProfileBindingErrorV1::ProfileMismatch);
    }

    if binding.request_meaning_digest == [0; 32] {
        return Err(ReplayExecutionProfileBindingErrorV1::InvalidDigest);
    }
    Ok(ReplayExecutionProfilePreflightUnavailableV1 {
        binding_digest: binding.binding_digest,
        prerequisites: [
            ReplayExecutionProfileUnavailablePrerequisiteV1::ProgramHostV2SimExchangeEventConsumer,
        ],
    })
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum ReplayExecutionProfileBindingErrorV1 {
    #[error("Replay execution-profile R&D Owner authority is unavailable")]
    OwnerAuthorityUnavailable,
    #[error("Replay execution-profile binding schema is unsupported")]
    UnsupportedSchema,
    #[error("Replay execution-profile binding identity is invalid")]
    InvalidIdentity,
    #[error("Replay execution-profile binding digest is invalid")]
    InvalidDigest,
    #[error("Replay execution-profile TrialFamily binding mismatches")]
    TrialFamilyMismatch,
    #[error("Replay execution-profile content binding mismatches")]
    ProfileMismatch,
    #[error("Replay execution-profile Instrument Owner terms provenance mismatches")]
    InstrumentTermsProvenanceMismatch,
    #[error("Replay execution-profile binding length overflows")]
    LengthOverflow,
}

fn validate_schema_and_identity(
    family: &ReplayExecutionProfileFamilyBindingV1,
    request: &ReplayExecutionProfileRequestBindingV1,
) -> Result<(), ReplayExecutionProfileBindingErrorV1> {
    if family.schema_version != REPLAY_EXECUTION_PROFILE_BINDING_SCHEMA_VERSION_V1
        || request.schema_version != REPLAY_EXECUTION_PROFILE_BINDING_SCHEMA_VERSION_V1
    {
        return Err(ReplayExecutionProfileBindingErrorV1::UnsupportedSchema);
    }

    for identity in [
        family.trial_family_identity.as_str(),
        request.request_identity.as_str(),
        request.trial_family_identity.as_str(),
    ] {
        if identity.is_empty()
            || identity.len() > MAX_IDENTITY_BYTES_V1
            || !identity.is_ascii()
            || identity.trim() != identity
        {
            return Err(ReplayExecutionProfileBindingErrorV1::InvalidIdentity);
        }
    }

    for value in [
        family.trial_family_digest,
        family.economic_configuration_digest,
        family.runner_operational_profile_digest,
        request.request_meaning_digest,
        request.trial_family_digest,
        request.economic_configuration_digest,
        request.runner_operational_profile_digest,
    ] {
        if value == [0; 32] {
            return Err(ReplayExecutionProfileBindingErrorV1::InvalidDigest);
        }
    }
    Ok(())
}

fn family_profile_binding_digest(
    family: &ReplayExecutionProfileFamilyBindingV1,
    catalog_v3_binding_digest: [u8; 32],
) -> Result<[u8; 32], ReplayExecutionProfileBindingErrorV1> {
    let mut hasher = Sha256::new();
    hasher.update(b"rd.replay-family-execution-profile-seal.v1\0");
    hasher.update(family.schema_version.to_le_bytes());
    encode_bytes(&mut hasher, family.trial_family_identity.as_bytes())?;
    hasher.update(family.trial_family_digest);
    hasher.update(family.economic_configuration_digest);
    hasher.update(family.runner_operational_profile_digest);
    hasher.update(catalog_v3_binding_digest);
    Ok(hasher.finalize().into())
}

fn request_profile_binding_digest(
    request: &ReplayExecutionProfileRequestBindingV1,
    family_profile_binding_digest: [u8; 32],
) -> Result<[u8; 32], ReplayExecutionProfileBindingErrorV1> {
    let mut hasher = Sha256::new();
    hasher.update(b"rd.replay-request-execution-profile-seal.v1\0");
    hasher.update(request.schema_version.to_le_bytes());
    encode_bytes(&mut hasher, request.request_identity.as_bytes())?;
    hasher.update(request.request_meaning_digest);
    encode_bytes(&mut hasher, request.trial_family_identity.as_bytes())?;
    hasher.update(request.trial_family_digest);
    hasher.update(request.economic_configuration_digest);
    hasher.update(request.runner_operational_profile_digest);
    hasher.update(family_profile_binding_digest);
    Ok(hasher.finalize().into())
}

fn validate_instrument_terms(
    economic: &ReplayEconomicConfigurationV1,
    provenance: SealedInstrumentEconomicTermsProvenanceV1,
) -> Result<BoundInstrumentEconomicTermsV1, ReplayExecutionProfileBindingErrorV1> {
    let SealedInstrumentEconomicTermsProvenanceV1 {
        instrument_identity,
        instrument_fact_digest,
        instrument_receipt_digest,
        terms_digest,
        economic_configuration_digest,
        venue_identity,
        quote_currency,
        account_scope_identity,
        event_time_ns,
        valid_from_ns,
        valid_until_ns_exclusive,
        margin_model,
        maker_fee,
        taker_fee,
        initial_margin,
        maintenance_margin,
    } = provenance;

    if instrument_identity.is_empty()
        || instrument_fact_digest == [0; 32]
        || instrument_receipt_digest == [0; 32]
        || terms_digest == [0; 32]
        || economic_configuration_digest != economic.digest()
        || venue_identity != economic.input().venue_identity
        || quote_currency != economic.input().common_quote_currency
        || account_scope_identity.is_empty()
        || event_time_ns < valid_from_ns
        || event_time_ns >= valid_until_ns_exclusive
        || margin_model != InstrumentMarginModelSelectionV1::StandardMarginModel
        || terms_digest
            != instrument_terms_digest(&InstrumentEconomicTermsBindingV1 {
                instrument_identity: instrument_identity.clone(),
                quote_currency: quote_currency.clone(),
                instrument_fact_digest,
                instrument_receipt_digest,
                maker_fee,
                taker_fee,
                initial_margin,
                maintenance_margin,
            })?
    {
        return Err(ReplayExecutionProfileBindingErrorV1::InstrumentTermsProvenanceMismatch);
    }
    Ok(BoundInstrumentEconomicTermsV1 {
        instrument_identity,
        instrument_fact_digest,
        instrument_receipt_digest,
        terms_digest,
        venue_identity,
        quote_currency,
        account_scope_identity,
        event_time_ns,
        valid_from_ns,
        valid_until_ns_exclusive,
        margin_model,
        maker_fee,
        taker_fee,
        initial_margin,
        maintenance_margin,
    })
}

fn instrument_terms_digest(
    terms: &InstrumentEconomicTermsBindingV1,
) -> Result<[u8; 32], ReplayExecutionProfileBindingErrorV1> {
    let bytes = serde_json::to_vec(terms)
        .map_err(|_| ReplayExecutionProfileBindingErrorV1::InstrumentTermsProvenanceMismatch)?;
    let mut hasher = Sha256::new();
    hasher.update(b"strategy-factory.instrument-economic-terms.v1\0");
    hasher.update(bytes);
    Ok(hasher.finalize().into())
}

#[cfg(test)]
pub(crate) fn instrument_terms_provenance_fixture_v1(
    economic: &ReplayEconomicConfigurationV1,
) -> [SealedInstrumentEconomicTermsProvenanceV1; TARGET_SET_MEMBER_COUNT] {
    let terms = &economic.input().instrument_terms;
    [
        instrument_terms_provenance_for_fixture(
            economic,
            terms.instrument_identity.clone(),
            terms.instrument_fact_digest,
            terms.instrument_receipt_digest,
            terms.maker_fee,
            terms.taker_fee,
            terms.initial_margin,
            terms.maintenance_margin,
            &format!("{}-001", economic.input().venue_identity),
            0,
            i128::MAX,
        ),
        instrument_terms_provenance_for_fixture(
            economic,
            "SOLUSDT-PERP".into(),
            [11; 32],
            [12; 32],
            terms.maker_fee,
            terms.taker_fee,
            terms.initial_margin,
            terms.maintenance_margin,
            &format!("{}-001", economic.input().venue_identity),
            0,
            i128::MAX,
        ),
    ]
}

#[cfg(test)]
fn instrument_terms_provenance_for_fixture(
    economic: &ReplayEconomicConfigurationV1,
    instrument_identity: String,
    instrument_fact_digest: [u8; 32],
    instrument_receipt_digest: [u8; 32],
    maker_fee: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1,
    taker_fee: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1,
    initial_margin: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1,
    maintenance_margin: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1,
    account_scope_identity: &str,
    valid_from_ns: i128,
    valid_until_ns_exclusive: i128,
) -> SealedInstrumentEconomicTermsProvenanceV1 {
    let profile_terms = &economic.input().instrument_terms;
    let terms = InstrumentEconomicTermsBindingV1 {
        instrument_identity: instrument_identity.clone(),
        quote_currency: profile_terms.quote_currency.clone(),
        instrument_fact_digest,
        instrument_receipt_digest,
        maker_fee,
        taker_fee,
        initial_margin,
        maintenance_margin,
    };
    SealedInstrumentEconomicTermsProvenanceV1 {
        instrument_identity,
        instrument_fact_digest,
        instrument_receipt_digest,
        terms_digest: instrument_terms_digest(&terms).expect("fixture terms digest"),
        economic_configuration_digest: economic.digest(),
        venue_identity: economic.input().venue_identity.clone(),
        quote_currency: terms.quote_currency,
        account_scope_identity: account_scope_identity.into(),
        event_time_ns: valid_from_ns,
        valid_from_ns,
        valid_until_ns_exclusive,
        margin_model: InstrumentMarginModelSelectionV1::StandardMarginModel,
        maker_fee: terms.maker_fee,
        taker_fee: terms.taker_fee,
        initial_margin: terms.initial_margin,
        maintenance_margin: terms.maintenance_margin,
    }
}

fn encode_bytes(
    hasher: &mut Sha256,
    value: &[u8],
) -> Result<(), ReplayExecutionProfileBindingErrorV1> {
    let length = u32::try_from(value.len())
        .map_err(|_| ReplayExecutionProfileBindingErrorV1::LengthOverflow)?;
    hasher.update(length.to_le_bytes());
    hasher.update(value);
    Ok(())
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "used by the staged Owner issuance seam before its composition consumer lands"
    )
)]
fn decode_canonical_digest(value: &str) -> Result<[u8; 32], ReplayExecutionProfileBindingErrorV1> {
    let Some((algorithm, hexadecimal)) = value.split_once(':') else {
        return Err(ReplayExecutionProfileBindingErrorV1::InvalidDigest);
    };
    if !matches!(algorithm, "sha256" | "blake3")
        || hexadecimal.len() != 64
        || !hexadecimal
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
    {
        return Err(ReplayExecutionProfileBindingErrorV1::InvalidDigest);
    }
    let mut output = [0_u8; 32];
    for (index, pair) in hexadecimal.as_bytes().chunks_exact(2).enumerate() {
        output[index] = (hex_nibble(pair[0])? << 4) | hex_nibble(pair[1])?;
    }
    Ok(output)
}

#[cfg(test)]
fn hex_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "used by the staged Owner issuance seam before its composition consumer lands"
    )
)]
fn hex_nibble(value: u8) -> Result<u8, ReplayExecutionProfileBindingErrorV1> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        _ => Err(ReplayExecutionProfileBindingErrorV1::InvalidDigest),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        replay_economic_configuration_v1::{ReplayEconomicConfigurationV1, economic_fixture},
        replay_runner_operational_profile_v1::{ReplayRunnerOperationalProfileV1, runner_fixture},
    };
    use rstest::rstest;
    use vibe_data::owner::{
        instrument_economic_terms_postgres_owner_from_environment_v1,
        instrument_economic_terms_v1::{
            InstrumentEconomicAccountApplicabilityV1, InstrumentEconomicDecimalV1,
            InstrumentEconomicTermsFactV1, InstrumentEconomicTermsInputV1,
            InstrumentMarginMeaningV1,
        },
    };
    use vibe_testkit::postgres::CanonicalOwnerPostgresTestDatabaseV1;

    fn fixtures() -> (
        ReplayEconomicConfigurationV1,
        ReplayRunnerOperationalProfileV1,
        ReplayExecutionProfileFamilyBindingV1,
        ReplayExecutionProfileRequestBindingV1,
        [SealedInstrumentEconomicTermsProvenanceV1; TARGET_SET_MEMBER_COUNT],
    ) {
        let economic = ReplayEconomicConfigurationV1::seal(economic_fixture()).unwrap();
        let runner = ReplayRunnerOperationalProfileV1::seal(runner_fixture()).unwrap();
        let family = ReplayExecutionProfileFamilyBindingV1 {
            schema_version: 1,
            trial_family_identity: "trial-family-1".into(),
            trial_family_digest: [3; 32],
            economic_configuration_digest: economic.digest(),
            runner_operational_profile_digest: runner.digest(),
        };
        let request = ReplayExecutionProfileRequestBindingV1 {
            schema_version: 1,
            request_identity: "replay-request-1".into(),
            request_meaning_digest: [4; 32],
            trial_family_identity: family.trial_family_identity.clone(),
            trial_family_digest: family.trial_family_digest,
            economic_configuration_digest: economic.digest(),
            runner_operational_profile_digest: runner.digest(),
        };
        let provenance = instrument_terms_provenance_fixture_v1(&economic);
        (economic, runner, family, request, provenance)
    }

    #[rstest]
    #[cfg(feature = "sealed-strategy-input-acceptance")]
    fn owner_fixture_uses_complete_request_locator_and_exact_profile_bytes() {
        let (plan, artifact, frame) =
            crate::program_host_v2_target_set_backtest_tests::fixture().unwrap();
        let frame_time =
            crate::program_host_v2::admit_market_data_universe_program_event_v2(&plan, &frame)
                .unwrap()
                .envelope()
                .order_key
                .logical_time_ns;
        let binding = owner_replay_execution_profile_binding_fixture_v1(
            &plan,
            &artifact,
            &frame,
            ReplayWindowV2 {
                start_event_ns: frame_time,
                end_event_ns_exclusive: frame_time + 3,
            },
        );
        let locator = binding.request_locator().clone();
        assert_eq!(locator.request_identity, "rd-replay-request-aapl-msft-v2");
        assert!(!locator.meaning_digest.is_empty());
        assert!(!locator.receipt_identity.is_empty());
        assert!(!locator.seal_digest.is_empty());
        assert!(binding.matches_request_locator(&locator));
        let economic = ReplayEconomicConfigurationV1::parse_canonical(
            binding.economic_configuration_canonical_bytes(),
        )
        .unwrap();
        assert_eq!(
            economic.input().starting_balance,
            crate::replay_economic_configuration_v1::ReplayFixedDecimalV1 {
                mantissa: 1_000_000,
                scale: 0,
            }
        );
        assert_eq!(economic.digest(), binding.economic_configuration_digest());
        assert_eq!(
            binding.request_strategy_plan_digest(),
            *plan.canonical_plan_digest().as_bytes()
        );
        assert_eq!(
            binding.request_artifact_digest(),
            *artifact.identity().as_bytes()
        );
        assert_eq!(
            binding.request_universe_selection_digest(),
            *frame.selection().selection_digest().as_bytes()
        );
        assert_eq!(
            ReplayRunnerOperationalProfileV1::parse_canonical(
                binding.runner_operational_profile_canonical_bytes()
            )
            .unwrap()
            .digest(),
            binding.runner_operational_profile_digest()
        );
        assert_ne!(binding.authority_digest(), [0; 32]);
        let inner = binding.into_execution_profile_binding();
        assert_eq!(inner.request_identity(), locator.request_identity);
        assert_eq!(inner.instrument_terms()[0].instrument_identity, "AAPL");
        assert_eq!(inner.instrument_terms()[1].instrument_identity, "MSFT");
        assert!(
            inner
                .instrument_terms()
                .iter()
                .all(|terms| terms.venue_identity == "XNAS"
                    && terms.quote_currency == "USD"
                    && terms.account_scope_identity == "XNAS-001")
        );
    }

    #[rstest]
    fn exact_cross_binding_returns_only_explicit_unavailable_prerequisites() {
        let (economic, runner, family, request, provenance) = fixtures();
        let binding =
            bind_replay_execution_profiles_v1(&family, &request, &economic, &runner, provenance)
                .unwrap();
        let unavailable =
            preflight_event_replay_execution_profile_v1(&binding, &economic, &runner).unwrap();
        assert_eq!(unavailable.binding_digest, binding.binding_digest());
        assert_eq!(
            unavailable.prerequisites,
            [
                ReplayExecutionProfileUnavailablePrerequisiteV1::ProgramHostV2SimExchangeEventConsumer,
            ]
        );
    }

    #[rstest]
    fn family_request_and_profile_cross_splices_fail_closed() {
        let (economic, runner, family, mut request, provenance) = fixtures();
        request.trial_family_digest = [9; 32];
        assert_eq!(
            bind_replay_execution_profiles_v1(&family, &request, &economic, &runner, provenance),
            Err(ReplayExecutionProfileBindingErrorV1::TrialFamilyMismatch)
        );

        let (economic, runner, family, mut request, provenance) = fixtures();
        request.economic_configuration_digest = [8; 32];
        assert_eq!(
            bind_replay_execution_profiles_v1(&family, &request, &economic, &runner, provenance),
            Err(ReplayExecutionProfileBindingErrorV1::ProfileMismatch)
        );
    }

    #[rstest]
    fn owner_provenance_cannot_cross_splice_into_another_economic_profile() {
        let (_economic, runner, mut family, mut request, provenance) = fixtures();
        let mut other_input = economic_fixture();
        other_input.venue_identity = "OTHER".into();
        let other = ReplayEconomicConfigurationV1::seal(other_input).unwrap();
        family.economic_configuration_digest = other.digest();
        request.economic_configuration_digest = other.digest();

        assert_eq!(
            bind_replay_execution_profiles_v1(&family, &request, &other, &runner, provenance),
            Err(ReplayExecutionProfileBindingErrorV1::InstrumentTermsProvenanceMismatch)
        );
    }

    #[rstest]
    fn caller_visible_terms_cannot_replace_sealed_owner_provenance() {
        let (economic, runner, family, request, mut provenance) = fixtures();
        provenance[1].instrument_receipt_digest = [7; 32];
        assert_eq!(
            bind_replay_execution_profiles_v1(&family, &request, &economic, &runner, provenance),
            Err(ReplayExecutionProfileBindingErrorV1::InstrumentTermsProvenanceMismatch)
        );
    }

    #[rstest]
    fn second_member_terms_substitution_and_duplicate_fail_closed() {
        let (economic, runner, family, request, mut substituted) = fixtures();
        substituted[1].maker_fee.mantissa += 1;
        assert_eq!(
            bind_replay_execution_profiles_v1(&family, &request, &economic, &runner, substituted,),
            Err(ReplayExecutionProfileBindingErrorV1::InstrumentTermsProvenanceMismatch)
        );

        let (economic, runner, family, request, mut duplicate) = fixtures();
        duplicate[1] = instrument_terms_provenance_for_fixture(
            &economic,
            economic
                .input()
                .instrument_terms
                .instrument_identity
                .clone(),
            [21; 32],
            [22; 32],
            economic.input().instrument_terms.maker_fee,
            economic.input().instrument_terms.taker_fee,
            economic.input().instrument_terms.initial_margin,
            economic.input().instrument_terms.maintenance_margin,
            "SIM-001",
            0,
            i128::MAX,
        );
        assert_eq!(
            bind_replay_execution_profiles_v1(&family, &request, &economic, &runner, duplicate,),
            Err(ReplayExecutionProfileBindingErrorV1::InstrumentTermsProvenanceMismatch)
        );
    }

    #[rstest]
    fn preflight_rechecks_exact_profile_contents() {
        let (economic, runner, family, request, provenance) = fixtures();
        let binding =
            bind_replay_execution_profiles_v1(&family, &request, &economic, &runner, provenance)
                .unwrap();
        let mut changed = runner_fixture();
        changed.run_analysis = true;
        let changed = ReplayRunnerOperationalProfileV1::seal(changed).unwrap();
        assert_eq!(
            preflight_event_replay_execution_profile_v1(&binding, &economic, &changed),
            Err(ReplayExecutionProfileBindingErrorV1::ProfileMismatch)
        );
    }

    #[tokio::test]
    #[ignore = "requires INSTRUMENT_OWNER_DATABASE_URL"]
    async fn verified_owner_readback_mints_provenance_and_wrong_coordinates_fail() {
        let _database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let owner = instrument_economic_terms_postgres_owner_from_environment_v1()
            .await
            .unwrap();
        let fact = InstrumentEconomicTermsFactV1::seal(InstrumentEconomicTermsInputV1 {
            schema_version: 1,
            instrument_identity: "ETHUSDT-PERP".into(),
            instrument_public_fact_digest: [1; 32],
            venue_identity: "SIM".into(),
            account_scope_identity: "RDQ-MARGIN".into(),
            account_applicability: InstrumentEconomicAccountApplicabilityV1::MarginAccount,
            valid_from_ns: 100,
            valid_until_ns_exclusive: 200,
            source_identity: "schedule-1".into(),
            source_digest: [8; 32],
            provenance_digest: [9; 32],
            revision: 1,
            quote_currency: "USDT".into(),
            fee_currency: "USDT".into(),
            maker_fee: InstrumentEconomicDecimalV1 {
                mantissa: 2,
                scale: 4,
            },
            taker_fee: InstrumentEconomicDecimalV1 {
                mantissa: 4,
                scale: 4,
            },
            initial_margin: InstrumentEconomicDecimalV1 {
                mantissa: 1,
                scale: 1,
            },
            maintenance_margin: InstrumentEconomicDecimalV1 {
                mantissa: 5,
                scale: 2,
            },
            margin_meaning: InstrumentMarginMeaningV1::StandardNotionalRate,
        })
        .unwrap();
        let readback = owner.issue(&fact).await.unwrap();
        let mut economic_input = economic_fixture();
        economic_input.instrument_terms.instrument_receipt_digest = readback.receipt_identity();
        let economic = ReplayEconomicConfigurationV1::seal(economic_input).unwrap();
        let runner = ReplayRunnerOperationalProfileV1::seal(runner_fixture()).unwrap();
        let family = ReplayExecutionProfileFamilyBindingV1 {
            schema_version: 1,
            trial_family_identity: "trial-family-1".into(),
            trial_family_digest: [3; 32],
            economic_configuration_digest: economic.digest(),
            runner_operational_profile_digest: runner.digest(),
        };
        let request = ReplayExecutionProfileRequestBindingV1 {
            schema_version: 1,
            request_identity: "request-1".into(),
            request_meaning_digest: [4; 32],
            trial_family_identity: family.trial_family_identity.clone(),
            trial_family_digest: family.trial_family_digest,
            economic_configuration_digest: economic.digest(),
            runner_operational_profile_digest: runner.digest(),
        };
        let context = InstrumentEconomicTermsConsumptionContextV1 {
            venue_identity: "SIM",
            account_scope_identity: "RDQ-MARGIN",
            event_time_ns: 150,
        };
        let provenance =
            seal_instrument_economic_terms_provenance_v1(&readback, &economic, context).unwrap();
        let mut target_terms = instrument_terms_provenance_fixture_v1(&economic);
        target_terms[0] = provenance;
        bind_replay_execution_profiles_v1(&family, &request, &economic, &runner, target_terms)
            .unwrap();

        for wrong in [
            InstrumentEconomicTermsConsumptionContextV1 {
                venue_identity: "OTHER",
                ..context
            },
            InstrumentEconomicTermsConsumptionContextV1 {
                account_scope_identity: "OTHER",
                ..context
            },
            InstrumentEconomicTermsConsumptionContextV1 {
                event_time_ns: 200,
                ..context
            },
        ] {
            assert!(matches!(
                seal_instrument_economic_terms_provenance_v1(&readback, &economic, wrong),
                Err(ReplayExecutionProfileBindingErrorV1::InstrumentTermsProvenanceMismatch)
            ));
        }
    }
}
