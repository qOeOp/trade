//! Provides an Apache Parquet backend powered by [DataFusion](https://arrow.apache.org/datafusion).

use std::future::Future;

use tokio::runtime::Handle;

pub mod binary_heap;
pub mod catalog;
pub mod catalog_operations;
pub mod compare;
pub mod custom;
pub mod feather;
pub mod kmerge_batch;
pub mod session;

/// Runs an async operation from a synchronous persistence API.
///
/// `block_in_place` permits re-entering the shared multi-thread Vibe runtime and executes the
/// closure directly when called outside a Tokio runtime.
///
/// # Panics
///
/// Panics when called from a Tokio `current_thread` runtime. The shared Vibe runtime is
/// required to be multi-threaded.
pub(crate) fn block_on<F>(runtime: &Handle, future: F) -> F::Output
where
    F: Future,
{
    tokio::task::block_in_place(|| runtime.block_on(future))
}
