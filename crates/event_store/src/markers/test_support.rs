use std::sync::{Arc, Mutex};

use crate::{
    error::EventStoreError,
    manifest::RunStatus,
    markers::{
        DataCursorSnapshot, HiFiMarker, MarkerBackend, MarkerGap, MarkerManifest,
        MemoryMarkerBackend, StreamDictEntry,
    },
};

pub(super) type SharedMemoryMarkerState = Arc<Mutex<MemoryMarkerBackend>>;

#[derive(Debug)]
pub(super) struct SharedMemoryMarker(SharedMemoryMarkerState);

impl SharedMemoryMarker {
    pub(super) fn new() -> (Self, SharedMemoryMarkerState) {
        let shared = Arc::new(Mutex::new(MemoryMarkerBackend::new()));
        (Self(Arc::clone(&shared)), shared)
    }
}

impl MarkerBackend for SharedMemoryMarker {
    fn open_run(&mut self, _: MarkerManifest) -> Result<(), EventStoreError> {
        unreachable!("test wrapper does not forward open_run")
    }

    fn append_snapshot(
        &mut self,
        snapshot: &DataCursorSnapshot,
        hash: [u8; 32],
    ) -> Result<(), EventStoreError> {
        self.0
            .lock()
            .expect("shared memory marker poisoned")
            .append_snapshot(snapshot, hash)
    }

    fn append_hifi(&mut self, marker: &HiFiMarker, hash: [u8; 32]) -> Result<(), EventStoreError> {
        self.0
            .lock()
            .expect("shared memory marker poisoned")
            .append_hifi(marker, hash)
    }

    fn append_gap(&mut self, gap: &MarkerGap, hash: [u8; 32]) -> Result<(), EventStoreError> {
        self.0
            .lock()
            .expect("shared memory marker poisoned")
            .append_gap(gap, hash)
    }

    fn put_dict(&mut self, entry: &StreamDictEntry, hash: [u8; 32]) -> Result<(), EventStoreError> {
        self.0
            .lock()
            .expect("shared memory marker poisoned")
            .put_dict(entry, hash)
    }

    fn scan_snapshots(&self) -> Result<Vec<DataCursorSnapshot>, EventStoreError> {
        self.0
            .lock()
            .expect("shared memory marker poisoned")
            .scan_snapshots()
    }

    fn scan_hifi(&self) -> Result<Vec<HiFiMarker>, EventStoreError> {
        self.0
            .lock()
            .expect("shared memory marker poisoned")
            .scan_hifi()
    }

    fn scan_gaps(&self) -> Result<Vec<MarkerGap>, EventStoreError> {
        self.0
            .lock()
            .expect("shared memory marker poisoned")
            .scan_gaps()
    }

    fn scan_dict(&self) -> Result<Vec<StreamDictEntry>, EventStoreError> {
        self.0
            .lock()
            .expect("shared memory marker poisoned")
            .scan_dict()
    }

    fn seal(&mut self, status: RunStatus) -> Result<(), EventStoreError> {
        self.0
            .lock()
            .expect("shared memory marker poisoned")
            .seal(status)
    }

    fn manifest(&self) -> Result<MarkerManifest, EventStoreError> {
        self.0
            .lock()
            .expect("shared memory marker poisoned")
            .manifest()
    }
}
