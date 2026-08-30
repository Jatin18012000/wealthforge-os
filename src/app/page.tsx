/**
 * Placeholder root page for the M0/M1 scaffold.
 * The real Command Center dashboard is built in M6, on top of a trustworthy
 * data model and financial engine (see docs/00_MASTER_PLAN.md).
 */
export default function StatusPage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 720 }}>
      <h1>WEALTHFORGE OS</h1>
      <p>Local-first personal financial operating system.</p>
      <p>
        Current milestone: <strong>M0 — Repository &amp; governance</strong>. The
        dashboard is intentionally not built yet — see{" "}
        <code>docs/00_MASTER_PLAN.md</code> and{" "}
        <code>docs/20_BUILD_ROADMAP.md</code> for the milestone sequence.
      </p>
    </main>
  );
}
