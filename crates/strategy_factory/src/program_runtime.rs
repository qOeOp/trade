#![allow(clippy::needless_pass_by_value)]

use std::ops::Range;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use wasmi::{
    Config, Engine, Error as WasmiError, Instance, Linker, Memory, Module, Store, TrapCode,
    TypedFunc,
};
use wasmparser::{Encoding, ExternalKind, Operator, Parser, Payload, Validator, WasmFeatures};

use crate::artifact::StrategyArtifact;

const MEMORY_EXPORT: &str = "memory";
const FRAME_PTR_EXPORT: &str = "strategy_factory_frame_ptr_v1";
const FRAME_CAPACITY_EXPORT: &str = "strategy_factory_frame_capacity_v1";
const PROPOSAL_PTR_EXPORT: &str = "strategy_factory_proposal_ptr_v1";
const PROPOSAL_CAPACITY_EXPORT: &str = "strategy_factory_proposal_capacity_v1";
const ON_EVENT_EXPORT: &str = "strategy_factory_on_event_v1";
const MAX_FUNCTIONS: u32 = 512;
const MAX_TYPES: u32 = 64;
const MAX_GLOBALS: u32 = 128;
const MAX_TABLES: u32 = 4;
const MAX_TABLE_ELEMENTS: u64 = 4_096;
const MAX_DATA_SEGMENTS: u32 = 128;
const MAX_FUNCTION_BODY_BYTES: usize = 32 * 1024;

/// Runtime projection of an upper-layer frozen profile; archive, trial, and source budgets remain with their owners.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProgramRuntimeBudget {
    pub max_module_bytes: usize,
    pub fuel: u64,
}

pub(crate) struct StrategyProgramV1 {
    store: Store<()>,
    memory: Memory,
    on_event: TypedFunc<i32, i32>,
    frame: Range<usize>,
    proposal: Range<usize>,
    fuel: u64,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub(crate) enum ProgramRuntimeError {
    #[error("strategy program module is invalid: {0}")]
    InvalidModule(String),
    #[error("strategy program forbids {0}")]
    Forbidden(&'static str),
    #[error("strategy program exceeds resource budget: {0}")]
    ResourceLimit(&'static str),
    #[error("strategy program SDK ABI mismatch: {0}")]
    Abi(&'static str),
    #[error("strategy program memory layout is invalid: {0}")]
    MemoryLayout(&'static str),
    #[error("frame length {0} exceeds program capacity {1}")]
    FrameTooLarge(usize, usize),
    #[error("strategy program returned guest fault {0}")]
    GuestFault(i32),
    #[error("strategy program returned proposal length {0} above capacity {1}")]
    ProposalLength(usize, usize),
    #[error("strategy program exhausted its fuel budget")]
    OutOfFuel,
    #[error("strategy program trapped: {0}")]
    Trap(String),
    #[error("strategy program execution failed: {0}")]
    Execution(String),
}

impl StrategyProgramV1 {
    fn new(wasm: &[u8], budget: ProgramRuntimeBudget) -> Result<Self, ProgramRuntimeError> {
        validate_module(wasm, budget)?;
        let engine = engine();
        let module = Module::new(&engine, wasm)
            .map_err(|e| ProgramRuntimeError::InvalidModule(e.to_string()))?;
        let mut store = Store::new(&engine, ());
        let instance = Linker::new(&engine)
            .instantiate_and_start(&mut store, &module)
            .map_err(execution_error)?;
        let memory = instance
            .get_memory(&store, MEMORY_EXPORT)
            .ok_or(ProgramRuntimeError::Abi("memory export"))?;
        let frame_ptr = abi_i32(instance, &store, FRAME_PTR_EXPORT)?;
        let frame_capacity = abi_i32(instance, &store, FRAME_CAPACITY_EXPORT)?;
        let proposal_ptr = abi_i32(instance, &store, PROPOSAL_PTR_EXPORT)?;
        let proposal_capacity = abi_i32(instance, &store, PROPOSAL_CAPACITY_EXPORT)?;
        let on_event = instance
            .get_typed_func::<i32, i32>(&store, ON_EVENT_EXPORT)
            .map_err(|_| ProgramRuntimeError::Abi("on_event signature"))?;

        store.set_fuel(budget.fuel).map_err(execution_error)?;
        let frame = checked_range(
            frame_ptr.call(&mut store, ()).map_err(execution_error)?,
            frame_capacity
                .call(&mut store, ())
                .map_err(execution_error)?,
            memory.data_size(&store),
        )?;
        let proposal = checked_range(
            proposal_ptr.call(&mut store, ()).map_err(execution_error)?,
            proposal_capacity
                .call(&mut store, ())
                .map_err(execution_error)?,
            memory.data_size(&store),
        )?;

        if frame.start < proposal.end && proposal.start < frame.end {
            return Err(ProgramRuntimeError::MemoryLayout("buffers overlap"));
        }
        Ok(Self {
            store,
            memory,
            on_event,
            frame,
            proposal,
            fuel: budget.fuel,
        })
    }

    pub(crate) fn invoke(&mut self, frame: &[u8]) -> Result<Vec<u8>, ProgramRuntimeError> {
        let frame_capacity = self.frame.len();
        if frame.len() > frame_capacity {
            return Err(ProgramRuntimeError::FrameTooLarge(
                frame.len(),
                frame_capacity,
            ));
        }
        self.memory
            .write(&mut self.store, self.frame.start, frame)
            .map_err(|e| ProgramRuntimeError::Execution(e.to_string()))?;

        self.store.set_fuel(self.fuel).map_err(execution_error)?;
        let length = self
            .on_event
            .call(&mut self.store, frame.len() as i32)
            .map_err(execution_error)?;

        if length < 0 {
            return Err(ProgramRuntimeError::GuestFault(length));
        }
        let length = length as usize;
        if length > self.proposal.len() {
            return Err(ProgramRuntimeError::ProposalLength(
                length,
                self.proposal.len(),
            ));
        }
        let mut output = vec![0; length];
        self.memory
            .read(&self.store, self.proposal.start, &mut output)
            .map_err(|e| ProgramRuntimeError::Execution(e.to_string()))?;
        Ok(output)
    }

    pub(crate) fn from_artifact(artifact: &StrategyArtifact) -> Result<Self, ProgramRuntimeError> {
        let profile = artifact.program_profile();
        Self::new(artifact.wasm(), profile.runtime_budget)
    }
}

pub(crate) fn validate_candidate_for_artifact(
    wasm: &[u8],
    budget: ProgramRuntimeBudget,
) -> Result<(), ProgramRuntimeError> {
    StrategyProgramV1::new(wasm, budget).map(drop)
}

fn checked_range(ptr: i32, cap: i32, size: usize) -> Result<Range<usize>, ProgramRuntimeError> {
    let start = ptr as u32 as usize;
    let cap = cap as u32 as usize;
    if cap == 0 {
        return Err(ProgramRuntimeError::MemoryLayout("zero-capacity buffer"));
    }
    let end = start
        .checked_add(cap)
        .filter(|end| *end <= size)
        .ok_or(ProgramRuntimeError::MemoryLayout("buffer outside memory"))?;
    Ok(start..end)
}

fn abi_i32(
    i: Instance,
    s: &Store<()>,
    name: &str,
) -> Result<TypedFunc<(), i32>, ProgramRuntimeError> {
    i.get_typed_func(s, name)
        .map_err(|_| ProgramRuntimeError::Abi("pointer/capacity signature"))
}

fn validate_module(wasm: &[u8], budget: ProgramRuntimeBudget) -> Result<(), ProgramRuntimeError> {
    limit(wasm.len(), budget.max_module_bytes, "module bytes")?;
    let mut exports = Vec::new();
    let mut memory_seen = false;

    for payload in Parser::new(0).parse_all(wasm) {
        match payload.map_err(invalid_module)? {
            Payload::Version {
                num: 1,
                encoding: Encoding::Module,
                ..
            } => {}
            Payload::Version { .. } => return Err(ProgramRuntimeError::Abi("Wasm1 module")),
            Payload::TypeSection(section) => limit(section.count(), MAX_TYPES, "types")?,
            Payload::FunctionSection(section) => {
                limit(section.count(), MAX_FUNCTIONS, "functions")?;
            }
            Payload::TableSection(section) => {
                limit(section.count(), MAX_TABLES, "tables")?;
                let mut elements = 0_u64;

                for table in section {
                    let table = table.map_err(invalid_module)?;
                    let maximum = table
                        .ty
                        .maximum
                        .ok_or(ProgramRuntimeError::ResourceLimit("table elements"))?;
                    elements = elements
                        .checked_add(maximum)
                        .ok_or(ProgramRuntimeError::ResourceLimit("table elements"))?;
                }
                limit(elements, MAX_TABLE_ELEMENTS, "table elements")?;
            }
            Payload::MemorySection(section) => {
                if memory_seen || section.count() != 1 {
                    return Err(ProgramRuntimeError::Abi("one memory"));
                }
                let memory = section
                    .into_iter()
                    .next()
                    .ok_or(ProgramRuntimeError::Abi("one memory"))?
                    .map_err(invalid_module)?;

                if memory.memory64
                    || memory.shared
                    || memory.initial != 1
                    || memory.maximum != Some(1)
                    || memory.page_size_log2.is_some()
                {
                    return Err(ProgramRuntimeError::Abi("fixed one-page memory"));
                }
                memory_seen = true;
            }
            Payload::GlobalSection(section) => {
                limit(section.count(), MAX_GLOBALS, "globals")?;
            }
            Payload::ExportSection(section) => {
                for export in section {
                    let export = export.map_err(invalid_module)?;
                    exports.push((export.name.to_owned(), export.kind, export.index));
                }
            }
            Payload::DataSection(section) => {
                limit(section.count(), MAX_DATA_SEGMENTS, "data segments")?;
            }
            Payload::CodeSectionEntry(body) => {
                let body_bytes = body.range().len();
                limit(body_bytes, MAX_FUNCTION_BODY_BYTES, "function body bytes")?;
                let mut operators = body.get_operators_reader().map_err(invalid_module)?;
                while !operators.eof() {
                    if matches!(
                        operators.read().map_err(invalid_module)?,
                        Operator::MemoryGrow { .. }
                    ) {
                        return Err(ProgramRuntimeError::Forbidden("memory.grow"));
                    }
                }
            }
            Payload::ImportSection(_) => return Err(ProgramRuntimeError::Forbidden("imports")),
            Payload::StartSection { .. } => return Err(ProgramRuntimeError::Forbidden("start")),
            _ => {}
        }
    }
    Validator::new_with_features(WasmFeatures::WASM1)
        .validate_all(wasm)
        .map_err(invalid_module)?;

    if !memory_seen {
        return Err(ProgramRuntimeError::Abi("one memory"));
    }
    validate_exports(&exports)
}

fn validate_exports(exports: &[(String, ExternalKind, u32)]) -> Result<(), ProgramRuntimeError> {
    let mut seen = 0_u8;

    for (name, kind, index) in exports {
        seen |= match (name.as_str(), kind, index) {
            (MEMORY_EXPORT, ExternalKind::Memory, 0) => 1,
            (FRAME_PTR_EXPORT, ExternalKind::Func, _) => 2,
            (FRAME_CAPACITY_EXPORT, ExternalKind::Func, _) => 4,
            (PROPOSAL_PTR_EXPORT, ExternalKind::Func, _) => 8,
            (PROPOSAL_CAPACITY_EXPORT, ExternalKind::Func, _) => 16,
            (ON_EVENT_EXPORT, ExternalKind::Func, _) => 32,
            _ => 0,
        };
    }

    if exports.len() != 6 || seen != 63 {
        return Err(ProgramRuntimeError::Abi("exact exports"));
    }
    Ok(())
}

fn limit<T: PartialOrd>(actual: T, max: T, name: &'static str) -> Result<(), ProgramRuntimeError> {
    (actual <= max)
        .then_some(())
        .ok_or(ProgramRuntimeError::ResourceLimit(name))
}

fn engine() -> Engine {
    // The pre-instantiation WASM1 Validator is the feature gate; wasmi only receives admitted bytes.
    let mut config = Config::default();
    config.consume_fuel(true);
    Engine::new(&config)
}

fn invalid_module(error: wasmparser::BinaryReaderError) -> ProgramRuntimeError {
    ProgramRuntimeError::InvalidModule(error.to_string())
}

fn execution_error(error: WasmiError) -> ProgramRuntimeError {
    match error.as_trap_code() {
        Some(TrapCode::OutOfFuel) => ProgramRuntimeError::OutOfFuel,
        Some(trap) => ProgramRuntimeError::Trap(trap.to_string()),
        None => ProgramRuntimeError::Execution(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use std::{ffi::OsStr, fs, path::Path, process::Command, sync::OnceLock};

    use rstest::rstest;
    use strategy_factory_program_sdk::{FrameEncoder, ProgramRunScope};

    use super::*;

    const PROGRAM_RUSTFLAGS: &str = "-Dwarnings \
        -Clink-arg=--initial-memory=65536 \
        -Clink-arg=--max-memory=65536 \
        -Clink-arg=--stack-first -Clink-arg=-z \
        -Clink-arg=stack-size=32768";
    const AMBIENT_RUST_FLAG_VARS: [&str; 4] = [
        "RUSTFLAGS",
        "RUSTDOCFLAGS",
        "CARGO_ENCODED_RUSTFLAGS",
        "CARGO_ENCODED_RUSTDOCFLAGS",
    ];

    #[derive(Clone, Copy)]
    enum EventBody {
        Return(i32),
        Trap,
        Grow,
        Spin,
    }

    #[derive(Clone, Copy)]
    struct ModuleSpec {
        import: bool,
        start: bool,
        export_event: bool,
        memory_max: u8,
        frame_ptr: i32,
        frame_capacity: i32,
        proposal_ptr: i32,
        proposal_capacity: i32,
        event: EventBody,
    }

    impl ModuleSpec {
        fn valid() -> Self {
            Self {
                import: false,
                start: false,
                export_event: true,
                memory_max: 1,
                frame_ptr: 1024,
                frame_capacity: 4096,
                proposal_ptr: 8192,
                proposal_capacity: 4096,
                event: EventBody::Return(0),
            }
        }
    }

    fn budget(fuel: u64) -> ProgramRuntimeBudget {
        ProgramRuntimeBudget {
            max_module_bytes: 64 * 1024,
            fuel,
        }
    }

    #[rstest]
    fn real_channel_control_and_pilot_programs_execute_sdk_start_frames() {
        let (channel, pilot) = real_programs();
        let mut channel_parameters = [0_u8; 32];
        channel_parameters[..8].copy_from_slice(&((1_u64 << 1) | (1_u64 << 10)).to_le_bytes());
        channel_parameters[8..12].copy_from_slice(&1_u32.to_le_bytes());
        channel_parameters[12..16].copy_from_slice(&2_u32.to_le_bytes());
        channel_parameters[16..20].copy_from_slice(&1_024_u32.to_le_bytes());
        channel_parameters[20..24].copy_from_slice(&10_u32.to_le_bytes());
        channel_parameters[24..32].copy_from_slice(&1_f64.to_bits().to_le_bytes());
        let mut pilot_parameters = [0_u8; 56];
        pilot_parameters[..4].copy_from_slice(&1_u32.to_le_bytes());
        pilot_parameters[4..8].copy_from_slice(&2_u32.to_le_bytes());
        for (offset, value) in [(8, 2_u16), (10, 3), (12, 2), (14, 2)] {
            pilot_parameters[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
        }
        pilot_parameters[16..24].copy_from_slice(&1_f64.to_bits().to_le_bytes());
        for (offset, value) in [(24, 1_u64), (32, 10), (40, 5), (48, 1)] {
            pilot_parameters[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
        }

        for (wasm, parameters) in [
            (channel.as_slice(), channel_parameters.as_slice()),
            (pilot.as_slice(), pilot_parameters.as_slice()),
        ] {
            let mut runtime = StrategyProgramV1::new(wasm, budget(1_000_000)).unwrap();
            assert!(runtime.invoke(&start_frame(parameters)).unwrap().is_empty());
        }
    }

    #[rstest]
    fn real_program_builds_ignore_ci_rustflags_and_keep_explicit_warning_discipline() {
        let injected_env = [
            ("RUSTFLAGS", "-D warnings"),
            ("RUSTDOCFLAGS", "-D warnings"),
            (
                "CARGO_ENCODED_RUSTFLAGS",
                "-Dwarnings\u{1f}-Clink-arg=--initial-memory=1114112",
            ),
            ("CARGO_ENCODED_RUSTDOCFLAGS", "-Dwarnings"),
        ];
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("programs");
        let target = tempfile::tempdir().unwrap();
        let command = program_build_command(&root.join("pilot"), target.path(), &injected_env);

        for name in AMBIENT_RUST_FLAG_VARS {
            assert!(matches!(
                command.get_envs().find(|(key, _)| *key == OsStr::new(name)),
                Some((_, None))
            ));
        }
        assert_eq!(
            command
                .get_envs()
                .find(|(key, _)| *key == OsStr::new("CARGO_TARGET_WASM32V1_NONE_RUSTFLAGS"))
                .and_then(|(_, value)| value),
            Some(OsStr::new(PROGRAM_RUSTFLAGS))
        );

        let (channel, pilot) = build_real_programs(&injected_env);
        for wasm in [&channel, &pilot] {
            StrategyProgramV1::new(wasm, budget(1_000_000)).unwrap();
        }
    }

    #[rstest]
    fn module_envelope_rejects_import_start_export_memory_and_grow() {
        let cases = [
            (
                ModuleSpec {
                    import: true,
                    ..ModuleSpec::valid()
                },
                ProgramRuntimeError::Forbidden("imports"),
            ),
            (
                ModuleSpec {
                    start: true,
                    ..ModuleSpec::valid()
                },
                ProgramRuntimeError::Forbidden("start"),
            ),
            (
                ModuleSpec {
                    export_event: false,
                    ..ModuleSpec::valid()
                },
                ProgramRuntimeError::Abi("exact exports"),
            ),
            (
                ModuleSpec {
                    memory_max: 2,
                    ..ModuleSpec::valid()
                },
                ProgramRuntimeError::Abi("fixed one-page memory"),
            ),
            (
                ModuleSpec {
                    event: EventBody::Grow,
                    ..ModuleSpec::valid()
                },
                ProgramRuntimeError::Forbidden("memory.grow"),
            ),
        ];

        for (spec, expected) in cases {
            assert_eq!(new_error(&module(spec), budget(10_000)), expected);
        }
    }

    #[rstest]
    fn module_byte_budget_is_artifact_bound() {
        let wasm = module(ModuleSpec::valid());
        let mut constrained = budget(10_000);
        constrained.max_module_bytes = wasm.len() - 1;
        assert_eq!(
            new_error(&wasm, constrained),
            ProgramRuntimeError::ResourceLimit("module bytes")
        );
    }

    #[rstest]
    fn buffer_pointer_and_capacity_fail_closed() {
        for spec in [
            ModuleSpec {
                frame_ptr: 65_000,
                ..ModuleSpec::valid()
            },
            ModuleSpec {
                frame_capacity: 0,
                ..ModuleSpec::valid()
            },
            ModuleSpec {
                proposal_ptr: 2048,
                ..ModuleSpec::valid()
            },
        ] {
            assert!(matches!(
                StrategyProgramV1::new(&module(spec), budget(10_000)),
                Err(ProgramRuntimeError::MemoryLayout(_))
            ));
        }
    }

    #[rstest]
    fn guest_fault_proposal_capacity_trap_and_fuel_are_explicit() {
        let cases = [
            (EventBody::Return(-5), ProgramRuntimeError::GuestFault(-5)),
            (
                EventBody::Return(4097),
                ProgramRuntimeError::ProposalLength(4097, 4096),
            ),
            (
                EventBody::Trap,
                ProgramRuntimeError::Trap("wasm `unreachable` instruction executed".to_owned()),
            ),
            (EventBody::Spin, ProgramRuntimeError::OutOfFuel),
        ];

        for (event, expected) in cases {
            let mut runtime = StrategyProgramV1::new(
                &module(ModuleSpec {
                    event,
                    ..ModuleSpec::valid()
                }),
                budget(10_000),
            )
            .unwrap();
            assert_eq!(runtime.invoke(&[]).unwrap_err(), expected);
        }
    }

    fn start_frame(parameters: &[u8]) -> Vec<u8> {
        let mut frame = vec![0_u8; 48 + parameters.len()];
        let len = FrameEncoder::start(
            &mut frame,
            1,
            ProgramRunScope::new(1, 1, 2).unwrap(),
            parameters,
        )
        .unwrap()
        .finish();
        frame.truncate(len);
        frame
    }

    fn new_error(wasm: &[u8], budget: ProgramRuntimeBudget) -> ProgramRuntimeError {
        match StrategyProgramV1::new(wasm, budget) {
            Ok(_) => panic!("module unexpectedly admitted"),
            Err(e) => e,
        }
    }

    fn real_programs() -> &'static (Vec<u8>, Vec<u8>) {
        static PROGRAMS: OnceLock<(Vec<u8>, Vec<u8>)> = OnceLock::new();
        PROGRAMS.get_or_init(|| build_real_programs(&[]))
    }

    fn build_real_programs(injected_env: &[(&str, &str)]) -> (Vec<u8>, Vec<u8>) {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("programs");
        let target = tempfile::tempdir().unwrap();

        for package in ["channel_control", "pilot"] {
            let project = root.join(package);
            let output = program_build_command(&project, target.path(), injected_env)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "program build from {} failed: {}",
                project.display(),
                String::from_utf8_lossy(&output.stderr)
            );
        }
        let output = target.path().join("wasm32v1-none/release");
        (
            read_wasm(&output, "strategy_factory_channel_control_program.wasm"),
            read_wasm(&output, "strategy_factory_pilot_program.wasm"),
        )
    }

    fn program_build_command(
        project: &Path,
        target: &Path,
        injected_env: &[(&str, &str)],
    ) -> Command {
        let mut command = Command::new(env!("CARGO"));
        command.envs(injected_env.iter().copied());
        for name in AMBIENT_RUST_FLAG_VARS {
            command.env_remove(name);
        }
        command
            .env("CARGO_TARGET_WASM32V1_NONE_RUSTFLAGS", PROGRAM_RUSTFLAGS)
            .args([
                "build",
                "--frozen",
                "--offline",
                "--release",
                "--target",
                "wasm32v1-none",
            ])
            .arg("--target-dir")
            .arg(target)
            .current_dir(project);
        command
    }

    fn read_wasm(root: &Path, name: &str) -> Vec<u8> {
        fs::read(root.join(name)).unwrap()
    }

    fn module(spec: ModuleSpec) -> Vec<u8> {
        let mut wasm = b"\0asm\x01\0\0\0".to_vec();
        section(&mut wasm, 1, &[2, 0x60, 0, 1, 0x7f, 0x60, 1, 0x7f, 1, 0x7f]);

        if spec.import {
            let mut import = vec![1];
            name(&mut import, "host");
            name(&mut import, "f");
            import.extend([0, 0]);
            section(&mut wasm, 2, &import);
        }
        section(&mut wasm, 3, &[5, 0, 0, 0, 0, 1]);
        section(&mut wasm, 5, &[1, 1, 1, spec.memory_max]);
        let shift = u32::from(spec.import);
        let mut exports = Vec::new();
        exports.push(5 + u8::from(spec.export_event));
        export(&mut exports, MEMORY_EXPORT, 2, 0);

        for (name, index) in [
            (FRAME_PTR_EXPORT, 0),
            (FRAME_CAPACITY_EXPORT, 1),
            (PROPOSAL_PTR_EXPORT, 2),
            (PROPOSAL_CAPACITY_EXPORT, 3),
        ] {
            export(&mut exports, name, 0, index + shift);
        }

        if spec.export_event {
            export(&mut exports, ON_EVENT_EXPORT, 0, 4 + shift);
        }
        section(&mut wasm, 7, &exports);
        if spec.start {
            section(&mut wasm, 8, &[shift as u8]);
        }
        let mut code = vec![5];

        for value in [
            spec.frame_ptr,
            spec.frame_capacity,
            spec.proposal_ptr,
            spec.proposal_capacity,
        ] {
            body(&mut code, &i32_const(value));
        }
        let event = match spec.event {
            EventBody::Return(value) => i32_const(value),
            EventBody::Trap => vec![0x00],
            EventBody::Grow => vec![0x41, 1, 0x40, 0, 0x1a, 0x41, 0],
            EventBody::Spin => vec![0x03, 0x40, 0x0c, 0, 0x0b, 0x41, 0],
        };
        body(&mut code, &event);
        section(&mut wasm, 10, &code);
        wasm
    }

    fn section(wasm: &mut Vec<u8>, id: u8, payload: &[u8]) {
        wasm.push(id);
        u32_leb(wasm, payload.len() as u32);
        wasm.extend(payload);
    }

    fn export(bytes: &mut Vec<u8>, export_name: &str, kind: u8, index: u32) {
        name(bytes, export_name);
        bytes.push(kind);
        u32_leb(bytes, index);
    }

    fn name(bytes: &mut Vec<u8>, value: &str) {
        u32_leb(bytes, value.len() as u32);
        bytes.extend(value.as_bytes());
    }

    fn body(code: &mut Vec<u8>, operators: &[u8]) {
        let mut bytes = vec![0];
        bytes.extend(operators);
        bytes.push(0x0b);
        u32_leb(code, bytes.len() as u32);
        code.extend(bytes);
    }

    fn i32_const(value: i32) -> Vec<u8> {
        let mut bytes = vec![0x41];
        let mut value = value;
        loop {
            let byte = value as u8 & 0x7f;
            value >>= 7;
            let done = (value == 0 && byte & 0x40 == 0) || (value == -1 && byte & 0x40 != 0);
            bytes.push(if done { byte } else { byte | 0x80 });
            if done {
                return bytes;
            }
        }
    }

    fn u32_leb(bytes: &mut Vec<u8>, mut value: u32) {
        loop {
            let byte = value as u8 & 0x7f;
            value >>= 7;
            bytes.push(if value == 0 { byte } else { byte | 0x80 });
            if value == 0 {
                return;
            }
        }
    }
}
