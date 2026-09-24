//! Current source-bound Research as a reusable acceptance precondition.
//!
//! An ordered-chain entry that needs Research custody used to take whichever custody an earlier
//! entry had left behind, so it failed when that entry did not run first, or once that custody's
//! validity lapsed. This module creates or exact-resolves the entry's own Research instead,
//! through the production Owners only:
//!
//! 1. `ensure_replay_policy_catalog_fixture_v3`: the current Replay Policy Catalog V3 head the
//!    Research TrialFamily is formed against;
//! 2. `SourceIntakeOwnerV1::sealed_acceptance(..).resolve`, then `.run` when nothing is terminal
//!    yet: one sealed Source Intake terminal;
//! 3. `ProductEdgePostgresOwnerV1::admit_request`: the Research Goal V2 admission;
//! 4. `PostgresResearchGoalOwnerV1::submit_source_intake_research_v2`: the Research custody;
//! 5. `PostgresResearchBoundedFeatureProgramOwnerV1::read_research_authoring_facts_v1`: the proof
//!    that the custody is current at an R&D Owner clock cut.
//!
//! No row is written or read here by hand. Idempotency is the Owners' own: every step replays an
//! identical request to its stored answer and refuses a changed one, so a second call with the
//! same Research identity returns the same custody and a call whose stored custody differs fails
//! by name. Custody whose Research View validity has passed on the R&D Owner clock is refused as
//! [`CurrentSourceBoundResearchAcceptanceErrorV1::Expired`] before any step is replayed.
//!
//! The Product Edge deployment is the caller's. Its genesis must already admit both
//! `SOURCE_INTAKE_OPERATION_V1` and `RESEARCH_GOAL_OPERATION_V2`, with the `research:source-intake`,
//! `research:submit` and `research:view` permissions, because Product Edge fixes a deployment's
//! operation set at genesis. This module only uses that deployment, and does not extend it.
//!
//! Named gaps, all inherited from the sealed Source Intake rather than introduced here:
//! the terminal is the fixed-corpus OpenAlex response for `10.5555/sealed-success`, not a recorded
//! provider response; its policy evidence and retrieval time are sealed fixture values; and its
//! binding, reservation and terminal commit times are fixed constants, not Owner clock readings.

use std::sync::Arc;

use thiserror::Error;
use vibe_product_edge::{
    ProductEdgeAdmissionRequestV1, ProductEdgeError, ProductEdgePostgresOwnerV1,
};

use crate::{
    ReplayPolicyCatalogErrorV2,
    product_edge::{
        ProductEdgeChannel, ProductEdgeResolution, RESEARCH_GOAL_OPERATION_V2,
        RESEARCH_GOAL_SCHEMA_V2, RESEARCH_OWNER_V1, ResearchGoalOwnerError,
        ResearchGoalOwnerResultV2, ResearchReadbackOwnerPortV1, TrialFamilyProposalV1,
        UnsourcedResearchGoalV1, UnsourcedResearchProposalV1,
    },
    product_edge_postgres::PostgresResearchGoalOwnerV1,
    rd_bounded_feature_program_postgres_v1::{
        PostgresResearchBoundedFeatureProgramOwnerV1, ResearchAuthoringFactsV1,
        ResearchBoundedFeatureProgramOwnerErrorV1,
    },
    replay_policy_catalog_sealed_acceptance_v2::ensure_replay_policy_catalog_fixture_v3,
    source_intake::{
        AcquisitionTerminalV1, ProductEdgeGatewayV1, SealedSourceIntakeEnvironmentV1,
        SourceIntakeOperationRequestV1, SourceIntakeOwnerErrorV1, SourceIntakeOwnerV1,
        SourceIntakeResearchAncestryProposalV1, SourceInterpretationV1,
    },
};

/// The only DOI the sealed Source Intake provider answers `RETRIEVED` for.
const SEALED_SOURCE_DOI: &str = "10.5555/sealed-success";
/// The effect a Research Goal V2 admission requests.
const RESEARCH_MUTATION_EFFECT: &str = "R_AND_D_RESEARCH_MUTATION_V1";
/// The falsification question every Research this module creates freezes.
const FALSIFICATION_QUESTION: &str = "Does the fixed control erase the effect?";
/// The cost, slippage and capacity model identities the sealed Catalog V3 head names. The Owner
/// forms a TrialFamily only against a head whose models equal the proposal's.
const CATALOG_MODELS: (&str, &str, &str) =
    ("cost-model-v1", "slippage-model-v1", "capacity-model-v1");

/// Research custody that was current at an R&D Owner clock cut.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentSourceBoundResearchV1 {
    /// The locator every R&D consumer resolves the custody by; the caller's Research identity.
    pub research_request_locator: String,
    /// The custody facts an authored Design restates, read at that cut.
    pub authoring: ResearchAuthoringFactsV1,
    /// The frozen Research Intent, as the Research View names it.
    pub intent_identity: String,
    /// The Research request receipt.
    pub research_receipt_identity: String,
    /// The TrialFamily the Research formed.
    pub trial_family_identity: String,
    /// The pre-feedback independence basis the Research sealed.
    pub independence_basis_identity: String,
    /// The Source Intake request the Research is bound to.
    pub source_intake_request_identity: String,
    /// The Research View validity bound, on the R&D Owner clock.
    pub valid_through_epoch_ms: u64,
}

/// Why current source-bound Research could not be created or resolved, named by the step that
/// refused.
#[derive(Debug, Error)]
pub enum CurrentSourceBoundResearchAcceptanceErrorV1 {
    /// A Research identity must be a non-empty ASCII identity the Owners accept.
    #[error("the Research identity is not a valid Owner identity")]
    InvalidResearchIdentity,
    /// An Owner database did not accept the connection.
    #[error("the {owner} database is unreachable: {source}")]
    Connect {
        owner: &'static str,
        #[source]
        source: sqlx::Error,
    },
    /// The R&D Owner clock could not be read.
    #[error("the R&D Owner clock is unreadable: {0}")]
    OwnerClock(#[source] sqlx::Error),
    /// The Research already exists and its Research View validity has passed.
    #[error(
        "Research custody expired: valid through {valid_through_epoch_ms}, R&D Owner clock {owner_clock_epoch_ms}"
    )]
    Expired {
        valid_through_epoch_ms: u64,
        owner_clock_epoch_ms: u64,
    },
    /// The Replay Policy Catalog V3 head could not be ensured or does not verify.
    #[error("the Replay Policy Catalog V3 head is unavailable: {0}")]
    Catalog(#[source] ReplayPolicyCatalogErrorV2),
    /// The current Catalog V3 head names other models than the Research proposal.
    #[error("the Catalog V3 head names models {actual:?}, not the proposal's")]
    CatalogModels { actual: (String, String, String) },
    /// The sealed Source Intake Owner refused.
    #[error("the sealed Source Intake refused: {0:?}")]
    SourceIntake(SourceIntakeOwnerErrorV1),
    /// The sealed Source Intake left the request unresolved.
    #[error("the sealed Source Intake did not reach a terminal")]
    SourceIntakeUnresolved,
    /// The sealed Source Intake terminal is not `RETRIEVED`.
    #[error("the sealed Source Intake terminal is {0:?}, not RETRIEVED")]
    SourceIntakeNotRetrieved(AcquisitionTerminalV1),
    /// Product Edge refused the Research Goal V2 admission.
    #[error("Product Edge refused the Research admission: {0}")]
    ResearchAdmission(#[source] ProductEdgeError),
    /// The Research Owner refused the submission or the readback.
    #[error("the Research Owner refused: {0}")]
    Research(#[source] ResearchGoalOwnerError),
    /// The Research Owner answered without accepting the Research.
    #[error("the Research was not accepted: {resolution:?}, rejection code {rejection_code:?}")]
    ResearchNotAccepted {
        resolution: ProductEdgeResolution,
        rejection_code: Option<String>,
    },
    /// The accepted Research answer is missing a part an accepted answer carries.
    #[error("the accepted Research answer has no {0}")]
    ResearchIncomplete(&'static str),
    /// The accepted custody is not current at an R&D Owner clock cut.
    #[error("the Research custody is not current: {0}")]
    NotCurrent(#[source] ResearchBoundedFeatureProgramOwnerErrorV1),
    /// The custody read at the cut is not the custody this module submitted.
    #[error("the current Research custody differs in {0}")]
    ContentMismatch(&'static str),
}

type Error = CurrentSourceBoundResearchAcceptanceErrorV1;

/// Creates or exact-resolves current source-bound Research for `research_identity`.
///
/// `product_edge` is the caller's deployment and `request_proof_digest` the proof digest its
/// authorization was issued for; see the module documentation for what its genesis must admit.
/// The Source Intake request is `{research_identity}-source`. `catalog_admin_url` is the Replay
/// Policy Catalog administrator role; `rd_owner_url` and `qualification_writer_url` are the R&D
/// Owner and Qualification writer roles the Research Owner connects as.
///
/// # Errors
///
/// Every refusal is named by the step that refused; see
/// [`CurrentSourceBoundResearchAcceptanceErrorV1`].
pub async fn ensure_current_source_bound_research_acceptance_fixture_v1(
    rd_owner_url: &str,
    qualification_writer_url: &str,
    catalog_admin_url: &str,
    product_edge: Arc<ProductEdgePostgresOwnerV1>,
    request_proof_digest: &str,
    research_identity: &str,
) -> Result<CurrentSourceBoundResearchV1, Error> {
    let source_intake_request_identity = source_intake_request_identity(research_identity)?;

    let research_owner =
        PostgresResearchGoalOwnerV1::connect(rd_owner_url, qualification_writer_url)
            .await
            .map_err(Error::Research)?
            .bind_sealed_source_intake_research_policy();
    let rd_pool = connect("R&D Owner", rd_owner_url).await?;

    // An existing Research is judged on the Owner clock before anything is replayed: a replay
    // after the Product Edge authorization lapsed would otherwise be refused by a step that cannot
    // say the custody expired.
    let existing = research_owner
        .read_research_v2(research_identity)
        .await
        .map_err(Error::Research)?;

    if let Some(view) = existing.research_view() {
        refuse_expired(
            view.valid_through_epoch_ms,
            owner_clock_epoch_ms(&rd_pool).await?,
        )?;
    }

    let catalog_pool = connect("Replay Policy Catalog", catalog_admin_url).await?;
    let catalog = ensure_replay_policy_catalog_fixture_v3(&catalog_pool)
        .await
        .map_err(Error::Catalog)?;
    catalog_pool.close().await;
    let policy = catalog
        .replay_policy_v2()
        .verify()
        .map_err(Error::Catalog)?;
    let actual = (
        policy.cost.identity.as_str().to_owned(),
        policy.slippage.identity.as_str().to_owned(),
        policy.capacity.identity.as_str().to_owned(),
    );

    if (actual.0.as_str(), actual.1.as_str(), actual.2.as_str()) != CATALOG_MODELS {
        return Err(Error::CatalogModels { actual });
    }

    let source_intake = SourceIntakeOwnerV1::sealed_acceptance(
        SealedSourceIntakeEnvironmentV1::new(
            product_edge.clone(),
            rd_pool.clone(),
            request_proof_digest.to_owned(),
        )
        .map_err(Error::SourceIntake)?,
    );
    let terminal = match source_intake
        .resolve(&source_intake_request_identity)
        .await
        .map_err(Error::SourceIntake)?
    {
        Some(terminal) => terminal,
        None => source_intake
            .run(SourceIntakeOperationRequestV1 {
                request_identity: source_intake_request_identity.clone(),
                channel: ProductEdgeGatewayV1::WindmillProductEdge,
                normalized_doi: SEALED_SOURCE_DOI.into(),
                interpretation: source_interpretation(),
            })
            .await
            .map_err(Error::SourceIntake)?
            .ok_or(Error::SourceIntakeUnresolved)?,
    };

    if terminal.terminal != AcquisitionTerminalV1::Retrieved {
        return Err(Error::SourceIntakeNotRetrieved(terminal.terminal));
    }

    let (goal, trial_family_proposal) = research_proposal();
    let admission = product_edge
        .admit_request(ProductEdgeAdmissionRequestV1 {
            request_identity: research_identity.to_owned(),
            typed_payload: research_admission_payload(
                research_identity,
                &goal,
                &trial_family_proposal,
            ),
            operation: RESEARCH_GOAL_OPERATION_V2.into(),
            operation_schema: RESEARCH_GOAL_SCHEMA_V2.into(),
            target_owner: RESEARCH_OWNER_V1.into(),
            requested_effects: vec![RESEARCH_MUTATION_EFFECT.into()],
            request_proof_digest: request_proof_digest.to_owned(),
            audit_correlation: format!("source-bound-research-fixture:{research_identity}"),
        })
        .await
        .map_err(Error::ResearchAdmission)?;
    let accepted = research_owner
        .submit_source_intake_research_v2(
            UnsourcedResearchProposalV1 {
                request_identity: research_identity.to_owned(),
                channel: ProductEdgeChannel::WindmillProductEdge,
                admission: admission.locator().clone(),
                goal,
                trial_family_proposal,
            },
            SourceIntakeResearchAncestryProposalV1 {
                request_identity: source_intake_request_identity.clone(),
                attempt_identity: terminal.binding_identity.clone(),
                terminal_receipt_identity: terminal.receipt.receipt_identity.clone(),
            },
        )
        .await
        .map_err(Error::Research)?;
    let accepted = AcceptedResearchV1::from_owner_answer(&accepted, research_identity)?;

    let facts_owner = PostgresResearchBoundedFeatureProgramOwnerV1::new(rd_pool.clone());
    let authoring = Box::pin(facts_owner.read_research_authoring_facts_v1(research_identity)).await;
    let authoring = match authoring {
        Ok(authoring) => authoring,
        Err(e) => {
            refuse_expired(
                accepted.valid_through_epoch_ms,
                owner_clock_epoch_ms(&rd_pool).await?,
            )?;
            return Err(Error::NotCurrent(e));
        }
    };

    if authoring.falsifier != FALSIFICATION_QUESTION {
        return Err(Error::ContentMismatch("falsifier"));
    }

    Ok(CurrentSourceBoundResearchV1 {
        research_request_locator: research_identity.to_owned(),
        authoring,
        intent_identity: accepted.intent_identity,
        research_receipt_identity: accepted.research_receipt_identity,
        trial_family_identity: accepted.trial_family_identity,
        independence_basis_identity: accepted.independence_basis_identity,
        source_intake_request_identity,
        valid_through_epoch_ms: accepted.valid_through_epoch_ms,
    })
}

/// The parts of an accepted Research Owner answer this module returns.
#[derive(Debug, Eq, PartialEq)]
struct AcceptedResearchV1 {
    intent_identity: String,
    research_receipt_identity: String,
    trial_family_identity: String,
    independence_basis_identity: String,
    valid_through_epoch_ms: u64,
}

impl AcceptedResearchV1 {
    fn from_owner_answer(
        answer: &ResearchGoalOwnerResultV2,
        research_identity: &str,
    ) -> Result<Self, Error> {
        if answer.resolution() != ProductEdgeResolution::Accepted {
            return Err(Error::ResearchNotAccepted {
                resolution: answer.resolution(),
                rejection_code: answer
                    .owner_receipt()
                    .and_then(|receipt| receipt.rejection_code.clone()),
            });
        }

        if answer.request_identity() != research_identity {
            return Err(Error::ContentMismatch("request identity"));
        }
        let receipt = answer
            .owner_receipt()
            .ok_or(Error::ResearchIncomplete("owner receipt"))?;
        let view = answer
            .research_view()
            .ok_or(Error::ResearchIncomplete("Research View"))?;
        if view.request_identity != research_identity {
            return Err(Error::ContentMismatch("Research View request identity"));
        }

        if receipt.resulting_research_intent_identity.as_deref()
            != Some(view.intent_identity.as_str())
        {
            return Err(Error::ContentMismatch("Research Intent"));
        }
        let trial_family = answer
            .trial_family()
            .ok_or(Error::ResearchIncomplete("TrialFamily"))?;
        let independence_basis = answer
            .independence_basis()
            .ok_or(Error::ResearchIncomplete("independence basis"))?;
        Ok(Self {
            intent_identity: view.intent_identity.clone(),
            research_receipt_identity: receipt.receipt_identity.clone(),
            trial_family_identity: trial_family.root.trial_family_identity().to_owned(),
            independence_basis_identity: independence_basis.basis_identity().to_owned(),
            valid_through_epoch_ms: view.valid_through_epoch_ms,
        })
    }
}

fn source_intake_request_identity(research_identity: &str) -> Result<String, Error> {
    if research_identity.is_empty()
        || research_identity.len() > 128
        || !research_identity
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(Error::InvalidResearchIdentity);
    }
    Ok(format!("{research_identity}-source"))
}

fn refuse_expired(valid_through_epoch_ms: u64, owner_clock_epoch_ms: u64) -> Result<(), Error> {
    if owner_clock_epoch_ms >= valid_through_epoch_ms {
        return Err(Error::Expired {
            valid_through_epoch_ms,
            owner_clock_epoch_ms,
        });
    }
    Ok(())
}

async fn connect(owner: &'static str, url: &str) -> Result<sqlx::PgPool, Error> {
    sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(url)
        .await
        .map_err(|source| Error::Connect { owner, source })
}

async fn owner_clock_epoch_ms(rd_pool: &sqlx::PgPool) -> Result<u64, Error> {
    let mut transaction = rd_pool.begin().await.map_err(Error::OwnerClock)?;
    let reading = crate::rd_owner_clock::owner_clock_epoch_ms_in_transaction(&mut transaction)
        .await
        .map_err(Error::OwnerClock)?;
    transaction.rollback().await.map_err(Error::OwnerClock)?;
    Ok(reading)
}

fn source_interpretation() -> SourceInterpretationV1 {
    SourceInterpretationV1 {
        bounded_explanation: "The paper may describe a testable mechanism.".into(),
        plausible_alternatives: vec!["The reported effect is selection bias.".into()],
        differentiating_prediction: "The mechanism survives a later untouched cut.".into(),
        falsifier: "The effect disappears under the frozen cost model.".into(),
    }
}

fn research_proposal() -> (UnsourcedResearchGoalV1, TrialFamilyProposalV1) {
    (
        UnsourcedResearchGoalV1 {
            hypothesis: "The sealed source supports one bounded hypothesis.".into(),
            mechanism: "The reported mechanism survives the fixed control.".into(),
            falsification_question: FALSIFICATION_QUESTION.into(),
            expected_observation: "The effect remains directionally stable.".into(),
            required_data: vec!["sealed-source-v1".into()],
            cost_assumption: "Fixed sealed cost model.".into(),
            capacity_assumption: "Fixed sealed capacity model.".into(),
        },
        TrialFamilyProposalV1 {
            trial_budget: 1,
            stop_rule: "Stop after the fixed sealed trial.".into(),
            pit_rule_identity: "sealed-pit-rule-v1".into(),
            cost_model_identity: CATALOG_MODELS.0.into(),
            slippage_model_identity: CATALOG_MODELS.1.into(),
            capacity_model_identity: CATALOG_MODELS.2.into(),
            independence_rationale: "Genesis has no semantic predecessor.".into(),
        },
    )
}

/// The Research Goal V2 payload Product Edge seals and the Research Owner re-verifies against the
/// submitted proposal.
fn research_admission_payload(
    research_identity: &str,
    goal: &UnsourcedResearchGoalV1,
    trial_family_proposal: &TrialFamilyProposalV1,
) -> serde_json::Value {
    serde_json::json!({
        "request_identity": research_identity,
        "channel": ProductEdgeChannel::WindmillProductEdge,
        "goal": goal,
        "trial_family_proposal": trial_family_proposal,
    })
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn the_source_request_is_derived_from_a_valid_research_identity_only() {
        assert_eq!(
            source_intake_request_identity("entry-91-research").unwrap(),
            "entry-91-research-source"
        );

        for invalid in ["", "has space", "slash/", &"x".repeat(129)] {
            assert!(
                matches!(
                    source_intake_request_identity(invalid),
                    Err(Error::InvalidResearchIdentity)
                ),
                "{invalid:?}"
            );
        }
    }

    #[rstest]
    fn custody_is_expired_from_its_validity_bound_on() {
        assert!(refuse_expired(1_000, 999).is_ok());
        for clock in [1_000, 1_001] {
            assert!(matches!(
                refuse_expired(1_000, clock),
                Err(Error::Expired {
                    valid_through_epoch_ms: 1_000,
                    owner_clock_epoch_ms
                }) if owner_clock_epoch_ms == clock
            ));
        }
    }

    #[rstest]
    fn the_admission_payload_carries_exactly_the_submitted_proposal() {
        let (goal, family) = research_proposal();
        let payload = research_admission_payload("r-1", &goal, &family);
        assert_eq!(payload["request_identity"], "r-1");
        assert_eq!(payload["channel"], "WINDMILL_PRODUCT_EDGE");
        assert_eq!(
            serde_json::from_value::<UnsourcedResearchGoalV1>(payload["goal"].clone()).unwrap(),
            goal
        );
        assert_eq!(
            serde_json::from_value::<TrialFamilyProposalV1>(
                payload["trial_family_proposal"].clone()
            )
            .unwrap(),
            family
        );
        assert_eq!(payload.as_object().unwrap().len(), 4);
    }

    #[rstest]
    fn the_proposal_names_the_models_the_sealed_catalog_head_names() {
        let policy = crate::replay_policy_catalog_postgres_v2::sealed_acceptance_policy().unwrap();
        assert_eq!(
            (
                policy.cost.identity.as_str(),
                policy.slippage.identity.as_str(),
                policy.capacity.identity.as_str(),
            ),
            CATALOG_MODELS
        );
        assert_eq!(
            research_proposal().0.falsification_question,
            FALSIFICATION_QUESTION
        );
    }

    #[rstest]
    fn this_module_writes_and_reads_no_row_by_hand() {
        let source = include_str!("source_bound_research_acceptance_fixture_v1.rs");
        let production = source.split("#[cfg(test)]").next().unwrap();

        for forbidden in [
            "sqlx::query",
            "query_as",
            "query_scalar",
            "INSERT ",
            "SELECT ",
        ] {
            assert!(!production.contains(forbidden), "{forbidden}");
        }
    }
}
