# tests

`fixtures/` — synthetic test data (budget workbooks, portfolio snapshots).
No real personal financial data is ever committed here — see
`docs/19_OPEN_DECISIONS.md` (D-005) and `docs/13_SECURITY_PRIVACY.md`.

Unit/integration tests live alongside the source they test (`src/**/*.test.ts`)
per `docs/14_TESTING_STRATEGY.md`; this directory holds fixtures and any
cross-cutting integration/E2E specs that don't belong next to a single module.
