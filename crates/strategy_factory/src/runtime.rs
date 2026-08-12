use std::convert::TryFrom;

use thiserror::Error;
use wasmi::{
    CompilationMode, Config, Engine, Error as WasmiError, F64, Linker, Module, Store, TrapCode,
    TypedFunc,
};
use wasmparser::{
    Encoding, ExternalKind, Operator, Parser, Payload, ValType, Validator, WasmFeatures,
};

use crate::{
    artifact::{
        ArtifactError, GUEST_RUSTC_COMMIT, GUEST_RUSTC_RELEASE, GUEST_TARGET,
        MAX_ARTIFACT_WASM_BYTES, StrategyArtifact,
    },
    decision::{
        CoreWasmValueType, DECISION_ABI_VERSION, DECISION_EXPORT, DECISION_SIGNATURE,
        DecisionAction, DecisionContract, DecisionError, DecisionInput,
    },
    intent::ResearchIntent,
};

const DECISION_FUEL: u64 = 10_000;
const MEMORY_EXPORT: &str = "memory";

type DecisionFunction = TypedFunc<(i32, i32, F64, F64, F64, F64, F64), i32>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeProjection {
    pub artifact_digest: String,
    pub wasm_digest: String,
    pub export: &'static str,
    pub abi_version: u32,
    pub rustc_release: &'static str,
    pub rustc_commit: &'static str,
    pub target: &'static str,
}

#[derive(Debug)]
pub struct PreparedDecisionRuntime {
    store: Store<()>,
    function: DecisionFunction,
}

impl PreparedDecisionRuntime {
    pub fn decide(&mut self, input: DecisionInput) -> Result<DecisionAction, RuntimeError> {
        self.call_with_fuel(input, DECISION_FUEL)
    }

    fn call_with_fuel(
        &mut self,
        input: DecisionInput,
        fuel: u64,
    ) -> Result<DecisionAction, RuntimeError> {
        self.store.set_fuel(fuel).map_err(|e| execution_error(&e))?;
        let raw_action = self
            .function
            .call(
                &mut self.store,
                (
                    input.phase() as i32,
                    input.position() as i32,
                    input.close().into(),
                    input.fast_ema().into(),
                    input.slow_ema().into(),
                    input.prior_72_high().into(),
                    input.prior_24_low().into(),
                ),
            )
            .map_err(|e| execution_error(&e))?;
        decode_action(raw_action)
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RuntimeError {
    #[error(transparent)]
    Artifact(#[from] ArtifactError),
    #[error(transparent)]
    Decision(#[from] DecisionError),
    #[error("restricted Wasm validation failed: {0}")]
    Invalid(String),
    #[error("restricted Wasm contains forbidden section or operator: {0}")]
    Forbidden(&'static str),
    #[error("restricted Wasm module envelope mismatch: {0}")]
    Envelope(&'static str),
    #[error("restricted Wasm export mismatch")]
    Export,
    #[error("restricted Wasm execution failed: {0}")]
    Execution(String),
    #[error("restricted Wasm exhausted its fixed fuel")]
    OutOfFuel,
    #[error("restricted Wasm trapped: {0}")]
    Trap(String),
}

pub fn prepare_decision_runtime(
    artifact: &StrategyArtifact,
    intent: &ResearchIntent,
    contract: &DecisionContract,
) -> Result<(PreparedDecisionRuntime, RuntimeProjection), RuntimeError> {
    artifact.verify_binding(intent, contract)?;
    contract.validate_abi(DECISION_ABI_VERSION, DECISION_EXPORT, &DECISION_SIGNATURE)?;
    validate_restricted_module(artifact.wasm())?;

    let runtime = instantiate_decision_runtime(artifact.wasm(), contract.export())?;
    let projection = RuntimeProjection {
        artifact_digest: artifact.identity().artifact_digest.clone(),
        wasm_digest: artifact.identity().wasm_digest.clone(),
        export: DECISION_EXPORT,
        abi_version: DECISION_ABI_VERSION,
        rustc_release: GUEST_RUSTC_RELEASE,
        rustc_commit: GUEST_RUSTC_COMMIT,
        target: GUEST_TARGET,
    };
    Ok((runtime, projection))
}

fn instantiate_decision_runtime(
    bytes: &[u8],
    export: &str,
) -> Result<PreparedDecisionRuntime, RuntimeError> {
    let engine = restricted_engine();
    let module = Module::new(&engine, bytes).map_err(|e| RuntimeError::Execution(e.to_string()))?;
    let mut store = Store::new(&engine, ());
    let linker = Linker::new(&engine);
    let instance = linker
        .instantiate_and_start(&mut store, &module)
        .map_err(|e| execution_error(&e))?;
    let function = instance
        .get_typed_func::<(i32, i32, F64, F64, F64, F64, F64), i32>(&store, export)
        .map_err(|e| execution_error(&e))?;
    Ok(PreparedDecisionRuntime { store, function })
}

pub fn validate_restricted_module(bytes: &[u8]) -> Result<(), RuntimeError> {
    if bytes.len() > MAX_ARTIFACT_WASM_BYTES {
        return Err(RuntimeError::Envelope("artifact size"));
    }
    Validator::new_with_features(WasmFeatures::WASM1)
        .validate_all(bytes)
        .map_err(|e| RuntimeError::Invalid(e.to_string()))?;

    let mut facts = ModuleFacts::default();

    for payload in Parser::new(0).parse_all(bytes) {
        match payload.map_err(|e| RuntimeError::Invalid(e.to_string()))? {
            Payload::Version { num, encoding, .. } => {
                if num != 1 || encoding != Encoding::Module {
                    return Err(RuntimeError::Envelope("module version"));
                }
            }
            Payload::TypeSection(types) => {
                facts.types += 1;
                if types.count() != 1 {
                    return Err(RuntimeError::Envelope("function type count"));
                }
                let function_type = types
                    .into_iter_err_on_gc_types()
                    .next()
                    .ok_or(RuntimeError::Envelope("function type"))?
                    .map_err(|e| RuntimeError::Invalid(e.to_string()))?;
                let expected_parameters = DECISION_SIGNATURE
                    .parameters()
                    .iter()
                    .map(parser_value_type)
                    .collect::<Vec<_>>();

                if function_type.params() != expected_parameters
                    || function_type.results() != [ValType::I32]
                {
                    return Err(RuntimeError::Envelope("decision function type"));
                }
            }
            Payload::FunctionSection(functions) => {
                facts.functions += 1;
                let entries = functions
                    .into_iter()
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| RuntimeError::Invalid(e.to_string()))?;
                if entries != [0] {
                    return Err(RuntimeError::Envelope("function section"));
                }
            }
            Payload::MemorySection(memories) => {
                facts.memories += 1;
                let entries = memories
                    .into_iter()
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| RuntimeError::Invalid(e.to_string()))?;
                let [memory] = entries.as_slice() else {
                    return Err(RuntimeError::Envelope("memory count"));
                };

                if memory.memory64
                    || memory.shared
                    || memory.initial != 1
                    || memory.maximum != Some(1)
                    || memory.page_size_log2.is_some()
                {
                    return Err(RuntimeError::Envelope("fixed compiler memory"));
                }
            }
            Payload::GlobalSection(globals) => {
                facts.globals += 1;
                let entries = globals
                    .into_iter()
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| RuntimeError::Invalid(e.to_string()))?;
                let [global] = entries.as_slice() else {
                    return Err(RuntimeError::Envelope("global count"));
                };

                if global.ty.content_type != ValType::I32 || !global.ty.mutable || global.ty.shared
                {
                    return Err(RuntimeError::Envelope("compiler global type"));
                }
                let mut operators = global.init_expr.get_operators_reader();
                match operators
                    .read()
                    .map_err(|e| RuntimeError::Invalid(e.to_string()))?
                {
                    Operator::I32Const { value: 0 } => {}
                    _ => return Err(RuntimeError::Envelope("compiler global initializer")),
                }

                match operators
                    .read()
                    .map_err(|e| RuntimeError::Invalid(e.to_string()))?
                {
                    Operator::End => {}
                    _ => return Err(RuntimeError::Envelope("compiler global initializer")),
                }

                if !operators.eof() {
                    return Err(RuntimeError::Envelope("compiler global initializer"));
                }
            }
            Payload::ExportSection(exports) => {
                facts.exports += 1;
                let entries = exports
                    .into_iter()
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| RuntimeError::Invalid(e.to_string()))?;
                if entries.len() != 2 {
                    return Err(RuntimeError::Export);
                }
                let behavior = entries.iter().any(|export| {
                    export.name == DECISION_EXPORT
                        && export.kind == ExternalKind::Func
                        && export.index == 0
                });
                let compiler_memory = entries.iter().any(|export| {
                    export.name == MEMORY_EXPORT
                        && export.kind == ExternalKind::Memory
                        && export.index == 0
                });

                if !behavior || !compiler_memory {
                    return Err(RuntimeError::Export);
                }
            }
            Payload::CodeSectionStart { count, .. } => {
                facts.code_sections += 1;

                if count != 1 {
                    return Err(RuntimeError::Envelope("code count"));
                }
            }
            Payload::CodeSectionEntry(body) => {
                facts.code_entries += 1;

                if body
                    .get_locals_reader()
                    .map_err(|e| RuntimeError::Invalid(e.to_string()))?
                    .get_count()
                    != 0
                {
                    return Err(RuntimeError::Envelope("function locals"));
                }
                let mut operators = body
                    .get_operators_reader()
                    .map_err(|e| RuntimeError::Invalid(e.to_string()))?;

                while !operators.eof() {
                    let operator = operators
                        .read()
                        .map_err(|e| RuntimeError::Invalid(e.to_string()))?;
                    validate_operator(&operator)?;
                }
            }
            Payload::End(_) => facts.end += 1,
            Payload::ImportSection(_) => return Err(RuntimeError::Forbidden("imports")),
            Payload::TableSection(_) => return Err(RuntimeError::Forbidden("tables")),
            Payload::StartSection { .. } => return Err(RuntimeError::Forbidden("start")),
            Payload::CustomSection(_) => return Err(RuntimeError::Forbidden("custom")),
            Payload::DataSection(_) | Payload::DataCountSection { .. } => {
                return Err(RuntimeError::Forbidden("data"));
            }
            Payload::ElementSection(_) => return Err(RuntimeError::Forbidden("elements")),
            _ => return Err(RuntimeError::Forbidden("post-1.0 or unsupported section")),
        }
    }

    if facts != ModuleFacts::expected() {
        return Err(RuntimeError::Envelope("section cardinality"));
    }
    Ok(())
}

fn validate_operator(operator: &Operator<'_>) -> Result<(), RuntimeError> {
    match operator {
        Operator::Block { .. }
        | Operator::BrTable { .. }
        | Operator::BrIf { .. }
        | Operator::End
        | Operator::F64Gt
        | Operator::F64Le
        | Operator::F64Lt
        | Operator::I32And
        | Operator::I32Const { .. }
        | Operator::I32Eq
        | Operator::I32Eqz
        | Operator::LocalGet { .. }
        | Operator::Return
        | Operator::Select => Ok(()),
        Operator::GlobalGet { .. } | Operator::GlobalSet { .. } => {
            Err(RuntimeError::Forbidden("global access"))
        }
        Operator::Call { .. } | Operator::CallIndirect { .. } => {
            Err(RuntimeError::Forbidden("calls"))
        }
        Operator::Loop { .. } => Err(RuntimeError::Forbidden("loops")),
        Operator::I32Load { .. }
        | Operator::I64Load { .. }
        | Operator::F32Load { .. }
        | Operator::F64Load { .. }
        | Operator::I32Load8S { .. }
        | Operator::I32Load8U { .. }
        | Operator::I32Load16S { .. }
        | Operator::I32Load16U { .. }
        | Operator::I64Load8S { .. }
        | Operator::I64Load8U { .. }
        | Operator::I64Load16S { .. }
        | Operator::I64Load16U { .. }
        | Operator::I64Load32S { .. }
        | Operator::I64Load32U { .. }
        | Operator::I32Store { .. }
        | Operator::I64Store { .. }
        | Operator::F32Store { .. }
        | Operator::F64Store { .. }
        | Operator::I32Store8 { .. }
        | Operator::I32Store16 { .. }
        | Operator::I64Store8 { .. }
        | Operator::I64Store16 { .. }
        | Operator::I64Store32 { .. }
        | Operator::MemorySize { .. }
        | Operator::MemoryGrow { .. } => Err(RuntimeError::Forbidden("memory access")),
        Operator::Unreachable => Err(RuntimeError::Forbidden("trap operator")),
        _ => Err(RuntimeError::Forbidden("operator outside frozen guest")),
    }
}

fn parser_value_type(value_type: &CoreWasmValueType) -> ValType {
    match value_type {
        CoreWasmValueType::I32 => ValType::I32,
        CoreWasmValueType::F64 => ValType::F64,
    }
}

fn restricted_engine() -> Engine {
    let mut config = Config::default();
    config
        .wasm_mutable_global(true)
        .wasm_sign_extension(false)
        .wasm_saturating_float_to_int(false)
        .wasm_multi_value(false)
        .wasm_multi_memory(false)
        .wasm_bulk_memory(false)
        .wasm_reference_types(false)
        .wasm_tail_call(false)
        .wasm_extended_const(false)
        .wasm_custom_page_sizes(false)
        .wasm_memory64(false)
        .wasm_wide_arithmetic(false)
        .floats(true)
        .consume_fuel(true)
        .ignore_custom_sections(false)
        .compilation_mode(CompilationMode::Eager);
    Engine::new(&config)
}

fn decode_action(raw_action: i32) -> Result<DecisionAction, RuntimeError> {
    DecisionAction::try_from(raw_action).map_err(RuntimeError::Decision)
}

fn execution_error(error: &WasmiError) -> RuntimeError {
    match error.as_trap_code() {
        Some(TrapCode::OutOfFuel) => RuntimeError::OutOfFuel,
        Some(trap) => RuntimeError::Trap(trap.to_string()),
        None => RuntimeError::Execution(error.to_string()),
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
struct ModuleFacts {
    types: u8,
    functions: u8,
    memories: u8,
    globals: u8,
    exports: u8,
    code_sections: u8,
    code_entries: u8,
    end: u8,
}

impl ModuleFacts {
    const fn expected() -> Self {
        Self {
            types: 1,
            functions: 1,
            memories: 1,
            globals: 1,
            exports: 1,
            code_sections: 1,
            code_entries: 1,
            end: 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;
    use crate::{artifact::StrategyArtifact, decision::DecisionContract};

    #[rstest]
    fn generated_module_has_the_exact_restricted_envelope() {
        let (intent, contract, artifact) = frozen_artifact();
        artifact
            .verify_binding(&intent, &contract)
            .expect("artifact binding");
        validate_restricted_module(artifact.wasm()).expect("restricted generated module");
        assert!(artifact.wasm().len() <= MAX_ARTIFACT_WASM_BYTES);
    }

    #[rstest]
    fn structural_and_capability_drift_is_rejected() {
        let (_, _, artifact) = frozen_artifact();
        let wasm = artifact.wasm();

        let import = insert_section(wasm, 2, &[1, 1, b'x', 1, b'y', 0, 0]);
        assert_eq!(
            validate_restricted_module(&import),
            Err(RuntimeError::Forbidden("imports"))
        );

        let mut exports = section_payload(wasm, 7).to_vec();
        assert_eq!(exports[0], 2);
        exports[0] = 3;
        exports.extend_from_slice(&[5, b'e', b'x', b't', b'r', b'a', 3, 0]);
        assert_eq!(
            validate_restricted_module(&replace_section(wasm, 7, &exports)),
            Err(RuntimeError::Export)
        );

        assert_eq!(
            validate_restricted_module(&replace_section(wasm, 5, &[1, 0, 1])),
            Err(RuntimeError::Envelope("fixed compiler memory"))
        );
        assert_eq!(
            validate_restricted_module(&replace_section(wasm, 5, &[1, 1, 2, 2])),
            Err(RuntimeError::Envelope("fixed compiler memory"))
        );

        let global_access = replace_section(wasm, 10, &[1, 4, 0, 0x23, 0, 0x0b]);
        assert_eq!(
            validate_restricted_module(&global_access),
            Err(RuntimeError::Forbidden("global access"))
        );
        let memory_access = replace_section(wasm, 10, &[1, 7, 0, 0x41, 0, 0x28, 0, 0, 0x0b]);
        assert_eq!(
            validate_restricted_module(&memory_access),
            Err(RuntimeError::Forbidden("memory access"))
        );
        let recursive_call = replace_section(
            wasm,
            10,
            &[
                1, 18, 0, 0x20, 0, 0x20, 1, 0x20, 2, 0x20, 3, 0x20, 4, 0x20, 5, 0x20, 6, 0x10, 0,
                0x0b,
            ],
        );
        assert_eq!(
            validate_restricted_module(&recursive_call),
            Err(RuntimeError::Forbidden("calls"))
        );
        let loop_body = replace_section(wasm, 10, &[1, 7, 0, 0x03, 0x7f, 0x41, 0, 0x0b, 0x0b]);
        assert_eq!(
            validate_restricted_module(&loop_body),
            Err(RuntimeError::Forbidden("loops"))
        );

        let custom = append_section(wasm, 0, &[0]);
        assert_eq!(
            validate_restricted_module(&custom),
            Err(RuntimeError::Forbidden("custom"))
        );

        let sign_extension = replace_section(wasm, 10, &[1, 5, 0, 0x20, 0, 0xc0, 0x0b]);
        assert!(matches!(
            validate_restricted_module(&sign_extension),
            Err(RuntimeError::Invalid(_))
        ));
    }

    #[rstest]
    fn fuel_unknown_action_and_trap_fail_without_hold_fallback() {
        let (intent, contract, artifact) = frozen_artifact();
        let (mut runtime, _) =
            prepare_decision_runtime(&artifact, &intent, &contract).expect("runtime");
        let input =
            DecisionInput::from_abi(0, 0, 101.0, 2.0, 1.0, 100.0, 90.0).expect("finite input");
        assert_eq!(
            runtime.call_with_fuel(input, 0),
            Err(RuntimeError::OutOfFuel)
        );
        let unknown_action =
            replace_section(artifact.wasm(), 10, &[1, 5, 0, 0x41, 0xe3, 0x00, 0x0b]);
        let mut unknown_runtime = instantiate_decision_runtime(&unknown_action, DECISION_EXPORT)
            .expect("unknown runtime");
        assert_eq!(
            unknown_runtime.decide(input),
            Err(RuntimeError::Decision(DecisionError::UnknownAction(99)))
        );
        assert_ne!(unknown_runtime.decide(input), Ok(DecisionAction::Hold));

        let trap = replace_section(artifact.wasm(), 10, &[1, 3, 0, 0x00, 0x0b]);
        let mut trap_runtime =
            instantiate_decision_runtime(&trap, DECISION_EXPORT).expect("trap runtime");
        assert!(matches!(
            trap_runtime.decide(input),
            Err(RuntimeError::Trap(_))
        ));
    }

    fn frozen_artifact() -> (ResearchIntent, DecisionContract, StrategyArtifact) {
        let intent = ResearchIntent::frozen().expect("frozen intent");
        let contract = DecisionContract::for_intent(&intent).expect("decision contract");
        let artifact = StrategyArtifact::issue(&intent, &contract).expect("artifact");
        (intent, contract, artifact)
    }

    fn section_payload(bytes: &[u8], wanted_id: u8) -> &[u8] {
        sections(bytes)
            .find_map(|(id, payload)| (id == wanted_id).then_some(payload))
            .unwrap_or_else(|| panic!("missing section {wanted_id}"))
    }

    fn replace_section(bytes: &[u8], wanted_id: u8, replacement: &[u8]) -> Vec<u8> {
        let mut output = bytes[..8].to_vec();
        let mut replaced = false;

        for (id, payload) in sections(bytes) {
            output.push(id);
            let payload = if id == wanted_id {
                replaced = true;
                replacement
            } else {
                payload
            };
            encode_u32(payload.len() as u32, &mut output);
            output.extend_from_slice(payload);
        }
        assert!(replaced, "section {wanted_id} must exist");
        output
    }

    fn insert_section(bytes: &[u8], new_id: u8, new_payload: &[u8]) -> Vec<u8> {
        let mut output = bytes[..8].to_vec();
        let mut inserted = false;
        for (id, payload) in sections(bytes) {
            if !inserted && id > new_id {
                output.push(new_id);
                encode_u32(new_payload.len() as u32, &mut output);
                output.extend_from_slice(new_payload);
                inserted = true;
            }
            output.push(id);
            encode_u32(payload.len() as u32, &mut output);
            output.extend_from_slice(payload);
        }
        assert!(inserted, "section insertion point must exist");
        output
    }

    fn append_section(bytes: &[u8], id: u8, payload: &[u8]) -> Vec<u8> {
        let mut output = bytes.to_vec();
        output.push(id);
        encode_u32(payload.len() as u32, &mut output);
        output.extend_from_slice(payload);
        output
    }

    fn sections(bytes: &[u8]) -> impl Iterator<Item = (u8, &[u8])> {
        assert_eq!(&bytes[..8], b"\0asm\x01\0\0\0");
        let mut cursor = 8;
        std::iter::from_fn(move || {
            if cursor == bytes.len() {
                return None;
            }
            let id = bytes[cursor];
            cursor += 1;
            let length = decode_u32(bytes, &mut cursor) as usize;
            let end = cursor + length;
            let payload = &bytes[cursor..end];
            cursor = end;
            Some((id, payload))
        })
    }

    fn decode_u32(bytes: &[u8], cursor: &mut usize) -> u32 {
        let mut value = 0_u32;
        let mut shift = 0;

        loop {
            let byte = bytes[*cursor];
            *cursor += 1;
            value |= u32::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return value;
            }
            shift += 7;
        }
    }

    fn encode_u32(mut value: u32, output: &mut Vec<u8>) {
        loop {
            let mut byte = (value & 0x7f) as u8;
            value >>= 7;
            if value != 0 {
                byte |= 0x80;
            }
            output.push(byte);

            if value == 0 {
                return;
            }
        }
    }
}
