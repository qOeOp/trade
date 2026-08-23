use rstest::rstest;
use vibe_trader::observability::{
    ports::GlobalStatusReadPort,
    projection::{ProjectionPolicy, ProjectionVisibility, StatusProjection, TelemetryVisibility},
};

#[rstest]
fn container_consumer_sees_a_fail_closed_read_only_projection() {
    let projection = StatusProjection::new(ProjectionPolicy::default());
    let status = GlobalStatusReadPort::global_status(&projection, 0);

    assert_eq!(status.visibility(), ProjectionVisibility::Unavailable);
    assert_eq!(
        status.telemetry_visibility(),
        TelemetryVisibility::Unavailable
    );
    assert_eq!(status.owner_event_count(), 0);
}
