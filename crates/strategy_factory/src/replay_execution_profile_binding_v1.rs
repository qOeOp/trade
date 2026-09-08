//! Cross-binding and fail-closed preflight for the two Replay execution-profile seals.
//!
//! This module intentionally exposes no engine constructor and no admitted result. Even a complete
//! profile binding returns an explicit unavailable prerequisite census until every native
//! representation and model mapping, the no-float liquidation boundary, and the real
//! `ProgramHostV2` to Sim Exchange EVENT consumer exist.

use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_data::owner::instrument_economic_terms_v1::{
    InstrumentEconomicAccountApplicabilityV1, InstrumentEconomicTermsReadbackV1,
    InstrumentMarginMeaningV1,
};

use crate::{
    replay_economic_configuration_v1::{
        InstrumentEconomicTermsBindingV1, ReplayEconomicConfigurationV1,
    },
    replay_runner_operational_profile_v1::ReplayRunnerOperationalProfileV1,
};

/// Replay execution-profile family/request binding schema version.
pub const REPLAY_EXECUTION_PROFILE_BINDING_SCHEMA_VERSION_V1: u16 = 1;
const PROFILE_BINDING_DIGEST_DOMAIN_V1: &[u8] =
    b"strategy-factory.replay-execution-profile-binding.v1\0";
const MAX_IDENTITY_BYTES_V1: usize = 256;

/// TrialFamily-owned choice of the two exact profile contents.
#[derive(Clone, Debug, Eq, PartialEq)]
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
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReplayExecutionProfileRequestBindingV1 {
    pub schema_version: u16,
    pub request_identity: String,
    pub request_meaning_digest: [u8; 32],
    pub trial_family_identity: String,
    pub trial_family_digest: [u8; 32],
    pub economic_configuration_digest: [u8; 32],
    pub runner_operational_profile_digest: [u8; 32],
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
    account_scope_identity: String,
    event_time_ns: i128,
    margin_model: InstrumentMarginModelSelectionV1,
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
    if !readback.verify() {
        return Err(ReplayExecutionProfileBindingErrorV1::InstrumentTermsProvenanceMismatch);
    }
    let owner = readback.fact().input();
    let expected = &economic.input().instrument_terms;
    if context.venue_identity != economic.input().venue_identity
        || owner.instrument_identity != expected.instrument_identity
        || owner.instrument_public_fact_digest != expected.instrument_fact_digest
        || owner.venue_identity != context.venue_identity
        || owner.account_scope_identity != context.account_scope_identity
        || owner.account_applicability != InstrumentEconomicAccountApplicabilityV1::MarginAccount
        || context.event_time_ns < owner.valid_from_ns
        || context.event_time_ns >= owner.valid_until_ns_exclusive
        || owner.quote_currency != expected.quote_currency
        || owner.fee_currency != expected.quote_currency
        || owner.margin_meaning != InstrumentMarginMeaningV1::StandardNotionalRate
        || readback.receipt_identity() != expected.instrument_receipt_digest
        || !same_decimal(owner.maker_fee, expected.maker_fee)
        || !same_decimal(owner.taker_fee, expected.taker_fee)
        || !same_decimal(owner.initial_margin, expected.initial_margin)
        || !same_decimal(owner.maintenance_margin, expected.maintenance_margin)
    {
        return Err(ReplayExecutionProfileBindingErrorV1::InstrumentTermsProvenanceMismatch);
    }
    Ok(SealedInstrumentEconomicTermsProvenanceV1 {
        instrument_identity: owner.instrument_identity.clone(),
        instrument_fact_digest: owner.instrument_public_fact_digest,
        instrument_receipt_digest: readback.receipt_identity(),
        terms_digest: instrument_terms_digest(expected)?,
        economic_configuration_digest: economic.digest(),
        venue_identity: context.venue_identity.into(),
        account_scope_identity: context.account_scope_identity.into(),
        event_time_ns: context.event_time_ns,
        margin_model: InstrumentMarginModelSelectionV1::StandardMarginModel,
    })
}

/// Content binding produced before any engine state exists.
#[derive(Debug, Eq, PartialEq)]
pub struct ReplayExecutionProfileBindingV1 {
    request_identity: String,
    request_meaning_digest: [u8; 32],
    economic_configuration_digest: [u8; 32],
    runner_operational_profile_digest: [u8; 32],
    binding_digest: [u8; 32],
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
}

/// Finite prerequisites that deliberately prevent native materialization in this leaf.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReplayExecutionProfileUnavailablePrerequisiteV1 {
    /// Native identifiers, currency/fixed-point values, message-bus codecs, time origins,
    /// rate limits, and deterministic instance UUIDs do not yet have one version-bound,
    /// fail-closed materializer from the sealed policy bytes.
    NativeRepresentationMaterialization,
    /// The semantic full-fill, fee, and margin choices do not yet select exact native model
    /// implementations with a proof that construction and execution consume no host randomness
    /// or implicit model default.
    DeterministicEconomicModelMaterialization,
    /// V1 encodes liquidation as disabled and contains no float. Native construction remains
    /// unavailable until an adapter proves the inactive float field is not read, or binds a
    /// version-specific inactive constant outside policy bytes.
    NoFloatLiquidationMaterialization,
    /// No non-test consumer currently carries the prepared ProgramHost EVENT through the real
    /// Backtest engine and Sim Exchange to engine-produced consumption evidence.
    ProgramHostV2SimExchangeEventConsumer,
}

/// Successful preflight is still explicitly unavailable; there is no admitted variant in V1.
#[derive(Debug, Eq, PartialEq)]
pub struct ReplayExecutionProfilePreflightUnavailableV1 {
    pub binding_digest: [u8; 32],
    pub prerequisites: [ReplayExecutionProfileUnavailablePrerequisiteV1; 4],
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
    instrument_terms: SealedInstrumentEconomicTermsProvenanceV1,
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
    let instrument_context = validate_instrument_terms(economic, instrument_terms)?;

    let mut hasher = Sha256::new();
    hasher.update(PROFILE_BINDING_DIGEST_DOMAIN_V1);
    encode_bytes(&mut hasher, request.request_identity.as_bytes())?;
    hasher.update(request.request_meaning_digest);
    encode_bytes(&mut hasher, family.trial_family_identity.as_bytes())?;
    hasher.update(family.trial_family_digest);
    hasher.update(economic.digest());
    hasher.update(runner.digest());
    encode_bytes(&mut hasher, instrument_context.venue_identity.as_bytes())?;
    encode_bytes(
        &mut hasher,
        instrument_context.account_scope_identity.as_bytes(),
    )?;
    hasher.update(instrument_context.event_time_ns.to_be_bytes());
    Ok(ReplayExecutionProfileBindingV1 {
        request_identity: request.request_identity.clone(),
        request_meaning_digest: request.request_meaning_digest,
        economic_configuration_digest: economic.digest(),
        runner_operational_profile_digest: runner.digest(),
        binding_digest: hasher.finalize().into(),
    })
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
            ReplayExecutionProfileUnavailablePrerequisiteV1::NativeRepresentationMaterialization,
            ReplayExecutionProfileUnavailablePrerequisiteV1::DeterministicEconomicModelMaterialization,
            ReplayExecutionProfileUnavailablePrerequisiteV1::NoFloatLiquidationMaterialization,
            ReplayExecutionProfileUnavailablePrerequisiteV1::ProgramHostV2SimExchangeEventConsumer,
        ],
    })
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum ReplayExecutionProfileBindingErrorV1 {
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

struct ValidatedInstrumentEconomicTermsContextV1 {
    venue_identity: String,
    account_scope_identity: String,
    event_time_ns: i128,
}

fn validate_instrument_terms(
    economic: &ReplayEconomicConfigurationV1,
    provenance: SealedInstrumentEconomicTermsProvenanceV1,
) -> Result<ValidatedInstrumentEconomicTermsContextV1, ReplayExecutionProfileBindingErrorV1> {
    let expected = &economic.input().instrument_terms;
    let SealedInstrumentEconomicTermsProvenanceV1 {
        instrument_identity,
        instrument_fact_digest,
        instrument_receipt_digest,
        terms_digest,
        economic_configuration_digest,
        venue_identity,
        account_scope_identity,
        event_time_ns,
        margin_model,
    } = provenance;

    if instrument_identity != expected.instrument_identity
        || instrument_fact_digest != expected.instrument_fact_digest
        || instrument_receipt_digest != expected.instrument_receipt_digest
        || terms_digest != instrument_terms_digest(expected)?
        || economic_configuration_digest != economic.digest()
        || venue_identity != economic.input().venue_identity
        || margin_model != InstrumentMarginModelSelectionV1::StandardMarginModel
    {
        return Err(ReplayExecutionProfileBindingErrorV1::InstrumentTermsProvenanceMismatch);
    }
    Ok(ValidatedInstrumentEconomicTermsContextV1 {
        venue_identity,
        account_scope_identity,
        event_time_ns,
    })
}

fn same_decimal(
    owner: vibe_data::owner::instrument_economic_terms_v1::InstrumentEconomicDecimalV1,
    expected: crate::replay_economic_configuration_v1::ReplayFixedDecimalV1,
) -> bool {
    owner.mantissa == expected.mantissa && owner.scale == expected.scale
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
        SealedInstrumentEconomicTermsProvenanceV1,
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
        let terms = &economic.input().instrument_terms;
        let provenance = SealedInstrumentEconomicTermsProvenanceV1 {
            instrument_identity: terms.instrument_identity.clone(),
            instrument_fact_digest: terms.instrument_fact_digest,
            instrument_receipt_digest: terms.instrument_receipt_digest,
            terms_digest: instrument_terms_digest(terms).unwrap(),
            economic_configuration_digest: economic.digest(),
            venue_identity: economic.input().venue_identity.clone(),
            account_scope_identity: "fixture-account".into(),
            event_time_ns: 1,
            margin_model: InstrumentMarginModelSelectionV1::StandardMarginModel,
        };
        (economic, runner, family, request, provenance)
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
                ReplayExecutionProfileUnavailablePrerequisiteV1::NativeRepresentationMaterialization,
                ReplayExecutionProfileUnavailablePrerequisiteV1::DeterministicEconomicModelMaterialization,
                ReplayExecutionProfileUnavailablePrerequisiteV1::NoFloatLiquidationMaterialization,
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
        provenance.instrument_receipt_digest = [7; 32];
        assert_eq!(
            bind_replay_execution_profiles_v1(&family, &request, &economic, &runner, provenance),
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
        bind_replay_execution_profiles_v1(&family, &request, &economic, &runner, provenance)
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
