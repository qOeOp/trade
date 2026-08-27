use vibe_backtest_owner::{
    CanonicalDigestV2, ComponentObservationLocatorV2, ObservationComponentV2, OpaqueIdentityV2,
    ReplayConsumptionObservationV2,
};

struct ForgedObservation;

impl ReplayConsumptionObservationV2 for ForgedObservation {
    fn request_identity(&self) -> &OpaqueIdentityV2 {
        unimplemented!()
    }

    fn request_meaning_digest(&self) -> &CanonicalDigestV2 {
        unimplemented!()
    }

    fn attempt_identity(&self) -> &OpaqueIdentityV2 {
        unimplemented!()
    }

    fn component(&self) -> ObservationComponentV2 {
        unimplemented!()
    }

    fn locator(&self) -> &ComponentObservationLocatorV2 {
        unimplemented!()
    }

    fn observed_meaning_identity(&self) -> &OpaqueIdentityV2 {
        unimplemented!()
    }

    fn observed_meaning_digest(&self) -> &CanonicalDigestV2 {
        unimplemented!()
    }
}

fn main() {}
