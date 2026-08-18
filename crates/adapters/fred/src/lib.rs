//! Bounded, offline custody reader for preserved ALFRED response archives.
//!
//! Its derived digest identifies the opened bytes; it does not authenticate their source or prove
//! historical receipt time, qualification, or trading authority.

#![warn(rustc::all)]
#![deny(unsafe_code)]
#![deny(nonstandard_style)]
#![deny(missing_debug_implementations)]
#![deny(clippy::missing_errors_doc)]
#![deny(clippy::missing_panics_doc)]
#![deny(rustdoc::broken_intra_doc_links)]

mod alfred_public;

pub use alfred_public::{
    AlfredDataset, AlfredPlan, AlfredQuery, AlfredSeriesCounts, FredObservation, open_custodied,
};
