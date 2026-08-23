use std::fmt::Display;

pub const CANONICAL_ENVELOPE_SCHEMA_V1: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignalKind {
    CommittedOwnerEvent,
    Telemetry,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RedactionClass {
    Public,
    Internal,
    ProtectedQualification,
    Secret,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraceContext {
    pub trace_id: String,
    pub span_id: String,
    pub parent_span_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FactNamespaces {
    pub strategy: Option<String>,
    pub generation: Option<String>,
    pub artifact: Option<String>,
    pub trial_family: Option<String>,
    pub account: Option<String>,
    pub scope: Option<String>,
    pub mode: Option<String>,
}

impl FactNamespaces {
    fn populated_count(&self) -> usize {
        [
            &self.strategy,
            &self.generation,
            &self.artifact,
            &self.trial_family,
            &self.account,
            &self.scope,
            &self.mode,
        ]
        .into_iter()
        .filter(|value| value.is_some())
        .count()
    }

    fn values(&self) -> impl Iterator<Item = &str> {
        [
            self.strategy.as_deref(),
            self.generation.as_deref(),
            self.artifact.as_deref(),
            self.trial_family.as_deref(),
            self.account.as_deref(),
            self.scope.as_deref(),
            self.mode.as_deref(),
        ]
        .into_iter()
        .flatten()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FourTimes {
    pub event_at_epoch_ms: u64,
    pub initialized_at_epoch_ms: u64,
    pub observed_at_epoch_ms: u64,
    pub available_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PayloadPointer {
    pub digest: String,
    pub opaque_reference: OpaqueReference,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpaqueReference(String);

impl OpaqueReference {
    pub fn new(value: impl Into<String>) -> Result<Self, OpaqueReferenceError> {
        let value = value.into();

        if !value.starts_with("opaque:")
            || value.len() <= "opaque:".len()
            || value.len() > 160
            || value.chars().any(char::is_control)
        {
            return Err(OpaqueReferenceError);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OpaqueReferenceError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalEnvelope {
    pub schema_version: u16,
    pub signal_kind: SignalKind,
    pub source_owner: String,
    pub source_node: String,
    pub record_identity: String,
    pub correlation_identity: String,
    pub causation_identity: String,
    pub idempotency_key: String,
    pub trace: TraceContext,
    pub namespaces: FactNamespaces,
    pub times: FourTimes,
    pub clock_epoch: String,
    pub outcome_category: Option<String>,
    pub error_category: Option<String>,
    pub payload: PayloadPointer,
    pub redaction_class: RedactionClass,
    pub collection_policy_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnerEventEnvelope {
    pub canonical: CanonicalEnvelope,
    pub owner_sequence: u64,
    pub source_cut: OpaqueReference,
    pub projection_valid_through_epoch_ms: u64,
    pub event_content_digest: String,
    pub immutable_owner_fact_reference: OpaqueReference,
    pub immutable_owner_fact_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TelemetryEnvelope {
    pub canonical: CanonicalEnvelope,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EnvelopePolicy {
    pub max_text_bytes: usize,
    pub max_populated_namespaces: usize,
}

impl Default for EnvelopePolicy {
    fn default() -> Self {
        Self {
            max_text_bytes: 160,
            max_populated_namespaces: 7,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnvelopeViolation {
    UnsupportedSchema,
    SignalKindMismatch,
    MissingOrOversizedField(&'static str),
    InvalidDigest(&'static str),
    InvalidTimeOrder,
    InvalidValidityWindow,
    UnboundedCategory(&'static str),
    HighCardinalityNamespaces,
    ProtectedQualificationDetail,
    SecretData,
    InvalidOwnerSequence,
}

impl Display for EnvelopeViolation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for EnvelopeViolation {}

impl OwnerEventEnvelope {
    pub fn validate(&self, policy: EnvelopePolicy) -> Result<(), EnvelopeViolation> {
        self.canonical
            .validate_for(SignalKind::CommittedOwnerEvent, policy)?;

        if self.owner_sequence == 0 {
            return Err(EnvelopeViolation::InvalidOwnerSequence);
        }
        validate_text(
            self.source_cut.as_str(),
            "source_cut",
            policy.max_text_bytes,
        )?;

        if self.projection_valid_through_epoch_ms < self.canonical.times.available_at_epoch_ms {
            return Err(EnvelopeViolation::InvalidValidityWindow);
        }
        validate_digest(&self.event_content_digest, "event_content_digest")?;
        validate_text(
            self.immutable_owner_fact_reference.as_str(),
            "immutable_owner_fact_reference",
            policy.max_text_bytes,
        )?;
        validate_digest(
            &self.immutable_owner_fact_digest,
            "immutable_owner_fact_digest",
        )
    }
}

impl TelemetryEnvelope {
    pub fn validate(&self, policy: EnvelopePolicy) -> Result<(), EnvelopeViolation> {
        self.canonical.validate_for(SignalKind::Telemetry, policy)
    }
}

impl CanonicalEnvelope {
    fn validate_for(
        &self,
        expected_kind: SignalKind,
        policy: EnvelopePolicy,
    ) -> Result<(), EnvelopeViolation> {
        if self.schema_version != CANONICAL_ENVELOPE_SCHEMA_V1 {
            return Err(EnvelopeViolation::UnsupportedSchema);
        }

        if self.signal_kind != expected_kind {
            return Err(EnvelopeViolation::SignalKindMismatch);
        }

        for (value, name) in [
            (self.source_owner.as_str(), "source_owner"),
            (self.source_node.as_str(), "source_node"),
            (self.record_identity.as_str(), "record_identity"),
            (self.correlation_identity.as_str(), "correlation_identity"),
            (self.causation_identity.as_str(), "causation_identity"),
            (self.idempotency_key.as_str(), "idempotency_key"),
            (self.trace.trace_id.as_str(), "trace_id"),
            (self.trace.span_id.as_str(), "span_id"),
            (self.trace.parent_span_id.as_str(), "parent_span_id"),
            (self.clock_epoch.as_str(), "clock_epoch"),
            (
                self.collection_policy_version.as_str(),
                "collection_policy_version",
            ),
            (self.payload.opaque_reference.as_str(), "payload_reference"),
        ] {
            validate_text(value, name, policy.max_text_bytes)?;
        }
        validate_digest(&self.payload.digest, "payload_digest")?;

        if self.namespaces.populated_count() > policy.max_populated_namespaces {
            return Err(EnvelopeViolation::HighCardinalityNamespaces);
        }

        for value in self.namespaces.values() {
            validate_text(value, "namespace", policy.max_text_bytes)?;
        }
        validate_category(self.outcome_category.as_deref(), "outcome_category")?;
        validate_category(self.error_category.as_deref(), "error_category")?;

        if self.times.event_at_epoch_ms > self.times.initialized_at_epoch_ms
            || self.times.initialized_at_epoch_ms > self.times.observed_at_epoch_ms
            || self.times.observed_at_epoch_ms > self.times.available_at_epoch_ms
        {
            return Err(EnvelopeViolation::InvalidTimeOrder);
        }

        match self.redaction_class {
            RedactionClass::Secret => Err(EnvelopeViolation::SecretData),
            RedactionClass::ProtectedQualification => {
                Err(EnvelopeViolation::ProtectedQualificationDetail)
            }
            RedactionClass::Public | RedactionClass::Internal => Ok(()),
        }
    }
}

fn validate_text(
    value: &str,
    name: &'static str,
    max_bytes: usize,
) -> Result<(), EnvelopeViolation> {
    if value.is_empty() || value.len() > max_bytes || value.chars().any(char::is_control) {
        return Err(EnvelopeViolation::MissingOrOversizedField(name));
    }
    Ok(())
}

fn validate_digest(value: &str, name: &'static str) -> Result<(), EnvelopeViolation> {
    let Some(hex) = value.strip_prefix("sha256:") else {
        return Err(EnvelopeViolation::InvalidDigest(name));
    };

    if hex.len() != 64 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(EnvelopeViolation::InvalidDigest(name));
    }
    Ok(())
}

fn validate_category(value: Option<&str>, name: &'static str) -> Result<(), EnvelopeViolation> {
    let Some(value) = value else {
        return Ok(());
    };

    if value.is_empty()
        || value.len() > 48
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(EnvelopeViolation::UnboundedCategory(name));
    }
    Ok(())
}
