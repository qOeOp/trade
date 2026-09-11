export default function DashboardRouteLoading() {
  return (
    <section className="dashboard-route-loading" data-dashboard-route-loading aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading page</span>
      <div className="dashboard-route-loading-heading" aria-hidden="true"><i /><i /></div>
      <div className="dashboard-route-loading-grid" aria-hidden="true">
        <i /><i /><i />
      </div>
    </section>
  );
}
