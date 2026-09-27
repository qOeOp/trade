//! Retained R&D and Composer custody for one Native Replay preparation cut.

use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_data::owner::source_binding::BindingDigest;

use crate::{
    develop_composer_postgres_v2::{
        DevelopComposerSealedReadErrorV2, DevelopComposerSealedReadPortV2,
        SealedDevelopComposerReadbackV2,
        resolve_develop_composer_locator_for_replay_v2_in_transaction,
    },
    exploratory_replay::{ExploratoryReplayRequestLocatorV2, SealedExploratoryReplayReadbackV2},
    native_replay_rd_sources_v2::NativeReplayRdSourcesV2,
    rd_owner_postgres_custody::{
        VerifiedResearchCustodyV1, resolve_native_replay_rd_cut_v2_in_transaction,
    },
    trial_family::TrialFamilyReadbackV1,
};

/// One move-only input that preserves the exact Replay, R&D source, and Composer custody reads.
///
/// The value has no public constructor, is not deserializable, and cannot be cloned. A later
/// Strategy Factory composition step must therefore consume the Owner-issued cut instead of
/// rebuilding it from caller-selected locators or bytes.
pub struct NativeReplayPreparationInputsV2 {
    replay: SealedExploratoryReplayReadbackV2,
    rd_sources: NativeReplayRdSourcesV2,
    composer: SealedDevelopComposerReadbackV2,
    family: TrialFamilyReadbackV1,
}

impl NativeReplayPreparationInputsV2 {
    #[must_use]
    pub const fn replay(&self) -> &SealedExploratoryReplayReadbackV2 {
        &self.replay
    }

    #[must_use]
    pub const fn rd_sources(&self) -> &NativeReplayRdSourcesV2 {
        &self.rd_sources
    }

    #[must_use]
    pub const fn composer(&self) -> &SealedDevelopComposerReadbackV2 {
        &self.composer
    }

    #[must_use]
    pub const fn family(&self) -> &TrialFamilyReadbackV1 {
        &self.family
    }

    pub(crate) fn into_owner_evidence_parts(
        self,
    ) -> (
        SealedExploratoryReplayReadbackV2,
        NativeReplayRdSourcesV2,
        SealedDevelopComposerReadbackV2,
    ) {
        (self.replay, self.rd_sources, self.composer)
    }
}

#[derive(Debug, Error)]
pub enum NativeReplayPreparationInputsErrorV2 {
    #[error("Native Replay R&D preparation custody is unavailable: {0}")]
    Unavailable(String),
}

/// Resolves and cross-binds one exact R&D Replay cut and its accepted Composer package.
///
/// The Composer port is sealed to R&D-owned implementations. Both Owner reads finish before the
/// move-only input is issued; a missing or mismatched Research, Intent, Design, Plan, or Artifact
/// binding returns no partial input.
pub async fn resolve_native_replay_preparation_inputs_v2_in_transaction<P>(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    replay_locator: &ExploratoryReplayRequestLocatorV2,
    composer_port: &P,
) -> Result<NativeReplayPreparationInputsV2, NativeReplayPreparationInputsErrorV2>
where
    P: DevelopComposerSealedReadPortV2 + ?Sized,
{
    let resolved = resolve_native_replay_rd_cut_v2_in_transaction(transaction, replay_locator)
        .await
        .map_err(|e| NativeReplayPreparationInputsErrorV2::Unavailable(e.to_string()))?;
    let request = resolved.replay.request().as_dto();
    let composer_locator = resolve_develop_composer_locator_for_replay_v2_in_transaction(
        transaction,
        request.artifact.identity.as_str(),
        parse_sha256_content(&request.artifact.digest)?,
        parse_sha256_content(&request.strategy_plan.digest)?,
        parse_sha256_content(&request.strategy_design.digest)?,
    )
    .await
    .map_err(composer_unavailable)?;
    let composer = match resolved.composer_transition.as_ref() {
        None => composer_port
            .read_accepted(&composer_locator)
            .await
            .map_err(composer_unavailable)?,
        #[cfg(feature = "sealed-source-intake-composer-acceptance")]
        Some(transition) => {
            read_composer_at_replay_transition(transaction, &composer_locator, transition).await?
        }
        #[cfg(not(feature = "sealed-source-intake-composer-acceptance"))]
        Some(transition) => match **transition {},
    };
    issue_native_replay_preparation_inputs_v2(
        resolved.replay,
        resolved.sources,
        composer,
        &resolved.research,
    )
}

/// Reads the Composer operation a COMPOSER_V3 Replay was composed from, as it stood when the Replay
/// committed.
///
/// The current Composer read refuses it: the Replay has moved the Research View past the
/// IntentFrozen View the operation ran under, and that read wants the current custody to still be
/// that View. So it is read the way the Replay's own readback reads it, over the Replay's verified
/// View transition and in this transaction.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
async fn read_composer_at_replay_transition(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    locator: &crate::develop_composer_postgres_v2::DevelopComposerSealedReadLocatorV2,
    transition: &crate::rd_owner_postgres_custody::NativeComposerViewTransitionV3,
) -> Result<SealedDevelopComposerReadbackV2, NativeReplayPreparationInputsErrorV2> {
    let new_view = transition.new_view();
    let (Some(exploration), Some(composer_view)) = (
        new_view.exploration.as_ref(),
        new_view.composer_artifact.as_ref(),
    ) else {
        return Err(unavailable(
            "the Replay's View transition names no Composer exploration",
        ));
    };
    crate::develop_composer_postgres_v2::read_accepted_for_replay_historical_in_transaction(
        transaction,
        locator,
        transition.old_view(),
        new_view,
        exploration,
        composer_view,
    )
    .await
    .map_err(composer_unavailable)
}

fn composer_unavailable(
    _: DevelopComposerSealedReadErrorV2,
) -> NativeReplayPreparationInputsErrorV2 {
    NativeReplayPreparationInputsErrorV2::Unavailable(
        "accepted Composer custody read is unavailable".into(),
    )
}

fn issue_native_replay_preparation_inputs_v2(
    replay: SealedExploratoryReplayReadbackV2,
    rd_sources: NativeReplayRdSourcesV2,
    composer: SealedDevelopComposerReadbackV2,
    research: &VerifiedResearchCustodyV1,
) -> Result<NativeReplayPreparationInputsV2, NativeReplayPreparationInputsErrorV2> {
    let research_request_identity = research_request_identity(research)?;
    let research_intent_identity = research_intent_identity(research)?;
    let family = research
        .family()
        .cloned()
        .ok_or_else(|| unavailable("TrialFamily custody is unavailable"))?;
    let request = replay.request().as_dto();
    let composer_locator = composer.locator();

    if rd_sources.request_locator() != &replay.locator()
        || composer.research_request_identity() != research_request_identity
        || composer.intent_identity() != research_intent_identity
        || !named_identity_matches(
            request.frozen_research_intent.identity.as_str(),
            "rd-research-intent-v2-",
            composer.intent_identity(),
        )
        || !sha256_identity_matches(
            request.strategy_design.identity.as_str(),
            composer.design_identity(),
        )
        || !sha256_identity_matches(
            request.strategy_design.digest.as_str(),
            composer_locator.design_digest,
        )
        || !sha256_identity_matches(
            request.strategy_plan.identity.as_str(),
            composer_locator.canonical_plan_digest,
        )
        || !sha256_identity_matches(
            request.strategy_plan.digest.as_str(),
            composer_locator.canonical_plan_digest,
        )
        || request.artifact.identity.as_str() != composer_locator.artifact_locator
        || !sha256_identity_matches(
            request.artifact.digest.as_str(),
            composer_locator.artifact_identity,
        )
    {
        return Err(unavailable(
            "Replay, Research, and Composer custody bindings do not match",
        ));
    }

    Ok(NativeReplayPreparationInputsV2 {
        replay,
        rd_sources,
        composer,
        family,
    })
}

fn unavailable(message: impl Into<String>) -> NativeReplayPreparationInputsErrorV2 {
    NativeReplayPreparationInputsErrorV2::Unavailable(message.into())
}

fn research_request_identity(
    research: &VerifiedResearchCustodyV1,
) -> Result<BindingDigest, NativeReplayPreparationInputsErrorV2> {
    if research.request_schema_version() != 2 {
        return Err(unavailable("accepted Research V2 custody is unavailable"));
    }
    let mut hasher = Sha256::new();
    hasher.update(b"rd.develop.request-identity.v2\0");
    hasher.update(research.receipt().request_identity.as_bytes());
    Ok(BindingDigest::from_untrusted_bytes(
        hasher.finalize().into(),
    ))
}

fn research_intent_identity(
    research: &VerifiedResearchCustodyV1,
) -> Result<BindingDigest, NativeReplayPreparationInputsErrorV2> {
    let crate::product_edge::FrozenResearchGoalIntent::V2(intent) = research
        .intent()
        .ok_or_else(|| unavailable("accepted Research Intent V2 custody is unavailable"))?
    else {
        return Err(unavailable(
            "accepted Research Intent V2 custody is unavailable",
        ));
    };
    parse_sha256_suffix(&intent.intent_identity, "rd-research-intent-v2-")
        .ok_or_else(|| unavailable("canonical Research Intent V2 identity is unavailable"))
}

fn parse_sha256_suffix(value: &str, prefix: &str) -> Option<BindingDigest> {
    let hex = value.strip_prefix(prefix)?;
    if hex.len() != 64 {
        return None;
    }
    let mut bytes = [0_u8; 32];
    for (index, slot) in bytes.iter_mut().enumerate() {
        *slot = u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16).ok()?;
    }
    Some(BindingDigest::from_untrusted_bytes(bytes))
}

fn parse_sha256_content(
    value: &vibe_backtest_owner_contracts::CanonicalDigestV2,
) -> Result<BindingDigest, NativeReplayPreparationInputsErrorV2> {
    parse_sha256_suffix(value.as_str(), "sha256:")
        .ok_or_else(|| unavailable("canonical SHA-256 content digest is unavailable"))
}

fn named_identity_matches(value: &str, prefix: &str, expected: BindingDigest) -> bool {
    value == format!("{prefix}{}", hex(expected.as_bytes()))
}

fn sha256_identity_matches(value: &str, expected: BindingDigest) -> bool {
    value == format!("sha256:{}", hex(expected.as_bytes()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
