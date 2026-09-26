//! Operation routing custody: the writer the administrative bootstrap drives, and the read the
//! routing read port answers from. `docs/architecture/product-edge.md`, "Operation routing".

use sqlx::{PgPool, Postgres, Row, Transaction};

use super::{
    ProductEdgePostgresOwnerV1, Reason, Subject, begin_read_committed, database_now, from_i64,
    from_json, json, lock_deployment_authorizations, storage, to_i64, unavailable, unavailable_for,
    verify_deployment_history,
};
use crate::{
    ProductEdgeError, ProductEdgeOperationDispatcherV1,
    ProductEdgeOperationRoutingBindingContentV1, ProductEdgeOperationRoutingBindingV1,
    ProductEdgeOperationRoutingKeyV1, ProductEdgeOperationRoutingObservationV1,
    ProductEdgeOperationRoutingProposalV1,
};

/// The routing relations and their custody, in execution order. `migrate` runs them, so
/// `product-edge-authority-bootstrap materialize-schema` provisions them with every other Product
/// Edge relation, and `connect_existing` refuses a topology that lacks either table.
pub(super) const OPERATION_ROUTING_SCHEMA_STATEMENTS: [&str; 6] = [
    "CREATE TABLE IF NOT EXISTS public.product_edge_operation_routing_bindings_v1 (binding_identity TEXT PRIMARY KEY, deployment_identity TEXT NOT NULL, operation TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0), channel TEXT NOT NULL, generation BIGINT NOT NULL CHECK (generation > 0), predecessor_binding_identity TEXT REFERENCES public.product_edge_operation_routing_bindings_v1(binding_identity), deployment_binding_identity TEXT NOT NULL REFERENCES public.product_edge_deployment_bindings_v1(binding_identity), manifest_identity TEXT NOT NULL REFERENCES public.product_edge_operation_manifests_v1(manifest_identity), dispatcher TEXT NOT NULL CHECK (dispatcher IN ('WINDMILL', 'TRADE_DASHBOARD')), binding_digest TEXT NOT NULL UNIQUE, binding_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL CHECK (committed_at_epoch_ms >= 0), UNIQUE (deployment_identity, operation, version, channel, generation), CHECK ((generation = 1) = (predecessor_binding_identity IS NULL)))",
    "CREATE TABLE IF NOT EXISTS public.product_edge_operation_routing_heads_v1 (deployment_identity TEXT NOT NULL, operation TEXT NOT NULL, version INTEGER NOT NULL, channel TEXT NOT NULL, binding_identity TEXT NOT NULL REFERENCES public.product_edge_operation_routing_bindings_v1(binding_identity), generation BIGINT NOT NULL CHECK (generation > 0), state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'ZERO_ACTIVE')), changed_at_epoch_ms BIGINT NOT NULL CHECK (changed_at_epoch_ms >= 0), PRIMARY KEY (deployment_identity, operation, version, channel))",
    "ALTER TABLE public.product_edge_operation_routing_bindings_v1 OWNER TO product_edge_owner",
    "ALTER TABLE public.product_edge_operation_routing_heads_v1 OWNER TO product_edge_owner",
    "REVOKE ALL ON TABLE public.product_edge_operation_routing_bindings_v1 FROM PUBLIC, rd_owner, operator_authorization_owner, operator_authorization_writer, qualification_owner, qualification_writer, backtest_owner, portfolio_owner",
    "REVOKE ALL ON TABLE public.product_edge_operation_routing_heads_v1 FROM PUBLIC, rd_owner, operator_authorization_owner, operator_authorization_writer, qualification_owner, qualification_writer, backtest_owner, portfolio_owner",
];

#[derive(Debug)]
struct RoutingHeadV1 {
    binding_identity: String,
    generation: u64,
    active: bool,
}

impl ProductEdgePostgresOwnerV1 {
    /// Commits one administrative routing change for a key of this deployment.
    ///
    /// Only the explicit administrative writer calls this: no service start or product request
    /// path does. The change serializes against the exact current head of its key, and a new
    /// binding is committed only under the deployment's current `ACTIVE` binding, routing a
    /// manifest that binding admits for the key's operation.
    pub async fn commit_operation_routing(
        &self,
        proposal: ProductEdgeOperationRoutingProposalV1,
    ) -> Result<ProductEdgeOperationRoutingObservationV1, ProductEdgeError> {
        let key = proposal.key().clone();
        key.validate()?;
        if key.deployment_identity != self.deployment_identity {
            return Err(ProductEdgeError::InvalidProposal(
                "operation routing deployment",
            ));
        }
        let mut transaction = begin_read_committed(&self.pool).await?;
        lock_routing_key(&mut transaction, &key).await?;
        let head = load_routing_head(&mut transaction, &key, true).await?;
        let committed_at = database_now(&mut transaction).await?;

        let observation = match proposal {
            ProductEdgeOperationRoutingProposalV1::Genesis {
                dispatcher,
                manifest_identity,
                ..
            } => {
                if head.is_some() {
                    return Err(ProductEdgeError::ConflictingReplay);
                }
                let binding = self
                    .seal_routing_binding(
                        &mut transaction,
                        key,
                        1,
                        None,
                        dispatcher,
                        &manifest_identity,
                        committed_at,
                    )
                    .await?;
                insert_routing_binding(&mut transaction, &binding).await?;
                sqlx::query("INSERT INTO product_edge_operation_routing_heads_v1 (deployment_identity, operation, version, channel, binding_identity, generation, state, changed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7)")
                    .bind(&binding.key.deployment_identity)
                    .bind(&binding.key.operation)
                    .bind(i32::try_from(binding.key.version).map_err(storage)?)
                    .bind(&binding.key.channel)
                    .bind(&binding.binding_identity)
                    .bind(to_i64(binding.generation)?)
                    .bind(to_i64(committed_at)?)
                    .execute(&mut *transaction)
                    .await
                    .map_err(storage)?;
                ProductEdgeOperationRoutingObservationV1::Active {
                    binding,
                    observed_at_epoch_ms: committed_at,
                }
            }
            ProductEdgeOperationRoutingProposalV1::Successor {
                expected_head_identity,
                dispatcher,
                manifest_identity,
                ..
            } => {
                let head = expect_head(head, &expected_head_identity)?;
                let generation =
                    head.generation
                        .checked_add(1)
                        .ok_or(ProductEdgeError::InvalidProposal(
                            "operation routing generation",
                        ))?;
                let binding = self
                    .seal_routing_binding(
                        &mut transaction,
                        key,
                        generation,
                        Some(head.binding_identity),
                        dispatcher,
                        &manifest_identity,
                        committed_at,
                    )
                    .await?;
                insert_routing_binding(&mut transaction, &binding).await?;
                update_routing_head(
                    &mut transaction,
                    &binding.key,
                    &binding.binding_identity,
                    binding.generation,
                    "ACTIVE",
                    committed_at,
                )
                .await?;
                ProductEdgeOperationRoutingObservationV1::Active {
                    binding,
                    observed_at_epoch_ms: committed_at,
                }
            }
            ProductEdgeOperationRoutingProposalV1::Withdraw {
                expected_head_identity,
                ..
            } => {
                let head = expect_head(head, &expected_head_identity)?;
                if !head.active {
                    return Err(ProductEdgeError::ConflictingReplay);
                }
                update_routing_head(
                    &mut transaction,
                    &key,
                    &head.binding_identity,
                    head.generation,
                    "ZERO_ACTIVE",
                    committed_at,
                )
                .await?;
                ProductEdgeOperationRoutingObservationV1::ZeroActive {
                    key,
                    generation: head.generation,
                    history_head_identity: head.binding_identity,
                    observed_at_epoch_ms: committed_at,
                }
            }
        };
        transaction.commit().await.map_err(storage)?;
        Ok(observation)
    }

    #[expect(clippy::too_many_arguments, reason = "one binding's full content")]
    async fn seal_routing_binding(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        key: ProductEdgeOperationRoutingKeyV1,
        generation: u64,
        predecessor_binding_identity: Option<String>,
        dispatcher: ProductEdgeOperationDispatcherV1,
        manifest_identity: &str,
        committed_at: u64,
    ) -> Result<ProductEdgeOperationRoutingBindingV1, ProductEdgeError> {
        let (hinted_bindings, authorization_plan) =
            lock_deployment_authorizations(transaction, &self.deployment_identity, []).await?;
        let history = verify_deployment_history(
            transaction,
            &self.deployment_identity,
            false,
            &hinted_bindings,
            &authorization_plan,
        )
        .await?
        .ok_or_else(|| {
            unavailable_for(
                Reason::Missing,
                Subject::Deployment,
                &self.deployment_identity,
            )
        })?;
        let deployment_binding = history.current()?;
        if !deployment_binding
            .manifest_identities
            .iter()
            .any(|admitted| admitted == manifest_identity)
        {
            return Err(ProductEdgeError::InvalidProposal(
                "operation routing manifest not admitted",
            ));
        }
        let manifest = sqlx::query(
            "SELECT operation, manifest_digest FROM product_edge_operation_manifests_v1 WHERE manifest_identity=$1 FOR SHARE",
        )
        .bind(manifest_identity)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(storage)?
        .ok_or_else(|| unavailable_for(Reason::Missing, Subject::Manifest, manifest_identity))?;
        let operation: String = manifest.try_get("operation").map_err(storage)?;
        if operation != key.operation {
            return Err(ProductEdgeError::InvalidProposal(
                "operation routing manifest operation",
            ));
        }
        ProductEdgeOperationRoutingBindingContentV1 {
            schema_version: 1,
            key,
            generation,
            predecessor_binding_identity,
            deployment_binding_identity: deployment_binding.binding_identity.clone(),
            deployment_binding_digest: deployment_binding.binding_digest.clone(),
            manifest_identity: manifest_identity.to_string(),
            manifest_digest: manifest.try_get("manifest_digest").map_err(storage)?,
            dispatcher,
            committed_at_epoch_ms: committed_at,
        }
        .seal()
    }
}

/// Read-only capability behind `GET /v1/operation-routing`, for the one deployment its service is
/// configured for. It exposes no pool and no routing mutation.
#[derive(Clone)]
pub struct ProductEdgePostgresOperationRoutingReadPortV1 {
    pool: PgPool,
    deployment_identity: String,
}

impl ProductEdgePostgresOperationRoutingReadPortV1 {
    pub async fn connect(
        database_url: &str,
        deployment_identity: impl Into<String>,
    ) -> Result<Self, ProductEdgeError> {
        let deployment_identity = deployment_identity.into();
        if deployment_identity.trim().is_empty()
            || deployment_identity.trim() != deployment_identity
        {
            return Err(ProductEdgeError::InvalidProposal("deployment locator"));
        }
        let pool = PgPool::connect(database_url).await.map_err(storage)?;
        Ok(Self {
            pool,
            deployment_identity,
        })
    }

    pub fn deployment_identity(&self) -> &str {
        &self.deployment_identity
    }

    /// The routing key this port answers for `operation`, `version`, and `channel`, refused when
    /// it names no operation, before any store is read.
    pub fn key(
        &self,
        operation: &str,
        version: u32,
        channel: &str,
    ) -> Result<ProductEdgeOperationRoutingKeyV1, ProductEdgeError> {
        let key = ProductEdgeOperationRoutingKeyV1 {
            deployment_identity: self.deployment_identity.clone(),
            operation: operation.to_string(),
            version,
            channel: channel.to_string(),
        };
        key.validate()?;
        Ok(key)
    }

    /// Answers one routing key of this deployment in a read-only transaction that takes no row
    /// lock.
    pub async fn resolve(
        &self,
        key: &ProductEdgeOperationRoutingKeyV1,
    ) -> Result<ProductEdgeOperationRoutingObservationV1, ProductEdgeError> {
        key.validate()?;
        if key.deployment_identity != self.deployment_identity {
            return Err(ProductEdgeError::InvalidProposal(
                "operation routing deployment",
            ));
        }
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED, READ ONLY")
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
        let observation = read_in_transaction(&mut transaction, key).await?;
        transaction.rollback().await.map_err(storage)?;
        Ok(observation)
    }
}

async fn read_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    key: &ProductEdgeOperationRoutingKeyV1,
) -> Result<ProductEdgeOperationRoutingObservationV1, ProductEdgeError> {
    let Some(head) = load_routing_head(transaction, key, false).await? else {
        return Ok(ProductEdgeOperationRoutingObservationV1::Absent);
    };

    if !head.active {
        return Ok(ProductEdgeOperationRoutingObservationV1::ZeroActive {
            key: key.clone(),
            generation: head.generation,
            history_head_identity: head.binding_identity,
            observed_at_epoch_ms: database_now(transaction).await?,
        });
    }
    let row = sqlx::query(
        "SELECT binding_json FROM product_edge_operation_routing_bindings_v1 WHERE binding_identity=$1",
    )
    .bind(&head.binding_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(storage)?
    .ok_or_else(|| unavailable(Reason::Missing))?;
    let binding: ProductEdgeOperationRoutingBindingV1 =
        from_json(row.try_get("binding_json").map_err(storage)?)?;
    binding.verify()?;
    if binding.key != *key
        || binding.binding_identity != head.binding_identity
        || binding.generation != head.generation
    {
        return Err(unavailable(Reason::LineageBroken));
    }
    let deployment_head = sqlx::query(
        "SELECT head.binding_identity, head.binding_digest, EXISTS (SELECT 1 FROM product_edge_deployment_supersessions_v1 supersession WHERE supersession.binding_identity=head.binding_identity) AS superseded FROM product_edge_deployment_heads_v1 head WHERE head.deployment_identity=$1",
    )
    .bind(&key.deployment_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(storage)?;
    let current = match deployment_head {
        Some(row) => {
            let superseded: bool = row.try_get("superseded").map_err(storage)?;
            let identity: String = row.try_get("binding_identity").map_err(storage)?;
            let digest: String = row.try_get("binding_digest").map_err(storage)?;
            !superseded
                && identity == binding.deployment_binding_identity
                && digest == binding.deployment_binding_digest
        }
        None => false,
    };

    if !current {
        return Ok(ProductEdgeOperationRoutingObservationV1::Stale);
    }
    Ok(ProductEdgeOperationRoutingObservationV1::Active {
        binding,
        observed_at_epoch_ms: database_now(transaction).await?,
    })
}

async fn lock_routing_key(
    transaction: &mut Transaction<'_, Postgres>,
    key: &ProductEdgeOperationRoutingKeyV1,
) -> Result<(), ProductEdgeError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!(
            "operation-routing\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}",
            key.deployment_identity, key.operation, key.version, key.channel
        ))
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn load_routing_head(
    transaction: &mut Transaction<'_, Postgres>,
    key: &ProductEdgeOperationRoutingKeyV1,
    for_update: bool,
) -> Result<Option<RoutingHeadV1>, ProductEdgeError> {
    let query = if for_update {
        "SELECT binding_identity, generation, state FROM product_edge_operation_routing_heads_v1 WHERE deployment_identity=$1 AND operation=$2 AND version=$3 AND channel=$4 FOR UPDATE"
    } else {
        "SELECT binding_identity, generation, state FROM product_edge_operation_routing_heads_v1 WHERE deployment_identity=$1 AND operation=$2 AND version=$3 AND channel=$4"
    };
    let Some(row) = sqlx::query(query)
        .bind(&key.deployment_identity)
        .bind(&key.operation)
        .bind(i32::try_from(key.version).map_err(storage)?)
        .bind(&key.channel)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(storage)?
    else {
        return Ok(None);
    };
    let state: String = row.try_get("state").map_err(storage)?;
    Ok(Some(RoutingHeadV1 {
        binding_identity: row.try_get("binding_identity").map_err(storage)?,
        generation: from_i64(row.try_get("generation").map_err(storage)?)?,
        active: state == "ACTIVE",
    }))
}

fn expect_head(
    head: Option<RoutingHeadV1>,
    expected_head_identity: &str,
) -> Result<RoutingHeadV1, ProductEdgeError> {
    match head {
        Some(head) if head.binding_identity == expected_head_identity => Ok(head),
        _ => Err(ProductEdgeError::ConflictingReplay),
    }
}

async fn insert_routing_binding(
    transaction: &mut Transaction<'_, Postgres>,
    binding: &ProductEdgeOperationRoutingBindingV1,
) -> Result<(), ProductEdgeError> {
    sqlx::query("INSERT INTO product_edge_operation_routing_bindings_v1 (binding_identity, deployment_identity, operation, version, channel, generation, predecessor_binding_identity, deployment_binding_identity, manifest_identity, dispatcher, binding_digest, binding_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)")
        .bind(&binding.binding_identity)
        .bind(&binding.key.deployment_identity)
        .bind(&binding.key.operation)
        .bind(i32::try_from(binding.key.version).map_err(storage)?)
        .bind(&binding.key.channel)
        .bind(to_i64(binding.generation)?)
        .bind(&binding.predecessor_binding_identity)
        .bind(&binding.deployment_binding_identity)
        .bind(&binding.manifest_identity)
        .bind(binding.dispatcher.as_str())
        .bind(&binding.binding_digest)
        .bind(json(binding)?)
        .bind(to_i64(binding.committed_at_epoch_ms)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn update_routing_head(
    transaction: &mut Transaction<'_, Postgres>,
    key: &ProductEdgeOperationRoutingKeyV1,
    binding_identity: &str,
    generation: u64,
    state: &str,
    changed_at: u64,
) -> Result<(), ProductEdgeError> {
    let updated = sqlx::query("UPDATE product_edge_operation_routing_heads_v1 SET binding_identity=$5, generation=$6, state=$7, changed_at_epoch_ms=$8 WHERE deployment_identity=$1 AND operation=$2 AND version=$3 AND channel=$4")
        .bind(&key.deployment_identity)
        .bind(&key.operation)
        .bind(i32::try_from(key.version).map_err(storage)?)
        .bind(&key.channel)
        .bind(binding_identity)
        .bind(to_i64(generation)?)
        .bind(state)
        .bind(to_i64(changed_at)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;

    if updated.rows_affected() != 1 {
        return Err(ProductEdgeError::ConflictingReplay);
    }
    Ok(())
}
