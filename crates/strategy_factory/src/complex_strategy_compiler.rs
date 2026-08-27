use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_data::owner::source_binding::{
    SourceBindingOwnerReadback, SourceBindingOwnerResolver, UntrustedSourceBindingLocator,
};

use crate::{
    complex_strategy_ir::{ComplexStrategyIrV1, SymbolicInputProjectionV1},
    complex_strategy_program::{
        ComplexStrategyProgramError, ComplexStrategyProgramV1, ProgramFrameV1,
        ProgramInputSampleV1, ProgramScaledIntegerV1, ProgramTraceV1, execute_bound_program,
    },
};

pub(crate) const COMPLEX_STRATEGY_PROGRAM_PROFILE_V1: &str = "complex-strategy-program-v1";
const BINDING_IDENTITY_DOMAIN_V1: &[u8] = b"vibe.strategy-factory.symbolic-input-binding.v1\0";
const COMPILE_PLAN_IDENTITY_DOMAIN_V1: &[u8] =
    b"vibe.strategy-factory.complex-strategy.compile-plan.v1\0";
const FRAME_IDENTITY_DOMAIN_V1: &[u8] = b"vibe.strategy-factory.complex-strategy.bound-frame.v1\0";
const OWNER_SOURCE_IDENTITY_DOMAIN_V1: &[u8] = b"vibe.strategy-factory.owner-source-binding.v1\0";
const OWNER_SOURCE_CHANNEL_V1: &str = "market-data-owner-source-binding-v1";

#[derive(Debug, Error)]
pub(crate) enum ComplexStrategyCompilerError {
    #[error("complex strategy IR cannot be compiled into the closed program: {0}")]
    Program(#[from] ComplexStrategyProgramError),
    #[error("symbolic input binding field is invalid: {field}")]
    InvalidBindingField { field: &'static str },
    #[error("symbolic input binding keys must be unique")]
    DuplicateBindingKey,
    #[error("symbolic input bindings must exactly cover every admitted IR input")]
    BindingCoverageMismatch,
    #[error("symbolic input binding was issued for a different IR semantic identity")]
    BindingIrMismatch,
    #[error("symbolic input binding receipt custody is not canonical")]
    BindingCustodyMismatch,
    #[error("compiler canonicalization failed: {0}")]
    Canonicalization(#[from] serde_json::Error),
    #[error("compile input was issued for a different complex strategy IR origin")]
    CompileInputIrMismatch,
    #[error("compile input custody is not canonical")]
    CompileInputCustodyMismatch,
    #[error("compile plan identity is not canonical")]
    CompilePlanMismatch,
    #[error("complex strategy frame bindings must exactly cover the compile input")]
    FrameBindingCoverageMismatch,
    #[error("complex strategy frame binding keys must be unique")]
    DuplicateFrameBindingKey,
    #[error("Market Data Owner Source Binding is unavailable")]
    OwnerSourceBindingUnavailable,
    #[error("Market Data Owner Source Binding does not match the requested locator")]
    OwnerSourceBindingMismatch,
    #[error("Market Data Owner Source Binding is incomplete")]
    OwnerSourceBindingIncomplete,
    #[error("Market Data Owner Source Binding is not admitted")]
    OwnerSourceBindingNotAdmitted,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SymbolicInputBindingReceiptV1 {
    ir_semantic_digest: String,
    binding_identity: String,
    bindings: Box<[ExactSymbolicInputBindingV1]>,
    canonical_bytes: Box<[u8]>,
}

impl SymbolicInputBindingReceiptV1 {
    #[cfg(test)]
    pub(crate) fn issue_for_test(
        ir: &ComplexStrategyIrV1,
        bindings: Vec<ExactSymbolicInputBindingV1>,
    ) -> Result<Self, ComplexStrategyCompilerError> {
        issue_binding_receipt(ir.semantic_digest(), &ir.symbolic_inputs(), bindings)
    }

    pub(crate) fn binding_identity(&self) -> &str {
        &self.binding_identity
    }

    #[cfg(test)]
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    #[cfg(test)]
    pub(crate) fn with_corrupted_canonical_bytes_for_test(&self) -> Self {
        let mut corrupted = self.clone();
        corrupted.canonical_bytes[0] ^= 1;
        corrupted
    }

    fn validate_for_ir(
        &self,
        ir: &ComplexStrategyIrV1,
    ) -> Result<(), ComplexStrategyCompilerError> {
        if self.ir_semantic_digest != ir.semantic_digest() {
            return Err(ComplexStrategyCompilerError::BindingIrMismatch);
        }
        let canonical = issue_binding_receipt(
            ir.semantic_digest(),
            &ir.symbolic_inputs(),
            self.bindings.to_vec(),
        )?;

        if canonical.binding_identity != self.binding_identity
            || canonical.canonical_bytes != self.canonical_bytes
        {
            return Err(ComplexStrategyCompilerError::BindingCustodyMismatch);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub(crate) struct ExactSymbolicInputBindingV1 {
    input_id: String,
    instrument_role: String,
    timeframe: String,
    field: String,
    channel_identity: String,
    canonical_input: CanonicalInputIdentityV1,
}

impl ExactSymbolicInputBindingV1 {
    #[cfg(test)]
    pub(crate) fn for_source_test(
        input_id: &str,
        instrument_role: &str,
        timeframe: &str,
        field: &str,
        channel_identity: &str,
        source_identity: &str,
    ) -> Self {
        Self {
            input_id: input_id.to_owned(),
            instrument_role: instrument_role.to_owned(),
            timeframe: timeframe.to_owned(),
            field: field.to_owned(),
            channel_identity: channel_identity.to_owned(),
            canonical_input: CanonicalInputIdentityV1::Source {
                identity: source_identity.to_owned(),
            },
        }
    }

    #[cfg(test)]
    pub(crate) fn for_fixture_test(
        input_id: &str,
        instrument_role: &str,
        timeframe: &str,
        field: &str,
        channel_identity: &str,
        fixture_identity: &str,
    ) -> Self {
        Self {
            input_id: input_id.to_owned(),
            instrument_role: instrument_role.to_owned(),
            timeframe: timeframe.to_owned(),
            field: field.to_owned(),
            channel_identity: channel_identity.to_owned(),
            canonical_input: CanonicalInputIdentityV1::Fixture {
                identity: fixture_identity.to_owned(),
            },
        }
    }

    fn key(&self) -> (&str, &str, &str, &str) {
        (
            &self.input_id,
            &self.instrument_role,
            &self.timeframe,
            &self.field,
        )
    }
}

pub(crate) struct ComplexStrategyOwnerSourceResolverV1 {
    source_binding_owner: Arc<dyn SourceBindingOwnerResolver>,
}

impl ComplexStrategyOwnerSourceResolverV1 {
    pub(crate) fn new(source_binding_owner: Arc<dyn SourceBindingOwnerResolver>) -> Self {
        Self {
            source_binding_owner,
        }
    }

    pub(crate) async fn resolve_compile_input(
        &self,
        ir: &ComplexStrategyIrV1,
        locator: &UntrustedSourceBindingLocator,
    ) -> Result<ComplexStrategyCompileInputV1, ComplexStrategyCompilerError> {
        let readback = self
            .source_binding_owner
            .resolve_source_binding(locator)
            .await
            .map_err(|_| ComplexStrategyCompilerError::OwnerSourceBindingUnavailable)?;
        let resolution = validate_owner_source_readback(locator, &readback)?;
        compile_from_owner_source_resolution(ir, &resolution)
    }
}

struct VerifiedOwnerSourceResolution {
    identity: String,
}

impl VerifiedOwnerSourceResolution {
    #[cfg(test)]
    fn for_verified_test(identity: String) -> Self {
        Self { identity }
    }
}

fn compile_from_owner_source_resolution(
    ir: &ComplexStrategyIrV1,
    source: &VerifiedOwnerSourceResolution,
) -> Result<ComplexStrategyCompileInputV1, ComplexStrategyCompilerError> {
    let projected_inputs = ir.symbolic_inputs();
    let bindings = projected_inputs
        .iter()
        .map(|input| ExactSymbolicInputBindingV1 {
            input_id: input.id.clone(),
            instrument_role: input.instrument_role.clone(),
            timeframe: input.timeframe.clone(),
            field: input.field.clone(),
            channel_identity: OWNER_SOURCE_CHANNEL_V1.to_owned(),
            canonical_input: CanonicalInputIdentityV1::Source {
                identity: source.identity.clone(),
            },
        })
        .collect();
    let receipt = issue_binding_receipt(ir.semantic_digest(), &projected_inputs, bindings)?;
    ComplexStrategyCompileInputV1::from_owner_binding(ir, &receipt)
}

fn validate_owner_source_readback(
    locator: &UntrustedSourceBindingLocator,
    readback: &SourceBindingOwnerReadback,
) -> Result<VerifiedOwnerSourceResolution, ComplexStrategyCompilerError> {
    if readback.locator() != locator
        || readback.binding_id() != locator.binding_id()
        || readback.fact_digest() != locator.fact_digest()
        || readback.lineage_root() != locator.lineage_root()
        || readback.lineage_version() != locator.lineage_version()
    {
        return Err(ComplexStrategyCompilerError::OwnerSourceBindingMismatch);
    }

    if readback.lineage_version() == 0
        || [
            readback.binding_id(),
            readback.fact_digest(),
            readback.lineage_root(),
            readback.outbox_digest(),
        ]
        .iter()
        .any(|digest| digest.as_bytes() == &[0; 32])
    {
        return Err(ComplexStrategyCompilerError::OwnerSourceBindingIncomplete);
    }

    if !readback.is_admitted() {
        return Err(ComplexStrategyCompilerError::OwnerSourceBindingNotAdmitted);
    }
    let canonical = serde_json::to_vec(readback)?;
    let mut hasher = Sha256::new();
    hasher.update(OWNER_SOURCE_IDENTITY_DOMAIN_V1);
    hasher.update(canonical);
    Ok(VerifiedOwnerSourceResolution {
        identity: format!("sha256:{}", encode_hex(&hasher.finalize())),
    })
}

#[cfg(test)]
pub(crate) fn compile_from_verified_owner_source_for_test(
    ir: &ComplexStrategyIrV1,
    source_identity: String,
) -> Result<ComplexStrategyCompileInputV1, ComplexStrategyCompilerError> {
    compile_from_owner_source_resolution(
        ir,
        &VerifiedOwnerSourceResolution::for_verified_test(source_identity),
    )
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct UntrustedComplexStrategyInputSampleV1 {
    pub(crate) input_id: String,
    pub(crate) instrument_role: String,
    pub(crate) timeframe: String,
    pub(crate) field: String,
    pub(crate) channel_identity: String,
    pub(crate) canonical_input_identity: String,
    pub(crate) observed_at: u64,
    pub(crate) available_at: u64,
    pub(crate) coefficient: i64,
    pub(crate) scale: u8,
}

impl UntrustedComplexStrategyInputSampleV1 {
    fn key(&self) -> (&str, &str, &str, &str) {
        (
            &self.input_id,
            &self.instrument_role,
            &self.timeframe,
            &self.field,
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct UntrustedComplexStrategyFrameV1 {
    pub(crate) decision_time: u64,
    pub(crate) inputs: Vec<UntrustedComplexStrategyInputSampleV1>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct BoundComplexStrategyFrameV1 {
    compile_plan_identity: [u8; 32],
    binding_identity: String,
    program_frame: ProgramFrameV1,
}

impl BoundComplexStrategyFrameV1 {
    pub(crate) fn matches_compile_input(&self, input: &ComplexStrategyCompileInputV1) -> bool {
        self.compile_plan_identity == *input.compile_plan_identity()
            && self.binding_identity == input.binding_identity
    }

    pub(crate) const fn program_frame(&self) -> &ProgramFrameV1 {
        &self.program_frame
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
enum CanonicalInputIdentityV1 {
    Source { identity: String },
    Fixture { identity: String },
}

impl CanonicalInputIdentityV1 {
    fn identity(&self) -> &str {
        match self {
            Self::Source { identity } | Self::Fixture { identity } => identity,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ComplexStrategyCompileInputV1 {
    ir_semantic_digest: String,
    intent_identity: String,
    intent_semantic_digest: String,
    binding_identity: String,
    program: ComplexStrategyProgramV1,
    exact_bindings: Box<[ExactSymbolicInputBindingV1]>,
    compile_plan_identity: [u8; 32],
    canonical_bytes: Box<[u8]>,
}

pub(crate) type PairSpreadStateCompileInputV1 = ComplexStrategyCompileInputV1;

impl ComplexStrategyCompileInputV1 {
    pub(crate) fn from_owner_binding(
        ir: &ComplexStrategyIrV1,
        binding: &SymbolicInputBindingReceiptV1,
    ) -> Result<Self, ComplexStrategyCompilerError> {
        binding.validate_for_ir(ir)?;
        let program = ir.compile_program(&binding.binding_identity)?;
        let canonical_bytes = canonical_compile_input(
            ir.semantic_digest(),
            &program,
            &binding.binding_identity,
            &binding.bindings,
        )?;
        let compile_plan_identity = compile_plan_identity(&canonical_bytes);
        Ok(Self {
            ir_semantic_digest: ir.semantic_digest().to_owned(),
            intent_identity: ir.intent_identity().to_owned(),
            intent_semantic_digest: ir.intent_semantic_digest().to_owned(),
            binding_identity: binding.binding_identity.clone(),
            program,
            exact_bindings: binding.bindings.clone(),
            compile_plan_identity,
            canonical_bytes: canonical_bytes.into(),
        })
    }

    pub(crate) fn validate_for_ir(
        &self,
        ir: &ComplexStrategyIrV1,
    ) -> Result<(), ComplexStrategyCompilerError> {
        if self.ir_semantic_digest != ir.semantic_digest()
            || self.intent_identity != ir.intent_identity()
            || self.intent_semantic_digest != ir.intent_semantic_digest()
        {
            return Err(ComplexStrategyCompilerError::CompileInputIrMismatch);
        }
        validate_sha256(&self.binding_identity, "binding_identity")
            .map_err(|_| ComplexStrategyCompilerError::CompileInputCustodyMismatch)?;
        let program = ir.compile_program(&self.binding_identity)?;
        if program != self.program {
            return Err(ComplexStrategyCompilerError::CompileInputIrMismatch);
        }
        let binding = issue_binding_receipt(
            ir.semantic_digest(),
            &ir.symbolic_inputs(),
            self.exact_bindings.to_vec(),
        )?;

        if binding.binding_identity != self.binding_identity {
            return Err(ComplexStrategyCompilerError::CompileInputCustodyMismatch);
        }
        let canonical_bytes = canonical_compile_input(
            ir.semantic_digest(),
            &program,
            &self.binding_identity,
            &self.exact_bindings,
        )?;

        if canonical_bytes.as_slice() != self.canonical_bytes.as_ref() {
            return Err(ComplexStrategyCompilerError::CompileInputCustodyMismatch);
        }

        if compile_plan_identity(&canonical_bytes) != self.compile_plan_identity {
            return Err(ComplexStrategyCompilerError::CompilePlanMismatch);
        }
        Ok(())
    }

    pub(crate) const fn compile_plan_identity(&self) -> &[u8; 32] {
        &self.compile_plan_identity
    }

    pub(crate) const fn program(&self) -> &ComplexStrategyProgramV1 {
        &self.program
    }

    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub(crate) fn seal_frame(
        &self,
        frame: UntrustedComplexStrategyFrameV1,
    ) -> Result<BoundComplexStrategyFrameV1, ComplexStrategyCompilerError> {
        if frame.inputs.len() != self.exact_bindings.len() {
            return Err(ComplexStrategyCompilerError::FrameBindingCoverageMismatch);
        }
        let mut supplied = BTreeMap::new();

        for sample in frame.inputs {
            let key = (
                sample.input_id.clone(),
                sample.instrument_role.clone(),
                sample.timeframe.clone(),
                sample.field.clone(),
            );

            if supplied.insert(key, sample).is_some() {
                return Err(ComplexStrategyCompilerError::DuplicateFrameBindingKey);
            }
        }
        let mut canonical_samples = Vec::with_capacity(self.exact_bindings.len());
        let mut program_inputs = Vec::with_capacity(self.exact_bindings.len());
        for binding in &self.exact_bindings {
            let key = (
                binding.input_id.clone(),
                binding.instrument_role.clone(),
                binding.timeframe.clone(),
                binding.field.clone(),
            );
            let sample = supplied
                .remove(&key)
                .ok_or(ComplexStrategyCompilerError::FrameBindingCoverageMismatch)?;

            if sample.channel_identity != binding.channel_identity
                || sample.canonical_input_identity != binding.canonical_input.identity()
                || sample.key() != binding.key()
            {
                return Err(ComplexStrategyCompilerError::FrameBindingCoverageMismatch);
            }
            program_inputs.push(ProgramInputSampleV1 {
                observed_at: sample.observed_at,
                available_at: sample.available_at,
                value: ProgramScaledIntegerV1 {
                    coefficient: sample.coefficient,
                    scale: sample.scale,
                },
            });
            canonical_samples.push(sample);
        }

        if !supplied.is_empty() {
            return Err(ComplexStrategyCompilerError::FrameBindingCoverageMismatch);
        }
        let frame_identity = bound_frame_identity(
            self.compile_plan_identity(),
            &self.binding_identity,
            frame.decision_time,
            &canonical_samples,
        )?;
        Ok(BoundComplexStrategyFrameV1 {
            compile_plan_identity: self.compile_plan_identity,
            binding_identity: self.binding_identity.clone(),
            program_frame: ProgramFrameV1 {
                frame_identity,
                decision_time: frame.decision_time,
                inputs: program_inputs,
            },
        })
    }

    pub(crate) fn execute(
        &self,
        frames: &[BoundComplexStrategyFrameV1],
    ) -> Result<ProgramTraceV1, ComplexStrategyProgramError> {
        execute_bound_program(self, frames)
    }

    #[cfg(test)]
    pub(crate) fn binding_identity(&self) -> &str {
        &self.binding_identity
    }
}

#[derive(Serialize)]
struct BoundFrameIdentityMaterialV1<'a> {
    compile_plan_identity: &'a [u8; 32],
    binding_identity: &'a str,
    decision_time: u64,
    inputs: &'a [UntrustedComplexStrategyInputSampleV1],
}

fn bound_frame_identity(
    compile_plan_identity: &[u8; 32],
    binding_identity: &str,
    decision_time: u64,
    inputs: &[UntrustedComplexStrategyInputSampleV1],
) -> Result<[u8; 32], serde_json::Error> {
    let bytes = serde_json::to_vec(&BoundFrameIdentityMaterialV1 {
        compile_plan_identity,
        binding_identity,
        decision_time,
        inputs,
    })?;
    let mut hasher = Sha256::new();
    hasher.update(FRAME_IDENTITY_DOMAIN_V1);
    hasher.update(bytes);
    Ok(hasher.finalize().into())
}

fn canonical_compile_input(
    ir_semantic_digest: &str,
    program: &ComplexStrategyProgramV1,
    binding_identity: &str,
    exact_bindings: &[ExactSymbolicInputBindingV1],
) -> Result<Vec<u8>, serde_json::Error> {
    let material = CompileInputMaterialV1 {
        profile_identity: COMPLEX_STRATEGY_PROGRAM_PROFILE_V1,
        ir_semantic_digest,
        program_identity: program.identity(),
        program_bytes_digest: sha256(program.canonical_bytes()),
        binding_identity,
        exact_bindings,
    };
    let mut canonical_bytes = serde_json::to_vec(&material)?;
    canonical_bytes.push(b'\n');
    Ok(canonical_bytes)
}

fn compile_plan_identity(canonical_bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(COMPILE_PLAN_IDENTITY_DOMAIN_V1);
    hasher.update(canonical_bytes);
    hasher.finalize().into()
}

fn issue_binding_receipt(
    ir_semantic_digest: &str,
    projected_inputs: &[SymbolicInputProjectionV1],
    mut bindings: Vec<ExactSymbolicInputBindingV1>,
) -> Result<SymbolicInputBindingReceiptV1, ComplexStrategyCompilerError> {
    for binding in &bindings {
        validate_binding(binding)?;
    }
    bindings.sort();
    let unique_keys = bindings
        .iter()
        .map(ExactSymbolicInputBindingV1::key)
        .collect::<BTreeSet<_>>();

    if unique_keys.len() != bindings.len() {
        return Err(ComplexStrategyCompilerError::DuplicateBindingKey);
    }
    let expected = projected_inputs
        .iter()
        .map(projected_key)
        .collect::<BTreeSet<_>>();
    let actual = bindings
        .iter()
        .map(ExactSymbolicInputBindingV1::key)
        .collect::<BTreeSet<_>>();

    if actual != expected {
        return Err(ComplexStrategyCompilerError::BindingCoverageMismatch);
    }
    let identity_material = BindingIdentityMaterialV1 {
        profile_identity: COMPLEX_STRATEGY_PROGRAM_PROFILE_V1,
        ir_semantic_digest,
        exact_bindings: &bindings,
    };
    let identity_bytes = serde_json::to_vec(&identity_material)?;
    let mut hasher = Sha256::new();
    hasher.update(BINDING_IDENTITY_DOMAIN_V1);
    hasher.update(identity_bytes);
    let binding_identity = format!("sha256:{}", encode_hex(&hasher.finalize()));
    let receipt_material = BindingReceiptMaterialV1 {
        profile_identity: COMPLEX_STRATEGY_PROGRAM_PROFILE_V1,
        ir_semantic_digest,
        binding_identity: &binding_identity,
        exact_bindings: &bindings,
    };
    let mut canonical_bytes = serde_json::to_vec(&receipt_material)?;
    canonical_bytes.push(b'\n');
    Ok(SymbolicInputBindingReceiptV1 {
        ir_semantic_digest: ir_semantic_digest.to_owned(),
        binding_identity,
        bindings: bindings.into(),
        canonical_bytes: canonical_bytes.into(),
    })
}

fn projected_key(input: &SymbolicInputProjectionV1) -> (&str, &str, &str, &str) {
    (
        &input.id,
        &input.instrument_role,
        &input.timeframe,
        &input.field,
    )
}

fn validate_binding(
    binding: &ExactSymbolicInputBindingV1,
) -> Result<(), ComplexStrategyCompilerError> {
    for (field, value) in [
        ("input_id", binding.input_id.as_str()),
        ("instrument_role", binding.instrument_role.as_str()),
        ("timeframe", binding.timeframe.as_str()),
        ("field", binding.field.as_str()),
        ("channel_identity", binding.channel_identity.as_str()),
    ] {
        validate_identifier(value, field)?;
    }
    validate_sha256(
        binding.canonical_input.identity(),
        "canonical_input.identity",
    )
}

fn validate_identifier(
    value: &str,
    field: &'static str,
) -> Result<(), ComplexStrategyCompilerError> {
    let valid = (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b':'));

    if valid {
        Ok(())
    } else {
        Err(ComplexStrategyCompilerError::InvalidBindingField { field })
    }
}

fn validate_sha256(value: &str, field: &'static str) -> Result<(), ComplexStrategyCompilerError> {
    let valid = value.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    });

    if valid {
        Ok(())
    } else {
        Err(ComplexStrategyCompilerError::InvalidBindingField { field })
    }
}

#[derive(Serialize)]
struct BindingIdentityMaterialV1<'a> {
    profile_identity: &'static str,
    ir_semantic_digest: &'a str,
    exact_bindings: &'a [ExactSymbolicInputBindingV1],
}

#[derive(Serialize)]
struct BindingReceiptMaterialV1<'a> {
    profile_identity: &'static str,
    ir_semantic_digest: &'a str,
    binding_identity: &'a str,
    exact_bindings: &'a [ExactSymbolicInputBindingV1],
}

#[derive(Serialize)]
struct CompileInputMaterialV1<'a> {
    profile_identity: &'static str,
    ir_semantic_digest: &'a str,
    program_identity: &'a str,
    program_bytes_digest: String,
    binding_identity: &'a str,
    exact_bindings: &'a [ExactSymbolicInputBindingV1],
}

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", encode_hex(&Sha256::digest(bytes)))
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}
