//! The R&D Owner API binary: everything it serves is composed in the library
//! (`vibe_strategy_factory_rd_owner_api::server`); this entry point only gives the runtime the stack
//! it needs and runs it.

/// The stack each runtime worker gets. Axum runs every request on a worker, and tokio's default is
/// 2 MiB.
///
/// Measured at release codegen (opt-level 3, one codegen unit, no LTO) on the serial R&D chain,
/// whose database holds the custody states that send a V3 Research submission down its deepest
/// lineage branch (Linux x86). On main 90facb147 (owner-chains run 37038610356) a V3 `submit_v2`
/// peaks at 336 KiB, the Source Intake V3 submission at 384 KiB, and the deepest chain entry at
/// 600 KiB. Before #1219 split the deepest futures on that path, the same probe read 608 KiB and
/// 1000 KiB (run 36362053221). Against these readings:
/// - no LTO: direction unknown;
/// - hyper, axum and the worker loop around a production request, absent from the reading: the
///   reading is optimistic;
/// - the tests unwind where this binary aborts: the reading is, if anything, pessimistic;
/// - database states the chain never builds: direction unknown.
///
/// With two of four biases unknown and one optimistic, the 2 MiB default leaves about 1.4 MiB of
/// margin that is partly unmeasured; 4 MiB leaves about 3.4 MiB. Stacks are committed as they are
/// touched, so the larger reservation costs address space, not memory. An overflow aborts the whole
/// process. The depth itself is kept down by keeping the deepest futures off one stack (#1219);
/// this size covers what the measurement cannot see.
const RUNTIME_WORKER_STACK_BYTES: usize = 4 * 1024 * 1024;

fn main() -> anyhow::Result<()> {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_stack_size(RUNTIME_WORKER_STACK_BYTES)
        .build()?
        .block_on(vibe_strategy_factory_rd_owner_api::server::run())
}
