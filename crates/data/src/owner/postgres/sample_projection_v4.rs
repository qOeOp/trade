//! PostgreSQL custody for additive V4 BAR `FRAME/JOINED_CUT` projections.

use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};

#[cfg(test)]
use super::MarketDataReadPostgres;
use super::{
    MarketDataOwnerPostgres, load_sample_projection_schedule_dependencies_v3,
    load_strategy_input_sample_projection_v3, validate_sample_projection_dependencies_v3,
};
use crate::owner::observation_census::UntrustedStrategyInputJoinedCutLocatorV1;
use crate::owner::sample_projection_v4::{
    PreparedStrategyInputSampleProjectionV4, ScheduleDependencyV4,
    StrategyInputSampleProjectionErrorV4, StrategyInputSampleProjectionReadbackV4,
    StrategyInputSampleProjectionResolveErrorV4, StrategyInputSampleProjectionResolverV4,
    UntrustedStrategyInputSampleProjectionLocatorV4, V3_HEADER_LEN, decode_v4, schedule_set_digest,
};

pub(super) const SCHEMA_V4: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS market_data_private.strategy_input_sample_projection_receipts_v4(receipt_digest BYTEA PRIMARY KEY CHECK(octet_length(receipt_digest)=32),kind SMALLINT NOT NULL CHECK(kind IN (1,2)),lifecycle SMALLINT NOT NULL CHECK(lifecycle=2),subject_identity BYTEA NOT NULL CHECK(octet_length(subject_identity)=32),schedule_dependency_set_digest BYTEA NOT NULL CHECK(octet_length(schedule_dependency_set_digest)=32),component_count BIGINT NOT NULL CHECK(component_count>0),receipt_bytes BYTEA NOT NULL CHECK(octet_length(receipt_bytes)>0),custody_digest BYTEA NOT NULL CHECK(octet_length(custody_digest)=32))",
    "CREATE TABLE IF NOT EXISTS market_data_private.strategy_input_sample_projection_dependencies_v4(receipt_digest BYTEA NOT NULL REFERENCES market_data_private.strategy_input_sample_projection_receipts_v4(receipt_digest),component_ordinal BIGINT NOT NULL CHECK(component_ordinal>0),source_projection_digest BYTEA NOT NULL REFERENCES market_data_private.strategy_input_sample_projection_receipts_v3(receipt_digest),role_identity BYTEA NOT NULL CHECK(octet_length(role_identity)=32),binding_receipt_digest BYTEA NOT NULL CHECK(octet_length(binding_receipt_digest)=32),timeframe_projection_digest BYTEA NOT NULL CHECK(octet_length(timeframe_projection_digest)=32),schedule_readback_identity BYTEA NOT NULL CHECK(octet_length(schedule_readback_identity)=32),schedule_fact_digest BYTEA NOT NULL CHECK(octet_length(schedule_fact_digest)=32),schedule_cut_identity BYTEA NOT NULL CHECK(octet_length(schedule_cut_identity)=32),schedule_cut_digest BYTEA NOT NULL CHECK(octet_length(schedule_cut_digest)=32),schedule_receipt_identity BYTEA NOT NULL CHECK(octet_length(schedule_receipt_identity)=32),PRIMARY KEY(receipt_digest,component_ordinal),UNIQUE(receipt_digest,role_identity))",
    "CREATE TABLE IF NOT EXISTS market_data_private.strategy_input_sample_projection_readbacks_v4(receipt_digest BYTEA PRIMARY KEY REFERENCES market_data_private.strategy_input_sample_projection_receipts_v4(receipt_digest),readback_bytes BYTEA NOT NULL CHECK(octet_length(readback_bytes)>0),custody_digest BYTEA NOT NULL CHECK(octet_length(custody_digest)=32))",
    "CREATE TABLE IF NOT EXISTS market_data_private.strategy_input_sample_projection_outbox_v4(outbox_identity BYTEA PRIMARY KEY REFERENCES market_data_private.strategy_input_sample_projection_receipts_v4(receipt_digest),payload BYTEA NOT NULL CHECK(octet_length(payload)>0),custody_digest BYTEA NOT NULL CHECK(octet_length(custody_digest)=32))",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_strategy_input_sample_projection_v4(p_receipt_digest BYTEA) RETURNS TABLE(receipt_digest BYTEA,kind SMALLINT,lifecycle SMALLINT,subject_identity BYTEA,schedule_dependency_set_digest BYTEA,component_count BIGINT,receipt_bytes BYTEA,receipt_custody_digest BYTEA,readback_bytes BYTEA,readback_custody_digest BYTEA,outbox_identity BYTEA,outbox_payload BYTEA,outbox_custody_digest BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$ SELECT r.receipt_digest,r.kind,r.lifecycle,r.subject_identity,r.schedule_dependency_set_digest,r.component_count,r.receipt_bytes,r.custody_digest,b.readback_bytes,b.custody_digest,o.outbox_identity,o.payload,o.custody_digest FROM market_data_private.strategy_input_sample_projection_receipts_v4 r JOIN market_data_private.strategy_input_sample_projection_readbacks_v4 b USING(receipt_digest) JOIN market_data_private.strategy_input_sample_projection_outbox_v4 o ON o.outbox_identity=r.receipt_digest WHERE r.receipt_digest=p_receipt_digest AND r.component_count=(SELECT COUNT(*) FROM market_data_private.strategy_input_sample_projection_dependencies_v4 d WHERE d.receipt_digest=r.receipt_digest) $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_strategy_input_sample_projection_dependencies_v4(p_receipt_digest BYTEA) RETURNS TABLE(component_ordinal BIGINT,source_projection_digest BYTEA,role_identity BYTEA,binding_receipt_digest BYTEA,timeframe_projection_digest BYTEA,schedule_readback_identity BYTEA,schedule_fact_digest BYTEA,schedule_cut_identity BYTEA,schedule_cut_digest BYTEA,schedule_receipt_identity BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$ SELECT component_ordinal,source_projection_digest,role_identity,binding_receipt_digest,timeframe_projection_digest,schedule_readback_identity,schedule_fact_digest,schedule_cut_identity,schedule_cut_digest,schedule_receipt_identity FROM market_data_private.strategy_input_sample_projection_dependencies_v4 WHERE receipt_digest=p_receipt_digest ORDER BY component_ordinal $function$",
    "REVOKE ALL ON TABLE market_data_private.strategy_input_sample_projection_receipts_v4,market_data_private.strategy_input_sample_projection_dependencies_v4,market_data_private.strategy_input_sample_projection_readbacks_v4,market_data_private.strategy_input_sample_projection_outbox_v4 FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_strategy_input_sample_projection_v4(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_strategy_input_sample_projection_dependencies_v4(BYTEA) FROM PUBLIC",
];

const CUSTODY_DOMAIN: &[u8] = b"market-data.sample-projection-postgres-custody.v4\0";

pub(super) async fn install(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), StrategyInputSampleProjectionErrorV4> {
    for statement in SCHEMA_V4 {
        sqlx::query(*statement)
            .execute(&mut **transaction)
            .await
            .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUnavailable)?;
    }
    Ok(())
}

impl MarketDataOwnerPostgres {
    pub(crate) async fn commit_strategy_input_sample_projection_v4(
        &self,
        prepared: &PreparedStrategyInputSampleProjectionV4,
    ) -> Result<StrategyInputSampleProjectionReadbackV4, StrategyInputSampleProjectionErrorV4> {
        self.commit_strategy_input_sample_projection_inner_v4(prepared, false, false)
            .await
    }

    #[cfg(test)]
    pub(super) async fn commit_strategy_input_sample_projection_with_fault_v4(
        &self,
        prepared: &PreparedStrategyInputSampleProjectionV4,
        rollback: bool,
        response_loss: bool,
    ) -> Result<StrategyInputSampleProjectionReadbackV4, StrategyInputSampleProjectionErrorV4> {
        self.commit_strategy_input_sample_projection_inner_v4(prepared, rollback, response_loss)
            .await
    }

    async fn commit_strategy_input_sample_projection_inner_v4(
        &self,
        prepared: &PreparedStrategyInputSampleProjectionV4,
        rollback: bool,
        response_loss: bool,
    ) -> Result<StrategyInputSampleProjectionReadbackV4, StrategyInputSampleProjectionErrorV4> {
        let decoded = decode_v4(prepared.canonical_bytes(), prepared.receipt_digest())?;
        if schedule_set_digest(prepared.dependencies()) != prepared.schedule_dependency_set_digest()
            || prepared.dependencies().len() != prepared.component_count() as usize
        {
            return Err(StrategyInputSampleProjectionErrorV4::ScheduleDependencyMismatch);
        }
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUnavailable)?;
        lock(&mut transaction, prepared.receipt_digest()).await?;
        if prepared.kind()
            == crate::owner::sample_projection_v4::StrategyInputSampleProjectionKindV4::JoinedCut
        {
            validate_joined_subject(&mut transaction, &decoded).await?;
        }
        validate_v3_dependencies(&mut transaction, prepared.dependencies()).await?;
        validate_exact_v3_components(&mut transaction, &decoded, prepared.dependencies()).await?;
        if let Some(existing) = load(&mut transaction, prepared.receipt_digest()).await? {
            if existing.canonical_bytes() != prepared.canonical_bytes()
                || existing.kind() != prepared.kind()
                || existing.subject_identity() != prepared.subject_identity()
                || existing.schedule_dependency_set_digest()
                    != prepared.schedule_dependency_set_digest()
            {
                return Err(StrategyInputSampleProjectionErrorV4::IdentityConflict);
            }
            transaction
                .commit()
                .await
                .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUnavailable)?;
            return if response_loss {
                Err(StrategyInputSampleProjectionErrorV4::ResponseLost)
            } else {
                Ok(existing)
            };
        }
        let custody = custody_digest(
            prepared.receipt_digest(),
            prepared.canonical_bytes(),
            prepared.schedule_dependency_set_digest(),
        );
        sqlx::query("INSERT INTO market_data_private.strategy_input_sample_projection_receipts_v4(receipt_digest,kind,lifecycle,subject_identity,schedule_dependency_set_digest,component_count,receipt_bytes,custody_digest) VALUES($1,$2,2,$3,$4,$5,$6,$7)")
            .bind(prepared.receipt_digest().as_slice())
            .bind(i16::from(prepared.kind() as u8))
            .bind(prepared.subject_identity().as_slice())
            .bind(prepared.schedule_dependency_set_digest().as_slice())
            .bind(i64::from(prepared.component_count()))
            .bind(prepared.canonical_bytes())
            .bind(custody.as_slice())
            .execute(&mut *transaction).await.map_err(|e| map_insert(&e))?;

        for (index, dependency) in prepared.dependencies().iter().enumerate() {
            insert_dependency(
                &mut transaction,
                prepared.receipt_digest(),
                index,
                dependency,
            )
            .await?;
        }
        sqlx::query("INSERT INTO market_data_private.strategy_input_sample_projection_readbacks_v4(receipt_digest,readback_bytes,custody_digest) VALUES($1,$2,$3)")
            .bind(prepared.receipt_digest().as_slice()).bind(prepared.canonical_bytes()).bind(custody.as_slice())
            .execute(&mut *transaction).await.map_err(|e| map_insert(&e))?;
        sqlx::query("INSERT INTO market_data_private.strategy_input_sample_projection_outbox_v4(outbox_identity,payload,custody_digest) VALUES($1,$2,$3)")
            .bind(prepared.receipt_digest().as_slice()).bind(prepared.canonical_bytes()).bind(custody.as_slice())
            .execute(&mut *transaction).await.map_err(|e| map_insert(&e))?;
        if rollback {
            return Err(StrategyInputSampleProjectionErrorV4::CommitInterrupted);
        }
        transaction
            .commit()
            .await
            .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUnavailable)?;
        if response_loss {
            Err(StrategyInputSampleProjectionErrorV4::ResponseLost)
        } else {
            Ok(StrategyInputSampleProjectionReadbackV4::from_verified(
                decoded,
            ))
        }
    }

    pub(crate) async fn resolve_strategy_input_sample_projection_v4(
        &self,
        locator: &UntrustedStrategyInputSampleProjectionLocatorV4,
    ) -> Result<StrategyInputSampleProjectionReadbackV4, StrategyInputSampleProjectionErrorV4> {
        resolve_from_pool(&self.pool, locator.receipt_digest()).await
    }
}

async fn validate_joined_subject(
    transaction: &mut Transaction<'_, Postgres>,
    decoded: &crate::owner::sample_projection_v4::DecodedStrategyInputSampleProjectionV4,
) -> Result<(), StrategyInputSampleProjectionErrorV4> {
    let subject_digest = decoded.subject_identity();
    let joined_identity: Vec<u8> = sqlx::query_scalar(
        "SELECT joined_cut_identity FROM market_data_private.observation_census_records_v1 WHERE v1_joined_cut_receipt_digest=$1",
    )
    .bind(subject_digest.as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUnavailable)?
    .ok_or(StrategyInputSampleProjectionErrorV4::SubjectMismatch)?;
    let joined_identity: [u8; 32] = joined_identity
        .try_into()
        .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUntrusted)?;
    let locator = UntrustedStrategyInputJoinedCutLocatorV1::from_untrusted(
        crate::owner::source_binding::BindingDigest::from_untrusted_bytes(joined_identity),
        crate::owner::source_binding::BindingDigest::from_untrusted_bytes(joined_identity),
    );
    let (request, custody, receipt_digest) =
        super::observation_census::load_strategy_input_joined_cut_custody_v1(transaction, &locator)
            .await
            .map_err(|_| StrategyInputSampleProjectionErrorV4::SubjectMismatch)?
            .ok_or(StrategyInputSampleProjectionErrorV4::SubjectMismatch)?;
    let (_, joined) =
        super::observation_census::resolve_and_commit_observation_census_v1(transaction, &request)
            .await
            .map_err(|_| StrategyInputSampleProjectionErrorV4::SubjectMismatch)?;

    if joined.record().identity() != locator.joined_cut_identity()
        || joined.record().canonical_bytes() != custody.as_ref()
        || joined.record().joined_cut_receipt().digest().as_bytes() != &subject_digest
        || receipt_digest.as_bytes() != &subject_digest
    {
        return Err(StrategyInputSampleProjectionErrorV4::SubjectMismatch);
    }
    let components = decoded.canonical_bytes()[crate::owner::sample_projection_v4::HEADER_LEN_V4..]
        .chunks_exact(crate::owner::sample_projection_v4::COMPONENT_LEN_V4);

    if joined.record().joined_cut_receipt().components().len() != components.len() {
        return Err(StrategyInputSampleProjectionErrorV4::CountMismatch);
    }

    for (joined_component, exact) in joined
        .record()
        .joined_cut_receipt()
        .components()
        .iter()
        .zip(components)
    {
        let [value] = joined_component.frame().values() else {
            return Err(StrategyInputSampleProjectionErrorV4::ComponentMismatch);
        };

        if value.input_role_identity().as_bytes() != &exact[..32]
            || value.binding_receipt_digest().as_bytes() != &exact[32..64]
            || joined_component.frame().trigger().digest().as_bytes() != &exact[96..128]
            || value.digest().as_bytes() != &exact[144..176]
        {
            return Err(StrategyInputSampleProjectionErrorV4::ComponentMismatch);
        }
    }
    Ok(())
}

impl crate::owner::sample_projection_v4::sealed::Sealed for MarketDataOwnerPostgres {}

#[async_trait::async_trait]
impl StrategyInputSampleProjectionResolverV4 for MarketDataOwnerPostgres {
    async fn resolve_strategy_input_sample_projection_v4(
        &self,
        locator: &UntrustedStrategyInputSampleProjectionLocatorV4,
    ) -> Result<StrategyInputSampleProjectionReadbackV4, StrategyInputSampleProjectionResolveErrorV4>
    {
        Self::resolve_strategy_input_sample_projection_v4(self, locator)
            .await
            .map_err(|_| StrategyInputSampleProjectionResolveErrorV4)
    }
}

#[cfg(test)]
impl crate::owner::sample_projection_v4::sealed::Sealed for MarketDataReadPostgres {}

#[cfg(test)]
#[async_trait::async_trait]
impl StrategyInputSampleProjectionResolverV4 for MarketDataReadPostgres {
    async fn resolve_strategy_input_sample_projection_v4(
        &self,
        locator: &UntrustedStrategyInputSampleProjectionLocatorV4,
    ) -> Result<StrategyInputSampleProjectionReadbackV4, StrategyInputSampleProjectionResolveErrorV4>
    {
        resolve_from_pool(&self.pool, locator.receipt_digest())
            .await
            .map_err(|_| StrategyInputSampleProjectionResolveErrorV4)
    }
}

async fn resolve_from_pool(
    pool: &sqlx::PgPool,
    digest: [u8; 32],
) -> Result<StrategyInputSampleProjectionReadbackV4, StrategyInputSampleProjectionErrorV4> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUnavailable)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *transaction)
        .await
        .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUnavailable)?;
    let readback = load(&mut transaction, digest)
        .await?
        .ok_or(StrategyInputSampleProjectionErrorV4::UnknownIdentity)?;
    transaction
        .commit()
        .await
        .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUnavailable)?;
    Ok(readback)
}

async fn validate_v3_dependencies(
    transaction: &mut Transaction<'_, Postgres>,
    dependencies: &[ScheduleDependencyV4],
) -> Result<(), StrategyInputSampleProjectionErrorV4> {
    for expected in dependencies {
        let source_digest = expected.source_projection_digest;
        let stored = load_strategy_input_sample_projection_v3(transaction, source_digest)
            .await
            .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUnavailable)?
            .ok_or(StrategyInputSampleProjectionErrorV4::ScheduleDependencyMismatch)?;
        let stored_dependencies =
            load_sample_projection_schedule_dependencies_v3(transaction, source_digest)
                .await
                .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUnavailable)?;
        validate_sample_projection_dependencies_v3(
            transaction,
            &stored.decoded,
            &stored_dependencies,
            true,
        )
        .await
        .map_err(|_| StrategyInputSampleProjectionErrorV4::ScheduleDependencyMismatch)?;
        let matched = stored_dependencies
            .iter()
            .zip(stored.decoded.components())
            .find(|(actual, _)| actual.role_identity == expected.role_identity);
        let Some((actual, component)) = matched else {
            return Err(StrategyInputSampleProjectionErrorV4::ScheduleDependencyMismatch);
        };

        if expected.role_identity != actual.role_identity
            || expected.binding_receipt_digest != actual.binding_receipt_digest
            || expected.timeframe_projection_digest != component.timeframe_projection_digest()
            || expected.schedule_readback_identity != *actual.schedule_readback_identity.as_bytes()
            || expected.schedule_fact_digest != *actual.schedule_fact_digest.as_bytes()
            || expected.schedule_cut_identity != *actual.schedule_cut_identity.as_bytes()
            || expected.schedule_cut_digest != *actual.schedule_cut_digest.as_bytes()
            || expected.schedule_receipt_identity != *actual.schedule_receipt_identity.as_bytes()
        {
            return Err(StrategyInputSampleProjectionErrorV4::ScheduleDependencyMismatch);
        }
    }
    Ok(())
}

async fn load(
    transaction: &mut Transaction<'_, Postgres>,
    digest: [u8; 32],
) -> Result<Option<StrategyInputSampleProjectionReadbackV4>, StrategyInputSampleProjectionErrorV4> {
    let row = sqlx::query(
        "SELECT * FROM market_data_private.resolve_strategy_input_sample_projection_v4($1)",
    )
    .bind(digest.as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUnavailable)?;
    let Some(row) = row else {
        return Ok(None);
    };
    let bytes: Vec<u8> = row
        .try_get("receipt_bytes")
        .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUntrusted)?;
    let readback: Vec<u8> = row
        .try_get("readback_bytes")
        .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUntrusted)?;
    let outbox: Vec<u8> = row
        .try_get("outbox_payload")
        .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUntrusted)?;
    let indexed = digest_column(&row, "receipt_digest")?;
    let set_digest = digest_column(&row, "schedule_dependency_set_digest")?;
    let receipt_custody = digest_column(&row, "receipt_custody_digest")?;
    let readback_custody = digest_column(&row, "readback_custody_digest")?;
    let outbox_custody = digest_column(&row, "outbox_custody_digest")?;
    let outbox_identity = digest_column(&row, "outbox_identity")?;
    if indexed != digest || outbox_identity != digest || bytes != readback || bytes != outbox {
        return Err(StrategyInputSampleProjectionErrorV4::StoreUntrusted);
    }
    let decoded = decode_v4(&bytes, digest)?;
    let dependencies = load_dependencies(transaction, digest).await?;
    if dependencies.len() != decoded.component_count() as usize
        || schedule_set_digest(&dependencies) != set_digest
        || set_digest != decoded.schedule_dependency_set_digest()
        || custody_digest(digest, &bytes, set_digest) != receipt_custody
        || receipt_custody != readback_custody
        || receipt_custody != outbox_custody
    {
        return Err(StrategyInputSampleProjectionErrorV4::StoreUntrusted);
    }
    validate_v3_dependencies(transaction, &dependencies).await?;
    validate_exact_v3_components(transaction, &decoded, &dependencies).await?;
    Ok(Some(
        StrategyInputSampleProjectionReadbackV4::from_verified(decoded),
    ))
}

async fn validate_exact_v3_components(
    transaction: &mut Transaction<'_, Postgres>,
    decoded: &crate::owner::sample_projection_v4::DecodedStrategyInputSampleProjectionV4,
    dependencies: &[ScheduleDependencyV4],
) -> Result<(), StrategyInputSampleProjectionErrorV4> {
    let components = decoded.canonical_bytes()[crate::owner::sample_projection_v4::HEADER_LEN_V4..]
        .chunks_exact(crate::owner::sample_projection_v4::COMPONENT_LEN_V4);
    let mut frame_subject = None;

    for (exact_v4, dependency) in components.zip(dependencies) {
        let stored = load_strategy_input_sample_projection_v3(
            transaction,
            dependency.source_projection_digest,
        )
        .await
        .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUnavailable)?
        .ok_or(StrategyInputSampleProjectionErrorV4::ComponentMismatch)?;
        frame_subject = match frame_subject {
            None => Some(stored.decoded.subject_identity()),
            Some(subject) if subject == stored.decoded.subject_identity() => Some(subject),
            Some(_) => Some([0; 32]),
        };
        let source_bytes = stored.decoded.canonical_bytes();
        let source_exact = stored
            .decoded
            .components()
            .iter()
            .position(|component| component.role_identity() == dependency.role_identity)
            .and_then(|index| {
                let start =
                    V3_HEADER_LEN + index * crate::owner::sample_projection_v4::COMPONENT_LEN_V4;
                source_bytes
                    .get(start..start + crate::owner::sample_projection_v4::COMPONENT_LEN_V4)
            })
            .ok_or(StrategyInputSampleProjectionErrorV4::ComponentMismatch)?;
        if exact_v4 != source_exact {
            return Err(StrategyInputSampleProjectionErrorV4::ComponentMismatch);
        }
    }

    if decoded.kind()
        == crate::owner::sample_projection_v4::StrategyInputSampleProjectionKindV4::Frame
        && frame_subject != Some(decoded.subject_identity())
    {
        return Err(StrategyInputSampleProjectionErrorV4::SubjectMismatch);
    }
    Ok(())
}

async fn load_dependencies(
    transaction: &mut Transaction<'_, Postgres>,
    digest: [u8; 32],
) -> Result<Vec<ScheduleDependencyV4>, StrategyInputSampleProjectionErrorV4> {
    sqlx::query("SELECT * FROM market_data_private.resolve_strategy_input_sample_projection_dependencies_v4($1)")
        .bind(digest.as_slice()).fetch_all(&mut **transaction).await
        .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUnavailable)?
        .into_iter().map(|row| Ok(ScheduleDependencyV4 {
            source_projection_digest: digest_column(&row,"source_projection_digest")?,
            role_identity: digest_column(&row,"role_identity")?,
            binding_receipt_digest: digest_column(&row,"binding_receipt_digest")?,
            timeframe_projection_digest: digest_column(&row,"timeframe_projection_digest")?,
            schedule_readback_identity: digest_column(&row,"schedule_readback_identity")?,
            schedule_fact_digest: digest_column(&row,"schedule_fact_digest")?,
            schedule_cut_identity: digest_column(&row,"schedule_cut_identity")?,
            schedule_cut_digest: digest_column(&row,"schedule_cut_digest")?,
            schedule_receipt_identity: digest_column(&row,"schedule_receipt_identity")?,
        })).collect()
}

async fn insert_dependency(
    transaction: &mut Transaction<'_, Postgres>,
    digest: [u8; 32],
    index: usize,
    dependency: &ScheduleDependencyV4,
) -> Result<(), StrategyInputSampleProjectionErrorV4> {
    sqlx::query("INSERT INTO market_data_private.strategy_input_sample_projection_dependencies_v4(receipt_digest,component_ordinal,source_projection_digest,role_identity,binding_receipt_digest,timeframe_projection_digest,schedule_readback_identity,schedule_fact_digest,schedule_cut_identity,schedule_cut_digest,schedule_receipt_identity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(digest.as_slice()).bind(i64::try_from(index + 1).map_err(|_| StrategyInputSampleProjectionErrorV4::InvalidLength)?)
        .bind(dependency.source_projection_digest.as_slice()).bind(dependency.role_identity.as_slice())
        .bind(dependency.binding_receipt_digest.as_slice()).bind(dependency.timeframe_projection_digest.as_slice())
        .bind(dependency.schedule_readback_identity.as_slice()).bind(dependency.schedule_fact_digest.as_slice())
        .bind(dependency.schedule_cut_identity.as_slice()).bind(dependency.schedule_cut_digest.as_slice())
        .bind(dependency.schedule_receipt_identity.as_slice()).execute(&mut **transaction).await.map_err(|e| map_insert(&e))?;
    Ok(())
}

async fn lock(
    transaction: &mut Transaction<'_, Postgres>,
    digest: [u8; 32],
) -> Result<(), StrategyInputSampleProjectionErrorV4> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('market-data.sample-projection.v4:' || encode($1,'hex'),0))")
        .bind(digest.as_slice()).execute(&mut **transaction).await
        .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUnavailable)?;
    Ok(())
}

fn custody_digest(receipt: [u8; 32], bytes: &[u8], schedule: [u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(CUSTODY_DOMAIN);
    hasher.update(receipt);
    hasher.update(schedule);
    hasher.update(bytes);
    hasher.finalize().into()
}

fn digest_column(
    row: &sqlx::postgres::PgRow,
    column: &str,
) -> Result<[u8; 32], StrategyInputSampleProjectionErrorV4> {
    row.try_get::<Vec<u8>, _>(column)
        .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUntrusted)?
        .try_into()
        .map_err(|_| StrategyInputSampleProjectionErrorV4::StoreUntrusted)
}

fn map_insert(error: &sqlx::Error) -> StrategyInputSampleProjectionErrorV4 {
    if error
        .as_database_error()
        .and_then(sqlx::error::DatabaseError::code)
        .as_deref()
        == Some("23505")
    {
        StrategyInputSampleProjectionErrorV4::IdentityConflict
    } else {
        StrategyInputSampleProjectionErrorV4::StoreUnavailable
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::env;

    use super::*;
    use crate::owner::{
        sample_fact::{
            SampleFactHeadsV1, prepare_bar_timeframe_projection_v1, prepare_sample_commit_v1,
        },
        sample_projection::{
            StrategyInputSampleProjectionSourceV3, prepare_strategy_input_sample_projection_bar_v3,
        },
        sample_projection_v4::VerifiedV3ProjectionSourceV4,
        source_binding::BindingDigest,
        strategy_input_binding::{
            MarketDataFieldSemantic, StrategyInputChannel, StrategyInputUnit,
            UntrustedStrategyInputBindingRequest, UntrustedStrategyInputScope,
            bind_strategy_input_event_frame, bind_strategy_input_role,
        },
        strategy_input_joined_cut::{
            StrategyInputJoinRoleClaimV1, UntrustedStrategyInputJoinClaimV1,
            derive_strategy_input_join_identity_v2, issue_strategy_input_joined_cut_v1,
            seal_strategy_input_join_census_v1,
        },
    };

    pub(crate) struct JoinedBarProjectionFixtureV4 {
        pub(crate) frame:
            crate::owner::sample_projection_v4::PreparedStrategyInputSampleProjectionV4,
        pub(crate) joined:
            crate::owner::sample_projection_v4::StrategyInputSampleProjectionReadbackV4,
    }

    pub(crate) async fn commit_joined_bar_projection_fixture_v4(
        owner: &MarketDataOwnerPostgres,
        schedule_proposals: &[crate::owner::bar_schedule::UntrustedBarScheduleProposalV1],
        bindings: &[crate::owner::strategy_input_binding::StrategyInputBindingReceipt],
        frames: &[crate::owner::strategy_input_binding::StrategyInputEventFrameReceipt],
        batch: &crate::owner::pit_snapshot::VerifiedPitObservationBatch,
        instrument: &crate::owner::instrument_master::InstrumentMasterReadbackV1,
        joined_cut: &crate::owner::strategy_input_joined_cut::StrategyInputJoinedCutReceiptV1,
    ) -> JoinedBarProjectionFixtureV4 {
        assert_eq!(bindings.len(), frames.len());
        assert_eq!(bindings.len(), schedule_proposals.len());
        assert!(bindings.len() >= 2);
        let mut distinct_proposals = Vec::new();
        let mut schedules = Vec::new();
        let mut schedule_indices = Vec::with_capacity(schedule_proposals.len());
        for (binding, proposal) in bindings.iter().zip(schedule_proposals) {
            let existing = distinct_proposals.iter().position(
                |existing: &crate::owner::bar_schedule::UntrustedBarScheduleProposalV1| {
                    existing.canonical_instrument == proposal.canonical_instrument
                        && existing.effective_from == proposal.effective_from
                        && existing.effective_until == proposal.effective_until
                        && existing.kind == proposal.kind
                        && existing.step == proposal.step
                        && existing.unit == proposal.unit
                        && existing.anchor_identity == proposal.anchor_identity
                        && existing.label == proposal.label
                        && existing.completion == proposal.completion
                },
            );
            let index = if let Some(index) = existing {
                index
            } else {
                let mut proposal = proposal.clone();
                proposal.predecessor_fact_digest = schedules
                    .last()
                    .map(crate::owner::bar_schedule::BarScheduleReadbackV1::fact)
                    .map(crate::owner::bar_schedule::BarScheduleFactV1::digest);
                let prepared_schedule = crate::owner::bar_schedule::prepare_bar_schedule_commit_v1(
                    proposal.clone(),
                    binding,
                    batch,
                    instrument,
                )
                .unwrap();
                let schedule = owner
                    .commit_prepared_bar_schedule_v1(&prepared_schedule)
                    .await
                    .unwrap();
                distinct_proposals.push(proposal);
                schedules.push(schedule);
                schedules.len() - 1
            };
            schedule_indices.push(index);
        }
        let mut stored_projections = Vec::with_capacity(bindings.len());
        for ((binding, frame), schedule_index) in bindings.iter().zip(frames).zip(schedule_indices)
        {
            let schedule = &schedules[schedule_index];
            let timeframe = prepare_bar_timeframe_projection_v1(binding, batch, schedule).unwrap();
            let sample = owner
                .commit_prepared_sample_v1(
                    &prepare_sample_commit_v1(
                        binding,
                        batch,
                        &timeframe,
                        SampleFactHeadsV1 {
                            series: None,
                            slot: None,
                        },
                    )
                    .unwrap(),
                )
                .await
                .unwrap();
            let prepared_v3 = prepare_strategy_input_sample_projection_bar_v3(
                frame,
                &[StrategyInputSampleProjectionSourceV3 {
                    binding,
                    timeframe: &timeframe,
                    sample: &sample,
                    schedule,
                }],
            )
            .unwrap();
            owner
                .commit_strategy_input_sample_projection_v3(&prepared_v3)
                .await
                .unwrap();
            let mut transaction = owner.pool.begin().await.unwrap();
            let stored = load_strategy_input_sample_projection_v3(
                &mut transaction,
                prepared_v3.receipt_digest(),
            )
            .await
            .unwrap()
            .unwrap();
            let stored_dependencies = load_sample_projection_schedule_dependencies_v3(
                &mut transaction,
                prepared_v3.receipt_digest(),
            )
            .await
            .unwrap();
            transaction.commit().await.unwrap();
            let dependencies = stored_dependencies
                .iter()
                .zip(stored.decoded.components())
                .map(|(dependency, component)| ScheduleDependencyV4 {
                    source_projection_digest: stored.decoded.receipt_digest(),
                    role_identity: dependency.role_identity,
                    binding_receipt_digest: dependency.binding_receipt_digest,
                    timeframe_projection_digest: component.timeframe_projection_digest(),
                    schedule_readback_identity: *dependency.schedule_readback_identity.as_bytes(),
                    schedule_fact_digest: *dependency.schedule_fact_digest.as_bytes(),
                    schedule_cut_identity: *dependency.schedule_cut_identity.as_bytes(),
                    schedule_cut_digest: *dependency.schedule_cut_digest.as_bytes(),
                    schedule_receipt_identity: *dependency.schedule_receipt_identity.as_bytes(),
                })
                .collect::<Vec<_>>();
            stored_projections.push((stored.decoded, dependencies));
        }
        let sources = stored_projections
            .iter()
            .map(|(projection, dependencies)| VerifiedV3ProjectionSourceV4 {
                projection,
                dependencies,
            })
            .collect::<Vec<_>>();
        let joined_prepared =
            crate::owner::sample_projection_v4::prepare_joined_cut_v4(joined_cut, &sources)
                .unwrap();
        let frame =
            crate::owner::sample_projection_v4::prepare_frame_v4(VerifiedV3ProjectionSourceV4 {
                projection: sources[0].projection,
                dependencies: sources[0].dependencies,
            })
            .unwrap();
        let joined = owner
            .commit_strategy_input_sample_projection_v4(&joined_prepared)
            .await
            .unwrap();
        JoinedBarProjectionFixtureV4 { frame, joined }
    }

    #[tokio::test]
    #[ignore = "requires a disposable Market Data PostgreSQL database"]
    async fn postgres_v4_is_atomic_idempotent_exact_and_tamper_closed() {
        fn d(value: u8) -> BindingDigest {
            BindingDigest::from_untrusted_bytes([value; 32])
        }
        let owner_url = env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap();
        let reader_url = env::var("MARKET_DATA_READER_TEST_DATABASE_URL").unwrap();
        let owner = MarketDataOwnerPostgres::connect(&owner_url).await.unwrap();
        let fixture = crate::owner::sample_fact::tests::bar_postgres_schedule_fixture_v1();
        let prepared_schedule = crate::owner::bar_schedule::prepare_bar_schedule_commit_v1(
            fixture.schedule_proposal.clone(),
            &fixture.binding,
            &fixture.batch,
            &fixture.instrument_master,
        )
        .unwrap();
        let schedule = owner
            .commit_prepared_bar_schedule_v1(&prepared_schedule)
            .await
            .unwrap();
        let timeframe =
            prepare_bar_timeframe_projection_v1(&fixture.binding, &fixture.batch, &schedule)
                .unwrap();
        let sample = owner
            .commit_prepared_sample_v1(
                &prepare_sample_commit_v1(
                    &fixture.binding,
                    &fixture.batch,
                    &timeframe,
                    SampleFactHeadsV1 {
                        series: None,
                        slot: None,
                    },
                )
                .unwrap(),
            )
            .await
            .unwrap();
        let prepared_v3 = prepare_strategy_input_sample_projection_bar_v3(
            &fixture.frame,
            &[StrategyInputSampleProjectionSourceV3 {
                binding: &fixture.binding,
                timeframe: &timeframe,
                sample: &sample,
                schedule: &schedule,
            }],
        )
        .unwrap();
        owner
            .commit_strategy_input_sample_projection_v3(&prepared_v3)
            .await
            .unwrap();
        let second_request = UntrustedStrategyInputBindingRequest {
            research_request_identity: d(20),
            strategy_design_identity: d(21),
            input_role_identity: d(23),
            scope: UntrustedStrategyInputScope::ExactInstrument {
                instrument: "AAPL.XNAS".into(),
            },
            field_semantic: MarketDataFieldSemantic::BarClosePrice,
            channel: StrategyInputChannel::Market,
            timeframe: "not-a-timeframe-authority".into(),
            unit: StrategyInputUnit::Price,
            scale: 2,
            pit_request_identity: fixture.batch.request_identity(),
            pit_request_digest: fixture.batch.request_digest(),
            snapshot_identity: fixture.batch.snapshot_identity(),
            snapshot_fact_digest: fixture.batch.fact_digest(),
            observation_batch_digest: fixture.batch.digest(),
            source_binding_identity: fixture.batch.source_binding_identity(),
            source_frontier_digest: fixture.batch.source_frontier_digest(),
            correction_frontier_digest: fixture.batch.correction_frontier_digest(),
            instrument_master_digest: fixture.batch.instrument_master_digest(),
            universe_selection_digest: fixture.batch.universe_selection_digest(),
            market_semantics_identity: fixture.batch.market_semantics_identity(),
            decision_cut: fixture.batch.time_evidence().decision_cut.value,
        };
        let second_binding = bind_strategy_input_role(&second_request, &fixture.batch).unwrap();
        let second_frame =
            bind_strategy_input_event_frame(std::slice::from_ref(&second_binding), &fixture.batch)
                .unwrap();
        let second_timeframe =
            prepare_bar_timeframe_projection_v1(&second_binding, &fixture.batch, &schedule)
                .unwrap();
        let second_sample = owner
            .commit_prepared_sample_v1(
                &prepare_sample_commit_v1(
                    &second_binding,
                    &fixture.batch,
                    &second_timeframe,
                    SampleFactHeadsV1 {
                        series: None,
                        slot: None,
                    },
                )
                .unwrap(),
            )
            .await
            .unwrap();
        let second_v3 = prepare_strategy_input_sample_projection_bar_v3(
            &second_frame,
            &[StrategyInputSampleProjectionSourceV3 {
                binding: &second_binding,
                timeframe: &second_timeframe,
                sample: &second_sample,
                schedule: &schedule,
            }],
        )
        .unwrap();
        owner
            .commit_strategy_input_sample_projection_v3(&second_v3)
            .await
            .unwrap();
        let join_inputs = vec!["first".to_owned(), "second".to_owned()];
        let join_identity = derive_strategy_input_join_identity_v2(
            "test.join.bar.v4",
            &join_inputs,
            "strategy.input-join.latest-not-after-trigger.v1",
            "second",
            1,
        );
        let claim = UntrustedStrategyInputJoinClaimV1 {
            strategy_design_identity: d(21),
            join_semantic_id: "test.join.bar.v4".into(),
            join_identity,
            alignment_semantic_id: "strategy.input-join.latest-not-after-trigger.v1".into(),
            trigger_input_id: "second".into(),
            max_staleness_ns: 1,
            roles: vec![
                StrategyInputJoinRoleClaimV1 {
                    semantic_id: "first".into(),
                    input_role_identity: fixture.binding.locator().input_role_identity(),
                },
                StrategyInputJoinRoleClaimV1 {
                    semantic_id: "second".into(),
                    input_role_identity: second_binding.locator().input_role_identity(),
                },
            ],
        };
        let census =
            seal_strategy_input_join_census_v1(vec![fixture.frame.clone(), second_frame.clone()])
                .unwrap();
        let joined = issue_strategy_input_joined_cut_v1(
            &claim,
            &[fixture.binding.clone(), second_binding.clone()],
            &census,
            second_frame.trigger().lifecycle().logical_time(),
        )
        .unwrap();
        let shared_fixture = commit_joined_bar_projection_fixture_v4(
            &owner,
            &[
                fixture.schedule_proposal.clone(),
                fixture.schedule_proposal.clone(),
            ],
            &[fixture.binding.clone(), second_binding],
            &[fixture.frame.clone(), second_frame.clone()],
            &fixture.batch,
            &fixture.instrument_master,
            &joined,
        )
        .await;
        let mut transaction = owner.pool.begin().await.unwrap();
        let stored = load_strategy_input_sample_projection_v3(
            &mut transaction,
            prepared_v3.receipt_digest(),
        )
        .await
        .unwrap()
        .unwrap();
        let stored_dependencies = load_sample_projection_schedule_dependencies_v3(
            &mut transaction,
            prepared_v3.receipt_digest(),
        )
        .await
        .unwrap();
        let second_stored =
            load_strategy_input_sample_projection_v3(&mut transaction, second_v3.receipt_digest())
                .await
                .unwrap()
                .unwrap();
        let second_stored_dependencies = load_sample_projection_schedule_dependencies_v3(
            &mut transaction,
            second_v3.receipt_digest(),
        )
        .await
        .unwrap();
        transaction.commit().await.unwrap();
        let dependencies = stored_dependencies
            .iter()
            .zip(stored.decoded.components())
            .map(|(dependency, component)| ScheduleDependencyV4 {
                source_projection_digest: stored.decoded.receipt_digest(),
                role_identity: dependency.role_identity,
                binding_receipt_digest: dependency.binding_receipt_digest,
                timeframe_projection_digest: component.timeframe_projection_digest(),
                schedule_readback_identity: *dependency.schedule_readback_identity.as_bytes(),
                schedule_fact_digest: *dependency.schedule_fact_digest.as_bytes(),
                schedule_cut_identity: *dependency.schedule_cut_identity.as_bytes(),
                schedule_cut_digest: *dependency.schedule_cut_digest.as_bytes(),
                schedule_receipt_identity: *dependency.schedule_receipt_identity.as_bytes(),
            })
            .collect::<Vec<_>>();
        let second_dependencies = second_stored_dependencies
            .iter()
            .zip(second_stored.decoded.components())
            .map(|(dependency, component)| ScheduleDependencyV4 {
                source_projection_digest: second_stored.decoded.receipt_digest(),
                role_identity: dependency.role_identity,
                binding_receipt_digest: dependency.binding_receipt_digest,
                timeframe_projection_digest: component.timeframe_projection_digest(),
                schedule_readback_identity: *dependency.schedule_readback_identity.as_bytes(),
                schedule_fact_digest: *dependency.schedule_fact_digest.as_bytes(),
                schedule_cut_identity: *dependency.schedule_cut_identity.as_bytes(),
                schedule_cut_digest: *dependency.schedule_cut_digest.as_bytes(),
                schedule_receipt_identity: *dependency.schedule_receipt_identity.as_bytes(),
            })
            .collect::<Vec<_>>();
        let joined_prepared = crate::owner::sample_projection_v4::prepare_joined_cut_v4(
            &joined,
            &[
                VerifiedV3ProjectionSourceV4 {
                    projection: &stored.decoded,
                    dependencies: &dependencies,
                },
                VerifiedV3ProjectionSourceV4 {
                    projection: &second_stored.decoded,
                    dependencies: &second_dependencies,
                },
            ],
        )
        .unwrap();
        assert_eq!(joined_prepared.component_count(), 2);
        assert_eq!(
            joined_prepared.subject_identity(),
            *joined.digest().as_bytes()
        );
        assert_eq!(
            shared_fixture.joined.receipt_digest(),
            joined_prepared.receipt_digest()
        );
        let prepared = shared_fixture.frame;
        let before: (i64, i64, i64, i64) = sqlx::query_as("SELECT (SELECT COUNT(*) FROM market_data_private.strategy_input_sample_projection_receipts_v4),(SELECT COUNT(*) FROM market_data_private.strategy_input_sample_projection_dependencies_v4),(SELECT COUNT(*) FROM market_data_private.strategy_input_sample_projection_readbacks_v4),(SELECT COUNT(*) FROM market_data_private.strategy_input_sample_projection_outbox_v4)")
            .fetch_one(&owner.pool).await.unwrap();
        assert_eq!(
            owner
                .commit_strategy_input_sample_projection_with_fault_v4(&prepared, true, false)
                .await
                .unwrap_err(),
            StrategyInputSampleProjectionErrorV4::CommitInterrupted
        );
        let after_rollback: (i64, i64, i64, i64) = sqlx::query_as("SELECT (SELECT COUNT(*) FROM market_data_private.strategy_input_sample_projection_receipts_v4),(SELECT COUNT(*) FROM market_data_private.strategy_input_sample_projection_dependencies_v4),(SELECT COUNT(*) FROM market_data_private.strategy_input_sample_projection_readbacks_v4),(SELECT COUNT(*) FROM market_data_private.strategy_input_sample_projection_outbox_v4)")
            .fetch_one(&owner.pool).await.unwrap();
        assert_eq!(after_rollback, before);
        assert_eq!(
            owner
                .commit_strategy_input_sample_projection_with_fault_v4(&prepared, false, true)
                .await
                .unwrap_err(),
            StrategyInputSampleProjectionErrorV4::ResponseLost
        );
        let first = owner
            .commit_strategy_input_sample_projection_v4(&prepared)
            .await
            .unwrap();
        let retry = owner
            .commit_strategy_input_sample_projection_v4(&prepared)
            .await
            .unwrap();
        assert_eq!(first.canonical_bytes(), retry.canonical_bytes());
        drop(owner);
        let restarted = MarketDataOwnerPostgres::connect(&owner_url).await.unwrap();
        let recovered = restarted
            .resolve_strategy_input_sample_projection_v4(
                &UntrustedStrategyInputSampleProjectionLocatorV4::from_untrusted(
                    prepared.receipt_digest(),
                ),
            )
            .await
            .unwrap();
        assert_eq!(recovered.canonical_bytes(), first.canonical_bytes());
        sqlx::query("UPDATE market_data_private.strategy_input_sample_projection_receipts_v4 SET receipt_bytes=receipt_bytes || decode('00','hex') WHERE receipt_digest=$1")
            .bind(prepared.receipt_digest().as_slice()).execute(&restarted.pool).await.unwrap();
        assert_eq!(
            restarted
                .resolve_strategy_input_sample_projection_v4(
                    &UntrustedStrategyInputSampleProjectionLocatorV4::from_untrusted(
                        prepared.receipt_digest(),
                    ),
                )
                .await
                .unwrap_err(),
            StrategyInputSampleProjectionErrorV4::StoreUntrusted
        );
        sqlx::query("UPDATE market_data_private.strategy_input_sample_projection_receipts_v4 SET receipt_bytes=$2 WHERE receipt_digest=$1")
            .bind(prepared.receipt_digest().as_slice()).bind(prepared.canonical_bytes())
            .execute(&restarted.pool).await.unwrap();
        let reader = MarketDataReadPostgres::connect(&reader_url).await.unwrap();
        assert!(
            sqlx::query(
                "SELECT * FROM market_data_private.strategy_input_sample_projection_receipts_v4"
            )
            .fetch_all(&reader.pool)
            .await
            .is_err()
        );
        assert!(
            sqlx::query(
                "DELETE FROM market_data_private.strategy_input_sample_projection_receipts_v4"
            )
            .execute(&reader.pool)
            .await
            .is_err()
        );
        let public_execute: bool = sqlx::query_scalar("SELECT has_function_privilege('public','market_data_private.resolve_strategy_input_sample_projection_v4(bytea)','EXECUTE')")
            .fetch_one(&restarted.pool).await.unwrap();
        assert!(!public_execute);
    }
}
