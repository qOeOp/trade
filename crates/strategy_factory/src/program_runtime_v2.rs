//! Fresh-instance execution boundary for already admitted V2 plugin modules.

use std::ops::Range;

use thiserror::Error;
use wasmi::{
    Config, Engine, Error as WasmiError, Linker, Memory, Module, Store, TrapCode, TypedFunc,
};

use crate::{
    artifact_v2::StrategyArtifactModuleV2,
    plugin_wire_v2::{PluginFrameKindV2, PluginFrameV2},
    program_runtime::{
        PLUGIN_INPUT_CAPACITY_EXPORT_V2, PLUGIN_INPUT_PTR_EXPORT_V2, PLUGIN_INVOKE_EXPORT_V2,
        PLUGIN_OUTPUT_CAPACITY_EXPORT_V2, PLUGIN_OUTPUT_PTR_EXPORT_V2,
        validate_plugin_candidate_v2,
    },
    strategy_design_v2::PluginManifestV2,
};

const MEMORY_EXPORT: &str = "memory";

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum ProgramPluginRuntimeV2Error {
    #[error("unsupported plugin at {coordinate}: {reason}")]
    Unsupported {
        coordinate: &'static str,
        reason: String,
    },
}

pub struct ProgramPluginRuntimeV2;

impl ProgramPluginRuntimeV2 {
    pub fn invoke(
        module: &StrategyArtifactModuleV2,
        manifest: &PluginManifestV2,
        input: &PluginFrameV2,
    ) -> Result<PluginFrameV2, ProgramPluginRuntimeV2Error> {
        if input.kind != PluginFrameKindV2::Input
            || module.plugin_semantic_id() != manifest.semantic_id
            || module.manifest_digest() != input.manifest_digest
            || module.module_identity() != input.module_identity
        {
            return Err(unsupported(
                "module_identity",
                "artifact, manifest, and input identities differ",
            ));
        }
        validate_plugin_candidate_v2(module.wasm(), manifest)
            .map_err(|e| unsupported("module_receipt", e.to_string()))?;
        let input_bytes = input
            .encode(manifest)
            .map_err(|e| unsupported("input_frame", e.to_string()))?;

        let engine = engine();
        let compiled = Module::new(&engine, module.wasm())
            .map_err(|e| unsupported("module", e.to_string()))?;
        let mut store = Store::new(&engine, ());
        let instance = Linker::new(&engine)
            .instantiate_and_start(&mut store, &compiled)
            .map_err(|e| map_execution(&e))?;
        store
            .set_fuel(manifest.max_fuel)
            .map_err(|e| map_execution(&e))?;
        let memory = instance
            .get_memory(&store, MEMORY_EXPORT)
            .ok_or_else(|| unsupported("memory", "missing memory export"))?;
        let input_range = exported_range(
            instance,
            &mut store,
            memory,
            PLUGIN_INPUT_PTR_EXPORT_V2,
            PLUGIN_INPUT_CAPACITY_EXPORT_V2,
        )?;
        let output_range = exported_range(
            instance,
            &mut store,
            memory,
            PLUGIN_OUTPUT_PTR_EXPORT_V2,
            PLUGIN_OUTPUT_CAPACITY_EXPORT_V2,
        )?;

        if overlaps(&input_range, &output_range) {
            return Err(unsupported("memory", "input and output buffers overlap"));
        }

        if input_bytes.len() > input_range.len() {
            return Err(unsupported(
                "input_frame",
                "canonical frame exceeds input capacity",
            ));
        }
        memory
            .write(&mut store, input_range.start, &input_bytes)
            .map_err(|e| unsupported("input_frame", e.to_string()))?;
        let invoke = instance
            .get_typed_func::<i32, i32>(&store, PLUGIN_INVOKE_EXPORT_V2)
            .map_err(|_| unsupported("invoke", "wrong invoke signature"))?;
        let status = invoke
            .call(
                &mut store,
                i32::try_from(input_bytes.len())
                    .map_err(|_| unsupported("input_frame", "frame length exceeds i32"))?,
            )
            .map_err(|e| map_execution(&e))?;
        if status < 0 {
            return Err(unsupported(
                "guest_status",
                format!("guest returned {status}"),
            ));
        }
        let output_len = usize::try_from(status)
            .map_err(|_| unsupported("output_frame", "negative output length"))?;
        if output_len > output_range.len() {
            return Err(unsupported(
                "output_frame",
                "guest length exceeds output capacity",
            ));
        }
        let mut output = vec![0; output_len];
        memory
            .read(&store, output_range.start, &mut output)
            .map_err(|e| unsupported("output_frame", e.to_string()))?;
        PluginFrameV2::decode_exact(
            &output,
            PluginFrameKindV2::Output,
            manifest,
            module.manifest_digest(),
            module.module_identity(),
            input.invocation_identity,
        )
        .map_err(|e| unsupported("output_frame", e.to_string()))
    }
}

fn exported_range(
    instance: wasmi::Instance,
    store: &mut Store<()>,
    memory: Memory,
    ptr_name: &str,
    capacity_name: &str,
) -> Result<Range<usize>, ProgramPluginRuntimeV2Error> {
    let ptr: TypedFunc<(), i32> = instance
        .get_typed_func(&*store, ptr_name)
        .map_err(|_| unsupported("memory", "wrong pointer signature"))?;
    let capacity: TypedFunc<(), i32> = instance
        .get_typed_func(&*store, capacity_name)
        .map_err(|_| unsupported("memory", "wrong capacity signature"))?;
    let start = ptr.call(&mut *store, ()).map_err(|e| map_execution(&e))? as u32 as usize;
    let len = capacity
        .call(&mut *store, ())
        .map_err(|e| map_execution(&e))? as u32 as usize;
    let end = start
        .checked_add(len)
        .filter(|end| *end <= memory.data_size(&*store))
        .ok_or_else(|| unsupported("memory", "buffer is outside linear memory"))?;
    if len == 0 {
        return Err(unsupported("memory", "zero-capacity buffer"));
    }
    Ok(start..end)
}

fn overlaps(left: &Range<usize>, right: &Range<usize>) -> bool {
    left.start < right.end && right.start < left.end
}

fn engine() -> Engine {
    let mut config = Config::default();
    config.consume_fuel(true);
    Engine::new(&config)
}

fn map_execution(error: &WasmiError) -> ProgramPluginRuntimeV2Error {
    match error.as_trap_code() {
        Some(TrapCode::OutOfFuel) => unsupported("fuel", "plugin exhausted its manifest fuel"),
        Some(trap) => unsupported("trap", trap.to_string()),
        None => unsupported("execution", error.to_string()),
    }
}

fn unsupported(coordinate: &'static str, reason: impl Into<String>) -> ProgramPluginRuntimeV2Error {
    ProgramPluginRuntimeV2Error::Unsupported {
        coordinate,
        reason: reason.into(),
    }
}
