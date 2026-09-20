//! Execution Owner contracts: PAPER adapter bindings and the PAPER recovery-frontier read seam.
//!
//! This crate owns the Execution Owner's admission vocabulary, its sealed positive readbacks, and
//! the PostgreSQL custody that alone can mint them. It exposes no adapter invocation surface, no
//! order lifecycle, no Effect Journal, and no credential material. The inherited execution engine in
//! `vibe-execution` stays a migration source and holds no Owner fact.

#![deny(unsafe_code)]
#![deny(missing_debug_implementations)]
#![deny(rustdoc::broken_intra_doc_links)]

pub mod adapter_binding;
pub mod adapter_binding_postgres;
pub mod paper_account_opening;
pub mod recovery_frontier;
pub mod venue_binding;
