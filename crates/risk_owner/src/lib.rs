//! Risk Owner capacity input read port.
//!
//! This crate owns one read and nothing else. It rereads Portfolio's own `BOUND` Capacity Scope
//! and current Capacity View through that Owner's `portfolio_api` read functions, inside one
//! transaction, and seals what it read together with the evidence cut it read it at.
//!
//! It makes no Risk decision, commits no Reservation, writes no fence, and consumes no Trade
//! Intent. The inputs for all four have no producer, so building any of them would mean minting a
//! weaker fact than the one the architecture defines.

#![deny(unsafe_code)]
#![deny(missing_debug_implementations)]
#![deny(rustdoc::broken_intra_doc_links)]

pub mod capacity_observation;
pub mod capacity_read_port_postgres;
